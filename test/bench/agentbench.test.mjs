// agentbench + router-registry tests — the Stage-0 capability substrate and the
// AGENTBENCH harness. Like chatbench's
// tests these cover the HARNESS + the substrate deterministically; there is no
//
// Three groups:
//   1. registry shape — the STRIPS/PDDL capability model;
//   2. grading logic — the zero-hallucination gate, metric pair, ladder;
//   3. CONFORMANCE — the "verified against the dispatchTool switch" note made
//      EXECUTABLE: every registry arg-key is actually read by dispatchTool, and
//      the registry name-set is a strict SUBSET of the dispatch case set
//      (closed-world default-deny). This catches arg-key drift at merge.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  REGISTRY, VOCAB, PRECOND, KINDS,
  capabilities, capabilityByName, isCapability, parametersOf,
  preconditionsOf, effectsOf, argKeysOf, requiredArgsOf,
  EXCLUDED_FROM_REGISTRY,
} from "../../src/domain/router/registry.mjs";
import {
  RUNGS, COMPLETION_FLOOR, parseCases, hallucinationsIn, isCallWellFormed,
  callMatches, callsMatch, gradeCase, effectiveCaseFor, rollup, ladderGate, sameSet, sameCandidates,
} from "../../agentbench/grade.mjs";
import { stubDriver } from "../../agentbench/driver-stub.mjs";
import { shimDriver } from "../../agentbench/driver-shim.mjs";
import { resolverDriver } from "../../agentbench/driver-resolver.mjs";
import { runAgentbench, createRunCtx, BENCH_VERSION, loadFixtureLabels } from "../../agentbench/run.mjs";
import {
  resultSetOf, untestedModules, impactLabels, testsForLabels, membersLabels, callersLabels,
  intersect, fallbackIfEmpty, guardIfEmpty, memberIndividuals, membersReaching,
} from "../../agentbench/results.mjs";
import { COMMANDS } from "../../src/services/chat.mjs";

const CASES_FILE = fileURLToPath(new URL("../../agentbench/cases.jsonl", import.meta.url));

// ONE shared run context for the whole file (0.8.2 speed insurance): every
// consumer here is READ-ONLY over the materialized fixture graph, so the
// per-test createRunCtx (mkdtemp + graph write + cleanup) cycles collapse into
// a single module-scope one, cleaned in the after-hook. runAgentbench calls
// pass it through { ctx } and so skip their own create/cleanup too.
const SHARED = await createRunCtx();
const CTX = SHARED.ctx;
after(() => SHARED.cleanup());

// ---- 1. registry shape ------------------------------------------------------

test("registry: capabilities() is a non-empty set of well-formed STRIPS operators", () => {
  const caps = capabilities();
  assert.ok(caps.length >= 10, `expected the graph-query toolset (got ${caps.length})`);
  for (const c of caps) {
    assert.equal(c.type, VOCAB.Capability, `${c.name} is a cap:Capability`);
    assert.equal(typeof c.name, "string");
    assert.ok(Array.isArray(c.parameters), `${c.name} parameters is an array`);
    assert.ok(Array.isArray(c.preconditions) && c.preconditions.length, `${c.name} has preconditions`);
    assert.ok(c.effects && Array.isArray(c.effects.add) && Array.isArray(c.effects.del), `${c.name} has add/del effects`);
  }
});

test("registry: every capability is read-only — empty delete-list, add-list is epistemic", () => {
  for (const c of capabilities()) {
    assert.equal(c.readOnly, true, `${c.name} is read-only`);
    assert.deepEqual(c.effects.del, [], `${c.name} deletes nothing (queries mutate nothing — the STRIPS closed world)`);
    assert.ok(c.effects.add.length >= 1, `${c.name} adds at least one epistemic fact`);
    for (const eff of c.effects.add) assert.equal(eff.pred, "cap:knows", `${c.name} add-effects are cap:knows`);
  }
});

test("registry: every capability carries its store's safety-gate precondition — graph-loaded for code-graph queries, memory-facts for the memory-graph view", () => {
  for (const c of capabilities()) {
    const preds = c.preconditions.map((p) => p.pred);
    assert.ok(
      preds.includes(PRECOND.graphLoaded) || preds.includes(PRECOND.memoryFacts),
      `${c.name} requires graph-loaded or memory-facts`,
    );
  }
  // the memory-graph view answers with or without a code-map graph, so it
  // carries memory-facts INSTEAD of graph-loaded, never both.
  const related = preconditionsOf("tmct_related").map((p) => p.pred);
  assert.deepEqual(related, [PRECOND.memoryFacts]);
});

test("registry: accessors resolve — byName / preconditionsOf / effectsOf / parametersOf", () => {
  assert.equal(capabilityByName("tmct_describe").name, "tmct_describe");
  assert.equal(capabilityByName("nope"), undefined);
  assert.ok(isCapability("tmct_callers"));
  assert.ok(!isCapability("tmct_teleport"));

  const preds = preconditionsOf("tmct_describe").map((p) => p.pred);
  assert.ok(preds.includes(PRECOND.resolves));
  const resolvesStep = preconditionsOf("tmct_describe").find((p) => p.pred === PRECOND.resolves);
  assert.equal(resolvesStep.param, "symbol");
  assert.equal(resolvesStep.as, KINDS.Symbol);

  assert.deepEqual(effectsOf("tmct_untested").del, []);
  assert.equal(effectsOf("tmct_untested").add[0].topic, "untested");

  assert.deepEqual(requiredArgsOf("tmct_members"), ["class"]);
  assert.deepEqual([...argKeysOf("tmct_search")].sort(), ["decorator", "kind", "name", "query"]);
  assert.deepEqual(parametersOf("tmct_untested"), []);
});

