# SKILL_REFRESH_STATUS.md — regenerate reports/STATUS.md from the committed benchmark reports

This skill resynthesizes `reports/STATUS.md`, the one-page capability summary, from whatever
`reports/BENCHMARK_*.md` and `reports/PAGE_WEIGHTS.md` reports are already committed. **It never
runs a benchmark itself.** If the reports are stale, that staleness is what the refreshed
STATUS.md must say, honestly, not paper over — running a sweep is a separate activity
(`SKILL_BENCHMARK_*.md` per axis) that this skill's own output should prompt, not silently
substitute for.

> **Invoke it by telling a session:** *"Follow `SKILL_REFRESH_STATUS.md`"*, or "refresh STATUS.md".

## When to run this

- A new or updated `reports/BENCHMARK_*.md` has landed (a fresh sweep, a re-measurement, a new
  axis).
- `reports/STATUS.md`'s own "measured tree" line has fallen materially behind
  `package.json`'s current `version` — real capability work has landed since the last sweep and
  a reader deserves to know the gap exists, even before anyone re-benchmarks.
- The operator asks for it directly.

## The refresh procedure

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
4. **Cite every row's source file by name.** STATUS.md's whole value is that a reader can go
   verify any claim — a row without a `reports/BENCHMARK_<AXIS>_<version>.md` pointer next to it
   is a defect in the refresh, not a stylistic choice.
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
7. **Write `reports/STATUS.md`**, matching its existing section order (measured-tree banner →
   at-a-glance table → gates ranked → site weight pointer → methodology pins → this refresh
   pointer) so a diff against the prior version shows only what actually changed.
8. **Commit** with the specific report filenames that motivated the refresh named in the message.
   Update `NEXT.md` in the same commit if the refresh closes or narrows an item.

## What NOT to do

- Don't touch any `reports/BENCHMARK_*.md` file itself — this skill only reads them.
- Don't backfill a number for an axis with no report. Say "not yet measured" and name the owning
  `SKILL_BENCHMARK_*.md` that would produce it, rather than leaving the axis out silently or
  guessing at a plausible-sounding figure.
- Don't silently advance the "measured tree" version to match `package.json`'s current version
  without a real new report backing every number that changes — that would make STATUS.md's own
  central promise (numbers you can go verify) false.
