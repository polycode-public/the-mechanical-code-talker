// The code explorer's pure derivations and its IDE-shell document: ledger
// sentences and the degree-ranked term index derive deterministically from an
// entities payload, and renderCodeExplorerHtml lays one full-viewport,
// self-contained document out as title bar, explorer sidebar, chat centre and
// status bar — the same document the site build and the desktop shell both
// ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  computeCodeLedger,
  computeCodeExplorerData,
  renderCodeExplorerHtml,
  edgePhrase,
  DESKTOP_APP_URL,
  statsSummaryLine,
  factTotalText,
  rowKey,
  focusRowsHtml,
  hintsHtml,
  turnHtml,
  chatEmptyStateHtml,
  mbText,
  seedFactsFromPayload,
  seedLoadingNote,
  fetchSeedPayloadWithRetry,
} from "../../src/services/code-explorer-viz.mjs";

const payload = {
  individuals: [
    { label: "src/a.mjs", class: "file" },
    { label: "src/b.mjs", class: "file" },
    { label: "run", class: "function" },
  ],
  objectProperties: [
    { predicate: "imports", count: 1, examples: [{ subjectLabel: "src/a.mjs", objectLabel: "src/b.mjs" }] },
    { predicate: "callsSymbol", count: 1, examples: [{ subjectLabel: "src/a.mjs", objectLabel: "run" }] },
  ],
};

test("edgePhrase folds symbol-grain kinds onto their coarse verb and spells unknown kinds readably", () => {
  assert.equal(edgePhrase("callsSymbol"), "calls");
  assert.equal(edgePhrase("inherits"), "inherits from");
  assert.equal(edgePhrase("dependsOn"), "depends on");
});

test("computeCodeLedger reads each example edge back as a sentence row and ranks terms by degree", () => {
  const ledger = computeCodeLedger(payload);
  assert.equal(ledger.rows.length, 2);
  assert.deepEqual(ledger.rows[0], { s: "src/a.mjs", kind: "imports", phrase: "imports", o: "src/b.mjs", sClass: "file", oClass: "file" });
  assert.equal(ledger.terms[0].term, "src/a.mjs", "the highest-degree term ranks first");
  assert.equal(ledger.focus, "src/a.mjs", "the focus defaults to the highest-degree term");
  assert.equal(ledger.stats.individuals, 3);
  assert.equal(ledger.stats.edges, 2);
});

test("a row cap keeps the focus neighbourhood ahead of the rest instead of truncating the centre", () => {
  const wide = {
    individuals: [],
    objectProperties: [
      {
        predicate: "imports",
        count: 3,
        examples: [
          { subjectLabel: "far.mjs", objectLabel: "away.mjs" },
          { subjectLabel: "hub.mjs", objectLabel: "spoke1.mjs" },
          { subjectLabel: "hub.mjs", objectLabel: "spoke2.mjs" },
        ],
      },
    ],
  };
  const ledger = computeCodeLedger(wide, { focus: "hub.mjs", rowLimit: 2 });
  assert.equal(ledger.meta.truncated, true);
  assert.ok(ledger.rows.every((r) => r.s === "hub.mjs"), "the surviving rows all touch the focus");
});

// ---- the client script's spliced helpers, tested as ordinary functions ---
// These are the pieces CLIENT_JS's inline script splices in with
// `.toString()`, so each is written and tested exactly like any other pure
// module function — the eval round trip into a <script> tag is only proved
// end to end below, by running the whole shell against a stub page.

test("statsSummaryLine names the graph's own counts, then up to four of its most common classes", () => {
  const line = statsSummaryLine({ individuals: 3, edges: 2, classes: [["file", 2], ["function", 1]] });
  assert.equal(line, "3 individuals  ·  2 edges  ·  2 file  ·  1 function");
});

test("statsSummaryLine caps the class tail at four entries", () => {
  const classes = [["a", 5], ["b", 4], ["c", 3], ["d", 2], ["e", 1]];
  const line = statsSummaryLine({ individuals: 1, edges: 1, classes });
  assert.equal(line, "1 individuals  ·  1 edges  ·  5 a  ·  4 b  ·  3 c  ·  2 d", "the fifth class is dropped");
});

test("factTotalText sums the graph's own edges with the seed's fact count", () => {
  assert.equal(factTotalText(2, 0), "2");
  assert.equal(factTotalText(1200, 340), "1,540");
});

