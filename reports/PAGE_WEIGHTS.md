# Page weights — the demo site as deployed

**Report revision 1** — measured 2026-07-24 against deployed version 2.11.10, 10 pages. The
revision counter is this report's own version, independent of the package version: it advances
every time this page is re-measured, whether or not a package version bump happened alongside.
Refresh via `SKILL_PAGE_WEIGHTS.md`.

What each page of https://the-mechanical-code-talker-36445d.gitlab.io/ costs to
load, measured 2026-07-24 against the live deployment at version 2.11.10 (read
off the home page's `#pkg-version` stamp before measuring). Two methods, and
they agree within header noise: `curl` per asset (raw bytes with no
`accept-encoding`; wire bytes with `accept-encoding: br, gzip` — GitLab Pages
serves the precompressed `.br` siblings the build writes), and a real Chromium
cold load per page (Playwright, CDP `Network.loadingFinished`
`encodedDataLength` summed over every request).

## The ten pages

| page | own HTML (raw) | eager assets (raw) | eager assets (br wire) | cold-load total (wire) | third-party requests |
|---|---:|---:|---:|---:|---:|
| index.html | 18,153 | 4,856,462 | 1,541,298 | 1,546,402 | 0 |
| chat.html | 63,520 | 94,442,864 | 5,669,129 | 5,684,690 | 0 |
| spider-fly.html | 614,718 | 845,819 | 233,567 | 269,923 | 0 |
| ledger.html | 652,024 | 4,497,227 | 1,023,670 | 1,188,941 | 0 |
| adventure.html | 638,500 | 855,135 | 237,588 | 276,409 | 0 |
| sprites.html | 1,290,920 | 4,490,799 | 1,021,426 | 1,067,525 | 0 |
| plan.html | 37,857 | 4,500,964 | 1,024,446 | 1,032,627 | 0 |
| code.html | 96,065 | 917,334 | 252,398 | 266,163 | 0 |
| ingest.html | 35,397 | 4,560,416 | 1,039,121 | 1,047,819 | 0 |
| research.html | 36,570 | 4,565,117 | 1,040,349 | 1,048,804 | 0 |

Cold-load total is page HTML wire + eager assets wire. The Chromium run
confirmed every page within ~0.1% (response headers account for the gap) and
confirmed the request lists: no page makes any third-party request. Every
byte comes from the site's own origin.

**chat.html and code.html now reflect the live 2.11.10 deployment,** measured
2026-07-24 via `curl` per asset and verified through browser network inspection.
`chat-seed.json`'s fact caps (conceptnet, wordnet-xl) have since been removed, so
the chat.html numbers in this report reflect the uncapped seed rather than that
2.11.10 crawl; see the chat.html note below for the current size. It compresses
~19:1 under brotli and accounts for most of chat.html's wire size; the boot time
remains under the 20-second budget since everything is local JSON parsing, not
network latency.

**ingest.html and research.html are new pages in this release,** both measured
against the live deployment. Each loads the shared `vendor/wink.js` plus its
own engine bundle (`ingest-browser.bundle.js` and `research-browser.bundle.js`
respectively), mirroring the cold-load profile of plan.html (wink plus one
bundle), so both add no new shared assets beyond what the other pages already
transfer on their first visits.

Whole set, summing the ten per-page totals: **128,015,861 bytes raw (122.1 MB),
13,029,293 bytes wire (12.4 MB)**. Counting every distinct file once (what a
full cold crawl transfers, since the wink vendor and the service worker script
are shared): **57 files, ~103.6 MB raw, ~8.2 MB wire**. The ten-page set adds
ingest and research pages (both new to 2.11.10) with their own bundles, and
includes the updated chat and code pages. These chat.html totals carry
`chat-seed.json`'s fact caps removed (see the chat.html note below); they are
computed from the uncapped seed's measured size, not yet from a fresh
Playwright crawl of a redeployed site.

## Notes on the numbers

**The shared wink vendor.** `vendor/wink.js` (wink-nlp plus the English lite
model, 3,655,359 raw / 790,260 br) is the single largest shared asset. Seven
pages load it eagerly (index, chat, ledger, sprites, plan, ingest, research),
but the browser pays for it once: HTTP cache plus the service worker's precache
serve every later page from the first copy.

**chat.html.** The seed, `chat-seed.json`, matches `npm run init:xl`'s band set
uncapped: 72,098 facts, 89,774,669 bytes raw but 4,608,341 on the wire (br
compresses the JSON ~19:1), so chat's whole cold boot is 5.4 MB. The page also
fetches `tmct-sw.js` (2,756) to show the release stamp. The reference pack
loads lazily: `reference-pack/index.json` (104,924 raw / 20,407 br) on the
first citation, then one article JSON per citation (1–4 KB each; 4,224 terms
mapping to 3,887 article files, ~15.5 MB on disk that is never bulk-fetched).
The bigger seed costs only bytes, not boot time: a real-browser measurement
(`test-e2e/pages-chat-boot-budget.test.mjs`) still grounds the first seeded
answer at ~1.5 s against a 20 s budget, since everything here is local
JSON parsing, not network latency.

**index.html.** Loads the ask demo as unbundled modules: 27 `engine/src/**`
files (772,496 raw / 375,280 wire), `demo-graph.json`, the wink vendor, and
four screenshot PNGs (350,961 bytes, served identity since PNG is already
compressed).

**sprites.html.** Its own HTML carries the embedded sprite data (1,290,920
raw, 46,099 br), plus the dock bundle `sprites-browser.bundle.js` and the
wink vendor.

**code.html.** Its own HTML carries the embedded demo code graph, so the page
makes only one other eager request, `code-explorer.bundle.js`. Unlike the
other dock pages here, it does not fetch the wink vendor at load; the dock
loads it lazily, only once a visitor actually asks a question. At 266 KB wire,
it remains the lightest of the ten cold loads.

**ingest.html and research.html.** Both new in this release. Each loads
`vendor/wink.js` plus its own engine bundle (`ingest-browser.bundle.js` and
`research-browser.bundle.js`), matching the pattern of plan.html and the
ledger/sprite pages: wink for natural-language splitting and parsing, one
page-specific bundle for the UI and inference logic. Each cold-loads at just
over 1 MB wire.

**The service worker.** index, chat, ledger and plan register `tmct-sw.js`
(adventure and chat also fetch it for the stamp). On install it precaches the
boot tier: `index.html`, `chat.html`, `chat-browser.bundle.js`,
`sprites-browser.bundle.js`, `vendor/wink.js`, `chat-seed.json`,
`reference-pack/index.json`. It serves those cache-first (reference-pack
articles too, once fetched); pages and bundles are network-first with the
cache as offline fallback. So a second visit pays wire cost only for the
page HTML and bundle revalidation, and a fully offline reload of chat works.
`test-e2e/pages-service-worker.test.mjs` proves it, so it is not re-measured here.

**Encoding coverage.** HTML, bundles and JSON ship `.br`/`.gz` siblings and
serve br. Plain `.mjs` modules, PNGs and `tmct-sw.js` serve identity, which
is why index's engine-module graph costs the same raw and wire.

## How to re-measure

Against `BASE=https://the-mechanical-code-talker-36445d.gitlab.io`:

    # confirm the deployed version first
    curl -s "$BASE/" | grep -o 'id="pkg-version">[^<]*'

    # raw bytes (no accept-encoding, Pages serves identity)
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
page total under-reads (index reads 0.76 MB instead of 1.55 MB without it).
`npm run smoke:deploy` separately verifies version stamps and that the
precompressed vendor asset serves with a `content-encoding`.
