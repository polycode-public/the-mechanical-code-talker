// After `npm run demo:build`, every one of the site's 23 pages (index, the
// 11 demo pages, the 11 about pages) carries exactly one canonical link, one
// og:image tag and one twitter:card tag, robots.txt matches the payload the
// deploy needs to stop search engines treating the whole site as blocked,
// and sitemap.xml parses with all 23 locs. This reads public/ directly, the
// same build output a deploy ships, so `npm run demo:build` must run first —
// it does not assert that the og:image files themselves exist on disk, since
// generating those PNGs is a separate build step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { DEMO_PAGES, aboutPageOf } from "../../scripts/site-pages.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));

const ALL_PAGES = ["index.html", ...DEMO_PAGES.map((slug) => `${slug}.html`), ...DEMO_PAGES.map(aboutPageOf)];

// The generated pages, robots.txt and sitemap.xml exist only after a build, and
// the unit CI job runs on a fresh checkout with no built site — these checks
// run wherever a build has happened (locally, and in the web e2e jobs).
const siteUnbuilt = !existsSync(join(PUBLIC_DIR, "chat.html"));

function readPage(name) {
  const path = join(PUBLIC_DIR, name);
  assert.ok(existsSync(path), `${name} is missing from public/ — run \`npm run demo:build\` first`);
  return readFileSync(path, "utf8");
}

function countMatches(html, re) {
  return [...html.matchAll(re)].length;
}

test("the page list holds 23 pages: index, 11 demo pages, 11 about pages", () => {
  assert.equal(ALL_PAGES.length, 23);
  assert.equal(new Set(ALL_PAGES).size, 23, "no page name repeats");
});

test("every page exists and carries exactly one canonical link, one og:image and one twitter:card", { skip: siteUnbuilt }, () => {
  for (const name of ALL_PAGES) {
    const html = readPage(name);
    assert.equal(countMatches(html, /<link rel="canonical" href="[^"]+">/g), 1, `${name}: expected exactly one canonical link`);
    assert.equal(countMatches(html, /<meta property="og:image" content="[^"]+">/g), 1, `${name}: expected exactly one og:image`);
    assert.equal(countMatches(html, /<meta name="twitter:card" content="[^"]+">/g), 1, `${name}: expected exactly one twitter:card`);
  }
});

test("robots.txt matches the required payload exactly", { skip: siteUnbuilt }, () => {
  const path = join(PUBLIC_DIR, "robots.txt");
  assert.ok(existsSync(path), "public/robots.txt is missing — run `npm run demo:build` first");
  const text = readFileSync(path, "utf8");
  assert.equal(text, "User-agent: *\nAllow: /\nSitemap: https://tmct.polycode.co.uk/sitemap.xml\n");
});

test("sitemap.xml parses and holds 23 unique locs", { skip: siteUnbuilt }, () => {
  const path = join(PUBLIC_DIR, "sitemap.xml");
  assert.ok(existsSync(path), "public/sitemap.xml is missing — run `npm run demo:build` first");
  const xml = readFileSync(path, "utf8");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 23, "sitemap.xml should hold 23 <url><loc> entries");
  assert.equal(new Set(locs).size, 23, "every loc in sitemap.xml should be unique");
  assert.ok(locs.includes("https://tmct.polycode.co.uk/"), "sitemap.xml should include the home page");
});
