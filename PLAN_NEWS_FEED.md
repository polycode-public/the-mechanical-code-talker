# PLAN_NEWS_FEED.md — a news dashboard over the graph: contemporary sources, grounding, enrichment, and a feed of what changed

Status: phase 0 and phase 1 (the pure domain modules — section 7, section 8) are built and
tested. Every other module path below that is not marked "ships today" is a file that does not
exist yet.

This plan is written to be built by Sonnet-tier implementers with no further design work. Every
phase names its module paths, data structures, function signatures, config knobs, test files,
corpus rows, estate additions and acceptance commands. Where a phase is mechanical enough for
Haiku, the concurrency table says so. The hard decisions (format set, source roster, grounding
definition, hub scoring, provenance and trust tiers, network posture, page posture) are fixed
here, in writing.

The feature in one paragraph: a new demo page `news.html` plus a core news capability. The page
seeds its graph the way `chat.html` does and lays out as a dashboard the way `ledger.html` does.
After an explicit start action it polls contemporary sources (RSS 2.0, Atom, JSON Feed, and
selected APIs' JSON shapes) on load and on a page-settable timer, grounds the terms it finds
against the graph, synthesizes facts from what grounds, and ranks what does not. A
knowledge-base loop works the ranked ungrounded terms against reference sources, re-processes
old content when a term grounds, and runs a bounded syllogism round over each batch of new
facts. The feed itself is built from the sub-graph around whichever hub terms gained the most
facts recently, rendered as paraphrased fact paragraphs with expandable fact triples, a trust
tier, and source links, newest three on top. The same capability is reachable from chat
(including `chat.html`), the TUI, the CLI, and as a JS import, all through one library contract.

**How news.html differs from the research lane chat.html already has.** The research lane is a
single-topic, user-steered crawl: one term, one source, a queue the user advances. The news
capability is scheduled multi-source ingestion with change detection on top: many sources on a
timer, occurrence-ranked misses driving automated enrichment, and a feed synthesised around
whichever hub shows the most recent fact churn. On the home page's capability matrix,
`news.html` takes over the "Search backed" focus cell; `chat.html` keeps its tick.

---

## 1. What ships today

Everything the news capability needs already has a precedent in the tree. This section names the
seams so every phase below can cite them instead of re-deriving them.

**The research provider seam.** `src/adapters/corpus/research-source.mjs` defines what a
knowledge source is: `{ name, origin, lookup(term) -> row|null, provenanceTag(term) }`, with
optional `pageByTitle` and `linkedTitles`. Sources self-register at import time via
`registerResearchSource({ name, create })`; `RESEARCH_SOURCE_CHOICES` is the closed choice list
(today `["wikipedia", "wikidata"]`) and `normalizeResearchChoice` maps a config string onto it.
`RESEARCH_SOURCE_RELATIONS` caps what a source may write to twelve predicates (`rdf:type`,
`rdfs:subClassOf`, and ten `mgx:` relations). Runtime selection lives in
`src/adapters/corpus/wikipedia-live.mjs`: `getResearchProvider({ minIntervalMs, source })`
returns a registered test/browser stub first, then the cached adapter for the chosen name.
`createWikipediaLiveProvider` already takes an `origin` option, which is the whole trick behind
the Simple English Wikipedia source in phase 2.

**The one fetch gate.** The only Node-side `globalThis.fetch` call in `src/` is
`src/adapters/corpus/courtesy.mjs`. `createCourtesyGate({ fetchImpl, timeoutMs, minIntervalMs,
retryAfterFloorMs, userAgent, waitForSlot })` returns `{ fetchJson(url), cachedFetch(cacheKey,
work) }`: single in-flight slot, minimum interval, 429/`Retry-After` cool-off, `AbortController`
timeout, and every failure reads as `null`. Every news fetch adapter builds its own gate exactly
as `wikipedia-live.mjs` does. `DEFAULT_TIMEOUT_MS = 4000`, `DEFAULT_MIN_INTERVAL_MS = 2000`.

**Prose to facts.** `src/services/extract-facts.mjs` is the ingest seam:
`ingestText(text, { memoryDir, sourceTag, optimistic, canonical, config, lexicon })` returns
`{ sentences, recognized, extracted, optimistic, skipped, ungroundedTerms }`. The strict tier
keeps only records with `via === "assert"` and no miss; the optimistic tier
(`optimisticTriples(sentence, { lexicon, nlp })`) stores under `optimistic-extract:<sourceTag>`
at prior 0.35. The browser twin is `groundTextToFacts` in
`src/surfaces/web/ingest-browser-entry.mjs`. The research lane's own article ingest
(`ingestReferenceArticle` in `src/services/chat.mjs`) shows the full flow: provenance tag,
`isa` fact, structured facts, `optimisticTriples` over `splitSentences`, dedup,
`appendFacts`, then a bounded `syllogise` pass (`synthesiseAroundTerm`, budget 12).

**Facts.** `appendFact`/`appendFacts` in `src/adapters/memory/core.mjs`; ids are
content-addressed (`factIdFor` in `src/domain/hash.mjs`), so re-asserting upserts.
`readFactRows` folds each reification group to one row
`{ id, subject, predicate, object, provenance, trust, observedAt, quantifier, environments,
justification, sourceIds, sourceTypes, assertions }`. Trust is computed at read time from
source-kind priors (the `SOURCE_PRIOR` table); section 6.5 maps news writes onto the existing
kinds rather than minting new ones. Three backends: repo JSON, in-memory (browser), sqlite.
Browser persistence is the page-layer IndexedDB snapshot (`openPersistedStore` in
`src/surfaces/web/idb-persist.mjs`), keyed by a stamp that discards the snapshot when the seed
or site version moves.

**The syllogise round.** `syllogise(repoDir, { depth, budget, focus, expandFocus,
maxEnvironments, full, store })` in `src/domain/syllogise.mjs`, with `store` required
(`{ loadMemory, readFactRows, appendFacts }`). The existing idiom for "a round over newly
synthesized facts" is the one `synthesiseAroundTerm` uses: focus on
`factTermVariants(normFactTerm, term)` for each new subject and object, `expandFocus: true`,
a small budget. Passing `focus` disables delta mode, which is correct for a scoped round.

**Counting.** Term degree (distinct facts naming a term) exists twice, in
`researchSnapshot` (`src/surfaces/web/research-browser-entry.mjs`) and
`computeLedgerDataFromPayload` (`src/services/ledger-viz.mjs`). An occurrence counter for
ungrounded terms exists nowhere: `extract-facts.mjs` returns `ungroundedTerms` as a `Set`, one
entry per term, no frequency. Phase 0 builds that counter as a domain module.

**Seeding.** `chat.html` loads `public/chat-seed.json` (built by `scripts/build-chat-seed.mjs`
through the real corpus path, not committed) into a Backend-B in-memory store via
`createChatSession({ seedPayload })` in `src/surfaces/web/chat-browser-entry.mjs`. The seed
phase machine on `window.tmct.seed` (`"loading" | "indexing" | "ready" | "failed" | "skipped"`)
is the pattern the news page's own phase machine copies. `news.html` reuses `chat-seed.json`
as-is; no new seed builder.

**The dashboard.** `ledger.html` renders through `renderLedgerHtml` in
`src/services/ledger-viz.mjs`: a `<section class="dash">` holding a `.kpirow` of `.tile`s and
`.barpanels` of `.tile.tile-bars`, with `.tile-label`/`.tile-value`/`.tile-sub` internals,
`microbarsHtml` leaderboards and an inline-SVG sparkline, all themed through
`THEME_TOKENS_CSS` from `src/services/viz-theme.mjs`. Live re-render is
`el("dash").outerHTML = dashboardHtml(stats, { fresh: true })`. Shared page machinery news
reuses directly: `viz-theme.mjs` (tokens, `escapeHtml`, `embedJson`, `demoEyebrowHtml`),
`viz-boot.mjs` (`loadWinkVendor`), `viz-ticker.mjs` (`createTicker`, `prefersReducedMotion`,
`createSerialQueue`), `memory-panel-viz.mjs` (`fetchWithProgress`, `loadSeedPayload`,
`renderStatsPanelInto`), `share-overlay-viz.mjs`, and the page↔engine contract
(`publishTmctSurface` in `tmct-surface.mjs`, `createTurnSession` in `turn-session.mjs`).

**Adding a demo page.** `scripts/site-pages.mjs` holds `DEMO_PAGES` (six today) and per-page
`{ title, description }` meta. Adding the `news` slug to `DEMO_PAGES` is the mechanism that
carries sitemap, head meta, service-worker precache and OG-image wiring — the build and the
generators iterate that list, so the plan hand-wires none of those surfaces individually. What
stays bespoke per page: the renderer, the bundle script, the about page, the home-page card and
matrix row, and the estate count bumps. The estate tests that pin it all:
`test/estate/site-meta.test.mjs` (page count, meta-tag counts, sitemap), `og-images.test.mjs`
(1200×630 per demo page), `home-page-links.test.mjs` (hard-coded page alternation and anchor
count), `screenshots.test.mjs` (manifest vs shipped PNGs), `links.test.mjs`,
`claims.test.mjs` (pins the claims-page blocks), and `import-layers.test.mjs` (rules in
`test/estate/layer-map.mjs`: domain imports only domain, only relative; imports point strictly
down the rank `domain < adapters < tools < index < services < surfaces`).

**Command wiring.** `/wiki` and the research lane show every wiring point a `/news` command
needs; phase 4 lists them file by file. The TUI needs zero edits: it is a pure view over
`session.turn(line)`.

**Config.** `tmct.toml`, read by `src/adapters/toml-config.mjs`. New sections ride the sparse
pass-through list (one line in `normalizeConfig`), with defaults and clamping in the consumer's
own `resolve*Config`, following `resolveResearchConfig` in `src/services/research.mjs`
(`RESEARCH_DEFAULTS`, `clampResearchConfig`). Precedence: chat command > CLI flag > `tmct.toml`
> defaults, through `mergeEffective`.

---

## 2. The UX sequence as a testable contract

The page exposes `window.tmct.news` with a phase field and counters. Each state below names its
phase value and the assertion an e2e or corpus test can make. The sequence is a contract: the
states arrive in this order, and each is observable.

Network posture first, because it shapes the sequence: **the page makes no third-party request
before an explicit start action.** On first visit the sources panel shows a start button and
the request log shows zero rows; pressing start records an opt-in preference (localStorage,
beside the existing preference keys) and arms the poll cycle. Return visits with the preference
set poll on load; a **stop & forget** control (section 13.1) clears that preference and reverts
the page to its first-visit state on the next load. The home page hero's "offline" claim becomes
"offline by default" when this page ships (phase 7 carries the copy change).

| state | phase | what the user sees | testable assertion |
|---|---|---|---|
| S0 seed | `"seeding"` | seed progress, dashboard tiles at zero, start button visible | `window.tmct.seed.phase` reaches `"ready"`; request log empty; zero third-party requests observed |
| S1 first items | `"seeded"` | feed items built from seed facts alone, each labelled "from the seed graph — start to poll live sources" | ≥1 feed item rendered before any network response; every fact id in it resolves to a seed-band provenance; every rendered item carries the seed label until the first poll completes; time-to-first-article recorded on `window.tmct.news.metrics` |
| S2 polling | `"polling"` | after start: per-source status chips flip to fetching; request log grows one row per request (URL, time, bytes, status); new items land on top as each source returns | item count grows; newest item's `builtAt` > S1 items'; log rows match observed requests one for one; time-to-first-complete-poll records once every enabled source has returned or failed once |
| S3 ranking | `"grounding"` | the fact-ungrounded-terms panel populates, ranked by occurrence count, each row labelled "parseable but knowledge-free" or "unknown word" | ledger rows sorted count desc then term asc; counts match fixture arithmetic; a lexicon-known term with zero fact rows appears in the list labelled "parseable but knowledge-free", not silently omitted |
| S4 enriching | `"enriching"` | top-ranked terms (capped per cycle) looked up in KB sources; existing items refresh in place; a syllogism round runs; new fact-ungrounded terms join the list | a previously fact-ungrounded term flips to fact-grounded; an existing item's fact list grows; the derived tile increases by the round's count; a term that misses every KB source enters the negative cache and is not retried within its TTL |
| S5 idle | `"idle"` | timer armed at the page-set interval; controls live; graph-size tile current | `window.tmct.news.nextPollAt` set; changing the interval select re-arms; a failing source's next poll is backed off |

Free text and upload run the same S3–S4 machinery on demand and can fire in any state after S1.
The shipped demo buttons (section 13) replay committed fixture responses through the same
pipeline, so every state S2–S5 is demonstrable with the network off. Every phase transition
appends one line to the page log (the `appendLogLine` convention), so a human can replay the
sequence from the log alone.

---

## 3. The constitution

These hold for every phase and module below.

- **Pure JS, no LLM anywhere in the product path.** Feed parsing is string scanning, grounding is
  lexicon and graph lookup, paraphrase goes through the same template machinery as every other
  answer. A sibling project may put an LLM in front on its own side of the seam; nothing in tmct
  calls one.
- **Network lives in adapters only, behind consent.** `src/domain/` modules import nothing
  non-relative (`test/estate/import-layers.test.mjs` fails on the first violation). Every fetch
  goes through a `createCourtesyGate` instance in an `src/adapters/corpus/` module, over https
  only, with an identifying user agent, honouring conditional-request headers where the source
  supports them, and every failure reads as `null`, never a throw on the turn path. The browser
  page fetches nothing before the explicit start action.
- **Deterministic engine over a non-deterministic world.** The world is not deterministic; the
  engine is. Given the same fetched payload, the same facts land, byte for byte — and given the
  same fact set plus the same `now`, the same feed renders, byte for byte. The wall clock enters
  only as a `now` parameter passed by the caller. Item ids and term rankings are
  content-addressed or fully ordered (count desc, then term asc).
- **The honest miss survives.** A source that fails, a term that never grounds, a KB lookup that
  returns nothing: each is reported as exactly what it is. The ungrounded list is the miss wall
  made visible. Nothing downgrades to a guess; a timeout is a failed poll, never a fact.
- **Open-world.** An ungrounded term is a term the graph does not know yet. Ranking it is an
  invitation to enrich, never a claim about the world.
- **Attribution and provenance are structural, both ways.** Every news fact carries a provenance
  tag naming its source and a trust tier from the existing prior table; every rendered item
  links its source articles and shows its tier. And the page extends the same courtesy to its
  own behaviour: the visible request log is provenance for the page's network activity.
- **Third-party text is hostile until escaped.** Every fetched string (titles, summaries, feed
  metadata, KB extracts) passes `stripMarkup` at parse time and `escapeHtml` at render time.
  Nothing fetched is ever interpolated into HTML raw.
- **$0 at rest, fixture-true in CI.** No daemon, no server-side poller, no relay, no queue
  service. Node surfaces poll on demand; the browser polls on a page timer the user controls.
  Committed fixtures drive all Playwright tests and the shipped demo buttons; CI passes with no
  internet access.

---

## 4. Source research

Two probe rounds, both run 2026-08-08 from this machine, raw output teed to the session
scratchpad (`probes/*.headers`, `probes/*.body`, `browser-probe*-results.txt`):

1. a curl round with a real `Origin: https://tmct.polycode.co.uk` header, recording status,
   size, content type and `Access-Control-Allow-Origin`;
2. a headless-Chromium round (Playwright) executing `fetch` from a real `https` page context —
   the verdict that decides shipping, because the page is static with no backend, so a source a
   browser cannot read does not exist for this feature.

Where the rounds disagree, the browser wins and both results are recorded. The disagreement was
real: GDELT sent `Access-Control-Allow-Origin: *` to curl and nothing to Chromium (its CORS
header is user-agent-conditional), which is exactly why rule 2 exists. All sources are https.
No default source requires an API key; key-holding sources (Guardian content API, NYT article
API, NASA) were excluded from candidacy on that rule — a user-supplied key at runtime through
add-by-URL remains possible.

"Protocols" in this design means wire formats: RSS 2.0, Atom, JSON Feed 1.1, plus the JSON
shapes of the chosen APIs (Wikimedia aggregated-feed, Hacker News Firebase, USGS GeoJSON,
MediaWiki action/REST APIs, DBpedia Lookup).

### 4.1 Contemporary sources — probed

| source | URL | format | curl verdict | browser verdict | verdict |
|---|---|---|---|---|---|
| NYT World News | `https://rss.nytimes.com/services/xml/rss/nyt/World.xml` | RSS 2.0 | 200, 117 KB, `ACAO: *` | **pass** (200, 116 KB) | **selectable** — a major recognised outlet whose feed a browser can read directly; items carry title, link, permalink guid, description, pubDate, `dc:`/`media:` extensions; its personal-use-with-attribution licence (section 4.3) sits awkwardly as an on-by-default source, so it ships opt-in |
| Wikimedia featured feed | `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/YYYY/MM/DD` | API JSON | 200, 288 KB, `ACAO: *` | **pass** (200, 288 KB) | **default** — the best-tagged source probed: `mostread` gave 43 articles each with a plain-text `extract` and a `wikibase_item` Q-id that grounds straight into the Wikidata KB source; `news` key present only some days; CC BY-SA |
| Hacker News | `https://hacker-news.firebaseio.com/v0/topstories.json` + `/v0/item/<id>.json` | API JSON | not curl-probed (added in the browser round) | **pass** (200 both) | **default** — recognised tech-news aggregator whose title vocabulary overlaps the seeded code bands (seon, tier2-aws/python/java), so it grounds where general news prose cannot; two-step fetch, capped at 10 items per poll |
| USGS earthquakes | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` | GeoJSON | not curl-probed | **pass** (200, 33 KB) | **default** — a recognised institution publishing semantically structured contemporary data (magnitude, place, time per feature); public domain, no attribution burden, the third contemporary default beside Wikimedia featured and Hacker News |
| Wikinews published | `https://en.wikinews.org/w/api.php?...&origin=*` | MediaWiki JSON | 200, `ACAO: *` | **pass** (200) | **selectable** — CC BY real news with clean structure; its own lead story announces the Wikimedia Foundation closing Wikinews, so it ships selectable rather than default and its health row will tell users when it goes |
| GDELT DOC 2.0 | `https://api.gdeltproject.org/api/v2/doc/doc?query=...&format=json` | API JSON | 200, `ACAO: *` | **FAIL** — console shows "blocked by CORS policy: No 'Access-Control-Allow-Origin'"; retried twice | dropped — the CORS header is conditional on the client and absent for real browsers; the curl pass is recorded so nobody re-litigates this from curl alone |
| BBC News World | `https://feeds.bbci.co.uk/news/world/rss.xml` | RSS 2.0 | 200, 28 KB, no CORS header | **FAIL** (failed to fetch) | dropped from the registry — reachable from Node surfaces (CORS is a browser rule), so it works as an add-by-URL source on the CLI; the browser add-by-URL flow reports it "source does not permit browser access" |
| Guardian World | `https://www.theguardian.com/world/rss` | RSS 2.0 | 200, 147 KB, no CORS header | **FAIL** | dropped — same posture as BBC |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | RSS 2.0 | 200, no CORS header | **FAIL** | dropped — same posture |
| NPR News | `https://feeds.npr.org/1001/rss.xml` | RSS 2.0 | 200, CORS locked to `apps.npr.org` | **FAIL** | dropped — same posture |
| Bluesky what's-hot | `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=...whats-hot&limit=N` | API JSON | not curl-probed | **pass** (200, 8 KB) | recorded pass, not shipped — short posts, no summaries, weak grounding surface; a later increment could add it |
| Mastodon trending links | `https://mastodon.social/api/v1/trends/links?limit=N` | API JSON | not curl-probed | **pass** (200, 3 KB) | recorded pass, not shipped — same reasoning; the plain public timeline endpoint 422s without params |
| Dev.to articles | `https://dev.to/api/articles?per_page=N` | API JSON | not curl-probed | **pass** (200, 8 KB) | recorded pass, not shipped — tagged tech articles; loses the "recognised outlet" comparison to Hacker News |
| Reddit worldnews | `https://www.reddit.com/r/worldnews/hot.json` | API JSON | not curl-probed | **FAIL** | dropped |
| Daring Fireball | `https://daringfireball.net/feeds/json` | JSON Feed 1.1 | 200, 139 KB, no CORS header | **FAIL** | not news; its body is the JSON Feed parser fixture |
| jsonfeed.org | `https://www.jsonfeed.org/feed.json` | JSON Feed 1.1 | 200, 3 KB, `ACAO: *` | **pass** (200, 3 KB) | not news; the one CORS-clean JSON Feed found, kept as the browser-context JSON Feed test target and add-by-URL demo |
| Lobsters | `https://lobste.rs/hottest.json` | API JSON | not curl-probed | **FAIL** (timeout) | dropped |
| Reuters agency feed | `https://www.reutersagency.com/feed/...` | RSS | 404 (an HTML page) | — | dropped — feed retired |
| AP News world | `https://apnews.com/hub/world-news?output=rss` | claimed RSS | 200 but `text/html`, 1.2 MB page | — | dropped — no public feed anymore |
| Wikipedia current events portal | `https://en.wikipedia.org/api/rest_v1/page/mobile-html/Portal%3ACurrent_events` | mobile-html | 200, 186 KB page HTML, `ACAO: *` | pass but unusable | dropped — a rendered portal page has no item structure to parse honestly |

**The shipped contemporary five, all browser-verified: Wikimedia featured feed (JSON), Hacker
News (JSON), USGS earthquakes (GeoJSON) as defaults; NYT World (RSS) and Wikinews (JSON)
selectable.** The feature is viable down to one working source; the health rows make any decay
visible.

**HN's latency budget is designed, not discovered.** Its two-step fetch issues 11 sequential
requests through the gate — one `topstories.json` call, then ten `item/<id>.json` calls — so the
wall clock is dominated by the ten gaps between them, not the requests themselves. At the shared
2s courtesy floor that is 10 × 2000ms = 20s of pure waiting before the tenth item lands, which is
where the ~22s serialized-poll figure comes from. Hacker News's Firebase-backed API comfortably
tolerates a faster anonymous poll than an RSS host does, so the registry gives it its own, lower
floor: `minIntervalMs: 250` (section 6.1), HN-specific — the shared 2s floor stays exactly as it
is for Wikimedia, NYT, USGS and Wikinews. That drops the wait to 10 × 250ms = 2.5s, so a full HN
poll completes in a few seconds rather than 22; the rig's time-to-first-complete-poll metric
(section 16) is what checks this in practice rather than by arithmetic alone.

### 4.2 Knowledge-base sources — probed

| source | URL | format | curl verdict | browser verdict | verdict |
|---|---|---|---|---|---|
| Simple English Wikipedia | `https://simple.wikipedia.org/api/rest_v1/page/summary/<Title>` | REST JSON | 200, `ACAO: *` | **pass** (200, 2 KB) | **default** — plain-text `extract` in simple vocabulary, the best possible input for the deterministic ingest grammar; also carries `wikibase_item`; same API profile as the shipped wikipedia adapter, selected by its `origin` option |
| Wikidata | `wbsearchentities` + `Special:EntityData/<Q>.json` | JSON | 200 both, `ACAO: *` | **pass** (200 both, entity 103 KB) | **default** — already a shipped research source (`wikidata-live.mjs`, P31→`rdf:type`, P279→`rdfs:subClassOf`); CC0, no attribution burden |
| Wiktionary | `https://en.wiktionary.org/api/rest_v1/page/definition/<term>` | REST JSON | 200, `ACAO: *` | **pass** (200, 2 KB) | **default** — definition-shaped responses feed the lexicon side of grounding (part of speech and genus term) |
| DBpedia Lookup | `https://lookup.dbpedia.org/api/search?query=<term>&maxResults=<n>&format=json` | JSON | 200, CORS via origin echo | **pass** (200, 1.3 KB) | **selectable** — ranked entity search with category hints |
| English Wikipedia | `https://en.wikipedia.org/api/rest_v1/page/summary/<Title>` | REST JSON | (same API profile) | **pass** (200, 4.6 KB) | **selectable** — the shipped `wikipedia` research source, unchanged; richer, harder prose than Simple |
| DBpedia SPARQL | `https://dbpedia.org/sparql` | SPARQL JSON | 503 first, then 200 with empty bindings | not browser-probed (already failed on reliability) | dropped — flaky public endpoint; Lookup covers the need |
| ConceptNet | `https://api.conceptnet.io/c/en/<term>` | JSON-LD | 502 | **FAIL** | dropped — down in both rounds; the seed corpus already carries a ConceptNet band |

**The shipped knowledge-base five, all browser-verified: Simple English Wikipedia, Wikidata,
Wiktionary as defaults; DBpedia Lookup and English Wikipedia selectable.**

### 4.3 Licensing and attribution

- USGS data is US public domain, credited anyway. Hacker News API content is user-submitted
  titles plus links; the item links the story and the HN discussion. NYT publishes its feeds for
  personal, non-commercial use with attribution and a link back — terms that sit awkwardly on an
  on-by-default source, which is why NYT ships selectable rather than default (section 4.1); the
  item renderer still links every source article and names the outlet, and the about page states
  the terms for anyone who turns it on.
- Wikimedia content (Wikipedia, Simple English Wikipedia, Wikinews, Wiktionary) is CC BY-SA
  (Wikinews CC BY 2.5); attribution is the article link the item already carries. Wikidata is
  CC0. DBpedia is CC BY-SA.

### 4.4 How fetching works from a static, service-workered page

- **Shipping gate: the browser probe.** Every registry source passed an in-browser fetch from an
  https origin. The registry records the verdict date. Re-probing is a maintenance habit
  (`scripts/probe-news-sources.mjs`, phase 2, prints the same table), not a code path.
- **Add-by-URL preflight.** When a user pastes a URL (https only; anything else refuses
  immediately), the page fetches it once before registering. A CORS failure is a first-class
  state: the source lands in the panel as "source does not permit browser access", visibly, and
  is skipped by the poll cycle rather than silently loading nothing. The same URL added on a Node
  surface (CLI, JS import) fetches fine, because CORS is a browser rule; the record carries
  `browserBlocked: true` so every surface renders the truth.
- **No relay ships and none is assumed.** The page is static with no backend.
- **The service worker** must not intercept cross-origin requests. The precedent already holds
  (`chat.html` does live Wikipedia lookups through the same service-workered origin today).
  Phase 6 adds one page-level test that the SW fetch handler ignores non-same-origin URLs, so a
  later SW edit cannot silently start caching third-party news bodies.
- **Conditional requests.** The courtesy gate grows optional ETag/Last-Modified memory per URL
  (section 9.1): when a source sent a validator, the next poll sends `If-None-Match` /
  `If-Modified-Since`, and a 304 counts as a healthy poll with zero new items.

---

## 5. Sibling-repo alignment

Two sibling repos ship parts of this shape today and may later migrate onto this capability.
The design does not bind to that migration; it shapes the seams so the capability could serve
them. Findings from a full read of both trees, then the mapping.

### 5.1 the-quiet-feed (`../the-quiet-feed`)

- **Ingestion**: RSS + Atom with hand-rolled regex parsing, no XML dependency, in
  `app/services/rssFeedService.js` (`parseRssItems`, `parseAtomItems`, `parseFeed` with format
  auto-detect, `fetchMultipleFeeds`). Item shape `{ title, url, excerpt, publishedAt, guid,
  author, category, source }`.
- **Source config**: a TOML catalogue, `web/public/feeds.catalogue.toml` — per source `id, url,
  format, tier, refresh_minutes, enabled, last_checked, consecutive_failures, auto_disabled`.
  `refresh_minutes` is metadata only; there is no live poller. Ingestion is on-demand
  (`scripts/process-feeds.js`) and a separate healthcheck script mutates the catalogue status
  with a timeout-multiplying backoff.
- **Ranking/dedupe**: SHA-256 of normalized URL+title (`app/lib/contentHash.js`) against a
  7-day-pruned `.processed-hashes.json`; per-item rule scoring in
  `app/services/scoringService.js` (`scoreWithRules`, four regex-signal dimensions). No
  cross-item term-frequency ranking exists.
- **LLM boundary (stays theirs)**: `scoreWithLLM` and wire mode
  (`generateWireWithLLMClient` producing `{ wireTitle, wireSummary }`), behind one client,
  `app/lib/llmClient.js`; `generateWireWithRules` is the pure-regex fallback. Text in, scalar
  JSON out; no graph data crosses.
- **Entity extraction / KB**: none. Wikipedia and Wikidata appear only as ordinary catalogue
  feeds.

### 5.2 marginalia (`../marginalia`)

- **Ingestion**: a dependency-free RSS/Atom parser as a chat tool,
  `app/functions/chat/tools/fresh-sources.mjs` (`extractFeedItems`, `rss()`), plus GDELT, HN
  Algolia, Wikipedia pageviews/recentchanges, Bluesky and Mastodon normalizers to a uniform
  `{ title, url, source, when }`; URL dedupe via `app/lib/adapters/seen-urls.mjs`. Feed list in
  `marginalia/rules/web.yaml`.
- **Scheduling**: declarative EventBridge cron in `marginalia/schedules.yaml`; no in-process
  poll loop; per-source `AbortSignal.timeout` + `Promise.allSettled`.
- **Mechanical grounding (the key precedent)**:
  `app/lib/domain/mechanical/mine-turns.mjs` + `matcher.mjs` — a wink-nlp gazetteer over a
  closed vocabulary drawn from the graph's own entities, regex candidate harvest, SVO clause
  extraction, everything stamped `origin: "mechanical"`, zero LLM. This is the same
  philosophy as tmct's lexicon-gated grammar, independently converged on.
- **Ranking**: `mentionCount`/`labelMatcher` in `app/lib/domain/entities.mjs` — whole-word
  occurrence counting used as a hard grounding gate on LLM-proposed entities ("LLM proposes,
  occurrence validates"); `rankGaps` in `app/lib/domain/graph-gaps.mjs` ranks structurally thin
  entities, pure and deterministic.
- **Inference**: `app/lib/domain/inference.mjs` materializes OWL 2 RL entailments via SPARQL
  CONSTRUCT over an Oxigraph projection of the MemTree — the same rule family tmct's
  `syllogise.mjs` implements natively.
- **Feed-like surface**: hourly `insights.json` (`app/functions/insights/handler.mjs`) with a
  recency-weighted `tag_cluster` — the nearest analog to "feed of what changed", except its
  theme-naming step is an LLM call.
- **LLM boundary (stays theirs)**: `extractChunk` (entity proposal), `aggregate()` (MemTree
  summary folding), `generateTagCluster` (theme naming), all narrow Bedrock calls whose output
  is subordinate to a mechanical check.

### 5.3 The mapping, part by part

| this design | the-quiet-feed | marginalia |
|---|---|---|
| (a) timed multi-source polling, formats | `rssFeedService.js` parsing posture (hand-rolled regex, format auto-detect) and the catalogue schema (`consecutive_failures`, `auto_disabled` — adopted into section 6.1's health rows) | `fresh-sources.mjs` normalizers are the precedent for the API-shaped sources (HN, Wikimedia); `schedules.yaml` is the declarative-schedule shape the `[news]` knobs echo |
| (b) grounding + fact synthesis | — (no extraction exists) | `mine-turns.mjs`/`matcher.mjs` proves the zero-LLM gazetteer approach at production scale; tmct uses its own grammar (`ingestText`/ACE/teach), not a port, but adopts the occurrence-gate discipline |
| (c) occurrence-ranked ungrounded terms | — (per-item scores only) | `mentionCount` maps directly onto the term ledger's counting; `rankGaps`' thinness dimension is a candidate second ranking signal (not in this plan) |
| (d) KB enrichment | — | — (neither repo has structured entity linking; this part of the design is new, and both siblings could later consume it through the research seam) |
| (e) feed of changed sub-graphs | the sorted, score-attached `all-feeds.json` is the renderable-list analog | `insights.json`'s recency-windowed selection is the changed-recently analog, minus the LLM naming — tmct's hub scoring replaces the LLM with fact-churn counting |

**What stays on the siblings' side of the seam.** the-quiet-feed's LLM classify and smooth
(`scoreWithLLM`, wire mode, `llmClient.js`), and marginalia's `extractChunk`, `aggregate` and
`generateTagCluster`. If either migrates onto this capability, those run in front of or after
tmct and their outputs ride as opaque fields: the section 6.6 item leaves room for a sibling to
attach `{ score, wireTitle, wireSummary }` (or a theme label) beside the paragraph without tmct
reading or producing them. What both siblings would gain from the seam: a real term ledger and
KB enrichment loop (neither has one), a deterministic paraphrase, and a fact store with
provenance and trust — while tmct adopts, in this design, their proven postures: hand-rolled
feed parsing, health-tracked source catalogues, occurrence gates, and recency-windowed feed
selection.

---

## 6. Data structures and config

All shapes are plain JSON. Node ids and item ids are content-addressed through `sha256Hex` in
`src/domain/hash.mjs`.

### 6.1 The source record

```js
// One entry in the news source registry (contemporary or kb).
{
  id: "nyt-world",                 // stable, kebab-case, unique across both kinds
  name: "NYT World News",          // display name
  kind: "contemporary",            // "contemporary" | "kb"
  format: "rss",                   // "rss" | "atom" | "jsonfeed" | "wikimedia-feed" | "hn" | "usgs"
                                   //   | "mediawiki" — kb: "wikipedia-summary" | "wikidata"
                                   //   | "wiktionary" | "dbpedia-lookup"
  url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",   // https only
  homepage: "https://www.nytimes.com/section/world",
  licence: "personal use with attribution",
  browserVerified: "2026-08-08",   // date of the last passing in-browser probe
  minIntervalMs: 2000,             // per-source courtesy floor; only Hacker News overrides down
                                   // (section 4, section 9.2)
  enabledByDefault: false,         // licence terms (personal, non-commercial with attribution)
                                   // keep it selectable rather than on by default
}
```

Runtime health rides beside the static record, in the news state (never in the registry):

```js
{ sourceId, lastPolledAt, lastStatus: "ok" | "not-modified" | "failed" | "skipped" | "blocked",
  consecutiveFailures: 0, backoffUntil: "", autoDisabled: false, browserBlocked: false,
  etag: "", lastModified: "" }
```

Backoff doubles the source's effective poll interval per consecutive failure (cap 6 hours);
three consecutive failures set `autoDisabled`; a manual toggle or a successful on-demand poll
clears both. `browserBlocked` is set by the add-by-URL preflight and renders as "source does
not permit browser access". (`consecutiveFailures`/`autoDisabled` adopt the-quiet-feed's
catalogue fields, section 5.1.)

### 6.2 The feed-item snapshot

Every fetched item is snapshotted so re-processing after a new grounding has the original text.

```js
{
  id,                    // `news-item:${sha256Hex(`${sourceId}\0${guidOrUrl}`, 8)}`
  sourceId,
  title, url, summary,   // stripMarkup'd at parse time; escapeHtml'd again at render time
  publishedAt,           // ISO string from the feed, "" when absent
  fetchedAt,             // ISO string, from the caller's `now`
  bytes,                 // response size attributed to this fetch, for the request log
  processedRounds: 0,    // how many synthesis passes have seen this snapshot
  factIds: [],           // facts this snapshot contributed, filled per round
  extras: null,          // reserved for a sibling's opaque enrichment (section 5.3); tmct
                         // never reads or writes it
}
```

### 6.3 The fact-ungrounded-term ledger

The ledger tracks every term with zero fact rows in the graph — the gap the news loop exists to
close. Grounding is a split status, not one flag: a term is **vocab-grounded** when the lexicon
resolves it, and **fact-grounded** when the graph holds at least one fact row for it. The two are
independent and both get tracked. Admission to the ledger is fact-degree only: any term with zero
fact rows enters, lexicon-known or not — a lexicon-known term with no facts yet ("ceasefire",
"tariff") is exactly the case the loop must enrich, so it is not treated as already grounded and
skipped. The lexicon check answers a narrower question, parseability: a token the tokenizer
cannot resolve as a candidate term at all is neither vocab- nor fact-grounded, and never reaches
the ledger.

```js
// createTermLedger() -> { terms: Map<term, entry> }
{
  term,                  // normalized through normFactTerm — dedupe across cycles is by this key
  count,                 // occurrences across all processed sentences, the ranking key
  vocabGrounded,         // true when the lexicon resolves the term — set once on first insert,
                         // never revisited afterward; display only, never gates admission
  itemIds: [],           // snapshots that mentioned it (capped at 12, first-seen order)
  firstSeen, lastSeen,   // ISO strings from `now`
  status: "pending",     // "pending" | "enriching" | "grounded" | "missed" — fact-grounding
                         // progress, set by the enrichment loop
  missedAt: "",          // when status became "missed" — the negative-cache clock
}
```

Ranking order is total: count desc, then term asc. `"grounded"` means the graph now holds at
least one fact row for the term (fact-grounded, regardless of `vocabGrounded`). The ledger and
the page's ranked list label every row by `vocabGrounded`: "parseable but knowledge-free" when
true, "unknown word" when false, so the two different problems never read as one. `"missed"` is
the negative cache: the term was tried against every enabled KB source and nothing came back; it
is not retried until `negative_cache_ttl_hours` passes or a new KB source is enabled, and it never
blocks the queue — `rankedTerms` filters it out of the pending view while the TTL holds.

### 6.4 The `[news]` config section

Sparse pass-through (one line in `normalizeConfig` in `src/adapters/toml-config.mjs`), resolved
by `resolveNewsConfig` in `src/services/news.mjs`, following the `[research]` precedent.

```toml
[news]
# Enabled contemporary sources (ids from the registry; defaults shown).
# sources = ["wikimedia-featured", "hacker-news", "usgs-quakes"]
# Enabled knowledge-base sources.
# kb_sources = ["simple-wikipedia", "wikidata", "wiktionary"]
# Extra sources by URL (https only; format auto-detected: rss | atom | jsonfeed).
# extra_sources = [ { id = "jsonfeed-org", url = "https://www.jsonfeed.org/feed.json" } ]
# Timed cycles in minutes; 0 means on-demand only. Poll floor is 5 — lower values clamp up.
# poll_minutes = 15
# enrich_minutes = 10
# Enrichment budgets.
# enrich_terms_per_cycle = 3
# negative_cache_ttl_hours = 24
# Syllogise budget spent after each ingest batch (the "syllogisms per ingest" knob).
# syllogisms_per_ingest = 12
# Feed and retention shape.
# item_cap = 30          # snapshots kept for re-processing (oldest evicted)
# news_fact_cap = 4000   # news-provenance facts kept; oldest-by-observedAt evicted past the cap
# feed_top = 3           # latest items pinned at the top
# window_hours = 48      # recency window for hub scoring
# Courtesy floor override; when set, raises every source's fetch gate to at least this value —
# it can only push a source's floor up from its own registry default (section 6.1), never down.
# min_interval_ms = 2000
```

`NEWS_DEFAULTS` freezes exactly these values; `clampNewsConfig` clamps every number to a
non-negative integer, `poll_minutes` to 0 or ≥ 5, `feed_top` to [1, 10], `item_cap` to [1, 200],
`enrich_terms_per_cycle` to [1, 10], `syllogisms_per_ingest` to [0, 50]. `min_interval_ms`, when
set, raises every source's fetch-gate floor to at least that value; left unset, each source
keeps its own registry default — 2000ms for most, the lower HN-specific floor from section 4 for
Hacker News.

Eviction (the `news_fact_cap`) applies to `news:`-tagged facts only, never to seed, taught or
research facts, and runs at ingest time so the graph cannot grow past quota unattended. The
page shows the current graph size (facts plus estimated bytes via `navigator.storage.estimate`)
on a dashboard tile.

### 6.5 Provenance and trust

No new trust tiers. News writes map onto the existing `SOURCE_PRIOR` kinds:

| writer | tag | prior kind |
|---|---|---|
| contemporary item synthesis (strict tier) | `news:<sourceId>@<itemId>` | `web` |
| contemporary item synthesis (optimistic tier) | `optimistic-extract:news:<sourceId>` | existing 0.35 prior, unchanged |
| KB enrichment | the source's own `provenanceTag(term)` via the research seam | `referenceLive` (as research today) |
| shipped fixture replay (demo buttons) | `news-fixture:<sourceId>@<itemId>` | `corpus` |
| uploaded `.jsonl` row, stated provenance above teach | re-tagged `teach:upload:<file>@<ts>` (`ingestUploadedFactRows`, section 10.2) | `teach` |
| uploaded `.jsonl` row, stated provenance at or below teach | kept as stated | as stated |
| syllogism round | `entailed:<rule>` | existing entailed prior, unchanged |

Each feed item shows the tier of its facts (a small chip: web / reference / corpus / teach /
entailed), so a fixture-replayed demo item is visibly not a live claim, and an uploaded file can
never render with trust it didn't earn — the validate-and-downgrade rule above caps it at teach
regardless of what the file itself claims. The `news:` prefix is what the feed builder and the
dashboard tiles filter on, and what a `/news forget` extension could retract by, the same way
research provenance groups today.

### 6.6 The news item (the feed unit)

```js
{
  id,                    // `news-feed:${sha256Hex(`${hub}\0${sortedFactIds.join(",")}`, 8)}`
  hub,                   // the center term
  factIds: [],           // every fact in the two-hop sub-graph, sorted by id
  changedCount,          // facts in the window that named the hub — the selection score
  builtAt,               // caller's `now`
  paragraph,             // template paraphrase, section 8.3
  tier,                  // the strongest prior kind among the window facts, for the chip
  sources: [],           // { title, url, name } from the snapshots behind the window facts
}
```

Identity is the hub plus the exact fact set, so an item refreshes (new id, replaces the old card
in place) when enrichment grows its sub-graph, and is stable when nothing changed.

### 6.7 The library contract

`src/services/news.mjs` owns the capability. Every surface — `news.html`, `chat.html`'s
`/news`, the TUI (via chat), the CLI verb, and the JS import — consumes the same exported
functions: `resolveNewsConfig`, `parseNewsRequest`, `pollNewsSources`, `ingestNewsSnapshot`,
`enrichTopTerms`, `reprocessAfterGrounding`, `isVocabGroundedTerm`, `isFactGroundedTerm`,
`ingestUploadedFactRows`, `buildFeed`, `newsTurn`, plus
the domain builders (`buildNewsItems`, `rankedTerms`) re-exported through the package entry
beside the existing public exports. No surface re-implements any step; a JS consumer gets
exactly what the page runs:

```js
import { resolveNewsConfig, pollNewsSources, buildFeed } from "@polycode-projects/the-mechanical-code-talker";
```

---

## 7. Phase 0 — domain: format parsers and the term ledger

Goal: pure functions that turn feed text into normalized items and count ungrounded terms.
No I/O anywhere in this phase.

**Built.** `src/domain/feed-normalize.mjs` and `src/domain/term-ledger.mjs` ship as specified
below, tested by `test/domain/feed-normalize.test.mjs` (21 tests) and
`test/domain/term-ledger.test.mjs` (12 tests). The `test/fixtures/news/` fixtures section 7.3
names are committed; the probe bodies section 4 records were not present on disk in the worktree
that built this phase, so the fixtures are authored samples matching each format's real field
shapes rather than trims of the recorded probe output.

### 7.1 `src/domain/feed-normalize.mjs`

New module. Imports `./hash.mjs` only. XML is parsed by string scanning (regex over `<item>`/
`<entry>` blocks) — the posture both siblings already ship (section 5) and the only one open to
a domain module, since `import-layers` bars packages and builtins (no `DOMParser`, no
`xml2js`). The parsers are lenient by construction: an unparseable block is skipped, never
thrown.

```js
export function detectFeedFormat(text)
// "rss" | "atom" | "jsonfeed" | null. JSON that parses with a `version` starting
// "https://jsonfeed.org/" is jsonfeed; text containing <feed with an Atom xmlns is atom;
// text containing <rss or <channel> is rss; else null.

export function stripMarkup(text)
// tags out, entities decoded (the named five + numeric), whitespace collapsed. Pure.
// The first half of the two-layer sanitisation rule (constitution): strip at parse,
// escape at render.

export function parseRss(text, { limit = 50 } = {})
export function parseAtom(text, { limit = 50 } = {})
export function parseJsonFeed(text, { limit = 50 } = {})
export function parseFeed(text, { format = null, limit = 50 } = {})
// each -> [{ guid, title, url, summary, publishedAt }], in document order, capped at limit.
// title and summary already through stripMarkup. publishedAt normalized to ISO or "".

export function feedItemId(sourceId, guidOrUrl)
// `news-item:${sha256Hex(`${sourceId}\0${guidOrUrl}`, 8)}`

export function normalizeFeedItems(sourceId, rawItems, { now, limit } = {})
// -> snapshot records (section 6.2) with fetchedAt = now, deduped by id, document order kept.
```

RSS fields read: `<guid>`, `<title>`, `<link>`, `<description>`, `<pubDate>`, `<dc:date>`.
Atom: `<id>`, `<title>`, `<link href>` (rel="alternate" preferred), `<summary>`/`<content>`,
`<updated>`/`<published>`. JSON Feed: `id`, `title`, `url`, `content_text` else
`stripMarkup(content_html)` else `summary`, `date_published`. The three API shapes
(wikimedia-feed, hn, usgs) normalize in their adapters (phase 2), because each is one source's
private shape, not a format.

### 7.2 `src/domain/term-ledger.mjs`

New module. Imports `normFactTerm` the same way `src/domain/syllogise.mjs` imports it.

```js
export function createTermLedger()                       // { terms: Map }
export function bumpTerms(ledger, termCounts, itemId, now, vocabGroundedByTerm = new Map())
// termCounts: Map<term, occurrences-in-this-text>. Normalizes keys, adds counts, tracks
// itemIds. `vocabGroundedByTerm` (term -> boolean) seeds each new entry's `vocabGrounded` flag
// (false when a term is missing from the map), set once on first insert and never revisited —
// lexicon membership doesn't change. Dedupe across cycles is inherent: one entry per normalized
// term.
export function rankedTerms(ledger, { limit = 20, status = null, now = null, ttlMs = 0 } = {})
// entries sorted count desc then term asc; status filters when given; a "missed" entry
// whose missedAt + ttlMs has passed `now` re-enters the pending view (the negative-cache
// expiry, computed pure — no clock inside).
export function markTerm(ledger, term, status, now)      // sets missedAt when status "missed"
export function groundedSweep(ledger, isFactGrounded)
// flips every pending/missed entry whose isFactGrounded(term) is now true; returns the flipped
// terms. `vocabGrounded` never gates this sweep — a term can flip to "grounded" (fact-grounded)
// while `vocabGrounded` stays false, or the reverse; the two states are independent.
export function ledgerPayload(ledger)                    // JSON-safe snapshot, sorted
export function ledgerFromPayload(payload)
```

Determinism: `ledgerPayload` emits entries in ranking order, so two peers with the same history
serialize identically.

### 7.3 Phase 0 tests

| file | what it holds |
|---|---|
| `test/domain/feed-normalize.test.mjs` | one fixture per format drawn verbatim from the probe bodies (an NYT RSS sample with `dc:`/`media:` fields, an Atom sample, the jsonfeed.org feed, a Daring Fireball item); format detection; markup stripping including CDATA, entities and a script-injection string that must come out inert; document order; the limit cap; a malformed block is skipped not thrown; `feedItemId` stability |
| `test/domain/term-ledger.test.mjs` | counts accumulate across bumps; ranking is count desc then term asc; payload round-trips byte-identically; `vocabGrounded` is set once on first insert from `vocabGroundedByTerm` and never revisited on later bumps; `groundedSweep` flips and reports on fact-grounding alone, independent of `vocabGrounded`; the negative-cache TTL expiry is pure (two `now` values, two answers, same ledger untouched); itemIds cap at 12 |

Fixtures live at `test/fixtures/news/` (`nyt-world.rss.xml`, `sample.atom.xml`,
`jsonfeed-org.json`, `daringfireball-item.json`, `wikimedia-featured.json`, `hn-topstories.json`,
`hn-items.json`, `usgs-quakes.geojson`, `wikinews-published.json`, plus one recorded response
per KB source), trimmed from the probe bodies to a handful of items each. These are the same
files the e2e specs route-fulfil and the shipped demo buttons replay (bundled as
`news-fixtures.json` by the page build), so the fixture set is committed once and consumed
three ways.

### 7.4 Phase 0 acceptance

```
npm run test:smoke
node --test test/domain/feed-normalize.test.mjs test/domain/term-ledger.test.mjs
node --test test/estate/import-layers.test.mjs
```

---

## 8. Phase 1 — domain: the feed builder

Goal: from fact rows plus `now`, choose hubs, cut two-hop sub-graphs, assemble items, and render
the paraphrase paragraph. Pure throughout.

**Built.** `src/domain/fact-phrase.mjs` and `src/domain/news-feed.mjs` ship as specified below,
tested by `test/domain/fact-phrase.test.mjs` (4 tests, including the pin against chat.mjs's own
table) and `test/domain/news-feed.test.mjs` (16 tests, including the CRDT order-independence
check and the cap-stability check). chat.mjs itself is untouched — the table stays duplicated in
both places until phase 4 repoints chat.mjs at this module and deletes the pin.

### 8.1 `src/domain/fact-phrase.mjs`

New module, extracted so the news renderer and chat share one predicate→phrase table instead of
growing a twin. Imports nothing.

```js
export const FACT_PREDICATE_PHRASES = Object.freeze({ /* the table chat.mjs holds today */ })
export function predicatePhrase(predicate)   // table hit or the predicate's local name
export function factSentence(row)            // "a heart has a valve" from one fact row
```

The extraction itself edits `src/services/chat.mjs` (delete the private table, import this one).
That edit belongs to phase 4, the serialized chat track, so this phase ships the module with the
table copied verbatim and phase 4 removes the duplicate. The two are pinned identical in the
interim by the phase 1 test below, so drift is loud.

### 8.2 `src/domain/news-feed.mjs`

New module. Imports `./hash.mjs`, `./fact-phrase.mjs`, `./hub-terms.mjs` (for `STOP_SET`), and
`normFactTerm` as in phase 0.

```js
export const NEWS_HUB_HOPS = 2;   // fixed by design, not a knob

export function newsWindowRows(rows, { now, windowMs })
// rows whose provenance carries a `news:`, `news-fixture:` or research tag and whose
// observedAt (else createdAt) falls inside [now - windowMs, now]. Pure filter.

export function scoreHubs(rows, windowRows, { limit = 6 } = {})
// counts window facts per term (subject and object, normalized, STOP_SET removed),
// -> [{ term, changed }] sorted changed desc then term asc, capped at limit.

export function subgraphAround(rows, hub, { hops = NEWS_HUB_HOPS, cap = 60 } = {})
// breadth-first over subject/object adjacency from hub, hop-bounded, deterministic
// (frontier sorted per hop), capped; -> fact rows sorted by id.

export function buildNewsItems(rows, { now, windowMs, limit, sourcesByFactId } = {})
// scoreHubs -> one item per hub (section 6.6, tier included), paragraph included, sorted
// builtAt desc then id asc. `sourcesByFactId` maps fact ids to snapshot source links.

export function renderNewsParagraph(hub, subgraphRows)
// section 8.3's fixed template. Pure; byte-stable for a given row set.

export function evictNewsFacts(rows, { cap })
// -> fact ids to retract: news-tagged rows past `cap`, oldest observedAt first, ties by id.
// Pure selector; the service applies it.
```

### 8.3 The paraphrase template

One paragraph, assembled from fact sentences in a fixed grouping order, no generation. The feed
is framed as facts-with-sources, never as an article summary — that framing is what keeps the
page useful at low grounding rates (section 16), because every sentence shown is a grounded
fact, not a paraphrase of prose the grammar could not read.

1. identity first: `rdf:type` / `rdfs:subClassOf` rows about the hub, rendered "X is a Y"
   and merged into one sentence when several ("X is a Y and a Z");
2. then the hub's own relations, grouped by predicate in `FACT_PREDICATE_PHRASES` table order,
   each group one sentence ("X has a A, a B and a C");
3. then one closing sentence for the second hop: "Around it: <first three second-hop facts as
   fact sentences>." when any exist.

Groups render in table order, members sorted by object term. The paragraph is capped at five
sentences; the fact list under the item always carries everything the paragraph could not.

### 8.4 Phase 1 tests

| file | what it holds |
|---|---|
| `test/domain/fact-phrase.test.mjs` | table hits, local-name fallback, one `factSentence` per predicate family; a pin that this table matches the one still inside `chat.mjs` (read the file, compare literally — the pin is deleted by phase 4 when the duplicate goes) |
| `test/domain/news-feed.test.mjs` | window filter respects `now` as pure input (two calls, two `now`s, different windows, same rows untouched); hub scoring ties break by term; STOP_SET terms never hub; two-hop BFS is hop-exact and cap-stable; item id changes when and only when the fact set changes; feeding one fact set in two different orders yields byte-identical items (the CRDT resolver check); paragraph grouping, order and the five-sentence cap; tier chip picks the strongest prior kind; `evictNewsFacts` never selects a non-news row and orders deterministically |

### 8.5 Phase 1 acceptance

```
npm run test:smoke
node --test test/domain/news-feed.test.mjs test/domain/fact-phrase.test.mjs
node --test test/estate/import-layers.test.mjs
```

---

## 9. Phase 2 — adapters: sources, fetch gates, and the news store

Goal: every shipped source behind one registry, every fetch behind a courtesy gate with
conditional-request support, state persistence beside the research queue's, and the re-probe
script.

### 9.1 Courtesy-gate extension (in `src/adapters/corpus/courtesy.mjs`)

Two additive options, no behaviour change for existing callers:

```js
createCourtesyGate({ ..., fetchText = false, validators = null })
// gate.fetchText(url) — same slot, cool-off and timeout as fetchJson, returns body text.
// validators: a Map the caller owns; when present, fetchJson/fetchText read/write
// { etag, lastModified } per URL, send If-None-Match / If-Modified-Since, and return
// { notModified: true } on a 304 instead of null.
```

### 9.2 `src/adapters/corpus/news-sources.mjs`

New module, modelled on `research-source.mjs` (a registry plus predicates, not a base class).

```js
export const NEWS_SOURCE_RECORDS = Object.freeze([ /* the ten section-4 records, both kinds */ ])
export const DEFAULT_NEWS_SOURCE_IDS = Object.freeze(["wikimedia-featured", "hacker-news", "usgs-quakes"]);
export const DEFAULT_NEWS_KB_IDS = Object.freeze(["simple-wikipedia", "wikidata", "wiktionary"]);
export function registerNewsSource(record)      // add-by-URL and tests extend the registry
export function newsSourceRecords()
export function normalizeNewsSourceIds(ids)     // unknown ids dropped, order preserved

export function createNewsFetcher(record, { fetchImpl, minIntervalMs, validators, now } = {})
// -> { id, async fetchItems() -> { items, bytes, notModified } | null }
// The gate's minIntervalMs defaults to record.minIntervalMs when the caller doesn't override
// it, so Hacker News runs at its own lower floor (section 4) while every other source keeps
// the shared 2s default.
// rss/atom/jsonfeed: gate.fetchText -> parseFeed -> normalizeFeedItems.
// wikimedia-feed: GET /feed/v1/wikipedia/en/featured/YYYY/MM/DD using the caller's `now`
//   converted to UTC, so the payload is the same for every visitor regardless of local
//   timezone; a 404 (the day's page not yet published) retries once against the previous UTC
//   day before giving up; items from the `news` key when present, else top `mostread` entries;
//   summary = extract; each item also carries wikibaseItem for the Wikidata short-circuit.
// hn: GET topstories.json, then item/<id>.json for the first 10 ids through the same gate;
//   title only, url from the item, summary "".
// usgs: GET the 2.5_day GeoJSON; title = properties.title, url = properties.url,
//   summary = "magnitude <mag> earthquake near <place>".
// mediawiki (wikinews): categorymembers query; title per member, url built from the title.
// Every returned string passes stripMarkup before it leaves the adapter.

export async function preflightNewsUrl(url, { fetchImpl } = {})
// the add-by-URL probe: https-only guard, one fetch, detectFeedFormat on the body.
// -> { ok: true, format } | { ok: false, reason: "not-https" | "browser-blocked" | "no-feed" }
// In a browser a CORS rejection surfaces as "browser-blocked" — the first-class state the
// panel renders as "source does not permit browser access".
```

### 9.3 KB sources through the existing research seam

Three additions, no new seam:

- **`simple-wikipedia`**: a registry entry in `research-source.mjs` whose `create` calls the
  shipped `createWikipediaLiveProvider({ origin: "https://simple.wikipedia.org", sourceName:
  "simple-wikipedia" })`. New code: one registration block.
- **`src/adapters/corpus/wiktionary-live.mjs`** (new): `createWiktionaryResearchSource({
  fetchImpl, minIntervalMs } = {})` returning the standard source shape. `lookup(term)` GETs
  `/api/rest_v1/page/definition/<term>`, takes the first English noun/verb sense, strips markup,
  and returns `{ title: term, summary: <definition sentence>, isa: <genus term when the
  definition head parses as "a|an <NP> that|which ...", else null> }`. Facts flow through the
  same `researchFacts` path, capped by `RESEARCH_SOURCE_RELATIONS`.
- **`src/adapters/corpus/dbpedia-lookup-live.mjs`** (new): `createDbpediaResearchSource({
  fetchImpl, minIntervalMs } = {})`. `lookup(term)` GETs the Lookup search, takes the top doc,
  returns `{ title: label, summary: stripMarkup(comment), isa: <first category local name> }`.

`RESEARCH_SOURCE_CHOICES` grows to `["wikipedia", "wikidata", "simple-wikipedia", "wiktionary",
"dbpedia"]`. The existing `/wikipedia`-style chat toggles and `--research-source` flag pick the
new names up through `normalizeResearchChoice` with no further wiring.

### 9.4 `src/adapters/news-store.mjs`

New module, mirroring `research-queue-store.mjs` exactly:

```js
export async function loadNewsState(memoryDir)   // -> state | null
export async function saveNewsState(memoryDir, state)
export async function clearNewsState(memoryDir)
// file: .tmct/news-state.json; in-memory/browser backends no-op (the page persists the same
// state object inside its IndexedDB snapshot instead).
// state: { items: [snapshots], ledger: ledgerPayload, health: [source health rows],
//          requestLog: [{ url, at, bytes, status }] (capped at 200, newest first),
//          metrics: [per-cycle rig rows, section 16], lastPollAt, lastEnrichAt }
```

### 9.5 `scripts/probe-news-sources.mjs`

The maintenance re-probe: launches headless Chromium (playwright is already a dev dependency),
fetches every registry record from an https page context, and prints the section-4 table with
fresh verdicts. Run by hand when a source misbehaves or before bumping `browserVerified`.
Never part of any test tier — CI has no internet.

### 9.6 Phase 2 tests

All with injected `fetchImpl` stubs serving the phase 0 fixtures; no network in any test.

| file | what it holds |
|---|---|
| `test/adapters/news-sources.test.mjs` | each fetcher turns its fixture into the expected snapshots (all seven formats); the courtesy gate is honoured; hn's fetcher uses its own lower `minIntervalMs`, every other source uses the shared 2000ms default; the wikimedia-feed date is computed in UTC and a 404 retries the previous UTC day; a 429 cools off; a failure returns null; a stub 304 comes back `notModified` with the validator headers sent; hn caps at 10 item fetches; every adapter output survives an injection-shaped fixture string inert; `preflightNewsUrl` classifies https/blocked/no-feed; unknown ids drop in `normalizeNewsSourceIds` |
| `test/adapters/wiktionary-live.test.mjs` | definition parse, genus extraction ("a vent or fissure on the surface of a planet" → isa "vent"), markup stripping, empty result → null |
| `test/adapters/dbpedia-lookup-live.test.mjs` | top-doc mapping, category → isa, empty docs → null |
| `test/adapters/news-store.test.mjs` | round-trip on the repo backend; browser/in-memory no-op; corrupt file reads as null; request log caps at 200 |
| `test/adapters/research-source.test.mjs` (extended) | the three new choices normalize; simple-wikipedia resolves to a provider with the simple origin |
| `test/adapters/courtesy.test.mjs` (extended) | fetchText shares the slot; validators round-trip; a 304 short-circuits |

### 9.7 Phase 2 acceptance

```
npm run test:fast
node --test test/adapters/news-sources.test.mjs test/adapters/news-store.test.mjs
node --test test/adapters/wiktionary-live.test.mjs test/adapters/dbpedia-lookup-live.test.mjs
node --test test/adapters/research-source.test.mjs test/adapters/courtesy.test.mjs
```

---

## 10. Phase 3 — the news service

Goal: the orchestration everything else calls: poll, ingest, ground, rank, enrich, re-process,
syllogise, build, evict, measure. One module, `src/services/news.mjs`, plus its config resolver.
This module is the library contract (section 6.7).

### 10.1 Config and parsing

```js
export const NEWS_DEFAULTS = Object.freeze({ /* section 6.4 values, camelCase */ });
export function clampNewsConfig(partial = {})
export function resolveNewsConfig(toml = null)
export function parseNewsRequest(line)
// kinds: show | poll | rank | enrich | sources | add {url} | interval {minutes} | null.
// Matches "/news", "/news poll", "news", "latest news", "any news on <term>?" (show with
// a focus term), same light-touch posture as parseResearchRequest.
```

### 10.2 The engine calls

Every function takes a `ctx` built once per surface:
`{ memoryDir, store, cache, lexicon, config, state, providers, now, notify }`, where `store` is
the syllogise store triple, `providers` carries the constructed fetchers and the research
provider getter, and `now` is a function the browser page and tests inject.

```js
export async function pollNewsSources(ctx)
// for each enabled contemporary source (config order), skipping any whose backoffUntil or
// autoDisabled says wait: fetchItems(); log { url, at, bytes, status } into state.requestLog;
// merge new snapshots by id into state.items (item_cap enforced oldest-out); update health
// rows (notModified counts healthy); then for each NEW snapshot, ingestNewsSnapshot; then
// evict (evictNewsFacts against news_fact_cap, applied through the store's retraction path).
// Returns { fetched, newItems, failures, evicted } — per-source, so the page can update
// chips incrementally.

export async function ingestNewsSnapshot(ctx, snapshot)
// splitSentences(title + ". " + summary) -> ingestText(text, { memoryDir, sourceTag:
// `news:${snapshot.sourceId}@${snapshot.id}`, optimistic: true, lexicon }) -> record factIds
// on the snapshot; bumpTerms(ledger, ungroundedCounts, snapshot.id, now, vocabGroundedByTerm).
// ingestText returns ungroundedTerms as a Set today, computed by the old conflated rule (a
// lexicon-resolved noun already read as grounded); this phase widens extract-facts.mjs so
// `ungroundedCounts` (a Map term -> occurrences in this text) follows the fact-degree rule
// instead (section 6.3): every term with zero fact rows, lexicon-known or not — additive, no
// caller breaks, since the old `ungroundedTerms` set stays a subset of it. `vocabGroundedByTerm`
// (term -> isVocabGroundedTerm(lexicon, term)) is computed alongside, for ledger display only.
// Then runs the syllogism round: syllogise(memoryDir, { focus: [subjects+objects of
// the new facts through factTermVariants], expandFocus: true, budget:
// config.syllogismsPerIngest, store }). Returns { facts, derived, ungrounded }.

export async function enrichTopTerms(ctx, { limit = config.enrichTermsPerCycle } = {})
// take the top `limit` pending terms from rankedTerms (negative cache filtered by TTL);
// for each, mark "enriching", then walk the enabled KB sources in config order through
// getResearchProvider({ source }); first lookup hit wins; ingest the article through the
// research lane's ingest under the source's provenanceTag; on success mark "grounded"
// (fact-grounded — `vocabGrounded` is untouched) and reprocessAfterGrounding; on all-null mark
// "missed" with missedAt = now.
// Wikimedia-feed items that carried wikibaseItem short-circuit straight to the wikidata
// source with the Q-id. Returns { enriched: [term], missed: [term], facts, derived }.

export async function reprocessAfterGrounding(ctx, groundedTerms)
// every snapshot (and unprocessed KB article text held in state) whose text mentions a newly
// grounded term gets ingestNewsSnapshot run again (processedRounds++); content-addressed fact
// ids make the re-run upsert rather than duplicate. Then one syllogism round focused on the
// union of the round's new facts. Then groundedSweep(ledger, isFactGroundedTerm) so the ranked
// list sheds everything the round fact-grounded.

export function isVocabGroundedTerm(lexicon, term)
// true when the lexicon resolves the term as a noun. Answers parseability only — never used to
// decide ledger admission or enrichment eligibility, display only.

export function isFactGroundedTerm(rows, term)
// true when factTermVariants(normFactTerm, term) hits any row subject/object. THE fact-grounding
// definition: what ledger admission, `groundedSweep`, and enrichment eligibility all test. A
// term with zero fact rows is fact-ungrounded and belongs in the ledger, whether or not it is
// vocab-grounded.

export async function buildFeed(ctx)
// readFactRows -> buildNewsItems(rows, { now, windowMs, limit: config.itemCap,
// sourcesByFactId: from state.items }) -> state, returned for rendering. Seed-only graphs
// produce items too (S1): with no news-tagged rows in the window, scoreHubs falls back to
// whole-graph degree so the first paint is never empty; every item in that fallback state
// carries the seed label (section 13.1) until pollNewsSources runs once.

export function ingestUploadedFactRows(rows, { fileLabel, now } = {})
// validate-and-downgrade (section 6.5): any row whose stated provenance sits above the teach
// tier in the SOURCE_PRIOR order is re-tagged `teach:upload:<fileLabel>@<now>` before it lands;
// rows at or below teach keep their stated provenance. Pure; the page's `.jsonl` upload and any
// future CLI upload path both call this before appending — an uploaded file can never claim
// operator- or corpus-grade trust it didn't earn.

export async function newsTurn(line, ctx)
// parseNewsRequest -> the matching call -> a rendered text block (items as "N. <paragraph>
// (tier, sources: ...)"; rank as a numbered term list with counts; sources as a status
// table including blocked/backed-off states). Unknown subcommand -> the usage line. Every
// surface renders through this one function so wording stays identical.

export function cycleMetrics(before, after, { source } = {})
// the rig row (section 16): { at, sourceId, sentences, groundedRateStrict,
// groundedRateOptimistic, factsAdded, termsResolved, derived, timeToFirstArticleMs?,
// timeToFirstCompletePollMs? } — computed from two state snapshots, pure, appended to
// state.metrics by the callers above.
```

### 10.3 Phase 3 tests

| file | what it holds |
|---|---|
| `test/services/news-service.test.mjs` | poll merges by id and enforces item_cap; health rows track failures, back off with doubling, and auto-disable at 3; a backed-off source is skipped until its time; ingest writes facts under the `news:` tag and bumps the ledger with real counts, admitting a lexicon-known, fact-empty term (`vocabGrounded` true) exactly like an unknown word; the syllogism round runs with the configured budget and its derived count is reported; enrich caps at enrich_terms_per_cycle, walks sources in config order, first hit wins, miss enters the negative cache and is not retried inside the TTL; reprocess re-runs exactly the snapshots that mention the grounded term, upserts without duplicates, and sweeps the ledger by fact-grounding alone; eviction retracts only news facts, oldest first, never below the cap; `isVocabGroundedTerm` and `isFactGroundedTerm` independently — a term with facts but no lexicon hit, a term with a lexicon hit but no facts (still ledger-eligible), and a term with neither; `ingestUploadedFactRows` downgrades an above-teach row and leaves an at-or-below-teach row untouched; buildFeed S1 fallback on a seed-only graph; the request log records every fetch; `cycleMetrics` arithmetic including both grounding-rate columns; determinism: same state + same `now` twice → byte-identical feed |
| `test/services/news-config.test.mjs` | defaults, clamps (including the poll floor of 5), TOML pass-through via `normalizeConfig`, precedence with `mergeEffective`; `parseNewsRequest` one case per kind plus a decline |
| `test/adapters/extract-facts-from-text.test.mjs` (extended) | `ungroundedCounts` counts occurrences per fact-ungrounded term (zero fact rows, lexicon-known or not) and is a superset of the existing `ungroundedTerms` set — a lexicon-known, fact-empty term like "ceasefire" appears in `ungroundedCounts` but not in the legacy `ungroundedTerms` |

### 10.4 Phase 3 acceptance

```
npm run test:fast
node --test test/services/news-service.test.mjs test/services/news-config.test.mjs
node --test test/adapters/extract-facts-from-text.test.mjs
node --test test/adapters/toml-config.test.mjs
```

---

## 11. Phase 4 — chat wiring (the serialized track)

Goal: `/news` in chat on every surface that hosts chat, beside `/wiki`, plus the fact-phrase
deduplication. Everything in this phase touches `src/services/chat.mjs` or its session
plumbing, so it runs alone.

File-by-file, following the `/wiki` + research-lane precedent:

1. **`src/services/chat.mjs`**: a `news` branch in `runCommand`'s if-chain beside `/wiki`
   (subcommands per `parseNewsRequest`; no argument shows the feed; every reply comes from
   `newsTurn`); `newsStateNext` threaded through the `mk` builder; one `GOAL_BY_COMMAND` entry;
   one `helpText()` row (`["/news [poll|rank|enrich|sources|add <url>]", "the news feed over
   this graph"]`). `COMMANDS`/`COMMAND_WORDS` stay untouched (graph-tool commands only, the
   standing rule). Also here: delete the private predicate-phrase table and import
   `src/domain/fact-phrase.mjs` (the phase 1 pin test's duplicate goes with it).
2. **`src/services/chat-session.mjs`**: `resolveNewsConfig(toml)` beside the research resolver;
   `newsState` holder, getter, the `runTurn` option bag entry, and the
   `if ("newsState" in result)` write-back — the four spots that thread `researchState` today.
3. **`src/surfaces/web/turn-session.mjs`**: `newsState` in the same four spots.
4. **`src/surfaces/web/chat-browser-entry.mjs`**: `buildExtraOptions`/`captureExtraState` carry
   the news state; `registerNewsProvider` (a browser-registered provider set, the same stub seam
   `registerResearchProvider` gives tests) so `chat.html` itself can answer `/news` against
   whatever sources are enabled — with the same consent rule: no fetch before the user's first
   explicit `/news poll` on that page.

The TUI (`src/surfaces/tui/app.mjs`) needs zero edits and gets the command for free.

### 11.1 Phase 4 tests

| file | what it holds |
|---|---|
| `test/services/chat-news-command.test.mjs` | `/news` with no state shows the seed-built feed; `/news poll` with a stubbed provider set ingests and reports counts; `/news rank` lists ranked terms; `/news enrich` grounds the top term through a stubbed research provider and reports the refresh; an unknown subcommand shows usage; state round-trips through two turns; the help row exists |
| `test/services/chat-fact-phrase.test.mjs` | chat renders fact lines through the shared table (a read-back turn per predicate family, asserting unchanged wording against the pre-extraction goldens) |

Corpus rows in a new lane `test/corpus/news.jsonl`, runner `test/corpus/news.test.mjs`
(`runLane("news")`), keys validated by `validateRow`, all offline (stubbed providers via
`setup`, or seed-only paths):

| key | id | turns |
|---|---|---|
| `news.feed.seed-first-items` | `news-feed-seed-facts-make-the-first-items` | setup.facts seeds a small graph; `/news` → regex: a paragraph naming the seeded hub |
| `news.feed.deterministic` | `news-feed-same-graph-same-feed` | `/news` twice → same-as-turn |
| `news.rank.counts` | `news-rank-orders-ungrounded-terms-by-occurrence` | teach two sentences sharing one unknown term, one sentence with another; `/news rank` → regex: first term listed first with count 2 |
| `news.rank.vocab-grounded-still-ranks` | `news-rank-lists-a-lexicon-known-term-with-no-facts` | a sentence mentions a term the seed lexicon resolves as a noun ("ceasefire") but no fact row names it; `/news rank` → regex: the term appears, labelled "parseable but knowledge-free", not omitted |
| `news.miss.no-sources` | `news-poll-with-no-enabled-sources-reads-as-a-plain-report` | config disables all sources; `/news poll` → regex: "no sources enabled", predicate: not a fact write |
| `news.miss.unknown-subcommand` | `news-unknown-subcommand-shows-usage-never-guesses` | `/news frobnicate` → regex: usage line |

(the lane picks up more rows in phase 8; these six make the matrix group non-thin and give it
its negative keys from day one.)

### 11.2 Phase 4 acceptance

```
npm run test:fast
node --test test/services/chat-news-command.test.mjs test/services/chat-fact-phrase.test.mjs
node --test test/corpus/news.test.mjs
node scripts/corpus-matrix.mjs
npm run build:ask-bundle
```

---

## 12. Phase 5 — CLI verb and config init

Goal: `tmct news` on the command line; `[news]` writable by init. Mechanical against verbatim
precedents.

1. **`src/domain/cli-verbs.mjs`**: one `CLI_VERBS` entry after `syllogise`:
   `{ mode: "news", errorLabel: "news", usage: "tmct news [poll|rank|enrich|sources]
   [--repo <abs>]", prose: [...], flags: [{ flag: "[--limit <n>]", ... }, { flag:
   "[--config <path>]", ... }] }`.
2. **`bin/tmct.mjs`**: the dispatch block modelled line for line on the `syllogise` block (same
   `resolveRuntimeConfig`, same `openMemoryBackend`/`closeMemoryStore` bracketing); it builds a
   ctx and calls `newsTurn` with the joined arguments, printing the same text chat shows. Also
   the `readConfigForRewrite` merge line for `[news]`.
3. **`src/services/init.mjs`**: a `[news]` block in `renderTomlConfig`, emitted only when
   supplied, with the precedence comment line, matching the `[research]` template.
4. **`package.json`**: `"news": "node --disable-warning=ExperimentalWarning bin/tmct.mjs news"`.

Tests: extend `test/adapters/cli-verbs.test.mjs` (the new verb renders in usage) and
`test/services/init.test.mjs` (the `[news]` block round-trips). Acceptance:

```
npm run test:fast
node --test test/adapters/cli-verbs.test.mjs test/services/init.test.mjs
printf 'hi\n/exit\n' | node bin/tmct.mjs
node bin/tmct.mjs news sources
```

---

## 13. Phase 6 — the page

Goal: `news.html` as a generated demo page with its own bundle, the ledger dashboard idiom, the
chat seed, consent-gated timers, the request log, and the free-text/upload panel.

### 13.1 `src/services/news-viz.mjs`

`renderNewsHtml({ title, seedStamp, seedBytes, digestStructures })`, modelled on
`renderChatHtml` for the shell and `renderLedgerHtml` for the dashboard. Layout, top to bottom:

- the demo eyebrow (`demoEyebrowHtml("news", ...)` — which hard-requires `news-about.html`,
  shipped in phase 7);
- `<section class="dash">`: a `.kpirow` of five tiles — `feed.items`, `terms.ungrounded`,
  `facts.from-news`, `graph.size` (facts plus estimated bytes from
  `navigator.storage.estimate`, refreshed per cycle), `sources.live` — and `.barpanels` of two
  `.tile.tile-bars`: the ranked fact-ungrounded terms as `microbarsHtml` (the on-page ranking
  display, each bar labelled "parseable but knowledge-free" or "unknown word" per its
  `vocabGrounded` flag), and per-source item counts with health chips;
- the controls row: the start button (first visit; becomes poll-now after consent), the
  poll-interval select (`off / 5 / 15 / 60` minutes, default from config, floor 5, persisted as
  a localStorage preference), a **stop & forget** control beside it that clears the start-consent
  preference and halts the timer, reverting the page to its first-visit state on the next load
  (the revoke path the about page names, section 14 item 3), source toggles (defaults on;
  selectables off; a `browserBlocked` entry renders "source does not permit browser access"),
  an add-by-URL input (https only, preflighted, section 9.2), `enrich now`, and the two fixture
  demo buttons ("replay recorded NYT sample", "replay recorded Wikipedia sample") that push the
  bundled `news-fixtures.json` payloads through the exact live pipeline under the
  `news-fixture:` tag;
- the request log: a collapsible table, one row per request — URL, time, bytes, status —
  fed from `state.requestLog`, empty until consent, the page's own provenance;
- the feed: `feed_top` newest items pinned, the rest below; each item renders the paragraph,
  the tier chip, a `<details>` fact list (each line via `factSentence`, expandable again to the
  raw triple record `{ id, subject, predicate, object, provenance, trust }` through the
  `factTripleParts` helper), and the source links; before the first successful poll, every item
  also carries an explicit label, "from the seed graph — start to poll live sources", beyond the
  corpus tier chip, so seed content never reads as live news;
- the teach panel: a textarea, two example buttons that fill it (a short prose corpus about a
  seeded topic, and a ten-line JSONL fact set — inline constants `NEWS_EXAMPLE_TEXTS`), a file
  input accepting `.txt`/`.md` (prose corpus), `.json` (lexicon in the `lexicon-core.json`
  shape, merged as a vocab hint), `.jsonl` (fact rows validated and appended through
  `ingestUploadedFactRows`, section 10.2 — any row whose stated provenance sits above the teach
  tier is re-tagged `teach:upload:<file>@<ts>` before it lands, so an uploaded file can never
  claim operator- or corpus-grade trust it didn't earn; the graph's own exchange shape as the
  ontology form, now behind that guard), and an ingest button;
- the page log (`appendLogLine`).

Every interpolation of fetched or user-supplied text goes through `escapeHtml`. A test greps
the renderer for unescaped sinks.

### 13.2 `src/surfaces/web/news-browser-entry.mjs`

`createNewsSession({ seedPayload, vocabSeeded } = {})`, modelled on `createResearchSession` +
`createChatSession`: in-memory store, `applySeedPayload` with `chat-seed.json`,
`openPersistedStore({ storeKey: "news", stamp })` carrying facts plus the news state,
`publishTmctSurface({ page: { start, poll, enrich, buildFeed, rank, addSource, setInterval,
ingestText, ingestFile, replayFixture, revokeConsent } })`, the S0–S5 phase machine plus
`metrics` (including time-to-first-article, measured from navigation start to the first item
render, and time-to-first-complete-poll, measured to the last enabled source returning or
failing once) on `window.tmct.news`, and the poll timer as a plain re-armed interval honouring
consent, the floor, and per-source backoff. Browser fetching uses the phase 2 fetchers with
`fetchImpl: fetch`.

`scripts/build-news-bundle.mjs` + `"build:news-bundle"` script, exporting `main(outDir)` through
`buildBundle` like every sibling; it also emits `public/news-fixtures.json` from
`test/fixtures/news/` so the demo buttons and the tests share one committed fixture set.

### 13.3 Phase 6 tests

| file | what it holds |
|---|---|
| `test/services/news-viz.test.mjs` | the rendered HTML carries the meta marker pair, the seven dashboard tiles/panels' labels, the start button, the request-log section, the controls, the two fixture buttons and two example buttons; no unescaped interpolation sink; no third-party URL outside the sources config block |
| `test/adapters/news-browser-entry.test.mjs` (function-level, beside `mudiii-browser-entry.test.mjs` and its siblings) | session builds against a seed payload; page API surface is published; no fetch fires before `start()` (stub fetchImpl asserts zero calls); phase transitions fire in order against stubbed fetchers; fixture replay lands facts under `news-fixture:` with corpus-tier trust; pre-start items carry the seed label; an uploaded row above teach tier lands re-tagged `teach:upload:<file>@<ts>`; `revokeConsent` clears the start preference and a reload reads as first-visit again; the interval setter re-arms and clamps to the floor |

Acceptance:

```
npm run test:fast
node --test test/services/news-viz.test.mjs test/adapters/news-browser-entry.test.mjs
npm run build:news-bundle
npm run demo:build
```

---

## 14. Phase 7 — site integration

Goal: every touchpoint a generated demo page owes the estate. Split 7a (authored surfaces) and
7b (mechanical counts), dispatchable separately. Adding `"news"` to `DEMO_PAGES` carries
sitemap, head meta, SW precache and OG wiring through the existing generators (section 1); the
items below are the genuinely per-page surfaces.

**7a — authored:**

1. `scripts/site-pages.mjs`: `"news"` into `DEMO_PAGES`; `DEMO_PAGE_META.news = { title:
   "News", description: "..." }`.
2. `scripts/build-demo-site.mjs`: import `renderNewsHtml` and add the render/write block,
   mirroring the ledger block; everything list-driven (sitemap, meta, precache) follows from
   `DEMO_PAGES` untouched.
3. `public/news-about.html`: the seven fixed sections (`#what #play #shots #inference #build
   #papers #credits`) with the Next chain, covering the mechanism, the network posture — the
   start click is a one-time preference, not a per-fetch prompt: it persists in localStorage
   across return visits, which is why the page polls on load once you've started it, and the
   **stop & forget** control (section 13.1) clears that preference and reverts the page to its
   first-visit state — the request log, conditional requests, the full source roster with both
   probe verdicts, licences and attribution (section 4.3), and the papers hooks (abstention,
   open-world; plus format citations: RSS 2.0, Atom RFC 4287, JSON Feed 1.1).
4. `public/index.html`: the demo card (`.claim-cell`, h3 equal to `DEMO_PAGE_META.news.title`),
   the feature plate (renumber the roman numerals), the "What each demo demonstrates"
   `table.matrix` row — news takes the "Search backed" focus cell, chat's cell stays a tick —
   the two hard-coded copy counts ("six easy pieces" → seven, "Six demos" → "Seven demos"),
   and the hero's "offline" wording becoming "offline by default", with the demo card copy
   saying why (fetches only on your say-so, request log on the page).
5. `public/help.html`: a `#news` section (how to start, what the ranked list means, how
   add-by-URL reports a blocked source), linked from the page the way `#chat` and `#sharing`
   are today.
6. `public/share.mjs`: `SCREENSHOT.news` and `POSTS.news` (five posts, unique angles; at least
   one carries a rig number once section 16's first measured run lands — the post text is
   written with the placeholder marked so the rig phase fills it).
7. `.gitignore`: `public/news.html`, `public/news-browser.bundle.js`,
   `public/news-fixtures.json`.

**7b — mechanical:**

8. `scripts/gen-og-images.mjs` iterates `DEMO_PAGES`, so run it; commit `public/og/news.png`
   (1200×630).
9. `scripts/gen-screenshots.mjs`: `PAGE_ORDER` + `READY_CHECKS.news` (feed has ≥1 item);
   commit `public/screenshots/news.png` + the manifest row.
10. Estate count bumps, each to the measured value: `test/estate/site-meta.test.mjs` page count
    and sitemap count 16 → 18 (news.html + news-about.html); `og-images.test.mjs` picks the new
    PNG up from `DEMO_PAGES` automatically — verify only; `home-page-links.test.mjs` extend the
    hard-coded alternation with `news` and re-measure `EXPECTED_ANCHOR_COUNT`;
    `screenshots.test.mjs` — manifest verify only.

Acceptance:

```
npm run demo:build
node --test "test/estate/*.test.mjs"
node scripts/gen-og-images.mjs && node --test test/estate/og-images.test.mjs
```

(run `gen-screenshots` against the freshly built site before the estate pass; screenshots are
committed artifacts.)

---

## 15. Phase 8 — e2e and the remaining corpus rows

Goal: Playwright coverage of the UX contract, fixture-driven, enrolled in CI by name. CI passes
with no internet access: every route is fulfilled from `test/fixtures/news/`.

New specs, following `pages-about-overflow.test.mjs` (node:test + playwright-as-library, served
through `buildDemoSiteSnapshot` + `serveDirectory`):

| file | what it holds |
|---|---|
| `test-e2e/pages-news.test.mjs` | structural: page loads with zero console/page errors; **zero third-party requests before the start action** (the `openPage` helper already blocks third-party hosts — the assertion is that none is even attempted pre-consent); after a synthetic start with all routes blocked, the page degrades to S1 plus failure chips and stays error-free; the seven tiles/panels render; no horizontal overflow at 375 and 320 px; the about and help anchors resolve |
| `test-e2e/pages-news-feed.test.mjs` | the contract, states S1–S5: `page.route` fulfils each default source from the fixtures; S1 items exist before routes release; items grow on poll; the request log gains one row per fulfilled route with plausible byte counts; the ranked list matches fixture arithmetic; enrich (routes fulfil the KB fixtures) flips a term, refreshes an item, bumps the derived tile, and a blocked KB term enters the negative cache; the fixture demo button produces corpus-tier items with the network still blocked; the interval select re-arms `nextPollAt` and clamps to the floor; time-to-first-article and time-to-first-complete-poll both land on `window.tmct.news.metrics` |

CI: add both file names to the `e2e-web-local-origin` job list in `.gitlab-ci.yml` (specs not
named in a job never run — the standing hazard).

Remaining corpus rows (same lane, same runner):

| key | id |
|---|---|
| `news.enrich.reprocess` | `news-grounding-a-term-reprocesses-old-items-and-runs-a-syllogism-round` |
| `news.enrich.budget` | `news-syllogisms-per-ingest-caps-the-derived-count` |
| `news.enrich.negative-cache` | `news-missed-term-waits-out-its-ttl-before-retry` |
| `news.ingest.free-text` | `news-free-text-teaches-facts-and-ranks-the-rest` |
| `news.ingest.lexicon-upload` | `news-lexicon-json-widens-grounding-without-fact-writes` |
| `news.ingest.upload-downgrade` | `news-uploaded-jsonl-above-teach-tier-downgrades-to-teach` |
| `news.miss.enrich-all-sources-empty` | `news-enrichment-miss-marks-the-term-missed-never-guesses` |

Acceptance:

```
npm run test:fast
node --test test/corpus/news.test.mjs
node scripts/corpus-matrix.mjs --gaps
node --test test-e2e/pages-news.test.mjs test-e2e/pages-news-feed.test.mjs
```

---

## 16. Phase 9 — the rig and the claims block

Goal: the measurement rig ships with the feature, not after it. It answers, with committed
numbers, the question every claim about this page will need.

**The six metrics**, produced by `cycleMetrics` (section 10.2) and accumulated in
`state.metrics`:

1. grounding rate per source per cycle, as two separate columns — **strict** (recognized
   sentences over total) and **optimistic** (recognized + optimistic sentences over total) —
   never merged into one number;
2. facts synthesised per poll;
3. ungrounded terms resolved per enrichment round;
4. syllogisms derived per round;
5. time-to-first-article (page metric, navigation start to first rendered item);
6. time-to-first-complete-poll (page metric, navigation start to the last enabled source
   returning or failing once — section 4's HN latency budget is what this metric checks).

**The rig runner**: `scripts/news-rig.mjs`. Replays the committed fixture set through the full
service loop (poll → ingest → rank → enrich → reprocess → build) against the standard seed,
deterministically, and prints the metrics table (strict and optimistic grounding rate as
separate columns) plus a per-source breakdown. Because input and seed are fixed, the numbers are
reproducible on any machine — the same posture as the benchmark reports. The first measured
run's table lands in `reports/NEWS_RIG.md` and its headline number back-fills the share post
placeholder (phase 7a.6).

**Expectations, set here so nobody is surprised:** the prose band measured 18.65% **strict**
grounding on Simple English Wikipedia sentences (its optimistic count is zero on that band, so
the two columns read the same there); contemporary news prose is denser with unknown names, so
both columns will likely read lower here. Publishing strict and optimistic as separate columns,
with strict as the headline, means a lower number here never reads as a moved goalpost against
the prose band's own strict-only 18.65%. The page is designed to read as alive and useful at
roughly 10% strict grounding: the feed shows facts-with-sources rather than article summaries
(section 8.3), the ungrounded panel turns the misses into the visible work queue, and the
default source choices lean toward already-groundable vocabulary (Wikimedia extracts with
Q-ids; Hacker News titles against the seeded code bands). The rig is what turns that design
intent into a measured claim.

**The claims block**: one admission-standard block on the claims page, backed by the rig table
in `reports/NEWS_RIG.md`, pinned by `test/estate/claims.test.mjs` (`CLAIMS_PAGE_BLOCKS` grows
by one; the block states the grounding rate as its two published columns — strict is the
headline number, optimistic sits beside it labelled as such — the fixture provenance, and the
honest-miss framing). The block lands in the same commit as the first committed rig report,
never before.

Tests: `test/services/news-rig.test.mjs` runs the rig entry function on the fixture set and
asserts the metrics arithmetic (including both grounding-rate columns) and determinism (two
runs, identical tables).

Acceptance:

```
node scripts/news-rig.mjs
node --test test/services/news-rig.test.mjs
node --test test/estate/claims.test.mjs
```

---

## 17. Concurrency and model tiers

One owner per file per round. Anything touching `src/services/chat.mjs` serializes.

| track | owns | depends on | model |
|---|---|---|---|
| 0 feed parsers + ledger | `src/domain/feed-normalize.mjs`, `src/domain/term-ledger.mjs`, `test/domain/feed-normalize.test.mjs`, `test/domain/term-ledger.test.mjs`, `test/fixtures/news/*` | — | Sonnet |
| 1 feed builder | `src/domain/news-feed.mjs`, `src/domain/fact-phrase.mjs`, their tests | — (table copied per 8.1) | Sonnet |
| 2 source adapters | `src/adapters/corpus/news-sources.mjs`, `wiktionary-live.mjs`, `dbpedia-lookup-live.mjs`, `src/adapters/news-store.mjs`, the additive `courtesy.mjs` options, one registration block in `research-source.mjs`, `scripts/probe-news-sources.mjs`, their tests | 0's parser exports | Sonnet |
| 3 news service | `src/services/news.mjs`, `test/services/news-*.test.mjs`, the additive `extract-facts.mjs` widening, the `toml-config.mjs` pass-through line | 0, 1, 2 | Sonnet |
| 4 chat wiring | `src/services/chat.mjs`, `chat-session.mjs`, `turn-session.mjs`, `chat-browser-entry.mjs`, `test/services/chat-news-*.test.mjs`, `test/corpus/news.jsonl` (first five rows) + runner | 3 | Sonnet |
| 5 CLI + init | `src/domain/cli-verbs.mjs`, `bin/tmct.mjs`, `src/services/init.mjs`, `package.json` | 3 | Haiku |
| 6 page | `src/services/news-viz.mjs`, `src/surfaces/web/news-browser-entry.mjs`, `scripts/build-news-bundle.mjs`, their tests | 1, 2, 3 | Sonnet |
| 7a site authored | `scripts/site-pages.mjs`, `scripts/build-demo-site.mjs`, `public/index.html`, `public/news-about.html`, `public/help.html`, `public/share.mjs`, `.gitignore` | 6 | Sonnet |
| 7b site mechanical | `public/og/news.png`, `public/screenshots/*`, `test/estate/site-meta.test.mjs`, `home-page-links.test.mjs`, screenshot manifest | 7a | Haiku |
| 8 e2e + corpus rest | `test-e2e/pages-news*.test.mjs`, `.gitlab-ci.yml` job lists, remaining `test/corpus/news.jsonl` rows | 4, 6, 7a | Sonnet |
| 9 rig + claims | `scripts/news-rig.mjs`, `reports/NEWS_RIG.md`, `test/services/news-rig.test.mjs`, the claims block + `test/estate/claims.test.mjs`, the share-post number | 3 (runnable), 7a (block lands) | Sonnet |

**What runs concurrently.** Wave 1: tracks 0, 1 and 2 launch together (2 stubs the two parser
exports it needs until 0 merges, or simply starts with the store and KB files). Wave 2: track 3
alone once 0–2 merge. Wave 3: tracks 4, 5, 6 and 9's rig runner together — disjoint files, all
consuming 3's exports, which this document fixes. Wave 4: 7a with 8's spec drafting; 7b after
7a's merge; 8's CI enrolment and screenshot-dependent assertions last; 9's claims block in the
same commit as the first committed rig report.

**What serializes.** Track 4 owns every `chat.mjs`-adjacent file and runs alone in its wave.
Track 7a owns `build-demo-site.mjs` and `index.html`; nothing else may touch them.

**Model tiers.** Sonnet everywhere the code is new but the design is fixed here; the two
genuinely subtle spots both live in track 3 (re-process idempotence and the deterministic feed)
and are pinned by named tests before they can drift. Haiku for the two verbatim-precedent
tracks (5, 7b). No Opus anywhere.

**Sub-agent discipline.** Every dispatch brief caps testing at `npm run test:fast` plus the
track's own files, names those files, and cites this section. Worktree prep for any track that
runs tests: `node scripts/ensure-worlds-pack.mjs`, `node scripts/ensure-sprite-facts.mjs`,
`npm run build:ask-bundle`. No sub-agent touches the network: every test injects `fetchImpl`
and every e2e route is fixture-fulfilled. The full suite, `npm run check:readme` (the CLI
surface grew a verb) and the e2e tier are the coordinator's post-merge job.

---

## 18. Costs and risks

- **Feed drift.** Publishers change formats, retire feeds, and condition their CORS on the
  client — Reuters and AP were already gone by probe time, Wikinews announced its own closure,
  and GDELT's header vanishes for real browsers. The dual-verdict table, the health rows, the
  backoff/auto-disable rule and the re-probe script are the design answer: a decayed source
  degrades to a labelled chip, never a broken page, and the e2e structural spec asserts exactly
  that degradation.
- **Grounding quality is bounded by the ingest grammar.** Headline prose is dense with names the
  lexicon lacks; most contemporary sentences will land in the optimistic tier or the
  fact-ungrounded ledger. That is the designed behaviour — the ledger's fact-degree admission
  (section 6.3) makes sure a lexicon-known hub term with no facts yet still queues for
  enrichment rather than reading as already grounded; it is the honest-miss wall made visible,
  the KB loop is the uplift path, and section 16 sets the numeric expectation (~10% strict must
  read as alive) and measures it rather than hoping.
- **Determinism vs. live data.** The world is not deterministic; the engine is. Same payload,
  same facts; same facts plus same `now`, same feed. Tests never fetch, fixtures pin every
  parser, and the two-orders check pins the builder, so all nondeterminism stays at the network
  boundary where it belongs.
- **Storage growth.** The graph grows with every poll. `news_fact_cap` plus snapshot `item_cap`
  bound it, eviction is deterministic and news-only, and the graph-size tile keeps the number in
  the user's face next to the browser's own quota estimate.
- **Page weight.** `news.html` reuses `chat-seed.json` (~7 MB gzip, already deployed and
  SW-cached for chat.html) rather than shipping a second seed. After landing, refresh
  `reports/PAGE_WEIGHTS.md` via the `page-weights` skill.
- **Rate limits and courtesy.** Every fetcher sits behind its own courtesy gate with the 2s
  floor, conditional requests where the source supports validators, the 429 cool-off, and
  per-source backoff on failure; the poll floor is 5 minutes; the Wikimedia sources get the
  identifying user agent the shipped adapters already send.

---

## 19. Not in this plan

- A server-side poller, push updates, a CORS relay, or any hosted backend. The page is static;
  an operator who wants no-CORS sources in a browser runs their own relay and adds it by URL —
  designing such a relay is separate work.
- Retraction UX for news facts (`/news forget <source>`); the provenance tags are shaped so the
  research-forget precedent extends naturally when that lands.
- Entity linking beyond the Q-id short-circuit (disambiguation pages, coreference). The
  candidate literature is entity linking / wikification; until a tier is designed, an ambiguous
  term grounds to whatever the KB source's top result says, cited as such.
- De-duplicating one story reported by two outlets into one item. Items cluster by hub term,
  which already merges same-topic coverage; story-identity clustering is its own design.
- Runtime API keys for key-holding sources (Guardian content API and peers) beyond what
  add-by-URL already allows a user to paste into a URL they control.
- A second ranking signal from structural thinness (marginalia's `rankGaps` precedent, section
  5.2) — a candidate uplift for the term ledger once occurrence ranking has measured baselines.
- LLM involvement of any kind. A sibling may classify or smooth on its own side of the seam
  (section 5); tmct renders templates.
