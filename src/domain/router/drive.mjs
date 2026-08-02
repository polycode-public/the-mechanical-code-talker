// src/domain/router/drive.mjs — the product-facing drive of the capability router: the
// piece that turns a real English request into a real, executed answer over a
// real repo graph. registry/resolver/planner/goal-reasoner/call-validator
// are all pure, deterministic decision machinery — this module
// is the thin, stateful shell around them that a CLI or chat surface calls:
// build a { dispatch, resolve, graph } context against the repo's actual code
// graph, then run a request through resolver -> planner -> goal-reasoner.
//
// Single-shot -> the resolver. A single-shot bound argument that TIES between
// two same-tier candidates (a source module and its own test module, the
// graph's own `tests` edge — never a raw score tie alone) never picks one
// arbitrarily: the resolver dispatches a read per tied candidate and refuses
// with `candidateResults` carrying both, the enumerate-or-refuse discipline
// the chat surface's own ambiguous-entity refusal already uses. A compound
// "... then ..."/"if ..."/"of the ..., which are ..." request -> the planner,
// HTN-decomposed into an ordered call sequence with a POP causal-link proof
// chain, then folded into ONE composed answer via the same set-algebra the HTN
// method names (relative-filter -> intersect; conditional -> fallback/guard).
// A "<primary>, and if <it came up empty>, <fallback> instead" request
// decomposes to the RECOVER method instead: the primary dispatches, its own
// structured result is OBSERVED, and the fallback dispatches only when that
// observation is empty (`recovered:true`) — never both, and never neither. A
// refused WORLD goal ("make every disk rest on peg-c") is tried against the
// taught capability records next (runTaughtPlan — selected by backward
// chaining, grounded by pure simulation, never dispatched). A request none of
// those ground escalates to the closed-world goal-reasoner — a maintenance-
// invariant deduction (coverage-gap / cochange-risk), never a keyword guess.
// Anything no stage grounds is an honest refuse, the same "grounded or an
// honest miss" contract as every other tmct answer path.

import { resolveOne, backwardChainWorld, resolveMemoryTerm } from "./resolver.mjs";
import { plan, isMultiStep, decompose, MAX_STEPS } from "./planner.mjs";
import { goalReason } from "./goal-reasoner.mjs";
import { capabilities, preconditionsOf, PRECOND } from "./registry.mjs";
import { registerTaughtActions } from "./taught.mjs";
import { intersect, fallbackIfEmpty, guardIfEmpty, memberIndividuals, membersReaching, resultSetOf } from "./results.mjs";
import { resolveObject } from "../ask.mjs";
import { parseEntities } from "../codegraph.mjs";
import {
  compileDomain, stateFromFacts, stateKeyFor, movesFromRules, compileGoal, PlanBudgetError,
} from "../domain.mjs";
import { findActionPath } from "../planning.mjs";

export const ROUTER_DRIVER = "resolver-0.8.0";
export const GOAL_DRIVER = "goal-0.8.1";
export const TAUGHT_DRIVER = "taught-0.1.0";

/** Every registered capability's name — the default declared toolset for a
 *  caller that doesn't want to hand-pick a subset. */
export function declaredCapabilityNames() {
  return capabilities().map((c) => c.name);
}

const CALLABLE_MEMBER_CLASSES = new Set(["Method", "Function"]);
const refuse = (why, driver) => ({ calls: [], refused: true, terminated: true, proof: [], driver, why });

/** Execute the MEMBER-FILTER HTN method ("which methods of X end up calling Y")
 *  — the per-member hop the single-shot resolver cannot emit on its own. Step 1
 *  grounds members(X) via resolveOne; then, per CALLABLE member (sorted), one
 *  tmct_callees hop, so long as the whole list fits the planner's MAX_STEPS
 *  budget. The fold is membersReaching (the bounded transitive callsSymbol
 *  closure), computed over the graph, never parsed from text — it covers every
 *  member whether or not the hops were emitted, so a class with more members
 *  than the plan budget allows gets the same answer with a fold step in the
 *  proof in place of the hop chain. Honest refuses: no tmct_callees in the
 *  declared toolset, an unbindable filter target, an ungrounded member list. */
