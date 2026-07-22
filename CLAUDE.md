# CLAUDE.md — project guidance for Claude Code sessions

## An approved plan is the authorisation — never stop to ask if you should continue

If the operator approved a plan, or the prompt says "complete X", **work it to the end and do not
ask permission to keep going**. Report progress as you land it and carry straight on to the next
item. The operator has left; a question in an empty room is just an idle session.

**A green test suite is a checkpoint, not a decision point.** Neither is a landed phase, a clean
commit, or a tidy summary. Those are the middle of the work, and they feel like the end because
they feel finished — that is the trap. The pull is strongest exactly when a chunk completes well.

Only three things stop the work:

- a hard safety rule,
- a genuine blocker with no next action left anywhere in the plan, or
- the operator saying stop.

"Shall I continue?", "Want me to carry on with the rest?", "Stop here for review?" — if the plan
already answers it, the question is not caution, it is the session ending itself for no reason. Ask
only what the plan genuinely does not decide, and ask it *before* the work, not as a way to pause
in the middle.

**Why this is here:** on 2026-07-17 a session with an approved ten-phase plan landed five phases,
went green, and stopped to ask whether to do the other five. Nothing blocked it. The operator was
away, and hours of unattended run time were lost to a question that had already been answered
twice — once by the prompt and once by the approved plan.

**The companion rule: write status as you go, not at the end.** That same session was told to record
progress in the source docs and did it only when challenged, hours later. If a phase closes, mark
it in its plan doc and delete its line from `NEXT.md` **in the same commit as the fix**. Status
written at the end is status never written. Sub-agents get the same instruction, and the right to
edit their own rows.

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
- **Pick each sub-agent's model deliberately, and pick the lowest tier that meets the task's
  needs** — the ladder runs Fable to Opus to Sonnet to Haiku. Engine work in a large, subtle file
  (chat.mjs, adventure.mjs) earns a top-tier model; page markup/CSS against a written design
  earns Sonnet; mechanical sweeps (renames across files, manifest updates, format-only edits)
  earn Haiku. When decomposing, **group tasks that need a similar level into the same
  workstream** so one agent's minimum required model serves the whole group — don't staple one
  hard task onto a batch of easy ones, because the hard task then prices the whole batch at the
  top tier.
- The generated site pages under `public/` are gitignored build outputs and go stale on disk
  the moment `src/` moves. Before inspecting one (or screenshotting it), run a fresh
  `npm run demo:build` so what you read matches the code.
- **Keep the chat for chat**: anything long-running (benchmarks, judge passes, builds, test
  sweeps) executes as a BACKGROUND task at maximum safe concurrency; the main session
  launches it, keeps coordinating and conversing, and collects results on the completion
  notification.
- Commit per completed step with the repo-local identity (`antony@polycode.co.uk` /
  `Antony at Polycode`). Keep the tests green at every commit — but which tests depends on where
  the commit lands, see "Test the blast radius" below.
- Push/publish is gated on the operator (CI publishes on version bump on `main`).

## Test the blast radius, not the whole suite

Mid-task, survey the test estate and run only what your change can actually reach. A sub-agent in a
worktree does the same, and keeps doing it when it commits: a worktree commit is a checkpoint, not
a release.

**Only one moment earns the full `npm test`: when the change is about to become someone else's
problem.** That is a commit to `main`, or a commit to a branch that has a remote — anything that can
reach CI or another person. The full suite's job is to protect the CI build and the next person, and
nowhere else. A worktree commit, a checkpoint, a commit you won't push alone: none of them qualify.

Everything before that moment is your own iteration loop, and the full suite is minutes of it, every
time. The point of the rungs below is not to skip checking — it is to catch anything that could
reasonably be expected to fail *now*, in seconds, so you don't round-trip through a red CI later.

### The four rungs

| rung | when | cost |
|---|---|--:|
| `npm run test:smoke` | after any edit. The reflex; no excuse not to | ~0.6s |
| `npm run test:fast` | before a worktree/checkpoint commit, and for **any sub-agent** | ~1.8s |
| the blast radius | alongside `test:fast`, for whatever you actually touched | seconds |
| `npm test` | a commit to `main`, or to a branch with a remote | minutes |

`test:smoke` is one test per capability family — direction, the miss wall, ambiguity, the canonical
restatement, teach/recall/proof — chosen so a failure means the build is broken rather than subtly
wrong. `test:fast` adds a sample row from every chat lane and the tool-layer contract, 172 tests in
all. Both are named after their budgets, and `npm run check:budgets` holds them to it. **A tier that
breaks its budget is a bug in the tier — cut its content, never raise the number.**

That budget check is a `check:*` and not a test, on purpose. It measures wall-clock, and `npm test`
runs eight workers at once — so inside the suite it spends its whole measurement competing with the
thing it is timing. It read 4,135ms against a 1,000ms budget that way, for a tier that takes ~700ms.
Benchmarks don't run under load.

### Finding the radius

In order:

- the file you edited, and whatever imports it;
- its keyed corpus rows — `node scripts/corpus-matrix.mjs` prints the key × lane map;
- the estate guard for any generated artifact you touched (the ask bundle, the real-word collision
  table, the page version stamp) — these fail on drift, so a change that regenerates one is exactly
  where a targeted run pays;
- whatever the change's own reason names.

`node --test test/tools/ask.test.mjs` costs 0.4s for 125 assertions.
`node --test "test/estate/*.test.mjs"` costs seconds. Running all of it to check a one-line edit is
a habit, not a check.

### README examples are checked locally, not per-push

