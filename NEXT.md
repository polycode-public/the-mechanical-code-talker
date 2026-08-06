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

*(Footnote, not an open item: MUD3D was renamed MUDIII, design only, credit to
`world-of-claudecraft` and MUD1/MUD2 chosen if `mudiii.html` ever ships. An optional email to
Richard Bartle at that point is the operator's call to make if and when they choose to.)*

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## In flight (claims + neutrality delivery, coordinator session 2026-08-06)

Live background sub-agents and their worktrees under `.claude/worktrees/`; each merges to
`main` via its branch (`worktree-agent-<id>`) and the coordinator removes the worktree at
merge. `PLAN_CLAIMS.md` and `PLAN_GRAPH_NEUTRALITY.md` carry per-wave delivery status.

- [ ] **Reference-pack persistence gap** (claim:cite's remainder) — the `isaOf()`
  extraction fix landed (735c7e6f: parenthetical stripping, sentence-bounded window,
  quantifier-of chains, plus the missing `rodent` lexicon row). Remainder: the shipped
  `corpus/reference` shards carry precomputed `isa` fields from before the fix, and
  `ingestReferenceArticle` reads only the stored field, so cite is honestly red at
  44/48 until the shards' isa fields are recomputed from their own committed text.
  Recompute in flight — worktree `agent-adafb6765f8784d40`, no network, revids
  untouched, cite must return to 48/48. Its dry-run caught that the first widening
  dropped 212 shipped isa facts (partitive heads like "group of animals" stopped
  reading through), so the coordinator set the bar (overnight directive, operator to
  review): the recompute must be loss-free — partitive/collective heads (`group`,
  `set`, `part`, `piece`, `bunch`, `family`, empirically extended from the loss list)
  read through the of-chain; `member`/`body` keep their pinned composition semantics.
- [ ] **Claims page** (PLAN_CLAIMS T14) — in flight, worktree `agent-a6fc44e49b2ab102b`:
  claims.html rendered from `results/claims/*.json`, block manifest + estate guard,
  index teaser, plan-about STRIPS line, benchmark-this-device button. The two narrative
  passages are re-authored (notes file gone) and flagged for operator review.
- [ ] **Full-estate re-pin sweep after neutrality wave 2** — the first full-suite run
  after neutrality wave 1 merged shows ~1044 failures, all (sampled) old bare-install
  string pins against the new neutral surfaces (e.g.
  `test/adapters/session-banner.test.mjs` expects "no code graph loaded — starting
  empty"; session-transcript corpus rows embed the old greeting). Expected fallout of
  the neutrality contract, not an engine break. Sweep dispatches once wave 2 merges so
  pins move once; bare-install pins re-pin to neutral strings, active-domain pins stay
  byte-identical. Full log:
  the coordinator session's scratchpad `full-suite-batch1.log`. Push batch 1 is gated
  on this sweep going green.
- [ ] **Ground-gate over-acceptance fix** (T11's remainder) — three ungroundable items
  accepted by the general-verb-frame fallback (gibberish "asdkjhaskjdh qpwoe zzxx",
  narrative "the old bridge creaked under the weight of the truck" → `mgx:creak-under`,
  "the children played in the park until sunset" → `mgx:play-in`). Silent garble is the
  poison case; fix in `chat.mjs`'s bare-verb fallback after neutrality wave 2 releases
  the file. Regression gate: claim:ground-gate re-run (matrix must not lose groundable
  acceptances) plus the teach corpus lanes.
- [ ] **Neutrality wave 2** (PLAN_GRAPH_NEUTRALITY T4–T6 + the `corpus/domains/code/`
  relocation) — worktree `agent-acc00322cd9301ca1`.
- [ ] **Queued, not yet dispatched:** PLAN_CLAIMS T14 (claims page; needs cite,
  ground-gate and planner JSON committed first) and T15 (CI proposal); neutrality wave 3
  (T7 docs, T8 tier2 packs, T9 /capabilities domain listing). Coordinator end-game:
  re-run every claim rig after the neutrality merges, full suite, push batches, pipeline
  watch.
- [ ] **T9 remainder (research adapters):** `wikidata-live.mjs` duplicates
  `wikipedia-live.mjs`'s throttle/cool-off/cache machinery (consolidation pass), and the
  chat research lane still has a single provider slot so Wikidata is registered but not
  lane-wired — wiring it is a product decision recorded here, not taken silently.

## Open items

- [ ] **Politeness wrapper + known memory term still walls.** `please tell me what you know
  about dog` returns the code-question decline while bare `what do you know about dog`
  answers. The unknown-term siblings are fixed (`2a96481a`: the teach-offer block now peels
  wrappers as a fallback), so this is that fix's remainder. Mechanism, verified: the fact
  lane's only unwrap path is the `!envelope` bootstrap retry in `src/services/chat.mjs`
  (near the raw-query-first contract comment), which uses `normalizeQuery`, and
  `normalizeQuery` strips the pronoun ("what do you know about dog" becomes "what do know
  about dog"), which `KNOW_ABOUT_RE` no longer matches. A fix either switches that retry to
  `applyPreambleFrames` or changes `normalizeQuery`'s stopword handling; both touch the
  deliberately narrow raw-first/one-retry contract, so it needs its own careful pass with
  the full templates+grammar corpus lanes as the regression gate.

### Questions blocking work

Nothing is blocked. The mudiii pill-append and ground-click decisions live in
`PLAN_MUD_MUDIII.md`'s "The decisions that still bind"; the retraction decision lives in
`src/domain/memory/retraction.mjs`'s own header comment and `docs/references/papers/crdt.md`'s
"Where 'latest wins' happens".

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
