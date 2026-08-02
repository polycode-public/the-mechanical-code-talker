// mud-editor.mjs — the burrow's text<->fact bridge, the mud world's own
// counterpart to adventure-editor.mjs. Same discipline, different vocabulary:
// a small closed sentence table, invertible by construction, where every phrase
// the renderer writes has exactly one parser rule that reads it back to the same
// triple.
//
// It is a separate table rather than an extension of adventure-editor.mjs's
// because the two worlds are built out of different facts. Ashcombe Hall is a
// puzzle — locks, hidden things, an objective, an NPC schedule. mud-garden is an
// ecology — a class hierarchy, masses, a predator, and the dig knobs that say how
// far a burrow reaches and what digging one out turns up. An editor whose whole
// point is "change what this world is made of" has to speak the vocabulary the
// world is actually written in, and neither table is a superset of the other.
//
// Every export here but wordBeforeCursor is written locally, and is
// `.toString()`-splice-safe, the same discipline adventure-editor.mjs and the
// *-viz render-glue functions hold — mud-viz.mjs splices these straight into
// mud.html's inline script, which captures a function's own source text and
// nothing it closes over. A splice-safe function carries its whole dependency
// graph inside its own body. wordBeforeCursor is a re-export of viz-theme.mjs's
// shared implementation, itself self-contained and splice-safe the same way —
// this module no longer keeps its own copy of it.
//
// Two predicate families sync differently, for the reason adventure-editor.mjs's
// own header sets out:
//   - PLACEMENT (currently-in/located-in/fixed-in/hidden-in), OPENNESS and MASS
//     are fold-versioned — foldWorldState already reads the newest write as the
//     current truth, which is how every turn's own move and mass drain lands — so
//     an edit to one is a plain new write superseding the old, never a
//     retraction. Mass belongs here and not below precisely because it MOVES: a
//     playing animal's weight is a fold over turn snapshots, so an editor
//     diffing raw mass rows would show the seed and fight the drain.
//   - Everything else (typing, the class hierarchy, exits, the predator flag,
//     the dig knobs) is read raw by the engine, so changing one genuinely needs
//     the old row retracted. planMudEditorSync computes that diff, and the caller
//     only applies its removals when the whole document parsed cleanly: a line
//     that fails to parse this keystroke must never be read as "this fact is
//     gone".

export { wordBeforeCursor } from "./viz-theme.mjs";

const PLACEMENT_KIND = "placement";
const OPENNESS_KIND = "openness";
const MASS_KIND = "mass";
const OTHER_KIND = "other";

const LOW = (s) => String(s || "").trim().toLowerCase();

const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;
const SNAPSHOT_RE = /^(.+)@turn(\d+)$/;

// Every predicate this editor renders and parses outside the placement/openness
// families — the closed set planMudEditorSync diffs against, and the only rows a
// removal can ever target. A predicate the engine reads but this table cannot
// say is deliberately absent: unrenderable and undiffable together, so an edit
// elsewhere in the document can never silently retract it.
const EDITABLE_OTHER_PREDICATES = [
  "rdf:type", "rdfs:subClassOf", "mgx:display-name",
  "mgx:model", "mgx:rotation",
  "mgx:is-container", "mgx:is-predator", "mgx:is-origin",
  "mgx:dig-spawns", "mgx:den-spawns", "mgx:den-resident",
  "mgx:dig-reach", "mgx:dig-spawn-max", "mgx:den-chance-in", "mgx:den-resident-chance-in",
  "mgx:mass-drain-per-turn",
];

// The two flags that only ever have a sentence in the "true" direction. A row
// saying "false" is unrenderable here, so it must not be diffable either.
const TRUE_ONLY_FLAG_PREDICATES = ["mgx:is-container", "mgx:is-predator", "mgx:is-origin"];

// ---- rendering ---------------------------------------------------------------