async function memberFilterDrive(request, tools, ctx, segments) {
  const [setSeg, filterSeg] = segments;
  if (!tools.includes("tmct_callees")) {
    return refuse("the member-filter reachability hop needs tmct_callees, which is not in the declared toolset — refusing the hop rather than guessing the fold", ROUTER_DRIVER);
  }
  const t = ctx.resolve ? ctx.resolve(String(filterSeg.text)) : null;
  if (!t || !t.match || t.ambiguous) {
    return refuse(`the member-filter target "${filterSeg.text}" does not bind to one graph entity (honest miss)`, ROUTER_DRIVER);
  }
  const target = t.match;

  const r1 = await resolveOne(setSeg.text, tools, ctx, { execute: true });
  if (r1.refused) return refuse(`sub-goal 1 ("${setSeg.text}") did not resolve: ${r1.reason}`, ROUTER_DRIVER);
  const classInd = r1.resolved;
  if (!classInd) return refuse(`sub-goal 1 ("${setSeg.text}") grounded no class entity to enumerate`, ROUTER_DRIVER);

  const calls = [r1.selected];
  const proof = [{ step: "causal-link", producer: "graph", condition: classInd.label, consumer: `step-1:${r1.selected.name}`, role: "action", ok: true }];
  for (const s of r1.proof) proof.push({ ...s, ofStep: 1 });
  const why = [
    `HTN method: member-filter — enumerate members(${classInd.label}), fold by bounded transitive reach of ${target.label} over every callable member, and hop tmct_callees per member while that hop chain fits the plan budget`,
    ...(r1.why || []).map((w) => `[1] ${w}`),
  ];

  const members = memberIndividuals(ctx.graph, classInd)
    .filter((m) => CALLABLE_MEMBER_CLASSES.has(m.class))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  // MAX_STEPS bounds the emitted PLAN, not the answer. The fold below reads the
  // graph's own callsSymbol edges in one pass over every member at any member
  // count, so a member list too long to walk hop by hop still gets folded — it
  // just gets no per-member hops. All of them or none: emitting the first seven
  // of ninety-nine would read as "these are the members I checked", which is a
  // trace of work nobody did.
  const hopsFitTheBudget = 1 + members.length <= MAX_STEPS;
  if (hopsFitTheBudget) {
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i];
      const res = await ctx.dispatch("tmct_callees", { symbol: m.label });
      if (!res.ok) return refuse(`the callees hop for ${m.label} did not ground: ${res.error}`, ROUTER_DRIVER);
      calls.push({ name: "tmct_callees", input: { symbol: m.label } });
      proof.push({ step: "causal-link", producer: "step-1", condition: m.label, consumer: `step-${i + 2}:tmct_callees`, role: "member-filter", ok: true });
      why.push(`[${i + 2}] callees hop over ${m.label} (a member step 1 produced)`);
    }
  } else {
    proof.push({
      step: "graph-fold", producer: "step-1", condition: target.label,
      consumer: `fold:membersReaching(${classInd.label})`, role: "member-filter",
      members: members.length, hops: 0, ok: true,
    });
    why.push(`[2] ${members.length} callable members needs a ${1 + members.length}-step plan against a budget of ${MAX_STEPS}, so no per-member callees hop was dispatched — the fold reads the same callsSymbol edges those hops would have reported, over every one of the ${members.length}`);
  }

  const composed = membersReaching(ctx.graph, classInd, target.label);
  const trace = hopsFitTheBudget
    ? calls.map((c) => c.name).join(" -> ")
    : `${calls.map((c) => c.name).join(" -> ")} + graph fold over ${members.length} members`;
  return {
    calls, refused: false, terminated: true, proof, driver: ROUTER_DRIVER, why, composed,
    observed: `plan(member-filter): ${trace} => {${composed.join(", ")}}`,
  };
}

/** Fold a multi-step plan's EXECUTED, threaded step results into one composed
 *  answer, choosing the operator from the router's HTN method:
 *    - relative-filter ("of the <set>, which are <Y>")  -> set INTERSECTION
 *    - conditional "... <action> instead"               -> FALLBACK-if-empty
 *    - conditional "if <check>, <action>"                -> GUARD-if-empty
 *    - sequence (independent "... then ...")             -> no single composed set
 *  Returns a label array, or null when the method composes nothing (sequence). */
