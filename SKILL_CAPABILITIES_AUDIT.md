# SKILL_CAPABILITIES_AUDIT.md — the tmct capability-audit cycle

A capability audit answers one question: what can tmct actually do right now, capability by
capability, and how do we know? It is a synthesis pass, not a fifth benchmark. Each
`BENCHMARK_*.md` measures one axis with its own harness. An audit runs no new harness. It reads
the test estate and the benchmark reports, then writes down the capability surface with the
evidence for every row.

> **Invoke it by telling a session:** *"Follow `SKILL_CAPABILITIES_AUDIT.md` and run a capabilities
> audit"*.

`CAPABILITIES_1.7.3.md` is the last generated audit and the structural reference for what the
sections look like. Read it for shape. Never copy its verdicts forward.

---

## 1. What counts as evidence, and in what order

A capability is **surfaced** when a documented surface reaches it. It is **working** when a test
drives it through that surface and asserts the result. An audit row needs both halves.

The order below is the order of authority. When two sources disagree, the higher one wins.

**1. Tool-layer contract tests (primary).** `src/tools/` is the tool layer. `server.mjs` holds
`dispatchTool` and the `TOOLS` table. `conformance.mjs` holds `runConformance`, the provider
contract check. `schema-docs.mjs` renders the declared schemas. A test that drives `dispatchTool`,
runs `runConformance` against a provider, or exercises the Repository Interface's 16 services is
the strongest evidence an audit can cite. It proves two things at once: a caller can reach the
capability from the surface it really uses, and the contract holds.

**2. Corpus lane rows (primary, for chat behaviour).** `test/corpus/` holds 723 rows across 11
JSONL lanes in six families: `grammar`, `templates`, `inference`, `planning`, `games/*` (six
shards) and `bench-smoke`. Every row carries a `key` naming the production or capability it pins,
and drives its turns through the real session (`test/helpers/session.mjs`, the same `createSession`
path the shell uses). A keyed row is machine-checked evidence for the key it names, re-checked on
every `npm test`.

**3. The rest of the estate (supporting).** `test/adapters/` is the unit ring: it proves a unit
computes, not that anything reaches it. `e2e/` drives the real binary and the browser. `test/readme/`
executes every README example, so a documented example is a checked example. `test/estate/` enforces
the structure itself, including downward-only imports across the five `src/` layers
(`test/estate/import-layers.test.mjs`).

**4. Benchmarks and playtests (quality, not existence).** The four `BENCHMARK_*.md` reports measure
behaviour under load: routing and planning, conversational quality, dialogue dead-ends, and
classical-logic inference. Cite them for how well a capability performs and where it degrades. Do
not cite them to establish that a capability exists. A benchmark can score a surface that no
documented caller can reach.

**5. Reading the source (locates, never establishes).** Source reading tells you where a capability
lives and what it intends. It does not tell you what it does. "I read the code and it looks wired"
is not a status.

### Why the order is this way

`src/domain/interpret/strategies/keywords.mjs` defines `PASSIVE_AUX` and `parseKeywordSpot`
consults it. A source read concludes the passive path handles passive readings. Driving the real
session says otherwise: "was store.mjs touched" answers "src/core/store.mjs has no touches edges in
the index", while "has store.mjs been touched" returns the three real commits. The row
`games/bare-passive-yesno-reads-active-subject` pins that wrong answer. Source reading would have
recorded this capability as working. The row records it as broken, every test run.

### The evidence rules

- **No test, no `implemented`.** A capability nothing drives is `claimed-only`, whatever the source
  looks like.
- **For "this works", cite the row key or the test.** For "this lives here" or "this changed", cite
  `file:line` or a commit. Do not mix the two.
- **A frozen-wrong row is evidence.** Several rows assert the current wrong answer on purpose, so a
  fix has to flip them deliberately. Cite them by ID and say the capability is open, not missing.
  `games/bare-type-discourse-filter-unbuilt` is a worked example.
- **A benchmark number without its report version is not evidence.** See §2.

### The commands

Run these; they are real, and they beat prose claims.

