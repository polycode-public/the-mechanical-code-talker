// agentbench/driver-stub.mjs — the TRIVIAL, PLUGGABLE "agent under test".
//
// The AGENTBENCH harness treats the agent as a seam:
//
//     driver(request, tools, ctx) => Promise<loopResult>
//        request : string          — the user's imperative
//        tools   : string[]        — the DECLARED toolset for this case
//        ctx     : { dispatch, capabilityByName, ... }  — see run.mjs
//        loopResult = { calls: [{name, input}], refused, terminated, proof, driver }
//
// This is a DELIBERATE STUB, not the router: it exists so the harness is
// runnable + testable TODAY, before Stage 1 (the resolver) and the HTTP shim
// exist. The coordinator swaps in the real resolver/planner/shim driver later
// behind this exact signature. Its results are the "STUB-DRIVER FLOOR", NEVER a
// router baseline — every row it produces is stamped driver:"stub-floor" so the
// real engine is not measured against a mislabeled anchor (coordinator note 2).
//
// What the stub does (only the OBVIOUS single-tool path, refuse otherwise):
//   1. map the request to ONE capability by a keyword heuristic;
//   2. if that capability is not in the declared `tools`, REFUSE (never reach
//      outside the declared set — so the stub structurally CANNOT hallucinate);
//   3. extract one entity argument and bind it to the capability's slot;
//   4. validate the bound call against the registry (the same zero-hallucination
//      gate the grader uses) — if not well-formed, REFUSE;
//   5. EXECUTE it via tmct's real dispatchTool: a ToolError (unresolvable entity)
//      is an honest miss → REFUSE; success → emit the call + a proof chain and
//      terminate. Refusing-when-unsure is the correct honest-miss behavior.

import { hallucinationsIn } from "./grade.mjs";
import { preconditionsOf, parametersOf, effectsOf, PRECOND } from "../src/domain/router/registry.mjs";

// The stub is the DEFAULT "agent under test" for the seam described above.

const STOPWORDS = new Set([
  "what", "whats", "which", "who", "whom", "does", "do", "did", "is", "are", "the", "a", "an",
  "of", "for", "to", "in", "on", "by", "me", "tell", "about", "show", "list", "give", "get",
  "call", "calls", "called", "caller", "callers", "callee", "callees", "test", "tests", "tested",
  "cover", "covers", "covering", "describe", "description", "define", "definition", "impact",
  "member", "members", "method", "methods", "attribute", "attributes", "subclass", "subclasses",
  "export", "exports", "history", "commit", "commits", "signature", "search", "find", "look",
  "module", "modules", "class", "classes", "function", "functions", "symbol", "symbols",
  "that", "this", "it", "and", "or", "untested", "any", "with", "no", "all", "reach", "reaches",
  "would", "change", "changes", "changed", "affect", "affects", "touch", "touches", "touched",
]);

// Ordered intent rules. First match wins; each names the capability + the arg
// slot to bind. `noArg` capabilities need no entity.
const INTENTS = [
  { re: /\buntested\b/i, tool: "tmct_untested", noArg: true },
  { re: /\bimpact\b|\bblast\s*radius\b|change.*(reach|affect)|what.*(depends?\s+on|dependents?)\b/i, tool: "tmct_impact", arg: "module" },
  { re: /\bcallees?\b|what\s+does\s+\S+\s+call\b|\bcalls?\s+what\b/i, tool: "tmct_callees", arg: "symbol" },
  { re: /\bcallers?\b|who\s+calls\b|what\s+calls\b|call(s|ing)?\s+(into\s+)?\S+\??$/i, tool: "tmct_callers", arg: "symbol" },
  { re: /\btests?\b.*\b(for|cover|covering|of)\b|which\s+tests?\b|covered\s+by\b|test\s+coverage\b/i, tool: "tmct_tests_for", arg: "symbol" },
  { re: /\bexports?\b/i, tool: "tmct_exports", arg: "module" },
  { re: /\bsubclasses?\b|children\s+of\b|extends?\b/i, tool: "tmct_subclasses", arg: "class" },
  { re: /\bmembers?\b|\bmethods?\s+of\b|\battributes?\s+of\b/i, tool: "tmct_members", arg: "class" },
  { re: /\bhistory\b|who\s+changed\b|commits?\s+(that\s+)?touch/i, tool: "tmct_history", arg: "symbol" },
  { re: /\bsignature\b/i, tool: "tmct_signature", arg: "symbol" },
  { re: /\bcochang|change[- ]coupl/i, tool: "tmct_cochanges", arg: "symbol" },
  { re: /\bsynonyms?\b|another\s+word\s+for\b|\brelated\s+(?:words?|concepts?|to)\b/i, tool: "tmct_related", arg: "term" },
  { re: /\bdescribe\b|what\s+is\b|tell\s+me\s+about\b|definition\s+of\b/i, tool: "tmct_describe", arg: "symbol" },
  { re: /\bsearch\b|\bfind\b|look\s+for\b/i, tool: "tmct_search", arg: "query" },
];