/** A GRID world's folded state in the shape this module's own renderer and
 *  differ read. A room world folds a placement into `{ predicate, object }`,
 *  because a thing can be carried, hidden or fixed as well as stood in. A grid
 *  world folds it into `{ cell, turn, epoch }`: on a board there is one way to
 *  be somewhere, and the extra fields carry the (epoch, turn) rank instead.
 *
 *  Handed a grid fold directly, `renderMudEditorText` reads `place.predicate`
 *  as undefined and renders no placement sentence at all, and
 *  `planMudEditorSync` reads every placement line as a change and re-appends
 *  it. One translation here keeps both honest, and keeps a second copy of the
 *  mapping out of each page that needs it.
 *
 *  `masses` comes across too, since a grid fold names it `mass`. There is no
 *  openness on a board, so that map is empty. Pure, self-contained (spliced by
 *  `.toString()` alongside the two functions it feeds). */
export function gridWorldEditorState(state) {
  const placements = new Map();
  for (const [subject, place] of (state && state.placements) || new Map()) {
    if (place && place.cell) placements.set(subject, { predicate: "mgx:currently-in", object: place.cell });
  }
  const masses = new Map();
  for (const [subject, mass] of (state && state.mass) || new Map()) {
    if (mass && mass.value !== undefined) masses.set(subject, { value: mass.value });
  }
  return { placements, masses, openness: new Map() };
}

/** The whole burrow's editable facts as plain sentences, one per line, sorted by
 *  (subject, predicate, object) so two edits apart produce a reviewable diff
 *  rather than a reshuffle. Placement and openness come from the FOLDED state, so
 *  what shows is where things actually are now; everything else comes from the
 *  raw rows, skipping @turnN snapshot subjects — those carry only the placement
 *  overrides the fold has already read.
 *
 *  Deliberately self-contained (its own local casing/phrase helpers, duplicating
 *  this module's top-level ones) rather than calling private siblings: this
 *  function is spliced into mud.html's inline script by `.toString()`, which
 *  captures the body and nothing else. Pure. */
export function renderMudEditorText(rows, state) {
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
  const low = (s) => String(s || "").trim().toLowerCase();
  const typePhraseFor = (object) => (/^[aeiou]/i.test(object) ? "is an" : "is a");
  const exitRe = /^mgx:has-exit-([a-z]+)$/;
  const snapshotRe = /^(.+)@turn(\d+)$/;

  // A character is placed with currently-in; that is the whole test the engine
  // itself applies, so "carries" versus "lies in" is read off the holder's own
  // placement predicate rather than off a class list.
  const isCharacter = (subject) => state.placements?.get(subject)?.predicate === "mgx:currently-in";

  const lines = [];
  const push = (subject, predicate, object, text) =>
    lines.push({ key: [subject, predicate, object].join(" "), text });

  const placementLine = (subject, place) => {
    if (place.predicate === "mgx:currently-in") return `${cap(subject)} stands in the ${place.object}.`;
    if (place.predicate === "mgx:fixed-in") return `${cap(subject)} is fixed in the ${place.object}.`;
    if (place.predicate === "mgx:hidden-in") return `${cap(subject)} is hidden in the ${place.object}.`;
    if (place.predicate !== "mgx:located-in") return null;
    return isCharacter(place.object)
      ? `${cap(place.object)} carries the ${subject}.`
      : `${cap(subject)} lies in the ${place.object}.`;
  };

  for (const [subject, place] of state.placements || new Map()) {
    const text = placementLine(subject, place);
    if (text) push(subject, place.predicate, place.object, text);
  }
  for (const [subject, openness] of state.openness || new Map()) {
    push(subject, "mgx:is-open", String(openness.open),
      openness.open ? `${cap(subject)} is open.` : `${cap(subject)} is closed.`);
  }
  for (const [subject, mass] of state.masses || new Map()) {
    push(subject, "mgx:hasMass", String(mass.value), `${cap(subject)} weighs ${mass.value}.`);
  }

  for (const row of rows || []) {
    if (snapshotRe.test(row.subject)) continue;
    const s = row.subject, p = row.predicate, o = row.object;
    const exit = exitRe.exec(p);
    if (exit) { push(s, p, o, `${cap(s)} has an exit ${exit[1]} to the ${o}.`); continue; }
    if (p === "rdf:type") { push(s, p, o, `${cap(s)} ${typePhraseFor(o)} ${o}.`); continue; }
    if (p === "rdfs:subClassOf") { push(s, p, o, `${cap(s)} is a kind of ${o}.`); continue; }
    if (p === "mgx:display-name") { push(s, p, o, `${cap(s)} is shown as ${o}.`); continue; }
    if (p === "mgx:model") { push(s, p, o, `${cap(s)} is modelled as ${o}.`); continue; }
    if (p === "mgx:rotation") { push(s, p, o, `${cap(s)} is turned ${o} degrees.`); continue; }
    if (p === "mgx:is-container" && o === "true") { push(s, p, o, `${cap(s)} is a container.`); continue; }
    if (p === "mgx:is-predator" && o === "true") { push(s, p, o, `${cap(s)} hunts the other animals.`); continue; }
    if (p === "mgx:is-origin" && o === "true") { push(s, p, o, `${cap(s)} is where the burrow starts.`); continue; }
    if (p === "mgx:dig-spawns") { push(s, p, o, `Digging in ${s} turns up ${o}.`); continue; }
    if (p === "mgx:den-spawns") { push(s, p, o, `A den in ${s} stores ${o}.`); continue; }
    if (p === "mgx:den-resident") { push(s, p, o, `A den in ${s} is lived in by ${o}.`); continue; }
    if (p === "mgx:dig-reach") { push(s, p, o, `The burrow digs ${o} rooms out from the ${s}.`); continue; }
    if (p === "mgx:dig-spawn-max") { push(s, p, o, `Digging in ${s} turns up at most ${o} things.`); continue; }
    if (p === "mgx:den-chance-in") { push(s, p, o, `One dig in ${o} in ${s} opens a den.`); continue; }
    if (p === "mgx:den-resident-chance-in") { push(s, p, o, `One den in ${o} in ${s} is lived in.`); continue; }
    if (p === "mgx:mass-drain-per-turn") { push(s, p, o, `${cap(s)} loses ${o} mass a turn.`); continue; }
  }

  const seen = new Set();
  const deduped = lines.filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)));
  deduped.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return deduped.map((l) => l.text).join("\n");
}

