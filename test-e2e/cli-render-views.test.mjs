// `tmct chat --render spider-fly|adventure|sprites --output <path>` — the
// standalone view exports, driven through the real binary and then opened in
// a real browser STRAIGHT FROM file://, with no sibling assets and no server:
// the whole point of the export is a single downloadable file, so the checks
// here are (a) the written page references nothing outside itself, and
// (b) it genuinely boots that way — the game pages' engines come up and
// enable their chat input, the sprite catalog renders its cards.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const READY_TIMEOUT_MS = 30_000;

let outDir;
let browser;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), "tmct-render-views-"));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

function renderView(archetype) {
  const outPath = join(outDir, `${archetype}.html`);
  const proc = spawnSync(process.execPath, [BIN, "chat", "--render", archetype, "--output", outPath], {
    encoding: "utf8",
    cwd: outDir,
  });
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  assert.match(proc.stdout, /wrote .* KB, self-contained\)/);
  return outPath;
}

function assertSelfContained(html, archetype) {
  assert.doesNotMatch(html, /<script src=/, `${archetype}: no sibling script files`);
  assert.doesNotMatch(html, /https?:\/\/cdn|esm\.sh|unpkg|jsdelivr/, `${archetype}: no CDN references`);
  assert.doesNotMatch(html, /<link [^>]*href="(?!#)/, `${archetype}: no external stylesheets`);
}

/** Open a written page from file:// with every network request recorded;
 *  a self-contained file makes zero http(s) requests and throws no page
 *  errors while booting. */
async function openFromFile(outPath) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const httpRequests = [];
  const pageErrors = [];
  page.on("request", (req) => {
    if (/^https?:/.test(req.url())) httpRequests.push(req.url());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.goto(pathToFileURL(outPath).href);
  return { context, page, httpRequests, pageErrors };
}

test("--render spider-fly writes one file whose inlined engine boots from file://", async () => {
  const outPath = renderView("spider-fly");
  const html = await readFile(outPath, "utf8");
  assertSelfContained(html, "spider-fly");
  assert.match(html, /const SPIDERFLY = /, "the page data embed is present");
  assert.match(html, /DEFAULT_VISION_RADIUS/, "the engine bundle is inlined");

  const { context, page, httpRequests, pageErrors } = await openFromFile(outPath);
  try {
    await page.waitForFunction(
      () => document.querySelector("#chatq") && !document.querySelector("#chatq").disabled,
      undefined,
      { timeout: READY_TIMEOUT_MS },
    );
    assert.deepEqual(httpRequests, [], "no network request from a file:// open");
    assert.deepEqual(pageErrors, [], "no page error while the engine boots");
  } finally {
    await context.close();
  }
});

test("--render adventure embeds the shipped world and boots from file://", async () => {
  const outPath = renderView("adventure");
  const html = await readFile(outPath, "utf8");
  assertSelfContained(html, "adventure");
  assert.match(html, /roomGraphSvg/, "the engine bundle is inlined");
  const embed = /const ADVENTURE = (.*);/.exec(html);
  assert.ok(embed, "the page data embed is present");
  const adventure = JSON.parse(embed[1]);
  // The standalone export is the one-world case: one scenario, so the page
  // ships no dropdown and stays a single downloadable file.
  assert.equal(adventure.scenarios.length, 1, "the export carries exactly the world it was asked for");
  assert.doesNotMatch(html, /id="scenarioSelect"/, "nothing to pick between, so nothing to pick with");
  const world = adventure.scenarios[0].worldPayload;
  assert.ok(world.facts.length > 50, "the real world's facts travel with the page");
  assert.ok(world.rules.length > 0, "the real world's rules travel with the page");

  const { context, page, httpRequests, pageErrors } = await openFromFile(outPath);
  try {
    await page.waitForFunction(
      () => document.querySelector("#chatq") && !document.querySelector("#chatq").disabled,
      undefined,
      { timeout: READY_TIMEOUT_MS },
    );
    assert.deepEqual(httpRequests, [], "no network request from a file:// open");
    assert.deepEqual(pageErrors, [], "no page error while the engine boots");
  } finally {
    await context.close();
  }
});

test("--render sprites writes the catalog as one file that renders from file://", async () => {
  const outPath = renderView("sprites");
  const html = await readFile(outPath, "utf8");
  assertSelfContained(html, "sprites");
  assert.match(html, /const SPRITE_CATALOG = /, "the page data embed is present");

  const { context, page, httpRequests, pageErrors } = await openFromFile(outPath);
  try {
    await page.locator(".card").first().waitFor({ state: "attached", timeout: READY_TIMEOUT_MS });
    const cards = await page.locator(".card").count();
    assert.ok(cards > 0, "the catalog's class cards render");
    assert.deepEqual(httpRequests, [], "no network request from a file:// open");
    assert.deepEqual(pageErrors, [], "no page error while the catalog renders");
  } finally {
    await context.close();
  }
});

test("--render sprites defaults --output to sprites.html in the cwd", async () => {
  const proc = spawnSync(process.execPath, [BIN, "chat", "--render", "sprites"], { encoding: "utf8", cwd: outDir });
  assert.equal(proc.status, 0, proc.stderr + proc.stdout);
  const html = await readFile(join(outDir, "sprites.html"), "utf8");
  assert.match(html, /const SPRITE_CATALOG = /);
});

test("--render still refuses an unknown archetype with the choice list", () => {
  const proc = spawnSync(process.execPath, [BIN, "chat", "--render", "ledger"], { encoding: "utf8", cwd: outDir });
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /invalid --render "ledger"\. Choices: blocks, spider-fly, adventure, sprites\./);
});
