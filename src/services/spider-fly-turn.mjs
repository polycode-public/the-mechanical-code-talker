// spider-fly-turn.mjs — the chat lane for the headless spider-and-fly game
// (PLAN_SPIDER_FLY.md §6): loading the shipped board into the session's
// memory store, the stop command, the addressed spatial teach-frame that
// feeds a told-fact into the next tick, and the bare "tick" command this
// game's no-player-controlled-entity posture (§1 — both agents move on
// their own, every turn) needs for CLI use. Mirrors adventure.mjs's own
// shape exactly: closed-regex openers/stop, a slot-tagged one-at-a-time
// coexistence check against the other two lanes, a lane function returning
// { text, goal?, lane, note, miss? } or null when the turn is not this
// lane's to answer. The fourth of the four lanes sharing planState's slot.
//
// This module never plans a path or scores a move itself — every bit of
// game logic (fold, pathfinding, belief, ecology) lives in spider-fly.mjs;
// this file only recognizes chat shapes, resolves them to the shapes
// runSpiderFlyTick's own interface accepts, and renders its return value as
// chat text.

import {
  DIRECTION_DELTA, WORLD_NAME, cellId, parseCellId, inBounds, chebyshevDistance,
} from "../domain/spider-fly-world.mjs";
import { foldSpiderFlyState, runSpiderFlyTick, startSpiderFlyGame } from "./spider-fly.mjs";
import { worldProvenanceTag } from "../domain/worlds-pack.mjs";
import { getWorldsPackProvider } from "../adapters/corpus/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows } from "../adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";

// ---- recognizers: the closed opening/stop/tick/address set -------------------

// The opener names the game without requiring a specific phrasing order —
// "watch the spider and the fly" / "play spider and fly" / "play spider fly"
// (the "and" is optional — playtests/PLAYTEST_LOG_006.md found it's a
// natural drop) / "start the spider game" all match. Closed vocabulary only
// (watch/play/start/begin, spider, fly, game) — no general "start X"
// grammar, matching this project's standing preference and adventure.mjs's
// own opener style.
const SPIDER_FLY_OPEN_RE =
  /^(?:let'?s\s+)?(?:watch|play|start|begin)\s+(?:the\s+)?spider(?:\s+(?:and\s+)?(?:the\s+)?fly)?(?:\s+game)?[.!?\s]*$/i;
// "stop watching" is this game's own stop word (there's nothing to "play" in
// the sense of typing moves — you watch, or address an agent), kept
// alongside "stop playing" so either reads naturally depending on how the
// player thinks of the session.
const SPIDER_FLY_STOP_RE =
  /^(?:stop\s+(?:watching|playing)|quit\s+(?:the\s+)?(?:spider\s+and\s+fly\s+)?game|end\s+the\s+spider(?:\s+and\s+fly)?\s+game|leave\s+the\s+game)[.!?\s]*$/i;
// The bare tick command — NOT specified by PLAN_SPIDER_FLY.md itself (§11's
// Play/step button is the page's own answer to "nothing requires the human
// to act"; this is that same need's CLI/chat equivalent). Styled after the
// plan lane's own PLAN_NEXT_RE ("next"/"next move"/"go on"/"continue").
const SPIDER_FLY_TICK_RE = /^(?:tick|next\s+turn|advance(?:\s+the\s+turn)?)[.!?\s]*$/i;

// The spatial teach-frame (§6.1): "@spider the fly is east" / "@spider the
// fly is at cell-7-3". Its own closed regex, not a route through
// parseRelation/parseCopula/parseOfForm — §6.1 found both hit real grammar
// gaps for this exact shape (the bare copula reading mints a nonsense
// subclass axiom; the "of" form hits parseAce's own hard-null guard before
// ever reaching parseRelation/parseCopula). A fixed compass set — north,
// south, east, west only, since the grid has no vertical axis — rather than
// ace.mjs's own IMPERATIVE_DIRECTIONS (private to that module, and carries
// up/down which never apply here). "@" is required (never optional) per the
// design brief's own worked examples. An optional numeric suffix on either
// noun ("spider-2", "fly-3") supports a board that has grown past one of
// each through the egg/hatch/spawn ecology.
const SPIDER_FLY_ADDRESS_LEAD_RE = /^@(spider|fly)(?:-(\d+))?\b/i;
const SPIDER_FLY_TOLD_RE = new RegExp(
  "^@(spider|fly)(?:-(\\d+))?[,:]?\\s+the\\s+(spider|fly)(?:-(\\d+))?\\s+is\\s+"
  + "(?:(north|south|east|west)|at\\s+(cell-\\d+-\\d+))[.!?\\s]*$",
  "i",
);

const WORLD_OPENING_FALLBACK =
  "a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to move — watch, or address one by name in chat.";

// ---- the opening turn: load the shipped board through the worlds pack -------

async function openSpiderFlyGame({ planHolder, memoryDir, env, cache, gameConfig = DEFAULT_GAME_CONFIG }) {
  if (!memoryDir) {
    return {
      text: "the spider-and-fly game needs a session with a memory store to hold the board — start tmct inside a repo first.",
      lane: "game-inform",
      note: "SPIDER-FLY — opening declined: no memory store to load the board into",
    };
  }
  const provider = getWorldsPackProvider(env);
  let payload = null;
  try { payload = await provider.load(WORLD_NAME); } catch { payload = null; }
  if (!payload) {
    return {
      text: 'no worlds pack here — the spider-and-fly board ships in corpus/worlds/ (or the directory TMCT_WORLDS_PACK_DIR names), and it is missing or unreadable, so there is no board to load.',
      lane: "game-inform",
      note: "SPIDER-FLY — opening declined: the worlds pack is absent/unreadable",
    };
  }

  const tag = worldProvenanceTag(WORLD_NAME);
  await appendFacts(memoryDir, payload.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of payload.rules) {
    try { await appendRule(memoryDir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag }); }
    catch { /* one malformed rule row loses that rule, not the board */ }
  }
  if (cache) cache.rows = null; // the fact-rows cache predates these writes

  const { started } = await startSpiderFlyGame(memoryDir, { flyCount: 1, config: gameConfig?.spiderFly });
  planHolder.state = { spiderFly: { turn: 0 } };
  const opener = started
    ? (payload.meta?.opening || WORLD_OPENING_FALLBACK)
    : 'back to the spider-and-fly board — the spider and fly are already in play. Say "tick" to advance, or address one, e.g. "@spider the fly is east".';
  return {
    text: opener,
    goal: 'watch the spider and fly, or address one (e.g. "@spider the fly is east")',
    lane: "game-inform",
    note: `SPIDER-FLY — loaded the board from the worlds pack into this session's memory (facts + rule rows, provenance ${tag}) and ${started ? "minted" : "found"} the starting agents`,
  };
}

