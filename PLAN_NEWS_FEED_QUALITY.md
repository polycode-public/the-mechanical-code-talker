# PLAN_NEWS_FEED_QUALITY.md — the news card, and the loop that gets it there

Status: LIVE — direction set by the operator, 2026-08-12. This doc is the target and
the working method. History lives in git and `reports/newsbench/`.

## 1. The product, in the operator's words

news.html, at the stage of optimising the output:

1. Public news articles are ingested.
2. We synthesise facts from the articles.
3. We enrich the graph using data from supplemental sources to define new terms, so
   that we can ground more facts from the articles — and the grounding enriches the
   article.

## 2. The target card

Hand-written against a real article from the 2026-08-12 fixtures; every sentence is
one the templates can genuinely build. This is the measuring stick.

> ### nigel farage
>
> **Nigel Farage forced a new election in Clacton.** Farage came under pressure over
> his finances. His main challenger is Count Binface, a novelty candidate.
>
> *what the graph already knew:* Nigel Farage is a British politician. He leads
> Reform UK. Clacton is a town in Essex, England. Clacton is a parliamentary
> constituency of the United Kingdom.
>
> **the report as filed:**
> > **How Nigel Farage Ended Up Running Against Count Binface in Clacton**
> > Nigel Farage forced a new election in his parliamentary seat after coming under
> > pressure over his finances. His main challenger is Count Binface, a novelty
> > candidate.
> > — NYT World News, 2026-08-12

Where each part comes from:

| part | source | step |
| --- | --- | --- |
| "Nigel Farage forced a new election in Clacton." | synthesised fact, place attached | 2 |
| "Farage came under pressure…" / "His main challenger is…" | further facts from the description's own sentences | 2 |
| "Nigel Farage is a British politician. He leads Reform UK." | reference lookup on the whole name **nigel farage** | 3 |
| "Clacton is a town in Essex…" | reference lookup on **clacton** | 3 |
| the report block | the article itself | 1 |

## 3. The gap today

The same article currently renders: hub "election", paragraph "nigel farage forces
election.", already-knew "none". Three things stand between today's card and the
target:

1. **Whole names never reach the lookups.** The enrichment queue holds single
   tokens — "nigel" and "farage" separately, "saudi" and "arabia" separately — and
   half a name misses. Entity names must survive intact from article to lookup, and
   the card's hub should be the entity, not the clause.
2. **Definitions must land in the card and re-ground the article.** A successful
   lookup's facts must appear under "what the graph already knew" and let more of
   the article's own sentences ground. This path exists (`enrichTopTerms` →
   `reprocessAfterGrounding`) and is unproven end to end.
3. **Extraction gets one sentence where the description holds three.** More of a
   report's own prose should become facts — closed-set widenings, shape by shape,
   never invented facts. An item with genuinely no claim stays out: the honest miss
   applies to news too.

## 4. The loop

Run, look, fix. One pass is minutes:

1. **Run**: one command polls the cached articles (5 most recent hacker-news + 5
   most recent nyt-world), synthesises, enriches through the reference lookups, and
   builds the cards. `scripts/news-bench/iterate.mjs --label=<x>` (fresh fixture
   capture included); the articles log (`reports/newsbench/<run>-articles.md`)
   records every card in full, plus what was admitted without a card and what was
   rejected where.
2. **Look**: the cards land in chat verbatim — including the worst one — beside the
   running scores. The scores that matter, per run: terms defined by enrichment,
   article facts grounded because of it, cards with real background, admission per
   source. Reports carry a provenance block (seed digest, fixture dates); matching
   digests make two runs comparable without re-running anything.
3. **Fix**: the first thing that blocks the target card, at its cause. Small fixes
   happen in the main thread; genuinely big parallel tracks go to sub-agents with
   disjoint files. As many parallel changes as have disjoint ownership.
4. Repeat immediately. The loop never waits — no after-runs (the next run scores
   everything merged since the last), CI and deploys are shipping, not gates.

Regression floors ride the test suite so a landed win can't silently unwind.

## 5. The working order

1. Run the loop once with enrichment live and read the output together — establish
   whether lookups on today's terms hit or miss.
2. Whole names to the lookups and entity-named hubs (§3.1).
3. Prove a definition lands in the card and re-grounds the article (§3.2).
4. Extraction widenings, shape by shape, as the article logs expose them (§3.3).
5. Bulk knowledge only on evidence: if live lookups prove too thin or slow per
   term, pre-load the same definitions at scale (the Wikidata dump route), with the
   row count and load cost printed before any spend is approved.
6. Ship when the cards read well locally; the live page is the human check, never
   the measurement.

## 6. Constraints

- No LLM in the product path, and none anywhere in this loop's measurement.
- Fixture captures keep the minimum the fetchers read, with origin and licence
  noted; never full article bodies.
- Every read-time resolver stays a pure function of the fact set; enrichment writes
  facts, never invents them — a lookup miss is a miss.
