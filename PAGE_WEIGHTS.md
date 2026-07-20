# Page weights — the-mechanical-code-talker-36445d.gitlab.io

Measured with `curl -w '%{size_download}'` against the live GitLab Pages
deployment on 2026-07-20. The site sends no `content-encoding` (no gzip/br),
so these are the real transfer bytes, not just file-on-disk bytes.

## index.html (the root page)

`index.html` embeds `spider-fly.html` in an `<iframe>` (as `?preview=1`) and
links to the other five pages. Its own load weight:

| asset | bytes |
|---|---:|
| index.html | 21,124 |
| chat-browser.bundle.js | 1,560,981 |
| chat-ui.mjs | 11,590 |
| demo-ui.mjs | 8,462 |
| embedded spider-fly.html | 614,657 |
| embedded spider-fly-browser.bundle.js | 1,576,655 |
| **total** | **3,793,469 (3.79 MB)** |

## The linked pages, each on its own

| page | own HTML | eager extra assets | total bytes | total |
|---|---:|---|---:|---:|
| spider-fly.html | 614,657 | spider-fly-browser.bundle.js 1,576,655 | 2,191,312 | 2.19 MB |
| ledger.html | 1,127,053 | ledger-browser.bundle.js 1,571,966 | 2,699,019 | 2.70 MB |
| adventure.html | 71,387 | adventure-browser.bundle.js 1,591,010; sprites-pack/manifest.json 560,193 | 2,222,590 | 2.22 MB |
| sprites.html | 1,202,817 | none | 1,202,817 | 1.20 MB |
| plan.html | 37,589 | plan-browser.bundle.js 1,579,084; wink-nlp + wink-eng-lite-web-model (CDN, esm.sh) 3,655,472 | 5,272,145 | 5.27 MB |
| chat.html | 16,959 | chat-browser.bundle.js 1,560,981; chat-seed.json 1,544,103 | 3,122,043 | 3.12 MB |

Notes on what "eager" means here — checked in the page source, not guessed:

- Every page except `sprites.html` pulls in one big `*-browser.bundle.js`
  (1.5–1.6 MB each). `chat-browser.bundle.js` is the same file on both
  `index.html` and `chat.html`, so a cached second visit doesn't pay for it
  twice.
- `plan.html` is the only page whose `<script type="importmap">` actually
  maps `wink-nlp` / `wink-eng-lite-web-model` to esm.sh, so it's the only
  page where that dynamic `import()` succeeds — and it pulls down the real
  files behind that CDN redirect, which run to about 3.6 MB, almost all of
  it the language model. `chat.html` and `ledger.html` run the same
  `import("wink-nlp")` call but ship **no** import map, so in production
  that import rejects immediately and falls back with no network request —
  0 bytes, not a hidden 3.6 MB.
- `adventure.html` fetches `sprites-pack/manifest.json` (560 KB) at load,
  per the comment in its own source; that manifest is itself an index into
  a larger, on-demand 400px sprite tier that isn't counted here because it
  loads per-sprite, not on page open.
- `chat.html` fetches `chat-seed.json` (1.5 MB) at boot. It also fetches a
  tiny `reference-pack/index.json` (1.1 KB) and per-article JSON files, but
  only once a citation is opened — not part of initial page weight.

## The whole set

Sum of the seven pages above, each measured on its own (this double-counts
`spider-fly.html` and its bundle, since `index.html` embeds them too):

**20,503,395 bytes ≈ 20.5 MB**

If you instead count every distinct file once — the number a full,
warm-cache crawl of the whole site would actually transfer, folding in the
shared `chat-browser.bundle.js` and the `spider-fly.html` embed — it's:

**16,751,102 bytes ≈ 16.75 MB**

## Playwright-verified network behaviour (baseline, pre-fix)

