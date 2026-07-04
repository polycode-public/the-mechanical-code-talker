# mct — The Mechanical Code Talker

`@polycode-projects/mct`

A tolerant, offline, **$0** chat that guides you toward precision queries about a
software repository. It is ELIZA/PARRY-style — pattern-driven, best-efforts, no
model calls — but domain-obsessed with code the way PARRY was obsessed with the
mafia. It assumes a narrow context (you are asking about *this* repo) and leans
into that assumption to be helpful cheaply.

```
$ mct
seon> what talks to the payment module?
…
seon> /callers checkout
…
seon> /exit
```

## What mct is

- A **mechanical chat surface**: deterministic pattern-matching over a code
  graph, mapping loose natural-language-ish questions onto precise graph queries
  and slash-commands (`/callers`, `/callees`, `/tests`, `/impact`, `/arch`, …).
- **Offline and free**: no LLM in the default path. An opt-in `--with-claude` /
  `--with-copilot` fallback is available for chat only, used solely when the
  mechanical engine misses a bare question — never required.
- A **library**: importable via a real `exports` map, so other tools can drive
  the chat engine and its primitives (`ask`, `resolveObject`, `relationKind`,
  `impactClosure`, `dispatchTool`, `fetchEntities`).

## What mct deliberately is NOT

- **It is not an indexer.** mct keeps **no codebase index of its own**. It reads
  a pre-built graph artifact; producing that graph is out of scope (today it
  consumes seonix's `.seonix/graph.json`; a first-class provider adapter is on
  the ROADMAP). mct's job is the *conversation*, not the extraction.
- **It is not a reasoning model.** Where it "reasons", it does so by
  *calculation* surfaced as prose ("there are a lot of tests for a codebase of
  that size") and, optionally, by running linters/tests to *observe* whether
  something worked — not by generating free-form thought.
- **It does not guess silently.** When it cannot resolve your question it tells
  you so and nudges you toward a query it *can* answer.

## Install & use

```bash
npm install -g @polycode-projects/mct    # or npx @polycode-projects/mct
mct                                       # bare = chat (the headline)
mct chat --repo /abs/path/to/repo         # chat over a specific repo's graph
mct --help                                # full usage
```

Non-chat modes (graph tools, `viz`, `hook-augment`) are carried over from the
lift and remain available under `mct <mode> …`, but they are de-emphasized —
mct's headline is the chat.

### As a library

```js
import { runChat, ask, resolveObject, fetchEntities } from "@polycode-projects/mct";
import { runChat } from "@polycode-projects/mct/chat";
```

## Provenance and shape

mct v0.1.0 is a **whole-package lift** of the seonix chat surface. Internal
module filenames and identifiers are kept **verbatim** from seonix — the rename
is packaging and branding, not a symbol-level refactor. This guarantees mct
starts life with seonix's shape and its green test suite. The graph artifact
directory is still named `.seonix/` for the same reason (see ROADMAP.md for the
planned `.mct` migration). The clean chat/primitives split, the index-shedding,
and the seonix→mct adapter are all deferred — see **ROADMAP.md**.

## Licence

**AGPL-3.0-only.** This is a deliberate copyleft choice for a published library:
network use counts as distribution, so a hosted service built on mct must offer
its corresponding source. If that does not suit your use, do not build on mct.
See `LICENSE`.

© Polycode Limited.
