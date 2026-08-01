# Every example on a public surface, and the test that touches it

One row per example a reader can copy off a public surface. The rule: an example
traces to an **implementation** (the code path it exercises) and to a **test that
touches that path**. An example with no assertion is a claim, not a demo.

This table lives in `docs/` because it is a maintenance surface, not a shop
window. It is the answer to "can I still delete this example?" and to "what
breaks if I change this output string?" — questions a maintainer asks with the
repo open. A reader who just wants to use tmct reads `README.md`.

**Tier** names how strongly the row is held, strongest first:

| tier | meaning |
|---|---|
| `replay` | the example's text is replayed against the live CLI and every line it shows must appear in stdout, in order |
| `output` | the example's **full** stdout is compared to the block, exactly |
| `tool` | a test drives the same path through the tool layer (`dispatchTool`, the catalog, `runConformance`) |
| `estate` | a generator owns the text; the test fails on drift |
| `dom` | a browser test asserts the page shows the string. This says nothing about the product, and is a floor, not a pass |

## README.md

Every fence carries a harness tag, and `test/readme/readme.test.mjs` asserts that
(an untagged fence fails the suite). `attrs.e2e` blocks run from
`test-e2e/readme-examples.test.mjs`; `skip=` blocks never run.

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `README.md:27` | `js` — packaged exports smoke | `runChat` | `test/readme/readme.test.mjs` | replay |
| `README.md:59` | `node examples/teach-and-infer.mjs` | `runChat`, `appendFact` | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| `README.md:137` | `node examples/rover-infer.mjs` | `runChat`, first-run corpus bootstrap (`seedBootstrapMemory`) | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| `README.md:153` | `node examples/raw-fact-shape.mjs` | `appendFact`, `loadMemory` | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| `README.md:109` | `what does app.mjs talk to?` / `what talks to store.mjs?` | `runTurn` → `reverse(uses)` | `test/readme/readme.test.mjs` | replay |
| `README.md:130` | `npm run demo:build` / `build:ask-bundle` | `scripts/build-demo-site.mjs` | `test-e2e/readme-examples.test.mjs` | replay |
| `README.md:137` | `npx tmct viz` / `init` / `import` / `chat --render blocks` | `renderLedger`, `renderPlanHtml` | `test-e2e/readme-examples.test.mjs` | replay |
| `README.md:234` | session — taught-fact recall | `runTurn` | `test/readme/readme.test.mjs` | replay |
| `README.md:243` | `js` — library call | `runChat` | `test/readme/readme.test.mjs` | replay |
| `README.md:271` | session — 23 pinned lines | `runTurn` | `test/readme/readme.test.mjs` | replay |
| `README.md:308` | session — 3 pinned lines, 1 elided | `runTurn` | `test/readme/readme.test.mjs` | replay |
| `README.md:339` | hanoi-3 solve, 10 pinned lines | `compileDomain`, `compileGoal`, `movesFromRules` | `test-e2e/readme-examples.test.mjs` | replay |
| `README.md:404`, `:426`, `:803`, `:898`, `:934`, `:973` | `bash` — CLI invocations | `bin/tmct.mjs`, `CLI_VERBS` | `test/readme/readme.test.mjs` | replay |
| `README.md:431` | `output` — full stdout, no elision | `bin/tmct.mjs`, `CLI_VERBS` | `test/readme/readme.test.mjs` | output |
| `README.md:499`–`:678` | 13 `output:help:*` excerpts | `renderUsage`, `CLI_VERBS` | `test/readme/readme.test.mjs` (verbatim in live `--help`) | replay |
| `README.md:634`, `:688` | `bash e2e` | `bin/tmct.mjs`, `CLI_VERBS` | `test-e2e/readme-examples.test.mjs` | replay |
| `README.md:706` | `tmct.toml` reference | `loadTomlConfig` | `test/readme/readme.test.mjs` | replay |
| `README.md:811`, `:823` | `text` — illustrative | — | never run, by tag | — |
| `README.md:834`, `:846` | `js` — library snippets | `runChat` | `test/readme/readme.test.mjs` | replay |
| `README.md` tool section | `tmct_untested` and the tool table | `TOOL_DEFINITIONS` | `test/estate/tool-docs.test.mjs` | estate |
| `README.md:463` | `skip=network` | — | never run: would touch the network | — |
| `README.md:983` | `skip=offline-eval-only` | — | never run: needs an LLM judge | — |

## public/index.html

The page's transcripts opt in with `data-tmct-session`, and
`test-e2e/pages-examples.test.mjs` replays each against the live CLI through the same
harness the README fences use.

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `index.html:227` | `what is a dog` / `what is a quokka` | `runTurn`, corpus seed | `test-e2e/pages-examples.test.mjs` | replay |
| `index.html:734` | `Rover is a dog.` / `Does Rover bark?` (via `examples/rover-infer.mjs`) | `runChat`, first-run corpus bootstrap | `test-e2e/pages-examples.test.mjs` | replay |
| `index.html:290` | `what talks to store.mjs?` / `which modules do not import logger?` | `runTurn` → `reverse(uses)`, `composite(boolean)` | `test-e2e/pages-examples.test.mjs` | replay |
| `index.html:287` | `npm install -g @polycode-projects/…` | — | `test-e2e/pages-home.test.mjs` | dom |
| `index.html:302` | `tmct init` / `viz` / `syllogise` | `CLI_VERBS` | `test-e2e/pages-home.test.mjs` | dom |
| `demo-ui.mjs` `HISTORY` | the 5 scripted turns the demo box types out | `runTurn`, `ask` | `test-e2e/pages-demo-history.test.mjs` (each answer verbatim) | replay |
| `demo-templates.mjs` `TEMPLATES` | 56 question/substitution pairs the box can pick | `ask` | `test-e2e/pages-demo-templates.test.mjs` (all 56 must answer) | replay |
| `index.html:311` | `runChat` library block | `runChat` | `test/tools/chat-library-block.test.mjs` (runs the block, asserts the answer) | tool |
| ledger hero | the embedded `ledger.html` iframe | `renderLedger` | `test-e2e/pages-home.test.mjs`, `test-e2e/pages-index.test.mjs` | dom |
| plan render | the embedded `plan.html` iframe | `renderPlanHtml` | `test-e2e/pages-home.test.mjs` (draws only the pieces hanoi-3 taught), `test/adapters/plan-viz.test.mjs` | dom |
| version stamp | `version.txt` | `scripts/build-demo-site.mjs` | `test-e2e/pages-home.test.mjs`, `test/adapters/version-stamp.test.mjs` | dom |

