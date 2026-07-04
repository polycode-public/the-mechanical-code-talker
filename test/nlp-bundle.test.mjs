// nlp-bundle tests — the browser wink adapter (nlp-bundle.mjs) must (1) evaluate
// with NO Node globals present (a stand-in for the browser: no require/process/
// module/Buffer in the sandbox — only the browser globals the wink WEB model uses,
// window + atob + typed arrays), and (2) produce the SAME lemmas/POS tags as the
// Node adapter in ask-nlp.mjs, so the two paths can never silently diverge.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { winkBrowserBundle } from "../src/nlp-bundle.mjs";
import { nlpAdapter } from "../src/ask-nlp.mjs";

const WORDS = ["imported", "calls", "touching", "uses", "defines", "returned", "walk.mjs", "render"];

test("winkBrowserBundle: evaluates in a browser-like sandbox (no Node globals) and self-registers window.__seonixNlp", async () => {
  const code = await winkBrowserBundle();
  assert.ok(code.length > 1_000_000, "expected a real, multi-file wink bundle");
  // Deliberately NO require/process/module/Buffer — if it runs here it runs in a browser.
  const sandbox = { window: {}, atob, Uint8Array, Uint32Array };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 30_000 });
  const adapter = sandbox.window.__seonixNlp;
  assert.ok(adapter && typeof adapter.lemma === "function" && typeof adapter.posTags === "function");
  assert.equal(adapter.lemma("imported"), "import");
  assert.equal(adapter.lemma("calls"), "call");
});

test("winkBrowserBundle: lemma + POS output matches ask-nlp.mjs's Node adapter (parity, no drift)", async () => {
  const node = nlpAdapter();
  if (!node) { console.log("wink not installed — parity check skipped"); return; }
  const code = await winkBrowserBundle();
  const sandbox = { window: {}, atob, Uint8Array, Uint32Array };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 30_000 });
  const browser = sandbox.window.__seonixNlp;
  for (const w of WORDS) assert.equal(browser.lemma(w), node.lemma(w), `lemma parity for "${w}"`);
  // the browser array is created in the vm realm (different Array.prototype), so
  // compare by value, not deepStrictEqual's cross-realm prototype check
  assert.equal(JSON.stringify(browser.posTags(WORDS)), JSON.stringify(node.posTags(WORDS)), "posTags parity");
});
