# The graph-provider adapter contract (ROADMAP item 14)

tmct **consumes** a code graph; it never produces or mutates one. This document
is the complete touchpoint between tmct and any graph producer (seonix, a CI
indexer, a hand-written JSON file, an in-process loader): what tmct reads, in
what shape, from where, and the guarantees each side gets.

## The seam, in one sentence

A provider hands tmct one **entities payload** (JSON on disk at
`config.graphFile`, or an object from a registered loader); tmct parses it with
`parseEntities()` into `{ individuals, byId, relations, proseIndex }` and runs
every query, template, and traversal off that — nothing else crosses the
boundary.

## 1. The entities payload (the on-disk / on-the-wire shape)

The payload is a single JSON object. Every field tmct reads is listed here;
unknown extra fields are ignored (safe to extend). `src/adapters/graph-build.mjs`'s
`buildEntities()` is the reference producer of this shape.

```jsonc
{
  "generated_at": "2026-07-03T10:00:00.000Z",   // string; surfaced as provenance
  "classes": [                                   // per-class counts for /stats + count questions
    { "name": "Module", "count": 12, "sample": ["app/a.mjs", "app/b.mjs"] }
  ],
  "vocabulary": [                                // OPTIONAL: documents the prop tokens used below
    { "prop": "mgx:importsNamespace", "predicate": "imports", "note": "module→module" }
  ],
  "objectProperties": [                          // the typed edges, grouped by relation
    {
      "predicate": "imports",                    // verb; used for rendering + kind fallback
      "prop": "mgx:importsNamespace",            // closed token; primary relation-kind classifier
      "count": 1,                                // may exceed examples.length (truncated graphs)
      "examples": [
        { "subject": "mod:app/b.mjs", "object": "mod:app/a.mjs",
          "subjectLabel": "app/b.mjs", "objectLabel": "app/a.mjs" }
      ]
    }
  ],
  "individuals": [                               // the nodes
    {
      "id": "mod:app/a.mjs",                     // REQUIRED, unique; nodes without id are dropped
      "label": "app/a.mjs",                      // display + label-tier symbol resolution
      "class": "Module",                         // Module | Class | Function | Method | Attribute
                                                 //   | GlobalVariable | Commit | Session | …
      "derived_from": ["git:e6a9419567f7"],      // provenance refs (git:<sha> count as attestation)
      "mentions": [],                            // [{id, count}] mention stats (may be empty)
      "attributes": [                            // typed literals; {prop, key, value} triples
        { "prop": "seon:hasDoc", "key": "doc", "value": "first docstring line" },
        { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "alpha beta" }
      ]
    }
  ],
  "proseIndex": {                                // OPTIONAL: word → [individual ids], inverted
    "alpha": ["mod:app/a.mjs"]                   //   from the prose_tokens attributes
  }
}
```

Field notes:

- **`individuals[].id`** — the only required node field. Conventional shapes
  (`mod:<path>`, `fn:<path>#<name>`, `commit:<sha>`) matter for one thing:
  session fold-in re-resolution derives a fallback *label* from the id shape
  (`src/sessions.mjs`, `labelFromId`). Other id schemes work; they just skip
  that fallback tier.
- **`objectProperties[].prop`** — the closed vocabulary token. tmct classifies
  each group into a relation *kind* (imports / calls / defines / tests /
  touches / contains / inherits / callsSymbol / touchesSymbol) primarily by
  this token (`src/codegraph.mjs`, `PROP_KIND` — SEON + `mgx:` tokens, with
  legacy `mg:`/`seon:` aliases), falling back to keyword-matching the
  `predicate` verb. An unclassifiable group is still rendered and traversable
  by its predicate name; it just doesn't join the impact closure.
- **`count` vs `examples.length`** — `count` may be larger; tmct reports the
  group as truncated and works with the examples it has.
- **`proseIndex`** — optional but what makes free-text object resolution and
  lexical ranking cheap. Producers using `attachProseTokens()` +
  `buildProseIndex()` (`src/prose.mjs`) get it for free and it can never
  disagree with the `prose_tokens` attributes it inverts. A reserved
  `"tmct:layers"` key may carry normalised sub-indexes (spell/stem/lemma
  layers); absent is fine.
