// chat-page-viz.mjs — chat.html, the full-screen chat page: a self-contained
// document shaped exactly like spider-fly-viz.mjs/adventure-viz.mjs's own
// page-builders — one inlined <style> importing viz-theme.mjs's shared
// tokens, behaviour as an inlined IIFE — running the full chat engine
// (chat-browser.bundle.js's globalThis.tmctChat, chat-seed.json,
// public/reference-pack/) by same-origin relative paths. The same
// relationship spider-fly-viz.mjs's own inlined chat dock has with
// createSpiderFlySession: both call the shared session.turn(line), neither
// reimplements it.
//
// This page's own chrome: full-screen post-ChatGPT-style layout (centered
// message column, bottom-fixed composer,
// message bubbles) and this page's own signature element — a quiet
// per-message PROVENANCE CHIP (taught / corpus / entailed) next to every
// grounded answer, tmct's actual differentiator versus an LLM chatbot. The
// chip is read straight off the SAME "(source: ...)" citation chat.mjs's own
// factPhrase/renderFactLine convention already appends to most answers (see
// e.g. `dog is a kind of animal (source: corpus:conceptnet ...)` — already
// asserted by test-e2e/pages-chat-fullscreen.test.mjs against this page), never a
// second provenance computation against memory internals: `provBucketFor`
// (ledger-viz.mjs) is spliced in unmodified and applied to whatever citation
// text the answer already carries, so this page's chip and the ledger's own
// per-row color always agree by construction. A miss carries no citation and
// gets no chip — the absence IS the signal, matching the product's own
// honest-miss posture rather than inventing a fourth "trust tier" to badge it.
//
// renderChatHtml() is pure: no I/O, deterministic output for identical
// input. scripts/build-demo-site.mjs calls it directly and writes the result
// to public/chat.html, after chat-browser.bundle.js/chat-seed.json already
// exist (both built earlier in that same script, for the embedded widget).
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml } from "./viz-theme.mjs";
import { provBucketFor } from "./ledger-viz.mjs";
import { createTicker, prefersReducedMotion } from "./viz-ticker.mjs";
import { sessionLogTimeOfDay, sessionLogHeaderMarkdown, sessionLogTurnMarkdown } from "./session-log-format.mjs";
import { bandLabelFor, statsSummaryLine, clearSiteAssetCaches, fetchWithProgress, renderStatsPanelInto } from "./memory-panel-viz.mjs";

const DEFAULT_TITLE = "the-mechanical-code-talker — talk to it";

// Reads left-to-right as the reader meets each tier: what you taught it
// directly, what its bundled corpus already knew, what it worked out itself.
// Mirrors ledger-viz.mjs's own PROVS legend labels verbatim, so the same
// three words mean the same thing on both pages.
const PROV_LEGEND = [
  ["taught", "you taught"],
  ["corpus", "corpus"],
  ["entailed", "entailed"],
];

/** This page's own tiny CSS-class fold — ledger-viz.mjs's `--entail` CSS
 *  custom property (viz-theme.mjs's own token name) is one letter short of
 *  the "entailed" bucket provBucketFor returns; every other tier's token name
 *  already matches its bucket name exactly. */
function provKey(tier) {
  return tier === "entailed" ? "entail" : tier;
}

/**
 * The chip tier for one chat turn — "taught" | "corpus" | "entailed" | null
 * (no chip: a miss, or an answer that grounds in nothing citable, e.g. /help
 * output or a focus-set confirmation).
 *
 * Reads the SAME "(source: ...)" citation(s) the visible answer text already
 * carries, via `bucketFor` (the page's own spliced copy of ledger-viz.mjs's
 * `provBucketFor`, injected rather than imported so this function stays
 * `.toString()`-splice safe — the same discipline spider-fly-viz.mjs's own
 * `threadCellsForSpiderPlan` holds its own injected `geometry` to).
 * `provBucketFor`'s fallback branch (empty sourceTypes) classifies a raw
 * legacy provenance TAG string directly — exactly the string chat.mjs embeds
 * after "(source: " (memory/trust.mjs's `provenanceTagToSource` parses the
 * identical shape) — so no Fact/individuals lookup is needed here at all.
 *
 * A teach-lane confirmation ("noted — remembered: ...") cites no fact yet to
 * read back — nothing has been asked of it — so its own `record.via ===
 * "assert"` stands in for a citation: the user just taught this, "taught" is
 * the whole point of the reply.
 *
 * Multiple citations (a multi-step proof chain) resolve by the same
 * taught-over-entailed-over-corpus precedence provBucketFor's own header
 * documents for one fact's sourceTypes, applied across citations instead:
 * a chain resting on any taught premise reads as "taught" overall.
 *
 * Self-contained (no outer refs beyond the injected `bucketFor`),
 * `.toString()`-splice safe.
 */
export function provenanceChipFor(answer, record, bucketFor) {
  if (!record || record.miss) return null;
  const cites = [...String(answer || "").matchAll(/\(source: ([^)]+)\)/g)].map((m) => m[1]);
  if (!cites.length) return record.via === "assert" ? "taught" : null;
  const buckets = cites.map((c) => bucketFor([], c));
  if (buckets.includes("taught")) return "taught";
  if (buckets.includes("entailed")) return "entailed";
  return "corpus";
}

/**
 * One connection state as something a person can read: the headline word, the
 * sentence under it, and the tone the page styles it by.
 *
 * The tones matter as much as the words. `sharing` and `answering` are
 * open-ended BY DESIGN — until a blob is pasted nothing is in flight, so there
 * is no network activity to time out on, and they get the calm "waiting" tone
 * rather than error styling. `failed` is the opposite case: both blobs were
 * exchanged and ICE gave up, which is a real fault and reads as one.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function wireStateLabel(state) {
  switch (state) {
    case "sharing":
      return {
        tone: "waiting",
        pill: "waiting",
        word: "waiting for their reply",
        note: "nothing is in flight yet. this stays live as long as you leave the tab open.",
      };
    case "answering":
      return {
        tone: "waiting",
        pill: "reply sent",
        word: "send your reply back",
        note: "they connect the moment they paste it. leave this tab open.",
      };
    case "connecting":
      return {
        tone: "working",
        pill: "connecting",
        word: "connecting",
        note: "both halves are exchanged. this settles either way in a few seconds.",
      };
    case "connected":
      return {
        tone: "live",
        pill: "connected",
        word: "connected",
        note: "what you teach from here reaches every node below, and theirs reaches you.",
      };
    case "failed":
      return {
        tone: "failed",
        pill: "can't connect",
        word: "couldn't connect",
        note: "your two machines can't reach each other directly. this works on the same network, or between machines that can already see each other.",
      };
    default:
      return {
        tone: "idle",
        pill: "not shared",
        word: "not shared",
        note: "this browser holds the only copy of what you teach it.",
      };
  }
}

/**
 * One wire message as a row for the traffic tape: its type, which colour
 * family it belongs to, and the one number or name worth showing beside it.
 *
 * The families reuse the page's own provenance colours rather than inventing a
 * fourth palette — facts crossing the wire wear the same green as the "taught"
 * chip they will end up carrying, bulk state wears the corpus blue, and the
 * introductions that get two peers talking wear the entailed amber.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function tapeRowFor(direction, message) {
  const type = message && typeof message.type === "string" ? message.type : "unknown";
  const FAMILIES = {
    op: "facts",
    "sync-response": "facts",
    "sync-request": "state",
    hello: "greeting",
    "peer-list": "greeting",
    "intro-offer": "signal",
    "intro-answer": "signal",
  };
  const count = (list, one, many) => {
    const n = Array.isArray(list) ? list.length : 0;
    return n + " " + (n === 1 ? one : many);
  };
  let detail = "";
  if (type === "op" || type === "sync-response") detail = count(message.facts, "fact", "facts");
  else if (type === "peer-list") detail = count(message.peers, "node", "nodes");
  else if (type === "hello") detail = String(message.displayName || "");
  else if (type === "intro-offer" || type === "intro-answer") detail = String(message.to || "").slice(0, 8);
  return { type: type, direction: direction, detail: detail, family: FAMILIES[type] || "link" };
}

/**
 * The wire tape's own clock stamp for a message as it arrives —
 * `HH:MM:SS.mmm`, local time, zero-padded.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function tapeClock() {
  const at = new Date();
  const pad = (n, width) => String(n).padStart(width, "0");
  return pad(at.getHours(), 2) + ":" + pad(at.getMinutes(), 2) + ":" + pad(at.getSeconds(), 2) + "." + pad(at.getMilliseconds(), 3);
}

/**
 * The node list: every peer this graph knows about, each with the node name it
 * chose and the timestamp of the most recent fact it contributed, most
 * recently active first.
 *
 * Activity is read off the provenance the wire already carries. A fact a peer
 * broadcast arrives tagged `teach:peer:<their node name>@<ts>`, so the tag
 * names both who contributed it and when — no separate activity ledger to
 * keep. This node's own row reads its local `teach:`/`ace:` tags instead,
 * because a fact never leaves here relabelled in its own store.
 *
 * `nameFor` and `latestTimestampOf` are injected (the room's own
 * `displayNameFor` and the P2P layer's `latestProvenanceTimestamp`) rather
 * than imported, so this stays `.toString()`-splice safe — the same discipline
 * provenanceChipFor's injected `bucketFor` holds.
 */
export function nodeRowsFor({ peers, factRows, myPeerId, myDisplayName, nameFor, latestTimestampOf }) {
  const activeByName = new Map();
  let mineLastActive = null;
  for (const row of factRows || []) {
    for (const segment of String(row.provenance || "").split(" | ")) {
      if (!segment) continue;
      const at = latestTimestampOf(segment);
      if (at === null) continue;
      if (segment.indexOf("teach:peer:") === 0) {
        const marker = segment.lastIndexOf("@");
        if (marker < 0) continue;
        const name = segment.slice("teach:peer:".length, marker);
        const prior = activeByName.get(name);
        if (prior === undefined || at > prior) activeByName.set(name, at);
      } else if (segment.indexOf("teach:") === 0 || segment.indexOf("ace:") === 0) {
        if (mineLastActive === null || at > mineLastActive) mineLastActive = at;
      }
    }
  }
  const rows = [{
    peerId: myPeerId,
    name: myDisplayName,
    connected: true,
    isSelf: true,
    lastActiveAt: mineLastActive,
  }];
  for (const peer of peers || []) {
    const name = nameFor(peer.peerId);
    rows.push({
      peerId: peer.peerId,
      name: name,
      connected: Boolean(peer.connected),
      isSelf: false,
      lastActiveAt: activeByName.has(name) ? activeByName.get(name) : null,
    });
  }
  rows.sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
  return rows;
}

/**
 * A node's monogram: the first letter of each of the two words its name is
 * made of ("mossy-acorn" -> "ma"), falling back to the first two characters
 * of anything that isn't shaped that way. Never empty, so a row never draws
 * a blank circle.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function nodeInitials(name) {
  const words = String(name || "").split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toLowerCase();
  if (words.length === 1) return words[0].slice(0, 2).toLowerCase();
  return "??";
}

/**
 * How long ago a node's most recent fact landed, relative to `nowMs`: "now"
 * under 5s, otherwise the whole seconds/minutes/hours/days, coarsest unit
 * that still reads as one number. `at` null/undefined (a peer with no
 * activity yet) reads as an em dash rather than a bogus duration.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function relativeWhen(at, nowMs) {
  if (at === null || at === undefined) return "—";
  const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return seconds + "s";
  if (seconds < 3600) return Math.round(seconds / 60) + "m";
  if (seconds < 86400) return Math.round(seconds / 3600) + "h";
  return Math.round(seconds / 86400) + "d";
}

/**
 * The invite link: this page's own address carrying the offer blob, the world
 * id and the world's name. Any query or fragment the current address already
 * had is dropped, so inviting from a page that was itself opened from an
 * invite mints a clean link rather than stacking two offers.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function inviteLinkFor(pageUrl, { blob, world, worldName }) {
  const url = new URL(String(pageUrl));
  url.search = "";
  url.hash = "";
  url.searchParams.set("offer", blob);
  url.searchParams.set("world", world);
  if (worldName) url.searchParams.set("name", worldName);
  return url.toString();
}

/**
 * The invite an address carries, or null when it carries none. The world id
 * and name are read here only to show the joiner what they were invited to
 * before anything runs — the offer blob's own envelope is what actually
 * decides, and it wins wherever the two disagree.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe.
 */
export function inviteParamsFrom(search) {
  const params = new URLSearchParams(String(search || ""));
  const offer = params.get("offer");
  if (!offer) return null;
  return { offer: offer, world: params.get("world") || "", worldName: params.get("name") || "" };
}

