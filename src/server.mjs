// tmct tool layer — query-only tools over the deterministic typed code-graph
// artifact (<repo>/.tmct/graph.json). The graph source is a LOCAL file
// (src/source.mjs) and tmct_search is a LOCAL lexical lookup (no remote API,
// no LLM, no model calls anywhere). dispatchTool is the single internal switch
// the chat surface and the `cli <tool>` route call into.
//
// Tools (all query-only, bounded output): tmct_search, tmct_describe, tmct_snippet,
// tmct_impact, plus the §9 read-replacing tools tmct_members, tmct_subclasses,
// tmct_architecture, tmct_tests_for, tmct_untested, tmct_history, tmct_callers,
// tmct_callees. Each answers one question in ONE compact call so the caller need not
// Read/Grep. Errors reach the caller as clean tool errors — message only, never a stack.
//
// tmct_ask (hot tool): a mechanical, zero-model-call NL query over the graph —
// collapses the search+describe+traversal composition loop a caller would
// otherwise hand-compose into one deterministic round-trip. See ask.mjs.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ToolError } from "./config.mjs";
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

const SNIPPET_MAX_LINES = 200;

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
        symbol: { type: "string", description: "Module path (django/utils/text.py) or a sibling function/class name in it (lower)." },
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
        symbol: { type: "string", description: "function/class name (slugify, Truncator), Class.method, or fn:<path>#name." },
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

