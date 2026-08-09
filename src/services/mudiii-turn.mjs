// mudiii-turn.mjs — the chat lane for the headless town-square game: loading
// one of the three shipped layouts into the session's memory store, the stop
// command, the addressed teach-frame (extended to the food channel spider-fly
// has no equivalent of), the bare "tick" command, the player's own food-
// placement verb, and the belief and orientation asides. The fifth lane on
// the shared plan slot, shaped exactly like spider-fly-turn.mjs, with
// vocabulary from predator-prey.mjs's own MUDIII_ROLES: fox hunts goblin,
// goblins forage crumbs and morsels.
//
// This module never plans a move or runs the ecology pass itself — every bit
// of game logic (fold, pathfinding, belief, ecology, food placement) lives in
// predator-prey.mjs; this file only recognizes chat shapes, resolves them to
// that engine's own interface, and renders the result as chat text.

import {
  TOWN_SQUARE_LAYOUTS, DEFAULT_GRID_SIZE, DIRECTION_DELTA,
  cellId, parseCellId, inBounds, isSolid, chebyshevDistance, oneStepDirectionBetween,
  agentKindOf, liveIdsOfKind, layoutNamed, isFoodId,
} from "../domain/town-square-world.mjs";
import {
  MUDIII_ROLES, foldTownSquareState, startTownSquareGame, runTownSquareTick, planTownSquareTurn,
  placeFood, roleOfId, beliefSnapshotFor,
} from "./predator-prey.mjs";
import { snapshotSubject, parseSnapshotSubject } from "./adventure.mjs";
import { correctMisspellings, QUESTION_LEAD_RE } from "../domain/interpret/normalize.mjs";
import { worldProvenanceTag } from "../domain/worlds-pack.mjs";
import { getWorldsPackProvider } from "../adapters/corpus/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows, readRuleRows } from "../adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";
import { agentTraitsOf, constraintsFromDrives } from "../domain/agent-traits.mjs";
import { beliefOriginOf } from "../domain/agent-belief.mjs";
import {
  compileDomain, stateFromFacts, stateKeyFor, movesFromRules, compileGoal, PlanBudgetError,
} from "../domain/domain.mjs";
import { findActionPath } from "../domain/planning.mjs";

const PREDATOR_KIND = MUDIII_ROLES.predator.kind; // "fox"
const PREY_KIND = MUDIII_ROLES.prey.kind;         // "goblin"
const SPAWNED_FOOD_KIND = MUDIII_ROLES.food.spawnedKind; // "crumb"
const PLACED_FOOD_KIND = MUDIII_ROLES.food.placedKind;   // "morsel"

// ---- recognizers: the closed opening/stop/tick/address set -------------------

