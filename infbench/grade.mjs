// infbench/grade.mjs — the DETERMINISTIC grading core for INFBENCH (sibling of
// agentbench/grade.mjs, PLAN_INFERENCE_TESTING.md §2.1/§3).
//
// INFBENCH grades classical-logic competence on a 6-band ladder (INF-A1..C2,
// PLAN_INFERENCE_TESTING.md §1) with AGENTBENCH's ruler: no LLM judge, no
// re-derivation — every case's `expect` is a STATIC literal pinned at
// generation time (infbench/generate-cases.mjs), so grading is a pure
// COMPARISON, never a replay of the engine testing itself.
//
// TWO DRIVE POINTS (§2.1):
//   - kernel: calls src/domain/syllogise.mjs's pure provers directly over the
//     premises' own emitted triples — deriveSubClassClosure (subClassOf
//     transitivity), deriveSomeValuesFromApplication (cls-svf1 restriction
//     membership), and, as of this build, deriveSomeValuesFromSubsumption
//     (scm-svf1 restriction-to-restriction subsumption), proveCardinalityAtLeast
//     (cardinality monotonicity), and proveMaxCardinalityZeroDenial (cax-maxc0)
//     — blind to the codegraph. Only meaningful for cases whose `arms` declares
//     "kernel": a1Lookup/subClassOf and a2ChainLen2/taught-only (pure
//     class-to-class subClassOf questions), b2Svf1Apply (the cls-svf1
//     positive template — its query asks about the restriction node itself,
//     deliberately checked HERE rather than via chat.mjs, which an earlier
//     dispatch did not touch; see generate-cases.mjs's own comment on that
//     template), c1ScmSvfApply (scm-svf1's positive template — a plain
//     restriction-to-restriction "is X a Y" ask, so BOTH arms apply, unlike
//     b2Svf1Apply), and c1Cardinality (both variants, fixed in place this
//     build — see generate-cases.mjs). Every other template is outside the
//     kernel's actual domain by construction, so it is never asked one — see
//     generate-cases.mjs's per-template `arms`. Unlike every other rule this
//     kernel arm exercises, the kernel CAN now return "no" (cax-maxc0) —
//     `gradeKernelRow`'s fabrication check is symmetric accordingly (see its
//     own comment).
//   - chat: interprets a real runTurn/runChat transcript (driven by
//     infbench/run.mjs) via the turn's own `miss` flag — the SAME honest-miss
//     signal chat.mjs itself computes (recordMiss), not a text-pattern guess.
//
// The honest gate (§1's "Pass criterion per band", mirroring AGENTBENCH):
// completion >= COMPLETION_FLOOR (50%) AT 0% fabrication. Fabrication = a
// confident directional verdict ("yes"/"no") that isn't the pinned literal —
// the automatic FAIL, exactly agentbench's hallucinated-call gate.

import {
  deriveSubClassClosure, deriveSomeValuesFromApplication, deriveSomeValuesFromSubsumption,
  buildCardinalityRestrictions, proveCardinalityAtLeast, proveMaxCardinalityZeroDenial,
} from "../src/domain/syllogise.mjs";
import { parseAce } from "../src/domain/grammar/ace.mjs";
import { loadLexicon } from "../src/domain/grammar/lexicon.mjs";
import { normFactTerm } from "../src/adapters/memory/core.mjs";
import { parseJsonlRows } from "../benchlib/bench.mjs";

// ---- the bands (the classical-logic ladder — INF-A1 -> INF-C2) ----
export const BANDS = Object.freeze(["INF-A1", "INF-A2", "INF-B1", "INF-B2", "INF-C1", "INF-C2"]);
export const ARMS = Object.freeze(["kernel", "chat"]);
export const CHECK_TYPES = Object.freeze(["isa", "recall", "inconsistent"]);
export const VERDICTS = Object.freeze(["yes", "no", "unproven", "inconsistent"]);

