// infbench/generate-cases.mjs — the deterministic INFBENCH case generator
// (PLAN_INFERENCE_TESTING.md §2.2), mirroring chatbench/generate-graded.mjs's
// mechanism for a structurally simpler fixture: INF-1..INF-8's premises/queries
// are STRUCTURAL (a chain of length k, a disjoint pair, a cardinality n), so
// `expect` is a PURE FUNCTION of each template's own parameters — never a
// replay of the engine (the zero-fabrication anti-circularity discipline,
// PLAN_INFERENCE_TESTING.md §2.1/§2.2). The only thing this file does with
// TODAY's engine is the FIXTURE LINT: every premise must `parseAce` to a clean
// hit (non-null, residue: []) against the committed lexicon — a premise the
// grammar can't hold fails LOUD at generation time (throws), never silently.
//
// Fixture: the committed common-noun lexicon (src/domain/grammar/lexicon-core.json)
// as class/relation vocabulary, plus synthetic individuals exploiting the
// tokenizer's CODE_REF rule (src/domain/grammar/ace.mjs:42,71-72: any token containing
// `. / \ # : @` is recognized as an individual BY FORM, no lexicon entry
// needed) — e01.mjs, e02.mjs, … minted deterministically.
//
// CORPUS-CONTAMINATION GUARD (found during authoring, not in the plan): tmct
// ships a small pre-seeded software/general-knowledge corpus
// (corpus/seon/concepts.jsonl, corpus/conceptnet/slice.jsonl) that the chat
// engine consults for "is X a Y" vocabulary questions INDEPENDENTLY of
// anything taught in a session — e.g. "is a controller a component" answers
// "yes" from `corpus:seon /r/IsA` even with NOTHING taught. Left unguarded,
// this would silently corrupt the A2/B1/C2 templates (which specifically test
// whether the engine can derive an UNTAUGHT relationship): a corpus-known pair
// would answer "yes" regardless of whether the rule under test exists. Every
// noun PAIR this file wires into a direct premise/query relationship is
// checked against a denylist built from both corpus files at generation time
// (isaDenylist()) and skipped if contaminated — see pairAllowed().
//
// Determinism: a fixed default seed (no Date.now anywhere); the same --seed
// always produces a byte-identical cases.jsonl.
//
// Usage: node infbench/generate-cases.mjs [--seed <n>] [--out <file>]

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAce } from "../../src/domain/grammar/ace.mjs";
import { loadLexicon, thirdPerson } from "../../src/domain/grammar/lexicon.mjs";
import { normFactTerm } from "../../src/adapters/memory/core.mjs";
import { fnv1a32 as fnv1a } from "../../src/domain/hash.mjs";
import { nlpAdapter } from "../../src/adapters/ask-nlp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));

export const DEFAULT_SEED = 20260707; // today's date (PLAN_INFERENCE_TESTING.md §2.2's "default recorded in the generator")
export const DEFAULT_OUT = join(HERE, "cases.jsonl");

// ---- deterministic PRNG (mulberry32, Fisher-Yates), from the shared domain
// primitive so the seed reproduces the same draw wherever it runs. ----
import { mulberry32, seededShuffle } from "../../src/domain/seeded-random.mjs";
import { parseFlags } from "../benchlib/bench.mjs";
export { mulberry32, seededShuffle };

// ---- fixture: the committed lexicon's class-noun vocabulary ----
// PLAN_OSS_ACE_PARSER.md's ace-owl extraction briefly moved lexicon-core.json
// out of src/domain/grammar/, but that extraction was REVERTED on operator
// instruction (NEXT.md, 2026-07-10 — the unpublished-package incident):
// the parser and its lexicon are back in src/domain/grammar/ as the real
// implementation, and the packages/ace-owl/ workspace is gone. This path had
// gone stale pointing at the removed workspace (found while regenerating
// cases.jsonl for the scm-svf1/cardinality-monotonicity/cax-maxc0 build) —
// fixed back to the real committed location.
const LEXICON_PATH = join(ROOT, "src", "domain", "grammar", "lexicon-core.json");
const RAW_LEXICON = JSON.parse(readFileSync(LEXICON_PATH, "utf8"));
const lexicon = loadLexicon();

/** Plain class-forming nouns — everything except the possessive `property`
 *  nouns (owner/author/…, reserved for the possessive pattern) AND any noun
 *  lemma that ALSO collides with a declared properName (found during
 *  authoring: "node" is both the graph-theory common noun and the Node.js
 *  properName — resolveNP tries lookupProperName FIRST for a single-token NP,
 *  so "every X is a node" parses "node" as the individual Node and fails the
 *  class-level subClassOf pattern's individual guard). Sorted so the base
 *  list never depends on the lexicon file's key order. */
const PROPER_NAME_LEMMAS = new Set((RAW_LEXICON.properNames || []).map((p) => String(p).toLowerCase()));
const CLASS_NOUNS = Object.keys(RAW_LEXICON.nouns)
  .filter((n) => !RAW_LEXICON.nouns[n].property && !PROPER_NAME_LEMMAS.has(n))
  .sort();

/** The subset of CLASS_NOUNS whose plural is a plain "+s" (no -es/-ies
 *  insertion) — keeps the C1 cardinality template's surface forms legible.
 *  lookupNoun's foldCandidates would fold an irregular plural back to its
 *  lemma anyway (this is a readability filter, not a parse requirement). */
const REGULAR_PLURAL_NOUNS = CLASS_NOUNS.filter(
  (n) => !/(?:[sxz]|ch|sh)$/.test(n) && !/[^aeiou]y$/.test(n),
);

const OBJECT_PROPERTY_NOUNS = Object.keys(RAW_LEXICON.nouns).filter((n) => RAW_LEXICON.nouns[n].property === "object");

const VERB_LEMMAS_NO_PREP = Object.keys(RAW_LEXICON.verbs).filter((v) => !RAW_LEXICON.verbs[v].prep);

