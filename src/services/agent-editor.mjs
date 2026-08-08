// agent-editor.mjs — the actor card's text<->fact bridge, mudiii's third
// sentence table. Modelled on mud-editor.mjs's four-part shape (render,
// parse, plan), but reading and writing a different, disjoint predicate set:
// the ten `AGENT_TRAIT_PREDICATES` agent-traits.mjs already resolves off a
// class chain, never the placement/openness/exit/dig vocabulary
// mud-editor.mjs owns and never the drive-knob teach sentences
// mudiii-turn.mjs's TOWN_SQUARE_TEACH_PATTERNS owns. Three tables, three
// disjoint predicate sets, said once here so the next predicate added to any
// one of them has an obvious place to go rather than a guess.
//
// Unlike mud-editor.mjs, this module is not spliced into a page script by
// `.toString()` — it leans on agent-traits.mjs's class-chain walk
// (classChainOf, traitOriginOf, traitValueOf, traitValuesOf), which closes
// over nothing a `.toString()` splice could carry, so the page reaches the
// render functions through the `window.tmct.page` bag instead, the same way
// it already reaches `agentTraitsOf`.
//
// `renderAgentEditorText`/`renderAgentClassText` take a SUBJECT — an
// instance id or a class name — and print only that subject's own rows,
// never the resolved (chain-walked) values a caller like `agentTraitsOf`
// would hand back. That is the whole point of a per-instance editor: what
// you see in the box is what the instance itself has, not what it inherits.
// `planAgentEditorSync` mirrors that discipline on the way back in — it
// only ever reads and writes rows whose subject is the one passed in, so an
// edit to `goblin-1` cannot touch `goblin-2` or the `goblin` class no matter
// what a pasted line happens to say.
import {
  AGENT_TRAIT_PREDICATES, AGENT_TRAIT_MULTI, classChainOf, classFactRowsFor,
  traitOriginOf, traitValueOf, traitValuesOf,
} from "../domain/agent-traits.mjs";

const LOW = (s) => String(s || "").trim().toLowerCase();

// The closed sentence table for AGENT_TRAIT_PREDICATES, checked in this
// order (irrelevant here since no two phrases overlap, but kept in
// AGENT_TRAIT_PREDICATES's own order for readability). One entry per
// predicate: `sentence` renders a row, `re` parses it back. `mgx:is-predator`
// carries no object group of its own — the sentence states only "true",
// mirroring mud-editor.mjs's TRUE_ONLY_FLAG_PREDICATES: a row saying "false"
// has no sentence here, so it is unrenderable and (by the same rule
// mud-editor.mjs states) undiffable too.
const AGENT_LINE_PATTERNS = [
  { predicate: "mgx:consumes", sentence: (s, o) => `${s} eats ${o}.`,
    re: /^(.+?)\s+eats\s+(.+?)\.?$/i },
  { predicate: "mgx:display-name", sentence: (s, o) => `${s} is called ${o}.`,
    re: /^(.+?)\s+is\s+called\s+(.+?)\.?$/i },
  { predicate: "mgx:evades", sentence: (s, o) => `${s} evades ${o}.`,
    re: /^(.+?)\s+evades\s+(.+?)\.?$/i },
  { predicate: "mgx:guards", sentence: (s, o) => `${s} guards ${o}.`,
    re: /^(.+?)\s+guards\s+(.+?)\.?$/i },
  { predicate: "mgx:hasMass", sentence: (s, o) => `${s} weighs ${o}.`,
    // The digit group is a real decimal, not a `[\d.]+` bag: that pattern's
    // trailing period would swallow the sentence's own full stop into the
    // captured number ("8." instead of "8") whenever nothing follows it.
    re: /^(.+?)\s+weighs\s+(\d+(?:\.\d+)?)\.?$/i },
  { predicate: "mgx:is-predator", sentence: (s) => `${s} is a predator.`,
    re: /^(.+?)\s+is\s+a\s+predator\.?$/i, flag: true },
  { predicate: "mgx:mass-drain-per-turn", sentence: (s, o) => `${s} loses ${o} each turn.`,
    re: /^(.+?)\s+loses\s+([\d.]+)\s+each\s+turn\.?$/i },
  { predicate: "mgx:model", sentence: (s, o) => `${s} looks like ${o}.`,
    re: /^(.+?)\s+looks\s+like\s+(.+?)\.?$/i },
  { predicate: "mgx:pursues", sentence: (s, o) => `${s} pursues ${o}.`,
    re: /^(.+?)\s+pursues\s+(.+?)\.?$/i },
  { predicate: "mgx:vision-radius", sentence: (s, o) => `${s} sees ${o} cells.`,
    re: /^(.+?)\s+sees\s+(\d+)\s+cells?\.?$/i },
];

const NUMERIC_PREDICATES = new Set(["mgx:hasMass", "mgx:mass-drain-per-turn", "mgx:vision-radius"]);

const patternFor = (predicate) => AGENT_LINE_PATTERNS.find((p) => p.predicate === predicate);

/** One row -> its sentence, or null when the predicate is not on this
 *  table's closed set, or when it is `mgx:is-predator` stated "false" (this
 *  table has no sentence for that direction, matching mud-editor.mjs's
 *  TRUE_ONLY_FLAG rule). Pure. */
export function agentTraitSentence(subject, predicate, object) {
  const pattern = patternFor(predicate);
  if (!pattern) return null;
  if (pattern.flag && object !== "true") return null;
  return pattern.sentence(subject, object);
}

// ---- rendering -----------------------------------------------------------

