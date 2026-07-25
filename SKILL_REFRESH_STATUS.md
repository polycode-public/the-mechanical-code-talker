# SKILL_REFRESH_STATUS.md — regenerate STATUS.md from the committed reports and the latest CI run

This skill resynthesizes `STATUS.md` (repo root), the one-page capability summary, from whatever
`reports/BENCHMARK_*.md` and `reports/PAGE_WEIGHTS.md` reports are already committed, plus the
most recent CI pipeline result on `main`. **It never runs a benchmark itself, and never triggers
a pipeline.** If the reports are stale, that staleness is what the refreshed STATUS.md must say,
honestly, not paper over — running a sweep is a separate activity (`SKILL_BENCHMARK_*.md` per
axis) that this skill's own output should prompt, not silently substitute for.

STATUS.md lives at the repo root, not inside `reports/` — it's the front door that points into
that directory, not one of the reports itself.

> **Invoke it by telling a session:** *"Follow `SKILL_REFRESH_STATUS.md`"*, or "refresh STATUS.md".

## When to run this

- A new or updated `reports/BENCHMARK_*.md` has landed (a fresh sweep, a re-measurement, a new
  axis).
- A new pipeline has resolved on `main` since STATUS.md's own cited pipeline ID.
- STATUS.md's "measured tree" line has fallen materially behind `package.json`'s current
  `version` — real capability work has landed since the last sweep and a reader deserves to know
  the gap exists, even before anyone re-benchmarks.
- The operator asks for it directly.

## Part 1 — the benchmark summary

1. **Enumerate the reports, don't hardcode the axis list.** `ls reports/BENCHMARK_*.md` (or
   equivalent) — whatever exists today is the whole input set. An axis added or retired since
   this skill was last run changes what gets enumerated, not this file.
2. **Read `reports/BENCHMARK_SUMMARY_*.md` first, if one exists.** A summary report is already a
   synthesis pass over the individual axis reports — prefer its cross-axis table as the primary
   source rather than re-deriving every number from nine files independently. Spot-check two or
   three individual reports against the summary's claims for consistency before trusting it
   wholesale.
3. **For any axis with no summary entry** (a report exists but predates the summary, or there is
   no summary at all), read that report's own headline section directly: result, comparison to
   its prior baseline if stated, and its current gate/ceiling. Extract only what the report
   states — never estimate, round favorably, or infer a number the report doesn't contain.
4. **Cite every row's source file by name**, e.g. `reports/BENCHMARK_<AXIS>_<version>.md`.
   STATUS.md's whole value is that a reader can go verify any claim — a row without a source
   pointer next to it is a defect in the refresh, not a stylistic choice.
