// src/domain/router/resolver.mjs — the resolver. Turn a request
// into a SELECTED registry capability with bound arguments, by backward chaining over
// capabilities-as-facts. Deterministic, no-LLM, glass-box: every choice is provable.
//
// A request becomes an epistemic GOAL `(knows <topic> ?of)`; backward chaining finds the
// capability whose add-effect achieves it and binds `?of` to the request's object term.
// Three fact sources feed the same backward-chaining step, tried in order: the command
// register (the ctx-injected selectTool — terse verbs, ground truth, tried first since a
// terse command can mis-parse through the NL grammar), the NL parse (ask.mjs's relational
// grammar, via NL_INTENTS), and imperative intent FRAMES (curated phrasings the relational
// grammar doesn't carry, and a rescue path when the NL parse selects an out-of-set
// capability).
//
// Entity binding is delegated to `resolveObject` (ask.mjs); an ambiguous or no-match term
// is an honest refuse, never a guess.

import { parseQuery } from "../ask.mjs";
import { SUPERLATIVE_EXTREMES } from "../ask-vocab.mjs";
import {
  capabilities, capabilityByName, preconditionsOf, effectsOf, PRECOND,
} from "./registry.mjs";
import { hallucinationsIn } from "./call-validator.mjs";

// A ranking/superlative cue ("most", "biggest", …), reusing ask.mjs's own vocabulary
// (SUPERLATIVE_EXTREMES). Used below to keep a flat imperative frame from claiming a
// request that's actually asking to be ranked — that's the goal-reasoner's job.
const SUPERLATIVE_RE = new RegExp(
  `\\b(?:${Object.keys(SUPERLATIVE_EXTREMES).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|")})\\b`,
  "i",
);

// ---- the ask-kind -> epistemic-topic MAPPING (the Stage-1 core) --------------
// Keyed `${shape}:${kind}` off parseQuery's output. Every topic must be achievable by
// exactly one registered capability (the bidirectional conformance test proves it).
export const NL_INTENTS = Object.freeze({
  "reverse:calls": { topic: "callers", arg: "symbol" }, // "which fns call X" -> callers of X
  "forward:calls": { topic: "callees", arg: "symbol" }, // "what does X call"  -> callees of X
  "reverse:tests": { topic: "tests", arg: "symbol" }, // "which tests cover X"
  "forward:tests": { topic: "tests", arg: "symbol" }, // "what tests X"
  "reverse:inherits": { topic: "subclasses", arg: "class" }, // "which classes extend X"
  "forward:reexports": { topic: "exports", arg: "module" }, // "what does X export"
  "forward:contains": { topic: "members", arg: "class" }, // "what does X contain" -> members of X
  "when:touches": { topic: "history", arg: "symbol" }, // "when did X change" -> commit history
  "forward:cochange": { topic: "cochanges", arg: "symbol" }, // "what changes with X"
  "reverse:cochange": { topic: "cochanges", arg: "symbol" },
});

// ---- ask-vocab RELATION kinds with NO capability ------------------------------
// Every ask-vocab.mjs RELATIONS key must be either mapped (above) or listed here with a
// reason (the conformance test enforces the partition). Refuse rather than mis-route.
export const UNMAPPED_KINDS = Object.freeze({
  imports: "no importer/imports query tool in the registry (there is no tmct_imports); refusing beats mis-routing to calls",
  uses: "a query-side UNION (imports+calls+callsSymbol) with no single capability; a router that must emit ONE call cannot honour it — refuse",
  defines: "Module->symbol `defines` has no dedicated capability (tmct_members is Class-scoped `contains`); refuse rather than answer a different grain",
});

// ---- capabilities the NL surface cannot reach today (named, not accidental) ---
// A declared capability with no NL/command/frame path is a routing gap and must be tagged
// here with the reason.
export const NOT_NL_REACHABLE = Object.freeze({
  tmct_related: "the SKOS synonym/related surface is served by the chat lane's own recogniser over the memory graph; a router frame for it needs memory-term binding, which resolveObject (code-graph-only) does not prove yet",
});

