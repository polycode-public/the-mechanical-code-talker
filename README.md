# tmct — The Mechanical Code Talker

`@polycode-projects/the-mechanical-code-talker`

A pure-JS, **no-LLM**, offline, **$0** chatbot in the ELIZA/PARRY lineage:
pattern-driven, best-efforts, and obsessed with software the way PARRY was
obsessed with the mafia. No model calls anywhere. Interpretation is mechanical
(deterministic language libraries, template sets, committed corpuses). Memory is
a graph on disk. Every answer is either grounded or an honest miss.

```
$ tmct
tmct> what talks to the payment module?
…
tmct> /callers checkout
…
tmct> /exit
```

Home page: https://polycode-projects.gitlab.io/the-mechanical-code-talker/

## How it interprets you

Every message runs through **multiple concurrent interpretation strategies** —
a grammar parse, keyword picking, noise-word removal, fuzzy matching. Their
results are grouped by class:

- results of the **same class merge** into one ranked answer;
- results of **distinct classes** are surrounded with an explicit
  *"if you mean X then …"* so ambiguity is shown, never silently resolved.

One of the strategies is an **ACE-inspired controlled grammar**: when your
text fits the controlled fragment, tmct emits OWL-labelled triples from it —
statements it can store, retrieve, and answer from later. Text that doesn't
fit the grammar still gets the tolerant strategies; nothing is rejected for
being loose, fuzzy, or misspelled.

**Negation and passive.** "Which modules do *not* import X?" computes a bounded
**set complement** over the graph, and an honestly empty result stays a miss
rather than a fabricated list (a non-enumerable type, like arbitrary *changes*,
is refused outright). Reversible-passive questions traverse the right direction:
"what is imported by Y" and "what does Y import" are understood as opposite
edges, not the same one.

**Response finishing.** Before an answer is printed it is segmented into typed
spans — prose versus *protected* entities, paths, numbers, code, provenance, and
receipts — and a small data-driven grammar pass runs on the prose spans only,
under a guard that proves the protected spans came through byte-for-byte. Today
that pass fixes the a/an article defect; broader voice and agreement rules are
implemented but parked until they earn their place on the benchmark.

## How it remembers

tmct's memory has two layers, both fed by every parsed request and response and
by cleaned session logs:

- an **always-loaded OWL-labelled JSON graph** on disk under `.tmct/` (local
  artifact, never committed);
- **text blocks under a PageRank-style index**, pulled into context on
  relevance rather than loaded wholesale.

With no graph at all, tmct starts empty and remembers what you tell it — the
`.tmct/` graph is created from the conversation. Committed corpuses seed the
vocabulary; a filtered **ConceptNet slice** (CC-BY-SA 4.0) is planned — see
`ROADMAP.md` Phase 2.

### Provenance and trust

Every fact and text block records **where it came from and when**. Sources are
first-class individuals — operator chat, a curated corpus, a provider graph, a
web scrape, a rule-derived entailment — and a fact links back to *all* of them
(`mgx:derivedFrom` / `mgx:statedBy` / `mgx:canonicalisedFrom`), timestamped with
`mgx:createdAt`. From those links tmct computes a **deterministic, explainable
trust score** — a source-type prior combined with corroboration (how many
independent sources agree) and recency. It is never hand-set, always traceable
to its inputs. Retrieval then ranks by **relevance × trust**, so a corroborated,
operator-stated fact outranks a lone web scrape on the same question. When two
trusted sources *disagree*, the `/memory` inspector shows **both sides with their
provenance** rather than silently picking a winner.

### Speculative inference (a maintenance job, not a chat cost)

`tmct syllogise [--depth n] [--budget n]` is an offline, bounded, deterministic
batch that forward-chains the memory's `rdfs:subClassOf` closure into new
**entailed** facts — pre-deriving what the trusted sources already imply. It runs
once automatically after seeding and on demand; the entailed facts are
**low-trust and retractable** (never outranking a stated fact) and this never runs
on the chat's hot path.

## What tmct deliberately is NOT

- **It is not an indexer.** tmct keeps no codebase index of its own. It
  consumes a graph via a provider seam (`fetchEntities` and friends); producing
  a code graph is out of scope. tmct's job is the *conversation*.
