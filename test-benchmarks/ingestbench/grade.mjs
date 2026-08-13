// ingestbench/grade.mjs — the DETERMINISTIC grading core for INGESTBENCH
// (sibling of infbench/grade.mjs and agentbench/grade.mjs). INGESTBENCH grades
// fact-extraction FIDELITY on the ING-0..ING-9 ladder: does a document's meaning
// arrive in the store as correct canonical statements, with real facts kept and
// no wrong facts invented.
//
// Grading is deterministic value-compare at and below ING-7 (ingestText's stored
// triples folded to canonical form, set-compared to the case's pinned expected
// statements) — no LLM, no network. ING-7 adds a deterministic equivalence check
// (verifyCanonicalRestatement, seeded from src/domain/paraphrase.mjs's
// verifySubClassParaphrase and a parseAce re-parse). ING-8/ING-9 are judged
// meaning-preservation (ingestbench/judge.mjs) — those cases carry grade:"judged"
// and are scored elsewhere, never here.
//
// The metric set per rung is precision and recall on facts, broken into the four
// failure classes the extraction playtests hunt: missed-useful (a recall miss —
// the honest side), fabricated / confused / greedy-span (precision failures —
// every one a WRONG FACT). The honest gate mirrors every sibling ladder: a rung
// PASSES iff ZERO wrong facts AT >= COMPLETION_FLOOR recall of the rung's
// expected statements. A correct abstain (expect.abstain, storing nothing) counts
// toward the pass. The first rung failing the gate gates every rung above it.

import { paraphraseSubClass, verifySubClassParaphrase } from "../../src/domain/paraphrase.mjs";
import { parseAce } from "../../src/domain/grammar/ace.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { normFactTerm } from "../../src/domain/hash.mjs";
import { parseJsonlRows, rollupBy, ladderGateBy } from "../benchlib/bench.mjs";

// ---- the ladder (fact-extraction fidelity — ING-0 -> ING-9). A distinct scale,
// drawn from this bench's own domain; never compared against AGENTBENCH's
// TOOL-* or INFBENCH's INF-*. ----
export const RUNGS = Object.freeze([
  "ING-0", "ING-1", "ING-2", "ING-3", "ING-4", "ING-5", "ING-6", "ING-7", "ING-8", "ING-9",
]);
export const GRADES = Object.freeze(["deterministic", "judged"]);
// The three WRONG-FACT classes (precision failures) plus the one honest recall
// miss. A forbid guard names which wrong-fact class it protects against; an
// unanticipated stored triple defaults to "fabricated".
export const WRONG_CLASSES = Object.freeze(["fabricated", "confused", "greedy-span"]);
export const FAILURE_CLASSES = Object.freeze(["missed-useful", ...WRONG_CLASSES]);

// The rung whose grade adds the deterministic paraphrase-equivalence check on
// top of the plain value-compare (SKILL §1). Below it, value-compare alone.
export const EQUIVALENCE_RUNG = "ING-7";

/** The honest-gate recall floor (mirrors infbench/agentbench COMPLETION_FLOOR):
 *  an extractor that stores nothing scores zero wrong facts at ~0% recall and so
 *  fails the gate — a single number is gameable, the pair is not. */
export const COMPLETION_FLOOR = 0.5;

// ---- case lint (schema-shape only — mirrors the sibling benches' parseCases as
// defense-in-depth over the COMMITTED, append-only cases file) ----
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function lintTriple(t, id, where, errors) {
  if (!isPlainObject(t)) { errors.push(`${id}: ${where} must be {subject,predicate,object} objects`); return; }
  for (const k of ["subject", "predicate", "object"]) {
    if (!t[k] || typeof t[k] !== "string") errors.push(`${id}: ${where} triple missing string ${k}`);
  }
}

