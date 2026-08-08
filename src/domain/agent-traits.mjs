// agent-traits.mjs — what drives an agent class or instance, read from rows
// alone: display name, avatar, mass, drain per turn, vision radius, whether
// it is marked a predator, and the classes it pursues, evades, consumes and
// guards. One instance's own rows override its class; a class with nothing
// stated has no drive, never a JS-invented default.
//
// The chain walk itself (classChainOf) is the same breadth-first walk
// src/services/adventure.mjs's objectClassChain already performs over
// rdf:type/rdfs:subClassOf, lifted here so the two callers — the adventure
// lane's mass-drain read and this module's trait resolver — share one walk
// instead of drifting apart. adventure.mjs imports it back down (services
// may import domain) and applies its own world-row filter before calling it;
// this module makes no such filter, since a domain module reads whatever
// rows it is given.
//
// Every list this module returns is sorted in codepoint order before it is
// returned, and every resolver here is a pure function of the row SET, never
// of the order the rows arrived in — the same rule p2p-room.mjs's
// sortFactIndividualsById holds for a merged fact store, so two callers who
// built the same rows in different orders never read a different answer.

/** Every predicate a spawn copies from a class onto an instance, and that the
 *  resolver reads back off the class chain. Sorted, frozen, closed: a
 *  predicate not on this list is world state, not an imperative, and a spawn
 *  leaves it alone. */
export const AGENT_TRAIT_PREDICATES = Object.freeze([
  "mgx:consumes",
  "mgx:display-name",
  "mgx:evades",
  "mgx:guards",
  "mgx:hasMass",
  "mgx:is-predator",
  "mgx:mass-drain-per-turn",
  "mgx:model",
  "mgx:pursues",
  "mgx:vision-radius",
]);

/** The subset of AGENT_TRAIT_PREDICATES that read as a set of rows rather
 *  than a single value: every row on the nearest chain link that declares
 *  any, not just the first. */
export const AGENT_TRAIT_MULTI = Object.freeze(new Set([
  "mgx:consumes",
  "mgx:evades",
  "mgx:guards",
  "mgx:pursues",
]));

const objectsOf = (rows, subject, predicate) =>
  (rows || []).filter((r) => r.subject === subject && r.predicate === predicate).map((r) => r.object);

const sortedUnique = (values) => [...new Set(values)].sort();

/** `subject`'s own class chain, nearest first, starting with `subject`
 *  itself: a breadth-first walk over its rdf:type and rdfs:subClassOf rows.
 *  A cycle stops the walk rather than looping. Pure — reads exactly the rows
 *  it is given, with no provenance filter of its own. */
export function classChainOf(rows, subject) {
  const parentsOf = (node) => (rows || [])
    .filter((r) => r.subject === node && (r.predicate === "rdf:type" || r.predicate === "rdfs:subClassOf"))
    .map((r) => r.object);
  const seen = new Set([subject]);
  const chain = [subject];
  const queue = [...parentsOf(subject)];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node)) continue;
    seen.add(node);
    chain.push(node);
    queue.push(...parentsOf(node));
  }
  return chain;
}

/** The single declared value of `predicate` on `subject`'s own class chain,
 *  nearest first — an instance's own row wins over its class's. Null when no
 *  chain link declares one, which reads as "nobody has said anything about
 *  this yet", never as an invented default. When a single node writes more
 *  than one value for the same predicate (an ill-formed world), the choice
 *  is the sorted-first value, so the answer never depends on which order the
 *  rows arrived in. Pure. */
export function traitValueOf(rows, subject, predicate) {
  for (const node of classChainOf(rows, subject)) {
    const values = objectsOf(rows, node, predicate);
    if (values.length) return sortedUnique(values)[0];
  }
  return null;
}

/** Every declared value of `predicate` on the FIRST chain link (nearest
 *  first) that declares any, sorted and deduped — so an instance's own
 *  `mgx:evades` row replaces its class's set rather than adding to it. Empty
 *  when no chain link declares one. Pure. */
export function traitValuesOf(rows, subject, predicate) {
  for (const node of classChainOf(rows, subject)) {
    const values = objectsOf(rows, node, predicate);
    if (values.length) return sortedUnique(values);
  }
  return [];
}

/** Which chain link answered `traitValueOf`/`traitValuesOf` for this
 *  predicate: `"instance"` when `subject` itself declares it, the class name
 *  that declares it otherwise, or `null` when no chain link does. Pure. */
export function traitOriginOf(rows, subject, predicate) {
  const chain = classChainOf(rows, subject);
  for (const node of chain) {
    if (objectsOf(rows, node, predicate).length) return node === subject ? "instance" : node;
  }
  return null;
}

const numberOrNull = (value) => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Every trait `subject` reads off its own class chain, flat and fully
 *  populated so no caller has to remember which key is a list. `classes` is
 *  the chain of ancestor class names, nearest first, excluding `subject`
 *  itself. A trait nobody declared reads as `null` (single-valued) or `[]`
 *  (multi-valued), never as a JS-side default. Pure. */
export function agentTraitsOf(rows, subject) {
  return {
    subject,
    classes: classChainOf(rows, subject).slice(1),
    displayName: traitValueOf(rows, subject, "mgx:display-name"),
    model: traitValueOf(rows, subject, "mgx:model"),
    mass: numberOrNull(traitValueOf(rows, subject, "mgx:hasMass")),
    massDrainPerTurn: numberOrNull(traitValueOf(rows, subject, "mgx:mass-drain-per-turn")),
    visionRadius: numberOrNull(traitValueOf(rows, subject, "mgx:vision-radius")),
    isPredator: traitValueOf(rows, subject, "mgx:is-predator") === "true",
    pursues: traitValuesOf(rows, subject, "mgx:pursues"),
    evades: traitValuesOf(rows, subject, "mgx:evades"),
    consumes: traitValuesOf(rows, subject, "mgx:consumes"),
    guards: traitValuesOf(rows, subject, "mgx:guards"),
  };
}

