# BENCHMARK_CEFR_ENGLISH_1.7.0 — mean up to 1.750/2, 0 hard fails; the gain traces to already-shipped 1.6.1 fixes, not this cycle's VIZ/CONVERSATION work

**Headline:** CEFR_ENGLISH re-run against **1.7.0** (per `package.json`), following
`SKILL_BENCHMARK_CEFR_ENGLISH.md`'s cycle. This is a **measurement-only cycle**: no lever was
applied to this benchmark's case pool this session, and — checked directly, not assumed — none of
1.7.0's own shipped code (`PLAN_VIZ.md`'s codegraph/memory work, `PLAN_CONVERSATION.md`'s Finding 3
grain-check fix, Finding 5's four new `chat.mjs` fact-cascade frames) touches any of the 109 graded
cases. Both the product run and the judge pass were executed fresh by this session (no recovery
needed, unlike `1.6.0`'s report).

**Result: mean 1.750 / 2 (up from 1.6.0's 1.710, +0.040), 0 hard fails out of 109 cases (down from
1, 0.9%→0%), 0 voided samples, tier-1 109/109 (up from 108/109).**

**Decision rule (§1): PASS.** Mean is up vs `1.6.0`, and no previously-passing case regressed —
hard fails went from 1 to 0 (impossible for anything to have "regressed to fail" when nothing is
failing), and tier-1 went from 108/109 to 109/109. But the honest reading of *why* is not "1.7.0
improved chat quality": the single case that flips from hard-fail to non-hard-fail this cycle
(`g-a1-naming-9`) has a **byte-identical product answer** to `1.6.0`'s — the flip is judge-sample
noise on a known coin-flip case, not a code change. The larger, real part of the story is that this
run's numbers land almost exactly on `1.6.1`'s own judge pass (mean 1.742/2, 0 hard fails, 109/109
tier-1 — recorded as an addendum inside `BENCHMARK_CEFR_ENGLISH_1.6.0.md`'s decision log, never
its own file): `am-tests-cover` and `g-a1-naming-8` were already fixed and already re-measured
*before* this cycle's own commits landed. So `1.7.0`'s PASS is real by the letter of the rule, but
the gain over `1.6.0` is inherited from `1.6.1`'s already-shipped, already-measured fixes carrying
forward — not new signal from this cycle's VIZ/CONVERSATION work. Read this as **"flat since
1.6.1, up since 1.6.0 for reasons already banked before this cycle started."**

## Provenance — fresh run, this session

- Product run: `node chatbench/run.mjs --stamp 1.7.0 --sample 1 --single` → `chatbench/results/raw/run-1.7.0/product.jsonl` (109 rows, wall time 881.7ms per `timings.json`).
- Judge run: `node chatbench/judge.mjs --product chatbench/results/raw/run-1.7.0/product.jsonl --samples 2 --out chatbench/results/raw/run-1.7.0` → `judged.jsonl` (218 rows) + `summary.json`, both written to `chatbench/results/raw/run-1.7.0/`. Wall time ≈12m28s (file mtimes: product 18:05:37 → judged 18:18:05 BST); summed per-call `duration_ms` = 7,501.4s (≈125.0 CPU-minutes), ≈625s (≈10m25s) estimated at concurrency 12 — same order of magnitude as the directly observed span, the same cross-check `1.6.0`'s report used.
- `npm test`: **1895/1895 green**, run by this session at commit `c69691fe1ccce2f4374ab93604a3c627ef9d2262` (this report's pin — `1.7.0`'s version-bump commit `a2c0d25` plus two follow-on benchmark write-ups, `4f3f643`/`c69691f`, for INFBENCH/AGENTBENCH — unrelated suites, not touched by this report).
- **No `1.6.0` raw snapshot survives on this machine** (`chatbench/results/raw/run-1.6.0/` doesn't exist, wasn't ever committed to git, and isn't in `archive/` either — it was itself a one-off recovery from a lost worktree per `1.6.0`'s own report). Per-case comparison below uses `1.6.0`'s **published tables**, not raw judged rows; the `1.6.1` addendum figures are likewise taken from `1.6.0.md`'s own decision-log update, the only place they're recorded.

## Deterministic tier-1 (free, run first)

109 cases, single draw (`product.jsonl`'s `sampling.draw: "single"` on every row). Per-case
`tier1.pass` (the authoritative field — confirmed against `product.jsonl` directly, not just the
CLI summary line) is 100% across every band:

| band | n | tier-1 pass |
| --- | --: | --: |
| A1 | 27 | 27 |
| A2 | 19 | 19 |
| B1 | 33 | 33 |
| B2 | 10 | 10 |
| C1 | 10 | 10 |
| C2 | 10 | 10 |
| **all** | **109** | **109/109 tier-1 pass** |

Up from `1.6.0`'s 108/109 (the single tier-1 fail, `am-tests-cover`, was fixed in `1.6.1` — commit
`bf87c6c`, well before this cycle — and confirmed still passing here: "which tests cover b.mjs" →
honest two-way ambiguity, not a confident wrong guess). Separately, 28 of the 109 cases carry a
documented `baselineFail` turn (a known historical weakness tracked in the case definition itself);
`run.mjs`'s own rollup reports 9 of those 28 as still "frontier" (the documented weakness not yet
resolved) even though every one of the 109 cases still passes its own tier-1 `expect` — frontier
tracks unresolved *known-weakness* status, a narrower and different thing than tier-1 pass/fail, and
is not comparable cell-by-cell against `1.6.0`'s report without re-deriving `1.6.0`'s own raw
rollup (unavailable — see Provenance).

