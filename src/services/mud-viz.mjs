// mud-viz.mjs — mud.html: the self-contained proof of the shared,
// multi-character shape PLAN_MUD.md's "Demo phase" section describes. One,
// two or four burrowing animals — the deck's own players slider picks how
// many — are drawn from the world's roster and each get their own pane over
// ONE shared live world (mud-browser-entry.mjs's createMudSession); an
// omniscient survey of the whole burrow sits in the top row beside the
// controls with no fog of war at all, the one deliberate exception
// PLAN_MUD.md names.
//
// The deck's second cast slider adds NPCs: one to ten more animals in the
// same world, drawn from the same roster, running the same scripted turn as
// a pane's own character and differing in exactly one way — no pane. They are
// ordinary world individuals throughout, so every reader here (the survey,
// a pane's room view, the talk affordances, the room caption) picks them up
// as "another character present" without knowing they exist. Two things do
// know: the survey draws them in one shared colour because the four actor
// hues belong to the panes, and the eaten scene needs a pane to play in, so a
// taken NPC just stops. They carry no mgx:is-npc marker either — that
// predicate drives adventure.mjs's scripted-by-data scheduler, which is a
// different mechanism from these.
//
// The stage is built in the browser, never fixed at build time: paneMarkup is
// spliced into the page script alongside the render glue, and every boot
// rebuilds #mudStage with one call per cast member. The page ships the
// default cast's panes so the first paint is not an empty box, and the grid
// reads how many to lay out off the stage's own data-panes attribute.
//
// Shaped after adventure-viz.mjs/spider-fly-viz.mjs: one inlined <style>
// over viz-theme.mjs's shared tokens, behaviour as an inlined IIFE, the
// engine arriving via a sibling <script src="./mud-browser.bundle.js">
// (mirroring adventure-viz.mjs's own worldPayload-embedding rationale — the
// world's canonical source is a Node-only gzipped JSONL shard the browser
// cannot read, so it is read ONCE at build time through the real worlds-pack
// provider and embedded as page data). `createTicker` and a small set of
// self-contained, `.toString()`-splice-safe room-scene helpers are spliced
// into the inline script exactly the way spider-fly-viz.mjs splices its own
// render-glue — `roomSceneObjects`/`scenePlacement`/`spriteClassForObject`/
// `spriteAncestryRows`/`factsForSubject`/`visibleRoomOf`/`roomKindForRoom`
// are REUSED directly from adventure-viz.mjs rather than re-derived:
// mud-garden ships no individual
// named "player" (the whole point of the multi-character demo), so those
// functions' own hardcoded "player" exclusion never fires for a mud
// character — every character reads back as an ordinary visible object of
// its room until this page's own code filters the CURRENT viewing character
// out by name (mudRoomSceneObjects, below).
//
// A room's graphic is a rendering of worldDigestRows'/roomAffordances' own
// text digest, never a replacement for it (PLAN_MUD.md's own "Room view"
// spec): a soil-toned canvas backdrop (roomKindForRoom picks outdoor/
// underground), the viewing character's own sprite standing right, every
// room-mate entering from the left, and every loose object hung on the back
// wall in a portrait frame (scenePlacement decides how high it hangs). The
// six compass affordances sit around that box where their own directions
// point, each one either the "go" a written exit already allows or the "dig"
// that would open one.
//
// The burrow survey is ONE svg routine (burrowSvg over burrowGraph) drawn
// twice: the omniscient board in the top row, and each pane's own
// visited-only "known ground". Same layout, same treatment, one code path —
// burrowGraph/burrowSvg are thin wrappers over viz-room-graph.mjs's shared
// directedGridLayout/roomGraphSvg (the same pair adventure-viz.mjs draws its
// own manor board from), passing the `root`/`nudgeCollisions`/`turf` options a
// burrow needs and a manor does not (a mud character can dig down AND south
// out of one room, and both land on the same grid cell otherwise).
//
// ONE ticker instance per pane (viz-ticker.mjs's createTicker), so
// each can play/step independently, plus the deck's own "play" control that
// calls .play()/.pause() on both pane tickers at once. Nothing plays until
// that control is clicked. Every tick, from ANY pane, is funneled through one
// shared async queue (serializeTick, wrapping viz-ticker.mjs's own
// createSerialQueue) so two characters' turns can never interleave their
// reads/writes of the one shared memoryDir — mud-browser-entry.mjs's own
// header names this as the caller's responsibility, and this is where that
// responsibility is discharged. The queue is also what makes the deck's
// GLOBAL turn counter well-defined: it increments in the exact order turns
// actually executed, never a race between panes.
import {
  THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText, scenarioLabel,
  wordBeforeCursor, rowsForWorld, appendLogLine, demoEyebrowHtml, EYEBROW_LINKS_CSS,
} from "./viz-theme.mjs";
import { createTicker, createSerialQueue } from "./viz-ticker.mjs";
import { directedGridLayout, roomGraphSvg, levelsOf, EXIT_DELTA } from "./viz-room-graph.mjs";
import {
  roomSceneObjects, scenePlacement, spriteClassForObject, spriteAncestryRows, factsForSubject,
  visibleRoomOf, roomKindForRoom, allRoomIds,
} from "./adventure-viz.mjs";
import { renderMudEditorText } from "./mud-editor.mjs";
import {
  wireStateLabel, nodeRowsFor, nodeInitials, inviteLinkFor, inviteParamsFrom, tapeRowFor, tapeClock,
} from "./chat-page-viz.mjs";
import {
  SHARE_OVERLAY_CSS, shareOverlayHtml, shareStepStates, activeWaves, offerBlobIn, peerTerm,
  shareMessageFor, replyMessageFor, whatsAppShareUrl, isProbablyMobile, copyTextToClipboard, flashCopyTip,
} from "./share-overlay-viz.mjs";
export { offerBlobIn, peerTerm };
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";
import { fnv1a32 } from "../domain/hash.mjs";
import { predatorSubjects } from "../domain/mud-facts.mjs";

const DEFAULT_TITLE = "tmct — the mud";
// No display-face embedding pipeline exists anywhere in this project yet
// (grep turns up no @font-face/font-display in any *-viz.mjs) — Fraunces
// itself never ships, so DISPLAY_STACK is SERIF_STACK's own web-safe serif
// fallback, named separately only so a later session that DOES add a font
// pipeline has one obvious constant to point at Fraunces instead of typing
// "Georgia" into headings by hand.
const DISPLAY_STACK = SERIF_STACK;
const SANS_STACK = `"IBM Plex Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif`;

const ROOT_ROOM = "garden";
const PANE_SLOTS = ["a", "b", "c", "d"];
// The players slider's own detents. Every count here divides the two-column
// grid evenly, so no layout ever carries a half-empty row.
const PLAYER_COUNTS = [1, 2, 4];
const DEFAULT_PLAYER_COUNT = 2;
// The npcs slider is a plain count, not a detent list: nothing lays an NPC
// out, so every number between its ends is as good as any other.
const NPC_COUNT_MIN = 1;
const NPC_COUNT_MAX = 10;
const NPC_COUNT_LABELLED = [1, 5, 10];
const DEFAULT_NPC_COUNT = 2;
const DEFAULT_DELAY_MS = 650;
const DEFAULT_MAX_TURNS = 400;

const MUD_NOTE_LINES = [
  "Burrowing animals share one world here. The players slider picks how many get a window of their own; the npcs slider adds more animals that dig and forage without one. Each one only knows what it has dug up, asked about, or been told. Nobody sees the whole burrow except you, watching from the survey above.",
  `This is a MUD, short for Multi Underground creature Dig. The name nods to MUD, or in its current form MUDII (mudii.co.uk), one of the first multiplayer text games. The dig-your-own-rooms idea came from a skim of Wikipedia's Colossal Cave Adventure article, the game that started the genre.`,
  "Share the burrow and a second digger joins from another machine, browser to browser, with no server in the middle. Each animal is claimed by one node, one hand on one lemming, and everything either of you digs, eats or learns lands in the same graph.",
];

// The shared sharing overlay, in this page's own words — same markup, same
// ids, same ladder as chat.html's; only the vocabulary is a burrow's.
const MUD_SHARE_COPY = {
  thing: "burrow",
  lede: "This burrow lives in your browser and nowhere else. Sharing it opens a direct line (WebRTC) to one other browser: you send an invite, they send a reply, you paste it in. No account, no server, no copy anywhere in between.",
  worldLabel: "the burrow you are sharing",
  nodeLabel: "your node name",
  namesNote: "both names are facts in the burrow, not settings.",
  invitedEyebrow: "you have been invited to dig in",
  joinBody: "Nothing runs until you press the button. It makes one reply for you to send back the way the invite reached you.",
  dismiss: "dig on your own instead",
  rosterTitle: "who digs this burrow",
  nodeEmpty: "nobody else is digging here yet.",
  idleNote: "this browser holds the only copy of this burrow.",
};

/** A character id's species — "mole-1" -> "mole", "groundhog-1" ->
 *  "groundhog" — mirroring spider-fly-viz.mjs's own classOfAgentId. Self-
 *  contained, `.toString()`-splice safe. */
export function speciesOfCharacter(id) {
  return String(id).replace(/-\d+$/, "");
}

/** Every object visible in `here` EXCEPT `viewer` itself — `roomSceneObjects`
 *  (adventure-viz.mjs) only ever excludes the literal id "player", which no
 *  mud-garden character is ever named, so every OTHER character sharing the
 *  room (and every loose object) comes back exactly like any prop; this page
 *  draws the viewer's own sprite separately, so it is the one subject this
 *  wrapper drops. Pure, self-contained (roomSceneObjects is spliced
 *  alongside it). */
export function mudRoomSceneObjects(rows, state, here, viewer) {
  return roomSceneObjects(rows, state, here).filter((o) => o.subject !== viewer);
}

/** Every object `character` carries, sorted, each with its sprite class —
 *  mud's own version of adventure-viz.mjs's carriedItems, parametrized by
 *  character instead of hardcoded to "player" (mud-garden ships no such
 *  individual). Pure, self-contained. */
export function carriedItemsFor(rows, state, character) {
  return [...state.placements]
    .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === character)
    .map(([subject]) => ({ subject, spriteClass: spriteClassForObject(rows, subject) }))
    // Codepoint order, never localeCompare — inlined, not a module-level
    // helper, because this function is spliced verbatim into the page's own
    // inline script and can carry no outer-scope reference with it.
    .sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

/** Every room's depth level, `Map<roomId, number>`, BFS from `root` at level
 *  0: an "up"/"down" exit moves the level by ∓ 1, any other direction
 *  keeps the level unchanged — what tells the survey where the turf line
 *  falls. A room unreachable from `root` (should not happen — every dug room
 *  writes a two-way exit back) is simply absent from the map rather than
 *  guessed at. Re-exported from viz-room-graph.mjs's shared implementation,
 *  which this module also splices into its own inline page script. */
export { levelsOf };

/** Which characters currently stand in `room` — the survey's own per-room
 *  roster, both for the omniscient board and a pane's own visited-only one.
 *  Pure. */
export function charactersInRoom(state, room, characters) {
  return characters.filter((c) => state.placements.get(c)?.object === room);
}

/** The rooms in `roomIds` laid out on an integer grid FROM the world's own
 *  has-exit-* directions — never a force-directed guess, so a room north of
 *  another sits one row above it and a room dug DOWN sits one row below. A
 *  thin wrapper over viz-room-graph.mjs's shared `directedGridLayout`, always
 *  passing `nudgeCollisions: true` — the one thing a burrow needs that a
 *  manor does not: a cell already taken nudges right rather than stacking two
 *  rooms on one square (dig down and dig south from the same room otherwise
 *  collide). Pure. */
export function burrowGraph(state, roomIds, root = "garden") {
  return directedGridLayout(state, roomIds, { root, nudgeCollisions: true });
}

/** The directions `here` can still be dug in: every direction the room's kind
 *  allows that has no written exit yet. Above ground there is nothing to
 *  tunnel sideways THROUGH, so a garden digs straight down and no other way;
 *  underground, all six are open soil. The engine is the authority on this —
 *  the page prefers `tmct.page.diggableDirections` whenever the bundle exposes
 *  one and only falls back to the rule below. Pure, self-contained
 *  (roomKindForRoom is spliced alongside it). */
export function diggableDirections(rows, state, here) {
  const exits = state.exits.get(here);
  const kind = roomKindForRoom(rows, here);
  const allowed = kind === "outdoor" ? ["down"] : ["north", "south", "east", "west", "up", "down"];
  return allowed.filter((direction) => !exits || !exits.has(direction));
}

/** A carried or loose object's display name. A dug object is minted as
 *  `<kind>-<the full nested room id it was dug from>` (adventure.mjs's
 *  freshRoomId), which reads as a path, not a thing — so a subject that ends
 *  in "-<a room this world actually has>" shows as its kind alone. Every
 *  other id (the world's hand-authored props: "carrot", "worm-1") is already
 *  a name and passes straight through. Pure. */
