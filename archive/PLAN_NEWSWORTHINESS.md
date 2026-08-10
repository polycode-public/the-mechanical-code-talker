# PLAN_NEWSWORTHINESS.md — entity-anchored news: a card needs a name the graph just learned, or a fresh fact about a name it holds

Status: BUILT. Phases N0-N4 are landed and measured (build markers under each phase, section 5).
It succeeds `archive/PLAN_NEWS_FEED.md`'s phase 10 (the reported/background/derived banding,
shipped in 5.0.35) and replaces that phase's seed fallback. The operator's field report on the
live 5.0.35 feed motivated it: the fallback served corpus concept cards ("purse", "finding
information", "entertaining", "drawer", "cars"), and a reader already knows what a drawer is.
That was not news.

This plan is written to be built by Sonnet-tier implementers with no further design work. Every
phase names its module paths, function signatures, test files and acceptance commands. Phases
run after the in-flight news-controls work (stop-and-forget purge, default source roster, poll
controls, enrich paraphrasing) lands, because both touch `src/services/news.mjs` and
`src/services/news-viz.mjs`.

## 1. The definition, in graph terms

The unit of news is an entity-anchored novelty event. Exactly two shapes qualify:

- **A new-entity event.** A named individual the graph did not previously hold — a person, an
  organisation, a place, a dated occurrence — enters through a reported row (phase 10's band:
  fresh `news:`/`news-fixture:` provenance, not derived, not identity-shaped).
- **A fresh-assertion event.** A reported row states something new and specific about an
  individual the graph already holds. Specific means the assertion carries a digit run, a date,
  a quantity, or a novel co-term.

Everything else a poll brings in is background or derived, and the seed graph is prior knowledge
by definition. A class stays a class no matter how well connected it is.

### 1.1 What the store can actually see

`normFactTerm` destroys capitalisation at write time, so "proper noun" is not recoverable from
the stored string. The graph offers five signals instead. Each is a pure read over the fact set.

| signal | read | catches | false positives / negatives |
|---|---|---|---|
| prior-term absence | the term appears in no row whose provenance kind is `corpus`, `corpusWeak`, `reference`, `provider` or `teach` (`SOURCE_PRIOR` kinds, `src/domain/memory/trust.mjs`) | "nonthaburi", "rottnest", "debsirin" — anything the seed never mentions. The strongest novelty signal available | misses "apple" the business (the seed knows the fruit). Admits misspellings, which `readsAsEntityTerm` already filters |
| class object | the term is an object of `rdf:type`/`rdfs:subClassOf` anywhere (`conceptTerms`, shipped) | "earthquake", "drawer", "cars" — the seed's own taxonomy | none observed; a named individual is not a class object in this graph |
| lexicon miss | `isVocabGroundedTerm(lexicon, term)` is false — no everyday-noun reading | single-word names the lexicon lacks | misses every name that collides with a common word ("sydney", "green", "apple") |
| multi-word novelty | a two-plus-word term is absent from the prior-term set as a whole phrase, even when each word is lexicon-known | "kumamoto prefecture", "bang bua thong", "sydney green" | a fragment phrase — already bounded by `readsAsEntityTerm`'s six-word cap and leading-POS reject |
| anchor | the row's object carries a digit run, date or quantity (`hasQuantityMarker`, shipped), or a Wikidata Q-id landed for the term through the shipped enrichment short-circuit | "has a population of 1,683,115"; a P31-typed Q-id | a quantity about a class ("kilometre is 1000 metres") — blocked by the class-object test first |

The decision: **prior-term absence is the entity test, taken term-whole** (so multi-word novelty
is the same test, not a second one), **gated by the class-object and `readsAsEntityTerm` checks;
the anchor signals are the fresh-assertion test for prior-known terms.** The lexicon-miss signal
is advisory display metadata only (it can badge a hub "new name"), never a gate, because its
false-negative rate on real names is too high to sit in the path.

## 2. The two tests, precisely

For a candidate hub term `t` over fact rows `rows` with reported set `reported` (phase 10's
`reportedRows`):

**Test E (new entity).** All of:
1. some row in `reported` has `t` as subject or object;
2. `t` is not in `conceptTerms(rows)` and not `isQuantityTerm(t)`;
3. `readsAsEntityTerm(t, nlp)` passes;
4. `t` is not in `priorTerms(rows)` (section 3's new read).

**Test A (fresh assertion about a known entity).** All of:
1. some row in `reported` has `t` as subject;
2. `t` is not in `conceptTerms(rows)` and not `isQuantityTerm(t)`;
3. that reported row's object `hasQuantityMarker`, or is itself absent from `priorTerms(rows)`,
   or `t` carries a Q-id row from enrichment.

A hub heads a card when it passes E or A. There is no third path. `changedCount` keeps phase
10's meaning (reports, not lookups).

## 3. Killing the concept-card fallback

`buildFeed` (`src/services/news.mjs`) currently falls back to `assembleNewsItems` over the whole
seed graph when no gated item exists, which is where "purse" and "have fun" cards come from. The
fallback leaves the feed pane entirely:

- `buildFeed` returns `{ items: [], seedFallback: false, builtAt }` when nothing passes. The
  `seedFallback` field stays in the shape for one release so consumers do not break, always
  false, then retires.
- The page renders a designed empty state in the feed pane: a short line saying the feed only
  shows named things the graph just learned, and that polling fills it — "no news yet. the feed
  shows named people, places and events from polled sources — press poll once to fetch some." A
  seed-only graph shows this state, always.
- Concept-level knowledge keeps its two existing homes: the ranked-terms panel (ungrounded terms)
  and each card's collapsed "what the graph already knew" background line. `assembleNewsItems`
  retires from the feed path; its class/quantity filter moves into the ranked-terms panel's
  display so that panel also stops leading with bare classes.
- The chat lane already has an honest empty line ("no news items yet — poll a source or teach
  something first."); it keeps it.

## 4. Borderline cases, decided now

| case | verdict | via |
|---|---|---|
| a new individual mentioned once by one source | card, badged with its single source | test E; one reported row suffices — the feed reports, it does not corroborate |
| "kumamoto prefecture has a population of 1,683,115", place known to the seed | card | test A (quantity anchor) |
| "drawer" mentioned in a burglary story | never heads a card; may appear in the story's own entity card as background | class object blocks E and A |
| a named storm or quake ("ridgecrest quake", "hurricane erin") | card | test E (multi-word prior-term absence); "earthquake" the class stays blocked |
| "apple" the business | no card unless a reported row anchors it (digits, date, Q-id, novel co-term); otherwise it lands on the empty state | prior-term presence blocks E; A needs an anchor. A known miss, recorded in section 8 |
| "sydney green" the person | card | test E — the bigram is absent from prior terms even though both words are lexicon-known |

## 5. Phases

### N0 — the prior-term read (Sonnet)

`src/domain/news-feed.mjs` gains:

- `priorTerms(rows)` — a `Set` of every subject and object of rows whose
  `provenanceTagToSource(row.provenance)?.kind` is `corpus`, `corpusWeak`, `reference`,
  `provider` or `teach`. One pass, memoisable by the caller the way `buildTermAdjacency` already
  is.
- `isNovelTerm(term, prior)` — absence check, term-whole.

Tests in `test/domain/news-feed.test.mjs`: seed-provenance rows populate the set; news and
research rows never do; a multi-word term is read whole; the empty graph yields the empty set.

**Build marker.** Landed together with N1 (one rewrite of `newsworthyHubs` needed both reads in
place at once). `priorTerms` excludes a `news:`/`news-fixture:` row even when its own tag
resolves to the `corpus` `SOURCE_PRIOR` kind — `news-fixture:` scores there so a demo replay
never outranks a live claim (`memory/trust.mjs`), not because a fixture row is prior knowledge
for the very term it is reporting; without this a Kumamoto fixture replay poisons its own term
into `priorTerms` and can never pass test E. 5 new tests, 35 pre-existing unaffected.

### N1 — the two tests replace the anchor heuristic (Sonnet)

`newsworthyHubs` (`src/domain/news-feed.mjs`) is rewritten around section 2's tests E and A,
keeping its signature and its `limit`/`adjacency` options. `renderNewsParagraph` and
`splitCardRows` are untouched. `buildNewsItems` passes `priorTerms` down. The lexicon-miss badge
lands as `item.newName: boolean`, display-only.

Tests: each borderline row of section 4 becomes a unit test with a fixture-scale fact set; the
Q-id anchor path takes a stubbed enrichment row.

**Build marker.** Two adaptations the section 2 text did not anticipate, both delta from the
codebase moving under the plan: `readsAsEntityTerm` lives in `services/extract-facts.mjs`, and
domain never imports services, so a domain-local `looksLikeEntityTerm` covers the lexical half
(word-count cap, leading-fragment-word reject) — the same rule `readsAsEntityTerm` itself falls
back to with no wink engine wired in. `newsworthyHubs`/`buildNewsItems` also gained an optional
`readsAsEntityTerm` parameter so `buildFeed` (which already imports `extract-facts.mjs`) can
thread the real, wink-backed check through — a plain lexical check cannot tell a malformed
extraction's predicate remainder from a real name when both read as a grammatically plausible
noun phrase, and test A gained the same shape check test E already had, since a bad triple's
subject has nothing else in test A's own anchor to catch it. 8 new tests, 47 pre-existing
unaffected.

### N2 — the fallback leaves the feed (Sonnet)

`buildFeed` stops calling `assembleNewsItems`; the function's filter logic moves to the
ranked-terms display path; `news-viz.mjs` renders the section 3 empty state (a `#feedEmpty`
element, hidden whenever items exist). The `stats()` verb and feed pills are untouched by design;
pills render only from actual items, so they disappear with the cards.

Tests: `test/services/news-service.test.mjs` pins the empty-feed shape on a seed-only graph;
`test/services/news-viz.test.mjs` pins the empty-state markup and its disappearance after a
fixture poll.

**Build marker.** `assembleNewsItems`, `tierOfRows`, `collectItemSources` and their now-unused
imports removed with the fallback. Each item also gains `newName: boolean` (display-only,
computed in `buildFeed` rather than `buildNewsItems` — the domain layer has no lexicon either).
The ranked-terms filter landed as an exported `filterRankedTermEntries(rows, entries)`, threaded
through `news.mjs`'s chat-lane `renderRankText` (now async) and `news-browser-entry.mjs`'s
`session.rank()`, both over-fetching from the ledger and trimming after the filter so the display
count stays full. One downstream test outside this phase's file ownership needed a one-line
assertion update as a direct, intended consequence (`test/services/chat-news-command.test.mjs`'s
`/news` pin against a seed-only graph — the honest empty line replaces a seed concept card; no
`chat.mjs` source touched). 114/114 green across `news-service.test.mjs`, `news-viz.test.mjs`,
`news-browser-entry.test.mjs`, `chat-news-command.test.mjs` and `news-exports.test.mjs` combined.

### N3 — end-to-end pins on the operator's own examples (Sonnet)

`test-e2e/pages-news-feed.test.mjs` gains: on first paint with the seed graph and no poll, the
feed pane shows the empty state and zero cards (no card headed by "purse", "drawer", "cars",
"finding information" or "entertaining" — assert by absence of any `corpus`-tier card, not by
enumerating strings); after a route-mocked poll of "Kumamoto has a population of 1738000" the
Kumamoto item renders and no corpus-tier card joins it; a poll that fetches successfully but
reports nothing still yields the empty state, never a fallback. Sleep-then-evaluate waits,
`waitUntil: "load"`, seed copied into the snapshot, predicate routes — the standing Playwright
rules for this page.

**Build marker.** The whole file's pre-existing suite assumed the retired fallback (a card on
first paint, `seedFallback` flags on every assertion) and needed rewriting alongside the new
pin, not just an addition beside it. Three real bugs turned up writing it, all fixed (see N1's
own marker for the first):
- `news-viz.mjs`'s request-log table had no word-break, so a real polled URL row could push the
  page wider than a 320px viewport — invisible before because the retired fallback always had
  cards but never a request-log row before any narrow-viewport check ran. Fixed with
  `table-layout: fixed` and `overflow-wrap` on its cells.
- `#feedEmpty` starts un-hidden in the static markup before any JS runs, so checking its
  visibility as a "render finished" signal fires instantly, before the seed has even started
  fetching — a bug in this phase's own new code, not a regression. Fixed by reading
  `#feedCount`'s own text landing instead (empty until `paintFeed`'s first real write), in this
  file and in `scripts/gen-screenshots.mjs`'s own news ready check, which had the identical bug
  and would have captured a pre-seed blank marketing plate.
- `news-viz.mjs`'s empty-feed copy now reverts to its default text once a poll runs (start or
  poll once), rather than keeping "the articles are gone" indefinitely after a purge a later poll
  answered with nothing.