## Judged tier (the paid step — N=2, single draw, `claude-haiku-4-5-20251001` @ `judge-prompt-v1`)

Raw: `chatbench/results/raw/run-1.7.0/judged.jsonl` + `summary.json` (both fresh, this session).

| metric | value |
| --- | --- |
| cases judged | 109 |
| samples/case | 2 (218 total judge calls) |
| overall mean | **1.750 / 2** (1.6.0: 1.710; 1.6.1 addendum: 1.742) |
| hard fails | **0** (1.6.0: 1; 1.6.1 addendum: 0) |
| voided samples | **0** (1.6.0: 0; 1.6.1 addendum: 1, `g-b1-pron-4`, itself un-voided this run — see below) |
| tier-1 pass count | 109 / 109 (1.6.0: 108/109; 1.6.1 addendum: 109/109) |

`g-b1-pron-4` (the case the `1.6.1` addendum's single voided sample belonged to) judged clean this
run — both samples scored, mean 1.0, no refusal/format failure. That's expected noise, not
significant: the `1.6.1` addendum itself called the void "unrelated to that cycle's changes."

### Per-tag breakdown

| tag | cases | 1.7.0 mean | hard fails | 1.6.0 mean | Δ |
| --- | --: | --: | --: | --: | --: |
| conversational | 6 | 2.000 | 0 | 2.000 | 0 |
| bootstrap-empty | 2 | 2.000 | 0 | 2.000 | 0 |
| noise | 5 | 1.900 | 0 | 1.967 | −0.067 |
| multi-turn-focus | 5 | 1.900 | 0 | 1.900 | 0 |
| typo-fuzzy | 4 | 1.854 | 0 | 1.771 | +0.083 |
| memory-recall | 3 | 1.833 | 0 | 1.750 | +0.083 |
| graph-query | 16 | 1.766 | 0 | 1.771 | −0.005 |
| honesty-miss | 5 | 1.533 | 0 | 1.433 | +0.100 |
| ambiguity | 4 | 1.438 | 0 | 1.313 | +0.125 |
| **graded (all 109)** | **109** | **1.750** | **0** | **1.710** | **+0.040** |

Every tag's movement is a couple of samples' worth of judge noise (all under ±0.13), scattered both
directions — `noise` and `graph-query` moved down slightly, six others moved up. No tag crossed
into or out of a hard fail. `ambiguity`'s +0.125 is the largest positive move and is fully explained
by the already-fixed `am-tests-cover`/`g-a1-naming-8` (see "What moved" below), not new behavior.

### Per-grade / per-construction cell rollup (judged mean)

| grade | construction | n | 1.7.0 mean | 1.6.0 mean | Δ |
| --- | --- | --: | --: | --: | --: |
| A1 | naming-vocabulary | 10 | 1.538 | 1.512 | +0.026 |
| A1 | svo-query | 17 | 1.799 | 1.833 | −0.034 |
| A2 | assert-recall | 9 | 1.944 | 1.917 | +0.027 |
| A2 | naming-vocabulary | 10 | 1.938 | 1.837 | +0.101 |
| B1 | discourse-reference | 5 | 1.900 | 1.900 | 0 |
| B1 | negation | 5 | 1.533 | 1.433 | +0.100 |
| B1 | noise+svo-query | 5 | 1.900 | 1.967 | −0.067 |
| B1 | pronoun-binding | 10 | 1.658 | 1.625 | +0.033 |
| B1 | svo-query | 8 | 1.646 | 1.542 | +0.104 |
| B2 | reversible-passive | 10 | 1.925 | 1.850 | +0.075 |
| C1 | temporal | 10 | 1.558 | 1.400 | +0.158 |
| C2 | pronoun-binding | 10 | 1.663 | 1.688 | −0.025 |

Largest single move either direction: `C1 temporal` +0.158 (10 cases — one sample's worth of
scoring at this N). Checked directly against `product.jsonl`: none of `C1 temporal`'s 10 answers
differ in kind from what a code-graph-only chatbot has always produced for these questions (a mix
of correct commit lookups and honest "nothing in the index matches that" misses, several of which
still score `rephrase: 0` for offering no nudge — see "Decision log"). The movement is judge-sample
variance, not a product change; `C1 temporal`'s underlying code path (`ask.mjs`'s commit-history
traversal) was not touched by any commit in the `1.6.0`→`1.7.0` window.

