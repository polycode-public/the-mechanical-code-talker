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
`~/.claude/inboxes/tmct-hanoi.md`.

Deploy target for `bash scripts/fast-deploy-web.sh <bucket> <dist>` (skips the CDK pipeline): bucket
`tmct-prod-prod-web-000868243177`, distribution `E1YEAO48PKAJHE`, `AWS_PROFILE=tmct-prod`. Full
clean path is a push to `main` with a remote — GitLab CI's `deploy:website` job.

## Open items

- [ ] **ConceptNet band load — loaded, verification pending** — the load summary printed
  2026-08-11: 2,344,809 rows, source digest matching the recorded sha256. Remaining:
  the operator runs `AWS_PROFILE=tmct-prod node probe-conceptnet-band.tmp.mjs` (repo
  root, read-only: `bandStatus` manifest read-back + `queryBandTerm("dog")`; the
  credentialed call is permission-gated away from the assistant). Probe looks right →
  this item closes and the temp script is deleted. The reusable band jsonl lives
  durably in `~/tmct-dumps/`.

- [ ] **Wikidata dump download — operator-run, outside any session** — run
  `bash scripts/resume-wikidata-dump.sh` from the repo root (re-run after any
  interruption; it resumes, prints a progress line per minute, and verifies the final
  byte count). File: `~/tmct-dumps/wikidata-latest-all.json.gz` (155.3 GB). When it
  reports done, the next steps are `PLAN_MEMORY_ROLLOUT.md` section 4.

- [ ] **The rollout: container-image Lambdas with sqlite seeds — IN BUILD (operator's go,
  2026-08-11)** — the plan of record is `PLAN_MEMORY_ROLLOUT.md`: one Node 24 container
  image for all three Lambdas carrying `mid-seed.sqlite` + `xl-seed.sqlite`, killing the
  news worker's OOM (three in-memory seed copies) at its cause. `e2e:deployed:news-live`
  is the acceptance gate and is red until the worker fix lands. That doc also carries the
  live-ops facts a fresh session must not re-learn. Build runs as coordinator + worktree
  sub-agents in waves: Wave 1 = R0 (seed sqlite build), R2 (sqlite seed overlay), R3
  (CDK container functions); Wave 2 = R1 (Dockerfile + RIE verify), R4 (CI image build);
  R5 acceptance is the coordinator's post-deploy job. In flight now (Wave 1, dispatched
  2026-08-11):
  - R0 seed-sqlite — builder merged to local `main` (`c6f7de16`); the agent's
    full-scale xl build still runs in worktree `.claude/worktrees/agent-a208c44a55e540d75`
    as the digest verification
  - R2 sqlite seed overlay — code complete, merged to local `main` (4 commits through
    `a57437f1`); fixture cycle peak heap 105.8 MB against a 140 MB budget test;
    verified at the R5 deploy gate
  - R3 CDK — code complete, merged to local `main` (`6b0b00e5`), worktree removed;
    verified at the R5 deploy gate
  - R1 image agent — worktree `.claude/worktrees/agent-ac9074a80cd9945ee`
    (Dockerfile + RIE verification, in flight)
  - R4 CI — code complete, merged to local `main` (`bfe0ba77`): `image` stage with
    `build:image-artifacts` + kaniko `build:image` (executor tag verified live),
    deploy consumes `-c imageTag=$CI_COMMIT_SHA`; ECR repo bootstrap is idempotent
    in-job; verified at the R5 pipeline gate

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
