// infbench/generate-cases.mjs — the deterministic INFBENCH case generator
// (PLAN_INFERENCE_TESTING.md §2.2), mirroring chatbench/generate-graded.mjs's
// mechanism for a structurally simpler fixture: INF-A1..C2's premises/queries
// are STRUCTURAL (a chain of length k, a disjoint pair, a cardinality n), so
// `expect` is a PURE FUNCTION of each template's own parameters — never a
// replay of the engine (the zero-fabrication anti-circularity discipline,
// PLAN_INFERENCE_TESTING.md §2.1/§2.2). The only thing this file does with
// TODAY's engine is the FIXTURE LINT: every premise must `parseAce` to a clean
// hit (non-null, residue: []) against the committed lexicon — a premise the
// grammar can't hold fails LOUD at generation time (throws), never silently.
//
// Fixture: the committed common-noun lexicon (src/grammar/lexicon-core.json)
// as class/relation vocabulary, plus synthetic individuals exploiting the
// tokenizer's CODE_REF rule (src/grammar/ace.mjs:42,71-72: any token containing
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

import { parseAce } from "../src/grammar/ace.mjs";
import { loadLexicon, thirdPerson } from "../src/grammar/lexicon.mjs";
import { normFactTerm } from "../src/memory/core.mjs";
import { fnv1a32 as fnv1a } from "../src/hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

export const DEFAULT_SEED = 20260707; // today's date (PLAN_INFERENCE_TESTING.md §2.2's "default recorded in the generator")
export const DEFAULT_OUT = join(HERE, "cases.jsonl");

// ---- deterministic PRNG (mulberry32, Fisher-Yates) — mirrors
// chatbench/graded.mjs's mechanism; a local copy so infbench stays a
// self-contained sibling of agentbench, never importing chatbench internals. ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seededShuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- fixture: the committed lexicon's class-noun vocabulary ----
// PLAN_OSS_ACE_PARSER.md's ace-owl extraction (landed concurrently with this
// dispatch) moved the canonical lexicon-core.json out of src/grammar/ into
// the extracted workspace package — src/grammar/lexicon.mjs's own header
// comment: "this repo no longer carries its own lexicon-core.json". Same
// file, same vocabulary, new home.
const LEXICON_PATH = join(ROOT, "packages", "ace-owl", "src", "lexicon-core.json");
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
// INF-A1 — a1Lookup: 1 noun × {subClassOf, typeAssertion, possessive}
// ======================================================================
function a1Lookup(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;

  // subClassOf: "every N1 is a N2" -> "is a N1 a N2" (direct lookup, zero
  // inference — Rules needed: none, per §1's INF-A1 row).
  for (let i = 0; i < 10; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const premises = [`every ${n1} is a ${n2}`];
    const query = `is a ${n1} a ${n2}`;
    const entailed = [{ subject: n1, predicate: "rdfs:subClassOf", object: n2 }];
    checkEntailed(`a1-scoa-${i + 1}`, premises, entailed);
    cases.push(mkCase({
      band: "INF-A1", template: "a1Lookup", variant: "subClassOf",
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
      band: "INF-A1", template: "a1Lookup", variant: "typeAssertion",
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
      band: "INF-A1", template: "a1Lookup", variant: "possessive",
      arms: ["chat"], checkType: "recall",
      premises, query, expect: { mentions: [owned], entailed },
    }));
  }

  return cases;
}

// ======================================================================
// INF-A2 — a2ChainLen2: 2-hop noun chain × {taught-only, graph-bridge}
// ======================================================================
function a2ChainLen2(rng) {
  const cases = [];
  const shuffled = seededShuffle(CLASS_NOUNS, rng);
  let cursor = 0;

  // taught-only: "every N1 is a N2", "every N2 is a N3" -> "is a N1 a N3".
  // KERNEL PASSES (deriveSubClassClosure chains it); CHAT is the honest gap
  // (§1: "cax-sco over two TAUGHT facts is NOT implemented" — verified live,
  // see INFBENCH_<version>.md).
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
      band: "INF-A2", template: "a2ChainLen2", variant: "taught-only",
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
      band: "INF-A2", template: "a2ChainLen2", variant: "graph-bridge",
      arms: ["chat"], checkType: "isa",
      premises, query, graph, expect: { verdict: "yes", entailed },
    }));
  }

  return cases;
}

