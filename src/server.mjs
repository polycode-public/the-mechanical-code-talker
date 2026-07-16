// tmct tool layer — query-only tools over the deterministic typed code-graph
// artifact (<repo>/.tmct/graph.json). The graph source is a LOCAL file
// (src/source.mjs) and tmct_search is a LOCAL lexical lookup (no remote API,
// no LLM, no model calls anywhere). dispatchTool is the single internal switch
// the chat surface and the `cli <tool>` route call into.
//
// Tools (all query-only, bounded output): tmct_search, tmct_describe, tmct_snippet,
// tmct_impact, plus the read-replacing tools tmct_members, tmct_subclasses,
// tmct_architecture, tmct_tests_for, tmct_untested, tmct_history, tmct_callers,
// tmct_callees. Each answers one question in ONE compact call so the caller need not
// Read/Grep. Errors reach the caller as clean tool errors — message only, never a stack.
//
// tmct_ask (hot tool): a mechanical, zero-model-call NL query over the graph —
// collapses the search+describe+traversal composition loop a caller would
// otherwise hand-compose into one deterministic round-trip. See ask.mjs.

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ToolError } from "./config.mjs";
import { sliceSpan, readSpanSafe } from "./source-slice.mjs";
import * as defaultSource from "./source.mjs";
import {
  parseEntities,
  resolveSymbol,
  renderDescribe,
  renderImpact,
  renderSearch,
  siteOf,
  renderMembers,
  renderSubclasses,
  renderArchitecture,
  renderTestsFor,
  renderUntested,
  renderHistory,
  renderCallers,
  renderCallees,
  renderCochanges,
  renderExports,
  renderSignature,
  contextPlan,
  sizeBundle,
  bundleMask,
  trimBundleMask,
  renderContextMore,
  renderCalls,
  callHint,
  renderFileHistory,
  renderMethodHistory,
  renderClassHistory,
} from "./codegraph.mjs";
import { ask } from "./ask.mjs";
import { createGraphService } from "./providers/graph-service.mjs";
// Read-only consumers of the conversational-memory graph (corpus facts, separate from
// the code-map graph.json). Used by the fall-through bridge below: when the code-map
// resolves nothing for a concept query, answer from the reified isa-family facts instead.
import { loadMemory, readFactRows, normFactTerm } from "./memory/core.mjs";
import { setDefaultNlpAdapter } from "./interpret/nlp-registry.mjs";
import { nlpAdapter } from "./ask-nlp.mjs";

// Composition: the tool layer supplies the domain parser's default lemma/POS
// adapter, so dispatchTool-only consumers get the same NL tier chat wires.
setDefaultNlpAdapter(nlpAdapter);

const SNIPPET_MAX_LINES = 200;

// The reified isa-family predicates a memory Fact carries ("<subject> rdfs:subClassOf
// <object>" / "rdf:type"): subject IS-A object. Subclasses of X = facts whose OBJECT is X;
// superclasses of X = facts whose SUBJECT is X. (Matches chat.mjs's ISA_PREDICATES.)
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);
const MEMORY_LIST_CAP = 40;

/** Load the conversational-memory Facts as trust-bearing rows, failure-tolerant (no memory
 *  store / unreadable → [], so the tool still returns its honest code-map miss). repoRoot is
 *  the dir that CONTAINS .tmct/ (graphFile = <repo>/.tmct/graph.json), which is exactly the
 *  `dir` loadMemory joins MEMORY_GRAPH_REL onto. */
async function memoryFactRows(config) {
  try {
    return readFactRows(await loadMemory(dirname(dirname(config.graphFile))));
  } catch {
    return [];
  }
}

/** A short provenance receipt for a set of memory rows — distinct source strings, capped. */
function memoryProvenance(rows) {
  const provs = [...new Set(rows.map((r) => r.provenance).filter(Boolean))];
  if (!provs.length) return "provenance: memory/corpus facts";
  const shown = provs.slice(0, 2).join("; ");
  return `provenance: ${shown}${provs.length > 2 ? `, +${provs.length - 2} more source(s)` : ""}`;
}

/** FALL-THROUGH: subclasses of a concept from the reified isa-family facts (subjects of
 *  "<subj> subClassOf <term>"). Null when the term names no such facts (so the caller can
 *  keep the honest code-map miss). Provenance is always cited. */
