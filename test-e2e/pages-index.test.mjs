// The hand-maintained homepage (public/index.html, git-tracked, with only its
// version stamp generated): a hero, a grid of claim blocks that each
// link to the demo page showing that claim, one feature section per page repeating
// the claims with a framed screenshot plate each, the run-yourself and
// library docs, and a Polycode-family showcase. A static, no-browser
// structural check; pages-home.test.mjs covers the same page with a real
// browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));

const PAGE_ORDER = [
  "chat",
  "spider-fly",
  "plan",
  "adventure",
  "ledger",
  "code",
  "ingest",
  "sprites",
  "research",
];

test("the claim grid lists exactly one claim link per demo page, in the page order", async () => {
  const html = await readFile(INDEX, "utf8");
  const grid = html.slice(html.indexOf('<div class="claim-grid">'), html.indexOf('<section class="feature"'));
  const hrefs = [...grid.matchAll(/<a class="claim" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, PAGE_ORDER.map((p) => `./${p}.html`));
});

test("every claim block names the page it opens in a filename chip that matches its href", async () => {
  const html = await readFile(INDEX, "utf8");
  const grid = html.slice(html.indexOf('<div class="claim-grid">'), html.indexOf('<section class="feature"'));
  const chips = [...grid.matchAll(/<span class="claim-page">([^<]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(chips, PAGE_ORDER.map((p) => `${p}.html`));
});

test("each demo page gets a feature section whose plate shows that page's screenshot and links to it", async () => {
  const html = await readFile(INDEX, "utf8");
  for (const page of PAGE_ORDER) {
    const start = html.indexOf(`id="feature-${page}"`);
    assert.ok(start !== -1, `a feature section exists for ${page}.html`);
    const section = html.slice(start, html.indexOf("</section>", start));
    assert.match(
      section,
      new RegExp(`<img src="\\./screenshots/${page}\\.png" width="640" height="375"\\s+alt="[^"]+"`),
      `the ${page} plate shows ./screenshots/${page}.png with fixed dimensions and an alt text`,
    );
    assert.match(
      section,
      new RegExp(`<a class="plate-frame" href="\\./${page}\\.html"[^>]*>`),
      `the ${page} plate links to the page it depicts`,
    );
  }
});

test("the feature sections repeat the claims in claim-grid order, plates numbered I to IX", async () => {
  const html = await readFile(INDEX, "utf8");
  const positions = PAGE_ORDER.map((page) => html.indexOf(`id="feature-${page}"`));
  assert.ok(positions.every((i) => i !== -1));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "feature order matches claim order");
  const numerals = [...html.matchAll(/<span class="plate-no">Plate ([IVX]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(numerals, ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"]);
});

test("the page carries one live demo box and no live page embeds", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.equal([...html.matchAll(/<div id="tmct-demo">/g)].length, 1, "exactly one live demo box");
  assert.doesNotMatch(html, /<iframe/, "no page is embedded live in an iframe");
  assert.doesNotMatch(html, /<div id="tmct-chat"/, "the old live chat widget stays gone");
  assert.doesNotMatch(html, /What an answer looks like/);
  assert.doesNotMatch(html, /<pre class="transcript"/);
});

test("the showcase names the Polycode family projects and links to them", async () => {
  const html = await readFile(INDEX, "utf8");
  const showcase = html.slice(html.indexOf('<section class="showcase">'), html.indexOf("<footer>"));
  const hrefs = [...showcase.matchAll(/<a class="showcase-card" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    "https://seonix.polycode.co.uk/",
    "https://marginalia.polycode.co.uk/",
    "https://gitlab.com/polycode-projects/bedrock-meter",
  ]);
  assert.match(showcase, /Seonix/);
  assert.match(showcase, /Marginalia/);
  assert.match(showcase, /Bedrock Meter/);
  assert.match(showcase, /tmct library/, "the showcase words the family as adopting the tmct library");
});

test("the page reads hero, claims, features, run-yourself, library, showcase, footer, in that order", async () => {
  const html = await readFile(INDEX, "utf8");
  const hero = html.indexOf('<header class="hero">');
  const claims = html.indexOf('<div class="claim-grid">');
  const firstFeature = html.indexOf('<section class="feature"');
  const demoBox = html.indexOf('<div id="tmct-demo">');
  const runYourself = html.indexOf("<h2 id=\"run\">Run the chat yourself</h2>");
  const useAsLibrary = html.indexOf("<h2>Use it as a library</h2>");
  const showcase = html.indexOf('<section class="showcase">');
  const footer = html.indexOf("<footer>");
  const order = [hero, claims, firstFeature, demoBox, runYourself, useAsLibrary, showcase, footer];
  assert.ok(order.every((i) => i !== -1), "every band is present");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the bands sit in reading order");
});

test("the sprite-library feature carries a real sprite teaser: real inline icons and their real ancestor-chain text", async () => {
  const html = await readFile(INDEX, "utf8");
  const start = html.indexOf('id="feature-sprites"');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.match(section, /<div class="sprite-teaser">/, "the sprite feature has a visual teaser, not just a bare link");
  const svgCount = [...section.matchAll(/<svg viewBox="0 0 24 24"/g)].length;
  assert.ok(svgCount >= 3, `expected at least 3 real sprite icons inlined, found ${svgCount}`);
  // Real rdfs:subClassOf ancestor chains (src/domain/sprite-map.mjs's classAncestorChain
  // over the spider-and-fly world's own seed taxonomy), never an invented relation.
  assert.match(section, /poodle.*dog.*animal/s);
  assert.match(section, /spider.*arachnid.*animal/s);
  assert.match(section, /fly.*insect.*animal/s);
});

test("the home page carries its own neutral palette and rounded-sans type, not the shared trust-tier tokens", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /--bg: #FFFFFF/, "the ground is white, not the old cream");
  assert.match(html, /--ink: #1A1A1A/, "the fg is a neutral near-black");
  assert.match(html, /--taught: #1B7A4B/, "the single accent is a restrained green");
  assert.match(html, /--entail: #3F3F46/, "the structural accent is a neutral dark grey, not brass");
  assert.match(html, /--line: #E6E6E1/, "the border is a hairline neutral grey");
  assert.match(html, /--font-display:[^;]*ui-rounded/, "the display face is a rounded sans, not a serif");
  assert.match(html, /--font-body:[^;]*system-ui/, "the body face is a system sans, not a serif");
  assert.doesNotMatch(html, /Charter|Georgia|Times New Roman/, "the old serif stack is gone");
  assert.doesNotMatch(html, /#F7F6F2/, "the old cream ground is gone");
  assert.doesNotMatch(html, /--fg:/, "the old --fg token name is gone");
  assert.doesNotMatch(html, /--accent:/, "the old --accent token name is gone");
  assert.doesNotMatch(html, /--border:/, "the old --border token name is gone");
});