test("rowKey identifies a row by its subject, relation kind and object alone", () => {
  const a = { s: "x", kind: "imports", o: "y", phrase: "imports" };
  const b = { s: "x", kind: "imports", o: "y", phrase: "a different phrasing of the same edge" };
  assert.equal(rowKey(a), rowKey(b), "the phrase does not distinguish two rows of the same edge");
  assert.notEqual(rowKey(a), rowKey({ ...a, o: "z" }));
});

test("focusRowsHtml draws the engine's grounded neighbourhood first, then the rest of the row list", () => {
  const data = { focus: "src/a.mjs", ledger: { rows: [{ s: "src/a.mjs", kind: "imports", phrase: "imports", o: "src/b.mjs" }] } };
  const related = { grounded: true, rows: [{ s: "src/a.mjs", kind: "calls", phrase: "calls", o: "run" }] };
  const html = focusRowsHtml(data, related);
  assert.match(html, /<span class="verb">calls<\/span>/);
  assert.ok(html.indexOf("run") < html.indexOf("src/b.mjs"), "the grounded row leads, the row list's own row follows");
});

test("focusRowsHtml falls back to filtering the row list when nothing grounded", () => {
  const data = { focus: "src/a.mjs", ledger: { rows: [{ s: "src/a.mjs", kind: "imports", phrase: "imports", o: "src/b.mjs" }] } };
  assert.match(focusRowsHtml(data, null), /src\/b\.mjs/);
  assert.match(focusRowsHtml(data, { grounded: false, rows: [] }), /src\/b\.mjs/);
});

test("focusRowsHtml says an empty grounded answer differently from an empty graph", () => {
  const data = { focus: "src/a.mjs", ledger: { rows: [] } };
  assert.match(focusRowsHtml(data, { grounded: true, rows: [] }), /nothing in this graph relates to src\/a\.mjs/);
  assert.match(focusRowsHtml(data, { grounded: false, rows: [] }), /no edges in this graph/);
});

test("hintsHtml draws one button per hint, or a muted note when there are none", () => {
  assert.match(hintsHtml([{ text: "what imports run", rationale: "a common question" }]), /data-q="what imports run"/);
  assert.match(hintsHtml([]), /nothing to suggest for this graph/);
});

test("turnHtml labels a turn by its role and escapes what was said", () => {
  assert.match(turnHtml("you", "<script>"), /^<span class="who">you<\/span>/);
  assert.match(turnHtml("tmct", "hello"), /^<span class="who">tmct<\/span>/);
  assert.match(turnHtml("you", "<script>"), /&lt;script&gt;/);
});

test("chatEmptyStateHtml invites a question when the engine is loaded, and says so plainly when it is not", () => {
  assert.match(chatEmptyStateHtml(true), /Ask the graph, or ask it anything/);
  assert.match(chatEmptyStateHtml(false), /Static view/);
});

test("mbText renders a byte count in megabytes to one decimal place", () => {
  assert.equal(mbText(1048576), "1.0");
  assert.equal(mbText(1572864), "1.5");
});

test("seedFactsFromPayload counts only the Fact-classed individuals", () => {
  const payload = { individuals: [{ class: "Fact" }, { class: "Fact" }, { class: "SkosConcept" }] };
  assert.equal(seedFactsFromPayload(payload), 2);
  assert.equal(seedFactsFromPayload({}), 0);
});

test("seedLoadingNote reports progress in megabytes, with a total once the response names one", () => {
  assert.equal(seedLoadingNote(1048576, 0), "loading general knowledge… 1.0 MB");
  assert.equal(seedLoadingNote(1048576, 2097152), "loading general knowledge… 1.0 of 2.0 MB");
});

function textBlob(text) { return { text: async () => text }; }

test("fetchSeedPayloadWithRetry returns the parsed payload on a clean first fetch, no retry", async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return textBlob('{"individuals":[]}'); };
  const payload = await fetchSeedPayloadWithRetry(fetcher, "./chat-seed.json", "", () => {});
  assert.deepEqual(payload, { individuals: [] });
  assert.deepEqual(calls, ["./chat-seed.json"]);
});

test("fetchSeedPayloadWithRetry retries once with a cache-busting param when the first response is corrupted", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return calls.length === 1 ? textBlob("not json") : textBlob('{"individuals":[{"class":"Fact"}]}');
  };
  const payload = await fetchSeedPayloadWithRetry(fetcher, "./chat-seed.json", "", () => {});
  assert.deepEqual(payload, { individuals: [{ class: "Fact" }] });
  assert.deepEqual(calls, ["./chat-seed.json", "./chat-seed.json?retry=1"]);
});

