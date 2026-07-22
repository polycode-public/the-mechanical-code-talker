# NEXT — current state & kickoff

**Every item here is DONE or OPEN — there is no in-between, and nothing is deferred.** Work we decide
not to do is deleted from scope, never negated in place or held as deferred. A chunk that is
delivered but still has a real remainder stays OPEN, with the remainder recorded in
`CLAUDES_LAST_RESORT_IS_TO_HIDE_THINGS_HERE_IDEALLY_YOU_COMPLETE_A_TASK_OR_NOT_BUT_DO_NOT_DEFER.md`.
Prefer deleting a sentence to negating it.

Living handover. Any session resumes from here. **Plan of record: the `PLAN_*.md` design docs** —
each states its own status in its opening lines; `archive/` holds the delivered ones. This file
holds ONLY what to do next. Completed work is not narrated here; `git log`, the `BENCHMARK_*.md`
reports and `CAPABILITIES_*.md` hold that record.

Session handles (inboxes): `tmct` and `tmct-hanoi`. See `~/.claude/inboxes/tmct.md` and
`~/.claude/inboxes/tmct-hanoi.md`; `mechanic.md` is retired.

## Open items

`archive/` holds delivered plan docs; each records what its delivery deliberately did not include.
Every item below was re-verified live on 2026-07-21 against a fresh `init:xl` graph (72,077 seeded
facts) plus the merged seonix+demo code graphs, in one continuous piped chat session —
`.tmct/session-019f8692-430d-79f3-9ee2-c38792f56746.log` holds the full transcript. The
filler-clause widening and planner-counterfactual design passes live in
`PLAN_FILLER_AND_COUNTERFACTUALS.md`. What remains here:

### Summary grid

Status vocabulary: *traced* (code anchors in hand, buildable), *design* (needs a decision or a
design pass first), *decided* (operator-decided design, anchors traced), *process* (an audit or
procedure, not a diff), *operator call* (a decision, not a build).

| # | Item | Status | Checked | Motivation | Likelihood it sticks |
|---|---|---|---|---|---|
| 9 | walled-asks cluster (router thing, big picture, entry point, …) | open — 8 of 10 phrasings fixed 2026-07-22; remaining: "tell me about the router thing" and "what is the purpose of the validate module" (honest misses now, want a design pass) | 2026-07-21 | natural phrasings of answerable questions | medium |
| 12 | in-game question routing guard | open, traced | 2026-07-21 | code answers inside a game, worst misroute class | medium-high |
| 13 | world-secret spoiler + predicate phrases | open, traced | 2026-07-21 | spoils the game, in garbled English | high |
| 14 | "look" digest corpus leak | open, traced | 2026-07-21 | room text must come from the world | medium-high |
| 16 | hanoi solve at xl | open, reproduced | 2026-07-21 | biggest live falsehood found | medium |
| 17 | live-Wikipedia trust prior | open, traced | 2026-07-21 | live must not outrank the pinned pack | high |
| 20 | wiki even-when-known (ask + supplement) | open, decided | 2026-07-22 | corroboration, not just rescue | medium-high |
| 21 | full-triple learn-on-miss ingestion | open, decided | 2026-07-22 | loads become durable knowledge | medium-high |
| 22 | auto bounded synthesis per ingest | open, decided | 2026-07-22 | new facts should connect | medium-high |
| 23 | `extract --optimistic` + `--canonical` | open, decided | 2026-07-22 | ingest real-world text | medium |
| 24 | glow-Markdown session logs | open, sampled | 2026-07-22 | readable transcripts; the sample is the spec | high |
| 28 | spider-fly observable-facts panel | open — browser panel shipped 2026-07-22; remaining: the chat phrasing lane over `beliefSnapshotFor` | 2026-07-22 | planners' knowledge made inspectable | medium |
| 29 | sense-splitting on read-back (Rover) | open, designed | 2026-07-22 | two concepts under one label | medium-high |
| 31 | ingest.html + ledger/chat ingest | open, new scope | 2026-07-22 | bring your own text | medium-high |
| 32 | full IndexedDB re-initialisation button | open — chat-page hard reset shipped 2026-07-22; remaining: ledger/adventure/spider-fly strips (rides item 31) | 2026-07-22 | recover any page from any state | high |
| 33 | triple-store export, every page | open — serializer + CLI/tool/chat-page export shipped 2026-07-22; remaining: other pages' buttons + TUI `/export` (rides item 31 / chat batches) | 2026-07-22 | data leaves in the standard shape | high |

The detailed items:

