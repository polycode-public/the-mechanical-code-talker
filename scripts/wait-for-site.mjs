// scripts/wait-for-site.mjs — poll the deployed site until it serves this
// build's version, so the deployed-e2e jobs never race CloudFront still
// settling after a CDK deploy. Site-only: smoke:post-deploy already checks
// the npm/pages pairing separately, in its own stage, for a different
// question (is the published package live) than this one (is the site the
// e2e-deployed jobs are about to hit actually the build that just shipped).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseVersionStamp } from "../src/domain/version-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version, homepage } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const SITE_URL = homepage;
const ATTEMPTS = Number(process.env.WAIT_FOR_SITE_ATTEMPTS ?? 10);
const DELAY_MS = Number(process.env.WAIT_FOR_SITE_DELAY_MS ?? 30_000);
const FETCH_TIMEOUT_MS = 20_000;

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
  if (!stamped) throw new Error("the page shows no version");
  return stamped;
}

async function main() {
  console.log(`waiting for ${SITE_URL} to serve ${version} (up to ${ATTEMPTS} attempts, ${DELAY_MS}ms apart, ~${Math.round((ATTEMPTS * DELAY_MS) / 60_000)}min cap)`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const seen = await siteVersion();
      console.log(`attempt ${attempt}/${ATTEMPTS}: site serves ${seen}`);
      if (seen === version) {
        console.log(`${SITE_URL} is serving ${version} — the deployed-e2e jobs can start`);
        return 0;
      }
    } catch (err) {
      console.log(`attempt ${attempt}/${ATTEMPTS}: ${err.message}`);
    }
    if (attempt < ATTEMPTS) await sleep(DELAY_MS);
  }
  console.error(`gave up after ${ATTEMPTS} attempts — ${SITE_URL} never confirmed serving ${version}.`);
  console.error("the deployed-e2e jobs would likely be racing a still-settling CDN; not worth running them blind.");
  return 1;
}

process.exitCode = await main();
