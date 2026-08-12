# newsbench — 2026-08-12 (xl-postwave-noisyv2)

seed: xl. fixture dates: {"wikimedia-featured":"2026-08-12","hacker-news":"2026-08-12","usgs-quakes":"2026-08-12","nyt-world":"2026-08-12","wikinews-published":"2026-08-12"}. clock: 2026-08-12T12:00:00.000Z.

## Poll

fetched 5, new items 121, facts 77, derived 756, failures 0, evicted 0.

## 1. Admission rate

| source | admitted/offered | rate |
| --- | --: | --: |
| wikimedia-featured | 5/10 | 50.00% |
| hacker-news | 7/10 | 70.00% |
| usgs-quakes | 44/51 | 86.27% |
| nyt-world | 13/50 | 26.00% |
| wikinews-published | 0/0 | n/a |

aggregate: 69/121 (57.02%)

## 2. Grounded-term proportion

| source | articles | micro-average |
| --- | --: | --: |
| nyt-world | 45 | 15.17% |
| wikimedia-featured | 10 | 18.00% |
| hacker-news | 10 | 48.28% |
| usgs-quakes | 51 | 50.87% |

aggregate: 29.63% over 116 article(s)

## 3. De-dupe ratio

cards 53, admitted items 69, ratio 0.77. Second pass: 0 new item(s), 0 new card(s).

## 4. Entity preservation

26 gazetteer-anchored candidate(s) of 501 raw. Fact survival 38.46%, paragraph survival 30.77%.

## 5. Noisy-hub-relation rate

8/33 context line(s) noisy (24.24%), same-sense test. Closed-list reading: 3.03%.

## 6. Paragraph shape

53 card(s). sentences/card: min 1, max 3, mean 1.11. repeated-sentence rate 6.78%, "Around it" repeat rate 0.00%. headline 100.00%, link 100.00%, date 100.00%.

## 7. Ranked-term noise

1/20 noisy (5.00%).

## 8. Size

67 news fact row(s), 51118 bytes (0.97 rows/article, 740.84 bytes/article). Feed document 68104 bytes of a 358400 budget (19.00%).

## Reproduce

`node scripts/news-bench/run.mjs --seed xl`
