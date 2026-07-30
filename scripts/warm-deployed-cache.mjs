// Runs right after a CDK deploy, before the post-deploy e2e jobs start: fetches
// the site's largest assets once so CloudFront has them warm at the edge
// before a real browser test needs them. chat-seed.json is ~90 MB and,
// unwarmed, was slow enough on a cold edge that chat.html's own boot gave up
// and fell back to an empty starter memory — a real failure the app's own
// e2e:deployed:pages/shell jobs caught (all 3 retries, deterministically) even
// though the deployed data itself was always complete and valid once fetched.
//
// Best-effort only: a slow or failed warm here doesn't fail the deploy job —
// the e2e jobs downstream are what actually verify the site works, this just
// improves their odds of not racing a cold cache.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { homepage } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const BASE = homepage.endsWith("/") ? homepage : `${homepage}/`;

const WARM_PATHS = ["chat-seed.json", "mud.html", "sprites.html", "adventure.html", "spider-fly.html"];
const FETCH_TIMEOUT_MS = 60_000;
const ATTEMPTS = 3;

async function warmOne(path) {
  const url = new URL(path, BASE).href;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "cache-control": "no-cache", "user-agent": "tmct warm-deployed-cache" },
      });
      const bytes = Number(res.headers.get("content-length") ?? 0);
      const ms = Date.now() - start;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await res.arrayBuffer();
      console.log(`warmed ${path}: ${res.status}, ${(bytes / 1e6).toFixed(1)} MB in ${ms}ms (attempt ${attempt}/${ATTEMPTS})`);
      return;
    } catch (err) {
      console.log(`warm attempt ${attempt}/${ATTEMPTS} for ${path} failed: ${err.message}`);
      if (attempt === ATTEMPTS) console.log(`giving up warming ${path} — the e2e jobs downstream will still verify it`);
    }
  }
}

for (const path of WARM_PATHS) await warmOne(path);
