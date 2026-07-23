# SKILL_BENCHMARK_INGEST.md — the INGESTBENCH measure-then-build cycle (rung-gated fact-extraction fidelity)

The repeatable loop that drives tmct's **text-to-facts** measurement forward one extraction
capability at a time: run the ladder, read the rung table, decide ship-or-build, and if building,
pick the next capability, implement it, regression-test, and re-measure. INGESTBENCH grades how
faithfully `ingestText` (`src/services/extract-facts.mjs`) turns a document into stored facts —
from a single grounded term up to a full-fidelity restatement of an arbitrary document in canonical
statements, with nothing lost and nothing added. The harness is `ingestbench/`; this skill is the
loop a session runs every time it wants to advance the ladder.

**Status (2026-07-23): this document specifies the harness. The `ingestbench/` build is later
work.** The ladder, the case shape, the grading modes, the scoring, and the measurement contract
below are the specification a build follows. The extraction machinery the bench measures already
ships (`ingestText`, `optimisticTriples`, `clauseCandidates`, the pronoun carry in
`src/services/extract-facts.mjs`; `ingestReferenceArticle` and `synthesiseAroundTerm` in
`src/services/chat.mjs`); the graded cases and the runner do not exist yet.

**The INGEST ladder (`ING-0…ING-9`) is its own scale, drawn from this bench's own domain.**
INGESTBENCH grades **fact-extraction fidelity** — does the document's meaning arrive in the store
as correct canonical statements, with real facts kept and no wrong facts invented. The rungs are
named for that meaning. They are not borrowed from CHATBENCH's CEFR grades (linguistic complexity
in conversation), AGENTBENCH's `TOOL-0…TOOL-8` (tool-use), or INFBENCH's `INF-1…INF-8`
(logic-fragment expressivity). The progression rises from one term through relation coverage and
cross-sentence structure to meaning-preserving restatement, a shape the information-extraction and
semantic-parsing literatures grade on (open information extraction, Banko et al. 2007; semantic
parsing to a complete meaning representation such as AMR, Banarescu et al. 2013; the
paraphrase/textual-entailment work behind `PLAN_PARAPHRASE_VERIFICATION.md`):

| rung | name | what it tests |
|---|---|---|
| ING-0 | Single grounded term | one declarative sentence yields at least one correct stored entity — the floor |
| ING-1 | One clean isa | a clean copula frame stores exactly the right class fact and nothing else ("a dog is an animal" → dog ⊑ animal) |
| ING-2 | Isa under span and clause pressure | the correct isa (or a correct abstention) survives compound modifiers, partitive/classifier of-chains, and cross-clause bleed ("string instrument" not "string"; "a body of ice" → no isa; "a type of mammal" → mammal; "one reason life can exist … is that Earth …" → nothing) |
| ING-3 | Relation coverage beyond isa | a known relation verb flanked by two entities stores its predicate (has/capableOf/creates/usedFor/partOf), with subject-side partitive discipline ("the weight of all of the snow creates pressure" → weight creates pressure, not snow) |
| ING-4 | Multiple facts per sentence | one sentence contributes every fact it grounds, not just the copula ("a volcano is a mountain that has lava from a magma chamber" → volcano ⊑ mountain AND volcano has lava) |
| ING-5 | Cross-sentence pronoun carry | a pronoun-led sentence grounds against the paragraph's last subject, and never bridges a topic break ("a dog is an animal. it has fur." → dog has fur) |
| ING-6 | Discourse-level ingest | a typed discourse record threads entities and relations across turns — definite descriptions ("the mountain"), ordinal and temporal links — the DRT-lite horizon |
| ING-7 | Paraphrase-equivalence, deterministic | each stored triple restated as a canonical statement, with a deterministic equivalence check confirming the restatement carries the same triple |
| ING-8 | Meaning-preservation, judged | the whole input restated in canonical statements, meaning preserved both ways (nothing added, nothing lost), scored by the offline judge where deterministic equality cannot reach |
| ING-9 | Full-fidelity restatement | an arbitrary document restated with nothing lost and nothing added — the top of the scale, graded for headroom, never claimed |

