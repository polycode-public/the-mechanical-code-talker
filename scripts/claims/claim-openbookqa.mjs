// scripts/claims/claim-openbookqa.mjs — the OpenBookQA limit: runs the
// committed 100-question sample once, against a repo that already has
// `tmct import --corpus wordnet-xl` loaded before the first question is
// asked. wordnet-xl is the largest corpus tmct ships, so this is the
// strongest form of the limit tmct's world-knowledge ask path hits on causal
// and multi-word "what happens when…" reasoning: not "how much does a
// smaller corpus buy" (claim-definitions.mjs answers that), but "how far
// does the biggest corpus tmct ships get you on a benchmark it was never
// built to answer." A single arm costs one import instead of two.
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
 * answer as whole words, in any order (variant match).
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
    const result = await runTurn(question, { memoryDir, sessionId: `openbookqa-${item.id}`, graph });
    const ok = scoresCorrect(result.record?.miss, result.answer, gold);
    if (ok) correct += 1;
    else misses.push(item.id);
  }
  return { correct, misses };
}

async function main() {
  const items = await loadFixture();
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-openbookqa-"));
  const loadCommand = "tmct import --corpus wordnet-xl";
  try {
    await initRepo(dir, { persona: PERSONA_PRESETS.human, env: process.env });
    execFileSync(process.execPath, [BIN_PATH, "import", "--corpus", "wordnet-xl", "--repo", dir], {
      stdio: "pipe",
    });

    const graph = parseEntities(buildEntities([], [], {}));
    const store = await openConfiguredMemoryBackend(dir);
    let result;
    try {
      result = await runSample(items, store.dir, graph);
    } finally {
      await store.close();
    }

    // A limit's floor can only be crossed downward, and zero is already the
    // floor — this rig's gate is the schema/source check plus the published
    // number, not a regression threshold with headroom to lose.
    const record = writeClaim("openbookqa", {
      hardware: defaultHardware(),
      pack: "shipped",
      unit: "questions",
      value: result.correct,
      threshold: { direction: "min", value: 0 },
      sources: [
        "test-benchmarks/claims/openbookqa-sample.jsonl",
        "test-benchmarks/claims/openbookqa-sample.LICENSE",
        "scripts/claims/claim-openbookqa.mjs",
      ],
      detail: {
        sampleSize: items.length,
        corpus: "wordnet-xl",
        command: loadCommand,
        matcher: "exact or variant: every content word of the gold choice appears in the grounded answer; a refusal never counts",
        missedIds: result.misses,
        exampleStems: [
          "There are less hummingbirds by this house than before because of",
          "A person speaks English as her first language because",
          "When a kid slams on the brakes on their bike what is caused?",
        ],
      },
    });

    console.log(
      `claim:openbookqa: ${record.value}/${items.length} with \`${loadCommand}\` already loaded`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