export function itemLabel(subject, roomIds) {
  const id = String(subject);
  for (const room of roomIds || []) {
    const suffix = "-" + room;
    if (id.length > suffix.length && id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  return id;
}

/** Whether `subject` is a creature rather than a prop: the world places a
 *  character with `mgx:currently-in` and everything else with a containment
 *  predicate, the same split mud-turn.mjs's own "what is there to examine"
 *  filter reads. Pure — so the room view can put animals on the floor and
 *  props on the wall without a roster to check against, and a character the
 *  page is not itself driving (an NPC) still reads as an animal. */
export function isCreature(state, subject) {
  return state.placements.get(subject)?.predicate === "mgx:currently-in";
}

// ---- the shared burrow: reading the P2P layer's own facts back ---------------
// All four readers below work on plain fact rows and nothing else, so the page
// draws a claim, a wave and a node name identically whether the world is shared
// with three machines or with none. Pure and `.toString()`-splice safe.

/** Every assertion time a provenance string carries, in milliseconds. A tag is
 *  `<kind>:<id>@<ISO>`, and a fact asserted more than once holds several joined
 *  by " | " — a peer's relabelled copy of a tag keeps the time the fact was
 *  actually asserted, so reading them all back is what lets a claim be settled
 *  by its oldest and a wave by its newest. Pure, self-contained. */
export function provenanceStamps(provenance) {
  const stamps = [];
  const text = String(provenance || "");
  const pattern = /@(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/g;
  let found = pattern.exec(text);
  while (found !== null) {
    const at = Date.parse(found[1]);
    if (!Number.isNaN(at)) stamps.push(at);
    found = pattern.exec(text);
  }
  return stamps;
}

/** Which peer plays `character`, or null when nobody has claimed it. Claims are
 *  add-only and never retracted, so two peers claiming the same animal both
 *  write and every page settles it the same way: the OLDEST claim wins, with
 *  the lower peer term breaking a dead heat so two machines reading the same
 *  rows can never disagree. Pure, self-contained (provenanceStamps is spliced
 *  alongside it). */
export function claimantOf(rows, character) {
  let owner = null;
  let ownerAt = Infinity;
  for (const row of rows || []) {
    if (row.subject !== character || row.predicate !== "mgx:playedBy") continue;
    let at = Infinity;
    for (const stamp of provenanceStamps(row.provenance)) if (stamp < at) at = stamp;
    if (at < ownerAt || (at === ownerAt && owner !== null && String(row.object) < owner)) {
      ownerAt = at;
      owner = String(row.object);
    }
  }
  return owner;
}

/** Which characters are waving right now — a read-time recency question over
 *  the newest tag on each `mgx:waved` fact, never stored state and never a
 *  retraction. A wave older than the window simply stops being read as one.
 *  Pure, self-contained. */
export function wavingCharacters(rows, nowMs, windowMs = 8000) {
  const waving = [];
  for (const row of rows || []) {
    if (row.predicate !== "mgx:waved") continue;
    let newest = null;
    for (const stamp of provenanceStamps(row.provenance)) if (newest === null || stamp > newest) newest = stamp;
    if (newest === null) continue;
    const age = nowMs - newest;
    if (age < 0 || age > windowMs) continue;
    if (waving.indexOf(row.subject) === -1) waving.push(row.subject);
  }
  return waving;
}

/** The name a peer chose for its node, from its latest `mgx:nodeName` fact,
 *  falling back to a shortened peer id. A label never waits for a name to
 *  arrive. Pure, self-contained. */
export function nodeNameFor(rows, peerId) {
  const want = peerTerm(peerId);
  let name = null;
  let nameAt = -Infinity;
  for (const row of rows || []) {
    if (row.predicate !== "mgx:nodeName" || peerTerm(row.subject) !== want) continue;
    let at = -Infinity;
    for (const stamp of provenanceStamps(row.provenance)) if (stamp > at) at = stamp;
    if (at >= nameAt) { nameAt = at; name = String(row.object); }
  }
  return name || want.slice(0, 8);
}

/** The self-contained mud.html page. Pure — identical output for identical
 *  input; every other piece of state (the live world, chat, ticks) is
 *  computed in the browser once the sibling bundle loads.
 *  `characters` is the ROSTER this page may draw from, `[{ id, species }]`;
 *  the page ships the default cast's panes and rebuilds the whole stage at
 *  every boot, so how many of the roster play, and which of them, is decided
 *  live by the players slider and the engine's own pickMudRoster — the same
 *  draw the shared session is then opened for, never a second one. A count
 *  the roster cannot fill draws as many panes as it has animals.
 *  `worldPayload` is `{ name, facts, rules, opening }`, read once at build
 *  time through the real worlds-pack provider (see this module's own
 *  header). `scenarios` is the list of burrows the deck's dropdown offers,
 *  `[{ label, worldPayload, characters }]` — each one a whole world with its
 *  own roster, so picking one recasts the page over that world's animals
 *  rather than reskinning this one. `worldPayload`/`characters` name the
 *  scenario the page opens with; a page given no `scenarios` is the
 *  one-burrow case and ships no dropdown at all. `spriteTemplates` is the
 *  large-tier sprite set (data/sprites-large/*.toml) so every species
 *  resolves its own art instead of falling back to the flat animal icon.
 *  `mudConfig` defaults to game-config.mjs's own DEFAULT_GAME_CONFIG.mud —
 *  the per-species mass/speed/dig-reach reference table each pane's stat line
 *  reads for flavor. `engineBundleJs` inlines the built mud-browser bundle
 *  instead of the sibling `<script src>`, mirroring spider-fly-viz.mjs's own
 *  standalone-export knob; default empty keeps the site build's sibling-file
 *  arrangement unchanged. */
export function renderMudHtml({
  title = DEFAULT_TITLE,
  worldPayload,
  characters = [],
  scenarios = [],
  spriteTemplates = [],
  mudConfig = DEFAULT_GAME_CONFIG.mud,
  engineBundleJs = "",
} = {}) {
  const scenarioList = scenarios.length
    ? scenarios
    : [{ label: scenarioLabel(worldPayload?.name), worldPayload, characters }];
  const opening = scenarioList[0];
  const openingCount = Math.max(
    1,
    Math.min(DEFAULT_PLAYER_COUNT, (opening.characters || []).length || DEFAULT_PLAYER_COUNT),
  );
  const pageData = embedJson({
    scenarios: scenarioList, spriteTemplates, mudConfig,
    paneSlots: PANE_SLOTS,
    playerCounts: PLAYER_COUNTS,
    defaultPlayerCount: DEFAULT_PLAYER_COUNT,
    defaultNpcCount: DEFAULT_NPC_COUNT,
    rootRoom: ROOT_ROOM,
    defaultDelayMs: DEFAULT_DELAY_MS,
    defaultMaxTurns: DEFAULT_MAX_TURNS,
  });

  const paneHtml = PANE_SLOTS.slice(0, openingCount).map((slot) => paneMarkup(slot)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${engineBundleJs ? "" : `<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">`}
<style>
${THEME_TOKENS_CSS}
${MUD_STYLE}
${SHARE_OVERLAY_CSS}
${MUD_SHARE_SKIN}
</style>
</head>
<body>
<main>
  <header class="mud-topbar">
    <h1 class="eyebrow">${demoEyebrowHtml("mud", "mud")}</h1>
    <div class="mud-topbar-actions">
      <button type="button" class="state-pill" id="statePill" aria-expanded="false" aria-controls="netPanel"
              title="whether this burrow is shared with anyone"><i class="state-dot"></i><span id="statePillWord">not shared</span></button>
      <button type="button" id="shareBtn">share</button>
      <button type="button" id="joinOpenBtn">join</button>
      <a class="mud-topbar-help" href="./help.html#sharing" target="_blank" rel="noopener"
         title="how sharing works, in a new tab" aria-label="how sharing works, opens in a new tab">?</a>
    </div>
  </header>
  <div class="deck-row">
    <section class="deck" aria-label="simulation controls">
      <div class="deck-controls">
        <button type="button" class="deck-play" id="autoToggle" aria-pressed="false">&#9654; play</button>
        <button type="button" id="stepBtn">step</button>
        <button type="button" id="resetBtn">reset</button>
${scenarioList.length > 1 ? `        <select id="scenarioSelect" class="deck-select" aria-label="which burrow to play">
${scenarioList.map((s, i) => `          <option value="${i}"${i === 0 ? " selected" : ""}>${escapeHtml(s.label || scenarioLabel(s.worldPayload?.name))}</option>`).join("\n")}
        </select>` : ""}
        <button type="button" id="editModeBtn" aria-pressed="false">edit</button>
        <label class="deck-teach" title="With this on, a sentence like &quot;Pebble lies in the garden.&quot; writes a fact into the world instead of running as a command.">
          <input type="checkbox" id="teachToggle">
          teach
        </label>
        <button type="button" class="deck-info-btn" id="deckInfoBtn" aria-expanded="false" aria-controls="deckInfoPopup" aria-label="about this demo">?</button>
        <span class="mono deck-turns" id="globalTurnCount">turns: 0</span>
      </div>
      <div class="deck-sliders">
        <label class="deck-slider">players
          <input type="range" id="playerCountSlider" min="0" max="${PLAYER_COUNTS.length - 1}" step="1"
                 value="${Math.max(0, PLAYER_COUNTS.indexOf(DEFAULT_PLAYER_COUNT))}"
                 list="playerCountTicks" aria-valuetext="${DEFAULT_PLAYER_COUNT} players">
          <datalist id="playerCountTicks">${PLAYER_COUNTS.map((n, i) => `<option value="${i}" label="${n}"></option>`).join("")}</datalist>
          <span class="mono" id="playerCountValue">${DEFAULT_PLAYER_COUNT}</span>
        </label>
        <label class="deck-slider">npcs
          <input type="range" id="npcCountSlider" min="${NPC_COUNT_MIN}" max="${NPC_COUNT_MAX}" step="1"
                 value="${DEFAULT_NPC_COUNT}"
                 list="npcCountTicks" aria-valuetext="${DEFAULT_NPC_COUNT} npcs">
          <datalist id="npcCountTicks">${Array.from({ length: NPC_COUNT_MAX - NPC_COUNT_MIN + 1 }, (_, i) => {
            const n = NPC_COUNT_MIN + i;
            return NPC_COUNT_LABELLED.includes(n) ? `<option value="${n}" label="${n}"></option>` : `<option value="${n}"></option>`;
          }).join("")}</datalist>
          <span class="mono" id="npcCountValue">${DEFAULT_NPC_COUNT}</span>
        </label>
        <label class="deck-slider">delay
          <input type="range" id="delaySlider" min="80" max="2000" step="20" value="${DEFAULT_DELAY_MS}">
          <span class="mono" id="delayValue">${DEFAULT_DELAY_MS}ms</span>
        </label>
        <label class="deck-slider">max turns
          <input type="range" id="maxTurnsSlider" min="20" max="2000" step="20" value="${DEFAULT_MAX_TURNS}">
          <span class="mono" id="maxTurnsValue">${DEFAULT_MAX_TURNS}</span>
        </label>
      </div>
      <div class="deck-info-popup mud-note" id="deckInfoPopup" role="dialog" aria-label="about this demo" hidden>
        ${MUD_NOTE_LINES.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n        ")}
        <button type="button" class="deck-info-popup-close" id="deckInfoClose" aria-label="close">&times;</button>
      </div>
    </section>
    <section class="world-map" id="worldMap" aria-label="the whole burrow, every room, every character">
      <div class="world-map-head">
        <span class="world-map-title">the whole burrow</span>
        <span class="mono world-map-turn" id="worldMapTurn">turn 0</span>
      </div>
      <div class="world-map-board" id="worldMapBoard"></div>
      <div class="world-map-key" id="worldMapKey"></div>
    </section>
  </div>
${shareOverlayHtml({ copy: MUD_SHARE_COPY, withTape: true })}
  <div class="mud-stage" id="mudStage" data-panes="${openingCount}">
${paneHtml}
  </div>
  <div class="edit-stage" id="mudEditStage" aria-label="the burrow's own facts, in plain sentences">
    <section class="edit-text" aria-label="the world's facts as editable sentences">
      <h2>the burrow, in plain sentences</h2>
      <p class="edit-lede">Every fact this world is built from. Change a line and the burrow changes with it &mdash; the survey beside you redraws as you type.</p>
      <textarea id="editorText" spellcheck="false" aria-label="the world's own facts as plain sentences, one per line"></textarea>
      <div class="chatpills" id="editorPills" aria-label="related words for the term before the cursor"></div>
      <p class="edit-status" id="editorStatus" role="status"></p>
    </section>
    <aside class="edit-side" aria-label="the burrow as written, a clicked room, and the legend">
      <section class="world-map edit-map" aria-label="every room this world writes">
        <div class="world-map-head"><span class="world-map-title">the burrow as written</span></div>
        <div class="world-map-board" id="editMapBoard"></div>
      </section>
      <section class="edit-panel" id="roomDetailPanel">
        <h2 id="roomDetailTitle">click a room</h2>
        <div class="room-detail-cast" id="roomDetailCast"></div>
        <p class="edit-caption" id="roomDetailCaption">Click a room on the survey to see what stands in it.</p>
      </section>
      <section class="edit-panel">
        <h2>legend</h2>
        <div class="edit-legend" id="editLegend"></div>
      </section>
    </aside>
  </div>
</main>
<script>
const MUD_PAGE_DATA = ${pageData};
</script>
${engineBundleJs ? `<script>\n${embedScriptText(engineBundleJs)}\n</script>` : `<script src="./mud-browser.bundle.js"></script>`}
<script>
${embedScriptText(pageScript())}
</script>
</body>
</html>
`;
}

/** One pane, character-agnostic: which animal it shows is stamped in at boot
 *  (`data-character`, the heading, the chat dock's own labels), so the page
 *  can draw a different cast out of the roster on every reset without a
 *  rebuild. Pure and self-contained (escapeHtml is spliced alongside it) —
 *  the page script calls this same function to build the stage in the
 *  browser, so the panes a count change adds are the panes this file ships. */
export function paneMarkup(slot) {
  const w = `window-${slot}`;
  return `    <section class="mud-window pane-${escapeHtml(slot)}" id="${w}" data-slot="${escapeHtml(slot)}" data-character="">
      <div class="pane-head">
        <h2 id="${w}-name">waiting</h2>
        <span class="pane-node" id="${w}-node" hidden></span>
        <span class="mono pane-turn" id="${w}-turn">turn 0</span>
      </div>
      <div class="room-stage">
        <div class="room-view" id="${w}-room">
          <canvas id="${w}-canvas" width="420" height="152" aria-hidden="true"></canvas>
          <div class="wall-band" id="${w}-wall"></div>
          <div class="floor-band">
            <div class="floor-others" id="${w}-others"></div>
            <div class="floor-self" id="${w}-self"></div>
          </div>
          <div class="bubbles" id="${w}-bubbles"></div>
          <div class="dig-flourish" id="${w}-flourish" hidden></div>
          <div class="strike-flash" id="${w}-strike" aria-hidden="true"></div>
        </div>
        <div class="dir-ring" id="${w}-dirs" aria-label="ways out of this room">
          <div class="dir-slot dir-north" id="${w}-dir-north"></div>
          <div class="dir-slot dir-up" id="${w}-dir-up"></div>
          <div class="dir-slot dir-west" id="${w}-dir-west"></div>
          <div class="dir-slot dir-east" id="${w}-dir-east"></div>
          <div class="dir-slot dir-south" id="${w}-dir-south"></div>
          <div class="dir-slot dir-down" id="${w}-dir-down"></div>
        </div>
      </div>
      <p class="room-caption" id="${w}-caption"></p>
      <div class="pane-columns">
        <div class="pouch" aria-label="pouch">
          <h3>pouch</h3>
          <ul class="pouch-list" id="${w}-pouch-list"></ul>
          <p class="mono stat-line" id="${w}-stats"></p>
        </div>
        <div class="minimap" aria-label="what this character has dug or walked">
          <h3>known ground</h3>
          <div class="minimap-board" id="${w}-minimap"></div>
        </div>
      </div>
      <div class="chat">
        <div class="chatlog" id="${w}-chatlog" aria-live="polite"></div>
        <div class="log-popup" id="${w}-logpop" role="dialog" aria-label="the whole reply" hidden>
          <p class="log-popup-text" id="${w}-logpop-text"></p>
          <button type="button" class="log-popup-close" id="${w}-logpop-close" aria-label="close the whole reply">&times;</button>
        </div>
      </div>
      <div class="chat-console">
        <div class="pill-strip">
          <button type="button" class="pill wave-btn" id="${w}-wave" title="wave, so everyone in this room sees it"
                  aria-label="wave">&#128075; wave</button>
          <div class="chatpills" id="${w}-chatpills" role="group" aria-label="quick commands"></div>
        </div>
        <form class="chatask" id="${w}-chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="${w}-chatq" type="text" placeholder="look" aria-label="type a command" disabled>
        </form>
      </div>
      <div class="pane-controls">
        <button type="button" id="${w}-play" disabled>&#9654; play</button>
        <button type="button" id="${w}-step" disabled>step</button>
        <p class="pane-fate" id="${w}-fate" role="status" hidden></p>
      </div>
    </section>`;
}

const MUD_STYLE = `
  :root {
    --soil-deep: #241710; --soil-mid: #4A3324; --soil-light: #7A5A3D;
    --root-moss: #6B7A4F; --parchment: #EFE6D8; --mud-ink: #2A211A;
    --burrow-glow: #E8A33D; --chalk: #D9CDB9;
    /* Four hues that stay apart at the size an occupant dot is drawn, and all
       four sit on the dark soil board as well as on parchment. Nothing green
       enough to sink into a turf-filled surface room. */
    --actor-a: #E0912A; --actor-b: #5F97B3; --actor-c: #BFC85F; --actor-d: #AE749E;
    --pane-height: 618px;
    --room-height: 152px;
  }
  html { background: var(--soil-deep); }
  body { margin: 0; background: linear-gradient(180deg, var(--root-moss) 0%, var(--soil-light) 14%, var(--soil-mid) 48%, var(--soil-deep) 100%) fixed; color: var(--mud-ink); font-family: ${SANS_STACK}; font-size: 15px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1280px; margin: 0 auto; padding: 1.1rem 1.2rem 2.4rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-weight: 500; font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; color: var(--parchment); opacity: .9; margin: 0 0 .8rem; }
  ${EYEBROW_LINKS_CSS}

  /* ---- the header: brand on the left, the sharing chrome on the right ----
     The same arrangement chat.html's topbar holds — sharing is page chrome,
     not a simulation control, so it lives above the deck rather than in it. */
  .mud-topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin: 0 0 .8rem; }
  .mud-topbar .eyebrow { margin: 0; }
  .mud-topbar-actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .mud-topbar-actions button:not(.state-pill), .mud-topbar-help {
    background: var(--lem-face); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 3px;
    padding: .32rem .7rem; box-shadow: 0 1px 0 rgba(0, 0, 0, .12); text-decoration: none; font-size: .82rem;
  }
  .mud-topbar-actions button:not(.state-pill):hover, .mud-topbar-help:hover { background: var(--lem-face-hi); border-color: var(--burrow-glow); }
  .mud-topbar-help { padding: .32rem .55rem; line-height: 1.2; }
  /* the pill wears the deck's lit-readout idiom: this is the one word that
     says whether the burrow is shared, and it reads like an instrument. */
  .mud-topbar-actions .state-pill { background: var(--lem-readout-bg); color: var(--lem-readout); border: 1px solid #000; border-radius: 2px; padding: .3rem .6rem; cursor: pointer; }
  h2 { font-family: ${DISPLAY_STACK}; font-size: 1rem; margin: 0; text-transform: capitalize; }
  h3 { font-family: ${MONO_STACK}; font-size: .58rem; margin: 0 0 .3rem; text-transform: uppercase; letter-spacing: .12em; color: var(--soil-mid); }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 2px; }
  button:disabled { opacity: .4; cursor: default; }

  /* ---- top row: the control deck, and the survey beside it ---- */
  .deck-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: stretch; margin-bottom: 1rem; }
  .deck {
    position: relative;
    background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .8rem .9rem; display: flex; flex-direction: column; gap: .55rem; min-width: 0;
  }
  .deck-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .deck-info-btn {
    font-family: ${MONO_STACK}; font-size: .78rem; line-height: 1; width: 1.5rem; height: 1.5rem;
    border-radius: 50%; border: 1px solid var(--soil-mid); background: rgba(255,255,255,.5);
    color: var(--soil-mid); padding: 0; flex: 0 0 auto;
  }
  .deck-info-btn:hover, .deck-info-btn[aria-expanded="true"] { border-color: var(--burrow-glow); color: var(--mud-ink); }
  .deck button, .pane-controls button {
    font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .32rem .7rem; border: 1px solid var(--soil-mid); border-radius: 3px; background: rgba(255,255,255,.5);
  }
  .deck button:hover:not(:disabled), .pane-controls button:hover:not(:disabled) { border-color: var(--burrow-glow); }
  .deck-select {
    font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .32rem .7rem; border: 1px solid var(--soil-mid); border-radius: 3px;
    background: rgba(255,255,255,.5); color: var(--mud-ink);
    /* A select is as wide as its longest option, and a burrow's label can run
       long enough on its own to force the whole page to scroll sideways on a
       phone. */
    min-width: 0; max-width: 100%;
  }
  #scenarioSelect { flex: 1 1 9rem; }
  .deck-select:hover { border-color: var(--burrow-glow); }
  .deck-teach { display: flex; align-items: center; gap: .3rem; font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--soil-mid); cursor: pointer; }
  .deck-teach input[type="checkbox"] { accent-color: var(--burrow-glow); }
  .deck-play { background: var(--mud-ink) !important; color: var(--parchment); border-color: var(--mud-ink) !important; padding: .38rem 1.1rem !important; }
  .deck-play[aria-pressed="true"] { background: var(--burrow-glow) !important; border-color: var(--burrow-glow) !important; color: var(--mud-ink); }
  .deck-turns { margin-left: auto; font-size: .74rem; color: var(--soil-mid); }
  .deck-sliders { display: flex; flex-wrap: wrap; gap: 1rem; }
  .deck-slider { display: flex; align-items: center; gap: .35rem; font-family: ${MONO_STACK}; font-size: .62rem; text-transform: uppercase; letter-spacing: .08em; color: var(--soil-mid); }
  .deck-slider input[type="range"] { accent-color: var(--burrow-glow); width: 8rem; max-width: 34vw; }
  .deck-info-popup {
    position: absolute; left: .9rem; right: .9rem; top: calc(100% + 8px); z-index: 8;
    background: var(--soil-deep); color: var(--parchment);
    border: 1px solid var(--burrow-glow); border-radius: 4px;
    padding: .55rem 1.6rem .6rem .65rem; box-shadow: 0 8px 18px rgba(0,0,0,.5);
    animation: popup-rise .16s ease-out;
  }
  .deck-info-popup::before {
    content: ""; position: absolute; left: 1.1rem; top: -6px; width: 0; height: 0;
    border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid var(--burrow-glow);
  }
  .deck-info-popup p { margin: 0 0 .4rem; max-width: 62ch; font-size: .78rem; line-height: 1.4; }
  .deck-info-popup p:last-child { margin-bottom: 0; }
  .deck-info-popup-close { position: absolute; top: .1rem; right: .3rem; font-size: 1rem; line-height: 1; color: var(--parchment); padding: .1rem .2rem; }
  .deck-info-popup-close:hover { color: var(--burrow-glow); }
  @media (prefers-reduced-motion: reduce) { .deck-info-popup { animation: none; } }

  .world-map {
    background: var(--soil-deep); color: var(--parchment);
    border: 1px solid var(--burrow-glow); border-radius: 4px; padding: .55rem .65rem .6rem;
    box-shadow: 0 2px 0 rgba(0,0,0,.3); display: flex; flex-direction: column; gap: .4rem; min-width: 0;
  }
  .world-map-head { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .world-map-title { font-family: ${MONO_STACK}; font-size: .58rem; text-transform: uppercase; letter-spacing: .12em; opacity: .85; }
  .world-map-turn { font-size: .62rem; opacity: .7; }
  .world-map-board { flex: 1; min-height: 168px; display: flex; align-items: center; justify-content: center; }
  .world-map-board svg { width: 100%; height: 100%; max-height: 230px; }
  .world-map-key { display: flex; flex-wrap: wrap; gap: .5rem; font-family: ${MONO_STACK}; font-size: .58rem; opacity: .85; }
  .key-actor, .key-npcs { display: inline-flex; align-items: center; gap: .28rem; }
  .key-npcs { opacity: .75; }
  .key-dot { width: .5rem; height: .5rem; border-radius: 50%; display: inline-block; }

  /* ---- the survey itself, drawn twice at two sizes ---- */
  .burrow svg { display: block; }
  .burrow .turf { fill: var(--root-moss); opacity: .3; }
  .burrow .ground-line { stroke: var(--root-moss); stroke-width: 1.2; stroke-dasharray: 5 3; opacity: .9; }
  .burrow .tunnel { stroke: var(--soil-light); stroke-width: 5.5; stroke-linecap: round; opacity: .85; }
  .burrow .tunnel.shaft { stroke-dasharray: 3 3.5; stroke-width: 4; }
  .burrow .hint { fill: var(--chalk); opacity: .45; }
  .burrow .room rect { fill: var(--soil-mid); stroke: var(--chalk); stroke-width: .8; }
  .burrow .room.surface rect { fill: var(--root-moss); }
  .burrow .room text { fill: var(--parchment); font-family: ${MONO_STACK}; font-size: 7px; text-anchor: middle; }
  .burrow .room.freshly-dug rect { stroke: var(--burrow-glow); stroke-width: 1.8; animation: dig-pulse 1.2s ease-out; }
  .burrow .occupant { stroke: rgba(0,0,0,.45); stroke-width: .6; }
  @keyframes dig-pulse { 0% { opacity: .25; } 100% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .burrow .room.freshly-dug rect { animation: none; } }

  /* ---- the panes ----
     Two columns hold every count the players slider offers: four fills them
     twice over, two fills them once. One is the exception, and it earns it —
     a lone animal takes a single centred column at a reading measure and
     spends the width it saves on a taller room and a longer log, so the page
     reads as one portrait rather than one pane marooned in an empty grid. */
  .mud-stage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; }
  .mud-stage[data-panes="1"] {
    grid-template-columns: minmax(0, 46rem); justify-content: center;
    --pane-height: 700px; --room-height: 196px;
  }
  .mud-window {
    background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .7rem .8rem; display: flex; flex-direction: column; gap: .5rem;
    min-width: 0; height: var(--pane-height); box-sizing: border-box; overflow: hidden;
    border-top: 3px solid var(--actor-a);
  }
  .mud-window.pane-b { border-top-color: var(--actor-b); }
  .mud-window.pane-c { border-top-color: var(--actor-c); }
  .mud-window.pane-d { border-top-color: var(--actor-d); }
  .pane-head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
  .char-id { font-size: .66rem; color: var(--soil-mid); margin-left: .35rem; text-transform: none; }
  .pane-turn { font-size: .68rem; color: var(--soil-mid); }

  /* ---- room view: one row of soil, the compass around it ---- */
  .room-stage { position: relative; padding: 19px 34px; flex: 0 0 auto; }
  .room-view { position: relative; height: var(--room-height); border-radius: 3px; overflow: hidden; border: 1px solid var(--soil-mid); }
  .room-view canvas { display: block; width: 100%; height: 100%; }
  .wall-band { position: absolute; left: 0; right: 0; top: 4px; height: 62px; display: flex; align-items: flex-start; justify-content: center; gap: .5rem; }
  .wall-item { display: flex; flex-direction: column; align-items: center; min-width: 34px; max-width: 72px; }
  .wall-item .hook { width: 1px; height: 5px; background: rgba(0,0,0,.45); }
  .wall-item .sprite-frame { width: 30px; padding: 2px; box-sizing: border-box; background: rgba(239,230,216,.85); border: 1px solid var(--soil-deep); border-radius: 1px; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
  .wall-item.hangs-high { margin-top: 0; }
  .wall-item.hangs-low { margin-top: 14px; }
  .wall-item svg { width: 100%; display: block; }
  .floor-band { position: absolute; left: 0; right: 0; bottom: 0; height: 86px; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 6px 4px; box-sizing: border-box; }
  /* A room can hold a dozen animals once the npcs slider is up, and the floor
     is one row wide either way — so the crowd shares the row it has instead of
     the surplus running off the edge under the overflow clip. --mate-width is
     set per redraw from the room's own measured width. */
  .floor-others { display: flex; align-items: flex-end; gap: 6px; min-width: 0; }
  .floor-others .sprite-card { max-width: var(--mate-width, 76px); }
  .floor-others .sprite { width: min(40px, var(--mate-width, 40px)); }
  .sprite { width: 40px; }
  .sprite svg { width: 100%; display: block; }
  .floor-self .sprite { width: 48px; }

  /* ---- sprite cards: adventure.html's own frame-plus-nameplate treatment,
     shrunk to the one soil row a mud pane has for it. The plate names the
     real subject (mole-1, carrot), never a class word. ---- */
  .sprite-card { display: flex; flex-direction: column; align-items: center; max-width: 76px; }
  .sprite-label {
    margin-top: 2px; max-width: 100%; box-sizing: border-box;
    font-family: ${MONO_STACK}; font-size: .5rem; line-height: 1.25; letter-spacing: .01em; text-align: center;
    color: var(--mud-ink); background: rgba(239,230,216,.92); border: 1px solid var(--soil-mid); border-radius: 2px;
    padding: 0 .22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sprite-mass {
    margin-top: 1px; font-family: ${MONO_STACK}; font-size: .46rem; line-height: 1.3; letter-spacing: .02em;
    color: var(--parchment); background: rgba(36,23,16,.72); border-radius: 2px; padding: 0 .2rem; white-space: nowrap;
  }
  .sprite-card.actionable { cursor: pointer; }
  .sprite-card.actionable:hover .sprite-frame, .sprite-card.actionable:focus-visible .sprite-frame { border-color: var(--burrow-glow); }
  .sprite-card.actionable:hover .sprite-label, .sprite-card.actionable:focus-visible .sprite-label { border-color: var(--burrow-glow); background: var(--burrow-glow); }
  .sprite-card.actionable:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 1px; }
  .wall-band .sprite-card.actionable { pointer-events: auto; }

  /* ---- the compass ring: each way out sits where it points ---- */
  .dir-ring { position: absolute; inset: 0; pointer-events: none; }
  .dir-slot { position: absolute; pointer-events: auto; }
  .dir-north { top: 0; left: 50%; transform: translateX(-102%); }
  .dir-up { top: 0; left: 50%; transform: translateX(6px); }
  .dir-south { bottom: 0; left: 50%; transform: translateX(-102%); }
  .dir-down { bottom: 0; left: 50%; transform: translateX(6px); }
  .dir-west { left: 0; top: 50%; transform: translateY(-50%); }
  .dir-east { right: 0; top: 50%; transform: translateY(-50%); }
  .dir-pill {
    font-family: ${MONO_STACK}; font-size: .58rem; letter-spacing: .06em; line-height: 1;
    padding: .22rem .42rem; border-radius: 2px; border: 1px solid var(--soil-mid);
    background: var(--parchment); color: var(--mud-ink); white-space: nowrap;
  }
  .dir-pill.dig { border-style: dashed; border-color: var(--burrow-glow); color: var(--soil-mid); background: rgba(232,163,61,.14); }
  .dir-pill.vertical { border-radius: 50%; width: 1.35rem; height: 1.35rem; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: .68rem; }
  .dir-pill:hover:not(:disabled) { border-color: var(--burrow-glow); background: var(--burrow-glow); color: var(--mud-ink); }

  .bubbles { position: absolute; inset: 0; pointer-events: none; }
  .bubble {
    position: absolute; max-width: 46%;
    background: var(--parchment); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 7px;
    padding: .22rem .45rem; font-size: .66rem; line-height: 1.25; box-shadow: 0 2px 4px rgba(0,0,0,.3);
  }
  .bubble.from-self { right: 4%; bottom: 52%; }
  .bubble.from-other { left: 4%; bottom: 52%; }
  .bubble::after { content: ""; position: absolute; bottom: -5px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid var(--parchment); }
  .bubble.from-self::after { right: 12%; }
  .bubble.from-other::after { left: 12%; }

  .dig-flourish { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(circle at 50% 80%, var(--burrow-glow) 0%, transparent 62%); transition: opacity .5s ease; }
  .dig-flourish.shown { opacity: .5; }
  @media (prefers-reduced-motion: reduce) { .dig-flourish { transition: none; opacity: 0 !important; } }

  /* Two lines clamped, and a box tall enough to hold both of them: at 1.5
     line-height that is 3em, and anything shorter cuts the second line's
     descenders off. */
  .room-caption { flex: 0 0 auto; font-size: .74rem; margin: 0; color: var(--soil-mid); height: 3em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

  .pane-columns { flex: 0 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; height: 86px; }
  .pouch, .minimap { background: rgba(255,255,255,.35); border: 1px solid var(--soil-light); border-radius: 3px; padding: .35rem .45rem; overflow: hidden; display: flex; flex-direction: column; }
  .pouch-list { list-style: none; margin: 0; padding: 0; font-family: ${MONO_STACK}; font-size: .64rem; display: flex; flex-wrap: wrap; gap: .2rem .3rem; overflow-y: auto; }
  .pouch-list li { background: var(--soil-light); color: var(--parchment); border-radius: 2px; padding: .06rem .3rem; }
  .pouch-list:empty::after { content: "carrying nothing"; color: var(--soil-mid); font-family: ${SANS_STACK}; font-style: italic; font-size: .68rem; }
  .stat-line { margin: .25rem 0 0; font-size: .58rem; color: var(--soil-mid); }
  .minimap-board { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .minimap-board svg { width: 100%; height: 100%; max-height: 56px; }
  .minimap-board:empty::after { content: "nothing dug yet"; color: var(--soil-mid); font-style: italic; font-size: .68rem; }
  .minimap .burrow .room text { fill: var(--parchment); font-size: 6px; }
  .minimap .burrow .room.here rect { fill: var(--burrow-glow); }
  .minimap .burrow .room.here text { fill: var(--mud-ink); }

  /* The log is the ONLY thing in a pane allowed to grow, and it grows inward:
     flex-basis 0 keeps its own content out of the pane's height arithmetic, so
     a hundred turns of narration scroll inside it instead of pushing the
     command console off the bottom of a fixed-height pane. */
  .chat { position: relative; flex: 1 1 0; min-height: 2.6rem; display: flex; flex-direction: column; }
  /* Block flow, deliberately, not a flex column: a scrolled log's own lines
     must keep their natural height, and flex items inside a height-capped
     column shrink toward zero instead. */
  .chatlog {
    flex: 1 1 0; min-height: 0; display: block;
    overflow-y: scroll; overscroll-behavior: contain; padding-right: .25rem;
  }
  .chatlog > * { margin: 0 0 .28rem; }
  .chatlog > *:last-child { margin-bottom: 0; }
  /* The log carries typed exchanges only — a scripted turn narrates through
     the room view — so an untouched pane's log says what would fill it. */
  .chatlog:empty::after { content: "Type a command below and the answer lands here."; color: var(--soil-mid); font-style: italic; font-size: .72rem; }
  /* A styled webkit scrollbar reserves its own gutter, where the overlay one
     Chromium defaults to on macOS shows nothing until you already scroll. The
     standard properties go behind @supports because setting them at all makes
     Blink ignore the pseudo-elements and fall back to that overlay bar. */
  .chatlog::-webkit-scrollbar { width: 9px; }
  .chatlog::-webkit-scrollbar-track { background: rgba(122,90,61,.18); border-radius: 5px; }
  .chatlog::-webkit-scrollbar-thumb { background: var(--soil-light); border-radius: 5px; border: 2px solid var(--parchment); }
  .chatlog::-webkit-scrollbar-thumb:hover { background: var(--soil-mid); }
  @supports not selector(::-webkit-scrollbar) {
    .chatlog { scrollbar-width: thin; scrollbar-color: var(--soil-light) rgba(122,90,61,.18); }
  }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--soil-mid); overflow-wrap: anywhere; }
  .chatlog .u::before { content: "tmct> "; color: var(--burrow-glow); }
  /* A reply is capped at four rendered lines. A capped one says so and opens the
     whole text in the popup above, so no single answer can take the log over.
     The unclamped variant exists only to be measured against: a line-clamped box
     reports its clamped height as its scrollHeight. */
  .chatlog .a { font-size: .74rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .chatlog .a.unclamped { display: block; -webkit-line-clamp: none; overflow: visible; }
  .chatlog .clipped { position: relative; cursor: pointer; padding-right: 2.4rem; }
  .chatlog .clipped::after {
    content: "more"; position: absolute; right: 0; bottom: 0;
    font-family: ${MONO_STACK}; font-size: .5rem; letter-spacing: .06em; text-transform: uppercase;
    color: var(--mud-ink); background: var(--burrow-glow); border-radius: 99px; padding: 0 .32rem;
  }
  .chatlog .clipped:hover::after, .chatlog .clipped:focus-visible::after { background: var(--mud-ink); color: var(--parchment); }
  .chatlog .clipped:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 1px; }

  .log-popup {
    position: absolute; left: 0; right: 0; bottom: calc(100% - 1.4rem); z-index: 8;
    background: var(--soil-deep); color: var(--parchment);
    border: 1px solid var(--burrow-glow); border-radius: 4px;
    padding: .45rem 1.5rem .5rem .55rem; box-shadow: 0 8px 18px rgba(0,0,0,.5);
    max-height: 13rem; overflow-y: auto; animation: popup-rise .16s ease-out;
  }
  .log-popup::after {
    content: ""; position: absolute; left: 1.4rem; bottom: -6px; width: 0; height: 0;
    border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid var(--burrow-glow);
  }
  .log-popup-text { margin: 0; font-size: .74rem; line-height: 1.4; }
  .log-popup-close { position: absolute; top: .1rem; right: .25rem; font-size: 1rem; line-height: 1; color: var(--parchment); padding: .1rem .2rem; }
  .log-popup-close:hover { color: var(--burrow-glow); }
  @keyframes popup-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .log-popup { animation: none; } }

  /* The console never moves: pills and prompt sit outside the log's own flex
     track, so no amount of narration can reach them. */
  .chat-console { flex: 0 0 auto; display: flex; flex-direction: column; gap: .3rem; margin-top: .3rem; }
  .chatask { display: flex; align-items: center; gap: .4rem; }
  .chatask .prompt { color: var(--burrow-glow); font-size: .7rem; }
  .chatask input { flex: 1; min-width: 0; font-family: ${MONO_STACK}; font-size: .7rem; background: rgba(255,255,255,.6); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 2px; padding: .26rem .45rem; box-sizing: border-box; }
  .chatpills { display: flex; flex-wrap: wrap; gap: .22rem; max-height: 3.9rem; overflow-y: auto; scrollbar-width: thin; }
  .chatpills:empty { display: none; }
  .pill { font-family: ${MONO_STACK}; font-size: .58rem; padding: .14rem .45rem; border: 1px solid var(--soil-mid); border-radius: 99px; background: rgba(255,255,255,.5); white-space: nowrap; }
  .pill:hover:not(:disabled) { border-color: var(--burrow-glow); background: var(--burrow-glow); }
  .pill.affordance { border-style: dashed; border-color: var(--soil-light); }
  .pill.way { border-style: solid; border-color: var(--soil-mid); background: rgba(232,163,61,.16); }
  .pane-controls { flex: 0 0 auto; display: flex; align-items: center; gap: .4rem; }
  .pane-fate {
    margin: 0; font-family: ${MONO_STACK}; font-size: .62rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .3rem .6rem; border-radius: 3px; background: var(--soil-deep); color: var(--parchment);
  }
  .mud-window.out-of-play { border-top-color: var(--soil-mid); }
  .mud-window.out-of-play .pane-controls button { display: none; }
  .room-view, .pane-columns { transition: filter .4s ease, opacity .4s ease; }
  .mud-window.out-of-play .room-view, .mud-window.out-of-play .pane-columns { filter: grayscale(1); opacity: .5; }
  .mud-window.out-of-play .dir-ring { display: none; }

  /* ---- the pounce: the one violent beat on a page that otherwise only fades.
     Every other motion here eases out; this one accelerates into the prey and
     stops dead. It plays once, on the tick a character is first out of play,
     and the pane grays out underneath it when it lands. ---- */
  .strike-flash {
    position: absolute; inset: 0; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 76% 72%, rgba(158,32,16,.95) 0%, rgba(36,23,16,.62) 40%, transparent 72%);
  }
  @keyframes strike-flash { 0%, 42% { opacity: 0; } 50% { opacity: .92; } 100% { opacity: 0; } }
  @keyframes fox-pounce {
    0% { transform: translateX(0) scale(1); }
    16% { transform: translateX(-7px) scale(.94); }
    54% { transform: translateX(var(--pounce-x, 180px)) scale(1.48); }
    100% { transform: translateX(var(--pounce-x, 180px)) scale(1.44); }
  }
  @keyframes prey-taken {
    0%, 40% { transform: none; opacity: 1; }
    47% { transform: translateX(-6px) rotate(-8deg); }
    54% { transform: translateX(6px) rotate(7deg); }
    61% { transform: translateX(-4px) rotate(-4deg); }
    100% { transform: translateX(3px) rotate(4deg) scale(.82); opacity: 0; }
  }
  .room-view.pounce .sprite-card.lunging { position: relative; z-index: 3; transform-origin: 50% 100%; animation: fox-pounce 1.05s cubic-bezier(.6,0,.85,.4) forwards; }
  .room-view.pounce .floor-self { transform-origin: 50% 100%; animation: prey-taken 1.05s cubic-bezier(.4,0,.2,1) forwards; }
  .room-view.pounce .strike-flash { animation: strike-flash 1.05s ease-out forwards; }
  .room-view.pounce .bubbles, .room-view.pounce .wall-band { opacity: .35; }
  @keyframes fate-drop { from { opacity: 0; transform: translateY(-7px); } to { opacity: 1; transform: none; } }
  .pane-fate { animation: fate-drop .3s ease-out; }
  @media (prefers-reduced-motion: reduce) {
    .room-view, .pane-columns { transition: none; }
    .pane-fate { animation: none; }
    .room-view.pounce .sprite-card.lunging, .room-view.pounce .floor-self, .room-view.pounce .strike-flash { animation: none; }
  }

  /* ---- edit mode ----
     One page, two stages. Editing hides the panes AND the deck's own live
     survey: the survey in here is drawn from the edit buffer, and two boards
     showing two different burrows side by side would just be a puzzle. The deck
     itself stays, because the way back out is a button on it. */
  .edit-stage { display: none; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
  body.editing .mud-stage, body.editing .deck-row .world-map { display: none; }
  body.editing .deck-row { grid-template-columns: 1fr; }
  body.editing .edit-stage { display: grid; }
  #editModeBtn[aria-pressed="true"] { background: var(--burrow-glow); border-color: var(--burrow-glow); }

  .edit-text, .edit-panel {
    background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .7rem .8rem; min-width: 0;
  }
  .edit-text { display: flex; flex-direction: column; gap: .45rem; }
  .edit-text h2, .edit-panel h2 {
    font-family: ${MONO_STACK}; font-size: .58rem; text-transform: uppercase; letter-spacing: .12em;
    color: var(--soil-mid); margin: 0;
  }
  .edit-lede { margin: 0; font-size: .74rem; color: var(--soil-mid); max-width: 62ch; }
  #editorText {
    width: 100%; box-sizing: border-box; min-height: 26rem; flex: 1 1 auto; resize: vertical;
    font-family: ${MONO_STACK}; font-size: .74rem; line-height: 1.6;
    color: var(--mud-ink); background: rgba(255,255,255,.6);
    border: 1px solid var(--soil-mid); border-radius: 3px; padding: .55rem .6rem;
  }
  /* Three states, three colours, and the middle one is the important one: a
     document that does not yet parse is holding its retractions back, and has to
     look different from one that synced clean. */
  .edit-status { margin: 0; font-family: ${MONO_STACK}; font-size: .62rem; min-height: 1.2em; color: var(--soil-mid); }
  .edit-status.pending { color: #9A5B12; }
  .edit-status.ok { color: #4E6B2E; }

  .edit-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  .edit-map .world-map-board { min-height: 190px; }
  .edit-map .burrow .room { cursor: pointer; }
  .edit-map .burrow .room.here rect { stroke: var(--burrow-glow); stroke-width: 1.8; }
  .edit-panel { display: flex; flex-direction: column; gap: .35rem; }
  .edit-caption { margin: 0; font-size: .74rem; color: var(--soil-mid); }
  .room-detail-cast, .edit-legend { display: flex; flex-wrap: wrap; gap: .4rem; }
  .edit-legend .sprite-card, .room-detail-cast .sprite-card { max-width: 58px; }
  .edit-legend .sprite-frame, .room-detail-cast .sprite-frame {
    width: 34px; padding: 2px; box-sizing: border-box; background: rgba(255,255,255,.6);
    border: 1px solid var(--soil-mid); border-radius: 2px;
  }
  .edit-legend .sprite-frame svg, .room-detail-cast .sprite-frame svg { width: 100%; display: block; }
  .edit-empty { font-size: .74rem; font-style: italic; color: var(--soil-mid); }

  /* Narrow, every pane stacks and every count reads the same — including the
     single-pane one, whose centred column and extra height only buy anything
     when there is width to spare. */
  @media (max-width: 900px) {
    .deck-row { grid-template-columns: 1fr; }
    .mud-stage, .mud-stage[data-panes="1"] {
      grid-template-columns: 1fr; justify-content: stretch;
      --pane-height: 596px; --room-height: 152px;
    }
    .world-map-board { min-height: 150px; }
    .edit-stage { grid-template-columns: 1fr; }
    #editorText { min-height: 18rem; }
  }

  /* ---- the control panel, in a Lemmings register, on the burrow's own palette ----
     The 1991 game put everything a player touches in one chunky beveled strip
     under the level. This deck keeps that shape — one bordered block, a play
     button that reads as the "go" key, a lit corner readout — but in the same
     soil/parchment/burrow-glow palette every other panel on the page already
     uses, so it reads as this world's own control panel rather than a
     different game's console dropped on top of it. Everything below overrides
     the parchment deck above it deliberately, so the panel is one block a
     reader can find rather than a dozen edits. */
  :root {
    --lem-face: var(--chalk); --lem-face-hi: #FBF7EF; --lem-face-lo: var(--soil-light);
    --lem-go: var(--mud-ink); --lem-go-hi: var(--burrow-glow);
    --lem-alert: #A5432B;
    --lem-readout: var(--burrow-glow); --lem-readout-bg: var(--soil-deep);
    --lem-chalk: var(--soil-mid);
  }
  .deck-slider, .deck h3, .deck-teach { color: var(--lem-chalk); }
  .deck-slider input[type="range"] { accent-color: var(--burrow-glow); }
  .deck button, .pane-controls button {
    background: var(--lem-face); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 3px;
    padding: .32rem .7rem; box-shadow: 0 1px 0 rgba(0,0,0,.12);
  }
  .deck button:hover:not(:disabled), .pane-controls button:hover:not(:disabled) {
    background: var(--lem-face-hi); border-color: var(--burrow-glow);
  }
  .deck button:active:not(:disabled), .pane-controls button:active:not(:disabled),
  .mud-topbar-actions button:active:not(:disabled) {
    background: var(--lem-face-lo); box-shadow: inset 0 1px 2px rgba(0,0,0,.25);
  }
  .deck-play { background: var(--lem-go) !important; color: var(--parchment) !important; border-color: var(--lem-go) !important; }
  .deck-play[aria-pressed="true"] { background: var(--lem-alert) !important; border-color: var(--lem-alert) !important; color: var(--parchment) !important; }
  /* The corner readout: a lit panel display, in the burrow's own amber rather than DOS-console green. */
  .deck-turns { background: var(--lem-readout-bg); color: var(--lem-readout);
    border: 1px solid var(--soil-mid); border-radius: 2px; padding: .1rem .5rem; }
  .deck-info-btn { background: var(--lem-face); color: var(--mud-ink); border: 1px solid var(--soil-mid); }
  .deck-info-btn:hover, .deck-info-btn[aria-expanded="true"] { background: var(--lem-face-hi); border-color: var(--burrow-glow); color: var(--mud-ink); }
  #editModeBtn[aria-pressed="true"] { background: var(--burrow-glow); border-color: var(--burrow-glow); color: var(--mud-ink); }

  /* ---- whether the burrow is shared, said in one word on the panel ---- */
  .state-pill { display: inline-flex; align-items: center; gap: .34rem;
    font-family: ${MONO_STACK}; font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; }
  .state-dot { width: .46rem; height: .46rem; border-radius: 50%; background: var(--lem-face-lo); flex: 0 0 auto; }
  .state-pill[data-tone="waiting"] .state-dot { background: #E0912A; }
  .state-pill[data-tone="working"] .state-dot { background: #E0912A; }
  .state-pill[data-tone="live"] .state-dot { background: var(--lem-go); }
  .state-pill[data-tone="failed"] .state-dot { background: var(--lem-alert); }

  /* ---- a wave, and the node a character is played from ---- */
  .pill-strip { display: flex; align-items: flex-start; gap: .22rem; min-width: 0; }
  .pill-strip .chatpills { flex: 1 1 auto; min-width: 0; }
  .wave-btn { flex: 0 0 auto; }
  .sprite-card { position: relative; }
  .wave-hand { position: absolute; top: -0.55rem; right: -0.35rem; font-size: 1.1rem; line-height: 1;
    transform-origin: 70% 80%; animation: hand-wave .8s ease-in-out infinite; pointer-events: none; }
  @keyframes hand-wave { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(20deg); } }
  .sprite-node {
    margin-top: 1px; max-width: 100%; box-sizing: border-box;
    font-family: ${MONO_STACK}; font-size: .34rem; line-height: 1.3; letter-spacing: .01em; text-align: center;
    color: var(--soil-mid); background: rgba(239,230,216,.7); border-radius: 2px; padding: 0 .2rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pane-node { font-family: ${MONO_STACK}; font-size: .56rem; color: var(--soil-mid); opacity: .85; }
  .mud-window.remote .pane-controls button { display: none; }
  .mud-window.remote .room-view { box-shadow: inset 0 0 0 2px rgba(60,60,180,.35); }

  @media (prefers-reduced-motion: reduce) {
    .wave-hand { animation: none; }
  }
`;

// The shared overlay, re-pointed at the burrow's own palette: soil-deep card,
// parchment ink, the burrow-glow as the working accent, moss as the live one.
// Only variables change — every rule stays the component's.
const MUD_SHARE_SKIN = `
  .shareOverlay {
    --so-scrim: rgba(10, 6, 2, .74);
    --so-card: var(--soil-deep);
    --so-ink: var(--parchment);
    --so-muted: var(--chalk);
    --so-line: var(--soil-light);
    --so-accent: var(--burrow-glow);
    --so-good: #9DB36A;
    --so-warn: var(--burrow-glow);
    --so-alert: #FF9C82;
    --so-good-soft: rgba(157, 179, 106, .18);
    --so-accent-soft: rgba(232, 163, 61, .14);
    --so-alert-soft: rgba(255, 156, 130, .14);
    --so-display: ${DISPLAY_STACK};
    --so-body: ${SANS_STACK};
    --so-mono: ${MONO_STACK};
  }
`;

/** The inlined page script, as a plain function body handed to
 *  embedScriptText — mirrors spider-fly-viz.mjs's own `(function () {
 *  "use strict"; ... })()` IIFE shape, with every spliced helper listed at
 *  the top of the closure exactly like that page's own const bindings. */
function pageScript() {
  return `(function () {
  "use strict";
  const DATA = MUD_PAGE_DATA;
  const createTicker = ${createTicker.toString()};
  const createSerialQueue = ${createSerialQueue.toString()};
  const escapeHtml = ${escapeHtml.toString()};
  const esc = escapeHtml;
  const rowsForWorld = ${rowsForWorld.toString()};
  const appendLogLine = ${appendLogLine.toString()};
  const fnv1a32 = ${fnv1a32.toString()};
  const predatorSubjects = ${predatorSubjects.toString()};
  const paneMarkup = ${paneMarkup.toString()};
  const speciesOfCharacter = ${speciesOfCharacter.toString()};
  const mudRoomSceneObjects = ${mudRoomSceneObjects.toString()};
  const carriedItemsFor = ${carriedItemsFor.toString()};
  // EXIT_DELTA is data, not a function — directedGridLayout/roomGraphSvg both
  // close over it as a module-level const, which a \`.toString()\` splice never
  // carries (a spliced function's source text is its own body only), so it
  // travels here as JSON instead.
  const EXIT_DELTA = ${JSON.stringify(EXIT_DELTA)};
  const directedGridLayout = ${directedGridLayout.toString()};
  const roomGraphSvg = ${roomGraphSvg.toString()};
  const levelsOf = ${levelsOf.toString()};
  const charactersInRoom = ${charactersInRoom.toString()};
  const burrowGraph = ${burrowGraph.toString()};
  const diggableDirections = ${diggableDirections.toString()};
  const itemLabel = ${itemLabel.toString()};
  const isCreature = ${isCreature.toString()};
  const roomSceneObjects = ${roomSceneObjects.toString()};
  const scenePlacement = ${scenePlacement.toString()};
  const spriteClassForObject = ${spriteClassForObject.toString()};
  const spriteAncestryRows = ${spriteAncestryRows.toString()};
  const factsForSubject = ${factsForSubject.toString()};
  const visibleRoomOf = ${visibleRoomOf.toString()};
  const roomKindForRoom = ${roomKindForRoom.toString()};
  const allRoomIds = ${allRoomIds.toString()};
  const renderMudEditorText = ${renderMudEditorText.toString()};
  const wordBeforeCursor = ${wordBeforeCursor.toString()};
  const provenanceStamps = ${provenanceStamps.toString()};
  const peerTerm = ${peerTerm.toString()};
  const claimantOf = ${claimantOf.toString()};
  const wavingCharacters = ${wavingCharacters.toString()};
  const nodeNameFor = ${nodeNameFor.toString()};
  const offerBlobIn = ${offerBlobIn.toString()};
  const wireStateLabel = ${wireStateLabel.toString()};
  const tapeRowFor = ${tapeRowFor.toString()};
  const tapeClock = ${tapeClock.toString()};
  const nodeRowsFor = ${nodeRowsFor.toString()};
  const nodeInitials = ${nodeInitials.toString()};
  const inviteLinkFor = ${inviteLinkFor.toString()};
  const inviteParamsFrom = ${inviteParamsFrom.toString()};
  const shareStepStates = ${shareStepStates.toString()};
  const activeWaves = ${activeWaves.toString()};
  const shareMessageFor = ${shareMessageFor.toString()};
  const replyMessageFor = ${replyMessageFor.toString()};
  const whatsAppShareUrl = ${whatsAppShareUrl.toString()};
  const isProbablyMobile = ${isProbablyMobile.toString()};
  const copyText = ${copyTextToClipboard.toString()};
  const flashTip = ${flashCopyTip.toString()};

  const el = (id) => document.getElementById(id);
  // Which of the shipped burrows is loaded. Every read of the world — the
  // session it is opened over, the roster it is cast from, the provenance
  // prefix edit mode filters on — goes through this one index, so switching
  // scenarios needs no second copy of any of them.
  let scenarioIndex = 0;
  const scenario = function () { return DATA.scenarios[scenarioIndex]; };
  const rosterOf = function (s) { return (s.characters || []).map(function (c) { return c.id; }); };
  // Where the survey starts laying rooms out: the burrow's own origin, the
  // same fact the dig mechanic measures its reach from. Falling back to the
  // shipped default only matters for a world that declares no origin at all,
  // and burrowGraph already copes by starting from whichever room sorts first.
  const rootRoomOf = function (s) {
    const facts = (s.worldPayload && s.worldPayload.facts) || [];
    const origin = facts.find(function (f) { return f.predicate === "mgx:is-origin" && f.object === "true"; });
    return origin ? origin.subject : DATA.rootRoom;
  };
  let roster = rosterOf(scenario());
  let rootRoom = rootRoomOf(scenario());
  let slots = [];
  const ACTOR_COLORS = ["var(--actor-a)", "var(--actor-b)", "var(--actor-c)", "var(--actor-d)"];
  const NPC_COLOR = "var(--chalk)";
  const COMPASS = ["north", "south", "east", "west", "up", "down"];
  const DIR_GLYPH = { north: "\\u25B2 N", south: "\\u25BC S", west: "\\u25C0 W", east: "E \\u25B6", up: "\\u21E1", down: "\\u21E3" };
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- the one shared tick queue -----------------------------------------
  // Every pane's ticker calls into this instead of session.windows[...]
  // directly, so two characters' turns can never interleave their reads and
  // writes of the one shared memoryDir, and the global turn counter always
  // increments in real execution order.
  let tickQueue = createSerialQueue();
  function serializeTick(fn) { return tickQueue.run(fn); }

  let session = null;
  let cast = [];
  // The animals with no pane. They act through the same session windows and
  // the same tick queue as the cast; every list below that says "everyone"
  // means both, and every list that says "cast" means the panes alone.
  let npcs = [];
  let slotOf = {};
  let globalTurn = 0;
  let turnsTaken = {};
  let finished = {};
  let maxTurns = DATA.defaultMaxTurns;
  let delayMs = DATA.defaultDelayMs;
  const wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  const liveWait = function () { return wait(delayMs); };

  let freshlyDugRoom = null;
  // Which animals another node has claimed, character -> that node's name.
  // Refreshed from the store on every redraw, which is also every turn, so a
  // claim that arrives from a peer takes effect on the next tick rather than
  // being cached until something else happens to look.
  let claimedElsewhere = {};
  // Whoever is waving right now, and the timer that lets a wave stop being
  // current. A wave is never retracted — it just stops being recent.
  let wavingNow = [];
  let waveRedrawTimer = null;
  // The last omniscient read, kept so the pounce can draw the predator's own
  // den after the engine has already moved the character out of every room.
  let lastSnapshot = null;
  const speechBubbles = new Map(); // room -> [{ speaker, text, expiresAtTurn }]

  let tickers = {};
  let autoOn = false;

  function hasNext() { return globalTurn < maxTurns; }
  function everyone() { return cast.concat(npcs); }
  function hasPane(character) { return Boolean(slotOf[character]); }
  function paneIdFor(character) { return "window-" + slotOf[character]; }
  function colorFor(character) {
    const seat = cast.indexOf(character);
    return seat === -1 ? NPC_COLOR : ACTOR_COLORS[seat % ACTOR_COLORS.length];
  }

  // The engine keeps each character's own tally (its scripted ticks AND its
  // typed commands), which is the only one that can be right: a typed "dig
  // north" is a turn the page never drove. The page's own count of the ticks it
  // fired is the fallback, so a pane never falls back to showing the shared
  // global figure as if it were its own.
  function turnsFor(character) {
    const w = session && session.windows[character];
    const own = w && typeof w.turnsTaken === "function" ? w.turnsTaken() : null;
    return typeof own === "number" ? own : (turnsTaken[character] || 0);
  }

  async function runOneTurn(character) {
    // A tick already queued when a reset lands belongs to a world that no
    // longer exists, and a dozen animals make that overlap ordinary rather
    // than rare.
    const bootAt = bootSeq;
    return serializeTick(async function () {
      if (bootAt !== bootSeq || finished[character]) return { outOfPlay: true };
      // An animal another node claimed is played there, not here. Its moves
      // still arrive as facts and it still draws, talks and can be waved at —
      // this page just never takes its turn for it.
      if (claimedElsewhere[character]) return { playedElsewhere: true };
      globalTurn += 1;
      const result = await session.windows[character].autoplayTick(globalTurn);
      if (!result.outOfPlay) turnsTaken[character] = (turnsTaken[character] || 0) + 1;
      afterEngineTurn(character, result);
      await broadcastLocalChange();
      return result;
    });
  }

  // A character whose run has ended keeps its pane, its final turn count and
  // its chat log, and loses everything that would advance it — the engine
  // declines its turns from here on, so offering the controls would promise a
  // turn that never runs. An NPC has none of that to lose: it stops ticking and
  // the survey stops drawing it, which is the whole of its ending. WHICH ending
  // it was is never cached here — every reader asks the engine fresh, so a pane
  // that says "eaten" over an animal that quietly starved is never possible.
  function markOutOfPlay(character, reason, note) {
    if (finished[character]) return;
    finished[character] = true;
    const ticker = tickers[character];
    if (ticker) ticker.pause();
    if (!hasPane(character)) return;
    const w = paneIdFor(character);
    el(w + "-play").disabled = true;
    el(w + "-step").disabled = true;
    el(w + "-chatq").disabled = true;
    el(w + "-chatpills").innerHTML = "";
    const fate = reason === "starved" ? "starved" : "eaten";
    // A run that ended on a TYPED command carries no note of its own — the
    // world's ending sentence comes from the engine either way, never a second
    // wording of the same event.
    appendChat(character, "a", note
      || (window.tmct.page.outOfPlayPhrase(character, fate) + ". It takes no more turns."));
    playFateScene(character, fate);
  }

  // Whichever individual the WORLD marks dangerous, never a species this page
  // hardcodes — the same domain/mud-facts.mjs reader mud-turn.mjs's own
  // predator check reads server-side.
  function predatorInRows(rows) {
    return predatorSubjects(rows)[0] || null;
  }

  // The pane holds on the den for the length of one pounce before it grays out.
  // Cutting straight to the banner throws away the only moment this demo has to
  // show what took the character: the character's last drawn room is the one it
  // walked out OF, so the scene is redrawn against the den first, then the fox
  // crosses it. An animal that ran out of mass was taken by nothing, so it
  // settles straight into its banner — as does reduced motion, or a world with
  // no marked predator.
  function playFateScene(character, fate) {
    const w = paneIdFor(character);
    const settle = function () {
      el(w).classList.add("out-of-play");
      const banner = el(w + "-fate");
      banner.hidden = false;
      banner.textContent = fate + " \\u00b7 " + turnsFor(character) + " turns";
    };
    const predator = lastSnapshot ? predatorInRows(lastSnapshot.rows) : null;
    const den = predator ? (lastSnapshot.state.placements.get(predator) || {}).object : null;
    if (fate === "starved" || reduceMotion || !den) { settle(); return; }

    const rows = lastSnapshot.rows;
    const state = lastSnapshot.state;
    renderRoomView(character, rows, state, den, allRoomIds(rows),
      window.tmct.page.castInRoom(rows, state, den, character));

    const room = el(w + "-room");
    const lunger = room.querySelector('.floor-others .sprite-card[data-subject="' + predator + '"]');
    const prey = el(w + "-self");
    if (!lunger || !prey) { settle(); return; }
    const gap = prey.getBoundingClientRect().left - lunger.getBoundingClientRect().left;
    lunger.style.setProperty("--pounce-x", Math.max(0, Math.round(gap) - 8) + "px");
    room.classList.add("pounce");
    lunger.classList.add("lunging");
    setTimeout(settle, 1000);
  }

  // A bubble carries what was SAID, not the sentence: the answer names a
  // thing, and the thing's own display label is only resolvable against the
  // fact rows a redraw has and a finished turn does not.
  function noteSpeech(room, speaker, bubble) {
    if (!speechBubbles.has(room)) speechBubbles.set(room, []);
    speechBubbles.get(room).push(Object.assign({ speaker: speaker, expiresAtTurn: globalTurn + 2 }, bubble));
  }

  function afterEngineTurn(character, result) {
    if (result && result.outOfPlay) {
      markOutOfPlay(character, result.outOfPlayReason, result.text);
      renderSoon();
      return;
    }
    if (!result || !result.room) { renderSoon(); return; }
    if (result.roomAfter && result.roomAfter !== result.room) freshlyDugRoom = result.roomAfter;
    for (const action of result.actions || []) {
      if (action.kind !== "ask" && action.kind !== "talk") continue;
      const other = action.teller || action.target || action.object;
      if (action.text) noteSpeech(result.room, character, { text: action.text });
      if (other && action.thing) noteSpeech(result.room, other, { thing: action.thing });
      else if (other && action.text) noteSpeech(result.room, other, { text: action.text });
    }
    renderSoon();
  }

  function ensureTicker(character) {
    if (tickers[character]) return tickers[character];
    const playBtn = hasPane(character) ? el(paneIdFor(character) + "-play") : null;
    tickers[character] = createTicker({
      onTick: function () { return runOneTurn(character); },
      onRender: function (state) {
        if (playBtn) playBtn.textContent = state.playing ? "\\u23F8 pause" : "\\u25B6 play";
      },
      hasNext: hasNext,
      wait: liveWait,
    });
    return tickers[character];
  }

  // ---- chat docks ---------------------------------------------------------
  // The line's own text is never shortened, only its rendered height — the whole
  // thing stays readable through the popup, and stays in the DOM for anything
  // reading the log.
  function appendChat(character, cls, text) {
    appendLogLine(el(paneIdFor(character) + "-chatlog"), cls, text, { clip: true });
  }

  function openLogPopup(slot, text) {
    const w = "window-" + slot;
    el(w + "-logpop-text").textContent = text;
    el(w + "-logpop").hidden = false;
  }

  function closeLogPopup(slot) {
    el("window-" + slot + "-logpop").hidden = true;
  }

  function sendCommand(character, line) {
    appendChat(character, "u", line);
    const owner = claimedElsewhere[character];
    if (owner) {
      const refusal = character + " is played from " + owner + ". You can watch it and wave at it, but its turns are theirs.";
      appendChat(character, "a", refusal);
      return Promise.resolve({ answer: refusal, end: false });
    }
    // A wave is a gesture, not a world command — the engine has no verb for it
    // and would answer with an honest miss. Both ways in (this typed line and
    // the pane's own hand button) write the same fact.
    if (/^\\/?wave$/i.test(line.trim())) {
      return waveAs(character).then(function (here) {
        appendChat(character, "a", here
          ? "you wave. Everyone in the " + here + " sees it."
          : character + " is standing nowhere, so there is nobody to wave at.");
        return { answer: "", end: false };
      });
    }
    return serializeTick(function () { return tmct.turn(line, { as: character }); }).then(async function (res) {
      appendChat(character, "a", res.answer);
      await broadcastLocalChange();
      renderSoon();
      return res;
    });
  }

  // A wave is an ordinary add-only fact in the shared world, so it needs no
  // network to work: one browser renders it exactly the way four do, and the
  // room broadcast below is the only part sharing adds.
  async function waveAs(character) {
    if (!session || finished[character]) return null;
    const here = await serializeTick(function () { return session.wave(character); });
    if (here) await broadcastLocalChange();
    renderSoon();
    return here;
  }

  // Wired as the pane is built. The stage is rebuilt on every boot, so a
  // pane's listeners live and die with it; each one still reads its slot's
  // character at click time, because the cast is bound after the markup.
  function wirePane(slot) {
    const w = "window-" + slot;
    const input = el(w + "-chatq");
    el(w + "-chatform").addEventListener("submit", function (e) {
      e.preventDefault();
      const character = characterInSlot(slot);
      const line = input.value.trim();
      if (!character || !line) return;
      input.value = "";
      sendCommand(character, line);
    });
    el(w + "-play").addEventListener("click", function () {
      const character = characterInSlot(slot);
      if (!character) return;
      const ticker = ensureTicker(character);
      if (ticker.getState().playing) ticker.pause(); else ticker.play();
    });
    el(w + "-step").addEventListener("click", function () {
      const character = characterInSlot(slot);
      if (character) ensureTicker(character).stepOnce();
    });
    el(w + "-wave").addEventListener("click", function () {
      const character = characterInSlot(slot);
      if (character) sendCommand(character, "wave");
    });

    const log = el(w + "-chatlog");
    log.addEventListener("click", function (e) {
      const line = e.target.closest(".clipped");
      if (line) openLogPopup(slot, line.textContent);
    });
    log.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const line = e.target.closest(".clipped");
      if (!line) return;
      e.preventDefault();
      openLogPopup(slot, line.textContent);
    });
    el(w + "-logpop-close").addEventListener("click", function () { closeLogPopup(slot); });
    el(w).addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLogPopup(slot);
    });

    // Clicking a drawn thing runs the same grounded command its pill would, so
    // the room view is a second way into one action set rather than its own.
    // A sprite the room grants no action on carries no command and does nothing.
    el(w + "-room").addEventListener("click", function (e) {
      const card = e.target.closest(".sprite-card[data-command]");
      const character = characterInSlot(slot);
      if (!card || !character || finished[character]) return;
      sendCommand(character, card.getAttribute("data-command"));
    });
    el(w + "-room").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".sprite-card[data-command]");
      const character = characterInSlot(slot);
      if (!card || !character || finished[character]) return;
      e.preventDefault();
      sendCommand(character, card.getAttribute("data-command"));
    });
  }

  function characterInSlot(slot) {
    return cast[slots.indexOf(slot)] || null;
  }

  // ---- room-view rendering -------------------------------------------------
  function hashOf(text) {
    return fnv1a32(String(text));
  }

  function spriteSvgFor(species, rows, instanceKey) {
    if (window.tmct && window.tmct.page.resolveSpriteAsset) {
      return window.tmct.page.resolveSpriteAsset(species, rows, [], DATA.spriteTemplates, window.tmct.page.SPRITE_REGISTRY, { instanceKey: instanceKey });
    }
    return "";
  }

  // A wall-hung object resolves through the SAME property-aware, large-tier
  // resolver the characters do, keyed on the object's OWN name (via
  // spriteAncestryRows' synthetic subClassOf edge to its declared class), so
  // a carrot draws a carrot and only a class with no template anywhere falls
  // back. The fallback root is "portable", not the resolver's default
  // "animal": everything hung on this wall is a thing, and a thing with no
  // sprite should read as a plain parcel rather than a creature.
  function objectSvgFor(subject, rows) {
    if (window.tmct && window.tmct.page.resolveSpriteAsset) {
      return window.tmct.page.resolveSpriteAsset(
        subject, spriteAncestryRows(rows, subject), factsForSubject(rows, subject),
        DATA.spriteTemplates, window.tmct.page.SPRITE_REGISTRY,
        { rootFallback: "portable", instanceKey: subject },
      );
    }
    return "";
  }

  // The backdrop is a drawing of what the digest already says about the room:
  // turf and sky above ground, packed strata and pebbles below it. Every
  // stroke is placed off a hash of the room's own id, so a room looks the
  // same every redraw and two rooms never look alike.
  function drawRoomBackdrop(canvas, kind, room) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (kind === "outdoor") {
      grad.addColorStop(0, "#A9BE83"); grad.addColorStop(0.42, "#7E9159"); grad.addColorStop(1, "#5C6B41");
    } else {
      grad.addColorStop(0, "#63482F"); grad.addColorStop(0.55, "#42301F"); grad.addColorStop(1, "#241710");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const seed = hashOf(room);
    ctx.save();
    if (kind === "outdoor") {
      ctx.strokeStyle = "rgba(45,62,30,.5)";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 26; i += 1) {
        const x = ((seed * (i + 3)) % w);
        const base = h - 6 - ((seed >> (i % 5)) % 8);
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + (i % 2 ? 3 : -3), base - 9 - (i % 4) * 2);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(0,0,0,.22)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i += 1) {
        const y = (h / 4) * i + ((seed >> i) % 6) - 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 30) ctx.lineTo(x, y + (((seed + x) % 7) - 3));
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,.07)";
      for (let i = 0; i < 14; i += 1) {
        const x = ((seed * (i + 7)) % w);
        const y = ((seed * (i + 2)) % h);
        ctx.beginPath();
        ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    const floor = ctx.createLinearGradient(0, h - 26, 0, h);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, h - 26, w, 26);
  }

  // The world's own hasMass fold, the same one the pouch's stat line reads.
  // Null for anything the world never weighed, which draws no figure at all
  // rather than a guessed one.
  function massOf(state, subject) {
    const mass = state.masses.get(subject);
    return mass ? mass.value : null;
  }

  // A sprite card: adventure.html's own frame-plus-nameplate, carrying the one
  // command this room currently grants on its subject (none, for a thing the
  // room offers nothing on) and the subject's own mass under the name. The
  // last argument holds the two things only a shared burrow has: a hand over a
  // character waving right now, and the node another peer plays it from — one
  // more line under the name, in the same font, never a second label system.
  function spriteCardHtml(subject, label, inner, command, extraClass, mass, extra) {
    const opts = extra || {};
    const action = command
      ? ' actionable" data-command="' + esc(command) + '" role="button" tabindex="0" title="' + esc(command) + '"'
      : '" title="' + esc(label) + '"';
    return '<div class="sprite-card ' + (extraClass || "") + (opts.waving ? " waving" : "") + action
      + ' data-subject="' + esc(subject) + '">'
      + (opts.waving ? '<div class="wave-hand" aria-hidden="true">\\u{1F44B}</div>' : "")
      + inner + '<div class="sprite-label">' + esc(label) + "</div>"
      + (opts.node ? '<div class="sprite-node">via ' + esc(opts.node) + "</div>" : "")
      + (mass === null || mass === undefined ? "" : '<div class="sprite-mass">mass ' + esc(mass) + "</div>")
      + "</div>";
  }

  // A character another node plays carries that node's name; one this node
  // plays, or one nobody has claimed, carries nothing extra.
  function nodeLabelFor(character) {
    return claimedElsewhere[character] || null;
  }
  function isWavingNow(character) {
    return wavingNow.indexOf(character) !== -1;
  }

  function renderRoomView(character, rows, state, here, roomIds, roomMates) {
    const w = paneIdFor(character);
    drawRoomBackdrop(el(w + "-canvas"), roomKindForRoom(rows, here), here);
    const commands = commandsBySubject(affordancesFor(rows, state, here, character));

    el(w + "-self").innerHTML = spriteCardHtml(
      character, character,
      '<div class="sprite">' + spriteSvgFor(speciesOfCharacter(character), rows, character) + "</div>",
      null, "self", massOf(state, character),
      { waving: isWavingNow(character), node: nodeLabelFor(character) },
    );

    const others = roomMates.map(function (mate) {
      return spriteCardHtml(mate, mate,
        '<div class="sprite">' + spriteSvgFor(speciesOfCharacter(mate), rows, mate) + "</div>",
        commands[mate], "", massOf(state, mate),
        { waving: isWavingNow(mate), node: nodeLabelFor(mate) });
    });
    const wall = [];
    for (const obj of mudRoomSceneObjects(rows, state, here, character)) {
      if (isCreature(state, obj.subject)) continue;
      const plane = scenePlacement(rows, state, obj.subject).plane;
      const hang = plane === "ceiling" || plane === "wall" ? "hangs-high" : "hangs-low";
      // The caption is always the THING'S own name, never the class whose
      // sprite ended up drawn — an item wearing an ancestor's icon because
      // its own class has no sprite yet still has to say what it is.
      wall.push(spriteCardHtml(obj.subject, labelForItem(rows, obj.subject, roomIds),
        '<div class="hook"></div><div class="sprite-frame">' + objectSvgFor(obj.subject, rows) + "</div>",
        commands[obj.subject], "wall-item " + hang, massOf(state, obj.subject)));
    }
    const othersEl = el(w + "-others");
    othersEl.innerHTML = others.join("");
    const floorForMates = el(w + "-room").clientWidth - 68;
    othersEl.style.setProperty("--mate-width",
      Math.max(18, Math.min(76, Math.floor(floorForMates / Math.max(1, others.length)) - 6)) + "px");
    el(w + "-wall").innerHTML = wall.join("");

    const live = (speechBubbles.get(here) || []).filter(function (b) { return b.expiresAtTurn >= globalTurn; });
    el(w + "-bubbles").innerHTML = live.map(function (b) {
      const side = b.speaker === character ? "from-self" : "from-other";
      const said = b.thing ? "there's " + labelForItem(rows, b.thing, roomIds) + ", if you can reach it." : b.text;
      return '<div class="bubble ' + side + '">' + esc(said) + "</div>";
    }).join("");

    const flourishEl = el(w + "-flourish");
    if (freshlyDugRoom && freshlyDugRoom === here && !reduceMotion) {
      flourishEl.hidden = false;
      flourishEl.classList.add("shown");
      setTimeout(function () { flourishEl.classList.remove("shown"); flourishEl.hidden = true; }, 900);
    }

    el(w + "-caption").textContent = roomCaptionFor(rows, state, here, character, roomMates);
  }

  // The digest's own room sentences say what the ROOM is, and nothing about who
  // is standing in it — a "Badger-2 is in the sett-1" row is filed under the
  // badger, not the sett, so filtering the view to this room drops every mate.
  // The cast sentence comes from the same list the talk pills and the floor
  // sprites read, so the description can never name a different set of animals
  // than the pane offers to talk to.
  function roomCaptionFor(rows, state, here, character, roomMates) {
    const parts = [];
    const view = window.tmct.page.worldDigestRows(rows, state, character);
    const lines = view.filter(function (r) { return r.subject.toLowerCase() === here.toLowerCase(); })
      .map(function (r) { return r.subject + " " + r.predicate + " " + r.object + "."; });
    parts.push(lines.length ? lines.join(" ") : "You are in the " + here + ".");
    if (roomMates.length) {
      parts.push("Here with you: " + roomMates.map(function (mate) {
        const mass = massOf(state, mate);
        return "the " + mate + (mass === null ? "" : " (mass " + mass + ")");
      }).join(", ") + ".");
    }
    return parts.join(" ");
  }

  // ---- the compass ring ----------------------------------------------------
  // One button per direction, in the slot that direction points at: the "go"
  // a written exit already allows, or the "dig" that would open one. A
  // direction with neither draws nothing, so the ring never offers a command
  // the world would refuse.
  function diggableFor(rows, state, here) {
    const fromEngine = window.tmct && window.tmct.page.diggableDirections;
    return fromEngine ? fromEngine(rows, state, here) : diggableDirections(rows, state, here);
  }

  function renderDirections(character, rows, state, here) {
    const w = paneIdFor(character);
    const exits = state.exits.get(here);
    const diggable = diggableFor(rows, state, here);
    for (const direction of COMPASS) {
      const slot = el(w + "-dir-" + direction);
      const open = exits && exits.has(direction);
      const command = open ? "go " + direction : (diggable.indexOf(direction) !== -1 ? "dig " + direction : null);
      if (!command) { slot.innerHTML = ""; continue; }
      const cls = "dir-pill " + (open ? "go" : "dig") + (direction === "up" || direction === "down" ? " vertical" : "");
      slot.innerHTML = '<button type="button" class="' + cls + '" data-command="' + esc(command) + '" title="' + esc(command)
        + '" aria-label="' + esc(command) + '">' + DIR_GLYPH[direction] + "</button>";
      slot.querySelector("button").addEventListener("click", function () { sendCommand(character, command); });
    }
  }

  // ---- the pill row --------------------------------------------------------
  // Every action the room actually grants comes from the engine's own
  // roomAffordances — the SAME list the "You can:" line in a look reply is built
  // from — so nothing the reply above offers can be missing from the row beneath
  // it. Exits appear in both the row and the compass ring on purpose: the ring
  // says WHERE a way out points, the row says what it is called.
  function affordancesFor(rows, state, here, character) {
    const fromEngine = window.tmct && window.tmct.page.roomAffordances;
    return fromEngine ? fromEngine(rows, state, here, character) : [];
  }

  function subjectOfAction(action) {
    return action.indexOf("talk to ") === 0 ? action.slice(8) : action.slice(action.indexOf(" ") + 1);
  }

  function commandsBySubject(actions) {
    const bySubject = {};
    for (const action of actions) {
      if (action.indexOf("go ") === 0) continue;
      bySubject[subjectOfAction(action)] = action;
    }
    return bySubject;
  }

  function renderChatPills(character, rows, state, here, roomIds) {
    const w = paneIdFor(character);
    const pillsEl = el(w + "-chatpills");
    const pills = [
      { command: "look", label: "look", cls: "" },
      { command: "what do you know about food", label: "what do you know about food", cls: "" },
    ];
    for (const action of affordancesFor(rows, state, here, character)) {
      if (action.indexOf("go ") === 0) { pills.push({ command: action, label: action, cls: " affordance way" }); continue; }
      const subject = subjectOfAction(action);
      const label = action.slice(0, action.length - subject.length) + labelForItem(rows, subject, roomIds);
      pills.push({ command: action, label: label, cls: " affordance" });
    }
    pillsEl.innerHTML = pills.map(function (p) {
      return '<button type="button" class="pill' + p.cls + '" data-command="' + esc(p.command)
        + '" title="' + esc(p.command) + '">' + esc(p.label) + "</button>";
    }).join("");
    for (const pill of pillsEl.querySelectorAll(".pill")) {
      pill.addEventListener("click", function () {
        sendCommand(character, pill.getAttribute("data-command"));
      });
    }
  }

  function renderPouch(character, rows, state, roomIds) {
    const w = paneIdFor(character);
    const items = carriedItemsFor(rows, state, character);
    el(w + "-pouch-list").innerHTML = items.map(function (i) {
      return '<li title="' + esc(i.subject) + '">' + esc(labelForItem(rows, i.subject, roomIds)) + "</li>";
    }).join("");
    const mass = state.masses.get(character);
    const drain = DATA.mudConfig[speciesOfCharacter(character) + "MassDecrementPerTurn"];
    el(w + "-stats").textContent = "mass " + (mass ? mass.value : "?") + (drain !== undefined ? " \\u00b7 drain/turn " + drain : "");
  }

  // The world mints a dug object with its own display-name fact, so the engine
  // can say "carrot" while every verb still resolves the distinct id
  // ("carrot-1"). itemLabel is the fallback for an id carrying no such fact.
  function labelForItem(rows, subject, roomIds) {
    const fromEngine = window.tmct && window.tmct.page.displayNameOf;
    const name = fromEngine ? fromEngine(rows, subject) : null;
    return name && name !== subject ? name : itemLabel(subject, roomIds);
  }

  // ---- the burrow survey ---------------------------------------------------
  // One routine, drawn twice: the omniscient board in the top row (every room
  // the world has) and each pane's own known ground (only what that character
  // has dug or walked, with a fading stub where it knows a way carries on). A
  // thin wrapper over the shared roomGraphSvg, fixed to the burrow's own
  // "turf" treatment (ground line, tunnels/shafts, per-room occupant dots)
  // and its own "burrow" wrapper class.
  function burrowSvg(graph, options) {
    return roomGraphSvg(graph, Object.assign({ turf: true, wrapClass: "burrow" }, options || {}));
  }

  function renderMinimap(character, rows, state, here) {
    const visited = session.windows[character].visitedRoomIds();
    const graph = burrowGraph(state, visited, rootRoom);
    el(paneIdFor(character) + "-minimap").innerHTML = burrowSvg(graph, {
      compact: true, here: here, label: "the ground " + character + " has covered",
    });
  }

  function renderWorldMap(rows, state, roomIds) {
    const graph = burrowGraph(state, roomIds, rootRoom);
    const occupants = {};
    for (const room of roomIds) {
      const here = charactersInRoom(state, room, everyone());
      if (!here.length) continue;
      occupants[room] = here.map(function (c) { return { character: c, color: colorFor(c) }; });
    }
    el("worldMapBoard").innerHTML = burrowSvg(graph, {
      occupants: occupants, fresh: freshlyDugRoom, label: "every room in the burrow, and who stands where",
    });
    // One key entry per pane, because a pane is what a colour identifies. The
    // npcs share the last entry: naming ten of them would take more room than
    // the survey they annotate, and each one's own dot already carries its name.
    const keys = cast.map(function (c) {
      const room = state.placements.get(c) ? state.placements.get(c).object : "?";
      const fate = window.tmct.page.outOfPlayReasonOf(state, c);
      const where = fate ? fate : "in " + esc(room);
      return '<span class="key-actor"><span class="key-dot" style="background:' + colorFor(c) + '"></span>'
        + esc(speciesOfCharacter(c)) + " " + where + "</span>";
    });
    if (npcs.length) {
      const live = npcs.filter(function (c) { return !finished[c]; }).length;
      const tally = live === npcs.length ? String(npcs.length) : live + " of " + npcs.length;
      keys.push('<span class="key-npcs"><span class="key-dot" style="background:' + NPC_COLOR + '"></span>'
        + tally + (live === 1 ? " npc" : " npcs") + " digging</span>");
    }
    el("worldMapKey").innerHTML = keys.join("");
    el("worldMapTurn").textContent = "turn " + globalTurn;
  }

  // A whole redraw per turn is one thing at two characters and quite another at
  // fourteen, where the ticks land faster than a snapshot can be read. Requests
  // arriving mid-render collapse into a single follow-up, so the page always
  // ends up drawing the newest state and never queues a backlog of stale ones.
  let rendering = false;
  let renderAgain = false;
  async function renderSoon() {
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try {
      await renderAll();
    } finally {
      rendering = false;
    }
    if (renderAgain) { renderAgain = false; renderSoon(); }
  }

  // A character eaten on its OWN turn is out of play the moment that turn
  // returns, one whole tick before autoplayTick would report it — so every
  // character's fate is read from the engine every redraw, not only off a tick
  // result. It reads against the snapshot this redraw already holds: a
  // per-window call would re-fold the whole world once per animal.
  async function renderAll() {
    if (!session) return;
    el("globalTurnCount").textContent = "turns: " + globalTurn;
    const snap = await session.snapshot();
    lastSnapshot = snap;
    const roomIds = allRoomIds(snap.rows);
    const nowMs = Date.now();
    wavingNow = wavingCharacters(snap.rows, nowMs);
    // Every claimed animal, not just the ones this page cast: a character
    // another node plays walks into this room as an ordinary room-mate, and
    // its label has to name where it is played from just the same.
    claimedElsewhere = {};
    if (myPeerId) {
      const claimed = {};
      for (const row of snap.rows) if (row.predicate === "mgx:playedBy") claimed[row.subject] = true;
      for (const character of Object.keys(claimed)) {
        const owner = claimantOf(snap.rows, character);
        if (owner === null || peerTerm(owner) === peerTerm(myPeerId)) continue;
        claimedElsewhere[character] = nodeNameFor(snap.rows, owner);
        const ticker = tickers[character];
        if (ticker) ticker.pause();
      }
    }
    for (const character of everyone()) {
      const reason = window.tmct.page.outOfPlayReasonOf(snap.state, character);
      if (reason) markOutOfPlay(character, reason, null);
    }
    renderWorldMap(snap.rows, snap.state, roomIds);
    for (const character of cast) {
      const pane = paneIdFor(character);
      el(pane + "-turn").textContent = "turn " + turnsFor(character);
      const owner = claimedElsewhere[character];
      el(pane).classList.toggle("remote", Boolean(owner));
      el(pane + "-node").hidden = !owner;
      el(pane + "-node").textContent = owner ? "played from " + owner : "";
      if (finished[character]) continue;
      const place = snap.state.placements.get(character);
      const here = place ? place.object : null;
      if (!here) continue;
      const roomMates = window.tmct.page.castInRoom(snap.rows, snap.state, here, character);
      renderRoomView(character, snap.rows, snap.state, here, roomIds, roomMates);
      renderDirections(character, snap.rows, snap.state, here);
      renderChatPills(character, snap.rows, snap.state, here, roomIds);
      renderPouch(character, snap.rows, snap.state, roomIds);
      renderMinimap(character, snap.rows, snap.state, here);
    }
    freshlyDugRoom = null;
    // A wave carries no retraction, so nothing tells the page when one stops
    // being current — the recency window does, and only a redraw can notice it
    // has passed. One follow-up per second while any hand is up, and none at
    // all once they are all down.
    clearTimeout(waveRedrawTimer);
    if (wavingNow.length) waveRedrawTimer = setTimeout(renderSoon, 1000);
  }

  // ---- edit mode -----------------------------------------------------------
  // The textarea is seeded from renderMudEditorText over the world's OWN facts.
  // Reads are scoped to this world's provenance tag the same way session
  // .applyEdit scopes its writes: the live store also carries the default
  // persona's background corpus, and this page must never show, or risk
  // retracting, a fact that is not part of the burrow.
  //
  // Typing debounces two things at two paces. The suggestion pills are cheap
  // in-memory lookups and can chase the cursor (~180ms). The store sync is the
  // one that writes, so it waits for the typing to settle (~450ms) — a
  // half-finished word must never be read as what somebody meant.
  let editRows = [];
  let editState = { placements: new Map(), openness: new Map(), masses: new Map(), exits: new Map(), turnCount: 0 };
  let allStoreRows = [];
  let selectedRoomId = null;
  let editing = false;

  function worldOnlyRows(rows) {
    return rowsForWorld(rows, scenario().worldPayload.name);
  }

  function renderEditMap() {
    const graph = burrowGraph(editState, allRoomIds(editRows), rootRoom);
    el("editMapBoard").innerHTML = graph.nodes.length
      ? burrowSvg(graph, { here: selectedRoomId, label: "every room this world writes" })
      : '<span class="edit-empty">no rooms written yet</span>';
  }

  // A class card, the legend's and the room detail's shared unit — the sprite
  // frame the panes already use, shrunk, with the subject's own name under it.
  function editCardHtml(subject, label, svg) {
    return '<div class="sprite-card" title="' + esc(subject) + '"><div class="sprite-frame">' + svg
      + '</div><div class="sprite-label">' + esc(label) + "</div></div>";
  }

  // Every class this world actually puts in a room, by its own icon. A creature
  // resolves on its species (the same read every pane's own sprite makes), a
  // prop on its declared class — so the legend shows what the survey shows.
  function renderEditLegend() {
    const classes = {};
    for (const subject of editState.placements.keys()) {
      const cls = isCreature(editState, subject) ? speciesOfCharacter(subject) : spriteClassForObject(editRows, subject);
      if (cls) classes[cls] = true;
    }
    const names = Object.keys(classes).sort();
    el("editLegend").innerHTML = names.length
      ? names.map(function (cls) { return editCardHtml(cls, cls, spriteSvgFor(cls, editRows, "legend-" + cls)); }).join("")
      : '<span class="edit-empty">nothing placed yet</span>';
  }

  function renderRoomDetail() {
    const titleEl = el("roomDetailTitle");
    const castEl = el("roomDetailCast");
    const captionEl = el("roomDetailCaption");
    if (!selectedRoomId) {
      titleEl.textContent = "click a room";
      castEl.innerHTML = "";
      captionEl.textContent = "Click a room on the survey to see what stands in it.";
      return;
    }
    titleEl.textContent = selectedRoomId;
    const roomIds = allRoomIds(editRows);
    const here = [];
    for (const subject of editState.placements.keys()) {
      if (visibleRoomOf(editRows, editState, subject) !== selectedRoomId) continue;
      const creature = isCreature(editState, subject);
      here.push({
        subject: subject,
        label: creature ? subject : labelForItem(editRows, subject, roomIds),
        svg: creature ? spriteSvgFor(speciesOfCharacter(subject), editRows, subject) : objectSvgFor(subject, editRows),
      });
    }
    // Codepoint order, never localeCompare — a placed subject traces back to
    // a world fact, and two readers must render the same room-detail cast
    // order regardless of the browser's own locale.
    here.sort(function (a, b) { return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0; });
    castEl.innerHTML = here.map(function (t) { return editCardHtml(t.subject, t.label, t.svg); }).join("");
    const kind = roomKindForRoom(editRows, selectedRoomId);
    const ways = [...(editState.exits.get(selectedRoomId) || new Map()).keys()].sort();
    captionEl.textContent = "An " + kind + " room. "
      + (ways.length ? "Ways out: " + ways.join(", ") + ". " : "No way out written yet. ")
      + (here.length ? here.length + " thing" + (here.length === 1 ? "" : "s") + " placed here." : "Nothing placed here.");
  }

  function refreshEditPanels() {
    renderEditMap();
    renderEditLegend();
    renderRoomDetail();
  }

  el("editMapBoard").addEventListener("click", function (e) {
    const g = e.target.closest("[data-room]");
    if (!g) return;
    selectedRoomId = g.getAttribute("data-room");
    renderEditMap();
    renderRoomDetail();
  });

  // The lateral SKOS neighbourhood plus the vertical is-a chain for whatever
  // word the cursor sits behind. Read over the FULL store, not the world's own
  // rows: a term's synonyms mostly live in the background corpus, not in the
  // burrow's own vocabulary. Nothing found is nothing shown — an honest miss.
  function renderSuggestionPills() {
    const box = el("editorPills");
    const term = wordBeforeCursor(el("editorText").value, el("editorText").selectionStart);
    if (!term || !window.tmct) { box.innerHTML = ""; return; }
    const related = window.tmct.page.relatedForTerm ? window.tmct.page.relatedForTerm(allStoreRows, term) : null;
    const chain = window.tmct.page.classAncestorChain ? window.tmct.page.classAncestorChain(term, allStoreRows) : [];
    const seen = { };
    seen[term] = true;
    const out = [];
    const push = function (label) { if (label && !seen[label]) { seen[label] = true; out.push(label); } };
    if (related) {
      related.synonyms.forEach(push);
      related.related.forEach(function (r) { push(r.prefLabel); });
    }
    chain.slice(1).forEach(push);
    box.innerHTML = out.slice(0, 8).map(function (s) {
      return '<button type="button" class="pill" data-insert="' + esc(s) + '">' + esc(s) + "</button>";
    }).join("");
  }

  el("editorPills").addEventListener("click", function (e) {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    const area = el("editorText");
    const pos = area.selectionStart;
    const word = wordBeforeCursor(area.value, pos);
    const insert = btn.getAttribute("data-insert");
    area.value = area.value.slice(0, pos - word.length) + insert + area.value.slice(pos);
    const next = pos - word.length + insert.length;
    area.setSelectionRange(next, next);
    area.focus();
    onEditorChanged();
  });

  async function applyEditorText() {
    if (!session) return;
    const status = el("editorStatus");
    status.className = "edit-status pending";
    status.textContent = "reading the burrow\\u2026";
    const result = await serializeTick(function () { return session.applyEdit(el("editorText").value); });
    await broadcastLocalChange();
    const snap = await session.snapshot();
    allStoreRows = snap.rows;
    editRows = worldOnlyRows(snap.rows);
    editState = window.tmct.page.foldWorldState(window.tmct.page.worldActionRows(editRows));
    if (result.unrecognized.length) {
      const lines = result.unrecognized.map(function (u) { return u.line; }).join(", ");
      status.className = "edit-status pending";
      status.textContent = result.unrecognized.length + " line"
        + (result.unrecognized.length === 1 ? "" : "s") + " not understood yet (line " + lines
        + ") \\u2014 nothing is retracted until they are.";
    } else {
      status.className = "edit-status ok";
      status.textContent = (result.added || result.removed)
        ? "synced \\u2014 " + result.added + " fact(s) written, " + result.removed + " retracted."
        : "synced \\u2014 no change.";
    }
    refreshEditPanels();
  }

  let suggestTimer = null;
  let syncTimer = null;
  function scheduleSuggestions() { clearTimeout(suggestTimer); suggestTimer = setTimeout(renderSuggestionPills, 180); }
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(applyEditorText, 450); }
  function onEditorChanged() { scheduleSuggestions(); scheduleSync(); }
  el("editorText").addEventListener("input", onEditorChanged);
  el("editorText").addEventListener("click", scheduleSuggestions);
  el("editorText").addEventListener("keyup", function (e) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) !== -1) scheduleSuggestions();
  });

  // Nothing may tick while the world is being rewritten: a turn and an edit both
  // write the same store, and a turn landing mid-sync would fold against rows
  // the textarea no longer describes. So every ticker stops and every control
  // that could start one is disabled for as long as the editor is open.
  function setPlayControlsEnabled(on) {
    el("autoToggle").disabled = !on;
    el("stepBtn").disabled = !on || autoOn;
    el("playerCountSlider").disabled = !on;
    el("resetBtn").disabled = !on;
    for (const character of cast) {
      if (finished[character]) continue;
      el(paneIdFor(character) + "-play").disabled = !on;
      el(paneIdFor(character) + "-step").disabled = !on;
    }
  }

  async function enterEditMode() {
    editing = true;
    autoOn = false;
    const playBtn = el("autoToggle");
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.textContent = "\\u25B6 play";
    for (const character of cast) {
      const ticker = tickers[character];
      if (ticker) ticker.pause();
    }
    setPlayControlsEnabled(false);
    const snap = await session.snapshot();
    allStoreRows = snap.rows;
    editRows = worldOnlyRows(snap.rows);
    editState = window.tmct.page.foldWorldState(window.tmct.page.worldActionRows(editRows));
    el("editorText").value = renderMudEditorText(editRows, editState);
    el("editorStatus").className = "edit-status";
    el("editorStatus").textContent = "";
    el("editorPills").innerHTML = "";
    selectedRoomId = null;
    document.body.classList.add("editing");
    el("editModeBtn").textContent = "back to playing";
    el("editModeBtn").setAttribute("aria-pressed", "true");
    refreshEditPanels();
  }

  async function exitEditMode() {
    editing = false;
    clearTimeout(syncTimer);
    // One last sync on the way out, so a change typed in the final half-second
    // before the button is clicked reaches the world like every other one.
    await applyEditorText();
    document.body.classList.remove("editing");
    el("editModeBtn").textContent = "edit";
    el("editModeBtn").setAttribute("aria-pressed", "false");
    setPlayControlsEnabled(true);
    await renderAll();
  }

  // ---- the shared burrow: nodes, the wire, and the two-paste handshake -----
  // Every piece of networking arrives from ./vendor/p2p.js, the site's own
  // shared P2P asset, imported the first time somebody actually asks to share
  // rather than at boot. The room owns signaling, the mesh and the merge; this
  // block owns what a person sees and clicks, and nothing else.
  const P2P_ASSET = "./vendor/p2p.js";
  const NODE_NAME_KEY = "tmct.mud.nodeName";
  // Not the IndexedDB store beside it: that record is stamped with the site
  // version and the seed, and is dropped whenever either moves. A node id has
  // to outlive a deploy, because peers have already keyed this node's facts
  // on it.
  const NODE_ID_KEY = "tmct.mud.nodeId";
  const invite = inviteParamsFrom(window.location.search);

  let p2p = null;
  let p2pLoad = null;
  let room = null;
  let myPeerId = null;
  let myNodeId = "";
  let myDisplayName = "";
  let worldId = "";
  let worldName = "";
  let nodeClockTimer = null;
  let mintedBlob = "";
  let nodeWaveTimer = null;
  let channelCount = 0;

  // Which seat this page occupies in the handshake — "idle" until something
  // happens, "sponsor" once an invite is minted here, "joiner" once an invite
  // is opened here. The overlay's CSS reads it to decide which calls to
  // action stand at each step; entry distinguishes an invite that arrived as
  // a link (the hero card owns the reply) from one pasted in as text.
  function setOverlayRole(role, entry) {
    const overlay = el("netPanel");
    overlay.dataset.role = role;
    overlay.dataset.entry = entry || "";
  }

  function loadP2p() {
    if (!p2pLoad) {
      p2pLoad = import(P2P_ASSET).then(function (mod) { p2p = mod; return mod; });
      p2pLoad.catch(function (err) {
        noteTape("note", "fault", "networking unavailable", err && err.message ? err.message : String(err));
      });
    }
    return p2pLoad;
  }
  window.tmctP2pLoad = loadP2p;

  function readStoredNodeName() {
    try { return localStorage.getItem(NODE_NAME_KEY) || ""; } catch { return ""; }
  }
  function writeStoredNodeName(name) {
    try { localStorage.setItem(NODE_NAME_KEY, name); } catch { /* private mode — the name still holds for this visit */ }
  }

  async function ensureIdentity() {
    const mod = await loadP2p();
    if (!myPeerId) myPeerId = mod.generatePeerId();
    if (!myNodeId) {
      try { myNodeId = localStorage.getItem(NODE_ID_KEY) || ""; } catch { myNodeId = ""; }
      if (!myNodeId) {
        myNodeId = mod.generateNodeId();
        try { localStorage.setItem(NODE_ID_KEY, myNodeId); } catch { /* private mode — this visit still has an id, it just won't outlive the tab */ }
      }
    }
    if (!myDisplayName) {
      myDisplayName = readStoredNodeName() || mod.generateDisplayName();
      el("nodeNameInput").value = myDisplayName;
    }
    if (!worldId) worldId = invite && invite.world ? invite.world : mod.generateWorldId();
    if (!worldName) {
      worldName = invite && invite.worldName ? invite.worldName : mod.generateDisplayName();
      el("worldNameInput").value = worldName;
    }
  }

  // The one place a transport gets made, which makes it the one place every
  // message crossing one can be seen. The room asks for transports through
  // this factory and never learns it is being watched.
  function instrumentedTransport() {
    const transport = p2p.createTransport();
    const channel = "ch" + (++channelCount);
    transport.onMessage(function (message) { noteWire("in", message, channel); });
    transport.onOpen(function () { noteTape("note", "link", "channel open", channel); });
    transport.onClose(function () { noteTape("note", "link", "channel closed", channel); });
    return {
      createOffer: function () {
        return transport.createOffer().then(function (sdp) { noteTape("note", "signal", "offer minted", channel); return sdp; });
      },
      createAnswerFor: function (offerSdp) {
        return transport.createAnswerFor(offerSdp).then(function (sdp) { noteTape("note", "signal", "answer minted", channel); return sdp; });
      },
      completeWithAnswer: function (answerSdp) {
        noteTape("note", "signal", "answer accepted", channel);
        return transport.completeWithAnswer(answerSdp);
      },
      send: function (message) { transport.send(message); noteWire("out", message, channel); },
      onMessage: function (fn) { transport.onMessage(fn); },
      onOpen: function (fn) { transport.onOpen(fn); },
      onClose: function (fn) { transport.onClose(fn); },
      close: function () { transport.close(); },
      get connectionState() { return transport.connectionState; },
    };
  }

  async function ensureRoom() {
    if (room) return room;
    const mod = await loadP2p();
    await ensureIdentity();
    if (!session && bootRun) await bootRun;
    if (!session) throw new Error("the burrow hasn't finished opening");
    // The one place this page decides what is worth replicating: whatever the
    // engine calls live world state, plus the P2P layer's own four predicates.
    // The check is handed over rather than imported, so the sync filter never
    // learns the world engine's private predicate names.
    const extraPredicates = (window.tmct.page.P2P_PREDICATES || []).slice();
    const isState = window.tmct.page.isMudStatePredicate;
    room = mod.createP2pRoom({
      memoryDir: session.memoryDir,
      myPeerId: myPeerId,
      myDisplayName: myDisplayName,
      myNodeId: myNodeId,
      worldId: worldId,
      worldName: worldName,
      transportFactory: instrumentedTransport,
      syncableFacts: function (rows) { return mod.mudSyncableFacts(rows, isState, extraPredicates); },
    });
    room.onStateChanged(function (state) {
      noteTape("note", state === "failed" ? "fault" : "state", "state " + state, "");
      // The overlay exists to make one connection. The moment the channel is
      // open its work is done — the lights come back up, and the pill in the
      // header is the way back in.
      if (state === "connected") {
        el("joinCard").hidden = true;
        closeNetPanel();
        flashTip(el("statePill"), "connected \\u2014 you're digging together");
      }
      renderWire();
    });
    room.onPeersChanged(function () { renderNodes(); renderWire(); });
    room.onFactsChanged(function (payload) {
      noteTape("note", "facts", "merged", payload.merged + (payload.merged === 1 ? " fact" : " facts"));
      renderNodes();
      renderSoon();
    });
    await room.start();
    // The burrow's name is written into the graph the moment the room starts,
    // and this version retracts nothing — so the field stops taking edits.
    el("worldNameInput").readOnly = true;
    window.tmctP2pRoom = room;
    noteTape("note", "link", "world " + worldName, myDisplayName);
    await claimMyAnimals();
    renderWire();
    renderNodes();
    if (!nodeClockTimer) nodeClockTimer = setInterval(renderNodes, 10000);
    return room;
  }

  // Every animal this page drives is claimed the moment the burrow is shared,
  // panes and npcs alike: two peers each running scripted turns for one mole
  // would be two hands on one lemming. The claim is add-only and the oldest
  // wins, so a page that loses one simply stops driving that animal and
  // watches somebody else play it instead.
  async function claimMyAnimals() {
    if (!session || !room) return;
    await serializeTick(function () { return session.claimCharacters(everyone(), myPeerId); });
    await broadcastLocalChange();
    renderSoon();
  }

  // The room diffs the store against what it last saw and broadcasts whatever
  // changed. The page calls it after every local turn, wave, claim and edit —
  // a broadcast that fails is a dead channel, reported by its own close
  // handler, and must never fail the turn that happened to carry it.
  function broadcastLocalChange() {
    if (!room) return Promise.resolve({ broadcast: 0 });
    return room.afterLocalChange().catch(function () { return { broadcast: 0 }; });
  }

  function dropRoom(note) {
    if (!room) return;
    room.close();
    room = null;
    window.tmctP2pRoom = null;
    clearInterval(nodeClockTimer);
    nodeClockTimer = null;
    el("shareLink").value = "";
    el("replyOut").value = "";
    el("worldNameInput").readOnly = false;
    mintedBlob = "";
    setOverlayRole("idle", "");
    noteTape("note", "link", "world closed", worldName);
    renderWire();
    renderNodes();
    // Last, not first: renderWire restates the note for the state it has just
    // read, which for a room that is gone is the idle one ("this browser holds
    // the only copy"). WHY the room went is the thing worth saying, so it is
    // written over the top rather than under it.
    if (note) el("wireStateNote").textContent = note;
  }

  // ---- the wire tape: every message, as it happens ------------------------
  const TAPE_CAP = 240;
  const TAPE_FAMILY_COLOR = {
    facts: "var(--so-good)",
    state: "var(--so-accent)",
    greeting: "var(--so-warn)",
    signal: "var(--so-warn)",
    fault: "var(--so-alert)",
    link: "var(--so-muted)",
  };
  const tapeCounts = new Map();
  let wireMessageCount = 0;

  function pushTape(entry) {
    // The meter counts real wire messages only; the tape below shows those
    // plus the local notes (state changes, a channel opening) that explain
    // them. Folding notes into the counts would make "12 op" mean two things.
    if (entry.dir !== "note") {
      wireMessageCount += 1;
      tapeCounts.set(entry.type, (tapeCounts.get(entry.type) || 0) + 1);
    }
    const tapeEl = el("tape");
    el("tapeEmpty").hidden = true;
    const row = document.createElement("li");
    row.className = "tape-row";
    row.dataset.dir = entry.dir;
    row.dataset.family = entry.family;
    row.dataset.type = entry.type;
    const bar = document.createElement("i");
    bar.className = "tape-bar";
    const clock = document.createElement("span");
    clock.className = "tape-clock";
    clock.textContent = tapeClock();
    const type = document.createElement("span");
    type.className = "tape-type";
    type.textContent = entry.type;
    const detail = document.createElement("span");
    detail.className = "tape-detail";
    detail.textContent = entry.detail || "";
    row.appendChild(bar);
    row.appendChild(clock);
    row.appendChild(type);
    row.appendChild(detail);
    tapeEl.insertBefore(row, tapeEl.firstChild);
    while (tapeEl.childElementCount > TAPE_CAP) tapeEl.removeChild(tapeEl.lastElementChild);
    renderTapeMeter();
  }

  function noteWire(direction, message, channel) {
    const row = tapeRowFor(direction, message);
    pushTape({ dir: direction, family: row.family, type: row.type, detail: row.detail || channel });
  }
  function noteTape(dir, family, type, detail) {
    pushTape({ dir: dir, family: family, type: type, detail: detail });
  }

  function renderTapeMeter() {
    const tapeMeterEl = el("tapeMeter");
    el("tapeTotal").textContent = wireMessageCount + (wireMessageCount === 1 ? " message" : " messages");
    tapeMeterEl.textContent = "";
    const counted = [...tapeCounts.entries()].sort(function (a, b) { return b[1] - a[1]; });
    for (const pair of counted) {
      const item = document.createElement("span");
      item.className = "meter-item";
      item.dataset.type = pair[0];
      const bar = document.createElement("i");
      bar.className = "meter-bar";
      bar.style.background = TAPE_FAMILY_COLOR[tapeRowFor("in", { type: pair[0] }).family] || "var(--so-muted)";
      const label = document.createElement("span");
      label.textContent = pair[0];
      const count = document.createElement("span");
      count.className = "meter-n";
      count.textContent = String(pair[1]);
      item.appendChild(bar);
      item.appendChild(label);
      item.appendChild(count);
      tapeMeterEl.appendChild(item);
    }
  }

  // The state machine is shared with chat.html and the words mostly are too.
  // Two of them are not: nothing is taught here and nothing is a node below,
  // so those two notes are said in this page's own terms rather than forking
  // the whole table for a burrow.
  const MUD_WIRE_NOTES = {
    idle: "this browser holds the only copy of this burrow.",
    connected: "what you dig from here reaches every node in the burrow, and theirs reaches you.",
  };

  function renderWire() {
    const state = room ? room.state : "idle";
    const label = wireStateLabel(state);
    const note = MUD_WIRE_NOTES[state] || label.note;
    const wire = el("wireState");
    wire.dataset.tone = label.tone;
    el("wireStateWord").textContent = label.word;
    el("wireStateNote").textContent = note;
    const pill = el("statePill");
    pill.dataset.tone = label.tone;
    el("statePillWord").textContent = label.pill;
    pill.title = note;
    el("netPanel").dataset.tone = label.tone;
    renderSteps();
  }

  function renderSteps() {
    const states = shareStepStates({
      role: el("netPanel").dataset.role,
      state: room ? room.state : "idle",
      hasReply: Boolean(el("replyOut").value),
    });
    for (const step of states) {
      const item = el("step-" + step.key);
      if (item) item.dataset.status = step.status;
    }
  }

  // The scene's two browser cards: this one wears the node's own name, the
  // far one wears the first peer's the moment there is one to name.
  function renderScene() {
    el("sceneYouName").textContent = myDisplayName || "you";
    const peers = room ? room.peers() : [];
    const first = peers.find(function (p) { return p.connected; }) || peers[0];
    el("sceneThemName").textContent = first ? room.displayNameFor(first.peerId) : "your friend";
  }

  function relativeWhen(at, nowMs) {
    if (at === null || at === undefined) return "\\u2014";
    const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
    if (seconds < 5) return "now";
    if (seconds < 60) return seconds + "s";
    if (seconds < 3600) return Math.round(seconds / 60) + "m";
    if (seconds < 86400) return Math.round(seconds / 3600) + "h";
    return Math.round(seconds / 86400) + "d";
  }

  // A node is marked waving whether the wave came from one of its claimed
  // animals (a pane's own wave button) or from the node itself (the roster's
  // peer-scoped wave) — one hand, two ways to raise it.
  function wavingPeerTerms(nowMs) {
    const rows = room.factRows();
    const terms = new Set();
    for (const wave of activeWaves(rows, nowMs)) terms.add(wave.waver);
    for (const character of wavingCharacters(rows, nowMs)) {
      const owner = claimantOf(rows, character);
      if (owner !== null) terms.add(peerTerm(owner));
    }
    return terms;
  }

  function renderNodes() {
    const listEl = el("nodeList");
    if (!room || !p2p) {
      el("nodeCount").textContent = "";
      listEl.textContent = "";
      el("nodeEmpty").hidden = false;
      renderScene();
      return;
    }
    const rows = nodeRowsFor({
      peers: room.peers(),
      factRows: room.factRows(),
      myPeerId: myPeerId,
      myDisplayName: myDisplayName,
      nameFor: room.displayNameFor,
      latestTimestampOf: p2p.latestProvenanceTimestamp,
    });
    const nowMs = Date.now();
    const waving = wavingPeerTerms(nowMs);
    el("nodeCount").textContent = rows.length + (rows.length === 1 ? " node" : " nodes");
    listEl.textContent = "";
    for (const entry of rows) {
      const item = document.createElement("li");
      item.className = "node-row";
      item.dataset.self = String(entry.isSelf);
      item.dataset.away = String(!entry.connected);
      item.dataset.peer = entry.peerId;
      item.dataset.waving = String(waving.has(peerTerm(entry.peerId)));
      const avatar = document.createElement("span");
      avatar.className = "node-avatar";
      avatar.textContent = nodeInitials(entry.name);
      avatar.title = entry.connected
        ? "connected"
        : "away \\u2014 closed the tab or dropped offline; everything it dug stays";
      const dot = document.createElement("i");
      dot.className = "node-dot";
      avatar.appendChild(dot);
      const hand = document.createElement("span");
      hand.className = "node-hand";
      hand.textContent = "\\u{1F44B}";
      avatar.appendChild(hand);
      const name = document.createElement("span");
      name.className = "node-name";
      name.textContent = entry.name;
      const when = document.createElement("span");
      when.className = "node-when";
      when.textContent = relativeWhen(entry.lastActiveAt, nowMs);
      const fact = document.createElement("span");
      fact.className = "node-fact";
      if (entry.lastFact) {
        const line = entry.lastFact.subject + " " + String(entry.lastFact.predicate || "").replace(/^[a-z0-9_-]+:/i, "") + " " + entry.lastFact.object;
        fact.textContent = line;
        fact.title = "last shared: " + line;
      } else {
        fact.textContent = "nothing shared yet";
      }
      const waveOne = document.createElement("button");
      waveOne.type = "button";
      waveOne.className = "node-wave-btn";
      waveOne.textContent = "\\u{1F44B}";
      waveOne.title = entry.isSelf ? "wave at everyone" : "wave at " + entry.name + " \\u2014 they see it as a fact arriving";
      waveOne.setAttribute("aria-label", waveOne.title);
      waveOne.addEventListener("click", function () { waveAtNode(entry.isSelf ? null : entry.peerId, waveOne); });
      item.appendChild(avatar);
      item.appendChild(name);
      item.appendChild(when);
      item.appendChild(waveOne);
      item.appendChild(fact);
      listEl.appendChild(item);
    }
    el("nodeEmpty").hidden = rows.length > 1;
    renderScene();
    clearTimeout(nodeWaveTimer);
    if (waving.size) nodeWaveTimer = setTimeout(renderNodes, 1000);
  }

  // A node's own wave, distinct from an animal's: the fact's subject is the
  // peer, and its object names the audience — everyone, or one node.
  async function waveAtNode(targetPeerId, anchor) {
    try {
      const active = await ensureRoom();
      await active.wave("peer:" + myPeerId, targetPeerId ? "peer:" + targetPeerId : null);
      const audience = targetPeerId ? (active.displayNameFor(targetPeerId) || "one node") : "everyone";
      renderNodes();
      if (anchor) flashTip(anchor, "you waved at " + audience);
    } catch (err) {
      el("wireStateNote").textContent = "couldn't wave (" + (err && err.message ? err.message : err) + ").";
    }
  }

  const openNetPanel = function () {
    const overlay = el("netPanel");
    overlay.hidden = false;
    el("statePill").setAttribute("aria-expanded", "true");
    const card = overlay.querySelector(".so-card");
    if (card) card.focus({ preventScroll: true });
  };
  const closeNetPanel = function () {
    el("netPanel").hidden = true;
    el("statePill").setAttribute("aria-expanded", "false");
  };

  function renderInviteShare() {
    const facts = room ? room.factRows().length : 0;
    const factsPart = facts ? " \\u00b7 " + facts + (facts === 1 ? " fact travels" : " facts travel") + " when they join" : "";
    el("inviteSummary").textContent = "invites one person into \\u201c" + worldName + "\\u201d" + factsPart;
    const message = shareMessageFor({ worldName: worldName, link: el("shareLink").value, thing: "burrow" });
    el("waShareBtn").href = whatsAppShareUrl(message);
    el("webShareBtn").hidden = !navigator.share;
  }

  function renderReplyShare() {
    const message = replyMessageFor({ worldName: worldName, blob: el("replyOut").value });
    el("replyWaBtn").href = whatsAppShareUrl(message);
    el("joinWaBtn").href = whatsAppShareUrl(message);
    el("replyShareBtn").hidden = !navigator.share;
    el("joinShareBtn").hidden = !navigator.share;
  }

  async function mintInvite(anchor) {
    try {
      const active = await ensureRoom();
      const minted = await active.startSharing();
      mintedBlob = minted.blob;
      el("shareLink").value = inviteLinkFor(window.location.href, {
        blob: minted.blob, world: worldId, worldName: worldName,
      });
      setOverlayRole("sponsor", "");
      renderInviteShare();
      el("replyProblem").hidden = true;
      openNetPanel();
      renderWire();
      await copyText(el("shareLink").value);
      flashTip(anchor, "link copied \\u2014 send it to one person");
    } catch (err) {
      el("replyProblem").textContent = "couldn't create an invite (" + (err && err.message ? err.message : err) + ").";
      el("replyProblem").hidden = false;
      openNetPanel();
    }
  }

  function wireNetPanel() {
    el("netPanelClose").addEventListener("click", closeNetPanel);
    el("netPanel").addEventListener("click", function (e) {
      if (e.target === el("netPanel")) closeNetPanel();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el("netPanel").hidden) closeNetPanel();
    });
    el("statePill").addEventListener("click", function () {
      if (el("netPanel").hidden) openNetPanel(); else closeNetPanel();
    });
    if (isProbablyMobile()) el("netPanel").classList.add("so-mobile");
    // The blobs are made to be copied whole — a click selects everything, so
    // a manual copy can never take half a code.
    for (const boxId of ["shareLink", "replyOut", "joinReply"]) {
      el(boxId).addEventListener("focus", function (e) { e.target.select(); });
    }

    el("shareBtn").addEventListener("click", async function () {
      const shareBtn = el("shareBtn");
      shareBtn.disabled = true;
      try {
        await mintInvite(shareBtn);
      } finally {
        shareBtn.disabled = false;
      }
    });
    for (const mintId of ["mintInviteBtn", "remintBtn"]) {
      el(mintId).addEventListener("click", async function () {
        const btn = el(mintId);
        btn.disabled = true;
        try {
          await mintInvite(btn);
        } finally {
          btn.disabled = false;
        }
      });
    }

    el("copyLinkBtn").addEventListener("click", async function () {
      await copyText(el("shareLink").value);
      flashTip(el("copyLinkBtn"), "link copied \\u2014 send it to one person");
    });
    el("copyCodeBtn").addEventListener("click", async function () {
      await copyText(mintedBlob);
      flashTip(el("copyCodeBtn"), "code copied \\u2014 they paste it under step 3 on their page");
    });
    el("webShareBtn").addEventListener("click", function () {
      navigator.share({
        title: "join \\u201c" + worldName + "\\u201d",
        text: shareMessageFor({ worldName: worldName, link: el("shareLink").value, thing: "burrow" }),
      }).catch(function () { /* the sheet was closed — the copy buttons still stand */ });
    });
    const shareReplyViaSheet = function () {
      navigator.share({
        title: "my reply to \\u201c" + worldName + "\\u201d",
        text: replyMessageFor({ worldName: worldName, blob: el("replyOut").value }),
      }).catch(function () { /* the sheet was closed — the copy buttons still stand */ });
    };
    el("replyShareBtn").addEventListener("click", shareReplyViaSheet);
    el("joinShareBtn").addEventListener("click", shareReplyViaSheet);
    el("waveAllBtn").addEventListener("click", function () { waveAtNode(null, el("waveAllBtn")); });

    // The inviter's page has exactly one paste target, so there is no wrong box
    // to choose. A rejected paste keeps its text so the copy can be fixed.
    el("replyBtn").addEventListener("click", async function () {
      let active = room;
      if (!active) {
        try { active = await ensureRoom(); } catch { return; }
      }
      const outcome = await active.completeInvite(el("replyBox").value);
      if (outcome && outcome.error) {
        el("replyProblem").textContent = outcome.message;
        el("replyProblem").hidden = false;
        return;
      }
      el("replyProblem").hidden = true;
      el("replyBox").value = "";
      renderWire();
    });

    el("copyReplyBtn").addEventListener("click", async function () {
      await copyText(el("replyOut").value);
      flashTip(el("copyReplyBtn"), "reply copied \\u2014 send it back the same way");
    });

    // The link flow lands somebody on the join card before they have dug
    // anything. This is the other case: a burrow already open, an invite that
    // arrived in a message, and no reason to throw the burrow away to take it.
    el("joinOpenBtn").addEventListener("click", function () {
      openNetPanel();
      const box = el("inviteBox");
      if (box.offsetParent !== null) box.focus();
    });

    el("inviteBtn").addEventListener("click", async function () {
      const problem = el("inviteProblem");
      const pasted = el("inviteBox").value.trim();
      if (!pasted) {
        problem.textContent = "paste the invite you were sent, then try again";
        problem.hidden = false;
        return;
      }
      if (room) {
        problem.textContent = "this burrow is already shared. Reset it first, then take the invite.";
        problem.hidden = false;
        return;
      }
      // A whole link and a bare blob are both what people actually paste, so
      // both are read. The blob's own envelope decides either way.
      const blob = offerBlobIn(pasted);
      const mod = await loadP2p();
      const decoded = mod.decodeInviteBlob(blob);
      if (decoded.error || decoded.value.kind !== "offer") {
        problem.textContent = decoded.error
          ? "this invite looks cut short \\u2014 ask for it to be sent again"
          : "that's a reply, not an invite \\u2014 it belongs on the page that sent the invite";
        problem.hidden = false;
        return;
      }
      // The world id has to be the invite's before the room is opened: a room
      // that minted its own would refuse the invite as belonging elsewhere.
      await ensureIdentity();
      worldId = decoded.value.world || worldId;
      if (decoded.value.worldName) {
        worldName = decoded.value.worldName;
        el("worldNameInput").value = worldName;
      }
      try {
        const active = await ensureRoom();
        const outcome = await active.acceptInvite(blob);
        if (outcome && outcome.error) {
          problem.textContent = outcome.message;
          problem.hidden = false;
          return;
        }
        problem.hidden = true;
        el("inviteBox").value = "";
        el("replyOut").value = outcome.blob;
        setOverlayRole("joiner", "paste");
        renderReplyShare();
        renderWire();
        await copyText(outcome.blob);
        flashTip(el("copyReplyBtn"), "reply copied \\u2014 send it back the same way");
      } catch (err) {
        problem.textContent = "couldn't make a reply (" + (err && err.message ? err.message : err) + ").";
        problem.hidden = false;
      }
    });

    el("nodeNameInput").addEventListener("change", function () {
      const name = el("nodeNameInput").value.trim();
      if (!name || name === myDisplayName) { el("nodeNameInput").value = myDisplayName; return; }
      myDisplayName = name;
      writeStoredNodeName(name);
      if (!room) { renderNodes(); return; }
      room.setMyDisplayName(name).then(renderNodes).catch(function () { /* the next broadcast carries it */ });
    });
    el("worldNameInput").addEventListener("change", function () {
      const input = el("worldNameInput");
      if (input.readOnly) { input.value = worldName; return; }
      const name = input.value.trim();
      if (name) worldName = name;
      input.value = worldName;
    });

    el("joinBtn").addEventListener("click", async function () {
      const joinBtn = el("joinBtn");
      joinBtn.disabled = true;
      try {
        const active = await ensureRoom();
        const outcome = await active.acceptInvite(invite.offer);
        if (outcome && outcome.error) {
          el("joinProblem").textContent = outcome.message;
          el("joinProblem").hidden = false;
          joinBtn.disabled = false;
          joinBtn.textContent = "try again";
          return;
        }
        el("joinProblem").hidden = true;
        el("joinReply").value = outcome.blob;
        el("replyOut").value = outcome.blob;
        el("joinReplyWrap").hidden = false;
        joinBtn.textContent = "reply created";
        el("joinDismiss").textContent = "close this and start digging";
        renderReplyShare();
        renderWire();
        await copyText(outcome.blob);
        flashTip(el("joinCopyBtn"), "reply copied \\u2014 send it back the same way");
      } catch (err) {
        el("joinProblem").textContent = "couldn't make a reply (" + (err && err.message ? err.message : err) + ").";
        el("joinProblem").hidden = false;
        joinBtn.disabled = false;
      }
    });
    el("joinCopyBtn").addEventListener("click", async function () {
      await copyText(el("joinReply").value);
      flashTip(el("joinCopyBtn"), "reply copied \\u2014 send it back the same way");
    });
    el("joinDismiss").addEventListener("click", closeNetPanel);
  }

  // A link that lost part of itself on the way reads as a mangled link, never
  // as no invite at all.
  async function prepareJoinCard() {
    setOverlayRole("joiner", "link");
    el("joinCard").hidden = false;
    el("joinWorld").textContent = invite.worldName || "a shared burrow";
    renderSteps();
    openNetPanel();
    el("joinBtn").focus();
    const mod = await loadP2p();
    const decoded = mod.decodeInviteBlob(invite.offer);
    if (decoded.error || decoded.value.kind !== "offer") {
      el("joinBtn").hidden = true;
      el("joinEyebrow").textContent = "this link didn't arrive in one piece";
      el("joinWorld").textContent = invite.worldName || "an invitation";
      el("joinBody").textContent = decoded.error
        ? "Part of the link was lost on the way here. Ask for it to be sent again, and check the whole thing travels."
        : "That link carries a reply rather than an invite. It belongs in the box on the page that sent the invite.";
      el("joinDismiss").textContent = "dig on your own instead";
      return;
    }
    if (decoded.value.world) invite.world = decoded.value.world;
    if (decoded.value.worldName) {
      invite.worldName = decoded.value.worldName;
      el("joinWorld").textContent = decoded.value.worldName;
    }
  }

  // ---- the control deck ----------------------------------------------------
  // The players slider runs on detents (1, 2, 4), so its own value is the
  // index of the count, never the count.
  function chosenPlayerCount() {
    const picked = DATA.playerCounts[Number(el("playerCountSlider").value)];
    return picked || DATA.defaultPlayerCount;
  }

  function showPlayerCount(count) {
    el("playerCountValue").textContent = String(count);
    el("playerCountSlider").setAttribute("aria-valuetext", count + (count === 1 ? " player" : " players"));
  }

  // The npcs slider carries its own count, so it needs no detent table.
  function chosenNpcCount() {
    const picked = Number(el("npcCountSlider").value);
    return Number.isFinite(picked) ? picked : DATA.defaultNpcCount;
  }

  function showNpcCount(count) {
    el("npcCountValue").textContent = String(count);
    el("npcCountSlider").setAttribute("aria-valuetext", count + (count === 1 ? " npc" : " npcs"));
  }

  function wireDeck() {
    const playBtn = el("autoToggle");
    const stepBtn = el("stepBtn");
    const delaySlider = el("delaySlider");
    const maxTurnsSlider = el("maxTurnsSlider");
    const playerCountSlider = el("playerCountSlider");
    const npcCountSlider = el("npcCountSlider");
    playBtn.addEventListener("click", function () {
      if (!session) return;
      autoOn = !autoOn;
      playBtn.setAttribute("aria-pressed", autoOn ? "true" : "false");
      playBtn.textContent = autoOn ? "\\u23F8 pause" : "\\u25B6 play";
      stepBtn.disabled = autoOn;
      // Every animal in the world, pane or none: the deck's play control is the
      // world running, and an npc has no other control that could start it.
      for (const character of everyone()) {
        const ticker = tickers[character];
        if (!ticker) continue;
        if (autoOn) ticker.play(); else ticker.pause();
      }
    });
    // One whole turn: every animal in the world (pane or none, same "everyone"
    // the play toggle above drives) takes exactly one tick, so every pane's own
    // "turn N" reading is one higher once every stepOnce() below has settled.
    // Each character keeps its own independent tick count (mud has no single
    // shared "round" the way adventure/spider-fly's one-ticker world does), so
    // stepping the whole deck is stepping every one of those counters once,
    // not advancing one shared counter by one.
    stepBtn.addEventListener("click", function () {
      if (!session || autoOn) return;
      stepBtn.disabled = true;
      const steps = everyone().map(function (character) { return ensureTicker(character).stepOnce(); });
      Promise.all(steps).finally(function () { stepBtn.disabled = autoOn; });
    });
    delaySlider.addEventListener("input", function () {
      delayMs = Number(delaySlider.value);
      el("delayValue").textContent = delayMs + "ms";
    });
    maxTurnsSlider.addEventListener("input", function () {
      maxTurns = Number(maxTurnsSlider.value);
      el("maxTurnsValue").textContent = String(maxTurns);
    });
    // The readout follows the thumb, but a new cast waits for the drag to
    // settle: booting on every intermediate detent would open, and throw
    // away, a whole shared world per step.
    playerCountSlider.addEventListener("input", function () { showPlayerCount(chosenPlayerCount()); });
    playerCountSlider.addEventListener("change", function () { boot(); });
    npcCountSlider.addEventListener("input", function () { showNpcCount(chosenNpcCount()); });
    npcCountSlider.addEventListener("change", function () { boot(); });
    el("resetBtn").addEventListener("click", function () { boot(); });
    // Picking a burrow is a recast like any other, so it runs the same boot
    // the sliders and reset run. Edit mode follows the world rather than the
    // page: whatever is half-typed is flushed into the burrow it was typed
    // over, and the editor reopens on the one that just loaded.
    const scenarioSelect = el("scenarioSelect");
    if (scenarioSelect) {
      scenarioSelect.addEventListener("change", async function () {
        const picked = Number(scenarioSelect.value);
        if (!DATA.scenarios[picked] || picked === scenarioIndex) return;
        const wasEditing = editing;
        if (wasEditing) await exitEditMode();
        scenarioIndex = picked;
        await boot("a different burrow opened \\u2014 still linked.");
        if (wasEditing) await enterEditMode();
      });
    }
    el("editModeBtn").addEventListener("click", function () {
      if (!session) return;
      if (editing) exitEditMode(); else enterEditMode();
    });

    const infoBtn = el("deckInfoBtn");
    const infoPopup = el("deckInfoPopup");
    function openDeckInfo() {
      infoPopup.hidden = false;
      infoBtn.setAttribute("aria-expanded", "true");
    }
    function closeDeckInfo() {
      infoPopup.hidden = true;
      infoBtn.setAttribute("aria-expanded", "false");
    }
    infoBtn.addEventListener("click", function () { if (infoPopup.hidden) openDeckInfo(); else closeDeckInfo(); });
    el("deckInfoClose").addEventListener("click", closeDeckInfo);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !infoPopup.hidden) closeDeckInfo(); });
    document.addEventListener("click", function (e) {
      if (infoPopup.hidden) return;
      if (e.target === infoBtn || infoPopup.contains(e.target)) return;
      closeDeckInfo();
    });
  }

  // The stage is the cast's, so it is rebuilt for the cast: one paneMarkup
  // call per animal, the count on the stage itself for the grid to lay out
  // against, and a fresh set of listeners for the panes that just appeared.
  function renderStage() {
    const stage = el("mudStage");
    stage.setAttribute("data-panes", String(slots.length));
    stage.innerHTML = slots.map(function (slot) { return paneMarkup(slot); }).join("");
    for (const slot of slots) wirePane(slot);
  }

  function bindPanes() {
    for (let i = 0; i < slots.length; i += 1) {
      const w = "window-" + slots[i];
      const character = cast[i];
      const pane = el(w);
      pane.setAttribute("data-character", character);
      pane.setAttribute("aria-label", speciesOfCharacter(character) + "'s own view of the shared world");
      el(w + "-name").innerHTML = esc(speciesOfCharacter(character)) + '<span class="mono char-id">' + esc(character) + "</span>";
      el(w + "-chatq").setAttribute("aria-label", "type a command for " + character);
    }
  }

  // Booting builds the shared world and draws the opening state. It never
  // starts a turn: nothing ticks until the deck's own play control (or a
  // pane's) is clicked. Opening the world is asynchronous and the controls
  // that boot are not, so a boot overtaken by a later one drops its own
  // session on the floor rather than binding it to the stage the newer boot
  // has already drawn.
  let bootSeq = 0;
  let bootRun = null;
  function boot(note) {
    bootRun = openWorld(note);
    return bootRun;
  }

  async function openWorld(note) {
    const seq = bootSeq += 1;
    autoOn = false;
    // A live link survives a recast: once the new burrow's store is open the
    // room re-binds to it (below), pushing the fresh world to every connected
    // node instead of quietly abandoning them. The recast moves the world one
    // epoch forward, read from the store the peers have all converged on, so
    // nobody's leftover snapshots from the old run can outrank the new one.
    const liveRoom = room;
    let nextEpoch = 0;
    if (liveRoom && session) {
      try {
        nextEpoch = (await session.snapshot()).state.epoch + 1;
      } catch (err) {
        nextEpoch = 1;
      }
    }
    claimedElsewhere = {};
    wavingNow = [];
    const playBtn = el("autoToggle");
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.textContent = "\\u25B6 play";
    for (const character of Object.keys(tickers)) tickers[character].pause();
    tickers = {};
    globalTurn = 0;
    freshlyDugRoom = null;
    lastSnapshot = null;
    speechBubbles.clear();
    tickQueue = createSerialQueue();
    // Rebuilt rather than pruned: a character that had a pane last boot can be
    // an npc in this one, and a stale seat would send its ending to a pane now
    // showing somebody else.
    finished = {};
    turnsTaken = {};
    slotOf = {};

    // ONE draw, the engine's own, and the same list the session is built from:
    // a second independent draw here would leave the page showing animals the
    // shared world was never opened for. The stage follows the draw rather
    // than the slider, so a roster too small for the chosen count draws every
    // animal it has and no empty pane. The npcs draw from what the panes left,
    // out of a roster grown to hold everyone, so no animal is ever both.
    const npcCount = chosenNpcCount();
    // Read fresh, never cached at load: each burrow authors its own animals,
    // so the roster belongs to the scenario rather than to the page.
    roster = rosterOf(scenario());
    rootRoom = rootRoomOf(scenario());
    cast = window.tmct.page.pickMudRoster(roster, { count: chosenPlayerCount() });
    const pool = window.tmct.page.expandMudRoster(roster, cast.length + npcCount)
      .filter(function (id) { return cast.indexOf(id) === -1; });
    npcs = window.tmct.page.pickMudRoster(pool, { count: npcCount });
    slots = DATA.paneSlots.slice(0, cast.length);
    showPlayerCount(cast.length);
    showNpcCount(npcs.length);
    renderStage();
    // slotOf has to match cast from the same synchronous stretch that just
    // rebuilt the DOM for it \\u2014 a render triggered anywhere in the awaits
    // below (rebind's own re-sync can trigger one) must never see this
    // scenario's cast paired with the LAST scenario's pane ids, which is what
    // a null pane-element lookup in renderAll means when it happens.
    for (let i = 0; i < cast.length; i += 1) slotOf[cast[i]] = slots[i];
    const opened = await window.tmct.open(scenario().worldPayload, {
      characters: everyone(), epoch: nextEpoch,
      getTeachEnabled: function () { return el("teachToggle").checked; },
    });
    if (seq !== bootSeq) return;
    session = opened;
    if (liveRoom) {
      try {
        await liveRoom.rebind({ memoryDir: opened.memoryDir, worldName: worldName, myDisplayName: myDisplayName });
        renderWire();
        renderNodes();
        // After renderWire, the same way dropRoom writes its own reason: the
        // render restates the state's stock note, and WHY this recast kept
        // the link is the thing worth saying over it.
        el("wireStateNote").textContent = note || "the burrow recast \\u2014 still linked.";
        await claimMyAnimals();
      } catch (err) {
        dropRoom("the link didn't survive the recast \\u2014 share again to link up.");
      }
    }
    bindPanes();
    for (const character of cast) {
      const w = paneIdFor(character);
      el(w + "-play").disabled = false;
      el(w + "-step").disabled = false;
      el(w + "-chatq").disabled = false;
    }
    for (const character of everyone()) {
      turnsTaken[character] = 0;
      ensureTicker(character);
    }
    renderSoon();
  }

  wireDeck();
  wireNetPanel();
  renderWire();
  renderNodes();
  boot();
  // Off the boot path on purpose: this fetches the shared P2P asset so the
  // panel can show a real node name and burrow name before anyone clicks
  // anything. A failure here costs sharing, never the digging.
  ensureIdentity().then(renderNodes).catch(function () { /* sharing stays unavailable; the burrow does not */ });
  if (invite) {
    prepareJoinCard().catch(function (err) {
      el("joinProblem").textContent = "the networking asset didn't load (" + (err && err.message ? err.message : err) + ").";
      el("joinProblem").hidden = false;
      el("joinBtn").hidden = true;
    });
  }
})();`;
}