/** `className`'s own trait rows — the rows a class-tab editor renders for
 *  that class alone, never an ancestor's. Sorted by (predicate, object).
 *  Pure. */
export function classFactRowsFor(rows, className) {
  return (rows || [])
    .filter((r) => r.subject === className && AGENT_TRAIT_PREDICATES.includes(r.predicate))
    .map((r) => ({ subject: r.subject, predicate: r.predicate, object: r.object }))
    .sort(compareRows);
}

function compareRows(a, b) {
  if (a.predicate !== b.predicate) return a.predicate < b.predicate ? -1 : 1;
  if (a.object !== b.object) return a.object < b.object ? -1 : 1;
  return 0;
}

const DRIVE_PREDICATES = Object.freeze(["mgx:consumes", "mgx:evades", "mgx:pursues"]);

/** Whether any row states a drive (`mgx:pursues`, `mgx:evades` or
 *  `mgx:consumes`). A world that states none is a world whose cast is still
 *  driven by its injected roles object and config numbers alone. Pure. */
export function rowsDeclareDrives(rows) {
  return (rows || []).some((r) => DRIVE_PREDICATES.includes(r.predicate));
}

/** The class an appetite belongs to: the consuming subject's own bare
 *  `rdf:type` class when it is an instance, otherwise the subject itself. */
function consumerClassOf(rows, subject) {
  const typed = (rows || []).find((r) => r.subject === subject && r.predicate === "rdf:type");
  return typed ? typed.object : subject;
}

/** The class names `subject` moves away from: its own chain's `mgx:evades`
 *  rows when any are declared, otherwise the inverse of `mgx:consumes` —
 *  every class whose members declare an appetite for a class on `subject`'s
 *  own chain. The inverse is what keeps a prey fleeing its eater without the
 *  world stating the fear twice; a declared `mgx:evades` set replaces it
 *  entirely, so one instance can be taught a different fear (or a fear of
 *  something absent) without inheriting the derived one back. Sorted. Pure. */
export function fearedClassesOf(rows, subject) {
  const declared = traitValuesOf(rows, subject, "mgx:evades");
  if (declared.length) return declared;
  const chain = new Set(classChainOf(rows, subject));
  const consumers = new Set();
  for (const row of rows || []) {
    if (row.predicate !== "mgx:consumes" || !chain.has(row.object)) continue;
    consumers.add(consumerClassOf(rows, row.subject));
  }
  return [...consumers].sort();
}

/** The cast a world's own rows state, in the `{ predator, prey, food }` shape
 *  the town-square engine's `roles` parameter already takes. A predator class
 *  is one whose declared `mgx:pursues`/`mgx:consumes` names another class that
 *  itself declares a drive; the prey class is the one it names. `fallback`
 *  fills whatever the rows say nothing about — the food kinds always come
 *  from it, since a spawned and a placed food differ by who put them there,
 *  which no trait row states. Null when the rows state no cast at all and no
 *  fallback was given. Sorted-first on ties, so two row orders build the same
 *  cast. Pure. */
export function castFromFacts(rows, { fallback = null } = {}) {
  const driveSubjects = new Set(
    (rows || []).filter((r) => DRIVE_PREDICATES.includes(r.predicate)).map((r) => r.subject),
  );
  const driveClasses = new Set([...driveSubjects].map((s) => consumerClassOf(rows, s)));
  let predatorKind = null;
  let preyKind = null;
  for (const kind of [...driveClasses].sort()) {
    const targets = [...traitValuesOf(rows, kind, "mgx:pursues"), ...traitValuesOf(rows, kind, "mgx:consumes")]
      .filter((target) => target !== kind && driveClasses.has(target))
      .sort();
    if (targets.length) { predatorKind = kind; preyKind = targets[0]; break; }
  }
  if (!predatorKind) return fallback;
  return {
    predator: { role: "predator", kind: predatorKind, idPrefix: predatorKind, hunts: preyKind ? "prey" : null },
    prey: preyKind
      ? { role: "prey", kind: preyKind, idPrefix: preyKind, hunts: null }
      : (fallback?.prey ?? null),
    food: fallback?.food ?? null,
  };
}

/** The instance's own rows for a fresh spawn of `className`: one row per
 *  trait `className`'s own class chain declares, subject rewritten to
 *  `instanceId`, plus the `rdf:type` row. Sorted by (predicate, object) so
 *  two callers building the same spawn build the same list. Returns rows, it
 *  does not write them — the caller appends them through `appendFacts`,
 *  whose content-addressed ids make a second spawn of the same instance a
 *  no-op rather than a duplicate. Pure. */
export function instanceFactsFrom(rows, className, instanceId) {
  const out = [{ subject: instanceId, predicate: "rdf:type", object: className }];
  for (const predicate of AGENT_TRAIT_PREDICATES) {
    if (AGENT_TRAIT_MULTI.has(predicate)) {
      for (const object of traitValuesOf(rows, className, predicate)) {
        out.push({ subject: instanceId, predicate, object });
      }
    } else {
      const value = traitValueOf(rows, className, predicate);
      if (value !== null) out.push({ subject: instanceId, predicate, object: value });
    }
  }
  return out.sort(compareRows);
}
