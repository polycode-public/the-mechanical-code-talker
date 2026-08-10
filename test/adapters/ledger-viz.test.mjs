// ledger-viz: renderLedgerHtml page-structure pins. The digest paragraph
// itself is exercised end to end in ledger-viz-digest.test.mjs; these tests
// cover the page's own heading, independent of any live memory payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLedgerHtml, resolveBackendMode, backendModeUrl } from "../../src/services/ledger-viz.mjs";

test("renderLedgerHtml: carries exactly one h1, naming the page rather than repeating the eyebrow's nav links", () => {
  const html = renderLedgerHtml();
  const h1s = [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)];
  assert.equal(h1s.length, 1, "exactly one h1 on the page");
  assert.equal(h1s[0][1], "memory ledger");
  assert.ok(html.indexOf(h1s[0][0]) < html.indexOf('class="eyebrow"'), "the h1 lands before the eyebrow it titles");
});

test("renderLedgerHtml: the eyebrow's own nav links carry no heading of their own", () => {
  const html = renderLedgerHtml();
  const eyebrowLine = html.slice(html.indexOf('<div class="eyebrow">'), html.indexOf("</div>", html.indexOf('<div class="eyebrow">')));
  assert.ok(!eyebrowLine.includes("<h1"), "the eyebrow is navigation, not the page title");
});

test("renderLedgerHtml: the backend slider renders only when the live turn engine bundle is linked", () => {
  const withoutEngine = renderLedgerHtml();
  assert.ok(!withoutEngine.includes('id="backendMode"'), "no engine bundle means no backend choice to offer");

  const withEngine = renderLedgerHtml({ ledgerBundleAvailable: true, memoryAskBundle: "/* stub */" });
  assert.ok(withEngine.includes('id="backendMode"'));
  assert.ok(withEngine.includes('id="backendNote"'));
});

test("resolveBackendMode: only an exact backend=aws parameter is AWS mode; anything else is local, silently", () => {
  assert.equal(resolveBackendMode(""), "local", "absent is local");
  assert.equal(resolveBackendMode("?backend=aws"), "aws");
  assert.equal(resolveBackendMode("?backend=AWS"), "local", "matched case-sensitively, not fuzzed");
  assert.equal(resolveBackendMode("?backend=dynamo"), "local", "an unknown value falls back to local rather than erroring");
});

test("backendModeUrl: rewrites the backend param alone, keeping every other param and the hash", () => {
  const base = "https://tmct.example/ledger.html?q=owl#frag";
  const toAws = new URL(backendModeUrl(base, "aws"));
  assert.equal(toAws.searchParams.get("backend"), "aws");
  assert.equal(toAws.searchParams.get("q"), "owl");
  assert.equal(toAws.hash, "#frag");

  const backToLocal = new URL(backendModeUrl(toAws.toString(), "local"));
  assert.equal(backToLocal.searchParams.has("backend"), false, "local is the absence of the param, not the literal string");
});