test("registry: search models the any-present disjunction (query OR kind)", () => {
  const any = preconditionsOf("tmct_search").find((p) => p.pred === PRECOND.anyPresent);
  assert.ok(any, "search has an any-present precondition");
  assert.deepEqual([...any.params].sort(), ["kind", "query"]);
});

test("registry: closed-world default-deny — the unbounded tools are intentionally UNREGISTERED", () => {
  for (const name of Object.keys(EXCLUDED_FROM_REGISTRY)) {
    assert.ok(!isCapability(name), `${name} must NOT be a capability (default-deny; documented exclusion)`);
    assert.equal(typeof EXCLUDED_FROM_REGISTRY[name], "string", `${name} exclusion carries a reason`);
  }
  // REGISTRY facts are exposed as data for Stage 1 / Stage 4 to consume.
  assert.equal(REGISTRY.capabilities, capabilities());
  assert.ok(REGISTRY.prefixes.cap.startsWith("urn:tmct:"));
});

// ---- 2. grading logic -------------------------------------------------------

test("hallucinationsIn: default-deny catches undeclared, unknown, unknown-arg, missing-arg", () => {
  // clean
  assert.deepEqual(hallucinationsIn({ name: "tmct_describe", input: { symbol: "Widget" } }, ["tmct_describe"]), []);
  assert.ok(isCallWellFormed({ name: "tmct_untested" }, ["tmct_untested"]));
  // a tool that exists but was NOT declared for this case
  assert.equal(hallucinationsIn({ name: "tmct_callers", input: { symbol: "x" } }, ["tmct_describe"])[0].reason, "undeclared");
  // a fabricated tool — the default-deny automatic fail
  assert.equal(hallucinationsIn({ name: "tmct_teleport", input: {} }, ["tmct_teleport"])[0].reason, "unknown-tool");
  // an arg key the capability does not accept
  assert.equal(hallucinationsIn({ name: "tmct_describe", input: { module: "x" } }, ["tmct_describe"]).some((p) => p.reason === "unknown-arg"), true);
  // a required arg missing
  assert.equal(hallucinationsIn({ name: "tmct_describe", input: {} }, ["tmct_describe"]).some((p) => p.reason === "missing-arg"), true);
  // search: any-present satisfied by kind alone is fine
  assert.deepEqual(hallucinationsIn({ name: "tmct_search", input: { kind: "function" } }, ["tmct_search"]), []);
  // search: neither query nor kind → missing-arg
  assert.equal(hallucinationsIn({ name: "tmct_search", input: {} }, ["tmct_search"]).some((p) => p.reason === "missing-arg"), true);
});

test("callMatches / callsMatch: name + pinned-input, positional sequence", () => {
  assert.ok(callMatches({ name: "tmct_describe", input: { symbol: "Widget" } }, { name: "tmct_describe", input: { symbol: "Widget" } }));
  // produced may carry EXTRA optional keys; pinned lower-bound still matches
  assert.ok(callMatches({ name: "tmct_search", input: { query: "w" } }, { name: "tmct_search", input: { query: "w", kind: "class" } }));
  assert.ok(!callMatches({ name: "tmct_describe", input: { symbol: "Widget" } }, { name: "tmct_describe", input: { symbol: "Base" } }));
  assert.ok(!callsMatch([{ name: "a" }], [{ name: "a" }, { name: "b" }]));
});

test("gradeCase: a matching single call passes with a valid proof chain", () => {
  const caseDef = { rung: "TOOL-0", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true, proof: true } };
  const loop = { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], refused: false, terminated: true, proof: [{ ok: true }, { ok: true }] };
  const v = gradeCase(caseDef, loop);
  assert.ok(v.pass, v.reasons.join("; "));
  assert.ok(v.completed);
  assert.deepEqual(v.hallucinated, []);
});

test("gradeCase: a hallucinated call is an AUTOMATIC FAIL even if it 'answers'", () => {
  const caseDef = { rung: "TOOL-1", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true } };
  // the driver reached OUTSIDE the declared set — automatic fail
  const loop = { calls: [{ name: "tmct_callers", input: { symbol: "Widget" } }], refused: false, terminated: true };
  const v = gradeCase(caseDef, loop);
  assert.ok(!v.pass);
  assert.equal(v.hallucinated.length, 1);
});

test("gradeCase: refusing-when-unsure passes at the honest-miss level; a wrong call instead of refusing fails", () => {
  const refuseCase = { rung: "TOOL-2", tools: ["tmct_describe"], expect: { refuse: true, terminates: true } };
  assert.ok(gradeCase(refuseCase, { calls: [], refused: true, terminated: true }).pass);
  // produced a call when it should have refused
  const bad = gradeCase(refuseCase, { calls: [{ name: "tmct_describe", input: { symbol: "zebra" } }], refused: false, terminated: true });
  assert.ok(!bad.pass);
});

