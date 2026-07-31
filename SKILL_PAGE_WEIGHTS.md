# SKILL_PAGE_WEIGHTS.md — re-measure and refresh reports/PAGE_WEIGHTS.md

This skill re-measures what every page of the deployed demo site costs to load, and rewrites
`reports/PAGE_WEIGHTS.md` with the result. It is written so that a page being added or removed
from the site since this skill was last touched never requires editing this file — the page list
is discovered fresh each run, never hardcoded here.

> **Invoke it by telling a session:** *"Follow `SKILL_PAGE_WEIGHTS.md`"*, or "refresh page
> weights".

## When to run this

- The deployed site's version has moved meaningfully since `reports/PAGE_WEIGHTS.md`'s own
  "Report revision" line — a new page, a materially larger/smaller bundle, a new shared asset.
- A page was added to or removed from `public/`.
- The operator asks for it directly.

Not every version bump needs a re-measurement — a docs-only or backend-only release changes
nothing about page weight. Use judgment; the report's own age (its "Report revision" line's
measured date and deployed version) is the signal.

## 1. Discover the page list — never hardcode it

`public/` is a gitignored build output (`CLAUDE.md`'s project section: it goes stale the moment
`src/` moves). Before anything else:

    npm run demo:build

Then enumerate what actually exists:

    ls public/*.html

**This list — not a list written into this skill file — is the set of pages to measure.** If a
page was added or removed since the last refresh, this command already reflects it; nothing
about this skill's own text needs to change. Confirm the deployed site agrees with the local
build's page set before measuring (a page can exist locally before it ships) — either check the
home page's own nav/links against the enumerated list, or accept a brief lag if the operator
confirms the deploy is current.

## 2. Confirm the deployed version

    BASE=https://tmct.polycode.co.uk
    curl -s "$BASE/" | grep -o 'id="pkg-version">[^<]*'

Record this exact version string — it is what the new report revision stamps itself against. If
it doesn't match `package.json`'s current version, the deployed site is behind a pending
release; note that in the report rather than treating the two as interchangeable.

## 3. Measure each page, two ways

For every page in the §1 list, against `$BASE`:

- **Raw bytes** (`curl`, no `accept-encoding`):
  `curl -s -o /dev/null -w '%{size_download}' "$BASE/<page>"`
- **Wire bytes** (`curl` with `accept-encoding: br, gzip` — CloudFront compresses most assets on
  the fly; for the few over its compression size ceiling, a CloudFront Function rewrites the
  request to the precompressed `.br`/`.gz` sibling by `Accept-Encoding`):
  `curl -s -o /dev/null -H 'Accept-Encoding: br, gzip' -w '%{size_download} %header{content-encoding}' "$BASE/<page>"`
- **Cold-load total and third-party request count**: a real Chromium cold load per page
  (Playwright, CDP `Network.enable`, sum `Network.loadingFinished`'s `encodedDataLength` over
  every request in a fresh context). Pass `{ serviceWorkers: "block" }` to `newContext` — a
  freshly installed service worker serves precached assets at 0 wire bytes and under-reads the
  page's true first-visit cost.

The two methods should agree within header noise (confirmed each prior revision); if they
diverge by more than a percent or two on any page, that's a finding worth a sentence in the
report, not a discrepancy to silently average away.

Also record eager-asset totals (own HTML + everything the page's own load fetches, excluding
lazy/on-demand fetches like the ledger reference pack) in both raw and wire bytes, matching the
existing table's columns.

## 4. Compose the new revision

Rewrite `reports/PAGE_WEIGHTS.md`:

- **Bump the "Report revision" line**: increment the counter, update the measured date and the
  deployed version string from §2, update the page count if it changed.
- **The per-page table**: one row per page discovered in §1 — the table's row count is however
  many pages exist today, not a fixed ten.
- **Notes on the numbers**: keep the per-page prose notes that still apply verbatim; update or
  add a note for any page whose profile changed materially (a new shared asset, a bundle that
  grew, a page that's new since the last revision — describe what it loads and why, following
  the existing notes' style).
- **Whole-set totals**: recompute both the "summing every page" total and the "counting every
  distinct file once" total (the real cold-crawl cost, since assets like the wink vendor and
  service worker are shared across pages).
- **"How to re-measure"**: keep this section's methodology description current — if the
  measurement approach itself changed (a new shared asset class, a new compression scheme), say
  so here so the next revision doesn't have to rediscover it.

## 5. Verify and ship

- Cross-check the browser and curl numbers agree (§3).
- `npm run check:links` (the report may gain/lose cross-references).
- Commit reports/PAGE_WEIGHTS.md alone or alongside whatever prompted the re-measurement, citing
  the old and new revision numbers in the commit message.
- If `reports/STATUS.md` exists and its own site-weight pointer references a stale revision
  number or date, refresh it too via `SKILL_REFRESH_STATUS.md` — that skill only reads this
  report, so run this one first.

## What NOT to do

- Don't hand-list the pages anywhere in this skill file. The whole point of §1 is that the list
  lives in `public/`, discovered fresh, every run.
- Don't measure against a local build's dev server — this report is about what a real visitor's
  browser pays against the live deployment, not local-loopback timing.
- Don't roll the "Report revision" counter without an actual fresh measurement backing every
  number that changes.
