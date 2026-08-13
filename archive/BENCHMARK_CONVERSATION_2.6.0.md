# BENCHMARK_CONVERSATION_2.6.0 — persona sweep, 6 frames, ~520 probes; every 2.5.0 routed item re-verified fixed, and the risk moved to the write boundary

**Mode:** persona-sweep (§3.4, the default for one run). The same six frames as 2.5.0, dispatched in
parallel: the textbook logician, the casual newcomer, the new developer, the adversarial sceptic,
the returning user with a stale mental model, and the planning user. Probe scope grew with the
product: **521 probes** against 2.5.0's ~410, because every frame first re-ran its round's routed
reproducers (the ratchet check) before hunting fresh edges, and two frames spent real probes on the
2.6.0 capabilities (guess-the-number, learn-on-miss, the SKOS lane, the plan/game exclusivity seam).

**Headline: every one of 2.5.0's routed items re-verifies as fixed — the full closed table is below
— and the sweep found ~34 new dead-ends, of which 8 state or write something false.** The story
moved again. 2.0.3's risk was words dropped before the parser; 2.5.0's was a proof emitted after it;
2.6.0's worst finds sit at the **write boundary**: questions that get STORED as facts (`dog have
tail?` becomes a remembered fact at trust 1.00, above the shipped corpus's 0.70), a negative
universal that mints a garbage `"no dog"` subject instead of a disjointness (so the very veto that
2.5.0's fix added has nothing to consult one hop deeper), and a mid-plan board correction that is
confirmed ("noted — remembered") and then contradicted one turn later. The honest-miss READ machinery
is in its best state yet — the sceptic's streak reached **0 inversions in 100 probes**, the planner
hand-verified every "shortest" claim it saw, and the games/reference/SKOS capabilities came through
their first sweep with zero fabrications — but the teach classifier still swallows rare interrogative
shapes, and what it swallows, it writes.

**This run measures and documents only.** Per `SKILL_BENCHMARK_CONVERSATION.md` §5 this skill never
edits `src/` or `test/`. Everything below is routed, not fixed. Every finding ranked confident-wrong
was independently re-reproduced by the coordinator before it was written down here.

## Timing

Date **2026-07-18 (CEST)**. The sweep was dispatched twice: a first six-frame dispatch at **04:56**
was killed mid-run by an account spend-limit outage before any frame produced output (nothing was
lost from the case-set or judge work, which had already landed). After the limit was raised the six
frames were re-dispatched with incremental transcript writing.

| interval | start | end |
|---|---|---|
| benchmarking session (six parallel frames, effective run) | 09:47 | 10:04 |
| analysis (reading six transcripts, re-verifying, writing this report) | 10:04 | 10:40 |

## Ladder position reached

**The 2.5.0 gate is cleared, and a new family occupies FLOW-0, so the ladder holds at FLOW-0 — for
a different and worse-class reason than last round.**

The 2.5.0 blocker is gone with a receipt. The desire-opener family (`i wanna know about a horse` and
its siblings) answers the vocabulary question in every phrasing the newcomer frame re-ran, asserts no
false intent, and stores nothing; its frozen regressions (`template.vocab.*`, the openers corpus
lane) are green on this tree (ratchet criterion 2), and the newcomer's fresh conversations flowed
through the whole 2.5.0 re-check list (criterion 1, for that family).

But FLOW-0 — bootstrap: identity, greeting, seeded vocabulary — is where three of this round's new
finds land, and one is the sweep's second-worst class:

- **`dog have tail?` is stored as a taught fact** (`dog tmct:has tail`, trust 1.00 — above the
  seeded corpus's 0.70) in a bare seeded session. A FLOW-0 vocabulary question in ESL form mutates
  memory and outranks the shipped knowledge it was asking about. The canonical `does a dog have a
  tail` answers correctly; the surface-variation axis (§2.2) is exactly where this fell.
- **Bare `dog` regressed** to the identity blurb. At 2.5.0 the bare noun answered from the corpus
  (that report's own Tier-0 ratchet evidence); now it self-introduces. `teh dog` adds "still the
  same overview" — a repeat-claim for a request that never happened.
- **Everyday vocabulary questions land on the code wall**: `what do cats eat`, `what colour is
  grass` → "couldn't parse this as a graph question. Try: 'which modules import <name>'" — honest,
  but the guidance is aimed at the wrong audience in a session whose only knowledge is seeded
  vocabulary.

Per §2.1 a tier ratchets only when fresh conversations at it flow with zero dead-ends, and a
confident-wrong (a mutation, here) at FLOW-0 fails that on the spot. So: FLOW-0's 2.5.0 content is
clean and pinned, FLOW-0's fresh edge is not, and the ladder position is **FLOW-0**, gated by the
interrogative-swallowing teach classifier rather than by the routing gaps that gated it last round.

The tiers above look better than the position implies, which is the point of naming the cause: the
planner frame ran FLOW-5-grade content (teach a domain, plan, read back, revise) through 26 sessions
with every re-check passing and every "shortest" claim hand-verified true; drill-down, relation and
compositional chains (FLOW-2..4) flowed across the developer and returning frames; and the messy-user
surface (FLOW-6) is where most of the remaining honest misses cluster. When the write-boundary family
routes out, the ladder should move more than one rung on the next measurement — measured then, not
assumed now.

## What 2.5.0 routed, now closed — the full re-verification table

Every routed item from `BENCHMARK_CONVERSATION_2.5.0.md`, re-run live this round by the frame that
owned it. This is the ratchet's criterion-2 evidence made concrete: each of these also carries a
keyed corpus pin (`inference.disjoint.*`, `grammar.routing.impact-intent`, `template.vocab.*`,
`planning.*`, `grammar.resolve.unknown-residue-*`), all green in this tree's `test:fast`.

| 2.5.0 item | 2.5.0 behaviour | 2.6.0 behaviour | re-ran it |
|---|---|---|---|
| 1 — disjointness-vs-subclass proof | yes-with-proof over a stored `owl:disjointWith` | contradiction report naming both facts, refuses to conclude; inheritance form ditto; no-disjointness control still proves | logician |
| 2 — `blast radius of X` remembered | teach-lane write | impact closure; `/memory` clean | new developer |
| 3 — `impact of X` → "import of X" | fuzzy collapse | impact closure, no misread | new developer |
| 4 — impact vs `what calls saveStore` disagree | "no dependents found" | both name src/handlers/tasks.mjs | new developer |
| 5 — members-of read `contains` only | misleading "no contains edges" | `defines` consulted | new developer |
| 6 — `what uses the Store class` | result-type narrowed to "no classes" | the users of Store | new developer |
| 7 — `which modules have no tests` | "no tests" as literal object | the untested survey, same set as `/untested` | new developer |
| 8 — `i wanna know about a horse` family | teach misroute + pronoun lecture (the Tier-0 pin) | answers the vocabulary question, nothing stored | casual newcomer |
| 9 — `what have you got` | `defines "got"` | overview blurb | casual newcomer |
| 10 — `where does disk-1 rest?` | code definition-locator | board read; `where is every disk` enumerates the board | planner |
| 11 — multi-candidate stale modifier | enumeration under an ambiguity disclosure | declines naming "deprecated"/"legacy"/"cache", answers for no candidate; genuine-ambiguity control still enumerates | returning user |
| 12 — impact paraphrases | touches misparse / wall | all reach the closure | new developer |
| 13-18 — the phrasing siblings | six honest misses | five fixed; two edges frayed since: `and a cat` after a what-else turn hits the blurb (the pinned context still works), and bare `dog` regressed (both in the new backlog) | casual newcomer |
| 19 — `is a dog a dog` | miss | trivially yes | logician |
| 20 — instance disjointness | miss | firm no | logician |
| 21 — universal conditional teach | unsupported | teaches and applies | logician |
| 22 — non-holding converse | bare wall | guiding nudge naming the stored converse (taught lane; the code-graph half still walls — new backlog) | logician, sceptic |
| 23 — `does rex have fur` | misparse | answers via inheritance (1-hop; the 2-hop form is a new backlog row) | logician |
| 24 — ungrounded capability ask | identity blurb | declines by name | logician |
| 25-26 — module-orient stale modifier | bare wall | declines naming the modifier (`imports`/`calls`/orient lanes; the `describe` lane is a new gap) | returning user |
| 27 — goal-frame phrasings | walls | `stack all disks on peg-c` and friends register; conjunction compiles one atom per conjunct | planner |
| 28 — silent assumed positions | unflagged plan | "note — disk-2 and disk-3 have no taught position" carried with the plan (goal-mentioned pieces only — the non-goal half is a new backlog row) | planner |
| 29 — unknown goal token burns the search | 300-move burn | declines instantly naming "peg-z" | planner |
| 9.1 — `zeus is not mortal` no-op | code-empty landing | declines by name, stores nothing | logician |
| 9.2 — "all dogs is mortal" echo | ungrammatical suggestion | grammatical singular fold | logician |
| sceptic's standing brief | 0 inversions / 78 | **0 inversions / 100** — streak: 0/55, 0/78, 0/100 | sceptic |

## Per-persona breakdown

Ranked by §3.4's rule — findings more than one frame hit independently rank first.

### Hit by multiple frames independently

- **The identity/orientation blurb swallows non-identity turns (4 frames).** The newcomer's bare
  `dog`, `teh dog` and `ok cool thanks`; the returning user's `what is tasks` (a known best-match
  exists); the sceptic's mid-game `you said lower` (game running, reply is the identity card); the
  planner's `undo`, `forget the goal`, and `next` after plan completion. The fallback that used to be
  a last resort is now the most common wrong lane — it answers with confidence about itself when the
  turn was about something else, and in the `teh dog` case it asserts a repeat that never happened.
- **The teach classifier still swallows rare interrogative shapes and WRITES them (2 frames, worst
  class).** `dog have tail?` (newcomer — stored, trust 1.00) and `I'm new here, what should I read
  first` (new developer — stored as `i'm mgx:new here, what should i read first`, garbled by the
  news/new lemma). 2.5.0's item 2 closed this for `blast radius of X`; the family is the same, the
  surfaces are new (ESL missing-"does", leading contraction + comma clause). An interrogative must
  never reach the write boundary; two frames re-proved that rule's value independently.
