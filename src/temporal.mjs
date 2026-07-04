// temporal.mjs — the pure temporal-graph core shared by every Chronograph surface.
//
// A "temporal graph" is a typed code graph in which every node and edge carries a
// VALIDITY INTERVAL `[from, to]` in commit-ordinal space (0 = oldest commit on the
// branch, N-1 = newest = HEAD). Scrubbing is a filter, the two-cursor diff is set
// algebra over intervals, and per-commit narration is a deterministic rendering of
// the delta at one ordinal — no re-indexing, no model calls.
//
// CONTRACT: this module is runtime-safe and self-contained — no imports, no node
// APIs — because the browser-page generator (browser.mjs) inlines THIS FILE'S
// SOURCE (with `export ` stripped) into the generated HTML. The code the page runs
// is byte-for-byte the code `node --test` exercises; there is no second copy.
// chronograph/lib/temporal.mjs re-exports it for the legacy P0 consumers.

/**
 * Is an interval `[from, to]` alive at commit ordinal `idx`?
 * Inclusive on both ends: a node born at commit N is visible from N onward.
 * @param {[number, number]} interval
 * @param {number} idx
 * @returns {boolean}
 */
export function aliveAt(interval, idx) {
  if (!Array.isArray(interval) || interval.length < 2) return false;
  const [from, to] = interval;
  return idx >= from && idx <= to;
}

/**
 * Derive a NODE's validity interval from the commit ordinals that touched it.
 * A HEAD-only index cannot observe deletions, so `died` is the HEAD ordinal; a node
 * with no direct history falls back to `fallbackBorn` (e.g. its module's birth).
 * @param {number[]} touchOrdinals
 * @param {number} headIdx
 * @param {number} [fallbackBorn=0]
 * @returns {[number, number]}
 */
export function deriveNodeInterval(touchOrdinals, headIdx, fallbackBorn = 0) {
  const born = touchOrdinals && touchOrdinals.length
    ? Math.min(...touchOrdinals)
    : fallbackBorn;
  return [Math.max(0, born), headIdx];
}

/**
 * An edge cannot exist before both endpoints are born; like nodes it lives to HEAD.
 * @param {number} bornSrc
 * @param {number} bornDst
 * @param {number} headIdx
 * @returns {[number, number]}
 */
export function deriveEdgeInterval(bornSrc, bornDst, headIdx) {
  return [Math.max(bornSrc, bornDst), headIdx];
}

/**
 * Cumulative churn of a node up to (and including) commit `idx` — drives node size.
 * @param {number[]} touchOrdinals
 * @param {number} idx
 * @returns {number}
 */
export function churnUpTo(touchOrdinals, idx) {
  if (!touchOrdinals) return 0;
  let n = 0;
  for (const o of touchOrdinals) if (o <= idx) n += 1;
  return n;
}

/**
 * Filter a temporal graph to what is alive at `idx`, honouring enabled node types.
 * @param {{nodes: Array, edges: Array}} tg
 * @param {number} idx
 * @param {Set<string>} enabledTypes
 * @returns {{aliveNodeIds: Set<string>, aliveEdges: Array}}
 */
export function sliceAt(tg, idx, enabledTypes) {
  const aliveNodeIds = new Set();
  for (const n of tg.nodes) {
    if (enabledTypes && !enabledTypes.has(n.type)) continue;
    if (aliveAt([n.born, n.died], idx)) aliveNodeIds.add(n.id);
  }
  const aliveEdges = [];
  for (const e of tg.edges) {
    if (!aliveNodeIds.has(e.src) || !aliveNodeIds.has(e.dst)) continue;
    if (aliveAt(e.valid, idx)) aliveEdges.push(e);
  }
  return { aliveNodeIds, aliveEdges };
}

/**
 * Structural neighbours of a node, one direction, deduped and sorted (P3 keyboard
 * graph-nav — "jump along callsSymbol/callers/cochange edges", PLAN_CODE_BROWSER.md
 * §core-experience 7). `touchesSymbol` is history, not structure, so it is excluded
 * here exactly as `structuralDiff` excludes it.
 * @param {{edges: Array}} tg
 * @param {string} id
 * @param {'out'|'in'} dir
 * @returns {string[]} sorted neighbour ids
 */
