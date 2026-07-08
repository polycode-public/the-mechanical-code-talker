// tmct-browser.mjs — the browser entry point that runs the REAL tmct query engine
// client-side, no server, no LLM, no build step. Loaded as a plain <script type="module">
// (see index.html's import map for how the "node:*" specifiers these engine files still
// carry get resolved to the shims in ./engine-shims/, and how "wink-nlp"/
// "wink-eng-lite-web-model" resolve to esm.sh CDN builds pinned to the exact versions
// package.json depends on).
//
// Everything askBrowser() returns is genuinely computed by src/ask.mjs's ask() running
// in the visitor's own browser against public/demo-graph.json (a static copy of
// examples/mini-webapp/.tmct/graph.json, schema-doc-enriched by scripts/build-demo-
// graph.mjs) — nothing on this page is precomputed server-side or faked. GitLab Pages
// has no backend at all, so there is no other way for this demo to work: a plain HTTP
// client (curl, a scraper) fetching this page only ever sees the static HTML/JS source,
// never a computed answer — only a real browser (or a headless-browser automation tool
// actually running the JS, e.g. Playwright) can observe one, by reading it out of the
// DOM or off `window.tmctAnswer` after this module resolves. That is a hard limitation
// of a static site, not a bug.

import { registerWinkModel } from "./engine/src/wink-model.mjs";
import { ask } from "./engine/src/ask.mjs";
import { parseEntities } from "./engine/src/codegraph.mjs";

const GRAPH_URL = new URL("./demo-graph.json", import.meta.url);

let graphPromise = null;
let winkStatus = "pending"; // "pending" | "loaded" | "unavailable"

/** Try to load wink-nlp + its English model from the CDN and register them with the
 *  engine's browser seam. On ANY failure (network hiccup, CDN hiccup, parse error) this
 *  degrades honestly: registerWinkModel is simply never called, and ask.mjs's own
 *  documented fallback (loadWinkModel() returns null) makes the engine run adapter-less
 *  — the curated + bounded-fuzzy tiers still answer correctly, lemma/POS matching is
 *  just off. Never a thrown error, never a silent hang. */
async function tryLoadWink() {
  try {
    const [{ default: winkNLP }, { default: model }] = await Promise.all([
      import("wink-nlp"),
      import("wink-eng-lite-web-model"),
    ]);
    registerWinkModel(() => ({ winkNLP, model }));
    winkStatus = "loaded";
  } catch (err) {
    winkStatus = "unavailable";
    // eslint-disable-next-line no-console
    console.warn("tmct: wink-nlp CDN load failed, continuing without the lemma/POS tier", err);
  }
}

/** Fetch + parse the demo graph exactly once, sharing the in-flight promise. */
function loadGraph() {
  if (!graphPromise) {
    graphPromise = fetch(GRAPH_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`failed to fetch demo-graph.json (HTTP ${res.status})`);
        return res.json();
      })
      .then((payload) => parseEntities(payload));
  }
  return graphPromise;
}

let enginePromise = null;
/** Bring the engine fully up (wink CDN attempt + graph fetch, in parallel) exactly
 *  once. Resolves to {graph}. Never rejects — a wink failure degrades (see above); a
 *  graph fetch failure DOES reject, since without a graph there is nothing to answer
 *  from and askBrowser callers need an honest error, not a silent empty answer. */
function bootEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([tryLoadWink(), loadGraph()]).then(([, graph]) => ({ graph }));
  }
  return enginePromise;
}

/** Ask the REAL engine a question. Boots the engine (once) if needed. Returns the same
 *  {content, tmct_ask} envelope src/ask.mjs's ask() returns. */
export async function askBrowser(query) {
  const { graph } = await bootEngine();
  return ask(graph, query);
}

/** Whether the wink-nlp CDN load succeeded — "pending" | "loaded" | "unavailable".
 *  Exposed so the UI can honestly caption whether the lemma/POS tier is live. */
export function getWinkStatus() {
  return winkStatus;
}

// ---- programmatic exposure for headless-browser consumers (Playwright etc.) ---------
// A plain `curl` can never see any of this — it never executes JS. These globals exist
// for an actual browser automation tool driving this page: window.tmctAsk lets a script
// ask arbitrary questions against the live engine; window.tmctParseEntities exposes the
// graph parser directly; window.tmctAnswer is set once the page's own auto-asked demo
// question resolves (see index.html's inline script), {query, answer, ts}.
if (typeof window !== "undefined") {
  window.tmctAsk = askBrowser;
  window.tmctParseEntities = parseEntities;
  window.tmctGetWinkStatus = getWinkStatus;
}
