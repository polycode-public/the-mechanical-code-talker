// chatbench/run.mjs — the deterministic chatbench product runner (tier 1).
//
// Replays every case through the REAL product. Cases come from the graded pool
// (chatbench/graded-pool.jsonl) plus an optional always-run set a caller points
// --cases at; the file is loaded one of two ways:
//   - mode "turns": the pure runTurn() with the committed fixture graph loaded
//     ONCE and passed per turn, threading focus/last from turn N into N+1
//     exactly as runChat's loop does. runTurn performs no writes, and the
//     config's graphFile points at the read-only fixture, so a turns-mode run
//     touches no filesystem state at all.
//   - mode "session": the FULL runChat() with injected input/output streams in
//     a fresh temp dir per case (the scripted-session pattern in
//     test/tools/chat.test.mjs) — session side-effects (sidecar, graph fold-in,
//     memory) happen INSIDE the temp dir, which is removed afterwards. A case
//     may span several sessions (turn.session = 1, 2, …) to measure recall.
//
// Tier-1 expectations (deterministic, evaluated here — the LLM judge is tier 2,
// chatbench/judge.mjs): miss flag, answer regex/substring, answered/resolved id
// membership, post-turn focus label, session end, subclass-paraphrase
// equivalence, and ING-8 relation-paraphrase equivalence. The paraphrase checks
// settle a case whose answer only needs to be a valid paraphrase of a given
// fact — not one verbatim string — via ingestbench's own deterministic
// checkers: verifySubClassParaphrase (src/domain/paraphrase.mjs) for isa/
// subclass facts, verifyRelationParaphrase (src/domain/paraphrase-ing8.mjs,
// the ING-8 corpus-authored checker) for the closed non-isa relation
// vocabulary (has/creates/capableOf). Both are free and exact, where an
// answerMatch pin would otherwise force the case author to hardcode which of
// the closed template set the product happened to pick. A turn marked
// evaluated and recorded but never fail the case; if they all pass, the case is
// flagged `improvedBaselineTurns` (a lever fixed a documented weakness). Once a
// lever DOES fix it, the turn gains expect.improvedIn:"<cycle>" (cycle 2 onward):
// baselineFail:true stays as the historical record (the case set is append-only —
// SKILL_TUNING_CYCLE.md §1), but the expectation is ENFORCED from that cycle on,
// so a later regression on a fixed weakness is a real tier-1 failure, never a
// quietly-lapsed improvement.
//
// Determinism: the run stamp comes from the CLI (--stamp <label>), never from
// Date.now — two runs over the same tree and stamp produce byte-identical rows
// except the informational timingMs field. Exit code: 1 on tier-1 regressions
// vs --compare <prior product.jsonl> (a previously-passing case now failing),
// or on runner errors; 0 otherwise.
//
// GRADED layer (case-set v2, chatbench/GRADED.md): a POOL of graded cases
// (chatbench/graded-pool.jsonl) is sampled per run. The frozen v1 core was
// folded into it as fully-graded cells at case-set v3 (eaf33f0), so there is
// no separate ungraded always-run tier unless a caller supplies one via
// --cases. The go-to default (--sample 1, SKILL_BENCHMARK_CEFR_ENGLISH.md §1)
// takes the WHOLE pool as a single draw — nothing is left to cross-validate
// against, so dual-draw never fires. A caller who narrows --sample below 1
// gets a stratified per grade×construction draw, DUAL by default (two
// independent samples whose per-cell agreement is the instrument's own
// reliability check), unless --single is also passed. --ladder gates grades
// ascending; --grade runs one band. With no pool file present, behavior is
// exactly v1.
//
// Usage:
//   node chatbench/run.mjs --stamp <label> [--cases chatbench/cases.jsonl]
//     [--out chatbench/results/raw/run-<stamp>] [--compare <prior product.jsonl>]
//     [--only <caseId,caseId,...>] [--pool <graded-pool.jsonl|none>]
//     [--sample <fraction>] [--seed <n>] [--single|--dual] [--grade <band>] [--ladder]

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";
import { parseJsonlRows, parseFlags, pool } from "../benchlib/bench.mjs";
import { partitionForReuse, stampReuseFields } from "./skip-unchanged.mjs";
import {
  GRADES, fnv1a, validateConstruction,
  stratifiedSample, dualDraws, computeAgreement, renderAgreementTable,
  gradeReliability, gradedRollup, renderRollup, templateLaneLint,
  timingRollup, renderTimings,
} from "./graded.mjs";
import { CLASS_DOCS, PREDICATE_DOCS } from "../../src/tools/schema-docs.mjs";
import { verifySubClassParaphrase } from "../../src/domain/paraphrase.mjs";
import { verifyRelationParaphrase, RELATION_FAMILY_IDS } from "../../src/domain/paraphrase-ing8.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
export const FIXTURE = join(ROOT, "test", "fixtures", "entities.fixture.json");
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const DEFAULT_POOL = join(HERE, "graded-pool.jsonl");

export const TAGS = [
  "graph-query", "conversational", "honesty-miss", "typo-fuzzy", "noise",
  "ambiguity", "multi-turn-focus", "memory-recall", "bootstrap-empty",
];
// graded pool cases carry the "graded" tag (their coverage registry is the
// grade × construction matrix, not the v1 TAGS); it is valid everywhere but
// deliberately NOT part of the v1 coverage registry above. "template-lane"
// marks a case that targets a TEMPLATED capability — a pass there raises the PERFORMANCE band only, never
// the productive band; the dual-banding rollup + isTemplateLane read this tag.
const EXTRA_TAGS = ["graded", "template-lane"];
export const EXPECT_KEYS = [
  "miss", "answerMatch", "answerNotMatch", "answeredIdsInclude",
  "resolvedIdsInclude", "focusLabel", "end", "baselineFail", "improvedIn",
  "subclassParaphrase", "ing8Paraphrase",
];
export const JUDGE_DIMENSIONS = ["groundedness", "correctness", "honesty", "rephrase"];
const MODES = ["turns", "session"];
const GRAPHS = ["fixture", "empty"];

