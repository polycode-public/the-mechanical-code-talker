// chat-page-viz: renderChatHtml is a pure string builder — no engine state is
// embedded (it all arrives live via the sibling chat-browser.bundle.js,
// exactly as the home page's own embedded widget works), so these tests pin
// the page's STRUCTURE (mirroring spider-fly-viz.test.mjs's own style) plus
// provenanceChipFor, the pure classifier this page's signature element (the
// per-message provenance chip) is built on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderChatHtml, provenanceChipFor } from "../../src/services/chat-page-viz.mjs";
import { provBucketFor } from "../../src/services/ledger-viz.mjs";

// ---- provenanceChipFor: the pure classifier, exercised directly against
// the real provBucketFor (the same function the page splices into its own
// inline script), so a change to either side is caught here.

test("provenanceChipFor: a miss carries no chip, whatever the answer text says", () => {
  assert.equal(provenanceChipFor("I don't know that yet", { miss: true }, provBucketFor), null);
  assert.equal(provenanceChipFor("dog is a kind of animal (source: corpus:conceptnet)", { miss: true }, provBucketFor), null);
});

test("provenanceChipFor: no record at all carries no chip", () => {
  assert.equal(provenanceChipFor("anything", null, provBucketFor), null);
});

test("provenanceChipFor: a corpus citation reads as corpus", () => {
  const tier = provenanceChipFor("dog is a kind of animal (source: corpus:conceptnet /r/IsA)", { miss: false, via: "template" }, provBucketFor);
  assert.equal(tier, "corpus");
});

test("provenanceChipFor: a teach-lane citation reads as taught", () => {
  const tier = provenanceChipFor("rex is a kind of dog (source: teach:chat:abc@2026-01-01T00:00:00.000Z)", { miss: false, via: "template" }, provBucketFor);
  assert.equal(tier, "taught");
});

test("provenanceChipFor: an ACE-assert citation reads as taught", () => {
  const tier = provenanceChipFor("cache is a kind of component (source: ace:chat:abc@2026-01-01T00:00:00.000Z)", { miss: false, via: "template" }, provBucketFor);
  assert.equal(tier, "taught");
});

test("provenanceChipFor: an entailed citation reads as entailed", () => {
  const tier = provenanceChipFor("rex is a kind of mammal (source: entailed:subclass-transitivity)", { miss: false, via: "template" }, provBucketFor);
  assert.equal(tier, "entailed");
});

test("provenanceChipFor: a proof chain with a mix of citations reads as taught — taught wins over entailed and corpus, mirroring provBucketFor's own precedence", () => {
  const answer = "yes — rex is a kind of dog (source: teach:chat:abc@2026-01-01T00:00:00.000Z); so rex is a mammal (source: entailed:subclass-transitivity)";
  assert.equal(provenanceChipFor(answer, { miss: false, via: "template" }, provBucketFor), "taught");
});

test("provenanceChipFor: a chain of entailed-then-corpus citations (no taught) reads as entailed", () => {
  const answer = "x (source: entailed:rule-a); y (source: corpus:conceptnet)";
  assert.equal(provenanceChipFor(answer, { miss: false, via: "template" }, provBucketFor), "entailed");
});

test("provenanceChipFor: a teach-lane confirmation with no citation text still reads as taught, via record.via", () => {
  const tier = provenanceChipFor("noted — remembered: rex is a dog", { miss: false, via: "assert" }, provBucketFor);
  assert.equal(tier, "taught");
});

test("provenanceChipFor: an answer with no citation and no assert via carries no chip — nothing to badge, never a fabricated tier", () => {
  assert.equal(provenanceChipFor("focus set to rex.", { miss: false, via: "command" }, provBucketFor), null);
  assert.equal(provenanceChipFor("I don't do arithmetic — I answer questions about a code graph or taught facts.", { miss: false, via: "template" }, provBucketFor), null);
});

// ---- renderChatHtml: page structure -----------------------------------