A named delta, not a bug: the recorded Wikimedia demo-replay fixture (`nyt-world.rss.xml`,
`wikimedia-featured.json`, section 4.1's shipped wire shapes) never carries a population-style
sentence — the "recorded Wikimedia fixture" language above describes a route-mocked live poll
this file already builds elsewhere for other tests (`routeWikimediaFeatured`'s own quokka
population fact), extended with a dedicated Kumamoto route rather than a change to the committed
fixture files. 8/8 e2e tests green (~256s, background run).

### N4 — measure and record (Haiku)

Run the recorded fixtures through the gate and record, in this file's build markers: candidates
per fixture, how many pass E, how many pass A, what fell to the empty state. Update the STATUS.md
news row when the numbers land. Publish the numbers as measured, whatever they are.

**Build marker.** Measured by replaying each shipped demo fixture (`test/fixtures/news/`, via
`replayFixture`, `news-fixture:` provenance) through the real ingest pipeline and the real seed
graph, one fixture per process (a shared `seedPayload` object across sibling sessions in one
process was found to leak session state between them — a diagnostic-script artifact, not a
product path, since the real page only ever opens one session per load).

| case | candidate terms | pass E | pass A | pass both | hubs (feed items) | feed empty? |
|---|--:|--:|--:|--:|--:|---|
| seed graph, no poll | 0 | 0 | 0 | 0 | 0 | yes |
| `wikimedia-featured.json` | 0 | 0 | 0 | 0 | 0 | yes |
| `nyt-world.rss.xml` | 6 | 4 | 2 | 1 | 5 | no |

`wikimedia-featured.json`'s own two sentences ("Ceasefire negotiations are talks aimed at
halting armed conflict between parties.", "A tariff is a tax imposed on imported goods and
services.") are both identity-only — background under `classifyNewsRow` regardless of the gate,
so `reported` is empty and nothing is even a candidate. This matches N3's own e2e pin for the
same fixture (`afterWikipedia.items` is `[]`).

`nyt-world.rss.xml`'s 5 hubs: `ceasefire terms`, `officials`, `talks` read as genuine entities
from its "Talks Resume Over Ceasefire Terms" item. `back to the link` and `normalizefeeditems`
are extraction of the fixture's OWN test-scaffolding sentence ("An item with no guid tag, so
normalizeFeedItems falls back to the link.") — this fixture's fourth item exists to test
`feed-normalize.mjs`'s guid-fallback path, not to read as real news prose, and the gate has no
way to distinguish meta-commentary about the parser from a report once both are grammatically
well-formed. Recorded as measured, not filtered: fixing it is an `extract-facts.mjs` or
fixture-content question, outside this phase's file ownership, and changing the fixture's own
content risks the guid-fallback test it exists for.

## 6. Concurrency

| phase | tier | serialized on |
|---|---|---|
| N0 | Sonnet | src/domain/news-feed.mjs |
| N1 | Sonnet | src/domain/news-feed.mjs (after N0) |
| N2 | Sonnet | src/services/news.mjs, news-viz.mjs (after N1, and after the in-flight news-controls work merges) |
| N3 | Sonnet | test-e2e/pages-news-feed.test.mjs (after N2) |
| N4 | Haiku | this file, STATUS.md (after N3) |

## 7. Acceptance

- `node --test test/domain/news-feed.test.mjs` — priorTerms, tests E and A, every section 4 row.
- `node --test test/services/news-service.test.mjs test/services/news-viz.test.mjs` — empty-feed
  shape and empty-state markup.
- `npm run test:fast`, then the e2e file standalone.
- On the built page with no poll: zero cards, the empty state, and the ranked-terms panel intact.
- After the recorded fixtures: the Kumamoto item renders; no card is headed by a class term.

## 8. The horizon

Recognising a named entity in lower-cased, normalised text with no gazetteer is an open problem.
The graph-term signals catch what the seed's own coverage lets them catch: a name the seed
already uses as a common word ("apple", "amazon") only surfaces when a report anchors it with a
digit, a date, a Q-id or a novel co-term. A miss lands on the empty state, never on a guess —
the feed's version of the honest miss. The literatures to draw on when this tier gets its own
design pass: named-entity recognition, wikification and entity linking (the Q-id short-circuit
is the first step of that road), and first-story detection from topic detection and tracking.
Section 4's "apple" row is the standing test case for whichever design lands.
