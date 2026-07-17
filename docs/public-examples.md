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
`e2e/readme-examples.test.mjs`; `skip=` blocks never run.

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `README.md:27` | `js` — packaged exports smoke | `runChat` | `test/readme/readme.test.mjs` | replay |
| `README.md:59` | `node examples/teach-and-infer.mjs` | `runChat`, `appendFact` | `test/readme/readme.test.mjs` (full stdout, no elision) | output |
| `README.md:109` | `what does app.mjs talk to?` / `what talks to store.mjs?` | `runTurn` → `reverse(uses)` | `test/readme/readme.test.mjs` | replay |
| `README.md:130` | `npm run demo:build` / `build:ask-bundle` | `scripts/build-demo-site.mjs` | `e2e/readme-examples.test.mjs` | replay |
| `README.md:137` | `npx tmct viz` / `init` / `import` / `chat --render blocks` | `renderLedger`, `renderPlanHtml` | `e2e/readme-examples.test.mjs` | replay |
| `README.md:234` | session — taught-fact recall | `runTurn` | `test/readme/readme.test.mjs` | replay |
| `README.md:243` | `js` — library call | `runChat` | `test/readme/readme.test.mjs` | replay |
| `README.md:271` | session — 23 pinned lines | `runTurn` | `test/readme/readme.test.mjs` | replay |
| `README.md:308` | session — 3 pinned lines, 1 elided | `runTurn` | `test/readme/readme.test.mjs` | replay |
| `README.md:339` | hanoi-3 solve, 10 pinned lines | `compileDomain`, `compileGoal`, `movesFromRules` | `e2e/readme-examples.test.mjs` | replay |
| `README.md:404`, `:426`, `:803`, `:898`, `:934`, `:973` | `bash` — CLI invocations | `bin/tmct.mjs`, `CLI_VERBS` | `test/readme/readme.test.mjs` | replay |
| `README.md:431` | `output` — full stdout, no elision | `bin/tmct.mjs`, `CLI_VERBS` | `test/readme/readme.test.mjs` | output |
| `README.md:499`–`:678` | 13 `output:help:*` excerpts | `renderUsage`, `CLI_VERBS` | `test/readme/readme.test.mjs` (verbatim in live `--help`) | replay |
| `README.md:634`, `:688` | `bash e2e` | `bin/tmct.mjs`, `CLI_VERBS` | `e2e/readme-examples.test.mjs` | replay |
| `README.md:706` | `tmct.toml` reference | `loadTomlConfig` | `test/readme/readme.test.mjs` | replay |
| `README.md:811`, `:823` | `text` — illustrative | — | never run, by tag | — |
| `README.md:834`, `:846` | `js` — library snippets | `runChat` | `test/readme/readme.test.mjs` | replay |
| `README.md` tool section | `tmct_untested` and the tool table | `TOOL_DEFINITIONS` | `test/estate/tool-docs.test.mjs` | estate |
| `README.md:463` | `skip=network` | — | never run: would touch the network | — |
| `README.md:983` | `skip=offline-eval-only` | — | never run: needs an LLM judge | — |

## public/index.html

The page's transcripts opt in with `data-tmct-session`, and
`e2e/pages-examples.test.mjs` replays each against the live CLI through the same
harness the README fences use.

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `index.html:227` | `what is a dog` / `what is a quokka` | `runTurn`, corpus seed | `e2e/pages-examples.test.mjs` | replay |
| `index.html:290` | `what talks to store.mjs?` / `which modules do not import logger?` | `runTurn` → `reverse(uses)`, `composite(boolean)` | `e2e/pages-examples.test.mjs` | replay |
| `index.html:287` | `npm install -g @polycode-projects/…` | — | `e2e/pages-home.test.mjs` | dom |
| `index.html:302` | `tmct init` / `viz` / `syllogise` | `CLI_VERBS` | `e2e/pages-home.test.mjs` | dom |
| `index.html:311` | `runChat` library block | `runChat` | `e2e/pages-home.test.mjs` | dom |
| ledger hero | the embedded `ledger.html` iframe | `renderLedger` | `e2e/pages-home.test.mjs`, `e2e/pages-index.test.mjs` | dom |
| plan render | the embedded `plan.html` iframe | `renderPlanHtml` | `e2e/pages-home.test.mjs` | dom |
| version stamp | `<span id="pkg-version">` | `scripts/build-demo-site.mjs` | `e2e/pages-home.test.mjs`, `test/estate/page-version-stamp.test.mjs` | estate |

The three `dom` rows are the open ones. `e2e/pages-home.test.mjs` asserts the
page shows those strings; nothing asserts the product does what they say. The
`runChat` block is the one worth pinning next — it is a copyable program, and
`README.md:243` already replays the same call.

## docs/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `docs/repository-interface.schema.json` | the machine shape | `REPOSITORY_INTERFACE` | `test/adapters/repository-interface.test.mjs` | tool |
| `docs/repository-interface.md` | 16 services, 11 edge kinds, 4 miss reasons, v1.1.0 | `SERVICES`, `EDGE_KINDS`, `MISS_REASONS`, `INTERFACE_VERSION` | none | — |
| `docs/adapter-contract.md` | the entities payload | `parseEntities`, `buildEntities` | `test/adapters/memory-adapter.test.mjs` | tool |

`docs/repository-interface.md` names every service, edge kind and miss reason,
and each was checked against the source for this table. No test holds it there.
The schema next to it **is** pinned to the source const, so the prose is the part
that can drift.

## corpus/*/README.md

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `corpus/conceptnet/README.md` | 44,947 rows | `slice.jsonl` | `test/estate/corpus-schema.test.mjs`, `corpus-licences.test.mjs` | estate |
| `corpus/seon/README.md` | 399 facts, 288 definitions, 9 relations | `concepts/definitions/relations.jsonl` | `test/estate/corpus-schema.test.mjs` | estate |
| `corpus/wordnet/README.md` | 107,526 upstream synsets; 192,498 facts | `manifest.json` | `test/estate/corpus-schema.test.mjs` | estate |

Counts were checked against the files for this table and all match. The row
counts are not asserted as numbers, so a regrow that forgets the README drifts
silently.

## chatbench/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `chatbench/README.md` | 109 cases across 12 cells | `graded-pool.jsonl` | `test/bench/chatbench-graded.test.mjs` | estate |
| `chatbench/GRADED.md` | 1,075 cases across 36 cells | `graded-pool-max.jsonl` | `test/bench/chatbench-graded.test.mjs` | estate |

Both figures were counted off the pools for this table and both match.

## examples/

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `examples/teach-and-infer.mjs` | the whole script | `runChat` | `test/readme/readme.test.mjs` via `README.md:59` | output |
| `examples/mini-webapp` | the fixture graph | `parseEntities` | `test/estate/fixture-repos.test.mjs` | estate |

`teach-and-infer.mjs` carries no `assert` of its own. It does not need one: the
README pins its **entire** stdout with no elision, so any drift fails the suite.

## .tmct/TOOLS.md

| surface | example (verbatim) | implementation (symbol) | test that touches it | tier |
|---|---|---|---|---|
| `.tmct/TOOLS.md` | a worked invocation per cold tool | `renderToolsCatalog`, `COLD_TOOLS` | `test/tools/cli-route.test.mjs` | tool |

The catalog `tmct init` writes is held at the tool layer: the test runs `init`
and asserts every cold tool's invocation names the real executable.