// One opener per shipped layout, plus a role-named alias for the headline
// square. Closed vocabulary (visit/watch/enter/start/begin — never "play",
// which is adventure's own named-opener verb and would otherwise race it for
// "play town square"). None of these ever collides with adventure's own
// generic opener (requires the literal word "adventure") or spider-fly's
// (requires the literal word "spider").
const MUDIII_HEADLINE_OPEN_RE =
  /^(?:let'?s\s+)?(?:visit|watch|enter|start|begin)\s+(?:the\s+)?town\s+square(?:\s+game)?[.!?\s]*$/i;
const MUDIII_FOX_GOBLIN_OPEN_RE =
  /^(?:let'?s\s+)?watch\s+the\s+foxe?s?\s+and\s+(?:the\s+)?goblins?[.!?\s]*$/i;
const MUDIII_MARKET_OPEN_RE =
  /^(?:let'?s\s+)?(?:visit|watch|enter|start|begin)\s+(?:the\s+)?market\s+(?:square|day)(?:\s+game)?[.!?\s]*$/i;
const MUDIII_CHAPEL_OPEN_RE =
  /^(?:let'?s\s+)?(?:visit|watch|enter|start|begin)\s+(?:the\s+)?chapel\s+corner(?:\s+game)?[.!?\s]*$/i;

/** The layout name an opening line names, or null when the line opens
 *  nothing this lane recognizes. Shape-only, closed vocabulary — never a
 *  generic "play X" grammar, so a name this pack does not ship (e.g. "play
 *  mudiii") stays unclaimed and falls to chat's own last-resort honest
 *  decline rather than this lane guessing at it. */
function matchMudiiiOpening(line) {
  const l = String(line).trim();
  if (MUDIII_HEADLINE_OPEN_RE.test(l) || MUDIII_FOX_GOBLIN_OPEN_RE.test(l)) return "town-square";
  if (MUDIII_MARKET_OPEN_RE.test(l)) return "town-square-market";
  if (MUDIII_CHAPEL_OPEN_RE.test(l)) return "town-square-chapel";
  return null;
}

// "stop watching" is this game's own stop word, same reasoning as
// spider-fly's: there is nothing to "play" in the sense of typing moves.
const MUDIII_STOP_RE =
  /^(?:stop\s+(?:watching|playing)|quit\s+(?:the\s+)?(?:town\s+square\s+)?game|end\s+the\s+town\s+square\s+game|leave\s+the\s+game)[.!?\s]*$/i;
// The bare tick command, styled after spider-fly-turn.mjs's own (itself
// styled after the plan lane's PLAN_NEXT_RE).
const MUDIII_TICK_RE = /^(?:tick|next\s+turn|advance(?:\s+the\s+turn)?)[.!?\s]*$/i;

// The addressed teach-frame: "@fox the goblin is west" / "@fox-1 the goblin
// is at cell-7-3". Only a fox or a goblin can be ADDRESSED (only an agent has
// belief to plant), but the SUBJECT of the claim can also be a crumb or a
// morsel — the one extension spider-fly's teach-frame has no equivalent of,
// since food is a forage target a goblin can be lied to about. A closed
// regex, not a route through the general grammar, mirroring spider-fly-
// turn.mjs's own reasoning (the general placement/copula grammar hits real
// gaps for this exact shape).
const MUDIII_ADDRESS_LEAD_RE = /^@(fox|goblin)(?:-(\d+))?\b/i;
const MUDIII_TOLD_RE = new RegExp(
  "^@(fox|goblin)(?:-(\\d+))?[,:]?\\s+the\\s+(fox|goblin|crumb|morsel)(?:-(\\d+))?\\s+is\\s+"
  + "(?:(north|south|east|west)|at\\s+(cell-\\d+-\\d+))[.!?\\s]*$",
  "i",
);

// The observable-facts read: "what does the goblin see?" — belief only,
// never ground truth.
const MUDIII_SEE_RE = /^what (?:does|can) the (fox|goblin)(?:-(\d+))?\s+see[.!?\s]*$/i;

// "who put/placed that there?" — provenance, ground truth (not belief), read
// from placeFood's own mgx:placed-by row. The subject must be named, either
// an item id ("who put morsel-1 there?") or a cell ("who put food at
// cell-3-4?") — a bare "who put that there?" with no referent at all names
// nothing to look up and is left to the ordinary lanes. Requires the leading
// "who put/placed/dropped" verb, so it never collides with an unrelated "who"
// question (the fox's own catches, the goblins' names, anything not about a
// placement) — those never start with this verb at all.
const MUDIII_WHO_PLACED_RE = new RegExp(
  "^who\\s+(?:put|placed|dropped)\\s+"
  + "(?:"
  + "(?:the\\s+)?(morsel|crumb)(?:-(\\d+))?"
  + "|"
  + "(?:(?:the\\s+)?(?:food|morsel|crumb|that|it)\\s+)?(?:at|on)\\s+(cell-\\d+-\\d+)"
  + ")"
  + "(?:\\s+there)?[?.!\\s]*$",
  "i",
);

// The player's own verb: "put food at cell-3-4" (primary, never shadowed —
// the adventure imperative grammar's own "put" arm hard-requires a literal
// "in", so "at" never parses there) and "drop a morsel at cell-3-4"
// (secondary alias: free while a mudiii game is the only thing live on the
// shared slot, but shadowed by the adventure/mud imperative grammar's bare-
// object "drop" arm should one of those be live in the same session instead —
// which can't happen while THIS game holds the slot, since the slot holds
// one thing at a time).
const MUDIII_PUT_FOOD_RE = /^(?:put|place)\s+(?:a\s+|some\s+)?(?:food|morsel)\s+(?:at|on)\s+(cell-\d+-\d+)[.!?\s]*$/i;
const MUDIII_DROP_FOOD_RE = /^drop\s+(?:a\s+|some\s+)?(?:morsel|food)\s+(?:at|on)\s+(cell-\d+-\d+)[.!?\s]*$/i;

const WORLD_OPENING_FALLBACK =
  "a fox prowls the town square; goblins pick over the stalls for scraps. Neither is yours to move. Watch, or address one by name in chat.";

// ---- the opening turn: load the shipped board through the worlds pack -------

async function openMudiiiGame(world, { planHolder, memoryDir, env, cache, gameConfig = DEFAULT_GAME_CONFIG }) {
  if (!memoryDir) {
    return {
      text: "the town square needs a session with a memory store to hold the board — start tmct inside a repo first.",
      lane: "game-inform",
      note: "MUDIII — opening declined: no memory store to load the board into",
    };
  }
  const provider = getWorldsPackProvider(env);
  let payload = null;
  try { payload = await provider.load(world); } catch { payload = null; }
  if (!payload) {
    return {
      text: 'no worlds pack here — the town square ships in corpus/worlds/ (or the directory TMCT_WORLDS_PACK_DIR names), and it is missing or unreadable, so there is no board to load.',
      lane: "game-inform",
      note: "MUDIII — opening declined: the worlds pack is absent/unreadable",
    };
  }

  const tag = worldProvenanceTag(world);
  await appendFacts(memoryDir, payload.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of payload.rules) {
    try { await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag }); }
    catch { /* one malformed rule row loses that rule, not the board */ }
  }
  if (cache) cache.rows = null; // the fact-rows cache predates these writes

  const layout = layoutNamed(world) ?? TOWN_SQUARE_LAYOUTS[world];
  const { started } = await startTownSquareGame(memoryDir, { layout, config: gameConfig?.mudiii, roles: MUDIII_ROLES });
  planHolder.state = { mudiii: { world, turn: 0 } };
  const opener = started
    ? (payload.meta?.opening || layout?.opening || WORLD_OPENING_FALLBACK)
    : 'back to the town square — the fox and the goblins are already in play. Say "tick" to advance, or address one, e.g. "@fox the goblin is east".';
  return {
    text: opener,
    goal: 'watch the fox and the goblins, or address one (e.g. "@fox the goblin is east")',
    lane: "game-inform",
    note: `MUDIII — loaded the "${world}" board from the worlds pack into this session's memory (facts + rule rows, provenance ${tag}) and ${started ? "minted" : "found"} the starting cast`,
  };
}

// ---- resolving an addressed agent / belief target / food subject -------------

/** An exact "kind-num" reference, or (no number given) the first live
 *  individual of that kind — null when nothing live matches. `kind` names a
 *  fox, a goblin, a crumb or a morsel: the resolution is identical for an
 *  agent and an inert item, since both are placed subjects on the same
 *  folded board. */
function resolveAgentId(kind, num, state) {
  if (num) {
    const id = `${kind}-${num}`;
    return state.placements.has(id) && !state.removed.has(id) ? id : null;
  }
  const live = liveIdsOfKind(state.placements, kind, state.removed);
  return live[0] ?? null;
}

/** Same as resolveAgentId, but with no number given it picks the live
 *  individual NEAREST `nearCell` — the natural reading of "the goblin" from a
 *  particular addressee's own position once the ecology has minted more than
 *  one fox or goblin, or more than one crumb. */
function resolveNearestAgentId(kind, num, state, nearCell) {
  if (num) return resolveAgentId(kind, num, state);
  const live = liveIdsOfKind(state.placements, kind, state.removed);
  if (!live.length || !nearCell) return live[0] ?? null;
  let best = live[0];
  let bestDist = Infinity;
  for (const id of live) {
    const c = parseCellId(state.placements.get(id).cell);
    const d = chebyshevDistance(nearCell.x, nearCell.y, c.x, c.y);
    if (d < bestDist) { bestDist = d; best = id; }
  }
  return best;
}

function noSuchAgentAnswer(kind, role) {
  const text = role === "addressee"
    ? `there's no live ${kind} on the board to address.`
    : `there's no live ${kind} on the board for that to be about.`;
  return { text, lane: "game-inform", note: `MUDIII — told-fact declined: no live ${kind} resolves as the ${role}`, miss: true };
}

/** The believed target cell, either the literal cell-<x>-<y> or the
 *  addressee's own current cell shifted one step in the stated compass
 *  direction — null when the result would fall off `gridSize`'s board (a
 *  layout property, not a module constant — the three shipped layouts run
 *  10, 12 and 14 to a side). */
function resolveTargetCell({ direction, cellLiteral, fromCell, gridSize }) {
  if (cellLiteral) {
    const parsed = parseCellId(cellLiteral);
    return parsed && inBounds(gridSize, parsed.x, parsed.y) ? parsed : null;
  }
  const delta = DIRECTION_DELTA[direction.toLowerCase()];
  const nx = fromCell.x + delta.dx;
  const ny = fromCell.y + delta.dy;
  return inBounds(gridSize, nx, ny) ? { x: nx, y: ny } : null;
}

// oneStepDirectionBetween lives in town-square-world.mjs (the shared grid
// geometry both this chat-turn layer and the engine need); re-exported here
// so a caller building a deception pill's direction wording never has to
// reach into the domain layer by hand.
export { oneStepDirectionBetween };

// ---- deception pills, built on the addressed teach-frame above: dynamic,
// per-tick chat-dock suggestions alongside (never replacing) any static
// address/direction rail. No new grammar at all — every pill's sentence is
// exactly the SAME MUDIII_TOLD_RE line above already accepts, filled in with
// either the subject's real position or a deliberately false one, so a human
// clicking one submits a plain "@fox the goblin is east"-shaped line
// indistinguishable from a hand-typed claim, true or false alike. A pill's
// `truth` tag is for the human eye only — it never rides along in the
// submitted text itself.

/** "fox"/"goblin" bare when exactly one individual of that kind is live
 *  (nothing to disambiguate), else the individual's own numbered id. */
function agentPillLabel(kind, id, liveIdsOfKindArr) {
  return liveIdsOfKindArr.length > 1 ? id : kind;
}

/** The point reflection of `cell` through the `gridSize`x`gridSize` board's
 *  center — cell-<gridSize+1-x>-<gridSize+1-y> — the canonical false-claim
 *  cell: deterministic, always in-bounds (1..gridSize reflects onto
 *  1..gridSize), and never accidentally true for any of the three shipped
 *  layouts, all of which run an EVEN gridSize (10, 12, 14): x =
 *  (gridSize+1)-x has no integer solution when gridSize+1 is odd. */
function reflectedCell(cell, gridSize) {
  return { x: gridSize + 1 - cell.x, y: gridSize + 1 - cell.y };
}

/**
 * The town-square chat dock's dynamic pill set for one tick's live `agents`
 * and `items` (runTownSquareTick's own `{ id: { cell, ... } }` shapes — only
 * `.cell` is read from either): one address pill per live fox/goblin (bare
 * "@fox" while exactly one of that kind is alive, numbered "@fox-2" once more
 * than one is), plus — for whichever individual is currently addressed
 * (`explicitAddresseeId`, falling back to `opts.defaultKind`'s first live
 * individual, the predator kind by default) — one true-claim and one
 * canonical false-claim pill per live individual of the OPPOSITE role (you
 * address a fox about a goblin's position, or a goblin about a fox's), plus,
 * when the addressee is prey (the one role that forages), one true/false
 * claim pill per live food item — the channel spider-fly has no equivalent
 * of, since only a forager has any use for a claim about where food sits.
 *
 * Returns `{ addressPills, claimPills, addresseeId }` — `addressPills` is
 * `[{ id, kind, label }]`; `claimPills` is `[{ subjectId, truth, text,
 * sentence }]` (`sentence` is the complete, ready-to-submit chat line); both
 * empty when nothing is live. `opts.gridSize` must name the live layout's own
 * board size (falls back to the headline layout's 12 otherwise) — the false-
 * claim reflection needs it. Pure.
 */
export function pillsForMudiii(agents, items, explicitAddresseeId, opts = {}) {
  const { defaultKind = PREDATOR_KIND, gridSize = DEFAULT_GRID_SIZE, roles = MUDIII_ROLES } = opts;
  const predatorKind = roles.predator.kind;
  const preyKind = roles.prey.kind;
  const livePredators = liveIdsOfKind(agents, predatorKind);
  const livePrey = liveIdsOfKind(agents, preyKind);

  const addressPills = [
    ...livePredators.map((id) => ({ id, kind: predatorKind, label: `@${agentPillLabel(predatorKind, id, livePredators)}` })),
    ...livePrey.map((id) => ({ id, kind: preyKind, label: `@${agentPillLabel(preyKind, id, livePrey)}` })),
  ];

  const fallbackAddresseeId = (defaultKind === preyKind ? livePrey[0] : livePredators[0]) ?? livePrey[0] ?? livePredators[0] ?? null;
  const addresseeId = (explicitAddresseeId && agents[explicitAddresseeId]) ? explicitAddresseeId : fallbackAddresseeId;
  if (!addresseeId) return { addressPills, claimPills: [], addresseeId: null };

  const addresseeKind = agentKindOf(addresseeId);
  const addresseeLabel = agentPillLabel(addresseeKind, addresseeId, addresseeKind === predatorKind ? livePredators : livePrey);
  const addresseeCell = parseCellId(agents[addresseeId].cell);

  const candidateKind = addresseeKind === predatorKind ? preyKind : predatorKind;
  const candidateIds = candidateKind === predatorKind ? livePredators : livePrey;

  const claimPills = [];
  const addClaim = (subjectId, subjectLabel, trueCell) => {
    const direction = oneStepDirectionBetween(addresseeCell, trueCell);
    const trueValue = direction ? direction : `at ${cellId(trueCell.x, trueCell.y)}`;
    const falseCell = reflectedCell(trueCell, gridSize);
    const falseValue = `at ${cellId(falseCell.x, falseCell.y)}`;
    claimPills.push({
      subjectId, truth: true,
      text: `the ${subjectLabel} is ${trueValue}`,
      sentence: `@${addresseeLabel} the ${subjectLabel} is ${trueValue}`,
    });
    claimPills.push({
      subjectId, truth: false,
      text: `the ${subjectLabel} is ${falseValue}`,
      sentence: `@${addresseeLabel} the ${subjectLabel} is ${falseValue}`,
    });
  };

  for (const subjectId of candidateIds) {
    const subjectLabel = agentPillLabel(candidateKind, subjectId, candidateIds);
    addClaim(subjectId, subjectLabel, parseCellId(agents[subjectId].cell));
  }

  // The food channel: only prey forages, so only a goblin addressee gets
  // claim pills about a crumb or a morsel — a fox never plans toward food at
  // all (predator-prey.mjs's decide() never reads the item roster for a
  // predator), so offering it there would be a pill with no effect.
  if (addresseeKind === roles.prey.kind) {
    const liveItemIds = Object.keys(items || {}).sort();
    for (const itemId of liveItemIds) {
      addClaim(itemId, itemId, parseCellId(items[itemId].cell));
    }
  }

  return { addressPills, claimPills, addresseeId };
}

// ---- rendering one tick's return value as plain chat text --------------------

const ECOLOGY_EVENT_TEXT = {
  "eat-agent": (e) => `${e.predator} caught ${e.prey} at ${e.cell}`,
  "eat-item": (e) => `${e.agent} ate ${e.item} at ${e.cell}`,
  starve: (e) => `${e.agent} starved at ${e.cell}`,
  "spawn-prey": (e) => `${e.agent} arrived at ${e.cell}`,
  "spawn-food": (e) => `${e.item} appeared at ${e.cell}`,
  "place-food": (e) => `${e.placedBy} put ${e.item} at ${e.cell}`,
};

function renderTickText(tick, addressedNote) {
  const parts = [];
  if (addressedNote) parts.push(`${addressedNote}.`);
  const agentIds = Object.keys(tick.agents).sort();
  parts.push(agentIds.length
    ? `Turn ${tick.turn} — ${agentIds.map((id) => `${id} is now at ${tick.agents[id].cell}`).join("; ")}.`
    : `Turn ${tick.turn} — no agents remain on the board.`);
  const itemIds = Object.keys(tick.items).sort();
  if (itemIds.length) parts.push(`Food: ${itemIds.map((id) => `${id} at ${tick.items[id].cell}`).join("; ")}.`);
  const events = tick.ecology.map((e) => ECOLOGY_EVENT_TEXT[e.type]?.(e)).filter(Boolean);
  if (events.length) parts.push(`${events.join("; ")}.`);
  return parts.join(" ");
}

/** Every live agent's own goal line folded into ONE string — withGoalLine
 *  only renders a single "Goal (inferred): …" suffix per turn, and this game
 *  always has several live agents with independent goals. Null once nothing
 *  survives the tick. */
function combinedGoalLine(agents) {
  const ids = Object.keys(agents).sort();
  if (!ids.length) return null;
  return ids.map((id) => `${id} — ${agents[id].goal.replace(/\.\s*$/, "")}`).join("; ");
}

function describeEcologyNote(events) {
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const label = { "eat-agent": "caught", "eat-item": "foraged", starve: "starved", "spawn-prey": "arrived", "spawn-food": "spawned", "place-food": "placed" };
  const bits = Object.entries(counts).map(([type, n]) => `${n} ${label[type] ?? type}`);
  return bits.length ? `; ${bits.join(", ")}` : "";
}

async function runTickAndRender({ planHolder, memoryDir, cache, world, toldFacts = [], addressedNote = null, gameConfig = DEFAULT_GAME_CONFIG }) {
  const tick = await runTownSquareTick(memoryDir, { layout: world, toldFacts, config: gameConfig?.mudiii, roles: MUDIII_ROLES });
  if (cache) cache.rows = null;
  planHolder.state = { mudiii: { world, turn: tick.turn } };
  return {
    text: renderTickText(tick, addressedNote),
    goal: combinedGoalLine(tick.agents),
    lane: "game-answer",
    note: `MUDIII — turn ${tick.turn} (${world}): ran runTownSquareTick (${toldFacts.length ? "with an addressed told-fact" : "no addressed target"})${describeEcologyNote(tick.ecology)}`,
  };
}

// ---- the player's own verb: placing food ------------------------------------

async function runPlaceFoodTurn(cellLiteral, { memoryDir, gameConfig = DEFAULT_GAME_CONFIG, world, layout }) {
  const result = await placeFood(memoryDir, {
    layout, cell: cellLiteral, config: gameConfig?.mudiii, roles: MUDIII_ROLES, placedBy: "player",
  });
  if (!result.placed) {
    return {
      text: result.reason,
      lane: "game-inform",
      note: `MUDIII — food placement declined: ${result.reason}`,
      miss: true,
    };
  }
  return {
    text: `noted — a ${result.kind} now sits at ${result.cell}. Say "tick" to see what happens.`,
    goal: "bait or feed the goblins",
    lane: "game-answer",
    note: `MUDIII — placed ${result.item} (${result.kind}) at ${result.cell} for turn ${result.turn} (${world}), provenance carries mgx:placed-by ${result.placedBy}`,
  };
}

// ---- the observable-facts read: "what does the goblin see?" -----------------

/** One `[id, cellId | null]` belief entry as a sentence: `"fox-1 is at
 *  cell-3-4."` when observed/told, `"crumb-2 has not been observed."`
 *  otherwise. Pure, self-contained, `.toString()`-splice safe. */
export function believedFactSentence(id, believedCell) {
  return believedCell ? `${id} is at ${believedCell}.` : `${id} has not been observed.`;
}

// The mark both visitor-driven write paths stamp on a placement row: the teach
// lane's `world:<name>:taught:turnK`, and placeFood's own, which builds the
// same tag. The board's own ticks write the bare world tag with no such mark.
const TAUGHT_PROVENANCE_MARK = ":taught:";

/** Every subject standing where a VISITOR put it — taught into place by a
 *  sentence, or dropped there by the food verb. Both write the same
 *  `:taught:turnK` provenance, and the board's own ticks write none of it.
 *
 *  Reads the row that WON, ranked the way foldTownSquareState ranks a
 *  placement, so a crumb a visitor moved and the board has since moved on from
 *  no longer counts. `epoch` is the fold's own, which unstamped rows (a
 *  hand-built fixture, a seed row) are ranked at. Pure. */
export function taughtPlacementSubjects(factRows, epoch = 0) {
  const winner = new Map(); // subject -> { epoch, turn, taught }
  for (const row of factRows || []) {
    if (row.predicate !== PLACEMENT_PREDICATE) continue;
    const snap = parseSnapshotSubject(row.subject);
    const base = snap ? snap.base : row.subject;
    const rowEpoch = snap ? snap.epoch : epoch;
    const turn = snap ? snap.turn : 0;
    const prior = winner.get(base);
    if (prior && !(rowEpoch > prior.epoch || (rowEpoch === prior.epoch && turn >= prior.turn))) continue;
    winner.set(base, { epoch: rowEpoch, turn, taught: String(row.provenance || "").includes(TAUGHT_PROVENANCE_MARK) });
  }
  const taught = new Set();
  for (const [subject, entry] of winner) if (entry.taught) taught.add(subject);
  return taught;
}

/** One observer's whole belief snapshot as a sentence.
 *
 *  Anything the observer can place is named: seen, or told. So is anything the
 *  visitor put where it stands, seen or not, because the teach lane exists so
 *  a claim about ONE individual lands where a visitor can watch it, and an
 *  individual that dissolved into a count would take that with it.
 *
 *  Everything else unobserved is counted rather than listed. A square at its
 *  food cap otherwise answers a question about what a goblin can see with a
 *  row of crumbs it cannot, and the list grows with the cap.
 *
 *  `beliefEntries` is `Object.entries(beliefSnapshotFor(...))` and
 *  `taughtSubjects` a Set from taughtPlacementSubjects. Pure. */
export function beliefLineFor(observerId, beliefEntries, taughtSubjects) {
  const taught = taughtSubjects || new Set();
  const named = [];
  let unobserved = 0;
  for (const [id, cell] of beliefEntries || []) {
    if (cell || taught.has(id)) named.push(believedFactSentence(id, cell));
    else unobserved += 1;
  }
  if (!named.length && !unobserved) return `${observerId} is alone on the board — nothing else to see.`;
  const rest = unobserved === 1 ? "1 other has not been observed." : `${unobserved} others have not been observed.`;
  if (!named.length) return `${observerId} sees nothing yet. ${rest}`;
  return `${observerId} sees: ${named.join(" ")}${unobserved ? ` ${rest}` : ""}`;
}

/** "what does the goblin see?" / "what does the fox see?" rendered as plain
 *  text: the same beliefSnapshotFor read predator-prey.mjs's own tick loop
 *  uses, over the CURRENT board state — read-only, no tick runs. Candidates
 *  are every other live agent of either role AND every live food item (a
 *  goblin's own forage target), exactly the beliefCandidates set
 *  runTownSquareTick itself builds. toldFacts is empty — a told position only
 *  ever arrives fresh alongside a tick, so there is none standing between
 *  ticks to read back here. beliefLineFor turns the snapshot into the
 *  sentence, naming what the observer can place and what a visitor put where
 *  it stands, and counting the rest. */
async function mudiiiBeliefAnswer(match, { memoryDir, gameConfig = DEFAULT_GAME_CONFIG }) {
  const kind = match[1].toLowerCase();
  const num = match[2];
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);
  const observerId = resolveAgentId(kind, num, state);
  if (!observerId) return noSuchAgentAnswer(kind, "addressee");
  const observerCell = parseCellId(state.placements.get(observerId).cell);
  const role = roleOfId(observerId, MUDIII_ROLES);
  const candidateIds = [
    ...liveIdsOfKind(state.placements, PREDATOR_KIND, state.removed),
    ...liveIdsOfKind(state.placements, PREY_KIND, state.removed),
    ...liveIdsOfKind(state.placements, SPAWNED_FOOD_KIND, state.removed),
    ...liveIdsOfKind(state.placements, PLACED_FOOD_KIND, state.removed),
  ];
  // The same trait-first read the tick engine performs: the observer's own
  // mgx:vision-radius (or its class's) decides what it can see, and the
  // config number covers a board whose rows state none — two readers of one
  // question must not drift.
  const visionRadius = agentTraitsOf(rows, observerId).visionRadius
    ?? (role === "predator" ? gameConfig?.mudiii?.predatorVisionRadius : gameConfig?.mudiii?.preyVisionRadius);
  const belief = beliefSnapshotFor(observerId, observerCell, candidateIds, state, { visionRadius });
  const text = beliefLineFor(observerId, Object.entries(belief), taughtPlacementSubjects(rows, state.epoch));
  return {
    text,
    lane: "game-inform",
    note: `MUDIII — belief snapshot rendered for ${observerId} via beliefSnapshotFor (read-only, no tick run)`,
  };
}

// ---- beliefs and plans, recomputed live, no turn spent ----------------------

// The one puzzle this plan ships (PLAN_RIVER_CROSSING.md's R3): a world that
// carries no "ferry onto" action-signature has no puzzle plan to compute, so
// riverPuzzleOutlook stays null on the town square and any other board with
// no ferry action rule.
const RIVER_CROSSING_ACTION = "ferry onto";
const RIVER_CROSSING_GOAL = [{ universal: true, term: "passenger", predicate: "currently-in", object: "bank-west" }];

/** The river-crossing puzzle's own plan, recomputed from `rows`/`ruleRows` as
 *  they stand right now: the world's own action rules plus whatever
 *  action-constraint rows the drive facts themselves imply
 *  (constraintsFromDrives), searched the same way the chat lane solves
 *  data/games/river.txt. Null on a world whose rule rows carry no "ferry
 *  onto" action-signature, or whose action domain does not carry a
 *  "passenger" class the goal can quantify over. Returns `{ moves, plan,
 *  miss }`: `moves` is every legal move from the CURRENT position (the empty
 *  list when nothing may move), `plan` is the found action sequence or null,
 *  `miss` is null when a plan was found and the stated reason otherwise — a
 *  budget decline as well as an exhausted search, never a shortened plan
 *  either way. Pure. */
function riverPuzzleOutlook(rows, ruleRows) {
  const hasFerryAction = (ruleRows || []).some((r) => r.kind === "action-signature" && r.name === RIVER_CROSSING_ACTION);
  if (!hasFerryAction) return null;
  const derived = constraintsFromDrives(rows).map((slots) => ({ name: RIVER_CROSSING_ACTION, kind: "action-constraint", slots }));
  const domain = compileDomain(rows, [...(ruleRows || []), ...derived]);
  let isGoal;
  try {
    isGoal = compileGoal(RIVER_CROSSING_GOAL, domain);
  } catch {
    return null; // this board's action domain is not the river puzzle's own shape
  }
  const start = stateFromFacts(rows, domain);
  const moves = movesFromRules(start, domain).map((m) => m.action.label);
  const maxDepth = DEFAULT_GAME_CONFIG.planning.maxDepth;
  try {
    const found = findActionPath(start, isGoal, (s) => movesFromRules(s, domain), { maxDepth, stateKey: stateKeyFor });
    return { moves, plan: found ? found.actions : null, miss: found ? null : `no plan found within ${maxDepth} moves` };
  } catch (err) {
    if (!(err instanceof PlanBudgetError)) throw err;
    return { moves, plan: null, miss: `action grounding count ${err.groundings} exceeds the budget of ${err.budget}` };
  }
}

/** Every live agent's belief map and plan, computed from the store as it
 *  stands right now, without writing a fact or advancing a turn. Runs the
 *  SAME derivation runTownSquareTick's own decision phase performs
 *  (predator-prey.mjs's planTownSquareTurn) and reads only the answers — the
 *  rung, the goal line, the belief snapshot and the plan each live agent
 *  would carry into its NEXT tick — never a tick's effects (no eating, no
 *  spawn, no mass debit, no write).
 *
 *  `layout` is optional here (unlike runTownSquareTick, which requires one):
 *  a board with no town-square roster to decide over — the puzzle world
 *  before R6 wires it to a layout, or a caller asking only about `puzzle` —
 *  still gets its `puzzle` field computed, with `agents` empty rather than a
 *  thrown "no such layout".
 *
 *  Returns `{ turn, agents: { id: { rung, goal, belief, beliefOrigin, plan,
 *  traits } }, puzzle: { moves, plan, miss } | null }`. `beliefOrigin` mirrors
 *  `belief`'s own key set, each value `"seen"`, `{ told: turn }` or null —
 *  `beliefOriginOf` walking the exact cell/candidates/opts the tick's own
 *  belief snapshot was taken with (planTownSquareTurn's `beliefContext`), so
 *  a panel's cell and its "how it knows" label can never disagree.
 *
 *  Deterministic: a pure function of the store's current rows (and
 *  `toldFacts`), whatever order either arrived in. Two calls with no edit
 *  between them, or the same rows fed in twice in a different order, return
 *  deep-equal results. */
export async function agentOutlook(memoryDir, {
  layout = null, toldFacts = [], config = DEFAULT_GAME_CONFIG.mudiii, roles = MUDIII_ROLES,
} = {}) {
  const memory = await loadMemory(memoryDir);
  const rows = readFactRows(memory);
  const ruleRows = readRuleRows(memory);
  const state = foldTownSquareState(rows);

  const outlookAgents = {};
  if (layout) {
    const { agents, rungs, beliefContext, traitRows } =
      planTownSquareTurn(rows, state, { layout, config, roles, toldFacts, manualMoves: {} });
    for (const id of Object.keys(agents).sort()) {
      const ctx = beliefContext[id];
      const beliefOrigin = {};
      for (const candidateId of ctx.candidates) {
        if (candidateId === id) continue;
        beliefOrigin[candidateId] = beliefOriginOf(candidateId, id, ctx.cell, state, ctx.opts);
      }
      for (const candidateId of ctx.foodCandidates) {
        if (candidateId === id) continue;
        beliefOrigin[candidateId] = beliefOriginOf(candidateId, id, ctx.cell, state, ctx.foodOpts);
      }
      outlookAgents[id] = {
        rung: rungs[id],
        goal: agents[id].goal,
        belief: agents[id].belief,
        beliefOrigin,
        plan: agents[id].plan,
        traits: agentTraitsOf(traitRows, id),
      };
    }
  }

  return { turn: state.tickCount, agents: outlookAgents, puzzle: riverPuzzleOutlook(rows, ruleRows) };
}

function noLivePlacedSubjectAnswer(kind) {
  return {
    text: `there's no live ${kind} on the board for that to be about.`,
    lane: "game-inform",
    note: `MUDIII — who-placed declined: no live ${kind} resolves`,
    miss: true,
  };
}

/** "who put/placed <item|cell> there?": ground truth read off the folded
 *  state's own placedBy Map (predator-prey.mjs's fold of every mgx:placed-by
 *  row), never belief. Resolves the subject the same way the told-fact and
 *  see recognizers already do — resolveAgentId for a named item, a direct
 *  placements scan for a cell — then declines, naming the reason, when the
 *  item isn't on the board at all or is on the board but carries no placedBy
 *  row (spawned food never does; placeFood is the only writer of that row). */
async function mudiiiWhoPlacedAnswer(match, { memoryDir }) {
  const [, kindRaw, num, cellLiteral] = match;
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);

  let itemId = null;
  if (kindRaw) {
    itemId = resolveAgentId(kindRaw.toLowerCase(), num, state);
  } else {
    const entry = [...state.placements.entries()].find(([id, place]) =>
      isFoodId(id) && !state.removed.has(id) && place.cell === cellLiteral);
    itemId = entry ? entry[0] : null;
  }

  if (!itemId) {
    if (kindRaw) return noLivePlacedSubjectAnswer(kindRaw.toLowerCase());
    return {
      text: `there's no food at ${cellLiteral} to ask about.`,
      lane: "game-inform",
      note: `MUDIII — who-placed declined: no live food item sits at ${cellLiteral}`,
      miss: true,
    };
  }

  const placed = state.placedBy.get(itemId);
  if (!placed) {
    return {
      text: `${itemId} was never placed — it spawned on its own.`,
      lane: "game-inform",
      note: `MUDIII — who-placed declined: ${itemId} carries no mgx:placed-by row (spawned food)`,
      miss: true,
    };
  }

  return {
    text: `${placed.by} put ${itemId} at ${state.placements.get(itemId).cell}.`,
    lane: "game-inform",
    note: `MUDIII — who-placed answered from state.placedBy for ${itemId}`,
  };
}

