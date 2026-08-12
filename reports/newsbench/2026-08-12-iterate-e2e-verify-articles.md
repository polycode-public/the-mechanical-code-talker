# newsbench articles — 2026-08-12 (iterate-e2e-verify)

| run label | seed | cards | admission | grounded-term | dedupe ratio | noisy-hub rate | repeated-sentence rate | ranked-term noise |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| iterate-e2e-verify | fixture | 3 | 30.00% | 9.09% | 1 | n/a | 0.00% | 0.00% |

## Cards

### 1. "deepseek v4 pro 0813"

**paragraph:** hackernews discuss "deepseek v4 pro 0813". Around it: hackernews discuss "glaciers on the climate dashboard".

**the report as filed:**

> **DeepSeek V4 Pro 0813**
>
> Hackernews discusses "DeepSeek V4 Pro 0813".
>
> — Hacker News, 2026-08-12

**what the graph already knew:** none

**sources:** DeepSeek V4 Pro 0813

**date:** 2026-08-12T16:04:50.000Z

**backing item(s):**
- hacker-news: "DeepSeek V4 Pro 0813" (news-item:f7addb0ed53c0afb)

**scores:**
- grounded-term proportion: 2/4 (50.00%) over 1 article(s)
- sentences in the paragraph: 2
- noisy context lines: 0 (none)
- repeats another card's sentence: no
- repeats another card's "Around it": no
- headline present: yes, link present: yes, date present: yes, raw summary present: yes

### 2. "glaciers on the climate dashboard"

**paragraph:** hackernews discuss "glaciers on the climate dashboard". Around it: hackernews discuss "deepseek v4 pro 0813".

**the report as filed:**

> **Glaciers on the Climate Dashboard**
>
> Hackernews discusses "Glaciers on the Climate Dashboard".
>
> — Hacker News, 2026-08-12

**what the graph already knew:** none

**sources:** Glaciers on the Climate Dashboard

**date:** 2026-08-12T16:38:25.000Z

**backing item(s):**
- hacker-news: "Glaciers on the Climate Dashboard" (news-item:e8fbd032bb504532)

**scores:**
- grounded-term proportion: 2/5 (40.00%) over 1 article(s)
- sentences in the paragraph: 2
- noisy context lines: 0 (none)
- repeats another card's sentence: no
- repeats another card's "Around it": no
- headline present: yes, link present: yes, date present: yes, raw summary present: yes

### 3. hackernews

**paragraph:** hackernews discuss "deepseek v4 pro 0813" and "glaciers on the climate dashboard".

**the report as filed:**

> **DeepSeek V4 Pro 0813**
>
> Hackernews discusses "DeepSeek V4 Pro 0813".
>
> — Hacker News, 2026-08-12

> **Glaciers on the Climate Dashboard**
>
> Hackernews discusses "Glaciers on the Climate Dashboard".
>
> — Hacker News, 2026-08-12

**what the graph already knew:** none

**sources:** DeepSeek V4 Pro 0813, Glaciers on the Climate Dashboard

**date:** 2026-08-12T16:38:25.000Z

**backing item(s):**
- hacker-news: "Glaciers on the Climate Dashboard" (news-item:e8fbd032bb504532)
- hacker-news: "DeepSeek V4 Pro 0813" (news-item:f7addb0ed53c0afb)

**scores:**
- grounded-term proportion: 4/9 (44.44%) over 2 article(s)
- sentences in the paragraph: 1
- noisy context lines: 0 (none)
- repeats another card's sentence: no
- repeats another card's "Around it": no
- headline present: yes, link present: yes, date present: yes, raw summary present: yes


## Admitted, no card minted

1 item(s) grounded a fact but never made it into a card.

| source | headline | facts |
| --- | --- | --: |
| nyt-world | "More Than 40 Dead After a Ferry Capsizes on Zimbabwe’s Lake Kariba" | 1 |

## Offered, never admitted

7 item(s) admitted zero facts.

### hacker-news

- "Reflex (YC W23) Is hiring Growth and GTM Roles" — parsed; term(s) never grounded
- "HTML over WebSockets: real-time SPAs with barely any JavaScript" — parsed; term(s) never grounded
- "Zed: Delta" — parsed; term(s) never grounded

### nyt-world

- "Eclipse chasers stake out their viewing spots in Iceland." — parsed; term(s) never grounded
- "Here’s the latest." — parsed; term(s) never grounded
- "Live Updates: First Total Eclipse in Decades Turns Day to Night in Europe" — parsed; term(s) never grounded
- "As Europe Faces Heat Waves and Wildfires, Travelers Are Forced to Adapt" — parsed; term(s) never grounded

## Reproduce

`node scripts/news-bench/run.mjs --seed fixture --label iterate-e2e-verify`