### No hard fails this cycle — the weakest cases instead

With 0 hard fails, the discriminating signal is the low end of the mean distribution, not a
hard-fail table:

| case | grade/construction | mean | dims (g/c/h/r) |
| --- | --- | --: | --- |
| `g-c2-pron-2` | C2 pronoun-binding | 0.625 | 1 / 0 / 0.5 / 1 |
| `g-c1-temp-8` | C1 temporal | 0.834 | 1.5 / — / 1 / 0 |
| `g-a1-naming-9` | A1 naming-vocabulary | 0.875 | 1.5 / 0.5 / 0.5 / 1 |
| `g-c2-pron-1` | C2 pronoun-binding | 1.000 | 2 / 0 / 1 / 1 |
| `g-b1-pron-1` | B1 pronoun-binding | 1.000 | 2 / — / 1 / 0 |

`g-a1-naming-9` ("what does imports mean") is the same permanent, deliberate authoring conflict
`1.6.0`/`1.6.1` documented: its input is byte-identical to `am-meta-imports`'s own frozen
expectation, and a fix for one necessarily breaks the other (§1's regression rule forbids it). Not
a new finding — reconfirmed, unchanged.

`g-c2-pron-2` and `g-c2-pron-1` are new-to-this-report as the two lowest scores, but not a new
bug: both are "SUBJECT VERB because REASON — which of them VERB2" compositional/discourse-anaphora
questions that tmct's "follow-up filter" fails to compile at all, falling back to a generic
capability list instead of a targeted rephrase hint. This is the same class of gap
`PLAN_CONVERSATION.md` Finding 4 already names as open (anaphoric "which"-questions), not a
regression from this cycle.

## What moved since 1.6.0 — checked directly against this cycle's actual code changes

**None of 1.7.0's own shipped work is a lever against this benchmark's case pool — confirmed by
grep, not assumed:**

- **Finding 3's exact repro** ("what modules does X have") and its general shape ("which/what
  functions/modules/classes does X …"): `grep -io` over every `"say"` field in
  `chatbench/graded-pool.jsonl` for both the literal repro and the general "which/what
  {functions,modules,classes,methods} does" pattern returns **zero matches**. Finding 3's fix
  (`ask.mjs`'s forward-branch grain check) only fires when `entityType` is set on a forward-shape
  parse; no CEFR case's phrasing sets it that way.
- **Finding 5's four new frames** (`CAN_ASK_RE`, `WHAT_CAN_DO_RE`, `WHAT_HAS_RE`,
  `WHAT_INHERITS_RE`, all landed in `chat.mjs`'s `factAnswer` cascade, default-persona/no-`--repo`
  general-knowledge queries): grepped for `CapableOf`/`HasA`/`inherits`/`subClassOf`-shaped
  phrasing across the pool. The one close hit, `conv-what-can-you-do`'s "what can you do", *would*
  textually match `WHAT_CAN_DO_RE`'s regex — but its `product.jsonl` transcript shows the answer is
  still the pre-existing orientation template (`via: "template"`, "I'm tmct — a deterministic,
  offline code-graph assistant…"), not a `factAnswer`/CapableOf lookup — the conversational
  orientation lane runs first and this case never reaches the new cascade. The other "inherits"
  hits (`g-c2-pron-2`, `gq-describe-widget`, `am-two-readings`) are all pre-existing forward-shape
  or `/describe`-rendering usages, not the new reverse-by-object frames. Separately: Finding 5's
  frames answer general-knowledge fact queries against the seeded **persona/memory graph** (e.g.
  "what is a dog"); every CEFR case, including the two `graph:"empty"` bootstrap cases
  (`be-honest-empty`, `be-greet-stats` — an empty CODE-graph index, not a general-knowledge fact
  scenario), asks code-graph-shaped questions ("which modules import …", "how many modules",
  "/stats") that never touch the fact-cascade's territory at all.
- **`PLAN_VIZ.md`'s `codegraph.mjs` work** (`spiralExpand`/`adjacencyForKinds` generalization, edge
  `createdAt`/derived `updatedAt`): zero matches for `spiralExpand`/`adjacencyForKinds`/`codegraph`
  anywhere in the pool — expected, since this is graph-visualisation plumbing with no call site in
  `chat.mjs`'s query-answering path (`ask.mjs` imports only `relationKind`/`impactClosure`/
  `normPath`/`HISTORY_CAP` from `codegraph.mjs`; `chat.mjs` imports a disjoint, unrelated set).

