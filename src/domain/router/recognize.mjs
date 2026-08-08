// domain/router/recognize.mjs — reading an observed trace of steps back from
// whatever recorded it: an executed tool-call list, the @turnN rows a played
// world writes, or the @stepN rows a plan-lane board writes. Also enumerates
// the declared goals a trace can be checked against, gathered from GOAL_RULES,
// the capability registry, a world pack's own markers, and taught action
// families. Pure and read-only — nothing here writes a fact or calls a tool,
// so a recognition can never change what it is recognizing.

import { parseSnapshotSubject } from "../world-snapshot.mjs";
import { parseStepSubject } from "../domain.mjs";
import { backwardChain } from "./resolver.mjs";
import { GOAL_RULES } from "./goal-reasoner.mjs";
import { capabilities, effectsOf } from "./registry.mjs";
import { actionFamilies } from "./taught.mjs";

/** The default trace cap: enough steps for a multi-hop drill-down without
 *  letting a long session make recognition unbounded. The `[recognition]
 *  max_trace` tmct.toml knob overrides it per repo. */
export const MAX_TRACE = 32;

/** Fold a normalized tmct.toml's sparse `[recognition]` table over the shipped
 *  default, exactly as resolveDiscourseConfig folds `[discourse]`. */
export function resolveRecognitionConfig(toml) {
  const raw = toml?.recognition?.max_trace;
  const maxTrace = Number.isInteger(raw) && raw > 0 ? raw : MAX_TRACE;
  return { maxTrace };
}

/** One observed step. `op` is the declared operator the step exercised — a
 *  capability name for a tool trace, an effect predicate for a world trace. */
// { k: number, actor: string, op: string, args: object, kind: "capability" | "world-effect" }

const codepointCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const validTraceCap = (maxTrace) => Number.isInteger(maxTrace) && maxTrace > 0;

/** Keep only the newest `maxTrace` entries of an oldest-first list — the
 *  oldest steps drop first when a trace overruns the cap. */
const capToNewest = (items, maxTrace) => (items.length > maxTrace ? items.slice(items.length - maxTrace) : items);

/** An executed call list — runCapabilityPlan's `calls`, or a served
 *  transcript's tool_use blocks — as an ordered step list. */
export function traceOfCalls(calls, { maxTrace = MAX_TRACE, actor = "caller" } = {}) {
  if (!validTraceCap(maxTrace)) return [];
  if (!Array.isArray(calls) || !calls.length) return [];
  const capped = capToNewest(calls, maxTrace);
  return capped.map((call, i) => ({
    k: i + 1,
    actor,
    op: call?.name,
    args: call?.input || {},
    kind: "capability",
  }));
}

/** @turnN world rows (adventure and NPC passes) as an ordered step list, one
 *  step per snapshot row, oldest first, deduplicated by (turn, subject,
 *  predicate). Rows for the current epoch only. */