/** The graph context the judge scores groundedness against — a faithful prose
 *  ENUMERATION of test/fixtures/entities.fixture.json (kept in sync by hand; the
 *  case set is pinned to this fixture). Stamped onto every judged row via
 *  FIXTURE_CONTEXT_VERSION so "which context scored this" is auditable across
 *  cycles (the way PROMPT_VERSION pins the prompt).
 *
 *  H1b correction (cycle 2, CHATBENCH_001 §judge-integrity): cycle 1's text
 *  claimed "One commit: abc1234 … no other commits", but the committed fixture
 *  ALSO carries git:def5678 provenance on app/lib/a.mjs (derived_from) and two
 *  cochange edges — content /describe faithfully renders ("touched by 2
 *  commit(s)", "provenance: git:abc1234, git:def5678", the cochange lines). The
 *  judge scored faithfully against that unfaithful summary and systematically
 *  zeroed TRUTHFUL /describe output (mt-describe-then-callers, plus turn-1
 *  contamination of mt-focus-drift and one gq-impact-a sample).
 *
 *  META-1 broadening (cycle 4, archive/PLAN_CYCLE_4.md §META-1 — the direct lineage of
 *  H1a/H1b, generalized): cycle 1–2's summary enumerated the graph at MODULE
 *  grain only, so the judge — told the context was exhaustive — scored the
 *  product's TRUTHFUL SYMBOL-grain output as fabrication (A2 naming zeroed 5/5
 *  in both draws; mr-asked-before capped at 1.222 despite a correct recall; every
 *  /describe-anchored case dinged). The lines below now carry the FULL fixture
 *  entity detail the product may truthfully emit — per-symbol ids, source sites/
 *  line spans, params/returns/raises/decorators/self-fields, per-module provenance
 *  commit ids, and the session/memory VOCABULARY the recall path speaks — every
 *  value verbatim from entities.fixture.json (and the memory subsystem's own OWL
 *  schema). "Holds exactly these facts" stays TRUE of the fuller enumeration. This
 *  is a measurement correction to judge INPUT, NOT a product change; CHATBENCH_004
 *  marks cycle 4 a groundedness RE-BASELINE (v1-context means are not comparable to
 *  v2-context means; only unchanged-answer deltas and correctness/honesty carry over). */
export const FIXTURE_CONTEXT = [
  "The graph under discussion (a small fixture codebase) holds exactly these facts. Each entity carries a stable id and, where the fixture records it, a source site, signature and provenance — the product may TRUTHFULLY render any of this detail:",
  "- Modules (8), each with id mod:<path>: app/lib/a.mjs, app/lib/b.mjs, app/lib/c.mjs, app/functions/d/handler.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs, app/unit-tests/b.test.mjs (so e.g. app/lib/a.mjs has id mod:app/lib/a.mjs). app/lib/a.mjs also carries the dotted name \"app.lib.a\".",
  "- Classes (3): Base (id cls-base, site app/lib/a.mjs:1-3); Widget (id cls-widget, site app/lib/b.mjs:1-30) extends Base; Button (id cls-button, site app/lib/c.mjs:1-10) extends Widget.",
  "- Method Widget.render (id m-render, site app/lib/b.mjs:5-9): decorator `property`; parameters `self, mode='full'`; returns `str`; raises `ValueError`; accesses self fields `name, size`; doc \"Render the widget.\". Widget contains render and the attribute name.",
  "- Attribute Widget.name (id a-name, site app/lib/b.mjs:2). Global variable `register` (id g-register, site app/lib/b.mjs:1, value `Library()`) is defined in app/lib/b.mjs.",
  "- Function fnAlpha (id fn-alpha, site app/lib/a.mjs:12) is defined in app/lib/a.mjs. The method Widget.render calls fnAlpha (a symbol-level callsSymbol edge). app/functions/d/handler.mjs re-exports fnAlpha (reexports edge).",
  "- imports: b.mjs->a.mjs, c.mjs->a.mjs, d/handler.mjs->b.mjs, d/handler.mjs->c.mjs, e.mjs->a.mjs, e.mjs->f.mjs, f.mjs->e.mjs.",
  "- module-level calls: scripts/g.mjs -> app/lib/a.mjs (no module-level calls edge targets fnAlpha itself).",
  "- tests: app/unit-tests/b.test.mjs covers app/lib/b.mjs and app/functions/d/handler.mjs.",
  "- cochange (change-coupled) edges: app/lib/a.mjs <-> app/lib/b.mjs (weight 3) and app/lib/a.mjs <-> app/lib/c.mjs (weight 2).",
  "- Commits: abc1234 (id commit-abc; author Ada Lovelace; date 2026-06-28T12:00:00+00:00; message \"Render the widget with full mode\") is the only commit ENTITY, touching app/lib/a.mjs (touches, module grain) and Widget.render (touchesSymbol, symbol grain). Additionally, per-module PROVENANCE (derived_from) records commit ids: app/lib/a.mjs derives from git:abc1234 AND git:def5678, app/lib/b.mjs from git:abc1234 — so saying app/lib/a.mjs was \"touched by 2 commit(s)\" or citing git:abc1234, git:def5678 in its provenance is TRUTHFUL; def5678 simply has no commit entity of its own to describe.",
  "- Nothing else exists: no zebra.mjs, no nonExistentFn, no commit references beyond abc1234 and def5678.",
  // The schema-doc glosses, enumerated VERBATIM from the same source the graph
  // ingests (src/tools/schema-docs.mjs) — a truthful "what does <term> mean"
  // answer quotes exactly this text, so the judge must be able to see it.
  "- Like every real tmct graph artifact, it also documents its OWN vocabulary as first-class schema individuals. An answer to \"what does <term> mean\" that quotes one of the glosses below is TRUTHFUL, grounded schema documentation (not invention):",
  ...CLASS_DOCS.map((c) => `  - class ${c.name}: ${c.description}`),
  ...PREDICATE_DOCS.map((p) => (p.kind === "attribute"
    ? `  - attribute ${p.prop}: ${p.description}`
    : `  - predicate ${p.kind} (${p.prop}): ${p.description}`)),
  "- MEMORY & SESSION vocabulary (the recall path speaks this; a session-mode answer that cites it is TRUTHFUL, not invented): each chat session is folded into the graph as a first-class `Session` individual whose id is a uuidv7 (a hex id beginning `019f…`), timestamped with an ISO date; each recorded turn is an `Utterance`; each asserted rule (\"every module is a component\") becomes a reified `Fact` individual carrying an rdfs:subClassOf-style relation (e.g. `function rdfs:subClassOf component`) with its own provenance. A recall answer (\"noted — remembered 1 fact: …\", \"you asked before …\") renders these remembered Session/Utterance/Fact frames — so citing a session id, a prior date, or a stored fact is grounded in the memory graph even though it is not a code entity above.",
].join("\n");