- Walled-asks remainder (item 9): "tell me about the router thing" (fuzzy "the X thing"
  resolution) and "what is the purpose of the validate module" (purpose-of phrasing over an
  unseen vocab noun) both now miss honestly instead of misrouting — the 2026-07-22 round fixed
  the other eight phrasings in the cluster. Both want a small design pass (closed template or
  resolver widening), not a lane rewrite.

- Games/plan lane gaps (page-vocabulary round, confirmed and extended live):
  - in-game questions misroute into code-graph lanes: "where am I?" → "no module matching I";
    "where is the spider?" → module ambiguity over `bench/sizer.mjs`; "what can I do?" and
    "what is the quest?" wall or answer corpus noise; "what is the goal?" mid-plan answers corpus
    vocabulary about "goal" instead of planState.
  - the describe lane spoils world secrets: "what is the letter?" reads back `letter hiddens in
    cabinet (world:ashcombe-hall)` — and those world predicates verbalize garbled ("hiddens in",
    "ises objective true"); `FACT_PREDICATE_PHRASES` (`chat.mjs:5523`) has no world rows. The
    describe lane should exclude world-secret predicates the way the adventure where-reader does.
  - the adventure "look" digest at xl leaks corpus facts into the room description ("Library is
    used for study for test. Lit rdfs:subClassOf literary study.").
  - NEW, largest: the hanoi solve fails against the xl graph — the full taught board + goal
    returned "no plan found within 300 moves" after ~2.5 minutes, while the same sequence passes
    the small-graph corpus tests. Suspect the goal's "every disk" enumeration (or the movable
    set) sweeps corpus members of "disk" at xl scale; the goal quantifier likely needs to range
    over taught instances of the taught class only. Reproduce with the session log's plan section.

- Live-Wikipedia trust prior: `reference:wikipedia-live` still parses as kind `reference` and
  scores the same `SOURCE_PRIOR.reference = 0.6` (`src/domain/memory/trust.mjs:94`) as the
  curated, revision-pinned pack. If live content should rank lower: one new source kind in
  trust.mjs plus a parse branch on the `reference:wikipedia-live` prefix.

- Knowledge flows — supplement, ingest, synthesise (operator-decided 2026-07-21). Four builds,
  each independently shippable, against the baseline traced below:
  1. "Ask Wikipedia even when I do know": both halves — an explicit phrasing ("what does
     wikipedia say about X") that reaches the live lookup any time, even when local facts
     answered; and a `/wiki` supplement mode where every grounded answer also appends the cited
     live supplement. Today the live lane runs strictly after the shipped packs and only on a
     clean miss (`cleanMissLiveKey` `src/services/chat.mjs:9564`).
  2. Full-triple ingestion of learn-on-miss loads, both surfaces. Today only the child pack
     ingests (the matched term's rows via `appendFacts`, `chat.mjs:9596-9608`, tagged
     `child:conceptnet:<term>`, prior 0.7); reference-pack and live-Wikipedia hits store at most
     ONE `rdfs:subClassOf` fact (`appendReferenceIsaFact` `chat.mjs:9613`, tags
     `reference:simplewiki:<title>@<revid>` / `reference:wikipedia-live:<title>@<revid>`) and
     the summary prose stays transient. Build: run the fetched summary through the extract
     recognizer (plus the optimistic tier from item 4) and store every grounded triple,
     source-tagged per source. On chat.html additionally fix persistence: IndexedDB saves only
     on teach turns (`via === "assert"`, `public/chat.html:658`), so even today's one isa fact
     is lost on reload — persist on any store write. Note the browser has no child-pack provider
     registered (`chat.html:710` registers reference only), so that lane is idle there; the boot
     seed itself is NOT lazy (the whole capped payload assigns at boot, `chat.html:431-452`).
     Audit finding (2026-07-22, ledger round), fold into this build: for a rule-only concept
     the user taught (e.g. a `grandfather` filter rule), the miss→child-pack fallback silently
     answers from unrelated `conceptnet:grandfather` content instead of surfacing the taught
     rule — taught knowledge must outrank the child-pack load on the same term.
  3. Synthesis, auto + manual: after each ingest, a bounded focus-scoped materialisation pass
     (the `expandFocus` frontier around the loaded term) connects the new facts back to the
     graph; the full-batch `tmct syllogise` / `/syllogise <term>` verbs stay for deep passes.
     Today nothing runs automatically — `syllogise()` is manual only (`bin/tmct.mjs:1131`,
     `chat.mjs:12185`), derived facts write under `entailed:*` at prior 0.3, retractable.
  4. Raw-text optimistic ingest from the CLI: `tmct extract --optimistic` fuzzy-word-matches the
     sentences the strict recognizer skips (today every non-assert sentence is silently dropped,
     `src/services/extract-facts.mjs:112-114`) into candidate facts under a NEW lower-trust
     source kind, plus a `--canonical` output mode printing each ingested fact in canonical form
     enriched with its links back to the existing graph (today facts store standalone; no
     linking exists on the extract path). Trust work shared with the live-Wikipedia prior item
     above: distinct source kinds (live, optimistic-extract) with their own priors in trust.mjs,
     so fuzzy and live content rank below the curated packs by construction.

- Session logs become glow-friendly Markdown. `.tmct/session-<id>.log` moves to
  `session-<id>.md`: a `#` title carrying version/repo/start, one `###` heading per turn with a
  time-of-day timestamp at millisecond precision (drop the full ISO date from every turn), the
  user's line as a `>` blockquote (verbatim — the multi-sentence/rewrite log bugs above apply
  here too), the reply in a fenced block, and a closing session-end line. A hand-made sample of
  a real 101-turn session sits at `.tmct/session-019f8692-430d-79f3-9ee2-c38792f56746.md`
  (render with `glow`) as the target look. Writer: `src/services/chat-session.mjs`
  (`SESSION_LOG_DIR`, the per-turn `logLines` built at `chat.mjs:11982`); check the e2e that
  reads the log file for the extension change.