test("renderChatHtml: mounts the chat engine bundle by a same-origin relative path only", () => {
  const html = renderChatHtml();
  assert.match(html, /<script src="\.\/chat-browser\.bundle\.js"><\/script>/);
  assert.ok(!/(?:src|href)=["']https?:/.test(html), "no external resource loads baked into the markup");
});

test("renderChatHtml: fetches the seed and reference-pack from same-origin paths, never a second engine", () => {
  const html = renderChatHtml();
  assert.match(html, /fetch\("\.\/chat-seed\.json"\)/);
  assert.match(html, /fetch\("\.\/reference-pack\/index\.json"\)/);
  assert.match(html, /window\.tmctChat\.createChatSession/);
  assert.match(html, /window\.tmctChat\.registerWinkModel/);
  assert.match(html, /window\.tmctChat\.registerReferencePackProvider/);
});

test("renderChatHtml: the composer (centered column, bottom-fixed input) markup is present", () => {
  const html = renderChatHtml();
  assert.match(html, /id="composer"/);
  assert.match(html, /id="composerInput"/);
  assert.match(html, /id="composerSend"/);
  assert.match(html, /id="messages"/);
  assert.match(html, /class="messages"/);
});

test("renderChatHtml: messages render as bubbles, distinguishing user from assistant", () => {
  const html = renderChatHtml();
  assert.match(html, /className = "bubble user"/);
  assert.match(html, /className = "bubble assistant/);
  assert.match(html, /addUserBubble/);
  assert.match(html, /addPendingAssistantBubble/);
});

test("renderChatHtml: the provenance-chip mechanism is wired end to end — the classifier, its three CSS-coded tiers, and a legend explaining them", () => {
  const html = renderChatHtml();
  assert.match(html, /provenanceChipFor/, "the classifier is spliced into the inline script");
  assert.match(html, /const provBucketFor = /, "the real ledger-viz.mjs classifier is spliced in, not reimplemented");
  for (const key of ["taught", "corpus", "entail"]) {
    assert.match(html, new RegExp(`\\.pc-${key} \\{`), `a CSS rule exists for the ${key} chip tier`);
  }
  assert.match(html, /className = "provchip pc-" \+ key/, "chip elements carry the shared provchip class");
  assert.match(html, /class="legend"/);
  assert.match(html, />you taught</);
  assert.match(html, />entailed</);
});

test("renderChatHtml: a miss renders with no chip and a distinct dashed/muted treatment, never a fabricated tier", () => {
  const html = renderChatHtml();
  assert.match(html, /bubble\.classList\.toggle\("miss", missed\)/);
  assert.match(html, /\.bubble\.assistant\.miss \{/);
});

test("renderChatHtml: the three trust tiers reuse viz-theme.mjs's own color tokens, never hand-duplicated hex values", () => {
  const html = renderChatHtml();
  assert.match(html, /--taught-soft/);
  assert.match(html, /--corpus-soft/);
  assert.match(html, /--entail-soft/);
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(html.replace(THEME_TOKENS_HEX_ALLOWANCE(html), "")), "no page-local hex color literal outside the imported token block");
});

// THEME_TOKENS_CSS itself legitimately contains hex literals (viz-theme.mjs's
// own token table) — strip that one block before checking the rest of the
// page never hand-rolls a color of its own.
function THEME_TOKENS_HEX_ALLOWANCE(html) {
  const start = html.indexOf(":root { color-scheme");
  const end = html.indexOf("</style>");
  return html.slice(start, end);
}

test("renderChatHtml: self-contained, both theme schemes present, reduced-motion respected", () => {
  const html = renderChatHtml();
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes('data-theme="dark"') && html.includes('data-theme="light"'));
  assert.ok(html.includes("prefers-reduced-motion"));
  assert.ok(!html.includes("color-mix("));
});

test("renderChatHtml: fits a narrow viewport — the legend hides rather than overflowing", () => {
  const html = renderChatHtml();
  assert.match(html, /max-width: 560px[\s\S]{0,80}\.legend \{ display: none; \}/);
});

test("renderChatHtml: escapes a custom title", () => {
  const html = renderChatHtml({ title: 'a <script>alert(1)</script> title' });
  assert.ok(!html.includes("<script>alert(1)</script> title"));
  assert.match(html, /&lt;script&gt;/);
});

test("renderChatHtml: deterministic — byte-identical output for identical input", () => {
  assert.equal(renderChatHtml(), renderChatHtml());
});

test("renderChatHtml: exposes window.tmctChatReady, the same boot-readiness hook the embedded widget's own e2e tests wait on", () => {
  const html = renderChatHtml();
  assert.match(html, /window\.tmctChatReady = boot\(\)/);
});