// ---- imperative intent FRAMES (fills what the relational grammar and command register
// both miss). regex -> { topic, arg | noArg }. Ordered: first match wins.
export const FRAMES = Object.freeze([
  // skipIfSuperlative: a request carrying a superlative cue ("what MOST needs a test") is
  // asking to be ranked — the goal-reasoner's job, not this flat listing's.
  { re: /\buntested\b|\bwithout\s+(?:a\s+)?tests?\b|\bhas\s+no\s+tests?\b|\bneeds?\s+(?:a\s+)?tests?\b/i, topic: "untested", noArg: true, skipIfSuperlative: true },
  { re: /\bblast\s*radius\b|\bimpacts?\b|\bimpacted\b|what\s+(?:a\s+)?change.*(?:reach|affect|touch)|what\s+(?:depends?\s+on|dependents?)\b/i, topic: "impact", arg: "module" },
  // tmct_calls: the RAW call-edge dump, a grain the relational "call" verb collides with.
  // Keys on explicit edge-dump nouns ("call edges", "call graph") so it opens a distinct
  // surface without touching callers/callees. FIRST so it wins before the verb frames below.
  { re: /\bcall[\s-]*edges?\b|\bcall[\s-]*graph\b|\boutgoing\s+calls?\b|\bcall[\s-]*sites?\s+(?:of|in|out|from)\b/i, topic: "calls", arg: "symbol" },
  { re: /\bcallees?\b|wh(?:at|o)\s+does\s+\S+\s+call\b/i, topic: "callees", arg: "symbol" },
  { re: /\bcallers?\b|who\s+calls\b|what\s+calls\b/i, topic: "callers", arg: "symbol" },
  { re: /\btests?\b.*\b(?:for|cover|covering|of)\b|which\s+tests?\b|covers?\b|covered\b|test\s+coverage\b/i, topic: "tests", arg: "symbol" },
  { re: /\bcochang|change[- ]coupl/i, topic: "cochanges", arg: "symbol" },
  { re: /\bexports?\b|\bpublic\s+api\b/i, topic: "exports", arg: "module" },
  { re: /\bsubclasses?\b|children\s+of\b|\bextends?\b/i, topic: "subclasses", arg: "class" },
  { re: /\bmembers?\b|\bmethods?\s+of\b|\battributes?\s+of\b/i, topic: "members", arg: "class" },
  { re: /\bhistory\b|who\s+changed\b|commits?\s+(?:that\s+)?touch/i, topic: "history", arg: "symbol" },
  { re: /\bsignature\b/i, topic: "signature", arg: "symbol" },
  { re: /\bdescribe\b|\bexplain\b|what\s+is\b|tell\s+me\s+about\b|definition\s+of\b/i, topic: "description", arg: "symbol" },
  { re: /\bsearch\b|\bfind\b|look\s+for\b/i, topic: "matches", arg: "query" },
]);

// ---- backward chaining (the SLD/Datalog step) --------------------------------

/** Backward-chain a goal `(knows <topic> ?of)` to the registered capability whose
 *  add-effect achieves it. Pure over the registry; returns the capability or null. */
export function backwardChain(topic) {
  for (const cap of capabilities()) {
    if (effectsOf(cap.name).add.some((e) => e.topic === topic)) return cap;
  }
  return null;
}

/** Backward-chain a WORLD goal — a state predicate like "rest-on" that a
 *  taught action's effect establishes — to the registered record whose
 *  add-list carries the matching taught:world-effect (the bridge
 *  src/domain/router/taught.mjs registers). Pure over the registry; null when no
 *  taught record achieves the predicate. The sibling of backwardChain above,
 *  which only ever matches epistemic `knows` effects. */
export function backwardChainWorld(predicate) {
  for (const cap of capabilities()) {
    if (effectsOf(cap.name).add.some((e) => e.pred === "taught:world-effect" && e.predicate === predicate)) return cap;
  }
  return null;
}