Measured 2026-07-20 against the same live deployment with a real Chromium
(Playwright 1.61.1), one fresh browser context per page. Each page's total is
the sum of `Network.loadingFinished` `encodedDataLength` values from a CDP
session attached to the page — the real transferred bytes, after whatever
compression actually happened, not a `curl` byte count. Console and
page-error listeners ran on every page to catch the wink-nlp import
rejecting. This is the "pre-fix" baseline: `chat.html` and `ledger.html`
still ship no import map at this point.

Traces (screenshots + snapshots) are saved at
`/private/tmp/claude-501/-Users-antony-projects-polycode-projects-the-mechanical-code-talker/4559e392-80fe-4f70-92a2-fdb8c7dd16fd/scratchpad/pageweight-traces/{index,spider-fly,ledger,adventure,sprites,plan,chat}.zip`.

### index.html — corrected total: 7,479,842 bytes ≈ 7.48 MB (was 3.79 MB)

This is the one confirmed miss in the static analysis, and it's a big one:
the static count only ever looked at the chat widget's own scripts and the
embedded `spider-fly.html`. It never followed what `chat-ui.mjs` actually
does at boot — load wink-nlp from esm.sh via the page's own hand-authored
import map, pull in ~30 unbundled `engine/src/**` source modules one file at
a time (a dynamic `import()` graph, not the bundled `chat-browser.bundle.js`
path), and fetch both `demo-graph.json` and `chat-seed.json`. All of that is
real, and none of it was in the 3,793,469-byte figure. No console warning
fired — the wink-nlp CDN load and the seed fetch both succeeded.

Breakdown of the real 7,479,842 bytes:

| group | bytes |
|---|---:|
| index.html (own doc) | 21,391 |
| embedded spider-fly.html + spider-fly-browser.bundle.js (iframe) | 2,192,659 |
| chat widget scripts (chat-ui.mjs, demo-ui.mjs, chat-browser.bundle.js, viz-ticker.mjs, tmct-browser.mjs, chat-demos.mjs, demo-templates.mjs) | 1,598,814 |
| unbundled `engine/src/**` modules (≈30 separate files, dynamic import graph) | 774,743 |
| demo-graph.json | 60,457 |
| wink-nlp CDN (esm.sh wink-nlp@2.4.0 + wink-eng-lite-web-model@1.8.1, succeeded) | 1,286,702 |
| chat-seed.json | 1,545,076 |

**Correction: +3,686,373 bytes, roughly double the number in the static
section above.** The old total undercounted the page by not tracing what its
own embedded widget loads at runtime.

### spider-fly.html — 2,192,890 bytes ≈ 2.19 MB (static: 2.19 MB, confirmed)

Two requests only: `spider-fly.html` (615,249 bytes) and
`spider-fly-browser.bundle.js` (1,577,641 bytes). No third-party requests.
Matches the static figure to within ~1.6 KB (header/encoding noise) — no
correction.

### ledger.html — 2,700,853 bytes ≈ 2.70 MB (static: 2.70 MB, confirmed)

Two requests only: `ledger.html` (1,127,924 bytes) and
`ledger-browser.bundle.js` (1,572,929 bytes). **No esm.sh request of any
kind appears** — the wink-nlp dynamic import did not reach the network.
Direct evidence, a console warning fired on load:

> `[warning] tmct ledger: wink-nlp CDN load failed, continuing without the
> lemma/POS tier TypeError: Failed to resolve module specifier 'wink-nlp'`

This confirms the static claim exactly: no import map, so the import
rejects immediately, costs 0 bytes, and the page falls back gracefully
(caught, not an uncaught page error). No correction.

### adventure.html — 2,224,288 bytes ≈ 2.22 MB (static: 2.22 MB, confirmed)

`adventure.html` (71,681) + `adventure-browser.bundle.js` (1,591,968) +
`sprites-pack/manifest.json` (560,639). Matches the static figure to within
~1.7 KB — no correction.

