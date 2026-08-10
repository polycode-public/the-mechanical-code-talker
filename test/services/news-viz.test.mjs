// news-viz: renderNewsHtml structural pins — the dashboard tiles, the thin
// controls row (start, enrich, stop & forget — no client-side engine or
// recurring timer left to control), the request log, the privacy copy, the
// unavailable banner, and the consent gate's own promise that every
// third-party URL this page names sits inside one fenced block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNewsHtml } from "../../src/services/news-viz.mjs";

test("renderNewsHtml: carries the standard meta marker pair once each", () => {
  const html = renderNewsHtml();
  assert.equal((html.match(/<meta charset="utf-8">/g) || []).length, 1);
  assert.equal((html.match(/<meta name="viewport"/g) || []).length, 1);
});

test("renderNewsHtml: exactly one h1, and the eyebrow renders before it as a sibling", () => {
  const html = renderNewsHtml();
  const h1s = [...html.matchAll(/<h1[^>]*>/g)];
  assert.equal(h1s.length, 1, "exactly one h1 on the page");
  const eyebrowIdx = html.indexOf('<div class="eyebrow">');
  assert.ok(eyebrowIdx !== -1 && eyebrowIdx < html.indexOf("<h1"), "the eyebrow renders before the h1");
});

test("renderNewsHtml: the dashboard carries all seven labelled tiles/panels", () => {
  const html = renderNewsHtml();
  const labels = [
    "feed.items", "terms.ungrounded", "facts.from-news", "graph.size", "sources.reporting",
    "terms.ranked", "sources.per-source",
  ];
  for (const label of labels) {
    assert.ok(html.includes(`>${label}<`), `dashboard carries a tile labelled "${label}"`);
  }
});

test("renderNewsHtml: the thin controls row renders start, enrich and stop & forget, and carries no recurring-poll or add-source control", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="newsStart"[^>]*>start polling live sources</);
  assert.match(html, /id="enrichNow"[^>]*>enrich now</);
  assert.match(html, /id="stopForget"[^>]*>stop &amp; forget</);
  assert.match(html, /id="requestLog"/);
  for (const goneId of ["pollOnce", "stopPolling", "pollInterval", "addSourceUrl", "addSourceBtn", "replayNyt", "replayWikipedia"]) {
    assert.ok(!html.includes(`id="${goneId}"`), `the in-page engine's own "${goneId}" control has left the page`);
  }
});

test("renderNewsHtml: every control the page fires talks to the session's own trigger verbs, never an in-page engine call", () => {
  const html = renderNewsHtml();
  assert.match(html, /session\.start\(/, "start mints the session and polls");
  assert.match(html, /session\.enrich\(\{/, "enrich now runs its own trigger");
  assert.match(html, /session\.revokeConsent\(\)/, "stop & forget purges through the session");
  assert.match(html, /session\.ingestText\(/, "the teach panel's prose path posts the ingest trigger");
  assert.match(html, /session\.ingestRows\(/, "the teach panel's row path posts the ingest trigger");
  assert.match(html, /session\.fetchFeed\(\)/, "the page reads the materialized feed rather than building one");
});

test("renderNewsHtml: a fuzzy toggle sits beside enrich now, checked by default, and rides the enrich trigger's body", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="fuzzyToggle"[^>]*checked/, "the fuzzy toggle defaults on, matching the shipped retrieval default");
  assert.match(html, /fuzzy: fuzzy/, "the checkbox's own state rides the enrich call, not a hardcoded flag");
});

test("renderNewsHtml: the page subscribes to the session's standing feed-update loop and re-renders on it", () => {
  const html = renderNewsHtml();
  assert.match(html, /session\.onFeedUpdate\(/, "the page subscribes to the standing refresh loop rather than running its own timer");
});

test("renderNewsHtml: start, enrich and teach ingest each report cycle progress through onCycle", () => {
  const html = renderNewsHtml();
  const onCycleCalls = (html.match(/onCycle: renderCycleProgress/g) || []).length;
  assert.equal(onCycleCalls, 4, "start, enrich, ingestRows and ingestText each thread the same progress callback");
});

test("renderNewsHtml: the teach panel's two example buttons render, and the file drop takes .txt/.md/.jsonl only", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="exampleProse"[^>]*>example: prose</);
  assert.match(html, /id="exampleJsonl"[^>]*>example: facts \(\.jsonl\)</);
  assert.match(html, /accept="\.txt,\.md,\.jsonl"/);
});

test("renderNewsHtml: the privacy copy states the anonymous session, the seven-day expiry and stop & forget's own promise, with no local-persistence claim", () => {
  const html = renderNewsHtml();
  assert.match(html, /anonymous/i);
  assert.match(html, /seven days/);
  assert.match(html, /[Ss]top & forget/);
  assert.ok(!/stays on this device|never (leaves|sent anywhere)/i.test(html), "news.html makes the server-side promise, never chat.html's local-only one");
});

test("renderNewsHtml: an unreachable-service banner exists, starts hidden, and disables the network-facing controls", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="serviceUnavailable"/);
  assert.match(html, /class="unavailable" id="serviceUnavailable"/, "the banner starts without the 'shown' class");
  assert.match(html, /setUnavailable/);
});

