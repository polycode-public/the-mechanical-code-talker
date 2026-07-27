// ingestbench/generate-ing8-corpus.mjs — the deterministic, seeded ING-8
// candidate-pair generator (PLAN_BENCHMARK_MECHANISATION.md's ING-8 item).
//
// ING-7's own checker (verifySubClassParaphrase, src/domain/paraphrase.mjs)
// only reaches isa/subclass paraphrases. ING-8 needs the harder whole-document
// equivalence shapes it doesn't cover: paraphrases of non-isa relations,
// multi-sentence documents, subject/object-swap and cross-relation confusions,
// and free wording outside any closed template. This script authors ~200
// candidate (input, restatement) PAIRS spanning those shapes, from a small
// committed vocabulary — never from the engine, never from an LLM. The pairs
// carry no label of their own; test-benchmarks/ingestbench/judge.mjs assigns
// the real ground truth (a paid step, run separately), and
// src/domain/paraphrase-ing8.mjs is built and held out against THAT judged
// corpus, never against this generator's own guess of which pairs are
// paraphrases.
//
// Determinism: same --seed (default 20260704) -> byte-identical corpus. Every
// pick (which vocabulary entries, which negative variant, which closed-template
// wording) is a seeded shuffle over committed arrays; nothing reads Date.now.
//
// Usage: node ingestbench/generate-ing8-corpus.mjs [--seed <n>] [--out <file>]

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32, seededShuffle } from "../../src/domain/seeded-random.mjs";
import { fnv1a32 as fnv1a } from "../../src/domain/hash.mjs";
import { paraphraseRelation, RELATION_FAMILY_IDS } from "../../src/domain/paraphrase-ing8.mjs";
import { parseFlags } from "../benchlib/bench.mjs";

export const DEFAULT_OUT = resolve(fileURLToPath(import.meta.url), "..", "ing8-candidates.jsonl");

// ---- closed committed vocabulary, ~20 (subject, object) pairs per family ----
// Original combinations, not copied from any external source (the licence
// rule generate-graded.mjs's own header names).

const ISA_PAIRS = [
  ["dog", "animal"], ["cat", "mammal"], ["oak", "tree"], ["rose", "flower"],
  ["trout", "fish"], ["laptop", "device"], ["novel", "book"], ["hammer", "tool"],
  ["violin", "instrument"], ["sedan", "car"], ["sparrow", "bird"], ["maple", "tree"],
  ["tulip", "flower"], ["salmon", "fish"], ["tablet", "device"], ["memoir", "book"],
  ["wrench", "tool"], ["cello", "instrument"], ["truck", "vehicle"], ["pigeon", "bird"],
];

const HAS_PAIRS = [
  ["bird", "feather"], ["car", "engine"], ["house", "roof"], ["plant", "leaf"],
  ["phone", "battery"], ["bicycle", "wheel"], ["book", "cover"], ["table", "leg"],
  ["shirt", "button"], ["clock", "hand"], ["guitar", "string"], ["boat", "sail"],
  ["camera", "lens"], ["door", "handle"], ["jacket", "pocket"], ["kettle", "spout"],
  ["umbrella", "handle"], ["chair", "cushion"], ["watch", "strap"], ["bottle", "cap"],
];

const CREATES_PAIRS = [
  ["weight", "pressure"], ["fire", "heat"], ["engine", "power"], ["storm", "rain"],
  ["friction", "heat"], ["erosion", "sediment"], ["volcano", "ash"], ["factory", "smoke"],
  ["battery", "current"], ["sun", "light"], ["wind", "erosion"], ["earthquake", "tremor"],
  ["reactor", "energy"], ["candle", "light"], ["fan", "breeze"], ["stove", "heat"],
  ["generator", "electricity"], ["wave", "foam"], ["thunder", "noise"], ["turbine", "power"],
];

const CAPABLEOF_PAIRS = [
  ["bird", "fly"], ["fish", "swim"], ["dog", "bark"], ["human", "speak"],
  ["cheetah", "run"], ["cat", "climb"], ["frog", "jump"], ["snake", "slither"],
  ["eagle", "soar"], ["horse", "gallop"], ["duck", "swim"], ["bee", "sting"],
  ["owl", "hunt"], ["spider", "spin"], ["kangaroo", "jump"], ["dolphin", "swim"],
  ["parrot", "talk"], ["bat", "fly"], ["ant", "carry"], ["wolf", "howl"],
];

const VOCAB = { isa: ISA_PAIRS, has: HAS_PAIRS, creates: CREATES_PAIRS, capableOf: CAPABLEOF_PAIRS };
const NON_ISA_FAMILIES = RELATION_FAMILY_IDS; // ["has", "creates", "capableOf"]