export function parseCases(text) {
  return parseJsonlRows(text, (c, cases, errors) => {
    if (!RUNGS.includes(c.rung)) errors.push(`${c.id}: rung must be one of ${RUNGS.join("|")}`);
    if (typeof c.input !== "string" || !c.input.trim()) errors.push(`${c.id}: input must be a non-empty string`);
    if (!GRADES.includes(c.grade)) errors.push(`${c.id}: grade must be one of ${GRADES.join("|")}`);
    if (!Array.isArray(c.tags)) errors.push(`${c.id}: tags must be an array`);
    if (!isPlainObject(c.expect)) { errors.push(`${c.id}: missing expect`); return; }
    const hasStatements = Array.isArray(c.expect.statements) && c.expect.statements.length > 0;
    if (c.grade === "deterministic" && !hasStatements && c.expect.abstain !== true) {
      errors.push(`${c.id}: a deterministic case needs expect.statements or expect.abstain:true`);
    }
    if (c.expect.statements !== undefined) {
      if (!Array.isArray(c.expect.statements)) errors.push(`${c.id}: expect.statements must be an array`);
      else for (const t of c.expect.statements) lintTriple(t, c.id, "expect.statements", errors);
    }
    if (c.expect.forbid !== undefined) {
      if (!Array.isArray(c.expect.forbid)) errors.push(`${c.id}: expect.forbid must be an array`);
      else for (const t of c.expect.forbid) {
        lintTriple(t, c.id, "expect.forbid", errors);
        if (t && t.class !== undefined && !WRONG_CLASSES.includes(t.class)) {
          errors.push(`${c.id}: expect.forbid class must be one of ${WRONG_CLASSES.join("|")}`);
        }
      }
    }
    if (c.expect.abstain !== undefined && typeof c.expect.abstain !== "boolean") {
      errors.push(`${c.id}: expect.abstain must be a boolean`);
    }
    if (c.ceiling !== undefined && (typeof c.ceiling !== "string" || !c.ceiling.trim())) {
      errors.push(`${c.id}: ceiling must be a non-empty string naming the capability that would lift it`);
    }
    cases.push(c);
  });
}

// ---- canonical triple folding + set compare ----

/** Fold a stored or expected triple to the store's normalized form: subject and
 *  object through normFactTerm (the same fold the memory store applies), the
 *  predicate CURIE verbatim. Idempotent — a pinned literal already in folded
 *  form is unchanged. */
export function canonicalTriple(t) {
  return { subject: normFactTerm(t.subject), predicate: String(t.predicate), object: normFactTerm(t.object) };
}
const tripleKey = (t) => `${t.subject}\0${t.predicate}\0${t.object}`;

/** Compare one case's STORED triples against its expected statements / forbid /
 *  abstain, returning the fidelity breakdown: which expected statements were kept
 *  (recall), and every stored triple the source does not support, classed as a
 *  wrong fact (a forbid guard names its class; an unanticipated one is fabricated).
 *  Pure — the caller supplies stored triples from a real ingestText run. */
export function classifyStored(storedTriples, caseDef) {
  const stored = storedTriples.map(canonicalTriple);
  const storedKeys = new Set(stored.map(tripleKey));
  const expected = (caseDef.expect.statements || []).map(canonicalTriple);
  const expectedKeys = new Set(expected.map(tripleKey));
  const forbidByKey = new Map();
  for (const f of caseDef.expect.forbid || []) forbidByKey.set(tripleKey(canonicalTriple(f)), f.class || "fabricated");

  const kept = expected.filter((e) => storedKeys.has(tripleKey(e)));
  const missed = expected.filter((e) => !storedKeys.has(tripleKey(e)));
  const wrong = [];
  for (const s of stored) {
    const key = tripleKey(s);
    if (expectedKeys.has(key)) continue; // a supported, useful fact
    wrong.push({ triple: s, class: forbidByKey.get(key) || "fabricated" });
  }

  const failureCounts = Object.fromEntries(FAILURE_CLASSES.map((k) => [k, 0]));
  failureCounts["missed-useful"] = missed.length;
  for (const w of wrong) failureCounts[w.class] += 1;

  const expectedCount = expected.length;
  const wrongCount = wrong.length;
  const keptCount = kept.length;
  const storedCount = stored.length;
  // Recall over this case's expected statements; an abstain case (no expected
  // statements) has recall 1 iff it correctly stored nothing, 0 otherwise.
  const abstain = caseDef.expect.abstain === true;
  const recall = expectedCount ? keptCount / expectedCount : (abstain && storedCount === 0 ? 1 : (storedCount === 0 ? 1 : 0));
  // Precision over what it stored; nothing stored is vacuously precise.
  const precision = storedCount ? keptCount / storedCount : 1;

  return {
    kept, missed, wrong, failureCounts,
    expectedCount, keptCount, wrongCount, storedCount, abstain,
    recall, precision,
  };
}

// ---- ING-7's deterministic equivalence check (seeded from paraphrase.mjs) ----

const localPart = (s) => (String(s).includes(":") ? String(s).split(":").pop() : String(s));

