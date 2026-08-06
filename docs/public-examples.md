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

Rows name the README section rather than a line number. Line numbers here rot on
the next edit anywhere above them, and nothing fails when they do.

| section | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| Teach it, then ask it to reason | `js` — the `teach-and-infer` source, listed for copy-paste | `runChat`, `appendFact` | `test/readme/readme.test.mjs` | replay |
| Teach it, then ask it to reason | `node examples/teach-and-infer.mjs` | `runChat`, `appendFact` | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| Teach it, then ask it to reason | `node examples/rover-infer.mjs` | `runChat`, first-run corpus bootstrap (`seedBootstrapMemory`) | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| Teach it, then ask it to reason | `node examples/raw-fact-shape.mjs` | `appendFact`, `loadMemory` | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| Teach it, then ask it to reason | session — `what does app.mjs talk to?` / `what talks to store.mjs?` | `runTurn` → `reverse(uses)` | `test/readme/readme.test.mjs` | replay |
| Teach it, then ask it to reason | `npm run demo:build` / `build:ask-bundle` | `scripts/build-demo-site.mjs` | `test-e2e/readme-examples.test.mjs` | replay |
| Teach it, then ask it to reason | `npx tmct viz` / `init` / `import` / `chat --render blocks` | `renderLedger`, `renderPlanHtml` | `test-e2e/readme-examples.test.mjs` | replay |
| The code explorer (desktop) | `skip=network` — the Electron fetch-and-build | — | never run: would touch the network | — |
| Detailed, grounded answers | session — the cited read-out | `runTurn` | `test/readme/readme.test.mjs` | replay |
| Detailed, grounded answers | `js` — the completions/graph-adapter seam | `generateCompletion`, `createCompletionsGraphAdapter` | `test/readme/readme.test.mjs` | replay |
| Planning across the graph | two sessions — the router and goal drivers | `runCapabilityPlan` | `test/readme/readme.test.mjs` | replay |
| Teach it a game, then ask it to plan | hanoi-3 solve | `compileDomain`, `compileGoal`, `movesFromRules` | `test-e2e/readme-examples.test.mjs` | replay |
| Memory backends | `bash` + `output` — the backend flag, full stdout, no elision | `bin/tmct.mjs`, `CLI_VERBS` | `test/readme/readme.test.mjs` | output |
| Install & use | `skip=network` — global install | — | never run: would touch the network | — |
| Full command reference | 15 `output:help:*` excerpts | `renderUsage`, `CLI_VERBS` | `test/readme/readme.test.mjs` (verbatim in live `--help`) | replay |
| Full command reference | two `bash e2e` — the `init` + `import` chains | `bin/tmct.mjs`, `CLI_VERBS` | `test-e2e/readme-examples.test.mjs` | replay |
| tmct.toml reference | the one config with every recognized key | `loadTomlConfig` | `test/readme/readme.test.mjs` (parses, then loads) | replay |
| Try it on an example graph | `npm run example:mini` / `example:polyglot` / `chat:repo` | `parseEntities` | `test/readme/readme.test.mjs` | replay |
| Try it on an example graph | two `text` blocks — the questions each graph answers | — | never run, by tag | — |
| As a library | two `js` — the import line and the `/plan` subpath | `runChat`, `runCapabilityPlan` | `test/readme/readme.test.mjs` | replay |
| Asking in plain English | `tmct cli ask` | `dispatchTool`, `ask` | `test/readme/readme.test.mjs` | replay |
| The tool surface | `tmct_untested` and the tool table | `TOOL_DEFINITIONS` | `test/estate/tool-docs.test.mjs` | estate |
| The rest of the tools | `bash` — a cold-tool invocation | `dispatchTool` | `test/readme/readme.test.mjs` | replay |
| Measuring it | the four bench-smoke invocations | the bench `run.mjs` entry points | `test/corpus/bench-smoke.test.mjs` | replay |
| Measuring it | `skip=offline-eval-only` — `chatbench:judge` | — | never run: needs an LLM judge | — |

## public/index.html

