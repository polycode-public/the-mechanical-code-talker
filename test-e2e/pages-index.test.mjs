// The hand-authored pages of the site, checked as text: the home page
// (public/index.html) and the six about pages beside it, all git-tracked and
// all sharing public/site.css.
//
// The home page reads as a hero, a grid of claim cards that each link to their
// demo page and carry an info link and a share button, a capability table
// mapping demos to what they show, one feature section per page with a framed
// screenshot plate, the run-yourself and library docs, and a Polycode-family
// showcase. Each about page carries the same seven sections, a left nav into
// them, and a Next chain that walks the set.
//
// A static, no-browser structural check; pages-home.test.mjs covers the same
// pages with a real browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEMO_PAGES, aboutPageOf } from "../scripts/site-pages.mjs";

const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));
const SITE_CSS = fileURLToPath(new URL("../public/site.css", import.meta.url));
const publicFile = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

const PAGE_ORDER = DEMO_PAGES;

// The grid carries one cell per demo page plus one deep-link cell into
// mudiii's river scenario, sitting right after mudiii's own cell since it is
// the same engine and page, not a demo page of its own.
const mudiiiAt = PAGE_ORDER.indexOf("mudiii");
const gridValues = (map, riverValue) => [
  ...PAGE_ORDER.slice(0, mudiiiAt + 1).map(map),
  riverValue,
  ...PAGE_ORDER.slice(mudiiiAt + 1).map(map),
];

