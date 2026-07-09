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

// REAL Q&A turns, verified against the real engine — genuinely computed output,
// pasted here verbatim rather than re-run on every page load purely to save the
// visitor a beat of extra engine warmup before the "history" appears. The live,
// randomly-picked (or ?q=-primed) question below is ALWAYS computed live, never
// precomputed.
//
// The first two turns are flat single-question lookups; the last three are one
// continuous exchange showing tmct carry a pronoun ("it") across turns — ask about
// Task, then ask "what calls it?" and "where is it defined?" without repeating the
// name. Verified turn by turn with src/ask.mjs's real ask(graph, query, {contextId,
// prev}), threading contextId/prev exactly as src/chat.mjs's runAsk does: `prev` is
// each turn's full match-id set, and the focus (contextId) only moves when the
// question names a new entity outright — a pronoun object resolves against the
// standing focus instead of replacing it, so "it" keeps meaning Task through the
// "what calls it?" aside about its callers. All five turns come back non-miss.
const HISTORY = [
  { q: "which modules import src/core/store.mjs?", a: "src/handlers/tasks.mjs and src/handlers/users.mjs." },
  { q: "which module has the most imports?", a: "src/handlers/tasks.mjs — the most imports (5)." },
  { q: "what is a Task?", a: "Task is a class in this codebase, defined in src/core/model.mjs — try \"describe Task\" or \"which classes inherit from Task\"." },
  { q: "what calls it?", a: "in src/core/store.mjs there is function saveStore() and there is function validateTask() in src/core/validate.mjs." },
  { q: "where is it defined?", a: "Task is defined in src/core/model.mjs at lines 9-15." },
];

const PROMPT = "tmct> "; // matches src/chat.mjs's real PROMPT constant

const root = document.getElementById("tmct-demo");
const wrap = root.closest(".demo-wrap") || document;
const linesEl = root.querySelector(".term-lines");
const statusEl = wrap.querySelector(".term-status");
const cliEl = wrap.querySelector(".term-cli");
const inputRow = root.querySelector(".term-input-row");
const inputEl = root.querySelector(".term-input");

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
    enableInput();
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
    enableInput();
    return;
  }
  addLine(result.content, "term-answer");
  publishAnswer(question, result.content);
  enableInput();
}

function publishAnswer(query, answer) {
  window.tmctAnswer = { query, answer, ts: Date.now() };
  root.dispatchEvent(new CustomEvent("tmct-answered", { detail: window.tmctAnswer }));
}

// ---- interactive follow-up questions ----------------------------------------------
// Once the scripted demo has produced its first real answer, the engine is warm and
// the visitor can type their own questions against the same live examples/mini-webapp
// graph — same askBrowser() call, same rendering helpers, genuinely computed each time.
let asking = false;

async function askAndRender(question) {
  if (asking) return;
  asking = true;
  inputEl.disabled = true;
  const typed = addPromptLine();
  typed.textContent = question;
  const thinking = addLine("computing…", "term-dim");
  setCliCaption(question);
  try {
    const result = await askBrowser(question);
    thinking.remove();
    addLine(result.content, "term-answer");
    publishAnswer(question, result.content);
  } catch (err) {
    thinking.remove();
    addLine(`(honest miss — engine error: ${err && err.message ? err.message : err})`, "term-error");
  } finally {
    asking = false;
    inputEl.disabled = false;
    inputEl.focus();
    root.scrollTop = root.scrollHeight;
  }
}

function enableInput() {
  inputRow.classList.add("ready");
  inputEl.disabled = false;
}

inputEl.addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  const question = inputEl.value.trim();
  if (!question || asking) return;
  inputEl.value = "";
  askAndRender(question);
});

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