// ---- resolving an addressed agent / belief target ----------------------------

const liveIdsOfKind = (kind, state) => {
  const re = new RegExp(`^${kind}-\\d+$`);
  return [...state.placements.keys()].filter((id) => re.test(id) && !state.removed.has(id)).sort();
};

/** An exact "kind-num" reference, or (no number given) the first live
 *  individual of that kind — null when nothing live matches. */
function resolveAgentId(kind, num, state) {
  if (num) {
    const id = `${kind}-${num}`;
    return state.placements.has(id) && !state.removed.has(id) ? id : null;
  }
  const live = liveIdsOfKind(kind, state);
  return live[0] ?? null;
}

/** Same as resolveAgentId, but with no number given it picks the live
 *  individual NEAREST `nearCell` — the natural reading of "the fly" from a
 *  particular addressee's own position once the ecology has minted more
 *  than one spider or fly. */
function resolveNearestAgentId(kind, num, state, nearCell) {
  if (num) return resolveAgentId(kind, num, state);
  const live = liveIdsOfKind(kind, state);
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
  return { text, lane: "game-inform", note: `SPIDER-FLY — told-fact declined: no live ${kind} resolves as the ${role}`, miss: true };
}

/** The believed target cell, either the literal cell-<x>-<y> or the
 *  addressee's own current cell shifted one step in the stated compass
 *  direction — null when the result would fall off the 10x10 board. */
function resolveTargetCell({ direction, cellLiteral, fromCell }) {
  if (cellLiteral) {
    const parsed = parseCellId(cellLiteral);
    return parsed && inBounds(parsed.x, parsed.y) ? parsed : null;
  }
  const delta = DIRECTION_DELTA[direction.toLowerCase()];
  const nx = fromCell.x + delta.dx;
  const ny = fromCell.y + delta.dy;
  return inBounds(nx, ny) ? { x: nx, y: ny } : null;
}

// ---- rendering one tick's return value as plain chat text --------------------