/**
 * The boot statusline while the big assets stream in — "loading the engine…
 * X MB / Y MB", aggregated across every asset currently downloading. `parts`
 * is an array of { loaded, total } byte counts (total 0 when the response
 * carried no Content-Length); with no usable total the line shows loaded
 * bytes alone rather than inventing a denominator.
 *
 * Self-contained (no outer refs), `.toString()`-splice safe — the same
 * discipline provenanceChipFor above holds.
 */
export function loadProgressLine(parts) {
  const mb = (n) => (n / 1048576).toFixed(1);
  let loaded = 0;
  let total = 0;
  let totalKnown = true;
  for (const p of parts || []) {
    loaded += (p && p.loaded) || 0;
    if (p && p.total > 0) total += p.total;
    else totalKnown = false;
  }
  return totalKnown && total > 0
    ? "loading the engine… " + mb(loaded) + " MB / " + mb(total) + " MB"
    : "loading the engine… " + mb(loaded) + " MB";
}

/**
 * The "researched this session" panel's own reading of a settled research
 * turn's answer — the passage it read and where it read it, straight off
 * research.mjs's own `renderResearchAnswer` shape (`term — summary (source:
 * research article "title", Simple English Wikipedia, CC BY-SA 4.0 — url)`),
 * never a second fetch: the citation text is already the retrieved passage,
 * this just pulls its pieces apart for display. Returns null on anything
 * else (a miss, a status/stop reply, or text that doesn't open this way) —
 * an honest "nothing to show" rather than a guessed passage.
 *
 * Self-contained, `.toString()`-splice safe — the same discipline every
 * other pure export in this module holds.
 */
export function parseResearchAnswer(answer) {
  const text = String(answer || "");
  const m = /^(.*?) — ([\s\S]*?) \(source: research article "([^"]+)", Simple English Wikipedia, CC BY-SA 4\.0 — (\S+)\)/.exec(text);
  if (!m) return null;
  return { term: m[1], passage: m[2], title: m[3], url: m[4] };
}

/**
 * The exported transcript as ONE Markdown document, in the SAME shape the
 * Node CLI/TUI's own .tmct/session-<id>.md writes (session-log-format.mjs,
 * spliced in beside this function below): a title naming the version and a
 * short session id, one heading per turn at millisecond time-of-day
 * precision, the question as a verbatim blockquote, the answer in a fenced
 * block. No closing session-end line — unlike a CLI session's close(), an
 * export can happen mid-conversation, before anything has actually ended.
 *
 * Reads the page's transcript MODEL (an array alternating { role: "you" |
 * "tmct", text, chipTier, ts }, one entry per submit and per settled
 * reply), never the DOM — the message column may virtualize long chats
 * someday, and an export must still carry every turn.
 *
 * `headerMd`/`turnMd` are the injected session-log-format.mjs builders
 * (spliced in as their own consts alongside this function) — injected
 * rather than imported so this function stays `.toString()`-splice safe,
 * the same discipline provenanceChipFor's injected `bucketFor` holds.
 */
export function transcriptMarkdown(turns, meta, headerMd, turnMd) {
  const version = (meta && meta.version) || "dev";
  const sessionId = (meta && meta.sessionId) || "";
  const list = turns || [];
  let doc = headerMd({ version: version, sessionId: sessionId, startedAt: list.length ? list[0].ts : Date.now() });
  let turnNumber = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].role !== "you") continue;
    turnNumber += 1;
    const reply = list[i + 1] && list[i + 1].role === "tmct" ? list[i + 1] : null;
    doc += turnMd({ startedAt: list[i].ts, turnNumber: turnNumber, query: list[i].text, answer: reply ? reply.text : "" });
  }
  return doc;
}

/** The self-contained "talk to it" full-screen page. Pure — the same output
 *  for the same `title`/`digestStructures` every time; every other piece of
 *  state (the session, every message, every chip) is computed live in the
 *  browser once the sibling chat bundle loads, exactly as the embedded widget
 *  already works. `digestStructures` are the pre-parsed [[structure]] rows of
 *  the digest sentence-structure bank, embedded so a long answer can lead
 *  with a composed digest instead of the flat fact list — the same table
 *  research.html/ledger.html already embed, fed here to the chat bundle's own
 *  live digest-bank twin (see chat-browser-entry.mjs) rather than to a
 *  client-side digest panel of this page's own; an empty list degrades to the
 *  flat list exactly as before this page could digest at all. */
