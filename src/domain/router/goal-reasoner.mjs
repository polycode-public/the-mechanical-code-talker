// src/domain/router/goal-reasoner.mjs — the closed-world goal-reasoner: a canned,
// hard-bounded meta-loop (BDI x goal-driven autonomy):
//
//     deduce current goals -> plan each goal (resolver.mjs's backward chain)
//   -> arbitrate the first steps, threat-aware -> persist the committed intention
//   -> execute ONE, observe, repeat
//
// Goal-deduction is a DEDUCTION over a DECLARED goal model (GOAL_RULES), never a judgement
// over the request string: the only thing read off the request is a FOCUS entity (via the
// resolver's extractEntity + binding oracle). REFUSES at the open-world goal-generation seam
// rather than inventing a goal.
//
// Termination: MAX_TICKS caps the loop; each tick achieves exactly one intention (monotone
// progress), with one bounded GDA expansion allowed. Threat safety: every registry capability
// is read-only (empty delete-list), so no step can clobber another goal's precondition —
// derived from the registry, not assumed (threatsAmong). In GLOBAL mode (no bound focus),
// relevance is additionally screened by parsing the request through ask.mjs's own NL grammar,
// since the declared toolset alone doesn't prove the request is about this graph.

import { backwardChain, extractEntity } from "./resolver.mjs";
import { capabilityByName, effectsOf } from "./registry.mjs";
import { hallucinationsIn } from "./call-validator.mjs";
import { intersect } from "./set-algebra.mjs";
import { parseQuery } from "../ask.mjs";

// Hard outer-tick budget — the meta-loop runs at most this many ticks, then refuses.
export const MAX_TICKS = 16;

// ---- the DECLARED goal model (data, mirroring registry.mjs's STRIPS operators). Each rule:
//   focusClass  — the entity class a scoped reading binds its focus to.
//   modes       — "scoped" (bound focus) and/or "global" (whole-graph keystone arbitration).
//   subGoals    — epistemic facts to gather, in declared order (each backward-chains to a
//                 capability).
//   compose     — intersect(a, b) over two gathered topics, optionally focus-bound/unioned.
//   priorityTopic/coverageTopic — the global keystone arbitration keys.
//   achieves    — the meta-goal topic the composed answer achieves.
export const GOAL_RULES = Object.freeze([
  Object.freeze({
    id: "coverage-invariant",
    kind: "maintenance",
    invariant: "an impactful module must be tested",
    focusClass: "Module",
    modes: Object.freeze(["scoped", "global"]),
    subGoals: Object.freeze(["impact", "untested"]),
    priorityTopic: "impact",
    coverageTopic: "untested",
    compose: Object.freeze({
      op: "intersect",
      a: Object.freeze({ topic: "untested" }),
      b: Object.freeze({ topic: "impact", of: "focus", withFocus: true }),
      names: "the change's untested footprint",
      empty: "no coverage gap",
    }),
    achieves: "coverage-gap",
  }),
  Object.freeze({
    id: "cochange-risk-invariant",
    kind: "maintenance",
    invariant: "a module change-coupled with the focus must be tested",
    focusClass: "Module",
    modes: Object.freeze(["scoped"]),
    subGoals: Object.freeze(["cochanges", "untested"]),
    priorityTopic: "cochanges",
    coverageTopic: "untested",
    compose: Object.freeze({
      op: "intersect",
      a: Object.freeze({ topic: "cochanges", of: "focus" }),
      b: Object.freeze({ topic: "untested" }),
      names: "the change-coupled untested set",
      empty: "every change-coupled module is tested",
    }),
    achieves: "cochange-risk",
  }),
]);

/** Backward-chain a meta-goal topic to the declared goal-rule that achieves it. Pure. */
export function backwardChainGoal(topic) {
  return GOAL_RULES.find((r) => r.achieves === topic) || null;
}

/** A declared goal-rule APPLIES to a request iff (1) every sub-goal topic backward-chains
 *  to a capability in the declared toolset, (2) the deduced mode is one of the rule's
 *  declared modes, and (3) a scoped focus is of the rule's declared focusClass. The caller
 *  refuses on zero matches or more than one (ambiguous meta-goal). `ruleSet` defaults to
 *  GOAL_RULES; the synthesis-oracle test harness is the only caller that overrides it. */