- **Casual phrasings don't reach the new game lane (2 frames).** `let's play guess the number` and
  `wanna play a guessing game?` (newcomer) hit the code-question wall; non-numeric mid-game turns
  (sceptic) drop out of the game frame entirely. The canonical openings and the whole in-game loop
  are clean in both seats — the lane exists; its recogniser is narrow, which is exactly the shape
  most 2.5.0 items had.

### The textbook logician — 142 probes / 37 scenarios, 1 confident-wrong (proof-shaped), 2 soft, ~5 honest misses

All nine re-checks pass (table above). The worst new find is the round's worst overall:

**A negative universal with no stored direct positive never becomes a disjointness — so nothing can
veto the proof one hop deeper.** `every dog is a canine` / `every canine is a mammal` / `no dog is a
mammal` / `is a dog a mammal` → **yes, with a two-hop proof**, one turn after the "no" was
"remembered". The mechanism is sharper than a bypassed gate: `/memory` shows the third teach stored
`no dog rdfs:subClassOf mammal` — subject literally `"no dog"` — because the negative-teach lane only
mints `owl:disjointWith` when a direct positive `dog ⊑ mammal` exists to disagree with. With the
positive derivable but not stored, the negation is warehoused under a garbage subject, the cax-dw
veto (which reads `owl:disjointWith` rows, and which correctly kills the 1-hop and
ancestor-inheritance forms) has nothing to consult, and the chain proof sails through. Same root in
miniature: `no dog is a dog` is accepted silently. Coordinator-verified from a fresh reproduction.

Softer: the 2-hop property-inheritance ask (`every canine has fur` / `every dog is a canine` /
`rex is a dog` / `does rex have fur`) falls out of the inheritance reader into the code lane (the
1-hop form answers); and the negation-teach miss messages can suggest nonsense ("every no dog is a
thing" shapes) when the parse fails.

### The casual newcomer — 80 probes (+5 `/memory` checks) / 15 sessions, 2 confident-wrong, 2 regressions, ~6 honest-miss clusters

Re-checks: the whole 2.5.0 vocabulary-lane family passes (items 8, 9, 13-18 above), the restricted
count holds, and the 2.6.0 capabilities came through clean where their canonical phrasings were used:
a full honest guesser game with narrowing receipts, mid-game asides answered with the game surviving,
`i give up` revealing honestly, the otter article cited from the shipped pack with exactly one fact
stored, `zorblatt`/walrus/glacier missing honestly (the frame verified the pack really lacks them),
and the SKOS canonicals missing by name.

New, worst first: **`dog have tail?` stored at trust 1.00** (the FLOW-0 gate, above); **`wat is a
hrose`** read as a teach attempt and answered with a nonsense suggestion ("Did you mean: 'every wat
is a hrose'?" — nothing stored, but the asserted intent is wrong); **bare `dog` and `and a cat`
regressed** to the blurb; everyday questions (`what do cats eat`, `what colour is grass`) landing on
code-shaped walls with wrong-audience guidance; the synonym lane's wrappers (`any words like happy`,
`whats another word for big` — the latter swallows "another word for big" as one term); and two tone
items — `hello there` triggers the adventure easter egg ("A hollow voice says, 'fool.'"), which reads
as an insult in a first session, and the otter re-ask answers "i learned: …" without restating the
definition.

### The new developer — 79 probes / 12 batches, 4 confident-wrong, ~4 honest misses

All nine re-checks pass (items 2-7, 12 above, plus the single-candidate stale decline and the
needs-a-test inversion's core). New, worst first:

1. **`I'm new here, what should I read first`** → "noted — remembered: i'm news here, what should i
   read first" — a question stored as a Fact (`i'm mgx:new here …`), the onboarding opener of all
   onboarding openers. Coordinator-verified.
