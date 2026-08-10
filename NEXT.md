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

**Build campaign in flight (go given 2026-08-10).** All four items below are being built as one
continuous campaign per `PLAN_MEMORY_BACKEND.md` §28 with the E-phases slotted per
`PLAN_EXTRACTION_CONFIDENCE.md` §5. Coordinator: this session. Sub-agents run in auto-assigned
worktrees under `.claude/worktrees/`; this list tracks the current wave and moves as waves land.

- The campaign's build work is COMPLETE: every phase of both plans is merged (T10 docs
  landed with four coordinator corrections; the M10+T11 handoff sits in bedrock-meter's
  inbox; the DOM-rendered screenshots recaptured — mudiii/adventure keep their accurate
  committed shots, this machine's headless Chromium has no GL). The final gate suite
  and push are the remaining coordinator steps. Deploy blocker: pipelines #760/#761's failed
  deploys left an orphaned `tmct-prod-prod-rows` table (RETAIN on rollback) that
  collides with re-creation — needs `aws sso login --profile tmct-prod`, then the
  coordinator verifies it's the empty orphan and deletes it. Operator step recorded
  by T6: wikidata-slice and conceptnet-full band loads need hand-downloaded dumps.
  Landed: M0–M7 (M3's byte-identity dump matched), T0 (WordNet band ran for real at
  206,357 rows; ConceptNet/Wikidata pipelines fixture-tested, first scale run is T6's
  CI job), T1, T2, E0, E1, E2, the miss-lead round (whereSet/temporal remainder open
  below), the news screenshot call (empty plate). Version rolled to 6.0.0 (operator:
  major).
- Queued: E3 after T4 → T5 after T3+T4 → T6 after T3 → M8 after T12+T3 → T7 after
  T4+E3 → E4 after E2+E3 → T8/T13/T14 → T9/M10/T10/T11.
- Pushes: 6.0.0 and 6.0.1 published; batch 4 (E3/E4/p2p/T3/T5/T6/T7/T12/M8/cap-fix +
  the #760 pipeline fixes + 6.0.2, gate 7922/0) is on origin/main — its pipeline is the
  first attempt at a full row-service deploy. The extraction item is verified and gone;
  its plan doc (Status: BUILT) moves to archive/ in the campaign's closing docs pass.

- [ ] **The memory backend, the AWS row service, and the consumer-hosted turn surface — one
  plan** — `PLAN_MEMORY_BACKEND.md`, six operator revision rounds, now also absorbing the
  former turn-service plan: three in-tree backends (in-memory, sqlite, DynamoDB) behind one
  published conformance kit, with bedrock-meter's integration reduced to configuration; the
  deployed news.html running on an `/api/*` row service in tmct's own stack (client-minted
  UUIDv4 sessions, path-scoped mutations, synchronous writes, soft deletes, a hard global
  table cap with an atomic counter, week-default TTL, the full abuse table with a kill
  switch); `POST /api/sessions/:uuid/turn` as the consumer-hosted turn surface with no
  network but DynamoDB, fed by `corpus:<band>` partitions loaded via `tmct corpus load|clear`
  from CI post-deploy; retrieve-then-resolve feeding the unchanged synchronous engine a
  bounded deterministic subgraph under fixed good-citizen budgets; circuit breakers on both
  transports (a `_meta` item on Lambda, page-lifetime state in the browser) covering the
  external wiki and KB sources too; enumeration answers stating their retrieval bounds;
  chat.html and ledger.html gaining a local/AWS backend slider with `?backend=aws` deep links
  and mode-honest copy; the home grid renamed the demo grid with nine deep-linked buttons;
  and (tenth revision) news.html as a FULLY THIN client — no in-page graph, no seed fetch,
  a server-materialized feed document polled by version, and a chat area below the teach
  panel that is the turn endpoint's first page consumer. BUILDING — campaign in flight, see
  the wave tracker above.
- [ ] **The two empty leads the composition receipt did not reach** — `whereSet` still answers
  "nothing in the index matches that clause (classes), so there is no location to cite" and
  `temporal` still answers "nothing in the index matches the inner set", the last two empties
  that name neither the branch that emptied them nor the population the index holds. The walk
  that names them exists (`emptiedBranch`); these two renderers do not call it, and each has a
  tail sentence of its own to compose with. (The combined miss-lead + empty-composition round
  itself landed: +0.084 answer-identity-controlled on changed answers, every cell up, report
  `reports/BENCHMARK_CEFR_ENGLISH_5.0.46.md`; judge reliability on `g-b1-neg-11` is that
  report's own open caveat.)

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