export function renderChatHtml({ title = DEFAULT_TITLE, digestStructures = [], seedStamp = "" } = {}) {
  const digestStructuresJson = JSON.stringify(Array.isArray(digestStructures) ? digestStructures : []);
  const legendHtml = PROV_LEGEND.map(
    ([key, label]) => `<span class="legend-item"><i class="dot dot-${provKey(key)}"></i>${escapeHtml(label)}</span>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<!--
  The wink lemma/POS tier loads from ./vendor/wink.js — the site's own shared
  first-party bundle of wink-nlp + wink-eng-lite-web-model (built by
  scripts/build-wink-vendor.mjs), one cached copy for every page, no CDN. The
  chat bundle itself never touches wink directly — wink-model.mjs's own header
  explains why a static import would drag the ~1 MB model into every bundle;
  only the page's own inline script imports the vendor asset, the same
  bounded-race tryLoadWink() pattern public/tmct-browser.mjs uses, and a
  failed load degrades to the curated + fuzzy tiers, never an error.
-->
<style>
${THEME_TOKENS_CSS}
  html, body { height: 100%; }
  /* body is the OUTER row: the chat column plus the stats panel docked to its
     right, each a sibling flex item stretching to the full viewport height
     (flex row's default cross-axis stretch) — .chatCol carries the column
     layout the chat chrome itself needs (topbar/main/composer/statusline
     stacked), so this page keeps working exactly as before, just inside one
     more layer. */
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; display: flex; overflow: hidden; }
  /* position: relative so the wave burst can anchor to the conversation
     column; main.chatMain scrolls, and a burst anchored inside it would
     scroll away mid-wave. */
  .chatCol { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; position: relative; }
  .mono { font-family: ${MONO_STACK}; }
  /* every display rule below would otherwise beat the hidden attribute, and a
     hidden-but-displayed overlay still swallows clicks meant for the page. */
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; border: none; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  a { color: var(--corpus); }

  /* brand, then the controls, then the legend pushed to the far right — the
     legend is passive and takes whatever room is left, so the controls never
     get folded onto a second line by a wide one. */
  .topbar { flex: 0 0 auto; display: flex; align-items: center; gap: 1rem; padding: .55rem 1.1rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .brand { display: flex; align-items: baseline; gap: .55rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .78rem; letter-spacing: .08em; color: var(--muted); }
  .legend { display: flex; gap: .8rem; margin-left: auto; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  .legend-item { display: inline-flex; align-items: center; gap: .32rem; white-space: nowrap; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .dot-taught { background: var(--taught); } .dot-corpus { background: var(--corpus); } .dot-entail { background: var(--entail); }

  main.chatMain { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; }
  /* box-sizing: border-box so min-height: 100% below counts the padding IN,
     not on top of it — without this, .messages renders ~45px taller than
     main.chatMain's own visible height (its 1.2rem/1.6rem vertical padding,
     added past a content-box min-height), so the initial scrollToEnd() (the
     very first thing boot() does, right after the boot system line lands)
     scrolls that overflow out of view and clips the boot message half under
     the topbar before anyone reads it. */
  .messages { box-sizing: border-box; max-width: 720px; margin: 0 auto; padding: 1.2rem 1rem 1.6rem; display: flex; flex-direction: column; gap: .15rem; min-height: 100%; }

  .msg-row { display: flex; flex-direction: column; margin: .35rem 0; max-width: 100%; }
  .msg-row.user { align-items: flex-end; }
  .msg-row.assistant { align-items: flex-start; }
  .msg-row.system { align-items: center; margin: .6rem 0; }

  .bubble { max-width: 80%; padding: .55rem .85rem; border-radius: 16px; white-space: pre-wrap; word-break: break-word; }
  .bubble.user { background: var(--ink); color: var(--bg); border-bottom-right-radius: 4px; }
  .bubble.user .prompt { opacity: .6; font-family: ${MONO_STACK}; font-size: .82em; }
  .bubble.assistant { background: var(--card); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
  .bubble.assistant.pending { color: var(--muted); font-style: italic; }
  .bubble.assistant.miss { color: var(--muted); border-style: dashed; }
  .bubble.system { max-width: 100%; background: none; border: none; color: var(--muted); font-family: ${MONO_STACK}; font-size: .76rem; text-align: center; padding: .2rem .5rem; }

  .provchip { align-self: flex-start; margin: .28rem 0 0 .15rem; font-family: ${MONO_STACK}; font-size: .64rem; letter-spacing: .05em; text-transform: uppercase; padding: .12rem .55rem; border-radius: 99px; cursor: default; }
  .pc-taught { color: var(--taught); background: var(--taught-soft); }
  .pc-corpus { color: var(--corpus); background: var(--corpus-soft); }
  .pc-entail { color: var(--entail); background: var(--entail-soft); }

  form.composer { flex: 0 0 auto; border-top: 1px solid var(--line); background: var(--bg); }
  .composer-inner { max-width: 720px; margin: 0 auto; padding: .7rem 1rem; display: flex; gap: .5rem; align-items: center; }
  .composer-inner input { flex: 1; min-width: 0; font-family: ${SERIF_STACK}; font-size: .95rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 20px; padding: .55rem 1rem; }
  .composer-inner input::placeholder { color: var(--muted); }
  .composer-inner input:disabled { opacity: .55; }
  .composer-inner button[type="submit"] { width: 2.3rem; height: 2.3rem; border-radius: 50%; background: var(--ink); color: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 1rem; flex: 0 0 auto; }
  .composer-inner button[type="submit"]:disabled { opacity: .4; cursor: default; }

  /* the wikipedia-mode row, under the input: a plain radio group (off / on a
     miss / always) plus the synthesis-budget slider, both in the
     statusline's own quiet mono idiom. "supplement" (typed /wiki supplement
     only) has no radio of its own — every radio clears when that mode is
     active, and the statusline names it instead. */
  .composer-wiki { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .4rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  fieldset.wikiMode { border: none; margin: 0; padding: 0; display: inline-flex; align-items: center; gap: .7rem; }
  fieldset.wikiMode legend { padding: 0; margin-right: .15rem; font: inherit; color: inherit; }
  fieldset.wikiMode label { display: inline-flex; align-items: center; gap: .28rem; cursor: pointer; white-space: nowrap; }
  fieldset.wikiMode input[type="radio"] { margin: 0; accent-color: var(--corpus); }
  .synthRow { display: inline-flex; align-items: center; gap: .5rem; white-space: nowrap; }
  .synthRow input[type="range"] { width: 88px; accent-color: var(--corpus); }

  /* the research row: type a topic, and the page asks "research <topic>"
     then ticks "research next" turns through the queue — play/pause rides
     the shared viz-ticker verbs. Same quiet mono idiom as the wiki row. */
  .composer-research { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .4rem; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  .composer-research label[for="researchTopic"] { white-space: nowrap; }
  .composer-research input[type="text"] { flex: 1 1 8rem; min-width: 6rem; font-family: ${MONO_STACK}; font-size: .72rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .28rem .55rem; }
  .composer-research input[type="text"]::placeholder { color: var(--muted); }
  .research-btn { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .03em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .16rem .55rem; background: var(--card); }
  .research-btn:hover { color: var(--ink); }
  .research-btn[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  #researchQueueStatus { white-space: nowrap; }

  .statusline { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .6rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }

  /* the composer's small utility row — right-aligned mono controls, for
     anything that acts on the conversation as a whole (export, print, reset)
     rather than on one turn. */
  .composer-tools { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .35rem; display: flex; justify-content: flex-end; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .tool-btn { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .03em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .16rem .55rem; background: var(--card); }
  .tool-btn:hover { color: var(--ink); }

  /* the provenance stats panel: what this session's memory holds, docked to
     the right of the chat column (a real layout column, not an overlay) —
     re-rendered after boot and after every turn from window.tmctChat's own
     memoryStats(), never a second provenance computation. */
  .statsPanel { flex: 0 0 300px; max-width: 300px; overflow-y: auto; border-left: 1px solid var(--line); padding: 1.1rem 1.2rem 1.6rem; font-family: ${MONO_STACK}; font-size: .74rem; line-height: 1.55; }
  .statsPanel h2 { font-size: .66rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 1.3rem 0 .5rem; }
  .statsPanel h2:first-child { margin-top: 0; }
  .statsPanel .band-row { display: flex; justify-content: space-between; gap: .6rem; margin: 0; padding: .12rem 0; }
  .statsPanel .band-count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .statsPanel .taught-item { margin: 0 0 .7rem; }
  .statsPanel .taught-tag { display: block; color: var(--muted); font-size: .66rem; margin-top: .15rem; word-break: break-word; }
  .statsPanel .empty { color: var(--muted); margin: 0; }
  .statsPanel .forget-btn { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .18rem .55rem; margin-top: 1.1rem; background: var(--card); }
  .statsPanel .forget-btn:hover { color: var(--ink); }
  .statsPanel .persist-note { color: var(--muted); font-size: .64rem; margin: .4rem 0 0; }

  /* the "researched this session" panel: its own section under the memory
     stats, filled from window.tmctChat.researchedFactRows() plus each
     settled research turn's own answer text — the passage tmct actually
     read, the article it read it from, and the facts that passage grounded.
     A sibling section, not folded into #statsPanelStats — that div's own
     re-render (renderStatsPanelInto) clears and rebuilds its children on
     every turn, which would wipe this section's own history too if it lived
     inside it. */
  #researchedPanel:not(:empty) { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--line); }
  .statsPanel .researched-item { margin: 0 0 .9rem; padding-bottom: .8rem; border-bottom: 1px dashed var(--line); }
  .statsPanel .researched-item:last-child { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }
  .statsPanel .researched-title { display: block; color: var(--ink); font-weight: 600; }
  .statsPanel .researched-passage { display: block; color: var(--muted); margin: .3rem 0; }
  .statsPanel .researched-link { display: inline-block; margin: 0 0 .3rem; }
  .statsPanel .researched-facts { margin: .3rem 0 0; padding-left: 1.1rem; }
  .statsPanel .researched-facts li { margin: .12rem 0; }
  .statsPanel .researched-none { color: var(--muted); font-style: italic; margin: .3rem 0 0; }

  /* ---- the page chrome's network controls -------------------------------
     The connection's state belongs in the chrome, not only in a rail that a
     narrow window hides: the pill, the wave, the invite and the help link stay
     reachable at every width. */
  /* The composer is already this page's most familiar-chat element — a pill
     input and a round send button. The chrome's controls take the same shape,
     so the page's networking reads as ordinary chat furniture rather than as
     an instrument bolted on. */
  /* the live fact count, in the topbar rather than the statusline: it is the
     one number that says what this session actually knows, and a small line of
     grey mono under the composer is where a wrong one goes unnoticed. Reads as
     a pill like its neighbours, with the number itself at reading size. */
  .fact-pill { display: inline-flex; align-items: baseline; gap: .34rem; font-family: ${MONO_STACK}; font-size: .68rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--corpus-t1); border-radius: 99px; padding: .2rem .8rem; background: var(--corpus-soft); white-space: nowrap; }
  .fact-pill .fact-pill-value { font-size: .96rem; letter-spacing: 0; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }

  .chrome { display: flex; align-items: center; gap: .4rem; }
  .chrome-btn { font-family: ${SERIF_STACK}; font-size: .8rem; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: .22rem .75rem; background: var(--card); text-decoration: none; display: inline-flex; align-items: center; gap: .32rem; white-space: nowrap; line-height: 1.35; }
  .chrome-btn:hover { color: var(--ink); border-color: var(--ink); }
  .chrome-btn.share { color: var(--ink); }
  .chrome-btn.help, .chrome-btn.icon { width: 1.7rem; height: 1.7rem; justify-content: center; padding: 0; }
  .chrome-btn .hand { font-size: .9rem; line-height: 1; }

  .state-pill { display: inline-flex; align-items: center; gap: .4rem; font-family: ${SERIF_STACK}; font-size: .8rem; line-height: 1.35; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: .22rem .78rem; background: var(--card); white-space: nowrap; }
  .state-pill .pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
  .state-pill[data-tone="waiting"] .pill-dot, .state-pill[data-tone="working"] .pill-dot { background: var(--corpus); animation: wire-breathe 2.4s ease-in-out infinite; }
  .state-pill[data-tone="working"] .pill-dot { animation-duration: .9s; }
  .state-pill[data-tone="live"] { color: var(--taught); border-color: var(--taught-t1); }
  .state-pill[data-tone="live"] .pill-dot { background: var(--taught); }
  .state-pill[data-tone="failed"] { color: var(--alert); border-color: var(--alert); }
  .state-pill[data-tone="failed"] .pill-dot { background: var(--alert); }

  /* ---- the network rail --------------------------------------------------
     The docks encode the two halves of a shared graph: the room on the left
     (who else holds this graph, and what is crossing the wire between you),
     the mind on the right (what it knows), the conversation between them.
     Mono throughout — the conversation is prose, the network is telemetry,
     and the register shift is the point. */
  .netPanel { flex: 0 0 288px; max-width: 288px; overflow-y: auto; border-right: 1px solid var(--line); padding: 1rem 1rem 1.6rem; font-family: ${MONO_STACK}; font-size: .72rem; line-height: 1.5; display: flex; flex-direction: column; gap: 1.15rem; }
  .net-block { display: flex; flex-direction: column; gap: .45rem; }
  .netPanel h2 { font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 0; display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
  .netPanel h2 .h2-count { letter-spacing: 0; text-transform: none; font-variant-numeric: tabular-nums; }
  .net-field { display: flex; flex-direction: column; gap: .2rem; }
  .net-label { font-family: ${SERIF_STACK}; font-size: .74rem; color: var(--muted); }
  .net-name-input { font-family: ${SERIF_STACK}; font-size: .86rem; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .32rem .6rem; width: 100%; box-sizing: border-box; }
  .net-name-input:read-only { background: none; border-color: transparent; padding-left: 0; color: var(--muted); }
  .net-note { font-family: ${SERIF_STACK}; font-size: .74rem; color: var(--muted); margin: 0; }
  .net-help { font-family: ${SERIF_STACK}; font-size: .74rem; color: var(--corpus); }
  .net-btn { font-family: ${SERIF_STACK}; font-size: .82rem; line-height: 1.35; color: var(--ink); border: 1px solid var(--line); border-radius: 99px; padding: .32rem .85rem; background: var(--card); align-self: flex-start; }
  .net-btn:hover { border-color: var(--ink); }
  .net-btn:disabled { opacity: .5; cursor: default; }
  .net-btn.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .net-btn.ghost { border-color: transparent; color: var(--muted); padding-left: 0; text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
  .net-btn.ghost:hover { color: var(--ink); text-decoration-color: var(--ink); }
  /* the blobs stay mono: they are machine text a person only ever copies, and
     a serif face on base64 is a lie about what it is. */
  .net-blob { width: 100%; box-sizing: border-box; font-family: ${MONO_STACK}; font-size: .58rem; line-height: 1.35; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: .4rem .5rem; resize: vertical; word-break: break-all; }
  .net-blob:focus { color: var(--ink); }
  .net-problem { margin: 0; font-family: ${SERIF_STACK}; font-size: .78rem; color: var(--alert); border-left: 2px solid var(--alert); padding-left: .5rem; }
  .net-invite { display: flex; flex-direction: column; gap: .4rem; padding-top: .2rem; }

  /* connection state, as a real visual state at every point: a calm slow
     breath while nothing is in flight, a quicker one while ICE runs, a solid
     green edge when the channel is open, and a static dashed red when it
     failed — a fault should not twitch. */
  .wire-state { position: relative; overflow: hidden; border: 1px solid var(--line); border-left-width: 3px; border-radius: 8px; padding: .55rem .7rem .6rem .75rem; background: var(--card); font-family: ${SERIF_STACK}; }
  .wire-state-word { display: block; font-size: .95rem; color: var(--ink); }
  .wire-state-note { display: block; margin-top: .25rem; font-size: .74rem; line-height: 1.4; color: var(--muted); }
  .wire-state[data-tone="waiting"], .wire-state[data-tone="working"] { border-left-color: var(--corpus); }
  .wire-state[data-tone="waiting"]::before, .wire-state[data-tone="working"]::before { content: ""; position: absolute; left: -3px; top: 0; bottom: 0; width: 3px; background: var(--corpus); animation: wire-breathe 2.4s ease-in-out infinite; }
  .wire-state[data-tone="working"]::before { animation-duration: .9s; }
  .wire-state[data-tone="live"] { border-left-color: var(--taught); background: var(--taught-soft); }
  .wire-state[data-tone="live"] .wire-state-word { color: var(--taught); }
  .wire-state[data-tone="failed"] { border-style: dashed; border-left-style: solid; border-left-color: var(--alert); background: var(--alert-soft); }
  .wire-state[data-tone="failed"] .wire-state-word { color: var(--alert); }
  @keyframes wire-breathe { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }

  /* a member list, the way every chat app already draws one: a monogram, a
     presence badge on it, the name, and when they were last heard from. The
     monogram is neutral on purpose — on this page colour means provenance,
     and an avatar palette would spend that meaning on decoration. */
  .node-list { list-style: none; margin: 0; padding: 0; }
  .node-row { display: flex; align-items: center; gap: .55rem; padding: .3rem 0; }
  .node-avatar { position: relative; flex: 0 0 auto; width: 1.6rem; height: 1.6rem; border-radius: 50%; background: var(--line); color: var(--muted); display: flex; align-items: center; justify-content: center; font-family: ${MONO_STACK}; font-size: .58rem; letter-spacing: .04em; text-transform: uppercase; }
  .node-row[data-self="true"] .node-avatar { background: var(--ink); color: var(--bg); }
  .node-dot { position: absolute; right: -1px; bottom: -1px; width: 7px; height: 7px; border-radius: 50%; background: var(--taught); box-shadow: 0 0 0 2px var(--bg); }
  .node-row[data-away="true"] .node-dot { background: var(--muted); }
  .node-name { font-family: ${SERIF_STACK}; color: var(--ink); font-size: .86rem; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .node-row[data-self="true"] .node-name::after { content: " (you)"; color: var(--muted); font-size: .74rem; }
  .node-row[data-away="true"] .node-name { color: var(--muted); }
  .node-when { color: var(--muted); font-family: ${MONO_STACK}; font-size: .62rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .node-hand { display: inline-block; font-size: .88rem; opacity: 0; transform-origin: 70% 80%; }
  .node-row[data-waving="true"] .node-hand { opacity: 1; animation: hand-wave .8s ease-in-out infinite; }
  .node-empty { font-family: ${SERIF_STACK}; color: var(--muted); font-size: .76rem; line-height: 1.4; margin: 0; }
  @keyframes hand-wave { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(20deg); } }

  /* the wire tape — this page's own instrument. Every message in and out, in
     arrival order, newest first so the latest is readable without scrolling.
     The 3px bar carries the message family in the page's own provenance
     colours; the type is spelled out beside it, so colour is never the only
     thing distinguishing one row from another. */
  .net-tape-block { flex: 1 1 auto; min-height: 0; }
  .tape-meter { display: flex; flex-wrap: wrap; gap: .15rem .7rem; margin: 0 0 .3rem; }
  .meter-item { display: inline-flex; align-items: center; gap: .3rem; font-size: .6rem; color: var(--muted); }
  .meter-bar { width: 5px; height: 5px; border-radius: 1px; flex: 0 0 auto; }
  .meter-n { color: var(--ink); font-variant-numeric: tabular-nums; }
  .tape { list-style: none; margin: 0; padding: 0; max-height: 20rem; overflow-y: auto; border-top: 1px solid var(--line); }
  .tape-row { display: grid; grid-template-columns: 3px auto minmax(0, 1fr) auto; align-items: center; gap: .4rem; padding: .18rem 0 .18rem .2rem; border-bottom: 1px dotted var(--line); font-size: .6rem; font-variant-numeric: tabular-nums; }
  .tape-row:first-child { animation: tape-arrive .6s ease-out; }
  .tape-bar { align-self: stretch; border-radius: 1px; background: var(--muted); }
  .tape-clock { color: var(--muted); }
  .tape-type { color: var(--ink); overflow-wrap: anywhere; }
  .tape-detail { color: var(--muted); text-align: right; white-space: nowrap; }
  .tape-row[data-dir="out"] .tape-type::before { content: "\\2192 "; color: var(--muted); }
  .tape-row[data-dir="in"] .tape-type::before { content: "\\2190 "; color: var(--muted); }
  .tape-row[data-dir="note"] .tape-type::before { content: "\\00b7 "; color: var(--muted); }
  .tape-row[data-family="facts"] .tape-bar { background: var(--taught); }
  .tape-row[data-family="state"] .tape-bar { background: var(--corpus); }
  .tape-row[data-family="greeting"] .tape-bar { background: var(--entail); }
  .tape-row[data-family="signal"] .tape-bar { background: var(--entail-t1); }
  .tape-row[data-family="fault"] .tape-bar { background: var(--alert); }
  .tape-row[data-family="fault"] .tape-type { color: var(--alert); }
  .tape-empty { font-family: ${SERIF_STACK}; color: var(--muted); font-size: .76rem; line-height: 1.4; padding: .45rem 0 0; margin: 0; }
  @keyframes tape-arrive { from { background: var(--corpus-soft); } to { background: transparent; } }

  .netPanel-close { display: none; align-self: flex-end; font-family: ${MONO_STACK}; font-size: .8rem; color: var(--muted); padding: 0 .2rem; }

  /* the join card: the only thing a joiner sees until they act. The world's
     generated two-word name is the one place it gets to be a headline. */
  .joinCard { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; padding: 1.2rem; }
  .joinCard-inner { background: var(--card); border: 1px solid var(--line); border-radius: 8px; width: 100%; max-width: 27rem; padding: 1.5rem 1.6rem 1.3rem; box-shadow: 0 18px 48px rgba(0, 0, 0, .3); display: flex; flex-direction: column; gap: .8rem; }
  .joinCard-eyebrow { font-size: .82rem; color: var(--muted); margin: 0; }
  .joinCard-world { font-size: 1.75rem; line-height: 1.1; margin: -.45rem 0 0; color: var(--ink); font-weight: 600; overflow-wrap: anywhere; }
  .joinCard-body { font-size: .9rem; color: var(--muted); margin: 0; max-width: 36ch; }
  .joinCard .net-btn.primary { font-size: .95rem; padding: .5rem 1.15rem; }
  .joinCard-reply { display: flex; flex-direction: column; gap: .45rem; }

  /* a wave, on every page it reaches: the waver's node name, over the
     conversation, for as long as the wave is recent. Anchored under the
     topbar, where a chat app puts a presence toast — the foot of the column
     belongs to the composer, and a burst there lands behind it. */
  .waveBurst { position: absolute; left: 50%; top: 3.4rem; transform: translateX(-50%); z-index: 20; display: flex; flex-direction: column; align-items: center; gap: .3rem; pointer-events: none; }
  .wave-pill { display: flex; align-items: center; gap: .45rem; background: var(--card); border: 1px solid var(--line); border-radius: 99px; padding: .3rem .9rem .3rem .7rem; font-family: ${SERIF_STACK}; font-size: .85rem; color: var(--ink); box-shadow: 0 4px 14px rgba(0, 0, 0, .16); animation: wave-rise .3s ease-out; }
  .wave-pill .hand { display: inline-block; font-size: 1rem; transform-origin: 70% 80%; animation: hand-wave .8s ease-in-out infinite; }
  @keyframes wave-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  .copyTip { position: fixed; z-index: 60; background: var(--ink); color: var(--bg); font-family: ${SERIF_STACK}; font-size: .78rem; padding: .3rem .7rem; border-radius: 99px; pointer-events: none; box-shadow: 0 3px 10px rgba(0, 0, 0, .22); animation: wave-rise .14s ease-out; }

  @media (max-width: 1080px) {
    /* the rail becomes a drawer rather than disappearing: the invite flow has
       to stay reachable on a laptop and a phone alike. */
    .netPanel { position: fixed; left: 0; top: 0; bottom: 0; width: 288px; max-width: 86vw; flex: none; z-index: 30; background: var(--bg); transform: translateX(-101%); transition: transform .18s ease-out; }
    body.net-open .netPanel { transform: none; box-shadow: 0 0 40px rgba(0, 0, 0, .3); }
    .netPanel-close { display: block; }
  }
  @media (max-width: 1360px) {
    /* the legend is decorative and the controls are not, so the legend goes
       first rather than folding the controls onto a second row. */
    .legend { display: none; }
  }
  @media (max-width: 860px) {
    .statsPanel { display: none; }
  }
  @media (max-width: 560px) {
    .bubble { max-width: 92%; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { scroll-behavior: auto !important; }
    .wire-state[data-tone="waiting"]::before, .wire-state[data-tone="working"]::before,
    .state-pill .pill-dot, .tape-row:first-child, .netPanel { animation: none; transition: none; }
    .wave-pill, .wave-pill .hand, .node-row[data-waving="true"] .node-hand, .copyTip { animation: none; }
  }

  /* print: the WHOLE transcript, not the scrolled-into-view slice — the
     screen layout pins the message column to the viewport and scrolls inside
     it, which would clip everything off-screen to one printed page. Undo the
     pinning (heights auto, overflow visible, flex back to block flow) and
     drop the interactive chrome; the bubbles and their provenance chips
     print as-is. */
  @media print {
    html, body { height: auto; overflow: visible; }
    body { display: block; }
    .chatCol { display: block; }
    main.chatMain { overflow: visible; height: auto; }
    .messages { min-height: 0; }
    form.composer, .statusline, .statsPanel, .legend { display: none; }
    .netPanel, .joinCard, .waveBurst, .chrome, .copyTip { display: none; }
  }
</style>
</head>
<body>
  <aside class="netPanel" id="netPanel" aria-label="the shared world: this node, its connection, the other nodes, and the wire">
    <button type="button" class="netPanel-close" id="netPanelClose" aria-label="close the network panel">&times;</button>
    <section class="net-block">
      <h2>this node</h2>
      <div class="net-field">
        <label class="net-label" for="nodeNameInput">your node name</label>
        <input class="net-name-input" id="nodeNameInput" type="text" autocomplete="off" spellcheck="false"
          placeholder="two words from the graph's own vocabulary">
      </div>
      <div class="net-field">
        <label class="net-label" for="worldNameInput">the graph you are sharing</label>
        <input class="net-name-input" id="worldNameInput" type="text" autocomplete="off" spellcheck="false"
          placeholder="named when you first invite someone">
      </div>
      <p class="net-note">both names are facts in the graph, not settings. change yours whenever you like.</p>
    </section>

    <section class="net-block">
      <h2>connection</h2>
      <div class="wire-state" id="wireState" data-tone="idle" role="status">
        <span class="wire-state-word" id="wireStateWord">not shared</span>
        <span class="wire-state-note" id="wireStateNote">this browser holds the only copy of what you teach it.</span>
      </div>
      <div class="net-invite" id="sharePanel" hidden>
        <div class="net-field">
          <label class="net-label" for="shareLink">the link, in case the copy didn&#8217;t take</label>
          <textarea class="net-blob" id="shareLink" rows="2" readonly></textarea>
        </div>
        <p class="net-note">each link invites one person. invite again for the next.</p>
        <div class="net-field">
          <label class="net-label" for="replyBox">paste their reply here</label>
          <textarea class="net-blob" id="replyBox" rows="3" placeholder="the reply they send back"></textarea>
        </div>
        <button type="button" class="net-btn" id="replyBtn">connect</button>
        <p class="net-problem" id="replyProblem" role="alert" hidden></p>
      </div>
      <div class="net-invite" id="answerPanel" hidden>
        <div class="net-field">
          <label class="net-label" for="replyOut">your reply &#8212; send it back the same way the invite reached you</label>
          <textarea class="net-blob" id="replyOut" rows="3" readonly></textarea>
        </div>
        <button type="button" class="net-btn" id="copyReplyBtn">copy it again</button>
      </div>
      <a class="net-help" href="./help.html#sharing" target="_blank" rel="noopener">how sharing works &#8599;</a>
    </section>

    <section class="net-block">
      <h2>nodes <span class="h2-count" id="nodeCount"></span></h2>
      <ul class="node-list" id="nodeList"></ul>
      <p class="node-empty" id="nodeEmpty">nobody else yet. invite someone and their node appears here.</p>
    </section>

    <section class="net-block net-tape-block">
      <h2>wire <span class="h2-count" id="tapeTotal"></span></h2>
      <div class="tape-meter" id="tapeMeter"></div>
      <ol class="tape" id="tape"></ol>
      <p class="tape-empty" id="tapeEmpty">every message this browser sends or receives lands here, as it happens.</p>
    </section>
  </aside>
  <div class="chatCol">
    <header class="topbar">
      <div class="brand">
        <span class="eyebrow">the-mechanical-code-talker</span>
      </div>
      <div class="chrome">
        <span class="fact-pill" id="factPill" aria-live="polite"
          title="every fact this session's memory holds right now — the starter memory it shipped with plus anything you have taught, researched or ingested">
          <span class="fact-pill-value" id="factPillValue">&mdash;</span> facts
        </span>
        <button type="button" class="state-pill" id="statePill" data-tone="idle"
          title="the shared-world connection; click to open the network panel">
          <i class="pill-dot"></i><span id="statePillWord">not shared</span>
        </button>
        <button type="button" class="chrome-btn icon" id="waveBtn"
          title="wave to everyone connected to this graph" aria-label="wave to everyone connected to this graph">
          <span class="hand">&#128075;</span>
        </button>
        <button type="button" class="chrome-btn share" id="shareBtn" title="copy a link that invites one person into this graph">
          invite
        </button>
        <a class="chrome-btn help" href="./help.html#chat" target="_blank" rel="noopener"
          title="how this page works, in a new tab" aria-label="help, opens in a new tab">?</a>
      </div>
      <div class="legend" aria-hidden="true">${legendHtml}</div>
    </header>
    <div class="waveBurst" id="waveBurst" aria-live="polite"></div>
    <main class="chatMain">
      <div class="messages" id="messages" role="log" aria-live="polite" aria-label="Conversation"></div>
    </main>
    <form class="composer" id="composer">
      <div class="composer-inner">
        <input id="composerInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="loading the engine…" aria-label="Ask tmct something" disabled>
        <button type="submit" id="composerSend" aria-label="Send" disabled>&#8594;</button>
      </div>
      <div class="composer-wiki">
        <fieldset class="wikiMode" id="wikiMode" title="Off by default. &quot;when I don't know&quot;: a question nothing local can answer also asks en.wikipedia.org — two small requests per lookup, cited (CC BY-SA). &quot;always&quot;: every grounded answer also gets a cited Wikipedia read-out. Type /wiki supplement for that same read-out on grounded answers only, without switching this to always.">
          <legend>ask wikipedia</legend>
          <label><input type="radio" name="wikiMode" id="wikiOff" value="off" checked> off</label>
          <label><input type="radio" name="wikiMode" id="wikiMiss" value="miss"> when I don&#8217;t know</label>
          <label><input type="radio" name="wikiMode" id="wikiAlways" value="always"> always</label>
        </fieldset>
        <label class="synthRow" for="synthSlider" title="How many facts to work out and store, entailed, after each Wikipedia-sourced load. 0 stores the article's own stated facts only, with no entailment pass.">
          synthesize from wikipedia: <span id="synthValue" class="mono">12</span>
          <input type="range" id="synthSlider" min="0" max="24" step="4" value="12">
        </label>
      </div>
      <div class="composer-research">
        <label for="researchTopic" title="Fetches the topic from Simple English Wikipedia and stores the facts it grounds, then queues the topics its lead section links to. Asking is the network consent for these fetches; each queued topic is asked as its own chat turn, paced politely.">research:</label>
        <input id="researchTopic" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="a topic, e.g. owls" aria-label="Topic to research on Simple English Wikipedia">
        <button type="button" id="researchGo" class="research-btn">go</button>
        <button type="button" id="researchPlay" class="research-btn" aria-pressed="false" hidden>play</button>
        <span id="researchQueueStatus" aria-live="polite"></span>
      </div>
      <div class="composer-tools">
        <button type="button" id="ingestFile" class="tool-btn" title="load a .txt/.md file and teach every fact it recognizes into this session">ingest file</button>
        <input type="file" id="ingestInput" accept=".txt,.md,text/plain,text/markdown" hidden>
        <button type="button" id="exportMd" class="tool-btn" title="download this conversation as Markdown">export .md</button>
        <button type="button" id="exportFacts" class="tool-btn" title="download this session's facts as JSONL (the tmct extract shape, provenance included)">export facts</button>
        <button type="button" id="printChat" class="tool-btn" title="print the whole conversation">print</button>
        <button type="button" id="reinitStore" class="tool-btn" title="drop everything saved on this device and reload from the shipped seed">reset to seed</button>
      </div>
    </form>
    <div class="statusline" id="status">loading the engine&hellip;</div>
  </div>
  <aside class="statsPanel" id="statsPanel" aria-label="This session's memory and research">
    <div id="statsPanelStats"><p class="empty">loading memory stats&hellip;</p></div>
    <div id="researchedPanel"></div>
  </aside>
  <div class="joinCard" id="joinCard" role="dialog" aria-labelledby="joinWorld" hidden>
    <div class="joinCard-inner">
      <p class="joinCard-eyebrow" id="joinEyebrow">you&#8217;ve been invited to</p>
      <h1 class="joinCard-world" id="joinWorld"></h1>
      <p class="joinCard-body" id="joinBody">Nothing has run yet. The button below makes your reply and copies it &#8212; send it back the same way this invite reached you, and leave this tab open.</p>
      <button type="button" class="net-btn primary" id="joinBtn">create my reply</button>
      <p class="net-problem" id="joinProblem" role="alert" hidden></p>
      <div class="joinCard-reply" id="joinReplyWrap" hidden>
        <label class="net-label" for="joinReply">your reply, copied &#8212; send it back now</label>
        <textarea class="net-blob" id="joinReply" rows="3" readonly></textarea>
        <button type="button" class="net-btn" id="joinCopyBtn">copy it again</button>
      </div>
      <button type="button" class="net-btn ghost" id="joinDismiss">start talking on your own instead</button>
      <a class="net-help" href="./help.html#sharing" target="_blank" rel="noopener">how sharing works &#8599;</a>
    </div>
  </div>
<script src="./chat-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const provBucketFor = ${provBucketFor.toString()};
  const provenanceChipFor = ${provenanceChipFor.toString()};
  const loadProgressLine = ${loadProgressLine.toString()};
  const parseResearchAnswer = ${parseResearchAnswer.toString()};
  const sessionLogTimeOfDay = ${sessionLogTimeOfDay.toString()};
  const sessionLogHeaderMarkdown = ${sessionLogHeaderMarkdown.toString()};
  const sessionLogTurnMarkdown = ${sessionLogTurnMarkdown.toString()};
  const transcriptMarkdown = ${transcriptMarkdown.toString()};
  const bandLabelFor = ${bandLabelFor.toString()};
  const statsSummaryLine = ${statsSummaryLine.toString()};
  const clearSiteAssetCaches = ${clearSiteAssetCaches.toString()};
  const fetchWithProgress = ${fetchWithProgress.toString()};
  const renderStatsPanelInto = ${renderStatsPanelInto.toString()};
  const createTicker = ${createTicker.toString()};
  const prefersReducedMotion = ${prefersReducedMotion.toString()};
  const wireStateLabel = ${wireStateLabel.toString()};
  const tapeRowFor = ${tapeRowFor.toString()};
  const nodeRowsFor = ${nodeRowsFor.toString()};
  const nodeInitials = ${nodeInitials.toString()};
  const inviteLinkFor = ${inviteLinkFor.toString()};
  const inviteParamsFrom = ${inviteParamsFrom.toString()};
  const tapeClock = ${tapeClock.toString()};
  const relativeWhen = ${relativeWhen.toString()};
  const DIGEST_STRUCTURES = ${digestStructuresJson};
  const el = (id) => document.getElementById(id);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});

  const messagesEl = el("messages");
  const composerForm = el("composer");
  const inputEl = el("composerInput");
  const sendBtn = el("composerSend");
  const statusEl = el("status");
  const factPillValueEl = el("factPillValue");
  const statsPanelEl = el("statsPanelStats");
  const researchedPanelEl = el("researchedPanel");
  const wikiModeFieldset = el("wikiMode");
  const wikiModeRadios = Array.prototype.slice.call(wikiModeFieldset.querySelectorAll('input[type="radio"]'));
  const synthSliderEl = el("synthSlider");
  const synthValueEl = el("synthValue");

  // The wikipedia mode: "off" | "miss" (the radio's own value for what the
  // session calls plain true, a rescue on a clean miss) | "always". "supplement"
  // (typed /wiki supplement only) never lands here — a turn that sets it
  // clears every radio instead, read back off the session's own getter.
  // try/caught throughout — private-mode storage that throws must never
  // break the page, it just forgets the preference between visits.
  const WIKI_MODE_KEY = "tmct.chat.wikiMode";
  const LEGACY_LIVE_PREF_KEY = "tmct.chat.liveWikipedia";
  function readWikiMode() {
    try {
      const stored = localStorage.getItem(WIKI_MODE_KEY);
      if (stored === "off" || stored === "miss" || stored === "always") return stored;
      if (localStorage.getItem(LEGACY_LIVE_PREF_KEY) === "on") return "miss";
    } catch { /* private mode — starts at the default this visit */ }
    return "off";
  }
  function writeWikiMode(mode) {
    try {
      localStorage.setItem(WIKI_MODE_KEY, mode);
      localStorage.removeItem(LEGACY_LIVE_PREF_KEY);
    } catch { /* private mode — the choice still works this visit */ }
  }
  const liveReferenceForMode = (mode) => (mode === "always" ? "always" : mode === "miss");
  function setWikiModeRadios(mode) {
    for (const radio of wikiModeRadios) radio.checked = radio.value === mode;
  }
  function checkedWikiMode() {
    const checked = wikiModeRadios.find((r) => r.checked);
    return checked ? checked.value : "off";
  }

  // The synthesis budget: how many facts an auto-synthesis pass may add,
  // entailed, after each Wikipedia-sourced load. 0 disables it.
  const SYNTH_BUDGET_KEY = "tmct.chat.synthBudget";
  function readSynthBudget() {
    try {
      const n = Number(localStorage.getItem(SYNTH_BUDGET_KEY));
      if (Number.isFinite(n) && n >= 0 && n <= 24) return n;
    } catch { /* private mode — starts at the default this visit */ }
    return 12;
  }
  function writeSynthBudget(n) {
    try { localStorage.setItem(SYNTH_BUDGET_KEY, String(n)); } catch { /* private mode — this visit still works */ }
  }

  function scrollToEnd() {
    messagesEl.parentElement.scrollTop = messagesEl.parentElement.scrollHeight;
  }

  function addSystemLine(text) {
    const row = document.createElement("div");
    row.className = "msg-row system";
    const bubble = document.createElement("div");
    bubble.className = "bubble system";
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToEnd();
  }

  function addUserBubble(text) {
    const row = document.createElement("div");
    row.className = "msg-row user";
    const bubble = document.createElement("div");
    bubble.className = "bubble user";
    const prompt = document.createElement("span");
    prompt.className = "prompt";
    prompt.textContent = "tmct> ";
    bubble.appendChild(prompt);
    bubble.appendChild(document.createTextNode(text));
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToEnd();
    return row;
  }

  function addPendingAssistantBubble() {
    const row = document.createElement("div");
    row.className = "msg-row assistant";
    const bubble = document.createElement("div");
    bubble.className = "bubble assistant pending";
    bubble.textContent = "thinking\\u2026";
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToEnd();
    return row;
  }

  const CHIP_TITLE = {
    taught: "you taught tmct this fact directly",
    corpus: "grounded in tmct's bundled corpus",
    entailed: "tmct derived this from taught facts, not read back verbatim",
  };

  // The transcript MODEL — one entry per user submit and per settled
  // assistant bubble (misses included), appended in display order. Export
  // and print read this, never the DOM: the message column stays free to
  // virtualize long chats without silently truncating an export.
  const transcript = [];

  function settleAssistantBubble(row, answer, record) {
    const bubble = row.querySelector(".bubble");
    bubble.classList.remove("pending");
    const missed = !record || Boolean(record.miss);
    bubble.classList.toggle("miss", missed);
    bubble.textContent = answer;
    const tier = provenanceChipFor(answer, record, provBucketFor);
    transcript.push({ role: "tmct", text: answer, chipTier: tier, ts: Date.now() });
    if (tier) {
      const key = tier === "entailed" ? "entail" : tier;
      const chip = document.createElement("span");
      chip.className = "provchip pc-" + key;
      chip.title = CHIP_TITLE[tier] || "";
      chip.textContent = tier;
      row.appendChild(chip);
    }
    scrollToEnd();
  }

  // ---- engine boot -------------------------------------------------------
  // The same bounded-race wink load public/tmct-browser.mjs uses, against
  // this page's own bundle/seed/pack — plus real download progress: the two
  // big boot assets (the seed and the wink vendor bundle) stream through
  // fetchWithProgress, and the statusline aggregates their byte counts until
  // boot settles it back to the normal summary.
  const WINK_LOAD_TIMEOUT_MS = 8000;

  const progressParts = {};
  let progressActive = true;
  function noteProgress(key, loaded, total) {
    progressParts[key] = { loaded: loaded, total: total };
    if (progressActive) statusEl.textContent = loadProgressLine(Object.values(progressParts));
  }

  let winkStatus = "pending";
  async function tryLoadWink() {
    // The bounded race guards the same failure the CDN era did — a load that
    // neither resolves nor rejects — but measures 8s WITHOUT A BYTE rather
    // than 8s wall-clock, so a slow link streaming real progress on a 3.5 MB
    // asset is never abandoned mid-download.
    let lastProgressAt = Date.now();
    const winkProgress = (loaded, total) => {
      lastProgressAt = Date.now();
      noteProgress("wink", loaded, total);
    };
    const stallGuard = async () => {
      for (;;) {
        const idle = Date.now() - lastProgressAt;
        if (idle >= WINK_LOAD_TIMEOUT_MS) throw new Error("wink vendor asset load stalled");
        await new Promise((resolve) => setTimeout(resolve, WINK_LOAD_TIMEOUT_MS - idle));
      }
    };
    try {
      const mod = await Promise.race([
        (async () => {
          try {
            // Streamed fetch -> Blob -> import, so the biggest asset on the
            // page reports its progress; the vendor bundle is fully
            // self-contained, so a blob URL resolves nothing further.
            const blob = await fetchWithProgress("./vendor/wink.js", winkProgress);
            const blobUrl = URL.createObjectURL(new Blob([blob], { type: "text/javascript" }));
            try {
              return await import(blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          } catch (err) {
            return import("./vendor/wink.js");
          }
        })(),
        stallGuard(),
      ]);
      window.tmctChat.registerWinkModel(() => ({ winkNLP: mod.winkNLP, model: mod.model }));
      winkStatus = "loaded";
    } catch (err) {
      winkStatus = "unavailable";
      console.warn("tmct chat: the wink vendor asset failed to load, continuing without the lemma/POS tier", err);
    }
  }

  // The deploy's own version, read off the service worker file the build
  // already stamps (its cache name embeds package.json's version) — the only
  // same-origin place the number exists at runtime without a second build
  // artifact. Best-effort: no worker file, no match, no network -> "dev".
  async function fetchSiteVersion() {
    try {
      const res = await fetch("./tmct-sw.js");
      if (!res.ok) return "dev";
      const found = /tmct-precache-v(\\d+\\.\\d+\\.\\d+)/.exec(await res.text());
      return found ? found[1] : "dev";
    } catch {
      return "dev";
    }
  }

  // The build's own content hash for the seed. It rides in the URL this page
  // fetches the seed by, so the service worker's cache-first read can only
  // ever return the copy this page asked for. Empty in a build that had no
  // seed to hash (the desktop shell's own render).
  const SEED_STAMP = ${JSON.stringify(seedStamp)};
  const SEED_QUERY = SEED_STAMP ? "?b=" + SEED_STAMP : "";

  let seedPayload = null;
  let seedFacts = 0;
  async function fetchSeed() {
    try {
      const blob = await fetchWithProgress("./chat-seed.json" + SEED_QUERY, (loaded, total) => noteProgress("seed", loaded, total));
      seedPayload = JSON.parse(await blob.text());
      seedFacts = (seedPayload.individuals || []).filter((i) => i.class === "Fact").length;
    } catch (err) {
      seedPayload = null;
      console.warn("tmct chat: chat-seed.json unavailable — starting unseeded", err);
    }
  }
  const cloneSeed = () => {
    if (!seedPayload) return null;
    try { return structuredClone(seedPayload); } catch { return JSON.parse(JSON.stringify(seedPayload)); }
  };
  function newSession() {
    return window.tmctChat.createChatSession({
      seedPayload: cloneSeed(),
      vocabSeeded: Boolean(seedPayload),
      liveReference: liveReferenceForMode(checkedWikiMode()),
      synthesisBudget: readSynthBudget(),
      onLiveLookup: function () { statusEl.textContent = "searching wikipedia\\u2026"; },
      digestStructures: DIGEST_STRUCTURES,
    });
  }

  let packIndexPromise = null;
  function fetchPackIndex() {
    if (!packIndexPromise) {
      packIndexPromise = fetch("./reference-pack/index.json")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }
    return packIndexPromise;
  }
  const fetchPackProvider = {
    async lookup(normTerm) {
      const index = await fetchPackIndex();
      const id = index && index.terms ? index.terms[String(normTerm || "")] : null;
      if (!id) return null;
      try {
        const res = await fetch("./reference-pack/articles/" + id + ".json");
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
  };

  // ---- persistence: what you taught it survives a reload, on this device -
  // Best-effort IndexedDB (window.tmctChat.openPersistedStore): the whole
  // Backend-B payload snapshots after each teach turn, debounced so a burst
  // of teaching costs one multi-MB write, not one per fact. The stamp ties a
  // snapshot to this deploy (site version) AND this seed (its fact count and
  // content hash) — any of them changing discards the snapshot in favour of
  // the fresh seed.
  let persist = null;
  let saveTimer = null;
  let restoredCount = 0;
  let siteVersion = "dev";
  window.tmctChatLastSave = null;

  function scheduleSave() {
    if (!persist) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const session = window.tmctChatSession;
      if (!session) return;
      const started = performance.now();
      let snapshot;
      try {
        snapshot = structuredClone(session.memoryDir.payload);
      } catch {
        try { snapshot = JSON.parse(JSON.stringify(session.memoryDir.payload)); } catch { return; }
      }
      persist.save(snapshot).then((saved) => {
        if (saved) window.tmctChatLastSave = { at: Date.now(), ms: Math.round(performance.now() - started) };
      });
    }, 500);
  }

  async function forgetEverything() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (persist) await persist.clear();
    restoredCount = 0;
    // The room holds the OLD session's store, so it can't outlive the swap —
    // it would keep merging peers' facts into a store nothing reads any more.
    // Rejoining is a fresh invite, which is what a dropped node needs anyway.
    dropRoom();
    window.tmctChatSession = newSession();
    const stats = await window.tmctChat.memoryStats(window.tmctChatSession.memoryDir);
    addSystemLine("forgot everything taught on this device \\u2014 back to the fresh seed (" + statsSummaryLine(stats, bandLabelFor) + ").");
    await renderStatsPanel(stats);
  }

  // ---- memory stats: the boot message's own numbers, and the docked panel -
  // Both read window.tmctChat.memoryStats(memoryDir) (chat-browser-entry.mjs)
  // — one computation, reused, so the boot line and the panel can never
  // disagree with each other about what this session's memory holds.
  // bandLabelFor/statsSummaryLine/renderStatsPanelInto are the shared
  // memory-panel-viz.mjs helpers, spliced in above.

  /** (Re)render the docked panel from a memoryStats() result — stats may be
   *  passed in already-computed (boot reuses its own call rather than asking
   *  twice); omitted, it fetches fresh. Best-effort: a session not ready yet,
   *  or a read that throws, leaves the panel showing whatever it last showed
   *  rather than blanking it. */
  async function renderStatsPanel(stats) {
    if (!stats) {
      if (!window.tmctChatSession || !window.tmctChat.memoryStats) return;
      try { stats = await window.tmctChat.memoryStats(window.tmctChatSession.memoryDir); }
      catch { return; }
    }
    factPillValueEl.textContent = Number(stats.total || 0).toLocaleString();
    renderStatsPanelInto(statsPanelEl, stats, {
      bandLabel: bandLabelFor,
      onForget: persist ? forgetEverything : null,
      persistNote: "taught facts are kept best-effort on this device (IndexedDB), never sent anywhere.",
    });
  }

  // ---- researched this session: what "research <topic>" has actually read
  // and grounded so far — each entry pairs the passage a settled research
  // turn's own answer cites (parseResearchAnswer, off the SAME "(source:
  // research article ...)" text the chat bubble already shows) with the real
  // facts that turn stored, read back through window.tmctChat.
  // researchedFactRows(memoryDir) rather than re-deriving them from the
  // answer text — the citation names WHERE tmct read, the fact rows name
  // WHAT it kept, and this panel never invents either from the other.
  const researchedEntries = [];
  const researchedFactKeysSeen = new Set();

  function renderResearchedPanel() {
    researchedPanelEl.textContent = "";
    researchedPanelEl.appendChild(Object.assign(document.createElement("h2"), { textContent: "researched this session" }));
    if (!researchedEntries.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = 'nothing yet — ask it to "research <a topic>" and what it reads, with the passage and the facts it grounded, lands here.';
      researchedPanelEl.appendChild(empty);
      return;
    }
    for (const entry of researchedEntries.slice(-8).reverse()) {
      const item = document.createElement("div");
      item.className = "researched-item";
      const title = document.createElement("span");
      title.className = "researched-title";
      title.textContent = entry.title || "(untitled)";
      item.appendChild(title);
      if (entry.passage) {
        const passage = document.createElement("span");
        passage.className = "researched-passage";
        passage.textContent = entry.passage;
        item.appendChild(passage);
      }
      if (entry.url) {
        const link = document.createElement("a");
        link.className = "researched-link";
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "source \\u2197";
        item.appendChild(link);
      }
      if (entry.facts.length) {
        const list = document.createElement("ul");
        list.className = "researched-facts";
        for (const fact of entry.facts) {
          const li = document.createElement("li");
          li.textContent = fact.subject + " " + fact.predicate + " " + fact.object;
          list.appendChild(li);
        }
        item.appendChild(list);
      } else {
        const none = document.createElement("p");
        none.className = "researched-none";
        none.textContent = "no new fact grounded from this passage.";
        item.appendChild(none);
      }
      researchedPanelEl.appendChild(item);
    }
  }

  /** After a settled, non-miss research turn: read back the facts that turn
   *  actually stored (a set-diff against every research fact seen so far, so
   *  a later step never re-lists an earlier one's facts) and pair them with
   *  this turn's own cited passage. A turn that grounded nothing new (an
   *  empty article, or a re-fetch of an already-known one) still gets its
   *  own entry — the passage was still read, even where nothing new stuck. */
  async function noteResearchLearned(result) {
    if (result.research === undefined || !result.record || result.record.miss) return;
    if (!window.tmctChat.researchedFactRows || !window.tmctChatSession) return;
    let rows;
    try { rows = await window.tmctChat.researchedFactRows(window.tmctChatSession.memoryDir); }
    catch { return; }
    const newFacts = [];
    for (const row of rows) {
      const key = row.subject + "|" + row.predicate + "|" + row.object;
      if (researchedFactKeysSeen.has(key)) continue;
      researchedFactKeysSeen.add(key);
      newFacts.push(row);
    }
    const parsed = parseResearchAnswer(result.answer);
    if (!parsed && !newFacts.length) return;
    researchedEntries.push({
      title: parsed ? parsed.title : "",
      passage: parsed ? parsed.passage : "",
      url: parsed ? parsed.url : "",
      facts: newFacts,
    });
    renderResearchedPanel();
  }

  // "supplement" (typed /wiki supplement only) has no radio; the statusline
  // still names it, read straight off the session's own liveReference getter
  // rather than the last radio the page itself set.
  function liveStatusWord(liveReference) {
    return liveReference === "always" ? "always" : liveReference === "supplement" ? "supplement" : liveReference ? "on" : "off";
  }

  function renderStatus() {
    const seedPart = seedPayload
      ? "starter memory: " + seedFacts + " facts"
      : "starter memory unavailable — starting empty";
    const winkPart = winkStatus === "loaded"
      ? "wink-nlp lemma/POS tier: loaded"
      : winkStatus === "unavailable"
        ? "wink-nlp unavailable — curated + fuzzy tiers only (still zero guesses, zero LLM)"
        : "wink-nlp: loading\\u2026";
    const liveReference = window.tmctChatSession ? window.tmctChatSession.liveReference : liveReferenceForMode(checkedWikiMode());
    const livePart = "live wikipedia: " + liveStatusWord(liveReference);
    const netPart = room
      ? " \\u00b7 world \\u201c" + worldName + "\\u201d: " + wireStateLabel(room.state).word
      : "";
    statusEl.textContent = seedPart + " \\u00b7 " + winkPart + " \\u00b7 " + livePart + netPart;
  }

  // A "/wiki on|off|supplement|always" turn flips the session's own state;
  // this mirrors it back into the radio group and the stored preference.
  // "supplement" clears every radio (it has none of its own) rather than
  // leaving a stale mode checked.
  function mirrorWikiModeFromSession() {
    const session = window.tmctChatSession;
    if (!session || typeof session.liveReference === "undefined") return;
    const liveReference = session.liveReference;
    const mode = liveReference === "always" ? "always" : liveReference === true ? "miss" : liveReference === false ? "off" : null;
    setWikiModeRadios(mode || "");
    if (mode) writeWikiMode(mode);
  }

  wikiModeFieldset.addEventListener("change", function () {
    const mode = checkedWikiMode();
    writeWikiMode(mode);
    if (window.tmctChatSession && window.tmctChatSession.setLiveReference) {
      window.tmctChatSession.setLiveReference(liveReferenceForMode(mode));
    }
    renderStatus();
  });

  synthSliderEl.addEventListener("input", function () {
    const n = Number(synthSliderEl.value);
    synthValueEl.textContent = String(n);
    writeSynthBudget(n);
    if (window.tmctChatSession && window.tmctChatSession.setSynthesisBudget) {
      window.tmctChatSession.setSynthesisBudget(n);
    }
  });

  let busy = true;
  function setBusy(v) {
    busy = v;
    const ready = Boolean(window.tmctChatSession);
    inputEl.disabled = v || !ready;
    sendBtn.disabled = v || !ready;
  }

  // ONE dispatched turn through the page — the composer form and the
  // research ticker both submit here, so an auto-played "research next"
  // renders exactly like a typed one: user bubble, transcript entry, pending
  // bubble, settle, persist, stats. Resolves once the turn has settled (the
  // ticker awaits it before pacing the next step).
  async function submitLine(q) {
    if (!q || busy || !window.tmctChatSession) return null;
    addUserBubble(q);
    transcript.push({ role: "you", text: q, chipTier: null, ts: Date.now() });
    const pendingRow = addPendingAssistantBubble();
    setBusy(true);
    let result = null;
    try {
      result = await window.tmctChatSession.turn(q);
      settleAssistantBubble(pendingRow, result.answer, result.record);
      // Persist on ANY store write, not just a teach turn: a learn-on-miss
      // load (a child pack, a reference or live-Wikipedia article, a
      // research step) and its auto-synthesis also append facts, and those
      // were lost on reload when only via==="assert" saved. Commands write
      // nothing, so they stay out. The save is debounced, so a read-through
      // that changed nothing costs at most one coalesced write.
      if (result.record && result.record.via !== "command") {
        scheduleSave();
        // Whatever this turn wrote goes out to every connected node. The room
        // diffs the store itself, so a turn that stored nothing costs nothing.
        if (room) room.afterLocalChange().catch(function () { /* a dead channel reports itself through its own close */ });
      }
      await renderStatsPanel(); // a teach or learned-load turn grew this session's memory; a plain ask leaves it unchanged either way
      await noteResearchLearned(result);
    } catch (err) {
      settleAssistantBubble(pendingRow,
        "something went wrong answering that (" + (err && err.message ? err.message : err) + ") \\u2014 try rephrasing",
        { miss: true });
    } finally {
      // A "/wiki on|off|supplement|always" turn flips the session's own
      // state — mirror it back into the radio group and the stored
      // preference, then settle the statusline (which the onLiveLookup
      // hook may have overwritten with "searching wikipedia…" mid-turn).
      mirrorWikiModeFromSession();
      renderStatus();
      setBusy(false);
    }
    if (result) noteResearchResult(result);
    return result;
  }

  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = inputEl.value.trim();
    if (!q || busy || !window.tmctChatSession) return;
    inputEl.value = "";
    const lowered = q.toLowerCase();
    if (lowered === "wave" || lowered === "/wave") {
      addUserBubble(q);
      transcript.push({ role: "you", text: q, chipTier: null, ts: Date.now() });
      addSystemLine("you waved — everyone connected to this graph sees it.");
      waveNow();
      inputEl.focus();
      return;
    }
    submitLine(q).then(() => inputEl.focus());
  });

  // ---- the research queue: play/pause over "research next" turns ----------
  // The engine owns the queue (each turn's result.research is its snapshot);
  // this page only decides WHEN the next step is asked, through the shared
  // viz-ticker verbs, paced no faster than the adapter's own polite interval.
  const researchTopicEl = el("researchTopic");
  const researchGoBtn = el("researchGo");
  const researchPlayBtn = el("researchPlay");
  const researchQueueStatusEl = el("researchQueueStatus");
  const RESEARCH_TICK_MS = 2400;
  let researchQueue = null; // the engine's latest snapshot, null when no run stands

  const researchTicker = createTicker({
    onTick: async () => { await submitLine("research next"); },
    hasNext: () => Boolean(researchQueue && !researchQueue.complete),
    onRender: renderResearchControls,
    waitMs: RESEARCH_TICK_MS,
  });

  function renderResearchControls(tickState) {
    const state = tickState || researchTicker.getState();
    researchPlayBtn.hidden = !(researchQueue && !researchQueue.complete);
    researchPlayBtn.textContent = state.playing ? "pause" : "play";
    researchPlayBtn.setAttribute("aria-pressed", String(state.playing));
    if (!researchQueue) {
      researchQueueStatusEl.textContent = "";
    } else if (researchQueue.complete) {
      researchQueueStatusEl.textContent = 'research "' + researchQueue.topic + '" complete \\u2014 '
        + researchQueue.done.length + " topic" + (researchQueue.done.length === 1 ? "" : "s") + " grounded";
    } else {
      researchQueueStatusEl.textContent = 'research "' + researchQueue.topic + '": '
        + researchQueue.done.length + " done \\u00b7 " + researchQueue.pending.length + " queued";
    }
  }

  /** Fold one settled turn's research field into the controls. A snapshot
   *  (re)arms them; null (a run that ended) clears them; undefined (not a
   *  research turn) leaves them alone. A FRESH run with topics queued starts
   *  auto-play, unless the visitor asked for reduced motion — the play
   *  button is the same control either way. */
  function noteResearchResult(result) {
    if (result.research === undefined) return;
    const previous = researchQueue;
    researchQueue = result.research;
    const freshRun = Boolean(researchQueue && !researchQueue.complete && (!previous || previous.complete || previous.topic !== researchQueue.topic));
    renderResearchControls();
    if (freshRun && !prefersReducedMotion() && !researchTicker.getState().playing) researchTicker.play();
  }

  researchGoBtn.addEventListener("click", () => {
    const topic = researchTopicEl.value.trim();
    if (!topic || busy || !window.tmctChatSession) return;
    researchTopicEl.value = "";
    submitLine("research " + topic);
  });
  researchTopicEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); researchGoBtn.click(); }
  });
  researchPlayBtn.addEventListener("click", () => {
    // pause() directly, not play()'s own toggle: play() declines while a
    // step is mid-animation, and a pause pressed exactly then must not be
    // dropped — the in-flight step still settles, then the loop stops.
    if (researchTicker.getState().playing) researchTicker.pause();
    else researchTicker.play();
  });

  // ---- export + print: whole-conversation controls ------------------------
  // Both read the transcript model; neither touches the network. The export
  // downloads as a Blob (no server round-trip), and print relies on the
  // @media print stylesheet above to un-pin the message column so every
  // turn reaches paper.
  el("exportMd").addEventListener("click", () => {
    const sessionId = (window.tmctChatSession && window.tmctChatSession.sessionId) || "";
    const md = transcriptMarkdown(transcript, { version: siteVersion, sessionId: sessionId }, sessionLogHeaderMarkdown, sessionLogTurnMarkdown);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tmct-chat.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  el("printChat").addEventListener("click", () => window.print());

  // ---- store controls: export the triple store, or reset it whole ----------
  // "export facts" downloads the session's whole memory as JSONL (the same
  // subject/predicate/object/provenance shape the extract and memory-export
  // CLI paths emit), so what you taught leaves in the standard shape.
  el("exportFacts").addEventListener("click", async () => {
    const session = window.tmctChatSession;
    if (!session || !window.tmctChat.exportFactsJsonl) return;
    let jsonl;
    try {
      jsonl = await window.tmctChat.exportFactsJsonl(session.memoryDir);
    } catch (err) {
      statusEl.textContent = "couldn't export the facts (" + (err && err.message ? err.message : err) + ")";
      return;
    }
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tmct-facts.jsonl";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // "ingest file" feeds a whole .txt/.md through the SAME session, one
  // sentence at a time (window.tmctChat.splitSentences, then session.turn),
  // teaching every sentence the recognizer grounds and skipping the rest
  // honestly — the same pipeline the ingest page runs, reaching the chat's own
  // memory so the taught facts answer questions straight away.
  el("ingestFile").addEventListener("click", () => el("ingestInput").click());
  el("ingestInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    const session = window.tmctChatSession;
    if (!file || busy || !session || !window.tmctChat.splitSentences) return;
    let text;
    try {
      text = await file.text();
    } catch (err) {
      addSystemLine("couldn't read that file (" + (err && err.message ? err.message : err) + ").");
      return;
    }
    const sentences = window.tmctChat.splitSentences(text);
    if (!sentences.length) { addSystemLine("nothing to ingest in " + file.name + "."); return; }
    setBusy(true);
    statusEl.textContent = "ingesting " + file.name + "\\u2026";
    let grounded = 0;
    try {
      for (const sentence of sentences) {
        const result = await session.turn(sentence);
        if (result.record && result.record.via === "assert" && !result.record.miss) grounded += 1;
      }
    } catch (err) {
      addSystemLine("something went wrong ingesting " + file.name + " (" + (err && err.message ? err.message : err) + ").");
    }
    if (grounded) {
      scheduleSave();
      if (room) room.afterLocalChange().catch(function () { /* a dead channel reports itself through its own close */ });
    }
    const skipped = sentences.length - grounded;
    addSystemLine("ingested " + file.name + " \\u2014 " + sentences.length + " sentence"
      + (sentences.length === 1 ? "" : "s") + " read, " + grounded + " fact"
      + (grounded === 1 ? "" : "s") + " added"
      + (skipped ? ", " + skipped + " skipped (not a recognized fact shape)" : "") + ".");
    await renderStatsPanel();
    renderStatus();
    setBusy(false);
    inputEl.focus();
  });

  // "reset to seed" is the full re-initialisation: drop everything this device
  // holds and reload, so boot re-seeds from the page's shipped seed as if on a
  // first visit. Harder than "forget everything", which only swaps the live
  // session — this trusts nothing in memory and re-fetches the seed asset.
  //
  // Both stores go, not just the payload: what you taught lives in IndexedDB,
  // and the seed asset itself lives in the service worker's Cache Storage. A
  // reset that cleared only the first would re-seed straight back out of a
  // cached copy of an older seed, which is exactly what it promises not to do.
  el("reinitStore").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (persist) await persist.clear();
    await clearSiteAssetCaches();
    window.location.reload();
  });

  // ---- the shared world: nodes, the wire, and the two-paste handshake -----
  // Every piece of networking arrives from ./vendor/p2p.js, the site's own
  // shared P2P asset, imported the first time it is actually wanted rather
  // than at boot — a visitor who never shares never waits for it. The room
  // owns signaling, the mesh and the merge; this block owns what a person
  // sees and clicks, and nothing else.
  const netPanelEl = el("netPanel");
  const nodeNameInputEl = el("nodeNameInput");
  const worldNameInputEl = el("worldNameInput");
  const wireStateEl = el("wireState");
  const wireStateWordEl = el("wireStateWord");
  const wireStateNoteEl = el("wireStateNote");
  const statePillEl = el("statePill");
  const statePillWordEl = el("statePillWord");
  const sharePanelEl = el("sharePanel");
  const shareLinkEl = el("shareLink");
  const replyBoxEl = el("replyBox");
  const replyProblemEl = el("replyProblem");
  const answerPanelEl = el("answerPanel");
  const replyOutEl = el("replyOut");
  const nodeListEl = el("nodeList");
  const nodeEmptyEl = el("nodeEmpty");
  const nodeCountEl = el("nodeCount");
  const tapeEl = el("tape");
  const tapeEmptyEl = el("tapeEmpty");
  const tapeMeterEl = el("tapeMeter");
  const tapeTotalEl = el("tapeTotal");
  const waveBurstEl = el("waveBurst");
  const joinCardEl = el("joinCard");
  const joinWorldEl = el("joinWorld");
  const joinEyebrowEl = el("joinEyebrow");
  const joinBodyEl = el("joinBody");
  const joinBtn = el("joinBtn");
  const joinProblemEl = el("joinProblem");
  const joinReplyWrapEl = el("joinReplyWrap");
  const joinReplyEl = el("joinReply");
  const joinDismissBtn = el("joinDismiss");
  const shareBtn = el("shareBtn");
  const waveBtn = el("waveBtn");
  const copyReplyBtn = el("copyReplyBtn");
  const joinCopyBtn = el("joinCopyBtn");

  const P2P_ASSET = "./vendor/p2p.js";
  const NODE_NAME_KEY = "tmct.chat.nodeName";
  const invite = inviteParamsFrom(window.location.search);

  let p2p = null;
  let p2pLoad = null;
  let room = null;
  let myPeerId = null;
  let myDisplayName = "";
  let worldId = "";
  let worldName = "";
  let waveTimer = null;
  let nodeClockTimer = null;
  let channelCount = 0;

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
    if (!myDisplayName) {
      myDisplayName = readStoredNodeName() || mod.generateDisplayName();
      nodeNameInputEl.value = myDisplayName;
    }
    if (!worldId) worldId = invite && invite.world ? invite.world : mod.generateWorldId();
    if (!worldName) {
      worldName = invite && invite.worldName ? invite.worldName : mod.generateDisplayName();
      worldNameInputEl.value = worldName;
    }
  }

  // The one place a transport gets made, which makes it the one place every
  // message crossing one can be seen. The room asks for transports through
  // this factory and never learns it is being watched.
  function instrumentedTransport() {
    const transport = p2p.createTransport({ iceServers: [] });
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
    if (!window.tmctChatSession) await window.tmctChatReady;
    if (!window.tmctChatSession) throw new Error("the chat engine didn't finish booting");
    room = mod.createP2pRoom({
      memoryDir: window.tmctChatSession.memoryDir,
      myPeerId: myPeerId,
      myDisplayName: myDisplayName,
      worldId: worldId,
      worldName: worldName,
      transportFactory: instrumentedTransport,
      syncableFacts: mod.chatSyncableFacts,
    });
    room.onStateChanged(function (state) {
      noteTape("note", state === "failed" ? "fault" : "state", "state " + state, "");
      // The join card exists to produce one reply. Once the channel is open
      // the reply has done its job, and a full-screen card over a live
      // conversation is just something in the way.
      if (state === "connected") joinCardEl.hidden = true;
      renderWire();
      renderStatus();
    });
    room.onPeersChanged(function () { renderNodes(); renderStatus(); });
    room.onFactsChanged(function (payload) {
      noteTape("note", "facts", "merged", payload.merged + (payload.merged === 1 ? " fact" : " facts"));
      renderStatsPanel();
      renderNodes();
      renderWaves();
    });
    await room.start();
    // The world's name is written into the graph the moment the room starts,
    // and this version retracts nothing — so the field stops taking edits.
    worldNameInputEl.readOnly = true;
    worldNameInputEl.title = "written into the graph when this world started";
    window.tmctP2pRoom = room;
    noteTape("note", "link", "world " + worldName, myDisplayName);
    renderWire();
    renderNodes();
    renderStatus();
    if (!nodeClockTimer) nodeClockTimer = setInterval(renderNodes, 10000);
    return room;
  }

  function dropRoom() {
    if (!room) return;
    room.close();
    room = null;
    window.tmctP2pRoom = null;
    clearInterval(nodeClockTimer);
    nodeClockTimer = null;
    shareLinkEl.value = "";
    replyOutEl.value = "";
    noteTape("note", "link", "world closed", worldName);
    renderWire();
    renderNodes();
  }

  // ---- the wire tape: every message, as it happens ------------------------
  const TAPE_CAP = 240;
  const TAPE_FAMILY_COLOR = {
    facts: "var(--taught)",
    state: "var(--corpus)",
    greeting: "var(--entail)",
    signal: "var(--entail-t1)",
    fault: "var(--alert)",
    link: "var(--muted)",
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
    tapeEmptyEl.hidden = true;
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
    tapeTotalEl.textContent = wireMessageCount + (wireMessageCount === 1 ? " message" : " messages");
    tapeMeterEl.textContent = "";
    const counted = [...tapeCounts.entries()].sort(function (a, b) { return b[1] - a[1]; });
    for (const pair of counted) {
      const item = document.createElement("span");
      item.className = "meter-item";
      item.dataset.type = pair[0];
      const bar = document.createElement("i");
      bar.className = "meter-bar";
      bar.style.background = TAPE_FAMILY_COLOR[tapeRowFor("in", { type: pair[0] }).family] || "var(--muted)";
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

  // ---- what a person sees: state, nodes, waves ----------------------------
  function renderWire() {
    const label = wireStateLabel(room ? room.state : "idle");
    wireStateEl.dataset.tone = label.tone;
    wireStateWordEl.textContent = label.word;
    wireStateNoteEl.textContent = label.note;
    statePillEl.dataset.tone = label.tone;
    statePillWordEl.textContent = label.pill;
    statePillEl.title = label.note;
    sharePanelEl.hidden = !shareLinkEl.value;
    // Once the channel is open the reply has been used; leaving "send this
    // back" on screen would be asking for something already done.
    answerPanelEl.hidden = !replyOutEl.value || (room && room.state === "connected");
  }

  function renderNodes() {
    if (!room || !p2p) {
      nodeCountEl.textContent = "";
      nodeListEl.textContent = "";
      nodeEmptyEl.hidden = false;
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
    nodeCountEl.textContent = rows.length + (rows.length === 1 ? " node" : " nodes");
    nodeListEl.textContent = "";
    for (const entry of rows) {
      const item = document.createElement("li");
      item.className = "node-row";
      item.dataset.self = String(entry.isSelf);
      item.dataset.away = String(!entry.connected);
      item.dataset.peer = entry.peerId;
      item.dataset.waving = String(room.isWaving("peer:" + entry.peerId, nowMs));
      const avatar = document.createElement("span");
      avatar.className = "node-avatar";
      avatar.textContent = nodeInitials(entry.name);
      avatar.title = entry.connected ? "connected" : "away — closed the tab or dropped offline; everything it contributed stays";
      const dot = document.createElement("i");
      dot.className = "node-dot";
      avatar.appendChild(dot);
      const name = document.createElement("span");
      name.className = "node-name";
      name.textContent = entry.name;
      const hand = document.createElement("span");
      hand.className = "node-hand";
      hand.textContent = "👋";
      const when = document.createElement("span");
      when.className = "node-when";
      when.textContent = relativeWhen(entry.lastActiveAt, nowMs);
      when.title = entry.lastActiveAt
        ? "last contributed a fact at " + new Date(entry.lastActiveAt).toLocaleTimeString()
        : "has contributed no fact yet";
      item.appendChild(avatar);
      item.appendChild(name);
      item.appendChild(hand);
      item.appendChild(when);
      nodeListEl.appendChild(item);
    }
    nodeEmptyEl.hidden = rows.length > 1;
  }

  // A wave is a fact like any other, so it reaches every page through the
  // same merge every other fact does; "currently waving" is a recency read
  // over that fact, never stored state. Nothing here is a second live-update
  // path — onFactsChanged is what wakes it, and the timer below only lets a
  // wave stop rendering once its window has passed.
  function renderWaves() {
    if (!room) return;
    const nowMs = Date.now();
    const known = [{ peerId: myPeerId, name: myDisplayName }];
    for (const peer of room.peers()) known.push({ peerId: peer.peerId, name: room.displayNameFor(peer.peerId) });
    const waving = known.filter(function (entry) { return room.isWaving("peer:" + entry.peerId, nowMs); });
    waveBurstEl.textContent = "";
    for (const entry of waving) {
      const pill = document.createElement("div");
      pill.className = "wave-pill";
      const hand = document.createElement("span");
      hand.className = "hand";
      hand.textContent = "👋";
      const label = document.createElement("span");
      label.textContent = entry.name + " waved";
      pill.appendChild(hand);
      pill.appendChild(label);
      waveBurstEl.appendChild(pill);
    }
    for (const item of nodeListEl.children) {
      item.dataset.waving = String(waving.some(function (entry) { return entry.peerId === item.dataset.peer; }));
    }
    clearTimeout(waveTimer);
    if (waving.length) waveTimer = setTimeout(renderWaves, 1000);
  }

  async function waveNow() {
    try {
      const active = await ensureRoom();
      await active.wave("peer:" + myPeerId, null);
      noteTape("note", "facts", "waved", myDisplayName);
      renderNodes();
      renderWaves();
    } catch (err) {
      addSystemLine("couldn't wave (" + (err && err.message ? err.message : err) + ").");
    }
  }

  // ---- copying: one tap, no menu, a tooltip that says it happened ---------
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through — the box on the page still holds the text */ }
    try {
      const holder = document.createElement("textarea");
      holder.value = text;
      holder.setAttribute("readonly", "");
      holder.style.position = "fixed";
      holder.style.opacity = "0";
      document.body.appendChild(holder);
      holder.select();
      const copied = document.execCommand("copy");
      holder.remove();
      return copied;
    } catch {
      return false;
    }
  }

  function flashTip(anchor, text) {
    const tip = document.createElement("div");
    tip.className = "copyTip";
    tip.setAttribute("role", "status");
    tip.textContent = text;
    document.body.appendChild(tip);
    const box = anchor.getBoundingClientRect();
    const width = tip.offsetWidth;
    tip.style.top = (box.bottom + 6) + "px";
    tip.style.left = Math.max(6, Math.min(window.innerWidth - width - 6, box.left + box.width / 2 - width / 2)) + "px";
    setTimeout(function () { tip.remove(); }, 2600);
  }

  const openNetPanel = () => document.body.classList.add("net-open");
  const closeNetPanel = () => document.body.classList.remove("net-open");
  el("netPanelClose").addEventListener("click", closeNetPanel);
  statePillEl.addEventListener("click", function () {
    if (document.body.classList.contains("net-open")) closeNetPanel();
    else openNetPanel();
  });

  shareBtn.addEventListener("click", async function () {
    shareBtn.disabled = true;
    try {
      const active = await ensureRoom();
      const minted = await active.startSharing();
      shareLinkEl.value = inviteLinkFor(window.location.href, { blob: minted.blob, world: worldId, worldName: worldName });
      replyProblemEl.hidden = true;
      renderWire();
      openNetPanel();
      await copyText(shareLinkEl.value);
      flashTip(shareBtn, "link copied — send it to one person");
    } catch (err) {
      addSystemLine("couldn't create an invite (" + (err && err.message ? err.message : err) + ").");
    } finally {
      shareBtn.disabled = false;
    }
  });

  // The inviter's page has exactly one paste target, so there is no wrong box
  // to choose. A rejected paste keeps its text so the copy can be fixed.
  el("replyBtn").addEventListener("click", async function () {
    let active = room;
    if (!active) {
      try { active = await ensureRoom(); } catch { return; }
    }
    const outcome = await active.completeInvite(replyBoxEl.value);
    if (outcome && outcome.error) {
      replyProblemEl.textContent = outcome.message;
      replyProblemEl.hidden = false;
      noteTape("note", "fault", "reply rejected", outcome.error);
      return;
    }
    replyProblemEl.hidden = true;
    replyBoxEl.value = "";
    // The box stays open on purpose. If two people opened the same link, the
    // second reply still arrives, and it needs somewhere to land so the page
    // can say the invite has already been used rather than swallowing it.
    renderWire();
  });

  copyReplyBtn.addEventListener("click", async function () {
    await copyText(replyOutEl.value);
    flashTip(copyReplyBtn, "reply copied");
  });

  function commitNodeName() {
    const name = nodeNameInputEl.value.trim();
    if (!name || name === myDisplayName) {
      nodeNameInputEl.value = myDisplayName;
      return;
    }
    myDisplayName = name;
    writeStoredNodeName(name);
    if (!room) { renderNodes(); return; }
    room.setMyDisplayName(name)
      .then(function () { noteTape("note", "facts", "renamed", name); renderNodes(); })
      .catch(function () { /* the name still holds locally; the next broadcast carries it */ });
  }
  nodeNameInputEl.addEventListener("change", commitNodeName);
  worldNameInputEl.addEventListener("change", function () {
    if (worldNameInputEl.readOnly) return;
    const name = worldNameInputEl.value.trim();
    if (name) worldName = name;
    worldNameInputEl.value = worldName;
  });

  waveBtn.addEventListener("click", waveNow);

  // ---- joining: a card, one button, nothing running until it is pressed ---
  async function prepareJoinCard() {
    joinCardEl.hidden = false;
    joinWorldEl.textContent = invite.worldName || "a shared graph";
    joinBtn.focus();
    const mod = await loadP2p();
    const decoded = mod.decodeInviteBlob(invite.offer);
    if (decoded.error || decoded.value.kind !== "offer") {
      joinBtn.hidden = true;
      joinEyebrowEl.textContent = "this link didn't arrive in one piece";
      joinWorldEl.textContent = invite.worldName || "an invitation";
      joinBodyEl.textContent = decoded.error
        ? "Part of the link was lost on the way here. Ask for it to be sent again, and check the whole thing travels."
        : "That link carries a reply rather than an invite. It belongs in the box on the page that sent the invite.";
      joinDismissBtn.textContent = "start talking on your own";
      return;
    }
    if (decoded.value.world) invite.world = decoded.value.world;
    if (decoded.value.worldName) {
      invite.worldName = decoded.value.worldName;
      joinWorldEl.textContent = decoded.value.worldName;
    }
  }

  joinBtn.addEventListener("click", async function () {
    joinBtn.disabled = true;
    try {
      const active = await ensureRoom();
      const outcome = await active.acceptInvite(invite.offer);
      if (outcome && outcome.error) {
        joinProblemEl.textContent = outcome.message;
        joinProblemEl.hidden = false;
        noteTape("note", "fault", "invite rejected", outcome.error);
        joinBtn.disabled = false;
        joinBtn.textContent = "try again";
        return;
      }
      joinProblemEl.hidden = true;
      joinReplyEl.value = outcome.blob;
      replyOutEl.value = outcome.blob;
      joinReplyWrapEl.hidden = false;
      joinBtn.textContent = "reply created";
      joinDismissBtn.textContent = "close this and start talking";
      renderWire();
      await copyText(outcome.blob);
      flashTip(joinCopyBtn, "reply copied — send it back the same way");
    } catch (err) {
      joinProblemEl.textContent = "couldn't make a reply (" + (err && err.message ? err.message : err) + ").";
      joinProblemEl.hidden = false;
      joinBtn.disabled = false;
    }
  });

  joinCopyBtn.addEventListener("click", async function () {
    await copyText(joinReplyEl.value);
    flashTip(joinCopyBtn, "reply copied");
  });
  joinDismissBtn.addEventListener("click", function () {
    joinCardEl.hidden = true;
    if (replyOutEl.value) openNetPanel();
  });

  renderWire();
  renderTapeMeter();
  if (invite) {
    prepareJoinCard().catch(function (err) {
      joinProblemEl.textContent = "the networking asset didn't load (" + (err && err.message ? err.message : err) + ").";
      joinProblemEl.hidden = false;
      joinBtn.hidden = true;
    });
  }

  async function boot() {
    if (!window.tmctChat) {
      statusEl.textContent = "the chat engine didn't load \\u2014 this page needs its build step (npm run demo:build)";
      inputEl.placeholder = "chat engine unavailable";
      return;
    }
    await Promise.all([fetchSeed(), tryLoadWink(), fetchSiteVersion().then((v) => { siteVersion = v; })]);
    progressActive = false;
    window.tmctChat.registerReferencePackProvider(fetchPackProvider);
    if (window.tmctChat.openPersistedStore) {
      persist = window.tmctChat.openPersistedStore({ storeKey: "chat", stamp: siteVersion + ":" + seedFacts + ":" + SEED_STAMP });
    }
    const savedRecord = persist ? await persist.load() : null;
    const initialMode = readWikiMode();
    setWikiModeRadios(initialMode);
    writeWikiMode(initialMode); // settles a legacy-key migration under the new key immediately, not only on the next radio change
    synthSliderEl.value = String(readSynthBudget());
    synthValueEl.textContent = synthSliderEl.value;
    if (savedRecord && savedRecord.payload) {
      window.tmctChatSession = window.tmctChat.createChatSession({
        seedPayload: savedRecord.payload,
        vocabSeeded: true,
        liveReference: liveReferenceForMode(initialMode),
        synthesisBudget: readSynthBudget(),
        onLiveLookup: function () { statusEl.textContent = "searching wikipedia\\u2026"; },
        digestStructures: DIGEST_STRUCTURES,
      });
    } else {
      window.tmctChatSession = newSession();
    }
    const stats = await window.tmctChat.memoryStats(window.tmctChatSession.memoryDir);
    if (savedRecord) restoredCount = stats.taught.length;
    const restoredNote = savedRecord
      ? " Restored " + restoredCount + " taught fact" + (restoredCount === 1 ? "" : "s")
        + " from your last visit \\u2014 state kept best-effort on this device."
      : "";
    addSystemLine("tmct \\u2014 the real engine, running in this page \\u2014 " + statsSummaryLine(stats, bandLabelFor)
      + "." + restoredNote + " Ask it something, or teach it a fact of your own.");
    await renderStatsPanel(stats);
    // A restored session may already carry earlier research facts (they
    // persist with everything else this session taught) — seed the
    // seen-set from them so a later research turn only reports what's
    // actually new, without fabricating passages for a visit this page
    // was never open to read.
    if (window.tmctChat.researchedFactRows) {
      try {
        const existingResearch = await window.tmctChat.researchedFactRows(window.tmctChatSession.memoryDir);
        for (const row of existingResearch) researchedFactKeysSeen.add(row.subject + "|" + row.predicate + "|" + row.object);
      } catch { /* best-effort seeding only — a fresh session has none to seed */ }
    }
    renderResearchedPanel();
    inputEl.placeholder = seedPayload ? 'try "what is a dog" or "list facts"' : window.tmctChat.vocabExampleHint(false);
    renderStatus();
    setBusy(false);
    inputEl.focus();
    // Off the boot path on purpose: this fetches the shared P2P asset so the
    // rail can show a real node name and world name before anyone clicks
    // anything. A failure here costs sharing, never the chat.
    ensureIdentity().then(renderNodes).catch(function () { /* the tape already carries the reason */ });
  }

  window.tmctChatReady = boot().catch((err) => {
    console.error("tmct chat failed to boot", err);
    statusEl.textContent = "the chat failed to start (" + (err && err.message ? err.message : err) + ")";
  });
})();
</script>
</body>
</html>
`;
}
