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

- In flight: the combined miss-lead round on chat.mjs (Opus), E2 news-gate consumption
  (Sonnet, owns news-feed.mjs), T0 corpus bands + loader (Sonnet; told to reuse T1's band
  query helper), M3 sqlite conformance (Opus, owns core.mjs under the byte-identity
  pin), M6 HTTP client backend (Sonnet), M7 infra + deploy (Sonnet, owns infra/,
  .gitlab-ci.yml, post-deploy-smoke). Landed: M0, M1, M2, M4, M5, T1, T2 (breaker;
  mode constants now in domain/retrieval-modes.mjs), E0, E1, the screenshot capture
  (item closed below). Version rolled to 6.0.0 (operator: major).
- Queued: T4 after chat.mjs hand-back → T3/T12/E3 → M8/T5/T6/T7/E4 → T8/T13/T14/M9 →
  T9/M10/T10/T11. The M0–M4+M9 push is the npm cut bedrock-meter pins (M9 dispatches
  when M3 lands).
- Pushes: batch 2 (M1/M2/M4/M5/T1/E1 + the 6.0.0 major) is on origin/main, gate suite
  7696/0; its pipeline publishes 6.0.0. Batch 3 accumulates from here; M9's contract doc
  follows in it.

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
- [ ] **The extraction-quality findings: `PLAN_EXTRACTION_CONFIDENCE.md`** — BUILDING inside
  the campaign (E0 in wave 1). A closed vocabulary of named structural findings per
  assertion (never a score): three decline reasons (`definitional-frame`,
  `relative-clause-verb`, `fragment-term`) and three attached findings (`identifier-token`,
  `clause-fallback`, `pronoun-carry`); the newsworthiness gate rejects finding-bearing rows
  from heading cards; acceptance is the NYT fixture at 3 hubs / 0 junk with the fixture
  byte-identical, and the latency sentence declining both its bad edges. Serializes against
  `PLAN_MEMORY_BACKEND.md`'s M1/M3 on core.mjs; the fluent-meta-commentary residual is
  recorded with the NER horizon. Closes the scaffolding-prose false positive and
  bedrock-meter's confidence-marker ask. Remainder found in E1: `p2p-room.mjs`'s wire fact
  enumerates its fields explicitly, so a finding-bearing row replicates to a peer WITHOUT
  its findings — the wire fact needs the `extraction` field carried before this item closes.
- [ ] **The news screenshot content call** — both candidates are captured and presented at
  https://claude.ai/code/artifact/dd7de58f-bdeb-4114-abb8-8330218ed5cf (A: the honest empty
  plate, pipeline-identical; B: the fixture poll, needs the pipeline to bake the poll and a
  feed scroll). Open: the operator picks the plate; the winner gets re-captured after the
  thin-client rebuild flips the page.

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
