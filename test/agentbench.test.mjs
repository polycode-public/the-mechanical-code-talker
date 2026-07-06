// agentbench + router-registry tests — the Stage-0 capability substrate and the
// AGENTBENCH harness (Phase 11, PLAN_CAPABILITY_ROUTER.md). Like chatbench's
// tests these cover the HARNESS + the substrate deterministically; there is no
// judge here at all — AGENTBENCH grading is fully deterministic by design.
//
// Three groups:
//   1. registry shape — the STRIPS/PDDL capability model (Deliverable 1);
//   2. grading logic — the zero-hallucination gate, metric pair, ladder;
//   3. CONFORMANCE — the "verified against the dispatchTool switch" note made
//      EXECUTABLE: every registry arg-key is actually read by dispatchTool, and
//      the registry name-set is a strict SUBSET of the dispatch case set
//      (closed-world default-deny). This catches arg-key drift at merge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  REGISTRY, VOCAB, PRECOND, KINDS,
  capabilities, capabilityByName, isCapability, parametersOf,
  preconditionsOf, effectsOf, argKeysOf, requiredArgsOf,
  EXCLUDED_FROM_REGISTRY,
} from "../src/router/registry.mjs";
import {
  RUNGS, COMPLETION_FLOOR, parseCases, hallucinationsIn, isCallWellFormed,
  callMatches, callsMatch, gradeCase, rollup, ladderGate,
} from "../agentbench/grade.mjs";
import { stubDriver } from "../agentbench/driver-stub.mjs";
import { shimDriver } from "../agentbench/driver-shim.mjs";
import { runAgentbench, createRunCtx, BENCH_VERSION } from "../agentbench/run.mjs";
import { COMMANDS } from "../src/chat.mjs";

const CASES_FILE = fileURLToPath(new URL("../agentbench/cases.jsonl", import.meta.url));

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

test("registry: every capability carries a graph-loaded precondition (the safety gate)", () => {
  for (const c of capabilities()) {
    const preds = c.preconditions.map((p) => p.pred);
    assert.ok(preds.includes(PRECOND.graphLoaded), `${c.name} requires graph-loaded`);
  }
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
  const caseDef = { rung: "A0", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true, proof: true } };
  const loop = { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], refused: false, terminated: true, proof: [{ ok: true }, { ok: true }] };
  const v = gradeCase(caseDef, loop);
  assert.ok(v.pass, v.reasons.join("; "));
  assert.ok(v.completed);
  assert.deepEqual(v.hallucinated, []);
});

test("gradeCase: a hallucinated call is an AUTOMATIC FAIL even if it 'answers'", () => {
  const caseDef = { rung: "A1", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true } };
  // the driver reached OUTSIDE the declared set — automatic fail
  const loop = { calls: [{ name: "tmct_callers", input: { symbol: "Widget" } }], refused: false, terminated: true };
  const v = gradeCase(caseDef, loop);
  assert.ok(!v.pass);
  assert.equal(v.hallucinated.length, 1);
});

test("gradeCase: refusing-when-unsure passes at the honest-miss level; a wrong call instead of refusing fails", () => {
  const refuseCase = { rung: "A2", tools: ["tmct_describe"], expect: { refuse: true, terminates: true } };
  assert.ok(gradeCase(refuseCase, { calls: [], refused: true, terminated: true }).pass);
  // produced a call when it should have refused
  const bad = gradeCase(refuseCase, { calls: [{ name: "tmct_describe", input: { symbol: "zebra" } }], refused: false, terminated: true });
  assert.ok(!bad.pass);
});

test("gradeCase: a required-but-missing proof chain fails a proof case", () => {
  const caseDef = { rung: "A0", tools: ["tmct_untested"], expect: { calls: [{ name: "tmct_untested" }], terminates: true, proof: true } };
  const v = gradeCase(caseDef, { calls: [{ name: "tmct_untested" }], refused: false, terminated: true, proof: [] });
  assert.ok(!v.pass);
  assert.ok(v.reasons.some((r) => /proof/.test(r)));
});