/** Pull one entity token from the request: prefer a path/dotted/CamelCase token,
 *  else the last non-stopword identifier. Returns "" if nothing plausible. */
function extractEntity(request) {
  const tokens = request.match(/[A-Za-z_][A-Za-z0-9_./-]*/g) || [];
  const candidates = tokens.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  // strong signals first: a path or dotted name, or a CamelCase identifier.
  const strong = candidates.filter((t) => /[./]/.test(t) || /^[A-Z][a-z]/.test(t) || /\.[a-z]+$/.test(t));
  const pool = strong.length ? strong : candidates;
  return pool.length ? pool[pool.length - 1] : "";
}

/** Build a proof chain from a capability's preconditions + effect, given that
 *  dispatch SUCCEEDED (so `resolves` steps are ok). This is the glass-box
 *  receipt the grader validates when a case sets expect.proof. */
function proofFor(tool, input) {
  const steps = [];
  for (const pre of preconditionsOf(tool)) {
    if (pre.pred === PRECOND.graphLoaded) steps.push({ step: "precondition", pred: pre.pred, ok: true });
    else if (pre.pred === PRECOND.resolves) steps.push({ step: "precondition", pred: pre.pred, param: pre.param, value: input[pre.param] ?? null, ok: true });
    else if (pre.pred === PRECOND.anyPresent) steps.push({ step: "precondition", pred: pre.pred, params: pre.params, ok: pre.params.some((k) => input[k]) });
    else steps.push({ step: "precondition", pred: pre.pred, ok: true }); // held: dispatch succeeded
  }
  for (const eff of effectsOf(tool).add) steps.push({ step: "effect", pred: eff.pred, topic: eff.topic, of: eff.of });
  return steps;
}

const refuse = (why) => ({ calls: [], refused: true, terminated: true, proof: [], driver: "stub-floor", why });

/** The stub driver. See file header for the seam contract. */
export async function stubDriver(request, tools, ctx) {
  const intent = INTENTS.find((i) => i.re.test(request));
  // no recognizable intent, or the intent's tool isn't in the declared set →
  // honest refusal (the stub never reaches outside `tools`).
  if (!intent || !tools.includes(intent.tool)) return refuse(intent ? `${intent.tool} not in declared toolset` : "no recognized intent");

  let input = {};
  if (!intent.noArg) {
    const argKey = intent.arg ?? parametersOf(intent.tool).find((p) => p.required)?.arg;
    const entity = intent.tool === "tmct_search"
      ? request.replace(/^\s*(search|find|look\s+for)\s+(for\s+)?/i, "").trim()
      : extractEntity(request);
    if (!entity) return refuse("could not extract an entity to bind");
    input = { [argKey]: entity };
  }

  const call = { name: intent.tool, input };
  // same gate the grader enforces — the stub self-checks before emitting.
  if (hallucinationsIn(call, tools).length) return refuse("bound call did not validate against the registry");

  // execute through the REAL dispatchTool: a ToolError = unresolvable entity =
  // honest miss → refuse (do NOT emit a call the graph can't ground).
  const res = await ctx.dispatch(intent.tool, input);
  if (!res.ok) return refuse(`unresolvable: ${res.error}`);

  return {
    calls: [call],
    refused: false,
    terminated: true,
    proof: proofFor(intent.tool, input),
    driver: "stub-floor",
    // the actual dispatch output, for transcript provenance (not graded).
    observed: String(res.text ?? "").slice(0, 240),
  };
}
