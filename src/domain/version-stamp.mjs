// version-stamp.mjs — the home page's #pkg-version element, written and read
// from one place. Pure: strings in, strings out, no imports, so the deploy
// smoke check can reach it without npm ci.
//
// This existed three times and the copies had already drifted: the writer
// matched [^<]*, the smoke check demanded \d+\.\d+\.\d+, and the estate test
// accepted [^<\s]*. A writer that accepts what its reader rejects is a green
// build and a failed deploy, so the pattern lives here and all three call it.

/** The element that carries the version, and the value inside it. */
const STAMP = /(id="pkg-version"[^>]*>)\s*v?([^<]*?)\s*(<)/;

/** A semver core, which is what the deploy smoke check is entitled to expect. */
const SEMVER = /^\d+\.\d+\.\d+$/;

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
