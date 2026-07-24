# SKILL_AGENT_STRATEGY_ADVISOR.md — a deep-process background "strategy advisor" for a Claude Code session

A reusable recipe for running a second pair of eyes alongside the main agent: a background agent
on Sonnet 5 (the default model as of 2026-07-07; previously Opus 4.8 — see §5) that, on a
re-armed ~5-minute cadence, infers the operator's goal, checks the main
agent's progress against it, researches the repo (and the web when a specific question emerges),
ranks candidate solutions from all sources, optionally dry-runs the top one, and returns 1–3
non-obvious recommendations that the main loop surfaces into the chat. It runs a deeper,
longer-term process than the main chat: the main agent executes; the advisor verifies, gates,
and attacks.

This is `CLAUDE.md`'s coordinator model in its purest form: the main session stays the
COORDINATOR — it never does the advisor's research or verification work itself — while the
advisor runs as a background sub-agent and the main loop's only job is to launch it, keep
coordinating, and relay its findings on the completion notification.

Born from a real session where the operator suggested running benchmark batches concurrently
(a 5x speedup) the main agent had not proposed. Revamped 2026-07-01 after the deep-process
variant ran live through the B016 spec session (see §7).

In this repo the advisor rides the **autonomous chat tuning cycle** (`SKILL_BENCHMARK_CEFR_ENGLISH.md`) —
a loop with **no hard pause** between iterations. That makes the advisor more than a second pair
of eyes: it is **the drift alarm between operator check-ins**. When the loop is running
unattended, the advisor's watch-list (§6) is the mechanism that catches judge drift,
overfitting-to-judge, and regressions before several cycles compound them.

> **Invoke it by telling a session:** *"Follow `SKILL_AGENT_STRATEGY_ADVISOR.md` and start a strategy
> advisor for this session"* (optionally: focus, cadence). The main agent then sets up the loop below.

---

## 0. The key mechanism (why this works at all)

**Only the main conversation loop can write to the chat.** A subagent (spawned via the Agent
tool), a cron/scheduled agent, and a background shell command cannot post a message to the
operator directly. So a "proactive advisor that messages you" must always be surfaced by the
main loop. The trick is giving the main loop a reliable trigger to wake up and a helper whose
output it relays. The reliable trigger is:

**A background task completing** → a `task-notification` re-invokes the main loop with the
task's result. This is the door. When the advisor agent finishes a tick, its final message comes
back to the main loop, which surfaces the advice and re-arms the next tick.

(`ScheduleWakeup` timers exist but are reserved for `/loop` in current harnesses; do not build
the cadence on them. Completion-driven re-arm is the standard; see §3 Step D for the idle-session
fallback.)

So the pattern is a small cycle the main loop drives:

```
main loop (when the advisor's last tick completes, or when work resumes)
  → spawn the advisor tick (background, model: sonnet5)   [deep process, returns findings]
  → on its completion notification: SURFACE non-obvious findings to the operator
  → re-arm the next tick with a fresh focused brief + the do-not-repeat ledger
```

The advisor can recommend; it cannot self-arm or post to chat. The main loop executes that.
Each tick is a snapshot, not a continuous watch, and it sees what you give it: the transcript
tail, the repo, and the brief.

---

## 1. What the advisor can see (cheaply)

- **The full session transcript** is on disk as JSONL at
  `~/.claude/projects/<project-slug>/<session-id>.jsonl` (the project-slug is the cwd path with
  `/`→`-`; the session-id is the UUID also present in the scratchpad path). Give the advisor the
  tail (`tail -c 120000 <transcript>`): the operator's recent messages plus the main agent's
  recent actions, not the whole file (it can be MBs).
- **Other agents' outputs** live under the session's `tasks/<agentId>.output`.
- **A distilled state file** the main agent keeps current (e.g. the latest `BENCHMARK_CEFR_ENGLISH_<version>.md`
  with its decision log). Cheapest and most reliable signal; point
  the advisor here first.
