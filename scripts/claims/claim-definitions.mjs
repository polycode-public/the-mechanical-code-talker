// scripts/claims/claim-definitions.mjs — the definitional counterpart to
// claim-commonsense.mjs's causal-reasoning set: runs 100 "what is X"
// questions through tmct's world-knowledge ask path twice against one rig
// store — out of the box, then again after `tmct import --corpus
// wordnet-xl` loads into that same store — and publishes both correct
// counts plus their delta.
//
// The fixture carries three bands (test-benchmarks/claims/definitions-set.NOTICE
// has the full selection rule):
//   - seed (20): already answerable before the import, from
//     corpus/tier2/human.jsonl. Keeps "before" honestly nonzero.
//   - corpus (70): absent before, answerable after — the band the delta
//     measures.
//   - neither (10): absent from every corpus this rig can reach, so it
//     stays a miss in both arms. This is the visible ceiling: a fixture
//     tuned only to the delta would score 100 after the load, hiding how
//     much of the world stays outside any shipped corpus.
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { initRepo, PERSONA_PRESETS } from "../../src/services/init.mjs";
import { openConfiguredMemoryBackend } from "../../src/adapters/memory/core.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { writeClaim, defaultHardware, ROOT } from "./lib.mjs";

const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "definitions-set.jsonl");
const BIN_PATH = join(ROOT, "bin", "tmct.mjs");

// Set from the first committed run (delta 68), less the 2-question headroom
// the rate margin policy uses. A literal, not a recomputation off this run's
// own delta — that could never fail. Raise it deliberately, never silently.
const DELTA_FLOOR = 66;

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "is", "are",
  "was", "were", "be", "being", "been", "it", "its", "this", "that", "these",
  "those", "with", "by", "from", "as", "than", "then", "so", "not", "no",
]);

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const contentWords = (s) => normalize(s).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * The scoring matcher: flat, exact-or-variant, against every entry of
 * goldList. An item counts correct when runTurn actually grounded an
 * answer (record.miss === false — a refusal is always unanswered, never
 * partial credit) AND the answer text either contains one gold phrase's
 * normalized text verbatim (exact match), or contains every one of that
 * phrase's content words somewhere in the answer as whole words, in any
 * order (variant match) — catches "capybara is a kind of rodent" answering
 * a gold phrase "rodent" without requiring word-for-word agreement.
 */
function scoresCorrect(recordMiss, answerText, goldList) {
  if (recordMiss !== false) return false;
  const normAnswer = normalize(answerText);
  return goldList.some((goldText) => {
    const normGold = normalize(goldText);
    if (!normGold) return false;
    if (normAnswer.includes(normGold)) return true;
    const words = contentWords(goldText);
    if (!words.length) return false;
    return words.every((w) => new RegExp(`\\b${w}\\b`).test(normAnswer));
  });
}

const asQuestion = (stem) => {
  const q = String(stem).trim();
  return /[.?!]$/.test(q) ? q : `${q}?`;
};

async function loadFixture() {
  const body = await readFile(FIXTURE_PATH, "utf8");
  return body.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

async function runSample(items, memoryDir, graph) {
  let correct = 0;
  const misses = [];
  for (const item of items) {
    const question = asQuestion(item.question);
    const result = await runTurn(question, { memoryDir, sessionId: `definitions-${item.id}`, graph });
    const ok = scoresCorrect(result.record?.miss, result.answer, item.gold);
    if (ok) correct += 1;
    else misses.push(item.id);
  }
  return { correct, misses };
}

function bandCounts(items) {
  const counts = { seed: 0, corpus: 0, neither: 0 };
  for (const item of items) counts[item.band] += 1;
  return counts;
}

async function main() {
  const items = await loadFixture();
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-definitions-"));
  const loadCommand = "tmct import --corpus wordnet-xl";
  try {
    await initRepo(dir, { persona: PERSONA_PRESETS.human, env: process.env });
    const store = await openConfiguredMemoryBackend(dir);
    const graph = parseEntities(buildEntities([], [], {}));

    let before, after;
    try {
      before = await runSample(items, store.dir, graph);
    } finally {
      await store.close();
    }

    execFileSync(process.execPath, [BIN_PATH, "import", "--corpus", "wordnet-xl", "--repo", dir], {
      stdio: "pipe",
    });

    const storeAfter = await openConfiguredMemoryBackend(dir);
    try {
      after = await runSample(items, storeAfter.dir, graph);
    } finally {
      await storeAfter.close();
    }

    const delta = after.correct - before.correct;
    const record = writeClaim("definitions", {
      hardware: defaultHardware(),
      pack: "shipped",
      unit: "questions",
      before: before.correct,
      after: after.correct,
      delta,
      threshold: { direction: "min", value: DELTA_FLOOR },
      sources: [
        "test-benchmarks/claims/definitions-set.jsonl",
        "test-benchmarks/claims/definitions-set.NOTICE",
        "scripts/claims/claim-definitions.mjs",
      ],
      detail: {
        sampleSize: items.length,
        command: loadCommand,
        matcher: "exact or variant: every content word of some gold phrase appears in the grounded answer; a refusal never counts",
        bands: bandCounts(items),
        beforeMissedIds: before.misses,
        afterMissedIds: after.misses,
      },
    });

    console.log(
      `claim:definitions: ${record.before}/${items.length} out of the box, `
      + `${record.after}/${items.length} after \`${loadCommand}\` (delta ${record.delta >= 0 ? "+" : ""}${record.delta})`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