```
node scripts/corpus-matrix.mjs           # key × lane matrix: which lane pins which key, and how many rows
node scripts/corpus-matrix.mjs --gaps    # thin keys (one row pins a whole capability) + keys with no negative row
node --test test/corpus/grammar.test.mjs # drive one lane
npm test                                 # the whole estate
```

`--gaps` is the honest map of where the evidence is thin. A key with a single row, or with no
negative row, is a capability whose status the estate barely pins. Say so in the audit rather than
reporting the row as solid.

---

## 2. Numbering, and saying where every figure came from

**Name the audit `CAPABILITIES_<version>.md`, where `<version>` is the highest benchmark version
it audits.** A rerun at the same version appends `_00N`. No "AUDIT" in the name.

This is deliberately not the `BENCHMARK_*.md` rule. Each benchmark report is named for the
`package.json` version it measured. An audit measures nothing, so it takes its name from its
evidence: the newest benchmark data it stands on.

Worked example, true as this is written:

| Benchmark | Latest report | Figure comes from |
| --- | --- | --- |
| AGENT | `BENCHMARK_AGENT_1.7.0.md` | 1.7.0, carried forward |
| CEFR_ENGLISH | `BENCHMARK_CEFR_ENGLISH_1.8.0.md` | 1.8.0, carried forward |
| CONVERSATION | `BENCHMARK_CONVERSATION_1.8.14.md` | 1.8.14, current |
| INFERENCE | `BENCHMARK_INFERENCE_1.7.0.md` | 1.7.0, carried forward |

`max(1.7.0, 1.8.0, 1.8.14, 1.7.0)` is 1.8.14, so that audit is `CAPABILITIES_1.8.14.md`, even
though `package.json` reads 1.12.1.

**Every audit opens with that table, filled in for its own cycle.** A figure whose report is older
than the audit's own number is carried forward, and the row says so. A carried-forward number
presented as current is the failure this table exists to stop: it reads as a measurement of today's
code when nobody has measured today's code.

Rules that follow from it:

- Where a bench has no data at the audit's level, use its most recent available data and name that
  version in the same sentence as the number.
- Never write a benchmark figure without its version anywhere in the doc, including §4.1's
  comparative table.
- If a harness is blocked or degraded this cycle, say that instead of reusing an old number. A
  blocked harness is real evidence about the current state.

---

## 3. Scope: the capability superset

The audit covers three sets, not one. Both plans below take the current capability set as their
foundation, so the audit is where that foundation gets checked.

**(a) The product capability catalog.** What the audit has always covered: the full row set from
the last audit, re-verified, plus new rows for anything that shipped since.

**(b) What `PLAN_NLU_BENCHMARKS.md` would measure.** Surface each of these with a status, even when
the answer is that the product has no such capability today:

- utterance → intent label from a fixed vocabulary
- out-of-scope refusal and the miss wall (`miss: true`, `WALL_MISS_RE`)
- entity and slot extraction
- token/lemma normalisation through wink-nlp
- synonym and hypernym expansion from the corpus rows
- IDF-weighted ranking (`retrieveBlocks`)
- cross-domain false accept: the lane that fires when it should not
- short-utterance handling, including the conversational catch-all
- the read-only session guarantee (no wrong-lane writes during a scored run)
- determinism and byte-identical reruns
- OWL property reasoning and Horn-rule teaching, which that plan lists as levers
- proof rendering and planner consumption of taught records

**(c) What `PLAN_AGENTS.md` leans on.** Its mounts assume these hold:

- the Repository Interface: 16 services, `INTERFACE_VERSION`, closed `EDGE_KINDS`/`MISS_REASONS`,
  and `runConformance`
- the `TOOLS` table and `dispatchTool`
- the `/v1/messages` HTTP shim
- the capability router: the registry's 15 capabilities, resolver, planner, guardrail, goal-reasoner
- the library exports other repos bind to: `buildCapabilityPlanCtx`, `runCapabilityPlan`,
  `createGraphService`
- the extension-pack seam, bias weighting, persona init
- memory: `snapshotMemory`, source reliability, `findContradictions`, hub-dampened ranking
- taught relations and rules, and `resolveRelationChase`
- the explicit-teaching surface the scrape pipeline would feed
- telemetry, and the path-traversal guard on source reads

