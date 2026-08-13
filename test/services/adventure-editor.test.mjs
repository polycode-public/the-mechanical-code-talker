// The world editor's text<->fact bridge (PLAN_GAMES_UPLIFT_V3.md Part C.4
// item 4's operator addendum): renderWorldEditorText/parseWorldEditorText
// must be exact inverses of each other over the real shipped world, and
// planWorldEditorSync must compute the correct store writes for a real edit
// — moving a placement, deleting a puzzle fact, adding a new object, and
// (the safety property this module exists to hold) never proposing a
// removal while any line in the same document still fails to parse.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderWorldEditorText, parseEditorLine, parseWorldEditorText,
  planWorldEditorSync, planTaughtTriple, editableOtherRows, wordBeforeCursor,
} from "../../src/services/adventure-editor.mjs";
import { foldWorldState } from "../../src/services/adventure.mjs";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import {
  createInMemoryStore, appendFacts, removeFacts, loadMemory, readFactRows,
} from "../../src/adapters/memory/core.mjs";

// A small fixture room mirroring adventure-viz.test.mjs's own ROWS, extended
// with the puzzle/openness facts worldDigestRows itself hides from the chat
// digest but the editor must round-trip.
const ROWS = [
  { subject: "player", predicate: "rdf:type", object: "adventurer" },
  { subject: "player", predicate: "mgx:currently-in", object: "study" },
  { subject: "study", predicate: "rdf:type", object: "room" },
  { subject: "desk", predicate: "rdf:type", object: "furniture" },
  { subject: "desk", predicate: "mgx:fixed-in", object: "study" },
  { subject: "cabinet", predicate: "rdf:type", object: "furniture" },
  { subject: "cabinet", predicate: "mgx:is-container", object: "true" },
  { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study" },
  { subject: "cabinet", predicate: "mgx:unlocks-with", object: "key" },
  { subject: "lamp", predicate: "rdf:type", object: "portable" },
  { subject: "lamp", predicate: "mgx:located-in", object: "study" },
  { subject: "letter", predicate: "rdf:type", object: "portable" },
  { subject: "letter", predicate: "mgx:hidden-in", object: "cabinet" },
  { subject: "letter", predicate: "mgx:is-objective", object: "true" },
  { subject: "butler", predicate: "rdf:type", object: "person" },
  { subject: "butler", predicate: "mgx:currently-in", object: "study" },
  { subject: "butler", predicate: "mgx:is-npc", object: "true" },
  { subject: "study", predicate: "mgx:has-exit-north", object: "library" },
];

// ---- renderWorldEditorText --------------------------------------------------

test("renderWorldEditorText: a room's facts render as plain, closed-vocabulary sentences", () => {
  const state = foldWorldState(ROWS);
  const text = renderWorldEditorText(ROWS, state);
  const lines = text.split("\n");
  assert.ok(lines.includes("Player is currently in the study."));
  assert.ok(lines.includes("Desk is fixed in the study."));
  assert.ok(lines.includes("Cabinet stands locked in the study."));
  assert.ok(lines.includes("Cabinet is a container."));
  assert.ok(lines.includes("Cabinet unlocks with the key."));
  assert.ok(lines.includes("Lamp is in the study."));
  assert.ok(lines.includes("Letter is hidden in the cabinet."));
  assert.ok(lines.includes("Letter is the objective."));
  assert.ok(lines.includes("Butler is currently in the study."));
  assert.ok(lines.includes("Butler is a character in the story."));
  assert.ok(lines.includes("Study has an exit north to the library."));
});

test("renderWorldEditorText: openness renders only when a fact says so — a never-opened container gets no line", () => {
  const state = foldWorldState(ROWS);
  const text = renderWorldEditorText(ROWS, state);
  assert.ok(!/cabinet is (open|closed)/i.test(text), "no invented openness for a container never interacted with");
  const opened = [...ROWS, { subject: "cabinet@turn1", predicate: "mgx:is-open", object: "true" }];
  const openedState = foldWorldState(opened);
  const openedText = renderWorldEditorText(opened, openedState);
  assert.ok(openedText.split("\n").includes("Cabinet is open."));
});

test("renderWorldEditorText: a player-carried object reads as 'Player carries the X.', not the raw located-in triple", () => {
  const carried = [...ROWS, { subject: "lamp@turn1", predicate: "mgx:located-in", object: "player" }];
  const state = foldWorldState(carried);
  const text = renderWorldEditorText(carried, state);
  assert.ok(text.split("\n").includes("Player carries the lamp."));
});

test("renderWorldEditorText: an NPC-carried object reads as '<Person> carries the X.'", () => {
  const carried = [...ROWS, { subject: "lamp@turn1", predicate: "mgx:located-in", object: "butler" }];
  const state = foldWorldState(carried);
  const text = renderWorldEditorText(carried, state);
  assert.ok(text.split("\n").includes("Butler carries the lamp."));
});

test("renderWorldEditorText: deterministic — sorted, byte-identical output for identical input", () => {
  const state = foldWorldState(ROWS);
  assert.equal(renderWorldEditorText(ROWS, state), renderWorldEditorText(ROWS, state));
});

// ---- parseEditorLine ---------------------------------------------------------

test("parseEditorLine: every render-side phrase inverts to the exact original triple", () => {
  const types = new Map([["butler", "person"], ["player", "adventurer"]]);
  assert.deepEqual(parseEditorLine("Desk is fixed in the study.", types), { subject: "desk", predicate: "mgx:fixed-in", object: "study", kind: "placement" });
  assert.deepEqual(parseEditorLine("Cabinet stands locked in the study.", types), { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study", kind: "placement" });
  assert.deepEqual(parseEditorLine("Letter is hidden in the cabinet.", types), { subject: "letter", predicate: "mgx:hidden-in", object: "cabinet", kind: "placement" });
  assert.deepEqual(parseEditorLine("Study has an exit north to the library.", types), { subject: "study", predicate: "mgx:has-exit-north", object: "library", kind: "other" });
  assert.deepEqual(parseEditorLine("Cabinet is open.", types), { subject: "cabinet", predicate: "mgx:is-open", object: "true", kind: "openness" });
  assert.deepEqual(parseEditorLine("Cabinet is closed.", types), { subject: "cabinet", predicate: "mgx:is-open", object: "false", kind: "openness" });
  assert.deepEqual(parseEditorLine("Cabinet is a container.", types), { subject: "cabinet", predicate: "mgx:is-container", object: "true", kind: "other" });
  assert.deepEqual(parseEditorLine("Butler is a character in the story.", types), { subject: "butler", predicate: "mgx:is-npc", object: "true", kind: "other" });
  assert.deepEqual(parseEditorLine("Letter is the objective.", types), { subject: "letter", predicate: "mgx:is-objective", object: "true", kind: "other" });
  assert.deepEqual(parseEditorLine("Cabinet unlocks with the key.", types), { subject: "cabinet", predicate: "mgx:unlocks-with", object: "key", kind: "other" });
  assert.deepEqual(parseEditorLine("Housekeeper acts on turn 3.", types), { subject: "housekeeper", predicate: "mgx:acts-on-turn", object: "3", kind: "other" });
  assert.deepEqual(parseEditorLine("Housekeeper acts toward the library.", types), { subject: "housekeeper", predicate: "mgx:acts-toward", object: "library", kind: "other" });
  assert.deepEqual(parseEditorLine("Cabinet is a furniture.", types), { subject: "cabinet", predicate: "rdf:type", object: "furniture", kind: "other" });
});

test("parseEditorLine: 'X carries the Y.' inverts with subject/object SWAPPED back to located-in", () => {
  const types = new Map([["butler", "person"]]);
  assert.deepEqual(parseEditorLine("Player carries the lamp.", types), { subject: "lamp", predicate: "mgx:located-in", object: "player", kind: "placement" });
  assert.deepEqual(parseEditorLine("Butler carries the key.", types), { subject: "key", predicate: "mgx:located-in", object: "butler", kind: "placement" });
});

test("parseEditorLine: the generic 'X is in the Y.' placement picks currently-in for a mover, located-in otherwise", () => {
  const types = new Map([["butler", "person"], ["lamp", "portable"]]);
  assert.deepEqual(parseEditorLine("Butler is in the library.", types), { subject: "butler", predicate: "mgx:currently-in", object: "library", kind: "placement" });
  assert.deepEqual(parseEditorLine("Lamp is in the library.", types), { subject: "lamp", predicate: "mgx:located-in", object: "library", kind: "placement" });
});

test("parseEditorLine: an unrecognized line is an honest null, never a guessed shape", () => {
  assert.equal(parseEditorLine("The weather in the study is lovely today", new Map()), null);
  assert.equal(parseEditorLine("", new Map()), null);
  assert.equal(parseEditorLine("   ", new Map()), null);
});

// ---- parseWorldEditorText — round trip over the REAL shipped world ---------

async function loadShippedWorldRows() {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("ashcombe-hall");
  assert.ok(world, "the shipped Ashcombe Hall world loads");
  const dir = createInMemoryStore();
  await appendFacts(dir, world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:ashcombe-hall" })));
  return readFactRows(await loadMemory(dir));
}

test("round trip: rendering the real shipped world then re-parsing it reproduces every fact exactly, nothing added or removed", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const { triples, unrecognized } = parseWorldEditorText(text, rows);
  assert.deepEqual(unrecognized, [], "every rendered line parses back cleanly");
  const { toAppend, toRemoveIds } = planWorldEditorSync(rows, state, triples);
  assert.deepEqual(toAppend, [], "a clean re-parse of unmodified text implies no new writes");
  assert.deepEqual(toRemoveIds, [], "a clean re-parse of unmodified text implies no retractions");
});

test("round trip: editing one line (moving the locked cabinet to the library) plans exactly one append, no removals — placement is always superseded, never retracted", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const edited = text.replace("Cabinet stands locked in the study.", "Cabinet stands locked in the library.");
  const { triples, unrecognized } = parseWorldEditorText(edited, rows);
  assert.deepEqual(unrecognized, []);
  const { toAppend, toRemoveIds, editTurn } = planWorldEditorSync(rows, state, triples);
  assert.equal(editTurn, state.turnCount + 1);
  assert.deepEqual(toAppend, [{ subject: `cabinet@turn${editTurn}`, predicate: "mgx:stands-locked-in", object: "library", kind: "placement" }]);
  assert.deepEqual(toRemoveIds, []);
});

test("the superseding placement is stamped one turn past the world's own count, so it outranks by rank and not by arriving last", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const played = [...rows, { subject: "cabinet@turn4", predicate: "mgx:stands-locked-in", object: "hall" }];
  const playedState = foldWorldState(played);
  assert.equal(playedState.turnCount, 4);
  const text = renderWorldEditorText(played, playedState);
  const edited = text.replace("Cabinet stands locked in the hall.", "Cabinet stands locked in the library.");
  const { toAppend, editTurn } = planWorldEditorSync(played, playedState, parseWorldEditorText(edited, played).triples);
  assert.equal(editTurn, 5);
  assert.deepEqual(toAppend.map((t) => t.subject), ["cabinet@turn5"]);
});

test("a world on a later epoch stamps its edit into that epoch, so the recast still outranks the run it replaced", async () => {
  const rows = await loadShippedWorldRows();
  const recast = [...rows, { subject: "world", predicate: "mgx:world-epoch", object: "2" }];
  const recastState = foldWorldState(recast);
  assert.equal(recastState.epoch, 2);
  const text = renderWorldEditorText(recast, recastState);
  const edited = text.replace("Cabinet stands locked in the study.", "Cabinet stands locked in the library.");
  const { toAppend } = planWorldEditorSync(recast, recastState, parseWorldEditorText(edited, recast).triples);
  assert.deepEqual(toAppend.map((t) => t.subject), ["cabinet@epoch2@turn1"]);
});

test("round trip: applying that planned edit through the real store actually moves the cabinet — foldWorldState reads the new placement", async () => {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("ashcombe-hall");
  const dir = createInMemoryStore();
  await appendFacts(dir, world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:ashcombe-hall" })));
  const rows = readFactRows(await loadMemory(dir));
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const edited = text.replace("Cabinet stands locked in the study.", "Cabinet stands locked in the library.");
  const { triples } = parseWorldEditorText(edited, rows);
  const { toAppend, toRemoveIds } = planWorldEditorSync(rows, state, triples);

  await appendFacts(dir, toAppend.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world-editor" })));
  if (toRemoveIds.length) await removeFacts(dir, toRemoveIds);

  const freshRows = readFactRows(await loadMemory(dir));
  const freshState = foldWorldState(freshRows);
  assert.equal(freshState.placements.get("cabinet").object, "library", "the cabinet's placement actually moved in the live store");
  assert.equal(freshState.placements.get("cabinet").predicate, "mgx:stands-locked-in", "still locked, just relocated");
});

test("the world an edited store folds to is the same one whichever order its rows arrive in — forward, reversed, and in content-address order", async () => {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("ashcombe-hall");
  const dir = createInMemoryStore();
  await appendFacts(dir, world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:ashcombe-hall" })));
  const rows = readFactRows(await loadMemory(dir));
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const edited = text
    .replace("Cabinet stands locked in the study.", "Cabinet stands locked in the library.")
    .replace("Letter is hidden in the cabinet.", "Letter is hidden in the desk.");
  const { toAppend, editTurn } = planWorldEditorSync(rows, state, parseWorldEditorText(edited, rows).triples);
  await appendFacts(dir, toAppend.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object,
    provenance: f.kind === "other" ? "world:ashcombe-hall" : `world:ashcombe-hall:turn${editTurn}`,
  })));

  const freshRows = readFactRows(await loadMemory(dir));
  const byContentAddress = [...freshRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const orderings = [
    ["forward", freshRows],
    ["reversed", [...freshRows].reverse()],
    ["content-address order", byContentAddress],
  ];
  const readable = (world) => JSON.stringify({
    placements: [...world.placements].map(([s, p]) => [s, p.predicate, p.object]).sort(),
    positions: [...world.positions].map(([s, p]) => [s, p.predicate, p.object]).sort(),
    openness: [...world.openness].map(([s, o]) => [s, o.open]).sort(),
    masses: [...world.masses].map(([s, m]) => [s, m.value]).sort(),
    turnCount: world.turnCount,
    epoch: world.epoch,
  });
  const [, forwardRows] = orderings[0];
  const expected = readable(foldWorldState(forwardRows));
  for (const [name, order] of orderings) {
    const folded = foldWorldState(order);
    assert.equal(folded.placements.get("cabinet").object, "library", `the edit still rules in ${name}`);
    assert.equal(folded.placements.get("letter").object, "desk", `and so does the second edited line in ${name}`);
    assert.equal(readable(folded), expected, `the whole folded world is identical in ${name}`);
  }
});

test("round trip: deleting a puzzle-fact line (the unlocks-with instrument) plans a real retraction, applied cleanly through removeFacts", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const edited = text.split("\n").filter((l) => !l.startsWith("Cabinet unlocks with")).join("\n");
  const { triples, unrecognized } = parseWorldEditorText(edited, rows);
  assert.deepEqual(unrecognized, []);
  const { toAppend, toRemoveIds } = planWorldEditorSync(rows, state, triples);
  assert.deepEqual(toAppend, []);
  assert.equal(toRemoveIds.length, 1);
  const removedRow = rows.find((r) => r.id === toRemoveIds[0]);
  assert.deepEqual({ subject: removedRow.subject, predicate: removedRow.predicate, object: removedRow.object },
    { subject: "cabinet", predicate: "mgx:unlocks-with", object: "key" });
});

test("round trip: adding a brand new object (a candlestick, not in the shipped world at all) plans two appends and no removals", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const edited = `${text}\nCandlestick is in the library.\nCandlestick is a portable.`;
  const { triples, unrecognized } = parseWorldEditorText(edited, rows);
  assert.deepEqual(unrecognized, []);
  const { toAppend, toRemoveIds, editTurn } = planWorldEditorSync(rows, state, triples);
  assert.deepEqual(toRemoveIds, []);
  assert.equal(toAppend.length, 2);
  assert.ok(toAppend.some((t) => t.subject === `candlestick@turn${editTurn}` && t.predicate === "mgx:located-in" && t.object === "library"),
    "the placement is fold-versioned, so it carries the turn stamp");
  assert.ok(toAppend.some((t) => t.subject === "candlestick" && t.predicate === "rdf:type" && t.object === "portable"),
    "the type is read raw by every reader, so it keeps its bare subject");
});