5. **Stamp the measured-tree version honestly.** Pull it from the newest report's own stated
   measurement version (usually named in the filename or the report's opening lines), not from
   `package.json`'s current version — those two numbers are allowed to differ, and the gap
   between them is exactly what the banner at the top of STATUS.md exists to say. Name
   concretely what has landed since the measured tree, in one or two sentences, drawn from
   `NEXT.md`'s recent history or `git log` — not a vague "things have changed."
6. **Carry forward the gates-ranked-by-leverage list** from the summary if one exists (or compose
   one from each axis's stated gate/ceiling if not), and the site-weight pointer to
   `reports/PAGE_WEIGHTS.md` (a one-line pointer, not a duplicated table — that table has its own
   skill and its own version stamp; see `SKILL_PAGE_WEIGHTS.md`).

## Part 2 — the last CI pipeline

7. **Fetch the most recent pipeline on `main`**: `glab ci status --branch=main --compact` for a
   quick read, or `glab ci get --branch=main --output json` for the pipeline id/sha/timestamps,
   then `glab api "projects/<url-encoded-path>/pipelines/<id>/jobs?per_page=100"` for the full
   job list with per-job status and duration — the default page size silently truncates a
   27-job pipeline to 20, so always pass `per_page=100` or paginate.
8. **Report only a pipeline that actually finished** (`status: success` or a named failure), not
   one still running — if the latest is mid-flight, use the one before it and say so.
9. **Map every job to what it exercises at the consumer surface**, not just pass/fail. A job name
   alone doesn't tell a reader what got tested — say what page, CLI surface, or shipped artifact
   it covers. Group jobs sensibly (e.g. all `e2e-web-*` rows, then CLI/TUI, then package/deploy
   hygiene, then repo hygiene) rather than dumping the raw job list. If the CI config's job set
   has changed since this skill was last run (a channel added/split/removed), read
   `.gitlab-ci.yml` fresh rather than reusing a stale mapping from the last refresh.
10. **State the real numbers**: job count, pass count, wall-clock (pipeline `created_at` to
    `updated_at`, not the sum of job durations — jobs run in parallel), and the longest single
    job if it's a meaningful fraction of the wall-clock. Note any job that didn't run (gated on
    paths this push didn't touch, or schedule-only) rather than omitting it silently.
11. **If the pipeline had failures**, report them honestly — which jobs, and (if known) why —
    rather than only ever reporting a green run. STATUS.md's job is to say what's true, not to
    look reassuring.

## Part 3 — the design docs

12. **Enumerate `PLAN_*.md` at the repo root fresh each run** — `ls PLAN_*.md`, never a hardcoded
    list. A plan that ships fully retires to `archive/` (it stops being a root `PLAN_*.md`) and a
    new one can appear; both change what this table covers automatically.
13. **Read each plan's own opening status line first** — this project's convention is that every
    `PLAN_*.md` states its status in its opening lines. That's usually enough for the goal and
    delivered/remaining split; read further only when the status line doesn't already say what's
    shipped vs proposed vs design-only.
14. **Classify every remaining piece into exactly one of two buckets, never a third "impossible"
    bucket:**
    - **Design horizon** — an approach is known or straightforward to work out; what's missing is
      time, not a solved problem. Most `PROPOSED`/`DESIGN`-status items are this.
    - **Research horizon** — the plan itself names an open problem with no settled engineering
      yet (e.g. `PLAN_SYLLOGIST_EL_DL.md`'s tableau-reasoning-plus-trust-guards combination, which
      the doc says the literature is silent on). Only classify something here if the plan's own
      text supports it — don't invent a research gap the doc doesn't name, and don't downgrade a
      real one to "just needs engineering" either.
    Per this project's own `CLAUDE.md` discipline: name the open problem plainly, never claim it
    is permanently unreachable — a research horizon is where the literature currently ends, not a
    wall.
15. **One table row per plan**, columns: plan, goal (one line), delivered, design horizon,
    research horizon (`—` if none). Cite nothing beyond what each plan's own text supports.

## Part 4 — write and ship

16. **Write `STATUS.md`** at the repo root, matching its existing section order (measured-tree
    banner → CI pipeline section → at-a-glance axis table → gates ranked → design docs table →
    site weight pointer → methodology pins → this refresh pointer) so a diff against the prior
    version shows only what actually changed.
17. **Commit** with the specific report filenames, pipeline ID, and/or plan docs that motivated
    the refresh named in the message. Update `NEXT.md` in the same commit if the refresh closes
    or narrows an item.

## What NOT to do

- Don't touch any `reports/BENCHMARK_*.md` file itself — this skill only reads them.
- Don't backfill a number for an axis with no report. Say "not yet measured" and name the owning
  `SKILL_BENCHMARK_*.md` that would produce it, rather than leaving the axis out silently or
  guessing at a plausible-sounding figure.
- Don't silently advance the "measured tree" version to match `package.json`'s current version
  without a real new report backing every number that changes — that would make STATUS.md's own
  central promise (numbers you can go verify) false.
- Don't trigger a new pipeline run to get fresher CI data — report the latest one that already
  ran, honestly dated.
- Don't touch any `PLAN_*.md` file itself — this skill only reads them and summarizes.
- Don't classify a design doc's remainder as "research horizon" unless the plan's own text names
  a real open problem; don't call a genuine open problem "just needs engineering" either. Both
  directions misrepresent what's actually left.