/** `subject`'s own trait rows (never a class's, never inherited values), as
 *  plain sentences, one per line, sorted by (predicate, object) — then a
 *  commented block naming what `subject` inherits and from where, read off
 *  `traitOriginOf`. A predicate no chain link declares is left out of both
 *  halves: an undeclared trait is a gap, never a line to render. The
 *  comment lines are never parsed back — `parseAgentEditorText` skips any
 *  line starting with "#" — so this half is free to be prose. Pure. */
export function renderAgentEditorText(rows, subject) {
  const ownRows = classFactRowsFor(rows, subject);
  const ownLines = ownRows
    .map((r) => agentTraitSentence(r.subject, r.predicate, r.object))
    .filter(Boolean);

  const nearestClass = classChainOf(rows, subject)[1] ?? null;
  const inheritedByClass = new Map();
  for (const predicate of AGENT_TRAIT_PREDICATES) {
    const origin = traitOriginOf(rows, subject, predicate);
    if (!origin || origin === "instance") continue;
    const values = AGENT_TRAIT_MULTI.has(predicate)
      ? traitValuesOf(rows, subject, predicate)
      : [traitValueOf(rows, subject, predicate)];
    if (!inheritedByClass.has(origin)) inheritedByClass.set(origin, []);
    for (const value of values) {
      const line = agentTraitSentence(origin, predicate, value);
      if (line) inheritedByClass.get(origin).push(line);
    }
  }

  const commentLines = [];
  if (inheritedByClass.size === 0) {
    if (nearestClass) {
      commentLines.push(`# inherited from ${nearestClass} (edit the class to change these for every ${nearestClass}):`);
      commentLines.push(`# ${nearestClass} has no other stated drives.`);
    }
  } else {
    for (const [className, lines] of inheritedByClass) {
      commentLines.push(`# inherited from ${className} (edit the class to change these for every ${className}):`);
      for (const line of lines) commentLines.push(`# ${line}`);
    }
  }

  return [...ownLines, "", ...commentLines].join("\n");
}

/** `className`'s own trait rows only — no ancestor's, no inherited-block
 *  footer. This is what the actor card's class tab shows: editing it writes
 *  to `className` itself, and R2's spawn is what carries a change onto the
 *  next instance minted from it, never onto one already standing. Pure. */
export function renderAgentClassText(rows, className) {
  return classFactRowsFor(rows, className)
    .map((r) => agentTraitSentence(r.subject, r.predicate, r.object))
    .filter(Boolean)
    .join("\n");
}

// ---- parsing ---------------------------------------------------------------

/** One line -> `{ subject, predicate, object }`, or null when nothing in
 *  the table recognizes it — an honest miss, never a guessed triple.
 *  `mgx:hasMass`/`mgx:mass-drain-per-turn`/`mgx:vision-radius` keep the
 *  digits verbatim (a number has no case to normalise); every other object
 *  is lower-cased, matching the lower-cased class and instance names every
 *  world in this repo is written in. Pure. */
export function parseAgentEditorLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  for (const pattern of AGENT_LINE_PATTERNS) {
    const m = trimmed.match(pattern.re);
    if (!m) continue;
    const subject = LOW(m[1]);
    if (!subject) continue;
    if (pattern.flag) return { subject, predicate: pattern.predicate, object: "true" };
    const object = NUMERIC_PREDICATES.has(pattern.predicate) ? m[2] : LOW(m[2]);
    if (!object) continue;
    return { subject, predicate: pattern.predicate, object };
  }
  return null;
}

/** Parse the whole actor textarea: every non-blank, non-comment line
 *  becomes a triple or lands in `unrecognized` (1-based line numbers, the
 *  original text — never silently dropped). A line starting with `#` is the
 *  inherited-block prose `renderAgentEditorText` prints; it is neither a
 *  triple nor an honest miss, it is simply not read. Pure. */
export function parseAgentEditorText(text) {
  const triples = [];
  const unrecognized = [];
  String(text || "").split("\n").forEach((raw, i) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parsed = parseAgentEditorLine(trimmed);
    if (parsed) triples.push(parsed);
    else unrecognized.push({ line: i + 1, text: raw });
  });
  return { triples, unrecognized };
}

// ---- sync planning ---------------------------------------------------------

const tripleKey = (t) => `${t.subject} ${t.predicate} ${t.object}`;

/** Plan the fact-store writes one actor edit implies, from already-parsed
 *  `triples` against `rows`. Scoped to `subject` in both directions: any
 *  parsed triple whose own subject is not `subject` is ignored outright
 *  (never appended, never used to keep an existing row alive), and only
 *  `subject`'s own current trait rows are ever candidates for retraction.
 *  That is what makes "editing an instance touches only that instance"
 *  true even of a line a visitor typed under someone else's name by
 *  mistake. Returns `{ toAppend, toRemoveIds }` — pure, no I/O. The caller
 *  decides whether `toRemoveIds` is safe to apply, and must skip it
 *  whenever the parse reported any unrecognized line, the same guard
 *  `planMudEditorSync`'s own caller holds. */
export function planAgentEditorSync(rows, subject, triples) {
  const relevant = (triples || []).filter((t) => t.subject === subject);
  const currentRows = (rows || [])
    .filter((r) => r.subject === subject && AGENT_TRAIT_PREDICATES.includes(r.predicate));
  const currentKeys = new Map(currentRows.map((r) => [tripleKey(r), r.id]));

  const newKeys = new Set();
  const toAppend = [];
  for (const t of relevant) {
    const key = tripleKey(t);
    if (newKeys.has(key)) continue;
    newKeys.add(key);
    if (!currentKeys.has(key)) toAppend.push(t);
  }
  const toRemoveIds = [];
  for (const [key, id] of currentKeys) {
    if (!newKeys.has(key)) toRemoveIds.push(id);
  }
  return { toAppend, toRemoveIds };
}