function renderMemorySubclasses(rows, term) {
  const t = normFactTerm(term);
  const hits = rows.filter((r) => ISA_PREDICATES.has(r.predicate) && r.object === t);
  if (!hits.length) return null;
  const labels = [...new Set(hits.map((r) => r.subject))].sort();
  const shown = labels.slice(0, MEMORY_LIST_CAP);
  const tail = labels.length > MEMORY_LIST_CAP ? `\n  …+${labels.length - MEMORY_LIST_CAP} more` : "";
  return `"${term}" is not a code-map entity — answering from memory/corpus facts. ` +
    `${labels.length} known subclass(es):\n  ${shown.join("\n  ")}${tail}\n(${memoryProvenance(hits)})`;
}

/** FALL-THROUGH: a concept's DEFINITION from the isa-family facts — its superclasses ("is
 *  a …") plus a count/sample of its known subclasses. Null when the term names no facts. */
function renderMemoryDefinition(rows, term) {
  const t = normFactTerm(term);
  const isa = rows.filter((r) => ISA_PREDICATES.has(r.predicate) && (r.subject === t || r.object === t));
  if (!isa.length) return null;
  const supers = [...new Set(isa.filter((r) => r.subject === t).map((r) => r.object))];
  const subs = [...new Set(isa.filter((r) => r.object === t).map((r) => r.subject))].sort();
  const lines = [`"${term}" is not a code-map entity — answering from memory/corpus facts.`];
  if (supers.length) lines.push(`is a: ${supers.slice(0, MEMORY_LIST_CAP).join(", ")}`);
  if (subs.length) {
    const tail = subs.length > MEMORY_LIST_CAP ? `, +${subs.length - MEMORY_LIST_CAP} more` : "";
    lines.push(`known subclasses (${subs.length}): ${subs.slice(0, MEMORY_LIST_CAP).join(", ")}${tail}`);
  }
  lines.push(`(${memoryProvenance(isa)})`);
  return lines.join("\n");
}

// Tiered tool surface: the hot tools carry full descriptions/schemas in this
// catalog; every COLD tool (describe/members/impact/history/…) is still served
// by dispatchTool below and is reachable via the CLI `cli <tool>` route +
// the generated <repo>/.tmct/TOOLS.md catalog (renderToolsCatalog).
export const TOOLS = [
  {
    name: "tmct_context",
    // Lean resident schema (re-billed every turn): the minimum that still steers the agent to
    // ONE call → write, not Read.
    description:
      "START HERE to add/modify code: ONE call returns a sized edit bundle (exemplar source, sibling signatures, registration, insertion region) — then write directly, don't Read.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "Module path (e.g. path/to/module) or a sibling function/class name defined in it." },
        depth: { type: "string", enum: ["min", "auto", "full"], default: "auto", description: "auto (sized to the task) | min (leanest) | full (every section)." },
      },
    },
  },
  {
    name: "tmct_snippet",
    description: "EXACT source of one function/class/Class.method by name (its line span only) + a one-line in-repo call hint. Prefer over Read for a single symbol.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "function/class name, Class.method, or fn:<path>#name." },
      },
    },
  },
  {
    name: "tmct_ask",
    description:
      "Ask a structural question in plain English: \"which functions call X\", \"what uses X\", \"where is X defined\", \"when did X change\". One call, no model. A clean miss beats a guess.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "A free-text question, e.g. \"which functions explicitly couple to logging\"." },
      },
    },
  },
];

// Exported so chat.mjs's compare lane can load the SAME graph dispatchTool's
// own tools load — no new loading path, just direct reuse of the existing
// config -> source.fetchEntities -> parseEntities chain, for the case where
// runAsk's own `graph` param is null (the common case; it's only preloaded
// when a caller already has one in hand — see runAsk's own `if (graph && ...)`
// / dispatchTool("tmct_ask", …) split just above).
export async function loadGraph(config, source) {
  const payload = await source.fetchEntities(config);
  const graph = parseEntities(payload);
  if (!graph.individuals.length) {
    // Honest miss, never a stack: a fresh repo simply has no graph yet (the chat
    // session itself creates one as the conversation folds in).
    throw new ToolError(
      `the graph at ${config.graphFile} is empty — no entities to answer from yet ` +
        "(this repo starts with no graph; the chat session folds the conversation into one).",
    );
  }
  return graph;
}

// A clean miss on the interface becomes the instructive ToolError the CLI/chat expect —
// message-only, never a stack, no fabricated entity names.
function resolveOrThrow(svc, symbol, what) {
  const { match, candidates } = resolveSymbol(svc.graph, symbol);
  if (!match) {
    throw new ToolError(
      `no entity matching ${what} "${symbol}" in the code-map graph. ` +
        "Try a repo-relative path (e.g. path/to/module), a basename, or tmct_search for a fuzzy lookup.",
    );
  }
  return { match, candidates };
}