export function neighborsOf(tg, id, dir) {
  const out = new Set();
  for (const e of tg.edges || []) {
    if (e.kind === "touchesSymbol") continue;
    if (dir === "out" && e.src === id && e.dst !== id) out.add(e.dst);
    else if (dir === "in" && e.dst === id && e.src !== id) out.add(e.src);
  }
  return [...out].sort();
}

/**
 * Two-cursor STRUCTURAL DIFF (P1). Cursors are normalized (lo = older, hi = newer);
 * the answer is what the range (lo, hi] did to the structure:
 *   added   — nodes alive at hi but not at lo (born inside the range)
 *   removed — nodes alive at lo but not at hi (observable only once historical
 *             deaths exist; empty under today's HEAD-only intervals, by design)
 *   changed — nodes alive at both ends that were touched inside the range
 *   wired   — non-history edges that became valid inside the range; `rewired` marks
 *             the subset joining two nodes that BOTH pre-existed the range
 *   unwired — edges alive at lo but not at hi (same observability caveat as removed)
 * All id lists are sorted so the diff is deterministic.
 * @param {{nodes: Array, edges: Array}} tg
 * @param {number} a
 * @param {number} b
 */
export function structuralDiff(tg, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const added = [];
  const removed = [];
  const changed = [];
  const bornBy = new Map();
  for (const n of tg.nodes) {
    bornBy.set(n.id, n.born);
    if (n.type === "Commit") continue;
    const atLo = aliveAt([n.born, n.died], lo);
    const atHi = aliveAt([n.born, n.died], hi);
    if (!atLo && atHi) added.push(n.id);
    else if (atLo && !atHi) removed.push(n.id);
    else if (atLo && atHi && (n.touches || []).some((o) => o > lo && o <= hi)) changed.push(n.id);
  }
  const wired = [];
  const unwired = [];
  for (const e of tg.edges) {
    if (e.kind === "touchesSymbol") continue;
    const atLo = aliveAt(e.valid, lo);
    const atHi = aliveAt(e.valid, hi);
    if (!atLo && atHi) {
      wired.push({
        src: e.src,
        dst: e.dst,
        kind: e.kind,
        rewired: (bornBy.get(e.src) ?? 0) <= lo && (bornBy.get(e.dst) ?? 0) <= lo,
      });
    } else if (atLo && !atHi) {
      unwired.push({ src: e.src, dst: e.dst, kind: e.kind });
    }
  }
  const byId = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const byEdge = (x, y) => byId(`${x.src}|${x.dst}|${x.kind}`, `${y.src}|${y.dst}|${y.kind}`);
  added.sort(byId);
  removed.sort(byId);
  changed.sort(byId);
  wired.sort(byEdge);
  unwired.sort(byEdge);
  return { lo, hi, added, removed, changed, wired, unwired };
}

/** Type order for narration grouping — architectural first, so the story reads
 *  "module → class → function", never alphabetically-random. */
const NARRATE_TYPE_ORDER = ["Module", "Class", "Function", "Method", "Attribute", "GlobalVariable"];

const labelOf = (tg, id) => {
  for (const n of tg.nodes) if (n.id === id) return n.label || id;
  return id;
};

/**
 * Deterministic PER-COMMIT NARRATION (P1): the story of one commit rendered from
 * the graph delta alone — no model call. Same input → same string, always.
 * @param {{nodes: Array, edges: Array, commits: Array}} tg
 * @param {number} idx
 * @returns {string}
 */