/** The addressed teach-frame turn: resolve the addressee and the belief
 *  subject (an agent OR a food item), resolve the told cell, and run ONE tick
 *  with that told-fact fed in. Told-facts are not persisted across turns —
 *  each addressed line supplies belief for the NEXT tick only, mirroring
 *  spider-fly-turn.mjs's runToldFactTurn exactly. */
async function runToldFactTurn(match, { planHolder, memoryDir, cache, gameConfig = DEFAULT_GAME_CONFIG, world, layout }) {
  const [, addrKindRaw, addrNum, subjKindRaw, subjNum, direction, cellLiteral] = match;
  const addrKind = addrKindRaw.toLowerCase();
  const subjKind = subjKindRaw.toLowerCase();
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);

  const addresseeId = resolveAgentId(addrKind, addrNum, state);
  if (!addresseeId) return noSuchAgentAnswer(addrKind, "addressee");
  const addresseeCell = parseCellId(state.placements.get(addresseeId).cell);
  const subjectId = resolveNearestAgentId(subjKind, subjNum, state, addresseeCell);
  if (!subjectId) return noSuchAgentAnswer(subjKind, "subject");

  const targetCell = resolveTargetCell({ direction, cellLiteral, fromCell: addresseeCell, gridSize: layout.gridSize });
  if (!targetCell) {
    return {
      text: `that falls off the edge of the ${layout.gridSize}x${layout.gridSize} board from where the ${addrKind} is — try a direction or cell that stays on the board.`,
      lane: "game-inform",
      note: "MUDIII — told-fact declined: the resolved cell falls outside the board",
      miss: true,
    };
  }

  const targetCellId = cellId(targetCell.x, targetCell.y);
  const toldFacts = [{ subject: subjectId, toAgent: addresseeId, cell: targetCellId, turn: state.tickCount + 1 }];
  return runTickAndRender({
    planHolder, memoryDir, cache, world, toldFacts, gameConfig,
    addressedNote: `told the ${addresseeId} the ${subjectId} is at ${targetCellId}`,
  });
}

