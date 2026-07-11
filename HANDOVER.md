# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative, including the full detail of
the 2026-07-10 uplift batch (largest single session to date). This file holds only what to do next —
no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-11)

`v1.5.6` is the current version (not yet pushed — `v1.5.3` is what's live on npm). Since the last
push: three ranked follow-ups closed (completions `graphService` wiring, the teachLane
silent-failure, the stranger first-turn preamble), then a much larger batch — **the default
human-world persona (all three size tiers), a unified CLI/config model, new memory persistence
backends, and `scm-svf`/cardinality monotonicity all shipped**, built by 4 concurrent background
sub-agents in isolated worktrees and merged one at a time (4 real conflicts resolved by hand where
two agents touched the same file — see `PLAN_SEED.md`'s status header for the exact conflicts and
resolutions). A follow-up batch then closed out every item that batch had left open: Medium (1,608
facts) and Large (13,609 facts) persona tiers, the `createSession`→`initRepo` auto-init convergence,
and the premise-derived trust hook for the three newest inference rules
(`scm-svf1`/cardinality-monotonicity/`cax-maxc0`). `npm test` is green at **1864** (was 1740 at the
last push). Full design and current build status for the persona batch lives in `PLAN_SEED.md` —
read its status header first, not this file, for that narrative.

**Two plans fully shipped and archived this session**: `archive/PLAN_INFERENCE_TESTING.md` (all 6
stages done, its two stale status lines corrected with real numbers before archival, its still-open
speculative research on RETE/incrementality and retraction-aware reasoning extracted into a new
`PLAN_SYLLOGIST_HORIZON.md` so that research isn't lost) and `archive/PLAN_COMPLETIONS.md` (all 4
staging rows done). Cross-references to both in living docs (`ROADMAP.md`, `PLAN_CODE.md`,
`PLAN_AGENTS.md`, `SKILL_BENCHMARK_CONVERSATION.md`, `SKILL_BENCHMARK_INFERENCE.md`) now point at
their `archive/` paths.

**README.md/the GitLab Pages homepage refresh is in flight** — a background agent is updating both
to document the default persona (`--persona-size` flags), the unified CLI (`tmct import`, the
single-value-per-flag caveat, `npm run init:large`), and the completions pipeline (both the
chat-triggered "detailed summary of how X works" phrasing and a verified JS/programmatic example),
following `SKILL_AGENT_PLAIN_PROSE.md` §3's shop-window discipline. Not yet merged as of this
writing — see "Open follow-ups" below for what happens once it lands.

**A real incident this session: the `ace-owl` extraction and its revert.** An earlier session
(2026-07-10, commit `c57adbe`) extracted `src/grammar/ace.mjs`/`lexicon.mjs` into a new npm
workspace (`packages/ace-owl`) and pointed tmct's own `package.json` at it as a registry
dependency — but never published the package. That broke `npm install` of tmct for anyone outside
this workspace (a 404 on the unpublished dependency) for five days before it was found and fixed
this session. Reverted on operator instruction: the parser is back in `src/grammar/` as the real
implementation, the workspace and dependency are gone, verified with a real `npm pack` + fresh
install in an empty folder. See `ROADMAP.md`'s "Open-source the ACE-OWL parser" entry and
`PLAN_AGENTS.md` for the full account.

## Open follow-ups

1. **Wait for the README.md/homepage refresh agent, then merge it.** Dispatched sequentially, after
   the two content workstreams below were already merged and verified — an earlier concurrent
   dispatch of this same agent was blocked by the auto-mode safety classifier (its denial reasoning
   described a different sibling agent's content-authoring scope, not this one's docs-only brief);
   rather than work around the block, the run was re-sequenced solo per operator instruction
   ("proceed that way"). Once it lands: verify its worktree's real `git log`/`git status` directly
   (per the lesson below — never trust an agent's own "done" prose alone), merge, run `npm test`,
   clean up the worktree/branch.
2. **Backend C (SQLite)'s read side** does a full payload reconstruction per call (an explicitly
   permitted shortcut in `PLAN_SEED.md` §6) — measured 8% slower than flat JSON at the Large tier's
   scale, faster below it. Closing this needs real indexed query handles, not more diffing.
3. **`PLAN_SYLLOGIST_HORIZON.md`'s one genuinely open research question** (retraction-aware
   consistency under a hard budget + trust tiers) has a speculative sketch but no implementation —
   next up only if the operator wants to push the reasoning engine further; not a near-term default.

The persona batch itself (Small/Medium/Large tiers, the auto-init convergence, the trust-hook gap,
both plan archivals) is now fully closed — see "The default human-world persona" below and
`PLAN_SEED.md`'s status header for the full account, not this list.

