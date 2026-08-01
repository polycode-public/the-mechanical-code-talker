// world-teach.mjs — a declarative sentence read as a fact against the LIVE
// world, and written into it on the spot. This is the engine half of the
// adventure/mud pages' "teach" switch: with it off nothing here runs and the
// lane behaves exactly as it always has; with it on, a sentence the surface's
// own editor grammar can express becomes a world fact this turn.
//
// It owns the gates, the id minting, the snapshot stamping and the decline
// wording. It owns NO grammar. The sentence table belongs to the surface —
// adventure-editor.mjs for a manor, mud-editor.mjs for a burrow, which say
// placement with different words — so the parser arrives as `parseLine` and
// this module never learns either vocabulary. Both tables are the inverse of
// their own page's right-hand "the world's own account" renderer, so every
// sentence a page has already SHOWN somebody is a sentence they can type back.
//
// This is deliberately NOT chat.mjs's teachLane, and does not widen it. A
// chat teach carries `teach:chat:*` provenance, which worldActionRows filters
// out of the playable fold on purpose: a locative note somebody made mid-game
// must never silently move a prop. A world teach is a different act — the
// player asserting what the world IS — so it carries its own
// `world:<name>:taught:turnK` provenance, passes that same filter by the
// `world:` prefix every played turn already uses, and scores on the world's
// own Source with no change to the trust model. The two stay apart.
//
// Semantics are general on purpose. Anything the table can say becomes a
// fact: a new thing, a world-authored one moved, a locked cabinet opened, the
// player put somewhere else. The fold has no invariant layer, so a
// contradicting row does not conflict — the newer write simply wins, exactly
// as a played turn's does.
//
// One consequence worth stating plainly: a teach spends a turn number (every
// fold-versioned write is stamped `@turnK`, or it would rank as turn 0 and
// lose to anything already played) but does NOT run the NPC pass. Nobody in
// the cast moves in response to a sentence. That is the same trade the
// page's own edit mode already makes.
import { appendFacts, loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { worldProvenanceTag } from "../domain/worlds-pack.mjs";
import { correctMisspellings } from "../domain/interpret/normalize.mjs";
import {
  classMassFacts, foldWorldState, freshObjectId, snapshotSubject, worldActionRows, worldRelook,
} from "./adventure.mjs";

// A trailing "?" is an unambiguous "this is a question", and a question must
// never reach a write boundary. A leading interrogative is the same signal one
// word earlier, run over the closed misspelling repair so a typo'd "wat is the
// lamp" goes back to the question side rather than reading as a declarative.
// Both mirror chat.mjs's own teach lane, which stands the whole lane down on
// either — a world teach has exactly the same reason to.
const QUESTION_LEAD_RE = /^(?:what|who|which|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have)\b/i;

// A subject with no referent of its own. The generic "X is a Y." fallback in
// both sentence tables would otherwise read "There is a book in the study" as
// the claim that `there` is a `book in the study` — a real fact, about
// nothing. These decline rather than fall through: the sentence is plainly
// meant as a teach, and quietly handing it to the ordinary lanes to answer as
// conversation is the guess this product doesn't make.
const EMPTY_SUBJECTS = new Set(["it", "they", "them", "there", "this", "that", "these", "those", "he", "she"]);

const PLACEMENT_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:stands-locked-in", "mgx:hidden-in",
]);

const SNAPSHOT_RE = /^(.+?)@(?:epoch(\d+)@)?turn(\d+)$/;

const decline = (text, note) => ({ text, lane: "game-answer", note: `ADVENTURE — world-teach: ${note}`, miss: true });

/** Which subject is which class, for the one genuinely ambiguous placement
 *  sentence ("X is in the Y." reads as a person standing or a prop resting,
 *  depending on X). The adventure table takes this as its second argument;
 *  the burrow table says the two with different words and ignores it. */
function typesFromRows(rows) {
  const types = new Map();
  for (const row of rows || []) {
    if (row?.predicate === "rdf:type" && row.subject && row.object) {
      types.set(String(row.subject).trim().toLowerCase(), String(row.object).trim().toLowerCase());
    }
  }
  return types;
}

const roomsOf = (rows) => [...new Set((rows || [])
  .filter((r) => r.predicate === "rdf:type" && r.object === "room" && !SNAPSHOT_RE.test(r.subject))
  .map((r) => r.subject))].sort();

/** Every name the world already resolves — anything typed, anything placed,
 *  and either end of an exit. A subject already on this list is moved or
 *  re-described by a teach; one that isn't is minted. */
function knownNames(rows, state) {
  const names = new Set();
  for (const row of rows || []) {
    if (SNAPSHOT_RE.test(row.subject)) continue;
    if (row.predicate === "rdf:type" || PLACEMENT_PREDICATES.has(row.predicate)) names.add(row.subject);
    if (/^mgx:has-exit-[a-z]+$/.test(row.predicate)) { names.add(row.subject); names.add(row.object); }
  }
  for (const subject of state?.placements?.keys() ?? []) names.add(subject);
  return names;
}

/** An id nothing in the world answers to yet. The plain noun wherever it is
 *  free, so "Candle is in the study" leaves a thing called `candle` and the
 *  pill rail offers "take candle" on the very next redraw — the world's own
 *  class-default minting picks ids the same way. A collision falls back to
 *  the numbered id every mid-play spawn already uses. */
function mintedIdFor(rows, noun) {
  const taken = (rows || []).some((r) => r.subject === noun || r.object === noun);
  return taken ? freshObjectId(rows, noun) : noun;
}