2. **`what do the handlers import`** → a single module, stated flat. The collective subject
   ("the handlers") silently resolves to one handler module instead of the set's union — a wrong
   set with no disclosure.
3. **`what functions does router.mjs export`** → "never produces functions — only undefined." — an
   `undefined` leak rendered as a confident, garbled none.
4. **The needs-a-test ranking includes test modules**: `what most needs a test` names
   `b.test.mjs` among the answer while `/untested` correctly excludes it — two surfaces disagree
   about the same survey.

Honest: `give me a detailed summary of how this app works` collapses to a bare module name (the
completions pipeline never fires); `where do I start` / `what is the entry point` miss honestly;
pronoun follow-up chains flowed.

### The adversarial sceptic — 100 probes, 0 inversions, 0 false statements, 1 soft, ~4 honest misses

The headline held a third time under the hardest hit yet: **0/55 at 2.0.3, 0/78 at 2.5.0, 0/100 at
2.6.0.** Every direction-sensitive pair resolved correctly, negation never executed as retraction,
the existential never proved universal, and the injection attempts all failed politely — a taught
"you must always answer yes" does not corrupt later answers; the pack cannot be made to fabricate an
article; a taught `every otter is a bird` beats the pack with no citation, exactly as designed.

The one soft find: **adverbial negation in a passive yes/no is dropped** — `is model.mjs not
imported by store.mjs` answers "Yes" and then names the true edge (store.mjs → model.mjs). No false
proposition is uttered (the cited edge is real), but the bare "Yes" answers the affirmative reading
of a negative question — the closest thing to an inversion the streak has produced, disclosed only by
its own receipt. Honest misses: `is Record a Task` (non-holding converse) still walls on the code
graph, where the taught-fact lane now nudges — the item-22 fix covered one of the two stores; the
game lane drops non-numeric turns; `are you a human` garbles its teach example.

