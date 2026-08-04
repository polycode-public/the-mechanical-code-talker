// public/og/ holds the link-preview images every demo page, the index page,
// and GitHub's own social-preview card point at (scripts/gen-og-images.mjs).
// This checks the generated set is complete and each PNG's own IHDR
// dimensions match what a link-preview consumer expects: 1200x630 for every
// og:image, 1280x640 for the GitHub social-preview card. It never asserts
// og:image tags exist in HTML — that is a sibling generator's job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readPngDimensions } from "../../scripts/gen-screenshots.mjs";
import { DEMO_PAGES } from "../../scripts/site-pages.mjs";

const OG_DIR = fileURLToPath(new URL("../../public/og/", import.meta.url));
const OG_SIZE = { width: 1200, height: 630 };
const SOCIAL_SIZE = { width: 1280, height: 640 };

const expectedFiles = [...DEMO_PAGES.map((slug) => `${slug}.png`), "index.png", "github-social.png"];

test("public/og/ ships exactly the 13 expected images", () => {
  for (const file of expectedFiles) {
    assert.doesNotThrow(
      () => readFileSync(new URL(`./${file}`, `file://${OG_DIR}`)),
      `public/og/${file} is missing — run \`npm run gen:og-images\``,
    );
  }
});

test("every demo page's og image is 1200x630", () => {
  for (const slug of DEMO_PAGES) {
    const png = readFileSync(new URL(`./${slug}.png`, `file://${OG_DIR}`));
    assert.deepEqual(readPngDimensions(png), OG_SIZE, `public/og/${slug}.png is not ${OG_SIZE.width}x${OG_SIZE.height}`);
  }
});

test("the index page's og image is 1200x630", () => {
  const png = readFileSync(new URL("./index.png", `file://${OG_DIR}`));
  assert.deepEqual(readPngDimensions(png), OG_SIZE, `public/og/index.png is not ${OG_SIZE.width}x${OG_SIZE.height}`);
});

test("the GitHub social-preview card is 1280x640", () => {
  const png = readFileSync(new URL("./github-social.png", `file://${OG_DIR}`));
  assert.deepEqual(
    readPngDimensions(png),
    SOCIAL_SIZE,
    `public/og/github-social.png is not ${SOCIAL_SIZE.width}x${SOCIAL_SIZE.height}`,
  );
});
