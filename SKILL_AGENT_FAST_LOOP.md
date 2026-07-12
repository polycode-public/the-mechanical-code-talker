# SKILL_AGENT_FAST_LOOP.md — a short, fully-delegated chat-explore-and-fix loop for running alongside other work

A lightweight cousin of `SKILL_BENCHMARK_CONVERSATION.md`'s capped sprint mode (§3 there), built for
a different situation: the operator wants a handful of quick, natural conversations poking at tmct
for real bugs, running **concurrently alongside other, longer background work** (a benchmark batch,
a build), not as its own standalone measured cycle. Each round is short (~4 prompts), fully
self-contained, and — the real difference from capped sprint mode — the round's own sub-agent does
the whole thing itself: chat, judge, fix, verify, commit. The coordinator's job is to dispatch,
independently verify, merge, and decide whether to respawn — not to read every transcript and make
every call itself.

Born from a real session (2026-07-11) where the operator asked for exactly this: *"do fast loops of
a quick chat to tmct... explore the data and evaluate, apply a fix, complete the background sub-agent
round report back into the main loop merge back in and respawn, running this alongside the other
benchmarks."* Three rounds ran live during that session, found and shipped two real routing fixes,
correctly declined to force-fix a structural gap, and surfaced two operationally important failure
modes (§4) that this doc exists partly to prevent from recurring.

> **Invoke it by telling a session:** *"Follow `SKILL_AGENT_FAST_LOOP.md` and run a fast loop
> [alongside <other work>] [for N rounds]"*.

---

## 0. How this differs from capped sprint mode (`SKILL_BENCHMARK_CONVERSATION.md` §3)

Capped sprint mode's own discipline is explicit: *"Delegate the CHAT, not the JUDGMENT"* — the
sub-agent hands back a raw transcript, and appraisal/fix/ship decisions stay with the coordinator in
the primary chat, visible to the operator turn by turn. That's the right shape when the operator
wants to watch the sprint happen.