// ---- corpus-contamination denylist (see file header) ----
function loadIsaDenylist() {
  const denylist = new Set();
  const nounSet = new Set(CLASS_NOUNS);
  for (const rel of ["corpus/conceptnet/slice.jsonl", "corpus/seon/concepts.jsonl"]) {
    let text;
    try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let d;
      try { d = JSON.parse(t); } catch { continue; }
      if (d.rel !== "/r/IsA") continue;
      const s = String(d.start || "").replace(/^\/c\/en\//, "");
      const o = String(d.end || "").replace(/^\/c\/en\//, "");
      if (nounSet.has(s) && nounSet.has(o)) denylist.add([s, o].sort().join("|"));
    }
  }
  return denylist;
}
const ISA_DENYLIST = loadIsaDenylist();
const pairAllowed = (a, b) => a !== b && !ISA_DENYLIST.has([a, b].sort().join("|"));

/** Every term the DEFAULT PERSONA seeds into a fresh session's memory. A bare
 *  runChat over an empty dir (infbench/run.mjs's drive) loads this seed, so a
 *  noun named here arrives already carrying facts — which is a different
 *  question than the one a template meant to ask. Observed while authoring the
 *  existential probe: "some noses are cloches" leaves nose⊑cloche unasserted and
 *  the probe passes without ever reading the quantifier, purely because `nose`
 *  ships with corpus facts. `cloche` and `milium` do not, and those fabricate.
 *
 *  Note this is a DIFFERENT corpus from the one ISA_DENYLIST scans: the denylist
 *  reads conceptnet/seon, which a bare session never loads. */
function loadPersonaSeedTerms() {
  const terms = new Set();
  let text;
  try { text = readFileSync(join(ROOT, "corpus", "tier2", "human.jsonl"), "utf8"); } catch { return terms; }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    for (const field of [d.start, d.end]) {
      const term = String(field || "").replace(/^\/c\/en\//, "");
      if (term) terms.add(term);
    }
  }
  return terms;
}
const PERSONA_SEED_TERMS = loadPersonaSeedTerms();

/** Pick `n` corpus-clean, pairwise-mutually-allowed nouns from `pool` in
 *  shuffled order, advancing past any noun that would collide with an
 *  already-chosen one. Deterministic given `shuffled`/`startAt`. */
function pickClean(shuffled, startAt, n) {
  const out = [];
  let i = startAt;
  while (out.length < n) {
    if (i >= shuffled.length) throw new Error("infbench/generate-cases.mjs: ran out of corpus-clean nouns — widen the pool or shrink a template's count");
    const cand = shuffled[i];
    i += 1;
    if (out.every((x) => pairAllowed(x, cand))) out.push(cand);
  }
  return { picked: out, next: i };
}

// ---- synthetic individuals (the CODE_REF tokenizer rule) ----
let individualCounter = 0;
function mintIndividual() {
  individualCounter += 1;
  return `e${String(individualCounter).padStart(2, "0")}.mjs`;
}

// ---- fixture lint (PLAN_INFERENCE_TESTING.md §2.1 "already mechanical") ----
function lint(sentence) {
  const parsed = parseAce(sentence, lexicon);
  if (!parsed || (parsed.residue && parsed.residue.length)) {
    throw new Error(`infbench fixture lint failed: "${sentence}" -> ${parsed ? `residue ${JSON.stringify(parsed.residue)}` : "no parse (null)"}`);
  }
  return parsed;
}
function triplesOf(premises) {
  const triples = [];
  for (const p of premises) triples.push(...lint(p).triples);
  return triples;
}
function termsOf(triples) {
  const set = new Set();
  for (const t of triples) { set.add(normFactTerm(t.subject)); set.add(normFactTerm(t.object)); }
  return set;
}
/** The referential lint (mirrors agentbench/grade.mjs:92-101): every
 *  expect.entailed literal's subject/object must be a term that actually
 *  occurs in the premises' emitted triples, normFactTerm-normalized. */
function checkEntailed(caseTag, premises, entailed) {
  const terms = termsOf(triplesOf(premises));
  for (const e of entailed || []) {
    for (const term of [e.subject, e.object]) {
      const n = normFactTerm(term);
      if (!terms.has(n)) {
        throw new Error(`infbench fixture lint failed (${caseTag}): entailed literal term "${term}" (normalized "${n}") does not occur in the premises' triples`);
      }
    }
  }
}

function mkCase(fields) { return { ...fields }; }

// ======================================================================
// INF-1 — a1Lookup: 1 noun × {subClassOf, typeAssertion, possessive}
// ======================================================================
function a1Lookup(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;

  // subClassOf: "every N1 is a N2" -> "is a N1 a N2" (direct lookup, zero
  // inference — Rules needed: none, per §1's INF-1 row).
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const premises = [`every ${n1} is a ${n2}`];
    const query = `is a ${n1} a ${n2}`;
    const entailed = [{ subject: n1, predicate: "rdfs:subClassOf", object: n2 }];
    checkEntailed(`a1-scoa-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-1", template: "a1Lookup", variant: "subClassOf",
      arms: ["kernel", "chat"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed },
    }));
  }

  // typeAssertion: "IND is a N" -> "is IND a N"
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 1);
    cursor = next;
    const [n] = picked;
    const ind = mintIndividual();
    const premises = [`${ind} is a ${n}`];
    const query = `is ${ind} a ${n}`;
    const entailed = [{ subject: ind, predicate: "rdf:type", object: n }];
    checkEntailed(`a1-type-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-1", template: "a1Lookup", variant: "typeAssertion",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed },
    }));
  }

  // possessive: "OWNER's PROP is OWNED" -> "what do you know about OWNER"
  // (pattern-7 possessive; both sides are synthetic code-ref individuals, so
  // no properName lexicon addition is needed — see PLAN_INFERENCE_TESTING.md
  // §1 footnote¹'s "declare it, don't special-case", resolved here by simply
  // not needing a proper name at all).
  const propOrder = seededShuffle(OBJECT_PROPERTY_NOUNS, rng);
  for (let i = 0; i < 10; i += 1) {
    const prop = propOrder[i % propOrder.length];
    const owner = mintIndividual();
    const owned = mintIndividual();
    const premises = [`${owner}'s ${prop} is ${owned}`];
    const query = `what do you know about ${owner}`;
    const entailed = [{ subject: owner, predicate: `tmct:${prop}`, object: owned }];
    checkEntailed(`a1-poss-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-1", template: "a1Lookup", variant: "possessive",
      arms: ["chat"], checkType: "recall",
      premises, query, expect: { mentions: [owned], entailed },
    }));
  }

  return cases;
}

// ======================================================================
// INF-2 — a2ChainLen2: 2-hop noun chain × {taught-only, graph-bridge}
// ======================================================================
function a2ChainLen2(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;

  // taught-only: "every N1 is a N2", "every N2 is a N3" -> "is a N1 a N3".
  // KERNEL PASSES (deriveSubClassClosure chains it); CHAT is the honest gap
  // (§1: "cax-sco over two TAUGHT facts is NOT implemented" — verified live,
  // see BENCHMARK_INFERENCE_<version>.md).
  for (let i = 0; i < 20; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    const premises = [`every ${n1} is a ${n2}`, `every ${n2} is a ${n3}`];
    const query = `is a ${n1} a ${n3}`;
    const entailed = [
      { subject: n1, predicate: "rdfs:subClassOf", object: n2 },
      { subject: n2, predicate: "rdfs:subClassOf", object: n3 },
      { subject: n1, predicate: "rdfs:subClassOf", object: n3 },
    ];
    checkEntailed(`a2-chain-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-2", template: "a2ChainLen2", variant: "taught-only",
      arms: ["kernel", "chat"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed },
    }));
  }

  // graph-bridge: a synthetic graph individual `inherits` N2 (a codegraph
  // edge, NOT an ACE premise); taught "every N2 is a N3"; query "is IND a N3"
  // — live TODAY via chat.mjs's inheritsChain bridge (verified live).
  for (let i = 0; i < 20; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n2, n3] = picked;
    const seq = String(i + 1).padStart(3, "0");
    const subId = `cls-sub-${seq}`;
    const subLabel = `GraphSub${seq}`;
    const superId = `cls-sup-${seq}`;
    const premises = [`every ${n2} is a ${n3}`];
    const query = `is ${subLabel} a ${n3}`;
    const entailed = [{ subject: n2, predicate: "rdfs:subClassOf", object: n3 }];
    checkEntailed(`a2-bridge-${i + 1}`, premises, entailed);
    const graph = {
      individuals: [
        { id: subId, label: subLabel, class: "Class", derived_from: [], mentions: [] },
        { id: superId, label: n2, class: "Class", derived_from: [], mentions: [] },
      ],
      objectProperties: [{
        predicate: "inherits", prop: "seon:hasSuperType", count: 1,
        examples: [{ subject: subId, object: superId, subjectLabel: subLabel, objectLabel: n2 }],
      }],
    };
    cases.push(mkCase({
      band: "INF-2", template: "a2ChainLen2", variant: "graph-bridge",
      arms: ["chat"], checkType: "isa",
      premises, query, graph, expect: { verdict: "yes", entailed },
    }));
  }

  return cases;
}

