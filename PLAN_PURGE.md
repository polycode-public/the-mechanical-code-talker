# PLAN_PURGE.md — promote the load-bearing code, delete the dead weight

**Status (2026-07-17): EXECUTED, through 2.3.1.** The audit below is kept for its findings and
its rules, which is what a later reader wants from it. What it got wrong is corrected in place
and labelled, because the errors are the more useful half — every one came from reading the tree
statically and writing it down as fact, which is what Rule 1 exists to stop.

Shipped: the pre-2.0.3 benchmarks archived and the 20 dangling refs that move left behind
repaired; `embedRank` and `guardrail.mjs` deleted; `coverage-compare.mjs` and
`generate-answer-variants.mjs` deleted; 54 dead exports narrowed; 6 duplicate tests dropped and
13 renamed; every CI check given an npm hook; and the load-bearing logic promoted out of
`scripts/` into `src/domain` with the tests it never had — markdown-links, version-stamp,
publish-gate, inflect, licences, corpus-matrix, and the 1,510-LOC persona/WordNet cluster.

Three bugs fell out of the promotions, all live, none of them the point of the exercise: the
`#pkg-version` regex existed three times and had diverged, so the writer could stamp a value the
deploy check rejects; the publish gate compared versions by string equality, so a version *behind*
the registry went to `npm publish` and failed there; and `codegraph.mjs` told users to run a
command that has never existed.

The prose corpus is now external and frozen in `corpus/prose/` (§4.5). It used to be every
root-level `*.md`, so editing any doc drifted a shipped artifact — and the guard for that skips
wherever the WordNet clone is absent, so CI never saw it. Consequence to know: Wikipedia's
share-alike is viral, so `corpus/generated/ace-surface-variants.jsonl` is CC-BY-SA-4.0 now.

---

## 1. The policy

Operator's words, and the rule this whole plan serves:

> Promote our load-bearing code from scripty places — the pipelines, the `./scripts` directory,
> an HTML page — and make them first-class citizens in `./src` and `./bin`, with unit and/or
> integration tests, a hook in `package.json`, a mention in `README.md` and `--help`. If we have
> something in `./scripts` it is using the `package.json` surface to delegate (running the script
> commands) and doing things more expressive in native shell — git commands, `npm run` invocations,
> `npx` and exported bins the same, pipes, and things needing a browser jump out.

### 1.1 The test we apply to each file

Ask what the file *is*, not where it sits:

- **Load-bearing logic** — parsing, comparison, generation, validation rules, data transformation.
  Anything you could write a unit test for without touching the disk. This gets promoted.
- **Glue** — shelling out to `git`, `npm run`, `npx`, an exported bin; pipes; launching a browser;
  driving a build tool. This stays in `scripts/` and delegates through `package.json`.

Most files are both. The work is splitting them, not classifying them whole.

### 1.2 What "first-class citizen" means here

A promoted capability has all five. Fewer than five and the promotion isn't finished:

1. **A home in `src/`** under the right layer (§1.3).
2. **A unit or integration test** of the logic itself, not just a drift check that re-runs the
   script and compares a hash. A drift check proves the output is reproducible. It does not prove
   `pastOf("lie")` is `"lay"`.
3. **A `package.json` hook**, and CI calls the hook rather than the file path.
4. **A `README.md` mention.**
5. **A `--help` mention**, where it is a CLI verb.

### 1.3 Where promoted logic lands

The layering is enforced by a test, not merely documented. `test/estate/layer-map.mjs`:

```js
export const LAYER_RANK = { domain: 0, adapters: 1, tools: 2, services: 3, surfaces: 4 };
```

`test/estate/import-layers.test.mjs` enforces that imports point downward only, that nothing sits
loose directly under `src/`, and that **`domain/` imports nothing non-relative at all — not even
`node:fs`**. The one allowed exception lives in `test/estate/layer-allowlist.mjs` and that list
"can only ever shrink — never add a line."

| The logic | Home |
|---|---|
| Pure string/data rules, zero imports | `src/domain/<name>.mjs` |
| Needs `node:fs`, `node:child_process`, `fetch` | `src/adapters/<name>.mjs` |
| Answers one graph question | `src/tools/handlers/tmct-<name>.mjs` + an entry in `src/tools/definitions.mjs` |
| Orchestrates adapters+domain for a CLI verb | `src/services/<name>.mjs` |

**Most of what we promote is maintainer and estate tooling, not graph questions.** It lands in
`domain/` and `adapters/`, called from a thin `scripts/` caller. It does **not** become a `tmct_*`
tool. `src/tools/` is for the tool surface, where `definitions.mjs` is the only place a tool's name,
schema, purpose or example is written down.

### 1.4 Adding a `--help` entry costs four edits

`bin/tmct.mjs:31` holds `HELP` as one hand-maintained ~110-line template literal. It is not
generated, unlike the README tool section. Adding a verb means: (1) a `Usage:` block in `HELP`, two
columns at cols 2 and 32; (2) the verb added to the error string at `bin/tmct.mjs:1338`, which
restates the verb list a second time; (3) an `if (mode === ...)` arm; (4) keeping the import lazy,
because `bin/tmct.mjs:254` notes imports are lazy so `tmct --help` and chat startup never pay for
tool imports. `e2e/cli-help.test.mjs` covers the output.

**We will generate the verb list rather than maintain it twice.** Two hand-maintained copies of the
same list is the defect that this plan exists to remove.

### 1.5 The CI constraint, and why it does not block us

`pii:lint`, `links:check` and `smoke:post-deploy` run in CI **without `npm ci`**. They must not
reach `node_modules`.

We computed the dependency closure of every `src/` module. **21 of 122 pull `node_modules`; the
other 101 are node-builtin-only.** Crucially, **all 49 modules in `src/domain/` are clean, and the
layer test is what keeps them clean** — domain cannot import a bare specifier while that test
stands.

So the constraint and the policy agree: the three dependency-free scripts split on exactly the
`domain`/`adapters` line the layer checker already enforces. `scripts/generate-tool-docs.mjs`
already proves the pattern — it imports `src/tools/definitions.mjs` and stays dependency-free
today.

**The rule to hold: those three may reach `src/domain/` and node-builtin-only `src/adapters/`, and
must never reach `src/services/*` (all but 6 pull `smol-toml`), `src/adapters/toml-config.mjs`, or
anything wink-adjacent.**

---

## 2. Four things you asked for that aren't there

Recorded so nobody re-runs this analysis.

**There are no bash scripts to convert.** `find . -name '*.sh'` returns nothing repo-wide. All 22
files in `scripts/` are already `.mjs`. The bash-to-JS track has no subject. The one candidate in
spirit is in CI, and §5.3 covers it.

**There are no unused dependencies.** All five runtime deps and all four dev deps are used. The
wink pair loads lazily through `createRequire` in `src/adapters/wink-model.mjs`, so a naive static
scan reports them unused. They are not. Do not let a future tool "fix" this.

**There are no stale worktrees.** `git worktree list` shows only the main checkout and
`git worktree prune -n` finds nothing.