- spider-fly observable-facts, the chat half: the browser panel ships (click the spider or the
  fly to see the facts that agent can observe, over `beliefSnapshotFor` in
  `src/services/spider-fly.mjs`); the same read path still wants a chat phrasing ("what does
  the fly see?") so TUI/CLI/serve inherit it — build that lane beside the game lanes.

- Sense-splitting on fact read-back, with the class hierarchy shown. Live case (operator,
  2026-07-21): "What is Rover?" returns `rover is a kind of dog (ace:chat …)` and `rover is a
  kind of scout (corpus:human-large)` as one flat list — two concepts sharing a label, rendered
  as if one thing. Under the open-world reading two mentions of "rover" are not the same
  individual by default (OWL's non-unique name assumption); today the read-back neither shows
  the hierarchy above each is-a object nor notices that the hierarchies never meet. Build, all
  deterministic over the stored graph, no new vocabulary:
  1. Extend the fact-list answer to show each is-a object's superclass chain (the transitive
     `rdfs:subClassOf` closure the read-only proof kernels already walk — `findIsaChain`,
     `src/domain/syllogise.mjs`), capped: "rover is a kind of dog → canine → mammal → animal".
  2. Detect distinct concepts from the end triples: for every pair of same-predicate end
     objects (here `dog`, `scout`), compare their ancestries. Distinct when (a) any ancestor
     pair is stored or derivable `owl:disjointWith` (the cax-dw kernel already computes this);
     else (b) the least common subsumer (Cohen, Borgida & Hirsh 1992) is the root/⊤ or sits
     above a depth threshold — equivalently a Wu-Palmer (1994) depth-ratio similarity or a
     Resnik (1995) information-content score of the LCS below threshold, both computable
     deterministically from the stored closure (IC from stored fact counts, never a model);
     else (c) the ancestries are wholly non-intersecting below the root. The literature name
     for the task is word-sense discrimination / instance-level entity resolution; the OWL
     rendering of the verdict is an implicit `owl:differentFrom` between the two senses.
  3. When senses split, group the whole answer by concept — "rover, the dog: …" / "rover, the
     scout: …" — same capped-list/pending conventions; when the check is inconclusive keep
     today's flat list (grouping is presentation, never retraction — trust and contradiction
     handling unchanged). Apply wherever a fact list renders (`factReadBackReaders`,
     `chat.mjs:7660`), not just "what is X".

- The ingest surfaces and store controls on every tmct-embedding page:
  - ingest.html — a clean two-pane layout in the translate-tool idiom (operator screenshot,
    2026-07-22): minimal chrome; mode pills across the top (Text | Document); left pane a
    roomy free-text area accepting paste and drag-and-drop, with a browse-for-file control;
    right pane the canonical facts rendering live as the pipeline grounds them, distinct from
    the input by a soft panel background; a single action row (ingest, download canonical,
    clear) under the panes. Behind it: the ingest pipeline (the extract recognizer plus the
    optimistic tier and canonical/graph-linked rendering from the knowledge-flows item above),
    writing grounded facts to the page's store and offering the canonical output for download.
  - ledger.html gains the same ingest affordance (paste/drop/browse), so new data can be
    ingested and then examined in place; chat.html gains a file upload that feeds the same
    pipeline.
  - store controls, the remainder: chat.html shipped both (hard reset-to-seed + JSONL fact
    export over `src/adapters/memory/export-jsonl.mjs`, 2026-07-22). This page pass extends
    the export button to ledger.html and settles export/hard-reset for adventure/spider-fly
    (their persisted payload is game state with its own full reset).

