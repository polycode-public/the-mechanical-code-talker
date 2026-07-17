# BENCHMARK_CONVERSATION_2.5.0 — persona sweep, 6 frames, ~410 probes, ~30 dead-ends; the risk moved upstream, and one proof now ignores a stored disjointness

**Mode:** persona-sweep (§3.4, the default for one run). Six background sub-agents in parallel, each
seeded with a genuinely different frame: the textbook logician, the casual newcomer, the new
developer, the adversarial sceptic, the returning user with a stale mental model (**new this
round**), and the planning user. The returning-user frame was recommended by 2.0.3's own "Next"
section and did not run before now; it exists to reach 2.0.3 item 3's realistic trigger ("the old X",
"didn't you say Y").

**Headline: ~30 new dead-ends, of which 11 state or write something false. Ten of those eleven are
clean confident-wrong; one is soft (disclosed as ambiguous).** The story is the inverse of 2.0.3.
Every 2.0.3 headline defect is fixed, so the input-discard family that dominated last round is closed
at the top — but the risk moved one level in, from words dropped *before* the parser to a proof
emitted *after* it that never checked a fact the store already held.

- The **logician** found the sweep's worst result and the only proof-shaped one. Teach `rex is a
  dog`, `every dog is a cat`, and `no dog is a cat`, then ask `is rex a cat`, and tmct answers **yes,
  with a proof**, while the `dog owl:disjointWith cat` fact it just stored — the fact that denies the
  conclusion — is never consulted. This is a different code path from the direct disjointness query,
  which is correct (see the reconciliation note below).
- The **new developer** found that `blast radius of src/core/store.mjs`, the most natural impact
  phrase there is, is parsed as a teach and **written to the graph** as "noted — remembered: blast
  radiuses of src/core/store.mjs." A read-only question mutates memory and reports success.
- The **casual newcomer** found that `i wanna know about a horse` (and its whole family) is misrouted
  into the teach frame and answered with a pronoun-rejection lecture plus a wrong inferred goal
  ("Teach/remember a new fact"). The 2.0.3 Tier-0 blocker it replaces was an honest empty; this one
  asserts a wrong intent.

Set against that: the **sceptic**, whose entire brief was to force a role or polarity inversion,
**could not do it in 78 probes** (0 inversions, the 2.0.3 result held under a harder hit), and the
**planner** produced **no illegal "shortest" plan this cycle** — the 2.0.3 worst-class defect is
gone. The honest-miss machinery is in good order; most of what remains is routing and recognition
gaps to capabilities tmct already has, and one wiring gap in the proof path.

**This run measures and documents only.** Per `SKILL_BENCHMARK_CONVERSATION.md` §5 this skill never
edits `src/` or `test/`. Everything below is routed, not fixed.

## Timing

Date **2026-07-17 (CEST)**. The session ran as six parallel sub-agents, so the session start is the
first frame dispatched and the end is the last frame to report.

| interval | start | end |
|---|---|---|
| benchmarking session (the six parallel personas) | 22:01 | 22:09 |
| analysis (reading the six scratch files and writing this report) | 22:10 | 22:15 |

## Ladder position reached

**Tier 0 ratchets past the old item-4 wall, but it does not flow fully clean, so the ladder does not
advance past Tier 0.**

The specific 2.0.3 blocker is cleared. `tell me about a dog` now answers from the corpus in a seeded
graph-less session (`"dog" is not a code-map entity — answering from memory/corpus facts. is a:
animal`), and bare `dog` answers too. The single dead-end that pinned the ladder at Tier 0 is gone,
and the canonical example ratchets.

But a fresh confident-wrong cluster now occupies the blocking position, and it is a worse class than
the one it replaces. A family of casual vocabulary openers — `i wanna know about a horse`, `i want to
know about a horse`, `i would like to know about a horse`, `you tell me about dog`, `let me know
about a dog` — is misrouted into the teach frame and answered with a pronoun lecture and a wrong
inferred goal. The 2.0.3 blocker was an honest (if useless) miss; this asserts a false intent. Per
§2.1 a tier only unlocks when the tier below is dead-end-free, and a confident-wrong at Tier 0 is by
definition not dead-end-free. So the ladder confirms Tier 0's greeting and vocabulary surface is much
improved, holds at **Tier 0**, and will move once the teach-misroute family and the `tell me
something about X` / `let me know about X` phrasing misses route out.

## A note on the two disjointness paths (reconciled across frames)

Two frames touched disjointness and reached opposite-looking results. They are not in conflict —
they exercise different code paths, and the report states both exactly:

- **Direct disjointness query is correct.** The sceptic and the logician both confirmed that after
  `no cat is a dog`, the direct asks `is a cat a dog` and `is a dog a cat` both answer **no** with a
  receipt. The class-level disjointness lookup works in both directions. This is the 2.0.3
  "disjointness stored but not consulted" gap, now closed for the direct query.
- **The multi-hop proof path does not check disjointness.** The logician's worst find is a *derived*
  conclusion: `rex is a dog` + `every dog is a cat` proves `is rex a cat` → **yes with a proof**,
  even though `dog owl:disjointWith cat` is stored at the same time. The subclass prover walks the
  chain and emits a proof without querying `owl:disjointWith` on the resolved chain, which the
  negative direct-ask path already does. So the derived-conclusion proof path fails to validate
  against the stored disjointness the direct path honours.

This is the sweep's worst confident-wrong precisely because it is proof-shaped: a proof is tmct's
strongest honesty claim, and here it certifies a flat inconsistency (dog ⊑ cat ∧ dog ⊓ cat = ⊥).

## Per-persona breakdown

Ranked by §3.4's rule — findings more than one frame hit independently rank first.

### Hit by multiple frames independently

- **Every 2.0.3 headline defect (5 frames confirm).** The two-line Hanoi plan, the existential-as-
  universal proof, the what-would-break→people answer, the residue drop, disjointness-not-consulted,
  the restricted-count total, the fronted-agent passive inverse, and the tell-me-about-a-dog empty
  were each re-run and each fixed. See the closed table below.
- **The unknown-token residue guard (3 frames: new developer, sceptic, returning user).** All three
  confirmed the 2.0.3 crown-jewel is fixed on the single-candidate path: `what imports the deprecated
  legacy model.mjs` now declines, names "deprecated" and "legacy", and suggests `src/core/model.mjs`.
  The returning user then found the multi-candidate half of the same family is not covered (Finding A
  below).
- **Impact surface keyed too narrowly (new developer, reinforced by the planner's `where does X`
  misroute).** The impact closure is correct but reachable by essentially one phrasing; near-synonyms
  fall into the wrong frame. The planner's board-read `where does disk-1 rest?` is the same shape in a
  different domain — a natural question routed into the code-graph frame.

### The textbook logician — ~105 utterances across ~30 scenarios, 1 confident-wrong, 5 honest misses

Stance: syllogisms, quantifiers, negation, converse and undistributed-middle traps, transitivity,
disjointness, and whether any emitted proof is sound. Goal: make it assert a falsehood with a proof.

Re-confirmed fixed from 2.0.3: `some men are fathers` (and `most/many/several/a few`) now refuse with
an existential message and no downstream false proof; `every man is a father` still teaches and
proves; `john is not a man` now stores both facts and reports the disagreement instead of retracting;
ask-side quantifiers (`is every man mortal`, `are all men mortal`) answer yes correctly; capability
polarity (`penguin cannot fly` overriding `bird can fly`) fires a firm no with the override named.
Every fallacy trap tried was handled: affirming the consequent, undistributed middle, illicit
converse, asymmetric relations, and vacuous universals all miss or refuse correctly.

New: the **disjointness-vs-subclass proof** confident-wrong (above), which reproduces in all three
teach orderings and also through inheritance (`no animal is a plant` / `every dog is an animal` /
`every dog is a plant` → `is a dog a plant` → yes). Five honest misses logged: reflexivity absent
(`is a dog a dog` → miss); disjointness not propagated to instances on the negative side (`felix is a
cat` / `no cat is a dog` / `is felix a dog` → miss, though the class form answers no); universal
conditional rules not learned (`if something is a dog then it is a pet`); a converse-ask parse gap
(`is a mammal a dog` → parse wall); and a property-inheritance ask unrouted (`does rex have fur` →
misparsed as `does rex define fur`).

### The casual newcomer — ~70 probes across six batches, 2 confident-wrong, 6 honest misses (+3 minor)

Stance: the loose typist — articles, small talk, vague vocabulary questions, typos, discourse
fillers, politeness wrappers, ESL word-order slips.

Re-confirmed fixed from 2.0.3: `tell me about a dog` answers from corpus (the Tier-0 blocker, item 4);
`how many facts about horses are there` returns the restricted 3, not the total 664; `count the
classes about tasks` declines with a reason instead of silently returning the total; anaphora
survives a preceding miss (item 10, `can it bark` now answers after an unparsed turn); `what else` /
`why` give the expansion-family guiding decline instead of the identity blurb (item 15).

New confident-wrong: the **`i wanna know about a horse` teach-misroute family** (the new Tier-0
blocker, above) and **`what have you got`** parsed as a `defines`/reverse query on the token "got",
confidently reporting no module named "got" in a structure session. Six honest misses: `tell me
something about X` walls while `tell me about X` works; capability questions break under any wrapper
(`what can you do for me`, `so uh what can you do then`); natural "more" follow-ups wall (`what else
can dogs do`, `anything else about dogs`, continuation `and a cat`); `tell me about this repo` walls
while `whats in here` works; `what animals do you know` / `list the animals you know` wall while
`whats an animal` enumerates; and the `i wonder what a dog is` modal frame walls while `do you know
what a dog is` works. Minor, noted not chased: `teh dog` typo → blurb; `hows it going` → blurb; `ok
cool thanks` / `cheers thanks` → blurb (bare `thanks`/`bye` are clean, per the farewell discipline).

### The new developer — 64 probes (2 re-confirm + 62 fresh) across six batches, 6 confident-wrong, 1 honest-miss cluster (+4 minor)

Stance: onboarding to a codebase — what imports X, what calls X, what would break, what depends on X,
impact / blast radius. Goal: elicit a confidently-wrong structural answer. Ran against a tmpdir copy
of `examples/mini-webapp`.

Re-confirmed fixed from 2.0.3: `what would break if I change X` routes to the impact closure (3
dependents across 2 depth levels, per-module test coverage, **no commit authors**) — verified on
store.mjs, model.mjs, validate.mjs, saveStore, Task; the deprecated/legacy residue declines and names
the unknown words; bare module paths orient; `what talks to X` maps to `uses`; the untested surface
now returns the same 7 as `/untested`.

New — six confident-wrong, ranked worst-first: (1) **`blast radius of X`** ingested as a teach fact
and remembered (a read-only question that mutates state); (2) **`impact of X`** silently fuzzy-matched
to `import of X` and answered as depth-1 importers, announcing the misread but answering confidently
as the blast radius; (3) **`what would break if I change saveStore`** claims "no dependents found —
nothing imports or calls it" while `what calls saveStore` correctly reports `createTask` — two
surfaces disagree about the same function; (4) **`what functions are in X`** / `what does X contain` /
`methods of X` route to the `contains` predicate and report "no contains edges," which reads as "it
has none" though `what functions does X define` returns them; (5) **`what uses the Store class`** →
"No classes found whose module directly uses Store" because "class" narrowed the result-type filter;
(6) **`which modules have no tests`** → "No modules found ... defines no tests" because "no tests" was
parsed as a literal object. One honest-miss cluster: the impact closure is keyed to the exact
template `what would break if I change X`, and every paraphrase (`if I change store.mjs what breaks`,
`what happens if I change X`, `what breaks if I remove X`, `can I safely delete X`, `what is affected
by changing X`) falls to the touches misparser or the grammar wall. Four minor honest items: `how do
the handlers connect to the core` (bare wall), `what would I touch to add a new handler` (misparse),
`what do the handlers import` (partial, "handlers" is a package), `what is the entry point` (honest
miss, not modeled).

### The adversarial sceptic — 78 probes, 0 role/polarity inversions, 0 confident-wrong, 3 honest misses

Stance: force a role or polarity inversion on any relation — active vs passive, forward vs reverse,
negation, the converse trap. Goal: make the honest-miss machinery answer the inverse of what was
asked. Ran against a `mktemp` copy of `examples/mini-webapp` and fresh `init` stores, with ground
truth extracted from the copy's graph before probing.

The 2.0.3 result (0 inversions in 55 probes) held at 2.5.0 under a harder hit (78 probes, 0
inversions). Every direction-sensitive pair resolved to the correct canonical shape, including the
sharpest class — passive yes/no with a named agent (`is model.mjs imported by store.mjs` → Yes;
`is store.mjs imported by model.mjs` → No, does not invert). Re-confirmed fixed from 2.0.3: the
fronted-agent passive inverse (`by which modules is X imported` now reads as the importers); the
residue drop; the existential-as-universal proof; negation-as-retraction; and disjointness consulted
both directions on the direct query.

New — all honest misses, 0 confident-wrong: a non-holding converse of a known subclass hits the
grammar parse wall instead of a clean "can't confirm" (`is Record a Task`, `is an animal a dog`); the
same for the quantified converse `is every mortal a man` (the forward `is every man mortal` now
answers yes with proof); and an ungrounded capability ask (`do penguins fly` → identity blurb, a
minor misroute, no wrong answer since penguin is ungrounded). None is a role or polarity inversion or
a false statement.

### The returning user with a stale mental model — ~55 probes, 1 soft confident-wrong, 2 honest misses (NEW frame)

Stance (new this round): a user whose beliefs are out of date — "the old X", "the deprecated legacy
model.mjs", "the renamed X", the module "we split up", and references to prior turns that never
happened ("didn't you say...", "as we discussed", "continue from where we left off"). The quarry:
turns that silently answer about a different entity than named, or fabricate continuity.

Confirmed: item 1.4 (the stale-modifier drop) is fixed on the **single-candidate** resolution path
and generalizes across verbs (`imports`, `calls`, `depends on`, `where defined`) — each declines,
names the unrecognized words, and suggests the real module. No fabricated continuity anywhere: every
"didn't you say..." / "the thing from before" landed on an honest miss or wall, none invented a prior
turn. The anaphora-across-a-miss invariant holds: a miss does not lend its subject to the next
pronoun.

New — Finding A, the **soft confident-wrong** and the closest thing in the sweep to answering about a
different entity than named: the **multi-candidate fuzzy tier** still enumerates full answers for ~5
modules on a stale or non-existent name. `what imports the deprecated legacy cache.mjs` (cache.mjs
does not exist) matches five real modules and answers each in full under an ambiguity disclosure; the
word "cache" appears in none of the five. `what imports the old store.mjs` behaves the same. It is
**soft** because the "matches more than one module ambiguously" line and the numbered framing disclose
it — not a silent lie — but it is the multi-candidate half of the 1.4 family, left untouched by the
single-candidate fix, and it never names the stale modifier the way the single-candidate path does.
Two honest misses: `what does the old X do` (module-orient lane) and `what is the old X` both miss the
modifier-naming decline the `imports`/`calls` lane now gives, and fall to the bare grammar/vocabulary
wall.

### The planning user — ~38 probes, 1 confident-wrong, plus soft/observation findings

Stance: teach a Towers-of-Hanoi domain (`data/games/hanoi-3.txt`), state a board, set a goal, ask
tmct to plan (`solve it`, `next`, `what moves are legal now`, `is disk-1 clear`), and hunt for a
plan that is wrong, illegal, or a "shortest" plan that isn't.

Re-confirmed fixed from 2.0.3: the **two-line board** now sentence-splits the teach-only line into 3
facts and solves in **7 legal moves (shortest)**, byte-identical to the README canonical plan — the
2.0.3 worst-class illegal "3 moves (shortest)" defect is gone; imperative goals (`get all the disks
onto peg-c`, `put all the disks on peg-c`, `i want every disk on peg-c`) register and solve; `solve
the towers of hanoi` is improved to a guiding decline (no auto-goal); the hanoi-3.txt recipe drives
clean across variations (3-disk = 7, partial = 4, 4-disk with all pairs = 15); `next` then `what
rests on disk-2` reads the advanced board; the plan follow-ups (`what is the next move`, `how many
moves`, `why that move`) answer from the plan; `is disk-1 clear?` is derived from the board.

New confident-wrong: **`where does disk-1 rest?`** misroutes to the code-graph definition-locator and
emits a code `Canonical: where is "disk-1 rest" defined?` — a board question routed into the code
frame, and README-advertised (lines 362–363) as a board read-back. Same misroute hits `where is every
disk`. The rest are softer: the goal frame is narrower than natural phrasing (`stack all disks on
peg-c`, `the goal is all disks on peg-c`, and the `A and B` conjunction all wall — honest misses); an
under-specified board (only disk-1 placed) yields a confident "shortest" plan over assumed positions
with no flag (the plan is internally legal and reaches the goal, so a milder soft form of the 2.0.3
silent gap-fill family, not an illegal plan); a contradictory board is silently reconciled into a
legal "shortest" plan (observation, not a defect); and unknown-peg / phantom-disk goals burn the
300-move search instead of declining by name.

## What 2.0.3 found, now closed

Every 2.0.3 headline finding, re-run this round and confirmed fixed. This is the "the risk moved
upstream" story: the input-discard family that produced 2.0.3's three worst findings is closed.

| 2.0.3 finding | 2.0.3 behaviour | 2.5.0 behaviour | frame(s) re-ran it |
|---|---|---|---|
| Two-line Hanoi board → "3 moves (shortest)", move 1 illegal, goal never reached | phantom-board plan | splits the teach-only line, solves in 7 legal moves (shortest), README-identical | planner |
| `some men are fathers` → `is john a father` → yes with proof | existential stored as universal, proved | refused ("I store universals..."); no downstream proof | logician, sceptic |
| `what would break if I change X` → three people (git blame) | residue matched `touches` | impact closure, 3 dependents, test coverage, no authors | new developer |
| `tell me about a dog` → "the graph is empty" (Tier-0 blocker) | corpus never consulted | answers from corpus (`is a: animal`); bare `dog` too | casual newcomer |
| `what imports the deprecated legacy model.mjs` → answers about model.mjs | unknown residue dropped | declines, names "deprecated"/"legacy", suggests model.mjs | new dev, sceptic, returning user |
| Fronted-agent passive `by which modules is X imported` → the inverse | answered what X imports | correct reverse (the importers) | sceptic |
| `how many facts about horses` → 664 (unrestricted total) | restrictor ignored | `3 facts. (about "horses")` | casual newcomer |
| `john is not a man` → `noted — forgotten` (info destroyed) | negative executed as retraction | stores both, reports the disagreement | logician, sceptic |
| `is every man mortal` → "I don't know 'every man'" | ask-side quantifier glued as entity | answers yes with proof | logician, sceptic |
| disjointness stored but not consulted (`is a cat a dog`) | honest miss, no firm no | firm no with receipt, both directions (direct query) | logician, sceptic |
| `show me the untested modules` (9) vs `/untested` (7) | NL route lacked the source filter | both return the same 7 | new developer |
| `count the classes about tasks` → silent total | restrictor dropped | declines with a reason | casual newcomer |
| `get all the disks onto peg-c` / `solve the towers of hanoi` → swallowed as fact | goal frame too narrow | registers and solves; `solve the towers...` gives a guiding decline | planner |
| `next` then `what rests on disk-2` → stale board | read-back served pre-plan board | reads the advanced board | planner |
| `what is the next move` / `how many moves` / `why that move` → code-graph replies | plan follow-ups unrouted | answer from the plan | planner |
| `is disk-1 clear?` at step 0 → "I don't have a fact..." | clearness not derived | derived from the board | planner |
| hanoi-3.txt 4-disk recipe → "no plan found" | doc promised 15, delivered none | recipe drives clean; doc explains non-transitive pairs | planner |
| `what is a dog` → `go back to dogs` → `can it bark` → "not sure what 'it' refers to" | miss cleared the referent | binding survives the miss; `can it bark` answers | casual newcomer |

## Routed backlog

Every new dead-end, one row. Confident-wrong first (a false or misleading answer stated with no
hedge, or a read-only query that mutates state), then the soft case, then honest misses. All routed
to `HANDOVER.md`.

| # | Verbatim input | What it did | Class | Diagnosis | Route |
|---|---|---|---|---|---|
| 1 | `rex is a dog` / `every dog is a cat` / `no dog is a cat` / `is rex a cat` | **yes, with a proof** — walks the subclass chain, never mentions the stored `dog owl:disjointWith cat` | CONFIDENT-WRONG (proof-shaped, worst) | the subclass prover does not query `owl:disjointWith` on the resolved chain; teach stores subclass + disjoint for the same pair with no consistency check. The direct disjointness ask already validates | HANDOVER |
| 2 | `blast radius of src/core/store.mjs` | `noted — remembered: blast radiuses of src/core/store.mjs` [Goal: Teach a fact] | CONFIDENT-WRONG + state mutation | the teach classifier swallows `blast radius of <path>`; should route to the impact closure `what would break` reaches, or decline — never remember an interrogative | HANDOVER |
| 3 | `impact of src/core/store.mjs` | `read as "import of src/core/store.mjs"` — depth-1 importers, answered as the blast radius | CONFIDENT-WRONG (misread) | "impact" fuzzy-collapses to "import"; must route to the impact closure | HANDOVER |
| 4 | `what would break if I change saveStore` | "no dependents found — nothing imports or calls it" while `what calls saveStore` reports `createTask` | CONFIDENT-WRONG (inconsistency) | the impact closure follows `calls` but not the function inbound-call edge that `what calls` resolves; the two must agree | HANDOVER |
| 5 | `what functions are in store.mjs` / `what does store.mjs contain` / `methods of TaskController` | "no contains edges in the index" — reads as "it has none" though `defines` holds them | CONFIDENT-WRONG (misleading none) | members-of-X should consult `defines` scoped to Function/Method, not only `contains` (SKILL §1 names this equivalence) | HANDOVER |
| 6 | `what uses the Store class` | "No classes found whose module directly uses Store" | CONFIDENT-WRONG | "class" narrowed the result-type filter; the type word describes the subject, not the answer type | HANDOVER |
| 7 | `which modules have no tests` | "No modules found whose module directly defines no tests" | CONFIDENT-WRONG | "no tests" parsed as a literal object of `defines`; route to the untested-coverage query `/untested` uses | HANDOVER |
| 8 | `i wanna know about a horse` (+ `i want to know about a horse`, `i would like to know about a horse`, `you tell me about dog`, `let me know about a dog`) | pronoun-rejection lecture + `Goal (inferred): Teach/remember a new fact` | CONFIDENT-WRONG (wrong lane + wrong goal, Tier-0) | the leading first-person desire frame is not stripped before the teach detector runs; extend the pre-parse stripper to peel these down to `what is X` | HANDOVER |
| 9 | `what have you got` | "no module matching 'got' found" + `Goal (inferred): Locate what a module defines` | CONFIDENT-WRONG (misroute) | residue after stripping fell into the `defines`/reverse frame; `whats in here` / `what is this` give the right overview | HANDOVER |
| 10 | `where does disk-1 rest?` (planning board loaded) | "no module matching 'disk-1 rest'..." + code `Canonical: where is "disk-1 rest" defined?` | CONFIDENT-WRONG (shape; README-advertised) | the `where does/is <x>` frame is bound to the code-locator and never reads the board; add a board-read branch when a planning board is loaded, before the code fallback. Same misroute on `where is every disk` | HANDOVER |
| 11 | `what imports the deprecated legacy cache.mjs` / `what imports the old store.mjs` | enumerates full answers for ~5 modules (incl. name-unrelated and non-existent), under an ambiguity disclosure | SOFT confident-wrong (multi-candidate half of 1.4) | the fuzzy candidate set is too loose and the ambiguity handler answers all readings; the 1.4 residue guard should fire here and name the stale modifier | HANDOVER |
| 12 | paraphrases of `what would break if I change X` (`if I change store.mjs what breaks`, `what happens if I change X`, `what breaks if I remove X`, `can I safely delete X`, `what is affected by changing X`) | touches misparse or grammar wall | honest miss (cluster) | widen impact-intent recognition (change/edit/modify/delete/remove + break/affect/happen, either clause order) ahead of the touches fallback | HANDOVER |
| 13 | `tell me something about a cat` | grammar wall (while `tell me about a cat` works) | honest miss | the `tell me about` route doesn't tolerate the `something` filler token | HANDOVER |
| 14 | `what can you do for me` / `so uh what can you do then` | grammar wall (while `what can you do` works) | honest miss | the capability-intent matcher is anchored too tightly; survive leading/trailing filler | HANDOVER |
| 15 | `what else can dogs do` / `anything else about dogs` / `and a cat` | grammar wall / blurb | honest miss | route into the expansion/anaphora path `tell me more` and `what about X` already use | HANDOVER |
| 16 | `tell me about this repo` | grammar wall (while `whats in here` / `what is this` work) | honest miss | map `tell me about (this) repo` onto the overview handler | HANDOVER |
| 17 | `what animals do you know` / `list the animals you know` | grammar wall (while `whats an animal` enumerates) | honest miss | route "what/which X do you know" and "list the X you know" onto the subclass-enumeration | HANDOVER |
| 18 | `i wonder what a dog is` | grammar wall (while `do you know what a dog is` works) | honest miss | strip the `i wonder / i was wondering` frame the way `do you know what X is` is handled | HANDOVER |
| 19 | `is a dog a dog` (reflexive) | honest miss ("nothing I remember says dog is a dog") | honest miss | reflexive subsumption not derived; a logician treats it as trivially true | HANDOVER |
| 20 | `felix is a cat` / `no cat is a dog` / `is felix a dog` | honest miss (while class form `is a cat a dog` answers no) | honest miss | disjointness not propagated to the instance form on the negative side | HANDOVER |
| 21 | `if something is a dog then it is a pet` / `is rex a pet` | stores nothing usable, miss | honest miss | universal conditional rule is not a supported teach shape | HANDOVER |
| 22 | `is a mammal a dog` / `is Record a Task` / `is every mortal a man` (non-holding, non-disjoint converse) | grammar parse wall (never affirms the converse) | honest miss | the `is <known> a <known>` shape falls through to the parse wall when no edge and no disjointness resolves; a guiding nudge would beat the bare wall | HANDOVER |
| 23 | `does rex have fur` (after `every dog has fur` / `rex is a dog`) | "couldn't resolve one of the terms" (misparsed as `does rex define fur`) | honest miss | property-inheritance ask unrouted | HANDOVER |
| 24 | `do penguins fly` (penguin ungrounded) | identity/help blurb | honest miss (minor) | ungrounded capability ask misroutes to the identity blurb | HANDOVER |
| 25 | `what does the old router.mjs do` / `whats the old router.mjs for` | bare grammar wall | honest miss (inconsistent with the 1.4-fixed lane) | the module-orient lane doesn't strip or name the stale modifier the `imports`/`calls` lane now does | HANDOVER |
| 26 | `what is the old store.mjs` / `what is the new model.mjs` | "isn't a term in this graph's vocabulary" | honest miss (inconsistent) | `what is the old <module>` misses the module-overview lane that bare `what is <module>` reaches | HANDOVER |
| 27 | `stack all disks on peg-c` / `the goal is all disks on peg-c` / `the goal is that disk-1 rests on peg-b and disk-3 rests on peg-c` | grammar wall, then `no goal set yet` | honest miss | widen the goal-frame recogniser (`the goal is <NP>`, `<all/every> disks ... on <peg>`, `A and B` conjunction) | HANDOVER |
| 28 | teach only `disk-1 rests on peg-a`, goal all-on-peg-c, `solve it` | confident "3 moves (shortest)" over assumed positions, no flag (plan is legal, reaches goal) | soft (silent gap-fill family, milder than 2.0.3) | when disks referenced by rules/goal have no position fact, note the assumption rather than planning silently | HANDOVER |
| 29 | `the goal is that every disk rests on peg-z` / `... disk-9 rests on peg-c` (unknown token) | `no plan found within 300 moves` (burns the search, no named gap) | honest miss (weak decline) | validate goal tokens against taught pegs/disks and decline by name before searching | HANDOVER |

Observation, not routed as a defect: a contradictory board (`disk-1 rests on disk-2` and `disk-1
rests on peg-b` together) is silently reconciled into a legal "shortest" plan — the plan is legal and
reaches the goal, so it is milder than an illegal plan; contradictory input is not flagged, only
reconciled. Minor casual items noted not chased: `teh dog` typo → blurb, `hows it going` → blurb,
`ok cool thanks` / `cheers thanks` → blurb.

## Next

**The dead-end class that most needs attention has moved from before the parser to after it.** In
2.0.3 the worst findings were words dropped before parsing; every one of those is fixed. The single
worst find this round (item 1) is downstream of the parser: a proof is emitted over a chain the
reasoner resolved correctly, but without consulting a disjointness fact the store already holds and
the direct-ask path already checks. It is the only proof-shaped confident-wrong in the sweep, and it
should go first — the negation path and the capability-polarity path both surface this class of
conflict, so the contradiction-surfacing capability exists and is simply not wired into the
subclass-vs-disjoint case.

**Second is the impact/teach surface (items 2–5).** The impact closure is correct but reachable by
one phrasing, and the nearest natural phrases either mutate memory (`blast radius`), fuzzy-collapse to
`import`, contradict the call graph, or report a misleading "none." These are routing and edge-
coverage gaps to a capability that already exists.

**Third is the Tier-0 teach-misroute (item 8).** It is what holds the ladder at Tier 0, and it is the
most natural way a newcomer opens a vocabulary question. Clearing the first-person desire frame plus
the `tell me something about X` / `let me know about X` phrasing misses is what lets the ladder move
past Tier 0, where Tiers 1–6 mostly flowed under the sweep.

**Recommended next run:** re-sweep the same six frames once items 1–10 land. The returning-user frame
earned its place — it produced the only multi-candidate 1.4 finding and confirmed no fabricated
continuity — so keep it in the standing rotation.

The ladder stays at **Tier 0** until the teach-misroute family (item 8) and its phrasing siblings
(items 13–18) route out. Tier 0's greeting and vocabulary surface is clean; the ratchet should move
quickly once the vocabulary-lane routing is settled.
