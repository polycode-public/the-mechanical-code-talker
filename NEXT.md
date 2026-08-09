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

- [ ] **MUDIII's chat surface can't reach the river scenario or the drive-trait sentences** —
  the plan-ladder remainder `archive/PLAN_RIVER_CROSSING.md`'s R7 section records: the chat opener is
  a closed regex naming only the three grid layouts (no chat line opens a layout-less puzzle
  world), and the per-instance drive sentences (`agent-editor.mjs`'s closed table) are spliced
  into the browser page only, with no ask-lane grammar for those predicates. Operator said go
  (2026-08-09); four planned corpus rows wait on it. In flight in a chat.mjs worktree.
- [ ] **CEFR levers from the 5.0.25 dual-draw baseline** — the run is delivered
  (`reports/BENCHMARK_CEFR_ENGLISH_5.0.25.md`); its decision log ranks these levers for the
  next tuning cycle, each its own measured round:
  - [ ] relative-embedded chain resolution
  - [ ] a conditional-question lane
  - [ ] a negation-scope filter
  - [ ] the temporal-window boundary in commit counting
  - [ ] growing the under-covered C2 relative-embedded census cell
- [ ] **River puzzle renders in three.js on mudiii.html** — code-complete and merged, pending
  deployed verification: `bootRiver`/`applyRiver` draw banks, water, a boat and one labelled
  figure per passenger on the same stage the chase squares use (the fox rides its real GLB;
  farmer/goat/cabbage get coloured silhouettes since the manifest carries no models for
  them), each crossing tweening as playback walks the plan; the 2D chip board stays as the
  no-WebGL fallback. Remainder: `mudiii-about.html`'s copy still describes the town square
  only — it should mention the crossing and the direct link.
- [ ] **mudiii scenario by query parameter, river as a top-level demo** — the query parameter
  is code-complete and merged (`mudiii.html?scenario=river`, slug-matched, silent fallback on
  unknown). Operator decided the link's shape (2026-08-09): one extra demo-list entry deep-
  linking to `mudiii.html?scenario=river` alongside the existing mudiii and adventure
  entries, with its own social share posts but the SHARED mudiii about page — no new claims
  block, no new screenshot (a different perspective on the same demo, not a new capability).
  The stopgap showcase band retires when the entry lands. Queued behind the mudiii-about
  copy worktree (same site files).
- [ ] **News page controls follow-up (2026-08-09 second field report)** — code-complete and
  merged, pending deployed verification: (1) "stop & forget" now retracts every news/research
  row, resets the session and card cache, and holds an emptied feed on screen; (2) the poll
  roster defaults to all five contemporary feeds with the reference works grouped separately
  as lookup-only; (3) `poll once` (always present, no consent preference written) and
  `stop polling` (cancels the timer, aborts an in-flight cycle at its next yield point — an
  interrupted lookup returns to pending, never the negative cache); (4) enrichment prose now
  goes through `ingestText` and renders through the same paraphrase templates as articles
  ("rottnest has a lighthouse", not one bald isa edge).
- [ ] **Newsworthiness v2: entity-anchored news, defined in graph terms** — design landed:
  `PLAN_NEWSWORTHINESS.md` defines news as an entity-anchored novelty event (test E: a
  reported row names a non-class term absent from the graph's prior corpus/reference/teach
  terms; test A: a fresh anchored assertion about a known entity), kills the concept-card
  fallback in favour of a designed empty state, and decides the borderline cases ("apple"
  without an anchor is a recorded known miss, never a guess). Execution N0-N4 not yet
  dispatched; N2 sequences after the news-controls worktree merges (same files).
- [ ] **index.html gains a wiki-backed worked example** — between "The sprite library" and
  the Facts as "RDF/OWL triples" sections, in the existing worked-example style: a real
  research exchange (e.g. "what is an aardvark") showing the engine search Wikipedia,
  synthesize the answer as prose (aardvarks are animals), and cite the wiki passage text and
  its URL. A genuine transcript, generated locally, never a mockup. In flight in a worktree.
- [ ] **Playtest 027 fixes** (session f8137211, 2026-08-09; `playtests/PLAYTEST_LOG_027.md`
  holds the transcript and analysis) — code-complete and merged, pending deployed
  verification: count asks read the quantity off taught have-facts (digits and number
  words); "X is what" rewrites into the what-is lane, with an adjective-qualified subject
  answering the head noun honestly; "can/could X be Y" reads the property and capability
  facts the plain ask reads; the ground-nothing hint names the asked subject; and the
  one-hop `⊑` inheritance gap is closed across property, capability and does-have lanes
  (all 20 infbench b2PropertyInheritance rows now pass, from 5). Candidates recorded in the
  log, not queued: possessive "a dogs name", compound-noun "human name", and the backwards
  instance teach "a human name is john".
- [ ] **News through the chat surface** — delivered: the `/news` lane assessment found the
  chat, CLI-chat and browser-chat paths all wired through one `newsTurn` seam with thorough
  existing pins (7 lane tests + 10 corpus rows, cited not duplicated), and index.html now
  carries a real three-turn `/news` transcript between the news and sprites plates, pinned in
  the index spec. Remainder: the standalone `tmct news` CLI verb defaults to `poll` while the
  in-chat `/news` defaults to showing the feed — a real divergence no test pins; resolve by
  PINNING both defaults as intended behavior (no CLI change), per the coordinator's stated
  default unless the operator asks to reconcile instead.

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