### sprites.html — 1,203,733 bytes ≈ 1.20 MB (static: 1.20 MB, confirmed)

One request: `sprites.html` itself. Matches the static figure to within
~1 KB — no correction.

### plan.html — corrected total: 2,904,621 bytes ≈ 2.90 MB (was 5.27 MB)

The wink-nlp CDN import map claim holds — `plan.html` is the one page in
this set where the import map is present and the dynamic import actually
resolves and pulls the CDN files down; no console warning fired. But the
static analysis's separate `curl` measurement of the wink-nlp +
wink-eng-lite-web-model payload (3,655,472 bytes) overstates what a real
page load actually transfers by more than double. The real CDP-measured
wink CDN payload — `wink-nlp@2.4.0` stub + `wink-nlp.mjs` +
`wink-eng-lite-web-model@1.8.1` stub + `wink-eng-lite-web-model.mjs` — comes
to **1,286,722 bytes ≈ 1.29 MB**, almost all of it the one model file
(1,270,138 bytes).

| group | bytes |
|---|---:|
| plan.html (own doc) | 37,866 |
| plan-browser.bundle.js | 1,580,033 |
| wink-nlp CDN (esm.sh, succeeded) | 1,286,722 |

**Correction: −2,367,524 bytes, the static figure was about 1.8× too high.**
The import-map claim (this is the one page where wink-nlp loads) is
confirmed; the byte estimate behind it was not.

### chat.html — 3,124,212 bytes ≈ 3.12 MB (static: 3.12 MB, confirmed)

`chat.html` (17,226) + `chat-browser.bundle.js` (1,561,921) +
`chat-seed.json` (1,545,065). **No esm.sh request appears.** Direct
evidence, a console warning fired on load:

> `[warning] tmct chat: wink-nlp CDN load failed, continuing without the
> lemma/POS tier TypeError: Failed to resolve module specifier 'wink-nlp'`

Confirms the static claim exactly: no import map, the import rejects
immediately, 0 bytes, graceful fallback. Matches the static figure to
within ~2.2 KB — no correction beyond that noise.

### The whole set, real numbers

Summing the seven real per-page totals above (same double-count of
`spider-fly.html` and its bundle as the static section, since `index.html`
embeds them):

**21,830,439 bytes ≈ 21.83 MB** (static estimate was 20.5 MB — higher
overall, because index.html's undercount is bigger than plan.html's
overcount).

Counting every distinct URL fetched across all seven runs once (the
warm-cache-crawl number, same method as the static section's 16.75 MB
figure):

**15,859,090 bytes ≈ 15.86 MB** (53 distinct files) — lower than the static
16.75 MB figure, because deduplication lets plan.html's now-shared,
now-smaller wink-nlp payload (1.29 MB, not 3.66 MB) outweigh index.html's
newly-counted assets.

### Summary of corrections

| page | static total | real total | verdict |
|---|---:|---:|---|
| index.html | 3,793,469 | 7,479,842 | **corrected: +3,686,373 (nearly 2×)** |
| spider-fly.html | 2,191,312 | 2,192,890 | confirmed |
| ledger.html | 2,699,019 | 2,700,853 | confirmed (wink import: 0 bytes, console warning) |
| adventure.html | 2,222,590 | 2,224,288 | confirmed |
| sprites.html | 1,202,817 | 1,203,733 | confirmed |
| plan.html | 5,272,145 | 2,904,621 | **corrected: −2,367,524 (wink CDN is 1.29 MB, not 3.66 MB)** |
| chat.html | 3,122,043 | 3,124,212 | confirmed (wink import: 0 bytes, console warning) |

## Seed facts & learn-on-miss

Measured directly against this repo on 2026-07-20.