export function applicableRules(declaredTools, focus, mode, ruleSet = GOAL_RULES) {
  const declared = Array.isArray(declaredTools) ? declaredTools : [];
  return ruleSet.filter((rule) =>
    rule.modes.includes(mode)
    && (mode !== "scoped" || (focus != null && focus.class === rule.focusClass))
    && rule.subGoals.every((topic) => {
      const cap = backwardChain(topic);
      return Boolean(cap && declared.includes(cap.name));
    }));
}

const refuse = (why, driver) => ({ calls: [], refused: true, terminated: true, proof: [], composed: null, driver, why });

/** Threats: whether a candidate step's DELETE-effects would clobber another pending
 *  intention. Computed from the registry's delete-lists (always [] today, since every
 *  capability is read-only) rather than assumed, so the guarantee holds if that changes. */
export function threatsAmong(candidateName, _pending) {
  const cap = capabilityByName(candidateName);
  const del = cap ? effectsOf(cap.name).del : [];
  return del.length ? [{ name: candidateName, deletes: del }] : [];
}

/** Resolve the FOCUS the request scopes the goal model to (entity binding, not a keyword).
 *  `match` is the bound individual or null (no focus => a global goal); `ambiguous` lets the
 *  caller distinguish "no focus" from "a focus term that tied" (never silently falls back
 *  to global on a tie). */
function focusOf(request, ctx) {
  const term = extractEntity(String(request || ""));
  if (!term || !ctx || !ctx.resolve) return { match: null, ambiguous: false, candidates: [] };
  const r = ctx.resolve(term);
  if (r && r.match && !r.ambiguous) return { match: r.match, ambiguous: false, candidates: [] };
  if (r && r.ambiguous) return { match: null, ambiguous: true, candidates: [r.match, ...(r.candidates || [])].filter(Boolean) };
  return { match: null, ambiguous: false, candidates: [] };
}

/** What entity CLASS (if any) did ask.mjs's NL grammar recognize in the request? Walks
 *  parseQuery's AST for its `entityType` field, unwrapping wrapper nodes (`clause`, `inner`,
 *  `base`). Returns null on a non-parse or an entity-less miss. */
function parsedEntityType(node) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.entityType === "string") return node.entityType;
  if (node.clause) return parsedEntityType(node.clause);
  if (node.inner) return parsedEntityType(node.inner);
  if (node.base) return parsedEntityType(node.base);
  return null;
}

/** Ground ONE epistemic sub-goal into an executed call, or null when not groundable in the
 *  declared toolset (=> the meta-loop escalates). Backward-chains topic->capability, binds
 *  the entity, self-checks the zero-hallucination gate, then dispatches. */
async function groundSubGoal(topic, entityLabel, tools, ctx) {
  const cap = backwardChain(topic);
  if (!cap || !tools.includes(cap.name)) return null; // no declared capability => escalate
  const param = cap.parameters.find((p) => p.required);
  if (param && !entityLabel) return null; // an entity topic with nothing to bind
  const input = param && entityLabel ? { [param.arg]: entityLabel } : {};
  const call = { name: cap.name, input };
  if (hallucinationsIn(call, tools).length) return null; // never emit an unprovable call
  const res = await ctx.dispatch(cap.name, input);
  if (!res || !res.ok) return null; // honest miss at dispatch => escalate
  return { call, result: Array.isArray(res.result) ? res.result : [] };
}

/** An intention persists until achieved or its goal lapses. Returns the reason string, or
 *  null to keep committing to it. Pure. */
export function dropCondition(intention, observed, mode, focus, focusClass) {
  if (observed.has(intention.key)) return "achieved";       // fact now gathered
  if (mode === "scoped" && (!focus || focus.class !== focusClass)) return "lapsed"; // focus moved
  return null;                                               // else keep the commitment
}

/** THE META-LOOP: deduce -> plan (C1) -> threat-aware arbitration -> execute -> observe ->
 *  repeat, hard-bounded. Returns a loopResult { calls, refused, terminated, proof, why,
 *  composed, driver } or an honest refuse.
 *
 *  ctx: { dispatch(name,input)->{ok,result}, resolve(term)->{match,ambiguous} }.
 *  `ruleSet` defaults to GOAL_RULES; only the synthesis-oracle test harness overrides it.
 *  `pinnedFocus` (internal) skips `focusOf` and scopes straight to the given individual —
 *  used to run this loop once per tied candidate on an ambiguous focus. */