/** Stamped onto every judged row's judge object (like PROMPT_VERSION pins the
 *  prompt) so a cross-cycle comparison can state which context grain scored it.
 *  Bump when FIXTURE_CONTEXT / EMPTY_CONTEXT change grain (v1 = cycle-1/2 module
 *  grain; v2 = cycle-4 META-1 full symbol + memory-vocabulary enumeration;
 *  v3 = the schema-doc glosses enumerated verbatim — the same META-1-class
 *  judge-input correction one grain deeper: a truthful schema answer to
 *  "what does tests mean" was zeroed for want of the gloss text). Like every
 *  context-grain bump, v3 re-baselines groundedness on the affected naming
 *  cases: v2-context means are not comparable to v3-context means there. */
export const FIXTURE_CONTEXT_VERSION = "fixture-context-v3";

export const EMPTY_CONTEXT =
  "The graph under discussion is EMPTY (a fresh repo with no index): zero entities, zero edges. " +
  "Every structural answer must therefore be an honest empty/miss; any named entity would be invented.";

// ---- case loading + lint ----

/** Parse cases.jsonl text into { cases, errors }. Errors are lint findings
 *  (schema violations, duplicate ids, bad tags/expect keys) — the same checks
 *  test/bench/chatbench.test.mjs enforces over the committed file. */
export function parseCases(text) {
  return parseJsonlRows(text, (c, cases, errors, at) => {
    if (!Array.isArray(c.tags) || !c.tags.length) errors.push(`${c.id}: tags must be a non-empty array`);
    for (const tag of c.tags || []) if (!TAGS.includes(tag) && !EXTRA_TAGS.includes(tag)) errors.push(`${c.id}: unknown tag "${tag}"`);
    if (c.grade !== undefined || c.construction !== undefined) {
      if (!GRADES.includes(c.grade)) errors.push(`${c.id}: grade must be one of ${GRADES.join("|")}`);
      const cErr = validateConstruction(c.construction);
      if (cErr) errors.push(`${c.id}: ${cErr}`);
      if (!(c.tags || []).includes("graded")) errors.push(`${c.id}: graded cases must carry the "graded" tag`);
    }
    if (!MODES.includes(c.mode)) errors.push(`${c.id}: mode must be one of ${MODES.join("|")}`);
    if (c.mode === "session" && !GRAPHS.includes(c.graph)) errors.push(`${c.id}: session case needs graph: ${GRAPHS.join("|")}`);
    if (c.mode === "turns" && c.graph) errors.push(`${c.id}: graph is a session-mode field`);
    if (!Array.isArray(c.turns) || !c.turns.length) { errors.push(`${c.id}: turns must be a non-empty array`); return; }
    let lastSession = 1;
    c.turns.forEach((turn, j) => {
      const tat = `${c.id} turn ${j + 1}`;
      if (!turn.say || typeof turn.say !== "string") errors.push(`${tat}: missing say`);
      if (c.mode === "session") {
        const s = turn.session ?? 1;
        if (!Number.isInteger(s) || s < 1) errors.push(`${tat}: session must be a positive integer`);
        if (s < lastSession) errors.push(`${tat}: session numbers must be non-decreasing`);
        lastSession = Math.max(lastSession, s);
      } else if (turn.session) {
        errors.push(`${tat}: session is a session-mode field`);
      }
      if (turn.expect) {
        for (const k of Object.keys(turn.expect)) {
          if (!EXPECT_KEYS.includes(k)) errors.push(`${tat}: unknown expect key "${k}"`);
        }
        if (c.mode === "session" && ("focusLabel" in turn.expect || "end" in turn.expect)) {
          errors.push(`${tat}: focusLabel/end are turns-mode expectations (session mode reads the sidecar, which has neither)`);
        }
        if ("improvedIn" in turn.expect) {
          if (typeof turn.expect.improvedIn !== "string" || !turn.expect.improvedIn.trim()) {
            errors.push(`${tat}: improvedIn must be a non-empty cycle label string (e.g. "002")`);
          }
          if (turn.expect.baselineFail !== true) {
            errors.push(`${tat}: improvedIn only annotates a baselineFail:true turn (it records the cycle that fixed the documented weakness)`);
          }
        }
        if ("subclassParaphrase" in turn.expect) {
          const sp = turn.expect.subclassParaphrase;
          if (!sp || typeof sp !== "object" || typeof sp.subject !== "string" || typeof sp.object !== "string") {
            errors.push(`${tat}: subclassParaphrase must be {subject, object} strings`);
          }
        }
        if ("ing8Paraphrase" in turn.expect) {
          const rp = turn.expect.ing8Paraphrase;
          if (!rp || typeof rp !== "object" || typeof rp.subject !== "string" || typeof rp.object !== "string"
            || !RELATION_FAMILY_IDS.includes(rp.family)) {
            errors.push(`${tat}: ing8Paraphrase must be {family, subject, object} with family one of ${RELATION_FAMILY_IDS.join("|")}`);
          }
        }
      }
    });
    if (c.judge) {
      if (!Array.isArray(c.judge.dimensions) || !c.judge.dimensions.length) {
        errors.push(`${c.id}: judge.dimensions must be a non-empty array`);
      } else {
        for (const d of c.judge.dimensions) if (!JUDGE_DIMENSIONS.includes(d)) errors.push(`${c.id}: unknown judge dimension "${d}"`);
      }
    }
    cases.push(c);
  });
}

// ---- tier-1 evaluation ----

const toArray = (v) => (Array.isArray(v) ? v : [v]);

/** Candidate substrings a subclassParaphrase or ing8Paraphrase check tries
 *  against a turn's answer text: each parenthetical clause (the shape chat.mjs's
 *  paraphraseVerifiedSubClass suffix produces — "noted — remembered 1 fact:
 *  cache rdfs:subClassOf component (every cache is a component)") plus the
 *  whole answer, so the check isn't coupled to that one formatting
 *  convention. */