**There is no logic in an HTML page.** `public/index.html` has one importmap and one
`<script type="module" src="./demo-ui.mjs">`. Zero inline logic. `ledger.html` and `plan.html` are
generated and gitignored. That branch of the policy has no offender.

**And: `package.json` has no broken entries.** Every `scripts` target resolves, as do `files`,
`exports`, `main` and `bin`. Its problem is missing coverage, not rot (§5).

---

## 3. The deletion rules

**Rule 1 — Reachability is proven, not grepped.** Trace the import graph from every entry point:
`bin/`, the `exports` map, the bench harnesses, `scripts/`, `test/`, `e2e/`, `demo/`, `public/`. A
grep for the filename is not evidence. Before deleting, check four invisible-caller classes:
dynamic `import()`, string-literal build entries, `createRequire`, and dynamic path templates. This
audit produced false "dead" verdicts on all four: `memory-ask-browser-entry.mjs` is a string
literal in `build-ask-bundle.mjs:167`; `prose-nlp.mjs` is alive through four dynamic imports in
`chat.mjs`; `test/corpus/predicates-templates.mjs` loads as `predicates-${family}.mjs`. **The first
dead-export list this audit produced had at least 7 false positives from exactly this.** Use the
§6.3 list, which accounts for dynamic imports.

**Rule 2 — "No caller" and "no value" are different findings.** Prove the first, argue the second
separately. Reachability opens the question; it does not answer it.

**Rule 3 — Delete a duplicate test only when it cannot fail alone.** If B fails in any scenario
where A passes, B stays, however similar. Identical Jaccard is not the test:
`syllogise.test.mjs:143` and `:148` score 1.0 and both stay, because `:148` reverses the argument
order to prove symmetry.

**Rule 4 — A comment citing a deleted doc gets deleted, not repaired.** You cannot fix a citation
to something that no longer exists, and repointing it at a surviving doc invents a claim the author
didn't make. Keep the sentence if it states a non-obvious *why* in its own words; drop the pointer.

**Rule 5 — Measurement logs are data; syntheses rot.** `BENCHMARK_*.md`, `playtests/` and
`archive/` record what a shipped version did on a day. Old data is not stale data. A doc asserting
present-tense capability makes a claim about *now* and goes wrong by itself. That is why
`CAPABILITIES_1.7.3.md` is in scope. Archiving a measurement log is about tidiness, not staleness
(§9.1).

**Rule 6 — Deleting an `export` and deleting a symbol are different sizes.** Dropping an `export`
keyword from a symbol used inside its own module is mechanical. Removing the symbol is a behaviour
change. The five `exports`-map modules are exempt: no internal importer is normal for public API.

**Rule 7 — One category per commit, `npm test` green at each.** When a deletion breaks a test, that
is the finding, not an obstacle. Stop and report.

**Rule 8 — Write down what you kept.** A file examined and kept is a result. §2 exists for this.

**Rule 9 — Local machine state is not the repo's problem.** Propose, never delete unasked. The
exception is something that *regenerates* wrong (§10).

**Rule 10 — A promotion is not a rewrite.** Move the function, keep its behaviour, add the test
that pins what it already does. If the test finds a bug, that is a separate commit with its own
message. Do not fix and move in one step; nobody can review that diff.

---

## 4. The 22 scripts

Verdicts: **PROMOTE 14 · KEEP-AS-GLUE 6 · DECIDE 2.**

Against the five-point checklist in §1.2, the directory scores: a `package.json` hook 3/22, a
README mention 2/22, a `--help` mention **0/22**, a real unit test of its logic 4/22.

### 4.1 `scripts/` has become an unversioned shared library

This is the strongest single argument for the policy. Scripts import scripts:

```
lib/wordnet-synonyms.mjs       → extract-persona-sources.mjs {loadSynsets, loadEntriesFor}
build-persona-tiers.mjs        → extract-persona-sources.mjs {parseYaml}
build-persona-examples.mjs     → extract-persona-sources.mjs {parseYaml, candidateFor}
build-persona-examples.mjs     → build-persona-tiers.mjs {BLOCKLIST_RE, WORD_DENYLIST, defOf}
generate-template-variants.mjs → template-coverage.mjs {classify}
generate-answer-variants.mjs   → lib/wordnet-synonyms.mjs
```

`scripts/lib/` is the policy violation in miniature: a private library directory inside the scripty
place. `extract-persona-sources.mjs` is imported by three other scripts and contains a **120-LOC
hand-rolled YAML parser with a documented bug history and no tests.** That single file is the
highest-value promotion here.

### 4.2 Group A — estate checks: split is obvious, tests already exist

| Script | LOC | Promote to `src/` | Stays in the script |
|---|---|---|---|
| `pii-lint.mjs` ⚠️ | 121 | `scanText`, `CHECKS`, `looksBinary` → `src/domain/pii-rules.mjs`; `scanRepo` → `src/adapters/pii-scan.mjs` | ~15 lines print+exit |
| `check-links.mjs` ⚠️ | 67 | `relativeTargets` + the link regexes → `src/domain/markdown-links.mjs`; `brokenLinks` → adapter | print+exit |
| `check-pack-manifest.mjs` | 60 | `packedPaths`, `comparePackManifest` → `src/domain/pack-manifest.mjs` | stdin read, diff print |
| `generate-tool-docs.mjs` | 144 | `renderToolDocs`, `spliceToolDocs`, `argsOf` → `src/tools/readme-docs.mjs` | ~12 lines read/write README |

⚠️ = runs in CI without `npm ci`. All four already export their logic and have tests
(`test/estate/{pii,links,pack,tool-docs}.test.mjs`). `check-pack-manifest.mjs` is nearest to done,
and it is already the policy's ideal shape: **the `npm pack --dry-run --json |` pipe lives in
`.gitlab-ci.yml:116`, not in the script.** That is exactly "pipes jump out".

### 4.3 Group B — real logic, no tests at all

| Script | LOC | The logic that deserves a test |
|---|---|---|
| `generate-real-word-collisions.mjs` | 122 | `doublesFinalConsonant`, `pluralOf`, `pastOf`, `gerundOf`, `inflectionsOf` (:48-78) → `src/domain/inflect.mjs`. Pure English morphology. `("run"→"running")`, `("lie"→"lying")`, `("carry"→"carried")`. |
| `check-licences.mjs` | 95 | `isAllowed` (:53-64) — an **SPDX expression evaluator**: `OR` needs one part, `AND` needs all, nested/`WITH` fails closed. Real edge cases, zero tests. → `src/domain/licences.mjs` |
| `coverage-compare.mjs` | 100 | `parseLcov`, `ranges` (`"12-18, 24, 30-31"`) → `src/domain/lcov.mjs` — **but see §4.7, this one is dead** |
| `corpus-matrix.mjs` | 90 | `countByGroup`, `thinGroups`, `groupsWithNoNegative`, `renderMatrix` → `src/domain/corpus-matrix.mjs` |