/** The honest-gate completion floor (mirrors agentbench/grade.mjs's
 *  COMPLETION_FLOOR — a refuse/miss-everything driver scores 0% fabrication
 *  but ~0% completion and so fails the gate). */
export const COMPLETION_FLOOR = 0.5;

// ---- case lint (schema-shape only — the SEMANTIC lint (parseAce cleanliness,
// the referential entailed-literal check) already ran at generation time in
// generate-cases.mjs; this mirrors agentbench's parseCases as a defense-in-
// depth check over the COMMITTED file, catching drift/hand-editing). ----
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function parseCases(text) {
  return parseJsonlRows(text, (c, cases, errors, at) => {
    if (!BANDS.includes(c.band)) errors.push(`${c.id}: band must be one of ${BANDS.join("|")}`);
    if (!c.template || typeof c.template !== "string") errors.push(`${c.id}: missing template`);
    if (!c.variant || typeof c.variant !== "string") errors.push(`${c.id}: missing variant`);
    if (!Array.isArray(c.arms) || !c.arms.length || c.arms.some((a) => !ARMS.includes(a))) {
      errors.push(`${c.id}: arms must be a non-empty subset of ${ARMS.join("|")}`);
    }
    if (!CHECK_TYPES.includes(c.checkType)) errors.push(`${c.id}: checkType must be one of ${CHECK_TYPES.join("|")}`);
    if (!Array.isArray(c.premises) || !c.premises.length || c.premises.some((p) => typeof p !== "string")) {
      errors.push(`${c.id}: premises must be a non-empty array of strings`);
    }
    if (!c.query || typeof c.query !== "string") errors.push(`${c.id}: missing query`);
    if (!isPlainObject(c.expect)) { errors.push(`${c.id}: missing expect`); return; }
    if (c.checkType === "recall") {
      if (!Array.isArray(c.expect.mentions) || !c.expect.mentions.length) errors.push(`${c.id}: expect.mentions must be a non-empty array for a recall case`);
    } else if (!VERDICTS.includes(c.expect.verdict)) {
      errors.push(`${c.id}: expect.verdict must be one of ${VERDICTS.join("|")}`);
    }
    if (c.graph && !isPlainObject(c.graph)) errors.push(`${c.id}: graph must be an object (a raw entities payload fragment)`);
    if (c.ceiling !== undefined && (typeof c.ceiling !== "string" || !c.ceiling.trim())) {
      errors.push(`${c.id}: ceiling must be a non-empty string naming the capability that would lift it`);
    }
    cases.push(c);
  });
}

// ---- kernel arm: the pure closure/prover — subClassOf transitivity AND -----
// ---- (as of PLAN_INFERENCE_TESTING.md §4 stage 4) cls-svf1 someValuesFrom --
// ---- restriction membership, over the premises' own emitted triples --------

/** The canonical "is X a Y" query surface every generated case uses. Shared
 *  by the kernel's own (bench-side) query interpretation — NOT by the chat
 *  arm, which never parses text: it reads chat.mjs's own `miss` flag. Also
 *  doubles as the cls-svf1/scm-svf1 templates' query surface: "Y" there is a
 *  restriction node's own readable term (e.g. "some-imports-test"), a plain
 *  string with no spaces, so the same "is X a Y" shape parses it unchanged —
 *  no second query grammar needed. */
const QUERY_RE = /^is\s+(?:an?\s+)?(.+?)\s+an?\s+(.+?)[?.!\s]*$/i;

/** The two NEW cardinality ask-shapes (this build) — mirrors src/services/chat.mjs's
 *  own CARD_AT_LEAST_ASK_RE/CARD_EXISTENCE_ASK_RE exactly (same surface, two
 *  independent copies: this one is bench-side and pure, chat.mjs's is the
 *  product-side live-chat reader — no shared import between them, same
 *  discipline as QUERY_RE above already keeping bench-side query parsing
 *  separate from chat.mjs's own regexes). */