**Where the actual +0.040 mean gain and the hard-fail-count drop come from, traced case by case:**
the same two cases `1.6.0`'s own decision log already resolved via `1.6.1` (commit `bf87c6c`,
merged well before `1.7.0`'s `9510a43`):
- `am-tests-cover`: tier-1 fail → pass, judged mean 2.000 (honesty 2, rephrase 2) — unchanged from
  the `1.6.1` addendum's own re-measurement.
- `g-a1-naming-8` ("what does tests mean"): now answers directly, judged mean 1.500 — close to the
  `1.6.1` addendum's reported 1.0 (single-N addendum vs this run's N=2; both non-hard-fail).
- `g-a1-naming-1` ("what does defines mean", the bonus fix from the same commit): judged mean 1.000
  this run (down from the `1.6.1` addendum's reported 2.000) — the product answer is unchanged
  (checked, byte-identical: "defines is a predicate (relation) in the graph's schema: …"); this is
  judge-sample noise on a 2-sample draw, the same kind of wobble `1.6.0`'s report itself flagged
  throughout its own per-cell table.

**Conclusion, matching `1.6.0`'s own framing:** this is a catch-up measurement, not a single-lever
cycle. The mean is genuinely up against `1.6.0`'s number, satisfying the decision rule at face
value, but every case-level cause traces to work already shipped and already measured in `1.6.1` —
`1.7.0`'s own commits (`9510a43` and its docs follow-ons) are confirmed, by direct grep and
transcript check, to land entirely outside this pool's reach.

## Discipline — the non-negotiables, checked

- **No LLM in the product** — `chat.mjs`/`runTurn` stayed no-LLM throughout; this session made no
  product-code changes (measurement only, per the task brief).
- **Judge model + prompt version pinned**: `claude-haiku-4-5-20251001` @ `judge-prompt-v1`,
  confirmed from this run's own `summary.json` (`judgeModel`/`promptVersion` fields), matching
  every prior cycle's pin exactly.
- **Judge integrity**: 0 voided samples this run — no refusal/format failure.
- **Determinism (tier-1)**: single product run, single draw, per case-set v3's default
  (`product.jsonl`'s `sampling.draw: "single"` on every row).
- **Case set unchanged**: still the same 109-case `graded-pool.jsonl` (append-only, sacred per §4)
  — no case added, edited, or removed since `1.6.0`.
- **`npm test`**: 1895/1895 green, this session, at `c69691f`.
- **Fresh run, not recovered** — unlike `1.6.0`, both product and judge steps were executed live by
  this session; no provenance gap.

## Predictions-vs-actuals

No lever-specific prediction was made for CEFR this session (no lever targeted this pool — this is
a measurement-only cycle per the task brief). The standing prediction was: **"flat, no
lever-driven movement"** (since `PLAN_VIZ.md`/`PLAN_CONVERSATION.md` Findings 3 and 5 don't reach
this pool, and no other commit in the window touches it).

| prediction | actual |
| --- | --- |
| Flat, no lever-driven movement (this session's own prediction, since no lever targets this pool) | **partially confirmed** — no case's behavior changed from anything in the 1.6.0→1.7.0 window's own new commits; the mean DID move (+0.040) and hard fails dropped (1→0), but both are traced to `1.6.1`'s already-shipped, already-measured fixes carrying forward, not to new movement. Read literally against "did 1.7.0's own code move anything": **confirmed, flat**. Read against the raw mean-vs-1.6.0 number: **up**, but for a reason predated by this cycle. |
| Finding 3/5's new code paths are unreachable by any of the 109 graded cases (this session's own grep-first check, run before writing this section) | **confirmed empirically** — zero matching phrasing for either finding's shape, one near-miss (`conv-what-can-you-do`) checked transcript-level and confirmed routed through the pre-existing orientation lane, not the new cascade. |
| `PLAN_VIZ.md`'s `codegraph.mjs` work has no CEFR-reachable call site (structural, from reading the plan doc) | **confirmed empirically** — zero references to any of its touched symbols in the pool, and `ask.mjs`/`chat.mjs`'s own import lists are disjoint from `codegraph.mjs`'s touched exports. |

## Per-lever analysis

N/A this cycle — no lever was applied. Per the skill's own §0 ("Do NOT use it for a one-off smoke,
a docs-only change… One cycle = one lever, so movement in the mean is attributable"), this is
explicitly the kind of cycle where per-lever attribution doesn't apply: the only substantive
product commit in the window (`9510a43`) is confirmed, by direct case-level check above, to land
outside this pool's reach.

## Decision log — ranked menu for the next cycle

1. **A rephrase-hint pass on "who touched X" / "what was the last change to X"-family honest
   misses.** Grounded in this cycle's actual judged data: `g-c1-temp-7`, `g-c1-temp-3`,
   `g-b1-pron-1`, `g-b1-pron-4`, `g-b1-pron-5`, `hm-unknown-fn`, `hm-unknown-module` all score
   `rephrase: 0` on both samples — every one of them is a correct, honest empty-result answer
   ("nothing in the index matches that.", "No modules found whose module directly touches X.")
   that gives the user zero nudge toward a question that WOULD work. This is a real, recurring
   pattern across 7+ cases spanning three grades (B1/C1), the single largest concentration of lost
   points in this run outside the two permanent/open items below. **Top pick for next cycle** —
   concrete, scoped (a handful of history/touches-family miss templates in `ask.mjs`), and
   evidenced directly by this cycle's own judge rationales (e.g. "it provides no hint about what
   alternative questions would succeed").
2. **`PLAN_CONVERSATION.md` Finding 4** — the anaphoric "SUBJECT verb which N" misroute into
   teach-a-fact, still the top `HANDOVER.md` open item. Not CEFR-specific, but `g-c2-pron-1`/
   `g-c2-pron-2`'s "which of them VERB" compositional-question failures (this run's two lowest
   scores after the permanent `g-a1-naming-9`) are adjacent in kind — both are "the follow-up
   filter didn't parse" misses on multi-clause anaphora. Worth checking whether a Finding-4 fix
   would also close these two specific CEFR cases as a side effect, the same cross-check `1.6.1`'s
   own cycle ran before starting new work.
