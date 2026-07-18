// chat-ui.mjs — drives the home page's embedded chat (#tmct-chat). Pure
// vanilla JS/DOM. All answering goes through chat-browser.bundle.js's
// globalThis.tmctChat: createChatSession over the REAL turn engine, an
// in-memory store carrying the built chat-seed.json, and the wink model
// registered from the CDN when it loads. Nothing here composes an answer.
//
// The demo rail replays chat-demos.mjs's scripted turns into a FRESH seeded
// session: the user lines are typed out, the answers are computed by the
// engine on this page, never pasted. After a demo the session stays live, so
// a visitor can keep questioning what it just taught.
//
// Test hooks: window.tmctChatReady (resolves when the input is usable),
// window.tmctChatSession (the live session), window.tmctRunDemo(id).

import { DEMOS } from "./chat-demos.mjs";
import { createTicker } from "./viz-ticker.mjs";

const PROMPT = "tmct> "; // matches src/services/chat.mjs's real PROMPT constant

const root = document.getElementById("tmct-chat");
const logEl = root.querySelector(".chat-log");
const inputEl = root.querySelector(".chat-input");
const railEl = root.querySelector(".chat-demo-rail");
const statusEl = root.querySelector(".chat-status");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addLine(text, cls) {
  const div = document.createElement("div");
  div.className = cls || "";
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function addPromptLine() {
  const div = document.createElement("div");
  div.className = "chat-user";
  const promptSpan = document.createElement("span");
  promptSpan.className = "chat-prompt";
  promptSpan.textContent = PROMPT;
  const textSpan = document.createElement("span");
  div.append(promptSpan, textSpan);
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return textSpan;
}

async function typeInto(el, text, msPerChar) {
  if (reduceMotion || msPerChar <= 0) { el.textContent = text; return; }
  for (let i = 1; i <= text.length; i += 1) {
    el.textContent = text.slice(0, i);
    // eslint-disable-next-line no-await-in-loop
    await sleep(msPerChar);
  }
}

// ---- engine boot -------------------------------------------------------------------

// The same bounded race tmct-browser.mjs uses for its own wink load: a
// cross-origin ESM import can neither resolve nor reject on some failures,
// and an unbounded await would leave the whole chat stuck on "loading".
const WINK_LOAD_TIMEOUT_MS = 8000;
const timeout = (ms, reason) => new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));

let winkStatus = "pending"; // "pending" | "loaded" | "unavailable"
async function tryLoadWink() {
  try {
    const [{ default: winkNLP }, { default: model }] = await Promise.race([
      Promise.all([import("wink-nlp"), import("wink-eng-lite-web-model")]),
      timeout(WINK_LOAD_TIMEOUT_MS, "wink-nlp CDN load timed out"),
    ]);
    window.tmctChat.registerWinkModel(() => ({ winkNLP, model }));
    winkStatus = "loaded";
  } catch (err) {
    winkStatus = "unavailable";
    // eslint-disable-next-line no-console
    console.warn("tmct chat: wink-nlp CDN load failed, continuing without the lemma/POS tier", err);
  }
}

