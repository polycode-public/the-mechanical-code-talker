// The hand-maintained homepage (public/index.html, git-tracked, with only its
// version stamp generated): five fully-expanded sections (chat, the
// spider-and-fly hero, the CLI docs, the codebase demo, the library docs)
// followed by an "explore more" band of link cards onto
// plan.html/adventure.html/ledger.html/sprites.html. The chat and
// spider-and-fly sections are a screenshot plus a link, not a live embed —
// two live engines booting inside the homepage cost multi-MB loads and
// competed for attention with the page's own copy. A static, no-browser
// structural check; pages-home.test.mjs covers the same page with a real
// browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));

test("the homepage shows a chat screenshot (not a live embed) with a full-screen link to chat.html", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.doesNotMatch(html, /<div id="tmct-chat" data-demo-state="idle">/, "the old live chat widget is gone");
  const shotStart = html.indexOf("<h2>Chat</h2>");
  const shotEnd = html.indexOf("<h2>Multiple competing", shotStart);
  const section = html.slice(shotStart, shotEnd);
  assert.match(section, /<div class="hero-shot">/, "a screenshot-and-link block replaces the old embed");
  assert.match(section, /<img src="\.\/screenshots\/chat\.png"/, "the chat screenshot is shown");
  assert.match(section, /<a href="\.\/chat\.html">open full-screen/, "the chat section links to the full page");
});

test("the homepage shows a spider-and-fly screenshot (not a live iframe) with a full-screen link", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.doesNotMatch(html, /<iframe/, "no page is embedded live in an iframe");
  const shotStart = html.indexOf("<h2>Multiple competing planning agents</h2>");
  const shotEnd = html.indexOf("<h2>Run the chat yourself</h2>", shotStart);
  const section = html.slice(shotStart, shotEnd);
  assert.match(section, /<div class="hero-shot">/, "a screenshot-and-link block replaces the old embed");
  assert.match(section, /<img src="\.\/screenshots\/spider-fly\.png"/, "the spider-fly screenshot is shown");
  assert.match(section, /<a href="\.\/spider-fly\.html">open full-screen/);
});

test("the five fully-expanded sections render in the exact order the reorg specifies", async () => {
  const html = await readFile(INDEX, "utf8");
  const talkToIt = html.indexOf("<h2>Chat</h2>");
  const twoAgents = html.indexOf("<h2>Multiple competing planning agents</h2>");
  const runItYourself = html.indexOf("<h2>Run the chat yourself</h2>");
  const askCodebase = html.indexOf('<div class="demo-wrap">');
  const useAsLibrary = html.indexOf("<h2>Use it as a library</h2>");
  const exploreBand = html.indexOf('<div class="explore-grid">');
  const footer = html.indexOf("<footer>");
  assert.ok(
    [talkToIt, twoAgents, runItYourself, askCodebase, useAsLibrary, exploreBand, footer].every((i) => i !== -1),
    "every section and the explore band and the footer are present",
  );
  assert.ok(
    talkToIt < twoAgents && twoAgents < runItYourself && runItYourself < askCodebase
      && askCodebase < useAsLibrary && useAsLibrary < exploreBand && exploreBand < footer,
    "chat, multiple competing planning agents, run it yourself, ask about a codebase, use it as a library, explore band, footer — in that order",
  );
});

test('"What an answer looks like" is gone: no transcript block, no leftover heading', async () => {
  const html = await readFile(INDEX, "utf8");
  assert.doesNotMatch(html, /What an answer looks like/);
  assert.doesNotMatch(html, /<pre class="transcript"/);
  assert.doesNotMatch(html, /class="ledger-hero"/, "the ledger hero embed is gone (demoted to a link card)");
  assert.doesNotMatch(html, /class="plan-render"/, "the plan hero embed is gone (demoted to a link card)");
  assert.doesNotMatch(html, /class="adventure-hero"/, "the adventure hero embed is gone (demoted to a link card)");
});

test("the explore band lists exactly six link cards — plan/adventure/ledger/code explorer/ingest/sprites — in that order", async () => {
  const html = await readFile(INDEX, "utf8");
  const band = html.slice(html.indexOf('<div class="explore-grid">'), html.indexOf("<footer>"));
  const hrefs = [...band.matchAll(/<a class="explore-card[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    "./plan.html",
    "./adventure.html",
    "./ledger.html",
    "./code.html",
    "./ingest.html",
    "./sprites.html",
  ]);
  assert.match(band, /It plans, and shows the work/);
  assert.match(band, /Location aware inference/);
  assert.match(band, /The memory ledger/);
  assert.match(band, /Code explorer/);
  assert.doesNotMatch(band, /explore-card-desktop/, "the code-explorer card is a normal hosted-page card, not visually distinct");
  assert.match(band, /Bring your own text/);
  assert.match(band, /Sprite library/);
});

test("the sprite-library card carries a real sprite teaser: real inline icons and their real ancestor-chain text", async () => {
  const html = await readFile(INDEX, "utf8");
  const cardStart = html.indexOf('href="./sprites.html"');
  const cardEnd = html.indexOf("</a>", cardStart);
  const card = html.slice(cardStart, cardEnd);
  assert.match(card, /<div class="sprite-teaser">/, "the sprite-library card has a visual teaser, not just a bare link");
  const svgCount = [...card.matchAll(/<svg viewBox="0 0 24 24"/g)].length;
  assert.ok(svgCount >= 3, `expected at least 3 real sprite icons inlined, found ${svgCount}`);
  // Real rdfs:subClassOf ancestor chains (src/domain/sprite-map.mjs's classAncestorChain
  // over the spider-and-fly world's own seed taxonomy), never an invented relation.
  assert.match(card, /poodle.*dog.*animal/s);
  assert.match(card, /spider.*arachnid.*animal/s);
  assert.match(card, /fly.*insect.*animal/s);
});

test("the CSS custom-property tokens match src/services/viz-theme.mjs's own token names", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /--ink: #23272B/, "the fg token is renamed to viz-theme's --ink");
  assert.match(html, /--taught: #2E7D4F/, "the accent token is renamed to viz-theme's --taught");
  assert.match(html, /--line: #DDD9D0/, "the border token is renamed to viz-theme's --line");
  assert.doesNotMatch(html, /--fg:/, "the old --fg token name is gone");
  assert.doesNotMatch(html, /--accent:/, "the old --accent token name is gone");
  assert.doesNotMatch(html, /--border:/, "the old --border token name is gone");
});