`generate-real-word-collisions.mjs` has the densest untested rules in the directory. Its only guard
is `test/estate/generated-artifacts.test.mjs:69`, which re-runs it and sha-compares. **That tests
reproducibility, not `pastOf("lie")`.** It also runs entirely at module top level with no exports,
so importing it writes the JSON as a side effect.

### 4.4 Group C — build and deploy: mostly glue, with pockets

| Script | Verdict | Note |
|---|---|---|
| `build-demo-site.mjs` | PROMOTE the pockets | `engineImportClosure` (:46-62) is a module-graph walker that duplicates `import-layers.test.mjs`'s `importSpecifiers`/`walkModules`. Extract `relativeSpecifiers` → domain, `importClosure` → adapter, and have the layer test reuse it. |
| `build-ask-bundle.mjs` | KEEP-AS-GLUE | esbuild is a build tool; the stubs are data, not logic. Well covered already. |
| `build-demo-graph.mjs` | KEEP-AS-GLUE | **The reference example of a post-policy script.** 33 LOC: read, call `ingestSchemaDocs` from `src/tools/schema-docs.mjs`, write. Its logic was already promoted. |
| `build-demo-memory.mjs` | KEEP-AS-GLUE | Correctly shaped: exports `main`, has an `isMain` guard, delegates all logic to `src/`. |
| `post-deploy-smoke.mjs` ⚠️ | KEEP-AS-GLUE + one promote | The poll loop is network work through and through. Pull `parseVersionStamp` out — see below. |

**A real bug the promotion fixes.** The `#pkg-version` regex exists **three times and has already
diverged**: `post-deploy-smoke.mjs:44` uses `(\d+\.\d+\.\d+)`, `build-demo-site.mjs:69` uses
`([^<]*)`, `test/estate/page-version-stamp.test.mjs:18` uses `([^<\s]*)`. One writes the stamp, one
reads it back, one verifies it, and they disagree about what a version looks like. We will extract
`parseVersionStamp(html)` and `stampVersion(html, version)` into `src/domain/version-stamp.mjs` and
have all three call it.

`build-demo-site.mjs` shells `execFileSync(process.execPath, [bin/tmct.mjs, ...])` rather than
`npm run`. The policy prefers delegating through `package.json`, but its header argues for the
binary spawn deliberately — it "shows the artefact they get rather than one built a private way".
**We will honour that call and leave it.**

### 4.5 Group D — the persona/WordNet cluster: 1,510 LOC, 43% of `scripts/`, almost no tests

The biggest logic mass in the repo outside `src/`, documented as "maintainer-only, never run by
`npm test`".

**`extract-persona-sources.mjs` (441 LOC)** — contains `parseYaml` (:47-167), a 120-LOC YAML-subset
parser whose own comments document two hard-won fixes (quoted scalars containing `": "`, multi-word
keys). Pure string→object. Zero tests. Three other scripts import from it. Also
`parseSchemaClasses` (:325-338), a Turtle-subset reader, pure, zero tests. → `src/domain/wordnet/yaml.mjs`,
`src/domain/schemaorg/turtle.mjs`, `src/adapters/wordnet-source.mjs`.

**`build-persona-tiers.mjs` (465 LOC, largest)** — ~10 pure curation rules: `senseRank`,
`collectCandidates`, `looksLikeCommonTerm`, `nextHop`, `meronymFact`, `rankCandidates`,
`makeAncestorRootCheck`, plus `BLOCKLIST_RE`/`WORD_DENYLIST`/`STOP_SET`. `rankCandidates` is
documented as deterministic ("same inputs → same output, no `Math.random`") — **a determinism claim
with no test asserting it.** The `WORD_DENYLIST` comment records a real bug found only by running
the full suite: `"male"` added as a noun silently broke every filter-rule test. That is a unit test
waiting to be written. `stripDenylisted` is a closure inside `main()`, so it cannot be tested even
in principle.

**`build-persona-examples.mjs` (353 LOC)** — a third hand-rolled parser: `splitRecords`,
`extractArray`, `extractText`, `isSimpleSentence`. **All four are already exported specifically for
testability, and then never tested.** That is the clearest signal in the directory that this
promotion was intended and stalled. `isRealSentence` is duplicated verbatim from
`extract-persona-sources.mjs:364`.

**`apply-persona-tiers.mjs` (149 LOC) — the riskiest file here.** It is the only script that
mutates `src/` and a corpus generator, it does so by fragile string-anchor splicing
(`generateSrc.indexOf("\n};\n\nconst conceptUri = ")` at :126), it has **no `isMain` guard** (bare
`await main()` at :149, unlike every sibling), and it has no test. So importing this file rewrites
two committed source files. Its `IRREGULAR_PLURALS` is also a **second pluralization authority**
alongside `generate-real-word-collisions.mjs`'s `pluralOf()`.

**`scripts/lib/wordnet-synonyms.mjs` (72 LOC)** — exists only because `extract-persona-sources.mjs`'s
loaders aren't in `src/`. Once they are, it mostly evaporates.

**`scripts/lib/text-corpus.mjs` (80 LOC)** — `stripFencedCode`, `stripMarkdownNoise`,
`splitSentences`, all pure. ⚠️ **Name collision: it exports `splitSentences` and so does
`src/services/sentences.mjs`, with different semantics** (regex/markdown vs wink-nlp). Promoting
naively puts two `splitSentences` in the tree. Rename to `splitProseSentences` first.

**The skip-hole.** `test/estate/generated-artifacts.test.mjs` is the only guard over
`generate-template-variants.mjs` and `scripts/lib/wordnet-synonyms.mjs`, and it is
`{ skip: missingWordnet }` — skipped on any machine without the WordNet clone at
`~/projects/globalwordnet/english-wordnet`. The pure parts (`substituteWord`, `generateAltPhrasings`,
`splitSentences`, `classify`) need none of that clone and become **unconditionally testable** once
they sit in `src/domain/`. That is the whole argument for the policy in one example.

### 4.6 Group E — audit harnesses

**`template-coverage.mjs` (107 LOC)** — PROMOTE. `classify` (:40-44) is pure and already exported,
but exported **solely so `generate-template-variants.mjs:49` can import it**, not for a test. Plus
`coverageReport` and `applyRescues`. → `src/domain/grammar/coverage.mjs`, beside `ace.mjs` and
`lexicon.mjs`, which it already imports.

**`generate-template-variants.mjs` (275 LOC)** — PROMOTE. `substituteWord` (:64-73) is a
case-preserving whole-word replace with real edge cases (sentence-initial capitalisation, regex
escaping). `generateAltPhrasings` (:190-221) is already fully pure and synchronous. All five
functions are exported for testability with no test written.

### 4.7 Group F — the two decisions and the one deletion

**`extract-facts-from-text.mjs` (169 LOC) — PROMOTE to a CLI verb.** It is the only script with a
hook, a README mention *and* a test, so by the checklist it is 90% there. The remaining gap is what
it *is*: a CLI verb living in `scripts/`. It has `--repo`/`--out` flags, argv parsing, a usage
string, and it mutates real user memory. **We will make it `tmct extract --file <x>`**: extract
`touchedFactRows` to `src/domain/memory/`, move `main` to `src/services/extract-facts.mjs`, add the
`bin/tmct.mjs` arm and `HELP` block. That also gives the directory its first `--help` mention.