const CARD_AT_LEAST_KERNEL_RE = /^does\s+every\s+(.+?)\s+have\s+at\s+least\s+(\d+)\s+(.+?)[?.!\s]*$/i;
const CARD_EXISTENCE_KERNEL_RE = /^does\s+an?\s+(.+?)\s+have\s+an?\s+(.+?)[?.!\s]*$/i;

/** The 4 pattern-5 cardinality-restriction predicates (buildCardinalityRestrictions'
 *  own input shape) — excluded from the generic `propertyEdges` scan below,
 *  matching how `owl:intersectionOf` is already excluded (neither is a real
 *  taught object-property assertion). owl:onProperty is handled separately
 *  (it's shared scaffolding between someValuesFrom AND cardinality
 *  restrictions — see src/domain/syllogise.mjs's `buildCardinalityRestrictions` doc
 *  comment on the HAS_PROPERTY_KEY defensive belt). */
const CARDINALITY_ROW_PREDICATES = new Set(["owl:cardinality", "owl:minCardinality", "owl:maxCardinality", "owl:onClass"]);

/** Naive singular fold for a queried noun phrase that may be plural
 *  ("does every suite have at least 2 tests" — the object noun is pluralized
 *  when m>1) — mirrors src/services/chat.mjs's own `factTermVariants` exactly (a
 *  self-contained copy: grade.mjs is bench-side and doesn't import chat.mjs). */
function singularCandidates(term) {
  const t = normFactTerm(term);
  const v = new Set([t]);
  if (t.endsWith("es")) v.add(t.slice(0, -2));
  if (t.endsWith("s")) v.add(t.slice(0, -1));
  return v;
}

/** Kernel verdict for one case: null when the case's `arms` does not declare
 *  "kernel" (not applicable — see file header); otherwise "yes" (the query's
 *  (subject,object) pair is present, subClassOf-derivable, a directly stated
 *  rdf:type, cls-svf1-derivable, or scm-svf1-derivable from the premises' own
 *  triples), "no" (cax-maxc0: a declared max-0 restriction denies the queried
 *  existence claim), or "unproven" (the kernel's domain cannot see it — an
 *  honest structural ceiling, e.g. it has no notion of the codegraph or of
 *  disjointWith/the further owl:intersectionOf step past cls-svf1). Pure; no
 *  I/O — this is a bench-side check over `src/domain/syllogise.mjs`'s pure kernels
 *  directly, deliberately NOT going through `chat.mjs` for the cls-svf1/
 *  scm-svf1 restriction-node query shapes (out of an earlier dispatch's
 *  scope — see the cls-svf1 template's own generator comment; c1ScmSvfApply's
 *  query, by contrast, names no individual at all and IS also chat-arm
 *  checked, per its own generator comment). */