export function narrateCommit(tg, idx) {
  const c = (tg.commits || [])[idx];
  const head = c
    ? `${c.shortSha} · ${(c.date || "").slice(0, 10)} · ${c.author || "?"} — ${c.subject || ""}`.trim()
    : `commit #${idx}`;
  const d = structuralDiff(tg, Math.max(0, idx - 1), idx);
  // At ordinal 0 everything is "born"; call that out instead of narrating a big bang.
  if (idx === 0) {
    const n = tg.nodes.filter((x) => x.type !== "Commit" && x.born === 0).length;
    return `${head}\nfirst commit on the timeline — ${n} symbol(s) first seen here or earlier.`;
  }
  const lines = [];
  const byType = new Map();
  for (const id of d.added) {
    const node = tg.nodes.find((n) => n.id === id);
    if (!node) continue;
    if (!byType.has(node.type)) byType.set(node.type, []);
    byType.get(node.type).push(node.label || id);
  }
  for (const t of NARRATE_TYPE_ORDER) {
    const labels = byType.get(t);
    if (!labels) continue;
    labels.sort();
    const shown = labels.slice(0, 4).map((l) => `\`${l}\``).join(", ");
    lines.push(`added ${labels.length} ${t}${labels.length === 1 ? "" : "s"}: ${shown}${labels.length > 4 ? ` (+${labels.length - 4} more)` : ""}`);
  }
  const rewired = d.wired.filter((e) => e.rewired).slice(0, 4);
  if (rewired.length) {
    lines.push(`rewired: ${rewired.map((e) => `\`${labelOf(tg, e.src)}\` —${e.kind}→ \`${labelOf(tg, e.dst)}\``).join("; ")}${d.wired.filter((e) => e.rewired).length > 4 ? " …" : ""}`);
  }
  if (d.changed.length) {
    const shown = d.changed.slice(0, 5).map((id) => `\`${labelOf(tg, id)}\``).join(", ");
    lines.push(`touched ${d.changed.length} existing symbol(s): ${shown}${d.changed.length > 5 ? " …" : ""}`);
  }
  if (!lines.length) lines.push("no structural change observed at symbol level.");
  return [head, ...lines].join("\n");
}

/**
 * Deterministic RANGE narration for the two-cursor diff panel (P1).
 * @param {{nodes: Array, edges: Array, commits: Array}} tg
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
export function narrateRange(tg, a, b) {
  const d = structuralDiff(tg, a, b);
  const cLo = (tg.commits || [])[d.lo];
  const cHi = (tg.commits || [])[d.hi];
  const head = `${cLo ? cLo.shortSha : "#" + d.lo} → ${cHi ? cHi.shortSha : "#" + d.hi} (${d.hi - d.lo} commit${d.hi - d.lo === 1 ? "" : "s"})`;
  const lines = [];
  if (d.added.length) lines.push(`+${d.added.length} added: ${d.added.slice(0, 5).map((id) => `\`${labelOf(tg, id)}\``).join(", ")}${d.added.length > 5 ? " …" : ""}`);
  if (d.removed.length) lines.push(`−${d.removed.length} removed: ${d.removed.slice(0, 5).map((id) => `\`${labelOf(tg, id)}\``).join(", ")}${d.removed.length > 5 ? " …" : ""}`);
  if (d.changed.length) lines.push(`~${d.changed.length} changed: ${d.changed.slice(0, 5).map((id) => `\`${labelOf(tg, id)}\``).join(", ")}${d.changed.length > 5 ? " …" : ""}`);
  const rw = d.wired.filter((e) => e.rewired).length;
  if (d.wired.length) lines.push(`${d.wired.length} edge(s) appeared${rw ? ` (${rw} rewiring pre-existing symbols)` : ""}`);
  if (d.unwired.length) lines.push(`${d.unwired.length} edge(s) went away`);
  if (!lines.length) lines.push("no structural change between the cursors.");
  return [head, ...lines].join("\n");
}

/**
 * The `?q=` query engine — deterministic, whitespace-separated terms ANDed together.
 * GRAMMAR (P1 + P2; every term case-insensitive):
 *   type:<T>        node type equals T (Module|Class|Function|Method|Attribute|GlobalVariable|Commit)
 *   touched:<opN>   total churn vs N — `touched:>2`, `touched:>=5`, `touched:3` (cursor-free: total history)
 *   since:<c>       touched at-or-after commit <c> (sha prefix or ordinal); an unresolvable <c>
 *                   matches nothing — a stale link FAILS LOUD instead of silently widening
 *   cochange:<term> joined by a `cochange` edge to any node whose name/path/id contains <term>
 *   <word>          substring over label OR site path OR id
 * Empty/blank q → null (the default view); a q that matches nothing → an empty Set
 * (the page shows a "didn't match" note over the default view — never a blank screen).
 * @param {{nodes: Array, edges?: Array}} tg
 * @param {string} q
 * @returns {Set<string>|null}
 */
