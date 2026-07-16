// tmct_context — the sized "edit bundle" for one symbol: exemplar source, sibling
// signatures, the registration anchor and the insertion region, in one call.

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ToolError } from "../../adapters/config.mjs";
import { sliceSpan, readSpanSafe } from "../../adapters/source-slice.mjs";
import * as defaultSource from "../../adapters/source.mjs";
import { contextPlan, sizeBundle, bundleMask, trimBundleMask } from "../../domain/codegraph.mjs";
import { ask } from "../../domain/ask.mjs";
import { createGraphService } from "../../adapters/providers/graph-service.mjs";
import { loadGraph } from "../graph-load.mjs";
import { resolveOrThrow, SNIPPET_MAX_LINES } from "./kit.mjs";

/**
 * Build the tmct_context "edit bundle" for a symbol and return { text, tier, topup }.
 * Shared by the tmct_context tool AND the `cli digest` arm (bin/tmct.mjs). `trim:true` renders
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
  // before createGraphService so the RI service can be constructed source-capable: this
  // module still does its OWN safe reads below (readSpanSafe/sliceSpan) rather than
  // delegating to svc.context(). Passing sourceAccess through anyway keeps
  // svc.snippet()/svc.context() usable by any future/external caller of this same service
  // object without a second, divergent construction path. `tel` (optional) is an
  // already-constructed telemetry sink threaded down from the caller (e.g. chat.mjs's
  // session-level createTelemetry) — never minted here, so a caller that never passes one
  // costs nothing extra (createGraphService's own wrapping loop no-ops on tel:null).
  const repoRoot = dirname(dirname(config.graphFile));
  const svc = createGraphService(graph, { sourceAccess: true, repoRoot, readFile, tel, ask });
  const { match } = resolveOrThrow(svc, symbol, "symbol");
  const plan = contextPlan(graph, match);
  // Pick the section mask by depth — min forces TINY, full/max forces everything, auto runs
  // the size classifier (lean TINY default + one-tier top-up when the edit needs it).
  let tier;
  let mask;
  let topup = false;
  if (min || depth === "min") { tier = "TINY"; mask = bundleMask("TINY"); }
  else if (max || depth === "full") { tier = "FULL"; mask = bundleMask("FULL"); topup = true; }
  else ({ tier, mask, topup } = sizeBundle(plan, graph, { untuned }));
  if (trim && !max) mask = trimBundleMask(mask);
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
  // The contiguous insertion region is part of the STABLE prefix — always present (even at
  // TINY) so the agent never needs to Read the file to place the edit.
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

export async function tmct_context(args, { config, source, tel }) {
  return (await buildContextBundle(args, { config, source, tel })).text;
}

// buildContextBundle validates `symbol` before it loads anything and then loads the graph
// itself, so dispatch hands this handler the raw config and skips its own load rather than
// loading the graph twice.
tmct_context.ownsGraphLoad = true;
