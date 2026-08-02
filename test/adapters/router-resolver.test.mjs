// router-resolver.test.mjs — the capability router's resolver and planner.
// Deterministic, no-LLM. The headline is the BIDIRECTIONAL CONFORMANCE test:
// every ask-vocab relation kind maps to a capability (or is explicitly
// unmapped-with-reason), and every capability is reachable (or tagged
// not-NL-reachable) — no orphans either way, enforced as a HARD failure.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { resolveObject } from "../../src/domain/ask.mjs";
import { RELATIONS } from "../../src/domain/ask-vocab.mjs";
import { COMMANDS, selectTool } from "../../src/services/chat.mjs";
import { capabilities, isCapability, effectsOf } from "../../src/domain/router/registry.mjs";
import {
  NL_INTENTS, UNMAPPED_KINDS, NOT_NL_REACHABLE, FRAMES,
  backwardChain, mapParse, mapFrame, commandCapability, resolveOne,
  reachableCapabilityNames, extractEntity,
} from "../../src/domain/router/resolver.mjs";
import { decompose, isMultiStep, plan, MAX_STEPS } from "../../src/domain/router/planner.mjs";
import { resolverDriver } from "../../test-benchmarks/agentbench/driver-resolver.mjs";
import { runAgentbench, createRunCtx } from "../../test-benchmarks/agentbench/run.mjs";
import { parseCases, COMPLETION_FLOOR } from "../../test-benchmarks/agentbench/grade.mjs";

