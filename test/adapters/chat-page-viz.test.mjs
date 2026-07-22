// chat-page-viz: renderChatHtml is a pure string builder — no engine state is
// embedded (it all arrives live via the sibling chat-browser.bundle.js,
// exactly as the home page's own embedded widget works), so these tests pin
// the page's STRUCTURE (mirroring spider-fly-viz.test.mjs's own style) plus
// provenanceChipFor, the pure classifier this page's signature element (the
// per-message provenance chip) is built on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderChatHtml, provenanceChipFor, loadProgressLine, transcriptMarkdown } from "../../src/services/chat-page-viz.mjs";
import { provBucketFor } from "../../src/services/ledger-viz.mjs";
import { sessionLogHeaderMarkdown, sessionLogTurnMarkdown } from "../../src/services/session-log-format.mjs";

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

test("renderChatHtml: fetches the seed, wink vendor asset and reference-pack from same-origin paths, never a second engine", () => {
  const html = renderChatHtml();
  assert.match(html, /fetchWithProgress\("\.\/chat-seed\.json"/);
  assert.match(html, /fetchWithProgress\("\.\/vendor\/wink\.js"/);
  assert.match(html, /fetch\("\.\/reference-pack\/index\.json"\)/);
  assert.match(html, /window\.tmctChat\.createChatSession/);
  assert.match(html, /window\.tmctChat\.registerWinkModel/);
  assert.match(html, /window\.tmctChat\.registerReferencePackProvider/);
});

test("renderChatHtml: registers the site service worker, tolerating its absence", () => {
  const html = renderChatHtml();
  assert.match(html, /navigator\.serviceWorker\.register\("\.\/tmct-sw\.js"\)\.catch/);
});

// ---- loadProgressLine: the boot statusline's pure aggregator --------------

test("loadProgressLine: sums loaded and total bytes across assets into one MB line", () => {
  const line = loadProgressLine([
    { loaded: 524288, total: 1048576 },
    { loaded: 1048576, total: 3145728 },
  ]);
  assert.equal(line, "loading the engine… 1.5 MB / 4.0 MB");
});

test("loadProgressLine: with any total unknown, shows loaded bytes alone rather than inventing a denominator", () => {
  assert.equal(loadProgressLine([{ loaded: 1048576, total: 0 }]), "loading the engine… 1.0 MB");
  assert.equal(loadProgressLine([{ loaded: 1048576, total: 2097152 }, { loaded: 100, total: 0 }]), "loading the engine… 1.0 MB");
});

test("loadProgressLine: an empty part list reads as zero loaded, never a crash", () => {
  assert.equal(loadProgressLine([]), "loading the engine… 0.0 MB");
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

test("renderChatHtml: the live-Wikipedia switch renders under the composer — a real checkbox with switch semantics and its plain-words label", () => {
  const html = renderChatHtml();
  assert.match(html, /class="composer-tools"/);
  assert.match(html, /<input type="checkbox" id="liveToggle" role="switch" aria-label="ask Wikipedia when I don't know">/);
  assert.match(html, />ask Wikipedia when I don&#8217;t know</);
  assert.ok(!html.includes('id="liveToggle" checked'), "the switch ships unchecked — live lookups are opt-in");
  assert.match(html, /class="toggle-track"/, "the pill track renders");
  assert.match(html, /#liveToggle:checked ~ \.toggle-track \{ background: var\(--corpus\)/, "the checked track tints with the corpus token");
  const title = html.match(/label class="liveLabel" title="([^"]+)"/)?.[1] ?? "";
  assert.match(title, /Off by default/);
  assert.match(title, /two small requests/);
  assert.match(title, /CC BY-SA/);
});

test("renderChatHtml: the switch is wired to the session and the stored preference, and the statusline reports the live state", () => {
  const html = renderChatHtml();
  assert.match(html, /"tmct\.chat\.liveWikipedia"/, "the preference persists under its own localStorage key");
  assert.match(html, /setLiveReference\(liveToggleEl\.checked\)/, "a flip reaches the running session");
  assert.match(html, /liveToggleEl\.checked = readLivePref\(\)/, "boot restores the stored preference before the session starts");
  assert.match(html, /onLiveLookup: function \(\) \{ statusEl\.textContent = "searching wikipedia\\u2026"; \}/, "an in-flight lookup announces itself on the statusline");
  assert.match(html, /"live wikipedia: " \+ \(liveToggleEl\.checked \? "on" : "off"\)/, "the statusline names the live state");
});

// ---- transcriptMarkdown: the export document, built from the model, in the
// SAME shape session-log-format.mjs's Node writer renders (chat-session.mjs's
// own .tmct/session-<id>.md) — a title, one heading per PAIRED turn, the
// question as a blockquote, the answer in a fenced block.

test("transcriptMarkdown: a title naming version+session, then every turn in order as a heading/blockquote/fence", () => {
  const md = transcriptMarkdown(
    [
      { role: "you", text: "what is a dog", ts: 1000 },
      { role: "tmct", text: "dog is a kind of animal (source: corpus:conceptnet)", chipTier: "corpus", ts: 1010 },
      { role: "you", text: "what is a zorblatt", ts: 2000 },
      { role: "tmct", text: 'I don\'t know "zorblatt" yet.', chipTier: null, ts: 2010 },
    ],
    { version: "2.9.1", sessionId: "019f8692-abcd-abcd-abcd-abcdabcdabcd" },
    sessionLogHeaderMarkdown, sessionLogTurnMarkdown,
  );
  assert.match(md, /^# tmct chat 2\.9\.1 — session 019f8692\n/);
  const t1At = md.indexOf("### ");
  const youAt = md.indexOf("> what is a dog");
  const tmctAt = md.indexOf("dog is a kind of animal");
  const t2At = md.indexOf("> what is a zorblatt");
  const missAt = md.indexOf('I don\'t know "zorblatt" yet.');
  assert.ok(t1At > 0 && youAt > t1At && tmctAt > youAt && t2At > tmctAt && missAt > t2At, "turns appear in conversation order, each under its own heading");
});

test("transcriptMarkdown: an unanswered trailing question (export mid-turn) still renders, with an empty fenced block", () => {
  const md = transcriptMarkdown(
    [{ role: "you", text: "still thinking", ts: 1000 }],
    { version: "dev", sessionId: "" },
    sessionLogHeaderMarkdown, sessionLogTurnMarkdown,
  );
  assert.match(md, /> still thinking\n\n```text\n```\n\n$/);
});

test("transcriptMarkdown: with no meta at all, the title still renders (dev version), never a crash", () => {
  assert.match(transcriptMarkdown([], {}, sessionLogHeaderMarkdown, sessionLogTurnMarkdown), /^# tmct chat dev — session \n/);
  assert.match(transcriptMarkdown(null, null, sessionLogHeaderMarkdown, sessionLogTurnMarkdown), /^# tmct chat dev — session \n/);
});

// ---- export + print wiring on the page -------------------------------------

test("renderChatHtml: export and print controls sit in the composer's tools row as non-submitting buttons", () => {
  const html = renderChatHtml();
  assert.match(html, /class="composer-tools"/);
  assert.match(html, /<button type="button" id="exportMd"/);
  assert.match(html, /<button type="button" id="printChat"/);
});

test("renderChatHtml: export and print read the transcript MODEL, never scraped bubbles", () => {
  const html = renderChatHtml();
  assert.match(html, /const transcript = \[\];/);
  assert.match(html, /transcript\.push\(\{ role: "you"/);
  assert.match(html, /transcript\.push\(\{ role: "tmct", text: answer, chipTier: tier/);
  assert.match(html, /const sessionLogHeaderMarkdown = /, "the shared session-log header builder is spliced in");
  assert.match(html, /const sessionLogTurnMarkdown = /, "the shared session-log turn builder is spliced in");
  assert.match(html, /const transcriptMarkdown = /, "the pure builder is spliced in, not reimplemented");
  assert.match(html, /transcriptMarkdown\(transcript, \{ version: siteVersion, sessionId: sessionId \}, sessionLogHeaderMarkdown, sessionLogTurnMarkdown\)/);
  assert.match(html, /download = "tmct-chat\.md"/);
  assert.match(html, /window\.print\(\)/);
});

test("renderChatHtml: a print stylesheet un-pins the message column and drops the interactive chrome", () => {
  const html = renderChatHtml();
  const printBlock = html.slice(html.indexOf("@media print"), html.indexOf("</style>"));
  assert.ok(printBlock.length > 0, "an @media print block exists");
  assert.match(printBlock, /main\.chatMain \{ overflow: visible; height: auto; \}/);
  assert.match(printBlock, /form\.composer, \.statusline, \.statsPanel, \.legend \{ display: none; \}/);
});

// ---- persistence wiring: the page keeps taught state on the device ---------

test("renderChatHtml: the device store opens under a version+seed stamp and boot tries a restore before falling back to the fresh seed", () => {
  const html = renderChatHtml();
  assert.match(html, /openPersistedStore\(\{ storeKey: "chat", stamp: siteVersion \+ ":" \+ seedFacts \}\)/);
  assert.match(html, /persist\.load\(\)/);
  assert.match(html, /Restored " \+ restoredCount \+ " taught fact/, "the boot line names how many taught facts came back");
  assert.match(html, /state kept best-effort on this device/);
});

test("renderChatHtml: any store-writing turn schedules a debounced save of a payload snapshot, never a save per keystroke or of the live object", () => {
  const html = renderChatHtml();
  // Persist on any store write (teach OR a learn-on-miss load), not just a
  // teach turn; only pure commands, which write nothing, stay out.
  assert.match(html, /result\.record\.via !== "command"\) scheduleSave\(\)/);
  assert.match(html, /structuredClone\(session\.memoryDir\.payload\)/);
  assert.match(html, /setTimeout\(\(\) => \{[\s\S]*?persist\.save/, "the save runs on a timer, not inline in the turn");
  assert.match(html, /\}, 500\)/, "the debounce window is present");
});

test("renderChatHtml: the forget-everything control clears the device store and rebuilds from the fresh seed", () => {
  const html = renderChatHtml();
  assert.match(html, /id = "forgetEverything"/);
  assert.match(html, /persist\.clear\(\)/);
  assert.match(html, /forgot everything taught on this device/);
});

test("renderChatHtml: the brand line renders as typed — lowercase, single element, no heading beside it", () => {
  const html = renderChatHtml();
  assert.ok(html.includes('<span class="eyebrow">the-mechanical-code-talker</span>'));
  assert.ok(!html.includes("<h1>"));
  const eyebrowRule = html.match(/\.eyebrow \{[^}]*\}/)?.[0] ?? "";
  assert.ok(!eyebrowRule.includes("text-transform"), "eyebrow must not transform the brand's case");
});