3. **`g-a1-naming-9`** — confirmed once again this cycle to be a permanent, deliberate authoring
   conflict with `am-meta-imports` (byte-identical input, provably incompatible expectations). Not
   a future pick; nothing can move it without breaking its sibling case, per the regression rule.
4. **A dual-draw or full-pool run** before the next release — carried over from `1.6.0`'s own
   decision log, still not done. This cycle's own per-cell wobble (`C1 temporal` +0.158 on zero
   code change) is exactly the noise dual-draw's parallel-forms check exists to separate from real
   signal. Worth doing once item 1 above is applied, so the next cycle's movement is attributable
   rather than guessed at from a single N=2 draw.
5. **New CEFR case(s) modeled on Finding 5's now-shipped CapableOf/HasA/inherits reverse-query
   frames** — carried over from `1.6.0`'s decision log (there, the blocker was the not-yet-shipped
   ambiguity fix; the underlying capability gap has now moved to Finding 5, which IS shipped as of
   this cycle, so this item is no longer blocked). The current 109-case pool structurally cannot
   score this capability at all (confirmed above) since it never runs a default-persona/no-`--repo`
   case against the memory graph's fact vocabulary. A scope decision for a future cycle — would
   require deciding whether the graded pool should grow a new construction cell for
   "general-knowledge fact queries," not just adding cases to an existing one.

