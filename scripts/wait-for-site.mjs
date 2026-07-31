// scripts/wait-for-site.mjs — poll the deployed site until it serves this
// build's version AND its chat-seed.json, so the deployed-e2e jobs never
// race CloudFront still settling after a CDK deploy. Site-only:
// smoke:post-deploy already checks the npm/pages pairing separately, in its
// own stage, for a different question (is the published package live) than
// this one (is the site the e2e-deployed jobs are about to hit actually the
// build that just shipped).
//
// The page version stamp alone isn't enough: index.html is small and
// uploads/propagates fast, but chat-seed.json is ~93MB and can still be
// mid-upload (or mid-CloudFront-invalidation) after index.html already
// shows the new version. Pipeline 2722451772 reproduced exactly this —
// every deployed-e2e job's very first seed-dependent test failed with zero
// facts, even at --test-concurrency=1 (no contention possible), moments
// after the version-stamp check alone had already passed. So this also
// reads chat.html's own SEED_STAMP and HEAD-checks that exact
// chat-seed.json?b=<stamp> URL for a real, adequately-sized response —
// the same URL and cache key a real browser boot uses.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseVersionStamp } from "../src/domain/version-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version, homepage } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const SITE_URL = homepage;
const CHAT_URL = new URL("chat.html", SITE_URL).href;
const ATTEMPTS = Number(process.env.WAIT_FOR_SITE_ATTEMPTS ?? 10);
const DELAY_MS = Number(process.env.WAIT_FOR_SITE_DELAY_MS ?? 30_000);
const FETCH_TIMEOUT_MS = 20_000;
// Well below the ~93MB the seed actually measures (see build-chat-seed.mjs),
// comfortably above anything a truncated upload or an error page would serve.
const MIN_SEED_BYTES = 50 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "user-agent": "tmct wait-for-site" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function siteVersion() {
  const stamped = parseVersionStamp(await fetchText(SITE_URL));
  if (!stamped) throw new Error("the home page shows no version");
  return stamped;
}

/** chat.html's own SEED_STAMP — the content-hash query chat-page-viz.mjs
 *  fetches chat-seed.json under, and the service worker precaches it under. */
async function chatSeedStamp() {
  const html = await fetchText(CHAT_URL);
  const found = /SEED_STAMP\s*=\s*"([^"]*)"/.exec(html);
  if (!found) throw new Error("chat.html carries no SEED_STAMP");
  return found[1];
}

/** Whether chat-seed.json is actually available, at the URL and cache key a
 *  real boot uses, and large enough not to be a truncated upload. */
async function seedReady(stamp) {
  const url = new URL(`chat-seed.json${stamp ? `?b=${stamp}` : ""}`, SITE_URL).href;
  const res = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    // The deploy serves precompressed .br/.gz siblings when the client
    // negotiates for one (see post-deploy-smoke.mjs's own vendorEncoding()
    // check) — fetch()'s default Accept-Encoding gets back the COMPRESSED
    // content-length (~4.5MB for this ~93MB file), which reads as a
    // truncated upload when it isn't. identity forces the real byte count.
    headers: { "cache-control": "no-cache", "accept-encoding": "identity", "user-agent": "tmct wait-for-site" },
  });
  if (!res.ok) throw new Error(`chat-seed.json: ${res.status} ${res.statusText}`);
  const bytes = Number(res.headers.get("content-length") ?? 0);
  if (bytes < MIN_SEED_BYTES) throw new Error(`chat-seed.json is only ${bytes} bytes — looks truncated`);
  return bytes;
}

async function checkOnce() {
  const seenVersion = await siteVersion();
  if (seenVersion !== version) throw new Error(`home page serves ${seenVersion}, not ${version}`);
  const stamp = await chatSeedStamp();
  const bytes = await seedReady(stamp);
  return { version: seenVersion, stamp, bytes };
}

async function main() {
  console.log(`waiting for ${SITE_URL} to serve ${version} with a ready chat-seed.json (up to ${ATTEMPTS} attempts, ${DELAY_MS}ms apart, ~${Math.round((ATTEMPTS * DELAY_MS) / 60_000)}min cap)`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { version: seenVersion, stamp, bytes } = await checkOnce();
      console.log(`attempt ${attempt}/${ATTEMPTS}: home=${seenVersion} chat-seed.json(b=${stamp})=${bytes} bytes`);
      console.log(`${SITE_URL} is serving ${version} with a ${bytes}-byte chat-seed.json — the deployed-e2e jobs can start`);
      return 0;
    } catch (err) {
      console.log(`attempt ${attempt}/${ATTEMPTS}: ${err.message}`);
    }
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
  console.error(`gave up after ${ATTEMPTS} attempts — ${SITE_URL} never confirmed ready.`);
  console.error("the deployed-e2e jobs would likely be racing a still-settling CDN or a still-uploading seed; not worth running them blind.");
  return 1;
}

process.exitCode = await main();
