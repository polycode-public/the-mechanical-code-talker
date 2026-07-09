# PLAN_GUESS_NUMBER.md — closed-loop (feedback-driven) planning for tmct, validated against "I am thinking of a number"

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-09 session, companion document to `PLAN_HANOI.md` — both are validation harnesses for the
SAME underlying ask (the operator's own framing, verbatim, carried over from that doc): infer the
goal, read the relevant sub-graph of the current state, infer the paths to the goal by reasoning
about the effect of actions on the sub-graph, given the goal/state/possible paths pick the next
step, execute, repeat — be an agent.

## Why "I am thinking of a number", as the SECOND (not redundant) validation target

`PLAN_HANOI.md` validates OPEN-LOOP planning: Towers of Hanoi's entire optimal move sequence can
be computed up front from the start state alone — no new information arrives mid-execution, so
"repeat" there just means "execute the next precomputed step."

"I am thinking of a number [between 1 and N]" is the complementary CLOSED-LOOP case: each guess is
an action whose EFFECT is not a state the agent already knows in advance — it returns a fresh
observation ("higher"/"lower"/"correct") that must be folded back into the agent's belief about
the hidden state before the NEXT step can even be chosen. This exercises the "repeat" part of the
loop for real (sense → update belief → re-plan → act), which Hanoi's fully-determined solution
path never has to. A design that only handles Hanoi's shape risks silently assuming the whole plan
is computable in one shot; this second target forces the design to handle genuine
observe-and-replan behavior.

Secondary reasons it's a good second harness:
- Trivial to represent: state = a bounded numeric range (belief interval), not a graph structure —
  a useful contrast case to Hanoi's graph-shaped state, testing whether the planning-loop design
  generalizes across state SHAPES, not just across problems with the same shape.
- The textbook-optimal strategy (binary search, halving the interval each guess) has a known
  closed-form bound (⌈log2 N⌉ guesses) — same unambiguous correctness/optimality check Hanoi's
  2^n − 1 gives, ported to the closed-loop case.
- Cleanly exercises "confirm before acting" questions for real: each guess is an observable action
  with a real (if trivial) cost, a natural fit for whatever confirmation/execution-gating policy
  the Hanoi doc's open questions flag for action execution generally.
- Zero-LLM constraint stays intact — the optimal strategy is pure deterministic arithmetic
  (interval bisection), not a judgment call, so this stays in-ethos the same way Hanoi does.

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
as two branches (`game.mode === "guesser" | "thinker"`) of one mechanism, not two features, and one
new session-state slot (`game`, see §1) serves both — the THREADING question is role-agnostic even
though the per-turn LOGIC is not.

### 1. Where the state lives, turn to turn

`runTurn`'s `focus`/`last` threading (`src/chat.mjs`, `runTurn` around line 4595 and `createSession`
around line 4866) is the existing precedent for turn-to-turn continuity, and it is worth being
precise about its actual shape before deciding whether to reuse or extend it:

- `focus`/`last` are plain **closure-local variables inside `createSession`'s returned handle**
  (`let focus = null; let last = null;` — chat.mjs:5011-5012), not anything read from disk. Each
  `turn(line)` call passes the CURRENT values into `runTurn(line, { …, focus, last, … })`;
  `runTurn` returns `{ focus: nextFocus, last: nextLast, … }`; the handle reassigns its closure
  variables from that return (chat.mjs:5046-5048). This is a pure in-process relay — nothing about
  it writes belief state to `.tmct/`.