// Stopwords for the imperative-frame entity extractor. Deliberately generous: a wrong
// pick is caught by the resolveObject miss -> honest refuse, never emitted.
const STOP = new Set([
  "what", "whats", "which", "who", "whom", "does", "do", "did", "is", "are", "the", "a", "an",
  "of", "for", "to", "in", "on", "by", "me", "us", "tell", "about", "show", "list", "give", "get",
  "assess", "check", "then", "and", "or", "instead", "if", "end", "up", "its", "it", "this", "that",
  "call", "calls", "called", "caller", "callers", "callee", "callees", "test", "tests", "tested",
  "cover", "covers", "covering", "describe", "description", "define", "definition", "impact",
  "member", "members", "method", "methods", "attribute", "attributes", "subclass", "subclasses",
  "export", "exports", "history", "commit", "commits", "signature", "search", "find", "look",
  "module", "modules", "class", "classes", "function", "functions", "symbol", "symbols",
  "untested", "blast", "radius", "change", "changes", "changing", "reach", "reaches", "affect", "affects",
  "explain", "edge", "edges", "graph", "outgoing", "site", "sites", "invoke", "invokes", "run", "runs", "execute", "executes",
]);

/** Pull one entity token from a request (imperative-frame slot-filling). Prefer a
 *  path/dotted/CamelCase token, else the last non-stopword identifier. "" if none. */
export function extractEntity(request) {
  const tokens = String(request).match(/[A-Za-z_][A-Za-z0-9_./-]*/g) || [];
  const pool = tokens.filter((t) => !STOP.has(t.toLowerCase()));
  const strong = pool.filter((t) => /[./]/.test(t) || /^[A-Z][a-z]/.test(t) || /\.[a-z]+$/.test(t));
  const pick = strong.length ? strong : pool;
  return pick.length ? pick[pick.length - 1] : "";
}

/** The residual search query: strip the leading search/find verb + a filler "for". */
function searchQuery(request) {
  return String(request).replace(/^\s*(?:search|find|look\s+for|look)\s+(?:for\s+)?/i, "").trim();
}

// ---- request -> capability + raw term (PURE, no binding yet) -----------------

/** Map a parseQuery simple-clause parse to a capability selection, or a refusal,
 *  or null (not an NL shape this resolver routes). Returns one of:
 *    { name, arg, term, topic, source:"nl", why:[...] }   — a selection
 *    { refuse:true, reason }                               — an honest no-fit
 *    null                                                   — parse absent / not simple
 *  Backward-chains topic -> capability so selection is provable, never by name. */
export function mapParse(parse) {
  if (!parse || parse.node || !parse.shape) return null; // compositional/absent -> not here
  const { shape, kind } = parse;
  // yes/no + locational/vocabulary shapes have no read-only query operator
  if (shape === "ask") return { refuse: true, reason: "a yes/no `does X <verb> Y` question has no capability that emits it (the registry answers WHAT, not WHETHER)" };
  if (shape === "where" || shape === "meta" || shape === "mentions") {
    return { refuse: true, reason: `the "${shape}" shape (location/vocabulary/prose) has no read-only graph-query capability` };
  }
  const intent = NL_INTENTS[`${shape}:${kind}`];
  if (!intent) {
    const reason = UNMAPPED_KINDS[kind] || `no capability maps the ${shape}/${kind} intent`;
    return { refuse: true, reason };
  }
  const cap = backwardChain(intent.topic);
  if (!cap) return { refuse: true, reason: `backward chaining found no capability achieving (knows ${intent.topic})` };
  return {
    name: cap.name, arg: intent.arg, term: String(parse.object || "").trim(), topic: intent.topic, source: "nl",
    why: [`parse ${shape}/${kind} => goal (knows ${intent.topic} ?${intent.arg})`, `backward-chain => ${cap.name} (its add-effect achieves ${intent.topic})`],
  };
}

/** Match an imperative FRAME. Returns { name, arg|noArg, term, topic, source:"frame", why }
 *  or null. Backward-chains the frame's topic to a capability. */