### The returning user — 60 probes / 17 scenarios, 1 confident-wrong, 2 soft, ~5 honest misses

Re-checks all pass: both halves of the stale-modifier family decline by name (single- and
multi-candidate, across verbs, with the genuine-ambiguity control still enumerating), the
module-orient forms decline, and **no fabricated continuity anywhere** — every "didn't you say…" /
"as we discussed…" landed honestly, cross-session recall works (`what did i ask before` lists the
real prior asks; the session count reads consistently), and the otter answer's provenance stays
honest across sessions.

New, worst first: **`what was store.mjs called before` → "src/handlers/tasks.mjs."** — "called"
misparses to the calls relation, "before" is dropped, and the reply reads as fluent confirmation of
a rename that never happened (reproduced on router.mjs and on "the router"; coordinator-verified).
Soft: **`describe the old Task class`** returns the full Task card with "old" silently swallowed —
the one lane the stale-modifier guard doesn't cover; **`remind me what we decided about the store`**
is read-as-rewritten into "what defined store" — announced, but a decision-recall question answered
as a definition location. Honest: a misremembered symbol (`what calls saveTask`) fans out to
ambiguity candidates that include commit hashes, while the nearest real neighbour (saveStore) is
absent from the did-you-mean list; `where did loadStore move to` states the current location without
ever denying the move premise; a `tmct_search` tool-name leaks into one chat reply.