This loop inverts that on purpose: the sub-agent does CHAT, REVIEW, FIX, and VERIFY itself, and only
reports a summary back. That's the right shape when the loop needs to run **unattended, alongside
something else the coordinator is actively tracking** (a benchmark batch in this session's case) —
the coordinator doesn't have spare attention to read every transcript live, so the round has to be
trustworthy enough to self-judge within a tight, low-risk brief (§1's bias-toward-not-fixing rule is
what makes that safe).

Both modes share the same dead-end vocabulary — reuse `SKILL_BENCHMARK_CONVERSATION.md` §0/§1's
FLOW/DEAD-END rubric verbatim, don't redefine it here. Use capped sprint mode when the operator wants
to watch; use this mode when the operator wants it running in the background while attention is
elsewhere.

---

## 1. The one-round recipe (what each round's sub-agent does, entirely on its own)

1. **CHAT.** A short, natural conversation — about 4 prompts — against a **fresh scratch copy** of
   an example fixture (`mkdir -p $(mktemp -d)/scratch && cp -r examples/<fixture>
   <scratch>/<fixture>`, never the committed fixture directly), driven via the real CLI
   (`printf 'q1\nq2\nq3\nq4\n/exit\n' | node bin/tmct.mjs chat --repo <scratch-path>`). Pick a
   genuinely different angle each round than prior rounds already tried — the coordinator's dispatch
   prompt must say explicitly what earlier rounds already covered, so exploration spreads rather than
   circling the same territory. Good angles to rotate through: general-knowledge/persona vocabulary,
   code-navigation, teach-then-infer, anaphora/pronoun follow-ups, quantity/counting, a multi-turn
   drill-down on one entity.
2. **REVIEW.** Label each turn FLOW or DEAD-END using `SKILL_BENCHMARK_CONVERSATION.md`'s own
   rubric (§0/§1b there): a dead-end is the grammar wall, "X isn't a term", "unknown qualifier", an
   honest-empty for something that should be answerable, an offered example that itself fails, or a
   broad question that should hit a capability that doesn't fire.
3. **FIX — only if small, scoped, and obviously correct.** Bias hard toward NOT fixing. If the root
   cause is structural (would need a real design decision, risks regressing an existing pinned case,
   or isn't confidently understood), report it honestly as a finding and move on — do not force a
   patch. This bias exists because this loop runs many independent rounds with no live human judgment
   between them; a bad fix in round 2 compounds into round 3's exploration silently. If a dead-end
   turns out to be routing correctly but answering with awkward or repetitive phrasing (not a wrong
   answer, just a stilted one), prefer extending `src/answer-variants.mjs`/`answer-variants.json`
   (the deterministic hit-template phrasing-variety system) over a routing hack — that keeps the fix
   scoped to wording, not behavior.
4. **VERIFY.** If a fix was made: run `npm test` **in the foreground and wait for the real count** —
   never end the round's turn by saying you're waiting for a background result. There is no external
   notification coming to a round's sub-agent; it must observe completion itself. Then re-run the
   exact same failing prompt(s) to confirm FLOW, not just that the test suite is green.
5. **COMMIT — only if a real, verified fix landed.** A clean round (nothing worth fixing) commits
   nothing — that's a legitimate, useful outcome, not a failure, and should be reported as such.

The round's final report to the coordinator: the actual prompts used and a one-line verdict per
turn, what was found and fixed (with a concrete before/after) or honestly flagged as structural, and
the real `npm test` count if code was touched. This must be a genuine final report — see §4 for what
happens when it isn't.

---

## 2. The coordinator-side loop (dispatch, verify, merge, respawn)

1. **Dispatch round N** as a background sub-agent with `isolation: "worktree"` (never a bare
   background agent sharing the coordinator's own tree — see §4's near-miss). The prompt is
   self-contained: the recipe in §1, a one-line summary of what prior rounds already found/fixed (so
   the new round doesn't retread ground), and the explicit "no external notification is coming, run
   things in the foreground and wait" instruction (§4).
2. **On the round's completion notification**, independently verify before trusting anything in the
   agent's own prose: `git -C <worktree> log --oneline -3` and `git -C <worktree> status --short`.
   Confirm a real commit exists if the report claims a fix; confirm the worktree is clean either way.
3. **Merge** the round's branch into `main` (check for staleness against `main`'s current tip first —
   fast-forward if the merge-base matches, a real merge otherwise), run `npm test`, clean up the
   worktree and branch.
4. **Decide: respawn or stop** (§3).

---

## 3. Stopping conditions — pick the one that matches why the loop was started

- **Tied to other concurrent work (this session's actual use).** Keep respawning after each merge
  until the other named work (a benchmark batch, a build) has fully completed — then let the current
  round finish, merge it, and stop. There is no fixed round count; the loop's lifetime is bound to
  the thing it's running alongside.
- **Round-cap / two-clean-rounds (borrowed from capped sprint mode, §3.1 there).** Use this instead
  when the operator asks for a bounded sprint with no other concurrent anchor: stop at a fixed round
  cap (default 3) or after two consecutive clean rounds, whichever comes first.

Whichever applies, report at the end: one line per round (what was tested, what was found, what
shipped or "clean round"), and an overall tally of fixes vs. clean rounds.

---

## 3.5 The scope boundary: local traps here, wider capability limits go to a `PLAN_*.md` doc

The operator's own framing, worth stating exactly: *"the fast loop should be exploring within edges
to catch the traps human visitors are likely to fall in, then benchmarking is the way we explore the
limit of a wider capability and decide where to push."* Two different tools, two different jobs:

- **This loop finds and fixes LOCAL traps within existing capability** — a routing gap, a missing
  phrasing variant, a small recognition miss. §1 step 3's bias-toward-not-fixing rule is what keeps
  it safe to run unattended: a round only ships when it's confident the fix is small and scoped.
- **The formal benchmarks decide whether and how far to push a WIDER capability forward.**
  `SKILL_BENCHMARK_CONVERSATION.md`'s full-ladder mode (§2 there) and the other three
  `SKILL_BENCHMARK_*.md` docs are where that decision's evidence comes from — a graded measurement
  across a whole tier or capability, not a single round's spot-check.

**When a round's investigation bottoms out at a genuine architectural question instead of a small
safe fix, that is the signal to stop investigating further in-loop.** Report the finding honestly
(§1 step 3 already says this), and write it up in a `PLAN_*.md` doc instead of trying another round
at it — the same graduation this repo already does for reasoning-engine research
(`PLAN_SYLLOGIST.md` holds what got pulled out of `PLAN_INFERENCE_TESTING.md` once it stopped being
a build-plan item and became an open design question).

**The first real example of this**: `PLAN_CONVERSATION.md`, born directly from this loop's own
rounds 2, 3, 5, and 6 (2026-07-11) — an adjective/noun teach-routing gap and a noise-stripping
fragility, both investigated as far as a single round safely could, both graduated out once the fix
needed touched shared, high-blast-radius machinery rather than one local routing rule. Read it for
the shape a graduated finding should take: precise mechanism, why it's out of this loop's safe-fix
scope, and a concrete (not vague) fix sketch for whoever picks it up next — not a full build plan.

---

## 4. Discipline — two hard-won lessons from the session this loop was born in

**A round's own "I'll wait for the notification" is never a real report — treat it as a failure to
finish, not a status update.** Multiple rounds this session ended their turn with some variant of
"I'll stop polling and wait for the monitor notification to arrive" — there is no such notification
for a subagent; it is the one being asked to do the work. Every dispatch prompt must say this
explicitly and instruct the agent to run commands in the foreground (or poll its own backgrounded
ones itself) and wait for genuine completion before ending its turn. When it happens anyway: check
the worktree directly (§2 step 2) before assuming nothing was done — several of these turned out to
have real, complete, uncommitted work sitting there.

**Never resume (`SendMessage`) a round whose worktree has already been auto-removed — relaunch fresh
instead.** The Agent tool auto-removes a worktree that ends with no changes. Resuming such an agent
was observed, live, to fall back to operating directly in the coordinator's own shared working
tree — once, this checked out a brand-new branch on the main worktree itself (caught immediately via
`git branch --show-current` returning something other than `main`; no work was lost, but it was a
real near-miss). The rule: before resuming any stalled round, check `git worktree list` for its
path — if it's gone, `TaskStop` that round and dispatch a fresh one instead (carrying forward
whatever real finding it had already reported in prose, so nothing genuinely valuable is lost), never
`SendMessage` it back to life.

Standing disciplines already covered elsewhere, still apply here: bias toward not fixing (§1 step 3);
verify every merge directly, never trust an agent's own "done" claim (`HANDOVER.md`'s Discipline
section documents the same lesson from an earlier session); commit locally as each round is verified,
but leave pushing to origin/npm as an operator-gated decision separate from this loop unless the
operator explicitly authorized it for this run.

---

## 5. One-paragraph TL;DR

A short, fully-delegated chat-explore-and-fix loop for running unattended alongside other work: each
round's own isolated-worktree sub-agent chats (~4 prompts, a fresh angle each time), judges FLOW vs.
DEAD-END against `SKILL_BENCHMARK_CONVERSATION.md`'s rubric, fixes only what's small and obviously
correct, verifies with a real foreground `npm test`, and commits only if it shipped something real —
unlike capped sprint mode, judgment is delegated too, not just the chat. The coordinator dispatches,
independently verifies via `git log`/`git status` before trusting any report, merges, and either
respawns (tied to a round cap, two clean rounds, or — this session's actual case — until the other
concurrent work it's running alongside finishes) or stops. Never trust "waiting for a notification"
as a finished report, and never resume a round whose worktree has already been auto-removed —
relaunch fresh instead. Catches LOCAL traps only — when a round bottoms out at a genuine
architectural question, that's the signal to graduate the finding into a `PLAN_*.md` doc (§3.5;
`PLAN_CONVERSATION.md` is the first one) rather than force another round at it; the formal
benchmarks are the tool for deciding whether to push a wider capability forward from there.
