// publish-gate.mjs — should this commit publish to npm? Pure: two version
// strings in, a decision and a reason out, no imports, so CI can ask without
// npm ci.
//
// CI asked this with `[ "$PUBLISHED" = "$LOCAL" ]`, which only answers "same".
// A local version BELOW what npm already has — a revert, a bad merge, a branch
// landing behind — reads as "different" and goes to `npm publish`, where the
// registry rejects it and the job fails on a confusing error instead of a clear
// skip. Equality cannot tell "ahead" from "behind"; comparing can.

const CORE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** [major, minor, patch] for a semver string, or null if it isn't one. */
function core(version) {
  const found = CORE.exec(String(version ?? "").trim());
  return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null;
}

/** -1 | 0 | 1 comparing the release cores of `a` and `b`. Pre-release and build
 *  metadata are ignored: this gate decides whether a release moved, and 2.2.0
 *  and 2.2.0-rc.1 are the same release for that purpose. */
export function compareVersions(a, b) {
  const [x, y] = [core(a), core(b)];
  if (!x || !y) throw new Error(`not a comparable version: "${!x ? a : b}"`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Should `local` publish, given the registry currently serves `published`?
 *  `published` is "none" when the package has never been published.
 *  Returns { publish, reason } — the reason is what CI prints either way. */
export function shouldPublish(local, published) {
  if (!core(local)) throw new Error(`not a publishable version: "${local}"`);
  if (published === "none" || published == null || published === "") {
    return { publish: true, reason: `publishing ${local} (nothing published yet)` };
  }
  const order = compareVersions(local, published);
  if (order === 0) return { publish: false, reason: `npm already has ${local} — no version bump in this push, skipping publish` };
  if (order < 0) return { publish: false, reason: `local ${local} is BEHIND npm's ${published} — refusing to publish; the registry would reject it` };
  return { publish: true, reason: `publishing ${local} (npm currently has ${published})` };
}
