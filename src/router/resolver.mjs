// src/router/resolver.mjs — Stage 1 of the capability router (PLAN_CAPABILITY_ROUTER.md):
// THE RESOLVER. Turn a request into a SELECTED registry capability with bound
// arguments, by unification + backward chaining over capabilities-as-facts
// (a mini-Datalog/SLD step, exactly the "open-condition satisfaction" the plan
// names). Deterministic, no-LLM, glass-box: every choice is provable.
//
// THE CORE is the ask-kind -> capability MAPPING. A request becomes an epistemic
// GOAL `(knows <topic> ?of)`; each capability's add-effect declares which topic
// it achieves (registry.mjs `knows(topic, of)`); backward chaining finds the
// capability whose add-list unifies with the goal and binds ?of to the request's
// object term. Three fact sources feed the SAME backward-chaining step:
//
//   1. THE COMMAND REGISTER (server-http.mjs `selectTool`, the terse verbs
//      "describe X" / "callers X" / "untested") — exact + unambiguous, tried
//      FIRST because a terse command mis-parses through the NL grammar (e.g.
//      "callees Widget.render" keyword-spots to shape:reverse/kind:calls, which
//      would wrongly route to callers). A literal command verb is ground truth.
//   2. THE NL PARSE (ask.mjs `parseQuery` -> {shape, kind, entityType, object}) —
//      the relational grammar ("which functions call X", "what does X export").
//      NL_INTENTS maps a {shape,kind} to the epistemic TOPIC; backwardChain maps
//      the topic to the capability. This is the Stage-1 deliverable proper.
//   3. IMPERATIVE INTENT FRAMES (Stage 2, this module's FRAMES table) — curated
//      phrasings the relational grammar does not carry ("blast radius of X",
//      "who calls X", "search for X", "the call edges of X", "explain X"): a
//      regex -> {topic, arg}. Same backward chaining (topic -> capability), same
//      resolveObject binding. This is the surface that lifts NL reach above the
//      command register: it reaches tmct_calls (the raw call-edge dump — a grain
//      the relational "call" verb collides with) via an EXPLICIT edge-dump frame,
//      and it rescues a request whose NL parse selected an OUT-OF-SET capability
//      by re-selecting a DECLARED one (resolveOne falls through to the frame).
//
// ENTITY BINDING is DELEGATED to `resolveObject` (ask.mjs — the tiered lemma/
// fuzzy binding oracle with honest ambiguity). This module NEVER re-implements
// resolution: the registry's `resolves(param, as)` precondition maps exactly to
// a resolveObject call, and an ambiguous / no-match term is an HONEST REFUSE,
// never a guess. On any no-fit -> refuse.
//
// Pure-ish: mapParse/mapFrame/backwardChain/commandCapability are pure; resolveOne
// is async only because it consults ctx.resolve (the graph binding oracle) and
// ctx.dispatch (executes the grounded call). No network, no Date.now.

import { parseQuery } from "../ask.mjs";
import { selectTool } from "../server-http.mjs";
import {
  capabilities, capabilityByName, preconditionsOf, effectsOf, PRECOND,
} from "./registry.mjs";
import { hallucinationsIn } from "./call-validator.mjs";

// ---- the ask-kind -> epistemic-topic MAPPING (the Stage-1 core) --------------
// Keyed `${shape}:${kind}` off parseQuery's simple-clause output. The VALUE is
// the epistemic TOPIC a capability's add-effect must achieve; backwardChain then
// unifies that topic with the registry (capabilities-as-facts). Every entry's
// topic MUST be achievable by exactly one registered capability (the bidirectional
// conformance test proves it). `arg` is the parameter grain the object binds to.
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

// ---- ask-vocab RELATION kinds with NO capability — the HONEST ceiling --------
// Every ask-vocab.mjs RELATIONS key must be either mapped (above) or listed here
// with a reason (the bidirectional conformance test enforces the partition — no
// silent gap). These are relations tmct's grammar SPEAKS but the read-only
// graph-query registry has no operator for: routing them anywhere would be a
// mis-route, so the resolver REFUSES (never a guess).
export const UNMAPPED_KINDS = Object.freeze({
  imports: "no importer/imports query tool in the registry (there is no tmct_imports); refusing beats mis-routing to calls",
  uses: "a query-side UNION (imports+calls+callsSymbol) with no single capability; a router that must emit ONE call cannot honour it — refuse",
  defines: "Module->symbol `defines` has no dedicated capability (tmct_members is Class-scoped `contains`); refuse rather than answer a different grain",
});