const CASES_FILE = fileURLToPath(new URL("../../test-benchmarks/agentbench/cases.jsonl", import.meta.url));

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
async function graphCtx() {
  const graph = parseEntities(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8"))));
  const resolve = (term) => resolveObject(graph, term);
  // an in-memory dispatch that GROUNDS via the same resolver (no real dispatchTool
  // needed for unit routing — the resolves precondition is what we exercise).
  const dispatch = async (name, input) => {
    const primary = input && (input.symbol ?? input.module ?? input.class ?? input.query);
    if (primary && name !== "tmct_search") {
      const r = resolve(String(primary));
      if (!r.match) return { ok: false, error: `no entity matching "${primary}"` };
      return { ok: true, text: `[${name}] ${r.match.label}`, resolved: r.match };
    }
    return { ok: true, text: `[${name}] ok`, resolved: null };
  };
  return { resolve, dispatch, graph, selectTool };
}

// A genuinely AMBIGUOUS in-memory graph (same construction ask-compound-resolve.
// test.mjs uses): two distinct Modules that tie on the SAME query term, so
// resolveObject returns {match, candidates, ambiguous:true} for real — the exact
// shape the breadth-first enrichment (resolveOne's `candidateResults`) is built
// to run every candidate through.
function ambiguousGraphCtx() {
  const entities = buildEntities([
    { path: "old-payment-system.js", dotted: "oldPaymentSystem", imports: [], calls: [], defines: [] },
    { path: "new-payment-system.js", dotted: "newPaymentSystem", imports: [], calls: [], defines: [] },
  ], []);
  ingestSchemaDocs(entities);
  const graph = parseEntities(entities);
  const resolve = (term) => resolveObject(graph, term);
  const dispatch = async (name, input) => ({ ok: true, text: `[${name}] ok for ${input.module ?? input.symbol ?? input.class ?? ""}`, resolved: null });
  return { resolve, dispatch, graph, selectTool };
}

// ONE module-scope context of each grain (0.8.2 speed insurance): the in-memory
// unit ctx (read-only routing oracle — parsed once, no cleanup needed) and the
// real run ctx (materialized fixture graph for the runAgentbench e2e, passed
// through { ctx } so the harness skips its own create/cleanup; cleaned once in
// the after-hook). Every consumer is read-only, so sharing is safe.
const UNIT_CTX = await graphCtx();
const SHARED = await createRunCtx();
after(() => SHARED.cleanup());

// ---- 1. THE BIDIRECTIONAL CONFORMANCE (the headline) ------------------------

test("conformance A→cap: every ask-vocab relation kind is mapped OR explicitly unmapped — no silent gap", () => {
  const mappedKinds = new Set(Object.keys(NL_INTENTS).map((k) => k.split(":")[1]));
  for (const kind of Object.keys(RELATIONS)) {
    const mapped = mappedKinds.has(kind);
    const unmapped = kind in UNMAPPED_KINDS;
    assert.ok(mapped !== unmapped, `ask-vocab kind "${kind}" must be EITHER mapped in NL_INTENTS OR listed in UNMAPPED_KINDS (with a reason), never both/neither`);
    if (unmapped) assert.equal(typeof UNMAPPED_KINDS[kind], "string", `UNMAPPED_KINDS.${kind} carries a reason`);
  }
});

test("conformance A→cap: every NL_INTENT and FRAME backward-chains to a REAL registered capability (no dangling mapping)", () => {
  for (const [key, v] of Object.entries(NL_INTENTS)) {
    const cap = backwardChain(v.topic);
    assert.ok(cap, `NL_INTENT ${key} -> topic "${v.topic}" must backward-chain to a capability`);
    assert.ok(isCapability(cap.name), `${cap.name} is a real capability`);
  }
  for (const f of FRAMES) {
    const cap = backwardChain(f.topic);
    assert.ok(cap, `FRAME topic "${f.topic}" must backward-chain to a capability`);
  }
});

test("conformance cap→A: EVERY registered capability is reachable (NL/frame/command) OR tagged not-NL-reachable — NO orphans", () => {
  // reachable via an NL intent / imperative frame ...
  const reachable = new Set(reachableCapabilityNames());
  // ... or via a command verb whose tool is a registered capability.
  for (const spec of Object.values(COMMANDS)) if (isCapability(spec.tool)) reachable.add(spec.tool);

  const orphans = [];
  for (const cap of capabilities()) {
    if (reachable.has(cap.name)) continue;
    if (cap.name in NOT_NL_REACHABLE) {
      assert.equal(typeof NOT_NL_REACHABLE[cap.name], "string", `${cap.name} tag carries a reason`);
      continue;
    }
    orphans.push(cap.name); // a declared-but-unreachable cap is a ROUTING GAP — must FAIL
  }
  assert.deepEqual(orphans, [], `unreachable capabilities must be mapped or tagged in NOT_NL_REACHABLE (found orphans: ${orphans.join(", ")})`);

  // and the tag must not OVER-claim: a tagged cap must genuinely be unreachable.
  for (const name of Object.keys(NOT_NL_REACHABLE)) {
    assert.ok(isCapability(name), `NOT_NL_REACHABLE names a real capability: ${name}`);
    assert.ok(!reachable.has(name), `${name} is tagged not-reachable but IS reachable — remove the tag`);
  }
});

// ---- 2. resolver routing (backward chaining + resolveObject binding) ---------

test("resolver: NL parse routes via backward chaining to the right capability + bound arg", async () => {
  const ctx = UNIT_CTX;
  const cases = [
    ["which functions call fnAlpha", ["tmct_callers", "tmct_callees"], "tmct_callers", { symbol: "fnAlpha" }],
    ["what does app/lib/b.mjs export", ["tmct_exports"], "tmct_exports", { module: "app/lib/b.mjs" }],
    ["which classes extend Base", ["tmct_subclasses"], "tmct_subclasses", { class: "Base" }],
    ["which tests cover app/lib/b.mjs", ["tmct_tests_for"], "tmct_tests_for", { symbol: "app/lib/b.mjs" }],
  ];
  for (const [q, tools, name, input] of cases) {
    const r = await resolveOne(q, tools, ctx);
    assert.ok(!r.refused, `${q}: ${r.reason}`);
    assert.equal(r.selected.name, name, q);
    assert.deepEqual(r.selected.input, input, q);
    assert.ok(r.proof.length > 0, `${q}: has a proof chain`);
  }
});

test("resolver: terse command forms route via the command register (tier 1), even when the NL grammar mis-parses", async () => {
  const ctx = UNIT_CTX;
  // "callees Widget.render" keyword-spots to reverse/calls (would route to callers)
  // — the command register wins and routes to callees, correctly.
  const r = await resolveOne("callees Widget.render", ["tmct_callees", "tmct_callers"], ctx);
  assert.equal(r.selected.name, "tmct_callees");
  assert.deepEqual(r.selected.input, { symbol: "Widget.render" });

  const s = await resolveOne("search for widget", ["tmct_search"], ctx);
  assert.equal(s.selected.name, "tmct_search");
  assert.deepEqual(s.selected.input, { query: "widget" }, "the leading 'for' is stripped from the search query");
});

test("resolver: imperative frames fill what the grammar + command register miss (blast radius, untested)", async () => {
  const ctx = UNIT_CTX;
  const imp = await resolveOne("what is the impact of changing app/lib/a.mjs", ["tmct_impact", "tmct_describe"], ctx);
  assert.equal(imp.selected.name, "tmct_impact");
  assert.deepEqual(imp.selected.input, { module: "app/lib/a.mjs" });

  const unt = await resolveOne("list the untested symbols", ["tmct_untested"], ctx);
  assert.equal(unt.selected.name, "tmct_untested");
  assert.deepEqual(unt.selected.input, {});
});

// ---- widened imperative reach + tmct_calls reachability -----------------------

test("imperative reach: tmct_calls is NL-reachable via a dedicated edge-dump frame; NOT_NL_REACHABLE is empty", async () => {
  // every registered capability is reachable now — tmct_related closed the
  // last gap via the synonym/related frame + resolveMemoryTerm (below).
  assert.deepEqual(Object.keys(NOT_NL_REACHABLE), [], "no capability is tagged not-NL-reachable");
  assert.ok(reachableCapabilityNames().has("tmct_calls"), "tmct_calls is reachable via a frame");
  assert.equal(backwardChain("calls").name, "tmct_calls", "the 'calls' topic backward-chains to tmct_calls");

  const ctx = UNIT_CTX;
  // the explicit edge-dump phrasing reaches tmct_calls WITHOUT colliding with the
  // relational 'call' verb (tmct_callees is also in-set and must NOT be selected).
  for (const q of ["show the call edges of Widget.render", "the call graph of Widget.render", "list the outgoing calls from Widget.render"]) {
    const r = await resolveOne(q, ["tmct_calls", "tmct_callees"], ctx);
    assert.ok(!r.refused, `${q}: ${r.reason}`);
    assert.equal(r.selected.name, "tmct_calls", q);
    assert.deepEqual(r.selected.input, { symbol: "Widget.render" }, q);
  }
  // the relational 'what does X call' STILL routes to callees (no collision).
  const callees = await resolveOne("what does Widget.render call", ["tmct_calls", "tmct_callees"], ctx);
  assert.equal(callees.selected.name, "tmct_callees");
});

test("resolver: the synonym/related frame reaches tmct_related via resolveMemoryTerm (the memory-graph binding oracle), across held-out phrasings", async () => {
  assert.ok(reachableCapabilityNames().has("tmct_related"), "tmct_related is reachable via the synonym/related frame");
  const ctx = SHARED.ctx; // seeds MEMORY_FIXTURE: couch synonym sofa, sofa relatedTo cushion
  for (const q of ["another word for sofa", "a synonym for sofa", "synonyms of sofa", "what's related to sofa"]) {
    const r = await resolveOne(q, ["tmct_related"], ctx);
    assert.ok(!r.refused, `${q}: ${r.reason}`);
    assert.equal(r.selected.name, "tmct_related", q);
    assert.deepEqual(r.selected.input, { term: "sofa" }, q);
    assert.ok(r.proof.some((s) => s.pred === "cap:memory-facts" && s.ok), `${q}: proof carries the memory-facts precondition`);
    assert.ok(r.proof.some((s) => s.pred === "cap:resolves" && s.param === "term" && s.ok), `${q}: proof carries the memory-graph resolves step`);
  }
});

test("resolver: a term the memory graph holds no facts for stays an honest refuse, never a guess", async () => {
  const ctx = SHARED.ctx;
  const r = await resolveOne("another word for zzznotaterm", ["tmct_related"], ctx);
  assert.equal(r.refused, true);
  assert.deepEqual(r.selected, null);
  assert.match(r.reason, /memory graph holds no facts/);
});

test("imperative reach: a bare imperative the grammar+command register both miss ('explain X') binds via the description frame", async () => {
  const ctx = UNIT_CTX;
  const r = await resolveOne("explain Widget", ["tmct_describe", "tmct_members"], ctx);
  assert.ok(!r.refused, r.reason);
  assert.equal(r.selected.name, "tmct_describe");
  assert.deepEqual(r.selected.input, { symbol: "Widget" });
});

test("imperative reach: an OUT-OF-SET NL parse is rescued by an imperative frame that reaches a DECLARED capability", async () => {
  const ctx = UNIT_CTX;
  // keyword-spot mis-reads 'outgoing calls of X' toward the relational calls shape
  // (which would select an out-of-set callers/callees); the frame reaches the
  // declared tmct_calls instead of refusing — the resolveOne fall-through.
  const r = await resolveOne("list the outgoing calls from fnAlpha", ["tmct_calls"], ctx);
  assert.ok(!r.refused, r.reason);
  assert.equal(r.selected.name, "tmct_calls");
  assert.deepEqual(r.selected.input, { symbol: "fnAlpha" });
});

test("imperative reach: the sharp boundary — an UNDECLARED verb ('refactor') is refused, never guessed", async () => {
  const ctx = UNIT_CTX;
  const r = await resolveOne("refactor the Widget class", ["tmct_describe", "tmct_members"], ctx);
  assert.equal(r.refused, true);
  assert.deepEqual(r.selected, null);
});

test("resolver: HONEST REFUSE — unresolvable entity, out-of-set tool, and unmapped relation all refuse (never a guess)", async () => {
  const ctx = UNIT_CTX;
  // unresolvable entity
  assert.equal((await resolveOne("describe zebra.mjs", ["tmct_describe"], ctx)).refused, true);
  // the fitting tool is not declared for the case
  assert.equal((await resolveOne("what is the commit history of Widget.render", ["tmct_describe", "tmct_callers"], ctx)).refused, true);
  // an unmapped relation kind (imports has no capability)
  const imp = mapParse({ shape: "forward", kind: "imports", entityType: null, object: "app/lib/a.mjs" });
  assert.equal(imp.refuse, true);
  assert.match(imp.reason, /no importer/);
});

// A read-only capability may be dispatched once per tied candidate, so an
// ambiguous-term refusal ADDITIONALLY carries each candidate's real answer:
// `refused:true` is preserved (never a guessed winner) but a machine caller
// still gets something to choose between.
test("resolver: an ambiguous term stays refused:true but ADDITIONALLY carries candidateResults — real per-candidate answers, never a guess", async () => {
  const ctx = ambiguousGraphCtx();
  const r = await resolveOne("what does payment system export", ["tmct_exports"], ctx);
  assert.equal(r.refused, true, "still an honest refusal — never a guessed winner");
  assert.match(r.reason, /is ambiguous/);
  assert.equal(r.selected, null);
  assert.equal(r.candidateResults.length, 2, "one dispatched result per tied candidate");
  const labels = r.candidateResults.map((c) => c.candidate).sort();
  assert.deepEqual(labels, ["new-payment-system.js", "old-payment-system.js"]);
  for (const { result } of r.candidateResults) assert.equal(result.ok, true, "each candidate's real dispatched answer, not a placeholder");

  // no dispatcher / execute:false -> refused exactly as before, no candidateResults
  // at all (additive only — the non-enriched shape stays untouched).
  const structural = await resolveOne("what does payment system export", ["tmct_exports"], { resolve: ctx.resolve });
  assert.equal(structural.refused, true);
  assert.equal(structural.candidateResults, undefined);
  const noExec = await resolveOne("what does payment system export", ["tmct_exports"], ctx, { execute: false });
  assert.equal(noExec.refused, true);
  assert.equal(noExec.candidateResults, undefined);
});

test("resolver: an imperative frame declines a past-tense narration and claims the present-tense request", () => {
  // a report of work already done — claiming these dispatches the same work
  // again and hands the data back as if it answered "what am I trying to do"
  for (const narrated of [
    "I ran the impact of app/lib/a.mjs",
    "I just ran the untested scan. what goal am I part way through",
    "I looked at the cochanges of app/lib/a.mjs",
    "someone called tmct_impact on app/lib/f.mjs then tmct_untested. what goal does that serve",
    "I described Widget and then listed its subclasses. what am I trying to do",
    "we already checked the callers of fnAlpha",
  ]) {
    assert.equal(mapFrame(narrated), null, `narrated trace claimed by a frame: ${narrated}`);
  }

  // the other direction, which matters more: a present-tense request keeps
  // binding, including the first-person phrasings that sit closest to a report
  for (const [request, topic] of [
    ["run the impact of app/lib/a.mjs", "impact"],
    ["show the impact of app/lib/a.mjs", "impact"],
    ["I need the impact of app/lib/a.mjs", "impact"],
    ["I want to see the untested modules", "untested"],
    ["if I run impact on app/lib/c.mjs", "impact"],
    ["list the untested modules", "untested"],
    ["describe Widget", "description"],
  ]) {
    assert.equal(mapFrame(request)?.topic, topic, `present-tense request declined: ${request}`);
  }
});

test("resolver: a terse command over a tied term refuses and enumerates, the same as the NL and frame routes", async () => {
  const ctx = UNIT_CTX;
  // "b" names both app/lib/b.mjs and its own test module, tied by the graph's
  // `tests` edge. The command register binds the arg itself, so this route used
  // to answer a term the other two decline.
  const cmd = await resolveOne("describe b", ["tmct_describe"], ctx);
  assert.equal(cmd.refused, true);
  assert.equal(cmd.selected, null);
  assert.match(cmd.reason, /"b" is ambiguous/);
  assert.deepEqual(cmd.candidateCalls, [
    { name: "tmct_describe", input: { symbol: "app/lib/b.mjs" } },
    { name: "tmct_describe", input: { symbol: "app/unit-tests/b.test.mjs" } },
  ]);

  // the frame route over the same term, for comparison — same refusal, same pair
  const frame = await resolveOne("explain b", ["tmct_describe"], ctx);
  assert.equal(frame.refused, true);
  assert.deepEqual(frame.candidateCalls, cmd.candidateCalls);
});

test("resolver: the command tie check leaves an unambiguous term, a no-arg command and a free-text search alone", async () => {
  const ctx = UNIT_CTX;
  // c has no test-module sibling, so the command binds and grounds as before
  const clear = await resolveOne("describe c", ["tmct_describe"], ctx);
  assert.equal(clear.refused, undefined);
  assert.deepEqual(clear.selected, { name: "tmct_describe", input: { symbol: "c" } });

  const noArg = await resolveOne("untested", ["tmct_untested"], ctx);
  assert.deepEqual(noArg.selected, { name: "tmct_untested", input: {} });

  // tmct_search's query slot carries no `resolves` precondition, so it is never
  // read as an entity term and never tie-checked against the code graph
  const search = await resolveOne("search b", ["tmct_search"], ctx);
  assert.deepEqual(search.selected, { name: "tmct_search", input: { query: "b" } });
});

test("resolver: a bound call always self-passes the zero-hallucination gate (never emits an undeclared/unknown call)", async () => {
  const ctx = UNIT_CTX;
  // ask for a tool NOT in the declared set -> refuse, never reach outside it
  const r = await resolveOne("which functions call fnAlpha", ["tmct_describe"], ctx);
  assert.equal(r.refused, true);
  assert.deepEqual(r.selected, null);
});

// ---- 3. the PLANNER -----------------------------------------------------------

test("planner: decompose picks the HTN method — conditional / relative-filter / member-filter / sequence / single", () => {
  assert.equal(decompose("if fnAlpha is untested, describe it").method, "conditional");
  assert.equal(decompose("of the modules impacted by app/lib/a.mjs, which are untested").method, "relative-filter");
  assert.equal(decompose("show the members of Widget and then its subclasses").method, "sequence");
  assert.equal(decompose("describe Widget").method, "single");
  assert.equal(isMultiStep("describe Widget"), false);
  assert.equal(isMultiStep("find who calls fnAlpha, then describe Widget.render"), true);
});

test("planner: the member-filter method decomposes to [members(X), reach-filter Y] across its surface forms", () => {
  const d = decompose("which methods of Widget end up calling fnAlpha");
  assert.equal(d.method, "member-filter");
  assert.deepEqual(d.segments, [
    { text: "members Widget", role: "action", thread: false },
    { text: "fnAlpha", role: "member-filter", thread: true },
  ]);
  // held-out surface forms of the SAME closed recipe (C1 surface syntax, not C2)
  assert.equal(decompose("what members of Widget eventually reach fnAlpha").method, "member-filter");
  assert.equal(decompose("which methods of Button end up calling fnAlpha").segments[0].text, "members Button");
  // NOT a member-filter: a plain members question keeps its single-shot route
  assert.equal(decompose("show the members of Widget").method, "single");
  assert.equal(decompose("which methods of Widget are documented").method, "single");
});

test("planner: a B1 recipe threads two steps + emits a CONNECTED POP causal-link proof", async () => {
  const ctx = UNIT_CTX;
  const r = await plan("show the members of Widget and then its subclasses", ["tmct_members", "tmct_subclasses"], ctx);
  assert.ok(!r.refused, r.why);
  assert.deepEqual(r.calls, [
    { name: "tmct_members", input: { class: "Widget" } },
    { name: "tmct_subclasses", input: { class: "Widget" } },
  ], "the anaphor 'its' threads Widget from step 1 into step 2");
  // POP proof: causal-links present, connected to the grounded graph
  const links = r.proof.filter((s) => s.step === "causal-link");
  assert.equal(links.length, 2);
  assert.ok(links.some((l) => l.producer === "graph"), "the chain is rooted at a grounded fact");
});

test("planner: BUDGET + monitor — an over-budget plan and an unresolvable sub-goal both REFUSE (escalate), never partial", async () => {
  const ctx = UNIT_CTX;
  // over budget: more than MAX_STEPS sequenced sub-goals
  const long = Array.from({ length: MAX_STEPS + 2 }, () => "untested").join(" and then ");
  const over = await plan(long, ["tmct_untested"], ctx);
  assert.equal(over.refused, true);
  assert.match(over.why, /budget/);

  // an unresolvable sub-goal breaks the causal chain -> honest stop
  const broken = await plan("describe zebra.mjs and then describe Widget", ["tmct_describe"], ctx);
  assert.equal(broken.refused, true);
  assert.deepEqual(broken.calls, []);
});

test("planner: extractEntity picks the strong identifier token for frame slot-filling", () => {
  assert.equal(extractEntity("assess the blast radius of app/lib/a.mjs"), "app/lib/a.mjs");
  assert.equal(extractEntity("Widget subclasses"), "Widget");
});

test("planner: decompose recognizes the RECOVER method only when the check clause names an empty outcome", () => {
  const button = decompose("list the callers of Button, and if there are none, describe it instead");
  assert.equal(button.method, "recover");
  assert.deepEqual(button.segments, [
    { text: "list the callers of Button", role: "action", thread: false },
    { text: "describe it", role: "action", thread: true },
  ]);
  assert.equal(decompose("show what covers app/lib/c.mjs, and if nothing does, show its impact instead").method, "recover");
  assert.equal(decompose("list what fnAlpha calls, and if it calls nothing, list what calls it instead").method, "recover");
  // no emptiness cue in the check clause -> falls through to plain sequencing,
  // unchanged from before the recover method existed.
  assert.equal(decompose("show the members of Widget, and if Widget is a class, describe it instead").method, "sequence");
});

// ---- 5. e2e AGENTBENCH — the router baseline climbs the shim floor at 0% halluc

test("agentbench e2e: the resolver driver holds 0% hallucination on EVERY case (the non-negotiable), stamped resolver-0.8.0", async () => {
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"));
  const { rows, rolled } = await runAgentbench(cases, { driver: resolverDriver, stamp: "0.8.0", ctx: SHARED.ctx });
  for (const r of rows) {
    assert.equal(r.driver, "resolver-0.8.0", `${r.caseId} is the router baseline, not a floor`);
    assert.deepEqual(r.verdict.hallucinated, [], `${r.caseId} must never hallucinate`);
  }
  assert.equal(rolled.overall.hallucinationRate, 0, "the router NEVER emits an out-of-set / ungrounded call");
});

test("agentbench e2e: the resolver driver CLIMBS — A0..C1 clear the gate, well above the shim-transport floor", async () => {
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"));
  const { rolled } = await runAgentbench(cases, { driver: resolverDriver, stamp: "0.8.0", ctx: SHARED.ctx });
  for (const rung of ["TOOL-0", "TOOL-1", "TOOL-2", "TOOL-3", "TOOL-4", "TOOL-5"]) {
    assert.ok(rolled.byRung[rung].gatePass, `${rung} clears the honest gate (0% halluc AT >=${COMPLETION_FLOOR * 100}% completion)`);
  }
  // the router is USEFUL, not just safe: it clears every rung it TARGETS (A0-C1)
  // at high completion, far above the shim floor (~46%). The C2 cases
  // (safe-to-change, the held-out phrasings) are DELIBERATELY beyond the C1
  // resolver and refused — the resolver escalates them, so usefulness is
  // measured over A0-C1; the goal driver is what climbs C2 (see
  // test/adapters/goal-reasoner.test.mjs).
  const climbed = ["TOOL-0", "TOOL-1", "TOOL-2", "TOOL-3", "TOOL-4", "TOOL-5"];
  const total = climbed.reduce((s, r) => s + rolled.byRung[r].total, 0);
  const completed = climbed.reduce((s, r) => s + rolled.byRung[r].completed, 0);
  assert.ok(completed / total >= 0.9, `A0..C1 completion climbs (got ${((completed / total) * 100).toFixed(0)}%)`);
});
