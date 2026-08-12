# PLAN_NEWS_FEED_QUALITY.md — a local bench for the news feed, and the loop that iterates on it

Status: DESIGN, with N0 in build — decided by the operator on 2026-08-12. The feed's basic
mechanics shipped in `PLAN_MEMORY_ROLLOUT.md` (Status: BUILT); this plan owns feed QUALITY:
richer paraphrased paragraphs alongside the raw article, a de-duped feed, and a mechanical
way to measure every step of that without touching prod.

## 1. Where quality stands (live page, 2026-08-12, 6.0.15)

The chain works: real items admit facts, cards mint with grounded paragraphs. The visible
gaps, each of which becomes a metric below:

- Context lines dump abstract WordNet hypernyms: "earthquake is a kind of cognition /
  disapproval / tune / line" — sense pollution, not knowledge about this quake.
- The ranked-terms panel is full of unit and abbreviation noise: "km", "m", "ssw", "de",
  "u.s." — the function-word gate does not cover them.
- A hub can lose its name: the "public investments fund" card is keyed and titled "public".
- Sibling cards repeat each other: every quake card's "Around it" cites the same three
  other quakes.
- The raw article (headline, source link, publication date) is not shown beside the
  graph's own sentences.
- Nothing yet guarantees one card per newsworthy item: a re-poll or a second reading of
  the same source article must not mint a second card.

## 2. The harness (N0): frozen feeds, one command, deterministic numbers

Iterating against prod costs a push, a pipeline, and a button press per data point. The
bench moves the whole loop local:

- **Fixture capture** — `scripts/news-bench/capture-fixtures.mjs` downloads each live
  source's real payload (wikimedia-featured, hacker-news, usgs-quakes, nyt-world,
  wikinews-published) into `test/fixtures/news-feeds/<source>/<yyyy-mm-dd>.json`, dated
  and append-only, with a NOTICE recording origin and license. Snippets stay minimal:
  titles, summaries/extracts, ids, timestamps — what the fetchers actually read, nothing
  more.
- **The bench runner** — `scripts/news-bench/run.mjs` drives the worker-shaped path
  (fetcher parsing → `pollNewsSources` → ingest → `buildFeed`) over the fixtures and the
  committed xl seed, fully offline: stub transport, injected clock, in-memory row
  backend. It emits `reports/newsbench/<yyyy-mm-dd>-<label>.json` (every metric, per
  source and aggregate) plus a small markdown summary beside it. Same fixtures + same
  seed → same numbers, byte for byte.
- **npm scripts** — `bench:news` (xl seed, the real measurement) and `bench:news:fast`
  (fixture-scale seed, seconds, for inner-loop sanity).
- **A smoke test** — one unit-test file wraps the fast runner and asserts the metric
  floors of §5. It rides the normal unit tier so a regression cannot land silently.

## 3. The metrics (all mechanical, no LLM anywhere in the loop)

Each is computable from the runner's own artifacts. Definitions are part of N0; the
baseline run fixes the starting numbers before any lever is pulled.

1. **Admission rate** — items admitting ≥1 fact ÷ items offered, per source. (Hand-measured
   once at 44/47 usgs, 10/20 hn, 13/13 wikimedia; the bench pins this permanently.)
2. **Grounded-term proportion** — per article: extracted terms that ground in the graph ÷
   extracted terms. Reported per source with a distribution, not just a mean.
3. **De-dupe ratio** — cards ÷ distinct newsworthy items, and the duplicate-card count
   when the same fixture is ingested twice in a row (target: second pass mints zero new
   cards). Distinct-item identity comes from the source's own id where it has one
   (HN story id, USGS event id) and a normalized content key where it does not.
