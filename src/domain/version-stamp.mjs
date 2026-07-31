// version-stamp.mjs — the home page's #pkg-version and #pkg-commit elements,
// written and read from one place. Pure: strings in, strings out, no imports,
// so the deploy smoke check can reach it without npm ci.
//
// This existed three times and the copies had already drifted: the writer
// matched [^<]*, the smoke check demanded \d+\.\d+\.\d+, and the estate test
// accepted [^<\s]*. A writer that accepts what its reader rejects is a green
// build and a failed deploy, so the pattern lives here and all three call it.
//
// The version alone cannot say WHICH build the edge is serving. Several
// commits share one version between bumps, so a slow deploy still settling
// while the next push races past it serves the wrong commit under a version
// that checks out. The commit stamp is the precise answer, so the readiness
// poll can tell "still the old build" from "ready".

/** The element that carries the version, and the value inside it. */
const STAMP = /(id="pkg-version"[^>]*>)\s*v?([^<]*?)\s*(<)/;

/** A semver core, which is what the deploy smoke check is entitled to expect. */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** The element that carries the commit, and the value inside it. */
const COMMIT_STAMP = /(id="pkg-commit"[^>]*>)\s*([^<]*?)\s*(<)/;

/** Twelve hex characters of a git object name — long enough that a collision
 *  between two builds of this repo is not a thing that happens, short enough
 *  to read. */
const SHORT_COMMIT = /^[0-9a-f]{12}$/;

/** True iff `html` carries an element the stamp can be written into. */
export function hasVersionStamp(html) {
  return STAMP.test(html);
}

/** The version `html` displays, or null when the element is absent or holds
 *  something that is not a semver core (an unstamped placeholder, say). */
export function parseVersionStamp(html) {
  const found = STAMP.exec(html);
  if (!found) return null;
  const value = found[2].trim();
  return SEMVER.test(value) ? value : null;
}

/** `html` with the stamp set to `version`. Throws when there is nothing to
 *  stamp — a page that lost its element would otherwise publish blank. */
export function stampVersion(html, version) {
  if (!SEMVER.test(version)) throw new Error(`not a stampable version: "${version}"`);
  if (!hasVersionStamp(html)) throw new Error("no #pkg-version element to stamp");
  return html.replace(STAMP, `$1${version}$3`);
}

/** The twelve-character form of a full or already-short git object name. */
export function shortCommit(sha) {
  return String(sha ?? "").trim().toLowerCase().slice(0, 12);
}

/** True iff `html` carries an element the commit stamp can be written into. */
export function hasCommitStamp(html) {
  return COMMIT_STAMP.test(html);
}

/** The commit `html` was built from, or null when the element is absent or
 *  holds something that is not a short object name — which is what the
 *  committed page carries, since a page cannot name the commit that adds it. */
export function parseCommitStamp(html) {
  const found = COMMIT_STAMP.exec(html);
  if (!found) return null;
  const value = found[2].trim().toLowerCase();
  return SHORT_COMMIT.test(value) ? value : null;
}

/** `html` with the commit stamp set to `sha`'s short form. */
export function stampCommit(html, sha) {
  const short = shortCommit(sha);
  if (!SHORT_COMMIT.test(short)) throw new Error(`not a stampable commit: "${sha}"`);
  if (!hasCommitStamp(html)) throw new Error("no #pkg-commit element to stamp");
  return html.replace(COMMIT_STAMP, `$1${short}$3`);
}