- **The repo itself**: worktree, git history, chatbench telemetry, raw judge outputs
  (`chatbench/results/raw-<NNN>/`). The deep process expects the advisor to read code and data,
  not just narrative.

---

## 2. The deep process (what each tick does)

Each tick runs this sequence, budgeting effort toward the focused brief (§4).

**Step 0 — every tick, and every re-arm: CHECK THE INBOX.** Before the sequence below, read the
session's inbox (`~/.claude/inboxes/<your-handle>.md`) for `[unread]` messages from other Claude
sessions on the machine. Act on any that bear on the operator's goal — a coordination request, a
hand-off, a conflicting workstream, a "flag before you touch these files" — and surface them to the
main loop alongside the tick's findings, then mark them `[read]`. Inter-session coordination is part
of the watch, not an afterthought: when two sessions edit the same repo, the advisor is the tripwire
that catches the collision before a clobbered push (protocol: `~/.claude/inboxes/README.md`).

1. **Goal inference.** Read the transcript tail, the operator's USER prompts first. State in one
   line what the operator is actually trying to achieve, near-term and long-term.
2. **Progress assessment.** From the same tail: how is the main agent progressing toward that
   goal? Gaps, drift, missed parallelism, wasted effort.
3. **Research.** The current worktree, git history, and repo docs; when a specific question
   emerges from steps 1–2 or the brief, the web (targeted, one or two searches, not a sweep).
4. **Rank.** Rank candidate solutions or next actions from all sources: session, repo, web.
5. **Dry-run (optional).** When the top recommendation is cheap to sanity-check, verify it
   before recommending: read the actual code path, recompute the actual numbers, or create a
   scratch git worktree (`git worktree add` under a tmp dir), test read-only or with throwaway
   edits, never commit, remove it afterwards. A recommendation that survives its own dry-run is
   worth an order of magnitude more than a plausible guess.
6. **Deliver.** Return findings via the exit message (the main loop relays them). When more
   context is needed from another Claude session on the machine, or to leave a durable note for
   the owning session, use the inbox protocol (`~/.claude/inboxes/<handle>.md`; protocol in
   `~/.claude/inboxes/README.md`). Use it sparingly.

---

## 3. Set-up recipe (what the main agent does)

**Step A — locate the transcript** (once): derive `<session-id>` from the scratchpad path;
confirm `ls ~/.claude/projects/<slug>/<session-id>.jsonl`. If absent, rely on the handover/plan
docs instead.

**Step B — spawn the advisor** as a **background** general-purpose agent with **`model: sonnet5`
(Sonnet 5), the default as of 2026-07-07.** The validated production run (§7) was on Opus 4.8;
the model default was changed to Sonnet 5 by operator instruction to run this cadence more
cheaply. The discipline that made the deep process valuable — verification work (reading graph
predicate tallies, harness internals, raw result records), not hand-waving — still applies at
this tier: if a tick's findings start reading as plausible-but-unverified, that is a signal to
escalate that specific tick back to `model: opus`, not a reason to relax the dry-run step. A
wrong-but-confident advisor is worse than none regardless of which model produced it.

Prompt template (generalise the bracketed parts; keep the structure):

