// scripts/claims/claim-cite.mjs — every fact answer in a hand-authored,
// citation-designed fixture (test-benchmarks/claims/cite-set.jsonl) carries a
// resolvable "(source: ...)" citation. A refusal is data, not a failure: it
// is counted, never held to the citation bar. Whole-pool citation coverage
// (test-benchmarks/chatbench/graded-pool.jsonl, every lane, unfiltered)
// publishes alongside so how narrow that coverage is stays visible.
import { readFile, rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, PassThrough } from "node:stream";
import { writeClaim } from "./lib.mjs";
import { DEFAULT_POOL, parseCases as parsePoolCases, createRunnerDeps, runTurnsCase } from "../../test-benchmarks/chatbench/run.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CITE_SET_PATH = join(ROOT, "test-benchmarks", "claims", "cite-set.jsonl");
const RELATIVE_CITE_SET = "test-benchmarks/claims/cite-set.jsonl";
const RELATIVE_POOL = "test-benchmarks/chatbench/graded-pool.jsonl";

// A pool-wide sweep found the pool's own tags/construction metadata never
// isolates "this turn cites a fact" — tags is case-level and mixes citing and
// non-citing turns inside one label (honesty-miss alone covers a real
// proof-chain veto AND a number-guessing game); construction is a CEFR
// coverage-accounting key reused across unrelated answer types (assert-recall
// is mostly greeting cases folded in for matrix coverage). Restricting to the
// one best-justified tag (honesty-miss) still measured 3/15: real, but not
// what "every fact answer cites" should mean. That is why this claim measures
// a hand-authored fixture instead of a pool filter.
const LANE_ANALYSIS_NOTE = "the pool's tags/construction fields are case-level and mix citing with non-citing turns (e.g. honesty-miss covers both a disjointness proof and a number-guessing game); no existing pool field isolates a citing-answer lane, so this claim measures a hand-authored fixture instead of a pool filter";

// The same "(source: ...)" convention chat-page-viz.mjs's provenanceChipFor
// reads off the visible answer text.
const CITATION_RE = /\(source: ([^)]+)\)/g;
// chat.mjs's citationProvenance strips a peer tag's node-id segment before it
// reaches the answer text, so a stored row's raw tag needs the same strip
// before it can compare equal to a rendered citation.
const NODE_MARKER_RE = /#node:[0-9a-f]+/g;
const stripNodeMarker = (s) => s.replace(NODE_MARKER_RE, "");

function citationsIn(answer) {
  return [...String(answer ?? "").matchAll(CITATION_RE)].map((m) => stripNodeMarker(m[1]));
}

/** Every provenance string the case's own memory store folds to via
 *  readFactRows — the seam chat.mjs cites answers from — plus each of a
 *  multi-source row's " | "-joined tags on its own, so a citation naming one
 *  tag out of a corroborated union still resolves. */
function knownCitationsFrom(factRows) {
  const known = new Set();
  for (const row of factRows) {
    const full = stripNodeMarker(row.provenance || "");
    if (full) known.add(full);
    for (const tag of full.split(" | ")) if (tag) known.add(tag);
  }
  return known;
}

// A reference-pack or live-Wikipedia clean-miss answer cites the article in
// human prose (reference-pack.mjs's renderReferenceAnswer/renderLiveReferenceAnswer,
// research.mjs's renderResearchAnswer) — richer than, and textually distinct
// from, the compact reference:<pack>:<article>@<revid> tag the SAME article's
// persisted fact carries once recalled (citationProvenance/renderFactLine).
// Both name the identical, verifiable source, so a prose citation resolves
// when its article title matches a reference-sourced fact row this case's
// memory actually holds — this is a resolution-precision fix in THIS rig's
// matching, not a product change.
const PROSE_ARTICLE_RE = /^(?:reference|research|live Wikipedia) article "([^"]+)"/;

/** Titles of every reference/referenceLive-sourced fact the case's memory
 *  holds, revid/depth suffix stripped (provenanceTagToSource keeps it on the
 *  article field; renderReferenceAnswer's prose cites the bare title). */
function referenceArticleTitlesFrom(factRows) {
  const titles = new Set();
  for (const row of factRows) {
    for (const tag of stripNodeMarker(row.provenance || "").split(" | ")) {
      if (!tag) continue;
      const source = provenanceTagToSource(tag);
      if (source && (source.kind === "reference" || source.kind === "referenceLive")) {
        titles.add(source.article.split("@")[0]);
      }
    }
  }
  return titles;
}

function resolves(citation, known, referenceArticleTitles) {
  if (known.has(citation)) return true;
  const segments = citation.split(" | ").filter(Boolean);
  if (segments.length > 0 && segments.every((seg) => known.has(seg))) return true;
  const proseMatch = PROSE_ARTICLE_RE.exec(citation);
  return Boolean(proseMatch && referenceArticleTitles.has(proseMatch[1]));
}

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  out.resume(); // discard — answers are read back from the session log
  return out;
}

