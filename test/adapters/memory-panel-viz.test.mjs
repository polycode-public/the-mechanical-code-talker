// memory-panel-viz: the shared page-script helpers chat-page-viz.mjs and
// ingest-viz.mjs both splice in. Each export is exercised directly (the same
// function a page's inline script gets), plus a `.toString()` round trip
// proving every export stays splice-safe — no reference outside its own
// parameters, since a page's inline script only ever sees the function body
// as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandLabelFor, statsSummaryLine, fetchWithProgress, renderStatsPanelInto,
} from "../../src/services/memory-panel-viz.mjs";

// ---- bandLabelFor ----------------------------------------------------------

test("bandLabelFor: a known seed band renders its human label", () => {
  assert.equal(bandLabelFor("human"), "human persona");
  assert.equal(bandLabelFor("conceptnet"), "ConceptNet");
  assert.equal(bandLabelFor("wordnet-xl"), "WordNet");
});

test("bandLabelFor: an unrecognized key renders as itself, never disappearing", () => {
  assert.equal(bandLabelFor("some-future-band"), "some-future-band");
  assert.equal(bandLabelFor("taught this session"), "taught this session");
});

// ---- statsSummaryLine -------------------------------------------------------

test("statsSummaryLine: no starter memory reads plainly, not as zero facts", () => {
  assert.equal(statsSummaryLine(null, bandLabelFor), "no starter memory; starting empty");
  assert.equal(statsSummaryLine({ total: 0, bandCounts: {} }, bandLabelFor), "no starter memory; starting empty");
});

test("statsSummaryLine: every seed band the session holds, named with its count, in the fixed band order", () => {
  const stats = { total: 30, bandCounts: { conceptnet: 20, human: 10 } };
  assert.equal(statsSummaryLine(stats, bandLabelFor), "starter memory: 10 human persona + 20 ConceptNet (30 facts total)");
});

test("statsSummaryLine: a total whose only band is outside the fixed band order still reports the count", () => {
  const stats = { total: 5, bandCounts: { "a-future-band-not-yet-in-the-order": 5 } };
  assert.equal(statsSummaryLine(stats, bandLabelFor), "5 starter facts loaded");
});

test("statsSummaryLine: the band label lookup is an injected collaborator, not a fixed import", () => {
  const stats = { total: 3, bandCounts: { human: 3 } };
  assert.equal(statsSummaryLine(stats, () => "OVERRIDDEN"), "starter memory: 3 OVERRIDDEN (3 facts total)");
});

// ---- fetchWithProgress ------------------------------------------------------

function fakeResponse({ ok = true, status = 200, contentLength = null, chunks = [] } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => (name === "content-length" ? contentLength : null) },
    body: {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i >= chunks.length) return { done: true, value: undefined };
            const value = chunks[i];
            i += 1;
            return { done: false, value };
          },
        };
      },
    },
  };
}

test("fetchWithProgress: reports loaded/total after every chunk and resolves the whole body", async () => {
  const chunk1 = new Uint8Array([1, 2, 3]);
  const chunk2 = new Uint8Array([4, 5]);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => fakeResponse({ contentLength: "5", chunks: [chunk1, chunk2] });
  try {
    const blob = await fetchWithProgress("http://example.test/asset", (loaded, total) => calls.push([loaded, total]));
    assert.deepEqual(calls, [[3, 5], [5, 5]]);
    assert.equal(blob.size, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithProgress: a non-ok response throws rather than silently returning empty", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => fakeResponse({ ok: false, status: 404 });
  try {
    await assert.rejects(() => fetchWithProgress("http://example.test/missing", () => {}), /HTTP 404/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithProgress: with no streaming body reader, falls back to a single-shot blob read", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    body: null,
    async blob() { return { size: 42 }; },
  });
  try {
    const blob = await fetchWithProgress("http://example.test/asset", (loaded, total) => calls.push([loaded, total]));
    assert.deepEqual(calls, [[42, 42]]);
    assert.equal(blob.size, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- renderStatsPanelInto ----------------------------------------------------
// A minimal DOM stand-in — just enough createElement/appendChild/textContent
// machinery for the panel to build against, without pulling in a real DOM.

function fakeElement(tag) {
  let text = "";
  const el = {
    tagName: tag,
    className: "",
    id: "",
    title: "",
    type: "",
    children: [],
    listeners: {},
    get textContent() { return text; },
    set textContent(v) { text = v; this.children = []; }, // matches real DOM: assigning textContent clears every child
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(kind, fn) { this.listeners[kind] = fn; },
  };
  return el;
}

function fakeDocument() {
  return {
    createElement: (tag) => fakeElement(tag),
    createTextNode: (text) => ({ tagName: "#text", textContent: text }),
  };
}

test("renderStatsPanelInto: renders a total-facts row, one row per held band, in the fixed order", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    renderStatsPanelInto(panel, { total: 15, bandCounts: { conceptnet: 10, human: 5 }, taught: [] }, { bandLabel: bandLabelFor });
  } finally {
    globalThis.document = originalDocument;
  }
  const headings = panel.children.filter((c) => c.tagName === "h2").map((c) => c.textContent);
  assert.deepEqual(headings, ["this session's memory", "taught this session"]);
  const bandRows = panel.children.filter((c) => c.className === "band-row");
  assert.equal(bandRows.length, 3, "total facts + conceptnet + human");
  assert.deepEqual(bandRows.map((r) => r.children[0].textContent), ["total facts", "human persona", "ConceptNet"]);
  assert.deepEqual(bandRows.map((r) => r.children[1].textContent), ["15", "5", "10"]);
});

test("renderStatsPanelInto: nothing taught yet shows the plain teach-a-fact prompt", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    renderStatsPanelInto(panel, { total: 0, bandCounts: {}, taught: [] }, { bandLabel: bandLabelFor });
  } finally {
    globalThis.document = originalDocument;
  }
  const empty = panel.children.find((c) => c.className === "empty");
  assert.ok(empty, "an empty note renders");
  assert.match(empty.textContent, /nothing yet/);
});

test("renderStatsPanelInto: a custom taughtHint overrides the default empty-state copy", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    renderStatsPanelInto(panel, { total: 0, bandCounts: {}, taught: [] }, { bandLabel: bandLabelFor, taughtHint: "ingest some text to fill this in" });
  } finally {
    globalThis.document = originalDocument;
  }
  const empty = panel.children.find((c) => c.className === "empty");
  assert.equal(empty.textContent, "ingest some text to fill this in");
});

