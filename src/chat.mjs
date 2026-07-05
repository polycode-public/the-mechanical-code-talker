// chat.mjs — `tmct chat`: a full interactive client over the tmct code-graph.
// Any BARE line is a plain-English question dispatched through the mechanical
// tmct_ask engine (the EXACT path bin/tmct.mjs's `cli tmct_ask` fallback uses),
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
//   - MULTI-TURN CONTEXT: a current FOCUS entity. A command or an answer that
//     resolves a primary entity remembers it; a bare `it`/`this`/`that` (threaded
//     to ask() as contextId) or a no-arg entity command then reuse it, so "what
//     calls it" works after `/describe Foo`. `/focus <symbol>` sets it explicitly;
//     the prompt shows it (`tmct(walk.mjs)>`). No focus set → single-shot as before.
//
// Sessions are logged to <repo>/SESSION_LOG_DIR/session-<uuidv7>.log, appended and
// flushed per turn so a killed session keeps everything up to its last turn.
// Alongside it a STRUCTURED sidecar (.tmct/sessions/session-<uuidv7>.jsonl,
// sessions.mjs) records each turn's query, the command used, and the resolved/
// answered entity ids — for SLASH-COMMAND turns too — and the session is upserted
// into graph.json per turn as a first-class `Session` individual with mgx:asksAbout
// edges wherever a turn resolved an entity: chat is temporal graph data, like commits.
//
// runTurn(input, …) is a PURE function (query|command -> { answer, logLines, record,
// focus }) so tests exercise it directly; every ask.mjs import is LAZY and
// failure-tolerated, so concurrent evolution of the engine can never crash a turn
// (worst case a turn records fewer ids / an honest miss hint, never wrong data).
//
// createSession(…) is the SESSION SINK every shell shares: it owns the artifact
// files, the per-turn writeLog → writeSidecar → upsertGraph sequencing (order is
// load-bearing — see its docblock), telemetry, and the close. runChat is the
// readline shell over it; src/tui/app.mjs is the Ink shell over the same sink.

import { join, dirname } from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { dispatchTool } from "./server.mjs";
import { loadConfig, DEFAULT_GRAPH_REL } from "./config.mjs";
import { parseEntities } from "./codegraph.mjs";
import { SESSIONS_DIR_REL, appendSessionToGraph } from "./sessions.mjs";
import { uuidv7 } from "./uuid.mjs";
import { createTelemetry } from "./telemetry.mjs";
import * as defaultSource from "./source.mjs";
import { loadTemplates, render as renderTemplate } from "./corpus/templates.mjs";
import { finish } from "./finish.mjs";

// uuidv7 lives in ./uuid.mjs (shared with telemetry + the bench stamp); re-exported
// here because callers/tests still import it from chat.mjs.
export { uuidv7 };

/** Where session logs live, relative to the target repo. `.tmct/` is the repo's
 *  one artifact directory (gitignored, machine-local) — flip this single constant
 *  if the operator prefers a different location. */
export const SESSION_LOG_DIR = ".tmct";

/** The base (no-focus) prompt. With a focus set the shell shows `tmct(label)>`. */
export const PROMPT = "tmct> ";

/** dispatchTool("tmct_ask", …) returns the prose answer plus a delimited
 *  machine-readable envelope (server.mjs §6.2); the TUI shows the prose only.
 *  Reused verbatim when chat builds the same string from a direct ask() call
 *  (the focus/contextId path), so runTurn parses one envelope shape either way. */
const ASK_ENVELOPE_DELIM = "\n\n---tmct_ask---\n";

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
  find:       { tool: "tmct_search",       arg: "query",   help: "lexical search across the graph" },
  search:     { tool: "tmct_search",       arg: "query",   help: "alias of /find" },
  context:    { tool: "tmct_context",      arg: "symbol",  help: "the sized edit bundle for a symbol (start here to change code)" },
  snippet:    { tool: "tmct_snippet",      arg: "symbol",  help: "exact source of one function/class/method" },
  describe:   { tool: "tmct_describe",     arg: "symbol",  help: "a symbol's definition, kind and relations" },
  signature:  { tool: "tmct_signature",    arg: "symbol",  help: "a symbol's signature only" },
  members:    { tool: "tmct_members",      arg: "class",   help: "the methods/attributes of a class" },
  subclasses: { tool: "tmct_subclasses",   arg: "class",   help: "the subclasses of a class" },
  impact:     { tool: "tmct_impact",       arg: "module",  help: "what a change to this module reaches (impact closure)" },
  callers:    { tool: "tmct_callers",      arg: "symbol",  help: "functions that call this symbol" },
  callees:    { tool: "tmct_callees",      arg: "symbol",  help: "functions this symbol calls" },
  tests:      { tool: "tmct_tests_for",    arg: "symbol",  help: "the tests covering this symbol" },
  untested:   { tool: "tmct_untested",     arg: null,      help: "symbols with no covering test" },
  history:    { tool: "tmct_history",      arg: "symbol",  help: "the commit history of this symbol" },
  exports:    { tool: "tmct_exports",      arg: "module",  help: "a module's public exports" },
  arch:       { tool: "tmct_architecture", arg: "package", help: "the architecture overview (optional package filter)", optional: true },
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

/** A discourse-anaphoric count/list head — "how many [of] those/them/these",
 *  "count them/those/these". These refer to the previous answer set and are owned
 *  by the ask engine's anaphora node, never the header-count path. */
const ANAPHORA_COUNT_RE = /\b(?:how many|how much|count|number of)\s+(?:of\s+)?(?:those|them|these)\b/i;

/** Recognise a count/aggregate question and answer it from the graph header, or
 *  null if it isn't one (→ fall through to tmct_ask). "how many X [are there]",
 *  "count [the] X", "number of X". An unknown kind lists what it CAN count. */
export function answerCount(graph, query) {
  if (!graph) return null;
  // ANAPHORIC counts ("how many of those are tested", "count them", "how many of
  // them") count the PREVIOUS answer's set, not a graph kind — decline so the turn
  // falls through to the ask engine's anaphora node (which threads `prev`). Without
  // this the bare "of"/pronoun head is mis-reported as an uncountable kind and the
  // discourse+count follow-up dies before it can resolve (CHATBENCH_006 lever 1).
  if (ANAPHORA_COUNT_RE.test(String(query))) return null;
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

/** ASSERTED-VOCABULARY count (CHATBENCH_006 lever 3): once "every class is a type"
 *  is remembered, "how many types are there" counts as many types as there are
 *  classes — the asserted object noun inherits the subject class's cardinality.
 *  Consulted only when answerCount can't map the noun to a graph class (an unknown
 *  kind) AND a session's memory is in hand. Returns the count string or null (no
 *  such fact → the honest "I can't count …" from answerCount stands). */
async function countFromFacts(graph, memoryDir, query) {
  if (!graph || !memoryDir) return null;
  const m = String(query).match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/i);
  if (!m) return null;
  const asked = m[1].toLowerCase();
  if (COUNT_NOUNS[asked]) return null; // a real graph kind — answerCount owns it
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const objVariants = factTermVariants(normFactTerm, asked);
  const isa = (await factRows(memoryDir))
    .filter((f) => ISA_PREDICATES.has(f.predicate) && objVariants.has(f.object));
  // pick the highest-trust asserted subject that maps to a countable graph class
  for (const f of isa.sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0))) {
    const cls = COUNT_NOUNS[String(f.subject).toLowerCase()];
    if (cls) { const n = countClass(graph, cls); return `${n} ${asked}.`; }
  }
  return null;
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

