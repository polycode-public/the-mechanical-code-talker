# Page weights — the demo site as deployed

**Report revision 3** — measured 2026-08-02 against deployed version 5.0.5, 23 pages. Revision 2
measured 11 pages at version 4.0.0, just after the AWS/CloudFront cutover. This revision adds
**mudiii.html** (the 3D scene) and **eleven new about pages**, one per game/demo page except
index.html itself. Refresh via `.claude/skills/page-weights/SKILL.md`.

What each page of https://tmct.polycode.co.uk/ costs to load, measured 2026-08-02
against the live deployment at version 5.0.5 (read off `version.txt`, which matches
`package.json`). Two methods, and they agree within a few percent (see "How to
re-measure" for the gap on the small about pages): `curl` per asset (raw
bytes with no `accept-encoding`; wire bytes with `accept-encoding: br, gzip`
— CloudFront serves brotli either by compressing on the fly or, for assets
over its on-the-fly compression ceiling, via a CloudFront Function that
rewrites the request to the build's own precompressed `.br` sibling by
`Accept-Encoding`), and a real Chromium cold load per page (Playwright, CDP
`Network.loadingFinished` `encodedDataLength` summed over every request).

## The 23 pages

| page | own HTML (raw) | eager assets (raw) | eager assets (br wire) | cold-load total (wire) | third-party requests |
|---|---:|---:|---:|---:|---:|
| index.html | 85,582 | 5,727,271 | 2,370,227 | 2,379,779 | 0 |
| chat.html | 150,843 | 98,234,893 | 5,864,528 | 5,902,486 | 0 |
| chat-about.html | 17,128 | 134,826 | 117,550 | 122,803 | 0 |
| spider-fly.html | 4,682,757 | 4,737,144 | 1,333,552 | 1,827,599 | 0 |
| spider-fly-about.html | 14,395 | 199,027 | 181,751 | 186,132 | 0 |
| ledger.html | 795,486 | 4,739,419 | 1,334,610 | 1,561,556 | 0 |
| ledger-about.html | 14,900 | 96,847 | 79,571 | 84,114 | 0 |
| adventure.html | 4,759,120 | 1,093,546 | 339,408 | 854,947 | 0 |
| adventure-about.html | 15,586 | 97,815 | 80,539 | 85,151 | 0 |
| sprites.html | 4,162,397 | 4,733,379 | 1,332,544 | 1,832,528 | 0 |
| sprites-about.html | 13,930 | 96,539 | 79,263 | 83,252 | 0 |
| plan.html | 47,368 | 4,743,597 | 1,336,080 | 1,347,657 | 0 |
| plan-about.html | 15,809 | 96,320 | 79,044 | 83,855 | 0 |
| code.html | 103,968 | 94,591,161 | 4,870,216 | 4,888,233 | 0 |
| code-about.html | 14,195 | 154,908 | 137,632 | 141,753 | 0 |
| ingest.html | 45,650 | 98,235,841 | 5,864,413 | 5,877,061 | 0 |
| ingest-about.html | 13,679 | 136,743 | 119,467 | 123,572 | 0 |
| research.html | 56,798 | 98,237,478 | 5,865,235 | 5,879,394 | 0 |
| research-about.html | 15,038 | 100,210 | 82,934 | 87,393 | 0 |
| mud.html | 4,852,821 | 1,272,863 | 404,183 | 942,926 | 0 |
| mud-about.html | 14,425 | 155,839 | 138,563 | 142,943 | 0 |
| mudiii.html | 264,268 | 2,675,784 | 1,304,860 | 1,339,934 | 0 |
| mudiii-about.html | 14,631 | 80,874 | 63,598 | 68,046 | 0 |

Cold-load total is page HTML wire + eager assets wire. The Chromium run confirmed every page's
total within about 1% on the bigger pages and up to about 2.4% on the smallest about pages — the
gap grows on small pages because CDP's `encodedDataLength` counts response headers and `curl`'s
`size_download` doesn't, and headers are a bigger share of a 5 KB response than a 5 MB one. The
Chromium run also confirmed the request lists: no page makes any third-party request. Every byte
comes from the site's own origin.

Whole set, summing the 23 per-page totals: **440,543,098 bytes raw (420.1 MiB),
35,843,114 bytes wire (34.2 MiB)**. Counting every distinct file once (what a full cold crawl
transfers, since the wink vendor, `chat-seed.json`, `site.css` and the other shared files count
once no matter how many pages load them): **93 files, 126.9 MiB raw, 13.4 MiB wire** — up from
revision 2's 66 files, 106.0 MiB raw, 10.2 MiB wire.

## What changed since revision 2

Revision 2 measured 11 pages at version 4.0.0. This revision adds 12 pages — **mudiii.html** and
**11 about pages** (one per game/demo page: chat, spider-fly, ledger, adventure, sprites, plan,
code, ingest, research, mud, mudiii) — and reflects the 4.0.0 → 5.0.5 span:

