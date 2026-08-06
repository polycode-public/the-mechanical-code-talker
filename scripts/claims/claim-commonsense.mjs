// scripts/claims/claim-commonsense.mjs — E1, "knows the everyday world":
// runs the committed OpenBookQA sample through tmct's world-knowledge ask
// path (the same "what is a dog" lookup the offline claim exercises) twice
// against one rig store — out of the box, then again after `tmct import
// --corpus wordnet-xl` loads into that same store — and publishes both
// correct counts plus their delta. The corpus loads a lexicon of
// definitions and class facts; it is not a question-answering strategy, so
// most OpenBookQA stems (causal reasoning, multi-word effects, "what
// happens when…") stay outside what either run can ground. A low absolute
// score is the expected shape of this claim; the delta is what the corpus
// load buys.
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

const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "openbookqa-sample.jsonl");
const BIN_PATH = join(ROOT, "bin", "tmct.mjs");

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "is", "are",
  "was", "were", "be", "being", "been", "it", "its", "this", "that", "these",
  "those", "with", "by", "from", "as", "than", "then", "so", "not", "no",
]);

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const contentWords = (s) => normalize(s).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * The scoring matcher: flat, exact-or-variant. An item counts correct when
 * runTurn actually grounded an answer (record.miss === false — a refusal is
 * always unanswered, never partial credit) AND the answer text either
 * contains the gold choice's normalized phrase verbatim (exact match), or
 * contains every one of the gold phrase's content words somewhere in the
 * answer as whole words, in any order (variant match) — catches "dog is a
 * kind of animal" answering a gold choice phrased "an animal" without
 * requiring word-for-word agreement.
 */
function scoresCorrect(recordMiss, answerText, goldText) {
  if (recordMiss !== false) return false;
  const normAnswer = normalize(answerText);
  const normGold = normalize(goldText);
  if (!normGold) return false;
  if (normAnswer.includes(normGold)) return true;
  const words = contentWords(goldText);
  if (!words.length) return false;
  return words.every((w) => new RegExp(`\\b${w}\\b`).test(normAnswer));
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
    const gold = item.question.choices.find((c) => c.label === item.answerKey)?.text ?? "";
    const question = asQuestion(item.question.stem);
    const result = await runTurn(question, { memoryDir, sessionId: `commonsense-${item.id}`, graph });
    const ok = scoresCorrect(result.record?.miss, result.answer, gold);
    if (ok) correct += 1;
    else misses.push(item.id);
  }
  return { correct, misses };
}

async function main() {
  const items = await loadFixture();
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-commonsense-"));
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
    // writeClaim's regression check compares against `delta` (lib.mjs: a
    // before/after/delta payload's compareValue is the delta), not `after`
    // directly. `before` is deterministic (a fixed sample against a fixed
    // seed), so a delta-space floor of `delta - 2` enforces exactly a
    // "min on after, 2-question headroom" floor as long as `before` holds
    // steady run to run — the intended regression signal, expressed in the
    // space the harness actually checks.
    const record = writeClaim("commonsense", {
      hardware: defaultHardware(),
      pack: "shipped",
      unit: "questions",
      before: before.correct,
      after: after.correct,
      delta,
      threshold: { direction: "min", value: delta - 2 },
      sources: [
        "test-benchmarks/claims/openbookqa-sample.jsonl",
        "test-benchmarks/claims/openbookqa-sample.LICENSE",
        "scripts/claims/claim-commonsense.mjs",
      ],
      detail: {
        sampleSize: items.length,
        command: loadCommand,
        matcher: "exact or variant: every content word of the gold choice appears in the grounded answer; a refusal never counts",
        beforeMissedIds: before.misses,
        afterMissedIds: after.misses,
      },
    });

    console.log(
      `claim:commonsense: ${record.before}/${items.length} out of the box, `
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
