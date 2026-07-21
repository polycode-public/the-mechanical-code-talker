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
`.tmct/session-019f8692-430d-79f3-9ee2-c38792f56746.log` holds the full transcript. What remains:

- Memory/taught-class list & count — the `archive/PLAN_CLASS_QUERY.md` remainder. Its Phase 1
  shipped without the plan (live: "how many facts about horses are there" → `18 facts. (about
  "horses")` — `answerMemoryCount` grew its own tail discipline, `MEMORY_COUNT_ABOUT_TAIL_RE`
  `src/services/chat.mjs:788` + `memoryFactsAboutCount` `:793`; the plan's proposed bare decline
  would now be a regression). Still missing, live-confirmed:
  - `list facts` / `list utterances` fall to the code-graph compositional miss. The tested
    mechanism (`dynamicClassQuery` `src/domain/ask.mjs:4082`, `resolveDynamicClass` `:4066`,
    trigger REs `:4073-4074`, all unexported) never sees memory individuals from chat. Fix: a
    memory-class list/count lane in `runTurn` beside `answerMemoryCount` (`chat.mjs:13424`),
    loading via `await import("../adapters/memory/core.mjs")` like its siblings (`:841`),
    rendering with `FACT_ANSWER_CAP = 32` (`:6161`) and the `pending`/"say 'more'" continuation
    (`:7779`). Also covers the memory meta-classes Session/Source/Rule — today "how many sessions
    are there" answers from the CODE graph's Session class, not the store.
  - `how many animals are there` — no count over a taught class's members. The two-noun
    quantifier lane swallows it first ("I was never told a quantifier": `HOW_MANY_ARE_RE`
    `chat.mjs:745` reads "there" as the second noun), so the new count either precedes
    `answerQuantifierRecall` (`:13436`) or that regex excludes "there". Count body: mirror the
    reverse-membership branch in `factReadBackReaders` (`chat.mjs:9037-9070` — note it lives
    there, NOT in `factAnswer` as the archived plan says), `objectHits` at `:9065`, return
    `hits.length`.
  - `list all animals` / `list the animals` — compositional miss. Fix: one more `else if (!term)`
    arm after the bare what-is fallback (`chat.mjs:9058-9061`) matching
    `list|show (all|the) <noun>`, with a restrictor-tail decline (export `DYNAMIC_TAIL_OK_RE`
    `ask.mjs:4077`, or reuse chat's own filler-tail set `:783`).
  - `count all facts about horses` — the count regex (`chat.mjs:814`) captures the word after
    "count", which is "all". Allow an optional `all `.
  - Related pattern, found this round: at xl scale "what is an animal" fills its cap with forward
    corpus facts, so the reverse-membership listing never shows — a membership-list answer needs
    its own trigger, not the definition lane's leftovers.
  - Test homes: `test/adapters/wiring-facts-memory.test.mjs` (chat-reachable memory lane),
    `test/adapters/chat-reference-lane.test.mjs` (membership count/list),
    `test/adapters/ask-memory-class-query.test.mjs` (ask-level pins),
    `test/adapters/showcase.test.mjs` (session-count pin).

- CONVERSATION persona-sweep remainder (`BENCHMARK_CONVERSATION_2.7.11.md`): 15 of the 29 routed
  items landed between 2.7.12 and 2.9.6 and re-verified fixed live this round (teach period,
  2-hop property inheritance, write boundary, meta-questions, disjointness object-walk,
  contradiction disclosure, arithmetic decline, the suggested-repair cluster). Still open, with
  fresh shapes from the live session:
  - filler-clause widening: "ok so" now strips; "oh nice. um what about cats" and "one more
    random thing, what is a horse" still unparse. Longer clause shapes need their own design pass.
  - silent narrowing without disclosure: "what's in src/handlers" answers one module's members;
    with two graphs merged, "is model.mjs not imported by store.mjs" silently picked seonix's
    `src/store.mjs` over the demo's `src/core/store.mjs`, and "what functions are in Task"
    resolved to the wrong entity (`TASK`) then reported no members.
  - plan-justification counterfactuals ("why did you move disk-1 first instead of disk-2?",
    "what if disk-1 started on peg-c instead?") — the BFS computes no untaken path today
    (`chat.mjs:2361-2365` records the decision); still unparsed.
  - verbatim-input instrument bugs, two fresh instances: the session `.log` rewrote "what people
    do you know about" to `> what is a person`, and a multi-sentence teach line logs only its
    last sentence ("disk-1 is a disk. disk-2 is a disk. disk-3 is a disk." → `> disk-3 is a
    disk.`). The `.jsonl` sidecar keeps both forms; the `.log` restoration misses these paths.
  - farewells/dismissals: "ok nvm" and "lol ok" get the identity blurb; the long thanks-farewell
    ("alright, i think that's everything for today, thanks so much for the help!") now misroutes
    into a teach decline about the pronoun "i" — worse than the wall it used to hit.
  - still-walled asks: "tell me about the router thing"; "give me the big picture on this
    codebase" (now with a stray "Did you mean BIG?"); "what is the entry point"; "what is the
    purpose of the validate module"; "prove that X is Y"; "isn't a dog an animal?" (contracted
    negative interrogative); the multi-sentence syllogism one-liner still doesn't split. "where
    do i start reading" now misroutes to where-is-defined and confidently answers
    `renderArchitecture()` — worse than its 2.7.11 wall. "whats the most important file" now
    names its rank criteria but still picks no default.
  - adjective predication cannot yet teach: "every snake is venomous" declines claiming
    "venomous" is unknown even though "snake" is grounded — the every-X-is-Y frame wants a noun
    class on the Y side; no adjective-attribute teach shape exists yet.
  - guess-number non-numeric mid-game turn now falls to a plain parse miss (no vocab-learn write
    observed) — downgraded from state mutation to a flow wall.

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
  - the teach frame still declines a determiner subject: "the tower has 3 disks." misroutes to
    ask(defines); bare "tower has 3 disks." teaches.
  - NEW, largest: the hanoi solve fails against the xl graph — the full taught board + goal
    returned "no plan found within 300 moves" after ~2.5 minutes, while the same sequence passes
    the small-graph corpus tests. Suspect the goal's "every disk" enumeration (or the movable
    set) sweeps corpus members of "disk" at xl scale; the goal quantifier likely needs to range
    over taught instances of the taught class only. Reproduce with the session log's plan section.

