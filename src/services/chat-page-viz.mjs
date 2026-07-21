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
// asserted by e2e/pages-chat-fullscreen.test.mjs against this page), never a
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

/** The self-contained "talk to it" full-screen page. Pure — the same output
 *  for the same `title` every time; every other piece of state (the session,
 *  every message, every chip) is computed live in the browser once the
 *  sibling chat bundle loads, exactly as the embedded widget already works. */
export function renderChatHtml({ title = DEFAULT_TITLE } = {}) {
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

  /* the live-Wikipedia opt-in row, under the input: a small pill switch in
     the statusline's own mono idiom — quiet, off by default. The checkbox
     itself is visually hidden but stays focusable, so the switch keeps
     keyboard/screen-reader behaviour for free. */
  .composer-tools { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .45rem; display: flex; align-items: center; }
  .composer-tools .liveLabel { display: inline-flex; align-items: center; gap: .45rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); cursor: pointer; }
  .composer-tools input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .toggle-track { position: relative; width: 26px; height: 14px; box-sizing: border-box; border: 1px solid var(--line); border-radius: 99px; background: var(--card); flex: 0 0 auto; transition: background .15s ease, border-color .15s ease; }
  .toggle-knob { position: absolute; top: 1px; left: 1px; width: 10px; height: 10px; border-radius: 50%; background: var(--muted); transition: transform .15s ease; }
  #liveToggle:checked ~ .toggle-track { background: var(--corpus); border-color: var(--corpus); }
  #liveToggle:checked ~ .toggle-track .toggle-knob { transform: translateX(12px); background: var(--bg); }
  #liveToggle:focus-visible ~ .toggle-track { outline: 2px solid var(--ink); outline-offset: 2px; }

  .statusline { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .6rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }

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
      <div class="composer-tools">
        <label class="liveLabel" title="Off by default. When on, a question nothing local can answer also asks en.wikipedia.org — two small requests per lookup, and the answer is cited (CC BY-SA).">
          <input type="checkbox" id="liveToggle" role="switch" aria-label="ask Wikipedia when I don't know">
          <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
          <span>ask Wikipedia when I don&#8217;t know</span>
        </label>
      </div>
    </form>
    <div class="statusline" id="status">loading the engine&hellip;</div>
  </div>
  <aside class="statsPanel" id="statsPanel" aria-label="This session's memory">
    <p class="empty">loading memory stats&hellip;</p>
  </aside>
