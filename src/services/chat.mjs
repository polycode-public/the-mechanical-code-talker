// chat.mjs — `tmct chat`: a full interactive client over the tmct code-graph.
// A bare line is a plain-English question dispatched through the same
// zero-model tmct_ask engine bin/tmct.mjs's CLI fallback uses; `/command`
// reaches the richer dispatchTool tools (server.mjs); a small closed set of
// conversational expressions (greetings, thanks, help, farewell, why/say-more)
// is handled before any graph dispatch. A current FOCUS entity lets a bare
// `it`/`this`/`that` refer back to whatever the last command or answer
// resolved.
//
// Sessions are logged to <repo>/SESSION_LOG_DIR/session-<uuidv7>.md, plus a
// structured sidecar (.tmct/sessions/session-<uuidv7>.jsonl, sessions.mjs) and
// a `Session` individual upserted into graph.json per turn.
//
// runTurn(input, …) is a PURE function so tests exercise it directly; the ask
// ENGINE is imported lazily and failure-tolerated, so a turn never crashes
// (the one static ask.mjs import, classDisplayName, is a pure formatter).
// createSession(…) is the SESSION SINK every shell shares (runChat's readline
// loop, src/surfaces/tui/app.mjs's Ink shell).

import { join, dirname } from "node:path";
import { dispatchTool, loadGraph, TOOLS } from "../tools/server.mjs";
import { ToolError } from "../adapters/config.mjs";
import { parseEntities, edgesOfKind, moduleCountOf, renderAuthorCard, renderAuthorTouches, renderCommitAuthor, resolveSymbol, renderCompare } from "../domain/codegraph.mjs";
import { classDisplayName, DYNAMIC_TAIL_OK_RE } from "../domain/ask.mjs";
import { emptyRecord as emptyDiscourseRecord, advanceTurn as advanceDiscourseTurn, register as registerReferent, bind as bindDiscourseForm } from "../domain/discourse.mjs";
import { uuidv7 } from "../adapters/uuid.mjs";
import * as defaultSource from "../adapters/source.mjs";
import { loadTemplates, render as renderTemplate } from "../adapters/corpus/templates.mjs";
import { rankByBiasThenTrust } from "../domain/memory/bias.mjs";
import { HAS_A_PREDICATE, loadMemory as loadMemoryStore, normFactPredicate, normFactTerm as normFactTermStatic, readFactRows as readStoredFactRows, readRuleRows as readStoredRuleRows } from "../adapters/memory/core.mjs";
import {
  CAPABILITY_REPORT_CAP, NEG_CAPABLE_OF_PREDICATE, NEG_SUBCLASS_PREDICATE, capabilityBaseRate,
  capabilityExtension, isNegatedPredicate, negatedPredicate, positivePredicate,
  resolveCapabilityPolarity,
} from "../domain/memory/capability.mjs";
import { finish, beginsWithVowelSound, grammarRules } from "./finish.mjs";
import { splitSentences, carriesASentenceBoundary } from "./sentences.mjs";
import {
  VERB_TO_KIND, WHERE_MARKERS, MENTION_MARKERS, ENTITY_TO_TYPE, PASSIVE_PARTICIPLE_TO_KIND,
  stripTrailingScopeFiller, stripTrailingDiscourseTag, EDGE_NOUN_TO_METRIC, RELATIONS, LIST_TRIGGERS,
} from "../domain/ask-vocab.mjs";
import { COUNTERFACTUAL_RE, correctMisspellings, applyPreambleFrames, expandContractions, normalizeQuery, stripFillerWords, escapeRegex, kindNounAnaphoraHint } from "../domain/interpret/normalize.mjs";
import { setDefaultNlpAdapter } from "../domain/interpret/nlp-registry.mjs";
import { setConstructionBanks } from "../domain/interpret/strategies/constructions.mjs";
import { nlpAdapter } from "../adapters/ask-nlp.mjs";
import { readConstructionFiles } from "../adapters/corpus/construction-banks.mjs";
import { fuzzyMatchInSet, fuzzyBound } from "../domain/interpret/fuzzy.mjs";
import { loadLexicon, lookupNoun } from "../domain/grammar/lexicon.mjs";
import { pickPhrase } from "../domain/answer-variants.mjs";
import {
  REFERENCE_PACK_NAME, cleanMissReferenceTerm, renderReferenceAnswer, referenceProvenanceTag,
  LIVE_PACK_NAME, cleanMissLiveTerm, renderLiveReferenceAnswer, liveProvenanceTag,
} from "../domain/reference-pack.mjs";
import { getReferencePackProvider } from "../adapters/corpus/reference-pack.mjs";
import { getLiveReferenceProvider, getResearchProvider } from "../adapters/corpus/wikipedia-live.mjs";
import { researchTurn, researchSnapshot, resolveResearchConfig, RESEARCH_DEFAULTS, parseResearchRequest } from "./research.mjs";
import { loadResearchQueue, saveResearchQueue } from "../adapters/research-queue-store.mjs";
import { CHILD_PACK_NAME, childProvenanceTag } from "../domain/child-pack.mjs";
import { getChildPackProvider } from "../adapters/corpus/child-pack.mjs";
import { dialogueActForLane } from "../domain/dialogue-acts.mjs";
import { subClassParents, ancestryChain, clusterSenses } from "../domain/sense-split.mjs";
import { relatedForTerm } from "../domain/skos-view.mjs";
import { adventureTurn, unclaimedAdventureOpening, foldWorldState } from "./adventure.mjs";
import { spiderFlyTurn } from "./spider-fly-turn.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";

// Composition: the chat surface supplies the domain parser's default lemma/POS
// adapter (the browser bundle's ask-nlp stub carries no factory, so this is a
// no-op there and the parser stays adapter-less) and the construction-grammar
// banks (lazy — the TOML read happens on the first parse that needs them; the
// bundle's constructions stub ignores the registration entirely).
setDefaultNlpAdapter(nlpAdapter);
setConstructionBanks(readConstructionFiles);

// uuidv7 lives in ./uuid.mjs (shared with telemetry + the bench stamp); re-exported
// here because callers/tests still import it from chat.mjs.
export { uuidv7 };

// The session-orchestration cluster (createSession/runChat, the readline shell,
// the log/sidecar writers, the graph upsert, the first-run seed bootstrap) lives
// in the session layer so runTurn and the fact engine below stay free of
// node:fs/child_process/os/readline. Re-exported here (services → services) so
// every existing import site — bin, tui, server-http, index, tests — keeps
// importing createSession/runChat/SESSION_LOG_DIR/PROMPT from chat.mjs.
export { createSession, runChat, SESSION_LOG_DIR, PROMPT } from "./chat-session.mjs";

/** dispatchTool("tmct_ask", …) returns the prose answer plus a delimited
 *  machine-readable envelope; the TUI shows the prose only. Reused verbatim
 *  when chat builds the same string from a direct ask() call (the
 *  focus/contextId path), so runTurn parses one envelope shape either way. */
const ASK_ENVELOPE_DELIM = "\n\n---tmct_ask---\n";

/** The context pronouns a focus can stand in for — a bare `it`/`this`/`that`/`here`
 *  as a command arg reuses the focus, and the ask engine resolves the same words
 *  in a question against the contextId we thread through. */
const CONTEXT_WORDS = new Set(["it", "this", "that", "here"]);
const isPronoun = (s) => CONTEXT_WORDS.has(String(s || "").trim().toLowerCase());

// ---- narrate mode (opt-in, developer/debug-facing) -------------------------
// A decision-trace appended to the answer under NARRATE_MARKER, toggled by
// `/narrate on|off` or `--narrate`/TMCT_NARRATE=1. Default (off) must stay
// byte-identical: every trace site is a no-op `trace?.push` unless the
// `trace` array was allocated, and the block is appended AFTER finish() and
// outside `last.answer`, so repeat-detection/why-re-render is unaffected by
// whether narrate is on.
export const NARRATE_MARKER = "--- narrate ---";

/** Push one narrative line, only when tracing is on (`trace` is the mutable
 *  array runTurn allocates for a narrate:true turn, else null/undefined). */
function note(trace, text) { if (trace) trace.push(text); }

/** relation `kind` (ask-vocab.mjs RELATIONS) -> a short, deterministic
 *  statement of what a person asking that KIND of question is probably after.
 *  A small bucket lookup over the query SHAPE the engine
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

/** The goal wording for a taught subject/verb/object lookup — shared by
 *  runAsk's fact-lane goal revision and withDeducedGoal's fact-reader field. */
const TAUGHT_FACT_LOOKUP_GOAL = "look up a taught fact about a subject/verb/object";

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

// ---- dialogue acts (ISO 24617-2): a lookup over the lane decision ----
// A turn result may carry a `lane` string naming the router lane that
// answered it; withLast (and conversationalTurn's own mk) resolve it through
// dialogueActForLane and stamp `record.dialogueAct` — a fixed lookup over a
// decision already made, never a classifier. The honest miss is the row that
// must never drift: autoNegative in the autoFeedback dimension, tmct
// reporting its OWN processing failed, not a task answer.

/** Stamp the record with the lane's dialogue act (a no-op for an unmapped or
 *  absent lane) and put the label in the narrate trace. */
function attachDialogueAct(result, trace) {
  const act = dialogueActForLane(result?.lane);
  if (act && result?.record) {
    result.record.dialogueAct = act;
    note(trace, `dialogue act: ${act.act} (${act.dimension} dimension, ISO 24617-2)`);
  }
  return result;
}

const PROPOSITIONAL_NODES = new Set(["boolean", "qualifier"]);
const PROPOSITIONAL_LEAD_RE = /^(?:is|are|am|was|were|does|do|did|can|could|will|would|shall|should|has|have|had|must)\b/i;
const SET_QUESTION_LEAD_RE = /^(?:what|which|who|whose|where|when|why|how|tell|show|list|define|describe|find|count|name)\b/i;

/** The dialogue-act lane for a runAsk turn. A recorded miss is ALWAYS the
 *  honest-miss lane, whatever the query shape — feedback about tmct's own
 *  processing. An answered turn is labelled by its question shape (yes/no
 *  vs set), from the parsed AST when one stood, else the lead word. Null
 *  when the turn is neither — the record simply carries no act. */
function askDialogueLane(parsed, query, recordMiss) {
  if (recordMiss) return "honest-miss";
  if (parsed) {
    if (parsed.node) return PROPOSITIONAL_NODES.has(parsed.node) ? "ask-propositional" : "ask-set";
    if (parsed.shape === "ask") return "ask-propositional";
    if (parsed.shape) return "ask-set";
  }
  const q = String(query).trim();
  if (PROPOSITIONAL_LEAD_RE.test(q)) return "ask-propositional";
  if (SET_QUESTION_LEAD_RE.test(q)) return "ask-set";
  return null;
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

/** A short "Goal (inferred): …" line appended (never prepended) after every
 *  structural/query-shaped answer, independent of the --narrate opt-in trace
 *  above. Appending (not prepending) keeps the many tests that pin composed
 *  answers with a start-anchored regex intact.
 *
 *  `result.goal` is set by runAsk and by runCommand's own mk()
 *  (GOAL_BY_COMMAND, below); a plain count or a teach confirmation never
 *  carries the field, so this is a no-op for those turn types by
 *  construction. Also a no-op when `result.goal` is null/empty, so an
 *  unclear turn never grows a "Goal (inferred): unclear" line.
 *
 *  Applied after finish() and before `last` is captured in runTurn's
 *  withLast, so a goal-prefixed turn's own repeat-detection / why-re-render
 *  (which compare `last.answer` bytes) see the same text a goal-line-off run
 *  would have produced. */
function withGoalLine(result) {
  const goal = result?.goal;
  if (!goal) return result;
  const suffix = `Goal (inferred): ${goal.charAt(0).toUpperCase()}${goal.slice(1)}.`;
  const answer = `${result.answer}\n\n${suffix}`;
  const logLines = Array.isArray(result.logLines)
    ? result.logLines.map((l) => (l === result.answer ? answer : l))
    : result.logLines;
  return { ...result, answer, logLines };
}

/** Same append-onto-`answer` mechanism as withGoalLine, for `record.canonical`
 *  (set only by runAsk's ask-engine parse and assertTurn's teach lane — every
 *  other plainTurn call defaults `canonical` to null, so this is a no-op
 *  there by construction, not a special-cased suppression list here). Placed
 *  after withGoalLine in the pipeline so a turn with both fields shows the
 *  goal line first, then this one. */
function withCanonicalLine(result) {
  const canonical = result?.record?.canonical;
  if (!canonical) return result;
  const suffix = `Canonical: ${canonical.english} — ${canonical.machine}`;
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
  impact:     { tool: "tmct_impact",       arg: "module",  help: "what a change to this module or symbol reaches (impact closure)" },
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
 *  binds to the wrong thing. */
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

// ---- "find" routing precedence: /find and the ask engine's predicate-find
// grammar (parseFind, ask.mjs) both claim a bare "find …" line. When the tail
// names a real listable entity type (parseFind's own trigger), defer to it
// (return null); otherwise /find keeps its original tmct_search routing. ----
const FIND_LIST_SKIP = new Set(["the", "a", "an", "all", "me", "us"]);
const FIND_LINKERS = new Set(["called", "named", "about", "like", "containing", "matching", "with"]);

/** Does a bare "find …" tail look like the ask engine's predicate-find shape
 *  rather than a plain lexical search? A read-only proxy for parseFind's own
 *  trigger — ENTITY_TO_TYPE is the same table parseFind validates candidates
 *  against, so both call sites agree on one vocabulary. Two closed shapes,
 *  mirroring parseFind exactly: trailing-type ("<term…> <entityType>", e.g.
 *  "the payment class") and leading-type-with-linker ("<entityType> <linker>
 *  <term…>", e.g. "the class named Foo"). */
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
  // Strip a leading "for " before it becomes the argument — "for" is filler,
  // not part of the search term, and counting it could wrongly reject an
  // otherwise-short query as "too long" ("search for the payment controller"
  // is 4 tokens WITH "for", 3 without).
  //
  // "describe about X" takes the same strip for the same reason: "about" is
  // filler between the command and its symbol, and left in it binds verbatim
  // ("no entity matching symbol \"about a dog\"") because this path never
  // reaches describeWrapperAnswer's own "^about " strip. A bare "describe
  // about" keeps its argument — with nothing after it, "about" is all the user
  // gave and dropping it would answer a command they didn't type.
  const strippedFor = (fl === "search" || fl === "find") && restTokRaw[0]?.toLowerCase() === "for";
  const strippedAbout = fl === "describe" && restTokRaw[0]?.toLowerCase() === "about" && restTokRaw.length > 1;
  const stripped = strippedFor || strippedAbout;
  const restTok = stripped ? restTokRaw.slice(1) : restTokRaw;
  const rest = restTok.join(" ");
  const effectiveLine = stripped ? `${fl}${rest ? ` ${rest}` : ""}` : trimmed;
  // Zero-arg system commands are always the command; a bare command word is too.
  if (!rest || fl === "stats" || fl === "memory") return `/${effectiveLine}`;
  // "find" (only — "search", its /find-tool alias, keeps its original behavior
  // unconditionally): the predicate-find grammar's own shape wins regardless of
  // word count, see the precedence note above.
  if (fl === "find" && looksLikePredicateFind(restTok)) return null;
  // A bare PRONOUN argument to /describe ("describe it"/"describe that") has
  // no antecedent at this layer — dispatchTool("tmct_describe", …) does its
  // own name-only resolveSymbol lookup with no notion of the standing focus.
  // Defer to the ordinary pipeline instead (return null): it reaches
  // describeWrapperAnswer's rescue lane, which resolves a bare pronoun
  // against the standing focus. A named argument ("describe Widget") is untouched.
  if (fl === "describe" && DESCRIBE_PRONOUN_RE.test(rest)) return null;
  // A NO-ARGUMENT command word ("untested") with trailing words is NOT a command
  // call — the /untested tool takes no argument and would silently drop the qualifier,
  // listing MODULES for "untested classes". "untested classes" / "untested modules"
  // is a kind-FILTERED query the ask engine answers correctly (Base, Button for
  // classes) AND, as a listing, seeds discourse-count anaphora ("count them",
  // "how many of those are tested") with its match set. Fall through to the engine.
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
 *  "how many are tested", "and how many are tested". A fluent staccato
 *  follow-up after a just-given list naturally elides the pronoun a fuller
 *  phrasing ("how many of those are tested") carries — ANAPHORA_COUNT_RE
 *  above requires that explicit head and never fires for this shape, so
 *  answerCount's own bare noun-scan would otherwise greedily capture the
 *  linking verb itself as the counted noun ("how many ARE tested" ->
 *  noun="are"). Gated on real content after the linking verb (`(?!there\b)`)
 *  so a genuinely bare "how many are there" (no antecedent, no predicate to
 *  filter on) is untouched. */
const IMPLICIT_ANAPHORA_COUNT_RE = /^(?:(?:and|so|then|also)\s+)?how many (?:are|is|were|was)\s+(?!there\b)(\S.*)$/i;

/** "have"/"has"/"holds"/"hold" are excluded from RESTRICTOR_VERB_RE below.
 *  Ask-vocab's VERB_TO_KIND maps them to "defines" unconditionally, but the
 *  graph's actual "have" semantics are subject-type-dependent (a Module "has"
 *  things it defines; a Class "has" things it contains) — ask.mjs's own
 *  engine resolves two surface forms of the same query ("what methods does
 *  Widget have" vs "which methods does Widget have") to different,
 *  inconsistent kinds. Deferring a "have" tail to the ask engine here would
 *  just trade one wrong-answer risk for another, so it stays on the existing
 *  bare-count path until a dedicated fix teaches the grammar to pick
 *  "defines" vs "contains" by the resolved subject's own class. */
const AMBIGUOUS_HAVE_VERBS = new Set(["have", "has", "holds", "hold"]);

/** Words that can trail a bare count without restricting it: the copula/expletive
 *  of "are there", the "in total"/"in the graph" locatives, and the "do you know"
 *  politeness. Anything left after these is stripped is a real restrictor the
 *  header count cannot evaluate. Mirrors ask.mjs's AGG_TAIL_FILLER plus the
 *  interrogative scaffolding that only appears on the chat surface. */
const COUNT_TAIL_FILLER = new Set([
  "are", "is", "were", "was", "there", "of",
  "in", "total", "altogether", "overall",
  "the", "a", "an", "do", "does", "did", "you", "we", "us", "me", "know",
  "exist", "exists", "existing", "present", "here", "now", "currently",
  "graph", "index", "codebase", "repo", "repository", "memory",
  "that", "this", "known", "recorded", "listed", "stored",
  // trailing discourse particles — "…are there then", "…anyway" — never restrict a count
  "then", "so", "uh", "um", "er", "eh", "well", "though", "anyway", "anyhow",
  "again", "really", "actually", "maybe", "perhaps", "just", "simply", "rather", "please",
]);

/** A count tail past the kind noun carries a real restrictor — one the header
 *  count cannot evaluate — iff a content word survives the filler strip and the
 *  tail is not the have-family kept on the bare-count path (AMBIGUOUS_HAVE_VERBS).
 *  A topical tail ("about tasks", "with tasks", "related to tasks") names nothing
 *  RESTRICTOR_VERB_RE recognises, so without this it was silently discarded to the
 *  unqualified total; now it declines to the ask engine's honest miss instead. */
function countTailIsUnhandledRestrictor(tail) {
  const words = String(tail).toLowerCase().replace(/[^a-z\s]+/g, " ").split(/\s+/).filter(Boolean);
  const content = words.filter((w) => !COUNT_TAIL_FILLER.has(w));
  if (!content.length) return false;
  if (content.some((w) => AMBIGUOUS_HAVE_VERBS.has(w))) return false;
  return true;
}

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
 *  INHERIT FROM Base") is NOT a bare header count — this regex only ever
 *  captures the noun immediately after "how many" and would otherwise
 *  silently discard everything after it, falling back to the UNQUALIFIED
 *  class total instead of the real restricted count. ask.mjs's own AGGREGATE
 *  node (parseAggregate) already evaluates a restrictor tail correctly via
 *  parseSetPhrase, so once the tail names a real relation verb
 *  (RESTRICTOR_VERB_RE), decline here and let the turn fall through to the
 *  real ask engine instead of returning a misleading bare total. */
export function answerCount(graph, query) {
  if (!graph) return null;
  // ANAPHORIC counts ("how many of those are tested", "count them", "how many of
  // them") count the PREVIOUS answer's set, not a graph kind — decline so the turn
  // falls through to the ask engine's anaphora node (which threads `prev`). Without
  // this the bare "of"/pronoun head is mis-reported as an uncountable kind and the
  // discourse+count follow-up dies before it can resolve.
  if (ANAPHORA_COUNT_RE.test(String(query))) return null;
  // The elliptical sibling above (no explicit "of them/those" at all) — same
  // decline, same reason: this is a reference to the PREVIOUS answer's set,
  // not a graph kind named "are"/"is"/"were"/"was".
  if (IMPLICIT_ANAPHORA_COUNT_RE.test(String(query).trim())) return null;
  const m = String(query).match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/i);
  if (!m) return null;
  const noun = m[1].toLowerCase();
  const cls = COUNT_NOUNS[noun];
  if (cls) {
    const tail = String(query).slice(m.index + m[0].length);
    if (RESTRICTOR_VERB_RE.test(tail)) return null;
    if (countTailIsUnhandledRestrictor(tail)) return null;
  }
  if (!cls) {
    const kinds = countableKinds(graph);
    // When no code graph is loaded, countableKinds(graph) is genuinely
    // empty — an honest, non-dangling message pointing at how to load one.
    if (!kinds.length) {
      return `I can't count "${noun}" — no code graph is loaded yet, so there's nothing to count ` +
        `(index this repo with "tmct index", point me at another with --repo, or run "npm run example:mini").`;
    }
    return `I can't count "${noun}". I count: ${kinds.join(", ")}. ` +
      `Try "how many classes are there".`;
  }
  const n = countClass(graph, cls);
  return `${n} ${classNoun(cls, n)}.`;
}

/** singular+plural display forms for the edge-nominalized nouns answerEdgeCount
 *  (below) actually answers — a small subset of EDGE_NOUN_TO_METRIC's keys, the
 *  ones that read as a real countable noun ("3 callers.") rather than a
 *  participle only natural in a superlative ("most USED", not "how many used").
 *  A key with no entry here echoes the user's own word unchanged (safe default,
 *  same fallback CLASS_LABELS/classNoun use above). */
const EDGE_NOUN_LABELS = {
  test: ["test", "tests"], tests: ["test", "tests"],
  importers: ["importer", "importers"], dependents: ["dependent", "dependents"],
  callers: ["caller", "callers"], callees: ["callee", "callees"],
  calls: ["call", "calls"], imports: ["import", "imports"],
  dependencies: ["dependency", "dependencies"], members: ["member", "members"],
  subclasses: ["subclass", "subclasses"], connections: ["connection", "connections"],
  edges: ["edge", "edges"],
};
const edgeCountNoun = (noun, n) => {
  const [s, p] = EDGE_NOUN_LABELS[noun] || [noun, noun];
  return n === 1 ? s : p;
};

/** Pull the named entity out of a per-entity edge-count tail — the text after
 *  "how many <edge-noun>" — recognising exactly the two closed shapes such a
 *  tail actually takes:
 *    - "<verb> <entity>" ("cover src/x.mjs", "import Widget") — verb drawn
 *      from ask-vocab.mjs's RELATIONS[metric.kind].verbs (the SAME verb list
 *      the relation clause grammar itself reads), longest-first so a
 *      multi-word verb ("depends on") matches whole rather than a short
 *      prefix stealing part of the entity name.
 *    - "does/do/did <entity> have/has/had/got" ("does X have") — safe to
 *      treat as unambiguous HERE even though answerCount's own
 *      AMBIGUOUS_HAVE_VERBS guard deliberately excludes "have" elsewhere:
 *      that guard exists because "have" maps to either defines/contains
 *      depending on the SUBJECT's class, but an edge-nominalized noun's
 *      metric.dir is fixed by the NOUN itself ("importers" is always dir
 *      "in"), so there is no analogous ambiguity to worry about here.
 *  Returns the trimmed entity term, or null (no recognizable shape — an
 *  honest decline, not a guess) — the caller then leaves the existing "I
 *  can't count" message from answerCount standing. */
function extractEdgeCountEntity(tail, metric) {
  const t = String(tail || "").trim().replace(/[?.!]+$/, "").trim();
  if (!t) return null;
  const haveM = t.match(/^(?:does|do|did)\s+(.+?)\s+(?:have|has|had|got)$/i);
  if (haveM && haveM[1].trim()) return haveM[1].trim();
  if (metric.kind !== "*" && RELATIONS[metric.kind]) {
    const verbs = [...RELATIONS[metric.kind].verbs].sort((a, b) => b.length - a.length);
    for (const v of verbs) {
      const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+)$`, "i");
      const m = t.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  return null;
}

/** Bare "how many <edge-noun> <verb> <entity>" / "how many <edge-noun> does
 *  <entity> have" — "how many tests cover X", "how many importers does X
 *  have", "how many callers does X have". answerCount's own COUNT_NOUNS
 *  table only maps a counted noun to a graph INDIVIDUAL CLASS (Module/Class/…);
 *  an edge-nominalized noun like "tests"/"importers"/"callers" names an EDGE
 *  KIND instead — ask-vocab.mjs's EDGE_NOUN_TO_METRIC, the SAME table the
 *  superlative lane ("which module has the most tests") reads. This reuses
 *  the SAME per-entity degree computation the superlative lane's own
 *  evalSuperlative uses to rank every entity of a class (ask.mjs's
 *  degreeMetric, exported for exactly this) — just read for the ONE named
 *  entity instead of sorting all of them.
 *
 *  Checked BEFORE answerCount in runTurn so it gets first look; declines
 *  (returns null, letting answerCount's existing message stand) whenever:
 *    - the noun isn't edge-nominalized at all (a COUNT_NOUNS class, or truly
 *      unknown), or
 *    - no entity term could be extracted from the tail
 *      (extractEdgeCountEntity), or
 *    - the extracted term doesn't resolve to exactly one graph entity.
 *
 *  SCOPED to the per-entity case only: a bare "how many tests are there" (no
 *  named entity in the tail) declines here and keeps answerCount's existing
 *  "I can't count 'tests'" honest miss — what a GLOBAL edge count would even
 *  mean (every test edge in the graph? distinct test modules? distinct tested
 *  modules?) is a genuine, undecided design question. */
async function answerEdgeCount(graph, query) {
  if (!graph) return null;
  const q = String(query);
  if (ANAPHORA_COUNT_RE.test(q) || IMPLICIT_ANAPHORA_COUNT_RE.test(q.trim())) return null;
  const m = q.match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/i);
  if (!m) return null;
  const noun = m[1].toLowerCase();
  if (COUNT_NOUNS[noun]) return null; // a real graph class — answerCount owns it
  const metric = EDGE_NOUN_TO_METRIC[noun];
  if (!metric) return null; // not edge-nominalized either — answerCount's "I can't count" stands
  const term = extractEdgeCountEntity(q.slice(m.index + m[0].length), metric);
  if (!term) return null; // no per-entity phrasing recognized — scoped out (see docblock)
  const entity = await resolveEntity(graph, term);
  if (!entity) return null; // unresolved/ambiguous entity — honest decline, not a guess
  const ind = graph.byId?.get?.(entity.id);
  if (!ind) return null;
  let degreeMetric;
  try { ({ degreeMetric } = await import("../domain/ask.mjs")); } catch { return null; }
  const n = degreeMetric(graph, ind, metric);
  return `${n} ${edgeCountNoun(noun, n)}.`;
}

/** ASSERTED-VOCABULARY count: once "every class is a type" is remembered,
 *  "how many types are there" counts as many types as there are classes —
 *  the asserted object noun inherits the subject class's cardinality.
 *  Consulted only when answerCount can't map the noun to a graph class (an unknown
 *  kind) AND a session's memory is in hand. Returns the count string or null (no
 *  such fact → the honest "I can't count …" from answerCount stands). */
async function countFromFacts(graph, memoryDir, query, biasByBundle = {}, cache = null) {
  if (!graph || !memoryDir) return null;
  const m = String(query).match(/\b(?:how many|number of|count(?:\s+the)?)\s+([a-z]+)\b/i);
  if (!m) return null;
  const asked = m[1].toLowerCase();
  if (COUNT_NOUNS[asked]) return null; // a real graph kind — answerCount owns it
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const objVariants = factTermVariants(normFactTerm, asked);
  const isa = (await factRows(memoryDir, cache))
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

// "how many Xs are Ys" — literal recall of a taught quantifier ("some"/"a
// few"/"every"), NEVER real cardinality counting. Dispatched ahead of
// answerCount in runTurn (else its noun-scan regex would short-circuit to an
// "I can't count 'Xs'" miss first). Claims authority only when the subject
// isn't a real graph-countable class (COUNT_NOUNS) AND tmct has some
// isa-family fact about it — otherwise falls through to answerCount untouched.
const HOW_MANY_ARE_RE = /^how\s+many\s+([\w-]+)\s+(?:are|is)\s+(.+?)[?.!\s]*$/i;
async function answerQuantifierRecall(memoryDir, query, biasByBundle = {}, cache = null) {
  if (!memoryDir) return null;
  const m = String(query).trim().match(HOW_MANY_ARE_RE);
  if (!m) return null;
  const asked = m[1].toLowerCase();
  if (COUNT_NOUNS[asked]) return null; // a real graph-countable class — answerCount owns it
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const subjVariants = factTermVariants(normFactTerm, asked);
  const rows = (await factRows(memoryDir, cache)).filter((f) => ISA_PREDICATES.has(f.predicate) && subjVariants.has(f.subject));
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

/** Everything a count question can trail after its counted noun and still mean
 *  the plain total: "how many facts do you know", "how many facts are there",
 *  "how many facts in total". A closed table — anything outside it restricts
 *  the count to something, and this lane says so rather than answering as if
 *  it were not there. */
const MEMORY_COUNT_FILLER_TAIL_RE =
  /^(?:(?:do|d')\s+(?:you|u)\s+(?:know|have|remember)|are\s+there|(?:in\s+)?(?:total|all)|altogether)?[?.!\s]*$/i;

/** "how many facts about horses (are there)" — the one restriction this lane
 *  reads: facts naming a term on either side of the triple. */
const MEMORY_COUNT_ABOUT_TAIL_RE =
  /^about\s+(?:the\s+|an?\s+)?([a-z][\w-]*)\s*(?:are\s+there|do\s+(?:you|u)\s+know)?[?.!\s]*$/i;

/** Count the stored Facts naming `term` as subject or object — the restriction
 *  "how many facts about horses" asks for. */
async function memoryFactsAboutCount(memoryDir, term) {
  const { loadMemory, readFactRows, normFactTerm } = await import("../adapters/memory/core.mjs");
  const { loadLexicon, lookupNoun } = await import("../domain/grammar/lexicon.mjs");
  const wanted = normFactTerm(singularOf(term, loadLexicon(), lookupNoun));
  const rows = readFactRows(await loadMemory(memoryDir));
  return rows.filter((r) => normFactTerm(r.subject) === wanted || normFactTerm(r.object) === wanted).length;
}

/** Recognise a memory-store count question and answer it by loading the memory
 *  graph, or null (→ answerCount / the ask engine own it). Handles "how many facts",
 *  "how many utterances", and the bare "how many do you know" (→ facts). Lazy +
 *  failure-tolerated: no memory / a broken store → null, so the honest fall-through
 *  stands. */
async function answerMemoryCount(memoryDir, query) {
  if (!memoryDir) return null;
  const q = String(query).toLowerCase();
  let cls = null;
  let tail = "";
  // the bare "how many do you know" (no explicit noun) defaults to remembered facts
  if (/\bhow many(?:\s+(?:things?|facts?))?\s+(?:do|d'?)\s+(?:you|u)\s+know\b/.test(q)) cls = "Fact";
  if (!cls) {
    const m = q.match(/\b(?:how many|number of|count(?:\s+the)?)\s+(?:all\s+)?([a-z]+)\b(.*)$/);
    if (m) {
      cls = MEMORY_COUNT_NOUNS[m[1]] || null;
      tail = m[2].trim();
    }
  }
  if (!cls) return null;
  const [sing, plur] = MEMORY_CLASS_LABELS[cls];
  const said = (n) => `${n} ${n === 1 ? sing : plur}.`;
  // A restriction this lane can read: count only the facts naming that term.
  const about = cls === "Fact" ? tail.match(MEMORY_COUNT_ABOUT_TAIL_RE) : null;
  if (about) {
    try {
      return `${said(await memoryFactsAboutCount(memoryDir, about[1]))} (about "${about[1]}")`;
    } catch {
      return null;
    }
  }
  // A tail that restricts the question to something this lane cannot read. The
  // total is not the answer to it — it is the answer to a shorter question
  // nobody asked — so name what went unread instead of counting past it.
  if (tail && !MEMORY_COUNT_FILLER_TAIL_RE.test(tail)) {
    return `I can count the ${plur} I hold, but not the "${tail}" part of that question — `
      + `so I won't answer with the plain total, which would be a count of something you didn't ask for. `
      + `Ask "how many ${plur} do you know" for the total, or "how many ${plur} about <term>" to narrow it.`;
  }
  let loadMemory;
  try { ({ loadMemory } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  let mem;
  try { mem = await loadMemory(memoryDir); } catch { return null; }
  return said((mem.individuals || []).filter((i) => (i.class || "") === cls).length);
}

// ---- memory-store LIST + meta-class count ("list facts", "list utterances",
// "how many sessions are there") — the same reified individuals answerMemoryCount
// tallies, but enumerated, and reaching the meta-classes (Session/Source/Rule) the
// count lane skips. dynamicClassQuery (ask.mjs) already answers these when handed a
// memory-shaped graph, but the chat path hands ask() the CODE graph, so the store's
// own individuals were never reachable from a chat turn. This reads the store
// directly, mirroring answerMemoryCount's own lazy/failure-tolerated load. ----

/** Chat-phrasing nouns → the memory-store class they name. Fact/Utterance are
 *  shared with answerMemoryCount (which owns their counts); the meta-classes are
 *  reachable only here. */
const MEMORY_CLASS_QUERY_NOUNS = {
  fact: "Fact", facts: "Fact",
  utterance: "Utterance", utterances: "Utterance",
  session: "Session", sessions: "Session",
  source: "Source", sources: "Source",
  rule: "Rule", rules: "Rule",
};
const MEMORY_CLASS_PLURALS = {
  Fact: "facts", Utterance: "utterances", Session: "sessions", Source: "sources", Rule: "rules",
};
const MEMORY_CLASS_LIST_TRIGGER_RE = /^(?:list|show(?:\s+me)?)\s+(?:all\s+|the\s+)?([a-z][a-z-]*)\s*(.*)$/i;
const MEMORY_CLASS_COUNT_TRIGGER_RE = /^(?:how\s+many|number\s+of|count(?:\s+the)?)\s+(?:all\s+)?([a-z][a-z-]*)\s*(.*)$/i;

/** One display line per stored individual of a class: a Fact reads back through
 *  the same renderFactLine every other fact list uses; the other classes show
 *  their own label. */
function memoryClassLine(cls, ind, factByLabel) {
  if (cls === "Fact") {
    const row = factByLabel.get(ind.id);
    if (row) return renderFactLine(row);
  }
  return String(ind.label || ind.id || "").trim();
}

/** Recognise "list <memory-class>" (any class) and "how many <meta-class>"
 *  (Session/Source/Rule — Fact/Utterance counts stay with answerMemoryCount) and
 *  answer off the store. Returns { text, pending } or null (→ the next lane owns
 *  it). A real restrictor tail declines rather than answering a shorter question
 *  nobody asked. */
async function answerMemoryClassQuery(memoryDir, query) {
  if (!memoryDir) return null;
  const q = String(query).trim();
  const listM = q.match(MEMORY_CLASS_LIST_TRIGGER_RE);
  const countM = listM ? null : q.match(MEMORY_CLASS_COUNT_TRIGGER_RE);
  const m = listM || countM;
  if (!m) return null;
  const cls = MEMORY_CLASS_QUERY_NOUNS[m[1].toLowerCase()];
  if (!cls) return null;
  // Fact/Utterance counts carry answerMemoryCount's own about-tail discipline;
  // never re-answer them from this simpler lane.
  if (countM && (cls === "Fact" || cls === "Utterance")) return null;
  const plural = MEMORY_CLASS_PLURALS[cls];
  const tail = (m[2] || "").trim();
  if (!DYNAMIC_TAIL_OK_RE.test(tail)) {
    const verb = listM ? "list" : "count";
    return {
      text: `I can ${verb} the ${plural} I hold, but not the "${tail}" part of that question — `
        + `so I won't answer as if you hadn't asked it. `
        + `Ask "${verb} ${plural}" for all of them.`,
      miss: true,
    };
  }
  let loadMemory;
  let readFactRows;
  try { ({ loadMemory, readFactRows } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  let mem;
  try { mem = await loadMemory(memoryDir); } catch { return null; }
  const inds = (mem.individuals || []).filter((i) => (i.class || "") === cls);
  if (countM) return { text: `${inds.length} ${inds.length === 1 ? plural.replace(/s$/, "") : plural}.` };
  if (!inds.length) return { text: `I don't have any ${plural} stored yet.`, miss: true };
  const factByLabel = cls === "Fact" ? new Map(readFactRows(mem).map((r) => [r.id, r])) : new Map();
  const lines = inds.map((ind) => memoryClassLine(cls, ind, factByLabel));
  const shown = lines.slice(0, FACT_ANSWER_CAP);
  const rest = lines.slice(FACT_ANSWER_CAP);
  const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
  return {
    text: shown.join("\n") + extra,
    ...(rest.length ? { pending: { items: rest, noun: plural } } : {}),
  };
}

// "how many animals are there" — a real count of a TAUGHT class's members
// (every "X is a kind of animal" fact), distinct from answerQuantifierRecall's
// literal quantifier lookup. Placed ahead of it in runTurn: HOW_MANY_ARE_RE
// reads "there" as a second noun and answers "I was never told a quantifier",
// stealing the phrasing before a member count ever runs.
const TAUGHT_CLASS_COUNT_RE = /^how\s+many\s+([a-z][\w-]*)\s*(.*)$/i;

/** Count the taught members of a class named by a plain noun ("how many animals
 *  are there" → every "X is a kind of animal"). Declines (null) for a real
 *  code-countable class (answerCount owns it) or a class nothing was taught
 *  about, so structural counts and the quantifier lane are unaffected. */
async function answerTaughtClassCount(memoryDir, query, biasByBundle = {}, cache = null) {
  if (!memoryDir) return null;
  const m = String(query).trim().match(TAUGHT_CLASS_COUNT_RE);
  if (!m) return null;
  if (!DYNAMIC_TAIL_OK_RE.test((m[2] || "").trim())) return null;
  const asked = m[1].toLowerCase();
  if (COUNT_NOUNS[asked]) return null; // a real graph-countable class — answerCount owns it
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const rows = await factRows(memoryDir, cache);
  const isa = rows.filter((f) => ISA_PREDICATES.has(f.predicate));
  const variants = factTermVariants(normFactTerm, asked);
  const members = rankByBiasThenTrust(isa.filter((f) => variants.has(f.object)), biasByBundle);
  if (!members.length) return null; // nothing taught under this class name — later lanes own it
  // A member whose SUBJECT is itself a countable graph class ("every class is a
  // component") is an asserted-vocabulary cardinality, not a member enumeration —
  // countFromFacts counts the real class, so defer to it rather than tallying the
  // one class-level fact.
  if (members.some((f) => COUNT_NOUNS[String(f.subject).toLowerCase()])) return null;
  return `${members.length} ${members.length === 1 ? asked.replace(/s$/, "") : asked}.`;
}

// "list all animals" / "list the animals" — enumerate a taught class's members,
// with its OWN trigger rather than the "what is an animal" definition lane's
// leftovers: at scale the definition lane fills its cap with forward corpus facts
// before the reverse-membership listing ever shows, and the conversational
// orientation lane claims the bare "list …" phrasing before factReadBack runs.
const MEMBERSHIP_LIST_RE = /^(?:list|show(?:\s+me)?)\s+(?:all\s+|the\s+)?([a-z][\w-]*)\s*(.*)$/i;

/** List the taught members of a class named by a plain noun ("list all animals"
 *  → every "X is a kind of animal"). Declines (null) for a code-countable class
 *  or a class nothing was taught about; declines with a message for a real
 *  restrictor tail rather than answering as if it weren't there. */
async function answerMembershipList(memoryDir, query, biasByBundle = {}, cache = null) {
  if (!memoryDir) return null;
  const m = String(query).trim().match(MEMBERSHIP_LIST_RE);
  if (!m) return null;
  const asked = m[1].toLowerCase();
  if (COUNT_NOUNS[asked]) return null; // a real graph-countable class — the code list lane owns it
  const tail = (m[2] || "").trim();
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const rows = await factRows(memoryDir, cache);
  const isa = rows.filter((f) => ISA_PREDICATES.has(f.predicate));
  const variants = factTermVariants(normFactTerm, asked);
  const members = rankByBiasThenTrust(isa.filter((f) => variants.has(f.object)), biasByBundle);
  if (!members.length) return null; // nothing taught under this class name — later lanes own it
  if (!DYNAMIC_TAIL_OK_RE.test(tail)) {
    return {
      text: `I can list the ${asked}, but not the "${tail}" part of that question — `
        + `so I won't answer as if you hadn't asked it. Ask "list ${asked}" for all of them.`,
      miss: true,
    };
  }
  const lines = members.map(renderFactLine);
  const shown = lines.slice(0, FACT_ANSWER_CAP);
  const rest = lines.slice(FACT_ANSWER_CAP);
  const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
  return { text: shown.join("\n") + extra, ...(rest.length ? { pending: { items: rest, noun: asked } } : {}) };
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
  // The "so"/"uh"/"well" lead and the "for me"/"then" tail are pure discourse
  // filler on the same question — tolerated so the casual forms land on the
  // same orientation answer instead of the parse wall.
  /^(?:(?:so|uh|um|erm|well|ok|okay),?\s+)*what can (?:you|u)(?:\s+(?:actually|really))? do(?:\s+for\s+(?:me|us))?(?:\s+(?:then|now|today|here))?\??$/i,
  /^(?:(?:so|uh|um|erm|well|ok|okay),?\s+)*what do you(?:\s+(?:actually|really))? do(?:\s+for\s+(?:me|us))?(?:\s+(?:then|now|today|here))?\??$/i,
  // "what have you got" / "what do you have" — the overview question in its
  // casual spelling; without a frame, "got" parsed as a defines object.
  /^what (?:have|do) (?:you|u) (?:got|have)(?:\s+for\s+me)?(?:\s+(?:here|then|today))?\??$/i,
  // "tell me about this repo" — the orientation request by name; the
  // vocabulary touch lane must not read "this repo" as a concept term.
  /^tell me(?:\s+(?:something|more|a\s+little|a\s+bit))?\s+about (?:this|the|your)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
  // "what can you actually help with" — the natural pivot from small talk
  // into a capability question; not covered by the "do" pair above since
  // neither accepts "help (me)? with" as a synonym tail for "do".
  /^(?:so,?\s+)?what can (?:you|u)(?:\s+(?:actually|really))? help(?:\s+me)?\s+with\??$/i,
  // "can u help me with smth" — the SAME request, inverted word order
  // ("can you help ME with X" rather than "what can you help with"), plus
  // texting shorthand ("u", "smth"). A vague object (smth/something/this/
  // that) never names a real term to look up, so it's the capability
  // question, not a request about a specific thing.
  /^can (?:you|u) help me with (?:smth|something|this|that)\??$/i,
  /^help( me)?\??$/i, /^\?+$/,
  /^how do (i|you) work\??$/i, /^how does (this|it) work\??$/i,
  // unix-habit openers typed inside the REPL out of muscle memory — argv-only
  // today (bin/tmct.mjs), dead once inside the chat loop; route to the same
  // capability answer a plain "help" gets.
  /^--help$/i, /^-h$/i, /^man( tmct)?\??$/i,
  // The vague-opener family a stranger asks before knowing any query shapes —
  // "what can you tell me about this repo", "tell me something interesting
  // (about this codebase)", "so, what is going on in this codebase" (an
  // optional leading "so," discourse connective, same species as
  // LEADING_CONNECTIVE_RE elsewhere). The noun set mirrors META_ORIENT_RE's
  // own closed list.
  /^what can (?:you|u) tell me(?:\s+(?:more|anything))?\s+about (?:this|the)\s+(?:app|codebase|repo|repository|project|code|thing)\??$/i,
  /^tell me something interesting(?:\s+about (?:this|the)\s+(?:app|codebase|repo|repository|project|code))?\??$/i,
  /^(?:so,?\s+)?what(?:'s|s|\s+is)\s+(?:going on|happening)\s+(?:in|with)\s+(?:this|the)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
  // More vague-opener idioms, same family as above — a stranger's orientation
  // request has no fixed wording, so this closed set keeps growing additively
  // as new natural phrasings surface, never a general "any long question is
  // an orientation request" rule.
  /^(?:can you\s+)?walk me through (?:this|the)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
  /^(?:what(?:'s|s|\s+is)|give me|show me|gimme) the big picture(?:\s+(?:here|(?:on|of|for|about)\s+(?:this|the)\s+(?:app|codebase|repo|repository|project|code)))?\??$/i,
  /^(?:give me|what's) the lay of the land\??$/i,
  // "give me an overview" / "an overview" — the plain-word sibling of "the
  // big picture" just above, same optional here/of-this-repo tail. Without a
  // closed entry the word "overview" prose-matches real symbols in an
  // indexed graph (moduleOverviewText) and the describe rescue dumps that
  // symbol's card. The detailed forms ("give me a detailed overview of X")
  // carry a mandatory "detailed"+of-term and stay with the completions
  // rescue, untouched by this anchor.
  /^(?:(?:can|could|would) you\s+)?(?:give me|show me|gimme)\s+an overview(?:\s+(?:here|(?:on|of|for|about)\s+(?:this|the)\s+(?:app|codebase|repo|repository|project|code)))?\??$/i,
  /^an overview(?:\s+please)?\??$/i,
  // "what have we got here"/"what've we got here" — a casual, self-answering
  // opener (matches after a leading "so" strips via LEADING_CONNECTIVE_RE,
  // leaving this as the bare remainder).
  /^what(?:'ve| have) (?:we|i) got here\??$/i,
  // "what's in this repo/codebase" — genuinely ambiguous with the real
  // "what's in <X>" members/containment grammar (ask.mjs) for any OTHER term
  // — closed to the same self-referential noun set META_ORIENT_RE uses, so a
  // real module/class named literally "repo"/"codebase" is never at risk.
  /^what(?:'s|s|\s+is) in (?:this|the)\s+(?:app|codebase|repo|repository|project|code)\??$/i,
  // "can I ask you something random" — an ordinary conversational preamble
  // asking permission before a real question, not itself a question about
  // anything nameable. Answered the same as any other vague opener: sure,
  // here's what I can help with.
  /^can i ask (?:you\s+)?something(?:\s+random)?\??$/i,
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
  // this" after "explain" as readily as the statement-form "this is".
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
  // "are you secretly GPT" — an adverb ("secretly"/"really"/"actually") wedged
  // between "are you" and the noun must not mis-segment the subject as "you
  // secretly" and fall through to the ordinary graph-query grammar.
  /^(are you|r u)\s+(?:secretly|really|actually)?\s*(an? )?(ai|a bot|chatgpt|gpt|an? llm|a language model|a robot)\??$/i,
  /^is this (chatgpt|gpt|claude|an? ai|an? llm)\??$/i,
  /^do you use ai\??$/i, /^what language model are you( using)?\??$/i,
  /^am i (talking|speaking|chatting) (to|with) a (real )?(person|human|bot|ai)\??$/i,
  // "what model are you built on, GPT-4 or Claude?" — the SAME underlying
  // question as "are you secretly GPT" above, just posed as an open pick
  // between named models rather than a yes/no. The trailing model-name pair
  // is optional (the closed lead alone is already unambiguous).
  /^what model (?:are you|is this) (?:built|based|running) on(?:,?\s*(?:gpt-?\d(?:\.\d)?|chatgpt|claude|gemini|llama)(?:\s+or\s+(?:gpt-?\d(?:\.\d)?|chatgpt|claude|gemini|llama))?)?\??$/i,
  // "do you use classical logic" — a mechanism question, not phrased as "are
  // you an AI", but asking the identical underlying thing (rule-based/
  // deterministic vs. a statistical model) T_IDENTITY_NOT_LLM already answers.
  /^do you use classical logic\??$/i,
  // "can u browse the internet" — tmct genuinely has no network access in the
  // product path (no-LLM constitution, deterministic offline reasoning), so
  // this is a real "no", not the generic capability listing.
  /^can (?:you|u) (?:browse|access|use|go on|connect to) the internet\??$/i,
  // "can you look things up on the internet" / "browse the web to check
  // something" — the same offline-capability question as the entry just
  // above, worded around "web"/"look up" instead of "browse the internet".
  // With no closed match, this fell into a code-graph module-name search for
  // the literal words instead of the plain "no, I'm offline" answer.
  /^can (?:you|u) look (?:things?\s+)?up on the internet\??$/i,
  /^can (?:you|u) (?:browse|search|check) the web(?:\s+to\s+check\s+(?:something|this|that))?\??$/i,
  // "are you like chatgpt or gemini or something" — the comparison phrasing
  // of the "are you an AI" question, a named model or two followed by a
  // trailing "or something" hedge.
  /^(?:are you|r u)\s+like\s+(?:chatgpt|gpt|claude|gemini|llama)(?:\s+or\s+(?:chatgpt|gpt|claude|gemini|llama))*\s+or\s+something\??$/i,
  // "what model are you, gpt-4 or claude or something else" — the SAME
  // open-pick question "what model are you built on" already answers, just
  // without the "built/based/running on" bridge phrase.
  /^what model are you,?\s*(?:gpt-?\d(?:\.\d)?|chatgpt|claude|gemini|llama)(?:\s+or\s+(?:gpt-?\d(?:\.\d)?|chatgpt|claude|gemini|llama|something\s+else))*\??$/i,
  // "can you use an LLM to answer this" — asks the identical no-LLM question
  // as "do you use ai", just with "use an LLM to answer this" as the verb
  // phrase instead of a bare "use ai".
  /^can (?:you|u) use (?:an? )?(?:llm|ai|gpt|chatgpt) to answer (?:this|that|it)\??$/i,
];

/** META-COMMAND/SESSION questions — a RETURNING USER checking whether a
 *  remembered command or session behavior still holds ("is /focus still a
 *  command", "did you keep anything from last session"). Without a
 *  recognizer, a literal "/focus"/"/forget"/"/stats" token embedded in an
 *  ordinary sentence reads as a bare word to whichever parser gets to it
 *  first (the teach lane, or a code-import/definition lookup), producing
 *  garbled nonsense instead of the plain, true answer — even though the
 *  underlying capability (or its real equivalent) verifiably works when
 *  invoked directly. Each entry answers the SPECIFIC thing asked, closed
 *  and hand-written (never a guess): confirming what still works, or
 *  naming the real equivalent for something that was never a command at
 *  all ("/forget" isn't one; "forget that X is a Y" retracts a taught
 *  fact instead). */
const META_FOCUS_STILL_RE = /^can i still (?:do|use) \/?focus\b/i;
const META_FOCUS_RENAMED_RE = /^is \/?focus (?:even )?still a command\b/i;
const META_FORGET_RE = /^what about \/?forget\b/i;
const META_STATS_STILL_RE = /^is there still a stats command\b/i;
const META_COMPARE_STILL_RE = /^can (?:you|u) still do that thing where you compare two classes\b/i;
const META_LAST_SESSION_RE = /^did you keep anything from (?:our |my )?last session\b/i;
/** One answer per META_* recognizer above, in the same order, so the
 *  dispatch site (conversationalTurn) stays a flat, readable table rather
 *  than a chain of near-identical if-blocks. */
const META_COMMAND_ANSWERS = [
  [META_FOCUS_STILL_RE, "Yes — /focus still works, unrenamed: \"/focus <symbol>\" sets the current focus, "
    + "reused by \"it\"/\"this\" and no-arg entity commands. /help lists every command."],
  [META_FOCUS_RENAMED_RE, "Yes — /focus is still a real command, never renamed: \"/focus <symbol>\" sets the "
    + "current focus. /help lists every command."],
  [META_FORGET_RE, "There's no /forget command, but a taught fact IS undoable — say \"forget that <subject> is "
    + "a <object>\" (the exact fact as taught) to retract it. /memory shows what's currently stored."],
  [META_STATS_STILL_RE, "Yes — /stats still works: a one-screen overview of entity counts, relationship "
    + "counts, and packages. /help lists every command."],
  [META_COMPARE_STILL_RE, "Yes — say \"compare <X> and <Y>\" for two entities of the same kind. /help lists "
    + "every command and question shape."],
  [META_LAST_SESSION_RE, "Taught facts and folded session summaries persist between sessions (written to "
    + ".tmct/ on disk) — it's never a clean slate. /memory shows what's currently remembered."],
];

/** Split raw turn text into candidate single-sentence clauses on sentence-
 *  ending punctuation ("?"/"!"/"."), trimmed, empties dropped. AI_IDENTITY_
 *  PHRASES' own entries are anchored (^...$) against a SINGLE clause, so a
 *  two-sentence turn like "are you an AI? like chatgpt?" could never match
 *  the whole raw string even though its first clause alone is an exact "are
 *  you an AI" hit. Used ONLY by aiIdentityMatch below — every OTHER
 *  closed-set match in this file stays whole-string (scoped to the one
 *  family that's shown up broken this way). */
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

/** "Do you have feelings/emotions" — with no closed-set match, this would
 *  otherwise misfire into a literal module-name lookup for the bare noun
 *  ("no module matching 'feelings' found in the index") — a wrong-flavor
 *  wall, not an honest personality decline. Same family/placement as
 *  AI_IDENTITY_PHRASES just above (a self-awareness question about tmct, not
 *  a code-graph query), checked in conversationalTurn BEFORE any graph query
 *  is attempted. */
const FEELINGS_PHRASES = [
  /^do you have (?:feelings|emotions|opinions|thoughts)\??$/i,
  /^are you (?:sentient|conscious|self[- ]aware)\??$/i,
  /^can you feel(?:\s+(?:things|emotions|anything))?\??$/i,
  /^do you (?:feel|think|dream)\??$/i,
  // Direct personal questions ("how are you doing today", "what's your
  // favorite color", "do you get bored") — the same family this closed set
  // already exists for (a personal-life question about tmct, not a
  // code-graph query). Additive, same discipline as CAPABILITY_PHRASES' own
  // "keeps growing as new natural phrasings surface" precedent.
  /^how (?:are|r) (?:you|u) doing(?:\s+today)?\??$/i,
  /^what(?:'s|s|\s+is) your (?:favou?rite\s+(?:colou?r|food|movie|book|band|song|number)|name)\??$/i,
  /^do you (?:get|ever get) (?:bored|tired)\??$/i,
  /^what do you do for fun\??$/i,
  /^can you (?:tell|make)\s+(?:me\s+)?(?:a\s+)?jokes?\??$/i,
  /^do you (?:know|know anything|know much)\s+about\s+(?:movies?|sports?|music|tv|television)(?:\s+or\s+(?:movies?|sports?|music|tv|television))?\??$/i,
  // "do you think dogs are smarter than cats" — a personal-opinion comparison,
  // same family as the direct personal questions above: closed to a small
  // comparative-adjective vocabulary, open on the two compared things (the
  // SAME discipline PHRASING_FRAMES' object captures use elsewhere).
  /^do you think .+?\s+(?:is|are)\s+(?:smarter|dumber|better|worse|nicer|cooler|cuter|friendlier|stronger|faster)\s+than\s+.+\??$/i,
];
/** "can you make up an answer if you don't actually know" — a direct probe of
 *  the product's own headline promise (the honest miss: a query it can't
 *  ground gets a refusal, never a guess). With no closed match this fell to
 *  the plain grammar wall instead of confirming the very thing it asked
 *  about. Same family/placement as FEELINGS_PHRASES just above. */
const HONEST_MISS_PHRASES = [
  /^can (?:you|u) make up an answer if you (?:don'?t|do\s+not) (?:actually\s+|really\s+)?know\??$/i,
  /^(?:do|would) you (?:ever\s+)?(?:make (?:something|stuff) up|make up an answer)(?:\s+if you (?:don'?t|do\s+not) know)?\??$/i,
  /^what if you (?:don'?t|do\s+not) know (?:the\s+)?answer\??$/i,
];
/** "whats 2+2" — a bare arithmetic expression, not a code/vocabulary question
 *  at all. With no closed-set match of its own, this fell into the SAME
 *  "≤3 words, not code-ish" catch-all a genuine orientation opener
 *  ("what's up", "so what is this") uses, giving the non-sequitur identity
 *  blurb where an honest "I don't do arithmetic" decline belongs. Deliberately
 *  excludes "-" from the operator set: this domain's OWN dates ("what
 *  changed since 2026-01-01") and file/line ranges ("model.mjs:9-15") are
 *  digit-hyphen-digit too, and a real ambiguity there must stay a real
 *  structural answer, never this decline. "+"/"*"/"/" have no such
 *  collision in tmct's own vocabulary. */
const ARITHMETIC_RE = /\d+\s*[+*/]\s*\d+/;
/** A bare SQL data-definition/manipulation statement typed at the prompt
 *  ("DROP TABLE users;") — nonsense as a code-graph question, and with no
 *  closed match of its own this fell to the ≤3-word catch-all's identity/
 *  orientation blurb, the same wrong-flavor miss ARITHMETIC_RE exists to
 *  avoid for arithmetic. Each alternative requires the FULL SQL clause shape
 *  (not just the bare leading verb), so an ordinary English imperative
 *  ("update the readme") is never caught here — "table"/"from"/"into"/"set"
 *  are the words that make this unambiguously SQL rather than English. */
const SQL_STATEMENT_RE = /^(?:(?:drop|truncate|alter)\s+table|delete\s+from|insert\s+into|update\s+[a-z0-9_.]+\s+set)\s+[a-z0-9_.]+\b/i;
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
  // The catch-all counts words, so a contraction decides the turn on
  // punctuation alone: "what's on peg-a" counts 3 and gets the orientation
  // card, "what is on peg-a" counts 4 and gets the answer. Write the
  // contraction out for the count only.
  //
  // The count is the whole reason this is expandContractions and not
  // normalizeQuery: the fuller pass strips filler, which takes the count DOWN,
  // and sends "please describe a dog" and "tell me about a dog" to the card
  // instead. `q` itself is left alone so the GREET/THANKS/OK_ACK membership
  // above reads the text as typed, and looksCodeish reads `raw`.
  return expandContractions(q).split(/\s+/).filter(Boolean).length <= 3 && !codeish;
}

/** The tmct tools dispatchTool can back (the set a tool-emitting caller may use).
 *  A declared tool outside this set is never emitted — the request falls through
 *  to a text answer. The COMMANDS map names the richer graph tools; TOOLS names
 *  the hot catalog. Their union is what dispatchTool serves. */
const BACKED_TOOLS = new Set([
  ...TOOLS.map((t) => t.name),
  ...Object.values(COMMANDS).map((s) => s.tool),
]);

/**
 * Decide whether a user turn maps to a DECLARED, dispatch-backed graph-query
 * tool, and bind its arguments. Deterministic, in-ethos (no NL guessing beyond
 * the chat surface's own command routing):
 *
 *   1. A slash/bare command that names a tmct tool ("describe X", "/callers X",
 *      "untested") → that tool with its argument bound from the exact arg key the
 *      dispatchTool switch reads (COMMANDS above). Only when the tool is
 *      declared by the caller.
 *   2. Otherwise, a non-conversational structural question → tmct_ask{query:…},
 *      when tmct_ask is declared. Small-talk (isConversational) never emits a
 *      call — it falls through to a text answer.
 *
 * Returns { name, input } or null (→ answer as text).
 */
export function selectTool(text, declaredNames) {
  const t = String(text || "").trim();
  if (!t) return null;

  // 1. explicit command form → a specific tool, argument bound
  const cmdLine = t.startsWith("/") ? t : asBareCommand(t);
  if (cmdLine) {
    const [first, ...restTok] = cmdLine.replace(/^\//, "").split(/\s+/);
    const spec = COMMANDS[String(first).toLowerCase()];
    if (spec && declaredNames.has(spec.tool) && BACKED_TOOLS.has(spec.tool)) {
      const input = {};
      if (spec.arg) {
        const val = restTok.join(" ").trim();
        if (val) input[spec.arg] = val;
        // an entity command with no argument can't bind a call — fall through
        else if (!spec.optional) return askFallback(t, declaredNames);
      }
      return { name: spec.tool, input };
    }
  }

  // 2. structural question → tmct_ask, unless it's small-talk
  return askFallback(t, declaredNames);
}

/** The tmct_ask fallback: emit tmct_ask{query} for a non-conversational line when
 *  the caller declared tmct_ask; otherwise null (→ text answer). */
function askFallback(text, declaredNames) {
  if (declaredNames.has("tmct_ask") && BACKED_TOOLS.has("tmct_ask") && !isConversational(text)) {
    return { name: "tmct_ask", input: { query: text } };
  }
  return null;
}

/** The live tool-layer dependencies buildCapabilityPlanCtx (router/drive.mjs)
 *  needs injected: the real dispatchTool, the ToolError classifier, the command
 *  register, and the memory-store readers the taught world-goal lane reloads
 *  per request. The router itself stays pure; every caller that wants the real
 *  tool layer spreads these into its ctx build. */
export function capabilityPlanDeps() {
  return {
    source: defaultSource,
    dispatchTool,
    isToolError: (e) => e instanceof ToolError,
    selectTool,
    loadMemory: loadMemoryStore,
    readFactRows: readStoredFactRows,
    readRuleRows: readStoredRuleRows,
  };
}

/** Scoped exemption for the bare-meta-fact lane (2b/2c, further down this file)
 *  ONLY — never a change to looksCodeish()/isConversational() themselves, and
 *  never used for the generic orientation-card fallback. A bare "what is
 *  TaskController?" (CamelCase COMPOUND class name, no article) hits
 *  looksCodeish()'s `/[a-z][A-Z]/` branch, so isConversational() returns false
 *  and the whole isConversationalCandidate gate — including the bare-meta-fact
 *  lookup that "what is a TaskController" (articled) already resolves through
 *  — never runs. This re-tests the SAME non-CamelCase codeish reasons (paths,
 *  dotted refs, `()` calls, STRUCT_WORDS) looksCodeish already covers, so a
 *  genuine near-miss structural question ("what is foo.bar()", "what is
 *  import") is unaffected. */
function isBareCamelCaseMetaQuestion(query) {
  const raw = String(query).trim();
  const q = raw.toLowerCase().replace(/[.!?]+$/, "").trim();
  const nonCamelCodeish = /[_./]|\(\)/.test(raw) || q.split(/\s+/).some((w) => STRUCT_WORDS.has(w));
  if (nonCamelCodeish || q.split(/\s+/).filter(Boolean).length > 3) return false;
  return BARE_WHATIS_RE.test(raw) || IS_ADJECTIVE_YESNO_RE.test(raw);
}

/** The same scoped exemption for the WRAPPERLESS form, lane (2c) only: a bare
 *  "TaskController" typed on its own. isBareCamelCaseMetaQuestion above needs a
 *  "what is X" / "is X <adjective>" wrapper, so a bare CamelCase name still
 *  stops at looksCodeish()'s `/[a-z][A-Z]/` branch while its lowercase twin
 *  ("task") reaches the lane and answers.
 *
 *  A single unbroken word is the whole shape (2c looks the raw line up as a
 *  label), and that shape is what keeps the exemption at the CamelCase reason
 *  and nothing else: a path, a dotted ref, a `()` call or any multi-word
 *  near-miss structural question ("what is import") can't be one bare word, and
 *  every STRUCT_WORDS member is lowercase, so the CamelCase requirement leaves
 *  them all where they are. Lane (2c) still only diverts on a real, unique
 *  graph hit — an unknown CamelCase word answers exactly as it does now. */
function isBareCamelCaseEntityName(query) {
  const raw = String(query).trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) return false;
  return /[a-z][A-Z]/.test(raw);
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
const T_DISMISSAL = "conversational-dismissal";
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
/** Confirms the honest-miss promise itself when a user asks about it directly
 *  ("can you make up an answer if you don't know"). Same "works regardless of
 *  graph state" family as the identity answers just above. */
const T_IDENTITY_HONEST_MISS = "identity-honest-miss";
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
  // "brilliant" — a UK-English enthusiasm interjection functioning as a bare
  // acknowledgement, the same shape as "nice"/"cheers" just above.
  "brilliant",
  // "ta for that" — "cheers for that" was already here, but its "ta" sibling
  // (both dropped-word forms of the SAME "thanks for that" shape) was missing.
  "ta for that",
  // A natural session-closing remark — the LAST turn of a session is a bad
  // place to end on the raw grammar wall instead of a warm sign-off.
  "cheers, that's everything for now, thanks",
  "that's everything for now, thanks",
  "that's all for now, thanks",
]);
/** Farewells → a goodbye AND a clean end of session (same path as /exit). */
const BYE = new Set([
  "bye", "goodbye", "quit", "exit", "see ya", "see you", "cya", "later", "farewell",
  "peace", "peace out", "im off", "i'm off", "gtg", "gotta go", "catch you later",
  "farewell then",
  // "gtg thx" — the SAME "gtg" farewell above, immediately followed by a
  // thanks word with no delimiter between them (so farewellOrThanksSignal's
  // comma/semicolon clause split never sees two clauses to work with).
  // Whole-phrase entry rather than a general "bye word + thanks word, no
  // delimiter" mechanism — closed and hand-curated, this exact reported
  // phrasing only.
  "gtg thx",
  // "good day to you" deliberately does NOT live here: it's a formal-register
  // GREETING, not a farewell. foldedBye is checked before GREET in
  // conversationalTurn, so having it here would silently end the session on
  // a plain formal greeting — every turn piped after it dropped with no log
  // entry, a worse outcome than any wall.
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
  // "haha ok fair enough" — a laughter beat leading a two-word ack ("fair
  // enough") that dismissalSignal's own peeling can't reach: it peels
  // single-WORD fluff off each end, but "fair enough" is itself two words.
  // Whole-phrase entry, closed and hand-curated, this exact reported phrasing.
  "haha ok fair enough",
]);
/** Dismissals — "drop it, no question here" beats. Routed to a warm dismissal
 *  template, never the identity/orientation blurb (which reads like the tool
 *  didn't understand the user was bowing out). Single-word entries also match as
 *  tokens inside a short mixed line ("ok nvm"); multi-word entries match whole. */
const DISMISSAL = new Set([
  "nvm", "nevermind", "never mind", "nm", "forget it", "forget that",
  "no worries", "no worry", "skip it", "leave it", "don't worry", "dont worry",
  "no biggie", "it's fine", "its fine", "never mind then", "nvm then",
]);
/** Laughter beats — on their own, or leading/trailing a dismissal/ack ("lol ok",
 *  "haha nvm"), they carry no graph intent. */
const LAUGHTER = new Set([
  "lol", "lolol", "lmao", "lmfao", "rofl", "haha", "hahaha", "hah",
  "heh", "hehe", "ha", "hehehe",
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

/** THANKS/BYE are exact-match-the-WHOLE-line closed sets, which keeps failing
 *  on any unlisted phrasing tacked onto a larger sentence ("thanks, that was
 *  fun", "ok thank you very much, bye bye", "thanks, bye"). This generalizes
 *  over PHRASE SHAPE (a thanks/bye clause tacked onto a larger sentence), not
 *  another one-off literal string:
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
 *  null; bye wins when a line carries both — a farewell should end the
 *  session even alongside a thanks. */
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
 *  the gate would otherwise reject them. */
const CLOSING_FILLER_CLAUSES = new Set([
  "that's everything for now", "that's all for now",
  "that's everything i needed", "that's all i needed",
  "that's everything for today", "that's all for today",
  // "thats enough for now" — the same closing-filler shape, worded around
  // "enough" instead of "everything"/"all", and without the apostrophe a
  // casual typer routinely drops (conversationalTurn's own `q` never runs an
  // apostrophe/contraction pass, so both spellings are curated explicitly).
  "that's enough for now", "thats enough for now",
]);
/** Strip a hedging lead ("i think that's everything for today" → "that's
 *  everything for today") so a hedged closing clause still matches the closed
 *  set above — the hedge is register, not new content. */
const CLOSING_HEDGE_RE = /^i (?:think|reckon|guess|believe|suppose|figure) /;
const isClosingFillerClause = (c) => CLOSING_FILLER_CLAUSES.has(c) || CLOSING_FILLER_CLAUSES.has(c.replace(CLOSING_HEDGE_RE, ""));
/** A thanks clause's optional "for … help" tail ("thanks so much for the help",
 *  "thanks for all your help") — stripped before the closed THANKS lookup so the
 *  bare "thanks" underneath matches. */
const THANKS_HELP_TAIL_RE = /\s+for\s+(?:the\s+|your\s+|all\s+|all\s+the\s+|all\s+your\s+)?help\s*$/i;
function farewellOrThanksSignal(raw, q) {
  const words = q.split(/\s+/).filter(Boolean);
  // The upper bound is generous because the real safety is the per-clause gate
  // below (every non-thanks clause must itself be small-talk-shaped or a curated
  // closing-filler clause), not the total word count.
  if (words.length < 2 || words.length > 16 || looksCodeish(raw, q)) return null;
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
    const deIntensified = clause.replace(THANKS_HELP_TAIL_RE, "").replace(TRAILING_INTENSIFIER_RE, "").trim();
    if (thanksClauseIdx < 0 && closedOrCollapsed(deIntensified, THANKS, THANKS_COLLAPSED)) thanksClauseIdx = i;
  }
  if (byeHit) return "bye";
  const thanksHit = thanksClauseIdx >= 0 && clauses.every((c, i) => i === thanksClauseIdx
    || isClosingFillerClause(c)
    || (c.split(/\s+/).filter(Boolean).length <= 3 && !looksCodeish(c, c.toLowerCase())));
  return thanksHit ? "thanks" : null;
}

/** A dismissal / laughter beat ("nvm", "lol ok", "haha never mind"): the whole
 *  line, an ack lead-in peeled off a dismissal, or a short line whose every word
 *  is laughter / an ack / a single-word dismissal with at least one laughter or
 *  dismissal word (so a bare "ok"/"sure" still falls to the ack lane, not here).
 *  Never fires on a codeish line. */
function dismissalSignal(q) {
  if (looksCodeish(q, q)) return false;
  if (DISMISSAL.has(q) || LAUGHTER.has(q)) return true;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  const isFluff = (w) => LAUGHTER.has(w) || OK_ACK.has(w);
  let lo = 0;
  let hi = words.length;
  let laughed = false;
  while (lo < hi && isFluff(words[lo])) { if (LAUGHTER.has(words[lo])) laughed = true; lo += 1; }
  while (hi > lo && isFluff(words[hi - 1])) { if (LAUGHTER.has(words[hi - 1])) laughed = true; hi -= 1; }
  const core = words.slice(lo, hi).join(" ");
  // Pure laughter+ack ("lol ok") is a dismissal only when a laughter beat was
  // present — a bare stack of acks ("ok cool") still falls to the ack lane.
  if (core === "") return laughed;
  return DISMISSAL.has(core);
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
  // A live game (adventure/spider-fly/guess-the-number) already recognizes its
  // OWN exact stop phrase ("stop playing", "I give up", ...) before this lane
  // ever sees the line, so a bare word reaching here mid-game was never meant
  // as a farewell — it's an in-game noun that fell through every game-shaped
  // command check (e.g. "player", the adventure's own subject). The fuzzy-typo
  // fallback below is a GUESS (bounded edit distance against "later" etc.),
  // and a wrong guess ends the whole session — too costly a mistake to risk
  // mid-game. The exact/closed-set farewell just above and below this guard
  // stays live either way (a real "bye"/"exit" is unambiguous, never a guess).
  const gameActive = Boolean(ctx.planHolder?.state?.adventure || ctx.planHolder?.state?.spiderFly || ctx.planHolder?.state?.game);
  const t = (id, slots = {}) => tRender(ctx.templates, id, slots) ?? TEMPLATES_UNAVAILABLE;
  const mk = (answer, { end = false, miss = false, via = "template", lane = null } = {}) => {
    const ts = new Date().toISOString();
    return attachDialogueAct({
      answer,
      logLines: [ts, `> ${raw}`, answer, ""],
      record: { type: "turn", ts, query: raw, conversational: true, via, resolvedIds: [], answeredIds: [], miss },
      focus: ctx.focus,
      last: ctx.last, // a conversational turn never overwrites the last real answer
      lane,
      ...(end ? { end: true } : {}),
    }, ctx.trace);
  };
  if (foldedBye(q)) {
    note(ctx.trace, "goal: casual/social — ending the session (no graph intent)");
    note(ctx.trace, "lane: conversational — farewell (BYE closed set, incl. bare reduplication e.g. \"bye bye\")");
    return mk(t(T_FAREWELL), { end: true });
  }
  {
    // A multi-clause line carrying a bye/thanks clause tacked onto a larger
    // sentence ("thanks, that was fun", "ok thank you very much, bye bye",
    // "thanks, bye") — see farewellOrThanksSignal's own docblock. Never fires
    // on a single-clause line (those are the exact checks just above/below),
    // so this only ADDS coverage, never shadows it.
    const signal = farewellOrThanksSignal(raw, q);
    if (signal === "bye") {
      note(ctx.trace, "goal: casual/social — ending the session (no graph intent)");
      note(ctx.trace, "lane: conversational — farewell (multi-clause phrase-shape match)");
      return mk(t(T_FAREWELL), { end: true });
    }
    if (signal === "thanks") {
      note(ctx.trace, "goal: casual/social — acknowledgement, no graph intent");
      note(ctx.trace, "lane: conversational — thanks (multi-clause phrase-shape match)");
      return mk(t(T_THANKS), { lane: "thanks" });
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
      return mk(t(id, { vocabHint: ctx.vocabHint }), { lane: "greeting" });
    }
  }
  {
    // "ok cool thanks" — an ack RUN in front of a bare thanks word: the ack
    // preamble peel (the same closed frames every other surface uses) leaves
    // the thanks word standing, so the stacked form lands where its parts do
    // instead of on the orientation blurb.
    const ackPeeled = applyPreambleFrames(q);
    const thanksHit = closedOrCollapsed(q, THANKS, THANKS_COLLAPSED) || (OK_ACK.has(q) ? q : null)
      || (ackPeeled !== q && (THANKS.has(ackPeeled) || OK_ACK.has(ackPeeled)) ? ackPeeled : null);
    if (thanksHit) {
      note(ctx.trace, "goal: casual/social — acknowledgement, no graph intent");
      note(ctx.trace, `lane: conversational — thanks/acknowledgement (${OK_ACK.has(q) ? "OK_ACK" : "THANKS"} closed set${thanksHit === q ? "" : ", elongation-collapsed"})`);
      note(ctx.trace, `pattern: template "${T_THANKS}" (data/templates/responses.jsonl)`);
      return mk(t(T_THANKS), { lane: "thanks" });
    }
  }
  if (dismissalSignal(q)) {
    note(ctx.trace, "goal: casual/social — dismissal/laughter, no graph intent");
    note(ctx.trace, "lane: conversational — dismissal (DISMISSAL/LAUGHTER closed set)");
    return mk(t(T_DISMISSAL), { lane: "thanks" });
  }
  if (aiIdentityMatch(raw)) {
    note(ctx.trace, "goal: identity — is tmct an AI/LLM (a very likely first question)");
    note(ctx.trace, "lane: conversational — identity/AI (AI_IDENTITY_PHRASES closed set)");
    return mk(t(T_IDENTITY_NOT_LLM), { lane: "help" });
  }
  if (FEELINGS_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — does tmct have feelings/consciousness (small-talk persona finding)");
    note(ctx.trace, "lane: conversational — identity/feelings (FEELINGS_PHRASES closed set)");
    return mk(t(T_IDENTITY_NO_FEELINGS), { lane: "help" });
  }
  if (HONEST_MISS_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — a direct probe of the honest-miss promise itself");
    note(ctx.trace, "lane: conversational — identity/honest-miss (HONEST_MISS_PHRASES closed set)");
    return mk(t(T_IDENTITY_HONEST_MISS), { lane: "help" });
  }
  if (SQL_STATEMENT_RE.test(raw)) {
    note(ctx.trace, "goal: nonsense input shaped like a SQL statement — a targeted decline, not the identity blurb");
    note(ctx.trace, "lane: conversational — SQL-statement decline (SQL_STATEMENT_RE)");
    return mk(
      "That reads like a SQL statement, not a question about a code graph or taught facts. "
      + "Try \"what is a dog\" for vocabulary, or point me at a repo with --repo <path>.",
      { lane: "help" },
    );
  }
  if (ARITHMETIC_RE.test(raw)) {
    note(ctx.trace, "goal: arithmetic — not a code/vocabulary question, an honest decline");
    note(ctx.trace, "lane: conversational — arithmetic decline (ARITHMETIC_RE)");
    return mk(
      "I don't do arithmetic — I answer questions about a code graph or taught facts. "
      + "Try \"what is a dog\" for vocabulary, or point me at a repo with --repo <path>.",
      { lane: "help" },
    );
  }
  if (IDENTITY_PHRASES.some((re) => re.test(raw))) {
    note(ctx.trace, "goal: identity — who/what tmct is, not a capability listing");
    note(ctx.trace, "lane: conversational — identity (IDENTITY_PHRASES closed set)");
    return mk(t(T_IDENTITY_SELF), { lane: "help" });
  }
  {
    const metaHit = META_COMMAND_ANSWERS.find(([re]) => re.test(raw));
    if (metaHit) {
      note(ctx.trace, "goal: meta — does a remembered command/session behavior still hold");
      note(ctx.trace, "lane: conversational — meta-command/session (closed per-command answer set)");
      return mk(metaHit[1], { lane: "help" });
    }
  }
  // CAPABILITY_PHRASES' vague-opener entries are self-contained closed
  // regexes, but a preamble ahead of one ("right, can you walk me through
  // this codebase" — an ACK_PREAMBLE_RE + MODAL_WRAPPER_RE stack) is tested
  // nowhere upstream of this check, unlike vagueTouchTermOf/describeWrapperAnswer
  // (both run applyPreambleFrames first). Trying the SAME closed set again
  // against the preamble-stripped text is purely additive.
  if (q === "help" || q === "?" || CAPABILITY_PHRASES.some((re) => re.test(raw))
    || CAPABILITY_PHRASES.some((re) => re.test(applyPreambleFrames(raw))) || ORIENT_OPENERS.has(q)) {
    note(ctx.trace, "goal: get oriented — what can tmct answer, how do I start");
    note(ctx.trace, "lane: conversational — help/orientation (CAPABILITY_PHRASES/ORIENT_OPENERS / bare help / ?)");
    return mk(orientationAnswer(ctx.templates, ctx.graph, ctx.vocabHint), { lane: "help" });
  }
  // Fuzzy-typo fallback (A4): every exact/collapsed closed-set lookup above missed —
  // try a bounded edit-distance match against the flattened conversational phrase
  // pool ("helo", "thnx", "wat r u", "byee"), restricted to short non-code-ish
  // input so a genuine near-miss structural question is never grabbed. Skipped
  // entirely mid-game (see gameActive above) — never reached the CLI's own
  // process-exit path from a guess before this fix existed.
  if (!gameActive) {
    const fuzzyHit = fuzzyConversationalMatch(raw);
    if (fuzzyHit) {
      const bucket = classifyConversational(fuzzyHit);
      note(ctx.trace, `goal: casual/social or orientation — fuzzy-typo match "${raw}" → "${fuzzyHit}"`);
      note(ctx.trace, `lane: conversational — fuzzy typo tolerance (${bucket})`);
      if (bucket === "bye") return mk(t(T_FAREWELL), { end: true });
      if (bucket === "thanks") return mk(t(T_THANKS), { lane: "thanks" });
      if (bucket === "identity") return mk(t(T_IDENTITY_SELF), { lane: "help" });
      if (bucket === "capability") return mk(orientationAnswer(ctx.templates, ctx.graph, ctx.vocabHint), { lane: "help" });
      const id = (!T_GREETING_BY_PHRASE[fuzzyHit] && noCodeGraph(ctx.graph)) ? T_GREETING_EMPTY : (T_GREETING_BY_PHRASE[fuzzyHit] || T_GREETING);
      return mk(t(id, { vocabHint: ctx.vocabHint }), { lane: "greeting" });
    }
  }
  return null;
}

// ---- #1/#2/#3 conversational-UX helpers: module-aware orientation, the short
// tailored miss, and the intent lanes (teach + meta/self). All are recognizer-
// gated and (for the lanes) only consulted on a would-miss, so ordinary graph
// queries are never hijacked. ----

export { moduleCountOf };

/** A KNOWN-empty code graph: a loaded graph object with 0 modules. A null graph
 *  (a bare runTurn that wasn't handed one) is "unknown", NOT empty — the empty
 *  orientation/greeting only fires when we actually hold an empty graph. */
const noCodeGraph = (graph) => !!graph && moduleCountOf(graph) === 0;

/** LIVE orientation examples: the example queries on the orientation card name
 *  entities from the LOADED graph — the sorted-first Module label and the
 *  sorted-first Function/Method label, deterministically — so a stranger who
 *  types them verbatim gets a real answer on ANY graph. A null (unknown)
 *  graph keeps the generic pair byte-for-byte. */
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
  + "For code structure (imports, calls, definitions) run `tmct index` here, point me at a repo with `--repo <path>`, "
  + "or try the shipped example `npm run example:mini`. /help for commands.";

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

/** A friendly, prose-shaped condensation of renderDescribe's edge counts
 *  (codegraph.mjs) — defines/imports/reexports
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
  const cls = classDisplayName(ind.class || "entity");
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
 *  (…):\n  Q: …\n  A: …\n\n"), so the wall-repeat check that inspects the
 *  PREVIOUS turn's `last.answer` needs the unanchored form to still recognize
 *  it as a wall repeat. */
const WALL_MISS_ANYWHERE_RE = /couldn't parse this as a graph question\. Try:/;

// #2 INTENT LANE — MEMORY/TEACH. "remember that X is a Y", "note that …", or a
// bare "X is a Y" declarative the graph parser couldn't handle → route to the
// assert/memory path; when it can't be stored, say what CAN be remembered
// instead of the grammar wall or a silent data loss.
const TEACH_RE = /^(?:please\s+)?(?:i\s+(?:want|wanted)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)?(?:remember|note|keep in mind|jot down|for the record|fyi|learn|teach(?:\s+me)?)\b(?:\s+(?:this|that|also))?[:,]?\s*(?:that\s+)?(.+?)[.?!]*$/i;
// A trailing sentence-final mark ([.!?]*) is tolerated at the very end: an
// ordinary first turn typed as a full sentence ("every dog is a mammal.")
// otherwise failed this shape test by one character whenever neither ACE nor
// the wrapped path could take it first, so teachLane bailed out (payload
// stayed null) before ever trying the unknown-subject/object mint fallbacks
// below — the SAME sentence typed without the period worked. Mirrors
// UNKNOWN_SUBJECT_RE's own identical tolerance, added for the same reason.
const BARE_DECLARATIVE_RE = /^(?:every |each |all |a |an )?[\w-]+(?: [\w-]+)? (?:is|are) (?:a |an )?[\w-]+(?: too)?[.!?]*$/i;
/** "X is <comparative> than Y" — the comparative teach/ask surface. The
 *  comparative slot is closed by SHAPE (-er word, better/worse, or a
 *  more/less + adjective pair), never a hand-list of adjectives. */
const COMPARATIVE_SRC = "(?:[a-z]+er|better|worse|(?:more|less)\\s+[a-z]+)";
const COMPARATIVE_TEACH_RE = new RegExp(`^(?:the\\s+|an?\\s+)?([\\w'-]+(?:\\s+[\\w'-]+)?)\\s+(?:is|are)\\s+(${COMPARATIVE_SRC})\\s+than\\s+(.+)$`, "i");
const COMPARATIVE_ASK_RE = new RegExp(`^(?:is|are)\\s+(.+?)\\s+(${COMPARATIVE_SRC})\\s+than\\s+(.+?)[?.!\\s]*$`, "i");
/** The one closed preposition set shared by every frame that folds a
 *  preposition into a minted predicate (the general-verb teach/query lanes
 *  and the action-rule frames) — a single source so the set never forks. */
const PREP_SRC = "on|in|at|onto|upon|under|over|beside|near|behind|above|below|inside|outside";
/** Interrogative / auxiliary leads that make an "X is a Y"-shaped line a QUESTION
 *  ("what is a cache", "is a module a component"), never a teach declarative. */
const QUESTION_LEAD_RE = /^(?:what|who|which|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have)\b/i;
/** A plain declarative "X is a kind of Y" / "X is a Y" shape (subject-first, no
 *  question lead — paired with QUESTION_LEAD_RE at every call site), tolerating
 *  an infix "kind of"/"type of" (teachLane's own stripKindOf handles this same
 *  infix ahead of its narrower recognizers — this is a cheap TRIGGER check only,
 *  not a storage decision). Used by runAsk's relaxedTeachCollision guard (below)
 *  to recognize when a query the ask engine "answered" via relaxation was
 *  actually a teach-shaped sentence, not a real question. */
// The object takes 1–2 tokens: the shipped hanoi recipe's own "a disk is a
// kind of game piece" is exactly this shape, and a single-token object left
// its sentence-pair line unsplittable (the split gate reads this regex).
const DECLARATIVE_KIND_OF_RE = /^(?:every\s+|each\s+|all\s+|a\s+|an\s+)?[\w-]+(?:\s+[\w-]+)?\s+(?:is|are)\s+(?:an?\s+)?(?:(?:kind|type)\s+of\s+)?[\w-]+(?:\s+[\w-]+)?[.!]*$/i;
/** A bare wh-word token, tested one word at a time against `hasMidSentenceInterrogative`'s
 *  own tokenization below — never re-anchored, so it matches at ANY word position. */
const MID_SENTENCE_WH_RE = /^(?:which|who|what|where|when|why|how)$/i;
/** QUESTION_LEAD_RE (just above) is anchored to the FIRST word, so a wh-word
 *  appearing LATER in the sentence ("it uses WHICH controller as its base")
 *  slips past every teachLane guard that reuses it. Detects a genuine
 *  mid-sentence INTERROGATIVE use of a wh-word via wink's POS tagger (the
 *  SAME optional adapter subjectIsNounOrPropn/objectReadsAsNonNoun below use,
 *  ask-nlp.mjs's nlpAdapter): whichever wh-word tokens appear after the first
 *  word, check whether the token immediately BEFORE each is tagged VERB or
 *  AUX. A wh-in-situ interrogative object/adjunct ("uses WHICH controller",
 *  "is used by WHICH module") always immediately follows the verb it's an
 *  argument of; a RELATIVE pronoun introducing a restrictive clause ("the
 *  handler WHICH processes requests", "a grandparent WHO is male") always
 *  immediately follows the NOUN it modifies instead. Checking the preceding
 *  tag is a real, if imperfect, way to tell the two apart. No wink installed,
 *  or any tagging surprise, degrades to false — no signal, never a false
 *  positive from a missing adapter. */
async function hasMidSentenceInterrogative(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const whIdx = [];
  for (let i = 1; i < words.length; i += 1) {
    if (MID_SENTENCE_WH_RE.test(words[i].replace(/^[.,!?;:'"]+|[.,!?;:'"]+$/g, ""))) whIdx.push(i);
  }
  if (!whIdx.length) return false;
  // A wh-word opening a NEW CLAUSE ("I'm new here, what should I read
  // first") is an interrogative clause, full stop — no POS evidence needed:
  // the clause boundary (the preceding word's trailing comma/semicolon) is
  // itself the signal, and it holds with or without the wink adapter.
  if (whIdx.some((i) => /[,;:]["')]*$/.test(words[i - 1]))) return true;
  try {
    const { nlpAdapter } = await import("../adapters/ask-nlp.mjs");
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
// HAS_A_PREDICATE (imported from memory/core.mjs, the canonical home) keeps
// generalVerbTeach's "has"/"have" special case in the same family ConceptNet's
// /r/HasA corpus facts already use, rather than minting a redundant mgx:has.

// mgx:sourceType's own closed kind set (memory/core.mjs) splits "the operator
// said it" across two tags depending which lane wrote it (ace: -> "operator",
// teach: -> "teach"), plus "entailed" for a prior tmct-syllogise derivation —
// none of those are corpus/web noise, so all three count as taught here,
// regardless of whether the SAME fact ALSO merged in a corpus/web source for
// the same (subject, predicate, object) triple (appendFact's duplicate-fact
// upsert unions sources rather than duplicating the fact).
const TAUGHT_SOURCE_TYPES = new Set(["operator", "teach", "entailed"]);
const isOperatorTaught = (f) => !!f.sourceTypes?.some((t) => TAUGHT_SOURCE_TYPES.has(t));

/** Two subClassOf edge sets for the relation-alias chase: `strictEdges` (only
 *  operator-taught) and `broadEdges` (every edge, corpus included). A fact
 *  merged from both corpus and operator sources carries an operator source
 *  too, so it resolves via the strict tree exactly like a purely-taught fact
 *  — the broad tree exists only to ALSO reach a hop that was never taught at
 *  all, framed as general knowledge rather than "you told me". */
function buildAliasSubClassTrees(rows, predicate = SUBCLASS_PREDICATE) {
  const strictEdges = [];
  const broadEdges = [];
  for (const f of rows) {
    if (f.predicate !== predicate) continue;
    broadEdges.push([f.subject, f.object]);
    if (isOperatorTaught(f)) strictEdges.push([f.subject, f.object]);
  }
  return { strictEdges, broadEdges };
}

/** Chase `role` toward `targetSet` over the strict (taught-only) tree first,
 *  falling back to the broad tree only when the strict chase comes up empty
 *  — the strict attempt is tried first specifically so a hop resolvable
 *  either way still cites via the (fuller-provenance) taught path. */
function chaseAliasEitherTree(chaseFn, role, targetSet, trees, opts) {
  return chaseFn(role, targetSet, [], trees.strictEdges, opts)
    || chaseFn(role, targetSet, [], trees.broadEdges, opts);
}

/** "<Name> owns/maintains <X>" — the ownership teach declarative. <Name> is one
 *  or two name tokens; <X> is a code-ish token (a path, a file, a symbol) OR a
 *  short natural noun phrase ("the tasks handler"). generalVerbTeach stands
 *  down for "owns"/"maintains" anywhere in the sentence, deferring entirely
 *  to this frame. The article-stripping needed so "the tasks handler" reads
 *  back the same as a bare "tasks handler" is handled once, centrally, by
 *  normFactTerm (memory/core.mjs) — teachFact already normalizes both
 *  subject and object through it. The BARE form additionally requires a
 *  Capitalized name (see teachLane), so ordinary lowercase prose never lands
 *  a fact without the explicit wrapper. */
const OWNS_TEACH_RE = /^([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)\s+(?:owns|maintains)\s+(.+?)[.!?]*$/;
/** "<X> is owned by <Name>" — the PASSIVE ownership teach declarative, at
 *  least as natural a way to state ownership as the active "<Name> owns <X>"
 *  above. <X> (the owned thing) is a lazy multi-word capture, same
 *  discipline OWNS_TEACH_RE's own object uses; <Name> (the owner) mirrors
 *  OWNS_TEACH_RE's own 1-2-token name capture. Stores the SAME
 *  OWNED_BY_PREDICATE shape (subject=thing, object=owner), so "who owns X" /
 *  the yes/no readers below answer either phrasing identically. */
const OWNS_PASSIVE_TEACH_RE = /^(.+?)\s+(?:is|are|was|were)\s+owned\s+by\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)[.!?]*$/i;

/** "<Name> is the <role> of <Name>" — the relational-fact teach declarative:
 *  a NAMED relationship between two entities ("ahab is the father of john"),
 *  grouped here with the other relational/possessive teach shapes above
 *  (ownership) since it's tried on the SAME ownSrc in teachLane, right after
 *  OWNS_PASSIVE_TEACH_RE — unconditionally ahead of generalVerbTeach's own
 *  call site. The literal "the" + bare role-noun +
 *  "of" anchor is deliberate: a future composition-rule teach shape ("a
 *  <rule> is a <relation> of a <relation>") uses an INDEFINITE "a"/"an" in
 *  the same slot instead, so the two shapes structurally can never collide —
 *  this regex must keep requiring literal "the", never "a"/"an". Subject/
 *  object each use the SAME 1-2-token name-capture convention OWNS_TEACH_RE's
 *  own subject/owner already use. */
const RELATION_FACT_TEACH_RE =
  /^([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+(?:is|are|was|were)\s+the\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[.!?]*$/i;

/** The GENITIVE surfaces of the same relational fact — "ahab is john's
 *  father" and "john's father is ahab" both state exactly what "ahab is the
 *  father of john" states, so both store through the identical
 *  generalVerbPredicate mint (subject=ahab, relation=father, object=john).
 *  Same 1-2-token name captures as RELATION_FACT_TEACH_RE; the role slot is
 *  the same lowercase bare noun. The possessive's own token deliberately
 *  excludes apostrophes ([\w-]+, not [\w'-]+) so the 's split is unambiguous. */
const GENITIVE_RELATION_TEACH_RE =
  /^([\w-]+(?:\s+[A-Z][\w-]*)?)\s+(?:is|was)\s+([\w-]+(?:\s+[A-Z][\w-]*)?)'s\s+([a-z][\w-]*)[.!?]*$/i;
const GENITIVE_RELATION_TEACH_REV_RE =
  /^([\w-]+(?:\s+[A-Z][\w-]*)?)'s\s+([a-z][\w-]*)\s+(?:is|was)\s+([\w-]+(?:\s+[A-Z][\w-]*)?)[.!?]*$/i;

/** The VERB-INFLECTED surface of the same relational fact — "ahab fathered
 *  john" states what "ahab is the father of john" states, so it stores
 *  through the identical generalVerbPredicate mint. Same 1-2-token name
 *  captures as RELATION_FACT_TEACH_RE on both sides; the verb slot requires
 *  a literal "-ed" tail, so a present-tense "john likes mary" never matches
 *  (that bare shape stays wrapper-required — see the nudge in runAsk). The
 *  regex is only the SHAPE trigger: matchRelationalVerbTeach (below) adds
 *  the determiner/closed-class/POS guards that keep "the build failed
 *  yesterday" and "john failed spectacularly" out. */
const RELATION_VERB_TEACH_RE =
  /^([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+([a-z][\w-]*ed)\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[.!?]*$/i;

/** Closed past-tense strip: "<base>ed" (fathered → father), the doubled-
 *  consonant form (hopped → hop), and the -ied fold (carried → carry).
 *  Returns null when the word doesn't carry a strippable "-ed" tail at all.
 *  Deliberately naive (same accepted trade as singularizeSurface) — callers
 *  prefer wink's lemma when it's available and only lean on this strip as
 *  the shape check / fallback. */
function pastVerbBase(verb) {
  const v = String(verb || "").toLowerCase();
  const m = v.match(/^([a-z][a-z-]*)ed$/);
  if (!m || m[1].length < 2) return null;
  const stem = m[1];
  if (/([b-df-hj-np-tv-z])\1$/.test(stem)) return stem.slice(0, -1);
  if (/[^aeiou]i$/.test(stem)) return `${stem.slice(0, -1)}y`;
  return stem;
}

/** "every/a/an/the <N1> has a/an <N2> method" — the HAS-A-METHOD teach
 *  declarative: a possession-of-capability claim about a class/entity's
 *  method ("every Component has a render method", "a Widget has a render
 *  method"). RELATION_FACT_TEACH_RE (above) requires a literal "is/are the
 *  ROLE of", never "has a ROLE method"; GENERAL_VERB_TEACH_RE (below) maps
 *  "has"/"have" onto the same HAS_A_PREDICATE this pattern uses, but only
 *  for a BARE, wrapper-required, single-token subject with NO leading
 *  determiner, so a determiner-led sentence like this one needs its own
 *  recognizer or it falls through to ask.mjs's structural "defines" grammar
 *  and reports a vague, non-actionable "couldn't resolve one of the terms in
 *  this question" wall.
 *
 *  Deliberately a NARROW, EXPLICIT pattern (this project's discipline: small
 *  curated closed-set patterns, each independently tested, never one
 *  generalized catch-all) — the literal trailing word "method" is the anchor
 *  that keeps this pattern structurally DISJOINT from generalVerbTeach's
 *  broader "X has a Y" territory (an ordinary "TaskController has a hat"
 *  still never matches here, and falls through to generalVerbTeach
 *  unaffected). Tried on the SAME ownSrc the other relational/possessive
 *  teach shapes above already use, ahead of generalVerbTeach's own call site.
 *
 *  Predicate minting reuses the EXISTING HAS_A_PREDICATE (mgx:hasA) —
 *  generalVerbTeach's own has/have special case already mints this, so a fact
 *  taught via either recognizer reads back interoperably. m[1] = the subject
 *  (N1, "Component"); m[2] = the capability word (N2, "render") — stored as
 *  the object `"<N2> method"` ("render method"), so the query-side readers
 *  below (HAS_METHOD_YESNO_RE/HAS_METHOD_OPEN_RE) can match on the whole
 *  "<capability> method" phrase, never just the bare capability word. */
const TEACH_HAS_METHOD_RE =
  /^(?:every\s+|each\s+|all\s+|a\s+|an\s+|the\s+)?([A-Za-z][\w'-]*)\s+has\s+an?\s+([a-z][\w-]*)\s+method[.!?]*$/i;

/** "a <name> is a <base1> of a <base2>" — the fixed-hop COMPOSITION-RULE teach
 *  declarative: "a grandparent is a parent of a parent" teaches a RULE
 *  (mgx:ruleKind "compose2"), never a Fact — the query side chases it via a
 *  hop-counted findActionPath search (see teachLane's own call site below
 *  and factReadBack's relational-query dispatcher). Both slots use an
 *  INDEFINITE article ("a"/"an"), the structural anchor that keeps this
 *  shape disjoint from RELATION_FACT_TEACH_RE just above: that regex
 *  requires a literal "the" + a lone role word with no second "of"-clause;
 *  this one requires "a"/"an" in BOTH determiner slots plus a second
 *  relation-name word after "of" — the two can never both match the same
 *  input. m[1] = the new rule name ("grandparent"), m[2]/m[3] = the two base
 *  relation names ("parent", "parent" — may differ, e.g. an out-of-scope "an
 *  aunt is a sibling of a parent"). */
const COMPOSE2_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+([a-z][\w-]*)[.!?]*$/i;

/** "a <name> is a <base> who is <property>" — the PROPERTY-FILTERED
 *  composition-rule teach declarative: "a grandfather is a grandparent who
 *  is male" teaches a RULE (mgx:ruleKind "filter"), never a Fact. `m[1]` =
 *  the new rule name ("grandfather"), `m[2]` = the base rule/relation name
 *  ("grandparent" — may itself resolve as EITHER a plain taught relation OR
 *  another Rule, e.g. a compose2 rule; the query-side dispatcher below
 *  handles either generically), `m[3]` = the property literal ("male").
 *  Structurally disjoint from COMPOSE2_RULE_TEACH_RE (anchored on a literal
 *  "who", never "of" a second time) and from RECURSIVE_RULE_TEACH_RE below
 *  (anchored on "or", never "who") — the three rule-teach shapes are told
 *  apart purely by their own distinct anchor word ("of" only / "who" / "or …
 *  of … <same name>"). */
const FILTER_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+who\s+(?:is|are)\s+([a-z][\w-]*)[.!?]*$/i;

/** "a <name> is a <baseCase>, or a <recStep> of a <name>" — the
 *  RECURSIVE/REACHABILITY rule teach declarative: "a descendant is a parent,
 *  or a parent of a descendant" teaches a RULE (mgx:ruleKind "recursive"),
 *  never a Fact. The rule's OWN name reappears inside its own definition —
 *  the `\1` backreference requires the recursive slot's trailing name to be
 *  the LITERAL SAME word as `m[1]`, so a mismatched/malformed self-reference
 *  ("a descendant is a parent, or a parent of a person") simply never
 *  matches this regex at all — an honest structural decline, not a runtime
 *  guess. `m[1]` = the new rule name ("descendant"), `m[2]` = the base-case
 *  relation ("parent", hop zero), `m[3]` = the recursive step's first-hop
 *  relation ("parent" again in the illustration, though `m[2]`/`m[3]` are
 *  independently captured and need not be identical to each other — only
 *  `m[1]`'s OWN name must recur at the end). Query side is a genuine
 *  KIND-CHANGE (reachability-SET enumeration via `findReachableSet`,
 *  src/domain/planning.mjs) from the single-target search above — see the
 *  RECURSIVE_LIST_ASK_RE query recognizer, below. */
const RECURSIVE_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*),?\s+or\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+\1[.!?]*$/i;

/** ACTION-RULE TEACH FRAMES — a world-mutating action taught one sentence at
 *  a time, each sentence its own Rule individual (kind action-signature /
 *  action-precond / action-effect / action-constraint) sharing one rule name ("<verb> <prep>",
 *  e.g. "move onto"). src/domain/domain.mjs collects the family by name
 *  (findRulesByName) and grounds it over class members at plan time; nothing
 *  in the teach lane executes an action. Predicate slot values are stored
 *  BARE ("rest-on") because normFactTerm strips a mgx: prefix from slot
 *  values; readers re-attach it. The class/role words are single tokens, the
 *  preposition set is PREP_SRC, the comparative slot is COMPARATIVE_SRC. */
const ACTION_SIGNATURE_TEACH_RE = new RegExp(
  `^you\\s+(?:can|may)\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)[.!?]*$`, "i");
// The passive voicing of the same signature ("a disk can be moved onto a
// peg"): class first, participle verb. Minted through the same actionLemma
// authority so both voicings land on one rule name.
const ACTION_SIGNATURE_PASSIVE_RE = new RegExp(
  `^an?\\s+([a-z][\\w-]*)\\s+(?:can|may)\\s+be\\s+([a-z]+)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)[.!?]*$`, "i");
const ACTION_PRECOND_NOTHING_RE = new RegExp(
  `^to\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s*,?\\s*nothing\\s+may\\s+([a-z]+)\\s+(${PREP_SRC})\\s+the\\s+([a-z][\\w-]*)[.!?]*$`, "i");
const ACTION_PRECOND_COMPARATIVE_RE = new RegExp(
  `^to\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s*,?\\s*the\\s+([a-z][\\w-]*)\\s+must\\s+be\\s+(${COMPARATIVE_SRC})\\s+than\\s+the\\s+([a-z][\\w-]*)[.!?]*$`, "i");
const ACTION_EFFECT_TEACH_RE = new RegExp(
  `^([a-z]+ing)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s+makes\\s+(?:it|the\\s+([a-z][\\w-]*))\\s+([a-z]+)\\s+(${PREP_SRC})\\s+the\\s+([a-z][\\w-]*)[.!?]*$`, "i");
/** "to ferry a passenger onto a bank, the wolf may not be with the goat
 *  without the farmer" — the co-location CONSTRAINT sentence (kind
 *  action-constraint): after a move, <left> and <right> may not share a
 *  position unless <guard> is there too. All three trailing words name a
 *  class whose sole member src/domain/domain.mjs binds at plan time. Disjoint from
 *  the two precondition frames above by anchor phrase alone ("may not be
 *  with … without", never "nothing may" or "must be … than") — PREP_SRC has
 *  no "without", so the preposition captures can't collide either. */
const ACTION_CONSTRAINT_TEACH_RE = new RegExp(
  `^to\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s*,?\\s*the\\s+([a-z][\\w-]*)\\s+may\\s+not\\s+be\\s+with\\s+the\\s+([a-z][\\w-]*)\\s+without\\s+the\\s+([a-z][\\w-]*)[.!?]*$`, "i");
/** "a disk renders as a block" — the render-template binding, an ordinary
 *  Fact on the curated mgx:rendersAs predicate (camelCase, so the
 *  general-verb preposition fold can never suffix it). */
const RENDERS_AS_TEACH_RE = /^an?\s+([a-z][\w-]*)\s+renders\s+as\s+an?\s+([a-z][\w-]*)[.!?]*$/i;
// Bare-copula instance membership: the subject MUST contain a hyphen
// (disk-1, peg-a) — see bareTaxonomyTeach's reasoning.
const INSTANCE_TYPE_TEACH_RE = /^([a-z][\w]*(?:-[\w]+)+)\s+is\s+an?\s+([a-z][\w-]+)[.!?]*$/i;
// Bare article-led kind-of taxonomy: "a disk is a kind of game piece".
const BARE_KINDOF_TEACH_RE = /^an?\s+([a-z][\w-]+)\s+is\s+a\s+kind\s+of\s+(?:an?\s+)?([a-z][\w-]+(?:\s+[a-z][\w-]+)?)([.!?]*)$/i;

/** Verb → lemma via the prose adapter, degrading to the word itself. */
async function verbLemma(word) {
  const w = String(word || "").toLowerCase();
  try {
    const { proseLemma } = await import("../adapters/prose-nlp.mjs");
    const lemma = proseLemma();
    return lemma ? lemma(w) : w;
  } catch { return w; }
}

/** Did the keyword strategy's edit-distance tier repair an INFLECTION of the
 *  verb the user typed, or swap the verb for a different one?
 *
 *  Both come out of the same one-edit rewrite, but they are not the same
 *  event. "used" -> "uses" and "imported" -> "imports" are the vocabulary's own
 *  verb wearing a form the phrase list doesn't happen to spell out, so the
 *  repaired sentence still asks what was typed. "rest" -> "test" and "during"
 *  -> "using" are different verbs, so the repaired sentence asks something
 *  else. A shared lemma separates the two: it holds for every inflection of one
 *  verb and for no pair of distinct ones.
 *
 *  Wink's lemmatiser is the same optional adapter generalVerbPredicate mints
 *  through. Without it there is no signal, so this reports false and the caller
 *  declines — the conservative direction, matching every other optional-adapter
 *  path here. */
async function repairSharesLemma(from, to) {
  const [a, b] = [String(from || "").toLowerCase(), String(to || "").toLowerCase()];
  if (a === b) return true;
  try {
    const { proseLemma } = await import("../adapters/prose-nlp.mjs");
    const lemma = proseLemma();
    return lemma ? lemma(a) === lemma(b) : false;
  } catch { return false; }
}

/** Pre-ask declarative taxonomy teaches. Checked BEFORE the ask engine: "a
 *  disk is a kind of game piece." otherwise parses as an inherits QUESTION
 *  and dies on term resolution, even though an article-led declarative with
 *  no question lead is a statement. Two closed shapes only:
 *  - instance membership with a HYPHENATED subject ("disk-1 is a disk") —
 *    hyphenated/numbered coinages are unambiguous individual names, so this
 *    stays clear of the plain-word bare "X is a Y" declines the tier-5
 *    fabrication fixes deliberately preserve;
 *  - article-led "is a kind of" taxonomy with a multi-word object — the
 *    infix is unambiguous taxonomy-teach intent and the ACE path can't parse
 *    the two-word object; single-word objects stay with the ACE path. */
async function bareTaxonomyTeach(line, { memoryDir, sessionId }) {
  if (!memoryDir || QUESTION_LEAD_RE.test(line)) return null;
  if (/\?\s*$/.test(String(line).trim())) return null; // a question never writes
  const inst = line.match(INSTANCE_TYPE_TEACH_RE);
  if (inst) {
    return teachFact(memoryDir, sessionId, {
      subject: inst[1], predicate: "rdfs:subClassOf", object: inst[2],
    });
  }
  const kindOf = line.match(BARE_KINDOF_TEACH_RE);
  if (kindOf) {
    // Defer to the ACE assert path exactly where it succeeds: a single-word
    // object with no trailing punctuation ("a father is a kind of parent" —
    // the pinned README transcript's shape, with its richer receipt). The ACE
    // path dies on multi-word objects and on trailing punctuation (the
    // period rides into term resolution), so those store here.
    const singleWordObject = !/\s/.test(kindOf[2]);
    const noTrailingPunct = kindOf[3] === "";
    if (singleWordObject && noTrailingPunct) return null;
    return teachFact(memoryDir, sessionId, {
      subject: kindOf[1], predicate: "rdfs:subClassOf", object: kindOf[2],
    });
  }
  return null;
}
// The plan lane's closed recognizer set. The goal frame is plan-lane state,
// not a Rule — goals accumulate on the session's planState slot.
const GOAL_TEACH_RE = new RegExp(
  `^the\\s+goal\\s+is\\s+that\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+([a-z]+s)\\s+(${PREP_SRC})\\s+([\\w-]+)[.!?]*$`, "i");
// The infinitive-complement voicings of the same goal ("the goal is for every
// disk to rest on peg-b", "i want every disk to rest on peg-b") — same
// captures, verb already in base form. The confirmation restates the that-form
// so the normalization is disclosed.
const GOAL_TEACH_INFINITIVE_RE = new RegExp(
  `^(?:the\\s+goal\\s+is\\s+for|i\\s+want)\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+to\\s+([a-z]+)\\s+(${PREP_SRC})\\s+([\\w-]+)[.!?]*$`, "i");
// The verbless voicing of the same goal ("i want every disk on peg-b"): the
// verb the other two voicings spell out is simply absent. Captures 1, 2, 4 and
// 5 of the frames above, minus the verb — planLaneAnswer reads that off the
// taught locative facts, and declines when they don't name exactly one.
const GOAL_TEACH_VERBLESS_RE = new RegExp(
  `^(?:the\\s+goal\\s+is\\s+for|i\\s+want)\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+(${PREP_SRC})\\s+([\\w-]+)[.!?]*$`, "i");
// The question mirror of the two action-signature teach frames ("can you move a
// disk onto a peg?"). Both taught voicings mint ONE rule name (verb lemma +
// preposition), so this one reader answers either.
const ACTION_SIGNATURE_ASK_RE = new RegExp(
  `^(?:can|could)\\s+you\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)[?.!]*$`, "i");
const PLAN_SOLVE_RE = /^(?:solve\s+it|solve\s+(?:the\s+)?(?:towers?\s+of\s+hanoi|hanoi|puzzle|game|river\s+crossing|this)|plan\s+the\s+moves|how\s+do\s+i\s+get(?:\s+from\s+here)?\s+to\s+the\s+goal)[?.!\s]*$/i;
const LEGAL_MOVES_RE = /^what\s+moves\s+are\s+legal(?:\s+now)?[?.!\s]*$/i;
const PLAN_NEXT_RE = /^(?:next|next\s+move|go\s+on|continue)[.!?\s]*$/i;
// Plan-navigation gestures beyond "next": the unwind ask (not supported —
// answered honestly, never the blurb) and the goal drop (a real action on the
// session's plan slot; taught board facts are never touched by it).
const PLAN_UNDO_RE = /^(?:undo(?:\s+(?:that|it|the\s+last\s+move))?|go\s+back(?:\s+(?:one|a)\s+move)?|take\s+(?:that|it)\s+back|revert(?:\s+(?:that|it|the\s+last\s+move))?)[.!?\s]*$/i;
const PLAN_FORGET_GOAL_RE = /^(?:forget|drop|clear|abandon|cancel|scrap)\s+(?:the\s+|that\s+|my\s+)?(?:goal|plan)[.!?\s]*$/i;
// The imperative voicing of a universal goal ("get all the disks onto peg-c"):
// like the verbless frame it names no board verb, so planLaneAnswer reads that
// off the taught locative facts. Captures a quantifier, a (possibly plural)
// class term, the preposition and the target — the caller singularizes the
// term and normalizes "onto"→"on" before the same verbless resolution runs.
const GOAL_TEACH_IMPERATIVE_RE = new RegExp(
  `^(?:get|put|place|stack)\\s+(?:(every|each|all|both)\\s+)?(?:the\\s+)?([\\w-]+?)\\s+(${PREP_SRC})\\s+([\\w-]+)[?.!]*$`, "i");
// The bare-NP voicing of the same goal ("the goal is all disks on peg-c") —
// no "that", no "for", no verb. Folds into the verbless resolution exactly
// like the imperative above (same captures, same singularize/prep fold).
const GOAL_TEACH_NP_RE = new RegExp(
  `^the\\s+goal\\s+is\\s+(?:(every|each|all|both)\\s+)?(?:the\\s+)?([\\w-]+?)\\s+(${PREP_SRC})\\s+([\\w-]+)[?.!]*$`, "i");
// A conjunction of goal atoms ("the goal is that disk-1 rests on peg-b and
// disk-3 rests on peg-c") — each conjunct compiles to its own goal spec.
const GOAL_TEACH_CONJUNCTION_RE = /^the\s+goal\s+is\s+that\s+(.+?)[.!?]*$/i;
const GOAL_CONJUNCT_RE = new RegExp(
  `^(?:(every|each|all)\\s+)?([\\w-]+)\\s+([a-z]+s)\\s+(${PREP_SRC})\\s+([\\w-]+)$`, "i");
// Plan follow-up questions, answered off the ACTIVE plan state (never invented
// when no plan stands). "next move"/"continue" EXECUTE (PLAN_NEXT_RE above); these
// three only REPORT.
const PLAN_WHAT_NEXT_RE = /^(?:what(?:'s|\s+is)?|whats)\s+the\s+next\s+move[?.!\s]*$/i;
const PLAN_MOVE_COUNT_RE = /^how\s+many\s+moves(?:\s+(?:are\s+(?:there|left)|remain(?:ing)?|left|to\s+go|in\s+the\s+plan|total))?[?.!\s]*$/i;
// "what is the goal" while a goal is held — a read-back off planState, so a
// mid-plan aside never falls to the child-pack lane and answers from corpus
// vocabulary about the word "goal".
const PLAN_GOAL_READBACK_RE = /^(?:what(?:'s|\s+is)\s+(?:the\s+|my\s+)?goal|remind\s+me\s+(?:of\s+|what\s+)?the\s+goal(?:\s+is)?|what\s+am\s+i\s+solving\s+for|what\s+goal(?:'s|\s+is)\s+(?:set|held))[?.!\s]*$/i;
// "is that really the minimum number of moves?" / "could there be a shorter
// plan than that?" — a confirmation of the planner's own optimality claim,
// not a request to count anything (without this it fell to the unrelated
// code-entity counter — "moves" reads as a countable noun to that reader —
// producing "I can't count 'moves'" even though the planner's own solve
// output already printed "N moves (shortest)"). findActionPath (planning.mjs)
// is a real breadth-first search: it expands the state space depth-by-depth
// and returns the FIRST goal state it finds, so whenever a plan exists its
// move count IS provably the minimum from the state it started from — never
// a guess, an actual guarantee of the search algorithm used.
const PLAN_OPTIMALITY_CONFIRM_RE = /^(?:is\s+(?:that|this)\s+(?:really|actually)?\s*the\s+(?:minimum|fewest|optimal|shortest)(?:\s+possible)?\s+(?:number\s+of\s+moves|amount\s+of\s+moves|moves)|(?:is|could)\s+there\s+be\s+a\s+shorter\s+(?:plan|way|route)(?:\s+than\s+that)?|can\s+(?:it|this|that)\s+be\s+done\s+in\s+fewer\s+moves)[?.!\s]*$/i;
// "why is that the shortest solution?" — a direct follow-up asking for the
// SAME reason the planner already printed, unprompted, right after "plan
// found — N moves (shortest)". Re-displays the stored becauseText (below)
// rather than an honest miss; a genuinely different justification question
// ("why did you send X to Y instead of Z", "what if X started elsewhere")
// asks for something this store doesn't compute at all (an alternative-path
// or counterfactual explanation) and stays a miss.
const PLAN_WHY_SHORTEST_RE = /^why\s+(?:is|was)\s+(?:that|this|it)\s+the\s+shortest\s+(?:solution|plan|path|way)[?.!\s]*$/i;
const PLAN_WHY_MOVE_RE = /^why\s+(?:that|this|the\s+next|the)\s+move[?.!\s]*$/i;
// Board-state read-backs, answered off the CURRENT board (the latest @stepK
// snapshot, or the taught board before any step) so a read never contradicts
// the plan's own board@stepK line. Clearness is derived, never stored: a piece
// is clear iff nothing rests on it on the current board.
const IS_CLEAR_RE = /^(?:is|are)\s+([\w-]+)\s+clear[?.!\s]*$/i;
const BOARD_REVERSE_LOC_RE = new RegExp(
  `^(?:what|who)\\s+([a-z']+)\\s+(${PREP_SRC})\\s+(.+?)[?.!\\s]*$`, "i");
const BOARD_FORWARD_LOC_RE = new RegExp(
  `^what\\s+(?:does|do|is)\\s+([\\w-]+)\\s+([a-z]+)(?:\\s+(${PREP_SRC}))?[?.!\\s]*$`, "i");
const BOARD_WHERE_RE = /^(?:where\s+is|where's)\s+([\w-]+)(?:\s+now)?[?.!\s]*$/i;
// "where does disk-1 rest?" — the verbed spelling of the same board read;
// without it the phrasing fell through to the code definition-locator.
const BOARD_WHERE_DOES_RE = /^where\s+does\s+([\w-]+)\s+([a-z]+)(?:\s+now)?[?.!\s]*$/i;
// "where is every disk" — the same read over every member of a taught class.
const BOARD_WHERE_EVERY_RE = /^where\s+(?:is|are)\s+(?:every|each|all(?:\s+the)?)\s+([\w-]+?)[?.!\s]*$/i;

/** "<X> is <adjective>" — the property teach payload (wrapper-REQUIRED): a lazy
 *  subject and a single bare complement word. Never matches the "is a <noun>"
 *  membership shape (that stays the ACE grammar's), so "remember that cache is
 *  a store" still lands as rdfs:subClassOf, not a property. "was"/"were" join
 *  "is"/"are": "remember that the last commit was risky" reads back as a
 *  present-tense property fact ("...is risky") the same way a
 *  general-verb "had" fact already reads back as "has" — properties are
 *  timeless facts in this store, not tensed events. Safe to widen here
 *  (unlike the entry gates further up that decide whether `payload` even
 *  reaches this match at all): this path only runs on an explicit
 *  "remember/note/…"-WRAPPED sentence, never a bare one, so there's no real
 *  question-shape ("was X Y?") this could ever misfire on. */
const TEACH_PROPERTY_RE = /^(?:every\s+|each\s+|all\s+|the\s+)?(.+?)\s+(?:is|are|was|were)\s+(?!an?\b|the\b)([A-Za-z][\w-]*)$/i;

/** The closed place-adverb set ("anywhere"/"everywhere"/"nowhere"/
 *  "somewhere"). One of these sitting in an OBJECT slot ("http.mjs used is
 *  anywhere") marks a garbled usage QUESTION, never a storable property or
 *  relation object: no reader ever matches a fact whose object is a place
 *  adverb, so storing one is a silent write with no possible read-back.
 *  Every teach path that binds a free-form object refuses on it, and the
 *  teach-offer generators never suggest a phrasing that contains one. */
const PLACE_ADVERB_OBJECT_RE = /^(?:anywhere|everywhere|nowhere|somewhere)$/i;

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
    const { appendFact, normFactTerm } = await import("../adapters/memory/core.mjs");
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

// ---- Teach new terms + quantifier phrasings ("every X is a/an Y", "some Xs
// are Ys", "your X is a/an Y", "X is Y", "a few Xs are Ys") + "how many Xs
// are Ys" recall. Deliberately NARROW: only the SUBJECT gets a free pass past
// parseAce's closed lexicon-noun gate, never the OBJECT. ----

/** Naive plural → singular fold for the "some/a few Xs are Ys" surface forms
 *  (mirrors factTermVariants' own naive -es/-s stripping, below, but returns
 *  ONE canonical spelling to STORE rather than a lookup Set of candidates to
 *  match against). Deliberately tiny, no NLP — a stray false fold on an
 *  already-singular noun ending in "s" is a known, accepted limitation of this
 *  same naive scheme used elsewhere in this file (factTermVariants).
 *
 *  "ss"/"ous" both stay excluded from the trailing-s strip: "ss" for the
 *  existing reason (a doubled final consonant is never a plural marker), and
 *  "ous" because no regular English noun plural ends that way at all — every
 *  "-ous" word reaching this function is an ADJECTIVE ("venomous",
 *  "dangerous", "curious"), and stripping its final letter as if it were a
 *  plural "-s" produces a mangled non-word ("venomous" -> "venomou") rather
 *  than a singular form of anything. */
function singularizeSurface(word) {
  const w = String(word || "").trim();
  if (/[a-z]ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.slice(0, -2);
  if (/[a-z]s$/i.test(w) && !/(?:ss|ous)$/i.test(w)) return w.slice(0, -1);
  return w;
}

/** "(every|each|all|a|an )?X is/are (a|an )?Y" — the shape the unknown-subject
 *  fallback recognizes (group 2 = X, group 4 = Y); group 1 (when present)
 *  names the determiner, so the caller can tell a genuine "every" universal
 *  apart from a singular/specific-entity "a"/bare reading (only "every" gets a
 *  recorded quantifier here — this function's OWN caller passes it through to
 *  teachFact; assertTurn, below, records the same "every" quantifier
 *  independently for the pre-existing ACE-success path). Group 3 is the
 *  copula itself (is/are) — CAPTURED (not just matched) so a caller can tell
 *  a genuinely PLURAL subject phrasing ("all men ARE mortal") apart from a
 *  singular one ("redis IS a cache"): singularizing the subject before
 *  storage is only ever correct for the former (see unknownSubjectFallback's
 *  and unknownObjectFallback's own docblocks) — a proper noun that happens to
 *  end in "s" ("redis") naively strips to "redi" if singularized on an "is"
 *  sentence, where no such fold is ever needed.
 *  Y (the object) is a single token, same as parseAce's own copula fragments;
 *  X (the subject) is ONE OR TWO tokens, to cover a natural 2-word noun
 *  phrase ("vulcan gizmo is a tool"), the same class of gap OWNS_TEACH_RE's
 *  own object needed widening for, above. The greedy quantifier tries the
 *  longer 2-word subject first, backtracking to 1 word only if the tail
 *  doesn't then start with is/are — the "is/are" anchor immediately after
 *  the subject removes the ambiguity a fully free-form multi-word subject
 *  would otherwise have.
 *
 *  "any" joins every/each/all as a recognized universal-quantifier
 *  determiner: "any spider is an arachnid" is the same claim as "every
 *  spider is an arachnid". Without it here, "any" fell into the SUBJECT
 *  capture instead (a 2-word "any spider"), minting a bogus compound term
 *  disconnected from the real "spider" concept any other sentence grounds.
 *
 *  A trailing sentence-final mark is tolerated (`[.!?]*` before the anchor):
 *  without it, "every dog is a mammal." or "rex is a dog." — an ordinary
 *  first turn typed as a full sentence — failed this match by one character
 *  whenever the object (or subject) wasn't already a static-lexicon word, so
 *  the mint fallback below never even got a chance to run and the sentence
 *  fell all the way to the graph-less wall instead. The unpunctuated form
 *  ("rex is a dog") already worked; the period-tolerant object/subject
 *  captures themselves are unaffected (`[\w-]+` never included the period in
 *  the first place), so this only widens WHICH sentences reach the match,
 *  never what gets captured out of one that already did. */
const UNKNOWN_SUBJECT_RE = /^(every\s+|each\s+|all\s+|any\s+|a\s+|an\s+)?([\w-]+(?:\s+[\w-]+)?)\s+(is|are)\s+(?:an?\s+)?([\w-]+)[.!?]*$/i;

/** ISA-family predicates (mirrors the private ISA_PREDICATES set defined near
 *  memoryFacts, below, at module scope — both are simple top-level consts
 *  evaluated once at load time, so referencing either from a function defined
 *  earlier in this file is safe: no function here actually RUNS until well
 *  after the whole module has finished loading). Named again here, right by
 *  its one caller, so isGroundedByFact reads standalone. */
const MINT_ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

/** Small CLOSED set of generic English root nouns that count as always-
 *  grounded anchor terms for the mint-fallbacks below — not in
 *  lexicon-core.json (these are ordinary-English root nouns with no code
 *  meaning, absent from that code vocabulary). Their only job is to give a
 *  user who hits the "both sides
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
async function isGroundedByFact(term, memoryDir, cache = null) {
  if (!memoryDir) return false;
  const raw = String(term ?? "").trim();
  if (!raw) return false;
  const { normFactTerm } = await import("../adapters/memory/core.mjs");
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
  const rows = await factRows(memoryDir, cache);
  return rows.some((f) => MINT_ISA_PREDICATES.has(f.predicate) && isOperatorTaught(f) && (f.subject === t || f.object === t));
}

/** Shared "is this term grounded in ANY sense" aggregate — a static lexicon
 *  word (any part of speech, via `classify`), a GENERIC_ANCHOR_NOUNS root, OR
 *  a term already anchored by a previously taught isa-family fact
 *  (isGroundedByFact, above). Used by unknownObjectFallback's subject/object
 *  groundedness checks below, where no part-of-speech branching follows —
 *  just "known or not". (unknownSubjectFallback's own object-known check,
 *  above/below, stays narrower and NOUN-specific — see its own comment — so
 *  an object that's merely a known ADJECTIVE doesn't get misrouted into the
 *  class/subClassOf branch instead of the property branch.) */
async function isGroundedTerm(term, lex, memoryDir, cache = null) {
  const raw = String(term ?? "").trim();
  if (!raw) return false;
  if (GENERIC_ANCHOR_NOUNS.has(raw.toLowerCase())) return true;
  const { classify } = await import("../domain/grammar/lexicon.mjs");
  if (classify(raw, lex)) return true;
  return isGroundedByFact(raw, memoryDir, cache);
}

/** The "both sides ungrounded" grounding NUDGE: reuses teachSuggestion's own
 *  "compute a hint, APPEND it to the existing honest-miss message, never
 *  replace/silently guess" pattern (see its docblock, above, and the
 *  "did"/"why" append-style construction in teachLane's own final decline,
 *  below) for a DIFFERENT decline case — rather than mint a relationship
 *  between two brand-new terms (a real
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
async function ungroundedPairHint(payload, lexicon, memoryDir, cache = null) {
  if (!memoryDir) return "";
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return "";
  const [, , subjectRaw, , objectRaw] = m;
  const { loadLexicon } = await import("../domain/grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  if (await isGroundedTerm(subjectRaw, lex, memoryDir, cache)) return "";
  if (await isGroundedTerm(objectRaw, lex, memoryDir, cache)) return "";
  // Chaining the second term UNDER the first's now-grounded proper name
  // ("every man is a john") is technically accepted by the grammar (once
  // "john" is grounded, ANY term can be taught as a kind of it), but reads as
  // nonsense to a human, since a proper name is never a category. Ground both
  // sides independently instead — two clear, parallel, semantically sane
  // suggestions, not a confusing chain through an arbitrary first term.
  return ` I don't know "${subjectRaw}" or "${objectRaw}" yet. Try grounding each one first, e.g. `
    + `"every ${subjectRaw} is a thing" and "every ${objectRaw} is a thing", then re-teach the`
    + ` original fact.`;
}

/** The unknown-SUBJECT direct-write fallback: tried ONLY after the real ACE
 *  grammar (assertTurn) has already had its turn and declined. Declines
 *  itself (returns null, never a guess)
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
 *      (a term minted by unknownObjectFallback, below, reads exactly as
 *      known here as any lexicon word) — the OBJECT must still be a term
 *      tmct actually knows;
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
async function unknownSubjectFallback(payload, { memoryDir, sessionId, lexicon }, cache = null) {
  if (!memoryDir) return null;
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return null;
  const [, det, subjectRaw, verb, objectRaw] = m;
  const { loadLexicon, lookupNoun, lookupAdjective, classify } = await import("../domain/grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  // A known X's own ACE miss is a real miss — never silently reinterpreted
  // here. EXCEPT: classify() folds a trailing "-s" the same way resolveNP
  // does (lexicon.mjs's lookupNoun), so a bare proper name that happens to
  // end in "s" and collide with an unrelated dictionary noun ("whiskers" ->
  // "whisker") reads as "already known" under a SINGULAR "is" sentence, where
  // no plural evidence supports the fold at all (the genuinely-plural "are"
  // case is handled correctly a few lines down). Refuse only the fold's own
  // contribution here — an EXACT noun hit (no fold), or any non-noun
  // classification (a real verb/adjective/proper name/determiner), still
  // blocks this fallback exactly as before.
  const subjectClass = classify(subjectRaw, lex);
  const subjectFoldedNounOnly = subjectClass?.pos === "noun" && !/^are$/i.test(verb)
    && (lookupNoun(lex, subjectRaw)?.lemma || "").toLowerCase() !== String(subjectRaw).toLowerCase();
  if (subjectClass && !subjectFoldedNounOnly) return null;
  const quantifier = /^every$/i.test((det || "").trim()) ? "every" : "";
  // Singularize the SUBJECT before storage, but ONLY on a genuinely PLURAL
  // phrasing ("all men ARE mortal", verb "are"). This
  // shape (UNKNOWN_SUBJECT_RE) also matches singular "is" sentences ("redis
  // is a cache"), where singularizing must NEVER run — "redis" naively folds
  // to "redi" under the same naive -s-strip. So "all men are mortal" stores
  // under "man" (matching whatever "john is a man" already typed John as),
  // not the raw plural "men", while "redis is a cache" stores "redis"
  // untouched. Without this,
  // findIsaChain's 2-hop proof (john->man, man->mortal) can never join, since
  // the second fact was keyed on a different string ("men") than the first
  // fact's object ("man"). classify(subjectRaw, lex) above already folds
  // plurals for the "is this a real miss" check, so singularizing only the
  // STORED value here is safe and doesn't change that check's behavior.
  const subject = /^are$/i.test(verb) ? singularizeSurface(subjectRaw) : subjectRaw;
  // A PRIOR turn's minted term, or a GENERIC_ANCHOR_NOUNS root, grounds Y
  // just as legitimately as a static lexicon noun — both are always treated
  // as class-level (never property), consistent with unknownObjectFallback
  // (below) always minting a CLASS.
  if (lookupNoun(lex, objectRaw) || GENERIC_ANCHOR_NOUNS.has(String(objectRaw).toLowerCase())
    || (await isGroundedByFact(objectRaw, memoryDir, cache))) {
    return teachFact(memoryDir, sessionId, {
      subject, predicate: SUBCLASS_PREDICATE, object: objectRaw, quantifier,
    });
  }
  if (lookupAdjective(lex, objectRaw)) {
    // property assertions are about ONE specific entity — never a quantifier,
    // even when phrased with "every" (point 3).
    return teachFact(memoryDir, sessionId, {
      subject, predicate: HAS_PROPERTY_PREDICATE, object: objectRaw,
    });
  }
  return null; // Y unknown too — decline honestly, never guess
}

/** The unknown-OBJECT mint fallback: the MIRROR of unknownSubjectFallback,
 *  above — same "X is/are Y" payload shape (UNKNOWN_SUBJECT_RE, reused
 *  verbatim, never a second regex for the identical shape), tried as a
 *  SIBLING call right after unknownSubjectFallback in teachLane (below), but
 *  firing on the OPPOSITE asymmetry: SUBJECT already grounded (a real
 *  lexicon-core.json word of ANY part of speech, a GENERIC_ANCHOR_NOUNS root,
 *  OR a term a PRIOR turn already minted via either fallback —
 *  isGroundedTerm, shared with this check) and OBJECT completely ungrounded.
 *  Mints the object as a new class-level concept (rdfs:subClassOf, same
 *  predicate/quantifier machinery teachFact/unknownSubjectFallback already
 *  use) so ordinary conversation can build up new vocabulary turn over turn:
 *  "every cache is a store" (subject "cache" grounded via the static lexicon)
 *  mints "store"; a LATER "every store is a container" then finds "store"
 *  grounded via the fact just minted (not the static lexicon at all) and
 *  mints "container" the same way.
 *
 *  GATED ON A GENUINE UNIVERSAL QUANTIFIER ("every"/"each"/"all"/"any" — never
 *  bare/"a"/"an"/"your"): minting a NEW CLASS-LEVEL CONCEPT is inherently a general
 *  claim about a class, the same "every"/bare distinction unknownSubjectFallback's
 *  own docblock already draws between a class generalization and a claim
 *  about ONE specific entity. This is load-bearing, not cosmetic: a bare
 *  "module is banana" (a KNOWN lexicon subject, an unrecognized bare object,
 *  NO determiner at all) must stay a plain honest miss, never silently
 *  minted — and a WRAPPED "remember that X is <adjective>" (also
 *  determiner-less at the subject) must keep falling through to
 *  TEACH_PROPERTY_RE's own, more permissive arbitrary-adjective path
 *  unimpeded.
 *
 *  The critical safety guard: this must NEVER silently mint when BOTH sides
 *  are ungrounded ("every zorp is a florp" — two brand-new, never-seen terms
 *  with no relation to each other tmct actually knows) — declines here
 *  (null), and teachLane's own final honest-miss text picks up an appended
 *  grounding NUDGE for exactly this case (ungroundedPairHint, above) — never
 *  a silent guess, never a silent hard-swallowed decline either. Any OTHER
 *  decline (subject ungrounded + object grounded — not this fallback's
 *  asymmetry; or both grounded — already known, nothing to mint; or no
 *  genuine universal quantifier) falls through as a plain null, letting the
 *  ordinary teachLane cascade (property teach, then the generic honest-miss
 *  text) continue unaffected. */
/** Before unknownObjectFallback (below) mints the object as a new CLASS, ask
 *  wink's POS tagger (the SAME optional adapter subjectIsNounOrPropn, above,
 *  already uses for this kind of disambiguation, via ask-nlp.mjs's posTags)
 *  whether the word reads as anything OTHER than a NOUN/PROPN. "every Record
 *  is persisted" tags "persisted" VERB (a past participle used adjectivally);
 *  "every cache is bespoke" tags "bespoke" ADJ — both read as a property
 *  claim about one word, not a brand-new class term, so this fallback should
 *  decline and let the cascade fall through to unknownAdjectiveFallback
 *  (below), which mints the SAME word correctly as a property instead. A
 *  genuinely novel noun ("florble", "zorp") still tags NOUN under wink's own
 *  out-of-vocabulary default, so this never blocks the mint-a-new-class
 *  behaviour the vocabulary-growth feature needs. No wink installed, or any
 *  tagging surprise, degrades to a null tag treated as "no signal" (never a
 *  decline) — matching every other optional-adapter path in this file. */
async function objectReadsAsNonNoun(word) {
  try {
    const { nlpAdapter } = await import("../adapters/ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return false;
    const [tag] = adapter.posTags([String(word || "")]);
    if (!tag) return false; // no signal — never block the existing mint on a surprise
    return tag !== "NOUN" && tag !== "PROPN";
  } catch {
    return false;
  }
}
async function unknownObjectFallback(payload, { memoryDir, sessionId, lexicon, classIntent = false }, cache = null) {
  if (!memoryDir) return null;
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return null;
  const [, det, subjectRaw, verb, objectRaw] = m;
  // `classIntent` (an explicit "kind of"/"type of" infix in the ORIGINAL
  // sentence, detected by the caller before stripKindOf erased it) is the
  // same class-level signal a universal quantifier gives: "dog is a kind of
  // mammal" — tmct's OWN read-back phrasing for a subClassOf fact — names a
  // class relation, never one entity's property, so it earns the mint the
  // bare unmarked "module is banana" shape must still never get.
  if (!/^(?:every|each|all|any)$/i.test((det || "").trim()) && !classIntent) return null; // class-level mint needs a universal quantifier or an explicit kind-of infix
  const { loadLexicon, lookupNoun } = await import("../domain/grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  const subjectGrounded = await isGroundedTerm(subjectRaw, lex, memoryDir, cache);
  if (!subjectGrounded) return null; // ungrounded subject isn't this fallback's asymmetry — never a guessed mint
  const objectGrounded = await isGroundedTerm(objectRaw, lex, memoryDir, cache);
  if (objectGrounded) return null; // object already known — nothing to mint
  if (await objectReadsAsNonNoun(objectRaw)) return null; // reads like an adjective/verb, not a class noun — defer to unknownAdjectiveFallback
  const quantifier = /^every$/i.test((det || "").trim()) ? "every" : "";
  // Singularize the SUBJECT before storage, ONLY on a genuinely PLURAL
  // phrasing (verb "are") — same bug class and same "is"-vs-"are" safety gate
  // as unknownSubjectFallback, above (see UNKNOWN_SUBJECT_RE's own docblock).
  // This is the fallback the canonical "all men are mortal" sentence
  // ACTUALLY goes through: "men" is grounded here via classify's own
  // IRREGULAR plural-fold (lexicon-core.json declares "man"/plural "men"), so
  // unknownSubjectFallback itself already declines for it (its own
  // classify(subjectRaw) check reads "men" as the known noun "man") and hands
  // off to this mirror fallback instead. A naive suffix-strip
  // (singularizeSurface, the fallback for
  // a genuinely novel REGULAR plural not in the lexicon, e.g. "zorps") can't
  // undo an IRREGULAR plural like "men" -> "man" — only the lexicon's own
  // noun table (lookupNoun, already resolved by isGroundedTerm/classify to
  // decide this subject counts as grounded in the first place) carries that
  // mapping, so storage must consult the SAME source of truth: prefer the
  // lexicon lemma, falling back to singularizeSurface for a subject grounded
  // only via a PRIOR taught fact (isGroundedByFact) or a regular-plural
  // lexicon fold. Gated on verb "are" for the identical reason
  // unknownSubjectFallback gates it: an already-singular grounded subject
  // that happens to end in "s" (e.g. a fact-grounded "gas") must never be
  // naively stripped on an "is" sentence ("every gas is a chemical").
  const subject = /^are$/i.test(verb)
    ? (lookupNoun(lex, subjectRaw)?.lemma || singularizeSurface(subjectRaw))
    : subjectRaw;
  return teachFact(memoryDir, sessionId, {
    subject, predicate: SUBCLASS_PREDICATE, object: objectRaw, quantifier,
  });
}

/** The adjective-MINT fallback: "mary is female" / "the cache is bespoke" —
 *  a brand-new adjective with no lexicon entry at all, on a SUBJECT that's
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
 *  guard: no "every"-quantifier gate at all, since a property claim is about
 *  ONE entity, never a quantified class claim. So the guard here is
 *  SUBJECT-side only — isGroundedTerm, OR a bare Capitalized token — and the
 *  OBJECT (the new adjective) is never required to be independently
 *  grounded (minting it is the entire point). UNKNOWN_SUBJECT_RE's own
 *  determiner alternation has no "the" (only every/each/all/a/an), so a
 *  leading "the" rides into the subject capture itself ("the cache") rather
 *  than being split off as a determiner — the SAME leading-article strip
 *  normFactTerm (memory/core.mjs) applies before storage is applied here too,
 *  purely for the groundedness check. Branch order mirrors
 *  unknownSubjectFallback's own noun-then-adjective order: declines (null)
 *  first when the OBJECT already resolves as a known NOUN or a fact-grounded
 *  CLASS term, so a genuine class-membership sentence is never misread as a
 *  property. Matches UNKNOWN_SUBJECT_RE verbatim and writes
 *  HAS_PROPERTY_PREDICATE, no quantifier, ever.
 *
 *  Sits strictly UPSTREAM of the pre-existing TEACH_PROPERTY_RE gap (the
 *  wrapped-only surface that mints ANY bare complement word with zero
 *  grounding check at all, e.g. "remember that zorp is florpy").
 *
 *  A bare "module is banana" (a KNOWN lexicon-noun subject, NO article, NO
 *  capitalization, an unrecognized bare object) must stay a plain honest
 *  miss. unknownObjectFallback's own mint is guarded against this exact
 *  shape by requiring a genuine "every/each/all" quantifier — but a property
 *  claim never carries one (this function's whole premise), so a plain
 *  "subject grounded via the static lexicon alone" test would re-open
 *  precisely that regression for the property case instead. The fix: a
 *  subject grounded ONLY by a bare static-lexicon match (no article, no
 *  capitalization) does NOT qualify on its own — an article (stripped above
 *  into `bareSubject`), a capitalized name-shape, or a PRIOR-TAUGHT fact
 *  anchor (isGroundedByFact) each stand in as the "this is a deliberate
 *  entity reference, not ordinary bare prose" signal a quantifier would
 *  otherwise provide. "the cache is bespoke" and "Mary is female" both carry
 *  one of those signals (the leading "the", and capitalization,
 *  respectively); "module is banana" carries none. */
async function unknownAdjectiveFallback(payload, { memoryDir, sessionId, lexicon }, cache = null) {
  if (!memoryDir) return null;
  const m = String(payload).trim().match(UNKNOWN_SUBJECT_RE);
  if (!m) return null;
  const [, det, subjectRaw, verb, objectRaw] = m;
  if (PLACE_ADVERB_OBJECT_RE.test(objectRaw)) return null; // a place adverb is never a property
  // An ARTICLED complement ("a dog is a mammal") is a noun-phrase kind claim,
  // never an adjective property — but UNKNOWN_SUBJECT_RE strips the object's
  // article before capture, so objectRaw alone can't show the difference from
  // "the cache is bespoke". Without this re-check, a fact-grounded subject
  // silently minted the kind claim as an mgx:hasProperty garble that the isa
  // read-back then denied. Declining here lands on the honest teach-miss,
  // whose nudge already names the storable form ("every dog is a mammal").
  if (/\s+(?:is|are)\s+an?\s+[\w-]+[.!?]*\s*$/i.test(String(payload).trim())) return null;
  const { loadLexicon, lookupNoun, lookupAdjective, classify } = await import("../domain/grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  // Y already a known NOUN or a fact-grounded CLASS term — a genuine class-
  // membership sentence, unknownSubjectFallback/unknownObjectFallback's own
  // territory (already had first refusal on it) — never misread as a property.
  if (lookupNoun(lex, objectRaw) || GENERIC_ANCHOR_NOUNS.has(String(objectRaw).toLowerCase())
    || (await isGroundedByFact(objectRaw, memoryDir, cache))) return null;
  // CLASS-LEVEL adjective predication — "every snake is venomous": a universal
  // quantifier over a grounded noun class, with an adjective complement. The
  // quantifier is the same deliberate-generalization signal the article/
  // capitalization stand-ins give for the specific-entity form below, so a
  // bare-lexicon-grounded subject qualifies here (it would not for the
  // unquantified property claim), and the fact is stored WITH its "every"
  // quantifier so the read-back ("is a snake venomous", "are snakes venomous")
  // holds for the whole class. The adjective is confirmed by the static lexicon
  // or wink's POS tag (the same tag unknownObjectFallback used to defer here);
  // a noun-shaped Y was already minted as a class upstream and never reaches
  // this point.
  const universalQuantifier = /^(?:every|each|all|any)$/i.test((det || "").trim());
  if (universalQuantifier && (await isGroundedTerm(subjectRaw, lex, memoryDir, cache))
    && (lookupAdjective(lex, objectRaw) || (await objectReadsAsNonNoun(objectRaw)))) {
    const classSubject = /^are$/i.test(verb)
      ? (lookupNoun(lex, subjectRaw)?.lemma || singularizeSurface(subjectRaw))
      : subjectRaw;
    return teachFact(memoryDir, sessionId, {
      subject: classSubject, predicate: HAS_PROPERTY_PREDICATE, object: objectRaw, quantifier: "every",
    });
  }
  // Subject-side groundedness — strip a leading "the"/"a"/"an" first
  // (normFactTerm's own article-strip, mirrored here) so "the cache" checks
  // groundedness under its real head noun "cache", the same spelling
  // teachFact will actually normalize and store.
  const bareSubject = subjectRaw.replace(/^(?:the|an?)\s+/i, "").trim() || subjectRaw;
  const hadArticle = bareSubject !== subjectRaw;
  const capitalized = /^[A-Z]/.test(bareSubject);
  const factGrounded = await isGroundedByFact(bareSubject, memoryDir, cache);
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

// ---- General verb-to-predicate teaching. "remember tony has a hat" /
// "remember margo eats ribs" — a verb other than is/are or owns/maintains
// otherwise falls to the STRUCTURAL code-graph grammar, which can't resolve
// an arbitrary proper noun as a code entity. Wrapper-REQUIRED, closed
// <subject> <verb> <object> shape; only the PREDICATE mapping generalizes. ----

/** <subject> (ONE bare word) <verb> (one lowercase word) <object> (the rest).
 *  Bounded to a single-token subject with no determiner: without real
 *  verb-position knowledge, a longer subject is ambiguous ("every controller
 *  is a handler" could mis-parse verb="controller") — the is/are frames
 *  elsewhere in this lane own that broader territory instead. */
// A frequency/degree ADVERB commonly sits between a bare-name subject and the
// real verb ("remember that TaskController usually needs review") — without
// this skip it would mis-split VERB="usually", minting a nonsense predicate.
// Every word here is skippable because dropping it leaves the sentence's claim
// intact: "usually needs review" and "needs review" assert the same relation at
// different strengths, and tmct stores no strength. "never" is NOT one of them.
// It reverses the claim, so skipping it stored the exact opposite of what the
// sentence said ("tony never eats ribs" -> tony eats ribs) — a truthful teach
// read back as a confident lie. It belongs to NEG_MARKER_SRC below.
const TEACH_ADVERB_SKIP_SRC = "(?:(?:usually|often|sometimes|rarely|always|typically|generally|"
  + "occasionally|frequently|normally|regularly|commonly|mostly|currently|still|also|really|actually|"
  + "closely|strongly|directly)\\s+)?";
/** The negation markers a teach/query frame recognizes, in ONE place so the
 *  teach side and the query side can never disagree about what negates a
 *  sentence — the same discipline TEACH_ADVERB_SKIP_SRC is shared under. */
const NEG_MARKER_SRC = "(?:cannot|can't|can not|does not|doesn't|do not|don't|never)";
/** Split a leading negation marker off a teach payload, returning the POSITIVE
 *  twin of the sentence plus the negation flag. Rewriting to the positive and
 *  re-reading it through the ordinary frames is what keeps polarity out of the
 *  parser: one recognizer, one predicate mint, one preposition fold, and the
 *  prefix swaps at the very end (memory/capability.mjs).
 *
 *  The can-family rebuilds an explicit "can" so it lands on the SAME
 *  mgx:capableOf the corpus's own /r/CapableOf data uses; the do-family and
 *  "never" simply drop out, leaving the bare verb the mint already reads
 *  ("fred does not eat kale" -> "fred eat kale", "tony never eats ribs" ->
 *  "tony eats ribs"). */
const GENERAL_VERB_NEGATION_RE = new RegExp(`^(.+?)\\s+(${NEG_MARKER_SRC})\\s+(.+)$`, "i");
function splitTeachNegation(payload) {
  const m = String(payload || "").trim().match(GENERAL_VERB_NEGATION_RE);
  if (!m) return { payload: String(payload || "").trim(), negated: false };
  const marker = m[2].toLowerCase();
  const canFamily = /^can/.test(marker);
  return { payload: `${m[1]} ${canFamily ? "can " : ""}${m[3]}`.trim(), negated: true };
}
const GENERAL_VERB_TEACH_RE = new RegExp(`^([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[.!?]*$`, "i");
/** The closed participle set the relational teach frames read as "X is
 *  <participle> <prep> Y" — a past participle whose own form is the word, so it
 *  reads back with no morphology. Closed by list (templates over general
 *  grammar), so the frame can never widen onto an arbitrary "-ed" adjective. */
const TEACH_PARTICIPLE_SRC = "connected|related|associated|linked|based|derived|composed|made|used|known|located|found|involved|concerned";
/** The prepositions those participles take. A closed set, folded into the
 *  minted predicate (mgx:<participle>-<prep>) the same way PREP_SRC folds into
 *  the general-verb frame's. */
const TEACH_PARTICIPLE_PREP_SRC = "with|to|from|by|of|in|on|for|as|about|into";
/** "X is <participle> <prep> Y" — "sales are closely connected with marketing"
 *  → sales mgx:connected-with marketing. The subject is one or two tokens (the
 *  same bound the comparative/unknown-subject frames use), an optional adverb
 *  is skipped, and the object is captured for a determiner-strip + 3-token cap
 *  by its handler. */
const PARTICIPLE_PREP_TEACH_RE = new RegExp(
  `^(?:the\\s+|an?\\s+)?([\\w'-]+(?:\\s+[\\w'-]+)?)\\s+(?:is|are|was|were)\\s+${TEACH_ADVERB_SKIP_SRC}(${TEACH_PARTICIPLE_SRC})\\s+(${TEACH_PARTICIPLE_PREP_SRC})\\s+(.+)$`,
  "i",
);
/** "X is a <noun> <participle> <prep> Y" — a copula-NP with a trailing
 *  participle clause: "sales are activities related to selling" decomposes into
 *  the class-membership half (sales ⊑ activity, through the ordinary mint/assert
 *  path) AND the relational half (sales mgx:related-to selling). The NP head is
 *  a single token, followed by a closed participle — which keeps this disjoint
 *  from PARTICIPLE_PREP_TEACH_RE, where the participle sits right after the
 *  copula. */
const COPULA_NP_PARTICIPLE_TEACH_RE = new RegExp(
  `^(?:the\\s+|an?\\s+)?([\\w'-]+(?:\\s+[\\w'-]+)?)\\s+(is|are|was|were)\\s+(?:an?\\s+)?([\\w'-]+)\\s+(${TEACH_PARTICIPLE_SRC})\\s+(${TEACH_PARTICIPLE_PREP_SRC})\\s+(.+)$`,
  "i",
);
/** "A and B have/share the same <noun>" — "sales and marketing have the same
 *  goal" → sales mgx:same-goal-as marketing. A closed shape; the conjunction
 *  pre-pass leaves it alone (its second clause never opens with is/are/has/
 *  have/can), so it reaches the teach dispatch whole. */
const SAME_NOUN_TEACH_RE = /^(?:the\s+)?([\w'-]+)\s+and\s+(?:the\s+)?([\w'-]+)\s+(?:have|has|share|shares)\s+(?:the\s+)?same\s+([\w'-]+)[.!?]*$/i;
/** "the letter is in the garden" — a locative teach whose subject the running
 *  adventure world already places somewhere. Group 1 is the subject; the world
 *  place is left to the fold, since the sentence is stored as a note either
 *  way. */
const LOCATIVE_TEACH_RE = /^(?:the\s+)?([\w'-]+)\s+(?:is|are|was|were)\s+(?:in|on|under|inside|at|near|behind|above|below)\s+(?:the\s+)?[\w'-]+/i;
/** Fold a relational object down to its head phrase: cut at the first clause
 *  boundary (a comma, semicolon, or a coordinating "or"/"and"), strip a leading
 *  determiner, then cap at 3 tokens — "selling or the number of goods sold in a
 *  period" folds to "selling", "the number of goods" to "number of goods".
 *  Keeps a minted relational object bounded, the same discipline the general-
 *  verb frame's own object fold uses. */
function participleObject(raw) {
  const cleaned = String(raw).trim()
    .replace(/[.!?]+$/, "")
    .split(/\s*[,;]\s*|\s+(?:or|and)\s+/i)[0]
    .trim()
    .replace(/^(?:the|an?|its|his|her|their|our|my|your|some|any)\s+/i, "");
  return cleaned.split(/\s+/).slice(0, 3).join(" ");
}
/** Does a bare (unwrapped) sentence fit one of the relational teach frames —
 *  including its negated twin, read through splitTeachNegation the same way the
 *  general-verb and capability frames read theirs? Used only to admit the
 *  sentence as a teach payload; the dispatch below re-matches and stores.
 *
 *  Each regex's own subject capture is a bare word/short NP with no pronoun
 *  exclusion of its own (unlike generalVerbTeach's GENERAL_VERB_NOT_A_VERB_RE
 *  check) — this frame used to be reached only once the bare-sentence pronoun
 *  guard (TEACH_PRONOUN_BARE_RE) had already declined, but that guard is
 *  deliberately narrow (copula + a SHORT complement only), so a pronoun
 *  subject with a longer relational complement ("it is closely connected
 *  with hunting" — the ingest pronoun-carry mechanism's own first, expected-
 *  to-fail attempt) reaches here unprotected. isTeachPronoun is the same
 *  closed check every other mint fallback in this lane uses. */
function matchesRelationalTeachFrame(sentence) {
  const { payload } = splitTeachNegation(String(sentence || "").trim());
  const pp = payload.match(PARTICIPLE_PREP_TEACH_RE);
  if (pp) return !isTeachPronoun(pp[1]);
  const np = payload.match(COPULA_NP_PARTICIPLE_TEACH_RE);
  if (np) return !isTeachPronoun(np[1]);
  const same = payload.match(SAME_NOUN_TEACH_RE);
  if (same) return !isTeachPronoun(same[1]) && !isTeachPronoun(same[2]);
  return false;
}
/** Does a relational-frame sentence name a code-graph entity? "the Router is
 *  used by every handler" reads as a passive uses-CLAIM the ask engine verifies
 *  against the graph ("No — no uses edge found…"), not a fact to store — the
 *  participle+preposition frame would otherwise intercept it. When any term the
 *  frame would store resolves to a graph entity, the frame yields so the graph
 *  lane keeps the sentence. No graph (a bare/browser/ingest turn) means nothing
 *  to yield to, so the frame proceeds. */
async function relationalFrameNamesGraphEntity(sentence, graph) {
  if (!graph) return false;
  const { payload } = splitTeachNegation(String(sentence || "").trim());
  let terms = null;
  const pp = payload.match(PARTICIPLE_PREP_TEACH_RE);
  if (pp) terms = [pp[1], participleObject(pp[4])];
  else {
    const np = payload.match(COPULA_NP_PARTICIPLE_TEACH_RE);
    if (np) terms = [np[1], np[3], participleObject(np[6])];
    else {
      const same = payload.match(SAME_NOUN_TEACH_RE);
      if (same) terms = [same[1], same[2]];
    }
  }
  if (!terms) return false;
  for (const t of terms) {
    try { if (await resolveEntity(graph, String(t).trim())) return true; } catch { /* unresolved is fine */ }
  }
  return false;
}
/** Determiners/quantifiers that make the FIRST token an article, not a real
 *  bare-name subject ("every controller…", "the cache…") — GENERAL_VERB_TEACH_RE
 *  would otherwise happily bind them as a 1-token subject and misread the
 *  REAL subject's second word as the verb. Declining here hands the sentence
 *  back to the is/are-specific frames above/below (their own territory) or an
 *  honest miss — never a guessed split. */
const GENERAL_VERB_DETERMINER_RE = /^(?:every|each|all|some|a|an|the|your|my|our|their|his|her|its)$/i;
/** The determiner-led sentence shape that can be read without guessing a verb
 *  position: "the small disk rests on the middle disk". The single-token
 *  subject bound above stands. Rather than lift it, this frame supplies the
 *  verb-position knowledge it lacks: a closed PREP_SRC preposition must sit
 *  immediately after the verb slot, which pins the verb by construction and so
 *  lets the subject take a second token safely.
 *
 *  The pin does real work. Widen the subject without it (strip the determiner,
 *  allow a greedy 2-token subject) and sentences that work today garble
 *  silently. "margo eats ribs daily" binds subject="margo eats", verb="ribs".
 *  "the small red disk rests on the middle disk" binds subject="small red",
 *  verb="disk", storing a nonsense mgx:disk fact. No verb-slot gate catches
 *  that one, because "disk" is not a closed-class word. With the preposition
 *  pinned, both decline instead.
 *
 *  Costs the 3-token subject ("the small red disk …"), which declines. Nothing
 *  in that sentence says which of its three leading words is the subject's
 *  head, so a decline is the honest read. */
const GENERAL_VERB_DETERMINER_TEACH_RE = new RegExp(
  `^(?:the\\s+|an?\\s+)([\\w'-]+(?:\\s+[\\w'-]+)?)\\s+([a-z]+)\\s+(${PREP_SRC})\\s+(.+?)[.!?]*$`,
  "i",
);
/** The quantified possession teach ("every dog has fur", "all dogs have
 *  tails") — the closed has/have verb pins the split the way the preposition
 *  pins GENERAL_VERB_DETERMINER_TEACH_RE's, so a universal quantifier can
 *  lead without any verb-position guessing. The quantifier is captured:
 *  "every"/"each" take a grammatically SINGULAR noun, so only "all" folds
 *  the plural — the naive fold clipped an s-final singular ("every lens" was
 *  stored, and cited, as "len"). */
const QUANTIFIED_HAS_TEACH_RE = /^(every|each|all)\s+([\w'-]+)\s+(?:has|have)\s+(.+?)[.!?]*$/i;
const quantifiedHasSubject = (m) => (/^all$/i.test(m[1]) ? singularizeSurface(m[2]) : m[2]);
/** The OBJECT side of the same fold: "all dogs have tails" states one tail
 *  per dog, so the plural sentence form's object stores as its singular
 *  ("tail" — the spelling the have-questions and the seeded corpus's own hasA
 *  facts read back). Only the "all" form folds, the same gate the subject
 *  uses: "every"/"each" take singular grammar, so their object's number is
 *  the speaker's own ("every dog has fur"). The last word folds so a
 *  modified object ("all dogs have long tails") keeps its modifier. */
const quantifiedHasObject = (m) => (/^all$/i.test(m[1])
  ? m[3].replace(/[\w'-]+$/, (w) => singularizeSurface(w))
  : m[3]);
/** The determiner-led possession teach ("the tower has 3 disks", "the robot has
 *  2 arms", "my car has 4 wheels") — the closed has/have verb pins the split the
 *  same way the universal quantifier pins QUANTIFIED_HAS_TEACH_RE's, so a leading
 *  definite/possessive determiner needs no verb-position guessing. The subject is
 *  the single noun between the determiner and the verb; a two-token subject stays
 *  declined, like the preposition-pinned frame, because nothing names its head. */
const DETERMINER_HAS_TEACH_RE = /^(?:the|an?|my|your|our|their|his|her|its)\s+([\w'-]+)\s+(?:has|have|had)\s+(.+?)[.!?]*$/i;
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
/** GENERAL_VERB_TEACH_RE's verb slot is a bare `[a-z]+` with NO check that
 *  the captured word is a real verb at all — a closed-class function word (a
 *  possessive/personal pronoun, a preposition, a subordinating conjunction)
 *  sitting in that position reads as an ordinary lemma just as happily as a
 *  genuine verb does, so generalVerbPredicate mints a nonsense mgx:<word>
 *  predicate and thirdPersonSingularSurface's naive -s/-es/-ies fold renders
 *  it as a garbled "confirmation" that LOOKS like a successful teach (worse
 *  than a wall — no error, no nudge). E.g. "can you review my code for me"
 *  (after MODAL_WRAPPER_RE's own preamble strip removes "can you", verb="my"
 *  -> mgx:my -> "mies"), "impact if i change it??" (verb="if" -> mgx:if ->
 *  "ifs"), "defs in model.mjs" (verb="in" -> mgx:in -> "ins"). A genuine verb
 *  ("mentors", "eats", "owns", "needs", "maintains") is never one of these
 *  closed-class words, so this is a pure narrowing: it can only turn an
 *  already-wrong absorb into an honest decline, never break a real teach.
 *  Wink-nlp POS tagging was tried first and rejected — out of sentence
 *  context it tags "my"/"if"/"in" correctly, but IN context it also mistags
 *  the legit "mentors" as NOUN, so a POS gate would have regressed a real
 *  teach; a closed list (templates over general grammar rules) is both more
 *  reliable here and, being closed, can never widen recognition the way a
 *  probabilistic POS heuristic could.
 *
 *  The interrogative pronouns (what/who/which/where/when/why/how) join the
 *  list for the same reason: a dropped-copula casual fragment ("k what abt
 *  users.mjs", missing the "is" QUESTION_LEAD_RE/hasMidSentenceInterrogative
 *  both expect) leaves the WH-word sitting in the verb slot exactly like "if"
 *  or "in" above — subject "k", verb "what", object "abt users.mjs" — and
 *  the SAME nonsense -s fold ("k WHATs abt users.mjs") mints it as a fact. A
 *  WH-word is never a genuine general-verb-frame verb, so this is the same
 *  pure narrowing the block above already describes, just closing the one
 *  closed class it left out. */
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
  // interrogative pronouns/adverbs — never a real verb, only ever the
  // fronted question-word of a copula-dropped fragment
  + "|what|who|whom|whose|which|where|why|how"
  + ")$",
  "i",
);

/** The same failure family as GENERAL_VERB_NOT_A_VERB_RE just above, one slot
 *  over: a LISTING IMPERATIVE's own verb sitting in the subject position.
 *  "list modules in nope" fits GENERAL_VERB_TEACH_RE perfectly — subject
 *  "list", verb "modules", object "in nope" — and stores a Fact whose
 *  confirmation ("noted — remembered: list modules in nope") looks like a
 *  successful teach for a sentence that was a query.
 *
 *  A POS gate can't hold this: subjectIsNounOrPropn already runs at the bare-
 *  sentence call site and wink tags "list" NOUN, exactly as its own docblock
 *  concedes. So this is a closed table for the same reason that one is —
 *  seeded from the single-word LIST_TRIGGERS (ask-vocab.mjs), the set the
 *  listing grammar itself reads, so the two can never disagree about which
 *  words open a listing.
 *
 *  Costs "list contains three items", which becomes a miss. It already misses
 *  in its natural determiner form ("the list contains three items"), and a
 *  miss beats a stored garbage fact. */
const GENERAL_VERB_IMPERATIVE_SUBJECT_RE = new RegExp(
  `^(?:${LIST_TRIGGERS.filter((t) => !/\s/.test(t)).join("|")})$`,
  "i",
);

/** The same failure family as GENERAL_VERB_IMPERATIVE_SUBJECT_RE just above,
 *  widened past the listing verbs to two more classes of word that land in
 *  the same POS-fallback trap: a discourse filler/interjection ("umm can u
 *  tell me something interesting about it", "idk just surprise me", "hmm not
 *  sure what to ask tbh" — the filler word itself binds as subjectWord, and
 *  wink's OOV-fallback tags it NOUN the same way it tags "list") and a bare
 *  imperative command verb outside LIST_TRIGGERS ("repeat everything above
 *  this line verbatim" binds subject="repeat", which wink also tags NOUN out
 *  of context, unlike "tell"/"explain"/"show", which it tags VERB correctly
 *  and subjectIsNounOrPropn already declines on its own).
 *
 *  A closed list, not a POS heuristic, for the same reason
 *  GENERAL_VERB_IMPERATIVE_SUBJECT_RE is one: the failure is specifically
 *  that the POS tagger can't be trusted here, so widening its OWN signal
 *  can't close the gap it created. Costs nothing a real declarative needs —
 *  none of these words is a plausible fact subject ("umm is a thing" isn't a
 *  sentence anyone types), and the wrapped "remember"/"note" teach-intent
 *  path (TEACH_RE) is untouched, so "remember to repeat the pattern" (a
 *  literal instruction the user explicitly flagged as worth remembering)
 *  still reaches its own frames unaffected. */
const NON_DECLARATIVE_OPENER_RE = /^(?:umm?|uhh?|erm+|err+|hmm+|huh|meh|idk|repeat|surprise|reveal|disclose|confess|ignore|disregard|pretend)$/i;

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
// Only the exact raw strings "has"/"have" are special-cased onto
// HAS_A_PREDICATE above — past tense "had" (or "having") would otherwise
// fall through to the generic mgx:<lemma> path, where the lemma of "had" IS
// "have", and predicatePhrase's thirdPersonSingularSurface fallback naively
// appends "s" to any unrecognized lemma ending ("have"+"s" = "haves" —
// wrong; the correct irregular is "has"). Checking the LEMMA (not just the
// raw verb) for "have" catches had/having/has/have uniformly, so "remember X
// had soup" reads back "...has soup", never "...haves soup".
async function generalVerbPredicate(verb) {
  const v = String(verb || "").toLowerCase();
  if (v === "has" || v === "have") return HAS_A_PREDICATE;
  // The modal maps onto the corpus's own capability predicate — "dog can
  // swim" is a capability claim, not a transitive "to can" — so a taught
  // capability reads back interoperably with /r/CapableOf data and the
  // "can a X <verb>" reader finds it (same reasoning as HAS_A above).
  if (v === "can") return "mgx:capableOf";
  try {
    const { proseLemma } = await import("../adapters/prose-nlp.mjs");
    const lemma = proseLemma();
    const l = lemma ? lemma(v) : v;
    if (l === "have") return HAS_A_PREDICATE;
    return normFactPredicate(`mgx:${l}`);
  } catch {
    return normFactPredicate(`mgx:${v}`);
  }
}

/** The capability predicate at the polarity a recognized capability surface
 *  carried: mgx:capableOf, or its mgxneg: twin. Routed through
 *  generalVerbPredicate's own "can" case rather than naming mgx:capableOf
 *  again, so every capability write in this file still mints from one place. */
const capabilityPredicate = async (negated) => {
  const p = await generalVerbPredicate("can");
  return negated ? negatedPredicate(p) : p;
};

/** Recognize + resolve a general-verb teach payload into {subject, predicate,
 *  object}, or null when it doesn't fit the shape / names an excluded verb /
 *  is missing a real subject or object (point 6 — an honest decline, never a
 *  guess). Pure recognition + predicate mapping; the caller (teachLane) does
 *  the actual write via the shared teachFact. */
async function generalVerbTeach(payload) {
  const raw = String(payload || "").trim();
  const { payload: p, negated } = splitTeachNegation(raw);
  // A genuine declarative assertion never ends in a question mark — "g day
  // mate, you alright?" (Priority 1, above) reaches this function with no
  // leading question-word signal left to catch it (it never matched a
  // wrapper, and QUESTION_LEAD_RE only checks the FIRST word), but the
  // trailing "?" is still an unambiguous "this is a question" marker.
  if (/\?\s*$/.test(p)) return null;
  if (GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(p)) return null; // another frame's territory — stand down
  const m = p.match(GENERAL_VERB_TEACH_RE);
  if (!m) return null;
  let [, subjectRaw, verbRaw, objectRaw] = m;
  // A determiner in the subject slot means the single-token subject bound has
  // bound the article and misread the real subject's second word as the verb
  // ("the small disk rests on…" gives subject="the", verb="small"). Re-read it
  // with the preposition pinning the verb; a sentence that frame can't pin
  // declines here exactly as it always has.
  if (GENERAL_VERB_DETERMINER_RE.test(subjectRaw)) {
    const quantHas = p.match(QUANTIFIED_HAS_TEACH_RE);
    const detHas = !quantHas ? p.match(DETERMINER_HAS_TEACH_RE) : null;
    if (quantHas) {
      subjectRaw = quantifiedHasSubject(quantHas);
      verbRaw = "has";
      objectRaw = quantifiedHasObject(quantHas);
    } else if (detHas) {
      subjectRaw = detHas[1];
      verbRaw = "has";
      objectRaw = detHas[2];
    } else {
      const det = p.match(GENERAL_VERB_DETERMINER_TEACH_RE);
      if (!det) return null; // not a bare-name subject, and no preposition to pin the verb
      subjectRaw = det[1];
      verbRaw = det[2];
      // hand the preposition back to the shared fold below, so the minted
      // predicate comes from the one place that mints it
      objectRaw = `${det[3]} ${det[4]}`;
    }
  }
  const verb = verbRaw.toLowerCase();
  if (GENERAL_VERB_EXCLUDE_RE.test(verb)) return null; // owned by a more specific frame above
  if (GENERAL_VERB_NOT_A_VERB_RE.test(verb)) return null; // a closed-class word can never be the real verb
  if (GENERAL_VERB_IMPERATIVE_SUBJECT_RE.test(subjectRaw)) return null; // an imperative's verb, not a subject
  // The identical closed-class check GENERAL_VERB_NOT_A_VERB_RE already applies
  // to the VERB slot, applied to the SUBJECT slot too: "remember to repeat the
  // pattern every time" binds subject="to" (the infinitive marker of an
  // imperative "remember to DO X", not a fact's subject) and used to mint a
  // nonsense "to mgx:repeat …" fact — this path has no wrapper requirement, so
  // it runs for both the "remember …"-wrapped and the bare unwrapped call
  // sites alike, unlike the bare path's own subjectIsNounOrPropn/
  // NON_DECLARATIVE_OPENER_RE gate (which only the caller's unwrapped branch
  // applies). A pronoun/preposition/conjunction/determiner was never a
  // plausible fact subject in either shape.
  if (GENERAL_VERB_NOT_A_VERB_RE.test(subjectRaw)) return null;
  const subject = subjectRaw.trim();
  // The preposition folds on the POSITIVE predicate, and only then does the
  // polarity prefix swap. Negating first would hand the fold an mgxneg: CURIE
  // its /^mgx:[a-z]+$/ guard rejects, stranding "on water" inside the object of
  // "a penguin cannot rest on water" — the very bug the fold exists to prevent.
  const folded = foldPrepositionIntoPredicate(await generalVerbPredicate(verb), objectRaw);
  // "the" strips alongside "a"/"an": the read-back side already strips a
  // leading determiner off the queried term, so leaving it on here stores an
  // object no question can match.
  const object = folded.object.replace(/^(?:an?|the)\s+/i, "").trim();
  if (!subject || !object) return null; // no well-formed triple — honest decline (point 6)
  if (PLACE_ADVERB_OBJECT_RE.test(object)) return null; // a place adverb is never a real object
  return { subject, predicate: negated ? negatedPredicate(folded.predicate) : folded.predicate, object };
}

/** Is `word` a genuine NOUN/PROPN, per wink-nlp's optional POS tagger
 *  (ask-nlp.mjs's nlpAdapter, the SAME adapter the closed structural grammar
 *  already leans on)? Used to let ONE narrow bare (unwrapped) general-verb
 *  teach sentence through below: GENERAL_VERB_TEACH_RE's shape ("<word>
 *  <word> <rest>") is too permissive to trust on a bare sentence with no
 *  "remember"/"note" signal at all — "tell me a joke" and "explain the class
 *  hierarchy to me" match the IDENTICAL shape (subject="tell"/"explain", the
 *  imperative verb itself, mistaken for a subject) and must never be silently
 *  reified as bogus mgx:me/mgx:the facts (both are tagged VERB). A genuine
 *  declarative's first word is a NOUN/PROPN instead ("grace mentors alan",
 *  "sam owns TaskController" — both tagged NOUN). No wink installed degrades
 *  to false (never a guess), same as every other optional-adapter path in
 *  this codebase. */
async function subjectIsNounOrPropn(word) {
  try {
    const { nlpAdapter } = await import("../adapters/ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return false;
    const [tag] = adapter.posTags([String(word || "")]);
    return tag === "NOUN" || tag === "PROPN";
  } catch {
    return false;
  }
}

/** Recognize "<Name> <verb>ed <Name>" ("ahab fathered john") as a relational
 *  teach, or null. RELATION_VERB_TEACH_RE gives the shape; this adds the
 *  guards that keep non-relational pasts out:
 *    - neither side may lead with a determiner ("the build failed yesterday")
 *      or a closed-class word;
 *    - the verb may not be a closed-class or structural word;
 *    - both name heads must POS-tag NOUN/PROPN (the same wink adapter
 *      subjectIsNounOrPropn uses — "john failed spectacularly" tags its tail
 *      ADV and declines). No wink → no signal, never a store;
 *    - wink's lemma must actually DIFFER from the typed verb — a base-form
 *      "-eed" word ("breed", "exceed") is not an inflected past at all, and
 *      lemma-vs-strip disagreement resolves toward the lemma so the minted
 *      predicate matches what the wrapped "remember that ahab fathered john"
 *      path (generalVerbTeach) would mint.
 *  Returns { subject, verb, base, object }; `base` is what the caller mints
 *  through generalVerbPredicate. */
async function matchRelationalVerbTeach(text) {
  const line = String(text || "").trim();
  const m = line.match(RELATION_VERB_TEACH_RE);
  if (!m) return null;
  const [, subjectRaw, verbRaw, objectRaw] = m;
  const verb = verbRaw.toLowerCase();
  const strip = pastVerbBase(verb);
  if (!strip) return null;
  if (GENERAL_VERB_NOT_A_VERB_RE.test(verb) || STRUCT_WORDS.has(verb)) return null;
  const subjWords = subjectRaw.split(/\s+/);
  const objWords = objectRaw.split(/\s+/);
  for (const head of [subjWords[0], objWords[0]]) {
    if (GENERAL_VERB_DETERMINER_RE.test(head) || GENERAL_VERB_NOT_A_VERB_RE.test(head)) return null;
  }
  try {
    const { nlpAdapter } = await import("../adapters/ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return null;
    const tags = adapter.posTags([...subjWords, verbRaw, ...objWords]);
    const nameTag = (t) => t === "NOUN" || t === "PROPN";
    if (!nameTag(tags[0]) || !nameTag(tags[subjWords.length + 1])) return null;
  } catch {
    return null;
  }
  let base = strip;
  try {
    const { proseLemma } = await import("../adapters/prose-nlp.mjs");
    const lemma = proseLemma();
    if (lemma) {
      const l = lemma(verb);
      if (l === verb) return null; // wink says this is already a base form, not a past
      if (l) base = l;
    }
  } catch { /* no lemmatizer — the closed strip stands */ }
  return { subject: subjectRaw.trim(), verb, base, object: objectRaw.trim() };
}

/** The bare "<name> <verb>s <name>" nudge text ("john likes mary"), or null.
 *  The bare form stays wrapper-required — the imperative-lookalike problem in
 *  subjectIsNounOrPropn's docblock is only half the story at exactly three
 *  words, where the conversational catch-all otherwise answers with the
 *  orientation card. This recognizes the shape ONLY well enough to point at
 *  the wrapped form that does store; it never stores anything itself. Closed
 *  the same way matchRelationalVerbTeach is: no determiner/closed-class
 *  heads, no structural/discourse verb, subject POS-tags NOUN/PROPN, object
 *  tags NOUN/PROPN/ADJ (wink tags bare lowercase names like "mary" ADJ;
 *  a genuine adverb tail — "dog barks loudly" — still declines). */
async function bareTeachWrapperNudgeText(text) {
  const line = String(text || "").trim().replace(/[.!?]+\s*$/, "");
  const m = line.match(/^([\w'-]+)\s+([a-z][\w-]*s)\s+([\w'-]+)$/i);
  if (!m) return null;
  const [, subj, verbRaw, obj] = m;
  const verb = verbRaw.toLowerCase();
  if (/^(?:is|was|does)$/.test(verb)) return null;
  if (GENERAL_VERB_NOT_A_VERB_RE.test(verb) || STRUCT_WORDS.has(verb) || HABITUAL_VERB_EXCLUDE.has(verb)) return null;
  for (const head of [subj, obj]) {
    if (GENERAL_VERB_DETERMINER_RE.test(head) || GENERAL_VERB_NOT_A_VERB_RE.test(head)) return null;
  }
  try {
    const { nlpAdapter } = await import("../adapters/ask-nlp.mjs");
    const adapter = nlpAdapter();
    if (!adapter) return null;
    const tags = adapter.posTags([subj, verbRaw, obj]);
    if (tags[0] !== "NOUN" && tags[0] !== "PROPN") return null;
    if (tags[2] !== "NOUN" && tags[2] !== "PROPN" && tags[2] !== "ADJ") return null;
  } catch {
    return null;
  }
  return `I don't store a bare "${line}" on its own — to store that, say: "remember that ${line}".`;
}

// ---- General verb-to-predicate DIRECT-QUESTION retrieval: "does margo eat
// ribs" / "what does margo eat" against a fact taught via generalVerbTeach.
// Wired into factReadBack, gated on an already-true `miss` so a real graph
// query is never shadowed. Reuses generalVerbTeach's own exclude guards and
// generalVerbPredicate, plus the SAME adverb-skip, so the two never disagree. ----
const GENERAL_VERB_YESNO_RE = new RegExp(`^(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[?.!\\s]*$`, "i");
const GENERAL_VERB_OPEN_RE = new RegExp(`^what\\s+(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+(?:\\s+(?:${PREP_SRC}))?)[?.!\\s]*$`, "i");
/** GENERAL_VERB_EXCLUDE_RE was written for generalVerbTeach's fully-conjugated
 *  declarative verb ("X OWNS Y", "X MAINTAINS Y") — but "does/did X <verb> Y"
 *  captures the BARE INFINITIVE after do-support ("does X OWN Y", never "does X
 *  owns Y"), so "owns"/"maintains" literally never appear in genYN/genOpen's
 *  captured verb even when the sentence names exactly that relation — which
 *  would otherwise produce a real false "no" against a genuinely-true taught
 *  ownership fact, since generalVerbPredicate("own") mints a DIFFERENT
 *  predicate — mgx:own — than the ownership frame's own OWNED_BY_PREDICATE.
 *  The query-side guard needs the bare-infinitive counterpart too. */
const GENERAL_VERB_QUERY_EXCLUDE_RE = /^(?:be|own|maintain)$/i;

/** Closed prepositions the general-verb teach/query lanes FOLD INTO the
 *  minted predicate: "disk-1 rests on peg-a" stores mgx:rest-on with object
 *  "peg-a", never mgx:rest with the meaning-bearing "on" buried inside the
 *  object where no read-back can match it. */
const GENERAL_VERB_PREP_RE = new RegExp(`^(${PREP_SRC})\\s+(.+)$`, "i");
/** Fold a leading preposition from `objectRaw` into a minted mgx:<lemma>
 *  predicate. Curated predicates (mgx:hasA, mgx:capableOf — anything not the
 *  plain lowercase mint shape) are never suffixed. Returns {predicate,
 *  object} either way. */
function foldPrepositionIntoPredicate(predicate, objectRaw) {
  const prepM = String(objectRaw || "").match(GENERAL_VERB_PREP_RE);
  if (prepM && /^mgx:[a-z]+$/.test(predicate)) {
    return { predicate: `${predicate}-${prepM[1].toLowerCase()}`, object: prepM[2].trim() };
  }
  return { predicate, object: String(objectRaw || "").trim() };
}

/** Sentence forms to try asserting for a teach payload: the payload as-is, and
 *  (if it carries no determiner) its "every …" universal — the ACE-OWL shape the
 *  grammar actually lands. */
function assertCandidates(payload) {
  const p = String(payload).trim();
  const out = [p];
  if (!/^(?:every|each|all|a|an)\b/i.test(p)) out.push(`every ${p}`);
  // "dogs are animals" — the bare-plural surface of the membership shape the
  // grammar already owns as "every dog is an animal". Purely additive and
  // inherently safe: the rewritten candidate still has to parse against the
  // closed lexicon, so a false singular ("redis" → "redi") never stores. A
  // trailing "too" is tolerated — it adds discourse flavor, not content.
  const plural = p.match(/^(?:all\s+|every\s+|each\s+)?([\w-]+)\s+are\s+([\w-]+?)(?:\s+too)?[.!?]*$/i);
  if (plural) {
    const subject = singularizeSurface(plural[1].toLowerCase());
    const object = singularizeSurface(plural[2].toLowerCase());
    if (subject !== plural[1].toLowerCase() || object !== plural[2].toLowerCase()) {
      const articleRule = grammarRules().find((r) => r.kind === "article");
      const article = articleRule && beginsWithVowelSound(object, articleRule) ? "an" : "a";
      out.push(`every ${subject} is ${article} ${object}`);
    }
  }
  // HABITUAL → CAPABILITY: "dogs bark" / "a dog barks" are the habitual
  // surfaces of the capability teach the lane already owns as "a dog can
  // bark" (the same reading the seed corpus itself uses: dog /r/CapableOf
  // bark). Same safety story as the plural rewrite above — the candidate
  // still has to ground through the teach path (this rewrite, or teachLane's
  // grounded-subject direct write), so a subject grounded nowhere
  // ("penguins swim" with no prior grounding) stays an honest decline.
  const habitual = matchBareHabitualTeach(p);
  if (habitual) {
    const articleRule = grammarRules().find((r) => r.kind === "article");
    const article = articleRule && beginsWithVowelSound(habitual.subject, articleRule) ? "an" : "a";
    out.push(`${article} ${habitual.subject} can ${habitual.verb}`);
  }
  return [...new Set(out)];
}

/** The two bare HABITUAL teach surfaces, recognized as one shape:
 *  "dogs bark" (plural subject + base verb) and "a dog barks" (articled
 *  singular + 3sg verb), both meaning the capability fact "a dog can
 *  bark". Returns {subject, verb} folded to the singular/base forms, or
 *  null. Deliberately closed: structural verbs (imports/calls/tests …)
 *  are excluded so a truncated code query never reads as a capability
 *  claim, and the plural surface's verb must be a BASE form (no
 *  plural-looking "s" tail — "dogs animals" is not a habitual sentence;
 *  "pass"/"miss"-style "ss" verbs stay eligible). */
/** Words that sit in the habitual shapes' verb slot without being verbs —
 *  politeness/discourse tails ("jokes please", "dogs too") that must stay
 *  with the conversational lane. */
const HABITUAL_VERB_EXCLUDE = new Set([
  "please", "thanks", "kindly", "anyway", "though", "indeed", "maybe",
  "perhaps", "still", "too", "also", "instead", "now", "then", "here", "there",
]);
/** Sentence-initial ordinal/temporal discourse adverbs — the "First", "Then",
 *  "Next" … that thread a narrative across sentences without belonging to the
 *  clause they lead. A closed set: a connective in this slot carries sequence,
 *  not content, so stripping it lets "First a cell grows." read as the same
 *  capability teach the bare "a cell grows." already does. */
const LEADING_DISCOURSE_ADVERBS = [
  "first", "second", "third", "then", "next", "finally",
  "later", "meanwhile", "afterward", "afterwards",
];
const LEADING_DISCOURSE_ADVERB_RE = new RegExp(
  `^(?:${LEADING_DISCOURSE_ADVERBS.join("|")})\\b\\s*,?\\s+`, "i",
);
/** Strip one leading ordinal/temporal discourse adverb (case-insensitive,
 *  optional trailing comma) from the start of `text`, leaving the clause that
 *  followed it. A word not in the closed set, or one with no clause after it,
 *  is left untouched. */
export function stripLeadingDiscourseAdverb(text) {
  return String(text || "").trim().replace(LEADING_DISCOURSE_ADVERB_RE, "");
}
function matchBareHabitualTeach(text) {
  const t = stripLeadingDiscourseAdverb(String(text || "").trim());
  const plural = t.match(/^(?:all\s+|every\s+)?([\w-]+s)\s+([a-z][\w-]*)[.!?]*$/i);
  if (plural && !STRUCT_WORDS.has(plural[2].toLowerCase()) && !HABITUAL_VERB_EXCLUDE.has(plural[2].toLowerCase()) && !/[^s]s$/i.test(plural[2])) {
    const subject = singularizeSurface(plural[1].toLowerCase());
    if (subject !== plural[1].toLowerCase()) return { subject, verb: plural[2].toLowerCase() };
  }
  const singular = t.match(/^an?\s+([\w-]+)\s+([a-z][\w-]*s)[.!?]*$/i);
  if (singular && !STRUCT_WORDS.has(singular[2].toLowerCase()) && !HABITUAL_VERB_EXCLUDE.has(singular[2].toLowerCase())) {
    const verb = singularizeSurface(singular[2].toLowerCase());
    if (verb !== singular[2].toLowerCase()) return { subject: singular[1].toLowerCase(), verb };
  }
  return null;
}
/** The EXPLICIT capability surface — "a wren can sing" / "penguins can swim":
 *  the same {subject, verb} reading matchBareHabitualTeach folds its two
 *  habitual surfaces onto, for the sentence that says "can" outright. The ACE
 *  grammar already owns this shape for closed-lexicon words; recognizing it
 *  here lets the teach lane's grounded-subject direct write catch a subject
 *  grounded only by a prior taught fact. Same closed verb-slot exclusions as
 *  the habitual shapes; a question lead ("can a wren sing") never reaches
 *  this — every call site is already QUESTION_LEAD-gated.
 *
 *  Its NEGATIVE twin rides the same shape and returns `negated`: "a penguin
 *  cannot fly" is the identical claim about the identical relation with the
 *  polarity reversed, so reading it anywhere else would give the two surfaces
 *  two chances to disagree. Only the can-family negates here — this is the
 *  capability frame, and "penguins never fly" is a habitual surface that lands
 *  on generalVerbTeach's own split instead. */
const BARE_CAN_TEACH_RE = /^(?:an?\s+|every\s+|all\s+)?([\w-]+)\s+(can|cannot|can't|can not)\s+([a-z][\w-]*)[.!?]*$/i;
function matchBareCanTeach(text) {
  const m = String(text || "").trim().match(BARE_CAN_TEACH_RE);
  if (!m) return null;
  const subject = m[1].toLowerCase();
  const verb = m[3].toLowerCase();
  if (STRUCT_WORDS.has(verb) || HABITUAL_VERB_EXCLUDE.has(verb) || GENERAL_VERB_NOT_A_VERB_RE.test(verb)) return null;
  if (GENERAL_VERB_DETERMINER_RE.test(subject) || GENERAL_VERB_NOT_A_VERB_RE.test(subject)) return null;
  return { subject, verb, negated: m[2].toLowerCase() !== "can" };
}

/** The "every X is a Y" rewrite of a declarative, for the "did you mean …"
 *  hint. Real a/an agreement (never a hardcoded "a", which is ungrammatical
 *  for a vowel-initial Y — "every monkey is a animal") reuses finish.mjs's
 *  own beginsWithVowelSound + the SAME grammar-rules.toml "article" rule
 *  (spelling-vowel/consonant exceptions included) rather than reimplementing
 *  vowel-sound detection a second time.
 *
 *  An object with NO article in the original ("every reptile is venomous")
 *  is left BARE, never given one: that shape already means a property claim
 *  (TEACH_PROPERTY_RE's own territory), and inserting "a"/"an" in front of an
 *  adjective ("every reptile is a venomous") both reads wrong and asks the
 *  user to teach a class-membership fact that was never what they said. Only
 *  a payload that ALREADY carried an article gets its article corrected —
 *  the "every monkey is a animal" -> "an animal" case this function exists
 *  for in the first place.
 *
 *  A PLURAL phrasing ("all spiders are venomous") folds its subject to the
 *  singular the suggested "every …" rewrite grammatically requires — "every
 *  spiders is venomous" is ungrammatical AND stores under a different
 *  spelling than the singular every other frame uses, so following it
 *  verbatim wrote a plural-keyed orphan fact. Gated on the "are" copula, the
 *  same is/are safety distinction unknownSubjectFallback draws (an s-final
 *  singular like "redis is a cache" must never strip). A trailing
 *  sentence-final mark is tolerated for the same reason UNKNOWN_SUBJECT_RE
 *  tolerates one: an ordinary full-sentence turn ("dog is a mammal.")
 *  otherwise lost its hint by one character. */
function teachSuggestion(payload) {
  const m = String(payload).match(/^(?:every |each |all |a |an )?([\w-]+) (is|are) (a |an )?([\w-]+)[.!?]*$/i);
  if (!m) return null;
  const subject = (/^are$/i.test(m[2]) ? singularizeSurface(m[1]) : m[1]).toLowerCase();
  const object = m[4].toLowerCase();
  if (!m[3]) return `every ${subject} is ${object}`;
  const articleRule = grammarRules().find((r) => r.kind === "article");
  const article = articleRule && beginsWithVowelSound(object, articleRule) ? "an" : "a";
  return `every ${subject} is ${article} ${object}`;
}

/** "some/a few/several/most/many Xs are Ys" — a claim about SOME members of a
 *  class. Every teach frame in this lane stores a universal: a subClassOf says
 *  each member of the subject class counts as the object, which is what makes
 *  it a premise the syllogiser can chain through. Stored that way, "some men
 *  are fathers" reads back as a proof that any given man is a father, citing
 *  the sentence as its warrant.
 *
 *  No existential shape exists in this store yet — owl:someValuesFrom is the
 *  adjacent OWL construct, and reaching it means a rule of its own in
 *  syllogise.mjs plus a fact shape that carries the restriction. Until one is
 *  designed, these sentences refuse and name the universal that would work.
 *  "every"/"each"/"all" ARE universals and teach unchanged. */
const EXISTENTIAL_CLASS_TEACH_RE = /^(some|a few|several|most|many)\s+([\w-]+)\s+(?:is|are)\s+(?:an?\s+)?([\w-]+)[.!]*$/i;

/** The lexicon's own lemma for a plural, falling back to the naive suffix
 *  strip — the only source that undoes an irregular plural ("men" -> "man",
 *  which no suffix rule can reach). */
const singularOf = (word, lex, lookupNoun) => lookupNoun(lex, word)?.lemma || singularizeSurface(word);

async function existentialTeachRefusal(payload, lexicon) {
  const sentence = String(payload || "").trim();
  const m = sentence.match(EXISTENTIAL_CLASS_TEACH_RE);
  if (!m) return null;
  const [, quantifier, subject, object] = m;
  const { loadLexicon, lookupNoun } = await import("../domain/grammar/lexicon.mjs");
  const lex = lexicon || loadLexicon();
  const singularSubject = singularOf(subject, lex, lookupNoun);
  // The object may name a class NOUN ("some men are fathers" -> membership)
  // or a bare ADJECTIVE property ("some reptiles are venomous" -> a property
  // claim, not membership in a class called "venomous"). Only a genuine noun
  // fold — a real lexicon entry, or the naive plural-suffix strip actually
  // changing the word — means the object IS functioning as a plural noun
  // here; anything else (an adjective the lexicon doesn't carry as a noun,
  // and that doesn't end in a real plural suffix either) gets the property
  // shape instead — no article, no fold — so the suggestion reads "every
  // reptile is venomous", not the ungrammatical/mangled "every reptile is a
  // venomous"/"a venomou".
  const objectNounEntry = lookupNoun(lex, object);
  const objectFold = objectNounEntry ? objectNounEntry.lemma : singularizeSurface(object);
  const objectIsClassNoun = !!objectNounEntry || objectFold.toLowerCase() !== object.toLowerCase();
  let universal;
  if (objectIsClassNoun) {
    const articleRule = grammarRules().find((r) => r.kind === "article");
    const article = articleRule && beginsWithVowelSound(objectFold, articleRule) ? "an" : "a";
    // The bare "every X is a Y" class-membership shape stores directly
    // (unknownSubjectFallback's own territory) — no wrapper needed for the
    // suggestion to actually work when followed verbatim.
    universal = `every ${singularSubject} is ${article} ${objectFold.toLowerCase()}`;
  } else {
    // The bare property shape ("every reptile is venomous") does NOT store
    // on its own — TEACH_PROPERTY_RE only fires on a "remember/note …"-
    // wrapped payload — so the suggestion carries the wrapper too, or
    // following it verbatim would hit the exact same both-sides-unknown
    // decline again.
    universal = `remember that every ${singularSubject} is ${object.toLowerCase()}`;
  }
  return {
    text: `I can't store "${sentence.replace(/[.!]+$/, "")}" — "${quantifier.toLowerCase()}" claims only some of them, `
      + "and I store universals, so that isn't a shape I can store yet."
      + (universal ? ` If you mean it of every ${singularSubject}, say "${universal}".` : ""),
    via: "teach-miss", miss: true,
  };
}

/** The honest decline for a bare habitual teach ("penguins swim") whose
 *  subject is grounded nowhere — neither the static lexicon nor a prior
 *  taught fact. Mirrors ungroundedPairHint's "name the gap, hand over a
 *  phrasing that actually works, never guess" discipline for the capability
 *  shape, which has no is/are payload for that hint to match. The suggested
 *  grounding sentence uses the same GENERIC_ANCHOR_NOUNS root that hint
 *  suggests, so it round-trips through the ordinary teach cascade as-is. */
function habitualGroundingHintText(line, habitual) {
  const articleRule = grammarRules().find((r) => r.kind === "article");
  const article = articleRule && beginsWithVowelSound(habitual.subject, articleRule) ? "an" : "a";
  // the promise must carry the sentence's OWN polarity — promising to remember
  // that a penguin CAN fly, to someone who just said it cannot, is the same
  // inversion the negative teach exists to stop, moved into the hint
  const promise = habitual.negated ? `cannot ${habitual.verb}` : `can ${habitual.verb}`;
  return `I don't know "${habitual.subject}" yet, so I can't store "${line}" as a capability fact. `
    + `Ground it first — say "every ${habitual.subject} is a thing" — then say "${line}" again `
    + `and I'll remember that ${article} ${habitual.subject} ${promise}.`;
}

/** PRONOUN-SUBJECT GUARD: "remember you are a womble" and the literal "every
 *  you is a womble" would otherwise reach teachSuggestion/
 *  unknownSubjectFallback treating "you" like an ordinary unknown common
 *  noun — producing the nonsensical "did you mean: every you is a womble"
 *  hint (teachSuggestion), or, worse, a SILENT direct-write via
 *  unknownSubjectFallback whenever the object happened to resolve as a known
 *  noun/adjective (e.g. "he is a doctor" would store the bogus fact "he
 *  rdfs:subClassOf doctor"). A personal pronoun is never a valid class-
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
 *  much closer call than "every you is a womble".
 *
 *  The verb slot matches ANY word, not just the is/are/am copula — a pronoun
 *  is just as invalid a fact subject under a general verb ("remember you has
 *  a hat", "remember he eats ribs") as it is under "is" — but ONLY once an
 *  explicit "remember"/"note"/"teach me"-style wrapper (TEACH_RE) already
 *  named this an unambiguous teach attempt (TEACH_PRONOUN_WRAPPED_RE, tried
 *  first when `wrapped` is set). A BARE sentence with no such signal gets the
 *  narrower TEACH_PRONOUN_BARE_RE instead: pronoun + copula + a SHORT
 *  complement (one word, one optional leading article) — the exact shape
 *  TEACH_PROPERTY_RE/BARE_DECLARATIVE_RE would themselves recognize from a
 *  legal subject. Without that narrowing, an ordinary opener that merely
 *  STARTS with "I" ("I am new here", "I want to know X") reached this guard
 *  too (teachLane is the LAST lane tried, after every query strategy already
 *  missed) and fired the copula-specific decline over a sentence no frame
 *  would ever have stored regardless of subject — a confusing answer to a
 *  question nobody asked. Those now fall to teachExclusionReason's existing
 *  self-referential exclusion (a standalone "i"/"me" is already a
 *  TEACH_EXCLUDE_META_TOKEN_RE hit) or to generalVerbTeach's own silent
 *  decline (GENERAL_VERB_NOT_A_VERB_RE covers the same closed pronoun set) —
 *  the same clean stand-down a non-pronoun subject already gets. */
const TEACH_PRONOUNS_BARE = Object.freeze(["you", "i", "it", "they", "he", "she", "we"]);
// The contracted forms ("i'm new here …") bake the copula into one token, so
// they get their own branch below rather than a separate copula match.
const TEACH_PRONOUNS_CONTRACTED = Object.freeze(["you're", "i'm", "it's", "they're", "he's", "she's", "we're"]);
const TEACH_PRONOUNS = Object.freeze([...TEACH_PRONOUNS_CONTRACTED, ...TEACH_PRONOUNS_BARE]);
const TEACH_PRONOUN_WRAPPED_RE = new RegExp(`^(?:every\\s+|each\\s+|all\\s+|some\\s+|a few\\s+|a\\s+|an\\s+)?(${TEACH_PRONOUNS.join("|")})\\s+\\S+`, "i");
const TEACH_PRONOUN_BARE_RE = new RegExp(
  "^(?:every\\s+|each\\s+|all\\s+|some\\s+|a few\\s+|a\\s+|an\\s+)?"
  + `(?:(${TEACH_PRONOUNS_BARE.join("|")})\\s+(?:is|are|am|was|were)`
  + `|(${TEACH_PRONOUNS_CONTRACTED.join("|")}))`
  + "\\s+(?:an?\\s+)?[\\w'-]+[.!?]*$",
  "i",
);
/** The same closed set, read as a whole-word membership test: a pronoun is no
 *  more a legal fact subject when a reader LIFTS one out of a prior answer than
 *  when a teach frame offers one. */
const isTeachPronoun = (s) => TEACH_PRONOUNS.includes(String(s || "").trim().toLowerCase());

/** NEGATION of a subClassOf fact: "X is not a Y" (tolerating the same
 *  "kind/type of" infix every other teach shape in this lane already tolerates
 *  — the "is/are" variant, plus the "isn't"/"aren't" contractions).
 *  Deliberately narrow — the SAFEST, most unambiguous negation phrasing only,
 *  matching a scoped 2-token subject (mirrors UNKNOWN_SUBJECT_RE's own subject
 *  width), never a general negation grammar. A match is only a TRIGGER: the
 *  shape also fits a negated PROPERTY claim ("the logger is not deprecated"),
 *  so the stored subject⊑object fact is what decides whether there is a
 *  disagreement to record. */
const RETRACT_NOT_A_RE = /^(?:a\s+|an\s+)?([\w-]+(?:\s+[\w-]+)?)\s+(?:(?:is|are)\s+not|isn't|aren't)\s+(?:an?\s+)?(?:(?:kind|type)\s+of\s+)?([\w-]+)$/i;
/** "forget (that) X is a Y" — the ONLY phrasing that retracts. Never wrapped
 *  by TEACH_RE ("forget" isn't one of its recognized lead verbs —
 *  remember/note/keep in mind/…), so this is matched against the RAW
 *  (unwrapped) sentence, unlike RETRACT_NOT_A_RE above which is tried against
 *  the remember-wrapped surface too. */
const RETRACT_FORGET_RE = /^forget\s+(?:that\s+)?(?:a\s+|an\s+)?([\w-]+(?:\s+[\w-]+)?)\s+(?:is|are)\s+(?:an?\s+)?(?:(?:kind|type)\s+of\s+)?([\w-]+)$/i;
/** The locative teach shape ("disk-1 rests on peg-b") — the board-fact
 *  surface, shared by the mid-plan write guard and the locative forget. */
const BOARD_TEACH_LOCATIVE_RE = new RegExp(`^([\\w-]+)\\s+([a-z]+)s\\s+(${PREP_SRC})\\s+([\\w-]+)$`, "i");
/** "forget that disk-1 rests on peg-b" — the locative twin of
 *  RETRACT_FORGET_RE: a plain minted mgx:<verb>-<prep> fact has no entailment
 *  cascade, so removing the one row IS the retraction. */
const RETRACT_FORGET_LOCATIVE_RE = new RegExp(`^forget\\s+(?:that\\s+)?([\\w-]+)\\s+([a-z]+)s\\s+(${PREP_SRC})\\s+([\\w-]+)$`, "i");

/** The closed related-to pair — "X relates to Y" / "X is related to Y" —
 *  minted onto mgx:relatedTo (the SKOS view's skos:related source), so the
 *  synonym/related lane has a teach phrasing. Single-token subject, 1–2
 *  token object, articles tolerated on both. */
const RELATED_TO_TEACH_RE = /^(?:a\s+|an\s+|the\s+)?([\w-]+)\s+(?:relates\s+to|is\s+related\s+to)\s+(?:a\s+|an\s+|the\s+)?([\w-]+(?:\s+[\w-]+)?)$/i;

/** NEGATIVE UNIVERSAL — "no X is a Y" / "no Xs are Ys": a class-level
 *  exclusion, stored as `X owl:disjointWith Y` on the RESOLVED class pair.
 *  The ACE grammar already mints exactly this triple when both words sit in
 *  its closed lexicon; this frame is the SAME mint for the words outside it,
 *  so the sentence never falls through to the unknown-subject fallback, which
 *  would warehouse it under the subject-literal "no X" — a spelling no
 *  reader (the cax-dw veto included) ever consults, leaving a later chain
 *  proof free to certify the very thing the user excluded. Single-token
 *  sides only (the disjointness readers resolve class TERMS, not phrases);
 *  a plural surface folds to the singular the ⊑ facts use. */
const NEGATIVE_UNIVERSAL_TEACH_RE = /^no\s+([\w-]+)\s+(is|are)\s+(?:an?\s+)?(?:(?:kind|type)\s+of\s+)?([\w-]+)[.!]*$/i;

/** The mint (or the reflexive refusal) for a NEGATIVE_UNIVERSAL_TEACH_RE
 *  match, shared by teachLane and the ACE-path reflexive gate: null when the
 *  sentence isn't this shape. */
async function negativeUniversalTeach(sentence, { memoryDir, sessionId }) {
  const m = String(sentence || "").trim().match(NEGATIVE_UNIVERSAL_TEACH_RE);
  if (!m || !memoryDir) return null;
  const plural = m[2].toLowerCase() === "are";
  const subject = plural ? singularizeSurface(m[1]) : m[1];
  const object = plural ? singularizeSurface(m[3]) : m[3];
  if (subject.toLowerCase() === object.toLowerCase()) {
    return {
      text: `I can't store "no ${subject} is a ${object}" — every ${subject} is a ${subject} by definition, so that exclusion contradicts itself. Nothing was stored.`,
      via: "teach-miss", miss: true,
    };
  }
  const { DISJOINT_PREDICATE } = await import("../domain/syllogise.mjs");
  const stored = await teachFact(memoryDir, sessionId, {
    subject, predicate: DISJOINT_PREDICATE, object,
  });
  if (!stored) {
    return {
      text: `I couldn't store the exclusion "no ${subject} is a ${object}" — say it with single-word class names ("no dog is a mammal") and I'll remember it as a disjointness.`,
      via: "teach-miss", miss: true,
    };
  }
  return stored;
}

/** "no X can Y" — NEGATIVE_UNIVERSAL_TEACH_RE's sibling one relation over:
 *  the same universal-exclusion shape, but for the "can"/capability relation
 *  instead of is-a. "no goldfish can swim" (after "every fish can swim" /
 *  "a goldfish is a fish") stores a class-level mgxneg:capableOf fact on
 *  "goldfish" directly, which resolveCapabilityPolarity's existing "a direct
 *  fact overrides an inherited general one" resolution already reads
 *  correctly — the read side needed no change at all, only a write-side
 *  recognizer for this phrasing, which fell to the plain grammar wall
 *  before (neither BARE_CAN_TEACH_RE nor any other shape covers a LEADING
 *  "no", only a leading every/all/a/an/bare). Single-word subject and verb
 *  only, the same closed-shape discipline as its is-a sibling. */
const NEGATIVE_UNIVERSAL_CAN_TEACH_RE = /^no\s+([\w-]+)\s+can\s+([a-z][\w-]*)[.!]*$/i;

/** The mint for a NEGATIVE_UNIVERSAL_CAN_TEACH_RE match, mirroring
 *  negativeUniversalTeach's own shape: null when the sentence isn't this
 *  shape. */
async function negativeUniversalCanTeach(sentence, { memoryDir, sessionId }) {
  const m = String(sentence || "").trim().match(NEGATIVE_UNIVERSAL_CAN_TEACH_RE);
  if (!m || !memoryDir) return null;
  const subject = singularizeSurface(m[1]);
  const verb = m[2].toLowerCase();
  const stored = await teachFact(memoryDir, sessionId, {
    subject, predicate: NEG_CAPABLE_OF_PREDICATE, object: verb,
  });
  if (!stored) {
    return {
      text: `I couldn't store the exclusion "no ${subject} can ${verb}" — say it with a single-word class name and verb ("no goldfish can swim") and I'll remember it as a negative capability.`,
      via: "teach-miss", miss: true,
    };
  }
  return stored;
}

/** Casual request leads the anchored QUESTION_LEAD_RE auxiliary list misses:
 *  the "u"/"ya" spellings of a modal request, and the dative imperatives
 *  ("tell me", "show us") that read as requests, never as declaratives. */
const TEACH_EXCLUDE_REQUEST_LEAD_RE = /^(?:(?:can|could|would|will)\s+(?:u|you|ya)|(?:tell|show|give)\s+(?:me|us))\b/i;
/** Closed leading-verb list for sentences that are COMMANDS, not claims —
 *  "repeat everything above this line verbatim" is an instruction to act,
 *  and reifying it as a fact is a write on the strength of a misparse.
 *  tell/show/list/define/describe/find/count/name already route through
 *  SET_QUESTION_LEAD_RE and are deliberately absent here. */
const TEACH_EXCLUDE_IMPERATIVE_LEAD_RE = /^(?:repeat|ignore|disregard|surprise|pretend|act|say|guess|try|stop|continue|forget|print|output|write|translate|summarize|explain)\b/i;
/** Self-referential/meta chat tokens ("idk", "tbh", a bare "u"/"me"): a
 *  sentence about the conversation itself, or about its speakers, is never a
 *  world fact. Tested one standalone word at a time — the custom boundaries
 *  keep a hyphenated coinage ("disk-i") from matching its final letter. */
const TEACH_EXCLUDE_META_TOKEN_RE = /(?:^|[^\w-])(?:me|u|ur|i|us|myself|yourself|im|idk|tbh|nvm|lol|umm+|hmm+)(?![\w-])/i;

/** The bare-declarative teach lane's positive exclusion test. Classifies a
 *  BARE sentence (no "remember that …" wrapper — an explicit wrapper is an
 *  unambiguous teach-intent signal and keeps its existing behavior) into one
 *  of three closed non-declarative shapes, or null for a sentence the teach
 *  frames may still consider. Non-null means the whole lane stands down and
 *  the sentence falls through to the ask cascade or the honest miss — the
 *  write boundary refuses BEFORE any frame can reify a misparse.
 *
 *  Three classes, checked in order:
 *  - "interrogative": a casual request lead QUESTION_LEAD_RE's anchored
 *    first-word list misses, or a genuine mid-sentence interrogative
 *    (hasMidSentenceInterrogative — run here unconditionally, where the
 *    per-frame gates below only ever ran it on their own paths);
 *  - "imperative": a closed leading command verb. The retract phrasings
 *    ("forget that X is a Y", "forget that disk-1 rests on peg-b") are
 *    carved out — they are this lane's own, deliberate write-boundary
 *    actions, not misparses;
 *  - "self-referential": a standalone meta/chat token anywhere in the
 *    sentence. A pronoun-SUBJECT sentence ("i am a developer") is carved
 *    out so it still reaches the pronoun guard's specific decline below —
 *    same no-store outcome, better guidance than a silent fall-through.
 *
 *  Runs applyPreambleFrames itself (idempotent on an already-peeled
 *  sentence), so a stripped greeting can never leave a leading token that
 *  misclassifies, and callers outside teachLane can hand it a raw surface. */
async function teachExclusionReason(sentence) {
  const s = applyPreambleFrames(String(sentence || "").trim());
  if (TEACH_EXCLUDE_REQUEST_LEAD_RE.test(s) || (await hasMidSentenceInterrogative(s))) return "interrogative";
  const unpunctuated = s.replace(/[.!?]+\s*$/, "");
  if (TEACH_EXCLUDE_IMPERATIVE_LEAD_RE.test(s)
    && !RETRACT_FORGET_RE.test(unpunctuated) && !RETRACT_FORGET_LOCATIVE_RE.test(unpunctuated)) return "imperative";
  if (TEACH_EXCLUDE_META_TOKEN_RE.test(s) && !TEACH_PRONOUN_BARE_RE.test(s)) return "self-referential";
  return null;
}
export { teachExclusionReason };

async function teachLane(query, { memoryDir, sessionId = "", lexicon = null, cache = null, planHolder = null, graph = null, gameConfig = DEFAULT_GAME_CONFIG }) {
  // A closed discourse-marker preamble ahead of a teach sentence ("howdy
  // pardner, remember that TaskController is fragile") would otherwise
  // corrupt TEACH_RE's own match, so strip it first. applyPreambleFrames is
  // an idempotent no-op on an already-clean teach sentence (none of its
  // frames' anchors — greeting/thanks/ack/modal/explain/show-give-me/
  // topic-switch/hedge — match ordinary teach phrasing), so this is purely
  // additive.
  const rawInput = applyPreambleFrames(String(query).trim());
  // A trailing "?" is an unambiguous "this is a question" marker, and a
  // question must never reach the write boundary — the ESL missing-"does"
  // yes/no ("dog have tail?") is a bare declarative to every shape gate in
  // this lane, and it STORED, at teach trust, until this gate existed. The
  // whole lane stands down; the ask cascade owns question marks.
  if (/\?\s*$/.test(rawInput)) return null;
  // A typo'd interrogative ("wat is a hrose") reads as a declarative to every
  // anchored QUESTION_LEAD_RE gate below — run the SAME closed misspelling
  // repair ask.mjs's typo tolerance applies BEFORE classifying, so the
  // question goes back to the question side instead of a teach suggestion.
  if (QUESTION_LEAD_RE.test(correctMisspellings(rawInput))) return null;
  const m = rawInput.match(TEACH_RE);
  const wrappedInput = m ? m[1].trim() : null;
  // The positive exclusion test (teachExclusionReason, above) — BARE surface
  // only: an interrogative, imperative, or self-referential sentence never
  // reaches any teach frame, so a fresh casual phrasing can't slip past the
  // per-frame gates and reify as a fact. An explicit wrapper keeps its
  // existing, more permissive path.
  if (wrappedInput == null && (await teachExclusionReason(rawInput))) return null;
  // Refuse an existential BEFORE any frame below can read it as a universal:
  // every one of them stores "some men are fathers" as a premise meaning every
  // man, whether it keeps the quantifier as an attribute the reasoner doesn't
  // consult (the subclass frame) or bakes the word into the subject itself
  // ("most men is a kind of fathers", the unknown-subject frame).
  if (memoryDir && !QUESTION_LEAD_RE.test(wrappedInput ?? rawInput)) {
    const refusal = await existentialTeachRefusal(wrappedInput ?? rawInput, lexicon);
    if (refusal) return refusal;
  }
  // "your X is a/an Y" — a plain casual synonym for "a/an X is a
  // Y": no special second-person semantics, so rewrite it to the ordinary
  // indefinite-article determiner UP FRONT, before any downstream regex/ACE
  // parsing ever sees it (ACE itself has no notion of "your" as a
  // determiner). Only a LEADING "your" is rewritten, so this can't misfire on
  // a "your" appearing mid-sentence; applied to both the bare and the
  // remember-wrapped surface.
  const stripYour = (s) => (s == null ? s : s.replace(/^your\s+/i, "a "));
  // "X is a KIND OF Y" / "X is a TYPE OF Y": a ONE-LINE normalization, not new
  // storage — "a father is a kind of parent" reaches NEITHER
  // UNKNOWN_SUBJECT_RE nor BARE_DECLARATIVE_RE nor TEACH_PROPERTY_RE, because
  // every one of those regexes requires a SINGLE-token object and "kind of
  // parent" is three tokens. Stripping the "kind/type of" run down to a bare
  // "a "/"an " immediately after the is/are/was/were copula — BEFORE any
  // teach regex ever sees the sentence — recognition stays exactly as closed
  // as before (still only "X is a Y", just one more determiner-phrase
  // spelling of "a"), no new mint path, no new predicate: "a father is a
  // kind of parent" normalizes to "a father is a parent", which
  // unknownSubjectFallback already stores as father ⊑ parent ("parent" is
  // already a lexicon noun).
  const kindOfInfixRe = /\b(is|are|was|were)\s+(?:an?\s+)?(?:kind|type)\s+of\s+/i;
  const stripKindOf = (s) => (s == null ? s : s.replace(kindOfInfixRe, "$1 a "));
  // Remembered BEFORE the strip erases it: an explicit "kind of"/"type of"
  // infix is an unambiguous class-level claim, and unknownObjectFallback's
  // quantifier gate accepts it as a peer of "every" (its own docblock).
  const kindOfClassIntent = kindOfInfixRe.test(wrappedInput ?? rawInput);
  // "my <class-noun> <Name> is/are …" — a THIRD natural phrasing of the exact
  // same "X is a Y" assertion this lane already teaches two other ways ("john
  // is a man", a bare name; "every cat is an animal", a universal quantifier) — a
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
  // "disk-2's bigger than disk-1" — the contracted copula. Written out it is
  // the comparative frame's own sentence ("disk-2 is bigger than disk-1"), but
  // contracted the "is" is invisible: GENERAL_VERB_ANYWHERE_EXCLUDE_RE can't
  // see the copula it would have stood down for, so the general-verb frame
  // takes the sentence first and mints a nonsense mgx:big fact reading back
  // "disk-2's bigs than disk-1". Expanding it here, alongside the other
  // surface rewrites, puts the sentence in front of the frame that owns it.
  //
  // The lookahead needs BOTH a comparative AND "than", and that pairing is the
  // whole guard. A comparative alone is not a discriminator: COMPARATIVE_SRC's
  // "[a-z]+er" matches father, mother, brother, sister and owner, so an
  // expansion anchored on it turns "ahab is john's father" into "ahab is john
  // is father" and destroys both genitive frames. Their role slot is a bare
  // noun that ends the sentence, so it can never be followed by "than".
  const expandComparativeContraction = (s) => (s == null ? s : s.replace(
    new RegExp(`\\b([\\w-]+)'s(?=\\s+${COMPARATIVE_SRC}\\s+than\\b)`, "i"), "$1 is",
  ));
  const surfaces = (s) => expandComparativeContraction(stripKindOf(stripYour(stripPossessiveNamedInstance(s))));
  const raw = surfaces(rawInput);
  const wrapped = surfaces(wrappedInput);

  // CONJUNCTION PRE-PASS — "ahab is male and is the father of john": two
  // facts about ONE subject stated in one sentence. Split at the top-level
  // " and <is|are|has|have|can>" seam, re-attach the shared subject to the
  // second half, and run each half through this same lane in order — two
  // ordinary teach payloads, no new storage shape. A second clause that
  // names its OWN subject ("… and the weather is nice") is not a shared-
  // subject conjunction: the first half still stores, and the reply names
  // the clause it left alone — never a silent partial store either way.
  const conjSrc = (wrapped ?? raw).replace(/[.!?]+\s*$/, "");
  if (memoryDir && !QUESTION_LEAD_RE.test(conjSrc) && /\s+and\s+/i.test(conjSrc)
    && !(await hasMidSentenceInterrogative(conjSrc))) {
    const rewrap = (half) => (wrapped != null ? `remember that ${half}` : half);
    const recurse = (half) => teachLane(rewrap(half), { memoryDir, sessionId, lexicon, cache, planHolder, gameConfig });
    const stripNoted = (t) => String(t).replace(/^noted — remembered(?:\s+\d+\s+facts?)?:\s*/i, "").trim();
    const shared = conjSrc.match(/^(.+?)\s+and\s+((?:is|are|has|have|can)\b.+)$/i);
    const sharedSubject = shared ? shared[1].match(/^(.+?)\s+(?:is|are|has|have|can)\b/i)?.[1]?.trim() : null;
    if (shared && sharedSubject) {
      const firstHalf = shared[1].trim();
      const secondHalf = `${sharedSubject} ${shared[2].trim()}`;
      const first = await recurse(firstHalf);
      const second = await recurse(secondHalf);
      const firstOk = !!first && !first.miss;
      const secondOk = !!second && !second.miss;
      if (firstOk && secondOk) {
        return {
          text: `noted — remembered both: ${stripNoted(first.text)}; and ${stripNoted(second.text)}`,
          via: "assert", miss: false,
        };
      }
      if (firstOk || secondOk) {
        const ok = firstOk ? first : second;
        const badHalf = firstOk ? secondHalf : firstHalf;
        const bad = firstOk ? second : first;
        return {
          text: `noted — remembered: ${stripNoted(ok.text)}. The other half ("${badHalf}") I couldn't store`
            + `${bad ? ` — ${stripNoted(bad.text)}` : ", it isn't a fact shape I recognize."}`,
          via: "assert", miss: false,
        };
      }
      if (first || second) {
        return {
          text: `I couldn't store either half of that. "${firstHalf}": ${first ? stripNoted(first.text) : "not a fact shape I recognize."} `
            + `"${secondHalf}": ${second ? stripNoted(second.text) : "not a fact shape I recognize."}`,
          via: "teach-miss", miss: true,
        };
      }
      // neither half even recognized — fall through to the ordinary cascade
    } else if (!shared) {
      const ownSubject = conjSrc.match(
        /^(.+?\s+(?:is|are|has|have|can)\s+.+?)\s+and\s+((?:(?:the|a|an|every|each|all|some|my|your|their|his|her|its)\s+)?[\w'-]+(?:\s+[\w'-]+)?\s+(?:is|are|has|have|can)\b.+)$/i,
      );
      if (ownSubject) {
        const first = await recurse(ownSubject[1].trim());
        if (first && !first.miss) {
          return {
            text: `${first.text} — the second part ("${ownSubject[2].trim()}") names its own subject, so I didn't store it; teach it as its own sentence if you meant it.`,
            via: "assert", miss: false,
          };
        }
        // the first half didn't store — fall through to the ordinary cascade
      }
    }
  }

  // PRONOUN-SUBJECT GUARD — tried against BOTH surfaces (bare and remember-
  // wrapped; trailing punctuation stripped the same way the OWNS/SOME_A_FEW
  // lanes below do) before anything else in this function, so a pronoun
  // subject NEVER reaches teachSuggestion's "did you mean" hint or
  // unknownSubjectFallback's direct-write path — see TEACH_PRONOUN_WRAPPED_RE/
  // TEACH_PRONOUN_BARE_RE's own shared docblock above for why the two differ.
  const pronounSrc = (wrapped ?? raw).replace(/[.!?]+\s*$/, "");
  const pronounMatch = pronounSrc.match(wrapped != null ? TEACH_PRONOUN_WRAPPED_RE : TEACH_PRONOUN_BARE_RE);
  // A pronoun-led sentence that's ALSO a mid-sentence question ("it uses
  // which controller as its base") isn't a pronoun-classification problem at
  // all — "it" was never going to be storable either way, so naming the
  // pronoun as the reason is misleading. Stand down here and let the rest of
  // this function's cascade run: none of the other frames' shapes fit a
  // pronoun subject with a non-copula verb, so this falls all the way
  // through to teachLane's own honest `return null` (no wrapper, no `is`/
  // `are` payload — see the payload-construction block below), which leaves
  // whatever the structural grammar's own honest miss already said standing,
  // rather than overwriting it with a wrong-reason refusal.
  // The action-signature frame is the ONE pronoun-led teach shape ("you can
  // move a disk onto a peg") — the full-shape test keeps "you can fly"
  // declining right here.
  if (pronounMatch && !ACTION_SIGNATURE_TEACH_RE.test(pronounSrc)
    && !(await hasMidSentenceInterrogative(pronounSrc))) {
    const pronoun = pronounMatch[1] || pronounMatch[2];
    return {
      text: `I can't store a fact about "${pronoun}" as a class — pronouns aren't things I can classify. `
        + `I remember facts in the shape "every X is a Y", where X is a specific noun, not a pronoun. `
        + "Type /memory to see what I already remember.",
      via: "teach-miss", miss: true,
    };
  }

  // NEGATION ("X is not a Y") and RETRACTION ("forget that X is a Y"). Two
  // sentences, two intents, and the split is the point: a negative is a source
  // DISAGREEING, never an instruction to destroy. Each branch documents itself
  // below; both are tried here, right after the pronoun guard. A WRAPPED
  // pronoun subject ("remember that it is not an animal") still falls to that
  // guard's own decline first. A BARE one ("it is not an animal") reaches this
  // block instead, but stays safe either way: retractNotMatch's own "gated on
  // the positive existing" rule below finds no stored "it ⊑ …" fact to
  // disagree with (a pronoun was never a legal mint subject anywhere in this
  // lane), so it falls through to the ordinary cascade unstored, same as
  // today — just without this guard's more specific wording.
  const retractSrc = (wrapped ?? raw).replace(/[.!?]+\s*$/, "");
  const retractSrcMidQuestion = memoryDir && !QUESTION_LEAD_RE.test(retractSrc)
    ? await hasMidSentenceInterrogative(retractSrc) : false;
  const retractNotMatch = memoryDir && !QUESTION_LEAD_RE.test(retractSrc) && !retractSrcMidQuestion
    ? retractSrc.match(RETRACT_NOT_A_RE) : null;
  const forgetSrc = raw.replace(/[.!?]+\s*$/, "");
  // The locative forget rides beside the subclass one, on the same raw
  // surface: find the one stored row and remove it — no cascade exists for a
  // plain minted mgx:<verb>-<prep> fact. A no-match falls through unchanged.
  const forgetLocative = memoryDir && !QUESTION_LEAD_RE.test(forgetSrc)
    ? forgetSrc.match(RETRACT_FORGET_LOCATIVE_RE) : null;
  if (forgetLocative) {
    try {
      const { loadMemory: loadMemForLoc, readFactRows: readRowsForLoc, removeFacts: removeFactsForLoc, normFactTerm: normTermForLoc } = await import("../adapters/memory/core.mjs");
      const locPredicate = foldPrepositionIntoPredicate(
        await generalVerbPredicate(forgetLocative[2].toLowerCase()),
        `${forgetLocative[3].toLowerCase()} ${forgetLocative[4]}`,
      ).predicate;
      const locSubject = normTermForLoc(forgetLocative[1]);
      const locObject = normTermForLoc(forgetLocative[4]);
      const row = readRowsForLoc(await loadMemForLoc(memoryDir))
        .find((r) => r.subject === locSubject && r.predicate === locPredicate && r.object === locObject);
      if (row?.id) {
        await removeFactsForLoc(memoryDir, [row.id]);
        return {
          text: `noted — forgotten: "${locSubject} ${predicatePhrase(locPredicate)} ${locObject}" is no longer stored.`,
          via: "retract", miss: false,
        };
      }
      // nothing stored under that triple — fall through to the ordinary cascade
    } catch { /* store unavailable — fall through */ }
  }
  const retractForgetMatch = !retractNotMatch && memoryDir && !QUESTION_LEAD_RE.test(forgetSrc)
    ? forgetSrc.match(RETRACT_FORGET_RE) : null;
  const retractMatch = retractNotMatch || retractForgetMatch;
  if (retractMatch) {
    const retractSubject = retractMatch[1].trim();
    const retractObject = retractMatch[2].trim();

    // A BARE NEGATIVE IS A CLAIM, NOT AN INSTRUCTION TO DELETE. "john is not a
    // man" disagrees with a stored fact; it does not ask for it to be
    // destroyed, and destroying it loses the very disagreement the user came
    // to record. Both polarities are stored under their own predicate
    // (memory/capability.mjs: a fact id hashes (subject, predicate, object), so
    // sharing one predicate would merge them and union their statedBy edges),
    // and the ask ladder reports the disagreement rather than picking a side.
    // Only the explicit "forget that X is a Y" verb retracts — see below.
    //
    // GATED ON THE POSITIVE EXISTING, and that gate is load-bearing:
    // RETRACT_NOT_A_RE's shape also incidentally matches a negated PROPERTY
    // claim ("the logger is not deprecated"), which is never subClassOf-shaped
    // at all and keeps its own decline verbatim. With no stored subject⊑object
    // to disagree with, there is nothing here to record, so the sentence falls
    // through to the ordinary cascade exactly as it always has.
    if (retractNotMatch) {
      const { SUBCLASS_PREDICATE } = await import("../domain/syllogise.mjs");
      const { loadMemory: loadMemForNeg, normFactTerm: normTermForNeg, readFactRows: readRowsForNeg } = await import("../adapters/memory/core.mjs");
      const negSubject = normTermForNeg(retractSubject);
      const negObject = normTermForNeg(retractObject);
      const priorRows = readRowsForNeg(await loadMemForNeg(memoryDir));
      const positive = priorRows.find((r) => r.subject === negSubject && r.predicate === SUBCLASS_PREDICATE && r.object === negObject);
      if (positive) {
        const stored = await teachFact(memoryDir, sessionId, {
          subject: retractSubject, predicate: NEG_SUBCLASS_PREDICATE, object: retractObject,
        });
        if (stored) {
          return {
            ...stored,
            text: `${stored.text} — you told me earlier that ${negSubject} is a kind of ${negObject}, so both are now stored `
              + `and I'll report the disagreement rather than pick one. `
              + `To drop the earlier fact instead, say "forget that ${negSubject} is ${indefiniteArticleFor(negObject)} ${negObject}".`,
          };
        }
      }
      // Nothing stored to disagree with. The gate above is right to refuse
      // storing a bare negative with no positive behind it — but a subject
      // the store has never heard of fell PAST every teach lane onto the
      // code-question bootstrap message, which reads as a different product.
      // Decline by name instead, saying what would make the claim usable. A
      // KNOWN subject still falls through — the property/relation frames
      // downstream own those sentences.
      if (!priorRows.some((r) => r.subject === negSubject || r.object === negSubject)) {
        return {
          text: `I don't have anything about "${negSubject}" to attach "not ${negObject}" to — a bare negative with no positive to disagree with isn't stored. `
            + `Teach me "${negSubject} is ${indefiniteArticleFor(negObject)} ${negObject}" first if that's the disagreement you mean, `
            + `or "no ${negSubject} is a ${negObject}" to store the exclusion outright.`,
          via: "teach-miss", miss: true,
        };
      }
      // a known subject with no stored positive — fall through (see the gate above).
    }

    // RETRACTION — "forget that X is a Y": wires the data-layer retraction
    // primitive (retractSubClassOf, src/domain/syllogise.mjs) up to chat-level
    // phrasing.
    //
    // TRIGGER, never itself the authority: RETRACT_FORGET_RE only recognizes
    // the SHAPE of a retraction sentence — it says nothing about whether
    // subject⊑object was ever actually taught. retractSubClassOf is asked for
    // real and is the only thing that decides:
    //   - found:true  → a real stored (or entailed) fact existed and was
    //     retracted (with its dependency-directed cascade) — confirmed here.
    //   - found:false → subject⊑object was never a stored fact, and this falls
    //     through to the rest of teachLane's ordinary cascade below rather than
    //     claiming a specific, possibly-wrong reason.
    if (retractForgetMatch) {
      const { retractSubClassOf } = await import("../domain/syllogise.mjs");
      const { loadMemory: loadMemForRetract, readFactRows: readRowsForRetract, removeFacts, appendFacts: appendFactsForRetract } = await import("../adapters/memory/core.mjs");
      const result = await retractSubClassOf(memoryDir, retractSubject, retractObject, {
        store: { loadMemory: loadMemForRetract, readFactRows: readRowsForRetract, removeFacts, appendFacts: appendFactsForRetract },
      });
      if (result.found) {
        const extra = result.count - 1; // beyond the target fact itself
        return {
          text: `noted — forgotten: "${retractSubject} is a kind of ${retractObject}" is no longer stored`
            + (extra > 0 ? ` (${extra} entailed fact${extra === 1 ? "" : "s"} that depended on it went too)` : "")
            + (result.truncated ? " — this cascade may not be complete (a lot depended on it); ask again if something still looks stale" : "")
            + ".",
          via: "retract", miss: false,
        };
      }
      // found:false — fall through to the rest of the cascade (see docblock above).
    }
  }

  // MID-PLAN BOARD TEACH — a locative fact about a piece the LIVE plan's moves
  // touch is accepted and the plan is re-searched from the moved board, never
  // confirmed-then-contradicted by the next move. The change is written as a
  // NEW whole-board @step snapshot layer (never a base fact — a base write here
  // would sit under the standing snapshots and trip the contradictory-board
  // check on the next solve), then the goal is re-searched from the board as it
  // now stands. Scoped to the locative teach shape over the plan's own pieces;
  // every other teach (new vocabulary, new pieces, rules) is untouched, and
  // with no live plan nothing changes at all.
  {
    const livePlan = planHolder?.state && !planHolder.state.done
      && Array.isArray(planHolder.state.actions) && planHolder.state.actions.length
      ? planHolder.state : null;
    const boardSrc = (wrapped ?? raw).replace(/[.!?]+\s*$/, "");
    const board = livePlan ? boardSrc.match(BOARD_TEACH_LOCATIVE_RE) : null;
    if (board && memoryDir && !QUESTION_LEAD_RE.test(boardSrc)) {
      const { normFactTerm, appendFact } = await import("../adapters/memory/core.mjs");
      const planPieces = new Set(livePlan.actions.flatMap((a) => [normFactTerm(a.subject), normFactTerm(a.target)]));
      if (planPieces.has(normFactTerm(board[1])) || planPieces.has(normFactTerm(board[4]))) {
        const { maxSnapshotStep } = await import("../domain/domain.mjs");
        const { factRows, domain, state } = await loadPlanContext(memoryDir);
        // The single-placement change over the current fold: same subject and
        // predicate, new object. Written as the whole mutated board under a
        // fresh @step layer, so stateFromFacts reads it as the live board and no
        // base fact is left to contradict the next solve.
        const subject = normFactTerm(board[1]);
        const predicate = `mgx:${board[2].toLowerCase()}-${board[3].toLowerCase()}`;
        const object = normFactTerm(board[4]);
        const mutated = state.filter((r) => !(r.subject === subject && r.predicate === predicate));
        mutated.push({ subject, predicate, object });
        const layer = maxSnapshotStep(factRows, domain) + 1;
        for (const r of mutated) {
          await appendFact(memoryDir, {
            subject: `${r.subject}@step${layer}`, predicate: r.predicate, object: r.object,
            provenance: `plan:${sessionId || "chat"}:teach-replan:step${layer}`,
          });
        }
        const at = livePlan.cursor > 0 ? `step ${livePlan.cursor} of ${livePlan.actions.length}` : `0 of ${livePlan.actions.length} moves made`;
        const goalText = livePlan.goalText ?? livePlan.goalTexts?.join("; ") ?? "the held goal";
        const remembered = `noted — remembered: "${board[0]}".`;
        const replan = await solveHeldGoals({ memoryDir, planHolder, gameConfig });
        if (replan.plan) {
          const moves = replan.plan.actions.map((a, i) => `${i + 1}. ${a.label}`).join("; ");
          return {
            text: `${remembered} That changes the board the live plan was standing on (${at}, toward: ${goalText}), so I replanned from the board as it now stands: ${moves}. Say "next" to make move 1.`,
            via: "plan", miss: false,
          };
        }
        // The write STANDS, but nothing reaches the goal from the moved board:
        // the old plan is dropped (goals kept, plan reset) and the failed replan
        // is named, never a silent success.
        const maxDepth = gameConfig?.planning?.maxDepth ?? DEFAULT_GAME_CONFIG.planning.maxDepth;
        planHolder.state = {
          goals: livePlan.goals, goalTexts: livePlan.goalTexts,
          actions: null, states: null, stepGoals: null, cursor: 0, done: false,
        };
        return {
          text: `${remembered} That changes the board the live plan was standing on (${at}, toward: ${goalText}) — from this new board no plan reaches the goal within ${maxDepth} moves, so the old plan is dropped. Re-teach the board or say "forget the goal".`,
          via: "plan", miss: false,
        };
      }
    }
  }

  // NEGATIVE UNIVERSAL — "no X is a Y" (the class-pair disjointness mint, or
  // the reflexive refusal) or its "no X can Y" capability sibling. Tried on
  // both surfaces, ahead of every frame that could otherwise read "no X" as
  // a subject literal — see NEGATIVE_UNIVERSAL_TEACH_RE's own docblock.
  {
    const negUniversalSrc = (wrapped ?? raw).replace(/[.!?]+\s*$/, "");
    if (memoryDir && !QUESTION_LEAD_RE.test(negUniversalSrc)
      && !(await hasMidSentenceInterrogative(negUniversalSrc))) {
      const negUniversal = await negativeUniversalTeach(negUniversalSrc, { memoryDir, sessionId })
        || await negativeUniversalCanTeach(negUniversalSrc, { memoryDir, sessionId });
      if (negUniversal) return negUniversal;
    }
  }

  // OWNERSHIP — "<Name> owns/maintains <X>", bare or remember-wrapped. The bare
  // form is double-gated: no interrogative lead, PLUS either side spelling a
  // Capitalized token — so the "who owns <X>" READ question and ordinary
  // lowercase prose ("everybody owns a share") never land a fact here. Either
  // side capitalized is enough — "sam owns TaskController" must not wall
  // entirely just because "sam" isn't capitalized, when "TaskController"
  // (own[2], the owned thing) is an obviously code-shaped proper name and
  // just as strong a signal that this isn't ordinary prose.
  const ownSrc = wrapped ?? raw.replace(/[.!?]+\s*$/, "");
  // Computed ONCE and reused by every ownSrc-gated frame below
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
  // PASSIVE ownership — "<X> is owned by <Name>". Same bare-form gate as the
  // active shape just above: a Capitalized owner
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

  // RELATED-TO — the closed pair "X relates to Y" / "X is related to Y"
  // maps onto mgx:relatedTo, the SAME predicate the SKOS view reads as
  // skos:related — giving the synonym/related lane its natural teach
  // phrasing. Without this the general-verb mint stored a preposition-glued
  // object ("cat mgx:relate 'to milk'") no reader could ever match.
  const relatedTo = ownSrc.match(RELATED_TO_TEACH_RE);
  if (relatedTo && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: relatedTo[1], predicate: "mgx:relatedTo", object: relatedTo[2],
    });
    if (stored) return stored;
  }

  // RELATIONAL FACT — "<Name> is the <role> of <Name>". Grouped with the
  // other relational/possessive teach shapes just above (both ownership
  // forms), tried on the SAME ownSrc, unconditionally
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

  // GENITIVE RELATIONAL FACT — "ahab is john's father" / "john's father is
  // ahab": the two possessive surfaces of the relational fact just above,
  // stored through the SAME predicate mint so every read-back ("who is the
  // father of john") answers all three phrasings identically. Same gating.
  const genitive = ownSrc.match(GENITIVE_RELATION_TEACH_RE);
  if (genitive && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: genitive[1], predicate: await generalVerbPredicate(genitive[3]), object: genitive[2],
    });
    if (stored) return stored;
  }
  const genitiveRev = ownSrc.match(GENITIVE_RELATION_TEACH_REV_RE);
  if (genitiveRev && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: genitiveRev[3], predicate: await generalVerbPredicate(genitiveRev[2]), object: genitiveRev[1],
    });
    if (stored) return stored;
  }

  // VERB-INFLECTED RELATIONAL FACT — "ahab fathered john": the past-tense
  // verb surface of the relational fact above, minted through the SAME
  // generalVerbPredicate so "who is the father of john" reads every phrasing
  // back identically. matchRelationalVerbTeach carries the closed guards
  // (name-shaped sides, POS-confirmed nouns, a lemma-confirmed inflected
  // past) that keep "the build failed" an honest non-match.
  const relVerb = memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion
    ? await matchRelationalVerbTeach(ownSrc) : null;
  if (relVerb) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: relVerb.subject, predicate: await generalVerbPredicate(relVerb.base), object: relVerb.object,
    });
    if (stored) return stored;
  }

  // HAS-A-METHOD TEACH — "every/a/an/the <N1> has a/an <N2> method": a
  // possession-of-capability claim, stored as an ordinary Fact via the SAME
  // HAS_A_PREDICATE generalVerbTeach's own
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

  // COMPOSE2 RULE TEACH — "a <name> is a <base1> of a <base2>": stores a RULE
  // (appendRule, kind "compose2"), never a Fact — tried right after the
  // relational fact above, on the SAME ownSrc, disjoint from it by determiner
  // alone (see
  // COMPOSE2_RULE_TEACH_RE's own docblock). The query-side hop-counted chase
  // lives in factReadBack's relational-query dispatcher.
  const compose2 = ownSrc.match(COMPOSE2_RULE_TEACH_RE);
  if (compose2 && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const { appendRule, RULE_KIND_COMPOSE2 } = await import("../adapters/memory/core.mjs");
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

  // FILTER RULE TEACH — "a <name> is a <base> who is <property>": stores a
  // RULE (appendRule, kind "filter"), never a Fact — tried right after the
  // compose2 block above, same ownSrc, disjoint from it by anchor word alone
  // ("who", never a second "of" — see FILTER_RULE_TEACH_RE's own docblock).
  // The query-side generic base-then-property chase lives in factReadBack's
  // relational-query dispatcher (resolveRelation's own "filter" branch).
  const filterRule = ownSrc.match(FILTER_RULE_TEACH_RE);
  if (filterRule && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const { appendRule, RULE_KIND_FILTER } = await import("../adapters/memory/core.mjs");
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
  // <name>": stores a RULE (appendRule, kind "recursive"), never a Fact.
  // Tried alongside the other
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
      const { appendRule, RULE_KIND_RECURSIVE } = await import("../adapters/memory/core.mjs");
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

  // ACTION-RULE TEACH — the five action frames plus the render binding (see
  // the ACTION_*_TEACH_RE docblock). Each sentence stores its own Rule
  // individual under a shared "<verb> <prep>" name. A role word that names
  // neither the taught subject class nor the literal "target" is an honest
  // decline that RETURNS here — falling through would hand these shapes to
  // the general-verb lane below, which would mint a garbage predicate from
  // them (the silent-garble case this lane exists to prevent).
  const actionLemma = verbLemma;
  const actionRoleFor = (word, subjectClass) => {
    const w = String(word || "").toLowerCase();
    if (w === "target") return "target";
    if (w === String(subjectClass || "").toLowerCase()) return "subject";
    return null;
  };

  const actionSig = ownSrc.match(ACTION_SIGNATURE_TEACH_RE);
  if (actionSig && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const verb = await actionLemma(actionSig[1]);
      const prep = actionSig[3].toLowerCase();
      const { appendRule, RULE_KIND_ACTION_SIGNATURE } = await import("../adapters/memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: `${verb} ${prep}`,
        kind: RULE_KIND_ACTION_SIGNATURE,
        slots: { subjectClass: actionSig[2], targetClass: actionSig[4] },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: you can ${verb} a ${actionSig[2].toLowerCase()} ${prep} a ${actionSig[4].toLowerCase()}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  const actionSigPassive = ownSrc.match(ACTION_SIGNATURE_PASSIVE_RE);
  if (actionSigPassive && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const participle = actionSigPassive[2].toLowerCase();
    const verb = await actionLemma(participle);
    // Same honesty rule as the effect frame's gerund: an unreduced participle
    // would mint a name no other rule sentence can share.
    if (verb !== participle && participle.startsWith(verb.slice(0, Math.min(3, verb.length)))) {
      try {
        const prep = actionSigPassive[3].toLowerCase();
        const { appendRule, RULE_KIND_ACTION_SIGNATURE } = await import("../adapters/memory/core.mjs");
        const { id } = await appendRule(memoryDir, {
          name: `${verb} ${prep}`,
          kind: RULE_KIND_ACTION_SIGNATURE,
          slots: { subjectClass: actionSigPassive[1], targetClass: actionSigPassive[4] },
          provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
        });
        if (id) {
          return {
            text: `noted — remembered: you can ${verb} a ${actionSigPassive[1].toLowerCase()} ${prep} a ${actionSigPassive[4].toLowerCase()}`,
            via: "assert", miss: false,
          };
        }
      } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
    }
  }

  const precondNothing = ownSrc.match(ACTION_PRECOND_NOTHING_RE);
  if (precondNothing && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const role = actionRoleFor(precondNothing[7], precondNothing[2]);
    if (!role) {
      return {
        text: `I can't place "${precondNothing[7]}" in that rule — the last word must be "target" or the ${precondNothing[2]} itself (e.g. "nothing may ${precondNothing[5].toLowerCase()} ${precondNothing[6].toLowerCase()} the ${precondNothing[2]}").`,
        via: "teach-miss", miss: true,
      };
    }
    try {
      const verb = await actionLemma(precondNothing[1]);
      const prep = precondNothing[3].toLowerCase();
      const innerVerb = await actionLemma(precondNothing[5]);
      const scopeWord = precondNothing[4].toLowerCase();
      const { appendRule, RULE_KIND_ACTION_PRECOND } = await import("../adapters/memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: `${verb} ${prep}`,
        kind: RULE_KIND_ACTION_PRECOND,
        slots: {
          shape: "no-incoming",
          predicate: `${innerVerb}-${precondNothing[6].toLowerCase()}`,
          role,
          scope: scopeWord === "target" ? "any" : scopeWord,
        },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: to ${verb} ${prep}, nothing may ${precondNothing[5].toLowerCase()} ${precondNothing[6].toLowerCase()} the ${role === "target" ? "target" : precondNothing[2].toLowerCase()}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  const precondComp = ownSrc.match(ACTION_PRECOND_COMPARATIVE_RE);
  if (precondComp && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const role = actionRoleFor(precondComp[5], precondComp[2]);
    const rightWord = precondComp[7].toLowerCase();
    const otherOk = role === "subject"
      ? (rightWord === "target" || rightWord === precondComp[4].toLowerCase())
      : (role === "target" && rightWord === precondComp[2].toLowerCase());
    if (!role || !otherOk) {
      return {
        text: `I can't place "${!role ? precondComp[5] : precondComp[7]}" in that rule — the compared words must be the ${precondComp[2]} and the target (e.g. "the ${precondComp[2]} must be smaller than the target").`,
        via: "teach-miss", miss: true,
      };
    }
    try {
      const verb = await actionLemma(precondComp[1]);
      const prep = precondComp[3].toLowerCase();
      const scopeWord = precondComp[4].toLowerCase();
      const { appendRule, RULE_KIND_ACTION_PRECOND } = await import("../adapters/memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: `${verb} ${prep}`,
        kind: RULE_KIND_ACTION_PRECOND,
        slots: {
          shape: "comparator",
          predicate: `${precondComp[6].toLowerCase().replace(/\s+/g, "-")}-than`,
          role,
          scope: scopeWord === "target" ? "any" : scopeWord,
        },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: to ${verb} ${prep}, the ${precondComp[5].toLowerCase()} must be ${precondComp[6].toLowerCase()} than the ${rightWord}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  const actionConstraint = ownSrc.match(ACTION_CONSTRAINT_TEACH_RE);
  if (actionConstraint && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    try {
      const verb = await actionLemma(actionConstraint[1]);
      const prep = actionConstraint[3].toLowerCase();
      const { appendRule, RULE_KIND_ACTION_CONSTRAINT } = await import("../adapters/memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: `${verb} ${prep}`,
        kind: RULE_KIND_ACTION_CONSTRAINT,
        slots: {
          left: actionConstraint[5].toLowerCase(),
          right: actionConstraint[6].toLowerCase(),
          guard: actionConstraint[7].toLowerCase(),
        },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: to ${verb} ${prep}, the ${actionConstraint[5].toLowerCase()} may not be with the ${actionConstraint[6].toLowerCase()} without the ${actionConstraint[7].toLowerCase()}`,
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  const actionEffect = ownSrc.match(ACTION_EFFECT_TEACH_RE);
  if (actionEffect && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const gerund = actionEffect[1].toLowerCase();
    const verb = await actionLemma(gerund);
    // An unreduced -ing form would mint a name ("moving onto") that can never
    // match the signature's ("move onto") — decline rather than store a rule
    // the interpreter can't collect.
    if (verb === gerund || !gerund.startsWith(verb.slice(0, Math.min(3, verb.length)))) {
      return {
        text: `I can't reduce "${actionEffect[1]}" to its verb right now — the lemmatizer isn't available. Retry later, or teach the other rule sentences first.`,
        via: "teach-miss", miss: true,
      };
    }
    // "makes IT rest on the target" leaves the role capture empty — the
    // pronoun can only mean the thing being moved, so it reads as the
    // subject-class word.
    const subjectWord = actionEffect[5] ?? actionEffect[2];
    const namedSubjectRole = actionRoleFor(subjectWord, actionEffect[2]);
    // A subject word naming neither the subject class nor "target" is
    // CLASS-BOUND: a companion that travels with every move ("ferrying a
    // passenger onto a bank makes the FARMER stand on the target"). Stored as
    // the bare class word; compileDomain (src/domain/domain.mjs) requires the class
    // to have exactly one member at plan time, so a typo'd word fails loudly
    // there rather than silently minting a role here.
    const subjectRole = namedSubjectRole ?? subjectWord.toLowerCase();
    const objectRole = actionRoleFor(actionEffect[8], actionEffect[2]);
    if (!objectRole || subjectRole === objectRole) {
      return {
        text: `I can't place "${actionEffect[8]}" in that rule — the effect must end at the ${actionEffect[2]} or the target (e.g. "makes the ${actionEffect[2]} rest on the target").`,
        via: "teach-miss", miss: true,
      };
    }
    try {
      const prep = actionEffect[3].toLowerCase();
      const effVerb = await actionLemma(actionEffect[6]);
      const { appendRule, RULE_KIND_ACTION_EFFECT } = await import("../adapters/memory/core.mjs");
      const { id } = await appendRule(memoryDir, {
        name: `${verb} ${prep}`,
        kind: RULE_KIND_ACTION_EFFECT,
        slots: {
          predicate: `${effVerb}-${actionEffect[7].toLowerCase()}`,
          subjectRole,
          objectRole,
        },
        provenance: teachProvenanceTag(sessionId, new Date().toISOString()),
      });
      if (id) {
        return {
          text: `noted — remembered: ${gerund} a ${actionEffect[2].toLowerCase()} ${prep} a ${actionEffect[4].toLowerCase()} makes the ${subjectWord.toLowerCase()} ${actionEffect[6].toLowerCase()} ${actionEffect[7].toLowerCase()} the ${actionEffect[8].toLowerCase()}`
            + (namedSubjectRole ? "" : ` (the ${subjectRole} rides along on every ${verb} move — its class must have exactly one member when we plan)`),
          via: "assert", miss: false,
        };
      }
    } catch { /* malformed slots — fall through to the ordinary honest-miss cascade */ }
  }

  const rendersAs = ownSrc.match(RENDERS_AS_TEACH_RE);
  if (rendersAs && memoryDir && !QUESTION_LEAD_RE.test(ownSrc) && !ownSrcMidQuestion) {
    const stored = await teachFact(memoryDir, sessionId, {
      subject: rendersAs[1], predicate: "mgx:rendersAs", object: rendersAs[2],
    });
    if (stored) return stored;
  }

  // GENERAL VERB-TO-PREDICATE TEACH — "remember <Subject> <verb>
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
    // BARE path: "grace mentors alan" — no "remember"/"note" wrapper at all.
    // Without this, such a sentence reaches neither this frame NOR an honest
    // miss, landing on the raw structural wall instead (or, at exactly <=3
    // words with no code-ish token, the UNRELATED isConversational()
    // orientation card — see subjectIsNounOrPropn's own docblock for why a
    // plain wrapper-required gate can't safely widen to bare sentences on
    // shape alone: "tell me a joke" fits the identical SVO shape and must
    // never be reified). Only a POS-confirmed NOUN/PROPN subject earns a try
    // here — the same distinction that separates a genuine declarative from
    // an imperative request. The QUESTION_LEAD_RE check runs the SAME
    // correctMisspellings() pass ask.mjs's own typo tolerance already uses
    // (not `raw` itself): "wich modules touch model.mjs" (a typo'd "which…"
    // structural question) POS-tags its uncorrected "wich" as a bare NOUN
    // (wink's honest fallback for any unrecognized token, not a real signal),
    // which would otherwise mis-store it as a fact instead of leaving it for
    // the structural grammar's own typo-tolerant retry to answer for real.
    // A determiner-led sentence opens with the article, which never POS-tags as
    // a noun, so the first word is the wrong word to gate on. When the
    // pinned-preposition frame can identify a real subject, POS-check the head
    // of THAT subject — the same word generalVerbTeach will store — and leave
    // every other sentence reading its first word exactly as before.
    const detLed = raw.match(GENERAL_VERB_DETERMINER_TEACH_RE);
    const detHasLed = detLed ? null : raw.match(DETERMINER_HAS_TEACH_RE);
    const quantHasLed = (detLed || detHasLed) ? null : raw.match(QUANTIFIED_HAS_TEACH_RE);
    const subjectWord = detLed ? detLed[1].split(/\s+/).pop()
      : (detHasLed ? detHasLed[1]
        : (quantHasLed ? quantifiedHasSubject(quantHasLed) : raw.match(/^([\w'-]+)/)?.[1]));
    // The quantifier lead ("every … has …") is itself a strong declarative
    // signal, so it overrides the single-token POS gate: a noun that doubles
    // as a verb ("every overbid has a gouger" — wink tags "overbid" VERB)
    // used to be a SILENT no-op and a later miss. A determiner-led possession
    // ("the tower has 3 disks") pins the same way, so it gets the same override.
    // NON_DECLARATIVE_OPENER_RE runs even for these leads — "every umm has a
    // thing" isn't a real quantified sentence, just filler that fits the shape.
    if (subjectWord && !NON_DECLARATIVE_OPENER_RE.test(subjectWord)
      && (quantHasLed || detHasLed || (await subjectIsNounOrPropn(subjectWord)))) {
      // A PLURAL explicit-capability surface ("wrens can hum") whose
      // SINGULAR is a grounded term stores under the singular first — the
      // spelling the grounding fact and every query-side variant fold use —
      // instead of letting the general-verb mint below reify the plural
      // verbatim (a fact "can a wren hum" could never read back). An
      // ungrounded singular falls through unchanged.
      const canShape = matchBareCanTeach(raw);
      const canSingular = canShape ? singularizeSurface(canShape.subject) : null;
      if (canShape && canSingular !== canShape.subject) {
        let canLex = lexicon;
        if (!canLex) { const { loadLexicon } = await import("../domain/grammar/lexicon.mjs"); canLex = loadLexicon(); }
        if (await isGroundedTerm(canSingular, canLex, memoryDir, cache)) {
          const stored = await teachFact(memoryDir, sessionId, {
            subject: canSingular, predicate: await capabilityPredicate(canShape.negated), object: canShape.verb,
          });
          if (stored) return stored;
        }
      }
      const gv = await generalVerbTeach(raw);
      if (gv) {
        const stored = await teachFact(memoryDir, sessionId, gv);
        if (stored) return stored;
      }
    }
  }

  let payload = null;
  if (wrapped && /\b(?:is|are)\b/i.test(wrapped)) payload = wrapped;
  else if ((BARE_DECLARATIVE_RE.test(raw) || COMPARATIVE_TEACH_RE.test(raw)
      || (matchesRelationalTeachFrame(raw) && !(await relationalFrameNamesGraphEntity(raw, graph)))
      || matchBareHabitualTeach(raw) || matchBareCanTeach(raw))
      && !QUESTION_LEAD_RE.test(raw) && !(await hasMidSentenceInterrogative(raw))) payload = raw;
  if (!payload) {
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
    // COMPARATIVE frame — "disk-1 is smaller than disk-2" → mgx:smaller-than.
    // Checked ahead of the ACE candidates: the copula plus "than" is not in
    // the ACE fragment at all, and letting it fall through produced the
    // both-sides-ungrounded decline (honest but unactionable — no phrasing
    // it could suggest would have stored a comparison).
    const comp = String(payload).trim().match(COMPARATIVE_TEACH_RE);
    if (comp) {
      const compPredicate = `mgx:${comp[2].toLowerCase().replace(/\s+/g, "-")}-than`;
      const stored = await teachFact(memoryDir, sessionId, {
        subject: comp[1].trim(), predicate: compPredicate,
        object: comp[3].trim().replace(/[.!?]+$/, ""),
      });
      if (stored) return stored;
    }
    // RELATIONAL teach frames — a participle+preposition claim
    // ("sales are closely connected with marketing"), a copula-NP with a
    // trailing participle ("sales are activities related to selling"), or a
    // shared-attribute claim ("sales and marketing have the same goal"). Each
    // reads through splitTeachNegation like its comparative/general-verb
    // siblings, so a negated form stores the mgxneg: twin.
    {
      const { payload: posPayload, negated } = splitTeachNegation(String(payload).trim());
      // (D) participle + preposition, checked ahead of the copula-NP form so a
      // bare participle right after the copula is never misread as a noun.
      const pp = posPayload.match(PARTICIPLE_PREP_TEACH_RE);
      if (pp) {
        const pred = `mgx:${pp[2].toLowerCase()}-${pp[3].toLowerCase()}`;
        const stored = await teachFact(memoryDir, sessionId, {
          subject: pp[1].trim(), predicate: negated ? negatedPredicate(pred) : pred,
          object: participleObject(pp[4]),
        });
        if (stored) return stored;
      }
      // (E) copula-NP + trailing participle — decomposed into the
      // class-membership half (subject ⊑ singular(NP head)) and the relational
      // half. The copula-NP shape is a deliberate declarative, strong enough to
      // mint the membership directly, so it lands even when neither term is in
      // the lexicon (the acceptance the ingest pipeline needs). Either half may
      // stand on its own if the other's write fails.
      const np = posPayload.match(COPULA_NP_PARTICIPLE_TEACH_RE);
      if (np) {
        const subject = np[1].trim();
        const relPred = `mgx:${np[4].toLowerCase()}-${np[5].toLowerCase()}`;
        const isaStored = await teachFact(memoryDir, sessionId, {
          subject, predicate: SUBCLASS_PREDICATE, object: singularizeSurface(np[3]),
        });
        const relStored = await teachFact(memoryDir, sessionId, {
          subject, predicate: negated ? negatedPredicate(relPred) : relPred,
          object: participleObject(np[6]),
        });
        const stripNoted = (t) => String(t).replace(/^noted — remembered(?:\s+\d+\s+facts?)?:\s*/i, "").trim();
        if (isaStored && relStored) return { text: `noted — remembered both: ${stripNoted(isaStored.text)}; and ${stripNoted(relStored.text)}`, via: "assert", miss: false };
        if (relStored) return relStored;
        if (isaStored) return isaStored;
      }
      // (F) shared attribute — "A and B have the same <noun>".
      const same = posPayload.match(SAME_NOUN_TEACH_RE);
      if (same) {
        const pred = `mgx:same-${same[3].toLowerCase()}-as`;
        const stored = await teachFact(memoryDir, sessionId, {
          subject: same[1].trim(), predicate: negated ? negatedPredicate(pred) : pred,
          object: same[2].trim(),
        });
        if (stored) return stored;
      }
    }
    for (const cand of assertCandidates(payload)) {
      // assertTurn ITSELF records the "every" quantifier (point 3) on a plain
      // universal success, so every caller (this loop AND the top-level
      // declarative-sentence dispatch in runTurn) gets it uniformly.
      const stored = await assertTurn(cand, { memoryDir, sessionId, focus: null, lexicon, cache });
      if (stored) return { text: stored.answer, via: "assert", miss: false };
    }
    // CAPABILITY over a GROUNDED subject — "penguins swim" (habitual) or "a
    // penguin can swim" (explicit) after "every penguin is a thing". The ACE
    // candidates above only parse closed-lexicon words, so a subject grounded
    // by a PRIOR taught fact (or an anchor root) still fell through to the
    // generic decline. Same closed shapes, same capability predicate the ACE
    // path itself stores. The subject's naive singular is tried too, so the
    // explicit plural surface ("penguins can swim") reaches the same stored
    // spelling the grounding fact used.
    const habitualTeach = matchBareHabitualTeach(payload) || matchBareCanTeach(payload);
    if (habitualTeach) {
      let habLex = lexicon;
      if (!habLex) { const { loadLexicon } = await import("../domain/grammar/lexicon.mjs"); habLex = loadLexicon(); }
      // The singular is preferred so an explicit plural surface ("penguins
      // can swim") stores under the same spelling the grounding fact (and
      // every query-side variant fold) uses; a proper noun that only looks
      // plural ("redis") falls back to its own spelling.
      for (const subj of new Set([singularizeSurface(habitualTeach.subject), habitualTeach.subject])) {
        if (await isGroundedTerm(subj, habLex, memoryDir, cache)) {
          const stored = await teachFact(memoryDir, sessionId, {
            subject: subj, predicate: await capabilityPredicate(habitualTeach.negated), object: habitualTeach.verb,
          });
          if (stored) return stored;
        }
      }
    }
    // The real ACE grammar just declined (unknown words / not the membership
    // shape) — try the narrow unknown-SUBJECT direct-write fallback before
    // falling to the honest-miss cascade. Covers BOTH the bare and the
    // wrapped surface (payload is already unwrapped either way) — see
    // unknownSubjectFallback's own docblock for the exact narrowing rules
    // (object must still be known, etc.).
    const fallback = await unknownSubjectFallback(payload, { memoryDir, sessionId, lexicon }, cache);
    if (fallback) return fallback;
    // MIRROR mint fallback: the known-subject/unknown-object asymmetry —
    // tried right after the unknown-subject case declines, so a subject the
    // STATIC lexicon (or a prior taught fact) already grounds can mint a
    // brand-new object term. See unknownObjectFallback's own docblock for the
    // exact narrowing rules (the "both sides ungrounded" safety guard, etc.).
    const objectFallback = await unknownObjectFallback(payload, { memoryDir, sessionId, lexicon, classIntent: kindOfClassIntent }, cache);
    if (objectFallback) return objectFallback;
    // ADJECTIVE-MINT fallback: tried right after unknownObjectFallback
    // declines, so a grounded subject (static
    // lexicon, a prior taught fact, or a bare Capitalized name) can mint a
    // brand-new adjective's property fact. See unknownAdjectiveFallback's own
    // docblock for the exact narrowing rules (the "both sides ungrounded"
    // safety guard, and why this must be a standalone function rather than
    // nested inside unknownSubjectFallback).
    const adjectiveFallback = await unknownAdjectiveFallback(payload, { memoryDir, sessionId, lexicon }, cache);
    if (adjectiveFallback) return adjectiveFallback;
    // PROPERTY teach — "remember/note that <X> is <adjective>": wrapper-REQUIRED
    // (a bare "X is deprecated" is never silently reified), and only after the
    // ACE grammar declined (unknown words / not the membership shape), so a
    // wrapped "X is a Y" over known lexicon still lands as rdfs:subClassOf.
    if (wrapped) {
      const prop = wrapped.match(TEACH_PROPERTY_RE);
      if (prop && !PLACE_ADVERB_OBJECT_RE.test(prop[2])) {
        const stored = await teachFact(memoryDir, sessionId, {
          subject: prop[1], predicate: HAS_PROPERTY_PREDICATE, object: prop[2],
        });
        if (stored) return stored;
      }
    }
  }
  // Compare the CORRECTED suggestion against a normalized (trimmed,
  // whitespace-collapsed, lowercased) form of what the user actually typed,
  // not the raw payload — so trivial formatting differences never
  // manufacture a spurious "did you mean". This suppresses the hint exactly
  // when X and Y themselves are already spelled in the canonical "every X is
  // a Y" shape (nothing useful to add), and shows it whenever the corrected
  // form differs — including the wrong-article case ("every monkey is a
  // animal").
  const normalizedPayload = String(payload).trim().toLowerCase().replace(/\s+/g, " ");
  const suggestion = teachSuggestion(payload);
  const did = suggestion && suggestion !== normalizedPayload ? ` Did you mean: "${suggestion}"?` : "";
  // Honest miss reason: when the payload structurally fits the ACE fragment
  // but names word(s) outside
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
      const { parseAce } = await import("../domain/grammar/ace.mjs");
      let lex = lexicon;
      if (!lex) { const { loadLexicon } = await import("../domain/grammar/lexicon.mjs"); lex = loadLexicon(); }
      for (const cand of assertCandidates(payload)) {
        const parse = parseAce(cand, lex);
        if (parse?.residue?.length) { unknown = [...new Set(parse.residue.map((w) => String(w).toLowerCase()))]; break; }
      }
    } catch { /* lexicon unavailable — fall through to the generic message */ }
  }
  // The real constraint: at least one side of a fact must already be
  // grounded (or the sentence must fit a specific relation shape) — general
  // vocabulary teaching itself is fully supported (e.g. "Paris is the capital
  // of France" stores directly).
  const why = unknown.length
    ? ` I don't recognize ${joinList(unknown.map((w) => `"${w}"`))} as ${unknown.length === 1 ? "a word" : "words"} I know — `
      + "any vocabulary works, but at least one side of a fact needs to already be grounded to something I "
      + "know (or fit one of my specific relation shapes), not two brand-new terms at once."
    : "";
  // Grounding NUDGE: APPENDED, never a replacement, exactly like "did" above
  // — see ungroundedPairHint's own docblock for why this is scoped to the
  // "both sides ungrounded, fits the X is/are Y shape" case only.
  const groundingHint = await ungroundedPairHint(payload, lexicon, memoryDir, cache);
  return {
    text: `I couldn't store that —${why} I remember facts in the shape "every X is a Y", where X and Y are `
      + `words I know.${did}${groundingHint} Type /memory to see what I already remember.`,
    via: "teach-miss", miss: true,
  };
}

// #2 INTENT LANE — META/SELF. Bare self/session questions answered from stats /
// memory / orientation, never the grammar wall. WOULD-MISS ONLY, every pattern
// a WHOLE-LINE self/session reference, so real graph queries never match.
// "what is in your memory" stays a synonym of "what do you know", not "what
// do you remember" — that phrase is WHOLE_RECALL_RE's own, more specific
// territory (it lists every remembered fact).
const WHAT_KNOW_RE = /^(?:what\s+(?:do\s+you|d'?you)\s+know(?:\s+so\s+far)?|what(?:'s|s|\s+is)\s+in\s+your\s+memory)$/;
// The most likely stranger openers join the orientation lane. "what does this
// do" needs the noun OPTIONAL after "this" (kept REQUIRED after "the") or it
// falls through to MODULE_ORIENT_RE, which fails to resolve "this" as an
// entity and hits the raw grammar wall.
const META_ORIENT_RE = /^(?:what(?:'s| is| are)?\s+this(?:\s+(?:app|codebase|repo|repository|project|code|thing))?|what\s+(?:codebase|repo|repository|project)\s+is\s+this|what\s+does\s+this(?:\s+(?:app|code|codebase|project|repo))?\s+do|what\s+does\s+the\s+(?:app|code|codebase|project|repo)\s+do|what\s+is\s+(?:this|the)\s+app(?:\s+for)?|what\s+am\s+i\s+looking\s+at|what\s+is\s+tmct|how\s+do\s+i\s+(?:start|begin|get\s+started|get\s+going|load\s+(?:my\s+)?code|index\s+(?:my\s+)?(?:code|repo|repository)|use\s+(?:this|you|tmct))|where\s+do\s+i\s+(?:start|begin)(?:\s+reading(?:\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?)?|what\s+should\s+i\s+(?:read|look\s+at)\s+first(?:\s+to\s+understand\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?|where\s+should\s+i\s+start\s+reading(?:\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?|where\s+do\s+i\s+begin\s+reading(?:\s+(?:this\s+)?(?:codebase|code|repo|repository|project))?)$/;
/** A bare "what is in here"/"what's in here"/"whats in here" — the SAME
 *  orientation intent as META_ORIENT_RE's own
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
 *  ACE lexicon: an abstract "every X is a Y" invites a curious user to
 *  substitute intuitive-but-unknown words — "every cache is a thing" — which
 *  the closed lexicon then rejects; "every bug is an issue" parses and stores. */
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

// #2(e) MODULE-GRAIN OVERVIEW. META_ORIENT_RE (above) can't match a module
// path/symbol name, so "what does app/lib/a.mjs do" needs its own lane.
// CASE-PRESERVING: reads the ORIGINAL query text, never metaLane's lowercased `q`.
/** A trailing intensifier/filler adverb tacked onto "do"/"does" ("what does the
 *  store module do exactly?", "...do exactly", "what X does really") — the
 *  closed-form anchor below requires "do"/"does" to be the LAST word before
 *  the optional "?", so this one extra word past it would otherwise hit the
 *  raw grammar wall even though the shared FILLER_WORDS/normalizeQuery pass
 *  (used elsewhere in the file) never sees this lane's case-preserving text
 *  at all. Mirrors MODULE_ORIENT_POLITENESS_RE
 *  just below: closed, optional, single-lane blast radius — a bare "what does
 *  X do" still matches with this suffix empty. */
const TRAILING_ADVERB_RE = "(?:\\s+(?:exactly|really|actually|anyway))?";
const MODULE_ORIENT_RE = new RegExp(`^what\\s+does\\s+(.+?)\\s+do${TRAILING_ADVERB_RE}\\??$`, "i");
/** The SUBJECT-FIRST word order of the SAME question ("what saveStore does" vs
 *  "what does saveStore do") — a perfectly natural alternate phrasing of an
 *  ALREADY-recognized intent that would otherwise hit the raw grammar wall
 *  outright (MODULE_ORIENT_RE's own anchor requires "does" BEFORE the term).
 *  Tried only when MODULE_ORIENT_RE/
 *  MODULE_PURPOSE_RE both miss; the entity-resolution gate just below (a real,
 *  UNIQUE graph entity or this lane declines) is what keeps this loose an
 *  ending safe — a syntactic match against a term that isn't a real entity
 *  simply falls through unchanged, same as every other lane in this file. */
const MODULE_ORIENT_SVO_RE = new RegExp(`^what\\s+(.+?)\\s+does${TRAILING_ADVERB_RE}\\??$`, "i");
/** "whats X do" / "what's X do" / "what is X do" — the CONTRACTED phrasing of
 *  "what does X do", where the auxiliary collapses into the "what's"/"whats"
 *  opener and "do" trails the term. MODULE_ORIENT_RE's own "does BEFORE the
 *  term" anchor never sees it, and MODULE_ORIENT_SVO_RE needs a literal "what "
 *  (with a space) so the bare "whats" spelling escapes that too. Safe to end
 *  this loosely because the lane's exact-unique resolveEntity gate below is
 *  still the sole authority — same argument as MODULE_ORIENT_SVO_RE: a term
 *  that is not a real unique entity (a pronoun subject "whats it do", a
 *  non-word) simply declines. The "what(?:'s|s|\s+is)" opener mirrors
 *  MODULE_PURPOSE_RE's tolerance for the apostrophe-less "whats" contraction. */
const MODULE_ORIENT_IS_DO_RE = new RegExp(`^what(?:'s|s|\\s+is)\\s+(.+?)\\s+do${TRAILING_ADVERB_RE}\\??$`, "i");
// Purpose/identity phrasing: "whats X for"/"what's X
// about"/"what is X for", the sibling of "what does X do" that asks for the
// SAME module-grain overview. Deliberately does NOT claim the literal noun
// "app" ("what is this app for") — META_ORIENT_RE (above) already hardcodes
// that exact phrasing and is checked BEFORE moduleOrientLane runs (metaLane's
// own ordering), so this regex only ever gets a chance at OTHER resolvable
// terms. "what(?:'s|s|\s+is)" mirrors PERSONAL_ASSISTANT_NUDGE_RE's own
// tolerance for the bare "whats" contraction spelling, just below.
const MODULE_PURPOSE_RE = /^what(?:'s|s|\s+is)\s+(.+?)\s+(?:for|about)\??$/i;
// "what is the purpose of the validate module" — the purpose-of phrasing of the
// SAME module-grain overview, asking by the module's role rather than "for"/
// "does". The captured object ("the validate module", "validate") is resolved
// through the SAME exact-unique resolveEntity gate below; a non-module term
// simply fails to resolve and the lane declines, so this never misroutes.
const MODULE_PURPOSE_OF_RE = /^what(?:'s|s|\s+is)\s+the\s+(?:purpose|point|role|job|function)\s+of\s+(.+?)\??$/i;

/** A module PATH as a reader types it — "src/core/store.mjs", "app/lib/b.mjs",
 *  or a bare "store.mjs". Requires a slash or a source-file extension, which is
 *  what makes the two identity phrasings below safe to claim: no vocabulary
 *  term can match this shape, so "what is a dog" is untouched. The lane's
 *  exact-unique resolveEntity gate is still the authority — this only decides
 *  what is worth ASKING it about. */
const MODULE_PATH_RE = /^(?:[\w.@~-]+\/)+[\w.@~-]+$|^[\w.@~-]+\.(?:mjs|cjs|js|jsx|ts|tsx|py|java|rb|go|rs|php|cs|kt|swift)$/i;
/** "what is src/core/store.mjs" — the identity phrasing of the same question
 *  "what does X do" already answers. Kept distinct from MODULE_PURPOSE_RE
 *  ("what is X for"), whose trailing "for"/"about" is what anchors it. */
const MODULE_IDENTITY_RE = /^what(?:'s|s|\s+is)\s+(.+?)$/i;

/** A leading politeness/formal-ESL wrapper this lane's own anchored regexes
 *  otherwise miss entirely: "please explain what does X do"
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
  // This lane reads the ORIGINAL (case-preserving) query text, so it needs its
  // own normalization: correctMisspellings for a typo'd anchor word ("waht
  // dose the logger modul do"), applyPreambleFrames for a topic-switch/
  // self-interruption preamble ("scratch that, what does X do") — plus a
  // lane-local politeness strip for "please explain X" (applyPreambleFrames's
  // own EXPLAIN_WRAPPER_RE requires the string to literally START with "explain",
  // so a LEADING "please"/"kindly" ahead of it defeats that frame; see
  // MODULE_ORIENT_POLITENESS_RE's own docblock). All four are additive,
  // closed-set, and idempotent on an already-clean query, so applying them here
  // only ever WIDENS what resolves, never narrows it.
  //
  // stripFillerWords (normalize.mjs) joins the set here: a leading discourse
  // filler that applyPreambleFrames' own LEADING_CONNECTIVE_RE doesn't catch
  // ("so um, like, what does the store module do exactly?" — the gate right
  // after "so" requires an ALREADY-interrogative remainder, which "um, like,
  // what does…" isn't) would otherwise leave MODULE_ORIENT_RE's own "^what
  // does …" anchor unmatched, so this lane silently declines and the query
  // falls all the way to the tailored-miss wall. Run AFTER applyPreambleFrames
  // (same order normalizeQuery's own pipeline uses — preamble frames need their
  // anchor words, like "so"/"please", intact) and BEFORE the politeness regex
  // (stripFillerWords already eats "please"/"could you" as filler; the politeness
  // regex only adds the "explain [to me]" wrapper on top).
  q = stripFillerWords(applyPreambleFrames(correctMisspellings(q))).replace(MODULE_ORIENT_POLITENESS_RE, "");
  const m = q.match(MODULE_ORIENT_RE) || q.match(MODULE_PURPOSE_OF_RE) || q.match(MODULE_PURPOSE_RE) || q.match(MODULE_ORIENT_SVO_RE) || q.match(MODULE_ORIENT_IS_DO_RE);
  // "what does src/core/store.mjs do" already reached the overview; the bare
  // path and "what is <path>" did not, so the same module answered one
  // phrasing and walled two. Both are claimed here rather than in ask.mjs,
  // whose Module fallback is absent BY DESIGN — adding it there replaces this
  // rich, module-grain overview with a thin one. Gated on the term looking
  // like a path, so this widens the lane by exactly the shape that was
  // missing and can never claim a vocabulary question.
  const identityMatch = m ? null : (q.match(MODULE_IDENTITY_RE)?.[1]?.trim() ?? null);
  const phrase = m ? m[1].trim() : (identityMatch ?? q);
  if (!phrase) return null;
  if (/^(?:it|this|that|they|them)$/i.test(phrase)) return null;
  const bare = phrase.replace(/^(?:the|a|an)\s+/i, "").trim();
  const phraseWords = bare.split(/\s+/);
  const pathTail = phraseWords[phraseWords.length - 1];
  // Only an ANCHORED phrasing (the orient/purpose match, or the "what is X"
  // identity match) may read a modifier-plus-path-tail phrase — the bare-q
  // fallback stays gated to a lone path shape, or any sentence that happens
  // to end in a module path would be claimed here.
  const tailLooksLikePath = !!(m || identityMatch) && phraseWords.length > 1 && MODULE_PATH_RE.test(pathTail);
  // The identity phrasing ("what is <term>") only ever claims a path-shaped
  // term — bare, or with modifier words ahead of a path-shaped tail — or,
  // below, a bare extensionless module basename.
  //
  // "what is codegraph": both siblings of that question already resolve the
  // module ("what is codegraph.mjs" via MODULE_PATH_RE, "describe codegraph"
  // via resolveSymbol's basename tier), so the extensionless identity form
  // resolves by the same evidence — exact basename-stem equality against
  // exactly ONE module. The gate stays strict: a single bare word with no
  // article (an articled "what is a dog" keeps its vocabulary reading), and
  // any tie or non-module term declines unchanged.
  if (!m && !MODULE_PATH_RE.test(bare) && !tailLooksLikePath) {
    if (!identityMatch || !/^[\w$][\w$.-]*$/.test(identityMatch)) return null;
    const stemLc = bare.toLowerCase();
    const stemHits = graph.individuals.filter((i) => i.class === "Module"
      && String(i.label).toLowerCase().split("/").pop().replace(/\.[a-z0-9]+$/, "") === stemLc);
    if (stemHits.length !== 1) return null;
    return { text: moduleOverviewText(graph, stemHits[0]), via: "meta" };
  }
  const ent = await resolveEntity(graph, m ? phrase : bare);
  if (ent) {
    const ind = graph.byId?.get?.(ent.id);
    if (!ind) return null;
    return { text: moduleOverviewText(graph, ind), via: "meta" };
  }
  // The stale-modifier residue guard the ask engine's resolver applies,
  // carried into this lane: modifier words the graph has no reading for never
  // resolve past silently ("the OLD store.mjs" is not store.mjs — the
  // modifier may be the question). Decline by name, pointing at the near
  // match, instead of falling to the bare wall.
  if (tailLooksLikePath) {
    const tailEnt = await resolveEntity(graph, pathTail);
    if (tailEnt) {
      const residue = phraseWords.slice(0, -1);
      const quoted = residue.map((w) => `"${w}"`).join(" and ");
      const names = residue.length === 1 ? "names" : "name";
      const past = residue.length === 1 ? "it" : "them";
      return {
        text: `no module matching "${bare}" found in the index. ${quoted} ${names} nothing here, and reading past ${past} would answer a different question. Did you mean ${tailEnt.label}?`,
        via: "meta",
        miss: true,
      };
    }
  }
  return null;
}

async function metaLane(query, { graph, memoryDir, last = null, templates = null, vocabHint = null, focus = null }) {
  // Preamble-peeled twin of `q`: a self-intro/greeting lead ("I'm new here,
  // what should I read first") wraps exactly the orientation questions this
  // lane owns, and the anchored META_ORIENT_RE can't see past it. Peeling
  // with the SAME closed frames every other surface uses is purely additive.
  const peeled = applyPreambleFrames(String(query).trim()).toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ").trim();
  const q = String(query).trim().toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  if (WHAT_KNOW_RE.test(q) || q === "what have you learned" || q === "what have you learnt") {
    return { text: await memorySummary(memoryDir, graph), via: "meta" };
  }
  if (peeled !== q && META_ORIENT_RE.test(peeled)) {
    const text = orientationText(graph, templates, vocabHint);
    return { text: last?.answer === text ? META_ORIENT_REPEAT_ONELINER : text, via: "meta" };
  }
  if (META_ORIENT_RE.test(q)) {
    // This META_ORIENT_RE branch is a SEPARATE route to the same class of
    // full-blurb text as the isConversational-triggered orientation branch
    // (below, via:"template") — without this, "what does this app do"
    // reprints orientationText(graph) verbatim on every repeat, never
    // collapsing. Mirrors ORIENTATION_REPEAT_ONELINER's identity-check
    // pattern exactly, with its own distinct oneliner text.
    const text = orientationText(graph, templates, vocabHint);
    return { text: last?.answer === text ? META_ORIENT_REPEAT_ONELINER : text, via: "meta" };
  }
  // A bare "what is in here" with NO standing focus — see
  // NO_FOCUS_WHATS_IN_HERE_RE's own docblock. Tested
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
  // An arbitrary "what does <term> do" that META_ORIENT_RE's closed noun
  // list didn't claim — try the module-grain overview before falling through to
  // the author-sha check below (disjoint triggers; order doesn't matter, but
  // this reads MORE of the query shape space, so it goes first).
  const moduleOrient = await moduleOrientLane(query, { graph });
  if (moduleOrient) return moduleOrient;
  // The sha-authorship form ("who authored a1b2c3d") can be as short as
  // THREE words, which the conversational-orientation branch (step 2) would grab
  // before the author step (4b) is reached — a bare hex sha is not "code-ish" to
  // isConversational. The form is closed + unambiguous (7-40 hex chars), so the
  // meta lane delegates it to the author lane here. Unknown/ambiguous shas return
  // null and fall through unchanged.
  if (AUTHOR_SHA_RE.test(q)) return authorLane(q, { graph });
  return null;
}

// #4 INTENT LANE — AUTHOR. Author is a Commit ATTRIBUTE (key
// "author"/mgx:commitAuthor), never an individual, so "who is Grace Hopper" can't
// resolve as an entity — this lane reads the attribute through codegraph.mjs's
// authorIndex renderers instead. WOULD-MISS gated (the ladder consults it only on
// a miss) + CLOSED whole-line regexes + an EXACT case-insensitive author-name hit:
// an unknown name renders null here and falls through to the ordinary honest miss
// (never a guess, never a hijacked graph query).
const AUTHOR_NAME_SRC = "([A-Za-z][\\w'.-]*(?:\\s+[A-Za-z][\\w'.-]*){0,3})";
// "was" joins "is": "who was grace hopper" is the same identity-card ask as
// "who is grace hopper", just past-tense phrasing — the way a curious user
// actually asks about a person, code author or not. Present tense alone
// would leave "who was <name>" falling all the way to the plain grammar wall
// even for a name IN the author index.
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

// #5(d,e)/#8 CAPABILITY NUDGES — closed regexes on the would-miss path
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

// #5(g) OUT-OF-DOMAIN PERSONAL-ASSISTANT NUDGE: "what time is it" / "what's
// the weather" — not a code-graph query, but a genuine capability ceiling
// (no clock/calendar/weather), so this is an honest decline, never a
// fabricated answer. Also accepts the bare "whats" contraction, since
// nudgeAnswer sees the raw (not contraction-normalized) query text.
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

/** STACCATO NEGATION ("not X", "not X then", "except X") — a rapid-fire
 *  rejection of a specific item, with no verb at all — the bare-connective
 *  sibling of STACCATO_PRONOUN_RE/STACCATO_SWAP_RE (below), but with no
 *  positive alternative named. Two flavors, BOTH genuinely unanswerable as a
 *  real graph query (never fabricated):
 *   - a BARE pronoun rejection ("not that one", "not those", "not it") names
 *     no alternative at all — what the user DOES want instead is known only
 *     to them, not derivable from the graph.
 *   - a NAMED rejection ("not app/lib/b.mjs", "not Widget then") names a real
 *     candidate to EXCLUDE from a just-given list, but excluding a member
 *     from a prior result set is a capability the engine genuinely doesn't
 *     have yet (even the fully-spelled "which of those is not X" doesn't
 *     compile — parsePredicateFilter has no negation branch).
 *  Without this, both fall to the generic orientation card (a short,
 *  non-codeish turn trips isConversational's ≤3-word catch-all) or the raw
 *  grammar wall (a codeish one, e.g. a path) — neither names what actually
 *  went wrong. This is an honest, GUIDING nudge, never a fabricated filtered
 *  answer and never a bare wall. */
const STACCATO_NEGATION_RE = /^(?:and\s+)?(?:not|except(?:\s+for)?)\s+(.+?)(?:\s+then|\s+though)?[?.!]*$/i;
const NEGATION_PRONOUN_RE = /^(?:it|that|this|those|them)(?:\s+ones?)?$/i;

/** STACCATO COMPARATIVE: "more than that", "which is bigger", "is
 *  there anything bigger", "bigger than that" following a superlative answer
 *  ("which module has the most imports" -> "src/handlers/tasks.mjs — 5").
 *  Genuinely unanswerable as a real graph query, never fabricated: tmct's
 *  superlative only ever names the single top (or bottom) match for a metric
 *  (evalSuperlative) — it has no "runner-up"/"next ranked" or "greater than a
 *  number" capability to reach for. Without this, both a short/non-codeish
 *  phrasing ("more than that") and the wall these route to (once the
 *  isConversational catch-all is deferred below) fall to the generic
 *  orientation card or the raw grammar wall — neither says what actually went
 *  wrong. Same "honest, guiding nudge, never a bare wall" discipline as
 *  STACCATO_NEGATION_RE just above; the standing focus (the superlative
 *  WINNER, since a superlative sets it) names what the user can compare
 *  against directly. */
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
    // A hardcoded "what is a dog" example here would be a lie in any UNSEEDED
    // session (no `tmct init`/corpus load ever ran) — the "vocab-hint is never
    // a lie" discipline this codebase applies on every other vocabulary-hint
    // surface (banner, greeting, capability orientation, meta/self, memory
    // summary). vocabHint (threaded from runAsk/runTurn's own
    // hasSeededVocabulary check) is ALREADY the correct session-gated clause:
    // "what is a dog" when seeded, `tmct init` otherwise — reused verbatim
    // instead of a second, ungated copy.
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
  // standing focus at all: describeWrapperAnswer (4d, below) already resolves
  // this shape perfectly when a real focus stands — it honestly DECLINES
  // (null) when there is none, same discipline as every other focus-dependent
  // lane. Without this branch, that decline falls through all the way to the
  // generic multi-line orientation card, which names nothing about what
  // actually went wrong. Symmetric with STACCATO_NEGATION_RE's own no-focus
  // nudge just above ("not sure what you'd like instead… — name it
  // directly"): a positive pronoun with nothing to point at gets the same
  // honest, tailored decline instead of the wall.
  const pronounContinuation = q.match(STACCATO_PRONOUN_RE);
  if (pronounContinuation && !focus?.label) {
    return `not sure what "${pronounContinuation[1].toLowerCase()}" refers to yet — name something directly, e.g. "what calls <name>".`;
  }
  return null;
}

// #5(f) PRESUPPOSITION HONEST-NUDGE. "why does a.mjs still import the
// deprecated store?" presupposes TWO checkable things (the import edge, the
// "deprecated" memory fact) — never accommodated silently; each is NAMED,
// confirmed or refuted, then the answer states what survives.
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
      try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { normFactTerm = null; }
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

/** The wall-repeat one-liner. MUST NOT match
 *  WALL_MISS_RE: the suppression keys on the PREVIOUS answer matching it, so this
 *  text self-limits — a third consecutive miss re-offers the tailored hint. */
const WALL_REPEAT_ONELINER = "still couldn't parse that — /help lists every query shape.";
/** The graph-less bootstrap wall's opening line — shared with the teach-offer
 *  collapse below, which treats this wall (like the shortened generic wall)
 *  as text a term-specific offer REPLACES rather than stacks under. */
const NO_GRAPH_BOOTSTRAP_WALL_LEAD = "I can't answer that as a code question — no code graph is loaded in this session.";

/** The orientation-repeat one-liner. The conversational
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
 *  orientation-class text. MUST differ from
 *  ORIENTATION_REPEAT_ONELINER (a distinct string, checked by identity) so the two
 *  independent repeat-suppression sites can never be confused with one another. */
const META_ORIENT_REPEAT_ONELINER = "still the same overview — /stats for the full one, /help for commands.";

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
    const { resolveObject } = await import("../domain/ask.mjs");
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
    ["/plan <request>", "the capability router: plan+execute a compound or maintenance-goal request (\"of the modules impacted by X, which are untested\", \"what most needs a test\")"],
    ["/capabilities", "what /plan can plan over: the built-in graph tools plus your taught actions"],
    ["/syllogise <term>", "work out and remember what follows from the facts about a term (needed for chains longer than 2 hops)"],
    ["/export <path>", "write the memory store to a file, as JSONL (the same shape `tmct memory --export` writes)"],
    ["/ingest <path>", "read a local text file and store every fact the recognizer grounds from it (same recognizer as `tmct extract`)"],
    ["/narrate on|off", "verbose developer/debug mode: decision points, matched pattern, results+sources, goal per turn"],
    ["/wiki on|off|supplement|always", "live Wikipedia (default off): on tries en.wikipedia.org when I can't answer (network), cited; supplement also adds a read-out under every grounded vocabulary answer; always widens that to every grounded answer"],
    ["research <topic> [limit N] [depth D]", "fetch the topic from Simple English Wikipedia (the explicit ask is the network consent), store what it grounds, and queue its linked topics — \"research next\" steps the queue; also status/stop. limit N caps the links queued per topic, depth D how many hops the queue follows (1 by default); a run also stops at its total node budget"],
    ["/help", "this list"],
    ["/exit", "leave the session (also Ctrl+C / Ctrl+D)"],
  ];
  const w = Math.max(...rows.map(([a]) => a.length));
  const lines = rows.map(([a, b]) => `  ${a.padEnd(w)}  ${b}`);
  let shapes;
  try { const { rephraseHint } = await import("../domain/ask.mjs"); shapes = rephraseHint(); }
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
 *  memory. Calibrated in the small-corpus regime (test/tools/wiring-recall.test.mjs):
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

/** Predicate-class content words bestQaPair requires a SHARED token from: every phrase in
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
 *  honest miss must stand. Recall HYGIENE: only a pair with a SUBSTANTIVE answer is recallable — a Q-only
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
    const { retrieveBlocks } = await import("../adapters/memory/blocks.mjs");
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
  "mgxneg:subClassOf": "is not a kind of",
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
  "mgx:rendersAs": "renders as", // the render-template binding ("a disk renders as a block")
  "mgx:synonym": "means the same as",
  "mgx:antonym": "is the opposite of",
  "mgx:similarTo": "is similar to",
  "mgx:relatedTo": "is related to",
  "mgx:symbolOf": "is a symbol of",
  // A loaded adventure world's placement predicates, so a describe read-back of
  // a visible prop reads as English ("lamp is in the study") instead of the
  // mechanical -s fold garbling them ("lamp locateds in study"). The world's
  // SECRET/mechanics predicates (a hidden object's location, the objective
  // marker, the lock/open/NPC internals) are kept out of the describe lane
  // entirely by WORLD_INTERNAL_PREDICATES below, so they never render at all.
  "mgx:currently-in": "is in",
  "mgx:located-in": "is in",
  "mgx:fixed-in": "is fixed in",
  "mgx:stands-locked-in": "stands locked in",
  "mgx:works-in": "works in",
};

/** The world-mechanics predicates the generic describe read-back must never
 *  surface: a hidden object's location and the objective marker spoil the
 *  puzzle, and the lock/container/open/NPC-schedule flags are datatype internals
 *  the adventure's own readers answer in-game. Mirrors adventure.mjs's own
 *  VIEW_EXCLUDED_PREDICATES — the same discipline the room-look digest uses. */
const WORLD_INTERNAL_PREDICATES = new Set([
  "mgx:hidden-in", "mgx:is-objective", "mgx:unlocks-with",
  "mgx:is-npc", "mgx:acts-on-turn", "mgx:acts-toward",
  "mgx:is-container", "mgx:is-open",
]);

/** The world PLACEMENT predicates carry curated phrases above so they render as
 *  English, but they must stay OUT of the query-marker families derived from
 *  FACT_PREDICATE_PHRASES — "what is in the study" is a members-of-class query,
 *  not a reverse placement lookup, and "is in" is far too broad an anchor. */
const WORLD_PLACEMENT_PREDICATES = new Set([
  "mgx:currently-in", "mgx:located-in", "mgx:fixed-in", "mgx:stands-locked-in", "mgx:works-in",
]);

/** The MECHANICAL fallback for a predicate this table has no curated entry
 *  for — specifically generalVerbTeach's minted "mgx:<lemma>" predicates
 *  ("mgx:eat", "mgx:drive", …) — the mechanical INVERSE of singularizeSurface's
 *  own naive -s/-es/-ies fold used elsewhere in this file, same accepted-
 *  limitation trade (no real morphology; a handful of doubly-irregular verbs
 *  render slightly off but never wrong-MEANING). "has"/"have" never reach
 *  this fallback — generalVerbPredicate special-cases them onto the CURATED
 *  mgx:hasA entry above before a predicate is ever minted. Any OTHER unknown
 *  predicate (not the "mgx:<lemma>" shape — e.g. a stray/foreign CURIE) still
 *  renders verbatim. */
function thirdPersonSingularSurface(lemma) {
  const w = String(lemma || "");
  // "have" should never reach this naive fallback at all
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
/** The INVERSE of thirdPersonSingularSurface — "eats" -> "eat", "flies" ->
 *  "fly", "has" -> "have". Do-support wants the bare infinitive after it
 *  ("does not EAT", never "does not eats"), and so does every derived
 *  forward yes/no reader ("does X cause Y"), so both fold through this one
 *  function and can never drift apart on a verb. */
function baseVerbSurface(verb) {
  const w = String(verb || "");
  if (/^has$/i.test(w)) return "have";
  if (/[a-z]ies$/i.test(w) && !/[aeiou]ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh|o)es$/i.test(w)) return w.slice(0, -2);
  return w.replace(/s$/i, "");
}
function predicatePhrase(predicate) {
  if (FACT_PREDICATE_PHRASES[predicate]) return FACT_PREDICATE_PHRASES[predicate];
  const p = String(predicate || "");
  // NEGATIVE polarity renders as its own positive phrase, negated — ONE branch
  // for every predicate that can carry a polarity, curated or minted. The
  // negative twins are deliberately absent from FACT_PREDICATE_PHRASES: the
  // TRAILING_PREDICATE_MARKERS / REVERSE_PREDICATE_MARKERS /
  // FORWARD_YESNO_MARKERS families all derive their vocabulary from that table,
  // so an entry there would auto-mint readers for "what cannot X" and
  // "does X cannot Y" that nobody wrote and nothing pins.
  // The three surface shapes split exactly as FORWARD_YESNO_MARKERS splits
  // them, for the same reason: a modal, a copula and a plain verb take
  // different negations, and nothing else does.
  const positive = positivePredicate(p);
  if (positive) {
    const phrase = predicatePhrase(positive);
    if (phrase === "can") return "cannot";
    if (phrase === "can be") return "cannot be";
    if (phrase === "is" || phrase.startsWith("is ")) return `is not${phrase.slice(2)}`;
    const [head, ...tail] = phrase.split(" ");
    return ["does not", baseVerbSurface(head), ...tail].join(" ");
  }
  // a comparative renders as its copula surface: mgx:smaller-than ->
  // "is smaller than" (never a 3sg fold — "smallers" isn't a word)
  const comp = /^mgx:([a-z]+(?:-[a-z]+)*)-than$/i.exec(p);
  if (comp) return `is ${comp[1].replace(/-/g, " ")} than`;
  // a participle + preposition renders as its copula surface: mgx:connected-with
  // -> "is connected with" (the participle is already a participle, so no 3sg
  // fold — "connecteds" isn't a word)
  const part = new RegExp(`^mgx:(${TEACH_PARTICIPLE_SRC})-([a-z]+)$`, "i").exec(p);
  if (part) return `is ${part[1].toLowerCase()} ${part[2].toLowerCase()}`;
  // a shared-attribute predicate: mgx:same-goal-as -> "has the same goal as"
  const same = /^mgx:same-([a-z]+)-as$/i.exec(p);
  if (same) return `has the same ${same[1].toLowerCase()} as`;
  const m = /^mgx:([a-z]+)(?:-([a-z]+))?$/i.exec(p);
  if (!m) return predicate;
  // a folded preposition renders back naturally: mgx:rest-on -> "rests on"
  return `${thirdPersonSingularSurface(m[1])}${m[2] ? ` ${m[2]}` : ""}`;
}
const factPhrase = (f) => `${f.subject} ${predicatePhrase(f.predicate)} ${f.object}`;

/** The mechanical INVERSE of generalVerbPredicate: recovers the bare role/verb
 *  word a taught relational Fact's predicate was minted from ("mgx:father" ->
 *  "father"), or null for a predicate that isn't the "mgx:<word>" mint shape at
 *  all (a curated predicate like mgx:hasProperty/mgx:ownedBy/mgx:hasA never
 *  names a chaseable relation, so callers below simply never match it against
 *  a queried relation name). factReadBack's relational-query dispatcher (RELATION_FACT_YESNO_RE)
 *  uses this to enumerate "which already-taught fact-predicates touch this
 *  (subject, object) pair" without hand-rolling a second lemma table — the
 *  SAME "mgx:<lemma>" shape generalVerbPredicate mints is simply read backward,
 *  synchronously (no lemmatizer round-trip needed to go this direction). */
function relationRoleWord(predicate) {
  const m = /^mgx:([a-z][\w-]*)$/i.exec(String(predicate || ""));
  return m ? m[1].toLowerCase() : null;
}

// ---- "what is a tree used for" filters to JUST the UsedFor facts, instead
// of swallowing "tree used for" whole as one literal (unresolvable) term.
// Derives its trailing-marker vocabulary from FACT_PREDICATE_PHRASES itself
// (no curated second table) — the single-letter "a" is excluded, too short
// to anchor on without risking eating a genuine multi-word subject.
const TRAILING_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES)
  .filter(([predicate]) => !WORLD_PLACEMENT_PREDICATES.has(predicate))
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
 *  source cited, not "i learned: …" — that phrase over-claims and anthropomorphises
 *  a first-person experience the bot never had; the relation and its provenance
 *  speak for themselves. A WEAK-corpus fact (memory/trust.mjs SOURCE_PRIOR.corpusWeak
 *  — real data, low-precision relation, e.g. ConceptNet's undirected /r/RelatedTo)
 *  still isn't "i learned" (same anthropomorphism problem), but rendering it
 *  identically to a solid corpus fact would lose the only reader-visible signal
 *  that it's lower-confidence, so a distinct, honest hedge ("possibly: …")
 *  applies here instead. Provenance stays VERBATIM in every case. */
function renderFactLine(f) {
  const cite = f.provenance ? ` (source: ${f.provenance})` : "";
  // ace:chat = the ACE-parsed operator assert; teach:chat = the teach lane's
  // natural frames — both are things the operator SAID, so both read first-person.
  if (f.provenance.includes("ace:chat") || f.provenance.includes("teach:chat")) return `you told me: ${factPhrase(f)}${cite}`;
  // WEAK corpus facts (lower trust, e.g. RelatedTo) — real, cited, but hedged as
  // uncertain rather than either flatly stated or falsely claimed as "learned".
  if (f.provenance.includes("corpus-weak:")) return `possibly: ${factPhrase(f)}${cite}`;
  // SOLID corpus facts are background DATA — present the relation plainly, cited
  // to its source, never "i learned: …" (a first-person claim over corpus data).
  if (f.provenance.includes("corpus:")) return `${factPhrase(f)}${cite}`;
  // Reference-pack facts are the same class of cited data — the "i learned:"
  // frame read as a definition-less non-answer on the re-ask.
  if (f.provenance.includes("reference:")) return `${factPhrase(f)}${cite}`;
  return `i learned: ${factPhrase(f)}${cite}`;
}

const SENSE_CITE_RE = / \(source: [^)]*\)$/;

/** Append an is-a object's superclass chain to its rendered fact line, before
 *  the citation: "rover is a kind of dog" becomes "rover is a kind of dog →
 *  canine → mammal → animal". Only the subject-side is-a lines of the queried
 *  term get a chain; every other line renders unchanged. */
function renderFactLineWithChain(f, parents, subjectVariants) {
  const base = renderFactLine(f);
  if (!ISA_PREDICATES.has(f.predicate) || !subjectVariants.has(f.subject)) return base;
  const chain = ancestryChain(f.object, parents, { cap: 6 });
  if (chain.length <= 1) return base;
  const suffix = ` → ${chain.slice(1).join(" → ")}`;
  const cite = base.match(SENSE_CITE_RE);
  return cite ? base.slice(0, cite.index) + suffix + cite[0] : base + suffix;
}

/** Render a subject-scan fact list with each is-a object's superclass chain
 *  shown, and — when the subject's is-a objects split into distinct concepts
 *  (a `dog` sense and a `scout` sense of one "rover") — grouped by concept.
 *  Grouping is presentation only: every fact still renders and is cited, in
 *  the same order, under a "<subject>, the <concept>:" heading.
 *
 *  Returns `{ lines, grouped }`. `lines` is the flat, chain-enhanced rendering
 *  (indented by `indent`) the caller uses when senses do not split. `grouped`
 *  is a ready `{ text, replace, pending? }` answer when they do, else null. */
function senseSplitFactList(hits, rows, subjectVariants, { indent = "" } = {}) {
  const subClassEdges = rows.filter((f) => f.predicate === SUBCLASS_PREDICATE).map((f) => [f.subject, f.object]);
  const parents = subClassParents(subClassEdges);
  const lines = hits.map((f) => `${indent}${renderFactLineWithChain(f, parents, subjectVariants)}`);

  const isaSubjectFacts = hits.filter((f) => ISA_PREDICATES.has(f.predicate) && subjectVariants.has(f.subject));
  const isaObjects = [...new Set(isaSubjectFacts.map((f) => f.object))];
  if (isaObjects.length < 2) return { lines, grouped: null };
  const disjointEdges = rows.filter((f) => f.predicate === "owl:disjointWith").map((f) => [f.subject, f.object]);
  const { split, clusters } = clusterSenses(isaObjects, { parents, disjointEdges });
  if (!split) return { lines, grouped: null };

  const subject = isaSubjectFacts[0].subject;
  const clusterOf = new Map();
  for (const c of clusters) for (const o of c.objects) clusterOf.set(o, c);
  const otherHits = hits.filter((f) => !(ISA_PREDICATES.has(f.predicate) && subjectVariants.has(f.subject)));

  const blocks = [];
  const restItems = [];
  let shownCount = 0;
  const addLine = (f) => {
    const rendered = renderFactLineWithChain(f, parents, subjectVariants);
    if (shownCount < FACT_ANSWER_CAP) { shownCount += 1; return `${indent}${rendered}`; }
    restItems.push(rendered);
    return null;
  };
  for (const c of clusters) {
    const clusterLines = isaSubjectFacts.filter((f) => clusterOf.get(f.object) === c).map(addLine).filter(Boolean);
    if (clusterLines.length) blocks.push(`${indent}${subject}, the ${c.label}:\n${clusterLines.join("\n")}`);
  }
  if (otherHits.length) {
    const otherLines = otherHits.map(addLine).filter(Boolean);
    if (otherLines.length) blocks.push(`${indent}also about ${subject}:\n${otherLines.join("\n")}`);
  }
  const extra = restItems.length ? `\n${indent}…and ${restItems.length} more — say 'more' to see them.` : "";
  const grouped = {
    text: blocks.join("\n") + extra,
    replace: true,
    ...(restItems.length ? { pending: { items: restItems, noun: "facts" } } : {}),
  };
  return { lines, grouped };
}

// A subject-scan term answer longer than this many flat fact lines leads with a
// deterministic digest paragraph (src/domain/digest) and holds the full list
// behind the escape; a shorter answer is already readable as a list.
const DIGEST_READBACK_THRESHOLD = 8;

/** The digest lead for a subject-scan term answer: a bounded narrative first
 *  (selection, sentence structures, composition — all deterministic, no model),
 *  the full fact list held behind the "show the facts"/"more" escape. `termRows`
 *  are the term's own fact rows, `allRows` the whole store the statistics scan
 *  over, `lines` the already-rendered flat fact list the escape reveals.
 *
 *  Returns { text, pending } or null. Null when the structure bank is
 *  unavailable (the in-browser dock stubs the filesystem loader out) or the
 *  selector kept nothing renderable, so the caller falls back to the flat list —
 *  the same graceful degradation the construction banks take in a browser
 *  bundle. Deterministic; the digest reads only stored facts. */
async function termDigestReadBack(term, termRows, allRows, lines) {
  let digestTermFromRows;
  try { ({ digestTermFromRows } = await import("../adapters/corpus/digest-bank.mjs")); }
  catch { return null; }
  let article;
  try { article = digestTermFromRows(term, termRows, allRows); }
  catch { return null; }
  if (!article || !article.paragraphs.length) return null;
  const sources = [...new Set((article.sources || []).map((s) => s.provenance).filter(Boolean))];
  const sourceLine = sources.length ? `(sources: ${sources.join("; ")})\n` : "";
  const escape = `Say 'show the facts' for all ${lines.length} stored facts.`;
  const text = `${article.paragraphs.join("\n\n")}\n\n${sourceLine}${escape}`;
  return { text, pending: { items: lines, noun: "facts" } };
}

/** "a"/"an" for a term, through the SAME grammar-rules.toml "article" rule and
 *  finish.mjs's beginsWithVowelSound every other agreement site in this file
 *  uses — never a hardcoded "a", which is ungrammatical for a vowel-initial
 *  term ("forget that task is a animal"). */
function indefiniteArticleFor(term) {
  const articleRule = grammarRules().find((r) => r.kind === "article");
  return articleRule && beginsWithVowelSound(String(term || ""), articleRule) ? "an" : "a";
}

/** The verdict on an is-a question, given the best stored fact of each
 *  polarity. Null when neither is stored, so a caller's own honest miss stands
 *  — an absent positive is never a "no".
 *
 *  BOTH POLARITIES STORED names both sources and picks NOTHING, which is the
 *  "both" verdict memory/capability.mjs already defines for the capability
 *  family. Preferring either one would rank a tie-break the reader can't see
 *  above what they actually said; recency in particular looks like a
 *  correction and is just as often a second speaker.
 *
 *  Shared by the two is-a readers (the memory-facts lane and the full ladder),
 *  so a disagreement reads identically whichever one answers. */
function isaPolarityReply(hit, negHit) {
  if (hit && negHit) {
    return {
      text: `you've told me both, and I won't pick between them — ${renderFactLine(hit)}; ${renderFactLine(negHit)}. `
        + `To settle it, say "forget that ${hit.subject} is ${indefiniteArticleFor(hit.object)} ${hit.object}".`,
      replace: true,
    };
  }
  if (negHit) return { text: `no — ${renderFactLine(negHit)}`, replace: true };
  if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
  return null;
}

/** The verdict when a would-be "yes" (a stored fact or a proof chain) crosses
 *  a stored disjointness on the same resolved chain: name both stored facts
 *  and refuse to conclude. A proof is the strongest honesty claim this file
 *  makes, and certifying one side of a stored contradiction would launder the
 *  inconsistency as a derivation — so neither side wins, same discipline as
 *  isaPolarityReply's both-sides verdict. */
function isaInconsistencyRefusal(posFact, disjointFact) {
  const cite = (f) => `${factPhrase(f)}${f.provenance ? ` (source: ${f.provenance})` : ""}`;
  return {
    text: `you've told me both ${cite(posFact)} and ${cite(disjointFact)} — together those contradict, and I won't derive an answer from an inconsistency. `
      + `To settle it, say "forget that ${posFact.subject} is ${indefiniteArticleFor(posFact.object)} ${posFact.object}".`,
    replace: true,
  };
}

/** PROOF-CHAIN RECEIPT — "renderable as a chain of thought in words": render
 *  an ordered list of
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
    const { loadMemory } = await import("../adapters/memory/core.mjs");
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
 *  readFactRows — the seam the answer layer ranks + cites without re-walking
 *  the graph shape. Lazy + failure-tolerated: no memory → [].
 *
 *  `cache`: an optional, caller-owned plain object (`{ rows: null }`, e.g. one
 *  runTurn call's own `factRowsCache`) — when `cache.rows` is already
 *  populated, it's returned directly, skipping loadMemory/readFactRows
 *  entirely; otherwise the result is computed as before and stashed onto
 *  `cache.rows` for the next caller sharing the same cache this turn.
 *  Absent/null (the default) reproduces a fresh, uncached reload every call,
 *  so every caller that doesn't pass one is byte-for-byte unaffected. Never
 *  shared across turns or with mutateMemory. `cache.reloads` is bumped once
 *  per REAL loadMemory/readFactRows call (never on a cache hit) purely so a
 *  test can assert "computed once per turn" by call count instead of
 *  wall-clock. */
async function factRows(memoryDir, cache = null) {
  if (cache?.rows) return cache.rows;
  try {
    const { loadMemory, readFactRows } = await import("../adapters/memory/core.mjs");
    const rows = readFactRows(await loadMemory(memoryDir));
    if (cache) { cache.rows = rows; cache.reloads = (cache.reloads || 0) + 1; }
    return rows;
  } catch {
    return [];
  }
}

/** Spelling variants a question term is matched under (normFactTerm + a naive
 *  singular): "caches"/"a cache"/"/c/en/cache" all reach the stored "cache". */
/** The lexicon's declared plural → lemma map ("men"→"man", "people"→"person"),
 *  loaded once. It carries ONLY the irregulars — a regular plural is recovered
 *  by the -s/-es fold below, so declaring one would be redundant — which is
 *  exactly the set that fold cannot reach. Failure-tolerated: a broken lexicon
 *  degrades to the fold alone, never a crash. */
let declaredNounPlurals = null;
function irregularSingularOf(word) {
  if (!declaredNounPlurals) {
    try { declaredNounPlurals = loadLexicon().nounPlurals; } catch { declaredNounPlurals = new Map(); }
  }
  return declaredNounPlurals.get(word) ?? null;
}

/** A subject as it should be SPOKEN BACK in an offered teach sentence: the
 *  lexicon's own lemma for a single known noun, else the reader's words
 *  untouched.
 *
 *  Without it a plural subject was echoed raw into a singular frame —
 *  "remember that women is mortal" — offering a sentence that is both
 *  ungrammatical and not the shape the teach path stores. lookupNoun is the
 *  lemmatizer the teach path already uses, and it is the whole plural detector:
 *  it folds "women"→woman and "dogs"→dog while leaving "bus" alone, which no
 *  -s rule written here could do. A multi-word or unknown subject is left
 *  exactly as typed — "every zibble is mortal" already reads correctly, and
 *  guessing at a phrase's head would be worse than echoing it. */
function teachableSubjectOf(subject) {
  const raw = String(subject || "").trim().toLowerCase();
  if (!raw || /\s/.test(raw)) return raw;
  try {
    return lookupNoun(loadLexicon(), raw)?.lemma || raw;
  } catch {
    return raw;
  }
}

/** The teach-shaped restatement of a QUANTIFIED-PLURAL subject: "all dogs"
 *  folds to "a dog", so an offered sentence stays grammatical and teachable —
 *  echoing the quantifier into a singular frame produced "all dogs is
 *  mortal". Any other subject keeps teachableSubjectOf's own reading. */
function suggestibleSubjectPhrase(subject) {
  const m = String(subject || "").trim().match(/^(?:all|every|each|both|most|some)\s+([\w-]+)$/i);
  if (!m) return teachableSubjectOf(subject);
  const singular = teachableSubjectOf(singularizeSurface(m[1]));
  return `${indefiniteArticleFor(singular)} ${singular}`;
}

/** A leading universal quantifier, which is scaffolding rather than part of a
 *  name. The teach frames strip exactly these before storing (UNKNOWN_SUBJECT_RE
 *  above carries the same set), so no fact is ever stored under a subject that
 *  begins with one — which is what makes stripping it here a lookup fix and not
 *  a guess. "a"/"an" are deliberately absent: the readers' own regexes already
 *  take the article. */
const QUANTIFIER_LEAD_RE = /^(?:every|each|all|any)\s+/i;

function factTermVariants(normFactTerm, term) {
  const t = normFactTerm(term);
  const v = new Set();
  // The ask frames glue a quantifier onto the subject and looked up "every
  // man", a name nothing is stored under, while "is a man mortal" answered.
  // Both spellings fold through the same plural rules below, so "are all men
  // mortal" reaches "man" the same way "are men mortal" does.
  const bases = new Set([t]);
  const unquantified = t.replace(QUANTIFIER_LEAD_RE, "").trim();
  if (unquantified && unquantified !== t) bases.add(unquantified);
  for (const base of bases) {
    v.add(base);
    if (base.endsWith("es")) v.add(base.slice(0, -2));
    if (base.endsWith("s")) v.add(base.slice(0, -1));
    // An IRREGULAR plural is invisible to the fold above: "men" keeps every
    // letter of "man" in a different order, so a reader asking "do men die"
    // looked up a subject no fact is stored under while "does a man die"
    // answered. The teach path stores the singular, so the ask path has to be
    // able to reach it.
    const irregular = irregularSingularOf(base);
    if (irregular) v.add(normFactTerm(irregular));
  }
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
 *  would confidently answer YES off a fact taught for "logger module" (a
 *  real false-positive fabrication, not a routing gap). Mirrors RECALL_STOPWORDS' own
 *  path-noise exclusion (src/lib/mjs never counting as a real overlap
 *  either) — same principle, a different word class. */
const GENERIC_ENTITY_WORDS = new Set([
  "module", "modules", "class", "classes", "function", "functions",
  "method", "methods", "handler", "handlers", "controller", "controllers",
  "service", "services", "component", "components", "flow", "flows",
  "thing", "things", "item", "items", "object", "objects", "commit", "commits",
]);

// ---- synonymsOf(term): QUERY-TIME term expansion wiring the two
// already-parsed-but-inert synonym resources below. This widens what a
// vocabulary QUESTION can be matched against (the memory fact/corpus term
// space), never what parseAce can TEACH (the ACE lexicon gate is untouched).
// A synonym-expansion hit ALWAYS renders its licensing source visibly —
// never a silent substitution (the confident-wrong discipline every other
// lane here already follows). ----

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
 *  PRECISION PASS: a spot check of the raw /r/Synonym slice showed the noise
 *  concentrates in multi-word / punctuated endpoints (generic-English senses,
 *  proper-noun collisions); this index admits only SINGLE-WORD,
 *  purely-alphabetic ConceptNet endpoints on BOTH sides of a row — a
 *  first-cut heuristic filter, not a full manual review of all rows. Even
 *  after the single-word filter, generic-English collisions ("battalion"~
 *  "heap", "bash"~"sock") and, more dangerously, IN-DOMAIN false synonyms —
 *  pairs where both endpoints are real software terms but are NOT
 *  interchangeable ("interpreter"~"compiler", "string"~"thread") — remain,
 *  the exact "confidently wrong within the domain" failure this codebase's
 *  ground rules treat as worse than an honest miss. SYNONYM_DENYLIST below
 *  removes the specific false pairs found by manual review (a
 *  manually-reviewed blocklist, the same shape as `conceptnet-map.toml`'s own
 *  reviewed relation-gate — not a general noise heuristic); a full manual
 *  review of the remaining rows is still an open follow-up. */
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
    const { loadSlice, loadMap, termText } = await import("../adapters/corpus/conceptnet.mjs");
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
    const { loadPhrasebook } = await import("../adapters/corpus/templates.mjs");
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
 *  reader, dispatched from ONE recognizer — see factReadBack's own relAsk
 *  block for the full 3-step lookup: direct fact, alias-chased fact, then
 *  compose2 rule. Deliberately tried BEFORE ISA_ASK_RE gets a chance at this
 *  shape: "is ahab a parent of john" ALSO fits ISA_ASK_RE's own "a"/"an"
 *  determiner alternation (backtracking "parent of john" into ISA_ASK_RE's
 *  single free-form object capture), and whichever regex's block runs FIRST
 *  wins the shape outright. Accepts "the" (a literal-"the" direct-fact query,
 *  "is ahab the father of john") AND "a"/"an" (an alias-chase/rule-chase
 *  query, which needs the indefinite article since the relation/rule name
 *  being asked about is itself often the more general or composed one) — the
 *  determiner carries no write-time collision risk here the way
 *  RELATION_FACT_TEACH_RE vs COMPOSE2_RULE_TEACH_RE's determiner split does,
 *  because this is a READ-side reader with a single unified dispatcher, not
 *  two competing WRITE shapes. Structurally disjoint from plain
 *  ISA_ASK_RE/OWNS_PASSIVE_YESNO_RE shapes that have no trailing " of <Y>"
 *  clause at all ("is a module a component" — no "of" clause — never matches
 *  this regex). */
const RELATION_FACT_YESNO_RE =
  /^(?:is|are|was|were)\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+(?:the|an?)\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;

/** "who is the grandparent of john" — the REVERSE relational-query reader.
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
 *  name). Dispatch lives in factReadBack's own (a0.2) block,
 *  below — a `resolveRelationChaseReverse` closure re-deriving the SAME
 *  resolution logic as (a0)'s `resolveRelationChase` (direct fact, alias via
 *  findIsaChain, compose2 via a reverse hop-counted chase, filter via a
 *  recursive base-then-property chase), walked backward from the object.
 *  "who" also accepts "what" — a taught relation whose role isn't a person ("paris is the capital
 *  of france") reads naturally as "what is the capital of france", and the
 *  resolution below is identical either way (it just returns the satisfying
 *  subject(s)); the two words never compete for a query built from a DIFFERENT
 *  shape, since T5's bare meta-whatis grammar shape ("what is X") only wins the
 *  turn when factAnswer/factReadBack's own more specific readers upstream (this
 *  one included) have already declined. */
const RELATION_WHO_ASK_RE =
  /^(?:who|what)\s+(?:is|are)\s+(?:the|an?)\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;

/** "who is john's father" — the GENITIVE surface of RELATION_WHO_ASK_RE.
 *  A pure rewrite onto that shape (the matchWhyIsa approach): returns a
 *  match-shaped array with the same slot order RELATION_WHO_ASK_RE produces
 *  ([1]=relation, [2]=object), so the dispatch block below serves both
 *  surfaces with no second lane. The possessive token excludes apostrophes
 *  ([\w-]+) so the 's split is unambiguous. */
const GENITIVE_WHO_ASK_RE =
  /^(?:who|what)\s+(?:is|are|was|were)\s+([\w-]+(?:\s+[A-Z][\w-]*)?)'s\s+([a-z][\w-]*)[?.!\s]*$/i;
/** The fact lane reads the raw surface, so the ask path's contraction table
 *  never reaches these readers — expand just the interrogative lead
 *  ("who's"/"whos"/"what's"/"whats") so both relation-ask surfaces accept it.
 *  "whose" never matches (the trailing "e" fails the boundary). */
const WHO_WHAT_LEAD_CONTRACTION_RE = /^(who|what)'?s\s+/i;
const expandWhoWhatLead = (q) => String(q).replace(WHO_WHAT_LEAD_CONTRACTION_RE, (full, w) => `${w} is `);
/** The apostrophe-less genitive ("who is petes father") — accepted ONLY when
 *  the stripped possessor is already a term some stored fact names, so a
 *  plain plural or a pronoun ("who is his father") can never be mis-split
 *  into a claimed-then-missed relation ask; this reader's own miss text is
 *  definitive, never a fall-through, so the gate must sit at match time. */
const GENITIVE_WHO_ASK_BARE_RE =
  /^(?:who|what)\s+(?:is|are|was|were)\s+([\w-]{2,}?)s\s+([a-z][\w-]*)[?.!\s]*$/i;
function matchGenitiveWhoAsk(q, isKnownFactTerm = null) {
  const expanded = expandWhoWhatLead(q);
  const g = expanded.match(GENITIVE_WHO_ASK_RE);
  if (g) return [g[0], g[2], g[1]];
  if (!isKnownFactTerm) return null;
  const b = expanded.match(GENITIVE_WHO_ASK_BARE_RE);
  if (!b) return null;
  return isKnownFactTerm(b[1]) ? [b[0], b[2], b[1]] : null;
}

/** "list the descendants of ahab" — the REACHABILITY-SET list query: a
 *  genuine KIND-CHANGE from RELATION_FACT_YESNO_RE just above — every entity
 *  reachable from the named start entity through a taught `recursive` Rule,
 *  not a single yes/no. `m[1]` = the rule's PLURAL name ("descendants",
 *  singularized via singularizeSurface before the findRuleByName lookup —
 *  the same naive plural fold the teach-side surfaces use elsewhere in this
 *  file), `m[2]` = the start entity ("ahab"). Dispatch
 *  lives in factReadBack's own (a0.5) block, below — findRuleByName +
 *  findReachableSet (src/domain/planning.mjs), never a yes/no answer. */
const RECURSIVE_LIST_ASK_RE = /^list\s+(?:the\s+|all\s+)?([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;

/** "is a module a component" — the yes/no vocabulary form the graph grammar
 *  doesn't parse; checked against the isa-family fact predicates only. */
const ISA_ASK_RE = /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+(?:a\s+kind\s+of|a\s+type\s+of|an?)\s+(.+?)[?.!\s]*$/i;
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

/** How far the isa ladder's miss text probes for a chain it can name a
 *  recovery for. Purely a REPORTING reach: the live chases answer within their
 *  own hop bounds and this never widens them, it only tells the miss whether
 *  "/syllogise <term>" would find anything. findIsaChain's own default, since
 *  the probe wants the search's natural reach rather than a second opinion
 *  about how deep is worth walking. */
const DEEP_CHAIN_PROBE_HOPS = 6;

/** "why is TaskController a handler" / "explain how you know TaskController is
 *  a handler" — the syllogise-verified proof render (the isaAsk block below,
 *  which cites the graph inherits-bridge / taught-fact chase / entailed
 *  closure) only ever fired on the bare "is X a Y" yes/no form — a "why"/
 *  "explain how you know" wrapper around the EXACT SAME question hit the bare
 *  wall instead, even though the underlying answer is real and sourced.
 *  Deliberately NOT a new answer path — a pure text rewrite back onto
 *  ISA_ASK_RE's own "is X a Y" shape, mirroring CONFIRM_TAG_RE's own
 *  "rewrite the wrapper away and re-try ISA_ASK_RE" approach just below (and
 *  reused at both this file's ISA_ASK_RE match sites, the memory-only isa
 *  check and the graph-grounded proof-chase). "why is X a Y" already leads
 *  with "is"/"are" (ISA_ASK_RE's own anchor) — only the "why " lead needs
 *  stripping; "explain how you know X is Y" leads with the SUBJECT in plain
 *  declarative order, so it's reordered into "is X a Y" the same way
 *  CONFIRM_TAG_RE reorders its own "X is Y, right?" tag. Returns ISA_ASK_RE's
 *  own match array (or null) — a caller never needs to know which of the two
 *  shapes fired, same discipline as `isaAsk` already applies to CONFIRM_TAG_RE. */
const WHY_ISA_LEAD_RE = /^why\s+(?=(?:is|are)\b)/i;
const EXPLAIN_HOW_YOU_KNOW_RE = /^explain\s+how\s+you\s+know\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
function matchWhyIsa(q) {
  const stripped = String(q || "").replace(WHY_ISA_LEAD_RE, "");
  if (stripped !== q) {
    const m = stripped.match(ISA_ASK_RE);
    if (m) return m;
  }
  const ehyk = String(q || "").match(EXPLAIN_HOW_YOU_KNOW_RE);
  if (ehyk) return `is ${ehyk[1].trim()} a ${ehyk[2].trim()}`.match(ISA_ASK_RE);
  return null;
}

// RELATION_FACT_YESNO_RE/RELATION_WHO_ASK_RE both capture a middle "role" word
// and treat it as an arbitrary user-taught relation/rule NAME — but
// "kind"/"sort"/"type"/"subclass"/"superclass" are this file's OWN vocabulary
// for the ISA/inherits relation, never a name a user could teach a relation
// under, so they must be excluded from that generic reader.
const ISA_IDIOM_ROLE_WORDS = new Set(["kind", "sort", "type", "subclass", "superclass"]);
/** "so john is a man now right?" / "john is a man, right?" — a DECLARATIVE
 *  statement wrapped in a confirmation-check tag ("now right?"/"right?"/
 *  "correct?"), typed after a just-declined teach attempt: the user reasonably
 *  assumes it worked and asks to confirm — but this shape doesn't match ISA_ASK_RE at all (no
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
/** "what do you know about caches" — the open recall-everything form. Also
 *  accepts "what is in your memory about X" / "what's in your memory about X" / "what
 *  do you remember about X" as plain synonyms — none of these collide with an
 *  existing more-specific lane (TOLD_ABOUT_RE only owns "what did i tell you
 *  about X"; WHOLE_RECALL_RE's own "what do you remember" has no "about X"
 *  tail, so it's a disjoint shape). */
const KNOW_ABOUT_RE = /^(?:what\s+do\s+you\s+know\s+about|what(?:'s|s|\s+is)\s+in\s+your\s+memory\s+about|what\s+do\s+you\s+remember\s+about)\s+(.+?)[?.!\s]*$/i;
/** How many facts a single answer lists before the remainder is paged with "more". */
const FACT_ANSWER_CAP = 32;

/** Five sibling readers closing the gap left
 *  by ISA_ASK_RE's own family: forward yes/no and reverse-by-object shapes for
 *  `mgx:capableOf`, `mgx:hasA`, and the ISA-family predicates. None of these
 *  five leads ("can"/"could", "does/do … have", "what can … do", "what has", "what inherit(s)")
 *  overlaps KNOW_ABOUT_RE's fixed leads above, or RELATION_FACT_YESNO_RE/
 *  RELATION_WHO_ASK_RE's required leading "is/are/was/were" (those two live in
 *  the separate factReadBack, only ever reached via `factAnswer(...) ??
 *  factReadBack(...)` — never both). */
const CAN_ASK_RE = /^(?:can|could)\s+(all\s+|every\s+)?(?:an?\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z]+)[?.!\s]*$/i;
const DOES_HAVE_ASK_RE = /^(?:does|do)\s+(?:an?\s+|the\s+)?(.+?)\s+have\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i;
const WHAT_CAN_DO_RE = /^what\s+can\s+(?:an?\s+)?(.+?)\s+do[?.!\s]*$/i;
const WHAT_HAS_RE = /^what\s+has\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
// "what is used for riding" / "what can be used for riding" / "what is for
// riding" — the reverse-by-object mirror of the forward reader ("what is
// a tree used for"): that one only ever filters a KNOWN subject's facts
// down to mgx:usedFor, so without this the reverse question (object known,
// subject unknown) falls all the way through to the code-graph miss cascade
// — actively misleading for a pure vocabulary query.
const WHAT_USED_FOR_RE = /^what\s+(?:(?:can\s+be|is)\s+used\s+for|is\s+for)\s+(.+?)[?.!\s]*$/i;

/** "where is disk-1[ now]" — the bare where question about a TAUGHT individual.
 *  The term capture is lazy so an optional trailing "now" stays out of it; any
 *  other tail ("where is X defined") lands in the capture, finds no locative
 *  fact subject named that, and falls through to the code-graph where lane
 *  unchanged. Consumed by factAnswer's (a-pre4) reader. */
const WHERE_IS_FACT_RE = /^where(?:'s|\s+is|\s+are)\s+(.+?)(?:\s+now)?\s*[?.!]*$/i;
/** The closed locative tail of a folded prepositional-verb predicate
 *  (mgx:rest-on, mgx:stand-on, mgx:sit-in, …) — what makes a taught fact a
 *  LOCATION answer rather than any arbitrary relation. */
const LOCATIVE_FACT_PREDICATE_RE = /^mgx:[a-z]+-(?:on|in|at|inside|under|below|above|near|beside|behind|by)$/;
/** "what is on peg-a" / "what's on peg-a" — the reverse-by-OBJECT mirror of
 *  WHERE_IS_FACT_RE, over the same taught locative facts. The bare copula
 *  carries no verb to mint a predicate from, so the PREPOSITION is the anchor:
 *  it's captured here and matched against the folded predicate's own tail, so
 *  "what is on peg-a" can only ever answer with a fact that really says "on"
 *  (a "-under" row is a different claim, never this question's answer).
 *  Consumed by factAnswer's (a-pre5) reader, which diverts only on a real
 *  stored hit — "what is on the roadmap" finds no such fact and falls through
 *  to the ordinary BARE_WHATIS_RE handling untouched. */
const WHAT_IS_PREP_FACT_RE = new RegExp(`^what(?:'s|\\s+is|\\s+are)\\s+(${PREP_SRC})\\s+(.+?)\\s*[?.!]*$`, "i");

// CAN_ASK_RE's remaining paraphrase-ladder siblings, all over the same
// mgx:capableOf facts:
//  - DO_VERB_ASK_RE: the do-support yes/no ("do birds fly", "does a dog
//    bark") plus its quantified form ("do all birds fly" — answered
//    generically, never universally: the facts are generic, and claiming
//    "all" from them would overclaim). Requires a SINGLE trailing verb
//    word, so it stays disjoint from DOES_HAVE_ASK_RE (" have " in the
//    middle) and the derived FORWARD_YESNO_MARKERS readers (verb phrase
//    + object after it).
//  - WHAT_CAN_VERB_RE: the reverse-by-verb open list ("what can fly") —
//    the capability mirror of WHAT_USED_FOR_RE just above. "be …" tails
//    are excluded (WHAT_USED_FOR_RE's own "what can be used for" lead);
//    "… do" tails belong to WHAT_CAN_DO_RE and are guarded at the call
//    site.
//  - WHICH_KIND_CAN_RE: the kind-restricted form ("which animals can
//    fly") — reverse-by-verb filtered to subjects the memory can tie to
//    the named kind via a direct isa-family fact.
const DO_VERB_ASK_RE = /^(?:do|does)\s+(all\s+|every\s+)?(?:an?\s+|the\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z-]+)[?.!\s]*$/i;
const WHAT_CAN_VERB_RE = /^what\s+can\s+(?!be\s)(.+?)[?.!\s]*$/i;
const WHAT_CANNOT_VERB_RE = /^what\s+(?:cannot|can't|cant|can\s+not)\s+(.+?)[?.!\s]*$/i;
const WHICH_KIND_CAN_RE = /^(?:which|what)\s+([\w'-]+(?:\s+[\w'-]+)*?)\s+can\s+(.+?)[?.!\s]*$/i;

/** The negative surface of a yes/no question asks the SAME question as its
 *  positive twin — "can't a penguin fly" and "can a penguin fly" both want the
 *  polarity of penguin's flight, and a reader that answered them differently
 *  would be disagreeing with itself in one session. So the negation is stripped
 *  here and the ordinary reader answers, carrying whatever polarity the facts
 *  actually hold. A question with no negation in it comes back byte-identical,
 *  so every existing surface reads exactly as it always has.
 *
 *  Applied ONLY inside the capability + general-verb readers, never to `q` at
 *  large: "is a task not an animal" is the retraction lane's copula surface,
 *  and this must never reach it.
 *
 *  Those readers match this surface INSTEAD of the raw question, never as a
 *  fallback after it. A lazy subject slot happily swallows the negation word
 *  itself — "do penguins not fly" binds subject "penguins not" and matches — so
 *  trying the raw question first would take a garbage bind over the good one. */
function positiveQuestionSurface(q) {
  const s = String(q || "")
    .replace(/^(?:can't|cannot|can not|cant)\s+/i, "can ")
    .replace(/^(?:doesn't|does not)\s+/i, "does ")
    .replace(/^(?:don't|do not)\s+/i, "do ")
    .replace(/^(?:didn't|did not)\s+/i, "did ")
    .replace(/\s+(?:not|never)\s+/i, " ");
  return s.replace(/\s+/g, " ").trim();
}
/** A negated surface ("can a dog not bark") is answered by the positive
 *  reader (see positiveQuestionSurface's docblock), but a bare yes/no lead
 *  then reads as agreeing with the asked polarity — drop the lead and let
 *  the cited fact carry the real polarity on its own. */
function withoutPolarityLead(reply) {
  const text = String(reply.text || "").replace(/^(?:yes|no) — /i, "");
  return text === reply.text ? reply : { ...reply, text };
}
const collapsedSurface = (q) => String(q || "").replace(/\s+/g, " ").trim();

/** Cite an isa chain the way (b3b) already cites one — each step as its own
 *  phrase plus verbatim source. Shared so the inherited-capability answers and
 *  the reverse-by-kind listing can never describe the same chain two ways. */
function renderIsaCite(chain, facts) {
  const steps = (chain || []).map((step) => facts.find(
    (f) => f.predicate === step.predicate && f.subject === step.subject && f.object === step.object,
  ));
  if (!steps.length || !steps.every(Boolean)) return null;
  return steps.map((g) => `${factPhrase(g)}${g.provenance ? ` (source: ${g.provenance})` : ""}`).join("; ");
}

/** THE capability answer — every reader that asks "can X do Y" renders through
 *  this one function, over the one resolver. Five readers with five local
 *  polarity filters would drift, and the drift is invisible: each would answer
 *  confidently from one side while a negative it never looked at sat in the
 *  store. "do penguins fly" and "can a penguin fly" must not disagree inside a
 *  single session.
 *
 *  Returns null when the store holds no capability claim about the subject at
 *  either specificity. The caller then keeps its own honest-miss text, and
 *  falls to capabilityBaseRateReply only once that has nothing either: a
 *  subject with capability facts of its own ("a dog can bark") is better
 *  answered by citing them than by reciting what other animals do.
 */
function capabilityReply(subjectText, objectText, facts, { maxHops = 3 } = {}) {
  const subj = factTermVariants(normFactTermStatic, subjectText);
  const obj = factTermVariants(normFactTermStatic, objectText);
  const r = resolveCapabilityPolarity(subj, obj, facts, { maxHops });

  const viaChain = (chain) => {
    const cite = chain && chain.length ? renderIsaCite(chain, facts) : null;
    return cite ? ` — via: ${cite}` : "";
  };

  // both polarities at the same specificity: the disagreement is between the
  // SOURCES, not inside the knowledge, so both are true statements about who
  // said what. Report them and pick nothing.
  if (r.verdict === "both") {
    const lines = [...r.negative, ...r.positive].map(renderFactLine).join("\n");
    return {
      text: `I have both, at the same level of detail — my sources disagree, so I won't pick:\n${lines}`,
      replace: true,
      miss: true,
    };
  }

  if (r.verdict === "yes" || r.verdict === "no") {
    const winner = r.verdict === "no" ? r.negative[0] : r.positive[0];
    let text = `${r.verdict} — ${renderFactLine(winner)}${viaChain(r.chain)}`;
    // a direct fact beat a general default: say WHAT it overrides, or the
    // answer silently contradicts what the same store says about the class
    if (r.overrides) {
      text += `. That overrides what I know about ${r.overrides.fact.subject} generally: ${renderFactLine(r.overrides.fact)}`;
    }
    return { text, replace: true };
  }

  return null;
}

/** Nothing is known about the subject's capability. Report the CLASS it belongs
 *  to and how that class's other kinds split, then STOP — neither yes nor no.
 *  That is the only reading of "birds fly" that survives a penguin.
 *
 *  Two axes, in order: the class base rate, and — when the class yields nothing
 *  either way — the predicate's own extension ("but I do know 3 things that can
 *  fly"). The pivot excludes the class itself: "I don't know if a penguin can
 *  fly, but I know birds can" is circular, not informative.
 *
 *  Returns null unless the subject has a known class. Without one there is no
 *  base rate to report and no reason to believe the subject is a real term at
 *  all — an unresolved "it" belongs to the pronoun lane, not here.
 */
function capabilityBaseRateReply(subjectText, objectText, facts, { maxHops = 3 } = {}) {
  const subj = factTermVariants(normFactTermStatic, subjectText);
  const obj = factTermVariants(normFactTermStatic, objectText);
  const baseRate = capabilityBaseRate(subj, obj, facts, { maxHops });
  if (!baseRate) return null;
  const lead = `${subjectText} is a kind of ${baseRate.klass}`;
  const opener = `I don't know if ${subjectText} can ${objectText}.`;

  if (baseRate.positive.length || baseRate.negative.length) {
    // The split accounts for EVERY kind it counted — three ways, positive,
    // negative and unknown. Say 5 and split only 4 and the arithmetic lies
    // about what the store knows. The count is a fact about the kinds it has
    // seen; "most birds fly" would be a claim about the ones it has not.
    const split = [
      `${baseRate.positive.length} can ${objectText}`,
      `${baseRate.negative.length} cannot`,
      `${baseRate.unknown.length} I have nothing on`,
    ].join(", ");
    const named = [...baseRate.positive, ...baseRate.negative]
      .slice(0, CAPABILITY_REPORT_CAP)
      .map((s) => renderFactLine(s.fact));
    return {
      text: `${opener} ${lead}, and of the ${baseRate.kinds} kind${baseRate.kinds === 1 ? "" : "s"} of ${baseRate.klass} I know, ${split}.\n${named.join("\n")}`,
      replace: true,
      miss: true,
    };
  }

  const extension = capabilityExtension(obj, facts, { exclude: new Set([...subj, baseRate.klass]) });
  if (extension.length) {
    const shown = extension.slice(0, CAPABILITY_REPORT_CAP);
    const rest = extension.slice(shown.length);
    return {
      text: `${opener} ${lead}, and nothing I know about ${baseRate.klass} says whether one can ${objectText}. I do know ${extension.length} thing${extension.length === 1 ? "" : "s"} that can ${objectText}${rest.length ? ` (first ${shown.length} shown)` : ""}:\n${shown.map(renderFactLine).join("\n")}`,
      replace: true,
      miss: true,
      ...(rest.length ? { pending: { items: rest.map(renderFactLine), noun: "facts" } } : {}),
    };
  }

  return {
    text: `${opener} ${lead}, but nothing I remember says whether any kind of ${baseRate.klass} can ${objectText}.`,
    replace: true,
    miss: true,
  };
}

/** SUPERLATIVE over TAUGHT COMPARATIVES — "which disk is smallest" / "what is
 *  the smallest disk" answered from the mgx:<comparative>-than facts the
 *  comparative teach frame mints ("disk-1 is smaller than disk-2"). The
 *  superlative slot is closed by SHAPE, the same discipline as
 *  COMPARATIVE_SRC: an -est word, best/worst, or a most/least + adjective
 *  pair — never a hand-list of adjectives. Entirely fact-side: the
 *  code-graph superlative lane (parseSuperlative's entity-kind metrics) is a
 *  different question over different data and is untouched — this reader
 *  only ever answers when taught comparative pairs for the named kind exist. */
const SUPERLATIVE_WORD_SRC = "(?:most|least)\\s+[a-z][\\w-]*|[a-z][\\w-]*est|best|worst";
const WHICH_KIND_SUPERLATIVE_RE = new RegExp(`^which\\s+([\\w'-]+)\\s+(?:is|are)\\s+(?:the\\s+)?(${SUPERLATIVE_WORD_SRC})[?.!\\s]*$`, "i");
const WHAT_IS_SUPERLATIVE_KIND_RE = new RegExp(`^what(?:'s|s|\\s+is)\\s+the\\s+(${SUPERLATIVE_WORD_SRC})\\s+([\\w'-]+)[?.!\\s]*$`, "i");

/** Map a superlative surface onto the comparative base its taught facts were
 *  minted under: <adj>est → <adj>er (the shared stem keeps a doubled
 *  consonant intact: biggest → bigger), best → better, worst → worse,
 *  "most X" → "more X", "least X" → "less X". Returns null for a word that
 *  only LOOKS superlative ("honest" maps to no comparative anyone teaches —
 *  the resulting predicate simply never has facts). */
function comparativeOfSuperlative(superlative) {
  const s = String(superlative || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (s === "best") return "better";
  if (s === "worst") return "worse";
  const graded = s.match(/^(most|least)\s+([a-z][\w-]*)$/);
  if (graded) return `${graded[1] === "most" ? "more" : "less"} ${graded[2]}`;
  return /[a-z]est$/.test(s) && s.length > 4 ? `${s.slice(0, -3)}er` : null;
}

// The SAME gap as mgx:usedFor above is systemic — "what causes fire", "what is
// made of wood" would otherwise fall through to the same misleading
// code-graph miss. DERIVES a reverse-by-object regex for every
// FACT_PREDICATE_PHRASES entry that's safe to reverse, excluding predicates
// with their own dedicated reader above, and ones too short/broad to safely
// anchor a reverse question (rdf:type/mgx:hasProperty/owl:disjointWith/
// mgx:receivesAction).
const REVERSE_PREDICATE_EXCLUDE = new Set([
  "rdfs:subClassOf", "rdf:type", "mgx:hasA", "mgx:capableOf", "mgx:usedFor",
  "mgx:ownedBy", "owl:disjointWith", "mgx:hasProperty", "mgx:receivesAction",
]);
const REVERSE_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES)
  .filter(([predicate]) => !REVERSE_PREDICATE_EXCLUDE.has(predicate) && !WORLD_PLACEMENT_PREDICATES.has(predicate))
  .map(([predicate, phrase]) => ({
    predicate,
    re: new RegExp(`^what\\s+${escapeRegex(phrase)}\\s+(.+?)[?.!\\s]*$`, "i"),
  }))
  .sort((a, b) => b.re.source.length - a.re.source.length); // longest phrase first

// The FORWARD yes/no mirror of REVERSE_PREDICATE_MARKERS: one derived
// "is/are X <phrase> Y" (copula phrases), "can X be Y" (receivesAction), or
// "does/do X <base-verb> Y" (verb phrases, naive de-3sg fold) reader per
// FACT_PREDICATE_PHRASES entry — so every relation the table can RENDER can
// also be ASKED as a forward yes/no, instead of each one needing its own
// hand-written lane. Excluded: the isa family and hasProperty (ISA_ASK_RE /
// IS_ADJECTIVE_YESNO_RE territory), hasA and capableOf (their dedicated
// readers above carry teach hints these derived ones deliberately don't —
// no derived hint is emitted because no teach phrasing for these relations
// is verified to round-trip).
const FORWARD_YESNO_EXCLUDE = new Set([
  "rdfs:subClassOf", "rdf:type", "owl:disjointWith", "mgx:hasProperty",
  "mgx:hasA", "mgx:capableOf",
  // ownership's dedicated reader (OWNS_YESNO_RE) answers a confident
  // closed-world "no" — a stronger contract than the derived "can't
  // confirm", so the derived reader must never intercept it.
  "mgx:ownedBy",
]);
const FORWARD_YESNO_MARKERS = Object.entries(FACT_PREDICATE_PHRASES)
  .filter(([predicate]) => !FORWARD_YESNO_EXCLUDE.has(predicate) && !WORLD_PLACEMENT_PREDICATES.has(predicate))
  .map(([predicate, phrase]) => {
    let re;
    if (phrase === "can be") {
      re = new RegExp("^can\\s+(?:an?\\s+|the\\s+)?(.+?)\\s+be\\s+(.+?)[?.!\\s]*$", "i");
    } else if (phrase.startsWith("is ")) {
      const rest = escapeRegex(phrase.slice(3));
      re = new RegExp(`^(?:is|are)\\s+(?:an?\\s+|the\\s+)?(.+?)\\s+${rest}\\s+(?:an?\\s+|the\\s+)?(.+?)[?.!\\s]*$`, "i");
    } else {
      const [head, ...tail] = phrase.split(" ");
      const base = [baseVerbSurface(head), ...tail].map(escapeRegex).join("\\s+");
      re = new RegExp(`^(?:does|do)\\s+(?:an?\\s+|the\\s+)?(.+?)\\s+${base}\\s+(?:an?\\s+|the\\s+)?(.+?)[?.!\\s]*$`, "i");
    }
    return { predicate, phrase, re };
  })
  .sort((a, b) => b.re.source.length - a.re.source.length); // longest phrase first
// On the FIRST turn of a graph-less session, `envelope` stays null for the
// whole turn (dispatchTool's loadGraph() throws its own documented empty-graph
// ToolError, self-correcting from turn 2 on), so this regex is the ONLY path
// available — it must match every phrasing ARTICLE_RELATION_CONTINUATIONS'
// grammar-level fix handles when envelope.parsed IS available, not just
// "what inherits (from) X".
const WHAT_INHERITS_RE = /^what\s+(?:inherits?\s+(?:from\s+)?(?:an?\s+)?|is\s+(?:an?\s+)?(?:kind|sort|type)\s+of\s+|is\s+(?:an?\s+)?subclass\s+of\s+)(.+?)[?.!\s]*$/i;
/** WHAT_HAS_RE guard: "what has changed (recently)" reads as a temporal/code
 *  question, not a HasA lookup — checked against the captured phrase's FIRST
 *  word only (a closed set, not a general heuristic). Nothing else answers
 *  this phrasing (it falls to an unrelated code-graph miss), so this is a
 *  pure safety guard, not a behavior change. */
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
 *  or null when memory holds nothing relevant (misses stay unchanged).
 *  Exported so src/surfaces/web/memory-ask-browser-entry.mjs
 *  can re-export it for `tmct viz`'s embedded "Ask the graph" panel — the ONLY
 *  reason this is `export` rather than module-private; the function's own
 *  behavior is unchanged (same signature, same logic, answers identically in
 *  the CLI and the browser bundle). `memoryDir` may be memory/core.mjs's
 *  Backend-B in-memory handle (`createInMemoryStore()`) as well as a real repo
 *  path — every I/O this function does routes through `loadMemory(memoryDir)`
 *  (via factRows/memoryFacts below), and loadMemory's own Backend-B branch
 *  returns the handle's `payload` directly with ZERO fs calls — so a caller
 *  that hands this a handle already carrying the embedded page's full graph
 *  gets a pure, disk-free traversal, no bundle-time module shimming needed.
 *  Every return additionally carries the additive `goal` field when one is
 *  deducible (withDeducedGoal, below) — the ledger page's chat dock renders
 *  it as its own "Goal (inferred)" line; every other consumer reads named
 *  fields and is unaffected. */
export async function factAnswer(memoryDir, query, envelope, miss, biasByBundle = {}, cache = null, focusLabel = null) {
  return withDeducedGoal(await factAnswerReaders(memoryDir, query, envelope, miss, biasByBundle, cache, focusLabel), envelope, query);
}

/** Attach the additive `goal` field to a fact reader's return: the same
 *  table-driven deduction runAsk applies (deduceGoalFromParsed over the parsed
 *  AST, plus the general-verb revision), extended to the bare-question shapes
 *  the readers recognize with no envelope at all — the ledger page's chat dock
 *  calls them with `envelope: null`, so there is no AST to deduce from.
 *  Existing phrasing only, never free text; a goal-less shape passes through
 *  without the field, so the dock (like chat) renders no line for it. */
function withDeducedGoal(res, envelope, query) {
  if (!res || res.goal !== undefined) return res;
  const q = String(query || "").trim();
  let goal = deduceGoalFromParsed(envelope?.parsed);
  if (!goal && res.generalVerbQuery) goal = TAUGHT_FACT_LOOKUP_GOAL;
  if (!goal) {
    const yesNo = q.match(RELATION_FACT_YESNO_RE);
    const whoAsk = yesNo ? null : (expandWhoWhatLead(q).match(RELATION_WHO_ASK_RE) || matchGenitiveWhoAsk(q));
    const role = yesNo ? yesNo[2] : whoAsk ? whoAsk[1] : null;
    if (role && !ISA_IDIOM_ROLE_WORDS.has(role.toLowerCase())) goal = TAUGHT_FACT_LOOKUP_GOAL;
  }
  if (!goal) {
    const whatIs = q.match(BARE_WHATIS_RE);
    if (whatIs) goal = deduceGoalFromParsed({ shape: "meta", object: whatIs[1] });
  }
  return goal ? { ...res, goal } : res;
}

async function factAnswerReaders(memoryDir, query, envelope, miss, biasByBundle = {}, cache = null, focusLabel = null) {
  let normFactTerm; let normFactPredicate;
  try { ({ normFactTerm, normFactPredicate } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const q = String(query).trim();

  // (a-pre) "what is used for riding" / "what can be used for riding" / "what
  // is for riding" — the reverse-by-OBJECT mirror of the forward reader
  // ("what is a tree used for", the (a) block just below). Checked BEFORE (a)
  // deliberately: this phrasing's leading "what is …" ALSO matches (a)'s own
  // BARE_WHATIS_RE, which would otherwise greedily treat "used for riding" as
  // one literal term to define — a guaranteed miss, since no vocabulary term
  // is ever named "used for riding" — and (a) always returns (hit, honest
  // per-relation "no", or null), never falling through to a later reader. Only
  // takes over when it finds a REAL hit; a non-match or zero-hit case falls
  // through unchanged to (a) and beyond, so ordinary miss messaging is
  // untouched. mgx:usedFor instead of mgx:hasA; same filter/rank/render/
  // paginate recipe as (b4)'s WHAT_HAS_RE below.
  const usedForQ = q.match(WHAT_USED_FOR_RE);
  if (usedForQ) {
    const variants = factTermVariants(normFactTerm, usedForQ[1]);
    const hits = (await factRows(memoryDir, cache)).filter((f) => f.predicate === "mgx:usedFor" && variants.has(f.object));
    if (hits.length) {
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
    }
  }

  // (a-pre2) The generic derived cascade for every other reversible predicate
  // (REVERSE_PREDICATE_MARKERS, see its own docblock for the exclusion list
  // and why). Same checked-before-the-meta-lane placement and same
  // only-take-over-on-a-real-hit discipline as (a-pre) just above — a phrase
  // like "is found in"/"is made of" also starts with "what is …", so it must
  // run before (a) can greedily claim the whole tail as a literal term.
  for (const { predicate, re } of REVERSE_PREDICATE_MARKERS) {
    const m = q.match(re);
    if (!m) continue;
    const variants = factTermVariants(normFactTerm, m[1]);
    const hits = (await factRows(memoryDir, cache)).filter((f) => f.predicate === predicate && variants.has(f.object));
    if (!hits.length) continue; // try the next candidate marker, don't give up yet
    const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
    const lines = ranked.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
  }

  // (a-pre3) SUPERLATIVE over TAUGHT COMPARATIVES — "which disk is smallest" /
  // "what is the smallest disk" resolved from mgx:<comparative>-than facts.
  // Checked BEFORE (a) for the same reason as (a-pre)/(a-pre2): the "what is
  // the …" surface would otherwise be swallowed as one literal meta term.
  // Answers ONLY when the taught pairs for the named kind form a single
  // unambiguous total chain; a partial order (two heads nothing compares) or
  // a contradiction loop is an honest can't-order decline that names the gap.
  // No taught pairs at all → falls through untouched, so the code-graph
  // superlative lane and the ordinary miss messaging keep their turns.
  const whichSup = q.match(WHICH_KIND_SUPERLATIVE_RE);
  const whatSup = whichSup ? null : q.match(WHAT_IS_SUPERLATIVE_KIND_RE);
  const supKindRaw = whichSup ? whichSup[1] : whatSup?.[2];
  const supWord = whichSup ? whichSup[2] : whatSup?.[1];
  const supCompBase = supKindRaw && supWord ? comparativeOfSuperlative(supWord) : null;
  if (supCompBase) {
    const supPredicate = `mgx:${supCompBase.replace(/\s+/g, "-")}-than`;
    const rows = await factRows(memoryDir, cache);
    const kindVariants = factTermVariants(normFactTerm, supKindRaw);
    const kindSingular = [...kindVariants].sort((a, b) => a.length - b.length)[0];
    const memberOfKind = (node) => kindVariants.has(node)
      || node.startsWith(`${kindSingular}-`) || node.startsWith(`${kindSingular} `)
      || rows.some((g) => ISA_PREDICATES.has(g.predicate) && g.subject === node && kindVariants.has(g.object));
    const pairs = uniqueFacts(rows.filter((f) => f.predicate === supPredicate && isOperatorTaught(f)))
      .filter((f) => f.subject !== f.object && memberOfKind(f.subject) && memberOfKind(f.object));
    if (pairs.length) {
      const nodes = new Set();
      const inDeg = new Map();
      for (const f of pairs) {
        nodes.add(f.subject); nodes.add(f.object);
        inDeg.set(f.object, (inDeg.get(f.object) || 0) + 1);
        if (!inDeg.has(f.subject)) inDeg.set(f.subject, inDeg.get(f.subject) || 0);
      }
      // A unique topological order IS the single unambiguous total chain:
      // exactly one zero-in-degree node must exist at every step, and each
      // step's winner is then directly compared to the next (a unique order
      // forces the consecutive edge). Two candidates at any step = a pair
      // nothing compares; no candidate = the taught facts loop.
      const remaining = new Map(inDeg);
      const order = [];
      let declined = null;
      while (remaining.size) {
        const sources = [...remaining.keys()].filter((n) => remaining.get(n) === 0);
        if (sources.length !== 1) {
          declined = sources.length === 0
            ? {
              text: `I can't order the ${kindSingular}s — the "${supCompBase} than" facts I have loop back on themselves, so no ${supWord} exists. /memory to inspect them.`,
              replace: true, miss: true,
            }
            : {
              text: `I can't pick the ${supWord} ${kindSingular} from what I know — nothing compares ${sources[0]} and ${sources[1]}. Teach me, e.g. "${sources[0]} is ${supCompBase} than ${sources[1]}".`,
              replace: true, miss: true,
            };
          break;
        }
        const head = sources[0];
        order.push(head);
        remaining.delete(head);
        for (const f of pairs) {
          if (f.subject === head && remaining.has(f.object)) remaining.set(f.object, remaining.get(f.object) - 1);
        }
      }
      if (declined) return declined;
      const steps = order.slice(0, -1).map((n, i) => pairs.find((f) => f.subject === n && f.object === order[i + 1]));
      if (steps.every(Boolean)) {
        const cite = steps.map((g) => `${factPhrase(g)}${g.provenance ? ` (source: ${g.provenance})` : ""}`).join("; ");
        return { text: `${order[0]} — ${cite}; so ${order[0]} is the ${supWord} ${kindSingular}`, replace: true };
      }
    }
  }

  // (a-pre4) "where is disk-1" over TAUGHT LOCATIVE FACTS — the where shape
  // belongs to the code graph (shape=where, "where is X defined"), so a taught
  // individual with a location fact ("disk-1 rests on peg-a") otherwise dies on
  // the "no module matching" miss. Miss-gated AND hit-gated: consulted only
  // after the code lane already missed, and takes over only when a locative
  // fact row for that exact subject exists — a real module answer, and every
  // no-fact miss, is untouched.
  const whereQ = miss ? q.match(WHERE_IS_FACT_RE) : null;
  if (whereQ) {
    const variants = factTermVariants(normFactTerm, whereQ[1]);
    const hits = (await factRows(memoryDir, cache))
      .filter((f) => LOCATIVE_FACT_PREDICATE_RE.test(f.predicate) && variants.has(f.subject));
    if (hits.length) {
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
    }
  }

  // (a-pre5) "what is on peg-a" over the SAME taught locative facts as
  // (a-pre4), asked by OBJECT instead of by subject. The general-verb reverse
  // reader ("what rests on peg-a") can't take this shape: it needs a surface
  // verb to mint a predicate from, and the bare copula has none. So the
  // captured preposition anchors the lookup instead — see
  // WHAT_IS_PREP_FACT_RE. Hit-gated the same way every reader in this cascade
  // is: it returns only when a locative row with that exact preposition and
  // object exists, so a plain vocabulary question keeps its own answer.
  const whatIsPrepQ = q.match(WHAT_IS_PREP_FACT_RE);
  if (whatIsPrepQ) {
    const prep = whatIsPrepQ[1].toLowerCase();
    const variants = factTermVariants(normFactTerm, whatIsPrepQ[2].replace(/^(?:an?|the)\s+/i, "").trim());
    const hits = (await factRows(memoryDir, cache)).filter(
      (f) => LOCATIVE_FACT_PREDICATE_RE.test(f.predicate) && f.predicate.endsWith(`-${prep}`) && variants.has(f.object),
    );
    if (hits.length) {
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
    }
  }

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
  // `envelope` null for the rest of the turn, arming this
  // no-parse-to-defer-to fallback. Without this guard it greedily swallows the
  // WHOLE "kind of animal" tail as a literal meta-term to define (mirroring
  // grammar.mjs T5's OWN ARTICLE_RELATION_CONTINUATIONS guard against the
  // identical over-capture), returning early and never letting (b5) below —
  // which already handles this exact shape via WHAT_INHERITS_RE, envelope or
  // no envelope — get a chance.
  //
  // A parse that MISSED is not a parse to defer to. "what are dogs" is claimed
  // by the composite lane, which declines it ({node:"miss"}, "'dogs' isn't a
  // listable kind") and by existing merely blocked the vocabulary reader that
  // answers the singular. The plural is the whole difference: "what are dog"
  // always worked. A SUCCESSFUL parse still wins here exactly as before — the
  // over-capture this guard exists to stop parses fine, so it never reaches
  // this branch.
  const parsedOwnsIt = envelope?.parsed && envelope.parsed.node !== "miss";
  if (!metaTerm && miss && !parsedOwnsIt && !WHAT_INHERITS_RE.test(q)) {
    const m = q.match(BARE_WHATIS_RE)
      || q.match(/^what\s+(?:does|do)\s+(.+?)\s+means?[?.!\s]*$/i);
    // Strip a curated trailing scope clause ("… in this
    // graph"/"… in this codebase"/…) the same way grammar.mjs's T5 and
    // metaTermOf do — BARE_WHATIS_RE's capture is otherwise the literal glued
    // tail, verbatim.
    if (m) metaTerm = stripTrailingScopeFiller(m[1]);
  }
  // An ambiguous parse tie ({ambiguousParse}) reaches this lane with
  // envelope.parsed nulled and miss=false, so NEITHER branch above arms —
  // but when one tied reading is META and memory holds facts for its term
  // ("what is a test drive": meta "test drive" vs tests "drive"), those
  // facts belong under the disambiguation. Without this, the meta branch's
  // graph-only "isn't a term in this graph's own vocabulary" line is the
  // last word on a term the user has explicitly taught.
  if (!metaTerm && envelope?.ambiguous && Array.isArray(envelope.candidateParses)) {
    const metaCand = envelope.candidateParses.find((c) => c?.shape === "meta" && c.object);
    if (metaCand) metaTerm = stripTrailingScopeFiller(String(metaCand.object));
  }
  if (metaTerm) {
    // "what is a tree used for" parses (grammar.mjs T5) to the
    // WHOLE tail "tree used for" as one literal term — split off a trailing
    // FACT_PREDICATE_PHRASES marker (if any) so the real subject ("tree") is
    // matched against fact subjects, and — the actual bug — the result is
    // FILTERED to just that one predicate (mgx:usedFor) instead of every
    // relation about the subject undifferentiated.
    const split = splitMetaPredicate(metaTerm);
    const { predicate } = split;
    // A leading article survives the T5/BARE_WHATIS capture ("what is the car
    // used for" → "the car") — stripped the same way normFactTerm strips it,
    // so the article never decides whether the subject matches.
    let subject = split.subject.replace(/^(?:the|an?)\s+/i, "").trim() || split.subject;
    // A predicate-shaped ask whose subject is the session anaphor ("what is
    // it used for") resolves against the standing focus, exactly as the
    // IS_ADJECTIVE/ISA yes/no readers resolve theirs. With no focus standing
    // the pronoun is named and declined (the cold-pronoun voice) — never a
    // fact lookup on the literal word "it", and never a teach-offer for it.
    let focusSubstituted = false;
    if (predicate && IS_ADJECTIVE_PRONOUN_RE.test(subject)) {
      if (!focusLabel) {
        const tail = String(FACT_PREDICATE_PHRASES[predicate] || "").replace(/^(?:is|are)\s+/, "");
        return {
          text: `not sure what "${subject.toLowerCase()}" refers to yet — name the subject directly, e.g. "what is a <name>${tail ? ` ${tail}` : ""}".`,
          replace: miss, miss: true, selfContainedMiss: true,
        };
      }
      subject = focusLabel;
      focusSubstituted = true;
    }
    const variants = factTermVariants(normFactTerm, subject);
    // factRows (trust+sourceIds-bearing), not the plain memoryFacts shape — the
    // bias-weighted ranking below needs each hit's sourceIds to resolve which
    // bundle it came from (memory/bias.mjs's biasForRow). A live world's secret
    // and mechanics predicates are dropped so "what is the letter" never reads
    // back where it's hidden or that it's the objective (WORLD_INTERNAL_PREDICATES).
    const subjectHits = (await factRows(memoryDir, cache))
      .filter((f) => variants.has(f.subject) && !WORLD_INTERNAL_PREDICATES.has(f.predicate));
    // Matched through normFactPredicate, so a fact stored under a minted
    // spelling of the same relation ("mgx:used-for", from the participle
    // teach frame, in a store written before the spellings converged) is
    // found by the curated spelling it means.
    let hits = predicate ? subjectHits.filter((f) => normFactPredicate(f.predicate) === predicate) : subjectHits;
    if (!hits.length) {
      // The subject itself is known — as a fact subject, or as the standing
      // focus a pronoun just resolved to — but not under this specific
      // relation: an honest, specific "no" rather than falling through to
      // the generic "isn't a term in this graph's own vocabulary" wall
      // (which would be actively misleading here: the subject IS a known
      // term).
      if (predicate && (subjectHits.length || focusSubstituted)) {
        return {
          text: `I don't have any "${FACT_PREDICATE_PHRASES[predicate]}" facts about ${subject}.`,
          replace: miss,
          ...(subjectHits.length ? {} : { miss: true }),
        };
      }
      // The term names nothing as a fact SUBJECT, but may exist only as the
      // OBJECT of taught relations ("ahab is the father of ishmael" → "what is
      // ishmael"): surface those reverse relations rather than missing, the same
      // facts "what do you know about X" would list.
      if (!predicate) {
        const objectHits = rankByBiasThenTrust((await factRows(memoryDir, cache)).filter((f) => variants.has(f.object)), biasByBundle);
        if (objectHits.length) {
          const objLines = objectHits.map(renderFactLine);
          const objShown = objLines.slice(0, FACT_ANSWER_CAP);
          const objRest = objLines.slice(FACT_ANSWER_CAP);
          const objExtra = objRest.length ? `\n…and ${objRest.length} more — say 'more' to see them.` : "";
          return { text: objShown.join("\n") + objExtra, replace: miss, ...(objRest.length ? { pending: { items: objRest, noun: "facts" } } : {}) };
        }
      }
      return null;
    }
    // Bias only REORDERS — every hit still renders and is cited (Part 6's
    // "disclosed, never dropped" contract). Unconfigured/tied bias degrades to
    // trust-desc, byte-identical to before this feature existed.
    hits = rankByBiasThenTrust(hits, biasByBundle);
    const allRows = await factRows(memoryDir, cache);
    const { lines, grouped } = senseSplitFactList(hits, allRows, variants);
    // A long undifferentiated "what is X" leads with the digest — a bounded
    // narrative over the same facts — and holds the full list behind the escape.
    // It wins over the sense-split grouping here: the digest's own selector
    // filters the mis-sensed branch that grouping would otherwise surface as its
    // own block. Falls back to grouping/flat when the digest is unavailable.
    const digested = (!predicate && lines.length > DIGEST_READBACK_THRESHOLD)
      ? await termDigestReadBack(subject, hits, allRows, lines)
      : null;
    if (digested) return { ...digested, replace: miss };
    if (grouped) return { ...grouped, replace: miss };
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: miss, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
  }
  if (!miss) return null;

  // (b0-comp) "is disk-1 smaller than disk-2" — yes iff the exact taught
  // comparative fact exists; otherwise an honest, specific miss whose teach
  // hint is the EXACT phrasing the comparative teach frame accepts. Never an
  // inverted guess: "disk-1 is smaller than disk-2" proves nothing here
  // about "is disk-2 smaller than disk-1" (the frame stores no
  // antisymmetry), so the reverse question stays a can't-confirm.
  const compAsk = q.match(COMPARATIVE_ASK_RE);
  if (compAsk) {
    const compWord = compAsk[2].toLowerCase().replace(/\s+/g, "-");
    const compPredicate = `mgx:${compWord}-than`;
    const facts = await memoryFacts(memoryDir);
    // Either side may be a context pronoun ("is it bigger than peg-a", "is
    // peg-a bigger than that"), resolved against the standing focus the same
    // way the property and relation lanes below resolve theirs. With no focus
    // to bind to, the pronoun stays literal and the honest can't-confirm below
    // stands — the lane never picks a subject the session hasn't named.
    const compTerm = (raw) => {
      const t = raw.replace(/^(?:an?|the)\s+/i, "").trim();
      return focusLabel && IS_ADJECTIVE_PRONOUN_RE.test(t) ? focusLabel : t;
    };
    const subjTerm = compTerm(compAsk[1]);
    const objTerm = compTerm(compAsk[3]);
    const subj = factTermVariants(normFactTerm, subjTerm);
    const obj = factTermVariants(normFactTerm, objTerm);
    const hit = facts.find((f) => f.predicate === compPredicate && subj.has(f.subject) && obj.has(f.object));
    if (hit) {
      // A comparative is antisymmetric — "X smaller than Y" and "Y smaller
      // than X" can't both hold — so a directly-taught reversal is a real
      // contradiction, just one the /memory summary's own contradiction
      // detector never catches (that one looks for a SHARED subject with
      // two different objects; this is the mirror shape, two facts with
      // subject and object SWAPPED). Recorded, never disclosed before: a
      // flat "yes" gave no hint the opposite was also taught. Surfaced here
      // rather than silently picking a side, the same "both stand, never
      // resolved silently" discipline this file's own /memory contradiction
      // block already follows.
      const reversed = facts.find((f) => f.predicate === compPredicate && subj.has(f.object) && obj.has(f.subject));
      const caveat = reversed
        ? ` — though you also told me the opposite: ${renderFactLine(reversed)}. Both are stored; I won't silently pick one.`
        : "";
      return { text: `yes — ${renderFactLine(hit)}${caveat}`, replace: true };
    }
    const known = facts.filter((f) => f.predicate === compPredicate && (subj.has(f.subject) || subj.has(f.object)));
    const shown = known.length ? ` I do know: ${known.slice(0, 3).map(renderFactLine).join("; ")}.` : "";
    return {
      text: `I can't confirm that — nothing I remember compares them that way.${shown} If it's true, teach me: "${subjTerm} is ${compAsk[2].toLowerCase()} than ${objTerm}".`,
      replace: true,
      miss: true,
    };
  }

  // (b0) Derived forward yes/no readers — FORWARD_YESNO_MARKERS, one per
  // renderable relation. Runs BEFORE the isa lane because ISA_ASK_RE's lazy
  // subject otherwise swallows these shapes whole ("is a wheel part of a
  // car" reads as subject "wheel part of") and ends the cascade. A real fact
  // answers yes; a subject known under the SAME relation gets an honest miss
  // citing those facts; a subject known at all (with no structural parse
  // standing) gets a bare honest miss; anything else leaves the standing
  // miss text alone — so a code-shaped query with a real parse is never
  // hijacked.
  for (const { predicate, phrase, re } of FORWARD_YESNO_MARKERS) {
    const m = q.match(re);
    if (!m) continue;
    const facts = await memoryFacts(memoryDir);
    const subj = factTermVariants(normFactTerm, m[1]);
    const obj = factTermVariants(normFactTerm, m[2]);
    const hit = facts.find((f) => f.predicate === predicate && subj.has(f.subject) && obj.has(f.object));
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    const sameRelation = facts.filter((f) => f.predicate === predicate && subj.has(f.subject));
    if (sameRelation.length) {
      const shown = sameRelation.slice(0, 3).map(renderFactLine).join("; ");
      return {
        text: `I can't confirm that — nothing I remember says ${m[1]} ${phrase} ${m[2]}. I do know: ${shown}.`,
        replace: true,
        miss: true,
      };
    }
    if (!envelope?.parsed && facts.some((f) => subj.has(f.subject))) {
      return {
        text: `I can't confirm that — nothing I remember says ${m[1]} ${phrase} ${m[2]}.`,
        replace: true,
        miss: true,
      };
    }
    break; // shape matched, nothing honest to add — the standing miss stands
  }

  // (b) "is a module a component" — yes iff a remembered isa-family fact says so.
  // Also accepts "why is X a Y" / "explain how you know X is Y" — see matchWhyIsa.
  const isa = q.match(ISA_ASK_RE) || matchWhyIsa(q);
  if (isa) {
    const subj = factTermVariants(normFactTerm, isa[1]);
    const obj = factTermVariants(normFactTerm, isa[2]);
    const isaRows = await factRows(memoryDir, cache);
    const onTerms = (f) => subj.has(f.subject) && obj.has(f.object);
    // A TAUGHT disjointness touching either asked term can flip or veto the
    // verdict — it is the negative side of the polarity when it links the
    // asked terms directly, and a positive whose ⊑-chain crosses one is a
    // stored contradiction, not a yes. That reasoning (and its refusal) lives
    // in the full is-a ladder, so this quick reader stands aside for it
    // rather than answering a yes it hasn't checked.
    const { DISJOINT_PREDICATE } = await import("../domain/syllogise.mjs");
    const touchesAskedTerm = (f) => subj.has(f.subject) || subj.has(f.object) || obj.has(f.subject) || obj.has(f.object);
    if (isaRows.some((f) => f.predicate === DISJOINT_PREDICATE && isOperatorTaught(f) && touchesAskedTerm(f))) {
      return null;
    }
    // A remembered NEGATIVE is read on the same terms as the positive — it
    // carries its own predicate and so never reaches ISA_PREDICATES.
    const reply = isaPolarityReply(
      isaRows.find((f) => ISA_PREDICATES.has(f.predicate) && onTerms(f)),
      isaRows.find((f) => f.predicate === NEG_SUBCLASS_PREDICATE && onTerms(f)),
    );
    return reply; // no remembered fact — null, so the honest miss stands (never a guessed "no")
  }

  // (b2) "can a dog bark" — the polarity of a capability, resolved through the
  // ONE resolver every capability reader in this file shares (see
  // capabilityReply). Mirrors the ISA_ASK_RE block just above on the "never a
  // guessed no" discipline: a "no" here is a REMEMBERED negative, never the
  // absence of a positive.
  const surfacedCan = positiveQuestionSurface(q);
  const can = surfacedCan.match(CAN_ASK_RE);
  if (can) {
    const facts = await factRows(memoryDir, cache);
    const canUniversal = can[1];
    let reply = capabilityReply(can[2], can[3], facts);
    if (reply && surfacedCan !== collapsedSurface(q)) reply = withoutPolarityLead(reply);
    // Quantified ("can all/every X ..."): the stored facts are generic, and a
    // bare "yes" would claim universality the memory can't support — the same
    // hedge the do-support surface applies, echoing the quantifier as typed.
    if (reply && canUniversal) {
      return {
        text: `I can't speak for ${canUniversal.trim()} ${can[2]} — what I remember is generic, not universal. ${reply.text}.`,
        replace: true,
      };
    }
    if (reply) return reply;
    // A KNOWN subject with capability facts, none matching: an honest,
    // specific miss citing what it CAN do — the same closer the is-a ladder
    // answers with, instead of the misleading structural parse wall. An
    // unknown subject still declines. Never a guessed "no": absence of a
    // capableOf fact proves nothing.
    const subj = factTermVariants(normFactTerm, can[2]);
    const knownCan = facts.filter((f) => f.predicate === "mgx:capableOf" && subj.has(f.subject));
    if (knownCan.length) {
      const shown = knownCan.slice(0, 3).map(renderFactLine).join("; ");
      // The teach hint names the subject as the GRAPH stores it (singular),
      // not as the user typed it — 'teach me: "a birds can swim"' is a
      // garbled hint that can't round-trip.
      return {
        text: `I can't confirm that — nothing I remember says ${can[2]} can ${can[3]}. I do know: ${shown}. If it's true, teach me: "a ${knownCan[0].subject} can ${can[3]}".`,
        replace: true,
        miss: true,
      };
    }
    // nothing about the subject at all — report the class base rate, and answer
    // neither yes nor no
    return capabilityBaseRateReply(can[2], can[3], facts);
  }

  // (b2b) "does a dog have a tail" — yes iff a remembered possession fact
  // says so: the forward yes/no mirror of WHAT_HAS_RE below, with the same
  // single-hit lookup and "never a guessed no" discipline as CAN_ASK_RE
  // above. Only diverts on a REAL hit, so a code-shaped "does app.mjs have
  // tests" (no possession fact) keeps whatever miss text already stands.
  // Both possession spellings are read (the corpus mints mgx:hasA, the teach
  // lane tmct:has), and the lookup lifts one taught ⊑-hop so "does rex have
  // fur" answers through "rex is a kind of dog; dog has fur", citing both.
  const doesHave = q.match(DOES_HAVE_ASK_RE);
  if (doesHave) {
    const subj = factTermVariants(normFactTerm, doesHave[1]);
    const obj = factTermVariants(normFactTerm, doesHave[2]);
    const HAS_PREDICATES = new Set(["mgx:hasA", "tmct:has"]);
    const facts = await memoryFacts(memoryDir);
    const hasHit = (subjectSet) => facts.find(
      (f) => HAS_PREDICATES.has(f.predicate) && subjectSet.has(f.subject) && obj.has(f.object),
    );
    const hit = hasHit(subj);
    if (hit) return { text: `yes — ${renderFactLine(hit)}`, replace: true };
    // The ⊑-lift walks a BOUNDED chain (not one hop): "every canine has fur"
    // + "every dog is a canine" + "rex is a dog" answers "does rex have fur"
    // citing all three premises. Cycle-safe, and the bound keeps a deep
    // taught taxonomy from turning a yes/no into a graph scan.
    //
    // Explores EVERY isa-edge from the current frontier at each hop (a proper
    // breadth-first search over the subclass DAG), not just the first one
    // found: a seeded corpus fact ("dog rdfs:subClassOf animal") and a
    // freshly-taught one ("dog rdfs:subClassOf canine") both name "dog" as
    // subject, and taking only whichever came first in `facts` (the seeded
    // one, loaded before any teaching) could walk the wrong branch to a dead
    // end while the real, provable answer sat one hop down the OTHER parent.
    // BFS tries every branch in shortest-chain order, so the first hit found
    // is also the shortest true chain; `liftSeen` is shared across branches
    // (an object that doesn't carry the fact via one path won't via another,
    // since it's the same object either way), which keeps this cycle-safe
    // without cutting off a genuinely parallel second parent.
    let frontier = [{ terms: subj, chain: [] }];
    const liftSeen = new Set();
    for (let hop = 0; hop < 4; hop += 1) {
      const nextFrontier = [];
      for (const { terms, chain } of frontier) {
        const steps = facts.filter((f) => ISA_PREDICATES.has(f.predicate) && terms.has(f.subject) && !liftSeen.has(f.object));
        for (const step of steps) {
          if (liftSeen.has(step.object)) continue;
          liftSeen.add(step.object);
          const nextChain = [...chain, step];
          const lifted = hasHit(factTermVariants(normFactTerm, step.object));
          if (lifted) {
            return { text: `yes — ${[...nextChain.map(renderFactLine), renderFactLine(lifted)].join("; ")}`, replace: true };
          }
          nextFrontier.push({ terms: factTermVariants(normFactTerm, step.object), chain: nextChain });
        }
      }
      if (!nextFrontier.length) break;
      frontier = nextFrontier;
    }
    return null;
  }

  // (b2c) "do birds fly" — the do-support surface of (b2), same capableOf
  // lookup. The quantified form ("do all birds fly") is answered generically
  // and says so: the stored facts are generic, and a bare "yes" would claim
  // universality the memory can't support. NEVER returns null on a non-match
  // (falls through instead): the shape is looser than (b2)'s, so a do-lead
  // question some later reader owns must keep its turn. The can't-confirm
  // branch is additionally miss-gated for the same reason.
  const surfacedDo = positiveQuestionSurface(q);
  const doAsk = surfacedDo.match(DO_VERB_ASK_RE);
  if (doAsk) {
    const facts = await factRows(memoryDir, cache);
    const universal = !!doAsk[1];
    const subj = factTermVariants(normFactTerm, doAsk[2]);
    const obj = factTermVariants(normFactTerm, doAsk[3]);
    // the SAME resolver (b2) answers through, so "do penguins fly" and "can a
    // penguin fly" can never disagree in one session
    let reply = capabilityReply(doAsk[2], doAsk[3], facts);
    if (reply && surfacedDo !== collapsedSurface(q)) reply = withoutPolarityLead(reply);
    if (reply && universal) {
      // Echo the quantifier as typed ("every dog", "all dogs") — "all dog"
      // for a singular every-question is a garbled echo.
      return {
        text: `I can't speak for ${doAsk[1].trim()} ${doAsk[2]} — what I remember is generic, not universal. ${reply.text}.`,
        replace: true,
      };
    }
    if (reply) return reply;
    if (miss) {
      const knownCan = facts.filter((f) => f.predicate === "mgx:capableOf" && subj.has(f.subject));
      if (knownCan.length) {
        const shown = knownCan.slice(0, 3).map(renderFactLine).join("; ");
        return {
          text: `I can't confirm that — nothing I remember says ${doAsk[2]} can ${doAsk[3]}. I do know: ${shown}. If it's true, teach me: "a ${knownCan[0].subject} can ${doAsk[3]}".`,
          replace: true,
          miss: true,
        };
      }
      const base = capabilityBaseRateReply(doAsk[2], doAsk[3], facts);
      if (base) return base;
      // A subject NO fact row mentions on either side has nothing to answer
      // from at all — without this the turn fell through to the
      // conversational catch-all, which answered a question about penguins
      // with the identity blurb. Decline by name, with the round-trip teach
      // hint, and stay a miss. SINGLE-WORD subjects only: a multi-word
      // capture here is this loose shape misbinding a subject+verb ("does
      // margo eat ribs" reads [margo eat][ribs]), and a later reader owns
      // that sentence — the same keep-its-turn rule as the fall-through above.
      if (!/\s/.test(doAsk[2].trim()) && !facts.some((f) => subj.has(f.subject) || subj.has(f.object))) {
        const noun = singularizeSurface(teachableSubjectOf(doAsk[2]));
        return {
          text: `I can't confirm that — I don't know anything about "${doAsk[2]}" yet. Teach me "a ${noun} can ${doAsk[3]}" (or "a ${noun} cannot ${doAsk[3]}") and I'll remember it.`,
          replace: true,
          miss: true,
        };
      }
    }
  }

  // (b3) "what can a dog do" — every remembered mgx:capableOf fact for the
  // subject, open-list. Reuses the meta-lane's subject-hits/rank/render/
  // paginate recipe (lane (a) above) verbatim, with the predicate hardcoded.
  const canDo = q.match(WHAT_CAN_DO_RE);
  if (canDo) {
    const variants = factTermVariants(normFactTerm, canDo[1]);
    // BOTH polarities. Filtering to the positive would silently omit what the
    // store explicitly says the subject CANNOT do, which reads as "I don't
    // know" for something it knows outright. renderFactLine spells the polarity
    // ("a penguin cannot fly"), so the two never blur together in the list.
    const hits = (await factRows(memoryDir, cache))
      .filter((f) => (f.predicate === "mgx:capableOf" || f.predicate === NEG_CAPABLE_OF_PREDICATE) && variants.has(f.subject));
    if (!hits.length) return null;
    const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
    const lines = ranked.map(renderFactLine);
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
    return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
  }

  // (b3b) "which animals can fly" — reverse-by-verb over mgx:capableOf,
  // restricted to subjects an isa-family chain ties to the named kind within
  // a bounded hop budget (findIsaChain, the same rooted proof search the
  // is-a ladder's live chase uses; maxHops matches its enlarged-tree budget),
  // so "every sparrow is a bird" + "bird is a kind of animal" surfaces
  // sparrow under "which animals…". A chain longer than one hop is cited on
  // the answer line. When capable subjects exist but NONE provably belongs
  // to the kind, the answer says so and still lists them — honest about the
  // missing link instead of a silent empty. Only takes over on real
  // capability hits; otherwise falls through (never returns null: "which X
  // can Y" phrasings this reader doesn't own must keep their turn).
  const whichCan = q.match(WHICH_KIND_CAN_RE);
  if (whichCan) {
    const kindVariants = factTermVariants(normFactTerm, whichCan[1]);
    const verbVariants = factTermVariants(normFactTerm, whichCan[2]);
    const facts = await factRows(memoryDir, cache);
    // A subject the store explicitly says CANNOT do this is not an answer to
    // "which birds can fly", even when a corpus row also says it can: the
    // direct negative is the more specific claim, and listing penguin here
    // while "can a penguin fly" answers "no" would be the same session
    // contradicting itself. The resolver decides, so the two agree by
    // construction.
    const capable = uniqueFacts(facts.filter((f) => f.predicate === "mgx:capableOf" && verbVariants.has(f.object)))
      .filter((f) => resolveCapabilityPolarity(new Set([f.subject]), verbVariants, facts).verdict === "yes");
    if (capable.length) {
      const { findIsaChain, SUBCLASS_PREDICATE: SC_PRED, TYPE_PREDICATE: TYPE_PRED } = await import("../domain/syllogise.mjs");
      const subClassRows = facts.filter((f) => f.predicate === SC_PRED);
      const typeRows = facts.filter((f) => f.predicate === TYPE_PRED);
      const subClassEdges = subClassRows.map((f) => [f.subject, f.object]);
      const typeEdges = typeRows.map((f) => [f.subject, f.object]);
      const rowForStep = (step) => (step.predicate === SC_PRED ? subClassRows : typeRows)
        .find((g) => g.subject === step.subject && g.object === step.object);
      const chainBySubject = new Map();
      const inKind = capable.filter((f) => {
        if (kindVariants.has(f.subject)) return true;
        if (!chainBySubject.has(f.subject)) {
          chainBySubject.set(f.subject, findIsaChain(f.subject, kindVariants, typeEdges, subClassEdges, { maxHops: 3 }));
        }
        return !!chainBySubject.get(f.subject);
      });
      const ranked = rankByBiasThenTrust(inKind.length ? inKind : capable, biasByBundle);
      const lines = ranked.map((f) => {
        const chain = inKind.length ? chainBySubject.get(f.subject) : null;
        if (!chain || chain.length < 2) return renderFactLine(f);
        const steps = chain.map(rowForStep);
        if (!steps.every(Boolean)) return renderFactLine(f);
        const cite = steps.map((g) => `${factPhrase(g)}${g.provenance ? ` (source: ${g.provenance})` : ""}`).join("; ");
        return `${renderFactLine(f)} — via: ${cite}`;
      });
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
      const preamble = inKind.length ? "" : `nothing I remember ties these to "${whichCan[1]}", but:\n`;
      return { text: preamble + shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
    }
  }

  // (b3c-neg) "what cannot fly" — the negative twin of (b3c): every stored
  // mgxneg:capableOf fact whose OBJECT matches. A matched shape with NO
  // stored negatives returns a definitive memory miss rather than falling
  // through — the conversational catch-all downstream misread this surface
  // as small talk and answered with the identity card.
  const cannotVerb = q.match(WHAT_CANNOT_VERB_RE);
  if (cannotVerb && cannotVerb[1].trim().split(/\s+/).at(-1)?.toLowerCase() !== "do") {
    const negVariants = factTermVariants(normFactTerm, cannotVerb[1]);
    const negHits = (await factRows(memoryDir, cache)).filter(
      (f) => f.predicate === "mgxneg:capableOf" && negVariants.has(f.object),
    );
    if (negHits.length) {
      const ranked = rankByBiasThenTrust(uniqueFacts(negHits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
    }
    return { text: `nothing I remember says anything cannot ${cannotVerb[1].trim()}.`, replace: true, miss: true };
  }

  // (b3c) "what can fly" — the unrestricted reverse-by-verb sibling of (b3b):
  // every capableOf fact whose OBJECT matches. The "… do" tail is (b3)'s
  // shape, guarded out so a zero-hit "what can a cat do" never gets misread
  // here as a hunt for the capability "a cat do". Same fall-through
  // discipline as (b3b).
  const canVerb = q.match(WHAT_CAN_VERB_RE);
  if (canVerb && canVerb[1].trim().split(/\s+/).at(-1)?.toLowerCase() !== "do") {
    const verbVariants = factTermVariants(normFactTerm, canVerb[1]);
    // same polarity discipline as (b3b): a subject with a direct negative is
    // not an answer to "what can fly"
    const hits = capabilityExtension(verbVariants, await factRows(memoryDir, cache));
    if (hits.length) {
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
    }
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
    const hits = (await factRows(memoryDir, cache)).filter((f) => f.predicate === "mgx:hasA" && variants.has(f.object));
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
  // "what is a kind of X" / "what is a subclass of X" (e.g. "boney is a dog"
  // -> "what is a dog" -> "what is a kind of animal" must not hit a wrong "I
  // don't know a relation or rule called 'kind'" answer). Resolving the
  // parse-level {ambiguousParse} tie between this and a
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
    const hits = (await factRows(memoryDir, cache)).filter((f) => ISA_PREDICATES.has(f.predicate) && variants.has(f.object));
    // Only diverts on a REAL hit — same discipline every other reader in this
    // cascade follows (CAN_ASK_RE/WHAT_CAN_DO_RE/WHAT_HAS_RE above all `return
    // null` on zero hits too). A zero-hit case here must NOT invent its own
    // override text: whatever answer already stands (a code-graph-specific miss
    // from ask.mjs's own traversal, a glossary/relation-force explanation, or the
    // generic wall) is left alone. The real fix for the "I don't know a relation
    // or rule called 'kind' yet" false claim lives at
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
    const rows = await factRows(memoryDir, cache);
    // A cycle-safe BFS DOWNWARD over isa-family facts from the term's own
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
    // Head-word fallback: a taught fact's subject is often a real NOUN PHRASE
    // ("logger module"), shortened in a natural follow-up ("...about the
    // logger") to an exact-variant miss. Tried only when the exact/subtype
    // pass found NOTHING, on a whole word (length >= 4, avoiding a short
    // staccato word hijacking an unrelated fact).
    if (!hits.length) {
      const queryWords = normFactTerm(know[1]).split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_ENTITY_WORDS.has(w));
      if (queryWords.length) {
        const wordsOf = (s) => new Set(String(s || "").split(/\s+/));
        const overlaps = (term) => { const w = wordsOf(term); return queryWords.some((qw) => w.has(qw)); };
        hits = rows.filter((f) => overlaps(f.subject) || overlaps(f.object));
      }
    }
    // A live adventure world's mechanics never leak through the describe lane:
    // "what is the letter" must not read back where it's hidden or that it's the
    // objective, and those datatype internals render as garbled non-English
    // besides. The adventure's own where/openness readers answer the legitimate
    // in-game questions from the world fold.
    hits = hits.filter((f) => !WORLD_INTERNAL_PREDICATES.has(f.predicate));
    // A genuinely empty result here is a real miss: "what do you know about
    // the last commit" needs a TEACH-OFFER, not a bare wall — added as a LATE
    // runTurn-level addition, below, alongside the sibling "what is X" offer,
    // rather than returned from here: an early return through this
    // function's normal contract would pre-empt runTurn's own
    // wall-shortening pass (shortMissHint/lane 5), leaving the FULL
    // unshortened grammar cheat-sheet standing under the offer instead of
    // the nicer tailored one-liner.
    if (!hits.length) return null;
    // LIVE CONSISTENCY CHECK: before answering from this subject's memory, check whether its OWN
    // taught/entailed types contradict each other (x rdf:type C1, x rdf:type
    // C2, C1 owl:disjointWith C2, lifted through both types' ⊑-ancestor
    // closures) via syllogise.mjs's findConsistencyViolations, LIVE and
    // READ-ONLY — same discipline as the cax-dw chase in the isaAsk block
    // above. A hit REFUSES the whole answer (every belief about a
    // contradictory subject is suspect, not just the clashing pair) rather
    // than silently answering from a memory that's already inconsistent.
    const { findConsistencyViolations, TYPE_PREDICATE: CONS_TYPE_PREDICATE, SUBCLASS_PREDICATE: CONS_SC_PREDICATE, DISJOINT_PREDICATE: CONS_DISJOINT_PREDICATE } = await import("../domain/syllogise.mjs");
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
    const header = `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}`
      + `${viaSubtype ? " (including its known subtypes)" : ""}:`;
    const { lines, grouped } = senseSplitFactList(hits, rows, variants, { indent: "  " });
    if (grouped) return { ...grouped, text: `${header}\n${grouped.text}` };
    const shown = lines.slice(0, FACT_ANSWER_CAP);
    const rest = lines.slice(FACT_ANSWER_CAP);
    const extra = rest.length ? `\n  …and ${rest.length} more — say 'more' to see them.` : "";
    return { text: `${header}\n${shown.join("\n")}${extra}`, replace: true, ...(rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {}) };
  }
  return null;
}

// ---- "what else is X" must not repeat the SAME primary definition sentence
// verbatim, byte-identical to a plain "what is X" turn right before it: ask()'s
// own relaxation cascade silently drops the unmatched "else" and re-parses as
// an ordinary "what is a function" meta shape. whatElseAnswer is recognized
// FIRST, off the RAW query text, so it always gets first look. ----

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
const WHAT_ELSE_ABOUT_RE = /^(?:what|anything)\s+else\s+(?:do\s+you\s+know\s+)?about\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i;
/** "what else can dogs do" — the capability spelling of the same beyond-the-
 *  primary-answer question; the subject's remaining facts (capabilities
 *  included) are the expansion it asks for. */
const WHAT_ELSE_CAN_DO_RE = /^what\s+else\s+can\s+(?:an?\s+|the\s+)?(.+?)\s+do[?.!\s]*$/i;
/** The same question with its subject left implicit — "what else", "anything
 *  else", "what else do you know". A reader who has just been told about dogs
 *  and asks "what else" means "what else about dogs"; the subject is carried by
 *  the conversation, exactly as the pronoun in "can it bark" is. So the term
 *  comes from the standing referent (vocabAntecedentFrom) and this shape is a
 *  no-op when nothing is standing. */
const WHAT_ELSE_BARE_RE = /^(?:(?:and|so|but|ok|okay|now|then)\s+)*(?:what\s+else(?:\s+do\s+you\s+know)?|anything\s+else(?:\s+you\s+know)?|got\s+anything\s+else)[?.!\s]*$/i;

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
  const m = q.match(WHAT_ELSE_IS_RE) || q.match(WHAT_ELSE_ABOUT_RE) || q.match(WHAT_ELSE_CAN_DO_RE);
  // A bare "what else" takes its subject from the standing referent — the same
  // last-grounded-answer binding "can it bark" uses.
  const bare = !m && WHAT_ELSE_BARE_RE.test(q);
  const term = (m ? m[1] : (bare ? vocabAntecedentFrom(last) : null) || "").trim();
  // Asked cold, it names what it cannot resolve rather than introducing the
  // tool — the same courtesy a cold pronoun already gets. An identity blurb
  // answers a question nobody asked.
  if (!term) {
    return bare
      ? { text: "Nothing to add yet — there's no subject standing. Ask me about something first, then \"what else\".", replace: true, miss: true }
      : null;
  }
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
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

/** A LAST-
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
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
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
/** "does every <N1> have at least <m> <N2>" — cardinality monotonicity: a
 *  class's OWN declared exactly/min cardinality restriction proves "at least
 *  m" for any queried m <= n (src/domain/syllogise.mjs's proveCardinalityAtLeast). */
const CARD_AT_LEAST_ASK_RE = /^does\s+every\s+(.+?)\s+have\s+at\s+least\s+(\d+)\s+(.+?)[?.!\s]*$/i;
/** "does a/an <N1> have a/an <N2>" — a declared max-cardinality-0 restriction
 *  proves the class-level "no" directly
 *  (src/domain/syllogise.mjs's proveMaxCardinalityZeroDenial). Both readers FALL
 *  THROUGH ON A MISS (no unconditional decline, unlike isaAsk's own closing
 *  `return null`): "does SUBJ have OBJ" is broad enough to otherwise collide
 *  with GENERAL_VERB_YESNO_RE below and a few unclear max0 cases — a miss
 *  here simply lets the query continue to whatever would otherwise handle it. */
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
 *  SAME mgx:ownedBy facts WHO_OWNS_RE reads. The bare
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
/** "does/did <N1> have a/an <N2> method" — the HAS-A-METHOD yes/no reader,
 *  sibling of OWNS_YESNO_RE above: mirrors
 *  TEACH_HAS_METHOD_RE's own subject/capability shape, answering a direct
 *  yes/no claim against a fact taught via that pattern (mgx:hasA, object
 *  `"<capability> method"`).
 *
 *  NOTE — a real, pre-existing structural collision: ask.mjs's OWN
 *  structural grammar already maps "has"/"have" onto the code-graph
 *  "defines" relation (ask-vocab.mjs's VERB_TO_KIND), so when a real code
 *  graph is loaded this EXACT phrasing is parsed there FIRST — and because "a
 *  <word> method" is separately ambiguous with a QUALIFIER reading there ("a
 *  public method"), ask.mjs resolves with its own (possibly confusing)
 *  disambiguation choice, `miss: false`, before this reader (factReadBack,
 *  gated on `miss` already being true) ever gets a turn: with a populated
 *  code graph, "does Component have a render method" always lands on
 *  ask.mjs's disambiguation prompt, regardless of subject/object identity or
 *  any taught fact; with NO code graph loaded (this project's other
 *  supported mode — a purely conceptual teach-and-recall session) ask.mjs's
 *  structural attempt declines outright and this reader answers correctly.
 *  Changing ask.mjs's own qualifier-disambiguation behavior is a
 *  pre-existing, unrelated structural-grammar concern.
 *
 *  Same "never a guessed no" discipline as IS_ADJECTIVE_YESNO_RE/
 *  GENERAL_VERB_YESNO_RE below (not OWNS_YESNO_RE's closed-world "no" text):
 *  a hit answers "yes"; no matching fact DECLINES (null), since "nothing
 *  taught yet" is not proof the class genuinely lacks the method. */
const HAS_METHOD_YESNO_RE = /^(?:does|did)\s+([\w'-]+)\s+(?:has|have)\s+an?\s+([a-z][\w-]*)\s+method[?.!\s]*$/i;
/** "what methods does <N1> have" — the HAS-A-METHOD open-list reader: the
 *  read-back companion to HAS_METHOD_YESNO_RE just above — lists every taught
 *  mgx:hasA fact for <N1> whose object is a "<word> method" phrase. A
 *  distinct query shape (object noun right after "what", not after the
 *  subject), so it does NOT share HAS_METHOD_YESNO_RE's own ask.mjs
 *  collision: "what methods does X have" already reaches an honest `miss:
 *  true` from ask.mjs even against a populated code graph ("no module
 *  matching X found in the index" when X isn't a real graph entity), so this
 *  reader is reachable in both configurations. */
const HAS_METHOD_OPEN_RE = /^what\s+methods\s+does\s+([\w'-]+)\s+have[?.!\s]*$/i;
/** "is/are/was/were <X> <adjective>" — a yes/no claim over a taught
 *  mgx:hasProperty fact. Deliberately has NO marker
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
/** A backtracked subject that is really a cross-turn temporal comparison —
 *  a bindable form followed by a comparison word ("that before chat.mjs
 *  was", from "was that before chat.mjs was touched"). The comparison lane
 *  owns the closed-participle family; a cousin with a participle outside
 *  that set still lands here, and offering to teach a fact about "that
 *  before chat.mjs was" is a category error, so the property readers
 *  decline it the way they decline a personal-pronoun subject. */
const BINDABLE_COMPARISON_SUBJECT_RE = /^(?:it|this|that)(?:\s+one)?\s+(?:before|after)\b/i;
/** IS_ADJECTIVE_YESNO_RE's
 *  subject capture is unbounded/unrestricted (see its own docblock above), so
 *  a pronoun-subject IDENTITY question ("are you happy", "are you like
 *  chatgpt", "are you secretly ChatGPT or GPT-4") backtracks the pronoun
 *  itself (plus any trailing filler word up to the last token) into the
 *  SUBJECT capture — factReadBack then treats "you"/"you like"/"you secretly
 *  chatgpt or" as a literal fact subject and offers to teach a fact ABOUT the
 *  pronoun ("remember that you is happy"), exactly the grammatical category
 *  error TEACH_PRONOUN_WRAPPED_RE/TEACH_PRONOUN_BARE_RE (above) were already
 *  built to reject on the teach-lane side. Same pronoun set (you|i|they|he|
 *  she|we) reused here, checked at the START of the subject capture only
 *  (not anchored to the whole capture — a pronoun subject can carry trailing
 *  words, "you like"/"you secretly … or", the same class of category error
 *  those two regexes reject on the teach-lane side). "it" is deliberately
 *  EXCLUDED from this set, unlike TEACH_PRONOUN_WRAPPED_RE/
 *  TEACH_PRONOUN_BARE_RE — IS_ADJECTIVE_PRONOUN_RE (just above) already gives "it"
 *  its own correct, wanted behavior (anaphoric resolution against the
 *  session's current FOCUS, "is it deprecated" → resolves off focusLabel),
 *  which this guard must not shadow. Every call site below is expected to
 *  test rawSubject (post-trim, pre-lowercasing) against this BEFORE treating
 *  the match as a fact-subject candidate, and to fall through (never offer
 *  unknownAdjectiveOffer, never attempt a fact lookup) on a hit — the same
 *  "decline, don't misroute" discipline the rest of this reader already
 *  follows for an honest miss, letting the query continue to whatever
 *  handles identity/small-talk questions (isConversational's IDENTITY_PHRASES/
 *  AI_IDENTITY_PHRASES/FEELINGS_PHRASES closed sets, or its own ≤3-word
 *  catch-all) instead. */
const IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE = /^(?:you|i|they|he|she|we)\b/i;
/** The TEACH-OFFER for a subject IS_ADJECTIVE_YESNO_RE resolved but has no
 *  fact about at all — the offered "remember that
 *  X is Y" phrasing is verified in-state: TEACH_PROPERTY_RE's own subject
 *  capture is unbounded multi-word with no lexicon gate on the complement, so
 *  this always actually stores, unlike the bare unwrapped form (which only
 *  reaches TEACH_PROPERTY_RE via BARE_DECLARATIVE_RE's single-token-subject
 *  restriction and would fail here). */
const unknownAdjectiveOffer = (subject, adjective) => ({
  text: `I don't know anything about "${subject}" yet — teach me directly, e.g. "remember that ${teachableSubjectOf(subject)} is ${adjective}".`,
  replace: true,
});
/** WHOLE-STORE recall: "what did i tell you [last time]",
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

/** ASSERT-RECALL MULTI-TURN READ-BACK: once "every X is a Y" is asserted in
 *  an earlier turn, a later turn may query it back across turns in shapes
 *  the graph grammar can't parse — so each would die as an honest miss even
 *  though "X is a kind of Y" is
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
 *  subject-side answer or a schema hit. Returns { text, replace:true } or null,
 *  plus factAnswer's same additive `goal` field when one is deducible
 *  (withDeducedGoal). */
export async function factReadBack(memoryDir, query, envelope, miss, graph = null, focusLabel = null, biasByBundle = {}, cache = null) {
  return withDeducedGoal(await factReadBackReaders(memoryDir, query, envelope, miss, graph, focusLabel, biasByBundle, cache), envelope, query);
}

async function factReadBackReaders(memoryDir, query, envelope, miss, graph = null, focusLabel = null, biasByBundle = {}, cache = null) {
  if (!miss) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const q = String(query).trim();
  // DIRECT STRUCTURAL CHECK: "is X a Y"
  // naming a real code-graph inheritance edge needs NO taught fact at all — the
  // graph's own `inherits` relation already proves it. Checked here, BEFORE the
  // `rows.length` bail-out just below, because a pristine graph with ZERO taught
  // facts returns null from that bail-out and never reaches ISA_ASK_RE's own
  // taught-fact-only checks further down in this function at all: without this,
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
        // CONVERSE NUDGE, code-graph half: the taught-fact lane already names
        // a stored converse instead of the bare wall; the graph's inherits
        // relation deserves the same. Still a miss — the converse holding
        // says nothing about the asked direction, and a "no" would guess.
        const objEnt = await resolveEntity(graph, stripTrailingDiscourseTag(directIsaAsk[2]));
        if (objEnt && inheritsChain(graph, objEnt.id).some((sup) => sup.id === ent.id)) {
          return {
            text: `I can't confirm that — the code graph's stored direction runs the other way: ${objEnt.label} inherits ${ent.label}. An inheritance doesn't reverse.`,
            replace: true, miss: true,
          };
        }
      }
    }
  }
  // A leading hedge adverb ("actually"/"really"/"honestly", optionally
  // comma'd) would otherwise put a sentence like "actually is the store
  // module fragile" one word out of alignment with
  // IS_ADJECTIVE_YESNO_RE/OWNS_YESNO_RE/OWNS_PASSIVE_YESNO_RE's own anchored
  // "is|are|was|were|does|did" openers, so it's scoped narrowly to just them
  // (qHedge), not the older ISA_ASK_RE/WHO_OWNS_RE paths above, which already
  // work without it and don't need the extra risk of a behavior change. Full
  // leading-connective tolerance (and/also/so/…) is STACCATO_LEAKED_CONNECTIVES'
  // own separate, broader territory elsewhere in this file — this is a
  // narrower, adjacent closed set (hedge adverbs, not coordinators).
  // "yeah nah" — the same AU/NZ discourse opener chat.mjs's own GREET closed
  // set and GREETING_PREAMBLE_RE already recognize elsewhere, added here too
  // for the same one-word-out-of-alignment reason as the hedge adverbs above.
  const qHedge = q.replace(/^(?:actually|really|honestly|yeah\s+nah)\s*,?\s+/i, "");
  const rows = await factRows(memoryDir, cache);
  if (!rows.length) {
    // With TRULY zero facts remembered yet (a fresh session, nothing taught
    // at all), the early bail-out below would otherwise skip even
    // IS_ADJECTIVE_YESNO_RE's own "subject completely unknown" TEACH-OFFER
    // further down in this function — "is the checkout flow deprecated" as
    // someone's genuinely FIRST question would then fall to the raw
    // structural wall, unguided. Special-cased here (ahead
    // of the general empty-memory bail-out every other lane in this function
    // still relies on) rather than removing the bail-out outright.
    //
    // IS_ADJECTIVE_YESNO_RE's own backtracking (no vocabulary restriction on
    // either capture) also syntactically matches shapes that are NOT a
    // property claim at all — "is a zebra a mammal" (ISA_ASK_RE's own
    // territory) and "is there anything bigger" (a staccato-comparative shape
    // a LATER lane owns and answers better). Both are excluded explicitly: a
    // leading "there" is existential, never a real named subject a property
    // claim would name. RELATION_FACT_YESNO_RE gets the SAME exclusion for the
    // SAME reason.
    if (!ISA_ASK_RE.test(qHedge) && !RELATION_FACT_YESNO_RE.test(qHedge)) {
      const emptyIsAdj = qHedge.match(IS_ADJECTIVE_YESNO_RE);
      if (emptyIsAdj) {
        const rawSubject = emptyIsAdj[1].trim();
        const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? (focusLabel || null) : rawSubject;
        // "is logger tested"/"is the store module tested" —
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
        // Pronoun-subject guard — see IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE's own docblock
        // above IS_ADJECTIVE_YESNO_RE: "are you happy"/"are you like chatgpt"
        // backtrack a pronoun subject in here exactly like any other adjective
        // subject, so without this check unknownAdjectiveOffer would wrongly
        // offer to teach a fact about the literal pronoun. Checked on rawSubject
        // (before the IS_ADJECTIVE_PRONOUN_RE focus-resolution swap above, which
        // only ever fires for "it"/"this"/"that" — never a personal pronoun like
        // "you", so `subject` itself would already carry the pronoun verbatim).
        if (subject && !/^there\b/i.test(subject) && !envelope?.parsed
          && !IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE.test(rawSubject)
          && !BINDABLE_COMPARISON_SUBJECT_RE.test(rawSubject)
          && !PLACE_ADVERB_OBJECT_RE.test(emptyIsAdj[2].trim())) {
          return unknownAdjectiveOffer(subject, emptyIsAdj[2].trim().toLowerCase());
        }
      }
    }
    // An isa-shaped FIRST turn on a pristine store falls THROUGH to the isa
    // reader below rather than taking the empty-store bail-out: that reader's
    // body tolerates rows=[] end-to-end (every derived array is empty) and
    // lands on the specific "I don't know X at all yet — teach me" closer, so
    // the very first "is X a Y" no longer hits the generic grammar wall just
    // because nothing has been taught yet. The graph inherits-bridge above
    // already answers the code-entity direct/converse cases before this point.
    // A leading "there" subject is existential ("is there a class called X"),
    // which ISA_ASK_RE also matches but a LATER existence lane owns and answers
    // better — it keeps the bail-out, mirroring this block's own emptyIsAdj
    // "there" exclusion above. Every OTHER empty-store shape keeps the bail-out.
    const fallThroughIsa = qHedge.match(ISA_ASK_RE) || matchWhyIsa(q);
    if (!((fallThroughIsa && !/^there\b/i.test(fallThroughIsa[1].trim())) || CONFIRM_TAG_RE.test(q))) return null;
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

  // (d) WHOLE-STORE recall — "what did i tell you last time",
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
  // were <X> the/a/an <role> of <Y>", all dispatched from ONE recognizer,
  // tried BEFORE ISA_ASK_RE gets a chance at this shape — see
  // RELATION_FACT_YESNO_RE's own docblock for why placement, not regex
  // disjointness, keeps this ahead of ISA_ASK_RE. The actual dispatch lives
  // in resolveRelationChase, below (a recursive closure, not four
  // independent branches):
  //   (i)  DIRECT — a fact already taught under the queried role word exactly
  //        ("is ahab the father of john" against a literal mgx:father fact).
  //   (ii) ALIAS CHASE — the SAME candidate list, widened: any fact
  //        connecting this exact (subject, object) pair whose OWN role word
  //        reaches the queried name via a TAUGHT rdfs:subClassOf chain over
  //        relation-NAME strings (findIsaChain, reused completely unmodified,
  //        maxHops:2, corpus-excluded — the identical isTaught discipline the
  //        cax-sco/scm-sco class-term proof chase below already uses, just
  //        walked over relation names instead of class names).
  //   (iii) COMPOSE2 RULE CHASE — the queried name may itself
  //        be an already-taught Rule (findRuleByName), not a plain relation at
  //        all: a hop-counted findActionPath search over { entity, hopsTaken }
  //        states, dispatching base1's edges at hop 0 and base2's edges at hop
  //        1, requiring EXACTLY hopsTaken === 2 at the goal — never just
  //        entity === target at any depth (the load-bearing nuance: a
  //        coincidental 1-hop or 3-hop path through the SAME edge relation
  //        must NOT falsely satisfy a rule that must be exactly 2 hops).
  //   (iv) FILTER RULE CHASE — the queried name may be a
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
      const aliasTrees = buildAliasSubClassTrees(rows);
      const { findIsaChain: chaseAlias } = await import("../domain/syllogise.mjs");
      // Shared alias-chase substrate (item 2): every stored Fact whose
      // predicate resolves — directly, or via a taught (or, failing that,
      // general-knowledge) rdfs:subClassOf chain over relation-NAME strings
      // — to `name`. Reused for BOTH the direct/alias yes-no readback just
      // below AND the compose2 hop-search's per-hop edge lookup further
      // down, so the two never disagree on what "a fact under relation X"
      // means.
      const relationFactsFor = (name) => {
        const target = String(name || "").trim().toLowerCase();
        const out = [];
        for (const f of rows) {
          const role = relationRoleWord(f.predicate);
          if (!role) continue;
          if (role === target) { out.push({ fact: f, aliasFacts: [] }); continue; }
          const chain = chaseAliasEitherTree(chaseAlias, role, new Set([target]), aliasTrees, { maxHops: 2 });
          if (!chain) continue;
          const aliasFacts = chain.map((step) => rows.find(
            (r) => r.predicate === SUBCLASS_PREDICATE && r.subject === step.subject && r.object === step.object,
          ));
          if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
        }
        return out;
      };
      // Generic relation-NAME resolver, made explicitly RECURSIVE so a Rule's
      // own base can be EITHER a plain taught relation (terminal — steps
      // i/ii, direct fact or alias chase) OR ANOTHER Rule (compose2's
      // hop-counted chase, step iii; filter's own base-then-property chase,
      // step iv). Returns `{ citation: string[] }` on a
      // genuine hit, or null on an honest miss — never a guessed "no", the
      // same OWA discipline every other yes/no reader in this function
      // follows. Recursion is naturally bounded: a filter rule's
      // base is always either a plain relation (case a, terminal) or
      // another rule (case b, one dispatch level deeper) — FILTER_RULE_TEACH_RE
      // never lets a rule name its OWN name as its own base, so no cycle
      // guard is needed at THIS dispatch level (the search kernels
      // underneath — findActionPath — carry their own `seen`-set safety
      // regardless).
      // Extracted to memory/core.mjs so cross-group inference can reuse this
      // SAME resolution logic outside chat.mjs's dispatch context.
      // `relationFactsFor`/`renderFactLine`/`factPhrase`/`factTermVariants`/
      // `byTrust`/`rows`/`HAS_PROPERTY_PREDICATE` are this block's own local
      // closures/constants, threaded through explicitly.
      const { loadMemory, findRuleByName, resolveRelationChase } = await import("../adapters/memory/core.mjs");
      const { findActionPath } = await import("../domain/planning.mjs");
      const memory = await loadMemory(memoryDir);
      const relationChaseHelpers = { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE, findActionPath };
      const hit = await resolveRelationChase(memory, relationName, subject, object, relationChaseHelpers);
      if (hit) return { text: `yes — ${hit.citation.join("; ")}`, replace: true };
      // A bare `return null` on any miss here would be wrong — the
      // SHAPE was already recognized (subject/relation/object all parsed
      // successfully), so it would fall all the way through
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

  // (a0.2) RELATION "WHO" REVERSE ASK — "who is the/a/an <relation> of <Y>":
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
  const whoAsk = expandWhoWhatLead(qHedge).match(RELATION_WHO_ASK_RE) || matchGenitiveWhoAsk(qHedge, (base) => {
    const known = factTermVariants(normFactTerm, base);
    return rows.some((f) => known.has(f.subject) || known.has(f.object));
  });
  if (whoAsk) {
    const relationName = whoAsk[1].trim().toLowerCase();
    const rawObject = whoAsk[2].trim();
    const object = IS_ADJECTIVE_PRONOUN_RE.test(rawObject) ? (focusLabel || null) : rawObject;
    if (object && !ISA_IDIOM_ROLE_WORDS.has(relationName)) {
      const aliasTreesWho = buildAliasSubClassTrees(rows);
      const { findIsaChain: chaseAliasWho } = await import("../domain/syllogise.mjs");
      // Same candidate-list shape as (a0)'s own relationFactsFor — every
      // stored Fact whose predicate resolves, directly or via a taught (or
      // general-knowledge) rdfs:subClassOf chain over relation-NAME
      // strings, to `name`.
      const relationFactsForWho = (name) => {
        const target = String(name || "").trim().toLowerCase();
        const out = [];
        for (const f of rows) {
          const role = relationRoleWord(f.predicate);
          if (!role) continue;
          if (role === target) { out.push({ fact: f, aliasFacts: [] }); continue; }
          const chain = chaseAliasEitherTree(chaseAliasWho, role, new Set([target]), aliasTreesWho, { maxHops: 2 });
          if (!chain) continue;
          const aliasFacts = chain.map((step) => rows.find(
            (r) => r.predicate === SUBCLASS_PREDICATE && r.subject === step.subject && r.object === step.object,
          ));
          if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
        }
        return out;
      };
      const { loadMemory: loadMemWho, findRuleByName: findRuleByNameWho, resolveRelationChaseReverse } = await import("../adapters/memory/core.mjs");
      const memoryWho = await loadMemWho(memoryDir);
      // Generic REVERSE relation-NAME resolver — the mirror image of (a0)'s
      // resolveRelationChase: given a relation/rule name and a FIXED OBJECT,
      // return every { subject, citation } pair that satisfies it, instead of
      // a single yes/no for a fixed (subject, object) pair. Recursion is
      // bounded the SAME way (a0)'s own chase is: a filter rule's base
      // is always either a plain relation (terminal) or another rule (one
      // level deeper), never itself.
      // Extracted to memory/core.mjs alongside (a0)'s own resolveRelationChase;
      // `relationFactsForWho`/`renderFactLine`/`factPhrase`/
      // `factTermVariants`/`byTrust`/`rows`/`HAS_PROPERTY_PREDICATE` are this
      // block's own local closures/constants, threaded through explicitly.
      const { findReachableSet } = await import("../domain/planning.mjs");
      const relationChaseHelpersWho = { relationFactsFor: relationFactsForWho, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE, findReachableSet };
      const hits = await resolveRelationChaseReverse(memoryWho, relationName, object, relationChaseHelpersWho);
      if (hits.length) {
        const lines = hits.map((h) => `${h.subject} — ${h.citation.join("; ")}`);
        return { text: lines.join("\n"), replace: true };
      }
      // The SAME two-case honest-miss discipline, mirrored for the reverse
      // shape: is the relation/rule name known at all, or known but empty for
      // this particular object?
      const nameKnownWho = relationFactsForWho(relationName).length > 0
        || !!findRuleByNameWho(memoryWho, relationName);
      if (!nameKnownWho) {
        return { text: `I don't know a relation or rule called '${relationName}' yet.`, replace: true };
      }
      // "what is the capital of france" reads
      // oddly as "I don't know ANYONE who is the capital…" — the neutral
      // "nothing/anyone" split below matches whichever interrogative word the
      // query actually used.
      const isWhatAsk = /^what\b/i.test(expandWhoWhatLead(qHedge));
      return {
        text: isWhatAsk
          ? `I don't know what the ${relationName} of ${object} is from what you've told me.`
          : `I don't know anyone who is the ${relationName} of ${object} from what you've told me.`,
        replace: true,
      };
    }
  }

  // Bare "who is/was <name>" with no relational "of Y" tail or genitive (those
  // are the whoAsk reader's above) — surface every taught fact naming the
  // person, whether as the subject or only as a relation OBJECT ("ahab is the
  // father of ishmael" → "who is ishmael"). A name with no stored fact falls
  // through unchanged.
  {
    const whoBare = qHedge.match(WHO_IS_BARE_RE);
    if (whoBare) {
      const nameVariants = factTermVariants(normFactTerm, whoBare[1]);
      const hits = rankByBiasThenTrust(rows.filter((f) => nameVariants.has(f.subject) || nameVariants.has(f.object)), biasByBundle);
      if (hits.length) {
        const lines = hits.map(renderFactLine);
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `\n…and ${rest.length} more — say 'more' to see them.` : "";
        return { text: shown.join("\n") + extra, replace: true, ...(rest.length ? { pending: { items: rest, noun: "facts" } } : {}) };
      }
    }
  }

  // (a0.5) RECURSIVE-RULE REACHABILITY LIST — "list the <plural> of <X>": a
  // genuine KIND-CHANGE from the yes/no dispatcher just above — REACHABILITY-SET
  // enumeration (every node ever reached), not single-target search.
  // Dispatches to a `recursive`-kind taught Rule via the SAME "what kind of
  // thing is this name" lookup (findRuleByName) the yes/no dispatcher uses,
  // then calls findReachableSet (src/domain/planning.mjs) seeded from baseCase's taught edges for
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
      } = await import("../adapters/memory/core.mjs");
      const memory = await loadMemory(memoryDir);
      const rule = findRuleByName(memory, ruleName);
      const ruleKind = rule?.attributes?.find((a) => a.prop === ruleKindProp)?.value;
      if (rule && ruleKind === recKind) {
        const baseCase = rule.attributes.find((a) => a.prop === "mgx:ruleBaseCase")?.value;
        const recStep = rule.attributes.find((a) => a.prop === "mgx:ruleRecStep")?.value;
        const startEntity = normFactTerm(subject);
        if (baseCase && recStep && startEntity) {
          const aliasTreesList = buildAliasSubClassTrees(rows);
          const { findIsaChain: chaseAlias } = await import("../domain/syllogise.mjs");
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
              const chain = chaseAliasEitherTree(chaseAlias, role, new Set([target]), aliasTreesList, { maxHops: 2 });
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
          const { findReachableSet } = await import("../domain/planning.mjs");
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
  // "why is X a Y" / "explain how you know X is Y" reach the SAME
  // sourced/verified proof chase below via matchWhyIsa's rewrite — see its
  // own docblock.
  const isaAsk = q.match(ISA_ASK_RE) || matchWhyIsa(q)
    || (confirmTag && `is ${confirmTag[1].trim()} a ${confirmTag[2].trim()}`.match(ISA_ASK_RE));
  if (isaAsk) {
    // "is TaskController a validator then" — a trailing bare discourse tag
    // also glues onto ISA_ASK_RE's captured kind term (its own
    // trailing anchor only allows punctuation/whitespace, not a stray word), so
    // "validator then" never matched any taught fact even though the CLASS↔
    // INSTANCE BRIDGE below would otherwise answer yes. Same stripTrailingDiscourseTag
    // fix, applied here too.
    const objVariants = factTermVariants(normFactTerm, stripTrailingDiscourseTag(isaAsk[2]));
    // "is that an animal" — the subject slot takes a context pronoun like every
    // other reader in this file, resolved against the session's standing focus
    // through IS_ADJECTIVE_PRONOUN_RE (the same set/swap the property, relation
    // and ownership lanes above already use). With no focus standing, the
    // pronoun stays literal and the lane keeps its existing decline — the miss
    // below reads it as a pronoun and suppresses the "I don't know it at all"
    // wording, which is still the right answer with nothing to bind to.
    const isaSubject = focusLabel && IS_ADJECTIVE_PRONOUN_RE.test(isaAsk[1].trim())
      ? focusLabel : isaAsk[1];
    const subjCandidates = new Set(factTermVariants(normFactTerm, isaSubject));
    // REFLEXIVE subsumption — "is a dog a dog" holds by definition (⊑ is
    // reflexive, whatever the term); without this it fell to the can't-confirm
    // closer, which then offered to be taught "dog is a kind of dog".
    if ([...subjCandidates].some((s) => objVariants.has(s))) {
      const kindEcho = stripTrailingDiscourseTag(isaAsk[2]).trim();
      return {
        text: `yes — ${indefiniteArticleFor(kindEcho)} ${kindEcho} is ${indefiniteArticleFor(kindEcho)} ${kindEcho}, trivially: every kind is a kind of itself.`,
        replace: true,
      };
    }
    const noun = await entityClassNoun(graph, isaSubject);
    if (noun) for (const v of factTermVariants(normFactTerm, noun)) subjCandidates.add(v);
    const {
      findIsaChain, deriveDisjointViolations,
      SUBCLASS_PREDICATE: SC_PREDICATE, TYPE_PREDICATE: RDF_TYPE_PREDICATE, DISJOINT_PREDICATE,
    } = await import("../domain/syllogise.mjs");
    const isTaught = isOperatorTaught;
    const chainSubClassRows = isa.filter((f) => f.predicate === SC_PREDICATE && isTaught(f));
    const chainTypeRows = isa.filter((f) => f.predicate === RDF_TYPE_PREDICATE && isTaught(f));
    const chainSubClassEdges = chainSubClassRows.map((f) => [f.subject, f.object]);
    const chainTypeEdges = chainTypeRows.map((f) => [f.subject, f.object]);
    const mixedSubClassRows = isa.filter((f) => f.predicate === SC_PREDICATE);
    const mixedTypeRows = isa.filter((f) => f.predicate === RDF_TYPE_PREDICATE);
    const mixedTypeEdges = mixedTypeRows.map((f) => [f.subject, f.object]);
    const mixedSubClassEdges = mixedSubClassRows.map((f) => [f.subject, f.object]);
    const disjointRows = rows.filter((f) => f.predicate === DISJOINT_PREDICATE && isTaught(f));
    const disjointEdges = disjointRows.map((f) => [f.subject, f.object]);
    // CAX-DW GATE, COMPUTED BEFORE ANY "YES" MAY RETURN: every taught
    // disjointness is lifted through the full ⊑-closure (subclass edges double
    // as type edges here, because an instance teach like "rex is a dog" stores
    // rdfs:subClassOf) and held against the asked conclusion. A "yes" whose
    // resolved chain crosses one of these would certify a stored
    // contradiction, so the gate runs ahead of the direct-fact verdict and
    // both proof chases below — never after them, where it can only lose.
    const disjointGateViolations = disjointRows.length
      ? deriveDisjointViolations(
        mixedTypeEdges.concat(mixedSubClassEdges), mixedSubClassEdges, disjointEdges,
        { budget: 20, focus: new Set([...subjCandidates, ...objVariants]) },
      )
      : [];
    const disjointRefusalFor = (subj) => {
      const v = disjointGateViolations.find((vv) => vv.subject === subj && objVariants.has(vv.object));
      if (!v) return null;
      const posFact = isa
        .filter((f) => objVariants.has(f.object) && (f.subject === v.viaClass || f.subject === v.subject))
        .sort(byTrust)[0];
      const disjointFact = disjointRows.find((f) => (f.subject === v.viaClass && f.object === v.object)
        || (f.subject === v.object && f.object === v.viaClass));
      if (!posFact || !disjointFact) return null;
      return isaInconsistencyRefusal(posFact, disjointFact);
    };
    const hit = isa
      .filter((f) => subjCandidates.has(f.subject) && objVariants.has(f.object))
      .sort(byTrust)[0];
    // A STORED NEGATIVE ("john is not a man") is a source disagreeing, so it is
    // read on the same terms as the positive rather than losing to it by
    // default. It carries its own predicate and so never reaches `isa`. A
    // taught disjointness directly between the asked terms is the same
    // disagreement in owl:disjointWith spelling, so it reads as the negative
    // side on the same terms — ahead of every yes-chase, not after them.
    const negHit = rows
      .filter((f) => f.predicate === NEG_SUBCLASS_PREDICATE && subjCandidates.has(f.subject) && objVariants.has(f.object))
      .sort(byTrust)[0];
    const directDisjoint = disjointRows.find((f) => (subjCandidates.has(f.subject) && objVariants.has(f.object))
      || (subjCandidates.has(f.object) && objVariants.has(f.subject)));
    if (hit && !negHit) {
      const chainRefusal = disjointRefusalFor(hit.subject);
      if (chainRefusal) return chainRefusal;
    }
    const polarityReply = isaPolarityReply(hit, negHit || directDisjoint);
    if (polarityReply) return polarityReply;
    // DISJOINTNESS ACROSS BOTH CHAINS: nothing above found a stored fact of
    // either polarity, but "no" can still be PROVEN when the subject's own
    // ⊑-chain and the query OBJECT's own ⊑-chain land on two disjoint
    // classes — "is a cat a dog" after "every cat is a feline" / "every dog
    // is a canine" / "no feline is a canine" is exactly this: cat⊑feline,
    // dog⊑canine, and feline disjointWith canine together prove cat can
    // never be a dog. disjointGateViolations (above) already lifts the
    // SUBJECT side through its ⊑-ancestor closure, but its {subject, object}
    // pairs name only the DIRECT disjoint partner class ("canine") — never a
    // further descendant of it ("dog"). Lifting the query OBJECT through its
    // own ⊑-ancestor closure (the same closure kernel, run the other way)
    // and checking it against every violation's `object` field closes that
    // gap, the same "walk both chains" discipline the subject side already
    // had.
    if (disjointRows.length) {
      // A plain BFS over mixedSubClassEdges, not deriveSubClassClosure: that
      // kernel returns only NEWLY-derived (indirect) edges, never a directly-
      // stated one, so a single taught hop ("dog is a canine") would never
      // surface through it alone — an ancestry closure needs every hop,
      // direct or derived. Shared by the object's own ancestry (below) and
      // the self-contradiction guard just after it.
      const ancestryOf = (seed) => {
        const closure = new Set(seed);
        let frontier = new Set(seed);
        for (let hop = 0; hop < 8 && frontier.size; hop += 1) {
          const next = new Set();
          for (const [a, b] of mixedSubClassEdges) {
            if (frontier.has(a) && !closure.has(b)) next.add(b);
          }
          if (!next.size) break;
          for (const t of next) closure.add(t);
          frontier = next;
        }
        return closure;
      };
      const objectAncestry = ancestryOf(objVariants);
      // SELF-CONTRADICTION GUARD: reject a violation whose own `viaClass` is
      // ALSO a stated ancestor of its disjoint partner `object` ("no dog is a
      // cat" taught alongside "every dog is a cat" — dog is both ⊑cat and
      // disjointWith cat, a contradiction independent of anything being
      // asked). Deriving a confident "no" from a self-contradictory premise
      // pair would be the same overclaim isaInconsistencyRefusal exists to
      // stop; the honest answer there is "these taught facts disagree",
      // which the existing multi-hop chase + refusal below already gives —
      // this guard just keeps THIS reader from preempting it with a "no" a
      // clean, non-contradictory pair (the intended case) never needs.
      const objViolation = disjointGateViolations.find((vv) => subjCandidates.has(vv.subject) && objectAncestry.has(vv.object)
        && !ancestryOf([vv.viaClass]).has(vv.object) && !ancestryOf([vv.object]).has(vv.viaClass));
      if (objViolation) {
        const posFact = isa.filter((f) => subjCandidates.has(f.subject) && f.object === objViolation.viaClass).sort(byTrust)[0];
        const disjointFact = disjointRows.find((f) => (f.subject === objViolation.viaClass && f.object === objViolation.object)
          || (f.subject === objViolation.object && f.object === objViolation.viaClass));
        // The object side only needs its own citation when the violation's
        // object ISN'T already a literal query-object variant (i.e. a real
        // lift happened, "dog" reached via "canine") — a direct match (no
        // lift) needs no extra premise, the disjoint fact alone connects
        // subject and object.
        const objectNeedsLift = !objVariants.has(objViolation.object);
        const objFact = objectNeedsLift
          ? isa.filter((f) => objVariants.has(f.subject) && f.object === objViolation.object).sort(byTrust)[0]
          : null;
        if (posFact && disjointFact && (!objectNeedsLift || objFact)) {
          const kindEcho = stripTrailingDiscourseTag(isaAsk[2]).trim();
          const chain = [posFact, ...(objFact ? [objFact] : [])].map(renderFactLine).join("; ");
          return {
            text: `no — ${chain}; and ${factPhrase(disjointFact)}${disjointFact.provenance ? ` (source: ${disjointFact.provenance})` : ""} `
              + `— so ${isaSubject} can never be ${indefiniteArticleFor(kindEcho)} ${kindEcho}.`,
            replace: true,
          };
        }
      }
    }
    // CLASS↔INSTANCE BRIDGE: when X resolves to a graph entity, its
    // inherits chain's superclass LABELS are subject candidates too — a taught
    // "controller ⊑ handler" composes with a graph "TaskController inherits
    // Controller" so "is TaskController a handler" answers yes, naming BOTH
    // sources (the graph edge + the taught fact with its provenance).
    const ent = await resolveEntity(graph, isaSubject);
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
    // LIVE cax-sco / scm-sco PROOF CHASE: a direct isa fact and the graph
    // inherits-bridge both missed — chase a chain over TWO TAUGHT isa-family
    // facts via syllogise.mjs's findIsaChain, a rooted proof search built on
    // the SAME two rule kernels, LIVE and READ-ONLY (nothing is written — the
    // offline `tmct syllogise` batch pass, materializing the same two rules
    // with `entailed:*` provenance, is the persisting counterpart).
    // Deliberately narrow, twice over, so as not to silently answer bands
    // this stage doesn't (yet) certify:
    //   - maxHops:2 — a longer taught chain is multi-hop +
    //     proof-chain-materialization territory, which is pinned as an
    //     honest ceiling until it lands — answering
    //     "yes" there today would be FABRICATION, not credit.
    //   - CORPUS-sourced edges excluded — the bulk background corpus band
    //     (trust 0.7) can coincidentally chain two unrelated classes into a
    //     technically-true-per-ConceptNet "yes" that has nothing to do with
    //     what the OPERATOR taught; only operator/teach/entailed-sourced isa
    //     facts are chased, matching "TAUGHT" in the gap's own name.
    const factForStep = (step) => (step.predicate === SC_PREDICATE ? chainSubClassRows : chainTypeRows)
      .find((f) => f.subject === step.subject && f.object === step.object);
    for (const subj of subjCandidates) {
      const chain = findIsaChain(subj, objVariants, chainTypeEdges, chainSubClassEdges, { maxHops: 2 });
      if (!chain) continue;
      const chainRefusal = disjointRefusalFor(subj);
      if (chainRefusal) return chainRefusal;
      const premises = chain.map(factForStep);
      if (premises.every(Boolean)) return { text: `yes — ${renderIsaChain(premises)}`, replace: true };
    }
    // MIXED-SOURCE EXTENSION of the chase above. The taught-only filter
    // exists to stop PURE-ConceptNet coincidence chains, but it also blocked
    // the everyday case where the operator anchors a term onto a corpus
    // class ("every poodle is a dog") and asks up through the corpus's own
    // hierarchy ("is a poodle an animal"). Corpus isa facts already answer
    // the 1-hop direct question on their own, so letting them JOIN a chain
    // that contains AT LEAST ONE operator-taught premise adds no fabrication
    // surface — a chain of ONLY corpus edges still never answers here, and
    // every premise is cited with its own source, corpus ones included. The
    // shared taught-only rows above stay untouched: the disjoint and
    // someValuesFrom chases keep their original, narrower discipline.
    const mixedFactForStep = (step) => (step.predicate === SC_PREDICATE ? mixedSubClassRows : mixedTypeRows)
      .find((f) => f.subject === step.subject && f.object === step.object);
    for (const subj of subjCandidates) {
      const chain = findIsaChain(subj, objVariants, mixedTypeEdges, mixedSubClassEdges, { maxHops: 2 });
      if (!chain) continue;
      const chainRefusal = disjointRefusalFor(subj);
      if (chainRefusal) return chainRefusal;
      const premises = chain.map(mixedFactForStep);
      if (premises.every(Boolean) && premises.some(isTaught)) {
        return { text: `yes — ${renderIsaChain(premises)}`, replace: true };
      }
    }
    // LIVE cax-dw PROOF CHASE: every "yes" strategy above missed — check whether X's taught type
    // (lifted through its FULL ⊑-ancestor closure) is disjointWith the
    // queried class, via syllogise.mjs's deriveDisjointViolations, LIVE and
    // READ-ONLY (same discipline as the findIsaChain chase just above:
    // nothing is written; syllogise()'s materializing batch pass is the
    // persisting counterpart of this same rule, never on the chat hot path).
    // A hit here is a PROVABLE "no" — the one shape on this ladder allowed to
    // answer "no" from absence-of-membership rather than decline; anything
    // this chase can't connect through a stated disjointness falls through
    // to the honest miss below, never a guessed "no".
    // NEGATED membership — "is a dog not a cat". ISA_ASK_RE captures the
    // subject as "dog not" (the "not" glues onto the subject because the
    // article anchors the kind), so without this the negated question walks
    // the positive ladder with a garbage subject and lands on a nonsense
    // teach hint. Strip the "not", then answer INVERTED: a positive isa fact
    // refutes it ("no — dog is a kind of cat"), a taught disjointness
    // confirms it ("yes — dog is not a cat"), anything else is an honest
    // can't-confirm pointing at the already-supported "no X is a Y" teach
    // shape. Deliberately shallow — no chain chases on the negated side; a
    // negative proved through a multi-hop positive chain stays an honest
    // miss rather than a guess.
    // The pronoun swap above can't see this shape — the trailing "not" rides
    // inside the subject capture ("is that not a cat"), so the bare subject
    // resolves against the focus here instead, on the same terms.
    const negSubjectMatch = isaSubject.match(/^(.*\S)\s+not$/i);
    const negSubject = negSubjectMatch && [
      negSubjectMatch[0],
      focusLabel && IS_ADJECTIVE_PRONOUN_RE.test(negSubjectMatch[1].trim()) ? focusLabel : negSubjectMatch[1],
    ];
    if (negSubject) {
      const negSubjVariants = factTermVariants(normFactTerm, negSubject[1]);
      const negObjVariants = objVariants;
      const posHit = isa
        .filter((f) => negSubjVariants.has(f.subject) && negObjVariants.has(f.object))
        .sort(byTrust)[0];
      if (posHit) return { text: `no — ${renderFactLine(posHit)}`, replace: true };
      const negDisjoint = disjointRows.find((f) => (negSubjVariants.has(f.subject) && negObjVariants.has(f.object))
        || (negSubjVariants.has(f.object) && negObjVariants.has(f.subject)));
      if (negDisjoint) return { text: `yes — ${renderFactLine(negDisjoint)}`, replace: true };
      const negSubjectWord = negSubject[1].trim();
      const negKindWord = stripTrailingDiscourseTag(isaAsk[2]).trim();
      return {
        text: `I can't confirm that either way — nothing I remember links ${negSubjectWord} and ${negKindWord}. If no ${negSubjectWord} is a ${negKindWord}, teach me: "no ${negSubjectWord} is a ${negKindWord}".`,
        replace: true,
        miss: true,
      };
    }
    if (disjointRows.length) {
      // Taught subclass edges double as type edges here, because an instance
      // teach ("felix is a cat") stores rdfs:subClassOf — without the fold the
      // instance form of the provable "no" never fired.
      const violations = deriveDisjointViolations(
        chainTypeEdges.concat(chainSubClassEdges), chainSubClassEdges, disjointEdges, { budget: 10 },
      );
      for (const subj of subjCandidates) {
        const v = violations.find((vv) => vv.subject === subj && objVariants.has(vv.object));
        if (!v) continue;
        const typeFact = chainTypeRows.concat(chainSubClassRows).find((f) => f.subject === v.subject && f.object === v.viaType);
        const disjointFact = disjointRows.find((f) => (f.subject === v.viaClass && f.object === v.object)
          || (f.subject === v.object && f.object === v.viaClass));
        const parts = [typeFact, disjointFact].filter(Boolean).map(renderFactLine);
        return { text: `no — ${parts.length ? parts.join("; ") : `${v.viaClass} and ${v.object} are disjoint.`}`, replace: true };
      }
    }
    // LIVE cls-svf1 PROOF CHASE: every strategy above
    // missed — check whether X, having taught-P'd something of a taught type
    // (lifted through that type's FULL ⊑-ancestor closure), satisfies a
    // TAUGHT someValuesFrom restriction declared over that SAME (property,
    // type) pair — the restriction CLASS itself entailed (OWL 2 RL Table 6's
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
    } = await import("../domain/syllogise.mjs");
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
      // LIVE scm-svf1 PROOF CHASE (W3C OWL 2 RL Table 9's scm-svf1 — distinct
      // from scm-svf2, which needs rdfs:subPropertyOf, which the ACE grammar
      // can't teach at all — see src/domain/syllogise.mjs's own header comment): every
      // strategy above missed — two INDEPENDENTLY taught someValuesFrom
      // restrictions sharing the SAME property, whose filler classes are
      // themselves ⊑-related, license a restriction-to-restriction ⊑ fact
      // (deriveSomeValuesFromSubsumption). Reuses the SAME restrictionEdges
      // just built for cls-svf1 above — a SEPARATE findIsaChain call
      // (maxHops: 3, one hop of headroom over the earlier chase's maxHops: 2)
      // rather than folding into that earlier call, so its pinned behavior
      // is untouched.
      const svfSubsumption = restrictionEdges.length > 1
        ? deriveSomeValuesFromSubsumption(restrictionEdges, chainSubClassEdges, { budget: 10 })
        : [];
      if (svfSubsumption.length) {
        const enlargedSubClassEdges = chainSubClassEdges.concat(svfSubsumption.map((d) => [d.subject, d.object]));
        // The SAME `min(premiseTrusts) x
        // ruleConfidence` discipline syllogise()'s own batch pass now applies
        // to scm-svf1 (src/domain/syllogise.mjs), computed here for this LIVE,
        // read-only chase — each restriction's own onProperty/someValuesFrom
        // scaffolding trust plus the y1⊑y2 subClassOf premise that licensed
        // the comparison (always present, mirroring syllogise()'s own
        // scmSvfDerived mapping). `restrictionByRid` looks a restriction's
        // OWN (property, target) pair up by id — the same lookup
        // syllogise()'s batch pass uses.
        const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));
        const svfTrustByTriple = new Map();
        for (const f of rows) svfTrustByTriple.set(`${f.subject}\0${f.predicate}\0${f.object}`, f.trust);
        const svfPremiseTrust = (s, p, o) => svfTrustByTriple.get(`${s}\0${p}\0${o}`);
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
          if (t !== null) svfTrustOf.set(`${d.subject}\0${d.object}`, t);
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
              trust: svfTrustOf.get(`${derived.subject}\0${derived.object}`),
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
    // Every yes-chase and the disjoint "no" above missed. The old
    // unconditional decline here fell through to the structural "couldn't
    // parse this as a graph question" wall — actively misleading for a KNOWN
    // subject, twice over: the question DID parse, and the wall's hint
    // suggests the exact shape the user just typed. When the subject has
    // remembered isa-family facts, answer with an honest, specific miss that
    // cites what IS remembered instead. An unknown subject still declines to
    // the standing wall/teach-hint path — and this never guesses a "no".
    // The SUBJECT'S OWN variants only — subjCandidates was augmented above
    // with the graph entity's class noun (the CLASS↔INSTANCE bridge), and
    // filtering on it here would cite facts about that noun ("class ⊑
    // component") as if they were facts about the asked subject ("Widget").
    const directSubjVariants = factTermVariants(normFactTerm, isaSubject);
    const knownSubjectIsa = isa.filter((f) => directSubjVariants.has(f.subject)).sort(byTrust);
    const subjectWord = isaSubject.trim();
    const kindWord = stripTrailingDiscourseTag(isaAsk[2]).trim();
    // A REPORTING probe, never an answer: re-run the same rooted search at
    // findIsaChain's own default reach to learn whether a chain exists that
    // the live chases above simply don't walk. The answer stays a miss either
    // way — this only decides which recovery the miss can honestly name.
    //
    // Naming /syllogise unconditionally would be a lie whenever no such chain
    // exists, and telling someone to teach a fact that already follows from
    // what they taught is the mirror lie. The probe reads the SAME taught
    // edge lists the chases use, and /syllogise closes over a superset of
    // them, so a chain found here is one it can really materialize.
    const deeperChainExists = [...subjCandidates].some(
      (subj) => findIsaChain(subj, objVariants, chainTypeEdges, chainSubClassEdges, { maxHops: DEEP_CHAIN_PROBE_HOPS }),
    );
    if (knownSubjectIsa.length) {
      const shown = knownSubjectIsa.slice(0, 3).map(renderFactLine).join("; ");
      const recovery = deeperChainExists
        ? `The facts to settle it are here, but the chain is longer than I follow while answering. Run "/syllogise ${subjectWord}", then ask me again.`
        : `If it's true, teach me: "${subjectWord} is a kind of ${kindWord}".`;
      return {
        text: `I can't confirm that — nothing I remember says ${subjectWord} is a ${kindWord}. I do know: ${shown}. ${recovery}`,
        replace: true,
        miss: true, // still a MISS in the turn record — honest wording, not an answer
      };
    }
    // A stored CONVERSE ("every dog is a mammal" asked as "is a mammal a
    // dog") deserves better than the bare wall: name the direction that IS
    // known and why it doesn't answer. Still a miss, never a guessed "no" —
    // some mammals may well be dogs; the store just doesn't say.
    const converseHit = isa
      .filter((f) => subjCandidates.has(f.object) && objVariants.has(f.subject))
      .sort(byTrust)[0];
    if (converseHit) {
      return {
        text: `I can't confirm that — what I know runs the other way: ${renderFactLine(converseHit)}. A kind doesn't reverse. If it's true, teach me: "every ${subjectWord} is a ${kindWord}".`,
        replace: true,
        miss: true,
      };
    }
    // Subject with NO isa facts: only divert when it's mentioned NOWHERE at
    // all (no fact row on either side, no code entity by id OR class noun) —
    // a subject known via OTHER predicates ("ahab is male") or the code graph
    // keeps the old decline, so nothing downstream is ever shadowed.
    if (!ent && !noun && !isPronoun(subjectWord)
      && !rows.some((f) => subjCandidates.has(f.subject) || subjCandidates.has(f.object))) {
      return {
        text: `I can't confirm that — I don't know "${subjectWord}" at all yet. If it's true, teach me: "${subjectWord} is a kind of ${kindWord}".`,
        replace: true,
        miss: true,
      };
    }
    return null; // the honest miss stands (never a guessed "no")
  }

  // (a1c-i) CARDINALITY MONOTONICITY — "does every X have at least N Y" over
  // a TAUGHT exactly/min cardinality restriction (pattern-5,
  // src/domain/grammar/ace.mjs's parseCardinality).
  // FALLS THROUGH ON A MISS (see CARD_AT_LEAST_ASK_RE's own doc comment) —
  // never an unconditional decline, unlike isaAsk's own closing `return null`.
  const cardAtLeast = q.match(CARD_AT_LEAST_ASK_RE);
  if (cardAtLeast) {
    const [, subjRaw, mRaw, objRaw] = cardAtLeast;
    const {
      SUBCLASS_PREDICATE: CARD_SC_PREDICATE, ON_PROPERTY_PREDICATE: CARD_ON_PROPERTY_PREDICATE,
      buildCardinalityRestrictions, proveCardinalityAtLeast, CARDINALITY_RULE_CONFIDENCE, entailedTrustFrom,
    } = await import("../domain/syllogise.mjs");
    const isTaughtCard = isOperatorTaught;
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
        // Premise-derived trust for THIS
        // rule's answer (src/domain/syllogise.mjs's CARDINALITY_RULE_CONFIDENCE doc
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
  // max-cardinality-0 restriction. NEVER infers "no" from absence, matching cax-dw's own discipline
  // above — a miss here FALLS THROUGH too (see CARD_EXISTENCE_ASK_RE's own
  // doc comment).
  const cardExistence = q.match(CARD_EXISTENCE_ASK_RE);
  if (cardExistence) {
    const [, subjRaw, objRaw] = cardExistence;
    const {
      SUBCLASS_PREDICATE: CARD_SC_PREDICATE, ON_PROPERTY_PREDICATE: CARD_ON_PROPERTY_PREDICATE,
      buildCardinalityRestrictions, proveMaxCardinalityZeroDenial, CAX_MAXC0_RULE_CONFIDENCE, entailedTrustFrom,
    } = await import("../domain/syllogise.mjs");
    const isTaughtCard = isOperatorTaught;
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
        // Same discipline as the
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

  // (a2b) OWNERSHIP yes/no — "does/did <Name> own/maintain <X>":
  // WHO_OWNS_RE only ever answers the OPEN "who
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

  // (a2b-ii) PASSIVE ownership yes/no — "is/are/was/were <X> owned by <Name>":
  // same OWNED_BY_PREDICATE facts as (a2b) above,
  // just the passive phrasing — without a dedicated reader here "is
  // TaskController owned by sam" would WALL entirely (no recognizer at all,
  // teach OR read, for the passive shape) even right after teaching that
  // exact fact via OWNS_PASSIVE_TEACH_RE.
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

  // (a2b-iii) HAS-A-METHOD yes/no — "does/did <N1> have a/an <N2> method":
  // see HAS_METHOD_YESNO_RE's own docblock
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

  // (a2b-iv) HAS-A-METHOD open list — "what methods does <N1> have":
  // every taught mgx:hasA fact for <N1>
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

  // (a2c) PROPERTY yes/no — "is/are/was/were <X> <adjective>":
  // "remember that the logger module is deprecated" taught a
  // real mgx:hasProperty fact, but without this reader there was no
  // direct-question reader for it AT ALL (only presuppositionNudge's own
  // narrow "why does X still Y" embeds this same check) — "is the logger
  // deprecated" would fall straight to the structural wall. Checks BOTH shapes a taught "<X> is <adjective>" can land
  // as (mirrors presuppositionNudge's own dual check, above): the teach lane's
  // mgx:hasProperty fact, or — when the adjective is a known ACE-OWL lexicon
  // data-property word — the ACE grammar's own tmct:<adjective> "true" triple.
  // "it"/"this"/"that" resolve against `focusLabel` — a bare pronoun with no
  // standing focus declines (null), same discipline STACCATO_PRONOUN_RE uses.
  const isAdj = qHedge.match(IS_ADJECTIVE_YESNO_RE);
  if (isAdj) {
    const rawSubject = isAdj[1].trim();
    // Pronoun-subject guard — see IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE's own docblock
    // above IS_ADJECTIVE_YESNO_RE: "are you happy"/"are you like chatgpt"/
    // "are you secretly ChatGPT or GPT-4" backtrack a personal-pronoun
    // subject in here just like any other adjective subject. Forcing
    // `subject` to null (the SAME "nothing to resolve" shape a bare "it"/
    // "this"/"that" with no standing focus already produces just below) lets
    // this whole reader decline HONESTLY — no fact lookup, no teach-offer —
    // and fall through to whatever handles identity/small-talk questions
    // instead, rather than special-casing a return here.
    const subject = IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE.test(rawSubject) || BINDABLE_COMPARISON_SUBJECT_RE.test(rawSubject) ? null
      : IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? (focusLabel || null) : rawSubject;
    const adjective = isAdj[2].trim().toLowerCase();
    if (subject) {
      const subjVariants = factTermVariants(normFactTerm, subject);
      // CLASS↔INSTANCE BRIDGE: without this, "is Task
      // auditable" would say "I don't know anything about Task yet" even
      // with "every Record is auditable" taught and Task inheriting Record in
      // the code graph — this property-yes/no reader would have no
      // inheritance bridging at all, unlike isaAsk's own CLASS↔INSTANCE BRIDGE just above
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
      // No property hit — but a bare "is X Y" (no article) is exactly the
      // same claim as "is X a Y" would have been had the user included the
      // article (ISA_ASK_RE's own territory, above): the canonical syllogism
      // ("john is a man" / "all men are mortal" / "is
      // john mortal") is asked this bare way, and "mortal" was taught as a
      // CLASS (rdfs:subClassOf), not a property — so it can only ever be
      // found by the SAME 2-hop TAUGHT-only findIsaChain proof-chase isaAsk
      // uses above, never by propertyMatch. Tried here as an ADDITIONAL
      // attempt, never a replacement: on no chain either, this falls through
      // to the ordinary property-miss handling just below, unchanged.
      {
        const { findIsaChain: chaseAdj, SUBCLASS_PREDICATE: SC_PREDICATE_ADJ, TYPE_PREDICATE: TYPE_PREDICATE_ADJ } = await import("../domain/syllogise.mjs");
        const isTaughtAdj = isOperatorTaught;
        const chainSubClassRowsAdj = rows.filter((f) => f.predicate === SC_PREDICATE_ADJ && isTaughtAdj(f));
        const chainTypeRowsAdj = rows.filter((f) => f.predicate === TYPE_PREDICATE_ADJ && isTaughtAdj(f));
        const chainSubClassEdgesAdj = chainSubClassRowsAdj.map((f) => [f.subject, f.object]);
        const chainTypeEdgesAdj = chainTypeRowsAdj.map((f) => [f.subject, f.object]);
        const factForStepAdj = (step) => (step.predicate === SC_PREDICATE_ADJ ? chainSubClassRowsAdj : chainTypeRowsAdj)
          .find((f) => f.subject === step.subject && f.object === step.object);
        const adjObjVariants = factTermVariants(normFactTerm, adjective);
        for (const subj of subjVariants) {
          const chain = chaseAdj(subj, adjObjVariants, chainTypeEdgesAdj, chainSubClassEdgesAdj, { maxHops: 2 });
          if (!chain) continue;
          const premises = chain.map(factForStepAdj);
          if (premises.every(Boolean)) return { text: `yes — ${renderIsaChain(premises)}`, replace: true };
        }
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
      // Gated on `!envelope?.parsed`, the SAME guard this
      // function's empty-memory branch above uses, for the identical
      // reason — "is the logger tested" (after teaching an UNRELATED
      // "logger... is deprecated" fact) would otherwise return "I don't have
      // a fact saying the logger is tested" here, discarding a REAL
      // structural answer ("No tests cover logger") for a word ("tested")
      // that already has genuine graph-computable meaning. A subject with a KNOWN taught
      // fact under some OTHER, non-structural property (the common,
      // originally-intended case here) still gets this receipt exactly as
      // before, since envelope.parsed is null for those adjectives.
      if (rows.some(subjectMatch) && !envelope?.parsed) {
        return { text: `I don't have a fact saying ${suggestibleSubjectPhrase(subject)} is ${adjective}.`, replace: true };
      }
      // Without this, "is the checkout flow
      // deprecated" as a genuinely FIRST-EVER question about a subject tmct
      // has never heard of (no fact at all, not even under a different
      // property) would fall through to the raw structural wall, unguided —
      // instead it gets the honest "I don't know that yet" offer to learn.
      // The offered phrasing is the SAME verified "remember that X is Y" wrapped form
      // TEACH_PROPERTY_RE actually accepts (arbitrary-length subject, no
      // lexicon gate on the complement) — never the bare unwrapped form,
      // which TEACH_PROPERTY_RE only reaches via BARE_DECLARATIVE_RE's own
      // single-token-subject restriction and would fail for a multi-word
      // subject like this one. Same helper (unknownAdjectiveOffer) the
      // empty-memory special-case above this function's own rows.length
      // bail-out reuses, so the two paths can never disagree on wording.
      //
      // Same `!envelope?.parsed` guard as just above — a
      // subject known only under an UNRELATED property (e.g. "deprecated")
      // must not offer to teach "tested" when ask()'s own grammar already
      // resolved it structurally.
      if (!envelope?.parsed && !PLACE_ADVERB_OBJECT_RE.test(adjective)) return unknownAdjectiveOffer(subject, adjective);
    }
  }

  // (a3) GENERAL VERB-TO-PREDICATE direct-question retrieval: a taught
  // general-verb fact ("margo eats ribs") answered back
  // directly. Yes/no form matches the taught triple EXACTLY (subject +
  // predicate + object, via the SAME factTermVariants/normFactTerm matching
  // WHO_OWNS_RE just used above) — a hit is a confident "yes". A no-hit must
  // NOT synthesize a confident "no": "no matching triple found after one
  // lookup" is NOT a proof of absence (this project's OWA/honesty
  // discipline) — it's indistinguishable from "I simply don't know". So a
  // no-hit returns null (declining), same as WHO_OWNS_RE's own no-hit above, falling through
  // to the ordinary honest-miss cascade instead of fabricating a "no". Open
  // form lists every stored fact row for {subject, predicate} regardless of
  // object.
  // The negation strips first, so "does fred not eat kale" and "doesn't fred
  // eat kale" reach the SAME predicate lookup as "does fred eat kale" and the
  // stored polarity — positive or negative — is what answers. The teach side
  // strips through splitTeachNegation over the same NEG_MARKER_SRC, so the two
  // sides can never disagree about what negates a sentence.
  const genYN = positiveQuestionSurface(q).match(GENERAL_VERB_YESNO_RE);
  if (genYN && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
    const [, subjectRaw, verbRaw, objectRaw] = genYN;
    const verb = verbRaw.toLowerCase();
    if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb)) {
      const subject = subjectRaw.trim();
      // the SAME preposition fold the teach side applies, so "does disk-1
      // rest on peg-a" looks up mgx:rest-on/"peg-a", matching what
      // generalVerbTeach actually stored
      const folded = foldPrepositionIntoPredicate(await generalVerbPredicate(verb), objectRaw);
      const object = folded.object.replace(/^an?\s+/i, "").trim();
      if (subject && object) {
        const predicate = folded.predicate;
        const subjVariants = factTermVariants(normFactTerm, subject);
        const objVariants = factTermVariants(normFactTerm, object);
        // BOTH polarities are looked up under one predicate pair: a stored
        // negative answers "no" as confidently as a positive answers "yes",
        // and neither is ever inferred from the other's absence.
        const polar = [predicate, negatedPredicate(predicate)];
        const hit = rows
          .filter((f) => polar.includes(f.predicate) && subjVariants.has(f.subject) && objVariants.has(f.object))
          .sort(byTrust)[0];
        if (hit) {
          const verdict = isNegatedPredicate(hit.predicate) ? "no" : "yes";
          return { text: `${verdict} — ${renderFactLine(hit)}`, replace: true, generalVerbQuery: true };
        }
        // A KNOWN subject under the SAME relation, no row matching this
        // object: an honest, specific miss citing what the subject IS
        // remembered to relate to, instead of the generic structural wall.
        // Still never a guessed "no" — the text declines to confirm and says
        // what it does know, and `miss: true` keeps it out of recall.
        const sameRelation = rows.filter((f) => polar.includes(f.predicate) && subjVariants.has(f.subject));
        if (sameRelation.length) {
          const shown = sameRelation.slice(0, 3).map(renderFactLine).join("; ");
          return {
            text: `I can't confirm that — nothing I remember says ${factPhrase({ subject, predicate, object })}. I do know: ${shown}.`,
            replace: true,
            miss: true,
          };
        }
        return null; // no remembered fact — the honest miss stands (never a guessed "no")
      }
    }
  }
  const genOpen = q.match(GENERAL_VERB_OPEN_RE);
  if (genOpen && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
    const [, subjectRaw, verbRaw] = genOpen;
    // "what does disk-1 rest on" captures "rest on" — split the folded
    // preposition back off and suffix the minted predicate, mirroring the
    // teach side's foldPrepositionIntoPredicate
    const [verb, verbPrep] = verbRaw.toLowerCase().split(/\s+/);
    if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb)) {
      const subject = subjectRaw.trim();
      if (subject) {
        let predicate = await generalVerbPredicate(verb);
        if (verbPrep && /^mgx:[a-z]+$/.test(predicate)) predicate = `${predicate}-${verbPrep}`;
        const subjVariants = factTermVariants(normFactTerm, subject);
        // both polarities: "what does fred eat" should surface a remembered
        // "fred does not eat kale" rather than miss on it — renderFactLine
        // spells the polarity out, so the list can't be misread
        const polar = [predicate, negatedPredicate(predicate)];
        const hits = rankByBiasThenTrust(rows.filter((f) => polar.includes(f.predicate) && subjVariants.has(f.subject)), biasByBundle);
        if (hits.length) return { ...renderMany(hits), generalVerbQuery: true };
      }
    }
  }

  // "what rests on peg-a" / "who sits on the chair" — the reverse-by-OBJECT
  // mirror of the two general-verb readers above, for taught prepositional
  // facts. Only ever diverts on a REAL stored hit (the predicate is minted
  // from the surface verb + folded preposition, so a code question like
  // "what calls chat.mjs" — no such taught fact — falls through untouched;
  // this also outranks the spell-corrector's "rests"→"tests" misread, which
  // otherwise walls this exact phrasing).
  const genReverse = q.match(/^(?:what|who)\s+([a-z]+)\s+(on|in|at|onto|upon|under|over|beside|near|behind|above|below|inside|outside)\s+(.+?)[?.!\s]*$/i);
  if (genReverse && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
    const [, verbSurface, prep, objectRaw] = genReverse;
    const verb = verbSurface.toLowerCase();
    if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb) && !GENERAL_VERB_NOT_A_VERB_RE.test(verb)) {
      let predicate = await generalVerbPredicate(verb);
      if (/^mgx:[a-z]+$/.test(predicate)) predicate = `${predicate}-${prep.toLowerCase()}`;
      const objVariants = factTermVariants(normFactTerm, objectRaw.replace(/^(?:an?|the)\s+/i, "").trim());
      const hits = rankByBiasThenTrust(rows.filter((f) => f.predicate === predicate && objVariants.has(f.object)), biasByBundle);
      if (hits.length) return { ...renderMany(hits), generalVerbQuery: true };
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
  // This branch exists specifically to catch the bare, no-article "what is X"
  // shape the grammar's own T5 template DECLINES to parse for a non-ENTITY_TO_TYPE
  // term (grammar.mjs's own closed-set gate on the bare form) — envelope.parsed
  // stays null for exactly this case, which is this branch's own trigger
  // condition. The regex mirrors BARE_WHATIS_RE's own "article optional"
  // convention (used one function up in this same cascade) rather than
  // requiring a mandatory article: "every cache is a florble" / "what is
  // florble" (no article) and "cheese is blue" / "what is blue" (no article)
  // must resolve the same way "what is a florble"/"what is a blue" (WITH the
  // article) does, for every term alike.
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

/** Taught facts about ONE resolved entity, trust-
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
async function describedFacts(memoryDir, label, biasByBundle = {}, cache = null) {
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const rows = await factRows(memoryDir, cache);
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
      const { loadSlice, loadMap, termText } = await import("../adapters/corpus/conceptnet.mjs");
      const { normFactTerm } = await import("../adapters/memory/core.mjs");
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
    const { normFactTerm } = await import("../adapters/memory/core.mjs");
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
    const { loadBlockIndex, BLOCKS_DIR_REL } = await import("../adapters/memory/blocks.mjs");
    const { readFile } = await import("node:fs/promises");
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
 *  subject "what about X" replaces. The lowerCamelCase alternative closes a
 *  real drill-down gap: a chain focused on a FUNCTION
 *  ("what does saveStore call") has no Capitalized/path token at all, so "what
 *  about X" after it used to fall straight through to the honest-miss instead
 *  of continuing the shape — a mid-word capital never occurs in plain English,
 *  so this is a safe, unambiguous code-identifier signal. */
const NAME_TOKEN_RE = /\b[\w-]+(?:[/.][\w-]+)+\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/;

/** STACCATO SWAP CONTINUATION: the bare-
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

/** The referring pronouns an EMBEDDED "what about X, <wh-clause>" swap replaces
 *  — CONTEXT_WORDS (it/this/that/here) plus the personal pronouns
 *  PRONOUN_IN_QUERY_RE deliberately omits (he/she/they/them): the embedded
 *  clause's own subject/object, not a prior-turn antecedent, so a subject
 *  pronoun like "he" that never appears in a code-graph query still has to be
 *  swappable here. */
const EMBEDDED_PRONOUN_RE = /\b(?:it|this|that|here|he|she|they|them)\b/i;

/** DISCOURSE CONTINUATION: "what about X" carries the PRIOR
 *  turn's question shape across the turn boundary — re-asking it with X in place of
 *  the previous subject/object. Returns the reconstructed query (parsed like any
 *  subject question, so X resolves and becomes the new focus), or null when there's
 *  no prior query or no name token to swap (→ the ordinary honest miss stands). */
function discourseRewrite(query, last) {
  const m = String(query).match(WHAT_ABOUT_RE);
  let newSubj;
  if (m) {
    newSubj = m[1].trim();
    // An embedded question spliced into the "what about" subject ("what about
    // the store, what it do") must NEVER be substituted into the prior turn's
    // shape — that inherits the prior turn's DIRECTION onto a question asking
    // the opposite ("who uses store.mjs" then "…what it do" would answer "who
    // uses the store"). Split on the interior wh-clause and re-read the
    // remainder against a CLOSED micro-set; a clause outside it is an honest
    // miss, never the prior-turn substitution below. A comma NOT followed by a
    // wh-word ("what about the store, please") never matches and keeps its
    // ordinary swap.
    const embedded = newSubj.match(/^(.+?),\s*(what|who|which|where|how)\b\s*(.*)$/i);
    if (embedded) {
      const embSubj = embedded[1].trim();
      const wh = embedded[2].toLowerCase();
      const rest = embedded[3].trim();
      // "what [it/this/that/he/she] do(es)" → the module overview of the new
      // subject, which MODULE_ORIENT_RE serves verbatim.
      if (wh === "what" && /^(?:he|she|it|this|that)?\s*do(?:es)?$/i.test(rest)) {
        return `what does ${embSubj} do`;
      }
      // A wh-clause carrying its OWN pronoun ("what does it call") → swap that
      // pronoun for the new subject and ask the clause standalone.
      if (EMBEDDED_PRONOUN_RE.test(rest)) {
        return `${wh} ${rest.replace(EMBEDDED_PRONOUN_RE, () => embSubj)}`;
      }
      return null;
    }
  } else {
    const sm = String(query).match(STACCATO_SWAP_RE);
    const cand = sm?.[1]?.trim();
    if (!cand) return null;
    // VOCABULARY STACCATO: "tell me about a dog" -> "and a cat". The article
    // plus a plain word is the gate on the NEW term (a bare "and stuff" never
    // matches), and the PRIOR turn must itself have been a vocabulary
    // question — a code drill-down chain keeps the code-ish NAME_TOKEN rule
    // below unchanged.
    const articled = cand.match(/^(?:an?|the)\s+([a-z][\w-]*)$/i);
    // A what-else EXPANSION turn is still a vocabulary turn — the swap has to
    // survive it, or "tell me about a dog" / "what else can dogs do" / "and a
    // cat" strands the third turn on the blurb.
    const prevWasVocab = last?.query
      && (BARE_WHATIS_RE.test(String(last.query)) || vagueTouchTermOf(String(last.query))
        || /^(?:what|anything)\s+else\b/i.test(String(last.query).trim()));
    if (articled && prevWasVocab) return `what is a ${singularizeSurface(articled[1])}`;
    if (!NAME_TOKEN_RE.test(cand)) return null;
    newSubj = cand;
  }
  if (!last?.query) return null;
  const prevQ = String(last.query);
  if (NAME_TOKEN_RE.test(prevQ)) return prevQ.replace(NAME_TOKEN_RE, () => newSubj);
  // PRONOUN-ANTECEDENT PRIOR QUERY: the prior turn can ITSELF be
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
  // TOPIC SHIFT after a plain vocabulary question: "what is a dog" -> "what
  // about cats" means "what is a cat". Such a prior query has neither a
  // NAME_TOKEN nor a pronoun for the two rules above to swap, so both decline
  // and the turn used to reach the wall.
  //
  // The gate is the PRIOR turn's own shape (BARE_WHATIS_RE — a plain "what
  // is/are X"), never a looser reading of the new term. Widening NAME_TOKEN_RE
  // to cover ordinary words would look like the same fix and is not: it would
  // let "what about cats" rewrite "which modules import Widget" by swapping
  // "modules", answering a question nobody asked.
  //
  // vagueTouchTermOf owns the "what about X" surface already, so the term
  // comes from there rather than a second parse — it strips the article that
  // WHAT_ABOUT_RE's own capture keeps ("what about a cat" -> "cat", not "a
  // cat"). It reads the "what about"/"tell me about"/"explain" surfaces only,
  // so the staccato swap ("and Widget") declines here and keeps the behaviour
  // it has today. singularizeSurface matches the stored singular; facts are
  // stored one way and "cats" would find nothing.
  if (BARE_WHATIS_RE.test(prevQ)) {
    const term = vagueTouchTermOf(query);
    if (term) return `what is a ${singularizeSurface(term)}`;
  }
  return null;
}

/** STACCATO SUPERLATIVE REPEAT: "the biggest
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
 *  <verb-phrase>" -> "what <verb-phrase>".
 *  parseExistence (ask.mjs) correctly DECLINES this shape — "anything" is a
 *  placeholder, not a real entity-kind noun, so it rightly leaves a relative-
 *  clause verb-phrase for the relation parsers below. But those parsers then
 *  treat the ELIDED subject as an ANAPHORA continuation (reusing the standing
 *  focus) instead of recognizing "anything that <verb> X" as the SAME open
 *  reverse-lookup "is anything <verb-ing> X" already answers correctly.
 *  Without this, "is there anything that tests
 *  Task", asked right after focus had landed on UserController, would answer
 *  "No — no tests edge found from UserController to Task" — a confidently
 *  WRONG answer (worse than a miss), not the real answer. A closed textual rewrite
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

/** REVERSE CLEFT "what/who is it that <verb-phrase>" -> "what/who <verb-phrase>",
 *  the closed sibling of EXISTENTIAL_ANYTHING_RE just above and the same trade:
 *  a textual rewrite onto the ALREADY-CORRECT "what <verb> X" shape, no new
 *  capability.
 *
 *  The "it that" here is pure scaffolding. A reverse cleft names no contrasted
 *  element — "what is it that calls loadStore" asks exactly what "what calls
 *  loadStore" asks, so dropping the frame loses nothing. Without the rewrite
 *  parseKeywordSpot finds the verb, splits the text around it, and the leftover
 *  "it that" survives the STOPWORDS filter (which carries "what"/"is" but not
 *  "it"/"that") to become the subject — so the turn asks about an entity named
 *  "it that" and misses.
 *
 *  The FORWARD cleft "is it X that calls Y" is deliberately left alone. It DOES
 *  name a contrasted element ("it is X, not something else"), it already answers
 *  correctly, and it discriminates: "is it createTask that calls saveStore" ->
 *  yes, "is it loadStore that calls saveStore" -> no. Flattening that shape
 *  would throw the contrast away for nothing.
 *
 *  The "that <verb-phrase>" tail is mandatory, exactly as it is for
 *  EXISTENTIAL_ANYTHING_RE. A bare "what is it" has no tail and keeps its own
 *  path, and "what time is it" never opens with "what is it" at all, so the
 *  personal-assistant decline is untouched. */
const REVERSE_CLEFT_RE = /^(what|who)\s+(?:is|was)\s+it\s+that\s+(.+?)\s*\??$/i;
function reverseCleftRewrite(query) {
  const m = REVERSE_CLEFT_RE.exec(String(query || "").trim());
  return m ? `${m[1].toLowerCase()} ${m[2].trim()}` : null;
}

// ---- curated SEON definitions (corpus/seon/definitions.jsonl) ----
// A "what is a <term>" for a LEXICON term prefers the curated one-sentence
// definition, cited via:"corpus/seon" — but only when this repo carries the
// SEON concept seed, and a fact the USER personally asserted still wins.

let seonDefsPromise = null;
/** Load corpus/seon/definitions.jsonl once → Map(normFactTerm(term) → definition).
 *  Lazy + failure-tolerated (chat.mjs ethos): any failure degrades to an empty map. */
function seonDefinitions() {
  if (!seonDefsPromise) {
    seonDefsPromise = (async () => {
      const { SEON_DEFINITIONS_FILE } = await import("../adapters/corpus/conceptnet.mjs");
      const { normFactTerm } = await import("../adapters/memory/core.mjs");
      const { readFile } = await import("node:fs/promises");
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
      const { SEON_DEFINITIONS_FILE } = await import("../adapters/corpus/conceptnet.mjs");
      const { readFile } = await import("node:fs/promises");
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

/** "what is a/an <term>" with the article made OPTIONAL,
 *  for the FACT-LOOKUP path only (metaTermOf/factAnswer's own bare-form fallback)
 *  — NOT grammar.mjs's structural T5 template, which keeps its article MANDATORY
 *  on purpose (a bare "what is <anything>" would also swallow "what is the
 *  meaning of this codebase", an existing, deliberately honest grammar-miss
 *  regression — test/tools/ask.test.mjs pins it null; see T5's own docblock). That
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
/** A bare "who is/was <name>" with no relational tail ("of Y") or genitive
 *  ("Y's role") — those keep their own specific who-readers. This single-token
 *  form is armed into the meta-term fact lane only on a would-miss, and only
 *  surfaces an answer when memory actually holds facts about the name (as a
 *  subject or a relation object); with no such facts it returns null and the
 *  turn falls through to the author/relation who-readers unchanged. */
const WHO_IS_BARE_RE = /^who\s+(?:is|are|was|were)\s+(?:an?\s+|the\s+)?([\w'-]+)[?.!\s]*$/i;

/** The meta term a "what is a X" / "what is X" / "what does X mean" / "define X"
 *  question asks about — from the parse when present, else recognized directly
 *  via BARE_WHATIS_RE (article optional — see its own docblock for why that's
 *  safe here even though the grammar's own T5 keeps the article mandatory).
 *  Null when the line isn't such a form. A curated trailing
 *  scope clause ("what is a Module in this graph") is stripped off the captured
 *  term the same way grammar.mjs's T5 does (stripTrailingScopeFiller,
 *  ask-vocab.mjs) — the envelope.parsed.object branch above already carries a
 *  trimmed term when it came from that template, so the strip here only needs to
 *  cover this function's own regex fallback. A trailing bare discourse tag
 *  ("what is a component THEN") is stripped the same way
 *  (stripTrailingDiscourseTag) before the scope-filler strip. */
function metaTermOf(query, envelope) {
  if (envelope?.parsed?.shape === "meta" && envelope.parsed.object) return envelope.parsed.object;
  const q = String(query).trim();
  const m = q.match(BARE_WHATIS_RE)
    || q.match(/^what\s+(?:does|do)\s+(?:an?\s+)?(.+?)\s+means?[?.!\s]*$/i)
    || q.match(/^define\s+(?:an?\s+)?(.+?)[?.!\s]*$/i);
  return m ? stripTrailingScopeFiller(stripTrailingDiscourseTag(m[1].trim())) : null;
}

/** The TEACH-OFFER line for a term that's genuinely unknown everywhere:
 *  "I don't know 'X' yet — teach me directly, e.g. …". The
 *  concrete example is worded by WORD COUNT, verified in-state —
 *  an unwrapped bare declarative
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
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  // lexicon-noun gate: the curated defs are keyed on SE lexicon terms only.
  let lex = lexicon;
  try {
    if (!lex) { const { loadLexicon } = await import("../domain/grammar/lexicon.mjs"); lex = loadLexicon(); }
    const { lookupNoun } = await import("../domain/grammar/lexicon.mjs");
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

// ---- learn-on-miss: the shipped child + reference packs behind the cleanest miss ----

/** The learn-on-miss gate, shared by the child-pack hook, the articled
 *  reference hook and the bare-form fallback so the three can never disagree.
 *  Passes only on the CLEANEST miss: a definition-shaped term the lexicon
 *  knows, resolving to no graph entity and no remembered fact — then, and
 *  only then, may a pack provider be consulted. Null means the turn proceeds
 *  byte-identically to a pack-less run. */
async function cleanMissPackKey(term, { graph, memoryDir, lexicon, cache }) {
  if (!term || !memoryDir) return null;
  let key = null;
  try { key = cleanMissReferenceTerm(term, lexicon ?? undefined); } catch { key = null; }
  if (!key) return null;
  if (await resolveEntity(graph, term)) return null;
  let normFactTerm;
  let loadMemory;
  let readRuleRows;
  try { ({ normFactTerm, loadMemory, readRuleRows } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const variants = factTermVariants(normFactTerm, term);
  variants.add(key);
  const rows = await factRows(memoryDir, cache);
  if (rows.some((f) => variants.has(f.subject) || variants.has(f.object))) return null;
  // A taught RULE that owns this term outranks any pack load: surfacing
  // unrelated conceptnet content over the user's own taught concept is worse
  // than the honest miss the decline leaves standing.
  try {
    const ruleNames = readRuleRows(await loadMemory(memoryDir)).map((r) => normFactTerm(r.name)).filter(Boolean);
    if (ruleNames.some((n) => variants.has(n))) return null;
  } catch { /* tolerated — the fact gate above already ran */ }
  return key;
}

/** The reference-pack lookup for an already-gated key: the article, or null
 *  (absent pack, missing term, any read failure — all byte-identical). */
async function referencePackAnswerForKey(key, env) {
  let article = null;
  try { article = await getReferencePackProvider(env).lookup(key); } catch { article = null; }
  if (!article) return null;
  return { key, article, text: renderReferenceAnswer(key, article) };
}

/** The gate + the reference lookup in one call, for a caller that has a term
 *  rather than a gated key. */
async function referencePackMissAnswer(term, { graph, memoryDir, lexicon, env, cache }) {
  const key = await cleanMissPackKey(term, { graph, memoryDir, lexicon, cache });
  return key ? referencePackAnswerForKey(key, env) : null;
}

/** The LIVE variant of cleanMissPackKey — the same resolveEntity and
 *  remembered-fact checks, but through cleanMissLiveTerm, which drops the
 *  lexicon-membership wall: a word the lexicon has never met is exactly what
 *  the live lookup exists for. Null means the turn proceeds byte-identically
 *  to a live-off run. */
async function cleanMissLiveKey(term, { graph, memoryDir, lexicon, cache }) {
  if (!term || !memoryDir) return null;
  let key = null;
  try { key = cleanMissLiveTerm(term, lexicon ?? undefined); } catch { key = null; }
  if (!key) return null;
  if (await resolveEntity(graph, term)) return null;
  let normFactTerm;
  try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { return null; }
  const variants = factTermVariants(normFactTerm, term);
  variants.add(key);
  const rows = await factRows(memoryDir, cache);
  if (rows.some((f) => variants.has(f.subject) || variants.has(f.object))) return null;
  return key;
}

/** The live Wikipedia lookup for an already-gated key: the article, or null
 *  (toggle-off provider, network failure, throttle, drift-guard rejection —
 *  all byte-identical to a live-off run). `onLiveLookup` is a notify-only
 *  hook (the web page's "searching wikipedia…" statusline); its own failure
 *  is swallowed too. */
async function liveReferenceAnswerForKey(key, onLiveLookup) {
  try { if (typeof onLiveLookup === "function") onLiveLookup(key); } catch { /* notify-only */ }
  let article = null;
  try { article = await getLiveReferenceProvider().lookup(key); } catch { article = null; }
  if (!article) return null;
  return { key, article, text: renderLiveReferenceAnswer(key, article) };
}

/** The child-pack half of learn-on-miss, for an already-gated key: look the
 *  key up in the shipped child triples pack and append every fact under child
 *  provenance, so the SAME question can be re-asked from the store. Null on a
 *  pack miss or any failure — the turn then proceeds byte-identically. */
async function childPackFactsForKey(key, { memoryDir, env, cache, synthesisBudget = AUTO_SYNTHESIS_BUDGET }) {
  let row = null;
  try { row = await getChildPackProvider(env).lookup(key); } catch { row = null; }
  if (!row?.facts?.length) return null;
  try {
    const { appendFacts } = await import("../adapters/memory/core.mjs");
    await appendFacts(memoryDir, row.facts.map(({ subject, predicate, object }) => ({
      subject, predicate, object, provenance: childProvenanceTag(key),
    })));
  } catch { return null; }
  if (cache) cache.rows = null;
  await synthesiseAroundTerm(memoryDir, key, cache, synthesisBudget);
  return { key, count: row.facts.length };
}

/** Store every triple the article's summary grounds — its first-sentence isa
 *  plus each candidate the optimistic tier reads from the rest of the summary —
 *  all under the article's own provenance, so a learned load becomes durable
 *  knowledge rather than a single isa fact. Runs AFTER the cited answer composed
 *  and is failure-tolerated: the answer stands whether or not the facts land.
 *  The optimistic tier is pure (no recognizer re-entry), so this stays cheap on
 *  the chat turn. Returns the count stored. */
async function ingestReferenceArticle(memoryDir, key, article, cache, tagFor = referenceProvenanceTag, lexicon = null, synthesisBudget = AUTO_SYNTHESIS_BUDGET) {
  if (!article) return 0;
  const provenance = tagFor(article);
  const facts = [];
  const seen = new Set();
  const add = (subject, predicate, object) => {
    const id = `${subject}\0${predicate}\0${object}`;
    if (subject && object && subject !== object && !seen.has(id)) { seen.add(id); facts.push({ subject, predicate, object, provenance }); }
  };
  if (article.isa) add(key, "rdfs:subClassOf", article.isa);
  try {
    const { optimisticTriples } = await import("./extract-facts.mjs");
    for (const sentence of splitSentences(article.summary || article.text || "")) {
      for (const t of optimisticTriples(sentence, { lexicon: lexicon ?? undefined })) add(t.subject, t.predicate, t.object);
    }
  } catch { /* the isa alone still lands below */ }
  if (!facts.length) return 0;
  try {
    const { appendFacts } = await import("../adapters/memory/core.mjs");
    await appendFacts(memoryDir, facts);
    if (cache) cache.rows = null;
  } catch { return 0; }
  await synthesiseAroundTerm(memoryDir, key, cache, synthesisBudget);
  return facts.length;
}

// A learn-on-miss load stores a handful of new facts; the auto-synthesis pass
// that connects them to the rest of the store is deliberately small — a low
// budget, focus expanded through the loaded term — so it stays a per-ingest
// materialisation, not the whole-store maintenance job /syllogise runs.
const AUTO_SYNTHESIS_BUDGET = 12;

/** After a learn-on-miss load stored new facts about `term`, run a bounded,
 *  focus-scoped forward-chaining pass so the new facts connect to what's
 *  already remembered — the auto sibling of the /syllogise command. Derived
 *  facts carry entailed:* provenance at their discounted trust and are
 *  retractable. Failure-tolerated: a synthesis miss never disturbs the answer
 *  the load already composed. Returns the count derived. */
async function synthesiseAroundTerm(memoryDir, term, cache, budget = AUTO_SYNTHESIS_BUDGET) {
  if (!memoryDir || !term || budget <= 0) return 0;
  try {
    const { syllogise } = await import("../domain/syllogise.mjs");
    const { loadMemory, readFactRows, appendFacts, normFactTerm } = await import("../adapters/memory/core.mjs");
    const res = await syllogise(memoryDir, {
      focus: [...factTermVariants(normFactTerm, term)],
      expandFocus: true,
      budget,
      store: { loadMemory, readFactRows, appendFacts },
    });
    if (res?.count && cache) cache.rows = null;
    return res?.count || 0;
  } catch { return 0; }
}

/** The term an explicit "ask Wikipedia" phrasing names — "what does wikipedia
 *  say about X", "ask wikipedia about X", "X on wikipedia" — or null when the
 *  line isn't such a request. Unlike the clean-miss gate, this fires even when
 *  local facts could answer: the user asked Wikipedia specifically. */
const WIKIPEDIA_ASK_RES = [
  /^what\s+(?:does|do)\s+wikipedia\s+say\s+(?:about\s+)?(.+?)[?.!\s]*$/i,
  /^ask\s+wikipedia\s+(?:about\s+)?(.+?)[?.!\s]*$/i,
  /^(?:look\s+up\s+|tell\s+me\s+about\s+|what\s+(?:is|are)\s+(?:an?\s+|the\s+)?)?(.+?)\s+on\s+wikipedia[?.!\s]*$/i,
];
function wikipediaAskTerm(query) {
  const q = String(query || "").trim();
  for (const re of WIKIPEDIA_ASK_RES) {
    const m = q.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim().replace(/^(?:an?|the)\s+/i, "");
  }
  return null;
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
// "tel" -> "tell": not part of ask.mjs's code-graph grammar, so it can't live
// in the shared MISSPELLINGS table — scoped locally instead. Word-boundary
// matched so "hotel"/"intel" are untouched.
const VAGUE_TOUCH_TEL_RE = /\btel\b/i;
// "abut" -> "about": same reasoning as VAGUE_TOUCH_TEL_RE — a bare discourse
// word, not grammar-owned, so it stays a local replace. Word-boundary matched
// so a real identifier merely containing "abut" (e.g. "rebuttal") is untouched.
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
  // already peels ("cheers, what about
  // imports then" and "could you kindly tell me about the calls" would
  // otherwise fall through to a bogus object search) — applyPreambleFrames alone, NOT
  // the full normalizeQuery pipeline, which also runs subordination/
  // conditional rewrites that turn "tell me about X" into "about X" (its own
  // bridge frame), breaking this very regex.
  let q = correctMisspellings(String(query).trim());
  q = q.replace(VAGUE_TOUCH_TEL_RE, "tell");
  q = q.replace(VAGUE_TOUCH_ABUT_RE, "about");
  q = applyPreambleFrames(q);
  const m = q.match(/^(?:kindly\s+)?tell me (?:(?:something|a\s+little|a\s+bit|more)\s+)?about\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i)
    || q.match(/^(?:(?:and|so|but|ok|okay|now|then|kindly)\s+)*what about\s+(?:an?\s+|the\s+)?(.+?)(?:\s+then|\s+though)?[?.!\s]*$/i)
    // "explain X" — a bare "explain <term>" is at least as natural a vague touch as "tell
    // me about X", but had no recognized shape at all: normalize.mjs's own
    // EXPLAIN_WRAPPER_RE only unwraps a WH-QUESTION remainder ("explain
    // please where is it defined" -> a real structural question), so a bare
    // noun remainder like "cochange" was never its territory. A leading
    // "please"/"kindly" also broke the STRUCTURAL pipeline's own
    // EXPLAIN_WRAPPER_RE (anchored to start with "explain" literally),
    // sending the whole turn to the wrong lane.
    || q.match(EXPLAIN_TOUCH_RE);
  if (!m) return null;
  // A trailing meta-noun naming WHAT KIND of thing the touched word already is:
  // "tell me about the cochange
  // relation" / "what about the calls relationship" / "what about the imports
  // edges" would otherwise capture the WHOLE tail ("cochange relation") as the term —
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
  // ask()-grammar envelope to inherit normalization from.
  const q = correctMisspellings(String(query).trim()).toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  let m;
  // "what are the imports", "what is the containment", "what are all the calls",
  // and the texting-shorthand "r" for "are" ("what r the calls" — narrowly
  // scoped to this closed shape, same judgment call
  // as chat.mjs's own SHORTHAND_CONTRACTIONS for the identity lane: "r" only reads
  // as "are" right after "what" in one of these curated anchor shapes, so a real
  // one-letter identifier is never at risk).
  if ((m = q.match(/^what\s+(?:are|is|r)\s+(?:all\s+)?(?:the\s+)?([a-z][a-z-]*?)(?:\s+(?:edges|relationships|relations))?$/))) return m[1];
  // "what calls are there", "what imports are there", "what calls r there"
  if ((m = q.match(/^what\s+([a-z][a-z-]*?)\s+(?:are|r)\s+there$/))) return m[1];
  // "what is calling", "what is importing" (bare gerund, no object)
  if ((m = q.match(/^what\s+(?:is|are)\s+([a-z][a-z-]*ing)$/))) return m[1];
  // STACCATO RELATION-CHAIN CONTINUATION: a rapid-fire short follow-up inside
  // an EXISTING relation-touch chain — "and calls?", "also tests", "so
  // inherits", "then contains" — has no "about"/
  // "is"/"are" at all, just a bare connective + the relation word. Without
  // this, the bare word fell straight through to ask()'s own raw grammar,
  // which parsed the leading connective ITSELF as the object term (e.g. "and
  // calls" read as kind=calls object="and", silently resolving "and" via the
  // standing focus/contextId fallback into an unrelated, honestly-empty-but-
  // wrong answer) or, worse, matched no shape at all and hit the grammar
  // wall outright. Scoped to RELATION_TERM's own closed dict downstream, so an
  // unrelated word or a real entity name safely falls through unchanged.
  if ((m = q.match(/^(?:and|also|so|then|now)\s+([a-z][a-z-]*)$/))) return m[1];
  // THE SINGULAR META FORM — "what is a test" / "what is an import". Admitted
  // only when the ordinary path MISSED on a plain definitional parse
  // (envelope.miss on a shape:"meta" object), so the frozen am-meta-imports
  // ambiguity case (a DIFFERENT shape) is untouched.
  if (envelope?.miss === true && envelope?.parsed?.shape === "meta" && envelope.parsed.object) {
    return envelope.parsed.object;
  }
  return null;
}

/** A closed "describe"-intent wrapper: "can you describe X for me", "could you
 *  tell me about X", "tell me more about X", "what about X" → attempt
 *  tmct_describe(X). LAST-RESORT lane (see its call site below): "tell me
 *  about X" is ALSO the relation/concept force's own trigger for enumerable
 *  concepts, and "what about X" is ALSO discourseRewrite's own continuation
 *  trigger — this must never run before those have had their chance. Reads
 *  the RAW turn text (not FILLER_WORDS-stripped), so it trails its own
 *  optional "please"/"for me". The trailing \s+ lives INSIDE each alternation
 *  branch rather than once after the group, since "about" is optional in the
 *  "tell me" branch and a single external \s+ would double-count the
 *  separator when "about" fires. */
const DESCRIBE_WRAPPER_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?(?:tell\s+me\s+(?:(?:more|something|a\s+little|a\s+bit)\s+)?(?:about\s+)?|describe\s+|what(?:'s|\s+is)?\s+about\s+)(.+?)(?:\s+for\s+me)?(?:\s+please)?\s*\??$/i;

/** Bare focus pronouns this lane resolves against the STANDING focus —
 *  "describe that" / "tell me about it" after a prior turn set the focus.
 *  Never a guess: no standing focus → the lane declines (null). */
const DESCRIBE_PRONOUN_RE = /^(?:it|that|this|those|them)$/i;

/** STACCATO PRONOUN CONTINUATION: a rapid-fire short follow-up naming no verb
 *  at all — "and that?", "also this" — the bare-connective sibling of
 *  DESCRIBE_WRAPPER_RE's "what about it"/"describe that". An optional
 *  trailing "one"/"ones" is at least as natural as the bare pronoun. */
const STACCATO_PRONOUN_RE = /^(?:and|also|so|then|now)\s+(it|that|this|those|them)(?:\s+ones?)?\s*\??$/i;

/** "describe the logger module"/"describe the Task class" — dispatchTool
 *  ("tmct_describe") resolves its `symbol` arg via codegraph.mjs's
 *  resolveSymbol, a simpler path/basename matcher with NO article- or
 *  grain-word tolerance. Scoped to ONLY attempt a resolution when the term
 *  carries an EXPLICIT trailing grain word (module/class/function/…,
 *  ENTITY_TO_TYPE's own closed table): routing arbitrary free text through
 *  resolveObject's looser tiers risks a false match (a genuine article like
 *  "a" can itself be a real one-character path component, e.g. "a.mjs"). */
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
    const { resolveObject } = await import("../domain/ask.mjs");
    const r = resolveObject(graph, head.trim(), { expectedClass });
    if (r?.match?.id && !r.ambiguous) return { id: r.match.id, label: r.match.label };
  } catch { /* tolerated */ }
  return null;
}

async function describeWrapperAnswer(query, { config, source, focus, graph, tel = null }) {
  // The detailed-summary/overview phrasings belong to the completions rescue
  // (4e, tried right after this lane) — applyPreambleFrames' show/give-me
  // bridge would otherwise rewrite them into a describe this lane claims
  // with a worse answer.
  if (DETAILED_HOW_WORKS_RE.test(String(query || "").trim()) || DETAILED_OVERVIEW_RE.test(String(query || "").trim())) return null;
  // This lane is the LAST-RESORT rescue (4d), tried after every earlier lane
  // declines. applyPreambleFrames + correctMisspellings run first, the same
  // general-purpose normalization every other lane in this file applies,
  // so a preamble or curated typo doesn't break DESCRIBE_WRAPPER_RE's anchor.
  const q = applyPreambleFrames(correctMisspellings(String(query || "").trim()));
  const m = DESCRIBE_WRAPPER_RE.exec(q) || STACCATO_PRONOUN_RE.exec(q);
  let term = m?.[1]?.trim();
  if (!term) return null;
  // "describe about X" (a doubled verb) leaves a redundant leading "about "
  // glued to the captured term.
  term = term.replace(/^about\s+/i, "");
  // A trailing bare discourse tag ("describe Record then") glued onto the
  // captured term, same class of gap stripTrailingDiscourseTag (ask-vocab.mjs)
  // already fixes for the meta-whatis vocab lane.
  term = stripTrailingDiscourseTag(term);
  // "tell me about the router thing" / "the logging stuff" — a vague filler
  // noun wrapped around a real term. Strip it so the describe lane resolves
  // the term itself; an unresolvable remainder still declines to the ordinary
  // miss below, so this only ever widens what grounds, never misroutes.
  term = term.replace(/\s+(?:thing|things|thingy|stuff)$/i, "").trim() || term;
  if (DESCRIBE_PRONOUN_RE.test(term)) {
    if (!focus?.label) return null; // no standing focus to resolve against — honest decline
    term = focus.label;
  } else {
    const rescued = await describeGrainRescue(graph, term);
    if (rescued?.label) {
      term = rescued.label;
    } else {
      // "what about the TaskController" (no grain word, just a bare article)
      // — resolveSymbol (codegraph.mjs) has no component/overlap tier at all,
      // so a leading "the"/"a"/"an" is pure noise here, safe to strip.
      term = term.replace(/^(?:the|a|an)\s+/i, "");
      // The stale-modifier residue guard, carried into this lane — the last
      // of the 1.4 family without it: "describe the old Task class" must not
      // return the Task card with "old" silently swallowed. The resolver's
      // own unplaced-words verdict decides; a term it reads fully proceeds.
      if (graph && /\s/.test(term)) {
        try {
          const { resolveObject } = await import("../domain/ask.mjs");
          const guarded = resolveObject(graph, term);
          if (guarded?.unplacedWords?.length) {
            const words = guarded.unplacedWords;
            const quoted = words.map((w) => `"${w}"`).join(" and ");
            return {
              text: `nothing matching "${term}" is in the index. ${quoted} name${words.length === 1 ? "s" : ""} nothing here, and reading past ${words.length === 1 ? "it" : "them"} would answer a different question.${guarded.nearestLabel ? ` Did you mean ${guarded.nearestLabel}?` : ""}`,
              miss: true,
            };
          }
        } catch { /* resolver unavailable — the ordinary dispatch decides */ }
      }
    }
  }
  try {
    const text = await dispatchTool("tmct_describe", { symbol: term }, { config, source, tel });
    if (!text) return null;
    // The resolved entity must reach the caller so the session's focus
    // updates too — mirrors the focus updates the ordinary ask() path does.
    const ent = await resolveEntity(graph, term);
    return { text, ent };
  } catch (e) {
    // tmct_describe answers a concept from memory/corpus facts whenever the
    // code map holds nothing for it — but dispatchTool loads the graph BEFORE
    // the handler runs, so on an empty one the handler never gets to reach its
    // own fall-through. Reach it here instead: "tell me about a dog" is a
    // question about a dog, and the code graph's emptiness is no answer to it.
    if (e?.emptyGraph) return describeFromMemoryFacts(term, config);
    return null; // unresolvable term — decline, the ordinary wall stands unchanged
  }
}

/** tmct_describe's OWN memory/corpus fall-through (tools/memory-fallthrough.mjs),
 *  called directly for a session whose code graph is empty. Same rows, same
 *  renderer, same provenance the handler itself would have cited. */
async function describeFromMemoryFacts(term, config) {
  if (!config) return null;
  try {
    const { memoryFactRows, renderMemoryDefinition } = await import("../tools/memory-fallthrough.mjs");
    const text = renderMemoryDefinition(await memoryFactRows(config), term);
    return text ? { text, ent: null } : null;
  } catch {
    return null;
  }
}

/** COMPARE — a scoped
 *  v1: "how is X different from Y", "how does X differ from Y", "compare X and
 *  Y"/"compare X with/to Y", "what's the difference between X and Y". Closed
 *  patterns, same discipline as DESCRIBE_WRAPPER_RE/DETAILED_HOW_WORKS_RE
 *  above — curated anchors, never a general "any two nouns" catch-all. Named
 *  capture groups (a/b) so compareAnswer doesn't need to know which pattern
 *  fired. Tried as a LAST-RESORT rescue (same call-site discipline as (4d)/(4e)
 *  below) since neither ask.mjs's compositional grammar nor any existing lane
 *  recognizes a two-entity comparison at all — there is nothing for this to
 *  shadow.
 *
 *  BENCHMARK_CONVERSATION_1.8.14.md item 8 (rushed-dev persona): "how is Task
 *  diff from User" / "whats the diff between TaskController and
 *  UserController" both hit the bare wall — "diff" is a common casual synonym
 *  for "different"/"difference" this table never accepted. Folded in as an
 *  additional alternation on the two patterns it naturally pairs with (never
 *  a new standalone pattern — "diff" means exactly what "different"/
 *  "difference" already mean here, so it rides the SAME two anchors). The
 *  "what's the diff between" anchor also picks up the bare no-apostrophe
 *  "whats" contraction spelling (`what(?:'s|s|\s+is)`) while here — the same
 *  tolerance MODULE_ORIENT_RE/MODULE_PURPOSE_RE's own docblock already
 *  documents elsewhere in this file — since the persona's own verbatim input
 *  used exactly that spelling. */
const COMPARE_PATTERNS = [
  /^how\s+(?:is|are)\s+(?<a>.+?)\s+(?:different|diff)\s+from\s+(?<b>.+?)$/i,
  /^how\s+do(?:es)?\s+(?<a>.+?)\s+differ\s+from\s+(?<b>.+?)$/i,
  /^how\s+are\s+(?<a>.+?)\s+and\s+(?<b>.+?)\s+different$/i,
  /^compare\s+(?<a>.+?)\s+(?:and|with|to)\s+(?<b>.+?)$/i,
  /^(?:what(?:'s|s|\s+is)\s+the\s+(?:difference|diff)\s+between|(?:difference|diff)\s+between)\s+(?<a>.+?)\s+and\s+(?<b>.+?)$/i,
];

/** Strip a leading article — resolveSymbol (codegraph.mjs) has no article
 *  tolerance of its own (same reasoning as describeGrainRescue's own strip,
 *  above): "the TaskController" never resolves where "TaskController" does. */
function stripCompareArticle(term) {
  return String(term || "").trim().replace(/^(?:the|a|an)\s+/i, "").trim();
}

/** Resolves both named entities via resolveSymbol (the SAME resolver
 *  dispatchTool("tmct_describe") uses) and renders their comparison via
 *  renderCompare (codegraph.mjs). Returns null when the query doesn't match
 *  any COMPARE_PATTERNS shape; otherwise always a real, honest answer —
 *  either the comparison or a stated reason it couldn't be done, never a
 *  guess. Loads its own graph via loadGraph when none was preloaded. */
async function compareAnswer(query, { graph, config, source }) {
  const q = String(query || "").trim().replace(/\?+$/, "").trim();
  let m = null;
  for (const re of COMPARE_PATTERNS) {
    m = q.match(re);
    if (m) break;
  }
  if (!m) return null;
  const termA = stripCompareArticle(m.groups?.a);
  const termB = stripCompareArticle(m.groups?.b);
  if (!termA || !termB) return null;
  let g = graph;
  if (!g) {
    try {
      g = await loadGraph(config, source);
    } catch {
      return null; // no graph yet — decline, the ordinary wall stands unchanged
    }
  }
  const { match: indA } = resolveSymbol(g, termA);
  const { match: indB } = resolveSymbol(g, termB);
  if (!indA || !indB) {
    const missing = !indA && !indB ? `"${termA}" and "${termB}" don't` : (!indA ? `"${termA}" doesn't` : `"${termB}" doesn't`);
    return { text: `I can't compare these — ${missing} resolve to anything in the current artifact.`, ents: [] };
  }
  if (indA.id === indB.id) {
    return { text: `"${indA.label}" and "${indB.label}" resolve to the same entity — nothing to compare.`, ents: [indA] };
  }
  const cmp = renderCompare(g, indA, indB);
  if (!cmp) {
    return {
      text: `I can only compare two entities of the SAME kind right now — "${indA.label}" is a ${classDisplayName(indA.class || "Entity")} and "${indB.label}" is a ${classDisplayName(indB.class || "Entity")}.`,
      ents: [indA, indB],
    };
  }
  return { text: cmp, ents: [indA, indB] };
}

/** DETAILED-SUMMARY / EXPLAIN-IN-DETAIL closed phrasings — "give me a detailed
 *  summary of how the task system works" / "explain in detail how X works" /
 *  "give me a detailed overview of X", wired to src/domain/completions/'s extractive
 *  multi-sentence pipeline below. Two closed shapes (DETAILED_HOW_WORKS_RE
 *  tried first, more specific); distinct from DESCRIBE_WRAPPER_RE, which
 *  neither anchors on "give me"/"explain ... in detail". The article before
 *  "detailed" and the "of" before "how" are both OPTIONAL: a non-native
 *  speaker's "give me detailed summary how this application works" carries
 *  the identical intent as the fully-articled form, and dropping either word
 *  changes nothing the pipeline downstream reads — same shape, same term. */
const DETAILED_HOW_WORKS_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?(?:give\s+me\s+(?:an?\s+)?detailed\s+(?:summary|overview|explanation)\s+(?:of\s+)?how|explain\s+(?:to\s+me\s+)?in\s+detail\s+how)\s+(.+?)\s+works\s*\??$/i;

const DETAILED_OVERVIEW_RE =
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+)?give\s+me\s+a\s+detailed\s+(?:overview|summary|explanation)\s+of\s+(.+?)\s*\??$/i;

/** THE COMPLETIONS RESCUE — wires src/domain/completions/'s extractive, cited,
 *  groundedness-checked multi-sentence pipeline (generateCompletion(),
 *  src/domain/completions/complete.mjs) into live chat dispatch. Tried in runAsk
 *  ONLY after (4d) DESCRIBE-WRAPPER RESCUE has already declined, and only for
 *  an EXPLICIT detailed/multi-sentence request (DETAILED_HOW_WORKS_RE /
 *  DETAILED_OVERVIEW_RE, above). Honest by construction: generateCompletion()
 *  itself declines whenever nothing clears its own pruning bar; this lane
 *  passes that decline straight through as null, never fabricating. */
async function completionsRescueAnswer(query, { memoryDir, graph }) {
  if (!memoryDir) return null; // no repo/memory to search — honest decline
  // Deliberately NOT applyPreambleFrames here (unlike describeWrapperAnswer):
  // its SHOW_GIVE_ME_RE frame turns ANY "give me (the)? X" into "describe X"
  // before this lane would see it, destroying this lane's own "give me a
  // detailed summary/overview of ..." anchor. This lane's own two regexes
  // already carry their own optional politeness prefix, so no separate
  // normalization pass is needed.
  const q = String(query || "").trim();
  const m = DETAILED_HOW_WORKS_RE.exec(q) || DETAILED_OVERVIEW_RE.exec(q);
  let term = m?.[1]?.trim();
  if (!term) return null;
  term = term.replace(/^(?:the|a|an)\s+/i, "").trim();
  if (!term) return null;
  // The APP-DEICTIC subject ("how this app works") names the whole program,
  // not a searchable symbol — the pipeline's best-match collapsed it to a
  // bare module name. Ground the overview on the ranked ENTRY-POINT module
  // instead: named as the way in, with its full module-grain overview.
  if (graph && /^(?:this|the)?\s*(?:app|application|codebase|project|repo|repository|system|program)$/i.test(term)) {
    try {
      const { ask } = await import("../domain/ask.mjs");
      const entry = ask(graph, "where is the entry point")?.tmct_ask?.matches?.[0];
      const ind = entry?.id ? graph.byId?.get?.(entry.id) : null;
      if (ind) {
        return { text: `the app enters at ${ind.label} — here is that module in detail:\n\n${moduleOverviewText(graph, ind)}` };
      }
    } catch { /* no entry point rankable — the ordinary pipeline below decides */ }
  }
  try {
    const { generateCompletion } = await import("./completions.mjs");
    // createCompletionsGraphAdapter wraps the SAME graph object this turn
    // already has in scope plus this repo's already-loaded Fact store, so
    // broadSearch can search live graph/memory content, not just saved
    // memory blocks.
    const { createCompletionsGraphAdapter } = await import("./completions.mjs");
    const { loadMemory } = await import("../adapters/memory/core.mjs");
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
 *  relation/edge kind ("what about imports", "tell me about contains"), or null
 *  when it isn't one. Loads the definition from the shipped
 *  corpus/seon/relations.jsonl, so it works without per-repo memory seeding.
 *  Returns { text, pending, kind } — `kind` is the resolved RELATION_TERM
 *  canonical kind, the SAME vocabulary GOAL_BY_KIND keys on. */
async function relationForceAnswer(query, envelope, { graph, config, source, templates }) {
  const rawTerm = relationTermOf(query, envelope);
  if (!rawTerm) return null;
  let composeRelation; let RELATION_TERM;
  try { ({ composeRelation, RELATION_TERM } = await import("../domain/concept.mjs")); }
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
 *  null when it isn't one. Loads the definition DIRECTLY from the shipped
 *  corpus/seon file, so it works without per-repo memory seeding; memory fact
 *  rows only ADD remembered "A is a X" examples when present. Returns { text,
 *  instances }. */
async function conceptForceAnswer(query, envelope, { graph, config, source, memoryDir, templates, cache = null }) {
  const rawTerm = conceptTermOf(query, envelope);
  if (!rawTerm) return null;
  let normFactTerm; let composeConcept; let CONCEPT_CLASS;
  try {
    ({ normFactTerm } = await import("../adapters/memory/core.mjs"));
    ({ composeConcept, CONCEPT_CLASS } = await import("../domain/concept.mjs"));
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
  const rows = memoryDir ? await factRows(memoryDir, cache) : [];
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
  // mid-word capital never occurs in plain English); adding "i" would let
  // ordinary lowercase prose words spuriously match the lowerCamelCase branch
  // too, since [A-Z] also accepts lowercase under /i.
  const tokens = String(answerText).match(new RegExp(NAME_TOKEN_RE.source, "g")) || [];
  const seen = new Set();
  for (const tok of tokens) {
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const { resolveObject } = await import("../domain/ask.mjs");
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
/** Load the taught domain for the plan lane: fact rows + rule rows compiled
 *  through src/domain.mjs. Fresh-loads memory (never the turn cache) because
 *  the caller may have just written snapshot rows this same turn. */
async function loadPlanContext(memoryDir) {
  const { loadMemory, readFactRows, readRuleRows } = await import("../adapters/memory/core.mjs");
  const { compileDomain, stateFromFacts } = await import("../domain/domain.mjs");
  const payload = await loadMemory(memoryDir);
  const factRows = readFactRows(payload);
  const ruleRows = readRuleRows(payload);
  const domain = compileDomain(factRows, ruleRows);
  const state = stateFromFacts(factRows, domain);
  return { factRows, ruleRows, domain, state };
}

/** Human label for a grounded action: name "move onto" + disk-1 + peg-c →
 *  "move disk-1 onto peg-c". */
function actionLabel(name, subject, target) {
  const sp = String(name).split(/\s+/);
  const verb = sp[0] || "move";
  const prep = sp.slice(1).join(" ") || "onto";
  return `${verb} ${subject} ${prep} ${target}`;
}

/** Which verb does a verbless locative goal ("every disk on peg-b") mean? The
 *  sentence never says, and a preposition doesn't imply one — "on" reads as
 *  rest-on, stand-on, sit-on or lie-on with equal warrant, so any prep→verb
 *  table here would be invention. The taught facts answer instead: every
 *  locative fact (LOCATIVE_FACT_PREDICATE_RE's closed predicate tail) about a
 *  member of the goal's class whose preposition is the one typed contributes
 *  its verb. Returns the candidates, sorted. Exactly one is an answer; none or
 *  several is the caller's decline. */
function goalVerbsFromTaughtFacts(factRows, domain, { universal, term, prep }) {
  const subjects = new Set(universal ? domain?.classMembers?.[term] || [] : [term]);
  const verbs = new Set();
  for (const row of factRows || []) {
    if (!LOCATIVE_FACT_PREDICATE_RE.test(row.predicate)) continue;
    if (!subjects.has(row.subject)) continue;
    const [factVerb, factPrep] = row.predicate.slice("mgx:".length).split("-");
    if (factPrep === prep) verbs.add(factVerb);
  }
  return [...verbs].sort();
}

/** Do two goal specs state the same goal? Every field is already normalized
 *  (normFactTerm on the terms, a lemma + a lowercased preposition on the
 *  predicate), so equality on the four scalars is the whole comparison. */
const sameGoalSpec = (a, b) =>
  a.universal === b.universal && a.term === b.term && a.predicate === b.predicate && a.object === b.object;

/** THE PLAN LANE — the closed goal/solve/legal-moves recognizers over the
 *  taught action rules (PLAN_HANOI's chat surface). Returns
 *  { text, via, deduced, note, plan? } or null when the query is none of the
 *  three shapes. Mutates planHolder.state (the session's plan slot). */
async function planLaneAnswer(query, { memoryDir, planHolder, sessionId = "", gameConfig = DEFAULT_GAME_CONFIG }) {
  let q = String(query).trim();
  // GOAL REVISION — "actually the goal is …", "instead, the goal is …", "the
  // goal is now …": a revision marker ahead of (or inside) a goal frame means
  // REPLACE the held goal, not accumulate beside it — restating used to pile
  // up an unsatisfiable conjunction that burned the full search.
  let goalRevision = false;
  {
    const lead = q.match(/^(?:actually|instead|no|wait|scratch\s+that|on\s+second\s+thought)[,\s]+(.+)$/i);
    if (lead && /\bgoal\b/i.test(lead[1])) { q = lead[1].trim(); goalRevision = true; }
    const now = q.match(/^the\s+(?:new\s+goal\s+is|goal\s+is\s+now)\s+(.+)$/i);
    if (now) { q = `the goal is ${now[1].trim()}`; goalRevision = true; }
  }

  // "can you move a disk onto a peg?" — read the taught action signatures back.
  // Answered HERE rather than beside the other capability readers because
  // CAN_ASK_RE would otherwise claim the query first, bind the verb to "peg",
  // find no mgx:capableOf row and miss.
  const capabilityAsk = q.match(ACTION_SIGNATURE_ASK_RE);
  if (capabilityAsk) {
    const { loadMemory, readRuleRows } = await import("../adapters/memory/core.mjs");
    const { actionFamilies, capabilityFromActionRules } = await import("../domain/router/taught.mjs");
    // The same lemma authority the teach lane mints the rule name through, so
    // either taught voicing is found by either asked voicing.
    const familyName = `${await verbLemma(capabilityAsk[1])} ${capabilityAsk[3].toLowerCase()}`;
    const subjectClass = capabilityAsk[2].toLowerCase();
    const targetClass = capabilityAsk[4].toLowerCase();
    const asked = actionLabel(familyName, `a ${subjectClass}`, `a ${targetClass}`);
    let family = null;
    try {
      family = actionFamilies(readRuleRows(await loadMemory(memoryDir))).get(familyName) || null;
    } catch { /* an unreadable store reads back like an empty one */ }
    if (!family) {
      return {
        text: `no — nothing you taught me says you can ${asked}. Teach it with "you can ${asked}."`,
        via: "plan", deduced: "check whether a taught action rule covers an action",
        note: `CAPABILITY frame — no "${familyName}" action rule in the store, honest decline`,
      };
    }
    const classesFor = (slot) =>
      capabilityFromActionRules(familyName, family).parameters.find((p) => p.name === slot)?.classes.filter(Boolean) || [];
    const subjectClasses = classesFor("subject");
    const targetClasses = classesFor("target");
    const signature = `subject: ${subjectClasses.join("|") || "?"}, target: ${targetClasses.join("|") || "?"}`;
    if (!subjectClasses.includes(subjectClass) || !targetClasses.includes(targetClass)) {
      return {
        text: `no — the "${familyName}" rule you taught me covers ${signature}, and nothing you taught me says you can ${asked}.`,
        via: "plan", deduced: "check whether a taught action rule covers an action",
        note: `CAPABILITY frame — the "${familyName}" family is taught but covers ${signature}, honest decline`,
      };
    }
    return {
      text: `yes — you can ${asked}. You taught me the "${familyName}" rule (${signature}).`,
      via: "plan", deduced: "check whether a taught action rule covers an action",
      note: `CAPABILITY frame — the taught "${familyName}" family covers ${signature}`,
    };
  }

  const thatGoal = q.match(GOAL_TEACH_RE);
  let goalMatch = thatGoal || q.match(GOAL_TEACH_INFINITIVE_RE);
  // The verbless voicing carries every capture but the verb, so it folds into
  // the frame below once the store names the verb — same spec, same
  // confirmation, same fold as its verbed twin.
  let verblessGoal = goalMatch ? null : q.match(GOAL_TEACH_VERBLESS_RE);
  // A conjunction of goal atoms ("the goal is that disk-1 rests on peg-b and
  // disk-3 rests on peg-c") — every conjunct must compile, else the single-goal
  // frames (and their honest declines) keep their turn.
  let conjunctMatches = null;
  if (!goalMatch && !verblessGoal) {
    const conj = q.match(GOAL_TEACH_CONJUNCTION_RE);
    if (conj && /\s+and\s+/i.test(conj[1])) {
      const parts = conj[1].split(/\s+and\s+/i).map((p) => p.trim());
      const matched = parts.map((p) => p.match(GOAL_CONJUNCT_RE));
      if (parts.length > 1 && matched.every(Boolean)) conjunctMatches = matched;
    }
  }
  // The imperative voicing ("get all the disks onto peg-c") and the bare-NP
  // voicing ("the goal is all disks on peg-c") fold into the same verbless
  // resolution: singularize the class term ("disks"→"disk"), read the
  // universal off the quantifier, and normalize the motion preposition to the
  // static one a location fact is stored under ("onto"→"on").
  if (!goalMatch && !verblessGoal && !conjunctMatches) {
    const bare = q.match(GOAL_TEACH_NP_RE) || q.match(GOAL_TEACH_IMPERATIVE_RE);
    if (bare) {
      const prep = { onto: "on", into: "in", upon: "on" }[bare[3].toLowerCase()] ?? bare[3].toLowerCase();
      verblessGoal = [bare[0], bare[1] ? "every" : "", singularizeSurface(bare[2]), prep, bare[4]];
    }
  }
  if (verblessGoal) {
    const { normFactTerm } = await import("../adapters/memory/core.mjs");
    const { factRows, domain } = await loadPlanContext(memoryDir);
    const prep = verblessGoal[3].toLowerCase();
    const quantified = `${verblessGoal[1] ? `${verblessGoal[1].toLowerCase()} ` : ""}${verblessGoal[2].toLowerCase()}`;
    const stated = `${quantified} ${prep} ${verblessGoal[4].toLowerCase()}`;
    const verbs = goalVerbsFromTaughtFacts(factRows, domain, {
      universal: !!verblessGoal[1], term: normFactTerm(verblessGoal[2]), prep,
    });
    if (verbs.length !== 1) {
      return {
        text: verbs.length
          ? `"${stated}" leaves the verb out, and what you taught me leaves it open — ${verbs.map((v) => `"${v} ${prep}"`).join(" and ")} both fit. Say which one, e.g. "i want ${quantified} to ${verbs[0]} ${prep} ${verblessGoal[4].toLowerCase()}".`
          : `"${stated}" leaves the verb out, and nothing you taught me says what ${quantified} does ${prep} anything. Name the verb, e.g. "the goal is that every disk rests on peg-c".`,
        via: "plan", deduced: "record the goal state for a later plan",
        note: `GOAL frame — the verbless voicing's "${prep}" matched ${verbs.length} taught locative verbs, honest decline`,
      };
    }
    goalMatch = [verblessGoal[0], verblessGoal[1], verblessGoal[2], verbs[0], verblessGoal[3], verblessGoal[4]];
  }
  if (goalMatch || conjunctMatches) {
    const { normFactTerm } = await import("../adapters/memory/core.mjs");
    const items = conjunctMatches ?? [goalMatch];
    const specs = [];
    const tails = [];
    for (const m of items) {
      const verb = await verbLemma(m[3]);
      if (!verb) {
        return {
          text: `I can't reduce "${m[3]}" to a verb for that goal — try the plain form (e.g. "rests").`,
          via: "plan", deduced: "record the goal state for a later plan", note: "GOAL frame — verb lemma unavailable, honest decline",
        };
      }
      specs.push({
        universal: !!m[1],
        term: normFactTerm(m[2]),
        predicate: `${verb}-${m[4].toLowerCase()}`,
        object: normFactTerm(m[5]),
      });
      // A conjunct restates itself; the that-form keeps its own words; the
      // infinitive/verbless voicings restate as the that-form, so the goal
      // check's own "done — …" line and the confirmation read identically.
      tails.push(conjunctMatches
        ? `${m[1] ? `${m[1].toLowerCase()} ` : ""}${m[2].toLowerCase()} ${m[3].toLowerCase()} ${m[4].toLowerCase()} ${m[5].toLowerCase()}`
        : (thatGoal
          ? q.replace(/^the\s+goal\s+is\s+that\s+/i, "").replace(/[.!?]+$/, "")
          : `${m[1] ? `${m[1].toLowerCase()} ` : ""}${m[2].toLowerCase()} ${verb}s ${m[4].toLowerCase()} ${m[5].toLowerCase()}`));
    }
    const prev = !goalRevision && planHolder.state && Array.isArray(planHolder.state.goals) && !planHolder.state.done ? planHolder.state : null;
    const replaced = goalRevision && planHolder.state?.goalTexts?.length ? planHolder.state.goalTexts.join("; ") : null;
    // Restating a goal you already set is one goal, not two. The spec is four
    // normalized scalars, so the same goal in either voicing ("the goal is
    // that …" / "the goal is to …") compiles to the identical object and a
    // deep-equal catches it. Folded in the STORE, not at the read: deduping in
    // "solve it" would leave the duplicate sitting in planHolder.state and
    // leave "(N goals held)" saying something untrue.
    //
    // goals and goalTexts move in LOCKSTEP — "solve it" joins goalTexts by
    // index to describe the specs it compiled, so dropping one without the
    // other misaligns the plan's own account of what it is solving for.
    let heldGoals = prev?.goals ?? [];
    let heldTexts = prev?.goalTexts ?? [];
    let added = 0;
    for (let i = 0; i < specs.length; i += 1) {
      if (heldGoals.some((g) => sameGoalSpec(g, specs[i]))) continue;
      heldGoals = [...heldGoals, specs[i]];
      heldTexts = [...heldTexts, tails[i]];
      added += 1;
    }
    planHolder.state = {
      goals: heldGoals, goalTexts: heldTexts,
      actions: null, states: null, stepGoals: null, cursor: 0, done: false,
    };
    const n = heldGoals.length;
    const replacedClause = replaced ? ` (replacing the earlier goal: ${replaced})` : "";
    return {
      text: `${added ? "noted" : "already noted"} — the goal is that ${tails.join(" and ")}${replacedClause}.${n > 1 ? ` (${n} goals held)` : ""} Say "solve it" when the state is taught.`,
      via: "plan", lane: "goal", deduced: "record the goal state for a later plan",
      note: added
        ? `GOAL frame — ${added === 1 ? "goal spec" : `${added} goal specs`} ${replaced ? "REPLACED the held goal (revision marker)" : "accumulated on the session plan slot"}`
        : "GOAL frame — the same goal spec was already held, so it folded onto the existing one",
    };
  }

  const wantsSolve = PLAN_SOLVE_RE.test(q);
  const wantsLegal = LEGAL_MOVES_RE.test(q);
  if (!wantsSolve && !wantsLegal) return null;
  if (wantsSolve) return solveHeldGoals({ memoryDir, planHolder, gameConfig });

  // "what moves are legal now" — one ply off the current board, no search.
  let ctx;
  try {
    ctx = await loadPlanContext(memoryDir);
  } catch (err) {
    return { text: `I can't read the taught domain: ${err?.message ?? err}`, via: "plan", deduced: "plan a move sequence", note: "plan lane — domain load failed" };
  }
  const { domain, state } = ctx;
  if (!domain.actions.length) {
    return {
      text: `no action rules taught yet — teach the game first (e.g. "you can move a disk onto a peg").`,
      via: "plan", deduced: "plan a move sequence (no action rules yet)", note: "plan lane — honest decline: no action rules",
    };
  }
  if (!state.length) {
    return {
      text: `no current state taught yet — state the board first (e.g. "disk-1 rests on peg-a").`,
      via: "plan", deduced: "plan a move sequence (no state yet)", note: "plan lane — honest decline: empty state",
    };
  }
  const { movesFromRules, PlanBudgetError } = await import("../domain/domain.mjs");
  let moves;
  try {
    moves = movesFromRules(state, domain, { scope: "taught" });
  } catch (err) {
    if (err instanceof PlanBudgetError) {
      return { text: `too many possible moves to enumerate here (${err.message}) — narrow the classes involved.`, via: "plan", deduced: "list the legal moves (budget exceeded)", note: "plan lane — budget decline" };
    }
    throw err;
  }
  if (!moves.length) {
    return { text: "no legal moves from the current state.", via: "plan", deduced: "list the legal moves (none)", note: "plan lane — legal moves: none" };
  }
  const lines = moves.map((m, i) => `  ${i + 1}. ${actionLabel(m.action.name, m.action.subject, m.action.target)}`);
  return {
    text: `${moves.length} legal move${moves.length === 1 ? "" : "s"} from here:\n${lines.join("\n")}`,
    via: "plan", deduced: "list the legal moves from the current state",
    note: "plan lane — movesFromRules over the current snapshot, one ply, no search",
  };
}

/** Search the taught rules for a shortest sequence to the held goal(s) from the
 *  CURRENT board fold (the newest @stepK snapshot, else the taught board).
 *  Mints the plan onto planHolder.state and returns the plan-found reply on
 *  success; on any missing precondition or an unreachable goal it returns the
 *  matching honest decline and leaves planHolder.state untouched. Shared by the
 *  plan lane's "solve it" and by the two drift sites that re-search after the
 *  board moves under a live plan. */
async function solveHeldGoals({ memoryDir, planHolder, gameConfig = DEFAULT_GAME_CONFIG }) {
  let ctx;
  try {
    ctx = await loadPlanContext(memoryDir);
  } catch (err) {
    return { text: `I can't read the taught domain: ${err?.message ?? err}`, via: "plan", deduced: "plan a move sequence", note: "plan lane — domain load failed" };
  }
  const { domain, state, factRows } = ctx;
  if (!domain.actions.length) {
    return {
      text: `no action rules taught yet — teach the game first (e.g. "you can move a disk onto a peg").`,
      via: "plan", deduced: "plan a move sequence (no action rules yet)", note: "plan lane — honest decline: no action rules",
    };
  }
  if (!state.length) {
    return {
      text: `no current state taught yet — state the board first (e.g. "disk-1 rests on peg-a").`,
      via: "plan", deduced: "plan a move sequence (no state yet)", note: "plan lane — honest decline: empty state",
    };
  }
  const { movesFromRules, stateKeyFor, compileGoal, PlanBudgetError, maxSnapshotStep } = await import("../domain/domain.mjs");
  if (!planHolder.state?.goals?.length) {
    return {
      text: `no goal set yet — teach one first (e.g. "the goal is that every disk rests on peg-c").`,
      via: "plan", deduced: "plan a move sequence (no goal yet)", note: "plan lane — honest decline: no goal",
    };
  }
  const goals = planHolder.state.goals;
  const goalText = planHolder.state.goalTexts.join("; ");
  // A goal naming a term the board and the taught classes have never heard of
  // ("peg-z") can never be reached — decline by name BEFORE the search, so an
  // unknown token is a named miss rather than a full-depth search burn.
  const knownTerms = new Set([
    ...Object.keys(domain.classMembers || {}),
    ...Object.values(domain.classMembers || {}).flat(),
    ...state.flatMap((r) => [r.subject, r.object]),
  ]);
  const unknownGoalTerms = [...new Set(goals.flatMap((g) => [g.term, g.object]))]
    .filter((t) => t && !knownTerms.has(t));
  if (unknownGoalTerms.length) {
    const quoted = unknownGoalTerms.map((t) => `"${t}"`).join(" and ");
    return {
      text: `I can't plan toward that goal — ${quoted} name${unknownGoalTerms.length === 1 ? "s" : ""} nothing the board or the taught classes know. Teach ${unknownGoalTerms.length === 1 ? "it" : "them"} first (e.g. "${unknownGoalTerms[0]} is a peg").`,
      via: "plan", deduced: "plan a move sequence (unknown goal term)",
      note: "plan lane — honest decline: the goal names an untaught term, search never started",
    };
  }
  // An UNSATISFIABLE conjunction — two held goals put the same subject (or
  // the same universal class) in two different places under one predicate —
  // is named BEFORE the search, so it never burns the full move budget just
  // to report "no plan found".
  {
    const texts = planHolder.state.goalTexts || [];
    for (let i = 0; i < goals.length; i += 1) {
      for (let j = i + 1; j < goals.length; j += 1) {
        const a = goals[i];
        const b = goals[j];
        if (a.universal === b.universal && a.term === b.term && a.predicate === b.predicate && a.object !== b.object) {
          return {
            text: `those goals can't both hold — "${texts[i] ?? `${a.term} … ${a.object}`}" and "${texts[j] ?? `${b.term} … ${b.object}`}" put the same thing in two places, so no plan exists and I won't search for one. Say "forget the goal", then state the goal you mean.`,
            via: "plan", deduced: "plan a move sequence (unsatisfiable goal conjunction)",
            note: "plan lane — honest decline: conflicting goal atoms named before the search",
          };
        }
      }
    }
  }
  // A CONTRADICTORY taught board — one piece placed in two places by the base
  // facts — makes every "shortest" claim depend on which placement you
  // resolve, so it is flagged before planning rather than silently read.
  {
    const placements = new Map();
    for (const r of state) {
      const key = `${r.subject} ${r.predicate}`;
      if (!placements.has(key)) placements.set(key, new Set());
      placements.get(key).add(r.object);
    }
    const clashes = [...placements.entries()].filter(([, objs]) => objs.size > 1);
    if (clashes.length) {
      const shown = clashes.map(([key, objs]) => {
        const [subj, pred] = key.split(" ");
        return [...objs].map((o) => `${subj} ${predicatePhrase(pred)} ${o}`).join(" AND ");
      }).join("; ");
      return {
        text: `the taught board contradicts itself — ${shown}. A shortest plan depends on which placement is real, so I won't pick one. Say "forget that <the wrong placement>" (e.g. "forget that ${clashes[0][0].split(" ")[0]} ${predicatePhrase(clashes[0][0].split(" ")[1])} ${[...clashes[0][1]][1]}"), then "solve it" again.`,
        via: "plan", deduced: "plan a move sequence (contradictory board)",
        note: "plan lane — honest decline: contradictory placements flagged before planning",
      };
    }
  }
  let isGoal;
  try {
    isGoal = compileGoal(goals, domain, { scope: "taught" });
  } catch (err) {
    return { text: `I can't compile that goal: ${err?.message ?? err}`, via: "plan", deduced: "plan a move sequence (uncompilable goal)", note: "plan lane — goal compile decline" };
  }
  const { findActionPath } = await import("../domain/planning.mjs");
  const maxDepth = gameConfig?.planning?.maxDepth ?? DEFAULT_GAME_CONFIG.planning.maxDepth;
  let found;
  try {
    found = findActionPath(state, isGoal, (s) => movesFromRules(s, domain, { scope: "taught" }), { maxDepth, stateKey: stateKeyFor });
  } catch (err) {
    if (err instanceof PlanBudgetError) {
      return { text: `the search space is too large (${err.message}) — narrow the classes involved.`, via: "plan", deduced: "plan a move sequence (budget exceeded)", note: "plan lane — budget decline" };
    }
    throw err;
  }
  if (!found) {
    return {
      text: `no plan found within ${maxDepth} moves from the current state to: ${goalText}.`,
      via: "plan", deduced: "plan a move sequence (no path)", note: "plan lane — honest miss: findActionPath returned null",
    };
  }
  const n = found.actions.length;
  const actions = found.actions.map((a) => ({
    name: a.name, subject: a.subject, target: a.target,
    label: actionLabel(a.name, a.subject, a.target),
  }));
  const stepGoals = actions.map((a, i) =>
    `${a.label} (step ${i + 1} of ${n}, working toward: ${goalText})`);
  const renderHints = {};
  const ordering = [];
  for (const r of factRows) {
    if (r.predicate === "mgx:rendersAs") renderHints[r.subject] = r.object;
    else if (/-than$/.test(r.predicate)) ordering.push({ subject: r.subject, predicate: r.predicate, object: r.object });
  }
  const plan = {
    actions, states: found.states, stepGoals,
    goal: { text: goalText, specs: goals },
    domain: { classMembers: domain.classMembers, ordering, renderHints },
  };
  const ruleNames = [...new Set(domain.actions.map((a) => a.name))].join('", "');
  // Stored on the plan slot (not just printed once) so a direct follow-up
  // ("why is that the shortest solution?") can re-display the SAME reason
  // instead of an honest miss — see PLAN_WHY_SHORTEST_RE's own call site.
  const becauseText = `you taught me the "${ruleNames}" rule${domain.actions.length === 1 ? "" : "s"}`
    + `${ordering.length ? ` and ${ordering.length} ordering fact${ordering.length === 1 ? "" : "s"}` : ""}.`;
  // The snapshot layer a fresh plan's step writes stack ABOVE: 0 on an
  // untouched board, K after a prior plan left @stepK rows standing. Without it
  // a replan's step 1 would write @step1 below the standing @stepK layer and be
  // read as stale by stateFromFacts (which prefers the newest snapshot).
  const stepBase = maxSnapshotStep(factRows, domain);
  planHolder.state = {
    ...planHolder.state, actions, states: found.states, stepGoals, cursor: 0, done: false, goalText, becauseText, stepBase,
  };
  const moveLines = actions.map((a, i) => `  ${i + 1}. ${a.label}`);
  // A piece with no taught position is an ASSUMPTION the plan silently makes
  // (it reads the board as taught, without that piece) — said out loud with
  // the plan rather than left implicit. Covers every piece a plan STEP
  // touches, not just the goal-named ones ("move disk-1 onto disk-3" with
  // disk-3 never placed is the same silent gap-fill). Scoped to pieces whose
  // CLASS has at least one positioned member, so a peg — whose class never
  // takes a position — is not "unplaced".
  const goalPieces = [...new Set(goals.flatMap((g) => (g.universal ? (domain.classMembers?.[g.term] || []) : [g.term])))];
  const touchedPieces = [...new Set(actions.flatMap((a) => [a.subject, a.target]))];
  const classOfPiece = (p) => Object.keys(domain.classMembers || {}).find((cls) => (domain.classMembers[cls] || []).includes(p));
  const positionedClasses = new Set(state.map((r) => classOfPiece(r.subject)).filter(Boolean));
  const unplacedPieces = [...new Set([...goalPieces, ...touchedPieces])]
    .filter((p) => !state.some((r) => r.subject === p))
    .filter((p) => positionedClasses.has(classOfPiece(p)));
  const assumptionNote = unplacedPieces.length
    ? `\n\nnote — ${unplacedPieces.join(" and ")} ha${unplacedPieces.length === 1 ? "s" : "ve"} no taught position, so this plan reads the board without ${unplacedPieces.length === 1 ? "it" : "them"}. Teach the missing position(s) and solve again if that's wrong.`
    : "";
  const text = n === 0
    ? `the goal already holds — nothing to do.${assumptionNote}`
    : `plan found — ${n} move${n === 1 ? "" : "s"} (shortest):\n${moveLines.join("\n")}\n\n` +
      `because — ${becauseText} ` +
      `Say "next" to make move 1, or ask "what moves are legal now".${assumptionNote}`;
  return {
    text, via: "plan", lane: "imperative",
    deduced: `plan a move sequence from the current state to the goal (${n} move${n === 1 ? "" : "s"})`,
    note: "plan lane — compileDomain + findActionPath over the taught rules; plan held on the session slot",
    plan,
  };
}

/** Execute the active plan's next move: append the successor snapshot's rows
 *  as @stepK facts, advance the cursor, and on the final step re-read the
 *  store and confirm the goal from the WRITTEN facts (never assumed). */
async function executePlanStep(planHolder, { memoryDir, sessionId = "", gameConfig = DEFAULT_GAME_CONFIG }) {
  const ps = planHolder.state;
  const k = ps.cursor + 1;
  // The snapshot index the board rows are written under: it stacks above any
  // layer standing when the plan was minted (stepBase), while k stays the plan's
  // own 1-of-N move counter. On a fresh board stepBase is 0 and snap === k.
  const snap = (ps.stepBase ?? 0) + k;
  const action = ps.actions[ps.cursor];
  const rows = ps.states[k];
  const { appendFact, loadMemory, readFactRows } = await import("../adapters/memory/core.mjs");
  for (const row of rows) {
    await appendFact(memoryDir, {
      subject: `${row.subject}@step${snap}`, predicate: row.predicate, object: row.object,
      provenance: `plan:${sessionId || "chat"}:step${snap}`,
    });
  }
  planHolder.state = { ...ps, cursor: k };
  const boardLine = rows.map((r) => `${r.subject} ${predicatePhrase(r.predicate)} ${r.object}`).join("; ");
  if (k < ps.actions.length) {
    return {
      text: `moved — ${action.label} (step ${k} of ${ps.actions.length}). board@step${snap}: ${boardLine}`,
      deduced: ps.stepGoals[k] ? ps.stepGoals[k] : `continue the plan (step ${k + 1} of ${ps.actions.length})`,
    };
  }
  // Final step: confirm the goal against the store, from the written facts.
  const { compileDomain, stateFromFacts, compileGoal } = await import("../domain/domain.mjs");
  const { readRuleRows } = await import("../adapters/memory/core.mjs");
  const payload = await loadMemory(memoryDir);
  const factRows = readFactRows(payload);
  const domain = compileDomain(factRows, readRuleRows(payload));
  const finalState = stateFromFacts(factRows, domain);
  const holds = compileGoal(ps.goals, domain, { scope: "taught" })(finalState);
  const movedLine = `moved — ${action.label} (step ${k} of ${ps.actions.length}). board@step${snap}: ${boardLine}`;
  if (holds) {
    planHolder.state = { ...planHolder.state, done: true };
    return {
      text: `${movedLine}\n\ndone — ${ps.goalText} (checked against board@step${snap}'s written facts, not assumed).`,
      deduced: `goal reached — ${ps.goalText} (${k} of ${k} steps)`,
    };
  }
  // The final board doesn't reach the goal — the plan or the board drifted.
  // Before settling for the miss, re-search from the board as it now stands: a
  // found plan is disclosed and held (never a silent success), a miss keeps the
  // honest failure and names the failed replan.
  const replan = await solveHeldGoals({ memoryDir, planHolder, gameConfig });
  if (replan.plan) {
    const moves = replan.plan.actions.map((a, i) => `${i + 1}. ${a.label}`).join("; ");
    return {
      text: `${movedLine}\n\nBUT the goal does NOT hold against the written facts — the state drifted, so I replanned from board@step${snap}: ${moves}. Say "next" to continue.`,
      deduced: "plan finished but the goal check failed — replanned from the drifted board",
    };
  }
  const maxDepth = gameConfig?.planning?.maxDepth ?? DEFAULT_GAME_CONFIG.planning.maxDepth;
  planHolder.state = { ...planHolder.state, done: true };
  return {
    text: `${movedLine}\n\nBUT the goal does NOT hold against the written facts — the plan or the state drifted; re-teach the state and solve again — I looked for a new plan from board@step${snap} and found none within ${maxDepth} moves.`,
    deduced: "plan finished but the goal check failed",
  };
}

/** Plan follow-up questions ("what is the next move", "how many moves", "why
 *  that move") answered off the ACTIVE plan, and board-state questions ("is X
 *  clear", "what rests on X", "where is X") answered off the CURRENT board (the
 *  latest @stepK snapshot, or the taught board before any step). Returns
 *  { text, deduced, note } or null — null when the query is neither shape, or
 *  when no plan/board stands to answer from, so an honest miss stands cold.
 *  This keeps a read from contradicting the plan's own board@stepK line: after
 *  "next" moves a piece, "what rests on X" reflects the snapshot, not the stale
 *  pre-plan facts. Clearness is derived, never stored — a piece is clear iff
 *  nothing rests on it on the current board. */
async function planFollowUpAnswer(query, { memoryDir, planHolder, pendingPager = false }) {
  const q = String(query).trim();
  const ps = planHolder?.state;
  const activePlan = ps && Array.isArray(ps.actions) && ps.actions.length;

  // PLAN-NAVIGATION GESTURES — routed, honest replies while a plan (or a
  // held goal) stands, so the orientation blurb never fronts a mid-plan
  // turn. With nothing standing these return null and a cold "undo" keeps
  // its ordinary path.
  if (PLAN_UNDO_RE.test(q)) {
    if (!activePlan) return null;
    const k = ps.cursor;
    const board = k > 0 ? `the board stands at board@step${k}` : "no move has been made yet";
    return {
      text: `there's no undo — each move wrote a board@step snapshot and I don't unwind them. ${board}. Say "solve it" to replan from the current board, or "forget the goal" to drop the plan.`,
      deduced: "unwind a plan move (not supported — honest decline)",
      note: "PLAN FOLLOW-UP — undo/go-back gesture named the snapshot model instead of the blurb",
    };
  }
  if (PLAN_FORGET_GOAL_RE.test(q)) {
    if (!ps || !(ps.goals?.length || activePlan)) return null;
    const held = ps.goalTexts?.length ? ` (${ps.goalTexts.join("; ")})` : "";
    planHolder.state = null;
    return {
      text: `forgotten — the goal${held} and its plan are dropped. The taught board facts stay; set a new goal with "the goal is that …".`,
      deduced: "drop the held goal and plan",
      note: "PLAN FOLLOW-UP — forget-the-goal cleared the session plan slot",
    };
  }
  if (PLAN_NEXT_RE.test(q) && ps?.done && Array.isArray(ps.actions) && ps.actions.length && !pendingPager) {
    return {
      text: `the plan is complete — all ${ps.actions.length} moves are made and the goal was checked against the written board. Teach a new goal ("the goal is that …") to plan again.`,
      deduced: "continue a plan that is already complete (honest decline)",
      note: "PLAN FOLLOW-UP — next-after-done answered from the finished plan instead of the blurb",
    };
  }

  if (PLAN_GOAL_READBACK_RE.test(q)) {
    if (!ps || !(ps.goalTexts?.length || ps.goals?.length)) return null;
    const goalText = ps.goalTexts?.length ? ps.goalTexts.join("; ") : "the goal you set";
    const status = activePlan
      ? ` A plan is ready — ${ps.actions.length} move${ps.actions.length === 1 ? "" : "s"}; say "next" to step through it.`
      : ' Say "solve it" when the board is taught.';
    return {
      text: `the goal is that ${goalText}.${status}`,
      deduced: "read back the held goal",
      note: "PLAN FOLLOW-UP — goal read-back from the held planState",
    };
  }
  if (PLAN_WHAT_NEXT_RE.test(q)) {
    if (!activePlan) return null;
    if (ps.done || ps.cursor >= ps.actions.length) {
      return { text: `the plan is complete — all ${ps.actions.length} moves are made.`, deduced: "name the next planned move (plan complete)", note: "PLAN FOLLOW-UP — next move: plan already complete" };
    }
    return { text: `the next move is move ${ps.cursor + 1} of ${ps.actions.length}: ${ps.actions[ps.cursor].label}. Say "next" to make it.`, deduced: "name the next planned move", note: "PLAN FOLLOW-UP — next move read from the active plan" };
  }
  if (PLAN_MOVE_COUNT_RE.test(q)) {
    if (!activePlan) return null;
    const total = ps.actions.length;
    const remaining = Math.max(0, total - ps.cursor);
    return { text: remaining === total ? `${total} move${total === 1 ? "" : "s"} in the plan.` : `${total} move${total === 1 ? "" : "s"} in the plan, ${remaining} still to make.`, deduced: "count the moves in the active plan", note: "PLAN FOLLOW-UP — move count from the active plan" };
  }
  if (PLAN_OPTIMALITY_CONFIRM_RE.test(q)) {
    if (!activePlan) return null;
    const total = ps.actions.length;
    return {
      text: `yes — ${total} move${total === 1 ? "" : "s"} is the minimum: the plan search is a breadth-first search over every legal move from the current state, so it always finds the shortest path first. No shorter plan exists from where it started.`,
      deduced: "confirm the plan's own optimality claim",
      note: "PLAN FOLLOW-UP — optimality confirmed from the BFS search's own guarantee, not a guess",
    };
  }
  if (PLAN_WHY_SHORTEST_RE.test(q)) {
    if (!activePlan || !ps.becauseText) return null;
    return {
      text: `because — ${ps.becauseText}`,
      deduced: "explain why the plan is the shortest (re-display the solve-time reason)",
      note: "PLAN FOLLOW-UP — the because-line already printed at solve time, re-displayed on direct follow-up",
    };
  }
  if (PLAN_WHY_MOVE_RE.test(q)) {
    if (!activePlan) return null;
    const idx = ps.cursor < ps.actions.length ? ps.cursor : ps.actions.length - 1;
    const line = ps.stepGoals?.[idx] ?? `${ps.actions[idx].label} (step ${idx + 1} of ${ps.actions.length})`;
    return { text: `${line} — it is this step's move on the shortest path.`, deduced: "explain the next planned move", note: "PLAN FOLLOW-UP — why-move from the active plan's step goals" };
  }

  const clear = q.match(IS_CLEAR_RE);
  const rev = clear ? null : q.match(BOARD_REVERSE_LOC_RE);
  const fwd = clear || rev ? null : q.match(BOARD_FORWARD_LOC_RE);
  const whereEvery = clear || rev || fwd ? null : q.match(BOARD_WHERE_EVERY_RE);
  const where = clear || rev || fwd || whereEvery ? null
    : (q.match(BOARD_WHERE_RE) || q.match(BOARD_WHERE_DOES_RE));
  if (!clear && !rev && !fwd && !where && !whereEvery) return null;
  if (!memoryDir) return null;

  let ctx;
  try { ctx = await loadPlanContext(memoryDir); } catch { return null; }
  const { domain, state } = ctx;
  if (!domain.actions.length || !state.length) return null; // no board — the honest miss stands
  const { normFactTerm } = await import("../adapters/memory/core.mjs");
  const individuals = new Set(Object.values(domain.classMembers || {}).flat());

  if (clear) {
    const x = normFactTerm(clear[1]);
    if (!individuals.has(x)) return null;
    const on = state.filter((r) => r.object === x);
    return on.length
      ? { text: `no — ${x} is not clear: ${on.map(factPhrase).join("; ")}.`, deduced: "check whether a board piece is clear", note: "BOARD — clearness derived from the current board (a piece rests on it)" }
      : { text: `yes — ${x} is clear: nothing rests on it on the current board.`, deduced: "check whether a board piece is clear", note: "BOARD — clearness derived from the current board (nothing rests on it)" };
  }
  if (whereEvery) {
    const cls = normFactTerm(singularizeSurface(whereEvery[1]));
    const members = domain.classMembers?.[cls] || [];
    if (!members.length) return null; // not a taught class — the ordinary readers decide
    const lines = members.map((mbr) => {
      const rows = state.filter((r) => r.subject === mbr);
      return rows.length ? rows.map(factPhrase).join("; ") : `nothing on the current board says where ${mbr} is`;
    });
    return {
      text: lines.join("\n"),
      deduced: "read the current board (where every member of a class is)",
      note: "BOARD — forward locative for every member of the taught class",
    };
  }
  if (where || fwd) {
    const x = normFactTerm((where ?? fwd)[1]);
    if (!individuals.has(x)) return null;
    const rows = state.filter((r) => r.subject === x);
    if (!rows.length) return where
      ? { text: `nothing on the current board says where ${x} is.`, deduced: "read the current board (where a piece is)", note: "BOARD — forward locative, no row for the piece" }
      : null; // a verb-specific forward miss falls to the ordinary reader
    return { text: rows.map(factPhrase).join("; "), deduced: "read the current board (where a piece is)", note: "BOARD — forward locative from the current board" };
  }
  // reverse: "what rests on X" / "what is on X"
  const verb = rev[1].toLowerCase();
  const prep = rev[2].toLowerCase();
  const x = normFactTerm(rev[3].replace(/^(?:an?|the)\s+/i, "").trim());
  if (!individuals.has(x)) return null;
  const copula = /^(?:is|are|'s)$/.test(verb);
  let predicate = null;
  if (!copula) {
    predicate = await generalVerbPredicate(verb);
    if (/^mgx:[a-z]+$/.test(predicate)) predicate = `${predicate}-${prep}`;
  }
  const hits = state.filter((r) => r.object === x && (copula || r.predicate === predicate));
  const emptyPhrase = predicate ? predicatePhrase(predicate) : "is on";
  return hits.length
    ? { text: hits.map(factPhrase).join("; "), deduced: "read the current board (what rests on a piece)", note: "BOARD — reverse locative from the current board" }
    : { text: `nothing ${emptyPhrase} ${x} on the current board.`, deduced: "read the current board (what rests on a piece)", note: "BOARD — reverse locative, nothing on the current board" };
}

/** "what was X called/named before" and its siblings — a name-HISTORY ask.
 *  The index records current names only, so the whole family declines by
 *  name (mirrors the guarded "renamed X" adjective — the verb slipped). */
const RENAME_HISTORY_RE = /^what\s+(?:was|were)\s+(.+?)\s+(?:called|named|known\s+as)\s+(?:before|previously|originally|earlier|at\s+first)[?.!\s]*$|^what\s+did\s+(.+?)\s+use(?:d)?\s+to\s+be\s+(?:called|named)[?.!\s]*$/i;

/** "what do the handlers import" — a COLLECTIVE plural subject naming a
 *  module GROUP (a directory/path component), not a single module. The
 *  resolver's best-match tiers read "handlers" as one module and answer for
 *  it alone, silently — a wrong set with no disclosure. The closed verb set
 *  mirrors the forward relations; a plural that names a graph KIND
 *  (modules/classes/…) stays with the engine's own kind-level reading. */
const COLLECTIVE_FORWARD_RE = /^what\s+(?:do|does)\s+the\s+([a-z][\w-]*s)\s+(import|call|use|export|touch|test|define|contain)s?[?.!\s]*$/i;

/** Decision-recall — "remind me what we decided about X", "what did we agree
 *  on about X": a question about the CONVERSATION's record, so it belongs to
 *  the session-recall surface, never the definition locator ("decided" used
 *  to be read-as-rewritten into "defined"). */
const DECISION_RECALL_RE = /^(?:remind\s+me\s+)?what\s+(?:did\s+)?(?:we|i|you)\s+(?:decided?|agreed?(?:\s+on)?|settled?(?:\s+on)?|concluded?)\s+(?:about|on|regarding|for)\s+(?:the\s+)?(.+?)[?.!\s]*$/i;

/** "where did X move to" — a move-HISTORY ask, sibling of RENAME_HISTORY_RE:
 *  the index records current locations only, so the premise is named rather
 *  than silently accepted alongside the current location. */
const MOVE_HISTORY_RE = /^where\s+did\s+(.+?)\s+(?:move|get\s+moved|go)(?:\s+to)?[?.!\s]*$/i;

/** "was that before logger.mjs was touched" — a singular bindable form, a
 *  comparison word, and an embedded passive clause. The closed participle set
 *  is the touch family the when-question path answers; anything else keeps
 *  the honest miss. */
const TEMPORAL_COMPARISON_RE = /^(?:was|is)\s+(this one|that one|it|this|that)\s+(before|after)\s+(.+?)\s+(?:was|were)\s+(touched|changed|modified|edited|updated)[?.!\s]*$/i;

/** ARCHITECTURE-OVERVIEW intent — "show me the architecture", "what is the
 *  architecture of this repo": the whole-repo map the /arch command renders.
 *  A closed phrase set, because the literal word "architecture" is also a
 *  plausible SYMBOL substring in many graphs (renderArchitecture,
 *  tmct_architecture) — the symbol-describe rescues would otherwise resolve
 *  the word to one such symbol and dump its definition card instead of the
 *  map. Every phrasing here names the architecture as a TOPIC (an article,
 *  an of-this-repo tail, or an overview/map noun); a query that NAMES a
 *  symbol ("describe renderArchitecture") never matches. */
const ARCH_OVERVIEW_LEAD = "(?:(?:can|could|would)\\s+you\\s+(?:please\\s+)?)?(?:(?:show|give)\\s+(?:me|us)\\s+|describe\\s+|explain\\s+|what(?:'s|s|\\s+is)\\s+)?";
const ARCH_OVERVIEW_TAIL = "(?:\\s+(?:of|for)\\s+(?:this|the)\\s+(?:app|codebase|repo|repository|project|code))?";
const ARCH_OVERVIEW_PHRASES = [
  // Article-carried: "the architecture" alone, or wrapped/tailed.
  new RegExp(`^${ARCH_OVERVIEW_LEAD}the\\s+architecture(?:\\s+(?:overview|map|diagram))?${ARCH_OVERVIEW_TAIL}(?:\\s+here)?\\??$`, "i"),
  // Article-less: anchored by the of-this-repo tail or the overview/map noun instead.
  new RegExp(`^${ARCH_OVERVIEW_LEAD}architecture\\s+(?:(?:of|for)\\s+(?:this|the)\\s+(?:app|codebase|repo|repository|project|code)|overview|map|diagram)\\??$`, "i"),
];

async function runAsk(query, { config, source, graph, focus, last, templates, memoryDir, sessionId = "", lexicon = null, env, trace, vocabHint = null, tel = null, biasByBundle = {}, cache = null, vocabAntecedent = null, planHolder = null, discourseHolder = null, gameConfig = DEFAULT_GAME_CONFIG, liveReference = false, onLiveLookup = null, uiContext = "cli", synthesisBudget = AUTO_SYNTHESIS_BUDGET }) {
  const ts = new Date().toISOString();
  // The surface this turn runs on ("cli" default; "browser" from a web entry) —
  // the honest-miss tail below points a browser/adventure miss at the teach
  // lane instead of the CLI-only --repo/tmct-init remedy.
  const browser = uiContext === "browser";
  // DISCOURSE ANAPHORA: a follow-up like "which of those are tested" / "count
  // them" filters or counts the PREVIOUS answer's entity set, threaded as
  // ask()'s `prev`. Prefers the FULL id set (`allIds`) over `matches`, since a
  // concept-force listing caps `matches` at MAX_EXAMPLES.
  const prev = (last?.detail?.allIds && last.detail.allIds.length)
    ? last.detail.allIds.filter(Boolean)
    : (last?.detail?.matches || []).map((m) => m?.id).filter(Boolean);
  // The query the ENGINE parses: a "what about X" continuation is rewritten to the
  // prior shape with X swapped in; everything else parses verbatim. The record and
  // transcript keep the user's ACTUAL words (`query`), only the parse target changes.
  let askQuery = superlativeRepeatRewrite(query, last) ?? discourseRewrite(query, last)
    ?? existentialAnythingRewrite(query) ?? query;
  // IMPLICIT ANAPHORIC COUNT: "how many are tested" drops the "of those/them" a
  // fuller phrasing carries. Insert the elided "of those" unconditionally — a
  // bare "how many are tested" with no antecedent still reaches the anaphora
  // node, which honestly degrades to "needs a previous answer to refer to".
  if (IMPLICIT_ANAPHORA_COUNT_RE.test(String(askQuery).trim())) {
    // Strip the leading connective too, or it breaks the anaphora node's own
    // AGGREGATE_TRIGGERS match on "how many" (anchored at the string start).
    askQuery = String(askQuery).trim()
      .replace(/^(?:and|so|then|also)\s+/i, "")
      .replace(/how many\s+/i, "how many of those ");
  }
  // TEMPORAL COMPARISON ACROSS TURNS — "was that before logger.mjs was
  // touched": a singular bindable form, a comparison word, and an embedded
  // passive clause. The form binds against the session's discourse record (a
  // dated referent a previous answer established), the embedded clause runs
  // fresh through the same when-question path a standalone turn takes, and
  // the two ISO dates compare with both sides cited. Checked BEFORE the ask
  // engine (the same precedence RENAME_HISTORY_RE takes, below) so the
  // sentence never reaches the keyword-spot strategy's multi-token patient
  // guard. A form this shape that CANNOT compose still ends here, with a
  // specific miss naming what's missing (no referent for the form, an
  // undated referent, no graph, an undatable clause) — falling through used
  // to hand the sentence to the teach-offer cascade, which read "that before
  // X was" as a subject to learn facts about.
  {
    const cmp = String(query).trim().match(TEMPORAL_COMPARISON_RE);
    if (cmp) {
      const [, form, cmpOp, clauseSubject, participle] = cmp;
      const verb = participle.toLowerCase();
      const refMiss = (text) => {
        note(trace, "goal: compare a prior answer's dated referent against a freshly read event (cross-turn temporal composition)");
        note(trace, `lane: TEMPORAL_COMPARISON_RE — "${form}" could not compose a comparison; a specific miss names why, never the teach-offer cascade`);
        return plainTurn(query, text, { via: "miss", miss: true, focus });
      };
      const bound = discourseHolder ? bindDiscourseForm(discourseHolder.record, form) : null;
      if (!bound?.referent) {
        return refMiss(`I don't have a referent for "${form}" yet — nothing answered earlier in this conversation binds it. Ask about the event first (e.g. "when was ${clauseSubject} last ${verb}"), then ask the comparison again.`);
      }
      const refDay = String(bound.referent.attrs?.date || "").slice(0, 10);
      if (!refDay) {
        return refMiss(`"${form}" refers to ${bound.referent.label}, but I have no date on record for it — so I can't place it before or after ${clauseSubject} was ${verb}.`);
      }
      if (!graph) {
        return refMiss(`"${form}" refers to ${bound.referent.label} (${refDay}), but I need a code graph to date when ${clauseSubject} was last ${verb} — no code graph is loaded.`);
      }
      const { ask } = await import("../domain/ask.mjs");
      const fresh = ask(graph, `when was ${clauseSubject} ${participle}`);
      const freshHit = (!fresh?.tmct_ask?.miss && !fresh?.tmct_ask?.ambiguous) ? fresh?.tmct_ask?.matches?.[0] : null;
      const freshCommit = freshHit?.id ? graph.byId?.get?.(freshHit.id) : null;
      const clauseDay = freshCommit?.class === "Commit"
        ? String((freshCommit.attributes || []).find((a) => a.key === "date")?.value || "").slice(0, 10)
        : "";
      if (!clauseDay) {
        return refMiss(`"${form}" refers to ${bound.referent.label} (${refDay}), but I couldn't date when ${clauseSubject} was last ${verb} in this index — so I can't compare the two.`);
      }
      const holds = cmpOp.toLowerCase() === "before" ? refDay < clauseDay : refDay > clauseDay;
      const relation = refDay < clauseDay ? "came before" : refDay > clauseDay ? "came after" : "landed on the same day as";
      const text = `${holds ? "Yes" : "No"} — ${bound.referent.label} (${refDay}) ${relation} ${clauseSubject} was last ${verb} (${freshCommit.label}, ${clauseDay}).`;
      note(trace, "goal: compare a prior answer's dated referent against a freshly read event (cross-turn temporal composition)");
      note(trace, `lane: TEMPORAL_COMPARISON_RE — "${form}" bound ${bound.referent.label} (${refDay}) through the discourse record; the embedded clause re-ran as its own when-question`);
      const turn = plainTurn(query, text, { via: "composed", miss: false, focus });
      const cited = [graph.byId?.get?.(bound.referent.ids[0]), freshCommit].filter(Boolean);
      turn.detail = { traversal: `discourse ${bound.referent.ref} (${refDay}) vs last-${verb} of ${clauseSubject} (${clauseDay})`, matches: cited };
      return turn;
    }
  }
  // RENAME HISTORY — "what was X called before" and its siblings. The index
  // records current names only, and without this gate "called" fuzzes onto
  // the calls relation ("before" simply drops), so the reply read as fluent
  // confirmation of a rename that never happened. Checked BEFORE the ask
  // engine because the misread ANSWERS — a miss-gated lane never gets a turn.
  {
    const rename = String(query).trim().match(RENAME_HISTORY_RE);
    if (rename) {
      const term = (rename[1] ?? rename[2]).trim().replace(/^the\s+/i, "");
      const ent = graph ? await resolveEntity(graph, term) : null;
      const named = ent ? `${ent.label} is its only recorded name` : `"${term}" has no recorded prior name`;
      note(trace, "goal: recover a name history the index does not record (honest decline)");
      note(trace, "lane: RENAME_HISTORY_RE — the index carries no rename data, so the calls-relation misread is refused by name");
      return plainTurn(query, `I can't say what ${ent ? ent.label : `"${term}"`} was called before — this index records current names only, no rename history. ${named}${ent ? ` here; "who touched ${ent.label}" lists its recorded commits` : ""}.`, {
        via: "miss", miss: true, focus,
      });
    }
  }
  // EXPLICIT WIKIPEDIA ASK — "what does wikipedia say about X" / "ask wikipedia
  // about X" / "X on wikipedia". Unlike the clean-miss packs, this fires even
  // when local facts could answer: the user named the source. It still honours
  // the network opt-in (a live lookup is a network request), so with the toggle
  // off it points at /wiki on rather than reaching the network.
  {
    const wikiTerm = wikipediaAskTerm(query);
    if (wikiTerm) {
      note(trace, "goal: read what Wikipedia says about a named term (explicit source request)");
      if (!liveReference) {
        note(trace, "lane: WIKIPEDIA ASK — the explicit request needs the network opt-in; live Wikipedia is off");
        return plainTurn(query, `live Wikipedia is off, so I won't reach the network. Turn it on with /wiki on (it fetches from en.wikipedia.org), then ask again.`, { via: "miss", miss: true, focus });
      }
      let liveKey = null;
      try { liveKey = cleanMissLiveTerm(wikiTerm, lexicon ?? undefined); } catch { liveKey = null; }
      const live = liveKey ? await liveReferenceAnswerForKey(liveKey, onLiveLookup) : null;
      if (live) {
        await ingestReferenceArticle(memoryDir, live.key, live.article, cache, liveProvenanceTag, lexicon, synthesisBudget);
        note(trace, `lane: WIKIPEDIA ASK — answered from a live en.wikipedia.org lookup, cited (article "${live.article.title}", revid ${live.article.revid})`);
        return plainTurn(query, live.text, { via: "reference", miss: false, focus });
      }
      note(trace, "lane: WIKIPEDIA ASK — no matching live article (no title, timeout, throttle, or drift-guard reject)");
      return plainTurn(query, `I couldn't reach a matching Wikipedia article for "${wikiTerm}" just now.`, { via: "miss", miss: true, focus });
    }
  }
  // COLLECTIVE PLURAL SUBJECT — see COLLECTIVE_FORWARD_RE. Members are the
  // modules whose path carries the plural as a component; two or more make it
  // a group question, answered as the disclosed union over every member. One
  // or zero members leaves the ordinary resolver reading untouched.
  {
    const collective = graph ? String(query).trim().match(COLLECTIVE_FORWARD_RE) : null;
    const stem = collective ? collective[1].toLowerCase() : null;
    if (collective && !ENTITY_TO_TYPE[stem] && !ENTITY_TO_TYPE[singularizeSurface(stem)]) {
      const memberRe = new RegExp(`(^|/)${escapeRegex(stem)}(/|\\.|$)`, "i");
      const members = graph.individuals.filter((i) => i.class === "Module" && memberRe.test(String(i.label)));
      if (members.length > 1) {
        const verb = collective[2].toLowerCase();
        const { ask } = await import("../domain/ask.mjs");
        const union = new Map();
        for (const member of members) {
          const r = ask(graph, `what does ${member.label} ${verb}`);
          for (const hit of r?.tmct_ask?.matches ?? []) if (hit?.id) union.set(hit.id, hit.label ?? hit.id);
        }
        const memberList = joinList(members.map((mm) => mm.label).sort());
        const labels = [...union.values()].sort();
        const text = labels.length
          ? `the ${stem} here are ${memberList} — together they ${verb}: ${joinList(labels)}.`
          : `the ${stem} here are ${memberList} — none of them has ${verb} edges in the index.`;
        note(trace, `goal: read a forward relation over a module GROUP (${members.length} members), unioned with the set disclosed`);
        note(trace, `lane: COLLECTIVE_FORWARD_RE — "${stem}" resolved to ${members.length} modules; answered the union, never a silent single best-match`);
        const turn = plainTurn(query, text, { via: "composed", miss: !labels.length, focus });
        turn.detail = { traversal: `${verb} edges unioned over ${memberList}`, matches: [...union.keys()].map((id) => graph.byId?.get?.(id)).filter(Boolean) };
        return turn;
      }
    }
  }
  // MOVE HISTORY — "where did X move to": the index records current
  // locations, not moves, so the premise is denied by name and the current
  // location answers beside it (stating the location alone read as silently
  // confirming a move nobody recorded).
  {
    const moved = graph ? String(query).trim().match(MOVE_HISTORY_RE) : null;
    if (moved) {
      const term = moved[1].trim().replace(/^the\s+/i, "");
      const ent = await resolveEntity(graph, term);
      if (ent) {
        let located = "";
        try {
          const { ask } = await import("../domain/ask.mjs");
          const r = ask(graph, `where is ${ent.label} defined`);
          if (r?.content && !r?.tmct_ask?.miss) located = ` Right now, ${r.content}`;
        } catch { /* the premise note stands alone */ }
        note(trace, "goal: recover a move history the index does not record (premise denied, current location cited)");
        note(trace, "lane: MOVE_HISTORY_RE — no move data exists; the current location answers with the premise named");
        return plainTurn(query, `this index records current locations only, so I can't confirm ${ent.label} moved anywhere.${located}`, {
          via: "composed", miss: false, focus,
        });
      }
    }
  }
  // DECISION RECALL — "remind me what we decided about X" reaches the
  // session-recall surface (the folded transcript blocks); with nothing
  // relevant folded it misses honestly by name. Never the definition locator
  // ("decided" is not "defined").
  {
    const decision = memoryDir ? String(query).trim().match(DECISION_RECALL_RE) : null;
    if (decision) {
      const term = decision[1].trim();
      const recalled = await recallFromBlocks(memoryDir, `what did we decide about ${term}`, graph);
      note(trace, "goal: recall a decision from the conversation record (session-recall surface)");
      note(trace, `lane: DECISION_RECALL_RE — routed to the folded-session recall surface, ${recalled ? "a relevant block answered" : "nothing relevant folded (honest miss)"}`);
      return plainTurn(query, recalled
        ?? `I don't have a recorded decision about "${term}" — I keep facts and session transcripts, and nothing folded mentions deciding on it. "what did i ask before" lists the last session's questions.`, {
        via: recalled ? "recall" : "miss", miss: !recalled, focus,
      });
    }
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
  // An explicit "this file"/"that module" kind-noun scope signal is collapsed
  // to a bare pronoun by normalize.mjs's KIND_NOUN_ANAPHORA_RE before ask()
  // ever parses askQuery — so ask()'s contextId-based pronoun resolution
  // would otherwise silently bind "this"/"that" to the STANDING focus even
  // when that focus is a narrower, different kind of thing than what was
  // explicitly named. Detected via kindNounAnaphoraHint and rescued by
  // swapping the CONTEXTID to a matching-kind individual the preceding turn's
  // answer named, but ONLY when expectedClass is "Module" — a file/module is
  // never plausibly the SAME individual as a Method/Function/Class focus (a
  // container, not a peer), unlike "that class"/"that attribute", which can
  // genuinely mean the narrower standing focus.
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
      const { ask } = await import("../domain/ask.mjs");
      const r = ask(graph, askQuery, { contextId: effectiveContextId, prev });
      text = `${r.content}${ASK_ENVELOPE_DELIM}${JSON.stringify(r.tmct_ask, null, 2)}`;
    } else {
      text = await dispatchTool("tmct_ask", { query: askQuery }, { config, source, tel });
    }
    const [content, envJson] = text.split(ASK_ENVELOPE_DELIM);
    // ask.mjs is shared with the web GUI surface (src/surfaces/web), whose
    // graph view really does have clickable nodes to select — its own
    // "click a node first, or name it directly" wording is correct THERE,
    // but this plain chat surface has no clickable anything, so the same
    // literal instruction reads as nonsense here (a returning-user finding,
    // hit on a failed focus resolution with nothing selected). Swapped for
    // CLI-appropriate wording rather than threading a surface flag through
    // ask.mjs's whole render layer — a plain string swap on the one shared
    // clause, not a change to the engine's own (correct, for its surface)
    // answer.
    answer = content.replace(
      /needs a selected node to refer to — click a node first, or name it directly\.$/,
      "isn't resolved to anything yet — name the term directly, or ask a question that resolves one first.",
    );
    if (envJson) { try { envelope = JSON.parse(envJson); } catch { envelope = null; } }
    // Typed discourse referents the answer established (the ask envelope's
    // additive `discourse` field, emitted beside the eval where the answer's
    // content is still typed) register into the session's record here — the
    // one point both ask paths (direct call and dispatchTool) converge.
    if (discourseHolder && Array.isArray(envelope?.discourse)) {
      for (const { lane, ...spec } of envelope.discourse) {
        discourseHolder.record = registerReferent(discourseHolder.record, {
          ...spec, from: { turn: discourseHolder.record.turn, lane, query: askQuery },
        });
      }
    }
  } catch (e) {
    const thrown = String(e?.message || e);
    // A graph-less session's ask dispatch fails reading the never-configured
    // graph artifact, or loads one holding nothing (e.emptyGraph — the first
    // turn of a fresh session, before the conversation has folded anything in).
    // Either way it's an internal error string, not an answer. Swap in an
    // honest wall; the teach/fact/vocabulary lanes below still get their turn
    // and replace it whenever they can store or answer instead. A missing
    // config gets the same wall: with no config at all, no dispatch could ever
    // have loaded a graph, whatever the internal error spelled.
    //
    // The session hands this lane a KNOWN-EMPTY graph object rather than null
    // on that first turn, so the test is noCodeGraph, not `!graph`: an empty
    // graph is as unusable as an absent one, and reporting its emptiness to
    // someone asking about a dog answers a question they never asked.
    // The exit named is the one this session can actually take: a SEEDED
    // vocabulary session points at a vocabulary shape (code-question
    // examples are the wrong audience here), an unseeded one at the seed/
    // teach pair — vocabHint already carries exactly that split.
    answer = (!graph || noCodeGraph(graph)) && (!config || e?.emptyGraph || /^cannot read graph artifact\b/.test(thrown))
      // A browser session has no `tmct init in a repo` to reach for, so its
      // fallback drops that CLI-only remedy and keeps just the teach pointer.
      ? `${NO_GRAPH_BOOTSTRAP_WALL_LEAD} ${vocabHint
        || (browser
          ? "I can still remember and answer taught facts (try \"every bug is an issue\")."
          : "I can still remember and answer taught facts (try \"every bug is an issue\"), or run `tmct init` in a repo to index one.")}`
      : thrown;
    note(trace, `intermediate: the ask engine threw — ${thrown}`);
  }
  // NARRATE: the direct parse/traversal receipt, straight off ask()'s own
  // envelope, with zero extra instrumentation of ask.mjs: `parsed` is the
  // compiled AST, `relaxed` is the relaxation-cascade trace, `matchedVia`
  // names the confidence tier a resolution fell through to.
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
  // STACCATO CONNECTIVE LEAKAGE: "and calls?" is handed to ask() UNSTRIPPED.
  // If ask()'s raw grammar recognizes "calls" as a verb, the leftover "and"
  // becomes parsed.object, and resolveObject's substring match can accidentally
  // resolve a 2-3 letter connective against some real label. That would
  // silently rebind the FOCUS to a bogus match, corrupting the next turn's
  // pronoun resolution — so any of STACCATO_SWAP_RE's closed connective words
  // is excluded here from ever being resolved as an object at all.
  const isLeakedConnective = STACCATO_LEAKED_CONNECTIVES.has(String(envelope?.parsed?.object || "").toLowerCase());
  if (graph && envelope?.parsed?.object && !isLeakedConnective) {
    const obj = envelope.parsed.object;
    // A PRONOUN object ("it"/"this") was already resolved against the focus via
    // contextId — the resolved antecedent IS the focus. Re-resolving the
    // literal pronoun string risks the same accidental-substring trap as
    // STACCATO_LEAKED_CONNECTIVES above ("it" matching a "Commit" schema
    // node's label). Reuse the focus directly instead, never resolveEntity on
    // the raw pronoun string. `kindRescueEnt` (computed above) overrides this
    // when an explicit "this file"/"that module" scope disagreed with the
    // standing focus's class — see that block's own comment.
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
    // A superlative ("which module has the most imports") names no object, so
    // the branch above never runs and the ranked WINNER never becomes the
    // focus without this. Mirrors the object-resolution rule above: a single,
    // unambiguous winner (never a multi-way tie) becomes the new focus,
    // class-gated the same way (nextFocus).
    const winner = envelope.matches[0];
    if (winner?.id) {
      resolvedIds = [winner.id];
      newFocus = nextFocus(graph, focus, winner);
      note(trace, `result: superlative winner ${winner.label} (${winner.id}) — becomes the new focus`);
    }
  }
  const answeredIds = (envelope?.matches || []).map((m) => m?.id).filter(Boolean);
  const askMiss = envelope ? !!envelope.miss : true;
  // GRAPH-FACT-VS-TAUGHT-FACT PRECEDENCE: a plain declarative "X is a kind of
  // Y" sentence whose SUBJECT already names a real graph entity could get
  // silently "answered" by the ask engine's own relaxation cascade instead of
  // ever reaching the teach lane — relaxParse's DROP-UNMATCHED layer drops an
  // unresolvable trailing content word, turning "a Task is a kind of animal"
  // into the DIFFERENT, valid elliptical question "a Task is a kind of",
  // which genuinely answers "Record" and never lets envelope.miss go true.
  // Detected narrowly (all three must hold): the answer came via
  // envelope.relaxed, the raw query is NOT phrased as a question, and it
  // independently fits the closed "X is a kind of Y" teach shape
  // (DECLARATIVE_KIND_OF_RE). When all three hold, this turn is treated as a
  // would-miss so the TEACH lane gets a real turn — a stored taught fact
  // COEXISTS with the graph reading, never replacing it. If nothing below
  // actually stores it, the ORIGINAL ask-engine answer is restored unchanged
  // (see "COLLISION RESTORE" below).
  const trimmedQuery = String(query).trim();
  // Boolean() and not a bare && chain: with no memoryDir the chain would
  // short-circuit to null, and `miss` below (askMiss || THIS) would record a
  // null miss flag on every relaxation-rescued turn of a memory-less session.
  const relaxedTeachCollision = Boolean(!!(envelope?.relaxed?.dropped?.length) && !askMiss && memoryDir
    && !QUESTION_LEAD_RE.test(trimmedQuery) && !/\?\s*$/.test(trimmedQuery)
    && DECLARATIVE_KIND_OF_RE.test(trimmedQuery));
  const preCollisionAnswer = relaxedTeachCollision ? answer : null;
  const miss = askMiss || relaxedTeachCollision;
  // Answer provenance (W1): "composed" is the ask engine's productive band; the
  // orientation swap below is template wording, so those turns carry via:"template".
  let via = "composed";
  let recordMiss = miss;
  let factPending = null; // a truncated fact listing's held remainder (for "more" paging)
  // scm-svf1/cardinality-monotonicity/
  // cax-maxc0's LIVE proof chases (factReadBack) have no persisted Fact to
  // attach trust.mjs's entailed hook to, so they compute
  // `min(premiseTrusts) × ruleConfidence` (`entailedTrustFrom`) themselves and
  // hand it back on the answer object, surfaced here as `record.entailedTrust`.
  let entailedTrust = null;
  // GOAL DEDUCTION: from the parsed AST when one stood; a total grammar miss
  // gets the honest "didn't resolve" goal line. `deduced` also rides the
  // returned result as `goal` — the seam withGoalLine reads to prepend the
  // always-on "Goal (inferred): …" line. `let`, not `const`: the RELATION
  // CONCEPT FORCE (below) can reassign it when it answers a turn with no
  // envelope.parsed to deduce from at all.
  let deduced = deduceGoalFromParsed(envelope?.parsed);
  // Same staleness risk as `deduced` above, for the OTHER piece of turn metadata
  // read straight off the pre-force `envelope`: a raw parse the relation force
  // below goes on to override (a keyword-misread subject, e.g. "and" in a
  // staccato "and inherits?" continuation) is not a genuine structural query —
  // canonicalOf's restatement of THAT parse would misdescribe the real answer.
  // Revised (to null, honestly — the relation force answers no single resolved
  // subject) at the same relation-force call site below.
  let canonical = envelope?.canonical ?? null;
  // Paired with preCollisionAnswer above: the goal line that matched the
  // ORIGINAL ask-engine answer, restored alongside it if the would-miss
  // cascade below never actually stores anything.
  const preCollisionDeduced = relaxedTeachCollision ? deduced : null;
  note(trace, `goal: ${deduced ?? "unclear — the phrasing didn't resolve to a known query shape"}`);
  // MISS handling. The intent lanes + short-miss are RECOGNIZER-gated on the query
  // text AND only consulted on a would-miss, so a real graph query — a hit, an honest
  // empty with a receipt, a fuzzy repair — is never hijacked. Order: (1) META/SELF
  // lane (would-miss), (2) conversational orientation (would-miss), (3) memory
  // facts/recall (a fact EXTENDS a non-miss schema hit too — NOT miss-gated),
  // (4) TEACH lane (would-miss), (5) the short tailored miss (would-miss).
  let handled = false;
  // The dialogue-act lane, when a lane below knows better than the final
  // question-shape lookup (a plan frame is a request/instruct, a stored
  // teach is an inform, whatever the surface punctuation looked like).
  let dialogueLaneOverride = null;
  // (0) "what else is X" — recognized off the RAW query text, before every
  // other lane below (all of which read `envelope`, already relaxed/reparsed
  // by ask()'s noise-strip cascade, which silently drops "else"). via is set
  // to a value NONE of the downstream via gates match, so a hit here is final.
  if (memoryDir) {
    const whatElse = await whatElseAnswer(memoryDir, query, last);
    if (whatElse) {
      // A cold "what else" carries miss:true — it resolved no subject, so the
      // turn is a miss in better words, exactly like the isa ladder's closers.
      answer = whatElse.text; via = "fact:what-else"; recordMiss = whatElse.miss ?? false; handled = true;
      if (whatElse.pending) factPending = whatElse.pending;
      deduced = "surface additional remembered facts beyond the primary definition";
      note(trace, "lane: (0) WHAT ELSE — \"what else is/about X\" recognized off the raw query, before the relaxation cascade could quietly drop \"else\" and reduce it to a plain \"what is X\"");
      note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
      note(trace, `goal: ${deduced} (revised — the raw \"what else\" phrasing was recognized directly, not the relaxed/reparsed envelope)`);
    }
  }
  // (0a) ARCHITECTURE OVERVIEW — see ARCH_OVERVIEW_PHRASES. Answered here,
  // before the meta/orientation lanes and long before the symbol-resolve
  // rescues (4d), so the closed architecture phrasings reach the map instead
  // of a literal-token symbol card or the vocabulary-touch teach offer.
  if (!handled && miss && graph && !noCodeGraph(graph)) {
    // The RAW text is tried alongside the peeled one: applyPreambleFrames'
    // show/give-me bridge rewrites "show me the architecture" into "describe
    // architecture", which drops the article this closed set anchors on.
    const archRaw = correctMisspellings(String(query).trim());
    const archPeeled = applyPreambleFrames(archRaw);
    if (ARCH_OVERVIEW_PHRASES.some((re) => re.test(archRaw) || re.test(archPeeled))) {
      try {
        const archText = await dispatchTool("tmct_architecture", {}, { config, source, tel });
        if (archText) {
          answer = archText; via = "meta"; recordMiss = false; handled = true;
          deduced = "understand the overall architecture (package/module boundaries)";
          note(trace, `goal: ${deduced} (revised — a closed architecture-overview phrasing was recognized directly)`);
          note(trace, "lane: (0a) ARCHITECTURE OVERVIEW — routed to the whole-repo architecture map (/arch), never a literal symbol lookup on the word \"architecture\"");
        }
      } catch { /* the tool couldn't load a graph — the ordinary lanes decide */ }
    }
  }
  // (1) #2 META/SELF: bare self/session questions ("what do you know", "what is this
  // codebase", "how do i start") → a summary / orientation, answered before the
  // fact-dump readers so "what do you know" gets a summary, not raw facts.
  if (!handled && miss) {
    const meta = await metaLane(query, { graph, memoryDir, last, templates, vocabHint, focus });
    if (meta) {
      // A lane may answer with a better-worded decline (the module-orient
      // residue guard) — still a miss in the turn record, like the isa
      // ladder's own closers.
      answer = meta.text; via = meta.via; recordMiss = meta.miss ?? false; handled = true;
      note(trace, `lane: (1) META/SELF — bare self/session question recognized, answered via="${meta.via}"`);
    }
  }
  // (1p) PLAN — the goal/solve/legal-moves recognizers over taught action
  // rules. Sits ABOVE the conversational catch-all: "solve it" is three
  // short words and isConversational() would otherwise claim it into the
  // orientation card before this lane ever ran.
  let planResult = null;
  if (!handled && miss && memoryDir && planHolder) {
    const planLane = await planLaneAnswer(query, { memoryDir, planHolder, sessionId, gameConfig });
    if (planLane) {
      answer = planLane.text; via = planLane.via; recordMiss = false; handled = true;
      if (planLane.lane) dialogueLaneOverride = planLane.lane;
      if (planLane.plan) planResult = planLane.plan;
      if (planLane.deduced) {
        deduced = planLane.deduced;
        note(trace, `goal: ${deduced} (revised — the plan lane answered)`);
      }
      // Same rule as the teach lane below: a canonical whose verb only
      // matched through the fuzzy repair tier ("rests" read as "tests")
      // misdescribes a plan-lane turn, so it's dropped; an exact parse keeps
      // its receipt.
      if (envelope?.parsed?.fuzzyVerb) canonical = null;
      note(trace, `lane: (1p) PLAN — ${planLane.note}`);
    }
  }
  // "what about X" with a genuine PRIOR turn to continue is exempt from the
  // conversational catch-all even when short/non-codeish: isConversational()
  // can't see that discourseRewrite/describeWrapperAnswer haven't had their
  // turn yet. Same exemption for the bare-connective sibling shape ("and
  // Widget?", STACCATO_SWAP_RE), gated the SAME way discourseRewrite gates it.
  const staccatoSwapMatch = String(query).match(STACCATO_SWAP_RE);
  const isStaccatoSwap = !!(last?.query && staccatoSwapMatch && NAME_TOKEN_RE.test(staccatoSwapMatch[1]?.trim() || ""));
  const isWhatAboutContinuation = !!(last?.query && WHAT_ABOUT_RE.test(String(query))) || isStaccatoSwap;
  // A bare vague-touch OPENER ("wat about validate", "tell me about store.mjs")
  // whose term resolves to a UNIQUE graph entity is a genuine describe request,
  // not small talk — defer past the conversational card so describeWrapperAnswer
  // (4d, below) serves its module/entity overview. Distinct from
  // isWhatAboutContinuation above, which needs a prior turn: this fires on the
  // FIRST turn too, and covers the "tell me about"/"explain" surfaces
  // vagueTouchTermOf reads. resolveEntity already declines on ambiguity, so an
  // ambiguous or unknown term ("wat about xyzzy") keeps today's orientation card.
  const vagueTouchTerm = graph ? vagueTouchTermOf(String(query)) : null;
  const isVagueTouchResolvable = !!(vagueTouchTerm && await resolveEntity(graph, vagueTouchTerm));
  // Same exemption for "describe it"/"tell me about that" — needs the SAME
  // deferral to reach describeWrapperAnswer's focus-aware pronoun resolution.
  // Gated on an actual standing focus, same honest-decline discipline as
  // describeWrapperAnswer itself.
  const describeWrapperMatch = DESCRIBE_WRAPPER_RE.exec(String(query).trim()) || STACCATO_PRONOUN_RE.exec(String(query).trim());
  const isDescribePronounContinuation = !!(focus?.label && describeWrapperMatch && DESCRIBE_PRONOUN_RE.test(describeWrapperMatch[1]?.trim() || ""));
  // A bare/wrapped "explain X" needs the SAME deferral, for a stronger reason:
  // "explain" isn't a VERB_TO_KIND word, so ask() never attempts a parse at
  // all, and a short "explain cochange" trips isConversational's ≤3-word
  // heuristic before ever reaching the relation/concept force below.
  const isExplainTouch = EXPLAIN_TOUCH_RE.test(String(query).trim());
  // Staccato negation ("not that one", "not Widget then") needs the SAME
  // deferral: nudgeAnswer's negation branch ALWAYS returns a tailored nudge
  // for this shape, never null, so deferring here never strands the turn.
  const isStaccatoNegation = STACCATO_NEGATION_RE.test(String(query).trim());
  // Staccato comparative ("more than that", "which is bigger") needs the SAME
  // deferral, for the SAME reason as isStaccatoNegation just above.
  const isStaccatoComparative = STACCATO_COMPARATIVE_RE.test(String(query).trim());
  // A bare STACCATO PRONOUN continuation ("also that one?", "and it") with NO
  // standing focus needs the SAME deferral: nudgeAnswer's own
  // STACCATO_PRONOUN_RE-no-focus branch ALWAYS returns a tailored nudge for
  // this exact shape, never null.
  const isStaccatoPronounNoFocus = STACCATO_PRONOUN_RE.test(String(query).trim()) && !focus?.label;
  // A bare plural-membership declarative ("dogs are animals" — exactly 3
  // words) needs the SAME deferral: it's an unambiguous TEACH shape (lane 4),
  // but isConversational's ≤3-word catch-all claims it first. Gated on BOTH
  // sides singularizing to KNOWN lexicon nouns, so real chatter ("these are
  // yours") stays with the orientation card.
  let isPluralMembershipTeach = false;
  // A bare habitual naming a subject grounded NOWHERE ("penguins swim", no
  // prior grounding) gets an honest grounding hint instead of the
  // orientation card — computed here, rendered inside the conversational
  // branch below so a turn something real answers never shows it.
  let habitualGroundingHint = null;
  // "ahab fathered john" — a bare verb-inflected relational teach (exactly
  // the shape teachLane's own frame stores) needs the SAME deferral, or the
  // ≤3-word catch-all claims it first. "john likes mary" (present tense)
  // stays wrapper-required BY DESIGN — it gets a nudge at the wrapped form,
  // never a store.
  let isBareRelationalVerbTeach = false;
  let bareTeachWrapperNudge = null;
  {
    const bareLine = String(query).trim();
    const pm = bareLine.match(/^([\w-]+)\s+are\s+([\w-]+)[.!?]*$/i);
    const habitual = pm || QUESTION_LEAD_RE.test(bareLine)
      ? null : (matchBareHabitualTeach(bareLine) || matchBareCanTeach(bareLine));
    if (pm || habitual) {
      try {
        const { loadLexicon, lookupNoun } = await import("../domain/grammar/lexicon.mjs");
        const lex = loadLexicon();
        if (pm) {
          const s = singularizeSurface(pm[1].toLowerCase());
          const o = singularizeSurface(pm[2].toLowerCase());
          isPluralMembershipTeach = s !== pm[1].toLowerCase() && !!lookupNoun(lex, s) && !!lookupNoun(lex, o);
        } else {
          // The bare habitual/capability siblings ("dogs bark", "a dog
          // barks", "wrens can sing") — same deferral, same known-subject
          // gate, so real chatter never diverts. The naive singular is tried
          // too: matchBareCanTeach keeps the surface plural ("wrens"), but
          // the grounding fact was stored under the singular.
          const subjects = [...new Set([habitual.subject, singularizeSurface(habitual.subject)])];
          isPluralMembershipTeach = subjects.some((s) => !!lookupNoun(lex, s));
          if (!isPluralMembershipTeach && memoryDir) {
            let grounded = false;
            for (const s of subjects) grounded = grounded || (await isGroundedByFact(s, memoryDir, cache));
            if (grounded) {
              // Grounded by a prior taught fact — defer the same way; the
              // teach lane's grounded-subject direct write stores it.
              isPluralMembershipTeach = true;
            } else {
              habitualGroundingHint = habitualGroundingHintText(
                bareLine.replace(/[.!?]+\s*$/, ""),
                { ...habitual, subject: subjects[subjects.length - 1] },
              );
            }
          }
        }
      } catch { /* lexicon unavailable — leave false, the ordinary path decides */ }
    } else if (memoryDir && !QUESTION_LEAD_RE.test(bareLine)
      && bareLine.replace(/[.!?]+\s*$/, "").split(/\s+/).filter(Boolean).length <= 3) {
      if (await matchRelationalVerbTeach(bareLine)) isBareRelationalVerbTeach = true;
      else bareTeachWrapperNudge = await bareTeachWrapperNudgeText(bareLine);
    }
  }
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
  // Without this, "what about cochange" as an opening turn, and "and
  // cochange?" as a mid-chain continuation, both fall straight to the generic
  // orientation card even though the graph has real cochange edges. Needs no
  // prior-turn/focus context either (same as isExplainTouch) — scoped to the
  // CLOSED RELATION_TERM vocabulary (concept.mjs) via
  // relationTermOf's own gate, so an unknown word or a real entity name still
  // declines and isConversational's catch-all is untouched for it.
  let isVagueRelationTouch = false;
  {
    const relTerm = relationTermOf(String(query), envelope);
    if (relTerm) {
      try {
        const { RELATION_TERM } = await import("../domain/concept.mjs");
        isVagueRelationTouch = !!RELATION_TERM[relTerm.toLowerCase()];
      } catch { /* leave false — the ordinary path decides */ }
    }
  }
  const conversationalCandidateBaseGate = !handled && miss && !envelope?.parsed && !isWhatAboutContinuation && !isVagueTouchResolvable && !isDescribePronounContinuation && !isExplainTouch && !isStaccatoNegation && !isVagueRelationTouch && !isStaccatoComparative && !isStaccatoPronounNoFocus && !isPluralMembershipTeach && !isBareRelationalVerbTeach;
  // A turn whose pronoun was bound to a vocabulary antecedent is PROVABLY a
  // fact question ("can it bark" → "can dog bark") — never conversational,
  // however short. Without this, the substituted 3-worder still trips
  // isConversational's word-count catch-all into the orientation blurb, and
  // that blurb (a dispatched turn) then becomes `last`, wiping the very
  // antecedent the next pronoun turn needs.
  const isConversationalCandidate = conversationalCandidateBaseGate && !vocabAntecedent && isConversational(query);
  // "what is X" with NO article ("what is john") is BOTH conversational-shaped
  // (isConversational() would claim it) AND a legitimate bare meta/fact-lookup
  // form (BARE_WHATIS_RE). Diverts ONLY when a REAL fact actually resolves for
  // the bare term — a bare "what is up" with nothing behind it still falls
  // through to the ordinary orientation card. Same divert-only-on-a-real-hit
  // gate also covers IS_ADJECTIVE_YESNO_RE shapes ("is it deprecated"), so
  // factReadBack's property lane gets a chance to run first.
  // A leading filler clause ("hey quick q, what is X") or a no-apostrophe
  // contraction ("whats X") must reach this lane too — `gateQuery` is
  // normalizeQuery's output (idempotent on already-clean text), used for both
  // the shape gate and the lookups it feeds.
  const gateQuery = normalizeQuery(String(query));
  const bareWhatisShape = BARE_WHATIS_RE.test(gateQuery);
  const isAdjectiveShape = IS_ADJECTIVE_YESNO_RE.test(gateQuery);
  // A BARE NOUN on its own ("dog", "teh dog" after the typo repair) is the
  // shortest vocabulary opener there is — it answers exactly as "what is a
  // dog" does, gated on a REAL fact hit like every divert in this family, so
  // chatter with no facts behind it still falls to the ordinary card. Read
  // off the raw line (typos repaired), NOT the filler-stripped gateQuery: a
  // request with filler around a noun ("jokes please") is a different speech
  // act than a bare noun, and stripping must not manufacture one.
  const bareNounMatch = correctMisspellings(String(query).trim()).replace(/[?.!]+\s*$/, "").trim()
    .match(/^(?:the\s+|a\s+|an\s+)?([a-z][a-z-]*)$/i);
  const bareNounShape = !!bareNounMatch;
  // `isBareCamelCaseMetaQuestion` ORs in alongside isConversationalCandidate
  // for THIS lane only — a bare "what is TaskController" (CamelCase compound,
  // no article) is otherwise excluded solely because isConversational()'s
  // codeish check fires on the CamelCase transition. Shares the SAME base gate
  // so it's never looser; a CamelCase term with no real hit still falls
  // through to the ordinary orientation-card fallback further down.
  const isBareCamelCaseWhatisCandidate = conversationalCandidateBaseGate && isBareCamelCaseMetaQuestion(gateQuery);
  // The SAME divert-only-on-a-real-hit gate covers factAnswer's
  // WHAT_USED_FOR_RE/REVERSE_PREDICATE_MARKERS reverse-predicate shapes too —
  // for the shortest members of the family ("what wants happiness") it's
  // actually MORE likely that isConversational() claims it before factAnswer
  // gets a turn.
  const reversePredicateShape = WHAT_USED_FOR_RE.test(gateQuery)
    || REVERSE_PREDICATE_MARKERS.some(({ re }) => re.test(gateQuery));
  // The capability family's SHORTEST members ("can birds fly", "do birds
  // fly", "what can bark" — all three words) trip isConversational()'s
  // word-count catch-all before factAnswer's capability readers ever run;
  // same divert-only-on-a-real-hit treatment as the reverse predicates
  // above.
  const capabilityAskShape = CAN_ASK_RE.test(gateQuery) || WHAT_CAN_DO_RE.test(gateQuery)
    || DO_VERB_ASK_RE.test(gateQuery) || WHICH_KIND_CAN_RE.test(gateQuery) || WHAT_CAN_VERB_RE.test(gateQuery)
    || WHAT_CANNOT_VERB_RE.test(gateQuery);
  // A bare "who is/was <name>" (no relational tail) is as short as the
  // vocabulary openers above and trips isConversational's word-count catch-all
  // the same way — factReadBack's bare-who reader surfaces the person's stored
  // relations only on a real hit, so a name with no facts still falls to the
  // ordinary card.
  const whoIsShape = WHO_IS_BARE_RE.test(gateQuery);
  let bareMetaHit = null;
  if ((isConversationalCandidate || isBareCamelCaseWhatisCandidate) && (bareWhatisShape || isAdjectiveShape || reversePredicateShape || capabilityAskShape || bareNounShape || whoIsShape)) {
    if (memoryDir) {
      // The bare noun asks its own "what is a X" — the readers never see the
      // single word, so the vocabulary route is the constructed question's.
      const bareNoun = bareNounShape ? singularizeSurface(bareNounMatch[1].toLowerCase()) : null;
      const factQuery = bareNounShape && !bareWhatisShape
        ? `what is ${indefiniteArticleFor(bareNoun)} ${bareNoun}`
        : gateQuery;
      bareMetaHit = (await factAnswer(memoryDir, factQuery, envelope, miss, biasByBundle, cache, newFocus?.label))
        ?? (await factReadBack(memoryDir, factQuery, envelope, miss, graph, newFocus?.label, biasByBundle, cache));
      if (bareNounShape && !bareWhatisShape && bareMetaHit?.miss) bareMetaHit = null;
      // An honest-miss return never diverts the gate — EXCEPT the capability
      // family's can't-confirm, which names the subject's real capabilities
      // and a round-trip teach hint: strictly more useful than the
      // orientation card this gate would otherwise fall to.
      if (bareMetaHit?.miss && !capabilityAskShape) bareMetaHit = null;
      // A bare "what is X" with NO taught fact but a KNOWN curated corpus term
      // ("what is cache", no article) needs the same "only diverts on a REAL
      // hit" treatment — curatedDefinitionAnswer otherwise only ever runs once
      // the article makes T5's structural parse succeed.
      if (!bareMetaHit) {
        const def = await curatedDefinitionAnswer(factQuery, envelope, { memoryDir, lexicon });
        if (def) bareMetaHit = { text: def.text, replace: true };
      }
      // The learn-on-miss packs' bare-form fallback, beside the curated one
      // and under the IDENTICAL clean-miss gate the articled hook (4h)
      // applies — "what is otter" reaches the packs exactly as "what is an
      // otter" does, child triples first, article prose second.
      if (!bareMetaHit) {
        const refTerm = metaTermOf(factQuery, envelope);
        const key = refTerm ? await cleanMissPackKey(refTerm, { graph, memoryDir, lexicon, cache }) : null;
        const learned = key ? await childPackFactsForKey(key, { memoryDir, env, cache, synthesisBudget }) : null;
        if (learned) {
          const fact = (await factAnswer(memoryDir, factQuery, envelope, miss, biasByBundle, cache, newFocus?.label))
            ?? (await factReadBack(memoryDir, factQuery, envelope, miss, graph, newFocus?.label, biasByBundle, cache));
          if (fact && !fact.miss) bareMetaHit = { text: fact.text, replace: true, child: learned };
        }
        if (!bareMetaHit && key) {
          const ref = await referencePackAnswerForKey(key, env);
          if (ref) bareMetaHit = { text: ref.text, replace: true, reference: ref };
        }
        // The live Wikipedia supplement (opt-in), LAST — the shipped packs
        // always speak first, and a live null/failure leaves bareMetaHit
        // exactly as a live-off run would.
        if (!bareMetaHit && liveReference && refTerm) {
          const liveKey = await cleanMissLiveKey(refTerm, { graph, memoryDir, lexicon, cache });
          const live = liveKey ? await liveReferenceAnswerForKey(liveKey, onLiveLookup) : null;
          if (live) bareMetaHit = { text: live.text, replace: true, live };
        }
      }
    }
    // A bare "what is X" naming a REAL code-graph entity (not a taught fact,
    // not a curated corpus term) needs the SAME race fixed too.
    // metaFallbackEntityAnswer (ask.mjs) is the exact fallback the ARTICLED
    // form's structural parse already reaches. Deliberately OUTSIDE the
    // `memoryDir` check above — this is a pure graph lookup.
    if (!bareMetaHit && graph) {
      const term = metaTermOf(gateQuery, envelope);
      if (term) {
        const { metaFallbackEntityAnswer } = await import("../domain/ask.mjs");
        const fallback = metaFallbackEntityAnswer(graph, term);
        if (fallback) bareMetaHit = { text: fallback.text, replace: true };
      }
    }
  }
  // (2c) BARE ENTITY NAME, NO VERB AT ALL: "task" / "usercontroller" — a bare
  // word naming a REAL class/function/method/global/attribute, with no
  // "what is"/"describe" wrapper. Reuses the SAME metaFallbackEntityAnswer
  // lookup and "divert only on a REAL, UNIQUE hit" discipline: it only
  // returns non-null for an EXACT label match, so ordinary small talk is
  // unaffected.
  //
  // `isBareCamelCaseEntityCandidate` ORs in for THIS lane the way
  // isBareCamelCaseWhatisCandidate does for (2b) — a bare "TaskController" is
  // excluded from isConversationalCandidate solely by the CamelCase transition,
  // while a bare "task" reaches the lane. Same base gate and same
  // `!vocabAntecedent`, so it's never looser than the gate it joins.
  const isBareCamelCaseEntityCandidate = conversationalCandidateBaseGate && !vocabAntecedent
    && isBareCamelCaseEntityName(query);
  if (!bareMetaHit && (isConversationalCandidate || isBareCamelCaseEntityCandidate) && graph) {
    const { metaFallbackEntityAnswer } = await import("../domain/ask.mjs");
    const fallback = metaFallbackEntityAnswer(graph, String(query).trim());
    if (fallback) bareMetaHit = { text: fallback.text, replace: true };
  }
  const coldPronounDecline = focus?.label ? null : coldPronounDeclineText(query);
  let selfContainedMiss = false;
  if (bareMetaHit?.reference) {
    // The bare-form reference hit mirrors (4h): the cited answer replaces the
    // miss, the turn is no longer recorded as one, and the article's grounded
    // triples are stored after the answer composes.
    answer = bareMetaHit.text;
    via = "reference";
    recordMiss = false;
    handled = true;
    note(trace, "lane: (2b) REFERENCE PACK — a bare \"what is X\" clean miss answered from the shipped reference pack, cited");
    note(trace, `source: reference pack ${REFERENCE_PACK_NAME} — article "${bareMetaHit.reference.article.title}" (revid ${bareMetaHit.reference.article.revid})`);
    await ingestReferenceArticle(memoryDir, bareMetaHit.reference.key, bareMetaHit.reference.article, cache, referenceProvenanceTag, lexicon, synthesisBudget);
  } else if (bareMetaHit?.live) {
    // The bare-form LIVE hit settles the same way, under live provenance.
    answer = bareMetaHit.text;
    via = "reference";
    recordMiss = false;
    handled = true;
    note(trace, "lane: (2b) LIVE WIKIPEDIA — a bare \"what is X\" clean miss answered from a live en.wikipedia.org lookup (opt-in), cited");
    note(trace, `source: live reference ${LIVE_PACK_NAME} — article "${bareMetaHit.live.article.title}" (revid ${bareMetaHit.live.article.revid})`);
    await ingestReferenceArticle(memoryDir, bareMetaHit.live.key, bareMetaHit.live.article, cache, liveProvenanceTag, lexicon, synthesisBudget);
  } else if (bareMetaHit) {
    answer = bareMetaHit.replace ? bareMetaHit.text : `${answer}\n${bareMetaHit.text}`;
    // Same discipline as lane (3): a fact-lane return flagged `miss` is an
    // honest miss in better words — the turn record keeps miss=true and via
    // stays untouched.
    if (!bareMetaHit.miss) { via = "fact"; recordMiss = false; }
    handled = true;
    if (bareMetaHit.pending) factPending = bareMetaHit.pending;
    if (bareMetaHit.child) {
      note(trace, "lane: (2b) CHILD PACK — a bare \"what is X\" clean miss pulled the term's triples from the shipped child pack into memory, and the question was re-answered from the store");
      note(trace, `source: child pack ${CHILD_PACK_NAME} — ${bareMetaHit.child.count} fact(s) appended as ${childProvenanceTag(bareMetaHit.child.key)}, answer served from .tmct/memory Facts`);
    } else {
      note(trace, "lane: (2b) BARE META FACT — \"what is X\" (no article) / \"is X <adjective>\" resolved to a remembered fact before the conversational catch-all could claim it");
      note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
    }
  } else if (isConversationalCandidate && habitualGroundingHint) {
    // A bare habitual teach ("penguins swim") naming a subject grounded
    // nowhere: an honest, actionable grounding hint beats the orientation
    // card — the card answers a question the user never asked.
    answer = habitualGroundingHint;
    via = "teach-miss"; handled = true;
    note(trace, "lane: (2) HABITUAL GROUNDING HINT — a bare habitual teach named an ungrounded subject; pointed at the grounding phrase instead of the orientation card");
    note(trace, "goal: teach/remember a new capability fact (subject not yet grounded)");
  } else if (isConversationalCandidate && bareTeachWrapperNudge) {
    // A bare name-verb-name declarative ("john likes mary"): stays
    // wrapper-required, so nothing stores — but pointing at the wrapped form
    // that DOES store beats the orientation card for the same reason.
    answer = bareTeachWrapperNudge;
    via = "teach-miss"; handled = true;
    note(trace, "lane: (2) BARE TEACH NUDGE — a bare name-verb-name declarative stays wrapper-required; suggested the remember-that form");
    note(trace, "goal: teach/remember a new fact (wrapper required for the bare form)");
  } else if (isConversationalCandidate && coldPronounDecline) {
    // A subject-position pronoun with no antecedent anywhere: no vocabulary
    // subject bound upstream, and no code focus for it to mean either. The
    // orientation card would introduce the tool; naming the pronoun says what
    // actually went wrong. Still a miss in the record — honest wording, not an
    // answer.
    answer = coldPronounDecline;
    via = "template"; handled = true;
    note(trace, "lane: (2) COLD PRONOUN — a subject pronoun with no antecedent bound and no focus standing; named the pronoun instead of the orientation card");
    note(trace, "goal: resolve a pronoun to a subject (nothing named yet)");
  } else if (isConversationalCandidate && planHolder?.state?.game) {
    // MID-GAME: a short line that parsed as nothing ("you said lower", "is it
    // warm in here") stays INSIDE the game frame with a nudge naming the
    // state — the identity card answers a question nobody asked, and it used
    // to front exactly these turns. Real asides ("what is a dog") still
    // route out above; only the would-be blurb is replaced.
    const game = planHolder.state.game;
    answer = game.mode === "guesser"
      ? `we're mid-game — I'm guessing your number (currently between ${game.lo} and ${game.hi}; my guess: ${game.guess}). Say higher, lower, or correct — or "I give up" to stop.`
      : `we're mid-game — you're guessing my number between ${game.lo0} and ${game.hi0}${game.lastHint ? ` (my last hint: ${game.lastHint} than your ${game.lastGuess})` : ""}. Guess a number — or "I give up" to stop.`;
    via = "game"; handled = true;
    dialogueLaneOverride = "game-inform";
    note(trace, "lane: (2) MID-GAME NUDGE — an unparsed short turn stayed inside the live game frame instead of the identity card");
    note(trace, "goal: keep the running guess-the-number game on track");
  } else if (isConversationalCandidate) {
    // A conversational miss (a greeting, "what can you do", a very short non-code
    // line) gets the friendly orientation (module-aware: empty → --repo/tmct init).
    // This branch carries via:"template" and never reaches the composed-only
    // wall-shortening gate below, so it needs its own repeat collapse,
    // mirroring WALL_REPEAT_ONELINER.
    //
    // `!envelope?.parsed`: isConversational() is a TEXT-ONLY heuristic — it
    // has no way to know the query already compiled to a real structural AST
    // shape. A pronoun-shortened follow-up ("who touched it") can be exactly
    // 3 words with no STRUCT_WORDS token, so without this guard
    // isConversational would discard a correct, already-composed answer for
    // the generic orientation wall.
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
    // Raw query first (the long-standing contract), then ONE retry with the
    // normalized form — gated to the no-envelope bootstrap ONLY: on the FIRST
    // turn of a graph-less session the ask engine throws before its own
    // normalize pass runs, so a politeness-wrapped vocabulary question
    // ("could you tell me what a dog is") reaches this lane still wearing the
    // wrapper no reader matches. From turn 2 on (envelope present) the
    // pipeline unwraps it upstream, and an unrestricted retry would let
    // normalization-mangled text reach readers whose guards were written for
    // the raw surface (the pronoun-subject identity family).
    const normalizedForFacts = envelope ? null : normalizeQuery(String(query));
    const fact = (await factAnswer(memoryDir, query, envelope, miss, biasByBundle, cache, newFocus?.label))
      ?? (await factReadBack(memoryDir, query, envelope, miss, graph, newFocus?.label, biasByBundle, cache))
      ?? (normalizedForFacts && normalizedForFacts !== String(query).trim()
        ? (await factAnswer(memoryDir, normalizedForFacts, envelope, miss, biasByBundle, cache, newFocus?.label))
          ?? (await factReadBack(memoryDir, normalizedForFacts, envelope, miss, graph, newFocus?.label, biasByBundle, cache))
        : null);
    if (fact) {
      answer = fact.replace ? fact.text : `${answer}\n${fact.text}`;
      // A fact-lane return flagged `miss` is an HONEST MISS in better words
      // (the isa ladder's "I can't confirm that" closers) — the turn record
      // keeps miss=true and via stays untouched, so miss-rate metrics and
      // recall's own miss-gated lanes see it exactly like the wall it replaced.
      // One flagged `selfContainedMiss` already names its own recovery, so
      // the empty-graph orientation pointer below stays off it — a pronoun
      // decline with an index pointer under it is two answers to one turn.
      if (fact.selfContainedMiss) selfContainedMiss = true;
      if (!fact.miss) {
        via = "fact";
        recordMiss = false;
      }
      if (fact.pending) factPending = fact.pending; // a truncated fact list → paginable remainder
      if (typeof fact.trust === "number") entailedTrust = fact.trust; // live-chase trust (see the `entailedTrust` declaration above)
      note(trace, `lane: (3) memory facts — factAnswer/factReadBack matched (memoryDir=${memoryDir})`);
      note(trace, "source: .tmct/memory Facts (see /memory for provenance per line)");
      // Mirrors the TEACH lane's own goal revision below: `deduced` was
      // computed off envelope.parsed alone, but a general-verb direct
      // question ("does margo eat ribs") never parses as a structural graph
      // query at all.
      if (fact.generalVerbQuery) {
        deduced = TAUGHT_FACT_LOOKUP_GOAL;
        note(trace, `goal: ${deduced} (revised — a general-verb direct-question fact lookup answered this turn)`);
      }
    } else if (miss) {
      // W2: after the honest miss is composed, consult the folded-session memory. A
      // relevant enough block ANSWERS — recalled Q/A framed + cited first, with the
      // engine's own miss hint kept below; no hit leaves the miss byte-unchanged.
      const recalled = await recallFromBlocks(memoryDir, query, graph);
      if (recalled) {
        // A successful recall sets recordMiss = false, the SAME flag the
        // composed-path wall-shortening pass gates on, so a recall-then-wall
        // combo needs the identical shortening/repeat-suppression logic
        // applied to the TRAILING miss text here (using the non-anchored
        // WALL_MISS twin, since a repeated recall-then-wall's own last answer
        // is prefixed with the recall frame, not the wall text).
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
    const concept = await conceptForceAnswer(query, envelope, { graph, config, source, memoryDir, templates, cache });
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
        // This force just answered the turn CORRECTLY over a query shape
        // ask()'s own grammar may never have parsed at all — `deduced` would
        // otherwise stay null here even though the answer is real.
        // relation.kind is the SAME GOAL_BY_KIND vocabulary a normally-parsed
        // relation query already deduces its goal line from.
        if (relation.kind && GOAL_BY_KIND[relation.kind]) {
          deduced = GOAL_BY_KIND[relation.kind];
          note(trace, `goal: ${deduced} (revised — the relation concept force answered where the raw parse never stood)`);
        }
        // The pre-force `envelope.canonical` (if any) restates a parse this force
        // just overrode — never a genuine restatement of the answer actually
        // given, so it's dropped rather than shown misleadingly.
        canonical = null;
      }
    }
  }
  // (3b) ONTOLOGY SYNONYM EXPANSION — a LAST-RESORT vocabulary-term retry via
  // known synonyms, tried only once composed/fact/corpus-seon have ALL
  // declined, so it can never hijack a real schema/concept-force answer.
  // Every hit cites its synonym term + licensing corpus source.
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
    const taught = await teachLane(query, { memoryDir, sessionId, lexicon, cache, planHolder, graph, gameConfig });
    if (taught) {
      answer = taught.text; via = taught.via; recordMiss = taught.miss;
      if (!taught.miss) dialogueLaneOverride = "teach";
      note(trace, `lane: (4) TEACH — TEACH_RE/OWNS_TEACH_RE/BARE_DECLARATIVE_RE matched, ${taught.miss ? "but the payload could not be stored" : "reified into .tmct/memory"}`);
      // `deduced` was computed straight off envelope.parsed alone, but the
      // structural grammar has no business parsing a teach-shaped sentence at
      // all, so it would otherwise be confidently WRONG or silently absent.
      // Every successfully-recognized teach attempt gets this consistent goal
      // line instead.
      deduced = "teach/remember a new fact";
      note(trace, `goal: ${deduced} (revised — the teach lane recognized this shape where the raw structural parse never should have)`);
      // A canonical whose verb only matched through the fuzzy edit-distance
      // tier ("disk-1 rests on peg-a." read as an ask about "tests") restates
      // a repair, not the sentence — under a teach confirmation that's
      // misleading, so it's dropped. An exact-vocabulary parse ("father is a
      // kind of parent" as inherits) keeps its canonical: it genuinely
      // restates the relation the teach stored.
      if (envelope?.parsed?.fuzzyVerb) canonical = null;
      // A mid-game locative teach is accepted and stored as the player's own
      // note, but a running adventure's world only moves through actions — so
      // when the taught subject is a term the world already places, the
      // confirmation says so plainly. (The fold itself keeps taught rows out of
      // the world state; this is the matching UX.)
      if (!taught.miss && planHolder?.state?.adventure) {
        const loc = String(query).trim().match(LOCATIVE_TEACH_RE);
        if (loc) {
          let placed = false;
          try {
            const { normFactTerm } = await import("../adapters/memory/core.mjs");
            const world = foldWorldState(await factRows(memoryDir, cache));
            placed = world.placements.has(normFactTerm(loc[1]));
          } catch { placed = false; }
          if (placed) {
            answer = `${answer}\n(noted as your note — the game world itself only changes through actions like go, take and open.)`;
            note(trace, "intermediate: mid-game locative teach — stored as a note; the adventure fold only moves through actions");
          }
        }
      }
    }
  }
  // (4b) #4 AUTHOR lane — "who is <Name>", "what did <Name> touch",
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
  // (4b2) #5(f) PRESUPPOSITION HONEST-NUDGE — "why
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
  // (4c) CAPABILITY NUDGES — risk scoring / code opinions / "write me
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
  // (4d) DESCRIBE-WRAPPER RESCUE — "can you describe X for me" / "tell me
  // more about X": a closed wrapper around an ordinary polite request naming
  // a symbol. Tried ONLY here, after EVERY other lane has already declined —
  // "tell me about inheritance" must keep reaching the relation force's
  // richer answer unmolested. A last-resort rescue, never a competing route:
  // it only claims the turn if /describe actually resolves the captured term.
  if (miss && recordMiss && via === "composed") {
    const described = await describeWrapperAnswer(query, { config, source, focus: newFocus, graph, tel });
    if (described) {
      answer = described.text; via = described.miss ? "miss" : "describe"; recordMiss = !!described.miss;
      note(trace, "lane: (4d) DESCRIBE-WRAPPER RESCUE — a polite wrapper around \"describe/tell me about <symbol>\" resolved via /describe, tried last after every other lane declined");
      note(trace, "goal: get a symbol's definition/kind/relations (phrased conversationally)");
      // Carry the resolved entity forward as the new focus, same class-gated
      // nextFocus() every other resolution path here uses.
      if (described.ent) {
        resolvedIds = [described.ent.id];
        newFocus = nextFocus(graph, newFocus, described.ent);
        note(trace, `result: describe-wrapper resolved "${query}" -> ${described.ent.label} (${described.ent.id}) — becomes the new focus`);
      }
    }
  }
  // (4e) COMPLETIONS RESCUE — wires src/domain/completions/'s extractive
  // multi-sentence pipeline in as a genuine last-resort lane, tried ONLY here,
  // after EVERY lane above has already declined; this lane only fires for an
  // EXPLICIT "detailed summary/overview of how X works" phrasing, a shape
  // neither DESCRIBE_WRAPPER_RE nor vagueTouchTermOf recognizes.
  if (miss && recordMiss && via === "composed") {
    const completed = await completionsRescueAnswer(query, { memoryDir, graph });
    if (completed) {
      answer = completed.text; via = "completion"; recordMiss = false;
      note(trace, "lane: (4e) COMPLETIONS RESCUE — a \"detailed summary/overview of how X works\" phrasing matched, answered via src/domain/completions/'s extractive multi-sentence pipeline (generateCompletion())");
      note(trace, "source: src/domain/completions/complete.mjs generateCompletion() (broadSearch + groupHits + rankSentences + inferRelations + pruneCompletion + finish())");
      note(trace, "goal: produce a grounded, cited, multi-sentence account of the subject (not a single fact/definition)");
    }
  }
  // (4f) COMPARE RESCUE — "how is X different from Y" / "compare X and Y":
  // resolves BOTH named entities (resolveSymbol, the same resolver /describe
  // uses) and renders their comparison (renderCompare, codegraph.mjs). Tried
  // ONLY here, last-resort like (4d)/(4e), since no earlier lane recognizes a
  // two-entity comparison at all. Always a real answer once its pattern
  // matches: either the comparison or an honest stated reason it couldn't be
  // done, never a guess.
  if (miss && recordMiss && via === "composed") {
    const compared = await compareAnswer(query, { graph, config, source });
    if (compared) {
      answer = compared.text; via = "compare"; recordMiss = false;
      note(trace, "lane: (4f) COMPARE RESCUE — a \"how is X different from Y\"/\"compare X and Y\" shape matched, answered via renderCompare (codegraph.mjs)");
      note(trace, "goal: surface the genuine differences between two named entities' facts/edges");
      if (compared.ents.length) {
        const last = compared.ents[compared.ents.length - 1];
        resolvedIds = compared.ents.map((e) => e.id);
        newFocus = nextFocus(graph, newFocus, last);
        note(trace, `result: compare resolved "${query}" -> ${compared.ents.map((e) => e.label).join(" vs ")} — the last-named entity becomes the new focus`);
      }
    }
  }
  // (4g) FUZZY-VERB DECLINE — the keyword strategy's bounded-edit-distance
  // tier rewrites ANY word within one edit of a graph verb, with no check that
  // the typed word is real English: "rest" reads as "test", "during" as
  // "using", "bigger" as "trigger", "behave" as "have", "ball" as "call".
  // Whatever the repaired sentence traverses to answers a DIFFERENT question,
  // and it does not read like one — "does store.mjs rest on app.mjs" comes
  // back "No — no tests edge found", and a reader takes the No. So name the
  // rewrite and refuse, dropping both halves of the receipt with it (a receipt
  // for a question nobody asked is the same wrong answer in smaller type).
  //
  // Tried HERE, after every rescue lane above has already declined, for the
  // same reason (4d)/(4e)/(4f) are: a repaired sentence some other lane can
  // answer keeps that answer untouched. This only ever replaces the repaired
  // parse's OWN standing reply.
  //
  // A real English word never reaches here: the repair tier's own collision table
  // (src/domain/real-word-collisions.json) refuses it before any distance is
  // measured, so "rest" misses as itself. What is left for this lane is a NON-word
  // that repaired onto a verb whose lemma differs from the word it came from —
  // "impotr" still repairs to "import" and answers, because they share one.
  if (miss && recordMiss && via === "composed" && envelope?.parsed?.fuzzyVerb) {
    const { from, to } = envelope.parsed.fuzzyVerb;
    if (!(await repairSharesLemma(from, to))) {
      answer = `I read "${from}" as "${to}", which asks a different question — so I won't answer it. `
        + `"${from}" isn't a relation I record. Say the relation you mean, or /help for the query shapes I read.`;
      via = "miss";
      canonical = null;
      deduced = null;
      note(trace, `lane: (4g) FUZZY-VERB DECLINE — "${from}" only became a verb through the edit-distance repair tier ("${to}"), and the two words are different verbs, so the repaired sentence's graph answer is dropped rather than shown as an answer to what was typed`);
    }
  }
  // (4h) LEARN-ON-MISS PACKS — the cleanest miss consults the shipped packs:
  // a definition-shaped term the lexicon knows, no graph entity, no
  // remembered fact. The CHILD triples pack goes first (facts before prose):
  // a hit appends the term's triples under child provenance and the SAME
  // question is re-asked from the store, so the answer is an ordinary cited
  // fact answer. Only when the store still cannot answer does the reference
  // pack's article speak, cited as before. Both packs missing leaves the
  // honest miss byte-identical.
  if (miss && recordMiss && via === "composed" && memoryDir) {
    const refTerm = metaTermOf(query, envelope);
    const key = refTerm ? await cleanMissPackKey(refTerm, { graph, memoryDir, lexicon, cache }) : null;
    const learned = key ? await childPackFactsForKey(key, { memoryDir, env, cache, synthesisBudget }) : null;
    if (learned) {
      const fact = (await factAnswer(memoryDir, query, envelope, miss, biasByBundle, cache, newFocus?.label))
        ?? (await factReadBack(memoryDir, query, envelope, miss, graph, newFocus?.label, biasByBundle, cache));
      if (fact && !fact.miss) {
        answer = fact.replace ? fact.text : `${answer}\n${fact.text}`;
        via = "fact";
        recordMiss = false;
        if (fact.pending) factPending = fact.pending;
        note(trace, "lane: (4h) CHILD PACK — a clean miss on a lexicon term pulled the term's triples from the shipped child pack into memory, and the question was re-answered from the store");
        note(trace, `source: child pack ${CHILD_PACK_NAME} — ${learned.count} fact(s) appended as ${childProvenanceTag(key)}, answer served from .tmct/memory Facts`);
      }
    }
    if (miss && recordMiss && via === "composed" && key) {
      const ref = await referencePackAnswerForKey(key, env);
      if (ref) {
        answer = ref.text;
        via = "reference";
        recordMiss = false;
        note(trace, "lane: (4h) REFERENCE PACK — a clean miss on a lexicon term answered from the shipped reference pack, cited");
        note(trace, `source: reference pack ${REFERENCE_PACK_NAME} — article "${ref.article.title}" (revid ${ref.article.revid})`);
        await ingestReferenceArticle(memoryDir, ref.key, ref.article, cache, referenceProvenanceTag, lexicon, synthesisBudget);
      }
    }
    // The live Wikipedia supplement (opt-in), strictly AFTER both shipped
    // packs: its own gate (no lexicon-membership wall) may pass where the
    // pack gate could not, and a null/throwing lookup leaves the honest
    // miss byte-identical to a live-off run.
    if (miss && recordMiss && via === "composed" && liveReference && refTerm) {
      const liveKey = await cleanMissLiveKey(refTerm, { graph, memoryDir, lexicon, cache });
      const live = liveKey ? await liveReferenceAnswerForKey(liveKey, onLiveLookup) : null;
      if (live) {
        answer = live.text;
        via = "reference";
        recordMiss = false;
        note(trace, "lane: (4h) LIVE WIKIPEDIA — a clean miss answered from a live en.wikipedia.org lookup (opt-in), cited");
        note(trace, `source: live reference ${LIVE_PACK_NAME} — article "${live.article.title}" (revid ${live.article.revid})`);
        await ingestReferenceArticle(memoryDir, live.key, live.article, cache, liveProvenanceTag, lexicon, synthesisBudget);
      }
    }
  }
  // (5) #1 SHORT TAILORED MISS — replace ONLY the engine's full grammar cheat-sheet
  // wall (WALL_MISS_RE). Receipt-bearing misses keep their specific wording.
  // WALL KINDNESS: a second consecutive wall collapses to a one-liner whose
  // text does NOT match WALL_MISS_RE — self-limiting, so a third consecutive
  // miss re-offers the tailored hint instead of droning.
  let genericWallMiss = false;
  if (miss && recordMiss && via === "composed" && WALL_MISS_RE.test(answer)) {
    const repeat = last?.answer && WALL_MISS_RE.test(String(last.answer));
    // A GRAPH-LESS session's wall must not hand a vocabulary question a list
    // of import/calls shapes — that guidance is aimed at an audience that
    // isn't in the room. Offer what THIS session can answer instead.
    answer = repeat ? WALL_REPEAT_ONELINER
      : (noCodeGraph(graph) && vocabHint
        ? `I couldn't read that as a question I can answer. ${vocabHint} Type /help for all query shapes.`
        : shortMissHint(query));
    via = "miss";
    genericWallMiss = true;
    note(trace, `lane: (5) SHORT TAILORED MISS — every lane above declined; ${repeat ? "REPEAT collapsed to one-liner (wall kindness)" : "the full grammar wall was shortened + tailored to the query's keywords"}`);
  }
  // TEACH-OFFER (computed first, applied after the polish below): a "what is
  // X" miss where X is genuinely unknown EVERYWHERE — not a real graph
  // entity, not a schema/vocab term, and not already in memory. Computed
  // ahead of the empty-graph polish because the two are alternative
  // recoveries for the same dead-end: a miss that is about to offer the
  // teach lane must not ALSO grow an index-this-repo pointer, or one
  // unparsed turn stacks three separate messages.
  let teachOffer = null;
  if (recordMiss && (via === "composed" || via === "miss") && memoryDir) {
    // "what do you know about X" is its OWN sibling shape — checked FIRST,
    // without a resolveEntity(graph) gate: it's inherently a MEMORY question,
    // so "nothing yet, teach me" is appropriate even when X is also a real
    // graph entity.
    // Contraction-expanded, so "what's X" earns the same offer "what is X"
    // does. Both shapes below anchor on the written-out copula.
    const offerSrc = expandContractions(String(query).trim());
    const knowAboutTerm = offerSrc.match(KNOW_ABOUT_RE)?.[1]?.trim();
    const offerTerm = knowAboutTerm || metaTermOf(offerSrc, envelope);
    // A term that LEADS with a bindable anaphor ("it used for", from an
    // unresolved "what is it used for") is a pronoun that failed to bind,
    // not a teachable subject — offering to learn facts about it would echo
    // the garble back as an invitation to store it.
    const anaphorLedTerm = offerTerm && /^(?:it|this|that|these|those|them)\b/i.test(offerTerm.trim());
    if (offerTerm && !anaphorLedTerm) {
      let normFactTerm;
      try { ({ normFactTerm } = await import("../adapters/memory/core.mjs")); } catch { normFactTerm = null; }
      if (normFactTerm) {
        const cleanTerm = normFactTerm(offerTerm);
        const ent = knowAboutTerm ? null : await resolveEntity(graph, offerTerm);
        if (!ent) {
          const variants = factTermVariants(normFactTerm, offerTerm);
          const known = (await memoryFacts(memoryDir)).some((f) => variants.has(f.subject) || variants.has(f.object));
          if (!known) teachOffer = unknownVocabTermOffer(cleanTerm);
        }
      }
    }
  }
  // #4 HONEST-EMPTY POLISH — an empty CODE graph: any still-standing engine
  // dead-end (an honest empty, the short miss, the bootstrap note) carries the
  // exit toward a real graph, unless it already points there — or unless the
  // turn already names its own recovery (a self-contained decline, or a
  // teach-offer about to land). Only when genuinely empty. The CLI keeps the
  // --repo/example pointer verbatim; a browser or a live adventure has no
  // such command to reach for, so each gets a teach-forward pointer (and the
  // adventure also names the world asides that are guaranteed to hit).
  // A live adventure keeps its polish even beside a teach-offer: the world
  // asides ("look", "talk to the butler") are guidance the offer can't carry.
  const adventureLive = !!planHolder?.state?.adventure;
  if (recordMiss && (via === "composed" || via === "miss") && !selfContainedMiss
      && (adventureLive || !teachOffer)
      && noCodeGraph(graph) && !/--repo|tmct init|no code graph/i.test(answer)) {
    if (adventureLive) {
      answer = `${answer}\n(I don't know that yet — you can teach me: say "remember: <thing> is a <kind>". Or ask the world: "look", "where is the key", "talk to the butler".)`;
      note(trace, "intermediate: HONEST-EMPTY POLISH — a live adventure miss points at the teach lane and the world asides, not the --repo remedy");
    } else if (browser) {
      answer = `${answer}\n(I don't know that yet — you can teach me: say "remember: <thing> is a <kind>".)`;
      note(trace, "intermediate: HONEST-EMPTY POLISH — a browser miss points at the teach lane, not the CLI-only --repo remedy");
    } else {
      answer = `${answer}\n(this repo has no code graph — index it with \`tmct index\`, point me at a \`.tmct/graph.json\` with \`--repo <path>\`, or run \`npm run example:mini\`.)`;
      note(trace, "intermediate: HONEST-EMPTY POLISH — the loaded graph has 0 modules, so the dead-end got a tmct index/--repo pointer appended");
    }
  }
  if (teachOffer) {
    // On a GENERIC wall (the shortened "couldn't read that", or the
    // graph-less bootstrap wall) the offer IS the whole answer — the wall
    // names no term, so keeping it above the offer stacks two messages
    // where one carries everything. A receipt-bearing specific miss keeps
    // the offer appended beneath it, unchanged.
    const genericWall = genericWallMiss || answer.startsWith(NO_GRAPH_BOOTSTRAP_WALL_LEAD);
    answer = genericWall ? teachOffer : `${answer}\n${teachOffer}`;
    note(trace, `intermediate: TEACH-OFFER — the term is unknown to both the graph and memory, so the miss ${genericWall ? "collapsed to the offer to learn" : "got an offer to learn appended"}`);
  }
  // COLLISION RESTORE (pairs with relaxedTeachCollision, above): if nothing in
  // the would-miss cascade actually stored/answered anything, fall back to
  // the ORIGINAL ask-engine answer computed before this turn was forced into
  // the would-miss cascade — a real graph answer beats any generic miss/wall
  // text.
  if (relaxedTeachCollision && recordMiss) {
    answer = preCollisionAnswer;
    via = "composed";
    recordMiss = false;
    deduced = preCollisionDeduced;
    note(trace, "lane: COLLISION RESTORE — the teach-shaped declarative wasn't storable after all; the original ask-engine (graph) answer stands, untouched");
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
  // Counterfactual marker: "if X were deleted, what would break" compiles to a REAL traversal
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
  // LIVE SUPPLEMENT (/wiki supplement, and its superset /wiki always): a
  // grounded answer also carries what Wikipedia says about its subject —
  // corroboration, not rescue. Scoped to a clean vocabulary subject (a
  // "what is X" / "tell me about X" term), never doubled onto an answer that
  // already IS a Wikipedia read-out. Failure-tolerated, and network-gated by
  // the same toggle (both values are truthy, so the rescue lanes above already
  // ran). "always" widens the term fallback to an ordinary grounded ask's own
  // parsed object, so a plain code/fact answer also gets corroborated; the
  // adapter's throttle bounds the request rate.
  if ((liveReference === "supplement" || liveReference === "always") && !recordMiss && via !== "reference") {
    const supplementTerm = metaTermOf(query, envelope) || vagueTouchTermOf(query)
      || (liveReference === "always" ? envelope?.parsed?.object : null);
    let liveKey = null;
    try { liveKey = supplementTerm ? cleanMissLiveTerm(supplementTerm, lexicon ?? undefined) : null; } catch { liveKey = null; }
    const live = liveKey ? await liveReferenceAnswerForKey(liveKey, onLiveLookup) : null;
    if (live) {
      answer = `${answer}\nWikipedia adds: ${live.text}`;
      await ingestReferenceArticle(memoryDir, live.key, live.article, cache, liveProvenanceTag, lexicon, synthesisBudget);
      note(trace, `intermediate: LIVE SUPPLEMENT — appended a cited en.wikipedia.org read-out for "${supplementTerm}" (supplement mode)`);
    }
  }
  // The concept force answers WITH real example instances — those are the entities the
  // turn "asked about" (the SchemaClass meta-node is documentation, not a code entity),
  // so record + expand them, not the schema match.
  const finalAnsweredIds = conceptInstances ? conceptInstances.map((i) => i.id) : answeredIds;
  const record = {
    type: "turn", ts, query, via, resolvedIds, answeredIds: finalAnsweredIds, miss: recordMiss,
    // English gloss + machine-parsable notation — off ask.mjs's own
    // `tmct_ask.canonical`, revised to null when the relation force answered
    // over a parse it overrode. `null` otherwise only on an honest grammar miss.
    canonical,
    // Premise-derived trust for a LIVE-CHASE-ONLY entailment answer; omitted
    // entirely when this turn didn't answer via one of those.
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
  // MULTI-HOP STACCATO CHAIN CONTINUATION: when discourseRewrite substituted
  // a new subject into the PRIOR query's shape ("and Widget?" -> "what calls
  // Widget") and it STRUCTURALLY PARSED, thread the RECONSTRUCTED positive
  // query forward as `last.query`, not the raw staccato text — else a 3rd
  // staccato swap in a row rewrites off the 2nd turn's own clause-less
  // staccato input instead of the real prior query.
  const effectiveQuery = (askQuery !== query && envelope?.parsed) ? askQuery : null;
  // `goal`: the SAME deduced string the debug trace's own "goal:" line
  // carries. Only runAsk ever sets this field, so the always-on goal line is
  // scoped to real ask-engine turns by construction.
  // `lane`: the dialogue-act lane — a lane's own override, else the
  // question-shape lookup — resolved to an ISO act by runTurn's withLast.
  const lane = dialogueLaneOverride ?? askDialogueLane(envelope?.parsed, query, recordMiss);
  return { answer, logLines, record, focus: newFocus, detail, effectiveQuery, goal: deduced, lane, ...(planResult ? { plan: planResult } : {}) };
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
      // See runAsk's own `record.canonical`; `null` is the honest default
      // here (a bare command confirmation, an orientation card, a count).
      canonical,
    },
    focus,
  };
}

// A command name -> a short, honest one-line goal string, mirroring
// GOAL_BY_KIND's own spirit but for COMMAND dispatches (find/search/describe/…).
// Reuses GOAL_BY_KIND's EXISTING wording wherever a command's intent overlaps
// one of those kinds, rather than inventing new phrasing for the same concept.
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
  capabilities: "see what /plan can plan over — built-in query tools and taught actions",
  syllogise: "materialize the entailed facts that follow from what's remembered about one term",
  wiki: "toggle the live Wikipedia supplement for questions nothing local can answer",
  export: "write the memory store to a file, in the standard JSONL shape",
  ingest: "read a local text file and store every fact the recognizer grounds from it",
};

/** A slash-command → the mapped tool (or the /help, /focus, /narrate, unknown
 *  cases). Returns the same { answer, logLines, record, focus } shape as
 *  runAsk. Also carries a `goal` field mirroring runAsk's own, so
 *  withGoalLine's "Goal (inferred): …" line fires for command dispatches too. */
async function runCommand(line, { config, source, graph, focus, memoryDir, trace, narrate = false, liveReference = false, tel = null, biasByBundle = {}, cache = null }) {
  const ts = new Date().toISOString();
  const sp = line.indexOf(" ");
  const name = (sp === -1 ? line.slice(1) : line.slice(1, sp)).toLowerCase();
  const argText = (sp === -1 ? "" : line.slice(sp + 1)).trim();
  const mk = (answer, { resolvedIds = [], miss = false, newFocus = focus, narrateNext, liveReferenceNext } = {}) => ({
    answer,
    logLines: [ts, `> ${line}`, answer, ""],
    record: { type: "turn", ts, query: line, command: name, via: "command", resolvedIds, answeredIds: [], miss },
    focus: newFocus,
    goal: GOAL_BY_COMMAND[name] || "use a specific tool/command directly",
    ...(narrateNext !== undefined ? { narrate: narrateNext } : {}),
    ...(liveReferenceNext !== undefined ? { liveReference: liveReferenceNext } : {}),
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

  // /wiki on|off — the live Wikipedia supplement toggle (session-scoped,
  // exactly the /narrate pattern: the new state rides the turn RESULT as
  // `liveReference`, and each session shell applies it to its own mutable
  // state). A bare "/wiki" reports the CURRENT state and changes nothing.
  if (name === "wiki") {
    const arg = argText.toLowerCase();
    const stateWord = (v) => (v === "always" ? "always" : v === "supplement" ? "supplement" : v ? "on" : "off");
    if (arg !== "on" && arg !== "off" && arg !== "supplement" && arg !== "always") {
      return mk(`live Wikipedia supplement is ${stateWord(liveReference)} — /wiki on, /wiki off, /wiki supplement, or /wiki always. `
        + "When on, a question I can't answer also tries en.wikipedia.org (network); "
        + "supplement adds a cited Wikipedia read-out under every grounded vocabulary answer too; "
        + "always widens that to every grounded answer.");
    }
    const next = arg === "always" ? "always" : arg === "supplement" ? "supplement" : arg === "on";
    return mk(`live Wikipedia supplement ${stateWord(next)}.`, { liveReferenceNext: next });
  }

  // /memory [verbose] — what tmct remembers, as text (the same renderer
  // serves the `tmct memory` CLI).
  if (name === "memory") {
    note(trace, "goal: inspect tmct's memory store (facts/utterances/sessions)");
    if (!memoryDir) return mk("no memory store here — /memory works inside a repo session.", { miss: true });
    try {
      const { inspectMemory } = await import("../adapters/memory/inspect.mjs");
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

  // /capabilities — everything a /plan request can plan over: the built-in
  // read-only graph-query tools, plus the taught action families read straight
  // from this store (they only live in the registry inside a /plan request,
  // so listing them means reading the rules, not the registry).
  if (name === "capabilities") {
    note(trace, "goal: see what /plan can plan over — built-in query tools and taught actions");
    const { declaredCapabilityNames } = await import("../domain/router/drive.mjs");
    const { actionFamilies, capabilityFromActionRules } = await import("../domain/router/taught.mjs");
    const lines = [`read-only graph tools: ${declaredCapabilityNames().join(", ")}`];
    let families = new Map();
    if (memoryDir) {
      try {
        const { loadMemory, readRuleRows } = await import("../adapters/memory/core.mjs");
        families = actionFamilies(readRuleRows(await loadMemory(memoryDir)));
      } catch { /* an unreadable store lists like an empty one */ }
    }
    if (!families.size) {
      lines.push('taught actions: none yet — teach one ("you can move a disk onto a peg.") and /plan can use it.');
    } else {
      lines.push("taught actions (planned over, never dispatched):");
      for (const [familyName, family] of [...families.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const cap = capabilityFromActionRules(familyName, family);
        const sig = cap.parameters
          .map((p) => `${p.name}: ${p.classes.filter(Boolean).join("|") || "?"}`)
          .join(", ");
        lines.push(`  taught:${familyName} — ${sig}`);
      }
    }
    return mk(lines.join("\n"));
  }

  // /syllogise <term> — forward-chain what's remembered about <term> into
  // entailed facts and WRITE them to the store, so a chain too long for the
  // live isa ladder to walk becomes a single stored step it can read.
  //
  // This is the one chat surface that writes derived facts. Every live chase
  // in this file is read-only on purpose, and that stays true: a slash command
  // is an explicit request, not the hot path an ordinary question runs down.
  // Nothing here is a guess — each written fact carries `entailed:*`
  // provenance, a justification citing its premises, and a trust discounted
  // below the premises it rode.
  //
  // The term is an ARGUMENT rather than the session focus, and the two are
  // different things wearing the same name: this focus is a set of class
  // TERM strings, while chat's `focus` is a {id,label} code-graph entity, so
  // passing the standing focus here would be a category error. Omitting it
  // is worse than useless — a whole-store pass on a real store spends the
  // budget on facts nobody asked about and can be truncated before it reaches
  // the term you cared about. /plan is the precedent: a command that takes an
  // argument and honestly refuses without one.
  if (name === "syllogise") {
    note(trace, "goal: materialize the entailed facts that follow from what's remembered about one term");
    if (!memoryDir) return mk("no memory store here — /syllogise works inside a repo session.", { miss: true });
    if (!argText) {
      return mk('/syllogise needs a term, e.g. `/syllogise poodle` — it closes over what I remember about that term.', { miss: true });
    }
    try {
      const { syllogise } = await import("../domain/syllogise.mjs");
      const { loadMemory, readFactRows, appendFacts, normFactTerm } = await import("../adapters/memory/core.mjs");
      const res = await syllogise(memoryDir, {
        focus: [...factTermVariants(normFactTerm, argText)],
        store: { loadMemory, readFactRows, appendFacts },
      });
      note(trace, `result: derived ${res.count} entailed fact(s) (depth ${res.depth}, budget ${res.budget})`);
      if (!res.count) {
        return mk(`nothing new follows from what I remember about "${argText}" — no entailed facts derived (depth ${res.depth}, budget ${res.budget}).`, { miss: true });
      }
      const lines = [`derived ${res.count} entailed fact(s) from what I remember about "${argText}":`];
      for (const d of res.derived) lines.push(`  ${d.subject} ${d.rule} ${d.object} (via ${d.via})`);
      // A truncated pass that still can't answer the question is worse than no
      // offer at all, so the budget wall is stated rather than left implied by
      // a count that happens to equal it.
      if (res.truncated) {
        lines.push(`budget of ${res.budget} reached — more may follow; run \`tmct syllogise --budget <n>\` for a wider pass.`);
      }
      lines.push("These are derived, not taught — /memory shows each one's provenance and premises.");
      return mk(lines.join("\n"));
    } catch (e) {
      return mk(String(e?.message || e), { miss: true }); // a broken store reads as its own clean error
    }
  }

  // /export <path> — write the whole memory store as JSONL, the SAME shape
  // `tmct memory --export` and the tmct_export cold tool already emit
  // (serializeFactsJsonl, export-jsonl.mjs) — so a chat session can take its
  // facts with it without dropping to a shell.
  if (name === "export") {
    note(trace, "goal: write the memory store to a file, in the standard JSONL shape");
    if (!memoryDir) return mk("no memory store here — /export works inside a repo session.", { miss: true });
    if (!argText) return mk("/export needs a path, e.g. `/export facts.jsonl`.", { miss: true });
    try {
      const { loadMemory } = await import("../adapters/memory/core.mjs");
      const { serializeFactsJsonl } = await import("../adapters/memory/export-jsonl.mjs");
      const { writeFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const jsonl = serializeFactsJsonl(await loadMemory(memoryDir));
      const out = resolve(process.cwd(), argText);
      await writeFile(out, jsonl, "utf8");
      const count = jsonl ? jsonl.trimEnd().split("\n").length : 0;
      note(trace, `result: wrote ${count} fact(s) to ${out}`);
      return mk(`wrote ${count} fact${count === 1 ? "" : "s"} to ${argText}.`);
    } catch (e) {
      return mk(String(e?.message || e), { miss: true }); // a broken store/path reads as its own clean error
    }
  }

  // /ingest <path> — the TUI/CLI counterpart to `tmct extract`: read a local
  // text file, run each sentence through the SAME recognizer the teach lane
  // already grounds sentences with (runTurn itself — the identical per-
  // sentence pass extract-facts.mjs's own CLI wrapper runs), and store every
  // grounded fact into THIS session's own memory store. Deliberately does
  // NOT call extract-facts.mjs's own main(): that entry point resolves its
  // OWN memoryDir from a --repo path (or an ephemeral scratch dir), so it
  // can never target the session's already-open backend handle — grounding
  // through this session's live memoryDir is what makes an ingested fact
  // answerable in the SAME conversation, not just written to disk somewhere.
  if (name === "ingest") {
    note(trace, "goal: ingest a local text file into the memory store, sentence by sentence");
    if (!memoryDir) return mk("no memory store here — /ingest works inside a repo session.", { miss: true });
    if (!argText) return mk("/ingest needs a path, e.g. `/ingest notes.txt`.", { miss: true });
    const { resolve } = await import("node:path");
    const { readFile } = await import("node:fs/promises");
    const filePath = resolve(process.cwd(), argText);
    let text;
    try {
      text = await readFile(filePath, "utf8");
    } catch (e) {
      return mk(`couldn't read ${argText} — ${e?.code === "ENOENT" ? "no such file." : String(e?.message || e)}`, { miss: true });
    }
    const { splitSentencesPreservingPaths } = await import("./sentences.mjs");
    const { loadMemory, readFactRows, appendFact } = await import("../adapters/memory/core.mjs");
    const { touchedFactRows } = await import("../domain/memory/touched-facts.mjs");
    const sourceTag = filePath.split(/[\\/]/).pop();
    const sentences = splitSentencesPreservingPaths(text);
    let recognizedSentences = 0;
    let factCount = 0;
    for (const sentence of sentences) {
      const before = readFactRows(await loadMemory(memoryDir));
      const { record: ingestRecord } = await runTurn(sentence, { config, memoryDir, sessionId: uuidv7() });
      if (ingestRecord?.via !== "assert" || ingestRecord?.miss) continue;
      const after = readFactRows(await loadMemory(memoryDir));
      const rows = touchedFactRows(before, after);
      if (!rows.length) continue;
      recognizedSentences += 1;
      for (const row of rows) {
        await appendFact(memoryDir, {
          subject: row.subject, predicate: row.predicate, object: row.object,
          provenance: `extracted:${sourceTag}`, quantifier: row.quantifier || "",
        });
        factCount += 1;
      }
    }
    if (cache) cache.rows = null; // the fact-rows cache predates these writes
    const skipped = sentences.length - recognizedSentences;
    note(trace, `result: ${sentences.length} sentence(s), ${recognizedSentences} recognized, ${factCount} fact row(s), ${skipped} skipped`);
    if (!factCount) {
      return mk(
        `read ${sentences.length} sentence${sentences.length === 1 ? "" : "s"} from ${argText} — none grounded into a `
        + "recognized fact shape (an honest, expected gap; this is an attempt, not full NLU).",
        { miss: true },
      );
    }
    return mk(
      `ingested ${factCount} fact${factCount === 1 ? "" : "s"} from ${argText} `
      + `(${recognizedSentences} of ${sentences.length} sentence${sentences.length === 1 ? "" : "s"} recognized).`,
    );
  }

  // /plan <request> — the capability router (src/domain/router/*): plan+execute a
  // compound ("of the modules impacted by X, which are untested", "assess X
  // and then check Y") or maintenance-goal ("what most needs a test") request
  // over the SAME read-only graph-query tools the other commands dispatch.
  // Reuses this turn's already-loaded `graph`/`config`/`source` — no reload.
  if (name === "plan") {
    note(trace, "goal: plan/execute a compound or maintenance-goal request over the graph (the capability router)");
    if (!argText) return mk("/plan needs a request, e.g. `/plan of the modules impacted by X, which are untested`.", { miss: true });
    if (!graph) return mk("no graph loaded — /plan needs a code graph to plan over.", { miss: true });
    const { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } = await import("../domain/router/drive.mjs");
    const planCtx = await buildCapabilityPlanCtx({ ...capabilityPlanDeps(), config, source, tel, graph, memoryDir });
    try {
      const result = await runCapabilityPlan(argText, declaredCapabilityNames(), planCtx);
      if (result.refused) {
        const why = Array.isArray(result.why) ? result.why.join("; ") : result.why;
        const c1Why = result.c1Why && (Array.isArray(result.c1Why) ? result.c1Why.join("; ") : result.c1Why);
        note(trace, `result: no plan found — ${why}`);
        return mk(`no plan found — ${why}${c1Why ? ` (the direct router also declined: ${c1Why})` : ""}`, { miss: true });
      }
      note(trace, `result: ${result.driver} — ${result.calls.length} step(s)`);
      const lines = [`driver: ${result.driver}`, "", "steps:"];
      result.calls.forEach((c, i) => lines.push(`  ${i + 1}. ${c.name} ${JSON.stringify(c.input || {})}`));
      if (result.composed !== undefined && result.composed !== null) {
        lines.push("", `composed answer (${result.composed.length}): ${result.composed.length ? result.composed.join(", ") : "(empty set)"}`);
      } else if (result.observed) {
        lines.push("", result.observed);
      }
      return mk(lines.join("\n"));
    } finally {
      // The taught registrations are per-ctx; unregister so the next /plan
      // turn re-reads the store instead of meeting a stale name collision.
      for (const dispose of planCtx.disposers || []) dispose();
    }
  }

  const spec = COMMANDS[name];
  if (!spec) {
    note(trace, `pattern: /${name} is not a registered command (see COMMANDS in src/services/chat.mjs)`);
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
  // A bare English "describe the logger module" is short enough that
  // asBareCommand already rewrote it into a literal slash command before this
  // function ever sees it, so describeGrainRescue's OWN lane
  // (describeWrapperAnswer) never runs for this shape — the rescue has to
  // happen HERE too, before dispatchTool's resolveSymbol (no article/grain-word
  // tolerance).
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
      // /describe's code-map render never sees memory, so a taught fact about
      // the resolved entity is invisible to it without this — append
      // matching taught facts (subject === the resolved entity, trust-ranked)
      // under the code-map answer, mirroring the ask-path's fact-append pattern.
      if (name === "describe" && memoryDir) {
        const facts = await describedFacts(memoryDir, ent.label, biasByBundle, cache);
        if (facts) { answer = `${answer}\n${facts}`; note(trace, "source: memory facts (describedFacts) appended to the code-map answer"); }
      }
      return mk(answer, { resolvedIds: [ent.id], newFocus: nextFocus(graph, focus, ent) });
    }
    note(trace, `intermediate: "${value}" did not resolve to a single entity — the tool's own (unresolved) answer stands`);
  }
  return mk(answer);
}

/** Render an ambiguous assertTurn's response: restate the ask as canonical
 *  prose, then present EVERY surviving reading's would-be triples, each
 *  labeled by which token that reading reads as the verb. Same "this could
 *  mean more than one thing" wording ask.mjs's own query-side disambiguation
 *  uses. Nothing is written to memory — an ambiguous sentence has no single
 *  fact tmct can honestly commit to. */
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
 *  AMBIGUITY: checked FIRST, via the additive parseAceAmbiguous (grammar/ace.mjs)
 *  — a breadth-first scan that survives every verb-position split rather than
 *  committing to the first. Returns null for the overwhelming majority of
 *  sentences, so every single-reading sentence renders byte-identically to
 *  the unchanged parseAce path below. */
/** Does this sentence match the general-verb teach frame on its own terms —
 *  reusing generalVerbTeach's OWN closed guards, so the split gate and the lane
 *  it feeds can never disagree about which sentences that lane accepts. */
function matchesGeneralVerbTeachFrame(sentence) {
  if (GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(sentence)) return false;
  const m = sentence.match(GENERAL_VERB_TEACH_RE);
  if (!m) return false;
  const [, subject, verb] = m;
  return !GENERAL_VERB_EXCLUDE_RE.test(verb)
    && !GENERAL_VERB_NOT_A_VERB_RE.test(verb)
    && !GENERAL_VERB_DETERMINER_RE.test(subject)
    && !GENERAL_VERB_IMPERATIVE_SUBJECT_RE.test(subject);
}

/** Does this sentence stand alone as a teach — a clean ACE triple, a taxonomy
 *  declaration, the comparative frame, or the general-verb frame? A question
 *  never counts.
 *
 *  Each entry names a teach lane that accepts the sentence ALONE, so the set
 *  here has to track that lane list or a line of real teach sentences goes to
 *  the parser glued together. The comparative was missing, and the cost was on
 *  a shipped surface: data/games/hanoi-3.txt's own board line
 *  ("disk-1 is smaller than disk-2. disk-1 is smaller than disk-3.") stored
 *  NOTHING, so disk-1 could never move and the recipe's promised solution did
 *  not exist. The sibling lines on either side of it split correctly, which is
 *  what made it invisible. */
function sentenceTeachesAlone(sentence, parseAce, lex) {
  const s = String(sentence).trim();
  if (!s || s.includes("?")) return false;
  const parse = parseAce(s, lex);
  if (parse && parse.triples?.length && !parse.residue?.length) return true;
  return DECLARATIVE_KIND_OF_RE.test(s) || COMPARATIVE_TEACH_RE.test(s)
    || RENDERS_AS_TEACH_RE.test(s) || matchesGeneralVerbTeachFrame(s);
}

/** Does every sentence of a multi-sentence line teach on its own? Then the line
 *  is a teach line, and each sentence belongs in its own turn: handed over
 *  glued, the first sentence's teach frame captures all the others as its
 *  object ("disk-1 rests on disk-2. disk-2 rests on disk-3." stores an object of
 *  "on disk-2. disk-2 rests on disk-3"). Any parse failure answers false and
 *  leaves the unsplit line to the ordinary lanes. */
async function everySentenceTeaches(sentences, lexicon) {
  try {
    const { parseAce } = await import("../domain/grammar/ace.mjs");
    let lex = lexicon;
    if (!lex) { const { loadLexicon } = await import("../domain/grammar/lexicon.mjs"); lex = loadLexicon(); }
    return sentences.every((sentence) => sentenceTeachesAlone(sentence, parseAce, lex));
  } catch {
    return false;
  }
}

async function assertTurn(line, { memoryDir, sessionId, focus, lexicon = null, cache = null }) {
  // A trailing "?" marks a question, and a question never writes — the ACE
  // fragment happily parses "dog have tail?" as the declarative it is not,
  // which stored a Fact at teach trust over a FLOW-0 vocabulary question.
  if (/\?\s*$/.test(String(line).trim())) return null;
  try {
    const { parseAce, parseAceAmbiguous } = await import("../domain/grammar/ace.mjs");
    // A session handle carries its own loaded lexicon (createSession loads it once);
    // a bare runTurn (no handle) lazy-loads the cached core lexicon. The lexicon is
    // immutable, so sharing one reference across concurrent handles is re-entrant.
    let lex = lexicon;
    if (!lex) { const { loadLexicon } = await import("../domain/grammar/lexicon.mjs"); lex = loadLexicon(); }
    const ambiguous = parseAceAmbiguous(line, lex);
    if (ambiguous) {
      const { normFactTerm } = await import("../adapters/memory/core.mjs");
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
    const { assertSentence } = await import("../domain/grammar/assert.mjs");
    const { normFactTerm, appendFact } = await import("../adapters/memory/core.mjs");
    // A REFLEXIVE disjointness ("no dog is a dog") is a self-contradiction,
    // not a fact — the same refusal the teach lane's negative-universal frame
    // gives the out-of-lexicon spelling, so the two surfaces can't disagree.
    const reflexiveDisjoint = parse.triples.find(
      (t) => t.predicate === "owl:disjointWith" && normFactTerm(t.subject) === normFactTerm(t.object),
    );
    if (reflexiveDisjoint) {
      const term = normFactTerm(reflexiveDisjoint.subject);
      return plainTurn(line,
        `I can't store "no ${term} is a ${term}" — every ${term} is a ${term} by definition, so that exclusion contradicts itself. Nothing was stored.`,
        { command: "assert", via: "teach-miss", miss: true, focus });
    }
    const ts = new Date().toISOString();
    const res = await assertSentence(memoryDir, line, {
      lexicon: lex,
      provenance: { source: "chat", sessionId, ts },
      appendFact,
    });
    if (!res || !res.ids?.length) return null;
    // A plain universal "every X is a Y" ALSO records the "every" quantifier
    // on the SAME fact — purely additive, for the "how many Xs are Ys" recall
    // lane. Gated on the literal typed determiner: only "every" reads as a
    // class-level generalization. Best-effort: the base fact is already
    // durably stored either way, so a failure here is swallowed.
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
    // A paraphrase of the confirmation sits NEXT TO the literal one, never
    // instead of it, and only when its accuracy is checked via syllogise.mjs's
    // own transitive-closure machinery against the SAME pre-existing taught
    // edges — never an unverified paraphrase. Scoped to the single-triple
    // rdfs:subClassOf shape.
    let paraphraseSuffix = "";
    if (res.triples.length === 1 && res.triples[0].predicate === SUBCLASS_PREDICATE) {
      try {
        const { paraphraseVerifiedSubClass } = await import("../domain/paraphrase.mjs");
        // Normalized (same normFactTerm cleanup `shown` above already applies)
        // so the generated paraphrase text reads like "cache is a kind of
        // component", never a raw lexicon-prefixed form like "tmct:cache".
        const newSubj = normFactTerm(res.triples[0].subject);
        const newObj = normFactTerm(res.triples[0].object);
        const priorRows = (await factRows(memoryDir, cache))
          .filter((f) => !(normFactTerm(f.subject) === newSubj && normFactTerm(f.object) === newObj));
        const priorTrees = buildAliasSubClassTrees(priorRows);
        const normEdges = (edges) => edges.map(([s, o]) => [normFactTerm(s), normFactTerm(o)]);
        const para = paraphraseVerifiedSubClass(newSubj, newObj, normEdges(priorTrees.strictEdges))
          || paraphraseVerifiedSubClass(newSubj, newObj, normEdges(priorTrees.broadEdges));
        if (para) paraphraseSuffix = ` (${para})`;
      } catch { /* best-effort — the literal confirmation above is already correct either way */ }
    }
    const answer = `noted — remembered ${n} fact${n === 1 ? "" : "s"}: ${shown}${paraphraseSuffix}`;
    // The canonical restatement of what was committed — `machine` is the same
    // fact(s) in the compact notation ask.mjs's canonicalOf() uses for
    // query-side parses, so both lanes share one consistent syntax.
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
// "show the facts"/"show the chains" are the digest read-back's own escape
// (the digest holds the full fact list — chains included, since the flat lines
// carry their is-a ancestry — on the same pending remainder), folded in here so
// they page the held list exactly as "more" does.
const MORE_RE = /^(?:more|show more|see more|the rest|next|continue|go on|show(?: me)? the facts|show the chains)\b[.!?]*$/i;

/** The impact-intent gate — "what would break if I change X" and its natural
 *  neighbours, routed to the same /impact closure. Sibling of normalize.mjs's
 *  COUNTERFACTUAL_RE ("if X were deleted, what would break"), which compiles
 *  to the reverse import closure; these shapes name a CHANGE rather than a
 *  deletion, so they answer with the impact closure /impact itself renders.
 *  The verbs are a closed set on both sides — no general "any verb in a
 *  conditional" fit. The gate runs ahead of the teach classifier and the
 *  relaxation cascade, because an interrogative must never reach the write
 *  boundary ("blast radius of X" was remembered as a fact) and "impact" must
 *  never be fuzzy-read as "import" (the inverse question). */
const IMPACT_CHANGE_VERBS = "(?:changed?|modif(?:y|ied)|edits?|edited|touch(?:es|ed)?|updates?|updated|alters?|altered|deletes?|deleted|removes?|removed|drops?|dropped)";
const IMPACT_PARAPHRASE_RE = new RegExp(
  "^what\\s+(?:would|will|might|could|does|do)?\\s*"
  + "(?:breaks?|fails?|happens?|stops?\\s+working|is\\s+affected|are\\s+affected|gets?\\s+affected|be\\s+affected|is\\s+impacted|be\\s+impacted)"
  + `\\s+if\\s+(?:i|we|you|one|someone)\\s+${IMPACT_CHANGE_VERBS}`
  + "\\s+(?:the\\s+)?(.+?)[?.!\\s]*$",
  "i",
);
// The same counterfactual with the clauses reversed — "if I change X what breaks".
const IMPACT_REVERSED_RE = new RegExp(
  `^if\\s+(?:i|we|you|one|someone)\\s+${IMPACT_CHANGE_VERBS}`
  + "\\s+(?:the\\s+)?(.+?),?\\s+what\\s+(?:would\\s+|will\\s+|might\\s+|could\\s+|does\\s+|do\\s+)?"
  + "(?:breaks?|fails?|happens?|stops?\\s+working|is\\s+affected|are\\s+affected|gets?\\s+affected|be\\s+affected|would\\s+break|will\\s+break)"
  + "[?.!\\s]*$",
  "i",
);
// The agentless passive — "what is affected by changing X".
const IMPACT_AFFECTED_BY_RE = new RegExp(
  "^what\\s+(?:is|are|gets?|would\\s+be|will\\s+be)\\s+(?:affected|impacted|broken)\\s+"
  + "(?:by|when|if)\\s+(?:i\\s+|we\\s+|you\\s+)?"
  + "(?:chang(?:e|es|ing)|edit(?:s|ing)?|modif(?:y|ies|ying)|touch(?:es|ing)?|updat(?:e|es|ing)|delet(?:e|es|ing)|remov(?:e|es|ing)|a\\s+change\\s+to)\\s+"
  + "(?:the\\s+)?(.+?)[?.!\\s]*$",
  "i",
);
// "can I safely delete X" — a change-safety question IS the impact question.
const IMPACT_SAFE_CHANGE_RE = new RegExp(
  "^(?:(?:can|could)\\s+(?:i|we|you|one|someone)\\s+safely|is\\s+it\\s+safe\\s+to)\\s+"
  + "(?:change|edit|modify|touch|update|alter|delete|remove|drop)\\s+"
  + "(?:the\\s+)?(.+?)[?.!\\s]*$",
  "i",
);
// The NP form — "blast radius of X", "impact of changing X".
const IMPACT_NOUN_RE = new RegExp(
  "^(?:what(?:'s|\\s+is)\\s+the\\s+)?(?:blast\\s+radius|impact)\\s+(?:of|for)\\s+"
  + "(?:chang(?:ing|es)\\s+|editing\\s+|modifying\\s+|touching\\s+|updating\\s+|deleting\\s+|removing\\s+)?"
  + "(?:the\\s+)?(.+?)[?.!\\s]*$",
  "i",
);
const IMPACT_INTENT_RES = [IMPACT_PARAPHRASE_RE, IMPACT_REVERSED_RE, IMPACT_AFFECTED_BY_RE, IMPACT_SAFE_CHANGE_RE, IMPACT_NOUN_RE];
/** The impact intent in any of its clause orders -> the subject term, or null. */
function matchImpactIntent(line) {
  for (const re of IMPACT_INTENT_RES) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}
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

// ---- the SKOS view: synonym/related-word questions over the store ----
// "another word for X" / "synonyms of X" / "what is related to X" read the
// store's mgx:synonym / mgx:relatedTo / mgx:similarTo facts through
// buildSkosConceptView's minted concepts (relatedForTerm). Routed ahead of
// the generic parse, which reads these phrasings as something else entirely.
// A term that mints no concept — unknown, or with no synonym/related facts —
// misses honestly, naming the term, never a guessed neighbour.
const SKOS_SYNONYM_RE = /^(?:(?:what\s+is|whats)\s+another\s+word\s+for|(?:got\s+|are\s+there\s+)?any\s+(?:other\s+)?words?\s+like|(?:other\s+)?words\s+like|another\s+word\s+for|other\s+words\s+for|synonyms?\s+(?:of|for)|what\s+is\s+a\s+synonym\s+(?:of|for))\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i;
const SKOS_RELATED_RE = /^(?:what\s+is\s+related\s+to|what\s+relates\s+to|what\s+words\s+are\s+related\s+to)\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i;

/** The SKOS-view answer for a synonym/related question, or null when the
 *  line is not one. A matched line always answers — a hit lists the group's
 *  other labels and the related concepts; anything else is the honest miss. */
async function skosRelatedAnswer(memoryDir, query, cache) {
  if (!memoryDir) return null;
  const q = expandContractions(String(query).trim());
  const syn = q.match(SKOS_SYNONYM_RE);
  const rel = syn ? null : q.match(SKOS_RELATED_RE);
  if (!syn && !rel) return null;
  const term = (syn ?? rel)[1].trim();
  let hood = null;
  try { hood = relatedForTerm(await factRows(memoryDir, cache), term); } catch { hood = null; }
  const parts = [];
  if (hood?.synonyms?.length) parts.push(`another word for ${term}: ${joinList(hood.synonyms)}`);
  const relatedLabels = (hood?.related ?? []).map((c) => c.prefLabel);
  if (relatedLabels.length) parts.push(`related: ${joinList(relatedLabels)}`);
  if (!parts.length) {
    return { term, miss: true, text: `I don't know any synonyms or related words for "${term}" yet.` };
  }
  return { term, miss: false, text: `${parts.join("; ")} (source: remembered synonym/related facts, read as SKOS)` };
}

// ---- guess-the-number: a closed-loop game over hidden state ----
// Two modes on one mechanism. In GUESSER mode the human holds a secret and
// tmct searches: a belief interval {lo, hi} narrowed by bisection, one
// observation ("higher"/"lower"/"correct") folded in per turn. In THINKER
// mode tmct commits a secret up front and each turn is a stateless
// comparison against it. The game payload rides the session's plan slot as
// a tagged sub-object ({ game: {...} }), so a plan frame and a game never
// share the slot — each declines to start while the other is active.

/** "between A and B" / "up to N" anywhere in an opening line. Loose token
 *  captures (\S+) so a non-numeric bound is SEEN and declined rather than
 *  silently defaulted. */
const GAME_BOUNDS_CLAUSE_RE = /\b(?:between\s+(\S+)\s+and\s+(\S+)|up\s+to\s+(\S+))\b/i;

/** The bounds an opening line states — { lo, hi } (default `gameConfig`'s own
 *  defaultLo/defaultHi), or { problem } naming why the stated range is
 *  unplayable. `gameConfig` defaults to DEFAULT_GAME_CONFIG.guessNumber. */
function parseGameBounds(text, gameConfig = DEFAULT_GAME_CONFIG.guessNumber) {
  const { defaultLo, defaultHi, maxBound } = gameConfig;
  const m = String(text).match(GAME_BOUNDS_CLAUSE_RE);
  if (!m) return { lo: defaultLo, hi: defaultHi };
  const tokens = (m[3] !== undefined ? [String(defaultLo), m[3]] : [m[1], m[2]])
    .map((t) => String(t).replace(/[,.?!]+$/, ""));
  if (!tokens.every((t) => /^-?\d+$/.test(t))) {
    return { problem: `I can only play with whole-number bounds — say "between ${defaultLo} and ${defaultHi}".` };
  }
  const lo = Number(tokens[0]);
  const hi = Number(tokens[1]);
  if (Math.abs(lo) > maxBound || Math.abs(hi) > maxBound) {
    return { problem: `that range is too big for a fair game — keep both bounds within ${maxBound.toLocaleString("en-US")}.` };
  }
  if (hi < lo) return { problem: `no number is between ${lo} and ${hi} — that range is empty. Put the smaller bound first.` };
  if (hi === lo) return { problem: `between ${lo} and ${hi} leaves exactly one number, so there is nothing to guess. Pick a wider range.` };
  return { lo, hi };
}

// Opening moves, both modes, as closed-set leads + a tail that may only carry
// the bounds clause and the closing invitation words — any other tail is a
// real sentence and falls through to the ordinary lanes.
const GUESSER_OPEN_LEAD_RE = /^(?:i\s*(?:'m|am)\s+thinking\s+of\s+a\s+number|guess\s+my\s+number|guess\s+the\s+number\s+i\s*(?:'m|am)\s+thinking\s+of|guess\s+a\s+number\s+(?:between\s+\S+\s+and\s+\S+\s+|up\s+to\s+\S+\s+)?and\s+i\s*(?:'ll|\s+will)\s+tell\s+you\s+(?:if\s+it\s*(?:'s|\s+is)\s+)?higher\s+or\s+lower)\b(.*)$/i;
const THINKER_OPEN_LEAD_RE = /^(?:think\s+of\s+a\s+number)\b(.*)$/i;
const GUESSER_OPEN_TAIL_RE = /^[\s,.!?—-]*(?:and\s+)?(?:you\s+)?(?:can\s+|have\s+to\s+|try\s+to\s+)?(?:guess(?:\s+it|\s+what\s+it\s+is)?)?[\s,.!?—-]*$/i;
const THINKER_OPEN_TAIL_RE = /^[\s,.!?—-]*(?:and\s+)?(?:i\s*(?:'ll|\s+will)\s+(?:try\s+to\s+)?guess(?:\s+it)?|i\s+guess)?[\s,.!?—-]*$/i;
// The INVITATION family — "let's play guess the number", "wanna play a
// guessing game?": an invitation names the game without saying who holds the
// secret, and the canonical guess-the-number reading is that the inviter
// GUESSES — so it opens thinker mode (tmct commits the secret).
const INVITATION_OPEN_LEAD_RE = /^(?:let'?s\s+play|wanna\s+play|want\s+to\s+play|can\s+we\s+play|shall\s+we\s+play|do\s+you\s+want\s+to\s+play|will\s+you\s+play|play)\s+(?:a\s+)?(?:game\s+of\s+)?(?:guess[- ]the[- ]number|number[- ]guessing(?:\s+game)?|guessing\s+game)\b(.*)$/i;
const INVITATION_OPEN_TAIL_RE = /^[\s,.!?—-]*(?:with\s+me|together)?[\s,.!?—-]*$/i;

/** An opening move — { mode, bounds } — or null. `gameConfig` defaults to
 *  DEFAULT_GAME_CONFIG.guessNumber and threads through to parseGameBounds. */
function matchGameOpening(line, gameConfig = DEFAULT_GAME_CONFIG.guessNumber) {
  const l = String(line).trim();
  const guesser = l.match(GUESSER_OPEN_LEAD_RE);
  if (guesser && GUESSER_OPEN_TAIL_RE.test(guesser[1].replace(GAME_BOUNDS_CLAUSE_RE, " "))) {
    return { mode: "guesser", bounds: parseGameBounds(l, gameConfig) };
  }
  const thinker = l.match(THINKER_OPEN_LEAD_RE);
  if (thinker && THINKER_OPEN_TAIL_RE.test(thinker[1].replace(GAME_BOUNDS_CLAUSE_RE, " "))) {
    return { mode: "thinker", bounds: parseGameBounds(l, gameConfig) };
  }
  const invite = l.match(INVITATION_OPEN_LEAD_RE);
  if (invite && INVITATION_OPEN_TAIL_RE.test(invite[1].replace(GAME_BOUNDS_CLAUSE_RE, " "))) {
    return { mode: "thinker", bounds: parseGameBounds(l, gameConfig) };
  }
  return null;
}

// Continuation replies, gated STRICTLY on an active game (the same discipline
// MORE_RE applies to a held pending remainder): with no game standing none of
// these are ever consulted, and mid-game any line that matches none of them
// is an ordinary aside — answered by the normal lanes, game untouched.
const GAME_STOP_RE = /^(?:ok[,\s]+)?(?:i\s+give\s+up|give\s+up|i\s+quit(?:\s+the\s+game)?|stop\s+(?:the\s+game|playing)|end\s+the\s+game)[.!?\s]*$/i;
const GAME_REVEAL_RE = /^(?:just\s+tell\s+me|(?:just\s+)?tell\s+me\s+the\s+(?:number|answer)|what(?:'s|\s+is)\s+(?:the|your)\s+(?:secret\s+)?number|reveal\s+(?:it|the\s+number)|show\s+me\s+the\s+number)[.!?\s]*$/i;
const GAME_OBS_HIGHER_RE = /^(?:no[,\s]+)?(?:higher|too\s+low|too\s+small|bigger|greater|go\s+higher|it(?:'s|\s+is)\s+higher)[.!?\s]*$/i;
const GAME_OBS_LOWER_RE = /^(?:no[,\s]+)?(?:lower|too\s+high|too\s+big|smaller|less|go\s+lower|it(?:'s|\s+is)\s+lower)[.!?\s]*$/i;
const GAME_OBS_CORRECT_RE = /^(?:yes|yep|yeah|correct|you\s+got\s+it|you\s+guessed\s+it|that(?:'s|\s+is)\s+it|that(?:'s|\s+is)\s+right|got\s+it|spot\s+on)[.!?\s]*$/i;
const GAME_GUESS_RE = /^(?:is\s+it\s+)?(-?\d{1,12})\s*\??[.!?\s]*$/;
const GAME_FALSE_CORRECT_RE = /^(?:but\s+)?you\s+(?:already\s+)?said\s+(?:it\s+was\s+)?(?:correct|right)\b/i;
// Thinking-aloud / hesitation fillers — a closed set (never a real question or a
// graph query, which stay free to fall through to the normal lanes) that mid-game
// coaches back toward a valid move instead of hitting a bare parse wall.
const GAME_HESITATION_RE = /^(?:um+|uh+|erm+|hmm*|(?:hmm*,?\s+)?let me (?:think|see)(?:\s+about\s+(?:it|this))?|thinking|(?:just\s+)?(?:give me|gimme)\s+(?:a\s+)?(?:sec|second|minute|moment)|one\s+sec|hold\s+on|hang\s+on|not\s+sure|no\s+idea|i\s+dunno|dunno|idk|i\s+don'?t\s+know|i'?m\s+not\s+sure|good\s+question)[.!?\s]*$/i;

/** A natural-language plan frame — the shapes planLaneAnswer owns. Mid-game
 *  these get the one-at-a-time decline instead of clobbering the slot. */
function isPlanFrameLine(line) {
  return GOAL_TEACH_RE.test(line) || GOAL_TEACH_INFINITIVE_RE.test(line)
    || GOAL_TEACH_VERBLESS_RE.test(line) || GOAL_TEACH_NP_RE.test(line)
    || GOAL_TEACH_IMPERATIVE_RE.test(line) || GOAL_TEACH_CONJUNCTION_RE.test(line)
    || PLAN_SOLVE_RE.test(line) || LEGAL_MOVES_RE.test(line);
}

/** The per-turn goal line, table-driven off the live game state. */
function gameGoal(game) {
  if (game.mode === "guesser") return `narrow down your number — currently between ${game.lo} and ${game.hi}`;
  if (!game.lastHint) return "let you find my secret number I've committed to";
  return `let you find my secret number — said "${game.lastHint}" so it's ${game.lastHint === "higher" ? "above" : "below"} your last guess`;
}

/** One guesser-mode observation folded into the belief interval, or a
 *  thinker-mode guess compared against the secret. Mutates planHolder.state
 *  (the same slot the plan lane owns) and returns { text, goal?, lane, note },
 *  or null when the line is not a game reply. */
function gameContinuationAnswer(line, game, planHolder) {
  const endGame = () => { planHolder.state = null; };
  if (game.mode === "guesser") {
    if (GAME_STOP_RE.test(line)) {
      endGame();
      return { text: 'OK, stopping — I never found it. Say "guess my number" any time to play again.', lane: "game-inform", note: "GAME — the game ended on request; the belief interval is discarded" };
    }
    if (GAME_OBS_CORRECT_RE.test(line)) {
      const { guess, guesses } = game;
      endGame();
      return { text: `Got it — your number is ${guess}, found in ${guesses} guess${guesses === 1 ? "" : "es"}. Want to play again?`, lane: "game-answer", note: "GAME — the guess was confirmed; game over, won" };
    }
    const higher = GAME_OBS_HIGHER_RE.test(line);
    const lower = !higher && GAME_OBS_LOWER_RE.test(line);
    if (!higher && !lower) {
      if (GAME_HESITATION_RE.test(String(line).trim())) {
        return { text: `take your time — my guess is still ${game.guess} (between ${game.lo} and ${game.hi}). Say higher, lower, or correct.`, goal: gameGoal(game), lane: "game-inform", note: "GAME — a hesitation filler mid-game; re-stated the standing guess without folding an observation" };
      }
      return null;
    }
    const prior = game.guess;
    const next = { ...game };
    if (higher) { next.lo = prior + 1; next.loSetBy = { guess: prior }; }
    else { next.hi = prior - 1; next.hiSetBy = { guess: prior }; }
    if (next.lo > next.hi) {
      // The interval is EMPTY: no number satisfies every observation given,
      // so name the two observations that cannot both hold and stop guessing
      // — never a fabricated next guess over a premise known to be false.
      endGame();
      const earlier = higher
        ? (game.hiSetBy ? `lower than ${game.hiSetBy.guess}` : `it's between ${game.lo0} and ${game.hi0}`)
        : (game.loSetBy ? `higher than ${game.loSetBy.guess}` : `it's between ${game.lo0} and ${game.hi0}`);
      const now = `${higher ? "higher" : "lower"} than ${prior}`;
      return {
        text: `That's not possible — you said ${earlier}, and now ${now}, but no number can be both. One of those answers must be wrong. Say "guess my number" to restart.`,
        lane: "game-answer",
        note: "GAME — the observations emptied the belief interval; refused to keep guessing under a false premise",
      };
    }
    next.guess = Math.floor((next.lo + next.hi) / 2);
    next.guesses = game.guesses + 1;
    planHolder.state = { game: next };
    return {
      text: `My guess: ${next.guess}. Say higher, lower, or correct.`,
      goal: gameGoal(next),
      lane: "game-inform",
      note: `GAME — folded "${higher ? "higher" : "lower"}" into the interval and bisected it again`,
    };
  }
  // Thinker mode: tmct holds the ground truth, so every reply is a plain
  // comparison — and the hint record is authoritative against false claims.
  if (GAME_STOP_RE.test(line) || GAME_REVEAL_RE.test(line)) {
    const { secret } = game;
    endGame();
    return { text: `The number was ${secret}. Want to play again?`, lane: "game-answer", note: "GAME — revealed the secret on request; game over" };
  }
  if (GAME_FALSE_CORRECT_RE.test(line)) {
    const record = game.lastHint
      ? `my last hint was "${game.lastHint}", after your guess of ${game.lastGuess}`
      : "you haven't guessed yet";
    return { text: `I haven't said "correct" yet — ${record}. Keep guessing.`, goal: gameGoal(game), lane: "game-answer", note: "GAME — rebutted a false \"you said correct\" from the game's own hint record" };
  }
  if (GAME_HESITATION_RE.test(String(line).trim())) {
    return { text: `no rush — give me a number between ${game.lo0} and ${game.hi0}, or "I give up" to stop.`, goal: gameGoal(game), lane: "game-inform", note: "GAME — a hesitation filler mid-game; coached back to a valid guess without touching the secret" };
  }
  const m = String(line).trim().match(GAME_GUESS_RE);
  if (!m) return null;
  const guess = Number.parseInt(m[1], 10);
  if (guess < game.lo0 || guess > game.hi0) {
    return { text: `${guess} is outside the ${game.lo0} to ${game.hi0} range we agreed — try a number in range.`, goal: gameGoal(game), lane: "game-answer", note: "GAME — an out-of-range guess; declined rather than comparing outside the agreed bounds" };
  }
  const next = { ...game, guesses: game.guesses + 1, lastGuess: guess };
  if (guess === game.secret) {
    endGame();
    return { text: `Correct — you got it in ${next.guesses} guess${next.guesses === 1 ? "" : "es"}! The number was ${guess}. Want to play again?`, lane: "game-answer", note: "GAME — the guess matched the secret; game over, won" };
  }
  next.lastHint = guess < game.secret ? "higher" : "lower";
  planHolder.state = { game: next };
  return { text: `${next.lastHint} — guess again.`, goal: gameGoal(next), lane: "game-answer", note: `GAME — compared the guess against the committed secret: ${next.lastHint}` };
}

/** The whole game lane for one turn: continuations first (active game only),
 *  then opening moves, with the one-at-a-time declines both ways across the
 *  shared plan slot. Null when the turn is not the game's to answer. */
function guessNumberTurn(line, { planHolder, env, gameConfig = DEFAULT_GAME_CONFIG }) {
  const state = planHolder?.state ?? null;
  const game = state?.game ?? null;
  const opening = matchGameOpening(line, gameConfig?.guessNumber);
  if (game) {
    const continuation = gameContinuationAnswer(line, game, planHolder);
    if (continuation) return continuation;
    if (opening) {
      return { text: `we're already playing — I'm ${game.mode === "guesser" ? "guessing your number" : "holding a secret number"}. Say "I give up" to end this game first.`, lane: "game-inform", note: "GAME — an opening arrived mid-game; declined, the running game stands" };
    }
    if (isPlanFrameLine(line)) {
      return { text: 'a guess-the-number game is active — say "I give up" to end it, then set your goal.', lane: "game-inform", note: "GAME — a plan frame arrived mid-game; the slot holds one thing at a time" };
    }
    return null;
  }
  if (!opening) return null;
  if (state?.adventure) {
    return { text: 'we\'re mid-adventure — say "stop playing" to end it before a number game.', lane: "game-inform", note: "GAME — an opening arrived mid-adventure; the slot holds one thing at a time" };
  }
  if (state?.spiderFly) {
    return { text: 'the spider-and-fly game is running — say "stop watching" to end it before a number game.', lane: "game-inform", note: "GAME — an opening arrived mid-spider-fly-game; the slot holds one thing at a time" };
  }
  const planActive = state && !state.done
    && ((Array.isArray(state.goals) && state.goals.length) || (Array.isArray(state.actions) && state.actions.length));
  if (planActive) {
    return { text: "a plan is in progress — finish it or start a fresh goal before we play guess-the-number.", lane: "game-inform", note: "GAME — an opening arrived while a plan frame is active; the slot holds one thing at a time" };
  }
  if (opening.bounds.problem) {
    return { text: opening.bounds.problem, lane: "game-inform", note: "GAME — the opening stated an unplayable range; declined honestly" };
  }
  const { lo, hi } = opening.bounds;
  if (opening.mode === "guesser") {
    const guess = Math.floor((lo + hi) / 2);
    planHolder.state = { game: { mode: "guesser", lo0: lo, hi0: hi, lo, hi, guess, guesses: 1, loSetBy: null, hiSetBy: null } };
    return {
      text: `OK — you're thinking of a number between ${lo} and ${hi}; I'll guess it. My guess: ${guess}. Say higher, lower, or correct.`,
      goal: `narrow down your number — currently between ${lo} and ${hi}`,
      lane: "game-inform",
      note: "GAME — guesser mode opened; the belief interval starts at the agreed bounds and the first guess is its midpoint",
    };
  }
  const envSecret = Number.parseInt(String(env?.TMCT_GAME_SECRET ?? ""), 10);
  const secret = Number.isSafeInteger(envSecret) && envSecret >= lo && envSecret <= hi
    ? envSecret
    : lo + Math.floor(Math.random() * (hi - lo + 1));
  planHolder.state = { game: { mode: "thinker", lo0: lo, hi0: hi, secret, guesses: 0, lastHint: null, lastGuess: null } };
  return {
    text: `Done — I've thought of a number between ${lo} and ${hi}. Guess it, and I'll say higher, lower, or correct.`,
    goal: "let you find my secret number I've committed to",
    lane: "game-inform",
    note: "GAME — thinker mode opened; the secret is committed for the whole game",
  };
}

// "I want you to search for Widget" / "I'd like you to search for Widget" —
// a closed-set indirect-request wrapper, checked VERY early. Without this it
// is mis-swallowed by GENERAL_VERB_TEACH_RE as a bare teach triple (subject
// "I", verb "want"), declined by the pronoun-subject guard with a confusing
// message instead of ever reaching /search. Deliberately does NOT strip bare
// "please X" alone — that's already handled ad hoc by several regexes
// throughout this file, and centralizing it risks double-processing.
const INDIRECT_REQUEST_RE = /^(?:i\s+(?:want|wanted)\s+you\s+to\s+|i(?:'d|\s+would)\s+like\s+you\s+to\s+)\s*(.+)$/i;

// First-person desire openers for a vocabulary question — "i wanna know about
// a horse", "you tell me about dog", "let me know about a dog" — and the
// known-kinds enumeration ("what animals do you know", "list the animals you
// know"). Each rewrites to the canonical question its lane already answers
// ("tell me about X" / "what is a X"), BEFORE any dispatch lane sees the
// text: the leading "i" otherwise reads as a teach subject, so a read-only
// question asserted an intent it doesn't have. Closed set, rewrite-only —
// same discipline as INDIRECT_REQUEST_RE above.
const DESIRE_ABOUT_RE = /^i\s+(?:wanna|want\s+to|wanted\s+to|(?:'d\s+|would\s+)?like\s+to|need\s+to)\s+(?:know|learn|hear)\s+(?:(?:more|something)\s+)?about\s+(.+?)[?.!\s]*$/i;
const TELL_ABOUT_VARIANT_RE = /^(?:you\s+tell\s+me|let\s+me\s+know|fill\s+me\s+in)\s+(?:(?:more|something)\s+)?about\s+(.+?)[?.!\s]*$/i;
// "facts"/"things"/"stuff" ask for the whole-store recall, not a kind's
// members — those keep their own lane.
const KNOWN_KINDS_RE = /^(?:(?:so|uh|um|well|ok|okay),?\s+)*(?:what|which)\s+(?!else\b|all\b|facts?\b|things?\b|stuff\b)([a-z][\w-]*)\s+do\s+(?:you|u)\s+know(?:\s+(?:about|of|so\s+far))?[?.!\s]*$/i;
const LIST_KNOWN_KINDS_RE = /^list\s+(?:the\s+|all\s+(?:the\s+)?)?(?!facts?\b|things?\b|stuff\b)([a-z][\w-]*)\s+(?:that\s+)?(?:you|u)\s+know(?:\s+(?:about|of))?[?.!\s]*$/i;
// "if something is a dog then it is a pet" — the universal conditional IS the
// universal subclass teach in a conditional coat, so it rewrites to the
// "every X is a Y" surface the teach path already stores (with its quantifier
// and its own confirmation). Closed to the indefinite-pronoun subject: a
// conditional over a NAMED subject or an arbitrary property is a rule, not a
// subclass fact, and stays outside this frame.
const UNIVERSAL_CONDITIONAL_RE = /^if\s+(?:something|somebody|someone|anything)\s+is\s+an?\s+([\w-]+)\s*,?\s*(?:then\s+)?(?:it|they)\s+(?:is|are)\s+an?\s+([\w-]+)[.!?\s]*$/i;
function rewriteVocabOpener(line) {
  let m = line.match(DESIRE_ABOUT_RE) || line.match(TELL_ABOUT_VARIANT_RE);
  if (m) return `tell me about ${m[1].trim()}`;
  m = line.match(UNIVERSAL_CONDITIONAL_RE);
  if (m) return `every ${m[1]} is ${indefiniteArticleFor(m[2])} ${m[2]}`;
  m = line.match(KNOWN_KINDS_RE) || line.match(LIST_KNOWN_KINDS_RE);
  if (m) {
    const noun = teachableSubjectOf(m[1]);
    return `what is ${indefiniteArticleFor(noun)} ${noun}`;
  }
  return null;
}

/** The ESL missing-"does" yes/no — "dog have tail?": subject + bare
 *  have/has + object, question mark REQUIRED (the "?" is the whole signal;
 *  without it the line is a declarative and belongs to the teach path).
 *  Rewritten to the do-support form the possession readers already answer, so
 *  the question is ANSWERED as the yes/no it is rather than merely refused at
 *  the write boundary. Single/two-token sides, mirroring the teach shapes'
 *  own subject width; articles tolerated on the object. */
const ESL_MISSING_DOES_RE = /^([\w-]+(?:\s+[\w-]+)?)\s+(?:has|have)\s+(?:an?\s+|the\s+)?([\w-]+(?:\s+[\w-]+)?)\s*\?+$/i;
function rewriteEslMissingDoes(line) {
  const m = String(line || "").trim().match(ESL_MISSING_DOES_RE);
  if (!m) return null;
  if (QUESTION_LEAD_RE.test(m[1])) return null; // already do-supported ("does dog have tail?")
  return `does ${m[1].trim()} have ${m[2].trim()}`;
}

/** The NEGATIVE-POLARITY opener — "I don't suppose X imports anything": a
 *  politeness implicature meaning the question underneath. The one wrapper
 *  the desire/wrapper stripper family didn't peel; unpeeled it reads as a
 *  first-person declarative and lands on the pronoun-subject lecture. The
 *  anything-form folds straight to the open question; an interrogative-led
 *  remainder unwraps to itself; anything else stays untouched (never a
 *  guessed reading). */
const NEG_POLARITY_OPENER_RE = /^i\s+(?:do\s+not|don'?t)\s+suppose\s+(?:that\s+)?(.+?)[?.!\s]*$/i;
function rewriteNegativePolarityOpener(line) {
  const m = String(line || "").trim().match(NEG_POLARITY_OPENER_RE);
  if (!m) return null;
  const rest = m[1].trim();
  const anyForm = rest.match(/^(.+?)\s+([a-z]+)s\s+(?:anything|something)(?:\s+else)?$/i);
  if (anyForm && VERB_TO_KIND[`${anyForm[2].toLowerCase()}s`]) {
    return `what does ${anyForm[1].trim()} ${anyForm[2].toLowerCase()}`;
  }
  if (QUESTION_LEAD_RE.test(rest)) return rest;
  return null;
}

/** A CONTRACTED NEGATIVE INTERROGATIVE — "isn't a dog an animal?", "doesn't
 *  store.mjs import config?": a confirmation-seeking question whose expected
 *  answer is the positive yes/no. Folded to the plain positive interrogative the
 *  isa/relation readers already answer, so it is ANSWERED rather than walling at
 *  the grammar boundary or reading as a first-person declarative. A trailing "?"
 *  is required — the whole negative-question signal — so a leading-"don't"
 *  imperative ("don't show me tests") is never rewritten into a positive. */
const NEG_CONTRACTION_LEAD = {
  "isn't": "is", "isnt": "is", "aren't": "are", "arent": "are",
  "wasn't": "was", "wasnt": "was", "weren't": "were", "werent": "were",
  "doesn't": "does", "doesnt": "does", "don't": "do", "dont": "do",
  "didn't": "did", "didnt": "did", "can't": "can", "cant": "can",
  "couldn't": "could", "couldnt": "could", "won't": "will", "wont": "will",
  "wouldn't": "would", "wouldnt": "would", "hasn't": "has", "hasnt": "has",
  "haven't": "have", "havent": "have", "hadn't": "had", "hadnt": "had",
  "shouldn't": "should", "shouldnt": "should",
};
function rewriteNegativeInterrogative(line) {
  const s = String(line || "").trim();
  if (!/\?\s*$/.test(s)) return null;
  const m = s.replace(/[?.!\s]+$/, "").match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  const positive = NEG_CONTRACTION_LEAD[m[1].toLowerCase()];
  if (!positive) return null;
  return `${positive} ${m[2].trim()}`;
}

/** "what is the entry point" / "what's the main entry point of this codebase" /
 *  "which file is the entry point" — the definition/which-file phrasings of the
 *  entry-point question, folded onto the "where is the entry point" surface the
 *  ask engine's own entry-point ranker (ask.mjs ENTRY_POINT_QUERY_RE) already
 *  answers. Without this fold they parse as a vocabulary "what is X" miss. */
const ENTRY_POINT_WHATIS_RE = /^(?:what(?:'s|s|\s+is)|which\s+(?:module|file|one)(?:\s+is)?)\s+(?:the\s+)?(?:main\s+|primary\s+)?entry[\s-]?points?(?:\s+(?:of|to|for)\s+(?:this|the)\s+(?:codebase|code|repo|repository|project|app))?[?.!\s]*$/i;
const rewriteEntryPointQuestion = (line) => (ENTRY_POINT_WHATIS_RE.test(String(line || "").trim()) ? "where is the entry point" : null);

/** "prove that X is a Y" / "prove X is Y" — a request for the isa yes/no with
 *  its proof chain, folded onto the "is X a Y" surface the isa reader already
 *  answers with a cited chain. Only the copula form folds; other "prove …"
 *  phrasings fall through to their ordinary handling / honest miss. */
const PROVE_THAT_RE = /^prove\s+(?:to\s+me\s+)?(?:that\s+)?(.+?)\s+(is|are)\s+(.+?)[?.!\s]*$/i;
function rewriteProveThat(line) {
  const m = String(line || "").trim().match(PROVE_THAT_RE);
  if (!m) return null;
  return `${m[2]} ${m[1].trim()} ${m[3].trim()}`;
}

/** A DISCONTIGUOUS verb frame, "SUBJECT uses OBJECT as its/a base(class)" —
 *  "uses" is split from its own qualifier ("as its base") around the object,
 *  so no contiguous phrase-table entry could ever register it, and "uses"
 *  alone is already claimed by the query-side "uses" union — only this
 *  "...as its base"-qualified shape means the `inherits` relation.
 *
 *  Fixed by REWRITING the raw turn text, once, before any dispatch lane sees
 *  it, into the equivalent ALREADY-WORKING "is a kind of" surface form,
 *  rather than inventing a parallel teach/ask mechanism for a new predicate.
 *
 *  Four shapes recognized, in this order (WH-object and aux-fronted forms
 *  must win before the bare-declarative TEACH form misreads a question's
 *  leading "does"/"what" as part of the subject): mid-sentence WH-object ask,
 *  WH-fronted forward ask, aux-fronted yes/no ask, bare declarative teach. */
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

/** The pronouns runTurn's vocabulary binding accepts in SUBJECT position, and
 *  the shapes that put one there. The set is CONTEXT_WORDS — this file's own
 *  closed anaphor table, the one isPronoun and every focus-resolving reader
 *  already trust — plus the plural "they", which the fact readers take as a
 *  bare subject the same way. Only "here" is left out: it stands for a PLACE
 *  ("what's in here" = this repo), never for the thing a fact is about, so
 *  binding it to a subject would be a category error.
 *
 *  The lead itself is what keeps this to subject position: the pronoun must
 *  directly follow the opening auxiliary ("can it bark") or "what is/are" WITH
 *  a continuation ("what is it used for"), so an idiom carrying a trailing
 *  dummy pronoun ("what time is it") and the bare "what is it" never rewrite. */
const VOCAB_PRONOUN_LEAD_SUBJECTS = Object.freeze([...CONTEXT_WORDS].filter((w) => w !== "here").concat("they"));
const VOCAB_PRONOUN_LEAD_RE = new RegExp(
  `^((?:is|are|can|could|does|do)\\s+|what\\s+(?:is|are)\\s+)(${VOCAB_PRONOUN_LEAD_SUBJECTS.join("|")})\\b(\\s+\\S.*)?$`, "i",
);

/** The decline for a subject-position pronoun with nothing to bind it to —
 *  "can it bark" as the very first thing said, before anything named a dog.
 *  Returns the text, or null when the shape isn't a cold pronoun.
 *
 *  The vocabulary binding above already declines this correctly (no `last`
 *  subject, so no substitution), and the fact readers then decline too, since
 *  no row has "it" as its subject. What was left was the generic orientation
 *  card, which introduces the tool and answers a question nobody asked. Name
 *  the pronoun instead: the sentence was fine, it just arrived with nothing
 *  behind it.
 *
 *  The example is the "<name>" placeholder nudgeAnswer's own no-focus pronoun
 *  branch uses, not a real term. A concrete "what is a dog" would claim a
 *  vocabulary an unseeded session doesn't have, and a seeding/teaching hint
 *  belongs to the shapes that are ABOUT teaching — this shape is a question
 *  whose subject went missing, and inviting a teach here reads as an offer to
 *  store a fact about the pronoun itself. */
function coldPronounDeclineText(query) {
  const m = String(query || "").trim().match(VOCAB_PRONOUN_LEAD_RE);
  // The bare "what is it" carries no predicate to answer, so it keeps the
  // orientation card the same way the binding above leaves it alone.
  if (!m || (/^what/i.test(m[1]) && !m[3])) return null;
  return `not sure what "${m[2].toLowerCase()}" refers to yet — name the subject directly, e.g. "what is a <name>".`;
}

/** The subject of the last GROUNDED turn's first fact line, for vocabulary
 *  pronoun binding ("what is a dog" → "can it bark"). Fact answers render
 *  rigidly — "<subject> <phrase> <object> (source: …)", optionally behind a
 *  "yes — "/"no — "/"you told me: " prefix — so a 1–2 word leading subject
 *  followed by a phrase-table verb is extractable without any NLP. Anything
 *  else (code answers, walls, conversational text) returns null and no
 *  substitution happens.
 *
 *  It reads `grounded`, not `answer`, so an intervening miss leaves the
 *  standing referent alone rather than stranding every pronoun behind it.
 *
 *  A pronoun never binds. An honest miss opens first-person ("I can't confirm
 *  that — …"), which fits the subject+verb shape exactly, so without the
 *  isTeachPronoun check a miss reaching here would lend "I" to the next turn
 *  and "is it an animal" would be looked up as "is I an animal". A pronoun is
 *  no more a fact subject here than in the teach frames TEACH_PRONOUNS already
 *  guards. */
function vocabAntecedentFrom(last) {
  const first = String(last?.grounded || "").split("\n")[0]
    .replace(/^(?:yes|no) — /i, "")
    .replace(/^you told me: /i, "");
  const m = first.match(/^([a-z][\w'-]*(?:\s+[a-z][\w'-]*)?)\s+(?:is|are|has|can|causes|wants|requires|involves|means|begins|ends)\b/i);
  if (!m || isTeachPronoun(m[1]) || isPronoun(m[1])) return null;
  return m[1];
}

export async function runTurn(input, { config, source = defaultSource, graph = null, focus = null, last = null, memoryDir = null, sessionId = "", env = process.env, lexicon = null, narrate = false, liveReference = false, onLiveLookup = null, vocabHint = null, tel = null, biasByBundle = {}, factRowsCache: injectedFactRowsCache = null, planState = null, gameConfig = null, uiContext = "cli", synthesisBudget = AUTO_SYNTHESIS_BUDGET, researchState = null, researchConfig = null, discourse = null, _noSplit = false } = {}) {
  // Every game's tuning knobs (spider-fly's mass economy, guess-the-number's
  // bounds, the shared plan lane's search-depth cap) — a caller's own
  // gameConfig (chat-session.mjs resolves one per session from tmct.toml)
  // wins outright; direct/library callers that omit it get the shipped
  // defaults, byte-identical to before this seam existed.
  const resolvedGameConfig = gameConfig ?? DEFAULT_GAME_CONFIG;
  const line = String(input ?? "").trim();
  // ONE fresh, empty cache for this turn only — every factRows() reader
  // reached from this call shares it, so the first reader computes
  // loadMemory+readFactRows once and every later reader THIS TURN reuses it
  // instead of reloading from disk. Never persisted or shared across turns.
  // `injectedFactRowsCache` is a TEST-ONLY escape hatch.
  const factRowsCache = injectedFactRowsCache ?? { rows: null };
  // The captured residue is used for RECOGNITION at every dispatch site below;
  // the ORIGINAL `line` survives untouched for record.query/logLines fidelity
  // — restored centrally inside withLast (below), once, for every dispatch path.
  const indirectMatch = line.match(INDIRECT_REQUEST_RE);
  const indirectLine = indirectMatch ? indirectMatch[1].trim() : line;
  const preRewriteLine = rewriteEntryPointQuestion(indirectLine) || rewriteProveThat(indirectLine)
    || rewriteVocabOpener(indirectLine) || indirectLine;
  // rewriteUsesAsBaseFrame's discontiguous-frame rewrite: applied here, once,
  // before ANY dispatch lane sees the text. Null (no-op) for every turn that
  // doesn't match one of the four discontiguous shapes.
  const baseFrameRewrite = rewriteUsesAsBaseFrame(preRewriteLine);
  const frameLine = baseFrameRewrite || preRewriteLine;
  // The reverse cleft's "it" is scaffolding, so it has to go before the
  // vocabulary pronoun binding below reads that same "it" as a referring
  // pronoun and binds the last turn's subject to it ("what is it that calls
  // loadStore" -> "what is dog that calls loadStore" after "what is a dog").
  // The pronoun lead's own guard only spares the BARE "what is it", so this
  // shape has to stop existing before that match runs at all.
  const cleftRewrite = reverseCleftRewrite(frameLine);
  // The ESL missing-"does" yes/no ("dog have tail?") — rewritten to the
  // do-support form here, once, before any dispatch lane sees it, so the
  // question is answered by the possession readers instead of walling (the
  // write boundary's own "?" gates already refuse to store it).
  const eslRewrite = rewriteEslMissingDoes(cleftRewrite || frameLine)
    || rewriteNegativePolarityOpener(cleftRewrite || frameLine)
    || rewriteNegativeInterrogative(cleftRewrite || frameLine);
  const cleftLine = eslRewrite || cleftRewrite || frameLine;
  // VOCABULARY pronoun antecedent — "what is a dog" then "can it bark". The
  // code-graph focus mechanism only ever binds {id,label} GRAPH entities, so
  // in a vocabulary conversation "it" resolved to nothing and the question
  // fell to the conversational gate or a garbage-subject fact lookup.
  // Substituted here, once, before any dispatch lane sees the text — and
  // ONLY when no code focus is standing (a graph session's own pronoun
  // resolution is untouched), the turn looks like a fact question, and the
  // LAST answer's own first fact line names a subject to bind to.
  const pronounLead = cleftLine.match(VOCAB_PRONOUN_LEAD_RE);
  const vocabAntecedent = (!focus?.id && memoryDir && pronounLead
    && !(/^what/i.test(pronounLead[1]) && !pronounLead[3]))
    ? vocabAntecedentFrom(last) : null;
  const workingLine = vocabAntecedent
    ? `${pronounLead[1]}${vocabAntecedent}${pronounLead[3] || ""}`
    : cleftLine;
  const templates = await chatTemplates(); // failure-tolerated: null degrades, never throws
  const trace = narrate ? [] : null;
  // vocabHint: createSession computes this ONCE per session; a direct
  // runTurn() caller that doesn't pass one gets it computed here instead.
  const resolvedVocabHint = vocabHint ?? vocabExampleHint(await hasSeededVocabulary(memoryDir));
  // The session's in-progress plan rides a mutable holder: the plan lane and
  // the PLAN NEXT block below write planHolder.state; every other path leaves
  // it untouched, and the caller re-threads whatever comes back.
  const planHolder = { state: planState };
  // The session's typed discourse record rides the same holder pattern,
  // threaded turn-to-turn beside focus and last. Registration happens where
  // an answer's typed content is in hand (runAsk, off the ask envelope's
  // `discourse` referents); the caller re-threads whatever comes back.
  const discourseHolder = { record: discourse ?? emptyDiscourseRecord() };
  const ctx = { config, source, graph, focus, last, memoryDir, sessionId, templates, env, lexicon, trace, narrate, liveReference, onLiveLookup, vocabHint: resolvedVocabHint, tel, biasByBundle, cache: factRowsCache, vocabAntecedent, planHolder, discourseHolder, gameConfig: resolvedGameConfig, uiContext, synthesisBudget };
  // A DISPATCHED turn (count / slash-command / ask) becomes the new "last
  // answer" that why/say-more re-renders; a conversational turn does not.
  // Every dispatched turn's result passes through finish() here — the LAST
  // transform in the turn — so `last` and the transcript stay consistent with
  // what the shell prints. The narrate block is applied AFTER `last` is
  // captured from the PRE-narration finished result.
  const withLast = (result, fallbackGoal = "unclear — no goal signal for this turn type") => {
    const finished = attachDialogueAct(finish(result, { graph }), trace);
    // The logged transcript echo is ALWAYS the verbatim user line — no dispatch
    // path's internal rewrite (the indirect-request wrapper, the vocab-opener /
    // cleft / ESL rewrites, a discourse substitution) may leak into what the
    // .log shows the user typed.
    if (Array.isArray(finished.logLines) && finished.logLines.length > 1) finished.logLines[1] = `> ${line}`;
    // record.query keeps its narrower restoration for the wrapper/rewrite frames
    // the ask engine records off `workingLine`; the .jsonl sidecar also carries
    // the verbatim line as `input`, below.
    if (indirectMatch || baseFrameRewrite || vocabAntecedent || eslRewrite) {
      if (finished.record) finished.record.query = line;
    }
    // The VERBATIM user line rides every turn record as `input`, beside
    // whatever `query` the dispatch path recorded — the session history must
    // be able to quote the user exactly, and bench session-mode matching
    // needs the pre-rewrite turn. Additive: `query` keeps its existing
    // fidelity rules unchanged.
    if (finished.record && finished.record.type === "turn") finished.record.input = line;
    // runAsk's own effectiveQuery (set only when discourseRewrite substituted
    // a new subject and produced a genuine non-miss answer) takes over as the
    // continuation base for the NEXT turn's own discourseRewrite.
    //
    // `grounded` is the last answer that actually ANSWERED, carried forward
    // across misses. It is what a pronoun's referent binds to
    // (vocabAntecedentFrom): a reader's misses come in clusters, and reading
    // the referent off a wall stranded every pronoun after one stray line.
    //
    // `answer` must keep recording the miss regardless — the repeat-shortening
    // walls compare consecutive answers through it, so a miss that declined to
    // record itself would make every wall look like a first offence.
    const nextLast = {
      query: finished.effectiveQuery ?? line,
      answer: finished.answer,
      detail: finished.detail ?? null,
      grounded: finished.record?.miss ? (last?.grounded ?? null) : finished.answer,
    };
    // Every dispatched turn advances the discourse record's turn counter —
    // the counter is the registration ordinal that makes a same-turn tie
    // detectable, so it moves once, here, on the one path every dispatched
    // turn shares. Conversational turns bypass withLast and leave the record
    // untouched, exactly as they leave `last`.
    discourseHolder.record = advanceDiscourseTurn(discourseHolder.record);
    // Goal/canonical lines append onto the PRE-narration `finished` result
    // `nextLast` was captured from, so a narrated turn still gets both short
    // lines up top plus the full trace block after.
    return { ...withNarration(withCanonicalLine(withGoalLine(finished)), trace, fallbackGoal), last: nextLast, discourse: discourseHolder.record };
  };

  // Slash-optional system commands: a bare leading command word ("stats",
  // "memory", "describe X") is routed to its slash form BEFORE the conversational
  // layer, so a forgiving shell answers "stats" the way it answers "/stats" instead
  // of falling through to the generic orientation.
  const bareCmd = asBareCommand(workingLine);
  if (bareCmd) return withLast(await runCommand(bareCmd, ctx), "use a specific tool/command directly");

  // GUESS-THE-NUMBER — opening moves, and (with a game standing) the
  // closed-set continuation replies. Checked before the conversational layer
  // because the guesser-mode observations ("yes", "got it") share words with
  // the acknowledgement sets, and before assertTurn/runAsk because an opening
  // line would otherwise read as a declarative to remember. A mid-game line
  // matching no game shape returns null here and the game stands untouched.
  {
    const gameTurn = guessNumberTurn(workingLine, { planHolder, env, gameConfig: resolvedGameConfig });
    if (gameTurn) {
      note(trace, `lane: ${gameTurn.note}`);
      if (gameTurn.goal) note(trace, `goal: ${gameTurn.goal}`);
      const result = plainTurn(workingLine, gameTurn.text, { via: "game", focus });
      if (gameTurn.goal) result.goal = gameTurn.goal;
      result.lane = gameTurn.lane;
      const rec = withLast(result, gameTurn.goal ?? "play the guessing game");
      rec.planState = planHolder.state;
      return rec;
    }
  }

  // THE ADVENTURE — world-loading openers ("play ashcombe hall", "start the
  // adventure"), the stop command, and (once a world is live) the game's own
  // turns. Ordered AFTER the guess-number lane so that lane keeps every
  // guessing-game opener it already owns, and before the conversational
  // layer for the same reason the game lane is: an opening line would
  // otherwise read as a declarative or an orientation ask.
  {
    const advTurn = await adventureTurn(workingLine, {
      planHolder, memoryDir, sessionId, env, lexicon, graph, cache: factRowsCache, isPlanFrameLine,
    });
    if (advTurn) {
      note(trace, `lane: ${advTurn.note}`);
      if (advTurn.goal) note(trace, `goal: ${advTurn.goal}`);
      const result = plainTurn(workingLine, advTurn.text, { via: "game", miss: !!advTurn.miss, focus });
      if (advTurn.goal) result.goal = advTurn.goal;
      result.lane = advTurn.lane;
      const rec = withLast(result, advTurn.goal ?? "play the adventure");
      rec.planState = planHolder.state;
      return rec;
    }
  }

  // SPIDER-AND-FLY — the opener ("watch the spider and the fly"), the stop
  // command, the addressed spatial teach-frame, the bare tick command, and
  // (once a game is live) the game's own turns. Ordered AFTER the adventure
  // lane for the same reason the adventure lane follows guess-the-number: an
  // opening line would otherwise read as a declarative or an orientation ask.
  {
    const sfTurn = await spiderFlyTurn(workingLine, {
      planHolder, memoryDir, env, cache: factRowsCache, isPlanFrameLine, gameConfig: resolvedGameConfig,
    });
    if (sfTurn) {
      note(trace, `lane: ${sfTurn.note}`);
      if (sfTurn.goal) note(trace, `goal: ${sfTurn.goal}`);
      const result = plainTurn(workingLine, sfTurn.text, { via: "game", miss: !!sfTurn.miss, focus });
      if (sfTurn.goal) result.goal = sfTurn.goal;
      result.lane = sfTurn.lane;
      const rec = withLast(result, sfTurn.goal ?? "watch the spider-and-fly game");
      rec.planState = planHolder.state;
      return rec;
    }
  }

  // A "play X" naming no world EITHER game lane above claimed — last resort,
  // checked only once the adventure lane's own fallthrough and spider-fly's
  // own opener have both passed on the line, so this never outguesses a
  // sibling game's own recognized phrasing. Honest by name ("I don't know a
  // world called…") rather than the generic non-answer an unclaimed opener
  // fell into before.
  {
    const unclaimed = await unclaimedAdventureOpening(workingLine, { env });
    if (unclaimed) {
      note(trace, `lane: ${unclaimed.note}`);
      const result = plainTurn(workingLine, unclaimed.text, { via: "game", miss: true, focus });
      result.lane = unclaimed.lane;
      const rec = withLast(result, "play the adventure");
      rec.planState = planHolder.state;
      return rec;
    }
  }

  // RESEARCH — "research <topic>[, limit N][, depth D]" runs a Simple English
  // Wikipedia queue through the same ingest path a live-Wikipedia rescue uses:
  // depth 0 now, the lead section's linked topics queued for "research next"
  // (which the web pages' auto-play button submits turn by turn), and each of
  // those fanning out again while the run's depth knob allows, up to its total
  // node budget. The explicit
  // request is the network consent for its own fetches — unlike the
  // clean-miss rescue, which fires on an ordinary question and so stays
  // behind /wiki on. Queue state threads turn-to-turn as researchState, the
  // same way planState does.
  {
    // A fresh CLI session carries no in-memory queue, so a research-family line
    // arriving with none resumes the queue persisted under .tmct/ — that is
    // what makes "research next"/"status"/"stop" work across process restarts.
    // The gate keeps ordinary turns off the disk (only a parsed research line
    // loads), and a store with no path (the browser) simply reads back null.
    let priorResearchState = researchState;
    if (!priorResearchState && parseResearchRequest(workingLine)) {
      priorResearchState = await loadResearchQueue(memoryDir);
    }
    const researchHolder = { state: priorResearchState };
    const resolvedResearchConfig = researchConfig ?? RESEARCH_DEFAULTS;
    const rTurn = await researchTurn(workingLine, {
      holder: researchHolder,
      memoryDir,
      lexicon,
      provider: getResearchProvider({ minIntervalMs: resolvedResearchConfig.minIntervalMs }),
      config: resolvedResearchConfig,
      planActive: Boolean(planHolder.state && !planHolder.state.done),
      pagerActive: Boolean(Array.isArray(last?.detail?.pending?.items) && last.detail.pending.items.length),
      notify: onLiveLookup,
      ingest: (key, article, tag) =>
        ingestReferenceArticle(memoryDir, key, article, factRowsCache, () => tag, lexicon, synthesisBudget),
    });
    if (rTurn) {
      note(trace, `lane: ${rTurn.note}`);
      note(trace, `goal: ${rTurn.goal}`);
      const result = plainTurn(workingLine, rTurn.text, { via: "research", miss: !!rTurn.miss, focus });
      result.lane = "research";
      const snapshot = researchSnapshot(researchHolder.state);
      if (snapshot) result.record.research = snapshot;
      // Write-through: persist the queue this turn just mutated (start, next,
      // skip), and clear the file when it ended (stop, or a failed start that
      // left no run). A store with no path no-ops, so the browser is untouched.
      await saveResearchQueue(memoryDir, researchHolder.state);
      const rec = withLast(result, rTurn.goal);
      rec.planState = planHolder.state;
      rec.researchState = researchHolder.state;
      // Present on EVERY research turn — null when the run ended or never
      // started — so a UI can tell "queue cleared" from "not a research
      // turn" (where the field is absent entirely).
      rec.research = snapshot;
      return rec;
    }
  }

  // Conversational layer next (greetings, thanks, help, bye, why/say-more) — these
  // resolve no entity and carry their own preserved `last`. Bypasses withLast (a
  // conversational turn is never finish()'d / never becomes a new `last`), so the
  // narrate block is applied directly here instead.
  const convo = vocabAntecedent ? null : conversationalTurn(workingLine, ctx);
  if (convo) {
    if (convo.record && convo.record.type === "turn") convo.record.input = line; // verbatim, same as withLast
    return withNarration(convo, trace, "casual/social — no graph intent");
  }

  // PLAN NEXT — "next"/"continue" with an ACTIVE plan executes the plan's
  // next move as a snapshot write. Checked BEFORE the MORE_RE pager because
  // MORE_RE owns the same words; with no active plan this block never fires
  // and paging behaves exactly as before.
  if (memoryDir && PLAN_NEXT_RE.test(workingLine)
      && planHolder.state && !planHolder.state.done
      && Array.isArray(planHolder.state.actions) && planHolder.state.cursor < planHolder.state.actions.length) {
    const step = await executePlanStep(planHolder, { memoryDir, sessionId, gameConfig: resolvedGameConfig });
    note(trace, `goal: ${step.deduced}`);
    note(trace, "lane: PLAN NEXT — executed the active plan's next move as an @stepK snapshot write");
    const stepTurn = plainTurn(workingLine, step.text, { via: "plan", focus });
    stepTurn.lane = "imperative";
    const rec = withLast(stepTurn, step.deduced);
    rec.planState = planHolder.state;
    return rec;
  }

  // PLAN FOLLOW-UP + BOARD — "what is the next move", "how many moves", "why
  // that move" read the active plan; "is X clear", "what rests on X",
  // "where is X" read the CURRENT board. Placed before answerCount (which owns
  // "how many …") and the ask engine, so a plan/board answer never loses to a
  // code-graph miss. Returns null with no plan/board standing, so nothing
  // changes for a cold session — an honest miss still stands.
  if (memoryDir) {
    const follow = await planFollowUpAnswer(workingLine, {
      memoryDir, planHolder,
      pendingPager: !!(Array.isArray(last?.detail?.pending?.items) && last.detail.pending.items.length),
    });
    if (follow) {
      note(trace, `goal: ${follow.deduced}`);
      note(trace, `lane: ${follow.note}`);
      const rec = withLast(plainTurn(workingLine, follow.text, { via: "plan", focus }), follow.deduced);
      rec.planState = planHolder.state;
      return rec;
    }
  }

  // "more" — page the remainder of a previous long listing, if one is held. Gated on
  // an actual pending remainder so a bare "more" with nothing to continue falls through
  // to the ordinary path (an honest miss), never a pretend page.
  if (MORE_RE.test(workingLine) && Array.isArray(last?.detail?.pending?.items) && last.detail.pending.items.length) {
    note(trace, "goal: continue viewing a previous long listing (pagination)");
    note(trace, "lane: MORE_RE matched a held pending remainder from the previous turn's detail.pending");
    return withLast(morePage(workingLine, ctx), "continue viewing a previous long listing");
  }

  // "what would break if I change X" / "if I change X what breaks" / "blast
  // radius of X" / "impact of X" / "can I safely delete X" — the impact
  // closure, in the words people actually ask for it in. With no frame of its
  // own each of these reached a wrong lane: the forward form's residue
  // ("break I") read as a subject for the history lane's `touches`, the NP
  // form fell to the teach lane (a read-only question mutating memory) or to
  // the fuzzy corrector ("impact" read as "import", the inverse question).
  // /impact's own closure is the answer, and its wording ("Impact of changing
  // X") already says the change is hypothetical.
  const impactSubject = matchImpactIntent(workingLine);
  if (impactSubject) {
    const impactDeduced = "understand what a change to this module would reach (impact closure)";
    note(trace, `goal: ${impactDeduced}`);
    note(trace, `lane: impact intent matched -> /impact ${impactSubject}`);
    return withLast(await runCommand(`/impact ${impactSubject}`, ctx), impactDeduced);
  }

  // Multi-sentence pre-split — one message carrying several sentences
  // ("disk-1 rests on disk-2. … the goal is that …. solve it.") runs each
  // sentence as its own nested turn, threading focus/last/planState through,
  // and answers with the final turn's result behind brief receipts. Fires
  // when the line ends in a plan trigger, or when every sentence is a
  // self-contained teach: either way each sentence has a lane of its own, so
  // none of them reaches the parser glued to its neighbours.
  if (!_noSplit && memoryDir && carriesASentenceBoundary(workingLine)) {
    const sentences = splitSentences(workingLine);
    if (sentences.length > 1) {
      const lastSentence = sentences[sentences.length - 1];
      const endsInPlanTrigger = PLAN_SOLVE_RE.test(lastSentence) || GOAL_TEACH_RE.test(lastSentence)
        || GOAL_TEACH_INFINITIVE_RE.test(lastSentence) || GOAL_TEACH_VERBLESS_RE.test(lastSentence)
        || LEGAL_MOVES_RE.test(lastSentence);
      // The syllogism one-liner — "Every man is mortal. Socrates is a man. Is
      // Socrates mortal?": every sentence but the last teaches on its own, and
      // the last is a question. Each teach stores (in order, so the question
      // sees them), then the final sentence is answered as the payload behind
      // the teach receipts, the same rendering the plan-trigger case uses.
      const teachesThenAsks = !endsInPlanTrigger && /\?\s*$/.test(lastSentence.trim())
        && await everySentenceTeaches(sentences.slice(0, -1), lexicon);
      const finalIsPayload = endsInPlanTrigger || teachesThenAsks;
      if (finalIsPayload || await everySentenceTeaches(sentences, lexicon)) {
        let f = focus; let l = last; let ps = planHolder.state; let d = discourseHolder.record;
        const receipts = [];
        let finalRec = null;
        for (const sentence of sentences) {
          const r = await runTurn(sentence, {
            config, source, graph, focus: f, last: l, memoryDir, sessionId, env, lexicon,
            narrate: false, vocabHint, tel, biasByBundle, planState: ps, discourse: d, _noSplit: true,
          });
          f = r.focus ?? f;
          l = r.last ?? l;
          if ("planState" in r) ps = r.planState;
          if ("discourse" in r) d = r.discourse;
          finalRec = r;
          receipts.push(String(r.answer ?? "").split("\n")[0]);
        }
        // When a plan trigger closes the line, the final sentence is the payload
        // (the plan) and the earlier teaches are brief bulleted receipts. When
        // every sentence teaches, the final one is a teach too, so it earns a
        // bullet like its siblings — otherwise it renders unbulleted and trails
        // a stray "Goal (inferred)" line the bulleted ones already dropped. Its
        // goal-line tail (everything after the receipt's first line) is kept once.
        let answer;
        if (finalIsPayload) {
          const receiptLines = receipts.slice(0, -1).map((t) => `• ${t}`).join("\n");
          answer = receiptLines ? `${receiptLines}\n\n${finalRec.answer}` : finalRec.answer;
        } else {
          const bullets = receipts.map((t) => `• ${t}`).join("\n");
          const goalTail = String(finalRec.answer ?? "").split("\n").slice(1).join("\n").trim();
          answer = goalTail ? `${bullets}\n\n${goalTail}` : bullets;
        }
        const combined = { ...finalRec, answer };
        combined.planState = ps;
        combined.focus = f;
        combined.last = l;
        combined.discourse = d;
        // Each per-sentence turn recorded only its OWN sentence; the transcript
        // echo and the turn record must quote the whole multi-sentence line the
        // user actually typed, not just its last sentence.
        const ts0 = Array.isArray(finalRec.logLines) && finalRec.logLines.length ? finalRec.logLines[0] : new Date().toISOString();
        combined.logLines = [ts0, `> ${line}`, answer, ""];
        if (finalRec.record) combined.record = { ...finalRec.record, query: line, input: line };
        return combined;
      }
    }
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
      asserted.lane = "teach";
      return withLast(asserted, "teach/remember a new fact");
    }
    // Bare declarative taxonomy (hyphenated-instance membership, article-led
    // kind-of) — see bareTaxonomyTeach. Checked here because the ask engine
    // would otherwise parse these statements as inherits QUESTIONS.
    const taxonomy = await bareTaxonomyTeach(workingLine, ctx);
    if (taxonomy) {
      note(trace, "goal: teach/remember a new fact (bare declarative taxonomy)");
      note(trace, "lane: bareTaxonomyTeach — hyphenated-instance or article-led kind-of declarative, stored before the ask engine could parse it as a question");
      const taxonomyTurn = plainTurn(workingLine, taxonomy.text, { via: taxonomy.via, miss: taxonomy.miss, focus });
      if (!taxonomy.miss) taxonomyTurn.lane = "teach";
      return withLast(taxonomyTurn, "teach/remember a new fact");
    }
  }
  // Synonym/related-word questions read the store through the SKOS view.
  // Routed before the ask engine: the generic parse reads "another word for
  // X" as a bare object search and "what is related to X" through
  // BARE_WHATIS_RE, both wrong lanes for this question.
  if (memoryDir) {
    const skos = await skosRelatedAnswer(memoryDir, workingLine, factRowsCache);
    if (skos) {
      const goal = `surface the remembered synonym/related-word neighbourhood of "${skos.term}"`;
      note(trace, `goal: ${goal}`);
      note(trace, `lane: SKOS VIEW — a synonym/related question ${skos.miss ? "matched but the store holds no such facts (honest miss)" : "answered from the store's relation facts"}`);
      if (!skos.miss) note(trace, "source: .tmct/memory Facts (mgx:synonym/mgx:relatedTo/mgx:similarTo, read as skos:altLabel/skos:related)");
      const skosTurn = plainTurn(workingLine, skos.text, { via: skos.miss ? "miss" : "fact", miss: skos.miss, focus });
      if (!skos.miss) skosTurn.goal = goal;
      skosTurn.lane = skos.miss ? "honest-miss" : "ask-set";
      return withLast(skosTurn, goal);
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
  // "list facts"/"list utterances"/"how many sessions are there" — enumerate the
  // stored individuals answerMemoryCount only tallies, and reach the meta-classes
  // (Session/Source/Rule) it skips. Placed here so ask()'s CODE-graph lanes never
  // steal the phrasing; declines cleanly for a code-graph noun or a real restrictor.
  if (memoryDir) {
    const memClass = await answerMemoryClassQuery(memoryDir, workingLine);
    if (memClass != null) {
      const goal = "list or count a memory-store kind (facts/utterances/sessions/sources/rules)";
      note(trace, `goal: ${goal}`);
      note(trace, "lane: answerMemoryClassQuery — matched a memory-store class noun, answered off the .tmct/memory store's own individuals");
      const turn = plainTurn(workingLine, memClass.text, { via: memClass.miss ? "miss" : "fact", miss: !!memClass.miss, focus });
      if (memClass.pending) turn.detail = { traversal: null, matches: [], pending: memClass.pending };
      return withLast(turn, goal);
    }
  }
  // "how many animals are there" — count a taught class's members, ahead of the
  // quantifier lane (which reads "there" as a second noun and answers "I was never
  // told a quantifier" for the exact same phrasing).
  if (memoryDir) {
    const taughtCount = await answerTaughtClassCount(memoryDir, workingLine, biasByBundle, factRowsCache);
    if (taughtCount != null) {
      note(trace, 'goal: count the taught members of a class ("how many animals are there")');
      note(trace, "lane: answerTaughtClassCount — matched a plain-noun count over taught isa-facts whose OBJECT is that class");
      return withLast(plainTurn(workingLine, taughtCount, { via: "count", focus }), "count a taught class's members");
    }
  }
  // "list all animals"/"list the animals" — enumerate a taught class's members
  // from its own trigger, ahead of the conversational orientation lane that would
  // otherwise claim the bare "list …" phrasing.
  if (memoryDir) {
    const memberList = await answerMembershipList(memoryDir, workingLine, biasByBundle, factRowsCache);
    if (memberList != null) {
      const goal = "list the taught members of a class";
      note(trace, `goal: ${goal}`);
      note(trace, "lane: answerMembershipList — matched a bare 'list <noun>' over taught isa-facts whose OBJECT is that class");
      const turn = plainTurn(workingLine, memberList.text, { via: memberList.miss ? "miss" : "fact", miss: !!memberList.miss, focus });
      if (memberList.pending) turn.detail = { traversal: null, matches: [], pending: memberList.pending };
      return withLast(turn, goal);
    }
  }
  // "how many Xs are Ys" — a taught-quantifier RECALL, checked explicitly
  // ahead of answerCount. Its own authority gate declines for anything
  // answerCount should own, so ordinary structural counts are unaffected.
  if (memoryDir) {
    const quantifierRecall = await answerQuantifierRecall(memoryDir, workingLine, biasByBundle, factRowsCache);
    if (quantifierRecall != null) {
      note(trace, 'goal: recall a taught quantifier for a class-membership pair ("how many Xs are Ys")');
      note(trace, "lane: answerQuantifierRecall — matched HOW_MANY_ARE_RE with a subject tmct has facts about; literal recall, never real counting");
      return withLast(plainTurn(workingLine, quantifierRecall, { via: "fact", focus }), "recall a taught quantifier");
    }
  }
  // Edge-nominalized "how many X" counts ("how many tests cover Y", "how many
  // callers does Y have") — checked BEFORE answerCount (same precedence
  // pattern as answerQuantifierRecall/answerMemoryCount above): answerCount's
  // own COUNT_NOUNS table doesn't know these nouns at all and would otherwise
  // short-circuit straight to "I can't count 'tests'" before this lane ever
  // got a turn. Declines (null) for anything answerCount should own, or a bare
  // global count with no named entity — see answerEdgeCount's own docblock.
  const edgeCount = await answerEdgeCount(graph, workingLine);
  if (edgeCount != null) {
    note(trace, 'goal: get a per-entity count of an edge-nominalized kind ("how many tests cover X", "how many callers does X have")');
    note(trace, "lane: answerEdgeCount — matched an EDGE_NOUN_TO_METRIC noun with a resolvable named entity, answered via the same degreeMetric the superlative lane uses");
    return withLast(plainTurn(workingLine, edgeCount, { via: "count", focus }), "get a per-entity edge count");
  }
  // Aggregate/count questions are answered mechanically off the loaded graph header,
  // BEFORE falling through to the ask engine (focus unchanged — a count names no entity).
  const count = answerCount(graph, workingLine);
  if (count != null) {
    // An "I can't count <noun>" from a bare kind may still be answerable from an
    // ASSERTED vocabulary fact ("every class is a type" → "how many types" = the
    // class count). countFromFacts declines on a real graph kind, so ordinary
    // counts are unaffected; it only speaks for a remembered object noun.
    const viaFact = memoryDir ? await countFromFacts(graph, memoryDir, workingLine, biasByBundle, factRowsCache) : null;
    if (viaFact != null) {
      note(trace, 'goal: get a count of an asserted-vocabulary kind ("every X is a Y" inherited cardinality)');
      note(trace, "lane: countFromFacts — the counted noun matched a remembered isa-fact's SUBJECT, whose class IS countable");
      return withLast(plainTurn(workingLine, viaFact, { via: "fact", focus }), "get a count");
    }
    note(trace, "goal: get a count of a graph kind (classes/functions/modules/…)");
    note(trace, "lane: answerCount — a header-count aggregate question, answered mechanically off the graph header, never dispatched to the ask engine");
    return withLast(plainTurn(workingLine, count, { via: "count", focus }), "get a count of a graph kind");
  }
  {
    const rec = withLast(await runAsk(workingLine, ctx), "unclear — no goal signal computed by the ask engine");
    rec.planState = planHolder.state;
    return rec;
  }
}

// ---- W3: seedMemory → bootstrap (first run in a graph-less repo) ----

/** The first-run bootstrap seeds the WHOLE shipped ConceptNet band (no cap).
 *  `undefined` means seedMemory writes every seedable fact in the committed
 *  slice (~6.3k) — the batched appendFacts write makes this a single O(N)
 *  pass, fast enough to run synchronously at session start. */
export const SEED_LIMIT = undefined;

/** Which predicates the seed lists FIRST — the definitional band leads, so
 *  the on-disk memory opens with the vocabulary that answers "what is a
 *  cache?"-style questions rather than location trivia. */
export const SEED_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];

/** The seed marker: its presence means this repo's memory already carries the
 *  corpus seed, so re-runs skip without even reading the slice. */
export const SEED_MARKER_REL = join(".tmct", "memory", "corpus-seed.json");

/** Whether THIS repo's memory actually carries the corpus seed — the marker is
 *  authoritative regardless of whether the CURRENT run or an earlier one did
 *  the seeding. The one signal every "try this vocabulary example" surface
 *  must check before offering a term-specific query — see vocabExampleHint.
 *  Used both here (runTurn's per-call vocabHint fallback) and by the session
 *  layer's createSession; the readFile is imported lazily so this module stays
 *  free of a static node:fs import. */
export async function hasSeededVocabulary(repo) {
  if (!repo) return false;
  try {
    const { readFile } = await import("node:fs/promises");
    await readFile(join(repo, SEED_MARKER_REL), "utf8");
    return true;
  } catch { return false; }
}

/** A "try this" vocabulary-example clause that's PROVABLY correct in the session
 *  it's shown, mirroring the discipline orientationExamples() already applies to
 *  structural examples (never offer an example that isn't confirmed to resolve).
 *  `dog` is present in the default human-world persona's corpus, backed by a
 *  corpus:human concept fact, but only actually answerable once the seed has
 *  run — when it hasn't, offering it would be a lie worse than no example, so
 *  this swaps to an unconditionally-true pointer instead. Computed ONCE per
 *  session, not per turn. The unseeded branch's teach clause is a CONCRETE
 *  pair too: an abstract "every X is a Y" invites a curious user to fill X/Y
 *  with an intuitive-but-unknown word and hit the teach-miss dead-end right
 *  after being offered the pattern. "every bug is an issue" is confirmed to
 *  parse and store, so the offer resolves if copied verbatim. */
export function vocabExampleHint(seeded) {
  return seeded
    ? 'Try "what is a dog" for general vocabulary.'
    : 'Run `tmct init` to seed a starter vocabulary, or teach me directly, e.g. "every bug is an issue".';
}
