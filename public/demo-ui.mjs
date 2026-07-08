// demo-ui.mjs — drives the live chat-demo widget on the tmct GitLab Pages site.
// Pure vanilla JS/DOM, no framework. Delegates all actual answering to
// tmct-browser.mjs's askBrowser() — the REAL src/ask.mjs engine running in this
// browser tab — and to demo-templates.mjs for the closed, pre-verified question set.
//
// URL params (see index.html's inline note + the implementation report):
//   ?q=<question>   — ask THIS specific question instead of a random template pick.
//                      Still answered live, client-side, by the real engine.
//   ?compact=1      — skip the boot banner + history replay; show only the prompt,
//                      the one question, and its computed answer, as fast as possible.

import { askBrowser, getWinkStatus } from "./tmct-browser.mjs";
import { randomQuestion } from "./demo-templates.mjs";

const params = new URLSearchParams(location.search);
const compact = params.has("compact") && params.get("compact") !== "0";
const primedQuestion = params.get("q");

// 2-3 REAL Q&A pairs, verified against the real engine (see the implementation
// report's Node-side verification run) — genuinely computed output, pasted here
// verbatim rather than re-run on every page load purely to save the visitor a beat
// of extra engine warmup before the "history" appears. The live, randomly-picked (or
// ?q=-primed) question below is ALWAYS computed live, never precomputed.
const HISTORY = [
  { q: "which modules import src/core/store.mjs?", a: "src/handlers/tasks.mjs and src/handlers/users.mjs." },
  { q: "where is Controller defined?", a: "Controller is defined in src/handlers/base.mjs at lines 1-7." },
  { q: "which module has the most imports?", a: "src/handlers/tasks.mjs — the most imports (5)." },
];

const PROMPT = "tmct> "; // matches src/chat.mjs's real PROMPT constant

const root = document.getElementById("tmct-demo");
const wrap = root.closest(".demo-wrap") || document;
const linesEl = root.querySelector(".term-lines");
const statusEl = wrap.querySelector(".term-status");
const cliEl = wrap.querySelector(".term-cli");

function addLine(text, cls) {
  const div = document.createElement("div");
  div.className = cls || "";
  div.textContent = text;
  linesEl.appendChild(div);
  return div;
}

function addPromptLine() {
  const div = document.createElement("div");
  div.className = "term-prompt-line";
  const promptSpan = document.createElement("span");
  promptSpan.className = "term-prompt";
  promptSpan.textContent = PROMPT;
  const textSpan = document.createElement("span");
  textSpan.className = "term-typed";
  div.append(promptSpan, textSpan);
  linesEl.appendChild(div);
  return textSpan;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeInto(el, text, msPerChar) {
  if (msPerChar <= 0) { el.textContent = text; return; }
  for (let i = 1; i <= text.length; i++) {
    el.textContent = text.slice(0, i);
    // eslint-disable-next-line no-await-in-loop
    await sleep(msPerChar);
  }
}

function setCliCaption(question) {
  cliEl.textContent = [
    "$ tmct chat --repo /path/to/your/repo",
    `${PROMPT}${question}`,
  ].join("\n");
}

async function run() {
  const question = primedQuestion || randomQuestion();

  if (compact) {
    root.classList.add("compact");
    const typed = addPromptLine();
    typed.textContent = question;
    const thinking = addLine("computing…", "term-dim");
    setCliCaption(question);
    let result;
    try {
      result = await askBrowser(question);
    } catch (err) {
      thinking.remove();
      addLine(`(honest miss — engine error: ${err && err.message ? err.message : err})`, "term-error");
      return;
    }
    thinking.remove();
    addLine(result.content, "term-answer");
    publishAnswer(question, result.content);
    return;
  }

  // ---- full theatrical boot -------------------------------------------------------
  const bootLine1 = addLine("booting tmct — loading engine in your browser (zero server calls)…", "term-dim");
  setCliCaption(question);

  // Kick off the real engine load immediately (don't block the boot animation on it).
  const enginePromise = askBrowser(question).catch((err) => ({ __error: err }));

  await sleep(350);
  bootLine1.remove();
  addLine("tmct chat — examples/mini-webapp demo graph — 12 module(s)", "term-dim");
  await sleep(200);
  addLine("ask a question, or /help for commands — running live, client-side, no server", "term-dim");
  await sleep(300);

  // A bit of history — as if mid-conversation. Real, verified Q&A (see module header).
  for (const turn of HISTORY) {
    const typed = addPromptLine();
    typed.textContent = turn.q;
    addLine(turn.a, "term-answer");
    // eslint-disable-next-line no-await-in-loop
    await sleep(150);
  }

  await sleep(250);
  const typed = addPromptLine();
  await typeInto(typed, question, 28);
  const thinking = addLine("computing…", "term-dim");

  const result = await enginePromise;
  thinking.remove();
  if (result && result.__error) {
    addLine(`(honest miss — engine error: ${result.__error && result.__error.message ? result.__error.message : result.__error})`, "term-error");
    return;
  }
  addLine(result.content, "term-answer");
  publishAnswer(question, result.content);
}

function publishAnswer(query, answer) {
  window.tmctAnswer = { query, answer, ts: Date.now() };
  root.dispatchEvent(new CustomEvent("tmct-answered", { detail: window.tmctAnswer }));
}

function refreshWinkStatus() {
  const s = getWinkStatus();
  if (s === "loaded") statusEl.textContent = "wink-nlp lemma/POS tier: loaded from esm.sh";
  else if (s === "unavailable") statusEl.textContent = "wink-nlp unavailable — running curated + fuzzy tiers only (still zero guesses, zero LLM)";
  else statusEl.textContent = "wink-nlp: loading…";
  if (s === "pending") setTimeout(refreshWinkStatus, 200);
}

refreshWinkStatus();
run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("tmct demo failed", err);
  addLine(`demo failed to load: ${err && err.message ? err.message : err}`, "term-error");
});
