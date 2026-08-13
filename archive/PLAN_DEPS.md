# PLAN_DEPS.md — the smallest useful dependency set

**Status: batches 1-2 and 4-7 are landed. Q1 and Q3 are landed (§3.1, §3.9). Q2 is answered:
keep `ink`. Q4 is the operator's one-minute check and is still open.**

Four goals, from the operator:

> 1. replace chunks of our custom code with libraries. 2. attempt to consolidate library usages
> down to as few as possible. 3. upgrade all the libraries and gitlab actions versions. 4. locate
> duplicate code and create internal libraries these usages delegate to. The goal is to have the
> smallest useful set of library dependencies and where we have to attach to a specific version of
> a dependency we are on a current version well within vendor support and there is a healthy
> community to support the library.

**The short answer.** Goal 3 is already done: every dependency sits at its latest published
version except one, and that one is held back on purpose by `renovate.json`'s cooldown (§5). Goal 1
turns up 23 candidates and adopts **zero** into the product path and one (`yaml`) as a
devDependency, for reasons that are mostly structural rather than aesthetic (§3). Goal 2 has
exactly one lever, and it is large and it is the operator's to pull (§4). Goal 4 is where the real work is: **17 duplicated kernels**, one of
them a 50-line module copied on a premise the layer checker contradicts (§6).

Two things fell out that are not dependency work and are reported anyway, because
`CLAUDE.md` says a bug found next door gets folded in rather than passed over quietly:

- **`tmct_search`'s `name` parameter was a ReDoS** — fixed. `name=(a+)+$` against one 30-character
  label ran past 30 seconds; the same payload now returns a refusal in 1ms. §3.9.
- **`src/adapters/prose-tokens.mjs` duplicates `src/domain/prose.mjs` byte-for-byte**, and its
  header explains this with "Adapters may not import the domain layer." That is false, the layer
  test permits it, and the very file that imports the copy imports domain on the next line. §6.1.

---

## 1. The constraints, up front

Four rules decide most of this doc. Each is verified, not recalled.

### 1.1 `src/domain/` may import nothing non-relative

`test/estate/import-layers.test.mjs:64` fails the build on any bare specifier in `domain/` — not a
library, not `node:fs`. The sole allowlist (`test/estate/layer-allowlist.mjs`) holds one line, for
`wink-model.mjs`'s `require()`, and says the list "can only ever shrink — never add a line."

**So "replace custom code with a library" is unavailable for anything in `src/domain/` as it
stands.** Every candidate below therefore reports which of three things it implies: adopt the
library where it sits (only legal outside `domain/`), move the code to `src/adapters/` first, or
keep the hand-rolled version. Nothing in this plan proposes growing the allowlist.

`domain/` holds 15,723 LOC across 62 modules. It is where nearly all the hand-rolled code lives,
which is not a coincidence: the rule is what made the code hand-rolled.

**One direction that IS legal and is currently believed not to be:** `adapters/` → `domain/` is
downward and permitted (`LAYER_RANK = { domain: 0, adapters: 1, … }`, and the checker only flags
`pointsUpward` or `escapesDomain`). Seven adapter modules already do it. §6.1 is the cost of the
misreading.

### 1.2 Everything under `src/` ships to npm

`package.json`'s `files` array carries `src/`. **A library imported by any shipped `src/` module is
a production dependency for every consumer of the package.** This is the single most decisive fact
in §3, because it means a library adopted to serve a CI check or a maintainer worksheet gets
installed by everyone who installs tmct.

**Resolved by Q1: none of this tier ships any more.** The count below was right — all 13 were
reachable from no public entry point — and the reverse closure added three the trace did not name:
`src/adapters/pii-scan.mjs` imports `pii-rules.mjs`, and `corpus/{wordnet,namenet}/generate.mjs`
both read the WordNet dump. 16 files in all, and the packed list went 278 → 262.

Traced from the six `exports` subpaths plus `bin/tmct.mjs`, following static, dynamic and
`export …  from` edges:

```
src/domain/wordnet/yaml.mjs      src/domain/pii-rules.mjs        src/domain/inflect.mjs
src/domain/schemaorg/turtle.mjs  src/domain/pack-manifest.mjs    src/domain/persona/codegen.mjs
src/domain/semcor/parse.mjs      src/domain/corpus-matrix.mjs     src/domain/licences.mjs
src/domain/publish-gate.mjs      src/domain/markdown-links.mjs   src/domain/version-stamp.mjs
src/adapters/wordnet-source.mjs
```

This was the residue of PLAN_PURGE's promotion policy meeting the `files` array. The promotion was
right (the logic got tests it never had); the packaging never got asked. §7 Q1 asked it, and the
answer was to stop shipping the tier — the two YAML readers by moving out of `src/`, the rest by
name in `files`.

### 1.3 Three CI jobs run without `npm ci`

Verified in `.gitlab-ci.yml`: `pii:lint`, `links:check` and `smoke:post-deploy` have no `npm ci`
step. They reach `src/` directly and must stay dependency-free. That rules out a library in
`markdown-links.mjs` and `version-stamp.mjs` before the choice of library is even interesting.

`license:deps`, `pack:contents` and `publish:npm` **do** run `npm ci` first, so `licences.mjs` and
`publish-gate.mjs` are not blocked by this rule (they are blocked by §1.1 and §1.2 instead).

### 1.4 Two more that narrow the field

**The browser demo copies `src/` verbatim.** `scripts/build-demo-site.mjs` walks `domain/ask.mjs`'s
relative-import closure and copies those files into `public/engine/` unmodified, with no bundling;
bare specifiers resolve through `public/index.html`'s importmap to esm.sh. The closure is 24 files
and includes `domain/interpret/fuzzy.mjs`, `domain/hash.mjs` and `domain/codegraph.mjs`. A library
imported by any of them needs a CDN importmap entry and a pinned esm.sh URL.

**New deps must clear three gates:** `src/domain/licences.mjs`'s allowlist (MIT, ISC, BSD-2-Clause,
BSD-3-Clause, Apache-2.0, MPL-2.0, 0BSD, CC0-1.0, Unlicense), `publint`, and an entry in
`test/estate/pack-manifest.json`. Every library named in this doc is MIT or ISC, so the licence gate
is not what stops any of them.

**And the constitution:** no LLM in the product path. Nothing here proposes one.

---

## 2. The library facts

Verified 2026-07-17 against `registry.npmjs.org` and `api.npmjs.org`. Downloads are last-week
point totals. Nothing in this table is from memory.

