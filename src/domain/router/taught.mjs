// taught.mjs — bridge taught action-Rule families into the capability registry.
//
// A taught game action ("you can move a disk onto a peg" + its preconditions
// and effect) becomes a registered capability record so the router's operator
// model covers taught actions and built-in query tools alike. Registered
// records carry readOnly: false, so the guardrail never dispatches them — the
// resolver also never selects them on its own, because it backward-chains over
// `knows` add-effects and these records carry world-triple effects instead.

import { capabilityByName, registerCapability } from "./registry.mjs";

const ACTION_KINDS = new Set(["action-signature", "action-precond", "action-effect", "action-constraint"]);

/** Group already-read rule rows (memory/core.mjs's readRuleRows output — the
 *  caller reads the store; this bridge never does) into action families by
 *  rule name. */
export function actionFamilies(ruleRows) {
  const families = new Map();
  for (const row of ruleRows || []) {
    if (!ACTION_KINDS.has(row.kind)) continue;
    if (!families.has(row.name)) families.set(row.name, []);
    families.get(row.name).push(row);
  }
  return families;
}

/** Map one action family to a registrable capability record. */
export function capabilityFromActionRules(name, family) {
  const signatures = family.filter((r) => r.kind === "action-signature");
  const preconds = family.filter((r) => r.kind === "action-precond");
  const effects = family.filter((r) => r.kind === "action-effect");
  const constraints = family.filter((r) => r.kind === "action-constraint");
  return {
    name: `taught:${name}`,
    label: name,
    question: `apply the taught action "${name}" to the world state`,
    readOnly: false,
    parameters: [
      { name: "subject", classes: [...new Set(signatures.map((s) => s.slots.subjectClass))].sort() },
      { name: "target", classes: [...new Set(signatures.map((s) => s.slots.targetClass))].sort() },
    ],
    preconditions: [
      ...preconds.map((p) => ({
        pred: "taught:world-precond",
        shape: p.slots.shape,
        predicate: p.slots.predicate,
        role: p.slots.role,
        scope: p.slots.scope,
      })),
      // A constraint is a precondition on the SUCCESSOR state; it rides the
      // record's precondition list so a bridged family stays complete.
      ...constraints.map((c) => ({
        pred: "taught:world-constraint",
        left: c.slots.left,
        right: c.slots.right,
        guard: c.slots.guard,
      })),
    ],
    effects: {
      add: effects.map((e) => ({
        pred: "taught:world-effect",
        predicate: e.slots.predicate,
        subjectRole: e.slots.subjectRole,
        objectRole: e.slots.objectRole,
      })),
      del: effects.map((e) => ({
        pred: "taught:world-effect-replaced",
        predicate: e.slots.predicate,
        subjectRole: e.slots.subjectRole,
      })),
    },
  };
}

/** Register every taught action family found in the given rule rows,
 *  idempotently (a name that is already registered is skipped). Returns the
 *  new registrations' unregister disposers. */
export function registerTaughtActions(ruleRows) {
  const disposers = [];
  for (const [name, family] of actionFamilies(ruleRows)) {
    if (capabilityByName(`taught:${name}`)) continue;
    disposers.push(registerCapability(capabilityFromActionRules(name, family)));
  }
  return disposers;
}