// ---- the teach lane: a declarative sentence read as a board fact -------------
//
// The town square's own half of the world-teach act world-teach.mjs performs
// for a manor and a burrow, and shaped the same way: a small closed sentence
// table, one additive planner over the live fold, and a "noted — … now."
// confirmation carrying the same `world:<name>:taught:turnK` provenance.
//
// It stays here rather than routing through world-teach.mjs because that
// module's gates are written for a ROOM world. It declines by naming rooms,
// mints a fresh portable when the subject is one the world has never heard
// of, and plans against foldWorldState. A board has cells instead of rooms
// and one fold of its own, and nothing here ever mints: every subject must
// already resolve to a live individual foldTownSquareState folds, or the
// write would put a fact on the board that the board cannot draw.

const PLACEMENT_PREDICATE = "mgx:currently-in";
const MASS_PREDICATE = "mgx:hasMass";
const MOOD_PREDICATE = "mgx:feels";
const FACING_PREDICATE = "mgx:facing";
const PLACED_BY_PREDICATE = "mgx:placed-by";

// The families foldTownSquareState ranks by (epoch, turn). A row in one of
// them needs a snapshot subject or it ranks as turn 0 and loses to anything
// already played about the same thing. mgx:placed-by is read raw and keeps
// its bare subject, exactly as placeFood writes it.
const TAUGHT_SNAPSHOT_PREDICATES = new Set([
  PLACEMENT_PREDICATE, MASS_PREDICATE, MOOD_PREDICATE, FACING_PREDICATE,
]);

