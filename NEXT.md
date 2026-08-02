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

## In-flight right now

Nothing in flight.

## Open items

- **MUDIII is built and deployed-pending.** `mudiii.html` renders the town square in three.js over
  the same deterministic planner the other game demos use: the cast draws at rest, the deck drives
  it, the chat lane answers, the food verb works from a typed line and from a click on the square,
  and all five e2e assertions pass. It is on the landing page as Plate XI and registered in CI.
  **Closes when `smoke:deploy` passes against the live page** — that run also exercises the new
  models probe, which is the only check that would catch committed models never reaching the edge.
  Remainders:
  - The world-source freshness guard now exists for the town square and for spider-fly, closing the
    gap where `gen-spider-fly-world.mjs`'s header claimed a guard that was never built.
  - `test/fixtures/mudiii-ticks.json`'s `expectedTape` fixes event types and decision rungs, never
    cells: every wander is a seeded pick, so cells are an output and the starting board is the knob.
    Three rungs were corrected against the engine after a 685,000-board sweep reached the
    hand-authored ones zero times.
  - `mudiii-browser-entry.mjs` and `mudiii-viz.mjs` still carry header comments saying their sibling
    modules "do not exist in every worktree yet". Both are on `main` now. The guarded dynamic
    imports they describe are still live code, so removing them is a behavioural change rather than
    a comment sweep.
  - The engine ships no recast, so the page's reset re-opens a whole session. That is the right
    shape for an in-memory store owned by one visitor, and it is why the session exposes no recast
    method — worth knowing before the shared-worlds phase, which will need one.
- **Teach mode** on adventure.html, mud.html and mudiii.html. The engine half has landed: a
  declarative sentence is read as a fact against the live world, general semantics, world-scoped
  provenance, mint or move depending on whether the world already answers to the subject. The
  `applyEdit` snapshot-stamp sub-clause closed with it. What is left is the UI half — the checkbox
  on each page, its hint text (`Candle is in the study.`), and the flag's route from DOM to the turn
  call. Remainders carried forward:
  - `QUESTION_LEAD_RE` is duplicated in `world-teach.mjs` because it is private to `chat.mjs`.
    Moving it to `src/domain/interpret/normalize.mjs`, beside `correctMisspellings`, kills the copy.
  - `world-teach.mjs` and `adventure.mjs` import each other. Safe today — every binding crossing
    the cycle is a hoisted function declaration, and no estate rule forbids a same-layer cycle —
    but worth knowing before either file grows.
- **Retraction does not replicate.** `removeFacts` is a real local delete, reached by chat's
  `/retract` and by mud EDIT mode for the non-fold-versioned predicates. Those predicates are
  exactly the ones the sync filter replicates, and nothing broadcasts a removal — so over a mesh a
  retraction is undone by the next sync from any peer that still holds the fact. Found by the CRDT
  reference pass and reasoned about there: an OR-Set would need causal delivery the transport does
  not provide, and its tombstones would put holes in the provenance record, which is a product
  feature. The cheaper route is the shape `compaction.mjs` already uses — a replicated summary
  record carrying the ids it absorbs, so absorption merges by union and stays a join.
- **The read-time resolver must stay a pure function of the fact set.** `foldWorldState` broke this
  once and was fixed from outside itself, by `p2p-room.mjs` sorting Fact individuals by
  content-addressed id after every merge. Check any future resolver the same way: feed one peer's
  facts in two different orders and demand the same answer. One that reads a wall clock, a local
  counter, or array position passes a single-browser test and diverges on the mesh.
- **Pill-driven predictive text** on the same three pages: typing a prefix completes to a live pill's
  whole grounded command. Sub-clause: adventure.html's pill buttons carry no `data-command`
  attribute, where mud.html's already do. Keyboard completion works fully without it — only the
  rail highlight and `aria-activedescendant` wiring stay inert. Operator's call to add it in a
  later wave, so the adoption brief leaves it alone.

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