**`generate-answer-variants.mjs` (69 LOC) — DECIDE.** A print-only audit with no assertions, no
hook, no mention, no test, depending on an external clone most machines lack. Its own header says
`answer-variants.json` is hand-curated and is not mechanically reproduced today, **so a drift guard
has nothing to compare its output against.** If it stays it is a maintainer REPL, and the right home
is a `docs/` note or a skipped test. Recommendation: delete.

**`corpus-matrix.mjs` (90 LOC) — DECIDE.** No hook, no test, no code reference; cited only by
`SKILL_CAPABILITIES_AUDIT.md` (:93-94, :262, :297, :343) as a documented workflow step, and by
`PLAN_NLU_BENCHMARKS.md`. That is a real caller, just a human one. Recommendation: promote and give
it `corpus:matrix` + `corpus:matrix:gaps` hooks.

**`coverage-compare.mjs` (100 LOC) — DELETE.** Zero references repo-wide: not in `package.json`,
not in CI, not in any doc, not imported, no test. It gated a one-off migration that is finished, and
no coverage step exists in CI to feed it. Re-verified dead at `HEAD 7858087`. Ironically it has one
of the best logic-to-glue ratios in the directory (~90% pure), which is a good reminder that
promote-ability and worth are different questions (Rule 2).

---

## 5. `package.json` and CI

### 5.1 The rule

Every CI-invoked script gets a hook, and **CI calls the hook, not the path.** Group by prefix
(`check:*`, `build:*`, `gen:*`, `corpus:*`). A canned combination earns an entry when it is long or
easy to get wrong. A one-word alias for a one-word command does not. Keep the existing `init:*`
ladder — it is exactly the long-and-tricky case this rule is for.

### 5.2 The five hardcoded paths in CI

`.gitlab-ci.yml` invokes these by path today, so a rename breaks CI silently:
`pii-lint.mjs:45`, `check-links.mjs:53`, `check-pack-manifest.mjs:116` (behind the pipe),
`check-licences.mjs:125`, `post-deploy-smoke.mjs:250`.

We will add:

```
"check:links":    "node scripts/check-links.mjs",
"check:pii":      "node scripts/pii-lint.mjs",
"check:pack":     "node scripts/check-pack-manifest.mjs",
"check:licences": "node scripts/check-licences.mjs",
"check:publint":  "npx --no-install publint",
"check:all":      "npm run check:links && npm run check:pii && npm run check:licences && npm run check:publint",
"smoke:deploy":   "node scripts/post-deploy-smoke.mjs",
"build:demo-graph":  "node scripts/build-demo-graph.mjs",
"build:demo-memory": "node scripts/build-demo-memory.mjs",
"gen:tool-docs":     "node scripts/generate-tool-docs.mjs",
"gen:tool-docs:check": "node scripts/generate-tool-docs.mjs --check",
"gen:collisions":    "node scripts/generate-real-word-collisions.mjs",
"gen:variants":      "node scripts/generate-template-variants.mjs",
"corpus:matrix":      "node scripts/corpus-matrix.mjs",
"corpus:matrix:gaps": "node scripts/corpus-matrix.mjs --gaps",
"template:coverage":  "node scripts/template-coverage.mjs",
```

**`check:pack` keeps its pipe in CI.** `npm pack --dry-run --json | npm run check:pack` — the pipe
is the expressive shell bit and stays in YAML, per the policy.

**`check:publint` uses `npx`,** which is the policy's "npx and exported bins the same" case.

### 5.3 The CLI surface

The CLI has 12 verbs; `package.json` exposes 6. Missing: `plan`, `cli`, `extend`, `import`.

```
"plan":         "node bin/tmct.mjs plan",
"plan:json":    "node bin/tmct.mjs plan --json",
"cli":          "node bin/tmct.mjs cli",
"cli:digest":   "node bin/tmct.mjs cli digest",
"import":       "node bin/tmct.mjs import",
"extend":       "node bin/tmct.mjs extend --validate",
"extract":      "node bin/tmct.mjs extract",
"viz:term":     "node bin/tmct.mjs viz --term",
"serve:public": "node bin/tmct.mjs serve --host 0.0.0.0 --port 8787",
"chat:plain":   "node bin/tmct.mjs chat --plain",
"chat:narrate": "node bin/tmct.mjs chat --narrate",
```

### 5.4 The one thing in CI worth promoting

`.gitlab-ci.yml`'s `publish:npm` job decides whether to publish with an inline shell block:

```sh
if [ "$PUBLISHED_VERSION" = "$LOCAL_VERSION" ]; then ... else npm publish ...; fi
```

**This is string equality, not a semver comparison, and that is a latent bug.** It only catches
"same version". A local version *lower* than published — a bad merge, a revert — reads as
"different" and goes straight to `npm publish`, which then fails at the registry with a confusing
error. We will extract `shouldPublish(local, published) -> {publish, reason}` into
`src/domain/publish-gate.mjs` (pure, zero imports, domain-legal), unit test the three cases (same,
higher, lower), and have CI call `npm run check:publish`. The `npm view` call and the `npm publish`
itself stay in YAML — those are the expressive shell parts.

`dep:audit`'s osv-scanner curl with a v2/v1 fallback is three lines and stays in YAML.

### 5.5 Metadata

`keywords` omits the shipped `serve`, `plan`, `viz` and `syllogise` surfaces. Add `agent`, `mcp`,
`planner`, `strips`, `tui`. Low value; do it in passing.

---

## 6. Dead code in `src/`

**No file under `src/` is unreachable.** All 121 `.mjs` files are live. That negative is the main
result: there is no pile of dead modules. There are two decisions and a tail of over-wide exports.

### 6.1 `guardrail.mjs` — RECOMMENDATION: delete

**I had this wrong in the first draft and the correction matters.** I called it a bypassed safety
gate. It is not. It is *duplicated* logic, and **no safety check is being skipped today.**

`guard()` (`src/domain/router/guardrail.mjs:41`) is a strict superset of `hallucinationsIn`: it adds
a default-deny on unregistered tools (already duplicated in `call-validator.mjs:21`) and a
`PRECOND.resolves` binding-oracle check (:70-102) that `hallucinationsIn` has no equivalent for.
But both live callers already do that resolve themselves: `resolver.mjs:269-282` binds via
`ctx.resolve(term)` and refuses on ambiguity at :271-274 before calling `hallucinationsIn` at :282;
`goal-reasoner.mjs:114-118` does the same and refuses at :173-176. Resolver's own `PRECOND.resolves`
step at :207 is a **stub hardcoding `ok: true`**, because the real binding already happened.

`guard()`'s purpose per its own header (:1-8) is validating an **externally-proposed** `tool_use` —
a surface the product does not have. Both callers *produce* calls; they don't receive them.
Re-wiring would mean inventing a caller and re-running a resolve that already happened, doubling
oracle calls for zero new denials.