export function kernelVerdict(caseDef) {
  if (!(caseDef.arms || []).includes("kernel")) return null;
  const lexicon = loadLexicon();
  const subClassEdges = [];
  const typeEdges = [];
  const propertyEdges = [];
  const onPropertyOf = new Map();     // restriction -> owl:onProperty's (normalized) object
  const someValuesFromOf = new Map(); // restriction -> owl:someValuesFrom's (normalized) object
  const cardinalityRows = [];         // buildCardinalityRestrictions' own input shape
  for (const premise of caseDef.premises || []) {
    const parsed = parseAce(premise, lexicon);
    for (const t of parsed?.triples || []) {
      const s = normFactTerm(t.subject);
      const o = normFactTerm(t.object);
      if (t.predicate === "rdfs:subClassOf") subClassEdges.push([s, o]);
      else if (t.predicate === "rdf:type") typeEdges.push([s, o]);
      else if (t.predicate === "owl:onProperty") { onPropertyOf.set(s, o); cardinalityRows.push({ subject: s, predicate: t.predicate, object: o }); }
      else if (t.predicate === "owl:someValuesFrom") someValuesFromOf.set(s, o);
      else if (CARDINALITY_ROW_PREDICATES.has(t.predicate)) cardinalityRows.push({ subject: s, predicate: t.predicate, object: o });
      else if (t.predicate !== "owl:intersectionOf") propertyEdges.push([s, t.predicate, o]);
    }
  }

  const restrictionEdges = [];
  for (const [restriction, property] of onPropertyOf) {
    const target = someValuesFromOf.get(restriction);
    if (target) restrictionEdges.push({ restriction, property, target });
  }
  // scm-svf1 (this build): enlarge subClassEdges with restriction⊑restriction
  // subsumption BEFORE the final deriveSubClassClosure re-check below, so
  // c1ScmSvfApply's kernel query ("is R1 a R2", a restriction-to-restriction
  // ask) passes through the SAME machinery every other subClassOf query
  // already uses, unchanged.
  const svfSubsumption = restrictionEdges.length > 1
    ? deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, {})
    : [];
  const enlargedSubClassEdges = svfSubsumption.length
    ? subClassEdges.concat(svfSubsumption.map((d) => [d.subject, d.object]))
    : subClassEdges;
  const cardinalityRestrictionEdges = buildCardinalityRestrictions(cardinalityRows);

  const isaMatch = String(caseDef.query || "").match(QUERY_RE);
  if (isaMatch) {
    const subj = normFactTerm(isaMatch[1]);
    const obj = normFactTerm(isaMatch[2]);
    if (enlargedSubClassEdges.some(([a, b]) => a === subj && b === obj)) return "yes";
    const derivedSco = deriveSubClassClosure(enlargedSubClassEdges, {});
    if (derivedSco.some((d) => d.subject === subj && d.object === obj)) return "yes";
    if (typeEdges.some(([a, b]) => a === subj && b === obj)) return "yes";
    if (restrictionEdges.length) {
      const derivedSvf1 = deriveSomeValuesFromApplication(propertyEdges, typeEdges, enlargedSubClassEdges, restrictionEdges, {});
      if (derivedSvf1.some((d) => d.subject === subj && d.object === obj)) return "yes";
    }
    return "unproven";
  }
  const cardAtLeast = String(caseDef.query || "").match(CARD_AT_LEAST_KERNEL_RE);
  if (cardAtLeast) {
    const subj = normFactTerm(cardAtLeast[1]);
    const mQ = Number(cardAtLeast[2]);
    for (const obj of singularCandidates(cardAtLeast[3])) {
      if (proveCardinalityAtLeast(enlargedSubClassEdges, cardinalityRestrictionEdges, subj, obj, mQ, {})) return "yes";
    }
    return "unproven";
  }
  const cardExistence = String(caseDef.query || "").match(CARD_EXISTENCE_KERNEL_RE);
  if (cardExistence) {
    const subj = normFactTerm(cardExistence[1]);
    for (const obj of singularCandidates(cardExistence[2])) {
      if (proveMaxCardinalityZeroDenial(enlargedSubClassEdges, cardinalityRestrictionEdges, subj, obj, {})) return "no";
    }
    return "unproven";
  }
  return "unproven";
}

/** Grade the kernel arm of one case, or null when not applicable (arms lacks
 *  "kernel"). fabricated = a CONFIDENT directional verdict ("yes"/"no") that
 *  isn't the pinned literal — the SAME symmetric definition `gradeChatRow`
 *  already uses. Was asymmetric (yes-only) before this build, when the
 *  kernel had no rule that could ever produce "no" at all; cax-maxc0 changes
 *  that (see kernelVerdict's own doc comment), so the check widens to match. */
export function gradeKernelRow(caseDef) {
  const observed = kernelVerdict(caseDef);
  if (observed == null) return null;
  const expected = caseDef.expect.verdict;
  const pass = observed === expected;
  const fabricated = (observed === "yes" || observed === "no") && observed !== expected;
  return { pass, fabricated, completed: pass, observed, expected };
}

// ---- chat arm: interpret a real runTurn/runChat transcript --------------

