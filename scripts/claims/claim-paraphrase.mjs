// scripts/claims/claim-paraphrase.mjs — measures whether reasking the same
// question in different words gets the same answer. For each of 50 questions
// drawn from the chatbench graded pool, test-benchmarks/claims/paraphrase-set.jsonl
// carries 5 authored paraphrases (varied wording, same meaning). Every
// canonical question and its paraphrases run through the exact turns-mode
// path chatbench/run.mjs uses (createRunnerDeps: the committed fixture graph,
// loaded once, read-only), each as its own fresh single turn — no focus/last
// threading, so a paraphrase never inherits state a prior turn set up.
//
// Two answers are equivalent when they carry the same miss/non-miss status
// and cite the same fact ids (answeredIds) — wording is free to differ, the
// grounding is not. A paraphrase that reaches a different route and cites a
// different (even if informally "correct") fact id counts as a real
// divergence: the whole point of this rig is to know where rephrasing
// changes what gets grounded, not to paper over it.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnerDeps } from "../../test-benchmarks/chatbench/run.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "paraphrase-set.jsonl");

async function loadRows() {
  const text = await readFile(FIXTURE_PATH, "utf8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const sortedIds = (ids) => [...(ids ?? [])].sort();
const sameIds = (a, b) => JSON.stringify(sortedIds(a)) === JSON.stringify(sortedIds(b));

async function askFresh(text, deps) {
  const r = await deps.runTurn(text, { config: deps.config, graph: deps.graph, focus: null, last: null });
  return {
    answer: r.answer ?? "",
    miss: r.record?.miss ?? null,
    resolvedIds: r.record?.resolvedIds ?? [],
    answeredIds: r.record?.answeredIds ?? [],
  };
}

async function measure() {
  const rows = await loadRows();
  const { deps, cleanup } = await createRunnerDeps("claim-paraphrase");
  const perQuestion = [];
  try {
    for (const row of rows) {
      const canonicalOutcome = await askFresh(row.canonical, deps);
      const paraphraseOutcomes = [];
      for (const paraphrase of row.paraphrases) {
        const outcome = await askFresh(paraphrase, deps);
        const equivalent = outcome.miss === canonicalOutcome.miss && sameIds(outcome.answeredIds, canonicalOutcome.answeredIds);
        paraphraseOutcomes.push({ paraphrase, equivalent, miss: outcome.miss, answeredIds: outcome.answeredIds });
      }
      perQuestion.push({
        id: row.id,
        canonical: row.canonical,
        canonicalMiss: canonicalOutcome.miss,
        canonicalAnsweredIds: canonicalOutcome.answeredIds,
        paraphrases: paraphraseOutcomes,
        equivalentCount: paraphraseOutcomes.filter((p) => p.equivalent).length,
      });
    }
  } finally {
    await cleanup();
  }
  return perQuestion;
}

async function main() {
  const perQuestion = await measure();
  const totalParaphrases = perQuestion.reduce((n, q) => n + q.paraphrases.length, 0);
  const equivalentParaphrases = perQuestion.reduce((n, q) => n + q.equivalentCount, 0);
  const rate = totalParaphrases > 0 ? (equivalentParaphrases / totalParaphrases) * 100 : 0;

  const failures = perQuestion
    .filter((q) => q.equivalentCount < q.paraphrases.length)
    .map((q) => ({
      id: q.id,
      canonical: q.canonical,
      canonicalMiss: q.canonicalMiss,
      canonicalAnsweredIds: q.canonicalAnsweredIds,
      divergent: q.paraphrases.filter((p) => !p.equivalent),
    }));

  const record = writeClaim("paraphrase", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "percent",
    value: Number(rate.toFixed(1)),
    marginKind: "rate",
    sources: [
      "scripts/claims/claim-paraphrase.mjs",
      "test-benchmarks/claims/paraphrase-set.jsonl",
      "test-benchmarks/chatbench/run.mjs",
      "test-benchmarks/chatbench/graded-pool.jsonl",
    ],
    detail: {
      questionCount: perQuestion.length,
      paraphrasesPerQuestion: 5,
      totalParaphrases,
      equivalentParaphrases,
      questionsWithFailures: failures.length,
      failures,
    },
  });
  console.log(`claim:paraphrase: ${record.value}% (${equivalentParaphrases}/${totalParaphrases} paraphrases equivalent, threshold ${record.threshold.direction} ${record.threshold.value})`);
  if (failures.length) {
    console.log(`  ${failures.length} question(s) had at least one divergent paraphrase:`);
    for (const f of failures) console.log(`    - ${f.id}: ${f.divergent.length}/5 divergent`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
