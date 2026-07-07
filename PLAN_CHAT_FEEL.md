# PLAN_CHAT_FEEL — ranked next steps for chat feel + agent capability (post-0.8.1)

> **STATUS (annotated 2026-07-08):** items **1–5, 7–12 ✅ delivered in 0.8.2**
> (merge named per item below; deterministic gate 334/334 + 285/285, zero regressions;
> confirmation playtest greenlit the wave). Item **6 → mostly ✅ shipped this session**:
> pronoun/focus binding **fully cleared** (B1 census 34/50 → 50/50, 0 frontier — root cause was
> `isConversational()` discarding an already-parsed structural query, not the earlier "it→Commit"
> mis-bind); discourse-count **confirmed already green** (25/25, no fix needed); temporal
> **partially cleared** (cochange sub-cluster: B1 45/50→48/50, C1 41/50→44/50 — 8 of 14 red ids
> remain, each a distinct small grammar gap, documented in `HANDOVER.md`). Also surfaced a live,
> un-flagged regression outside this item's scope: `C1:presupposition` (11/25) and
> `C2:garden-path` (12/25) show real hard fails not marked `baselineFail` — worth a look next
> tick. Original text kept
> verbatim below the markers.

Written 2026-07-06 from a 4-source sweep: `ROADMAP.md` (Track 1 + Next), `CHATBENCH_0.8.1.md`
(+ `_TRANSCRIPTS`), `AGENTBENCH_0.8.1_002.md`, and a **live lightweight playtest** (7 CLI sessions
against `examples/mini-webapp`, method borrowed loosely from `SKILL_CHAT_PLAYTEST.md` — no full
ceremony). Playtest evidence is quoted below; the ranking follows it.

Guardrails for everything here: deterministic tier-1 (333/333) stays green; any lever that changes
answer *text* on a judged surface re-judges the touched tags only (see HANDOVER bench-reuse map);
no LLM in the product path; AGENTBENCH re-runs are free (deterministic).

## Ranked plan

Value axis: **feel** = natural chat feel, **agent** = router/agent capability.

### 1. Recall hygiene — stop memorizing failures, tighten recall matching (feel; small)
> ✅ **delivered 0.8.2** — feel #3 merge `058fd7f` (never store walls, path-token noise can't fake
> a match, fold re-clean heals poisoned stores). Confirmed by playtest (recall poison dead);
> residual edge — half-match replay once memory fills, ~20% of old severity — noted in HANDOVER #2.
Playtest's worst finding, invisible to CHATBENCH: wall/miss replies are stored and replayed as
"you asked about this before" recalls, on loose matches (verb and file both wrong), and even
*nested* (a recall-of-a-recall-of-a-wall opened session 6). Fix: (a) never store a miss/wall/refuse
reply as a recallable answer; (b) recall only fires when predicate + entity both match; (c) never
prepend a recall to a reply that is itself a miss. Highest value-per-effort in the whole list.

### 2. Preamble/politeness stripping before parse (feel + agent; small)
> ✅ **delivered 0.8.2** — feel #2 merge `bca0f69` (preamble/politeness frames in normalizeQuery —
> fires on chat spine AND router front-end — + determiner-insensitive merge). Confirmed by playtest.
"hey there, quick question - which modules import X?" and "can you show me X please" wall while the
bare forms answer. Strip greeting/politeness/preamble/trailing-`?` frames before routing (chat spine
*and* router front-end — this widens NL reach for free). Also swallow the article: "what about the
logger" currently asks the user to disambiguate "the logger" vs "logger".

### 3. Relation self-consistency — calls ∪ callsSymbol, vocabulary knows its own classes (feel; small-med)
> ✅ **delivered 0.8.2** — feel #1 merge `20b2b2d` (call union, Function↔Method grain fallback,
> Class-individual meta fallback) + the has-tests rewrite in feel #2 `bca0f69`. **Did clear the
> standing hard-fail** `gq-functions-call-fnalpha` (annotated `improvedIn:"0.8.2"`). Confirmed by
> playtest; residual function-grain coverage contradiction noted in HANDOVER #2.
Three self-contradictions: "what calls saveStore" answers via `callsSymbol` but "what does
createTask call" reports "no calls edges" (`calls` only); "what is a Record" denies a class the bot
itself lists (vocab lookup misses Class individuals); "does it have tests" emits a wrong-relation
receipt ("no defines edge from createTask to 0a1b2c3d4e5f" — a commit hash). Union the two call
relations on call questions, include classes in the vocab lookup, route has-tests to the coverage
capability. **Also clears the only CHATBENCH hard-fail** (`gq-functions-call-fnalpha`, all-dims-0
since cycle 1).

