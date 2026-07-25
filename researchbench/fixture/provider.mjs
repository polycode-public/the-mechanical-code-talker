// researchbench/fixture/provider.mjs — builds a research-lane provider
// ({lookup, pageByTitle, linkedTitles}) over the frozen stub wiki graph
// (graph.json), registered through the lane's own seam
// (registerResearchProvider, src/adapters/corpus/wikipedia-live.mjs) —
// the same seam test-e2e/pages-ledger-research.test.mjs stubs. No network, ever:
// every method reads the committed JSON, never fetch.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normFactTerm } from "../../src/domain/hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GRAPH_FILE = join(HERE, "graph.json");

export function loadGraph(path = GRAPH_FILE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** title -> its article entry, keyed by normFactTerm so a folded request
 *  ("volcano") finds the properly-cased fixture entry ("Volcano"). */
function titleIndex(graph) {
  const byFold = new Map();
  for (const title of Object.keys(graph.articles)) byFold.set(normFactTerm(title), title);
  return byFold;
}

let revCounter = 0;
function rowFor(title, entry) {
  revCounter += 1;
  return {
    term: normFactTerm(title),
    title,
    text: entry.summary,
    summary: entry.summary,
    url: `https://simple.wikipedia.test/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    revid: 1000 + revCounter,
  };
}

/** Build a {lookup, pageByTitle, linkedTitles} provider over one committed
 *  graph. A title in `deadTitles` (or absent from `articles` altogether)
 *  reads as a clean miss (null) from every method — the stub's 404 shape,
 *  exercising the SAME skip path a live dead link takes (stepRun's
 *  "couldn't fetch — skipped, nothing stored"). */
export function createFixtureResearchProvider(graph = loadGraph()) {
  const byFold = titleIndex(graph);
  const dead = new Set((graph.deadTitles || []).map((t) => normFactTerm(t)));

  function resolveTitle(term) {
    const folded = normFactTerm(term);
    if (dead.has(folded)) return null;
    return byFold.get(folded) ?? null;
  }

  return {
    async lookup(normTerm) {
      const title = resolveTitle(normTerm);
      if (!title) return null;
      return rowFor(title, graph.articles[title]);
    },
    async pageByTitle(title) {
      const resolved = resolveTitle(title);
      if (!resolved) return null;
      return rowFor(resolved, graph.articles[resolved]);
    },
    async linkedTitles(title, { limit = 25 } = {}) {
      const resolved = resolveTitle(title);
      if (!resolved) return null;
      return (graph.articles[resolved].leadLinks || []).slice(0, Math.max(0, limit));
    },
  };
}