test("the claim grid lists one cell per demo page plus the river deep-link cell, in that order", async () => {
  const html = await readFile(INDEX, "utf8");
  const grid = html.slice(html.indexOf('<div class="claim-grid">'), html.indexOf('<section class="capabilities"'));
  const hrefs = [...grid.matchAll(/<a class="claim" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, gridValues((p) => `./${p}.html`, "./mudiii.html?scenario=river"));
});

test("every claim block names the page it opens in a filename chip that matches its href", async () => {
  const html = await readFile(INDEX, "utf8");
  const grid = html.slice(html.indexOf('<div class="claim-grid">'), html.indexOf('<section class="capabilities"'));
  const chips = [...grid.matchAll(/<span class="claim-page">([^<]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(chips, gridValues((p) => `${p}.html`, "mudiii.html?scenario=river"));
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

test("the feature sections repeat the claims in claim-grid order, plates numbered I to VII", async () => {
  const html = await readFile(INDEX, "utf8");
  const positions = PAGE_ORDER.map((page) => html.indexOf(`id="feature-${page}"`));
  assert.ok(positions.every((i) => i !== -1));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "feature order matches claim order");
  const numerals = [...html.matchAll(/<span class="plate-no">Plate ([IVX]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(numerals, ["I", "II", "III", "IV", "V", "VI", "VII"]);
});

test("the page carries one live demo box and no live page embeds", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.equal([...html.matchAll(/<div id="tmct-demo">/g)].length, 1, "exactly one live demo box");
  assert.doesNotMatch(html, /<iframe/, "no page is embedded live in an iframe");
  assert.doesNotMatch(html, /<div id="tmct-chat"/, "the old live chat widget stays gone");
  assert.doesNotMatch(html, /What an answer looks like/, "the old transcript section's heading stays gone");
});

test("the worked reasoning example sits between two feature plates and shows a real /prove transcript", async () => {
  const html = await readFile(INDEX, "utf8");
  const beforeIt = html.indexOf('id="feature-chat"');
  const start = html.indexOf('id="reasoning-example"');
  const afterIt = html.indexOf('id="feature-news"');
  assert.ok(beforeIt !== -1 && start !== -1 && afterIt !== -1, "the chat plate, the example, and the news plate are all on the page");
  assert.ok(beforeIt < start && start < afterIt, "the example sits between two feature plates");
  const section = html.slice(start, afterIt);
  assert.match(section, /<pre class="transcript">/, "the example reads as a chat transcript, not prose");
  assert.match(section, /\/prove is rex a dog/, "the example asks a real \\/prove question");
  assert.match(section, /in every case — a cat or a dog — rex is a dog\./, "the example shows the engine's real by-cases verdict");
});

test("the news example sits between the news and sprites feature plates and shows a real /news transcript", async () => {
  const html = await readFile(INDEX, "utf8");
  const beforeIt = html.indexOf('id="feature-news"');
  const start = html.indexOf('id="news-example"');
  const afterIt = html.indexOf('id="feature-sprites"');
  assert.ok(beforeIt !== -1 && start !== -1 && afterIt !== -1, "the news plate, the example, and the sprites plate are all on the page");
  assert.ok(beforeIt < start && start < afterIt, "the example sits between two feature plates");
  const section = html.slice(start, afterIt);
  assert.match(section, /<pre class="transcript">/, "the example reads as a chat transcript, not prose");
  assert.match(section, /<span class="you">\/news<\/span>/, "the example runs a real \\/news turn with no polled state");
  assert.match(section, /no news items yet — poll a source or teach something first\./, "the example shows the engine's real empty-state reply");
  assert.match(section, /<span class="you">\/news poll<\/span>/, "the example runs a real \\/news poll turn");
  assert.match(section, /polled 1 source: 2 new items, 1 fact stored, 0 derived, 0 failures, 0 evicted\./, "the example shows the engine's real poll report");
  assert.match(section, /<span class="you">\/news rank<\/span>/, "the example runs a real \\/news rank turn");
  assert.match(section, /1\. wombat \(2\) — unknown word/, "the example shows the engine's real ranked ungrounded-term list");
});

test("the river-crossing cell sits right after mudiii's and deep-links straight onto the scenario mudiii.html reads from the URL", async () => {
  const html = await readFile(INDEX, "utf8");
  const gridStart = html.indexOf('<div class="claim-grid">');
  const gridEnd = html.indexOf('<section class="capabilities"');
  const mudiiiAt = html.indexOf('data-share-demo="mudiii"');
  const riverAt = html.indexOf('data-share-demo="river"');
  assert.ok(gridStart !== -1 && mudiiiAt !== -1 && riverAt !== -1, "both cells are on the page");
  assert.ok(gridStart < mudiiiAt && mudiiiAt < riverAt && riverAt < gridEnd, "the river cell sits right after mudiii's, inside the grid");
  const cellStart = html.lastIndexOf('<div class="claim-cell">', riverAt);
  const cell = html.slice(cellStart, html.indexOf("</div>", riverAt));
  assert.match(
    cell,
    /<a class="claim" href="\.\/mudiii\.html\?scenario=river" target="_blank" rel="noopener noreferrer">/,
    "the cell opens mudiii on the river scenario, in a new tab",
  );
  assert.match(cell, /<h3>The fox, the goat and the cabbage<\/h3>/, "the cell names the puzzle rather than the page");
  assert.match(cell, /mudiii\.html\?scenario=river <svg/, "and names the address it opens");
  // The scenario parameter is only worth linking if the page reads it.
  const viz = await readFile(fileURLToPath(new URL("../src/services/mudiii-viz.mjs", import.meta.url)), "utf8");
  assert.match(viz, /scenarioIndexFromQuery\(window\.location\.search, DATA\.scenarios\)/);
});

test("the river-crossing cell carries its own info link and share button, sharing mudiii's about page", async () => {
  const html = await readFile(INDEX, "utf8");
  const riverAt = html.indexOf('data-share-demo="river"');
  const cellStart = html.lastIndexOf('<div class="claim-cell">', riverAt);
  const cell = html.slice(cellStart, html.indexOf("</div>", riverAt));
  assert.match(cell, /<a class="card-btn" href="\.\/mudiii-about\.html">/, "About points at the shared mudiii about page, not a new one");
  assert.match(cell, /<button class="card-btn share-btn" type="button" data-share-demo="river">/, "the Share button names its own share-target key");
  const labels = [...cell.matchAll(/<span class="sr-only">(About|Share) /g)].length;
  assert.equal(labels, 2, "both the info link and the share button carry an accessible name");
});

test("no feature section exists for the river cell: it is a deep link into mudiii's own scenario, not a demo page with its own plate", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.doesNotMatch(html, /id="feature-river"/, "the river cell demands no feature section or plate of its own");
});

test("the research example sits between the sprites and ledger feature plates and shows a real research-lane transcript", async () => {
  const html = await readFile(INDEX, "utf8");
  const beforeIt = html.indexOf('id="feature-sprites"');
  const start = html.indexOf('id="research-example"');
  const afterIt = html.indexOf('id="feature-ledger"');
  assert.ok(beforeIt !== -1 && start !== -1 && afterIt !== -1, "the sprites plate, the example, and the ledger plate are all on the page");
  assert.ok(beforeIt < start && start < afterIt, "the example sits between two feature plates");
  const section = html.slice(start, afterIt);
  assert.match(section, /<pre class="transcript">/, "the example reads as a chat transcript, not prose");
  assert.match(section, /tmct&gt; what is an aardvark/, "the example asks a real research-grounded question");
  assert.match(section, /tmct&gt; research aardvark/, "the example runs a real research command");
  assert.match(section, /aardvark is a kind of mammal/, "the example shows the engine's real isa synthesis");
  assert.match(section, /https:\/\/simple\.wikipedia\.org\/wiki\/Aardvark\?oldid=\d+/, "the example cites the exact Wikipedia URL it read");
  assert.match(section, /The aardvark is a mammal from Africa/, "the example quotes the wiki passage it read");
});

test("the showcase names the Polycode family projects and links to them", async () => {
  const html = await readFile(INDEX, "utf8");
  const showcase = html.slice(html.indexOf('<section class="showcase">'), html.indexOf("<footer>"));
  const hrefs = [...showcase.matchAll(/<a class="showcase-card" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    "https://seonix.polycode.co.uk/",
    "https://gitlab.com/polycode-projects/bedrock-meter",
    "https://gitlab.com/polycode-projects/the-quiet-feed",
  ]);
  assert.match(showcase, /Seonix/);
  assert.match(showcase, /Bedrock Meter/);
  assert.match(showcase, /The Quiet Feed/);
  assert.match(showcase, /tmct library/, "the showcase words the family as adopting the tmct library");
});

test("the page reads hero, claims, capabilities, features, run-yourself, library, showcase, footer, in that order", async () => {
  const html = await readFile(INDEX, "utf8");
  const hero = html.indexOf('<header class="hero">');
  const claims = html.indexOf('<div class="claim-grid">');
  const capabilities = html.indexOf('<section class="capabilities"');
  const firstFeature = html.indexOf('<section class="feature"');
  const demoBox = html.indexOf('<div id="tmct-demo">');
  const runYourself = html.indexOf("<h2 id=\"run\">Run the chat yourself</h2>");
  const useAsLibrary = html.indexOf("<h2 id=\"library\">Use it as a library</h2>");
  const showcase = html.indexOf('<section class="showcase">');
  const footer = html.indexOf("<footer>");
  const order = [hero, claims, capabilities, firstFeature, demoBox, runYourself, useAsLibrary, showcase, footer];
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

test("the hand-authored pages share one stylesheet rather than each carrying their own", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /<link rel="stylesheet" href="\.\/site\.css">/, "the home page links the shared stylesheet");
  assert.doesNotMatch(html, /<style>/, "the home page no longer inlines a copy of it");
  for (const page of PAGE_ORDER) {
    const about = await readFile(publicFile(aboutPageOf(page)), "utf8");
    assert.match(about, /<link rel="stylesheet" href="\.\/site\.css">/, `${page}'s about page links the same stylesheet`);
    assert.doesNotMatch(about, /<style>/, `${page}'s about page forks no second stylesheet`);
  }
});

test("the shared stylesheet carries the neutral palette and rounded-sans type, not the trust-tier tokens", async () => {
  const css = await readFile(SITE_CSS, "utf8");
  assert.match(css, /--bg: #FFFFFF/, "the ground is white, not the old cream");
  assert.match(css, /--ink: #1A1A1A/, "the fg is a neutral near-black");
  assert.match(css, /--taught: #1B7A4B/, "the single accent is a restrained green");
  assert.match(css, /--entail: #3F3F46/, "the structural accent is a neutral dark grey, not brass");
  assert.match(css, /--line: #E6E6E1/, "the border is a hairline neutral grey");
  assert.match(css, /--font-display:[^;]*ui-rounded/, "the display face is a rounded sans, not a serif");
  assert.match(css, /--font-body:[^;]*system-ui/, "the body face is a system sans, not a serif");
  assert.doesNotMatch(css, /Charter|Georgia|Times New Roman/, "the old serif stack is gone");
  assert.doesNotMatch(css, /#F7F6F2/, "the old cream ground is gone");
  assert.doesNotMatch(css, /--fg:/, "the old --fg token name is gone");
  assert.doesNotMatch(css, /--accent:/, "the old --accent token name is gone");
  assert.doesNotMatch(css, /--border:/, "the old --border token name is gone");
});

test("every claim cell carries an info link to its about page and a share button naming its demo", async () => {
  const html = await readFile(INDEX, "utf8");
  const gridStart = html.indexOf('<div class="claim-grid">');
  const grid = html.slice(gridStart, html.indexOf("</section>", gridStart));
  const infoHrefs = [...grid.matchAll(/<a class="card-btn" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(infoHrefs, gridValues((p) => `./${aboutPageOf(p)}`, "./mudiii-about.html"));
  const shared = [...grid.matchAll(/data-share-demo="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shared, gridValues((p) => p, "river"), "one share button per cell, in the grid order");
  // Both controls are icon-only, so each needs the sr-only label the new-tab
  // hint already uses; an unlabelled icon button reads as nothing.
  const labels = [...grid.matchAll(/<span class="sr-only">(About|Share) /g)].length;
  assert.equal(labels, (PAGE_ORDER.length + 1) * 2, "each info link and each share button carries an accessible name");
});

test("the capability table lists every demo page once, and every column has at least one demo", async () => {
  const html = await readFile(INDEX, "utf8");
  const start = html.indexOf('<section class="capabilities"');
  assert.ok(start !== -1, "the capability table is on the page");
  const table = html.slice(start, html.indexOf("</section>", start));
  const rowPages = [...table.matchAll(/<th scope="row"><a href="\.\/([a-z-]+)\.html"/g)].map((m) => m[1]);
  assert.deepEqual(rowPages, PAGE_ORDER, "one row per demo page, in the page order");

  // The first column head labels the rows; the capability columns are the ones
  // carrying the title text that says what the tick means.
  const columns = [...table.matchAll(/<th scope="col" title="[^"]+">([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.ok(columns.length >= 10, `expected at least 10 capability columns, found ${columns.length}`);

  // Every row states a mark for every column, so a cell can never be missing
  // rather than deliberately blank.
  const bodyRows = table.slice(table.indexOf("<tbody>")).split("<tr>").slice(1);
  assert.equal(bodyRows.length, PAGE_ORDER.length);
  const marks = bodyRows.map((row) => [...row.matchAll(/<td( class="focus")?>/g)].length);
  assert.deepEqual(marks, PAGE_ORDER.map(() => columns.length), "every row carries one cell per column");

  // A column nothing demonstrates is a column that should not be there.
  for (let col = 0; col < columns.length; col += 1) {
    const filled = bodyRows.some((row) => {
      const cells = row.split("<td").slice(1);
      return cells[col] && !cells[col].startsWith("></td>");
    });
    assert.ok(filled, `at least one demo demonstrates "${columns[col]}"`);
  }
  assert.match(table, /it is what the demo is for/, "the key explains the eye");
});

test("the eyebrow strip links out to the repository and into the sections it names", async () => {
  const html = await readFile(INDEX, "utf8");
  const hero = html.slice(html.indexOf('<header class="hero">'), html.indexOf("</header>"));
  assert.match(hero, /href="https:\/\/gitlab\.com\/polycode-projects\/the-mechanical-code-talker"[^>]*>Polycode projects</);
  for (const [phrase, target] of [["pure JS", "library"], ["no LLM", "capabilities"], ["offline by default", "live-demo"]]) {
    assert.match(hero, new RegExp(`href="#${target}"[^>]*>${phrase}<`), `"${phrase}" jumps to #${target}`);
    assert.match(html, new RegExp(`id="${target}"`), `#${target} is a real anchor on the page`);
  }
});

// ---- the about pages -------------------------------------------------------------
// One hand-authored page per demo, all sharing the same seven sections so the set
// walks as a presentation. Structure only; the prose is a human's to change.

const ABOUT_SECTIONS = ["what", "play", "shots", "inference", "build", "papers", "credits"];
// chat-about carries one page-specific extra: the reasoning walkthrough behind
// /classify and /prove sits between inference and build.
const aboutSectionsOf = (page) => (page === "chat"
  ? ["what", "play", "shots", "inference", "reasoning", "build", "papers", "credits"]
  : ABOUT_SECTIONS);

test("every demo's about page carries the shared section set in order, chat adding its reasoning walkthrough", async () => {
  for (const page of PAGE_ORDER) {
    const html = await readFile(publicFile(aboutPageOf(page)), "utf8");
    const ids = [...html.matchAll(/<section class="about-section" id="([a-z]+)">/g)].map((m) => m[1]);
    assert.deepEqual(ids, aboutSectionsOf(page), `${page}'s about page carries the shared section set`);
  }
});

test("each about page's left nav names every section it has, and nothing it does not", async () => {
  for (const page of PAGE_ORDER) {
    const html = await readFile(publicFile(aboutPageOf(page)), "utf8");
    const nav = html.slice(html.indexOf('<ol class="about-crumbs">'), html.indexOf("</ol>"));
    const targets = [...nav.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(targets, aboutSectionsOf(page), `${page}'s nav is a breadcrumb into every section`);
  }
});

test("every Next button lands on the following section, and the last one leads to the next demo", async () => {
  for (const [i, page] of PAGE_ORDER.entries()) {
    const html = await readFile(publicFile(aboutPageOf(page)), "utf8");
    const nexts = [...html.matchAll(/<a class="next-link" href="([^"]+)"/g)].map((m) => m[1]);
    const withinPage = aboutSectionsOf(page).slice(1).map((id) => `#${id}`);
    const last = i + 1 < PAGE_ORDER.length ? `./${aboutPageOf(PAGE_ORDER[i + 1])}` : "./index.html";
    assert.deepEqual(nexts, [...withinPage, last], `${page}'s Next chain walks its sections then moves on`);
  }
});

test("every about page links back to the home page and out to the demo it describes", async () => {
  for (const page of PAGE_ORDER) {
    const html = await readFile(publicFile(aboutPageOf(page)), "utf8");
    assert.match(html, /<a class="about-back" href="\.\/index\.html">/, `${page}'s about page links home`);
    assert.match(
      html,
      new RegExp(`<a class="about-open" href="\\./${page}\\.html" target="_blank" rel="noopener noreferrer">`),
      `${page}'s about page opens its own demo in a new tab`,
    );
    assert.match(html, /<span class="sr-only"> \(opens in a new tab\)<\/span>/, "and says so for a screen reader");
  }
});

test("every about page shows its demo's own screenshot", async () => {
  for (const page of PAGE_ORDER) {
    const html = await readFile(publicFile(aboutPageOf(page)), "utf8");
    assert.match(
      html,
      new RegExp(`<img src="\\./screenshots/${page}\\.png"[^>]*alt="[^"]+"`),
      `${page}'s about page shows ./screenshots/${page}.png with an alt text`,
    );
  }
});

test("every share post targets a real page, and every deep link a real anchor", async () => {
  const share = await readFile(publicFile("share.mjs"), "utf8");
  const targets = [...share.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= PAGE_ORDER.length * 5, `expected five posts per demo, found ${targets.length}`);
  const demoPageNames = new Set(PAGE_ORDER.map((p) => `${p}.html`));
  for (const target of targets) {
    const [file, fragment] = target.split("#");
    const [name] = file.split("?");
    // The demo pages are build outputs, so their names are checked against the
    // page list rather than against a file on disk. The hand-authored pages are
    // read, so a deep link can be checked against the anchor it claims.
    if (demoPageNames.has(name)) {
      assert.ok(!fragment, `${target} deep-links into a generated page, whose anchors this file cannot check`);
      continue;
    }
    const html = await readFile(publicFile(name), "utf8");
    if (fragment) assert.match(html, new RegExp(`id="${fragment}"`), `${target} points at a real anchor`);
  }
});

test("a share post's query parameter is only used where the target page reads one", async () => {
  const share = await readFile(publicFile("share.mjs"), "utf8");
  const parameterised = [...share.matchAll(/to: "([^"]*\?[^"]*)"/g)].map((m) => m[1]);
  // Two pages read a query parameter off a share link: index.html primes the
  // live demo box, and mudiii.html picks its opening scenario.
  const readers = {
    "index.html": {
      content: () => readFile(publicFile("demo-ui.mjs"), "utf8"),
      pattern: (key) => new RegExp(`params\\.(get|has)\\("${key}"\\)`),
    },
    "mudiii.html": {
      content: () => readFile(fileURLToPath(new URL("../src/services/mudiii-viz.mjs", import.meta.url)), "utf8"),
      pattern: () => /scenarioIndexFromQuery\(window\.location\.search, DATA\.scenarios\)/,
    },
  };
  for (const target of parameterised) {
    const [name, query] = target.split("?");
    const reader = readers[name];
    assert.ok(reader, `${target} carries a parameter, and only index.html and mudiii.html read one`);
    const key = new URLSearchParams(query).keys().next().value;
    const content = await reader.content();
    assert.match(content, reader.pattern(key), `${name} actually reads ?${key}`);
  }
});

// The river-crossing card is not a demo page (no about page or screenshot of
// its own), but it carries a share button like the demo pages do, so its
// share.mjs block is held to the same shape.
const SHARE_KEYS = [...PAGE_ORDER, "river"];

test("every share button target carries at least five share posts, each on its own angle and its own target", async () => {
  const share = await readFile(publicFile("share.mjs"), "utf8");
  for (const page of SHARE_KEYS) {
    const key = /^[a-z]+$/.test(page) ? `  ${page}: {` : `  "${page}": {`;
    const start = share.indexOf(key);
    assert.ok(start !== -1, `share.mjs carries posts for ${page}`);
    const block = share.slice(start, share.indexOf("\n  },", start));
    const angles = [...block.matchAll(/angle: "([^"]+)"/g)].map((m) => m[1]);
    const targets = [...block.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(angles.length >= 5, `${page} has ${angles.length} posts, expected at least five`);
    assert.equal(new Set(angles).size, angles.length, `${page}'s post angles are all different`);
    assert.equal(new Set(targets).size, targets.length, `${page}'s posts all link somewhere different`);
  }
});
