# Page weights — the demo site as deployed

**Report revision 2** — measured 2026-07-30 against deployed version 4.0.0, 11 pages, first
revision since the AWS/CloudFront cutover. Revision 1 measured the old GitLab Pages deployment;
this one measures the live `https://tmct.polycode.co.uk/` edge. The revision counter is this
report's own version, independent of the package version. Refresh via `SKILL_PAGE_WEIGHTS.md`.

What each page of https://tmct.polycode.co.uk/ costs to load, measured 2026-07-30
against the live deployment at version 4.0.0 (read off the home page's
`#pkg-version` stamp before measuring). Two methods, and they agree within
header noise (each page's curl-derived cold-load total sits within about 1%
of the Chromium crawl's `Network.loadingFinished` sum): `curl` per asset (raw
bytes with no `accept-encoding`; wire bytes with `accept-encoding: br, gzip`
— CloudFront serves brotli either by compressing on the fly or, for assets
over its on-the-fly compression ceiling, via a CloudFront Function that
rewrites the request to the build's own precompressed `.br` sibling by
`Accept-Encoding`), and a real Chromium cold load per page (Playwright, CDP
`Network.loadingFinished` `encodedDataLength` summed over every request).

## The eleven pages

| page | own HTML (raw) | eager assets (raw) | eager assets (br wire) | cold-load total (wire) | third-party requests |
|---|---:|---:|---:|---:|---:|
| index.html | 58,001 | 5,520,568 | 2,220,706 | 2,231,327 | 0 |
| chat.html | 118,157 | 94,547,712 | 5,973,788 | 6,004,064 | 0 |
| spider-fly.html | 885,472 | 971,063 | 301,946 | 372,917 | 0 |
| ledger.html | 718,379 | 4,623,517 | 1,300,457 | 1,506,680 | 0 |
| adventure.html | 969,721 | 980,610 | 304,754 | 389,852 | 0 |
| sprites.html | 1,954,186 | 4,615,841 | 1,297,624 | 1,479,469 | 0 |
| plan.html | 43,378 | 4,626,224 | 1,301,356 | 1,312,088 | 0 |
| code.html | 98,461 | 90,751,041 | 4,922,685 | 4,938,985 | 0 |
| ingest.html | 36,225 | 94,396,088 | 5,917,793 | 5,927,753 | 0 |
| research.html | 54,388 | 94,399,340 | 5,918,770 | 5,932,191 | 0 |
| mud.html | 1,014,245 | 1,136,587 | 362,029 | 459,309 | 0 |

Cold-load total is page HTML wire + eager assets wire. The Chromium run confirmed every page
within about 1% (response headers and one client-generated `blob:` object URL on chat.html — 0
wire bytes, not a network request — account for the gap) and confirmed the request lists: no page
makes any third-party request. Every byte comes from the site's own origin.

Whole set, summing the eleven per-page totals: **402,519,204 bytes raw (383.9 MiB),
30,554,635 bytes wire (29.1 MiB)**. Counting every distinct file once (what a full cold crawl
transfers, since the wink vendor, the P2P bundle, `chat-seed.json` and the service worker script
are all shared across several pages): **66 files, ~106.0 MiB raw, ~10.2 MiB wire**.

## What changed since revision 1

Revision 1 measured 10 pages on GitLab Pages at version 2.11.10. This revision adds **mud.html**
(new page, the Lemmings-style P2P mesh burrow) and reflects the AWS cutover plus everything that
shipped in the 2.11.10 → 4.0.0 span:

- **code.html, ingest.html and research.html now eager-load `chat-seed.json`** on cold boot —
  code.html and research.html fetch it unconditionally; ingest.html fetches it because its seed
  toggle defaults to checked. In revision 1, only chat.html paid this cost; these three pages
  were among the lightest cold loads (code.html was the lightest of the ten). Now all three sit
  close to chat.html's weight, around 4.9-5.9 MB wire.
- **chat.html and mud.html both load `vendor/p2p.js`** (151,754 raw / 56,022 br), the P2P mesh
  client — a new shared asset since revision 1, which had no P2P feature yet.
- **`chat-seed.json` itself grew**: 89,774,669 bytes raw, 4,618,279 br (72,098 facts, per the
  cap-removal noted in chat.html's own note below) — up from the capped seed revision 1 measured.
- Several data-embedding pages grew their own HTML: adventure.html's embedded map (638,500 →
  969,721 raw), sprites.html's embedded sprite data (1,290,920 → 1,954,186 raw), ledger.html's
  embedded ledger data (652,024 → 718,379 raw).

## Notes on the numbers

**The shared wink vendor.** `vendor/wink.js` (wink-nlp plus the English lite
model, 3,655,359 raw / 998,548 br) is the single largest shared asset. Seven
pages load it eagerly (index, chat, ledger, sprites, plan, ingest, research) — the same set as
revision 1. code.html, mud.html, adventure.html and spider-fly.html still don't load it eagerly.
The browser pays for it once: HTTP cache plus the service worker's precache serve every later page
from the first copy.