function subclassParaphraseCandidates(answer) {
  const text = String(answer ?? "");
  const candidates = [...text.matchAll(/\(([^()]+)\)/g)].map((m) => m[1].trim());
  candidates.push(text.trim());
  return candidates;
}

/** Evaluate one turn's expectations against its outcome
 *  ({ answer, miss, resolvedIds, answeredIds, focusLabel?, end? }).
 *  Returns [{ key, pass, expected, actual }] — one entry per declared check
 *  (baselineFail is a marker, not a check). */
export function evaluateExpect(expect, outcome) {
  const checks = [];
  const add = (key, pass, expected, actual) => checks.push({ key, pass, expected, actual });
  if (!expect) return checks;
  if ("miss" in expect) add("miss", outcome.miss === expect.miss, expect.miss, outcome.miss);
  for (const re of toArray(expect.answerMatch ?? [])) {
    add("answerMatch", new RegExp(re).test(outcome.answer ?? ""), re, String(outcome.answer ?? "").slice(0, 200));
  }
  for (const re of toArray(expect.answerNotMatch ?? [])) {
    add("answerNotMatch", !new RegExp(re).test(outcome.answer ?? ""), `not ${re}`, String(outcome.answer ?? "").slice(0, 200));
  }
  for (const id of expect.answeredIdsInclude ?? []) {
    add("answeredIdsInclude", (outcome.answeredIds ?? []).includes(id), id, outcome.answeredIds ?? []);
  }
  for (const id of expect.resolvedIdsInclude ?? []) {
    add("resolvedIdsInclude", (outcome.resolvedIds ?? []).includes(id), id, outcome.resolvedIds ?? []);
  }
  if ("focusLabel" in expect) add("focusLabel", outcome.focusLabel === expect.focusLabel, expect.focusLabel, outcome.focusLabel ?? null);
  if ("end" in expect) add("end", Boolean(outcome.end) === expect.end, expect.end, Boolean(outcome.end));
  if (expect.subclassParaphrase) {
    const { subject, object, existingEdges = [] } = expect.subclassParaphrase;
    const verified = subclassParaphraseCandidates(outcome.answer)
      .some((candidate) => verifySubClassParaphrase(subject, object, candidate, existingEdges).verified);
    add("subclassParaphrase", verified, { subject, object }, outcome.answer ?? "");
  }
  if (expect.ing8Paraphrase) {
    const { family, subject, object } = expect.ing8Paraphrase;
    const verified = subclassParaphraseCandidates(outcome.answer)
      .some((candidate) => verifyRelationParaphrase(family, subject, object, candidate).verified);
    add("ing8Paraphrase", verified, { family, subject, object }, outcome.answer ?? "");
  }
  return checks;
}

/** Fold per-turn checks into the case's tier-1 verdict. baselineFail turns
 *  never fail the case; a baselineFail turn whose checks ALL pass is an
 *  improvement (flagged, still not a failure) — UNLESS the turn also carries
 *  improvedIn:"<cycle>": the weakness was fixed in that cycle, the marker pair
 *  stays as the historical record, and the checks are enforced like any other
 *  turn's (a regression on a fixed weakness is a real tier-1 failure). */
export function summarizeTier1(turnEvals) {
  const failing = [];
  const baselineFailTurns = [];
  const improvedBaselineTurns = [];
  let checksTotal = 0;
  turnEvals.forEach(({ checks, baselineFail, improvedIn }, i) => {
    checksTotal += checks.length;
    if (baselineFail) {
      baselineFailTurns.push(i);
      if (checks.length && checks.every((ch) => ch.pass)) improvedBaselineTurns.push(i);
      if (!improvedIn) return; // still-documented weakness: advisory, never failing
    }
    for (const ch of checks) if (!ch.pass) failing.push({ turn: i, ...ch });
  });
  return {
    pass: failing.length === 0,
    checksTotal,
    checksFailed: failing.length,
    failing,
    baselineFailTurns,
    improvedBaselineTurns,
  };
}

// ---- product execution ----

/** Run a turns-mode case through the pure runTurn, threading focus/last the
 *  way runChat's loop does. `deps` = { runTurn, config, graph }. */
export async function runTurnsCase(caseDef, deps) {
  const { runTurn, config, graph } = deps;
  let focus = null;
  let last = null;
  const transcript = [];
  const turnEvals = [];
  for (const turn of caseDef.turns) {
    const r = await runTurn(turn.say, { config, graph, focus, last });
    focus = r.focus ?? null;
    last = r.last ?? last;
    const answer = stripPresentationTrailers(r.answer);
    const outcome = {
      answer,
      miss: r.record?.miss ?? null,
      resolvedIds: r.record?.resolvedIds ?? [],
      answeredIds: r.record?.answeredIds ?? [],
      focusLabel: focus?.label ?? null,
      end: Boolean(r.end),
    };
    transcript.push({
      say: turn.say,
      answer: r.answer,
      miss: outcome.miss,
      resolvedIds: outcome.resolvedIds,
      answeredIds: outcome.answeredIds,
      ...(r.record?.via ? { via: r.record.via } : {}),
      ...(r.record?.command ? { command: r.record.command } : {}),
      focusLabel: outcome.focusLabel,
      ...(outcome.end ? { end: true } : {}),
      ...(turn.expect ? { expect: turn.expect } : {}),
    });
    turnEvals.push({
      checks: evaluateExpect(turn.expect, outcome),
      baselineFail: Boolean(turn.expect?.baselineFail),
      improvedIn: turn.expect?.improvedIn ?? null,
    });
    if (outcome.end) break; // a farewell ends the case's session, like runChat
  }
  return { transcript, turnEvals };
}

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  out.resume(); // discard — the per-turn answers are read back from the session log
  return out;
}

/** The per-run-volatile fact-recall citation: `ace:chat:<uuidv7>@<ISO timestamp>`.
 *  The session uuid (uuidv7, time-seeded) and the wall-clock stamp are both minted
 *  fresh each run, so any recorded answer that echoes this provenance is not
 *  reproducible — the runner scrubs it to a stable placeholder (below) for byte-equal
 *  rows across identical runs. */
