// Builds the Pages site into a private directory so a browser test can serve it.
//
// `npm run demo:build` writes into the repo's own public/, and two other e2e
// files run that same build. node runs e2e files concurrently, so a test that
// served public/ directly could read a file while another build was rewriting
// it. Pointing the build at a temp directory of our own removes the shared
// path, so nothing here depends on what the other files are doing.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHARED_STYLESHEET, TRACKED_PAGES } from "../../scripts/site-pages.mjs";

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

// The git-tracked half of public/. The build generates the rest (engine/,
// demo-graph.json, demo-memory.json, ledger.html, plan.html) into the same
// directory. The hand-authored pages and their shared stylesheet come from
// scripts/site-pages.mjs, the one place the page list lives.
const TRACKED_SITE_FILES = [
  ...TRACKED_PAGES,
  SHARED_STYLESHEET,
  "share.mjs",
  "about-nav.mjs",
  "demo-ui.mjs",
  "demo-templates.mjs",
  "tmct-browser.mjs",
  "engine-shims",
  "screenshots",
  "og",
  "models",
];

/**
 * Build the site into a fresh temp directory and return its path.
 * The caller owns the directory for the lifetime of the test run.
 *
 * When TMCT_E2E_BASE_URL is set, the test is pointed at an already-deployed
 * site instead (see static-server.mjs's serveDirectory), so there is nothing
 * local to build. Returns undefined; callers already guard the temp-dir
 * cleanup on a truthy siteDir.
 *
 * `outDir` (optional) rebuilds into an already-existing directory in place
 * instead of minting a new one — a second call against the first call's own
 * `siteDir` simulates a redeploy served from the same path, which is what a
 * cache-busting test needs. `versionOverride` (optional) drives the build's
 * own TMCT_DEMO_VERSION_OVERRIDE (see build-demo-site.mjs's siteVersion),
 * so two builds can differ in the version they stamp and the service
 * worker's cache name embeds without touching the repo's package.json.
 */
export function buildDemoSiteSnapshot({ outDir, versionOverride } = {}) {
  if (process.env.TMCT_E2E_BASE_URL) return undefined;
  const siteDir = outDir ?? mkdtempSync(path.join(tmpdir(), "tmct-site-"));
  for (const entry of TRACKED_SITE_FILES) {
    cpSync(path.join(repoRoot, "public", entry), path.join(siteDir, entry), { recursive: true });
  }
  // Precompression off: these snapshots are served by the plain static test
  // server, which never serves the .gz/.br siblings, and brotli at quality 11
  // costs real seconds per build across every e2e file that builds one.
  execFileSync("npm", ["run", "demo:build"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TMCT_DEMO_SITE_OUT: siteDir,
      TMCT_DEMO_PRECOMPRESS: "0",
      ...(versionOverride ? { TMCT_DEMO_VERSION_OVERRIDE: versionOverride } : {}),
    },
    encoding: "utf8",
    timeout: 300_000,
  });
  return siteDir;
}