- `last` is `{ query, answer, detail }` (`withLast`, chat.mjs:4621-4636), and `detail` already
  carries one precedent for smuggling STRUCTURED (non-prose) continuation state through it: the
  pagination field `detail.pending = { items, noun }` (chat.mjs:4573-4593), consumed by a later
  bare "more" turn (`MORE_RE`, chat.mjs:4655-4658) and otherwise silently dropped by any other
  query (a fresh `last` without `pending` clears it by construction — chat.mjs:4575-4576 says so
  explicitly: "Any other (real) query produces a fresh `last` without `pending`, so the remainder
  is naturally cleared — no stale continuation").
- Session persistence (`src/sessions.mjs`) is a SEPARATE, one-way, write-only channel: it upserts a
  `Session` individual + `mgx:asksAbout` edges into `.tmct/graph.json`, and folds turns into
  `.tmct/memory` as Utterances (`recordSessionMemory`) — for PROVENANCE ("what did this session ask
  about"), never for reconstituting `focus`/`last`/game state on resume. There is no code path that
  reads a prior session's sidecar back into a live `createSession` call. Confirmed by reading the
  whole file: `readSessionRecords`/`foldInSessions` only fold entity-reference edges into a fresh
  graph rebuild, never conversational continuation. **So today, `focus`/`last` — and any belief
  state riding alongside them — do not survive a process restart, full stop; that is the existing,
  accepted behavior, not a gap this feature needs to close.**

**Recommendation: a new, parallel, top-level session-state slot, not an overload of
`last.detail.pending`.** Reusing `pending` would work mechanically (it already proves "arbitrary
structured continuation state through `last`" is a supported shape) but is the wrong ABSTRACTION:
`pending`'s whole contract is "the untouched remainder of the CURRENT listing, cleared the moment
any other real query is asked" — exactly the behavior a multi-turn game must NOT have (the game
must survive an aside like "what does this module export" mid-game without being silently
discarded, and must NOT be interpreted as a listing remainder by `morePage`). Instead, add a
`game` field threaded through the **exact same wiring pattern** already proven for `focus`:

- `createSession`: `let game = null;` alongside `let focus = null; let last = null;`.
- `runTurn(input, { …, focus, last, game, … })` accepts it, threads it through `ctx`, and returns
  `{ …, game: nextGame }` from every return site (most turns pass `game` through unchanged, the
  same way most turns preserve `focus`).
- `turn(line)` reassigns `game = nextGame` alongside its existing `focus`/`last` reassignment
  (chat.mjs:5046-5048).

This is structurally identical, low-risk wiring (proven by `focus` already working this way) but
semantically independent of `pending`/`last`, so it can have its OWN clearing rule ("cleared only
by an explicit '/stop game', a completed win, an abandoned give-up, or a NEW game-opening phrase" —
never by an unrelated query in between). Persistence stays in-memory-only, matching `focus`/`last`'s
existing behavior exactly — no change to `sessions.mjs` is needed for this to work; a resumed
process loses an in-progress game the same honest way it already loses `focus`. That limitation is
called out explicitly in Open risks below rather than silently engineered around.

`game` shape (either mode):
```
{ mode: "guesser" | "thinker", n: <upper bound>, lo, hi, guesses: <number>,
  secret?: <number>,        // thinker mode only — the committed ground truth
  lastHint?: "higher"|"lower"|"correct", // thinker mode only — for false-claim rebuttal (§4)
  won: boolean, gaveUp: boolean }
```

### 2. Recognizing the game (opening move + continuation)

This is a closed-set recognition problem of the same shape as every other routing fix landed this
session (the existence recognizer, `looksLikePredicateFind`'s find-vs-find precedence, `MORE_RE`) —
not a general-grammar extension, consistent with `tmct-prefers-templates-over-general-rules`.

**Opening phrasings** (checked once, at the START of `runTurn`, BEFORE `assertTurn` — a stray
"I'm thinking of a number between 1 and 100" must not be misparsed as a declarative ACE sentence to
teach, and BEFORE `runAsk` for the same reason a bare command word is checked first):
- Guesser-mode trigger (human holds the secret, tmct guesses): "I'm thinking of a number [between
  1 and 100][, you guess]", "guess my number", "guess the number I'm thinking of".
- Thinker-mode trigger (tmct holds the secret, human guesses): "think of a number [between 1 and
  100]", "pick a number and I'll guess — wait, you guess" — i.e. "think of a number, I'll guess"
  reframes it as thinker mode with the RESPONDER (tmct) committing the secret; "guess a number and
  I'll tell you higher or lower" is the same thinker-mode ask phrased around the human's action
  instead of tmct's.
- Both forms accept an explicit bound ("between 1 and 100", "up to 50") with a sane default (100)
  when omitted, mirroring how other bounded-count lanes in this codebase default rather than
  refuse when a parameter is left off.

**Continuation phrasings** (checked EARLY in `runTurn`, gated on `ctx.game` being non-null, at the
same precedence tier as the existing `MORE_RE` check — i.e. right alongside it, both being
"does the previous turn leave a structured continuation the current bare reply feeds," chat.mjs
~4652-4659):
- Guesser mode expects a closed-set observation reply from the human: "higher"/"too low"/"bigger",
  "lower"/"too high"/"smaller", "correct"/"yes"/"you got it".
- Thinker mode expects a bare number as the human's guess (parsed the same way an ordinary count
  argument is parsed elsewhere in this codebase — no new number-parsing machinery needed).

