// scripts/claims/claim-commonsenseqa.mjs — the CommonsenseQA rung: runs the
// committed 100-question sample once, against a repo seeded with exactly the
// INIT_XL_BANDS band set — the same bands `npm run init:xl` gives the CLI and
// `public/chat-seed.json` serves the demo page, seeded through the same
// resolveExtensions + seedActiveCorpusEntries path scripts/build-chat-seed.mjs
// uses. Nothing else is imported. The child pack is reached the way chat
// reaches it: lazily, per source term, through the choice lane's own probe —
// this rig never bulk-imports it.
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, PERSONA_PRESETS } from "../../src/services/init.mjs";
import { openConfiguredMemoryBackend, loadMemory, readFactRows, normFactTerm } from "../../src/adapters/memory/core.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { resolveExtensions, seedActiveCorpusEntries } from "../../src/services/extensions.mjs";
import { initXlBands, SEED_BAND_CAPS } from "../build-chat-seed.mjs";
import { writeClaim, defaultHardware, ROOT } from "./lib.mjs";

export const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "commonsenseqa-sample.jsonl");

export const SOURCES = [
  "test-benchmarks/claims/commonsenseqa-sample.jsonl",
  "test-benchmarks/claims/commonsenseqa-sample.NOTICE",
  "scripts/claims/claim-commonsenseqa.mjs",
  "corpus/child/manifest.json",
  "corpus/conceptnet/slice.jsonl",
];

/**
 * An item counts correct when the lane selected exactly one option AND that
 * option's label equals the item's answerKey. A refusal, a miss, and a
 * selection of the wrong option all score zero. There is no partial credit
 * and no text matching: the lane returns a label, the fixture holds a label,
 * and the two are compared.
 */
export function scoresCorrect(selectedLabel, answerKey) {
  return typeof selectedLabel === "string" && selectedLabel === answerKey;
}

export async function loadFixture() {
  const body = await readFile(FIXTURE_PATH, "utf8");
  return body.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

/** Shape B of the option splitter: the stem, then every option enumerated
 *  "A) text" in order — the shape the fixture holds and a user pastes. */
export function questionFor(item) {
  return `${item.question.stem}\n${item.question.choices.map((c) => `${c.label}) ${c.text}`).join(" ")}`;
}

/** Seeds `memoryDir` with exactly the INIT_XL_BANDS band set, one
 *  seedActiveCorpusEntries call per band, in the same order and under the
 *  same per-band caps scripts/build-chat-seed.mjs uses to build
 *  public/chat-seed.json. Returns the band list and the total facts appended,
 *  so the claim can cite what it actually seeded. */
export async function seedInitXlBands(memoryDir, repoRoot) {
  const { entries } = await resolveExtensions(repoRoot);
  const bands = await initXlBands(entries);
  const definitionalFirst = entries.get("conceptnet")?.prefer;
  let seedFacts = 0;
  for (const name of bands) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`claim:commonsenseqa: init:xl names unknown band "${name}"`);
    const capped = SEED_BAND_CAPS[name] !== undefined
      ? { ...entry, limit: SEED_BAND_CAPS[name], prefer: entry.prefer ?? definitionalFirst }
      : entry;
    const seeded = await seedActiveCorpusEntries(memoryDir, new Map([[name, { ...capped, active: true }]]));
    seedFacts += seeded.perBundle[name]?.appended ?? 0;
  }
  return { bands, seedFacts };
}

/** Pair-level, gold-only: true when the store holds a Fact row whose subject
 *  and object are the item's source concept and its gold option text, in
 *  either order, under any predicate, both sides compared after
 *  normFactTerm. Read after the item's own turn, so it reflects whatever the
 *  lane's own child-pack pull left behind rather than a separate probe. */
export async function sourceEdgeGrounded(memoryDir, item) {
  const gold = item.question.choices.find((c) => c.label === item.answerKey)?.text ?? "";
  const source = normFactTerm(item.question.question_concept);
  const target = normFactTerm(gold);
  if (!source || !target) return false;
  const rows = readFactRows(await loadMemory(memoryDir));
  return rows.some((r) => {
    const s = normFactTerm(r.subject);
    const o = normFactTerm(r.object);
    return (s === source && o === target) || (s === target && o === source);
  });
}

