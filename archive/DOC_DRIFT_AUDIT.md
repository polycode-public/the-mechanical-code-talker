# Where the docs and the code disagreed

An audit of every public claim in `README.md`, the `PLAN_*.md` docs and `docs/`,
read against the code rather than against the prose. The product's whole claim
is that it does not guess, so a doc that overstates what it does is the worst
kind of bug it can have.

Sixty-one disagreements found. Fifty-nine fixed here. Two are recorded below as
open, with the reason.

## README.md

| claim | what the code says | what happened |
|---|---|---|
| `public/` is "a gitignored output of `npm run demo:build`, never hand-edited" | 55 files are tracked, including the home page, the eleven about pages, `site.css`, the shims, the model assets and the screenshots. `.gitignore` names specific generated artifacts, not the directory | rewritten |
| the layout table omits `infra/` | a tracked top-level CDK app, not a dotfile, so line 42's escape hatch does not cover it | row added |
| "tmct *consumes* a code graph… It does not build one" | `tmct index` builds one. The same README says so two screens down, and `package.json`'s description says it too | corrected |
| the full command reference "is that same output" | `tmct index` and its `--no-history` flag were absent, as were the `tmct --help` line and the two closing notes on the TUI and the session-log path | three blocks added, all verbatim against live `--help` |
| the tmct.toml block sets "every recognized key" | five were missing: `[graph] read_only`, `[seed] capture_unknown_context`, `[seed] unknown_context_limit`, `[research]`, `[discourse]` | all five added |
| `[tune] embed_rank` | no loader entry, no consumer, no test. The only occurrence in the repo was the README line | deleted |
| `[games.spider-fly] vision_radius`, `eggs_eaten_threshold` | the key map has `spider_vision_radius`, `fly_vision_radius` and `egg_lay_mass_threshold`, plus `egg_hatch_count` and `min_hatchling_mass` the block never listed | corrected and completed |
| "eight more pages" | `DEMO_PAGES` has eleven. research, mud and mudiii went unnamed | rewritten |
| the sprite dock answers from "1,033 generated sprite facts" | `corpus/sprites/src/sprite-facts.jsonl` holds 1,480 | corrected |
| `corpus/reference/` holds "3,887" summaries | its own manifest counts 3,888 | corrected |
| "Three offline benchmark rigs live in a clone" | seven, all with npm scripts. The README's own layout table already named all seven | corrected |
| `PLAN_NORMATIVE.md` | lives at `archive/PLAN_NORMATIVE.md` | path fixed |
| `fuzzy.mjs` | lives at `src/domain/interpret/fuzzy.mjs` | path fixed |
| "~13,609" for the large persona | the help text the README quotes says ~13,600 | aligned |

Two walls reframed:

- "The desktop build below is for exploring your own repo or graph, **which the
  hosted page cannot reach**" → the page has no filesystem access, so it reads
  the demo graph it ships with.
- "`mgx:updatedAt` is an audit stamp, so tmct **cannot** answer what it believed
  last Tuesday" → that question lands on the honest miss wall.

One wall left alone after checking: "a fuzzy guess can never corroborate a
curated fact" is an honesty invariant, and "the LLM agent stays outside tmct" is
the constitution. Neither is covered by the rule.

## The `PLAN_*.md` status lines

Nineteen docs, nineteen status lines checked. Fifteen were true. Four were not.

| doc | claimed | actual |
|---|---|---|
| `PLAN_MUD_WEBRTC.md` | "the scenarios needing three or more peers are still design" | mesh introduction ships. `p2p-room.mjs` sends the peer list and the intro-offer, and `p2p-mesh-three-peers.test.mjs` and `pages-mud-p2p-mesh.test.mjs` cover it |
| `PLAN_MUD_WEBRTC.md` | "no OR-Set or last-writer-wins predicate to build yet" | retraction ships and replicates over the mesh, with a causal-stability rule behind a gate |
| `PLAN_MUD.md` index | MUDIII "DESIGN", and the 3+-peer line repeated | `mudiii.html` is live |
| `PLAN_OUDEZIJD.md` dependency table | shared persistence "designed, not yet built" | the P2P/CRDT half shipped; Backend D is what the plan waits on |

`PLAN_BARTLE.md` had no status line at all and reasoned from "a rename of one
**unshipped** page". It now carries one, and records the gap: the operator's
sequencing asks for credit-line prose naming MUD1/MUD2 and Trubshaw/Bartle on
the page, and `mudiii-about.html`'s credits cover only the model assets.

## Capability walls purged

Every quote below described a tmct capability or design extension.

- `PLAN_MUD_SERVER.md` — "explicitly **ruled out** this session (Lambda **has no
  mechanism** to accept an inbound SSH/TCP connection directly)". Now: Lambda's
  invocation model takes an event, not a connection.
- `PLAN_MEMORY_BACKEND_AWS.md` — "already **ruled out** for this … a correct
  call, **not something to revisit**". The strongest one found: it closed the
  option and pre-empted re-examination in the same clause. Now states which seam
  the work belongs on.