Both the opening-phrase and continuation recognizers are new, additional closed-set regexes/tables
in `chat.mjs`, following the existing convention (`MORE_RE`, `BARE_WHATIS_RE`, `GENERAL_VERB_TEACH_RE`
precedent) — no new dependency, no probabilistic matching.

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
unambiguous closed-form correctness check `PLAN_HANOI.md`'s `2^n − 1` gives for Hanoi, ported to the
closed-loop case exactly as the Origin section anticipated.

**The degenerate/dishonest-input case, precisely**: after applying an update, if `lo > hi` the
interval is EMPTY — no number satisfies every observation given so far, which means the human's
answers are mutually inconsistent (a lie, a mis-click, or a change of mind mid-game). tmct must
detect this ARITHMETICALLY (the same `lo > hi` check the update rule already computes, not a new
subsystem) and respond the way this project's ethos already establishes for a checkable-but-false
premise: an honest, specific refusal to keep guessing under a false premise, in the same register as
the existence-question fix (`d1491e6` — "never render a wrong answer as if it were verified") —
e.g.:

> "That's not possible — you said higher than 62, and now lower than 55, but no number can be both.
> One of those two answers must be wrong. Want to restart, or correct one of them?"

This should name the SPECIFIC contradicting pair (the guess/observation that set `lo`, and the one
that set `hi`, both already on hand from the update rule — no reconstruction needed), never a
generic "something's wrong," and it should stop guessing rather than guess into the empty interval
(which would silently fabricate a next move on top of a premise tmct already knows is false).

### 4. Thinker mode — commitment, comparison, and its own honest edge cases

Thinker mode carries **no search or belief-narrowing at all** — tmct already has the ground truth,
so each turn is a single deterministic comparison, not a re-planning step. This is the intended
asymmetry the operator's scope note calls out: it validates that the SAME session-state slot
(`game`) can carry either a search-in-progress OR a single committed fact, without the mechanism
caring which.

- **Commitment**: on the opening thinker-mode turn, tmct picks `secret = 1 + Math.floor(Math.random()
  * n)` and stores it on `game.secret`. This is ordinary product code inside `chat.mjs` (not the
  Workflow/offline-eval harness this project restricts LLM/non-determinism to), so plain
  `Math.random()` is an acceptable, unremarkable source of randomness here — no seeding or
  determinism constraint applies to picking a party game's secret number.
- **Per-turn comparison**: parse the human's line as an integer guess; compare to `game.secret`;
  answer "higher"/"lower"/"correct" accordingly; record the given hint on `game.lastHint` (needed
  for the false-claim rebuttal below); on "correct", set `game.won = true` and end the game.
- **Reveal policy**: tmct should NOT reveal the secret unprompted mid-game (that would pre-empt the
  human's own guessing, defeating the point of the game) — but SHOULD honor an explicit request to
  reveal/give up immediately, without an "are you sure?" gate. Grounding: this codebase has no
  existing ask-before-acting confirmation pattern anywhere (`teachFact` and every write-lane
  confirm AFTER acting — chat.mjs:1297-1298, 4502 area — never before), so a mid-game "just tell me
  the number" should be treated the same way: act (reveal), then state plainly what happened —
  e.g. "Giving up — the number was 42. Want to play again?" — ending `game` (`gaveUp = true`)
  rather than leaving it in an ambiguous half-revealed state.
- **Out-of-bounds guess** (a guess outside `[1, n]`): decline honestly rather than fabricate a
  higher/lower verdict for a number outside the agreed range — e.g. "142 is outside the 1–100 range
  we agreed — try a number in range." (mirrors the pronoun-subject and existence-question
  decline precedent: check the presupposition before answering, chat.mjs:2121's
  "can't check the presupposition — decline, never guess" discipline, ported here to a bound check).
- **False claim of a prior "correct"** ("you already said correct" when tmct's own record shows
  otherwise): tmct is authoritative here — it generated every hint itself, so `game.lastHint` /
  `game.won` is ground truth to check the claim against, not something to take the human's word for.
  Response should cite what tmct actually last said, e.g. "I haven't said 'correct' yet — my secret
  is still hidden; my last hint was 'lower' after your guess of 73." This is the same
  never-fabricate posture applied to tmct's own utterance history instead of the graph.