async function composeResult(request, calls, ctx) {
  const { method } = decompose(request);
  if (method !== "relative-filter" && method !== "conditional") return null;
  if (calls.length < 2) return null; // a relaxed/short plan cannot fold — result stays unmet

  const sets = [];
  for (const c of calls) {
    const res = await ctx.dispatch(c.name, c.input || {});
    sets.push(res.ok && Array.isArray(res.result) ? res.result : []);
  }

  if (method === "relative-filter") return intersect(sets[0], sets[1]);
  return /\binstead\b/i.test(request) ? fallbackIfEmpty(sets[0], sets[1]) : guardIfEmpty(sets[0], sets[1]);
}

/** Single-shot via the resolver, compound via the planner (+ result
 *  composition). Never escalates to the goal-reasoner on its own — see
 *  runCapabilityPlan for the full resolver/planner -> goal-reasoner chain. */
export async function runResolverPlan(request, tools, ctx) {
  const d = decompose(request);
  if (d.method === "member-filter") return memberFilterDrive(request, tools, ctx, d.segments);

  if (isMultiStep(request)) {
    const loop = await plan(request, tools, ctx, { driver: ROUTER_DRIVER });
    if (loop.refused) return loop;
    const composed = await composeResult(request, loop.calls, ctx);
    return composed === null ? loop : { ...loop, composed };
  }

  const r = await resolveOne(request, tools, ctx, { execute: true });
  if (r.refused) {
    return {
      calls: [], refused: true, terminated: true, proof: [], driver: ROUTER_DRIVER, why: r.reason,
      // the tied-candidate composer's answer: one dispatched read per tied
      // candidate, riding the refusal rather than an arbitrary pick.
      ...(r.candidateCalls ? { candidateResults: r.candidateCalls } : {}),
    };
  }
  return {
    calls: [r.selected], refused: false, terminated: true, proof: r.proof,
    driver: ROUTER_DRIVER, why: r.why, observed: r.observed,
  };
}

// ---- the taught world-goal lane -----------------------------------------------

// The one closed world-goal recognizer: "make/get (every|each|all)? <term>
// <verb>s? <prep> <object>". The preposition set mirrors chat.mjs's PREP_SRC
// but stays LOCAL and closed — this lane must never widen because a chat
// frame did, or the two surfaces drift apart silently instead of loudly.
const WORLD_PREP_SRC = "on|in|at|onto|upon|under|over|beside|near|behind|above|below|inside|outside";
const WORLD_GOAL_RE = new RegExp(
  `^(?:make|get)\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+([a-z]+?)s?\\s+(${WORLD_PREP_SRC})\\s+([\\w-]+)[.!?\\s]*$`,
  "i",
);

/** The taught world-goal lane: recognize "make every disk rest on peg-c",
 *  backward-chain the goal predicate to a REGISTERED taught capability record
 *  (the record src/domain/router/taught.mjs bridged in is the thing consumed), then
 *  ground the move sequence by pure simulation over the taught rules
 *  (compileDomain + stateFromFacts + compileGoal + findActionPath — all
 *  read-only). Returned calls are NEVER dispatched: taught records carry
 *  readOnly:false, so the plan is simulated and chat's "next" executes move 1. Returns a loopResult, or null when the request is
 *  not a world-goal shape (the caller falls through to the goal-reasoner). */
