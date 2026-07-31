// adventure-editor.mjs — the world editor's text<->fact bridge
// (PLAN_GAMES_UPLIFT_V3.md Part C.4 item 4's operator addendum): a small,
// closed-vocabulary sentence renderer/parser purpose-built for the adventure
// world's own predicate vocabulary, invertible by construction — every
// phrase this module renders has exactly one parser rule that reads it back
// to the same triple. This is deliberately NOT chat.mjs's teachLane/TEACH_RE
// (open-domain natural-language teaching, guarded against questions/typos/
// discourse markers that would fight a structured per-line textarea parse).
// A purpose-built parser mirroring worldDigestRows' own small phrase table
// (adventure.mjs) is the right size for this job — extended to also
// round-trip the puzzle/openness facts worldDigestRows itself deliberately
// hides from the player-facing "look" digest (mgx:is-open, mgx:hidden-in,
// mgx:is-container, mgx:unlocks-with, mgx:is-npc, mgx:acts-on-turn,
// mgx:acts-toward, mgx:is-objective) — an editor has to show and change
// exactly the facts a player is never told.
//
// No imports of its own logic: every export here is .toString()-splice-safe,
// the same discipline adventure-viz.mjs's own render-glue functions hold (see
// that module's header) — this module's functions get spliced directly into
// the adventure page's inline script the same way. The one exception,
// wordBeforeCursor, re-exports viz-theme.mjs's own shared copy (byte-identical
// to what used to live here, and to mud-editor.mjs's own copy) rather than
// keep a third copy of the same regex.
//
// Two predicate families get different sync strategies, on purpose:
//   - PLACEMENT/OPENNESS (mgx:currently-in/located-in/fixed-in/stands-
//     locked-in/hidden-in, mgx:is-open) are fold-versioned: foldWorldState
//     already treats the newest write as the current truth (adventure.mjs's
//     own "turn >= prior.turn" rule — the same mechanism every in-game
//     action's commit() already writes through). Editing one of these facts
//     is handled as a plain new write superseding the old one, never a
//     retraction, so planWorldEditorSync can never touch memory/core.mjs's
//     own removeFacts for this family, and can never race the fold logic the
//     rest of the engine depends on. One consequence, stated plainly: this
//     editor can move an object or reopen/close a container, but it cannot
//     make a placed object vanish outright — the append-only truth model has
//     no way to write "nowhere" — a scope choice, not a defect.
//   - Everything else (rdf:type, mgx:has-exit-*, and the container/puzzle
//     family) is NOT fold-versioned: the engine reads these as raw first-
//     or any-match facts (isTyped, factObjects, the exits Map), so changing
//     one genuinely needs the OLD fact retracted, not just a newer one
//     appended alongside it. planWorldEditorSync computes a real add/remove
//     diff for this family — but the caller only ever applies the removals
//     once parseWorldEditorText's own unrecognized-line count is zero: a
//     line that fails to parse this keystroke must never be read as "this
//     fact is gone", so every removal stays pending until the whole
//     document parses cleanly again. Additions are never gated this way —
//     they are non-destructive by construction.

const PLACEMENT_KIND = "placement";
const OPENNESS_KIND = "openness";
const OTHER_KIND = "other";

const LOW = (s) => String(s || "").trim().toLowerCase();

/** parseWorldEditorText's own type map: which subject is typed person/
 *  adventurer, the "mover" class the generic "X is in the Y." parse needs to
 *  pick currently-in vs located-in — renderWorldEditorText keeps its own
 *  local copy of this same lookup (see that function's own header for why:
 *  it has to stay fully self-contained for `.toString()` splicing). Built
 *  once per parse call from whatever rdf:type facts are visible (the raw
 *  rows the caller hands in, unioned with any "is a/an <class>." lines the
 *  SAME text also asserts, so a freshly-typed-in-this-edit class still
 *  disambiguates its own placement line in the same pass). */
function typeMapFrom(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (r?.predicate === "rdf:type" && r.subject && r.object) m.set(LOW(r.subject), LOW(r.object));
  }
  return m;
}

const MOVER_CLASSES = new Set(["person", "adventurer"]);

// ---- rendering ---------------------------------------------------------------

const EXIT_PREDICATE_RE = /^mgx:has-exit-([a-z]+)$/;
const SNAPSHOT_RE = /^(.+)@turn(\d+)$/;

