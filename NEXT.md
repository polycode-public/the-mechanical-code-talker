# NEXT — current state & kickoff

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

## Open items

- [ ] operator: create the nightly scheduled pipeline in the GitLab UI (`e2e:heavy`, `dep:audit` and `renovate` key off `$CI_PIPELINE_SOURCE == "schedule"`)
- [ ] a fresh live-session miss-wall re-map at the new baseline
- [ ] a live-site crawl to give `PAGE_WEIGHTS.md`'s local-rebuild rows (chat, code, ingest) their deployed numbers
- [ ] PLAN_AGENTS.md gap items 1-5 (serve plan verb, external-proposal seam, four frozen rows, replan-on-drift, dormant seeds) — tmct-only, independent, ~a week combined
- [ ] PLAN_CODE.md Track 5 first milestone (planned two-step refactor, JS adaptor, verified, re-indexed) — sign-off-gated per that doc
- [ ] `chatbench/run.mjs`'s CLI defaults have drifted from `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1's prose: a bare invocation now defaults to dual-draw (not single), and the default stratified sample draws 92 cases, not the "109" the skill still names — see `BENCHMARK_CEFR_ENGLISH_2.11.0.md`'s timing note
- [ ] `g-c2-garden-1`'s garden-path parse is the sole hard fail at 2.11.0 (unchanged since 2.7.12) — see `BENCHMARK_CEFR_ENGLISH_2.11.0.md` decision log item 1
- [ ] `g-b2-count-temp-1`'s commit-undercounting bug is unchanged since 2.7.12 (verbatim same wrong answer) — see `BENCHMARK_CEFR_ENGLISH_2.11.0.md` decision log item 2
- [ ] two tier-1 `answerMatch` patterns have drifted from current product copy (`be-honest-empty`, `conv-hello-there`) — both score well under the judge, so this is case-hygiene, not a regression — see `BENCHMARK_CEFR_ENGLISH_2.11.0.md` decision log item 5
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #3: "k what abt users.mjs"-shaped casual fragments are silently taught as garbage facts — the bare-declarative teach lane needs a positive test excluding interrogative/imperative/fragment shapes before it accepts anything, not another one-off phrase fix
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #1: a sentence opening with "I" ("I am new here", "I want to know X") misparses as a teach attempt about the pronoun "i" instead of being read as an ordinary opener
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #2: the "are you an LLM / what model are you" family still misroutes under casual phrasing outside the closed set (three fresh wordings this cycle)
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #4: internet/web-access capability questions ("can you browse the web") misroute into a module-name search instead of a clean offline decline
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #5: a non-sequitur identity blurb fires instead of a targeted decline for nonsense input or a fuzzy-matchable typo (recurrence of 2.7.11 #28)
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #6: casual farewells with "thanks" but not "bye" ("gtg thx") don't register as a close (recurrence of 2.7.11 #20)
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #7: small-talk/opinion questions wall inconsistently — only one exact phrasing of "how are you" gets the on-brand no-feelings decline
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #8: "can you make up an answer if you don't know" — a direct test of the honest-miss promise — walls instead of confirming it on-brand
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #9: "prove that X is Y" still unrecognized despite "is X a Y" proof machinery working (recurrence of 2.7.11 #13)
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #10: "my cat is called whiskers" (naming an individual) misroutes into a code `calls` relationship query
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #11: teaching a term ending in "s" silently singularizes it, breaking later recall (recurrence-class of 2.7.11 #12)
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #12: "does X have Y" (has-property) routes into the code `defines` relation instead
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #13: "the Task" (definite article before a real class name) isn't recognized even though "Task" is
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #14: the broad "detailed summary" completions question walls under a near-miss non-native phrasing though the exact wording passed in 2.7.11
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #15: "used anywhere" open-existential usage questions give an unclear answer where the bounded-pair "used by Y" phrasing gives a crisp yes/no
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #16: "whats X do" (dropping "does") fails to resolve even for a real, indexed function
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #17: "what about X, what he/it do" sometimes silently answers the reverse relation instead of the forward one
- [ ] `BENCHMARK_CONVERSATION_2.11.0.md` #18: a filler/colon-led preamble before a real teach sentence breaks parsing of an otherwise-supported shape
- [ ] `CAPABILITIES_2.11.0.md` row 210: `tmct_ingest` and `tmct_export` (shipped this cycle) are declared and dispatched but sit outside both the capability registry and `EXCLUDED_FROM_REGISTRY` — the same gap `tmct_related` had before its 2.7.12 fix (`96d40fe`/`e5f84e1`); register them or exclude them by name

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

4. Concurrent chat.mjs agents work when each brief pins its region (learn-on-miss block /
   logLines + slash commands / factReadBackReaders) and forbids refactors — but the merge gate
   must still rebuild the ask bundle (it inlines chat readers, so it drifts on every reader
   change), re-run the pack-manifest check (three separate agents forgot new `src/` files in one
   day), and watch for same-name declarations across branches (two batches both coined
   `spiderFlyContextAnswer`; esbuild's duplicate-symbol error at bundle time was the catch).
   Seed-content-dependent e2e pins are the other recurring merge hazard: raising the seed caps
   silently grounded the learn-on-miss demo's lookup term, and the sense-split chain rendering
   broke a source-adjacency pin — the fix each time is a probe against the real store, then the
   pin follows the behavior.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