// ======================================================================
// INF-B1 — b1Disjoint: 1 disjoint pair × {direct, 1-hop lifted, control}
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
        band: "INF-B1", template: "b1Disjoint", variant: "direct-member",
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
        band: "INF-B1", template: "b1Disjoint", variant: "lifted-member",
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
        band: "INF-B1", template: "b1Disjoint", variant: "control",
        arms: ["chat"], checkType: "isa",
        premises, query, expect: { verdict: "unproven", entailed },
      }));
    }
  }

  return cases;
}

// ======================================================================
// INF-B2 — b2ChainLenK (chain length 3/4/5) — GENERATED NOW, run against a
// not-yet-implemented capability: PLAN_INFERENCE_TESTING.md §2.2/§2.4/§3 all
// independently mandate expect stays the honest "unproven" ceiling for the
// whole band (proof-chain materialization, §4 stage 2, is what's missing —
// see the note field for why this differs from a bare true/false ground
// truth judgement).
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
        band: "INF-B2", template: "b2ChainLenK", variant: `chain-${k}`,
        arms: ["chat"], checkType: "isa",
        premises, query, expect: { verdict: "unproven", entailed, proof: true },
        note: "ceiling by construction (PLAN_INFERENCE_TESTING.md §2.2/§3): the chained subject-object pair is classically PROVABLE (scm-sco transitivity), but INF-B2 grades the chat-layer's multi-hop + proof-chain-materialization capability (§4 stage 2), which does not exist yet — expect stays the honest 'cannot be proven' floor until it does. The KERNEL closure (src/syllogise.mjs) already derives this correctly; this template deliberately runs CHAT-arm only so that correctness is never miscounted as fabrication against a declared-ceiling literal.",
      }));
    }
  }
  return cases;
}

// ---- INF-B2 — b2Svf1: someValuesFrom triple. Genuinely unproven even for a
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
      band: "INF-B2", template: "b2Svf1", variant: "svf1",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      note: "genuinely unproven for ANY engine (not merely today's): a someValuesFrom restriction does not license the plain subclass query — an honest floor, doubling as cls-svf1's expressibility witness (§1).",
    }));
  }
  return cases;
}

// ---- INF-B2 — b2Svf1Apply: a genuinely POSITIVE instance-level cls-svf1
// application, added per a strategy-advisor feasibility pass (2026-07-10):
// b2ChainLenK's 30 cases are pure scm-sco chain-transitivity ceilings whose
// blocker is proof-chain materialization (§4 stage 2), not cls-svf1; b2Svf1's
// 10 cases are PERMANENTLY unproven negative witnesses (see its own note,
// above) that can never flip to "yes" no matter what engine ships — so
// neither template gave a real cls-svf1 implementation anything to move.
// This template does: "every N1 that VERBs a N2 is a N3" + "IND1 VERBs IND2"
// + "IND2 is a N2" ⊨ "IND1 is a some-VERB-N2" — the restriction CLASS itself
// (cls-svf1's actual conclusion, `src/syllogise.mjs`'s `deriveSomeValuesFromApplication`),
// NOT the further "IND1 is a N3" intersection step (that needs cls-int1 +
// cax-sco too — out of this stage's scope, see `src/syllogise.mjs`'s header
// comment). The query asks about the restriction node's own readable term
// directly ("is IND1 a some-imports-test"), which is not a lexicon noun, so
// `chat.mjs` (out of scope for this dispatch, and not equipped to answer a
// query about a synthetic restriction-node term today regardless) is never
// going to parse it as an ISA question — this template therefore declares
// `arms: ["kernel"]` ONLY, checked directly against `src/syllogise.mjs`'s
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
      band: "INF-B2", template: "b2Svf1Apply", variant: "positive",
      arms: ["kernel"], checkType: "isa",
      premises, query, expect: { verdict: "yes", entailed, proof: true },
      note: "cls-svf1's actual positive conclusion (PLAN_INFERENCE_TESTING.md §4 stage 4): the restriction CLASS itself, not the further owl:intersectionOf step to N3 — a deliberately narrower, honestly-scoped claim than the original worked example's 'is chat.mjs a suite'. kernel-arm only: the query names a synthetic restriction node term, which chat.mjs was never taught to answer (and is out of scope for this dispatch either way).",
    }));
  }
  return cases;
}