/** The whole world's editable facts as plain sentences, one per line, sorted
 *  by (subject, predicate, object) for a deterministic, reviewable diff
 *  between edits. Placement/openness come from the FOLDED state (`state`);
 *  everything else (type, exits, container/puzzle) comes from the raw rows,
 *  skipping @turnN snapshot subjects — those never carry their own type/exit/
 *  puzzle facts, only placement/openness overrides the fold already reads.
 *
 *  Deliberately self-contained (its own local CAP/LOW/typePhrase/
 *  MOVER_CLASSES/regex copies, duplicating this module's own top-level
 *  ones) rather than calling the module's private renderPlacementLine/
 *  typeMapFrom helpers: this function gets spliced into the adventure page's
 *  inline script via `.toString()` (adventure-viz.mjs's own render-glue
 *  discipline — see that module's header), which captures only the
 *  function's own source text, never its closure over sibling module-level
 *  bindings. A splice-safe function's ENTIRE dependency graph has to live
 *  inside its own body. */
export function renderWorldEditorText(rows, state) {
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const low = (s) => String(s || "").trim().toLowerCase();
  const typePhraseFor = (object) => (/^[aeiou]/i.test(object) ? "is an" : "is a");
  const moverClasses = new Set(["person", "adventurer"]);
  const exitRe = /^mgx:has-exit-([a-z]+)$/;
  const snapshotRe = /^(.+)@turn(\d+)$/;
  const types = new Map();
  for (const r of rows || []) {
    if (r?.predicate === "rdf:type" && r.subject && r.object) types.set(low(r.subject), low(r.object));
  }
  const placementLine = (subject, place) => {
    if (place.predicate === "mgx:located-in") {
      if (place.object === "player") return `Player carries the ${subject}.`;
      const holderType = types.get(low(place.object));
      if (holderType && moverClasses.has(holderType)) return `${cap(place.object)} carries the ${subject}.`;
      return `${cap(subject)} is in the ${place.object}.`;
    }
    const verb = {
      "mgx:currently-in": "is currently in the",
      "mgx:fixed-in": "is fixed in the",
      "mgx:stands-locked-in": "stands locked in the",
      "mgx:hidden-in": "is hidden in the",
    }[place.predicate];
    return verb ? `${cap(subject)} ${verb} ${place.object}.` : null;
  };

  const lines = [];
  for (const [subject, place] of state.placements || new Map()) {
    const line = placementLine(subject, place);
    if (line) lines.push({ key: [subject, place.predicate, place.object].join(" "), text: line });
  }
  for (const [subject, openness] of state.openness || new Map()) {
    const text = openness.open ? `${cap(subject)} is open.` : `${cap(subject)} is closed.`;
    lines.push({ key: [subject, "mgx:is-open", String(openness.open)].join(" "), text });
  }
  for (const row of rows || []) {
    if (snapshotRe.test(row.subject)) continue; // a turn snapshot never carries its own type/exit/puzzle fact
    const exit = exitRe.exec(row.predicate);
    if (exit) {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} has an exit ${exit[1]} to the ${row.object}.` });
      continue;
    }
    if (row.predicate === "rdf:type") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} ${typePhraseFor(row.object)} ${row.object}.` });
      continue;
    }
    if (row.predicate === "mgx:is-container" && row.object === "true") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} is a container.` });
      continue;
    }
    if (row.predicate === "mgx:is-npc" && row.object === "true") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} is a character in the story.` });
      continue;
    }
    if (row.predicate === "mgx:is-objective" && row.object === "true") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} is the objective.` });
      continue;
    }
    if (row.predicate === "mgx:unlocks-with") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} unlocks with the ${row.object}.` });
      continue;
    }
    if (row.predicate === "mgx:acts-on-turn") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} acts on turn ${row.object}.` });
      continue;
    }
    if (row.predicate === "mgx:acts-toward") {
      lines.push({ key: [row.subject, row.predicate, row.object].join(" "), text: `${cap(row.subject)} acts toward the ${row.object}.` });
      continue;
    }
  }
  const seen = new Set();
  const deduped = lines.filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)));
  deduped.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return deduped.map((l) => l.text).join("\n");
}

// ---- parsing -------------------------------------------------------------

// Checked in this exact order, first match wins — every entry's phrase text
// is unambiguous against every OTHER entry's (verified in
// test/services/adventure-editor.test.mjs), so ordering only matters against
// the two generic fallbacks at the very end (`is in the` / `is a/an <class>`,
// which a specific phrase like "is a container." would otherwise also match).
const LINE_PATTERNS = [
  { kind: OTHER_KIND, re: /^(.+?)\s+carries\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[2]), predicate: "mgx:located-in", object: LOW(m[1]) }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+hidden\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:hidden-in", object: LOW(m[2]) }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+fixed\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:fixed-in", object: LOW(m[2]) }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+stands\s+locked\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:stands-locked-in", object: LOW(m[2]) }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+currently\s+in\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:currently-in", object: LOW(m[2]) }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+has\s+an\s+exit\s+(\w+)\s+to\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: `mgx:has-exit-${LOW(m[2])}`, object: LOW(m[3]) }) },
  { kind: OPENNESS_KIND, re: /^(.+?)\s+is\s+open\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-open", object: "true" }) },
  { kind: OPENNESS_KIND, re: /^(.+?)\s+is\s+closed\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-open", object: "false" }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+a\s+container\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-container", object: "true" }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+a\s+character\s+in\s+the\s+story\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-npc", object: "true" }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+the\s+objective\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:is-objective", object: "true" }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+unlocks\s+with\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:unlocks-with", object: LOW(m[2]) }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+acts\s+on\s+turn\s+(\d+)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:acts-on-turn", object: m[2] }) },
  { kind: OTHER_KIND, re: /^(.+?)\s+acts\s+toward\s+the\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "mgx:acts-toward", object: LOW(m[2]) }) },
  // The two generic fallbacks — tried last, on purpose: every phrase above is
  // a literal-text special case one of these two patterns would ALSO match
  // ("is a container." is a valid "is a <class>." sentence too), so only
  // once nothing more specific matched does a bare placement/type reading win.
  { kind: PLACEMENT_KIND, re: /^(.+?)\s+is\s+in\s+the\s+(.+?)\.?$/i,
    build: (m, types) => {
      const t = types.get(LOW(m[1]));
      return { subject: LOW(m[1]), predicate: t && MOVER_CLASSES.has(t) ? "mgx:currently-in" : "mgx:located-in", object: LOW(m[2]) };
    } },
  { kind: OTHER_KIND, re: /^(.+?)\s+is\s+an?\s+(.+?)\.?$/i,
    build: (m) => ({ subject: LOW(m[1]), predicate: "rdf:type", object: LOW(m[2]) }) },
];

// A parsed placement/openness triple carries its own predicate family tag so
// planWorldEditorSync can route it to the "append, never retract" path
// without re-deriving the family from the predicate string a second time.
const PLACEMENT_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:stands-locked-in", "mgx:hidden-in",
]);

/** One line -> `{ subject, predicate, object, kind }` or null when nothing in
 *  LINE_PATTERNS recognizes it — an honest miss, never a guessed shape.
 *  `types` (typeMapFrom's own map) disambiguates the one truly generic
 *  placement phrase ("X is in the Y.") between mgx:currently-in (a person/
 *  adventurer standing in a room) and mgx:located-in (a portable resting or
 *  carried) the exact way adventure.mjs's own world data always distinguishes
 *  them. */
export function parseEditorLine(line, types) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  for (const pattern of LINE_PATTERNS) {
    const m = trimmed.match(pattern.re);
    if (!m) continue;
    const triple = pattern.build(m, types);
    if (!triple.subject || !triple.object) continue;
    const kind = triple.predicate === "mgx:is-open" ? OPENNESS_KIND
      : PLACEMENT_PREDICATES.has(triple.predicate) ? PLACEMENT_KIND : OTHER_KIND;
    return { ...triple, kind };
  }
  return null;
}

/** Parse the whole editor textarea: every non-blank line either becomes a
 *  triple or lands in `unrecognized` (1-based line numbers, honest — the
 *  original text, never silently dropped). `contextRows` seeds the type map
 *  parseEditorLine's placement disambiguation reads; the text's OWN "is a/an
 *  <class>." lines are folded in too, so a class freshly typed in this same
 *  edit still disambiguates a placement line elsewhere in the same pass. */
export function parseWorldEditorText(text, contextRows = []) {
  const rawLines = String(text || "").split("\n");
  const firstPassTypes = typeMapFrom(contextRows);
  // Pass 1: collect every "is a/an <class>." this text itself asserts, so a
  // type declared and used in the SAME edit still resolves correctly.
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(.+?)\s+is\s+an?\s+(.+?)\.?$/i);
    if (m && !/\bcontainer\.?$/i.test(trimmed) && !/\bcharacter in the story\.?$/i.test(trimmed)) {
      firstPassTypes.set(LOW(m[1]), LOW(m[2]));
    }
  }
  const triples = [];
  const unrecognized = [];
  rawLines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = parseEditorLine(trimmed, firstPassTypes);
    if (parsed) triples.push(parsed);
    else unrecognized.push({ line: i + 1, text: raw });
  });
  return { triples, unrecognized };
}

// ---- sync planning ---------------------------------------------------------

const tripleKey = (t) => `${t.subject} ${t.predicate} ${t.object}`;

// The three flag predicates the renderer only ever writes a line for when they
// read "true" ("Basket is a container."). A row saying "false" has no sentence
// in this vocabulary, so it must not be diffable either — counted as editable
// while being unrenderable, it sits in the diff's current set, matches nothing
// the text can say, and gets retracted on the next clean parse: a fact the
// player never saw, silently deleted by an edit somewhere else in the document.
const TRUE_ONLY_FLAG_PREDICATES = ["mgx:is-container", "mgx:is-npc", "mgx:is-objective"];

/** Every raw fact row this editor's "other" family (type/exits/container/
 *  puzzle — never placement/openness) is allowed to touch — the closed set
 *  planWorldEditorSync diffs against and the only rows a removal can ever
 *  target. Skips @turnN snapshot subjects, mirroring the renderer. */
export function editableOtherRows(rows) {
  return (rows || []).filter((r) => {
    if (SNAPSHOT_RE.test(r.subject)) return false;
    if (r.predicate === "rdf:type") return true;
    if (EXIT_PREDICATE_RE.test(r.predicate)) return true;
    if (TRUE_ONLY_FLAG_PREDICATES.includes(r.predicate)) return r.object === "true";
    return ["mgx:unlocks-with", "mgx:acts-on-turn", "mgx:acts-toward"].includes(r.predicate);
  });
}

/** Plan the fact-store writes one parsed edit implies, from already-parsed
 *  `triples` (parseWorldEditorText's own output) against the world's current
 *  `rows`/`state`. Returns `{ toAppend, toRemoveIds }` — pure, no I/O.
 *
 *  Placement/openness triples are NEVER retracted (see this module's own
 *  header): a triple only joins `toAppend` when it actually differs from the
 *  subject's current folded value (or the subject has none yet) — otherwise
 *  re-asserting an unchanged line would append a no-op duplicate on every
 *  keystroke.
 *
 *  "Other"-family triples (type/exits/container/puzzle) get a real add/
 *  remove diff against `editableOtherRows(rows)` — but the CALLER decides
 *  whether `toRemoveIds` is safe to apply (skip it whenever
 *  parseWorldEditorText reported any unrecognized line — see this module's
 *  header for why). */
export function planWorldEditorSync(rows, state, triples) {
  const toAppend = [];
  const seenPlacementSubjects = new Set();
  const otherTriples = [];
  // Placement/openness: last occurrence per subject wins (mirrors how a
  // human reads a document top-to-bottom and treats a later line as the
  // correction of an earlier one about the same thing).
  for (const t of [...(triples || [])].reverse()) {
    if (t.kind === OTHER_KIND) { otherTriples.push(t); continue; }
    if (seenPlacementSubjects.has(t.subject)) continue;
    seenPlacementSubjects.add(t.subject);
    if (t.kind === PLACEMENT_KIND) {
      const current = state.placements?.get(t.subject);
      if (!current || current.predicate !== t.predicate || current.object !== t.object) toAppend.push(t);
    } else if (t.kind === OPENNESS_KIND) {
      const current = state.openness?.get(t.subject);
      const wantOpen = t.object === "true";
      if (!current || current.open !== wantOpen) toAppend.push(t);
    }
  }

  const currentOther = editableOtherRows(rows);
  const currentKeys = new Map(currentOther.map((r) => [tripleKey(r), r.id]));
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

// ---- cursor-driven suggestions ---------------------------------------------

export { wordBeforeCursor } from "./viz-theme.mjs";
