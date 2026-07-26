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

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

// The git-tracked half of public/. The build generates the rest (engine/,
// demo-graph.json, demo-memory.json, ledger.html, plan.html) into the same
// directory.
const TRACKED_SITE_FILES = ["index.html", "demo-ui.mjs", "demo-templates.mjs", "tmct-browser.mjs", "engine-shims", "screenshots"];

/**
 * Build the site into a fresh temp directory and return its path.
 * The caller owns the directory for the lifetime of the test run.
 *
 * When TMCT_E2E_BASE_URL is set, the test is pointed at an already-deployed
 * site instead (see static-server.mjs's serveDirectory), so there is nothing
 * local to build. Returns undefined; callers already guard the temp-dir
 * cleanup on a truthy siteDir.
 */
export function buildDemoSiteSnapshot() {
  if (process.env.TMCT_E2E_BASE_URL) return undefined;
  const siteDir = mkdtempSync(path.join(tmpdir(), "tmct-site-"));
  for (const entry of TRACKED_SITE_FILES) {
    cpSync(path.join(repoRoot, "public", entry), path.join(siteDir, entry), { recursive: true });
  }
  // Precompression off: these snapshots are served by the plain static test
  // server, which never serves the .gz/.br siblings, and brotli at quality 11
  // costs real seconds per build across every e2e file that builds one.
  execFileSync("npm", ["run", "demo:build"], {
    cwd: repoRoot,
    env: { ...process.env, TMCT_DEMO_SITE_OUT: siteDir, TMCT_DEMO_PRECOMPRESS: "0" },
    encoding: "utf8",
    timeout: 300_000,
  });
  return siteDir;
}