// ---- the response-template library (W1: templates → render path) ----
// The WORDING of the conversational/orientation surfaces lives in
// data/templates/responses.jsonl (corpus/templates.mjs) — the template library is
// load-bearing for these turns. The recognizer sets below stay code: they decide
// WHICH template answers, never what it says. Loading is lazy + failure-tolerated
// (chat.mjs ethos: a turn never crashes) — a broken/missing data file degrades to
// one short honest line, never a throw before the prompt.

/** Template ids (data/templates/responses.jsonl) for the surfaces chat renders. */
const T_GREETING = "conversational-greeting";
const T_GREETING_BY_PHRASE = {
  "hello there": "conversational-greeting-hello-there",
  "good morning": "conversational-greeting-good-morning",
  "good afternoon": "conversational-greeting-good-afternoon",
  "good evening": "conversational-greeting-good-evening",
};
const T_THANKS = "conversational-thanks";
const T_FAREWELL = "conversational-farewell";
const T_ORIENTATION = "orientation-friendly";
const T_WHY_EMPTY = "miss-no-previous-answer";

/** The degraded line when the template library itself cannot load — a packaging
 *  failure said out loud, never a crashed turn or a silently different answer. */
const TEMPLATES_UNAVAILABLE = "response templates unavailable — ask a question, or /help for commands.";

let templatesPromise = null;
/** Load data/templates/responses.jsonl once per process; null on failure. */
function chatTemplates() {
  if (!templatesPromise) templatesPromise = loadTemplates().catch(() => null);
  return templatesPromise;
}
/** Strict render through the loaded map; null on any failure (no map / unknown
 *  id / missing slot) so every call site degrades explicitly, never half-fills. */
function tRender(templates, id, slots = {}) {
  if (!templates) return null;
  try { return renderTemplate(id, slots, templates); } catch { return null; }
}

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

// (Greeting/thanks/farewell wording moved to data/templates/responses.jsonl — W1.
// The expression-specific greeting variants map through T_GREETING_BY_PHRASE above.)

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
  const t = (id) => tRender(ctx.templates, id) ?? TEMPLATES_UNAVAILABLE;
  const mk = (answer, { end = false, miss = false, via = "template" } = {}) => {
    const ts = new Date().toISOString();
    return {
      answer,
      logLines: [ts, `> ${raw}`, answer, ""],
      record: { type: "turn", ts, query: raw, conversational: true, via, resolvedIds: [], answeredIds: [], miss },
      focus: ctx.focus,
      last: ctx.last, // a conversational turn never overwrites the last real answer
      ...(end ? { end: true } : {}),
    };
  };
  if (BYE.has(q)) return mk(t(T_FAREWELL), { end: true });
  if (WHY.has(q)) {
    const v = renderVerbose(ctx.last);
    // The empty-state hint is template wording (via:"template", the data row wins;
    // renderVerbose's own string is the degraded fallback for direct library callers).
    // A real expansion re-renders the LAST ANSWER — its wording is the prior answer's,
    // not a template's, so it carries via:"conversational".
    if (v.empty) return mk(tRender(ctx.templates, T_WHY_EMPTY) ?? v.text, { miss: true });
    return mk(v.text, { via: "conversational" });
  }
  if (GREET.has(q)) return mk(t(T_GREETING_BY_PHRASE[q] || T_GREETING));
  if (THANKS.has(q)) return mk(t(T_THANKS));
  if (q === "help" || q === "?" || HELP_PHRASES.some((re) => re.test(raw))) return mk(t(T_ORIENTATION));
  return null;
}

// ---- repo-root resolution: default the target to the GIT ROOT, not raw cwd ----

/** The git top-level for `cwd`, or null if not in a repo (or git is unavailable).
 *  Injected into runChat so tests exercise repo resolution without a real git tree. */
export function gitToplevel(cwd = process.cwd()) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (r.status === 0) { const p = String(r.stdout || "").trim(); return p || null; }
  } catch { /* git missing / not a repo — fall back to cwd */ }
  return null;
}

/** Mirror bin/tmct.mjs's configFor: an explicit repo pins the artifact path; no
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
 *  it can't drift) + the tmct_ask question shapes, pulled from the engine's own
 *  rephraseHint() so the shapes are exactly the ones the grammar supports. */
export async function helpText() {
  const rows = [
    ["<question>", "ask the graph in plain English (the default for any non-slash line)"],
    ...Object.entries(COMMANDS).map(([name, s]) => [`/${name}${s.arg ? (s.optional ? ` [${s.arg}]` : ` <${s.arg}>`) : ""}`, s.help]),
    ["/stats", "a one-screen overview: entity counts, relationship counts, packages"],
    ["/memory [verbose]", "what tmct remembers: facts, utterances, sessions, folded blocks"],
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
    "question shapes for a bare line (tmct_ask):", `  ${shapes}`,
    'plus counts: "how many <classes|functions|modules|methods|commits> are there".',
  ].join("\n");
}

// ---- W2: memory recall on the miss path (retrieveBlocks → runAsk) ----

/** The conservative relevance floor a folded-session block must clear (the
 *  retrieveBlocks idf×(1+rank) score) before an honest ask-miss is answered from
 *  memory. Calibrated in the small-corpus regime (test/wiring-recall.test.mjs):
 *  a genuine re-ask scores ~4, a frame-word coincidence ~1. */
export const RECALL_MIN_SCORE = 2.0;

/** How many blocks the miss path consults (the W2 seam: retrieveBlocks(dir, q, 2)). */
const RECALL_TOP_K = 2;

/** Frame/stop words ignored when checking that a recalled Q genuinely shares
 *  vocabulary with the live query — at least one shared CONTENT word is required,
 *  so "which …" alone can never masquerade as a memory. */
const RECALL_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "about", "into", "from",
  "which", "what", "who", "how", "when", "where", "why",
  "does", "do", "did", "is", "are", "was", "were", "there",
  "me", "my", "we", "i", "you", "it", "this", "that", "in", "of", "to",
]);
const recallWords = (s) => new Set(
  String(s).toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 3 && !RECALL_STOPWORDS.has(w)),
);

/** Decode a uuidv7 id's leading 48-bit unix-ms timestamp → "YYYY-MM-DD", or null
 *  (block ids ARE session uuidv7s — fold.mjs sets block id = session id). */
