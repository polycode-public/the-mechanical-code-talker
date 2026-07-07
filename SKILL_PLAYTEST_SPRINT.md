# SKILL_PLAYTEST_SPRINT.md — a capped, delegated, release-gated playtest sprint (3 rounds, chained)

A short, bounded variant of `SKILL_CHAT_PLAYTEST.md`'s dialogue-flow loop: instead of an
open-ended tier ladder run by the main agent inline, this runs a **fixed, small number of rounds**
(default 3), each round's chat **delegated to a background sub-agent**, each round's questions
**chaining off the previous round's transcript** (a real user's next question usually follows from
what they just learned, not a fresh unrelated topic), with the **main agent appraising each
transcript in the primary chat** (never hidden in a sub-agent's own output) and **shipping a
confirmed fix immediately** (version bump + push) rather than batching fixes to the end. Stops at
the round cap or the first round that finds nothing worth fixing, whichever comes first, then
reports a recommendation on whether to keep going.

This is the SAME dead-end discipline `SKILL_CHAT_PLAYTEST.md` §0 already defines (a dead-end is a
wall, an "isn't a term", an "unknown qualifier", a phrasing-miss, or an invited follow-up the
engine can't take) — this skill does not redefine it, only wraps it in a capped, delegated,
per-round-shippable cadence. Use `SKILL_CHAT_PLAYTEST.md` itself for the open-ended tier-ladder
version; use this one when the operator wants a bounded sprint with a clear stop and a recommendation
at the end, run mostly hands-off.

> **Invoke it by telling a session:** *"Follow `SKILL_PLAYTEST_SPRINT.md` and run a playtest
> sprint"* (optionally: a round cap other than 3, a starting graph/repo, a focus area).

---

## 1. The loop (one round)

**Step 1 — DISPATCH.** Launch a background sub-agent (not a fork — it needs to run genuinely
independently while the main agent stays free to report progress) with a self-contained prompt
containing:
- The target graph/repo to chat against (a shipped example by default — `examples/mini-webapp` —
  or whatever the operator named).
- **The full transcript of every prior round** (verbatim questions + answers), with the
  instruction: *"Read this prior conversation first. Your job is to CONTINUE it naturally — ask
  the next 4-8 questions a real user would ask next, given what they just learned, not a fresh
  unrelated topic."* Round 1 has no prior transcript — it opens cold, playing a curious first-time
  user (mirrors `SKILL_CHAT_PLAYTEST.md` §1 Step 1's "play a curious user" discipline).
- The instruction to drive the conversation via the real CLI (piped turns into
  `node bin/tmct.mjs chat --repo <graph>`, capturing the transcript verbatim — same mechanism
  `SKILL_CHAT_PLAYTEST.md` Step 1 uses) or `runTurn`/`createSession` directly for speed, either is
  fine as long as it exercises the REAL product path (never a mock).
- The instruction to return the raw transcript (every question + every answer, unedited) as its
  final message — the sub-agent does NOT appraise or fix anything itself; that stays with the main
  agent, in the primary chat, where the operator can see it.

**Step 2 — SHOW.** When the sub-agent returns, post the full transcript to the operator verbatim,
in the primary chat — never summarized-away, even if it's long. This is the point of delegating
the CHAT step but keeping the LOOP in the primary conversation.

**Step 3 — APPRAISE.** Read the transcript the same way `SKILL_CHAT_PLAYTEST.md` §0/§2 already
score it: every turn is FLOW (answered or honestly nudged) or DEAD-END (a wall, an unrecognized
qualifier, a phrasing-miss, a confident-wrong answer, an invited follow-up the engine can't take).
State the appraisal plainly in the primary chat: what worked, what didn't, and — this is the gate
for Step 4 — whether anything found is a REAL, FIXABLE issue (a routing/recognition gap to an
existing capability, per `SKILL_CHAT_PLAYTEST.md` §4's "fix routing, not rigidity" discipline) or
a genuine ceiling (name it as one, don't force a fix).

**Step 4 — FIX + SHIP, if warranted.** If Step 3 found something real and fixable:
1. Make the fix (directly, or via a further-delegated sub-agent if the fix itself is substantial —
   the main agent's judgment call, same as any other fix in this repo).
2. `npm test` green, same regression discipline `SKILL_CHAT_PLAYTEST.md` §4 requires.
3. **Verify live** against the exact failing turn from the transcript — confirm it's now FLOW, not
   just that tests pass (tests can be wrong too; this whole skill exists because a real
   conversation is a better oracle than a fixture).
4. Bump `package.json` (patch, for a fix — same convention this repo's release commits already
   use), commit, **push immediately** — don't batch fixes across rounds. A round that ships is a
   round the operator can see land in real time, and a later round's chaining should build on the
   ACTUALLY-shipped state, not a pending one.
5. If Step 3 found nothing worth fixing (a clean round, or only genuine ceilings), do not force a
   change — say so plainly and move to the next round anyway (a clean round is a good outcome, not
   a failure, and still gets chained into the next round's opener).

**Step 5 — CONTINUE OR STOP.** Increment the round counter. Stop when EITHER:
- the round cap is reached (default 3), or
- a round finds nothing fixable AND the previous round also found nothing fixable (two clean
  rounds in a row — "getting nowhere," the operator's own phrase, read as a stopping signal, not
  just a round-count limit).

Whichever triggers first, go to §2.

---

## 2. The end-of-sprint report

After the loop stops, report to the operator in the primary chat:
- **Per round**: one line — what was tested, what was found, what shipped (or "clean round,
  nothing to fix").
- **Overall**: how many of the N rounds shipped a real fix vs. came back clean.
- **A recommendation**, not just a status: if fixes kept landing and the well doesn't look dry,
  say so and suggest another sprint (or escalating to `SKILL_CHAT_PLAYTEST.md`'s full tier ladder
  for a deeper pass). If the last one or two rounds came back clean, say the sprint found what it
  was going to find at this complexity tier and recommend either stopping here or ratcheting the
  tier (`SKILL_CHAT_PLAYTEST.md` §3) rather than repeating the same tier.

---

## 3. Discipline (so a capped sprint stays honest, not just fast)

- **Delegate the CHAT, not the JUDGMENT.** The sub-agent's only job is to hold a real, natural
  conversation and hand back the raw transcript. Appraisal, the fix-or-not decision, and the
  ship-or-not decision all stay with the main agent, visible to the operator — a sub-agent silently
  deciding "this is fine" would defeat the point of asking to see every round.
- **Chain for realism, not padding.** The point of leading each round with the prior transcript is
  that real users ask follow-ups shaped by what they just learned — a fresh unrelated topic every
  round tests breadth, not depth, and this skill is explicitly the depth-and-follow-through variant
  (breadth is `SKILL_CHAT_PLAYTEST.md`'s multiple-entry-points-per-tier job, §1 Step 1).
- **Ship per-round, not in a batch.** A confirmed fix goes out immediately (version bump + push)
  rather than accumulating — this is a genuine choice (batching would be marginally more efficient
  release-wise) made because the operator asked for exactly this cadence, and because it means a
  crash mid-sprint still leaves every already-shipped fix live.
- **Regression is still sacred.** `npm test` green and a live re-check of the fixed turn, every
  round, no exceptions — same contract `SKILL_CHAT_PLAYTEST.md` §4 and `SKILL_TUNING_CYCLE.md` §1
  already hold every other loop in this repo to.
- **A clean round is a real result, not a null one.** Report it as such. Two clean rounds in a row
  is the stop signal, not a failure to find something to fix.
- **Cap is a ceiling, not a target.** If two rounds in a row come back clean before the cap is
  reached, stop early (§1 Step 5) — don't force a 3rd round's worth of manufactured fixes just to
  hit the number.

---

## 4. One-paragraph TL;DR

Run up to N (default 3) rounds. Each round: delegate a short, natural chat to a background
sub-agent, seeded with every prior round's transcript so it asks realistic follow-ups; show the
full transcript to the operator; appraise it live (FLOW vs. DEAD-END, same bar as
`SKILL_CHAT_PLAYTEST.md`); if something real and fixable turns up, fix it, test it, verify it live
against the actual failing turn, bump the version, and push immediately; if not, say so and move
on. Stop at the round cap or after two consecutive clean rounds, then report per-round outcomes and
a recommendation on whether the well looks dry or worth another sprint.