let seedPayload = null; // parsed once; cloned per session so sessions never share a store
let seedFacts = 0;
async function fetchSeed() {
  try {
    const res = await fetch(new URL("./chat-seed.json", import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    seedPayload = await res.json();
    seedFacts = (seedPayload.individuals || []).filter((i) => i.class === "Fact").length;
  } catch (err) {
    seedPayload = null;
    // eslint-disable-next-line no-console
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

// The reference-pack provider: the engine's pack lookups resolve against the
// site's fetchable subset (public/reference-pack/). The index fetch is lazy
// and cached; every failure reads as null, which is the ordinary miss.
let packIndexPromise = null;
const fetchPackIndex = () => {
  packIndexPromise ??= fetch(new URL("./reference-pack/index.json", import.meta.url))
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return packIndexPromise;
};
const fetchPackProvider = {
  async lookup(normTerm) {
    const index = await fetchPackIndex();
    const id = index?.terms?.[String(normTerm ?? "")];
    if (!id) return null;
    try {
      const res = await fetch(new URL(`./reference-pack/articles/${id}.json`, import.meta.url));
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  },
};

function renderStatus() {
  const seedPart = seedPayload
    ? `starter memory: ${seedFacts} facts`
    : `starter memory unavailable — starting empty. ${window.tmctChat ? window.tmctChat.vocabExampleHint(false) : ""}`;
  const winkPart = winkStatus === "loaded"
    ? "wink-nlp lemma/POS tier: loaded from esm.sh"
    : winkStatus === "unavailable"
      ? "wink-nlp unavailable — curated + fuzzy tiers only (still zero guesses, zero LLM)"
      : "wink-nlp: loading…";
  statusEl.textContent = `${seedPart} · ${winkPart}`;
}

// ---- free chat ---------------------------------------------------------------------

let busy = false;

function setControls(enabled) {
  inputEl.disabled = !enabled;
  for (const b of railEl.querySelectorAll("button[data-demo-ready]")) b.disabled = !enabled;
}

async function askAndRender(question) {
  if (busy || !window.tmctChatSession) return;
  busy = true;
  setControls(false);
  const typed = addPromptLine();
  typed.textContent = question;
  const thinking = addLine("computing…", "chat-dim");
  try {
    const { answer, record } = await window.tmctChatSession.turn(question);
    thinking.remove();
    addLine(answer, record?.miss ? "chat-miss" : "chat-answer");
  } catch (err) {
    thinking.remove();
    addLine(`something went wrong answering that (${err && err.message ? err.message : err}) — try rephrasing`, "chat-miss");
  } finally {
    busy = false;
    setControls(true);
    inputEl.focus();
    logEl.scrollTop = logEl.scrollHeight;
  }
}

inputEl.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  const question = inputEl.value.trim();
  if (!question || busy) return;
  inputEl.value = "";
  askAndRender(question);
});

// ---- scripted demos ----------------------------------------------------------------

const demoControlsEl = root.querySelector(".chat-demo-controls");
const demoResetBtn = demoControlsEl.querySelector('[data-ticker="reset"]');
const demoPlayBtn = demoControlsEl.querySelector('[data-ticker="play"]');
const demoStepBtn = demoControlsEl.querySelector('[data-ticker="step"]');

let activeTicker = null;

/** Wires createTicker (viz-ticker.mjs) to one DEMOS entry. `hasNext` is the
 *  fixed-length form the ticker's own header documents — a scripted replay
 *  has a known turn count, unlike spider-fly-viz.mjs's open-ended session —
 *  so `step` here is this closure's own count, never the ticker's. */
function buildDemoTicker(demo) {
  let step = 0;
  let session = null;

  function start() {
    step = 0;
    logEl.replaceChildren();
    addLine(`demo:${demo.id} — ${demo.title} — a fresh session; every answer is computed now`, "chat-dim");
    session = newSession();
    window.tmctChatSession = session;
    root.dataset.demoState = "running";
    demoControlsEl.hidden = false;
    busy = true;
    setControls(false);
  }

  function finishIfDone() {
    if (step < demo.turns.length) return;
    addLine("the session is yours now — keep asking about what it just learned", "chat-dim");
    root.dataset.demoState = "done";
    busy = false;
    setControls(true);
  }

  function renderButtons(state) {
    const done = step >= demo.turns.length;
    demoPlayBtn.textContent = state.playing ? "⏸ pause" : "▶ play";
    demoPlayBtn.setAttribute("aria-label", state.playing ? "Pause the demo" : "Play the demo");
    demoPlayBtn.disabled = state.animating || done;
    demoStepBtn.disabled = state.animating || state.playing || done;
    demoResetBtn.disabled = state.animating;
  }

  start();
  const ticker = createTicker({
    onTick: async () => {
      const typed = addPromptLine();
      await typeInto(typed, demo.turns[step], 24);
      const { answer, record } = await session.turn(demo.turns[step]);
      addLine(answer, record?.miss ? "chat-miss" : "chat-answer");
      step += 1;
      finishIfDone();
    },
    onRender: renderButtons,
    onReset: start,
    hasNext: () => step < demo.turns.length,
    waitMs: reduceMotion ? 0 : 300,
  });
  renderButtons({ playing: false, animating: false });
  return ticker;
}

demoPlayBtn.addEventListener("click", () => activeTicker && activeTicker.play());
demoStepBtn.addEventListener("click", () => activeTicker && activeTicker.stepOnce());
demoResetBtn.addEventListener("click", () => activeTicker && activeTicker.reset());

async function runDemo(id) {
  const demo = DEMOS.find((d) => d.id === id);
  if (!demo || !demo.ready || busy || !window.tmctChat) return false;
  activeTicker = buildDemoTicker(demo);
  await activeTicker.play();
  return true;
}
window.tmctRunDemo = runDemo;

function buildRail() {
  for (const demo of DEMOS) {
    const button = document.createElement("button");
    button.type = "button";
    if (demo.ready) {
      button.textContent = `▶ ${demo.title.toLowerCase()}`;
      button.dataset.demoReady = "1";
      button.disabled = true; // until boot completes
      button.addEventListener("click", () => runDemo(demo.id));
    } else {
      button.textContent = `${demo.title.toLowerCase()} — soon`;
      button.disabled = true;
      button.title = "This demo waits on an engine capability that hasn't shipped yet.";
    }
    button.dataset.demoId = demo.id;
    railEl.appendChild(button);
  }
}

// ---- boot --------------------------------------------------------------------------

async function boot() {
  buildRail();
  if (!window.tmctChat) {
    statusEl.textContent = "the chat engine didn't load — this page needs its build step (npm run demo:build)";
    inputEl.placeholder = "chat engine unavailable";
    return;
  }
  renderStatus();
  await Promise.all([fetchSeed(), tryLoadWink()]);
  window.tmctChat.registerReferencePackProvider(fetchPackProvider);
  window.tmctChatSession = newSession();
  addLine(`tmct chat — the real engine, running in this page — ${seedPayload ? `${seedFacts} starter facts loaded` : "no starter memory; starting empty"}`, "chat-dim");
  addLine(seedPayload ? 'try "what is a dog", or teach it: "every bug is an issue"' : 'teach it directly, e.g. "every bug is an issue"', "chat-dim");
  inputEl.placeholder = seedPayload ? 'try "what is a dog"' : 'teach me, e.g. "every bug is an issue"';
  renderStatus();
  setControls(true);
}

window.tmctChatReady = boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("tmct chat failed to boot", err);
  statusEl.textContent = `the chat failed to start (${err && err.message ? err.message : err})`;
});