<script src="./chat-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const provBucketFor = ${provBucketFor.toString()};
  const provenanceChipFor = ${provenanceChipFor.toString()};
  const loadProgressLine = ${loadProgressLine.toString()};
  const el = (id) => document.getElementById(id);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});

  const messagesEl = el("messages");
  const composerForm = el("composer");
  const inputEl = el("composerInput");
  const sendBtn = el("composerSend");
  const statusEl = el("status");
  const statsPanelEl = el("statsPanel");
  const liveToggleEl = el("liveToggle");

  // The live-Wikipedia preference: "on" or absent. try/caught throughout —
  // private-mode storage that throws must never break the page, it just
  // forgets the preference between visits.
  const LIVE_PREF_KEY = "tmct.chat.liveWikipedia";
  function readLivePref() {
    try { return localStorage.getItem(LIVE_PREF_KEY) === "on"; } catch { return false; }
  }
  function writeLivePref(on) {
    try {
      if (on) localStorage.setItem(LIVE_PREF_KEY, "on");
      else localStorage.removeItem(LIVE_PREF_KEY);
    } catch { /* private mode — the toggle still works this visit */ }
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

  function settleAssistantBubble(row, answer, record) {
    const bubble = row.querySelector(".bubble");
    bubble.classList.remove("pending");
    const missed = !record || Boolean(record.miss);
    bubble.classList.toggle("miss", missed);
    bubble.textContent = answer;
    const tier = provenanceChipFor(answer, record, provBucketFor);
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

  // Fetch the url reading the body as a stream, reporting (loadedBytes,
  // totalBytes) after every chunk — total is 0 when the response carries no
  // Content-Length. Resolves to a Blob of the whole body.
  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !res.body.getReader) {
      const blob = await res.blob();
      onProgress(blob.size, total || blob.size);
      return blob;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      loaded += step.value.byteLength;
      onProgress(loaded, total);
    }
    return new Blob(chunks);
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
      liveReference: liveToggleEl.checked,
      onLiveLookup: function () { statusEl.textContent = "searching wikipedia\\u2026"; },
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

  // ---- memory stats: the boot message's own numbers, and the docked panel -
  // Both read window.tmctChat.memoryStats(memoryDir) (chat-browser-entry.mjs)
  // — one computation, reused, so the boot line and the panel can never
  // disagree with each other about what this session's memory holds.
  const BAND_LABELS = { human: "human persona", seon: "seon ontology", conceptnet: "ConceptNet" };
  const BAND_ORDER = ["human", "seon", "conceptnet", "taught this session", "other"];
  const bandLabel = (key) => BAND_LABELS[key] || key;

  /** The boot system line's own memory summary — every seed band this
   *  session actually loaded, named with its real count, left-to-right in
   *  BAND_ORDER; a session with nothing seeded says so plainly instead of
   *  naming zero facts. */
  function statsSummaryLine(stats) {
    if (!stats || !stats.total) return "no starter memory; starting empty";
    const parts = BAND_ORDER.filter((k) => stats.bandCounts[k]).map((k) => stats.bandCounts[k] + " " + bandLabel(k));
    return parts.length
      ? "starter memory: " + parts.join(" + ") + " (" + stats.total + " facts total)"
      : stats.total + " starter facts loaded";
  }

  function bandRow(label, count) {
    const row = document.createElement("p");
    row.className = "band-row";
    const l = document.createElement("span");
    l.textContent = label;
    const c = document.createElement("span");
    c.className = "band-count";
    c.textContent = String(count);
    row.appendChild(l);
    row.appendChild(c);
    return row;
  }

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
    statsPanelEl.textContent = "";
    statsPanelEl.appendChild(Object.assign(document.createElement("h2"), { textContent: "this session's memory" }));
    statsPanelEl.appendChild(bandRow("total facts", stats.total));
    for (const key of BAND_ORDER) {
      if (stats.bandCounts[key]) statsPanelEl.appendChild(bandRow(bandLabel(key), stats.bandCounts[key]));
    }

    statsPanelEl.appendChild(Object.assign(document.createElement("h2"), { textContent: "taught this session" }));
    if (!stats.taught.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = 'nothing yet \\u2014 teach it something ("a dog is a kind of animal") and it lands here, with its source.';
      statsPanelEl.appendChild(empty);
    } else {
      for (const fact of stats.taught.slice(-8).reverse()) {
        const item = document.createElement("p");
        item.className = "taught-item";
        item.appendChild(document.createTextNode(fact.subject + " " + fact.predicate + " " + fact.object));
        const tag = document.createElement("span");
        tag.className = "taught-tag";
        tag.textContent = fact.tag;
        item.appendChild(tag);
        statsPanelEl.appendChild(item);
      }
    }
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
    const livePart = "live wikipedia: " + (liveToggleEl.checked ? "on" : "off");
    statusEl.textContent = seedPart + " \\u00b7 " + winkPart + " \\u00b7 " + livePart;
  }

  liveToggleEl.addEventListener("change", function () {
    writeLivePref(liveToggleEl.checked);
    if (window.tmctChatSession && window.tmctChatSession.setLiveReference) {
      window.tmctChatSession.setLiveReference(liveToggleEl.checked);
    }
    renderStatus();
  });

  let busy = true;
  function setBusy(v) {
    busy = v;
    const ready = Boolean(window.tmctChatSession);
    inputEl.disabled = v || !ready;
    sendBtn.disabled = v || !ready;
  }

  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = inputEl.value.trim();
    if (!q || busy || !window.tmctChatSession) return;
    inputEl.value = "";
    addUserBubble(q);
    const pendingRow = addPendingAssistantBubble();
    setBusy(true);
    window.tmctChatSession.turn(q)
      .then((result) => {
        settleAssistantBubble(pendingRow, result.answer, result.record);
        return renderStatsPanel(); // a teach turn just grew this session's memory; a plain ask leaves it unchanged either way
      })
      .catch((err) => settleAssistantBubble(pendingRow,
        "something went wrong answering that (" + (err && err.message ? err.message : err) + ") \\u2014 try rephrasing",
        { miss: true }))
      .finally(() => {
        // A "/wiki on|off" turn flips the session's own state — mirror it back
        // into the switch and the stored preference, then settle the
        // statusline (which the onLiveLookup hook may have overwritten with
        // "searching wikipedia…" mid-turn).
        if (window.tmctChatSession && typeof window.tmctChatSession.liveReference === "boolean"
            && liveToggleEl.checked !== window.tmctChatSession.liveReference) {
          liveToggleEl.checked = window.tmctChatSession.liveReference;
          writeLivePref(liveToggleEl.checked);
        }
        renderStatus();
        setBusy(false);
        inputEl.focus();
      });
  });

  async function boot() {
    if (!window.tmctChat) {
      statusEl.textContent = "the chat engine didn't load \\u2014 this page needs its build step (npm run demo:build)";
      inputEl.placeholder = "chat engine unavailable";
      return;
    }
    await Promise.all([fetchSeed(), tryLoadWink()]);
    progressActive = false;
    window.tmctChat.registerReferencePackProvider(fetchPackProvider);
    liveToggleEl.checked = readLivePref();
    window.tmctChatSession = newSession();
    if (window.tmctChatSession.setLiveReference) window.tmctChatSession.setLiveReference(liveToggleEl.checked);
    const stats = await window.tmctChat.memoryStats(window.tmctChatSession.memoryDir);
    addSystemLine("tmct \\u2014 the real engine, running in this page \\u2014 " + statsSummaryLine(stats)
      + ". Ask it something, or teach it a fact of your own.");
    await renderStatsPanel(stats);
    inputEl.placeholder = seedPayload ? 'try "what is a dog"' : window.tmctChat.vocabExampleHint(false);
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
