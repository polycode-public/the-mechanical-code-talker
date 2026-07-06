// src/router/goal-reasoner.mjs — Stage 5 of the capability router
// (PLAN_CAPABILITY_ROUTER.md / STAGE_5_GOAL_REASONER.md): THE CLOSED-WORLD C2
// GOAL-REASONER. "Self-directed" is not magic — it is a canned, HARD-BOUNDED
// meta-loop (Rao & Georgeff BDI × Aha/Molineaux/Cox GDA × continual planning):
//
//     deduce current goals            (step 1 — the only genuinely new part)
//   → plan for each goal              (step 2 — C1: the Stage-3 planner/resolver)
//   → arbitrate the first steps       (step 3a — keystone, threat-aware)
//   → PERSIST the committed intention  (step 3b — BDI drop conditions)
//   → execute ONE, observe, repeat    (step 5 — Steel & Ho monitor / GDA replan)
//
// The elegance (RFC): C2 collapses into C1 + a goal-deduction step + an
// action-selection rule. Everything except goal-deduction is solved machinery.
// This module supplies the goal-deduction as a DEDUCTION over a DECLARED goal
// model (never a judgement over the request string) and REFUSES at the
// open-world goal-generation seam rather than inventing a goal — the C2 analogue
// of the resolver's "never emit a call it cannot prove".
//
// DEDUCTION, NOT KEYWORD-MATCH. The current goals fall out of the KB via a
// declared goal model (GOAL_RULES), exactly as syllogise chains a declared rule
// over the graph under mechanical guards. The ONLY thing this reads off the
// request is a FOCUS entity (delegated to the resolver's extractEntity + the
// binding oracle — entity resolution, never intent keywords). Whether a goal is
// active is then deduced from the graph (is the focus module untested? what does
// its change reach?), so no request-string literal steers the routing.
//
// MECHANICAL TERMINATION (not a convergence argument). Two independent bounds:
//   (1) a hard OUTER-tick budget MAX_TICKS (mirrors the planner's MAX_STEPS), and
//   (2) a MONOTONE-PROGRESS invariant — every tick ACHIEVES exactly one intention
//       (removes it from the pending set); the only growth is a SINGLE, bounded
//       GDA expansion (impact-of-each over the finite untested set), gated by a
//       one-shot flag. So the pending set strictly shrinks to the empty set in
//       <= (initial + |untested|) ticks, and MAX_TICKS caps it absolutely. A tick
//       that makes no progress HALTS (honest refuse). Termination is proven
//       mechanically, not argued from BDI convergence.
//
// THREAT-AWARENESS (POP threats lifted to the meta-level). A first step that
// clobbers another live goal's precondition is a threat. Here it is PROVABLY
// absent: every registry capability is read-only with an EMPTY delete-list
// (queries mutate nothing — the STRIPS closed world), so no step can delete a
// condition another goal depends on. We compute this from the registry rather
// than assume it (threatsAmong), so the guarantee is grounded, not asserted.

import { backwardChain, extractEntity } from "./resolver.mjs";
import { capabilityByName, effectsOf } from "./registry.mjs";
import { hallucinationsIn } from "../../agentbench/grade.mjs";
import { intersect } from "../../agentbench/results.mjs";

// Hard OUTER-tick budget — the meta-loop runs at most this many ticks, then
// REFUSES (escalate). Independent of BDI convergence and of the monotone
// invariant: a belt-and-braces mechanical stop, the meta-level twin of the
// planner's MAX_STEPS. A deduce->plan->observe cycle can never wedge the caller.
export const MAX_TICKS = 16;