**Delete.** Cost: remove `guardrail.mjs`; drop 2 test imports and 7 tests
(`router-resolver.test.mjs:263-320`, `registry-register.test.mjs:64,69`); remove it from
`test/estate/pack-manifest.json:120` (it currently ships in the npm package); fix 6 stale comments
in `registry.mjs` (:5, :28, :200, :263, :269), `taught.mjs:6`, `call-validator.mjs:2`, `drive.mjs:3`.

**Check first, and treat this as blocking:** the only thing lost is `dispatchEachCandidate`'s
`readOnly !== true` check (:25). Verify `resolver.mjs:271-274`'s enrichment carries the same guard.
If it does not, that is a real latent gap and we port it over before deleting.

*If you want to keep it*, the coherent framing is "public API for a future external-proposal
surface" — in which case add it to the `exports` map and say so in the header. Unexported and
uncalled is what produced this finding.

**Delivered, and the blocking check found a live hole, not a latent one.** This plan said nothing
registers `readOnly: false` today. Wrong: `taught.mjs:38` does, so `resolver.mjs`'s comment claiming
"every registered capability is read-only" was already false. Nothing reaches those records through
`resolveOne` — backward-chaining only matches `knows` topics and builtins win the topic table — so
no dispatch was actually unguarded, but the invariant the code rested on was not true. The gate went
into one helper covering **both** of `resolveOne`'s dispatch sites: the per-candidate loop and the
single grounded call at `:286`, which had the same hole and no guardrail equivalent.

**And `dispatchable` gates nothing.** `registry.mjs:221` computes it; the only readers are a test
assertion and prose. It is derived data that no code branches on, which is why `guardrail.mjs:25`
was the sole runtime `readOnly` check. The field stayed and its docstring stopped overclaiming.

### 6.2 `embed.mjs` — delete, and `vector.mjs` goes with it

**Decided: delete.** `PLAN_EMBEDDINGS.md` records the research and the way back.
`src/domain/vector.mjs` goes too — `cosine()`'s only caller is the `embedRank` branch
(`codegraph.mjs:994`).

The `embedRank` feature is wired end to end except one link: `toml-config.mjs:142` maps `embed_rank`
→ `tune.embedRank`, `codegraph.mjs:973` reads `opts.embedder`, but nothing calls `loadEmbedder()`
(`embed.mjs:134`) or sets `opts.embedder` outside tests. It is a no-op that prints, at
`codegraph.mjs:976`:

> `embedRank requested but no embedder available (weights not fetched?)`

**It is worse than a loose wire. It advertises two things that were never built:**
`scripts/fetch-embeddings.mjs`, cited at `embed.mjs:10` and `:23`, **does not exist**.
`npm run refs:embeddings`, cited at `embed.mjs:132` and in that user-facing message, **does not
exist**. `vendor/` does not exist. `tune.embedRank` is inert on top of the dead flag — nothing
threads `tune` into `searchModulesRanked`'s opts.

The code itself is good: a hand-rolled safetensors reader, a WordPiece tokenizer, mean-pool +
L2-normalise, all dependency-free, all tested via `embed.test.mjs` and `codegraph.test.mjs:1129-1170`.
Wiring it would take roughly a 40-line fetch script plus a 3-line injection.

**Delete anyway.** The reasoning:

1. **It was never finished, rather than having broken.** The fetcher was never written. This isn't
   a wire that came loose; it's a feature abandoned mid-build.
2. **No demand.** It has been dead long enough that nobody noticed the message lies.
3. **It is a new dependency class.** A ~30MB weights download sits against a product whose pitch is
   `$0`, offline, deterministic, "no model calls". A local static embedding model is not an LLM and
   arguably clears the constitution, but that question deserves to be *asked and answered*, not
   settled by leaving dead code in the tree.
4. **Deletion is reversible.** Git history keeps the safetensors reader and tokenizer if demand
   appears.

**Reverse this if** you want embedding re-rank as a feature. Then it's a 40-line job, the hard part
is done, and it belongs in its own plan — not in a purge.

**Either way, `codegraph.mjs:976` ships now.** A user-facing message pointing at a command that
does not exist is the one outcome nobody should choose.

### 6.3 Dead exports — 58 across 25 files

Exported but never imported by name anywhere outside their own file, accounting for static imports,
dynamic imports and re-exports. Rule 6: drop the keyword, keep the symbol.

Biggest first: `grammar/ace.mjs` **10 of 13** (the 9 `PATTERN_*` constants plus `PATTERNS`; note
`ace.mjs:11` documents these as "also exported individually", so the export was
intentional-but-unused). `memory/core.mjs` 5, `domain/ask.mjs` 5, `syllogise.mjs` 5,
`router/results.mjs` 4, `codegraph.mjs` 3, `grammar/lexicon.mjs` 3, `memory/blocks.mjs` 2,
`memory/trust.mjs` 2, `ask-vocab.mjs` 2, `router/resolver.mjs` 2, `wink-model.mjs` 2, plus 13
modules with one each.

**Corrections against the first draft, which was a static-only scan:** `parseAceAmbiguous` is
**live** (dynamic import at `chat.mjs:10355`), as are `runTui`, `proseLemma`, `importDefinitionFile`,
`readMemoryAskBundle`, `buildContextBundle`, `degreeMetric`. So `ace.mjs` is 10/13, not 10/10.

**Delivered: 54 dropped, not 58. Four of this list were wrong, and the difference is the
lesson.** A static scan cannot see a dynamic import, and three of the four survivors prove it:

- **`degreeMetric` is LIVE** and nearly shipped as a break. `chat.mjs:616` takes it via
  `({ degreeMetric } = await import(...))` — a bare-assignment destructure the scan missed, and
  `chat.mjs:583` says "exported for exactly this". A test caught it. **Rule 1 is not paperwork.**
- **`registerWinkModel` is LIVE** — `public/tmct-browser.mjs:19` imports it. `loadWinkModel` beside
  it really was dead and went.
- **`uniqSort` is not a declaration** — `results.mjs:231` is a re-export, and `drive.mjs` imports
  three of its four names through that facade. Removing one member breaks it for nothing.
- **`gitToplevel`: this plan had it backwards.** `chat.mjs:66` is a re-export, not a definition, and
  `chat-session.mjs:12`'s comment describing it as one was **true**. There are not three
  implementations; there is a documented facade. Only the unused name left it, and `cli-args.mjs`
  now points at `chat-session.mjs`, where the function lives.

**`bootstrapGraph` / `FIXTURE_ENTITIES` dropped after all.** The `exports` map is closed at six
subpaths and `./providers/*` is not among them, so a third party importing them gets
`ERR_PACKAGE_PATH_NOT_EXPORTED`. They ship as readable reference *source*, not as importable API.
Not importable and not imported is dead. Adding `./providers/*` to `exports` would make them live
again — that is a product decision, not a purge one.

---

## 7. Tests: 7 deletions, 13 renames