// ---- capabilities the NL surface cannot reach today (named, not accidental) ---
// A declared capability with no NL/command/frame path is a ROUTING GAP. The
// conformance test FAILS on an untagged gap; a genuinely-unreachable cap must be
// tagged HERE with the Stage it needs, so the ceiling is honest rather than a
// silent low-completion refuse. (Coordinator reinforcement 2.)
//
// EMPTY as of Stage 2. tmct_calls — the raw call-edge dump that USED to sit here —
// is now reached by a DEDICATED imperative frame keyed on the "call edges / call
// graph / outgoing calls of X" phrasings the relational grammar does NOT carry
// (see FRAMES below). The collision the old tag named is real, so the frame does
// NOT touch the relational "call" verb (that still routes callers/callees); it
// opens a SECOND, distinct surface that names the edge-dump grain explicitly. With
// it every declared capability is NL/command/frame-reachable — the ceiling is
// genuinely empty, not a silenced gap. (The conformance test enforces both
// directions: an over-claimed tag would now fail, since tmct_calls IS reachable.)
export const NOT_NL_REACHABLE = Object.freeze({});

// ---- imperative intent FRAMES (Stage 2 — fills what the relational grammar and
// the command register both miss). regex -> { topic, arg | noArg }. `arg` names
// the parameter grain; the entity is pulled by extractEntity (or, for search, the
// residual query text). Ordered: first match wins. Every frame's topic is
// backward-chained to a capability just like an NL intent, so the frame table
// adds PHRASINGS, never a new routing path. ----
export const FRAMES = Object.freeze([
  { re: /\buntested\b|\bwithout\s+(?:a\s+)?tests?\b|\bhas\s+no\s+tests?\b|\bneeds?\s+(?:a\s+)?tests?\b/i, topic: "untested", noArg: true },
  { re: /\bblast\s*radius\b|\bimpacts?\b|\bimpacted\b|what\s+(?:a\s+)?change.*(?:reach|affect|touch)|what\s+(?:depends?\s+on|dependents?)\b/i, topic: "impact", arg: "module" },
  // tmct_calls (Stage 2 — the reachability win): the RAW call-edge dump, a grain
  // the relational "call" verb collides with (which routes callers/callees). This
  // frame does NOT use the bare verb — it keys on the EXPLICIT edge-dump nouns
  // ("call edges", "call graph", "outgoing calls of X") the relational grammar
  // never emits, so it opens a distinct surface without touching callers/callees.
  // FIRST so its explicit phrasing wins before the callees/callers verb frames.
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
 *  add-effect ACHIEVES it. Pure over the registry; returns the capability or null.
 *  This is the whole selection primitive — a capability is chosen ONLY because its
 *  declared effect unifies with the request's epistemic goal, never by name. */
export function backwardChain(topic) {
  for (const cap of capabilities()) {
    if (effectsOf(cap.name).add.some((e) => e.topic === topic)) return cap;
  }
  return null;
}

// The stopword set for the imperative-frame entity extractor (Stage-2 slot
// filling). Deliberately generous: a wrong pick is caught by the resolveObject
// miss -> honest refuse, never emitted.
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
  // Stage-2 edge-dump + imperative-verb tokens (tmct_calls frame + explain/outgoing
  // phrasings): none names an entity, so keep them out of the slot-filler's pool.
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
    const cap = backwardChain(f.topic);
    if (!cap) continue;
    if (f.noArg) return { name: cap.name, noArg: true, topic: f.topic, source: "frame", why: [`imperative frame => goal (knows ${f.topic})`, `backward-chain => ${cap.name}`] };
    const term = f.arg === "query" ? searchQuery(request) : extractEntity(request);
    return { name: cap.name, arg: f.arg, term, topic: f.topic, source: "frame", why: [`imperative frame => goal (knows ${f.topic} ?${f.arg})`, `backward-chain => ${cap.name}`] };
  }
  return null;
}

/** The command register (server-http.mjs selectTool) filtered to the registry.
 *  Returns { name, input, source:"command", why } or null. selectTool binds the
 *  arg from the terse command; we re-clean a search query (its raw join keeps a
 *  stray "for"). Never reaches outside the declared set. */
export function commandCapability(request, declaredNames) {
  const sel = selectTool(request, new Set(declaredNames));
  if (!sel || !capabilityByName(sel.name)) return null;
  const input = { ...sel.input };
  if (sel.name === "tmct_search" && input.query != null) input.query = searchQuery(request) || String(input.query);
  return { name: sel.name, input, source: "command", why: [`command register: "${String(request).trim().split(/\s+/)[0]}" => ${sel.name}`] };
}

// ---- the full single-call resolver (async — binds + grounds) -----------------

/** Build the glass-box proof chain for a grounded single call: its preconditions
 *  (graphLoaded + resolves(param) with the BOUND value + any-present) then the
 *  epistemic add-effect. Dispatch has SUCCEEDED, so `resolves` steps are ok. */
