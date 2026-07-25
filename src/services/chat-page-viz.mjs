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
import { bandLabelFor, statsSummaryLine, fetchWithProgress, renderStatsPanelInto } from "./memory-panel-viz.mjs";

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
export function renderChatHtml({ title = DEFAULT_TITLE, digestStructures = [] } = {}) {
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
  .chatCol { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .mono { font-family: ${MONO_STACK}; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; border: none; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  a { color: var(--corpus); }

  .topbar { flex: 0 0 auto; display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .7rem 1.1rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .brand { display: flex; align-items: baseline; gap: .55rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .78rem; letter-spacing: .08em; color: var(--muted); }
  .legend { display: flex; gap: .8rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
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

  @media (max-width: 860px) {
    .statsPanel { display: none; }
  }
  @media (max-width: 560px) {
    .legend { display: none; }
    .bubble { max-width: 92%; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { scroll-behavior: auto !important; }
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
  }
</style>
</head>
<body>
  <div class="chatCol">
    <header class="topbar">
      <div class="brand">
        <span class="eyebrow">the-mechanical-code-talker</span>
      </div>
      <div class="legend" aria-hidden="true">${legendHtml}</div>
    </header>
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
  const fetchWithProgress = ${fetchWithProgress.toString()};
  const renderStatsPanelInto = ${renderStatsPanelInto.toString()};
  const createTicker = ${createTicker.toString()};
  const prefersReducedMotion = ${prefersReducedMotion.toString()};
  const DIGEST_STRUCTURES = ${digestStructuresJson};
  const el = (id) => document.getElementById(id);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});

  const messagesEl = el("messages");
  const composerForm = el("composer");
  const inputEl = el("composerInput");
  const sendBtn = el("composerSend");
  const statusEl = el("status");
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

  let seedPayload = null;
  let seedFacts = 0;
  async function fetchSeed() {
    try {
      const blob = await fetchWithProgress("./chat-seed.json", (loaded, total) => noteProgress("seed", loaded, total));
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
  // snapshot to this deploy (site version) AND this seed (fact count) — either
  // changing discards the snapshot in favour of the fresh seed.
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
    statusEl.textContent = seedPart + " \\u00b7 " + winkPart + " \\u00b7 " + livePart;
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
      if (result.record && result.record.via !== "command") scheduleSave();
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
    if (grounded) scheduleSave();
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

  // "reset to seed" is the full re-initialisation: drop the persisted payload
  // outright and reload, so boot re-seeds from the page's shipped seed as if on
  // a first visit. Harder than "forget everything", which only swaps the live
  // session — this trusts nothing in memory and re-fetches the seed asset.
  el("reinitStore").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (persist) await persist.clear();
    window.location.reload();
  });

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
      persist = window.tmctChat.openPersistedStore({ storeKey: "chat", stamp: siteVersion + ":" + seedFacts });
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