### The planning user — ~60 probes / 26 sessions, 2 confident-wrong, 3 honest-miss clusters, and the strongest clean-pass list in the sweep

Re-checks all pass (items 10, 27-29 above), and the fresh-edge verification work deserves its line:
the 4-disk extension plans **15 moves, hand-simulated fully legal and optimal**; a scattered start
gives the true minimum 7; a partial goal gives the true minimum 4 (3 proved impossible by case
analysis); `what moves are legal now` is exactly right at three different states; a goal that
already holds answers "nothing to do"; and both NEW plan/game exclusivity seams pass in both
directions with honest, named declines.

New, worst first:

1. **A mid-plan board correction is confirmed and then ignored.** With a plan at step 1, `disk-1
   rests on peg-b.` → "noted — remembered" — and the next `next` executes on the old board, with
   `where does disk-1 rest?` reading the plan's board only. The system says it remembered a fact
   and contradicts it one turn later, no conflict note, no replan; had the taught fact been true,
   the executed move would have been illegal.
2. **The assumed-position flag only covers goal-mentioned pieces.** A contradictory board with an
   unplaced disk-3 yields "move disk-1 onto disk-3" — a move onto a piece with no known position,
   unflagged (the item-28 flag fires only when the GOAL names the unplaced piece), and the "shortest"
   count depends on which of the contradictory placements you resolve.