A capability in (b) or (c) that the product does not have yet gets a row with status `absent` and
the plan that wants it named. That is the point: both plans then rest on a foundation that tracks
reality instead of on their own recollection. Where no settled engineering exists for one, name the
open problem and say what happens until a tier is designed. Requests that reach no tier land on the
honest miss wall.

---

## 4. Required sections

Every `CAPABILITIES_<version>.md` carries the per-bench provenance table from §2, the full status
table, and the four sections below.

### 4.1 Comparative agent-capability table + speculative TO-BE

A general agent-capability taxonomy as rows (tool use, planning, reasoning, grounding, memory,
instruction-following, generation, coding, safety/honesty, autonomy, or whatever list currently
fits; check it still does). Columns are tmct plus a few named, specific models (`Claude Sonnet 5`,
`Llama 3.1 8B Instruct`). Never an umbrella brand or a hosting surface: `Anthropic` is a company and
`AWS Bedrock` hosts several vendors, so neither is a column.

- Open with a short framing paragraph. This places tmct on a scale a reader knows. It is not an
  "as smart as" claim, and tmct is a narrow, deterministic, zero-cost system.
- A fixed-width ASCII quick-reference table, verdict word only per cell: `Weaker`, `Comparable`,
  `Comparable-to-stronger`, `Stronger`, relative to tmct.
- The full prose table: same rows and columns, each cell carrying the why. **Every tmct cell cites a
  real number with the report version it came from** (§2).
- Model-column verdicts are informed estimates from public capability tiers, not a measured
  cross-benchmark result. Say so. Re-confirm each against the current capability rather than
  copying it forward.
- A `### Speculative TO-BE` subsection, drawn from the current reports' own "Next" sections and
  `HANDOVER.md`'s ranked follow-ups. Not a roadmap commitment. Confirm against the tree that an item
  has not already shipped before listing it.

### 4.2 Per-benchmark feature-support

One subsection per current `SKILL_BENCHMARK_*.md`. Bulleted, terse, each bullet ending in
**complete** or **todo**, citing the real report by name and version. If a harness is blocked this
cycle, say so here.

### 4.3 Per-plan feature-support (Done / Doing / Todo)

One subsection per live root `PLAN_*.md`, plus any `archive/PLAN_*.md` still carrying open scope.
A plan that is fully shipped and archived gets a one-line pointer, not a bucketed subsection.

