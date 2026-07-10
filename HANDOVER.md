# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative, including the full detail of
the 2026-07-10 uplift batch (largest single session to date). This file holds only what to do next —
no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-10, later same day)

`v1.5.5` is the current version. `v1.5.3` is what's actually live on npm (pushed and published this
session, containing an `ace-owl` dependency fix — see below). Since that push: three more ranked
follow-ups closed (completions `graphService` wiring, the teachLane silent-failure, and the
stranger first-turn preamble — see the closed-out list below), each built by an isolated background
sub-agent and merged clean with no conflicts. `npm test` is green at 1756 (was 1740 at the last
push).

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

1. **`scm-svf`/cardinality monotonicity** (`PLAN_INFERENCE_TESTING.md` stage 4's remainder) —
   still confirmed unmeasurable against the current INF-C1 fixture (steady at 90%, unrelated to
   what either rule would fix); revisit only if a future case-generation pass adds a template that
   actually exercises them.

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

## Proposed: a default human-world persona (not built, a suggestion for next session)

Today `tmct init` ships with one persona (`PERSONA_PRESETS.code`) and a thin tier2 `general`
corpus (49 facts, ~10 root concepts: dog/cat/bird/fish/mammal/animal, rain/weather, a handful of
IsA/HasA/CapableOf/HasProperty/AtLocation/MadeOf edges — `corpus/tier2/general.jsonl`). That's a
seed, not a default persona. A repo that never asks `--corpus`/`--with-persona` gets no everyday
world knowledge at all, only code-domain SEON facts.

**Lexicon.** Widen `general.jsonl` past animals and weather to cover the categories a person
actually talks about day to day: people and roles (parent, friend, doctor, teacher), places
(house, city, school, kitchen), time (morning, week, yesterday), quantities (few, many, dozen),
common objects and tools (chair, knife, phone, book), food, the body, family relations, and
emotions/wants (happy, hungry, want, need). Aim for breadth over depth — a couple of relations per
concept, not an exhaustive tree.

**Ontology.** Add a lightweight top-level split alongside SEON's existing code-domain classes,
reusing the same relation vocabulary already in `general.jsonl` (`IsA`, `HasA`, `HasProperty`,
`CapableOf`, `AtLocation`, `MadeOf`) rather than inventing new ones: `Person`/`Agent`, `Place`,
`Object`/`Artifact`, `Event`, `Time`, `Quantity`. Root everything under the same `Thing` SEON
already anchors code concepts to, so a class-membership question ("is a dog a mammal") and a
code-membership question ("is `HttpError` an `Error`") walk the same inheritance-chase logic tmct
already has, not two parallel systems.

**Corpus set.** A few hundred curated facts across 15-20 root categories, built the same way the
existing `aws`/`python`/`java`/`general` tier2 bundles were: hand-curated, deterministic,
MPL-2.0-licensed JSONL, generated via `corpus/tier2/generate.mjs`, never scraped or LLM-generated
at build time (keeps the $0-offline, no-LLM-in-product-path guarantee intact). Ship it as either a
grown `general.jsonl` or a new `human-world` tier2 id, then add a `PERSONA_PRESETS.default` (or
similar) entry that activates it with a real bias weight, so `tmct init` with no flags at all can
optionally point at it once the operator decides it should be the shipped default rather than an
opt-in.

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

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped before the items above, including this session's own dated entry in full.*
