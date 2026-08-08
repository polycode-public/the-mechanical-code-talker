# PLAN_FILLER_AND_COUNTERFACTUALS.md — two design passes: filler-clause prefixes, planner counterfactuals

Status: item 1 BUILT (see below); item 2 BUILT (see below). Both items moved here from
`NEXT.md` (2026-07-22, operator instruction) because each needs a real design pass before any
diff is worth writing. Live evidence for both comes from the 2026-07-21 xl-graph probe session
(`.tmct/session-019f8692-430d-79f3-9ee2-c38792f56746.log`).

## 1. Filler-clause prefix widening — BUILT

`fillerClausePrefix`/`leadsInterrogative` (`src/domain/interpret/normalize.mjs`) peel a closed
interjection/hesitation/meta-announcement inventory ahead of a real question; `runTurn`
(`src/services/chat.mjs`) retries a filler-led miss once on the peeled remainder, and the three
write gates (teach lane, bare taxonomy teach, relaxed-teach collision) all read
`leadsInterrogative` so a filler-led question never reaches the write boundary as a declarative.
Pinned by `grammar.noise.filler-clause*` in `test/corpus/grammar.jsonl` and unit coverage in
`test/adapters/interpret.test.mjs`, `chat-teach-exclusion.test.mjs`, and the new
`chat-filler-clause-prefix.test.mjs`.

### The gap

A clause-shaped filler before a real question breaks parsing that works filler-free. Live at
2.9.6: "ok so what is a dog" parses (the short-prefix tier already strips it); "oh nice. um what
about cats" and "one more random thing, what is a horse" both fall to the parse miss. The 2.7.11
persona sweep traced several surface symptoms to this one root cause; the short-prefix fixes since
then closed the two-word tier only.

### Design directions

- **Closed-set clause templates first.** This repo prefers template libraries over general
  grammar rules for chat-layer fixes. Build a closed inventory of sentence-initial discourse
  markers and filler clauses — the pragmatics literature calls these discourse markers
  (Schiffrin 1987, *Discourse Markers*; Fraser 1999, "What are discourse markers?") — and match
  clause shapes from that inventory only: interjection + comment ("oh nice."), hesitation + pivot
  ("um what about"), meta-announcement ("one more random thing,", "quick question,").
- **Strip-and-retry, accepted only on double match.** A deterministic two-stage pass: when the
  whole line misses, strip a candidate filler prefix and re-run the ordinary dispatcher on the
  remainder. Accept the retry only when BOTH the stripped prefix matches the closed filler
  inventory AND the remainder grounds. No confidence scores; a failed retry keeps the original
  miss.
- **The write boundary is the hard guard.** Never accept a strip whose remainder would reach the
  teach lane — a misjudged filler must not become a stored fact. Interrogative-remainder-only is
  the safe first tier.

### Exit criteria

- The two live phrasings parse and answer identically to their filler-free forms.
- A counter-set of real-content lookalikes ("one more disk rests on peg-a.") stays untouched —
  pinned as negative rows.
- Corpus rows pin both sides in the `grammar.noise.*` lane; unit coverage in
  `test/adapters/interpret.test.mjs`.

## 2. Plan-justification counterfactuals — BUILT

Two new recognizer shapes in `planFollowUpAnswer` (`src/services/chat.mjs`), active only while a
plan slot is live: a hypothetical-start re-solve ("what if disk-1 started on peg-c instead?")
rebuilds the plan's own start board with one piece moved and re-runs the same BFS, and a
forced-alternative compare ("why did you move disk-1 first instead of disk-2?" / "why not move
disk-2 first?") forces the named alternative into the plan's own first move and compares the
re-searched cost, naming the violated precondition when the alternative has no legal first move.
Both are read-only — the held plan, cursor and move count survive the question unchanged. Pinned
by `planning.counterfactual.*` in `test/corpus/planning.jsonl` and unit coverage in
`test/adapters/chat-plan-counterfactuals.test.mjs`.

### The gap

Five independently phrased justification/counterfactual questions across three puzzle domains
wall ("why did you move disk-1 first instead of disk-2?", "what if disk-1 started on peg-c
instead?"), even though the planner prints its own unprompted "because —" line after every
solve. `src/services/chat.mjs`'s counterfactual note records the standing decision: the BFS computes no
untaken path. "Why is that the shortest solution?" and the optimality confirm already answer
from the solve-time reason; the counterfactual family is what remains.

### Design directions

Both directions stay $0, deterministic, and inside the honest-miss constitution: when a forced
alternative has no plan, the answer names the constraint that blocks it, never a guess.

- **Hypothetical re-solve ("what if …").** Parse the counterfactual premise into a modified
  start state, re-run the same `findActionPath` BFS from it, and present the result as a
  hypothetical ("from that start it takes N moves: …" / "no plan from that start within the
  bound"). Cost is one extra solve on demand; the general non-plan counterfactual wrapper
  (`COUNTERFACTUAL_RE` in `src/services/chat.mjs`) already demonstrates the
  "hypothetically, if X: …" answer framing over graph reads — this extends the idea to the plan
  slot.
- **Forced-alternative compare ("why A instead of B").** The explainable-planning literature
  names this contrastive explanation: answer "why A not B?" by solving with B forced (or A
  forbidden) and comparing outcome and cost against the found plan (Fox, Long & Magazzeni 2017,
  "Explainable Planning"; Miller 2019 on contrastive explanation; Krarup et al.'s contrastive
  plan explanations via model restriction). The rendered answer is a diff: "forcing disk-2
  first costs M moves against N — the found plan is shorter", or "forcing disk-2 first has no
  legal continuation: <the violated precondition>".

### Recognizers and wiring

- Two new plan-follow-up shapes in the `planFollowUpAnswer` cascade (the plan-shaped regex
  family around `chat.mjs:10600-10700`), active only while a plan slot is live: a
  "what if <entity> <state-verb> <place> (instead)?" hypothetical-start form and a
  "why did you <action> A (first) instead of B?" forced-alternative form.
- Both reuse the taught rule set and `findActionPath` untouched; the only new mechanism is
  building the modified start state / the forced first move, and rendering the comparison.

### Sequencing constraint

The hanoi-at-xl failure in `NEXT.md` (the goal quantifier suspected of sweeping corpus "disk"
members) lands first — a hypothetical re-solve inherits any scale defect in the base solve, so
building this on top of a failing base would measure the wrong thing.

### Exit criteria

- Both live phrasings answer from a real re-solve on the small taught boards; an impossible
  forced alternative names its violated precondition.
- Corpus rows pin the two shapes in the plan lane; unit coverage beside the existing plan
  follow-up tests.