- **The 11 about pages are exactly as light as their job needs.** Each is its own small HTML file
  (13.7-17.1 KB raw) plus three shared requests: `site.css` (22,115 raw / 5,644 br), `about-nav.mjs`
  (1,448 raw / 643 br), and the one screenshot PNG matching its page. No about page loads the wink
  vendor, a browser bundle, or `chat-seed.json`. The heaviest is spider-fly-about.html at 186,132
  wire, entirely because spider-fly's own screenshot (176,057 wire) is the biggest of the eleven.
  The lightest is mudiii-about.html at 68,046 wire.
- **mudiii.html, the 3D scene, is not one of the heaviest pages despite carrying model binaries.**
  Its cold-load total is 1,339,934 wire: the page's own embedded scene data (35 KB wire), the
  bundle (336 KB wire), `vendor/three.js` (197,052 wire, a new shared asset), and nine `.glb`
  models (771,756 bytes, raw and wire the same since glTF binaries are already compressed and
  brotli adds nothing). `fox.glb` is the single biggest model at 333,528 bytes, about 43% of the
  nine models' combined weight — the rest (four houses, an inn, a market stand, a well, a goblin,
  a haybale) are all under 105 KB each. mudiii.html's total sits below chat.html, research.html,
  ingest.html and code.html, all of which are heavier purely from `chat-seed.json`.
- **spider-fly.html newly loads `vendor/wink.js` eagerly.** Revision 2 had it among the pages that
  skipped the wink cost (with code.html, mud.html and adventure.html). It no longer does — its own
  HTML also grew sharply (885,472 → 4,682,757 raw), driven by a much bigger embedded `SPIDERFLY`
  JSON blob that now carries inline SVG artwork for its creatures. adventure.html, sprites.html,
  ledger.html and mud.html also carry larger embedded data than revision 2 measured, part of the
  same wave of content growth.
- **chat.html no longer eager-loads `vendor/p2p.js`.** Revision 2 had chat.html and mud.html both
  loading it on cold boot. chat.html's own source shows why: the P2P mesh module is now a dynamic
  `import()` behind `loadP2p()`, fetched only once a visitor actually starts or joins a session.
  mud.html still loads `vendor/p2p.js` eagerly (65,354 wire) — it's a P2P burrow by default, so
  there's no idle state to defer past.
- **`chat-seed.json` grew**: 93,496,025 bytes raw, 4,530,216 br — up from revision 2's 89,774,669
  raw. chat.html, code.html, ingest.html and research.html all still eager-load it on cold boot,
  the same four pages as revision 2.

## Notes on the numbers

**The shared wink vendor.** `vendor/wink.js` (wink-nlp plus the English lite model, 3,655,359 raw
/ 998,697 br) is unchanged in size since revision 2 and remains the single largest shared asset.
Eight pages now load it eagerly (index, chat, spider-fly, ledger, sprites, plan, ingest,
research) — spider-fly joining the seven from revision 2. code.html, mud.html, mudiii.html,
adventure.html, and none of the 11 about pages, load it eagerly. The browser pays for it once:
HTTP cache plus the service worker's precache serve every later page from the first copy.

**chat.html, code.html, ingest.html, research.html.** These four eager-load `chat-seed.json`
(4,530,216 br) on cold boot, which is why they're the four heaviest pages on the site (4.9-5.9 MB
wire) regardless of what else they load. chat.html additionally loads `vendor/wink.js` (999,720
wire) and `tmct-sw.js`; code.html loads neither, so it's the lightest of the four despite carrying
the same seed. The reference pack still loads lazily on first citation, not counted here.

**index.html.** Loads the ask demo as unbundled modules (27 `engine/src/**` files, `demo-graph.json`,
the wink vendor) plus 11 screenshot PNGs (up from nine — mudiii.html and every new about page's
screenshot joined the set) and `share.mjs`, 46 requests in total, the most of any page. Its
own-HTML growth (58,001 → 85,582 raw) tracks the extra nav links to the new pages.

**sprites.html, ledger.html, plan.html.** Each carries its own embedded data (sprite data, ledger
data, plan definitions) plus the dock bundle for its page and the wink vendor, the same shape as
revision 2. sprites.html and ledger.html both grew their embedded data further this cycle.

**code.html.** Its own HTML carries the embedded demo code graph. It still does not fetch the wink
vendor at load — the dock loads it lazily, only once a visitor actually asks a question — so it
stays the lightest of the four `chat-seed.json` pages even though it's no longer the lightest page
overall.