| library | latest | published | weekly downloads | licence | unpacked | direct deps |
|---|---|---|---|---|---|---|
| `yaml` | 2.9.0 | 2026-05-11 | 160,009,938 | ISC | 685,953 B (233 files) | 0 |
| `js-yaml` | 5.2.1 | 2026-07-02 | 245,725,966 | MIT | 1,440,824 B | 1 |
| `n3` | 2.1.1 | 2026-07-03 | 174,971 | MIT | 821,004 B | 2 |
| `spdx-expression-parse` | 5.0.0 | 2026-07-16 | 46,853,754 | MIT | 12,535 B | 2 |
| `spdx-satisfies` | 6.0.0 | 2025-01-07 | 1,226,534 | MIT | 7,265 B | 3 |
| `semver` | 7.8.5 | 2026-06-19 | 745,525,887 | ISC | 101,065 B | 0 |
| `fastest-levenshtein` | 1.0.16 | 2022-08-02 | 18,286,199 | MIT | 21,281 B | 0 |
| `leven` | 4.1.0 | 2025-09-11 | 43,262,517 | MIT | 10,206 B | 0 |
| `pluralize` | 8.0.0 | 2019-05-25 | 24,750,310 | MIT | 17,725 B | 0 |
| `marked` | 18.0.6 | 2026-07-09 | 51,186,755 | MIT | 451,294 B | 0 |
| `mdast-util-from-markdown` | 2.0.3 | 2026-02-21 | 42,487,856 | MIT | 97,286 B | 11 |

Maintenance notes worth carrying into the verdicts:

- **`pluralize` last published 2019-05-25**, nearly seven years ago. Downloads stay high because it
  is a transitive dep of older toolchains. High usage and active maintenance are different claims.
- **`fastest-levenshtein` last published 2022-08-02**, about four years.
- **`spdx-satisfies` last published 2025-01-07** and pins `spdx-expression-parse@^3.0.0` while the
  standalone latest is 5.0.0. Adopting it installs two copies of the same parser.
- `yaml`, `js-yaml`, `n3`, `semver`, `marked` and `spdx-expression-parse` are all currently
  maintained by the last-publish measure.

---

## 3. Goal 1 — custom code a library could replace

**23 candidates examined. 0 adopted into the product path. 1 adopted as a devDependency (§3.1).
1 real defect found and fixed without a library (§3.9).**

That is not a defence of hand-rolled code. It is what §1.1 and §1.2 produce: the code is in
`domain/` because the layer rule put it there, and adopting a library means either moving the code
out or shipping the library to every user for a job only maintainers run.

| # | module | LOC | candidate | verdict |
|---|---|---|---|---|
| 3.1 | `domain/wordnet/yaml.mjs` | 133 | `yaml` | **adopted** — moved out of `src/`, deleted |
| 3.1 | `domain/semcor/parse.mjs` | 87 | `yaml` | **adopted** — same move |
| 3.2 | `domain/schemaorg/turtle.mjs` | 25 | `n3` | keep |
| 3.3 | `domain/licences.mjs` | 68 | `spdx-expression-parse` | keep |
| 3.4 | `domain/publish-gate.mjs` | 41 | `semver` | keep |
| 3.5 | `domain/interpret/fuzzy.mjs` | 118 | `fastest-levenshtein`, `leven` | keep, emphatically |
| 3.6 | `domain/inflect.mjs` | 67 | `pluralize` | keep |
| 3.7 | `domain/markdown-links.mjs` | 55 | `marked`, `mdast-util-from-markdown` | keep |
| 3.8 | `domain/version-stamp.mjs` | 36 | an HTML parser | keep |
| 3.9 | `domain/codegraph.mjs` | 1,967 | `heap-js`, `graphology`, `natural`, `picomatch`, `re2` | keep; **one real defect, now fixed** |
| 3.10 | `adapters/graph-build.mjs` | 428 | `n3`, `enhanced-resolve` | keep |
| 3.11 | `domain/hash.mjs` | 147 | `node:crypto` | keep — the model case |
| 3.12 | `domain/grammar/ace.mjs` | 480 | none exists | keep — a horizon, §3.12 |

### 3.1 The two YAML readers — the one real opportunity

`domain/wordnet/yaml.mjs` (133 LOC) reads the Open English WordNet dump. Its header documents two
hard-won fixes: quoted scalars containing `": "`, and multi-word keys. `domain/semcor/parse.mjs`
(87 LOC) reads SemCor's flow style and says outright why it is a second reader: "Not a general YAML
parser (this repo has no YAML dependency)."

**The library would work.** Both dumps are real YAML. `yaml` 2.9.0 is ISC, zero dependencies, and
would parse both correctly and delete 220 LOC with a documented bug history. This is the one
candidate where capability is not the obstacle.

Three things stop it today, and all three are structural:

1. Both sit in `domain/`, so the import is illegal (§1.1).
2. Both ship (§1.2). `yaml` is 686 KB across 233 files. Adding it puts that in every tmct install.
3. Their only callers are maintainer-only: `adapters/wordnet-source.mjs` (itself maintainer-only),
   `scripts/build-persona-tiers.mjs`, `scripts/extract-persona-sources.mjs`,
   `scripts/build-persona-examples.mjs`. Verified — no product path reaches either.

**Landed.** Both readers moved out of `src/` to `scripts/lib/`, which is not shipped and not under
the layer rule, so `yaml` went in as a **devDependency** at zero production cost — 41 packages
before, 41 after, and no shipped file imports it.

**The subset did not work, and only the real dump could show it.** Run against all 73 files of a
real clone, the hand-rolled reader disagreed with `yaml` on 38 of them, for two reasons:

- It never unescaped YAML's `''` → `'`, so every lemma and definition carrying an apostrophe came
  out corrupted (`caesar''s_agaric`). 36 files.
- A definition wrapping onto a continuation line that opens with `- ` (`…physically difficult / - if
  not impossible - for…`) was read as a new list item. That truncated the scalar, dropped the rest
  of the record, and swallowed the synset after it. Across the 45 synset files the subset reader
  returned **107,172 synsets where the library returns 107,526** — **354 gone**, silently, into a
  maintainer worksheet, 207 of them in `noun.artifact.yaml` alone. The library's total is exactly
  the count this repo's own corpus generator header documents.

So this replaced 220 LOC with a correctness fix, not just with less code. The cost is speed: `yaml`
parses the full dump in ~55s against the subset reader's ~2s, which these run-by-hand tools can pay.
Both documented edge cases (a quoted scalar holding `": "`, and multi-word keys) are pinned against
the library, along with the two bugs above.

### 3.2 `schemaorg/turtle.mjs` — keep

25 LOC, three regexes, one caller, 7 tests. `n3` is 821 KB and pulls `buffer` and `readable-stream`
(browser polyfills for a Node script). Its 174,971 weekly downloads are the smallest community in
the table, though it is the standard RDF library and is currently maintained. None of that matters
against the trade: 821 KB and two transitive deps to replace 25 lines that a test suite already
pins. Keep.

### 3.3 `licences.mjs` — keep, and here is the evidence

The hand-rolled SPDX evaluator has documented fail-closed quirks: nesting, `WITH`, or a mixed
`OR`/`AND` returns false and asks a human.

**We ran the check rather than reasoning about it.** The production tree declares exactly four
distinct licence strings across 41 installed packages:

```
38  MIT
 1  ISC
 1  BSD-3-Clause
 1  (MIT OR CC0-1.0)      ← type-fest@5.8.0
