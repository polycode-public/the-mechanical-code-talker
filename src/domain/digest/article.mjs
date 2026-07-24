// digest/article.mjs — stage 4 of the digest layer: assemble composed
// paragraphs into a whole article, and keep the full detail reachable behind an
// explicit escape. Pure and deterministic; returns a DATA shape, never rendered
// terminal or HTML — the surface wiring (stage 5) decides how to print the
// narrative and how the "show the facts" / "show the chains" escapes fire.
//
// The narrative leads; the detail is ranked, never destroyed. `detail.facts`
// carries every stored fact for the term (the ones the digest spoke AND the
// ones the selector cut), so the escape reaches the whole list, and every
// paragraph traces back to the rows in `provenanceRows`.

/** Minimal, render-ready view of a fact row for the detail escape. */
const factView = (row) => ({
  subject: row.subject,
  predicate: row.predicate,
  object: row.object,
  sourceTypes: row.sourceTypes || [],
  provenance: row.provenance || "",
});

/** Distinct source descriptors behind a set of rows, in first-seen order, so a
 *  digest names where it came from the way the specimen's own replies do. */
function sourcesFrom(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row.provenance || (row.sourceTypes || []).join(",");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ provenance: row.provenance || "", sourceTypes: row.sourceTypes || [] });
  }
  return out;
}

const ESCAPES = Object.freeze({ facts: "show the facts", chains: "show the chains" });

/** Every stored fact the selector saw for the term — spoken and cut alike —
 *  as detail views, plus the count and any ancestry chains. */
function detailFrom(selection, chains) {
  const rows = [
    ...(selection?.selected || []).map((s) => s.row),
    ...(selection?.cut || []).map((c) => c.row),
  ].filter(Boolean);
  const chainList = Object.entries(chains || {})
    .filter(([, chain]) => Array.isArray(chain) && chain.length > 1)
    .map(([object, chain]) => ({ object, chain }));
  return { escapes: ESCAPES, facts: rows.map(factView), factCount: rows.length, chains: chainList };
}

/**
 * A term article: definition → description paragraphs, the sources it drew on,
 * and the full fact list behind the "show the facts" escape.
 * `composed` is composeTermDigest()'s result; `selection` is selectFacts()'s.
 */
export function termArticle(selection, composed, opts = {}) {
  const term = composed?.term || selection?.term || "";
  return {
    kind: "term-article",
    term,
    headline: term,
    paragraphs: (composed?.paragraphs || []).map((p) => p.text).filter(Boolean),
    body: composed?.paragraphs || [],
    sources: sourcesFrom(composed?.provenanceRows || []),
    detail: detailFrom(selection, opts.chains),
    provenanceRows: composed?.provenanceRows || [],
  };
}

/**
 * A research-run article: what the run set out to learn, what it grounded, and
 * what it skipped and why. `run` supplies { term, grounded: [topic], skipped:
 * [{ topic, reason }], rows }. The composed narrative (if any) leads; the run
 * facts stay reachable behind the same escape.
 */
export function researchRunArticle(run, composed = null, opts = {}) {
  const term = run?.term || composed?.term || "";
  const rows = run?.rows || composed?.provenanceRows || [];
  return {
    kind: "research-run",
    term,
    headline: term,
    paragraphs: (composed?.paragraphs || []).map((p) => p.text).filter(Boolean),
    grounded: (run?.grounded || []).map(String),
    skipped: (run?.skipped || []).map((s) => ({ topic: String(s?.topic || ""), reason: String(s?.reason || "") })),
    sources: sourcesFrom(rows),
    detail: { escapes: ESCAPES, facts: rows.map(factView), factCount: rows.length, chains: (opts.chains ? detailFrom({ selected: [], cut: [] }, opts.chains).chains : []) },
    provenanceRows: rows,
  };
}

/**
 * A session digest: what this conversation taught the store. `session` supplies
 * { rows } (the fact rows the session asserted). Groups nothing away — the rows
 * ARE the detail, and any composed narrative leads.
 */
export function sessionDigestArticle(session, composed = null) {
  const rows = session?.rows || [];
  return {
    kind: "session-digest",
    paragraphs: (composed?.paragraphs || []).map((p) => p.text).filter(Boolean),
    learnedCount: rows.length,
    sources: sourcesFrom(rows),
    detail: { escapes: ESCAPES, facts: rows.map(factView), factCount: rows.length, chains: [] },
    provenanceRows: rows,
  };
}
