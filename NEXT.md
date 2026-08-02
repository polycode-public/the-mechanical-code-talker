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

Four tracks.

- **The CloudFront double-brotli fix** — `compress: false` on the seed behaviour and an
  unconditional `Content-Encoding: br` metadata pass, plus whatever proves it in CI.
  `infra/website-stack.ts`, `scripts/wait-for-site.mjs`, a deployed e2e assertion. Top tier.
- **The mudiii ground-click e2e failure** — one test times out at 27s after the click moved from
  pointerdown to pointerup with a 6px drag threshold. Deciding whether the test drives it wrongly or
  the threshold has a real bug. `test-e2e/pages-mudiii.test.mjs`, `mudiii-scene.mjs`. Top tier.
- **The `PLAN_MUD_MUDIII.md` audit** — every item in that 515-line doc into shipped-as-planned,
  shipped-differently, not-shipped, or no-longer-wanted, then the doc cut to what is open. Top tier.
- **The prey sweep and `STATUS.md`** — one regime at a time after the sandbox killed its concurrent
  sweeps. Sonnet.

## Open items

### Found by playtest and benchmark, not yet fixed

- **The deployed site serves the starter memory brotli-compressed twice.** Decompressing one layer
  gives 4,534,836 bytes of more brotli; twice gives the real 93,496,025-byte JSON. Every browser
  sends `Accept-Encoding: br`, decodes one layer, and hands `JSON.parse` binary, so a visitor gets no
  starter memory at all — the pill reads `1 FACTS` and the composer tells them to run `tmct init`.
  The build writes one brotli layer (`scripts/build-demo-site.mjs:783`-`:796`), a viewer-request
  function rewrites `/chat-seed.json` to `.br` (`infra/lib/website-stack.ts:88`-`:107`), and that
  behaviour carries `compress: true` (`:169`), so CloudFront encodes it again. A weak `W/"..."` etag
  on the encoded variant against a strong etag on the stored object is CloudFront's own signature for
  a re-encode.
  **It varies deploy to deploy**, which is why this read as an untraceable CI flake for weeks: a
  re-run that cleared it was hitting a different deploy's object. The scoped metadata
  `BucketDeployment` (`:201`-`:249`) only re-runs when the sibling's content hash changes, so a
  deploy where the seed did not move re-uploads it with the CLI's guessed metadata and no
  `Content-Encoding`.
  **In flight.**
  **Do:** `compress: false` on a behaviour matching `/chat-seed.json*` and an unconditional
  `Content-Encoding: br` metadata pass. Both, or the object is undecodable either way.
  **Risk:** `scripts/wait-for-site.mjs` used to ask for `identity` encoding, the one variant no
  browser requests, so it passed on an exact byte count while every visitor got something unreadable.
  Whatever proves this in CI has to fetch the way a browser does.

- **The playtest findings are closed except two.** `reports/PLAYTEST_DEMO_PAGES.md` and
  `reports/PLAYTEST_UNCOVERED_AREAS.md` hold the transcripts.
  **Still open:** ingest's Document mode never updates its source label — typing text directly
  ingests correctly, but the header stays on "drop or browse for a file", because the input handler
  at `src/services/ingest-viz.mjs:336`-`:340` updates the `sourceTag` variable and never writes it
  back to `srcLabel.textContent`. And the twelve unfixed findings in `reports/CLI_EDGE_HUNT_2.md`,
  ranked in that report, three of them in `chat.mjs`.
  **Tier:** Sonnet for the label, mixed for the CLI set.

### Inference

- **INF-4's ceiling is a chat-layer bound, not a missing rule.** The benchmark at 5.0.5 reaches INF-8
  on the chat arm with zero fabrications across 499 rows. Of its 56 ceiling declines, **30 are
  already provable**: the bench's own read-only kernel proves all thirty at chain lengths 3, 4 and 5.
  The chat layer declines them because `chat.mjs:9696` and `:9717` pass `{ maxHops: 2 }` to
  `findIsaChain`, which declares `maxHops = 6` itself (`syllogise.mjs:1715`), check-then-extend and
  cycle-safe. So the cheapest next rung buys 30 of 56 with no new inference rule.
  **Stopped by the operator.** The work sits unmerged on its own branch.
  **Tier:** Sonnet. Small edit, sharp trap.
  **The trap, and it will bite:** the generator pins those 30 as `expect: { verdict: "unproven" }`
  with a `ceiling` field. **Raising the bound alone turns 30 correct answers into 30 grader-counted
  fabrications and takes INF-4 from PASS to FAIL.** The pin flip has to land in the same commit.
  **Do:** raise the bound, flip the pins together, and re-run the bench to confirm INF-4 still passes
  and the ceiling count drops to 26. `reports/BENCHMARK_INFERENCE_5.0.5.md` briefs it in six steps.
  **Feasibility:** INF-7 needs Stage EL saturation and INF-8 a Stage DL tableau plus phase-0
  `unionOf`/`complementOf`/negative-assertion representation. Those are the path above, not this.
  **Risk:** deeper chains cost more per turn, and the per-turn cost has already grown (below).

### mudiii.html — further work

- **The prey blend is measured and shipped off; one regime is unmeasured.** The weighted
  evade/forage score exists behind `blendPreyDecision`, default false, and the comparison harness is
  committed at `scripts/compare-prey-decision.mjs`. Over 12 seeds the priority chain wins the mean on
  10, the median on 9, and the longest-lived prey on 9, so the default stayed. The behavioural metric
  cleared the trap: the blend forages within a predator's reach about 10% of the time where the chain
  never does, so it is losing by foraging, not by evading more.
  Chebyshev distances are integers and one step moves each by at most 1, so any weight above 0.5 is
  byte-identical to the chain. The knob has three settings, not a continuum.
  **What is unmeasured:** every run used one predator on town square with `preyVisionRadius: 3`, and
  nothing starved on the shipped drain. A prey that sees further than it can be caught from, or a
  board with more crumbs than foxes, could move where the trade breaks even.
  **Tier:** Haiku. It is a re-run, not new work.
  **Do:** the harness already takes `--layout` and `--set`. Sweep the chapel and market boards and a
  couple of vision radii, and record what the numbers say. If they still favour the chain, delete
  this item and leave the flag off.

### Questions blocking work

Nothing is blocked. Every question that used to sit here is answered and written into its own item.

Settled, and written into the items themselves:

- **Claim pills append rather than replace or submit.** A single click appends the pill's text to
  whatever is already in the input, so pills compose: click `look at`, then click `the book`. Return
  submits, and a double-click appends and submits in one gesture. This is a change from every other
  pill rail in the repo — adventure and mud both assign `chatqEl.value = btn.textContent`, replacing
  what was typed. The mudiii rail must append with a separating space and put the caret at the end.
  Recorded on the deception-rail item.
- **Board feedback belongs to ground clicks, not camera buttons.** Clicking a cell flashes it, draws
  a line from the followed agent, and has that agent plan a route there. FOLLOW / POV / OVERHEAD
  switch the camera and do nothing else. The camera-feedback item merges into the click-to-turn item.
- **A retraction suppresses one source's assertion, not the whole triple group.** If two peers
  independently taught the same fact, one retracting leaves the fact standing, cited to the other,
  and the retraction stays on record rather than erasing the assertion. Recorded on the p2p item.

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