// ======================================================================
// INF-3 — b1Disjoint: 1 disjoint pair × {direct, 1-hop lifted, control}
// ======================================================================
function b1Disjoint(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  const PAIRS = 13; // 13 * 3 cells ≈ 40 (§2.2's illustrative pool)

  for (let i = 0; i < PAIRS; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 4);
    cursor = next;
    const [c1, c2, c3, c4] = picked;
    const base = `b1-${i + 1}`;

    { // direct member: x∈C1, C1 disjointWith C2 ⊢ x∉C2 — TRUE "no", but no
      // rule consumes owl:disjointWith yet (§1: B1 "HALF" reachable).
      const ind = mintIndividual();
      const premises = [`no ${c1} is a ${c2}`, `${ind} is a ${c1}`];
      const query = `is ${ind} a ${c2}`;
      const entailed = [
        { subject: c1, predicate: "owl:disjointWith", object: c2 },
        { subject: ind, predicate: "rdf:type", object: c1 },
      ];
      checkEntailed(`${base}-direct`, premises, entailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1Disjoint", variant: "direct-member",
        arms: ["chat"], checkType: "isa",
        premises, query, expect: { verdict: "no", entailed, proof: true },
      }));
    }
    { // 1-hop lifted member: x∈C3, C3⊑C1, C1 disjointWith C2 ⊢ x∉C2 — B1's
      // hardest cell (needs the ⊑-lift too, §1 footnote²).
      const ind = mintIndividual();
      const premises = [`no ${c1} is a ${c2}`, `every ${c3} is a ${c1}`, `${ind} is a ${c3}`];
      const query = `is ${ind} a ${c2}`;
      const entailed = [
        { subject: c1, predicate: "owl:disjointWith", object: c2 },
        { subject: c3, predicate: "rdfs:subClassOf", object: c1 },
        { subject: ind, predicate: "rdf:type", object: c3 },
      ];
      checkEntailed(`${base}-lifted`, premises, entailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1Disjoint", variant: "lifted-member",
        arms: ["chat"], checkType: "isa",
        premises, query, expect: { verdict: "no", entailed, proof: true },
      }));
    }
    { // control: an unrelated noun — the honest "cannot be proven" floor,
      // never a guessed "no" (already live today: the miss mechanism exists).
      const ind = mintIndividual();
      const premises = [`no ${c1} is a ${c2}`, `${ind} is a ${c4}`];
      const query = `is ${ind} a ${c2}`;
      const entailed = [
        { subject: c1, predicate: "owl:disjointWith", object: c2 },
        { subject: ind, predicate: "rdf:type", object: c4 },
      ];
      checkEntailed(`${base}-control`, premises, entailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1Disjoint", variant: "control",
        arms: ["chat"], checkType: "isa",
        premises, query, expect: { verdict: "unproven", entailed },
      }));
    }
  }

  return cases;
}

// ======================================================================
// INF-3 — b1Existential: "some N1s are N2s" does not license "every N1 is a
// N2". ACE itself declines the existential (parseAce returns residue
// ["some","are"] rather than a subClassOf triple), so a case here asks what the
// chat layer does with a sentence its own grammar refused: an honest refusal,
// or a universal invented from a premise that never stated one.
//
// Each pair ships its probe next to a CONTROL that differs by one word — "every"
// for "some", same nouns, same query. The control is what stops the probe from
// rewarding silence: an engine that refuses everything fails the control, and
// only an engine that reads the quantifier passes both cells.
//
// Cycled across the pairs so one word's handling is never the whole probe:
// these differ in strength but none of them is "every", and a lane that reads
// any of them as a universal makes the same claim the premise didn't.
//
// Regular-plural, persona-clean nouns only, and both filters are load-bearing.
// An irregular plural masks the trap: "some men are fathers" is refused today
// because the assert lane never folds "men" to "man". A persona-seeded noun
// masks it too, and less visibly — see PERSONA_SEED_TERMS.
// ======================================================================
const EXISTENTIAL_QUANTIFIERS = ["some", "a few", "several", "most", "many"];

function b1Existential(rng) {
  const cases = [];
  const pool = REGULAR_PLURAL_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const quantifier = EXISTENTIAL_QUANTIFIERS[i % EXISTENTIAL_QUANTIFIERS.length];
    const existential = `${quantifier} ${n1}s are ${n2}s`;
    const universal = `every ${n1} is a ${n2}`;
    const scoEntailed = [{ subject: n1, predicate: "rdfs:subClassOf", object: n2 }];

    { // The class-level probe: the existential entails nothing about the class,
      // so the honest floor is a refusal. `entailed` is empty on purpose — and
      // the premise is never lint()ed, because ACE declining it IS the setup.
      cases.push(mkCase({
        band: "INF-3", template: "b1Existential", variant: "class-probe",
        arms: ["chat"], checkType: "isa",
        premises: [existential], query: `is a ${n1} a ${n2}`,
        expect: { verdict: "unproven", entailed: [] },
        note: "An existential premise entails no subclass relation, so a confident 'yes' here is a universal the premise never stated. ACE declines the sentence itself, which makes any yes the work of a lane that dropped the quantifier rather than read it.",
      }));
    }
    { // The same trap reached through an individual: even granted the
      // membership, the existential still licenses nothing about this member.
      const ind = mintIndividual();
      const typePremise = `${ind} is a ${n1}`;
      checkEntailed(`b1-exi-indiv-${i + 1}`, [typePremise], [{ subject: ind, predicate: "rdf:type", object: n1 }]);
      cases.push(mkCase({
        band: "INF-3", template: "b1Existential", variant: "individual-probe",
        arms: ["chat"], checkType: "isa",
        premises: [existential, typePremise], query: `is ${ind} a ${n2}`,
        expect: { verdict: "unproven", entailed: [{ subject: ind, predicate: "rdf:type", object: n1 }] },
        note: "Membership of the subject class plus an existential still entails nothing about this individual — the some/every slip is the only route to a 'yes'.",
      }));
    }
    { // Control: swap "some" for "every" and the SAME query becomes provable.
      checkEntailed(`b1-exi-ctl-class-${i + 1}`, [universal], scoEntailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1Existential", variant: "class-control",
        arms: ["kernel", "chat"], checkType: "isa",
        premises: [universal], query: `is a ${n1} a ${n2}`,
        expect: { verdict: "yes", entailed: scoEntailed },
        note: "The class-probe's minimal pair: one word apart, and this one is genuinely provable. Fails for an engine that refuses everything, which is what makes the probe's pass mean something.",
      }));
    }
    { // Control: the individual probe's minimal pair, proof chain and all.
      const ind = mintIndividual();
      const typePremise = `${ind} is a ${n1}`;
      const entailed = [
        { subject: n1, predicate: "rdfs:subClassOf", object: n2 },
        { subject: ind, predicate: "rdf:type", object: n1 },
        { subject: ind, predicate: "rdf:type", object: n2 },
      ];
      checkEntailed(`b1-exi-ctl-indiv-${i + 1}`, [universal, typePremise], entailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1Existential", variant: "individual-control",
        arms: ["chat"], checkType: "isa",
        premises: [universal, typePremise], query: `is ${ind} a ${n2}`,
        expect: { verdict: "yes", entailed, proof: true },
        note: "The individual-probe's minimal pair: cax-sco over a taught type and a taught subclass, which the chat layer proves today.",
      }));
    }
  }
  return cases;
}

// ======================================================================
// INF-4 — b2ChainLenK (chain length 3/4/5) — graded against a declared
// ceiling: the chain is classically provable and the kernel already derives
// it, so `expect` pins the chat layer's honest floor rather than the classical
// answer. The `ceiling` field carries that decision to the report, which
// counts these separately from the greens that measure a real capability.
// ======================================================================
function b2ChainLenK(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  for (const k of [3, 4, 5]) {
    for (let i = 0; i < 10; i += 1) {
      const { picked, next } = pickClean(shuffled, cursor, k + 1);
      cursor = next;
      const premises = [];
      for (let j = 0; j < k; j += 1) premises.push(`every ${picked[j]} is a ${picked[j + 1]}`);
      const query = `is a ${picked[0]} a ${picked[k]}`;
      const entailed = premises.map((_p, j) => ({ subject: picked[j], predicate: "rdfs:subClassOf", object: picked[j + 1] }));
      entailed.push({ subject: picked[0], predicate: "rdfs:subClassOf", object: picked[k] });
      checkEntailed(`b2-chain${k}-${i + 1}`, premises, entailed);
      cases.push(mkCase({
        band: "INF-4", template: "b2ChainLenK", variant: `chain-${k}`,
        arms: ["chat"], checkType: "isa",
        premises, query, expect: { verdict: "unproven", entailed, proof: true },
        ceiling: "chat-layer multi-hop proof-chain materialization",
        note: "The chained subject-object pair is classically provable by scm-sco transitivity, and the kernel closure (src/domain/syllogise.mjs) already derives it. This template grades the CHAT layer's multi-hop proof-chain materialization, so expect pins the honest 'cannot be proven' floor rather than the classical answer, and a pass here says the mouth refused, not that the chain was proved. Chat-arm only, so the kernel's correctness is never miscounted as fabrication against the floor literal.",
      }));
    }
  }
  return cases;
}

