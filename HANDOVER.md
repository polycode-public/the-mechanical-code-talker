# HANDOVER — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md`
reports and `CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Version state (2026-07-18)

v2.7.11 in the working tree: the adventure dead-end routing fixes, the spider-and-fly game
(`archive/PLAN_SPIDER_FLY.md`, fully built), the TOOL-7/TOOL-8 router uplift, and a 5-round
adventure-focused playtest edge hunt (`playtests/PLAYTEST_LOG_003.md` through `_007.md`) have
all landed since 2.7.0, pipelines confirmed green at every round.

Measured init sizes (fresh store, this machine): `init:large` 37,797 facts; `init:xl` 72,075
(16.6s); `init:xxl` 238,866 (38.5s). `init:xxxl` stays undocumented-as-code (bulk ConceptNet
download, not reachable from data in hand).

## Open items

The 2.7.0 wave is fully delivered and integrated: the adventure (Ashcombe Hall as a lazy worlds
pack, imperative grammar, NPC scheduler, the worked example passing), the child triples pack
(93k facts wired into the clean-miss cascade ahead of the reference article, triples first and
prose second), the 16 re-baselined pool regressions fixed with 11 sibling rows flipping green
alongside (pool 964 passing / 111 frontier), and the small remainders (world trust tier, locative
asides through the world fold, the plural-object fold, the impact summary). `archive/` holds the
delivered plan docs; each records what its delivery deliberately did not include. What remains:

- CONVERSATION persona-sweep backlog (`BENCHMARK_CONVERSATION_2.7.11.md`): 29 fresh findings
  across 6 personas, ranked in the report. In progress, worked in the report's priority order:
  - **Closed**: the write-boundary recurrence (finding #1/#2) — the bare-declarative teach lane now
    excludes discourse-filler openers ("umm"/"idk"/"hmm") and imperative-command leads ("repeat",
    and the wrapped "remember to …" infinitive shape) via a closed NON_DECLARATIVE_OPENER_RE plus a
    symmetric closed-class subject guard in generalVerbTeach, mirroring the existing verb-slot guard.
  - **Closed**: all 5 instances of tmct's own suggested-repair text being broken (finding #1) —
    the "is X used anywhere" routing gap (keyword-spot now resolves a bare passive with no "by"
    agent, guarded so the protected "used for" idiom stays untouched); the "venomous" adjective
    mangled through noun-singularization (singularizeSurface excludes "-ous" endings, and the
    existential-teach suggestion picks the bare property shape over a forced article); "any" now
    joins every/each/all as a recognized universal-quantifier synonym; and a trailing sentence-final
    period no longer breaks bare teach sentences ("every dog is a mammal.", "rex is a dog." both
    teach correctly now — BARE_DECLARATIVE_RE and UNKNOWN_SUBJECT_RE both get the same `[.!?]*`
    tolerance TEACH_RE/EXISTENTIAL_CLASS_TEACH_RE already had). This was never word-specific to
    "mammal": any bare teach sentence ending in punctuation, naming a word outside the ~180-word
    static lexicon, hit the same gap.
  - **Closed**: the meta-question misroute cluster (finding #3, 10 instances) — a returning user's
    "does this remembered feature still work" questions (/focus, /forget, /stats, compare, session
    persistence) now get the real, honest answer instead of a teach-parser misfire, via a new
    META_COMMAND_ANSWERS table; three more mechanism/capability phrasings ("do you use classical
    logic", "what model are you built on", "can u browse the internet") join AI_IDENTITY_PHRASES;
    "can u help me with smth" joins CAPABILITY_PHRASES.
  - **Closed**: all four reasoning-layer gaps — the disjointness veto now walks the query OBJECT's
    own superclass chain too (was subject-only), with a self-contradiction guard so a genuinely
    contradictory taught pair still gets the existing inconsistency refusal rather than a false
    confident "no"; the negative-universal teach frame generalizes from "no X is Y" to "no X can Y"
    (the read side already resolved it correctly — only the write-side recognizer was missing);
    2-hop taught property inheritance now explores every ⊑-parent breadth-first instead of
    committing to whichever the fact list happened to list first (this was silently breaking in
    any ordinary SEEDED session, not just the unseeded one the pre-existing corpus test covered —
    a subject with both a seeded and a taught parent class could walk the wrong branch and miss a
    real answer); and a directly-taught comparative contradiction ("disk-2 is smaller than disk-1"
    taught right after the reverse) is now disclosed in the ask-time answer, not just silently held.
  - **Still open**: the remaining single-persona findings — filler-clause prefixes, the GUI wording
    leak, the did-you-mean branch-preview mislabel, silent narrowing, plan-justification follow-ups,
    optimality-as-count, session-sidecar verbatim rewrite, and the smaller wall gaps (item 5 of the
    report). Full ranked list and routing in the report; each closed item above has a regression
    test in `test/corpus/inference.jsonl`, `test/corpus/grammar.jsonl`, `test/corpus/planning.jsonl`
    or `test/corpus/templates.jsonl`.

## Discipline

`CLAUDE.md` is the standing working model: the coordinator/background-sub-agent split, the test
blast radius, the versioning and push rules, and the repo-local identity. Read it there. This
section holds only what `CLAUDE.md` doesn't.

Three hard-won lessons, carried forward:

1. Background sub-agents sharing one working tree (no worktree isolation) can and did run
   destructive/shared git operations (`git stash`) meant only for the coordinator — recovered
   without loss, but now explicitly called out in every dispatch brief: sub-agents may only
   `git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`.
   Also: the harness's permission system blocks `git commit` for *background* sub-agents entirely
   in some configurations (no live user to approve a permission-gated action) — the coordinator does
   the committing itself in the foreground when this happens, verifying `git status` immediately
   before every stage to avoid sweeping in another track's pre-staged files. (Re-proven 2026-07-15:
   a `git add -A` swept another session's untracked design doc into a commit — caught and amended
   out. List paths explicitly, or review `git status` line by line first.)

2. A background sub-agent's own final "completed" notification is not reliable proof it actually
   finished — an agent reporting a vague "I'll wait for the Monitor notification" as its terminal
   output is a sign of unfinished work, not a status update, even when its worktree in fact holds
   complete, real, committed work. Always verify via `git log`/`git status` on the agent's own
   worktree directly before deciding whether to resume it or treat it as done — trust the commits,
   not the prose. An agent stuck repeating the same "still waiting" message across multiple
   notifications is a sign to `TaskStop` it explicitly rather than keep resuming, once its worktree
   confirms the real work is already complete.

3. Never resume (`SendMessage`) a round whose worktree has already been auto-removed — relaunch
   fresh instead. This was observed twice: once an agent fell back to operating directly in the
   coordinator's own shared working tree; on a later occasion this went as far as checking out a
   brand-new branch on the shared worktree itself (caught immediately via `git branch
   --show-current` returning something other than `main`, no work lost). The rule: before resuming
   any stalled round, check `git worktree list` for its path
   — if it's gone, `TaskStop` that round and dispatch a fresh one instead, never `SendMessage` it
   back to life.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
