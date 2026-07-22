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
  DIRECTION_DELTA, WORLD_NAME, cellId, parseCellId, inBounds, chebyshevDistance, oneStepDirectionBetween,
} from "../domain/spider-fly-world.mjs";
import { foldSpiderFlyState, runSpiderFlyTick, startSpiderFlyGame, beliefSnapshotFor } from "./spider-fly.mjs";
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

// The observable-facts read: "what does the fly see?" / "what can the
// spider see?" — a closed vocabulary shape, styled after the other
// game-lane regexes above, with the same optional numbered suffix
// (SPIDER_FLY_ADDRESS_LEAD_RE's own "-<n>") for a board past one of a kind.
const SPIDER_FLY_SEE_RE = /^what (?:does|can) the (spider|fly)(?:-(\d+))?\s+see[.!?\s]*$/i;

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

// oneStepDirectionBetween lives in spider-fly-world.mjs (the shared grid
// geometry both this chat-turn layer and the engine need — see that
// module's own header comment); re-exported here so a caller of this file
// never has to reach into the domain layer just to build a deception pill's
// direction wording by hand.
export { oneStepDirectionBetween };

// ---- deception pills, built on the addressed teach-frame above: dynamic,
// per-tick chat-dock suggestions alongside (never replacing) the existing
// static 6-button address/direction rail. No new grammar at all — every
// pill's sentence is exactly the SAME SPIDER_FLY_TOLD_RE line above already
// accepts, filled in with either the subject's real position or a
// deliberately false one, so a human clicking one submits a plain
// "@spider the fly is east"-shaped line indistinguishable from a hand-typed
// claim, true or false alike. A pill's `truth` tag is for the human eye
// only — it never rides along in the submitted text itself.

const liveIdsOfKindFromAgents = (kind, agents) => {
  const re = new RegExp(`^${kind}-\\d+$`);
  return Object.keys(agents || {}).filter((id) => re.test(id)).sort();
};

/** "spider"/"fly" bare when exactly one individual of that kind is live
 *  (nothing to disambiguate), else the individual's own numbered id — a
 *  pill-set legibility choice, not a grammar restriction (the addressed
 *  teach-frame's own bare form always resolves to "the first live
 *  individual" regardless of count; this just stops offering a bare pill
 *  once it would read as ambiguous to a human watching two-plus). */
function agentPillLabel(kind, id, liveIdsOfKind) {
  return liveIdsOfKind.length > 1 ? id : kind;
}

/** The point reflection of `cell` through the 10x10 board's center —
 *  cell-<11-x>-<11-y> — the canonical false-claim cell: deterministic (no
 *  seeded RNG needed, since pills are never persisted state), always
 *  in-bounds (1..10 reflects onto 1..10), and never accidentally true (x =
 *  11-x has no integer solution for an integer x in 1..10, so the reflected
 *  cell can never coincide with the real one). */
function reflectedCell(cell) {
  return { x: 11 - cell.x, y: 11 - cell.y };
}

/**
 * The spider-fly chat dock's dynamic pill set for one tick's live `agents`
 * (runSpiderFlyTick's/foldSpiderFlyState's own `{ id: { cell } }` shape —
 * only `.cell` is read): one address pill per live spider/fly (bare
 * "@spider" while exactly one of that kind is alive, numbered "@spider-2"
 * once more than one is), plus — for whichever individual is currently
 * addressed (`explicitAddresseeId`, falling back to `opts.defaultKind`'s
 * first live individual, "spider" by default) — one true-claim and one
 * canonical false-claim pill per live individual of the OPPOSITE kind (you
 * address a spider about a fly's position, or a fly about a spider's — the
 * predator/prey belief channel the addressed teach-frame already carries).
 * A true-claim pill reads the nearest compass direction when the
 * candidate's real cell sits exactly one cardinal step from the addressee's
 * own cell (oneStepDirectionBetween), else the exact cell (always
 * expressible). A false-claim pill always reads the exact cell form,
 * holding the candidate's point-reflected cell (reflectedCell) — never a
 * direction, since a fabricated direction has no single canonical,
 * deterministic form the way a fabricated cell does.
 *
 * Returns `{ addressPills, claimPills, addresseeId }` — `addressPills` is
 * `[{ id, kind, label }]`; `claimPills` is `[{ subjectId, truth, text,
 * sentence }]` (`sentence` is the complete, ready-to-submit chat line);
 * both empty when nothing is live. `addresseeId` is whichever individual
 * the claim pills were actually built for (or null), so a caller can track
 * "currently addressing" across ticks without re-deriving it. Pure.
 */