test("effectiveCaseFor: a declared floorExpect replaces the expectation on the resolver arm only", () => {
  const caseDef = {
    id: "x", rung: "TOOL-6", tools: ["tmct_untested"],
    expect: { calls: [{ name: "tmct_untested" }], terminates: true },
    floorExpect: { refuse: true },
  };
  const floor = effectiveCaseFor(caseDef, "resolver-0.8.0");
  assert.notEqual(floor, caseDef);
  assert.deepEqual(floor.expect, { terminates: true, refuse: true }, "the override inherits terminates");
  for (const arm of ["goal-0.8.1", "stub-floor", "shim-transport", "timeout", undefined]) {
    assert.equal(effectiveCaseFor(caseDef, arm), caseDef, `${arm ?? "no driver"} grades the shared expectation`);
  }
  const plain = { id: "y", expect: { refuse: true, terminates: true } };
  assert.equal(effectiveCaseFor(plain, "resolver-0.8.0"), plain, "no floorExpect, no override");
});

test("parseCases: floorExpect accepts only the declared-refusal shape", () => {
  const base = '{"id":"z","rung":"TOOL-6","request":"r","tools":["tmct_untested"],"expect":{"calls":[{"name":"tmct_untested"}],"terminates":true},"floorExpect":';
  const ok = parseCases(`${base}{"refuse":true}}`);
  assert.deepEqual(ok.errors, []);
  for (const badShape of ['{"refuse":false}', '{"refuse":true,"calls":[]}', "[]", "true"]) {
    const bad = parseCases(`${base}${badShape}}`);
    assert.ok(bad.errors.some((e) => e.includes("floorExpect supports only")), `rejected: ${badShape}`);
  }
});

test("gradeCase: a required-but-missing proof chain fails a proof case", () => {
  const caseDef = { rung: "TOOL-0", tools: ["tmct_untested"], expect: { calls: [{ name: "tmct_untested" }], terminates: true, proof: true } };
  const v = gradeCase(caseDef, { calls: [{ name: "tmct_untested" }], refused: false, terminated: true, proof: [] });
  assert.ok(!v.pass);
  assert.ok(v.reasons.some((r) => /proof/.test(r)));
});

test("rollup: the METRIC PAIR + gate — a refuse-everything driver hits 0% halluc but FAILS on completion", () => {
  const cases = [
    { rung: "TOOL-0", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true } },
    { rung: "TOOL-0", tools: ["tmct_untested"], expect: { calls: [{ name: "tmct_untested" }], terminates: true } },
  ];
  // a degenerate driver that refuses EVERYTHING
  const rows = cases.map((c) => ({ rung: c.rung, verdict: gradeCase(c, { calls: [], refused: true, terminated: true }) }));
  const r = rollup(rows);
  assert.equal(r.overall.hallucinationRate, 0, "refusing never hallucinates");
  assert.ok(r.overall.completion < COMPLETION_FLOOR, "but completes nothing");
  assert.equal(r.overall.gatePass, false, "so the honest gate FAILS — hallucination rate alone is not enough");
});

test("ladderGate: the first un-gated rung gates every rung above it, with receipts", () => {
  const rolled = {
    byRung: {
      "TOOL-0": { total: 2, completion: 1, hallucinationRate: 0, gatePass: true },
      "TOOL-1": { total: 2, completion: 0.2, hallucinationRate: 0, gatePass: false },
      "TOOL-2": { total: 2, completion: 1, hallucinationRate: 0, gatePass: true },
    },
    overall: {},
  };
  const g = ladderGate(rolled);
  assert.match(g.gatedAt, /TOOL-1 completion/);
  assert.deepEqual(g.receipts.map((r) => r.rung), ["TOOL-2"]);
});

// ---- the TOOL-7 recovery + TOOL-8 tied-candidate grader extensions ----------

test("gradeCase: a TOOL-7 recovery case passes only when the driver SIGNALS the replan", () => {
  const caseDef = {
    rung: "TOOL-7", tools: ["tmct_callers", "tmct_describe"],
    expect: {
      calls: [{ name: "tmct_callers", input: { symbol: "Button" } }, { name: "tmct_describe", input: { symbol: "Button" } }],
      recover: { after: "tmct_callers", fallback: "tmct_describe" }, terminates: true,
    },
  };
  const calls = [{ name: "tmct_callers", input: { symbol: "Button" } }, { name: "tmct_describe", input: { symbol: "Button" } }];
  // the fallback fired AND the driver observed the empty primary (recovered:true)
  const ok = gradeCase(caseDef, { calls, refused: false, terminated: true, recovered: true });
  assert.ok(ok.pass && ok.completed, ok.reasons.join("; "));
  // same calls but NO recovery signal — an unconditional second step, not a replan
  const noSignal = gradeCase(caseDef, { calls, refused: false, terminated: true });
  assert.ok(!noSignal.pass && !noSignal.completed);
  assert.ok(noSignal.reasons.some((r) => /did not signal/.test(r)));
});

