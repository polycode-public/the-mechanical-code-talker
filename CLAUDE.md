# CLAUDE.md — project guidance for Claude Code sessions

## Explicit versioning/commit/push instructions are not up for debate

If the operator's prompt states when to bump the version, commit, or push (e.g. "roll
the version every round", "commit and push each turn"), execute it exactly as stated.
It overrides any general policy written here or anywhere else in this repo; don't ask
clarifying questions about cadence. Only stop if following it would violate a hard
safety rule (e.g. leaking a secret). See
[[feedback_follow_explicit_versioning_instructions]] in memory.

## Working model: coordinator + background sub-agents

Run big tasks in **concurrent background sub-agents** and keep the main chat free — the main
session is the COORDINATOR (plans, launches, integrates, answers the operator), not the worker.

- Decompose into workstreams with **clear file-ownership boundaries**; serialize on shared
  files (one agent owns `package.json`, `src/`, `bin/`, `test/` sequences; docs/site tracks
  run in parallel).
- **Keep the chat for chat**: anything long-running (benchmarks, judge passes, builds, test
  sweeps) executes as a BACKGROUND task at maximum safe concurrency; the main session
  launches it, keeps coordinating and conversing, and collects results on the completion
  notification.
- Commit per completed step with the repo-local identity (`antony@polycode.co.uk` /
  `Antony at Polycode`); keep `npm test` green at every commit.
- Push/publish is gated on the operator (CI publishes on version bump on `main`).

## Always tee a long-running command to a file before filtering it

Never pipe a test run, a playtest sweep, or any long command straight into `tail`, `head`,
`grep` or anything else. Always tee it first:

    cmd 2>&1 | tee /tmp/some-file.log | tail -20      # or head, grep, whatever

You still get the quick glance, and the full output stays on disk when the part you need turns
out to sit somewhere else.

Two different things go wrong without the tee. `tail -N` throws away everything before the last
N lines for good, so if the summary sits earlier it's gone and the whole command runs again.
`head -N` is worse: once it has its N lines it exits, the producer gets SIGPIPE, and **the
command itself is killed part-way through**. A 17-session playtest sweep piped into `head`
died silently at session 7 and reported like a clean run — the truncation showed up only in
the line count. `head` doesn't just discard output, it stops the work.

If a command's output is worth filtering, it's worth keeping.

## Name it, don't comment it

Prefer a self-documenting name over a comment that compensates for a vague one. Good:
`renderImagePixels(player) {...}`, where the name carries the meaning. Bad:
`/* this renders an image as pixels for the player */ draw(obj) {...}`, a vague name propped up
by a comment explaining what it actually does. When you find the second pattern, rename first,
then drop the comment. Don't just delete the comment and leave the bad name behind. A local
rename (private, few in-file call sites) is safe to do inline. A rename of an exported or
widely-used identifier is a bigger, separate change, so flag it instead of doing a drive-by
rename across many files under time pressure.

## Comment and test-name hygiene

Comments and test descriptions must never reference a PLAN/HANDOVER doc, a "Gap N"/"BUG N"/
"Phase N item N" label, a commit hash, an operator directive, or a date ("live-tested
2026-07-09"). That framing belongs in the commit message or PR description, not the file. It rots
the moment the doc it points to is archived, renamed, or deleted, and it builds up into exactly
the kind of stale, self-referential clutter that has to get purged wholesale later. This applies
on top of the general no-comments default above, not instead of it. Even a comment that skips the
doc-reference trap still shouldn't exist unless it explains a genuinely non-obvious WHY.

Test names must describe the behavior or outcome under test on their own terms. Write "resolves a
2-hop alias chase through a taught subClassOf fact", not "HANDOVER item 2 regression: ...". A test
whose only distinguishing feature is which historical item motivated it, not what it actually
checks, is a candidate for deletion, not a rename.

Check for new drift before running a full repo-wide sweep; don't assume one is needed.

## Don't narrow scope on your own judgment

When investigating one reported bug turns up a second, adjacent one, fold it into the current fix
by default, even if it's on a different code path or looks technically separable. Don't mark it
"out of scope, noted for a follow-up" on your own. Only defer something that's genuinely a
separate, large body of work, and say so explicitly so the operator can object rather than making
that call silently. Getting this wrong means real bugs sit unfixed while looking handled.

## Never write capability walls — state the horizon, not the wall

Prose in a live doc that declares a feature or extension permanently beyond reach is poison.
What the system can't do today is observable from benchmarks and playtests, so writing it down
adds no information — but it actively resists the next uplift, because every future session
(human or Claude) reads it as a settled decision and argues against the change instead of making
it. The earth is not flat: a problem with no generally accepted engineering today is a research
horizon, not a wall. Write it that way ("no settled deterministic engineering exists yet for X;
candidate literatures: A, B; until a tier is designed these land on the honest miss wall") or
write nothing.

Purge vocabulary — when any of these describe a capability or design extension in a live doc,
delete or reframe to horizon language: permanently, forever, never, out permanently, stays out,
out for good, out of reach, beyond reach, impossible, unreachable, off the table, ruled out,
closed door, dead end, hard wall, hard limit, ceiling (as design limit), frozen (as scope), set
in stone, immutable (as scope), no path to, will never, can never, cannot ever, won't ever, not
even in principle, fundamentally/inherently/structurally/architecturally impossible, "I wouldn't
go there", "not a placeholder for something smarter", "not a deferred stretch".

NOT covered by this rule, because they are different things: the project constitution (no LLM in
the product path), safety/security decisions, behavioral invariants that protect honesty ("a
timeout is a miss, never a guess"), plain plan scoping ("not in this plan", with the sequencing
stated), historical logs (archive/, playtests/, BENCHMARK_* record what a version couldn't do —
that's measurement, not design), and present-tense descriptions of current behavior.

Why this keeps happening (so the next session recognizes the pull): bounded claims feel like
rigor, and a declared limit makes a doc sound decisive for free. It converts present absence
(cheap, observable, temporary) into declared essence (expensive, sticky, wrong). Same family as
"contraction, not expansion" and the no-scope-echo-comments rule: limiting prose generated as
caution, paid for at every future change.

## Writing style

Follow `SKILL_PLAIN_PROSE.md` for every human-facing surface this project touches: docs,
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