function uuidv7Day(id) {
  const hex = String(id || "").replace(/-/g, "").slice(0, 12);
  if (!/^[0-9a-f]{12}$/i.test(hex)) return null;
  const ms = parseInt(hex, 16);
  return ms > 0 && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/** Pick the recalled block's Q/A pair most relevant to the query (content-word
 *  overlap; ties → first). Null when NO pair shares a content word — the block
 *  matched on packaging, not substance, so the honest miss must stand. */
function bestQaPair(blockText, query) {
  const qWords = recallWords(query);
  const pairs = [];
  let open = null;
  for (const line of String(blockText).split("\n")) {
    if (line.startsWith("Q: ")) { open = { q: line.slice(3), a: "" }; pairs.push(open); }
    else if (open && line.startsWith("A: ")) open.a = line.slice(3);
  }
  let best = null;
  let bestScore = 0;
  for (const p of pairs) {
    let score = 0;
    for (const w of recallWords(p.q)) if (qWords.has(w)) score += 1;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/** W2 seam: consult the folded-session block index for an honest miss. A
 *  sufficiently-relevant hit returns the recalled Q/A, framed and cited to its
 *  session; anything less returns null and the miss stands unchanged. Lazy +
 *  failure-tolerated (chat.mjs ethos): a broken memory store degrades to null. */
async function recallFromBlocks(memoryDir, query) {
  try {
    const { retrieveBlocks } = await import("./memory/blocks.mjs");
    const hits = await retrieveBlocks(memoryDir, query, RECALL_TOP_K);
    const best = hits[0];
    if (!best || best.score < RECALL_MIN_SCORE || !best.text) return null;
    const pair = bestQaPair(best.text, query);
    if (!pair) return null;
    const day = uuidv7Day(best.id);
    const cite = `session ${String(best.id).slice(0, 8)}${day ? `, ${day}` : ""}`;
    const qa = pair.a ? `Q: ${pair.q}\n  A: ${pair.a}` : `Q: ${pair.q}`;
    return `you asked about this before (${cite}):\n  ${qa}`;
  } catch {
    return null;
  }
}

// ---- W4: asserted Facts → answers (the memory graph's reified triples) ----

/** How a stored fact predicate reads in English — one phrase per predicate the
 *  two writers (the ACE grammar, the ConceptNet map) actually emit. An unknown
 *  predicate renders verbatim rather than being guessed around. */
const FACT_PREDICATE_PHRASES = {
  "rdfs:subClassOf": "is a kind of",
  "rdf:type": "is a",
  "owl:disjointWith": "is not a",
  "mgx:partOf": "is part of",
  "mgx:hasA": "has",
  "mgx:usedFor": "is used for",
  "mgx:capableOf": "can",
  "mgx:atLocation": "is found in",
  "mgx:causes": "causes",
  "mgx:hasProperty": "is",
  "mgx:madeOf": "is made of",
  "mgx:receivesAction": "can be",
  "mgx:createdBy": "is created by",
  "mgx:mannerOf": "is a way to",
  "mgx:desires": "wants",
  "mgx:locatedNear": "is typically near",
  "mgx:motivatedByGoal": "is motivated by",
  "mgx:obstructedBy": "can be prevented by",
  "mgx:causesDesire": "makes you want to",
  "mgx:hasSubevent": "involves",
  "mgx:hasFirstSubevent": "begins with",
  "mgx:hasLastSubevent": "ends with",
  "mgx:hasPrerequisite": "requires",
};
const factPhrase = (f) => `${f.subject} ${FACT_PREDICATE_PHRASES[f.predicate] || f.predicate} ${f.object}`;

/** One rendered fact line: "you told me" when the chat asserted it (an ace:chat
 *  provenance tag), "i learned" for corpus-only facts — provenance VERBATIM. */
function renderFactLine(f) {
  const lead = f.provenance.includes("ace:chat") ? "you told me" : "i learned";
  return `${lead}: ${factPhrase(f)}${f.provenance ? ` (source: ${f.provenance})` : ""}`;
}

/** Read every reified Fact out of the memory graph as plain {subject, predicate,
 *  object, provenance} rows. Lazy + failure-tolerated: no memory → []. */
async function memoryFacts(memoryDir) {
  try {
    const { loadMemory } = await import("./memory/core.mjs");
    const m = await loadMemory(memoryDir);
    const out = [];
    for (const ind of m.individuals || []) {
      if (ind?.class !== "Fact") continue;
      const get = (k) => (ind.attributes || []).find((a) => a.key === k)?.value || "";
      out.push({ subject: get("subject"), predicate: get("predicate"), object: get("object"), provenance: get("provenance") });
    }
    return out;
  } catch {
    return [];
  }
}

/** Load memory once and resolve every reified Fact into a TRUST-BEARING row
 *  ({subject,predicate,object,provenance,trust,sourceTypes,…}) via core's
 *  readFactRows — the seam the answer layer ranks + cites without re-walking the
 *  graph shape (Wave-A memory/core.mjs). Lazy + failure-tolerated: no memory → []. */
async function factRows(memoryDir) {
  try {
    const { loadMemory, readFactRows } = await import("./memory/core.mjs");
    return readFactRows(await loadMemory(memoryDir));
  } catch {
    return [];
  }
}

/** Spelling variants a question term is matched under (normFactTerm + a naive
 *  singular): "caches"/"a cache"/"/c/en/cache" all reach the stored "cache". */
function factTermVariants(normFactTerm, term) {
  const t = normFactTerm(term);
  const v = new Set([t]);
  if (t.endsWith("es")) v.add(t.slice(0, -2));
  if (t.endsWith("s")) v.add(t.slice(0, -1));
  return v;
}

/** "is a module a component" — the yes/no vocabulary form the graph grammar
 *  doesn't parse; checked against the isa-family fact predicates only. */
const ISA_ASK_RE = /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+(?:a\s+kind\s+of|a\s+type\s+of|an?)\s+(.+?)[?.!\s]*$/i;
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);
/** "what do you know about caches" — the open recall-everything form. */
const KNOW_ABOUT_RE = /^what\s+do\s+you\s+know\s+about\s+(.+?)[?.!\s]*$/i;
/** How many facts a single answer lists before "…and N more". */
const FACT_ANSWER_CAP = 5;

/** W4 seam: answer (or extend) a vocabulary/definition question from the MEMORY
 *  graph's Facts. Returns { text, replace } — `replace:false` means the engine's
 *  own (schema-docs) answer stands and the fact lines are appended under it —
 *  or null when memory holds nothing relevant (misses stay unchanged). */
async function factAnswer(memoryDir, query, envelope, miss) {
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const q = String(query).trim();

  // (a) meta-shaped questions ("what is a module", "what does cache mean") — the
  // parsed object term, matched against fact SUBJECTS; consulted for hits (append
  // alongside the schema-docs answer) and misses (facts answer alone) alike.
  // When the engine produced NO parse at all (the empty-bootstrap graph
  // short-circuits before parsing), the meta FORM is recognized directly on a
  // miss — same required-article discipline as the grammar's own T5 template.
  let metaTerm = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
  if (!metaTerm && miss && !envelope?.parsed) {
    const m = q.match(/^what\s+(?:is|are)\s+an?\s+(.+?)[?.!\s]*$/i)
      || q.match(/^what\s+(?:does|do)\s+(.+?)\s+means?[?.!\s]*$/i);
    if (m) metaTerm = m[1];
  }
  if (metaTerm) {
    const variants = factTermVariants(normFactTerm, metaTerm);
    const hits = (await memoryFacts(memoryDir)).filter((f) => variants.has(f.subject));
    if (!hits.length) return null;
    const shown = hits.slice(0, FACT_ANSWER_CAP).map(renderFactLine);
    const extra = hits.length > FACT_ANSWER_CAP ? `\n…and ${hits.length - FACT_ANSWER_CAP} more remembered fact${hits.length - FACT_ANSWER_CAP === 1 ? "" : "s"}.` : "";
    return { text: shown.join("\n") + extra, replace: miss };
  }
  if (!miss) return null;

  // (b) "is a module a component" — yes iff a remembered isa-family fact says so.
  const isa = q.match(ISA_ASK_RE);
  if (isa) {
    const subj = factTermVariants(normFactTerm, isa[1]);
    const obj = factTermVariants(normFactTerm, isa[2]);
    const hit = (await memoryFacts(memoryDir)).find(
      (f) => ISA_PREDICATES.has(f.predicate) && subj.has(f.subject) && obj.has(f.object),
    );
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    return null; // no remembered fact — the honest miss stands (never a guessed "no")
  }

  // (c) "what do you know about caches" — everything remembered that MENTIONS the
  // term (subject or object), capped.
  const know = q.match(KNOW_ABOUT_RE);
  if (know) {
    const variants = factTermVariants(normFactTerm, know[1]);
    const hits = (await memoryFacts(memoryDir)).filter((f) => variants.has(f.subject) || variants.has(f.object));
    if (!hits.length) return null;
    // echo the STORED spelling ("caches" asked → "cache" known), never a guess
    const term = variants.has(hits[0].subject) ? hits[0].subject : hits[0].object;
    const shown = hits.slice(0, FACT_ANSWER_CAP).map((f) => `  ${renderFactLine(f)}`);
    const extra = hits.length > FACT_ANSWER_CAP ? `\n  …and ${hits.length - FACT_ANSWER_CAP} more.` : "";
    return { text: `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}:\n${shown.join("\n")}${extra}`, replace: true };
  }
  return null;
}

/** "what did i tell you about X" — the multi-turn recall phrasing (a sibling of
 *  factAnswer's "what do you know about X" KNOW_ABOUT form): everything remembered
 *  that mentions X on either side. */
const TOLD_ABOUT_RE = /^what\s+(?:did|have)\s+(?:i|we|you)\s+(?:told|tell|said|say)\s+(?:you|me|us)?\s*about\s+(.+?)[?.!\s]*$/i;
/** "what kind of thing is an X" — the subject-side membership phrasing the grammar
 *  doesn't parse: reports X's OWN remembered type (falling back to X's members). */
const KIND_OF_RE = /^what\s+kind\s+of\s+(?:thing|class|type|category|entity)?\s*(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
/** WHOLE-STORE recall (CHATBENCH_006 lever 3): "what did i tell you [last time]",
 *  "what facts do you know", "what do you remember" — list EVERY remembered fact
 *  (no subject/object term to filter on), cited, higher-trust first. The multi-turn
 *  / cross-session assert-recall surfaces that carry no term the grammar can bind. */
const WHOLE_RECALL_RE = /^(?:what\s+(?:did|have)\s+(?:i|we)\s+(?:told?|tell|said?|say)\s+(?:you|me|us)?(?:\s+(?:last\s+time|before|earlier|previously|already))?|what\s+facts?\s+do\s+you\s+(?:know|have|remember)|what\s+do\s+you\s+(?:know|remember)|what\s+have\s+you\s+(?:learned|learnt|remembered))[?.!\s]*$/i;

/** The singular class-noun of the graph entity a term names ("app/lib/a.mjs" →
 *  "module", "Widget" → "class"), via the ask engine's own resolver + the loaded
 *  graph's class map — or null on a miss/ambiguity/no-graph. Lets forward
 *  membership answer over a graph INSTANCE, not just a bare class word. */
async function entityClassNoun(graph, term) {
  const ent = await resolveEntity(graph, term);
  if (!ent) return null;
  const cls = (graph?.byId?.get?.(ent.id) || (graph?.individuals || []).find((i) => i?.id === ent.id))?.class;
  return cls && CLASS_LABELS[cls] ? CLASS_LABELS[cls][0] : null;
}

/** ASSERT-RECALL MULTI-TURN READ-BACK (PLAN_CYCLE_4 tail → cycle-005 lever 2):
 *  once "every X is a Y" is asserted in an earlier turn, the graded assert-recall
 *  cells (B2/C1 assert) query it back across turns in shapes the graph grammar
 *  can't parse — so each dies as an honest miss even though "X is a kind of Y" is
 *  remembered. This reader answers those declare-then-recall shapes from the
 *  reified Facts (readFactRows — trust-bearing), citing each fact's provenance
 *  verbatim, higher-trust first:
 *    (a) FORWARD membership "is an X a Y" — X a class WORD ("is a module a
 *        component") OR a graph INSTANCE ("is app/lib/a.mjs a component", resolved
 *        to its class-noun) — yes iff a remembered isa-family fact says so;
 *    (b) RECALL "what did i tell you about X" — every remembered fact mentioning X;
 *    (c) REVERSE membership — "what is a Y" reports Y's members (object-side), and
 *        "what kind of thing is an X" reports X's own type (subject-side first).
 *  Miss-only and run AFTER factAnswer returns null, so it never shadows the
 *  subject-side answer or a schema hit. Returns { text, replace:true } or null. */
async function factReadBack(memoryDir, query, envelope, miss, graph = null) {
  if (!miss) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const q = String(query).trim();
  const rows = await factRows(memoryDir);
  if (!rows.length) return null;
  const isa = rows.filter((f) => ISA_PREDICATES.has(f.predicate));
  const byTrust = (a, b) => b.trust - a.trust;
  const renderMany = (hits) => {
    const shown = hits.slice(0, FACT_ANSWER_CAP).map(renderFactLine);
    const n = hits.length - FACT_ANSWER_CAP;
    const extra = n > 0 ? `\n…and ${n} more remembered fact${n === 1 ? "" : "s"}.` : "";
    return { text: shown.join("\n") + extra, replace: true };
  };

  // (d) WHOLE-STORE recall (CHATBENCH_006 lever 3) — "what did i tell you last time",
  // "what facts do you know": no term to bind, so list every remembered fact,
  // higher-trust first, each cited. Answers the cross-session assert-recall surfaces.
  if (WHOLE_RECALL_RE.test(q)) {
    const hits = (isa.length ? isa : rows).slice().sort(byTrust);
    if (!hits.length) return null;
    return renderMany(hits);
  }

  // (a) FORWARD membership — "is an X a Y". X's fact-subject candidates are the
  // term itself (a class word) AND, when it resolves in the graph, its class-noun
  // (an instance) — so "is app/lib/a.mjs a component" answers off "module …".
  const isaAsk = q.match(ISA_ASK_RE);
  if (isaAsk) {
    const objVariants = factTermVariants(normFactTerm, isaAsk[2]);
    const subjCandidates = new Set(factTermVariants(normFactTerm, isaAsk[1]));
    const noun = await entityClassNoun(graph, isaAsk[1]);
    if (noun) for (const v of factTermVariants(normFactTerm, noun)) subjCandidates.add(v);
    const hit = isa
      .filter((f) => subjCandidates.has(f.subject) && objVariants.has(f.object))
      .sort(byTrust)[0];
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    return null; // no remembered fact — the honest miss stands (never a guessed "no")
  }

  // (b) RECALL — "what did i tell you about X": every remembered fact mentioning X.
  const told = q.match(TOLD_ABOUT_RE);
  if (told) {
    const variants = factTermVariants(normFactTerm, told[1]);
    const hits = rows.filter((f) => variants.has(f.subject) || variants.has(f.object)).sort(byTrust);
    if (!hits.length) return null;
    const term = variants.has(hits[0].subject) ? hits[0].subject : hits[0].object;
    const shown = hits.slice(0, FACT_ANSWER_CAP).map((f) => `  ${renderFactLine(f)}`);
    const extra = hits.length > FACT_ANSWER_CAP ? `\n  …and ${hits.length - FACT_ANSWER_CAP} more.` : "";
    return { text: `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}:\n${shown.join("\n")}${extra}`, replace: true };
  }

  // (c) REVERSE / "what kind of thing" membership. The meta form ("what is a Y")
  // comes from the parse when present, else recognized directly on a no-parse miss;
  // "what kind of thing is an X" is recognized regardless (the grammar never parses
  // it as meta). "what is a Y" reports Y's MEMBERS (object-side); "what kind of
  // thing is an X" reports X's own TYPE (subject-side first), so both directions
  // of a single remembered "X is a kind of Y" are queryable.
  let term = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
  let kindOf = false;
  const mk = q.match(KIND_OF_RE);
  if (mk) { term = mk[1]; kindOf = true; }
  else if (!term && !envelope?.parsed) {
    const m = q.match(/^what\s+(?:is|are)\s+an?\s+(.+?)[?.!\s]*$/i);
    if (m) term = m[1];
  }
  if (!term) return null;
  const variants = factTermVariants(normFactTerm, term);
  const subjectHits = isa.filter((f) => variants.has(f.subject)).sort(byTrust);
  const objectHits = isa.filter((f) => variants.has(f.object)).sort(byTrust);
  const hits = kindOf
    ? (subjectHits.length ? subjectHits : objectHits)
    : (objectHits.length ? objectHits : subjectHits);
  if (!hits.length) return null;
  return renderMany(hits);
}

// ---- W5: corpus on-demand — LOCAL tier only, behind an explicit flag ----

/** The opt-in env flag: TMCT_CORPUS_LOOKUP=1 lets an unknown-term miss consult
 *  the LOCAL committed ConceptNet slice (tier 1 of the corpus tiering policy).
 *  Default OFF for this wave.
 *
 *  TIER-3 SEAM (documented, NOT implemented): a network lookup (the ConceptNet
 *  API for terms the local slice misses, cached down into .tmct/corpus/ per the
 *  tier-2 policy) would attach exactly where corpusAside() returns null below —
 *  behind its own explicit opt-in flag, never in the default path, and any
 *  network failure must degrade to the honest miss ($0-offline is inviolable). */
export const CORPUS_LOOKUP_FLAG = "TMCT_CORPUS_LOOKUP";
/** How many corpus surface lines one aside quotes. */
const CORPUS_ASIDE_CAP = 2;

let corpusPromise = null; // the local slice as renderable rows, one load per process
/** Load the committed slice + relation map once, as { key, surface } rows —
 *  `surface` is the map's own canonical sentence ("a cache is used for storing
 *  data"), `key` the normFactTerm-normalized subject. Failure → []. */
function localCorpus() {
  if (!corpusPromise) {
    corpusPromise = (async () => {
      const { loadSlice, loadMap, termText } = await import("./corpus/conceptnet.mjs");
      const { normFactTerm } = await import("./memory/core.mjs");
      const [assertions, map] = await Promise.all([loadSlice(), loadMap()]);
      const rows = [];
      for (const a of assertions) {
        const row = map.get(a.rel);
        if (!row || row.ace === "none" || !row.surface) continue; // non-emissions stay out here too
        const subject = termText(a.start);
        const object = termText(a.end);
        if (!subject || !object) continue;
        rows.push({
          key: normFactTerm(subject),
          surface: String(row.surface).replace("{start}", subject).replace("{end}", object),
        });
      }
      return rows;
    })().catch(() => []);
  }
  return corpusPromise;
}

/** W5 seam: the grounded aside for an unknown term, or null (which is also
 *  where the tier-3 network lookup would attach — see CORPUS_LOOKUP_FLAG). */
async function corpusAside(term) {
  try {
    const { normFactTerm } = await import("./memory/core.mjs");
    const variants = factTermVariants(normFactTerm, term);
    const rows = (await localCorpus()).filter((r) => variants.has(r.key));
    if (!rows.length) return null;
    const shown = rows.slice(0, CORPUS_ASIDE_CAP).map((r) => r.surface);
    return `the corpus knows: ${shown.join("; ")} (ConceptNet, CC-BY-SA)`;
  } catch {
    return null;
  }
}

/** The explicit recall question forms — "what did i ask before", "what did we
 *  talk about", "what have we discussed" — answered from memory, never the graph. */
const RECALL_ASK_RE = /^what (?:did|have) (?:i|we) (?:ask(?:ed)?(?: you)?|talk(?:ed)? about|discuss(?:ed)?)(?: before| earlier| previously| last time)?[?.!]*$/i;

/** Summarize the most recent folded session's questions (block ids are session
 *  uuidv7s, so a plain sort is chronological). Null when nothing is folded yet. */
async function recallSummary(memoryDir) {
  try {
    const { loadBlockIndex, BLOCKS_DIR_REL } = await import("./memory/blocks.mjs");
    const index = await loadBlockIndex(memoryDir);
    const id = Object.keys(index.blocks).sort().at(-1);
    if (!id) return null;
    const text = await readFile(join(memoryDir, BLOCKS_DIR_REL, index.blocks[id].file), "utf8");
    const qs = text.split("\n").filter((l) => l.startsWith("Q: ")).map((l) => l.slice(3)).slice(0, 6);
    if (!qs.length) return null;
    const day = uuidv7Day(id);
    return `last time (session ${String(id).slice(0, 8)}${day ? `, ${day}` : ""}) you asked: ${qs.map((q) => `"${q}"`).join("; ")}`;
  } catch {
    return null;
  }
}

/** "[and/so/…] what about X" — a discourse continuation that re-asks the previous
 *  turn's question with X swapped in. */
const WHAT_ABOUT_RE = /^(?:(?:and|so|but|ok|okay|now|then)\s+)*what about\s+(.+?)[?.!\s]*$/i;
/** A code-ish name token in a prior query (a path/dotted name, or a CamelCase/
 *  Capitalized symbol) — the subject "what about X" replaces. */
const NAME_TOKEN_RE = /\b[\w-]+(?:[/.][\w-]+)+\b|\b[A-Z][A-Za-z0-9_]*\b/;

/** DISCOURSE CONTINUATION (CHATBENCH_006 lever 2): "what about X" carries the PRIOR
 *  turn's question shape across the turn boundary — re-asking it with X in place of
 *  the previous subject/object. Returns the reconstructed query (parsed like any
 *  subject question, so X resolves and becomes the new focus), or null when there's
 *  no prior query or no name token to swap (→ the ordinary honest miss stands). */
function discourseRewrite(query, last) {
  const m = String(query).match(WHAT_ABOUT_RE);
  if (!m || !last?.query) return null;
  const prevQ = String(last.query);
  if (!NAME_TOKEN_RE.test(prevQ)) return null;
  const newSubj = m[1].trim();
  return prevQ.replace(NAME_TOKEN_RE, () => newSubj);
}

/** A bare question → tmct_ask. When a focus is set AND the graph is in hand we
 *  call ask() directly to thread the focus as contextId (so a pronoun like "it"
 *  resolves to the focus) — building the SAME delimited string dispatchTool emits;
 *  otherwise the unchanged dispatchTool path (which also yields the no-graph error).
 *  A hit updates the focus to the resolved object. Grammar miss / ToolError → a
 *  normal answer, never a crash. */
async function runAsk(query, { config, source, graph, focus, last, templates, memoryDir, env }) {
  const ts = new Date().toISOString();
  // DISCOURSE ANAPHORA (CHATBENCH_006 levers 1+2): a follow-up like "which of those
  // are tested" / "how many of those" / "count them" filters or counts the PREVIOUS
  // answer's entity set. That set is the ids the last dispatched turn cited — carried
  // on `last.detail.matches`. Threading it as ask()'s `prev` is what lets the anaphora
  // node resolve instead of the "needs a previous answer" honest miss.
  const prev = (last?.detail?.matches || []).map((m) => m?.id).filter(Boolean);
  // The query the ENGINE parses: a "what about X" continuation is rewritten to the
  // prior shape with X swapped in; everything else parses verbatim. The record and
  // transcript keep the user's ACTUAL words (`query`), only the parse target changes.
  const askQuery = discourseRewrite(query, last) ?? query;
  // W2: the explicit recall forms are answered from memory's folded blocks, never
  // the graph. Gated on memoryDir — a bare runTurn (no session shell) stays pure.
  if (memoryDir && RECALL_ASK_RE.test(String(query).trim())) {
    const summary = await recallSummary(memoryDir);
    return plainTurn(query, summary ?? "nothing to recall yet — no earlier session has been folded into memory.", {
      via: "recall", miss: !summary, focus,
    });
  }
  let answer;
  let envelope = null;
  try {
    let text;
    if (graph && (focus?.id || prev.length)) {
      // Direct ask() when EITHER a focus is set (thread it as contextId so "it"
      // binds) OR the previous turn produced a set to refer back to (thread it as
      // `prev` for the anaphora node). Builds the SAME delimited envelope dispatchTool
      // emits, so the parse below is identical either way.
      const { ask } = await import("./ask.mjs");
      const r = ask(graph, askQuery, { contextId: focus?.id ?? null, prev });
      text = `${r.content}${ASK_ENVELOPE_DELIM}${JSON.stringify(r.tmct_ask, null, 2)}`;
    } else {
      text = await dispatchTool("tmct_ask", { query: askQuery }, { config, source });
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
  // Answer provenance (W1): "composed" is the ask engine's productive band; the
  // orientation swap below is template wording, so those turns carry via:"template".
  let via = "composed";
  let recordMiss = miss;
  // On a MISS: a conversational miss (a greeting, "what can you do", a very short
  // non-code line) gets the friendly orientation instead of the raw grammar hint. A
  // near-miss STRUCTURAL question keeps the precise hint the engine already produced.
  if (miss && isConversational(query)) {
    answer = tRender(templates, T_ORIENTATION) ?? TEMPLATES_UNAVAILABLE;
    via = "template";
  } else if (memoryDir) {
    // W4: vocabulary/definition questions consult the MEMORY graph's Facts
    // alongside the schema-docs surface — a remembered fact answers a miss (or
    // extends a schema hit), cited with its provenance verbatim. Checked BEFORE
    // recall: a reified fact is stronger evidence than a transcript echo.
    // Subject-side facts first (factAnswer), then the reverse-membership read-back
    // (factReadBack) so an asserted "every X is a Y" answers "what is a Y" too.
    const fact = (await factAnswer(memoryDir, query, envelope, miss))
      ?? (await factReadBack(memoryDir, query, envelope, miss, graph));
    if (fact) {
      answer = fact.replace ? fact.text : `${answer}\n${fact.text}`;
      via = "fact";
      recordMiss = false;
    } else if (miss) {
      // W2: after the honest miss is composed, consult the folded-session memory. A
      // relevant enough block ANSWERS — recalled Q/A framed + cited first, with the
      // engine's own miss hint kept below; no hit leaves the miss byte-unchanged.
      const recalled = await recallFromBlocks(memoryDir, query);
      if (recalled) {
        answer = `${recalled}\n\n${answer}`;
        via = "recall";
        recordMiss = false; // memory answered it, cited — no longer a blank
      }
    }
  }
  // W5 (flag-gated, default OFF): an unknown-term miss may consult the LOCAL
  // committed corpus slice — a hit APPENDS a grounded, licence-cited aside under
  // the honest miss (the miss itself stands; the aside is context, not an answer).
  if (recordMiss && envelope?.parsed?.object && String(env?.[CORPUS_LOOKUP_FLAG] || "") === "1") {
    const aside = await corpusAside(envelope.parsed.object);
    if (aside) {
      answer = `${answer}\n${aside}`;
      via = "corpus";
    }
  }
  const record = { type: "turn", ts, query, via, resolvedIds, answeredIds, miss: recordMiss };
  const logLines = [ts, `> ${query}`, answer, ""];
  // `detail` feeds why/say-more's verbose re-render: the traversal receipt + the
  // matched entities the terse render trims (see renderVerbose).
  const detail = envelope ? { traversal: envelope.traversal || null, matches: envelope.matches || [] } : null;
  return { answer, logLines, record, focus: newFocus, detail };
}

/** A non-ask, non-dispatch chat turn (count answer, /stats) — the same
 *  { answer, logLines, record, focus } shape, recorded like any other turn. */
function plainTurn(query, answer, { command, via = "composed", miss = false, focus = null } = {}) {
  const ts = new Date().toISOString();
  return {
    answer,
    logLines: [ts, `> ${query}`, answer, ""],
    record: { type: "turn", ts, query, ...(command ? { command } : {}), via, resolvedIds: [], answeredIds: [], miss },
    focus,
  };
}

/** A slash-command → the mapped tool (or the /help, /focus, unknown cases). Returns
 *  the same { answer, logLines, record, focus } shape as runAsk; the record carries
 *  the command name and the resolved entity id (for entity commands) so a
 *  slash-command turn becomes asksAbout graph data wherever it resolves an entity. */
async function runCommand(line, { config, source, graph, focus, memoryDir }) {
  const ts = new Date().toISOString();
  const sp = line.indexOf(" ");
  const name = (sp === -1 ? line.slice(1) : line.slice(1, sp)).toLowerCase();
  const argText = (sp === -1 ? "" : line.slice(sp + 1)).trim();
  const mk = (answer, { resolvedIds = [], miss = false, newFocus = focus } = {}) => ({
    answer,
    logLines: [ts, `> ${line}`, answer, ""],
    record: { type: "turn", ts, query: line, command: name, via: "command", resolvedIds, answeredIds: [], miss },
    focus: newFocus,
  });

  if (name === "help") return mk(await helpText());
  if (name === "stats") return graph ? mk(renderStats(graph)) : mk("no graph loaded — /stats needs an index.", { miss: true });

  // /memory [verbose] — what tmct remembers, as text (the ROADMAP "Memory
  // inspection" surface; the same renderer serves the `tmct memory` CLI).
  if (name === "memory") {
    if (!memoryDir) return mk("no memory store here — /memory works inside a repo session.", { miss: true });
    try {
      const { inspectMemory } = await import("./memory/inspect.mjs");
      return mk(await inspectMemory(memoryDir, { verbose: /^(?:-v|--verbose|verbose)$/i.test(argText) }));
    } catch (e) {
      return mk(String(e?.message || e), { miss: true }); // a broken store reads as its own clean error
    }
  }

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

/** A declarative ACE-grammar sentence → assert into memory + confirm; null on
 *  any grammar miss / residue / import failure so the query engine keeps first
 *  refusal on everything else. Lazy imports + catch-all: the grammar layer can
 *  never crash a turn (chat.mjs ethos). Writes ONLY under memoryDir/.tmct/memory. */
async function assertTurn(line, { memoryDir, sessionId, focus, lexicon = null }) {
  try {
    const { parseAce } = await import("./grammar/ace.mjs");
    // A session handle carries its own loaded lexicon (createSession loads it once);
    // a bare runTurn (no handle) lazy-loads the cached core lexicon. The lexicon is
    // immutable, so sharing one reference across concurrent handles is re-entrant.
    let lex = lexicon;
    if (!lex) { const { loadLexicon } = await import("./grammar/lexicon.mjs"); lex = loadLexicon(); }
    const parse = parseAce(line, lex);
    if (!parse || !parse.triples?.length || parse.residue?.length) return null;
    const { assertSentence } = await import("./grammar/assert.mjs");
    const { normFactTerm } = await import("./memory/core.mjs");
    const ts = new Date().toISOString();
    const res = await assertSentence(memoryDir, line, {
      lexicon: lex,
      provenance: { source: "chat", sessionId, ts },
    });
    if (!res || !res.ids?.length) return null;
    const shown = res.triples
      .map((t) => `${normFactTerm(t.subject)} ${t.predicate} ${normFactTerm(t.object)}`)
      .join("; ");
    const n = res.ids.length;
    const answer = `noted — remembered ${n} fact${n === 1 ? "" : "s"}: ${shown}`;
    return plainTurn(line, answer, { command: "assert", via: "assert", focus });
  } catch {
    return null; // grammar unavailable / write failed — fall through to the engine
  }
}

/**
 * One chat turn: input → { answer, logLines, record, focus }. Pure of any
 * TTY/stream concerns so tests exercise it directly. A leading `/` routes to a
 * slash-command; anything else is a bare tmct_ask question. `focus` in is the
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
export async function runTurn(input, { config, source = defaultSource, graph = null, focus = null, last = null, memoryDir = null, sessionId = "", env = process.env, lexicon = null } = {}) {
  const line = String(input ?? "").trim();
  const templates = await chatTemplates(); // failure-tolerated: null degrades, never throws
  const ctx = { config, source, graph, focus, last, memoryDir, sessionId, templates, env, lexicon };
  // A DISPATCHED turn (count / slash-command / ask) becomes the new "last answer"
  // that why/say-more re-renders; a conversational turn does not (it preserves it).
  // FINISH SEAM (PLAN_RESPONSE_FINISHING §"Where it lives"): every dispatched turn's
  // result passes through finish() here — the LAST transform in the turn — before its
  // finished answer becomes the `last` we expand. finish() owns the prose-span
  // grammar pass (src/finish.mjs); it rewrites result.answer/logLines and leaves the
  // protected spans (entities, paths, numbers, receipts, provenance) byte-invariant,
  // so `last` and the transcript stay consistent with what the shell prints.
  const withLast = (result) => {
    const finished = finish(result, { graph });
    return { ...finished, last: { query: line, answer: finished.answer, detail: finished.detail ?? null } };
  };

  // Conversational layer first (greetings, thanks, help, bye, why/say-more) — these
  // resolve no entity and carry their own preserved `last`.
  const convo = conversationalTurn(line, ctx);
  if (convo) return convo;

  if (line.startsWith("/")) return withLast(await runCommand(line, ctx));
  // Declarative ACE sentences ("every module is a artifact") ASSERT into tmct's
  // own memory and confirm — they are statements to remember, not graph queries.
  // Gated on memoryDir: only a session shell provides a write target, so a bare
  // runTurn (tests, library callers) stays pure and falls through to the engine.
  if (memoryDir) {
    const asserted = await assertTurn(line, ctx);
    if (asserted) return withLast(asserted);
  }
  // Aggregate/count questions are answered mechanically off the loaded graph header,
  // BEFORE falling through to the ask engine (focus unchanged — a count names no entity).
  const count = answerCount(graph, line);
  if (count != null) {
    // An "I can't count <noun>" from a bare kind may still be answerable from an
    // ASSERTED vocabulary fact ("every class is a type" → "how many types" = the
    // class count). countFromFacts declines on a real graph kind, so ordinary
    // counts are unaffected; it only speaks for a remembered object noun.
    const viaFact = memoryDir ? await countFromFacts(graph, memoryDir, line) : null;
    if (viaFact != null) return withLast(plainTurn(line, viaFact, { via: "fact", focus }));
    return withLast(plainTurn(line, count, { via: "count", focus }));
  }
  return withLast(await runAsk(line, ctx));
}

// ---- W3: seedMemory → bootstrap (first run in a graph-less repo) ----

/** How many corpus facts the first-run bootstrap seeds. Measured curve (dev
 *  laptop, appendFact's read-modify-write per fact): 100→~0.16s, 250→~0.54s,
 *  500→~1.7s — the full 500 stays inside a session-start budget, so the seed
 *  runs synchronously and complete (no partial-sync cap needed). */
export const SEED_LIMIT = 500;

/** Which predicates the capped seed prefers (stable order — see seedMemory's
 *  `prefer`): the definitional band first, so a bootstrap's 500 facts answer
 *  "what is a cache?"-style vocabulary questions rather than location trivia. */
export const SEED_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];

/** The seed marker: its presence means this repo's memory already carries the
 *  corpus seed, so re-runs skip without even reading the slice. */
export const SEED_MARKER_REL = join(".tmct", "memory", "corpus-seed.json");

/** Seed the ConceptNet slice into <repo>/.tmct/memory once. Idempotent twice
 *  over (the marker short-circuits; seedMemory itself content-hashes fact ids)
 *  and failure-tolerated: a missing/broken corpus degrades to the unseeded
 *  bootstrap — never an error before the prompt. Returns seedMemory's
 *  { appended, skipped, total } on a fresh seed, null when skipped/failed. */
async function seedBootstrapMemory(repo) {
  const marker = join(repo, SEED_MARKER_REL);
  try {
    await readFile(marker, "utf8");
    return null; // already seeded — the marker is authoritative
  } catch { /* no marker → first run */ }
  try {
    const { seedMemory } = await import("./corpus/conceptnet.mjs");
    const res = await seedMemory(repo, { limit: SEED_LIMIT, prefer: SEED_PREFER });
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, JSON.stringify({
      seededAt: new Date().toISOString(), limit: SEED_LIMIT, appended: res.appended, skipped: res.skipped,
    }) + "\n");
    return res;
  } catch {
    return null; // corpus unavailable — bootstrap proceeds unseeded
  }
}

/** Trim a focus label for the prompt so a long module path can't run the line off. */
const shortLabel = (l) => { const s = String(l); return s.length > 40 ? "…" + s.slice(-39) : s; };
const promptFor = (focus) => (focus ? `tmct(${shortLabel(focus.label)})> ` : PROMPT);

/**
 * The SESSION SINK — everything a chat shell (readline below, the Ink TUI, any
 * future surface) must share so the on-disk session contract stays identical no
 * matter what draws the screen:
 *
 *   - repo/config resolution (git root default, --repo override) + the one-time
 *     graph load and banner strings;
 *   - the transcript log + structured sidecar file creation and per-turn
 *     writeLog → writeSidecar → upsertGraph sequencing. THE ORDER IS LOAD-BEARING:
 *     the memory side-write (sessions.mjs) recovers each turn's ANSWER text by
 *     re-reading the transcript keyed by turnKey(record.ts, query), so the log
 *     line must be flushed before the graph upsert runs, and logLines[0] must be
 *     the record's ts (runTurn guarantees that);
 *   - opt-in telemetry and the end-of-session close (end lines, final upsert,
 *     stream flush).
 *
 * THE CALLER-OWNED HANDLE (PLAN_REPOSITORY_INTERFACE §"The in-process lifecycle").
 * The returned object IS the session handle — created here, disposed by the caller
 * (`close()`), with NO process-global state. All of a session's between-turn state
 * lives on the handle: the mutable `focus` and `lastAnswer` (closure-private, read
 * through getters) and the read-only `memoryDir`, `graph`, `config` and `lexicon`.
 *   - CREATE: `const s = await createSession({ repoPath })` — resolves repo/config,
 *     loads the graph + lexicon once, opens the log/sidecar streams, seeds first-run
 *     memory. Cheap to hold; a session is one repo's worth of chat.
 *   - DISPOSE: `await s.close()` — idempotent; flushes both artifacts and the final
 *     graph upsert (which triggers the memory fold). A dropped handle leaks only its
 *     two write streams, so callers SHOULD close; a second close is a no-op.
 *   - RE-ENTRANCY / CONCURRENCY: two handles never clobber each other. Each owns its
 *     own `focus`/`lastAnswer`/streams/`sessionId`; the only cross-handle sharing is
 *     the IMMUTABLE lexicon (a cached read-only singleton) and the read-through
 *     provider graph — neither is mutated by a turn, so concurrent handles over the
 *     same or different repos run isolated. Proven by test/chat-session.test.mjs.
 *
 * Returns { repo, config, graph, lexicon, memoryDir, moduleCount, version, sessionId,
 * logFile, sidecarFile, bannerLines, empty, focus, lastAnswer, turns, promptFor(),
 * turn(line), close() }. `turn(line)` runs one dispatched turn through runTurn and the
 * full sink sequencing, returning { answer, end, prompt }; `close()` is idempotent.
 */
export async function createSession({
  repoPath,
  source = defaultSource,
  env = process.env,
  cwd = process.cwd(),
  gitRoot = gitToplevel,
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

  // Load the graph once up front — the banner needs the module count, and focus/`it`
  // resolution and contextId threading need it in hand. A missing artifact loads as
  // the empty bootstrap graph (source.mjs) — the banner says so; never an error.
  const graph = parseEntities(await source.fetchEntities(config));
  const moduleCount = graph.individuals.filter((i) => (i.class || "") === "Module").length;
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  // Load this handle's lexicon once (the immutable cached core vocabulary the ACE
  // assert path parses against). Threaded into every turn so the grammar layer never
  // re-imports per turn; failure-tolerated — a broken lexicon degrades to the lazy
  // per-turn load inside assertTurn, never an error before the prompt.
  let lexicon = null;
  try { const { loadLexicon } = await import("./grammar/lexicon.mjs"); lexicon = loadLexicon(); }
  catch { lexicon = null; }

  // Opt-in telemetry (default OFF → null → the sink's `tel?.record` is a no-op, and
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
  // Awaited writes: each chunk is handed to the OS before the turn completes, so a
  // killed session keeps everything up to the last completed turn — in both files.
  const flush = (s, text) =>
    new Promise((resolve, reject) => s.write(text, (e) => (e ? reject(e) : resolve())));
  const writeLog = (text) => flush(stream, text);
  const writeSidecar = (obj) => flush(sidecar, JSON.stringify(obj) + "\n");

  const startIso = new Date().toISOString();
  await writeLog(`# tmct chat ${version} — session started ${startIso} — repo ${repo}\n\n`);
  await writeSidecar({ type: "session", id: sessionId, started: startIso, repo, tmctVersion: version });

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

  const empty = graph.individuals.length === 0;
  // W3: FIRST RUN in a graph-less repo seeds a capped ConceptNet slice into
  // .tmct/memory so vocabulary questions ("what is a cache?") have something
  // honest to stand on from turn one. Guarded three ways: only the empty
  // bootstrap (a fixture/provider graph never seeds), only once (the marker),
  // and never when TMCT_NO_SEED=1 opts out.
  let seeded = null;
  if (empty && String(env.TMCT_NO_SEED || "") !== "1") {
    seeded = await seedBootstrapMemory(repo);
  }
  const bannerLines = [
    empty
      // Empty-graph bootstrap: honest-miss messaging, never an error before the prompt.
      ? `tmct chat — ${repo} — no graph loaded — starting empty; ` +
        `the conversation is remembered to ${DEFAULT_GRAPH_REL} — log ${logFile}`
      : `tmct chat — ${repo} — ${moduleCount} module(s) — log ${logFile}`,
    // the honest seed line appears ONLY on the run that actually seeded
    ...(seeded ? [`seeded ${seeded.appended} starter facts from the ConceptNet slice — /memory to inspect`] : []),
    "pass --repo <path> to target a different repo",
    "ask a question, or /help for commands (/stats for an overview) — /exit to leave",
  ];

  let turns = 0;
  let focus = null; // the current focus entity ({id,label}) — threaded turn to turn
  let last = null;  // the last dispatched answer ({query,answer,detail}) — why/say-more re-renders it
  let closed = false;

  return {
    repo, config, graph, lexicon, memoryDir: repo, moduleCount, version, sessionId,
    logFile, sidecarFile, bannerLines, empty,
    // Mutable between-turn state — read-only to the caller, so a shell can render the
    // prompt/expand-hint without reaching into runTurn's threading.
    get focus() { return focus; },
    get lastAnswer() { return last; },
    get turns() { return turns; },
    promptFor: () => promptFor(focus),

    /** One dispatched turn through the FULL sink sequencing (writeLog → writeSidecar
     *  → telemetry → upsertGraph, in that exact order). Returns { answer, end, prompt }. */
    async turn(line) {
      const { answer, logLines, record, focus: nextFocus, last: nextLast, end } =
        await runTurn(line, { config, source, graph, focus, last, memoryDir: repo, sessionId, env, lexicon });
      focus = nextFocus;
      last = nextLast;
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
      return { answer, end: Boolean(end), prompt: promptFor(focus) };
    },

    /** End-of-session close: end lines in both artifacts, the final graph upsert
     *  (which also triggers the memory fold), stream flush. Idempotent. */
    async close() {
      if (closed) return;
      closed = true;
      const endIso = new Date().toISOString();
      await writeLog(`${endIso}\n> /exit\nsession end ${endIso}\n`);
      await writeSidecar({ type: "end", ts: endIso });
      await upsertGraph(endIso);
      await new Promise((resolve) => stream.end(resolve));
      await new Promise((resolve) => sidecar.end(resolve));
    },
  };
}

/**
 * The interactive readline shell over createSession — the `--plain` surface and
 * the scripted-test surface. Streams are injectable so tests run sessions
 * without a TTY. A repo with NO graph artifact is not an error: the session
 * starts from the empty bootstrap graph (the banner says so honestly) and the
 * first turn's fold-in creates .tmct/graph.json from the conversation itself.
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
} = {}) {
  const session = await createSession({ repoPath, source, env, cwd, gitRoot });

  const dim = (s) => (env.NO_COLOR || !output.isTTY ? s : `\x1b[2m${s}\x1b[0m`);
  for (const line of session.bannerLines) output.write(dim(line) + "\n");

  const rl = createInterface({ input, output, prompt: PROMPT });
  rl.on("SIGINT", () => rl.close()); // Ctrl+C behaves like /exit (clean close, log flushed)
  let closed = false;
  rl.on("close", () => { closed = true; });
  const prompt = () => { if (!closed) rl.prompt(); }; // input may end while a turn is in flight

  prompt();
  for await (const raw of rl) { // Ctrl+D / closed stdin ends the iteration cleanly
    const line = raw.trim();
    if (line === "/exit") break;
    if (line) {
      const { answer, end, prompt: nextPrompt } = await session.turn(line);
      output.write(answer + "\n");
      rl.setPrompt(nextPrompt);
      if (end) break; // a conversational "bye"/"goodbye" — clean end, same as /exit
    }
    prompt();
  }
  rl.close();

  await session.close();
  return { logFile: session.logFile, sidecarFile: session.sidecarFile, turns: session.turns };
}
