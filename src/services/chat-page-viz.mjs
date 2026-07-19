// chat-page-viz.mjs — "Talk to it"'s full-screen destination
// (PLAN_GAMES_UPLIFT_V3.md Part C.4 item 1): a self-contained document shaped
// exactly like spider-fly-viz.mjs/adventure-viz.mjs's own page-builders — one
// inlined <style> importing viz-theme.mjs's shared tokens, behaviour as an
// inlined IIFE — reusing the SAME chat engine the home page's embedded
// #tmct-chat widget runs (chat-browser.bundle.js's globalThis.tmctChat,
// chat-seed.json, public/reference-pack/), referenced by the same same-origin
// relative paths chat-ui.mjs already uses. This module does not import or
// re-render chat-ui.mjs — it is a second, independent consumer of the same
// engine/bundle, the same relationship spider-fly-viz.mjs's own inlined chat
// dock already has with createSpiderFlySession (both call the shared
// session.turn(line), neither reimplements it).
//
// What's actually new here, versus the embedded widget: full-screen
// post-ChatGPT-style chrome (centered message column, bottom-fixed composer,
// message bubbles) and this page's own signature element — a quiet
// per-message PROVENANCE CHIP (taught / corpus / entailed) next to every
// grounded answer, tmct's actual differentiator versus an LLM chatbot. The
// chip is read straight off the SAME "(source: ...)" citation chat.mjs's own
// factPhrase/renderFactLine convention already appends to most answers (see
// e.g. `dog is a kind of animal (source: corpus:conceptnet ...)` — already
// asserted by e2e/pages-chat.test.mjs against the embedded widget), never a
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

const DEFAULT_TITLE = "tmct — talk to it";

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
<style>
${THEME_TOKENS_CSS}
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; display: flex; flex-direction: column; overflow: hidden; }
  .mono { font-family: ${MONO_STACK}; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; border: none; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  a { color: var(--corpus); }

  .topbar { flex: 0 0 auto; display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .7rem 1.1rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .brand { display: flex; align-items: baseline; gap: .55rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .topbar h1 { font-size: 1.05rem; margin: 0; font-weight: 600; }
  .legend { display: flex; gap: .8rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  .legend-item { display: inline-flex; align-items: center; gap: .32rem; white-space: nowrap; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .dot-taught { background: var(--taught); } .dot-corpus { background: var(--corpus); } .dot-entail { background: var(--entail); }

  main.chatMain { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; }
  .messages { max-width: 720px; margin: 0 auto; padding: 1.2rem 1rem 1.6rem; display: flex; flex-direction: column; gap: .15rem; min-height: 100%; }

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
  .statusline { max-width: 720px; margin: 0 auto; padding: 0 1.1rem .6rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }

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
  <header class="topbar">
    <div class="brand">
      <span class="eyebrow">tmct</span>
      <h1>Talk to it</h1>
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
  </form>
  <div class="statusline" id="status">loading the engine&hellip;</div>
<script src="./chat-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const provBucketFor = ${provBucketFor.toString()};
  const provenanceChipFor = ${provenanceChipFor.toString()};
  const el = (id) => document.getElementById(id);

  const messagesEl = el("messages");
  const composerForm = el("composer");
  const inputEl = el("composerInput");
  const sendBtn = el("composerSend");
  const statusEl = el("status");

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
  // Mirrors chat-ui.mjs's own boot sequence against the SAME bundle/seed/pack
  // — a second consumer of the shared engine, not a fork of it.
  const WINK_LOAD_TIMEOUT_MS = 8000;
  const timeoutAfter = (ms, reason) => new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));

  let winkStatus = "pending";
  async function tryLoadWink() {
    try {
      const [{ default: winkNLP }, { default: model }] = await Promise.race([
        Promise.all([import("wink-nlp"), import("wink-eng-lite-web-model")]),
        timeoutAfter(WINK_LOAD_TIMEOUT_MS, "wink-nlp CDN load timed out"),
      ]);
      window.tmctChat.registerWinkModel(() => ({ winkNLP, model }));
      winkStatus = "loaded";
    } catch (err) {
      winkStatus = "unavailable";
      console.warn("tmct chat: wink-nlp CDN load failed, continuing without the lemma/POS tier", err);
    }
  }

  let seedPayload = null;
  let seedFacts = 0;
  async function fetchSeed() {
    try {
      const res = await fetch("./chat-seed.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      seedPayload = await res.json();
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
    return window.tmctChat.createChatSession({ seedPayload: cloneSeed(), vocabSeeded: Boolean(seedPayload) });
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

  function renderStatus() {
    const seedPart = seedPayload
      ? "starter memory: " + seedFacts + " facts"
      : "starter memory unavailable — starting empty";
    const winkPart = winkStatus === "loaded"
      ? "wink-nlp lemma/POS tier: loaded"
      : winkStatus === "unavailable"
        ? "wink-nlp unavailable — curated + fuzzy tiers only (still zero guesses, zero LLM)"
        : "wink-nlp: loading\\u2026";
    statusEl.textContent = seedPart + " \\u00b7 " + winkPart;
  }

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
      .then((result) => settleAssistantBubble(pendingRow, result.answer, result.record))
      .catch((err) => settleAssistantBubble(pendingRow,
        "something went wrong answering that (" + (err && err.message ? err.message : err) + ") \\u2014 try rephrasing",
        { miss: true }))
      .finally(() => {
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
    window.tmctChat.registerReferencePackProvider(fetchPackProvider);
    window.tmctChatSession = newSession();
    addSystemLine(seedPayload
      ? "tmct \\u2014 the real engine, running in this page \\u2014 " + seedFacts + " starter facts loaded"
      : "tmct \\u2014 the real engine, running in this page \\u2014 no starter memory; starting empty");
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