test("renderStatsPanelInto: taught facts render most-recently-taught first, each with its provenance tag", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  const taught = [
    { subject: "rex", predicate: "rdfs:subClassOf", object: "dog", tag: "teach:chat:a@t1" },
    { subject: "fido", predicate: "rdfs:subClassOf", object: "dog", tag: "teach:chat:b@t2" },
  ];
  try {
    renderStatsPanelInto(panel, { total: 2, bandCounts: {}, taught }, { bandLabel: bandLabelFor });
  } finally {
    globalThis.document = originalDocument;
  }
  const items = panel.children.filter((c) => c.className === "taught-item");
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.children[0].textContent), ["fido rdfs:subClassOf dog", "rex rdfs:subClassOf dog"]);
  assert.deepEqual(items.map((i) => i.children[1].textContent), ["teach:chat:b@t2", "teach:chat:a@t1"]);
});

test("renderStatsPanelInto: with no onForget, no forget button or persist note renders", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    renderStatsPanelInto(panel, { total: 0, bandCounts: {}, taught: [] }, { bandLabel: bandLabelFor, persistNote: "kept on this device" });
  } finally {
    globalThis.document = originalDocument;
  }
  assert.equal(panel.children.some((c) => c.id === "forgetEverything"), false);
  assert.equal(panel.children.some((c) => c.className === "persist-note"), false);
});

test("renderStatsPanelInto: with onForget, the forget button and its persist note render and the click wires through", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  let forgotten = false;
  try {
    renderStatsPanelInto(panel, { total: 0, bandCounts: {}, taught: [] }, {
      bandLabel: bandLabelFor,
      onForget: () => { forgotten = true; },
      persistNote: "kept on this device",
    });
  } finally {
    globalThis.document = originalDocument;
  }
  const forget = panel.children.find((c) => c.id === "forgetEverything");
  assert.ok(forget, "the forget button renders");
  forget.listeners.click();
  assert.equal(forgotten, true);
  const note = panel.children.find((c) => c.className === "persist-note");
  assert.equal(note.textContent, "kept on this device");
});

test("renderStatsPanelInto: a re-render clears whatever the panel held before, never accumulating stale rows", () => {
  const panel = fakeElement("aside");
  const originalDocument = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    renderStatsPanelInto(panel, { total: 1, bandCounts: { human: 1 }, taught: [] }, { bandLabel: bandLabelFor });
    const firstCount = panel.children.length;
    renderStatsPanelInto(panel, { total: 1, bandCounts: { human: 1 }, taught: [] }, { bandLabel: bandLabelFor });
    assert.equal(panel.children.length, firstCount, "the second render replaces, not appends");
  } finally {
    globalThis.document = originalDocument;
  }
});

// ---- splice safety ----------------------------------------------------------
// Every export must read back as itself with no free variable outside its own
// parameter list — the same discipline chat-page-viz.mjs's own
// provenanceChipFor/loadProgressLine hold, proven the same way there: a
// `.toString()` re-eval inside a fresh Function body must not throw for
// wanting some outer binding this module happens to also export.

test("every export's own source text carries no reference this module's other top-level bindings would resolve by accident", () => {
  for (const fn of [bandLabelFor, statsSummaryLine, fetchWithProgress, renderStatsPanelInto]) {
    const src = fn.toString();
    assert.ok(!src.includes("import "), `${fn.name} carries no import statement`);
    assert.ok(!/\bexport\b/.test(src), `${fn.name} carries no export keyword`);
  }
});
