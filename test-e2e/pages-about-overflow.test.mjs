// Every about page must fit inside a phone-width viewport without forcing a
// horizontal scrollbar. The about pages and site.css are committed source
// (scripts/site-pages.mjs), never rebuilt, so this serves public/ directly
// rather than paying for a full demo:build.
//
// This is a real-browser regression guard for a shape of bug that only shows
// up in layout, not in markup: a grid item's auto margins (main { margin: 0
// auto } collides with .about-shell's grid) reverting it to shrink-to-fit
// sizing, driven by whatever unbreakable inline run — typically a long
// <code> file path — is widest. Neither a markup diff nor a CSS lint would
// catch this; only measuring the laid-out page does.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright";
import { repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import { ABOUT_PAGES } from "../scripts/site-pages.mjs";

// 375 is the common modern-phone width (iPhone SE and up); 320 is the
// narrowest width still seen in the wild and the stricter of the two.
const PHONE_WIDTHS = [375, 320];

let server;
let browser;

before(async () => {
  server = await serveDirectory(join(repoRoot, "public"));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

for (const width of PHONE_WIDTHS) {
  for (const page of ABOUT_PAGES) {
    test(`${page} has no horizontal overflow at ${width}px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const browserPage = await context.newPage();
      try {
        await browserPage.goto(`${server.origin}/${page}`, { waitUntil: "networkidle" });
        const { scrollWidth, clientWidth } = await browserPage.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        assert.ok(
          scrollWidth <= clientWidth,
          `${page} at ${width}px: document scrolls to ${scrollWidth}px inside a ${clientWidth}px viewport`,
        );
      } finally {
        await context.close();
      }
    });
  }
}