// ---- the DECLARED goal model (data, mirroring registry.mjs's STRIPS operators)
// A goal-rule is a maintenance INVARIANT over the graph, plus the epistemic
// sub-goals whose facts decide whether it is violated and the DECLARED priority
// that breaks ties in first-step arbitration. Growing this set is the "long-chain
// deduction library" the RFC flags — same discipline as syllogise's rule set.
export const GOAL_RULES = Object.freeze([
  Object.freeze({
    id: "coverage-invariant",
    kind: "maintenance",
    // INVARIANT: a Module whose change reaches other modules (non-empty impact
    // closure) MUST have direct test coverage. A Module that is untested AND
    // impactful VIOLATES it — an active goal to close the coverage gap.
    invariant: "an impactful module must be tested",
    // the epistemic facts a plan must gather to evaluate the invariant (each
    // backward-chains to a capability, exactly like the resolver's NL intents).
    subGoals: Object.freeze(["impact", "untested"]),
    // the DECLARED priority key for first-step arbitration: a violation's
    // priority is its blast radius |impact(module)| — the wider the reach, the
    // higher the goal (keystone = the widest-reach untested module).
    priorityTopic: "impact",
    // the coverage predicate the invariant screens on.
    coverageTopic: "untested",
    // the meta-goal topic the composed answer achieves (backward-chained below).
    achieves: "coverage-gap",
  }),
]);

/** Backward-chain a meta-goal topic to the declared goal-rule that achieves it —
 *  the goal-level twin of resolver.backwardChain (capability selection). Pure. */
export function backwardChainGoal(topic) {
  return GOAL_RULES.find((r) => r.achieves === topic) || null;
}

const refuse = (why, driver) => ({ calls: [], refused: true, terminated: true, proof: [], composed: null, driver, why });

/** THREATS lifted to the meta-level: any pending intention whose needed condition
 *  a candidate step's DELETE-effects would clobber (POP threats over the
 *  conjunction of active goals). Computed from the registry's delete-lists. In
 *  this read-only registry every capability's delete-list is empty, so this is
 *  provably [] — but we DERIVE it rather than assume it, so the guarantee holds
 *  the day a mutating capability is ever registered. Pure over the registry. */
export function threatsAmong(candidateName, _pending) {
  const cap = capabilityByName(candidateName);
  const del = cap ? effectsOf(cap.name).del : [];
  return del.length ? [{ name: candidateName, deletes: del }] : [];
}

/** Resolve the FOCUS the request scopes the goal model to — an entity binding
 *  (extractEntity + the graph oracle), NOT an intent keyword. Returns the bound
 *  individual or null (no bindable focus => a whole-graph / global goal). */
function focusOf(request, ctx) {
  const term = extractEntity(String(request || ""));
  if (!term || !ctx || !ctx.resolve) return null;
  const r = ctx.resolve(term);
  return r && r.match && !r.ambiguous ? r.match : null;
}

/** Ground ONE epistemic sub-goal (a topic + optional bound entity) into a
 *  grounded, EXECUTED call, or null when it is not groundable in the declared
 *  toolset (=> the meta-loop escalates). Backward-chains topic->capability, binds
 *  the entity, self-checks the same zero-hallucination gate the grader enforces,
 *  then dispatches. Mirrors the resolver/planner's honest-miss discipline. */
async function groundSubGoal(topic, entityLabel, tools, ctx) {
  const cap = backwardChain(topic);
  if (!cap || !tools.includes(cap.name)) return null; // no declared capability => escalate
  // the arg grain: a no-arg coverage scan (untested) binds nothing; an entity
  // topic binds the focus label to the capability's single slot.
  const param = cap.parameters.find((p) => p.required);
  if (param && !entityLabel) return null; // an entity topic with nothing to bind
  const input = param && entityLabel ? { [param.arg]: entityLabel } : {};
  const call = { name: cap.name, input };
  if (hallucinationsIn(call, tools).length) return null; // never emit an unprovable call
  const res = await ctx.dispatch(cap.name, input);
  if (!res || !res.ok) return null; // honest miss at dispatch => escalate
  return { call, result: Array.isArray(res.result) ? res.result : [] };
}

/** BDI DROP CONDITIONS (Rao & Georgeff): an intention persists until it is
 *  achieved / impossible / its goal lapses. Returns the reason string, or null
 *  to KEEP committing to it. Pure — unit-testable in isolation. */