### 4. Author→commit querying (feel; med) — HANDOVER follow-up #1, confirmed live
> ✅ **delivered 0.8.2** — feel #4 merge `878dd0e` (author lane: who is <author> / what did they
> touch / who authored <sha>; flips g-c1-temp-24/-25 — the commit-authorship phrasing now names
> Ada Lovelace, 0.8.1's decision-log lever #2).
The bot volunteers "(Grace Hopper)" in touch-sets, then walls on "who is Grace Hopper" and misparses
"what did Grace Hopper touch" as a module lookup. Route person-name subjects to an
author→commits→touched traversal in `src/ask.mjs` (or minimally: graph-aware nudge in the miss
renderer). CHATBENCH's own lever list adds: "who is the author of <commit>" should *name* the author
(fixture has it), not dump the touch-set.

### 5. Wall-render kindness (feel; small, wide surface)
> ✅ **delivered 0.8.2** — feel #4 merge `878dd0e` (repeat suppression, graph-derived examples,
> "what does the app do" overview, riskiest-file nudge); receipt tails prose→detail rode feel #1
> `20b2b2d` (recoverable via "why"). Residual: orientation blurb repeat-shortening only on the
> parse-wall route (HANDOVER #2).
The ~120-word grammar dump repeats verbatim as the default wall (5× in one session); specific misses
get baffling generic hints ("is this code any good" → `is a <thing> a <kind>`); honest-empties still
ship the `(traversal: … edges where object = …)` debug tail; coverage-miss leaks the user's verb
("No tests cover **touch** app/lib/f.mjs"); the "what can you do" examples cite tmct's own repo
symbols, not the loaded graph; "what does the app do" — the most likely stranger opener — walls
instead of getting the "what is this project" overview. One sweep over the miss/empty renderers:
short tailored nudge first, full shapes only in /help, canonical verb in coverage renders,
graph-derived examples, app-overview route.

### 6. ROADMAP Track 1 trio (feel + agent; the big rock)
> ⏳ **post-release** — deferred with MEASURED targets (advisor tick-4 full-pool dry-run): pronoun
> red set = 18 g-b1-pron ids (1,4,5,7,12,13,16,18,20,21,22,28,30,33,35,36,48,50); temporal =
> g-b1-temp ×5 (7,31,44,46,49) + g-c1-temp ×9 (10,12,23,28,29,33,39,47,48 — 24/25 already flipped
> by the author lane); **re-measure g-b1-disc-count full-25 first** (sampled 0/5 red — likely
> already green; redirect budget to pronoun reds). HANDOVER follow-up #3.
Pronoun/focus binding (B1 pron 1.24 — "biggest movable mass"), discourse-count anaphora ("count
them" — clears 2 standing tier-1 misses), C1 temporal-over-relative composition (0.31 ceiling).
ROADMAP: "Land all three (not just #1); they raise the chat floor *and* the router's floor at once"
— they gate the A2→B1→C1 router rungs, and cross-turn anaphora slot-filling is one of
AGENTBENCH_0.8.1_002's two named frontiers. Ladder rule applies: this is what makes B1 reliable
before paying to judge C-grades.

### 7. Teach-lane widening (feel; med)
> ✅ **delivered 0.8.2** — feel #3 merge `058fd7f` (remember-that property + ownership frames,
> `teach:` source with 0.95 trust prior, taught-class↔graph-`inherits` bridge). Confirmed by
> playtest (bridge + ownership both land); ACE stays product-inert, exactly as gated here.
Sanctioned ACE teach ("every controller is a handler") is lovely — source receipts build trust. But
natural forms miss it entirely ("remember that saveStore is deprecated", "Priya owns tasks.mjs"),
and taught vocabulary can't bridge to graph instances ("is TaskController a handler" walls; the
is-a parse demands an article that never fits a symbol name). Add natural teach frames + a
taught-class↔instance bridge (inherits ∘ subClassOf). ACE stays product-inert unless a spike shows
zero spine regression (it's wired async; activation is a deliberate, separately-gated step).

### 8. Imperative + why nudges (feel; small) — HANDOVER follow-up #5
> ✅ **delivered 0.8.2** — feel #4 merge `878dd0e` (imperative "make a test for it" + why-untested
> + opinion honest nudges). Confirmed by playtest.
"make a test for it" → "I don't write code — but /tests <name> shows coverage"; "why is it
untested" → honest capability nudge. Walls are fine; blank walls aren't.

### 9. Second C2 goal-rule + held-out phrasings (agent; med) — HANDOVER follow-up #2
> ✅ **delivered 0.8.2** — router #2 merge `e10f76b` (`cochange-risk-invariant` + pure
> `applicableRules` selection; 0→refuse open-world, >1→refuse ambiguous; grep-clean of request
> keywords). See AGENTBENCH_0.8.2 (goal driver 100/98/0 over 56 cases).
C2 currently rests on one coverage-invariant `GOAL_RULES` entry — real but thin. A second declared
rule with blind-graded held-out phrasings makes "C2 cleared" rule-general.

