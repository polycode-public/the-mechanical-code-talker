// memory/inspect.mjs — seeing into the memory as TEXT: one renderer serves
// both the `/memory` chat command and the `tmct memory` CLI, terse or
// verbose. Pure renderers + one thin I/O wrapper (inspectMemory); an empty
// memory renders as the empty story, never an error.

import { loadMemory, UTTERANCE_CLASS, IN_REPLY_TO_PROP, readFactRows, findContradictions } from "./core.mjs";
import { loadBlockIndex } from "./blocks.mjs";
import { compareFactsByContent } from "../../domain/memory/fact-order.mjs";
import { buildTableauKb, findTableauViolations } from "../../domain/tableau.mjs";
import { elUnsatisfiableClasses } from "../../domain/el-classify.mjs";

// A store-wide audit checks every individual/class the store names, so its
// budgets stay well under /prove's own per-question defaults (tableau.mjs's
// DEFAULT_PROVE_STEPS etc.) — the cost here is per-subject, not per-turn.
const CONSISTENCY_TABLEAU_OPTS = { maxSteps: 200, maxBranches: 16, maxNodes: 32 };
const CONSISTENCY_EL_OPTS = { budget: 500, rounds: 16 };

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

/** Codepoint order, never localeCompare — this text is read on whatever machine
 *  holds the store, and two locales have to land on the same lines. */