The page's transcripts opt in with `data-tmct-session`, and
`test-e2e/pages-examples.test.mjs` replays each against the live CLI through the same
harness the README fences use.

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| the code-question transcript | `what talks to store.mjs?` / `which modules do not import logger?` | `runTurn` → `reverse(uses)`, `composite(boolean)` | `test-e2e/pages-examples.test.mjs` | replay |
| the teach-and-ask transcript | `Rover is a dog.` / `Does Rover bark?` (via `examples/rover-infer.mjs`) | `runChat`, first-run corpus bootstrap | `test-e2e/pages-examples.test.mjs` | replay |
| the hero install line, and the same line in the get-started block | `npm install -g @polycode-projects/…` | — | `test-e2e/pages-home.test.mjs` | dom |
| the get-started block | `tmct init` / `viz` / `syllogise` | `CLI_VERBS` | `test-e2e/pages-home.test.mjs` | dom |
| `demo-ui.mjs` `HISTORY` | the 5 scripted turns the demo box types out | `runTurn`, `ask` | `test-e2e/pages-demo-history.test.mjs` (each answer verbatim) | replay |
| `demo-templates.mjs` `TEMPLATES` | 10 template shapes, 56 question/substitution pairs the box can pick | `ask` | `test-e2e/pages-demo-templates.test.mjs` (all 56 must answer) | replay |
| the library block | `runChat` | `runChat` | `test/tools/chat-library-block.test.mjs` (runs the block, asserts the answer) | tool |
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
| `docs/repository-interface.md` | 16 services, 13 edge kinds, 4 miss reasons, v1.1.0 | `SERVICES`, `EDGE_KINDS`, `MISS_REASONS`, `INTERFACE_VERSION` | `test/adapters/repository-interface.test.mjs` | tool |
| `docs/adapter-contract.md` | the entities payload | `parseEntities`, `buildEntities` | `test/adapters/memory-adapter.test.mjs` | tool |

`docs/repository-interface.md` names every service, edge kind and miss reason.
`test/adapters/repository-interface.test.mjs` now pins the prose to the source
const — every name, and the version — beside the schema it already held there.

## corpus/*/README.md

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `corpus/conceptnet/README.md` | 44,947 rows | `slice.jsonl` | `test/estate/corpus-schema.test.mjs`, `corpus-licences.test.mjs` | estate |
| `corpus/domains/code/README.md` | 399 facts, 288 definitions, 9 relations | `concepts/definitions/relations.jsonl` | `test/estate/corpus-schema.test.mjs` | estate |
| `corpus/wordnet/README.md` | 107,526 upstream synsets; 192,498 facts | `manifest.json` | `test/estate/corpus-schema.test.mjs` | estate |

The row counts are not asserted as numbers, so a regrow that forgets the README
drifts silently, and two have. ConceptNet's 44,947 and WordNet's 192,498 match
their files. SEON's 399 and 288 match; its **9 relations is 11**.
WordNet's 107,526 synsets is an upstream figure the manifest does not carry, so
nothing here can check it.

## test-benchmarks/chatbench/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `test-benchmarks/chatbench/README.md` | 138 cases | `graded-pool.jsonl` | `test/bench/chatbench-graded.test.mjs` | estate |
| `test-benchmarks/chatbench/GRADED.md` | 1,075 cases across 36 cells | `graded-pool-max.jsonl` | `test/bench/chatbench-graded.test.mjs` | estate |

`graded-pool-max.jsonl` holds 1,075 rows and matches. `graded-pool.jsonl` holds
**139**, and its README says 138 in three places and 139 in a fourth — the drift
this section warns about, in the file that describes it.

## examples/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `examples/teach-and-infer.mjs` | the whole script | `runChat` | `test/readme/readme.test.mjs`, via README's "Teach it, then ask it to reason" section | output |
| `examples/rover-infer.mjs` | the whole script | `runChat`, first-run corpus bootstrap | `test/readme/readme.test.mjs`, via the same section; `test-e2e/pages-examples.test.mjs`, via `index.html`'s teach-and-ask transcript | output |
| `examples/raw-fact-shape.mjs` | the whole script | `appendFact`, `loadMemory` | `test/readme/readme.test.mjs`, via the same section | output |
| `examples/mini-webapp` | the fixture graph | `parseEntities` | `test/estate/fixture-repos.test.mjs` | estate |

`teach-and-infer.mjs`, `rover-infer.mjs`, and `raw-fact-shape.mjs` carry no
`assert` of their own. They do not need one: the README pins each one's
**entire** stdout with no elision (session-id/timestamp normalized to a
literal placeholder first), so any drift fails the suite. `rover-infer.mjs`
is also replayed as the teach-and-ask transcript's `data-tmct-session`
command in `index.html` — pointing that block at the example script itself,
rather than the raw `tmct` binary, is what makes the same non-deterministic
citation checkable there too.

## .tmct/TOOLS.md

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `.tmct/TOOLS.md` | a worked invocation per cold tool | `renderToolsCatalog`, `COLD_TOOLS` | `test/tools/cli-route.test.mjs` | tool |

The catalog `tmct init` writes is held at the tool layer: the test runs `init`
and asserts every cold tool's invocation names the real executable.
