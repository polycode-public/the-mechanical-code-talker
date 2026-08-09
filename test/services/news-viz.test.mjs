// news-viz: renderNewsHtml structural pins — the dashboard tiles, the
// controls row, the request log, the two fixture-replay demo buttons, and
// the consent gate's own promise that every third-party URL this page names
// sits inside one fenced block.
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
    "feed.items", "terms.ungrounded", "facts.from-news", "graph.size", "sources.live",
    "terms.ranked", "sources.per-source",
  ];
  for (const label of labels) {
    assert.ok(html.includes(`>${label}<`), `dashboard carries a tile labelled "${label}"`);
  }
});

test("renderNewsHtml: the start button, the request log, and the controls row all render", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="newsStart"[^>]*>start polling live sources</);
  assert.match(html, /id="requestLog"/);
  assert.match(html, /id="pollInterval"/);
  assert.match(html, /id="stopForget"[^>]*>stop &amp; forget</);
  assert.match(html, /id="enrichNow"/);
  assert.match(html, /id="addSourceUrl"/);
  assert.match(html, /id="addSourceBtn"/);
});

test("renderNewsHtml: poll once ships alongside start, and stop polling ships disabled until there is something to stop", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="pollOnce"[^>]*>poll once</, "the poll-once button is in the markup, not conditional on any state");
  assert.match(html, /id="stopPolling"[^>]*>stop polling</, "the stop control is in the markup too");
  assert.match(html, /id="stopPolling" disabled/, "it starts disabled — nothing is polling on a first paint");
  assert.match(html, /session\.pollOnce\(\)/, "poll once runs one cycle and schedules nothing");
  assert.match(html, /session\.stopPolling\(\)/, "stop polling calls the session's own stop");
  assert.match(html, /session\.busy \|\| session\.nextPollAt/, "the stop control is live while a cycle runs or a timer is armed");
});

test("renderNewsHtml: the two named fixture-replay demo buttons render", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="replayNyt"[^>]*>replay recorded NYT sample</);
  assert.match(html, /id="replayWikipedia"[^>]*>replay recorded Wikipedia sample</);
});

test("renderNewsHtml: the two teach-panel example buttons render, and the panel takes a .jsonl file", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="exampleProse"[^>]*>example: prose</);
  assert.match(html, /id="exampleJsonl"[^>]*>example: facts \(\.jsonl\)</);
  assert.match(html, /accept="\.txt,\.md,\.json,\.jsonl"/);
});

test("renderNewsHtml: an untrusted title never breaks out of its element", () => {
  const html = renderNewsHtml({ title: '</title><script>alert(1)</script>' });
  assert.ok(!html.includes("<script>alert(1)</script>"), "the title's own markup never lands unescaped");
  assert.ok(html.includes("&lt;/title&gt;&lt;script&gt;"), "the title is escaped in place");
});

test("renderNewsHtml: an untrusted seed stamp lands only inside a JSON string literal, never breaking the script", () => {
  const html = renderNewsHtml({ seedStamp: '";document.title="pwned";"' });
  assert.ok(!html.includes('";document.title="pwned";"'), "the raw stamp never appears unescaped");
  assert.ok(html.includes(JSON.stringify('";document.title="pwned";"')), "it lands as a JSON-escaped string literal instead");
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

test("renderNewsHtml: the sources block lists every registered source once, toggle plus homepage plus status", () => {
  const html = renderNewsHtml();
  for (const id of ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"]) {
    assert.match(html, new RegExp(`data-source-id="${id}"`), `source "${id}" has a toggle row`);
  }
});

test("renderNewsHtml: the sources block separates the polled news feeds from the reference works, every news feed ticked", () => {
  const html = renderNewsHtml();
  const pollRoster = html.slice(html.indexOf('id="pollRoster"'), html.indexOf('id="lookupRoster"'));
  const lookupRoster = html.slice(html.indexOf('id="lookupRoster"'));
  assert.match(html, /news feeds — polled when you press start or poll once/);
  assert.match(html, /reference works — looked up to explain a term, never polled/);
  for (const id of ["wikimedia-featured", "hacker-news", "usgs-quakes", "nyt-world", "wikinews-published"]) {
    assert.match(pollRoster, new RegExp(`data-source-id="${id}"`), `"${id}" sits in the poll roster`);
    assert.match(
      pollRoster,
      new RegExp(`value="${id}" checked`),
      `"${id}" is ticked to poll on a first visit`,
    );
  }
  for (const id of ["simple-wikipedia", "wikidata", "wiktionary", "dbpedia-lookup", "english-wikipedia"]) {
    assert.match(lookupRoster, new RegExp(`data-source-id="${id}"`), `"${id}" sits in the lookup roster`);
    assert.ok(!pollRoster.includes(`data-source-id="${id}"`), `"${id}" is never offered as a poll target`);
  }
});

test("renderNewsHtml: a card's collapsed background line renders only when backgroundParagraph is non-empty, labelled 'what the graph already knew'", () => {
  const html = renderNewsHtml();
  assert.match(html, /details class="background"/, "the collapsed background block's own markup is in the inline script");
  assert.match(html, /what the graph already knew/, "the collapsed line's own label is present");
  assert.match(html, /item\.backgroundParagraph\s*\?/, "the block is conditional on the item actually carrying background content");
});

test("renderNewsHtml: the empty feed state names what the feed actually shows and how to fill it, never the retired seed-fallback line", () => {
  const html = renderNewsHtml();
  assert.match(html, /id="feedEmpty"[^>]*>no news yet/, "the feed pane's own empty state carries the entity-anchored design copy");
  assert.ok(!html.includes("the seed graph builds the first ones"), "the concept-card fallback's own line has retired with it");
});

test("renderNewsHtml: the empty state hides itself the moment a card is on screen, whether from a first render or a later poll", () => {
  const html = renderNewsHtml();
  assert.match(html, /emptyEl\.hidden\s*=\s*shown\.length\s*>\s*0/, "paintFeed hides #feedEmpty whenever any card matches the active filters");
  assert.match(html, /el\("feedEmpty"\)\.hidden\s*=\s*true/, "a card appended straight off a poll also hides the empty state on its own");
});
