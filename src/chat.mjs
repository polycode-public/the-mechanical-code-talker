// chat.mjs — `seonix chat`: a full interactive client over the seonix code-graph.
// Any BARE line is a plain-English question dispatched through the mechanical
// seonix_ask engine (the EXACT path bin/cli.mjs's `cli seonix_ask` fallback uses),
// so chat is the same zero-model engine with a readline shell around it, plus:
//
//   - SLASH-COMMANDS to reach every richer tool dispatchTool (server.mjs) serves —
//     /find /context /snippet /describe /signature /members /subclasses /impact
//     /callers /callees /tests /untested /history /exports /arch — each mapped to
//     the right tool name + arg key (never invented). Unknown /command → a short
//     "/help" nudge, never a crash; a bad symbol → the tool's own clean error.
//   - a CONVERSATIONAL layer (deterministic, zero-model) that recognises a small
//     closed set of human expressions BEFORE any graph dispatch — greetings, thanks,
//     help/orientation, farewell (ends the session), and why/say-more (re-renders the
//     last answer verbosely, with the ask envelope's traversal receipt + matches).
//     These resolve no entity, so they never become asksAbout graph edges (like /help).
//   - an OPT-IN LLM FALLBACK (--with-claude / --with-copilot, default OFF, chat-only):
//     ONLY when a flag is set AND the mechanical engine misses a bare question does chat
//     shell an external LLM in the target-repo cwd, asking it to COMPILE one seonix
//     command it then runs mechanically (labelled LLM-assisted); any failure degrades to
//     the honest miss. The benchmark/digest/MCP paths never reach this — it is chat-only.
//   - MULTI-TURN CONTEXT: a current FOCUS entity. A command or an answer that
//     resolves a primary entity remembers it; a bare `it`/`this`/`that` (threaded
//     to ask() as contextId) or a no-arg entity command then reuse it, so "what
//     calls it" works after `/describe Foo`. `/focus <symbol>` sets it explicitly;
//     the prompt shows it (`seon(walk.mjs)>`). No focus set → single-shot as before.
//
// Sessions are logged to <repo>/SESSION_LOG_DIR/session-<uuidv7>.log, appended and
// flushed per turn so a killed session keeps everything up to its last turn.
// Alongside it a STRUCTURED sidecar (.seonix/sessions/session-<uuidv7>.jsonl,
// sessions.mjs) records each turn's query, the command used, and the resolved/
// answered entity ids — for SLASH-COMMAND turns too — and the session is upserted
// into graph.json per turn as a first-class `Session` individual with mgx:asksAbout
// edges wherever a turn resolved an entity: chat is temporal graph data, like commits.
//
// runTurn(input, …) is a PURE function (query|command -> { answer, logLines, record,
// focus }) so tests exercise it directly; every ask.mjs import is LAZY and
// failure-tolerated, so concurrent evolution of the engine can never crash a turn
// (worst case a turn records fewer ids / a fallback hint, never wrong data).

import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { dispatchTool } from "./server.mjs";
import { loadConfig, DEFAULT_GRAPH_REL } from "./config.mjs";
import { parseEntities } from "./codegraph.mjs";
import { SESSIONS_DIR_REL, appendSessionToGraph } from "./sessions.mjs";
import { uuidv7 } from "./uuid.mjs";
import { createTelemetry } from "./telemetry.mjs";
import * as defaultSource from "./source.mjs";

// uuidv7 lives in ./uuid.mjs (shared with telemetry + the bench stamp); re-exported
// here because callers/tests still import it from chat.mjs.
export { uuidv7 };

/** Where session logs live, relative to the target repo. `.seonix/` is the repo's
 *  one artifact directory (gitignored, machine-local) — flip this single constant
 *  if the operator prefers a different location. */
export const SESSION_LOG_DIR = ".seonix";

/** The base (no-focus) prompt. With a focus set the shell shows `seon(label)>`. */
export const PROMPT = "seon> ";

/** dispatchTool("seonix_ask", …) returns the prose answer plus a delimited
 *  machine-readable envelope (server.mjs §6.2); the TUI shows the prose only.
 *  Reused verbatim when chat builds the same string from a direct ask() call
 *  (the focus/contextId path), so runTurn parses one envelope shape either way. */
const ASK_ENVELOPE_DELIM = "\n\n---seonix_ask---\n";

/** The context pronouns a focus can stand in for — a bare `it`/`this`/`that`/`here`
 *  as a command arg reuses the focus, and the ask engine resolves the same words
 *  in a question against the contextId we thread through. */
const CONTEXT_WORDS = new Set(["it", "this", "that", "here"]);
const isPronoun = (s) => CONTEXT_WORDS.has(String(s || "").trim().toLowerCase());

/** Slash-command → (dispatchTool name, arg key). Arg keys are the EXACT ones the
 *  server.mjs dispatchTool switch reads (members/subclasses take `class`;
 *  impact/exports take `module`; architecture takes `package`; search takes
 *  `query`; the rest take `symbol`) — never invented. `arg:null` → no-argument
 *  tool; `optional:true` → the arg may be omitted (whole-repo architecture). */
