// Renders the link-preview images every page's og:image/twitter:image tag
// points at: one 1200x630 image per demo page plus the index page, and one
// 1280x640 image for GitHub's own social-preview card. Each image letterboxes
// the page's existing 1024x600 marketing screenshot (public/screenshots/)
// onto the site's own body background, scaled to fit height so nothing
// stretches. Run via `npm run gen:og-images`, after screenshots exist —
// `demo:build` chains both.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

import { readPngDimensions } from "./gen-screenshots.mjs";
import { DEMO_PAGES } from "./site-pages.mjs";
import { repoRoot } from "../test-e2e/helpers/demo-site.mjs";

const OG_SIZE = { width: 1200, height: 630 };
const SOCIAL_SIZE = { width: 1280, height: 640 };
const INDEX_SOURCE_SCREENSHOT = "mudiii";

/** The colour og images letterbox onto: the body background
 *  public/site.css declares for public/index.html, read live so this script
 *  can never drift from the site's own palette. */
function readBodyBackground() {
  const css = readFileSync(join(repoRoot, "public", "site.css"), "utf8");
  const bodyBlock = css.match(/\bbody\s*{([^}]*)}/);
  const declared = bodyBlock?.[1].match(/background:\s*([^;]+);/)?.[1].trim();
  if (!declared) throw new Error("no background declaration on body in public/site.css");

  const varName = declared.match(/^var\((--[a-zA-Z-]+)\)$/)?.[1];
  if (!varName) return declared;

  const rootBlock = css.match(/:root\s*{([^}]*)}/);
  const resolved = rootBlock?.[1].match(new RegExp(`${varName}:\\s*([^;]+);`))?.[1].trim();
  if (!resolved) throw new Error(`public/site.css's :root never declares ${varName}`);
  return resolved;
}

function shellHtml(background, screenshotDataUrl, size) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; background: ${background}; }
img { position: absolute; top: 50%; left: 50%; height: ${size.height}px; width: auto; transform: translate(-50%, -50%); display: block; }
</style></head>
<body><img src="${screenshotDataUrl}"></body></html>`;
}

async function renderOgImage(page, background, screenshotPath, outputPath, size) {
  const screenshotPng = readFileSync(screenshotPath);
  const dataUrl = `data:image/png;base64,${screenshotPng.toString("base64")}`;
  await page.setViewportSize(size);
  await page.setContent(shellHtml(background, dataUrl, size));
  const rendered = await page.screenshot({ type: "png" });
  const dims = readPngDimensions(rendered);
  if (dims.width !== size.width || dims.height !== size.height) {
    throw new Error(`${outputPath} rendered at ${dims.width}x${dims.height}, expected ${size.width}x${size.height}`);
  }
  writeFileSync(outputPath, rendered);
  return dims;
}

async function main() {
  const background = readBodyBackground();
  const screenshotsDir = join(repoRoot, "public", "screenshots");
  const outDir = join(repoRoot, "public", "og");
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    for (const slug of DEMO_PAGES) {
      const dims = await renderOgImage(
        page,
        background,
        join(screenshotsDir, `${slug}.png`),
        join(outDir, `${slug}.png`),
        OG_SIZE,
      );
      console.log(`wrote og/${slug}.png (${dims.width}x${dims.height})`);
    }

    const indexSourceScreenshot = join(screenshotsDir, `${INDEX_SOURCE_SCREENSHOT}.png`);

    const indexDims = await renderOgImage(page, background, indexSourceScreenshot, join(outDir, "index.png"), OG_SIZE);
    console.log(`wrote og/index.png (${indexDims.width}x${indexDims.height})`);

    const socialDims = await renderOgImage(page, background, indexSourceScreenshot, join(outDir, "github-social.png"), SOCIAL_SIZE);
    console.log(`wrote og/github-social.png (${socialDims.width}x${socialDims.height})`);
  } finally {
    await browser.close();
  }
}

// Only run when invoked directly (`npm run gen:og-images`), not when the
// estate guard imports readBodyBackground/readPngDimensions from this module.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