function parseCiteSet(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Read a case's own memory store back into readFactRows rows — the fact
 *  rows an answer produced anywhere in this case could truthfully cite. */
async function factRowsIn(dir) {
  const { openMemoryBackend, loadMemory, readFactRows } = await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));
  try {
    const { dir: memHandle } = await openMemoryBackend(dir, "");
    return readFactRows(await loadMemory(memHandle));
  } catch {
    return [];
  }
}

/** Run one fixture case from a FRESH store: an empty repo, no .tmct/graph.json
 *  seeded ahead of time, so runChat's own W3 bootstrap seeds the default
 *  corpus.human slice exactly as a real first run would (the "default-seed"
 *  kind's whole premise). All of a case's turns run as ONE session, so a
 *  teach turn's write is visible to its own ask-back turn and a first-ask
 *  reference-pack citation's persisted fact is visible to its own second ask. */
async function runFixtureCase(caseDef) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-claim-cite-fixture-${caseDef.id.replace(/[^A-Za-z0-9-]/g, "_")}-`));
  try {
    const { runChat } = await import(join(ROOT, "src", "services", "chat.mjs"));
    const { parseSessionJsonl, parseSessionLog, turnKey } = await import(join(ROOT, "src", "services", "sessions.mjs"));
    const lines = [...caseDef.turns.map((t) => t.say), "/exit"].map((l) => `${l}\n`);
    const { logFile, sidecarFile } = await runChat({
      repoPath: dir,
      input: Readable.from(lines),
      output: sink(),
      env: { NO_COLOR: "1" },
    });
    const rec = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
    const answers = parseSessionLog(await readFile(logFile, "utf8"));
    const records = rec?.turns ?? [];
    const outcomes = caseDef.turns.map((turn, i) => {
      const record = records[i];
      const matched = record && record.query === turn.say;
      return {
        checkCitation: turn.checkCitation !== false,
        matched,
        answer: matched ? (answers.get(turnKey(record.ts, record.query)) ?? "") : "",
        miss: matched ? record.miss : null,
      };
    });
    return { outcomes, factRows: await factRowsIn(dir) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run one pool row (turns or session mode) the way chatbench/run.mjs itself
 *  does, reading the case's own memory store back before its temp dir is
 *  removed — the whole-pool coverage figure needs the same fact rows the
 *  fixture measurement does, and run.mjs's own runCase/runSessionCase never
 *  hand that state back to a caller. */
async function runPoolCaseWithMemory(caseDef, deps) {
  if (caseDef.mode !== "session") {
    const { transcript } = await runTurnsCase(caseDef, deps);
    return { outcomes: transcript.map((t) => ({ checkCitation: true, matched: true, answer: t.answer, miss: t.miss })), factRows: [] };
  }
  const { runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson, clearCache } = deps;
  const dir = await mkdtemp(join(tmpdir(), `tmct-claim-cite-pool-${caseDef.id.replace(/[^A-Za-z0-9-]/g, "_")}-`));
  try {
    if ((caseDef.graph ?? "fixture") === "fixture") {
      await mkdir(join(dir, ".tmct"), { recursive: true });
      await writeFile(join(dir, ".tmct", "graph.json"), graphJson);
    }
    const bySession = new Map();
    for (const turn of caseDef.turns) {
      const s = turn.session ?? 1;
      if (!bySession.has(s)) bySession.set(s, []);
      bySession.get(s).push(turn);
    }
    const outcomes = [];
    for (const [, turns] of bySession) {
      // Real sessions are separate processes, so the source-file read cache
      // never spans two of them; this replay runs every session inside one
      // process, so the cache needs the same clearing between sessions or a
      // later session would see the earlier one's stale pre-write payload.
      clearCache?.();
      const lines = [...turns.map((t) => t.say), "/exit"].map((l) => `${l}\n`);
      const { logFile, sidecarFile } = await runChat({
        repoPath: dir,
        input: Readable.from(lines),
        output: sink(),
        env: { NO_COLOR: "1", ...(caseDef.env || {}) },
      });
      const rec = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
      const parsedAnswers = parseSessionLog(await readFile(logFile, "utf8"));
      const records = rec?.turns ?? [];
      turns.forEach((turn, i) => {
        const record = records[i];
        const matched = record && record.query === turn.say;
        outcomes.push({
          checkCitation: true,
          matched,
          answer: matched ? (parsedAnswers.get(turnKey(record.ts, record.query)) ?? "") : "",
          miss: matched ? record.miss : null,
        });
      });
    }
    return { outcomes, factRows: await factRowsIn(dir) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Score one case's outcomes into a caller-owned tally. `scope.total`/
 *  `resolved`/`refusals` accumulate; failures (checkCitation turns whose
 *  non-refusal answer has zero or an unresolvable citation) push onto
 *  `failures` tagged with `caseId`. */
function scoreOutcomes(caseId, outcomes, factRows, { total, resolved, refusals, failures }) {
  const known = knownCitationsFrom(factRows);
  const referenceArticleTitles = referenceArticleTitlesFrom(factRows);
  outcomes.forEach((outcome, turnIndex) => {
    if (!outcome.checkCitation) return; // a setup/teach turn — scaffolding, not the measured answer
    if (!outcome.matched) {
      failures.push({ caseId, turn: turnIndex + 1, why: "turn not recorded in the session sidecar" });
      return;
    }
    if (outcome.miss === true) {
      refusals.value += 1;
      return;
    }
    total.value += 1;
    const cites = citationsIn(outcome.answer);
    if (!cites.length) {
      failures.push({ caseId, turn: turnIndex + 1, why: "non-refusal answer carries no (source: ...) citation" });
      return;
    }
    const bad = cites.filter((c) => !resolves(c, known, referenceArticleTitles));
    if (bad.length) {
      failures.push({ caseId, turn: turnIndex + 1, why: `unresolvable citation(s): ${bad.join("; ")}` });
      return;
    }
    resolved.value += 1;
  });
}

async function main() {
  const fixtureRows = parseCiteSet(await readFile(CITE_SET_PATH, "utf8"));

  const total = { value: 0 };
  const resolved = { value: 0 };
  const refusals = { value: 0 };
  const failures = [];
  const byKind = {};

  const t0 = performance.now();
  for (const caseDef of fixtureRows) {
    const before = { total: total.value, resolved: resolved.value, refusals: refusals.value };
    const { outcomes, factRows } = await runFixtureCase(caseDef);
    scoreOutcomes(caseDef.id, outcomes, factRows, { total, resolved, refusals, failures });
    const kindStats = (byKind[caseDef.kind] ??= { total: 0, resolved: 0, refusals: 0 });
    kindStats.total += total.value - before.total;
    kindStats.resolved += resolved.value - before.resolved;
    kindStats.refusals += refusals.value - before.refusals;
  }
  const fixtureRuntimeMs = Math.round(performance.now() - t0);

  // Whole-pool citation coverage (every lane, unfiltered) — the same 5/222-
  // shaped measurement the pool-only cut of this claim produced, published as
  // context so the fixture's own strict number is never read as "the whole
  // product cites everything".
  const poolText = await readFile(DEFAULT_POOL, "utf8");
  const { cases: poolCases, errors: poolErrors } = parsePoolCases(poolText);
  if (poolErrors.length) throw new Error(`graded pool lint failed:\n${poolErrors.map((e) => `  - ${e}`).join("\n")}`);
  const poolTotal = { value: 0 };
  const poolResolved = { value: 0 };
  const poolRefusals = { value: 0 };
  const poolFailures = [];
  const t1 = performance.now();
  const { deps, cleanup } = await createRunnerDeps("claim-cite-pool-coverage");
  try {
    for (const caseDef of poolCases) {
      const { outcomes, factRows } = await runPoolCaseWithMemory(caseDef, deps);
      scoreOutcomes(caseDef.id, outcomes, factRows, { total: poolTotal, resolved: poolResolved, refusals: poolRefusals, failures: poolFailures });
    }
  } finally {
    await cleanup();
  }
  const poolRuntimeMs = Math.round(performance.now() - t1);

  const detail = {
    total: total.value,
    refusals: refusals.value,
    runtimeMs: fixtureRuntimeMs,
    byKind,
    poolCoverage: {
      citedAnswers: poolResolved.value,
      totalNonRefusal: poolTotal.value,
      runtimeMs: poolRuntimeMs,
      pool: RELATIVE_POOL,
    },
    laneNote: LANE_ANALYSIS_NOTE,
  };
  if (failures.length) detail.failures = failures;

  writeClaim("cite", {
    value: resolved.value,
    unit: "answers",
    threshold: { direction: "min", value: total.value },
    sources: [RELATIVE_CITE_SET, RELATIVE_POOL],
    detail,
  });

  console.log(`claim:cite — ${resolved.value}/${total.value} fact answers cite a resolvable fact row (${refusals.value} refusal(s), ${fixtureRuntimeMs}ms).`);
  console.log(`kind-by-kind: ${Object.entries(byKind).map(([k, v]) => `${k} ${v.resolved ?? 0}/${v.total ?? 0} (${v.refusals ?? 0} refusal(s))`).join("; ")}`);
  console.log(`pool-wide coverage — ${poolResolved.value}/${poolTotal.value} non-refusal answers across every lane (${poolRuntimeMs}ms).`);
  if (failures.length) {
    console.log(`${failures.length} counterexample(s) in the fixture:`);
    for (const f of failures) console.log(`  ${f.caseId} turn ${f.turn}: ${f.why}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