// ---- INF-4 — b2Svf1: someValuesFrom triple. Genuinely unproven even for a
// complete cax-sco/cls-svf1 engine: (N1 ⊓ ∃verb.N2) ⊑ N3 does NOT entail the
// plain N1 ⊑ N3 — an honest "cannot be proven" that also doubles as the
// pattern-4 someValuesFrom expressibility witness (§1). ----
function b2Svf1(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    const verb = VERB_LEMMAS_NO_PREP[i % VERB_LEMMAS_NO_PREP.length];
    const vform = thirdPerson(verb);
    const premises = [`every ${n1} that ${vform} a ${n2} is a ${n3}`];
    const query = `is a ${n1} a ${n3}`;
    checkEntailed(`b2-svf1-${i + 1}`, premises, []);
    cases.push(mkCase({
      band: "INF-4", template: "b2Svf1", variant: "svf1",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      note: "genuinely unproven for ANY engine (not merely today's): a someValuesFrom restriction does not license the plain subclass query — an honest floor, doubling as cls-svf1's expressibility witness (§1).",
    }));
  }
  return cases;
}

// ---- INF-4 — b2Svf1Apply: a genuinely POSITIVE instance-level cls-svf1
// application, added per a strategy-advisor feasibility pass (2026-07-10):
// b2ChainLenK's 30 cases are pure scm-sco chain-transitivity ceilings whose
// blocker is proof-chain materialization (§4 stage 2), not cls-svf1; b2Svf1's
// 10 cases are PERMANENTLY unproven negative witnesses (see its own note,
// above) that can never flip to "yes" no matter what engine ships — so
// neither template gave a real cls-svf1 implementation anything to move.
// This template does: "every N1 that VERBs a N2 is a N3" + "IND1 VERBs IND2"
// + "IND2 is a N2" ⊨ "IND1 is a some-VERB-N2" — the restriction CLASS itself
// (cls-svf1's actual conclusion, `src/domain/syllogise.mjs`'s `deriveSomeValuesFromApplication`),
// NOT the further "IND1 is a N3" intersection step (that needs cls-int1 +
// cax-sco too — out of this stage's scope, see `src/domain/syllogise.mjs`'s header
// comment). The query asks about the restriction node's own readable term
// directly ("is IND1 a some-imports-test"), which is not a lexicon noun, so
// query about a synthetic restriction-node term today regardless) is never
// going to parse it as an ISA question — this template therefore declares
// `arms: ["kernel"]` ONLY, checked directly against `src/domain/syllogise.mjs`'s
// pure kernel via `infbench/grade.mjs`'s `kernelVerdict` (a legitimate
// bench-side drive point, exactly what the kernel arm already exists for —
// see grade.mjs's own file-header comment), never against chat.mjs. ----
function b2Svf1Apply(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    const verb = VERB_LEMMAS_NO_PREP[i % VERB_LEMMAS_NO_PREP.length];
    const vform = thirdPerson(verb);
    const ind1 = mintIndividual();
    const ind2 = mintIndividual();
    const restriction = `some-${vform}-${n2}`;
    const premises = [
      `every ${n1} that ${vform} a ${n2} is a ${n3}`,
      `${ind1} ${vform} ${ind2}`,
      `${ind2} is a ${n2}`,
    ];
    const query = `is ${ind1} a ${restriction}`;
    const entailed = [
      { subject: ind1, predicate: `tmct:${vform}`, object: ind2 },
      { subject: ind2, predicate: "rdf:type", object: n2 },
      { subject: ind1, predicate: "rdf:type", object: restriction },
    ];
    checkEntailed(`b2-svf1apply-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-4", template: "b2Svf1Apply", variant: "positive",
      arms: ["kernel"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed, proof: true },
      note: "cls-svf1's actual positive conclusion (PLAN_INFERENCE_TESTING.md §4 stage 4): the restriction CLASS itself, not the further owl:intersectionOf step to N3 — a deliberately narrower, honestly-scoped claim than the original worked example's 'is chat.mjs a suite'. kernel-arm only: the query names a synthetic restriction node term, which chat.mjs was never taught to answer",
    }));
  }
  return cases;
}

// ======================================================================
// INF-5 — c1Cardinality: (exactly n, queried min m≤n) / (max 0, existence).
// FIXED IN PLACE (this build, PLAN_INFERENCE_TESTING.md §4 stage 4): both
// variants now carry the TRUE classical verdict, proven by
// proveCardinalityAtLeast/proveMaxCardinalityZeroDenial (src/domain/syllogise.mjs) —
// the generator's own `m = 1 + (i % n)` construction makes `m ≤ n`
// unconditionally true, so exactly-min is always "yes"; "has at most 0" is an
// honest encoded negation, so max0 is always "no". Leaving these pinned at
// the old placeholder "unproven" now that the rules genuinely prove them
// would itself be a fabrication-check regression (a real yes/no answer
// graded against a stale "unproven" literal is exactly what grade.mjs's
// fabrication check flags).
// ======================================================================
function c1Cardinality(rng) {
  const cases = [];
  const shuffled = seededShuffle(REGULAR_PLURAL_NOUNS, rng);
  let cursor = 0;
  const plural = (n) => `${n}s`;

  for (let i = 0; i < 15; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const n = 2 + (i % 3); // 2..4
    const m = 1 + (i % n); // 1..n — always ≤ n by construction
    const premises = [`every ${n1} has exactly ${n} ${plural(n2)}`];
    const query = `does every ${n1} have at least ${m} ${m === 1 ? n2 : plural(n2)}`;
    const r = `exactly-${n}-${n2}`;
    const entailed = [
      { subject: n1, predicate: "rdfs:subClassOf", object: r },
      { subject: r, predicate: "owl:cardinality", object: String(n) },
      { subject: r, predicate: "owl:onClass", object: n2 },
    ];
    checkEntailed(`c1-exact-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-5", template: "c1Cardinality", variant: "exactly-min",
      arms: ["kernel", "chat"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed, proof: true },
      note: "cardinality monotonicity (exactly n ⊢ min m≤n): proveCardinalityAtLeast (src/domain/syllogise.mjs) proves it directly from the restriction's own declared n against the queried m — sound whenever m≤n, which this template's own m=1+(i%n) construction always satisfies.",
    }));
  }
  for (let i = 0; i < 15; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const premises = [`every ${n1} has at most 0 ${plural(n2)}`];
    const query = `does a ${n1} have a ${n2}`;
    const r = `max-0-${n2}`;
    const entailed = [
      { subject: n1, predicate: "rdfs:subClassOf", object: r },
      { subject: r, predicate: "owl:maxCardinality", object: "0" },
      { subject: r, predicate: "owl:onClass", object: n2 },
    ];
    checkEntailed(`c1-max0-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-5", template: "c1Cardinality", variant: "max0",
      arms: ["kernel", "chat"], checkType: "isa",
      premises, query, expect: { verdict: "no", entailed, proof: true },
      note: "cax-maxc0 (§5's found capability, now consumed): 'has at most 0' is an honest encoded negation (owl:maxCardinality 0) — proveMaxCardinalityZeroDenial (src/domain/syllogise.mjs) proves the class-level 'no' via a one-step universal generalization from cls-maxc1's ABox contradiction rule.",
    }));
  }
  return cases;
}

// ---- INF-5 — c1ScmSvfApply: scm-svf1 (someValuesFrom restriction
// SUBSUMPTION, W3C OWL 2 RL Table 9 — see src/domain/syllogise.mjs's own header
// comment for why scm-svf2, the property-subsumption sibling rule, is out of
// scope: tmct's ACE grammar has no way to teach property subsumption at all).
// Two INDEPENDENTLY taught someValuesFrom restrictions sharing the SAME
// verb/property, whose filler classes are related by a taught ⊑ — r1 via
// "every N1 that VERBs a N2 is a N3" (declares ∃VERB.N2), a taught "every N2
// is a N2b" (N2 ⊑ N2b), r2 via "every N4 that VERBs a N2b is a N5" (declares
// ∃VERB.N2b) — entail the restriction NODES themselves are ⊑-related (r1 ⊑
// ("is a some-VERB-N2 a some-VERB-N2b"), a plain "is X a Y" surface both the
// kernel arm's QUERY_RE and chat.mjs's ISA_ASK_RE already parse — unlike
// b2Svf1Apply's restriction-node QUERY (kernel-only), this one names NO
// individual at all, so both arms apply. ----
function c1ScmSvfApply(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 6);
    cursor = next;
    const [n1, n2, n3, n2b, n4, n5] = picked;
    const verb = VERB_LEMMAS_NO_PREP[i % VERB_LEMMAS_NO_PREP.length];
    const vform = thirdPerson(verb);
    const r1 = `some-${vform}-${n2}`;
    const r2 = `some-${vform}-${n2b}`;
    const premises = [
      `every ${n1} that ${vform} a ${n2} is a ${n3}`,
      `every ${n2} is a ${n2b}`,
      `every ${n4} that ${vform} a ${n2b} is a ${n5}`,
    ];
    const query = `is a ${r1} a ${r2}`;
    const entailed = [
      { subject: r1, predicate: "owl:onProperty", object: `tmct:${vform}` },
      { subject: r1, predicate: "owl:someValuesFrom", object: n2 },
      { subject: n2, predicate: "rdfs:subClassOf", object: n2b },
      { subject: r2, predicate: "owl:onProperty", object: `tmct:${vform}` },
      { subject: r2, predicate: "owl:someValuesFrom", object: n2b },
      { subject: r1, predicate: "rdfs:subClassOf", object: r2 },
    ];
    checkEntailed(`c1-scmsvf-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-5", template: "c1ScmSvfApply", variant: "positive",
      arms: ["kernel", "chat"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed, proof: true },
      note: "scm-svf1 (W3C OWL 2 RL Table 9): two independently taught someValuesFrom restrictions sharing the same property, whose filler classes are ⊑-related, entail the restriction-to-restriction subsumption itself (src/domain/syllogise.mjs's deriveSomeValuesFromSubsumption) — not the further owl:intersectionOf step, mirroring b2Svf1Apply's own deliberately narrower scope.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-6 — c2Inconsistent: contradictory triple, SAME b1Disjoint machinery.
// Grades a live capability: the engine detects the clash, names the disjoint
// pair that caused it and refuses to answer, so a pass is the real behaviour
// and not a floor this template agreed not to test.
// ======================================================================
function c2Inconsistent(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  for (let i = 0; i < 20; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [c1, c2] = picked;
    const ind = mintIndividual();
    const premises = [`no ${c1} is a ${c2}`, `${ind} is a ${c1}`, `${ind} is a ${c2}`];
    const query = `what do you know about ${ind}`;
    const entailed = [
      { subject: c1, predicate: "owl:disjointWith", object: c2 },
      { subject: ind, predicate: "rdf:type", object: c1 },
      { subject: ind, predicate: "rdf:type", object: c2 },
    ];
    checkEntailed(`c2-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-6", template: "c2Inconsistent", variant: "inconsistent",
      arms: ["chat"], checkType: "inconsistent",
      premises, query, expect: { verdict: "inconsistent", entailed, clash: [c1, c2] },
      note: "The clash is the template's own declared disjoint pair, pinned at generation time, so grading stays a comparison against a known literal rather than a re-derivation. A pass requires the engine to admit the contradiction rather than answer from the contradictory memory; it does that today, naming the disjoint pair and asking for a retraction.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-7 — Constructed restriction (OWL 2 EL). Classify THROUGH class
// expressions that were never declared as graph nodes — nested existentials
// and existential chains — which needs EL saturation, a different algorithm
// from forward-chaining. ACE has no bare-existential teach frame ("every heart
// has a valve" is declined, exactly as "some Ns are Ns" is in b1Existential),
// so — like that template — the premise is NOT lint()ed: the grammar declining
// the sentence IS the setup, and any confident "yes" is a fabrication the probe
// exists to catch. Ceiling markers until PLAN_SYLLOGIST_EL_DL.md Stage EL ships;
// the honest floor today is a miss (unproven). Corpus/persona-clean nouns only,
// so a "yes" can only come from EL saturation, never a seeded fact.
// ======================================================================
const EL_CEILING = "OWL 2 EL saturation (Stage EL, PLAN_SYLLOGIST_EL_DL.md): classify through class expressions the graph never declared as nodes";

function elConstructedRestriction(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n)), rng);
  let cursor = 0;
  for (let i = 0; i < 8; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    // n1 ⊑ ∃has.n2, n2 ⊑ n3 ⊢ n1 ⊑ ∃has.n3 (E1). The first premise is the
    // undeclared restriction EL constructs; ACE declines it, so it is unlinted.
    const premises = [`every ${n1} has a ${n2}`, `every ${n2} is a ${n3}`];
    const query = `does a ${n1} have a ${n3}`;
    cases.push(mkCase({
      band: "INF-7", template: "elConstructedRestriction", variant: "nested-existential",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      ceiling: EL_CEILING,
      note: "E1 (PLAN_SYLLOGIST_EL_DL.md): a nested existential the graph never declared as a node. ACE has no bare-existential teach frame, so 'every N has a N' is declined and the premise is unlinted (as in b1Existential) — the honest floor today is a miss, and only real EL saturation, never a seeded fact, could turn it into a yes.",
    }));
  }
  return cases;
}

function elExistentialChain(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n)), rng);
  let cursor = 0;
  for (let i = 0; i < 6; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    // n1 ⊑ ∃has.n2, n2 ⊑ ∃has.n3, has transitive ⊢ n1 has an n3 somewhere (E2).
    const premises = [`every ${n1} has a ${n2}`, `every ${n2} has a ${n3}`];
    const query = `does a ${n1} contain a ${n3}`;
    cases.push(mkCase({
      band: "INF-7", template: "elExistentialChain", variant: "existential-chain",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      ceiling: EL_CEILING,
      note: "E2 (PLAN_SYLLOGIST_EL_DL.md): composing two existentials through undeclared intermediate class expressions. Unlinted (ACE declines the bare existential); honest miss floor until Stage EL composes the chain.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-8 — Reasoning by cases (OWL 2 DL) and disjointness-sound proof. Case
// analysis — disjunction elimination, complement classes — needs a tableau
// with branching (⊔, ¬), the first tmct conclusions that require reasoning by
// cases. ACE declines "or", "not" and complement frames (they are retraction
// triggers / unparsed, exactly as PLAN_SYLLOGIST_EL_DL.md E3/E4 note), so those
// premises are unlinted ceiling markers until Stage DL. The disjointness-proof-
// soundness case is different: its premises ALL parse and it grades a LIVE
// capability — the is-a ladder consults every stored owl:disjointWith ahead of
// certifying a yes, so a subclass chain crossing a stored disjointness refuses
// by naming both facts instead of laundering the contradiction as a proof.
// ======================================================================
const DL_DISJUNCTION_CEILING = "OWL 2 DL reasoning by cases (Stage DL, PLAN_SYLLOGIST_EL_DL.md) + phase-0 unionOf/negative-assertion representation";
const DL_COMPLEMENT_CEILING = "OWL 2 DL complement classes (Stage DL, PLAN_SYLLOGIST_EL_DL.md) + phase-0 complementOf representation";

function dlDisjunction(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n)), rng);
  let cursor = 0;
  for (let i = 0; i < 6; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    const ind = mintIndividual();
    // every n1 is a n2 or a n3; ind is a n1; ind is not a n2 ⊢ ind is a n3 (E3).
    // "or" and "not" are both declined by ACE, so the disjunction can't even be
    // stated today — unlinted, honest miss floor.
    const premises = [`every ${n1} is a ${n2} or a ${n3}`, `${ind} is a ${n1}`, `${ind} is not a ${n2}`];
    const query = `is ${ind} a ${n3}`;
    cases.push(mkCase({
      band: "INF-8", template: "dlDisjunction", variant: "disjunction-elimination",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      ceiling: DL_DISJUNCTION_CEILING,
      note: "E3 (PLAN_SYLLOGIST_EL_DL.md): disjunction elimination — the first conclusion needing reasoning by cases. ACE declines both 'or' (no unionOf frame) and 'not' (a retraction trigger, not a negative assertion), so the knowledge can't be stated today, let alone used: an honest miss, unlinted.",
    }));
  }
  return cases;
}

function dlComplement(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n)), rng);
  let cursor = 0;
  for (let i = 0; i < 6; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const ind = mintIndividual();
    // everything not-n1 is n2; ind is not n1 ⊢ ind is n2 (E4). complementOf is
    // unrepresentable in the graph vocabulary today — unlinted miss floor.
    const premises = [`everything that is not a ${n1} is a ${n2}`, `${ind} is not a ${n1}`];
    const query = `is ${ind} a ${n2}`;
    cases.push(mkCase({
      band: "INF-8", template: "dlComplement", variant: "complement",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      ceiling: DL_COMPLEMENT_CEILING,
      note: "E4 (PLAN_SYLLOGIST_EL_DL.md): complement classes. complementOf does not exist in the graph vocabulary, so 'everything that is not X is Y' is unrepresentable — an honest miss, unlinted, until Stage DL.",
    }));
  }
  return cases;
}

// The disjointness-proof-soundness discriminator: ind:c1, c1 ⊑ c2, c1 ⊥ c2.
// Asked "is ind a c2", a sound engine must NOT answer "yes with a subclass
// proof" — the memory is inconsistent, so the honest verdict is the clash, not
// a certified conclusion. ALL premises parse, so this one IS linted and graded
// live, and it grades a real capability: the cax-dw gate runs ahead of the
// direct-fact verdict and both proof chases, so the would-be chain proof
// refuses by naming both stored facts. checkType "inconsistent" (like
// c2Inconsistent): pass = the engine admits the clash.
function dlDisjointProofSoundness(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;
  for (let i = 0; i < 8; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [c1, c2] = picked;
    const ind = mintIndividual();
    const premises = [`${ind} is a ${c1}`, `every ${c1} is a ${c2}`, `no ${c1} is a ${c2}`];
    const query = `is ${ind} a ${c2}`;
    const entailed = [
      { subject: ind, predicate: "rdf:type", object: c1 },
      { subject: c1, predicate: "rdfs:subClassOf", object: c2 },
      { subject: c1, predicate: "owl:disjointWith", object: c2 },
    ];
    checkEntailed(`inf8-soundness-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-8", template: "dlDisjointProofSoundness", variant: "disjoint-clash",
      arms: ["chat"], checkType: "inconsistent",
      premises, query, expect: { verdict: "inconsistent", entailed, clash: [c1, c2] },
      note: "The soundness pin: the subclass chain c1 ⊑ c2 would 'prove' ind is a c2, but c1 ⊥ c2 makes the memory inconsistent — the honest answer is the clash, never 'yes with a proof'. Graded live against a real capability: the is-a ladder computes the disjoint-violation gate ahead of the direct-fact verdict and both proof chases, and refuses by naming both stored facts.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-1 — a1UniversalConditional: "if something is a N1 then it is a N2" IS
// the universal subclass teach in a conditional coat — the chat layer rewrites
// it to the "every N1 is a N2" surface before any dispatch lane sees it, so
// the follow-up lookup answers from the taught fact. The premise is a
// chat-lane rewrite, not an ACE sentence, so it is NOT lint()ed (as in
// b1Existential) and `entailed` stays empty: what this template grades is the
// teach surface itself reaching the store, witnessed by the direct query.
// Chat-arm only: the kernel parses premises through ACE, which declines the
// conditional coat, so the kernel has nothing to derive from here.
// ======================================================================
function a1UniversalConditional(rng) {
  const cases = [];
  const pool = CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    cases.push(mkCase({
      band: "INF-1", template: "a1UniversalConditional", variant: "conditional-teach",
      arms: ["chat"], checkType: "isa",
      premises: [`if something is a ${n1} then it is a ${n2}`], query: `is a ${n1} a ${n2}`,
      expect: { verdict: "yes", entailed: [] },
      note: "The universal conditional is the subclass teach in a conditional coat: the chat layer rewrites it to 'every N1 is a N2' and stores the taught fact, so the direct lookup answers yes with the taught citation. Unlinted (the conditional surface is a chat rewrite, not ACE grammar).",
    }));
  }
  return cases;
}

// ======================================================================
// INF-2 — a2Reflexive: "is a N a N" holds by definition — ⊑ is reflexive
// (OWL 2 RL's scm-cls family), whatever the term. Two cells: a taught term
// and a term the session was never taught, because reflexivity owes nothing
// to the store. Chat-arm only: the kernel's transitive closure derives no
// reflexive pairs, deliberately — its domain is chains, and asking it here
// would grade a rule it does not claim.
// ======================================================================
function a2Reflexive(rng) {
  const cases = [];
  const pool = CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 5; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 3);
    cursor = next;
    const [n1, n2, n3] = picked;
    const premises = [`every ${n1} is a ${n2}`];
    const scoEntailed = [{ subject: n1, predicate: "rdfs:subClassOf", object: n2 }];
    checkEntailed(`a2-reflex-${i + 1}`, premises, scoEntailed);
    cases.push(mkCase({
      band: "INF-2", template: "a2Reflexive", variant: "taught-term",
      arms: ["chat"], checkType: "isa",
      premises, query: `is a ${n1} a ${n1}`,
      expect: { verdict: "yes", entailed: scoEntailed },
      note: "Reflexive self-subsumption over a term the session was taught about: N1 ⊑ N1 holds trivially, and the answer says so rather than falling to the can't-confirm closer.",
    }));
    cases.push(mkCase({
      band: "INF-2", template: "a2Reflexive", variant: "untaught-term",
      arms: ["chat"], checkType: "isa",
      premises, query: `is a ${n3} a ${n3}`,
      expect: { verdict: "yes", entailed: [] },
      note: "Reflexive self-subsumption owes nothing to the store: N3 was never taught, and N3 ⊑ N3 still holds by definition. `entailed` is empty because the conclusion's term occurs in no premise.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-2 — a2Converse: "every N1 is a N2" asked backwards ("is a N2 a N1").
// The honest verdict is a refusal — some N2s may well be N1s; the store just
// doesn't say — and the chat layer refuses while naming the direction it DOES
// know (the converse nudge). A directional discriminator: an engine that
// drops the direction of ⊑ answers yes here, which is exactly the fabrication
// the gate flags. Both arms: the kernel's closure is directional too.
// ======================================================================
function a2Converse(rng) {
  const cases = [];
  const pool = CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const premises = [`every ${n1} is a ${n2}`];
    const scoEntailed = [{ subject: n1, predicate: "rdfs:subClassOf", object: n2 }];
    checkEntailed(`a2-conv-${i + 1}`, premises, scoEntailed);
    cases.push(mkCase({
      band: "INF-2", template: "a2Converse", variant: "converse",
      arms: ["kernel", "chat"], checkType: "isa",
      premises, query: `is a ${n2} a ${n1}`,
      expect: { verdict: "unproven", entailed: scoEntailed },
      note: "⊑ does not reverse: the taught fact runs N1 → N2 and the query asks N2 → N1, so a yes here is a direction the premise never stated. The chat refusal names the stored direction and nudges toward the teach that would settle it.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-2 — a2EntailedRetraction: an entailed fact backed by TWO independent
// taught routes, materialized by /syllogise, then retracted one route at a
// time. Both routes are 3 hops, deliberately past the live chase's maxHops:2,
// so after the first forget the ONLY yes left is the re-grounded entailed
// fact — survivor re-grounding is what the yes witnesses, and after the
// second forget the entailed fact must fall with its last justification (the
// stale-justification probe: a lingering citation would answer a confident
// yes, which the fabrication gate flags). Chat-arm only, and the premises are
// chat-lane turns (kind-of teaches, a slash command, forget phrasings), so
// none of them are lint()ed and `entailed` stays empty. Consonant-initial
// nouns only, so the hardcoded "a" article reads correctly in every teach and
// forget surface.
// ======================================================================
function a2EntailedRetraction(rng) {
  const cases = [];
  const pool = REGULAR_PLURAL_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n) && !/^[aeiou]/.test(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 6; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 6);
    cursor = next;
    const [n0, r1a, r1b, r2a, r2b, top] = picked;
    const teach = [
      `a ${n0} is a kind of ${r1a}`, `a ${r1a} is a kind of ${r1b}`, `a ${r1b} is a kind of ${top}`,
      `a ${n0} is a kind of ${r2a}`, `a ${r2a} is a kind of ${r2b}`, `a ${r2b} is a kind of ${top}`,
    ];
    const query = `is a ${n0} a ${top}`;
    const survivorOrFall = (extraForgets, verdict, variant, note) => mkCase({
      band: "INF-2", template: "a2EntailedRetraction", variant,
      arms: ["chat"], checkType: "isa",
      premises: [...teach, `/syllogise ${n0}`, `forget that a ${n0} is a kind of ${r1a}`, ...extraForgets],
      query, expect: { verdict, entailed: [] },
      note,
    });
    cases.push(survivorOrFall([], "yes", "survivor-regrounds",
      "Two independent 3-hop routes justify the same entailed fact; forgetting one route's first edge must leave the fact standing on the survivor's re-grounded environment. The routes are longer than the live chase walks, so the yes can only come from the materialized entailed fact — no cascade, no stale citation."));
    cases.push(survivorOrFall([`forget that a ${n0} is a kind of ${r2a}`], "unproven", "stale-justification-falls",
      "With the second route's first edge forgotten too, the entailed fact has no surviving justification and must fall with it. A confident yes here is the stale-justification symptom — an entailed fact answering from a citation whose premises are gone — and the fabrication gate flags it."));
  }
  return cases;
}

// ======================================================================
// INF-3 — b1DisjointVeto: the CLASS-level faces of the stored-disjointness
// veto, alongside b1Disjoint's individual-level cells. A stored
// owl:disjointWith now vetoes every is-a yes: asked directly it answers the
// provable no, asked through the symmetric orientation it still answers no
// (disjointness has no direction), and lifted through a taught subclass edge
// it composes the no from both stored facts. The control keeps the veto
// honest: a disjointness between OTHER terms licenses nothing about this
// pair, so the honest floor is a refusal, never a guessed no. Chat-arm only:
// the kernel has no disjointness rule, by construction.
// ======================================================================
function b1DisjointVeto(rng) {
  const cases = [];
  const pool = CLASS_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 6; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 4);
    cursor = next;
    const [c1, c2, c3, c4] = picked;
    const disjoint = `no ${c1} is a ${c2}`;
    const disjointEntailed = [{ subject: c1, predicate: "owl:disjointWith", object: c2 }];
    checkEntailed(`b1-veto-${i + 1}`, [disjoint], disjointEntailed);
    cases.push(mkCase({
      band: "INF-3", template: "b1DisjointVeto", variant: "class-direct",
      arms: ["chat"], checkType: "isa",
      premises: [disjoint], query: `is a ${c1} a ${c2}`,
      expect: { verdict: "no", entailed: disjointEntailed, proof: true },
      note: "The taught disjointness between the asked terms reads as the negative polarity side directly: a provable class-level no citing the stored fact, ahead of every yes-chase.",
    }));
    cases.push(mkCase({
      band: "INF-3", template: "b1DisjointVeto", variant: "class-converse",
      arms: ["chat"], checkType: "isa",
      premises: [disjoint], query: `is a ${c2} a ${c1}`,
      expect: { verdict: "no", entailed: disjointEntailed, proof: true },
      note: "owl:disjointWith is symmetric — taught as (C1, C2) and asked as (C2, C1), the same stored fact answers the same provable no.",
    }));
    {
      const premises = [`every ${c3} is a ${c1}`, disjoint];
      const entailed = [
        { subject: c3, predicate: "rdfs:subClassOf", object: c1 },
        ...disjointEntailed,
      ];
      checkEntailed(`b1-veto-lift-${i + 1}`, premises, entailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1DisjointVeto", variant: "class-inherited",
        arms: ["chat"], checkType: "isa",
        premises, query: `is a ${c3} a ${c2}`,
        expect: { verdict: "no", entailed, proof: true },
        note: "The class-level lift: C3 ⊑ C1 and C1 ⊥ C2 compose to a provable no for C3 vs C2, citing both stored facts — taught subclass edges double as type edges in the provable-no chase.",
      }));
    }
    {
      const premises = [disjoint, `every ${c3} is a ${c4}`];
      const entailed = [
        ...disjointEntailed,
        { subject: c3, predicate: "rdfs:subClassOf", object: c4 },
      ];
      checkEntailed(`b1-veto-ctl-${i + 1}`, premises, entailed);
      cases.push(mkCase({
        band: "INF-3", template: "b1DisjointVeto", variant: "class-control",
        arms: ["chat"], checkType: "isa",
        premises, query: `is a ${c1} a ${c4}`,
        expect: { verdict: "unproven", entailed },
        note: "The veto's minimal guard: a stored disjointness between other terms licenses nothing about this pair, so the honest floor is a refusal — an engine that over-fires the no fails here.",
      }));
    }
  }
  return cases;
}

// ======================================================================
// INF-4 — b2PropertyInheritance: a class-level possession teach ("every N1
// has a N2" — the quantified-has chat lane, storing mgx:hasA) read back
// directly and inherited by a member through ONE taught ⊑ hop, citing both
// premises. The grandparent cell drives the lift through TWO taught ⊑ hops —
// the does-have reader walks a bounded chain, so the row grades live with
// every premise cited. The control keeps the yes honest: membership of an unrelated class
// licenses nothing. Chat-arm only (the possession teach is a chat lane, not
// ACE, so the kernel never sees these premises), and the teach premises are
// unlinted for the same reason. Regular-plural nouns only: the teach lane's
// subject fold singularizes naively, and an s-final noun would store a
// clipped subject. And the pool is gated on the SAME wink-nlp POS check the
// teach lane's own subject gate applies (a single-token NOUN/PROPN tag): a
// noun lemma that doubles as a verb ("overbid" tags VERB) makes the teach
// decline, and the case would then grade whether the teach was accepted
// rather than whether possession is inherited — found live when the first
// 2.6.0 pass drew one. Load-bearing, exactly as the persona filter is.
// ======================================================================
function b2PropertyInheritance(rng) {
  const cases = [];
  const tagger = nlpAdapter();
  if (!tagger) {
    throw new Error("infbench/generate-cases.mjs: b2PropertyInheritance needs the wink-nlp POS adapter — the quantified-has teach gates its subject on it, so without it the template cannot pick teachable nouns");
  }
  const tagsAsNoun = (n) => { const [t] = tagger.posTags([n]); return t === "NOUN" || t === "PROPN"; };
  const pool = REGULAR_PLURAL_NOUNS.filter((n) => !PERSONA_SEED_TERMS.has(n) && tagsAsNoun(n));
  const shuffled = seededShuffle(pool, rng);
  let cursor = 0;
  for (let i = 0; i < 5; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 4);
    cursor = next;
    const [n1, n2, n1g, n3] = picked;
    const teach = `every ${n1} has a ${n2}`;
    cases.push(mkCase({
      band: "INF-4", template: "b2PropertyInheritance", variant: "class-direct",
      arms: ["chat"], checkType: "isa",
      premises: [teach], query: `does a ${n1} have a ${n2}`,
      expect: { verdict: "yes", entailed: [] },
      note: "The quantified-has teach read straight back: the stored class-level possession fact answers the direct existence question with its own citation.",
    }));
    {
      const ind = mintIndividual();
      const typePremise = `${ind} is a ${n1}`;
      const typeEntailed = [{ subject: ind, predicate: "rdf:type", object: n1 }];
      checkEntailed(`b2-prop-member-${i + 1}`, [typePremise], typeEntailed);
      cases.push(mkCase({
        band: "INF-4", template: "b2PropertyInheritance", variant: "member",
        arms: ["chat"], checkType: "isa",
        premises: [teach, typePremise], query: `does ${ind} have a ${n2}`,
        expect: { verdict: "yes", entailed: typeEntailed, proof: true },
        note: "Property inheritance through one taught ⊑ hop: the member inherits the class-level possession, and the answer cites both premises — the membership and the class fact.",
      }));
    }
    {
      const ind = mintIndividual();
      const premises = [`every ${n1g} has a ${n2}`, `every ${n1} is a ${n1g}`, `${ind} is a ${n1}`];
      const entailed = [
        { subject: n1, predicate: "rdfs:subClassOf", object: n1g },
        { subject: ind, predicate: "rdf:type", object: n1 },
      ];
      checkEntailed(`b2-prop-grand-${i + 1}`, [premises[1], premises[2]], entailed);
      cases.push(mkCase({
        band: "INF-4", template: "b2PropertyInheritance", variant: "grandparent",
        arms: ["chat"], checkType: "isa",
        premises, query: `does ${ind} have a ${n2}`,
        expect: { verdict: "yes", entailed, proof: true },
        note: "Property inheritance through TWO taught ⊑ hops: the does-have reader's bounded chain walk lifts past one hop, so the member inherits the grandparent class's possession with every premise cited.",
      }));
    }
    {
      const ind = mintIndividual();
      const typePremise = `${ind} is a ${n3}`;
      const typeEntailed = [{ subject: ind, predicate: "rdf:type", object: n3 }];
      checkEntailed(`b2-prop-ctl-${i + 1}`, [typePremise], typeEntailed);
      cases.push(mkCase({
        band: "INF-4", template: "b2PropertyInheritance", variant: "control",
        arms: ["chat"], checkType: "isa",
        premises: [teach, typePremise], query: `does ${ind} have a ${n2}`,
        expect: { verdict: "unproven", entailed: typeEntailed },
        note: "The member cell's minimal guard: membership of an unrelated class licenses nothing about the possession, so the honest floor is a refusal — a yes here inherits a property from a class the individual was never placed in.",
      }));
    }
  }
  return cases;
}

// ---- id assignment (mirrors chatbench's `g-${grade}-${slug}-${i+1}`) ----
const TEMPLATE_SLUG = {
  a1Lookup: "lookup", a2ChainLen2: "chain2", b1Disjoint: "disjoint",
  b1Existential: "existential",
  b2ChainLenK: "chaink", b2Svf1: "svf1", b2Svf1Apply: "svf1apply",
  c1Cardinality: "card", c1ScmSvfApply: "scmsvf", c2Inconsistent: "inconsistent",
  elConstructedRestriction: "elrestrict", elExistentialChain: "elchain",
  dlDisjunction: "dldisj", dlComplement: "dlcompl", dlDisjointProofSoundness: "dlsound",
  a1UniversalConditional: "conditional", a2Reflexive: "reflexive", a2Converse: "converse",
  a2EntailedRetraction: "retract", b1DisjointVeto: "disjveto", b2PropertyInheritance: "prophas",
};
function assignIds(cases) {
  const counters = new Map();
  for (const c of cases) {
    const slug = `${c.band.replace(/^INF-/, "").toLowerCase()}-${TEMPLATE_SLUG[c.template] || c.template.toLowerCase()}-${c.variant}`;
    const n = (counters.get(slug) ?? 0) + 1;
    counters.set(slug, n);
    c.id = `inf-${slug}-${String(n).padStart(3, "0")}`;
  }
}

/** Generate the full deterministic case set. Returns { cases, counts } —
 *  `counts` is the per-template count printed to console (the authoritative
 *  counts, mirroring generate-graded.mjs's printed per-cell counts). */
export function generateCases({ seed = DEFAULT_SEED } = {}) {
  individualCounter = 0; // per-invocation reset — deterministic within one run
  const rng = mulberry32(seed ^ fnv1a("infbench"));
  const groups = {
    a1Lookup: a1Lookup(rng),
    a2ChainLen2: a2ChainLen2(rng),
    b1Disjoint: b1Disjoint(rng),
    b1Existential: b1Existential(rng),
    b2ChainLenK: b2ChainLenK(rng),
    b2Svf1: b2Svf1(rng),
    b2Svf1Apply: b2Svf1Apply(rng),
    c1Cardinality: c1Cardinality(rng),
    c1ScmSvfApply: c1ScmSvfApply(rng),
    c2Inconsistent: c2Inconsistent(rng),
    elConstructedRestriction: elConstructedRestriction(rng),
    elExistentialChain: elExistentialChain(rng),
    dlDisjunction: dlDisjunction(rng),
    dlComplement: dlComplement(rng),
    dlDisjointProofSoundness: dlDisjointProofSoundness(rng),
    // The templates below are appended AFTER every earlier template on
    // purpose: all templates draw from one shared rng stream, so appending is
    // what keeps every earlier template's rows byte-stable across versions.
    a1UniversalConditional: a1UniversalConditional(rng),
    a2Reflexive: a2Reflexive(rng),
    a2Converse: a2Converse(rng),
    a2EntailedRetraction: a2EntailedRetraction(rng),
    b1DisjointVeto: b1DisjointVeto(rng),
    b2PropertyInheritance: b2PropertyInheritance(rng),
  };
  const all = Object.values(groups).flat();
  assignIds(all);
  return { cases: all, counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) };
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { seed: DEFAULT_SEED, out: DEFAULT_OUT },
    flags: {
      "--seed": { key: "seed", value: Number },
      "--out": { key: "out" },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!Number.isFinite(args.seed)) { console.error("--seed must be a number"); return 2; }
  let cases, counts;
  try {
    ({ cases, counts } = generateCases({ seed: args.seed }));
  } catch (e) {
    console.error(`infbench/generate-cases.mjs: FIXTURE LINT FAILED — ${e.message}`);
    return 1;
  }
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${cases.map((c) => JSON.stringify(c)).join("\n")}\n`);
  console.log(`infbench/generate-cases.mjs — seed ${args.seed} — ${cases.length} case(s) written to ${args.out}`);
  console.log("per-template counts (the authoritative counts):");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(16)} ${v}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