**chat.html.** The seed, `chat-seed.json`, is 72,098 facts, 89,774,669 bytes raw but 4,618,279 on
the wire (br compresses the JSON ~19:1), so chat's whole cold boot is 6.0 MB. The page also fetches
`tmct-sw.js` (2,817 raw / 956 br) to show the release stamp, and now `vendor/p2p.js` for the P2P
mesh feature. The reference pack loads lazily: `reference-pack/index.json` (104,950 raw / 24,431
br) on the first citation, then one article JSON per citation (1-4 KB each; ~3,889 terms mapping to
article files, ~15 MB on disk that is never bulk-fetched). The bigger seed costs only bytes, not
boot time — this report doesn't re-verify the boot budget; see
`test-e2e/pages-chat-boot-budget.test.mjs` for that.

**index.html.** Loads the ask demo as unbundled modules: 27 `engine/src/**`
files, `demo-graph.json`, the wink vendor, and now nine screenshot PNGs (up from eight — mud.html's
screenshot joined the set), 977,504 bytes total for the screenshots alone.

**sprites.html.** Its own HTML carries the embedded sprite data (1,954,186
raw, 181,845 br), plus the dock bundle `sprites-browser.bundle.js` and the
wink vendor.

**code.html.** Its own HTML carries the embedded demo code graph, so the page's eager requests are
`code-explorer.bundle.js` and, new since revision 1, an unconditional `chat-seed.json` fetch for
the dock's general-knowledge answers. It still does not fetch the wink vendor at load — the dock
loads it lazily, only once a visitor actually asks a question — so it remains the page that avoids
the wink cost, even though it's no longer the lightest cold load overall.

**ingest.html and research.html.** Each loads `vendor/wink.js` plus its own engine bundle
(`ingest-browser.bundle.js` and `research-browser.bundle.js`), matching the pattern of plan.html
and the ledger/sprite pages. Both now also eager-load `chat-seed.json`: research.html
unconditionally, ingest.html because its "seed starter memory" checkbox defaults checked (a
visitor who unchecks it and reloads skips the fetch; a cold, cookie-less visit takes the default).

**mud.html.** New in this release: the Lemmings-style P2P mesh burrow. Its own HTML carries the
embedded sprite/room data (1,014,245 raw, 97,280 br); it loads `mud-browser.bundle.js` and
`vendor/p2p.js`, but not the wink vendor — the lightest cold load among the mesh/game-style pages
at 459 KB wire.

**The service worker.** Registration itself (`navigator.serviceWorker.register`) doesn't appear as
a network request when measured with `serviceWorkers: "block"` — that's the point of blocking it.
Three pages separately `fetch()` `tmct-sw.js` as plain text to read its release-stamp comment:
chat, adventure and, new since revision 1, ingest. `test-e2e/pages-service-worker.test.mjs` covers
registration and precache behavior, so it is not re-measured here.

**Encoding coverage — changed from revision 1.** GitLab Pages served the build's own precompressed
`.br` sibling for every compressible file, and left small plain `.mjs` modules and PNGs uncompressed
(identity). CloudFront works differently: it compresses most objects on the fly regardless of file
type, so the `engine/src/**` `.mjs` modules that served identity on Pages now compress under
brotli too (e.g. `wink-model.mjs`: 3,504 raw → 1,450 br). Two exceptions remain identity: files
under CloudFront's on-the-fly compression floor (`module-paths.mjs` and `nlp-registry.mjs`, both
under 1 KB, serve identity), and PNGs (already compressed, so brotli would add work for no
saving). The one asset large enough to sit over CloudFront's on-the-fly compression ceiling,
`chat-seed.json` (89.7 MB raw), is the case revision 1's own methodology note anticipated: a
CloudFront Function rewrites the request to the build's precompressed `.br` sibling by
`Accept-Encoding` rather than compressing it live.

## How to re-measure

Against `BASE=https://tmct.polycode.co.uk`:

    # confirm the deployed version first
    curl -s "$BASE/" | grep -o 'id="pkg-version">[^<]*'

    # raw bytes (no accept-encoding)
    curl -s -o /dev/null -w '%{size_download}' "$BASE/chat.html"

    # wire bytes (curl does not decompress without --compressed,
    # so size_download is the br transfer size)
    curl -s -o /dev/null -H 'Accept-Encoding: br, gzip' \
      -w '%{size_download} %header{content-encoding}' "$BASE/chat.html"

For the browser cross-check: a Playwright script (imported from inside the
repo so `node_modules` resolves) with one fresh context per page, a CDP
session with `Network.enable`, and per-page totals summed from
`Network.loadingFinished` `encodedDataLength`. Pass
`{ serviceWorkers: "block" }` to `newContext`, or the freshly installed
service worker serves precached assets to the page with 0 wire bytes and the
page total under-reads. Watch for client-generated `blob:` object URLs in the
request list (chat.html creates one) — they report 0 `encodedDataLength` and
their `URL.host` parses empty, so a naive same-origin check misreads them as
third-party; treat any non-`http(s)` scheme as same-origin unless proven
otherwise. `npm run smoke:deploy` separately verifies version stamps and that
compressible assets serve with a `content-encoding`.
