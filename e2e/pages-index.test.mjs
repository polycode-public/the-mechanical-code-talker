// The hand-maintained homepage (public/index.html, git-tracked, with only its
// version stamp generated). PLAN_GAMES_UPLIFT_V3.md Part C.2's reorg: five
// fully-expanded sections (the embedded chat, the spider-and-fly hero, the CLI
// docs, the codebase demo, the library docs) followed by an "explore more" band
// of link cards onto plan.html/adventure.html/ledger.html/sprites.html. Nothing
// else guards this structure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));

test("the homepage keeps the embedded chat exactly as before, and adds a full-screen link to chat.html", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /<div id="tmct-chat" data-demo-state="idle">/, "the live chat widget's own markup is untouched");
  assert.match(html, /<div class="chat-log" role="log" aria-live="polite"><\/div>/);
  assert.match(html, /<a href="\.\/chat\.html">open full-screen/, "the chat section gains a full-screen destination");
});

test("the homepage embeds the spider-and-fly hero unchanged: preview iframe onto spider-fly.html, a full-screen link", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /<div class="spider-fly-hero">/);
  assert.match(html, /<iframe src="\.\/spider-fly\.html\?preview=1"/, "the embedded preview asks for the page's own non-interactive auto-play mode");
  assert.match(html, /<a href="\.\/spider-fly\.html">open full-screen/);
});

test("the five fully-expanded sections render in the exact order the reorg specifies", async () => {
  const html = await readFile(INDEX, "utf8");
  const talkToIt = html.indexOf('<div class="chat-hero">');
  const twoAgents = html.indexOf('<div class="spider-fly-hero">');
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
    "talk to it, two agents, run it yourself, ask about a codebase, use it as a library, explore band, footer — in that order",
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

test("the explore band lists exactly four link cards, onto plan/adventure/ledger/sprites, in that order", async () => {
  const html = await readFile(INDEX, "utf8");
  const band = html.slice(html.indexOf('<div class="explore-grid">'), html.indexOf("<footer>"));
  const hrefs = [...band.matchAll(/<a class="explore-card[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["./plan.html", "./adventure.html", "./ledger.html", "./sprites.html"]);
  assert.match(band, /It plans, and shows the work/);
  assert.match(band, /A text adventure, with a room you can actually see/);
  assert.match(band, /The memory ledger/);
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