// The closed cast vocabulary a taught sentence may name, matching the lane's
// own recognizers above. Mood and facing take an agent alone — a crumb has
// neither — while a cell and a weight are true of an inert item too.
const CAST_SUBJECT = "(fox|goblin|crumb|morsel)(?:-(\\d+))?";
const AGENT_SUBJECT = "(fox|goblin)(?:-(\\d+))?";
const ITEM_SUBJECT = "(crumb|morsel)(?:-(\\d+))?";

/**
 * The town square's sentence table: every fact about this board a person can
 * state, one row per predicate the fold reads. Checked in order, first match
 * wins.
 *
 *   Fox-1 is at cell-3-4.            mgx:currently-in
 *   The goblin weighs 4.             mgx:hasMass
 *   The fox feels angry.             mgx:feels
 *   Goblin-2 faces north.            mgx:facing
 *   The baker put morsel-1 there.    mgx:placed-by
 *
 * A bare kind ("the fox") names whichever individual of that kind is live and
 * lowest-numbered; a numbered id names exactly one. Closed on both sides: a
 * mood or a direction outside the engine's own words does not parse at all,
 * so nothing here can write a value a renderer has no drawing for.
 */
const TOWN_SQUARE_TEACH_PATTERNS = [
  { kind: "placement", predicate: PLACEMENT_PREDICATE,
    re: new RegExp(`^(?:the\\s+)?${CAST_SUBJECT}\\s+is\\s+at\\s+(cell-\\d+-\\d+)[.!\\s]*$`, "i") },
  { kind: "mass", predicate: MASS_PREDICATE,
    re: new RegExp(`^(?:the\\s+)?${CAST_SUBJECT}\\s+weighs\\s+(\\d+(?:\\.\\d+)?)[.!\\s]*$`, "i") },
  { kind: "mood", predicate: MOOD_PREDICATE,
    re: new RegExp(`^(?:the\\s+)?${AGENT_SUBJECT}\\s+feels\\s+(calm|angry|scared|happy)[.!\\s]*$`, "i") },
  { kind: "facing", predicate: FACING_PREDICATE,
    re: new RegExp(`^(?:the\\s+)?${AGENT_SUBJECT}\\s+faces\\s+(north|south|east|west)[.!\\s]*$`, "i") },
];

