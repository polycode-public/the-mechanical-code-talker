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
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { dispatchTool } from "./server.mjs";
import { loadConfig, DEFAULT_GRAPH_REL } from "./config.mjs";
import { parseEntities, edgesOfKind, renderAuthorCard, renderAuthorTouches, renderCommitAuthor } from "./codegraph.mjs";
import { SESSIONS_DIR_REL, appendSessionToGraph } from "./sessions.mjs";
import { uuidv7 } from "./uuid.mjs";
import { createTelemetry } from "./telemetry.mjs";
import * as defaultSource from "./source.mjs";
import { loadTemplates, render as renderTemplate } from "./corpus/templates.mjs";
import { finish } from "./finish.mjs";
import { VERB_TO_KIND, WHERE_MARKERS, MENTION_MARKERS, ENTITY_TO_TYPE } from "./ask-vocab.mjs";
import { COUNTERFACTUAL_RE } from "./interpret/normalize.mjs";
import { fuzzyMatchInSet, fuzzyBound } from "./interpret/fuzzy.mjs";

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

// ---- narrate mode (opt-in, developer/debug-facing) -------------------------
// "in the tmct interface let's be a lot more verbose, you and I are the only
// users" — a narrative of decision points, the matched pattern, the results +
// sources, and a deduced per-turn goal, appended to the answer. OFF by default
// (a `/narrate on`/`/narrate off` toggle, or a `--narrate`/TMCT_NARRATE=1
// session start): the DEFAULT (narrate:false) path must stay byte-identical
// to before this feature existed, so every site below is a cheap `trace?.push`
// no-op when tracing is off — runTurn only allocates the `trace` array at all
// when narrate is true. Design: a single mutable `trace` array threaded
// through runTurn -> runAsk/runCommand/conversationalTurn (via `ctx.trace`);
// each stage pushes plain, already-formatted lines tagged with their own
// category prefix ("goal:", "lane:", "pattern:", "result:", "source:",
// "intermediate:") — the trace array IS the narrative, in decision order; no
// separate structured side-channel to keep in sync. renderNarration (below,
// next to runTurn) buckets by that prefix into the sections the operator
// asked for and appends the block under NARRATE_MARKER, AFTER finish() and
// OUTSIDE of `last.answer` — so a narrated turn's repeat-detection / why-
// re-render logic (which compares `last.answer` bytes) is unaffected by
// whether narrate happens to be on.
export const NARRATE_MARKER = "--- narrate ---";

/** Push one narrative line, only when tracing is on (`trace` is the mutable
 *  array runTurn allocates for a narrate:true turn, else null/undefined). */
function note(trace, text) { if (trace) trace.push(text); }

/** relation `kind` (ask-vocab.mjs RELATIONS) -> a short, deterministic
 *  statement of what a person asking that KIND of question is probably after.
 *  Deliberately a small, honest bucket lookup over the query SHAPE the engine
 *  already computed — tmct is no-LLM, so goal deduction is table-driven, never
 *  free-text generation. A kind/shape this table doesn't recognise falls
 *  through to a generic line in deduceGoalFromParsed, never a fabricated guess. */
const GOAL_BY_KIND = {
  imports: "understand a dependency/import relationship",
  uses: "understand a dependency/usage relationship (imports and/or calls)",
  calls: "understand a call relationship",
  callsSymbol: "understand a call relationship",
  defines: "locate what a module/class defines",
  contains: "understand class membership (methods/attributes)",
  tests: "assess test coverage",
  inherits: "understand a class hierarchy/inheritance relationship",
  touches: "understand commit/change history",
  touchesSymbol: "understand commit/change history",
  cochange: "understand change-coupling between modules",
  reexports: "understand a module's public exports/API surface",
};
const goalNoun = (entityType) => (entityType ? `${String(entityType).toLowerCase()}(s)` : "entities");

/** Deduce a one-line goal statement from the ask engine's parsed AST — either
 *  the plain-clause form ({shape,kind,entityType,object[,subject]}) or the
 *  compositional form ({node:...}, ask.mjs's §compositional grammar). Returns
 *  null when there's nothing to bucket on (no parse stood at all); the caller
 *  supplies its own honest "didn't resolve" wording in that case. */
function deduceGoalFromParsed(parsed) {
  if (!parsed) return null;
  const { node, shape, kind } = parsed;
  if (node === "find") return `locate a specific named entity ("${parsed.term}")`;
  if (node === "count") return `get a count of ${goalNoun(parsed.entityType)}`;
  if (node === "list") return `list/enumerate ${goalNoun(parsed.entityType)} matching a condition`;
  if (node === "superlative") return `rank/compare ${goalNoun(parsed.entityType)} by ${parsed.metricNoun || parsed.metric || "a metric"}`;
  if (node === "anaphora") return "follow up on the previous answer's result set (discourse anaphora)";
  if (node === "membership") return `understand "${parsed.term || "an entity"}"'s membership/relationship`;
  if (node === "clause") return deduceGoalFromParsed(parsed.clause);
  if (node === "miss") return null;
  if (node === "boolean" || node === "qualifier" || node === "reverseSet" || node === "forwardSet" || node === "allOfClass" || node === "temporal") {
    const k = kind || parsed.inner?.kind;
    return k && GOAL_BY_KIND[k] ? GOAL_BY_KIND[k] : `filter/traverse ${goalNoun(parsed.entityType)} by a relationship`;
  }
  // plain (non-compositional) clause
  if (shape === "meta") return `understand a vocabulary/definition term ("${parsed.object}")`;
  if (shape === "where") return `locate where something is defined ("${parsed.object}")`;
  if (shape === "when") return "understand when something last changed (history)";
  if (shape === "mentions") return `find where something is mentioned in prose ("${parsed.object}")`;
  if (shape === "ask") return (kind && GOAL_BY_KIND[kind]) || "check a specific subject/object relationship";
  if ((shape === "reverse" || shape === "forward") && kind) return GOAL_BY_KIND[kind] || `understand a "${kind}" relationship`;
  return "understand a graph relationship";
}

/** Split the collected trace into buckets by its own leading category tag, so
 *  renderNarration can group like with like while the trace array itself stays
 *  a flat, chronological narrative — no structured side-channel to keep in
 *  sync with the notes pushed at each call site. */
function bucketTrace(trace) {
  const buckets = { goal: [], lane: [], pattern: [], result: [], source: [], intermediate: [] };
  const other = [];
  for (const line of trace) {
    const m = /^([a-z]+):\s/.exec(String(line));
    if (m && buckets[m[1]]) buckets[m[1]].push(line); else other.push(line);
  }
  return { ...buckets, other };
}

/** Render the collected trace into the human-readable block appended to a
 *  narrated turn's answer (see runTurn's withLast — this runs AFTER finish()
 *  and never touches `last.answer`). `fallbackGoal` covers turn types that
 *  push no "goal:" note of their own (a bare slash-command, a count, an
 *  assert) with a generic via-derived line — every narrated turn gets a goal
 *  line, never a silent gap. */
function renderNarration(trace, { record, detail, fallbackGoal }) {
  const b = bucketTrace(trace);
  const lines = [NARRATE_MARKER];
  lines.push(...(b.goal.length ? b.goal : [`goal: ${fallbackGoal}`]));
  lines.push(`decision: via=${record.via || "?"}${record.command ? ` command=/${record.command}` : ""}${record.miss ? " (miss)" : ""}`);
  lines.push(...b.lane, ...b.pattern);
  if (detail?.traversal) lines.push(`result: traversal — ${detail.traversal}`);
  if (Array.isArray(detail?.matches) && detail.matches.length) {
    const shown = detail.matches.slice(0, 5).map((m) => `${m.label}${m.type ? ` [${m.type}]` : ""}`);
    lines.push(`result: ${detail.matches.length} match(es) — ${shown.join(", ")}${detail.matches.length > shown.length ? ", …" : ""}`);
  }
  if (Array.isArray(record.resolvedIds) && record.resolvedIds.length) {
    lines.push(`result: resolved entity id(s) — ${record.resolvedIds.join(", ")}`);
  }
  if (Array.isArray(record.answeredIds) && record.answeredIds.length && record.answeredIds.length !== (detail?.matches?.length || 0)) {
    lines.push(`result: answered entity id(s) — ${record.answeredIds.join(", ")}`);
  }
  lines.push(...b.result, ...b.source, ...b.intermediate, ...b.other);
  return lines.join("\n");
}

/** Append the narrate-mode block to a turn's OUTWARD-FACING answer/logLines —
 *  used at every runTurn return site, AFTER finish() (or, for a conversational
 *  turn, after its own render). Deliberately never touches `last.answer` /
 *  `last.detail` (the caller builds `last` from the PRE-narration `result`) so
 *  a narrated turn's own repeat-detection and why/say-more re-render (both of
 *  which compare `last.answer` bytes — see ORIENTATION_REPEAT_ONELINER and
 *  renderVerbose) see the exact same text a narrate:false run would have
 *  produced; narrate is purely additive to what's PRINTED, never to what's
 *  REMEMBERED. No-op (returns `result` unchanged, by reference) when `trace`
 *  is null (narrate off) or empty (nothing was traced). */
function withNarration(result, trace, fallbackGoal) {
  if (!trace || !trace.length) return result;
  const narrative = renderNarration(trace, { record: result.record, detail: result.detail, fallbackGoal });
  const answer = `${result.answer}\n\n${narrative}`;
  const logLines = Array.isArray(result.logLines)
    ? result.logLines.map((l) => (l === result.answer ? answer : l))
    : result.logLines;
  return { ...result, answer, logLines };
}

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

/** The individual classes that are FOCUS-WORTHY — the code entities the ENTITY_ARGS
 *  commands (symbol/module/class) name and that "it"/"this" should bind to. A
 *  `Commit`/`Session` (history/provenance) or a `SchemaClass`/`SchemaPredicate`
 *  (vocabulary meta-node) is a real graph individual but NOT a standing antecedent:
 *  it must not silently DISPLACE a code-entity focus, or the next turn's pronoun
 *  binds to the wrong thing (CHATBENCH_0.7.1 B1-pron: "it" → Commit). */
const FOCUS_WORTHY_CLASSES = new Set(["Module", "Function", "Class", "Method", "Attribute", "GlobalVariable"]);

/** Is the individual with this id a focus-worthy code entity? Looks the class up on
 *  the loaded graph (focus objects stay `{id,label}` — the class is never stored on
 *  them, so a caller that deepEquals the focus shape is unaffected). An unknown id
 *  (ext: endpoint, missing) is treated as not-worthy: conservative, so it never
 *  displaces a standing code focus but is freely adopted when there is none. */
const isFocusWorthy = (graph, id) => FOCUS_WORTHY_CLASSES.has(graph?.byId?.get(id)?.class);

/** The focus to carry forward after a turn resolved `ent`. A newly-resolved entity
 *  becomes the focus UNLESS it is not focus-worthy (a Commit/Session/schema node)
 *  AND there is already a standing focus-worthy (code) focus — in which case the
 *  standing code focus holds. So a query whose object resolves to a Commit never
 *  hijacks the "it" antecedent from the module/function the user was working on. */
const nextFocus = (graph, focus, ent) =>
  (!focus?.id || isFocusWorthy(graph, ent.id) || !isFocusWorthy(graph, focus.id)) ? ent : focus;

/** System-command words that a forgiving shell accepts WITHOUT the leading "/":
 *  `stats`, `memory`, `describe X`, `members X`, … all work bare. "help" is left
 *  out on purpose — bare "help" stays the friendly orientation; "/help" is the
 *  full command list. */
const COMMAND_WORDS = new Set(["stats", "memory", "focus", ...Object.keys(COMMANDS)]);

/** Query connectives that mark a line as a COMPOSITIONAL question the ask engine
 *  should own, even when it happens to start with a command word ("untested modules
 *  IMPORTING x", "find functions THAT CALL y"). Their presence blocks slash-routing. */
const QUERY_CONNECTIVES = /\b(that|which|and|or|imports?|importing|calls?|calling|uses?|using|covers?|covering|tests?|testing|touch(?:es|ed|ing)?|inherits?|of|with|from|into|by|most|least)\b/i;

// ---- "find" routing precedence (PLAN_PREDICATE_QUERIES.md) — /find (COMMANDS,
// tmct_search: a plain lexical search) predates the ask engine's newer
// predicate-find grammar (parseFind, ask.mjs: "find [me] a/the <term>
// <entityType>" or "find [me] a/the <entityType> named/called/… <term>",
// type-filtered ∧ fuzzy property-match — reuses ENTITY_TO_TYPE/LIST_SKIP
// exactly as parseList does). Both now claim a bare "find …" line, so
// asBareCommand must pick ONE deterministically — not by incidental word
// count (a 3-word tail used to fall to the OLD /find while an otherwise
// identical 4-word tail fell to the NEW grammar: "find the widget class" vs
// "find me the payment class"). Precedence: when the tail names a real
// listable entity type in one of parseFind's own two closed shapes, that IS
// the predicate-find grammar's trigger — defer to it (return null) regardless
// of length; otherwise (no entity-type noun — a plain name/keyword search)
// /find keeps its original tmct_search routing. ----
const FIND_LIST_SKIP = new Set(["the", "a", "an", "all", "me", "us"]);
const FIND_LINKERS = new Set(["called", "named", "about", "like", "containing", "matching", "with"]);

/** Does a bare "find …" tail look like the ask engine's predicate-find shape
 *  rather than a plain lexical search? A cheap, read-only proxy for
 *  parseFind's own trigger (ask.mjs is out of this agent's edit scope this
 *  pass — ENTITY_TO_TYPE is the SAME table parseFind validates candidates
 *  against, imported here read-only so both call sites agree on one
 *  vocabulary). Two closed shapes, mirroring parseFind exactly: trailing-type
 *  ("<term…> <entityType>", e.g. "the payment class") and
 *  leading-type-with-linker ("<entityType> <linker> <term…>", e.g. "the class
 *  named Foo"). */
function looksLikePredicateFind(restTok) {
  const toks = restTok.map((w) => w.toLowerCase()).filter((w) => !FIND_LIST_SKIP.has(w));
  if (!toks.length) return false;
  if (ENTITY_TO_TYPE[toks[toks.length - 1]]) return true; // trailing-type
  if (toks.length > 1 && ENTITY_TO_TYPE[toks[0]] && FIND_LINKERS.has(toks[1])) return true; // leading-type-with-linker
  return false;
}

/** A bare leading command word → its slash form ("stats" → "/stats", "describe x"
 *  → "/describe x"), so the system commands are slash-optional. Conservative on the
 *  entity/arg commands: it routes a bare word or a SHORT name-like argument, but
 *  falls through (returns null) for a multi-word compositional query so the ask
 *  engine still owns things like "untested modules importing a.mjs". Returns null
 *  when the first token is not a command word. */
export function asBareCommand(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("/")) return null;
  const [first, ...restTok] = trimmed.split(/\s+/);
  if (!COMMAND_WORDS.has(first.toLowerCase())) return null;
  const fl = first.toLowerCase();
  const rest = restTok.join(" ");
  // Zero-arg system commands are always the command; a bare command word is too.
  if (!rest || fl === "stats" || fl === "memory") return `/${trimmed}`;
  // "find" (only — "search", its /find-tool alias, keeps its original behavior
  // unconditionally): the predicate-find grammar's own shape wins regardless of
  // word count, see the precedence note above.
  if (fl === "find" && looksLikePredicateFind(restTok)) return null;
  // A NO-ARGUMENT command word ("untested") with trailing words is NOT a command
  // call — the /untested tool takes no argument and would silently drop the qualifier,
  // listing MODULES for "untested classes". "untested classes" / "untested modules"
  // is a kind-FILTERED query the ask engine answers correctly (Base, Button for
  // classes) AND, as a listing, seeds discourse-count anaphora ("count them",
  // "how many of those are tested") with its match set — the CHATBENCH_0.7.1
  // discourse-count tier-1 misses (g-b1-disc-count-22/-3). Fall through to the engine.
  if (COMMANDS[fl]?.arg == null && rest) return null;
  // Arg commands: route only a short, name-like argument (no query connectives),
  // so "describe Widget" / "members my class" route but a compositional query does not.
  if (restTok.length <= 3 && !QUERY_CONNECTIVES.test(rest)) return `/${trimmed}`;
  return null;
}

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

// ---- memory-store counts (the .tmct/memory graph, distinct from the code graph
// answerCount reads) — so "how many facts do you know" is answerable, consistent
// with what `/memory` advertises. The code graph owns the structural kinds
// (classes/functions/modules/…); the memory store owns Facts + Utterances. Sessions
// stay with answerCount (chat writes Session individuals into the code graph as
// first-class temporal data — see sessions.mjs), so this never shadows them. ----

/** Nouns that name a MEMORY-STORE individual class, → the class to count. */
const MEMORY_COUNT_NOUNS = {
  fact: "Fact", facts: "Fact",
  utterance: "Utterance", utterances: "Utterance", said: "Utterance",
};
const MEMORY_CLASS_LABELS = { Fact: ["fact", "facts"], Utterance: ["utterance", "utterances"] };

/** Recognise a memory-store count question and answer it by loading the memory
 *  graph, or null (→ answerCount / the ask engine own it). Handles "how many facts",
 *  "how many utterances", and the bare "how many do you know" (→ facts). Lazy +
 *  failure-tolerated: no memory / a broken store → null, so the honest fall-through
 *  stands. */