export const COMMANDS = {
  find:       { tool: "seonix_search",       arg: "query",   help: "lexical search across the graph" },
  search:     { tool: "seonix_search",       arg: "query",   help: "alias of /find" },
  context:    { tool: "seonix_context",      arg: "symbol",  help: "the sized edit bundle for a symbol (start here to change code)" },
  snippet:    { tool: "seonix_snippet",      arg: "symbol",  help: "exact source of one function/class/method" },
  describe:   { tool: "seonix_describe",     arg: "symbol",  help: "a symbol's definition, kind and relations" },
  signature:  { tool: "seonix_signature",    arg: "symbol",  help: "a symbol's signature only" },
  members:    { tool: "seonix_members",      arg: "class",   help: "the methods/attributes of a class" },
  subclasses: { tool: "seonix_subclasses",   arg: "class",   help: "the subclasses of a class" },
  impact:     { tool: "seonix_impact",       arg: "module",  help: "what a change to this module reaches (impact closure)" },
  callers:    { tool: "seonix_callers",      arg: "symbol",  help: "functions that call this symbol" },
  callees:    { tool: "seonix_callees",      arg: "symbol",  help: "functions this symbol calls" },
  tests:      { tool: "seonix_tests_for",    arg: "symbol",  help: "the tests covering this symbol" },
  untested:   { tool: "seonix_untested",     arg: null,      help: "symbols with no covering test" },
  history:    { tool: "seonix_history",      arg: "symbol",  help: "the commit history of this symbol" },
  exports:    { tool: "seonix_exports",      arg: "module",  help: "a module's public exports" },
  arch:       { tool: "seonix_architecture", arg: "package", help: "the architecture overview (optional package filter)", optional: true },
};

/** Args that name a single graph entity — the ones a no-arg/pronoun command falls
 *  back to the focus for, and that update the focus on a successful resolve. */
const ENTITY_ARGS = new Set(["symbol", "module", "class"]);

// ---- aggregate / count queries — answered MECHANICALLY off the loaded graph
// header (individuals grouped by class, relation groups by predicate), not by
// dispatching to the ask engine. Deterministic, fully in-ethos. ----

/** singular+plural nouns a user might count → the individual `class` they map to. */
const COUNT_NOUNS = {
  class: "Class", classes: "Class",
  function: "Function", functions: "Function", func: "Function", funcs: "Function",
  module: "Module", modules: "Module", file: "Module", files: "Module",
  method: "Method", methods: "Method",
  attribute: "Attribute", attributes: "Attribute",
  variable: "GlobalVariable", variables: "GlobalVariable", global: "GlobalVariable", globals: "GlobalVariable",
  commit: "Commit", commits: "Commit",
  session: "Session", sessions: "Session",
};

/** class → [singular, plural] display noun, for echoing a count back in English. */
const CLASS_LABELS = {
  Class: ["class", "classes"], Function: ["function", "functions"],
  Module: ["module", "modules"], Method: ["method", "methods"],
  Attribute: ["attribute", "attributes"], GlobalVariable: ["variable", "variables"],
  Commit: ["commit", "commits"], Session: ["session", "sessions"],
};
const classNoun = (cls, n) => { const [s, p] = CLASS_LABELS[cls] || [cls, `${cls}s`]; return n === 1 ? s : p; };

/** Count individuals of a class in the loaded graph (live, not the header field). */
const countClass = (graph, cls) => graph.individuals.filter((i) => (i.class || "") === cls).length;

/** The classes this graph can actually count, as a human list ("classes, functions, …"). */
function countableKinds(graph) {
  const present = new Set(graph.individuals.map((i) => i.class).filter(Boolean));
  return Object.keys(CLASS_LABELS).filter((c) => present.has(c)).map((c) => CLASS_LABELS[c][1]);
}

/** Recognise a count/aggregate question and answer it from the graph header, or
 *  null if it isn't one (→ fall through to seonix_ask). "how many X [are there]",
 *  "count [the] X", "number of X". An unknown kind lists what it CAN count. */
export function answerCount(graph, query) {
  if (!graph) return null;
  const m = String(query).match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/i);
  if (!m) return null;
  const noun = m[1].toLowerCase();
  const cls = COUNT_NOUNS[noun];
  if (!cls) {
    return `I can't count "${noun}". I count: ${countableKinds(graph).join(", ")}. ` +
      `Try "how many classes are there".`;
  }
  const n = countClass(graph, cls);
  return `${n} ${classNoun(cls, n)}.`;
}

/** `/stats`: a one-screen overview of the graph — class counts, relationship
 *  (predicate) counts, and module/package totals — read straight off the header. */
export function renderStats(graph) {
  const byClass = new Map();
  for (const i of graph.individuals) { const c = i.class || "(unclassified)"; byClass.set(c, (byClass.get(c) || 0) + 1); }
  const pad = (n) => String(n).padStart(6);
  const classLines = [...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `  ${pad(n)}  ${c}`);
  const edgeLines = graph.relations.slice()
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((g) => `  ${pad(g.count)}  ${g.predicate || g.prop || "(edge)"}`);
  const modules = graph.individuals.filter((i) => (i.class || "") === "Module");
  const pkgs = new Set(modules.map((m) => String(m.label).split("/")[0]));
  return [
    `graph overview — ${graph.individuals.length} entities.`,
    `entities by class:`,
    ...classLines,
    `relationships by predicate:`,
    ...(edgeLines.length ? edgeLines : ["  (none recorded)"]),
    `${modules.length} module(s) across ${pkgs.size} top-level package(s).`,
  ].join("\n");
}