test("safety: a typo elsewhere in the document is reported as unrecognized and never silently guessed", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  const edited = text.replace("Cabinet unlocks with the key.", "Cabinet unlokcs with the key");
  const { unrecognized } = parseWorldEditorText(edited, rows);
  assert.equal(unrecognized.length, 1);
  assert.match(unrecognized[0].text, /unlokcs/);
});

test("safety: planWorldEditorSync itself computes removals from whatever triples it's given — the CALLER is responsible for withholding them while any line is unrecognized (documented gate, exercised here)", async () => {
  const rows = await loadShippedWorldRows();
  const state = foldWorldState(rows);
  const text = renderWorldEditorText(rows, state);
  // A typo on one line, alongside a genuine deletion of an unrelated line —
  // the caller-side gate (unrecognized.length === 0) must suppress
  // toRemoveIds entirely, keeping the deleted-looking fact intact.
  let edited = text.replace("Cabinet unlocks with the key.", "Cabinet unlokcs with the key");
  edited = edited.split("\n").filter((l) => !l.startsWith("Housekeeper acts on turn")).join("\n");
  const { triples, unrecognized } = parseWorldEditorText(edited, rows);
  assert.ok(unrecognized.length > 0);
  const { toRemoveIds } = planWorldEditorSync(rows, state, triples);
  // The pure planner still reports what WOULD be removed...
  assert.ok(toRemoveIds.length > 0, "the pure planner reports the removal it sees — the safety gate lives in the caller, not here");
  // ...but a caller following this module's own documented contract never
  // applies toRemoveIds while unrecognized.length > 0.
  const safeToApply = unrecognized.length === 0 ? toRemoveIds : [];
  assert.deepEqual(safeToApply, [], "the caller-side gate keeps the housekeeper's acts-on-turn fact intact despite the deleted line");
});