export function traceOfWorldRows(rows, { maxTrace = MAX_TRACE, actor = "player" } = {}) {
  if (!validTraceCap(maxTrace)) return [];
  if (!Array.isArray(rows) || !rows.length) return [];
  const stamped = [];
  for (const row of rows) {
    const snap = parseSnapshotSubject(row?.subject);
    if (snap) stamped.push({ snap, row });
  }
  if (!stamped.length) return [];
  let epoch = 0;
  for (const { snap } of stamped) if (snap.epoch > epoch) epoch = snap.epoch;
  const current = stamped.filter(({ snap }) => snap.epoch === epoch);
  current.sort((a, b) =>
    codepointCompare(a.snap.turn, b.snap.turn) ||
    codepointCompare(a.snap.base, b.snap.base) ||
    codepointCompare(a.row.predicate, b.row.predicate) ||
    codepointCompare(a.row.object, b.row.object));
  const seen = new Set();
  const deduped = [];
  for (const { snap, row } of current) {
    const key = `${snap.turn}\u001f${snap.base}\u001f${row.predicate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  const capped = capToNewest(deduped, maxTrace);
  return capped.map((row, i) => ({
    k: i + 1,
    actor,
    op: row.predicate,
    args: { object: row.object },
    kind: "world-effect",
  }));
}

/** @stepN board rows (the plan lane's snapshots) as an ordered step list. */
export function traceOfBoardRows(rows, { maxTrace = MAX_TRACE, actor = "planner" } = {}) {
  if (!validTraceCap(maxTrace)) return [];
  if (!Array.isArray(rows) || !rows.length) return [];
  const stamped = [];
  for (const row of rows) {
    const snap = parseStepSubject(row?.subject);
    if (snap) stamped.push({ snap, row });
  }
  if (!stamped.length) return [];
  stamped.sort((a, b) =>
    codepointCompare(a.snap.step, b.snap.step) ||
    codepointCompare(a.snap.base, b.snap.base) ||
    codepointCompare(a.row.predicate, b.row.predicate) ||
    codepointCompare(a.row.object, b.row.object));
  const seen = new Set();
  const deduped = [];
  for (const { snap, row } of stamped) {
    const key = `${snap.step}\u001f${snap.base}\u001f${row.predicate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  const capped = capToNewest(deduped, maxTrace);
  return capped.map((row, i) => ({
    k: i + 1,
    actor,
    op: row.predicate,
    args: { object: row.object },
    kind: "world-effect",
  }));
}

/** One declared goal. `plans` holds every admissible operator sequence; a goal
 *  whose plans need a world state to search from ships `plans: []` and a
 *  `goalState` instead. */
// {
//   id:        "goal:coverage-gap",
//   source:    "goal-rules" | "capability" | "world" | "taught",
//   label:     "an impactful module must be tested",
//   plans:     [["tmct_impact", "tmct_untested"]],
//   goalState: null,
//   provenance: "GOAL_RULES coverage-invariant — an impactful module must be tested",
// }

/** A goal SURVIVES a declared toolset when every operator in every one of its
 *  plans is in that toolset — a goal with no plans of its own (world/taught)
 *  survives any toolset. `tools === null` means no screen at all. */
function fitsToolset(plans, tools) {
  if (!Array.isArray(tools)) return true;
  if (!plans.length) return true;
  return plans.every((plan) => plan.every((op) => tools.includes(op)));
}

/** Every goal `GOAL_RULES` deduces, one per rule whose sub-goals all
 *  backward-chain to a declared capability. A sub-goal that backward-chains
 *  to nothing drops the whole goal — it is not achievable in this registry. */
function goalsFromRules() {
  const goals = [];
  for (const rule of GOAL_RULES) {
    const plan = rule.subGoals.map((topic) => backwardChain(topic)?.name);
    if (plan.some((name) => !name)) continue;
    goals.push({
      id: `goal:${rule.achieves}`,
      source: "goal-rules",
      label: rule.invariant,
      plans: [plan],
      goalState: null,
      provenance: `GOAL_RULES ${rule.id} — ${rule.invariant}`,
    });
  }
  return goals;
}

/** Every goal the capability registry declares, one per capability whose
 *  add-list carries a `cap:knows` effect. */
function goalsFromCapabilities() {
  const goals = [];
  for (const cap of capabilities()) {
    for (const effect of effectsOf(cap.name).add) {
      if (effect.pred !== "cap:knows") continue;
      goals.push({
        id: `cap:${effect.topic}`,
        source: "capability",
        label: cap.question,
        plans: [[cap.name]],
        goalState: null,
        provenance: `capability ${cap.name} — add-effect knows(${effect.topic})`,
      });
    }
  }
  return goals;
}

/** Every goal a world pack's own objective markers declare. `mgx:is-objective`
 *  generalises to a family: carrying the marked subject is the win condition
 *  the adventure surface already checks, so the goal state names that. */
function goalsFromWorldRows(worldRows) {
  const goals = [];
  for (const row of worldRows || []) {
    if (row?.predicate !== "mgx:is-objective" || row?.object !== "true") continue;
    goals.push({
      id: `world:carry-${row.subject}`,
      source: "world",
      label: `carry the ${row.subject}`,
      plans: [],
      goalState: { subject: row.subject, predicate: "located-in", object: "player" },
      provenance: `world marker mgx:is-objective on ${row.subject}`,
    });
  }
  return goals;
}

/** Every goal a taught action family declares. No goal-rule kind exists for a
 *  taught domain today, so a family's own effect predicate holding IS its
 *  goal state — read in the opposite direction from how backwardChainWorld
 *  reads it. Two families sharing an effect predicate contribute one goal,
 *  their provenance joined. */
function goalsFromTaughtActions(ruleRows) {
  const byId = new Map();
  for (const [familyName, family] of actionFamilies(ruleRows || [])) {
    for (const row of family) {
      if (row.kind !== "action-effect") continue;
      const predicate = row.slots?.predicate;
      if (!predicate) continue;
      const id = `taught:${predicate}`;
      const contribution = `taught action ${familyName} — effect ${predicate}`;
      const existing = byId.get(id);
      if (existing) { existing.provenance += `; ${contribution}`; continue; }
      byId.set(id, {
        id,
        source: "taught",
        label: `reach a state where something ${predicate}s`,
        plans: [],
        goalState: { predicate },
        provenance: contribution,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Every goal the loaded declarations amount to, gathered and never invented.
 * `ctx.worldRows` (optional) supplies the world shard's marker facts;
 * `ctx.ruleRows` (optional) supplies the taught action families. `opts.tools`
 * restricts the set to goals every step of whose plans is in the declared
 * toolset, the same screen `applicableRules` applies. Pure; sorted by id.
 */
export function declaredGoals(ctx = {}, { tools = null } = {}) {
  const all = [
    ...goalsFromRules(),
    ...goalsFromCapabilities(),
    ...goalsFromWorldRows(ctx.worldRows),
    ...goalsFromTaughtActions(ctx.ruleRows),
  ];
  return all
    .filter((g) => fitsToolset(g.plans, tools))
    .sort((a, b) => codepointCompare(a.id, b.id));
}

/** A trace FITS a plan when its operators are a subsequence of the plan's, in
 *  an order the plan admits. Exact and deterministic: two pointers, no score. */
export function fitsPlan(trace, plan) {
  let i = 0;
  for (const step of trace) {
    while (i < plan.length && plan[i] !== step.op) i += 1;
    if (i >= plan.length) return false;
    i += 1;
  }
  return true;
}

/** The topic a capability's own `cap:knows` add-effect names, or the operator
 *  itself when it declares none (a world/taught effect predicate has no
 *  registry entry to look one up in). */
function operatorTopic(op) {
  for (const effect of effectsOf(op)?.add ?? []) {
    if (effect.pred === "cap:knows" && effect.topic) return effect.topic;
  }
  return op;
}

/** The recognition proof: one `goal-fit` receipt naming the fitting plan, then
 *  one `causal-link` per observed step, chained from the graph. A step's own
 *  bound argument is the condition it names; a step that took none names the
 *  topic its producer supplied instead — the same "what threaded in" reading
 *  `drive.mjs`'s own causal-link proofs use. */
function buildProof(trace, goal, plan) {
  const proof = [{ step: "goal-fit", goal: goal.id, plan, ok: true }];
  for (let k = 1; k <= trace.length; k += 1) {
    const step = trace[k - 1];
    const producer = k === 1 ? "graph" : `step-${k - 1}`;
    const producerOp = k === 1 ? step.op : trace[k - 2].op;
    const values = Object.values(step.args || {});
    const condition = values.length ? String(values[0]) : operatorTopic(producerOp);
    proof.push({ step: "causal-link", producer, condition, consumer: `step-${k}:${step.op}`, role: "recognition", ok: true });
  }
  return proof;
}

/**
 * Which declared goal an observed trace fits. Exactly three outcomes, never a
 * fourth:
 *   - one goal survives  → { goal, reject: false, ambiguous: null, proof, why }
 *   - two or more        → { goal: null, reject: false, ambiguous: [...], proof: [], why }
 *   - none                → { goal: null, reject: true,  ambiguous: null, proof: [], why }
 * An empty trace rejects, naming that nothing was observed — it does not fit
 * every goal vacuously.
 *
 * `expand(goal)` (optional) returns the admissible plans for a goal that ships
 * none of its own (a world or taught goal, whose plans need a state to search
 * from). A goal with no plans and no expand hook is excluded, not guessed at.
 */
export function recognizeGoal(trace, goals, { expand = null } = {}) {
  if (!Array.isArray(trace) || !trace.length) {
    return { goal: null, reject: true, ambiguous: null, proof: [], why: "no steps observed yet — there is nothing to recognize" };
  }
  const declared = Array.isArray(goals) ? goals : [];
  const fits = [];
  for (const goal of declared) {
    let plans = Array.isArray(goal.plans) && goal.plans.length ? goal.plans : null;
    if (!plans) {
      if (typeof expand !== "function") continue; // no plan to test against — excluded, not guessed at
      const expanded = expand(goal);
      plans = Array.isArray(expanded) && expanded.length ? expanded : null;
      if (!plans) continue;
    }
    const fittingPlan = plans.find((plan) => fitsPlan(trace, plan));
    if (fittingPlan) fits.push({ goal, plan: fittingPlan });
  }

  if (fits.length === 1) {
    const { goal, plan } = fits[0];
    return {
      goal, reject: false, ambiguous: null,
      proof: buildProof(trace, goal, plan),
      why: `the trace fits ${goal.id} (${goal.label}) — ${trace.length} observed step(s) are a subsequence of ${plan.join(" -> ")}`,
    };
  }
  if (fits.length > 1) {
    const survivors = fits.map((f) => f.goal);
    const ids = survivors.map((g) => g.id);
    return {
      goal: null, reject: false, ambiguous: survivors, proof: [],
      why: `the trace fits ${survivors.length} declared goals (${ids.join(", ")}) — a longer trace narrows it, so I won't pick one`,
    };
  }
  return {
    goal: null, reject: true, ambiguous: null, proof: [],
    why: `the trace fits none of the ${declared.length} declared goals — it is off the declared model, which is a reject, not a nearest fit`,
  };
}