function renderTickText(tick, addressedNote) {
  const parts = [];
  if (addressedNote) parts.push(`${addressedNote}.`);
  const ids = Object.keys(tick.agents).sort();
  parts.push(ids.length
    ? `Turn ${tick.turn} — ${ids.map((id) => `${id} is now at ${tick.agents[id].cell}`).join("; ")}.`
    : `Turn ${tick.turn} — no agents remain on the board.`);
  const eco = tick.ecology;
  const events = [];
  for (const e of eco.eaten) events.push(`${e.fly} was eaten by ${e.spider} at ${e.cell}`);
  for (const f of eco.starved) events.push(`${f} starved`);
  if (eco.laid) events.push(`${eco.laid} was laid`);
  for (const h of eco.hatched) events.push(`${h.egg} hatched into ${h.spider} at ${h.cell}`);
  if (eco.spawned) events.push(`${eco.spawned} arrived at the board edge`);
  if (events.length) parts.push(`${events.join("; ")}.`);
  return parts.join(" ");
}

/** Both agents' own goal lines folded into ONE string — withGoalLine only
 *  renders a single "Goal (inferred): …" suffix per turn, and this game
 *  always has two live agents (at minimum) with independent goals, so
 *  calling it once per agent isn't an option without restructuring the
 *  shared pipeline. Each fragment's own trailing period is stripped so the
 *  combined string still reads as ONE sentence once withGoalLine appends its
 *  own final period. */
function combinedGoalLine(agents) {
  const ids = Object.keys(agents).sort();
  if (!ids.length) return null;
  return ids.map((id) => `${id} — ${agents[id].goal.replace(/\.\s*$/, "")}`).join("; ");
}

function describeEcologyNote(eco) {
  const bits = [];
  if (eco.eaten.length) bits.push(`${eco.eaten.length} eaten`);
  if (eco.starved.length) bits.push(`${eco.starved.length} starved`);
  if (eco.laid) bits.push("1 laid");
  if (eco.hatched.length) bits.push(`${eco.hatched.length} hatched`);
  if (eco.spawned) bits.push("1 spawned");
  return bits.length ? `; ${bits.join(", ")}` : "";
}

async function runTickAndRender({ planHolder, memoryDir, cache, toldFacts = [], addressedNote = null, gameConfig = DEFAULT_GAME_CONFIG }) {
  const tick = await runSpiderFlyTick(memoryDir, { toldFacts, config: gameConfig?.spiderFly });
  if (cache) cache.rows = null;
  planHolder.state = { spiderFly: { turn: tick.turn } };
  return {
    text: renderTickText(tick, addressedNote),
    goal: combinedGoalLine(tick.agents),
    lane: "game-answer",
    note: `SPIDER-FLY — turn ${tick.turn}: ran runSpiderFlyTick (${toldFacts.length ? "with an addressed told-fact" : "no addressed target"})${describeEcologyNote(tick.ecology)}`,
  };
}

/** The addressed teach-frame turn: resolve the addressee and the belief
 *  subject, resolve the told cell, and run ONE tick with that told-fact fed
 *  in. Told-facts are NOT persisted on the session slot across turns — each
 *  addressed line supplies belief for the NEXT tick only, then is gone
 *  (the simplest of the plan doc's own named options, §4's "carry only the
 *  current turn's told-facts"). This also matches how runSpiderFlyTick
 *  itself already works: it holds no standing plan or belief between calls,
 *  recomputing everything fresh from the folded fact rows every tick. */
async function runToldFactTurn(match, { planHolder, memoryDir, cache, gameConfig = DEFAULT_GAME_CONFIG }) {
  const [, addrKindRaw, addrNum, subjKindRaw, subjNum, direction, cellLiteral] = match;
  const addrKind = addrKindRaw.toLowerCase();
  const subjKind = subjKindRaw.toLowerCase();
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldSpiderFlyState(rows);

  const addresseeId = resolveAgentId(addrKind, addrNum, state);
  if (!addresseeId) return noSuchAgentAnswer(addrKind, "addressee");
  const addresseeCell = parseCellId(state.placements.get(addresseeId).cell);
  const subjectId = resolveNearestAgentId(subjKind, subjNum, state, addresseeCell);
  if (!subjectId) return noSuchAgentAnswer(subjKind, "subject");

  const targetCell = resolveTargetCell({ direction, cellLiteral, fromCell: addresseeCell });
  if (!targetCell) {
    return {
      text: `that falls off the edge of the 10x10 board from where the ${addrKind} is — try a direction or cell that stays on the board.`,
      lane: "game-inform",
      note: "SPIDER-FLY — told-fact declined: the resolved cell falls outside the board",
      miss: true,
    };
  }

  const targetCellId = cellId(targetCell.x, targetCell.y);
  const toldFacts = [{ subject: subjectId, toAgent: addresseeId, cell: targetCellId, turn: state.turnCount + 1 }];
  return runTickAndRender({
    planHolder, memoryDir, cache, toldFacts, gameConfig,
    addressedNote: `told the ${addresseeId} the ${subjectId} is at ${targetCellId}`,
  });
}

