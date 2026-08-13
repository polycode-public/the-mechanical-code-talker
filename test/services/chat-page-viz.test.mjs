// chat-page-viz: the pure render-glue the page splices into its own inline
// script. renderChatHtml is a pure string builder, so its structure is pinned
// here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderChatHtml,
  provenanceChipFor,
  resolveBackendMode,
  backendModeUrl,
} from "../../src/services/chat-page-viz.mjs";
import { provBucketFor } from "../../src/services/ledger-viz.mjs";

test("a fact the user taught reads as taught, off the citation the answer already carries", () => {
  const answer = 'zorbnug is a kind of dog (source: teach:chat:local@2026-07-20T12:00:00.000Z)';
  assert.equal(provenanceChipFor(answer, { miss: false, via: "ask" }, provBucketFor), "taught");
});

test("resolveBackendMode: only an exact backend=aws parameter is AWS mode; anything else is local, silently", () => {
  assert.equal(resolveBackendMode(""), "local", "absent is local");
  assert.equal(resolveBackendMode("?backend=aws"), "aws");
  assert.equal(resolveBackendMode("?backend=AWS"), "local", "matched case-sensitively, not fuzzed");
  assert.equal(resolveBackendMode("?backend=local"), "local");
  assert.equal(resolveBackendMode("?backend=dynamo"), "local", "an unknown value falls back to local rather than erroring");
  assert.equal(resolveBackendMode("?backend="), "local");
  assert.equal(resolveBackendMode("?other=1&backend=aws"), "aws", "reads regardless of position among other params");
});

test("backendModeUrl: rewrites the backend param alone, keeping every other param and the hash", () => {
  const base = "https://tmct.example/chat.html?ref=email&topic=owls#frag";
  const toAws = new URL(backendModeUrl(base, "aws"));
  assert.equal(toAws.searchParams.get("backend"), "aws");
  assert.equal(toAws.searchParams.get("ref"), "email", "an unrelated param survives the rewrite");
  assert.equal(toAws.searchParams.get("topic"), "owls");
  assert.equal(toAws.hash, "#frag");

  const backToLocal = new URL(backendModeUrl(toAws.toString(), "local"));
  assert.equal(backToLocal.searchParams.has("backend"), false, "local is the absence of the param, not the literal string");
  assert.equal(backToLocal.searchParams.get("ref"), "email");
});

test("the page carries the composer, the memory panel, the research controls and the help link", () => {
  const html = renderChatHtml();
  for (const id of [
    "messages", "composer", "composerInput", "composerSend", "status",
    "factPill", "factPillValue", "factPillUnit",
    "backendMode", "backendLocal", "backendAws",
    "wikiMode", "wikiOff", "wikiMiss", "wikiAlways", "synthSlider", "synthValue",
    "researchTopic", "researchGo", "researchPlay", "researchQueueStatus",
    "ingestFile", "ingestInput", "exportMd", "exportFacts", "printChat", "reinitStore",
    "statsPanel", "statsPanelStats", "researchedPanel",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `the page carries #${id}`);
  }
  assert.ok(html.includes('href="./help.html#chat"'), "the chrome's ? deep-links to the chat section of the help page");
});

test("the page's only typed-in boxes are the composer and the research topic", () => {
  const html = renderChatHtml();
  const typed = [...html.matchAll(/<input[^>]*type="text"[^>]*>/g)]
    .map((m) => /id="([^"]+)"/.exec(m[0])[1]);
  assert.deepEqual(typed.sort(), ["composerInput", "researchTopic"]);
  assert.equal(html.includes("<textarea"), false, "the page has no paste target of its own");
});

test("the hidden attribute wins: the display rules below it never bring an element back", () => {
  assert.match(
    renderChatHtml(),
    /\[hidden\] \{ display: none !important; \}/,
    "the display rules below would otherwise beat the hidden attribute",
  );
});