The README's two heavy copy-paste examples cost ~6 CI-minutes and exercise machinery the init
and seed tests already cover at smaller scale, so they are not in the per-push pipeline at all.
**After changing the CLI surface (bin/ flags, command output), the library's public exports, or
any flow a README example walks through, run `npm run check:readme` locally** — it runs
`e2e/readme-examples.test.mjs` with the heavy examples enabled. The lighter README example
checks still run in the per-push e2e tier.

### Two names for "smoke"

`smoke:deploy` already owns the word in this repo and means something else entirely — a probe
against a **deployed site**, after a release. `test:smoke` is the 1-second tier in the `test:*`
namespace and never touches the network. They don't collide mechanically; they do collide in a
reader skimming `npm run`. Say which you mean.

**Sub-agents are the strict case.** They are the most expensive place to run a full suite — several
run at once, each paying the whole cost — and the least likely to need it, because they own a slice
of the tree by construction. A sub-agent running `npm test` is usually spending minutes confirming
something its own range cannot break. Say so in the dispatch brief: name the files that agent
should run, and tell it to cite the coordinator's count rather than re-earn it. `test:fast` is the
rung that replaces the full suite for them.

Two traps this rule does not excuse. A radius you cannot see is a real reason to run the suite, and
the only one — write down that you could not see it. And a shared, generated artifact is wider than
it looks: touching the verb vocabulary regenerates the collision table, which redraws the ask
bundle. Follow the generator, not the diff.

## Always tee to a file before filtering — every pipe, not just the slow ones

Never pipe anything into `tail`, `head`, `grep` or any other filter without teeing it first:

    cmd 2>&1 | tee /tmp/some-file.log | tail -20      # or head, grep, whatever

You still get the quick glance, and the full output stays on disk when the part you need turns
out to sit somewhere else.

**The trigger is the pipe, not the duration.** This rule used to be titled "long-running command",
and that word is a loophole: a 1.8s `test:fast`, a four-turn CLI reproducer and a 0.4s unit file all
read as "not long", so they got piped bare — and `head` does its damage in milliseconds. If you are
filtering output at all, tee it.

Two different things go wrong without the tee. `tail -N` throws away everything before the last
N lines for good, so if the summary sits earlier it's gone and the whole command runs again.
`head -N` is worse: once it has its N lines it exits, the producer gets SIGPIPE, and **the
command itself is killed part-way through**. A 17-session playtest sweep piped into `head`
died silently at session 7 and reported like a clean run — the truncation showed up only in
the line count. `head` doesn't just discard output, it stops the work.

**A piped CLI reproducer is the sharpest case, and the easiest to miss.**
`printf '…' | node bin/tmct.mjs chat … | head -8` can SIGPIPE the session mid-transcript: the later
turns never run, `/exit` never runs, and what you read looks like the whole conversation. A
reproducer that dies early doesn't fail — it agrees with you.

If a command's output is worth filtering, it's worth keeping.

**The summary-grep is where this rule actually dies.** Sessions keep the tee on the "big" runs
and then drop it for `| grep -E "^ℹ (pass|fail)"` count checks, because "I only need two lines."
Those two lines are exactly the case where the tee earns its keep: when the counts show a fail,
the why was in the output you threw away, and the whole run repeats to get it back. A test run's
counts NEVER travel without the log (2026-07-18: a 2-minute suite was piped bare into a counts
grep minutes after its sibling had already needed re-running for this exact reason).

**And a command you have already seen run long goes to the background, full stop.** If a command
(or its sibling in the same file) has once hit the foreground timeout or run past ~30s, the
re-run is `run_in_background`, not foreground — "I only want the counts this time" is how a
2-minute test file ends up blocking the coordinator chat that exists to stay free. Waiting on a
background task uses the task-wait mechanism, never a foreground sleep loop.

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

Comments and test descriptions must never reference a PLAN/NEXT doc, a "Gap N"/"BUG N"/
"Phase N item N" label, a commit hash, an operator directive, or a date ("live-tested
2026-07-09"). That framing belongs in the commit message or PR description, not the file. It rots
the moment the doc it points to is archived, renamed, or deleted, and it builds up into exactly
the kind of stale, self-referential clutter that has to get purged wholesale later. This applies
on top of the general no-comments default above, not instead of it. Even a comment that skips the
doc-reference trap still shouldn't exist unless it explains a genuinely non-obvious WHY.

Test names must describe the behavior or outcome under test on their own terms. Write "resolves a
2-hop alias chase through a taught subClassOf fact", not "NEXT item 2 regression: ...". A test
whose only distinguishing feature is which historical item motivated it, not what it actually
checks, is a candidate for deletion, not a rename.

Check for new drift before running a full repo-wide sweep; don't assume one is needed.

## Don't narrow scope on your own judgment

When investigating one reported bug turns up a second, adjacent one, fold it into the current fix
by default, even if it's on a different code path or looks technically separable. Don't quietly
hive it off as a separate task on your own. Only treat something as separate work when it's
genuinely a separate, large body of work, and say so explicitly so the operator can object rather
than making that call silently. Getting this wrong means real bugs sit unfixed while looking handled.

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
go there", "not a placeholder for something smarter".

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

The product's central promise is the **honest miss**: a query it cannot ground gets a refusal,
never a guess. The literature names the goal *abstention* (selective prediction; Chow's 1970
reject option is the root) and the mechanism the *open-world assumption* (Reiter, 1978) — tmct
abstains because nothing matched, not because a confidence score fell below a threshold. README's
bibliography carries both.

- `npm test` — node --test suite; must stay green.
- CLI smoke: `printf 'hi\n/exit\n' | node bin/tmct.mjs` must greet and exit 0.
- See `NEXT.md` (open items) and the `PLAN_*.md` design docs,
  `SKILL_BENCHMARK_CEFR_ENGLISH.md` (autonomous chat tuning loop),
  `SKILL_AGENT_STRATEGY_ADVISOR.md` (background advisor recipe).