export function mapFrame(request) {
  for (const f of FRAMES) {
    if (!f.re.test(request)) continue;
    if (f.skipIfSuperlative && SUPERLATIVE_RE.test(request)) continue;
    const cap = backwardChain(f.topic);
    if (!cap) continue;
    if (f.noArg) return { name: cap.name, noArg: true, topic: f.topic, source: "frame", why: [`imperative frame => goal (knows ${f.topic})`, `backward-chain => ${cap.name}`] };
    const term = f.arg === "query" ? searchQuery(request) : extractEntity(request);
    return { name: cap.name, arg: f.arg, term, topic: f.topic, source: "frame", why: [`imperative frame => goal (knows ${f.topic} ?${f.arg})`, `backward-chain => ${cap.name}`] };
  }
  return null;
}

/** The command register (an injected selectTool — chat.mjs's, in the live
 *  wiring) filtered to the registry. Returns { name, input, source:"command",
 *  why } or null. selectTool binds the arg from the terse command; we re-clean
 *  a search query (its raw join keeps a stray "for"). Never reaches outside
 *  the declared set. A caller with no command register passes none and the
 *  lane stays silent. */
export function commandCapability(request, declaredNames, selectTool) {
  if (typeof selectTool !== "function") return null;
  const sel = selectTool(request, new Set(declaredNames));
  if (!sel || !capabilityByName(sel.name)) return null;
  const input = { ...sel.input };
  if (sel.name === "tmct_search" && input.query != null) input.query = searchQuery(request) || String(input.query);
  return { name: sel.name, input, source: "command", why: [`command register: "${String(request).trim().split(/\s+/)[0]}" => ${sel.name}`] };
}

// ---- the full single-call resolver (async — binds + grounds) -----------------

/** Build the glass-box proof chain for a grounded single call: its preconditions then the
 *  epistemic add-effect. Dispatch has succeeded, so `resolves` steps are ok. */
function proofFor(name, input) {
  const steps = [];
  for (const pre of preconditionsOf(name)) {
    if (pre.pred === PRECOND.graphLoaded) steps.push({ step: "precondition", pred: pre.pred, ok: true });
    else if (pre.pred === PRECOND.resolves) steps.push({ step: "precondition", pred: pre.pred, param: pre.param, value: input[pre.param] ?? null, ok: true });
    else if (pre.pred === PRECOND.anyPresent) steps.push({ step: "precondition", pred: pre.pred, params: pre.params, ok: pre.params.some((k) => input[k]) });
  }
  for (const eff of effectsOf(name).add) steps.push({ step: "effect", pred: eff.pred, topic: eff.topic, of: eff.of });
  return steps;
}

const REFUSE = (why, extra) => ({ selected: null, refused: true, reason: why, ...(extra || {}) });

/** The gate both dispatch sites below go through. Dispatching is an OBSERVATION, so it
 *  may only ever run a capability whose own record says it performs no writes. A
 *  world-mutating record (the ones src/domain/router/taught.mjs registers carry
 *  `readOnly: false`) is planned over and simulated, never fired here. */
function dispatchPerformsNoWrites(capName) {
  return capabilityByName(capName)?.readOnly === true;
}

/** Breadth-first ambiguity: dispatches the SAME tool once per tied candidate, which only
 *  stays safe while the tool writes nothing. Returns `[{candidate, result}, ...]`, or
 *  undefined when there is no dispatcher to run it with — or when the capability is not
 *  read-only. */
async function dispatchEachCandidate(pool, capName, arg, ctx, execute) {
  if (!execute || !ctx.dispatch) return undefined;
  if (!dispatchPerformsNoWrites(capName)) return undefined;
  const results = [];
  for (const c of pool) {
    const res = await ctx.dispatch(capName, { [arg]: c.label });
    results.push({ candidate: c.label, result: res });
  }
  return results;
}

/** Select a capability for a request and BIND its arguments — the full resolver.
 *  Order: command register -> NL parse -> imperative frame. Delegates entity binding to
 *  ctx.resolve and, unless `execute:false`, grounds it via ctx.dispatch. Returns
 *    { selected:{name,input}, proof, why, resolved, observed? }  — a grounded call
 *    { selected:null, refused:true, reason, candidateResults? }  — an honest refusal
 *  Never emits an ungrounded / ambiguous / undeclared call. */