export function proofFor(name, input) {
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

/** PLAN_BREADTH_FIRST_NLU.md §4 — breadth-first ambiguity, read-only capabilities
 *  ONLY (every registered capability is `readOnly:true` with an empty delete-list,
 *  so dispatching the SAME tool once per tied candidate carries no double-write
 *  risk). Runs the bound call for each candidate in `pool` (capped, matching the
 *  reason string's own display cap) and returns `[{candidate, result}, ...]`, or
 *  undefined when there is no dispatcher to run it with (`execute:false` or no
 *  `ctx.dispatch` — e.g. a structural-only / planning caller). Never throws: a
 *  per-candidate dispatch failure is just an honest miss for that one candidate. */
async function dispatchEachCandidate(pool, capName, arg, ctx, execute) {
  if (!execute || !ctx.dispatch) return undefined;
  const results = [];
  for (const c of pool) {
    const res = await ctx.dispatch(capName, { [arg]: c.label });
    results.push({ candidate: c.label, result: res });
  }
  return results;
}

/** Select a capability for a request and BIND its arguments — the full resolver.
 *  Order: command register -> NL parse -> imperative frame. On a bound selection
 *  it delegates entity binding to ctx.resolve (resolveObject) and, unless
 *  `execute:false`, grounds it via ctx.dispatch. Returns
 *    { selected:{name,input}, proof, why, resolved, observed? }  — a grounded call
 *    { selected:null, refused:true, reason, candidateResults? }  — an honest refusal
 *  An ambiguous-term refusal stays `refused:true` (never a guess at which
 *  candidate is "the" one) but, when a dispatcher is available, ADDITIONALLY
 *  carries `candidateResults`: the SAME capability dispatched once per tied
 *  candidate, so a machine caller gets both the honest "still ambiguous" signal
 *  and every candidate's real answer (PLAN_BREADTH_FIRST_NLU.md §4).
 *  NEVER emits an ungrounded / ambiguous / undeclared call. */
export async function resolveOne(request, declaredNames, ctx, { execute = true } = {}) {
  const declared = new Set(declaredNames);

  // 1. command register (exact) 2. NL parse 3. imperative frame. An NL-parse
  //    REFUSAL is NOT terminal: a shape with no relational operator ("what is the
  //    impact of X", "list what covers X") can still be an imperative FRAME hit,
  //    so we fall through and only surface the NL reason if the frame misses too.
  let pick = commandCapability(request, declared);
  let nlRefuse = null;
  let nlUndeclared = null;
  if (!pick) {
    const mapped = mapParse(parseQuery(request));
    if (mapped && !mapped.refuse) {
      // An NL parse that selects a DECLARED capability is the Stage-1 answer. One
      // that selects an OUT-OF-SET capability is NOT terminal (Stage-2 widening):
      // an imperative FRAME may still reach a DECLARED capability for the SAME
      // request (e.g. keyword-spot mis-routes "outgoing calls of X" toward an
      // out-of-set callers/callees, but the calls-frame reaches the declared
      // tmct_calls). Hold the out-of-set name and fall through; surface it only if
      // the frame misses too. This can only turn a refuse into a grounded DECLARED
      // call — the declared/hallucination gates below still apply, never a guess.
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

  // build the bound input. A command pick already carries a bound input; an NL /
  // frame pick carries a raw term that we BIND via resolveObject (the oracle).
  let input = pick.input ? { ...pick.input } : {};
  let resolved = null;
  if (!pick.input && !pick.noArg) {
    const term = String(pick.term || "").trim();
    if (!term) return REFUSE(`the ${pick.topic} intent named no entity to bind`);
    // DELEGATE binding to resolveObject — the resolves(param,as) precondition.
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
  // the same zero-hallucination gate the grader enforces — self-check before emit.
  const problems = hallucinationsIn(call, [...declared]);
  if (problems.length) return REFUSE(`bound call did not validate: ${problems.map((p) => p.reason).join(",")}`);

  // ground it: a ToolError (unresolvable entity) is an honest miss -> refuse.
  if (execute && ctx.dispatch) {
    const res = await ctx.dispatch(pick.name, input);
    if (!res.ok) return REFUSE(`unresolvable at dispatch: ${res.error}`);
    return { selected: call, proof: proofFor(pick.name, input), why, resolved: res.resolved ?? resolved, observed: String(res.text ?? "").slice(0, 240) };
  }
  return { selected: call, proof: proofFor(pick.name, input), why, resolved };
}

// ---- reachability (used by the bidirectional conformance test + docs) ---------

/** The epistemic topics some NL intent or imperative frame can reach. */
export function nlReachableTopics() {
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
