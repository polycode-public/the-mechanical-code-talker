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
2. **Definitions land in the card and re-ground the article.** Proven end to end:
   a fetched definition anchors its term, the strict recognizer then accepts the
   article sentence naming it, and the pronoun carry grounds the sentence after
   it — the target card's own shape ("His main challenger is Count Binface").
   What blocked it was provenance, not the path: enrichment writes definitions
   under `research:`, which folds to source kind `referenceLive`, while the
   isa-anchor ladder counted only `corpus` and the taught tiers. So the path ran
   and could never change its own answer.
3. **Extraction gets one sentence where the description holds three.** More of a
   report's own prose should become facts — closed-set widenings, shape by shape,
   never invented facts. An item with genuinely no claim stays out: the honest miss
   applies to news too.

## 4. The loop

Run, look, fix. One pass is minutes:

1. **Run**: `node scripts/news-bench/capture-fixtures.mjs` for fresh articles when
   wanted, then `node scripts/news-bench/run-live-cycle.mjs` — poll the cached
   captures, synthesise, enrich through the LIVE reference lookups, build the
   cards, and print each one in the four-part form. (`iterate.mjs --label=<x>`
   remains the metrics/report lane; `ensure-bench-inputs.mjs --from <checkout>`
   builds a fresh worktree's seed and packs in seconds.)
2. **Look**: every card lands in chat verbatim and complete — no selection, the
   worst included — in the four-part form: OUR PARAGRAPH, FACTS LEARNED (the
   triples), RELATED FACTS ALREADY HELD (with each fact's source labeled), and
   ORIGINAL TEXT (headline, description, source, date). Beside them, the scores
   that matter: terms defined by enrichment, article facts grounded because of
   it, cards with real background, admission per source.
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