export async function resolveOne(request, declaredNames, ctx, { execute = true } = {}) {
  const declared = new Set(declaredNames);

  // An NL-parse refusal is not terminal: an imperative FRAME may still hit, so we fall
  // through and only surface the NL reason if the frame misses too.
  let pick = commandCapability(request, declared, ctx && ctx.selectTool);
  let nlRefuse = null;
  let nlUndeclared = null;
  if (!pick) {
    const mapped = mapParse(parseQuery(request));
    if (mapped && !mapped.refuse) {
      // An out-of-set NL selection isn't terminal: an imperative FRAME may still reach a
      // declared capability for the same request (e.g. the calls-frame reaches tmct_calls
      // where keyword-spotting mis-routes toward out-of-set callers/callees).
      if (declared.has(mapped.name)) pick = mapped;
      else nlUndeclared = mapped.name;
    } else if (mapped && mapped.refuse) nlRefuse = mapped.reason;
  }
  if (!pick) pick = mapFrame(request);
  if (!pick) {
    if (nlRefuse) return REFUSE(nlRefuse);
    if (nlUndeclared) return REFUSE(`selected ${nlUndeclared} but it is not in the declared toolset`);
    return REFUSE("no command, NL parse, or imperative frame selects a capability");
  }
  let why = pick.why ?? [];
  if (!declared.has(pick.name)) return REFUSE(`selected ${pick.name} but it is not in the declared toolset`);

  // A command pick already carries a bound input; an NL/frame pick carries a raw term
  // we bind via resolveObject.
  let input = pick.input ? { ...pick.input } : {};
  let resolved = null;
  if (!pick.input && !pick.noArg) {
    const term = String(pick.term || "").trim();
    if (!term) return REFUSE(`the ${pick.topic} intent named no entity to bind`);
    const r = ctx.resolve ? ctx.resolve(term) : { match: { label: term }, ambiguous: false };
    if (!r || !r.match) return REFUSE(`"${term}" does not resolve to any graph entity (honest miss)`);
    if (r.ambiguous) {
      const pool = [r.match, ...(r.candidates || [])].slice(0, 4);
      const candidateResults = await dispatchEachCandidate(pool, pick.name, pick.arg, ctx, execute);
      return REFUSE(`"${term}" is ambiguous (${pool.map((m) => m.label).join(", ")}) — narrow it`, candidateResults ? { candidateResults } : undefined);
    }
    resolved = r.match;
    input = { [pick.arg]: r.match.label };
    why = [...why, `resolveObject: "${term}" => ${r.match.label} (${r.match.class || "?"}, tier ${r.tier})`];
  }

  const call = { name: pick.name, input };
  const problems = hallucinationsIn(call, [...declared]);
  if (problems.length) return REFUSE(`bound call did not validate: ${problems.map((p) => p.reason).join(",")}`);

  if (execute && ctx.dispatch) {
    if (!dispatchPerformsNoWrites(pick.name)) {
      return REFUSE(`${pick.name} is not read-only; the resolver observes, it never fires a world-mutating capability`);
    }
    const res = await ctx.dispatch(pick.name, input);
    if (!res.ok) return REFUSE(`unresolvable at dispatch: ${res.error}`);
    return { selected: call, proof: proofFor(pick.name, input), why, resolved: res.resolved ?? resolved, observed: String(res.text ?? "").slice(0, 240) };
  }
  return { selected: call, proof: proofFor(pick.name, input), why, resolved };
}

// ---- reachability (used by the bidirectional conformance test + docs) ---------

/** The epistemic topics some NL intent or imperative frame can reach. */
function nlReachableTopics() {
  const topics = new Set();
  for (const v of Object.values(NL_INTENTS)) topics.add(v.topic);
  for (const f of FRAMES) topics.add(f.topic);
  return topics;
}

/** Every capability an NL intent or frame can reach (by name), via backwardChain. */
export function reachableCapabilityNames() {
  const names = new Set();
  for (const topic of nlReachableTopics()) { const c = backwardChain(topic); if (c) names.add(c.name); }
  return names;
}