export async function runTaughtPlan(request, tools, ctx) {
  const m = WORLD_GOAL_RE.exec(String(request || "").trim());
  if (!m) return null;
  const universal = Boolean(m[1]);
  const term = m[2].toLowerCase();
  const predicate = `${m[3].toLowerCase()}-${m[4].toLowerCase()}`;
  const object = m[5].toLowerCase();

  const cap = backwardChainWorld(predicate);
  if (!cap) {
    return refuse(`the world goal needs a taught action whose effect achieves "${predicate}", and no taught: record with that world-effect is registered — teach the action rules first (honest miss)`, TAUGHT_DRIVER);
  }
  if (!tools.includes(cap.name)) {
    return refuse(`selected ${cap.name} but it is not in the declared toolset`, TAUGHT_DRIVER);
  }
  if (!ctx.readTaughtStore) {
    return refuse(`${cap.name} plans over a taught memory store, and this context carries none`, TAUGHT_DRIVER);
  }

  let domain;
  let state;
  let isGoal;
  try {
    const { factRows, ruleRows } = await ctx.readTaughtStore();
    domain = compileDomain(factRows, ruleRows);
    state = stateFromFacts(factRows, domain);
    isGoal = compileGoal([{ universal, term, predicate, object }], domain);
  } catch (e) {
    return refuse(`the taught domain does not ground this goal: ${e?.message ?? e}`, TAUGHT_DRIVER);
  }
  if (!state.length) {
    return refuse(`no current world state is taught yet — state the board first (e.g. "disk-1 rests on peg-a"), then re-ask`, TAUGHT_DRIVER);
  }
  let found;
  try {
    found = findActionPath(state, isGoal, (s) => movesFromRules(s, domain), { maxDepth: 300, stateKey: stateKeyFor });
  } catch (e) {
    if (e instanceof PlanBudgetError) return refuse(`the taught search space is too large (${e.message}) — narrow the classes involved`, TAUGHT_DRIVER);
    throw e;
  }
  if (!found) {
    return refuse(`no move sequence within 300 steps reaches the goal from the taught state (honest miss)`, TAUGHT_DRIVER);
  }

  const calls = found.actions.map((a) => ({ name: `taught:${a.name}`, input: { subject: a.subject, target: a.target } }));
  for (const c of calls) {
    if (!tools.includes(c.name)) return refuse(`the plan needs ${c.name}, which is not in the declared toolset`, TAUGHT_DRIVER);
  }
  const proof = [
    { step: "backward-chain", pred: "taught:world-effect", predicate, capability: cap.name, ok: true },
    ...calls.map((c, i) => ({ step: "effect", pred: "taught:world-effect", predicate, consumer: `step-${i + 1}:${c.name}`, ok: true })),
  ];
  const why = [
    `world goal (${universal ? "every " : ""}${term} ${predicate} ${object}) => backward-chain over taught:world-effect => ${cap.name}`,
    `grounded by simulation: compileDomain + findActionPath over the taught rules (${calls.length} move${calls.length === 1 ? "" : "s"}, shortest)`,
  ];
  return {
    calls, refused: false, terminated: true, proof, driver: TAUGHT_DRIVER, why,
    observed: `plan(taught): ${calls.length} move${calls.length === 1 ? "" : "s"} simulated over the taught rules — taught: calls are never dispatched; in chat, "next" executes move 1`,
  };
}

/** The full drive: resolver/planner first; a refusal there falls through to
 *  the taught world-goal lane (runTaughtPlan, above), and only a request that
 *  is not a world goal escalates to the closed-world goal-reasoner. Mirrors
 *  test-benchmarks/agentbench's driver-resolver.mjs + driver-goal.mjs composition, with no
 *  test-benchmarks/agentbench/ dependency (test-benchmarks/agentbench/ is dev-only, never shipped). Returns a
 *  loopResult:
 *  `{ calls, refused, terminated, proof, why, driver, composed?, observed?, candidateResults? }`.
 *
 *  A C1 refusal that already carries `candidateResults` (the tied-candidate
 *  composer's enumerate-or-refuse answer) is TERMINAL — it stands as-is rather
 *  than escalating further, the same way a grounded C1 answer stands. Escalating
 *  it would silently trade a complete "both tied readings, dispatched" answer
 *  for whatever the taught/goal lanes make of the same refusal (typically a
 *  plainer refuse with no candidates at all). */
export async function runCapabilityPlan(request, tools, ctx) {
  const c1 = await runResolverPlan(request, tools, ctx);
  if (!c1.refused || c1.candidateResults) return c1;
  const taught = await runTaughtPlan(request, tools, ctx);
  if (taught) return taught.refused ? { ...taught, c1Why: c1.why } : taught;
  const c2 = await goalReason(request, tools, ctx, { driver: GOAL_DRIVER });
  // Both stages refused: carry the resolver/planner's own reason alongside the
  // goal-reasoner's so a caller can show why the direct route AND the
  // maintenance-goal route both declined,
  // rather than only the last (often less specific) of the two.
  return c2.refused ? { ...c2, c1Why: c1.why } : c2;
}