## Reproduce

```
node chatbench/run.mjs --stamp 1.7.0 --sample 1 --single
node chatbench/judge.mjs --product chatbench/results/raw/run-1.7.0/product.jsonl --samples 2 --concurrency 12 --out chatbench/results/raw/run-1.7.0
```

## Evidence / transcripts (discriminating first)

**1. `g-c2-pron-2` (C2 pronoun-binding) — this cycle's lowest score (0.625), a genuine compositional-parse miss:**
```
Q: Button inherits from Widget although it is defined in app/lib/b.mjs — which of them is
   defined in app/lib/b.mjs
A: couldn't compile this compositional question (the follow-up filter didn't parse).
   compositional queries also work: "which functions call X and call Y", "what calls something
   that imports X", "public methods of X", "list functions" / "show me the classes", "how many
   classes", "which module has the most imports", "find me the payment class", or (after a
   listing) "which of those are tested".
```
*What this demonstrates:* the question is genuinely answerable from the graph (Widget is defined
in `app/lib/b.mjs`), but tmct's compositional-question compiler can't handle this "SUBJECT VERB
although it is Y — which of them Y" shape and falls back to a generic capability list instead of a
targeted hint. Judge rationale (sample 2): *"tmct claims it couldn't compile an answerable question
… this is a fabricated limitation unsupported by the context."* A real, still-open gap (see Decision
log item 2), not new to this cycle.