The `runChat` block is pinned at the tool layer:
`test/tools/chat-library-block.test.mjs` runs the same call in-process and
asserts the taught fact comes back. The remaining `dom` rows (the install and
`tmct` command strings) still only assert that the page shows the string;
nothing asserts the product does what they say.

`demo-ui.mjs` and `demo-templates.mjs` each used to carry a comment saying their
answers had been verified against the real engine, one of them noting the check
was "not re-run here". One of the five scripted answers had drifted by the time
it was checked for this table: the page quoted "defined in src/core/model.mjs"
where the engine says "found in". A comment recording a past verification does
not survive the next engine change; the two tests above do.

`ledger.html` and `plan.html` are generated at build and gitignored, so the
generator is the surface that can be pinned. `renderPlanHtml` and
`computeBlocksLayout` carry ten tests between them. The rendered page now also
has to draw only the pieces the game taught: the board once drew every member of
every class it had not declared, and a check that the replay names `disk-1`
passes just as happily when it names the whole memory.

## docs/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `docs/repository-interface.schema.json` | the machine shape | `REPOSITORY_INTERFACE` | `test/adapters/repository-interface.test.mjs` | tool |
| `docs/repository-interface.md` | 16 services, 11 edge kinds, 4 miss reasons, v1.1.0 | `SERVICES`, `EDGE_KINDS`, `MISS_REASONS`, `INTERFACE_VERSION` | `test/adapters/repository-interface.test.mjs` | tool |
| `docs/adapter-contract.md` | the entities payload | `parseEntities`, `buildEntities` | `test/adapters/memory-adapter.test.mjs` | tool |

`docs/repository-interface.md` names every service, edge kind and miss reason.
`test/adapters/repository-interface.test.mjs` now pins the prose to the source
const — every name, and the version — beside the schema it already held there.

## corpus/*/README.md

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `corpus/conceptnet/README.md` | 44,947 rows | `slice.jsonl` | `test/estate/corpus-schema.test.mjs`, `corpus-licences.test.mjs` | estate |
| `corpus/seon/README.md` | 399 facts, 288 definitions, 9 relations | `concepts/definitions/relations.jsonl` | `test/estate/corpus-schema.test.mjs` | estate |
| `corpus/wordnet/README.md` | 107,526 upstream synsets; 192,498 facts | `manifest.json` | `test/estate/corpus-schema.test.mjs` | estate |

Counts were checked against the files for this table and all match. The row
counts are not asserted as numbers, so a regrow that forgets the README drifts
silently.

## test-benchmarks/chatbench/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `test-benchmarks/chatbench/README.md` | 138 cases | `graded-pool.jsonl` | `test/bench/chatbench-graded.test.mjs` | estate |
| `test-benchmarks/chatbench/GRADED.md` | 1,075 cases across 36 cells | `graded-pool-max.jsonl` | `test/bench/chatbench-graded.test.mjs` | estate |

Both figures were counted off the pools for this table and both match.

## examples/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `examples/teach-and-infer.mjs` | the whole script | `runChat` | `test/readme/readme.test.mjs` via `README.md:59` | output |
| `examples/rover-infer.mjs` | the whole script | `runChat`, first-run corpus bootstrap | `test/readme/readme.test.mjs` via `README.md:137`, `test-e2e/pages-examples.test.mjs` via `index.html:734` | output |
| `examples/raw-fact-shape.mjs` | the whole script | `appendFact`, `loadMemory` | `test/readme/readme.test.mjs` via `README.md:153` | output |
| `examples/mini-webapp` | the fixture graph | `parseEntities` | `test/estate/fixture-repos.test.mjs` | estate |

`teach-and-infer.mjs`, `rover-infer.mjs`, and `raw-fact-shape.mjs` carry no
`assert` of their own. They do not need one: the README pins each one's
**entire** stdout with no elision (session-id/timestamp normalized to a
literal placeholder first), so any drift fails the suite. `rover-infer.mjs`
is also replayed as `index.html:734`'s `data-tmct-session` command — pointing
that block at the example script itself, rather than the raw `tmct` binary,
is what makes the same non-deterministic citation checkable there too.

## .tmct/TOOLS.md

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `.tmct/TOOLS.md` | a worked invocation per cold tool | `renderToolsCatalog`, `COLD_TOOLS` | `test/tools/cli-route.test.mjs` | tool |

The catalog `tmct init` writes is held at the tool layer: the test runs `init`
and asserts every cold tool's invocation names the real executable.