// ---- friendly handling of non-structural / conversational input ----

/** Greetings and small-talk openers that should get a friendly orientation line,
 *  never the raw grammar-miss hint. */
const GREETINGS = new Set([
  "hi", "hello", "hey", "yo", "sup", "hiya", "howdy", "hey there", "hi there", "hello there",
  "thanks", "thank you", "thankyou", "thx", "ty", "cheers", "ok", "okay", "cool",
]);
const HELP_PHRASES = [
  /^what can (you|u) do\??$/i, /^what do you do\??$/i, /^help( me)?\??$/i, /^\?+$/,
  /^who are you\??$/i, /^what (is|are|r) (this|you)\??$/i, /^how do (i|you) work\??$/i,
];
/** The structural verbs/nouns that mark a near-miss code question (→ keep the
 *  precise grammar hint, not the friendly nudge). */
const STRUCT_WORDS = new Set([
  "import", "imports", "call", "calls", "use", "uses", "define", "defines", "defined",
  "class", "classes", "function", "functions", "module", "modules", "method", "methods",
  "subclass", "subclasses", "inherit", "inherits", "test", "tests", "touch", "touches",
  "commit", "commits", "export", "exports", "caller", "callers", "callee", "callees",
  "history", "where", "mentioned", "signature", "impact",
]);

/** Does this look like small-talk / an orientation request rather than a
 *  (near-miss) structural question? Greetings & help-phrases always qualify; a
 *  very short input with no code-ish token (dotted/pathed/CamelCase name, "()",
 *  or a structural keyword) does too. */
export function isConversational(query) {
  const raw = String(query).trim();
  const q = raw.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (GREETINGS.has(q)) return true;
  if (HELP_PHRASES.some((re) => re.test(raw))) return true;
  const codeish = /[a-z][A-Z]|[_./]|\(\)/.test(raw) || q.split(/\s+/).some((w) => STRUCT_WORDS.has(w));
  return q.split(/\s+/).filter(Boolean).length <= 3 && !codeish;
}

/** The short friendly orientation shown for conversational input. */
const FRIENDLY = [
  "I answer questions about THIS codebase's structure — imports, calls, definitions,",
  "history and counts. For example:",
  "  which modules import walk.mjs",
  "  what calls buildContextBundle",
  "  how many classes are there",
  "/help for commands, /stats for an overview of the graph.",
].join("\n");

// ---- conversational (ELIZA/Zork-manners) templated layer ----
// A small CLOSED set of human expressions handled with a TEMPLATED response BEFORE
// any graph dispatch — deterministic, zero-model. These resolve no code entity, so
// they record as plain turns with empty resolvedIds and never become mgx:asksAbout
// graph edges (same as /help). Register stays plain and short: this is a code tool.

/** Greetings → a short friendly line + one nudge. A couple carry a tasteful nod. */
const GREET = new Set([
  "hi", "hello", "hey", "yo", "hiya", "howdy", "sup", "greetings",
  "g'day", "gday", "hey there", "hi there", "hello there",
  "good morning", "good afternoon", "good evening", "morning",
]);
/** Acknowledgements → an "any time" style reply. */
const THANKS = new Set([
  "thanks", "thank you", "thankyou", "thx", "ty", "ta", "cheers", "nice one",
  "much appreciated", "cool thanks",
]);
/** Farewells → a goodbye AND a clean end of session (same path as /exit). */
const BYE = new Set([
  "bye", "goodbye", "quit", "exit", "see ya", "see you", "cya", "later", "farewell",
]);
/** Elaboration asks → RE-RENDER the last answer verbosely (traversal + matches). */
const WHY = new Set([
  "why", "how", "how so", "how come", "explain", "say more", "go on",
  "elaborate", "tell me more", "more detail", "expand",
]);

const GREETING = "Hi. Ask me about this codebase — imports, calls, definitions, history — or /help.";
/** A couple of expression-specific lines (a light Zork nod for "hello there"). */
const GREETING_LINES = {
  "hello there": 'Hello there. (A hollow voice says, "fool.") Ask me about this codebase, or /help.',
  "good morning": "Good morning. Ask me about this codebase, or /help.",
  "good afternoon": "Good afternoon. Ask me about this codebase, or /help.",
  "good evening": "Good evening. Ask me about this codebase, or /help.",
};
const ACK = "Any time. Ask another, or /help for what I can do.";
const FAREWELL = "Bye — flushing the session log. Come back with a question any time.";

/** Re-render the last answer in verbose form: the previous query + its full answer
 *  plus the ask envelope's traversal receipt and the matched entities (the detail a
 *  terse render trims). `empty:true` when there's no previous answer to expand. */
export function renderVerbose(last) {
  if (!last || !last.answer) {
    return { text: "No previous answer to expand yet — ask me a question first, then say \"why\" or \"say more\".", empty: true };
  }
  const lines = [`(expanding: ${last.query})`, last.answer];
  const d = last.detail || null;
  if (d?.traversal) lines.push(`traversal: ${d.traversal}`);
  if (Array.isArray(d?.matches) && d.matches.length) {
    lines.push(`matches (${d.matches.length}):`);
    for (const m of d.matches) {
      const type = m.type ? ` [${m.type}]` : "";
      const mod = m.module ? ` — ${m.module}` : "";
      lines.push(`  ${m.label}${type}${mod}`);
    }
  }
  return { text: lines.join("\n"), empty: false };
}

