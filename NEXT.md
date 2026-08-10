# NEXT — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded directly in its
own Open items entry (see the next paragraph for how). Prefer deleting a sentence to negating it.

**A bug found while fixing item A is A's remainder, not a new item.** Write it as a sub-clause of
A's own entry — what's fixed, what's still open — and leave A's checkbox open until the sub-clause
closes too, even if the sub-clause itself is deferred. Only promote it to a genuinely separate item
when it's actually unrelated to A's own scope (a different file or subsystem entirely), and say so
explicitly when you do. Closing A outright and opening a freshly-labeled item for the same discovery
is stalling dressed as progress: the open-item count looks flat or improved, but the record now hides
that A was never actually finished. (Landed 2026-08-01 after doing exactly this: a track's own
seed-fetch-retry fix got marked done and its test-coverage gap got logged as a brand new item,
until corrected.)

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log` and the
`reports/BENCHMARK_*.md` reports hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] **A pluggable memory-backend seam, built against bedrock-meter's spec, consumed by
  news.html** — `../bedrock-meter/GRAPH_BACKEND_SPEC.md` (untracked, carried by the operator)
  asks tmct to own the seam their S3-archive shim fakes today: `createSession`/`runTurn`
  accept an injected backend object; the interface serves their seven access patterns
  (append, read-by-term without whole-store scans, touched-facts, bookkeeping behind the
  seam, bounded enumeration, supersession, structural exclusion of bookkeeping rows) under
  their operational budget (stateless open, O(rows-touched) turns, per-fact atomicity,
  row-level concurrency, opaque session keys, TTL pass-through, determinism, lazy SDK); tmct
  ships a conformance suite the sqlite backend passes (precedent: the repository-interface
  conformance kit and the `./conformance` export). news.html becomes the second consumer
  over an IndexedDB backend. Design landed: `PLAN_MEMORY_BACKEND.md` (row-backend interface
  with `rowClass` as the §3.7 structural exclusion; the pk/sk term index settled now but
  dormant in v1; phases M0-M7 tiered, with the sqlite refactor flagged as the risky phase
  behind a byte-identical-storage pin). Execution starts when the phrase-fix worktree frees
  chat.mjs — M0/M1/M3 serialize there.
- [ ] **bedrock-meter's embedded-path findings (inbox, 2026-08-09/10)** — in flight in two
  worktrees: (1) chat.mjs's `predicatePhrase` renders raw CURIEs for the `tmct:` predicates
  the lexicon itself mints ("latency tmct:needs result" reached their public page) while
  `src/domain/fact-phrase.mjs`'s copy already falls through to the local name — unify on one
  implementation and publish it (their standing export ask: public `factSentence`/
  `predicatePhrase` plus a `reference:<pack>:<title>@<revid>` → {title, url} helper);
  (2) the lane-3 narration prints `memoryDir=[object Object]`; (3) a lane-2b turn narrates
  "no parse stood" and "goal: unclear" while its own decision line says a fact resolved —
  the goal line must match `via=fact`; (4) an offline, pack-backed research source
  (`researchSource: "simple-wikipedia-pack"` reading the shipped reference pack) plus a
  public seam for consumer-supplied research providers, so a network-free deployment still
  shows the research fan-out. Recorded, not built (their request): a confidence marker on
  extraction-tier triples so a consumer can decline unsure rows — extraction quality itself
  explicitly not asked for; and bookkeeping rows leaving read-back structurally is
  `PLAN_MEMORY_BACKEND.md`'s §3.7 scope.
- [ ] **The composite miss lead claims more than the engine checked** — "nothing in the index
  matches that (functions)" reports an empty set by saying the index matches nothing of that kind,
  which is false whenever the kind is non-empty and the filter is what emptied it. Both judge
  samples on both arms of `g-b1-neg-11` name this sentence unprompted and score honesty 0 for it,
  on an answer whose verdict is correct
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.42.md`). The lead heads 121 of the 1,075 answers across 15
  cells — B2 relative-embedded (23), C2 garden-path (19), C1 relative-embedded (16) lead it — so
  separating "this kind is empty" from "nothing satisfied the filter" is a judged round over those
  cells rather than a spot fix.
- [ ] **An empty composition names its emptied branch only for a seed clause plus one qualifier** —
  the 5.0.41 round widened it to the negative polarity, so both "and tested" and "but not tested"
  now name what held. An intersection of two clauses, a difference of two clause sets, and a
  multi-step fold still answer "nothing in the index matches that", and every miss left in
  `C1:negation+relative-embedded` is one of those, so the cell's floor is this receipt. Carrying the
  intermediate through `evalBoolean` instead of re-evaluating the seed covers all of them; it
  reaches every composite lane and every miss text pinned against them.
- [ ] **news.html's marketing screenshot now captures the empty state** — since the
  newsworthiness gate landed, the seed alone never heads a card, so the capture pipeline
  photographs the designed empty feed. Operator content call: keep the honest empty plate, or
  bake a fixture poll into the capture run so the shot shows a populated feed.

## Discipline

`CLAUDE.md` is the standing working model: the coordinator/background-sub-agent split (including
sub-agent git discipline, verifying a "waiting"/"completed" claim, and never resuming an
auto-removed worktree), the test blast radius (including the migration concept-sweep), the
versioning and push rules, and the repo-local identity. Read it there. This section holds only
what's specific enough to `tmct` that it doesn't belong in that general model.

- **Merging concurrent `chat.mjs` branches**: rebuild the ask bundle (it inlines chat readers, so
  it drifts on every reader change), rerun the pack-manifest check, and check for same-name
  top-level declarations across branches — esbuild's duplicate-symbol error at bundle time is the
  tell (two batches once both coined `spiderFlyContextAnswer`). Re-probe seed-content-dependent
  e2e pins against the real store after any seed-generation change — a raised seed cap can
  silently ground a demo's lookup term or break a source-adjacency pin.
- **`cd <repo-root>; pwd` as the literal first line of any merge-sequence Bash call.** The shell
  can carry a stale working directory across calls even with an explicit `cd` earlier in the same
  turn; a merge has run inside a sub-agent's worktree instead of the main checkout because of this.
- **Brief distinct naming when multiple agents extend the same shared test file.** Sibling
  content-authoring agents reliably collide on top-level `const`/`function` names even when their
  actual test content doesn't overlap — `git merge` can't auto-resolve that, only a manual rename
  can, so name the collision risk up front rather than reconciling it at every merge.
- **A fresh worktree has no `corpus/worlds/`, no `corpus/sprites/` and no ask bundle, and
  `node --test <file>` does not build them** — only the `npm run test:*` scripts do. So a targeted
  run in a new worktree fails tests that pass everywhere else, and the failure reads as a lane
  regression rather than a missing artifact (`spider-fly-turn.test.mjs` fails 7 of 17 at pristine
  HEAD for this reason alone). Every dispatch brief should say: run `node scripts/ensure-worlds-pack.mjs`,
  `node scripts/ensure-sprite-facts.mjs` and `npm run build:ask-bundle` before any `node --test`.
- **After closing an Open item, re-read the whole Open items section, not just your own diff.** A
  narrow text-replace edit's own match can end before a trailing item's text, leaving it
  unresolved and untouched for several commits even after the section's own summary line says
  "None open."

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `reports/BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