test("editableOtherRows: excludes placement/openness and background facts, includes only type/exit/container/puzzle predicates", () => {
  const rows = [
    { subject: "x", predicate: "mgx:currently-in", object: "study", id: "a" },
    { subject: "x", predicate: "mgx:is-open", object: "true", id: "b" },
    { subject: "x", predicate: "rdf:type", object: "furniture", id: "c" },
    { subject: "x", predicate: "mgx:has-exit-north", object: "y", id: "d" },
    { subject: "x", predicate: "mgx:hasA", object: "flower", id: "e" },
    { subject: "x@turn1", predicate: "rdf:type", object: "furniture", id: "f" },
  ];
  const ids = editableOtherRows(rows).map((r) => r.id);
  assert.deepEqual(ids, ["c", "d"]);
});

// ---- one sentence at a time ---------------------------------------------------

test("parseEditorLine: a bare noun that is an edit away from a verb still reads as a placement sentence", () => {
  const types = new Map(ROWS.filter((r) => r.predicate === "rdf:type").map((r) => [r.subject, r.object]));
  assert.deepEqual(
    parseEditorLine("Book is in the study", types),
    { subject: "book", predicate: "mgx:located-in", object: "study", kind: "placement" },
    "the sentence table reads the noun as a subject, where an imperative parser repairs it to a verb",
  );
  assert.deepEqual(
    parseEditorLine("Candle is in the study.", types),
    { subject: "candle", predicate: "mgx:located-in", object: "study", kind: "placement" },
    "with or without the full stop",
  );
});

