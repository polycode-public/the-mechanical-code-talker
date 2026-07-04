# tmct — The Mechanical Code Talker

`@polycode-projects/the-mechanical-code-talker`

A pure-JS, **no-LLM**, offline, **$0** chatbot in the ELIZA/PARRY lineage —
pattern-driven, best-efforts, and obsessed with software the way PARRY was
obsessed with the mafia. No model calls anywhere in the product: interpretation
is mechanical (deterministic language libraries, template sets, committed
corpuses), memory is a graph on disk, and every answer is either grounded or an
honest miss.

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

## What tmct deliberately is NOT

- **It is not an indexer.** tmct keeps no codebase index of its own. It
  consumes a graph via a provider seam (`fetchEntities` and friends); producing
  a code graph is out of scope. tmct's job is the *conversation*.
- **It is not a reasoning model.** Where it "reasons", it does so by
  *calculation* surfaced as prose ("there are a lot of tests for a codebase of
  that size") — deterministic, explainable, cheap. There is **no LLM anywhere
  in the product**. (An LLM-as-judge exists only in the offline eval harness
  that tunes tmct — see `SKILL_TUNING_CYCLE.md` — never in the product path.)
- **It never guesses silently.** When it cannot resolve your question it says
  so and nudges you toward a query it *can* answer.

## Install & use

```bash
npm install -g @polycode-projects/the-mechanical-code-talker
tmct                                  # bare = chat (the headline)
tmct chat --repo /abs/path/to/repo    # chat over a specific repo's graph
```

Inside the chat: `/help` lists commands, `/exit` leaves. `TMCT_GRAPH_FILE`
overrides the graph location.

> Install-size note: tmct depends on wink-nlp's deterministic English language
> model (~3.8 MB installed). That model is a lookup table, not an LLM.

### As a library

```js
import { runChat, ask, resolveObject, fetchEntities } from "@polycode-projects/the-mechanical-code-talker";
```

The `exports` map and the chat primitives (`ask`, `resolveObject`,
`relationKind`, `impactClosure`, `dispatchTool`, `fetchEntities`) are the
extension surface.

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