const INCONSISTENT_RE = /inconsist|contradict|(?:^|\W)conflict|clash|can'?t both|cannot both/i;
const LEADING_YES_RE = /^\W*yes\b/i;
const LEADING_NO_RE = /^\W*no\b/i;

/** Interpret an "isa"-checkType chat outcome ({ answer, miss }) into an
 *  observed verdict. The AUTHORITATIVE signal is chat.mjs's own `miss` flag
 *  (recordMiss) — not text pattern matching: a miss is ALWAYS "unproven"
 *  regardless of the specific honest-refusal phrasing chat.mjs used (there
 *  are several: "couldn't parse…", "couldn't resolve…", "the graph … is
 *  empty…" — verified live during authoring, infbench spike). A non-miss
 *  answer is read for its leading yes/no (chat.mjs's own answer convention,
 *  "yes — …" / "no — …", verified live) or an inconsistency admission. */
export function interpretIsaAnswer({ answer, miss }) {
  const a = String(answer ?? "");
  if (INCONSISTENT_RE.test(a)) return "inconsistent";
  if (miss === false && LEADING_YES_RE.test(a)) return "yes";
  if (miss === false && LEADING_NO_RE.test(a)) return "no";
  if (miss !== false) return "unproven"; // miss === true, or no record at all
  return "unclear"; // a non-miss answer without a clear lead — should not occur for isa queries in practice
}

/** Interpret a "recall"-checkType chat outcome: pass iff the turn was not a
 *  miss and the answer mentions every pinned literal (normFactTerm-normalized
 *  substring match — the same term-normalization the memory store itself
 *  applies, so "E02.mjs" in a rendered fact line still matches "e02.mjs"). */
function interpretRecallAnswer({ answer, miss }, mentions) {
  const a = normFactTerm(String(answer ?? ""));
  if (miss !== false) return false;
  return (mentions || []).every((m) => a.includes(normFactTerm(m)));
}

/** Interpret an "inconsistent"-checkType chat outcome: "inconsistent" iff the
 *  answer admits the clash; otherwise "unproven" — a plain fact-echo/miss is
 *  an honest INCOMPLETE (the consistency checker doesn't exist yet, §4 stage
 *  5), never a fabrication, because this query shape never produces a
 *  directional yes/no verdict (see file header). */
function interpretInconsistentAnswer({ answer }) {
  return INCONSISTENT_RE.test(String(answer ?? "")) ? "inconsistent" : "unproven";
}

/** Grade the chat arm of one case against its driven outcome
 *  ({ answer, miss }, from infbench/run.mjs's runChat drive). Always
 *  applicable (chat is the universal mouth — every case declares "chat" in
 *  `arms`). Returns { pass, fabricated, completed, observed }. */
export function gradeChatRow(caseDef, outcome) {
  const expect = caseDef.expect;

  if (caseDef.checkType === "recall") {
    const pass = interpretRecallAnswer(outcome, expect.mentions);
    return { pass, fabricated: false, completed: pass, observed: pass ? "yes" : (outcome.miss === false ? "unclear" : "unproven") };
  }

  if (caseDef.checkType === "inconsistent") {
    const observed = interpretInconsistentAnswer(outcome);
    const pass = observed === "inconsistent";
    return { pass, fabricated: false, completed: pass, observed };
  }

  // checkType "isa"
  const observed = interpretIsaAnswer(outcome);
  const pass = observed === expect.verdict;
  // fabrication: a CONFIDENT directional verdict (yes/no) that is not the
  // pinned one — includes the dangerous case of asserting yes/no on a case
  // whose honest floor is "unproven" (an honest-refusal cell, §2.1), and the
  // directionally-wrong case (expected "no", produced "yes" or vice versa).
  const fabricated = (observed === "yes" || observed === "no") && observed !== expect.verdict;
  return { pass, fabricated, completed: pass, observed };
}

// ---- per-band METRIC PAIR + ladder rollup (mirrors agentbench/grade.mjs) --