test("rollup: the METRIC PAIR + gate — a refuse-everything driver hits 0% halluc but FAILS on completion", () => {
  const cases = [
    { rung: "A0", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_describe", input: { symbol: "Widget" } }], terminates: true } },
    { rung: "A0", tools: ["tmct_untested"], expect: { calls: [{ name: "tmct_untested" }], terminates: true } },
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
      A0: { total: 2, completion: 1, hallucinationRate: 0, gatePass: true },
      A1: { total: 2, completion: 0.2, hallucinationRate: 0, gatePass: false },
      A2: { total: 2, completion: 1, hallucinationRate: 0, gatePass: true },
    },
    overall: {},
  };
  const g = ladderGate(rolled);
  assert.match(g.gatedAt, /A1 completion/);
  assert.deepEqual(g.receipts.map((r) => r.rung), ["A2"]);
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
    JSON.stringify({ id: "x2", rung: "A0", request: "q", tools: ["not_a_tool"], expect: { refuse: true, terminates: true } }),
    JSON.stringify({ id: "x3", rung: "A0", request: "q", tools: ["tmct_describe"], expect: { calls: [{ name: "tmct_callers", input: { symbol: "W" } }], terminates: true } }),
  ].join("\n");
  const { errors } = parseCases(bad);
  assert.ok(errors.some((e) => /rung must be one of/.test(e)));
  assert.ok(errors.some((e) => /not a declared capability/.test(e)));
  assert.ok(errors.some((e) => /not in the case's declared tools/.test(e)));
});

// ---- 3. CONFORMANCE — the executable "verified against the switch" ----------

test("conformance: registry ⊆ dispatchTool AND every arg-key is read by the switch", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    for (const cap of capabilities()) {
      const res = await ctx.dispatch(cap.name, {}); // empty input
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
  } finally {
    await cleanup();
  }
});

test("conformance: the EXCLUDED tools are dispatched but unregistered (strict subset, not disjoint)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    for (const name of ["tmct_snippet", "tmct_context_more"]) {
      assert.ok(!isCapability(name), `${name} is intentionally unregistered`);
      const res = await ctx.dispatch(name, {});
      // it IS a dispatch case (server handles it) — proving the registry is a
      // strict SUBSET of the switch, not a disjoint set.
      assert.ok(!res.ok && !/unknown tool/.test(res.error), `${name} is dispatched (excluded from the registry, not unknown)`);
    }
  } finally {
    await cleanup();
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
  const { rows, rolled } = await runAgentbench(cases, { stamp: BENCH_VERSION });
  assert.equal(rows.length, cases.length);
  for (const r of rows) {
    assert.equal(r.driver, "stub-floor", "every row is stamped the stub-driver floor, not a router baseline");
    assert.equal(r.version, BENCH_VERSION, "artifacts are stamped the bench version (tracks package.json)");
  }
  // the seed set is authored to the stub's ability, so the floor clears its gate
  assert.equal(rolled.overall.hallucinationRate, 0, "the stub structurally cannot hallucinate (default-deny to declared set)");
  assert.ok(rolled.overall.completion >= COMPLETION_FLOOR);
  assert.ok(rolled.overall.gatePass);
});

// ---- the SHIM-TRANSPORT baseline driver -------------------------------------

test("agentbench e2e: the shim-transport driver NEVER hallucinates over the whole ladder (its non-negotiable)", async () => {
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"));
  const { rows, rolled } = await runAgentbench(cases, { driver: shimDriver, stamp: BENCH_VERSION });
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
  const { ctx, cleanup } = await createRunCtx();
  try {
    // a bare COMMANDS verb + entity → the shim emits a grounded, well-formed call.
    const ok = await shimDriver("describe Widget", ["tmct_describe"], ctx);
    assert.equal(ok.driver, "shim-transport");
    assert.deepEqual(ok.calls, [{ name: "tmct_describe", input: { symbol: "Widget" } }]);
    assert.equal(ok.refused, false);
    assert.deepEqual(hallucinationsIn(ok.calls[0], ["tmct_describe"]), []);

    // free-NL phrasing is out of the command register → text answer here = REFUSE,
    // never a guessed/ungrounded call.
    const nl = await shimDriver("which functions call fnAlpha", ["tmct_describe", "tmct_callers", "tmct_callees"], ctx);
    assert.equal(nl.refused, true);
    assert.deepEqual(nl.calls, []);

    // a multi-step recipe: the single-call transport emits at most one call →
    // refuses here (no thread-through), a ceiling, never a hallucination.
    const multi = await shimDriver("find who calls fnAlpha, then describe Widget.render", ["tmct_callers", "tmct_describe"], ctx);
    assert.equal(multi.refused, true);
    assert.deepEqual(multi.calls, []);

    // a command whose entity does not resolve → honest refusal (no ungrounded call).
    const miss = await shimDriver("describe zebra.mjs", ["tmct_describe"], ctx);
    assert.equal(miss.refused, true);
    assert.deepEqual(miss.calls, []);
  } finally {
    await cleanup();
  }
});

test("agentbench e2e: the stub driver refuses a request whose only fitting tool is out-of-set", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    // "history of X" but tmct_history is not offered → honest refusal, no call
    const loop = await stubDriver("what is the commit history of Widget.render", ["tmct_describe", "tmct_callers"], ctx);
    assert.equal(loop.refused, true);
    assert.deepEqual(loop.calls, []);
    assert.equal(loop.driver, "stub-floor");
  } finally {
    await cleanup();
  }
});