149 test files and 1,601 cases in `test/`, 23 in `e2e/`. All 7 duplicates re-verified at the exact
stated lines at `HEAD 7858087`.

**Clean bills of health (Rule 8).** No dead test files: both globs were verified empirically against
Node's `globSync` rather than assumed, matching 149/149 and 23/23. Worth checking, because every
`e2e/` test sits at top level and the whole tier would silently never run if `**` required a
directory. No test imports a file or named export that doesn't exist. All 17 non-test helpers are
live. One skipped test, conditional and legitimate — plus the `missingWordnet` skip-hole in §4.5,
which is a coverage gap rather than a dead test.

### 7.1 Delete (6 confirmed + 1 to verify)

| File:line | Why |
|---|---|
| `test/tools/ask.test.mjs:176` | Body byte-identical to `:137`; both `resolveObject(graph,"logging")` → tier 3. |
| `test/tools/ask.test.mjs:555` | Byte-identical body to `:562`. |
| `test/tools/ask.test.mjs:562` | Same single assert as `:555`. Keep one. |
| `test/tools/ask.test.mjs:614` | `ask-dual-strategy.test.mjs:187` is a strict superset (same `deepEqual` plus an `ambiguousParse` assert). |
| `test/tools/ask.test.mjs:627` | `ask-dual-strategy.test.mjs:200` is a strict superset. |
| `test/adapters/ask-dual-strategy.test.mjs:193` | `ask.test.mjs:619` is a strict superset. Note the direction reverses here. |
| `test/adapters/chatbench-levers.test.mjs:51` | **Verify manually, don't bulk-delete.** Its fnAlpha half is a subset of `callgraph.test.mjs:26`, but the two use *different graphs* (raw `parseEntities` vs `ingestSchemaDocs` on top), and its importers half has no located superset. |

`ask.test.mjs:555` and `:562` are why Rule 3 is written as it is. Both assert
`parseQuery("what is the meaning of this codebase") === null`. Their names give **contradictory**
reasons: `:555` says a mandatory article stops it, `:562` says "meaning" isn't an `ENTITY_TO_TYPE`
term. Neither name is verified by anything — the assertion only ever sees `null`. Two tests, two
explanations, one fact, zero checks on either explanation.

**Mechanical note:** `chatbench-levers.test.mjs`'s `CLEAN_CALLS`/`CLEAN_IMPORTERS` consts sit at
`:48-49`, **outside** the test block at `:51-63`, and feed the L1 tests at `:68`, `:75`, `:86`.
Delete the `test(...)` block only. Deleting `:48-63` breaks three tests.

### 7.2 Rename (13)

Real behaviour under test, historical label bolted on. `corpus-conceptnet.test.mjs:77,104` (date +
a doc that's gone), `compare.test.mjs:45`, `chat.test.mjs:484,497,511` (cites `CHATBENCH_006`, which
does not exist), `telemetry.test.mjs:30`, `ask.test.mjs:91,365,614,681`, `memory-fold.test.mjs:85`,
`chatbench.test.mjs:140`, `bias-weighting.test.mjs:136` ("today's behaviour" rots),
`e2e/init.test.mjs:537`.

**Do not pattern-match this.** "operator" in `trust.test.mjs:121`, `provenance.test.mjs:177` and
`router-taught-plan.test.mjs:73` is the domain term for a source type in the trust model.
`INTERFACE_VERSION 1.1.0` and `stamped resolver-0.8.0` are values under assertion. All five stay.

---

## 8. Comments citing deleted docs — 81 hits

Comment-prefixed lines only. An earlier count of 205 swept whole lines and caught test data and
fixture strings, which are not commentary. `Gap N` and `BUG N` are **zero** — already clean.

| Area | `PLAN_*.md` | `HANDOVER` | dates |
|---|---|---|---|
| `src/` | 7 | 0 | 1 |
| `bin/` | 3 | 0 | 1 |
| `scripts/` | 32 | 0 | 0 |
| `test/` | 11 | 3 | 18 |
| `e2e/` | 2 | 1 | 2 |
| **total** | **55** | **4** | **22** |

**12 of the 14 PLAN docs cited from code are missing from disk.** Only `PLAN_SYLLOGIST.md` and
`PLAN_GRAPH_SCAN.md` survive. The cited set and the on-disk set are nearly disjoint — 12 plans sit
in the repo and are never cited from code, while 12 cited plans don't exist.

Missing and cited: `PLAN_SEED.md` (bin ×2, 24 script cites, e2e ×2), `PLAN_VIZ_LEDGER.md`
(viz-theme.mjs:3, ledger-viz.mjs:3, bin:1124, build-ask-bundle.mjs:2), `PLAN_VIZ.md`
(sessions.mjs:114), `PLAN_PROSE_INDEX.md` (graph-build.mjs:355,:422), `PLAN_SEON_RDF.md`
(graph-build.mjs:364), `PLAN_TAUGHT_RELATIONS.md` (memory/core.mjs:75), `PLAN_BREADTH_FIRST_NLU.md`,
`PLAN_TEMPLATE_COVERAGE.md`, `PLAN_ADVANCED_GRAMMAR.md`, `PLAN_B016.md`, `PLAN_CYCLE_4.md`,
`PLAN_INFERENCE_TESTING.md`.

Apply Rule 4 per hit. Many carry a real *why* beside the citation and keep the sentence:
`graph-build.mjs:364`'s JSON-label-only design note is worth keeping, its `PLAN_SEON_RDF.md`
pointer is not.

Two non-`.mjs` cases of the same rot: `tmct.toml:28` cites `PLAN_SEED.md §6`;
`corpus/wordnet/generate.mjs:69` cites `scripts/wordnet.py`, which never existed.

**Also in scope:** `src/services/chat.mjs:8505` and `:8708` cite benchmark docs that §9.1 moves.

**Scale note.** `src/` + `bin/` is 16 hits and is one commit. `test/`'s 146 is a different size of
job, concentrated in `provenance.test.mjs` (20), `ask.test.mjs` (11), `sessions.test.mjs` (9),
`codegraph.test.mjs` (9), `syllogise.test.mjs` (8). We will do it in per-file commits, not one
sweep. See §12 Q1.

---

## 9. Docs

### 9.1 Archive every benchmark before 2.0.3 — **done, and half-done**

Commit `b7d833e` moved all 8 files but skipped the repoint step below, so it **created 20 dangling
references** and broke HANDOVER's three baseline citations. The move is done; the repair it needed
is §9.4's job.

All four axes have a 2.0.3 write-up, so the pre-2.0.3 set moved to `archive/`:

`BENCHMARK_AGENT_1.7.0.md`, `BENCHMARK_CEFR_ENGLISH_1.7.0.md`, `BENCHMARK_CEFR_ENGLISH_1.8.0.md`,
`BENCHMARK_CONVERSATION_1.7.0.md`, `BENCHMARK_CONVERSATION_1.8.14.md`, `BENCHMARK_INFERENCE_1.7.0.md`,
and `CAPABILITIES_1.7.3.md`.