```

All four pass. **The fail-closed paths have never fired on this tree.** `(MIT OR CC0-1.0)` is
handled correctly: the outer parens strip, the flat `OR` splits, `MIT` is allowlisted.

26 tests pin the rule. `spdx-expression-parse` is small (12,535 B) and well maintained, but it
parses expressions into an AST and leaves you to write the allowlist walk anyway — so it replaces
the easy half. `spdx-satisfies` does the whole job and is the worse citizen: last published
2025-01-07, and it pins `spdx-expression-parse@^3.0.0` against a standalone latest of 5.0.0, so the
tree grows two copies of one parser.

Keep. If the tree ever grows a `WITH` or a nested expression, CI fails closed and a human looks.
That is the designed behaviour.

### 3.4 `publish-gate.mjs` — keep, because `semver` is the wrong generality

`semver` is the best-credentialled library in this document: ISC, zero deps, 101 KB, 745M downloads
a week, published 2026-06-19. There is no maintenance argument against it.

The argument is behavioural. `publish-gate.mjs` documents its own contract: pre-release and build
metadata are **ignored**, because the gate asks whether a release moved, and `2.2.0` and
`2.2.0-rc.1` are the same release for that purpose. `semver.compare` orders `2.2.0-rc.1` **below**
`2.2.0`. Adopting `semver` and calling `compare` changes the answer the module exists to give. You
would keep a wrapper that strips the pre-release and compares the core — which is the 41 lines you
were replacing.

Keep. 10 tests cover same, ahead and behind.

### 3.5 `interpret/fuzzy.mjs` — keep, and this one is not close

Four independent reasons, any one sufficient:

1. **It is Optimal String Alignment (a restricted Damerau-Levenshtein). The libraries are not even
   that.** `leven` and `fastest-levenshtein` compute plain Levenshtein with no transposition.
   `fuzzy.mjs` handles adjacent transpositions (`prev2[j - 2] + cost`) — the OSA recurrence, which
   forbids editing a substring twice, so `editDistance("CA","ABC")=3` where true Damerau-Levenshtein
   gives 2 (OSA is not a metric — it can break the triangle inequality; Damerau 1964, Levenshtein
   1966). The decision is unchanged: OSA handles transpositions and the libraries do not. Swapping in
   either changes every fuzzy verdict in the product, and the fuzzy tier is what decides whether a
   typo gets repaired or the sentence lands on the miss wall.
2. **It is bounded, and the bound is the point.** `editDistance(a, b, max)` returns `max + 1` as
   soon as the row minimum provably exceeds `max`. The libraries compute the full distance. The
   early exit is what makes `fuzzyMatchInSet`'s tie-refusal cheap enough to run over every
   candidate.
3. **It is in `domain/`** (§1.1) **and in the browser closure** (§1.4). A bare specifier needs an
   importmap entry and an esm.sh pin, and breaks the "unmodified byte-for-byte copy" property the
   demo build rests on.
4. `fastest-levenshtein` last published 2022-08-02.

Keep.

### 3.6 `inflect.mjs` — keep, because `pluralize` answers the opposite question

`inflect.mjs`'s `pluralOf` **wants** `"foots"`. It generates candidate surface forms for the
real-word collision table, and a form it fails to generate is a real word the repair tier may
rewrite into a different question and answer with confidence. `pluralize` declares the one correct
plural and returns `"feet"`.

This is the same finding PLAN_PURGE §12.7 recorded for `IRREGULAR_PLURALS` vs `pluralOf`, and
`domain/persona/codegen.mjs:30` states it in the tree: "This is deliberately NOT
src/domain/inflect.mjs's pluralOf, and the two must" stay apart. The library sits on the
`IRREGULAR_PLURALS` side of that split.

Also: `pluralize` has no `pastOf` or `gerundOf`, and `inflect.mjs` needs `-ed` and `-ing` too. So it
covers part of one of four exports. Also `domain/`, also ships, also last published 2019-05-25. 19
tests. Keep.

### 3.7 `markdown-links.mjs` — keep, decided by CI before the library choice matters

`links:check` runs with no `npm ci` (§1.3), so today there is no `node_modules` for this code to
import from. That settles it while the job stays dependency-free.

For the record, if the job ever installed: `mdast-util-from-markdown` gives an AST with source
positions and would do the job, including the code-span problem. It costs 97 KB and 11
direct dependencies. `marked` is a renderer; extracting link targets means walking its lexer output.
Both are well maintained. Keep. 10 tests.

### 3.8 `version-stamp.mjs` — keep

Same rule: `smoke:post-deploy` runs with no `npm ci` (§1.3). The candidate class is an HTML parser
(`parse5`, `node-html-parser`, `cheerio`); we did not price them, because the npm-ci constraint ends
the question first.

On merit it would still be keep. The module is 36 lines and exists **because** the regex existed
three times and had diverged — one writer, one reader, one verifier, disagreeing about what a
version looks like. The fix was one pattern in one place, not a DOM. A parser would be more correct
over arbitrary HTML; this page and this element are ours and we generate both. 12 tests.

### 3.9 `codegraph.mjs` — keep, and one real defect to fix

Nothing here justifies a library, and one thing here is a bug.

**The defect: `tmct_search`'s `name` parameter was a ReDoS** — fixed by bounding the input, per Q3.
`codegraph.mjs` compiled caller-supplied text with `new RegExp(name, "i")` and ran it against every
individual's label; the `try/catch` around it handled syntax errors and nothing else. `name` is an
agent-facing tool parameter. `name=(a+)+$` against a single 30-character label ran past 30 seconds
at full CPU; it now returns a refusal in 1ms.

**The trace missed a second sink.** `adapters/providers/graph-service.mjs` compiled the same
parameter again for the same scorer, and on an invalid pattern it set `nameRe = null`, quietly
running the search unfiltered. Both sinks now share one bounded compiler.

**Two shapes cost time, and only measurement separates them.** A quantified group backtracks
exponentially in the label length, which is the textbook case. But `a*a*a*a*a*$` has no group at all
and still took 101 seconds against 128 characters, because each extra quantifier raises the degree
of a polynomial. Detecting nested quantifiers alone would have left that wide open. So the gate
refuses a quantified group and a back-reference, caps the quantifier count, and caps the tested
label length; a matching budget backstops the lot, on the reasoning that a hand-written static gate
is exactly the kind of thing that can miss a case.

`re2` stays declined: it is a native binary, which fights `.npmrc`'s `ignore-scripts=true`
hardening, and it would have to live in `adapters/`.

**The library candidates, all declined:**

- **A 26-LOC binary min-heap** (`:660-685`) inside `spiralExpand`. `heap-js` would replace it. It is
  the one place a hand-rolled sift-down bug could hide behind passing behavioural tests, and no test
  targets the heap directly. It is also 26 lines in `domain/`, and relocating `codegraph.mjs` to
  `adapters/` to save them would trade a strong architectural invariant for a rounding error.
- **Four BFS walks** (`:341-392`, `:1141-1179`, `:571-626`, `:551-567`). `graphology` would be a bad
  trade: these are not textbook BFS. `impactClosure` folds `callsSymbol` to module granularity
  mid-walk while accumulating a test index; `beamExpand` does per-edge-kind successors with a
  margin-relative beam. You would build a `Graph` per query and keep all the custom logic. The
  algorithms graphology is worth pulling in for — PageRank, topological sort, connected components —
  are not present here. The duplication is real and §6.5 handles it internally.
- **IDF** (`:760-768`). The library-shaped part is one `Math.log` line inside a 209-LOC scoring
  function whose other 208 lines are nine opt-in domain re-rank families. `natural` and
  `wink-bm25-text-search` want to own the tokenizer, the document store and the scoring function,
  and would own about 1% of the code while fighting the rest.
- **`isTestLabel`** (`:473`). Three regexes. `picomatch` is not warranted, and the domain copy could
  not import it. The duplication against `graph-build.mjs` is real: §6.6.
- **`normPath`/`basename`** (`:116-127`). ~15 LOC, POSIX-only **by design** — graph labels are
  always `/`-separated whatever the host OS. `node:path` is banned in `domain/` and would be a
  correctness regression on Windows, where `path.basename` honours `\`.
- **`commitDateRange`** (`:1419-1433`). 15 LOC producing "May–Jun 2026". `Intl.DateTimeFormat` is
  locale- and ICU-version-dependent, which would break the determinism the codebase rests on.
  `date-fns` cannot be imported into `domain/`.
- **`resolveSymbol`** (`:148-177`). No edit distance here at all — discrete tiers (exact 100,
  basename 80, substring-with-length-penalty 50). Deliberate: deterministic, explainable scores.
  A similarity library would change ranking semantics, not simplify code.

### 3.10 `graph-build.mjs` — keep

**The thing we went looking for is not there.** There is no regex JS parser and no hand-rolled
import extractor. `graph-build.mjs` consumes already-parsed module records (`m.imports`,
`m.defines`, `m.calls`) from an external extractor. Neither file ever sees source text. So `acorn`,
`es-module-lexer` and `oxc-parser` have no subject here. Recorded so nobody re-runs this search.

The `prefixes`/`vocabulary` block (`:365-398`) looks like the start of an ontology layer. Its own
comment is accurate: "the graph is JSON-label-only (no RDF store)." Nothing parses or reasons over
those strings; they are documentation for human readers. `n3` and `rdflib` would have nothing to do.

`internalImports` (`:84-96`) resolves **Python** dotted names. `enhanced-resolve` implements Node
semantics and would be actively wrong.

`graph-build.mjs` is in `adapters/` and **could** legally take a library. Nothing in it wants one.

### 3.11 `hash.mjs` — keep. This is the model of a good hand-rolled module

147 LOC: FNV-1a 32-bit plus a full SHA-256 (FIPS 180-4). Its header argues the case and the argument
holds up:

- Fact ids are content-addressed by it, so the digest must be **cross-version stable**. A library
  that changes its output changes every fact's identity across the whole memory graph.
- It must be synchronous, and it must run in the browser. Verified: `hash.mjs` is in the 24-file
  browser closure (§1.4). `node:crypto` is unavailable there and banned in `domain/` anyway.
- **It is pinned byte-identical to `node:crypto`** by `test/adapters/hash-digest.test.mjs`, which
  compares against `createHash("sha256")` on the classic vectors, every block and padding boundary,
  and random inputs at every small length.

Hand-rolled crypto is normally the first thing to delete. This one states its requirements, meets
them, and proves it against the reference implementation on every run. Keep, and leave the header
alone.

### 3.12 `grammar/ace.mjs` — no library exists yet

480 LOC parsing Attempto Controlled English. We searched npm for a controlled-natural-language or
ACE parser and found nothing relevant; the reference implementation, APE, is Prolog. **No maintained
JS library covers ACE at any subset we could use.** The candidate literatures are the Attempto
project and the wider CNL community. Until a JS implementation exists, this stays hand-rolled, and
that is fine — it is the product's core competence, not incidental plumbing.

---

## 4. Goal 2 — consolidation

Runtime deps: `ink`, `react`, `smol-toml`, `wink-eng-lite-web-model`, `wink-nlp`.
Dev: `esbuild`, `ink-testing-library`, `playwright`, `publint`.

**No library here subsumes another's job.** `smol-toml` reads `tmct.toml`, the wink pair does
lemma/POS, `ink` draws the TUI. They do not overlap. The consolidation question has exactly one
answer, and it is about `ink`.

### 4.1 `ink` is 36 of the 40 production packages

Measured with `npm ls --omit=dev --all`, counting only installed packages (unmet optionals cannot
ship):

```
all production packages reachable:  40
reachable without ink:               4   → react, smol-toml, wink-nlp, wink-eng-lite-web-model
packages ink alone drags in:        36
```

The whole production tree, minus four packages, exists to draw a 242-line terminal UI. `ink` itself
is 1.1 MB on disk; its subtree adds `yoga-layout`, `es-toolkit`, `type-fest`, `ws`,
`react-reconciler`, `scheduler` and 30 more.

**Is `react` there only because `ink` needs it? No — and the answer is more interesting than yes.**
`src/surfaces/tui/app.mjs:15` imports React directly and uses `useEffect`, `useState` and
`React.createElement`. So `react` is a real direct import. But it is `ink`'s programming model:
`ink` is a React renderer and declares `react >= 19.2.0` as a peer. Removing `ink` removes `react`.
They are one decision, not two.

### 4.2 What replacing `ink` would cost

- **`blessed`** — last published 2015-09-03. **`neo-blessed`** — 2018-06-13. Both dormant by the
  measure this plan uses everywhere else. Neither meets the operator's "healthy community" bar.
- **`terminal-kit`** 3.1.3, published 2026-06-29, MIT, 4.1 MB unpacked, 8 direct dependencies. It is
  maintained. We have not priced its full transitive tree; that needs an install, and it is the only
  candidate that would survive to that step.
- **`@opentui/core`** 0.4.4, published 2026-07-16 — very actively developed. `app.mjs:10` passed on
  it because it depends on Bun FFI. **We checked, and that still holds at the current version:** it
  depends on `bun-ffi-structs@0.2.4`, ships eight platform-specific native binaries as optional
  deps, and peers on `web-tree-sitter`. Native binaries also fight `.npmrc`'s `ignore-scripts=true`
  hardening. The `app.mjs` comment is accurate and can stay. Worth re-checking if it drops the Bun
  dependency — the project moves fast.

### 4.3 The lever the operator actually has

`--plain` already ships. `bin/tmct.mjs:609` selects it on `--plain` **or** a non-TTY stdin/stdout,
and `:614` loads the Ink app through a lazy dynamic import, so the plain path never pays for it. The
readline shell and the TUI go through the same `createSession` sink; only the drawing differs.

So there are three coherent positions, and choosing between them is a product call:

1. **Keep `ink`.** 36 packages buys a full-screen TUI that works and is tested. Current state.
2. **Drop the TUI, keep `--plain` as the only shell.** Production tree goes from 40 packages to 3
   (`smol-toml` + the wink pair). Cost: 242 LOC deleted, a real feature gone, `e2e/tui.test.mjs` and
   `ink-testing-library` gone.
3. **Rewrite the TUI on `terminal-kit` or on raw ANSI.** Cost: a rewrite of 242 LOC and the loss of
   React's model, for a transitive tree we have not measured. Least attractive of the three.

§7 Q2 asks it. We do not recommend a change on our own: 36 packages is the price of the feature,
and "smallest useful set" has the word *useful* in it.

### 4.4 Sentence splitting: wink already does it, and the copies are principled

The obvious consolidation — "three splitters, and `wink-nlp` is already a dep" — does not hold.

`src/services/sentences.mjs` already uses wink's own sentence-boundary detection. The other two
cannot:

- `domain/completions/rank.mjs` is in `domain/`, where wink is illegal (§1.1), and it is under
  `codegraph.mjs`'s browser closure neighbourhood.
- `scripts/lib/text-corpus.mjs` is deliberately regex-based. Its header explains why: it measures
  template coverage against a **frozen** corpus, and a plain splitter that over-splits predictably
  is what makes two versions comparable.

Both copies have a stated reason and the reasons are good. What is left is a **name collision**, not
a duplication: §6.2.

---

## 5. Goal 3 — upgrades

**This goal is essentially already done, and `renovate.json` is why.** Reporting that is more useful
than inventing work.

### 5.1 npm dependencies: one behind, on purpose

`npm outdated` returns exactly one row:

```
Package  Current  Wanted  Latest
ink        7.1.0   7.1.1   7.1.1
```

**`ink@7.1.1` was published 2026-07-16 — yesterday.** `renovate.json` sets
`minimumReleaseAge: "14 days"`, so Renovate will not propose it until about 2026-07-30. The one
outdated dependency is outdated *by policy*, and the policy is the supply-chain cooldown that gives
a hijacked release two weeks to be reported and yanked. The system is working.

Everything else sits at latest:

| dependency | installed | latest | last published |
|---|---|---|---|
| `react` | 19.2.7 | 19.2.7 | 2026-06-01 |
| `smol-toml` | 1.7.0 | 1.7.0 | 2026-06-21 |
| `wink-nlp` | 2.4.0 | 2.4.0 | 2025-06-30 |
| `wink-eng-lite-web-model` | 1.8.1 | 1.8.1 | 2024-11-30 |
| `esbuild` | 0.28.1 | 0.28.1 | 2026-06-11 |
| `publint` | 0.3.21 | 0.3.21 | 2026-05-13 |
| `playwright` | 1.61.1 | 1.61.1 | 2026-06-23 |
| `ink-testing-library` | 4.0.0 | 4.0.0 | 2024-05-22 |

**On "well within vendor support":** every dependency is at its latest published version, which is
the strongest form of the claim. The slowest-moving are `wink-eng-lite-web-model` (2024-11-30) and
`ink-testing-library` (2024-05-22). Both are at latest, so there is no newer version to be behind.
The wink pair is the core of the product's NLP tier and its release cadence is worth watching; it is
not a problem to fix today.

**Pinning is inconsistent, and that is a real finding.** `.npmrc` sets `save-exact=true` and
`renovate.json` sets `rangeStrategy: "pin"`. But the five production deps carry `^` ranges
(`^ink`, `^react`, `^smol-toml`, `^wink-eng-lite-web-model`, `^wink-nlp`), while two devDeps
(`playwright`, `publint`) are exact. The exact ones look like they were added after the `.npmrc`
hardening landed. Renovate's `pin` strategy would fix this — if it ran (§5.3).

### 5.2 GitLab CI

Read from `.gitlab-ci.yml`. Three findings, one actionable.

| thing | pinned to | current | verdict |
|---|---|---|---|
| `image: node:24` | floating major | resolves to 24.18.0 (2026-07-14) | fine — floating major on an LTS line |
| `renovate/renovate` | `43.264.2` | `43.265.3` (2026-07-16) | one patch behind; Renovate self-bumps this |
| `osv-scanner` | `v2.0.2` | **`v2.4.0`** (2026-06-18) | **two minors behind — nothing will fix this automatically** |
| `include: template: Security/SAST.gitlab-ci.yml` | unversioned | tracks the GitLab instance | nothing to pin |
| `include: template: Security/Secret-Detection.gitlab-ci.yml` | unversioned | tracks the GitLab instance | nothing to pin |

**The `osv-scanner` pin is the one real upgrade item in this whole goal.** It sits inside a
`curl` URL in a script block:

```
curl -sSL -o /usr/local/bin/osv-scanner
  https://github.com/google/osv-scanner/releases/download/v2.0.2/osv-scanner_linux_amd64