### 5. The goal line, per mode, per turn

`withGoalLine` (chat.mjs:253-269) and `deduceGoalFromParsed`/`GOAL_BY_KIND` (chat.mjs:111-161) are
built around a single deduced string computed ONCE per turn from `runAsk`'s `envelope.parsed`
shape — a stateless, single-query-shape lookup table. A multi-turn game's goal line is
fundamentally different: it must reflect the CURRENT `game` state, not a parsed query shape, and it
must be regenerated fresh every turn the game is active, whether or not that turn even reaches
`runAsk` (a continuation turn like "higher" never does — it is intercepted earlier, same tier as
`MORE_RE`).

**Recommendation**: `withGoalLine`'s plumbing (the `result.goal` string → appended suffix
mechanism) is reusable AS A RENDERER, but the goal STRING for a game turn cannot come from
`deduceGoalFromParsed` (there is no parsed query shape on a continuation turn) — it must be
computed directly by the game-turn handler from `game`'s live state and passed through the same
`result.goal` field `withGoalLine` already knows how to render. No new rendering path is needed;
what's new is a second SOURCE of `result.goal`, alongside (not replacing) `deduceGoalFromParsed`.
Concretely, per mode:

- Guesser mode: `` `narrow down your number — currently between ${lo} and ${hi}` `` each turn
  (composes exactly like the skeleton doc's own worked example — "Goal (inferred): Narrow down
  your number — currently between 34 and 66.").
- Thinker mode: reflect the LAST hint given, e.g. `` `let you find my secret number — said "${lastHint}" so it's ${lastHint === "higher" ? "above" : "below"} your last guess` ``
  on turns after the first hint, or a plain "let you find my secret number I've committed to" on
  the opening turn before any hint exists.

Both are table-driven from `game`'s own fields (never free-text generation), consistent with
`GOAL_BY_KIND`'s own "deliberately a small, honest bucket lookup … never a fabricated guess"
discipline (chat.mjs:113-116) — just keyed on live game state instead of a static parse-shape
table.

### 6. Shared vs. divergent with `PLAN_HANOI.md`

**Genuinely shared:**
- Both need a **state** representation, a **goal**-check, and a notion of **legal action** — the
  common vocabulary the operator's own framing names. Concretely, both would extend the SAME
  `withGoalLine` "Goal (inferred): …" always-on mechanism to speak about a live, in-progress
  process rather than a single answered query — the same widening of Feature B's job in both docs.
- Both need turn-to-turn (or step-to-step) continuation wiring; both this doc's `game` slot and
  Hanoi's equivalent in-progress-plan slot would follow the identical `focus`/`last`-precedent
  threading pattern through `createSession`/`runTurn` (new closure variable → `ctx` → returned →
  reassigned) — there is a real, worth-sharing STRUCTURAL pattern here even if the two payloads
  (a numeric interval vs. a move-sequence pointer) are unrelated in content.
- Both need a recognizer to detect "the user wants to start this kind of multi-step process at
  all" — a closed-set phrasing gap in both cases, not a generalized intent classifier.

**Genuinely divergent — forcing unification here would be a bad abstraction:**
- Hanoi's actions are **deterministic and fully observed**: applying a legal move to a known state
  yields another known state, so the ENTIRE solution is computable in one shot up front (Hanoi's
  own doc's framing). This game's actions yield an **observation about a hidden state**, which only
  narrows a BELIEF (an interval, in guesser mode) or resolves a single fact-check (in thinker
  mode) — there is no "whole plan" to precompute; the very NEXT action depends on information that
  does not exist until the previous action executes. A shared "action" interface that pretends
  these are the same thing (e.g. forcing both through a single `applyAction(state) -> state`
  signature) would either lose the observation/belief-update step this game's whole value lies in
  demonstrating, or force Hanoi's deterministic effects through a needless "observation" wrapper
  that adds nothing. They should share the SHAPE of the loop (state, goal, action, repeat) as
  documentation-level vocabulary, not a single executable interface.
- Hanoi's state is graph-shaped (pegs/disks, a natural fit for tmct's existing OWL individual/edge
  model per that doc's own point 1); this game's state is a bare numeric interval or a single
  scalar secret — deliberately NOT graph-shaped, which is exactly why the Origin section picked it
  as the SECOND validation target (to test the loop generalizes across state SHAPES). Concretely,
  this means the `game` session-state slot should stay its own small plain object, not be forced
  into `.tmct/graph.json` individuals/edges the way Hanoi's board plausibly could be — a different,
  lighter persistence shape for a different, lighter state shape.
- Hanoi's "confirm before executing a move" question (flagged as open in that doc) has a real
  destructive-write analogy (`teachFact`'s write-then-confirm precedent); guesser-mode guesses and
  thinker-mode comparisons are NOT destructive at all (nothing is written to the graph or memory
  store) — so this doc's answer to "should actions be gated behind confirmation" is a clean "no,
  there is nothing to gate," which is a genuine point of divergence, not an oversight.

### Phased implementation sketch (mirrors ROADMAP.md's phase-writing style)

**Phase 1 — Recognition + guesser-mode core.** Closed-set opening/continuation recognizers
(§2); `game` session-state slot wired through `createSession`/`runTurn` exactly like `focus`
(§1); guesser-mode belief interval + bisection + update rule (§3), including the honest empty-
interval refusal. No goal-line integration yet — plain confirmatory turns only. Validates the
closed-loop sense→update-belief→re-plan→act cycle end to end for the FIRST time in this codebase.

**Phase 2 — Thinker mode.** Secret commitment (`Math.random()`), per-turn comparison, out-of-
bounds decline, reveal-on-request, and the false-"you already said correct" rebuttal (§4). Shares
the Phase 1 `game` slot and recognizer precedence tier; adds no new threading.

**Phase 3 — Goal-line integration.** Extend `result.goal`'s source to include a live-`game`-state
generator (§5), composing with existing `withGoalLine` rendering untouched. Both modes' goal
strings, table-driven off `game` fields.

**Phase 4 — Generalization spike (deferred, not this doc's scope).** Once BOTH this doc and
`PLAN_HANOI.md` have independently validated their halves of the loop, revisit §6's "shared
vocabulary, divergent mechanism" finding to decide whether a genuinely general planning-loop
abstraction is warranted yet, or whether two validated special cases are still all that should
exist — consistent with Hanoi doc's own point 3 ("an explicit path to generalizing... afterward").

### Open risks / questions (refined)

- **No cross-process persistence for game state**, by design parity with `focus`/`last` — a killed
  or resumed chat session loses an in-progress game exactly as it loses focus today. Not solved
  here; if it matters later, `sessions.mjs`'s JSONL-sidecar shape is the closest existing precedent
  for what a persisted-game record could look like, but that is new plumbing this doc does not
  design.
- **Recognizer precision** (both modes' opening phrasings, and — for thinker mode — a bare integer
  reply that could ALSO be a legitimate unrelated query, e.g. "42" meaning something else entirely
  outside an active game): the continuation-turn recognizers must be gated STRICTLY on `game` being
  non-null (never fire when no game is active), the same discipline `MORE_RE` already uses against
  `last?.detail?.pending` — but within an active game, a stray unrelated question ("what does auth.mjs
  export") arriving mid-game needs a clear, explicit decision this doc flags rather than resolves:
  does it silently answer the aside and leave `game` untouched (falling through past the
  continuation recognizer, since it won't match "higher"/"lower"/a bare number), or does it need an
  explicit "still playing — say higher/lower/correct" nudge? Recommend the former (fall through,
  answer normally, `game` persists untouched) since it requires no new code beyond the
  continuation recognizer already declining to match — but flagging it here since it's a real
  design choice, not a forced one.
- **Bound sanity**: a stated bound that's degenerate (e.g. "between 1 and 1", or `hi < lo` in the
  OPENING phrase itself, or a non-numeric/absurdly large bound) needs the same honest-decline
  treatment as the mid-game contradiction case, just applied to the opening turn instead of an
  update — not designed in this pass, flagged for Phase 1's own detailed spec.
- **Multiple concurrent games**: this design assumes one `game` per session, matching `focus`'s own
  one-at-a-time precedent — starting a new game opening phrase while one is active should probably
  ask/clarify rather than silently overwrite, but which behavior is right is left as a Phase 1
  implementation decision, not resolved here.

## Non-goals for this document

- Not an implementation — no code changes land from this doc alone.
- Not a replacement for `PLAN_HANOI.md` — the two are deliberately complementary halves (open-loop
  vs. closed-loop) of validating ONE planning-loop design, not two separate features.
- Not scoped to number-guessing permanently — like Hanoi, this is a validation harness for a
  general mechanism, not a one-off toy feature.
