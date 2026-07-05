// memory/inspect.mjs — seeing into the memory as TEXT (ROADMAP Phase 4,
// "Memory inspection"). One renderer serves both surfaces — the `/memory` chat
// command and the `tmct memory` CLI — in a terse (default) and a verbose form:
//
//   - the memory graph grouped by OWL superclass (Fact / Utterance / Session,
//     plus any other class present), counts with BALANCED samples scaled
//     log-wise to class size (a 10,000-fact class shows ~8 exemplars, a
//     3-session class shows all 3);
//   - top facts ranked by PROVENANCE BREADTH (a fact the corpus AND the chat
//     both asserted outranks a single-writer fact), provenance verbatim;
//   - recent Q→A utterance pairs (read off the mgx:inReplyTo edges);
//   - the block-index summary (blocks, indexed tokens, top PageRank blocks).
//
// Pure renderers over loaded payloads + one thin I/O wrapper (inspectMemory).
// Everything degrades honestly: an empty memory renders as the empty story,
// never an error.

import { loadMemory, UTTERANCE_CLASS, IN_REPLY_TO_PROP, readFactRows, findContradictions } from "./core.mjs";
import { loadBlockIndex } from "./blocks.mjs";

/** Log-scaled sample count for a class of `n` individuals: 2·log10(n), floored
 *  at 3, never more than n (10,000 → 8; 500 → 5; 3 → 3; 1 → 1). Verbose doubles. */
export function sampleSize(n, { verbose = false } = {}) {
  const base = Math.max(3, Math.round(2 * Math.log10(Math.max(1, n))));
  return Math.min(n, verbose ? base * 2 : base);
}

/** Evenly-spaced (balanced) deterministic sample of k items — spans the class
 *  start to end rather than showing the first k. */
export function balancedSample(items, k) {
  const n = items.length;
  if (n <= k) return items.slice();
  if (k <= 1) return [items[0]];
  const out = [];
  for (let i = 0; i < k; i += 1) out.push(items[Math.round((i * (n - 1)) / (k - 1))]);
  return out;
}

const attrOf = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value || "";
const truncate = (s, cap) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
};

/** Render a loaded memory payload + block index into the inspection text.
 *  Pure. `verbose` widens every cap and stops truncating provenance/text. */
