# newsbench — 2026-08-12 (iterate-e2e-xl)

seed: xl. fixture dates: {"hacker-news":"2026-08-12","nyt-world":"2026-08-12"}. clock: 2026-08-12T12:00:00.000Z. sources: hacker-news, nyt-world. take: 5. double-ingest checked: false.

## Provenance

seed digest: dcd8b2bdf1a74c9a99babc8e790094af107dcb951874a17ad5d854a024b9c890 (61736 row(s)). git HEAD: 973e02a3abe8ca090d543a847fd82d573ac5dcac.

Two reports are directly comparable — same numbers meaningfully diffable, no re-run needed — exactly when their provenance blocks match on seed digest, fixture dates, sources and take. The code that produced them is free to differ; that's the point of a before/after pair. A lever's "before" is the previous committed after-report once the two provenance blocks line up on those four fields. When they don't, the newest committed report's own drift gets a one-line warning at run time instead of a silently incomparable pair.

## Poll

fetched 2, new items 10, facts 3, derived 12, failures 0, evicted 0.

## 1. Admission rate

| source | admitted/offered | rate |
| --- | --: | --: |
| hacker-news | 2/5 | 40.00% |
| nyt-world | 1/5 | 20.00% |

aggregate: 3/10 (30.00%)

## 2. Grounded-term proportion

| source | articles | micro-average |
| --- | --: | --: |
| nyt-world | 3 | 20.00% |
| hacker-news | 5 | 28.57% |

aggregate: 25.00% over 8 article(s)

## 3. De-dupe ratio

cards 3, admitted items 3, ratio 1. Second pass (not checked this run): n/a new item(s), n/a new card(s).

## 4. Entity preservation

2 gazetteer-anchored candidate(s) of 36 raw. Fact survival 0.00%, paragraph survival 0.00%.

## 5. Noisy-hub-relation rate

0/0 context line(s) noisy (n/a), same-sense test. Closed-list reading: n/a.

## 6. Paragraph shape

3 card(s). sentences/card: min 1, max 2, mean 1.67. repeated-sentence rate 0.00%, "Around it" repeat rate 0.00%. headline 100.00%, link 100.00%, date 100.00%.

## 7. Ranked-term noise

0/18 noisy (0.00%).

## 8. Size

3 news fact row(s), 2259 bytes (1 rows/article, 753 bytes/article). Feed document 6354 bytes of a 358400 budget (1.77%).

## Reproduce

`node scripts/news-bench/run.mjs --seed xl`