/** Recognise a conversational expression and return a templated turn result, or null
 *  to fall through to counts/ask. Handled BEFORE slash-commands' non-slash siblings:
 *  greetings, thanks, help/orientation, farewell (ends the session via `end:true`),
 *  and why/say-more (re-renders `ctx.last`). Turns carry empty resolvedIds so they
 *  never pollute the session graph with asksAbout edges. `ctx.last` is preserved —
 *  a conversational turn is not itself a "last answer" to expand. */
function conversationalTurn(line, ctx) {
  const raw = String(line);
  const q = raw.toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ").trim();
  const mk = (answer, { end = false, miss = false } = {}) => {
    const ts = new Date().toISOString();
    return {
      answer,
      logLines: [ts, `> ${raw}`, answer, ""],
      record: { type: "turn", ts, query: raw, conversational: true, resolvedIds: [], answeredIds: [], miss },
      focus: ctx.focus,
      last: ctx.last, // a conversational turn never overwrites the last real answer
      ...(end ? { end: true } : {}),
    };
  };
  if (BYE.has(q)) return mk(FAREWELL, { end: true });
  if (WHY.has(q)) { const v = renderVerbose(ctx.last); return mk(v.text, { miss: v.empty }); }
  if (GREET.has(q)) return mk(GREETING_LINES[q] || GREETING);
  if (THANKS.has(q)) return mk(ACK);
  if (q === "help" || q === "?" || HELP_PHRASES.some((re) => re.test(raw))) return mk(FRIENDLY);
  return null;
}

// ---- opt-in LLM fallback (chat-only; default OFF; miss-gated) ----
// ONLY fires when a chat flag (--with-claude / --with-copilot) is set AND the
// mechanical engine returns a genuine MISS on a bare question (after the
// conversational layer and slash-commands have had their turn). The subprocess runs
// in the target repo cwd with a timeout; ANY failure (tool absent, non-zero exit,
// unparseable output, timeout) degrades to the engine's honest miss — never a crash
// or a hang. The benchmark/digest/MCP paths never reach here (this is chat-only).

/** How long a fallback subprocess may run before it's killed (ms). */
export const LLM_TIMEOUT_MS = 60_000;

/** Provider specs: the binary, a cheap probe, and the argv for a non-interactive
 *  prompt on the CHEAPEST model. `claude -p` is a headless one-shot; the GitHub
 *  Copilot CLI (`gh copilot -- -p`) is an AGENTIC shell assistant oriented at running
 *  commands, so it's a poorer fit for graph Q&A — wired best-effort, limitation noted
 *  in the README. Both are asked to COMPILE one seonix command (see buildLlmPrompt). */
export const LLM_PROVIDERS = {
  claude: {
    label: "claude",
    bin: "claude",
    probe: ["--version"],
    argv: (prompt) => ["-p", prompt, "--model", "haiku"],
  },
  copilot: {
    label: "copilot",
    bin: "gh",
    probe: ["copilot", "--", "--version"],
    argv: (prompt) => ["copilot", "--", "-p", prompt, "--allow-all-tools", "--no-color"],
  },
};

/** The tool names a compiled fallback command may name — the exact dispatchTool tools
 *  chat already fronts (COMMANDS' targets) plus seonix_ask. A command naming anything
 *  else is rejected (→ the model's raw text is shown instead, clearly labelled). */
const FALLBACK_TOOLS = new Set([...Object.values(COMMANDS).map((c) => c.tool), "seonix_ask"]);

/** Default spawn: a thin spawnSync wrapper normalised to {status,stdout,stderr,error}.
 *  Injectable everywhere so tests never shell out to a real model. */