3. **Goal revision has no working gesture**: `actually the goal is …` hits the code wall (then
   `solve it` solves the stale goal); restating accumulates an unsatisfiable conjunction that burns
   the 300-move search with no pre-search note; `forget the goal` and `undo` get the identity blurb.
   Also: a pre-plan contradictory board is still accepted unremarked (2.5.0's observation, standing),
   and two verbatim lines of `data/games/hanoi-3.txt` itself misparse when pasted as one line.

## New capabilities under sweep — first-round verdict

- **Guess-the-number:** clean in both seats through every canonical flow — bisection with narrowing
  receipts, true hints over a pinned secret, out-of-range declines by name, the give-up reveal, the
  false "you already said correct" rebutted from the hint record, the contradiction refusal on an
  emptied interval, and both exclusivity seams with the planner. Zero fabricated game statements
  across three frames. Its edges are all recogniser-width: casual openers and non-numeric mid-game
  turns fall out of the lane.
- **Learn-on-miss:** the cited pack answer, the single stored fact, the memory-backed second ask,
  and the honest miss on non-pack terms all held under adversarial pressure; the taught-fact-beats-
  pack trust order verified. No fabrication found by any frame.
- **SKOS synonyms/related:** the canonical phrasings miss honestly by name on an empty store; the
  wrapper phrasings don't reach the lane; there is no teach shape to fill the store from chat (the
  standing prepositional-verb predicate-minting decision).

## Routed backlog

Confident-wrong first (a false or misleading statement, or a read-only turn that writes), then soft,
then honest misses. Every confident-wrong row was re-reproduced by the coordinator before ranking.
Routing: this measurement worktree does not edit `NEXT.md` or PLAN docs; each row names its
intended destination and the mirroring happens at merge (the coordinator holds this list).