## Where each item lands — code, tests, docs, channels

**Channel audit (2026-07-22).** The channel set for "surfaced everywhere applicable" is: the
browser pages, the Ink TUI, the plain-shell CLI and its verbs, the JS library exports
(`package.json` `exports`), the HTTP serve endpoint (`tmct serve`, POST /v1/messages), the graph
tool layer (`tmct cli` / `dispatchTool` / `TOOLS.md` / `TOOL_DEFINITIONS`), and — new with item
30 — the Electron shell. The operator's named four (browser, TUI, CLI, library) missed serve and
the tool layer, which we already ship; both are folded into the entries below wherever they
apply. Chat-lane fixes (items 1-16, 29) inherit every chat channel at once — TUI, plain CLI,
browser bundles, serve, and library `runChat` all call the same `runTurn`.

- **9 remainder, the two walled asks.** Code: `chat.mjs` — a closed template or resolver
  widening per the detail bullet; design first. Tests: corpus rows in the `template.*` lane.
  Channels: inherit.
- **12-14 + 16, games/plan.** Code: lane-precedence guard while a game slot is live
  (`src/services/adventure.mjs` / `spider-fly-turn.mjs` interception boundary); world-secret
  predicate exclusion in the describe lane the way the adventure where-reader already excludes;
  curated world rows in `FACT_PREDICATE_PHRASES` (`chat.mjs:5523`); a world-source filter on the
  look digest (`worldDigestRows`); hanoi-at-xl —
  scope the goal quantifier's member enumeration to taught instances (`src/domain/planning.mjs`
  `findActionPath` callers + the goal-teach reader around `chat.mjs:2299`). Tests: unit in
  `test/corpus/games/*.jsonl` rows + `test/services/spider-fly.test.mjs`; the hanoi fix gets a
  seeded-corpus regression test (board + corpus noise in one store); no e2e. Docs: none.
  Channels: inherit; the hanoi fix also protects serve callers.
- **17, wiki trust prior.** Code: one source kind + a `reference:wikipedia-live` parse branch in
  `src/domain/memory/trust.mjs` (`SOURCE_PRIOR`, `:94`). Tests: `test/adapters/
  chat-inference-trust.test.mjs`, `provenance.test.mjs`. Docs: README's trust/provenance table
  row. Channels: core ranking — every channel inherits.
- **20-23, knowledge flows.** Code: as traced in the item (`cleanMissLiveKey` `chat.mjs:9564`,
  `appendReferenceIsaFact` `:9613`, `appendFacts` `:9596`, `public/chat.html:658` persistence
  trigger, `src/services/extract-facts.mjs:112` skip point, `syllogise.mjs` `expandFocus`).
  Tests: unit — `chat-reference-lane`, `child-pack`/`chat-child-lane`,
  `extract-facts-from-text`, `syllogise` test files; tool level — new cold tools (`tmct_ingest`,
  `tmct_export`) pin in `test/tools/server.test.mjs` and regenerate `TOOLS.md`
  (`test/estate/tool-docs.test.mjs` guards the drift); e2e — extend
  `e2e/pages-chat-live-toggle.test.mjs` (supplement mode) and `e2e/web-chat-memory.test.mjs`
  (ingested triples persist). Docs: README (Wikipedia section, the extract verb, the trust
  table); chat.html's toggle copy gains the "even when I know" mode. Channels: browser + TUI +
  CLI inherit the chat lanes; CLI adds the `extract` flags; library exports gain the ingest
  entry point (extend `package.json` `exports` with the extract/ingest service); serve gains
  nothing (ingest by API is out of scope until asked); tool layer gains the two cold tools.
- **24, glow session logs.** Code: `src/services/chat-session.mjs` (`SESSION_LOG_DIR`, the
  writer at `:246-258`) + the `logLines` shape (`chat.mjs:11982`); align the browser transcript
  export (`chat.html`, shipped 2.9.x) to emit the SAME Markdown shape — one format, two
  writers. Tests: unit on the session-file shape; `e2e/tui-chat-file.test.mjs` reads the log —
  update it. Docs: README's session-log line + `bin/tmct.mjs` help text ("Session log → …").
  Channels: TUI/CLI writer + browser export; library consumers get it via `createSession`
  unchanged.