- `PLAN_EMBEDDINGS.md` — "It has **no path at all** from `talks to` → `uses`" and
  "That axis **has no instrument in the tree**". Now: does not carry, and no
  instrument *today*.
- `PLAN_MUD_MUDIII.md` — "makes the Tier-C trap **structurally impossible**" and
  "the overhead camera is **inherently** local".
- `PLAN_PARAPHRASE_VERIFICATION.md` — "checked and **ruled out** as the vehicle
  here" and "Yes, and **ruled out** for this specific job".
- `docs/references/papers/crdt.md` — "a suppressed assertion comes back only
  under a later instant, **never** under its own identity", contradicted by the
  doc's own horizon three hundred lines later; and the roster table's "**never**,
  by design".
- `docs/references/README.md` — "Its **load-bearing** point".
- `docs/adapter-contract.md` — "takes even the session-observation write **off
  the table**".

Left alone after checking, with the reason:

- `PLAN_MUD_SERVER.md`'s "a **hard ceiling** on the guest server's cost" — a
  deliberate budget cap on an AWS-documented throughput limit. A decision, not a
  claimed impossibility.
- `PLAN_AWS.md`'s and `docs/AWS_SETUP.md`'s "10 MB compression ceiling" —
  CloudFront's own documented limit.
- `PLAN_SYLLOGIST_EL_DL.md`'s "silent weakening is impossible" and "a timeout is
  a miss, never a guess", `PLAN_DISCOURSE_AND_RECOGNITION.md`'s "Ambiguity is a
  refusal, never a pick" — honesty invariants.
- `PLAN_CODE_PLANNING.md`'s "no LLM in the product path, ever" — the constitution.
- `PLAN_OUDEZIJD.md`'s "**None of the five are claimed unreachable**" — the rule
  being followed, not broken.
- crdt.md's characterisations of published data types (G-Set "nothing ever
  leaves", 2P-Set tombstones "kept for good") and its citation of Theorem 2.2 —
  published results, not claims about tmct.

## `docs/references/papers/crdt.md`

It did read as two stacked layers, in two places.

**The OR-Set section.** Thirty lines argued the choice in the future conditional
— "The price **is wrong**", "Tombstones **would damage** that record", "**Adopting**
OR-Set semantics **would mean building** causal delivery first" — and the
thirty-first opened "Two tombstones **exist**". A reader was persuaded of a
decision that the next line revealed had already shipped. The section now opens
with where the code is and argues from there.

**The causal-stability section.** It opened "Nothing **yet** says when one has
done its job" and closed with a heading called "What ships now". Between them sat
a numbered build list whose third item was "already written". The list lost that
item, the opening now says the rule exists and retires nothing, and the closing
heading says which half is missing.

Four factual corrections in the same file:

- the header claimed **every** citation was checked against a primary source.
  Four were not, and each says so where it appears. The header now says which.
- "The **two** claims about tmct's own merge behaviour … were checked by running
  the code" against a nine-row probe table.
- "the base relation keeps growing" over-generalised. `removeFacts` really does
  drop the matched Fact individuals from the local store, and `retireRetractions`
  deletes Retraction rows. What is grow-only is what *replicates*.
- the "deleting from a replicated set is hard" quote was attributed to
  `assertionGroupsFor` and misquoted. It belongs to `isAbsorbedSource` in
  `compaction.mjs`.

And one under-claim: "the gate is the missing input" was too kind. Nothing in
`src/`, `bin/` or `scripts/` calls `retirableRetractions` or `retireRetractions`
at all — the tests are the only callers. The doc now says so.

Duplication cut: the "OR-Set tombstone would hole the provenance record" argument
appeared as two consecutive verdict bullets. They are one.

## `docs/public-examples.md`

Every README and `index.html` line number in it had rotted, and nothing fails
when they do. Rows now name the section instead. Three counts it certified as
matching no longer do:

- "11 edge kinds" — `EDGE_KINDS` has 13.
- SEON's "9 relations" — `relations.jsonl` has 11 rows. The drift is in
  `corpus/domains/code/README.md`, which this table was echoing.
- chatbench's "138 cases" — `graded-pool.jsonl` has 139, and its own README says
  138 in three places and 139 in a fourth.

WordNet's 107,526 synsets is an upstream figure the manifest does not carry, so
nothing in the repo can check it. The table says that now rather than claiming a
match.

One live example had disappeared entirely: the `what is a dog` / `what is a
quokka` transcript is now only an image alt text, so its row went.

**Verified in a later pass, and found to have rotted again:** the section-name
fix above covered the file's `## README.md` table but missed a second table,
under `## examples/`, that still cited raw line numbers (`README.md:59`,
`README.md:137`, `README.md:153`, `index.html:734`). Checked against the
current files: `teach-and-infer.mjs`'s output block now starts at README.md
line 83, not 59, so the citation had rotted; the other two were close but
still line numbers, the same failure mode this file's own rule warns about.
All four rows now name the section instead, matching the convention the
`## README.md` table already uses.

