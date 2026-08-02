// scripts/wait-for-site.mjs — poll the deployed site until it serves this
// build's version AND commit AND its chat-seed.json, so the deployed-e2e jobs
// never race CloudFront still settling after a CDK deploy. Site-only:
// smoke:post-deploy already checks the npm/pages pairing separately, in its
// own stage, for a different question (is the published package live) than
// this one (is the site the e2e-deployed jobs are about to hit actually the
// build that just shipped).
//
// version.txt alone isn't enough: it's tiny and uploads/propagates fast, but
// chat-seed.json is ~93MB and can still be mid-upload (or mid-CloudFront-
// invalidation) after version.txt already shows the new version. Pipeline
// 2722451772 reproduced exactly this — every deployed-e2e job's very first
// seed-dependent test failed with zero facts, even at --test-concurrency=1
// (no contention possible), moments after the version check alone had
// already passed. So this also reads chat.html's own SEED_STAMP and
// HEAD-checks that exact chat-seed.json?b=<stamp> URL for a real,
// adequately-sized response — the same URL and cache key a real browser
// boot uses.
//
// The version is not commit-precise either. Several commits share a version
// between bumps, so a slow deploy still settling while the next push races
// past it can serve the WRONG commit under a version that checks out.
// version.txt's own commit line demands it back.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseVersionFile, shortCommit } from "../src/domain/version-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version, homepage } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const SITE_URL = homepage;
const VERSION_URL = new URL("version.txt", SITE_URL).href;
const CHAT_URL = new URL("chat.html", SITE_URL).href;
// GitLab sets CI_COMMIT_SHA in every job, so the deploy writes it into
// version.txt and this poll demands it back. Empty outside CI, where there is
// no commit to be precise about and the version check is the whole of the answer.
const EXPECTED_COMMIT = shortCommit(process.env.CI_COMMIT_SHA ?? "");
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

/** The version and commit the live site's version.txt carries. The version
 *  alone is not commit-precise — commits share a version between bumps — so
 *  a still-live previous build can pass the version check while serving the
 *  wrong code. */
async function versionFileBuild() {
  const { version: seenVersion, commit } = parseVersionFile(await fetchText(VERSION_URL));
  if (!seenVersion) throw new Error("version.txt shows no version");
  return { version: seenVersion, commit };
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

/**
 * The seed as a real browser receives it: negotiated for a compressed
 * transfer, and still JSON once the transfer encoding has been undone.
 *
 * The size check above deliberately asks for `identity`, which is the one
 * variant no browser ever asks for — so it proves the file is present and
 * whole, and cannot say whether the copy a browser gets is readable. Those
 * came apart in production: the CDN re-compressed an object that was already
 * brotli, so the encoded variant decoded once into more brotli. Every header
 * looked right, the identity byte count was exactly right, and JSON.parse in
 * the page threw on binary. The page swallowed that into an unseeded boot and
 * answered "I don't know" to everything it should have known, while three
 * deployed-e2e tests failed on assertions nowhere near the cause.
 *
 * Reads only the first chunk of the body — enough to see whether it starts
 * like JSON — then cancels, so the check costs nothing near the file's size.
 */
async function seedDecodesForABrowser(stamp) {
  const url = new URL(`chat-seed.json${stamp ? `?b=${stamp}` : ""}`, SITE_URL).href;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "cache-control": "no-cache", "accept-encoding": "br, gzip", "user-agent": "tmct wait-for-site" },
  });
  if (!res.ok) throw new Error(`chat-seed.json (browser encoding): ${res.status} ${res.statusText}`);
  const encoding = res.headers.get("content-encoding") ?? "identity";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let head = "";
  try {
    while (head.length < 64) {
      const step = await reader.read();
      if (step.done) break;
      head += decoder.decode(step.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const first = head.trimStart().slice(0, 1);
  if (first !== "{" && first !== "[") {
    throw new Error(
      `chat-seed.json does not decode to JSON under content-encoding "${encoding}" — body starts ${JSON.stringify(head.slice(0, 24))}. `
      + "A doubly-compressed object is the usual cause: the deploy uploads a precompressed sibling AND the CDN compresses it again, "
      + "so one decode leaves the browser holding compressed bytes. Serve that path with CDN compression off, or without the precompressed sibling.",
    );
  }
  return encoding;
}

async function checkOnce() {
  const { version: seenVersion, commit: seenCommit } = await versionFileBuild();
  if (seenVersion !== version) throw new Error(`version.txt shows ${seenVersion}, not ${version}`);
  if (EXPECTED_COMMIT && seenCommit !== EXPECTED_COMMIT) {
    throw new Error(`version.txt shows commit ${seenCommit ?? "(none stamped)"}, not ${EXPECTED_COMMIT}`);
  }
  const stamp = await chatSeedStamp();
  const bytes = await seedReady(stamp);
  const encoding = await seedDecodesForABrowser(stamp);
  return { version: seenVersion, commit: seenCommit, stamp, bytes, encoding };
}

async function main() {
  const wanted = EXPECTED_COMMIT ? `${version} at commit ${EXPECTED_COMMIT}` : version;
  console.log(`waiting for ${SITE_URL} to serve ${wanted} with a ready chat-seed.json (up to ${ATTEMPTS} attempts, ${DELAY_MS}ms apart, ~${Math.round((ATTEMPTS * DELAY_MS) / 60_000)}min cap)`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const { version: seenVersion, commit: seenCommit, stamp, bytes, encoding } = await checkOnce();
      console.log(`attempt ${attempt}/${ATTEMPTS}: home=${seenVersion}@${seenCommit ?? "(none stamped)"} chat-seed.json(b=${stamp})=${bytes} bytes, decodes as JSON under "${encoding}"`);
      console.log(`${SITE_URL} is serving ${wanted} with a ${bytes}-byte chat-seed.json — the deployed-e2e jobs can start`);
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
