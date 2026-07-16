# PLAN_GUESS_NUMBER.md — closed-loop (feedback-driven) planning for tmct, validated against "I am thinking of a number"

Status: RESEARCH / DESIGN — not yet implemented. No guesser, thinker, or bisection code exists in
`src/`. Since this doc was written, the general planner shipped underneath it: `findActionPath` and
`findReachableSet` in `src/domain/planning.mjs`, the goal reasoner in `src/domain/router/goal-reasoner.mjs`,
taught action families (the four `RULE_KIND_ACTION_*` kinds in `src/adapters/memory/core.mjs`), the `/plan`
chat command and `tmct plan` CLI mode, and the `planState` session slot in `src/services/chat.mjs`. Hanoi
and river-crossing (`test/corpus/planning.jsonl`) validate that planner.
This doc is now scoped to what it does not cover: hidden state and belief narrowing.

## Origin

2026-07-09 session. This doc validates the same underlying ask the Hanoi validation does (the
operator's own framing, verbatim): infer the
goal, read the relevant sub-graph of the current state, infer the paths to the goal by reasoning
about the effect of actions on the sub-graph, given the goal/state/possible paths pick the next
step, execute, repeat — be an agent.

## Why "I am thinking of a number", as the SECOND (not redundant) validation target

The shipped planner works over fully observed state. Every action's effect is known before it
runs, so `findActionPath` can compute the whole move sequence up front, and the plan lane's
step-by-step execution just walks that precomputed sequence. Hanoi and river-crossing both have
this shape.

"I am thinking of a number [between 1 and N]" is the complementary CLOSED-LOOP case. Each guess is
an action whose effect the agent cannot know in advance: it returns a fresh observation
("higher"/"lower"/"correct") that must be folded into the agent's belief about the hidden state
before the next step can even be chosen. There is no whole plan to precompute; the loop is
sense → update belief → re-plan → act, for real.

Secondary reasons it's a good second harness:
- Trivial to represent: state = a bounded numeric range (belief interval), not a graph structure —
  a useful contrast to Hanoi's graph-shaped state. It tests whether the planning-loop design
  generalizes across state SHAPES, not just across problems with the same shape.
- The textbook-optimal strategy (binary search, halving the interval each guess) has a known
  closed-form bound (⌈log2 N⌉ guesses) — the same unambiguous correctness check Hanoi's
  2^n − 1 gives, ported to the closed-loop case.
- Zero-LLM constraint stays intact — the optimal strategy is pure deterministic arithmetic
  (interval bisection), not a judgment call.

## Research findings and design (2026-07-09)

### 0. Two symmetric modes, one feature

"I am thinking of a number" is ambiguous about WHO holds the secret and WHO searches. tmct must
play either side:

- **Guesser mode** — the human holds a secret in `[1, N]`; tmct guesses, receives an observation
  ("higher"/"lower"/"correct") each turn, and must narrow a BELIEF interval and choose its next
  guess by bisection. This is the genuine closed-loop search case this doc was scoped to validate.
- **Thinker mode** — tmct itself picks and holds a secret in `[1, N]`; the human guesses, and
  tmct's only job each turn is an honest, stateless COMPARISON of the human's guess against the
  ground truth it already has. There is no search and no belief state to narrow on tmct's side —
  the "state" is a single committed fact, not an interval.

These share exactly one thing structurally: both are a **multi-turn game** that needs a
recognizable opening move, a piece of state carried turn-to-turn, a per-turn goal line, and an
honest-contradiction discipline. They diverge on everything computational: guesser mode needs the
bisection/update-rule machinery below; thinker mode needs none of it. The design below keeps them
as two branches (`mode === "guesser" | "thinker"`) of one mechanism, carried on the session's
existing plan slot (§1) — the THREADING question is role-agnostic even though the per-turn LOGIC
is not.

### 1. Where the state lives, turn to turn

`planState` in `src/services/chat.mjs` already ships the exact session-state wiring this section once
designed from scratch: a closure variable in `createSession`, passed into `runTurn`, returned
from the turn, reassigned by the session handle, and (per its own code comment) "cleared by
completion or a fresh goal, never by an aside". `focus` and `last` thread the same way.
**Reuse `planState` (or extend it with a game payload) rather than adding a parallel slot.**

What a guess-number implementer still needs to know:

- The slot is in-process only. `src/services/sessions.mjs` is a one-way provenance channel
  (`readSessionRecords`/`foldInSessions` re-attach recorded sessions to a fresh graph rebuild);
  no code path reads a prior session's sidecar back into a live `createSession`. A process
  restart loses an in-progress game the same way it already loses `focus`. That is accepted
  behavior, flagged in Open risks, not a gap this feature must close.
- Do not ride on `last.detail.pending` (the listing remainder that `morePage`/`MORE_RE` consume).
  Its contract clears it on any other real query — the opposite of what a game needs, which must
  survive an aside mid-game.
- Game payload (either mode):
```
{ mode: "guesser" | "thinker", n: <upper bound>, lo, hi, guesses: <number>,
  secret?: <number>,        // thinker mode only — the committed ground truth
  lastHint?: "higher"|"lower"|"correct", // thinker mode only — for false-claim rebuttal (§4)
  won: boolean, gaveUp: boolean }
```
  Whether this lands as fields on `planState` itself or as a sub-object is a Phase 1 decision.
  Either way it must not clobber an in-progress `/plan`-lane frame (`planLaneAnswer` and
  `executePlanStep` mutate `planHolder.state`); the two uses of the slot need a clean coexistence
  or an explicit "one at a time" rule.

### 2. Recognizing the game (opening move + continuation)

This is a closed-set recognition problem of the same shape as the existing routing recognizers
(`looksLikePredicateFind`, `MORE_RE`, `BARE_WHATIS_RE`) — not a general-grammar extension,
consistent with `tmct-prefers-templates-over-general-rules`.

**Opening phrasings** (checked once, at the START of `runTurn`, BEFORE `assertTurn` — a stray
"I'm thinking of a number between 1 and 100" must not be misparsed as a declarative ACE sentence to
teach, and BEFORE `runAsk` for the same reason a bare command word is checked first):
- Guesser-mode trigger (human holds the secret, tmct guesses): "I'm thinking of a number [between
  1 and 100][, you guess]", "guess my number", "guess the number I'm thinking of".