export function dropCondition(intention, observed, mode, focus) {
  if (observed.has(intention.key)) return "achieved";       // fact now gathered
  if (mode === "scoped" && (!focus || focus.class !== "Module")) return "lapsed"; // focus moved
  return null;                                               // else keep the commitment
}

/** THE META-LOOP. deduce current goals -> plan-each (C1) -> threat-aware
 *  persistent first-step arbitration -> execute one -> observe -> repeat,
 *  HARD-BOUNDED. Returns a loopResult { calls, refused, terminated, proof, why,
 *  composed, driver } — a composed answer (the coverage-gap set for a focus, or
 *  the keystone module globally) or an HONEST REFUSE at the open-world
 *  goal-generation seam.
 *
 *  ctx: { dispatch(name,input)->{ok,result}, resolve(term)->{match,ambiguous} }. */
export async function goalReason(request, tools, ctx, { driver = "goal-0.8.1" } = {}) {
  const declared = Array.isArray(tools) ? tools : [];
  const rule = backwardChainGoal("coverage-gap");
  if (!rule) return refuse("no declared goal-rule achieves the meta-goal — escalate", driver);

  // STEP 1 — deduce the goal scope from the DECLARED model + a bound focus.
  const focus = focusOf(request, ctx);
  let mode;
  if (focus && focus.class === "Module") mode = "scoped"; // assess the focus module's change footprint
  else if (focus) mode = "escalate";                      // a non-Module focus: no declared rule covers it
  else mode = "global";                                   // no focus => rank the whole codebase (keystone)

  // The open-world goal-generation seam, named honestly: a resolved focus the
  // declared goal model does not cover is REFUSED, never given an invented goal.
  if (mode === "escalate") {
    return refuse(`open-world: no declared goal-rule covers a ${focus.class} focus (the coverage-invariant is Module-scoped) — escalate`, driver);
  }

  // the glass-box WHY, citing the declared goal-rule by backward-chain (the C2
  // twin of resolver.mjs's "backward-chain => <capability>" provenance).
  const why = [
    `goal-deduction: backward-chain (achieves ${rule.achieves}) => goal-rule "${rule.id}" (${rule.invariant})`,
    `mode: ${mode}${focus ? ` (focus ${focus.label} [${focus.class}])` : " (whole-graph / keystone arbitration)"}`,
    "threat-check: read-only registry => every capability delete-list empty => meta-level POP threats provably none",
  ];
  const proof = [{ step: "goal-rule", rule: rule.id, achieves: rule.achieves, ok: true }];
  const calls = [];
  const observed = new Map();     // intention.key -> gathered result set

  // STEP 2/3 — the pending INTENTIONS (epistemic sub-goals), each carrying its
  // declared execution order (arbitration is least-commitment: min order first,
  // the keystone selection over the gathered facts happens at compose).
  //   scoped: gather impact(focus) then the untested coverage-scan.
  //   global: gather untested first, then EXPAND to impact-of-each (GDA replan).
  const pending = mode === "scoped"
    ? [{ topic: "impact", of: focus.label, key: `impact:${focus.label}`, order: 0 },
       { topic: "untested", of: null, key: "untested", order: 1 }]
    : [{ topic: "untested", of: null, key: "untested", order: 0 }];

  let committed = null;   // the persisted BDI intention (not re-derived each tick)
  let expanded = false;   // one-shot guard: the single bounded GDA expansion
  let ticks = 0;

  while (pending.length) {
    // (1) HARD OUTER BOUND — mechanical, independent of the monotone invariant.
    if (ticks >= MAX_TICKS) return refuse(`meta-loop tick budget exhausted (${MAX_TICKS}) — escalate`, driver);
    ticks += 1;

    // (3b) PERSISTENCE — keep the committed intention unless a BDI drop condition
    //      fires; only THEN re-arbitrate. This is the "commitment, not recomputed
    //      preference" that stops the loop thrashing.
    if (committed && dropCondition(committed, observed, mode, focus)) committed = null;
    if (!committed || !pending.includes(committed)) {
      // (3a) FIRST-STEP ARBITRATION — least-commitment: the lowest declared order
      //      among pending. Threat-aware: skip a step that would clobber another
      //      live goal (provably never, read-only) before committing.
      const admissible = pending.filter((i) => threatsAmong(backwardChain(i.topic)?.name, pending).length === 0);
      if (!admissible.length) return refuse("all first steps are threatened (would clobber a live goal) — escalate", driver);
      committed = admissible.slice().sort((a, b) => a.order - b.order)[0];
    }

    // (5) EXECUTE ONE, then OBSERVE (Steel & Ho monitor).
    const grounded = await groundSubGoal(committed.topic, committed.of, declared, ctx);
    if (!grounded) return refuse(`sub-goal (knows ${committed.topic}${committed.of ? ` ${committed.of}` : ""}) not groundable in the declared toolset — escalate`, driver);
    calls.push(grounded.call);
    observed.set(committed.key, grounded.result);
    proof.push({ step: "causal-link", producer: "graph", condition: committed.of ?? committed.topic, consumer: `${committed.topic}:${grounded.call.name}`, ok: true });

    // MONOTONE PROGRESS — this tick ACHIEVED exactly one intention: drop it.
    const before = pending.length;
    const achievedTopic = committed.topic;
    pending.splice(pending.indexOf(committed), 1);
    committed = null;

    // GDA EXPANSION (monitor -> replan), ONCE: on observing the untested set in
    // global mode, expand to the priority sub-goal (impact) for each violating
    // module, so arbitration can rank them. Bounded by |untested| (finite) and
    // fired at most once (the `expanded` guard) => the pending set still
    // converges.
    let expandedThisTick = false;
    if (mode === "global" && achievedTopic === rule.coverageTopic && !expanded) {
      expanded = true;
      expandedThisTick = true;
      const untested = observed.get("untested") || [];
      untested.forEach((m, i) => pending.push({ topic: rule.priorityTopic, of: m, key: `impact:${m}`, order: 100 + i }));
    }

    // the invariant, enforced mechanically: the pending set shrank by one this
    // tick (progress) OR grew ONLY by the one-shot bounded expansion. Anything
    // else is non-progress => HALT honestly rather than risk a livelock.
    if (pending.length > before - 1 && !expandedThisTick) {
      return refuse("meta-loop made no monotone progress — halting", driver);
    }
  }

  // STEP 3a (the answer) — COMPOSE + arbitrate the keystone from the gathered
  // facts (all INSIDE the driver's timeout guard; no unbounded post-work).
  let composed;
  if (mode === "scoped") {
    // the coverage-gap of the focus: the untested modules in its change
    // FOOTPRINT ({focus} ∪ its impact closure) — a real composed set (∅ = no gap).
    const footprint = [focus.label, ...(observed.get(`impact:${focus.label}`) || [])];
    composed = intersect(observed.get("untested") || [], footprint);
    why.push(`compose: untested ∩ ({${focus.label}} ∪ impact) = the change's untested footprint (${composed.length ? composed.join(", ") : "∅ — no coverage gap"})`);
  } else {
    // KEYSTONE arbitration: among the coverage violations (untested modules), pick
    // the highest declared priority — the widest blast radius |impact(m)| — tie
    // broken by label order. The single most-worth-covering module.
    const untested = observed.get("untested") || [];
    const ranked = untested
      .map((m) => ({ m, weight: (observed.get(`impact:${m}`) || []).length }))
      .sort((a, b) => b.weight - a.weight || String(a.m).localeCompare(String(b.m)));
    composed = ranked.length ? [ranked[0].m] : [];
    why.push(`keystone: argmax |impact| over ${untested.length} untested module(s) => ${composed.length ? `${composed[0]} (weight ${ranked[0].weight})` : "∅"}`);
  }

  return { calls, refused: false, terminated: true, proof, why, composed, driver, observed: `goal(${mode}): ${calls.map((c) => c.name).join(" -> ")}` };
}