**Where the 1264 figure comes from.** `scripts/build-chat-seed.mjs` builds
`public/chat-seed.json` from three bands: the full `human` persona
(`corpus/tier2/human.jsonl`, 665 facts), the full `seon` ontology
(`corpus/seon/concepts.jsonl`, 399 facts), and a ConceptNet slice capped at
`limit = 200` facts (out of a 44,947-line source). 665 + 399 + 200 = 1264,
confirmed against the shipped file's own `class === "Fact"` count. The
script enforces its own `SEED_BYTE_CEILING` (1.6 MB raw) to keep this a
bounded page-weight cost — the chat page fetches this whole file before it
can answer a seeded question.

**Compared against `tmct init` variants** (each measured by running against
an isolated `--repo` temp dir, then reading the real fact count off `tmct
memory`):

| load | facts (measured) | chat-seed's 1264 as a share |
|---|---:|---:|
| `npm run init` (bare, human small) | 665 | chat-seed is bigger — it also carries seon + ConceptNet |
| `npm run init:large` | 37,798 | ~3.3% |
| `npm run init:xl` | 72,077 | ~1.8% |
| `npm run init:xxl` | ~250,000 (estimated from wordnet-xl's yield rate; wordnet-full/namenet weren't run live — too slow for a quick check) | well under 1% |

**Learn-on-miss in chat.html: already wired, not persisted.**
`src/surfaces/web/chat-browser-entry.mjs` runs the same `runTurn` engine
from `src/services/chat.mjs` the CLI uses — teach turns, recall, proof
chains and the honest miss all run client-side with zero I/O. Teaching the
browser demo a new fact mid-session genuinely works: later turns in that
session can use it, exactly like the CLI.

What's missing is persistence. There is no `localStorage`,
`sessionStorage`, or `IndexedDB` call anywhere in the browser chat path —
checked directly, none found. The browser session skips every filesystem
side effect the CLI has (no `.tmct/` write, no transcript log), since a
static GitLab Pages deployment has no backend to write to. A taught fact
lives only as long as the tab does.

**Concrete next step.** This is a wiring gap, not an architecture change:
add a `localStorage`/`IndexedDB` snapshot-and-rehydrate layer in
`chat-browser-entry.mjs` that persists the in-memory store after each teach
turn and reloads it on page open. Purely client-side JS, no backend
required.

## Playwright-verified network behaviour (after fix)

Measured 2026-07-20 against a **local build** of the site (commit `c9981c4`,
"fix(pages): add wink-nlp import map to chat.html and ledger.html"),
built with `buildDemoSiteSnapshot()` into a temp dir and served locally with
`serveDirectory()` (`e2e/helpers/demo-site.mjs` /
`e2e/helpers/static-server.mjs`). Same method as round 1: a fresh Chromium
context per page, a CDP session summing `Network.loadingFinished`
`encodedDataLength`, third-party requests (esm.sh) allowed through — not
blocked, unlike the existing e2e tests.

**Confirmed: both pages now load wink-nlp.** No more "failed to resolve
module specifier" — the import map landed and the dynamic `import()`
resolves.

### chat.html — 4,410,694 bytes ≈ 4.41 MB (round-1 baseline: 3,124,212 ≈ 3.12 MB)

Resources: `chat.html` (18,041) + `chat-browser.bundle.js` (1,561,403) +
`chat-seed.json` (1,544,526) + `esm.sh/wink-nlp@2.4.0` (205) +
`esm.sh/wink-eng-lite-web-model@1.8.1` (467) + `wink-nlp.mjs` (15,899) +
`wink-eng-lite-web-model.mjs` (1,270,153). No console warning, no page
error — the earlier `TypeError: Failed to resolve module specifier
'wink-nlp'` is gone.

**Delta: +1,286,482 bytes (+1.23 MB before rounding, ≈1.29 MB), landing
almost exactly on round 1's own measured wink-payload figure (1,286,722
bytes on plan.html)** — not the older static estimate of 3.66 MB. The fix
costs what round 1 predicted it would cost.

### ledger.html — 3,987,689 bytes ≈ 3.99 MB (round-1 baseline: 2,700,853 ≈ 2.70 MB)