This is tidiness, not staleness (Rule 5). These stay readable; they just stop competing with the
current set at root.

**The convention, from precedent.** `archive/PLAN_DEFEASIBLE_NEGATION.md` is the *exception*, not
the model — it has no banner. Three commits set the real pattern (`d18c1db` archiving
`TOO_HARD_AUDIT.md`, `8fec87c` archiving `PLAN_HANOI.md`, `983023b` archiving
`PLAN_LAYERS_AND_TEST_ESTATE.md`). Banner above the H1, blank line, original title:

```
**Archived, 2026-07-16** — <what shipped / why closed>. <what the doc is still good for>.
<any now-dangling refs called out as historical>.

# ORIGINAL_TITLE.md — …
```

`git mv` so the rename is preserved; repoint live pointers in the same commit; **versioned
`CAPABILITIES_*`/`BENCHMARK_*` reports and test comments keep the bare name** — they are historical
records. `d18c1db`'s message states that rule outright, so we are following precedent, not
inventing one.

**Live pointers to repoint:** `HANDOVER.md:104-107, 120-124, 126-129` (the 1.7.0/1.8.0 baseline
citations), `SKILL_CAPABILITIES_AUDIT.md:118-121`, `README.md:180`, `PLAN_CODE.md:20`,
`PLAN_SYLLOGIST.md:8`, `HANDOVER.md:106,122,127`.

**Better than repointing, for HANDOVER.** Its three baseline claims are already restated in the
2.0.3 write-ups (`BENCHMARK_AGENT_2.0.3.md:3,142`; `BENCHMARK_INFERENCE_2.0.3.md:3`;
`BENCHMARK_CEFR_ENGLISH_2.0.3.md:260`). So cite the 2.0.3 doc as the baseline-of-record and let it
carry the 1.7.0 comparison internally. One pointer, current, and it stops HANDOVER from ageing again
at 2.1.

**`CAPABILITIES_1.7.3.md` no longer needs a decision.** `CAPABILITIES_2.0.3.md` exists, so it is
superseded outright. It also overlays `CAPABILITIES_1.6.0.md`, which is gone, so ~120 of its rows
cite an unreadable source, and `SKILL_CAPABILITIES_AUDIT.md:12` says "Never copy its verdicts
forward." Archive it with the rest.

### 9.2 CI cannot catch any of this

`scripts/check-links.mjs` extracts only `[text](target)` inline links and `[ref]:` definitions.
**Every reference to all 7 archive-bound docs is a backtick code span**, so the checker sees
nothing and `test/estate/links.test.mjs` stays green with every reference dangling.

This is demonstrated, not theoretical: `PLAN_AGENTS.md`'s seven dead targets and the four
`docs/references/planning/` citations have been broken since `8cd3b36` (2026-07-10) and CI has been
green throughout.

**So the archive move needs a manual grep sweep in the same commit.** And we will close the gap:
add `codeSpanDocRefs(markdown) -> [{name, line}]` to `src/domain/markdown-links.mjs` (§4.2), check
that every backticked `*.md` name resolves to a real file, and wire it into `check:links`. That is
this plan's own policy applied to itself — the check is load-bearing logic, so it lands in
`src/domain/` with a unit test, and the script stays a thin caller.

Expect a large first run. Allowlist the historical records (`archive/`, versioned reports) rather
than repointing them, per the `d18c1db` rule.

### 9.3 No plan is mis-stamped

All 15 root `PLAN_*.md` files carry accurate self-declared status headers, verified against the
tree. Nothing claims delivery it didn't achieve, so **no plan is archive-ready.** Recorded per
Rule 8 so nobody re-litigates it.

### 9.4 Dangling references in live docs

**`PLAN_AGENTS.md` — the false claim goes first.** Lines 4-6 say it "supersedes
`PLAN_TMCT_ECOSYSTEM_INTEGRATION.md` and absorbs six sibling docs … now archived". `8cd3b36`
**deleted** all seven. None exist at root or in `archive/`. Dead targets and every line:
`PLAN_TMCT_ECOSYSTEM_INTEGRATION.md` (:4), `PLAN_AGI_ARCHITECTURE.md` (:5, :606),
`PLAN_CAPABILITY_ROUTER.md` (:5), `PLAN_TAUGHT_RELATIONS.md` (:5, :42, :91, :474, :610),
`PLAN_OSS_ACE_PARSER.md` (:6, :612), `PLAN_ontology-hierarchies.md` (:6, :375, :614),
`PLAN_ADVANCED_GRAMMAR.md` (:6, :617). §12 "Provenance" (:606-617) is a pointer table into files
that do not exist.

**`HANDOVER.md` — the entry-point doc sends every new session to three things that aren't there.**
`:4` cites a ROADMAP section "Current capability surface"; ROADMAP has six headings and that is not
one. `:198-199` cites `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`CONVERSATIONBENCH_*` artifacts —
no file carries any of those prefixes, the convention is `BENCHMARK_<AXIS>_<version>.md`, and three
of the four aren't a prefix-rename away. `:199` also cites ROADMAP's "Where we are now", which does
not exist and which ROADMAP:4-6 explicitly disclaims holding.

**`docs/references/planning/` — 4 files, all citing the deleted `PLAN_CAPABILITY_ROUTER.md`:**
`NONLIN.md:9`, `PARTIAL_ORDER_PLANNING.md:8`, `STEEL_AND_HO.md:10`, `STRIPS_PDDL.md:8`. Correct
target is `PLAN_AGENTS.md`, which absorbed the router doc; router status is at `PLAN_AGENTS.md` §1.3.

**Others:** `PLAN_SYLLOGIST.md` (:18, :28, :129, :132, :172 → `PLAN_INFERENCE_TESTING.md`);
`PLAN_CLASS_QUERY.md` (:9, :22, :26, :95 → `PLAN_BREADTH_FIRST_NLU.md`; :9 quotes its status section
verbatim as this plan's whole origin, now unverifiable); `PLAN_ADVENTURE.md` (:145, :251 →
`PLAN_SEED.md`); `PLAN_REPO_INDEX.md` (:148, :269 → `PLAN_UNTYPED_INTERFACES.md`, which never
existed); `corpus/seon/README.md:53`; `chatbench/GRADED.md` (:71, :135, :140, :253, :308);
`SKILL_BENCHMARK_CONVERSATION.md:3` (→ `SKILL_BENCHMARK_PLAYTEST.md`, never existed).

### 9.5 Duplication and drift

- **`HANDOVER.md:151-164` vs `CLAUDE.md:12-26`** — the coordinator-model section. HANDOVER:151-152
  says it is "copied verbatim". It is a paraphrase, so the two can drift silently, and it adds
  nothing but a pointer back. Cut to a pointer; CLAUDE.md is the source of truth.
- **ROADMAP's plan index is worse than reported.** `## Design docs` (:101-106) is prose and names
  **zero** plans. The only plans ROADMAP names anywhere are 5, in `## What's next` and `## Research
  horizon`. There are 15 root PLAN files, so **10 are unreachable** from the doc that claims to
  point at them. HANDOVER keeps a second list, and the two disagree. One list, one home.