// ---- parsing -----------------------------------------------------------------

// Checked in this order, first match wins. Every phrase above the two generic
// fallbacks is a literal-text special case one of those two would also match
// ("is a container." is a valid "is a <class>." sentence), so the specific
// readings have to be tried first and the bare ones last.
const LINE_PATTERNS = [
  { re: /^(.+?)\s+carries\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[2]), predicate: "mgx:located-in", object: LOW(m[1]) }) },
  { re: /^(.+?)\s+stands\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:currently-in", object: LOW(m[2]) }) },
  { re: /^(.+?)\s+lies\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:located-in", object: LOW(m[2]) }) },
  { re: /^(.+?)\s+is\s+fixed\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:fixed-in", object: LOW(m[2]) }) },
  { re: /^(.+?)\s+is\s+hidden\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:hidden-in", object: LOW(m[2]) }) },
  { re: /^(.+?)\s+has\s+an\s+exit\s+(\w+)\s+to\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: `mgx:has-exit-${LOW(m[2])}`, object: LOW(m[3]) }) },
  { re: /^(.+?)\s+is\s+open\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-open", object: "true" }) },
  { re: /^(.+?)\s+is\s+closed\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-open", object: "false" }) },
  { re: /^(.+?)\s+is\s+a\s+container\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-container", object: "true" }) },
  { re: /^(.+?)\s+hunts\s+the\s+other\s+animals\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-predator", object: "true" }) },
  { re: /^(.+?)\s+is\s+where\s+the\s+burrow\s+starts\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-origin", object: "true" }) },
  { re: /^(.+?)\s+is\s+a\s+kind\s+of\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "rdfs:subClassOf", object: LOW(m[2]) }) },
  { re: /^(.+?)\s+weighs\s+([\d.]+)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:hasMass", object: m[2] }) },
  { re: /^(.+?)\s+is\s+shown\s+as\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:display-name", object: LOW(m[2]) }) },
  // The two facts a 3D view needs and no other sentence in this table can
  // say: which mesh draws a thing, and how far round it is turned. Kept
  // apart from "is shown as" (a plain reading name, which every surface uses)
  // because a renderer asking for the mesh must never be handed the name.
  { re: /^(.+?)\s+is\s+modelled\s+as\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:model", object: LOW(m[2]) }) },
  { re: /^(.+?)\s+is\s+turned\s+(-?[\d.]+)\s+degrees?\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:rotation", object: m[2] }) },
  { re: /^(.+?)\s+loses\s+([\d.]+)\s+mass\s+a\s+turn\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:mass-drain-per-turn", object: m[2] }) },
  // The dig knobs. "at most N things" is tried before the plain "turns up X" so
  // the count reading wins over reading "at most 2 things" as a spawned kind.
  { re: /^digging\s+in\s+(.+?)\s+turns\s+up\s+at\s+most\s+(\d+)\s+things?\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:dig-spawn-max", object: m[2] }) },
  { re: /^digging\s+in\s+(.+?)\s+turns\s+up\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:dig-spawns", object: LOW(m[2]) }) },
  { re: /^a\s+den\s+in\s+(.+?)\s+stores\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:den-spawns", object: LOW(m[2]) }) },
  { re: /^a\s+den\s+in\s+(.+?)\s+is\s+lived\s+in\s+by\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:den-resident", object: LOW(m[2]) }) },
  { re: /^the\s+burrow\s+digs\s+(\d+)\s+rooms?\s+out\s+from\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[2]), predicate: "mgx:dig-reach", object: m[1] }) },
  { re: /^one\s+dig\s+in\s+(\d+)\s+in\s+(.+?)\s+opens\s+a\s+den\.?$/i,
    build: (m) => ({ subject: LOW(m[2]), predicate: "mgx:den-chance-in", object: m[1] }) },
  { re: /^one\s+den\s+in\s+(\d+)\s+in\s+(.+?)\s+is\s+lived\s+in\.?$/i,
    build: (m) => ({ subject: LOW(m[2]), predicate: "mgx:den-resident-chance-in", object: m[1] }) },
  // The generic type fallback, tried last on purpose.
  { re: /^(.+?)\s+is\s+an?\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "rdf:type", object: LOW(m[2]) }) },
];

const PLACEMENT_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:hidden-in",
]);

/** One line -> `{ subject, predicate, object, kind }`, or null when nothing in
 *  the table recognizes it — an honest miss, never a guessed shape. Pure. */
export function parseMudEditorLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  for (const pattern of LINE_PATTERNS) {
    const m = trimmed.match(pattern.re);
    if (!m) continue;
    const triple = pattern.build(m);
    if (!triple.subject || !triple.object) continue;
    const kind = triple.predicate === "mgx:is-open" ? OPENNESS_KIND
      : triple.predicate === "mgx:hasMass" ? MASS_KIND
        : PLACEMENT_PREDICATES.has(triple.predicate) ? PLACEMENT_KIND : OTHER_KIND;
    return { ...triple, kind };
  }
  return null;
}

/** Parse the whole editor textarea: every non-blank line either becomes a triple
 *  or lands in `unrecognized` (1-based line numbers, and the original text —
 *  never silently dropped). Pure. */
export function parseMudEditorText(text) {
  const triples = [];
  const unrecognized = [];
  String(text || "").split("\n").forEach((raw, i) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = parseMudEditorLine(trimmed);
    if (parsed) triples.push(parsed);
    else unrecognized.push({ line: i + 1, text: raw });
  });
  return { triples, unrecognized };
}

// ---- sync planning -----------------------------------------------------------

const tripleKey = (t) => `${t.subject} ${t.predicate} ${t.object}`;

/** Every raw fact row this editor's "other" family is allowed to touch. Skips
 *  @turnN snapshot subjects, mirroring the renderer, and skips a "false" row of
 *  a flag the renderer only writes a sentence for in the "true" direction. Pure. */
export function editableMudOtherRows(rows) {
  return (rows || []).filter((r) => {
    if (SNAPSHOT_RE.test(r.subject)) return false;
    if (EXIT_PREDICATE_RE.test(r.predicate)) return true;
    if (TRUE_ONLY_FLAG_PREDICATES.includes(r.predicate)) return r.object === "true";
    return EDITABLE_OTHER_PREDICATES.includes(r.predicate);
  });
}

/** Plan the fact-store writes one parsed edit implies, from already-parsed
 *  `triples` against the world's current `rows`/`state`. Returns
 *  `{ toAppend, toRemoveIds }` — pure, no I/O.
 *
 *  Placement and openness triples are never retracted: one joins `toAppend` only
 *  when it actually differs from the subject's current folded value, so
 *  re-asserting an unchanged line doesn't append a no-op duplicate per keystroke.
 *  Everything else gets a real add/remove diff — but the CALLER decides whether
 *  `toRemoveIds` is safe to apply, and must skip it whenever the parse reported
 *  any unrecognized line. */
export function planMudEditorSync(rows, state, triples) {
  const toAppend = [];
  // One "already said this" set per fold-versioned family, never one shared set:
  // a subject can carry a placement, an openness and a mass at once, and a
  // single set would let whichever line came last silence the other two.
  const seenByKind = { [PLACEMENT_KIND]: new Set(), [OPENNESS_KIND]: new Set(), [MASS_KIND]: new Set() };
  const otherTriples = [];
  // Last occurrence per subject wins, mirroring how a person reads a document
  // top to bottom and treats a later line as the correction of an earlier one.
  for (const t of [...(triples || [])].reverse()) {
    if (t.kind === OTHER_KIND) { otherTriples.push(t); continue; }
    const seen = seenByKind[t.kind];
    if (seen.has(t.subject)) continue;
    seen.add(t.subject);
    if (t.kind === PLACEMENT_KIND) {
      const current = state.placements?.get(t.subject);
      if (!current || current.predicate !== t.predicate || current.object !== t.object) toAppend.push(t);
    } else if (t.kind === OPENNESS_KIND) {
      const current = state.openness?.get(t.subject);
      if (!current || current.open !== (t.object === "true")) toAppend.push(t);
    } else {
      const current = state.masses?.get(t.subject);
      if (!current || Number(current.value) !== Number(t.object)) toAppend.push(t);
    }
  }

  const currentKeys = new Map(editableMudOtherRows(rows).map((r) => [tripleKey(r), r.id]));
  const newOtherKeys = new Set();
  for (const t of otherTriples) {
    const key = tripleKey(t);
    if (newOtherKeys.has(key)) continue;
    newOtherKeys.add(key);
    if (!currentKeys.has(key)) toAppend.push(t);
  }
  const toRemoveIds = [];
  for (const [key, id] of currentKeys) {
    if (!newOtherKeys.has(key)) toRemoveIds.push(id);
  }
  return { toAppend, toRemoveIds };
}

/** The additive half of planMudEditorSync, for ONE already-parsed triple: the
 *  rows a single taught sentence implies, and never a retraction. A whole
 *  document says what the world contains, so a fact missing from it has gone;
 *  one sentence only ever says what it says, so nothing it leaves out is
 *  evidence of anything. Re-asserting a fact the world already holds appends
 *  nothing, and `reason` says which of the two happened. Pure. */
export function planTaughtMudTriple(rows, state, triple) {
  if (!triple?.subject || !triple?.object) return { toAppend: [], reason: "nothing parsed" };
  if (triple.kind === PLACEMENT_KIND) {
    const current = state?.placements?.get(triple.subject);
    if (current && current.predicate === triple.predicate && current.object === triple.object) {
      return { toAppend: [], reason: `${triple.subject} is already ${triple.predicate} ${triple.object}` };
    }
    return {
      toAppend: [triple],
      reason: current
        ? `${triple.subject} moves from ${current.object} to ${triple.object}`
        : `${triple.subject} is placed ${triple.predicate} ${triple.object}`,
    };
  }
  if (triple.kind === OPENNESS_KIND) {
    const current = state?.openness?.get(triple.subject);
    const wantOpen = triple.object === "true";
    if (current && current.open === wantOpen) {
      return { toAppend: [], reason: `${triple.subject} is already ${wantOpen ? "open" : "closed"}` };
    }
    return { toAppend: [triple], reason: `${triple.subject} becomes ${wantOpen ? "open" : "closed"}` };
  }
  if (triple.kind === MASS_KIND) {
    const current = state?.masses?.get(triple.subject);
    if (current && Number(current.value) === Number(triple.object)) {
      return { toAppend: [], reason: `${triple.subject} already weighs ${triple.object}` };
    }
    return { toAppend: [triple], reason: `${triple.subject} weighs ${triple.object}` };
  }
  const key = tripleKey(triple);
  if (editableMudOtherRows(rows).some((r) => tripleKey(r) === key)) {
    return { toAppend: [], reason: `the world already says ${key}` };
  }
  return { toAppend: [triple], reason: `the world gains ${key}` };
}