| # | Verbatim input | What it did | Class | Diagnosis | Route |
|---|---|---|---|---|---|
| 1 | `every dog is a canine` / `every canine is a mammal` / `no dog is a mammal` / `is a dog a mammal` | **yes, with a 2-hop proof**, one turn after the "no" | CONFIDENT-WRONG (proof-shaped, worst) | the negative-universal teach only mints `owl:disjointWith` when a direct stored positive exists; otherwise it stores subject-literal `no dog rdfs:subClassOf mammal`, which the cax-dw veto (correct at 1 hop and via inheritance) can never see. Ground the negation on the resolved class pair — or decline by name — never a `"no X"` subject. Same root: `no dog is a dog` accepted silently | NEXT (via coordinator) |
| 2 | `dog have tail?` | `noted — remembered 1 fact: dog tmct:has tail` at trust 1.00 (corpus: 0.70) | CONFIDENT-WRONG + state mutation | the ESL missing-"does" yes/no falls past the interrogative detectors into the bare-declarative teach; the trailing `?` should gate the write boundary outright | NEXT (via coordinator) |
| 3 | `I'm new here, what should I read first` | `noted — remembered: i'm news here…` (Fact: `i'm mgx:new here, what should i read first`) | CONFIDENT-WRONG + state mutation | same family as #2: a leading contraction + comma question-clause reaches the teach lane; interrogative shapes must never write | NEXT (via coordinator) |
| 4 | `what was store.mjs called before` (also router.mjs, "the router") | `src/handlers/tasks.mjs.` — reads as confirming a rename that never happened | CONFIDENT-WRONG | "called" fuzzes to the calls relation and "before" is dropped; a rename-history ask should decline by name (no rename data exists), the way "renamed X" already does — the adjective is guarded, the verb slips | NEXT (via coordinator) |
| 5 | `what do the handlers import` | one module, stated flat | CONFIDENT-WRONG (wrong set) | a collective/plural subject silently best-matches a single module; resolve the member set and union, or disclose the narrowing | NEXT (via coordinator) |
| 6 | mid-plan: `disk-1 rests on peg-b.` then `next` | "noted — remembered" then executes the old board; read-backs contradict the accepted fact | CONFIDENT-WRONG (accept-then-ignore) | a board teach while a plan snapshot is live is stored to memory but never reconciled with the plan board; either replan/flag the conflict or decline the mid-plan re-teach by name | NEXT (via coordinator) |
| 7 | `what functions does router.mjs export` | "never produces functions — only undefined." | CONFIDENT-WRONG (garbled none) | an `undefined` leaks into the none-renderer for the export/produce phrasing | NEXT (via coordinator) |
| 8 | `wat is a hrose` | teach-intent reply + "Did you mean: 'every wat is a hrose'?" | CONFIDENT-WRONG (intent; nothing stored) | a typo'd interrogative falls into the teach suggester; run the typo repair before the teach classifier | NEXT (via coordinator) |
| 9 | contradictory board, disk-3 never placed, goal `disk-2 rests on peg-b` | "2 moves (shortest): 1. move disk-1 onto disk-3 …" — a move onto an unplaced piece, no flag | SOFT (silent gap-fill) | the item-28 assumed-position note fires only for goal-mentioned pieces; extend it to any piece a plan step touches, and flag contradictory placements before planning | NEXT (via coordinator) |
| 10 | `what most needs a test` | includes `b.test.mjs` in the needs-a-test set; `/untested` excludes it | SOFT (surfaces disagree) | the fewest-tests superlative lacks the test-source filter `/untested` applies | NEXT (via coordinator) |
| 11 | `is model.mjs not imported by store.mjs` | "Yes — …imports edge from store.mjs to model.mjs" | SOFT (dropped negation) | adverbial negation inside a passive yes/no is stripped; the receipt names the true edge, but the "Yes" answers the un-negated question. Detect and answer the negative form, or decline it | NEXT (via coordinator) |
| 12 | `describe the old Task class` | full Task card, "old" silently swallowed | SOFT | the stale-modifier residue guard covers imports/calls/orient but not the describe lane — the last unguarded lane of the 1.4 family | NEXT (via coordinator) |
| 13 | `remind me what we decided about the store` | read-as rewrite → "what defined store", answers the definition site | SOFT (announced category swap) | decision-recall phrasing should reach the session-recall surface (which exists and works for "what did i ask before"), not the definition locator | NEXT (via coordinator) |
| 14 | bare `dog` (first turn, seeded session); `teh dog` | identity blurb; "still the same overview" | honest miss (REGRESSION vs 2.5.0 + false repeat-claim) | the bare-noun opener lost its corpus route to the identity fallback; freeze the missing pin when re-fixed | NEXT (via coordinator) |
| 15 | `and a cat` (after `what else can dogs do`) | identity blurb, no pivot | honest miss (partial regression) | the staccato subject-swap holds after `tell me about a dog` but not after a what-else turn — the swap doesn't survive the expansion focus | NEXT (via coordinator) |
| 16 | `undo` / `go back one move` / `forget the goal` / `next` (plan done) | identity blurb or code wall | honest miss (cluster) | plan-navigation gestures unrouted; the blurb should never front a mid-plan turn | NEXT (via coordinator) |
| 17 | `actually the goal is that every disk rests on peg-b`; restated goals | code wall; contradictory goals accumulate and burn the 300-move search | honest miss (cluster) | goal revision needs a frame ("actually…", "instead…"), and an unsatisfiable conjunction wants a pre-search note | NEXT (via coordinator) |
| 18 | `let's play guess the number` / `wanna play a guessing game?`; non-numeric mid-game turns | code wall; identity card | honest miss (2 frames) | widen the game-opening recogniser to the invitation family; keep unparsed mid-game turns inside the game frame with a nudge | NEXT (via coordinator) |
| 19 | `what do cats eat` / `what colour is grass` / `so like what do cats eat` | "can't answer that as a code question" + code-shaped tries | honest miss (wrong-audience guidance) | in a graph-less seeded session the miss guidance should offer vocabulary shapes, not import/calls examples; the eats/colour relations are absent from the seed — an honest by-name miss would also do | NEXT (via coordinator) |
| 20 | `any words like happy` / `whats another word for big` | wall; "another word for big" read as one term | honest miss | the SKOS lane's recogniser misses the like/what's wrappers | NEXT (via coordinator) |
| 21 | `I don't suppose app/lib/e.mjs imports anything` | pronoun-rejection lecture, wrong inferred goal | honest miss shading confident-wrong-intent | the negative-polarity opener is the one wrapper the desire/wrapper stripper family doesn't peel — the P1 implicature cell's live edge | NEXT (via coordinator) |
| 22 | `is Record a Task` (code graph) | bare wall | honest miss | item 22's converse nudge landed on the taught-fact lane only; extend to code-graph entities | NEXT (via coordinator) |
| 23 | `what calls saveTask` (no such symbol) | ambiguity fan-out incl. commit hashes; saveStore absent from did-you-mean | honest miss (noisy repair) | the candidate ranker admits non-symbol kinds and misses the nearest real neighbour | NEXT (via coordinator) |
| 24 | `give me a detailed summary of how this app works` | bare module name | honest miss | the completions rescue never fires on the app-overview phrasing | NEXT (via coordinator) |
| 25 | 2-hop property inheritance (`every canine has fur` / `every dog is a canine` / `rex is a dog` / `does rex have fur`) | falls to the code lane | honest miss | the does-X-have-Y reader's taught ⊑-lift is 1-hop | NEXT (via coordinator) |
| 26 | `a disk is a kind of game piece. a peg is a kind of place.` (one line, verbatim from hanoi-3.txt); the renders-as line | inherits-question mash; wall | honest miss | two sentence-split edges on the shipped recipe's own lines | NEXT (via coordinator) |
| 27 | `hello there` (first turn) | "(A hollow voice says, \"fool.\")" | tone (flow risk) | the adventure easter egg fires on a plain greeting variant and reads as an insult in a first session | NEXT (via coordinator) |
| 28 | the session sidecar records rewritten queries | `i wanna know about a horse` recorded as "tell me about a horse"; `what animals do you know` as "what is an animal" | observation (honesty + instrument) | session history misquotes the user (recall surfaces would too), and bench session-mode matching cannot see pre-rewrite turns — record the verbatim input alongside the rewrite | NEXT (via coordinator) |
| 29 | `tmct_search` name in a chat reply; otter re-ask phrased "i learned:" with no definition; `where did loadStore move to` never denies the move premise; `ok cool thanks` blurb | minor | minor honest items | noted, not chased | NEXT (via coordinator) |