- **28 remainder, spider-fly chat lane.** Code: a chat phrasing ("what does the fly see?")
  over `beliefSnapshotFor` (`src/services/spider-fly.mjs`), built beside the game lanes.
  Tests: a corpus row in the games lane + `test/services/spider-fly.test.mjs`. Channels: all
  chat channels inherit.
- **29, sense-splitting.** Code: a pure sense-cluster utility in `src/domain/` (ancestry
  intersection, LCS depth/IC threshold, disjointness veto — reusing `findIsaChain` and the
  cax-dw kernel read-only) + grouping in `factReadBackReaders` (`chat.mjs:7660`). Tests: unit
  (new `test/adapters/sense-split.test.mjs` beside `chat-reference-lane`); tool level in
  `test/tools/ask.test.mjs` if ask() lists adopt grouping; corpus rows in the `template.*`
  lane. Docs: README's answer-shape section; the ledger page renders grouped senses naturally.
  Channels: all chat channels inherit; `tmct viz`/ledger rendering optionally groups.
- **31, ingest surfaces.** Code: new `public/ingest.html` + `src/surfaces/web/
  ingest-browser-entry.mjs` in the translate-tool two-pane idiom (mode pills Text | Document,
  paste/drop/browse left, live canonical render right, one action row); `ledger-viz.mjs` dock
  gains the same affordance; `chat.html` gains the file input. All three feed the one ingest
  pipeline (items 21/23). Tests: unit rides the extract tests; e2e — new
  `e2e/pages-ingest.test.mjs` (paste → canonical → download) plus extensions to the ledger and
  chat page e2e. Docs: README pages list + a home tile. Channels: browser here; CLI parity is
  `tmct extract`/`import --file` (+ the new flags); TUI parity — add an `/ingest <path>` chat
  command so a terminal session can ingest a file without leaving chat; library parity —
  export the extract service; tool layer — the `tmct_ingest` cold tool (item 20-23).
- **32-33 remainder, store controls on the other pages.** Shipped 2026-07-22: the serializer
  (`src/adapters/memory/export-jsonl.mjs`), `tmct memory --export`, the `tmct_export` cold
  tool, JSONL import via `tmct import --file`, and the chat page's export button + hard
  reset-to-seed. Remaining, riding item 31's page pass: the export affordance on ledger.html
  (it embeds a memory payload but has no IndexedDB persistence, so re-init is N/A there) and
  an export/hard-reset decision on adventure/spider-fly (their persisted payload is game
  state, and their reset already re-inits it); plus the TUI `/export <path>` alias over the
  serializer, riding a chat batch.

## Discipline

`CLAUDE.md` is the standing working model: the coordinator/background-sub-agent split, the test
blast radius, the versioning and push rules, and the repo-local identity. Read it there. This
section holds only what `CLAUDE.md` doesn't.

Three hard-won lessons, carried forward:

1. Background sub-agents sharing one working tree (no worktree isolation) can and did run
   destructive/shared git operations (`git stash`) meant only for the coordinator — recovered
   without loss, but now explicitly called out in every dispatch brief: sub-agents may only
   `git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`.
   Also: the harness's permission system blocks `git commit` for *background* sub-agents entirely
   in some configurations (no live user to approve a permission-gated action) — the coordinator does
   the committing itself in the foreground when this happens, verifying `git status` immediately
   before every stage to avoid sweeping in another track's pre-staged files. (Re-proven 2026-07-15:
   a `git add -A` swept another session's untracked design doc into a commit — caught and amended
   out. List paths explicitly, or review `git status` line by line first.)

2. A background sub-agent's own final "completed" notification is not reliable proof it actually
   finished — an agent reporting a vague "I'll wait for the Monitor notification" as its terminal
   output is a sign of unfinished work, not a status update, even when its worktree in fact holds
   complete, real, committed work. Always verify via `git log`/`git status` on the agent's own
   worktree directly before deciding whether to resume it or treat it as done — trust the commits,
   not the prose. An agent stuck repeating the same "still waiting" message across multiple
   notifications is a sign to `TaskStop` it explicitly rather than keep resuming, once its worktree
   confirms the real work is already complete.

3. Never resume (`SendMessage`) a round whose worktree has already been auto-removed — relaunch
   fresh instead. This was observed twice: once an agent fell back to operating directly in the
   coordinator's own shared working tree; on a later occasion this went as far as checking out a
   brand-new branch on the shared worktree itself (caught immediately via `git branch
   --show-current` returning something other than `main`, no work lost). The rule: before resuming
   any stalled round, check `git worktree list` for its path
   — if it's gone, `TaskStop` that round and dispatch a fresh one instead, never `SendMessage` it
   back to life.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history, plus the `BENCHMARK_<axis>_<version>.md` reports and `archive/`.*