const VOLATILE_PROVENANCE = /ace:chat:[0-9a-f-]{36}@\d{4}-\d{2}-\d{2}T[0-9:.]+Z/gi;

/** Feature B (0.9.x): chat.mjs's withGoalLine appends an ALWAYS-ON, blank-line-
 *  separated "Goal (inferred): …" trailer to every runAsk-composed answer —
 *  presentation instrumentation, not graded content (the same category as the
 *  volatile provenance scrub above). Every graded-pool `answerMatch` fixture
 *  was written against the SUBSTANTIVE answer text; scrubbed here (both
 *  runTurnsCase and runSessionCase, below) so those fixtures never need to
 *  grow a goal-line-shaped tail on top of their own ground truth. withCanonicalLine
 *  appends a further "Canonical: …" trailer AFTER the goal line when a real
 *  one was computed — scrubbed first (below) so the now-inner goal line still
 *  matches its own end-anchored regex. */
const GOAL_LINE_TRAILER = /\n\nGoal \(inferred\):[^\n]*$/;
const CANONICAL_LINE_TRAILER = /\n\nCanonical:[^\n]*$/;
const stripPresentationTrailers = (s) => String(s ?? "").replace(CANONICAL_LINE_TRAILER, "").replace(GOAL_LINE_TRAILER, "");

/** Run a session-mode case through the FULL runChat in a fresh temp dir:
 *  graph "fixture" seeds .tmct/graph.json from the committed fixture; "empty"
 *  starts bare (the bootstrap path). Turns grouped by turn.session run as
 *  separate scripted sessions in the SAME dir, so session N+1 sees whatever
 *  session N folded in (graph Session individuals, memory) — the recall
 *  measurement. Answers and records are read back from the session log +
 *  structured sidecar (sessions.mjs), matched to turns by order.
 *
 *  `caseDef.env` (optional) is merged over the default env for every runChat
 *  call this case makes — e.g. `{ TMCT_NO_SEED: "1" }` for a case that only
 *  exercises plumbing on an empty graph and doesn't need (and shouldn't pay
 *  for) the corpus-seed pass a bare "empty" graph would otherwise trigger. */