- Thinker-mode trigger (tmct holds the secret, human guesses): "think of a number [between 1 and
  100]", "guess a number and I'll tell you higher or lower" — the same thinker-mode ask phrased
  around the human's action instead of tmct's.
- Both forms accept an explicit bound ("between 1 and 100", "up to 50") with a sane default (100)
  when omitted, mirroring how other bounded-count lanes default rather than refuse.

**Continuation phrasings** (checked EARLY in `runTurn`, gated on the game state being non-null, at
the same precedence tier as the existing `MORE_RE` check — both are "does the previous turn leave a
structured continuation the current bare reply feeds"):
- Guesser mode expects a closed-set observation reply from the human: "higher"/"too low"/"bigger",
  "lower"/"too high"/"smaller", "correct"/"yes"/"you got it".
- Thinker mode expects a bare number as the human's guess (parsed the same way an ordinary count
  argument is parsed elsewhere in this codebase — no new number-parsing machinery needed).

Both recognizers are new closed-set regexes/tables in `chat.mjs`, following the existing
convention (`MORE_RE`, `GENERAL_VERB_TEACH_RE` precedent) — no new dependency, no probabilistic
matching.

### 3. Guesser mode — belief state, update rule, and the honest-contradiction case

**Representation**: `{ lo, hi }`, the closed interval of values still consistent with every
observation so far (initialized to `{ lo: 1, hi: n }`).

**Action-selection policy (bisection)**: guess `g = Math.floor((lo + hi) / 2)`.

**Update rule**, applied to the PRIOR guess `g` on receiving the human's observation:
- "higher" (secret > g) → `lo = g + 1`
- "lower" (secret < g) → `hi = g - 1`
- "correct" → game ends, `won = true`, no further update.

**Worst-case guess count**: `⌈log2(hi − lo + 1)⌉` guesses for the current interval — for the full
range `[1, N]` that's the textbook `⌈log2 N⌉` (e.g. N=100 → 7 guesses worst case), the same
closed-form correctness check `2^n − 1` gives for Hanoi, ported to the
closed-loop case exactly as the Origin section anticipated.

**The degenerate/dishonest-input case, precisely**: after applying an update, if `lo > hi` the
interval is EMPTY — no number satisfies every observation given so far, which means the human's
answers are mutually inconsistent (a lie, a mis-click, or a change of mind mid-game). tmct must
detect this ARITHMETICALLY (the same `lo > hi` check the update rule already computes, not a new
subsystem) and respond the way this project's ethos already establishes for a checkable-but-false
premise: an honest, specific refusal to keep guessing under a false premise, in the same register
as the existence-question discipline (never render a wrong answer as if it were verified) — e.g.:

> "That's not possible — you said higher than 62, and now lower than 55, but no number can be both.
> One of those two answers must be wrong. Want to restart, or correct one of them?"

This should name the SPECIFIC contradicting pair (the guess/observation that set `lo`, and the one
that set `hi`, both already on hand from the update rule — no reconstruction needed), never a
generic "something's wrong," and it should stop guessing rather than guess into the empty interval
(which would silently fabricate a next move on top of a premise tmct already knows is false).

### 4. Thinker mode — commitment, comparison, and its own honest edge cases

Thinker mode carries **no search or belief-narrowing at all** — tmct already has the ground truth,
so each turn is a single deterministic comparison, not a re-planning step. This is the intended
asymmetry: it validates that the SAME session-state slot can carry either a search-in-progress OR
a single committed fact, without the mechanism caring which.

- **Commitment**: on the opening thinker-mode turn, tmct picks `secret = 1 + Math.floor(Math.random()
  * n)` and stores it on the game state. This is ordinary product code inside `chat.mjs` (not the
  offline-eval harness this project restricts LLM/non-determinism to), so plain `Math.random()` is
  an acceptable, unremarkable source of randomness here — no seeding or determinism constraint
  applies to picking a party game's secret number.
- **Per-turn comparison**: parse the human's line as an integer guess; compare to the secret;
  answer "higher"/"lower"/"correct" accordingly; record the given hint on `lastHint` (needed
  for the false-claim rebuttal below); on "correct", set `won = true` and end the game.
- **Reveal policy**: tmct should NOT reveal the secret unprompted mid-game (that would pre-empt the
  human's own guessing, defeating the point of the game) — but SHOULD honor an explicit request to
  reveal/give up immediately, without an "are you sure?" gate. Grounding: this codebase has no
  ask-before-acting confirmation pattern anywhere (`teachFact` and every write lane confirm AFTER
  acting, never before), so a mid-game "just tell me the number" should be treated the same way:
  act (reveal), then state plainly what happened — e.g. "Giving up — the number was 42. Want to
  play again?" — ending the game (`gaveUp = true`) rather than leaving it in an ambiguous
  half-revealed state.
- **Out-of-bounds guess** (a guess outside `[1, n]`): decline honestly rather than fabricate a
  higher/lower verdict for a number outside the agreed range — e.g. "142 is outside the 1–100 range
  we agreed — try a number in range." (mirrors `presuppositionNudge`'s "can't check the
  presupposition — decline, never guess" discipline, ported here to a bound check).
- **False claim of a prior "correct"** ("you already said correct" when tmct's own record shows
  otherwise): tmct is authoritative here — it generated every hint itself, so `lastHint`/`won` is
  ground truth to check the claim against, not something to take the human's word for. Response
  should cite what tmct actually last said, e.g. "I haven't said 'correct' yet — my secret is
  still hidden; my last hint was 'lower' after your guess of 73." This is the same never-fabricate
  posture applied to tmct's own utterance history instead of the graph.

### 5. The goal line, per mode, per turn

`withGoalLine` and `deduceGoalFromParsed`/`GOAL_BY_KIND` (all in `src/services/chat.mjs`) are built around a
single deduced string computed ONCE per turn from `runAsk`'s `envelope.parsed` shape — a stateless,
single-query-shape lookup table. A multi-turn game's goal line is fundamentally different: it must
reflect the CURRENT game state, and it must be regenerated fresh every turn the game is active,
whether or not that turn even reaches `runAsk` (a continuation turn like "higher" never does — it
is intercepted earlier, same tier as `MORE_RE`).

**Recommendation**: `withGoalLine`'s plumbing (the `result.goal` string → appended suffix
mechanism) is reusable AS A RENDERER, but the goal STRING for a game turn cannot come from
`deduceGoalFromParsed` (there is no parsed query shape on a continuation turn) — it must be
computed directly by the game-turn handler from the live game state and passed through the same
`result.goal` field `withGoalLine` already knows how to render. No new rendering path is needed;
what's new is a second SOURCE of `result.goal`, alongside (not replacing) `deduceGoalFromParsed`.
Concretely, per mode:

- Guesser mode: `` `narrow down your number — currently between ${lo} and ${hi}` `` each turn.
- Thinker mode: reflect the LAST hint given, e.g. `` `let you find my secret number — said "${lastHint}" so it's ${lastHint === "higher" ? "above" : "below"} your last guess` ``
  on turns after the first hint, or a plain "let you find my secret number I've committed to" on
  the opening turn before any hint exists.

