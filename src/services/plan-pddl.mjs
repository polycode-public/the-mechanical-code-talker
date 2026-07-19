// plan-pddl.mjs — a PDDL-style + OWL/RDF text rendering of a solved plan
// (the plan-lane contract chat.mjs's planLaneAnswer returns, PLAN_GAMES_
// UPLIFT_V3.md Part C.4 item 3): tmct's own richest textual account of what
// findActionPath actually consulted, for the "it plans, and shows the work"
// page's new text panel.
//
// Pure formatting over already-structured data (plan.actions/.states/.goal/
// .domain) — no I/O, no new tracking. Every fact line keeps its REAL
// predicate tag verbatim (mgx:rest-on, rdf:type, rdfs:subClassOf —
// plan-viz.mjs's own displayPredicate strips the "mgx:" prefix for the
// visual board; this renderer never does, on purpose: the point is showing
// the actual reasoning surface, not decorative syntax), and every
// :precondition/:effect block is a mechanical diff between two consecutive
// plan.states snapshots — nothing here infers a taught rule's own guard
// conditions that never surface as a fact-row change (e.g. "nothing may
// rest on the target" never toggles a row when it already holds, so it
// leaves no diff to show).
//
// The `rdf:type`/`rdfs:subClassOf` split for the :ontology block is read
// straight off domain.classMembers' own one-hop shape (compileDomain, see
// domain.mjs): a class-membership edge lands under `classMembers[object] =
// [...subjects]` for BOTH "X is a Y" (rdf:type) and "X is a kind of Y"
// (rdfs:subClassOf) teach frames alike, with no record of which frame taught
// it — so the split here is a real, testable structural fact (a member that
// is itself a declared class name is a class-to-class edge; anything else is
// an individual-to-class edge), not a guess.

const attachPrefix = (predicate) => {
  const p = String(predicate ?? "").trim();
  return p.includes(":") ? p : `mgx:${p}`;
};

const slug = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const factAtom = (r) => `(${r.predicate} ${r.subject} ${r.object})`;
const factKeyOf = (r) => `${r.subject} ${r.predicate} ${r.object}`;

/** Every class name domain.classMembers declares — a member that is also a
 *  key names a class-to-class edge; anything else is a plain individual. */
function classNamesOf(classMembers) {
  return new Set(Object.keys(classMembers || {}));
}

/** {rdf:type, rdfs:subClassOf}-tagged edges, one per (member, class) pair,
 *  sorted for deterministic output. */
function ontologyEdges(classMembers) {
  const classNames = classNamesOf(classMembers);
  const edges = [];
  for (const cls of Object.keys(classMembers || {}).sort()) {
    for (const member of [...(classMembers[cls] || [])].sort()) {
      edges.push({
        predicate: classNames.has(member) ? "rdfs:subClassOf" : "rdf:type",
        subject: member,
        object: cls,
      });
    }
  }
  return edges;
}

/** `member`'s direct class (first match in sorted class-name order), or null
 *  when `member` is itself a class name (not an individual) or untyped. */
function directClassOf(classMembers, member) {
  if (classNamesOf(classMembers).has(member)) return null;
  for (const cls of Object.keys(classMembers || {}).sort()) {
    if ((classMembers[cls] || []).includes(member)) return cls;
  }
  return null;
}

/** Every plain individual (a member that is never itself a class name),
 *  sorted, deduplicated across every class it happens to appear under. */
function individualsOf(classMembers) {
  const classNames = classNamesOf(classMembers);
  const out = new Set();
  for (const members of Object.values(classMembers || {})) {
    for (const m of members || []) if (!classNames.has(m)) out.add(m);
  }
  return [...out].sort();
}

/** The :objects block's lines — individuals grouped by their direct class,
 *  PDDL's own `a b c - type` typed-list shorthand. Untyped individuals (no
 *  direct class found) list on their own trailing line rather than being
 *  silently dropped. */
function objectsLines(classMembers) {
  const byClass = new Map();
  const untyped = [];
  for (const member of individualsOf(classMembers)) {
    const cls = directClassOf(classMembers, member);
    if (!cls) { untyped.push(member); continue; }
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(member);
  }
  const lines = [...byClass.keys()].sort().map((cls) => `    ${byClass.get(cls).join(" ")} - ${cls}`);
  if (untyped.length) lines.push(`    ${untyped.join(" ")}`);
  return lines;
}

/** A goal spec ({universal, term, predicate, object}) expanded into concrete
 *  ground atoms — a universal spec over every member domain.classMembers
 *  names for `term` (compileGoal's own expansion, domain.mjs), a non-
 *  universal spec as the single named atom. A universal term with no known
 *  members expands to nothing (never a placeholder atom naming an unknown
 *  member). */
function goalAtoms(specs, classMembers) {
  const atoms = [];
  for (const spec of specs || []) {
    const predicate = attachPrefix(spec.predicate);
    const members = spec.universal ? [...(classMembers?.[spec.term] || [])].sort() : [spec.term];
    for (const member of members) atoms.push({ subject: member, predicate, object: spec.object });
  }
  return atoms;
}

/** One action's :precondition/:effect block as a mechanical diff between the
 *  before (`before`) and after (`after`) state snapshots — every fact row
 *  present before and absent after is a precondition that stopped holding
 *  (rendered as `(not …)` in the effect); every row absent before and
 *  present after is newly asserted. No inference beyond the two snapshots
 *  themselves — a rule's own guard conditions that never toggle a row (e.g.
 *  "nothing may rest on the target") leave no diff and so render nothing
 *  here; the taught rule's `becauseText` names them in prose instead. */