**mud.html.** The Lemmings-style P2P mesh burrow. Its own HTML carries the embedded sprite/room
data (4,852,821 raw, grown from revision 2's 1,014,245); it loads `mud-browser.bundle.js` and
`vendor/p2p.js` eagerly, not the wink vendor.

**The near-identical bundle sizes across pages are by design, not duplication worth chasing.**
Every page-specific `*-browser.bundle.js` (adventure, chat, code-explorer, ingest, ledger, mud,
mudiii, plan, research, spider-fly, sprites) sits in a tight band, 1.08-1.10 MB raw / 334-340 KB
wire. `scripts/build-demo-site.mjs`'s own comments say why: each page gets "its own dedicated
browser bundle (the full turn engine...)" so the page works standalone. This is a stated design
choice in the build script, not an accidental bundle-included-twice bug.

**The service worker.** Registration itself doesn't appear as a network request when measured with
`serviceWorkers: "block"` — that's the point of blocking it. Three pages separately `fetch()`
`tmct-sw.js` as plain text to read its release-stamp comment: chat, adventure and ingest, the same
three as revision 2.

**Encoding coverage.** Unchanged from revision 2: CloudFront compresses most objects on the fly
regardless of file type. Two exceptions still serve identity: files under CloudFront's on-the-fly
compression floor (`module-paths.mjs` and `nlp-registry.mjs`, both under 1 KB), and already-
compressed binaries (PNGs and, new this revision, the `.glb` models — brotli adds nothing to
glTF's own binary packing). `chat-seed.json` (93.5 MB raw) still sits over CloudFront's on-the-fly
compression ceiling; a CloudFront Function rewrites the request to the build's precompressed `.br`
sibling by `Accept-Encoding`.

## How to re-measure

Against `BASE=https://tmct.polycode.co.uk`:

    # confirm the deployed version first
    curl -s "$BASE/version.txt" | head -1

    # discover the page list from the deployed home page's own links,
    # not from a local build — this report measures what a visitor gets
    curl -s "$BASE/" | grep -o 'href="[^"]*\.html"'

    # raw bytes (no accept-encoding)
    curl -s -o /dev/null -w '%{size_download}' "$BASE/chat.html"

    # wire bytes (curl does not decompress without --compressed,
    # so size_download is the br transfer size)
    curl -s -o /dev/null -H 'Accept-Encoding: br, gzip' \
      -w '%{size_download} %header{content-encoding}' "$BASE/chat.html"

For the browser cross-check: a Playwright script with one fresh context per page, a CDP
session with `Network.enable`, and per-page totals summed from `Network.loadingFinished`
`encodedDataLength`. Pass `{ serviceWorkers: "block" }` to `newContext`, or the freshly installed
service worker serves precached assets to the page with 0 wire bytes and the page total
under-reads. Watch for client-generated `blob:` object URLs in the request list (chat.html and
mudiii.html both create them) — they report 0 `encodedDataLength` and their `URL.host` parses
empty, so a naive same-origin check misreads them as third-party; treat any non-`http(s)` scheme
as same-origin unless proven otherwise. This revision found the CDP total runs about 1-2.4% above
the curl-summed total, largest on the smallest pages (see the table's note) — that gap is response
headers, not a measurement error, so don't chase it to zero. `npm run smoke:deploy` separately
verifies version stamps and that compressible assets serve with a `content-encoding`.

## First paint on the four heavy pages (2026-08-05)

Wire weight is already solved (brotli precompression, ~1.8 MB on the heaviest page). The open
question was whether first paint waits on the multi-megabyte embedded payload adventure.html,
mud.html, spider-fly.html and sprites.html each carry in their own HTML (raw `own HTML` column
above, 3.7-4.9 MB per page).

Measured cold-load first contentful paint (FCP) with Playwright CDP against a local static
server of a fresh `npm run demo:build` (version 5.0.7): a fresh browser context per run,
`{ serviceWorkers: "block" }` so no precached response shortcuts the load, `performance
.getEntriesByType("paint")` read from the page after `waitUntil: "load"`. Three cold runs per
page, median reported (the browser's own `first-contentful-paint` and `first-paint` entries
were identical on every run, since these pages have no separate non-content first paint).

| page | responseStart (median, ms) | FCP (median, ms) | FCP after first byte (median, ms) |
|---|---:|---:|---:|
| adventure.html | 4.3 | 164 | 159.7 |
| mud.html | 4.9 | 212 | 207.1 |
| spider-fly.html | 4.1 | 136 | 131.9 |
| sprites.html | 3.4 | 124 | 120.6 |

All four sit far under the 500ms threshold — the worst single run across 12 cold loads was
312ms (mud.html), still well clear. The browser paints the shell before the embedded payload
is parsed, so the multi-megabyte JSON blob these pages carry does not stall first paint. No
splash was added: the stop rule in `PLAN_PUBLISH.md`'s T6 only calls for one past 500ms, and
none of the four crossed it. No payload splitting either, for the same reason.

This is a local-loopback measurement (no network latency), matching what "first paint" means
for a visitor whose connection has already delivered the HTML's opening bytes — CloudFront's own
time-to-first-byte is a separate, already-monitored concern (`npm run smoke:deploy`), not what
this measurement targets.
