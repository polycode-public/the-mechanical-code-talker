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
that A was never actually finished.

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

News-card work runs through the `news-feed-quality` skill
(`.claude/skills/news-feed-quality/SKILL.md`).

The work list, ranked by value.

1. [ ] **A declared switch decides the code-graph lane, never a guess at the
   input.** `looksCodeish` reads any full stop, decimal, date slash or
   abbreviation as a code token through `[_./]`, and carries `where`, `use`,
   `class`, `history`, `test`, `contains` and `members` in `STRUCT_WORDS`, so 26
   of 27 ordinary sentences classify as code-ish. It goes, with `STRUCT_WORDS`
   and the appended `no code graph — index it with...` remedy. A `/code-graph
   on|off` session switch replaces it, shaped like `/wiki`, with a consumer
   parameter beside it so an embedding application sets the mode without a slash
   command. The switch is the only gate: no default derived from state, off
   unless set, and a graph missing while the switch is on is an error rather
   than a hint. With the switch off nothing may say "code graph" at all, and a
   question that wanted the lane lands on the ordinary miss wall. `noCodeGraph`
   stays — it reads a loaded graph's module count, which is state, not intent.
   `isConversational` is exported, so any change to its behaviour is
   consumer-visible.
2. [ ] **Reshape the seed's band set.** `child`, `namenet` and `domains/code`
   seed, and `aws`/`python`/`java` are purged. Two parts are still open.

   `prose` is not a band. `corpus/prose/` is 80 `.txt` files with a sha256
   manifest, and nothing in the repo turns that prose into `{start, rel, end}`
   rows — `corpus/generated/ace-surface-variants.jsonl` is a sentence-rewrite
   log, not triples, and its own README puts it outside the product path.
   Making `prose` a band needs an extraction step that does not exist yet.
   `scripts/template-coverage.mjs` already measures how much of that prose the
   ACE grammar parses, so its coverage number is where to start sizing the work.

   The browser seed carries 2,000 of the child band's 58,552 new facts. The
   uncapped set is 174.2 MB against a 100 MiB `SEED_BYTE_CEILING`, so
   `SEED_BAND_CAPS` caps `child` and the shipped asset lands 1.5 MB under the
   ceiling. Two levers, both changing what the deployed demo can answer: hand
   `conceptnet`'s cap (28,000 today, 36.4 MB) to `child`, or raise the ceiling,
   which needs `test-e2e/pages-chat-boot-budget.test.mjs` re-measured in a real
   browser first.
3. [ ] **`appendFacts` costs more the fuller the store gets.** `tmct import
   --corpus child` on the sqlite backend takes about 9 minutes wall for 68,955
   facts, with the WAL peaking near 240 MB. The in-memory path is unaffected —
   the same 127,404-fact `init:xl` set seeds in about 13s in-process. This is
   why `npm run init:xl` and `npm run check:readme`'s heavy block are now
   ten-minute commands. Promoted out of item 1 rather than held as its
   remainder: the cost is in the engine's own append path, not in the band set
   that exposed it.
4. [ ] **A config naming a purged band takes the CLI down.** `tmct.toml` files
   written before the purge still carry `[extensions.tier2-aws]` and its two
   siblings. `mergeExtensionEntry` reads an unrecognized name as a
   host-supplied bundle, so the user gets `an unrecognized extension needs a
   "kind"` — an error about their own config, for a band tmct used to ship.
   Anyone who runs `npm i -g` over an existing install hits it. Either the
   resolver skips a name it once shipped and says so, or the purge is a major
   version bump with the edit in the release notes.

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