```
You are the STRATEGY ADVISOR (deep-process) for a live Claude Code session in <REPO>. Tick <N>
of a re-armed ~5-minute cadence. You are a skeptical second pair of eyes running a deeper,
longer-term process than the main chat. No git write operations; no repo edits except appending
to STRATEGY_ADVISOR.log as specified below.

PRIOR TICKS' FINDINGS (do NOT repeat): <LEDGER — one line per prior tick's key findings>

SESSION STATE: <2-5 lines: what the main agent is doing now, which sub-agents are already
covering what — so you do not duplicate them>

THIS TICK'S FOCUSED BRIEF: <ONE specific deep-dive question the main loop wants answered —
a feasibility gate, an adversarial critique of a pending synthesis, a telemetry watch. See §4.>

PROCESS (in order): (1) GOAL: tail -c 120000 <TRANSCRIPT.jsonl> — infer the operator's goal
from the USER prompts first; one line. (2) PROGRESS: assess the main agent's progress toward it;
gaps, drift, missed parallelism. (3) RESEARCH: the worktree, git history (git log --oneline -15),
repo docs; the web only if a specific question emerges. (4) RANK candidate solutions from all
sources. (5) DRY-RUN (optional): if the top recommendation is cheap to sanity-check, verify it —
read the real code path, recompute the real numbers, or use a scratch git worktree under a tmp
dir (never commit, remove afterwards). (6) Answer the focused brief with evidence (file:line,
record counts), not plausibility.

RETURN (goes to the main loop, which relays to the operator):
- GOAL (1 line) · PROGRESS (1-2 lines)
- 1–3 SPECIFIC, ACTIONABLE, NON-OBVIOUS findings/recommendations, each with a one-line "why"
  and concrete evidence. If nothing non-obvious: exactly "No new strategic advice this tick —
  approach is sound." (Do NOT pad or restate what's already being done.)
- RE-ARM? yes / adjust (say what) / pause.
Keep under ~300 words. Specificity over coverage.

THE LOG IS GITIGNORED AND MACHINE-LOCAL. A fresh checkout has no STRATEGY_ADVISOR.log, so if it
is missing, create it with exactly this header before you write anything else — the header is the
only place a human or agent who opens the file learns the pruning rule:
  cat > STRATEGY_ADVISOR.log <<'HEADER'
  Written by the strategy advisor, one block per tick. See SKILL_AGENT_STRATEGY_ADVISOR.md.
  Machine-local scratch: this file is gitignored and nothing outside your machine reads it.

  ENTRIES OLDER THAN 1 DAY ARE REMOVED. The advisor prunes them at the start of each run. If you
  are a human or an agent reading this file, prune them too — the rule holds whoever is looking.

  An advisor tick is about a session happening right now: which agent has stalled, which batch is
  drifting, whether a pending synthesis survives a second look. A day later the batch has shipped
  or been abandoned, and the entry describes a repo that no longer exists. It then reads as a live
  finding to the next session, which is worse than no entry at all.

  Nothing else backs this file up, so anything worth keeping past a day has to be written somewhere
  that is: an open item goes to NEXT.md, a design to the relevant PLAN_*.md, a measurement to a
  BENCHMARK_* write-up. Mine it across first, then delete it here.

  No current entries.
  HEADER

PRUNE FIRST: every run, before anything else, delete each block whose [timestamp] is more than 1
day old — whatever its STATUS, including OPEN. Your ticks are about a session happening now; a day
later the batch shipped or died and the entry describes a repo that is gone, but still reads as
live to whoever finds it. If a stale block names something that still matters, mine it into the
doc that owns it (NEXT.md for an open item, a PLAN_*.md for a design) and say so in your
return — then delete it here regardless. Nothing backs this file up, so mine it across BEFORE you
delete it. Keep the header. Prune even on a "no new advice" run, and drop the "No current
entries." line as soon as you append a real block.

PERSIST: IF (and only if) you have actionable advice, APPEND one self-contained block to
<REPO>/STRATEGY_ADVISOR.log (never reorder or rewrite a block you are keeping; NEVER run git).
Skip appending on a "no new advice" run — but still prune. Use:
  printf '\n═══════════════════════════════════════\n[%s] source=strategy-advisor(sonnet5,deep) · topic=<short>\nOBSERVATION: ...\nRECOMMENDED ACTION: ...\nSTATUS: OPEN\n' "$(date -u +'%Y-%m-%d %H:%MZ')" >> STRATEGY_ADVISOR.log

INBOX CHANNEL: to get context from another session on this machine, or to leave a note for the
owning session (handle: <HANDLE>), append to the relevant inbox under ~/.claude/inboxes/
(protocol: README.md there). Use sparingly.
```