export function renderMemory({ memory, blocks }, { verbose = false } = {}) {
  const individuals = memory?.individuals || [];
  const lines = [];
  const textCap = verbose ? 400 : 100;

  if (!individuals.length) {
    lines.push("memory is empty — nothing remembered yet (facts, utterances and sessions land in .tmct/memory/ as you chat).");
  } else {
    // ---- classes: counts + balanced log-scaled samples ----
    const byClass = new Map();
    for (const ind of individuals) {
      const cls = ind?.class || "(unclassified)";
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(ind);
    }
    const classes = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length);
    lines.push(`memory — ${individuals.length} individuals: ${classes.map(([c, of]) => `${of.length} ${c}`).join(", ")}.`);
    for (const [cls, of] of classes) {
      const k = sampleSize(of.length, { verbose });
      lines.push("", `${cls} — ${of.length} (showing ${k})`);
      for (const ind of balancedSample(of, k)) lines.push(`  ${truncate(ind.label, textCap)}`);
    }

    // ---- top facts by COMPUTED TRUST (upgraded from raw provenance breadth) ----
    // Trust folds source-type prior + corroboration + recency, so a corroborated
    // operator-stated fact outranks a lone web scrape by construction; provenance
    // rides along (verbatim in verbose) for the audit trail.
    const ranked = readFactRows(memory)
      .filter((r) => r.sourceIds.length || r.provenance)
      .sort((a, b) => b.trust - a.trust
        || b.sourceIds.length - a.sourceIds.length
        || `${a.subject} ${a.predicate} ${a.object}`.localeCompare(`${b.subject} ${b.predicate} ${b.object}`));
    if (ranked.length) {
      lines.push("", "top facts by trust:");
      for (const r of ranked.slice(0, verbose ? 8 : 3)) {
        const n = r.sourceIds.length || (r.provenance ? r.provenance.split(" | ").filter(Boolean).length : 0);
        const label = `${r.subject} ${r.predicate} ${r.object}`;
        lines.push(`  ${truncate(label, textCap)} — trust ${r.trust.toFixed(2)}, ${n} source${n === 1 ? "" : "s"}: ${verbose ? r.provenance : truncate(r.provenance, 80)}`);
      }
    }

    // ---- contradictions: same (subject,predicate), differing object, both above
    //      the trust floor → surface BOTH with provenance, never silently pick ----
    const contradictions = findContradictions(memory);
    if (contradictions.length) {
      lines.push("", `contradictions (${contradictions.length} — both kept, never silently resolved):`);
      for (const group of contradictions.slice(0, verbose ? 8 : 3)) {
        lines.push(`  ${group[0].subject} ${group[0].predicate}?`);
        for (const r of group) {
          lines.push(`    ${truncate(r.object, textCap)} (trust ${r.trust.toFixed(2)}; ${verbose ? r.provenance : truncate(r.provenance, 60)})`);
        }
      }
    }

    // ---- recent Q→A pairs (off the inReplyTo edges) ----
    const byId = new Map(individuals.map((i) => [i.id, i]));
    const replyGroup = (memory.objectProperties || []).find((g) => g?.prop === IN_REPLY_TO_PROP);
    const pairs = (replyGroup?.examples || [])
      .map((e) => ({ a: byId.get(e.subject), q: byId.get(e.object) }))
      .filter((p) => p.a && p.q && p.a.class === UTTERANCE_CLASS)
      .sort((x, y) => attrOf(y.a, "ts").localeCompare(attrOf(x.a, "ts")));
    if (pairs.length) {
      lines.push("", `recent Q→A pairs (${pairs.length} recorded):`);
      for (const p of pairs.slice(0, verbose ? 8 : 3)) {
        lines.push(`  Q: ${truncate(attrOf(p.q, "text"), textCap)}`);
        lines.push(`  A: ${truncate(attrOf(p.a, "text"), textCap)}`);
      }
    }
  }

  // ---- block-index summary ----
  const entries = Object.entries(blocks?.blocks || {});
  if (entries.length) {
    const tokens = entries.reduce((n, [, b]) => n + (b.tokens?.length || 0), 0);
    const top = entries
      .slice()
      .sort((a, b) => (b[1].rank ?? 0) - (a[1].rank ?? 0) || a[0].localeCompare(b[0]))
      .slice(0, verbose ? 8 : 3);
    lines.push("", `blocks — ${entries.length} folded session block${entries.length === 1 ? "" : "s"}, ${tokens} indexed tokens.`);
    lines.push(`  top by rank: ${top.map(([id, b]) => `${String(id).slice(0, 8)} (${(b.rank ?? 0).toFixed(3)})`).join(", ")}`);
  } else {
    lines.push("", "blocks — none folded yet (a session folds when it ends).");
  }

  // ---- explore hooks: real, runnable example queries built from what's actually
  //      stored, so /memory is a springboard for drilling in, not just a dump ----
  if (individuals.length) {
    const clean = (t) => typeof t === "string" && /^[a-z][a-z0-9]+(?: [a-z0-9]{2,}){0,2}$/.test(t) && t.length <= 22 && !/^\d+$/.test(t);
    const facts = readFactRows(memory);
    // Rank candidate "what is a X" terms by CATEGORY SIZE (how many facts point at
    // them) so the hooks land on rich, recognisable categories (function, class, …),
    // not a lone ConceptNet oddity.
    const freq = new Map();
    for (const f of facts) if (clean(f.object)) freq.set(f.object, (freq.get(f.object) || 0) + 1);
    const terms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t)
      .slice(0, 3);
    const sample = facts.find((f) => clean(f.subject) && terms.includes(f.object));
    const ex = terms.map((t) => `  what is a ${t}`);
    if (sample) ex.push(`  is a ${sample.subject} a ${sample.object}`);
    if (terms[0]) ex.push(`  what did i tell you about ${terms[0]}`);
    if (ex.length) {
      lines.push("", "explore — ask any of these (real terms from the store above):");
      lines.push(...ex);
      lines.push("  /memory verbose — the full store   ·   /stats — the code-graph overview");
    }
  }

  return lines.join("\n");
}

/** Load + render a repo's memory (the one thin I/O wrapper both the `/memory`
 *  chat command and the `tmct memory` CLI call). Never throws on a missing
 *  store — that is the honest empty story. */
export async function inspectMemory(dir, { verbose = false } = {}) {
  const memory = await loadMemory(dir);
  const blocks = await loadBlockIndex(dir);
  return renderMemory({ memory, blocks }, { verbose });
}