test("gradeCase: a TOOL-8 ambiguous case passes iff it refuses AND enumerates the tied candidates", () => {
  const caseDef = {
    rung: "TOOL-8", tools: ["tmct_impact"],
    expect: {
      refuse: true,
      candidateResults: [
        { name: "tmct_impact", input: { module: "app/lib/b.mjs" } },
        { name: "tmct_impact", input: { module: "app/unit-tests/b.test.mjs" } },
      ],
      terminates: true,
    },
  };
  const cands = [
    { name: "tmct_impact", input: { module: "app/unit-tests/b.test.mjs" } },
    { name: "tmct_impact", input: { module: "app/lib/b.mjs" } },
  ]; // order-insensitive
  const ok = gradeCase(caseDef, { calls: [], refused: true, terminated: true, candidateResults: cands });
  assert.ok(ok.pass && ok.completed, ok.reasons.join("; "));
  // a bare refusal that dropped the candidates is NOT the enumerate-or-refuse behavior
  const bare = gradeCase(caseDef, { calls: [], refused: true, terminated: true });
  assert.ok(!bare.pass && !bare.completed);
  assert.ok(bare.reasons.some((r) => /candidateResults/.test(r)));
  // an arbitrary single pick (a produced call) fails the refuse gate outright
  const pick = gradeCase(caseDef, { calls: [{ name: "tmct_impact", input: { module: "app/lib/b.mjs" } }], refused: false, terminated: true });
  assert.ok(!pick.pass);
});

test("sameCandidates: order/duplication-insensitive equality over dispatched reads", () => {
  const a = [{ name: "tmct_impact", input: { module: "x" } }, { name: "tmct_impact", input: { module: "y" } }];
  const b = [{ name: "tmct_impact", input: { module: "y" } }, { name: "tmct_impact", input: { module: "x" } }];
  assert.ok(sameCandidates(a, b));
  assert.ok(!sameCandidates(a, [{ name: "tmct_impact", input: { module: "x" } }]));
  assert.ok(!sameCandidates(a, [{ name: "tmct_impact", input: { module: "x" } }, { name: "tmct_impact", input: { module: "z" } }]));
});