// The one sentence whose subject is not its leading noun: the item is the
// subject and the placer is the object, which is the direction "who put that
// there?" reads the row back in.
const TOWN_SQUARE_PLACED_BY_RE = new RegExp(
  `^(?:the\\s+)?([a-z][a-z-]*)\\s+(?:put|placed|dropped)\\s+(?:the\\s+)?${ITEM_SUBJECT}\\s+there[.!\\s]*$`,
  "i",
);

/** One line -> `{ kind, predicate, kindWord, num, object }`, or null when the
 *  table recognizes nothing — an honest miss, never a guessed shape.
 *  `kindWord`/`num` name the individual the sentence is about; the caller
 *  resolves that pair against the live board. Pure. */
export function parseTownSquareTeachLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  for (const { kind, predicate, re } of TOWN_SQUARE_TEACH_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    return { kind, predicate, kindWord: m[1].toLowerCase(), num: m[2] ?? null, object: m[3].toLowerCase() };
  }
  const placed = trimmed.match(TOWN_SQUARE_PLACED_BY_RE);
  if (!placed) return null;
  return {
    kind: "placed-by", predicate: PLACED_BY_PREDICATE,
    kindWord: placed[2].toLowerCase(), num: placed[3] ?? null, object: placed[1].toLowerCase(),
  };
}

/**
 * The rows one already-resolved taught triple implies against the board's
 * current fold — the town square's counterpart to mud-editor.mjs's
 * planTaughtMudTriple, and additive for the same reason: one sentence only
 * ever says what it says, so nothing it leaves out is evidence of anything.
 * Re-asserting a fact the board already holds appends nothing, and `reason`
 * says which of the two happened.
 *
 * Takes the fold alone rather than the raw rows its burrow counterpart also
 * needs: every family this table can say is one foldTownSquareState folds, so
 * there is no raw-row family left to diff against. Pure.
 */
export function planTaughtTownSquareTriple(state, triple) {
  if (!triple?.subject || !triple?.object) return { toAppend: [], reason: "nothing parsed" };
  const { subject, object } = triple;
  switch (triple.kind) {
    case "placement": {
      const current = state?.placements?.get(subject);
      if (current?.cell === object) return { toAppend: [], reason: `${subject} already stands at ${object}` };
      return {
        toAppend: [triple],
        reason: current ? `${subject} moves from ${current.cell} to ${object}` : `${subject} is placed at ${object}`,
      };
    }
    case "mass": {
      const current = state?.mass?.get(subject);
      if (current && Number(current.value) === Number(object)) return { toAppend: [], reason: `${subject} already weighs ${object}` };
      return { toAppend: [triple], reason: `${subject} weighs ${object}` };
    }
    case "mood": {
      const current = state?.mood?.get(subject);
      if (current?.value === object) return { toAppend: [], reason: `${subject} already feels ${object}` };
      return { toAppend: [triple], reason: `${subject} feels ${object}` };
    }
    case "facing": {
      const current = state?.facing?.get(subject);
      if (current?.value === object) return { toAppend: [], reason: `${subject} already faces ${object}` };
      return { toAppend: [triple], reason: `${subject} faces ${object}` };
    }
    case "placed-by": {
      const current = state?.placedBy?.get(subject);
      if (current?.by === object) return { toAppend: [], reason: `${object} already put ${subject} there` };
      return { toAppend: [triple], reason: `${object} put ${subject} there` };
    }
    default:
      return { toAppend: [], reason: `the board folds nothing for ${triple.predicate}` };
  }
}