export function matchQuery(tg, q) {
  const terms = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const textHit = (n, t) => String(n.label || "").toLowerCase().includes(t)
    || String(n.site || "").toLowerCase().includes(t)
    || String(n.id).toLowerCase().includes(t);
  // cochange:<term> — precomputed per term: ids joined by a cochange edge to any text match
  const partnerCache = new Map();
  const cochangePartners = (t) => {
    if (partnerCache.has(t)) return partnerCache.get(t);
    const targets = new Set();
    for (const n of tg.nodes) if (textHit(n, t)) targets.add(n.id);
    const out = new Set();
    for (const e of tg.edges || []) {
      if (e.kind !== "cochange") continue;
      if (targets.has(e.src)) out.add(e.dst);
      if (targets.has(e.dst)) out.add(e.src);
    }
    partnerCache.set(t, out);
    return out;
  };
  const termHit = (n, t) => {
    if (t.startsWith("type:")) return String(n.type).toLowerCase() === t.slice(5);
    if (t.startsWith("touched:")) {
      const m = t.slice(8).match(/^(>=|>)?(\d+)$/);
      if (!m) return false;
      const c = (n.touches || []).length;
      const v = parseInt(m[2], 10);
      return m[1] === ">" ? c > v : m[1] === ">=" ? c >= v : c === v;
    }
    if (t.startsWith("since:")) {
      const at = resolveCursor(tg, t.slice(6));
      return at != null && (n.touches || []).some((o) => o >= at);
    }
    if (t.startsWith("cochange:")) {
      const key = t.slice(9);
      return key ? cochangePartners(key).has(n.id) : false;
    }
    return textHit(n, t);
  };
  const out = new Set();
  for (const n of tg.nodes) {
    if (terms.every((t) => termHit(n, t))) out.add(n.id);
  }
  return out;
}

// ---- P2: co-change gravity -------------------------------------------------------

/**
 * Shared touching commits of two nodes up to (and including) ordinal `idx` — the
 * time-aware weight of one co-change pairing. Scrubbing left of the first shared
 * commit reads 0; the weight only grows as the cursor advances, which is what makes
 * clusters "tighten" over time (PLAN_CODE_BROWSER §core-experience 4).
 * @param {number[]} touchesA
 * @param {number[]} touchesB
 * @param {number} idx
 * @returns {number}
 */
export function cochangeWeightAt(touchesA, touchesB, idx) {
  if (!touchesA || !touchesB || !touchesA.length || !touchesB.length) return 0;
  const b = new Set();
  for (const o of touchesB) if (o <= idx) b.add(o);
  let w = 0;
  for (const o of touchesA) if (o <= idx && b.has(o)) w += 1;
  return w;
}

/**
 * Gravity pairs at a cursor: every `cochange` edge whose endpoints share ≥1 touching
 * commit up to `idx`, weighted by cochangeWeightAt. The candidate set is the graph's
 * own cochange edges (not all O(n²) pairs), sorted for determinism. The viewer uses
 * the weights as layout springs; they are pure data here.
 * @param {{nodes: Array, edges: Array}} tg
 * @param {number} idx
 * @returns {Array<{src: string, dst: string, w: number}>}
 */
