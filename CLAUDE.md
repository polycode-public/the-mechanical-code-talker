# CLAUDE.md — project guidance for Claude Code sessions

## Explicit versioning/commit/push instructions are not up for debate

If the operator's prompt states explicitly when to bump the version, commit, or push
(e.g. "roll the version every round", "commit and push each turn"), execute it exactly
as stated. Do not pause to ask a clarifying question about cadence, do not weigh it
against this document's general conventions (including the version-bump-timing
paragraph below), and do not apply your own judgment to override it. The operator's
explicit instruction in the prompt is authoritative over any general policy written
here or anywhere else in this repo. Only stop if following the instruction would
violate a hard safety rule (e.g. leaking a secret) — otherwise, just do it. Getting
this wrong burns hours of the operator's time for nothing; see
[[feedback_follow_explicit_versioning_instructions]] in memory.

## Working model: coordinator + background sub-agents

Run big tasks in **concurrent background sub-agents** and keep the main chat free — the main
session is the COORDINATOR (plans, launches, integrates, answers the operator), not the worker.

- Decompose into workstreams with **clear file-ownership boundaries**; serialize on shared
  files (one agent owns `package.json`, `src/`, `bin/`, `test/` sequences; docs/site tracks
  run in parallel).
- **Keep the chat for chat**: anything long-running (benchmarks, judge passes, builds, test
  sweeps) executes as a BACKGROUND task at maximum safe concurrency (the chatbench judge
  defaults to `--concurrency 12`); the main session launches it, keeps coordinating and
  conversing, and collects results on the completion notification. Never block the
  conversation on a run.
- Commit per completed step with the repo-local identity (`antony@polycode.co.uk` /
  `Antony at Polycode`); keep `npm test` green at every commit.
- Push/publish is gated on the operator (CI publishes on version bump on `main`).
- **Version bump timing:** only bump the version (`package.json` + `package-lock.json`) at the
  moment of actually pushing a release — the bump commit is part of that same push, not a
  separate step staged in advance. Default to a patch bump unless the batch is clearly
  feature-level (minor) or breaking (major). Do NOT pre-stage a future version number and leave
  it sitting unpushed in git between releases — that produced confusing "linking to a version
  that doesn't exist yet" noise in practice and was reverted by operator instruction 2026-07-09.
  Between pushes, `package.json`'s version should always equal whatever's actually live on npm.

## Never pipe a long-running command straight into `tail`

Piping a test run or any long command straight into `tail -N` (`cmd 2>&1 | tail -20`) discards
everything before the last N lines permanently — if the summary you need turns out to be earlier
in the output, or you need the full log after the fact, it's gone and the whole command has to
re-run. Always tee it to a file first: `cmd 2>&1 | tee /tmp/some-file.log | tail -20`. You still
get the quick glance, but the full output is on disk if you need more of it.

**Why:** happened directly (2026-07-14, tmct session) — `npm test 2>&1 | tail -20` on a large
suite cut off before the pass/fail summary, and the only way to see the real failure count was to
re-run the entire suite from scratch.

## Name it, don't comment it

Prefer a self-documenting name over a comment that compensates for a vague one. Good:
`renderImagePixels(player) {...}` — the name carries the meaning. Bad:
`/* this renders an image as pixels for the player */ draw(obj) {...}` — a vague name propped
up by a comment explaining what it actually does. When you find the second pattern, rename
first, then drop the comment — don't just delete the comment and leave the bad name behind.
A rename that's local (private, few in-file call sites) is safe to do inline. A rename of an
exported/widely-used identifier is a bigger, separate change — flag it rather than doing a
drive-by rename across many files under time pressure.

## Comment and test-name hygiene

Comments and test descriptions must never reference a PLAN/HANDOVER doc, a "Gap N"/"BUG N"/
"Phase N item N" label, a commit hash, an operator directive, or a date ("live-tested
2026-07-09"). That framing belongs in the commit message or PR description, not the file — it
rots the moment the doc it points to is archived, renamed, or deleted, and it accumulates into
exactly the kind of stale, self-referential clutter that has to get purged wholesale later. This
applies on top of the general no-comments default above, not instead of it: even a comment that
skips the doc-reference trap still shouldn't exist unless it explains a genuinely non-obvious WHY.

Test names must describe the behavior/outcome under test on their own terms — "resolves a 2-hop
alias chase through a taught subClassOf fact", not "HANDOVER item 2 regression: ...". A test whose
only distinguishing feature is which historical item motivated it, not what it actually checks,
is a candidate for deletion, not a rename.

A full repo-wide purge of pre-existing drift happened 2026-07-14; don't assume it needs repeating
wholesale — check for new drift before running another full sweep.

## Don't narrow scope on your own judgment

When investigating one reported bug turns up a second, adjacent one — even on a different code
path, even if it looks technically separable — fold it into the current fix by default. Don't
mark it "out of scope, noted for a follow-up" unilaterally. Only defer something that's genuinely
a separate, large body of work, and say so explicitly so the operator can object, rather than
making the call silently. Getting this wrong means real bugs sit unfixed while looking "handled."

## Writing style

Follow `SKILL_AGENT_PLAIN_PROSE.md` for every human-facing surface this project touches: docs,
code comments, benchmark write-ups, and the assistant's own chat replies. Plain English Campaign
base rules first (short sentences, active voice, everyday words, "you"/"we"), then cut the
LLM-voice tells (em-dashes as glue, "not X, it's Y", announced-honesty preambles, colon reveals,
hype, listicle bloat). Read the skill doc itself for the full rules before writing anything long.

## Project

`@polycode-projects/the-mechanical-code-talker` (short: **tmct**) — a pure-JS, **no-LLM**
chatbot: deterministic language libraries (wink-nlp), template sets, committed corpuses, an
OWL-labelled JSON graph memory on disk (`.tmct/`, never committed). LLMs are allowed ONLY in
the offline eval harness (LLM-as-judge in the chat tuning cycle), never in the product path.

- `npm test` — node --test suite; must stay green.
- CLI smoke: `printf 'hi\n/exit\n' | node bin/tmct.mjs` must greet and exit 0.
- See `ROADMAP.md` (phases), `SKILL_BENCHMARK_CEFR_ENGLISH.md` (autonomous chat tuning loop),
  `SKILL_AGENT_STRATEGY_ADVISOR.md` (background advisor recipe).
