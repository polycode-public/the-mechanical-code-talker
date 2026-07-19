// domain.mjs — the generic taught-action interpreter.
//
// Pure functions from taught rows to planner inputs: no I/O, and no knowledge
// of any particular game — every class, individual, predicate, and action
// arrives as data from the memory store's fact/Rule rows. Plugs into
// planning.mjs's findActionPath as its applyActions.

const MEMBER_EDGE_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);
const SNAPSHOT_RE = /^(.+)@step(\d+)$/;

/** Trim a taught term defensively: some teach frames keep a sentence's
 *  trailing punctuation in the captured object. */
const normTerm = (value) => String(value ?? "").trim().replace(/[.!?]+$/, "");

/** Predicates in Rule slots are stored bare (normFactTerm strips prefixes);
 *  fact rows carry the prefixed form. */
const attachPrefix = (predicate) => {
  const p = normTerm(predicate);
  return p.includes(":") ? p : `mgx:${p}`;
};

/** A genuinely-supplied optional slot (a literal precond/effect value): `""`,
 *  `null` and `undefined` all read as "not supplied", the same signal a
 *  never-taught slot and a readRuleRows-defaulted `""` both give. */
const optionalTerm = (value) => {
  if (value == null) return undefined;
  const t = normTerm(value);
  return t === "" ? undefined : t;
};

const rowSort = (a, b) =>
  a.subject.localeCompare(b.subject) ||
  a.predicate.localeCompare(b.predicate) ||
  a.object.localeCompare(b.object);

const normRow = (row) => ({
  subject: normTerm(row.subject),
  predicate: normTerm(row.predicate),
  object: normTerm(row.object),
});

export class PlanBudgetError extends Error {
  constructor(groundings, budget) {
    super(`action grounding count ${groundings} exceeds the budget of ${budget}`);
    this.name = "PlanBudgetError";
    this.groundings = groundings;
    this.budget = budget;
  }
}

/** Compile fact + Rule rows into a planning domain:
 *  { actions, classMembers, dynamicPredicates, ordering }. */