// A case carrying `ceiling` expects the engine's honest floor, not the
// classical answer, so its green says "we agreed not to test this yet" while
// looking exactly like a green that says "we can do this". Counting the two
// apart is the difference between a band score and a band score you can read:
// a 100% band made entirely of ceiling-graded rows measures nothing about the
// capability its name implies.
function tallyOne(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const completed = rows.filter((r) => r.completed).length;
  const fabricated = rows.filter((r) => r.fabricated).length;
  const ceilingGraded = rows.filter((r) => r.ceiling).length;
  const ceilingGradedPassed = rows.filter((r) => r.ceiling && r.pass).length;
  const completion = total ? completed / total : 0;
  const fabricationRate = total ? fabricated / total : 0;
  return {
    total, passed, completed, fabricated, completion, fabricationRate,
    ceilingGraded, ceilingGradedPassed,
    gatePass: fabricationRate === 0 && completion >= COMPLETION_FLOOR,
  };
}

/** The distinct capabilities the ceiling-graded rows of one arm are waiting on,
 *  per band — the legend behind the ceiling column. */
export function ceilingCapabilities(rows) {
  const byBand = {};
  for (const row of rows) {
    if (!row.ceiling) continue;
    (byBand[row.band] ??= new Set()).add(row.ceiling);
  }
  return Object.fromEntries(Object.entries(byBand).map(([band, set]) => [band, [...set].sort()]));
}

/** Fold graded rows (one arm's — kernel or chat) into { byBand, overall }. */
export function rollup(rows) {
  const byBand = {};
  for (const band of BANDS) {
    const of = rows.filter((r) => r.band === band);
    if (of.length) byBand[band] = tallyOne(of);
  }
  return { byBand, overall: tallyOne(rows) };
}

/** Ladder gating (mirrors agentbench/grade.mjs's ladderGate): bands run
 *  INF-A1 -> INF-C2; the FIRST band failing the honest gate (0% fabrication
 *  at >= COMPLETION_FLOOR completion) gates every band above it, reported
 *  skipped-with-a-receipt. A 0%-completion band is a CEILING MARKER, not a
 *  failure (PLAN_INFERENCE_TESTING.md §3, ROADMAP L256). */
export function ladderGate(rolled) {
  const receipts = [];
  let gatedAt = null;
  for (const band of BANDS) {
    const cell = rolled.byBand[band];
    if (!cell) continue;
    if (gatedAt) { receipts.push({ band, reason: `gated by ${gatedAt}` }); continue; }
    if (!cell.gatePass) {
      gatedAt = cell.fabricationRate > 0
        ? `${band} fabrication ${(cell.fabricationRate * 100).toFixed(0)}%`
        : `${band} completion ${(cell.completion * 100).toFixed(0)}% < ${(COMPLETION_FLOOR * 100).toFixed(0)}%`;
    }
  }
  return { order: BANDS.filter((b) => rolled.byBand[b]), gatedAt, receipts };
}

/** Human-readable metric-pair table for one arm's rollup. The ceiling column
 *  reads "<ceiling-graded passes>/<passes>" — how much of the band's green is
 *  the engine's declared floor rather than its capability. */
export function renderRollup(rolled, label = "") {
  const row = (l, c) =>
    `${l.padEnd(9)} ${String(c.total).padStart(3)}  ${String(c.passed).padStart(4)}  ` +
    `${(c.completion * 100).toFixed(0).padStart(10)}%  ${(c.fabricationRate * 100).toFixed(0).padStart(6)}%  ${c.gatePass ? "PASS" : "----"}` +
    `  ${`${c.ceilingGradedPassed}/${c.passed}`.padStart(11)}`;
  const lines = [`${label ? `${label} — ` : ""}band       n  pass  completion  fabric  gate  ceiling/pass`];
  for (const band of BANDS) {
    const c = rolled.byBand[band];
    if (c) lines.push(row(band, c));
  }
  lines.push(row("all", rolled.overall));
  return lines.join("\n");
}