// ISA's own closed templates duplicated here (verbatim, matching
// src/domain/paraphrase.mjs's SUBCLASS_TEMPLATES) so the generator can phrase
// an isa fact two DIFFERENT closed ways without importing template internals
// paraphrase.mjs doesn't export — paraphraseRelation covers has/creates/
// capableOf; isa is handled by the same closed-template convention here.
const articleFor = (w) => (/^[aeiou]/i.test(String(w || "")) ? "an" : "a");
const ISA_TEMPLATES = [
  (s, o) => `${s} is a kind of ${o}`,
  (s, o) => `${s} is a type of ${o}`,
  (s, o) => `every ${s} is ${articleFor(o)} ${o}`,
  (s, o) => `${s} counts as ${articleFor(o)} ${o}`,
];

function isaText(subject, object, variantIndex) {
  return ISA_TEMPLATES[variantIndex % ISA_TEMPLATES.length](subject, object);
}

function relationText(family, subject, object, variantIndex) {
  if (family === "isa") return isaText(subject, object, variantIndex);
  return paraphraseRelation(family, subject, object, variantIndex);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function joinDoc(sentences) {
  return sentences.map((s) => cap(s.replace(/\.$/, ""))).join(". ").concat(".");
}

// ---- generators, one per corpus category ----

function positiveSingle(rng, id) {
  const items = [];
  let n = 0;
  const families = ["isa", "has", "creates", "capableOf"];
  for (const family of families) {
    const pairs = seededShuffle(VOCAB[family], rng).slice(0, 15);
    for (const [subject, object] of pairs) {
      n += 1;
      const input = joinDoc([relationText(family, subject, object, 0)]);
      const restatement = joinDoc([relationText(family, subject, object, 1)]);
      items.push({
        caseId: `${id}-pos-single-${family}-${String(n).padStart(2, "0")}`,
        rung: "ING-8", tags: ["judged", "meaning-preservation", "single-fact", family],
        input, restatement, kind: "positive", family,
      });
    }
  }
  return items;
}

function positiveDocument(rng, id) {
  const items = [];
  const facts = [];
  for (const family of ["isa", "has", "creates", "capableOf"]) {
    for (const [subject, object] of VOCAB[family]) facts.push({ family, subject, object });
  }
  const shuffled = seededShuffle(facts, rng);
  let n = 0;
  for (let i = 0; i + 1 < shuffled.length && n < 40; i += 2) {
    n += 1;
    const [a, b] = [shuffled[i], shuffled[i + 1]];
    const input = joinDoc([
      relationText(a.family, a.subject, a.object, 0),
      relationText(b.family, b.subject, b.object, 0),
    ]);
    const restatement = joinDoc([
      relationText(a.family, a.subject, a.object, 1),
      relationText(b.family, b.subject, b.object, 1),
    ]);
    items.push({
      caseId: `${id}-pos-doc-${String(n).padStart(2, "0")}`,
      rung: "ING-8", tags: ["judged", "meaning-preservation", "multi-sentence"],
      input, restatement, kind: "positive", families: [a.family, b.family],
    });
  }
  return items;
}

function negativeSwap(rng, id) {
  const items = [];
  const families = ["isa", "has", "creates", "capableOf"];
  const pool = [];
  for (const family of families) for (const [subject, object] of VOCAB[family]) pool.push({ family, subject, object });
  const picked = seededShuffle(pool, rng).slice(0, 30);
  picked.forEach((f, i) => {
    const input = joinDoc([relationText(f.family, f.subject, f.object, 0)]);
    const restatement = joinDoc([relationText(f.family, f.object, f.subject, 1)]); // subject/object swapped
    items.push({
      caseId: `${id}-neg-swap-${String(i + 1).padStart(2, "0")}`,
      rung: "ING-8", tags: ["judged", "meaning-preservation", "negative", "subject-object-swap"],
      input, restatement, kind: "negative", family: f.family,
    });
  });
  return items;
}

function negativeWrongPredicate(rng, id) {
  const items = [];
  const hasPicks = seededShuffle(HAS_PAIRS, rng).slice(0, 10);
  const createsPicks = seededShuffle(CREATES_PAIRS, rng).slice(0, 10);
  let n = 0;
  for (const [subject, object] of hasPicks) {
    n += 1;
    const input = joinDoc([relationText("has", subject, object, 0)]);
    const restatement = joinDoc([relationText("creates", subject, object, 0)]);
    items.push({
      caseId: `${id}-neg-wrongpred-${String(n).padStart(2, "0")}`,
      rung: "ING-8", tags: ["judged", "meaning-preservation", "negative", "wrong-predicate"],
      input, restatement, kind: "negative", family: "has",
    });
  }
  for (const [subject, object] of createsPicks) {
    n += 1;
    const input = joinDoc([relationText("creates", subject, object, 0)]);
    const restatement = joinDoc([relationText("has", subject, object, 0)]);
    items.push({
      caseId: `${id}-neg-wrongpred-${String(n).padStart(2, "0")}`,
      rung: "ING-8", tags: ["judged", "meaning-preservation", "negative", "wrong-predicate"],
      input, restatement, kind: "negative", family: "creates",
    });
  }
  return items;
}

function negativeInvented(rng, id) {
  const items = [];
  const bases = seededShuffle(
    ["isa", "has", "creates", "capableOf"].flatMap((family) => VOCAB[family].map(([s, o]) => ({ family, subject: s, object: o }))),
    rng,
  );
  const extras = seededShuffle(
    ["isa", "has", "creates", "capableOf"].flatMap((family) => VOCAB[family].map(([s, o]) => ({ family, subject: s, object: o }))),
    mulberry32((rng() * 1e9) >>> 0),
  );
  for (let i = 0; i < 20; i += 1) {
    const base = bases[i];
    const extra = extras[(i + 7) % extras.length];
    const input = joinDoc([relationText(base.family, base.subject, base.object, 0)]);
    const restatement = joinDoc([
      relationText(base.family, base.subject, base.object, 1),
      relationText(extra.family, extra.subject, extra.object, 0),
    ]);
    items.push({
      caseId: `${id}-neg-invented-${String(i + 1).padStart(2, "0")}`,
      rung: "ING-8", tags: ["judged", "meaning-preservation", "negative", "invented-fact"],
      input, restatement, kind: "negative", family: base.family,
    });
  }
  return items;
}

function negativeDropped(rng, id) {
  const items = [];
  const facts = ["isa", "has", "creates", "capableOf"].flatMap((family) => VOCAB[family].map(([s, o]) => ({ family, subject: s, object: o })));
  const shuffled = seededShuffle(facts, rng);
  let n = 0;
  for (let i = 0; i + 1 < shuffled.length && n < 20; i += 2) {
    n += 1;
    const [a, b] = [shuffled[i], shuffled[i + 1]];
    const input = joinDoc([relationText(a.family, a.subject, a.object, 0), relationText(b.family, b.subject, b.object, 0)]);
    const restatement = joinDoc([relationText(a.family, a.subject, a.object, 1)]); // b is dropped
    items.push({
      caseId: `${id}-neg-dropped-${String(n).padStart(2, "0")}`,
      rung: "ING-8", tags: ["judged", "meaning-preservation", "negative", "dropped-fact"],
      input, restatement, kind: "negative", families: [a.family, b.family],
    });
  }
  return items;
}

// Free wording OUTSIDE the closed template set — true paraphrases per the
// judge, but ones the deterministic checker (built only from the closed
// templates) is EXPECTED to decline rather than guess at. Held out to measure
// the checker's honest miss rate, never its false-positive rate.
const FREEFORM_PAIRS = [
  ["Bird is a kind of animal.", "Birds are a kind of animal."],
  ["Dog is a kind of animal.", "Dogs belong to the animal kingdom."],
  ["Cat is a kind of mammal.", "Cats are mammals."],
  ["Bird has a feather.", "Birds are covered in feathers."],
  ["Car has an engine.", "Cars are built with an engine."],
  ["Weight creates pressure.", "The weight is what creates the pressure."],
  ["Fire creates heat.", "Heat comes from fire."],
  ["Bird can fly.", "Birds are able to take to the air."],
  ["Fish can swim.", "Fish move through water by swimming."],
  ["Dog can bark.", "A dog barking is normal canine behavior."],
];

function freeformTrue(id) {
  return FREEFORM_PAIRS.map(([input, restatement], i) => ({
    caseId: `${id}-freeform-${String(i + 1).padStart(2, "0")}`,
    rung: "ING-8", tags: ["judged", "meaning-preservation", "freeform"],
    input, restatement, kind: "positive", family: "freeform",
  }));
}

export function generateCorpus({ seed = 20260704 } = {}) {
  const rng = mulberry32((seed ^ fnv1a("ing8-corpus")) >>> 0);
  const items = [
    ...positiveSingle(mulberry32((rng() * 1e9) >>> 0), "ing8"),
    ...positiveDocument(mulberry32((rng() * 1e9) >>> 0), "ing8"),
    ...negativeSwap(mulberry32((rng() * 1e9) >>> 0), "ing8"),
    ...negativeWrongPredicate(mulberry32((rng() * 1e9) >>> 0), "ing8"),
    ...negativeInvented(mulberry32((rng() * 1e9) >>> 0), "ing8"),
    ...negativeDropped(mulberry32((rng() * 1e9) >>> 0), "ing8"),
    ...freeformTrue("ing8"),
  ];
  return items;
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { seed: 20260704, out: DEFAULT_OUT },
    flags: {
      "--seed": { key: "seed", value: Number },
      "--out": { key: "out" },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const items = generateCorpus({ seed: args.seed });
  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.caseId)) throw new Error(`generate-ing8-corpus: duplicate caseId ${it.caseId}`);
    ids.add(it.caseId);
  }
  const text = `${items.map((it) => JSON.stringify(it)).join("\n")}\n`;
  await writeFile(args.out, text);
  const byKind = { positive: items.filter((i) => i.kind === "positive").length, negative: items.filter((i) => i.kind === "negative").length };
  console.log(`ing8 corpus: ${items.length} pairs (${byKind.positive} positive, ${byKind.negative} negative) written to ${args.out} (seed ${args.seed})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