Each subsection opens with a **`pinned at <commit-or-version>`** line, then three lists scoped to
that plan's own scope: **Done** (shipped, with a code or commit citation), **Doing** (genuinely in
progress), **Todo** (still open by the plan's own account, re-checked against the tree).

### 4.4 Non-benchmarked capabilities

Real, shipped work that no benchmark's scalar reaches: a pipeline no benchmarked surface touches, a
default-behaviour flip no case set probes, session quality no single-turn grade captures. Name these
so that "no benchmark moved" does not read as "nothing happened".

---

## 5. The audit refreshes `PLAN_AGENTS.md`

`PLAN_AGENTS.md` builds every mount on the current capability set, so it moves when capabilities
move. Refreshing it is a step of this cycle, not a follow-up.

After the status table is written, walk `PLAN_AGENTS.md` against it:

- **Its ground-truth table (§1).** Every row names a capability the audit just verified. Correct any
  row the audit contradicts, including counts and version strings.
- **Its open Phase 0/1 items.** Re-measure each against today's code, by the §1 evidence order. If
  an item is done, say done. If it is open, say open, and name the row or test that pins it.
- **Its `src/` paths.** The five-layer move renamed many. Check every cited path resolves.
- **Its status block.** If the block contradicts the body, the block is stale. Fix it.

Do the same for `PLAN_NLU_BENCHMARKS.md` where the audit touches what it measures (§3b).

---

## 6. The cycle

**Step 1 — Read the evidence you do not re-measure.** Read the four current `BENCHMARK_*.md`
reports in full and build §2's provenance table first, so every figure carries its version from the
start. Do not re-run them. If one is blocked, report that.

**Step 2 — Map the estate.** Run `node scripts/corpus-matrix.mjs` and `--gaps`. This is the
key × lane picture of what the estate actually pins, and it is the fastest way to see which
capabilities have thin evidence.

**Step 3 — Recover the last full catalog.** Read the most recent `CAPABILITIES_<version>.md` end to
end, including its own back-references.

**Step 4 — Re-verify every row against the evidence order (§1).** Find the tool-layer test or the
keyed row that pins each capability. Fall back down the order only when nothing higher exists, and
say which rung the row rests on. Where the estate pins nothing, that is the finding.

**Step 5 — Fan the work out by capability range.** A full re-verification is the parallelizable
research this project's coordinator model exists for. Split the catalog into ranges, launch a
background agent per chunk with the range and the worktree path, and have each report a compact
table (status, evidence, change-note). Reserve separate agents for "what shipped that has no row at
all" (§7) and for §4's sections.

**Step 6 — Add rows for new work.** A new storage backend, a new CLI verb, a default flip: give it a
new number continuing the sequence, and say it is new work rather than a prior miss.

**Step 7 — Write §4's sections, then refresh the plans (§5).** Do this after the status table. The
table's evidence is what grounds the comparative cells and the plan buckets.

**Step 8 — Close with real counts.** Total rows, how many `implemented`/`partial`/`claimed-only`/
`absent`, and which rows flipped since the last audit. Grep the table for the status word. Do not
eyeball it.

---

## 7. Finding what is new

A status sweep over the existing catalog misses anything that shipped with no row to compare
against. Before finishing, check:

- `git log <last-audit-commit>..HEAD --oneline`, reading every subject, grouped into workstreams.
- New keys in the corpus: `node scripts/corpus-matrix.mjs` against the last audit's key list. A new
  key is a new pinned capability.
- New entries in `package.json`'s `exports`, new npm scripts, new verbs in `bin/tmct.mjs`'s usage
  banner, new members of the `TOOLS` table.
- New root `PLAN_*.md`/`SKILL_*.md` docs, and any `archive/PLAN_*.md` archived since. Its final
  STATUS block is the fastest account of what a workstream shipped.
- Anything a fresh report names as a new finding.

---

## 8. Back-referencing

When a status differs from a prior audit's verdict, name that audit and say what changed.

- Cite the prior doc by its real filename.
- Say what the verdict was and what it is now, in one sentence.
- Point at the evidence: the row key, the test, a commit. "Now implemented" with no citation is a
  guess.
- Report regressions exactly as directly as progress. An audit that only tracks one direction is
  not worth reading.

For unchanged rows, restate the status with one citation and move on. The deep work belongs on what
moved.

---

## 9. Discipline

- **Never assume a prior verdict holds.** Re-check every row against the evidence order, every time.
- **Full scope, every time, unless you say otherwise.** If you drop something from the catalog,
  write down why. Silent narrowing is how a catalog rots into a changelog.
- **Every figure carries its version** (§2).
- **This is not a benchmark run.** Cite the reports; do not re-execute them. Running
  `node chatbench/run.mjs` means you have left this skill for `SKILL_BENCHMARK_CEFR_ENGLISH.md`.
- **`npm test` green, checked in the foreground.** Read the real pass count yourself.
- **Follow `SKILL_PLAIN_PROSE.md`.**

---

## 10. One-paragraph TL;DR

Name the audit `CAPABILITIES_<max benchmark version audited>.md`, `_00N` for reruns, and open it
with a per-bench table saying which version every figure came from. Evidence has an order: the tool
layer's contract tests and the keyed corpus rows prove a capability is surfaced and works;
`test/adapters/`, `e2e/` and `test/readme/` support; the four `BENCHMARK_*.md` reports measure
quality under load, not existence; reading the source locates a capability and never establishes it.
No test, no `implemented`. Run `node scripts/corpus-matrix.mjs --gaps` and say where the evidence is
thin. Cover the superset: the product catalog, what `PLAN_NLU_BENCHMARKS.md` measures, and what
`PLAN_AGENTS.md` leans on, marking absent capabilities `absent` rather than leaving them off. Write
the four required sections, then refresh `PLAN_AGENTS.md` against what you found. Close with grepped
counts and a green `npm test`.