function confirmation(triple, { thing, minted, rooms }) {
  if (triple.predicate === "mgx:is-open") {
    return `noted — the ${thing} is ${triple.object === "true" ? "open" : "closed"} now.`;
  }
  if (PLACEMENT_PREDICATES.has(triple.predicate)) {
    const where = rooms.includes(triple.object) ? `in the ${triple.object}` : `with the ${triple.object}`;
    return minted ? `noted — there's a ${thing} ${where} now.` : `noted — the ${thing} is ${where} now.`;
  }
  if (triple.predicate === "rdf:type") return `noted — the ${thing} is a ${triple.object} now.`;
  return `noted — the world says that now.`;
}

/**
 * One line read as a fact about the live world, or null when it is not a
 * teach sentence at all and the ordinary lane should have it. `parseLine` is
 * the surface's own editor parser (`parseEditorLine` / `parseMudEditorLine`);
 * `planTriple` is that same editor's additive planner. `rows`/`state` are the
 * caller's already-loaded fact rows and fold, so this never re-reads the
 * store to decide.
 *
 * Returns the ordinary lane answer shape — `{ text, lane, note }`, plus
 * `miss: true` on every decline so the transcript styles it like any other
 * honest refusal, and `taught` (the rows actually written) on a success.
 */
export async function worldTeachTurn(line, {
  parseLine, planTriple, rows, state, memoryDir, world, actingSubject = "player", cache = null, graph = null,
}) {
  const trimmed = String(line || "").trim();
  if (!trimmed || !parseLine || !planTriple || !memoryDir) return null;
  if (/\?\s*$/.test(trimmed)) return null;
  if (QUESTION_LEAD_RE.test(correctMisspellings(trimmed))) return null;

  const triple = parseLine(trimmed, typesFromRows(rows));
  if (!triple) return null;

  const rooms = roomsOf(rows);
  if (EMPTY_SUBJECTS.has(triple.subject)) {
    return decline(
      `"${triple.subject}" doesn't name anything I can write a fact about — name the thing itself, like "candle is in the study".`,
      `"${trimmed}" parses with "${triple.subject}" as its subject, which refers to nothing this world holds; declined rather than stored against a pronoun`,
    );
  }
  if (triple.kind === "placement" && !rooms.includes(triple.object) && !knownNames(rows, state).has(triple.object)) {
    return decline(
      `I don't know a place called "${triple.object}" — this world has: ${rooms.join(", ")}.`,
      `"${trimmed}" places ${triple.subject} in "${triple.object}", which names no room and nothing else the world holds; declined by name, alternatives listed`,
    );
  }

  const { toAppend, reason } = planTriple(rows, state, triple);
  const known = knownNames(rows, state);
  const minting = triple.kind === "placement" && !known.has(triple.subject);
  // Re-asserting something the world already holds is true, so it is not a
  // miss — but it writes nothing, and saying so is the whole answer.
  if (!toAppend.length && !minting) {
    const room = state?.placements?.get(actingSubject)?.object ?? null;
    return {
      text: `the world already said that — ${reason}.${room ? ` ${await worldRelook(room, { memoryDir, graph, actingSubject })}` : ""}`,
      lane: "game-answer",
      miss: false,
      note: `ADVENTURE — world-teach: "${trimmed}" asserts a fact the world already holds (${reason}); nothing written`,
      taught: [],
    };
  }

  const k = (state?.turnCount ?? 0) + 1;
  const epoch = state?.epoch ?? 0;
  const id = minting ? mintedIdFor(rows, triple.subject) : triple.subject;
  // Only the fold-versioned families are stamped. foldWorldState ranks an
  // unstamped row as turn 0, so an unstamped placement would silently lose to
  // anything already played about the same thing. A type/exit/flag row is read
  // raw by every reader and must keep its bare subject — a stamped one names a
  // subject no verb resolves.
  const stamp = (t) => (t.kind === "other"
    ? { subject: id, predicate: t.predicate, object: t.object }
    : { subject: snapshotSubject(id, k, epoch), predicate: t.predicate, object: t.object });
  const facts = [
    // A minted thing arrives with the same rows the world's own class-default
    // and dig spawns write: its own class (which resolves its sprite), the
    // portable class (which is what makes the take verb accept it), a plain
    // reading name, and whatever mass its class declares. A class with no
    // sprite of its own falls back to the parcel icon already drawn for it.
    ...(minting ? [
      { subject: id, predicate: "rdf:type", object: triple.subject },
      { subject: id, predicate: "rdf:type", object: "portable" },
      { subject: id, predicate: "mgx:display-name", object: triple.subject },
      ...classMassFacts(rows, id, triple.subject),
    ] : []),
    ...toAppend.map(stamp),
  ];
  const provenance = `${worldProvenanceTag(world)}:taught:turn${k}`;
  await appendFacts(memoryDir, facts.map((f) => ({ ...f, provenance })));
  if (cache) cache.rows = null;

  const freshState = foldWorldState(worldActionRows(readFactRows(await loadMemory(memoryDir))));
  const here = freshState.placements.get(actingSubject)?.object ?? null;
  const said = confirmation(triple, { thing: triple.subject, minted: minting, rooms });
  const relook = here ? ` ${await worldRelook(here, { memoryDir, graph, actingSubject })}` : "";
  return {
    text: `${said}${relook}`,
    lane: "game-answer",
    miss: false,
    goal: minting ? `put a ${triple.subject} in the world` : `change what the world says about the ${triple.subject}`,
    note: `ADVENTURE — world-teach: ${reason}; ${minting ? `minted ${id} and ` : ""}wrote ${facts.length} row(s) at turn ${k} with provenance ${provenance}; no NPC pass rides a taught fact${here ? `; auto-relook appended for the ${here}` : ""}`,
    taught: facts,
  };
}