function diffAction(before, after) {
  const beforeByKey = new Map((before || []).map((r) => [factKeyOf(r), r]));
  const afterByKey = new Map((after || []).map((r) => [factKeyOf(r), r]));
  const removed = [...beforeByKey.entries()].filter(([k]) => !afterByKey.has(k)).map(([, r]) => r);
  const added = [...afterByKey.entries()].filter(([k]) => !beforeByKey.has(k)).map(([, r]) => r);
  const bySubjObj = (a, b) => (a.subject === b.subject ? (a.object < b.object ? -1 : 1) : a.subject < b.subject ? -1 : 1);
  return { removed: removed.sort(bySubjObj), added: added.sort(bySubjObj) };
}

/**
 * A PDDL-style `(define (problem …) …)` block plus one `(:action …)` per
 * plan step, each carrying tmct's own real ontology tags — the richest
 * textual form of a solved plan the engine can express, for a visitor to
 * read alongside the visual block/circle render, not instead of it.
 *
 * `plan`: the plan-lane contract ({ actions, states, stepGoals, goal,
 * domain: { classMembers, ordering } }) — see chat.mjs's planLaneAnswer.
 * Returns a string; `""` for a plan with no actions and no init facts (an
 * already-satisfied goal has nothing to narrate).
 */
export function planToPddl(plan, { problemName = "tmct-plan", domainName = "tmct-taught-domain" } = {}) {
  const actions = plan?.actions || [];
  const states = plan?.states || [];
  const classMembers = plan?.domain?.classMembers || {};
  const ordering = plan?.domain?.ordering || [];
  const goalText = plan?.goal?.text || "";
  const goal = goalAtoms(plan?.goal?.specs, classMembers);
  const init = (states[0] || []);

  const lines = [];
  lines.push(`;; tmct plan artifact — PDDL-style action sequence + OWL/RDF ontology tags`);
  lines.push(`;; goal: ${goalText || "(none stated)"}`);
  if (plan?.becauseText) lines.push(`;; because: ${plan.becauseText}`);
  lines.push("");
  lines.push(`(define (problem ${slug(problemName) || "tmct-plan"})`);
  lines.push(`  (:domain ${slug(domainName) || "tmct-taught-domain"})`);
  lines.push("");

  const objLines = objectsLines(classMembers);
  if (objLines.length) {
    lines.push("  ;; :objects — individuals grounded through the taught class hierarchy");
    lines.push("  (:objects");
    lines.push(...objLines);
    lines.push("  )");
    lines.push("");
  }

  const edges = ontologyEdges(classMembers);
  if (edges.length) {
    lines.push("  ;; :ontology — the real rdf:type/rdfs:subClassOf rows compileDomain folded");
    lines.push("  ;; into domain.classMembers (rdf:type = individual->class, rdfs:subClassOf =");
    lines.push("  ;; class->superclass)");
    lines.push("  (:ontology");
    for (const e of edges) lines.push(`    (${e.predicate} ${e.subject} ${e.object})`);
    lines.push("  )");
    lines.push("");
  }

  const orderingRows = [...ordering].sort((a, b) => (a.subject === b.subject ? (a.object < b.object ? -1 : 1) : a.subject < b.subject ? -1 : 1));
  if (orderingRows.length) {
    lines.push("  ;; :ordering — the real mgx:*-than facts the taught precondition consulted");
    lines.push("  (:ordering");
    for (const r of orderingRows) lines.push(`    ${factAtom(r)}`);
    lines.push("  )");
    lines.push("");
  }

  if (init.length) {
    lines.push("  ;; :init — state@0, the taught starting board (real mgx:* predicate tags)");
    lines.push("  (:init");
    for (const r of [...init].sort((a, b) => (a.subject === b.subject ? (a.object < b.object ? -1 : 1) : a.subject < b.subject ? -1 : 1))) {
      lines.push(`    ${factAtom(r)}`);
    }
    lines.push("  )");
    lines.push("");
  }

  if (goal.length) {
    lines.push("  ;; :goal");
    lines.push("  (:goal (and");
    for (const a of goal) lines.push(`    ${factAtom(a)}`);
    lines.push("  ))");
  }
  lines.push(")");

  if (actions.length) {
    lines.push("");
    lines.push(`;; action sequence — findActionPath's own shortest path (${actions.length} move${actions.length === 1 ? "" : "s"})`);
    actions.forEach((action, i) => {
      const before = states[i] || [];
      const after = states[i + 1] || [];
      const { removed, added } = diffAction(before, after);
      const name = `${slug(action.name) || "move"}-step${i + 1}`;
      lines.push("");
      lines.push(`(:action ${name}`);
      lines.push(`  :label "${action.label || `${action.name} ${action.subject} ${action.target}`}"`);
      lines.push(`  :subject ${action.subject}`);
      lines.push(`  :target ${action.target}`);
      if (removed.length) {
        lines.push("  :precondition (and");
        for (const r of removed) lines.push(`    ${factAtom(r)}`);
        lines.push("  )");
      } else {
        lines.push("  :precondition (and)");
      }
      const effectLines = [
        ...removed.map((r) => `    (not ${factAtom(r)})`),
        ...added.map((r) => `    ${factAtom(r)}`),
      ];
      if (effectLines.length) {
        lines.push("  :effect (and");
        lines.push(...effectLines);
        lines.push("  )");
      } else {
        lines.push("  :effect (and)");
      }
      lines.push(")");
    });
  }

  return `${lines.join("\n")}\n`;
}