test("fetchSeedPayloadWithRetry's retry param joins with & when a seed query string is already present", async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return textBlob("still not json"); };
  await assert.rejects(() => fetchSeedPayloadWithRetry(fetcher, "./chat-seed.json", "?b=abc123", () => {}));
  assert.deepEqual(calls, ["./chat-seed.json?b=abc123", "./chat-seed.json?b=abc123&retry=1"]);
});

test("fetchSeedPayloadWithRetry throws the last error when both attempts fail", async () => {
  const fetcher = async () => { throw new Error("network down"); };
  await assert.rejects(() => fetchSeedPayloadWithRetry(fetcher, "./chat-seed.json", "", () => {}), /network down/);
});

test("fetchSeedPayloadWithRetry reports progress through the caller's callback", async () => {
  const progress = [];
  const fetcher = async (url, onProgress) => { onProgress(50, 100); return textBlob("{}"); };
  await fetchSeedPayloadWithRetry(fetcher, "./chat-seed.json", "", (loaded, total) => progress.push([loaded, total]));
  assert.deepEqual(progress, [[50, 100]]);
});

function renderDefault(opts = {}) {
  return renderCodeExplorerHtml(computeCodeExplorerData(payload, { title: "demo code graph" }), opts);
}

test("the shell document lays its regions out in IDE order: title bar, explorer sidebar, chat centre, status bar", () => {
  const html = renderDefault();
  const order = [
    'class="titlebar"',
    'id="source-name"',
    'id="open-graph"',
    'id="open-repo"',
    'data-panel="explorer"',
    'id="focus-name"',
    'id="ledger"',
    'data-panel="conversation"',
    'id="chat-log"',
    'id="hints"',
    'id="chat-form"',
    'class="statusbar"',
    'id="stats"',
    'id="seed-status"',
  ];
  let at = -1;
  for (const needle of order) {
    const next = html.indexOf(needle);
    assert.ok(next > at, `${needle} appears, after the region before it`);
    at = next;
  }
});