/** Restate one stored triple as a canonical statement and confirm the
 *  restatement carries the SAME triple, deterministically — the ING-7 contract.
 *  isa-family triples go through paraphraseSubClass + verifySubClassParaphrase
 *  (the shipped isa-closure slice, src/domain/paraphrase.mjs). Every other
 *  predicate is restated as a plain ACE object-property sentence and re-parsed
 *  through parseAce; verified iff the re-parse recovers exactly that triple.
 *  Returns { restatement, verified, method }. */
export function verifyCanonicalRestatement(triple, { existingEdges = [], lexicon = null } = {}) {
  const t = canonicalTriple(triple);
  if (t.predicate === "rdfs:subClassOf") {
    const restatement = paraphraseSubClass(t.subject, t.object);
    const { verified } = verifySubClassParaphrase(t.subject, t.object, restatement, existingEdges);
    return { restatement, verified, method: "isa-closure" };
  }
  const verb = localPart(t.predicate);
  const restatement = `a ${t.subject} ${verb} a ${t.object}`;
  const parsed = parseAce(restatement, lexicon || loadLexicon());
  const triples = parsed?.triples || [];
  const verified = triples.length === 1
    && normFactTerm(localPart(triples[0].subject)) === t.subject
    && normFactTerm(localPart(triples[0].object)) === t.object
    && localPart(triples[0].predicate) === verb;
  return { restatement, verified, method: "parseAce" };
}

/** Restate a whole document's STORED triples as canonical statements — the text
 *  the ING-8/ING-9 judge scores for meaning-preservation both ways. isa-family
 *  triples use the paraphrase template; every other predicate reads as
 *  "<subject> <verb> <object>". Deterministic; the same stored set always yields
 *  the same restatement. */
export function restateDocument(storedTriples) {
  return storedTriples.map((raw) => {
    const t = canonicalTriple(raw);
    if (t.predicate === "rdfs:subClassOf") return paraphraseSubClass(t.subject, t.object);
    return `a ${t.subject} ${localPart(t.predicate)} a ${t.object}`;
  }).join(". ").replace(/\.?$/, ".");
}

// ---- grade one deterministic case ----

/** Grade one deterministic case (ING-0..ING-7) against its STORED triples.
 *  pass = ZERO wrong facts AT >= COMPLETION_FLOOR recall (a correct abstain
 *  passes). At the equivalence rung (ING-7) every kept triple must ALSO round-trip
 *  through verifyCanonicalRestatement. Returns a graded row. */
export function gradeDeterministicCase(caseDef, storedTriples) {
  const c = classifyStored(storedTriples, caseDef);
  let equivChecked = 0;
  let equivVerified = 0;
  if (caseDef.rung === EQUIVALENCE_RUNG) {
    for (const triple of c.kept) {
      equivChecked += 1;
      if (verifyCanonicalRestatement(triple).verified) equivVerified += 1;
    }
  }
  const equivOk = caseDef.rung !== EQUIVALENCE_RUNG || (equivChecked > 0 && equivVerified === equivChecked);
  const pass = c.wrongCount === 0 && c.recall >= COMPLETION_FLOOR && equivOk;
  return {
    caseId: caseDef.id,
    rung: caseDef.rung,
    grade: "deterministic",
    ...(caseDef.ceiling ? { ceiling: caseDef.ceiling } : {}),
    pass,
    wrongCount: c.wrongCount,
    recall: c.recall,
    precision: c.precision,
    expectedCount: c.expectedCount,
    keptCount: c.keptCount,
    storedCount: c.storedCount,
    abstain: c.abstain,
    failureCounts: c.failureCounts,
    equivChecked,
    equivVerified,
    stored: storedTriples.map(canonicalTriple),
    wrong: c.wrong,
    missed: c.missed,
  };
}

/** A placeholder row for a judged case (ING-8/ING-9): the deterministic runner
 *  cannot score it — ingestbench/judge.mjs does. Carries the ingested restatement
 *  for provenance; pass is null (pending judge). */
export function pendingJudgeRow(caseDef, storedTriples, restatement) {
  return {
    caseId: caseDef.id,
    rung: caseDef.rung,
    grade: "judged",
    ...(caseDef.ceiling ? { ceiling: caseDef.ceiling } : {}),
    pass: null,
    judgePending: true,
    storedCount: storedTriples.length,
    stored: storedTriples.map(canonicalTriple),
    restatement,
  };
}

// ---- per-rung metric fold + ladder gate (mirrors infbench/grade.mjs) ----

/** Tally one rung's deterministic rows into the metric pair + the four failure
 *  classes + the honest gate. Judge-pending rows carry no deterministic verdict,
 *  so they contribute only their count (judgePending), never a pass/fabrication. */