export function compileDomain(factRows, ruleRows) {
  const byName = new Map();
  for (const rule of ruleRows || []) {
    if (!String(rule.kind || "").startsWith("action-")) continue;
    const name = normTerm(rule.name);
    if (!byName.has(name)) byName.set(name, { name, signatures: [], preconds: [], effects: [], constraints: [] });
    const family = byName.get(name);
    const slots = rule.slots || {};
    if (rule.kind === "action-signature") {
      family.signatures.push({
        subjectClass: normTerm(slots.subjectClass),
        targetClass: normTerm(slots.targetClass),
      });
    } else if (rule.kind === "action-precond") {
      // value/negate are optional: absent in every no-incoming/comparator row
      // taught so far, so their key is omitted rather than written as "" —
      // an omitted key keeps a pre-existing precond's JSON.stringify sort
      // form (and its precondHolds behavior) byte-identical to before this
      // shape existed. normFactTerm/readRuleRows read a genuinely absent
      // slot back as "", the same signal an explicit "" would give.
      const value = optionalTerm(slots.value);
      const negate = String(slots.negate) === "true" ? true : undefined;
      family.preconds.push({
        shape: normTerm(slots.shape),
        predicate: attachPrefix(slots.predicate),
        role: normTerm(slots.role),
        scope: normTerm(slots.scope),
        ...(value !== undefined ? { value } : {}),
        ...(negate !== undefined ? { negate } : {}),
      });
    } else if (rule.kind === "action-effect") {
      // value is the literal-effect alternative to objectRole (a datatype
      // write, e.g. mgx:is-open = "true", rather than a role binding) — same
      // omit-when-absent discipline as the precond fields above.
      const value = optionalTerm(slots.value);
      family.effects.push({
        predicate: attachPrefix(slots.predicate),
        subjectRole: normTerm(slots.subjectRole),
        objectRole: normTerm(slots.objectRole),
        ...(value !== undefined ? { value } : {}),
      });
    } else if (rule.kind === "action-constraint") {
      family.constraints.push({
        left: normTerm(slots.left),
        right: normTerm(slots.right),
        guard: normTerm(slots.guard),
      });
    }
  }
  const actions = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const action of actions) {
    action.signatures.sort((a, b) =>
      a.subjectClass.localeCompare(b.subjectClass) || a.targetClass.localeCompare(b.targetClass));
    action.preconds.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    action.effects.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    action.constraints.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  // Class membership from typing edges. A member is a subject with a typing
  // edge into the class and no typing edge pointing at itself (a leaf).
  const edges = (factRows || []).map(normRow).filter((r) => MEMBER_EDGE_PREDICATES.has(r.predicate));
  const hasIncoming = new Set(edges.map((r) => r.object));
  const classMembers = {};
  for (const edge of edges) {
    if (hasIncoming.has(edge.subject)) continue;
    (classMembers[edge.object] ??= []).push(edge.subject);
  }
  for (const members of Object.values(classMembers)) {
    members.sort();
    // de-dup while keeping order
    for (let i = members.length - 1; i > 0; i -= 1) if (members[i] === members[i - 1]) members.splice(i, 1);
  }

  // A class-bound word (an effect role or constraint term that is neither
  // "subject" nor "target") is substituted by its class's sole member at
  // grounding time. With 0 or 2+ members that substitution would be a silent
  // guess, so an ill-bound family fails loudly here instead.
  const requireSoleMember = (word, where) => {
    const count = (classMembers[word] || []).length;
    if (count !== 1) {
      throw new Error(`${where} names "${word}", which must be a class with exactly one member (it has ${count})`);
    }
  };
  for (const action of actions) {
    for (const effect of action.effects) {
      // A literal-valued effect (effect.value set) has no objectRole to bind
      // — the literal IS the object, so objectRole (unused, "" when the
      // teaching row never set it) never enters the class-membership check.
      const roles = effect.value !== undefined ? [effect.subjectRole] : [effect.subjectRole, effect.objectRole];
      for (const role of roles) {
        if (role !== "subject" && role !== "target") requireSoleMember(role, `an effect role of "${action.name}"`);
      }
    }
    for (const constraint of action.constraints) {
      for (const word of [constraint.left, constraint.right, constraint.guard]) {
        requireSoleMember(word, `a constraint term of "${action.name}"`);
      }
    }
  }

  const dynamicPredicates = new Set();
  for (const action of actions) for (const effect of action.effects) dynamicPredicates.add(effect.predicate);

  const ordering = (factRows || [])
    .map(normRow)
    .filter((r) => !dynamicPredicates.has(r.predicate) && !MEMBER_EDGE_PREDICATES.has(r.predicate))
    .sort(rowSort);

  return { actions, classMembers, dynamicPredicates, ordering };
}

const domainIndividuals = (domain) => {
  const out = new Set();
  for (const action of domain.actions) {
    for (const sig of action.signatures) {
      for (const m of domain.classMembers[sig.subjectClass] || []) out.add(m);
      for (const m of domain.classMembers[sig.targetClass] || []) out.add(m);
    }
  }
  return out;
};

/** The current state as canonical sorted rows over the domain's dynamic
 *  predicates. Prefers the newest @stepN snapshot when one exists, so a
 *  re-plan after per-step execution never reads the stale step-0 board. */
export function stateFromFacts(factRows, domain) {
  const individuals = domainIndividuals(domain);
  const subjectClasses = new Set();
  for (const action of domain.actions) for (const sig of action.signatures) subjectClasses.add(sig.subjectClass);
  const subjects = new Set();
  for (const cls of subjectClasses) for (const m of domain.classMembers[cls] || []) subjects.add(m);

  const rows = (factRows || []).map(normRow).filter((r) => domain.dynamicPredicates.has(r.predicate));
  let maxStep = -1;
  for (const row of rows) {
    const m = SNAPSHOT_RE.exec(row.subject);
    if (m && individuals.has(m[1])) maxStep = Math.max(maxStep, Number(m[2]));
  }
  const state = [];
  for (const row of rows) {
    const m = SNAPSHOT_RE.exec(row.subject);
    if (maxStep >= 0) {
      if (!m || Number(m[2]) !== maxStep) continue;
      const base = m[1];
      if (subjects.has(base)) state.push({ subject: base, predicate: row.predicate, object: normTerm(row.object.replace(SNAPSHOT_RE, "$1")) });
    } else if (!m && subjects.has(row.subject)) {
      state.push(row);
    }
  }
  state.sort(rowSort);
  return state;
}