test("the shell is full-viewport: the page never scrolls, its panels do", () => {
  const html = renderDefault();
  assert.match(html, /html, body \{ height: 100%; \}/);
  assert.match(html, /body \{ margin: 0; overflow: hidden;/);
  assert.match(html, /#chat-log \{ flex: 1; min-height: 0; overflow-y: auto;/);
  assert.match(html, /\.panel-body \{ flex: 1; min-height: 0; overflow-y: auto;/);
});

test("showDesktopLink toggles the desktop-app pointer the site build adds and the desktop shell omits", () => {
  assert.ok(renderDefault({ showDesktopLink: true }).includes(DESKTOP_APP_URL));
  assert.ok(!renderDefault().includes(DESKTOP_APP_URL));
});

test("bundleAvailable links the sibling engine bundle; bundleInline embeds it instead", () => {
  const linked = renderDefault({ bundleAvailable: true });
  assert.ok(linked.includes('<script src="./code-explorer.bundle.js"></script>'));
  const inlined = renderDefault({ bundleInline: "console.log('engine');", bundleAvailable: true });
  assert.ok(inlined.includes("console.log('engine');"));
  assert.ok(!inlined.includes('<script src="./code-explorer.bundle.js"></script>'));
});

test("the embedded page data carries the payload and the derived view under one global", () => {
  const html = renderDefault();
  assert.match(html, /window\.__CODE_EXPLORER__ = Object\.assign\(\{ payload: /);
  assert.ok(html.includes("src/a.mjs"));
});

// ---- the page's own client, run --------------------------------------------

// Enough DOM for the shell's inline script: the elements it reads by id, the
// one delegated click listener, and the log it appends turns to.
function stubPage() {
  const elements = new Map();
  const makeElement = () => {
    const el = {
      textContent: "", innerHTML: "", value: "", disabled: false, scrollTop: 0, scrollHeight: 0,
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      remove() {}, focus() {}, addEventListener() {}, closest: () => null,
      setAttribute() {}, getAttribute: () => null,
    };
    return el;
  };
  for (const id of ["focus-name", "ledger", "hints", "stats", "chat-log", "chat-form", "chat-input",
    "dock-note", "source-name", "seed-status", "fact-total-value", "open-graph", "open-repo"]) {
    elements.set(id, makeElement());
  }
  const listeners = [];
  const document = {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: makeElement,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
  };
  const clickTerm = (term) => {
    const target = { closest: (sel) => (sel === "[data-term]" ? { getAttribute: () => term } : null) };
    for (const { type, fn } of listeners) if (type === "click") fn({ target });
  };
  return { elements, document, clickTerm };
}

/** Run the shell's inline client against a stub page and a stub engine surface,
 *  and hand back what it rendered. `api` is the page-local bag the client
 *  reaches through `window.tmct.page`; null is the static page, which has no
 *  engine to ask. */
function runPageClient(data, api) {
  const page = stubPage();
  const context = {
    console: { warn() {}, error() {}, log() {} },
    fetch: () => Promise.reject(new Error("no network in this test")),
    document: page.document,
  };
  context.window = context;
  context.globalThis = context;
  context.window.__CODE_EXPLORER__ = { payload: data.payload, ledger: data.ledger, hints: data.hints, focus: data.focus, meta: data.meta };
  context.window.tmct = api ? { page: api } : null;
  const html = renderCodeExplorerHtml(data);
  const clientJs = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  vm.runInContext(clientJs, vm.createContext(context));
  return {
    ledgerHtml: () => page.elements.get("ledger").innerHTML,
    focusName: () => page.elements.get("focus-name").textContent,
    clickTerm: page.clickTerm,
  };
}

const askedRow = (s, phrase, o) => ({ s, kind: phrase, phrase, o, sClass: "", oClass: "" });

test("the sidebar's focus rows are the engine's answer to what relates to the focus, not a filter over the row list", () => {
  const data = computeCodeExplorerData(payload, { title: "demo code graph" });
  const asks = [];
  const page = runPageClient(data, {
    computeCodeExplorerData,
    askRelatedFacts(graphPayload, term) {
      asks.push({ graphPayload, term });
      return { term, grounded: true, asked: [], rows: [askedRow("src/a.mjs", "re-exports", "only-the-engine-knows.mjs")] };
    },
  });
  assert.deepEqual(asks.map((a) => a.term), ["src/a.mjs"], "the focus is put to the engine on mount");
  assert.equal(asks[0].graphPayload, payload, "over the loaded graph itself");
  const rendered = page.ledgerHtml();
  assert.match(rendered, /only-the-engine-knows\.mjs/, "the answer's own row is drawn");
  assert.match(rendered, /<span class="verb">re-exports<\/span>/, "with the relation the answer named");
  assert.ok(rendered.indexOf("only-the-engine-knows.mjs") < rendered.indexOf("src/b.mjs"), "the answered neighbourhood leads, the bulk row list follows");
});

test("clicking a term re-asks the engine about that term", () => {
  const data = computeCodeExplorerData(payload, { title: "demo code graph" });
  const asks = [];
  const page = runPageClient(data, {
    computeCodeExplorerData,
    askRelatedFacts(graphPayload, term) {
      asks.push(term);
      return { term, grounded: true, asked: [], rows: [askedRow(term, "calls", "asked-about-" + term)] };
    },
  });
  page.clickTerm("run");
  assert.deepEqual(asks, ["src/a.mjs", "run"], "the click asks again about the clicked term");
  assert.equal(page.focusName(), "run");
  assert.match(page.ledgerHtml(), /asked-about-run/);
});

test("an ungrounded ask falls back to the row list rather than showing an empty neighbourhood", () => {
  const data = computeCodeExplorerData(payload, { title: "demo code graph" });
  const page = runPageClient(data, {
    computeCodeExplorerData,
    askRelatedFacts: (graphPayload, term) => ({ term, grounded: false, asked: [], rows: [] }),
  });
  const rendered = page.ledgerHtml();
  assert.match(rendered, /src\/b\.mjs/, "the row list's own rows still draw");
  assert.doesNotMatch(rendered, /no edges in this graph/);
});

test("a grounded ask that finds nothing says so, where an empty graph says something else", () => {
  const data = computeCodeExplorerData(payload, { title: "demo code graph" });
  const emptyLedger = { ...data, ledger: { ...data.ledger, rows: [] } };
  const answered = runPageClient(emptyLedger, {
    computeCodeExplorerData,
    askRelatedFacts: (graphPayload, term) => ({ term, grounded: true, asked: [], rows: [] }),
  });
  assert.match(answered.ledgerHtml(), /nothing in this graph relates to src\/a\.mjs/);
  const unasked = runPageClient(emptyLedger, {
    computeCodeExplorerData,
    askRelatedFacts: (graphPayload, term) => ({ term, grounded: false, asked: [], rows: [] }),
  });
  assert.match(unasked.ledgerHtml(), /no edges in this graph/);
});

test("the static page, with no engine bundle, still reads its rows back from the embedded view", () => {
  const data = computeCodeExplorerData(payload, { title: "demo code graph" });
  const page = runPageClient(data, null);
  assert.match(page.ledgerHtml(), /src\/b\.mjs/);
  assert.equal(page.focusName(), "src/a.mjs");
});