Both are table-driven from the game state's own fields (never free-text generation), consistent
with `GOAL_BY_KIND`'s own "small, honest bucket lookup, never a fabricated guess" discipline —
just keyed on live game state instead of a static parse-shape table.

### 6. What this domain adds over the shipped planner

The shipped planner (`findActionPath` over taught `RULE_KIND_ACTION_*` families, the goal
reasoner's deduce → plan → arbitrate → execute-one → observe loop) covers fully observed,
deterministic domains: Hanoi and river-crossing both compute the whole path up front and walk it.
This domain adds three things none of that code has:

- Actions whose effect is an **observation about hidden state**, folded into a belief (an
  interval) rather than applied to a known state.
- A belief representation that is deliberately NOT graph-shaped — a bare `{lo, hi}` interval or a
  single scalar secret — so it stays a plain object on the session slot, not `.tmct/graph.json`
  individuals.
- Actions with nothing to gate: guesses and comparisons write nothing to the graph or memory
  store, so the write-lane confirmation question doesn't arise.

Whether the shipped planner's interfaces should eventually absorb the observation/belief-update
step is a design question for after this domain works, not before.

### Phased implementation sketch (mirrors ROADMAP.md's phase-writing style)

**Phase 1 — Recognition + guesser-mode core.** Closed-set opening/continuation recognizers (§2);
game state carried on the session's plan slot (§1); guesser-mode belief interval + bisection +
update rule (§3), including the honest empty-interval refusal. No goal-line integration yet —
plain confirmatory turns only. The multi-step plan-execute-recheck loop is already live in this
codebase (the plan lane walks `planState`'s cursor step by step); what Phase 1 validates for the
first time is belief-narrowing over HIDDEN state — the bisection interval and observation folding,
neither of which exists anywhere in `src/`.

**Phase 2 — Thinker mode.** Secret commitment (`Math.random()`), per-turn comparison, out-of-
bounds decline, reveal-on-request, and the false-"you already said correct" rebuttal (§4). Shares
the Phase 1 state slot and recognizer precedence tier; adds no new threading.

**Phase 3 — Goal-line integration.** Extend `result.goal`'s source to include a live-game-state
generator (§5), composing with existing `withGoalLine` rendering untouched. Both modes' goal
strings, table-driven off game-state fields.

### Open risks / questions (refined)

- **No cross-process persistence for game state**, parity with `focus`/`last`/`planState` — a
  killed or resumed chat session loses an in-progress game exactly as it loses focus today. Not
  solved here; if it matters later, `sessions.mjs`'s JSONL-sidecar shape is the closest existing
  precedent for what a persisted-game record could look like, but that is new plumbing this doc
  does not design.
- **Coexistence with the `/plan` lane**: `planState` already carries goal/move/cursor frames for
  taught-action planning. A game landing on the same slot needs an explicit rule for what happens
  when one starts while the other is in progress (§1). Flagged, not resolved.
- **Recognizer precision** (both modes' opening phrasings, and — for thinker mode — a bare integer
  reply that could ALSO be a legitimate unrelated query): the continuation-turn recognizers must
  be gated STRICTLY on the game state being non-null, the same discipline `MORE_RE` already uses
  against `last?.detail?.pending`. Within an active game, a stray unrelated question ("what does
  auth.mjs export") arriving mid-game needs a decision: silently answer the aside and leave the
  game untouched (falling through past the continuation recognizer, since it won't match
  "higher"/"lower"/a bare number), or an explicit "still playing — say higher/lower/correct"
  nudge. Recommend the former, since it needs no new code beyond the continuation recognizer
  already declining to match — flagged here because it's a real design choice, not a forced one.
- **Bound sanity**: a stated bound that's degenerate (e.g. "between 1 and 1", or `hi < lo` in the
  OPENING phrase itself, or a non-numeric/absurdly large bound) needs the same honest-decline
  treatment as the mid-game contradiction case, just applied to the opening turn instead of an
  update — not designed in this pass, flagged for Phase 1's own detailed spec.
- **Multiple concurrent games**: this design assumes one game per session, matching `focus`'s own
  one-at-a-time precedent — starting a new game opening phrase while one is active should probably
  ask/clarify rather than silently overwrite, but which behavior is right is left as a Phase 1
  implementation decision, not resolved here.

## Non-goals for this document

- Not an implementation — no code changes land from this doc alone.
- Not a replacement for the Hanoi validation — the two are deliberately complementary halves
  (open-loop vs. closed-loop) of validating ONE planning-loop design, not two separate features.