function tallyOne(rows) {
  const graded = rows.filter((r) => !r.judgePending);
  const pending = rows.length - graded.length;
  const total = rows.length;
  const passed = graded.filter((r) => r.pass).length;
  let expected = 0;
  let kept = 0;
  let wrong = 0;
  const failureCounts = Object.fromEntries(FAILURE_CLASSES.map((k) => [k, 0]));
  const ceilingGraded = graded.filter((r) => r.ceiling).length;
  const ceilingGradedPassed = graded.filter((r) => r.ceiling && r.pass).length;
  let anyExpected = false;
  let allAbstainHeld = true;
  for (const r of graded) {
    expected += r.expectedCount;
    kept += r.keptCount;
    wrong += r.wrongCount;
    if (r.expectedCount) anyExpected = true;
    if (r.abstain && (r.wrongCount > 0)) allAbstainHeld = false;
    for (const k of FAILURE_CLASSES) failureCounts[k] += r.failureCounts?.[k] || 0;
  }
  const stored = kept + wrong;
  // Recall over the rung's expected statements (SKILL §1's gate denominator). A
  // rung of only abstain cases has no expected statements — its recall is 1 when
  // every abstain held, else the wrong facts already fail the gate.
  const recall = anyExpected ? kept / expected : (allAbstainHeld ? 1 : 0);
  const precision = stored ? kept / stored : 1;
  const wrongRate = stored ? wrong / stored : 0;
  return {
    total, graded: graded.length, pending, passed,
    expected, kept, wrong, stored,
    recall, precision, wrongRate, failureCounts,
    ceilingGraded, ceilingGradedPassed,
    // `completion` is the field the shared ladder gate reads; it IS recall here.
    completion: recall,
    gatePass: wrong === 0 && recall >= COMPLETION_FLOOR,
  };
}

/** Fold graded rows into { byRung, overall } over the ordered rung list. */
export function rollup(rows) {
  const { byTier, overall } = rollupBy(rows, RUNGS, (r) => r.rung, tallyOne);
  return { byRung: byTier, overall };
}

/** The distinct capabilities the ceiling-graded rows of each rung wait on. */
export function ceilingCapabilities(rows) {
  const byRung = {};
  for (const row of rows) {
    if (!row.ceiling) continue;
    (byRung[row.rung] ??= new Set()).add(row.ceiling);
  }
  return Object.fromEntries(Object.entries(byRung).map(([rung, set]) => [rung, [...set].sort()]));
}

/** Ladder gating: rungs run ING-0 -> ING-9; the FIRST rung failing the honest
 *  gate (0% wrong facts at >= COMPLETION_FLOOR recall) gates every rung above it,
 *  reported skipped-with-a-receipt. */
export function ladderGate(rolled) {
  return ladderGateBy(rolled.byRung, {
    tiers: RUNGS,
    tierKey: "rung",
    rateOf: (c) => c.wrongRate,
    rateLabel: "wrong-fact",
    floor: COMPLETION_FLOOR,
  });
}

/** Human-readable per-rung metric table. The ceiling column reads
 *  "<ceiling passes>/<passes>" — how much of the rung's green is a declared
 *  horizon rather than a shipped capability. */
export function renderRollup(rolled, label = "") {
  const pct = (n) => `${(n * 100).toFixed(0)}%`;
  // A rung with no deterministic rows (only judge-pending cases) has no
  // deterministic gate to report — it is scored by ingestbench/judge.mjs, so its
  // gate cell reads "jdg", never a vacuous PASS.
  const gateCell = (c) => (c.graded === 0 && c.pending ? "jdg" : (c.gatePass ? "PASS" : "----"));
  const row = (l, c) =>
    `${l.padEnd(7)} ${String(c.total).padStart(3)}  ${String(c.passed).padStart(4)}  ` +
    `${pct(c.recall).padStart(6)}  ${pct(c.precision).padStart(6)}  ${String(c.wrong).padStart(5)}  ` +
    `${gateCell(c).padStart(4)}  ${`${c.ceilingGradedPassed}/${c.passed}`.padStart(7)}` +
    (c.pending ? `  (${c.pending} judged)` : "");
  const lines = [`${label ? `${label} — ` : ""}rung      n  pass  recall  precis  wrong  gate  ceil/pas`];
  for (const rung of RUNGS) {
    const c = rolled.byRung[rung];
    if (c) lines.push(row(rung, c));
  }
  lines.push(row("all", rolled.overall));
  return lines.join("\n");
}
