# newsbench articles — 2026-08-12 (it6-start)

| run label | seed | cards | admission | grounded-term | dedupe ratio | noisy-hub rate | repeated-sentence rate | ranked-term noise |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| it6-start | xl | 4 | 40.00% | 34.78% | 1 | n/a | 0.00% | 6.67% |

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
- grounded-term proportion: 2/4 (50.00%) over 1 article(s)
- sentences in the paragraph: 2
- noisy context lines: 0 (none)
- repeats another card's sentence: no
- repeats another card's "Around it": no
- headline present: yes, link present: yes, date present: yes, raw summary present: yes

### 3. valencia

**paragraph:** valencia captures picture.

**the report as filed:**

> **A Special U.S. Navy Squadron Photographed the Last Total Solar Eclipse in Spain in 1905**
>
> Three American warships were sent to Valencia to capture pictures of the sun’s corona with a high-definition camera that would cost over $34,000 in today’s money.
>
> — NYT World News, 2026-08-12

**what the graph already knew:** none

**sources:** A Special U.S. Navy Squadron Photographed the Last Total Solar Eclipse in Spain in 1905

**date:** 2026-08-12T19:08:08.000Z

**backing item(s):**
- nyt-world: "A Special U.S. Navy Squadron Photographed the Last Total Solar Eclipse in Spain in 1905" (news-item:0551230f16010ca7)

**scores:**
- grounded-term proportion: 2/5 (40.00%) over 1 article(s)
- sentences in the paragraph: 1
- noisy context lines: 0 (none)
- repeats another card's sentence: no
- repeats another card's "Around it": no
- headline present: yes, link present: yes, date present: yes, raw summary present: yes

### 4. hackernews

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
- grounded-term proportion: 4/8 (50.00%) over 2 article(s)
- sentences in the paragraph: 1
- noisy context lines: 0 (none)
- repeats another card's sentence: no
- repeats another card's "Around it": no
- headline present: yes, link present: yes, date present: yes, raw summary present: yes


## Admitted, no card minted

1 item(s) grounded a fact but never made it into a card.

| source | headline | facts |
| --- | --- | --: |
| hacker-news | "Your Key to Success Isn't More Luck or Hard Work" | 1 |

## Offered, never admitted

6 item(s) admitted zero facts.

### hacker-news

- "HTML over WebSockets: real-time SPAs with barely any JavaScript" — parsed; term(s) never grounded
- "Zed: Delta" — parsed; term(s) never grounded

### nyt-world

- "Here’s the latest." — no recognizable claim in the text
- "Live Updates: First Total Eclipse in Europe in Decades Turns Day to Night" — parsed; term(s) never grounded
- "As Europe Faces Heat Waves and Wildfires, Travelers Are Forced to Adapt" — parsed; term(s) never grounded
- "At Iceland’s eclipse festival, prayer for sea cucumbers and ‘generosity from the sky’" — no recognizable claim in the text

## Reproduce

`node scripts/news-bench/run.mjs --seed xl --label it6-start`
