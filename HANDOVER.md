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

v2.7.14 in the working tree: the adventure dead-end routing fixes, the spider-and-fly game
(`archive/PLAN_SPIDER_FLY.md`, fully built), the TOOL-7/TOOL-8 router uplift, a 5-round
adventure-focused playtest edge hunt (`playtests/PLAYTEST_LOG_003.md` through `_007.md`), a taught
fact-value rule shape retiring open/close's hand-checked lock/open-state logic, 4 fresh benchmark
reports plus `CAPABILITIES_2.7.12.md`, spider-fly ecology v2 (wander, spider-vs-spider avoidance,
dynamic webs, mass symmetry — `PLAN_GAMES_UPLIFT_V2.md` Part A), an adventure graphical presence
and goal-inferring auto-play (Part B), and 15 of the CONVERSATION backlog's 29 items have all
landed since 2.7.0, pipelines confirmed green at every round. A second, 10-round playtest edge hunt
(5 adventure, 5 spider-fly) targeting everything built since the first hunt is now underway
(`playtests/PLAYTEST_LOG_008.md` onward).

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
  - **Closed** (item 5, the single-persona findings — fixed what was cheaply tractable): the web
    GUI's "click a node first" wording no longer leaks into this plain chat surface on a failed
    focus resolution (a plain string swap on ask()'s shared miss text, not a change to the GUI's own
    correct answer); "is that really the minimum number of moves?"/"could there be a shorter plan
    than that?" now confirm from the planner's own breadth-first-search guarantee instead of landing
    in the unrelated code-entity counter; "why is that the shortest solution?" re-displays the same
    "because — …" line the planner already prints unprompted at solve time (stored on the plan slot
    now, not discarded after the first print); the did-you-mean branch-preview auto-expansion covers
    every candidate (the nearest-neighbour candidate's own preview was silently missing) and each
    preview's own text names its OWN candidate, never the original ambiguous term; and "whats 2+2"
    gets an honest "I don't do arithmetic" decline instead of the non-sequitur identity blurb (a
    digit-operator-digit signal that deliberately excludes "-", since this domain's own dates and
    file/line ranges are digit-hyphen-digit too).
  - **Still open, named explicitly (item 5 remainder — genuine horizons, not forced)**: filler-clause
    prefix widening (the report identifies one root cause behind several surface symptoms — "ok so",
    "oh nice. um what about", "one more random thing," — but widening the existing short-prefix
    stripper to longer clause shapes without over-matching real content needs its own design pass);
    silent narrowing without disclosure ("the router" resolving to the Router class over the
    router.mjs module, a directory reference narrowing to one of several members) — needs a design
    decision on how/where to surface the narrower reading, not just a string tweak; plan-justification
    counterfactual and alternative-choice questions ("what if disk-1 started on peg-c instead?", "why
    did you send crate-c to a pallet instead of stacking it on crate-b?") — these ask the planner to
    explain a path it did NOT take, which the current BFS never computes at all (a genuinely separate,
    larger feature than the "why is that the shortest" fix just landed); the session sidecar/log
    still rewrites verbatim natural-language input to the canonical form matched (a recurrence of a
    previously-known, still-open item); and the smaller wall gaps not yet investigated — "give me the
    big picture on this codebase", "tell me about the router thing", "what is the entry point"/"where
    do i start reading", "what is the purpose of the validate module", "whats the most important
    file" (a superlative with no default ranking criterion), casual/longer farewells. Full ranked list
    and routing in the report; every closed item above has a regression test in
    `test/corpus/inference.jsonl`, `test/corpus/grammar.jsonl`, `test/corpus/planning.jsonl` or
    `test/corpus/templates.jsonl`.
- Adventure edge-hunt round 1 of the second (10-round) hunt (`playtests/PLAYTEST_LOG_008.md`): a
  direct "is X open/closed" question reported a fully-known, negative container state as an
  epistemic gap ("I don't have a fact saying...") instead of answering "no, it's closed" — the
  generic ask engine has no adjective→datatype-predicate mapping for `mgx:is-open`, a predicate this
  session's own rule-shape retrofit introduced. Fixed this round: a new `worldOpennessAnswer` aside,
  styled after the existing `worldWhereAnswer`, reads `state.openness` directly. Shipped.
- Spider-fly edge-hunt round 1 of the second hunt (`playtests/PLAYTEST_LOG_009.md`, the game's first
  ever dedicated playtest): an eaten fly's stale pre-death goal line ("trapped in an active web —
  can't move") sat right beside the same turn's own "fly-X was eaten" event text, contradicting it,
  because `tick.agents` is built during movement, before `runEcologyPass` resolves eating. Fixed this
  round: the eaten/starved fly is dropped from `agents` and the eating spider's goal now says "just
  ate X in the web" instead of the now-false "co-located with X". Shipped.
- Adventure edge-hunt round 2 of the second hunt (`playtests/PLAYTEST_LOG_010.md`): auto-play and
  the graphical renderer, driven directly (neither has a chat-CLI surface by design), both confirmed
  correct — no fix needed.
- Spider-fly edge-hunt round 2 of the second hunt (`playtests/PLAYTEST_LOG_011.md`): the SAME class
  of bug round 1 fixed, one level removed — a THIRD agent's goal (computed at movement time) can
  keep naming a subject that dies later in the SAME tick's ecology pass, e.g. a fly "evading — last
  saw spider-1" the very turn spider-1 starves. Fixed this round: every remaining agent's goal is
  scrubbed of any died-this-tick reference before the existing eaten-pair handling runs. Shipped.
- Adventure edge-hunt round 3 of the second hunt (`playtests/PLAYTEST_LOG_012.md`): `mgx:is-objective`
  — the new internal marker auto-play's goal inference reads — leaked into the plain "examine" digest
  as a raw, unphrased triple ("Letter mgx:is-objective true."). Fixed this round: added to the
  digest's existing `VIEW_EXCLUDED_PREDICATES` set; the underlying fact rows (and auto-play's own
  direct read of them) are unaffected. Shipped.
- Spider-fly edge-hunt round 3 of the second hunt (`playtests/PLAYTEST_LOG_013.md`): a spider that
  eats two flies co-located on the same cell in one tick only credited the LAST one in its own goal
  line (the round-1 fix overwrote the goal once per eaten pair). The main event text was always
  correct for both; only the goal-line summary collapsed them. Fixed this round: eaten pairs are
  grouped by spider first, so the goal names every fly eaten that tick. Shipped.
- Adventure edge-hunt round 4 of the second hunt (`playtests/PLAYTEST_LOG_014.md`): `examine <the
  room you're standing in>` declined "I don't see X here" as if the room didn't exist — a room is
  never the SUBJECT of a placement fact (only ever the object other things are placed in), so the
  shared examine/talk presence check could never match it. Fixed this round: naming the current
  room bypasses the presence check, the same way a carried object already does. Shipped.
- Spider-fly edge-hunt round 4 of the second hunt (`playtests/PLAYTEST_LOG_015.md`): the SAME
  movement-before-ecology seam rounds 1-3 fixed for goal text, now caught on mass — the eating
  spider's own returned `tick.agents[spider].mass` stayed at its stale pre-eat movement-phase value
  for the exact tick it ate, even though the store's own written fact was already correct. Fixed
  this round: `runEcologyPass` now exposes the true post-eat mass on its `events` object, and the
  existing eaten-pair loop reads it into `agents[spider].mass`. Shipped.

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