/** Canonical identity for a state (rows are kept sorted). NUL-joined so
 *  multi-word terms can never collide with the separator; spelled without an
 *  escape sequence because tooling has twice turned a source-level \\0 into a
 *  literal NUL byte in this repo. */
const SEP = String.fromCharCode(0);
export function stateKeyFor(state) {
  return state.map((r) => [r.subject, r.predicate, r.object].join(SEP)).join("\n");
}

const precondApplies = (precond, target, domain) =>
  precond.scope === "any" || (domain.classMembers[precond.scope] || []).includes(target);

/** A precondition on a fact ABOUT the role term itself (roleTerm as subject),
 *  as opposed to "no-incoming"'s fact pointing AT the role term (roleTerm as
 *  object). Datatype/state checks — a lock, an open/closed flag — read this
 *  way: "does (roleTerm, predicate, value) exist", with `value` an existence
 *  wildcard when omitted and `negate` flipping the sense ("must NOT exist"
 *  covers "must not be locked", "must not already be open"). */
export function precondHolds(precond, subject, target, state, domain) {
  const roleTerm = precond.role === "target" ? target : subject;
  if (precond.shape === "no-incoming") {
    return !state.some((r) => r.predicate === precond.predicate && r.object === roleTerm);
  }
  if (precond.shape === "comparator") {
    const left = roleTerm;
    const right = precond.role === "target" ? subject : target;
    return domain.ordering.some((r) =>
      r.subject === left && r.predicate === precond.predicate && r.object === right);
  }
  if (precond.shape === "fact-value") {
    const exists = state.some((r) => r.subject === roleTerm && r.predicate === precond.predicate
      && (precond.value == null || r.object === precond.value));
    return precond.negate ? !exists : exists;
  }
  return false;
}

/** Ground an effect/constraint role word: "subject"/"target" bind the
 *  grounding pair; any other word is class-bound and binds the class's sole
 *  member — its companion semantics (compileDomain guarantees exactly one).
 *  Exported so a caller consulting one grounded precond/effect directly,
 *  rather than running a full movesFromRules search, can still resolve an
 *  effect's subject/object the same way the planner does. */
export const roleBinding = (role, subject, target, domain) => {
  if (role === "subject") return subject;
  if (role === "target") return target;
  return (domain.classMembers[role] || [])[0];
};

const positionIn = (rows, term, predicate) =>
  rows.find((r) => r.subject === term && r.predicate === predicate)?.object;

export function applyEffects(effects, subject, target, state, domain) {
  let rows = state;
  let changed = false;
  for (const effect of effects) {
    const effSubject = roleBinding(effect.subjectRole, subject, target, domain);
    // A literal-valued effect (a taught datatype flag) writes its value
    // directly; a role-valued effect resolves objectRole through the
    // grounding pair / class-bound member instead.
    const effObject = effect.value !== undefined ? effect.value : roleBinding(effect.objectRole, subject, target, domain);
    const already = rows.some((r) =>
      r.subject === effSubject && r.predicate === effect.predicate && r.object === effObject);
    if (already) continue;
    rows = rows.filter((r) => !(r.subject === effSubject && r.predicate === effect.predicate));
    rows = [...rows, { subject: effSubject, predicate: effect.predicate, object: effObject }];
    changed = true;
  }
  if (!changed) return null;
  return [...rows].sort(rowSort);
}

/** True when `state` still permits every companion (class-bound effect
 *  subject) to move WITH the grounded subject. Co-location is a derived
 *  precondition, not a taught one: the taught effect says the companion ends
 *  up at the target, and applying that from a state where the companion
 *  stands elsewhere would teleport it instead of carrying it. Trivially true
 *  when the subject is its own companion. */
