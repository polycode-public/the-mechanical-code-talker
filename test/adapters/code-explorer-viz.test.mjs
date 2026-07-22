// The code explorer's pure derivations and its IDE-shell document: ledger
// sentences and the degree-ranked term index derive deterministically from an
// entities payload, and renderCodeExplorerHtml lays one full-viewport,
// self-contained document out as title bar, explorer sidebar, chat centre and
// status bar — the same document the site build and the desktop shell both
// ship.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCodeLedger,
  computeCodeExplorerData,
  renderCodeExplorerHtml,
  edgePhrase,
  DESKTOP_APP_URL,
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