The ladder is a finite, useful scale, not a boundary on what the system can become. `ING-6`'s typed
discourse record is a scoping spike, not a settled build (`PLAN_AGENTS.md` §5 R1; frozen row 19,
`cross-turn-temporal-composition-unbuilt`); candidate literatures are discourse representation
theory (Kamp & Reyle 1993), file-change semantics (Heim 1982), and centering (Grosz, Joshi &
Weinstein 1995). `ING-7`'s deterministic equivalence check has a shipped isa-family slice
(`verifySubClassParaphrase` / `paraphraseVerifiedSubClass`, `src/domain/paraphrase.mjs`) and a
designed general contract (`PLAN_PARAPHRASE_VERIFICATION.md`). `ING-9` names the open extraction
frontier — arbitrary relation coverage and complete meaning representation — with candidate
literatures above. Until a tier is designed for a rung, its cases land on the honest-miss floor and
the judge scores them as misses, exactly as CHATBENCH's `HORIZON_CELLS` and INFBENCH's `INF-7`/
`INF-8` sit as ceiling markers before the capability ships.

Don't compare an `ING-3` result against a CEFR B1, a `TOOL-3`, or an `INF-3`. Same ladder shape,
unrelated axes. A rung is never compared across ladders.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_INGEST.md` and run an INGESTBENCH
> cycle"* (optionally: a source-text family to measure, a rung to target, a version stamp).

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the
  tmct version it measures: `BENCHMARK_INGEST_<version>.md`, raw under
  `ingestbench/results/raw/run-<version>[_00N]/`. A RE-RUN of the same version (a harness fix, a
  re-judge, a second draw) appends `_00N`: `BENCHMARK_INGEST_2.11.9_001.md`, `_002`, … — the same
  convention `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1, `SKILL_BENCHMARK_AGENT.md` §1, and
  `SKILL_BENCHMARK_INFERENCE.md` §1 already use.
- **Record the timing.** The write-up carries four wall-clock stamps: the start and end of the
  **benchmarking session** (the extraction run plus any judge fan-out) and the start and end of the
  **analysis** (reading the scores and writing the report). State the date and both intervals — a
  reader comparing two versions needs the measurement time and the write-up time as separate figures.
- **Fixed, versioned case set:** `ingestbench/cases.jsonl` — one JSON object per line
  (`id`, `rung`, `input`, `expect`, `grade`, `tags`). Append-only once the INGESTBENCH arc starts:
  new cases may be added between cycles (record the addition in the write-up), existing cases are
  never edited or removed mid-arc, for the same reason every sibling bench holds its case set
  sacred — editing a case invalidates every prior cycle's comparison against it. The graded cases
  drawn from the extraction fixes on record (clause-bridging, compound modifiers, partitive
  of-chains) seed the `ING-2` and `ING-3` rows; the reference-article summaries seed the
  higher rungs.