### 10. AGENTBENCH ladder depth + the C1 per-member hop (agent; med) — HANDOVER follow-up #3
> ✅ **delivered 0.8.2** — router #3 merge `11744a2` (member-filter HTN method + per-member
> callees hop, `81c8caa` — flips `ab-c1-widget-methods-calling` in BOTH drivers, grain mismatch
> fixed; ladder 43→56 fixture-linted cases incl. `6f5aa29`; bounded runner pool `ddf6489`).
Grow result-composition cases (static `expect.result` literals, fixture-linted); the standing C1 red
(`ab-c1-widget-methods-calling`) needs a per-member callees hop the single-shot resolver can't emit
— either a bounded second hop in the composer or an honest permanent ceiling marker. Fix the
fixture-grain mismatch (bare `render` vs dotted `Widget.render`) either way.

### 11. Hygiene: bench-import smell (neither axis; tiny) — HANDOVER follow-up #4
> ✅ **delivered 0.8.2** — router #1 merge `71a7c4e` (`b94422c`: `hallucinationsIn`/set algebra
> extracted to `src/router/call-validator.mjs` + `set-algebra.mjs`; the bench imports downward —
> `grep -r agentbench src/` is clean).
`src/router/resolver.mjs` imports `hallucinationsIn` from `agentbench/grade.mjs`; extract the shared
check into `src/router/`.

### 12. The push (operator-gated)
> 🚢 **shipping now** — the 0.8.2 gate is green (deterministic joint PASS, both benches, 974
> tests); ship-over-delay decided by the operator; pushing `main` publishes 0.8.2 via CI, then
> ping `codememory` (seonix gates its cutover on it).
0.8.1 committed locally; pushing `main` triggers CI publish. Not a session decision.

Suggested batching: **items 1–5 + 8 are one "feel wave"** (small, disjoint renderer/lexer surfaces,
one re-judge of the touched tags at the end, one playtest to confirm); **item 6 is its own wave**;
**items 9–11 are a router wave**; 7 rides with either.

## Playtest evidence (2026-07-06, lightweight; 7 sessions, mini-webapp graph, isolated store)

Strengths to protect: typo tolerance ("wich functions are untested" → perfect answer), `it`-anaphora
carry (4 consecutive turns), `describe <Class>`, superlatives ("which module has the most imports"),
counts, greeting/thanks personality, taught-fact source receipts.

Key exchanges (trimmed):

```
user> what can you do
tmct> … For example: which modules import walk.mjs / what calls buildContextBundle …
      [examples from tmct's own repo, not the loaded graph — a stranger typing them gets misses]

user> who touched src/core/store.mjs
tmct> a1b2c3d4e5f6 (Grace Hopper) and c3d4e5f6a1b2 (Alan Kay) and 1b2c3d4e5f60 (Barbara Liskov).
user> who is Grace Hopper
tmct> couldn't parse this as a graph question. Try: "when did <name> change" …
user> what did Grace Hopper touch
tmct> no module matching "Grace Hopper" found in the index.

user> what calls saveStore
tmct> in src/handlers/tasks.mjs there is function createTask().
user> [later, focus = createTask] what does it call
tmct> createTask has no calls edges in the index. (traversal: calls edges where subject = createTask)
      [self-contradiction: callsSymbol vs calls]
user> does it have tests
tmct> No — no defines edge found from createTask to 0a1b2c3d4e5f.   [wrong relation + raw hash]

user> what does the app do
tmct> couldn't parse this as a graph question. …   [most likely stranger opener; walls]
user> whats the riskiest file to change
tmct> no module matching "riskiest" found in the index.

user> who owns src/handlers/tasks.mjs
tmct> you asked about this before (session 019f3967…): Q: who touched src/core/store.mjs A: …
      couldn't parse this as a graph question. Try: [~120-word grammar dump]
      [wrong recall stapled to a wall; repeated verbatim 5× in the session]

user> hey there, quick question - which modules import src/core/model.mjs?
tmct> you asked about this before …: Q: who owns src/handlers/tasks.mjs A: you asked about this
      before …: Q: who touched src/core/store.mjs A: … couldn't parse …
      [nested recall-of-a-recall-of-a-wall; the bare question answers perfectly]

user> every controller is a handler
tmct> noted — remembered 1 fact: controller rdfs:subClassOf handler
user> is a controller a handler
tmct> yes — you told me: controller is a kind of handler (source: ace:chat:…)   [lovely]
user> is TaskController a handler
tmct> couldn't parse this as a graph question. Try: "is a <thing> a <kind>" …
      [taught vocab can't bridge to instances; is-a parse demands an article]

user> what about the logger        [after an imports question]
tmct> this could mean more than one thing: 1) modules that imports "the logger" or 2) modules that
      imports "logger" — try rephrasing more specifically.   [same reading twice]

user> what is a Record
tmct> "Record" isn't a term in this graph's own vocabulary (no matching class or predicate).
      [the bot lists Record under "what classes are there" and shows inherits → Record]
```
