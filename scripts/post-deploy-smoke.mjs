// scripts/post-deploy-smoke.mjs — after a publish, check that what the world
// sees matches what we built. Reads package.json's version, then asks npm's
// registry and the Pages home page what they are serving. Both must agree.
//
// Registry and Pages both lag a publish by a minute or two, so an early
// disagreement means nothing. This polls, and reports one only once the
// attempts run out. It reads public endpoints, so it needs no token.
//
// Run it after publish:npm and pages. With nothing published, it reports the
// disagreement it exists to catch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseVersionStamp } from "../src/domain/version-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name, version, homepage } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const REGISTRY_URL = `https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`;
const PAGES_URL = homepage;
const ATTEMPTS = Number(process.env.SMOKE_ATTEMPTS ?? 10);
const DELAY_MS = Number(process.env.SMOKE_DELAY_MS ?? 30_000);
const FETCH_TIMEOUT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "user-agent": `${name} post-deploy-smoke` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** The version npm's registry serves as `latest`. */
async function publishedVersion() {
  return JSON.parse(await fetchText(REGISTRY_URL)).version;
}

/** The version the Pages home page shows, read from the element that carries it. */
async function pagesVersion() {
  const version = parseVersionStamp(await fetchText(PAGES_URL));
  if (!version) throw new Error("the page shows no version");
  return version;
}

/** One pass over both endpoints. Never throws; the caller decides when to give up. */
async function checkOnce() {
  const results = {};
  for (const [label, read] of [
    ["npm", publishedVersion],
    ["pages", pagesVersion],
  ]) {
    try {
      results[label] = { value: await read() };
    } catch (err) {
      results[label] = { error: err.message };
    }
  }
  return { results, ok: results.npm.value === version && results.pages.value === version };
}

const describe = (r) => r.error ?? r.value;

async function main() {
  console.log(`checking ${name}@${version} is live on npm and at ${PAGES_URL}`);
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    last = await checkOnce();
    const { npm, pages } = last.results;
    console.log(`attempt ${attempt}/${ATTEMPTS}: npm=${describe(npm)} pages=${describe(pages)}`);
    if (last.ok) {
      console.log(`both serve ${version}`);
      return 0;
    }
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
  const { npm, pages } = last.results;
  console.error(`after ${ATTEMPTS} attempts, ${version} is not live on both.`);
  console.error(`  npm:   ${describe(npm)}`);
  console.error(`  pages: ${describe(pages)}`);
  return 1;
}

process.exitCode = await main();