export function gravityAt(tg, idx) {
  const byId = new Map(tg.nodes.map((n) => [n.id, n]));
  const out = [];
  for (const e of tg.edges || []) {
    if (e.kind !== "cochange") continue;
    const a = byId.get(e.src);
    const b = byId.get(e.dst);
    if (!a || !b) continue;
    const w = cochangeWeightAt(a.touches, b.touches, idx);
    if (w > 0) out.push({ src: e.src, dst: e.dst, w });
  }
  out.sort((x, y) => {
    const kx = `${x.src}|${x.dst}`;
    const ky = `${y.src}|${y.dst}`;
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  return out;
}

// ---- P2: hotspot heat --------------------------------------------------------------

/**
 * Recency-weighted churn at a cursor: each touch at ordinal `o ≤ idx` contributes
 * `0.5^((idx − o) / halfLife)`. A node touched AT the cursor glows 1 per touch; the
 * contribution halves every `halfLife` commits, so hotspots migrate as the cursor
 * scrubs (PLAN_CODE_BROWSER §core-experience 5) instead of monotonically accreting.
 * @param {number[]} touchOrdinals
 * @param {number} idx
 * @param {number} [halfLife=8]
 * @returns {number}
 */
export function heatAt(touchOrdinals, idx, halfLife = 8) {
  if (!touchOrdinals || !touchOrdinals.length) return 0;
  let h = 0;
  for (const o of touchOrdinals) if (o <= idx) h += Math.pow(0.5, (idx - o) / halfLife);
  return h;
}

/**
 * Per-node heat normalized to [0,1] at a cursor (max-normalized over non-Commit
 * nodes; an untouched graph is all zeros). Normalizing PER CURSOR is deliberate:
 * heat encodes "hot relative to the rest of the codebase right now".
 * @param {{nodes: Array}} tg
 * @param {number} idx
 * @param {number} [halfLife=8]
 * @returns {Map<string, number>}
 */
export function heatScale(tg, idx, halfLife = 8) {
  const raw = new Map();
  let max = 0;
  for (const n of tg.nodes) {
    if (n.type === "Commit") continue;
    const h = heatAt(n.touches, idx, halfLife);
    raw.set(n.id, h);
    if (h > max) max = h;
  }
  if (max > 0) for (const [id, h] of raw) raw.set(id, h / max);
  return raw;
}

/**
 * Resolve a URL cursor token to a commit ordinal: a (short) sha prefix wins, then a
 * plain integer ordinal; null when nothing matches (the page falls back to HEAD).
 * @param {{commits: Array}} tg
 * @param {string} token
 * @returns {number|null}
 */
export function resolveCursor(tg, token) {
  const t = String(token || "").trim().toLowerCase();
  if (!t) return null;
  for (const c of tg.commits || []) {
    if (String(c.sha || "").toLowerCase().startsWith(t)) return c.idx;
  }
  if (/^\d+$/.test(t)) {
    const i = parseInt(t, 10);
    if (tg.commits && i >= 0 && i < tg.commits.length) return i;
  }
  return null;
}

// ---- P2: NL → query → URL (the agent round-trip) -----------------------------------

/** NL keyword → type: term. Deliberately small and documented — the mapping is
 *  deterministic string handling, never a model call (a model-driven wrapper can sit
 *  on top and emit grammar directly via the `grammar` flag). */
const NL_TYPE_WORDS = {
  module: "Module", modules: "Module",
  class: "Class", classes: "Class",
  function: "Function", functions: "Function", fn: "Function", fns: "Function",
  method: "Method", methods: "Method",
  attribute: "Attribute", attributes: "Attribute",
  global: "GlobalVariable", globals: "GlobalVariable",
  globalvariable: "GlobalVariable", globalvariables: "GlobalVariable",
  commit: "Commit", commits: "Commit",
};

const NL_STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "all", "any", "me", "us",
  "show", "list", "find", "display", "view", "give", "get", "see",
  "that", "which", "who", "whose", "are", "is", "was", "were", "be", "been",
  "and", "to", "it", "its", "their", "them", "then", "this", "these", "those",
  "what", "have", "has", "had", "i", "we", "you", "my", "our", "please", "graph",
]);

/**
 * Deterministic NL-ish → query-grammar mapping (P2 agent round-trip). Recognized
 * phrasings, applied in order before word-level handling:
 *   "since <token>"                       → since:<token>
 *   "(co-)chang(e|es|ed|ing) with <word>" → cochange:<word>
 *   "touched (more than|over|>) N"        → touched:>N
 *   "more than N (touches|commits|changes)" → touched:>N
 *   "hot"/"hotspot(s)"                    → touched:>2 (documented default)
 *   type words (class/classes/…)          → type:<T>
 *   stopwords                             → dropped
 *   anything else word-shaped             → substring term, verbatim
 * Same input → same {q} always. `notes` records any non-obvious mapping applied.
 * @param {string} text
 * @returns {{q: string, notes: string[]}}
 */