**2. `g-c1-temp-8` (C1 temporal) — a correct-but-garbled honest miss:**
```
Q: who touched the module importing app/functions/d/handler.mjs
A: No — no imports edge found from touches to app/functions/d/handler.mjs.
```
*What this demonstrates:* the underlying fact is right (nothing imports that module) but the
rendered sentence inverts the relation direction in its own wording ("from touches to X" reads
backwards) and offers no rephrase hint. Judge rationale: *"the phrasing 'from touches to' garbles
the graph vocabulary, and the response offers no nudge toward an answerable alternative."* Directly
evidences Decision log item 1.

**3. `g-a1-naming-9` (A1 naming-vocabulary) — the permanent hard-fail-adjacent case, unchanged answer:**
```
Q: what does imports mean
A: this could mean more than one thing: 1) meta "imports" or 2) imports "mean" — try rephrasing
   more specifically.
```
*What this demonstrates:* byte-identical to `1.6.0`'s (and `1.5.7`'s) answer. Mean moved from
0.500 (`1.6.0`) to 0.875 this run purely on judge-sample noise — the honesty dimension landed 0.5
this time instead of 0, one sample's worth of scoring variance on a case both prior reports and
this one agree "sits right at the hard-fail cutoff and flips sides on noise alone." Confirmed via
`product.jsonl`: still routes through the same `ambiguousParse`/`metaFallbackEntityAnswer` path,
still deliberately unfixed because `am-meta-imports` wants the plain definition for the identical
input string.

**4. `am-tests-cover` (B1 svo-query/ambiguity) — clean 2/2, the `1.6.1` fix holding:**
```
Q: which tests cover b.mjs
A: "b.mjs" matches more than one module ambiguously — did you mean app/lib/b.mjs and
   app/unit-tests/b.test.mjs? Try one of those. If you're not sure, narrow it to one name.
```
*What this demonstrates:* the `1.6.1` fix (commit `bf87c6c`) is holding a full cycle later — honest
ambiguity flagged, both real candidates named, a concrete narrowing instruction. Judge rationale:
*"honestly refused to answer before disambiguation … offered both concrete alternatives and a clear
path forward."*

**5. `mt-focus-drift` (B1 discourse-reference) — a 3-turn focus chain, still clean:**
```
Q: /describe app/lib/a.mjs
A: app/lib/a.mjs — Module (id: mod-a); attestation: touched by 2 commit(s); attribute: dotted =
   app.lib.a; edges: defines → fnAlpha; cochange → app/lib/b.mjs, app/lib/c.mjs; ← imports by
   app/lib/b.mjs, app/lib/c.mjs, app/lib/e.mjs; ← calls by scripts/g.mjs; ← touches by abc1234;
   provenance: git:abc1234, git:def5678

Q: what calls it
A: scripts/g.mjs.

Q: which modules import it
A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.
```
*What this demonstrates:* focus threads correctly across three turns via the bare pronoun "it",
unchanged behavior from `1.6.0`/`1.5.7`.

**6. `mr-asked-before` (A2 assert-recall) — cross-session memory recall, still clean:**
```
Q: which modules import a.mjs
A: app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.

Q: what did i ask before
A: last time (session 019f5224, 2026-07-11) you asked: "which modules import a.mjs"
```
*What this demonstrates:* an explicit recall query correctly cites a real session id, real date,
and the verbatim prior question — grounded in the memory graph, not fabricated. (The session id
differs from prior reports' quoted examples because each run mints its own session — expected, not
a behavior change.)

**7. `tf-wat-calls` (B1 svo-query) — typo repair, still clean:**
```
Q: wat calls fnAlpha
A: in app/lib/b.mjs there is function Widget.render().
```
*What this demonstrates:* "wat" → "what" typo tolerance holding through a full graph-query answer,
unchanged from prior cycles.