test("parseCases: lints expect.recover shape and expect.candidateResults shape", () => {
  const bad = [
    // recover on a refuse case (a marker for a plan, not a refusal)
    JSON.stringify({ id: "e1", rung: "TOOL-7", request: "q", tools: ["tmct_describe"], expect: { refuse: true, recover: { after: "tmct_describe", fallback: "tmct_describe" }, terminates: true } }),
    // recover.fallback names a tool not in the declared set
    JSON.stringify({ id: "e2", rung: "TOOL-7", request: "q", tools: ["tmct_callers"], expect: { calls: [{ name: "tmct_callers", input: { symbol: "Widget" } }], recover: { after: "tmct_callers", fallback: "tmct_describe" }, terminates: true } }),
    // candidateResults on a non-refuse case
    JSON.stringify({ id: "e3", rung: "TOOL-8", request: "q", tools: ["tmct_impact"], expect: { calls: [{ name: "tmct_impact", input: { module: "app/lib/a.mjs" } }], candidateResults: [{ name: "tmct_impact", input: { module: "app/lib/a.mjs" } }], terminates: true } }),
    // a candidate naming an undeclared tool
    JSON.stringify({ id: "e4", rung: "TOOL-8", request: "q", tools: ["tmct_impact"], expect: { refuse: true, candidateResults: [{ name: "tmct_callers", input: { symbol: "x" } }], terminates: true } }),
  ].join("\n");
  const { errors } = parseCases(bad);
  assert.ok(errors.some((e) => /e1.*refuse case must not declare it/.test(e)));
  assert.ok(errors.some((e) => /e2.*recover\.fallback.*not in the case's declared tools/.test(e)));
  assert.ok(errors.some((e) => /e3.*candidateResults only annotates a refuse case/.test(e)));
  assert.ok(errors.some((e) => /e4.*not in the case's declared tools/.test(e)));
});

// ---- cases.jsonl lint -------------------------------------------------------

test("cases.jsonl: parses clean — unique ids, known rungs, declared tools, well-formed expects", async () => {
  const { cases, errors } = parseCases(await readFile(CASES_FILE, "utf8"));
  assert.deepEqual(errors, [], "lint errors");
  assert.ok(cases.length >= 6, `seed set present (got ${cases.length})`);
  for (const c of cases) assert.ok(RUNGS.includes(c.rung));
});

test("parseCases: rejects an undeclared tool, an unknown rung, and a hallucinated expected call", () => {
  const bad = [
    JSON.stringify({ id: "x1", rung: "Z9", request: "q", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "W" } }], terminates: true } }),
    JSON.stringify({ id: "x2", rung: "TOOL-0", request: "q", tools: ["not_a_tool"], expect: { refuse: true, terminates: true } }),
    JSON.stringify({ id: "x3", rung: "TOOL-0", request: "q", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_callers", input: { symbol: "W" } }], terminates: true } }),
  ].join("\n");
  const { errors } = parseCases(bad);
  assert.ok(errors.some((e) => /rung must be one of/.test(e)));
  assert.ok(errors.some((e) => /not a declared capability/.test(e)));
  assert.ok(errors.some((e) => /not in the case's declared tools/.test(e)));
});

// ---- 3. CONFORMANCE — the executable "verified against the switch" ----------

test("conformance: registry ⊆ dispatchTool AND every arg-key is read by the switch", async () => {
  for (const cap of capabilities()) {
    const res = await CTX.dispatch(cap.name, {}); // empty input
    // strict SUBSET: the name is a real dispatch case (never "unknown tool")
    if (!res.ok) assert.doesNotMatch(res.error, /unknown tool/, `${cap.name} must be a dispatchTool case`);
    const reqArgs = requiredArgsOf(cap.name);
    const anyGroups = preconditionsOf(cap.name).filter((p) => p.pred === PRECOND.anyPresent);
    if (reqArgs.length === 0 && anyGroups.length === 0) {
      assert.ok(res.ok, `${cap.name} takes no required arg → dispatch({}) should succeed`);
    } else {
      // dispatch({}) must reject with a message naming the arg-key the switch
      // actually reads — this is where arg-key DRIFT fails the merge.
      assert.ok(!res.ok, `${cap.name} requires an arg → dispatch({}) should error`);
      const argWord = reqArgs[0] ?? anyGroups[0].params[0];
      assert.match(res.error, new RegExp(`\\b${argWord}\\b`), `${cap.name}: dispatch names its arg-key "${argWord}"`);
    }
  }
});

test("conformance: the EXCLUDED tools are dispatched but unregistered (strict subset, not disjoint)", async () => {
  for (const name of ["tmct_snippet", "tmct_context_more"]) {
    assert.ok(!isCapability(name), `${name} is intentionally unregistered`);
    const res = await CTX.dispatch(name, {});
    // it IS a dispatch case (server handles it) — proving the registry is a
    // strict SUBSET of the switch, not a disjoint set.
    assert.ok(!res.ok && !/unknown tool/.test(res.error), `${name} is dispatched (excluded from the registry, not unknown)`);
  }
});

test("conformance: the COMMANDS.arg seam — every command's arg-key is one the registry accepts", () => {
  // Arg keys live in THREE places (chat.mjs COMMANDS.arg, registry param.arg,
  // dispatchTool) with nothing structurally binding them. The shim (server-http
  // selectTool) binds a tool_use input under COMMANDS[verb].arg; if that key ever
  // drifts from the registry's param.arg, the grader reads the shim call as an
  // `unknown-arg` HALLUCINATION — a transport defect misread as a router defect.
  // Pin the invariant: for every command whose tool is a registered capability,
  // its arg-key must be an accepted arg-key of that capability.
  for (const [verb, spec] of Object.entries(COMMANDS)) {
    if (!isCapability(spec.tool)) continue; // context/snippet: intentionally unregistered
    if (spec.arg == null) {
      assert.equal(requiredArgsOf(spec.tool).length, 0, `/${verb} takes no arg → ${spec.tool} must have no required arg`);
      continue;
    }
    assert.ok(argKeysOf(spec.tool).has(spec.arg),
      `/${verb}: COMMANDS.arg "${spec.arg}" must be an accepted arg-key of ${spec.tool} (got ${[...argKeysOf(spec.tool)].join(",")})`);
  }
});

// ---- end-to-end: the stub-driver floor --------------------------------------

test("agentbench e2e: the stub driver runs the seed set to a labeled stub-floor result", async () => {
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"));
  const { rows, rolled } = await runAgentbench(cases, { stamp: BENCH_VERSION, ctx: CTX });
  assert.equal(rows.length, cases.length);
  for (const r of rows) {
    assert.equal(r.driver, "stub-floor", "every row is stamped the stub-driver floor, not a router baseline");
    assert.equal(r.version, BENCH_VERSION, "artifacts are stamped the bench version (tracks package.json)");
  }
  // the stub is a KEYWORD matcher authored for the CONCRETE rungs (TOOL-0..TOOL-2);
  // the abstract rungs (TOOL-3+ multi-step, the goal cases, and the TOOL-7/TOOL-8
  // recovery/ambiguity tiers) are BEYOND its design by construction. So the "real
  // floor" property (a NON-degenerate floor: it clears the gate rather than
  // refuse-everything) is asserted on the rungs it targets, not the
  // deliberately-harder full ladder — adding a higher-rung case the stub cannot
  // handle must not read as a floor regression.
  assert.equal(rolled.overall.hallucinationRate, 0, "the stub structurally cannot hallucinate (default-deny to declared set)");
  for (const rung of ["TOOL-0", "TOOL-1", "TOOL-2"]) {
    assert.ok(rolled.byRung[rung].completion >= COMPLETION_FLOOR, `stub completes its authored rung ${rung} (${(rolled.byRung[rung].completion * 100).toFixed(0)}%)`);
    assert.ok(rolled.byRung[rung].gatePass, `stub clears its gate on authored rung ${rung}`);
  }
});

// ---- the SHIM-TRANSPORT baseline driver -------------------------------------

test("agentbench e2e: the shim-transport driver NEVER hallucinates over the whole ladder (its non-negotiable)", async () => {
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"));
  const { rows, rolled } = await runAgentbench(cases, { driver: shimDriver, stamp: BENCH_VERSION, ctx: CTX });
  assert.equal(rows.length, cases.length);
  for (const r of rows) {
    assert.equal(r.driver, "shim-transport", "every shim row is stamped shim-transport, not a router baseline");
    // structural no-hallucination: zero hallucinated calls, AND every produced
    // call is well-formed (in-registry, declared, bindable) — never an
    // out-of-set / unbindable call, on EVERY seeded case.
    assert.deepEqual(r.verdict.hallucinated, [], `${r.caseId} must not hallucinate`);
    for (const call of r.produced.calls) {
      assert.deepEqual(hallucinationsIn(call, r.tools), [], `${r.caseId}: ${call.name} must be well-formed against the declared set`);
    }
  }
  // The HONEST HEADLINE: 0% hallucination everywhere — the router's non-negotiable
  // property, demonstrated by the transport floor; completion is the axis the
  // resolver must climb (higher rungs are ceiling markers, not bugs).
  assert.equal(rolled.overall.hallucinationRate, 0, "the shim refuses / answers in text rather than emit an ungrounded call");
});

test("shim-transport: refuses free-NL and multi-step (transport floor), clears the command register at 0% halluc", async () => {
  // a bare COMMANDS verb + entity → the shim emits a grounded, well-formed call.
  const ok = await shimDriver("describe Widget", ["tmct_describe"], CTX);
  assert.equal(ok.driver, "shim-transport");
  assert.deepEqual(ok.calls, [{ name: "tmct_describe", input: { symbol: "Widget" } }]);
  assert.equal(ok.refused, false);
  assert.deepEqual(hallucinationsIn(ok.calls[0], ["tmct_describe"]), []);

  // free-NL phrasing is out of the command register → text answer here = REFUSE,
  // never a guessed/ungrounded call.
  const nl = await shimDriver("which functions call fnAlpha", ["tmct_describe", "tmct_callers", "tmct_callees"], CTX);
  assert.equal(nl.refused, true);
  assert.deepEqual(nl.calls, []);

  // a multi-step recipe: the single-call transport emits at most one call →
  // refuses here (no thread-through), a ceiling, never a hallucination.
  const multi = await shimDriver("find who calls fnAlpha, then describe Widget.render", ["tmct_callers", "tmct_describe"], CTX);
  assert.equal(multi.refused, true);
  assert.deepEqual(multi.calls, []);

  // a command whose entity does not resolve → honest refusal (no ungrounded call).
  const miss = await shimDriver("describe zebra.mjs", ["tmct_describe"], CTX);
  assert.equal(miss.refused, true);
  assert.deepEqual(miss.calls, []);
});

test("agentbench e2e: the stub driver refuses a request whose only fitting tool is out-of-set", async () => {
  // "history of X" but tmct_history is not offered → honest refusal, no call
  const loop = await stubDriver("what is the commit history of Widget.render", ["tmct_describe", "tmct_callers"], CTX);
  assert.equal(loop.refused, true);
  assert.deepEqual(loop.calls, []);
  assert.equal(loop.driver, "stub-floor");
});

// ---- 4. RESULT EXECUTION + COMPOSITION (0.8.1) ------------------------------
// AGENTBENCH_0.8.0 graded the call-PLAN, not the EXECUTED composed result. These
// pin the new axis: the structured result-set extractor (mirrors dispatchTool's
// render*), the composition operators, the STATIC-literal expect.result lint, and
// the plan-vs-result SPLIT in gradeCase + the resolver e2e.

test("results: the structured extractor mirrors the render* set semantics over the fixture", () => {
  const g = CTX.graph;
  const ind = (t) => CTX.resolve(t).match;
  // the untested view (renderUntested): source modules with no covering test module
  assert.deepEqual(untestedModules(g),
    ["app/lib/a.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"]);
  // the reverse impact closure (renderImpact/impactClosure), uncapped + sorted
  assert.deepEqual(impactLabels(g, ind("app/lib/a.mjs")),
    ["app/functions/d/handler.mjs", "app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"]);
  // tests_for: [] means untested (renderTestsFor "no covering tests")
  assert.deepEqual(testsForLabels(g, ind("app/lib/c.mjs")), []);
  assert.deepEqual(testsForLabels(g, ind("app/lib/b.mjs")), ["app/unit-tests/b.test.mjs"]);
  // members (contains edge) and fine-symbol callers (callsSymbol)
  assert.deepEqual(membersLabels(g, ind("Widget")), ["name", "render"]);
  assert.deepEqual(callersLabels(g, ind("fnAlpha")), ["Widget.render"]);
  // resultSetOf routes by tool name; a no-set tool returns the bound entity singleton
  assert.deepEqual(resultSetOf(g, "tmct_untested", {}, null), untestedModules(g));
  assert.deepEqual(resultSetOf(g, "tmct_describe", { symbol: "fnAlpha" }, ind("fnAlpha")), ["fnAlpha"]);
});

test("results: the composition operators fold threaded step results (pure set-algebra)", () => {
  // intersect — the relative-filter fold
  assert.deepEqual(intersect(["a", "b", "c"], ["b", "c", "d"]), ["b", "c"]);
  assert.deepEqual(intersect(["a"], ["b"]), []); // disjoint → empty composed answer
  // fallback-if-empty — take the alternative only when the guard set is empty
  assert.deepEqual(fallbackIfEmpty([], ["x"]), ["x"]);
  assert.deepEqual(fallbackIfEmpty(["p"], ["x"]), ["p"]);
  // guard-if-empty — the action fires only when the guard set is empty
  assert.deepEqual(guardIfEmpty([], ["y"]), ["y"]);
  assert.deepEqual(guardIfEmpty(["nonempty"], ["y"]), []);
});

test("sameSet: order/duplication-insensitive value equality (the result comparator)", () => {
  assert.ok(sameSet(["a", "b"], ["b", "a"]));
  assert.ok(sameSet([], []));
  assert.ok(!sameSet(["a"], ["a", "b"]));
  assert.ok(!sameSet(["a", "b"], ["a", "c"]));
});

test("parseCases: expect.result must be a static array of strings; a refuse case may not carry one", () => {
  const bad = [
    JSON.stringify({ id: "r1", rung: "TOOL-5", request: "q", tools: ["tmct_untested"], expect: { calls: [{ name: "tmct_untested" }], result: "not-an-array", terminates: true } }),
    JSON.stringify({ id: "r2", rung: "TOOL-5", request: "q", tools: ["tmct_untested"], expect: { calls: [{ name: "tmct_untested" }], result: [""], terminates: true } }),
    JSON.stringify({ id: "r3", rung: "TOOL-2", request: "q", tools: ["tmct_describe"], expect: { refuse: true, result: ["x"], terminates: true } }),
  ].join("\n");
  const { errors } = parseCases(bad);
  assert.ok(errors.some((e) => /r1.*expect\.result must be an array/.test(e)));
  assert.ok(errors.some((e) => /r2.*non-empty string/.test(e)));
  assert.ok(errors.some((e) => /r3.*refuse case must not declare expect\.result/.test(e)));
});

test("parseCases: the REFERENTIAL lint fails a STALE expect.result literal against the fixture", async () => {
  const knownLabels = await loadFixtureLabels();
  const stale = JSON.stringify({
    id: "s1", rung: "TOOL-5", request: "q", tools: ["tmct_impact", "tmct_untested"],
    expect: { calls: [{ name: "tmct_impact", input: { module: "app/lib/a.mjs" } }, { name: "tmct_untested" }], result: ["app/lib/NONEXISTENT.mjs"], terminates: true },
  });
  const withFixture = parseCases(stale, { knownLabels });
  assert.ok(withFixture.errors.some((e) => /NONEXISTENT.*stale literal/.test(e)), "a non-fixture label fails loudly");
  // without the fixture the structural lint still passes it (referential is opt-in)
  assert.deepEqual(parseCases(stale).errors, []);
});

test("cases.jsonl: every expect.result literal is referential against the fixture (no stale literals)", async () => {
  const knownLabels = await loadFixtureLabels();
  const { cases, errors } = parseCases(await readFile(CASES_FILE, "utf8"), { knownLabels });
  assert.deepEqual(errors, [], "committed cases lint clean under the fixture-referential result check");
  // and the frame actually carries composition cases (the rungs aren't a thin
  // sample). Floor raised 7 -> 18 with the 0.8.2 ladder-depth appends (member-
  // filter pair + guard/fallback/empty-fold variants) — update deliberately.
  const withResult = cases.filter((c) => Array.isArray(c.expect.result));
  assert.ok(withResult.length >= 18, `expected a deep composition ladder (got ${withResult.length})`);
});

test("gradeCase: the RESULT axis — composed value-equals the literal PASSES; a wrong/absent fold FAILS plan-independently", () => {
  const caseDef = { rung: "TOOL-5", tools: ["tmct_impact", "tmct_untested"], expect: { calls: [{ name: "tmct_impact", input: { module: "app/lib/a.mjs" } }, { name: "tmct_untested" }], result: ["app/lib/c.mjs", "scripts/g.mjs"], terminates: true } };
  const calls = [{ name: "tmct_impact", input: { module: "app/lib/a.mjs" } }, { name: "tmct_untested", input: {} }];
  // plan-correct AND result-correct (composed set-equals the literal, order-insensitive)
  const good = gradeCase(caseDef, { calls, refused: false, terminated: true, composed: ["scripts/g.mjs", "app/lib/c.mjs"] });
  assert.ok(good.pass && good.completed && good.resultCompleted, good.reasons.concat(good.resultReasons).join("; "));
  // plan-correct but result-WRONG (the fold computed a different set) — the split
  const wrong = gradeCase(caseDef, { calls, refused: false, terminated: true, composed: ["app/lib/c.mjs"] });
  assert.ok(wrong.completed, "plan still matched");
  assert.ok(!wrong.resultCompleted, "but the composed answer is wrong");
  assert.ok(wrong.resultReasons.some((r) => /!=/.test(r)));
  // plan-correct but NO fold produced (a relaxed single-shot plan) — result-incomplete
  const nofold = gradeCase(caseDef, { calls, refused: false, terminated: true });
  assert.ok(nofold.completed && !nofold.resultCompleted);
});

test("gradeCase: a case WITHOUT expect.result mirrors plan completion on the result axis", () => {
  const caseDef = { rung: "TOOL-0", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true } };
  const v = gradeCase(caseDef, { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], refused: false, terminated: true });
  assert.equal(v.resultCompleted, v.completed);
  assert.ok(v.resultCompleted);
});

test("agentbench e2e: the resolver EXECUTES + COMPOSES — result-completion tracks plan-completion exactly under C1 alone (0% hallucination)", async () => {
  const knownLabels = await loadFixtureLabels();
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"), { knownLabels });
  const { rows, rolled } = await runAgentbench(cases, { driver: resolverDriver, stamp: BENCH_VERSION, ctx: CTX });
  // the non-negotiable holds on BOTH axes
  assert.equal(rolled.overall.hallucinationRate, 0, "0% hallucination — the router's floor");
  // UPDATE (TOO_HARD_AUDIT.md M2, fixed): this used to assert a real plan-vs-result
  // GAP under the C1 resolver alone (ab-c2-what-to-test passed plan with a single
  // unranked tmct_untested call, then failed result since nothing ranked it). Fixed
  // by making the C1 "untested" frame skip on a superlative cue (resolver.mjs), so
  // a ranking request no longer gets a half-answer from C1 at all — it now honestly
  // REFUSES at this layer (see goal-reasoner.test.mjs for its full C2 resolution).
  // Composing is still no easier than planning, but there is no longer any case
  // where C1 alone completes a plan it can't also compose for real.
  assert.ok(rolled.overall.resultCompletion <= rolled.overall.completion);
  assert.equal(rolled.overall.resultCompletion, rolled.overall.completion, "under the C1 resolver alone, every completed plan also composes — no half-answers");
  // the intersection case is the positive proof result-grading WORKS: plan AND result
  const inImpact = rows.find((r) => r.caseId === "ab-c1-untested-in-impact");
  assert.ok(inImpact.verdict.completed && inImpact.verdict.resultCompleted, "untested-∩-impact composes to the true set");
  assert.deepEqual(inImpact.produced.composed, ["app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"]);
  // the empty-composition case composes to ∅ correctly (a real answer, not a miss)
  const empty = rows.find((r) => r.caseId === "ab-c1-untested-in-impact-b");
  assert.deepEqual(empty.produced.composed, []);
  assert.ok(empty.verdict.resultCompleted);
  // the MEMBER-FILTER recipe (0.8.2): the per-member hop the 0.8.1 relaxation
  // named as missing now composes the true answer — green on BOTH axes.
  const memberFilter = rows.find((r) => r.caseId === "ab-c1-widget-methods-calling");
  assert.ok(memberFilter.verdict.completed && memberFilter.verdict.resultCompleted, "member-filter composes the reachability answer (the 0.8.1 relaxation retired)");
  assert.deepEqual(memberFilter.produced.composed, ["Widget.render"]);
  assert.deepEqual(memberFilter.produced.calls.map((c) => c.name), ["tmct_members", "tmct_callees"], "the per-member callees hop is a real, appended grounded call");
  // its HELD-OUT EMPTY TWIN: a new class, no callable members, composes ∅
  const twin = rows.find((r) => r.caseId === "ab-c1-button-methods-calling");
  assert.ok(twin.verdict.completed && twin.verdict.resultCompleted, "the recipe generalizes to Button and composes an honest ∅");
  assert.deepEqual(twin.produced.composed, []);
  // ab-c2-what-to-test honestly REFUSES under the C1 resolver alone — it needs
  // the C2 goal-reasoner's keystone ranking, which goal-reasoner.test.mjs
  // confirms the escalating goalDriver produces in full. The case declares
  // floorExpect, so on this arm the refusal grades as the correct outcome
  // (declared, not a bare miss) while the goal arm keeps the six-call bar.
  const wtt = rows.find((r) => r.caseId === "ab-c2-what-to-test");
  assert.ok(wtt.produced.refused && wtt.produced.calls.length === 0, "C1 alone honestly refuses rather than half-answering with an unranked list");
  assert.ok(wtt.floorExpectApplied === true, "the floor override is recorded on the row");
  assert.ok(wtt.verdict.completed, "the declared refusal grades as this arm's correct outcome");
});

test("member-filter: memberIndividuals is the GRAIN FIX (full individuals, dotted labels) and membersReaching folds bounded reach", () => {
  const g = CTX.graph;
  const widget = CTX.resolve("Widget").match;
  const members = memberIndividuals(g, widget);
  // FULL individuals through the by-id index — dotted labels + real classes,
  // never a string-concatenated "<Class>.<short>" guess.
  assert.deepEqual(members.map((m) => m.label).sort(), ["Widget.name", "Widget.render"]);
  assert.deepEqual(members.map((m) => m.class).sort(), ["Attribute", "Method"]);
  // the fold: only the CALLABLE member whose callsSymbol closure reaches fnAlpha
  assert.deepEqual(membersReaching(g, widget, "fnAlpha"), ["Widget.render"]);
  // an unreachable / unknown target composes ∅ (honest empty, never a guess)
  assert.deepEqual(membersReaching(g, widget, "app/lib/b.mjs"), []);
  assert.deepEqual(membersReaching(g, widget, "no-such-entity"), []);
  // a class with no members composes ∅
  assert.deepEqual(membersReaching(g, CTX.resolve("Button").match, "fnAlpha"), []);
});

test("member-filter driver: refuses the hop honestly when tmct_callees is undeclared or the target does not bind", async () => {
  // the reachability hop is NOT groundable without tmct_callees in-set
  const noHop = await resolverDriver("which methods of Widget end up calling fnAlpha", ["tmct_members", "tmct_callers"], CTX);
  assert.equal(noHop.refused, true);
  assert.deepEqual(noHop.calls, []);
  assert.match(String(noHop.why), /tmct_callees/);
  // an unbindable filter target is an honest miss, never a guessed fold
  const noTarget = await resolverDriver("which methods of Widget end up calling zebraFn", ["tmct_members", "tmct_callees"], CTX);
  assert.equal(noTarget.refused, true);
  assert.deepEqual(noTarget.calls, []);
});