**`scm-svf`/cardinality monotonicity — DONE this session** (commits `07b8035`, `1110488`, `304a16c`,
merged clean, verified live by the coordinator, not just trusted from the agent's report). Built
`scm-svf1` (someValuesFrom restriction subsumption — W3C OWL 2 RL Table 9), cardinality
monotonicity ("every X has exactly 3 Ys" ⊢ "every X has at least 2 Ys" — confirmed genuinely
outside OWL 2 RL's own decidable profile, so this is a bespoke live-chase-only rule, never
batch-materialized), and `cax-maxc0` (max-0 as encoded negation, grounded in `cls-maxc1`'s ABox
contradiction rule via a one-step universal generalization). All three wired into live chat.
INFBENCH: kernel arm 100% (80/80), chat arm 99% (216/219, the 3 non-passing rows the same
pre-existing unrelated "unclear max0" quirk, confirmed untouched). `npm test` 1756→1780 in this
workstream alone. **Live-verified by the coordinator directly** (not just the agent's own tests):
"every cat has exactly 4 legs" then "does every cat have at least 2 legs" → yes, with the
entailment named; "every cache has at most 0 risks" then "does a cache have a risk" → no, proven
not guessed. One incidental fix found and closed along the way: `infbench/generate-cases.mjs`'s
`LEXICON_PATH` was still pointing at the removed `packages/ace-owl/` workspace from this session's
own `ace-owl` revert — a real, blocking bug, unrelated to this task but caught and fixed anyway.

**Closed out this session** (each built by an isolated background sub-agent, merged clean, verified
live by the coordinator against real merged `main` before being marked done — not just trusted from
the agent's own report):

- **`src/completions/`'s search layer now has a real `graphService` adapter**
  (`src/completions/graph-adapter.mjs`, commit `798a77f`). "Give me a detailed summary of how X
  works" now answers on a subject's first mention in a session, grounded in the graph/taught Facts,
  not just pre-seeded memory blocks. Verified live for `src/core/store.mjs` and `TaskController`.
- **The teachLane silent-failure is fixed** (commit `245b3af`). Root cause: `OWNS_TEACH_RE`'s bare
  gate required the OWNER's name capitalized (missed "sam owns TaskController" — lowercase owner);
  `generalVerbTeach` had no bare (unwrapped) path at all. Fixed both, gated the new bare path on a
  real POS check (`subjectIsNounOrPropn`, via wink-nlp) so imperatives like "tell me a joke" still
  correctly decline instead of being mistaught. Verified live: both repro sentences now store and
  are retrievable ("does sam own TaskController" → yes).
- **A stranger's first turn now gets an orientation card, not the raw wall** (commit `68d0d27`).
  "hey, first time trying this out - what is in here?" resolves via a widened preamble regex plus a
  new no-standing-focus fallback. One flagged side effect, confirmed intentional: the bare "hey what
  is in here" case also improves (pronoun-miss → orientation card), since both phrasings reduce to
  the same shape after stripping. An existing focus still resolves exactly as before — verified live.

**Dropped by operator decision (2026-07-10): the farewell/thanks clause-length guard.** "brilliant,
that's all I needed" still trips the guard's 3-word-per-clause limit, but this is deliberately out
of scope now, not deferred. Elaborate goodbye phrasing is low value and risks making the hang-up
itself ambiguous — a short, clear close beats a clever one. Don't add farewell-phrasing cases to
future benchmark sprints either; see `SKILL_BENCHMARK_CONVERSATION.md` §5 for the standing note.

**Dropped by operator decision (2026-07-10): confirming AGENTBENCH stays byte-identical to `0.8.2`.**
Not tracked as a follow-up any more; revisit only if something near the router/goal-reasoner
actually changes.

**Dropped by operator decision (2026-07-10): re-judging CHATBENCH for the A2 naming-vocabulary
fixes.** The two fixes (`g-a2-naming-2`, `g-a2-naming-6`) already pass tier-1. Running the graded
judge is the operator's call to make when they want it, not a standing follow-up.

**The stale git worktrees are gone.** 13 of the original 15 were already merged and gone by the
time this session checked; the operator removed the remaining 2 directly (2026-07-10). Those 2 had
unmerged CHATBENCH 0.8.0/0.8.1 report commits (`2b724fd`, `3fdc983`) on branches
`worktree-agent-a162c165a7ce6bca6`/`worktree-agent-a3a54d6e7c5ef9172`, still in the branch list —
if those reports still matter, pull them from those branches or `git reflog` before pruning the
branches too.

**Everything else from the prior "Open follow-ups" list (items 1–12: C2 pronoun-binding, the
farewell/thanks closed-set generalization, the teach-refusal message + recall gap, `cls-svf1`'s live
wiring, "who last touched X", the A2 naming-vocabulary hard fails, wiring `src/completions/` into
dispatch at all, the trailing "then" filler, the has-a-method teach shape, the batch of smaller
parsing gaps, and the chat-surface debt re-measure) is DONE, committed, and confirmed regression-free
by the post-merge full CHATBENCH/INFBENCH re-run above — see `git log --oneline` for the individual
commits, each referencing its item number.**

## The default human-world persona — SHIPPED, all three tiers, full detail in `PLAN_SEED.md`

What was a proposal earlier this session is now built and merged, all three size tiers: `tmct init`
with no flags seeds a genuine everyday-knowledge persona by default (Small: 664 curated facts across
9 clumps, a lexicon grown from 291 to 650 words, 120 real WordNet-sourced example sentences, plus a
working cross-ontology bridge test proving `scm-sco` can chain WordNet's and Schema.org's
independently-built taxonomies together). SEON/ConceptNet are opt-in now (`--with-persona code`),
not default. `tmct init --persona-size medium|large` selects Medium (1,608 facts, 476 example
sentences) or Large (13,609 facts, genuine multi-hop hypernym chains up to 4 real WordNet hops,
2,404 example sentences) — both built by ranking real WordNet candidates by sense-count as a
commonness proxy, not hand-typed. The `createSession`→full-`initRepo` auto-init convergence also
landed: a programmatic `runChat()`/`createSession()` call on a bare directory now runs the same full
`initRepo` path as CLI `tmct init`, leaving a real `tmct.toml` + `.tmct/init.json`, not just an
in-memory seed marker. Read `PLAN_SEED.md` for the full design, the real numbers vs. targets, and
every conflict resolved during the merge — this file doesn't repeat that narrative, per its own
discipline.

**One item stays a documented, cross-repo-only note, nothing left to action here**: if seonix's own
chat surface goes through `runChat`/`createSession`, its `tmct.toml` needs to explicitly re-activate
SEON/ConceptNet now that tmct's own default has flipped. Backend C (SQLite)'s read-side perf gap is
tracked in "Open follow-ups" above, not repeated here.

## Discipline (unchanged)

**Working model: coordinator + background sub-agents** (copied verbatim from this repo's own
`CLAUDE.md` on 2026-07-10, at the operator's request, so it's visible directly in this file too):
run big tasks in concurrent background sub-agents and keep the main chat free — the main session
is the COORDINATOR (plans, launches, integrates, answers the operator), not the worker. Decompose
into workstreams with clear file-ownership boundaries; serialize on shared files (one agent owns
`package.json`, `src/`, `bin/`, `test/` sequences; docs/site tracks run in parallel). Keep the chat
for chat: anything long-running (benchmarks, judge passes, builds, test sweeps) executes as a
BACKGROUND task at maximum safe concurrency (the chatbench judge defaults to `--concurrency 12`);
the main session launches it, keeps coordinating and conversing, and collects results on the
completion notification — never block the conversation on a run. Push/publish is gated on the
operator (CI publishes on version bump on `main`). Version bump timing: only bump the version at
the moment of actually pushing a release, never pre-staged and left sitting unpushed between
releases — `package.json`'s version should always equal whatever's actually live on npm between
pushes.

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions. **A hard-won lesson from this
session**: background sub-agents sharing one working tree (no worktree isolation) can and did run
destructive/shared git operations (`git stash`) meant only for the coordinator — twice, both
recovered without loss, but now explicitly called out in every dispatch brief: sub-agents may only
`git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`. Also:
the harness's permission system blocks `git commit` for *background* sub-agents entirely in some
configurations (no live user to approve a permission-gated action) — the coordinator does the
committing itself in the foreground when this happens, verifying `git status` immediately before
every stage to avoid sweeping in another track's pre-staged files (a real near-miss this session,
caught and fixed before it landed). No LLM in the product path, ever.

**A second hard-won lesson (this same later session, the 4-agent persona batch)**: a background
sub-agent's own final "completed" notification is not reliable proof it actually finished — one
agent reported a vague "I'll wait for the Monitor notification" message as its terminal output
(twice, on resume), when its worktree in fact held complete, real, committed work. Always verify via
`git log`/`git status` on the agent's own worktree directly before deciding whether to resume it or
treat it as done — trust the commits, not the prose. An agent stuck repeating the same "still
waiting" message across multiple notifications is a sign to `TaskStop` it explicitly rather than
keep resuming, once its worktree confirms the real work is already complete.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped before the items above, including this session's own dated entry in full.*
