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

import { join, dirname, resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { dispatchTool } from "./server.mjs";
import { loadConfig, DEFAULT_GRAPH_REL } from "./config.mjs";
import { resolveRuntimeConfig } from "./cli-args.mjs";
import { parseEntities, edgesOfKind, renderAuthorCard, renderAuthorTouches, renderCommitAuthor } from "./codegraph.mjs";
import { SESSIONS_DIR_REL, appendSessionToGraph } from "./sessions.mjs";
import { uuidv7 } from "./uuid.mjs";
import { createTelemetry } from "./telemetry.mjs";
import * as defaultSource from "./source.mjs";
import { loadTemplates, render as renderTemplate } from "./corpus/templates.mjs";
import { resolveExtensions, mergedLexiconExtra } from "./extensions.mjs";
import { rankByBiasThenTrust } from "./memory/bias.mjs";
import { finish, beginsWithVowelSound, grammarRules } from "./finish.mjs";
import {
  VERB_TO_KIND, WHERE_MARKERS, MENTION_MARKERS, ENTITY_TO_TYPE, PASSIVE_PARTICIPLE_TO_KIND,
  stripTrailingScopeFiller, stripTrailingDiscourseTag,
} from "./ask-vocab.mjs";
import { COUNTERFACTUAL_RE, correctMisspellings, applyPreambleFrames, normalizeQuery, escapeRegex, kindNounAnaphoraHint } from "./interpret/normalize.mjs";
import { fuzzyMatchInSet, fuzzyBound } from "./interpret/fuzzy.mjs";
import { pickPhrase } from "./answer-variants.mjs";

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
  if (shape === "whoLast") return "find who most recently touched something (history)";
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

/** FEATURE B ("Goal (inferred): …"): an ALWAYS-ON, single short goal line —
 *  independent of the --narrate/TMCT_NARRATE opt-in debug trace above (which
 *  stays exactly as-is: the FULL "--- narrate ---" block, off by default).
 *  What the operator actually wants now is much lighter than that full dump:
 *  one line, on every STRUCTURAL/query-shaped answer, APPENDED (blank-line
 *  separated) so it never reads as part of the substantive answer — and so it
 *  never disturbs the many existing START-anchored assertions this codebase's
 *  own test suite pins composed answers with (see withGoalLine's own docblock,
 *  just below, for why appended rather than led-with).
 *
 *  `result.goal` is set by runAsk (see its own docblock at its return
 *  statement) AND by runCommand's own mk() (Bug F point 5 — GOAL_BY_COMMAND,
 *  below — generalizes the SAME mechanism to slash-command dispatches like
 *  /search and /describe); a plain count or a teach confirmation never
 *  carries the field, so this is a no-op for those turn types BY
 *  CONSTRUCTION, not a special-cased suppression list here. Also a no-op when
 *  `result.goal` is null/empty — deduceGoalFromParsed's own "nothing to
 *  bucket on" signal (a total grammar miss, or a would-miss a conversational-
 *  in-ask lane answered) — so an unclear turn never grows a "Goal (inferred):
 *  unclear" line, which would be worse than showing nothing.
 *
 *  Applied AFTER finish() (so the appended line is never grammar-rewritten) and
 *  BEFORE `last` is captured in runTurn's withLast — mirrors withNarration's
 *  own after-finish/never-touches-`last` discipline (see its docblock above),
 *  so a goal-prefixed turn's own repeat-detection / why/say-more re-render
 *  compares the EXACT SAME `last.answer` a goal-line-off run would have
 *  produced. Purely additive to what's PRINTED, never to what's REMEMBERED —
 *  the same contract narrate uses, a second, independent mechanism reusing
 *  the same discipline (composes cleanly with narrate: a narrated turn gets
 *  BOTH the short line up top and the full trace block below, never a
 *  conflict). */
function withGoalLine(result) {
  const goal = result?.goal;
  if (!goal) return result;
  // APPENDED (not prepended), blank-line separated: this codebase's existing
  // test suite pins a large number of composed answers with a START-anchored
  // (`^…`, no trailing `$`) regex — appending keeps every one of those intact
  // (the answer still STARTS with the real content) while a prepend would have
  // broken them all. Still reads as clearly separate, non-substantive trailer
  // text — the same "additive, never mixed into the substantive answer" intent
  // a leading line would have given, just from the other end.
  const suffix = `Goal (inferred): ${goal.charAt(0).toUpperCase()}${goal.slice(1)}.`;
  const answer = `${result.answer}\n\n${suffix}`;
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
  const [first, ...restTokRaw] = trimmed.split(/\s+/);
  if (!COMMAND_WORDS.has(first.toLowerCase())) return null;
  const fl = first.toLowerCase();
  // Bug F point 2 (operator follow-up request): "search for X" (bare, via this
  // function) used to route with "for X" as the literal command argument — "for"
  // is filler, not part of the search term, and burning one of the 3 allowed
  // tokens on it could wrongly reject an otherwise-short query as "too long"
  // ("search for the payment controller" is 4 tokens WITH "for", 3 without).
  // Strip a leading "for " before it becomes the argument, and rebuild the
  // returned command line from the STRIPPED remainder — the token-count check
  // below already reads the stripped `restTok`/`rest`.
  const stripped = (fl === "search" || fl === "find") && restTokRaw[0]?.toLowerCase() === "for";
  const restTok = stripped ? restTokRaw.slice(1) : restTokRaw;
  const rest = restTok.join(" ");
  const effectiveLine = stripped ? `${fl}${rest ? ` ${rest}` : ""}` : trimmed;
  // Zero-arg system commands are always the command; a bare command word is too.
  if (!rest || fl === "stats" || fl === "memory") return `/${effectiveLine}`;
  // "find" (only — "search", its /find-tool alias, keeps its original behavior
  // unconditionally): the predicate-find grammar's own shape wins regardless of
  // word count, see the precedence note above.
  if (fl === "find" && looksLikePredicateFind(restTok)) return null;
  // "describe it"/"describe that" (0.9.13 Tier-1 playtest): a bare PRONOUN argument
  // to /describe has no antecedent at this layer — dispatchTool("tmct_describe", …)
  // does its own name-only resolveSymbol lookup with no notion of the standing
  // focus, so routing it here as a bare command produced a raw "no such symbol"
  // failure. Defer to the ordinary pipeline instead (return null): it reaches
  // describeWrapperAnswer's rescue lane, which DOES resolve a bare pronoun against
  // the standing focus. A named argument ("describe Widget") is untouched.
  if (fl === "describe" && DESCRIBE_PRONOUN_RE.test(rest)) return null;
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
  if (restTok.length <= 3 && !QUERY_CONNECTIVES.test(rest)) return `/${effectiveLine}`;
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

/** An IMPLICIT anaphoric count with NO explicit "of them/those/these" at all —
 *  "how many are tested", "and how many are tested" (Tier-2 playtest, 5th
 *  pass). A fluent staccato follow-up after a just-given list naturally elides
 *  the pronoun a fuller phrasing ("how many of those are tested") carries —
 *  ANAPHORA_COUNT_RE above requires that explicit "of them/those/these" and
 *  never fires for this shape, so answerCount's own bare noun-scan greedily
 *  (and wrongly) captured the linking verb ITSELF as the counted noun ("how
 *  many ARE tested" -> noun="are") and answered the nonsensical "I can't
 *  count 'are'." Gated on real content after the linking verb (`(?!there\b)`)
 *  so a genuinely bare "how many are there" (no antecedent, no predicate to
 *  filter on) is untouched — that one's existing "I can't count 'are'" nudge
 *  is arguably the more honest answer to a query naming nothing at all. */
const IMPLICIT_ANAPHORA_COUNT_RE = /^(?:(?:and|so|then|also)\s+)?how many (?:are|is|were|was)\s+(?!there\b)(\S.*)$/i;

/** "have"/"has"/"holds"/"hold" are excluded from RESTRICTOR_VERB_RE below —
 *  DELIBERATELY treated as non-restrictor cues here, not a bug fix skipped. Ask-
 *  vocab's VERB_TO_KIND maps them to "defines" unconditionally, but the graph's
 *  actual "have" semantics are subject-type-dependent (a Module "has" things it
 *  defines; a Class "has" things it contains) — found live (0.9.14 Tier-2 playtest,
 *  third pass, numeric/quantifier relation touches) that ask.mjs's own engine
 *  resolves the two surface forms of the SAME query ("what methods does Widget
 *  have" vs "which methods does Widget have") to DIFFERENT, inconsistent kinds (one
 *  correctly reaches "contains", the other wrongly reaches "defines" and returns an
 *  honest-but-wrong zero) — a genuine, pre-existing ambiguity in the core clause
 *  grammar, orthogonal to dialogue flow/routing and out of this cycle's scope.
 *  Deferring a "have" tail to the ask engine here would just trade one wrong-answer
 *  risk for another rather than fixing anything, so it stays on the existing
 *  bare-count path (unchanged behavior, no new regression) until a dedicated fix
 *  teaches the grammar to pick "defines" vs "contains" by the resolved subject's
 *  own class. */
const AMBIGUOUS_HAVE_VERBS = new Set(["have", "has", "holds", "hold"]);

/** A "how many <kind> …" tail carries a genuine RESTRICTOR clause — not filler — iff
 *  it names a real relation verb (active, from VERB_TO_KIND, or passive-participle,
 *  from PASSIVE_PARTICIPLE_TO_KIND — both ask-vocab.mjs's closed vocabulary, the
 *  same one ask.mjs's own clause grammar reads), minus the ambiguous "have" family
 *  above. Matching on the VERB specifically (not "any non-stopword word") matters:
 *  a tail's own OBJECT NAME is also non-stopword content ("how many methods does
 *  WIDGET have" — "Widget" alone isn't a restrictor cue), so a bare
 *  content-word test would misfire on every qualified count regardless of verb. */
const RESTRICTOR_VERB_RE = new RegExp(
  `\\b(?:${
    [...Object.keys(VERB_TO_KIND), ...Object.keys(PASSIVE_PARTICIPLE_TO_KIND)]
      .filter((v) => !AMBIGUOUS_HAVE_VERBS.has(v))
      .sort((a, b) => b.length - a.length)
      .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")
  })\\b`,
  "i",
);

/** Recognise a count/aggregate question and answer it from the graph header, or
 *  null if it isn't one (→ fall through to tmct_ask). "how many X [are there]",
 *  "count [the] X", "number of X". An unknown kind lists what it CAN count.
 *
 *  A RESTRICTOR tail ("how many modules IMPORT app/lib/a.mjs", "how many classes
 *  INHERIT FROM Base") is NOT a bare header count — found live (0.9.14 Tier-2
 *  playtest, third pass, numeric/quantifier relation touches): this regex only ever
 *  captured the noun immediately after "how many" and silently discarded everything
 *  after it, so a qualified count fell back to the UNQUALIFIED class total ("how many
 *  modules import app/lib/a.mjs" answered "8 modules" — the whole-graph module count —
 *  instead of the 3 that actually import it). ask.mjs's own AGGREGATE node
 *  (parseAggregate) already evaluates a restrictor tail correctly via parseSetPhrase,
 *  so once the tail names a real relation verb (RESTRICTOR_VERB_RE), decline here and
 *  let the turn fall through to the real ask engine instead of returning a misleading
 *  bare total. */
export function answerCount(graph, query) {
  if (!graph) return null;
  // ANAPHORIC counts ("how many of those are tested", "count them", "how many of
  // them") count the PREVIOUS answer's set, not a graph kind — decline so the turn
  // falls through to the ask engine's anaphora node (which threads `prev`). Without
  // this the bare "of"/pronoun head is mis-reported as an uncountable kind and the
  // discourse+count follow-up dies before it can resolve (CHATBENCH_006 lever 1).
  if (ANAPHORA_COUNT_RE.test(String(query))) return null;
  // The elliptical sibling above (no explicit "of them/those" at all) — same
  // decline, same reason: this is a reference to the PREVIOUS answer's set,
  // not a graph kind named "are"/"is"/"were"/"was".
  if (IMPLICIT_ANAPHORA_COUNT_RE.test(String(query).trim())) return null;
  const m = String(query).match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/i);
  if (!m) return null;
  const noun = m[1].toLowerCase();
  const cls = COUNT_NOUNS[noun];
  if (cls && RESTRICTOR_VERB_RE.test(String(query).slice(m.index + m[0].length))) return null;
  if (!cls) {
    const kinds = countableKinds(graph);
    // Bug C (operator manual-chat find, this session): when NO code graph is
    // loaded, countableKinds(graph) is genuinely EMPTY (no class is present at
    // all) — the old message rendered "I count: ." (a dangling empty list
    // before the period) and then pointlessly suggested "how many classes are
    // there", which would ALSO fail for the same reason. An honest, non-dangling
    // message instead, pointing at how to actually get a graph loaded.
    if (!kinds.length) {
      return `I can't count "${noun}" — no code graph is loaded yet, so there's nothing to count ` +
        `(point me at one with --repo, or run "npm run example:mini").`;
    }
    return `I can't count "${noun}". I count: ${kinds.join(", ")}. ` +
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
async function countFromFacts(graph, memoryDir, query, biasByBundle = {}) {
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
  // pick the highest-bias, then highest-trust asserted subject that maps to a
  // countable graph class (rankByBiasThenTrust: bias-tied/unconfigured degrades
  // to the same trust-desc scan this always ran).
  for (const f of rankByBiasThenTrust(isa, biasByBundle)) {
    const cls = COUNT_NOUNS[String(f.subject).toLowerCase()];
    if (cls) { const n = countClass(graph, cls); return `${n} ${asked}.`; }
  }
  return null;
}

// ---- Feature A point 4: "how many Xs are Ys" — literal recall of a taught
// quantifier ("some"/"a few"/"every"), NEVER real cardinality counting
// (consistent with this file's "grounded or honest miss" philosophy). The
// SOME_A_FEW_RE / unknownSubjectFallback / assertTurn's own "every"-quantifier
// follow-up (below) are what STORE the quantifier this reads back.
//
// CRITICAL ORDERING NOTE: dispatched explicitly ahead of answerCount in
// runTurn (mirroring answerMemoryCount's own precedent, just below) —
// answerCount's own noun-scan regex greedily grabs the FIRST word after "how
// many" as a literal noun to count and would otherwise short-circuit to an
// "I can't count 'Xs'" miss before this lane ever got a turn.
//
// AUTHORITY GATE (avoids shadowing real graph counts): claims authority
// (always returns a non-null string — either the quantifier or an honest "I
// don't know") ONLY when (a) the subject does NOT name a real graph-countable
// class (COUNT_NOUNS — the same guard countFromFacts uses, so a corpus-seeded
// fact that happens to share a subject word like "module" never shadows a
// real "how many modules …" count) AND (b) tmct has SOME isa-family fact
// about that subject at all (a subject never taught anything, e.g. "classes"
// in "how many classes are there", falls through to answerCount's real
// graph-cardinality count untouched — same honest-decline discipline as
// every other lane here).
const HOW_MANY_ARE_RE = /^how\s+many\s+([\w-]+)\s+(?:are|is)\s+(.+?)[?.!\s]*$/i;
async function answerQuantifierRecall(memoryDir, query, biasByBundle = {}) {
  if (!memoryDir) return null;
  const m = String(query).trim().match(HOW_MANY_ARE_RE);
  if (!m) return null;
  const asked = m[1].toLowerCase();
  if (COUNT_NOUNS[asked]) return null; // a real graph-countable class — answerCount owns it
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const subjVariants = factTermVariants(normFactTerm, asked);
  const rows = (await factRows(memoryDir)).filter((f) => ISA_PREDICATES.has(f.predicate) && subjVariants.has(f.subject));
  if (!rows.length) return null; // never heard of this subject at all — let answerCount own the shape
  const objVariants = factTermVariants(normFactTerm, m[2]);
  const hit = rankByBiasThenTrust(rows.filter((f) => objVariants.has(f.object)), biasByBundle)[0];
  const q = hit?.quantifier;
  if (!q) return "I don't know — I was never told a quantifier for that.";
  return `${q.charAt(0).toUpperCase()}${q.slice(1)}.`;
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
  // HANDOVER.md 2026-07-10 item 10: "what can you actually do" (an intensifier
  // adverb inserted before the verb) used to miss this exact-match regex entirely
  // and fall to the raw grammar wall instead of orientationAnswer — the same
  // question in every way that matters, just phrased with emphasis.
  /^(?:so,?\s+)?what can (?:you|u)(?:\s+(?:actually|really))? do\??$/i, /^(?:so,?\s+)?what do you(?:\s+(?:actually|really))? do\??$/i,
  /^help( me)?\??$/i, /^\?+$/,
  /^how do (i|you) work\??$/i, /^how does (this|it) work\??$/i,
  // unix-habit openers typed inside the REPL out of muscle memory — argv-only
  // today (bin/tmct.mjs), dead once inside the chat loop; route to the same
  // capability answer a plain "help" gets.
  /^--help$/i, /^-h$/i, /^man( tmct)?\??$/i,
  // Tier 6 playtest ("the messy real user", §3): the vague-opener family a
  // stranger genuinely asks before knowing any query shapes — "what can you
  // tell me about this repo", "tell me something interesting (about this
  // codebase)", "so, what is going on in this codebase" (an optional leading
  // "so," discourse connective, same species as LEADING_CONNECTIVE_RE
  // elsewhere). All three used to fall straight to the raw grammar wall
  // (isConversational's own ≤3-word/no-codeish catch-all never claims an
  // 8-word sentence like these) even though orientationAnswer is EXACTLY the
  // right answer — the same overview CAPABILITY_PHRASES' other entries already
  // reach. The noun set mirrors META_ORIENT_RE's own closed list.
  /^what can (?:you|u) tell me(?:\s+(?:more|anything))?\s+about (?:this|the)\s+(?:app|codebase|repo|repository|project|code|thing)\??$/i,
  /^tell me something interesting(?:\s+about (?:this|the)\s+(?:app|codebase|repo|repository|project|code))?\??$/i,
  /^(?:so,?\s+)?what(?:'s|s|\s+is)\s+(?:going on|happening)\s+(?:in|with)\s+(?:this|the)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
  // Tier 6 playtest cycle 2: three more vague-opener idioms found live, same
  // family as the three just above — a stranger's orientation request has no
  // fixed wording, so this closed set keeps growing additively as new natural
  // phrasings surface, never a general "any long question is an orientation
  // request" rule.
  /^(?:can you\s+)?walk me through (?:this|the)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
  /^what(?:'s|s|\s+is) the big picture(?:\s+here)?\??$/i,
  /^(?:give me|what's) the lay of the land\??$/i,
  // Tier 6 playtest cycle 3: "what have we got here"/"what've we got here" —
  // a casual, self-answering opener (found after a leading "so" strips via
  // LEADING_CONNECTIVE_RE, leaving this as the bare remainder).
  /^what(?:'ve| have) (?:we|i) got here\??$/i,
  // "what's in this repo/codebase" — arguably the MOST natural vague opener of
  // this whole family, and genuinely ambiguous with the real "what's in <X>"
  // members/containment grammar (ask.mjs) for any OTHER term — closed to
  // exactly the same self-referential noun set META_ORIENT_RE already uses,
  // so a real module/class named literally "repo"/"codebase" is never at risk
  // (this repo's own fixture has none, and the noun list itself excludes
  // ordinary code-ish names).
  /^what(?:'s|s|\s+is) in (?:this|the)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
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
  // "explain [to me|please]* what (you are|this is)" in EITHER word order — a
  // fluent-but-non-native speaker plausibly types the question-form "what is
  // this" after "explain" as readily as the statement-form "this is" (SKILL_
  // CHAT_PLAYTEST §3b's own ESL examples: "explain please what is this" used
  // to fall through this regex to the grammar wall because only the statement
  // order was declared).
  /^explain(?:\s+(?:to me|please))*\s+what\s+(?:is\s+(?:this|it|you)|(?:you are|this is|it is))\??$/i,
  /^whoami\??$/i,
  // "hru" ("how are you") — GLUED texting shorthand: no word boundary inside it
  // for a contraction pass (fuzzyConversationalMatch's SHORTHAND_CONTRACTIONS)
  // to split on, so it earns its own closed-set entry instead, same as GREET/
  // THANKS' hand-curated slang. Routed to identity-self (not a fake "doing
  // great!" performance, nor the generic greeting card) — an honest "what I am"
  // answer is the closest real thing tmct has to say to "how are you". "wyd"
  // ("what are you doing") is deliberately NOT given a matching entry: it isn't
  // an identity question and forcing one would be a fabricated route; it falls
  // through to the honest generic orientation card same as before.
  /^hru\??$/i,
];
/** "Are you an LLM/AI/bot" — tmct's actual positioning (no LLM, deterministic) is
 *  a genuinely different, more specific answer than the generic self-description,
 *  and this is a very likely first question given how most chat tools work today. */
const AI_IDENTITY_PHRASES = [
  // HANDOVER.md 2026-07-10 item 10: "are you secretly GPT" — an adverb ("secretly"/
  // "really"/"actually") wedged between "are you" and the noun (a deliberate-breaker
  // persona's own phrasing) used to mis-segment the subject as "you secretly" and
  // fall through to the ordinary graph-query grammar instead of this lane.
  /^(are you|r u)\s+(?:secretly|really|actually)?\s*(an? )?(ai|a bot|chatgpt|gpt|an? llm|a language model|a robot)\??$/i,
  /^is this (chatgpt|gpt|claude|an? ai|an? llm)\??$/i,
  /^do you use ai\??$/i, /^what language model are you( using)?\??$/i,
  /^am i (talking|speaking|chatting) (to|with) a (real )?(person|human|bot|ai)\??$/i,
];

/** Split raw turn text into candidate single-sentence clauses on sentence-
 *  ending punctuation ("?"/"!"/"."), trimmed, empties dropped. BENCHMARK_
 *  CONVERSATION_1.7.0.md routed backlog C4: AI_IDENTITY_PHRASES' own entries
 *  are anchored (^...$) against a SINGLE clause, so a two-sentence turn like
 *  "are you an AI? like chatgpt?" could never match the whole raw string even
 *  though its first clause alone is an exact "are you an AI" hit. Used ONLY
 *  by aiIdentityMatch below — every OTHER closed-set match in this file stays
 *  whole-string, on purpose (this is deliberately narrow to the one family
 *  that's shown up broken this way, not a general multi-clause rewrite of
 *  isConversational's whole match cascade). */
function splitClauses(text) {
  return String(text).split(/[?!.]+\s*/).map((c) => c.trim()).filter(Boolean);
}

/** AI_IDENTITY_PHRASES matched against the whole raw turn OR, failing that,
 *  against any one of its sentence-split clauses (splitClauses, above) — so
 *  "are you an AI? like chatgpt?" matches on its first clause alone, the same
 *  way a single-sentence "are you an AI" already did. The whole-string check
 *  runs first (the common case, no split needed); the clause fallback only
 *  ever ADDS a match a single-clause turn already had no chance to win to,
 *  since every phrase is itself a complete anchored sentence — a genuinely
 *  unrelated longer sentence that merely CONTAINS identity-phrase-shaped
 *  words won't split into a clause that's ONLY those words, so this can't
 *  false-positive on it (e.g. "well are you an AI expert on this" has no
 *  clause boundary carving out "are you an AI" alone). */
function aiIdentityMatch(raw) {
  const text = String(raw);
  if (AI_IDENTITY_PHRASES.some((re) => re.test(text))) return true;
  return splitClauses(text).some((clause) => AI_IDENTITY_PHRASES.some((re) => re.test(clause)));
}

/** "Do you have feelings/emotions" — HANDOVER.md 2026-07-10 item 10 (small-talk
 *  persona finding): with no closed-set match, this used to misfire into a
 *  literal module-name lookup for the bare noun ("no module matching 'feelings'
 *  found in the index") — a wrong-flavor wall, not an honest personality decline.
 *  Same family/placement as AI_IDENTITY_PHRASES just above (a self-awareness
 *  question about tmct, not a code-graph query), checked in conversationalTurn
 *  BEFORE any graph query is attempted. */
const FEELINGS_PHRASES = [
  /^do you have (?:feelings|emotions|opinions|thoughts)\??$/i,
  /^are you (?:sentient|conscious|self[- ]aware)\??$/i,
  /^can you feel(?:\s+(?:things|emotions|anything))?\??$/i,
  /^do you (?:feel|think|dream)\??$/i,
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
  if (aiIdentityMatch(raw)) return true;
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
const T_IDENTITY_NO_FEELINGS = "identity-no-feelings";
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
  "good day", "good day to you", "salutations", "good to meet you", "pleased to meet you",
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
  // "brilliant" (playtest sprint round 3, 2026-07-10): a UK-English enthusiasm
  // interjection functioning as a bare acknowledgement, the same shape as
  // "nice"/"cheers" just above — "brilliant, that's all I needed" hit the raw
  // grammar wall via item 2's own multi-clause scan (which deliberately checks
  // THANKS only, not OK_ACK — see farewellOrThanksSignal's own docblock for why
  // "ok"/"cool"/"right" stay excluded there) because "brilliant" wasn't in
  // EITHER closed set yet.
  "brilliant",
  // "ta for that" (Tier 6 playtest): "cheers for that" was already here, but
  // its "ta" sibling (both dropped-word forms of the SAME "thanks for that"
  // shape) was missing — fell to the generic orientation card via
  // isConversational's ≤3-word catch-all instead of a thanks reply.
  "ta for that",
  // Playtest sprint round 3 (2026-07-10): a natural session-closing remark
  // hit the raw grammar wall instead of a warm sign-off — the LAST turn of a
  // session is a bad place to end on a wall. Same discipline as "ta for
  // that": add the SPECIFIC found phrasing, not a general "closing remark"
  // grammar.
  "cheers, that's everything for now, thanks",
  "that's everything for now, thanks",
  "that's all for now, thanks",
]);
/** Farewells → a goodbye AND a clean end of session (same path as /exit). */
const BYE = new Set([
  "bye", "goodbye", "quit", "exit", "see ya", "see you", "cya", "later", "farewell",
  "peace", "peace out", "im off", "i'm off", "gtg", "gotta go", "catch you later",
  "farewell then",
  // "good day to you" deliberately does NOT live here (SKILL_BENCHMARK_
  // CONVERSATION.md persona-sweep, 2026-07-11, Priority 2 — severe, killed
  // the whole session): it's the formal-register GREETING §2.2 itself names
  // ("good day" — down to slang), not a farewell. It used to sit in this set
  // and won the race against GREET (foldedBye is checked first in
  // conversationalTurn), so a plain formal "good day to you" silently ended
  // the session — every turn piped after it was dropped with no log entry, a
  // worse outcome than any wall. Moved to GREET (above) instead; a genuine
  // dismissive sign-off ("farewell then", bare "farewell") stays here
  // unchanged — this is a narrowing of an over-broad match, not a new
  // farewell phrasing (§5 "farewells stay out of scope" governs ADDING
  // coverage, not fixing a phrase that was on the wrong list).
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

/** HANDOVER.md 2026-07-10 item 2: THANKS/BYE were exact-match-the-WHOLE-line
 *  closed sets, grown one literal phrase at a time across sessions — and kept
 *  failing on the very next unlisted phrasing tried (3 independently-run
 *  personas each hit this in one persona-sweep: "thanks, that was fun",
 *  "ok thank you very much, bye bye", "thanks, bye"). The generalization is
 *  over PHRASE SHAPE (a thanks/bye clause tacked onto a larger sentence),
 *  not another one-off literal string:
 *    - split on comma/semicolon/a standalone "and" into clauses
 *    - strip a leading bare OK_ACK lead-in off each clause ("ok thank you…")
 *    - strip a trailing intensifier ("very much"/"so much"/"a lot"/"a bunch" —
 *      the SAME curated set THANKS_PREAMBLE_RE, interpret/normalize.mjs,
 *      already recognizes) before matching THANKS
 *    - fold an exact word-repeated clause ("bye bye") to one instance before
 *      matching BYE — informal reduplication for emphasis, not a new phrase
 *  Still the SAME closed THANKS/BYE sets underneath (same closedOrCollapsed
 *  matcher) — only the SEGMENTATION generalizes. Bounded to short, non-codeish
 *  lines (same discipline as isConversational/fuzzyConversationalMatch) so a
 *  genuine structural question is never grabbed. A single-clause line (no
 *  comma/semicolon/"and") is left to the exact whole-line checks above/below —
 *  this only handles the MULTI-clause case those can't. Returns "bye"/"thanks"/
 *  null; bye wins when a line carries both (a farewell should end the session
 *  even alongside a thanks — the small-talk persona's "thanks, bye" finding:
 *  the README implies "bye" phrasing should end the session, full stop). */
const ACK_LEAD_RE = new RegExp(`^(?:${[...OK_ACK].map(escapeRegex).join("|")})\\s+(.+)$`, "i");
const TRAILING_INTENSIFIER_RE = /\s+(?:very\s+much|so\s+much|a\s+lot|a\s+bunch)\s*$/i;
const REPEATED_WORD_RE = /^(\S+)\s+\1$/i;
// Comma/semicolon (optionally swallowing a following "and") OR a standalone
// "and" — a single combined pattern so "X, and Y" splits into ["X", "Y"], not
// ["X", "and Y"] (a naive comma-only split leaves "and" glued to the second
// clause, which then fails every closed-set match downstream).
const CLAUSE_SPLIT_RE = /\s*[,;]\s*(?:and\s+)?|\s+and\s+/;
function conversationalClauses(q) {
  return q.split(CLAUSE_SPLIT_RE).map((c) => c.trim()).filter(Boolean);
}
/** BYE match tolerant of informal reduplication ("bye bye", "no no" — general,
 *  not specific to any one word): a clause consisting of the SAME word twice
 *  folds to one instance before the ordinary closed/collapsed BYE lookup.
 *  Shared by the single-clause whole-line check and the multi-clause scan
 *  below, so "bye bye" resolves the same way whether or not a comma follows it. */
function foldedBye(clause) {
  if (closedOrCollapsed(clause, BYE, BYE_COLLAPSED)) return true;
  const folded = clause.match(REPEATED_WORD_RE);
  return !!(folded && closedOrCollapsed(folded[1], BYE, BYE_COLLAPSED));
}
/** Closing-filler clauses — the CONTENT half of a farewell/thanks sentence
 *  ("thanks, that's everything for now") that isn't itself gratitude or bye
 *  wording, but is unambiguous session-closing small talk, not a real
 *  question. farewellOrThanksSignal's ≤3-word gate below exists to keep a
 *  genuine question ("cheers, what does X do") out of this lane; these
 *  clauses need their own exemption because they naturally run 4-5 words and
 *  the gate would otherwise reject them. Found live (2026-07-11 playtest
 *  sprint round 1): "thanks, that's everything for now" hit the raw grammar
 *  wall as a session's LAST turn, even though a frozen single-turn regression
 *  test for the same phrase already existed — that test only pinned "doesn't
 *  match the wall text", which the isolated-turn fallthrough miss happened
 *  not to, while the SAME routing gap produced the literal wall once real
 *  session history was involved. The gap was the ≤3-word gate, not the
 *  closed set — this clause list is the fix, not a new one-off phrase pin. */
const CLOSING_FILLER_CLAUSES = new Set([
  "that's everything for now", "that's all for now",
  "that's everything i needed", "that's all i needed",
  "that's everything for today", "that's all for today",
]);
function farewellOrThanksSignal(raw, q) {
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8 || looksCodeish(raw, q)) return null;
  const clauses = conversationalClauses(q);
  if (clauses.length < 2) return null; // single-clause lines: the exact whole-line checks own this
  // OK_ACK is deliberately NOT a signal here (unlike the exact whole-line check
  // above/below): "ok"/"cool"/"right"/"sure" are constitutionally ACK-PREAMBLE
  // words in this codebase (ACK_PREAMBLE_RE, interpret/normalize.mjs) — "right,
  // can you walk me through this codebase" is an ack-preamble before a REAL
  // question, not a closing acknowledgement, and treating a bare OK_ACK clause
  // as a thanks-signal regressed exactly that live case. THANKS itself is more
  // specific (genuine gratitude words rarely lead into an unrelated question),
  // but still gated below: a THANKS-hit only counts when every OTHER clause is
  // itself small-talk-shaped (≤3 words, non-codeish) — the SAME bound
  // isConversational's own catch-all uses — OR a curated closing-filler clause
  // (CLOSING_FILLER_CLAUSES, above) — so "cheers, what does X do" is still left
  // to the existing THANKS_PREAMBLE_RE lane, never grabbed here.
  let thanksClauseIdx = -1;
  let byeHit = false;
  for (let i = 0; i < clauses.length; i += 1) {
    const rawClause = clauses[i];
    const ackMatch = rawClause.match(ACK_LEAD_RE);
    const clause = ackMatch ? ackMatch[1].trim() : rawClause;
    if (foldedBye(clause)) { byeHit = true; break; }
    const deIntensified = clause.replace(TRAILING_INTENSIFIER_RE, "").trim();
    if (thanksClauseIdx < 0 && closedOrCollapsed(deIntensified, THANKS, THANKS_COLLAPSED)) thanksClauseIdx = i;
  }
  if (byeHit) return "bye";
  const thanksHit = thanksClauseIdx >= 0 && clauses.every((c, i) => i === thanksClauseIdx
    || CLOSING_FILLER_CLAUSES.has(c)
    || (c.split(/\s+/).filter(Boolean).length <= 3 && !looksCodeish(c, c.toLowerCase())));
  return thanksHit ? "thanks" : null;
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
/** Standalone-token texting shorthand for this lane ONLY: "r"→"are", "u"→"you",
 *  word-boundary matched so a substring inside a real word ("your", "sure",
 *  "minute") is never touched. This is the SAME normalization class as
 *  ask-vocab.mjs's CONTRACTIONS table (word-boundary, case-insensitive,
 *  longest-key-first — see interpret/normalize.mjs's tableRe), but deliberately
 *  NOT routed through that shared table/normalizeQuery: those feed ask.mjs's
 *  code-graph grammar pipeline, where a bare "u"/"r" plausibly collides with a
 *  real dotted identifier ("u.mjs" as a module name) — and conversationalTurn()
 *  never calls normalizeQuery at all, so extending the shared table wouldn't
 *  even reach this lane. Scoped locally to the fuzzy-conversational tier
 *  instead, applied BEFORE the candidate lookup below, so "waht r u"/"wat r u"
 *  first become "waht are you"/"wat are you" — within the existing bounded
 *  edit-distance of "who are you"/"what are you" — and resolve exactly the way
 *  a plain-English typo does. GLUED shorthand ("hru", "wyd") has no word
 *  boundary to split on and is NOT reached by this pass; see IDENTITY_PHRASES
 *  for "hru"'s separate closed-set entry. */
const SHORTHAND_CONTRACTIONS = { r: "are", u: "you" };
const SHORTHAND_CONTRACTION_RE = /\b(r|u)\b/gi;
function expandShorthandContractions(text) {
  return text.replace(SHORTHAND_CONTRACTION_RE, (m) => SHORTHAND_CONTRACTIONS[m.toLowerCase()]);
}

/** UNIQUE within-bound fuzzy match of the whole trimmed line against
 *  CONVERSATIONAL_PHRASES — the "helo"/"thnx"/"byee" tier, plus (after shorthand
 *  contraction expansion above) "waht r u"/"wat r u"-style texting shorthand.
 *  Restricted to short (≤4-word), non-code-ish inputs (looksCodeish, shared with
 *  isConversational) so a genuine near-miss structural question is never grabbed;
 *  a distance tie is refused, never guessed (same discipline as fuzzyVocabWord). */
function fuzzyConversationalMatch(raw) {
  const expanded = expandShorthandContractions(raw);
  const q = collapseRuns(expanded.toLowerCase().replace(/[.!?]+$/, "").trim());
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
  if (foldedBye(q)) {
    note(ctx.trace, "goal: casual/social — ending the session (no graph intent)");
    note(ctx.trace, "lane: conversational — farewell (BYE closed set, incl. bare reduplication e.g. \"bye bye\")");
    return mk(t(T_FAREWELL), { end: true });
  }
  {
    // HANDOVER.md 2026-07-10 item 2: a multi-clause line carrying a bye/thanks
    // clause tacked onto a larger sentence ("thanks, that was fun", "ok thank
    // you very much, bye bye", "thanks, bye") — see farewellOrThanksSignal's
    // own docblock. Never fires on a single-clause line (those are the exact
    // checks just above/below), so this only ADDS coverage, never shadows it.
    const signal = farewellOrThanksSignal(raw, q);
    if (signal === "bye") {
      note(ctx.trace, "goal: casual/social — ending the session (no graph intent)");
      note(ctx.trace, "lane: conversational — farewell (multi-clause phrase-shape match)");
      return mk(t(T_FAREWELL), { end: true });
    }
    if (signal === "thanks") {
      note(ctx.trace, "goal: casual/social — acknowledgement, no graph intent");
      note(ctx.trace, "lane: conversational — thanks (multi-clause phrase-shape match)");
      return mk(t(T_THANKS));
    }
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
  if (aiIdentityMatch(raw)) {
    note(ctx.trace, "goal: identity — is tmct an AI/LLM (a very likely first question)");
    note(ctx.trace, "lane: conversational — identity/AI (AI_IDENTITY_PHRASES closed set)");
    return mk(t(T_IDENTITY_NOT_LLM));
  }
  if (FEELINGS_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — does tmct have feelings/consciousness (small-talk persona finding)");
    note(ctx.trace, "lane: conversational — identity/feelings (FEELINGS_PHRASES closed set)");
    return mk(t(T_IDENTITY_NO_FEELINGS));
  }
  if (IDENTITY_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — who/what tmct is, not a capability listing");
    note(ctx.trace, "lane: conversational — identity (IDENTITY_PHRASES closed set)");
    return mk(t(T_IDENTITY_SELF));
  }
  // Tier 6 playtest cycle 2: CAPABILITY_PHRASES' vague-opener entries are
  // self-contained closed regexes, but a preamble ahead of one ("right, can
  // you walk me through this codebase" — an ACK_PREAMBLE_RE + MODAL_WRAPPER_RE
  // stack) is tested nowhere upstream of this check, unlike vagueTouchTermOf/
  // describeWrapperAnswer (both run applyPreambleFrames first). Trying the
  // SAME closed set again against the preamble-stripped text is purely
  // additive — it can only ever ADD a match CAPABILITY_PHRASES.test(raw)
  // alone would have missed, never take one away.
  if (q === "help" || q === "?" || CAPABILITY_PHRASES.some((re) => re.test(raw))
    || CAPABILITY_PHRASES.some((re) => re.test(applyPreambleFrames(raw))) || ORIENT_OPENERS.has(q)) {
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
  const total = (graph.individuals || []).length;
  const lead = pickPhrase("ask-about-lead", `${total}:${parts.join(",")}`, "Ask about");
  return `This is a tmct code graph — ${total} entities`
    + `${parts.length ? ` (${parts.join(", ")})` : ""}. `
    + `${lead} imports, calls, definitions or history — e.g. "which modules import <name>", "what calls <name>". `
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
  const pointer = pickPhrase("full-breakdown", ind.id, "for the full breakdown");
  return `${ind.label} is a ${cls} — ${parts.join("; ")}. `
    + `/describe ${ind.label} ${pointer}.`;
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
// Bug F point 1 (operator follow-up request, this session): "I want you to
// remember X"/"I'd like you to remember X" teaches exactly like bare "remember
// X" — a closed-set optional lead-in before the existing verb list, so it
// automatically inherits the correct "teach/remember a new fact" goal line for
// free (it flows through the SAME teach-lane goal revision, chat.mjs's runTurn
// cascade — no extra wiring needed for this phrasing).
// BENCHMARK_CONVERSATION_1.7.0.md routed backlog C1 ("please learn this: John
// is a man" / "please learn also: a man is having two legs"): "learn" joins
// the verb list, and a new optional filler slot ("this"/"that"/"also")
// tolerates a word between the verb and the colon/comma lead-in — the verb
// list alone never covered that shape, so "remember this: X" (not just
// "learn this: X") is now also recognized, matching the docblock above's own
// worked "remember that X" case (the pre-existing `(?:that\s+)?` after the
// lead-in punctuation still covers a lead-in-less "remember that X").
const TEACH_RE = /^(?:please\s+)?(?:i\s+(?:want|wanted)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)?(?:remember|note|keep in mind|jot down|for the record|fyi|learn)\b(?:\s+(?:this|that|also))?[:,]?\s*(?:that\s+)?(.+?)[.?!]*$/i;
const BARE_DECLARATIVE_RE = /^(?:every |each |all |a |an )?[\w-]+ (?:is|are) (?:a |an )?[\w-]+$/i;
/** Interrogative / auxiliary leads that make an "X is a Y"-shaped line a QUESTION
 *  ("what is a cache", "is a module a component"), never a teach declarative. */
const QUESTION_LEAD_RE = /^(?:what|who|which|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have)\b/i;
/** A bare wh-word token, tested one word at a time against `hasMidSentenceInterrogative`'s
 *  own tokenization below — never re-anchored, so it matches at ANY word position. */
const MID_SENTENCE_WH_RE = /^(?:which|who|what|where|when|why|how)$/i;
/** PLAN_CONVERSATION.md Finding 4 fix: QUESTION_LEAD_RE (just above) is anchored
 *  to the FIRST word, so a wh-word appearing LATER in the sentence ("it uses
 *  WHICH controller as its base") slips past every teachLane guard that
 *  reuses it — including TEACH_PRONOUN_RE's own check, which has no
 *  interrogative guard at all. That let a mid-sentence question either mint a
 *  GARBAGE fact (a bare sentence with a real subject: "TaskController uses
 *  which controller as its base" got stored verbatim) or produce a confusing
 *  pronoun-specific refusal that named the wrong problem (a pronoun subject:
 *  "it uses which controller as its base" — "it" was never the real issue,
 *  the mid-sentence question was).
 *
 *  Detects a genuine mid-sentence INTERROGATIVE use of a wh-word — never the
 *  first word, QUESTION_LEAD_RE's own anchored check already owns that case —
 *  via wink's POS tagger (the SAME optional adapter subjectIsNounOrPropn/
 *  objectReadsAsNonNoun below already use, ask-nlp.mjs's nlpAdapter):
 *  whichever wh-word tokens appear after the first word, check whether the
 *  token immediately BEFORE each is tagged VERB or AUX. A wh-in-situ
 *  interrogative object/adjunct ("uses WHICH controller", "is used by WHICH
 *  module") always immediately follows the verb it's an argument of; a
 *  RELATIVE pronoun introducing a restrictive clause ("the handler WHICH
 *  processes requests", "a grandparent WHO is male" — see
 *  test/chat-taught-relations.test.mjs's own "a grandfather is a grandparent
 *  who is male" teach, confirmed unaffected) always immediately follows the
 *  NOUN it modifies instead. Checking the preceding tag is a real, if
 *  imperfect, way to tell the two apart — not meant to be perfect (a first
 *  increment), just enough to stop teachLane storing or refusing on the wrong
 *  grounds. No wink installed, or any tagging surprise, degrades to false —
 *  no signal, never a false positive from a missing adapter — matching
 *  subjectIsNounOrPropn/objectReadsAsNonNoun's own discipline exactly. */
async function hasMidSentenceInterrogative(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const whIdx = [];
  for (let i = 1; i < words.length; i += 1) {
    if (MID_SENTENCE_WH_RE.test(words[i].replace(/^[.,!?;:'"]+|[.,!?;:'"]+$/g, ""))) whIdx.push(i);
  }
  if (!whIdx.length) return false;
  try {
    const { nlpAdapter } = await import("./ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return false; // no wink — no signal, never a false positive
    const tags = adapter.posTags(words);
    return whIdx.some((i) => tags[i - 1] === "VERB" || tags[i - 1] === "AUX");
  } catch {
    return false;
  }
}

// The teach lane's fact predicates (rendered via FACT_PREDICATE_PHRASES).
const OWNED_BY_PREDICATE = "mgx:ownedBy";
const HAS_PROPERTY_PREDICATE = "mgx:hasProperty";
// Class-membership — the SAME predicate family the ACE grammar's own
// subClassOf pattern emits (grammar/ace.mjs); named here too (Feature A) so
// the new direct-write paths below (the unknown-subject fallback, the plural
// "some/a few Xs are Ys" shape) stay obviously in that same family rather than
// re-typing the CURIE string at each call site.
const SUBCLASS_PREDICATE = "rdfs:subClassOf";
// Bug 3 (2026-07-09): the SAME "has a" predicate ConceptNet's own /r/HasA
// facts already use (FACT_PREDICATE_PHRASES, conceptnet-map.toml) — named
// here too so generalVerbTeach's "has"/"have" special case (below) stays
// obviously in that same family, interoperable with corpus HasA data on the
// read side, rather than minting a redundant mgx:has.
const HAS_A_PREDICATE = "mgx:hasA";

/** "<Name> owns/maintains <X>" — the ownership teach declarative. <Name> is one
 *  or two name tokens; <X> is a code-ish token (a path, a file, a symbol) OR a
 *  short natural noun phrase ("the tasks handler") — widened from a
 *  single-token-only object (Tier-5 playtest fix, found live: "remember that
 *  margo maintains the tasks handler" WALLED entirely, because the object
 *  didn't fit ONE bare token and generalVerbTeach explicitly stands down for
 *  "owns"/"maintains" anywhere in the sentence, deferring to this frame — so
 *  neither recognizer ever stored the fact). The article-stripping needed so
 *  "the tasks handler" reads back the same as a bare "tasks handler" is
 *  handled once, centrally, by normFactTerm (memory/core.mjs) — teachFact
 *  already normalizes both subject and object through it. The BARE form
 *  additionally requires a Capitalized name (see teachLane), so ordinary
 *  lowercase prose never lands a fact without the explicit wrapper. */
const OWNS_TEACH_RE = /^([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)\s+(?:owns|maintains)\s+(.+?)[.!?]*$/;
/** "<X> is owned by <Name>" — the PASSIVE ownership teach declarative
 *  (Tier-5 playtest fix, cycle 2, found live): at least as natural a way to
 *  state ownership as the active "<Name> owns <X>" above ("TaskController is
 *  owned by sam" WALLED entirely — "is" put it in generalVerbTeach's own
 *  GENERAL_VERB_ANYWHERE_EXCLUDE_RE stand-down territory, but no frame in
 *  this lane actually recognized the passive shape, so nothing ever claimed
 *  it). <X> (the owned thing) is a lazy multi-word capture, same discipline
 *  OWNS_TEACH_RE's own object got widened to; <Name> (the owner) mirrors
 *  OWNS_TEACH_RE's own 1-2-token name capture. Stores the SAME
 *  OWNED_BY_PREDICATE shape (subject=thing, object=owner), so "who owns X" /
 *  the yes/no readers below answer either phrasing identically. */
const OWNS_PASSIVE_TEACH_RE = /^(.+?)\s+(?:is|are|was|were)\s+owned\s+by\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)[.!?]*$/i;

/** "<Name> is the <role> of <Name>" — the relational-fact teach declarative
 *  (PLAN_TAUGHT_RELATIONS.md Item 1, Phase 1): a NAMED relationship between
 *  two entities ("ahab is the father of john"), grouped here with the other
 *  relational/possessive teach shapes above (ownership) since it's tried on
 *  the SAME ownSrc in teachLane, right after OWNS_PASSIVE_TEACH_RE and before
 *  SOME_A_FEW_RE — unconditionally ahead of generalVerbTeach's own call site,
 *  so GENERAL_VERB_ANYWHERE_EXCLUDE_RE never gets a say. The literal "the" +
 *  bare role-noun + "of" anchor is deliberate: PLAN_TAUGHT_RELATIONS.md's
 *  Item 3 (a future, not-yet-implemented "a <rule> is a <relation> of a
 *  <relation>" composition-rule teach shape) uses an INDEFINITE "a"/"an" in
 *  the same slot instead, so the two shapes structurally can never collide —
 *  this regex must keep requiring literal "the", never "a"/"an", so any
 *  future Item 3 work stays disjoint from this one. Subject/object each use
 *  the SAME 1-2-token name-capture convention OWNS_TEACH_RE's own subject/
 *  owner already use. */
const RELATION_FACT_TEACH_RE =
  /^([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+(?:is|are|was|were)\s+the\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[.!?]*$/i;

/** "every/a/an/the <N1> has a/an <N2> method" — the HAS-A-METHOD teach
 *  declarative (HANDOVER.md 2026-07-10 item 9, a new pattern the operator
 *  explicitly authorized this session — NOT one of PLAN_TAUGHT_RELATIONS.md's
 *  own six items): a possession-of-capability claim about a class/entity's
 *  method ("every Component has a render method", "a Widget has a render
 *  method"). Before this pattern existed, this exact phrasing reached NO teach
 *  recognizer at all: RELATION_FACT_TEACH_RE (above) requires a literal "is/
 *  are the ROLE of", never "has a ROLE method"; GENERAL_VERB_TEACH_RE (below)
 *  maps "has"/"have" onto the same HAS_A_PREDICATE this pattern uses, but only
 *  for a BARE, wrapper-required, single-token subject with NO leading
 *  determiner (GENERAL_VERB_DETERMINER_RE explicitly declines "every"/"a"/
 *  "the" as a subject, by design — see its own docblock) — so a determiner-led
 *  subject (the operator's own canonical example, "every Component…") fell
 *  all the way through teachLane, landing on ask.mjs's own structural
 *  "defines" grammar instead (VERB_TO_KIND maps "has"/"have" to the code-graph
 *  "defines" relation), which can't resolve "Component"/"render" as real
 *  code-graph entities and reports the vague, non-actionable
 *  `"couldn't resolve one of the terms in this question."` wall — exactly the
 *  symptom HANDOVER.md item 9 names.
 *
 *  Deliberately a NARROW, EXPLICIT new pattern, not a widening of
 *  GENERAL_VERB_TEACH_RE's own bare-subject shape (this project's own
 *  discipline: small curated closed-set patterns, each independently tested,
 *  never one generalized catch-all) — the literal trailing word "method" is
 *  the anchor that keeps this pattern structurally DISJOINT from
 *  generalVerbTeach's broader "X has a Y" territory (an ordinary "TaskController
 *  has a hat" still never matches here, and falls through to generalVerbTeach
 *  unaffected). Tried on the SAME ownSrc the other relational/possessive teach
 *  shapes above already use, ahead of generalVerbTeach's own call site, so a
 *  wrapped sentence with NO determiner ("remember that Component has a render
 *  method" — already handled by generalVerbTeach today) is claimed here first
 *  instead, producing the byte-identical stored fact and confirmation text —
 *  a widening of COVERAGE (the determiner-led/bare-unwrapped case), never a
 *  behavior change to the case that already worked.
 *
 *  Predicate minting reuses the EXISTING HAS_A_PREDICATE (mgx:hasA) —
 *  generalVerbTeach's own has/have special case already mints this, so a fact
 *  taught via either recognizer reads back interoperably. m[1] = the subject
 *  (N1, "Component"); m[2] = the capability word (N2, "render") — stored as
 *  the object `"<N2> method"` ("render method"), so the query-side readers
 *  below (HAS_METHOD_YESNO_RE/HAS_METHOD_OPEN_RE) can match on the whole
 *  "<capability> method" phrase, never just the bare capability word (which
 *  would risk colliding with an unrelated mgx:hasA fact about the same
 *  capability noun taught some other way). */
const TEACH_HAS_METHOD_RE =
  /^(?:every\s+|each\s+|all\s+|a\s+|an\s+|the\s+)?([A-Za-z][\w'-]*)\s+has\s+an?\s+([a-z][\w-]*)\s+method[.!?]*$/i;

/** "a <name> is a <base1> of a <base2>" — the fixed-hop COMPOSITION-RULE teach
 *  declarative (PLAN_TAUGHT_RELATIONS.md Item 3, Phase 4): "a grandparent is a
 *  parent of a parent" teaches a RULE (mgx:ruleKind "compose2"), never a Fact —
 *  the query side chases it via a hop-counted findActionPath search (see
 *  teachLane's own call site below and factReadBack's relational-query
 *  dispatcher). Both slots use an INDEFINITE article ("a"/"an"), the
 *  structural anchor that keeps this shape disjoint from Item 1's
 *  RELATION_FACT_TEACH_RE just above: that regex requires a literal "the" +
 *  a lone role word with no second "of"-clause; this one requires "a"/"an" in
 *  BOTH determiner slots plus a second relation-name word after "of" — the
 *  two can never both match the same input (re-verified against the real
 *  regexes, not just the design doc's own claim). m[1] = the new rule name
 *  ("grandparent"), m[2]/m[3] = the two base relation names ("parent",
 *  "parent" — may differ, e.g. an out-of-scope "an aunt is a sibling of a
 *  parent"). */
const COMPOSE2_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+([a-z][\w-]*)[.!?]*$/i;

/** "a <name> is a <base> who is <property>" — the PROPERTY-FILTERED
 *  composition-rule teach declarative (PLAN_TAUGHT_RELATIONS.md Item 4,
 *  Phase 5): "a grandfather is a grandparent who is male" teaches a RULE
 *  (mgx:ruleKind "filter"), never a Fact. `m[1]` = the new rule name
 *  ("grandfather"), `m[2]` = the base rule/relation name ("grandparent" —
 *  may itself resolve as EITHER a plain taught relation OR another Rule,
 *  e.g. a compose2 rule; the query-side dispatcher below handles either
 *  generically, never assuming which), `m[3]` = the property literal
 *  ("male"). Structurally disjoint from COMPOSE2_RULE_TEACH_RE (anchored on
 *  a literal "who", never "of" a second time) and from
 *  RECURSIVE_RULE_TEACH_RE below (anchored on "or", never "who") — the three
 *  rule-teach shapes are told apart purely by their own distinct anchor
 *  word ("of" only / "who" / "or … of … <same name>"), re-verified against
 *  the real regexes, not just this claim. */
const FILTER_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+who\s+(?:is|are)\s+([a-z][\w-]*)[.!?]*$/i;

/** "a <name> is a <baseCase>, or a <recStep> of a <name>" — the
 *  RECURSIVE/REACHABILITY rule teach declarative (PLAN_TAUGHT_RELATIONS.md
 *  Item 6, Phase 6): "a descendant is a parent, or a parent of a
 *  descendant" teaches a RULE (mgx:ruleKind "recursive"), never a Fact. The
 *  rule's OWN name reappears inside its own definition — the `\1`
 *  backreference requires the recursive slot's trailing name to be the
 *  LITERAL SAME word as `m[1]`, so a mismatched/malformed self-reference
 *  ("a descendant is a parent, or a parent of a person") simply never
 *  matches this regex at all — an honest structural decline, not a runtime
 *  guess. `m[1]` = the new rule name ("descendant"), `m[2]` = the base-case
 *  relation ("parent", hop zero), `m[3]` = the recursive step's first-hop
 *  relation ("parent" again in the illustration, though `m[2]`/`m[3]` are
 *  independently captured and need not be identical to each other — only
 *  `m[1]`'s OWN name must recur at the end). Query side is a genuine
 *  KIND-CHANGE (reachability-SET enumeration via `findReachableSet`,
 *  src/planning.mjs) from items 3/4's single-target search — see the
 *  RECURSIVE_LIST_ASK_RE query recognizer, below. */
const RECURSIVE_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*),?\s+or\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+\1[.!?]*$/i;

/** "<X> is <adjective>" — the property teach payload (wrapper-REQUIRED): a lazy
 *  subject and a single bare complement word. Never matches the "is a <noun>"
 *  membership shape (that stays the ACE grammar's), so "remember that cache is
 *  a store" still lands as rdfs:subClassOf, not a property. "was"/"were" join
 *  "is"/"are" (Tier-5 playtest fix, cycle 3, sibling of Bug A's had->have
 *  bridge for general-verb facts): "remember that the last commit was risky"
 *  reads back as a present-tense property fact ("...is risky") the same way a
 *  general-verb "had" fact already reads back as "has" — properties are
 *  timeless facts in this store, not tensed events. Safe to widen here
 *  (unlike the entry gates further up that decide whether `payload` even
 *  reaches this match at all): this path only runs on an explicit
 *  "remember/note/…"-WRAPPED sentence, never a bare one, so there's no real
 *  question-shape ("was X Y?") this could ever misfire on. */
const TEACH_PROPERTY_RE = /^(?:every\s+|each\s+|all\s+|the\s+)?(.+?)\s+(?:is|are|was|were)\s+(?!an?\b|the\b)([A-Za-z][\w-]*)$/i;

/** The teach lane's provenance tag — mirrors grammar/assert.mjs's provenanceTag
 *  shape under a distinct "teach:" family, so a taught fact is auditable apart
 *  from the ACE-parsed asserts: teach:chat:<sessionId>@<ts>. core.mjs maps the
 *  tag to a "teach" Source (trust prior in memory/trust.mjs). */
const teachProvenanceTag = (sessionId, ts) => `teach:chat${sessionId ? `:${sessionId}` : ""}${ts ? `@${ts}` : ""}`;

/** Reify one teach-lane fact + confirm (shared by the property and ownership
 *  frames). Lazy + failure-tolerated: a write failure degrades to null (the
 *  teach-miss text stands), never a crash. */
async function teachFact(memoryDir, sessionId, { subject, predicate, object, quantifier = "" }) {
  try {
    const { appendFact, normFactTerm } = await import("./memory/core.mjs");
    const s = normFactTerm(subject);
    const o = normFactTerm(object);
    if (!s || !o) return null;
    await appendFact(memoryDir, {
      subject: s, predicate, object: o,
      provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      ...(quantifier ? { quantifier } : {}),
    });
    const phrase = predicatePhrase(predicate);
    return { text: `noted — remembered: ${s} ${phrase} ${o}`, via: "assert", miss: false };
  } catch {
    return null;
  }
}

// ---- FEATURE A (0.9.x): teach new terms + quantifier phrasings ("every X is
// a/an Y", "some Xs are Ys", "your X is a/an Y", "X is Y", "a few Xs are
// Ys") + "how many Xs are Ys" recall. Design (from two prior read-only
// investigations, live-verified): the memory Facts store and EVERY read path
// (factAnswer, factReadBack, the 2-hop findIsaChain proof-chase) already work
// generically over ANY subject string — the ONLY thing stopping e.g. "redis is
// a cache" from being remembered is that parseAce's resolveNP (grammar/ace.mjs)
// only resolves subjects/objects against the closed 180-word lexicon-core.json
// noun list, so an unknown SUBJECT becomes residue and the whole sentence is
// rejected even though the OBJECT ("cache") is a perfectly good known term. The
// fix below is write-side only and deliberately NARROW: only the SUBJECT gets
// a free pass, never the OBJECT — this is not a general lexicon bypass, it's
// one additional storable shape alongside the ACE grammar's own 8 patterns. ----

/** Naive plural → singular fold for the "some/a few Xs are Ys" surface forms
 *  (mirrors factTermVariants' own naive -es/-s stripping, below, but returns
 *  ONE canonical spelling to STORE rather than a lookup Set of candidates to
 *  match against). Deliberately tiny, no NLP — a stray false fold on an
 *  already-singular noun ending in "s" is a known, accepted limitation of this
 *  same naive scheme used elsewhere in this file (factTermVariants). */
function singularizeSurface(word) {
  const w = String(word || "").trim();
  if (/[a-z]ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.slice(0, -2);
  if (/[a-z]s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
  return w;
}

/** "some Xs are Ys" / "a few Xs are Ys" — the plural class-membership
 *  quantifier shape. Captures the quantifier word itself (group 1) alongside
 *  the plural subject/object (groups 2/3); singularized before storage/lookup. */
const SOME_A_FEW_RE = /^(some|a few)\s+([\w-]+)\s+are\s+([\w-]+)$/i;

/** "(every|each|all|a|an )?X is/are (a|an )?Y" — the shape the unknown-subject
 *  fallback recognizes (group 2 = X, group 3 = Y); group 1 (when present)
 *  names the determiner, so the caller can tell a genuine "every" universal
 *  apart from a singular/specific-entity "a"/bare reading (only "every" gets a
 *  recorded quantifier here — this function's OWN caller passes it through to
 *  teachFact; assertTurn, below, records the same "every" quantifier
 *  independently for the pre-existing ACE-success path). Y (the object) is a
 *  single token, same as parseAce's own copula fragments; X (the subject) is
 *  ONE OR TWO tokens (Tier-5 playtest fix: "vulcan gizmo is a tool"/"remember
 *  vulcan gizmo is a tool" fell straight to a "teach me" nudge that offered
 *  THIS EXACT phrasing as the fix, then itself failed when tried — a
 *  single-token-only subject was too narrow for a natural 2-word noun phrase,
 *  the same class of gap OWNS_TEACH_RE's own object had before its own
 *  Tier-5 widening, above). The greedy quantifier tries the longer 2-word
 *  subject first, backtracking to 1 word only if the tail doesn't then start
 *  with is/are — the "is/are" anchor immediately after the subject removes
 *  the ambiguity a fully free-form multi-word subject would otherwise have. */
const UNKNOWN_SUBJECT_RE = /^(every\s+|each\s+|all\s+|a\s+|an\s+)?([\w-]+(?:\s+[\w-]+)?)\s+(?:is|are)\s+(?:an?\s+)?([\w-]+)$/i;

/** ISA-family predicates (mirrors the private ISA_PREDICATES set defined near
 *  memoryFacts, below, at module scope — both are simple top-level consts
 *  evaluated once at load time, so referencing either from a function defined
 *  earlier in this file is safe: no function here actually RUNS until well
 *  after the whole module has finished loading). Named again here, right by
 *  its one caller, so isGroundedByFact reads standalone. */
const MINT_ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

/** Small CLOSED set of generic English root nouns that count as always-
 *  grounded anchor terms for the mint-fallbacks below (operator refinement,
 *  2026-07-09) — deliberately NOT added to lexicon-core.json itself (that
 *  file stays the curated ~180-word CODE vocabulary; these are ordinary-
 *  English root nouns with no code meaning at all, confirmed absent from it
 *  today). Their only job is to give a user who hits the "both sides
 *  ungrounded" decline (groundingSuggestionMiss, below) an honest, guessable
 *  way in: ground one brand-new term via one of THESE words first ("every
 *  zorp is a thing"), then chain the other new term off the now-grounded one. */
const GENERIC_ANCHOR_NOUNS = new Set(["thing", "concept", "object", "entity"]);

/** Shared fact-groundedness primitive (Feature A mint-extension, point 2):
 *  true when `term` already appears as the SUBJECT or OBJECT of a previously
 *  taught isa-family fact (rdfs:subClassOf/rdf:type) in memory. A term minted
 *  by EITHER mint-fallback below (this session, or an earlier one — this
 *  reads persisted memory, not session-scoped state) is exactly as legitimate
 *  an anchor for a NEW fact as a static lexicon-core.json word — the whole
 *  point of this extension is letting new vocabulary compound turn over turn
 *  ("every cache is a store" mints "store"; "every store is a container" then
 *  needs "store" to read as known even though it's not in the static lexicon
 *  at all). Read-only, reuses memoryFacts' plain read path (existence only —
 *  no trust-ranking needed here) and normFactTerm's own normalization, so a
 *  fact-grounded term matches under the EXACT spelling teachFact itself stored
 *  it under. Failure-tolerated: no memory dir / no match → false, never a
 *  guessed "yes". */
async function isGroundedByFact(term, memoryDir) {
  if (!memoryDir) return false;
  const raw = String(term ?? "").trim();
  if (!raw) return false;
  const { normFactTerm } = await import("./memory/core.mjs");
  const t = normFactTerm(raw);
  if (!t) return false;
  // TAUGHT-only (same discipline factReadBack's own cax-sco/scm-sco proof
  // chase already uses, above, for the identical reason: the bulk background
  // corpus band (ConceptNet, trust 0.7, seeded by the thousands on a fresh
  // repo) mentions ordinary English words like "store"/"container" constantly
  // — treating THOSE as "grounded" would silently reopen the general lexicon
  // bypass this whole feature is deliberately narrow to avoid. Only what the
  // OPERATOR actually taught (or a prior `tmct syllogise` entailment) anchors
  // a term here. factRows (not memoryFacts) is used specifically because it's
  // the one read path that carries sourceTypes for this filter.
  const rows = await factRows(memoryDir);
  const isTaught = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
  return rows.some((f) => MINT_ISA_PREDICATES.has(f.predicate) && isTaught(f) && (f.subject === t || f.object === t));
}

/** Shared "is this term grounded in ANY sense" aggregate (Feature A mint-
 *  extension, point 2's named shared helper) — a static lexicon word (any
 *  part of speech, via `classify`), a GENERIC_ANCHOR_NOUNS root, OR a term
 *  already anchored by a previously taught isa-family fact (isGroundedByFact,
 *  above). Used by unknownObjectFallback's subject/object groundedness checks
 *  below, where no part-of-speech branching follows — just "known or not".
 *  (unknownSubjectFallback's own object-known check, above/below, stays
 *  narrower and NOUN-specific — see its own comment — so an object that's
 *  merely a known ADJECTIVE doesn't get misrouted into the class/subClassOf
 *  branch instead of the property branch.) */
async function isGroundedTerm(term, lex, memoryDir) {
  const raw = String(term ?? "").trim();
  if (!raw) return false;
  if (GENERIC_ANCHOR_NOUNS.has(raw.toLowerCase())) return true;
  const { classify } = await import("./grammar/lexicon.mjs");
  if (classify(raw, lex)) return true;
  return isGroundedByFact(raw, memoryDir);
}

/** The "both sides ungrounded" grounding NUDGE (operator refinement,
 *  2026-07-09): reuses teachSuggestion's own "compute a hint, APPEND it to
 *  the existing honest-miss message, never replace/silently guess" pattern
 *  (see its docblock, above, and the "did"/"why" append-style construction in
 *  teachLane's own final decline, below) for a DIFFERENT decline case —
 *  rather than mint a relationship between two brand-new terms (a real
 *  fabrication risk, unknownObjectFallback's own explicit safety guard,
 *  below), teachLane's final honest-miss text gets an EXTRA appended nudge
 *  whenever the declined payload fit the "X is/are Y" shape
 *  (UNKNOWN_SUBJECT_RE) but NEITHER side is grounded — an honest, actionable
 *  way in: ground one side via a GENERIC_ANCHOR_NOUNS root first ("every zorp
 *  is a thing"), then chain the other off the now-grounded term. Deliberately
 *  APPENDED rather than a replacement/short-circuit: a "both sides
 *  ungrounded" is/are sentence with a KNOWN subject on one side (e.g. "module
 *  is banana") never reaches this at all (isGroundedTerm(subject) is true, so
 *  the very first return below fires) — that stays unknownObjectFallback's
 *  own mint territory, entirely unaffected here. Returns "" (message
 *  unchanged) whenever the payload doesn't fit the shape, or at least one
 *  side IS already grounded — a DIFFERENT, more specific reason it declined,
 *  where this nudge would be actively unhelpful noise. */
async function ungroundedPairHint(payload, lexicon, memoryDir) {
  if (!memoryDir) return "";
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return "";
  const [, , subjectRaw, objectRaw] = m;
  const { loadLexicon } = await import("./grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  if (await isGroundedTerm(subjectRaw, lex, memoryDir)) return "";
  if (await isGroundedTerm(objectRaw, lex, memoryDir)) return "";
  // 2026-07-10 (found live via SKILL_BENCHMARK_CONVERSATION.md playtest, a
  // classic first-thing-a-user-tries example: "john is a man"): the original
  // suggestion chained the second term UNDER the first's now-grounded proper
  // name ("every man is a john") — technically accepted by the grammar (once
  // "john" is grounded, ANY term can be taught as a kind of it), but reads as
  // nonsense to a human, since a proper name is never a category. Ground both
  // sides independently instead — two clear, parallel, semantically sane
  // suggestions, not a confusing chain through an arbitrary first term.
  return ` I don't know "${subjectRaw}" or "${objectRaw}" yet. Try grounding each one first, e.g. `
    + `"every ${subjectRaw} is a thing" and "every ${objectRaw} is a thing", then re-teach the`
    + ` original fact.`;
}

/** The unknown-SUBJECT direct-write fallback (point 1 + point 2's bare-property
 *  extension): tried ONLY after the real ACE grammar (assertTurn) has already
 *  had its turn and declined. Declines itself (returns null, never a guess)
 *  when:
 *    - the payload doesn't fit the plain single-token "X is/are Y" shape at all
 *      (a multi-word subject, a relation/cardinality/etc. sentence — those stay
 *      the ACE grammar's territory, or the wrapped multi-word TEACH_PROPERTY_RE
 *      path below, unchanged);
 *    - X is actually a KNOWN lexicon word — then the ACE grammar's own miss was
 *      a real structural/vocabulary problem elsewhere (e.g. Y itself unknown as
 *      the WRONG part of speech), never silently reinterpreted through this
 *      narrow exception. (NOTE: this stays a STATIC-lexicon-only check,
 *      deliberately not widened to isGroundedTerm — a subject that's grounded
 *      only via a PRIOR taught fact, not the static lexicon, is precisely the
 *      case unknownObjectFallback, below, owns instead.)
 *    - Y resolves as NEITHER a known noun NOR a known adjective NOR a term
 *      already grounded by a prior taught fact / a GENERIC_ANCHOR_NOUNS root
 *      (Feature A mint-extension, point 2 — a term minted by
 *      unknownObjectFallback, below, reads exactly as known here as any
 *      lexicon word) — the OBJECT must still be a term tmct actually knows;
 *      an unknown Y stays an honest miss (never a guess), exactly like the
 *      pre-existing "monkey is an animal" case.
 *  Y resolving as a NOUN (or fact-/anchor-grounded) writes rdfs:subClassOf
 *  (mirrors the ACE grammar's own subClassOf/typeAssertion pattern); Y
 *  resolving as an ADJECTIVE (and not also a noun) writes mgx:hasProperty
 *  (mirrors the wrapped "remember that X is deprecated" property frame —
 *  reused here for the bare/unwrapped form too, since the free pass is about
 *  the SUBJECT, not about the "remember that" wrapper). Only the "every"
 *  determiner records a quantifier (point 3: "a"/bare/"your" read as one
 *  specific entity, not a class-level generalization). */
async function unknownSubjectFallback(payload, { memoryDir, sessionId, lexicon }) {
  if (!memoryDir) return null;
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return null;
  const [, det, subjectRaw, objectRaw] = m;
  const { loadLexicon, lookupNoun, lookupAdjective, classify } = await import("./grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  // A known X's own ACE miss is a real miss — never silently reinterpreted here.
  if (classify(subjectRaw, lex)) return null;
  const quantifier = /^every$/i.test((det || "").trim()) ? "every" : "";
  // Point 2 (mint-extension): a PRIOR turn's minted term, or a
  // GENERIC_ANCHOR_NOUNS root, grounds Y just as legitimately as a static
  // lexicon noun — both are always treated as class-level (never property),
  // consistent with unknownObjectFallback (below) always minting a CLASS.
  if (lookupNoun(lex, objectRaw) || GENERIC_ANCHOR_NOUNS.has(String(objectRaw).toLowerCase())
    || (await isGroundedByFact(objectRaw, memoryDir))) {
    return teachFact(memoryDir, sessionId, {
      subject: subjectRaw, predicate: SUBCLASS_PREDICATE, object: objectRaw, quantifier,
    });
  }
  if (lookupAdjective(lex, objectRaw)) {
    // property assertions are about ONE specific entity — never a quantifier,
    // even when phrased with "every" (point 3).
    return teachFact(memoryDir, sessionId, {
      subject: subjectRaw, predicate: HAS_PROPERTY_PREDICATE, object: objectRaw,
    });
  }
  return null; // Y unknown too — decline honestly, never guess
}

/** The unknown-OBJECT mint fallback (Feature A, 2026-07-09 operator-authorized
 *  vocabulary-growth extension): the MIRROR of unknownSubjectFallback, above —
 *  same "X is/are Y" payload shape (UNKNOWN_SUBJECT_RE, reused verbatim,
 *  never a second regex for the identical shape), tried as a SIBLING call
 *  right after unknownSubjectFallback in teachLane (below), but firing on the
 *  OPPOSITE asymmetry: SUBJECT already grounded (a real lexicon-core.json
 *  word of ANY part of speech, a GENERIC_ANCHOR_NOUNS root, OR a term a PRIOR
 *  turn already minted via either fallback — isGroundedTerm, shared with this
 *  check) and OBJECT completely ungrounded. Mints the object as a new
 *  class-level concept (rdfs:subClassOf, same predicate/quantifier machinery
 *  teachFact/unknownSubjectFallback already use) so ordinary conversation can
 *  build up new vocabulary turn over turn: "every cache is a store" (subject
 *  "cache" grounded via the static lexicon) mints "store"; a LATER "every
 *  store is a container" then finds "store" grounded via the fact just
 *  minted (not the static lexicon at all) and mints "container" the same way.
 *
 *  GATED ON A GENUINE UNIVERSAL QUANTIFIER ("every"/"each"/"all" — never bare/
 *  "a"/"an"/"your"): minting a NEW CLASS-LEVEL CONCEPT is inherently a general
 *  claim about a class, the same "every"/bare distinction unknownSubjectFallback's
 *  own docblock already draws (point 3) between a class generalization and a
 *  claim about ONE specific entity. This is load-bearing, not cosmetic: a bare
 *  "module is banana" (a KNOWN lexicon subject, an unrecognized bare object,
 *  NO determiner at all) is a pinned regression — it must stay a plain honest
 *  miss, never silently minted — and a WRAPPED "remember that X is <adjective>"
 *  (also determiner-less at the subject) must keep falling through to
 *  TEACH_PROPERTY_RE's own, more permissive arbitrary-adjective path
 *  unimpeded. Requiring the determiner keeps this fallback's mint exactly as
 *  narrow as the vocabulary-growth feature actually needs (every required
 *  test case in this feature's own spec phrases the mint sentence with
 *  "every"), without swallowing either of those pre-existing shapes.
 *
 *  The critical safety guard (operator's own stated worry, mirrored from
 *  unknownSubjectFallback's docblock): this must NEVER silently mint when
 *  BOTH sides are ungrounded ("every zorp is a florp" — two brand-new,
 *  never-seen terms with no relation to each other tmct actually knows) —
 *  declines here (null), and teachLane's own final honest-miss text picks up
 *  an appended grounding NUDGE for exactly this case (ungroundedPairHint,
 *  above) — never a silent guess, never a silent hard-swallowed decline
 *  either. Any OTHER decline (subject ungrounded + object grounded — not this
 *  fallback's asymmetry; or both grounded — already known, nothing to mint;
 *  or no genuine universal quantifier) falls through as a plain null,
 *  letting the ordinary teachLane cascade (property teach, then the generic
 *  honest-miss text) continue unaffected. */
/** PLAN_CONVERSATION.md Finding 1 fix: before minting the object as a new
 *  CLASS, ask wink's POS tagger (the SAME optional adapter subjectIsNounOrPropn,
 *  above, already uses for this kind of disambiguation, via ask-nlp.mjs's
 *  posTags) whether the word reads as anything OTHER than a NOUN/PROPN.
 *  "every Record is persisted" tags "persisted" VERB (a past participle used
 *  adjectivally); "every cache is bespoke" tags "bespoke" ADJ — both read as a
 *  property claim about one word, not a brand-new class term, so this
 *  fallback should decline and let the cascade fall through to
 *  unknownAdjectiveFallback (below), which mints the SAME word correctly as a
 *  property instead. A genuinely novel noun ("florble", "zorp") still tags
 *  NOUN under wink's own out-of-vocabulary default (confirmed live), so this
 *  never blocks the pre-existing mint-a-new-class behaviour the
 *  vocabulary-growth feature needs. No wink installed, or any tagging
 *  surprise, degrades to a null tag treated as "no signal" (never a decline)
 *  — matching every other optional-adapter path in this file (ask-nlp.mjs's
 *  own "null on any surprise, never a throw" discipline). */
async function objectReadsAsNonNoun(word) {
  try {
    const { nlpAdapter } = await import("./ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return false;
    const [tag] = adapter.posTags([String(word || "")]);
    if (!tag) return false; // no signal — never block the existing mint on a surprise
    return tag !== "NOUN" && tag !== "PROPN";
  } catch {
    return false;
  }
}
async function unknownObjectFallback(payload, { memoryDir, sessionId, lexicon }) {
  if (!memoryDir) return null;
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return null;
  const [, det, subjectRaw, objectRaw] = m;
  if (!/^(?:every|each|all)$/i.test((det || "").trim())) return null; // class-level mint needs a real universal quantifier
  const { loadLexicon } = await import("./grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  const subjectGrounded = await isGroundedTerm(subjectRaw, lex, memoryDir);
  if (!subjectGrounded) return null; // ungrounded subject isn't this fallback's asymmetry — never a guessed mint
  const objectGrounded = await isGroundedTerm(objectRaw, lex, memoryDir);
  if (objectGrounded) return null; // object already known — nothing to mint
  if (await objectReadsAsNonNoun(objectRaw)) return null; // reads like an adjective/verb, not a class noun — defer to unknownAdjectiveFallback
  const quantifier = /^every$/i.test((det || "").trim()) ? "every" : "";
  return teachFact(memoryDir, sessionId, {
    subject: subjectRaw, predicate: SUBCLASS_PREDICATE, object: objectRaw, quantifier,
  });
}

/** The adjective-MINT fallback (PLAN_TAUGHT_RELATIONS.md Item 1's sibling
 *  design, Item 5, Phase 1): "mary is female" / "the cache is bespoke" — a
 *  brand-new adjective with no lexicon entry at all, on a SUBJECT that's
 *  already grounded (by ANY of the same senses isGroundedTerm already tests
 *  for unknownObjectFallback, OR a bare Capitalized name-shaped token, the
 *  exact convention OWNS_TEACH_RE's own bare-form gate uses). Deliberately
 *  its own standalone function, tried ALONGSIDE unknownSubjectFallback rather
 *  than nested inside it: unknownSubjectFallback's own very first line
 *  (`classify(subjectRaw, lex)` truthy -> immediate `return null`) exists to
 *  hand a KNOWN subject's ACE miss back as a real miss — precisely the case
 *  this fallback needs to keep working for ("the cache is bespoke" — "cache"
 *  is a known lexicon noun), so nesting this inside that early-return would
 *  make it unreachable.
 *
 *  GROUNDING — property-specific, NOT unknownObjectFallback's class-mint
 *  guard: no "every"-quantifier gate at all. A property claim is about ONE
 *  entity, never a quantified class claim (unknownSubjectFallback's own
 *  point 3 precedent: property assertions never carry a quantifier even
 *  under "every"). So the guard here is SUBJECT-side only — isGroundedTerm,
 *  OR a bare Capitalized token — and the OBJECT (the new adjective) is never
 *  required to be independently grounded (minting it is the entire point).
 *  UNKNOWN_SUBJECT_RE's own determiner alternation has no "the" (only
 *  every/each/all/a/an), so a leading "the" rides into the subject capture
 *  itself ("the cache") rather than being split off as a determiner — the
 *  SAME leading-article strip normFactTerm (memory/core.mjs) applies before
 *  storage is applied here too, purely for the groundedness check, so this
 *  recognizes exactly the head noun ("cache") teachFact will actually store
 *  under. Branch order mirrors unknownSubjectFallback's own noun-then-
 *  adjective order: declines (null) first when the OBJECT already resolves
 *  as a known NOUN or a fact-grounded CLASS term, so a genuine class-
 *  membership sentence is never misread as a property. Matches
 *  UNKNOWN_SUBJECT_RE verbatim (the same regex unknownObjectFallback already
 *  reuses) and writes HAS_PROPERTY_PREDICATE, no quantifier, ever.
 *
 *  Sits strictly UPSTREAM of the pre-existing TEACH_PROPERTY_RE gap (the
 *  wrapped-only surface that mints ANY bare complement word with zero
 *  grounding check at all, e.g. "remember that zorp is florpy" —
 *  Verification finding 3, PLAN_TAUGHT_RELATIONS.md): this fallback does not
 *  close that gap (out of scope, a deliberate separate operator decision),
 *  only adds a properly-grounded alternative ahead of it.
 *
 *  IMPLEMENTATION ADJUSTMENT found live (not in the original plan text): a
 *  bare "module is banana" (a KNOWN lexicon-noun subject, NO article, NO
 *  capitalization, an unrecognized bare object) is an EXISTING pinned
 *  regression (test/chat-teach-quantifier.test.mjs, test/wiring-facts.test.mjs
 *  — both from unknownObjectFallback's own commit 901528f) that must stay a
 *  plain honest miss. unknownObjectFallback's own mint is guarded against
 *  this exact shape by requiring a genuine "every/each/all" quantifier — but
 *  a property claim never carries one (this function's whole premise), so a
 *  plain "subject grounded via the static lexicon alone" test would
 *  re-open precisely that regression for the property case instead. The
 *  fix: a subject grounded ONLY by a bare static-lexicon match (no article,
 *  no capitalization) does NOT qualify on its own — an article (stripped
 *  above into `bareSubject`), a capitalized name-shape, or a PRIOR-TAUGHT
 *  fact anchor (isGroundedByFact) each stand in as the "this is a deliberate
 *  entity reference, not ordinary bare prose" signal a quantifier would
 *  otherwise provide. "the cache is bespoke" and "Mary is female" both carry
 *  one of those signals (the leading "the", and capitalization,
 *  respectively); "module is banana" carries none. */
async function unknownAdjectiveFallback(payload, { memoryDir, sessionId, lexicon }) {
  if (!memoryDir) return null;
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return null;
  const [, , subjectRaw, objectRaw] = m;
  const { loadLexicon, lookupNoun, classify } = await import("./grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  // Y already a known NOUN or a fact-grounded CLASS term — a genuine class-
  // membership sentence, unknownSubjectFallback/unknownObjectFallback's own
  // territory (already had first refusal on it) — never misread as a property.
  if (lookupNoun(lex, objectRaw) || GENERIC_ANCHOR_NOUNS.has(String(objectRaw).toLowerCase())
    || (await isGroundedByFact(objectRaw, memoryDir))) return null;
  // Subject-side groundedness — strip a leading "the"/"a"/"an" first
  // (normFactTerm's own article-strip, mirrored here) so "the cache" checks
  // groundedness under its real head noun "cache", the same spelling
  // teachFact will actually normalize and store.
  const bareSubject = subjectRaw.replace(/^(?:the|an?)\s+/i, "").trim() || subjectRaw;
  const hadArticle = bareSubject !== subjectRaw;
  const capitalized = /^[A-Z]/.test(bareSubject);
  const factGrounded = await isGroundedByFact(bareSubject, memoryDir);
  const genericAnchor = GENERIC_ANCHOR_NOUNS.has(bareSubject.toLowerCase());
  // A bare (no article, no capitalization) subject grounded ONLY via the
  // static lexicon is exactly the pinned "module is banana" shape — see this
  // function's own docblock. Requires the article/capitalization/prior-fact
  // signal ALONGSIDE (not instead of) lexicon groundedness before an
  // article-only subject qualifies.
  const lexiconGrounded = hadArticle && classify(bareSubject, lex) != null;
  const subjectGrounded = capitalized || factGrounded || genericAnchor || lexiconGrounded;
  if (!subjectGrounded) return null; // no deliberate-entity signal — never a guessed mint
  return teachFact(memoryDir, sessionId, {
    subject: subjectRaw, predicate: HAS_PROPERTY_PREDICATE, object: objectRaw,
  });
}

// ---- BUG 3 (2026-07-09, operator-authorized generalizing — "I don't know
// where that ban came from, overturn it. build it."): general verb-to-
// predicate teaching. "remember tony has a hat" / "remember margo eats ribs"
// used to fall straight through teachLane returning null (not even this
// lane's own honest miss text) because the ONLY verbs the lane recognized at
// all were is/are (class-membership/property) and owns/maintains
// (ownership) — a sentence with any OTHER verb never matched a single
// recognizer, and fell to the STRUCTURAL code-graph grammar, which of course
// can't resolve an arbitrary proper noun as a code entity (confusing,
// wrong-context miss text, and sometimes a confidently WRONG "Goal
// (inferred)" line — runAsk's own teach-lane goal deduction fixes that half).
//
// RECOGNITION stays exactly as CLOSED as every other frame in this lane:
// wrapper-REQUIRED (teachLane only ever calls generalVerbTeach on `wrapped`,
// i.e. only inside an already "remember/note/…"-triggered payload — a bare
// "tony has a hat" is never silently reified, same discipline
// TEACH_PROPERTY_RE already uses), and only a well-formed <subject> <verb>
// <object> triple matches AT ALL (point 6 — a missing/unparseable object
// still declines honestly, never a guess). What's generalized is ONLY the
// PREDICATE a recognized shape maps to, never what counts as a recognized
// shape — the same "recognition closed, mapping generalized" split the
// operator explicitly authorized over this dispatch's default "prefer
// templates" guidance. ----

/** <subject> (ONE bare word — a name, "tony"/"margo") <verb> (one lowercase
 *  word) <object> (the rest). Deliberately bounded to a SINGLE-TOKEN subject
 *  with no leading determiner — not the lazy/greedy multi-word subject the
 *  is/are frames elsewhere in this lane tolerate. Reasoning (found live while
 *  building this): without real verb-position knowledge, a positional regex
 *  over an ARBITRARY-length subject is genuinely ambiguous — "every
 *  controller is a handler" would just as happily (mis)parse as
 *  subject="every", verb="controller", object="is a handler" as it would the
 *  intended reading. Bounding the subject to one bare word removes that
 *  ambiguity for exactly the shape this mechanism targets (a name-like
 *  subject, per the operator's own examples); a determiner/quantifier-led or
 *  multi-word subject simply doesn't match here and honestly declines
 *  (point 6) rather than risk a wrong split — the is/are-specific frames
 *  elsewhere in this lane already own that broader territory. */
// Tier-5 playtest fix (this session): a frequency/degree ADVERB commonly sits
// between a bare-name subject and the real verb in a natural teaching
// sentence — the operator's own example, "remember that TaskController
// usually needs review", mis-split subject="TaskController", VERB="usually"
// (GENERAL_VERB_TEACH_RE had no way to see "usually" wasn't the verb), minting
// a nonsense mgx:usually predicate and, worse, garbling the confirmation
// itself: thirdPersonSingularSurface's naive fallback appended "-ies" to the
// unrecognized lemma, surfacing "taskcontroller usuallies needs review". A
// closed, non-capturing adverb-skip (never itself eligible to BE the verb)
// fixes this at the source for both the teach shape and its query-side twins
// below, without widening what counts as a recognized shape at all — the same
// "recognition closed, mapping generalized" split this lane already uses.
const TEACH_ADVERB_SKIP_SRC = "(?:(?:usually|often|sometimes|rarely|never|always|typically|generally|"
  + "occasionally|frequently|normally|regularly|commonly|mostly|currently|still|also|really|actually)\\s+)?";
const GENERAL_VERB_TEACH_RE = new RegExp(`^([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[.!?]*$`, "i");
/** Determiners/quantifiers that make the FIRST token an article, not a real
 *  bare-name subject ("every controller…", "the cache…") — GENERAL_VERB_TEACH_RE
 *  would otherwise happily bind them as a 1-token subject and misread the
 *  REAL subject's second word as the verb. Declining here hands the sentence
 *  back to the is/are-specific frames above/below (their own territory) or an
 *  honest miss — never a guessed split. */
const GENERAL_VERB_DETERMINER_RE = /^(?:every|each|all|some|a|an|the|your|my|our|their|his|her|its)$/i;
/** Verbs owned by an earlier, more specific recognizer in this lane — is/are
 *  (class-membership/property, above) and owns/maintains (ownership, above).
 *  generalVerbTeach declines outright on these so it can never race a more
 *  specific frame for the same sentence; a genuine miss on one of THESE verbs
 *  stays that frame's own honest miss, never silently reinterpreted here. */
const GENERAL_VERB_EXCLUDE_RE = /^(?:is|are|am|owns|maintains)$/i;
/** Whole-payload safety net (defense in depth alongside the single-token
 *  subject bound above): if "is"/"are"/"am"/"owns"/"maintains" appears
 *  ANYWHERE in the sentence — not just at the guessed verb position — this
 *  is territory another frame in this lane already owns (or will, in the
 *  is/are payload block right after this one runs), so generalVerbTeach
 *  stands down entirely rather than risk a positional misread of a longer
 *  copula/ownership sentence it was never meant to parse. */
const GENERAL_VERB_ANYWHERE_EXCLUDE_RE = /\b(?:is|are|am|owns|maintains)\b/i;
/** SKILL_BENCHMARK_CONVERSATION.md persona-sweep (2026-07-11), Priority 1 —
 *  confirmed 4x independently across 2 personas: GENERAL_VERB_TEACH_RE's verb
 *  slot is a bare `[a-z]+` with NO check that the captured word is a real
 *  verb at all — a closed-class function word (a possessive/personal pronoun,
 *  a preposition, a subordinating conjunction) sitting in that position reads
 *  as an ordinary lemma just as happily as a genuine verb does, so
 *  generalVerbPredicate mints a nonsense mgx:<word> predicate and
 *  thirdPersonSingularSurface's naive -s/-es/-ies fold renders it as a
 *  garbled "confirmation" that LOOKS like a successful teach (worse than a
 *  wall — no error, no nudge). Four live repros, all misreading a closed-
 *  class second token as the verb: "can you review my code for me" (after
 *  MODAL_WRAPPER_RE's own preamble strip removes "can you", verb="my" ->
 *  mgx:my -> "mies"), "impact if i change it??" (verb="if" -> mgx:if ->
 *  "ifs"), "defs in model.mjs" (verb="in" -> mgx:in -> "ins"). A genuine verb
 *  ("mentors", "eats", "owns", "needs", "maintains" — every existing teach
 *  test's verb) is never one of these closed-class words, so this is a pure
 *  narrowing: it can only turn an already-wrong absorb into an honest
 *  decline, never break a real teach. Wink-nlp POS tagging was tried first
 *  and rejected — out of sentence context it tags "my"/"if"/"in" correctly,
 *  but IN context it also mistags the legit "mentors" (test/chat-teachlane-
 *  general-verb.test.mjs's own pinned case) as NOUN, so a POS gate would have
 *  regressed a real teach; a closed list (this project's own stated
 *  preference for chat-layer fixes — templates over general grammar rules)
 *  is both more reliable here and, being closed, can never widen recognition
 *  the way a probabilistic POS heuristic could. */
const GENERAL_VERB_NOT_A_VERB_RE = new RegExp(
  "^(?:"
  // personal/possessive/demonstrative pronouns + determiners (mirrors, and
  // extends, GENERAL_VERB_DETERMINER_RE's own closed set — that one gates the
  // SUBJECT slot, this gates the VERB slot)
  + "i|me|you|he|him|she|her|it|we|us|they|them|my|your|his|its|our|their|mine|yours|hers|ours|theirs"
  + "|this|that|these|those|a|an|the|every|each|all|some|any|no|both|either|neither"
  // prepositions
  + "|in|on|at|to|from|by|with|for|of|about|into|onto|over|under|near|before|after|during|through"
  + "|up|down|off|out|above|below|between|among|against|without|within|along|across|behind|beyond|upon|toward|towards|per"
  // conjunctions/subordinators
  + "|and|but|or|if|because|although|though|while|when|since|unless|until|whether|so|nor|than|as"
  + ")$",
  "i",
);

/** The predicate a general-verb teach payload's VERB maps to. "has"/"have"
 *  special-cases onto the EXISTING mgx:hasA predicate (point 2) — the same
 *  one ConceptNet's own /r/HasA facts already use (FACT_PREDICATE_PHRASES),
 *  so a taught "X has a Y" fact reads back interoperably with corpus HasA
 *  data, rather than minting a redundant mgx:has. Any OTHER verb mints
 *  mgx:<lemma> (point 3a) — proseLemma, the wink-nlp lemmatiser this
 *  codebase already loads elsewhere (prose-nlp.mjs), canonicalizes "eats"/
 *  "ate"/"eating" alike onto the same mgx:eat predicate; when the optional
 *  wink model isn't installed, proseLemma degrades to null (its own
 *  documented contract) and this falls back to the verb AS TYPED — still a
 *  perfectly storable/retrievable predicate, just not cross-inflection
 *  canonicalized. Never a hand-curated per-verb table entry required. */
// Bug A (operator manual-chat find, this session): only the exact raw strings
// "has"/"have" were special-cased onto HAS_A_PREDICATE above — past tense "had"
// (or "having") fell through to the generic mgx:<lemma> path, where the lemma of
// "had" IS "have", and predicatePhrase's thirdPersonSingularSurface fallback
// naively appends "s" to any unrecognized lemma ending ("have"+"s" = "haves" —
// wrong; the correct irregular is "has"). Fixed by checking the LEMMA (not just
// the raw verb) for "have" — this catches had/having/has/have uniformly, so
// "remember X had soup" reads back "...has soup", never "...haves soup".
async function generalVerbPredicate(verb) {
  const v = String(verb || "").toLowerCase();
  if (v === "has" || v === "have") return HAS_A_PREDICATE;
  try {
    const { proseLemma } = await import("./prose-nlp.mjs");
    const lemma = proseLemma();
    const l = lemma ? lemma(v) : v;
    if (l === "have") return HAS_A_PREDICATE;
    return `mgx:${l}`;
  } catch {
    return `mgx:${v}`;
  }
}

/** Recognize + resolve a general-verb teach payload into {subject, predicate,
 *  object}, or null when it doesn't fit the shape / names an excluded verb /
 *  is missing a real subject or object (point 6 — an honest decline, never a
 *  guess). Pure recognition + predicate mapping; the caller (teachLane) does
 *  the actual write via the shared teachFact. */
async function generalVerbTeach(payload) {
  const p = String(payload || "").trim();
  // A genuine declarative assertion never ends in a question mark — "g day
  // mate, you alright?" (Priority 1, above) reaches this function with no
  // leading question-word signal left to catch it (it never matched a
  // wrapper, and QUESTION_LEAD_RE only checks the FIRST word), but the
  // trailing "?" is still an unambiguous "this is a question" marker.
  if (/\?\s*$/.test(p)) return null;
  if (GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(p)) return null; // another frame's territory — stand down
  const m = p.match(GENERAL_VERB_TEACH_RE);
  if (!m) return null;
  const [, subjectRaw, verbRaw, objectRaw] = m;
  const verb = verbRaw.toLowerCase();
  if (GENERAL_VERB_EXCLUDE_RE.test(verb)) return null; // owned by a more specific frame above
  if (GENERAL_VERB_NOT_A_VERB_RE.test(verb)) return null; // a closed-class word can never be the real verb
  if (GENERAL_VERB_DETERMINER_RE.test(subjectRaw)) return null; // not a bare-name subject
  const subject = subjectRaw.trim();
  const object = objectRaw.replace(/^an?\s+/i, "").trim();
  if (!subject || !object) return null; // no well-formed triple — honest decline (point 6)
  const predicate = await generalVerbPredicate(verb);
  return { subject, predicate, object };
}

/** HANDOVER.md 2026-07-10 item 2 — is `word` a genuine NOUN/PROPN, per wink-nlp's
 *  optional POS tagger (ask-nlp.mjs's nlpAdapter, the SAME adapter the closed
 *  structural grammar already leans on)? Used to let ONE narrow bare (unwrapped)
 *  general-verb teach sentence through below: GENERAL_VERB_TEACH_RE's shape
 *  ("<word> <word> <rest>") is too permissive to trust on a bare sentence with no
 *  "remember"/"note" signal at all — "tell me a joke" and "explain the class
 *  hierarchy to me" match the IDENTICAL shape (subject="tell"/"explain", the
 *  imperative verb itself, mistaken for a subject) and must never be silently
 *  reified as bogus mgx:me/mgx:the facts (confirmed live: both are tagged VERB).
 *  A genuine declarative's first word is a NOUN/PROPN instead ("grace mentors
 *  alan", "sam owns TaskController" — confirmed live: both tagged NOUN). No wink
 *  installed degrades to false (never a guess), same as every other optional-
 *  adapter path in this codebase. */
async function subjectIsNounOrPropn(word) {
  try {
    const { nlpAdapter } = await import("./ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return false;
    const [tag] = adapter.posTags([String(word || "")]);
    return tag === "NOUN" || tag === "PROPN";
  } catch {
    return false;
  }
}

// ---- General verb-to-predicate DIRECT-QUESTION retrieval (item 5, this
// session's follow-up to the teach mechanism above): "does margo eat ribs" /
// "did margo eat ribs" / "what does margo eat" against a fact taught via
// generalVerbTeach. "did" joins "does" so past-tense forms work too (also
// GROUP 3 Bug B — "what did X have"/"did margo eat ribs"). Wired into
// factReadBack (below), which only runs on an already-true `miss`, so these
// never race ask.mjs's closed structural grammar for a real graph query
// ("does TaskController call widget" resolves there first, this lane is never
// reached). Both run the SAME GENERAL_VERB_EXCLUDE_RE/GENERAL_VERB_ANYWHERE_
// EXCLUDE_RE decline guards generalVerbTeach uses, and route the verb through
// the SAME generalVerbPredicate (not a re-implementation), so the has/have
// bridge (and Bug A's had/having lemma fix) is automatic on the query side too. ----
// Same adverb-skip as GENERAL_VERB_TEACH_RE above (TEACH_ADVERB_SKIP_SRC),
// reused so "does TaskController usually need review"/"what does
// TaskController usually need" read back a fact taught with the adverb
// skipped the same way, never mis-splitting "usually" as the verb here either.
const GENERAL_VERB_YESNO_RE = new RegExp(`^(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[?.!\\s]*$`, "i");
const GENERAL_VERB_OPEN_RE = new RegExp(`^what\\s+(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)[?.!\\s]*$`, "i");
/** GENERAL_VERB_EXCLUDE_RE was written for generalVerbTeach's fully-conjugated
 *  declarative verb ("X OWNS Y", "X MAINTAINS Y") — but "does/did X <verb> Y"
 *  captures the BARE INFINITIVE after do-support ("does X OWN Y", never "does X
 *  owns Y"), so "owns"/"maintains" literally never appear in genYN/genOpen's
 *  captured verb even when the sentence names exactly that relation. Found live
 *  (a real false "no" against a genuinely-true taught ownership fact, since
 *  generalVerbPredicate("own") mints a DIFFERENT predicate — mgx:own — than the
 *  ownership frame's own OWNED_BY_PREDICATE): the query-side guard needs the
 *  bare-infinitive counterpart too. */
const GENERAL_VERB_QUERY_EXCLUDE_RE = /^(?:be|own|maintain)$/i;

/** Sentence forms to try asserting for a teach payload: the payload as-is, and
 *  (if it carries no determiner) its "every …" universal — the ACE-OWL shape the
 *  grammar actually lands. */
function assertCandidates(payload) {
  const p = String(payload).trim();
  const out = [p];
  if (!/^(?:every|each|all|a|an)\b/i.test(p)) out.push(`every ${p}`);
  return [...new Set(out)];
}
/** The "every X is a Y" rewrite of a declarative, for the "did you mean …" hint.
 *  BUG 2 fix (2026-07-08): the article was hardcoded to "a" regardless of Y's
 *  vowel sound ("every monkey is a animal" — ungrammatical for a vowel-initial
 *  Y), which made the suggestion silently WRONG for exactly the cases where a
 *  correction is most useful. Real a/an agreement now reuses finish.mjs's own
 *  beginsWithVowelSound + the SAME grammar-rules.toml "article" rule
 *  (spelling-vowel/consonant exceptions included) rather than reimplementing
 *  vowel-sound detection a second time. */
function teachSuggestion(payload) {
  const m = String(payload).match(/^(?:every |each |all |a |an )?([\w-]+) (?:is|are) (?:a |an )?([\w-]+)$/i);
  if (!m) return null;
  const subject = m[1].toLowerCase();
  const object = m[2].toLowerCase();
  const articleRule = grammarRules().find((r) => r.kind === "article");
  const article = articleRule && beginsWithVowelSound(object, articleRule) ? "an" : "a";
  return `every ${subject} is ${article} ${object}`;
}

/** PRONOUN-SUBJECT GUARD (2026-07-08, operator repro): "remember you are a
 *  womble" and the literal "every you is a womble" both used to reach
 *  teachSuggestion/unknownSubjectFallback treating "you" like an ordinary
 *  unknown common noun — producing the nonsensical "did you mean: every you
 *  is a womble" hint (teachSuggestion), or, worse, a SILENT direct-write via
 *  unknownSubjectFallback whenever the object happened to resolve as a known
 *  noun/adjective (e.g. "he is a doctor" would have stored the bogus fact
 *  "he rdfs:subClassOf doctor"). A personal pronoun is never a valid class-
 *  membership subject for ANY object — "every <pronoun> is a Y" isn't
 *  coherent English no matter what Y is, so this is a grammatical category
 *  error, not "new vocabulary" the unknown-subject free pass exists for.
 *  Checked FIRST in teachLane, before any other recognizer gets a look at
 *  the payload (bare OR remember-wrapped surface, so it fires uniformly
 *  across entry points), and short-circuits with its own honest, distinct
 *  decline — never the generic "every X is a Y" miss text, and never a "did
 *  you mean" guess.
 *
 *  Deliberately limited to the seven UNAMBIGUOUS personal pronouns (you/i/
 *  it/they/he/she/we) — this/that/these/those are excluded on purpose: they
 *  double as legitimate demonstrative entity references elsewhere in this
 *  file (DESCRIBE_PRONOUN_RE, NEGATION_PRONOUN_RE et al.), and a claim about
 *  a demonstrated entity ("that is a bug", pointing at something real) is a
 *  much closer call than "every you is a womble" — not this bug's territory.
 *
 *  WIDENED (Bug 3, 2026-07-09): the verb group used to be the closed
 *  is/are/am copula set — correct while pronoun subjects could only ever
 *  reach a class-membership/property claim, but Bug 3's generalVerbTeach
 *  (below) opens a SECOND way a pronoun subject can reach the store, via ANY
 *  verb ("remember you has a hat", "remember he eats ribs"). A pronoun is
 *  just as invalid a fact subject under a general verb as it is under "is" —
 *  this is a grammatical category error regardless of the verb — so the verb
 *  slot now matches ANY word, not just the copula three, keeping the guard
 *  ahead of every teach recognizer (copula AND general-verb alike) the same
 *  way it already stood ahead of teachSuggestion/unknownSubjectFallback. */
const TEACH_PRONOUN_RE = /^(?:every\s+|each\s+|all\s+|some\s+|a few\s+|a\s+|an\s+)?(you|i|it|they|he|she|we)\s+\S+/i;

async function teachLane(query, { memoryDir, sessionId = "", lexicon = null }) {
  // Tier 6 playtest: this lane read the raw, un-normalized query, so a closed
  // discourse-marker preamble ahead of a teach sentence ("howdy pardner,
  // remember that TaskController is fragile") corrupted TEACH_RE's own match —
  // applyPreambleFrames is idempotent no-op on an already-clean teach sentence
  // (none of its frames' anchors — greeting/thanks/ack/modal/explain/show-give-me/
  // topic-switch/hedge — match ordinary teach phrasing, verified against this
  // lane's own test corpus), so this is purely additive.
  const rawInput = applyPreambleFrames(String(query).trim());
  const m = rawInput.match(TEACH_RE);
  const wrappedInput = m ? m[1].trim() : null;
  // "your X is a/an Y" (Feature A) — a plain casual synonym for "a/an X is a
  // Y": no special second-person semantics, so rewrite it to the ordinary
  // indefinite-article determiner UP FRONT, before any downstream regex/ACE
  // parsing ever sees it (ACE itself has no notion of "your" as a
  // determiner). Only a LEADING "your" is rewritten, so this can't misfire on
  // a "your" appearing mid-sentence; applied to both the bare and the
  // remember-wrapped surface.
  const stripYour = (s) => (s == null ? s : s.replace(/^your\s+/i, "a "));
  // "X is a KIND OF Y" / "X is a TYPE OF Y" (PLAN_TAUGHT_RELATIONS.md Item 2,
  // Phase 2): the teach-side half of this item is a ONE-LINE normalization,
  // not new storage — "a father is a kind of parent" reaches NEITHER
  // UNKNOWN_SUBJECT_RE nor BARE_DECLARATIVE_RE nor TEACH_PROPERTY_RE today,
  // because every one of those regexes requires a SINGLE-token object and
  // "kind of parent" is three tokens (Verification finding 1). Stripping the
  // "kind/type of" run down to a bare "a "/"an " immediately after the
  // is/are/was/were copula — BEFORE any teach regex ever sees the sentence —
  // recognition stays exactly as closed as before (still only "X is a Y",
  // just one more determiner-phrase spelling of "a"), no new mint path, no
  // new predicate: "a father is a kind of parent" normalizes to "a father is
  // a parent", which unknownSubjectFallback already stores as
  // father ⊑ parent today (finding 2: "parent" is already a lexicon noun).
  const stripKindOf = (s) => (s == null ? s : s.replace(/\b(is|are|was|were)\s+(?:an?\s+)?(?:kind|type)\s+of\s+/i, "$1 a "));
  // "my <class-noun> <Name> is/are …" (SKILL_BENCHMARK_CONVERSATION.md persona-
  // sweep, 2026-07-11, Priority 3) — a THIRD natural phrasing of the exact same
  // "X is a Y" assertion this lane already teaches two other ways ("john is a
  // man", a bare name; "every cat is an animal", a universal quantifier) — a
  // possessive intro clause naming an instance by class + given name ("my cat
  // whiskers", "my dog rex") ahead of the real copula clause. grammar/ace.mjs's
  // resolveNP only ever fits a 1–2 token noun phrase (its own docblock: "0 or
  // 3+ tokens: not a fragment NP") — "my cat whiskers" is three content tokens,
  // so it never reached ANY existing recognizer (ACE, BARE_DECLARATIVE_RE,
  // TEACH_RE all declined) and hit the plain grammar wall instead of teaching.
  // Stripping the "my <noun> " lead-in down to the bare <Name> reduces it to
  // the EXACT shape "john is a man" already teaches correctly — no new storage
  // path, just one more surface recognized as equivalent to an existing one.
  // Only a LEADING "my <word> <word> is/are" run is stripped (mirrors
  // stripYour's own leading-only anchor just above), so this can't misfire on
  // "my" appearing mid-sentence, and requires a genuine THIRD word before the
  // copula (never "my cat is fluffy" — a bare possessive property claim, only
  // two words before "is" — nor "my TaskController is broken", one word),
  // keeping recognition exactly as closed as the shapes it's equivalent to.
  const stripPossessiveNamedInstance = (s) =>
    (s == null ? s : s.replace(/^my\s+[a-z][\w-]*\s+([\w'-]+\s+(?:is|are)\s+.+)$/i, "$1"));
  const raw = stripKindOf(stripYour(stripPossessiveNamedInstance(rawInput)));
  const wrapped = stripKindOf(stripYour(stripPossessiveNamedInstance(wrappedInput)));

  // PRONOUN-SUBJECT GUARD — tried against BOTH surfaces (bare and remember-
  // wrapped; trailing punctuation stripped the same way the OWNS/SOME_A_FEW
  // lanes below do) before anything else in this function, so a pronoun
  // subject NEVER reaches teachSuggestion's "did you mean" hint or
  // unknownSubjectFallback's direct-write path — see TEACH_PRONOUN_RE's own
  // docblock above for why.
  const pronounSrc = (wrapped ?? raw).replace(/[.!?]+\s*$/, "");
  const pronounMatch = pronounSrc.match(TEACH_PRONOUN_RE);
  // Finding 4 fix: a pronoun-led sentence that's ALSO a mid-sentence question
  // ("it uses which controller as its base") isn't a pronoun-classification
  // problem at all — "it" was never going to be storable either way, so
  // naming the pronoun as the reason is misleading. Stand down here (no
  // interrogative guard existed on this frame before) and let the rest of
  // this function's cascade run: none of the other frames' shapes fit a
  // pronoun subject with a non-copula verb, so this falls all the way
  // through to teachLane's own honest `return null` (no wrapper, no `is`/
  // `are` payload — see the payload-construction block below), which leaves
  // whatever the structural grammar's own honest miss already said standing,
  // rather than overwriting it with a wrong-reason refusal.
  if (pronounMatch && !(await hasMidSentenceInterrogative(pronounSrc))) {
    const pronoun = pronounMatch[1];
    return {
      text: `I can't store a fact about "${pronoun}" as a class — pronouns aren't things I can classify. `
        + `I remember facts in the shape "every X is a Y", where X is a specific noun, not a pronoun. `
        + "Type /memory to see what I already remember.",
      via: "teach-miss", miss: true,
    };
  }

  // OWNERSHIP — "<Name> owns/maintains <X>", bare or remember-wrapped. The bare
  // form is double-gated: no interrogative lead, PLUS either side spelling a
  // Capitalized token — so the "who owns <X>" READ question and ordinary
  // lowercase prose ("everybody owns a share") never land a fact here.
  // HANDOVER.md 2026-07-10 item 2 fix: the gate used to check ONLY the owner
  // name (own[1]) — "sam owns TaskController" WALLED entirely, because "sam"
  // isn't capitalized, even though "TaskController" (own[2], the owned thing)
  // is an obviously code-shaped proper name and just as strong a signal that
  // this isn't ordinary prose. Either side capitalized is now enough.
  const ownSrc = wrapped ?? raw.replace(/[.!?]+\s*$/, "");
  // Finding 4 fix: computed ONCE and reused by every ownSrc-gated frame below
  // (own/ownPassive/rel/hasMethod/compose2/filterRule/recursiveRule) — same
  // source string, so one wink pass suffices; see hasMidSentenceInterrogative's
  // own docblock (near QUESTION_LEAD_RE) for why this is additive alongside
  // each existing anchored QUESTION_LEAD_RE check, never a replacement for it.
  const ownSrcMidQuestion = await hasMidSentenceInterrogative(ownSrc);
  const own = ownSrc.match(OWNS_TEACH_RE);
  if (own && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion
    && (wrapped || /^[A-Z]/.test(own[1]) || /^[A-Z]/.test(own[2]))) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: own[2], predicate: OWNED_BY_PREDICATE, object: own[1],
    });
    if (stored) return stored;
  }
  // PASSIVE ownership — "<X> is owned by <Name>" (Tier-5 playtest, cycle 2).
  // Same bare-form gate as the active shape just above: a Capitalized owner
  // name AND no interrogative lead, so "is TaskController owned by anyone"
  // (a genuine yes/no QUESTION, handled by factReadBack instead) never lands
  // a bogus fact here.
  const ownPassive = ownSrc.match(OWNS_PASSIVE_TEACH_RE);
  if (ownPassive && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion && (wrapped || /^[A-Z]/.test(ownPassive[2]))) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: ownPassive[1], predicate: OWNED_BY_PREDICATE, object: ownPassive[2],
    });
    if (stored) return stored;
  }

  // RELATIONAL FACT — "<Name> is the <role> of <Name>" (PLAN_TAUGHT_RELATIONS.md
  // Item 1, Phase 1). Grouped with the other relational/possessive teach shapes
  // just above (both ownership forms), tried on the SAME ownSrc, unconditionally
  // ahead of generalVerbTeach's own call site below so
  // GENERAL_VERB_ANYWHERE_EXCLUDE_RE never gets a say. Predicate minting reuses
  // generalVerbPredicate VERBATIM (no sibling function) — implementation-agnostic
  // to part of speech, so a role noun like "father" mints mgx:father the same
  // way a general verb would; an ordinary Fact, no new storage shape.
  const rel = ownSrc.match(RELATION_FACT_TEACH_RE);
  if (rel && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: rel[1], predicate: await generalVerbPredicate(rel[2]), object: rel[3],
    });
    if (stored) return stored;
  }

  // HAS-A-METHOD TEACH — "every/a/an/the <N1> has a/an <N2> method"
  // (HANDOVER.md 2026-07-10 item 9): a possession-of-capability claim, stored
  // as an ordinary Fact via the SAME HAS_A_PREDICATE generalVerbTeach's own
  // has/have special case already uses (see TEACH_HAS_METHOD_RE's own
  // docblock above for the full design). Grouped with the other relational/
  // possessive teach shapes above, tried on the SAME ownSrc, unconditionally
  // ahead of generalVerbTeach's own call site below — disjoint from
  // RELATION_FACT_TEACH_RE just above (that shape requires a literal "the
  // ROLE of", never "has a … method") and from generalVerbTeach's own bare-
  // subject shape (this one is the ONLY recognizer in this lane that accepts
  // a leading determiner — "every"/"a"/"an"/"the" — before a "has a … method"
  // claim).
  const hasMethod = ownSrc.match(TEACH_HAS_METHOD_RE);
  if (hasMethod && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: hasMethod[1], predicate: HAS_A_PREDICATE, object: `${hasMethod[2]} method`,
    });
    if (stored) return stored;
  }

  // COMPOSE2 RULE TEACH — "a <name> is a <base1> of a <base2>"
  // (PLAN_TAUGHT_RELATIONS.md Item 3, Phase 4): stores a RULE (appendRule,
  // kind "compose2"), never a Fact — tried right after item 1's relational
  // fact above, on the SAME ownSrc, disjoint from it by determiner alone (see
  // COMPOSE2_RULE_TEACH_RE's own docblock). The query-side hop-counted chase
  // lives in factReadBack's relational-query dispatcher.
  const compose2 = ownSrc.match(COMPOSE2_RULE_TEACH_RE);
  if (compose2 && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const { appendRule, RULE_KIND_COMPOSE2 } = await import("./memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: compose2[1],
        kind: RULE_KIND_COMPOSE2,
        slots: { base1: compose2[2], base2: compose2[3] },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: a ${compose2[1]} is a ${compose2[2]} of a ${compose2[3]}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  // FILTER RULE TEACH — "a <name> is a <base> who is <property>"
  // (PLAN_TAUGHT_RELATIONS.md Item 4, Phase 5): stores a RULE (appendRule,
  // kind "filter"), never a Fact — tried right after item 3's compose2
  // block above, same ownSrc, disjoint from it by anchor word alone
  // ("who", never a second "of" — see FILTER_RULE_TEACH_RE's own docblock).
  // The query-side generic base-then-property chase lives in factReadBack's
  // relational-query dispatcher (resolveRelation's own "filter" branch).
  const filterRule = ownSrc.match(FILTER_RULE_TEACH_RE);
  if (filterRule && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const { appendRule, RULE_KIND_FILTER } = await import("./memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: filterRule[1],
        kind: RULE_KIND_FILTER,
        slots: { base: filterRule[2], property: filterRule[3] },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: a ${filterRule[1]} is a ${filterRule[2]} who is ${filterRule[3]}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  // RECURSIVE RULE TEACH — "a <name> is a <baseCase>, or a <recStep> of a
  // <name>" (PLAN_TAUGHT_RELATIONS.md Item 6, Phase 6): stores a RULE
  // (appendRule, kind "recursive"), never a Fact. Tried alongside the other
  // rule-teach shapes above, on the same ownSrc — RECURSIVE_RULE_TEACH_RE's
  // own `\1` backreference already guarantees a malformed/mismatched
  // self-reference never matches at all, so no extra validation is needed
  // here beyond appendRule's own slot-presence check. The query-side
  // reachability-SET enumeration (a genuine kind-change from the other two
  // rule kinds' single-target search) lives in factReadBack's own
  // RECURSIVE_LIST_ASK_RE dispatch, below.
  const recursiveRule = ownSrc.match(RECURSIVE_RULE_TEACH_RE);
  if (recursiveRule && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const { appendRule, RULE_KIND_RECURSIVE } = await import("./memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: recursiveRule[1],
        kind: RULE_KIND_RECURSIVE,
        slots: { baseCase: recursiveRule[2], recStep: recursiveRule[3] },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: a ${recursiveRule[1]} is a ${recursiveRule[2]}, or a ${recursiveRule[3]} of a ${recursiveRule[1]}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  // "some Xs are Ys" / "a few Xs are Ys" (Feature A) — the plural class-
  // membership quantifier shape. ACE has no quantifier-phrase pattern at all
  // (parseAce never even attempts a fit), so this is ALWAYS a direct write,
  // never routed through assertTurn below. Wrapper-optional, like the
  // "every X is a Y" baseline — a plural "some/a few" claim reads as an
  // ordinary declarative teach the same way "every" always has. The OBJECT
  // still has to be a known lexicon noun (the same "subject gets the free
  // pass, object doesn't" discipline as unknownSubjectFallback below) — an
  // unknown object falls through to the generic honest-miss cascade at the
  // bottom of this function, same as every other unstorable teach.
  const someSrc = wrapped ?? raw.replace(/[.!?]+\s*$/, "");
  // Finding 4 fix: additive alongside the existing anchored QUESTION_LEAD_RE
  // check — same discipline as ownSrcMidQuestion above (hasMidSentenceInterrogative's
  // own docblock, near QUESTION_LEAD_RE, has the full reasoning).
  const someSrcMidQuestion = memoryDir && !QUESTION_LEAD_RE.test(someSrc) ? await hasMidSentenceInterrogative(someSrc) : false;
  const someMatch = memoryDir && !QUESTION_LEAD_RE.test(someSrc) && !someSrcMidQuestion ? someSrc.match(SOME_A_FEW_RE) : null;
  if (someMatch) {
    const quantifier = someMatch[1].toLowerCase();
    const subject = singularizeSurface(someMatch[2]);
    const object = singularizeSurface(someMatch[3]);
    const { loadLexicon, lookupNoun } = await import("./grammar/lexicon.mjs");
    const lex = lexicon || loadLexicon();
    if (lookupNoun(lex, object)) {
      const stored = await teachFact(memoryDir, sessionId, {
        subject, predicate: SUBCLASS_PREDICATE, object, quantifier,
      });
      if (stored) return stored;
    } else {
      // Tier-5 playtest fix (cycle 2), found live: "remember that some
      // functions are risky" — Y ("risky") is not a lexicon NOUN, so the
      // subclass path just above correctly declines it (SOME_A_FEW_RE is
      // subclass-only, by design — "risky" isn't even in the closed
      // lexicon at all, as either noun or adjective, so gating this decline
      // on "is Y a known adjective" missed the actual case entirely on the
      // first attempt at this fix). Without this guard, the sentence fell
      // through to unknownSubjectFallback/TEACH_PROPERTY_RE below, which DO
      // tolerate a multi-word subject with NO vocabulary check on the
      // complement at all — silently mis-teaching the LITERAL 2-word string
      // "some functions" as if it were one proper-noun subject ("noted —
      // remembered: some functions is risky", the quantifier word baked
      // wrongly into the subject and a subject/verb agreement error to
      // boot), a fact "how many functions are risky" could never sensibly
      // read back either (HOW_MANY_ARE_RE's own reader only ever looks for
      // the SUBCLASS_PREDICATE shape this path would have stored, not this
      // one). A quantified PROPERTY claim isn't a supported shape yet (only
      // a quantified SUBCLASS claim is) — decline honestly here instead of
      // silently mis-teaching, rather than let a later, less-specific frame
      // guess a wrong split.
      return {
        text: `I can only remember a quantified fact as "${quantifier} ${someMatch[2]} are <a kind of thing>" (like "${quantifier} bugs are issues") — `
          + `a quantified claim about a PROPERTY ("${quantifier} ${someMatch[2]} are ${object}") isn't a shape I can store yet. `
          + `I can remember "${someMatch[2]} are ${object}" for one specific ${subject}, though — try naming it directly.`,
        via: "teach-miss", miss: true,
      };
    }
  }

  // GENERAL VERB-TO-PREDICATE TEACH (Bug 3) — "remember <Subject> <verb>
  // <Object>" where <verb> is neither is/are (handled below via the ACE/
  // unknown-subject/property paths) nor owns/maintains (handled above).
  // Wrapper-REQUIRED (`wrapped`, not `raw`) — see generalVerbTeach's own
  // docblock for why this keeps recognition exactly as closed as every other
  // frame in this lane. Tried before the is/are `payload` block below so a
  // non-copula verb never falls through this function returning null with no
  // miss text at all (the ORIGINAL bug: "remember tony has a hat" never even
  // reached this lane's own honest-miss cascade, landing on the structural
  // grammar's wrong-context wall instead).
  if (wrapped && memoryDir && !QUESTION_LEAD_RE.test(wrapped) && !(await hasMidSentenceInterrogative(wrapped))) {
    const gv = await generalVerbTeach(wrapped);
    if (gv) {
      const stored = await teachFact(memoryDir, sessionId, gv);
      if (stored) return stored;
    }
  } else if (!wrapped && memoryDir && !QUESTION_LEAD_RE.test(correctMisspellings(raw))
    && !(await hasMidSentenceInterrogative(correctMisspellings(raw)))) {
    // BARE path (HANDOVER.md 2026-07-10 item 2 fix): "grace mentors alan" — no
    // "remember"/"note" wrapper at all — used to silently reach neither this
    // frame NOR an honest miss, landing on the raw structural wall instead
    // (or, at exactly <=3 words with no code-ish token, the UNRELATED
    // isConversational() orientation card — see subjectIsNounOrPropn's own
    // docblock for why a plain wrapper-required gate can't safely widen to
    // bare sentences on shape alone: "tell me a joke" fits the identical SVO
    // shape and must never be reified). Only a POS-confirmed NOUN/PROPN
    // subject earns a try here — the same distinction that separates a
    // genuine declarative from an imperative request. The QUESTION_LEAD_RE
    // check runs the SAME correctMisspellings() pass ask.mjs's own typo
    // tolerance already uses (not `raw` itself) — found live: "wich modules
    // touch model.mjs" (a typo'd "which…" structural question, MISSPELLINGS-
    // table-corrected everywhere ELSE in this file) POS-tags its uncorrected
    // "wich" as a bare NOUN (wink's honest fallback for any unrecognized
    // token, not a real signal), which would otherwise mis-store it as a
    // fact instead of leaving it for the structural grammar's own typo-
    // tolerant retry to answer for real.
    const subjectWord = raw.match(/^([\w'-]+)/)?.[1];
    if (subjectWord && (await subjectIsNounOrPropn(subjectWord))) {
      const gv = await generalVerbTeach(raw);
      if (gv) {
        const stored = await teachFact(memoryDir, sessionId, gv);
        if (stored) return stored;
      }
    }
  }

  let payload = null;
  if (wrapped && /\b(?:is|are)\b/i.test(wrapped)) payload = wrapped;
  else if (BARE_DECLARATIVE_RE.test(raw) && !QUESTION_LEAD_RE.test(raw) && !(await hasMidSentenceInterrogative(raw))) payload = raw;
  if (!payload) {
    // Tier-5 playtest fix (cycle 3), found live: "remember that every
    // controller needs review" — a QUANTIFIED subject ("every X", declined
    // by generalVerbTeach's own GENERAL_VERB_DETERMINER_RE, by design — see
    // its docblock on the ambiguity risk of a free-form multi-word subject)
    // combined with a non-copula verb ("needs", not is/are/owns/maintains)
    // fits NONE of the recognizers above, so `payload` stays null and this
    // used to return null SILENTLY — the exact "wrong-context wall" bug
    // class Bug 3's generalVerbTeach mechanism was built to close for
    // "remember margo eats ribs", re-escaping here through a combination
    // that mechanism's own deliberate subject-shape restriction doesn't
    // cover. An explicit "remember/note/…"-wrapped sentence is an
    // UNAMBIGUOUS teach-intent signal — falling through to the ordinary
    // structural-query wall is a wrong-context reply even when nothing here
    // can actually STORE the fact; if `wrapped` stood, keep going with it as
    // the payload so the residue-detection/final-decline logic below still
    // runs (never a guess at storing it, just never silence either). A bare,
    // unwrapped sentence that also fits no shape has no such signal — return
    // null and let the ordinary cascade decide, unchanged.
    if (!wrapped) return null;
    payload = wrapped;
  }
  // Try to store it (a live session provides the write target). assertTurn returns
  // the "noted — remembered …" confirmation or null (grammar miss / unknown words).
  if (memoryDir) {
    for (const cand of assertCandidates(payload)) {
      // assertTurn ITSELF records the "every" quantifier (point 3) on a plain
      // universal success, so every caller (this loop AND the top-level
      // declarative-sentence dispatch in runTurn) gets it uniformly.
      const stored = await assertTurn(cand, { memoryDir, sessionId, focus: null, lexicon });
      if (stored) return { text: stored.answer, via: "assert", miss: false };
    }
    // BUG "redis" fix (Feature A point 1): the real ACE grammar just declined
    // (unknown words / not the membership shape) — try the narrow unknown-
    // SUBJECT direct-write fallback before falling to the honest-miss cascade.
    // Covers BOTH the bare and the wrapped surface (payload is already
    // unwrapped either way) — see unknownSubjectFallback's own docblock for
    // the exact narrowing rules (object must still be known, etc.).
    const fallback = await unknownSubjectFallback(payload, { memoryDir, sessionId, lexicon });
    if (fallback) return fallback;
    // MIRROR mint fallback (Feature A, 2026-07-09 operator-authorized vocabulary-
    // growth extension): the known-subject/unknown-object asymmetry — tried
    // right after the unknown-subject case declines, so a subject the STATIC
    // lexicon (or a prior taught fact) already grounds can mint a brand-new
    // object term. See unknownObjectFallback's own docblock for the exact
    // narrowing rules (the "both sides ungrounded" safety guard, etc.).
    const objectFallback = await unknownObjectFallback(payload, { memoryDir, sessionId, lexicon });
    if (objectFallback) return objectFallback;
    // ADJECTIVE-MINT fallback (PLAN_TAUGHT_RELATIONS.md Item 5, Phase 1): tried
    // right after unknownObjectFallback declines, so a grounded subject (static
    // lexicon, a prior taught fact, or a bare Capitalized name) can mint a
    // brand-new adjective's property fact. See unknownAdjectiveFallback's own
    // docblock for the exact narrowing rules (the "both sides ungrounded"
    // safety guard, and why this must be a standalone function rather than
    // nested inside unknownSubjectFallback).
    const adjectiveFallback = await unknownAdjectiveFallback(payload, { memoryDir, sessionId, lexicon });
    if (adjectiveFallback) return adjectiveFallback;
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
  // BUG 2 fix (2026-07-08): compare the CORRECTED suggestion against a
  // normalized (trimmed, whitespace-collapsed, lowercased) form of what the
  // user actually typed, not the raw payload — so trivial formatting
  // differences never manufacture a spurious "did you mean". With
  // teachSuggestion's article now grammatically correct (above), this
  // equality guard's original intent is restored rather than replaced: it
  // suppresses the hint exactly when X and Y themselves are already spelled
  // in the canonical "every X is a Y" shape (nothing useful to add), and
  // shows it whenever the corrected form differs — including the wrong-
  // article case ("every monkey is a animal") that used to be silently
  // suppressed because the OLD teachSuggestion's own hardcoded "a" matched
  // the user's mistake byte-for-byte.
  const normalizedPayload = String(payload).trim().toLowerCase().replace(/\s+/g, " ");
  const suggestion = teachSuggestion(payload);
  const did = suggestion && suggestion !== normalizedPayload ? ` Did you mean: "${suggestion}"?` : "";
  // Honest miss reason (2026-07-08, "separately, not a bug" clarification): when
  // the payload structurally fits the ACE fragment but names word(s) outside
  // tmct's closed 180-word lexicon (lexicon-core.json), parseAce already
  // reports exactly which tokens are unrecognized as `residue` — assertTurn's
  // loop above discards it on a miss. Re-derive it here (same lexicon, same
  // candidate sentences) so the miss message can NAME the word(s), rather than
  // leaving the user to guess whether the problem was grammar shape or
  // vocabulary. A payload that doesn't fit the fragment AT ALL (parseAce
  // returns null, no residue) gets the plain generic message — genuinely a
  // shape mismatch, not an unrecognized-word one. This does NOT widen the
  // lexicon itself: "redis"/"monkey"/"animal" still fail to store; the
  // message now says why.
  let unknown = [];
  if (memoryDir) {
    try {
      const { parseAce } = await import("./grammar/ace.mjs");
      let lex = lexicon;
      if (!lex) { const { loadLexicon } = await import("./grammar/lexicon.mjs"); lex = loadLexicon(); }
      for (const cand of assertCandidates(payload)) {
        const parse = parseAce(cand, lex);
        if (parse?.residue?.length) { unknown = [...new Set(parse.residue.map((w) => String(w).toLowerCase()))]; break; }
      }
    } catch { /* lexicon unavailable — fall through to the generic message */ }
  }
  // HANDOVER.md 2026-07-10 item 3: this used to claim "I can only teach facts
  // using tmct's own code-vocabulary nouns" — false (general vocabulary teaching
  // is fully supported elsewhere, e.g. "Paris is the capital of France" stores
  // directly, and unknownSubjectFallback/ungroundedPairHint above both accept
  // ANY new vocabulary once one side is grounded). The real constraint named
  // here now: at least one side of a fact must already be grounded (or the
  // sentence must fit a specific relation shape) — not a vocabulary restriction.
  const why = unknown.length
    ? ` I don't recognize ${joinList(unknown.map((w) => `"${w}"`))} as ${unknown.length === 1 ? "a word" : "words"} I know — `
      + "any vocabulary works, but at least one side of a fact needs to already be grounded to something I "
      + "know (or fit one of my specific relation shapes), not two brand-new terms at once."
    : "";
  // Grounding NUDGE (operator refinement, 2026-07-09): APPENDED, never a
  // replacement, exactly like "did" above — see ungroundedPairHint's own
  // docblock for why this is scoped to the "both sides ungrounded, fits the
  // X is/are Y shape" case only.
  const groundingHint = await ungroundedPairHint(payload, lexicon, memoryDir);
  return {
    text: `I couldn't store that —${why} I remember facts in the shape "every X is a Y", where X and Y are `
      + `words I know.${did}${groundingHint} Type /memory to see what I already remember.`,
    via: "teach-miss", miss: true,
  };
}

// #2 INTENT LANE — META/SELF. Bare self/session questions answered from stats /
// memory / orientation, never the grammar wall or the raw fact-dump. WOULD-MISS
// ONLY (the caller gates on a miss) and every pattern is a WHOLE-LINE self/session
// reference with no graph entity or predicate, so real graph queries ("what does X
// import", the meta "what does imports mean", "what did i ask before") never match.
// Bug D (operator manual-chat find, this session): "what is in your memory"/
// "what's in your memory" is a plain synonym of the bare "what do you know" —
// widened here rather than folded in as "what do you remember" (that phrase is
// ALREADY WHOLE_RECALL_RE's own, more specific, territory — it lists every
// remembered fact, a strictly better answer than this lane's short summary; see
// WHOLE_RECALL_RE's docblock below and the pinned "'what do you remember' ...
// STILL list facts" test — folding it in here would silently regress that).
const WHAT_KNOW_RE = /^(?:what\s+(?:do\s+you|d'?you)\s+know(?:\s+so\s+far)?|what(?:'s|s|\s+is)\s+in\s+your\s+memory)$/;
// 0.8.2 WS4 wall kindness (c): the most likely stranger openers — "what does this
// app/codebase do", "what is this app (for)" — join the orientation lane, so a
// first-touch question gets the live overview instead of the grammar wall.
// Playtest sprint round 1 (2026-07-10): "what does this do" — the bare pronoun,
// no explicit noun — used to fall through this lane entirely (the "do" branch
// required an explicit app/code/codebase/project/repo noun after this/the) into
// MODULE_ORIENT_RE, which tried to resolve "this" as a graph entity, failed, and
// hit the raw grammar wall — even though the identical-intent "what can you tell
// me about this project" already answers cleanly via this same lane. The noun is
// now OPTIONAL after "this" specifically (kept REQUIRED after "the", since bare
// "what does the do" is not real input) — a natural stranger-opener that was one
// token away from already working.
const META_ORIENT_RE = /^(?:what(?:'s| is| are)?\s+this(?:\s+(?:app|codebase|repo|repository|project|code|thing))?|what\s+(?:codebase|repo|repository|project)\s+is\s+this|what\s+does\s+this(?:\s+(?:app|code|codebase|project|repo))?\s+do|what\s+does\s+the\s+(?:app|code|codebase|project|repo)\s+do|what\s+is\s+(?:this|the)\s+app(?:\s+for)?|what\s+am\s+i\s+looking\s+at|what\s+is\s+tmct|how\s+do\s+i\s+(?:start|begin|get\s+started|get\s+going|load\s+(?:my\s+)?code|index\s+(?:my\s+)?(?:code|repo|repository)|use\s+(?:this|you|tmct))|where\s+do\s+i\s+(?:start|begin)|what\s+should\s+i\s+(?:read|look\s+at)\s+first(?:\s+to\s+understand\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?|where\s+should\s+i\s+start\s+reading(?:\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?|where\s+do\s+i\s+begin\s+reading(?:\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?)$/;
/** HANDOVER.md 2026-07-10 item 3 (part 2): a bare "what is in here"/"what's in
 *  here"/"whats in here" — the SAME orientation intent as META_ORIENT_RE's own
 *  "what's in this repo"-shaped members, just phrased with the CONTEXT_WORDS
 *  pronoun "here" instead of a named noun (app/codebase/repo/…). ask.mjs's own
 *  containment grammar parses "here" as a genuine pronoun object and, when a
 *  focus IS standing, resolves it there exactly as intended — this regex is
 *  ONLY ever tried when there is NO focus (see the call site's `!focus?.label`
 *  gate), so that existing resolution path is completely untouched. With
 *  nothing to resolve "here" against, ask.mjs's grammar instead renders the
 *  honest but unhelpful "'here' needs a selected node…" miss — a poor answer
 *  for a genuine first-time stranger who has never selected anything yet.
 *  Tested against the NORMALIZED query (metaLane's call site runs
 *  normalizeQuery first) rather than the raw text, so a preamble-wrapped
 *  opener ("hey, first time trying this out - what is in here?") reaches this
 *  exactly as the BARE "what is in here?" does — same preamble/filler-word
 *  stripping ask.mjs's own grammar already applies before it ever sees the
 *  pronoun. */
const NO_FOCUS_WHATS_IN_HERE_RE = /^what(?:'s|s|\s+is)\s+in\s+here\??$/i;

/** A SHORT memory summary (never a fact dump) for the bare "what do you know".
 *  This branch only fires when rows.length === 0 — i.e. precisely the case where
 *  vocabulary seeding either hasn't run or produced nothing, so the hook makes NO
 *  term-specific promise (an unconditionally-true pointer: the teach lane and
 *  `tmct init` both work with zero preconditions), rather than suggesting a
 *  vocabulary example that would be guaranteed to miss right after being offered.
 *  The no-code-graph branch's teach example is a CONCRETE pair from the closed
 *  ACE lexicon (playtest: an abstract "every X is a Y" invites a curious user to
 *  substitute intuitive-but-unknown words — "every cache is a thing" — which the
 *  closed lexicon then rejects; "every bug is an issue" is confirmed to parse and
 *  store, see test/chatflow-tier0.test.mjs). */
async function memorySummary(memoryDir, graph) {
  const rows = memoryDir ? await memoryFacts(memoryDir) : [];
  if (!rows.length) {
    const hook = moduleCountOf(graph) > 0
      ? 'ask about this codebase\'s structure (imports, calls, definitions), or teach me with "every X is a Y"'
      : 'run `tmct init` to seed a starter vocabulary, or teach me directly, e.g. "every bug is an issue"';
    return `I haven't been told any facts yet — ${hook}. /memory to inspect, /help for commands.`;
  }
  const preds = new Set(rows.map((f) => f.predicate).filter(Boolean));
  const n = rows.length;
  const span = pickPhrase("facts-across", `${n}:${preds.size}`, "across");
  return `I remember ${n} fact${n === 1 ? "" : "s"} ${span} ${preds.size} relation `
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
/** A trailing intensifier/filler adverb tacked onto "do"/"does" ("what does the
 *  store module do exactly?", "...do exactly", "what X does really") — fast
 *  loop round 8 (ESL/filler-phrasing angle): the closed-form anchor below used
 *  to require "do"/"does" to be the LAST word before the optional "?", so this
 *  one extra word past it hit the raw grammar wall even though the shared
 *  FILLER_WORDS/normalizeQuery pass (used elsewhere in the file) never sees
 *  this lane's case-preserving text at all. Mirrors MODULE_ORIENT_POLITENESS_RE
 *  just below: closed, optional, single-lane blast radius — a bare "what does
 *  X do" still matches with this suffix empty. */
const TRAILING_ADVERB_RE = "(?:\\s+(?:exactly|really|actually|anyway))?";
const MODULE_ORIENT_RE = new RegExp(`^what\\s+does\\s+(.+?)\\s+do${TRAILING_ADVERB_RE}\\??$`, "i");
/** The SUBJECT-FIRST word order of the SAME question ("what saveStore does" vs
 *  "what does saveStore do") — Tier 6 playtest, §3b surface-variation axis: a
 *  perfectly natural alternate phrasing of an ALREADY-recognized intent that
 *  used to hit the raw grammar wall outright (MODULE_ORIENT_RE's own anchor
 *  requires "does" BEFORE the term). Tried only when MODULE_ORIENT_RE/
 *  MODULE_PURPOSE_RE both miss; the entity-resolution gate just below (a real,
 *  UNIQUE graph entity or this lane declines) is what keeps this loose an
 *  ending safe — a syntactic match against a term that isn't a real entity
 *  simply falls through unchanged, same as every other lane in this file. */
const MODULE_ORIENT_SVO_RE = new RegExp(`^what\\s+(.+?)\\s+does${TRAILING_ADVERB_RE}\\??$`, "i");
// Seonix Batch 3 (3a) — purpose/identity phrasing: "whats X for"/"what's X
// about"/"what is X for", the sibling of "what does X do" that asks for the
// SAME module-grain overview. Deliberately does NOT claim the literal noun
// "app" ("what is this app for") — META_ORIENT_RE (above) already hardcodes
// that exact phrasing and is checked BEFORE moduleOrientLane runs (metaLane's
// own ordering), so this regex only ever gets a chance at OTHER resolvable
// terms. "what(?:'s|s|\s+is)" mirrors PERSONAL_ASSISTANT_NUDGE_RE's own
// tolerance for the bare "whats" contraction spelling, just below.
const MODULE_PURPOSE_RE = /^what(?:'s|s|\s+is)\s+(.+?)\s+(?:for|about)\??$/i;

/** A leading politeness/formal-ESL wrapper this lane's own anchored regexes
 *  otherwise miss entirely (Tier 6 playtest): "please explain what does X do"
 *  starts with neither "what"/"whats" (MODULE_ORIENT_RE/MODULE_PURPOSE_RE's own
 *  anchor) nor bare "explain" (normalize.mjs's own EXPLAIN_WRAPPER_RE, which
 *  requires NOTHING before "explain" — a leading "please" defeats it too), so
 *  it fell straight to the raw grammar wall. A repeated (please|kindly) plus an
 *  optional "explain [to me]" — both closed, both optional, so a bare "what
 *  does X do" is untouched (the whole prefix matches empty). */
const MODULE_ORIENT_POLITENESS_RE = /^(?:(?:please|kindly)\s+)*(?:explain\s+(?:to\s+me\s+)?)?/i;

/** authorLane's discipline, mirrored: a closed regex + an EXACT, UNIQUE
 *  resolution via resolveEntity, else null — never a guess. Pronoun/self
 *  subjects ("what does it/this do", "what's it for") are META_ORIENT_RE's/
 *  isConversational's territory, not this lane's — declined here so they
 *  fall through unchanged. */
async function moduleOrientLane(query, { graph }) {
  if (!graph) return null;
  let q = String(query).trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  // Tier 6 playtest: this lane reads the ORIGINAL (case-preserving) query text
  // and never ran any of the general-purpose normalization passes the rest of
  // the file uses for the SAME class of surface noise — correctMisspellings
  // for a typo'd anchor word ("waht dose the logger modul do"), applyPreambleFrames
  // for a topic-switch/self-interruption preamble ("scratch that, what does X
  // do") — plus a lane-local politeness strip for "please explain X" (applyPreambleFrames's
  // own EXPLAIN_WRAPPER_RE requires the string to literally START with "explain",
  // so a LEADING "please"/"kindly" ahead of it defeats that frame; see
  // MODULE_ORIENT_POLITENESS_RE's own docblock). All three are additive,
  // closed-set, and idempotent on an already-clean query, so applying them here
  // only ever WIDENS what resolves, never narrows it.
  q = applyPreambleFrames(correctMisspellings(q)).replace(MODULE_ORIENT_POLITENESS_RE, "");
  const m = q.match(MODULE_ORIENT_RE) || q.match(MODULE_PURPOSE_RE) || q.match(MODULE_ORIENT_SVO_RE);
  if (!m) return null;
  const term = m[1].trim();
  if (/^(?:it|this|that|they|them)$/i.test(term)) return null;
  const ent = await resolveEntity(graph, term);
  if (!ent) return null;
  const ind = graph.byId?.get?.(ent.id);
  if (!ind) return null;
  return { text: moduleOverviewText(graph, ind), via: "meta" };
}

async function metaLane(query, { graph, memoryDir, last = null, templates = null, vocabHint = null, focus = null }) {
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
  // HANDOVER.md 2026-07-10 item 3 (part 2): a bare "what is in here" with NO
  // standing focus — see NO_FOCUS_WHATS_IN_HERE_RE's own docblock. Tested
  // against normalizeQuery's output (the SAME normalization ask.mjs's own
  // grammar runs before it ever sees the "here" pronoun), not the raw `q`
  // above, so a preamble-wrapped opener reaches it identically to the bare
  // form. Gated on !focus?.label so a real standing focus (where ask.mjs
  // already resolves "here" against it) is completely unaffected — this only
  // ADDS a fallback for the true first-turn case, never changes resolution
  // when a focus exists.
  if (!focus?.label) {
    const stripped = normalizeQuery(String(query)).trim().replace(/[?.!]+$/, "").trim();
    if (NO_FOCUS_WHATS_IN_HERE_RE.test(stripped)) {
      const text = orientationText(graph, templates, vocabHint);
      return { text: last?.answer === text ? META_ORIENT_REPEAT_ONELINER : text, via: "meta" };
    }
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
// "was" joins "is" (2026-07-11 playtest find): "who was grace hopper" is the same
// identity-card ask as "who is grace hopper", just past-tense phrasing — the way a
// curious user actually asks about a person, code author or not. Previously only
// present tense matched, so "who was <name>" fell all the way to the plain
// grammar wall even for a name IN the author index.
const AUTHOR_WHO_IS_RE = new RegExp(`^who\\s+(?:is|was)\\s+${AUTHOR_NAME_SRC}$`, "i");
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

// #5(g) OUT-OF-DOMAIN PERSONAL-ASSISTANT NUDGE (BUG 3 fix, 2026-07-08): "what
// time is it" / "what's the weather" / "what day is it" — obviously not an
// attempted code-graph query at all (no structural noun/verb), but 4+ words
// with no dotted/camelCase/"()" token, so it slips past BOTH looksCodeish and
// isConversational's ≤3-word catch-all, straight to the raw grammar wall
// ("couldn't parse this as a graph question. Try: ...") — a dead-end per
// SKILL_CHAT_PLAYTEST.md §0 ("every turn either answers, or gives a guiding
// nudge... a turn that does neither is a dead-end"). A small closed set, same
// discipline as RISK_NUDGE_RE/OPINION_NUDGE_RE above: this is a genuine
// capability ceiling (tmct has no clock/calendar/weather capability) — the
// fix is an honest decline pointing back at what tmct actually does, never a
// fabricated time/date/weather answer.
// "what(?:'s|s|\s+is)" also accepts the bare "whats" spelling — the same
// informal contraction ask-vocab.mjs's own CONTRACTIONS table maps to "what
// is" for the graph-query path; nudgeAnswer sees the raw (not contraction-
// normalized) query text, so it earns its own tolerance here too.
const PERSONAL_ASSISTANT_NUDGE_RE = new RegExp(
  "^(?:"
  + "what\\s+time\\s+is\\s+it(?:\\s+(?:now|right\\s+now))?"
  + "|what(?:'s|s|\\s+is)\\s+the\\s+time(?:\\s+(?:now|right\\s+now))?"
  + "|what\\s+day\\s+is\\s+it(?:\\s+today)?"
  + "|what(?:'s|s|\\s+is)\\s+(?:the\\s+)?(?:day|date)(?:\\s+today)?"
  + "|what(?:'s|s|\\s+is)\\s+today'?s\\s+date"
  + "|what(?:'s|s|\\s+is)\\s+the\\s+weather(?:\\s+like)?(?:\\s+(?:today|outside))?"
  + "|how'?s\\s+the\\s+weather(?:\\s+like)?(?:\\s+(?:today|outside))?"
  + ")\\??$",
  "i",
);

/** STACCATO NEGATION ("not X", "not X then", "except X") — SKILL_CHAT_PLAYTEST
 *  Tier-2, 5th pass: a rapid-fire rejection of a specific item, with no verb at
 *  all — the bare-connective sibling of STACCATO_PRONOUN_RE/STACCATO_SWAP_RE
 *  (below), but with no positive alternative named. Two flavors, BOTH
 *  genuinely unanswerable as a real graph query (never fabricated):
 *   - a BARE pronoun rejection ("not that one", "not those", "not it") names
 *     no alternative at all — what the user DOES want instead is known only
 *     to them, not derivable from the graph.
 *   - a NAMED rejection ("not app/lib/b.mjs", "not Widget then") names a real
 *     candidate to EXCLUDE from a just-given list, but excluding a member
 *     from a prior result set is a capability the engine genuinely doesn't
 *     have yet (verified live: even the fully-spelled "which of those is not
 *     X" doesn't compile — parsePredicateFilter has no negation branch).
 *  Before this, both fell to the generic orientation card (a short,
 *  non-codeish turn trips isConversational's ≤3-word catch-all) or the raw
 *  grammar wall (a codeish one, e.g. a path) — neither names what actually
 *  went wrong. This is an honest, GUIDING nudge (§0), never a fabricated
 *  filtered answer and never a bare wall. */
const STACCATO_NEGATION_RE = /^(?:and\s+)?(?:not|except(?:\s+for)?)\s+(.+?)(?:\s+then|\s+though)?[?.!]*$/i;
const NEGATION_PRONOUN_RE = /^(?:it|that|this|those|them)(?:\s+ones?)?$/i;

/** STACCATO COMPARATIVE (SKILL_CHAT_PLAYTEST Tier-2, 6th pass, cycle 8 —
 *  cycle 7's own recommendation): "more than that", "which is bigger", "is
 *  there anything bigger", "bigger than that" following a superlative answer
 *  ("which module has the most imports" -> "src/handlers/tasks.mjs — 5").
 *  Genuinely unanswerable as a real graph query, never fabricated: tmct's
 *  superlative only ever names the single top (or bottom) match for a metric
 *  (evalSuperlative) — it has no "runner-up"/"next ranked" or "greater than a
 *  number" capability to reach for. Before this, both a short/non-codeish
 *  phrasing ("more than that") and the wall these route to (once the
 *  isConversational catch-all is deferred below) fell to the generic
 *  orientation card or the raw grammar wall — neither says what actually went
 *  wrong. Same "honest, guiding nudge, never a bare wall" discipline as
 *  STACCATO_NEGATION_RE just above; the standing focus (now the superlative
 *  WINNER after the chat.mjs fix that made a superlative set it) names what
 *  the user can compare against directly. */
const STACCATO_COMPARATIVE_RE =
  /^(?:(?:is\s+there\s+|what(?:'s|\s+is)\s+)?(?:anything|something)?\s*(?:more|bigger|larger|smaller|fewer|less)\s*(?:than\s+(?:that|it|this))?|which(?:\s+one)?\s+is\s+(?:bigger|smaller|larger|more|less))\s*\??$/i;

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
function nudgeAnswer(query, focus, vocabHint = null) {
  const q = String(query).trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  if (PERSONAL_ASSISTANT_NUDGE_RE.test(q)) {
    // "what is a dog" used to be hardcoded here regardless of session state — a lie
    // in any UNSEEDED session (no `tmct init`/corpus load ever ran), the exact
    // "offered example that itself fails" bug class the "vocab-hint is never a lie"
    // discipline (test/chat-ux.test.mjs) already fixed on the other 5 vocabulary-hint
    // surfaces (banner, greeting, capability orientation, meta/self, memory summary)
    // — this out-of-domain nudge was simply never brought into that same discipline.
    // vocabHint (threaded from runAsk/runTurn's own hasSeededVocabulary check) is
    // ALREADY the correct session-gated clause: "what is a dog" when seeded, `tmct
    // init` otherwise — reused verbatim instead of a second, ungated copy.
    return "I don't have access to that — I'm a deterministic code/vocabulary assistant, not a general assistant. "
      + `Ask me about code structure ("which modules import <name>"). ${vocabHint || 'Run `tmct init` to seed a starter vocabulary.'}`;
  }
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
  const neg = q.match(STACCATO_NEGATION_RE);
  if (neg) {
    const term = neg[1].trim();
    if (NEGATION_PRONOUN_RE.test(term)) {
      const name = focus?.label || "Widget";
      return `not sure what you'd like instead of ${focus?.label || "that"} — name it directly, e.g. "what calls ${name}".`;
    }
    return "I can't filter a previous list by exclusion yet — ask the positive shape directly "
      + `(e.g. "which modules import <name>"), or ask about ${term} on its own.`;
  }
  if (STACCATO_COMPARATIVE_RE.test(q)) {
    const name = focus?.label;
    return "I only name the single top (or bottom) match for a metric — no runner-up ranking, no comparing against a number. "
      + (name
        // "how many imports does <name> have" used to sit here but never parses — the
        // count grammar (ask.mjs's parseAggregate) requires a known entity-kind noun
        // ("modules", "classes", …) right after "how many", and "imports" isn't one; a
        // relation noun there is always an honest miss, for any <name>. "how many
        // modules does <name> import" is the real working per-entity count shape.
        ? `Ask about a specific module/class/function directly to compare it with ${name} (e.g. "how many modules does <name> import").`
        : `Ask a specific ranking directly, e.g. "which module has the most imports".`);
  }
  // A bare STACCATO PRONOUN continuation ("also that one?", "and it") with NO
  // standing focus at all (Tier-2 playtest, 6th pass, cycle 8): describeWrapperAnswer
  // (4d, below) already resolves this shape perfectly when a real focus stands
  // (T18) — it honestly DECLINES (null) when there is none, same discipline as
  // every other focus-dependent lane. Before this branch, that decline fell
  // through all the way to the generic multi-line orientation card, which names
  // nothing about what actually went wrong. Symmetric with STACCATO_NEGATION_RE's
  // own no-focus nudge just above ("not sure what you'd like instead… — name it
  // directly"): a positive pronoun with nothing to point at gets the same honest,
  // tailored decline instead of the wall. (Exposed by the STACCATO_LEAKED_CONNECTIVES
  // fix in runAsk: "what about imports" -> "and calls?" no longer silently — and
  // WRONGLY — installs a substring-matched module as focus, so a chain of two
  // vague relation touches genuinely has no antecedent for a third "also that
  // one?" to resolve — this nudge is what such a chain should always have gotten.)
  const pronounContinuation = q.match(STACCATO_PRONOUN_RE);
  if (pronounContinuation && !focus?.label) {
    return `not sure what "${pronounContinuation[1].toLowerCase()}" refers to yet — name something directly, e.g. "what calls <name>".`;
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

/** Resolve a free-text term to a single graph entity via the ask engine's own
 *  tiered resolver — {id,label} on a UNIQUE hit, null on a miss/ambiguity/no graph.
 *  Lazy + failure-tolerated (see the file docblock): the worst case is a turn that
 *  records fewer ids / does not update the focus, never a crash or a wrong id.
 *  The leading-article-strip + trailing-grain-word disambiguation ("the logger
 *  module" -> Module-only "logger") lives centrally in resolveObject itself
 *  (ask.mjs) so every direct caller of resolveObject (ask()'s own WHERE/describe
 *  grammar, traverse(), etc.) gets it too, not just this wrapper. */
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
    // "touch" dropped from this cross-product for the same reason rephraseHint() drops it
    // (ask.mjs) — Module/Function/Class is never the subject of a touch edge, only Commit.
    shapes = '"which <functions|classes|modules> <import|call|use|test> <name>", ' +
      '"what does <name> <import|export>", "what uses <name>", "where is <name> defined", ' +
      '"when did <name> change", "which commits touched <name>"';
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

/** Bug 3 (2026-07-09) point 3b: the MECHANICAL fallback for a predicate this
 *  table has no curated entry for — specifically generalVerbTeach's minted
 *  "mgx:<lemma>" predicates ("mgx:eat", "mgx:drive", …), which by design have
 *  no per-verb table row (that would be the anti-pattern the operator's
 *  dispatch explicitly called out to avoid). Reconstructs the naive third-
 *  person-singular surface form so "margo mgx:eat ribs" still renders as the
 *  natural "margo eats ribs" — the mechanical INVERSE of singularizeSurface's
 *  own naive -s/-es/-ies fold used elsewhere in this file, same accepted-
 *  limitation trade (no real morphology; a handful of doubly-irregular verbs
 *  render slightly off but never wrong-MEANING). "has"/"have" never reach
 *  this fallback — generalVerbPredicate special-cases them onto the CURATED
 *  mgx:hasA entry above before a predicate is ever minted. Any OTHER unknown
 *  predicate (not the "mgx:<lemma>" shape — e.g. a stray/foreign CURIE) still
 *  renders verbatim, unchanged from before this fix. */
function thirdPersonSingularSurface(lemma) {
  const w = String(lemma || "");
  // Bug A safety net: "have" should never reach this naive fallback at all
  // (generalVerbPredicate special-cases it onto mgx:hasA before a predicate is
  // ever minted), but if some OTHER path ever reaches here with it as typed —
  // e.g. wink-nlp unavailable so lemma degrades to the raw verb — the naive
  // "+s" rule would produce the wrong-MEANING "haves" instead of the correct
  // irregular "has".
  if (/^have$/i.test(w)) return "has";
  if (/[a-z]y$/i.test(w) && !/[aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh|o)$/i.test(w)) return `${w}es`;
  return `${w}s`;
}
function predicatePhrase(predicate) {
  if (FACT_PREDICATE_PHRASES[predicate]) return FACT_PREDICATE_PHRASES[predicate];
  const m = /^mgx:([a-z]+)$/i.exec(String(predicate || ""));
  return m ? thirdPersonSingularSurface(m[1]) : predicate;
}
const factPhrase = (f) => `${f.subject} ${predicatePhrase(f.predicate)} ${f.object}`;

/** The mechanical INVERSE of generalVerbPredicate: recovers the bare role/verb
 *  word a taught relational Fact's predicate was minted from ("mgx:father" ->
 *  "father"), or null for a predicate that isn't the "mgx:<word>" mint shape at
 *  all (a curated predicate like mgx:hasProperty/mgx:ownedBy/mgx:hasA never
 *  names a chaseable relation, so callers below simply never match it against
 *  a queried relation name). PLAN_TAUGHT_RELATIONS.md Phase 2/4's own shared
 *  substrate: factReadBack's relational-query dispatcher (RELATION_FACT_YESNO_RE)
 *  uses this to enumerate "which already-taught fact-predicates touch this
 *  (subject, object) pair" without hand-rolling a second lemma table — the
 *  SAME "mgx:<lemma>" shape generalVerbPredicate mints is simply read backward,
 *  synchronously (no lemmatizer round-trip needed to go this direction). */
function relationRoleWord(predicate) {
  const m = /^mgx:([a-z][\w-]*)$/i.exec(String(predicate || ""));
  return m ? m[1].toLowerCase() : null;
}

// ---- BUG 1 fix (2026-07-08): "what is a tree used for" filters to JUST the
// UsedFor facts, instead of grammar.mjs's meta-whatis template's lazy tail
// swallowing "tree used for" whole as one literal term (a guaranteed
// vocabulary-lookup miss — "tree used for" names no class/predicate). Reuses
// FACT_PREDICATE_PHRASES itself as the marker vocabulary (no second table):
// every phrase that reads as "<copula> <marker>" (e.g. "is used for", "is
// part of") derives a trailing marker ("used for", "part of") a "what is a
// <subject> <marker>" question can end on, since the leading "is" is already
// consumed by the template's own "what is" anchor. Phrases with no leading
// is/are copula ("can", "causes", "requires", "has", …) don't fit that
// question shape at all and are correctly excluded automatically — this is a
// DERIVATION, not a curated subset. The single-letter "a" (from rdf:type's
// bare "is a") is excluded explicitly: too short to anchor on without a real
// risk of eating a genuine multi-word subject ending in "a".
const TRAILING_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES)
  .map(([predicate, phrase]) => {
    const m = /^(?:is|are)\s+(.+)$/i.exec(phrase);
    return m ? { predicate, marker: m[1].trim().toLowerCase() } : null;
  })
  .filter((e) => e && e.marker.length > 1)
  .sort((a, b) => b.marker.length - a.marker.length); // longest marker first

/** Split a meta-shaped term into {subject, predicate}: "tree used for" ->
 *  {subject:"tree", predicate:"mgx:usedFor"} when the term ends in a known
 *  TRAILING_PREDICATE_MARKERS marker with a non-empty subject ahead of it;
 *  otherwise {subject: term, predicate: null} (the term stands as-is — the
 *  ordinary undifferentiated "what is a X" behavior). Pure, no I/O. */
function splitMetaPredicate(term) {
  const t = String(term || "").trim();
  const lower = t.toLowerCase();
  for (const { marker, predicate } of TRAILING_PREDICATE_MARKERS) {
    if (lower === marker) continue; // no subject left to the left of the marker
    if (lower.endsWith(` ${marker}`)) {
      const subject = t.slice(0, t.length - marker.length).trim();
      if (subject) return { subject, predicate };
    }
  }
  return { subject: t, predicate: null };
}

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

/** Try `prove(subj, obj)` over every (subject variant × object variant)
 *  combination, returning the first truthy witness or null — the small
 *  shared search the two cardinality readers below both need (a taught
 *  restriction's subject/onClass are singular, but a queried term may be
 *  spelled slightly differently, e.g. pluralized). */
function findAcrossVariants(subjVariants, objVariants, prove) {
  for (const subj of subjVariants) {
    for (const obj of objVariants) {
      const w = prove(subj, obj);
      if (w) return w;
    }
  }
  return null;
}

/** GENERIC "kind" nouns a taught subject's head word is often built from
 *  ("logger MODULE", "task CONTROLLER") — excluded from the head-word
 *  overlap fallback both KNOW_ABOUT_RE's "what do you know about X" listing
 *  and IS_ADJECTIVE_YESNO_RE's property yes/no reader use (below): a bare
 *  length >= 4 floor alone isn't enough, since "module" (6 chars) is shared
 *  by "logger module" AND "validate module" and any OTHER "X module" taught
 *  subject — without this exclusion, "is the validate module deprecated"
 *  confidently answered YES off a fact taught for "logger module" (found
 *  live, Tier-5 playtest cycle 5 — a real false-positive fabrication, not a
 *  routing gap, caught before shipping). Mirrors RECALL_STOPWORDS' own
 *  path-noise exclusion (src/lib/mjs never counting as a real overlap
 *  either) — same principle, a different word class. */
const GENERIC_ENTITY_WORDS = new Set([
  "module", "modules", "class", "classes", "function", "functions",
  "method", "methods", "handler", "handlers", "controller", "controllers",
  "service", "services", "component", "components", "flow", "flows",
  "thing", "things", "item", "items", "object", "objects", "commit", "commits",
]);

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
 *  A FOLLOW-UP spot check (later dispatch, same plan) sampled the 903 rows
 *  this heuristic admits and confirmed the risk note is real even after the
 *  single-word filter: generic-English collisions ("battalion"~"heap",
 *  "bash"~"sock") and, more dangerously, IN-DOMAIN false synonyms — pairs
 *  where both endpoints are real software terms but are NOT interchangeable
 *  ("interpreter"~"compiler", "string"~"thread") — the exact "confidently
 *  wrong within the domain" failure this codebase's ground rules treat as
 *  worse than an honest miss. SYNONYM_DENYLIST below removes the specific
 *  false pairs found by that spot check (a manually-reviewed blocklist, the
 *  same shape as `conceptnet-map.toml`'s own reviewed relation-gate — not a
 *  general noise heuristic); a full manual review of the remaining ~900
 *  rows is still the honest follow-up, not claimed as done here either. */
const SYNONYM_DENYLIST = new Set([
  ["interpreter", "compiler"], // different execution strategies, not synonyms
  ["string", "thread"], // unrelated CS concepts (text data vs. execution thread)
  ["heart", "kernel"], // generic-English collision on "kernel"
  ["battalion", "heap"], // generic-English collision on "heap" (data structure)
  ["bash", "sock"], // generic-English collision ("bash"/"sock" = to hit)
  ["command", "skill"], // too loose to be a safe query-time substitution
  ["docker", "longshoreman"], // proper-noun/tool name vs. unrelated profession
  ["name", "list"], // generic-English collision, not a domain synonym
  ["list", "number"], // generic-English collision, not a domain synonym
].map(([a, b]) => [a, b].sort().join("|")));

let synonymIndexCache = null;
async function synonymIndex() {
  if (synonymIndexCache) return synonymIndexCache;
  const index = new Map();
  const add = (a, b, source) => {
    const ta = String(a || "").trim().toLowerCase();
    const tb = String(b || "").trim().toLowerCase();
    if (!ta || !tb || ta === tb) return;
    if (SYNONYM_DENYLIST.has([ta, tb].sort().join("|"))) return;
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

/** "is/are/was/were <X> the/a/an <role> of <Y>" — the RELATIONAL-QUERY yes/no
 *  reader (PLAN_TAUGHT_RELATIONS.md Phase 2, item 1's own query-side gap +
 *  item 2's alias chase + Phase 4 item 3's compose2-rule chase, all three
 *  dispatched from ONE recognizer — see factReadBack's own relAsk block for
 *  the full 3-step lookup: direct fact, alias-chased fact, then compose2 rule).
 *  Deliberately tried BEFORE ISA_ASK_RE gets a chance at this shape (see
 *  factReadBack's own placement, ahead of ISA_ASK_RE's match site): "is ahab a
 *  parent of john" ALSO fits ISA_ASK_RE's own "a"/"an" determiner alternation
 *  (backtracking "parent of john" into ISA_ASK_RE's single free-form object
 *  capture) — checked live, ISA_ASK_RE's own block always returns (a hit or an
 *  explicit `return null`), so whichever regex's block runs FIRST wins the
 *  shape outright; this is the same "add a more specific recognizer earlier in
 *  the cascade" precedent WHO_OWNS_RE/ISA_ASK_RE themselves already set
 *  relative to the more general readers below them. Accepts "the" (item 1's
 *  own literal-"the" direct-fact query, "is ahab the father of john") AND
 *  "a"/"an" (item 2/4's alias-chase and rule-chase queries, which need the
 *  indefinite article since the relation/rule name being asked about is
 *  itself often the more general or composed one) — the determiner carries no
 *  write-time collision risk here the way RELATION_FACT_TEACH_RE vs
 *  COMPOSE2_RULE_TEACH_RE's determiner split does, because this is a READ-side
 *  reader with a single unified dispatcher, not two competing WRITE shapes.
 *  Structurally disjoint from plain ISA_ASK_RE/OWNS_PASSIVE_YESNO_RE shapes
 *  that have no trailing " of <Y>" clause at all (verified: "is a module a
 *  component" — no "of" clause — never matches this regex; see this file's
 *  own PLAN_TAUGHT_RELATIONS.md "Phase 2 — DONE" note for the full collision
 *  analysis). */
const RELATION_FACT_YESNO_RE =
  /^(?:is|are|was|were)\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+(?:the|an?)\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;

/** "who is the grandparent of john" — the REVERSE relational-query reader
 *  (Gap 2, live-tested 2026-07-09, PLAN_TAUGHT_RELATIONS.md follow-up).
 *  RELATION_FACT_YESNO_RE just above needs BOTH subject and object (a yes/no
 *  for one named pair); this is the missing mirror shape — given a relation
 *  name and only the OBJECT, find every SUBJECT that satisfies it. Shares
 *  RELATION_FACT_YESNO_RE's own "the"/"a"/"an" determiner alternation (same
 *  reasoning: "who is the father of john" is a direct-name query, "who is a
 *  parent of john" is an alias/rule-name query — no write-time collision risk
 *  here either, this is a read-side reader). Structurally disjoint from
 *  WHO_OWNS_RE ("who owns/maintains …", a different verb entirely) and from
 *  AUTHOR_WHO_IS_RE (no trailing " of <Y>" clause at all, and gated to a
 *  would-miss git-authorship lane that declines silently on a non-author
 *  name, verified live). Dispatch lives in factReadBack's own (a0.2) block,
 *  below — a `resolveRelationChaseReverse` closure re-deriving the SAME
 *  resolution logic as (a0)'s `resolveRelationChase` (direct fact, alias via
 *  findIsaChain, compose2 via a reverse hop-counted chase, filter via a
 *  recursive base-then-property chase), walked backward from the object.
 *  HANDOVER.md 2026-07-10 item 3 (teach-then-recall gap): "who" also accepts
 *  "what" — a taught relation whose role isn't a person ("paris is the capital
 *  of france") reads naturally as "what is the capital of france", and the
 *  resolution below is identical either way (it just returns the satisfying
 *  subject(s)); the two words never compete for a query built from a DIFFERENT
 *  shape, since T5's bare meta-whatis grammar shape ("what is X") only wins the
 *  turn when factAnswer/factReadBack's own more specific readers upstream (this
 *  one included) have already declined. */
const RELATION_WHO_ASK_RE =
  /^(?:who|what)\s+(?:is|are)\s+(?:the|an?)\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;

/** "list the descendants of ahab" — the REACHABILITY-SET list query
 *  (PLAN_TAUGHT_RELATIONS.md Item 6, Phase 6's wiring half): a genuine
 *  KIND-CHANGE from RELATION_FACT_YESNO_RE just above — every entity
 *  reachable from the named start entity through a taught `recursive` Rule,
 *  not a single yes/no. `m[1]` = the rule's PLURAL name ("descendants",
 *  singularized via singularizeSurface before the findRuleByName lookup —
 *  the same naive plural fold SOME_A_FEW_RE's own teach-side surface already
 *  uses elsewhere in this file), `m[2]` = the start entity ("ahab"). Dispatch
 *  lives in factReadBack's own (a0.5) block, below — findRuleByName +
 *  findReachableSet (src/planning.mjs), never a yes/no answer. */
const RECURSIVE_LIST_ASK_RE = /^list\s+(?:the\s+|all\s+)?([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;

/** "is a module a component" — the yes/no vocabulary form the graph grammar
 *  doesn't parse; checked against the isa-family fact predicates only. */
const ISA_ASK_RE = /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+(?:a\s+kind\s+of|a\s+type\s+of|an?)\s+(.+?)[?.!\s]*$/i;
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

// Live-caught 2026-07-11 (follow-up to the "what is a kind of X" ambiguousParse
// fix, commit 5c858bf): RELATION_FACT_YESNO_RE/RELATION_WHO_ASK_RE both capture a
// middle "role" word and treat it as an arbitrary user-taught relation/rule NAME
// ("is X the father of Y", "who is the capital of Y") — but "kind"/"sort"/"type"/
// "subclass"/"superclass" are this file's OWN vocabulary for the ISA/inherits
// relation, never a name a user could have taught a relation under. Left
// unexcluded, "what is a kind of animal" (once envelope/parse issues that used to
// mask this were fixed) reached RELATION_WHO_ASK_RE first and produced a false "I
// don't know a relation or rule called 'kind' yet" — inherits IS known, there's
// just no fact making anything a kind of that particular object (a case (b5)
// above already handles correctly, or ELSE whatever answer already stands —
// a code-graph-specific miss, a relation-force glossary explanation — should be
// left alone, never overridden by this generic reader).
const ISA_IDIOM_ROLE_WORDS = new Set(["kind", "sort", "type", "subclass", "superclass"]);
/** "so john is a man now right?" / "john is a man, right?" — a DECLARATIVE
 *  statement wrapped in a confirmation-check tag ("now right?"/"right?"/
 *  "correct?"), found live (playtest sprint round 1, 2026-07-10) after a
 *  just-declined teach attempt: the user reasonably assumes it worked and
 *  asks to confirm — but this shape doesn't match ISA_ASK_RE at all (no
 *  leading "is/are"), so it fell to the fully GENERIC grammar wall instead of
 *  the same (already ISA-tailored) honest miss/hint the plain "is X a Y" form
 *  gets. Deliberately narrow (requires "right?"/"correct?"/"yeah?" as the
 *  VERY LAST word, optionally preceded by "now" and/or a comma) so it can
 *  only ever REDIRECT a would-be-wall to the isaAsk block's own answer —
 *  never a fabricated confirmation, and never touches phrasings that already
 *  have their own home (e.g. OPINION_NUDGE_RE's own "is the code good"
 *  ordering is unaffected — that starts with "is", leaving no room for this
 *  regex's required leading subject clause). */
const CONFIRM_TAG_RE = /^(?:so\s+)?(.+?)\s+(?:is|are)\s+(?:an?\s+)?(.+?)\s*,?\s*(?:now\s+)?(?:right|correct|yeah)\??$/i;
/** "what do you know about caches" — the open recall-everything form. Bug E
 *  (operator manual-chat find, this session) widened this to also accept
 *  "what is in your memory about X" / "what's in your memory about X" / "what
 *  do you remember about X" as plain synonyms — none of these collide with an
 *  existing more-specific lane (TOLD_ABOUT_RE only owns "what did i tell you
 *  about X"; WHOLE_RECALL_RE's own "what do you remember" has no "about X"
 *  tail, so it's a disjoint shape). */
const KNOW_ABOUT_RE = /^(?:what\s+do\s+you\s+know\s+about|what(?:'s|s|\s+is)\s+in\s+your\s+memory\s+about|what\s+do\s+you\s+remember\s+about)\s+(.+?)[?.!\s]*$/i;
/** How many facts a single answer lists before the remainder is paged with "more". */
const FACT_ANSWER_CAP = 32;

/** Finding 5 (PLAN_CONVERSATION.md) — four sibling readers closing the gap left
 *  by ISA_ASK_RE's own family: forward yes/no and reverse-by-object shapes for
 *  `mgx:capableOf`, `mgx:hasA`, and the ISA-family predicates. None of these
 *  four leads ("can"/"could", "what can … do", "what has", "what inherit(s)")
 *  overlaps KNOW_ABOUT_RE's fixed leads above, or RELATION_FACT_YESNO_RE/
 *  RELATION_WHO_ASK_RE's required leading "is/are/was/were" (those two live in
 *  the separate factReadBack, only ever reached via `factAnswer(...) ??
 *  factReadBack(...)` — never both). */
const CAN_ASK_RE = /^(?:can|could)\s+(?:an?\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z]+)[?.!\s]*$/i;
const WHAT_CAN_DO_RE = /^what\s+can\s+(?:an?\s+)?(.+?)\s+do[?.!\s]*$/i;
const WHAT_HAS_RE = /^what\s+has\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
// Widened 2026-07-11 (live-caught follow-up to the ambiguousParse fix, commit
// 5c858bf): on the FIRST turn of a graph-less session, dispatchTool's
// loadGraph() throws its own documented "the graph is empty... this repo
// starts with no graph" ToolError (src/server.mjs) — a pre-existing, by-design
// bootstrap behavior (self-corrects from turn 2 on) — which leaves `envelope`
// null for the rest of THIS turn's processing. The envelope.parsed branch just
// below can't help on that turn, so this regex is the ONLY path available —
// and it used to cover just "what inherits (from) X", never "what is a kind/
// sort/type of X" or "what is a subclass of X", so those phrasings hit a wrong
// "I don't know a relation or rule called 'kind'" answer (from a completely
// different, unrelated reader downstream) specifically on a session's first
// turn. Widened to match every phrasing ARTICLE_RELATION_CONTINUATIONS'
// grammar-level fix already handles when envelope.parsed IS available.
const WHAT_INHERITS_RE = /^what\s+(?:inherits?\s+(?:from\s+)?(?:an?\s+)?|is\s+(?:an?\s+)?(?:kind|sort|type)\s+of\s+|is\s+(?:an?\s+)?subclass\s+of\s+)(.+?)[?.!\s]*$/i;
/** WHAT_HAS_RE guard: "what has changed (recently)" reads as a temporal/code
 *  question, not a HasA lookup — checked against the captured phrase's FIRST
 *  word only (a closed set, not a general heuristic). Verified live: nothing
 *  today already answers this phrasing (it falls to an unrelated code-graph
 *  miss), so this is a pure safety guard, not a behavior change. */
const HAS_TEMPORAL_TAIL = new Set(["changed", "change", "changes", "updated", "modified", "happened", "occurred"]);

/** Local reproduction of ask.mjs's private `uniqueById` dedup idiom (not
 *  exported, so not importable across modules): collapse exact-repeat
 *  (subject,predicate,object) triples while keeping every DISTINCT subject —
 *  more than one subject can share the same object (e.g. car/bicycle/train
 *  all `mgx:hasA` wheel). */
function uniqueFacts(rows) {
  const seen = new Set();
  const out = [];
  for (const f of rows) {
    const key = `${f.subject}|${f.predicate}|${f.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** W4 seam: answer (or extend) a vocabulary/definition question from the MEMORY
 *  graph's Facts. Returns { text, replace } — `replace:false` means the engine's
 *  own (schema-docs) answer stands and the fact lines are appended under it —
 *  or null when memory holds nothing relevant (misses stay unchanged). */
async function factAnswer(memoryDir, query, envelope, miss, biasByBundle = {}) {
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const q = String(query).trim();

  // (a) meta-shaped questions ("what is a module", "what does cache mean") — the
  // parsed object term, matched against fact SUBJECTS; consulted for hits (append
  // alongside the schema-docs answer) and misses (facts answer alone) alike.
  // When the engine produced NO parse at all (the empty-bootstrap graph
  // short-circuits before parsing), the meta FORM is recognized directly on a
  // miss — via BARE_WHATIS_RE (chat.mjs's own fact-lookup discipline, article
  // OPTIONAL — see that regex's docblock for why this is safe to loosen here
  // even though the structural grammar's T5 keeps the article mandatory).
  let metaTerm = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
  // Exclude "what is a kind/sort/type of X" / "what is a subclass of X" from this
  // bare catch-all: on the FIRST turn of a graph-less session, dispatchTool's
  // loadGraph() throws its own documented empty-graph ToolError (a pre-existing,
  // by-design bootstrap behavior — self-corrects from turn 2 on), which leaves
  // `envelope` null for the rest of the turn, arming this `!envelope?.parsed`
  // fallback. Without this guard it greedily swallows the WHOLE "kind of animal"
  // tail as a literal meta-term to define (mirroring grammar.mjs T5's OWN
  // ARTICLE_RELATION_CONTINUATIONS guard against the identical over-capture),
  // returning early and never letting (b5) below — which already handles this
  // exact shape via WHAT_INHERITS_RE, envelope or no envelope — get a chance.
  if (!metaTerm && miss && !envelope?.parsed && !WHAT_INHERITS_RE.test(q)) {
    const m = q.match(BARE_WHATIS_RE)
      || q.match(/^what\s+(?:does|do)\s+(.+?)\s+means?[?.!\s]*$/i);
    // Seonix Batch 2 Fix 3: strip a curated trailing scope clause ("… in this
    // graph"/"… in this codebase"/…) the same way grammar.mjs's T5 and
    // metaTermOf do — BARE_WHATIS_RE's capture is otherwise the literal glued
    // tail, verbatim.
    if (m) metaTerm = stripTrailingScopeFiller(m[1]);
  }
  if (metaTerm) {
    // BUG 1 fix: "what is a tree used for" parses (grammar.mjs T5) to the
    // WHOLE tail "tree used for" as one literal term — split off a trailing
    // FACT_PREDICATE_PHRASES marker (if any) so the real subject ("tree") is
    // matched against fact subjects, and — the actual bug — the result is
    // FILTERED to just that one predicate (mgx:usedFor) instead of every
    // relation about the subject undifferentiated.
    const { subject, predicate } = splitMetaPredicate(metaTerm);
    const variants = factTermVariants(normFactTerm, subject);
    // factRows (trust+sourceIds-bearing), not the plain memoryFacts shape — the
    // bias-weighted ranking below needs each hit's sourceIds to resolve which
    // bundle it came from (memory/bias.mjs's biasForRow).
    const subjectHits = (await factRows(memoryDir)).filter((f) => variants.has(f.subject));
    let hits = predicate ? subjectHits.filter((f) => f.predicate === predicate) : subjectHits;
    if (!hits.length) {
      // The subject itself is known, but not under this specific relation —
      // an honest, specific "no" rather than falling through to the generic
      // "isn't a term in this graph's own vocabulary" wall (which would be
      // actively misleading here: the subject IS a known term).
      if (predicate && subjectHits.length) {
        return {
          text: `I don't have any "${FACT_PREDICATE_PHRASES[predicate]}" facts about ${subject}.`,
          replace: miss,
        };
      }
      return null;
    }
    // Bias only REORDERS — every hit still renders and is cited (Part 6's
    // "disclosed, never dropped" contract). Unconfigured/tied bias degrades to
    // trust-desc, byte-identical to before this feature existed.
    hits = rankByBiasThenTrust(hits, biasByBundle);
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

  // (b2) "can a dog bark" — yes iff a remembered mgx:capableOf fact says so.
  // Mirrors the ISA_ASK_RE block just above almost verbatim (same memoryFacts
  // single-hit lookup, same "never a guessed no" discipline).
  const can = q.match(CAN_ASK_RE);
  if (can) {
    const subj = factTermVariants(normFactTerm, can[1]);
    const obj = factTermVariants(normFactTerm, can[2]);
    const hit = (await memoryFacts(memoryDir)).find(
      (f) => f.predicate === "mgx:capableOf" && subj.has(f.subject) && obj.has(f.object),
    );
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    return null;
  }

  // (b3) "what can a dog do" — every remembered mgx:capableOf fact for the
  // subject, open-list. Reuses the meta-lane's subject-hits/rank/render/
  // paginate recipe (lane (a) above) verbatim, with the predicate hardcoded.
  const canDo = q.match(WHAT_CAN_DO_RE);
  if (canDo) {
    const variants = factTermVariants(normFactTerm, canDo[1]);
    const hits = (await factRows(memoryDir)).filter((f) => f.predicate === "mgx:capableOf" && variants.has(f.subject));
    if (!hits.length) return null;
    const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
    const lines = ranked.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
  }

  // (b4) "what has a wheel" — the REVERSE-by-OBJECT mirror of every other
  // reader in this cascade: filters factRows on mgx:hasA where the OBJECT
  // (not subject) matches, so every subject sharing that object surfaces
  // (e.g. car/bicycle/train all "have" a wheel). Guarded against shadowing
  // "what has changed(recently)"-shaped inputs, which read as a temporal/
  // code question, not a HasA lookup — see HAS_TEMPORAL_TAIL's own docblock.
  const hasQ = q.match(WHAT_HAS_RE);
  if (hasQ && !HAS_TEMPORAL_TAIL.has(hasQ[1].trim().split(/\s+/)[0]?.toLowerCase())) {
    const variants = factTermVariants(normFactTerm, hasQ[1]);
    const hits = (await factRows(memoryDir)).filter((f) => f.predicate === "mgx:hasA" && variants.has(f.object));
    if (!hits.length) return null;
    const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
    const lines = ranked.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
  }
  // hasQ matched but shadowed a temporal-tail phrase ("what has changed…") —
  // deliberately falls through to the next reader below (never returns here),
  // leaving whatever already handles that phrasing today untouched.

  // (b5) "what inherits from horse" — the reverse-by-object mirror of (b4),
  // over the ISA-family predicates instead of mgx:hasA. No temporal-style
  // guard needed: "inherits" has no competing common-English reading.
  //
  // "what is a kind of X" / "what is a subclass of X" (2026-07-11 follow-up,
  // live-repro: "boney is a dog" -> "what is a dog" -> "what is a kind of
  // animal" hit a wrong "I don't know a relation or rule called 'kind'"
  // answer). Fixing the parse-level {ambiguousParse} tie between this and a
  // spurious "meta" reading (grammar.mjs T5, ARTICLE_RELATION_CONTINUATIONS)
  // means `envelope.parsed` now cleanly carries {shape:"reverse",
  // kind:"inherits", object:"animal"} for this phrasing too — but WHAT_INHERITS_RE
  // is a FIXED regex ("what inherits (from) X") that never matched it, so this
  // block used to fall through to null and let factReadBack's RELATION_WHO_ASK_RE
  // misread "kind"/"subclass" as a relation NAME instead. Reading the ALREADY-
  // PARSED envelope directly (any phrasing the grammar recognizes as this exact
  // shape, not just WHAT_INHERITS_RE's one hardcoded surface form) fixes this
  // generally; the regex match is kept as a fallback for a parse the envelope
  // doesn't carry (e.g. no envelope at all).
  const inheritsQ = q.match(WHAT_INHERITS_RE);
  const inheritsObj = (envelope?.parsed?.shape === "reverse" && envelope.parsed.kind === "inherits")
    ? envelope.parsed.object
    : inheritsQ?.[1];
  if (inheritsObj) {
    const variants = factTermVariants(normFactTerm, inheritsObj);
    const hits = (await factRows(memoryDir)).filter((f) => ISA_PREDICATES.has(f.predicate) && variants.has(f.object));
    // Only diverts on a REAL hit — same discipline every other reader in this
    // cascade follows (CAN_ASK_RE/WHAT_CAN_DO_RE/WHAT_HAS_RE above all `return
    // null` on zero hits too). A zero-hit case here must NOT invent its own
    // override text: whatever answer already stands (a code-graph-specific miss
    // from ask.mjs's own traversal, a glossary/relation-force explanation, or the
    // generic wall) is left alone. The real fix for the "I don't know a relation
    // or rule called 'kind' yet" false claim (Live-caught 2026-07-11 follow-up to
    // the "what is a kind of X" ambiguousParse fix, commit 5c858bf) lives at
    // RELATION_WHO_ASK_RE's own handler in factReadBack, below — it excludes ISA-
    // idiom words ("kind"/"sort"/"type"/"subclass"/"superclass") from being
    // treated as arbitrary unknown relation NAMES, since they're not names a user
    // could have taught a relation under; they're this file's own vocabulary for
    // the inherits relation, always "known" by construction.
    if (!hits.length) return null;
    const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
    const lines = ranked.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
  }

  // (c) "what do you know about caches" — everything remembered that MENTIONS the
  // term (subject or object), capped.
  const know = q.match(KNOW_ABOUT_RE);
  if (know) {
    const variants = factTermVariants(normFactTerm, know[1]);
    const rows = await factRows(memoryDir);
    // Bug E subtype walk (operator follow-up request, this session): a
    // cycle-safe BFS DOWNWARD over isa-family facts from the term's own
    // variants — every fact whose OBJECT is in the current frontier
    // contributes its SUBJECT as a known SUBTYPE (and the next hop's
    // frontier), so "every widget is a component" + "button is a widget" +
    // "button has a blue-color" lets "what do you know about component"
    // surface the button fact too, even though "button" never literally
    // mentions "component". Capped at 8 hops — this is a listing operation,
    // not findIsaChain's strict maxHops:2 proof-chase, but still bounded as a
    // safety net against pathological data.
    //
    // The chain itself is walked over TAUGHT isa facts only (same "isTaught"
    // discipline the live cax-sco/scm-sco proof chase already uses, below) —
    // the bulk background corpus (thousands of ConceptNet/seon "is a kind of"
    // rows) would otherwise chain almost ANY term into hundreds of coincidental
    // "subtypes" that have nothing to do with what the OPERATOR actually
    // taught, drowning the real answer and defeating the negative-case
    // discipline this feature exists to preserve. The literal-mention hits
    // (the ORIGINAL, non-subtype half of the filter below) still include
    // corpus facts exactly as before — only the SUBTYPE DISCOVERY chain is
    // taught-only.
    // `rows` here is factRows()'s trust+sourceIds-bearing shape (Part 6: the
    // bias-weighted ranking below needs sourceIds) — it still carries the SAME
    // `provenance` legacy-compat string the taught/corpus distinction below
    // reads, the SAME convention renderFactLine keys its own corpus-vs-taught
    // framing on, just above.
    const isTaughtFact = (f) => !String(f.provenance || "").includes("corpus:") && !String(f.provenance || "").includes("web:");
    const isaRows = rows.filter((f) => ISA_PREDICATES.has(f.predicate) && isTaughtFact(f));
    const subtypeSubjects = new Set();
    let frontier = variants;
    for (let hop = 0; hop < 8 && frontier.size; hop += 1) {
      const nextSubjects = new Set();
      for (const f of isaRows) {
        if (frontier.has(f.object) && !subtypeSubjects.has(f.subject)) nextSubjects.add(f.subject);
      }
      if (!nextSubjects.size) break;
      for (const s of nextSubjects) subtypeSubjects.add(s);
      const nextFrontier = new Set();
      for (const s of nextSubjects) for (const v of factTermVariants(normFactTerm, s)) nextFrontier.add(v);
      frontier = nextFrontier;
    }
    let hits = rows.filter((f) => variants.has(f.subject) || variants.has(f.object) || subtypeSubjects.has(f.subject));
    // Tier-5 playtest fallback: a taught fact's subject is often a real NOUN
    // PHRASE ("logger module", "tasks handler"), but a natural follow-up
    // shortens it to one head word ("what do you know about the logger") —
    // an exact-variant miss above, since "logger" !== "logger module". Only
    // tried when the exact/subtype pass found NOTHING (never overrides a real
    // hit), and only on a whole WORD (length >= 4, the same floor
    // resolveObject's own tier-3/5 containment checks use to keep a short
    // staccato word from hijacking an unrelated fact) shared between the
    // query term and a fact's subject/object — a listing/discovery feature
    // (like the subtype walk above), not a yes/no claim, so a slightly wider
    // recall net is consistent with this lane's existing inclusiveness.
    if (!hits.length) {
      const queryWords = normFactTerm(know[1]).split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_ENTITY_WORDS.has(w));
      if (queryWords.length) {
        const wordsOf = (s) => new Set(String(s || "").split(/\s+/));
        const overlaps = (term) => { const w = wordsOf(term); return queryWords.some((qw) => w.has(qw)); };
        hits = rows.filter((f) => overlaps(f.subject) || overlaps(f.object));
      }
    }
    // A genuinely empty result here is a real miss (Tier-5 playtest cycle 3:
    // "what do you know about the last commit" needs a TEACH-OFFER, not a
    // bare wall — added as a LATE runTurn-level addition, below, alongside
    // the sibling "what is X" offer, rather than returned from here: an
    // early return through this function's normal contract would pre-empt
    // runTurn's own wall-shortening pass (shortMissHint/lane 5), leaving the
    // FULL unshortened grammar cheat-sheet standing under the offer instead
    // of the nicer tailored one-liner — found live while adding this fix).
    if (!hits.length) return null;
    // LIVE CONSISTENCY CHECK (PLAN_INFERENCE_TESTING.md INF-C2, §4 stage 5):
    // before answering from this subject's memory, check whether its OWN
    // taught/entailed types contradict each other (x rdf:type C1, x rdf:type
    // C2, C1 owl:disjointWith C2, lifted through both types' ⊑-ancestor
    // closures) via syllogise.mjs's findConsistencyViolations, LIVE and
    // READ-ONLY — same discipline as the cax-dw chase in the isaAsk block
    // above. A hit REFUSES the whole answer (every belief about a
    // contradictory subject is suspect, not just the clashing pair) rather
    // than silently answering from a memory that's already inconsistent.
    const { findConsistencyViolations, TYPE_PREDICATE: CONS_TYPE_PREDICATE, SUBCLASS_PREDICATE: CONS_SC_PREDICATE, DISJOINT_PREDICATE: CONS_DISJOINT_PREDICATE } = await import("./syllogise.mjs");
    const consIsTaught = (f) => !f.provenance?.includes("corpus:") && !f.provenance?.includes("web:");
    const consTypeEdges = rows.filter((f) => f.predicate === CONS_TYPE_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
    const consSubClassEdges = rows.filter((f) => f.predicate === CONS_SC_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
    const consDisjointEdges = rows.filter((f) => f.predicate === CONS_DISJOINT_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
    if (consDisjointEdges.length) {
      const clashes = findConsistencyViolations(consTypeEdges, consSubClassEdges, consDisjointEdges, { focus: variants, budget: 5 });
      const clash = clashes.find((c) => variants.has(c.subject));
      if (clash) {
        return {
          text: `I can't answer that — what I've been told about ${clash.subject} is inconsistent: it's taught to be both `
            + `${clash.classA} and ${clash.classB}, but ${clash.viaA} and ${clash.viaB} are disjoint (${clash.viaA} owl:disjointWith `
            + `${clash.viaB}). I'd need one of those retracted before I can answer honestly.`,
          replace: true,
        };
      }
    }
    // echo the STORED spelling ("caches" asked → "cache" known), never a guess
    const literalHit = hits.find((f) => variants.has(f.subject) || variants.has(f.object));
    const term = literalHit
      ? (variants.has(literalHit.subject) ? literalHit.subject : literalHit.object)
      : know[1].trim();
    // when a subtype-derived hit contributed something a plain literal-mention
    // match wouldn't have found, say so — lets the reader tell subtype-derived
    // facts apart from literal mentions.
    const viaSubtype = hits.some((f) => subtypeSubjects.has(f.subject) && !variants.has(f.subject) && !variants.has(f.object));
    // Bias only REORDERS, right before render/cite — every hit above still
    // renders (Part 6's "disclosed, never dropped" contract); literalHit/
    // viaSubtype above already resolved off the pre-rank order.
    hits = rankByBiasThenTrust(hits, biasByBundle);
    const lines = hits.map((f) => `  ${renderFactLine(f)}`);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n  …and ${rest.length} more — say 'more' to see them.` : "";
    const header = `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}`
      + `${viaSubtype ? " (including its known subtypes)" : ""}:`;
    return { text: `${header}\n${shown.join("\n")}${extra}`, replace: true, ...(rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {}) };
  }
  return null;
}

// ---- BUG 1 fix (2026-07-09): "what else is X" repeated the SAME primary
// definition sentence verbatim, byte-identical to a plain "what is X" turn
// right before it. Root cause: "what else is a function" is NOT itself a
// recognized shape anywhere in this file — ask()'s own relaxation cascade
// (relaxParse, ask.mjs: NOISE-STRIP then DROP-UNMATCHED) quietly treats
// "else" as an unmatched leftover token once the anchored grammar misses the
// sentence as typed, drops it, and re-parses the survivor as the ORDINARY
// "what is a function" meta shape — a real, non-miss answer, so relaxParse
// happily accepts it. By the time curatedDefinitionAnswer/factAnswer see the
// query, "else" is already gone and there is nothing left to distinguish a
// follow-up asking for MORE from the original question. whatElseAnswer is
// recognized FIRST, off the RAW query text (never the relaxed envelope), so
// it always gets first look regardless of what the ask engine's own parse
// collapsed the sentence to. ----

/** "what else is/are X" / "what else about X" / "what else do you know about
 *  X" — the follow-up shape asking for information BEYOND whatever the
 *  primary answer already said. Two separate anchors (not one alternation)
 *  because the "is/are" copula form and the "about" form take the article
 *  differently ("what else is a function" vs "what else about the cache").
 *  The negative lookahead on the "is/are" form excludes "what else is
 *  in/inside X" — that's a DIFFERENT, already-working feature (normalize.mjs
 *  PHRASING_FRAMES rewrites it to "what does X contain", a members-of-class
 *  query, tested by chatflow-tier1-single-touch.test.mjs); without this
 *  exclusion this lane's own raw-text-first priority (it runs BEFORE ask()'s
 *  pipeline even gets a look) would wrongly swallow that idiom as a
 *  vocabulary-term lookup for the literal term "in X". */
const WHAT_ELSE_IS_RE = /^what\s+else\s+(?:is|are)\s+(?!in\b|inside\b)(?:an?\s+)?(.+?)[?.!\s]*$/i;
const WHAT_ELSE_ABOUT_RE = /^what\s+else\s+(?:do\s+you\s+know\s+)?about\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i;

/** "what else is X" — surface remembered facts about X BEYOND the primary
 *  curated (corpus/seon) prose definition, which is itself never a Facts row
 *  (it comes from a separate prose file, seonDefinitions() — see
 *  curatedDefinitionAnswer) — so every subject-side fact this returns is
 *  genuinely additional information, never a repeat of the definition
 *  sentence. Reuses factAnswer's own subject-scan machinery (memoryFacts +
 *  factTermVariants + renderFactLine + the SAME FACT_ANSWER_CAP/'more'-paging
 *  convention as factAnswer/factReadBack), just filtered/framed differently.
 *
 *  Honest "nothing more" fallback (never a spurious repeat) in TWO cases: (a)
 *  the term carries no facts at all — there is nothing to add beyond the
 *  definition; (b) every fact line this would show ALREADY appears verbatim
 *  in the immediately-preceding turn's answer (`last.answer`) — meaning the
 *  primary answer was itself an exhaustive fact listing (via:"fact", not a
 *  curated prose definition), so "what else" truly has nothing new to say.
 *  That second check reuses this codebase's own established repeat-detection
 *  discipline (comparing rendered lines against `last.answer` bytes — see
 *  ORIENTATION_REPEAT_ONELINER/WALL_REPEAT_ONELINER for the same pattern). */
async function whatElseAnswer(memoryDir, query, last) {
  if (!memoryDir) return null;
  const q = String(query).trim();
  const m = q.match(WHAT_ELSE_IS_RE) || q.match(WHAT_ELSE_ABOUT_RE);
  if (!m) return null;
  const term = m[1].trim();
  if (!term) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const variants = factTermVariants(normFactTerm, term);
  const hits = (await memoryFacts(memoryDir)).filter((f) => variants.has(f.subject));
  const picture = pickPhrase("full-picture", term.toLowerCase(), "the full picture");
  const nothingMore = {
    text: `That's everything I know about "${term}" — /memory to see ${picture}.`,
    replace: true,
  };
  if (!hits.length) return nothingMore;
  const lines = hits.map(renderFactLine);
  const prevAnswer = String(last?.answer || "");
  if (lines.every((l) => prevAnswer.includes(l))) return nothingMore;
  const shown = lines.slice(0, FACT_ANSWER_CAP);
  const rest = lines.slice(FACT_ANSWER_CAP);
  const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
  const lead = pickPhrase("beyond-that-lead", term.toLowerCase(), "Beyond that,");
  return {
    text: `${lead} here's what else I know about "${term}":\n${shown.join("\n")}${extra}`,
    replace: true,
    ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}),
  };
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
/** "does every <N1> have at least <m> <N2>" — cardinality monotonicity
 *  (PLAN_INFERENCE_TESTING.md INF-C1, this build): a class's OWN declared
 *  exactly/min cardinality restriction proves "at least m" for any queried
 *  m <= n (src/syllogise.mjs's proveCardinalityAtLeast). */
const CARD_AT_LEAST_ASK_RE = /^does\s+every\s+(.+?)\s+have\s+at\s+least\s+(\d+)\s+(.+?)[?.!\s]*$/i;
/** "does a/an <N1> have a/an <N2>" — cax-maxc0 (this build): a declared
 *  max-cardinality-0 restriction proves the class-level "no" directly
 *  (src/syllogise.mjs's proveMaxCardinalityZeroDenial). Both readers FALL
 *  THROUGH ON A MISS (no unconditional decline, unlike isaAsk's own closing
 *  `return null`): "does SUBJ have OBJ" is broad enough to otherwise collide
 *  with GENERAL_VERB_YESNO_RE below and a pre-existing "3 unclear max0 cases"
 *  quirk (HANDOVER.md) — a miss here simply lets the query continue to
 *  whatever would have handled it before this build existed. */
const CARD_EXISTENCE_ASK_RE = /^does\s+an?\s+(.+?)\s+have\s+an?\s+(.+?)[?.!\s]*$/i;
/** The 4 pattern-5 cardinality-restriction predicates buildCardinalityRestrictions
 *  reconstructs from — owl:onProperty (shared scaffolding with someValuesFrom
 *  restrictions too) is added alongside this set by each reader below, not
 *  folded into it here, mirroring infbench/grade.mjs's own identically-named
 *  set + separate owl:onProperty handling. */
const CARDINALITY_ROW_PREDICATES = new Set(["owl:cardinality", "owl:minCardinality", "owl:maxCardinality", "owl:onClass"]);
/** "who owns <X>" / "who maintains <X>" — the closed ownership read-back over
 *  the teach lane's mgx:ownedBy facts. */
const WHO_OWNS_RE = /^who\s+(?:owns|maintains)\s+(.+?)[?.!\s]*$/i;
/** "does/did <Name> own/maintain <X>" — the yes/no ownership claim over the
 *  SAME mgx:ownedBy facts WHO_OWNS_RE reads (Tier-5 playtest fix). The bare
 *  infinitive after do-support ("does X own Y", never "does X owns Y") mirrors
 *  GENERAL_VERB_YESNO_RE's own do-support convention. */
const OWNS_YESNO_RE = /^(?:does|did)\s+([\w'-]+)\s+(?:owns?|maintains?)\s+(.+?)[?.!\s]*$/i;
/** "is/are/was/were <X> owned by <Name>" — the PASSIVE yes/no ownership
 *  claim, sibling of OWNS_YESNO_RE just above and OWNS_PASSIVE_TEACH_RE
 *  (chat.mjs's teach lane) — same mgx:ownedBy facts, matched BEFORE
 *  IS_ADJECTIVE_YESNO_RE below (which would otherwise also match this shape,
 *  backtracking "owned by" into its own subject capture and "<Name>" into its
 *  adjective slot, silently declining rather than answering). */
const OWNS_PASSIVE_YESNO_RE = /^(?:is|are|was|were)\s+(.+?)\s+owned\s+by\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;
/** "does/did <N1> have a/an <N2> method" — the HAS-A-METHOD yes/no reader
 *  (HANDOVER.md 2026-07-10 item 9), sibling of OWNS_YESNO_RE above: mirrors
 *  TEACH_HAS_METHOD_RE's own subject/capability shape, answering a direct
 *  yes/no claim against a fact taught via that pattern (mgx:hasA, object
 *  `"<capability> method"`).
 *
 *  NOTE — a real, pre-existing structural collision, confirmed live before
 *  wiring this: ask.mjs's OWN structural grammar already maps "has"/"have"
 *  onto the code-graph "defines" relation (ask-vocab.mjs's VERB_TO_KIND), so
 *  when a real code graph is loaded this EXACT phrasing is parsed there
 *  FIRST — and because "a <word> method" is separately ambiguous with a
 *  QUALIFIER reading there ("a public method"), ask.mjs resolves with its own
 *  (possibly confusing) disambiguation choice, `miss: false`, before this
 *  reader (factReadBack, gated on `miss` already being true) ever gets a
 *  turn. Verified live: with a populated code graph, "does Component have a
 *  render method" always lands on ask.mjs's disambiguation prompt, regardless
 *  of subject/object identity or any taught fact; with NO code graph loaded
 *  (this project's other supported mode — a purely conceptual teach-and-
 *  recall session, see PLAN_TAUGHT_RELATIONS.md's own CONFIG={} test
 *  convention) ask.mjs's structural attempt declines outright and this reader
 *  answers correctly. Changing ask.mjs's own qualifier-disambiguation
 *  behavior is a pre-existing, unrelated structural-grammar concern — out of
 *  scope for this item.
 *
 *  Same "never a guessed no" discipline as IS_ADJECTIVE_YESNO_RE/
 *  GENERAL_VERB_YESNO_RE below (not OWNS_YESNO_RE's closed-world "no" text):
 *  a hit answers "yes"; no matching fact DECLINES (null), since "nothing
 *  taught yet" is not proof the class genuinely lacks the method. */
const HAS_METHOD_YESNO_RE = /^(?:does|did)\s+([\w'-]+)\s+(?:has|have)\s+an?\s+([a-z][\w-]*)\s+method[?.!\s]*$/i;
/** "what methods does <N1> have" — the HAS-A-METHOD open-list reader
 *  (HANDOVER.md 2026-07-10 item 9): the read-back companion to
 *  HAS_METHOD_YESNO_RE just above — lists every taught mgx:hasA fact for
 *  <N1> whose object is a "<word> method" phrase. A distinct query shape
 *  (object noun right after "what", not after the subject), so it does NOT
 *  share HAS_METHOD_YESNO_RE's own ask.mjs collision: "what methods does X
 *  have" already reaches an honest `miss: true` from ask.mjs even against a
 *  populated code graph (confirmed live — "no module matching X found in the
 *  index" when X isn't a real graph entity), so this reader is reachable in
 *  both configurations. */
const HAS_METHOD_OPEN_RE = /^what\s+methods\s+does\s+([\w'-]+)\s+have[?.!\s]*$/i;
/** "is/are/was/were <X> <adjective>" — a yes/no claim over a taught
 *  mgx:hasProperty fact (Tier-5 playtest fix). Deliberately has NO marker
 *  between subject and complement — "a"/"an"/"a kind of"/"a type of" is
 *  ISA_ASK_RE's own mandatory territory just below (matched and handled, or
 *  matched-and-declined, BEFORE this code ever runs), so a genuine "is a
 *  module a component" is never reachable here. Anaphoric "it"/"this"/"that"
 *  resolves against the session's current FOCUS (threaded in as `focusLabel`)
 *  — never a guess when there's no standing focus. Only ever answers "yes"
 *  (a real fact found) or DECLINES (null) — never a fabricated closed-world
 *  "no", unlike its ownership/general-verb siblings above: a bare copula
 *  ("is this good", "is it done") is the single most common CASUAL English
 *  shape, so a wrong-feeling "no — no remembered fact says X is Y" for
 *  ordinary small talk would be worse than deferring to the ordinary
 *  cascade/orientation nudge that already handles it. */
const IS_ADJECTIVE_YESNO_RE = /^(?:is|are|was|were)\s+(.+?)\s+([A-Za-z][\w-]*)[?.!\s]*$/i;
const IS_ADJECTIVE_PRONOUN_RE = /^(?:it|this|that)$/i;
/** The TEACH-OFFER for a subject IS_ADJECTIVE_YESNO_RE resolved but has no
 *  fact about at all (Tier-5 playtest, cycle 2) — the offered "remember that
 *  X is Y" phrasing is verified in-state: TEACH_PROPERTY_RE's own subject
 *  capture is unbounded multi-word with no lexicon gate on the complement, so
 *  this always actually stores, unlike the bare unwrapped form (which only
 *  reaches TEACH_PROPERTY_RE via BARE_DECLARATIVE_RE's single-token-subject
 *  restriction and would fail here). */
const unknownAdjectiveOffer = (subject, adjective) => ({
  text: `I don't know anything about "${subject}" yet — teach me directly, e.g. "remember that ${subject.toLowerCase()} is ${adjective}".`,
  replace: true,
});
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
async function factReadBack(memoryDir, query, envelope, miss, graph = null, focusLabel = null, biasByBundle = {}) {
  if (!miss) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const q = String(query).trim();
  // DIRECT STRUCTURAL CHECK (playtest sprint round 2, this session): "is X a Y"
  // naming a real code-graph inheritance edge needs NO taught fact at all — the
  // graph's own `inherits` relation already proves it. Checked here, BEFORE the
  // `rows.length` bail-out just below, because a pristine graph with ZERO taught
  // facts returns null from that bail-out and never reaches ISA_ASK_RE's own
  // taught-fact-only checks further down in this function at all. Found live:
  // "is TaskController a Controller" (a direct one-hop inherits edge) and "is
  // Task a Record" both hit the raw grammar wall on a freshly loaded graph with
  // nothing taught yet — even in the wall's OWN suggested phrasing ("is a
  // <thing> a <kind>"), and even though "what does Task inherit from" answers
  // "Record" via the exact same relation. Cheapest and most certain check
  // available: purely the graph's own relations, no memory/rows dependency,
  // never a guess.
  if (graph) {
    const directIsaAsk = q.match(ISA_ASK_RE);
    if (directIsaAsk) {
      const ent = await resolveEntity(graph, directIsaAsk[1]);
      if (ent) {
        const directObjVariants = factTermVariants(normFactTerm, stripTrailingDiscourseTag(directIsaAsk[2]));
        const directSup = inheritsChain(graph, ent.id)
          .find((sup) => [...factTermVariants(normFactTerm, sup.label)].some((v) => directObjVariants.has(v)));
        if (directSup) return { text: `yes — the code graph says ${ent.label} inherits ${directSup.label}.`, replace: true };
      }
    }
  }
  // Tier-5 playtest fix (cycle 4), found live: "actually is the store module
  // fragile" WALLED — a leading hedge adverb ("actually"/"really"/"honestly",
  // optionally comma'd) put the sentence one word out of alignment with
  // IS_ADJECTIVE_YESNO_RE/OWNS_YESNO_RE/OWNS_PASSIVE_YESNO_RE's own anchored
  // "is|are|was|were|does|did" openers — this session's own three new yes/no
  // readers, so scoped narrowly to just them (qHedge), not the older
  // ISA_ASK_RE/WHO_OWNS_RE paths above, which already work without it and
  // don't need the extra risk of a behavior change. Full leading-connective
  // tolerance (and/also/so/…) is STACCATO_LEAKED_CONNECTIVES' own separate,
  // broader territory elsewhere in this file — this is a narrower, adjacent
  // closed set (hedge adverbs, not coordinators).
  // "yeah nah" (Tier 6 playtest, §3b dialect axis): the same AU/NZ discourse
  // opener chat.mjs's own GREET closed set and GREETING_PREAMBLE_RE already
  // recognize elsewhere, added here too — "yeah nah, is TaskController
  // fragile" is the SAME one-word-out-of-alignment problem the hedge adverbs
  // above were fixed for, just a dialect opener instead of a hedge adverb.
  const qHedge = q.replace(/^(?:actually|really|honestly|yeah\s+nah)\s*,?\s+/i, "");
  const rows = await factRows(memoryDir);
  if (!rows.length) {
    // Tier-5 playtest fix (cycle 2), found live: with TRULY zero facts
    // remembered yet (a fresh session, nothing taught at all), the early
    // bail-out below skipped even IS_ADJECTIVE_YESNO_RE's own "subject
    // completely unknown" TEACH-OFFER further down in this function — "is
    // the checkout flow deprecated" as someone's genuinely FIRST question
    // fell to the raw structural wall, unguided. Special-cased here (ahead
    // of the general empty-memory bail-out every other lane in this function
    // still relies on) rather than removing the bail-out outright.
    //
    // IS_ADJECTIVE_YESNO_RE's own backtracking (no vocabulary restriction on
    // either capture) means it ALSO syntactically matches shapes that are
    // NOT a property claim at all — "is a zebra a mammal" (ISA_ASK_RE's own
    // territory, tried first in the non-empty-rows path below, so never
    // reached here) and "is there anything bigger" (an existence/staccato-
    // comparative shape a LATER lane elsewhere in runTurn owns and answers
    // better than a teach-offer ever could) both regressed real, pinned
    // tests on first attempt at this fix — caught by running the full suite,
    // not just the live playtest transcript. Excluded explicitly: ISA_ASK_RE
    // matches take the SAME priority here they get in the non-empty-rows
    // path below, and a leading "there" is existential, never a real named
    // subject a property claim would name. RELATION_FACT_YESNO_RE (Phase 2/4)
    // gets the SAME exclusion for the SAME reason — "is ahab a parent of
    // john" with truly zero facts remembered is an honest miss on the
    // relational reader below, never a bogus adjective teach-offer here.
    if (!ISA_ASK_RE.test(qHedge) && !RELATION_FACT_YESNO_RE.test(qHedge)) {
      const emptyIsAdj = qHedge.match(IS_ADJECTIVE_YESNO_RE);
      if (emptyIsAdj) {
        const rawSubject = emptyIsAdj[1].trim();
        const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? (focusLabel || null) : rawSubject;
        // Tier 6 playtest: "is logger tested"/"is the store module tested" —
        // IS_ADJECTIVE_YESNO_RE's own unrestricted backtracking (already flagged
        // as a recurring risk, see this branch's own docblock above for the
        // ISA_ASK_RE/"is there" exclusions found the SAME way) ALSO matches
        // "tested" as if it were a free-form property adjective — but "tested"/
        // "covered"/"untested"/"uncovered" are REAL structural relation words
        // (PASSIVE_PARTICIPLE_TO_KIND/QUALIFIERS, ask-vocab.mjs) with an actual
        // graph-computable meaning ask()'s own grammar already resolved
        // (envelope.parsed stands — a genuine "tests" reverse-relation
        // traversal, hit or honest empty). Offering "I don't know that yet —
        // teach me" here would silently DISCARD a real, honest structural
        // answer in favor of an irrelevant memory teach-offer — the opposite
        // failure from every other exclusion in this function (a wrong
        // OVER-eager offer, not a missed one). Declines only when a real parse
        // already stood; "is the checkout flow deprecated" (this branch's own
        // ORIGINAL T8 target — "deprecated" has no structural meaning at all)
        // has no envelope.parsed to defer to, so it is untouched.
        if (subject && !/^there\b/i.test(subject) && !envelope?.parsed) {
          return unknownAdjectiveOffer(subject, emptyIsAdj[2].trim().toLowerCase());
        }
      }
    }
    return null;
  }
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
    // Part 6: bias-then-trust — every hit still renders (renderMany caps for
    // display, never drops), just reordered; unconfigured bias degrades to the
    // same trust-desc order this always used.
    const hits = rankByBiasThenTrust(isa.length ? isa : rows, biasByBundle);
    if (!hits.length) return null;
    return renderMany(hits);
  }

  // (a0) RELATIONAL FACT / ALIAS-CHASE / RULE-CHASE yes/no — "is/are/was/
  // were <X> the/a/an <role> of <Y>" (PLAN_TAUGHT_RELATIONS.md Phase 2 item
  // 1's own query-side gap + item 2's alias chase + Phase 4 item 3's
  // hop-counted compose2 chase + Phase 5 item 4's property-filtered chase,
  // all dispatched from ONE recognizer, tried BEFORE ISA_ASK_RE gets a
  // chance at this shape — see RELATION_FACT_YESNO_RE's own docblock for why
  // placement, not regex disjointness, keeps this ahead of ISA_ASK_RE). The
  // actual dispatch lives in resolveRelationChase, below (a recursive
  // closure, not four independent branches):
  //   (i)  DIRECT — a fact already taught under the queried role word exactly
  //        ("is ahab the father of john" against a literal mgx:father fact —
  //        Phase 1's own live-found gap, closed here).
  //   (ii) ALIAS CHASE (item 2) — the SAME candidate list, widened: any fact
  //        connecting this exact (subject, object) pair whose OWN role word
  //        reaches the queried name via a TAUGHT rdfs:subClassOf chain over
  //        relation-NAME strings (findIsaChain, reused completely unmodified,
  //        maxHops:2, corpus-excluded — the identical isTaught discipline the
  //        cax-sco/scm-sco class-term proof chase below already uses, just
  //        walked over relation names instead of class names).
  //   (iii) COMPOSE2 RULE CHASE (Phase 4 item 3) — the queried name may itself
  //        be an already-taught Rule (findRuleByName), not a plain relation at
  //        all: a hop-counted findActionPath search over { entity, hopsTaken }
  //        states, dispatching base1's edges at hop 0 and base2's edges at hop
  //        1, requiring EXACTLY hopsTaken === 2 at the goal — never just
  //        entity === target at any depth (the load-bearing nuance: a
  //        coincidental 1-hop or 3-hop path through the SAME edge relation
  //        must NOT falsely satisfy a rule that must be exactly 2 hops).
  //   (iv) FILTER RULE CHASE (Phase 5 item 4) — the queried name may be a
  //        `filter`-kind Rule: recursively resolve its OWN base (step i/ii OR
  //        iii again, generic over which the base turns out to be — the same
  //        function calls itself), then require the SUBJECT also carry the
  //        taught property (mgx:hasProperty, a plain Fact lookup).
  // (i) and (ii) share one candidate list (relationFactsFor); (iii)/(iv) reuse
  // the SAME list-builder as their per-hop edge lookup, so all four steps
  // agree on what "a fact under relation X" means. No hit at any step → null,
  // the honest miss stands (never a guessed "no" — the same OWA discipline
  // every other yes/no reader in this function follows).
  const relAsk = qHedge.match(RELATION_FACT_YESNO_RE);
  if (relAsk) {
    const rawSubject = relAsk[1].trim();
    const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? (focusLabel || null) : rawSubject;
    const relationName = relAsk[2].trim().toLowerCase();
    const object = relAsk[3].trim();
    if (subject && !ISA_IDIOM_ROLE_WORDS.has(relationName)) {
      const isTaughtRow = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
      const aliasSubClassEdges = rows
        .filter((f) => f.predicate === SUBCLASS_PREDICATE && isTaughtRow(f))
        .map((f) => [f.subject, f.object]);
      const { findIsaChain: chaseAlias } = await import("./syllogise.mjs");
      // Shared alias-chase substrate (item 2): every stored Fact whose
      // predicate resolves — directly, or via a TAUGHT rdfs:subClassOf chain
      // over relation-NAME strings, never corpus noise — to `name`. Reused for
      // BOTH the direct/alias yes-no readback just below AND the compose2
      // hop-search's per-hop edge lookup further down, so the two never
      // disagree on what "a fact under relation X" means.
      const relationFactsFor = (name) => {
        const target = String(name || "").trim().toLowerCase();
        const out = [];
        for (const f of rows) {
          const role = relationRoleWord(f.predicate);
          if (!role) continue;
          if (role === target) { out.push({ fact: f, aliasFacts: [] }); continue; }
          const chain = chaseAlias(role, new Set([target]), [], aliasSubClassEdges, { maxHops: 2 });
          if (!chain) continue;
          const aliasFacts = chain.map((step) => rows.find(
            (r) => r.predicate === SUBCLASS_PREDICATE && r.subject === step.subject && r.object === step.object,
          ));
          if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
        }
        return out;
      };
      // Generic relation-NAME resolver (PLAN_TAUGHT_RELATIONS.md Phase 5's
      // own genericity requirement) — the SAME "what kind of thing is this
      // name" dispatch §3 designs, made explicitly RECURSIVE so a Rule's
      // own base can be EITHER a plain taught relation (terminal — steps
      // i/ii, direct fact or alias chase) OR ANOTHER Rule (compose2's
      // hop-counted chase, step iii; filter's own base-then-property chase,
      // Phase 5 item 4, step iv). Returns `{ citation: string[] }` on a
      // genuine hit, or null on an honest miss — never a guessed "no", the
      // same OWA discipline every other yes/no reader in this function
      // follows. Recursion is naturally bounded (§3.3): a filter rule's
      // base is always either a plain relation (case a, terminal) or
      // another rule (case b, one dispatch level deeper) — FILTER_RULE_TEACH_RE
      // never lets a rule name its OWN name as its own base, so no cycle
      // guard is needed at THIS dispatch level (the search kernels
      // underneath — findActionPath — carry their own `seen`-set safety
      // regardless).
      // Extracted to memory/core.mjs (PLAN_COMPLETIONS.md Stage 1
      // prerequisite: cross-group inference reuses this SAME resolution
      // logic outside chat.mjs's dispatch context) — findRuleByName's own
      // natural sibling there. `relationFactsFor`/`renderFactLine`/
      // `factPhrase`/`factTermVariants`/`byTrust`/`rows`/
      // `HAS_PROPERTY_PREDICATE` are this block's own local closures/
      // constants, threaded through explicitly rather than re-derived.
      const { loadMemory, findRuleByName, resolveRelationChase } = await import("./memory/core.mjs");
      const memory = await loadMemory(memoryDir);
      const relationChaseHelpers = { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE };
      const hit = await resolveRelationChase(memory, relationName, subject, object, relationChaseHelpers);
      if (hit) return { text: `yes — ${hit.citation.join("; ")}`, replace: true };
      // Gap 1 fix (live-tested 2026-07-09, PLAN_TAUGHT_RELATIONS.md follow-up):
      // this used to `return null` unconditionally on any miss here — the
      // SHAPE was already recognized (subject/relation/object all parsed
      // successfully), so an ordinary `null` fell all the way through
      // factReadBack's cascade to runTurn's GENERIC structural wall
      // ("couldn't parse this as a graph question…"), which doesn't even
      // mention the relation the user actually asked about. Distinguish two
      // real cases, both rendered HERE (never deferred to the generic wall):
      // (1) the relation/rule NAME itself was never taught at all — no fact
      // or alias reaches it under any spelling, AND no Rule is stored under
      // it either; (2) the name IS known, but THIS specific (subject,
      // object) pair's chase came up short (e.g. a 2-hop rule with only 1
      // hop of facts taught, or an unrelated pair) — an honest, specific
      // decline that NAMES the relation, never a guessed "no".
      const nameKnown = relationFactsFor(relationName).length > 0
        || !!findRuleByName(memory, relationName);
      if (!nameKnown) {
        return { text: `I don't know a relation or rule called '${relationName}' yet.`, replace: true };
      }
      return {
        text: `I know the '${relationName}' relation, but I can't confirm ${subject} is the ${relationName} of ${object} from what you've told me.`,
        replace: true,
      };
    }
  }

  // (a0.2) RELATION "WHO" REVERSE ASK — "who is the/a/an <relation> of <Y>"
  // (Gap 2, live-tested 2026-07-09, PLAN_TAUGHT_RELATIONS.md follow-up):
  // every relational-query recognizer built so far (RELATION_FACT_YESNO_RE,
  // the (a0) block just above) requires BOTH subject and object — a yes/no
  // answer for one named pair. This is the REVERSE shape: given a relation
  // name and an OBJECT, find every SUBJECT that satisfies it. Re-derives
  // relationFactsFor/resolveRelationChase's SAME resolution logic (never
  // duplicating the SEARCH kernels themselves — findIsaChain, findReachableSet
  // — only the small, cheap, pure list-builder around them), for the SAME
  // reason (a0.5)'s own list block re-derives relationFactsFor rather than
  // sharing it with (a0): RELATION_WHO_ASK_RE and RELATION_FACT_YESNO_RE never
  // both match the same query (one starts with "who", the other with
  // "is/are/was/were"), so the two blocks never run in the same call.
  const whoAsk = qHedge.match(RELATION_WHO_ASK_RE);
  if (whoAsk) {
    const relationName = whoAsk[1].trim().toLowerCase();
    const rawObject = whoAsk[2].trim();
    const object = IS_ADJECTIVE_PRONOUN_RE.test(rawObject) ? (focusLabel || null) : rawObject;
    if (object && !ISA_IDIOM_ROLE_WORDS.has(relationName)) {
      const isTaughtRow = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
      const aliasSubClassEdges = rows
        .filter((f) => f.predicate === SUBCLASS_PREDICATE && isTaughtRow(f))
        .map((f) => [f.subject, f.object]);
      const { findIsaChain: chaseAliasWho } = await import("./syllogise.mjs");
      // Same candidate-list shape as (a0)'s own relationFactsFor — every
      // stored Fact whose predicate resolves, directly or via a TAUGHT
      // rdfs:subClassOf chain over relation-NAME strings, to `name`.
      const relationFactsForWho = (name) => {
        const target = String(name || "").trim().toLowerCase();
        const out = [];
        for (const f of rows) {
          const role = relationRoleWord(f.predicate);
          if (!role) continue;
          if (role === target) { out.push({ fact: f, aliasFacts: [] }); continue; }
          const chain = chaseAliasWho(role, new Set([target]), [], aliasSubClassEdges, { maxHops: 2 });
          if (!chain) continue;
          const aliasFacts = chain.map((step) => rows.find(
            (r) => r.predicate === SUBCLASS_PREDICATE && r.subject === step.subject && r.object === step.object,
          ));
          if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
        }
        return out;
      };
      const { loadMemory: loadMemWho, findRuleByName: findRuleByNameWho, resolveRelationChaseReverse } = await import("./memory/core.mjs");
      const memoryWho = await loadMemWho(memoryDir);
      // Generic REVERSE relation-NAME resolver — the mirror image of (a0)'s
      // resolveRelationChase: given a relation/rule name and a FIXED OBJECT,
      // return every { subject, citation } pair that satisfies it, instead of
      // a single yes/no for a fixed (subject, object) pair. Recursion is
      // bounded the SAME way (a0)'s own chase is (§3.3): a filter rule's base
      // is always either a plain relation (terminal) or another rule (one
      // level deeper), never itself.
      // Extracted to memory/core.mjs alongside (a0)'s own resolveRelationChase
      // (PLAN_COMPLETIONS.md Stage 1 prerequisite — see (a0)'s own comment for
      // why); `relationFactsForWho`/`renderFactLine`/`factPhrase`/
      // `factTermVariants`/`byTrust`/`rows`/`HAS_PROPERTY_PREDICATE` are this
      // block's own local closures/constants, threaded through explicitly.
      const relationChaseHelpersWho = { relationFactsFor: relationFactsForWho, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE };
      const hits = await resolveRelationChaseReverse(memoryWho, relationName, object, relationChaseHelpersWho);
      if (hits.length) {
        const lines = hits.map((h) => `${h.subject} — ${h.citation.join("; ")}`);
        return { text: lines.join("\n"), replace: true };
      }
      // Gap 1's SAME two-case honest-miss discipline, mirrored for the
      // reverse shape: is the relation/rule name known at all, or known but
      // empty for this particular object?
      const nameKnownWho = relationFactsForWho(relationName).length > 0
        || !!findRuleByNameWho(memoryWho, relationName);
      if (!nameKnownWho) {
        return { text: `I don't know a relation or rule called '${relationName}' yet.`, replace: true };
      }
      // HANDOVER.md 2026-07-10 item 3: "what is the capital of france" reads
      // oddly as "I don't know ANYONE who is the capital…" — the neutral
      // "nothing/anyone" split below matches whichever interrogative word the
      // query actually used.
      const isWhatAsk = /^what\b/i.test(qHedge);
      return {
        text: isWhatAsk
          ? `I don't know what the ${relationName} of ${object} is from what you've told me.`
          : `I don't know anyone who is the ${relationName} of ${object} from what you've told me.`,
        replace: true,
      };
    }
  }

  // (a0.5) RECURSIVE-RULE REACHABILITY LIST — "list the <plural> of <X>"
  // (PLAN_TAUGHT_RELATIONS.md Item 6, Phase 6's wiring half): a genuine
  // KIND-CHANGE from the yes/no dispatcher just above — REACHABILITY-SET
  // enumeration (every node ever reached), not single-target search.
  // Dispatches to a `recursive`-kind taught Rule via the SAME "what kind of
  // thing is this name" lookup (findRuleByName) the yes/no dispatcher uses,
  // then calls findReachableSet (src/planning.mjs, Phase 6's own kernel
  // half, landed unmodified here) seeded from baseCase's taught edges for
  // the start entity, stepping via recStep's edges at every further hop.
  // Renders each result with its own derivation path, mirroring the yes/no
  // chain-citation style above (renderFactLine + interleaved alias-fact
  // citations, deduped). No hit at all → null, the honest miss stands.
  const listAsk = qHedge.match(RECURSIVE_LIST_ASK_RE);
  if (listAsk) {
    const ruleName = singularizeSurface(listAsk[1].trim().toLowerCase());
    const rawSubject = listAsk[2].trim();
    const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? (focusLabel || null) : rawSubject;
    if (subject) {
      const {
        loadMemory, findRuleByName, RULE_KIND_PROP: ruleKindProp, RULE_KIND_RECURSIVE: recKind,
      } = await import("./memory/core.mjs");
      const memory = await loadMemory(memoryDir);
      const rule = findRuleByName(memory, ruleName);
      const ruleKind = rule?.attributes?.find((a) => a.prop === ruleKindProp)?.value;
      if (rule && ruleKind === recKind) {
        const baseCase = rule.attributes.find((a) => a.prop === "mgx:ruleBaseCase")?.value;
        const recStep = rule.attributes.find((a) => a.prop === "mgx:ruleRecStep")?.value;
        const startEntity = normFactTerm(subject);
        if (baseCase && recStep && startEntity) {
          const isTaughtRow = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
          const aliasSubClassEdges = rows
            .filter((f) => f.predicate === SUBCLASS_PREDICATE && isTaughtRow(f))
            .map((f) => [f.subject, f.object]);
          const { findIsaChain: chaseAlias } = await import("./syllogise.mjs");
          // Same alias-chase substrate the yes/no dispatcher's own
          // relationFactsFor uses (re-derived here rather than shared across
          // the two `if` blocks, which never run in the same call — one
          // regex or the other matches, never both).
          const relationFactsForList = (name) => {
            const target = String(name || "").trim().toLowerCase();
            const out = [];
            for (const f of rows) {
              const role = relationRoleWord(f.predicate);
              if (!role) continue;
              if (role === target) { out.push({ fact: f, aliasFacts: [] }); continue; }
              const chain = chaseAlias(role, new Set([target]), [], aliasSubClassEdges, { maxHops: 2 });
              if (!chain) continue;
              const aliasFacts = chain.map((step) => rows.find(
                (r) => r.predicate === SUBCLASS_PREDICATE && r.subject === step.subject && r.object === step.object,
              ));
              if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
            }
            return out;
          };
          // hop 0 (the base case) uses baseCase's edges; every hop after
          // that uses recStep's edges — a plain hop counter would need to
          // fold into the state-identity key (defeating dedup-by-node), so
          // the dedup key is the ENTITY alone (stateKey below): once a node
          // is reached via its SHORTEST path, a longer alternate path to the
          // same node is correctly pruned, never re-recorded or re-expanded
          // (this is also what makes a genuine cycle in the taught edges —
          // e.g. two individuals mutually taught as each other's parent —
          // terminate safely: the cyclic-back node is already `seen`).
          const { findReachableSet } = await import("./planning.mjs");
          const applyActions = (state) => {
            const relName = state.hop === 0 ? baseCase : recStep;
            return relationFactsForList(relName)
              .filter((e) => e.fact.subject === state.entity)
              .map((e) => ({ action: e, nextState: { entity: e.fact.object, hop: state.hop + 1 } }));
          };
          const stateKey = (state) => state.entity;
          const results = findReachableSet({ entity: startEntity, hop: 0 }, applyActions, { maxDepth: 20, stateKey });
          if (results.length) {
            const lines = results.map(({ node, path }) => {
              const seenAlias = new Set();
              const parts = [];
              for (const e of path.actions) {
                parts.push(renderFactLine(e.fact));
                for (const af of e.aliasFacts) {
                  const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
                  if (seenAlias.has(key)) continue;
                  seenAlias.add(key);
                  parts.push(`${factPhrase(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
                }
              }
              return `${node.entity} — ${parts.join("; ")}`;
            });
            return { text: lines.join("\n"), replace: true };
          }
        }
      }
      return null; // no taught recursive rule of this name reaches anything — honest miss
    }
  }

  // (a) FORWARD membership — "is an X a Y". X's fact-subject candidates are the
  // term itself (a class word) AND, when it resolves in the graph, its class-noun
  // (an instance) — so "is app/lib/a.mjs a component" answers off "module …".
  // A confirmation-check wrapper ("so X is a Y now right?") is rewritten to the
  // plain "is X a Y" form and re-tried when the raw query itself doesn't match —
  // see CONFIRM_TAG_RE's own docblock.
  const confirmTag = q.match(CONFIRM_TAG_RE);
  const isaAsk = q.match(ISA_ASK_RE) || (confirmTag && `is ${confirmTag[1].trim()} a ${confirmTag[2].trim()}`.match(ISA_ASK_RE));
  if (isaAsk) {
    // Playtest sprint round 1 (2026-07-10): "is TaskController a validator then"
    // — the same trailing bare discourse tag item 8 fixed for metaTermOf's bare
    // "what is X" shape also glues onto ISA_ASK_RE's captured kind term (its own
    // trailing anchor only allows punctuation/whitespace, not a stray word), so
    // "validator then" never matched any taught fact even though the CLASS↔
    // INSTANCE BRIDGE below would otherwise answer yes. Same stripTrailingDiscourseTag
    // fix, applied here too.
    const objVariants = factTermVariants(normFactTerm, stripTrailingDiscourseTag(isaAsk[2]));
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
    // LIVE cax-dw PROOF CHASE (PLAN_INFERENCE_TESTING.md INF-B1, §4 stage 3):
    // every "yes" strategy above missed — check whether X's taught type
    // (lifted through its FULL ⊑-ancestor closure) is disjointWith the
    // queried class, via syllogise.mjs's deriveDisjointViolations, LIVE and
    // READ-ONLY (same discipline as the findIsaChain chase just above:
    // nothing is written; syllogise()'s materializing batch pass is the
    // persisting counterpart of this same rule, never on the chat hot path).
    // A hit here is a PROVABLE "no" — the one shape on this ladder allowed to
    // answer "no" from absence-of-membership rather than decline; anything
    // this chase can't connect through a stated disjointness falls through
    // to the honest miss below, never a guessed "no".
    const { deriveDisjointViolations, DISJOINT_PREDICATE } = await import("./syllogise.mjs");
    const disjointRows = rows.filter((f) => f.predicate === DISJOINT_PREDICATE && isTaught(f));
    if (disjointRows.length) {
      const disjointEdges = disjointRows.map((f) => [f.subject, f.object]);
      const violations = deriveDisjointViolations(chainTypeEdges, chainSubClassEdges, disjointEdges, { budget: 10 });
      for (const subj of subjCandidates) {
        const v = violations.find((vv) => vv.subject === subj && objVariants.has(vv.object));
        if (!v) continue;
        const typeFact = chainTypeRows.find((f) => f.subject === v.subject && f.object === v.viaType);
        const disjointFact = disjointRows.find((f) => (f.subject === v.viaClass && f.object === v.object)
          || (f.subject === v.object && f.object === v.viaClass));
        const parts = [typeFact, disjointFact].filter(Boolean).map(renderFactLine);
        return { text: `no — ${parts.length ? parts.join("; ") : `${v.viaClass} and ${v.object} are disjoint.`}`, replace: true };
      }
    }
    // LIVE cls-svf1 PROOF CHASE (HANDOVER.md 2026-07-10 item 4,
    // PLAN_INFERENCE_TESTING.md INF-B2, §4 stage 4): every strategy above
    // missed — check whether X, having taught-P'd something of a taught type
    // (lifted through that type's FULL ⊑-ancestor closure), satisfies a
    // TAUGHT someValuesFrom restriction declared over that SAME (property,
    // type) pair — the restriction CLASS itself entailed (OWL 2 RL Table 8's
    // cls-svf1), via syllogise.mjs's deriveSomeValuesFromApplication, LIVE and
    // READ-ONLY (same discipline as the cax-dw chase just above: nothing is
    // written; syllogise()'s materializing batch pass is the persisting
    // counterpart of this same rule). The restriction's own scaffolding
    // (owl:onProperty/owl:someValuesFrom) and every property/type premise must
    // all be TAUGHT (never corpus-sourced), same as every other live chase in
    // this block.
    const {
      deriveSomeValuesFromApplication, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE,
      deriveSomeValuesFromSubsumption, ENTAILED_SCM_SVF_PROVENANCE, SCM_SVF_RULE_CONFIDENCE, entailedTrustFrom,
    } = await import("./syllogise.mjs");
    const onPropertyRows = rows.filter((f) => f.predicate === ON_PROPERTY_PREDICATE && isTaught(f));
    const someValuesFromRows = rows.filter((f) => f.predicate === SOME_VALUES_FROM_PREDICATE && isTaught(f));
    if (onPropertyRows.length && someValuesFromRows.length) {
      const someValuesFromOf = new Map(someValuesFromRows.map((f) => [f.subject, f.object]));
      const restrictionEdges = onPropertyRows
        .map((f) => ({ restriction: f.subject, property: f.object, target: someValuesFromOf.get(f.subject) }))
        .filter((r) => r.target);
      // Every OTHER taught object-property assertion is a candidate premise —
      // never hard-coded to one verb, mirroring syllogise()'s own generic
      // propertyEdges scan (RESERVED_PREDICATES, syllogise.mjs) minus the
      // predicates the other rules on this ladder already own.
      const svf1Reserved = new Set([SC_PREDICATE, RDF_TYPE_PREDICATE, DISJOINT_PREDICATE, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE, "owl:intersectionOf"]);
      const propertyRows = rows.filter((f) => isTaught(f) && !svf1Reserved.has(f.predicate));
      const propertyEdges = propertyRows.map((f) => [f.subject, f.predicate, f.object]);
      const svf1Derived = deriveSomeValuesFromApplication(propertyEdges, chainTypeEdges, chainSubClassEdges, restrictionEdges, { budget: 10 });
      for (const subj of subjCandidates) {
        const hit = svf1Derived.find((d) => d.subject === subj && objVariants.has(d.object));
        if (!hit) continue;
        const propFact = propertyRows.find((f) => f.subject === hit.subject && f.predicate === hit.viaProperty && f.object === hit.viaValue);
        const typeFact = chainTypeRows.find((f) => f.subject === hit.viaValue && f.object === hit.viaType);
        const parts = [propFact, typeFact].filter(Boolean).map(renderFactLine);
        return {
          text: `yes — ${parts.length ? parts.join("; ") : `${hit.subject} ${hit.viaProperty} ${hit.viaValue}, and ${hit.viaValue} is a ${hit.viaType}.`}`,
          replace: true,
        };
      }
      // LIVE scm-svf1 PROOF CHASE (PLAN_INFERENCE_TESTING.md INF-C1, this
      // build; W3C OWL 2 RL Table 9's scm-svf1 — confirmed distinct from
      // scm-svf2, which needs rdfs:subPropertyOf, which the ACE grammar can't
      // teach at all — see src/syllogise.mjs's own header comment): every
      // strategy above missed — two INDEPENDENTLY taught someValuesFrom
      // restrictions sharing the SAME property, whose filler classes are
      // themselves ⊑-related, license a restriction-to-restriction ⊑ fact
      // (deriveSomeValuesFromSubsumption). Reuses the SAME restrictionEdges
      // just built for cls-svf1 above — a SEPARATE findIsaChain call
      // (maxHops: 3, one hop of headroom over the A2 chase's maxHops: 2)
      // rather than folding into that earlier call, so INF-A2's pinned
      // behavior is untouched.
      const svfSubsumption = restrictionEdges.length > 1
        ? deriveSomeValuesFromSubsumption(restrictionEdges, chainSubClassEdges, { budget: 10 })
        : [];
      if (svfSubsumption.length) {
        const enlargedSubClassEdges = chainSubClassEdges.concat(svfSubsumption.map((d) => [d.subject, d.object]));
        // Trust-hook gap fix (this session): the SAME `min(premiseTrusts) x
        // ruleConfidence` discipline syllogise()'s own batch pass now applies
        // to scm-svf1 (src/syllogise.mjs), computed here for this LIVE,
        // read-only chase — each restriction's own onProperty/someValuesFrom
        // scaffolding trust plus the y1⊑y2 subClassOf premise that licensed
        // the comparison (always present, mirroring syllogise()'s own
        // scmSvfDerived mapping). `restrictionByRid` looks a restriction's
        // OWN (property, target) pair up by id — the same lookup
        // syllogise()'s batch pass uses.
        const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));
        const svfTrustByTriple = new Map();
        for (const f of rows) svfTrustByTriple.set(`${f.subject} ${f.predicate} ${f.object}`, f.trust);
        const svfPremiseTrust = (s, p, o) => svfTrustByTriple.get(`${s} ${p} ${o}`);
        const svfTrustOf = new Map(); // "c1\0c2" -> computed trust, for the synthetic row below
        for (const d of svfSubsumption) {
          const r1 = restrictionByRid.get(d.subject);
          const r2 = restrictionByRid.get(d.object);
          const premiseTrusts = [
            r1 && svfPremiseTrust(d.subject, ON_PROPERTY_PREDICATE, r1.property),
            svfPremiseTrust(d.subject, SOME_VALUES_FROM_PREDICATE, d.viaY1),
            r2 && svfPremiseTrust(d.object, ON_PROPERTY_PREDICATE, r2.property),
            svfPremiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaY2),
            svfPremiseTrust(d.viaY1, SC_PREDICATE, d.viaY2),
          ].filter((t) => typeof t === "number");
          const t = entailedTrustFrom(premiseTrusts, SCM_SVF_RULE_CONFIDENCE);
          if (t !== null) svfTrustOf.set(`${d.subject} ${d.object}`, t);
        }
        // A derived restriction⊑restriction edge has no underlying stored
        // Fact row to cite (it's a schema-level conclusion, not a taught
        // sentence) — falls back to a SYNTHETIC row carrying scm-svf1's own
        // entailed provenance + its own computed trust, so renderIsaChain's
        // citation still names the real (low-trust, non-taught) source
        // honestly, same discipline as every "entailed:*" provenance tag
        // elsewhere in this file.
        const factForStepOrSvf = (step) => {
          if (step.predicate !== SC_PREDICATE) return chainTypeRows.find((f) => f.subject === step.subject && f.object === step.object);
          const stated = chainSubClassRows.find((f) => f.subject === step.subject && f.object === step.object);
          if (stated) return stated;
          const derived = svfSubsumption.find((d) => d.subject === step.subject && d.object === step.object);
          return derived
            ? {
              subject: derived.subject, predicate: SC_PREDICATE, object: derived.object, provenance: ENTAILED_SCM_SVF_PROVENANCE,
              trust: svfTrustOf.get(`${derived.subject} ${derived.object}`),
            }
            : undefined;
        };
        for (const subj of subjCandidates) {
          const chain = findIsaChain(subj, objVariants, chainTypeEdges, enlargedSubClassEdges, { maxHops: 3 });
          if (!chain) continue;
          const premises = chain.map(factForStepOrSvf);
          if (premises.every(Boolean)) {
            // The WHOLE chain's own trust is the weakest link across every step
            // (each step's own trust, including the synthetic scm-svf1 step's
            // already-discounted figure computed above) — no further
            // ruleConfidence discount at this outer level; it is already
            // baked into whichever step was entailed rather than taught.
            const chainTrust = entailedTrustFrom(premises.map((p) => p.trust), 1);
            return { text: `yes — ${renderIsaChain(premises)}`, replace: true, ...(chainTrust !== null ? { trust: chainTrust } : {}) };
          }
        }
      }
    }
    return null; // no remembered fact — the honest miss stands (never a guessed "no")
  }

  // (a1c-i) CARDINALITY MONOTONICITY — "does every X have at least N Y" over
  // a TAUGHT exactly/min cardinality restriction (PLAN_INFERENCE_TESTING.md
  // INF-C1, this build; pattern-5, src/grammar/ace.mjs's parseCardinality).
  // FALLS THROUGH ON A MISS (see CARD_AT_LEAST_ASK_RE's own doc comment) —
  // never an unconditional decline, unlike isaAsk's own closing `return null`.
  const cardAtLeast = q.match(CARD_AT_LEAST_ASK_RE);
  if (cardAtLeast) {
    const [, subjRaw, mRaw, objRaw] = cardAtLeast;
    const {
      SUBCLASS_PREDICATE: CARD_SC_PREDICATE, ON_PROPERTY_PREDICATE: CARD_ON_PROPERTY_PREDICATE,
      buildCardinalityRestrictions, proveCardinalityAtLeast, CARDINALITY_RULE_CONFIDENCE, entailedTrustFrom,
    } = await import("./syllogise.mjs");
    const isTaughtCard = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
    const cardSubClassEdges = isa.filter((f) => f.predicate === CARD_SC_PREDICATE && isTaughtCard(f)).map((f) => [f.subject, f.object]);
    const cardRows = rows.filter((f) => (f.predicate === CARD_ON_PROPERTY_PREDICATE || CARDINALITY_ROW_PREDICATES.has(f.predicate)) && isTaughtCard(f));
    const cardinalityRestrictionEdges = buildCardinalityRestrictions(cardRows);
    if (cardinalityRestrictionEdges.length) {
      const subjVariants = factTermVariants(normFactTerm, subjRaw.trim());
      const objVariants = factTermVariants(normFactTerm, objRaw.trim());
      const m = Number(mRaw);
      const witness = findAcrossVariants(subjVariants, objVariants, (s, o) => proveCardinalityAtLeast(cardSubClassEdges, cardinalityRestrictionEdges, s, o, m, {}));
      if (witness) {
        const restrictionFact = rows.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.viaClass && f.object === witness.viaRestriction);
        const cite = restrictionFact?.provenance ? ` (source: ${restrictionFact.provenance})` : "";
        const kindWord = witness.kind === "exactly" ? "exactly" : "at least";
        const plural = (w, n) => `${w}${n === 1 ? "" : "s"}`;
        // Trust-hook gap fix (this session): premise-derived trust for THIS
        // rule's answer (src/syllogise.mjs's CARDINALITY_RULE_CONFIDENCE doc
        // comment explains why there is no persisted Fact for it to attach
        // to) — the restriction's OWN scaffolding rows (onProperty/kind/
        // onClass, all keyed to witness.viaRestriction), the declaring
        // subClassOf edge, and (when this is a ⊑-lift) the one-hop premise
        // from the actually-queried subject up to viaClass.
        const cardPremiseTrusts = [
          restrictionFact?.trust,
          ...cardRows.filter((f) => f.subject === witness.viaRestriction).map((f) => f.trust),
          ...(witness.viaClass !== witness.subject
            ? [isa.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.subject && f.object === witness.viaClass)?.trust]
            : []),
        ].filter((t) => typeof t === "number");
        const trust = entailedTrustFrom(cardPremiseTrusts, CARDINALITY_RULE_CONFIDENCE);
        return {
          text: `yes — every ${witness.viaClass} has ${kindWord} ${witness.n} ${plural(witness.object, witness.n)}${cite}, so at least ${m} follows.`,
          replace: true,
          ...(trust !== null ? { trust } : {}),
        };
      }
    }
    // falls through — no witnessing restriction (or none declared at all)
  }

  // (a1c-ii) cax-maxc0 — "does a/an X have a/an Y" over a TAUGHT
  // max-cardinality-0 restriction (PLAN_INFERENCE_TESTING.md INF-C1, this
  // build). NEVER infers "no" from absence, matching cax-dw's own discipline
  // above — a miss here FALLS THROUGH too (see CARD_EXISTENCE_ASK_RE's own
  // doc comment).
  const cardExistence = q.match(CARD_EXISTENCE_ASK_RE);
  if (cardExistence) {
    const [, subjRaw, objRaw] = cardExistence;
    const {
      SUBCLASS_PREDICATE: CARD_SC_PREDICATE, ON_PROPERTY_PREDICATE: CARD_ON_PROPERTY_PREDICATE,
      buildCardinalityRestrictions, proveMaxCardinalityZeroDenial, CAX_MAXC0_RULE_CONFIDENCE, entailedTrustFrom,
    } = await import("./syllogise.mjs");
    const isTaughtCard = (f) => !f.sourceTypes?.includes("corpus") && !f.sourceTypes?.includes("web");
    const cardSubClassEdges = isa.filter((f) => f.predicate === CARD_SC_PREDICATE && isTaughtCard(f)).map((f) => [f.subject, f.object]);
    const cardRows = rows.filter((f) => (f.predicate === CARD_ON_PROPERTY_PREDICATE || CARDINALITY_ROW_PREDICATES.has(f.predicate)) && isTaughtCard(f));
    const cardinalityRestrictionEdges = buildCardinalityRestrictions(cardRows);
    if (cardinalityRestrictionEdges.length) {
      const subjVariants = factTermVariants(normFactTerm, subjRaw.trim());
      const objVariants = factTermVariants(normFactTerm, objRaw.trim());
      const witness = findAcrossVariants(subjVariants, objVariants, (s, o) => proveMaxCardinalityZeroDenial(cardSubClassEdges, cardinalityRestrictionEdges, s, o, {}));
      if (witness) {
        const restrictionFact = rows.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.viaClass && f.object === witness.viaRestriction);
        const cite = restrictionFact?.provenance ? ` (source: ${restrictionFact.provenance})` : "";
        // Trust-hook gap fix (this session) — same discipline as the
        // cardinality-monotonicity reader just above (see its own comment).
        const cardPremiseTrusts = [
          restrictionFact?.trust,
          ...cardRows.filter((f) => f.subject === witness.viaRestriction).map((f) => f.trust),
          ...(witness.viaClass !== witness.subject
            ? [isa.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.subject && f.object === witness.viaClass)?.trust]
            : []),
        ].filter((t) => typeof t === "number");
        const trust = entailedTrustFrom(cardPremiseTrusts, CAX_MAXC0_RULE_CONFIDENCE);
        return { text: `no — every ${witness.viaClass} has at most 0 ${witness.object}${cite}.`, replace: true, ...(trust !== null ? { trust } : {}) };
      }
    }
    // falls through — no witnessing restriction (or none declared at all)
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

  // (a2b) OWNERSHIP yes/no — "does/did <Name> own/maintain <X>": Tier-5
  // playtest fix, found live — WHO_OWNS_RE only ever answered the OPEN "who
  // owns X" form; a direct yes/no claim about a specific (owner, thing) pair
  // ("does margo maintain the tasks handler") fell all the way through to the
  // structural code-graph wall, even right after teaching exactly that fact,
  // because GENERAL_VERB_QUERY_EXCLUDE_RE deliberately stands the general-verb
  // reader down for "own"/"maintain" (they mint a DIFFERENT predicate,
  // mgx:own/mgx:maintain, than this frame's own OWNED_BY_PREDICATE) — this is
  // that missing specific reader. Same closed-world convention as (a3)'s
  // general-verb yes/no just below: a hit answers "yes", no stored fact
  // answers a definite "no" (never a guessed owner name, unlike the OPEN "who
  // owns" form above, which stays an honest miss rather than guess WHO).
  const ownsYN = qHedge.match(OWNS_YESNO_RE);
  if (ownsYN) {
    const [, ownerRaw, thingRaw] = ownsYN;
    const ownerVariants = factTermVariants(normFactTerm, ownerRaw.trim());
    const thingVariants = factTermVariants(normFactTerm, thingRaw.replace(/^an?\s+/i, "").trim());
    const hit = rows
      .filter((f) => f.predicate === OWNED_BY_PREDICATE && thingVariants.has(f.subject) && ownerVariants.has(f.object))
      .sort(byTrust)[0];
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    return {
      text: `no — no remembered fact says ${ownerRaw.trim().toLowerCase()} owns/maintains ${thingRaw.trim()}.`,
      replace: true,
    };
  }

  // (a2b-ii) PASSIVE ownership yes/no — "is/are/was/were <X> owned by <Name>"
  // (Tier-5 playtest, cycle 2): same OWNED_BY_PREDICATE facts as (a2b) above,
  // just the passive phrasing — "is TaskController owned by sam" found live
  // to WALL entirely (no recognizer at all, teach OR read, for the passive
  // shape) even right after teaching that exact fact via OWNS_PASSIVE_TEACH_RE.
  // Checked BEFORE (a2c)'s adjective reader, which would otherwise also match
  // this shape (backtracking "owned by" into its subject and the owner name
  // into its adjective slot) and silently decline instead of answering.
  const ownsPassiveYN = qHedge.match(OWNS_PASSIVE_YESNO_RE);
  if (ownsPassiveYN) {
    const [, thingRaw, ownerRaw] = ownsPassiveYN;
    const thingVariants = factTermVariants(normFactTerm, thingRaw.replace(/^an?\s+/i, "").trim());
    const ownerVariants = factTermVariants(normFactTerm, ownerRaw.trim());
    const hit = rows
      .filter((f) => f.predicate === OWNED_BY_PREDICATE && thingVariants.has(f.subject) && ownerVariants.has(f.object))
      .sort(byTrust)[0];
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    return {
      text: `no — no remembered fact says ${thingRaw.trim().toLowerCase()} is owned by ${ownerRaw.trim()}.`,
      replace: true,
    };
  }

  // (a2b-iii) HAS-A-METHOD yes/no — "does/did <N1> have a/an <N2> method"
  // (HANDOVER.md 2026-07-10 item 9): see HAS_METHOD_YESNO_RE's own docblock
  // for the full design, including the confirmed pre-existing ask.mjs
  // structural collision when a real code graph is loaded. A hit answers
  // "yes"; no matching fact DECLINES (null) — never a guessed "no" (this
  // reader follows IS_ADJECTIVE_YESNO_RE/GENERAL_VERB_YESNO_RE's OWA
  // discipline below, not OWNS_YESNO_RE's closed-world "no" just above).
  const hasMethodYN = qHedge.match(HAS_METHOD_YESNO_RE);
  if (hasMethodYN) {
    const [, subjRaw, capRaw] = hasMethodYN;
    const subjVariants = factTermVariants(normFactTerm, subjRaw.trim());
    const objVariants = factTermVariants(normFactTerm, `${capRaw.trim()} method`);
    const hit = rows
      .filter((f) => f.predicate === HAS_A_PREDICATE && subjVariants.has(f.subject) && objVariants.has(f.object))
      .sort(byTrust)[0];
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    return null; // no remembered fact — honest decline, never a guessed "no"
  }

  // (a2b-iv) HAS-A-METHOD open list — "what methods does <N1> have"
  // (HANDOVER.md 2026-07-10 item 9): every taught mgx:hasA fact for <N1>
  // whose object is a "<word> method" phrase. An honest empty (null, never a
  // guessed method name) when nothing was taught for this subject.
  const hasMethodOpen = qHedge.match(HAS_METHOD_OPEN_RE);
  if (hasMethodOpen) {
    const subjVariants = factTermVariants(normFactTerm, hasMethodOpen[1].trim());
    const hits = rows
      .filter((f) => f.predicate === HAS_A_PREDICATE && subjVariants.has(f.subject) && / method$/.test(f.object))
      .sort(byTrust);
    if (!hits.length) return null;
    return renderMany(hits);
  }

  // (a2c) PROPERTY yes/no — "is/are/was/were <X> <adjective>": Tier-5 playtest
  // fix, found live — "remember that the logger module is deprecated" taught a
  // real mgx:hasProperty fact, but there was no direct-question reader for it
  // AT ALL (only presuppositionNudge's own narrow "why does X still Y" embeds
  // this same check) — "is the logger deprecated" fell straight to the
  // structural wall. Checks BOTH shapes a taught "<X> is <adjective>" can land
  // as (mirrors presuppositionNudge's own dual check, above): the teach lane's
  // mgx:hasProperty fact, or — when the adjective is a known ACE-OWL lexicon
  // data-property word — the ACE grammar's own tmct:<adjective> "true" triple.
  // "it"/"this"/"that" resolve against `focusLabel` — a bare pronoun with no
  // standing focus declines (null), same discipline STACCATO_PRONOUN_RE uses.
  const isAdj = qHedge.match(IS_ADJECTIVE_YESNO_RE);
  if (isAdj) {
    const rawSubject = isAdj[1].trim();
    const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? (focusLabel || null) : rawSubject;
    const adjective = isAdj[2].trim().toLowerCase();
    if (subject) {
      const subjVariants = factTermVariants(normFactTerm, subject);
      // CLASS↔INSTANCE BRIDGE (playtest sprint round 2, 2026-07-10): "is Task
      // auditable" used to say "I don't know anything about Task yet" even
      // with "every Record is auditable" taught and Task inheriting Record in
      // the code graph — this property-yes/no reader had no inheritance
      // bridging at all, unlike isaAsk's own CLASS↔INSTANCE BRIDGE just above
      // (chat.mjs's `inheritsChain`). Same bridge, same discipline: when the
      // subject resolves to a real graph entity, its superclass LABELS are
      // ADDITIONAL subject candidates, so a taught property on an ancestor
      // class is found too — never a guess, still just a direct fact lookup,
      // now over a wider (but still fact-backed) candidate set.
      const bridgeSubjects = new Map(); // fact-term variant → superclass label, as spelled in the graph
      let bridgeEnt = null;
      if (graph) {
        const ent = await resolveEntity(graph, subject);
        bridgeEnt = ent;
        if (ent) {
          for (const sup of inheritsChain(graph, ent.id)) {
            for (const v of factTermVariants(normFactTerm, sup.label)) {
              if (!subjVariants.has(v) && !bridgeSubjects.has(v)) bridgeSubjects.set(v, sup.label);
              subjVariants.add(v);
            }
          }
        }
      }
      const propertyMatch = (f) => (f.predicate === HAS_PROPERTY_PREDICATE && normFactTerm(f.object) === adjective)
        || (f.predicate === `tmct:${adjective}` && f.object === "true");
      // Same head-word fallback as factAnswer's "(c) what do you know about"
      // lane: a taught subject is often a real noun PHRASE ("logger module"),
      // shortened in the natural follow-up ("is the logger deprecated") — an
      // exact-variant miss on its own, on a whole word (length >= 4, the same
      // floor used elsewhere) shared between the query subject and the fact's
      // own subject.
      const subjWords = normFactTerm(subject).split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_ENTITY_WORDS.has(w));
      const wordOverlap = (f) => subjWords.some((w) => new Set(String(f.subject || "").split(/\s+/)).has(w));
      const subjectMatch = (f) => subjVariants.has(f.subject) || (subjWords.length && wordOverlap(f));
      const hit = rows.filter((f) => subjectMatch(f) && propertyMatch(f)).sort(byTrust)[0];
      if (hit) {
        const viaSuper = bridgeSubjects.get(hit.subject);
        // Named explicitly (never a silent subject swap) — same honesty
        // discipline isaAsk's own class↔instance bridge follows just above.
        return {
          text: viaSuper
            ? `yes — the code graph says ${bridgeEnt.label} inherits ${viaSuper}, and ${renderFactLine(hit)}`
            : `yes — ${renderFactLine(hit)}`,
          replace: true,
        };
      }
      // no hit on THIS property — never a guessed "no" (see
      // IS_ADJECTIVE_YESNO_RE's own docblock for why this stays silent on a
      // truth claim, unlike its ownership/general-verb siblings above). But a
      // subject we DO know something else about ("the logger" has a
      // deprecated-fact, just not a fast-fact) still deserves an honest, named
      // receipt — never a bare wall — mirroring factAnswer's own established
      // convention for a known-subject/wrong-predicate miss ("I don't have
      // any 'X' facts about Y"). The SAME subjectMatch (exact-variant OR
      // head-word overlap) decides "known", so a shortened/article-led
      // subject that found its fact via the overlap fallback is recognized
      // as known too. A subject with NO known facts at all falls through
      // undecided — there's nothing honest to say beyond the ordinary
      // cascade's own miss/orientation nudge.
      //
      // Tier 6 playtest: gated on `!envelope?.parsed`, the SAME guard this
      // function's empty-memory branch above just added, for the identical
      // reason — "is the logger tested" (after teaching an UNRELATED
      // "logger... is deprecated" fact) used to return "I don't have a fact
      // saying the logger is tested" here, discarding a REAL structural
      // answer ("No tests cover logger") for a word ("tested") that already
      // has genuine graph-computable meaning. A subject with a KNOWN taught
      // fact under some OTHER, non-structural property (the common,
      // originally-intended case here) still gets this receipt exactly as
      // before, since envelope.parsed is null for those adjectives.
      if (rows.some(subjectMatch) && !envelope?.parsed) {
        return { text: `I don't have a fact saying ${subject.toLowerCase()} is ${adjective}.`, replace: true };
      }
      // Tier-5 playtest fix (cycle 2), found live: "is the checkout flow
      // deprecated" as a genuinely FIRST-EVER question about a subject tmct
      // has never heard of (no fact at all, not even under a different
      // property) fell through to the raw structural wall, unguided — the
      // exact "honest 'I don't know that yet' offers to learn" case
      // SKILL_CHAT_PLAYTEST.md's Tier 5 (§3) itself names. The offered
      // phrasing is the SAME verified "remember that X is Y" wrapped form
      // TEACH_PROPERTY_RE actually accepts (arbitrary-length subject, no
      // lexicon gate on the complement) — never the bare unwrapped form,
      // which TEACH_PROPERTY_RE only reaches via BARE_DECLARATIVE_RE's own
      // single-token-subject restriction and would fail for a multi-word
      // subject like this one. Same helper (unknownAdjectiveOffer) the
      // empty-memory special-case above this function's own rows.length
      // bail-out reuses, so the two paths can never disagree on wording.
      //
      // Tier 6 playtest: same `!envelope?.parsed` guard as just above — a
      // subject known only under an UNRELATED property (e.g. "deprecated")
      // must not offer to teach "tested" when ask()'s own grammar already
      // resolved it structurally.
      if (!envelope?.parsed) return unknownAdjectiveOffer(subject, adjective);
    }
  }

  // (a3) GENERAL VERB-TO-PREDICATE direct-question retrieval (item 5, this
  // session): a taught general-verb fact ("margo eats ribs") answered back
  // directly. Yes/no form matches the taught triple EXACTLY (subject +
  // predicate + object, via the SAME factTermVariants/normFactTerm matching
  // WHO_OWNS_RE just used above) — a hit is a confident "yes". INFBENCH 1.2.0
  // fix: a no-hit here used to synthesize a confident "no", but "no matching
  // triple found after one lookup" is NOT a proof of absence (this project's
  // OWA/honesty discipline — see PLAN_INFERENCE_TESTING.md) — it's
  // indistinguishable from "I simply don't know". So a no-hit now returns
  // null (declining), same as WHO_OWNS_RE's own no-hit above, falling through
  // to the ordinary honest-miss cascade instead of fabricating a "no". Open
  // form lists every stored fact row for {subject, predicate} regardless of
  // object.
  const genYN = q.match(GENERAL_VERB_YESNO_RE);
  if (genYN && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
    const [, subjectRaw, verbRaw, objectRaw] = genYN;
    const verb = verbRaw.toLowerCase();
    if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb)) {
      const subject = subjectRaw.trim();
      const object = objectRaw.replace(/^an?\s+/i, "").trim();
      if (subject && object) {
        const predicate = await generalVerbPredicate(verb);
        const subjVariants = factTermVariants(normFactTerm, subject);
        const objVariants = factTermVariants(normFactTerm, object);
        const hit = rows
          .filter((f) => f.predicate === predicate && subjVariants.has(f.subject) && objVariants.has(f.object))
          .sort(byTrust)[0];
        if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true, generalVerbQuery: true };
        return null; // no remembered fact — the honest miss stands (never a guessed "no")
      }
    }
  }
  const genOpen = q.match(GENERAL_VERB_OPEN_RE);
  if (genOpen && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
    const [, subjectRaw, verbRaw] = genOpen;
    const verb = verbRaw.toLowerCase();
    if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb)) {
      const subject = subjectRaw.trim();
      if (subject) {
        const predicate = await generalVerbPredicate(verb);
        const subjVariants = factTermVariants(normFactTerm, subject);
        const hits = rankByBiasThenTrust(rows.filter((f) => f.predicate === predicate && subjVariants.has(f.subject)), biasByBundle);
        if (hits.length) return { ...renderMany(hits), generalVerbQuery: true };
      }
    }
  }

  // (b) RECALL — "what did i tell you about X": every remembered fact mentioning X.
  const told = q.match(TOLD_ABOUT_RE);
  if (told) {
    const variants = factTermVariants(normFactTerm, told[1]);
    const hits = rankByBiasThenTrust(rows.filter((f) => variants.has(f.subject) || variants.has(f.object)), biasByBundle);
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
  //
  // Bug found live this session (PLAN_CONVERSATION.md verification, Finding 1):
  // this branch exists specifically to catch the bare, no-article "what is X"
  // shape the grammar's own T5 template DECLINES to parse for a non-ENTITY_TO_TYPE
  // term (grammar.mjs's own closed-set gate on the bare form) — envelope.parsed
  // stays null for exactly this case, which is this branch's own trigger
  // condition. But the regex required a MANDATORY article ("an?" with no "?"),
  // the opposite of BARE_WHATIS_RE's own already-established "article optional"
  // convention (chat.mjs:5777, used one function up in this same cascade) — so
  // this branch could never actually fire for the bare form it exists to catch.
  // "every cache is a florble" / "what is florble" (no article) and "cheese is
  // blue" / "what is blue" (no article) both silently fell through to the
  // generic orientation card as a result, even though "what is a florble"/
  // "what is a blue" (WITH the article) correctly found the reverse fact.
  // Matching BARE_WHATIS_RE's own optional-article group fixes this at the
  // root, for every term alike (not a term/lexicon-specific asymmetry at all).
  let term = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
  let kindOf = false;
  const mk = q.match(KIND_OF_RE);
  if (mk) { term = mk[1]; kindOf = true; }
  else if (!term && !envelope?.parsed) {
    const m = q.match(/^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i);
    if (m) term = m[1];
  }
  if (!term) return null;
  const variants = factTermVariants(normFactTerm, term);
  const subjectHits = rankByBiasThenTrust(isa.filter((f) => variants.has(f.subject)), biasByBundle);
  const objectHits = rankByBiasThenTrust(isa.filter((f) => variants.has(f.object)), biasByBundle);
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
async function describedFacts(memoryDir, label, biasByBundle = {}) {
  let normFactTerm;
  try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { return null; }
  const rows = await factRows(memoryDir);
  if (!rows.length) return null;
  const variants = factTermVariants(normFactTerm, label);
  const hits = rankByBiasThenTrust(rows.filter((f) => variants.has(f.subject)), biasByBundle);
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
/** A code-ish name token in a prior query (a path/dotted name, a Capitalized
 *  symbol, or a lowerCamelCase identifier like `saveStore`/`createTask`) — the
 *  subject "what about X" replaces. The lowerCamelCase alternative (0.9.13
 *  Tier-1 playtest) closes a real drill-down gap: a chain focused on a FUNCTION
 *  ("what does saveStore call") has no Capitalized/path token at all, so "what
 *  about X" after it used to fall straight through to the honest-miss instead
 *  of continuing the shape — a mid-word capital never occurs in plain English,
 *  so this is a safe, unambiguous code-identifier signal. */
const NAME_TOKEN_RE = /\b[\w-]+(?:[/.][\w-]+)+\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/;

/** STACCATO SWAP CONTINUATION (0.9.15 Tier-2 playtest, 4th pass): the bare-
 *  connective sibling of WHAT_ABOUT_RE — "and Widget?", "also app/lib/b.mjs" —
 *  with no "about" at all. A rapid-fire drill-down chain naturally shortens
 *  to this once the shape is established ("what calls app/lib/a.mjs" -> "and
 *  Widget?" meaning "and what calls Widget?"). Unlike WHAT_ABOUT_RE's
 *  explicit question framing, a bare connective is otherwise too ambiguous
 *  with ordinary discourse ("and then?", "so what") to safely reinterpret as
 *  a subject swap — discourseRewrite below only trusts this shape when the
 *  captured word is ITSELF unambiguously code-ish (NAME_TOKEN_RE): a path, a
 *  Capitalized symbol, or lowerCamelCase. A plain word ("and stuff?") never
 *  matches and falls through unchanged. */
const STACCATO_SWAP_RE = /^(?:and|also|so|then|now)\s+(.+?)[?.!\s]*$/i;

/** The five bare connective words STACCATO_SWAP_RE/relationTermOf's own STACCATO
 *  branch lead with. Reused (runAsk's focus-resolution guard, below) to catch
 *  the case where ask()'s OWN raw grammar, given an unstripped "and calls?",
 *  happens to recognize "calls" as a verb and leaves the leading "and" as
 *  parsed.object — a leaked connective, never real content, must never be fed
 *  to resolveEntity (see that guard's own docblock for the concrete failure). */
const STACCATO_LEAKED_CONNECTIVES = new Set(["and", "also", "so", "then", "now"]);

/** A whole-word occurrence of one of chat.mjs's own closed antecedent pronouns
 *  (CONTEXT_WORDS: "it"/"this"/"that"/"here") inside a PRIOR turn's raw query
 *  text — discourseRewrite's fallback swap target when that text has no real
 *  NAME_TOKEN at all ("what calls it", "where is it defined"). Word-boundary
 *  anchored so a real identifier merely CONTAINING one of these (e.g. a symbol
 *  named `edithistory`) is never mistaken for the pronoun. */
const PRONOUN_IN_QUERY_RE = new RegExp(`\\b(?:${[...CONTEXT_WORDS].join("|")})\\b`, "i");

/** DISCOURSE CONTINUATION (CHATBENCH_006 lever 2): "what about X" carries the PRIOR
 *  turn's question shape across the turn boundary — re-asking it with X in place of
 *  the previous subject/object. Returns the reconstructed query (parsed like any
 *  subject question, so X resolves and becomes the new focus), or null when there's
 *  no prior query or no name token to swap (→ the ordinary honest miss stands). */
function discourseRewrite(query, last) {
  const m = String(query).match(WHAT_ABOUT_RE);
  let newSubj;
  if (m) {
    newSubj = m[1].trim();
  } else {
    const sm = String(query).match(STACCATO_SWAP_RE);
    const cand = sm?.[1]?.trim();
    if (!cand || !NAME_TOKEN_RE.test(cand)) return null;
    newSubj = cand;
  }
  if (!last?.query) return null;
  const prevQ = String(last.query);
  if (NAME_TOKEN_RE.test(prevQ)) return prevQ.replace(NAME_TOKEN_RE, () => newSubj);
  // PRONOUN-ANTECEDENT PRIOR QUERY (Tier-2 playtest, 6th pass, cycle 8, deep
  // multi-hop relation-touch chain stress-test): the prior turn can ITSELF be
  // pronoun-shaped ("what calls it", "where is it defined" — a drill-down
  // step that resolved "it" against the standing focus rather than naming an
  // entity literally) — such a query has NO NAME_TOKEN at all to swap, so the
  // rule above always declined and a perfectly natural next hop ("and Task?"
  // meaning "and what calls Task?") fell straight to the raw grammar wall.
  // Swap the bare pronoun itself in that case ("what calls it" -> "what calls
  // Task") — CONTEXT_WORDS is chat.mjs's own closed antecedent-pronoun set
  // (the same one isPronoun/the focus-reuse guard above already trust), so
  // this only ever touches a genuine referring pronoun, never a real word
  // that happens to contain "it"/"this"/"that" as a substring (whole-word
  // boundaries only).
  if (PRONOUN_IN_QUERY_RE.test(prevQ)) return prevQ.replace(PRONOUN_IN_QUERY_RE, () => newSubj);
  return null;
}

/** STACCATO SUPERLATIVE REPEAT (Tier-2 playtest, 6th pass, cycle 8): "the biggest
 *  one" / "which is biggest" / "which one is the biggest" / "what about the
 *  biggest one" continuing a superlative last turn ("which module has the most
 *  imports") names NO entity kind at all — parseSuperlative's own grammar always
 *  declines that shape ("a superlative needs an entity kind (module, class,
 *  function, …)"), the one piece of information every OTHER superlative phrasing
 *  supplies, and unlike a plain object ("what does it import") there is no
 *  pronoun slot here for the focus to fill. Rather than guess a NEW metric — a
 *  bare "biggest" with an entity kind spliced in would default to the generic
 *  "connections" metric (EDGE_NOUN_TO_METRIC.connections), which is NOT what
 *  "the biggest one" means right after a query about imports specifically, and
 *  would silently answer a different question than the one just asked — this
 *  re-asks the PRIOR superlative query VERBATIM: the user is confirming/
 *  repeating the same ranking in their own words, not asking a new one, so
 *  replaying the exact prior text (same entityType, same metric) is the only
 *  non-fabricating reading. Gated on the prior query textually naming an extreme
 *  word — a bare "the biggest one" after an unrelated last turn declines (null)
 *  and the ordinary honest miss stands, same discipline as discourseRewrite's
 *  own NAME_TOKEN_RE gate just above. */
const STACCATO_SUPERLATIVE_RE =
  /^(?:what about\s+)?(?:(?:and|also|so|then|now)\s+)?(?:which(?:\s+one)?\s+is\s+(?:the\s+)?|the\s+)(?:most|greatest|highest|biggest|largest|fewest|least|smallest)(?:[- ]connected)?(?:\s+ones?)?\s*\??$/i;
const SUPERLATIVE_EXTREME_WORD_RE = /\b(?:most|greatest|highest|biggest|largest|fewest|least|smallest)\b/i;
function superlativeRepeatRewrite(query, last) {
  if (!STACCATO_SUPERLATIVE_RE.test(String(query).trim())) return null;
  const prevQ = String(last?.query || "");
  if (!prevQ || !SUPERLATIVE_EXTREME_WORD_RE.test(prevQ)) return null;
  return prevQ;
}

/** EXISTENTIAL "is there anything/something/anyone/anybody that/which/who
 *  <verb-phrase>" -> "what <verb-phrase>". Round 2 playtest (2026-07-11):
 *  parseExistence (ask.mjs) correctly DECLINES this shape — "anything" is a
 *  placeholder, not a real entity-kind noun, so it rightly leaves a relative-
 *  clause verb-phrase for the relation parsers below. But those parsers then
 *  treat the ELIDED subject as an ANAPHORA continuation (reusing the standing
 *  focus) instead of recognizing "anything that <verb> X" as the SAME open
 *  reverse-lookup "is anything <verb-ing> X" already answers correctly
 *  ("test/tasks.test.mjs."). Live finding: "is there anything that tests
 *  Task", asked right after focus had landed on UserController, answered "No
 *  — no tests edge found from UserController to Task" — a confidently WRONG
 *  answer (worse than a miss), not the real answer. A closed textual rewrite
 *  onto the ALREADY-CORRECT "what <verb> X" shape sidesteps the AST-shape
 *  work entirely: no new capability, just aiming an existing one (the
 *  reverse-relation lookup "what tests X"/"who calls X") at input that means
 *  the same thing. Applied UNCONDITIONALLY (no `last` dependency, unlike
 *  discourseRewrite) — this shape carries its own complete meaning. */
const EXISTENTIAL_ANYTHING_RE = /^is\s+there\s+(?:anything|something|anyone|anybody)\s+(?:that|which|who)\s+(.+?)\s*\??$/i;
function existentialAnythingRewrite(query) {
  const m = EXISTENTIAL_ANYTHING_RE.exec(String(query || "").trim());
  return m ? `what ${m[1].trim()}` : null;
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

/** BUG 2 fix (2026-07-09): "what is a/an <term>" with the article made OPTIONAL,
 *  for the FACT-LOOKUP path only (metaTermOf/factAnswer's own bare-form fallback)
 *  — NOT grammar.mjs's structural T5 template, which keeps its article MANDATORY
 *  on purpose (a bare "what is <anything>" would also swallow "what is the
 *  meaning of this codebase", an existing, deliberately honest grammar-miss
 *  regression — test/ask.test.mjs pins it null; see T5's own docblock). That
 *  collision risk is a STRUCTURAL-PARSE concern (T5's tail becomes the literal
 *  graph-query object); it doesn't apply here: this regex only extracts a
 *  SUBJECT STRING to look up against the memory Facts store / curated lexicon —
 *  a miss (no fact, no lexicon entry) is silently absorbed by the caller and
 *  falls through to the ordinary honest-miss cascade, exactly like today's
 *  mandatory-article miss does. Root cause this fixes: "what is john" (no
 *  article) never matched the old mandatory-article regex at all, so a freshly
 *  taught "john rdfs:subClassOf function" fact was invisible to "what is john"
 *  even though "what is a john" (or "what is john used for") would have found
 *  it — the fact-lookup path is a low-collision subject lookup, not a structural
 *  parse, so loosening it here is safe. */
const BARE_WHATIS_RE = /^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;

/** The meta term a "what is a X" / "what is X" / "what does X mean" / "define X"
 *  question asks about — from the parse when present, else recognized directly
 *  via BARE_WHATIS_RE (article optional — see its own docblock for why that's
 *  safe here even though the grammar's own T5 keeps the article mandatory).
 *  Null when the line isn't such a form. Seonix Batch 2 Fix 3: a curated trailing
 *  scope clause ("what is a Module in this graph") is stripped off the captured
 *  term the same way grammar.mjs's T5 does (stripTrailingScopeFiller,
 *  ask-vocab.mjs) — the envelope.parsed.object branch above already carries a
 *  trimmed term when it came from that template, so the strip here only needs to
 *  cover this function's own regex fallback. HANDOVER.md 2026-07-10 item 8: a
 *  trailing bare discourse tag ("what is a component THEN") is stripped the same
 *  way (stripTrailingDiscourseTag) before the scope-filler strip. */
function metaTermOf(query, envelope) {
  if (envelope?.parsed?.shape === "meta" && envelope.parsed.object) return envelope.parsed.object;
  const q = String(query).trim();
  const m = q.match(BARE_WHATIS_RE)
    || q.match(/^what\s+(?:does|do)\s+(?:an?\s+)?(.+?)\s+means?[?.!\s]*$/i)
    || q.match(/^define\s+(?:an?\s+)?(.+?)[?.!\s]*$/i);
  return m ? stripTrailingScopeFiller(stripTrailingDiscourseTag(m[1].trim())) : null;
}

/** The TEACH-OFFER line for a term that's genuinely unknown everywhere (Tier-5
 *  playtest fix): "I don't know 'X' yet — teach me directly, e.g. …". The
 *  concrete example is worded by WORD COUNT, verified in-state
 *  (SKILL_CHAT_PLAYTEST.md §4's own rule) — an unwrapped bare declarative
 *  only stores for a single-token subject (BARE_DECLARATIVE_RE's own scope);
 *  the wrapped "remember X is a Y" form tolerates up to a two-token subject
 *  (unknownSubjectFallback's UNKNOWN_SUBJECT_RE). A 3+-word term fits
 *  neither shape — never offer a concrete example that would itself fail,
 *  the plain nudge to teach it still guides, honestly. Shared by runTurn's
 *  own "what is X" miss nudge and factAnswer's "what do you know about X"
 *  miss nudge, below, so the two can never disagree on wording. */
function unknownVocabTermOffer(term) {
  const article = /^[aeiou]/i.test(term) ? "an" : "a";
  const words = term.trim().split(/\s+/);
  const remember = `remember ${term} is ${article} <thing>`;
  const example = words.length === 1
    ? `"${term} is ${article} <thing>" or "${remember}"`
    : words.length === 2
      ? `"${remember}"`
      : null;
  return `I don't know "${term}" yet — teach me directly${example ? `, e.g. ${example}` : ` (e.g. "remember <name> is ${article} <thing>")`}.`;
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
// "tel" -> "tell" (0.9.14 Tier-2 playtest): the dropped-letter typo of THIS
// lane's own anchor word — "tel me about calls" used to miss the "^tell me
// about …" regex entirely and fall through to a bogus "no module matching
// 'tel me'" search. "tell" is not itself part of ask.mjs's code-graph grammar
// (VERB_TO_KIND/ENTITY_TO_TYPE/anchor words), so it can't live in the shared
// ask-vocab.mjs MISSPELLINGS table (test/ask-vocab.test.mjs enforces every
// correction value is grammar-owned) — same reasoning as chat.mjs's own
// SHORTHAND_CONTRACTIONS above: scoped locally to the lane that owns the word.
// Word-boundary matched so "hotel"/"intel" are untouched.
const VAGUE_TOUCH_TEL_RE = /\btel\b/i;
// "abut" -> "about" (Tier 6 playtest, §3b typo axis): a one-letter-dropped
// typo of THIS lane's own anchor word ("what abut imports" used to miss the
// "what about …" regex entirely and search for a module literally named
// "abut" instead). "about" is real English on its own (a genuine word) but is
// not itself part of ask.mjs's code-graph grammar (VERB_TO_KIND/ENTITY_TO_TYPE/
// anchor words) — same reasoning as VAGUE_TOUCH_TEL_RE just above, so this
// stays a local, lane-scoped replace rather than a shared MISSPELLINGS entry
// (test/ask-vocab.test.mjs enforces every correction TABLE value is grammar-
// owned; a bare discourse word like "about" fails that gate on purpose).
// Word-boundary matched so a real identifier merely containing "abut" (rare,
// but e.g. "rebuttal") is untouched.
const VAGUE_TOUCH_ABUT_RE = /\babut\b/i;
/** "explain X" / "please explain X" / "kindly explain X" / "explain X to me" /
 *  "explain X please" — a bare vague-touch shape, sibling of WHAT_ABOUT_RE
 *  above. Named (not inlined) so both vagueTouchTermOf (term extraction) and
 *  the isConversational-catch-all exemption (below, deduceGoalFromParsed's
 *  neighbourhood) can test the SAME shape. */
const EXPLAIN_TOUCH_RE = /^(?:please\s+|kindly\s+)*explain\s+(?:to\s+me\s+)?(?:an?\s+|the\s+)?(.+?)(?:\s+(?:to\s+me|please))?[?.!\s]*$/i;
function vagueTouchTermOf(query) {
  // typo-correct the ANCHOR words only ("waht about calls" -> "what about
  // calls") — this shape has no ask()-grammar envelope to lean on for typo
  // tolerance (unlike metaTermOf's "what is a X", which mostly gets it for
  // free off envelope.parsed once ask() itself has normalized). Then peel the
  // SAME closed greeting/thanks/modal-wrapper preambles ask()'s own grammar
  // already peels (0.9.14 Tier-2 playtest §3b spot-check: "cheers, what about
  // imports then" and "could you kindly tell me about the calls" both used to
  // fall through to a bogus object search) — applyPreambleFrames alone, NOT
  // the full normalizeQuery pipeline, which also runs subordination/
  // conditional rewrites that turn "tell me about X" into "about X" (its own
  // bridge frame), breaking this very regex.
  let q = correctMisspellings(String(query).trim());
  q = q.replace(VAGUE_TOUCH_TEL_RE, "tell");
  q = q.replace(VAGUE_TOUCH_ABUT_RE, "about");
  q = applyPreambleFrames(q);
  const m = q.match(/^(?:kindly\s+)?tell me about\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i)
    || q.match(/^(?:(?:and|so|but|ok|okay|now|then|kindly)\s+)*what about\s+(?:an?\s+|the\s+)?(.+?)(?:\s+then|\s+though)?[?.!\s]*$/i)
    // "explain X" (0.9.14 Tier-2 playtest, second pass, §3b formal/ESL angle)
    // — a bare "explain <term>" is at least as natural a vague touch as "tell
    // me about X", but had no recognized shape at all: normalize.mjs's own
    // EXPLAIN_WRAPPER_RE only unwraps a WH-QUESTION remainder ("explain
    // please where is it defined" -> a real structural question), so a bare
    // noun remainder like "cochange" was never its territory. A leading
    // "please"/"kindly" also broke the STRUCTURAL pipeline's own
    // EXPLAIN_WRAPPER_RE (anchored to start with "explain" literally),
    // sending the whole turn to the wrong lane.
    || q.match(EXPLAIN_TOUCH_RE);
  if (!m) return null;
  // A trailing meta-noun naming WHAT KIND of thing the touched word already is
  // (0.9.14 Tier-2 playtest, second pass): "tell me about the cochange
  // relation" / "what about the calls relationship" / "what about the imports
  // edges" used to capture the WHOLE tail ("cochange relation") as the term —
  // RELATION_TERM's closed dict has no multi-word entries, so the relation
  // force declined and the query fell through to the grammar wall. Stripped
  // for both callers (conceptTermOf's noun touch and relationTermOf's edge
  // touch): a noun concept is never phrased with this tail ("tell me about
  // the Class relation" isn't natural), so it's safe either way.
  const term = m[1].trim().replace(/\s+(?:relations?|relationships?|edges?)$/i, "").trim();
  return term || null;
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
  // same typo-correction as vagueTouchTermOf above ("waht calls are there" ->
  // "what calls are there") — these openers are chat.mjs-only shapes with no
  // ask()-grammar envelope to inherit normalization from (0.9.14 Tier-2
  // playtest: "waht calls are there" used to hit the grammar wall outright).
  const q = correctMisspellings(String(query).trim()).toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  let m;
  // "what are the imports", "what is the containment", "what are all the calls",
  // and the texting-shorthand "r" for "are" (0.9.14 Tier-2 playtest §3b spot-check:
  // "what r the calls" — narrowly scoped to this closed shape, same judgment call
  // as chat.mjs's own SHORTHAND_CONTRACTIONS for the identity lane: "r" only reads
  // as "are" right after "what" in one of these curated anchor shapes, so a real
  // one-letter identifier is never at risk).
  if ((m = q.match(/^what\s+(?:are|is|r)\s+(?:all\s+)?(?:the\s+)?([a-z][a-z-]*?)(?:\s+(?:edges|relationships|relations))?$/))) return m[1];
  // "what calls are there", "what imports are there", "what calls r there"
  if ((m = q.match(/^what\s+([a-z][a-z-]*?)\s+(?:are|r)\s+there$/))) return m[1];
  // "what is calling", "what is importing" (bare gerund, no object)
  if ((m = q.match(/^what\s+(?:is|are)\s+([a-z][a-z-]*ing)$/))) return m[1];
  // STACCATO RELATION-CHAIN CONTINUATION (0.9.15 Tier-2 playtest, 4th pass): a
  // rapid-fire short follow-up inside an EXISTING relation-touch chain — "and
  // calls?", "also tests", "so inherits", "then contains" — has no "about"/
  // "is"/"are" at all, just a bare connective + the relation word. Without
  // this, the bare word fell straight through to ask()'s own raw grammar,
  // which parsed the leading connective ITSELF as the object term (e.g. "and
  // calls" read as kind=calls object="and", silently resolving "and" via the
  // standing focus/contextId fallback into an unrelated, honestly-empty-but-
  // wrong answer) or, worse, matched no shape at all and hit the grammar
  // wall outright. Scoped to RELATION_TERM's own closed dict downstream (this
  // function's caller, relationForceAnswer), so an unrelated word or a real
  // entity name ("and Widget?", "so that") safely falls through unchanged —
  // only a genuine, already-known relation word is swept up.
  if ((m = q.match(/^(?:and|also|so|then|now)\s+([a-z][a-z-]*)$/))) return m[1];
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
 *  tell me about X", "tell me more about X", "what about X" → attempt
 *  tmct_describe(X). Found live (playtest sprint round 2,
 *  SKILL_PLAYTEST_SPRINT.md): a describe-intent question wrapped in an
 *  ordinary polite request ("can you tell me more about Controller") fell all
 *  the way to the generic wall despite naming a real, just-listed entity —
 *  nothing recognized the wrapper at all. Same closed lead-in-alternation
 *  discipline as GREETING_PREAMBLE_RE/THANKS_PREAMBLE_RE (normalize.mjs).
 *  Deliberately used only as a LAST-RESORT lane (see its call site below) —
 *  "tell me about X" is ALSO the relation/concept force's own trigger phrase
 *  for enumerable concepts ("tell me about inheritance"), and "what about X"
 *  is ALSO discourseRewrite's own trigger for continuing an ask()-shaped prior
 *  turn — this must never run before those have had their chance. Trails an
 *  optional "please" as well as "for me" (playtest sprint round 3): this lane
 *  reads the RAW turn text, not normalize.mjs's FILLER_WORDS-stripped one, so
 *  "could you tell me more about Router please" needs its own trailing-
 *  politeness strip.
 *  "what about X" (0.9.13 Tier-1 playtest): reaches this lane specifically
 *  when the PRIOR turn was itself a describe-shaped question ("describe Task"
 *  isn't an ask()-grammar verb, so discourseRewrite's "describe <X>" rewrite
 *  can never parse and always misses) — a drill-down chain that opens with
 *  "describe X" (the README's own example) used to dead-end on the very next
 *  "what about it"/"what about Y" turn. */
// Bug F point 4 (operator follow-up request): "please tell me X" (no "about")
// answers like "describe X"/"what is X" — the "tell me" branch's own "about"
// is now OPTIONAL, so "please tell me Widget" reaches the same rescue "please
// tell me about Widget" already did. "describe"/"what(?:'s|\s+is)? about" stay
// unchanged (describe never took "about" at all; the "what about" branch
// still requires it — a bare "what X" is BARE_WHATIS_RE's own territory, not
// this lane's, and folding it in here would risk double-claiming that shape).
// Note the trailing \s+ moved INSIDE each alternation branch (rather than one
// shared \s+ after the whole group): making "about" optional inside the "tell
// me" branch means that branch's own separator is sometimes owned by "me\s+"
// and sometimes by "about\s+" — a single external \s+ double-counted the
// separator when "about" fired (swallowing the one real space and then
// requiring a second one that was never there, an always-null regex found
// live while testing this fix).
const DESCRIBE_WRAPPER_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?(?:tell\s+me\s+(?:more\s+)?(?:about\s+)?|describe\s+|what(?:'s|\s+is)?\s+about\s+)(.+?)(?:\s+for\s+me)?(?:\s+please)?\s*\??$/i;

/** Bare focus pronouns this lane resolves against the STANDING focus (0.9.13
 *  Tier-1 playtest) — "describe that" / "tell me about it" after a prior turn
 *  set the focus. Never a guess: no standing focus → the lane declines (null),
 *  same as any unresolvable term. */
const DESCRIBE_PRONOUN_RE = /^(?:it|that|this|those|them)$/i;

/** STACCATO PRONOUN CONTINUATION (0.9.15 Tier-2 playtest, 4th pass): a rapid-
 *  fire short follow-up naming no verb at all — "and that?", "also this",
 *  "so it" — the bare-connective sibling of DESCRIBE_WRAPPER_RE's "what about
 *  it"/"describe that". Without this, "what calls X" -> "and that?" fell to
 *  the generic orientation card (isConversational's ≤3-word catch-all caught
 *  it, and DESCRIBE_WRAPPER_RE requires an actual "about"/"describe" anchor
 *  word this shape never has) even though the immediately-prior turn had just
 *  set a real focus a sibling phrasing ("what about it") already resolves
 *  against cleanly. An optional trailing "one"/"ones" (Tier-2 playtest, 5th
 *  pass — "also that one?", "and those ones") is at least as natural as the
 *  bare pronoun and carries no extra meaning beyond it: the capture group
 *  stays the pronoun alone, so DESCRIBE_PRONOUN_RE's downstream test is
 *  unaffected either way. */
const STACCATO_PRONOUN_RE = /^(?:and|also|so|then|now)\s+(it|that|this|those|them)(?:\s+ones?)?\s*\??$/i;

/** Tier 6 playtest: "describe the logger module"/"describe the Task class" —
 *  dispatchTool("tmct_describe") resolves its `symbol` arg via codegraph.mjs's
 *  resolveSymbol, a separate, simpler path/basename matcher with NO article- or
 *  grain-word tolerance. A first attempt routed this whole free-text `term`
 *  through resolveEntity/resolveObject instead (which DOES have that tolerance,
 *  just added above) — reverted live, found via this same playtest cycle's own
 *  regression run: resolveObject's tier-3 ANY-overlap fallback is tuned for
 *  near-path/near-symbol terms, not arbitrary English sentences, and a genuine
 *  English article ("a", "the") can itself be a real one-character path
 *  component of some fixture module ("a.mjs") — "tell me A JOKE" tier-3-matched
 *  that module by the shared bare "a" alone (test/sessions.test.mjs's own guard
 *  test caught it: a turn meant to fall through as an honest grammar miss
 *  instead silently "described" an unrelated module). Scoped down to ONLY ever
 *  attempt a resolution when the term carries an EXPLICIT trailing grain word
 *  (module/class/function/method/…, ENTITY_TO_TYPE's own closed table) — the
 *  class-narrowed pool that then searches is both far smaller and still
 *  requires the head noun to actually match a stem, so it stays safe; a bare
 *  "the X"/"an X" or ordinary sentence (no grain word) gets NO rescue attempt
 *  at all and falls through to the untouched, always-safe resolveSymbol path,
 *  exactly as before this fix. */
const DESCRIBE_GRAIN_WORD_RE = new RegExp(
  `^(?:(?:the|a|an)\\s+)?(.+?)\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`, "i",
);
async function describeGrainRescue(graph, term) {
  if (!graph) return null;
  const m = String(term || "").trim().match(DESCRIBE_GRAIN_WORD_RE);
  if (!m) return null;
  const [, head, grainWord] = m;
  const expectedClass = ENTITY_TO_TYPE[grainWord.toLowerCase()];
  if (!head?.trim() || !expectedClass) return null;
  try {
    const { resolveObject } = await import("./ask.mjs");
    const r = resolveObject(graph, head.trim(), { expectedClass });
    if (r?.match?.id && !r.ambiguous) return { id: r.match.id, label: r.match.label };
  } catch { /* tolerated */ }
  return null;
}

async function describeWrapperAnswer(query, { config, source, focus, graph, tel = null }) {
  // Tier 6 playtest: this lane is the LAST-RESORT rescue (4d, tried after every
  // earlier lane declines on the ORIGINAL query) — but it tested its own
  // DESCRIBE_WRAPPER_RE against the RAW, un-normalized text, so a preamble an
  // earlier lane (relationForceAnswer/vagueTouchTermOf) already knows how to
  // strip ("ok cool, what about the TaskController" — relationForceAnswer
  // correctly declines since "TaskController" isn't an enumerable RELATION_TERM,
  // but never hands its own stripped text forward) reappeared here, unstripped,
  // and broke DESCRIBE_WRAPPER_RE's own anchor. applyPreambleFrames is the same
  // general-purpose, closed, idempotent pass every other lane in this file
  // already runs first.
  // BENCHMARK_CONVERSATION_1.7.0.md routed backlog C3 ("wat about store.mjs"):
  // this lane's own DESCRIBE_WRAPPER_RE anchors on a literal "what about"/
  // "describe"/"tell me about" — a curated typo of one of those anchor words
  // ("wat" for "what") never matched, so the whole lane silently declined even
  // though "wat" is already a curated MISSPELLINGS entry everywhere else.
  // correctMisspellings runs FIRST, same order chat.mjs's other normalization
  // call sites use (e.g. the module-orient lane above), so the anchor match
  // sees the corrected text; a genuinely uncurated typo still declines here,
  // same honest-miss behavior as before.
  const q = applyPreambleFrames(correctMisspellings(String(query || "").trim()));
  const m = DESCRIBE_WRAPPER_RE.exec(q) || STACCATO_PRONOUN_RE.exec(q);
  let term = m?.[1]?.trim();
  if (!term) return null;
  // HANDOVER.md 2026-07-10 item 10: "describe about X" (a doubled verb — the
  // "describe" branch of DESCRIBE_WRAPPER_RE never expects a following "about",
  // unlike its own "tell me about"/"what about" branches, which already consume
  // theirs inside the regex) leaves a redundant leading "about " glued to the
  // captured term. Stripped once, here, before any resolution — the other two
  // branches never leave this residue, so this can only ever help the doubled-
  // verb case, never change a correctly-captured term.
  term = term.replace(/^about\s+/i, "");
  // Round 1 playtest fix (2026-07-11): a trailing bare discourse tag ("describe
  // Record then", "tell me about Record then") glued onto the captured term,
  // same class of bug HANDOVER.md 2026-07-10 item 8 already fixed for the
  // meta-whatis vocab lane (stripTrailingDiscourseTag, ask-vocab.mjs) — this
  // lane never got the same treatment, so "Record then" failed to resolve as
  // any real symbol even though "Record" alone (a real entity just discussed)
  // resolves cleanly.
  term = stripTrailingDiscourseTag(term);
  if (DESCRIBE_PRONOUN_RE.test(term)) {
    if (!focus?.label) return null; // no standing focus to resolve against — honest decline
    term = focus.label;
  } else {
    const rescued = await describeGrainRescue(graph, term);
    if (rescued?.label) {
      term = rescued.label;
    } else {
      // Tier 6 playtest: "what about the TaskController" (no grain word, just a
      // bare article) — resolveSymbol (codegraph.mjs) has no component/overlap
      // tier at all, only exact/endsWith/basename/includes checks, so a leading
      // "the"/"a"/"an" is pure NOISE here (unlike resolveObject's looser tiers,
      // there is no accidental-match risk this could introduce — stripping it
      // only ever REMOVES characters no real label ever contains as a match
      // signal). "TaskController" resolves exactly where "the TaskController"
      // didn't.
      term = term.replace(/^(?:the|a|an)\s+/i, "");
    }
  }
  try {
    const text = await dispatchTool("tmct_describe", { symbol: term }, { config, source, tel });
    if (!text) return null;
    // Playtest sprint round 1 (2026-07-11): this rescue resolves and confidently
    // describes a real entity ("tell me more about Task"), but until now returned
    // only `text` — the resolved entity never reached the caller, so the session's
    // focus was never updated. The VERY NEXT natural follow-up ("what calls it",
    // "where's that defined") then dead-ended on "'it' needs a selected node to
    // refer to" right after the engine had just named one — the exact anaphora
    // this project's own playtest discipline requires to carry (SKILL_BENCHMARK_
    // CONVERSATION.md §1b). Mirrors the object-resolution/superlative-winner focus
    // updates already done for the ordinary ask() path just above this function.
    const ent = await resolveEntity(graph, term);
    return { text, ent };
  } catch {
    return null; // unresolvable term — decline, the ordinary wall stands unchanged
  }
}

/** DETAILED-SUMMARY / EXPLAIN-IN-DETAIL closed phrasings (HANDOVER.md 2026-07-10 item
 *  7) — "give me a detailed summary of how the task system works" / "explain in detail
 *  how X works" / "give me a detailed overview of X". PLAYTESTBENCH_1.4.1.md round 3
 *  caught this EXACT phrasing hitting the plain grammar wall with NO inferred goal at
 *  all, even though src/completions/'s extractive multi-sentence pipeline (Stages 0-3,
 *  built and unit-tested the same session) already existed and could answer it when
 *  called directly — it was simply unreachable from any real chat turn.
 *
 *  Two closed shapes, deliberately narrow (this project's own discipline: curated
 *  closed patterns, never a general "any long question" catch-all):
 *   1. DETAILED_HOW_WORKS_RE — "...detailed (summary|overview|explanation) of how X
 *      works" / "explain ... in detail how X works" — the "how X works" shape
 *      PLAYTESTBENCH's own probe used. Tried FIRST (its "works" anchor is strictly
 *      more specific, so it must win over #2 whenever both could parse).
 *   2. DETAILED_OVERVIEW_RE — "...detailed (overview|summary|explanation) of X" — the
 *      bare-subject sibling, no "how...works" wrapper.
 *  Distinct from DESCRIBE_WRAPPER_RE (a single-answer "one definition" lane, anchored
 *  on "tell me about"/"describe"/"what about") — neither of these two anchors on
 *  "give me"/"explain ... in detail", so there is no overlap to shadow. */
const DETAILED_HOW_WORKS_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?(?:give\s+me\s+a\s+detailed\s+(?:summary|overview|explanation)\s+of\s+how|explain\s+(?:to\s+me\s+)?in\s+detail\s+how)\s+(.+?)\s+works\s*\??$/i;

const DETAILED_OVERVIEW_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?give\s+me\s+a\s+detailed\s+(?:overview|summary|explanation)\s+of\s+(.+?)\s*\??$/i;

/** THE COMPLETIONS RESCUE (HANDOVER.md 2026-07-10 item 7) — wires src/completions/'s
 *  extractive, cited, groundedness-checked multi-sentence pipeline (generateCompletion(),
 *  src/completions/complete.mjs) into live chat dispatch. Tried in runAsk ONLY after
 *  (4d) DESCRIBE-WRAPPER RESCUE (and everything above it) has already declined — the
 *  same "last-resort lane" discipline synonymFactAnswer's and describeWrapperAnswer's
 *  own docblocks each spell out: "describe X" / "tell me about X" phrasings must keep
 *  reaching describeWrapperAnswer's (or the relation force's) single-answer rescue
 *  unmolested; this lane only ever claims a turn shaped as an EXPLICIT request for a
 *  detailed/multi-sentence account (DETAILED_HOW_WORKS_RE / DETAILED_OVERVIEW_RE,
 *  above), a shape neither DESCRIBE_WRAPPER_RE nor vagueTouchTermOf recognizes.
 *
 *  Honest by construction: generateCompletion() itself declines (returns
 *  `declined:true`, empty text) whenever nothing in the corpus/graph clears its own
 *  pruning bar for the term (PLAN_COMPLETIONS.md §3's honest ceiling) — this lane
 *  passes that decline straight through as null, falling through to the ordinary miss
 *  below. NEVER fabricates. Lazy + failure-tolerated (dynamic import, try/catch) like
 *  every other lane in this file. src/completions/ itself is untouched by this change —
 *  this is the call site only. */
async function completionsRescueAnswer(query, { memoryDir, graph }) {
  if (!memoryDir) return null; // no repo/memory to search — honest decline
  // Deliberately NOT applyPreambleFrames here (unlike describeWrapperAnswer just
  // above) — found live while wiring this lane: its own SHOW_GIVE_ME_RE frame turns
  // ANY "give me (the)? X" into "describe X" before this lane would ever see it,
  // which is exactly right for describeWrapperAnswer (DESCRIBE_WRAPPER_RE has its own
  // "describe " branch to catch that) but SILENTLY DESTROYS this lane's own
  // "give me a detailed summary/overview of ..." anchor — "give me a detailed summary
  // of how the Widget works" became "describe a detailed summary of how the Widget
  // works" and neither DETAILED_HOW_WORKS_RE nor DETAILED_OVERVIEW_RE could match it
  // anymore, so the turn silently fell through to the plain grammar wall exactly like
  // before this lane existed. Matching the RAW trimmed query instead is safe: this
  // lane's own two regexes already carry their own optional "can/could/would you
  // (please)?"/"please" politeness prefix (mirroring DESCRIBE_WRAPPER_RE's own), so no
  // separate normalization pass is needed for the phrasings this lane targets.
  const q = String(query || "").trim();
  const m = DETAILED_HOW_WORKS_RE.exec(q) || DETAILED_OVERVIEW_RE.exec(q);
  let term = m?.[1]?.trim();
  if (!term) return null;
  // same bare-article strip describeWrapperAnswer's resolveSymbol-facing branch
  // already uses just above — pure retrieval/ranking noise, never a real content
  // signal, and stripping it only ever REMOVES characters, never changes a
  // correctly-captured term.
  term = term.replace(/^(?:the|a|an)\s+/i, "").trim();
  if (!term) return null;
  try {
    const { generateCompletion } = await import("./completions/complete.mjs");
    // HANDOVER.md item 1: broadSearch (src/completions/search.mjs) already accepts an
    // optional Repository-Interface `graphService` — its own docblock names
    // createGraphService(graph) (src/providers/graph-service.mjs) as the reference
    // shape — but until now nothing ever handed one through, so this lane could only
    // ever see memory BLOCKS saved via an explicit saveBlock() call. Ordinary chat
    // teaching/asking never calls saveBlock(), so a subject's first-ever mention in a
    // session always declined here, no matter how much the already-loaded graph (and
    // any taught Facts about it) actually knew. createCompletionsGraphAdapter
    // (src/completions/graph-adapter.mjs) wraps the SAME graph object this turn already
    // has in scope (runTurn's own `graph` param, loaded once per session by the chat
    // shell) plus this repo's already-loaded Fact store — no re-load, no new search
    // machinery, just handing broadSearch the adapter it was always built to accept.
    // Loading memory here (rather than letting generateCompletion load it itself at
    // Stage 3) lets the SAME loaded payload double as the adapter's Fact-search source;
    // passed straight through as opts.memory so Stage 3 doesn't re-read it a second
    // time. A null/empty graph (no code entities loaded yet) or empty memory (no Facts
    // taught yet) degrades to the pre-existing block-only search, exactly as before.
    const { createCompletionsGraphAdapter } = await import("./completions/graph-adapter.mjs");
    const { loadMemory } = await import("./memory/core.mjs");
    const memory = await loadMemory(memoryDir);
    const graphService = createCompletionsGraphAdapter(graph, memory);
    const result = await generateCompletion(memoryDir, term, { query: term, graph, memory, graphService });
    if (!result || result.declined || !result.text) return null; // honest decline — never fabricate
    return { text: result.text };
  } catch {
    return null; // unresolvable/errored — decline, the ordinary wall stands unchanged
  }
}

/** THE RELATION CONCEPT FORCE — compose the three-band answer (curated relation
 *  definition + real example EDGES + pre-validated follow-ups) for a vague touch on a
 *  relation/edge kind ("what about imports", "what are the calls", "tell me about
 *  contains"), or null when it isn't one: not a recognizable relation touch, not a
 *  known edge concept (RELATION_TERM), no curated definition, or the graph has NO
 *  edges of that kind (composeRelation's own honest-miss gate). Loads the definition
 *  from the shipped corpus/seon/relations.jsonl, so it works without per-repo memory
 *  seeding. Lazy + failure-tolerated throughout. Returns { text, pending, kind } —
 *  `kind` is the resolved RELATION_TERM canonical kind (imports/calls/…), the SAME
 *  vocabulary GOAL_BY_KIND keys on, so a caller whose own envelope.parsed never
 *  stood (this force's whole reason to exist — see relationTermOf/
 *  isVagueRelationTouch's own docs) can still deduce the correct "Goal (inferred):
 *  …" line instead of silently carrying forward a null goal from earlier in the
 *  turn. */
async function relationForceAnswer(query, envelope, { graph, config, source, templates }) {
  const rawTerm = relationTermOf(query, envelope);
  if (!rawTerm) return null;
  let composeRelation; let RELATION_TERM;
  try { ({ composeRelation, RELATION_TERM } = await import("./concept.mjs")); }
  catch { return null; }
  const term = String(rawTerm).toLowerCase();
  const kind = RELATION_TERM[term];
  if (!kind) return null; // not an enumerable edge concept — ordinary path owns it
  const definition = (await relationDefinitions()).get(kind) ?? null;
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
  return { text, pending, kind };
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

/** C2 rescue (BENCHMARK_CONVERSATION_1.7.0.md routed backlog): a matching-kind
 *  individual explicitly NAMED in `answerText` — the SAME code-ish name tokens
 *  discourseRewrite already trusts (NAME_TOKEN_RE: a path, a Capitalized
 *  symbol, or lowerCamelCase), each tried in turn, resolved CLASS-FILTERED
 *  (resolveObject's own `expectedClass` option — describeGrainRescue, above,
 *  uses the same convention) so only a genuine same-kind hit counts, never a
 *  same-text-different-kind coincidence. First unambiguous hit wins; null when
 *  nothing of that class is named anywhere in the text (graph-less, empty
 *  text, or no match all decline the same honest way). Used ONLY by runAsk's
 *  pronoun-resolution kind-mismatch guard, below — never a general "search
 *  the last answer" utility. */
async function entityOfKindInText(graph, expectedClass, answerText) {
  if (!graph || !expectedClass || !answerText) return null;
  // "g" ONLY, never "gi" — NAME_TOKEN_RE's own case-SENSITIVITY is exactly
  // what makes it a safe code-ish-token signal (a Capitalized symbol / a
  // mid-word capital never occurs in plain English, per its own docblock
  // above); adding "i" here would let ordinary lowercase prose words
  // ("function", "is", "defined") spuriously match too (found live testing
  // this fix — a bare lowercase word matched the lowerCamelCase branch under
  // case-insensitivity, since [A-Z] there also accepts lowercase under /i).
  const tokens = String(answerText).match(new RegExp(NAME_TOKEN_RE.source, "g")) || [];
  const seen = new Set();
  for (const tok of tokens) {
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const { resolveObject } = await import("./ask.mjs");
      const r = resolveObject(graph, tok, { expectedClass });
      if (r?.match?.id && !r.ambiguous) return { id: r.match.id, label: r.match.label };
    } catch { /* tolerated — falls through to the next token */ }
  }
  return null;
}

/** A bare question → tmct_ask. When a focus is set AND the graph is in hand we
 *  call ask() directly to thread the focus as contextId (so a pronoun like "it"
 *  resolves to the focus) — building the SAME delimited string dispatchTool emits;
 *  otherwise the unchanged dispatchTool path (which also yields the no-graph error).
 *  A hit updates the focus to the resolved object. Grammar miss / ToolError → a
 *  normal answer, never a crash. */
async function runAsk(query, { config, source, graph, focus, last, templates, memoryDir, sessionId = "", lexicon = null, env, trace, vocabHint = null, tel = null, biasByBundle = {} }) {
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
  let askQuery = superlativeRepeatRewrite(query, last) ?? discourseRewrite(query, last)
    ?? existentialAnythingRewrite(query) ?? query;
  // IMPLICIT ANAPHORIC COUNT (Tier-2 playtest, 5th pass): "how many are tested" /
  // "and how many are tested" drops the "of those/them" a fuller phrasing carries
  // — ask()'s own anaphora node (parseAnaphora) already understands "how many of
  // those are tested" perfectly, it simply never SEES this elliptical spelling
  // (ANAPHORA_TRIGGERS requires an explicit pronoun). Insert the elided "of
  // those" here, the same way discourseRewrite rewrites "what about X" —
  // UNCONDITIONALLY (not gated on `prev.length`): a genuinely bare "how many
  // are tested" with no antecedent at all still reaches the anaphora node this
  // way, which itself honestly degrades to "needs a previous answer to refer
  // to" (evalAnaphora's own no-prev branch) — a strictly better outcome than
  // leaving the raw ellipsis unrewritten, which used to fall through to the
  // ordinary clause grammar and misparse "and" as the object ('no module
  // matching "and many" found').
  if (IMPLICIT_ANAPHORA_COUNT_RE.test(String(askQuery).trim())) {
    // Strip the leading connective too ("and how many are tested" -> "how many
    // of those are tested") — left in place, it breaks the anaphora node's own
    // AGGREGATE_TRIGGERS match on "how many" (anchored at the string start),
    // silently degrading the count into a bare list of the filtered set.
    askQuery = String(askQuery).trim()
      .replace(/^(?:and|so|then|also)\s+/i, "")
      .replace(/how many\s+/i, "how many of those ");
  }
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
  // C2 fix (BENCHMARK_CONVERSATION_1.7.0.md routed backlog): an explicit
  // "this file"/"that module" kind-noun scope signal is collapsed to a bare
  // pronoun by normalize.mjs's KIND_NOUN_ANAPHORA_RE before ask() ever parses
  // askQuery — so ask()'s own contextId-based pronoun resolution (just below)
  // would otherwise silently bind "this"/"that" to the STANDING focus even
  // when that focus is a narrower, different kind of thing than what was
  // explicitly named. Repro: "where is it defined" resolves to a FILE and
  // names it in the answer text; if the standing focus is still a Method,
  // "what this file is importing" must mean the file just named, not the
  // Method. Detected here via kindNounAnaphoraHint (a read-only probe of the
  // SAME askQuery text — normalizeQuery's own collapse inside ask() is
  // completely untouched) and rescued by swapping the CONTEXTID itself to a
  // matching-kind individual the immediately PRECEDING turn's own answer
  // already named — so the traversal ask() computes (not just the focus
  // carried to the NEXT turn, below) reflects the explicit scope. Only
  // diverts when the hint actively DISAGREES with the standing focus's real
  // class; falls back to today's untouched behavior (the stale focus stands,
  // or an honest miss) when nothing of the expected kind is named in the
  // preceding answer, so an ordinary "it"/"this" with no kind noun at all is
  // byte-identical to before this fix.
  //
  // Scoped tightly to expectedClass === "Module" ("this file"/"that file"/
  // "this module"/"that module") ON PURPOSE, not every KIND_NOUN_ANAPHORA_RE
  // kind: test/chatflow-tier1-single-touch.test.mjs's own T3 case ("which
  // class contains Task.complete" -> "what else is in that class") pins the
  // OPPOSITE behavior for "that class" — the standing Method focus (Task.
  // complete) is deliberately reused there, by design, even though "class"
  // names a different kind than Method too. "class"/"method"/"function"/
  // "attribute"/"variable"/"commit" are all colloquially used to mean "the
  // thing we were just discussing", which may genuinely BE the narrower
  // standing focus (T3's own case). "file"/"module" is the one kind noun in
  // this set that's never plausibly the SAME individual as a Method/
  // Function/Class/Attribute/GlobalVariable focus — it's strictly a
  // CONTAINER of them — so it alone is safe to treat as an unambiguous
  // kind-mismatch signal without breaking that pinned case. Widening this
  // beyond Module would need a real redesign (disambiguating "reuse the
  // narrower focus" from "switch to the just-named container" in general);
  // out of scope here — see the routed-backlog report for this session.
  let effectiveContextId = focus?.id ?? null;
  let kindRescueEnt = null;
  if (graph && focus?.id) {
    const expectedClass = kindNounAnaphoraHint(askQuery);
    const focusClass = graph?.byId?.get(focus.id)?.class;
    if (expectedClass === "Module" && focusClass && focusClass !== expectedClass) {
      kindRescueEnt = await entityOfKindInText(graph, expectedClass, last?.answer);
      if (kindRescueEnt?.id) effectiveContextId = kindRescueEnt.id;
    }
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
      const r = ask(graph, askQuery, { contextId: effectiveContextId, prev });
      text = `${r.content}${ASK_ENVELOPE_DELIM}${JSON.stringify(r.tmct_ask, null, 2)}`;
    } else {
      text = await dispatchTool("tmct_ask", { query: askQuery }, { config, source, tel });
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
  // STACCATO CONNECTIVE LEAKAGE (Tier-2 playtest, 6th pass, cycle 8, multi-hop
  // relation-touch chain stress-test): "and calls?" — the bare-connective
  // relation-chain continuation STACCATO_SWAP_RE/relationTermOf's own STACCATO
  // branch both recognize — is handed to ask() UNSTRIPPED as askQuery. When
  // ask()'s own raw grammar happens to recognize "calls" as a verb (VERB_TO_KIND),
  // the leftover "and" becomes parsed.object, and resolveObject's tier-3
  // substring match (`label.includes(tLc)`) has no minimum-length floor — a
  // 2-3 letter connective is a near-certain accidental substring of SOME real
  // label ("and" -> Controller.h-AND-le). The visible answer still looks fine
  // (relationForceAnswer, later, composes the correct generic relation text
  // over the SAME query) — but this block ran FIRST and silently rebound the
  // FOCUS to that bogus match, so the NEXT turn's pronoun ("what tests it")
  // resolved against the wrong entity and rendered a confidently WRONG empty
  // ("no tests cover it") for a module that genuinely has tests. The exact
  // same class of bug as CHATBENCH_0.7.1's "it" reuse-focus fix just below —
  // grammar scaffolding leaked into the object slot is never real content, so
  // (mirroring that fix's own discipline) any of the five closed connective
  // words STACCATO_SWAP_RE recognizes is excluded here from ever being resolved
  // as an object at all: the branch is skipped entirely, leaving the standing
  // focus untouched for the relation force (or ordinary miss) to answer over.
  const isLeakedConnective = STACCATO_LEAKED_CONNECTIVES.has(String(envelope?.parsed?.object || "").toLowerCase());
  if (graph && envelope?.parsed?.object && !isLeakedConnective) {
    const obj = envelope.parsed.object;
    // A PRONOUN object ("it"/"this") was already resolved against the focus via
    // contextId — the resolved antecedent IS the focus. Re-resolving the literal
    // pronoun string is the CHATBENCH_0.7.1 B1-pron bug: "it" substring-matches the
    // "Commit" schema node (label contains "it"), so the focus jumped off the module
    // to a Commit and the NEXT "it" bound wrong. Reuse the focus directly instead —
    // and when there is NO focus to reuse (Tier-2 playtest, 6th pass, cycle 8: a
    // bare "where is it defined"/"what does it import" with nothing standing yet,
    // or right after a superlative TIE, which deliberately never sets one — see
    // the superlative-winner branch below), never fall through to resolveEntity on
    // the raw pronoun string either: that is the EXACT SAME substring-match trap
    // (a 2-letter "it" is a near-certain accidental substring of SOME real label —
    // here, Task.t-IT-le) as STACCATO_LEAKED_CONNECTIVES fixes for "and"/"also"
    // above, just triggered by a pronoun instead of a connective. ask()'s OWN
    // evaluation already renders the honest "'it' needs a selected node…" miss in
    // this case (contextId was null); silently adopting a bogus focus as a side
    // effect here would corrupt the NEXT turn's pronoun into a confidently WRONG
    // (not just empty) answer, exactly as the connective leak did.
    //
    // C2 fix (BENCHMARK_CONVERSATION_1.7.0.md routed backlog): the blind
    // focus-reuse above is exactly right when the pronoun carries no extra
    // scope signal ("what does it import") — but "this file"/"that module"
    // EXPLICITLY names a kind, and normalize.mjs's KIND_NOUN_ANAPHORA_RE
    // already collapses it to the bare pronoun before either parse strategy
    // ever sees it, discarding that signal. `kindRescueEnt` (computed ABOVE,
    // before ask() ran, off the SAME askQuery text — see its own docblock)
    // already carries the matching-kind individual the preceding turn's
    // answer named, when the hint disagreed with the standing focus's class;
    // reusing it here (rather than recomputing) keeps the focus this turn
    // hands to the NEXT turn consistent with the traversal ask() actually
    // ran. Null when there was no disagreement, or nothing rescuable was
    // named — today's untouched behavior (reuse the focus / honest miss).
    const ent = isPronoun(obj) ? (kindRescueEnt || (focus?.id ? focus : null)) : await resolveEntity(graph, obj);
    if (ent) {
      resolvedIds = [ent.id];
      // Class-gate the focus update: a Commit/Session/schema object never displaces a
      // standing code-entity focus (see nextFocus).
      newFocus = nextFocus(graph, focus, ent);
      note(trace, `result: resolved object "${obj}" -> ${ent.label} (${ent.id}) — becomes the new focus`);
    } else if (!isPronoun(obj)) {
      note(trace, `intermediate: object "${obj}" did NOT resolve to a graph entity — this is why an otherwise-parsed query still misses`);
    }
  } else if (graph && envelope?.parsed?.node === "superlative" && Array.isArray(envelope?.matches) && envelope.matches.length === 1) {
    // A superlative ("which module has the most imports") names no object at all —
    // the branch above never runs — so the ranked WINNER never became the focus,
    // and an immediate natural follow-up ("what does it import", "where is it
    // defined") dead-ended on "'it' needs a selected node to refer to" right after
    // the engine had just named one. Mirrors the object-resolution rule above
    // exactly: a single, unambiguous winner (no tie — a multi-way tie names no
    // one individual, so the focus is left alone rather than guessing which of
    // the tied matches the user means) becomes the new focus, class-gated the
    // same way (nextFocus). Found in Tier 2 playtest, cycle 8 (superlative
    // follow-up chains, SKILL_CHAT_PLAYTEST.md).
    const winner = envelope.matches[0];
    if (winner?.id) {
      resolvedIds = [winner.id];
      newFocus = nextFocus(graph, focus, winner);
      note(trace, `result: superlative winner ${winner.label} (${winner.id}) — becomes the new focus`);
    }
  }
  const answeredIds = (envelope?.matches || []).map((m) => m?.id).filter(Boolean);
  const miss = envelope ? !!envelope.miss : true;
  // Answer provenance (W1): "composed" is the ask engine's productive band; the
  // orientation swap below is template wording, so those turns carry via:"template".
  let via = "composed";
  let recordMiss = miss;
  let factPending = null; // a truncated fact listing's held remainder (for "more" paging)
  // Trust-hook gap fix (this session): scm-svf1/cardinality-monotonicity/
  // cax-maxc0's LIVE proof chases (factReadBack) have no persisted Fact to
  // attach trust.mjs's entailed hook to (syllogise.mjs's own
  // CARDINALITY_RULE_CONFIDENCE/CAX_MAXC0_RULE_CONFIDENCE doc comments explain
  // why), so they compute `min(premiseTrusts) × ruleConfidence`
  // (`entailedTrustFrom`) themselves and hand it back on the answer object —
  // surfaced here onto the turn's own record (`record.entailedTrust` below)
  // so it is audit-observable from a real chat turn, not silently discarded.
  let entailedTrust = null;
  // GOAL DEDUCTION: from the parsed AST when one stood (deterministic, table-driven —
  // see deduceGoalFromParsed); a total grammar miss (no parse at all) gets the honest
  // "didn't resolve" goal line verbatim, matching the operator's own wording for that
  // case. Pushed once, EARLY (before the miss cascade below may go on to answer via a
  // completely different lane — an intent lane's own goal note, when it pushes one,
  // stays the more specific of the two since bucketTrace keeps every "goal:" line and
  // renderNarration shows them all, most-specific-last-written).
  //
  // FEATURE B: `deduced` (declared here, not block-scoped) also rides the
  // returned result as `goal` (see the return statement below) — the seam
  // withLast's withGoalLine reads to prepend the always-on, short "Goal
  // (inferred): …" line, independent of --narrate entirely. Deliberately the
  // SAME value the debug trace's own "goal:" line uses (one deduction, two
  // presentations) — null here (no parse stood at all) means withGoalLine
  // shows nothing, never a "Goal (inferred): unclear" line.
  // `let`, not `const`: the RELATION CONCEPT FORCE (relationForceAnswer, below)
  // can answer a turn CORRECTLY with no envelope.parsed at all to deduce from —
  // a staccato relation-chain continuation whose leading connective never
  // itself parses ("and inherits?": ask()'s raw grammar has no production for
  // a bare relation word with no verb, exactly like the "cochange" vague-touch
  // gap composeRelation's own degrade fix addressed) still reaches the SAME
  // relation force a normally-parsed "what about inherits" would. Tier-2
  // playtest cycle 9, the Goal-line gap cycle 8 flagged: the answer content
  // was always correct here — only the cosmetic trailing "Goal (inferred): …"
  // line went missing, because it was computed once, this early, straight off
  // envelope.parsed and never revisited even when a LATER lane went on to
  // answer the turn through a completely different path. Reassigned at the
  // relation-force call site below (never overwritten with something worse:
  // only filled in from the SAME GOAL_BY_KIND table deduceGoalFromParsed
  // itself already uses for a normally-parsed relation query, so the two
  // never disagree on the cases where both would fire).
  let deduced = deduceGoalFromParsed(envelope?.parsed);
  note(trace, `goal: ${deduced ?? "unclear — the phrasing didn't resolve to a known query shape"}`);
  // MISS handling. The intent lanes + short-miss are RECOGNIZER-gated on the query
  // text AND only consulted on a would-miss, so a real graph query — a hit, an honest
  // empty with a receipt, a fuzzy repair — is never hijacked. Order: (1) META/SELF
  // lane (would-miss), (2) conversational orientation (would-miss), (3) memory
  // facts/recall (a fact EXTENDS a non-miss schema hit too — NOT miss-gated),
  // (4) TEACH lane (would-miss), (5) the short tailored miss (would-miss).
  let handled = false;
  // (0) BUG 1 fix (2026-07-09): "what else is X" — recognized off the RAW
  // query text, before every other lane below (all of which read `envelope`,
  // already relaxed/reparsed by ask()'s own noise-strip cascade — "else" is
  // exactly the kind of unmatched token that cascade silently drops, which is
  // why a plain factAnswer/curatedDefinitionAnswer lookup used to answer
  // "what else is X" with the byte-identical primary definition, as if
  // repeating it were new information). via is set to a value NONE of the
  // downstream `via === "composed"/"fact"/"corpus/seon"` gates match, so a
  // hit here is final — curatedDefinitionAnswer/conceptForceAnswer never get
  // a chance to re-answer with the same primary definition afterward.
  if (memoryDir) {
    const whatElse = await whatElseAnswer(memoryDir, query, last);
    if (whatElse) {
      answer = whatElse.text; via = "fact:what-else"; recordMiss = false; handled = true;
      if (whatElse.pending) factPending = whatElse.pending;
      deduced = "surface additional remembered facts beyond the primary definition";
      note(trace, "lane: (0) WHAT ELSE — \"what else is/about X\" recognized off the raw query, before the relaxation cascade could quietly drop \"else\" and reduce it to a plain \"what is X\"");
      note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
      note(trace, `goal: ${deduced} (revised — the raw \"what else\" phrasing was recognized directly, not the relaxed/reparsed envelope)`);
    }
  }
  // (1) #2 META/SELF: bare self/session questions ("what do you know", "what is this
  // codebase", "how do i start") → a summary / orientation, answered before the
  // fact-dump readers so "what do you know" gets a summary, not raw facts.
  if (miss) {
    const meta = await metaLane(query, { graph, memoryDir, last, templates, vocabHint, focus });
    if (meta) {
      answer = meta.text; via = meta.via; recordMiss = false; handled = true;
      note(trace, `lane: (1) META/SELF — bare self/session question recognized, answered via="${meta.via}"`);
    }
  }
  // "what about X" with a genuine PRIOR turn to continue (0.9.13 Tier-1 playtest)
  // is exempt from the conversational catch-all even when short/non-codeish
  // ("what about that", "what about Task" — no dotted/camel token, ≤3 words):
  // isConversational() can't see that ask() ALREADY tried discourseRewrite above
  // and that the describe-wrapper rescue (4d) hasn't had its turn yet — without
  // this exemption, EVERY "what about X" continuation whose prior turn was itself
  // a describe-shaped question (discourseRewrite can't rewrite "describe X", so it
  // always misses) or whose swapped-in subject is a bare Capitalized/pronoun term
  // fell straight to the generic orientation card instead of reaching (4d).
  // Same exemption for the bare-connective sibling shape ("and Widget?", "also
  // app/lib/b.mjs" — no "about" at all, STACCATO_SWAP_RE above), gated the
  // SAME way discourseRewrite gates it: the swapped-in word must itself be
  // unambiguously code-ish, so ordinary discourse ("and then?", "so what")
  // never trips this exemption.
  const staccatoSwapMatch = String(query).match(STACCATO_SWAP_RE);
  const isStaccatoSwap = !!(last?.query && staccatoSwapMatch && NAME_TOKEN_RE.test(staccatoSwapMatch[1]?.trim() || ""));
  const isWhatAboutContinuation = !!(last?.query && WHAT_ABOUT_RE.test(String(query))) || isStaccatoSwap;
  // Same exemption for the sibling shape "describe it"/"tell me about that"
  // (0.9.13 Tier-1 playtest): a bare-pronoun describe/tell-me-about is exactly
  // as short and non-codeish as "what about it", and needs the SAME deferral to
  // reach describeWrapperAnswer's now-focus-aware pronoun resolution (4d) —
  // WITHOUT this, "describe Widget" -> "describe that" (a natural drill-down
  // re-ask) fell to the orientation card even though the standing focus made it
  // perfectly answerable. Gated on an actual standing focus, same honest-decline
  // discipline as describeWrapperAnswer itself.
  const describeWrapperMatch = DESCRIBE_WRAPPER_RE.exec(String(query).trim()) || STACCATO_PRONOUN_RE.exec(String(query).trim());
  const isDescribePronounContinuation = !!(focus?.label && describeWrapperMatch && DESCRIBE_PRONOUN_RE.test(describeWrapperMatch[1]?.trim() || ""));
  // A bare/wrapped "explain X" (0.9.14 Tier-2 playtest, second pass) needs the
  // SAME deferral, and for a stronger reason than the two above: "explain"
  // isn't a VERB_TO_KIND word at all, so ask() never even ATTEMPTS a parse
  // (envelope.parsed is null unconditionally for this shape, not merely on a
  // miss) — a short "explain cochange" (2 words) or politeness-wrapped
  // "please explain cochange" (3 words) always trips isConversational's ≤3-
  // word heuristic and never once reaches the relation/concept force below,
  // which is squarely built to answer exactly this shape. Unlike the two
  // exemptions above, this one needs no prior-turn/focus context — "explain
  // X" is a complete, self-contained ask on its own.
  const isExplainTouch = EXPLAIN_TOUCH_RE.test(String(query).trim());
  // Staccato negation ("not that one", "not Widget then" — Tier-2, 5th pass)
  // needs the SAME deferral: "not those" (2 words) / "not that one" (3 words)
  // both trip isConversational's ≤3-word catch-all before nudgeAnswer's own
  // STACCATO_NEGATION_RE branch (4c, below) ever gets a turn. Gated on the
  // shape alone (not a focus/prev precondition) — nudgeAnswer's negation
  // branch ALWAYS returns a tailored nudge for this shape, never null, so
  // deferring here never strands the turn with nothing having claimed it.
  const isStaccatoNegation = STACCATO_NEGATION_RE.test(String(query).trim());
  // Staccato comparative ("more than that", "which is bigger", "is there
  // anything bigger" — Tier-2 playtest, 6th pass, cycle 8) needs the SAME
  // deferral, for the SAME reason as isStaccatoNegation just above: these are
  // short/non-codeish and trip isConversational's ≤3-word catch-all before
  // nudgeAnswer's own STACCATO_COMPARATIVE_RE branch ever gets a turn.
  // nudgeAnswer's comparative branch ALWAYS returns a tailored nudge for this
  // shape, never null, so deferring here never strands the turn unclaimed.
  const isStaccatoComparative = STACCATO_COMPARATIVE_RE.test(String(query).trim());
  // A bare STACCATO PRONOUN continuation ("also that one?", "and it") with NO
  // standing focus (Tier-2 playtest, 6th pass, cycle 8) needs the SAME deferral:
  // nudgeAnswer's own STACCATO_PRONOUN_RE-no-focus branch (just above) ALWAYS
  // returns a tailored nudge for this exact shape, never null, so deferring
  // here never strands the turn unclaimed — see that branch's own docblock for
  // why the no-focus case must never reach the generic orientation card.
  const isStaccatoPronounNoFocus = STACCATO_PRONOUN_RE.test(String(query).trim()) && !focus?.label;
  // A vague relation touch ("what about cochange", "tell me about cochange",
  // the staccato chain continuation "and cochange?") whose relation word has NO
  // bare single-word VERB_TO_KIND form of its own needs the SAME deferral as
  // isExplainTouch just above, for the identical reason: "cochange" is the one
  // relation (ask-vocab.mjs RELATIONS.cochange) whose every registered verb
  // phrase takes a preposition ("changed WITH X", "changes together WITH X") —
  // there is no bare "cochanges X" — so ask() never gives this shape a parse to
  // hang envelope.parsed off of, unlike its siblings (imports/calls/tests/
  // inherits/contains/defines/touches/reexports all have a bare verb and so
  // already escape isConversational's ≤3-word catch-all via envelope.parsed).
  // 0.9.16 Tier-2 playtest, 6th pass: "what about cochange" as an opening turn,
  // and "and cochange?" as a mid-chain continuation after a working "what about
  // tests", both fell straight to the generic orientation card even though the
  // graph has real cochange edges and every sibling relation word already
  // flowed. Needs no prior-turn/focus context either (same as isExplainTouch) —
  // scoped to the CLOSED RELATION_TERM vocabulary (concept.mjs) via
  // relationTermOf's own gate, so an unknown word or a real entity name still
  // declines and isConversational's catch-all is untouched for it.
  let isVagueRelationTouch = false;
  {
    const relTerm = relationTermOf(String(query), envelope);
    if (relTerm) {
      try {
        const { RELATION_TERM } = await import("./concept.mjs");
        isVagueRelationTouch = !!RELATION_TERM[relTerm.toLowerCase()];
      } catch { /* leave false — the ordinary path decides */ }
    }
  }
  const isConversationalCandidate = !handled && miss && !envelope?.parsed && isConversational(query) && !isWhatAboutContinuation && !isDescribePronounContinuation && !isExplainTouch && !isStaccatoNegation && !isVagueRelationTouch && !isStaccatoComparative && !isStaccatoPronounNoFocus;
  // BUG 2 fix (2026-07-09): "what is X" with NO article ("what is john") is BOTH
  // conversational-shaped (≤3 words, no code-ish token — isConversational() would
  // claim it) AND a legitimate bare meta/fact-lookup form (BARE_WHATIS_RE —
  // metaTermOf's own docblock explains why the article is safe to make optional on
  // this fact-lookup path specifically). Root cause: grammar.mjs's T5 template
  // requires the article, so envelope.parsed stays null for the bare form — which
  // is exactly isConversationalCandidate's own `!envelope?.parsed` gate — so
  // isConversational used to win the race unconditionally, and a freshly taught
  // "john is a function" fact became invisible the moment its own subject was
  // asked back about bare ("what is john" fell to the generic capability-
  // orientation card, byte-identical to asking about a term tmct had never heard
  // of). Diverts ONLY when a REAL fact actually resolves for the bare term —
  // never a speculative reroute: a bare "what is up"/"what is wrong" with nothing
  // behind it falls straight through to the SAME orientation card as before,
  // exactly like every other isConversationalCandidate exemption above (each one
  // guarantees a real answer before it defers, never stranding the turn on a
  // worse outcome — see isStaccatoPronounNoFocus's own docblock for the same
  // discipline).
  // Tier-5 playtest fix (this session): "is it deprecated" is EXACTLY the same
  // race BUG 2 (above) fixed for "what is john" — 3 words, no code-ish token,
  // so isConversationalCandidate would otherwise win unconditionally and a
  // just-taught property fact ("logger module is deprecated") becomes
  // unreachable the moment it's asked back about with a short pronoun/bare
  // form ("is it deprecated" / "is the logger deprecated"). Widened the SAME
  // divert-only-on-a-real-hit gate to also try IS_ADJECTIVE_YESNO_RE shapes —
  // factAnswer itself declines for this shape (no metaTerm), so the only
  // change in practice is that factReadBack's (a2c) property lane gets a
  // chance to run before the orientation card claims the turn.
  const bareWhatisShape = BARE_WHATIS_RE.test(String(query).trim());
  const isAdjectiveShape = IS_ADJECTIVE_YESNO_RE.test(String(query).trim());
  let bareMetaHit = null;
  if (isConversationalCandidate && (bareWhatisShape || isAdjectiveShape)) {
    if (memoryDir) {
      bareMetaHit = (await factAnswer(memoryDir, query, envelope, miss, biasByBundle))
        ?? (await factReadBack(memoryDir, query, envelope, miss, graph, newFocus?.label, biasByBundle));
      // HANDOVER.md 2026-07-10 item 10 (dropped-article gap): a bare "what is X"
      // with NO taught fact but a KNOWN curated corpus term ("what is cache", no
      // article) used to lose this exact same isConversationalCandidate race —
      // curatedDefinitionAnswer was only ever reached once the article made T5's
      // structural parse succeed (envelope.parsed non-null), never on the bare
      // form. Same "only diverts on a REAL hit" discipline as the rest of this
      // lane — an unknown bare term still falls through to the ordinary
      // orientation card, exactly as before.
      if (!bareMetaHit) {
        const def = await curatedDefinitionAnswer(query, envelope, { memoryDir, lexicon });
        if (def) bareMetaHit = { text: def.text, replace: true };
      }
    }
    // HANDOVER.md 2026-07-10 item 6 (CHATBENCH g-a2-naming-2: "what is Widget",
    // no article): a bare "what is X" naming a REAL code-graph entity (Class/
    // Function/Method/GlobalVariable/Attribute — not a taught fact, not a
    // curated corpus term) lost this SAME isConversationalCandidate race too.
    // metaFallbackEntityAnswer (ask.mjs) is the exact fallback the ARTICLED
    // form's structural parse already reaches once T5 succeeds; tried here so
    // the bare form gets the byte-identical answer, never a worse one just
    // because it dropped the article. Deliberately OUTSIDE the `memoryDir`
    // check above — this is a pure graph lookup, no memory/Facts access
    // needed, and CHATBENCH's own "turns" replay mode drives runTurn with a
    // graph but no memoryDir at all, so gating this on memoryDir too would
    // silently never fire in the one harness this fix specifically targets.
    if (!bareMetaHit && graph) {
      const term = metaTermOf(query, envelope);
      if (term) {
        const { metaFallbackEntityAnswer } = await import("./ask.mjs");
        const fallback = metaFallbackEntityAnswer(graph, term);
        if (fallback) bareMetaHit = { text: fallback.text, replace: true };
      }
    }
  }
  // (2c) BARE ENTITY NAME, NO VERB AT ALL (persona-sweep 2026-07-11, Priority
  // 4): "task" / "usercontroller" — a bare, unadorned word naming a REAL
  // class/function/method/global/attribute, with no "what is"/"describe"
  // wrapper for bareWhatisShape/isAdjectiveShape (just above) to catch —
  // isConversational()'s <=3-word catch-all claims it first, same race BUG 2
  // fixed for "what is john" above, just one layer short of even a bare
  // "what is". Reuses the SAME metaFallbackEntityAnswer lookup and the SAME
  // "divert only on a REAL, UNIQUE hit" discipline: it only ever returns
  // non-null for an EXACT case-insensitive Class/Function/Method/
  // GlobalVariable/Attribute label match, so an ordinary greeting/small-talk
  // word that doesn't happen to collide with a real graph entity name is
  // completely unaffected — this can only ever ADD a real describe-style
  // answer, never take one away or guess.
  if (!bareMetaHit && isConversationalCandidate && graph) {
    const { metaFallbackEntityAnswer } = await import("./ask.mjs");
    const fallback = metaFallbackEntityAnswer(graph, String(query).trim());
    if (fallback) bareMetaHit = { text: fallback.text, replace: true };
  }
  if (bareMetaHit) {
    answer = bareMetaHit.replace ? bareMetaHit.text : `${answer}\n${bareMetaHit.text}`;
    via = "fact"; recordMiss = false; handled = true;
    if (bareMetaHit.pending) factPending = bareMetaHit.pending;
    note(trace, "lane: (2b) BARE META FACT — \"what is X\" (no article) / \"is X <adjective>\" resolved to a remembered fact before the conversational catch-all could claim it");
    note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
  } else if (isConversationalCandidate) {
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
    const fact = (await factAnswer(memoryDir, query, envelope, miss, biasByBundle))
      ?? (await factReadBack(memoryDir, query, envelope, miss, graph, newFocus?.label, biasByBundle));
    if (fact) {
      answer = fact.replace ? fact.text : `${answer}\n${fact.text}`;
      via = "fact";
      recordMiss = false;
      if (fact.pending) factPending = fact.pending; // a truncated fact list → paginable remainder
      if (typeof fact.trust === "number") entailedTrust = fact.trust; // scm-svf1/cardinality/cax-maxc0's live-chase trust (see the `entailedTrust` declaration above)
      note(trace, `lane: (3) memory facts — factAnswer/factReadBack matched (memoryDir=${memoryDir})`);
      note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
      // Goal-line fix (item 5 follow-up, this session): mirrors the TEACH lane's
      // own goal revision just below (Bug 3 point 4) — `deduced` was computed
      // WAY above off envelope.parsed alone, but a general-verb direct question
      // ("does margo eat ribs") never parses as a structural graph query at all,
      // so it either landed on an unrelated GOAL_BY_KIND guess or nothing.
      if (fact.generalVerbQuery) {
        deduced = "look up a taught fact about a subject/verb/object";
        note(trace, `goal: ${deduced} (revised — a general-verb direct-question fact lookup answered this turn)`);
      }
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
        // Goal-line gap fix (Tier-2 playtest cycle 9): this force just answered
        // the turn CORRECTLY over a query shape ask()'s own grammar may never
        // have parsed at all (a staccato relation-chain continuation whose
        // leading connective never itself parses, "and inherits?") — `deduced`
        // was computed way above, off envelope.parsed alone, and would
        // otherwise stay null forever here even though the answer is real.
        // relation.kind is the SAME GOAL_BY_KIND vocabulary a normally-parsed
        // relation query already deduces its goal line from, so this can never
        // disagree with the ordinary path on a case where both would fire.
        if (relation.kind && GOAL_BY_KIND[relation.kind]) {
          deduced = GOAL_BY_KIND[relation.kind];
          note(trace, `goal: ${deduced} (revised — the relation concept force answered where the raw parse never stood)`);
        }
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
      // Goal-line fix (Bug 3 point 4, 2026-07-09): `deduced` was computed WAY
      // above, straight off envelope.parsed alone (deduceGoalFromParsed) —
      // the structural grammar has no business parsing a teach-shaped
      // sentence at all ("remember tony has a hat" isn't a code-graph
      // question), so whatever it landed on there was either confidently
      // WRONG (a stray structural template matched part of the sentence and
      // deduced an unrelated GOAL_BY_KIND entry, e.g. "locate what a
      // module/class defines") or silently absent (no parse stood). Every
      // successfully-RECOGNIZED teach attempt (`taught` stood — whether it
      // went on to STORE or to its own honest teach-miss text) gets the SAME
      // honest, consistent goal line here instead — the same "revise off the
      // LANE that actually answered, not the raw structural parse"
      // discipline the relation-force fix above already uses.
      deduced = "teach/remember a new fact";
      note(trace, `goal: ${deduced} (revised — the teach lane recognized this shape where the raw structural parse never should have)`);
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
    const nudged = nudgeAnswer(query, newFocus, vocabHint);
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
    const described = await describeWrapperAnswer(query, { config, source, focus: newFocus, graph, tel });
    if (described) {
      answer = described.text; via = "describe"; recordMiss = false;
      note(trace, "lane: (4d) DESCRIBE-WRAPPER RESCUE — a polite wrapper around \"describe/tell me about <symbol>\" resolved via /describe, tried last after every other lane declined");
      note(trace, "goal: get a symbol's definition/kind/relations (phrased conversationally)");
      // Round 1 playtest fix: carry the resolved entity forward as the new focus,
      // same class-gated nextFocus() every other resolution path here already uses
      // — otherwise "what calls it" right after this answer dead-ends on "'it'
      // needs a selected node to refer to" despite one having just been named.
      if (described.ent) {
        resolvedIds = [described.ent.id];
        newFocus = nextFocus(graph, newFocus, described.ent);
        note(trace, `result: describe-wrapper resolved "${query}" -> ${described.ent.label} (${described.ent.id}) — becomes the new focus`);
      }
    }
  }
  // (4e) COMPLETIONS RESCUE (HANDOVER.md 2026-07-10 item 7) — wires src/completions/'s
  // extractive multi-sentence pipeline in as a genuine last-resort lane, tried ONLY
  // here, after EVERY lane above (including (4d) DESCRIBE-WRAPPER RESCUE) has already
  // declined — "describe X"/"tell me about X" must keep reaching describeWrapperAnswer's
  // (or the relation force's) single-answer rescue unmolested; this lane only fires for
  // an EXPLICIT "detailed summary/overview of how X works" phrasing
  // (DETAILED_HOW_WORKS_RE/DETAILED_OVERVIEW_RE), a shape neither DESCRIBE_WRAPPER_RE
  // nor vagueTouchTermOf recognizes. PLAYTESTBENCH_1.4.1.md round 3's own
  // architecturally-confirmed gap: this exact phrasing hit the plain grammar wall with
  // no inferred goal at all, even though the pipeline that could answer it already
  // existed — it was simply unreachable from any real chat turn.
  if (miss && recordMiss && via === "composed") {
    const completed = await completionsRescueAnswer(query, { memoryDir, graph });
    if (completed) {
      answer = completed.text; via = "completion"; recordMiss = false;
      note(trace, "lane: (4e) COMPLETIONS RESCUE — a \"detailed summary/overview of how X works\" phrasing matched, answered via src/completions/'s extractive multi-sentence pipeline (generateCompletion())");
      note(trace, "source: src/completions/complete.mjs generateCompletion() (broadSearch + groupHits + rankSentences + inferRelations + pruneCompletion + finish())");
      note(trace, "goal: produce a grounded, cited, multi-sentence account of the subject (not a single fact/definition)");
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
  // TEACH-OFFER (Tier-5 playtest, this session) — SKILL_CHAT_PLAYTEST.md §0
  // names "'X' isn't a term in this graph's own vocabulary" as its own
  // dead-end example, and Tier 5 (§3) explicitly wants "the honest 'I don't
  // know that yet' that offers to learn" rather than a bare wall. A "what is
  // X" miss where X is genuinely unknown EVERYWHERE — not a real graph entity
  // (resolveEntity), not a schema/vocab term (that's what "still standing
  // miss" already means here), and not already in memory (checked directly,
  // not via factAnswer's OWN metaTerm branch, so this never duplicates its
  // more specific "no X facts about Y" miss) — gets a short offer appended
  // UNDER the existing miss text, never replacing it (every pinned assertion
  // on the miss wording elsewhere stays intact; this is purely additive, the
  // same discipline the corpus aside (W5) and empty-graph polish above use).
  if (recordMiss && (via === "composed" || via === "miss") && memoryDir) {
    // Tier-5 playtest fix (cycle 3): "what do you know about X" is its OWN
    // sibling shape — checked FIRST (and, unlike metaTermOf below, without a
    // resolveEntity(graph) gate): it's inherently a MEMORY question, not a
    // graph-structure one, so "nothing yet, teach me" is appropriate even
    // when X also happens to be a real graph entity — there's no genuinely
    // BETTER answer path to defer to the way "what is X" has (the concept
    // force, schema docs, …). Found live: "what do you know about the last
    // commit" (nothing in memory, and the whole sentence never fits ask.mjs's
    // grammar either) fell to the raw wall, unguided.
    const knowAboutTerm = String(query).trim().match(KNOW_ABOUT_RE)?.[1]?.trim();
    const offerTerm = knowAboutTerm || metaTermOf(query, envelope);
    if (offerTerm) {
      let normFactTerm;
      try { ({ normFactTerm } = await import("./memory/core.mjs")); } catch { normFactTerm = null; }
      if (normFactTerm) {
        const cleanTerm = normFactTerm(offerTerm);
        const ent = knowAboutTerm ? null : await resolveEntity(graph, offerTerm);
        if (!ent) {
          const variants = factTermVariants(normFactTerm, offerTerm);
          const known = (await memoryFacts(memoryDir)).some((f) => variants.has(f.subject) || variants.has(f.object));
          if (!known) {
            answer = `${answer}\n${unknownVocabTermOffer(cleanTerm)}`;
            note(trace, `intermediate: TEACH-OFFER — "${cleanTerm}" is unknown to both the graph and memory, so the miss got an offer to learn appended`);
          }
        }
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
  const record = {
    type: "turn", ts, query, via, resolvedIds, answeredIds: finalAnsweredIds, miss: recordMiss,
    // PLAN_BREADTH_FIRST_NLU.md §Track 6 (operator directive): the canonical
    // restatement of what the request was understood to mean — English gloss +
    // machine-parsable notation — straight off ask.mjs's own `tmct_ask.canonical`
    // (canonicalOf(parsed), §1's same `parsed` this whole ask-lane already
    // carries). `null` only when nothing parsed at all (an honest grammar miss).
    canonical: envelope?.canonical ?? null,
    // premise-derived trust for a LIVE-CHASE-ONLY entailment answer (scm-svf1/
    // cardinality-monotonicity/cax-maxc0 — see the `entailedTrust` declaration
    // above); omitted entirely when this turn didn't answer via one of those,
    // so every other turn's record shape stays byte-identical.
    ...(entailedTrust !== null ? { entailedTrust } : {}),
  };
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
  // MULTI-HOP STACCATO CHAIN CONTINUATION (Tier-2 playtest, 5th pass): when
  // discourseRewrite actually substituted a new subject into the PRIOR
  // query's shape ("and Widget?" -> "what calls Widget") and the rewritten
  // query STRUCTURALLY PARSED (envelope.parsed stood — a real AST, whether it
  // went on to a hit or an honest empty; "miss" in this engine's own
  // convention covers BOTH a genuine grammar failure AND a structurally valid
  // empty result, so `recordMiss` alone can't distinguish them here), thread
  // the RECONSTRUCTED positive query forward as the effective `last.query`
  // the NEXT turn's own discourseRewrite reads — not the raw staccato text
  // itself. Without this, a 3rd staccato swap in a row ("what calls X" ->
  // "and Widget?" -> "and Button?") tried to rewrite off "and Widget?" (the
  // 2nd turn's own verbatim staccato input, which has no clause shape of its
  // own), corrupting the 3rd swap into a nonsense re-ask ("and Button?" with
  // "Widget" replaced by "Button" — never a real query) instead of correctly
  // continuing from "what calls Widget". The verbatim text stays on
  // `record.query`/the transcript untouched; only the swap-chain
  // CONTINUATION base changes.
  const effectiveQuery = (askQuery !== query && envelope?.parsed) ? askQuery : null;
  // `goal` (Feature B): the SAME deduced string the debug trace's own "goal:"
  // line carries (deduced above, right after envelope resolution) — null when
  // deduceGoalFromParsed found no genuine query shape to bucket on, which is
  // exactly withGoalLine's own "say nothing" signal. Only runAsk ever sets
  // this field (plainTurn/runCommand results never carry it), so the always-on
  // goal line is scoped to real ask-engine turns by construction — a count, a
  // slash-command or a teach confirmation never grows one.
  return { answer, logLines, record, focus: newFocus, detail, effectiveQuery, goal: deduced };
}

/** A non-ask, non-dispatch chat turn (count answer, /stats) — the same
 *  { answer, logLines, record, focus } shape, recorded like any other turn. */
function plainTurn(query, answer, { command, via = "composed", miss = false, focus = null, canonical = null } = {}) {
  const ts = new Date().toISOString();
  return {
    answer,
    logLines: [ts, `> ${query}`, answer, ""],
    record: {
      type: "turn", ts, query, ...(command ? { command } : {}), via, resolvedIds: [], answeredIds: [], miss,
      // PLAN_BREADTH_FIRST_NLU.md §Track 6 (operator directive) — see runAsk's own
      // `record.canonical` for the full doc; `null` here is the honest default for
      // every non-ask/non-assert lane this shared helper serves (a bare command
      // confirmation, an orientation card, a count) that hasn't been given a real
      // structured form to restate yet.
      canonical,
    },
    focus,
  };
}

// Bug F point 5 (operator's explicit, most important ask this round): a
// command name -> a short, honest one-line goal string, mirroring GOAL_BY_KIND's
// own spirit (above) — but for COMMAND dispatches (find/search/describe/…)
// instead of ask()-parsed relation queries, so "I want you to search for
// Widget" (now reachable via a slash command per Bug F point 3) ALSO gets a
// real "Goal (inferred): …" line instead of none at all, generalizing the
// existing mechanism exactly as asked. Reuses GOAL_BY_KIND's EXISTING wording
// verbatim wherever a command's intent overlaps one of those kinds (members/
// subclasses reuse contains/inherits's own phrasing; callers/callees reuse
// calls's; tests/untested reuse tests's; history reuses touches's; exports
// reuses reexports's) — never invents new phrasing for the same concept. A
// command not worth a bespoke entry (help/stats/memory/focus/narrate/unknown)
// falls back to a short generic line in mk() itself, below.
const GOAL_BY_COMMAND = {
  find: "locate a specific named entity",
  search: "locate a specific named entity",
  context: "gather the sized edit bundle for a symbol before changing code",
  snippet: "view a symbol's exact source",
  describe: "look up a symbol's definition and relations",
  signature: "view a symbol's signature",
  members: GOAL_BY_KIND.contains,
  subclasses: GOAL_BY_KIND.inherits,
  impact: "understand what a change to this module would reach (impact closure)",
  callers: GOAL_BY_KIND.calls,
  callees: GOAL_BY_KIND.calls,
  tests: GOAL_BY_KIND.tests,
  untested: GOAL_BY_KIND.tests,
  history: GOAL_BY_KIND.touches,
  exports: GOAL_BY_KIND.reexports,
  arch: "understand the overall architecture (package/module boundaries)",
};

/** A slash-command → the mapped tool (or the /help, /focus, /narrate, unknown
 *  cases). Returns the same { answer, logLines, record, focus } shape as
 *  runAsk; the record carries the command name and the resolved entity id
 *  (for entity commands) so a slash-command turn becomes asksAbout graph data
 *  wherever it resolves an entity. `ctx.trace` (narrate mode, or undefined
 *  when off) gets one "goal:"/"lane:" note per branch — a slash-command's
 *  "decision" is simply which command+tool ran, so this is intentionally
 *  lighter than runAsk's miss-cascade instrumentation. Also carries a `goal`
 *  field now (Bug F point 5) — mirrors runAsk's own `goal` field so
 *  withGoalLine's short "Goal (inferred): …" line fires for command
 *  dispatches too, not just ask()-parsed queries. */
async function runCommand(line, { config, source, graph, focus, memoryDir, trace, narrate = false, tel = null, biasByBundle = {} }) {
  const ts = new Date().toISOString();
  const sp = line.indexOf(" ");
  const name = (sp === -1 ? line.slice(1) : line.slice(1, sp)).toLowerCase();
  const argText = (sp === -1 ? "" : line.slice(sp + 1)).trim();
  const mk = (answer, { resolvedIds = [], miss = false, newFocus = focus, narrateNext } = {}) => ({
    answer,
    logLines: [ts, `> ${line}`, answer, ""],
    record: { type: "turn", ts, query: line, command: name, via: "command", resolvedIds, answeredIds: [], miss },
    focus: newFocus,
    goal: GOAL_BY_COMMAND[name] || "use a specific tool/command directly",
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
  // Tier 6 playtest: a bare English "describe the logger module"/"describe the
  // Task class" is short enough (≤3 tokens, no query connective) that
  // asBareCommand (above) already rewrote it into a literal slash command
  // BEFORE this function ever sees it — so describeGrainRescue's OWN lane
  // (describeWrapperAnswer) never runs for this exact shape; the rescue has to
  // happen HERE too, on the raw command argument, before it reaches
  // dispatchTool's resolveSymbol (which has no article/grain-word tolerance).
  if (entityArg && value) {
    const rescued = await describeGrainRescue(graph, value);
    if (rescued?.label) {
      note(trace, `intermediate: "${value}" carries a grain word -> resolved to ${rescued.label} before dispatch`);
      value = rescued.label;
    }
  }
  if (spec.arg && !spec.optional && !value) {
    const need = entityArg ? `${spec.arg} (none given and no focus set — /focus <x> or pass one)` : spec.arg;
    return mk(`/${name} needs a ${need}.`, { miss: true });
  }

  let answer;
  try {
    answer = await dispatchTool(spec.tool, spec.arg ? { [spec.arg]: value } : {}, { config, source, tel });
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
        const facts = await describedFacts(memoryDir, ent.label, biasByBundle);
        if (facts) { answer = `${answer}\n${facts}`; note(trace, "source: memory facts (describedFacts) appended to the code-map answer"); }
      }
      return mk(answer, { resolvedIds: [ent.id], newFocus: nextFocus(graph, focus, ent) });
    }
    note(trace, `intermediate: "${value}" did not resolve to a single entity — the tool's own (unresolved) answer stands`);
  }
  return mk(answer);
}

/** Render an ambiguous assertTurn's response — Step 3 of
 *  PLAN_DID_YOU_SEE_HER_DUCK.md's "handle ambiguity all the way to the
 *  response": restate the operator's ask as canonical, disambiguated prose
 *  FIRST, then present EVERY surviving reading's would-be triples, each
 *  labeled by which token that reading reads as the verb — reusing the same
 *  "${subject} ${predicate} ${object}" shape assertTurn's own confirmation
 *  line already uses (below), and the same "this could mean more than one
 *  thing" wording ask.mjs's OWN disambiguation surface uses for query-side
 *  ambiguity (renderCore, src/ask.mjs), so the two never disagree in tone.
 *  Nothing is written to memory here — an ambiguous sentence, unlike a
 *  resolved one, has no single fact tmct can honestly commit to. */
function renderAmbiguousAssert(line, ambiguous, normFactTerm) {
  const options = ambiguous.readings.map((r, idx) => {
    const shown = r.triples
      .map((t) => `${normFactTerm(t.subject)} ${t.predicate} ${normFactTerm(t.object)}`)
      .join("; ");
    return `${idx + 1}) reading "${r.verbLemma}" as the verb: ${shown}`;
  });
  return [
    `You asked: "${line}" — this could mean more than one thing:`,
    ...options,
    "Nothing was remembered yet — reply with the reading you meant (or rephrase) and I'll note it.",
  ].join("\n");
}

/** A declarative ACE-grammar sentence → assert into memory + confirm; null on
 *  any grammar miss / residue / import failure so the query engine keeps first
 *  refusal on everything else. Lazy imports + catch-all: the grammar layer can
 *  never crash a turn (chat.mjs ethos). Writes ONLY under memoryDir/.tmct/memory.
 *
 *  AMBIGUITY (Step 3, PLAN_DID_YOU_SEE_HER_DUCK.md): checked FIRST, via the
 *  additive parseAceAmbiguous (grammar/ace.mjs) — a separate, breadth-first
 *  scan that survives every verb-position split rather than committing to the
 *  first, pruning only genuine dead ends. It returns null for the
 *  overwhelming majority of sentences (anything not relation-shaped, or
 *  relation-shaped with 0-1 surviving readings), so this adds exactly one
 *  cheap check ahead of the EXISTING, unchanged parseAce path below — every
 *  single-reading sentence renders byte-identically to before. */
async function assertTurn(line, { memoryDir, sessionId, focus, lexicon = null }) {
  try {
    const { parseAce, parseAceAmbiguous } = await import("./grammar/ace.mjs");
    // A session handle carries its own loaded lexicon (createSession loads it once);
    // a bare runTurn (no handle) lazy-loads the cached core lexicon. The lexicon is
    // immutable, so sharing one reference across concurrent handles is re-entrant.
    let lex = lexicon;
    if (!lex) { const { loadLexicon } = await import("./grammar/lexicon.mjs"); lex = loadLexicon(); }
    const ambiguous = parseAceAmbiguous(line, lex);
    if (ambiguous) {
      const { normFactTerm } = await import("./memory/core.mjs");
      const answer = renderAmbiguousAssert(line, ambiguous, normFactTerm);
      // Genuinely ambiguous — no single triple was committed, so the canonical
      // form is every surviving reading's own would-be triple set, same idiom
      // as ask.mjs's canonicalOf() for a parse-level tie.
      const canonical = {
        english: ambiguous.readings.map((r) => `reading "${r.verbLemma}" as the verb`).join(" — or — "),
        machine: ambiguous.readings.map((r) => r.triples
          .map((t) => `fact(${JSON.stringify(normFactTerm(t.subject))}, ${JSON.stringify(t.predicate)}, ${JSON.stringify(normFactTerm(t.object))})`)
          .join(", ")).join(" | "),
      };
      return plainTurn(line, answer, { command: "assert", via: "assert", focus, canonical });
    }
    const parse = parseAce(line, lex);
    if (!parse || !parse.triples?.length || parse.residue?.length) return null;
    const { assertSentence } = await import("./grammar/assert.mjs");
    const { normFactTerm, appendFact } = await import("./memory/core.mjs");
    const ts = new Date().toISOString();
    const res = await assertSentence(memoryDir, line, {
      lexicon: lex,
      provenance: { source: "chat", sessionId, ts },
    });
    if (!res || !res.ids?.length) return null;
    // Feature A point 3: a plain universal "every X is a Y" ALSO records the
    // "every" quantifier on the SAME fact — purely additive (appendFact
    // upserts by (s,p,o) id, never a duplicate, never changes the confirmation
    // text below), for the new "how many Xs are Ys" recall lane. Gated on the
    // literal typed determiner (not on `parse.pattern`, which is "subClassOf"
    // for the bare-copula variant too) — only "every" reads as a class-level
    // generalization; a bare/indefinite "X is a Y" is one specific claim and
    // gets no quantifier. `provenance` is deliberately omitted (appendFact
    // treats "" as a no-op on the union) so this never grows a redundant tag
    // alongside the fact's real ace:chat provenance. Best-effort: the base
    // fact is already durably stored either way, so a failure here (a
    // relation/cardinality/etc. axiom that happens to start with "every" and
    // carries no rdfs:subClassOf triple, or any write error) is swallowed.
    if (/^every\s+/i.test(String(line).trim())) {
      const triple = res.triples.find((t) => t.predicate === "rdfs:subClassOf");
      if (triple) {
        try {
          await appendFact(memoryDir, {
            subject: triple.subject, predicate: "rdfs:subClassOf", object: triple.object, quantifier: "every",
          });
        } catch { /* best-effort — the base fact is already stored either way */ }
      }
    }
    const shown = res.triples
      .map((t) => `${normFactTerm(t.subject)} ${t.predicate} ${normFactTerm(t.object)}`)
      .join("; ");
    const n = res.ids.length;
    const answer = `noted — remembered ${n} fact${n === 1 ? "" : "s"}: ${shown}`;
    // PLAN_BREADTH_FIRST_NLU.md §Track 6 (operator directive): the canonical
    // restatement of what was committed — `english` reuses the SAME confirmation
    // text just shown (already tmct's own preferred subject-predicate-object
    // phrasing, per normFactTerm), `machine` is the same fact(s) in the compact
    // notation ask.mjs's canonicalOf() uses for query-side parses, so both lanes
    // share one consistent syntax.
    const canonical = {
      english: shown,
      machine: res.triples
        .map((t) => `fact(${JSON.stringify(normFactTerm(t.subject))}, ${JSON.stringify(t.predicate)}, ${JSON.stringify(normFactTerm(t.object))})`)
        .join(", "),
    };
    return plainTurn(line, answer, { command: "assert", via: "assert", focus, canonical });
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

// Bug F point 3 (operator follow-up request): "I want you to search for
// Widget" / "I'd like you to search for Widget" — a closed-set indirect-
// request wrapper, checked VERY early (before asBareCommand/conversationalTurn/
// the ask engine ever see the raw prefix). Found live: without this, "I want
// you to search for Widget" was mis-swallowed by GENERAL_VERB_TEACH_RE as a
// bare <subject> <verb> <object> teach triple (subject "I", verb "want") —
// declined by the pronoun-subject guard with a confusing "pronouns aren't
// things I can classify" message, instead of ever reaching /search at all.
// Deliberately does NOT strip bare "please X" alone — that's already handled
// ad hoc by many individual regexes throughout this file (TEACH_RE,
// EXPLAIN_TOUCH_RE, describeWrapperAnswer's own regex, IMPERATIVE_NUDGE_RE) and
// re-stripping it centrally here risks double-processing interactions across
// the whole file — out of scope for this fix, higher risk than the concrete
// gain.
const INDIRECT_REQUEST_RE = /^(?:i\s+(?:want|wanted)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)\s*(.+)$/i;

/** PLAN_CONVERSATION.md Finding 4's remaining gap: a DISCONTIGUOUS verb frame,
 *  "SUBJECT uses OBJECT as its/a base(class)" — "uses" is split from its own
 *  qualifier ("as its base") around the object, so no CONTIGUOUS phrase table
 *  entry (VERB_TO_KIND/findPhrase, both ask-vocab.mjs/keywords.mjs, only ever
 *  match a contiguous run of words) could ever register it. "uses" itself is
 *  ALSO already claimed by the query-side "uses" UNION (imports+calls+
 *  callsSymbol, KIND_UNIONS in ask.mjs) — a bare "X uses Y" must keep meaning
 *  that; only THIS "...as its base"-qualified shape means the single stored
 *  `inherits` relation (RELATIONS.inherits, ask-vocab.mjs — "Class -> Class:
 *  subject's declared base resolves to object", the exact same subclassOf
 *  semantics "is a kind of"/"inherits from" already carry).
 *
 *  Fixed here by REWRITING the raw turn text, once, before any dispatch lane
 *  sees it (same early-rewrite spot as INDIRECT_REQUEST_RE just above) — into
 *  the equivalent ALREADY-WORKING "is a kind of" surface form, rather than
 *  inventing a parallel teach/ask mechanism for a brand-new predicate
 *  vocabulary entry. "is a kind of" is itself one of RELATIONS.inherits.verbs
 *  (ask-vocab.mjs), and its teach (bare "X is a kind of Y" -> rdfs:subClassOf)
 *  and ask readbacks (ISA_ASK_RE yes/no; BARE_WHATIS_RE + splitMetaPredicate's
 *  "what is X a kind of" forward read) are existing, separately-tested
 *  mechanisms — reusing them end to end means this fix needs no new predicate,
 *  no new stored fact shape, and no changes to factAnswer's cascade at all.
 *
 *  Four shapes recognized (checked in this order — see each RE's own
 *  anchoring for why order matters: the WH-object and aux-fronted forms must
 *  win before the bare-declarative TEACH form gets a chance to misread an
 *  aux-fronted question's leading "does"/"what" as part of the subject):
 *    1. mid-sentence WH-object ask ("SUBJECT uses which controller as its
 *       base" / "SUBJECT uses what as its base" — Finding 4's own repro
 *       shape) -> "what is SUBJECT a kind of";
 *    2. WH-fronted forward ask ("what does SUBJECT use as its base") ->
 *       "what is SUBJECT a kind of";
 *    3. aux-fronted yes/no ask ("does SUBJECT use OBJECT as its base") ->
 *       "is SUBJECT a kind of OBJECT";
 *    4. bare declarative teach ("SUBJECT uses OBJECT as its base", never
 *       ending in "?" — mirrors generalVerbTeach's own question-mark decline
 *       guard) -> "SUBJECT is a kind of OBJECT".
 *
 *  The "as ___" qualifier tolerates the reasonable surface variants named in
 *  the operator's own worked examples: an optional "its"/"the"/"a"/"an"
 *  determiner (or none at all), and "base"/"parent"/"base class"/"parent
 *  class" as the qualifier noun. */
const BASE_QUALIFIER_SRC = "as\\s+(?:its|the|an?)?\\s*(?:base\\s+class|parent\\s+class|base|parent)";
const USES_AS_BASE_WH_ASK_RE = new RegExp(
  `^(.+?)\\s+uses?\\s+(?:which\\s+[\\w'-]+|what)\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`, "i");
const USES_AS_BASE_WHAT_FRONT_RE = new RegExp(
  `^what\\s+(?:does|do|did)\\s+(.+?)\\s+uses?\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`, "i");
const USES_AS_BASE_YESNO_RE = new RegExp(
  `^(?:does|do|did)\\s+(.+?)\\s+uses?\\s+(.+?)\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`, "i");
const USES_AS_BASE_TEACH_RE = new RegExp(
  `^(.+?)\\s+uses?\\s+(.+?)\\s+${BASE_QUALIFIER_SRC}\\s*[.!]*$`, "i");

/** Recognize + rewrite one of the four shapes above, or return null (no
 *  match — the caller leaves the text untouched, same "honest decline, never
 *  a guess" discipline as every other frame in this file). Pure text in, text
 *  out — no grounding/lexicon lookups here, matching every other early-rewrite
 *  step (INDIRECT_REQUEST_RE, normalize.mjs's own preamble frames). */
function rewriteUsesAsBaseFrame(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  let m = t.match(USES_AS_BASE_WH_ASK_RE);
  if (m) return `what is ${m[1].trim()} a kind of`;
  m = t.match(USES_AS_BASE_WHAT_FRONT_RE);
  if (m) return `what is ${m[1].trim()} a kind of`;
  m = t.match(USES_AS_BASE_YESNO_RE);
  if (m) return `is ${m[1].trim()} a kind of ${m[2].trim()}`;
  if (/\?\s*$/.test(t)) return null; // an unrecognized question shape — never guessed as a teach
  m = t.match(USES_AS_BASE_TEACH_RE);
  if (m) return `${m[1].trim()} is a kind of ${m[2].trim()}`;
  return null;
}

export async function runTurn(input, { config, source = defaultSource, graph = null, focus = null, last = null, memoryDir = null, sessionId = "", env = process.env, lexicon = null, narrate = false, vocabHint = null, tel = null, biasByBundle = {} } = {}) {
  const line = String(input ?? "").trim();
  // The captured residue is used for RECOGNITION at every dispatch site below
  // (asBareCommand, conversationalTurn, assertTurn, the count lanes, runAsk);
  // the ORIGINAL `line` survives untouched for record.query/logLines fidelity
  // — restored centrally inside withLast (below), once, for every dispatch path.
  const indirectMatch = line.match(INDIRECT_REQUEST_RE);
  const preRewriteLine = indirectMatch ? indirectMatch[1].trim() : line;
  // Finding 4's discontiguous-frame rewrite (rewriteUsesAsBaseFrame, above):
  // applied here, once, before ANY dispatch lane (bareCmd/conversationalTurn/
  // assertTurn/runAsk) sees the text — same reasoning as indirectMatch just
  // above it. `baseFrameRewrite` is null (no-op) for every turn that doesn't
  // match one of the four discontiguous shapes, so this can only ever ADD a
  // recognized shape, never change behavior for anything else.
  const baseFrameRewrite = rewriteUsesAsBaseFrame(preRewriteLine);
  const workingLine = baseFrameRewrite || preRewriteLine;
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
  const ctx = { config, source, graph, focus, last, memoryDir, sessionId, templates, env, lexicon, trace, narrate, vocabHint: resolvedVocabHint, tel, biasByBundle };
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
    // Bug F point 3 fidelity: every dispatch path below built its own record off
    // `workingLine` (the indirect-request wrapper stripped, and/or Finding 4's
    // discontiguous-frame rewrite applied, above) — restore the ORIGINAL raw
    // `line` into record.query and the logged "> …" transcript echo here, once,
    // centrally, for every path (they all funnel through withLast).
    if (indirectMatch || baseFrameRewrite) {
      if (finished.record) finished.record.query = line;
      if (Array.isArray(finished.logLines) && finished.logLines.length > 1) finished.logLines[1] = `> ${line}`;
    }
    // runAsk's own effectiveQuery (set only when discourseRewrite substituted a
    // new subject AND the rewrite produced a genuine non-miss answer) takes
    // over as the continuation base for the NEXT turn's own discourseRewrite —
    // see runAsk's docblock above its return statement. Every other turn type
    // (commands, plain counts, misses) carries no such field, so `line` — the
    // existing, unchanged behavior — stands.
    const nextLast = { query: finished.effectiveQuery ?? line, answer: finished.answer, detail: finished.detail ?? null };
    // FEATURE B: the always-on short "Goal (inferred): …" line — computed from
    // the SAME PRE-narration `finished` result `nextLast` was just captured
    // from, so (like narrate) it never contaminates what why/say-more or
    // repeat-detection compare against. Composes with narrate (below): a
    // narrated turn gets the short line up top AND the full trace block after.
    return { ...withNarration(withGoalLine(finished), trace, fallbackGoal), last: nextLast };
  };

  // Slash-optional system commands: a bare leading command word ("stats",
  // "memory", "describe X") is routed to its slash form BEFORE the conversational
  // layer, so a forgiving shell answers "stats" the way it answers "/stats" instead
  // of falling through to the generic orientation.
  const bareCmd = asBareCommand(workingLine);
  if (bareCmd) return withLast(await runCommand(bareCmd, ctx), "use a specific tool/command directly");

  // Conversational layer next (greetings, thanks, help, bye, why/say-more) — these
  // resolve no entity and carry their own preserved `last`. Bypasses withLast (a
  // conversational turn is never finish()'d / never becomes a new `last`), so the
  // narrate block is applied directly here instead.
  const convo = conversationalTurn(workingLine, ctx);
  if (convo) return withNarration(convo, trace, "casual/social — no graph intent");

  // "more" — page the remainder of a previous long listing, if one is held. Gated on
  // an actual pending remainder so a bare "more" with nothing to continue falls through
  // to the ordinary path (an honest miss), never a pretend page.
  if (MORE_RE.test(workingLine) && Array.isArray(last?.detail?.pending?.items) && last.detail.pending.items.length) {
    note(trace, "goal: continue viewing a previous long listing (pagination)");
    note(trace, "lane: MORE_RE matched a held pending remainder from the previous turn's detail.pending");
    return withLast(morePage(workingLine, ctx), "continue viewing a previous long listing");
  }

  if (workingLine.startsWith("/")) return withLast(await runCommand(workingLine, ctx), "use a specific tool/command directly");
  // Declarative ACE sentences ("every module is a artifact") ASSERT into tmct's
  // own memory and confirm — they are statements to remember, not graph queries.
  // Gated on memoryDir: only a session shell provides a write target, so a bare
  // runTurn (tests, library callers) stays pure and falls through to the engine.
  if (memoryDir) {
    const asserted = await assertTurn(workingLine, ctx);
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
    const memCount = await answerMemoryCount(memoryDir, workingLine);
    if (memCount != null) {
      note(trace, "goal: get a count of a memory-store kind (facts/utterances)");
      note(trace, "lane: answerMemoryCount — matched a MEMORY_COUNT_NOUNS entry, answered off the .tmct/memory graph header");
      return withLast(plainTurn(workingLine, memCount, { via: "count", focus }), "get a count of a memory-store kind");
    }
  }
  // Feature A point 4: "how many Xs are Ys" — a taught-quantifier RECALL, checked
  // explicitly ahead of answerCount (see answerQuantifierRecall's own "CRITICAL
  // ORDERING NOTE" — mirrors answerMemoryCount's precedent just above). Its own
  // authority gate declines (returns null) for anything answerCount should own,
  // so ordinary structural counts fall through completely unaffected.
  if (memoryDir) {
    const quantifierRecall = await answerQuantifierRecall(memoryDir, workingLine, biasByBundle);
    if (quantifierRecall != null) {
      note(trace, 'goal: recall a taught quantifier for a class-membership pair ("how many Xs are Ys")');
      note(trace, "lane: answerQuantifierRecall — matched HOW_MANY_ARE_RE with a subject tmct has facts about; literal recall, never real counting");
      return withLast(plainTurn(workingLine, quantifierRecall, { via: "fact", focus }), "recall a taught quantifier");
    }
  }
  // Aggregate/count questions are answered mechanically off the loaded graph header,
  // BEFORE falling through to the ask engine (focus unchanged — a count names no entity).
  const count = answerCount(graph, workingLine);
  if (count != null) {
    // An "I can't count <noun>" from a bare kind may still be answerable from an
    // ASSERTED vocabulary fact ("every class is a type" → "how many types" = the
    // class count). countFromFacts declines on a real graph kind, so ordinary
    // counts are unaffected; it only speaks for a remembered object noun.
    const viaFact = memoryDir ? await countFromFacts(graph, memoryDir, workingLine, biasByBundle) : null;
    if (viaFact != null) {
      note(trace, 'goal: get a count of an asserted-vocabulary kind ("every X is a Y" inherited cardinality)');
      note(trace, "lane: countFromFacts — the counted noun matched a remembered isa-fact's SUBJECT, whose class IS countable");
      return withLast(plainTurn(workingLine, viaFact, { via: "fact", focus }), "get a count");
    }
    note(trace, "goal: get a count of a graph kind (classes/functions/modules/…)");
    note(trace, "lane: answerCount — a header-count aggregate question, answered mechanically off the graph header, never dispatched to the ask engine");
    return withLast(plainTurn(workingLine, count, { via: "count", focus }), "get a count of a graph kind");
  }
  return withLast(await runAsk(workingLine, ctx), "unclear — no goal signal computed by the ask engine");
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

/** Bootstrap <repo> for tmct on a graph-less first run — PLAN_SEED.md §2's
 *  `createSession`→`initRepo` auto-init CONVERGENCE: this used to run its own
 *  bespoke seed-only pair (resolveExtensions + seedActiveCorpusEntries)
 *  directly, writing ONLY the in-memory seed marker — a fresh `import {
 *  runChat } from '...'; await runChat({repoPath})` on a bare directory got
 *  seeded facts but no persisted, inspectable `tmct.toml`/`.tmct/init.json`,
 *  unlike CLI `tmct init`. Now delegates to the FULL `initRepo(repo, {persona:
 *  PERSONA_PRESETS.human, env})` — the exact same function `tmct init` calls
 *  — so a library consumer gets the SAME "docker pull" first-run experience:
 *  real `.tmct/` scaffold, a written `tmct.toml`, `.tmct/init.json`
 *  provenance, not just a seed marker.
 *
 *  Verified NOT to double-scaffold or double-seed: `initRepo` only writes
 *  `tmct.toml` when absent (or `force`), only writes the seed marker/reseeds
 *  when the marker is absent, and its own provenance write is a plain
 *  idempotent overwrite (never destructive) — every one of its own guards
 *  fires correctly whether IT was the first call ever, or a repeat call after
 *  a prior CLI `tmct init` (or a prior `createSession` bootstrap) already ran.
 *  `persona: PERSONA_PRESETS.human` only has any effect on a genuinely FRESH
 *  write (no existing tmct.toml) — on an already-initialized repo `initRepo`
 *  reads the EXISTING file back untouched, so this can never override an
 *  operator's own `--with-persona code`/custom `[extensions]` choice.
 *
 *  `entries`/`seedActiveCorpusEntries` are no longer called directly here —
 *  `initRepo` calls them internally, in the SAME resolver's fixed order
 *  (seon, conceptnet, then every other active bundle sorted by name).
 *  Returns `initRepo`'s own `seedResult` ({ appended, skipped, total, seon,
 *  conceptnet, perBundle }) on a fresh seed (the banner counts stay honest,
 *  byte-identical shape to before), null when skipped/failed outright — the
 *  CALLER's contract is unchanged even though the implementation now goes
 *  through one shared code path instead of two. */
async function seedBootstrapMemory(repo, env = process.env) {
  try {
    const { initRepo, PERSONA_PRESETS } = await import("./init.mjs");
    const result = await initRepo(repo, { persona: PERSONA_PRESETS.human, env });
    return result.seeded ? result.seedResult : null;
  } catch {
    return null; // repo/corpus unavailable — bootstrap proceeds unseeded
  }
}

/** The seed banner line — BUNDLE-LIST-DRIVEN (PLAN_SEED.md §2 fix): renders
 *  every `perBundle` entry that actually appended facts this run, in the
 *  entries' own fixed order (src/extensions.mjs's resolveExtensions —
 *  seon, conceptnet, then the rest sorted by name), joined with " + ". No
 *  bundle is privileged as one of "the first two" any more — with the
 *  persona flip (seon/conceptnet now opt-in, `human` the new default) the
 *  old hardcoded "N curated SEON + N ConceptNet" shape would render the
 *  misleading "seeded 664 starter facts (0 curated SEON + 0 ConceptNet + 664
 *  human)" for the new default. A single active bundle renders with no
 *  " + " at all ("seeded 664 starter facts (664 human) — …"), matching the
 *  common case cleanly. test/wiring-seed.test.mjs's SEED_BANNER_RE is
 *  relaxed to match this generic form (still asserting the SHAPE, not a
 *  brittle literal — see that test file's own header comment). */
function seedBannerLine(seeded) {
  const clauses = Object.entries(seeded.perBundle || {})
    .filter(([, r]) => r && r.appended > 0)
    .map(([name, r]) => `${r.appended} ${name}`);
  return `seeded ${seeded.appended} starter facts (${clauses.join(" + ")}) — /memory to inspect`;
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
 *  `dog` is confirmed live (PLAN_SEED.md's default human-world persona): present
 *  in corpus/tier2/human.jsonl's human-nature clump, backed by a corpus:human
 *  concept fact, and a recognized lexicon noun — but only actually answerable
 *  once the seed has run. When it hasn't (TMCT_NO_SEED=1, seed.enabled=false, or
 *  corpus load failure), offering it would be a lie worse than no example —
 *  swap to an unconditionally-true pointer instead (the teach lane and `tmct
 *  init` both work with zero preconditions). Computed ONCE per session
 *  (createSession), not per turn.
 *  The unseeded branch's teach clause is a CONCRETE pair too, for the same
 *  reason `dog` is concrete in the seeded branch: playtest found that an
 *  abstract "every X is a Y" invites a curious user to fill X/Y with an
 *  intuitive-but-unknown word ("every cache is a thing" — "thing" isn't in
 *  the closed ACE lexicon) and hit the teach-miss dead-end right after being
 *  offered the pattern. "every bug is an issue" is confirmed to parse and
 *  store (both `bug` and `issue` are declared lexicon nouns — see
 *  test/chatflow-tier0.test.mjs), so the offer resolves if copied verbatim. */
function vocabExampleHint(seeded) {
  return seeded
    ? 'Try "what is a dog" for general vocabulary.'
    : 'Run `tmct init` to seed a starter vocabulary, or teach me directly, e.g. "every bug is an issue".';
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
  graphPaths,
  configPath,
  source = defaultSource,
  env = process.env,
  cwd = process.cwd(),
  gitRoot = gitToplevel,
  ephemeral = false,
  narrate = false,
  // PLAN_SEED.md §6's storage-backend seam: "file" (default, unchanged) keeps
  // memoryDir a plain repo-path string (Backend A, memory/core.mjs). "memory"
  // selects Backend B (createInMemoryStore — zero disk I/O, session-scoped, no
  // module-global state). "sqlite" selects Backend C (createSqliteMemoryStore
  // — a live node:sqlite connection kept open for the session's lifetime,
  // lazily imported only when this is actually chosen). TMCT_MEMORY_BACKEND
  // mirrors the TMCT_EPHEMERAL/TMCT_NARRATE on/off env convention. No CLI flag
  // wires this yet (bin/tmct.mjs's flag parsing is out of this change's
  // scope) — a library/test caller sets the option directly for now.
  memoryBackend = null,
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
  // Graph resolution order for the chat surface (documented; --repo still
  // wins over TMCT_GRAPH_FILE env — a deliberate, TESTED chat-specific
  // contract predating this batch: an explicit --repo means "use exactly
  // this repo's graph", never silently redirected by env. Every other tier
  // below delegates to the shared resolver, src/cli-args.mjs's
  // resolveRuntimeConfig:
  //   0. --graph <path> (repeatable, graphPaths) → the NEW top tier: an explicit
  //      graph file (or files — multi-graph, see src/graph-merge.mjs), wins
  //      outright over everything below, including --repo.
  //   1. --repo <path>       → pins <path>/.tmct/graph.json (repo AND graph);
  //      tmct.toml's graph_file/graph_files at that repo is now ALSO consulted
  //      (new — chat used to hardcode the default regardless of tmct.toml),
  //      but TMCT_GRAPH_FILE env is deliberately excluded from this tier.
  //   2. TMCT_GRAPH_FILE env → loads that graph anywhere, so
  //      `TMCT_GRAPH_FILE=<path> tmct chat` works even inside a git repo.
  //   3. tmct.toml's graph_file/graph_files at the resolved repo root (--config
  //      <path>, `configPath`, can point this at an alternate location) — NEW.
  //   4. git root            → <root>/.tmct/graph.json (the default target).
  //   5. cwd                 → <cwd>/.tmct/graph.json (not a git repo).
  // Default the target to the GIT ROOT, not raw cwd: running from a nested package
  // dir (npm sets cwd there) would otherwise index only that package's ~few modules
  // instead of the whole repo.
  let repo;
  let config;
  const explicitGraphs = (graphPaths || []).filter(Boolean);
  if (explicitGraphs.length) {
    repo = repoPath || gitRoot(cwd) || cwd;
    const resolvedGraphs = explicitGraphs.map((p) => resolve(cwd, p));
    config = resolvedGraphs.length > 1
      ? { graphFile: resolvedGraphs[0], graphFiles: resolvedGraphs }
      : { graphFile: resolvedGraphs[0] };
  } else if (repoPath) {
    repo = repoPath;
    // env is deliberately withheld from resolveRuntimeConfig here (passed as
    // {}), so its own env-beats-repo-default tier can never fire — the ONLY
    // way this differs from the old hardcoded `{graphFile: join(repoPath,
    // DEFAULT_GRAPH_REL)}` default is that a repo's own tmct.toml
    // graph_file/graph_files (or an explicit --config override) is now
    // honored too.
    const argv = ["--repo", repoPath];
    if (configPath) argv.push("--config", configPath);
    ({ config } = await resolveRuntimeConfig({ argv, cwd, env: {}, gitRoot }));
  } else {
    const root = gitRoot(cwd);
    repo = root || cwd;
    const envGraph = env.TMCT_GRAPH_FILE && String(env.TMCT_GRAPH_FILE).trim();
    if (envGraph) {
      config = loadConfig(env, cwd);
    } else {
      const argv = [];
      if (configPath) argv.push("--config", configPath);
      ({ config } = await resolveRuntimeConfig({ argv, cwd, env, gitRoot }));
    }
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

  // Resolve this handle's extension entries + bias table ONCE per session
  // (src/extensions.mjs's resolveExtensions) — no new per-turn I/O. Failure-
  // tolerated: a malformed tmct.toml degrades to the shipped builtins with an
  // empty bias table (every bundle ranks at bias 1 — see memory/bias.mjs),
  // never an error before the prompt.
  let extEntries = null;
  let biasByBundle = {};
  try { ({ entries: extEntries, biasByBundle } = await resolveExtensions(repo)); }
  catch { extEntries = null; biasByBundle = {}; }

  // Load this handle's lexicon once (the immutable cached core vocabulary the ACE
  // assert path parses against), MERGED with any active lexicon/pack extension
  // entries (Part 3 — mergedLexiconExtra, ascending-bias merge order so a
  // higher-bias bundle's same-lemma entry wins deterministically). Threaded
  // into every turn so the grammar layer never re-imports per turn;
  // failure-tolerated — a broken lexicon degrades to the lazy per-turn load
  // inside assertTurn, never an error before the prompt.
  let lexicon = null;
  try {
    const { loadLexicon } = await import("./grammar/lexicon.mjs");
    const extra = extEntries ? await mergedLexiconExtra(extEntries, biasByBundle) : null;
    lexicon = loadLexicon(extra ?? undefined);
  } catch { lexicon = null; }

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

  // PLAN_SEED.md §6's storage-backend seam: `memoryDir` is the opaque token
  // every memory/core.mjs call in this file threads through unchanged (it
  // never inspects `dir` itself — that's the whole point of the seam). Backend
  // A (default, unchanged) keeps it the plain repo string every earlier
  // version of this function used. Backend B/C swap in a handle instead;
  // `closeMemoryStore` is a no-op unless Backend C actually opened a
  // connection (Backend C's node:sqlite import is lazy — it only happens if
  // this branch is actually taken).
  const backendChoice = String(memoryBackend || env.TMCT_MEMORY_BACKEND || "").trim().toLowerCase();
  let memoryDir = repo;
  let closeMemoryStore = async () => {};
  if (backendChoice === "memory") {
    const { createInMemoryStore } = await import("./memory/core.mjs");
    memoryDir = createInMemoryStore();
  } else if (backendChoice === "sqlite") {
    const { createSqliteMemoryStore, closeSqliteMemoryStore } = await import("./memory/core.mjs");
    const dbPath = join(repo, ".tmct", "memory", "graph.sqlite");
    await mkdir(dirname(dbPath), { recursive: true });
    const handle = await createSqliteMemoryStore(dbPath);
    memoryDir = handle;
    closeMemoryStore = async () => closeSqliteMemoryStore(handle);
  }

  const empty = graph.individuals.length === 0;
  // W3: FIRST RUN in a graph-less repo seeds a capped ConceptNet slice into
  // .tmct/memory so vocabulary questions ("what is a cache?") have something
  // honest to stand on from turn one. Guarded three ways: only the empty
  // bootstrap (a fixture/provider graph never seeds), only once (the marker),
  // and never when TMCT_NO_SEED=1 opts out.
  //
  // Backend B/C follow-ups (documented, not fixed here — out of this change's
  // scope):
  //   - seedBootstrapMemory/seedActiveCorpusEntries/hasSeededVocabulary all
  //     resolve their own marker file + corpus writes directly off the STRING
  //     `repo` path (extensions.mjs territory, not touched by this seam), so
  //     they'd seed the on-disk Backend-A file even for a Backend B/C session
  //     rather than the handle actually in use. Skipping W3 seeding for a
  //     non-default backend is the honest choice for now.
  //   - sessions.mjs's OWN per-turn utterance mirror (appendSessionToGraph ->
  //     recordSessionMemory -> appendUtterances) derives its OWN repoDir from
  //     config.graphFile independently of this function's `memoryDir`, and
  //     reads the session LOG/sidecar files by real path — it can't simply be
  //     handed a Backend B/C handle (that path needs a real directory for the
  //     log/sidecar reads, not just for the memory write). So a Backend B/C
  //     session's Utterance/Session individuals (NEVER Facts/Rules — those
  //     only ever go through THIS function's `memoryDir`, see runTurn's
  //     options below) still land in an ordinary Backend-A .tmct/memory/
  //     graph.json, independent of the chosen backend. Teaching that path to
  //     thread a handle too (and fold.mjs's own direct writeMemoryGraph
  //     alongside it) is future work for whoever finishes the seeding/persona
  //     work (PLAN_SEED.md's own §2/§3) — out of this change's scope.
  //     Taught FACTS themselves are unaffected by this gap: only the
  //     conversational transcript mirror leaks onto disk, never the facts.
  let seeded = null;
  if (empty && backendChoice === "" && String(env.TMCT_NO_SEED || "") !== "1") {
    seeded = await seedBootstrapMemory(repo, env);
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
    // is the TOTAL appended, split into the curated SEON ontology + the ConceptNet band
    // (+ any other active extension bundle, e.g. an activated tier-2 corpus).
    ...(seeded ? [seedBannerLine(seeded)] : []),
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
    repo, config, graph, lexicon, memoryDir, moduleCount, version, sessionId,
    logFile, sidecarFile, bannerLines, empty, biasByBundle,
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
        result = await runTurn(line, { config, source, graph, focus, last, memoryDir, sessionId, env, lexicon, narrate: narrateOn, vocabHint, tel, biasByBundle });
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
     *  (which also triggers the memory fold), stream flush, the Backend C
     *  connection close (a no-op for Backend A/B). Idempotent. */
    async close() {
      if (closed) return;
      closed = true;
      const endIso = new Date().toISOString();
      await writeLog(`${endIso}\n> /exit\nsession end ${endIso}\n`);
      await writeSidecar({ type: "end", ts: endIso });
      await upsertGraph(endIso);
      await new Promise((resolve) => stream.end(resolve));
      await new Promise((resolve) => sidecar.end(resolve));
      await closeMemoryStore();
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
  graphPaths,
  configPath,
  input = process.stdin,
  output = process.stdout,
  source = defaultSource,
  env = process.env,
  cwd = process.cwd(),
  gitRoot = gitToplevel,
  ephemeral = false,
  narrate = false,
  memoryBackend = null,
} = {}) {
  // createSession's first-run seed (~2-3s, corpus/seon + ConceptNet) produces ZERO
  // output until it fully resolves — found live: an operator reported `npm run chat`
  // appearing to hang with total silence. This one line is cheap on every run (a
  // fast subsequent run just flashes it briefly) and removes the "is this even
  // running" uncertainty during the one case that's genuinely slow.
  output.write("tmct — starting…\n");
  const session = await createSession({ repoPath, graphPaths, configPath, source, env, cwd, gitRoot, ephemeral, narrate, memoryBackend });

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
