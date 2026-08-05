# PLAN_RECEIPTS.md — a receipts page generated from measured, committed numbers

Split out of PLAN_PUBLISH.md on operator instruction, 2026-08-04. That plan's launch
sequencing depends on this page existing before any announcement; everything else about it
lives here.

The audit finding this plan starts from: the publish notes asked for a page presenting
token reduction versus conventional RAG, query latency, index size, and the $0 running
cost. No rig measures the first three. A grep across every committed report for "token
reduction", "RAG", "query latency", and "index size" returns zero hits. The notes asked to
be told rather than estimated, so the answer is recorded here: all three are missing. This
plan builds the page from numbers that are real today and adds the two cheap measurements;
the RAG comparison is future work with open design questions (see R3).

What exists and is committed, usable as page sources now (corrected during R2: the
chatbench/idxbench `results/raw/run-*/` dirs are gitignored, so the committed headline for
each lives in its `reports/BENCHMARK_*.md` write-up, not in run JSON):

- chatbench: the bolded result sentence in the latest `reports/BENCHMARK_CEFR_ENGLISH_*.md`.
- idxbench: the headline sentence in the latest `reports/BENCHMARK_CODE_INDEX_*.md`.
- `reports/PAGE_WEIGHTS.md` rev 3: per-page wire and raw sizes, measured 2026-08-02, with
  a documented re-measurement procedure.
- The supply chain shipped in README: npm tarball with Sigstore provenance naming the
  GitLab pipeline, plus a GitLab release tag per published version pinned to the built
  commit.
- The cost shape: static hosting, client-side engine, no inference API — the $0 claim is
  architectural, and the page states it that way rather than as a measurement.

## Dispatch contract

Same contract as PLAN_PUBLISH.md, restated so this doc stands alone:

- **Stop rule.** If the tree does not match what a task quotes, stop and report; never
  improvise.
- **Tests.** Only what the task names: `npm run test:smoke` after any edit, `npm run
  test:fast` plus named blast-radius files before committing. Never the full suite or e2e;
  those are the coordinator's, at the push.
- **Build outputs.** `public/` demo pages are gitignored build outputs; run `npm run
  demo:build` before reading one. `public/index.html` and `*-about.html` are hand-authored
  and tracked.
- **Git.** Commit as `Antony at Polycode <antony@polycode.co.uk>`; stage by explicit path;
  never push; never stash/reset/checkout-- /clean; don't touch untracked files you don't
  own.
- **Comments and prose.** No comment cites a plan, date, or item number. Human-facing text
  follows `.claude/skills/plain-prose/SKILL.md`.

## R1 — latency and size measurements, committed as JSON (Sonnet)

Files: new `scripts/bench-receipts.mjs`, new committed
`test-benchmarks/receipts/receipts.json`, `package.json` (one script line
`"bench:receipts": "node scripts/bench-receipts.mjs"`).

The script:

1. Loads the demo graph the site's chat page embeds (the build already assembles it;
   locate the payload builder in `scripts/build-demo-site.mjs` and reuse its source data,
   never a hand-copied path — stop and report if the graph source is not importable
   without the browser).
2. Runs 100 `ask()` queries drawn deterministically from the committed corpus (fixed seed
   list in the script, no randomness), measuring wall-clock per query with
   `performance.now()`.
3. Writes `test-benchmarks/receipts/receipts.json`:
   `{ generatedAt, commit, latencyMs: { p50, p90, p99, max, n }, graph: { facts,
   individuals, bytesRaw, bytesBrotli }, pages: [{ slug, bytesRaw, bytesWire }] }` —
   page byte figures read from the built `public/` tree and its `.br` siblings.
4. The JSON is committed. Regenerating it on another machine may shift latency numbers;
   the file records the machine class in a `host` field (`os.cpus()[0].model`, core
   count). Numbers on the page always come from the committed file, never from a fresh
   run at build time.

Acceptance: `npm run bench:receipts` exits 0 twice in a row and the second run changes
only `generatedAt`, `commit`, `latencyMs`, and `host` fields (structure stable);
`node -e 'JSON.parse(require("fs").readFileSync("test-benchmarks/receipts/receipts.json"))'`
exits 0; `npm run test:fast` passes.

## R2 — receipts.html rendered only from committed sources (Sonnet, after R1)

Files: `scripts/build-demo-site.mjs` (new page template), new
`test/estate/receipts.test.mjs`.

`npm run demo:build` gains a `public/receipts.html` page. Every figure renders from a
committed file read at build time; no number is typed into the template. Sections and
sources:

1. **Query latency** — `test-benchmarks/receipts/receipts.json` `latencyMs` (state n and
   the host field beside the numbers).
2. **Graph and page size** — same file, `graph` and `pages`; wire totals cross-checked
   against `reports/PAGE_WEIGHTS.md` in prose, linked.
3. **Answer quality** — the latest chatbench run's `summary.json` headline score, named by
   run id, linked to the report that discusses it.
4. **Index fidelity** — the latest idxbench result headline, same treatment.
5. **Running cost** — the architectural statement: static hosting, engine runs in the
   page, no inference API. No invented currency figure.
6. **Supply chain** — provenance plus release-tag chain, two sentences, linking the npm
   package page and the GitLab releases page.

Each section shows its source path in small print. The page gets the standard head block
(the metadata machinery from PLAN_PUBLISH.md T1; if that has not landed yet, emit the same
block shape inline and leave a marker comment-free — the estate test only checks figures).
Footer link from the index is added here.

`test/estate/receipts.test.mjs`: after a build, every numeric figure displayed on the page
(parse `data-source` attributes the template emits: each figure element carries
`data-source="<file>#<jsonpath>"`) matches the value in its named committed file. The test
fails on any figure without a `data-source` attribute.

Acceptance: `npm run demo:build` emits `public/receipts.html`;
`node --test test/estate/receipts.test.mjs` passes; `npm run test:fast` passes;
`grep -c 'data-source' public/receipts.html` is at least 8.

## R3 — the RAG comparison: open questions before anyone builds it

A defensible "token reduction versus conventional RAG" number needs a harness that does
not exist, and designing it raises questions this plan does not settle:

- Which RAG baseline: embedding store + top-k chunks into which model, at which context
  length? The choice dominates the result.
- What token accounting: tmct spends zero inference tokens by construction, so the
  interesting number is the baseline's spend per equivalent answer, over which task set —
  probably the chatbench case pool, which was not designed for that reuse.
- Judge design: equivalence of a grounded-or-refused answer against a generated one needs
  its own rubric; the existing LLM-judge contract covers tmct answers only.

Until a harness is designed for these, the receipts page carries no RAG comparison and no
claim about one. When it becomes worth building, it starts as its own bench under
`test-benchmarks/` with the same committed-results contract as chatbench, and this section
becomes its design sketch.