**Step C — on the advisor's completion** (`task-notification`): read its result, surface
anything non-obvious to the operator in your next chat message (skip if it said "no new
advice"), and disclose when you act on its advice. Then re-arm the next tick with an updated
ledger and a fresh focused brief.

**Step D — cadence: re-arm on exit, ~5-minute return (operator standing preference).** Start the
advisor on this 5-minute re-arm by DEFAULT for any non-trivial session (it rides
`SKILL_BENCHMARK_CHAT`'s autonomous loop). The completion notification is the trigger: deep ticks
naturally take 2–4 minutes, so re-arming on each completion lands on the cadence without any timer.
Three adjustments:
- **Check the inbox on every re-arm (and on start).** Each time the main loop re-arms the advisor,
  it first reads its own inbox (`~/.claude/inboxes/<handle>.md`), acts on `[unread]` messages, marks
  them `[read]`, and hands the advisor tick any cross-session context worth watching (Step 0). This
  is how coordination stays current at the 5-minute cadence rather than only at session start.
- **Hold while idle.** When the session is waiting on the operator and nothing is moving, hold
  the re-arm (a tick with nothing new to chew on repeats itself). Resume the moment work resumes —
  but still glance at the inbox on resume, since another session may have moved while you idled.
- **Idle-session fallback.** If advice should arrive even when the main loop is asleep, use a
  scheduled (cron/routine) advisor session that writes to the owning session's inbox; the main
  loop reads its inbox between tasks and relays. Delivery still happens through the main loop.

---

## 4. Focused briefs + the do-not-repeat ledger (what makes ticks valuable)

Generic "any advice?" ticks are the weak form of this skill. The high-value ticks are handed
**one specific, falsifiable question** chosen by the main loop, plus a **compact ledger of every
prior tick's findings** so nothing is repeated. Good brief shapes:

- **Feasibility gate.** "The plan's #1 lever assumes X — verify X against the actual data/code
  before we pay for it." (Kills wrong levers for $0.)
- **Adversarial critique.** "Here is the synthesis the operator is about to act on — break it.
  Concrete, falsifiable objections with evidence, and say explicitly what you failed to break."
- **Design resolution.** "Sub-agent A recommends P, the plan implies Q — which attributes the
  levers cleanly, and what does each cost?"
- **Telemetry watch** (during chatbench runs — see §6).

The main loop owns the ledger: one line per prior tick, carried in every re-arm prompt. The
advisor's standing instruction is "do NOT repeat these".

---

## 5. Discipline (so it stays valuable, not noise)

- **Sonnet 5, by default, as a background sub-agent task** (changed from Opus 4.8 2026-07-07 by
  operator instruction — see §7 for the Opus-validated production run this recipe was built on).
  The advisor is a verifier, not a summarizer; expect evidence (file:line, record counts) in
  every claim regardless of model tier, and escalate an individual tick to `model: opus` if its
  findings start reading as plausible-but-unverified.
- **"Say nothing if nothing."** Force the literal "No new strategic advice this tick — approach
  is sound." so empty runs cost one line.
- **Non-obvious only.** It must not restate the plan. Its value is the thing you didn't think of.
- **The main agent decides.** Treat advice as input, not instruction: evaluate, then act or note
  why not.
- **Disclose it.** When you act on advice, say so (credit the advisor) so the operator sees the
  loop working.
- **Persist it (append-only).** Actionable items go to `STRATEGY_ADVISOR.log` (datestamped,
  `═══`-delimited, newest at bottom); never edit prior entries, never run git. The main agent
  commits the log alongside the code change it relates to (CLAUDE.md notes this) and appends a
  `✅ DONE` note (never editing the old block) when an OPEN item is acted on. Nothing is logged
  on a "no new advice" run.
- **No duplication.** The session-state block in each brief lists what other sub-agents are
  already covering; the advisor works around them.

---

## 6. Run-time telemetry watch brief (the alternate brief during chatbench cycles)

While a chatbench cycle runs (apply → smoke → run → judge → write; measurement rules in
`SKILL_BENCHMARK_CEFR_ENGLISH.md` §1), swap the focused brief for this watch-list. Same mechanics:
background, signal-only, 1–3 non-obvious flags per tick or the literal "No new advice",
append-only log. Because the tuning cycle runs **autonomously with no hard pause**, this
watch-list is the drift alarm between operator check-ins. Priority order:

- **Judge integrity (the measurement-integrity killer).** Judge refusals or format failures must
  VOID the affected case's sample (re-sampled or excluded), never be counted as a fail — flag any
  run where voids leak into the fail count. **Judge drift:** the same case with the same product
  answer scoring differently across cycles means the judge, not the product, moved — flag it and
  recommend re-pinning the judge model + prompt version.
- **Overfit-to-judge.** The mean going up while the transcripts read *worse* is the loop gaming
  its own grader. Spot-read the discriminating transcripts
  (`BENCHMARK_CEFR_ENGLISH_<version>.md`'s "Evidence / transcripts" section, discriminating transcripts first) each cycle and say whether the improvement is
  real conversation quality or rubric-shaped noise.
- **Regression watch.** Any previously-passing case failing is FAIL outright regardless of the
  mean (the hard decision rule) — flag it the moment per-case results show it, don't wait for
  the write-up.
- **Under-parallelized work.** Flag any long-running work executing serially that could fan
  out: judge runs below the default concurrency, independent workstreams executing one-after-
  another instead of as parallel subagents, a benchmark blocking the main chat instead of
  running as a background task. The standing preference is the coordinator model at maximum
  safe concurrency — the chat is for chat; encourage it whenever the session drifts from it.
- **Process slips.** The `chatbench/results/raw-<NNN>/` snapshot skipped before the next run
  overwrites raw judge output; the case set (`chatbench/cases.jsonl`) edited mid-cycle instead of
  append-only between cycles.

Keep it to what the main session would miss. The main loop surfaces and acts; the advisor flags.

---

## 7. Validated in production (2026-07-01, the B016 spec session)

The deep-process variant ran 6 ticks on Opus 4.8 during the session that specced benchmark 016,
and materially changed the plan:

- **Killed the #1 lever as specified** (tick 2): verified against `graph.json` predicate tallies
  that C#/Java graphs carry ~zero call edges, so the planned call-adjacency ranker was
  Python-only in practice and the impl-of-interface half rode an untagged `inherits` edge. The
  lever was split and re-scoped instead of paid for.
- **Found the M1 index-aliasing trap** (tick 3): the harness copies the first arm's graph into
  every seonix arm's worktree, so extractor-phase probe arms would silently cross-contaminate.
- **Resolved the probe design** (ticks 1, 4, 5): two-task basis, flag-per-arm variants, real
  concurrency mechanics, and validated that the prior cycle's otb records were safe to reuse as
  anchors (nothing on the otb code path had changed).
- **Caught a metric counter bug in an adversarial-critique tick** (tick 6): `first_edit_turn`
  counts assistant messages, not turns, and can exceed `num_turns`; a headline built on it was
  withdrawn before the operator acted on it.

Every one of these came from the dry-run/verification step, not from re-reading the plan.

---

## 8. One-paragraph TL;DR

Spawn a background strategy advisor on Sonnet 5 (default since 2026-07-07; Opus 4.8 for the
validated production run in §7) that each tick infers the operator's goal from
the transcript tail, assesses the main agent's progress, researches the worktree/git/web, ranks
solutions from all sources, dry-runs the top recommendation when cheap (scratch worktree, never
committed), and returns 1–3 evidence-backed non-obvious findings or "no new advice". Its
completion notification re-invokes the main loop, which surfaces the findings, updates the
do-not-repeat ledger, and re-arms the next tick with a fresh focused brief (~5-minute cadence;
hold while idle, resume with work; inbox protocol for cross-session context). Signal-only,
append-only log, never git; the main agent decides, and credits the advisor when it acts on advice.