/** Runs `items` through the choice lane against an already-seeded
 *  `memoryDir`, one fresh sessionId per item so no discourse state leaks
 *  between questions. Returns raw per-item outcomes (not yet sliced to
 *  `exampleStems`) so a caller can merge several slices of the fixture
 *  before picking the first three missed stems in fixture order. */
export async function runSample(items, memoryDir, graph) {
  let correct = 0;
  let answered = 0;
  let refused = 0;
  let abstained = 0;
  let sourceEdgePresent = 0;
  let correctWhenSourceEdgePresent = 0;
  const missedIds = [];
  const missedStems = [];
  for (const item of items) {
    const result = await runTurn(questionFor(item), {
      memoryDir, sessionId: `commonsenseqa-${item.id}`, graph,
    });
    const selectedLabel = result?.detail?.selectedLabel;
    if (result?.record?.miss === true) abstained += 1;
    else if (typeof selectedLabel === "string") answered += 1;
    else refused += 1;

    const ok = scoresCorrect(selectedLabel, item.answerKey);
    if (ok) correct += 1;
    else {
      missedIds.push(item.id);
      missedStems.push(item.question.stem);
    }

    if (await sourceEdgeGrounded(memoryDir, item)) {
      sourceEdgePresent += 1;
      if (ok) correctWhenSourceEdgePresent += 1;
    }
  }
  return {
    correct, answered, refused, abstained,
    sourceEdgePresent, correctWhenSourceEdgePresent,
    missedIds, missedStems,
  };
}

/** Builds the writeClaim() detail payload from a (possibly merged) runSample
 *  result — shared by a single-shot run and by a caller that ran the fixture
 *  across several seeded-store sessions and combined the per-item outcomes
 *  before reaching this point. */
export function buildClaimDetail(items, bands, result) {
  return {
    sampleSize: items.length,
    bands,
    seedFacts: result.seedFacts,
    answered: result.answered,
    correctOfAnswered: result.correct,
    refused: result.refused,
    abstained: result.abstained,
    sourceEdgePresent: result.sourceEdgePresent,
    correctWhenSourceEdgePresent: result.correctWhenSourceEdgePresent,
    scorer: "gold-key: the lane's selected option label equals answerKey; a refusal or a miss scores zero; no judge, no text match",
    missedIds: result.missedIds,
    exampleStems: result.missedStems.slice(0, 3),
  };
}

export function assertPartitioned(result, sampleSize) {
  const partitioned = result.answered + result.refused + result.abstained;
  if (partitioned !== sampleSize) {
    throw new Error(
      `claim:commonsenseqa: answered(${result.answered}) + refused(${result.refused}) `
      + `+ abstained(${result.abstained}) = ${partitioned}, not sampleSize(${sampleSize})`,
    );
  }
}

export async function main() {
  const items = await loadFixture();
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-commonsenseqa-"));
  try {
    await initRepo(dir, { persona: PERSONA_PRESETS.human, env: process.env, seed: false });
    const graph = parseEntities(buildEntities([], [], {}));
    const store = await openConfiguredMemoryBackend(dir);
    let result;
    let bands;
    try {
      const seeded = await seedInitXlBands(store.dir, dir);
      bands = seeded.bands;
      result = await runSample(items, store.dir, graph);
      result.seedFacts = seeded.seedFacts;
    } finally {
      await store.close();
    }

    assertPartitioned(result, items.length);

    const record = writeClaim("commonsenseqa", {
      hardware: defaultHardware(),
      pack: "shipped",
      unit: "questions",
      value: result.correct,
      threshold: { direction: "min", value: 0 },
      sources: SOURCES,
      detail: buildClaimDetail(items, bands, result),
    });

    console.log(
      `claim:commonsenseqa: ${record.value}/${items.length} `
      + `(answered ${result.answered}, refused ${result.refused}, abstained ${result.abstained}; `
      + `sourceEdgePresent ${result.sourceEdgePresent}, correctWhenSourceEdgePresent ${result.correctWhenSourceEdgePresent})`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