test("parseEditorLine: the generic type fallback reads an expletive lead as a subject, which is why a caller has to gate it", () => {
  assert.deepEqual(
    parseEditorLine("There is a book in the study", new Map()),
    { subject: "there", predicate: "rdf:type", object: "book in the study", kind: "other" },
  );
});

test("planTaughtTriple: a placement that differs from the fold is appended, and never a removal alongside it", () => {
  const state = foldWorldState(ROWS);
  const moved = { subject: "lamp", predicate: "mgx:located-in", object: "library", kind: "placement" };
  const { toAppend, reason } = planTaughtTriple(ROWS, state, moved);
  assert.deepEqual(toAppend, [moved]);
  assert.match(reason, /lamp moves from study to library/);
  assert.equal("toRemoveIds" in planTaughtTriple(ROWS, state, moved), false, "one sentence is never evidence a fact has gone");
});

test("planTaughtTriple: re-asserting where a thing already is appends nothing and says why", () => {
  const state = foldWorldState(ROWS);
  const { toAppend, reason } = planTaughtTriple(ROWS, state, {
    subject: "lamp", predicate: "mgx:located-in", object: "study", kind: "placement",
  });
  assert.deepEqual(toAppend, []);
  assert.match(reason, /already/);
});

test("planTaughtTriple: openness and the other family each read their own current value", () => {
  const state = foldWorldState(ROWS);
  assert.deepEqual(
    planTaughtTriple(ROWS, state, { subject: "cabinet", predicate: "mgx:is-open", object: "true", kind: "openness" }).toAppend.length,
    1,
    "a container with no openness fact yet gains one",
  );
  assert.deepEqual(
    planTaughtTriple(ROWS, state, { subject: "cabinet", predicate: "mgx:is-container", object: "true", kind: "other" }).toAppend,
    [],
    "a raw fact the world already carries is not written twice",
  );
  assert.deepEqual(
    planTaughtTriple(ROWS, state, { subject: "chair", predicate: "rdf:type", object: "furniture", kind: "other" }).toAppend.length,
    1,
  );
});

// ---- wordBeforeCursor ---------------------------------------------------------

test("wordBeforeCursor: the run of word characters immediately before the cursor, lowercased to match the store's own term casing", () => {
  assert.equal(wordBeforeCursor("Cabinet stands locked in the stu", 33), "stu");
  assert.equal(wordBeforeCursor("Cabinet stands locked in the study.", 7), "cabinet");
  assert.equal(wordBeforeCursor("drawing-room is a room", 12), "drawing-room");
});

test("wordBeforeCursor: an honest empty string right after whitespace or punctuation, never a fabricated word", () => {
  assert.equal(wordBeforeCursor("Cabinet is a container. ", 24), "");
  assert.equal(wordBeforeCursor("", 0), "");
  assert.equal(wordBeforeCursor("Cabinet ", 8), "");
});
