// version-stamp.mjs — the deployed site's version.txt, written and read from
// one place. Pure: strings in, strings out, no imports, so the deploy smoke
// check can reach it without npm ci.
//
// This used to be a stamp baked into index.html's #pkg-version/#pkg-commit
// elements. That required the committed page to be rewritten (and re-verified
// for drift) on every version bump. version.txt is a plain generated file
// instead, gitignored like every other build output under public/, so there
// is nothing committed for it to drift against.
//
// The version alone cannot say WHICH build the edge is serving. Several
// commits share one version between bumps, so a slow deploy still settling
// while the next push races past it serves the wrong commit under a version
// that checks out. The commit line is the precise answer, so the readiness
// poll can tell "still the old build" from "ready". The timestamp is for a
// human reading a stale-deploy report, not something a script gates on.

/** A semver core, which is what the deploy smoke check is entitled to expect. */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Twelve hex characters of a git object name — long enough that a collision
 *  between two builds of this repo is not a thing that happens, short enough
 *  to read. */
const SHORT_COMMIT = /^[0-9a-f]{12}$/;

/** The twelve-character form of a full or already-short git object name. */
export function shortCommit(sha) {
  return String(sha ?? "").trim().toLowerCase().slice(0, 12);
}

/** version.txt's own three-line body: version, commit (empty outside CI —
 *  a build cannot name the commit that adds it, so there is nothing to write
 *  locally), and the ISO instant this was written. Throws on a version or
 *  commit that isn't stampable, the same guard the old HTML stamp made. */
export function versionFileText({ version, commit = "", timestamp }) {
  if (!SEMVER.test(version)) throw new Error(`not a stampable version: "${version}"`);
  const short = commit ? shortCommit(commit) : "";
  if (commit && !SHORT_COMMIT.test(short)) throw new Error(`not a stampable commit: "${commit}"`);
  return `${version}\n${short}\n${timestamp}\n`;
}

/** version.txt's three fields, read back. `version`/`commit` are null when
 *  their line is absent or doesn't hold what it should — an empty commit
 *  line reads as "no commit stamped" rather than a false match. `timestamp`
 *  is whatever string is there, untouched: it's for display, not grading. */
export function parseVersionFile(text) {
  const [versionLine = "", commitLine = "", timestampLine = ""] = String(text ?? "").split("\n");
  const version = SEMVER.test(versionLine.trim()) ? versionLine.trim() : null;
  const commit = SHORT_COMMIT.test(commitLine.trim().toLowerCase()) ? commitLine.trim().toLowerCase() : null;
  const timestamp = timestampLine.trim() || null;
  return { version, commit, timestamp };
}