async function answerMemoryCount(memoryDir, query) {
  if (!memoryDir) return null;
  const q = String(query).toLowerCase();
  let cls = null;
  // the bare "how many do you know" (no explicit noun) defaults to remembered facts
  if (/\bhow many(?:\s+(?:things?|facts?))?\s+(?:do|d'?)\s+(?:you|u)\s+know\b/.test(q)) cls = "Fact";
  if (!cls) {
    const m = q.match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/);
    if (m) cls = MEMORY_COUNT_NOUNS[m[1]] || null;
  }
  if (!cls) return null;
  let loadMemory;
  try { ({ loadMemory } = await import("./memory/core.mjs")); } catch { return null; }
  let mem;
  try { mem = await loadMemory(memoryDir); } catch { return null; }
  const n = (mem.individuals || []).filter((i) => (i.class || "") === cls).length;
  const [sing, plur] = MEMORY_CLASS_LABELS[cls];
  return `${n} ${n === 1 ? sing : plur}.`;
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

/** CAPABILITY questions ("what can you do") — distinct from IDENTITY questions
 *  ("who are you") below. Both used to be conflated into one HELP_PHRASES list,
 *  which meant "who are you" always got the "here's what I can query" blurb and
 *  never a self-description — split so each gets the answer it actually asked for. */
const CAPABILITY_PHRASES = [
  /^what can (you|u) do\??$/i, /^what do you do\??$/i, /^help( me)?\??$/i, /^\?+$/,
  /^how do (i|you) work\??$/i, /^how does (this|it) work\??$/i,
  // unix-habit openers typed inside the REPL out of muscle memory — argv-only
  // today (bin/tmct.mjs), dead once inside the chat loop; route to the same
  // capability answer a plain "help" gets.
  /^--help$/i, /^-h$/i, /^man( tmct)?\??$/i,
];
/** IDENTITY questions — "who/what are you", by name, in plain or ESL-ish phrasing.
 *  Routed to a self-description (identity-self) that works regardless of graph
 *  state, never the code-graph deflection. */
const IDENTITY_PHRASES = [
  /^who are you\??$/i, /^what (is|are|r) (this|you)\??$/i,
  /^what('?s| is) your name\??$/i, /^what exactly are you\??$/i,
  /^(tell me about|introduce) yourself\??$/i, /^what is this thing\??$/i,
  /^what am i (talking|speaking|chatting) (to|with)\??$/i,
  /^you are what\??$/i, /^what thing (are|is) you\??$/i,
  /^explain( to me)? what (you are|this is)\??$/i,
  /^whoami\??$/i,
];
/** "Are you an LLM/AI/bot" — tmct's actual positioning (no LLM, deterministic) is
 *  a genuinely different, more specific answer than the generic self-description,
 *  and this is a very likely first question given how most chat tools work today. */
const AI_IDENTITY_PHRASES = [
  /^(are you|r u) (an? )?(ai|a bot|chatgpt|gpt|an? llm|a language model|a robot)\??$/i,
  /^is this (chatgpt|gpt|claude|an? ai|an? llm)\??$/i,
  /^do you use ai\??$/i, /^what language model are you( using)?\??$/i,
  /^am i (talking|speaking|chatting) (to|with) a (real )?(person|human|bot|ai)\??$/i,
];
/** The structural verbs/nouns that mark a near-miss code question (→ keep the
 *  precise grammar hint, not the friendly nudge). */
const STRUCT_WORDS = new Set([
  "import", "imports", "call", "calls", "use", "uses", "define", "defines", "defined",
  "class", "classes", "function", "functions", "module", "modules", "method", "methods",
  "subclass", "subclasses", "inherit", "inherits", "test", "tests", "touch", "touches",
  "commit", "commits", "export", "exports", "caller", "callers", "callee", "callees",
  "history", "where", "mentioned", "signature", "impact",
  // relation-concept vocabulary (gerunds + relation nouns) so a SHORT relation touch
  // ("what is calling", "what about inheritance") is a structural question, not
  // small-talk — otherwise a ≤3-word relation touch is grabbed by the conversational
  // orientation before the relation concept force can serve it.
  "importing", "calling", "invoking", "inheriting", "containing", "contains", "containment",
  "testing", "defining", "touching", "extending", "inheritance", "coverage", "member", "members",
]);

/** Is this raw/normalized query "code-ish" (a dotted/pathed/CamelCase name, "()",
 *  or a structural keyword)? Shared by isConversational and the fuzzy-typo fallback
 *  so neither ever grabs a genuine near-miss structural question. */
function looksCodeish(raw, q) {
  return /[a-z][A-Z]|[_./]|\(\)/.test(raw) || q.split(/\s+/).some((w) => STRUCT_WORDS.has(w));
}

/** Does this look like small-talk / an orientation request rather than a
 *  (near-miss) structural question? Greetings & help/identity phrases always
 *  qualify; a very short input with no code-ish token does too. */
export function isConversational(query) {
  const raw = String(query).trim();
  const q = raw.toLowerCase().replace(/[.!?]+$/, "").trim();
  if (GREET.has(q) || THANKS.has(q) || OK_ACK.has(q)) return true;
  if (CAPABILITY_PHRASES.some((re) => re.test(raw))) return true;
  if (IDENTITY_PHRASES.some((re) => re.test(raw))) return true;
  if (AI_IDENTITY_PHRASES.some((re) => re.test(raw))) return true;
  const codeish = looksCodeish(raw, q);
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
/** Empty / degenerate-graph variants (#3/#5): shown when the loaded graph has 0
 *  modules (a graph-less bootstrap OR a graph.json with no code entities). They
 *  orient toward `--repo`/`tmct init` + the seeded vocabulary instead of
 *  over-promising "ask me about this codebase". */
const T_GREETING_EMPTY = "conversational-greeting-empty";
const T_ORIENTATION_EMPTY = "orientation-empty";
/** IDENTITY answers — self-description and the "no LLM" clarification. Both work
 *  regardless of graph state (no empty/populated variant): what tmct IS doesn't
 *  depend on whether a repo is loaded. */
const T_IDENTITY_SELF = "identity-self";
const T_IDENTITY_NOT_LLM = "identity-not-an-llm";
/** THE CONCEPT FORCE (concept.mjs): the three-band answer to a vague "what is a X"
 *  that names a known concept WITH instances — {definition}/{examples}/{followups}. */
const T_CONCEPT = "concept-force";

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

/** Greetings → a short friendly line + one nudge. A couple carry a tasteful nod.
 *  Deliberately broad across register/dialect (UK/US/AU/NZ, formal, slang, texting
 *  abbreviation) — a CLOSED curated list, same "never guess" ethos as the rest of
 *  the file, just a bigger one; see collapseRuns/fuzzyMatchInSet below for the
 *  typo/elongation multiplier layered on top instead of enumerating every typo. */
const GREET = new Set([
  "hi", "hello", "hey", "yo", "hiya", "howdy", "sup", "greetings",
  "g'day", "gday", "hey there", "hi there", "hello there",
  "good morning", "good afternoon", "good evening", "morning",
  // UK/AU/NZ
  "alright", "you alright", "alright mate", "morning all", "yeah nah",
  // US
  "hey y'all", "howdy there", "hiya there",
  // formal
  "good day", "salutations", "good to meet you", "pleased to meet you",
  // slang
  "yo yo", "ayy", "wassup", "sup fam", "heya", "hiya!",
  // texting abbreviation
  "gm", "ge",
]);
/** Acknowledgements → an "any time" style reply. */
const THANKS = new Set([
  "thanks", "thank you", "thankyou", "thx", "ty", "ta", "cheers", "nice one",
  "much appreciated", "cool thanks", "many thanks", "much obliged", "ta very much",
  "cheers mate", "cheers for that", "tks", "sweet thanks", "nice",
]);
/** Farewells → a goodbye AND a clean end of session (same path as /exit). */
const BYE = new Set([
  "bye", "goodbye", "quit", "exit", "see ya", "see you", "cya", "later", "farewell",
  "peace", "peace out", "im off", "i'm off", "gtg", "gotta go", "catch you later",
  "good day to you", "farewell then",
]);
/** Elaboration asks → RE-RENDER the last answer verbosely (traversal + matches). */
const WHY = new Set([
  "why", "how", "how so", "how come", "explain", "say more", "go on",
  "elaborate", "tell me more", "more detail", "expand",
]);
/** Bare acknowledgements — routed identically to THANKS (an "ok"/"cool" after an
 *  answer reads the same as a thanks, not a new question). Kept separate from
 *  THANKS/GREET because these aren't greetings or gratitude, just closing a beat. */
const OK_ACK = new Set([
  "ok", "okay", "cool", "aight", "fair enough", "got it", "gotcha", "noted",
  "sounds good", "sure", "cool cool", "right",
]);
/** New-user / confused openers — "I don't know what this is" reads as an
 *  orientation request, not small-talk and not a grammar-wall near-miss; routed
 *  the same as CAPABILITY_PHRASES (→ orientationAnswer). */
const ORIENT_OPENERS = new Set([
  "what", "huh", "confused", "i dont know what this is", "i don't know what this is",
  "i'm lost", "im lost", "no idea what this does", "just installed this",
  "just installed you", "i just installed this", "i just installed you",
  "first time here", "just started", "new to this", "new here",
]);

// (Greeting/thanks/farewell wording moved to data/templates/responses.jsonl — W1.
// The expression-specific greeting variants map through T_GREETING_BY_PHRASE above.)

/** Aggressive char-run collapse (2+ identical chars → 1) — used ONLY to build a
 *  lookup key, never to change what's actually said back. Lets a typed-out
 *  elongation ("heyyyy", "hellooo", "thanksss") match its canonical phrase for
 *  free: both the canonical phrase and the elongated input collapse to the same
 *  key (a legitimate double letter like "hello"'s "ll" collapses identically on
 *  both sides, so there's no canonical/typed asymmetry to get wrong). */
const collapseRuns = (s) => s.replace(/(.)\1+/g, "$1");

/** phrase(collapsed) → canonical phrase, built once per closed set. */
function collapsedIndex(set) {
  const idx = new Map();
  for (const phrase of set) if (!idx.has(collapseRuns(phrase))) idx.set(collapseRuns(phrase), phrase);
  return idx;
}
const GREET_COLLAPSED = collapsedIndex(GREET);
const THANKS_COLLAPSED = collapsedIndex(THANKS);
const BYE_COLLAPSED = collapsedIndex(BYE);

/** Exact match, else the elongation-collapsed match, else null — the canonical
 *  phrase either way, so callers never see the raw (possibly elongated) input. */
function closedOrCollapsed(q, set, idx) {
  if (set.has(q)) return q;
  return idx.get(collapseRuns(q)) ?? null;
}

/** The fuzzy-typo fallback's candidate pool: every canonical phrase across the
 *  closed conversational sets, flattened once. Consulted only after every exact/
 *  collapsed lookup misses (see fuzzyConversationalMatch). */
const CONVERSATIONAL_PHRASES = [
  ...GREET, ...THANKS, ...BYE,
  "what can you do", "what do you do", "help", "how do you work",
  "who are you", "what are you", "what is your name",
];
function classifyConversational(phrase) {
  if (GREET.has(phrase)) return "greet";
  if (THANKS.has(phrase)) return "thanks";
  if (BYE.has(phrase)) return "bye";
  if (phrase === "who are you" || phrase === "what are you" || phrase === "what is your name") return "identity";
  return "capability";
}
/** UNIQUE within-bound fuzzy match of the whole trimmed line against
 *  CONVERSATIONAL_PHRASES — the "helo"/"thnx"/"wat r u"/"byee" tier. Restricted to
 *  short (≤4-word), non-code-ish inputs (looksCodeish, shared with
 *  isConversational) so a genuine near-miss structural question is never grabbed;
 *  a distance tie is refused, never guessed (same discipline as fuzzyVocabWord). */
function fuzzyConversationalMatch(raw) {
  const q = collapseRuns(raw.toLowerCase().replace(/[.!?]+$/, "").trim());
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4 || looksCodeish(raw, q)) return null;
  return fuzzyMatchInSet(q, CONVERSATIONAL_PHRASES, Math.min(2, fuzzyBound(q)));
}

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
  const t = (id, slots = {}) => tRender(ctx.templates, id, slots) ?? TEMPLATES_UNAVAILABLE;
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
  if (BYE.has(q)) {
    note(ctx.trace, "goal: casual/social — ending the session (no graph intent)");
    note(ctx.trace, "lane: conversational — farewell (BYE closed set)");
    return mk(t(T_FAREWELL), { end: true });
  }
  if (WHY.has(q)) {
    note(ctx.trace, "goal: elaborate on the previous answer (why/say-more)");
    note(ctx.trace, "lane: conversational — why/say-more (WHY closed set)");
    const v = renderVerbose(ctx.last);
    // The empty-state hint is template wording (via:"template", the data row wins;
    // renderVerbose's own string is the degraded fallback for direct library callers).
    // A real expansion re-renders the LAST ANSWER — its wording is the prior answer's,
    // not a template's, so it carries via:"conversational".
    if (v.empty) {
      note(ctx.trace, "intermediate: no previous answer held on ctx.last — nothing to expand");
      return mk(tRender(ctx.templates, T_WHY_EMPTY) ?? v.text, { miss: true });
    }
    note(ctx.trace, `result: re-rendering the previous answer to "${ctx.last?.query ?? "?"}" verbosely`);
    return mk(v.text, { via: "conversational" });
  }
  {
    const greetHit = closedOrCollapsed(q, GREET, GREET_COLLAPSED);
    if (greetHit) {
      note(ctx.trace, "goal: casual/social — greeting, no graph intent");
      note(ctx.trace, `lane: conversational — greeting (GREET closed set${greetHit === q ? "" : ", elongation-collapsed"})`);
      // #3 empty/degenerate-graph greeting: a plain "hi"/"hello" over a graph with 0
      // modules leads with the (now provably-correct) vocabulary hint instead of
      // over-promising "ask me about this codebase". Phrase-specific variants (good
      // morning, hello there) keep their wording; only the default greeting swaps.
      const id = (!T_GREETING_BY_PHRASE[greetHit] && noCodeGraph(ctx.graph)) ? T_GREETING_EMPTY : (T_GREETING_BY_PHRASE[greetHit] || T_GREETING);
      note(ctx.trace, `pattern: template "${id}" (data/templates/responses.jsonl)`);
      return mk(t(id, { vocabHint: ctx.vocabHint }));
    }
  }
  {
    const thanksHit = closedOrCollapsed(q, THANKS, THANKS_COLLAPSED) || (OK_ACK.has(q) ? q : null);
    if (thanksHit) {
      note(ctx.trace, "goal: casual/social — acknowledgement, no graph intent");
      note(ctx.trace, `lane: conversational — thanks/acknowledgement (${OK_ACK.has(q) ? "OK_ACK" : "THANKS"} closed set${thanksHit === q ? "" : ", elongation-collapsed"})`);
      note(ctx.trace, `pattern: template "${T_THANKS}" (data/templates/responses.jsonl)`);
      return mk(t(T_THANKS));
    }
  }
  if (AI_IDENTITY_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — is tmct an AI/LLM (a very likely first question)");
    note(ctx.trace, "lane: conversational — identity/AI (AI_IDENTITY_PHRASES closed set)");
    return mk(t(T_IDENTITY_NOT_LLM));
  }
  if (IDENTITY_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — who/what tmct is, not a capability listing");
    note(ctx.trace, "lane: conversational — identity (IDENTITY_PHRASES closed set)");
    return mk(t(T_IDENTITY_SELF));
  }
  if (q === "help" || q === "?" || CAPABILITY_PHRASES.some((re) => re.test(raw)) || ORIENT_OPENERS.has(q)) {
    note(ctx.trace, "goal: get oriented — what can tmct answer, how do I start");
    note(ctx.trace, "lane: conversational — help/orientation (CAPABILITY_PHRASES/ORIENT_OPENERS / bare help / ?)");
    return mk(orientationAnswer(ctx.templates, ctx.graph, ctx.vocabHint));
  }
  // Fuzzy-typo fallback (A4): every exact/collapsed closed-set lookup above missed —
  // try a bounded edit-distance match against the flattened conversational phrase
  // pool ("helo", "thnx", "wat r u", "byee"), restricted to short non-code-ish
  // input so a genuine near-miss structural question is never grabbed.
  {
    const fuzzyHit = fuzzyConversationalMatch(raw);
    if (fuzzyHit) {
      const bucket = classifyConversational(fuzzyHit);
      note(ctx.trace, `goal: casual/social or orientation — fuzzy-typo match "${raw}" → "${fuzzyHit}"`);
      note(ctx.trace, `lane: conversational — fuzzy typo tolerance (${bucket})`);
      if (bucket === "bye") return mk(t(T_FAREWELL), { end: true });
      if (bucket === "thanks") return mk(t(T_THANKS));
      if (bucket === "identity") return mk(t(T_IDENTITY_SELF));
      if (bucket === "capability") return mk(orientationAnswer(ctx.templates, ctx.graph, ctx.vocabHint));
      const id = (!T_GREETING_BY_PHRASE[fuzzyHit] && noCodeGraph(ctx.graph)) ? T_GREETING_EMPTY : (T_GREETING_BY_PHRASE[fuzzyHit] || T_GREETING);
      return mk(t(id, { vocabHint: ctx.vocabHint }));
    }
  }
  return null;
}

// ---- #1/#2/#3 conversational-UX helpers: module-aware orientation, the short
// tailored miss, and the intent lanes (teach + meta/self). All are recognizer-
// gated and (for the lanes) only consulted on a would-miss, so ordinary graph
// queries are never hijacked. ----

/** Code entities (Modules) in the loaded graph — the "is there a code graph here"
 *  test. 0 means a graph-less bootstrap OR a graph.json with no code entities (the
 *  degenerate trap); both orient rather than over-promise. */
export function moduleCountOf(graph) {
  if (!graph || !Array.isArray(graph.individuals)) return 0;
  return graph.individuals.filter((i) => (i.class || "") === "Module").length;
}

/** A KNOWN-empty code graph: a loaded graph object with 0 modules. A null graph
 *  (a bare runTurn that wasn't handed one) is "unknown", NOT empty — the empty
 *  orientation/greeting only fires when we actually hold an empty graph. */
const noCodeGraph = (graph) => !!graph && moduleCountOf(graph) === 0;

/** LIVE orientation examples (0.8.2 WS4 wall kindness): the example queries on the
 *  orientation card name entities from the LOADED graph — the sorted-first Module
 *  label and the sorted-first Function/Method label, deterministically — so a
 *  stranger who types them verbatim gets a real answer on ANY graph (the old
 *  hardcoded walk.mjs/buildContextBundle examples miss on every non-tmct graph).
 *  A null (unknown) graph keeps the generic pair byte-for-byte. */
function orientationExamples(graph) {
  const generic = { example1: "walk.mjs", example2: "buildContextBundle" };
  if (!graph || !Array.isArray(graph.individuals)) return generic;
  const minLabel = (labels) => {
    let best = null;
    for (const l of labels) { const s = String(l || ""); if (s && (best === null || s < best)) best = s; }
    return best;
  };
  // "which modules import <example1>" must ANSWER, so prefer a module that IS
  // imported (an `imports` edge object); any module label as the fallback.
  const importedMod = minLabel(edgesOfKind(graph, "imports")
    .filter((e) => (graph.byId?.get?.(e.object)?.class || "") === "Module")
    .map((e) => e.objectLabel || ""));
  const anyMod = minLabel(graph.individuals.filter((i) => (i.class || "") === "Module").map((i) => i.label));
  const example1 = importedMod ?? anyMod ?? generic.example1;
  // "what calls <example2>" must ANSWER, so prefer a Function/Method that HAS a
  // recorded caller (a `callsSymbol` edge object with a real individual), then a
  // module-coarse called module, then any callable label, then example1.
  const calledSym = minLabel(edgesOfKind(graph, "callsSymbol")
    .filter((e) => ["Function", "Method"].includes(graph.byId?.get?.(e.object)?.class || ""))
    .map((e) => e.objectLabel || graph.byId?.get?.(e.object)?.label || ""));
  const calledMod = minLabel(edgesOfKind(graph, "calls")
    .filter((e) => (graph.byId?.get?.(e.object)?.class || "") === "Module")
    .map((e) => e.objectLabel || ""));
  const anyFn = minLabel(graph.individuals
    .filter((i) => i.class === "Function" || i.class === "Method").map((i) => i.label));
  const example2 = calledSym ?? calledMod ?? anyFn ?? example1;
  return { example1, example2 };
}

/** The orientation surface, module-aware: the empty variant (→ the provably-correct
 *  vocabulary hint + --repo/tmct init) when there's no code graph, the standard one
 *  (with live {example1}/{example2} query examples from the loaded graph) otherwise. */
function orientationAnswer(templates, graph, vocabHint) {
  if (noCodeGraph(graph)) return tRender(templates, T_ORIENTATION_EMPTY, { vocabHint }) ?? TEMPLATES_UNAVAILABLE;
  return tRender(templates, T_ORIENTATION, orientationExamples(graph)) ?? TEMPLATES_UNAVAILABLE;
}

/** A minimal, still identity-led fallback for orientationText's empty-graph branch
 *  — used ONLY if the template library itself failed to load (tRender returned
 *  null), matching the file's "never crash, always degrade to one honest line"
 *  ethos. Kept short and hand-written so it never drifts silently. */
const ORIENTATION_EMPTY_FALLBACK = "I'm tmct — a deterministic, offline chat assistant (no LLM). "
  + "For code structure (imports, calls, definitions) point me at a repo with `--repo <path>`, "
  + "or try the shipped example `npm run example:mini`. tmct reads graphs; it doesn't index code itself. /help for commands.";

/** A dynamic orientation string for the meta/self lane: a /stats-style overview
 *  when a code graph is loaded, else the honest empty-graph orientation — rendered
 *  through the SAME template (T_ORIENTATION_EMPTY) conversationalTurn's orientation
 *  branch uses, so there is exactly one copy of that wording to keep in sync, not
 *  two hand-duplicated strings. */
function orientationText(graph, templates, vocabHint) {
  if (noCodeGraph(graph)) {
    return tRender(templates, T_ORIENTATION_EMPTY, { vocabHint }) ?? ORIENTATION_EMPTY_FALLBACK;
  }
  const by = (cls) => (graph.individuals || []).filter((i) => (i.class || "") === cls).length;
  const parts = [];
  for (const [cls, sing, plur] of [["Module", "module", "modules"], ["Class", "class", "classes"], ["Function", "function", "functions"]]) {
    const n = by(cls); if (n) parts.push(`${n} ${n === 1 ? sing : plur}`);
  }
  return `This is a tmct code graph — ${(graph.individuals || []).length} entities`
    + `${parts.length ? ` (${parts.join(", ")})` : ""}. `
    + 'Ask about imports, calls, definitions or history — e.g. "which modules import <name>", "what calls <name>". '
    + "/stats for the full overview, /help for commands.";
}

/** Bug E (0.8.2 follow-up): a friendly, prose-shaped condensation of
 *  renderDescribe's edge counts (codegraph.mjs) — defines/imports/reexports
 *  (outgoing from `ind`) + tests (incoming: who covers `ind`) — capped sample,
 *  matching orientationText's tone rather than reusing /describe's verbose
 *  block verbatim. A capped sample (not the full renderDescribe dump) because
 *  this lane answers a casual "what does X do", not a request for the whole
 *  edge listing (that's what /describe is for — named in the pointer below). */
const MODULE_OVERVIEW_SAMPLE = 3;
function moduleOverviewText(graph, ind) {
  const out = (kind) => edgesOfKind(graph, kind).filter((e) => e.subject === ind.id);
  const sample = (edges) => {
    const labels = edges.slice(0, MODULE_OVERVIEW_SAMPLE).map((e) => e.objectLabel || e.object);
    return edges.length > MODULE_OVERVIEW_SAMPLE
      ? `${labels.join(", ")}, +${edges.length - MODULE_OVERVIEW_SAMPLE} more`
      : labels.join(", ");
  };
  const defines = out("defines");
  const imports = out("imports");
  const reexports = out("reexports");
  const testedBy = edgesOfKind(graph, "tests").filter((e) => e.object === ind.id);
  const parts = [];
  if (defines.length) parts.push(`defines ${defines.length} (${sample(defines)})`);
  if (imports.length) parts.push(`imports ${imports.length} (${sample(imports)})`);
  if (reexports.length) parts.push(`exports ${reexports.length} (${sample(reexports)})`);
  parts.push(testedBy.length
    ? `covered by ${testedBy.length} test module${testedBy.length === 1 ? "" : "s"}`
    : "no recorded tests");
  const cls = (ind.class || "entity").toLowerCase();
  return `${ind.label} is a ${cls} — ${parts.join("; ")}. `
    + `/describe ${ind.label} for the full breakdown.`;
}

// #1 SHORT, TAILORED MISS — the engine's full grammar cheat-sheet (rephraseHint)
// now lives ONLY behind /help. A genuine parse-miss gets ONE line: an honest miss
// + at most two example shapes chosen for what the user typed + a /help pointer.
// The opening "couldn't parse this as a graph question. Try:" is preserved (the
// honest-miss contract + the graded hm-joke case pin those words).
const MISS_EXAMPLES = {
  import: ['"which modules import <name>"', '"what does <name> import"'],
  export: ['"what does <name> export"', '"which modules import <name>"'],
  call: ['"what calls <name>"', '"which functions call <name>"'],
  test: ['"what tests <name>"', '"which functions are tested"'],
  inherit: ['"which classes inherit from <name>"', '"what are the subclasses of <name>"'],
  history: ['"when did <name> change"', '"who touched <name>"'],
  define: ['"where is <name> defined"', '"where is <name> mentioned"'],
  meaning: ['"what is a <ClassName>"', '"what does <term> mean"'],
  count: ['"how many classes are there"', '"how many modules are there"'],
};
const MISS_DEFAULT = ['"which modules import <name>"', '"what calls <name>"'];

/** Choose up to two example shapes RELEVANT to the user's words. */
function tailoredExamples(q) {
  // membership yes/no ("is a algorithm information") — the grammar wants an article
  // before BOTH terms; hint the working shape rather than dumping the wall.
  if (/^is\s+(?:an?\s+)?[\w-]+\b/.test(q)) return ['"is a <thing> a <kind>" (an article before the kind, too)'];
  const has = (re) => re.test(q);
  if (has(/\bimport/)) return MISS_EXAMPLES.import;
  if (has(/\bexport/)) return MISS_EXAMPLES.export;
  if (has(/\b(?:calls?|caller|callee)\b/)) return MISS_EXAMPLES.call;
  if (has(/\b(?:tests?|cover|covering|tested)\b/)) return MISS_EXAMPLES.test;
  if (has(/\b(?:inherit|subclass|extends?|superclass|hierarchy|base class|parent class)\b/)) return MISS_EXAMPLES.inherit;
  if (has(/\b(?:history|when|changed?|commit|touch(?:e[ds])?|who)\b/)) return MISS_EXAMPLES.history;
  if (has(/\b(?:defined?|where|located?|mention)\b/)) return MISS_EXAMPLES.define;
  if (has(/\b(?:mean|means|meaning|definition|vocab)\b/) || /\bwhat(?:'s| is)? an? \w/.test(q)) return MISS_EXAMPLES.meaning;
  if (has(/\b(?:how many|count|number of)\b/)) return MISS_EXAMPLES.count;
  return MISS_DEFAULT;
}

/** The one-line short miss. */
export function shortMissHint(query) {
  const ex = tailoredExamples(String(query || "").toLowerCase());
  return `couldn't parse this as a graph question. Try: ${ex.join(" or ")}. Type /help for all query shapes.`;
}

/** The exact opening of the engine's full grammar-wall miss — the ONLY miss the
 *  short-miss rewrites. Receipt-bearing misses (honest empties, unresolved terms,
 *  the empty-graph bootstrap note, compositional misses) never match, so their
 *  specific wording + traversal receipts stand. Exported: the recall hygiene
 *  (bestQaPair) reuses it so a folded wall answer is never replayed as a memory
 *  (fold.mjs carries its own local copy — the memory layer stays decoupled). */
export const WALL_MISS_RE = /^couldn't parse this as a graph question\. Try:/;

/** WALL_MISS_RE's non-anchored twin: does the grammar-wall opening appear
 *  ANYWHERE in the text, not just at its start? A recall-then-wall's own
 *  `answer` is prefixed with the recall frame ("you asked about this before
 *  (…):\n  Q: …\n  A: …\n\n"), so the wall-repeat check (Bug A root cause 2,
 *  0.8.2 follow-up) that inspects the PREVIOUS turn's `last.answer` needs the
 *  unanchored form to still recognize it as a wall repeat. */
const WALL_MISS_ANYWHERE_RE = /couldn't parse this as a graph question\. Try:/;

// #2 INTENT LANE — MEMORY/TEACH. "remember that X is a Y", "note that …", or a
// bare "X is a Y" declarative the graph parser couldn't handle → route to the
// assert/memory path; when it can't be stored, say what CAN be remembered
// (LOUD, the working shape) — never the grammar wall, never a silent data loss.
// 0.8.2 widens the lane with two NATURAL frames, both reified via appendFact
// with a distinct teach:chat provenance (its own "teach" trust prior):
//   - "remember/note that <X> is <adjective>" → an mgx:hasProperty fact —
//     ONLY under the explicit wrapper (a bare "X is deprecated" is never
//     silently swallowed);
//   - "<Name> owns/maintains <X>" (bare declarative or wrapped) → an
//     mgx:ownedBy fact, read back by "who owns <X>" (factReadBack).
const TEACH_RE = /^(?:please\s+)?(?:remember|note|keep in mind|jot down|for the record|fyi)\b[:,]?\s*(?:that\s+)?(.+?)[.?!]*$/i;
const BARE_DECLARATIVE_RE = /^(?:every |each |all |a |an )?[\w-]+ (?:is|are) (?:a |an )?[\w-]+$/i;
/** Interrogative / auxiliary leads that make an "X is a Y"-shaped line a QUESTION
 *  ("what is a cache", "is a module a component"), never a teach declarative. */
const QUESTION_LEAD_RE = /^(?:what|who|which|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have)\b/i;

// The teach lane's fact predicates (rendered via FACT_PREDICATE_PHRASES).
const OWNED_BY_PREDICATE = "mgx:ownedBy";
const HAS_PROPERTY_PREDICATE = "mgx:hasProperty";

/** "<Name> owns/maintains <X>" — the ownership teach declarative. <Name> is one
 *  or two name tokens, <X> one code-ish token (a path, a file, a symbol). The
 *  BARE form additionally requires a Capitalized name (see teachLane), so
 *  ordinary lowercase prose never lands a fact without the explicit wrapper. */
const OWNS_TEACH_RE = /^([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)\s+(?:owns|maintains)\s+(\S+?)[.!?]*$/;

/** "<X> is <adjective>" — the property teach payload (wrapper-REQUIRED): a lazy
 *  subject and a single bare complement word. Never matches the "is a <noun>"
 *  membership shape (that stays the ACE grammar's), so "remember that cache is
 *  a store" still lands as rdfs:subClassOf, not a property. */
const TEACH_PROPERTY_RE = /^(?:every\s+|each\s+|all\s+|the\s+)?(.+?)\s+(?:is|are)\s+(?!an?\b|the\b)([A-Za-z][\w-]*)$/i;

/** The teach lane's provenance tag — mirrors grammar/assert.mjs's provenanceTag
 *  shape under a distinct "teach:" family, so a taught fact is auditable apart
 *  from the ACE-parsed asserts: teach:chat:<sessionId>@<ts>. core.mjs maps the
 *  tag to a "teach" Source (trust prior in memory/trust.mjs). */
const teachProvenanceTag = (sessionId, ts) => `teach:chat${sessionId ? `:${sessionId}` : ""}${ts ? `@${ts}` : ""}`;

/** Reify one teach-lane fact + confirm (shared by the property and ownership
 *  frames). Lazy + failure-tolerated: a write failure degrades to null (the
 *  teach-miss text stands), never a crash. */
async function teachFact(memoryDir, sessionId, { subject, predicate, object }) {
  try {
    const { appendFact, normFactTerm } = await import("./memory/core.mjs");
    const s = normFactTerm(subject);
    const o = normFactTerm(object);
    if (!s || !o) return null;
    await appendFact(memoryDir, {
      subject: s, predicate, object: o,
      provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
    });
    const phrase = FACT_PREDICATE_PHRASES[predicate] || predicate;
    return { text: `noted — remembered: ${s} ${phrase} ${o}`, via: "assert", miss: false };
  } catch {
    return null;
  }
}

/** Sentence forms to try asserting for a teach payload: the payload as-is, and
 *  (if it carries no determiner) its "every …" universal — the ACE-OWL shape the
 *  grammar actually lands. */
function assertCandidates(payload) {
  const p = String(payload).trim();
  const out = [p];
  if (!/^(?:every|each|all|a|an)\b/i.test(p)) out.push(`every ${p}`);
  return [...new Set(out)];
}
/** The "every X is a Y" rewrite of a declarative, for the "did you mean …" hint. */
function teachSuggestion(payload) {
  const m = String(payload).match(/^(?:every |each |all |a |an )?([\w-]+) (?:is|are) (?:a |an )?([\w-]+)$/i);
  return m ? `every ${m[1].toLowerCase()} is a ${m[2].toLowerCase()}` : null;
}

async function teachLane(query, { memoryDir, sessionId = "", lexicon = null }) {
  const raw = String(query).trim();
  const m = raw.match(TEACH_RE);
  const wrapped = m ? m[1].trim() : null;

  // OWNERSHIP — "<Name> owns/maintains <X>", bare or remember-wrapped. The bare
  // form is double-gated: a Capitalized name AND no interrogative lead, so the
  // "who owns <X>" READ question and ordinary prose never land a fact here.
  const ownSrc = wrapped ?? raw.replace(/[.!?]+\s*$/, "");
  const own = ownSrc.match(OWNS_TEACH_RE);
  if (own && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && (wrapped || /^[A-Z]/.test(own[1]))) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: own[2], predicate: OWNED_BY_PREDICATE, object: own[1],
    });
    if (stored) return stored;
  }

  let payload = null;
  if (wrapped && /\b(?:is|are)\b/i.test(wrapped)) payload = wrapped;
  else if (BARE_DECLARATIVE_RE.test(raw) && !QUESTION_LEAD_RE.test(raw)) payload = raw;
  if (!payload) return null;
  // Try to store it (a live session provides the write target). assertTurn returns
  // the "noted — remembered …" confirmation or null (grammar miss / unknown words).
  if (memoryDir) {
    for (const cand of assertCandidates(payload)) {
      const stored = await assertTurn(cand, { memoryDir, sessionId, focus: null, lexicon });
      if (stored) return { text: stored.answer, via: "assert", miss: false };
    }
    // PROPERTY teach — "remember/note that <X> is <adjective>": wrapper-REQUIRED
    // (a bare "X is deprecated" is never silently reified), and only after the
    // ACE grammar declined (unknown words / not the membership shape), so a
    // wrapped "X is a Y" over known lexicon still lands as rdfs:subClassOf.
    if (wrapped) {
      const prop = wrapped.match(TEACH_PROPERTY_RE);
      if (prop) {
        const stored = await teachFact(memoryDir, sessionId, {
          subject: prop[1], predicate: HAS_PROPERTY_PREDICATE, object: prop[2],
        });
        if (stored) return stored;
      }
    }
  }
  const suggestion = teachSuggestion(payload);
  const did = suggestion && suggestion !== payload.toLowerCase() ? ` Did you mean: "${suggestion}"?` : "";
  return {
    text: 'I couldn\'t store that — I remember facts in the shape "every X is a Y", where X and Y are '
      + `words I know.${did} Type /memory to see what I already remember.`,
    via: "teach-miss", miss: true,
  };
}

// #2 INTENT LANE — META/SELF. Bare self/session questions answered from stats /
// memory / orientation, never the grammar wall or the raw fact-dump. WOULD-MISS
// ONLY (the caller gates on a miss) and every pattern is a WHOLE-LINE self/session
// reference with no graph entity or predicate, so real graph queries ("what does X
// import", the meta "what does imports mean", "what did i ask before") never match.
const WHAT_KNOW_RE = /^what\s+(?:do\s+you|d'?you)\s+know(?:\s+so\s+far)?$/;
// 0.8.2 WS4 wall kindness (c): the most likely stranger openers — "what does this
// app/codebase do", "what is this app (for)" — join the orientation lane, so a
// first-touch question gets the live overview instead of the grammar wall.
const META_ORIENT_RE = /^(?:what(?:'s| is| are)?\s+this(?:\s+(?:app|codebase|repo|repository|project|code|thing))?|what\s+(?:codebase|repo|repository|project)\s+is\s+this|what\s+does\s+(?:this|the)\s+(?:app|code|codebase|project|repo)\s+do|what\s+is\s+(?:this|the)\s+app(?:\s+for)?|what\s+am\s+i\s+looking\s+at|what\s+is\s+tmct|how\s+do\s+i\s+(?:start|begin|get\s+started|get\s+going|load\s+(?:my\s+)?code|index\s+(?:my\s+)?(?:code|repo|repository)|use\s+(?:this|you|tmct))|where\s+do\s+i\s+(?:start|begin))$/;

/** A SHORT memory summary (never a fact dump) for the bare "what do you know".
 *  This branch only fires when rows.length === 0 — i.e. precisely the case where
 *  vocabulary seeding either hasn't run or produced nothing, so the hook makes NO
 *  term-specific promise (an unconditionally-true pointer: the teach lane and
 *  `tmct init` both work with zero preconditions), rather than suggesting a
 *  vocabulary example that would be guaranteed to miss right after being offered. */
async function memorySummary(memoryDir, graph) {
  const rows = memoryDir ? await memoryFacts(memoryDir) : [];
  if (!rows.length) {
    const hook = moduleCountOf(graph) > 0
      ? 'ask about this codebase\'s structure (imports, calls, definitions), or teach me with "every X is a Y"'
      : 'run `tmct init` to seed a starter vocabulary, or teach me directly with "every X is a Y"';
    return `I haven't been told any facts yet — ${hook}. /memory to inspect, /help for commands.`;
  }
  const preds = new Set(rows.map((f) => f.predicate).filter(Boolean));
  const n = rows.length;
  return `I remember ${n} fact${n === 1 ? "" : "s"} across ${preds.size} relation `
    + `type${preds.size === 1 ? "" : "s"}. Ask "what do you know about <term>", or /memory to explore.`;
}

// #2(e) MODULE-GRAIN OVERVIEW (Bug E, 0.8.2 follow-up). META_ORIENT_RE (above)
// is closed to 5 literal nouns (app/codebase/repo/repository/project) — it
// cannot match a module path or symbol name by construction, and "do" is
// deliberately excluded from VERB_TO_KIND everywhere else in the grammar, so
// "what does app/lib/a.mjs do" hit the grammar wall even though the data
// (renderDescribe's own edge aggregation) and the resolver (resolveEntity)
// both already exist. CASE-PRESERVING: module paths/symbol names are
// case-sensitive, so this reads the ORIGINAL query text, never metaLane's
// lowercased `q` (authorLane's same discipline, just above/below).
const MODULE_ORIENT_RE = /^what\s+does\s+(.+?)\s+do\??$/i;

/** authorLane's discipline, mirrored: a closed regex + an EXACT, UNIQUE
 *  resolution via resolveEntity, else null — never a guess. Pronoun/self
 *  subjects ("what does it/this do") are META_ORIENT_RE's/isConversational's
 *  territory, not this lane's — declined here so they fall through unchanged. */
async function moduleOrientLane(query, { graph }) {
  if (!graph) return null;
  const q = String(query).trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  const m = q.match(MODULE_ORIENT_RE);
  if (!m) return null;
  const term = m[1].trim();
  if (/^(?:it|this|that|they|them)$/i.test(term)) return null;
  const ent = await resolveEntity(graph, term);
  if (!ent) return null;
  const ind = graph.byId?.get?.(ent.id);
  if (!ind) return null;
  return { text: moduleOverviewText(graph, ind), via: "meta" };
}

async function metaLane(query, { graph, memoryDir, last = null, templates = null, vocabHint = null }) {
  const q = String(query).trim().toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  if (WHAT_KNOW_RE.test(q) || q === "what have you learned" || q === "what have you learnt") {
    return { text: await memorySummary(memoryDir, graph), via: "meta" };
  }
  if (META_ORIENT_RE.test(q)) {
    // Chat-feel residual (0.8.2 confirmation playtest, follow-up #3): Bug B1 only
    // taught the isConversational-triggered orientation branch (below, via:"template")
    // to shorten on an identical repeat — this META_ORIENT_RE branch is a SEPARATE
    // route to the same class of full-blurb text ("what does this app do" reprinted
    // orientationText(graph) verbatim on every repeat, never collapsing). Mirrors
    // ORIENTATION_REPEAT_ONELINER's identity-check pattern exactly, with its own
    // distinct oneliner text (self-limiting for the same reason).
    const text = orientationText(graph, templates, vocabHint);
    return { text: last?.answer === text ? META_ORIENT_REPEAT_ONELINER : text, via: "meta" };
  }
  // Bug E: an arbitrary "what does <term> do" that META_ORIENT_RE's closed noun
  // list didn't claim — try the module-grain overview before falling through to
  // the author-sha check below (disjoint triggers; order doesn't matter, but
  // this reads MORE of the query shape space, so it goes first).
  const moduleOrient = await moduleOrientLane(query, { graph });
  if (moduleOrient) return moduleOrient;
  // 0.8.2 WS4: the sha-authorship form ("who authored a1b2c3d") can be as short as
  // THREE words, which the conversational-orientation branch (step 2) would grab
  // before the author step (4b) is reached — a bare hex sha is not "code-ish" to
  // isConversational. The form is closed + unambiguous (7-40 hex chars), so the
  // meta lane delegates it to the author lane here. Unknown/ambiguous shas return
  // null and fall through unchanged.
  if (AUTHOR_SHA_RE.test(q)) return authorLane(q, { graph });
  return null;
}

// #4 INTENT LANE — AUTHOR (0.8.2 WS4). Author is a Commit ATTRIBUTE (key
// "author"/mgx:commitAuthor), never an individual, so "who is Grace Hopper" can't
// resolve as an entity — this lane reads the attribute through codegraph.mjs's
// authorIndex renderers instead. WOULD-MISS gated (the ladder consults it only on
// a miss) + CLOSED whole-line regexes + an EXACT case-insensitive author-name hit:
// an unknown name renders null here and falls through to the ordinary honest miss
// (never a guess, never a hijacked graph query).
const AUTHOR_NAME_SRC = "([A-Za-z][\\w'.-]*(?:\\s+[A-Za-z][\\w'.-]*){0,3})";
const AUTHOR_WHO_IS_RE = new RegExp(`^who\\s+is\\s+${AUTHOR_NAME_SRC}$`, "i");
const AUTHOR_TOUCHED_RE = new RegExp(
  `^what\\s+(?:did|has)\\s+${AUTHOR_NAME_SRC}\\s+(?:touch(?:ed)?|chang(?:e|ed)|work(?:ed)?\\s+on|commit(?:ted)?)$`, "i");
// The sha authorship forms — the interpret layer no longer rewrites these (WS2 guard).
const AUTHOR_SHA_RE = /^who\s+(?:authored|wrote|is\s+the\s+author\s+of)\s+(?:commit\s+)?([0-9a-fA-F]{7,40})$/i;

function authorLane(query, { graph }) {
  if (!graph) return null;
  const q = String(query).trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  const sha = q.match(AUTHOR_SHA_RE);
  if (sha) {
    const line = renderCommitAuthor(graph, sha[1]);
    return line ? { text: line, via: "author" } : null;
  }
  const touched = q.match(AUTHOR_TOUCHED_RE);
  if (touched) {
    const text = renderAuthorTouches(graph, touched[1]);
    if (text) return { text, via: "author" };
  }
  const who = q.match(AUTHOR_WHO_IS_RE);
  if (who) {
    const text = renderAuthorCard(graph, who[1]);
    if (text) return { text, via: "author" };
  }
  return null;
}

// #5(d,e)/#8 CAPABILITY NUDGES (0.8.2 WS4) — closed regexes on the would-miss path
// for asks the graph genuinely cannot answer: risk scoring, code opinions, writing
// code, and motive-"why". Each renders an HONEST wall pointing at the nearest real
// query shapes. These REMAIN recorded as misses (recordMiss stays TRUE): a
// capability wall must never fold into a recallable answer — WS3's fold hygiene is
// the second belt, this gate is the braces.
const RISK_NUDGE_RE = /\brisk(?:iest|y)\b/i;
const OPINION_ADJ_SRC =
  "(?:good|bad|clean|messy|ugly|nice|great|terrible|awful|solid|elegant|readable|maintainable|well[- ]written|well[- ]structured|spaghetti|ok|okay|decent|healthy)";
const OPINION_NUDGE_RE = new RegExp(`^is\\s+(?:this|the)\\s+code(?:base)?\\s+(?:any\\s+)?${OPINION_ADJ_SRC}\\b`, "i");
// Imperative "write code for me": a leading make/write/create/add/generate/
// implement/fix/refactor (optionally "can you …"-wrapped) aimed at a code noun (or
// a focus-resolvable "it"). "tell" is deliberately NOT a verb here — "tell me a
// joke" (the graded hm-joke case) must keep its ordinary honest miss.
const IMPERATIVE_NUDGE_RE =
  /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:make|write|create|add|generate|implement|fix|refactor)\b(?=.*\b(?:tests?|code|functions?|methods?|modules?|class(?:es)?|files?|it)\b)/i;
const WHY_UNTESTED_RE = /^why\s+(?:is|are)(?:n't|\s+not)?\s+(.+?)\s+(?:untested|not\s+tested|uncovered)$/i;

/** The <name> a nudge shows: the focus label when the query leans on a pronoun (or
 *  gave us nothing better), else the captured subject; "<name>" as the placeholder. */
function nudgeName(captured, focus) {
  const c = String(captured || "").trim();
  if (c && !/^(?:it|this|that|they|them)$/i.test(c)) return c;
  return focus?.label || "<name>";
}

/** The capability-nudge answer for a would-miss query, or null. Order matters only
 *  for the opinion gate: it must fire BEFORE the short-miss's "is a <thing> a
 *  <kind>" membership hint would (the caller runs this whole step before the
 *  short-miss rewrite). */
function nudgeAnswer(query, focus) {
  const q = String(query).trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  if (OPINION_NUDGE_RE.test(q)) {
    const name = focus?.label || "<name>";
    return "I don't hold opinions — I read structure, not quality. I can show what an opinion would rest on: "
      + `/stats (shape), "untested modules" (coverage), "who touched ${name}" (churn).`;
  }
  if (RISK_NUDGE_RE.test(q)) {
    const name = focus?.label || "<name>";
    return "I don't score risk — but two honest proxies live in the graph: "
      + `"/impact ${name}" (what a change reaches) and "who touched ${name}" (churn).`;
  }
  const why = q.match(WHY_UNTESTED_RE);
  if (why) {
    const name = nudgeName(why[1], focus);
    return "I can't know why — the graph records what IS, not intent. "
      + `"what tests ${name}" and "untested modules" show the coverage facts.`;
  }
  if (IMPERATIVE_NUDGE_RE.test(q)) {
    const name = nudgeName(/\b(?:it|this)\b/i.test(q) ? "it" : "", focus);
    return "I don't write code — I read a graph of it. "
      + `/tests ${name} shows what covers it; "untested modules" shows the gaps.`;
  }
  return null;
}

// #5(f) PRESUPPOSITION HONEST-NUDGE (ADVANCED_GRAMMAR track f,
// PLAN_ADVANCED_GRAMMAR.md §2f). "why does a.mjs still import the deprecated
// store?" presupposes TWO things: (1) a.mjs currently imports store — a real,
// checkable graph fact; (2) store is "deprecated" — a checkable MEMORY fact
// (mgx:hasProperty, the teach lane's own "X is <adjective>" shape). We never
// ACCOMMODATE a presupposition silently (assume it's true and answer around
// it) — we NAME it, confirmed or refuted, then answer what survives. Same
// honesty-nudge render precedent as why-untested/opinion above. Closed
// trigger lexicon (Levinson's classic still/again/anymore family) + the
// closed VERB_TO_KIND relation-verb table (read-only, ask-vocab.mjs) for the
// verb split — an unrecognized shape declines (null), never a guess.
const PRESUPPOSITION_TRIGGER_RE = /^why\s+(?:does|do|is|are)\s+(.+?)\s+(?:still|again|anymore|any\s+more)\s+(.+?)[?.!\s]*$/i;

/** Split a "<verb> <object>" tail on the longest known VERB_TO_KIND phrase
 *  (2-word phrases tried before 1-word, so "inherits from" wins over a bare
 *  "inherits"), returning {verb, kind, object} or null when no known relation
 *  verb opens the tail — the presupposition's relation half is then simply
 *  not checkable, so the caller declines rather than guessing a kind. */
function splitVerbObject(tail) {
  const words = String(tail).trim().split(/\s+/);
  for (let n = Math.min(2, words.length); n >= 1; n -= 1) {
    const candidate = words.slice(0, n).join(" ").toLowerCase();
    if (VERB_TO_KIND[candidate]) {
      return { verb: candidate, kind: VERB_TO_KIND[candidate], object: words.slice(n).join(" ").trim() };
    }
  }
  return null;
}

/** The presupposition-nudge answer for a would-miss "why … still/again …"
 *  query, or null (declines — never a guess — when the subject/object don't
 *  resolve to real graph entities, or no known relation verb opens the tail).
 *  Presupposition (1) is checked against the GRAPH (exhaustive, so a "no" is
 *  a confident, non-miss answer, not a shrug); presupposition (2) — an
 *  optional embedded 2-word object ("the DEPRECATED store") — is checked
 *  against MEMORY facts (mgx:hasProperty) and is honestly "no fact saying so"
 *  when absent, never assumed. Returns {text} or null.
 *
 *  WOULD-MISS ONLY, matching every other lane in this file (never hijack a
 *  real answer): "why does X import Y" already has a real, working grammar
 *  answer when the relation HOLDS ("Yes — imports edge from X to Y",
 *  miss:false) — that answer is correct and this lane must not shadow it. The
 *  relation-holds case an honest "No — no <kind> edge found …" is recorded as
 *  a MISS by the base engine's own empty-result convention, so THAT is where
 *  this lane adds real value: naming the presupposition explicitly (subject,
 *  predicate, object — and the embedded property claim, if any) rather than
 *  the plainer receipt. */
async function presuppositionNudge(query, { graph, memoryDir }) {
  if (!graph) return null;
  const m = String(query).trim().replace(/[?.!]+$/, "").match(PRESUPPOSITION_TRIGGER_RE);
  if (!m) return null;
  const split = splitVerbObject(m[2]);
  if (!split) return null;
  const rawObject = split.object.replace(/^(?:the|a|an)\s+/i, "").trim();
  const objWords = rawObject.split(/\s+/);
  const hasAdjective = objWords.length === 2;
  const entityTerm = hasAdjective ? objWords[1] : rawObject;
  const adjective = hasAdjective ? objWords[0].toLowerCase() : null;

  const subjEnt = await resolveEntity(graph, m[1].trim());
  const objEnt = await resolveEntity(graph, entityTerm);
  if (!subjEnt || !objEnt) return null; // can't check the presupposition — decline, never guess

  const holds = edgesOfKind(graph, split.kind).some((e) => e.subject === subjEnt.id && e.object === objEnt.id);
  const lines = [
    `checking the presupposition first: ${subjEnt.label} does${holds ? "" : "n't"} ${split.verb} ${objEnt.label} (${holds ? "yes" : "no"})`,
  ];
  if (adjective) {
    let propHit = null;
    if (memoryDir) {
      let normFactTerm;
      try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { normFactTerm = null; }
      if (normFactTerm) {
        const facts = await memoryFacts(memoryDir);
        const subjMatches = (f) => normFactTerm(f.subject) === normFactTerm(entityTerm);
        // Two shapes a taught "<X> is <adjective>" can land as: the teach
        // lane's mgx:hasProperty (subject/object) fact, or — when the
        // adjective is a known ACE-OWL lexicon data-property word (e.g.
        // "deprecated", grammar/lexicon-core.json) — the ACE grammar's own
        // tmct:<adjective> "true" data-property triple (assertTurn tries ACE
        // FIRST, so this is the more common real path for a lexicon word).
        propHit = facts.find((f) => subjMatches(f)
          && ((f.predicate === HAS_PROPERTY_PREDICATE && normFactTerm(f.object) === adjective)
            || (f.predicate === `tmct:${adjective}` && f.object === "true"))) || null;
      }
    }
    lines.push(`${objEnt.label} ${adjective} — ${propHit ? `yes (source: ${propHit.provenance})` : "I have no fact saying so"}`);
  }
  const verdict = lines.join("; ");
  return { text: holds ? `${verdict}. ${subjEnt.label} does ${split.verb} ${objEnt.label}.` : `${verdict} — the premise doesn't hold.` };
}

/** The wall-repeat one-liner (0.8.2 WS4 wall kindness (a)). MUST NOT match
 *  WALL_MISS_RE: the suppression keys on the PREVIOUS answer matching it, so this
 *  text self-limits — a third consecutive miss re-offers the tailored hint. */
const WALL_REPEAT_ONELINER = "still couldn't parse that — /help lists every query shape.";

/** The orientation-repeat one-liner (Bug B1, 0.8.2 follow-up). The conversational
 *  orientation branch sits OUTSIDE the composed-only wall-shortening gate (it
 *  carries via:"template", never "composed"), so it never shortened on a second
 *  identical turn the way a plain wall does. MUST be a different string from
 *  orientationAnswer's own output (checked by identity, not regex, since the
 *  orientation text is templated/graph-dependent) so this self-limits exactly
 *  like WALL_REPEAT_ONELINER: a third consecutive orientation-class turn
 *  re-offers the full orientation instead of droning the one-liner forever. */
const ORIENTATION_REPEAT_ONELINER = "still the same overview — /help lists every command and query shape.";

/** metaLane's own repeat-suppression twin for META_ORIENT_RE ("what does this app
 *  do", etc. — see metaLane's doc above) — a genuinely separate route to the same
 *  orientation-class text that Bug B1 didn't cover. MUST differ from
 *  ORIENTATION_REPEAT_ONELINER (a distinct string, checked by identity) so the two
 *  independent repeat-suppression sites can never be confused with one another. */
const META_ORIENT_REPEAT_ONELINER = "still the same overview — /stats for the full one, /help for commands.";

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
    ["/narrate on|off", "verbose developer/debug mode: decision points, matched pattern, results+sources, goal per turn"],
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
 *  so "which …" alone can never masquerade as a memory. Includes PATH-NOISE
 *  tokens (src, lib, mjs, …): "who owns src/handlers/tasks.mjs" must never
 *  recall "who touched src/core/store.mjs" off "src" alone. */
const RECALL_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "about", "into", "from",
  "which", "what", "who", "how", "when", "where", "why",
  "does", "do", "did", "is", "are", "was", "were", "there",
  "me", "my", "we", "i", "you", "it", "this", "that", "in", "of", "to",
  "src", "lib", "app", "mjs", "cjs", "js", "ts", "py", "index", "main", "test",
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

/** A recall frame's opening — a stored ANSWER carrying it is a replay of an
 *  earlier recall, never fresh content (nested recall-of-recall hygiene). */
const RECALL_PREAMBLE_RE = /^you asked about this before/;

/** Predicate-class content words bestQaPair requires a SHARED token from (Bug A
 *  entity∧predicate conjunction fix, 0.8.2 follow-up): every phrase in
 *  VERB_TO_KIND (ask-vocab.mjs's code-graph relation vocabulary — read-only
 *  reference here, never edited) split into its content words, PLUS the
 *  where/mention markers from the same file, PLUS chat.mjs's own ownership
 *  predicate ("owns"/"maintains", WHO_OWNS_RE/OWNS_TEACH_RE below) — a real,
 *  distinct predicate class the graph-relation table doesn't carry. Without this
 *  last pair, a stored "who touched X" and a live "who owns X" share no
 *  predicate word at all (which already rejects them) but neither could a
 *  genuine "who owns X" repeat ever recall itself. */
const PREDICATE_WORDS = new Set(
  [
    ...Object.keys(VERB_TO_KIND).flatMap((phrase) => phrase.split(/[\s-]+/)),
    ...WHERE_MARKERS, ...MENTION_MARKERS,
    "owns", "maintains",
  ].filter((w) => w.length >= 3),
);

/** Does `word` identify a graph ENTITY the two questions share — a dotted/path
 *  token (the cheap, always-available signal) or a bare term that resolves to a
 *  real graph individual (so a shared bare name, not just a shared directory
 *  segment, counts too). Failure-tolerated: no graph / no resolution → false,
 *  never a throw. */
async function isSharedEntityToken(word, graph) {
  if (word.includes(".")) return true;
  if (!graph) return false;
  const ent = await resolveEntity(graph, word);
  return !!ent;
}

/** Pick the recalled block's Q/A pair most relevant to the query. Null when
 *  nothing qualifies — the block matched on packaging, not substance, so the
 *  honest miss must stand. Recall HYGIENE (0.8.2, tightened in the 0.8.2
 *  follow-up): only a pair with a SUBSTANTIVE answer is recallable — a Q-only
 *  pair, a grammar-wall answer (WALL_MISS_RE) or a prior recall frame (nested
 *  recall-of-recall) is skipped. The acceptance test is an explicit CONJUNCTION,
 *  not the old OR-shaped word-overlap count: at least one shared
 *  entity-identifying token (isSharedEntityToken) AND at least one shared
 *  predicate-class word (PREDICATE_WORDS) — so a stored "who touched X" can
 *  never recall onto a live "who owns X" (predicate mismatch, entity token
 *  still shared) and a stored "who owns X" can never recall onto "who owns Y"
 *  (predicate matches, entity token doesn't — a shared directory segment used
 *  to satisfy the old ≥2-word branch on its own). */
async function bestQaPair(blockText, query, graph) {
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
    if (!p.a || WALL_MISS_RE.test(p.a) || RECALL_PREAMBLE_RE.test(p.a)) continue;
    const shared = [...recallWords(p.q)].filter((w) => qWords.has(w));
    if (!shared.length) continue;
    if (!shared.some((w) => PREDICATE_WORDS.has(w))) continue;
    let hasEntity = false;
    for (const w of shared) {
      if (await isSharedEntityToken(w, graph)) { hasEntity = true; break; }
    }
    if (!hasEntity) continue;
    if (shared.length > bestScore) { best = p; bestScore = shared.length; }
  }
  return best;
}

/** W2 seam: consult the folded-session block index for an honest miss. A
 *  sufficiently-relevant hit returns the recalled Q/A, framed and cited to its
 *  session; anything less returns null and the miss stands BYTE-UNCHANGED. A
 *  recall only ever fires with a substantive recalled A (bestQaPair's hygiene),
 *  so it is never prepended to a reply that is itself a miss going to record.
 *  Lazy + failure-tolerated (chat.mjs ethos): a broken store degrades to null. */
async function recallFromBlocks(memoryDir, query, graph) {
  try {
    const { retrieveBlocks } = await import("./memory/blocks.mjs");
    const hits = await retrieveBlocks(memoryDir, query, RECALL_TOP_K);
    const best = hits[0];
    if (!best || best.score < RECALL_MIN_SCORE || !best.text) return null;
    const pair = await bestQaPair(best.text, query, graph);
    if (!pair) return null;
    const day = uuidv7Day(best.id);
    const cite = `session ${String(best.id).slice(0, 8)}${day ? `, ${day}` : ""}`;
    return `you asked about this before (${cite}):\n  Q: ${pair.q}\n  A: ${pair.a}`;
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
  "mgx:ownedBy": "is owned by", // the teach lane's ownership frame ("Priya owns tasks.mjs")
};
const factPhrase = (f) => `${f.subject} ${FACT_PREDICATE_PHRASES[f.predicate] || f.predicate} ${f.object}`;

/** One rendered fact line. An OPERATOR-asserted fact keeps the true first-person
 *  provenance ("you told me: …"). A CORPUS fact is presented as clean DATA with its
 *  source cited — NEVER "i learned: …", which over-claims and anthropomorphises
 *  (especially when the corpus row is noise); the relation and its provenance speak
 *  for themselves. Provenance stays VERBATIM either way. */
function renderFactLine(f) {
  const cite = f.provenance ? ` (source: ${f.provenance})` : "";
  // ace:chat = the ACE-parsed operator assert; teach:chat = the teach lane's
  // natural frames — both are things the operator SAID, so both read first-person.
  if (f.provenance.includes("ace:chat") || f.provenance.includes("teach:chat")) return `you told me: ${factPhrase(f)}${cite}`;
  // CORPUS facts are background DATA — present the relation plainly, cited to its
  // source, NEVER "i learned: …" (the footgun: a first-person claim over corpus noise).
  if (f.provenance.includes("corpus:")) return `${factPhrase(f)}${cite}`;
  return `i learned: ${factPhrase(f)}${cite}`;
}

/** PROOF-CHAIN RECEIPT (PLAN_INFERENCE_TESTING.md §4 stage 2; ROADMAP L788's
 *  "renderable as a chain of thought in words"): render an ordered list of
 *  premise Fact rows as one continuous argument — "cache is a kind of store;
 *  store is a kind of component; so redis.mjs is a component" — each premise
 *  cited via the SAME factPhrase + "(source: …)" convention renderFactLine
 *  uses, just without its "you told me"/"i learned" framing (a chain reads as
 *  one derivation, not a list of standalone recollections). The conclusion
 *  clause is spelled directly from the first premise's subject and the last
 *  premise's object — sound for any chain length, though today's only caller
 *  (the live cax-sco/scm-sco chase below) ever passes exactly two. */
function renderIsaChain(premises) {
  const step = (f) => `${factPhrase(f)}${f.provenance ? ` (source: ${f.provenance})` : ""}`;
  const first = premises[0];
  const last = premises[premises.length - 1];
  return `${premises.map(step).join("; ")}; so ${first.subject} is a ${last.object}`;
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

// ---- PLAN_ontology-hierarchies.md §3 tracks (a)+(b): synonymsOf(term) —
// QUERY-TIME term expansion wiring the two already-parsed-but-inert synonym
// resources. §1's "two vocabulary gates" distinction: this widens what a
// vocabulary QUESTION can be matched against (the memory fact/corpus term
// space), never what parseAce can TEACH (the ACE lexicon gate is untouched —
// src/grammar/lexicon-core.json is out of this agent's scope regardless). A
// synonym-expansion hit ALWAYS renders its licensing source visibly — never a
// silent substitution (the confident-wrong discipline every other lane here
// already follows). ----

/** term (lowercased, unnormalized — the caller normalizes) -> [{variant,
 *  source}], built once from two committed-but-unconsumed resources:
 *    (a) the ConceptNet slice's /r/Synonym + /r/SimilarTo rows — deliberately
 *        gated `ace = "none"` in conceptnet-map.toml (never emitted as a
 *        memory FACT; that gate is about fact emission, not about whether the
 *        raw slice data exists — the map's own note names "the grammar
 *        lexicon / phrasebook synonym families" as this data's real consumer)
 *    (b) loadPhrasebook()'s already-parsed `synonyms` families
 *        (corpus/templates.mjs, parsed + tested but never called outside its
 *        own test until now)
 *  PRECISION PASS (PLAN_ontology-hierarchies.md §3 track a: "start with a
 *  precision-reviewed subset ... not a blind bulk activation"): a spot check
 *  of the raw /r/Synonym slice showed the noise concentrates in multi-word /
 *  punctuated endpoints (generic-English senses, proper-noun collisions); this
 *  index admits only SINGLE-WORD, purely-alphabetic ConceptNet endpoints on
 *  BOTH sides of a row — a first-cut heuristic filter, not a full manual
 *  review of all 1,228 rows (a natural follow-up, not claimed as done here).
 *  Lazy + failure-tolerated: a missing/broken corpus file degrades to an
 *  empty (or phrasebook-only) index, never a throw. */
let synonymIndexCache = null;
async function synonymIndex() {
  if (synonymIndexCache) return synonymIndexCache;
  const index = new Map();
  const add = (a, b, source) => {
    const ta = String(a || "").trim().toLowerCase();
    const tb = String(b || "").trim().toLowerCase();
    if (!ta || !tb || ta === tb) return;
    if (!index.has(ta)) index.set(ta, []);
    if (!index.get(ta).some((e) => e.variant === tb)) index.get(ta).push({ variant: tb, source });
    if (!index.has(tb)) index.set(tb, []);
    if (!index.get(tb).some((e) => e.variant === ta)) index.get(tb).push({ variant: ta, source });
  };
  try {
    const { loadSlice, loadMap, termText } = await import("./corpus/conceptnet.mjs");
    const [assertions, map] = await Promise.all([loadSlice(), loadMap()]);
    const SINGLE_WORD_RE = /^[a-z]+$/;
    for (const a of assertions) {
      if (a.rel !== "/r/Synonym" && a.rel !== "/r/SimilarTo") continue;
      if (!map.has(a.rel)) continue; // drift-guarded elsewhere; tolerate here
      const start = termText(a.start);
      const end = termText(a.end);
      if (!start || !end || !SINGLE_WORD_RE.test(start) || !SINGLE_WORD_RE.test(end)) continue;
      add(start, end, `corpus:conceptnet ${a.rel}`);
    }
  } catch { /* corpus unavailable — degrade gracefully */ }
  try {
    const { loadPhrasebook } = await import("./corpus/templates.mjs");
    const { synonyms } = await loadPhrasebook();
    for (const family of synonyms) {
      for (let i = 0; i < family.length; i += 1) {
        for (let j = i + 1; j < family.length; j += 1) add(family[i], family[j], "corpus:phrasebook");
      }
    }
  } catch { /* tolerated */ }
  synonymIndexCache = index;
  return index;
}

/** Known synonyms of `term` (case-insensitive), each `{variant, source}` — []
 *  when nothing is known. Callers widen a failed factTermVariants lookup with
 *  these variants ONLY on a direct miss, and MUST cite `source` in the
 *  rendered answer (synonymFactAnswer, below factAnswer, is the reference
 *  consumer). */
async function synonymsOf(term) {
  const index = await synonymIndex();
  return index.get(String(term || "").trim().toLowerCase()) || [];
}

/** "is a module a component" — the yes/no vocabulary form the graph grammar
 *  doesn't parse; checked against the isa-family fact predicates only. */
const ISA_ASK_RE = /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+(?:a\s+kind\s+of|a\s+type\s+of|an?)\s+(.+?)[?.!\s]*$/i;
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);
/** "what do you know about caches" — the open recall-everything form. */
const KNOW_ABOUT_RE = /^what\s+do\s+you\s+know\s+about\s+(.+?)[?.!\s]*$/i;
/** How many facts a single answer lists before the remainder is paged with "more". */
const FACT_ANSWER_CAP = 32;

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
    const lines = hits.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: miss, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
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
    const lines = hits.map((f) => `  ${renderFactLine(f)}`);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n  …and ${rest.length} more — say 'more' to see them.` : "";
    return { text: `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}:\n${shown.join("\n")}${extra}`, replace: true, ...(rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {}) };
  }
  return null;
}

/** Ontology plan tracks (a)+(b) (PLAN_ontology-hierarchies.md §3): a LAST-
 *  RESORT query-time synonym expansion for a "what is a X"-shaped term with NO
 *  direct facts. Deliberately run where the caller runs it (runAsk, after
 *  curatedDefinitionAnswer/conceptForceAnswer have ALL had their full chance,
 *  gated on `via === "composed"` still standing) rather than inside factAnswer
 *  itself: ask()'s own grammar parses EVERY "what is a X" as shape:"meta" with
 *  miss:true, even when conceptForceAnswer goes on to answer it for real from
 *  SEON instance data — gating on miss alone (tried and reverted) is not
 *  enough to avoid hijacking that real answer with an unrelated synonym's
 *  taught fact; running LAST, only once nothing else answered, is the actual
 *  guard. ALWAYS renders a visible prefix naming the synonym term AND the
 *  corpus row that licensed the match — never a silent substitution. Returns
 *  { text } or null. Lazy + failure-tolerated throughout. */
async function synonymFactAnswer(memoryDir, query, envelope) {
  if (!memoryDir) return null;
  const term = metaTermOf(query, envelope);
  if (!term) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const facts = await memoryFacts(memoryDir);
  for (const { variant, source } of await synonymsOf(term)) {
    const variants = factTermVariants(normFactTerm, variant);
    const hits = facts.filter((f) => variants.has(f.subject));
    if (!hits.length) continue;
    const lines = hits.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    const prefix = `no direct facts about "${term}" — showing its known synonym "${variant}" (source: ${source}):\n`;
    return { text: prefix + shown.join("\n") + extra, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
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
/** "who owns <X>" / "who maintains <X>" — the closed ownership read-back over
 *  the teach lane's mgx:ownedBy facts. */
const WHO_OWNS_RE = /^who\s+(?:owns|maintains)\s+(.+?)[?.!\s]*$/i;
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

/** A relation group that carries class-inheritance edges — the same token family
 *  codegraph.mjs's relationKind classifies as "inherits" (checked locally over
 *  prop+predicate so this file adds no codegraph import surface). */
const INHERITS_GROUP_RE = /inherit|supertype|subclass|extend|specializ/i;
/** How far up an inheritance chain the class↔instance bridge walks. */
const INHERITS_MAX_HOPS = 8;

/** Walk the code graph's `inherits` chain UPWARD from an entity id — each
 *  superclass as { id, label }, bounded (≤ INHERITS_MAX_HOPS) and cycle-safe.
 *  Read-only over graph.relations; feeds the class↔instance bridge so a taught
 *  "controller ⊑ handler" composes with a graph "TaskController inherits
 *  Controller". Follows the FIRST outgoing inherits edge per hop (single
 *  inheritance is the emitted shape). */
function inheritsChain(graph, startId) {
  const out = [];
  if (!graph || !startId) return out;
  const seen = new Set([startId]);
  let cur = startId;
  for (let hop = 0; hop < INHERITS_MAX_HOPS; hop += 1) {
    let edge = null;
    for (const g of graph.relations || []) {
      if (!INHERITS_GROUP_RE.test(`${g?.prop || ""} ${g?.predicate || ""}`)) continue;
      edge = (g.edges || []).find((e) => e?.subject === cur) || null;
      if (edge) break;
    }
    if (!edge || seen.has(edge.object)) break;
    seen.add(edge.object);
    out.push({ id: edge.object, label: edge.objectLabel || edge.object });
    cur = edge.object;
  }
  return out;
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
    const lines = hits.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
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
    // CLASS↔INSTANCE BRIDGE (0.8.2): when X resolves to a graph entity, its
    // inherits chain's superclass LABELS are subject candidates too — a taught
    // "controller ⊑ handler" composes with a graph "TaskController inherits
    // Controller" so "is TaskController a handler" answers yes, naming BOTH
    // sources (the graph edge + the taught fact with its provenance).
    const ent = await resolveEntity(graph, isaAsk[1]);
    if (ent) {
      const bridgeSubjects = new Map(); // fact-term variant → the superclass label as spelled in the graph
      for (const sup of inheritsChain(graph, ent.id)) {
        for (const v of factTermVariants(normFactTerm, sup.label)) {
          if (!subjCandidates.has(v) && !bridgeSubjects.has(v)) bridgeSubjects.set(v, sup.label);
        }
      }
      const bridged = isa
        .filter((f) => bridgeSubjects.has(f.subject) && objVariants.has(f.object))
        .sort(byTrust)[0];
      if (bridged) {
        return {
          text: `yes — the code graph says ${ent.label} inherits ${bridgeSubjects.get(bridged.subject)}, and ${renderFactLine(bridged)}`,
          replace: true,
        };
      }
    }
    // LIVE cax-sco / scm-sco PROOF CHASE (PLAN_INFERENCE_TESTING.md INF-A2,
    // §4 stage 1): a direct isa fact and the graph inherits-bridge both
    // missed — chase a chain over TWO TAUGHT isa-family facts (§1's PARTIAL
    // note: "cax-sco over two TAUGHT facts is NOT implemented"; the band's own
    // "Rules needed" column: "⊑-chain of length 2") via syllogise.mjs's
    // findIsaChain, a rooted proof search built on the SAME two rule kernels,
    // LIVE and READ-ONLY (nothing is written — the offline `tmct syllogise`
    // batch pass, materializing the same two rules with `entailed:*`
    // provenance, is the persisting counterpart). Deliberately narrow, twice
    // over, to stay exactly in INF-A2's scope and not silently answer bands
    // this stage doesn't (yet) certify:
    //   - maxHops:2 — a longer taught chain is INF-B2's multi-hop +
    //     proof-chain-materialization territory (§4 stage 2 proper), which
    //     INFBENCH pins as an honest ceiling until it lands — answering
    //     "yes" there today would be graded FABRICATION, not credit.
    //   - CORPUS-sourced edges excluded — the bulk background corpus band
    //     (trust 0.7) can coincidentally chain two unrelated classes into a
    //     technically-true-per-ConceptNet "yes" that has nothing to do with
    //     what the OPERATOR taught; only operator/teach/entailed-sourced isa
    //     facts are chased, matching "TAUGHT" in the gap's own name.
    const { findIsaChain, SUBCLASS_PREDICATE: SC_PREDICATE, TYPE_PREDICATE: RDF_TYPE_PREDICATE } = await import("./syllogise.mjs");
    const isTaught = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
    const chainSubClassRows = isa.filter((f) => f.predicate === SC_PREDICATE && isTaught(f));
    const chainTypeRows = isa.filter((f) => f.predicate === RDF_TYPE_PREDICATE && isTaught(f));
    const chainSubClassEdges = chainSubClassRows.map((f) => [f.subject, f.object]);
    const chainTypeEdges = chainTypeRows.map((f) => [f.subject, f.object]);
    const factForStep = (step) => (step.predicate === SC_PREDICATE ? chainSubClassRows : chainTypeRows)
      .find((f) => f.subject === step.subject && f.object === step.object);
    for (const subj of subjCandidates) {
      const chain = findIsaChain(subj, objVariants, chainTypeEdges, chainSubClassEdges, { maxHops: 2 });
      if (!chain) continue;
      const premises = chain.map(factForStep);
      if (premises.every(Boolean)) return { text: `yes — ${renderIsaChain(premises)}`, replace: true };
    }
    return null; // no remembered fact — the honest miss stands (never a guessed "no")
  }

  // (a2) OWNERSHIP read-back — "who owns/maintains <X>": the teach lane's
  // mgx:ownedBy facts about X, trust-ranked, each cited (the source receipt
  // stays in the render). No fact → null, the honest miss stands.
  const owns = q.match(WHO_OWNS_RE);
  if (owns) {
    const variants = factTermVariants(normFactTerm, owns[1]);
    const hits = rows
      .filter((f) => f.predicate === OWNED_BY_PREDICATE && variants.has(f.subject))
      .sort(byTrust);
    if (!hits.length) return null;
    return renderMany(hits);
  }

  // (b) RECALL — "what did i tell you about X": every remembered fact mentioning X.
  const told = q.match(TOLD_ABOUT_RE);
  if (told) {
    const variants = factTermVariants(normFactTerm, told[1]);
    const hits = rows.filter((f) => variants.has(f.subject) || variants.has(f.object)).sort(byTrust);
    if (!hits.length) return null;
    const term = variants.has(hits[0].subject) ? hits[0].subject : hits[0].object;
    const lines = hits.map((f) => `  ${renderFactLine(f)}`);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n  …and ${rest.length} more — say 'more' to see them.` : "";
    return { text: `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}:\n${shown.join("\n")}${extra}`, replace: true, ...(rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {}) };
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

/** Bug B4 (0.8.2 follow-up): taught facts about ONE resolved entity, trust-
 *  ranked and rendered the same way factReadBack's own lines are — the seam
 *  `/describe` was missing. `renderDescribe` (codegraph.mjs) and `dispatchTool`
 *  (server.mjs) never receive `memoryDir`, so ACE-taught facts about the
 *  resolved entity were architecturally invisible to `/describe`; this reads
 *  memory directly and the CALLER (runCommand) appends the result to
 *  renderDescribe's own output, mirroring the ask-path's existing
 *  `factAnswer(...) ?? factReadBack(...)` append discipline rather than
 *  threading memoryDir through the pure describe renderer itself. Subject-side
 *  only (a `/describe` names ONE code entity as the subject of its own facts,
 *  not every fact that merely mentions it in passing) — null when memory holds
 *  nothing about this subject. */
async function describedFacts(memoryDir, label) {
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const rows = await factRows(memoryDir);
  if (!rows.length) return null;
  const variants = factTermVariants(normFactTerm, label);
  const hits = rows.filter((f) => variants.has(f.subject)).sort((a, b) => b.trust - a.trust);
  if (!hits.length) return null;
  return `taught facts:\n${hits.map((f) => `  ${renderFactLine(f)}`).join("\n")}`;
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

// ---- curated SEON definitions (corpus/seon/definitions.jsonl) ----
// A "what is a <term>" for a LEXICON term prefers the curated one-sentence
// definition — the richer surface form of the same curated SEON knowledge that the
// concept seed reifies — over the bare seon concept fact / schema-docs / honest
// miss. Cited via:"corpus/seon". Two guards keep it honest and test-safe:
//   - it only fires when this repo actually carries the SEON concept seed (a
//     corpus:seon fact about the term is in memory) — so a repo seeded with only
//     ConceptNet (or nothing) is byte-unchanged;
//   - a fact the USER personally asserted (ace:chat) still wins — you told me beats
//     the corpus definition.

let seonDefsPromise = null;
/** Load corpus/seon/definitions.jsonl once → Map(normFactTerm(term) → definition).
 *  Lazy + failure-tolerated (chat.mjs ethos): any failure degrades to an empty map. */
function seonDefinitions() {
  if (!seonDefsPromise) {
    seonDefsPromise = (async () => {
      const { SEON_DEFINITIONS_FILE } = await import("./corpus/conceptnet.mjs");
      const { normFactTerm } = await import("./memory/core.mjs");
      const raw = await readFile(SEON_DEFINITIONS_FILE, "utf8");
      const map = new Map();
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const row = JSON.parse(t);
          if (row.term && row.definition) map.set(normFactTerm(row.term), String(row.definition));
        } catch { /* skip a malformed line, never throw */ }
      }
      return map;
    })().catch(() => new Map());
  }
  return seonDefsPromise;
}

let seonRelsPromise = null;
/** Load corpus/seon/relations.jsonl once → Map(relationTerm → definition), keyed on
 *  the concept key ("imports","calls",…). Sits beside definitions.jsonl (same seon
 *  dir), loaded the same lazy + failure-tolerated way — any failure degrades to an
 *  empty map, so the relation force simply declines rather than throwing. */
function relationDefinitions() {
  if (!seonRelsPromise) {
    seonRelsPromise = (async () => {
      const { SEON_DEFINITIONS_FILE } = await import("./corpus/conceptnet.mjs");
      const relFile = join(dirname(SEON_DEFINITIONS_FILE), "relations.jsonl");
      const raw = await readFile(relFile, "utf8");
      const map = new Map();
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const row = JSON.parse(t);
          if (row.relation && row.definition) map.set(String(row.relation).toLowerCase(), String(row.definition));
        } catch { /* skip a malformed line, never throw */ }
      }
      return map;
    })().catch(() => new Map());
  }
  return seonRelsPromise;
}

/** The meta term a "what is a X" / "what does X mean" / "define X" question asks
 *  about — from the parse when present, else recognized directly (same required-
 *  article discipline as the grammar's T5). Null when the line isn't such a form. */
function metaTermOf(query, envelope) {
  if (envelope?.parsed?.shape === "meta" && envelope.parsed.object) return envelope.parsed.object;
  const q = String(query).trim();
  const m = q.match(/^what\s+(?:is|are)\s+an?\s+(.+?)[?.!\s]*$/i)
    || q.match(/^what\s+(?:does|do)\s+(?:an?\s+)?(.+?)\s+means?[?.!\s]*$/i)
    || q.match(/^define\s+(?:an?\s+)?(.+?)[?.!\s]*$/i);
  return m ? m[1].trim() : null;
}

/** The curated SEON definition to PREFER for a "what is a <lexicon term>", or null.
 *  Gated: the term parses as a meta question, is a grammar-lexicon noun, has a
 *  curated definition, this repo carries the SEON concept seed for it (a corpus:seon
 *  fact), and the user has NOT personally asserted a fact about it. Returns { text,
 *  term } or null. Lazy + failure-tolerated throughout. */
async function curatedDefinitionAnswer(query, envelope, { memoryDir, lexicon }) {
  if (!memoryDir) return null;
  const term = metaTermOf(query, envelope);
  if (!term) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  // lexicon-noun gate: the curated defs are keyed on SE lexicon terms only.
  let lex = lexicon;
  try {
    if (!lex) { const { loadLexicon } = await import("./grammar/lexicon.mjs"); lex = loadLexicon(); }
    const { lookupNoun } = await import("./grammar/lexicon.mjs");
    if (!lookupNoun(lex, term)) return null;
  } catch { return null; }
  const def = (await seonDefinitions()).get(normFactTerm(term));
  if (!def) return null;
  // tie the definition to the SEON concept seed being present, and let a user fact win.
  const variants = factTermVariants(normFactTerm, term);
  const facts = await memoryFacts(memoryDir);
  const about = facts.filter((f) => variants.has(f.subject) || variants.has(f.object));
  if (about.some((f) => f.provenance.includes("ace:chat"))) return null; // you told me — that wins
  if (!about.some((f) => f.provenance.includes("corpus:seon"))) return null; // no SEON seed here
  return { text: `${def} (source: corpus/seon)`, term };
}

/** The concept term a vague "what is a X" / "tell me about X" / "what does X mean" /
 *  "define X" asks about — metaTermOf's forms plus the "tell me about …" opener that
 *  the graph parser reads as a count. Null when the line isn't such a touch. The
 *  concept force is gated further downstream (a KNOWN, instance-bearing concept), so
 *  this only has to recognize the SHAPE, not vet the term. */
/** The VAGUE-TOUCH shapes ("tell me about X", "[and] what about X") — a concept
 *  touch that is NOT the "what is a X" / "what does X mean" META shape. The meta shape
 *  has its own established handling (a noun definition, a predicate definition, or the
 *  honest ambiguity surround for a term that is BOTH a noun and a predicate — e.g.
 *  "imports"), which the RELATION force must never preempt (frozen case
 *  am-meta-imports). Gated downstream by CONCEPT_CLASS / RELATION_TERM, so a real
 *  entity name declines here. */
function vagueTouchTermOf(query) {
  const q = String(query).trim();
  const m = q.match(/^tell me about\s+(?:an?\s+)?(.+?)[?.!\s]*$/i)
    || q.match(/^(?:(?:and|so|but|ok|okay|now|then)\s+)*what about\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i);
  return m ? m[1].trim() : null;
}

function conceptTermOf(query, envelope) {
  return metaTermOf(query, envelope) || vagueTouchTermOf(query);
}

/** The RELATION term a vague touch names — the VAGUE-touch shapes only ("tell me
 *  about X", "what about X"), NOT the "what is a X"/"what does X mean" meta shape (a
 *  relation term that is also a vocabulary word, like "imports", keeps its established
 *  ambiguity/predicate-definition answer — frozen case am-meta-imports). Plus the
 *  relation-only openers the graph parser reads as something else: "what are the
 *  imports", "what calls are there", "what is calling". Null when the line isn't such a
 *  touch. Gated downstream by RELATION_TERM, so this only has to recognize the SHAPE. */
function relationTermOf(query, envelope) {
  const base = vagueTouchTermOf(query);
  if (base) return base;
  const q = String(query).trim().toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  let m;
  // "what are the imports", "what is the containment", "what are all the calls"
  if ((m = q.match(/^what\s+(?:are|is)\s+(?:all\s+)?(?:the\s+)?([a-z][a-z-]*?)(?:\s+(?:edges|relationships|relations))?$/))) return m[1];
  // "what calls are there", "what imports are there"
  if ((m = q.match(/^what\s+([a-z][a-z-]*?)\s+are\s+there$/))) return m[1];
  // "what is calling", "what is importing" (bare gerund, no object)
  if ((m = q.match(/^what\s+(?:is|are)\s+([a-z][a-z-]*ing)$/))) return m[1];
  // THE SINGULAR META FORM — "what is a test" / "what is an import". The whole meta
  // shape used to be excluded here to keep the frozen am-meta-imports ambiguity case
  // ("what does imports mean") out; but that case is a DIFFERENT shape (ambiguousParse
  // → envelope.parsed is null), and a relation word whose SINGULAR reads as a real
  // graph-schema class/predicate ("what is a contains"/"cochange") answers non-miss
  // from the ordinary meta path. So admit the article meta form ONLY when the ordinary
  // path MISSED on a plain definitional parse (envelope.miss on a shape:"meta" object):
  // an unambiguous relation word like "test" — no schema reading, no ambiguity — then
  // reaches the relation-concept force exactly as its plural "what are the tests" does.
  // RELATION_TERM still gates the term downstream, so a non-relation miss is untouched.
  if (envelope?.miss === true && envelope?.parsed?.shape === "meta" && envelope.parsed.object) {
    return envelope.parsed.object;
  }
  return null;
}

/** A closed "describe"-intent wrapper: "can you describe X for me", "could you
 *  tell me about X", "tell me more about X" → attempt tmct_describe(X). Found
 *  live (playtest sprint round 2, SKILL_PLAYTEST_SPRINT.md): a describe-intent
 *  question wrapped in an ordinary polite request ("can you tell me more about
 *  Controller") fell all the way to the generic wall despite naming a real,
 *  just-listed entity — nothing recognized the wrapper at all. Same closed
 *  lead-in-alternation discipline as GREETING_PREAMBLE_RE/THANKS_PREAMBLE_RE
 *  (normalize.mjs). Deliberately used only as a LAST-RESORT lane (see its call
 *  site below) — "tell me about X" is ALSO the relation/concept force's own
 *  trigger phrase for enumerable concepts ("tell me about inheritance"), so
 *  this must never run before those have had their chance. Trails an optional
 *  "please" as well as "for me" (playtest sprint round 3): this lane reads the
 *  RAW turn text, not normalize.mjs's FILLER_WORDS-stripped one, so "could you
 *  tell me more about Router please" needs its own trailing-politeness strip. */
const DESCRIBE_WRAPPER_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?(?:tell\s+me\s+(?:more\s+)?about|describe)\s+(.+?)(?:\s+for\s+me)?(?:\s+please)?\s*\??$/i;

async function describeWrapperAnswer(query, { config, source }) {
  const m = DESCRIBE_WRAPPER_RE.exec(String(query || "").trim());
  const term = m?.[1]?.trim();
  if (!term) return null;
  try {
    const text = await dispatchTool("tmct_describe", { symbol: term }, { config, source });
    return text ? { text } : null;
  } catch {
    return null; // unresolvable term — decline, the ordinary wall stands unchanged
  }
}

/** THE RELATION CONCEPT FORCE — compose the three-band answer (curated relation
 *  definition + real example EDGES + pre-validated follow-ups) for a vague touch on a
 *  relation/edge kind ("what about imports", "what are the calls", "tell me about
 *  contains"), or null when it isn't one: not a recognizable relation touch, not a
 *  known edge concept (RELATION_TERM), no curated definition, or the graph has NO
 *  edges of that kind (composeRelation's own honest-miss gate). Loads the definition
 *  from the shipped corpus/seon/relations.jsonl, so it works without per-repo memory
 *  seeding. Lazy + failure-tolerated throughout. Returns { text, pending }. */
async function relationForceAnswer(query, envelope, { graph, config, source, templates }) {
  const rawTerm = relationTermOf(query, envelope);
  if (!rawTerm) return null;
  let composeRelation; let RELATION_TERM;
  try { ({ composeRelation, RELATION_TERM } = await import("./concept.mjs")); }
  catch { return null; }
  const term = String(rawTerm).toLowerCase();
  if (!RELATION_TERM[term]) return null; // not an enumerable edge concept — ordinary path owns it
  const definition = (await relationDefinitions()).get(RELATION_TERM[term]) ?? null;
  if (!definition) return null;
  // Same graph-load fallback as conceptForceAnswer: the shell hands the loaded graph
  // straight in; the pure runTurn(config) path loads it the way dispatchTool does.
  let g = graph;
  if (!g && config && source) {
    try { g = parseEntities(await source.fetchEntities(config)); } catch { g = null; }
  }
  if (!g) return null;
  let composed;
  try { composed = composeRelation(g, term, { definition }); }
  catch { return null; }
  if (!composed) return null;
  const rendered = tRender(templates, T_CONCEPT, {
    definition: composed.definition, examples: composed.examples, followups: composed.followups,
  });
  const text = rendered ?? `${composed.definition}\n${composed.examples}${composed.followups}`;
  const pending = composed.remainder && composed.remainder.length
    ? { items: composed.remainder, noun: composed.noun }
    : null;
  return { text, pending };
}

/** THE CONCEPT FORCE — compose the three-band answer (corpus/seon definition + real
 *  graph/memory instances + pre-validated follow-ups) for a vague concept touch, or
 *  null when it isn't one: not a "what is a X"/"tell me about X" shape, not a known
 *  enumerable concept (CONCEPT_CLASS), no curated definition, or NO instances anywhere
 *  (composeConcept's own honest-miss gate). Loads the definition DIRECTLY from the
 *  shipped corpus/seon file (seonDefinitions), so it works without per-repo memory
 *  seeding; the memory fact rows only ADD remembered "A is a X" examples when present.
 *  Lazy + failure-tolerated throughout (chat.mjs ethos). Returns { text, instances }. */
async function conceptForceAnswer(query, envelope, { graph, config, source, memoryDir, templates }) {
  const rawTerm = conceptTermOf(query, envelope);
  if (!rawTerm) return null;
  let normFactTerm; let composeConcept; let CONCEPT_CLASS;
  try {
    ({ normFactTerm } = await import("./memory/core.mjs"));
    ({ composeConcept, CONCEPT_CLASS } = await import("./concept.mjs"));
  } catch { return null; }
  const term = normFactTerm(rawTerm);
  if (!CONCEPT_CLASS[term]) return null; // not an enumerable code concept — ordinary path owns it
  const definition = (await seonDefinitions()).get(term) ?? null;
  if (!definition) return null;
  // The runChat shell hands the loaded graph straight in; the pure runTurn(config)
  // path (tests, chatbench) does not, so load it the same way dispatchTool does when
  // it's missing. Failure-tolerated: no loadable graph → no concept force.
  let g = graph;
  if (!g && config && source) {
    try { g = parseEntities(await source.fetchEntities(config)); } catch { g = null; }
  }
  if (!g) return null;
  const rows = memoryDir ? await factRows(memoryDir) : [];
  let composed;
  try { composed = composeConcept(g, term, { definition, factRows: rows }); }
  catch { return null; }
  if (!composed) return null;
  const rendered = tRender(templates, T_CONCEPT, {
    definition: composed.definition, examples: composed.examples, followups: composed.followups,
  });
  const text = rendered ?? `${composed.definition}\n${composed.examples}${composed.followups}`;
  const pending = composed.remainder && composed.remainder.length
    ? { items: composed.remainder, noun: composed.noun }
    : null;
  return { text, instances: composed.instances, allIds: composed.allInstanceIds, pending };
}

/** A bare question → tmct_ask. When a focus is set AND the graph is in hand we
 *  call ask() directly to thread the focus as contextId (so a pronoun like "it"
 *  resolves to the focus) — building the SAME delimited string dispatchTool emits;
 *  otherwise the unchanged dispatchTool path (which also yields the no-graph error).
 *  A hit updates the focus to the resolved object. Grammar miss / ToolError → a
 *  normal answer, never a crash. */
async function runAsk(query, { config, source, graph, focus, last, templates, memoryDir, sessionId = "", lexicon = null, env, trace, vocabHint = null }) {
  const ts = new Date().toISOString();
  // DISCOURSE ANAPHORA (CHATBENCH_006 levers 1+2): a follow-up like "which of those
  // are tested" / "how many of those" / "count them" filters or counts the PREVIOUS
  // answer's entity set. That set is the ids the last dispatched turn cited — carried
  // on `last.detail.matches`. Threading it as ask()'s `prev` is what lets the anaphora
  // node resolve instead of the "needs a previous answer" honest miss.
  // Prefer the FULL id set (`allIds`) when the last turn carried one — a concept-force
  // listing caps its shown `matches` at MAX_EXAMPLES, so counting `matches` alone would
  // undercount "count them" over a truncated listing (CHATBENCH_0.7.1 discourse-count).
  const prev = (last?.detail?.allIds && last.detail.allIds.length)
    ? last.detail.allIds.filter(Boolean)
    : (last?.detail?.matches || []).map((m) => m?.id).filter(Boolean);
  // The query the ENGINE parses: a "what about X" continuation is rewritten to the
  // prior shape with X swapped in; everything else parses verbatim. The record and
  // transcript keep the user's ACTUAL words (`query`), only the parse target changes.
  const askQuery = discourseRewrite(query, last) ?? query;
  // W2: the explicit recall forms are answered from memory's folded blocks, never
  // the graph. Gated on memoryDir — a bare runTurn (no session shell) stays pure.
  if (memoryDir && RECALL_ASK_RE.test(String(query).trim())) {
    note(trace, "goal: recall what was discussed earlier (explicit recall phrasing)");
    note(trace, "lane: RECALL_ASK_RE matched — answered from folded-session memory, never the graph");
    const summary = await recallSummary(memoryDir);
    note(trace, summary ? "source: memory/fold.mjs recallSummary" : "intermediate: no folded session blocks yet — nothing to recall");
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
    note(trace, `intermediate: the ask engine threw — ${answer}`);
  }
  // NARRATE: the direct parse/traversal receipt, straight off ask()'s own envelope
  // (§6.2) — this alone covers most of "the version of prompt that matched" and
  // "intermediate information" with ZERO extra instrumentation of ask.mjs: `parsed`
  // is the compiled AST (shape/kind/entityType or a compositional {node:...}),
  // `relaxed` is the FULL relaxation-cascade trace (what noise/unmatched tokens the
  // engine stripped/corrected before it found an answerable parse — exactly the
  // "almost resolved but failed" near-miss detail a playtest debugging session
  // wants), and `matchedVia` names the confidence tier (prose/fuzzy) a resolution
  // fell through to.
  if (envelope?.parsed) {
    const p = envelope.parsed;
    const shape = p.node ? `node=${p.node}` : `shape=${p.shape}`;
    note(trace, `pattern: parsed AST — ${shape}${p.kind ? ` kind=${p.kind}` : ""}${p.entityType ? ` entityType=${p.entityType}` : ""}${p.object != null ? ` object="${p.object}"` : ""}${p.term != null ? ` term="${p.term}"` : ""}`);
  } else {
    note(trace, "pattern: no parse stood (direct grammar miss — every registered strategy declined)");
  }
  if (envelope?.relaxed) {
    const r = envelope.relaxed;
    note(trace, `intermediate: the direct parse missed — the relaxation cascade rescued it: "${r.from}" -> "${r.to}"${r.dropped?.length ? ` (dropped: ${r.dropped.join(", ")})` : ""}`);
    if (r.steps?.length) note(trace, `intermediate: relaxation steps — ${r.steps.join(" | ")}`);
  }
  if (envelope?.matchedVia) note(trace, `source: term resolved via the "${envelope.matchedVia}" confidence tier (not a literal identifier match)`);
  if (envelope?.ambiguous) note(trace, "intermediate: the resolved term was AMBIGUOUS — multiple candidates matched, see the answer's disambiguation prompt");
  // A grammar miss has parsed:null → stays []. An empty-RESULT query (object resolved,
  // no edges) still records the resolved subject — that IS the asksAbout signal, and
  // it becomes the new focus so a follow-up "what calls it" can reuse it.
  let resolvedIds = [];
  let newFocus = focus;
  if (graph && envelope?.parsed?.object) {
    const obj = envelope.parsed.object;
    // A PRONOUN object ("it"/"this") was already resolved against the focus via
    // contextId — the resolved antecedent IS the focus. Re-resolving the literal
    // pronoun string is the CHATBENCH_0.7.1 B1-pron bug: "it" substring-matches the
    // "Commit" schema node (label contains "it"), so the focus jumped off the module
    // to a Commit and the NEXT "it" bound wrong. Reuse the focus directly instead.
    const ent = (isPronoun(obj) && focus?.id) ? focus : await resolveEntity(graph, obj);
    if (ent) {
      resolvedIds = [ent.id];
      // Class-gate the focus update: a Commit/Session/schema object never displaces a
      // standing code-entity focus (see nextFocus).
      newFocus = nextFocus(graph, focus, ent);
      note(trace, `result: resolved object "${obj}" -> ${ent.label} (${ent.id}) — becomes the new focus`);
    } else if (!isPronoun(obj)) {
      note(trace, `intermediate: object "${obj}" did NOT resolve to a graph entity — this is why an otherwise-parsed query still misses`);
    }
  }
  const answeredIds = (envelope?.matches || []).map((m) => m?.id).filter(Boolean);
  const miss = envelope ? !!envelope.miss : true;
  // Answer provenance (W1): "composed" is the ask engine's productive band; the
  // orientation swap below is template wording, so those turns carry via:"template".
  let via = "composed";
  let recordMiss = miss;
  let factPending = null; // a truncated fact listing's held remainder (for "more" paging)
  // GOAL DEDUCTION: from the parsed AST when one stood (deterministic, table-driven —
  // see deduceGoalFromParsed); a total grammar miss (no parse at all) gets the honest
  // "didn't resolve" goal line verbatim, matching the operator's own wording for that
  // case. Pushed once, EARLY (before the miss cascade below may go on to answer via a
  // completely different lane — an intent lane's own goal note, when it pushes one,
  // stays the more specific of the two since bucketTrace keeps every "goal:" line and
  // renderNarration shows them all, most-specific-last-written).
  {
    const deduced = deduceGoalFromParsed(envelope?.parsed);
    note(trace, `goal: ${deduced ?? "unclear — the phrasing didn't resolve to a known query shape"}`);
  }
  // MISS handling. The intent lanes + short-miss are RECOGNIZER-gated on the query
  // text AND only consulted on a would-miss, so a real graph query — a hit, an honest
  // empty with a receipt, a fuzzy repair — is never hijacked. Order: (1) META/SELF
  // lane (would-miss), (2) conversational orientation (would-miss), (3) memory
  // facts/recall (a fact EXTENDS a non-miss schema hit too — NOT miss-gated),
  // (4) TEACH lane (would-miss), (5) the short tailored miss (would-miss).
  let handled = false;
  // (1) #2 META/SELF: bare self/session questions ("what do you know", "what is this
  // codebase", "how do i start") → a summary / orientation, answered before the
  // fact-dump readers so "what do you know" gets a summary, not raw facts.
  if (miss) {
    const meta = await metaLane(query, { graph, memoryDir, last, templates, vocabHint });
    if (meta) {
      answer = meta.text; via = meta.via; recordMiss = false; handled = true;
      note(trace, `lane: (1) META/SELF — bare self/session question recognized, answered via="${meta.via}"`);
    }
  }
  if (!handled && miss && !envelope?.parsed && isConversational(query)) {
    // A conversational miss (a greeting, "what can you do", a very short non-code
    // line) gets the friendly orientation (module-aware: empty → --repo/tmct init).
    // Bug B1 (0.8.2 follow-up): this branch carries via:"template" and never
    // reaches the composed-only wall-shortening gate below, so a second
    // identical orientation-class turn used to repeat the full blurb verbatim —
    // collapse to a one-liner on that repeat, mirroring WALL_REPEAT_ONELINER.
    //
    // `!envelope?.parsed` (Track-1 trio, pronoun/focus binding — "biggest movable
    // mass"): isConversational() is a TEXT-ONLY heuristic (≤3 words, no code-ish
    // token) — it has no way to know the query already compiled to a real
    // structural AST shape. A pronoun-shortened follow-up ("who touched it"/
    // "that"/"this") is exactly 3 words and "touched" isn't in STRUCT_WORDS, so
    // isConversational used to fire AFTER ask() had already parsed the reverse
    // "touches" shape, resolved the pronoun off the focus, run the traversal, and
    // composed an honest (possibly empty) answer — discarding that correct answer
    // for the generic orientation wall. When envelope.parsed stood, the query WAS
    // structural (by construction, not word-count guesswork); its own composed
    // answer — hit, honest empty, or "it needs a referent" — is always more
    // truthful than the orientation card.
    const orientation = orientationAnswer(templates, graph, vocabHint);
    const repeat = last?.answer === orientation;
    answer = repeat ? ORIENTATION_REPEAT_ONELINER : orientation;
    via = "template"; handled = true;
    note(trace, `lane: (2) conversational orientation — isConversational() matched a would-miss; ${repeat ? "REPEAT collapsed to one-liner" : "full orientation card"}`);
    note(trace, "goal: casual/social or too-short-to-be-structural — no graph intent");
  } else if (!handled && memoryDir) {
    // W4: vocabulary/definition questions consult the MEMORY graph's Facts alongside
    // the schema-docs surface — a remembered fact answers a miss OR extends a (non-
    // miss) schema hit, cited with its provenance verbatim. Checked BEFORE recall: a
    // reified fact is stronger evidence than a transcript echo. Subject-side facts
    // first (factAnswer), then the reverse-membership read-back (factReadBack) so an
    // asserted "every X is a Y" answers "what is a Y" too.
    const fact = (await factAnswer(memoryDir, query, envelope, miss))
      ?? (await factReadBack(memoryDir, query, envelope, miss, graph));
    if (fact) {
      answer = fact.replace ? fact.text : `${answer}\n${fact.text}`;
      via = "fact";
      recordMiss = false;
      if (fact.pending) factPending = fact.pending; // a truncated fact list → paginable remainder
      note(trace, `lane: (3) memory facts — factAnswer/factReadBack matched (memoryDir=${memoryDir})`);
      note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
    } else if (miss) {
      // W2: after the honest miss is composed, consult the folded-session memory. A
      // relevant enough block ANSWERS — recalled Q/A framed + cited first, with the
      // engine's own miss hint kept below; no hit leaves the miss byte-unchanged.
      const recalled = await recallFromBlocks(memoryDir, query, graph);
      if (recalled) {
        // Bug A root cause 2 (0.8.2 follow-up): a successful recall always sets
        // recordMiss = false below, which is the SAME flag the composed-path
        // wall-shortening pass (further down) gates on — so a recall-then-wall
        // combo used to carry the full, un-shortened grammar-cheat-sheet dump on
        // every repeat, never collapsing to shortMissHint/WALL_REPEAT_ONELINER the
        // way a plain wall does. Apply the identical shortening/repeat-suppression
        // logic to the TRAILING miss text here, keyed off the same WALL_MISS_RE +
        // `last` check (using the non-anchored twin, since a repeated
        // recall-then-wall's own last answer is itself prefixed with the recall
        // frame, not starting with the wall text).
        let trailing = answer;
        if (WALL_MISS_RE.test(trailing)) {
          trailing = (last?.answer && WALL_MISS_ANYWHERE_RE.test(String(last.answer)))
            ? WALL_REPEAT_ONELINER
            : shortMissHint(query);
        }
        answer = `${recalled}\n\n${trailing}`;
        via = "recall";
        recordMiss = false; // memory answered it, cited — no longer a blank
        note(trace, "lane: (3) memory recall — recallFromBlocks matched a folded-session Q/A above the relevance floor");
        note(trace, "source: .tmct/memory folded session blocks (fold.mjs)");
      }
    }
  }
  // CURATED SEON DEFINITION (corpus/seon) — a "what is a <lexicon term>" prefers the
  // curated prose definition over the seon concept fact / schema-docs / honest miss.
  // Runs after the fact branch and overrides its corpus-fact answer (via:"fact"), but
  // curatedDefinitionAnswer itself defers to a user-asserted (ace:chat) fact, so a
  // "you told me" answer already standing is left untouched. Skips the meta/self +
  // conversational lanes (via:"meta"/"template"), which answer a different question.
  if (via === "composed" || via === "fact") {
    const def = await curatedDefinitionAnswer(query, envelope, { memoryDir, lexicon });
    if (def) {
      answer = def.text; via = "corpus/seon"; recordMiss = false;
      note(trace, "lane: CURATED SEON DEFINITION — curatedDefinitionAnswer matched a lexicon term");
      note(trace, "source: corpus/seon (curated prose definition, licensed per data/corpus/seon)");
    }
  }
  // THE CONCEPT FORCE (concept.mjs) — a vague "what is a X" / "tell me about X" that
  // names a KNOWN code concept WITH real instances composes the three-band answer
  // (definition + real examples + pre-validated follow-ups), superseding the bare
  // schema-doc / curated-definition surface (both corpus-sourced). It declines unless
  // the term is a known, instance-bearing concept, so a precise query, an unknown
  // term, or an instance-less concept is never hijacked — the ordinary answer stands.
  // Runs after the corpus-fact/curated branches (via composed|corpus/seon) but not
  // over a "you told me" fact, a meta/self summary, or the conversational lanes.
  let conceptInstances = null;
  let conceptAllIds = null;
  let conceptPending = null;
  if (via === "composed" || via === "corpus/seon") {
    const concept = await conceptForceAnswer(query, envelope, { graph, config, source, memoryDir, templates });
    if (concept) {
      answer = concept.text; via = "corpus/seon"; recordMiss = false;
      conceptInstances = concept.instances;
      conceptAllIds = concept.allIds;
      conceptPending = concept.pending;
      note(trace, `lane: THE CONCEPT FORCE — a known code concept with ${concept.instances?.length ?? 0} real instance(s) composed the 3-band answer`);
      note(trace, "source: concept.mjs composeConcept — graph instances + corpus/seon definition");
    } else {
      // THE RELATION CONCEPT FORCE — the noun force declined, so try the edge-kind
      // touch ("what about imports", "what are the calls", "tell me about contains").
      // Same three-band shape over real EDGES; declines unless the term is a known,
      // edge-bearing relation, so a precise query / unknown word is never hijacked.
      // For a "what about <relation>" this also SUPERSEDES the discourse rewrite's
      // dead-end (rewriting the prior question with a relation word rarely resolves) —
      // but only when the touched word is a relation concept; a real entity name in
      // "what about X" declines here and the discourse continuation stands.
      const relation = await relationForceAnswer(query, envelope, { graph, config, source, templates });
      if (relation) {
        answer = relation.text; via = "corpus/seon"; recordMiss = false;
        conceptPending = relation.pending;
        note(trace, "lane: THE RELATION CONCEPT FORCE — the touched word named a known, edge-bearing relation kind");
        note(trace, "source: relationForceAnswer over the loaded graph's own edges (not corpus)");
      }
    }
  }
  // (3b) ONTOLOGY SYNONYM EXPANSION (PLAN_ontology-hierarchies.md §3 tracks
  // a+b) — a LAST-RESORT vocabulary-term retry via known synonyms, tried only
  // once composed/fact/corpus-seon have ALL declined (via === "composed" still
  // standing here), so it can never hijack a real schema/concept-force answer
  // (see synonymFactAnswer's own docblock for why gating on miss alone isn't
  // enough). Every hit cites its synonym term + licensing corpus source.
  if (miss && recordMiss && via === "composed") {
    const syn = await synonymFactAnswer(memoryDir, query, envelope);
    if (syn) {
      answer = syn.text; via = "fact"; recordMiss = false;
      if (syn.pending) factPending = syn.pending;
      note(trace, "lane: (3b) ONTOLOGY SYNONYM EXPANSION — a last-resort synonym of the term had direct facts");
      note(trace, "source: .tmct/memory Facts, reached via a known synonym (cited in the answer itself)");
    }
  }
  // (4) #2 TEACH lane — a teach-shaped would-miss nothing above answered: route to
  // memory, or say what CAN be remembered (LOUD), never the wall / a silent drop.
  if (miss && recordMiss && via === "composed") {
    const taught = await teachLane(query, { memoryDir, sessionId, lexicon });
    if (taught) {
      answer = taught.text; via = taught.via; recordMiss = taught.miss;
      note(trace, `lane: (4) TEACH — TEACH_RE/OWNS_TEACH_RE/BARE_DECLARATIVE_RE matched, ${taught.miss ? "but the payload could not be stored" : "reified into .tmct/memory"}`);
      note(trace, "goal: teach/remember a new fact");
    }
  }
  // (4b) #4 AUTHOR lane (0.8.2 WS4) — "who is <Name>", "what did <Name> touch",
  // "who authored <sha>": the Commit author ATTRIBUTE answered as a person, off
  // codegraph.mjs's authorIndex renderers. Closed regexes + an exact case-
  // insensitive author hit only; an unknown name falls through to the ordinary
  // honest miss below (never a guess).
  if (miss && recordMiss && via === "composed") {
    const authored = authorLane(query, { graph });
    if (authored) {
      answer = authored.text; via = authored.via; recordMiss = false;
      note(trace, "lane: (4b) AUTHOR — a who-is/what-did-<Name>-touch/who-authored-<sha> pattern matched a commit author");
      note(trace, "source: codegraph.mjs authorIndex (derived from Commit individuals)");
      note(trace, "goal: identify a person and/or what they touched (authorship/history)");
    }
  }
  // (4b2) #5(f) PRESUPPOSITION HONEST-NUDGE (ADVANCED_GRAMMAR track f) — "why
  // does X still/again import Y": names the presupposition being checked
  // (against the graph, confidently) before answering what survives. A
  // CONFIRMED presupposition is a real answer (recordMiss:false); a REFUTED
  // one is still an honest, confident correction, not a miss.
  if (miss && recordMiss && via === "composed") {
    const presup = await presuppositionNudge(query, { graph, memoryDir });
    if (presup) {
      answer = presup.text; via = "presupposition"; recordMiss = false;
      note(trace, "lane: (4b2) PRESUPPOSITION HONEST-NUDGE — a still/again-marked question's presupposition was checked against the graph");
      note(trace, "goal: verify an assumption baked into the question, then answer what survives");
    }
  }
  // (4c) CAPABILITY NUDGES (0.8.2 WS4) — risk scoring / code opinions / "write me
  // code" imperatives / motive-"why": an honest wall pointing at the nearest real
  // query shapes. recordMiss stays TRUE — a capability wall is still a miss and
  // must never become a recallable answer. The opinion gate fires HERE, before the
  // short-miss's "is a <thing> a <kind>" membership hint could claim the line.
  if (miss && recordMiss && via === "composed") {
    const nudged = nudgeAnswer(query, newFocus);
    if (nudged) {
      answer = nudged; via = "miss";
      note(trace, "lane: (4c) CAPABILITY NUDGE — the question asked tmct to do something outside its scope (opinion/generation/risk-scoring)");
      note(trace, "goal: out of scope for a no-LLM graph reader — pointed at the nearest real query shapes");
    }
  }
  // (4d) DESCRIBE-WRAPPER RESCUE (playtest sprint round 2, SKILL_PLAYTEST_SPRINT.md)
  // — "can you describe X for me" / "tell me more about X": a closed wrapper
  // around an ordinary polite request naming a symbol. Tried ONLY here, after
  // EVERY other lane (concept force, relation force, teach, author,
  // presupposition, capability nudges) has already declined — "tell me about
  // inheritance" must keep reaching the relation force's richer answer
  // unmolested (that regression is exactly why this ISN'T inside asBareCommand,
  // which runs first and would preempt every lane above). A last-resort rescue
  // for what would otherwise become the generic wall, never a competing route:
  // it only claims the turn if /describe actually resolves the captured term.
  if (miss && recordMiss && via === "composed") {
    const described = await describeWrapperAnswer(query, { config, source });
    if (described) {
      answer = described.text; via = "describe"; recordMiss = false;
      note(trace, "lane: (4d) DESCRIBE-WRAPPER RESCUE — a polite wrapper around \"describe/tell me about <symbol>\" resolved via /describe, tried last after every other lane declined");
      note(trace, "goal: get a symbol's definition/kind/relations (phrased conversationally)");
    }
  }
  // (5) #1 SHORT TAILORED MISS — replace ONLY the engine's full grammar cheat-sheet
  // wall (WALL_MISS_RE). Receipt-bearing misses keep their specific wording.
  // WALL KINDNESS (0.8.2 WS4 (a)): when the PREVIOUS turn's answer was already a
  // wall/short-miss (it matched WALL_MISS_RE), the second consecutive wall collapses
  // to a one-liner whose text does NOT match WALL_MISS_RE — self-limiting, so a
  // third consecutive miss re-offers the tailored hint instead of droning.
  if (miss && recordMiss && via === "composed" && WALL_MISS_RE.test(answer)) {
    const repeat = last?.answer && WALL_MISS_RE.test(String(last.answer));
    answer = repeat ? WALL_REPEAT_ONELINER : shortMissHint(query);
    via = "miss";
    note(trace, `lane: (5) SHORT TAILORED MISS — every lane above declined; ${repeat ? "REPEAT collapsed to one-liner (wall kindness)" : "the full grammar wall was shortened + tailored to the query's keywords"}`);
  }
  // #4 HONEST-EMPTY POLISH — an empty CODE graph: any still-standing engine
  // dead-end (an honest empty, the short miss, the bootstrap note) carries the exit
  // toward a real graph, unless it already points there. Only when genuinely empty.
  if (recordMiss && (via === "composed" || via === "miss")
      && noCodeGraph(graph) && !/--repo|tmct init|no code graph/i.test(answer)) {
    answer = `${answer}\n(this repo has no code graph — for structure, point me at a \`.tmct/graph.json\` with \`--repo <path>\` or run \`npm run example:mini\`; tmct doesn't index code itself.)`;
    note(trace, "intermediate: HONEST-EMPTY POLISH — the loaded graph has 0 modules, so the dead-end got a --repo/tmct init pointer appended");
  }
  // W5 (flag-gated, default OFF): an unknown-term miss may consult the LOCAL
  // committed corpus slice — a hit APPENDS a grounded, licence-cited aside under
  // the honest miss (the miss itself stands; the aside is context, not an answer).
  if (recordMiss && envelope?.parsed?.object && String(env?.[CORPUS_LOOKUP_FLAG] || "") === "1") {
    const aside = await corpusAside(envelope.parsed.object);
    if (aside) {
      answer = `${answer}\n${aside}`;
      via = "corpus";
      note(trace, "lane: W5 corpus aside — an unknown term matched the local committed corpus slice (TMCT_CORPUS_LOOKUP=1)");
      note(trace, "source: local committed corpus slice (licence-cited in the aside itself)");
    }
  }
  // ADVANCED_GRAMMAR track (a) — counterfactual marker (PLAN_ADVANCED_GRAMMAR.md
  // §2a): "if X were deleted, what would break" compiles to a REAL traversal
  // (interpret/normalize.mjs's COUNTERFACTUAL_RE rewrite, "which modules
  // transitively import X") — but the consequent is hypothetical, so a plain
  // traversal answer would over-claim it as present-tense fact. normalize.mjs
  // only rewrites the QUESTION; this names the SAME raw query shape here (the
  // one seam that sees both the original text and the final answer) and marks
  // the answer as conditional. Gated to a genuine non-miss composed traversal
  // — a counterfactual that happens to miss keeps its ordinary honest-miss
  // wording, never a fabricated "hypothetically" wrapper around a blank.
  const counterfactualSubject = String(query).trim().match(COUNTERFACTUAL_RE);
  if (!recordMiss && via === "composed" && counterfactualSubject) {
    answer = `hypothetically, if ${counterfactualSubject[1].trim()} were removed: ${answer}`;
    note(trace, `intermediate: COUNTERFACTUAL_RE matched — compiled to a real traversal, wrapped as hypothetical ("${counterfactualSubject[1].trim()}" removed)`);
  }
  // The concept force answers WITH real example instances — those are the entities the
  // turn "asked about" (the SchemaClass meta-node is documentation, not a code entity),
  // so record + expand them, not the schema match.
  const finalAnsweredIds = conceptInstances ? conceptInstances.map((i) => i.id) : answeredIds;
  const record = { type: "turn", ts, query, via, resolvedIds, answeredIds: finalAnsweredIds, miss: recordMiss };
  const logLines = [ts, `> ${query}`, answer, ""];
  // `detail` feeds why/say-more's verbose re-render: the traversal receipt + the
  // matched entities the terse render trims (see renderVerbose). `pending` carries a
  // truncated listing's held remainder for "more" paging — the concept/relation force
  // holds it on conceptPending (the relation force resolves no instance ids, so it can
  // still page even with an empty matches set); a fact listing holds it on factPending.
  const pending = conceptPending ?? factPending;
  // `allIds` carries the FULL result-set ids (uncapped) so discourse-count anaphora
  // ("count them" / "how many of those") survives a truncated render: the concept
  // force shows only MAX_EXAMPLES instances on `matches`, but a follow-up count must
  // see them all. The ordinary ask-engine listing already carries its whole set on
  // `matches`, so only the concept force needs the extra field (a full id array).
  const allIds = conceptAllIds && conceptAllIds.length ? conceptAllIds : null;
  const detail = conceptInstances
    ? { traversal: envelope?.traversal || null, matches: conceptInstances, ...(allIds ? { allIds } : {}), ...(pending ? { pending } : {}) }
    : (envelope
      ? { traversal: envelope.traversal || null, matches: envelope.matches || [], ...(pending ? { pending } : {}) }
      : (pending ? { traversal: null, matches: [], pending } : null));
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

/** A slash-command → the mapped tool (or the /help, /focus, /narrate, unknown
 *  cases). Returns the same { answer, logLines, record, focus } shape as
 *  runAsk; the record carries the command name and the resolved entity id
 *  (for entity commands) so a slash-command turn becomes asksAbout graph data
 *  wherever it resolves an entity. `ctx.trace` (narrate mode, or undefined
 *  when off) gets one "goal:"/"lane:" note per branch — a slash-command's
 *  "decision" is simply which command+tool ran, so this is intentionally
 *  lighter than runAsk's miss-cascade instrumentation. */
async function runCommand(line, { config, source, graph, focus, memoryDir, trace, narrate = false }) {
  const ts = new Date().toISOString();
  const sp = line.indexOf(" ");
  const name = (sp === -1 ? line.slice(1) : line.slice(1, sp)).toLowerCase();
  const argText = (sp === -1 ? "" : line.slice(sp + 1)).trim();
  const mk = (answer, { resolvedIds = [], miss = false, newFocus = focus, narrateNext } = {}) => ({
    answer,
    logLines: [ts, `> ${line}`, answer, ""],
    record: { type: "turn", ts, query: line, command: name, via: "command", resolvedIds, answeredIds: [], miss },
    focus: newFocus,
    ...(narrateNext !== undefined ? { narrate: narrateNext } : {}),
  });

  if (name === "help") { note(trace, "goal: get oriented / learn available commands"); return mk(await helpText()); }
  if (name === "stats") {
    note(trace, "goal: get a one-screen overview of the loaded graph");
    return graph ? mk(renderStats(graph)) : mk("no graph loaded — /stats needs an index.", { miss: true });
  }

  // /narrate on|off — the debug-mode toggle itself (session-scoped, mirrors the
  // /focus pattern: the new state rides the turn RESULT as `narrate`, and
  // createSession's turn() applies it to its own mutable state; a bare
  // runTurn caller threads it the same way it threads `focus`/`last`). A
  // status-only "/narrate" (no on/off) reports the CURRENT state and changes
  // nothing — never silently flips it.
  if (name === "narrate") {
    const arg = argText.toLowerCase();
    if (arg !== "on" && arg !== "off") {
      return mk(`narrate mode is ${narrate ? "on" : "off"} — /narrate on or /narrate off to change it.`);
    }
    const next = arg === "on";
    return mk(`narrate mode ${next ? "on" : "off"}.`, { narrateNext: next });
  }

  // /memory [verbose] — what tmct remembers, as text (the ROADMAP "Memory
  // inspection" surface; the same renderer serves the `tmct memory` CLI).
  if (name === "memory") {
    note(trace, "goal: inspect tmct's memory store (facts/utterances/sessions)");
    if (!memoryDir) return mk("no memory store here — /memory works inside a repo session.", { miss: true });
    try {
      const { inspectMemory } = await import("./memory/inspect.mjs");
      return mk(await inspectMemory(memoryDir, { verbose: /^(?:-v|--verbose|verbose)$/i.test(argText) }));
    } catch (e) {
      return mk(String(e?.message || e), { miss: true }); // a broken store reads as its own clean error
    }
  }

  if (name === "focus") {
    note(trace, "goal: set the working focus entity for follow-up pronouns (it/this/that)");
    if (!argText) return mk(focus ? `focus is ${focus.label}` : "no focus set — /focus <symbol> to set one.");
    const ent = await resolveEntity(graph, isPronoun(argText) ? focus?.label : argText);
    if (!ent) return mk(`could not resolve "${argText}" to a single entity — focus unchanged${focus ? ` (still ${focus.label})` : ""}.`, { miss: true });
    note(trace, `result: resolved "${argText}" -> ${ent.label} (${ent.id})`);
    return mk(`focus set to ${ent.label}.`, { resolvedIds: [ent.id], newFocus: ent });
  }

  const spec = COMMANDS[name];
  if (!spec) {
    note(trace, `pattern: /${name} is not a registered command (see COMMANDS in src/chat.mjs)`);
    return mk(`unknown command /${name} — type /help for the list of commands.`, { miss: true });
  }
  note(trace, `goal: ${spec.help}`);
  note(trace, `lane: slash-command /${name} -> dispatchTool("${spec.tool}"${spec.arg ? `, {${spec.arg}}` : ""})`);

  const entityArg = ENTITY_ARGS.has(spec.arg);
  let value = argText;
  if (entityArg && (!value || isPronoun(value))) {
    value = focus?.label || "";
    if (value) note(trace, `intermediate: no/pronoun argument -> fell back to the standing focus "${value}"`);
  }
  if (spec.arg && !spec.optional && !value) {
    const need = entityArg ? `${spec.arg} (none given and no focus set — /focus <x> or pass one)` : spec.arg;
    return mk(`/${name} needs a ${need}.`, { miss: true });
  }

  let answer;
  try {
    answer = await dispatchTool(spec.tool, spec.arg ? { [spec.arg]: value } : {}, { config, source });
  } catch (e) {
    note(trace, `intermediate: dispatchTool("${spec.tool}") threw — ${String(e?.message || e)}`);
    return mk(String(e?.message || e), { miss: true }); // the tool's own clean error, never a stack
  }
  // Entity commands resolve their subject for the sidecar/graph AND set the focus so a
  // follow-up ("what calls it", a no-arg /context) reuses it.
  if (entityArg) {
    const ent = await resolveEntity(graph, value);
    // Same class-gate as the ask path (nextFocus): a command whose arg resolves to a
    // Commit/Session/schema node records the resolution but does not displace a
    // standing code-entity focus that "it" is meant to keep binding to.
    if (ent) {
      note(trace, `result: resolved "${value}" -> ${ent.label} (${ent.id}, class=${graph?.byId?.get?.(ent.id)?.class || "?"})`);
      // Bug B4 (0.8.2 follow-up): /describe's code-map render never sees memory,
      // so a taught fact about the resolved entity is invisible to it — append
      // matching taught facts (subject === the resolved entity, trust-ranked)
      // under the code-map answer, mirroring the ask-path's fact-append pattern.
      if (name === "describe" && memoryDir) {
        const facts = await describedFacts(memoryDir, ent.label);
        if (facts) { answer = `${answer}\n${facts}`; note(trace, "source: memory facts (describedFacts) appended to the code-map answer"); }
      }
      return mk(answer, { resolvedIds: [ent.id], newFocus: nextFocus(graph, focus, ent) });
    }
    note(trace, `intermediate: "${value}" did not resolve to a single entity — the tool's own (unresolved) answer stands`);
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
// ---- "more" pagination — a long examples/facts listing shows the first PAGE
// entries and holds the remainder on the turn's `last.detail.pending`; a bare
// "more"/"show more"/"the rest" in the NEXT turn renders the next batch, advancing
// the same pending state. Any other (real) query produces a fresh `last` without
// `pending`, so the remainder is naturally cleared — no stale continuation. ----
const PAGE = 32;
const MORE_RE = /^(?:more|show more|see more|the rest|next|continue|go on)\b[.!?]*$/i;
const joinList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}` : (a[0] ?? ""));

/** Render the next page of a held remainder (pending: {items:[str], noun}). Returns a
 *  plain turn whose `detail.pending` carries what's still unseen (null when the batch
 *  finished the list), so a follow-on "more" continues. */
function morePage(query, { last, focus }) {
  const p = last.detail.pending;
  const batch = p.items.slice(0, PAGE);
  const rest = p.items.slice(PAGE);
  const tail = rest.length ? ` …and ${rest.length} more — say 'more' to see them.` : "";
  const answer = `${joinList(batch)}.${tail}`;
  const turn = plainTurn(query, answer, { via: "count", focus });
  turn.detail = { traversal: null, matches: [], ...(rest.length ? { pending: { items: rest, noun: p.noun } } : {}) };
  return turn;
}

export async function runTurn(input, { config, source = defaultSource, graph = null, focus = null, last = null, memoryDir = null, sessionId = "", env = process.env, lexicon = null, narrate = false, vocabHint = null } = {}) {
  const line = String(input ?? "").trim();
  const templates = await chatTemplates(); // failure-tolerated: null degrades, never throws
  // narrate mode: allocate the mutable trace array ONLY when on (`null` when off,
  // matching every OTHER optional collaborator here — templates/memoryDir/lexicon
  // all null-degrade the same way). Every note()/withNarration() call below is a
  // cheap `if (trace)`/`if (!trace || !trace.length)` no-op when this is null, so
  // the narrate:false path allocates nothing extra and renders byte-identically to
  // before this feature existed — see the "---- narrate mode ----" section above.
  const trace = narrate ? [] : null;
  // vocabHint: createSession computes this ONCE per session (a marker-file check)
  // and threads it in; a direct runTurn() caller (tests, library use) that doesn't
  // pass one gets it computed here instead, so "try this vocabulary example" is
  // never wrong regardless of caller.
  const resolvedVocabHint = vocabHint ?? vocabExampleHint(await hasSeededVocabulary(memoryDir));
  const ctx = { config, source, graph, focus, last, memoryDir, sessionId, templates, env, lexicon, trace, narrate, vocabHint: resolvedVocabHint };
  // A DISPATCHED turn (count / slash-command / ask) becomes the new "last answer"
  // that why/say-more re-renders; a conversational turn does not (it preserves it).
  // FINISH SEAM (PLAN_RESPONSE_FINISHING §"Where it lives"): every dispatched turn's
  // result passes through finish() here — the LAST transform in the turn — before its
  // finished answer becomes the `last` we expand. finish() owns the prose-span
  // grammar pass (src/finish.mjs); it rewrites result.answer/logLines and leaves the
  // protected spans (entities, paths, numbers, receipts, provenance) byte-invariant,
  // so `last` and the transcript stay consistent with what the shell prints. The
  // narrate block (withNarration, above) is applied AFTER `last` is captured from
  // the PRE-narration finished result — see withNarration's docblock for why.
  const withLast = (result, fallbackGoal = "unclear — no goal signal for this turn type") => {
    const finished = finish(result, { graph });
    const nextLast = { query: line, answer: finished.answer, detail: finished.detail ?? null };
    return { ...withNarration(finished, trace, fallbackGoal), last: nextLast };
  };

  // Slash-optional system commands: a bare leading command word ("stats",
  // "memory", "describe X") is routed to its slash form BEFORE the conversational
  // layer, so a forgiving shell answers "stats" the way it answers "/stats" instead
  // of falling through to the generic orientation.
  const bareCmd = asBareCommand(line);
  if (bareCmd) return withLast(await runCommand(bareCmd, ctx), "use a specific tool/command directly");

  // Conversational layer next (greetings, thanks, help, bye, why/say-more) — these
  // resolve no entity and carry their own preserved `last`. Bypasses withLast (a
  // conversational turn is never finish()'d / never becomes a new `last`), so the
  // narrate block is applied directly here instead.
  const convo = conversationalTurn(line, ctx);
  if (convo) return withNarration(convo, trace, "casual/social — no graph intent");

  // "more" — page the remainder of a previous long listing, if one is held. Gated on
  // an actual pending remainder so a bare "more" with nothing to continue falls through
  // to the ordinary path (an honest miss), never a pretend page.
  if (MORE_RE.test(line) && Array.isArray(last?.detail?.pending?.items) && last.detail.pending.items.length) {
    note(trace, "goal: continue viewing a previous long listing (pagination)");
    note(trace, "lane: MORE_RE matched a held pending remainder from the previous turn's detail.pending");
    return withLast(morePage(line, ctx), "continue viewing a previous long listing");
  }

  if (line.startsWith("/")) return withLast(await runCommand(line, ctx), "use a specific tool/command directly");
  // Declarative ACE sentences ("every module is a artifact") ASSERT into tmct's
  // own memory and confirm — they are statements to remember, not graph queries.
  // Gated on memoryDir: only a session shell provides a write target, so a bare
  // runTurn (tests, library callers) stays pure and falls through to the engine.
  if (memoryDir) {
    const asserted = await assertTurn(line, ctx);
    if (asserted) {
      note(trace, "goal: teach/remember a new fact (declarative ACE sentence)");
      note(trace, "lane: assertTurn — grammar/ace.mjs parseAce matched a full triple with no residue");
      return withLast(asserted, "teach/remember a new fact");
    }
  }
  // MEMORY-STORE counts first ("how many facts / utterances do you know") — the
  // memory graph owns Facts + Utterances, so these are answerable and consistent
  // with `/memory`. Checked before answerCount (which reads the CODE graph and would
  // otherwise say "I can't count facts"); it only speaks for a memory-class noun, so
  // structural counts (classes/functions/…) and sessions fall through unaffected.
  if (memoryDir) {
    const memCount = await answerMemoryCount(memoryDir, line);
    if (memCount != null) {
      note(trace, "goal: get a count of a memory-store kind (facts/utterances)");
      note(trace, "lane: answerMemoryCount — matched a MEMORY_COUNT_NOUNS entry, answered off the .tmct/memory graph header");
      return withLast(plainTurn(line, memCount, { via: "count", focus }), "get a count of a memory-store kind");
    }
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
    if (viaFact != null) {
      note(trace, 'goal: get a count of an asserted-vocabulary kind ("every X is a Y" inherited cardinality)');
      note(trace, "lane: countFromFacts — the counted noun matched a remembered isa-fact's SUBJECT, whose class IS countable");
      return withLast(plainTurn(line, viaFact, { via: "fact", focus }), "get a count");
    }
    note(trace, "goal: get a count of a graph kind (classes/functions/modules/…)");
    note(trace, "lane: answerCount — a header-count aggregate question, answered mechanically off the graph header, never dispatched to the ask engine");
    return withLast(plainTurn(line, count, { via: "count", focus }), "get a count of a graph kind");
  }
  return withLast(await runAsk(line, ctx), "unclear — no goal signal computed by the ask engine");
}

// ---- W3: seedMemory → bootstrap (first run in a graph-less repo) ----

/** The first-run bootstrap seeds the WHOLE shipped ConceptNet band (no cap) — the
 *  operator's "seed all 40k" call. `undefined` means seedMemory writes every
 *  seedable fact in the committed slice (~6.3k). The batched appendFacts write
 *  (src/memory/core.mjs) makes this a single O(N) pass — the full slice seeds in a
 *  couple of seconds, inside a session-start budget, so it still runs synchronously
 *  and complete. A finite value here would re-impose the old cap; keep it undefined
 *  to mean "all". (Kept as a named export so init.mjs and tests share the intent.) */
export const SEED_LIMIT = undefined;

/** Which predicates the seed lists FIRST (stable order — see seedMemory's `prefer`):
 *  the definitional band leads, so the on-disk memory opens with the vocabulary that
 *  answers "what is a cache?"-style questions rather than location trivia. With the
 *  cap lifted this only sets ORDER (every fact seeds either way), but a well-ordered
 *  memory keeps inspection and any future re-cap honest. */
export const SEED_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];

/** The seed marker: its presence means this repo's memory already carries the
 *  corpus seed, so re-runs skip without even reading the slice. */
export const SEED_MARKER_REL = join(".tmct", "memory", "corpus-seed.json");

/** Seed the starter corpus into <repo>/.tmct/memory once, in TWO passes:
 *    1. the curated SEON ontology (corpus/seon/concepts.jsonl) FIRST and UNCAPPED
 *       — it is small + fully curated (the SE vocabulary + orientation facts),
 *       tagged "corpus:seon", so a fresh repo knows the curated terms before any
 *       general ConceptNet noise;
 *    2. THEN the capped ConceptNet slice (the definitional band first, SEED_LIMIT
 *       facts), tagged "corpus:conceptnet".
 *  seon runs first so its curated facts win the content-hash idempotency race — a
 *  term the ConceptNet slice also carries keeps the seon provenance. Idempotent
 *  twice over (the marker short-circuits; seedMemory content-hashes fact ids) and
 *  failure-tolerated: a missing/broken corpus degrades to the unseeded bootstrap —
 *  never an error before the prompt. Returns { appended, skipped, total, seon,
 *  conceptnet } on a fresh seed (the banner counts stay honest), null when
 *  skipped/failed. */
async function seedBootstrapMemory(repo) {
  const marker = join(repo, SEED_MARKER_REL);
  try {
    await readFile(marker, "utf8");
    return null; // already seeded — the marker is authoritative
  } catch { /* no marker → first run */ }
  try {
    const { seedMemory, SEON_CONCEPTS_FILE } = await import("./corpus/conceptnet.mjs");
    // (1) curated SEON ontology — uncapped, seon-tagged, seeded FIRST.
    const seon = await seedMemory(repo, { slicePath: SEON_CONCEPTS_FILE, provenancePrefix: "corpus:seon" });
    // (2) the capped ConceptNet band — byte-identical to the prior single seed.
    const conceptnet = await seedMemory(repo, { limit: SEED_LIMIT, prefer: SEED_PREFER });
    const res = {
      appended: seon.appended + conceptnet.appended,
      skipped: seon.skipped + conceptnet.skipped,
      total: seon.total + conceptnet.total,
      seon: seon.appended,
      conceptnet: conceptnet.appended,
    };
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, JSON.stringify({
      seededAt: new Date().toISOString(), limit: SEED_LIMIT,
      appended: res.appended, skipped: res.skipped, seon: res.seon, conceptnet: res.conceptnet,
    }) + "\n");
    return res;
  } catch {
    return null; // corpus unavailable — bootstrap proceeds unseeded
  }
}

/** Whether THIS repo's memory actually carries the corpus seed — the marker is
 *  authoritative regardless of whether the CURRENT run performed the seeding or
 *  an earlier run (or `tmct init`) did (seedBootstrapMemory short-circuits on an
 *  existing marker without re-reading the slice). The one signal every "try this
 *  vocabulary example" surface must check before offering a term-specific query —
 *  see vocabExampleHint. A cheap fs check, negligible next to the per-turn
 *  template load. */
async function hasSeededVocabulary(repo) {
  if (!repo) return false;
  try { await readFile(join(repo, SEED_MARKER_REL), "utf8"); return true; }
  catch { return false; }
}

/** A "try this" vocabulary-example clause that's PROVABLY correct in the session
 *  it's shown, mirroring the discipline orientationExamples() already applies to
 *  structural examples (never offer an example that isn't confirmed to resolve).
 *  `cache` is confirmed live: present in corpus/seon/definitions.jsonl, backed by
 *  a corpus:seon concept fact, and a recognized lexicon noun — but only actually
 *  answerable once the seed has run. When it hasn't (TMCT_NO_SEED=1,
 *  seed.enabled=false, or corpus load failure), offering it would be a lie worse
 *  than no example — swap to an unconditionally-true pointer instead (the teach
 *  lane and `tmct init` both work with zero preconditions). Computed ONCE per
 *  session (createSession), not per turn. */
function vocabExampleHint(seeded) {
  return seeded
    ? 'Try "what is a cache" for general vocabulary.'
    : 'Run `tmct init` to seed a starter vocabulary, or teach me directly with "every X is a Y".';
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
  ephemeral = false,
  narrate = false,
} = {}) {
  // EPHEMERAL mode (--ephemeral, or TMCT_EPHEMERAL=1): read the target graph but
  // write NOTHING back into it. The shipped examples run this way so a demo never
  // dirties the committed code graph (`npm run example:mini` used to fold a session
  // into examples/*/.tmct/graph.json and rewrite it). We still read config.graphFile
  // for structure; only the WRITE base (logs, memory, sessions) is diverted to an OS
  // temp dir and the read-time graph upsert is suppressed.
  ephemeral = ephemeral || /^(1|true|yes)$/i.test(String(env.TMCT_EPHEMERAL || ""));
  // NARRATE mode (--narrate, or TMCT_NARRATE=1 — same on/off convention as
  // TMCT_EPHEMERAL/TMCT_NO_SEED): start the session with narrate mode already
  // on. Session-scoped and mutable from here — `/narrate on`/`/narrate off`
  // flips it turn-to-turn the same way `/focus` mutates the session's focus
  // (see `turn()` below: a turn result's `narrate` field, when present,
  // updates this closure-private variable). Default OFF, as the operator asked.
  let narrateOn = narrate || /^(1|true|yes)$/i.test(String(env.TMCT_NARRATE || ""));
  // Graph resolution order for the chat surface (documented; --repo wins):
  //   1. --repo <path>       → pins <path>/.tmct/graph.json (repo AND graph).
  //   2. TMCT_GRAPH_FILE env → loads that graph anywhere (loadConfig reads it), so
  //      `TMCT_GRAPH_FILE=<path> tmct chat` works even inside a git repo — the chat
  //      surface used to ignore it (only the `cli` tool path honoured it). The repo
  //      for logs/memory is still the git root / cwd; only the graph file is overridden.
  //   3. git root            → <root>/.tmct/graph.json (the default target).
  //   4. cwd                 → <cwd>/.tmct/graph.json (not a git repo).
  // Default the target to the GIT ROOT, not raw cwd: running from a nested package
  // dir (npm sets cwd there) would otherwise index only that package's ~few modules
  // instead of the whole repo.
  let repo;
  let config;
  if (repoPath) { repo = repoPath; config = configFor(repoPath); }
  else {
    const root = gitRoot(cwd);
    repo = root || cwd;
    const envGraph = env.TMCT_GRAPH_FILE && String(env.TMCT_GRAPH_FILE).trim();
    // TMCT_GRAPH_FILE (via loadConfig) overrides the repo-derived default graph path;
    // otherwise the repo's own .tmct/graph.json is the target.
    config = envGraph ? loadConfig(env, cwd) : { graphFile: join(repo, DEFAULT_GRAPH_REL) };
  }

  // Ephemeral: keep config.graphFile pointing at the READ graph, but divert the
  // write base (repo → logs/memory/sessions) to a throwaway temp dir. The committed
  // target is never touched; the demo's memory simply doesn't persist across runs.
  if (ephemeral) repo = await mkdtemp(join(tmpdir(), "tmct-ephemeral-"));

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
    if (ephemeral) return; // a demo/read-only session never writes back to the graph
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
  // vocabHint: computed ONCE per session (not per-turn — see runTurn's own
  // per-call fallback for direct/library callers). `seeded` is only truthy when
  // THIS run performed the seeding; a repo seeded by an EARLIER run (or `tmct
  // init`) still needs the marker check, so this covers both — see
  // hasSeededVocabulary's docblock.
  const vocabSeeded = Boolean(seeded) || (await hasSeededVocabulary(repo));
  const vocabHint = vocabExampleHint(vocabSeeded);
  // #3/#5: 0 modules means no code graph to answer structure questions from —
  // whether the graph file is absent (empty bootstrap) OR present with no code
  // entities (the degenerate trap). Both get orienting, non-over-promising banner
  // + greeting messaging rather than a silent dead-end.
  const noCodeGraph = moduleCount === 0;
  const bannerLines = [
    noCodeGraph
      // No code graph: honest, orienting messaging — never an error before the prompt.
      ? `tmct chat — ${repo} — no code graph loaded — ${empty ? "starting empty" : "graph has no code entities"}; ` +
        `the conversation is remembered to ${DEFAULT_GRAPH_REL} — log ${logFile}`
      : `tmct chat — ${repo} — ${moduleCount} module(s) — log ${logFile}`,
    // the honest seed line appears ONLY on the run that actually seeded — the count
    // is the TOTAL appended, split into the curated SEON ontology + the ConceptNet band.
    ...(seeded ? [`seeded ${seeded.appended} starter facts (${seeded.seon} curated SEON + ${seeded.conceptnet} ConceptNet) — /memory to inspect`] : []),
    // no code graph → point at how to GET one (a graph producer / --repo / the shipped
    // example), and at what IS answerable now — `vocabHint` is only ever a term
    // confirmed to resolve in THIS session's actual seed state (see vocabExampleHint),
    // never a hardcoded example that might not have been seeded. tmct reads graphs;
    // it never indexes code itself.
    ...(noCodeGraph ? [`for code structure, point me at a .tmct/graph.json with --repo <path> or try \`npm run example:mini\` (tmct reads graphs, it doesn't index code). ${vocabHint}`] : []),
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
    get narrate() { return narrateOn; },
    promptFor: () => promptFor(focus),

    /** One dispatched turn through the FULL sink sequencing (writeLog → writeSidecar
     *  → telemetry → upsertGraph, in that exact order). Returns { answer, end, prompt }.
     *  A throwing runTurn must never abort the session: a piped/non-interactive driver
     *  has no other chance to see this turn's answer, and losing the catch here also
     *  skips session.close() upstream, leaving the log/sidecar streams unflushed for
     *  every LATER turn too — found live via a piped-stdin driver hitting a bad turn. */
    async turn(line) {
      let result;
      try {
        result = await runTurn(line, { config, source, graph, focus, last, memoryDir: repo, sessionId, env, lexicon, narrate: narrateOn, vocabHint });
      } catch (e) {
        const ts = new Date().toISOString();
        const message = e instanceof Error ? e.message : String(e);
        await writeLog(`${ts}\n> ${line}\nerror: ${message}\n`);
        const errorRecord = { type: "error", ts, query: line, error: message };
        await writeSidecar(errorRecord);
        turnRecords.push(errorRecord);
        turns += 1;
        return { answer: `Something went wrong answering that (${message}). Try rephrasing, or /help.`, end: false, prompt: promptFor(focus) };
      }
      const { answer, logLines, record, focus: nextFocus, last: nextLast, end, narrate: nextNarrate } = result;
      focus = nextFocus;
      last = nextLast;
      // /narrate on|off (runCommand) rides the turn RESULT the same way a focus
      // update does — apply it to this handle's session-scoped state.
      if (typeof nextNarrate === "boolean") narrateOn = nextNarrate;
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
  ephemeral = false,
  narrate = false,
} = {}) {
  // createSession's first-run seed (~2-3s, corpus/seon + ConceptNet) produces ZERO
  // output until it fully resolves — found live: an operator reported `npm run chat`
  // appearing to hang with total silence. This one line is cheap on every run (a
  // fast subsequent run just flashes it briefly) and removes the "is this even
  // running" uncertainty during the one case that's genuinely slow.
  output.write("tmct — starting…\n");
  const session = await createSession({ repoPath, source, env, cwd, gitRoot, ephemeral, narrate });

  const dim = (s) => (env.NO_COLOR || !output.isTTY ? s : `\x1b[2m${s}\x1b[0m`);
  for (const line of session.bannerLines) output.write(dim(line) + "\n");

  const rl = createInterface({ input, output, prompt: PROMPT });
  rl.on("SIGINT", () => rl.close()); // Ctrl+C behaves like /exit (clean close, log flushed)
  let closed = false;
  rl.on("close", () => { closed = true; });
  const prompt = () => { if (!closed) rl.prompt(); }; // input may end while a turn is in flight

  prompt();
  // try/finally: session.close() is the ONLY code path that writes end-markers and
  // flushes the log/sidecar write streams (stream.end()/sidecar.end()) — an
  // unhandled throw anywhere in the loop body must still reach it, or a
  // piped/non-interactive run can lose buffered writes outright, not just this
  // turn's data. session.turn() now catches its own errors (see createSession),
  // so this is defense in depth for anything else that might throw here.
  try {
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
  } finally {
    rl.close();
    await session.close();
  }
  return { logFile: session.logFile, sidecarFile: session.sidecarFile, turns: session.turns };
}
