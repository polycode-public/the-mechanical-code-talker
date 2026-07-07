# PLAN_PREDICATE_QUERIES.md — predicate-based "find" queries in the chat grammar

**Goal:** a new query shape, "find [me] a/the `<term>` `<entityType>`" (e.g. "find me the payment
class"), that selects **by type filter ∧ fuzzy property-surface match** rather than resolving to
one best entity — the first general-purpose predicate-selection entry point in the live chat
grammar, built to compose with the existing compositional machinery rather than duplicate it.

*(Drafted 2026-07-07. Product feature, not a research plan — distinct from the three sibling
research docs [[PLAN_ontology-hierarchies.md]], [[PLAN_INFERENCE_TESTING.md]], and
[[PLAN_ADVANCED_GRAMMAR.md]], but sequenced alongside them; see §5.)*

**Ground rules** (same as every other grammar surface in this repo): no-LLM, deterministic,
closed, explainable. A zero-hit search renders an honest miss naming both the recognized type and
the failed term — never a confident-wrong empty (the exact failure class the concurrent Bug-C fix
in `src/ask.mjs` eliminates for relation traversal; this feature must not reintroduce it for
selection).

---

## 1. What already exists — build on it, don't duplicate it

The compositional grammar (`src/ask.mjs`'s `parseComposite`, ask.mjs:270-285) is a dispatcher of
small parse productions (`parseNegation`, `parseAggregate`, `parseSuperlative`, `parseList`,
`parseNested`, `parseRelationalOrQualified`) compiling to a shared AST evaluated by `evalSet`
(ask.mjs:898-940) and rendered by `renderComposite` (ask.mjs:1065-1129). Three existing pieces are
exactly what "find" needs:

- **`{node:"allOfClass", entityType}`** (ask.mjs:901) — the type-filter half of "find me the
  payment class."
- **`QUALIFIERS`/`{node:"qualifier"}`** (ask-vocab.mjs:499-512, ask.mjs:934-937) — the right
  *shape* for a post-filter over a base set (`PLAN_ADVANCED_GRAMMAR.md`'s own text: "an AST
  composition the compositional grammar's qualifier machinery already half-owns").
- **`{node:"list"}` + `compositeList`/`OVERFLOW_CAP`** (ask.mjs:1044-1045,1055-1057,1076-1087) —
  the list-rendering convention to reuse verbatim: cap 12, "…and N more" tail, honest zero-hit
  wording.

`ask-vocab.mjs:359-360`'s `WRONG_WORDS: { property: "attribute", properties: "attributes" }`
already equates "a property" with the graph's `Attribute`/`ind.attributes` concept — this grounds
the property-surface search in §3 in the codebase's own vocabulary, not an invented mapping.

So "find" is **one new production in `parseComposite`'s chain**, producing one new AST node type
— not a parallel engine.

---

## 2. Grammar/parse layer

New `parseFind(w, lc, nlp, depth)` in `src/ask.mjs`, inserted after `parseSuperlative`, before
`parseList` (ask.mjs:273-285):

```js
return parseNegation(text, nlp, 0)
  || parseForwardNegation(w, lc, nlp)
  || parseTemporal(w, lc, nlp, 0)
  || parseAnaphora(w, lc, nlp)
  || parseAggregate(w, lc, nlp)
  || parseSuperlative(w, lc, nlp)
  || parseFind(w, lc, nlp, 0)        // NEW
  || parseList(w, lc, nlp, 0)
  || parseNested(w, lc, nlp, 0)
  || parseRelationalOrQualified(w, lc, nlp, 0);
```

**Trigger:** `lc[0] === "find"` (currently unclaimed — "find" today is only noise/frame-word, or
an optional lead `matchNegationSet` already consumes ahead of a set-negation, `normalize.mjs:
316-323` — since `parseNegation` runs first in the chain, "find modules that don't import X" is
unaffected).

**Two closed orders**, reusing `LIST_SKIP` (ask.mjs:574) exactly as `parseList` does:

- **Order A — trailing type** ("find me the payment class"): if the last token is a valid
  `entityNoun` (excluding the `"Change"` wildcard pseudo-type, same exclusion `parseList` makes at
  ask.mjs:608) → `entityType` = that, `term` = everything before it.
- **Order B — leading type + linker** ("find the class named Foo", linkers:
  `called/named/about/like/containing/matching/with`): if the first token is a valid `entityNoun`
  **and** the next token is a linker → `entityType` = the first token, `term` = the rest. The
  explicit linker requirement keeps "find the file that imports X" falling through unchanged to
  `parseRelationalOrQualified` (`that` is not a linker).

A recognized-but-empty term ("find the classes") degrades to a plain list
(`{node:"list", entityType, base:{node:"allOfClass", entityType}}`). A `find`-led query matching
neither order returns `{node:"miss", reason: ...}` naming `LISTABLE_KINDS` — a **parse-time** miss,
structurally distinct from a zero-hit search (§4).

Output AST: `{ node: "find", entityType, term }`.

---

## 3. Resolution/selection layer — the narrow-then-broaden cascade

**Confirmed match scope (refined over two operator rounds):**

1. **Narrow pass — self + descendants ("down the tree"):** for each type-filtered candidate, match
   the term against its own `label`+`attributes`, **and** against every descendant reachable via
   `inherits` edges pointing at it (subclasses, recursively) — a subclass *is a kind of* the
   candidate, so a hit anywhere in its subtree counts. Stop here if this yields ≥1 hit — never
   silently widen when a specific answer exists (mirrors the Bug-C discipline: prefer the precise
   grain).
2. **Broad pass — only if the narrow pass returns zero hits, across the WHOLE type-filtered pool:**
   walk each candidate up to its superclass(es) via `inherits`, test the term against the
   superclass's own `label`+`attributes`; if that also misses, test the superclass's *other* direct
   children (one level down — siblings sharing a common ancestor). A hit here renders as
   explicitly-labeled "no exact `<type>` named `<term>`, but found a related `<type>` under the
   same `<superclass label>`" — never presented as an unqualified match.
3. Only if both passes miss does §4's plain honest miss render.

**Not special-cased to "class":** the cascade is generic over whatever `entityType` the query
resolves to. Applicability is detected dynamically — "does at least one `inherits` edge exist
between two individuals of `entityType`?" — not hardcoded to `entityType === "Class"`. When no such
edges exist for the resolved type (the common case for `Module`/`Function` today), the broad pass
is a no-op and the search degrades to the flat own-label+attributes match.

Implementation: `descendantsOf`/`ancestorsOf`-style helpers beside `moduleIdOf` in `ask.mjs`,
reusing the existing `inherits` edge kind (no new relation/data needed). New `evalSet` case:

```js
case "find": {
  const tokens = componentSet(ast.term);              // existing tokenizer, ask.mjs:1140
  if (!tokens.size) return [];
  const pool = graph.individuals.filter((i) => i.class === ast.entityType);
  const surface = (ind) => [ind, ...descendantsOf(graph, ind.id)]
    .map((x) => `${x.label} ${(x.attributes || []).map((a) => a.value).join(" ")}`.toLowerCase());
  const hitsIn = (candidates) => candidates.filter((ind) =>
    [...tokens].every((t) => surface(ind).some((s) => s.includes(t))));
  let hits = hitsIn(pool);                             // narrow pass
  let related = false;
  if (!hits.length) {
    const ancestors = new Set(pool.flatMap((ind) => ancestorsOf(graph, ind.id)));
    const siblings = [...ancestors].flatMap((a) => childrenOf(graph, a.id));
    hits = hitsIn([...ancestors, ...siblings]);         // broad pass
    related = hits.length > 0;
  }
  return { matches: hits, related };
}
```
(Illustrative — final implementation should reuse `resolveObject`'s tie-break convention: own-label
hits rank above attribute-only hits, shorter label wins ties.)

---

## 4. Render layer

New `renderComposite` branch, before the generic fallback:

- **Zero hits (both passes exhausted):** `no <noun> found matching "<term>".` — honest, names both
  type and term.
- **Broad-pass hit (`related: true`):** `no exact <noun> named "<term>", but found a related
  <noun> under <superclass label>: <list>.` — never an unqualified match.
- **One hit (narrow pass):** a short citation line (`found <noun> <label> matching "<term>".`).
- **Many hits:** the existing `compositeList`/`OVERFLOW_CAP` convention (cap 12, "…and N more"),
  reused verbatim.
- **Type-not-recognized** (`parseFind`'s parse-time miss): a *different* code path than the
  zero-hit render above — this is the exact structural distinction the Bug-C fix establishes for
  relation traversal, applied here to selection.

---

## 5. Sequencing

- **Phase 1 (quick win, land now):** the core feature — §2 grammar, §3 narrow pass + type filter,
  §4 render for the zero-hit/one-hit/many-hit cases. S-M effort, reuses existing machinery
  end-to-end.
- **Phase 1 also includes the broad (ancestor+sibling) pass** per operator direction — though the
  plan's own default recommendation would have deferred it to confirm real usage first; it ships
  now at explicit operator request, so watch its results closely against the confident-wrong
  discipline once live.
- **Phase 2 — §6 generalization** (compositional predicate-conjunction over a find-seed): ships in
  the same pass as the core feature per operator direction (also pulled forward from its natural
  "wait for usage" position).

---

## 6. Generalization to "select with predicates"

Because `{node:"find", entityType, term}` is a first-class sibling of `{node:"allOfClass"}`/
`{node:"qualifier"}` inside `evalSet`/`{node:"boolean"}`, it composes for free with
`BOOLEAN_CONNECTIVES`'s existing fold (and/or/but-not) over any set-producing AST node — a
`{node:"find",...}` atom is one more legal seed, zero new boolean-algebra code needed. Concretely:
extend `parseRelationalOrQualified`'s clause-splitting (ask.mjs:729-748) to recognize a leading
`find <term> <entityType> that|which|who <predicate>` shape and seed the boolean fold with a
`{node:"find",...}` atom instead of `{node:"allOfClass",...}` — enabling "find modules that import
store and have no tests." This is a small, isolated extension of existing machinery, not new
architecture.

---

## 7. Test plan

New file `test/ask-find.test.mjs`, mirroring `test/ask-compositional.test.mjs`'s fixture-building +
hit/honest-miss pairing convention:

1. Basic hit at each grain (Module/Class/Function).
2. Multi-token AND case.
3. Grain-collision adversarial case (Class vs Function sharing a stem) — proves `entityType` hard-
   filters.
4. Descendant-hit case — term only matches a subclass; narrow pass finds it without broadening.
5. Broad-pass case — term matches nothing in the narrow pass but hits a sibling class under a
   common superclass; asserts the render clearly labels it related-not-exact.
6. No-op-cascade case — a type with no `inherits` edges among its individuals (e.g. `Module`)
   degrades cleanly to flat matching.
7. Zero-hit honest miss (both passes exhausted).
8. Type-not-recognized honest miss — proves it's a different code path than case 7.
9. Backward-compat guard (in `test/ask-compositional.test.mjs`) — "find the file that imports
   store" still parses via the existing relative-clause path unchanged.
10. §6 generalization case — "find modules that import store and have no tests" resolves via the
    boolean fold seeded with a find atom.

---

## 8. Risks

- **The inheritance-chain + sibling-broadening scope makes results less predictable than pure
  own-label matching** — watched via the same confident-wrong discipline as the concurrent Bug-C
  fix; the broad pass's explicit "related, not exact" labeling is the mitigation, not a full
  substitute for measuring real usage (which Phase 1 skips per operator direction — flagged here
  so it isn't forgotten, not re-litigated).
- **Pulling the §6 generalization into Phase 1** (rather than waiting for the core feature to see
  usage) means the compositional-conjunction surface ships without the validation signal the
  original design recommended — same category of risk, same mitigation (close post-ship
  monitoring rather than a pre-ship usage gate).

### Critical Files for Implementation
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/ask.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/ask-vocab.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/test/ask-compositional.test.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/test/ask-find.test.mjs (new)