Resources: `ledger.html` (1,128,598) + `ledger-browser.bundle.js`
(1,572,388) + `esm.sh/wink-nlp@2.4.0` (205) +
`esm.sh/wink-eng-lite-web-model@1.8.1` (467) + `wink-nlp.mjs` (15,899) +
`wink-eng-lite-web-model.mjs` (1,270,132). No console warning, no page
error.

**Delta: +1,286,836 bytes (≈1.29 MB)** — again matching round 1's
measured wink-payload figure almost exactly, not the static 3.66 MB
estimate.

### The other five pages, for the record (unaffected by the fix, as expected)

Re-measured against the same local build for completeness. Each is within
a few hundred to a few thousand bytes of its round-1 live-site figure —
noise from a fresh local build (bundler timestamps, etc.), not a real
change, and none of them touch `chat-page-viz.mjs` or `ledger-viz.mjs`:

| page | round 1 (live) | round 2 (local, after fix) |
|---|---:|---:|
| index.html | 7,479,842 | 7,482,736 |
| spider-fly.html | 2,192,890 | 2,192,032 |
| adventure.html | 2,224,288 | 2,223,527 |
| sprites.html | 1,203,733 | 1,203,188 |
| plan.html | 2,904,621 | 2,904,016 |

Traces saved alongside round 1's, with an `-after` suffix, at
`/private/tmp/claude-501/-Users-antony-projects-polycode-projects-the-mechanical-code-talker/4559e392-80fe-4f70-92a2-fdb8c7dd16fd/scratchpad/pageweight-traces/{index,spider-fly,ledger,adventure,sprites,plan,chat}-after.zip`.

## Path toward LLM-alternative capability in chat.html

Real on-disk sizes checked on 2026-07-20, plus a capability/weight forecast.

### What's already on disk

| source | measured size | what it is |
|---|---:|---|
| `corpus/wordnet/wordnet-xl.jsonl` | 3.0 MB | source JSONL, not yet in chat-seed |
| `corpus/wordnet/wordnet-full.jsonl` | 25.5 MB | source JSONL, not yet in chat-seed |
| `corpus/conceptnet/` | 4.1 MB | chat-seed uses a 200-fact slice of this today |
| `corpus/seon/` | 92 KB | fully in chat-seed already |
| `corpus/namenet/` | 1.1 MB | proper names, unused in chat.html |
| `wink-eng-lite-web-model` (wire) | 1.27 MB | already loading, post-fix |
| `corpus/reference/` (Simple English Wikipedia extract, built by `scripts/fetch-reference-pack.mjs`) | 1.4 MB built; the pipeline's own budget caps at 3.5 MB gz shards + 600 KB gz index + 10 MB uncompressed text | this project's own reference-pack pipeline, already committed |
| `public/reference-pack/` (what chat.html actually fetches today, lazily, per citation) | 172 KB | a slice of the 1.4 MB already built — the rest is uncapped and wired in as part of this round of work |

### Capability ladder (boot weight vs. lazy-loaded weight)

The chosen direction: keep the *boot* weight close to today's, and push everything else onto the lazy-loading path — reference-pack fetched per citation, and (pending the Wikipedia REST API research below) learn-on-miss fetched only when a query actually misses. The seed tier chosen for the distributed package is **WordNet-xl**, not WordNet-full — WordNet-full's 25.5 MB source is held back as a future lever, not part of this round.

| tier | adds | boot weight | lazy-loadable ceiling |
|---|---|---:|---:|
| today (post wink-nlp fix) | wink-nlp + 1264-fact seed | 4.4 MB | 172 KB (reference-pack, capped) |
| this round | full seon + ConceptNet, WordNet-xl as seed, reference-pack uncapped to its full 1.4 MB build, learn-on-miss wired to fetch reference-pack content on demand | ~9–10 MB (seed grows; wink-nlp unchanged) | ~1.4 MB reference-pack, growing further once Wikipedia REST API fallback lands |
| held back | WordNet-full as seed | +15–20 MB | — |