// ---- the lane ------------------------------------------------------------

/**
 * The whole spider-and-fly lane for one turn: the opening moves, the stop
 * command, the addressed spatial teach-frame (§6.1), the bare tick command,
 * and the one-at-a-time declines across the shared plan slot both other
 * lanes already implement pairwise. Returns { text, lane, note, goal?,
 * miss? } or null when the turn is not this lane's to answer — an
 * unaddressed aside (e.g. "where is the spider") falls through to the
 * ordinary lanes unchanged, board untouched (§6.2 — no special-cased
 * spider-fly code path for plain questions).
 */
export async function spiderFlyTurn(line, { planHolder, memoryDir, env, cache = null, isPlanFrameLine = () => false, gameConfig = DEFAULT_GAME_CONFIG }) {
  const slot = planHolder?.state ?? null;
  const spiderFly = slot?.spiderFly ?? null;
  const opening = SPIDER_FLY_OPEN_RE.test(line);

  if (!spiderFly) {
    if (!opening) return null;
    if (slot?.game) {
      return {
        text: 'a guess-the-number game is active — say "I give up" to end it, then start the spider-and-fly game.',
        lane: "game-inform",
        note: "SPIDER-FLY — an opening arrived mid-number-game; the slot holds one thing at a time",
      };
    }
    if (slot?.adventure) {
      return {
        text: 'an adventure is running — say "stop playing" to end it, then start the spider-and-fly game.',
        lane: "game-inform",
        note: "SPIDER-FLY — an opening arrived mid-adventure; the slot holds one thing at a time",
      };
    }
    const planActive = slot && !slot.done
      && ((Array.isArray(slot.goals) && slot.goals.length) || (Array.isArray(slot.actions) && slot.actions.length));
    if (planActive) {
      return {
        text: 'a plan is in progress — finish it or say "forget the goal" before we start the spider-and-fly game.',
        lane: "game-inform",
        note: "SPIDER-FLY — an opening arrived while a plan frame is active; the slot holds one thing at a time",
      };
    }
    return openSpiderFlyGame({ planHolder, memoryDir, env, cache, gameConfig });
  }

  // A game is live.
  if (opening) {
    return {
      text: 'the spider-and-fly game is already running — say "stop watching" to end it first.',
      lane: "game-inform",
      note: "SPIDER-FLY — an opening arrived mid-game; declined, the running game stands",
    };
  }
  if (SPIDER_FLY_STOP_RE.test(line)) {
    planHolder.state = null;
    return {
      text: 'OK — the spider-and-fly game ends here. Everything the board wrote stays remembered; say "watch the spider and the fly" to pick it back up.',
      lane: "game-inform",
      note: "SPIDER-FLY — the game ended on request; the board's facts stay in the store",
    };
  }
  if (isPlanFrameLine(line)) {
    return {
      text: 'the spider-and-fly game is running — say "stop watching" to end it, then set your goal.',
      lane: "game-inform",
      note: "SPIDER-FLY — a plan frame arrived mid-game; the slot holds one thing at a time",
    };
  }

  if (SPIDER_FLY_ADDRESS_LEAD_RE.test(line)) {
    const told = String(line).trim().match(SPIDER_FLY_TOLD_RE);
    if (!told) {
      const addrKind = line.match(SPIDER_FLY_ADDRESS_LEAD_RE)[1].toLowerCase();
      return {
        text: `I heard you address the ${addrKind} but couldn't read a position from that — try "@${addrKind} the fly is east" or "@${addrKind} the fly is at cell-7-3".`,
        lane: "game-inform",
        note: "SPIDER-FLY — an addressed line didn't match the spatial teach-frame; honest decline, never a guess",
        miss: true,
      };
    }
    return runToldFactTurn(told, { planHolder, memoryDir, cache, gameConfig });
  }

  if (SPIDER_FLY_TICK_RE.test(line)) {
    return runTickAndRender({ planHolder, memoryDir, cache, toldFacts: [], gameConfig });
  }

  return null; // an unaddressed aside — the ordinary lanes answer, board untouched
}
