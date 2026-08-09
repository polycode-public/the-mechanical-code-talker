# NEWS_RIG — the first measured run over the committed fixtures

## What this measures

The five shipped contemporary source fixtures (Wikimedia featured, Hacker News, USGS
earthquakes, NYT World, Wikinews) and four of the five shipped knowledge-base fixtures
(Simple English Wikipedia, Wikidata, Wiktionary, DBpedia Lookup — English Wikipedia carries
no enrichment wiring of its own, section 10.2's `KB_SOURCE_TO_RESEARCH_CHOICE` table) run
through the real service loop — poll, ingest, rank, enrich, reprocess, build — against a
freshly seeded standard `tmct init` store. Every fetch answers from a committed file in
`test/fixtures/news/`; nothing reaches the network. Given the fixed clock this rig runs
against, the same facts land and the same numbers print on every run.

The four knowledge-base fixtures are each keyed to the term "heart", a phase 2 unit-test
fixture never chained to the contemporary fixtures' own vocabulary (ceasefire, tariff, an
earthquake place name, a Show HN title). So this run's enrichment round measures exactly
what it can: none of the contemporary run's pending terms happen to be "heart", so every
enrichment attempt this round reads as an honest miss and enters the negative cache — the
same shape a real KB source finding nothing reads as. The rig still exercises every wired
adapter's real request shape end to end; it just does not, on this particular fixture set,
land a KB grounding hit.

## Headline: grounding rate

| tier | rate | of 21 sentences |
| --- | --: | --- |
| strict | 42.86% | 9 recognized |
| optimistic | 52.38% | 11 recognized + optimistic |

Compare against L1's prose-band claim (`results/claims/prose-band.json`): 18.65% strict on
unedited Simple English Wikipedia sentences. This run measures higher than that, not lower —
the opposite of what PLAN_NEWS_FEED.md section 16 predicted before this rig existed to check
it. The reason is the fixture set itself: phase 0's own text says these five contemporary
fixtures are "authored samples matching each format's real field shapes rather than trims of
the recorded probe output" (the probe bodies were not on disk in the worktree that built that
phase), and the samples an author writes lean toward clean copula sentences ("A tariff is a
tax imposed on imported goods and services.") that the strict recognizer reads well. Live news
prose, once a real feed is polled, carries denser proper names and one-off phrasing that this
particular committed set does not exercise — so this number characterizes the shipped fixture
set, not a claim about raw contemporary prose in general. Either way, the page is designed to
stay useful however the number lands: the feed shows facts-with-sources rather than article
summaries, and the ranked ungrounded-terms panel turns every miss into the visible work queue.

## Per-source breakdown

| source | sentences | strict | optimistic | facts added | derived |
| --- | --: | --: | --: | --: | --: |
| wikimedia-featured | 4 | 0.00% | 25.00% | 1 | 0 |
| hacker-news | 3 | 33.33% | 33.33% | 1 | 0 |
| usgs-quakes | 4 | 0.00% | 0.00% | 0 | 0 |
| nyt-world | 8 | 75.00% | 87.50% | 7 | 2 |
| wikinews-published | 2 | 100.00% | 100.00% | 2 | 0 |

Poll totals: 5 sources fetched, 13 new items,
11 facts stored, 2 syllogisms derived,
0 failures, 0 evicted.

## Enrichment round

enriched: none this round
missed (negative-cached): km, ceasefire, earthquake, alaska, announcement, guid, hn, item
Facts from enrichment: 0. Syllogisms derived: 0.

## Ledger after this run

Top fact-ungrounded terms still pending:

| term | mentions | status |
| --- | --: | --- |
| kodiak | 2 | unknown word |
| m | 2 | unknown word |
| magnitude | 2 | unknown word |
| ne | 2 | unknown word |
| negotiations | 2 | unknown word |
| ridgecrest | 2 | unknown word |
| ssw | 2 | unknown word |
| tag | 2 | parseable but knowledge-free |
| casualty | 1 | parseable but knowledge-free |
| conflict | 1 | parseable but knowledge-free |

Terms the enrichment round tried and missed (negative-cached):

| term | mentions |
| --- | --: |
| km | 4 |
| ceasefire | 3 |
| earthquake | 3 |
| alaska | 2 |
| announcement | 2 |
| guid | 2 |
| hn | 2 |
| item | 2 |

## Feed

4 item(s) built.

## Metrics 5 and 6: page-only

Time-to-first-article and time-to-first-complete-poll are both page metrics (navigation start
to a real DOM paint), not something a Node-side replay measures. `test-e2e/pages-news-feed
.test.mjs`'s responsiveness contract covers them against the live page.

## Reproduce

`node scripts/news-rig.mjs`
