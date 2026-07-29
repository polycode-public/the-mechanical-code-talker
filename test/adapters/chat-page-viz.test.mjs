// chat-page-viz: renderChatHtml is a pure string builder — no engine state is
// embedded (it all arrives live via the sibling chat-browser.bundle.js,
// exactly as the home page's own embedded widget works), so these tests pin
// the page's STRUCTURE (mirroring spider-fly-viz.test.mjs's own style) plus
// provenanceChipFor, the pure classifier this page's signature element (the
// per-message provenance chip) is built on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderChatHtml, provenanceChipFor, loadProgressLine, transcriptMarkdown, parseResearchAnswer } from "../../src/services/chat-page-viz.mjs";
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

test("renderChatHtml: the research affordance is present — topic entry, go, a play/pause control over the shared ticker, submitted through the one turn path", () => {
  const html = renderChatHtml();
  assert.match(html, /id="researchTopic"/);
  assert.match(html, /id="researchGo"/);
  assert.match(html, /id="researchPlay"/);
  assert.match(html, /id="researchQueueStatus"/);
  assert.match(html, /const createTicker = /, "the shared viz-ticker verbs are spliced in, not reimplemented");
  assert.match(html, /const prefersReducedMotion = /, "reduced motion gates the auto-play");
  assert.match(html, /submitLine\("research next"\)/, "each auto-played step is asked exactly as a typed turn");
  assert.match(html, /Simple English Wikipedia/, "the control says where the fetches go before anyone clicks");
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
  // A numeric HTML entity (e.g. &#128075; for the wave button's hand emoji)
  // can have an all-hex-digit body by coincidence — strip entities before
  // checking, the same way the token block itself is stripped, so a real
  // duplicated color and an emoji reference are never confused.
  const stripped = html.replace(THEME_TOKENS_HEX_ALLOWANCE(html), "").replace(/&#\d+;/g, "");
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(stripped), "no page-local hex color literal outside the imported token block");
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
  // The network chrome (state pill, wave, invite, help) added a row of
  // controls the legend now competes with, so the legend goes first at a
  // wider breakpoint than it used to — the legend is decorative, the
  // controls are not, so it's dropped rather than folding them onto a
  // second row. 560px is narrower still and now only re-flows the bubbles.
  assert.match(html, /max-width: 1360px[\s\S]{0,220}\.legend \{ display: none; \}/);
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

test("renderChatHtml: the wiki-mode radio group renders under the composer — off/miss/always, off checked by default", () => {
  const html = renderChatHtml();
  assert.match(html, /class="composer-wiki"/);
  assert.match(html, /<fieldset class="wikiMode" id="wikiMode"/);
  assert.match(html, /<input type="radio" name="wikiMode" id="wikiOff" value="off" checked>/, "off ships checked — live lookups are opt-in");
  assert.match(html, /<input type="radio" name="wikiMode" id="wikiMiss" value="miss">/);
  assert.match(html, /<input type="radio" name="wikiMode" id="wikiAlways" value="always">/);
  assert.ok(!html.includes('id="wikiMiss" checked') && !html.includes('id="wikiAlways" checked'), "only off ships checked");
  const title = html.match(/fieldset class="wikiMode" id="wikiMode" title="([^"]+)"/)?.[1] ?? "";
  assert.match(title, /Off by default/);
  assert.match(title, /two small requests/);
  assert.match(title, /CC BY-SA/);
});

test("renderChatHtml: the synthesis slider renders next to the wiki radios, default budget 12", () => {
  const html = renderChatHtml();
  assert.match(html, /synthesize from wikipedia: <span id="synthValue" class="mono">12<\/span>/);
  assert.match(html, /<input type="range" id="synthSlider" min="0" max="24" step="4" value="12">/);
});

test("renderChatHtml: the radio group is wired to the session and the stored preference, with legacy migration", () => {
  const html = renderChatHtml();
  assert.match(html, /"tmct\.chat\.wikiMode"/, "the mode persists under its own localStorage key");
  assert.match(html, /"tmct\.chat\.liveWikipedia"/, "the legacy key is still read, for migration");
  assert.match(html, /if \(localStorage\.getItem\(LEGACY_LIVE_PREF_KEY\) === "on"\) return "miss";/, "a legacy \"on\" preference migrates to the miss mode");
  assert.match(html, /window\.tmctChatSession\.setLiveReference\(liveReferenceForMode\(mode\)\)/, "a flip reaches the running session");
  assert.match(html, /const initialMode = readWikiMode\(\);/, "boot restores the stored mode before the session starts");
  assert.match(html, /onLiveLookup: function \(\) \{ statusEl\.textContent = "searching wikipedia\\u2026"; \}/, "an in-flight lookup announces itself on the statusline");
  assert.match(html, /"live wikipedia: " \+ liveStatusWord\(liveReference\)/, "the statusline names the live state");
});

test("renderChatHtml: setLiveReference(false|true|\"always\") is exactly what the three radio values map to", () => {
  const html = renderChatHtml();
  assert.match(html, /const liveReferenceForMode = \(mode\) => \(mode === "always" \? "always" : mode === "miss"\);/);
});

test("renderChatHtml: the synthesis slider is wired to setSynthesisBudget and its own storage key", () => {
  const html = renderChatHtml();
  assert.match(html, /"tmct\.chat\.synthBudget"/);
  assert.match(html, /window\.tmctChatSession\.setSynthesisBudget\(n\)/);
});

test("renderChatHtml: a /wiki supplement turn clears every radio rather than leaving a stale one checked", () => {
  const html = renderChatHtml();
  assert.match(html, /const mode = liveReference === "always" \? "always" : liveReference === true \? "miss" : liveReference === false \? "off" : null;/);
  assert.match(html, /setWikiModeRadios\(mode \|\| ""\);/);
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
  assert.match(html, /result\.record\.via !== "command"\) \{[\s\S]{0,20}scheduleSave\(\)/);
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

// ---- parseResearchAnswer: the researched panel's own reading of a settled
// research turn's answer text, off research.mjs's own renderResearchAnswer
// citation shape — never a second fetch.

test("parseResearchAnswer: pulls the passage, article title and source url out of a research turn's own cited answer", () => {
  const answer = 'owl — an owl is a bird of prey. (source: research article "Owl", Simple English Wikipedia, CC BY-SA 4.0 — https://simple.wikipedia.org/wiki/Owl?oldid=123)\nstored 2 facts from "Owl". queued 3 linked topics.';
  const parsed = parseResearchAnswer(answer);
  assert.deepEqual(parsed, {
    term: "owl",
    passage: "an owl is a bird of prey.",
    title: "Owl",
    url: "https://simple.wikipedia.org/wiki/Owl?oldid=123",
  });
});

test("parseResearchAnswer: a miss, a status line, or any text that isn't this citation shape reads as null, never a guessed passage", () => {
  assert.equal(parseResearchAnswer('I couldn\'t ground "zorblatt" from Simple English Wikipedia just now — no matching article. Nothing was stored.'), null);
  assert.equal(parseResearchAnswer('research on "owls" is complete — 3 topics grounded, 5 facts stored.'), null);
  assert.equal(parseResearchAnswer(""), null);
  assert.equal(parseResearchAnswer(undefined), null);
});

// ---- renderChatHtml: the researched-this-session panel ---------------------

test("renderChatHtml: a second docked section, seeded empty, sits alongside the memory stats — its own render survives a stats re-render rather than being wiped by it", () => {
  const html = renderChatHtml();
  assert.match(html, /id="statsPanelStats"/, "the stats panel moved into its own nested div");
  assert.match(html, /id="researchedPanel"/, "the researched panel is a SIBLING div, not nested inside the stats div");
  assert.match(html, /const statsPanelEl = el\("statsPanelStats"\);/);
  assert.match(html, /const researchedPanelEl = el\("researchedPanel"\);/);
});

test("renderChatHtml: the researched panel reads real fact rows through window.tmctChat.researchedFactRows, never re-deriving them from the answer text", () => {
  const html = renderChatHtml();
  assert.match(html, /window\.tmctChat\.researchedFactRows\(window\.tmctChatSession\.memoryDir\)/);
  assert.match(html, /const parseResearchAnswer = /, "the pure citation parser is spliced in, not reimplemented");
});

test("renderChatHtml: every settled, non-miss research turn is offered to the researched panel", () => {
  const html = renderChatHtml();
  assert.match(html, /await noteResearchLearned\(result\);/);
  assert.match(html, /if \(result\.research === undefined \|\| !result\.record \|\| result\.record\.miss\) return;/);
});

test("renderChatHtml: the researched panel renders its own heading and an honest empty state before anything has been researched", () => {
  const html = renderChatHtml();
  assert.match(html, /textContent: "researched this session"/);
  assert.match(html, /nothing yet — ask it to "research/);
});