/** One taught triple as the sentence the board says back, in world-teach.mjs's
 *  own `noted — … now.` shape. Pure. */
export function townSquareTeachConfirmation(triple) {
  switch (triple.kind) {
    case "placement": return `noted — ${triple.subject} is at ${triple.object} now.`;
    case "mass": return `noted — ${triple.subject} weighs ${triple.object} now.`;
    case "mood": return `noted — ${triple.subject} feels ${triple.object} now.`;
    case "facing": return `noted — ${triple.subject} faces ${triple.object} now.`;
    case "placed-by": return `noted — the ${triple.object} put ${triple.subject} there now.`;
    default: return "noted — the board says that now.";
  }
}

const teachDecline = (text, note) => ({ text, lane: "game-answer", note: `MUDIII — world-teach: ${note}`, miss: true });

/**
 * One line read as a fact about the LIVE board, or null when it is not a
 * teach sentence at all and the ordinary lane should have it. Writes the
 * fold-versioned families under a snapshot subject stamped at the next tick's
 * own turn number, the same convention placeFood uses so a teach and the tick
 * that resolves it share one turn rather than the teach quietly spending one.
 *
 * Nobody moves in response: a taught fact never runs the ecology pass, which
 * is the same trade world-teach.mjs makes for a manor.
 */
async function mudiiiTeachTurn(line, { memoryDir, cache, world, layout }) {
  const trimmed = String(line || "").trim();
  if (!trimmed || !memoryDir) return null;
  // A trailing "?" is an unambiguous question, and a leading interrogative is
  // the same signal one word earlier — a question must never reach a write
  // boundary. Both mirror world-teach.mjs, which stands down on either.
  if (/\?\s*$/.test(trimmed)) return null;
  if (QUESTION_LEAD_RE.test(correctMisspellings(trimmed))) return null;

  const parsed = parseTownSquareTeachLine(trimmed);
  if (!parsed) return null;

  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldTownSquareState(rows);
  const subject = resolveAgentId(parsed.kindWord, parsed.num, state);
  if (!subject) {
    return teachDecline(
      `there's no live ${parsed.kindWord} on the board for that to be about.`,
      `"${trimmed}" is about a ${parsed.kindWord} nothing live answers to; declined rather than minting one the board cannot draw`,
    );
  }

  if (parsed.kind === "placement") {
    const cell = parseCellId(parsed.object);
    if (!cell || !inBounds(layout.gridSize, cell.x, cell.y)) {
      return teachDecline(
        `${parsed.object} is off the board — this square runs cell-1-1 to cell-${layout.gridSize}-${layout.gridSize}.`,
        `"${trimmed}" names a cell outside the ${layout.gridSize}x${layout.gridSize} board`,
      );
    }
    if (isSolid(layout, parsed.object)) {
      return teachDecline(
        `${parsed.object} is blocked — nothing stands inside a building.`,
        `"${trimmed}" would stand ${subject} on a prop cell, which no path ever reaches`,
      );
    }
  }

  const triple = { subject, predicate: parsed.predicate, object: parsed.object, kind: parsed.kind };
  const { toAppend, reason } = planTaughtTownSquareTriple(state, triple);
  if (!toAppend.length) {
    return {
      text: "the board already says that.",
      lane: "game-answer",
      miss: false,
      note: `MUDIII — world-teach: "${trimmed}" asserts a fact the board already holds (${reason}); nothing written`,
      taught: [],
    };
  }

  const k = state.tickCount + 1;
  const epoch = state.epoch;
  const facts = toAppend.map((t) => ({
    subject: TAUGHT_SNAPSHOT_PREDICATES.has(t.predicate) ? snapshotSubject(t.subject, k, epoch) : t.subject,
    predicate: t.predicate,
    object: t.object,
  }));
  const provenance = `${worldProvenanceTag(world)}:taught:turn${k}`;
  await appendFacts(memoryDir, facts.map((f) => ({ ...f, provenance })));
  if (cache) cache.rows = null;

  return {
    text: townSquareTeachConfirmation(triple),
    lane: "game-answer",
    miss: false,
    goal: `change what the board says about ${subject}`,
    note: `MUDIII — world-teach: ${reason}; wrote ${facts.length} row(s) at turn ${k} with provenance ${provenance}; no tick rides a taught fact`,
    taught: facts,
  };
}

// ---- in-game orientation asides ---------------------------------------------
//
// "where is the fox", "where am I", "what can I do", "what is the fox's
// goal" — while the board is live these must answer from the board, not fall
// through to the code-graph lanes, where "where is the fox" would read "fox"
// as a module name. There is no player piece here (every fox and goblin
// moves on its own), so "where am I" reports the watcher stance.