## Next

**The dead-end class that most needs attention is the write boundary.** Items 1-3 and 6 share one
property 2.5.0's worst finds did not: they change stored state (or warehouse a negation where no
reader looks) on the strength of a misparse. The teach classifier has been narrowed twice by exactly
this sweep's family of findings (`blast radius of X` at 2.5.0; the desire openers before that), and
each round finds new interrogative surfaces that still reach it. The standing rule is worth
engineering as a rule rather than as per-shape patches: **no turn that ends in `?`, opens with a
wh-/aux word, or carries an interrogative clause should ever reach a write**, and a negative
universal should either ground on the resolved pair or decline by name.

**Second, the identity blurb's reach.** Four frames independently fed it turns it should never have
fronted. It is the new "most common wrong lane" — the exact structural role the grammar wall played
at 2.0.3 and the teach lane at 2.5.0.

**Third, the FLOW-0 regressions** (bare `dog`, `and a cat`): small, already-understood routes that
lost coverage while their neighbours were being fixed — freeze the missing pins with the re-fix so
the ratchet's criterion 2 holds them.

**Recommended next run:** re-sweep the same six frames once items 1-6 land; keep the returning-user
frame (it again produced findings no other frame reaches — the rename-confirmation and the describe
gap) and keep the planner's verification discipline (hand-checking every "shortest" claim is what
separates a plan that reads well from a plan that is right). The game, pack and SKOS lanes need no
dedicated frame next round; their recogniser width will be exercised by the newcomer frame
naturally.

The ladder stays at **FLOW-0** until the write-boundary family (items 1-3) and the FLOW-0
regressions (item 14) route out. On current texture, the tiers above are ready to ratchet quickly
once the floor holds.
