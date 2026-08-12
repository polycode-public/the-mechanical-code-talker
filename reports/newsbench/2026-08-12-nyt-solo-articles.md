# newsbench articles — 2026-08-12 (nyt-solo)

| run label | seed | cards | admission | grounded-term | dedupe ratio | noisy-hub rate | repeated-sentence rate | ranked-term noise |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| nyt-solo | xl | 0 | 20.00% | 20.00% | 0 | n/a | n/a | 0.00% |

## Cards



## Admitted, no card minted

1 item(s) grounded a fact but never made it into a card.

| source | headline | facts |
| --- | --- | --: |
| nyt-world | "More Than 40 Dead After a Ferry Capsizes on Zimbabwe’s Lake Kariba" | 1 |

## Offered, never admitted

4 item(s) admitted zero facts.

### nyt-world

- "Eclipse chasers stake out their viewing spots in Iceland." — no recognizable claim in the text
- "Here’s the latest." — no recognizable claim in the text
- "Live Updates: First Total Eclipse in Decades Turns Day to Night in Europe" — parsed; term(s) never grounded
- "As Europe Faces Heat Waves and Wildfires, Travelers Are Forced to Adapt" — parsed; term(s) never grounded

## Reproduce

`node scripts/news-bench/run.mjs --seed xl --label nyt-solo`