```

Renovate's `config:recommended` covers npm manifests and `gitlabci` `image:` tags. It does **not**
read version numbers out of a curl URL. So this pin is invisible to the automation that covers
everything else, and it will drift silently until someone notices — which is what happened.

Two ways to close it: a Renovate `customManagers` regex rule matching the release URL, or a manual
bump plus a note. The regex manager is the one that stops it recurring. The CI comment's reasoning
for pinning at all ("never `releases/latest`") is sound and should survive whichever route is taken.

The `dep:audit` job is otherwise well built: `npm audit --audit-level=high` blocks, `npm outdated`
is visibility-only, and the v2/v1 syntax fallback is three lines.

### 5.3 Has Renovate ever actually run?

**We could not find evidence that it has, and this matters more than any single version above.**

- `git log --all --grep="renovate"` returns two commits: `40f7ae8`, which *added* `renovate.json`,
  and `a48a1d3`, which pinned playwright by hand. No Renovate-authored MR, ever.
- The production deps still carry `^` ranges despite `rangeStrategy: "pin"`. A Renovate run would
  have opened a pin MR.
- The job needs both a pipeline schedule and `RENOVATE_TOKEN`, and the CI comment says the operator
  creates the schedule by hand in the GitLab UI.

If Renovate has never run, then goal 3 is answered on paper and not in fact, and today's healthy
`npm outdated` is the result of recent manual work rather than a working process. §7 Q4 asks. This
is a one-minute check for the operator and it changes the reading of this entire section.

---

## 6. Goal 4 — duplicate code, and the internal libraries to delegate to

**17 duplicated kernels found. This is where the work is.** Every one below was verified by reading
both copies, not by matching names. The order is by strength.

Two rules carried from PLAN_PURGE, because both bite here:

- **Same name plus same shape is not a duplicate.** Six findings below are *collision hazards*:
  merge them and you silently change behaviour. They are marked **DO NOT MERGE** and they are as
  valuable as the merges.
- `public/engine/**` and `src/surfaces/web/*.bundle.js` are untracked build outputs. A clone scanner
  flags ~1,600 windows against them. All artifacts. Excluded from every count here.

### 6.1 `prose-tokens.mjs` duplicates `prose.mjs` on a false premise — fix this first

| copy | LOC |
|---|---|
| `src/domain/prose.mjs` | `STOPWORDS`, `splitIdentifierWords`, `tokenizeProse`, `proseTokensFor` (`:9-58`) |
| `src/adapters/prose-tokens.mjs` | the same four (`:11-60`) |

`diff` of the two regions returns **one line**: `export const STOPWORDS` against `const STOPWORDS`.
Fifty lines, otherwise identical.

**The stated reason is wrong.** `prose-tokens.mjs:3` says:

> Adapters may not import the domain layer

`test/estate/layer-map.mjs:17` ranks `domain: 0, adapters: 1`, and `import-layers.test.mjs:71-72`
flags only `pointsUpward` (`LAYER_RANK[layer] < LAYER_RANK[target]`) or `escapesDomain`
(`layer === "domain"`). **adapters → domain is downward and legal.** Seven adapter modules already
do it. The clincher is in the importer itself:

```js
// src/adapters/memory/blocks.mjs
import { splitIdentifierWords, tokenizeProse } from "../prose-tokens.mjs";   // :9  — the copy
import { SOURCE_PRIOR } from "../../domain/memory/trust.mjs";                 // :10 — importing domain
```

Two adjacent lines. Line 10 does the thing line 9's module says is forbidden.

The cost of the misreading is 50 duplicated LOC plus `test/adapters/prose-tokens.test.mjs`, an
80-line suite whose entire job is to pin the two copies together over a hostile input battery. That
suite is load-bearing *only because the duplication exists*.

**The fix.** Delete the four bodies from `prose-tokens.mjs` and re-export from `domain/prose.mjs`,
or point the three importers (`memory/core.mjs:10`, `memory/blocks.mjs:9`, `graph-build.mjs:20`) at
domain directly. `attachProseTokens` and `buildProseIndex` (`:66-98`) have no domain twin and stay.
The parity suite can go with the duplication. **Delete the header's claim rather than repairing it**
— it describes a rule that does not exist.

Layer: nothing moves. Risk: low, and the parity suite proves equivalence before you start.

### 6.2 `splitSentences` — three implementations, one name collision

Three implementations, and §4.4 shows all three are principled. The problem is narrower:

| where | mechanism |
|---|---|
| `src/services/sentences.mjs:12` `splitSentences` | wink-nlp boundary detection |
| `src/domain/completions/rank.mjs:28` `splitSentences` | regex, `(?<=[.!?])\s+(?=[A-Z0-9])` |
| `scripts/lib/text-corpus.mjs:70` `splitProseSentences` | regex over stripped markdown |

**Two exported functions share the name `splitSentences` with different semantics.** PLAN_PURGE
already renamed the third to `splitProseSentences` for exactly this reason and stopped one short.
Rename `rank.mjs`'s to say what it is (`splitBlockSentences`), and the collision goes. Callers:
`completions/infer.mjs:10` and `rank.mjs:69` only. Small, local, safe.

**DO NOT unify the implementations.** Each has a stated reason and the reasons are good.

### 6.3 `fuzzyCascadeWord` reimplements `fuzzyMatchInSet` — a one-line delegation

`src/domain/ask.mjs:3452-3462` and `src/domain/interpret/fuzzy.mjs:107-118`. Diffed: identical
`best`/`hit`/`tied` loop, identical `editDistance(w, target, Math.min(best, bound))`, identical
tie-refusal return. The only difference is the candidate list.

`ask.mjs:32` **already imports from `fuzzy.mjs`.** Both are `domain/`. The whole fix is:

```js
const fuzzyCascadeWord = (w) => fuzzyMatchInSet(w, CASCADE_FUZZY_TARGETS);
```

Ten lines out, zero risk, no layer movement. The cheapest win in the document.

### 6.4 `agentbench/driver-resolver.mjs` is a fork of `domain/router/drive.mjs`

`memberFilterDrive` (`:47-98` vs `drive.mjs:55-107`), `composeResult` (`:105-121` vs `:108-122`),
`resolverDriver`/`runResolverPlan` (`:125-156` vs `:126-146`). Semantically identical; six clone
windows at 8+ lines. The differences are `refuse(why)` vs `refuse(why, driver)`, and `DRIVER` vs
`ROUTER_DRIVER` — **both of which hold the string `"resolver-0.8.0"`.**

The kernel is already extracted; the bench forked it anyway. Collapse to a shim, exactly as
`agentbench/results.mjs:8` already does (`export * from "../src/domain/router/results.mjs"`).
Precedent set, in the same directory.

### 6.5 Depth-bounded BFS — four copies in `domain/`

`codegraph.mjs:371-389`, `codegraph.mjs:1151-1170`, `router/results.mjs:116-127`,
`router/results.mjs:167-181`. Same frontier walk: `new Set([start])`, `for depth 1..maxDepth`, skip
visited, swap frontier, 8-depth bound. `results.mjs:167-181` even carries the comment "mirrors
renderSubclasses closure", and `codegraph.mjs:1151-1170` is what it mirrors. They differ only in
payload and sort.

`src/domain/planning.mjs` already holds the general primitive (`findActionPath`,
`findReachableSet`, `seedFrontier:16-22`) and is pure, layer 0. A `bfsLevels(start, successorsOf,
{ maxDepth })` generator belongs there. `codegraph.mjs` and `router/results.mjs` are both `domain/`
and can import it freely.

`ask.mjs:1327-1348`'s `descendantsOf`/`ancestorsOf` are a mirror-image pair of **each other** —
unbounded, `queue.shift()` style. A different kernel. Leave them.

### 6.6 The rest of the confirmed duplicates

| # | what | copies | shared kernel → home |
|---|---|---|---|
| 6.6a | `isContentToken` + `makeContentTokens`, byte-identical ×3, each commented "replicated here" | `completions/rank.mjs:11-16`, `infer.mjs:17-23`, `group.mjs:13-20` | export from `domain/prose.mjs` or `completions/injected.mjs`. Layer 0, nothing moves. |
| 6.6b | IDF `log(1 + N/(1+df))` ×5; `group.mjs:88-94` and `rank.mjs:82-89` byte-identical; `codegraph.mjs:762` and `:805` are **the same formula twice in one function** | `memory/blocks.mjs:187-192`, `codegraph.mjs:762-768`, `:801-807`, `group.mjs:88-94`, `rank.mjs:82-89` | `idfOver(idsToTokens) → {N, df, idf}`, pure → a `domain/text-stats.mjs` beside `prose.mjs`. `blocks.mjs` imports it downward. Collapse `codegraph`'s two first. |
| 6.6c | `isTestPath` / `isTestLabel`, same predicate twice, **already drifted** — `graph-build`'s carries a redundant `p.startsWith("tests/")` that `codegraph`'s dropped | `graph-build.mjs:22-23`, `codegraph.mjs:473` | one predicate → `domain/`; `adapters/graph-build.mjs` imports it downward. |
| 6.6d | member-row rendering, byte-identical ×3 | `codegraph.mjs:1840-1847`, `:1886-1893`, `tools/handlers/tmct-context.mjs:110-115` | `memberRow(m)` pure → `domain/codegraph.mjs`; `tmct-context.mjs` (layer 2 → 0) imports it. **Do not merge the sibling-row loops** — `tmct-context.mjs:120` uses an fs-backed `lineAt`, codegraph is documented pure. |
| 6.6e | `escapeHtml`, byte-identical ×2 | `services/viz-theme.mjs:12-14`, `services/ledger-viz.mjs:412` | `ledger-viz.mjs:13` **already imports** `escapeHtml`. The copy is inside a browser `<script>` template literal, and the same file already solves that at `:410` with `${facetCounts.toString()}`. Use `${escapeHtml.toString()}`. (`plan-viz.mjs:423`'s 2-char escape is different and incomplete.) |
| 6.6f | `trackedFiles()` — identical `git ls-files -z` spawn, only the glob differs | `adapters/pii-scan.mjs:30-34`, `scripts/check-links.mjs:23-27` | `trackedFiles(pattern?)` needs `node:child_process` → `adapters/`; the script imports it. Note `check-links.mjs` runs with no `npm ci`, so the adapter must stay builtin-only (§1.3). |
| 6.6g | corpus lane discovery, semantically identical ×2 | `scripts/corpus-matrix.mjs:25-31`, `test/estate/corpus-schema.test.mjs:12-17` | `corpusLanes(dir)` needs `node:fs` → `adapters/`, or `test/corpus/run-lane.mjs` beside `readLaneRows`, which already owns `CORPUS_DIR`. |
| 6.6h | bench `pool()` bounded concurrency, byte-identical ×2, self-admittedly ("copied from…") | `agentbench/run.mjs:69-80`, `infbench/run.mjs:50-61` | pure → a shared bench module. Precedent: `agentbench/results.mjs`. |
| 6.6k | `parseCases` prologue, byte-identical first ~9 lines; bodies correctly differ | `agentbench/grade.mjs:45-54`, `infbench/grade.mjs:66-75` | `parseJsonlRows(text, validateOne)` → the shared bench module. **Merge only the prologue.** |
| 6.6l | `ladderGate` + `rollup`, structurally line-for-line; differences are pure renaming (`rung`↔`band`, `hallucinationRate`↔`fabricationRate`) | `agentbench/grade.mjs:310-324`, `infbench/grade.mjs:349-362` | parameterise → shared bench module. **Leave `renderRollup` alone** — agentbench prints a plan/result pair, infbench one column. |
| 6.6m | `parseArgs` argv scanner ×4, same shape, different flag tables | `agentbench/{run,generate-envelope}.mjs`, `infbench/{run,generate-cases}.mjs` | `parseFlags(argv, spec)` → the shared bench module. **Not `services/cli-args.mjs`** — that is presence/last-wins, the benches are positional-consume-and-throw. Different contracts. |
| 6.6n | import-graph walking ×2 | `scripts/build-demo-site.mjs:42-62`, `test/estate/import-layers.test.mjs:10-33` | different today: the test also reads `export … from` and bare specifiers; the build walker seeds `DYNAMICALLY_LOADED`. Shared kernel is `relativeSpecifiers(text)` → `domain/`; `importClosure(entry)` needs fs → `adapters/`. The layer test then reuses it. |
| 6.6o | `sleep` one-liner ×2 | `scripts/fetch-prose-corpus.mjs:140`, `scripts/post-deploy-smoke.mjs:27` | marginal; `scripts/lib/` exists. **`post-deploy-smoke.mjs` runs with no `npm ci`** — keep any shared home builtin-only. |
| 6.6p | `isMain` guard, 3 spellings across 18 sites | repo-wide | ``import.meta.url === `file://${process.argv[1]}` `` (5×) is **subtly wrong** — it breaks on paths with spaces or unicode, unlike the two `new URL`/`fileURLToPath` forms. Fix the five, don't build a library. |

### 6.7 Collision hazards — DO NOT MERGE

Six places where one name or one shape hides two contracts. Each would look like a duplicate to a
scanner and each would break something if merged.

- **`STOPWORDS` ×4, all different lists.** `domain/prose.mjs:9` (81 words, prose tokenizing) vs
  `domain/interpret/normalize.mjs:555` (45 words, question scaffolding) — diffed at runtime: 45
  words in prose-only, 9 in normalize-only. Plus `adapters/corpus/unknown-ingest.mjs:27` and
  `chat.mjs:4577`'s `RECALL_STOPWORDS`. Merging any pair changes parse behaviour. Note
  `domain/inflect.mjs:16` imports the *normalize* one while `domain/completions/*` import the
  *prose* one, and a reader cannot tell which without checking. Worth a naming fix, not a merge.
- **Third-person `+s/+es/+ies` ×3, three different rule sets.** `inflect.mjs:33-37` `pluralOf`
  (→ `"haves"`, `"gos"`), `grammar/lexicon.mjs:60-66` `thirdPerson` (→ `"has"`, `"gos"`),
  `chat.mjs:4737-4749` `thirdPersonSingularSurface` (→ `"has"`, **`"goes"`**). They disagree on
  `have` and on `o`-final verbs. `pluralOf`'s divergence is deliberate and documented (§3.6). Merge
  and `pluralOf("have")` becomes `"has"`, shifting the real-word-collision table.
- **Singularisation ×5, all different contracts.** `lexicon.mjs:83-90` (array, length-gated),
  `ask.mjs:3702-3709` (array, no gate), `chat.mjs:2111-2117` (one string, `ss$` guard),
  `chat.mjs:4756-4761` (verb-specific), `chat.mjs:4930-4936` (Set, naive). `chat.mjs:2104-2109`
  documents the divergence as intentional: one canonical spelling to *store* vs a Set to *match*.
- **`extractEntity` ×2 — merge the kernel, not the data.** `router/resolver.mjs:127-133` and
  `agentbench/driver-stub.mjs:67-74` share the algorithm and hold **different stopword lists**. Extract `extractEntity(request, stopSet)` and let the stub pass its own set. Merging the
  lists changes the stub floor, which is the stub's whole point.
- **`readLaneRows` ×2 — same name, same error format, different return shape.**
  `test/corpus/run-lane.mjs:37-50` returns rows for one lane; `scripts/corpus-matrix.mjs:35-50`
  returns `{lane, row}` across many.
- **`parseArgs`: `services/extract-facts.mjs:56` is not one of the eight in 6.6m.** It collects
  positionals into `rest` and never throws on unknown flags. Opposite contract. Do not fold it in.

### 6.8 Checked and clean

Recorded so nobody re-runs it. `domain/hash.mjs` is properly centralised and the benches import it.
`adapters/uuid.mjs` likewise. `domain/inflect.mjs` is the single home for `-s/-ed/-ing`.
`agentbench/results.mjs` is already a shim. `domain/version-stamp.mjs` is the single stamp parser
and both `post-deploy-smoke.mjs:16` and `page-version-stamp.test.mjs:13` import it.
`scripts/check-links.mjs` correctly delegates to `domain/markdown-links.mjs`. **PLAN_PURGE's
promotions did hold** — the modules it created are single-homed and imported, not re-forked.

---

## 7. The questions for the operator

Four. Each is a call we should not make alone.

**Q1 — Should the maintainer tier stop shipping? Answered: yes, and landed.** The two YAML readers
moved to `scripts/lib/` (outside `src/`, so outside the layer rule); the other maintainer modules
are excluded from `files` where they sit. `yaml` is a devDependency, production stays at 41
packages, and the packed list went 278 → 262. §3.1 has the correctness dividend, which was the part
nobody predicted. `semver` and `spdx-expression-parse` are re-arguable on these terms now, and §3.3
and §3.4 still decline them on merit.

**Q2 — Is the full-screen TUI worth 36 of 40 production packages?** (§4). `--plain` already ships
and is already the non-TTY default. Three positions in §4.3; we recommend none of them. "Smallest
useful set" needs the operator to say where *useful* sits.

**Q3 — `tmct_search`'s `name`: literal or regex? Answered: regex, bounded. Landed** (§3.9). Ordinary
filters keep their semantics; a pathological pattern is refused with a message naming what to write
instead.

**Q4 — Has Renovate ever run?** (§5.3). No Renovate-authored commit exists, and the production deps
still carry `^` ranges against `rangeStrategy: "pin"`. The job needs a pipeline schedule and
`RENOVATE_TOKEN`, both created by hand in the GitLab UI. A one-minute check that decides whether
goal 3 is solved or merely specified.

---

## 8. Order of work

Sequenced by risk, cheapest and safest first. `npm test` green at every commit; one category per
commit, per PLAN_PURGE Rule 7.

| # | batch | goal | risk | note |
|---|---|---|---|---|
| 1 | `fuzzyCascadeWord` → `fuzzyMatchInSet` (§6.3) | 4 | **none** | 10 lines out, one delegation, both `domain/`, import already present. |
| 2 | `escapeHtml` via `.toString()` (§6.6e); `parseJsonl` ×3 (§6.6j); `sleep` (§6.6o) | 4 | **none** | Mechanical, single-file, existing precedent in each file. |
| 3 | Bump `osv-scanner` v2.0.2 → v2.4.0, plus a Renovate `customManagers` rule (§5.2) | 3 | **low** | The only real upgrade item. The regex manager is what stops it recurring. |
| 4 | **`prose-tokens.mjs` → re-export `domain/prose.mjs`** (§6.1) | 4 | **low** | The parity suite proves equivalence before you start, then goes. Delete the false header claim, don't repair it. Biggest single win. |
| 5 | `isContentToken` ×3 (§6.6a); `isTestPath`/`isTestLabel` (§6.6c); `memberRow` ×3 (§6.6d) | 4 | **low** | All downward imports. 6.6c is already drifted, so pick the correct one deliberately. |
| 6 | Rename `rank.mjs`'s `splitSentences` (§6.2) | 4 | **low** | Two callers. Finishes what PLAN_PURGE started. |
| 7 | `agentbench/driver-resolver.mjs` → shim (§6.4) | 4 | **low** | Bench-only. `agentbench/results.mjs` is the template. |
| 8 | Shared bench module: `pool`, `mulberry32`/`seededShuffle`, `parseJsonlRows`, `parseFlags`, `ladderGate`/`rollup` (§6.6h/i/k/l/m) | 4 | **medium** | Bench-only, no product path. Do the pure primitives first. Leave `renderRollup`. |
| 9 | `idfOver` → `domain/text-stats.mjs` (§6.6b) | 4 | **medium** | Collapse `codegraph.mjs:762`/`:805` first — that one is same-file. Touches ranking; pin outputs before and after. |
| 10 | `bfsLevels` → `domain/planning.mjs` (§6.5) | 4 | **medium** | Four callers with different payloads. The riskiest of the internal-library batches. |
| 11 | `trackedFiles` (§6.6f); `corpusLanes` (§6.6g); `relativeSpecifiers`/`importClosure` (§6.6n) | 4 | **medium** | Adapters-layer. §1.3 applies to `trackedFiles` — builtin-only. |
| 12 | `isMain` guard: fix the 5 wrong spellings (§6.6p) | 4 | **low** | A correctness fix wearing a duplication costume. |
| 13 | ~~**`tmct_search` ReDoS**~~ (§3.9) | — | **done** | A defect, not dependency work. Folded in, not passed over. |
| 14 | ~~**Maintainer tier + `yaml`**~~ (§3.1) | 1 | **done** | The one library this plan adopts. It fixed silent data loss the subset reader was causing. |
| 15 | **TUI decision** (§4) | 2 | **gated on Q2** | Do nothing until answered. |

Batches 1-2 and 4-7 are the plan's core: they need no decision, carry little risk, and deliver goal
4 outright.

---

## 9. What this plan does not claim

Per PLAN_PURGE Rule 8, the negatives are results.

- **No dependency is unmaintained, unsupported, or wrongly versioned.** All nine sit at latest bar
  `ink`, held one patch back by the 14-day cooldown. There is no upgrade emergency and none of goal
  3's premise ("well within vendor support") is currently violated.
- **No library subsumes another's job.** The five runtime deps do five different things.
- **No dependency is unused.** PLAN_PURGE §2 established this and it still holds; the wink pair
  loads through `createRequire` and looks unused to a static scanner.
- **There is no regex JS parser to fix** (§3.10). The import extractor is external.
- **`ink`'s 36 packages are not waste.** They are the price of a feature that works. Whether the
  feature is worth it is Q2.
- **No ACE library exists yet** (§3.12), so `grammar/ace.mjs` stays hand-rolled until one does. The
  candidate literatures are Attempto and the wider CNL community.
- **`terminal-kit`'s transitive tree is unmeasured.** It needs an install to price, and we did not
  do one. If Q2 goes to option 3, price it before committing.