export async function goalReason(request, tools, ctx, { driver = "goal-0.8.1", ruleSet = GOAL_RULES, pinnedFocus = null } = {}) {
  const declared = Array.isArray(tools) ? tools : [];

  const focusRes = pinnedFocus ? { match: pinnedFocus, ambiguous: false, candidates: [] } : focusOf(request, ctx);
  const focus = focusRes.match;

  // An ambiguous focus must never silently collapse to "global". When the tied candidates
  // share one class a goal-rule scopes, additionally run this loop once per candidate.
  if (!pinnedFocus && focusRes.ambiguous) {
    const term = extractEntity(String(request || ""));
    const pool = focusRes.candidates.slice(0, 4);
    const why2 = `open-world: focus "${term}" is ambiguous (${pool.map((c) => c.label).join(", ")}) — narrow it`;
    const scopable = pool.length > 0 && pool.every((c) => c.class === pool[0].class) && ruleSet.some((r) => r.focusClass === pool[0].class);
    if (!scopable || !ctx.dispatch) return refuse(why2, driver);
    const candidateResults = [];
    for (const c of pool) candidateResults.push({ candidate: c.label, result: await goalReason(request, tools, ctx, { driver, ruleSet, pinnedFocus: c }) });
    return { ...refuse(why2, driver), candidateResults };
  }
  const mode = focus ? "scoped" : "global";

  // A resolved focus whose class no declared goal-rule scopes is refused, never invented.
  if (focus && !ruleSet.some((r) => r.focusClass === focus.class)) {
    const covered = [...new Set(ruleSet.map((r) => r.focusClass))].join("/");
    return refuse(`open-world: no declared goal-rule covers a ${focus.class} focus (the declared goal-rules are ${covered}-scoped) — escalate`, driver);
  }

  const applicable = applicableRules(declared, focus, mode, ruleSet);

  // GLOBAL mode has no bound focus to prove relevance, so also screen the request against
  // ask.mjs's NL grammar: it must parse to a shape naming the candidate rule's focusClass.
  // The refusal reads as plain language — it is user-facing chat text (/plan renders the
  // why verbatim), so it names what the planner CAN plan about, never the grammar machinery
  // that decided it.
  let domainRelevant = applicable;
  if (mode === "global" && applicable.length) {
    const requestClass = parsedEntityType(parseQuery(request));
    domainRelevant = applicable.filter((r) => requestClass === r.focusClass);
    if (!domainRelevant.length) {
      const classes = [...new Set(applicable.map((r) => r.focusClass))];
      const plain = classes.map((c) => `${String(c).toLowerCase()}s`).join(" or ");
      return refuse(`open-world: I can only plan toward goals about things this graph knows (${plain} here), and this request doesn't read as being about ${plain} — I won't invent a goal for it — escalate`, driver);
    }
  }

  if (!domainRelevant.length) {
    return refuse(`open-world: no declared goal-rule is applicable in ${mode} mode (each needs a sub-goal capability outside the declared toolset, or a scope it does not declare) — escalate`, driver);
  }
  if (domainRelevant.length > 1) {
    return refuse(`ambiguous meta-goal: ${domainRelevant.length} declared goal-rules apply (${domainRelevant.map((r) => r.id).join(", ")}) — meta-goal arbitration is undeclared, refuse rather than guess — escalate`, driver);
  }
  const rule = domainRelevant[0];

  const why = [
    `goal-deduction: backward-chain (achieves ${rule.achieves}) => goal-rule "${rule.id}" (${rule.invariant})`,
    `mode: ${mode}${focus ? ` (focus ${focus.label} [${focus.class}])` : " (whole-graph / keystone arbitration)"}`,
    "threat-check: read-only registry => every capability delete-list empty => meta-level POP threats provably none",
  ];
  const proof = [{ step: "goal-rule", rule: rule.id, achieves: rule.achieves, ok: true }];
  const calls = [];
  const observed = new Map();     // intention.key -> gathered result set

  // The pending intentions: the rule's sub-goals in declared order. In global mode,
  // entity-scoped topics are deferred to the GDA expansion (no focus to bind yet).
  const bindsEntity = (topic) => {
    const cap = backwardChain(topic);
    return Boolean(cap && cap.parameters.some((p) => p.required));
  };
  const pending = rule.subGoals
    .filter((topic) => mode === "scoped" || !bindsEntity(topic))
    .map((topic, i) => (mode === "scoped" && bindsEntity(topic)
      ? { topic, of: focus.label, key: `${topic}:${focus.label}`, order: i }
      : { topic, of: null, key: topic, order: i }));

  let committed = null;   // the persisted BDI intention (not re-derived each tick)
  let expanded = false;   // one-shot guard: the single bounded GDA expansion
  let ticks = 0;

  while (pending.length) {
    if (ticks >= MAX_TICKS) return refuse(`meta-loop tick budget exhausted (${MAX_TICKS}) — escalate`, driver);
    ticks += 1;

    // Keep the committed intention unless a drop condition fires; only then re-arbitrate.
    if (committed && dropCondition(committed, observed, mode, focus, rule.focusClass)) committed = null;
    if (!committed || !pending.includes(committed)) {
      // Least-commitment: lowest declared order among pending, skipping threatened steps.
      const admissible = pending.filter((i) => threatsAmong(backwardChain(i.topic)?.name, pending).length === 0);
      if (!admissible.length) return refuse("all first steps are threatened (would clobber a live goal) — escalate", driver);
      committed = admissible.slice().sort((a, b) => a.order - b.order)[0];
    }

    const grounded = await groundSubGoal(committed.topic, committed.of, declared, ctx);
    if (!grounded) return refuse(`sub-goal (knows ${committed.topic}${committed.of ? ` ${committed.of}` : ""}) not groundable in the declared toolset — escalate`, driver);
    calls.push(grounded.call);
    observed.set(committed.key, grounded.result);
    proof.push({ step: "causal-link", producer: "graph", condition: committed.of ?? committed.topic, consumer: `${committed.topic}:${grounded.call.name}`, ok: true });

    // This tick achieved exactly one intention: drop it (monotone progress).
    const before = pending.length;
    const achievedTopic = committed.topic;
    pending.splice(pending.indexOf(committed), 1);
    committed = null;

    // GDA expansion, once: on observing the coverage set in global mode, expand to the
    // priority sub-goal for each violating module so arbitration can rank them.
    let expandedThisTick = false;
    if (mode === "global" && rule.modes.includes("global") && achievedTopic === rule.coverageTopic && !expanded) {
      expanded = true;
      expandedThisTick = true;
      const violating = observed.get(rule.coverageTopic) || [];
      violating.forEach((m, i) => pending.push({ topic: rule.priorityTopic, of: m, key: `${rule.priorityTopic}:${m}`, order: 100 + i }));
    }

    // Anything other than shrink-by-one or the one-shot expansion is non-progress: halt.
    if (pending.length > before - 1 && !expandedThisTick) {
      return refuse("meta-loop made no monotone progress — halting", driver);
    }
  }

  // Compose the answer: intersect two gathered sides (scoped), or keystone-arbitrate (global).
  let composed;
  if (mode === "scoped") {
    const sideSet = (side) => {
      const key = side.of === "focus" ? `${side.topic}:${focus.label}` : side.topic;
      const set = observed.get(key) || [];
      return side.withFocus ? [focus.label, ...set] : set;
    };
    const sideDesc = (side) => (side.withFocus
      ? `({${focus.label}} ∪ ${side.topic})`
      : side.of === "focus" ? `${side.topic}(${focus.label})` : side.topic);
    const spec = rule.compose;
    composed = intersect(sideSet(spec.a), sideSet(spec.b));
    why.push(`compose: ${sideDesc(spec.a)} ∩ ${sideDesc(spec.b)} = ${spec.names} (${composed.length ? composed.join(", ") : `∅ — ${spec.empty}`})`);
  } else {
    // Keystone: among the coverage violations, pick the highest priority, tie by label.
    const violating = observed.get(rule.coverageTopic) || [];
    const ranked = violating
      .map((m) => ({ m, weight: (observed.get(`${rule.priorityTopic}:${m}`) || []).length }))
      .sort((a, b) => b.weight - a.weight || String(a.m).localeCompare(String(b.m)));
    composed = ranked.length ? [ranked[0].m] : [];
    why.push(`keystone: argmax |${rule.priorityTopic}| over ${violating.length} ${rule.coverageTopic} module(s) => ${composed.length ? `${composed[0]} (weight ${ranked[0].weight})` : "∅"}`);
  }

  return { calls, refused: false, terminated: true, proof, why, composed, driver, observed: `goal(${mode}): ${calls.map((c) => c.name).join(" -> ")}` };
}