test("renderNewsHtml: the chat area sits after the teach panel, with an input, a send button and a log", () => {
  const html = renderNewsHtml();
  const teachIdx = html.indexOf('id="teachPanel"');
  const mountIdx = html.indexOf('id="chatMount"');
  assert.ok(teachIdx !== -1 && mountIdx > teachIdx, "the chat area sits after the teach panel");
  assert.match(html, /id="chatLog"/);
  assert.match(html, /id="chatInput"[^>]*disabled/, "chat starts disabled — no consent yet");
  assert.match(html, /id="chatSend"[^>]*disabled/, "the send button starts disabled too");
});

test("renderNewsHtml: the chat form posts through session.turn, never a fetch of its own", () => {
  const html = renderNewsHtml();
  assert.match(html, /session\.turn\(/, "the chat area talks to the session's own turn verb");
  assert.match(html, /chatForm.*addEventListener\("submit"/s, "the send button submits a form rather than firing its own click handler");
});

test("renderNewsHtml: a chat reply's text, its learned-fact citations and its trace all land through textContent, never innerHTML", () => {
  const html = renderNewsHtml();
  const chatSection = html.slice(html.indexOf("function chatBubble"), html.indexOf("function renderRequestLog"));
  assert.match(chatSection, /bubble\.textContent\s*=\s*text/, "a chat bubble's text is a text node, not markup");
  assert.match(chatSection, /li\.textContent\s*=\s*line/, "each learned-fact citation line is a text node");
  assert.match(chatSection, /pre\.textContent\s*=\s*result\.narration/, "the trace block's text is a text node");
  assert.ok(!chatSection.includes(".innerHTML"), "nothing in the chat rendering path builds markup from a string");
});

test("renderNewsHtml: chat stays disabled until start has been pressed at least once, then joins the shared unavailable posture", () => {
  const html = renderNewsHtml();
  assert.match(html, /updateChatAvailability/, "the chat gate has its own named function");
  assert.match(html, /!session\.consented \|\| session\.unavailable/, "chat needs both consent and a reachable service");
  const setUnavailableBody = html.slice(html.indexOf("function setUnavailable("), html.indexOf("function setUnavailable(") + 400);
  assert.match(setUnavailableBody, /updateChatAvailability\(\)/, "setUnavailable also updates chat's own gate");
});

test("renderNewsHtml: an untrusted title never breaks out of its element", () => {
  const html = renderNewsHtml({ title: '</title><script>alert(1)</script>' });
  assert.ok(!html.includes("<script>alert(1)</script>"), "the title's own markup never lands unescaped");
  assert.ok(html.includes("&lt;/title&gt;&lt;script&gt;"), "the title is escaped in place");
});

test("renderNewsHtml: every https:// this page names sits inside the one fenced sources block", () => {
  const html = renderNewsHtml();
  const startMarker = "<!-- sources:start -->";
  const endMarker = "<!-- sources:end -->";
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker) + endMarker.length;
  assert.ok(start !== -1 && end > start, "the fenced sources block exists");
  const before = html.slice(0, start);
  const after = html.slice(end);
  assert.equal((before.match(/https:\/\//g) || []).length, 0, "nothing before the block names a third party");
  assert.equal((after.match(/https:\/\//g) || []).length, 0, "nothing after the block names a third party");
  assert.ok(html.slice(start, end).includes("https://"), "the block itself does carry the source registry's real URLs");
});

test("renderNewsHtml: the sources block lists every registered source once, homepage plus status, and only the contemporary group carries a toggle", () => {
  const html = renderNewsHtml();
  const pollRoster = html.slice(html.indexOf('id="pollRoster"'), html.indexOf('id="lookupRoster"'));
  const lookupRoster = html.slice(html.indexOf('id="lookupRoster"'), html.indexOf("<!-- sources:end -->"));
  for (const id of ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"]) {
    assert.match(pollRoster, new RegExp(`data-source-id="${id}"`), `"${id}" sits in the poll roster`);
    assert.match(pollRoster, new RegExp(`data-source-toggle value="${id}"`), `"${id}" carries a poll-narrowing checkbox`);
  }
  for (const id of ["simple-wikipedia", "wikidata", "wiktionary", "dbpedia-lookup", "english-wikipedia"]) {
    assert.match(lookupRoster, new RegExp(`data-source-id="${id}"`), `"${id}" sits in the lookup roster`);
    assert.ok(!lookupRoster.includes("data-source-toggle"), "the reference-works group offers no checkbox — the worker's own lookup has no client-supplied roster");
    assert.ok(!pollRoster.includes(`data-source-id="${id}"`), `"${id}" is never offered as a poll target`);
  }
});

test("renderNewsHtml: a card's collapsed background line renders only when backgroundParagraph is non-empty, labelled 'what the graph already knew'", () => {
  const html = renderNewsHtml();
  assert.match(html, /details class="background"/, "the collapsed background block's own markup is in the inline script");
  assert.match(html, /what the graph already knew/, "the collapsed line's own label is present");
  assert.match(html, /item\.backgroundParagraph\s*\?/, "the block is conditional on the item actually carrying background content");
});

test("renderNewsHtml: a card renders straight from factLines/factCount, never from a raw fact row lookup", () => {
  const html = renderNewsHtml();
  assert.match(html, /item\.factLines/, "the fact list reads the document's own pre-rendered lines");
  assert.match(html, /item\.factCount/, "the count line reads the document's own count, honest about a trim");
  assert.ok(!html.includes("factRows("), "no client-side call ever asks for a raw fact row");
});

test("renderNewsHtml: the empty feed state names what the feed actually shows and how to fill it", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="feedEmpty"[^>]*>no news yet/, "the feed pane's own empty state carries the entity-anchored design copy");
});

test("renderNewsHtml: the empty state hides itself the moment a card is on screen", () => {
  const html = renderNewsHtml();
  assert.match(html, /emptyEl\.hidden\s*=\s*shown\.length\s*>\s*0/, "paintFeed hides #feedEmpty whenever any card matches the active filters");
});

test("renderNewsHtml: start reverts the empty state to its default copy, so a poll that reports nothing after a purge never keeps showing the purge line", () => {
  const html = renderNewsHtml();
  const startHandler = html.slice(html.indexOf("startBtn.addEventListener"), html.indexOf('el("enrichNow").addEventListener'));
  assert.match(startHandler, /emptyFeedText\s*=\s*DEFAULT_EMPTY_FEED_TEXT/, "start reverts the empty-feed copy before its own press runs");
});