/**
 * Build the tmct_context "edit bundle" for a symbol and return { text, tier, topup }.
 * Shared by the tmct_context tool AND the `cli digest` arm (cli.mjs). `trim:true` renders
 * a SECONDARY, signatures-only bundle (no bodies/tails) for related-but-not-primary
 * digest modules.
 *
 * Section order is cache-stable: content identical across runs (anchor/registration/
 * exemplar/siblings/__all__/insertion region) comes first; more variable, history-derived
 * tails (covering tests, co-change) come last, so a stable prefix maximises prompt-cache
 * reuse.
 */
export async function buildContextBundle(args, { config, source = defaultSource, trim = false, tel = null } = {}) {
  const symbol = String(args?.symbol || "").trim();
  if (!symbol) throw new ToolError("symbol is required");
  const depth = String(args?.depth || "auto").trim().toLowerCase();
  // Tuning-flag contract: `min` forces the LEANEST bundle (TINY mask, no top-up) regardless of
  // exemplar length; `untuned` reproduces the earlier escalation (tuning #1 bypassed). Neither
  // → the tuned default (sizeBundle's anchor-gated escalation).
  const min = Boolean(args?.min);
  const untuned = Boolean(args?.untuned);
  // `max` forces the injection CEILING — FULL tier (every section + inlined depth-1 callee
  // bodies) with top-up, and it OVERRIDES trim so even secondary modules get the full bundle. Used
  // by the tmct-max arm to test whether more injection re-bloats.
  const max = Boolean(args?.max);
  const graph = await loadGraph(config, source);
  // repo root = the dir containing .tmct/ (graphFile = <repo>/.tmct/graph.json) — computed
  // before createGraphService so the RI service can be constructed source-capable (2e): this
  // module still does its OWN safe reads below (readSpanSafe/sliceSpan, Item 1) rather than
  // delegating to svc.context() — see the module docblock's note on why. Passing sourceAccess
  // through anyway keeps svc.snippet()/svc.context() usable by any future/external caller of
  // this same service object without a second, divergent construction path. `tel` (optional,
  // Item 3.3) is an already-constructed telemetry sink threaded down from the caller (e.g.
  // chat.mjs's session-level createTelemetry) — never minted here, so a caller that never
  // passes one costs nothing extra (createGraphService's own wrapping loop no-ops on tel:null).
  const repoRoot = dirname(dirname(config.graphFile));
  const svc = createGraphService(graph, { sourceAccess: true, repoRoot, readFile, tel, ask });
  const { match } = resolveOrThrow(svc, symbol, "symbol");
  const plan = contextPlan(graph, match);
  // #6/B1/B6: pick the section mask by depth — min forces TINY, full/max forces everything, auto
  // runs the size classifier (lean TINY default + one-tier top-up when the edit needs it).
  let tier;
  let mask;
  let topup = false;
  if (min || depth === "min") { tier = "TINY"; mask = bundleMask("TINY"); }
  else if (max || depth === "full") { tier = "FULL"; mask = bundleMask("FULL"); topup = true; }
  else ({ tier, mask, topup } = sizeBundle(plan, graph, { untuned }));
  if (trim && !max) mask = trimBundleMask(mask); // B2: secondary digest module → signatures + region only (max keeps the full bundle)
  let lines = null;
  if (plan.moduleLabel) {
    try { ({ lines } = await readSpanSafe({ readFile, repoRoot, path: plan.moduleLabel })); }
    catch { lines = null; }
  }
  const lineAt = (n) => (lines && lines[n - 1] != null ? lines[n - 1].trim() : "");
  const sliceBody = (start, end) => sliceSpan(lines, start, end, SNIPPET_MAX_LINES).text;
  const out = [
    `Edit context for ${plan.moduleLabel} [${tier}${trim ? " secondary" : ""}] — assembled from the typed graph + that file. ` +
      "You do NOT need to Read it; write the new code directly after reviewing this.",
  ];
  // ---- cache-stable prefix: identical across runs ----
  if (mask.anchor && plan.anchor?.site && lines) {
    const { start, end } = plan.anchor.site;
    out.push(`\n## anchor: ${plan.anchor.label} (${plan.anchor.class}) @ ${plan.moduleLabel}:${start}-${end}`);
    out.push(sliceBody(start, end));
    if (plan.callHint) out.push(plan.callHint);
  }
  if (mask.registration && plan.globals.length) {
    out.push(`\n## registration / module globals (replicate this pattern):`);
    for (const g of plan.globals) out.push(`  ${g.label} = ${g.value}${g.site ? `  [:${g.site.start}]` : ""}`);
  }
  if (mask.exemplar && plan.exemplar?.site && lines) {
    const { start, end } = plan.exemplar.site;
    const dec = plan.exemplar.decorators ? ` @${plan.exemplar.decorators}` : "";
    out.push(`\n## closest example (full body) — copy this style: ${plan.exemplar.label} (${plan.exemplar.class})${dec} @ ${plan.moduleLabel}:${start}-${end}`);
    out.push(sliceBody(start, end));
    if (plan.callHint) out.push(plan.callHint);
  }
  if (mask.inlinedCallees && plan.calleeBodies.length && lines) {
    let budget = 120; // INLINE_CALLEE_LOC
    for (const cb of plan.calleeBodies) {
      if (budget <= 0) break;
      const start = cb.site.start;
      const fromThisFile = cb.site.path === plan.moduleLabel;
      const bodyLines = fromThisFile && lines
        ? lines
        : await readSpanSafe({ readFile, repoRoot, path: cb.site.path }).then((r) => r.lines).catch(() => null);
      if (!bodyLines) continue;
      const sliced = sliceSpan(bodyLines, start, cb.site.end, budget);
      out.push(`\n## inlined callee body (depth-1 in-repo call): ${cb.label} @ ${cb.site.path}:${start}-${cb.site.end}`);
      out.push(sliced.text);
      budget -= (sliced.end - start + 1);
    }
  }
  if (mask.classMembers && plan.classMembers && plan.classMembers.members.length) {
    out.push(`\n## members of ${plan.classMembers.className} (the edit likely lives INSIDE this class — copy a member's shape, do not read the class body):`);
    for (const m of plan.classMembers.members) {
      const short = String(m.label).split(".").pop();
      const sig = m.params != null && m.params !== "" ? `(${m.params})${m.returns ? ` -> ${m.returns}` : ""}` : "";
      const dec = m.decorators ? `@${m.decorators} ` : "";
      const r = m.raises ? `  raises=${m.raises}` : "";
      out.push(`  ${m.class} ${short}${m.site ? ` :${m.site.start}` : ""}  ${dec}${short}${sig}${r}`);
    }
  }
  if (mask.siblings && plan.siblings.length) {
    out.push(`\n## sibling symbols to copy the style of (most relevant first; ${plan.siblings.length} total):`);
    for (const s of plan.siblings.slice(0, plan.siblingCap)) {
      const sig = s.site ? lineAt(s.site.start) : "";
      const dec = s.decorators ? `@${s.decorators} ` : "";
      const r = s.raises ? `  raises=${s.raises}` : "";
      out.push(`  ${s.class} ${s.label}${s.site ? ` :${s.site.start}` : ""}  ${dec}${sig}${r}`);
    }
    if (plan.siblings.length > plan.siblingCap) {
      out.push(`  …+${plan.siblings.length - plan.siblingCap} more (use tmct_search kind=function or tmct_snippet <name> for any of them)`);
    }
  }
  if (mask.allExports && plan.allExports) {
    out.push(`\n## module __all__ — this module curates its public API; ADD your new public symbol to this list so it is importable:\n  ${plan.allExports}`);
  }
  if (mask.reexports && plan.exports && plan.exports.length) out.push(`\n## re-exported symbols (resolved __all__ → defining module): ${plan.exports.join(", ")}`);
  // #2 + B4: the contiguous insertion region is part of the STABLE prefix — always present
  // (even at TINY) so the agent never needs to Read the file to place the edit.
  if (mask.insertionRegion && plan.insertionRegion && lines) {
    const start = plan.insertionRegion.start;
    const end = Math.min(lines.length, start + 40 - 1); // INSERTION_REGION_CAP
    out.push(`\n## insertion region (write your new sibling here) — ${plan.moduleLabel}:${start}-${end}`);
    out.push(lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n"));
  } else if (plan.insertion) {
    out.push(`\n## insert the new sibling after line ~${plan.insertion} (end of the last top-level definition).`);
  }
  // ---- variable tail: history-derived, kept LAST so the prefix stays cache-stable ----
  if (mask.tests && plan.tests.length) out.push(`\n## covering tests: ${plan.tests.join(", ")}`);
  if (mask.cochange && plan.cochange && plan.cochange.length) {
    out.push(`\n## usually changed together (consider editing these too): ${plan.cochange.map((c) => `${c.label} (×${c.weight})`).join(", ")}`);
  }
  out.push(`\nYou now have the snippet, the sibling style, the registration anchor and the tests. ` +
    `Write the new code with Edit/Write — do NOT Read ${plan.moduleLabel}.`);
  if (tier !== "FULL") {
    out.push(`(bundle tier ${tier}; for any omitted sections run tmct_context_more {"symbol":"${symbol}"}, or tmct_context with depth="full".)`);
  }
  return { text: out.join("\n"), tier, topup };
}

// The full set of tool names dispatchTool serves (hot catalog + cold tools). Used
// to reject an unknown tool before any graph load.
const DISPATCH_TOOLS = new Set([
  "tmct_context", "tmct_context_more", "tmct_describe", "tmct_snippet", "tmct_signature",
  "tmct_impact", "tmct_search", "tmct_members", "tmct_subclasses", "tmct_architecture",
  "tmct_exports", "tmct_untested", "tmct_ask", "tmct_tests_for", "tmct_history",
  "tmct_callers", "tmct_callees", "tmct_cochanges", "tmct_calls",
  "tmct_file_history", "tmct_method_history", "tmct_class_history",
]);

export async function dispatchTool(name, args, { config, source = defaultSource, tel = null } = {}) {
  // tmct_context builds (and loads) its own edit bundle — return early so we don't
  // double-load the graph for it.
  if (name === "tmct_context") {
    return (await buildContextBundle(args, { config, source, tel })).text;
  }
  // Reject an unknown tool BEFORE touching the graph — preserves the original
  // ordering (an unknown name never triggers a load).
  if (!DISPATCH_TOOLS.has(name)) throw new ToolError(`unknown tool: ${name}`);
  // Every other tool reads graph truth: load once and build the typed service
  // object (the Repository Interface). dispatchTool is the presentation adapter —
  // it delegates resolution + the miss/error contract to the service and formats
  // the result with tmct's own render* layer (which reads svc.graph). This is the
  // switch's operations extracted into a named, typed seam without changing bytes.
  const graph = await loadGraph(config, source);
  // repo root = the dir containing .tmct/ (graphFile = <repo>/.tmct/graph.json). Passed through
  // to createGraphService (2e) so svc.snippet()/svc.context() are usable directly; this
  // dispatcher still does its OWN safe read for tmct_snippet below (readSpanSafe/sliceSpan,
  // Item 1) rather than delegating, to keep its richer presentation (candidates, call hints,
  // truncation notices) — see the tmct_snippet branch below.
  const repoRoot = dirname(dirname(config.graphFile));
  const svc = createGraphService(graph, { sourceAccess: true, repoRoot, readFile, tel, ask });
  if (name === "tmct_context_more") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const { match } = resolveOrThrow(svc, symbol, "symbol");
    return renderContextMore(contextPlan(graph, match));
  }
  if (name === "tmct_describe") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const { match, candidates } = resolveSymbol(svc.graph, symbol);
    if (match) return renderDescribe(graph, match, { candidates }); // code-map wins when present
    const fb = renderMemoryDefinition(await memoryFactRows(config), symbol);
    if (fb) return fb;
    resolveOrThrow(svc, symbol, "symbol"); // no code-map + no memory fact → the honest miss
  }
  if (name === "tmct_snippet") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const { match, candidates } = resolveOrThrow(svc, symbol, "symbol");
    const site = siteOf(match);
    if (!site) {
      throw new ToolError(
        `"${match.label}" (${match.class || "Entity"}) has no source span in the graph — ` +
          "it is likely a module. Use tmct_describe for its contents, then tmct_snippet one of the functions/classes it defines.",
      );
    }
    let sliced;
    try {
      sliced = await readSpanSafe({
        readFile, repoRoot, path: site.path, start: site.start, end: site.end, maxLines: SNIPPET_MAX_LINES,
      });
    } catch (e) {
      if (e instanceof ToolError) throw e; // path-traversal guard: message already names the offending path
      throw new ToolError(`could not read ${site.path} (${e?.code || e?.message || e})`);
    }
    const { text: body, truncated } = sliced;
    const span = site.end > site.start ? `${site.start}-${site.end}` : `${site.start}`;
    const header = `${match.label} — ${match.class || "Entity"} @ ${site.path}:${span}`;
    const note = truncated ? `\n… (truncated to ${SNIPPET_MAX_LINES} lines; full span ${span})` : "";
    const cand = candidates.length ? `\n(other matches: ${candidates.map((c) => c.label).join(", ")})` : "";
    const hint = callHint(graph, match); // #4: one-line "calls in-repo: …" so the agent sees in-repo deps inline
    return `${header}\n${body}${note}${hint ? `\n${hint}` : ""}${cand}`;
  }
  if (name === "tmct_signature") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const { match } = resolveOrThrow(svc, symbol, "symbol");
    return renderSignature(graph, match);
  }
  if (name === "tmct_impact") {
    const module = String(args?.module || "").trim();
    if (!module) throw new ToolError("module is required");
    const { match } = resolveOrThrow(svc, module, "module");
    return renderImpact(graph, match);
  }
  if (name === "tmct_search") {
    const query = String(args?.query || "").trim();
    const kind = String(args?.kind || "").trim();
    if (!query && !kind) throw new ToolError("query is required");
    const out = renderSearch(graph, query, {
      kind,
      decorator: String(args?.decorator || "").trim(),
      name: String(args?.name || "").trim(),
    });
    // FALL-THROUGH: a code-map miss ("no module matches …") on a plain concept query still
    // answers from the memory/corpus isa-family facts when the concept is known there.
    if (!kind && /^no module matches/.test(out)) {
      const fb = renderMemoryDefinition(await memoryFactRows(config), query);
      if (fb) return fb;
    }
    return out;
  }
  if (name === "tmct_members") {
    const symbol = String(args?.class || "").trim();
    if (!symbol) throw new ToolError("class is required");
    const { match } = resolveSymbol(svc.graph, symbol);
    if (match) return renderMembers(graph, match); // code-map wins when present
    // a concept's "members" in the corpus sense are its subclasses (its instances).
    const fb = renderMemorySubclasses(await memoryFactRows(config), symbol);
    if (fb) return fb;
    resolveOrThrow(svc, symbol, "class"); // the honest miss
  }
  if (name === "tmct_subclasses") {
    const symbol = String(args?.class || "").trim();
    if (!symbol) throw new ToolError("class is required");
    const { match } = resolveSymbol(svc.graph, symbol);
    if (match) return renderSubclasses(graph, match); // code-map wins when present
    const fb = renderMemorySubclasses(await memoryFactRows(config), symbol);
    if (fb) return fb;
    resolveOrThrow(svc, symbol, "class"); // no code-map subclass + no memory fact → honest miss
  }
  if (name === "tmct_architecture") {
    return renderArchitecture(graph, { pkg: String(args?.package || "").trim() });
  }
  if (name === "tmct_exports") {
    const module = String(args?.module || "").trim();
    if (!module) throw new ToolError("module is required");
    const { match } = resolveOrThrow(svc, module, "module");
    return renderExports(graph, match);
  }
  if (name === "tmct_untested") {
    return renderUntested(graph);
  }
  if (name === "tmct_ask") {
    const query = String(args?.query || "").trim();
    if (!query) throw new ToolError("query is required");
    const { content, tmct_ask } = ask(graph, query);
    // Every dispatchTool caller (the chat surface, the CLI fallback) expects a plain string —
    // append the structured envelope as a delimited, machine-parseable block rather than
    // changing that shared contract for one tool.
    return `${content}\n\n---tmct_ask---\n${JSON.stringify(tmct_ask, null, 2)}`;
  }
  if (
    name === "tmct_tests_for" || name === "tmct_history" || name === "tmct_callers" ||
    name === "tmct_callees" || name === "tmct_cochanges" || name === "tmct_calls" ||
    name === "tmct_file_history" || name === "tmct_method_history" || name === "tmct_class_history"
  ) {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const { match } = resolveOrThrow(svc, symbol, "symbol");
    if (name === "tmct_tests_for") return renderTestsFor(graph, match);
    if (name === "tmct_history") return renderHistory(graph, match);
    if (name === "tmct_callers") return renderCallers(graph, match);
    if (name === "tmct_cochanges") return renderCochanges(graph, match);
    if (name === "tmct_calls") return renderCalls(graph, match);
    if (name === "tmct_file_history") return renderFileHistory(graph, match);
    if (name === "tmct_method_history") return renderMethodHistory(graph, match);
    if (name === "tmct_class_history") return renderClassHistory(graph, match);
    return renderCallees(graph, match);
  }
  throw new ToolError(`unknown tool: ${name}`);
}