export function nlToQuery(text) {
  let s = ` ${String(text || "").trim().toLowerCase()} `;
  const parts = [];
  const notes = [];
  s = s.replace(/\bsince\s+([a-z0-9]+)\b/g, (_, tok) => { parts.push(`since:${tok}`); return " "; });
  s = s.replace(/\b(?:co-?chang(?:e|es|ed|ing)|chang(?:e|es|ed|ing))\s+with\s+([\w./#-]+)/g, (_, w) => {
    parts.push(`cochange:${w}`); return " ";
  });
  s = s.replace(/\btouched\s+(?:more\s+than|over|>)\s*(\d+)(?:\s+times?)?\b/g, (_, n) => {
    parts.push(`touched:>${n}`); return " ";
  });
  s = s.replace(/\bmore\s+than\s+(\d+)\s+(?:touches|commits|changes)\b/g, (_, n) => {
    parts.push(`touched:>${n}`); return " ";
  });
  s = s.replace(/\bhot(?:spot)?s?\b/g, () => {
    parts.push("touched:>2");
    notes.push('"hot" mapped to touched:>2');
    return " ";
  });
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (NL_TYPE_WORDS[w]) { parts.push(`type:${NL_TYPE_WORDS[w]}`); continue; }
    if (NL_STOPWORDS.has(w)) continue;
    if (/^[\w./#:>-]+$/.test(w)) parts.push(w);
  }
  const seen = new Set();
  const q = parts.filter((p) => !seen.has(p) && seen.add(p)).join(" ");
  return { q, notes };
}

/**
 * Link self-test (P2 agent contract): a link is emitted ONLY if it will render
 * something — a provided query must match ≥1 node and every cursor token must
 * resolve to a real commit. `matches` is null when q is blank (the default view).
 * @param {{nodes: Array, edges?: Array, commits?: Array}} tg
 * @param {{q?: string, at?: string, b?: string}} link
 * @returns {{ok: boolean, matches: number|null, cursor: number|null, cursorB: number|null, reasons: string[]}}
 */
export function validateLink(tg, { q = "", at = "", b = "" } = {}) {
  const reasons = [];
  let matches = null;
  if (String(q).trim()) {
    const set = matchQuery(tg, q);
    matches = set ? set.size : 0;
    if (!matches) reasons.push(`query "${q}" matches no node — the link would render empty`);
  }
  let cursor = null;
  let cursorB = null;
  if (String(at).trim()) {
    cursor = resolveCursor(tg, at);
    if (cursor == null) reasons.push(`cursor "${at}" resolves to no commit on this timeline`);
  }
  if (String(b).trim()) {
    cursorB = resolveCursor(tg, b);
    if (cursorB == null) reasons.push(`cursor B "${b}" resolves to no commit on this timeline`);
  }
  return { ok: reasons.length === 0, matches, cursor, cursorB, reasons };
}

/** The URL-state defaults; only deviations are encoded so links stay short.
 *  P2 adds `g` (co-change gravity layout) and `heat` (hotspot halo) — "1" when on. */
export const VIEW_DEFAULTS = Object.freeze({ q: "", at: "", b: "", types: "", deg: 2, sel: "", g: "", heat: "" });

/**
 * Encode a view state into a query string (no leading `?`). Grammar (P1 + P2):
 *   ?q=<query>&at=<shortSha|ordinal>&b=<shortSha|ordinal>&types=Class,Function&deg=N&sel=<id>&g=1&heat=1
 * Only non-default fields are emitted; key order is fixed so equal states encode
 * to equal strings (deterministic, testable).
 * @param {object} s
 * @returns {string}
 */
export function encodeViewState(s) {
  const p = [];
  const enc = encodeURIComponent;
  if (s.q) p.push(`q=${enc(s.q)}`);
  if (s.at !== "" && s.at != null) p.push(`at=${enc(s.at)}`);
  if (s.b !== "" && s.b != null) p.push(`b=${enc(s.b)}`);
  if (s.types) p.push(`types=${enc(s.types)}`);
  if (s.deg != null && s.deg !== VIEW_DEFAULTS.deg) p.push(`deg=${s.deg}`);
  if (s.sel) p.push(`sel=${enc(s.sel)}`);
  if (s.g) p.push("g=1");
  if (s.heat) p.push("heat=1");
  return p.join("&");
}

/**
 * Decode a query string (with or without `?`) back into a full view state.
 * Unknown keys are ignored (the viewer's `data=` override passes through safely).
 * decode(encode(s)) === s for every state whose fields are strings/numbers.
 * @param {string} search
 * @returns {object}
 */
export function decodeViewState(search) {
  const out = { ...VIEW_DEFAULTS };
  const str = String(search || "").replace(/^\?/, "");
  for (const pair of str.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = pair.slice(0, i);
    const v = decodeURIComponent(pair.slice(i + 1));
    if (k === "deg") { const n = parseInt(v, 10); if (!Number.isNaN(n)) out.deg = n; }
    else if (k in VIEW_DEFAULTS) out[k] = v;
  }
  return out;
}

// ---- P4: cross-repo awareness ------------------------------------------------------
// A merged multi-repo index (extract.mjs indexRepositories) prefixes every module id
// with the repo's directory basename: `mod:<repo>/<path>`, `fn:<repo>/<path>#sym`.
// Commit individuals are NOT prefixed (one Commit per sha, shared across clones), so a
// commit's repo is inferred from the prefixes of the modules it touched. These three
// pure helpers are the shared, node-tested core the timeline (timeline.mjs) and the
// temporal browser (browser.mjs) both use to become repo-aware WITHOUT a top-level
// marker at index time. A single-repo graph never trips the detector, so its timeline
// and temporal-graph output stay byte-identical to the pre-P4 pipeline.

/**
 * First path component of a prefixed id (`mod:<repo>/<rest>` → `<repo>`), or null when
 * the id has no `/` after its `type:` prefix (an unprefixed single-repo id such as
 * `mod:a.py`). Cheap, deterministic; the atom the repo detector counts.
 * @param {string} id
 * @returns {string|null}
 */
export function repoOfId(id) {
  const m = String(id).match(/^[a-z]+:([^#]+)/);
  if (!m) return null;
  const slash = m[1].indexOf("/");
  return slash > 0 ? m[1].slice(0, slash) : null;
}

/**
 * Attribute one commit to a repo given a `Map<prefix, touchCount>` of the modules it
 * touched: the majority prefix wins, ties break lexicographically, an empty map → null
 * (touched nothing tracked). This is how a commit that touches modules from >1 repo
 * (only possible when two clones share a sha, since git history is per-repo) is
 * attributed — to the repo it touched most, deterministically.
 * @param {Map<string, number>} counts
 * @returns {string|null}
 */
export function assignRepo(counts) {
  let best = null;
  let bestN = -1;
  for (const p of [...counts.keys()].sort()) {
    const n = counts.get(p);
    if (n > bestN) { best = p; bestN = n; }
  }
  return best;
}

/**
 * Decide whether a graph is a merged multi-repo index from its commits' touched-module
 * prefixes. `commitPrefixCounts` is one `Map<prefix,count>` per commit. A graph reads
 * as multi-repo iff ≥2 distinct prefixes each appear as the SOLE prefix of some commit
 * AND commits confined to a single prefix are at least as many as cross-prefix commits.
 * Rationale: a real git history is per-repo, so a genuine merge has each commit land in
 * exactly one repo; a single monorepo's commits routinely span several top-level dirs,
 * so the "majority stay confined + ≥2 sole prefixes" test never fires for it — that is
 * what keeps single-repo output byte-identical. (A monorepo whose every commit happens
 * to stay within one top-level dir is the one documented ambiguity; it degrades
 * gracefully to repo-tagged rendering, it does not error.)
 * @param {Array<Map<string, number>>} commitPrefixCounts
 * @returns {boolean}
 */
export function isMultiRepo(commitPrefixCounts) {
  let pure = 0;
  let cross = 0;
  const sole = new Set();
  for (const counts of commitPrefixCounts) {
    const keys = [...counts.keys()];
    if (!keys.length) continue;
    if (keys.length === 1) { pure += 1; sole.add(keys[0]); }
    else cross += 1;
  }
  return sole.size >= 2 && pure >= cross;
}