/** Build a real `{ dispatch, resolve, graph, config }` context against a repo's
 *  actual code graph — the router's window onto the live tool layer. The tool
 *  layer itself is INJECTED (this module never imports it): `dispatchTool` runs
 *  the calls, `isToolError` tells an honest miss from a crash, `selectTool` is
 *  the command register the resolver tries first, and the `loadMemory`/
 *  `readFactRows`/`readRuleRows` trio reads the taught store. chat.mjs's
 *  capabilityPlanDeps() bundles the live implementations; spread it into this
 *  call. `dispatch` computes the structured `result` label-set (results.mjs's
 *  resultSetOf) a multi-step plan folds. `resolve` delegates to resolveObject
 *  over the SAME parsed graph, so resolve() and dispatch() always agree on
 *  what an entity resolves to. Pass an already-parsed `graph` (e.g. a chat
 *  session's own) to skip reloading it — mirrors the config ->
 *  source.fetchEntities -> parseEntities chain dispatchTool runs internally,
 *  so a passed-in graph must come from that same chain to stay consistent.
 *
 *  Pass a `memoryDir` to open the taught world-goal lane: the memory store's
 *  action families are registered as taught: capability records (idempotent —
 *  an already-registered name is skipped) and runTaughtPlan simulates over the
 *  same store, re-reading it per request via ctx.readTaughtStore. The new
 *  registrations' unregister disposers ride the ctx as `ctx.disposers`; the
 *  caller runs them when the ctx is done. The same `memoryDir` also opens
 *  `ctx.resolveMemoryTerm` — resolveOne's binding oracle for a KINDS.MemoryTerm
 *  slot (tmct_related's `term`), re-reading the store's fact rows per request
 *  through resolveMemoryTerm (resolver.mjs), the memory-graph sibling of
 *  `resolve` above.
 *
 *  MEMORY-ONLY MODE: pass a `memoryDir` with no `graph` and no `source`, and
 *  the ctx builds with no code graph at all — the shape of a page that lives on
 *  the memory graph alone. `resolve` then misses every term (a code-graph slot
 *  refuses honestly at binding), dispatch refuses any capability whose
 *  preconditions need a loaded code graph, and the memory lanes — MemoryTerm
 *  binding, the taught world-goal simulation — carry the whole ctx. `config`
 *  (if any) is still handed to dispatchTool so a memory-store tool can derive
 *  its backend. A call with no graph, no source and no memoryDir is a wiring
 *  error and throws. */
export async function buildCapabilityPlanCtx({
  config, source = null, tel = null, graph = null, memoryDir = null,
  dispatchTool, isToolError = () => false, selectTool = null,
  loadMemory = null, readFactRows = null, readRuleRows = null,
} = {}) {
  const g = graph || (source ? parseEntities(await source.fetchEntities(config)) : null);
  if (!g && !(memoryDir && loadMemory)) {
    throw new Error("buildCapabilityPlanCtx: pass a graph, a source to load one, or a memoryDir (memory-only mode)");
  }
  const resolve = g ? (term) => resolveObject(g, term) : () => ({ match: null, ambiguous: false, candidates: [] });
  const needsCodeGraph = (name) => preconditionsOf(name).some((p) => p.pred === PRECOND.graphLoaded);
  const dispatch = async (name, input) => {
    if (!g && needsCodeGraph(name)) {
      return { ok: false, error: `${name} queries the code graph, and this memory-only context has none loaded` };
    }
    try {
      // `source ?? undefined` so a memory-only caller's explicit null never
      // suppresses dispatchTool's own default source for a tool that loads.
      // `memoryBackend` hands a memory-reading tool the SAME open store this
      // ctx binds its MemoryTerm slots against, so binding and dispatch can
      // never answer from two different stores — and so a store that was never
      // derived from a config (a browser page's in-memory one) is reachable at
      // all.
      const text = await dispatchTool(name, input, {
        config, source: source ?? undefined, tel, memoryBackend: memoryDir ?? undefined,
      });
      const primary = input && (input.symbol ?? input.module ?? input.class ?? input.query);
      const resolved = primary ? resolve(String(primary)).match : null;
      const result = g ? resultSetOf(g, name, input, resolved) : [];
      return { ok: true, text, resolved, result };
    } catch (e) {
      if (isToolError(e)) return { ok: false, error: e.message };
      throw e;
    }
  };
  const ctx = { dispatch, resolve, graph: g, config };
  if (selectTool) ctx.selectTool = selectTool;
  if (memoryDir && loadMemory) {
    ctx.memoryDir = memoryDir;
    ctx.readTaughtStore = async () => {
      const memory = await loadMemory(memoryDir);
      return { factRows: readFactRows(memory), ruleRows: readRuleRows(memory) };
    };
    ctx.resolveMemoryTerm = async (term) => resolveMemoryTerm(readFactRows(await loadMemory(memoryDir)), term);
    ctx.disposers = registerTaughtActions(readRuleRows(await loadMemory(memoryDir)));
  }
  return ctx;
}