4. **Entity preservation** — dates, place names, and person names present in the fixture
   item that survive into stored facts and into the rendered card. Detection is a closed
   mechanical extractor (date patterns; capitalized-sequence heuristic checked against
   the seed's own gazetteer of places/people), so it is consistent run over run — deltas
   are meaningful even where absolute recall is imperfect.
5. **Noisy-hub-relation rate** — context lines drawn from a closed list of abstract
   classes (cognition, abstraction, feeling, relation, act, happening, group, line, tune,
   arrangement, …) ÷ context lines shown. The "earthquake is a kind of cognition" class
   of line. Target: driven toward zero without emptying the panel — informative
   same-sense relations stay.
6. **Paragraph shape** — sentences per card paragraph (bounds), repeated-sentence rate
   across one feed's cards (the "same three quakes" problem), and presence of the raw
   headline + source link + item date alongside the paraphrase.
7. **Ranked-term noise** — unit/abbreviation/function entries ("km", "m", "ssw", "de",
   "u.s.") ÷ ranked list length. Target ~0; the closed noise set lives with the
   function-word set already gating the ledger.
8. **Size** — stored rows and bytes per article, and the materialized feed document's
   size against `MAX_FEED_DOCUMENT_BYTES`.

## 4. The loop: poll, measure, share, design, apply, repeat

One iteration is:

1. **Poll + measure + share, one command**: `node scripts/news-bench/iterate.mjs
   --label=<iteration>` captures today's fixtures, runs the bench, and prints the
   score-table delta against the newest committed report. The default measurement is
   press-equivalent and fast: the 5 most recent hacker-news items plus the 5 most
   recent nyt-world items, single pass, xl seed — about a minute. The full
   all-sources sweep runs periodically behind its own flag, not every iteration.
   The coordinator pastes the results in chat as they land: sample cards quoted
   verbatim and complete from the articles log (including the worst-scoring one),
   plus the full score table against the prior iteration.
2. **Design**: the coordinator reads the worst number and names ONE lever —
   closed-set/template changes preferred, per the project's own bias. The proposal
   names the metric it should move and any metric it might hurt.
3. **Apply**: the lever lands (worktree sub-agent, blast-radius tests), one after-run
   measures it, and the report pair goes in the commit message's account.
4. **Ratchet**: a landed improvement raises the smoke test's floor for that metric to
   just under the new number, so the gain is locked in.
5. **Repeat immediately.**

The loop never waits. The next iteration's lever dispatches as soon as the previous
lever is merged and its report pair is committed — CI pipelines and deploys are
shipping, not gates, and a measurement correction runs beside the loop, not in
front of it. The live page stays the human check after each deploy batch, never the
measurement.

### Cycle-time budget

The loop's target is a 30–40 minute iteration. Where the first day's ~60-minute
iterations actually spent their time, and what removes each sink:

| sink | cost | removal |
| --- | --: | --- |
| a "before" xl re-run per lever agent | 12–15 min | dead: the previous iteration's committed after-report IS the before, verified by seed-digest equality, not by re-running |
| per-worktree artifact rebuild (worlds pack, sprite facts, ask bundle, chat-seed) | 3–6 min | `scripts/news-bench/ensure-bench-inputs.mjs` builds only what is missing or stale, and `--from <path>` links a sibling checkout's already-built artifacts in seconds |
| coordinator-invented waits between iterations | unbounded | banned above |
| the one xl bench run | 12–15 min | stays — it drives the full engine over the whole seed; this is the measurement itself |
| the lever agent's design/code/tests | 15–35 min | stays — this is the work |

### Report comparability: digests, not re-runs

Every report carries a `provenance` block: the sha256 and row count of the chat-seed
actually loaded, the fixture dates, and the git HEAD of the run. Two reports are
directly comparable when their seed digests and fixture dates match. A run whose
digest differs from the newest committed report's prints a drift warning naming the
mismatch — the seed-drift case that used to force re-runs now names itself instead
of silently producing an incomparable pair. A lever that needs fresh fixtures
captures them at its own iteration's start, so its pair is captured-together by
construction.

### Bench operational rules

- Run labels are `--label=<x>` (the space form is silently ignored) and must be
  distinct per run — same-day runs collide on the report filename otherwise.
- The articles log (`<run>-articles.md`) is a standard artifact of every run: every
  card in full, its per-card scores, the admitted-but-cardless items, and the
  rejected items per source.

## 5. Phases

- **N0 — harness + fixtures + baseline.** Capture script, runner, metrics, npm scripts,
  smoke test with floors set from the baseline run's actual numbers. In build now.
- **N1 — de-dupe.** One card per newsworthy item: source-id/content-key identity,
  stable across re-polls and re-readings; the double-ingest metric goes to zero and its
  floor locks.
- **N2 — context quality.** Abstract-hypernym suppression in card context lines;
  sibling-card repetition down; the noisy-hub-relation rate and repeated-sentence rate
  both move.
- **N3 — entity preservation.** Dates, places, and people survive into facts and
  paragraphs; full hub names ("public investments fund", never "public"); the
  unit/abbreviation set joins the ledger gate so "km" never ranks again.
- **N4 — richer paragraphs.** Template paraphrase of the admitted facts alongside the
  raw headline, link, and date — the card reads as an article, not a fact dump.
- **N5 — floors into CI.** The ratcheted floors ride the fast tier permanently; a page
  e2e pins raw-article presence and de-dupe at the rendered surface.

## 6. Constraints

- No LLM in the product path, and none in this loop's gate either — every metric above
  is deterministic. (An LLM-judge lane may exist offline as a supplementary read on
  paraphrase quality, the same place the chat tuning cycle keeps it, but it never
  decides a floor.)
- Fixture licensing: captures keep the minimum the fetchers read, carry a NOTICE with
  origin and license per source, and never commit full article bodies.
- Resolver purity holds throughout: the bench feeds facts in fixed order, and any
  identity/de-dupe key must be a pure function of the fact set.