- **`vocabulary` / `classes`** — read for `/stats`, count questions and schema
  self-description; both may be empty arrays.

## 2. What tmct parses it into

`parseEntities(payload)` (`src/codegraph.mjs`) — the loader every surface goes
through — yields:

| field | shape | what tmct does with it |
|---|---|---|
| `individuals` | the payload array, as-is | ranking, rendering, symbol resolution |
| `byId` | `Map<id, individual>` | O(1) node lookup for traversals |
| `relations` | `[{ predicate, prop, count, edges[] }]` | every edge walk; `edges` are the validated `examples` (subject+object present) |
| `truncated` | `[{ predicate, count, shown }]` | honest "graph is truncated" messaging |
| `generatedAt` | `generated_at` or `null` | provenance line in answers |
| `proseIndex` | passed through byte-identical | free-text resolution + lexical boosts |

Malformed pieces degrade, never throw: non-array fields parse as empty, edges
missing subject/object are dropped, nodes without `id` are skipped.

## 3. Where the payload comes from (resolution order)

1. **A registered provider** (in-process): `registerProvider(fn)`
   (`src/adapters/source.mjs`) installs `(config) => payload | Promise<payload>`; while
   registered, `fetchEntities(config)` returns the provider's result **as-is
   and uncached** (a live provider owns its own refresh policy). Register
   `null` to restore the default loader; the previous provider is returned so
   wrappers can restore it. Provider errors surface as clean `ToolError`s.
2. **`TMCT_GRAPH_FILE`** (environment): an absolute or cwd-relative path to the
   payload JSON. Trimmed; empty means unset.
3. **Default**: `<repo>/.tmct/graph.json` (`DEFAULT_GRAPH_REL`), where
   `<repo>` is `--repo` if given, else the git toplevel of the cwd, else the
   cwd itself (`runChat`, `src/chat.mjs`).

File reads are cached per path for the process; `clearCache()` (tests,
long-lived embedders) discards it.

## 4. Bootstrap-empty behaviour (a missing artifact is not an error)

`fetchEntities` maps ENOENT to the **bootstrap payload** — `emptyEntities()`:
the exact shape above with all collections empty and `"bootstrap": true`
marking it. The chat surface then starts honestly empty ("no graph loaded —
starting empty"), answers with honest misses, and the first session upsert
**creates** `.tmct/graph.json` from the conversation itself
(`appendSessionToGraph`, `src/sessions.mjs`). The bootstrap payload is never
cached, so a provider (or indexer) writing the artifact mid-session is picked
up on the next fetch. Any other read/parse failure is a clean `ToolError`.

## 5. Write-ownership guarantees

- **tmct never writes a provider's graph content.** The only thing tmct ever
  writes into `config.graphFile` is its own *runtime observations*: `Session`
  individuals + `mgx:asksAbout` edges, upserted atomically (temp + rename)
  with a fresh read first, so a provider re-index that replaces the file
  mid-session is tolerated — session edges whose targets vanished are dropped
  and counted, never left dangling. Source-derived content is never modified;
  a re-index simply wins, and recorded sessions re-attach via
  `foldInSessions()`.
- **tmct's own memory never touches the seam.** Conversational memory — the
  OWL-labelled utterance/fact graph and the text-block corpus — lives under
  `.tmct/memory/` (`src/adapters/memory/core.mjs`, `blocks.mjs`, `fold.mjs`), a store
  the provider never supplies and tmct never routes through `fetchEntities`.
  A provider payload is read-only input; `.tmct/memory/` is tmct-only output.
- Providers registered via `registerProvider` are **read-only by
  construction**: nothing in tmct calls back into a provider to write.

## 6. Minimal provider checklist

1. Emit one JSON object in the section-1 shape (only `individuals[].id` is
   hard-required per node; edges need `subject`/`object`).
2. Use SEON/`mgx:` prop tokens where they fit so relation kinds classify; any
   other token still renders under its `predicate` verb.
3. Either write it to `.tmct/graph.json` (or point `TMCT_GRAPH_FILE` at it),
   or ship a loader and call `registerProvider(loader)` before `runChat`.
4. Replace the file atomically if you re-index while tmct runs; tmct's session
   upsert already tolerates the swap.
5. Optionally run `attachProseTokens` + `buildProseIndex` over your
   individuals to light up free-text resolution.
