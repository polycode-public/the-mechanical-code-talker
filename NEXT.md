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

*(Footnote, not an open item: `mudiii.html` shipped 2026-08-03 and is deployed; the
`world-of-claudecraft` and MUD1/MUD2 credit placement rides PLAN_RIVER_CROSSING.md's site
phase. An optional email to Richard Bartle remains the operator's call.)*

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] **PLAN_SYLLOGIST_EL_DL.md — remaining phases** — paused at a clean seam; the plan doc
  states per-phase status. Landed: phases 0/0b, 1 (with `tmct classify` and `/classify`), 2 (EL
  wired into the ask lanes; E1/E2 answer end to end), 3 with 3b (`/prove`; E3/E4 answer end to
  end), 4a-4e (the full SHOIQ increment ladder), and 5 (consistency surfacing — `findTableauViolations`
  and a new `elUnsatisfiableClasses` run beside the cax-dw chase in chat and in `/memory verbose`).
  Checked this round: `/prove` alone doesn't lift the infbench INF-8 `dlDisjunction`/`dlComplement`
  ceiling markers — infbench's chat arm drives the plain question with no `/prove` prefix, so the
  ceiling stays until `/prove` becomes an automatic ask-lane fallback (or the harness routes those
  cases through it explicitly); the plan's own phase-4 section records the check. Of phase 4's own
  five `inference.dl.*` corpus rows, enumeration and cardinality-clash landed; transitive-role,
  role-hierarchy and inverse-role wait on vocabulary no ACE pattern or teach-lane frame writes yet
  (`owl:allValuesFrom`, `rdfs:subPropertyOf`, and an asserted ABox role fact between two named
  individuals respectively — the plan's own phase-4 section records the check). Next rounds: those
  three corpus rows once their vocabulary lands, track 6 site/claims.
- [ ] **PLAN_NEWS_FEED.md — remaining phases** — paused before phase 4. Landed: phases 0-3 and
  5 (domain, fixtures, adapters, store, service, CLI verb). Next rounds: phase 4 chat wiring (a
  `chat.mjs` round; also carries the strict-tier provenance nuance recorded in the plan's phase
  3 section), 6 page, 7a/7b site, 8 e2e + CI enrolment, 9 rig + claims.
- [ ] **PLAN_COMMON_SENSE_QA.md — remaining phases** — landed: F0-F3 plus the broadened
  `extractStemSourceTerm` (six closed stem templates; re-measured claim now 1 answered, 2
  refused, 97 abstained, `sourceEdgePresent` 2). The measured next gate, recorded in the
  plan's F3 section: `coreParse`'s `leadsInterrogative` (`QUESTION_LEAD_RE` in
  `src/domain/interpret/normalize.mjs`) declines 50 of the 100 fixture stems before the
  choice lane runs at all, and that gate is shared with other lanes, so widening it is its
  own careful round with the full chat blast radius. Next rounds: that gate, F4 claims-block
  swap, F5 removal + corpus rows, rungs R1-R5 (R2-R4 serialized on `chat.mjs`).
- [ ] **Three seonix playtest findings (their PLAYTEST_LOG_004/005, relayed 2026-08-08)** —
  (1) "what does X mean" misses LexiconTerm individuals `/describe` finds (worked on 3.0.8);
  (2) the denotes ask lane reports no edges on a term whose `/describe` lists twenty, and the
  reverse phrasing filters candidates to Modules though denotes objects are Functions/Classes;
  (3) `/impact`'s closure drops `mgx:serves` edges seonix's native closure crosses. Diagnosis
  track dispatched; fixes land through the `chat.mjs`/ask queue.
- [ ] **Runtime-readable AGENTBENCH envelope stamp in the npm tarball** — bedrock-meter asks
  for a shipped `envelope.json` (or equivalent) in `files` so consumers replace hardcoded
  tripwire literals with a measured read.
- [ ] **PLAN_RIVER_CROSSING.md — R5-R8, paused on the operator's hold** — R0-R4 are shipped
  (see the plan's Status header for the delivered detail). R5 belief/plan panels, R6 the
  river scenario on the mudiii page + site wiring, R7 e2e/corpus, R8 the planner-rig river
  domain resume only when the operator says so (weekly usage cycle). The Wikipedia variants
  needing population counting and boat capacity sequence later still.
- [ ] **CEFR levers from the 5.0.25 dual-draw baseline** — the run is delivered
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.25.md`); its decision log ranks the levers a tuning
  cycle should try next: relative-embedded chain resolution, a conditional-question lane, a
  negation-scope filter, the temporal-window boundary in commit counting, and growing the
  under-covered C2 relative-embedded census cell.

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