const byCodepoint = (a, b) => {
  const ka = String(a ?? "");
  const kb = String(b ?? "");
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

/** Order two individuals by their own id, in codepoint order. Every id here is
 *  derived from content — a Fact hashes its triple, an Utterance reads
 *  `utt:<session>#<ts>#<role>`, a Source keys on its provenance tag — so this
 *  is a pure function of the stored set, and the utterance case still comes out
 *  in the order the conversation happened. Without it the class samples below
 *  span the payload in the order the individuals were written, which is arrival
 *  order: two peers holding one store would sample different rows. */
const byIndividualId = (a, b) => byCodepoint(a?.id, b?.id);
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
    for (const members of byClass.values()) members.sort(byIndividualId);
    const classes = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length || byCodepoint(a[0], b[0]));
    lines.push(`memory — ${individuals.length} individuals: ${classes.map(([c, of]) => `${of.length} ${c}`).join(", ")}.`);
    for (const [cls, of] of classes) {
      const k = sampleSize(of.length, { verbose });
      lines.push("", `${cls} — ${of.length} (showing ${k})`);
      for (const ind of balancedSample(of, k)) lines.push(`  ${truncate(ind.label, textCap)}`);
    }

    // ---- top facts by computed trust (source prior + corroboration + recency) ----
    const ranked = readFactRows(memory)
      .filter((r) => r.sourceIds.length || r.provenance)
      .sort((a, b) => b.trust - a.trust
        || b.sourceIds.length - a.sourceIds.length
        || compareFactsByContent(a, b));
    if (ranked.length) {
      lines.push("", "top facts by trust:");
      for (const r of ranked.slice(0, verbose ? 8 : 3)) {
        const n = r.sourceIds.length || (r.provenance ? r.provenance.split(" | ").filter(Boolean).length : 0);
        const label = `${r.subject} ${r.predicate} ${r.object}`;
        lines.push(`  ${truncate(label, textCap)} — trust ${r.trust.toFixed(2)}, ${n} source${n === 1 ? "" : "s"}: ${verbose ? r.provenance : truncate(r.provenance, 80)}`);
      }
    }

    // ---- assertion spread: how many sources vouch for the most-corroborated
    //      triple. A fact is stored one record per asserting source, so this is
    //      the number that says when a group is getting big enough to be worth
    //      compacting — reported so the moment is observable rather than
    //      guessed at. ----
    const widest = readFactRows(memory).reduce((a, b) => ((b.assertions?.length || 0) > (a?.assertions?.length || 0) ? b : a), null);
    const spread = widest?.assertions?.length || 0;
    if (spread > 1) {
      lines.push("", `assertions — widest fact carries ${spread} independent sources: ${truncate(`${widest.subject} ${widest.predicate} ${widest.object}`, textCap)}`);
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

    // ---- wider consistency findings: a DL tableau clash (a cardinality
    //      clash, E5's own flagship, or any other clash the ALC-through-
    //      SHOIQ tableau derives) and an EL-saturation-proved unsatisfiable
    //      class, surfaced BESIDE the contradictions above rather than
    //      folded into them — findConsistencyViolations only reads type,
    //      subclass and disjointness edges, so neither shape sits inside
    //      its own check. Both read-only; a budget-exhausted subject is
    //      simply absent rather than counted as a clean bill. ----
    const consistencyRows = readFactRows(memory);
    const consistencyKb = buildTableauKb(consistencyRows);
    const tableauFindings = findTableauViolations(consistencyKb, null, CONSISTENCY_TABLEAU_OPTS);
    const elFindings = elUnsatisfiableClasses(consistencyRows, CONSISTENCY_EL_OPTS);
    const consistencyById = new Map(consistencyRows.map((r) => [r.id, r]));
    const renderPremises = (ids) => (ids || [])
      .map((id) => consistencyById.get(id))
      .filter(Boolean)
      .map((r) => truncate(`${r.subject} ${r.predicate} ${r.object}`, textCap))
      .join("; ");
    if (tableauFindings.length || elFindings.unsatisfiable.length) {
      const total = tableauFindings.length + elFindings.unsatisfiable.length;
      lines.push("", `consistency findings (${total} — a DL/EL check beside the contradictions above):`);
      for (const f of tableauFindings.slice(0, verbose ? 8 : 3)) {
        lines.push(`  ${f.subject} is inconsistent: ${renderPremises(f.premises)}`);
      }
      for (const cls of elFindings.unsatisfiable.slice(0, verbose ? 8 : 3)) {
        lines.push(`  ${cls} can never have any members: ${renderPremises(elFindings.premisesOf(cls))}`);
      }
    }

    // ---- recent Q→A pairs (off the inReplyTo edges) ----
    const byId = new Map(individuals.map((i) => [i.id, i]));
    const replyGroup = (memory.objectProperties || []).find((g) => g?.prop === IN_REPLY_TO_PROP);
    const pairs = (replyGroup?.examples || [])
      .map((e) => ({ a: byId.get(e.subject), q: byId.get(e.object) }))
      .filter((p) => p.a && p.q && p.a.class === UTTERANCE_CLASS)
      .sort((x, y) => byCodepoint(attrOf(y.a, "ts"), attrOf(x.a, "ts")) || byIndividualId(x.a, y.a));
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
      .sort((a, b) => (b[1].rank ?? 0) - (a[1].rank ?? 0) || byCodepoint(a[0], b[0]))
      .slice(0, verbose ? 8 : 3);
    lines.push("", `blocks — ${entries.length} folded session block${entries.length === 1 ? "" : "s"}, ${tokens} indexed tokens.`);
    lines.push(`  top by rank: ${top.map(([id, b]) => `${String(id).slice(0, 8)} (${(b.rank ?? 0).toFixed(3)})`).join(", ")}`);
  } else {
    lines.push("", "blocks — none folded yet (a session folds when it ends).");
  }

  // ---- explore hooks: runnable example queries built from what's stored ----
  if (individuals.length) {
    const clean = (t) => typeof t === "string" && /^[a-z][a-z0-9]+(?: [a-z0-9]{2,}){0,2}$/.test(t) && t.length <= 22 && !/^\d+$/.test(t);
    const facts = readFactRows(memory);
    // Rank "what is a X" candidates by category size (how many facts point at them).
    const freq = new Map();
    for (const f of facts) if (clean(f.object)) freq.set(f.object, (freq.get(f.object) || 0) + 1);
    const terms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || byCodepoint(a[0], b[0]))
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