- **`SKILL_CAPABILITIES_AUDIT.md:114-126`** — triple-stale worked example: cites the four reports
  §9.1 archives, computes `CAPABILITIES_1.8.14.md` (never existed), and says "even though
  `package.json` reads 1.12.1" (it reads 2.0.3). It is also self-undermining now, since all four
  axes sit at 2.0.3 with no carried-forward row — exactly what `CAPABILITIES_2.0.3.md:7` says.
- **`chatbench/README.md:21`** documents `CEFR_ENGLISH_0NN.md` + a `_TRANSCRIPTS.md` appendix. Both
  halves are wrong; `SKILL_BENCHMARK_CEFR_ENGLISH.md:43-48` superseded the split ("that split ends
  here").
- **`SKILL_BENCHMARK_*.md`** (4 docs, 88KB) each restate the same cycle scaffolding. A shared
  section would cut real bulk.

---

## 10. Repo and local cruft

**Tracked, needs your call.**

- **`chatbench/results/raw/` and `agentbench/results/raw/` — 35 files.** Both directories hold a
  `.gitignore` reading `raw/`, and the files were force-added past it. Someone meant to ignore these
  and lost the argument, or meant to commit them and left the `.gitignore` lying. **Untrack them; do
  not rewrite history.** They are 20MB checked out but only **1.23 MiB** of the 18.87 MiB pack, so a
  rewrite would reclaim ~6.5% of the repo at the cost of changing every commit hash on a branch with
  a live remote and CI that publishes to npm. Untracking stops the growth and costs nothing.
- **`.idea/` — 6 files.** Shared team config or personal cruft?
- **`STRATEGY_ADVISOR.log`** — **done: gitignored and untracked.** It is scratch written by the
  advisor skill, not a record, and its `!STRATEGY_ADVISOR.log` un-ignore was defeating the `*.log`
  rule for no one's benefit. Entries older than a day are now pruned by the advisor as it runs;
  `SKILL_AGENT_STRATEGY_ADVISOR.md` carries the rule and the log's own header repeats it for
  whoever opens the file.

**Local only (Rule 9 — propose, don't delete).** `.tmct/` 45MB, `chatbench/results` 46MB,
`agentbench/results` 1MB, `infbench/results` 1.7MB, `.DS_Store` files, stray
`examples/mini-webapp/.tmct/session-*.log`. All rebuildable, all your disk.

**One local case that is a real bug: `public/engine/` (1.4MB).** It holds a doubled layout — stale
flat copies (`public/engine/src/ask.mjs`, `codegraph.mjs`, `embed.mjs`, `hash.mjs`, `prose.mjs`,
`grammar/`, `interpret/`, `memory/`) beside the current nested ones, left over from the
pre-`adapters/`/`domain/` layout. Cause: `build-demo-site.mjs:81-84` `cpSync`s into `OUT` without
ever clearing it, so every renamed file accumulates. Only the nested paths are imported. CI
is unaffected because it checks out clean, which is exactly why this went unnoticed.

**Fix the script, not the directory:** add `rmSync(OUT, {recursive: true, force: true})` before the
copy loop. Deleting the directory today just defers it. The reorg already stranded one full copy of
the old layout on every dev machine that has run `demo:build`.

---

## 11. What the order taught us

The seventeen-batch schedule that stood here is spent; the tree is the record of it. Four things
about the *sequence* are worth keeping, because the next purge will face them again.

**Order the safety port before the deletion, always.** `guardrail.mjs` looked like dead code and
was, but it held the only runtime `readOnly` check in the tree. Porting first and deleting second
turned a risky batch into two boring ones. Had they been one commit, nobody could have reviewed it.

**Promote before you sweep.** The comment tail in `scripts/` shrank on its own as the modules
moved, because a promoted function gets a fresh docstring rather than an inherited citation. Doing
the sweep first would have been work thrown away.

**A promotion is only proven by regenerating the artifact.** Six persona artifacts and the
4,820-row collision table came out byte-identical after moving, and `corpus/wordnet`'s 192,498
facts regenerated with an empty diff. Tests passing means the tests pass; a byte-identical
regeneration means the behaviour did not move.

**Concurrency cost more than it bought.** Agents sharing one working tree swept each other's
staged work into the wrong commits, one `git stash` reverted another's files mid-run, and a
`node_modules` probe emptied the directory under a running agent. `git commit -- <paths>` helps
and is not enough — it commits the file's *current* content, including someone else's edits.
Worktree isolation, or one agent per file, is the actual fix.

---

## 12. The questions, and what was decided

All seven are answered. Kept because the reasoning outlives the decision.

1. **Comment sweep scope** — all of them, every area. The number was wrong too: the doc said 205,
   which swept whole lines and caught test data and fixture dates. Comment-prefixed, it was 81.

2. **The tracked bench results** — untracked, no history rewrite. This one turned on a number I got
   wrong: I reported 46MB, which was the working tree. In history they cost **1.23 MiB of an
   18.87 MiB pack**. Rewriting every commit hash on a branch with a live remote and a publishing CI,
   to reclaim 6.5%, is a bad trade. The `.gitignore` already said `raw/`; now the tree agrees.

3. **`embed.mjs`** — deleted, with `PLAN_EMBEDDINGS.md` recording the way back. It was never
   finished rather than broken: the fetcher and npm script it advertised were never written. The
   research turned up two things worth keeping: the model was wrong for the job (potion-base-8M's
   retrieval score is its *weakest* axis, and code search is retrieval), and the one dead-end it
   was meant to fix — `what talks to the payment module?` — closed at 2.1.0 for the price of one
   lexicon row.

4. **`generate-answer-variants.mjs`** — deleted. A print-only audit whose target is hand-curated,
   so a drift guard has nothing to compare against.

5. **`.idea/`** — kept, and the question was the wrong one. Its own `.gitignore` excludes
   `workspace.xml` and `/shelf/`, which is the signature of deliberate sharing: config tracked,
   personal state ignored. It only looked like cruft from outside.

6. **`STRATEGY_ADVISOR.log`** — gitignored and untracked, and the rule fixed at its source. The
   skill told the advisor "append-only; NEVER edit prior entries", which is *why* the file only
   grew: every OPEN item in it was moot, already fixed, or long since mined into HANDOVER. The
   advisor now prunes anything over a day old as it runs, and carries the file's header so a fresh
   checkout can recreate it.

7. **The persona cluster as a separate plan** — no, and the recommendation was wrong. It went in
   this pass and proved itself by regeneration. Its own finding is better than the plan's: this doc
   claimed `IRREGULAR_PLURALS` and `pluralOf` were two pluralization authorities to collapse. They
   are not. They answer opposite questions — `pluralOf` *generates* candidate surface forms and
   **wants** `"foots"`, because a form it fails to generate is a real word the repair tier may
   rewrite; `IRREGULAR_PLURALS` *declares* the one correct plural, where `"foots"` is a lie the
   grammar would trust. Merging breaks one or the other.