export function pillsForSpiderFly(agents, explicitAddresseeId, opts = {}) {
  const { defaultKind = "spider" } = opts;
  const liveSpiders = liveIdsOfKindFromAgents("spider", agents);
  const liveFlies = liveIdsOfKindFromAgents("fly", agents);

  const addressPills = [
    ...liveSpiders.map((id) => ({ id, kind: "spider", label: `@${agentPillLabel("spider", id, liveSpiders)}` })),
    ...liveFlies.map((id) => ({ id, kind: "fly", label: `@${agentPillLabel("fly", id, liveFlies)}` })),
  ];

  const fallbackAddresseeId = (defaultKind === "fly" ? liveFlies[0] : liveSpiders[0]) ?? liveFlies[0] ?? liveSpiders[0] ?? null;
  const addresseeId = (explicitAddresseeId && agents[explicitAddresseeId]) ? explicitAddresseeId : fallbackAddresseeId;
  if (!addresseeId) return { addressPills, claimPills: [], addresseeId: null };

  const addresseeKind = /^spider-\d+$/.test(addresseeId) ? "spider" : "fly";
  const addresseeLabel = agentPillLabel(addresseeKind, addresseeId, addresseeKind === "spider" ? liveSpiders : liveFlies);
  const addresseeCell = parseCellId(agents[addresseeId].cell);

  const candidateKind = addresseeKind === "spider" ? "fly" : "spider";
  const candidateIds = candidateKind === "spider" ? liveSpiders : liveFlies;

  const claimPills = [];
  for (const subjectId of candidateIds) {
    const subjectLabel = agentPillLabel(candidateKind, subjectId, candidateIds);
    const trueCell = parseCellId(agents[subjectId].cell);
    const direction = oneStepDirectionBetween(addresseeCell, trueCell);
    // A direction reads "is east"; the exact-cell fallback (used whenever
    // there's no genuine one-step adjacency, and ALWAYS for the false claim
    // below) reads "is at cell-x-y" — the two forms SPIDER_FLY_TOLD_RE
    // itself accepts.
    const trueValue = direction ? direction : `at ${cellId(trueCell.x, trueCell.y)}`;
    const falseCell = reflectedCell(trueCell);
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
  }
  return { addressPills, claimPills, addresseeId };
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
  for (const c of eco.caught) events.push(`${c.spider} caught ${c.fly} at ${c.cell}`);
  for (const e of eco.eaten) events.push(`${e.fly} was eaten by ${e.spider} at ${e.cell}`);
  for (const f of eco.starved) events.push(`${f} starved`);
  if (eco.laid) events.push(`${eco.laid} was laid`);
  for (const h of eco.hatched) events.push(`${h.egg} hatched into ${h.spiders.map((s) => s.spider).join(" and ")} at ${h.cell}`);
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
  if (eco.caught.length) bits.push(`${eco.caught.length} caught`);
  if (eco.eaten.length) bits.push(`${eco.eaten.length} eaten`);
  if (eco.starved.length) bits.push(`${eco.starved.length} starved`);
  if (eco.laid) bits.push("1 laid");
  if (eco.hatched.length) bits.push(`${eco.hatched.reduce((n, h) => n + h.spiders.length, 0)} hatched`);
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

// ---- the observable-facts read: "what does the fly see?" -----------------

/** One `[id, cellId | null]` belief entry as a sentence: `"spider-1 is at
 *  cell-3-4."` when observed/told, `"fly-2 has not been observed."`
 *  otherwise — the same wording spider-fly-viz.mjs's own click-expand panel
 *  (observedFactsHtml) renders, so the chat phrasing and the browser panel
 *  never disagree about what an agent can see. */
function observedFactSentence(id, believedCell) {
  return believedCell ? `${id} is at ${believedCell}.` : `${id} has not been observed.`;
}

/** "what does the fly see?" / "what does the spider see?" rendered as plain
 *  text: the same beliefSnapshotFor read spider-fly.mjs's own tick loop and
 *  the browser panel already use, over the CURRENT board state — read-only,
 *  no tick runs, nothing is written. Candidates are every OTHER live agent
 *  of either kind; toldFacts is empty (a told position only ever arrives
 *  fresh alongside a tick — see runToldFactTurn — so there is none standing
 *  between ticks to read back here). */
async function spiderFlyBeliefAnswer(match, { memoryDir, gameConfig = DEFAULT_GAME_CONFIG }) {
  const kind = match[1].toLowerCase();
  const num = match[2];
  const rows = readFactRows(await loadMemory(memoryDir));
  const state = foldSpiderFlyState(rows);
  const observerId = resolveAgentId(kind, num, state);
  if (!observerId) return noSuchAgentAnswer(kind, "addressee");
  const observerCell = parseCellId(state.placements.get(observerId).cell);
  const candidateIds = [...liveIdsOfKind("spider", state), ...liveIdsOfKind("fly", state)];
  const visionRadius = kind === "spider"
    ? gameConfig?.spiderFly?.spiderVisionRadius
    : gameConfig?.spiderFly?.flyVisionRadius;
  const belief = beliefSnapshotFor(observerId, observerCell, candidateIds, state, { visionRadius });
  const entries = Object.entries(belief);
  const text = entries.length
    ? `${observerId} sees: ${entries.map(([id, cell]) => observedFactSentence(id, cell)).join(" ")}`
    : `${observerId} is alone on the board — nothing else to see.`;
  return {
    text,
    lane: "game-inform",
    note: `SPIDER-FLY — belief snapshot rendered for ${observerId} via beliefSnapshotFor (read-only, no tick run)`,
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

// ---- in-game orientation asides ---------------------------------------------
//
// "where is the spider", "where am I", "what can I do", "what is the goal" —
// while the board is live these must answer from the board, not fall through to
// the code-graph lanes, where "where is the spider" reads "spider" as a module
// name and "what is the goal" answers from corpus vocabulary. There is no
// player piece here (both agents move on their own), so "where am I" reports
// the watcher stance and where the pieces stand.

const SF_WHERE_AGENT_RE = /^where(?:'s|\s+is|\s+are)\s+(?:the\s+)?(spider|fly)(?:-\d+)?(?:\s+now)?[?.!\s]*$/i;
const SF_WHERE_AM_I_RE = /^where\s+am\s+i(?:\s+now)?[?.!\s]*$/i;
const SF_OPTIONS_RE = /^(?:what\s+can\s+i\s+do(?:\s+(?:here|now))?|what\s+are\s+my\s+options|what\s+(?:should|do)\s+i\s+do(?:\s+(?:here|now))?|what\s+now)[?.!\s]*$/i;
const SF_GOAL_RE = /^(?:what(?:'s|\s+is)\s+(?:the\s+|my\s+)?(?:goal|objective|point|quest|aim)|what\s+are\s+they\s+(?:doing|trying\s+to\s+do)|what\s+am\s+i\s+(?:trying\s+to\s+do|(?:supposed|meant)\s+to\s+do))[?.!\s]*$/i;

const WATCHER_STANCE = 'you have no piece here — both agents move on their own. Watch, say "tick" to advance, or address one, e.g. "@spider the fly is east".';

const positionsOfKind = (kind, state) =>
  liveIdsOfKind(kind, state).map((id) => `${id} at ${state.placements.get(id).cell}`);

async function spiderFlyContextAnswer(line, { memoryDir }) {
  const l = String(line).trim();
  const whereAgent = l.match(SF_WHERE_AGENT_RE);
  const asksWhereMe = SF_WHERE_AM_I_RE.test(l);
  const asksOptions = SF_OPTIONS_RE.test(l);
  const asksGoal = SF_GOAL_RE.test(l);
  if (!whereAgent && !asksWhereMe && !asksOptions && !asksGoal) return null;
  let state;
  try { state = foldSpiderFlyState(readFactRows(await loadMemory(memoryDir))); } catch { return null; }

  if (whereAgent) {
    const kind = whereAgent[1].toLowerCase();
    const positions = positionsOfKind(kind, state);
    return {
      text: positions.length ? `${positions.join("; ")}.` : `there's no live ${kind} on the board right now.`,
      lane: "game-answer",
      note: `SPIDER-FLY — where-aside: ${kind} positions from the current board fold`,
      goal: `find the ${kind}`,
      miss: !positions.length,
    };
  }

  if (asksWhereMe) {
    return { text: WATCHER_STANCE, lane: "game-inform", note: "SPIDER-FLY — where-am-I aside: the watcher stance (no player piece)", goal: "understand your role" };
  }

  if (asksOptions) {
    return {
      text: 'say "tick" to advance a turn, or address an agent — e.g. "@spider the fly is east" or "@spider the fly is at cell-7-3" to plant a belief. Say "stop watching" to end.',
      lane: "game-inform",
      note: "SPIDER-FLY — options aside: the live game's own commands",
      goal: "see what you can do",
    };
  }

  return {
    text: "the spider hunts the fly; the fly tries to stay clear. You watch it play out — plant a belief to nudge one, or say \"tick\" to advance.",
    lane: "game-inform",
    note: "SPIDER-FLY — goal aside: the game's predator/prey objective",
    goal: "understand the game",
  };
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

  const seeMatch = String(line).trim().match(SPIDER_FLY_SEE_RE);
  if (seeMatch) {
    return spiderFlyBeliefAnswer(seeMatch, { memoryDir, gameConfig });
  }

  if (SPIDER_FLY_TICK_RE.test(line)) {
    return runTickAndRender({ planHolder, memoryDir, cache, toldFacts: [], gameConfig });
  }

  const contextAside = await spiderFlyContextAnswer(line, { memoryDir });
  if (contextAside) return contextAside;

  return null; // an unaddressed aside — the ordinary lanes answer, board untouched
}