export function defaultSpawn(bin, args, { cwd, timeout, input = "" } = {}) {
  const r = spawnSync(bin, args, { cwd, timeout, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error || null };
}

/** Build a fallback config from a provider name + an (injectable) spawn. Returns null
 *  for an unknown provider. `cwd` is the CHAT'S TARGET REPO — the subprocess runs there. */
export function makeFallback(provider, spawn = defaultSpawn, { cwd = process.cwd(), timeoutMs = LLM_TIMEOUT_MS } = {}) {
  const spec = LLM_PROVIDERS[provider];
  if (!spec) return null;
  return { provider, label: spec.label, bin: spec.bin, probe: spec.probe, argv: spec.argv, spawn, cwd, timeoutMs };
}

/** One cheap probe (`--version`) to decide if the tool binary is present. A missing
 *  binary / non-zero exit / spawn error → false (chat then says so once and stays
 *  mechanical-only). */
export function probeLlm(fallback) {
  try {
    const r = fallback.spawn(fallback.bin, fallback.probe, { cwd: fallback.cwd, timeout: 5000, input: "" });
    return !!r && !r.error && r.status === 0;
  } catch { return false; }
}

/** The compile prompt: the user's question + the seonix query surface, asking for ONE
 *  command so the answer stays graph-grounded (we execute it mechanically). */
export function buildLlmPrompt(query) {
  const toolLines = [
    `  seonix_ask {"query":"<plain-English structural question>"}  — the general NL graph query`,
    ...Object.entries(COMMANDS).map(([, s]) => `  ${s.tool} {"${s.arg || "…"}":"…"}  — ${s.help}`),
  ];
  return [
    "You translate a question about a code graph into ONE seonix CLI command that answers it.",
    "The graph is already indexed. Available tools and their JSON argument:",
    ...toolLines,
    "",
    "Reply with EXACTLY one line and nothing else:",
    `  seonix cli <tool> '<json-args>'`,
    'e.g.  seonix cli seonix_ask \'{"query":"what calls fetchEntities"}\'',
    "If no tool fits, reply with the single word: NONE",
    "",
    `Question: ${query}`,
  ].join("\n");
}

/** Parse a compiled `seonix cli <tool> '<json>'` command out of the model's text.
 *  Returns {tool,args} on a valid, known-tool command with parseable JSON, else null. */
export function parseSeonixCommand(text) {
  const m = String(text || "").match(/seonix\s+cli\s+(\w+)\s+['"]?(\{[\s\S]*?\})['"]?/);
  if (!m) return null;
  const tool = m[1];
  if (!FALLBACK_TOOLS.has(tool)) return null;
  let args;
  try { args = JSON.parse(m[2]); } catch { return null; }
  if (!args || typeof args !== "object") return null;
  return { tool, args };
}

/** Run the opt-in fallback for a MISSED query. Preferred shape: the model COMPILES one
 *  seonix command, which we execute MECHANICALLY and show graph-grounded, labelled
 *  LLM-assisted. If it can't produce a valid command, its raw text is shown, clearly
 *  marked as coming from the external model (never silently blended with mechanical
 *  answers). ANY spawn failure/timeout/absence → null, so the caller keeps the honest
 *  miss. Async only to await dispatchTool. */
export async function runLlmFallback(query, { fallback, config, source }) {
  if (!fallback) return null;
  let res;
  try {
    res = fallback.spawn(fallback.bin, fallback.argv(buildLlmPrompt(query)), {
      cwd: fallback.cwd, timeout: fallback.timeoutMs, input: "",
    });
  } catch { return null; } // spawn threw (e.g. ENOENT) — degrade to honest miss
  if (!res || res.error || res.status !== 0) return null; // timeout/non-zero/absent
  const text = String(res.stdout || "").trim();
  if (!text) return null;
  const cmd = parseSeonixCommand(text);
  if (cmd) {
    try {
      const out = await dispatchTool(cmd.tool, cmd.args, { config, source });
      return `[LLM-assisted via ${fallback.label}] compiled: seonix cli ${cmd.tool} '${JSON.stringify(cmd.args)}'\n${out}`;
    } catch { /* the compiled command didn't run — fall through to the raw text */ }
  }
  // No usable command: show the model's own words, clearly NOT the deterministic engine.
  return `[answer from external model ${fallback.label} — NOT the deterministic seonix engine]\n${text}`;
}

// ---- repo-root resolution: default the target to the GIT ROOT, not raw cwd ----

/** The git top-level for `cwd`, or null if not in a repo (or git is unavailable).
 *  Injected into runChat so tests exercise the fallback without a real git tree. */
export function gitToplevel(cwd = process.cwd()) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (r.status === 0) { const p = String(r.stdout || "").trim(); return p || null; }
  } catch { /* git missing / not a repo — fall back to cwd */ }
  return null;
}

/** Mirror bin/cli.mjs's configFor: an explicit repo pins the artifact path; no
 *  repo falls back to the cwd/env-derived default. */
function configFor(repoPath) {
  return repoPath ? { graphFile: join(repoPath, DEFAULT_GRAPH_REL) } : loadConfig();
}

/** Resolve a free-text term to a single graph entity via the ask engine's own
 *  tiered resolver — {id,label} on a UNIQUE hit, null on a miss/ambiguity/no graph.
 *  Lazy + failure-tolerated (see the file docblock): the worst case is a turn that
 *  records fewer ids / does not update the focus, never a crash or a wrong id. */
async function resolveEntity(graph, term) {
  if (!graph || !term) return null;
  try {
    const { resolveObject } = await import("./ask.mjs");
    const r = resolveObject(graph, term);
    if (r?.match?.id && !r.ambiguous) return { id: r.match.id, label: r.match.label };
  } catch { /* tolerated */ }
  return null;
}

/** The `/help` body: the bare-question default + every command (from COMMANDS, so
 *  it can't drift) + the seonix_ask question shapes, pulled from the engine's own
 *  rephraseHint() so the shapes are exactly the ones the grammar supports. */
export async function helpText() {
  const rows = [
    ["<question>", "ask the graph in plain English (the default for any non-slash line)"],
    ...Object.entries(COMMANDS).map(([name, s]) => [`/${name}${s.arg ? (s.optional ? ` [${s.arg}]` : ` <${s.arg}>`) : ""}`, s.help]),
    ["/stats", "a one-screen overview: entity counts, relationship counts, packages"],
    ["/focus <symbol>", "set the current focus (reused by 'it'/'this' and no-arg entity commands)"],
    ["/help", "this list"],
    ["/exit", "leave the session (also Ctrl+C / Ctrl+D)"],
  ];
  const w = Math.max(...rows.map(([a]) => a.length));
  const lines = rows.map(([a, b]) => `  ${a.padEnd(w)}  ${b}`);
  let shapes;
  try { const { rephraseHint } = await import("./ask.mjs"); shapes = rephraseHint(); }
  catch {
    shapes = '"which <functions|classes|modules> <import|call|use|test|touch> <name>", ' +
      '"what does <name> <import|export>", "what uses <name>", "where is <name> defined", ' +
      '"when did <name> change"';
  }
  return [
    "commands:", ...lines, "",
    "question shapes for a bare line (seonix_ask):", `  ${shapes}`,
    'plus counts: "how many <classes|functions|modules|methods|commits> are there".',
  ].join("\n");
}

/** A bare question → seonix_ask. When a focus is set AND the graph is in hand we
 *  call ask() directly to thread the focus as contextId (so a pronoun like "it"
 *  resolves to the focus) — building the SAME delimited string dispatchTool emits;
 *  otherwise the unchanged dispatchTool path (which also yields the no-graph error).
 *  A hit updates the focus to the resolved object. Grammar miss / ToolError → a
 *  normal answer, never a crash. */
async function runAsk(query, { config, source, graph, focus, fallback = null }) {
  const ts = new Date().toISOString();
  let answer;
  let envelope = null;
  try {
    let text;
    if (graph && focus?.id) {
      const { ask } = await import("./ask.mjs");
      const r = ask(graph, query, { contextId: focus.id });
      text = `${r.content}${ASK_ENVELOPE_DELIM}${JSON.stringify(r.seonix_ask, null, 2)}`;
    } else {
      text = await dispatchTool("seonix_ask", { query }, { config, source });
    }
    const [content, envJson] = text.split(ASK_ENVELOPE_DELIM);
    answer = content;
    if (envJson) { try { envelope = JSON.parse(envJson); } catch { envelope = null; } }
  } catch (e) {
    answer = String(e?.message || e);
  }
  // A grammar miss has parsed:null → stays []. An empty-RESULT query (object resolved,
  // no edges) still records the resolved subject — that IS the asksAbout signal, and
  // it becomes the new focus so a follow-up "what calls it" can reuse it.
  let resolvedIds = [];
  let newFocus = focus;
  if (graph && envelope?.parsed?.object) {
    const ent = await resolveEntity(graph, envelope.parsed.object);
    if (ent) { resolvedIds = [ent.id]; newFocus = ent; }
  }
  const answeredIds = (envelope?.matches || []).map((m) => m?.id).filter(Boolean);
  const miss = envelope ? !!envelope.miss : true;
  // On a MISS: an opt-in LLM fallback (flag set) gets first refusal on a genuine
  // (non-conversational, bare) question — it degrades to the honest miss on any
  // failure, so `answer` stays the engine's own hint when it returns null. A
  // conversational miss (a greeting, "what can you do", a very short non-code line)
  // gets the friendly orientation instead of the raw grammar hint. A near-miss
  // STRUCTURAL question keeps the precise hint the engine already produced.
  if (miss) {
    if (fallback && !isConversational(query)) {
      const fb = await runLlmFallback(query, { fallback, config, source });
      if (fb != null) answer = fb;
    } else if (isConversational(query)) {
      answer = FRIENDLY;
    }
  }
  const record = { type: "turn", ts, query, resolvedIds, answeredIds, miss };
  const logLines = [ts, `> ${query}`, answer, ""];
  // `detail` feeds why/say-more's verbose re-render: the traversal receipt + the
  // matched entities the terse render trims (see renderVerbose).
  const detail = envelope ? { traversal: envelope.traversal || null, matches: envelope.matches || [] } : null;
  return { answer, logLines, record, focus: newFocus, detail };
}

/** A non-ask, non-dispatch chat turn (count answer, /stats) — the same
 *  { answer, logLines, record, focus } shape, recorded like any other turn. */
function plainTurn(query, answer, { command, miss = false, focus = null } = {}) {
  const ts = new Date().toISOString();
  return {
    answer,
    logLines: [ts, `> ${query}`, answer, ""],
    record: { type: "turn", ts, query, ...(command ? { command } : {}), resolvedIds: [], answeredIds: [], miss },
    focus,
  };
}

/** A slash-command → the mapped tool (or the /help, /focus, unknown cases). Returns
 *  the same { answer, logLines, record, focus } shape as runAsk; the record carries
 *  the command name and the resolved entity id (for entity commands) so a
 *  slash-command turn becomes asksAbout graph data wherever it resolves an entity. */
async function runCommand(line, { config, source, graph, focus }) {
  const ts = new Date().toISOString();
  const sp = line.indexOf(" ");
  const name = (sp === -1 ? line.slice(1) : line.slice(1, sp)).toLowerCase();
  const argText = (sp === -1 ? "" : line.slice(sp + 1)).trim();
  const mk = (answer, { resolvedIds = [], miss = false, newFocus = focus } = {}) => ({
    answer,
    logLines: [ts, `> ${line}`, answer, ""],
    record: { type: "turn", ts, query: line, command: name, resolvedIds, answeredIds: [], miss },
    focus: newFocus,
  });

  if (name === "help") return mk(await helpText());
  if (name === "stats") return graph ? mk(renderStats(graph)) : mk("no graph loaded — /stats needs an index.", { miss: true });

  if (name === "focus") {
    if (!argText) return mk(focus ? `focus is ${focus.label}` : "no focus set — /focus <symbol> to set one.");
    const ent = await resolveEntity(graph, isPronoun(argText) ? focus?.label : argText);
    if (!ent) return mk(`could not resolve "${argText}" to a single entity — focus unchanged${focus ? ` (still ${focus.label})` : ""}.`, { miss: true });
    return mk(`focus set to ${ent.label}.`, { resolvedIds: [ent.id], newFocus: ent });
  }

  const spec = COMMANDS[name];
  if (!spec) return mk(`unknown command /${name} — type /help for the list of commands.`, { miss: true });

  const entityArg = ENTITY_ARGS.has(spec.arg);
  let value = argText;
  if (entityArg && (!value || isPronoun(value))) value = focus?.label || "";
  if (spec.arg && !spec.optional && !value) {
    const need = entityArg ? `${spec.arg} (none given and no focus set — /focus <x> or pass one)` : spec.arg;
    return mk(`/${name} needs a ${need}.`, { miss: true });
  }

  let answer;
  try {
    answer = await dispatchTool(spec.tool, spec.arg ? { [spec.arg]: value } : {}, { config, source });
  } catch (e) {
    return mk(String(e?.message || e), { miss: true }); // the tool's own clean error, never a stack
  }
  // Entity commands resolve their subject for the sidecar/graph AND set the focus so a
  // follow-up ("what calls it", a no-arg /context) reuses it.
  if (entityArg) {
    const ent = await resolveEntity(graph, value);
    if (ent) return mk(answer, { resolvedIds: [ent.id], newFocus: ent });
  }
  return mk(answer);
}

/**
 * One chat turn: input → { answer, logLines, record, focus }. Pure of any
 * TTY/stream concerns so tests exercise it directly. A leading `/` routes to a
 * slash-command; anything else is a bare seonix_ask question. `focus` in is the
 * current focus entity ({id,label}) or null; `focus` out is the (possibly updated)
 * focus the caller should carry into the next turn. A turn never crashes the
 * session — a grammar miss, an unknown command and a bad-symbol ToolError all come
 * back as ordinary answers.
 *
 * `record` is the structured sidecar entry (sessions.mjs): `resolvedIds` is the
 * primary entity the turn resolved (the ask object term, or a slash-command's
 * subject), `answeredIds` the entity ids an ask answer cited; a slash-command turn
 * also carries its `command` name. Both drive the mgx:asksAbout graph append.
 */
export async function runTurn(input, { config, source = defaultSource, graph = null, focus = null, last = null, fallback = null } = {}) {
  const line = String(input ?? "").trim();
  const ctx = { config, source, graph, focus, last, fallback };
  // A DISPATCHED turn (count / slash-command / ask) becomes the new "last answer"
  // that why/say-more re-renders; a conversational turn does not (it preserves it).
  const withLast = (result) => ({ ...result, last: { query: line, answer: result.answer, detail: result.detail ?? null } });

  // Conversational layer first (greetings, thanks, help, bye, why/say-more) — these
  // resolve no entity and carry their own preserved `last`.
  const convo = conversationalTurn(line, ctx);
  if (convo) return convo;

  if (line.startsWith("/")) return withLast(await runCommand(line, ctx));
  // Aggregate/count questions are answered mechanically off the loaded graph header,
  // BEFORE falling through to the ask engine (focus unchanged — a count names no entity).
  const count = answerCount(graph, line);
  if (count != null) return withLast(plainTurn(line, count, { focus }));
  return withLast(await runAsk(line, ctx));
}

/** Trim a focus label for the prompt so a long module path can't run the line off. */
const shortLabel = (l) => { const s = String(l); return s.length > 40 ? "…" + s.slice(-39) : s; };
const promptFor = (focus) => (focus ? `seon(${shortLabel(focus.label)})> ` : PROMPT);

/**
 * The interactive shell. Streams are injectable so tests run scripted sessions
 * without a TTY. Throws the source layer's own ToolError (pointing at
 * `seonix cli index_repository`) when the repo has no graph artifact.
 * Returns { logFile, sidecarFile, turns } once the session ends.
 */
export async function runChat({
  repoPath,
  input = process.stdin,
  output = process.stdout,
  source = defaultSource,
  env = process.env,
  cwd = process.cwd(),
  gitRoot = gitToplevel,
  withClaude = false,
  withCopilot = false,
  spawn = defaultSpawn,
} = {}) {
  // Default the target to the GIT ROOT, not raw cwd: running from a nested package
  // dir (npm sets cwd there) would otherwise index only that package's ~few modules
  // instead of the whole repo. --repo stays the explicit override.
  let repo;
  let config;
  if (repoPath) { repo = repoPath; config = configFor(repoPath); }
  else {
    const root = gitRoot(cwd);
    if (root) { repo = root; config = configFor(root); }
    else { repo = cwd; config = loadConfig(env, cwd); } // not a git repo — cwd/env default
  }

  // Load the graph once up front — the banner needs the module count, focus/`it`
  // resolution and contextId threading need it in hand, and a missing/empty
  // artifact should fail HERE with the server's own helpful error, not on turn one.
  const graph = parseEntities(await source.fetchEntities(config));
  const moduleCount = graph.individuals.filter((i) => (i.class || "") === "Module").length;
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  // Opt-in telemetry (default OFF → null → the loop's `tel?.record` is a no-op, and
  // nothing is written). The conversational session log + sidecar above stay the
  // authoritative chat record; this is the machine-readable query telemetry.
  const tel = createTelemetry({ env, config, surface: "chat" });

  const sessionId = uuidv7();
  const logDir = join(repo, SESSION_LOG_DIR);
  const sessionsDir = join(repo, SESSIONS_DIR_REL);
  await mkdir(logDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  const logFile = join(logDir, `session-${sessionId}.log`);
  const sidecarFile = join(sessionsDir, `session-${sessionId}.jsonl`);
  const stream = createWriteStream(logFile, { flags: "a" });
  const sidecar = createWriteStream(sidecarFile, { flags: "a" });
  // Awaited writes: each chunk is handed to the OS before the loop continues, so a
  // killed session keeps everything up to the last completed turn — in both files.
  const flush = (s, text) =>
    new Promise((resolve, reject) => s.write(text, (e) => (e ? reject(e) : resolve())));
  const writeLog = (text) => flush(stream, text);
  const writeSidecar = (obj) => flush(sidecar, JSON.stringify(obj) + "\n");

  const startIso = new Date().toISOString();
  await writeLog(`# seonix chat ${version} — session started ${startIso} — repo ${repo}\n\n`);
  await writeSidecar({ type: "session", id: sessionId, started: startIso, repo, seonixVersion: version });

  // Read-time graph upsert (sessions.mjs): after every turn, the session becomes /
  // stays a first-class Session individual in graph.json (crash-safe: turn n is in
  // the graph before turn n+1 runs). Best-effort by design — a re-index or vanished
  // artifact mid-session must degrade the recording, never kill the chat.
  const turnRecords = [];
  const upsertGraph = async (ended) => {
    if (!turnRecords.length) return; // a zero-turn session never pollutes the graph
    try { await appendSessionToGraph(config.graphFile, { id: sessionId, started: startIso, ended, turns: turnRecords }); }
    catch { /* best-effort — see above */ }
  };

  const dim = (s) => (env.NO_COLOR || !output.isTTY ? s : `\x1b[2m${s}\x1b[0m`);
  output.write(dim(`seonix chat — ${repo} — ${moduleCount} module(s) — log ${logFile}`) + "\n");
  output.write(dim("pass --repo <path> to target a different repo") + "\n");
  output.write(dim("ask a question, or /help for commands (/stats for an overview) — /exit to leave") + "\n");

  // Opt-in LLM fallback (chat-only, default OFF). Probe the tool ONCE at startup: an
  // absent binary is reported and the flag disabled, so the session stays mechanical-
  // only and never hangs on a missing tool. --with-claude wins if both flags are set.
  let fallback = null;
  const wanted = withClaude ? "claude" : withCopilot ? "copilot" : null;
  if (wanted) {
    const cand = makeFallback(wanted, spawn, { cwd: repo });
    if (probeLlm(cand)) {
      fallback = cand;
      output.write(dim(`LLM fallback: ${cand.label} — used ONLY when the mechanical engine misses a bare question`) + "\n");
    } else {
      output.write(dim(`LLM fallback requested (${wanted}) but its binary was not found — continuing mechanical-only`) + "\n");
    }
  }

  const rl = createInterface({ input, output, prompt: PROMPT });
  rl.on("SIGINT", () => rl.close()); // Ctrl+C behaves like /exit (clean close, log flushed)
  let closed = false;
  rl.on("close", () => { closed = true; });
  const prompt = () => { if (!closed) rl.prompt(); }; // input may end while a turn is in flight

  let turns = 0;
  let focus = null; // the current focus entity ({id,label}) — threaded turn to turn
  let last = null;  // the last dispatched answer ({query,answer,detail}) — why/say-more re-renders it
  prompt();
  for await (const raw of rl) { // Ctrl+D / closed stdin ends the iteration cleanly
    const line = raw.trim();
    if (line === "/exit") break;
    if (line) {
      const { answer, logLines, record, focus: nextFocus, last: nextLast, end } = await runTurn(line, { config, source, graph, focus, last, fallback });
      focus = nextFocus;
      last = nextLast;
      output.write(answer + "\n");
      await writeLog(logLines.join("\n") + "\n");
      await writeSidecar(record);
      turnRecords.push(record);
      // One telemetry line per dispatched turn (OFF by default → no-op). query.raw is
      // the user's line; `tool` the slash-command if any; count the cited entity ids.
      tel?.record({
        tool: record.command,
        query: { raw: line },
        response: { count: (record.answeredIds || []).length, node_ids: record.answeredIds || [] },
      });
      await upsertGraph(record.ts);
      turns += 1;
      rl.setPrompt(promptFor(focus));
      if (end) break; // a conversational "bye"/"goodbye" — clean end, same as /exit
    }
    prompt();
  }
  rl.close();

  const endIso = new Date().toISOString();
  await writeLog(`${endIso}\n> /exit\nsession end ${endIso}\n`);
  await writeSidecar({ type: "end", ts: endIso });
  await upsertGraph(endIso);
  await new Promise((resolve) => stream.end(resolve));
  await new Promise((resolve) => sidecar.end(resolve));
  return { logFile, sidecarFile, turns };
}