- Live-Wikipedia trust prior: `reference:wikipedia-live` still parses as kind `reference` and
  scores the same `SOURCE_PRIOR.reference = 0.6` (`src/domain/memory/trust.mjs:94`) as the
  curated, revision-pinned pack. If live content should rank lower: one new source kind in
  trust.mjs plus a parse branch on the `reference:wikipedia-live` prefix.

- Chat-seed scale: `SEED_BAND_CAPS` (`scripts/build-chat-seed.mjs:46`) still caps conceptnet at
  2,000 facts and wordnet-xl at 4,000 because the uncapped init:xl set measures ~86 MB
  serialized. Lifting the caps means leaving the 16-24 MB seed ceiling range — an operator call.

- The ledger query-template phrasing audit (`archive/PLAN_SIX_EASY_PIECES.md` Part B promised
  it; it was dropped from the 2.9.1-2.9.5 delivery — no commit does it). To do: audit the ledger
  page's existing query-template library for phrasing gaps the same way the spider-fly, adventure
  and plan audits were done (`4285d0f` is the pattern to follow), and route what it finds either
  into template rows or here. (One other residual is recorded there: live-Wikipedia's wider
  miss-hook past the lexicon gate was a stated non-goal, now superseded by the knowledge-flows
  item below.)

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

- Home page tiles (`e2e/pages-index.test.mjs` pins hero order and labels — update it with the
  strings): the adventure tile gets a few character sprites composed over its icon,
  movie-poster style; the sprite-library tile shows a range of sprite sizes instead of one; the
  chat tile is labelled "Chat" (not "Talk to it") and gets an icon; the spider-fly tile line
  "Two agents, planning against each other" becomes "multiple competing planning agents" and
  gets an icon (both tiles keep their text links — the icons are additional); the adventure
  line "A text adventure, with a room you can actually see" becomes "Location aware inference".

- adventure.html layout (`src/services/adventure-viz.mjs`): quest and satchel become
  full-width strips sized to the room view — quest strip on top, satchel strip under it, then
  the room — and the reset/play/step + turn-count controls become one strip of the same width
  pinned directly below the room. This removes the dead gap under the room view whenever the
  right-hand column runs longer than the scene (operator screenshot, 2026-07-22).

- spider-fly.html (`src/services/spider-fly-viz.mjs`): the tuning strip shortens to match the
  grid's width; the TURN block joins the reset/play/step cluster; the hero line "A spider in
  its web, a fly on the board — each planning against the other" becomes "multiple competing
  planning agents"; and clicking the spider or the fly expands a section beside that agent in
  the agents box showing a text rendering of the facts that agent can currently observe (the
  engine's per-agent belief/exposure set, `src/services/spider-fly.mjs`).

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

- Two new demo pages, and store controls on every tmct-embedding page:
  - code.html — the ledger.html pattern (readable fact-sentence ledger + chat dock) refocused
    on a CODE graph: viewing and hinting for exploration — imports/calls/contains neighborhoods
    around a focus symbol, with suggested next queries drawn from what the graph actually holds
    (the compositional query shapes the chat already answers). The demo code graph
    (`public/demo-graph.json`) is the obvious seed.
  - ingest.html — takes a multi-line text block, a drag-and-dropped document, or a
    browse-for-file; runs it through the ingest pipeline (the extract recognizer, plus the
    optimistic tier and canonical/graph-linked rendering from the knowledge-flows item above);
    writes the grounded facts to the page's store; renders the canonical form of what was
    ingested; and offers that canonical output for download.
  - ledger.html gains the same ingest affordance (paste/drop/browse), so new data can be
    ingested and then examined in place; chat.html gains a file upload that feeds the same
    pipeline.
  - every tmct-embedding page gets a button forcing a FULL re-initialisation of its IndexedDB
    store (drop the persisted payload and re-seed from the page's shipped seed — a harder reset
    than chat/adventure's existing "forget everything"), and a triple-store export (download
    the page's current facts as JSONL in the tmct/ConceptNet shape `tmct extract` already
    emits, provenance included).

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
