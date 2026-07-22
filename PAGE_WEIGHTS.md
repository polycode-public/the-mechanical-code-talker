# Page weights — the demo site as deployed

What each page of https://the-mechanical-code-talker-36445d.gitlab.io/ costs to
load, measured 2026-07-21 against the live deployment at version 2.9.4 (read
off the home page's `#pkg-version` stamp before measuring). Two methods, and
they agree within header noise: `curl` per asset (raw bytes with no
`accept-encoding`; wire bytes with `accept-encoding: br, gzip` — GitLab Pages
serves the precompressed `.br` siblings the build writes), and a real Chromium
cold load per page (Playwright, CDP `Network.loadingFinished`
`encodedDataLength` summed over every request).

## The seven pages

| page | own HTML (raw) | eager assets (raw) | eager assets (br wire) | cold-load total (wire) | third-party requests |
|---|---:|---:|---:|---:|---:|
| index.html | 18,153 | 4,856,462 | 1,541,298 | 1,546,402 | 0 |
| chat.html | 38,848 | 45,035,285 | 3,141,139 | 3,151,057 | 0 |
| spider-fly.html | 614,718 | 845,819 | 233,567 | 269,923 | 0 |
| ledger.html | 652,024 | 4,497,227 | 1,023,670 | 1,188,941 | 0 |
| adventure.html | 638,500 | 855,135 | 237,588 | 276,409 | 0 |
| sprites.html | 1,290,920 | 4,490,799 | 1,021,426 | 1,067,525 | 0 |
| plan.html | 37,857 | 4,500,964 | 1,024,446 | 1,032,627 | 0 |

Cold-load total is page HTML wire + eager assets wire. The Chromium run
confirmed every page within ~0.1% (response headers account for the gap) and
confirmed the request lists: no page makes any third-party request — every
byte comes from the site's own origin.

**chat.html's row is a local rebuild, not a live re-crawl** (measured
2026-07-22 against a worktree build with `SEED_BAND_CAPS` raised to
conceptnet 7,000 / wordnet-xl 14,000, `scripts/build-chat-seed.mjs`): the six
other rows still reflect the 2.9.4 live deployment. Re-measure chat.html
against the live site once this change actually deploys.

**ingest.html is new and not yet crawled.** Its eager assets are the shared
`vendor/wink.js` (already counted once above) plus its own
`ingest-browser.bundle.js` (~826 KB raw, the same ~830 KB weight class as the
ledger/plan bundles); the page's own HTML is small (~15 KB). Its cold-load
profile tracks plan.html's — wink plus one engine bundle — so it adds no new
shared asset. Give it a real row here the next time the live site is crawled.

Whole set, summing the seven per-page totals (chat.html's local-rebuild row
carried through): **68,372,711 bytes raw (65.2 MB), 8,532,884 bytes wire
(8.1 MB)**. Counting every distinct file once (what a full cold crawl
transfers, since the wink vendor and the service worker script are shared):
**51 files, 53,748,519 bytes raw (51.3 MB), 5,369,088 bytes wire (5.1 MB)**.

## Notes on the numbers

**The shared wink vendor.** `vendor/wink.js` (wink-nlp plus the English lite
model, 3,655,359 raw / 790,260 br) is the single largest shared asset. Five
pages load it eagerly — index, chat, ledger, sprites, plan — but the browser
pays for it once: HTTP cache plus the service worker's precache serve every
later page from the first copy.

**chat.html.** The seed, `chat-seed.json`, is 40,539,765 bytes raw but
2,116,462 on the wire (br compresses the JSON ~19:1, same ratio as before the
caps rose), so chat's whole cold boot is 3.1 MB. The page also fetches
`tmct-sw.js` (2,756) to show the release stamp. The reference pack loads
lazily: `reference-pack/index.json` (104,924 raw / 20,407 br) on the first
citation, then one article JSON per citation (1–4 KB each; 4,224 terms
mapping to 3,887 article files, ~15.5 MB on disk that is never bulk-fetched).
The bigger seed cost only bytes, not boot time: a real-browser measurement
(`e2e/pages-chat-boot-budget.test.mjs`) still grounds the first seeded
answer at ~1.5 s against a 20 s budget, since everything here is local
JSON parsing, not network latency.

**index.html.** Loads the ask demo as unbundled modules: 27 `engine/src/**`
files (772,496 raw / 375,280 wire), `demo-graph.json`, the wink vendor, and
four screenshot PNGs (350,961 bytes, served identity — PNG is already
compressed).

**sprites.html.** Its own HTML carries the embedded sprite data (1,290,920
raw, 46,099 br), plus the dock bundle `sprites-browser.bundle.js` and the
wink vendor.

**The service worker.** index, chat, ledger and plan register `tmct-sw.js`
(adventure and chat also fetch it for the stamp). On install it precaches the
boot tier — `index.html`, `chat.html`, `chat-browser.bundle.js`,
`sprites-browser.bundle.js`, `vendor/wink.js`, `chat-seed.json`,
`reference-pack/index.json` — and serves those cache-first (reference-pack
articles too, once fetched); pages and bundles are network-first with the
cache as offline fallback. So a second visit pays wire cost only for the
page HTML and bundle revalidation, and a fully offline reload of chat works —
`e2e/pages-service-worker.test.mjs` proves it, so it is not re-measured here.

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