export async function runSessionCase(caseDef, deps) {
  const { runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson } = deps;
  const dir = await mkdtemp(join(tmpdir(), `tmct-chatbench-${caseDef.id.replace(/[^A-Za-z0-9-]/g, "_")}-`));
  try {
    if ((caseDef.graph ?? "fixture") === "fixture") {
      await mkdir(join(dir, ".tmct"), { recursive: true });
      await writeFile(join(dir, ".tmct", "graph.json"), graphJson);
    }
    // group turns by session number, preserving order
    const bySession = new Map();
    for (const turn of caseDef.turns) {
      const s = turn.session ?? 1;
      if (!bySession.has(s)) bySession.set(s, []);
      bySession.get(s).push(turn);
    }
    const transcript = [];
    const turnEvals = [];
    for (const [sessionNo, turns] of bySession) {
      // H1a bench-fidelity correction (cycle 2, CHATBENCH_001 §hard-fails,
      // mr-session-count): REAL tmct sessions are separate CLI processes, so
      // src/adapters/source.mjs's process-level read cache never spans two of them. The
      // bench replays every session of a case inside THIS one process — without
      // clearing that cache between sessions, session N+1 is served the stale
      // pre-session payload and never sees what session N folded into
      // graph.json ("0 sessions." against a graph that records session 1).
      // Clearing here restores the one-process-per-session reality the product
      // actually runs in. A measurement correction, NOT a product change (the
      // product-side note — a long-lived multi-session process like server.mjs
      // would want its own invalidation — is recorded in CHATBENCH_001).
      deps.clearCache?.();
      const lines = [...turns.map((t) => t.say), "/exit"].map((l) => l + "\n");
      const { logFile, sidecarFile } = await runChat({
        repoPath: dir,
        input: Readable.from(lines),
        output: sink(),
        // no inherited env: telemetry stays off, output undecorated; caseDef.env
        // (opt-in only) layers on top, e.g. TMCT_NO_SEED for seed-agnostic cases.
        env: { NO_COLOR: "1", ...(caseDef.env || {}) },
      });
      const rec = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
      const answers = parseSessionLog(await readFile(logFile, "utf8"));
      const records = rec?.turns ?? [];
      turns.forEach((turn, i) => {
        const record = records[i];
        const matched = record && record.query === turn.say;
        // Scrub the per-run temp dir out of answers (e.g. the empty-graph
        // bootstrap message names the graph path) so rows stay deterministic.
        // Same for the volatile fact-recall citation ace:chat:<uuidv7>@<ISO stamp>:
        // both the session uuid and the wall-clock stamp are minted per run, so an
        // assert-recall answer that echoes the provenance ("you told me: … (source:
        // ace:chat:019f…@2026-…Z)") otherwise flips between identical runs — the
        // instrument's discourse-count / assert-recall nondeterminism source. Fold it
        // to the SAME <session>@<ts> placeholder the case-set's `observed` fields use.
        const answer = matched
          ? stripPresentationTrailers(
              (answers.get(turnKey(record.ts, record.query)) ?? "")
                .replaceAll(dir, "<repo>")
                .replace(VOLATILE_PROVENANCE, "ace:chat:<session>@<ts>"),
            )
          : "";
        const outcome = matched
          ? { answer, miss: record.miss, resolvedIds: record.resolvedIds, answeredIds: record.answeredIds }
          : { answer: "", miss: null, resolvedIds: [], answeredIds: [] };
        transcript.push({
          session: sessionNo,
          say: turn.say,
          answer,
          miss: outcome.miss,
          resolvedIds: outcome.resolvedIds,
          answeredIds: outcome.answeredIds,
          ...(matched && record?.via ? { via: record.via } : {}),
          ...(record?.command ? { command: record.command } : {}),
          ...(turn.expect ? { expect: turn.expect } : {}),
        });
        const checks = evaluateExpect(turn.expect, outcome);
        if (!matched) checks.push({ key: "turnRecorded", pass: false, expected: turn.say, actual: record?.query ?? "(no record)" });
        turnEvals.push({
          checks,
          baselineFail: Boolean(turn.expect?.baselineFail),
          improvedIn: turn.expect?.improvedIn ?? null,
        });
      });
    }
    return { transcript, turnEvals };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run one case (either mode) into a product row. */
export async function runCase(caseDef, deps) {
  const t0 = process.hrtime.bigint();
  const { transcript, turnEvals } = caseDef.mode === "session"
    ? await runSessionCase(caseDef, deps)
    : await runTurnsCase(caseDef, deps);
  const tier1 = summarizeTier1(turnEvals);
  const timingMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  const baseContext = caseDef.mode === "session" && caseDef.graph === "empty" ? EMPTY_CONTEXT : FIXTURE_CONTEXT;
  return {
    caseId: caseDef.id,
    tags: caseDef.tags,
    mode: caseDef.mode,
    ...(caseDef.graph ? { graph: caseDef.graph } : {}),
    ...(caseDef.grade ? { grade: caseDef.grade, construction: caseDef.construction } : {}),
    ...(caseDef.grade && deps.sampling ? { sampling: deps.sampling } : {}),
    stamp: deps.stamp,
    // via provenance of the ANSWERING turn (the last transcript turn) — the band
    // the dual-banding rollup reads: "composed" is productive, every other via
    // (template/count/recall/fact/corpus/…) is performance-only.
    via: transcript.length ? transcript[transcript.length - 1].via ?? null : null,
    judge: {
      dimensions: caseDef.judge?.dimensions ?? JUDGE_DIMENSIONS,
      context: caseDef.judge?.context ? `${baseContext}\n\nCase note: ${caseDef.judge.context}` : baseContext,
      // META-1: pin which context grain scored this row (auditable across cycles).
      contextVersion: FIXTURE_CONTEXT_VERSION,
    },
    transcript,
    tier1,
    timingMs,
  };
}

/** Run a list of cases into rows IN ORDER, sharding across workers when
 *  `concurrency > 1` (PLAN lever 6). turns-mode cases replay through the pure
 *  runTurn and are safe to run in parallel; SESSION-mode cases clear a
 *  process-global source cache (createRunnerDeps.clearCache, see runSessionCase)
 *  so they must stay strictly sequential and never overlap another case — they
 *  are run one-by-one after the parallel batch. Order is preserved by index
 *  regardless. `run` is injectable (the reuse-aware wrapper below, or runCase). */
export async function runCasesOrdered(cases, deps, { run = runCase, concurrency = 1 } = {}) {
  if (concurrency <= 1) {
    const rows = [];
    for (const c of cases) rows.push(await run(c, deps));
    return rows;
  }
  const rows = new Array(cases.length);
  const parallelIdx = [];
  const sessionIdx = [];
  cases.forEach((c, i) => (c.mode === "session" ? sessionIdx : parallelIdx).push(i));
  await pool(parallelIdx, concurrency, async (i) => { rows[i] = await run(cases[i], deps); });
  for (const i of sessionIdx) rows[i] = await run(cases[i], deps);
  return rows;
}

/** A reuse-aware case runner (PLAN lever 6 skip-unchanged): returns the prior
 *  row verbatim when `reuse` holds one for the case, else replays it and stamps
 *  the reuse provenance so the NEXT run can reuse it. With no engine token the
 *  reuse map is empty and rows are stamped as before — byte-identical to a run
 *  that never asked for reuse. */
export function makeReusingRunner({ reuse = new Map(), engineToken = null } = {}) {
  return async (caseDef, deps) => {
    const kept = reuse.get(caseDef.id);
    if (kept) return kept;
    const row = await runCase(caseDef, deps);
    return engineToken ? stampReuseFields(row, caseDef, engineToken) : row;
  };
}

/** Compare this run's rows to a prior product.jsonl's: a regression is a case
 *  that PASSED tier-1 before and fails now (SKILL §1's decision rule input). */
export function compareProducts(priorRows, currentRows) {
  const prior = new Map(priorRows.map((r) => [r.caseId, r]));
  const regressions = [];
  const newCases = [];
  for (const row of currentRows) {
    const before = prior.get(row.caseId);
    if (!before) { newCases.push(row.caseId); continue; }
    if (before.tier1?.pass && !row.tier1?.pass) regressions.push(row.caseId);
  }
  return { regressions, newCases };
}

export function parseJsonl(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { cases: DEFAULT_CASES, sample: 1 },
    flags: {
      "--stamp": { key: "stamp" },
      "--cases": { key: "cases" },
      "--out": { key: "out" },
      "--compare": { key: "compare" },
      "--only": { key: "only", value: (v) => v.split(",").map((s) => s.trim()).filter(Boolean) },
      "--pool": { key: "pool" },
      "--sample": { key: "sample", value: Number },
      "--seed": { key: "seed", value: Number },
      "--dual": { key: "dual", flag: true },
      "--single": { key: "dual", flag: false },
      "--grade": { key: "grade", value: (v) => v.toUpperCase() },
      "--ladder": { key: "ladder", flag: true },
      "--reuse": { key: "reuse" },
      "--engine-token": { key: "engineToken" },
      "--concurrency": { key: "concurrency", value: Number },
    },
  });
}

/** Assemble the real-product deps every case replay needs (the same modules
 *  the CLI uses, the fixture run through the writer pipeline). The caller MUST
 *  await cleanup() when done. Shared by main() and generate-graded.mjs. */