const MUDIII_WHERE_AGENT_RE = /^where(?:'s|\s+is|\s+are)\s+(?:the\s+)?(fox|goblin)(?:-\d+)?(?:\s+now)?[?.!\s]*$/i;
const MUDIII_WHERE_AM_I_RE = /^where\s+am\s+i(?:\s+now)?[?.!\s]*$/i;
const MUDIII_OPTIONS_RE = /^(?:what\s+can\s+i\s+do(?:\s+(?:here|now))?|what\s+are\s+my\s+options|what\s+(?:should|do)\s+i\s+do(?:\s+(?:here|now))?|what\s+now)[?.!\s]*$/i;
const MUDIII_GOAL_AGENT_RE = /^what(?:'s|\s+is)\s+(?:the\s+)?(fox|goblin)(?:-\d+)?'s\s+goal[?.!\s]*$/i;
const MUDIII_GOAL_OF_RE = /^what(?:'s|\s+is)\s+(?:the\s+)?goal\s+of\s+the\s+(fox|goblin)(?:-\d+)?[?.!\s]*$/i;
const MUDIII_GOAL_GENERIC_RE = /^(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:goal|objective|point|aim)|what\s+are\s+they\s+(?:doing|trying\s+to\s+do))[?.!\s]*$/i;

const WATCHER_STANCE =
  'you have no piece here — every fox and goblin moves on its own. Watch, say "tick" to advance, or address one, e.g. "@fox the goblin is east".';
const OPTIONS_TEXT =
  'say "tick" to advance a turn, address an agent — e.g. "@fox the goblin is at cell-7-3" — or place food, e.g. "put food at cell-3-4". Say "stop watching" to end.';
const PREDATOR_GOAL_TEXT = "the fox hunts goblins for their mass, and keeps clear of any other fox it can see.";
const PREY_GOAL_TEXT = "goblins forage for crumbs and morsels, and evade any fox they can see — hunger loses to survival every time.";
const GENERIC_GOAL_TEXT =
  'the fox hunts the goblins; the goblins forage for food and evade the fox. You watch it play out — plant a belief to nudge one, place food to bait one, or say "tick" to advance.';

const positionsOfKind = (kind, state) =>
  liveIdsOfKind(state.placements, kind, state.removed).map((id) => `${id} at ${state.placements.get(id).cell}`);

async function mudiiiContextAnswer(line, { memoryDir }) {
  const l = String(line).trim();
  const whereAgent = l.match(MUDIII_WHERE_AGENT_RE);
  const asksWhereMe = MUDIII_WHERE_AM_I_RE.test(l);
  const asksOptions = MUDIII_OPTIONS_RE.test(l);
  const goalAgentMatch = l.match(MUDIII_GOAL_AGENT_RE) || l.match(MUDIII_GOAL_OF_RE);
  const asksGoalGeneric = MUDIII_GOAL_GENERIC_RE.test(l);
  if (!whereAgent && !asksWhereMe && !asksOptions && !goalAgentMatch && !asksGoalGeneric) return null;
  let state;
  try { state = foldTownSquareState(readFactRows(await loadMemory(memoryDir))); } catch { return null; }

  if (whereAgent) {
    const kind = whereAgent[1].toLowerCase();
    const positions = positionsOfKind(kind, state);
    return {
      text: positions.length ? `${positions.join("; ")}.` : `there's no live ${kind} on the board right now.`,
      lane: "game-answer",
      note: `MUDIII — where-aside: ${kind} positions from the current board fold`,
      goal: `find the ${kind}`,
      miss: !positions.length,
    };
  }

  if (asksWhereMe) {
    return { text: WATCHER_STANCE, lane: "game-inform", note: "MUDIII — where-am-I aside: the watcher stance (no player piece)", goal: "understand your role" };
  }

  if (asksOptions) {
    return { text: OPTIONS_TEXT, lane: "game-inform", note: "MUDIII — options aside: the live game's own commands", goal: "see what you can do" };
  }

  if (goalAgentMatch) {
    const kind = goalAgentMatch[1].toLowerCase();
    const text = kind === PREDATOR_KIND ? PREDATOR_GOAL_TEXT : PREY_GOAL_TEXT;
    return { text, lane: "game-inform", note: `MUDIII — goal aside: the ${kind}'s own role objective`, goal: `understand the ${kind}` };
  }

  return { text: GENERIC_GOAL_TEXT, lane: "game-inform", note: "MUDIII — goal aside: the game's predator/prey/forage objective", goal: "understand the game" };
}

// ---- the lane ------------------------------------------------------------

/**
 * The whole town-square lane for one turn: the opening moves (one per
 * layout), the stop command, the addressed teach-frame (agents and food
 * alike), the bare tick command, the food-placement verb, the belief and
 * orientation asides, and the one-at-a-time declines against the other
 * lanes sharing planState's slot. Returns { text, lane, note, goal?, miss? }
 * or null when the turn is not this lane's to answer.
 */
export async function mudiiiTurn(line, { planHolder, memoryDir, env, cache = null, isPlanFrameLine = () => false, gameConfig = DEFAULT_GAME_CONFIG }) {
  const slot = planHolder?.state ?? null;
  const mudiii = slot?.mudiii ?? null;
  const openingWorld = matchMudiiiOpening(line);

  if (!mudiii) {
    if (!openingWorld) return null;
    if (slot?.game) {
      return {
        text: 'a guess-the-number game is active — say "I give up" to end it, then start the town square.',
        lane: "game-inform",
        note: "MUDIII — an opening arrived mid-number-game; the slot holds one thing at a time",
      };
    }
    if (slot?.adventure) {
      return {
        text: 'an adventure is running — say "stop playing" to end it, then start the town square.',
        lane: "game-inform",
        note: "MUDIII — an opening arrived mid-adventure; the slot holds one thing at a time",
      };
    }
    if (slot?.spiderFly) {
      return {
        text: 'the spider-and-fly game is running — say "stop watching" to end it, then start the town square.',
        lane: "game-inform",
        note: "MUDIII — an opening arrived mid-spider-fly-game; the slot holds one thing at a time",
      };
    }
    const planActive = slot && !slot.done
      && ((Array.isArray(slot.goals) && slot.goals.length) || (Array.isArray(slot.actions) && slot.actions.length));
    if (planActive) {
      return {
        text: 'a plan is in progress — finish it or say "forget the goal" before we visit the town square.',
        lane: "game-inform",
        note: "MUDIII — an opening arrived while a plan frame is active; the slot holds one thing at a time",
      };
    }
    return openMudiiiGame(openingWorld, { planHolder, memoryDir, env, cache, gameConfig });
  }

  // A game is live.
  const layout = layoutNamed(mudiii.world);
  if (!layout) {
    planHolder.state = null;
    return {
      text: 'the town square\'s own board name did not resolve — the game ends here; say "visit the town square" to start fresh.',
      lane: "game-inform",
      note: `MUDIII — the plan slot named an unknown layout ("${mudiii.world}"); the game was ended rather than run against nothing`,
      miss: true,
    };
  }

  if (openingWorld) {
    return {
      text: 'the town square is already running — say "stop watching" to end it first.',
      lane: "game-inform",
      note: "MUDIII — an opening arrived mid-game; declined, the running game stands",
    };
  }
  if (MUDIII_STOP_RE.test(line)) {
    planHolder.state = null;
    return {
      text: 'OK — the town square game ends here. Everything the board wrote stays remembered; say "visit the town square" to pick it back up.',
      lane: "game-inform",
      note: "MUDIII — the game ended on request; the board's facts stay in the store",
    };
  }
  // The food verb is checked BEFORE the plan-frame guard below, because
  // "put food at cell-3-4" reads as a planning frame on its leading verb and
  // would otherwise be answered with "stop watching, then set your goal" — a
  // refusal to do the one thing this lane's own grammar most explicitly
  // offers. A line the lane owns outright is not a plan frame.
  const trimmed = String(line).trim();
  const putMatch = trimmed.match(MUDIII_PUT_FOOD_RE) || trimmed.match(MUDIII_DROP_FOOD_RE);
  if (putMatch) {
    return runPlaceFoodTurn(putMatch[1], { memoryDir, gameConfig, world: mudiii.world, layout });
  }

  // The teach switch runs before the plan-frame guard for the same reason the
  // food verb does: "the fox is at cell-3-4" reads as a planning frame on its
  // leading noun, and answering a sentence this lane's own table accepts with
  // "stop watching, then set your goal" refuses the one thing the switch is
  // for. With the switch off nothing here runs and the lane behaves exactly
  // as it always has.
  if (gameConfig?.mudiii?.teach) {
    const taught = await mudiiiTeachTurn(trimmed, { memoryDir, cache, world: mudiii.world, layout });
    if (taught) return taught;
  }

  if (isPlanFrameLine(line)) {
    return {
      text: 'the town square game is running — say "stop watching" to end it, then set your goal.',
      lane: "game-inform",
      note: "MUDIII — a plan frame arrived mid-game; the slot holds one thing at a time",
    };
  }

  if (MUDIII_ADDRESS_LEAD_RE.test(line)) {
    const told = trimmed.match(MUDIII_TOLD_RE);
    if (!told) {
      const addrKind = line.match(MUDIII_ADDRESS_LEAD_RE)[1].toLowerCase();
      return {
        text: `I heard you address the ${addrKind} but couldn't read a position from that — try "@${addrKind} the goblin is east" or "@${addrKind} the goblin is at cell-7-3".`,
        lane: "game-inform",
        note: "MUDIII — an addressed line didn't match the spatial teach-frame; honest decline, never a guess",
        miss: true,
      };
    }
    return runToldFactTurn(told, { planHolder, memoryDir, cache, gameConfig, world: mudiii.world, layout });
  }

  const seeMatch = trimmed.match(MUDIII_SEE_RE);
  if (seeMatch) {
    return mudiiiBeliefAnswer(seeMatch, { memoryDir, gameConfig });
  }

  const whoPlacedMatch = trimmed.match(MUDIII_WHO_PLACED_RE);
  if (whoPlacedMatch) {
    return mudiiiWhoPlacedAnswer(whoPlacedMatch, { memoryDir });
  }

  if (MUDIII_TICK_RE.test(line)) {
    return runTickAndRender({ planHolder, memoryDir, cache, world: mudiii.world, toldFacts: [], gameConfig });
  }

  const contextAside = await mudiiiContextAnswer(line, { memoryDir });
  if (contextAside) return contextAside;

  return null; // an unaddressed aside — the ordinary lanes answer, board untouched
}