function companionsCoLocated(action, subject, target, state, domain) {
  for (const effect of action.effects) {
    if (effect.subjectRole === "subject" || effect.subjectRole === "target") continue;
    const companion = roleBinding(effect.subjectRole, subject, target, domain);
    if (companion === subject) continue;
    const subjectAt = positionIn(state, subject, effect.predicate);
    if (!subjectAt || positionIn(state, companion, effect.predicate) !== subjectAt) return false;
  }
  return true;
}

/** True when a successor state breaks one of the action's constraints: the
 *  left and right members sharing a position under one of the action's
 *  effect predicates while the guard member stands elsewhere. */
function constraintViolated(action, nextState, domain) {
  if (!action.constraints.length) return false;
  const predicates = [...new Set(action.effects.map((e) => e.predicate))];
  for (const constraint of action.constraints) {
    const left = (domain.classMembers[constraint.left] || [])[0];
    const right = (domain.classMembers[constraint.right] || [])[0];
    const guard = (domain.classMembers[constraint.guard] || [])[0];
    for (const predicate of predicates) {
      const leftAt = positionIn(nextState, left, predicate);
      if (!leftAt || positionIn(nextState, right, predicate) !== leftAt) continue;
      if (positionIn(nextState, guard, predicate) !== leftAt) return true;
    }
  }
  return false;
}

/** Every legal grounded action from `state`, with its successor.
 *  Deterministic: actions, signatures, and members are walked sorted. */
export function movesFromRules(state, domain, { budget = 5000 } = {}) {
  let groundings = 0;
  for (const action of domain.actions) {
    for (const sig of action.signatures) {
      groundings += (domain.classMembers[sig.subjectClass] || []).length *
        (domain.classMembers[sig.targetClass] || []).length;
    }
  }
  if (groundings > budget) throw new PlanBudgetError(groundings, budget);

  const out = [];
  for (const action of domain.actions) {
    const [verb, particle] = action.name.split(/\s+/);
    for (const sig of action.signatures) {
      for (const subject of domain.classMembers[sig.subjectClass] || []) {
        for (const target of domain.classMembers[sig.targetClass] || []) {
          if (subject === target) continue;
          let ok = true;
          for (const precond of action.preconds) {
            if (!precondApplies(precond, target, domain)) continue;
            if (!precondHolds(precond, subject, target, state, domain)) { ok = false; break; }
          }
          if (!ok) continue;
          if (!companionsCoLocated(action, subject, target, state, domain)) continue;
          const nextState = applyEffects(action.effects, subject, target, state, domain);
          if (!nextState) continue;
          if (constraintViolated(action, nextState, domain)) continue;
          out.push({
            action: {
              name: action.name,
              subject,
              target,
              label: [verb, subject, particle, target].filter(Boolean).join(" "),
            },
            nextState,
          });
        }
      }
    }
  }
  return out;
}

/** Compile goal specs ({universal, term, predicate, object}) into a pure
 *  state predicate. Satisfaction is a transitive walk along the goal
 *  predicate: a stacked member reaches the goal object through its support
 *  chain, which a direct row lookup cannot see. */
export function compileGoal(goalSpecs, domain) {
  const specs = (goalSpecs || []).map((g) => ({
    universal: Boolean(g.universal),
    term: normTerm(g.term),
    predicate: attachPrefix(g.predicate),
    object: normTerm(g.object),
  }));
  const checks = [];
  for (const spec of specs) {
    const members = spec.universal ? domain.classMembers[spec.term] || [] : [spec.term];
    if (spec.universal && members.length === 0) {
      throw new Error(`the goal names "${spec.term}" as a class, but it has no known members`);
    }
    for (const member of members) checks.push({ member, predicate: spec.predicate, object: spec.object });
  }
  return function isGoal(state) {
    for (const check of checks) {
      let current = check.member;
      let reached = false;
      const seen = new Set();
      for (let hop = 0; hop <= state.length; hop += 1) {
        if (seen.has(current)) break;
        seen.add(current);
        const row = state.find((r) => r.subject === current && r.predicate === check.predicate);
        if (!row) break;
        if (row.object === check.object) { reached = true; break; }
        current = row.object;
      }
      if (!reached) return false;
    }
    return true;
  };
}