export async function createRunnerDeps(stamp) {
  const { runTurn, runChat } = await import(join(ROOT, "src", "services", "chat.mjs"));
  const { parseEntities } = await import(join(ROOT, "src", "domain", "codegraph.mjs"));
  const { ingestSchemaDocs } = await import(join(ROOT, "src", "tools", "schema-docs.mjs"));
  const { parseSessionJsonl, parseSessionLog, turnKey } = await import(join(ROOT, "src", "services", "sessions.mjs"));
  const { clearCache } = await import(join(ROOT, "src", "adapters", "source.mjs")); // H1a — see runSessionCase

  // The runner's fixture pipeline mirrors a REAL graph writer's: raw payload ->
  // ingestSchemaDocs() -> the artifact (a real graph.json always carries the
  // schema-doc individuals — test/tools/ask.test.mjs's buildGraph plays the same
  // trick). The ingested payload is materialized ONCE to a throwaway file so
  // the dispatchTool path (which re-reads config.graphFile per ask) sees the
  // same graph the pre-parsed `graph` object holds; runTurn never writes to it.
  const graphJson = JSON.stringify(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8"))));
  const graphDir = await mkdtemp(join(tmpdir(), "tmct-chatbench-graph-"));
  const graphFile = join(graphDir, "graph.json");
  await writeFile(graphFile, graphJson);
  const config = { graphFile };
  const graph = parseEntities(JSON.parse(graphJson));
  const deps = { runTurn, runChat, parseSessionJsonl, parseSessionLog, turnKey, clearCache, config, graph, graphJson, stamp };
  return { deps, cleanup: () => rm(graphDir, { recursive: true, force: true }) };
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

/** Run one draw's graded cases grade-ascending, honoring --ladder gating
 *  (META-2, archive/PLAN_CYCLE_4.md): grades run A1→C2; the FIRST grade whose
 *  non-frontier cases don't all pass tier-1 GATES — every grade above it is
 *  SKIPPED with a receipt ("grade C1 skipped: B1 at 4/6"), so judged spend never
 *  chases a ceiling while the floor leaks. `run` is injectable (defaults to the
 *  real runCase) so the gating integration is unit-testable without the engine.
 *  Returns { rows, skipped, reliabilityByGrade } where skipped = [{grade, reason}]. */
export async function runGradedDraw(gradedCases, deps, { ladder, run = runCase, concurrency = 1 } = {}) {
  const rows = [];
  const skipped = [];
  const reliabilityByGrade = {};
  let gatedBy = null;
  for (const grade of GRADES) {
    const ofGrade = gradedCases.filter((c) => c.grade === grade);
    if (!ofGrade.length) continue;
    if (ladder && gatedBy) {
      skipped.push({ grade, reason: gatedBy });
      continue;
    }
    const gradeRows = await runCasesOrdered(ofGrade, deps, { run, concurrency });
    rows.push(...gradeRows);
    reliabilityByGrade[grade] = gradeReliability(gradeRows);
    if (ladder && !reliabilityByGrade[grade].reliable) {
      const r = reliabilityByGrade[grade];
      gatedBy = `${grade} at ${r.passing}/${r.real}`;
    }
  }
  return { rows, skipped, reliabilityByGrade };
}

function reportRows(label, rows) {
  const passed = rows.filter((r) => r.tier1.pass).length;
  const baseline = rows.filter((r) => r.tier1.baselineFailTurns.length).length;
  const improved = rows.filter((r) => r.tier1.improvedBaselineTurns.length);
  console.log(`${label}: ${rows.length} case(s) — tier-1 pass ${passed}/${rows.length} (${baseline} carry baselineFail turns).`);
  if (improved.length) console.log(`baseline improvements (documented weaknesses now passing): ${improved.map((r) => r.caseId).join(", ")}`);
  for (const r of rows.filter((x) => !x.tier1.pass)) {
    console.log(`  FAIL ${r.caseId}: ${r.tier1.failing.map((f) => `turn ${f.turn + 1} ${f.key} (expected ${JSON.stringify(f.expected)})`).join("; ")}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.stamp || !/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("chatbench/run.mjs: --stamp <label> is required (a filesystem-safe label; ids never come from Date.now).");
    return 2;
  }
  if (!(args.sample > 0 && args.sample <= 1)) {
    console.error("chatbench/run.mjs: --sample must be a fraction in (0, 1].");
    return 2;
  }
  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);

  // cases.jsonl is optional (case-set v3, 2026-07-10): the frozen v1 core was
  // folded into graded-pool.jsonl as fully-graded cells rather than kept as a
  // separate always-run, ungraded tier — see GRADED.md. A caller may still
  // point --cases at a local file for a custom always-run set; absent that,
  // this tier is simply empty and every case runs through the graded pool.
  const casesPath = args.cases === DEFAULT_CASES && !(await fileExists(DEFAULT_CASES)) ? null : args.cases;
  const { cases, errors } = casesPath
    ? parseCases(await readFile(casesPath, "utf8"))
    : { cases: [], errors: [] };
  if (errors.length) {
    console.error(`cases lint failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 2;
  }

  // Graded pool (case-set v2): loaded when present (or named via --pool),
  // sampled per cell. "--pool none" opts out entirely.
  let pool = [];
  const poolPath = args.pool === "none" ? null : args.pool ?? ((await fileExists(DEFAULT_POOL)) ? DEFAULT_POOL : null);
  if (poolPath) {
    const parsed = parseCases(await readFile(poolPath, "utf8"));
    if (parsed.errors.length) {
      console.error(`graded pool lint failed (${parsed.errors.length}):`);
      for (const e of parsed.errors) console.error(`  - ${e}`);
      return 2;
    }
    pool = parsed.cases.filter((c) => c.grade);
    const dupes = pool.filter((c) => cases.some((v) => v.id === c.id)).map((c) => c.id);
    if (dupes.length) {
      console.error(`graded pool ids collide with cases.jsonl: ${dupes.join(", ")}`);
      return 2;
    }
  }
  if (args.grade && !GRADES.includes(args.grade)) {
    console.error(`--grade must be one of ${GRADES.join("|")}`);
    return 2;
  }
  if (args.grade) pool = pool.filter((c) => c.grade === args.grade);

  let selected = args.only ? cases.filter((c) => args.only.includes(c.id)) : cases;
  if (args.grade) selected = []; // --grade runs one graded band only
  if (args.only) {
    const fromPool = pool.filter((c) => args.only.includes(c.id));
    if (selected.length + fromPool.length !== args.only.length) {
      const known = new Set([...cases, ...pool].map((c) => c.id));
      console.error(`--only names unknown case ids: ${args.only.filter((id) => !known.has(id)).join(", ")}`);
      return 2;
    }
    pool = fromPool;
  }

  // Sampling: --only pins exact ids (no sampling); the default --sample 1
  // takes the whole pool as a single draw (the go-to profile,
  // SKILL_BENCHMARK_CEFR_ENGLISH.md §1). Narrowing --sample below 1 switches
  // to a stratified seeded draw per cell — DUAL by default (parallel-forms
  // reliability, see GRADED.md): two disjoint-where-possible draws whose
  // per-cell agreement is the instrument's self-test. Seeds derive from the
  // stamp unless --seed.
  const dual = args.only ? false : (args.dual ?? pool.length > 0);
  const seedA = args.seed ?? fnv1a(args.stamp);
  const seedB = (seedA + 1) >>> 0;
  let drawA = pool;
  let drawB = [];
  if (pool.length && !args.only && args.sample < 1) {
    if (dual) {
      ({ a: drawA, b: drawB } = dualDraws(pool, { fraction: args.sample, seedA, seedB }));
    } else {
      drawA = stratifiedSample(pool, { fraction: args.sample, seed: seedA });
    }
  } else if (pool.length && dual && args.sample >= 1) {
    drawB = []; // a full-pool run has nothing left to cross-validate against
  }

  // Skip-unchanged execution (PLAN lever 6): with --reuse <prior.jsonl> and
  // --engine-token <tok>, a case whose input hash and engine token match a prior
  // row inherits that row instead of replaying. Without a token nothing is
  // reused and rows are byte-identical to a plain run. --concurrency shards the
  // turns-mode replays across workers (session cases stay sequential).
  const concurrency = args.concurrency ?? 1;
  const engineToken = args.engineToken ?? null;
  const priorRows = args.reuse ? parseJsonl(await readFile(args.reuse, "utf8")) : [];
  const { reuse, counts: reuseCounts } = partitionForReuse([...selected, ...drawA, ...drawB], priorRows, engineToken);
  const run = makeReusingRunner({ reuse, engineToken });

  const { deps, cleanup } = await createRunnerDeps(args.stamp);
  const rows = [];
  const rowsB = [];
  let skippedA = [];
  let skippedB = [];
  // Total run wall-time: a monotonic clock wrapped around the ENTIRE product
  // replay (both draws). Wall-clock, so it varies run to run and is kept out of
  // every determinism/row-equality assertion — it lands only in timings.json.
  const wallStart = performance.now();
  try {
    rows.push(...await runCasesOrdered(selected, deps, { run, concurrency }));
    if (drawA.length) {
      deps.sampling = { seed: seedA, fraction: args.sample, draw: dual ? "A" : "single" };
      const a = await runGradedDraw(drawA, deps, { ladder: args.ladder, run, concurrency });
      rows.push(...a.rows);
      skippedA = a.skipped;
    }
    if (drawB.length) {
      deps.sampling = { seed: seedB, fraction: args.sample, draw: "B" };
      const b = await runGradedDraw(drawB, deps, { ladder: args.ladder, run, concurrency });
      rowsB.push(...b.rows);
      skippedB = b.skipped;
    }
    delete deps.sampling;
  } finally {
    await cleanup();
  }
  if (engineToken) console.log(`skip-unchanged: ${reuseCounts.reused} reused, ${reuseCounts.run} replayed (${reuseCounts.total} total, engine token ${engineToken}).`);
  const wallMs = performance.now() - wallStart;

  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, dual && rowsB.length ? "product-a.jsonl" : "product.jsonl");
  await writeFile(productFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  reportRows(`chatbench run ${args.stamp}${dual && rowsB.length ? " (draw A)" : ""}`, rows);
  for (const s of skippedA) console.log(`  grade ${s.grade} skipped: ${s.reason}`);
  console.log(`product: ${productFile}`);

  if (rowsB.length) {
    const productFileB = join(outDir, "product-b.jsonl");
    await writeFile(productFileB, rowsB.map((r) => JSON.stringify(r)).join("\n") + "\n");
    reportRows(`chatbench run ${args.stamp} (draw B)`, rowsB);
    for (const s of skippedB) console.log(`  grade ${s.grade} skipped: ${s.reason}`);
    console.log(`product: ${productFileB}`);

    const agreement = computeAgreement(rows.filter((r) => r.grade), rowsB, {});
    agreement.seeds = { a: seedA, b: seedB };
    agreement.stamp = args.stamp;
    const agreementFile = join(outDir, "agreement.json");
    await writeFile(agreementFile, JSON.stringify(agreement, null, 2) + "\n");
    console.log("\ndual-draw agreement (the instrument's self-test):");
    console.log(renderAgreementTable(agreement));
    console.log(`agreement: ${agreementFile}`);
  }

  const graded = rows.filter((r) => r.grade);
  if (graded.length) {
    console.log(`\ngraded rollup (draw A, seed ${seedA}, sample ${args.sample}):`);
    console.log(renderRollup(gradedRollup(graded)));
    const tlFindings = templateLaneLint([...graded, ...rowsB.filter((r) => r.grade)]);
    if (tlFindings.length) {
      console.log("\ntemplate-lane lint (a template-lane pass must NOT be composed):");
      for (const f of tlFindings) console.log(`  - ${f.cell} ${f.caseId}: ${f.finding}`);
    }
  }

  // TIMINGS (cycle-005): total run wall-time + per-CEFR-grade / v1-spine rollup
  // of the per-row product replay time. Aggregated over EVERY replayed row (v1
  // spine + graded draw A + draw B) and persisted to a machine-readable
  // timings.json the write-up reads. Wall-clock — informational only, NEVER part
  // of product-row equality or the determinism/byte-stability checks.
  const timings = timingRollup([...rows, ...rowsB], { wallMs });
  timings.stamp = args.stamp;
  const timingsFile = join(outDir, "timings.json");
  await writeFile(timingsFile, JSON.stringify(timings, null, 2) + "\n");
  console.log("\ntimings (wall-clock — informational, excluded from determinism/row-equality checks):");
  console.log(renderTimings(timings));
  console.log(`timings: ${timingsFile}`);

  if (args.compare) {
    const prior = parseJsonl(await readFile(args.compare, "utf8"));
    const { regressions, newCases } = compareProducts(prior, rows);
    if (newCases.length) console.log(`new cases since compare base: ${newCases.join(", ")}`);
    if (regressions.length) {
      console.error(`TIER-1 REGRESSIONS vs ${args.compare}: ${regressions.join(", ")}`);
      return 1;
    }
    console.log("no tier-1 regressions vs compare base (checked on the id intersection — sampled graded sets compare cell-level means across cycles, GRADED.md).");
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