### Storage backend: not sqlite, IndexedDB over localStorage

`src/adapters/memory/core.mjs` already has three backends: Backend A (flat JSON file on disk), Backend B (pure in-memory, no I/O), Backend C (SQLite — `node:sqlite`, Node's own native binding, opened lazily). The browser build runs on Backend B today, with zero persistence.

Backend C's SQLite is Node-native and can't run in a browser as-is — a browser-side SQLite would mean pulling in a WASM build (sql.js or wa-sqlite), a genuinely new dependency (1.5–2 MB wire cost of its own), and buys real benefits mainly once the graph is too big to comfortably hold and re-parse as a JS object on every load (WordNet-full scale, with OPFS for actual file-backed persistence). At the WordNet-xl tier chosen for this round, that cost isn't justified yet — it's a real option to revisit if a future round moves to WordNet-full or larger.

For persistence at today's scale, IndexedDB is the right choice over `localStorage`: `localStorage` is synchronous (blocks the main thread), string-only (needs manual JSON serialize/parse), and capped around 5–10 MB in most browsers — tight against a multi-MB graph. IndexedDB is asynchronous, stores structured-clone data directly, and has a much higher quota. The wiring gap identified earlier (`chat-browser-entry.mjs` has no `localStorage`/`sessionStorage`/`IndexedDB` call at all) should be closed with IndexedDB, not `localStorage`.

### Download-progress-aware loading: yes, no new dependency

The Fetch API's `Response.body` is a `ReadableStream`; paired with the `Content-Length` response header, a page can read chunks as they arrive and report real progress without any library. The technique, aggregated across every eager/lazy asset the page pulls in (wink-nlp, chat-seed, reference-pack shards):

```js
async function fetchWithProgress(url, onChunk) {
  const res = await fetch(url);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  let loaded = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onChunk(loaded, total);
  }
  return chunks;
}
```

A shared aggregator across all in-flight fetches can drive one status-line message ("loading the engine… 3.2 MB / 4.4 MB") that swaps to the richer stats message once everything settles. No blast-radius risk — it's additive to the existing `boot()` sequence.

### The single biggest lever not yet spent: a service worker

GitLab Pages serves this deployment with no compression at all (confirmed earlier in this doc) and nothing here caches across visits. A service worker precaching the boot assets (wink-nlp, chat-seed, reference-pack) turns every tier above from "pay every visit" into "pay once" — this is the change that makes a 10 MB+ boot tolerable for a return visitor, and it's independent of which knowledge-source tier gets chosen. Recommended sequencing: service worker first, then spend the freed-up tolerance on knowledge sources.

### Where this can and can't compete with an LLM

For grounded factual recall inside covered domains ("what is X", "who is Y", "what's a component of Z"), a graph and lexicon at this scale can plausibly beat a small LLM on precision — it either answers from a real, traceable fact or refuses; it can't hallucinate a plausible-sounding wrong answer. That is the actual asymmetry worth building toward, not matching an LLM's fluency.

Where it doesn't compete, and where no deterministic engineering exists yet to close the gap: genuinely novel composition — reasoning chains it wasn't taught, code synthesis, phrasing nobody templated, open-ended or creative writing. That isn't a wall this project hits by design choice; it's an open problem for template-based systems generally. Until something changes that, those queries land on the honest miss, same as any other ungrounded query today.

## Wikipedia REST API — live learn-on-miss fallback (research)

Researched 2026-07-20. Not yet wired into any production code — this is a
feasibility finding, and the next section covers what's actually blocking
it.

**Verdict: feasible with caveats.** Both candidate APIs work CORS-clean from
a static, no-backend, no-key browser page. The blocker isn't network access
— it's that tmct's existing miss-hook only fires for single lexicon nouns,
not free-text queries, so wiring Wikipedia in here inherits that narrow
scope unless a wider hook is built.

**Endpoints verified live (curl, this session):**

- `GET https://en.wikipedia.org/api/rest_v1/page/summary/{title}` — returns
  `access-control-allow-origin: *` even with no `origin=*` param. Shape:
  `{title, extract, description, revision, content_urls.desktop.page,
  pageid, ...}`. A missing title returns a clean 404 — an easy miss signal.
- `GET https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&search={q}`
  — CORS `*` only when `origin=*` is explicit (the classic Action API needs
  it; REST doesn't). Returns `[query, [titles], [descriptions], [urls]]` — a
  real free-text-to-title resolver. Confirmed live: `photosynthesis` →
  `["Photosynthesis", "Photosynthetic efficiency", ...]`.
- `action=query&prop=extracts&exintro=1&explaintext=1` also works (same
  CORS), giving a longer intro extract keyed by pageid — an alternative to
  the summary endpoint if more text is wanted.
- **Two round-trips are required, confirmed**: opensearch (query → title)
  then summary (title → article). No single-call path from free text to
  article exists.

**Rate limits/ToS** (mediawiki.org API:Etiquette, Wikimedia rate-limit
docs): no hard cap on reads generally, but anonymous browser-identified
requests get 200 req/min per IP; non-browser anonymous gets 10 req/min.
Exceeding returns 429 with `Retry-After` (back off ≥5s if absent). Since
every visitor's own browser calls Wikipedia directly, the limit is
per-visitor, not shared — one page's traffic doesn't pool against
another's.

**Extraction pipeline:** `src/domain/reference-pack.mjs`'s
`isReferenceArticleRow` needs `{term, title, text, summary, url, revid,
isa?}` with `revid` a positive integer. A live response maps directly:
`title` ← `titles.canonical`, `url` ← `content_urls.desktop.page`,
`summary`/`text` ← `extract` (needs the char-cap logic from
`scripts/fetch-reference-pack.mjs`, not currently exported from the domain
module — a small adapter, not a rewrite), `revid` ← `Number(revision)`.
Crucially, the provider seam already exists:
`src/adapters/corpus/reference-pack.mjs`'s `registerReferencePackProvider({
lookup(normTerm) })` is exactly the contract a live adapter would implement
— swap-in, no `chat.mjs` change needed for the row shape itself.

**The real constraint:** `cleanMissPackKey` (`src/services/chat.mjs` ~line
9431) only gates on `cleanMissReferenceTerm`, which requires the term to
already resolve via `lookupNoun(lexicon, t)` — i.e. this hook fires only for
single words already in tmct's own closed lexicon, on "what is X" shaped
misses. A Wikipedia fallback dropped into this seam answers only
known-word misses more richly; it does not extend to arbitrary open
questions without a separate, wider hook past the lexicon gate — a bigger
design change than this research covers.

**Integration sketch:** trigger only after the existing pack lookup returns
null (never bypass it); do search+summary as two fetches; cache per-session
in memory (or IndexedDB once that lands) keyed by term to avoid repeat
calls; a simple client-side throttle (e.g. a token bucket at ~1 req/2s,
well under 200/min) with 429/`Retry-After` respected. A live-fetched fact
stored via the same `appendFact`/provenance path as reference-pack hits
inherits the identical persistence gap already logged above (Backend B,
zero storage) — it vanishes on reload exactly like a taught fact does, and
should be fixed by the same IndexedDB work, not a separate one.

## In progress (background agents, sections to follow as they land)

- Home-page (`index.html`) rework — drop the embedded live demos in favor of static screenshots and links, for resilience.
- `chat.html` polish — branding copy, a `/memory` command bug fix, a richer boot-status message with graph stats, a provenance side panel, and uncapping the reference-pack lazy-load to the full built 1.4 MB.