async function loadGraph(config, source) {
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

function resolveOrThrow(graph, symbol, what) {
  const { match, candidates } = resolveSymbol(graph, symbol);
  if (!match) {
    throw new ToolError(
      `no entity matching ${what} "${symbol}" in the code-map graph. ` +
        "Try a repo-relative path (e.g. django/utils/text.py), a basename, or tmct_search for a fuzzy lookup.",
    );
  }
  return { match, candidates };
}

/**
 * Build the tmct_context "edit bundle" for a symbol and return { text, tier, topup }.
 * Shared by the tmct_context tool AND the `cli digest` arm (cli.mjs), so both
 * benefit from the size-adaptive sizing for free. `trim:true` (B2) renders a SECONDARY,
 * signatures-only bundle (no bodies/tails) for related-but-not-primary digest modules.
 *
 * Section ORDER is cache-stable (B7): the content that is identical across runs (anchor /
 * registration / exemplar / siblings / __all__ / insertion region) comes FIRST; the more
 * variable, history-derived tails (covering tests, co-change) come LAST, so a stable prefix
 * maximises prompt-cache reuse.
 */
export async function buildContextBundle(args, { config, source = defaultSource, trim = false } = {}) {
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
  const { match } = resolveOrThrow(graph, symbol, "symbol");
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
  const repoRoot = dirname(dirname(config.graphFile));
  let lines = null;
  if (plan.moduleLabel) {
    try { lines = (await readFile(join(repoRoot, plan.moduleLabel), "utf8")).split("\n"); }
    catch { lines = null; }
  }
  const lineAt = (n) => (lines && lines[n - 1] != null ? lines[n - 1].trim() : "");
  const sliceBody = (start, end) => {
    const e = Math.min(lines.length, Math.min(end, start + SNIPPET_MAX_LINES - 1));
    return lines.slice(start - 1, e).map((l, i) => `${start + i}\t${l}`).join("\n");
  };
  const out = [
    `Edit context for ${plan.moduleLabel} [${tier}${trim ? " secondary" : ""}] — assembled from the typed graph + that file. ` +
      "You do NOT need to Read it; write the new code directly after reviewing this.",
  ];
  // ---- cache-stable prefix (B7): identical across runs ----
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
      const end = Math.min(cb.site.end, start + budget - 1);
      const fromThisFile = cb.site.path === plan.moduleLabel;
      const bodyLines = fromThisFile && lines
        ? lines
        : await readFile(join(repoRoot, cb.site.path), "utf8").then((t) => t.split("\n")).catch(() => null);
      if (!bodyLines) continue;
      const e = Math.min(bodyLines.length, end);
      out.push(`\n## inlined callee body (depth-1 in-repo call): ${cb.label} @ ${cb.site.path}:${start}-${cb.site.end}`);
      out.push(bodyLines.slice(start - 1, e).map((l, i) => `${start + i}\t${l}`).join("\n"));
      budget -= (e - start + 1);
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
  // ---- variable tail (B7): history-derived, kept LAST so the prefix stays cache-stable ----
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

export async function dispatchTool(name, args, { config, source = defaultSource } = {}) {
  if (name === "tmct_context") {
    return (await buildContextBundle(args, { config, source })).text;
  }
  if (name === "tmct_context_more") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, symbol, "symbol");
    return renderContextMore(contextPlan(graph, match));
  }
  if (name === "tmct_describe") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const graph = await loadGraph(config, source);
    const { match, candidates } = resolveOrThrow(graph, symbol, "symbol");
    return renderDescribe(graph, match, { candidates });
  }
  if (name === "tmct_snippet") {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const graph = await loadGraph(config, source);
    const { match, candidates } = resolveOrThrow(graph, symbol, "symbol");
    const site = siteOf(match);
    if (!site) {
      throw new ToolError(
        `"${match.label}" (${match.class || "Entity"}) has no source span in the graph — ` +
          "it is likely a module. Use tmct_describe for its contents, then tmct_snippet one of the functions/classes it defines.",
      );
    }
    // repo root = the dir containing .tmct/ (graphFile = <repo>/.tmct/graph.json)
    const repoRoot = dirname(dirname(config.graphFile));
    const abs = join(repoRoot, site.path);
    let text;
    try { text = await readFile(abs, "utf8"); }
    catch (e) { throw new ToolError(`could not read ${site.path} (${e?.code || e?.message || e})`); }
    const lines = text.split("\n");
    const start = Math.max(1, site.start);
    let end = Math.min(lines.length, site.end);
    let truncated = false;
    if (end - start + 1 > SNIPPET_MAX_LINES) { end = start + SNIPPET_MAX_LINES - 1; truncated = true; }
    const body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n");
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
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, symbol, "symbol");
    return renderSignature(graph, match);
  }
  if (name === "tmct_impact") {
    const module = String(args?.module || "").trim();
    if (!module) throw new ToolError("module is required");
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, module, "module");
    return renderImpact(graph, match);
  }
  if (name === "tmct_search") {
    const query = String(args?.query || "").trim();
    const kind = String(args?.kind || "").trim();
    if (!query && !kind) throw new ToolError("query is required");
    const graph = await loadGraph(config, source);
    return renderSearch(graph, query, {
      kind,
      decorator: String(args?.decorator || "").trim(),
      name: String(args?.name || "").trim(),
    });
  }
  if (name === "tmct_members") {
    const symbol = String(args?.class || "").trim();
    if (!symbol) throw new ToolError("class is required");
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, symbol, "class");
    return renderMembers(graph, match);
  }
  if (name === "tmct_subclasses") {
    const symbol = String(args?.class || "").trim();
    if (!symbol) throw new ToolError("class is required");
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, symbol, "class");
    return renderSubclasses(graph, match);
  }
  if (name === "tmct_architecture") {
    const graph = await loadGraph(config, source);
    return renderArchitecture(graph, { pkg: String(args?.package || "").trim() });
  }
  if (name === "tmct_exports") {
    const module = String(args?.module || "").trim();
    if (!module) throw new ToolError("module is required");
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, module, "module");
    return renderExports(graph, match);
  }
  if (name === "tmct_untested") {
    const graph = await loadGraph(config, source);
    return renderUntested(graph);
  }
  if (name === "tmct_ask") {
    const query = String(args?.query || "").trim();
    if (!query) throw new ToolError("query is required");
    const graph = await loadGraph(config, source);
    const { content, tmct_ask } = ask(graph, query);
    // Every dispatchTool caller (the chat surface, the CLI fallback) expects a plain string —
    // append the structured envelope as a delimited, machine-parseable block rather than
    // changing that shared contract for one tool. PLAN_MECHANICAL_CHAT.md §6.2.
    return `${content}\n\n---tmct_ask---\n${JSON.stringify(tmct_ask, null, 2)}`;
  }
  if (
    name === "tmct_tests_for" || name === "tmct_history" || name === "tmct_callers" ||
    name === "tmct_callees" || name === "tmct_cochanges" || name === "tmct_calls" ||
    name === "tmct_file_history" || name === "tmct_method_history" || name === "tmct_class_history"
  ) {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const graph = await loadGraph(config, source);
    const { match } = resolveOrThrow(graph, symbol, "symbol");
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