- **Case shape.** Each case is `{ id, rung, input, expect, grade, tags }`:
  - `input` — the raw source text (one sentence, a paragraph, or a short document).
  - `expect.statements` — the canonical statements the ingest should produce, each a
    `{ subject, predicate, object }` triple in the store's normalized form.
  - `expect.forbid` — optional triples that MUST NOT appear (the confused/fabricated reads a prior
    fix removed, kept as a standing guard so a regression re-surfaces as a failure).
  - `expect.abstain` — optional flag: the correct output is no fact at all (a partitive "a body of
    ice" states composition, not a class). Storing nothing here is a PASS, the ingest analogue of
    AGENTBENCH's clean refusal.
  - `grade` — `"deterministic"` (a value-compare, at and below `ING-7`) or `"judged"` (equivalence
    scored by the offline judge, `ING-8` and above). See the grading-mode bullet below.
- **The grading modes, split at a stated rung.**
  - **`ING-0` through `ING-7`: deterministic value-compare.** The harness runs `ingestText` over
    `input`, reads back the stored triples, folds them to canonical form, and compares to
    `expect.statements` / `expect.forbid` / `expect.abstain`. No judge, no LLM, no network. The
    extraction path is deterministic, so two runs over the same input and version produce
    byte-identical stored facts; one run per case is sufficient. `ING-7`'s equivalence check is
    itself deterministic — a canonical restatement is confirmed by re-parsing it through `parseAce`
    and deep-equalling the triple (`src/domain/grammar/ace.mjs`, `normFactTerm`), or by the
    isa-family closure check (`verifySubClassParaphrase`, `findIsaChain`) — the contract in
    `PLAN_PARAPHRASE_VERIFICATION.md` Part 4.
  - **`ING-8` and `ING-9`: judged equivalence.** Arbitrary restatement runs past what triple
    equality covers, so meaning-preservation is scored by the **LLM-as-judge in the eval harness**,
    the CEFR-cycle way — an LLM on the eval side only, never in the product path. The judge answers
    one question both ways: does every claim in the restatement follow from the input, and does
    every claim in the input appear in the restatement. Judge model and prompt version are pinned
    and recorded in every `BENCHMARK_INGEST_<version>.md`; a judge refusal or format failure VOIDS
    that case's score for that sample and is re-sampled or excluded, never counted as a fail.
- **The metric set per rung.** A single number is gameable (an extractor that stores nothing scores
  zero wrong facts at zero coverage), so every rung reports fidelity as **precision and recall on
  facts**, broken into the four failure classes the extraction playtests hunt:
  - **missed-useful** — a fact the text plainly offers, groundable by a shipped tier, is not stored.
    The recall failure (the one-triple-per-sentence cap that dropped "has lava coming out from a
    magma chamber" was the motivating case for `ING-4`, now lifted — one sentence contributes every
    fact it grounds).
  - **fabricated** — a stored triple the source does not support at all: a nonsense relation or an
    invented class. A precision failure of pure invention.
  - **confused** — a stored triple with the right predicate shape but the wrong participants: a
    subject or object that belongs to another clause or is the wrong noun in an of-chain
    ("life ⊑ earth", "glacier ⊑ body", "snow creates pressure"). A precision failure.
  - **greedy-span** — a stored triple whose entity captured the wrong extent: a compound modifier
    dropped ("violin ⊑ string" for "string instrument"), or extra material swept into a term. A
    precision failure; when the extent change changes the class, it also counts as confused.
- **The automatic-fail line: no wrong fact.** A stored triple the source does not support —
  fabricated, confused, or a meaning-changing greedy-span — fails that case outright, no matter how
  much else the ingest got right. This is the ingest analogue of AGENTBENCH's zero-hallucination
  line and the direct expression of tmct's charter: a query it cannot ground gets a refusal, never
  a guess, so a document it cannot ground cleanly yields no fact, never a wrong one. A missed-useful
  fact lowers recall but is the honest-miss side; it is never scored worse than a wrong fact.
- **The rung-gate rule (the INGESTBENCH analogue of the sibling ladder gates).** Rungs run
  **ING-0 → ING-1 → … → ING-9**, strictly in that order. A rung PASSES iff **no wrong fact
  (zero fabricated, zero confused, zero meaning-changing greedy-span) at ≥50% recall of the rung's
  expected statements** (`COMPLETION_FLOOR = 0.5`). A correct `expect.abstain` case counts toward
  the pass. The FIRST rung that fails this gate gates every rung above it — report those higher
  rungs as **skipped-with-a-receipt** (e.g. `rung ING-6 skipped: gated by ING-5 recall 0% < 50%`),
  the same discipline `SKILL_BENCHMARK_AGENT.md` §1 and `SKILL_BENCHMARK_INFERENCE.md` §2 hold:
  don't pay to judge a ceiling while the floor leaks. `--ladder` runs the rungs ascending and
  applies this automatically.
- **Bench-import direction stays one way.** The product (`src/`) never imports from `ingestbench/`;
  the bench imports downward from `src/services/extract-facts.mjs` (`ingestText`,
  `optimisticTriples`, `clauseCandidates`) and `src/domain/paraphrase.mjs`. A cycle that reverses
  this is a real regression, not a refactor detail — verify with `grep -r 'ingestbench' src/` before
  writing up a cycle as clean.

## 2. The loop (one cycle; repeats until the ladder tops out or the operator stops)

**Step 1 — READ.** Read the latest `BENCHMARK_INGEST_<version>.md` (its decision on frontiers and
any deliberately-kept honest miss), the ingest-axis open items in `NEXT.md` (the DRT-lite typed
record), and the current
`ingestbench/cases.jsonl` rung counts. Decide whether this cycle is a pure measurement or targets a
specific gated rung to push past.

**Step 2 — RUN the ladder.** `node ingestbench/run.mjs --ladder --stamp <version>`. The
deterministic tiers (`ING-0`–`ING-7`) are fast and free — no judge concurrency to manage. When the
cycle reaches the judged tiers (`ING-8`, `ING-9`), fan the judge out at maximum safe concurrency the
way `SKILL_BENCHMARK_CEFR_ENGLISH.md` §Step 4 does, and run that fan-out as a **background task** so
the main chat stays free for the operator.

> **Coordinator model — background sub-agents for the build.** Per `CLAUDE.md`'s standing working
> model, the main session is the coordinator, not the worker. A cycle that touches multiple
> mostly-independent workstreams — a new extraction rule in `src/services/extract-facts.mjs`, new
> cases in `ingestbench/cases.jsonl`, the paraphrase-equivalence wiring, the write-up — fans those
> out to background sub-agents with clear file-ownership boundaries, serialized on any shared file
> (`extract-facts.mjs`, `chat.mjs`'s `ingestReferenceArticle`), while the coordinator keeps the main
> chat free and picks results up on each completion notification. Any genuinely long run (the judged
> tiers, a much larger source-text set) moves to a background task too — never block the conversation
> on it.

**Step 3 — READ the rung table.** For each rung, read precision, recall, and the four failure-class
counts against the contract's gate (§1). Compare against the previous `BENCHMARK_INGEST_<version>.md`
if this cycle re-measures — did any previously-clean rung's numbers move, and if so, is that move
explained (a real behavior change, spot-verified against the store) or unexplained (a regression to
chase down before writing anything up)?

**Step 4 — DECIDE (apply the rung gate, §1).** Walk ING-0 → ING-9 in order. The first ungated PASS
is real progress; the first gate failure names exactly where the ladder currently tops out, with a
receipt for everything above it.

**Step 5 — SHIP OR BUILD.** Two outcomes:
- **Every rung gates where expected, and the current ladder depth is where it should be:** ship the
  re-measurement as-is — a clean re-measurement is a legitimate, reportable outcome, not a null
  result.
- **A rung you want to move past is gating, or the case set should grow deeper:** implement the next
  extraction capability that unlocks it — build the DRT-lite typed discourse record for `ING-6`, or
  wire the live paraphrase generator/verifier for
  `ING-7` (`PLAN_PARAPHRASE_VERIFICATION.md`'s phases). Regression-test (`npm test` green — no
  exception for extraction work), and re-run this cycle from Step 2 to confirm the target rung's gate
  now passes before moving further up the ladder.

**Step 6 — WRITE the cycle up.** `BENCHMARK_INGEST_<version>.md` (§1's naming convention), modeled on
the sibling reports' shape: a headline naming the honest delta versus the last cycle; the per-rung
fidelity table (precision, recall, the four failure-class counts); the best-examples pick — 3-5
verbatim input-to-canonical-statements excerpts showing the most faithful restatements this cycle,
each with a one-line "what this demonstrates"; the predictions-vs-actuals table (Step 1's target
against what moved); what's new this cycle, one item per change with the commit it landed in; any
deliberately-kept honest miss (a real fact the extractor drops, named as a frontier, not patched
around with a guess); the judge model and prompt version pin (for the judged tiers); the discipline
checklist (no-wrong-fact line held, determinism verified on the deterministic tiers, bench-import
direction one-way); and a decision line. **Mirror every issue the cycle leaves open** (a gating rung,
a kept honest miss, an unexplained rung move) **into `NEXT.md`** as a one-line open item pointing at
this write-up — `NEXT.md` is the next-session pickup list.

**Step 7 — CONTINUE.** If the operator wants the ladder pushed further, go to Step 1 of the next
cycle with the next gated rung as the target. Like AGENTBENCH and unlike CHATBENCH's continuous
autonomous loop, an INGESTBENCH cycle's "build" is genuine engine work (a new extraction rule, the
discourse record, the paraphrase wiring), so each cycle ends with a normal operator check-in rather
than an automatic re-arm.

---

## 3. Cadence

- One cycle per extraction capability. Size the cycle to the build, not a fixed time box — the
  typed discourse record or the live paraphrase verifier is real work, not a lever toggle.
- A pure re-measurement (no build) is a fast, cheap cycle on the deterministic tiers — worth running
  whenever `src/services/extract-facts.mjs`, `ingestReferenceArticle`, or the reference packs change,
  to catch a regression before it compounds.
- Run alongside the sibling cycles when a release touches both the ingest path and the chat or router
  surface — they measure different axes of the same release and belong in the same write-up cadence,
  not necessarily the same run.

## 4. Guardrails (delivery discipline)

- **The case set is sacred.** Append-only between cycles; never edit or delete an existing case
  mid-arc; record every addition in the write-up. Verify every `expect.statements` literal by
  running the ingest and reading the store back, never by hand-authoring a guess.
- **Snapshot before overwrite.** `ingestbench/results/raw/run-<version>[_00N]/` is written before the
  next run starts — a same-version re-run stamps `_00N` rather than clobbering the prior run's raw
  output. A skipped snapshot is a process slip.
- **No wrong fact is non-negotiable.** No cycle ships an extraction change that trades a wrong fact
  for coverage. If a change makes the extractor store a confused or fabricated triple on any rung, it
  is reverted or gated off, not shipped with a caveat. A missed-useful fact is the honest side; a
  wrong fact is not.
- **Never memorize the source string.** Extraction rules must stay grep-clean of the fixture's
  content words — deduce from part-of-speech tags, the closed copula/classifier/partitive sets, and
  lexicon membership, never pattern-match a fixture sentence's literal words. This is what keeps a
  PASS honest rather than overfit to the seed cases.
- **A gated rung is reported, not hidden.** Skipped-with-a-receipt, every time, even when the raw
  numbers on a gated rung look fine by coincidence — the gate exists precisely because a
  not-yet-built capability can clear 50% recall on a small pool without the rule that would make that
  number mean something.
- **Push state is session-scoped.** Commit locally with the repo-local identity; whether to push
  depends on the current session's operator authorization, same as every other loop in this repo.
- **No LLM leaks into the product or the deterministic tiers.** The judge exists only in the eval
  harness and only for `ING-8`/`ING-9`; the extraction path and the `ING-0`–`ING-7` grading stay
  deterministic and model-free. A change that would put a model call in the product path, or into the
  deterministic tiers, is rejected by definition.

## 5. One-paragraph TL;DR

Run `node ingestbench/run.mjs --ladder --stamp <version>` over the append-only
`ingestbench/cases.jsonl` and read the per-rung fidelity — precision, recall, and the four
failure classes (missed-useful, fabricated, confused, greedy-span) — against the honest gate:
**no wrong fact at ≥50% recall** passes a rung (`ING-0 → ING-9`, strictly in order), the first rung
that fails gates every rung above it skipped-with-a-receipt, and a correct abstention on an
`expect.abstain` case is a PASS. Grading is deterministic value-compare at and below `ING-7`
(including `ING-7`'s own `parseAce`-reparse / isa-closure equivalence check) and judged
meaning-preservation at `ING-8`/`ING-9`, where the offline LLM-as-judge — eval side only, never the
product path — scores whether the restatement carries the input's meaning both ways. `ING-0…ING-9`
is a distinct scale from CHATBENCH's CEFR, AGENTBENCH's `TOOL-0…TOOL-8`, and INFBENCH's
`INF-1…INF-8` — drawn from fact-extraction fidelity, unrelated axes, never compared across benches.
The upper rungs are research horizons with named literatures (`ING-6` DRT-lite: Kamp & Reyle, Heim,
centering; `ING-9` full restatement: open IE and AMR-style semantic parsing), useful measurement
headroom, graded never claimed. If every rung lands where expected, ship the re-measurement; if you
want the ladder pushed further, implement the next extraction capability that unlocks the gating
rung (the DRT-lite record, the live paraphrase
verifier), keep `npm test` green, and re-run to confirm the gate passes. Fan cycle work
that decomposes into independent workstreams out to background sub-agents under the coordinator model
(`CLAUDE.md`), keeping the main chat free; write up the cycle as `BENCHMARK_INGEST_<version>.md`
(headline delta, per-rung fidelity table, best-examples pick, predictions-vs-actuals, what's new, any
deliberately-kept honest miss, the discipline checklist, a decision), mirroring anything left open
into `NEXT.md` as one-line pickup items.