// ======================================================================
// INF-C1 — c1Cardinality: (exactly n, queried min m≤n) / (max 0, existence)
// GENERATED NOW, ceiling until §4 stage 4 (cardinality entailment rules).
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
    const m = 1 + (i % n); // 1..n
    const premises = [`every ${n1} has exactly ${n} ${plural(n2)}`];
    const query = `does every ${n1} have at least ${m} ${m === 1 ? n2 : plural(n2)}`;
    checkEntailed(`c1-exact-${i + 1}`, premises, []);
    cases.push(mkCase({
      band: "INF-C1", template: "c1Cardinality", variant: "exactly-min",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      note: "cardinality monotonicity (exactly n ⊢ min m≤n) is real classical entailment, but no cardinality rule is implemented — ceiling until §4 stage 4.",
    }));
  }
  for (let i = 0; i < 15; i += 1) {
    const { picked, next } = pickClean(shuffled, cursor, 2);
    cursor = next;
    const [n1, n2] = picked;
    const premises = [`every ${n1} has at most 0 ${plural(n2)}`];
    const query = `does a ${n1} have a ${n2}`;
    checkEntailed(`c1-max0-${i + 1}`, premises, []);
    cases.push(mkCase({
      band: "INF-C1", template: "c1Cardinality", variant: "max0",
      arms: ["chat"], checkType: "isa",
      premises, query, expect: { verdict: "unproven", entailed: [] },
      note: "found capability (§5): 'has at most 0' parses today as an honest encoded negation (owl:maxCardinality 0), but no rule yet CONSUMES it to answer the existence query — ceiling until §4 stage 4.",
    }));
  }
  return cases;
}

// ======================================================================
// INF-C2 — c2Inconsistent: contradictory triple, SAME b1Disjoint machinery.
// GENERATED NOW, ceiling until §4 stage 5 (consistency checker).
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
      band: "INF-C2", template: "c2Inconsistent", variant: "inconsistent",
      arms: ["chat"], checkType: "inconsistent",
      premises, query, expect: { verdict: "inconsistent", entailed, clash: [c1, c2] },
      note: "known by construction (§5): the clash is the template's own declared disjoint pair, pinned at generation time — ceiling until §4 stage 5 (consistency checker); the engine today answers from the (contradictory) memory without noticing.",
    }));
  }
  return cases;
}

// ---- id assignment (mirrors chatbench's `g-${grade}-${slug}-${i+1}`) ----
const TEMPLATE_SLUG = {
  a1Lookup: "lookup", a2ChainLen2: "chain2", b1Disjoint: "disjoint",
  b2ChainLenK: "chaink", b2Svf1: "svf1", b2Svf1Apply: "svf1apply",
  c1Cardinality: "card", c2Inconsistent: "inconsistent",
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
    b2ChainLenK: b2ChainLenK(rng),
    b2Svf1: b2Svf1(rng),
    b2Svf1Apply: b2Svf1Apply(rng),
    c1Cardinality: c1Cardinality(rng),
    c2Inconsistent: c2Inconsistent(rng),
  };
  const all = Object.values(groups).flat();
  assignIds(all);
  return { cases: all, counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])) };
}

function parseArgs(argv) {
  const args = { seed: DEFAULT_SEED, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
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