## Reference-path sweep

Twenty-nine bare references to archived plan docs (`PLAN_NORMATIVE.md`,
`PLAN_AGENTS.md`, `PLAN_SYLLOGIST.md`, `PLAN_ADVENTURE.md`, `PLAN_GUESS_NUMBER.md`,
`PLAN_OPEN_ITEMS.md`) read as root paths and resolve nowhere. All now name
`archive/`, which is the convention `PLAN_CODE_PLANNING.md` already follows.
`npm run check:links` does not catch these: they are backtick mentions, not
markdown links.

A later pass found one more: `docs/references/term-register.json`'s own header
comment named `PLAN_NORMATIVE.md` bare, inside a JSON string the link checker
cannot see either. Fixed the same way, to `archive/PLAN_NORMATIVE.md`.

`docs/references/README.md`'s contents tree and its planning section both omitted
`BDI_GOAL_DRIVEN_AUTONOMY.md`, a substantial entry. Both now name it.

Four line-number citations into `src/services/chat.mjs` and `src/domain/memory/`
had drifted by thousands of lines. They cite symbols now. Line numbers into a
file under active development are a citation that rots on the next commit.

## Constant drift in the MUD docs

The food-mass drift already recorded was not the only one. Twenty-two more, all
from reading each quoted number against its source. The full list is in the
commit message for `docs(mud)`; the shape worth carrying forward:

- **A cast that changed name.** Three passages called the MUDIII predator a wolf.
  `MUDIII_ROLES` says fox, and `data/mudiii-assets.json` excludes
  `wolf_basic.glb` on licence grounds. A doc naming a creature the product does
  not have is the most user-visible kind of drift here.
- **A constant that became a per-instance property.** The doc said grid size was
  "one constant in one module". It is a layout property; the module header says
  a module-level constant "would silently clip the 14x14 chapel board".
- **An engine default that became world data.** Dig reach, den chance and
  resident chance read as engine constants. All three are world facts, and the
  three shipped burrows disagree with each other and with the doc.
- **A fallback mistaken for the value.** `game-config.mjs`'s per-species masses
  read as authoritative. Every world pack overrides them.
- **A shopping list that outlived the shopping.** The asset paragraph named
  barrels, lanterns, apples, cheese and a crate of apples. The manifest has
  sixteen rows and none of them, plus one hay bale standing in for both food
  kinds.

## Left open

**`PLAN_MEMORY_BACKEND_AWS.md` contradicts itself about which repo `PLAN_TMCT.md`
lives in.** Line 6 says it was relocated "from seonix's `PLAN_TMCT.md`"; line 103
says "`PLAN_TMCT.md` §7 in the marginalia repo". Both cannot be right. Resolving
it means reading a sibling repo, which is outside this worktree, and guessing
would put a wrong repo name in a doc that currently at least flags its own
uncertainty by disagreeing.

**Drift in files this pass does not own.** Recorded here so it is not
rediscovered:

- `corpus/domains/code/README.md` says 9 relations; `relations.jsonl` has 11.
- `test-benchmarks/chatbench/README.md` says 138 cases in three places and 139 in
  a fourth; the pool has 139.
- `scripts/build-demo-pack.mjs`'s comment says "today's 3,887-article
  corpus/reference/ build"; the manifest counts 3,888.
- `src/domain/cli-verbs.mjs`'s help text rounds the persona tiers to ~1,608 and
  ~13,600 where the raw file sums are 1,630 and 13,629. The README quotes the
  help figures, so the two agree; whether the rounding is post-dedupe was not
  determined.
- `src/adapters/toml-config.mjs`'s comment says `unwired` is "surfaced … so the
  cli can warn once rather than silently ignore". No CLI code reads it;
  `mergeEffective` strips it. The README makes no such promise, so this is a
  code/comment gap only.
- `STATUS.md`'s header reads "Measured tree: 3.0.3 … Repo now at 3.0.10" against
  a `package.json` now at 5.0.6 (5.0.5 when this row was first written — another
  track is committing against `main` while this pass runs, so the exact number
  will keep moving; the mismatch itself is the standing finding).

**Struck, re-checked in a later pass:** `src/services/p2p-room.mjs`'s `file(1)`
classification no longer reads `data` on this session's tooling, and a plain
`grep -rn` over `src/services/` finds its matches same as any other file. The
grep-skips-it risk does not reproduce here.

## What the checks read

Docs-only work, so the links and estate gate rather than the full suite.

- `npm run check:links` — OK, every relative markdown link resolves.
- `node --test "test/estate/*.test.mjs"` — 79/79 pass.
- `npm run test:fast` — 210/210 pass.
- `node --test test/readme/readme.test.mjs` — 35/35 pass, which is what proves
  the three new `output:help:*` blocks are verbatim in the live `--help` and the
  expanded `tmct.toml` block still loads through the config loader.