- **It is not a reasoning model.** Where it "reasons", it does so by
  *calculation* surfaced as prose ("there are a lot of tests for a codebase of
  that size"). It is deterministic, explainable, and cheap. Even its forward-chaining
  entailment (`tmct syllogise`) is mechanical OWL rule materialization applied
  offline, rule-by-rule and retractable — not an LLM. There is **no LLM anywhere
  in the product**. (An LLM-as-judge exists only in the offline eval harness
  that tunes tmct — see `SKILL_TUNING_CYCLE.md` — never in the product path.)
- **It never guesses silently.** When it cannot resolve your question it says
  so and nudges you toward a query it *can* answer.

## Install & use

```bash
npm install -g @polycode-projects/the-mechanical-code-talker
tmct                                  # bare = chat (the headline)
tmct chat --repo /abs/path/to/repo    # chat over a specific repo's graph
tmct init                             # scaffold .tmct/, tmct.toml, seed + provenance
tmct syllogise                        # offline: pre-derive entailed facts (maintenance)
```

Inside the chat: `/help` lists commands, `/memory` inspects what tmct remembers
(grouped by OWL class, with provenance and any contradictions), `/exit` leaves.
`TMCT_GRAPH_FILE` overrides the graph location.

`tmct init` is the onboarding surface for the repository interface below: it
creates the `.tmct/` directory, writes the externalized `tmct.toml`
configuration, seeds the tier-1 corpus, and records provenance — a host package
or a bare user gets a working install in one command.

> Install-size note: tmct depends on wink-nlp's deterministic English language
> model (~3.8 MB installed). That model is a lookup table, not an LLM.

### Try it on an example graph

tmct *consumes* a code graph at `<repo>/.tmct/graph.json` — it does not build
one. Two ready-made example graphs ship in `examples/` so you can see it answer
real questions with no setup:

```bash
npm run example:mini       # "Questboard" — a small task-tracker web app (12 modules)
npm run example:polyglot   # one shared OWL vocabulary across Java / Python / C#
npm run chat:repo -- ./any/path   # chat over any repo that has a .tmct/graph.json
```

Questions the **mini-webapp** graph answers:

```
what classes are there
describe Task
how many modules
which modules import src/core/model.mjs
what tests cover src/handlers/tasks.mjs
```

The **polyglot** graph shows the language-neutral idea — Java, Python and C#
entities all typed to the same `seon:Class` / `seon:Method` / `seon:Module`
concepts, so one query reasons across every language at once:

```
how many classes          # 9 — Java + Python + C# counted as one concept
what classes are there     # Order (Java), Inventory (Python), PaymentService (C#), …
which modules define PaymentService
```

See `examples/mini-webapp/README.md` and `examples/polyglot/README.md` for the
full tours.

### As a library

```js
import { runChat, ask, resolveObject, fetchEntities } from "@polycode-projects/the-mechanical-code-talker";
```

The `exports` map and the chat primitives (`ask`, `resolveObject`,
`relationKind`, `impactClosure`, `dispatchTool`, `fetchEntities`) are the
extension surface.

## The repository interface

tmct is not an indexer, so it consumes a graph through a typed contract any
producer can implement. That contract is first-class: a **versioned (1.0.0),
OWL-grounded, machine-readable service definition** (`docs/repository-interface.md`
plus a JSON schema) of every service, its arguments, result types, and error
contract. A **miss is a value, not a throw**: the interface models "no answer"
explicitly. tmct ships **reference providers** (a fixture graph and the
empty/bootstrap graph) that implement every service, and a **runnable conformance
suite**. tmct's own providers pass it in `npm test`. Any external graph producer
(seonix first) runs the same suite against its native implementation to claim
conformance. Conformance is the suite, not prose. This inverts the original
relationship: tmct was lifted out of seonix, and seonix now reorients as a *user*
that imports the tmct library and exposes its graph to tmct as a service. The LLM
agent stays outside tmct, as the no-LLM ethos requires.

## Security and supply chain

tmct is $0 to run and meant to be trusted offline, so the supply chain is
hardened:

- CI runs **SAST and secret detection**.
- A nightly **`npm audit` + OSV-Scanner** job watches dependencies.
- Releases are published with **npm provenance** (`--provenance`).
- A coordinated-disclosure `SECURITY.md` policy covers reports.

The content-address hash is single-sourced in `src/hash.mjs`, so the
cross-version-stable fact-id contract has exactly one definition.

## Provenance

tmct began as a whole-package lift of the seonix chat surface (v0.1.0, then
published as `@polycode-projects/mct`), and was then reshaped: the LLM
fallback, the code-extraction stack, and the MCP server were all removed; the
naming, license, and memory model were reset to the vision above. See
`ROADMAP.md` for the phase plan.

## Licensing

**MPL-2.0.** Free for commercial use; if you modify the covered files and
distribute them, you must publish those files' source under the MPL with
attribution — the copyleft is file-level, not project-level. See `LICENSE`.

Corpus data carries its own licenses, separate from the code: the planned
ConceptNet slice is **CC-BY-SA 4.0** and will ship with its own notice.

© Polycode Limited.
