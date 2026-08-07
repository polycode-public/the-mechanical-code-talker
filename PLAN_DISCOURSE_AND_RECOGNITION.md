# PLAN_DISCOURSE_AND_RECOGNITION.md — two bounded records: cross-turn discourse, and goal recognition

Status: Part A slices 1–5 are all built (`src/domain/discourse.mjs`; the commit-filter lane
registers, the session shell threads the record, the temporal-comparison lane flips the frozen
row — now `games/cross-turn-temporal-composition-composes` — the listing/filter lanes register
plural `set` referents that survive a count, the superlative, qualifier, dated-fact and adventure
lanes register too, the temporal lane refuses and lists a same-turn tie rather than picking by
recency, and a plural temporal comparison (`were those before X was touched`) composes over a
plural set, quantifying the members it dates from the graph). All of Part B is still design.
Everything described as current behaviour was read off the tree and run against
`examples/mini-webapp` while this document was written.

## Why the two sit together

Both halves take something tmct currently holds implicitly and give it a bounded, typed,
**refusable** representation.

Today the conversation's established content lives in one untyped blob (`last`) plus a single focus
label. Today an agent's purpose lives in either a marker fact on a world shard or a focus entity
pulled out of the request string. In both cases the thing that matters is real, it is used, and it
has no shape you can print, enumerate, or refuse over.

The two designs are the same move applied twice:

| | discourse | recognition |
|---|---|---|
| the implicit thing | what the conversation has established | what an agent is trying to do |
| the bounded record | at most N typed referents | at most N declared goals |
| binding | a closed set of pronoun forms binds by kind, then recency | a trace fits a goal by operator containment |
| the tie | two candidates of the admitted kind: refuse and list | two goals not excluded: refuse and list |
| the honest miss | nothing in the record admits that form | the reject class (the +1) |
| its bench rung | FLOW-7 — a cross-turn query resolved through the typed discourse record | TOOL-9 — a goal inferred from an observed trace and confirmed against a bounded scheme |

The honest miss is tmct's central promise, and today it lives at the grounding wall: a query that
matches nothing gets a refusal. Both halves carry the same promise into a second place. A pronoun
that binds to two things equally well is a refusal. A trace that fits no declared goal is a
refusal. Neither is a fallback path; both are the correct answer.

Two prior plans carried these as one-line entries in a research tier (`archive/PLAN_AGENTS.md`, R1: the
DRT-lite typed discourse record, and bounded (N+1) goal recognition). This document is the design
those lines pointed at, and it is self-contained: you do not need that doc to read this one.

---

# Part A — The typed discourse record (DRT-lite)

## A1. What tmct threads between turns today

This is the precise answer, read off `src/services/chat.mjs` and `src/services/chat-session.mjs`.
Four things cross a turn boundary. Only the first two are discourse state.

**1. `focus` — one entity, or nothing.**

```js
{ id: "mod:src/core/store.mjs", label: "src/core/store.mjs" }
```

The shell holds it (`chat-session.mjs`, `let focus = null`), passes it into `runTurn`, and takes
back whatever `runTurn` returns. `runAsk` recomputes it as `newFocus` when a turn's parsed object
resolves to a graph entity, or when a superlative has exactly one winner. `nextFocus` class-gates
the update: `FOCUS_WORTHY_CLASSES` is `Module`, `Function`, `Class`, `Method`, `Attribute`,
`GlobalVariable`, and a `Commit`, `Session`, or schema node never displaces a standing code focus.
The focus is what `it`/`this`/`that` bind to, through `CONTEXT_WORDS` in `chat.mjs` and
`CONTEXT_PRONOUNS` in `src/domain/ask-vocab.mjs`. It carries an id and a label. It carries no
class, no attributes, and no history.

**2. `last` — the previous turn's answer, as one untyped object.**

```js
{
  query:    "what changed before 1b2c3d4e5f60",  // or runAsk's rewritten effectiveQuery
  answer:   "7 commit(s) changed before …",
  detail:   { traversal, matches: [...], allIds?: [...], pending? },
  grounded: "…"   // the last answer that actually answered, carried across misses
}
```

`withLast` in `runTurn` builds it. Every dispatched turn overwrites it; a conversational turn
leaves it alone. Three consumers read it:

- `runAsk` derives `prev`, the previous answer's id set, preferring `detail.allIds` over
  `detail.matches`. That array is what `ask()` receives as `opts.prev`, and it is the whole of
  what the anaphora machinery in `src/domain/ask.mjs` can see.
- `discourseRewrite` reads `last.query` as text and swaps a new subject into it, gated on
  `WHAT_ABOUT_RE`, `STACCATO_SWAP_RE`, `NAME_TOKEN_RE`, `PRONOUN_IN_QUERY_RE` and `BARE_WHATIS_RE`.
  It recently gained a guard that refuses an embedded question rather than splicing it into the
  prior turn's shape and inheriting that turn's direction.
- `superlativeRepeatRewrite` replays `last.query` verbatim when the new turn is a bare superlative.

**3. `planState` — the one game/plan/adventure slot.** Not discourse state, with one exception: a
running adventure carries `adventure.focus`, a bare object term (`"lamp"`), set by
`adventureTurn` when a world command names an object and succeeds. `bindPronouns` in
`src/services/adventure.mjs` rewrites `it`/`them`/`him`/`her` to it across three slots, and with no
focus standing returns a reference nudge rather than a vocabulary decline. This is a second focus
holder, in a second file, with a different shape and no id. It is the strongest existing precedent
for a session-scoped referent slot, and it is also the clearest sign that one slot per surface does
not scale.

**4. Session settings** — `sessionId`, `graph`, `memoryDir`, `biasByBundle`, `narrate`,
`liveReference`, `researchState`. Not discourse state.

### What that adds up to

The carry is **untyped and singular**. One focus, one previous answer, one flat id array.

- Nothing records what *kind* of thing a referent is. `prev` is an array of graph ids; the class is
  recovered later by looking each id up (`evalAnaphora`'s `sameClass`).
- Nothing records what an answer *established* about a referent. The commit-filter answer prints
  seven dates and an operator (`before`) and a pivot (`1b2c3d4e5f60`), and none of that survives the
  turn. `detail` keeps the matched entities and a traversal string.
- Nothing holds more than one referent at a time. A turn either replaces the focus or does not, and
  always replaces `last`.
- **A count erases the chain.** Verified live: `which modules import http.mjs` then `how many of
  those are commits` answers `7 commits`, then `which of those are modules` answers *"those"/"them"
  needs a previous answer to refer to*. `evalAnaphora`'s count branch returns `matches: []`, so the
  next turn's `prev` is empty and the set is gone after one hop.

## A2. The gap, walked turn by turn

The standing acceptance test was the frozen row `games/cross-turn-temporal-composition-unbuilt` in
`test/corpus/games/compositional.jsonl` (the other docs call it **row 19**) — flipped by slice 2
and renamed `games/cross-turn-temporal-composition-composes`. Its three original siblings had
been flipped first, each by a closed-template treatment over the existing carry; this one is what
made the typed record worth designing rather than widening a template again:

| frozen row | what flipping it took |
|---|---|
| `games/honest-empty-echoes-raw-pronoun` | the honest-empty receipt names the resolved antecedent (`fnAlpha`) instead of echoing `it` |
| `games/temporal-adverb-read-as-object-term` | a trailing clause-level time adverb is stripped before the patient read, so `recently` is never resolved as a term |
| `games/bare-type-discourse-filter-narrows-prev-set` | a bare entity-type follow-up narrows the prior set, and an emptied set names the **filter's** kind, not the base set's |
| `games/cross-turn-temporal-composition-composes` | slice 2: bind the pivot through the typed record, re-read the embedded clause, compare the dates |

All three were closed-template treatments over the existing carry. Each one added a rule about
words. None of them needed anything the turn boundary was not already carrying.

### The row

```
turn 0: what changed before 1b2c3d4e5f60
turn 1: was that before logger.mjs was touched
```

**What turn 0 produces today** (real output against `examples/mini-webapp`):

```
7 commit(s) changed before 1b2c3d4e5f60: 0a1b2c3d4e5f (2026-05-21) — unit tests for tasks + store,
f6a1b2c3d4e5 (2026-05-18) — user handler, e5f6a1b2c3d4 (2026-05-15) — leveled logging,
d4e5f6a1b2c3 (2026-05-12) — http server wiring, c3d4e5f6a1b2 (2026-05-09) — task handler + base
Controller, b2c3d4e5f6a1 (2026-05-04) — add task/user validation, a1b2c3d4e5f6 (2026-05-02) —
seed core Record/Task/User models.
```

`evalCommitFilter` in `src/domain/ask.mjs` produced it. Inside that function the answer is fully
typed: an operator (`before`), a resolved pivot id and pivot date, and seven `Commit` individuals
each carrying a `date` attribute. Across the turn boundary, all of that flattens to an id array on
`last.detail.matches` and a rendered string on `last.answer`. The operator is gone. The pivot is
gone. The dates survive only as text inside a sentence.

**What turn 1 needs.** Three things, and it can get none of them:

1. **A dated referent from the record.** `that` has to bind to the pivot commit `1b2c3d4e5f60`,
   dated 2026-05-24. The pivot is a `Commit`, and `nextFocus` refuses to let a `Commit` become the
   focus while a code focus stands — correctly, because `Commit` is not `FOCUS_WORTHY`. So the only
   singular referent holder in the system is by design unable to hold it. `prev` holds the seven
   *results*, not the pivot, and `that` is singular anyway, so `ANAPHORA_TRIGGERS`
   (`those`/`them`/`these`) never fires.
2. **A fresh read.** `logger.mjs was touched` has to be answered on its own: `src/lib/logger.mjs`
   was last touched by `e5f6a1b2c3d4` on 2026-05-15. That answer exists today as a standalone turn.
3. **A comparison.** 2026-05-24 against 2026-05-15, rendered with both sides cited.

**What actually happens.** The whole line reaches the keyword-spot strategy in
`src/domain/interpret/strategies/keywords.mjs`. The bare-passive branch fires (a passive auxiliary,
a participle, no agent tail), and its patient text is `that before logger.mjs was` — four tokens. The
guard is one line:

```js
// A patient of more than one token is the wreckage of a clause no tier here
// parses. Resolving past it would cite a confident answer to a question
// nobody asked, so this declines and the sentence misses honestly.
if (beforeText.split(/\s+/).length > 1) return null;
```

So the turn misses:

```
I don't know anything about "that before logger.mjs was" yet — teach me directly, …
```

That guard is right and stays. Without it the sentence resolves past the wreckage to `logger.mjs`
and answers a question nobody asked, with full confidence. The frozen row's `answerMatchesNone`
assertions exist to keep exactly that from coming back.

### The general shape of the gap

The wreckage in that patient string is a *symptom*. The cause is that turn 1 is a composition over
turn 0's answer, and the turn boundary carries no composable form of that answer — only a rendered
sentence and a flat id list. A closed-template treatment cannot reach it, because there is no state
for a template to consult. Widening the patient guard would not help; it would remove the honest
miss and put nothing in its place.

**Today's state is untyped and singular: one focus, one prev set. What turn 1 needs is a typed
record of several referents, each with its kind and the attributes its answer established.**

## A3. The design — a bounded typed discourse record

A new pure module, `src/domain/discourse.mjs`. No I/O, no graph reads, session-scoped, never
written to `.tmct/`.

### A referent, verbatim

```js
// One discourse referent. Every field is filled at registration; a lane that
// cannot fill one registers nothing rather than a partial referent.
{
  ref:   "r7",                             // this session's handle for it, stable while it lives
  kind:  "entity",                         // REFERENT_KINDS, closed: entity | set | event | measure
  class: "Commit",                         // graph class (entity/event), member class (set), null (measure)
  label: "1b2c3d4e5f60",                   // what the answer called it
  ids:   ["commit:1b2c3d4e5f60"],          // one id for entity/event, every member id for a set, [] for measure
  attrs: { date: "2026-05-24" },           // REFERENT_ATTRS keys only, closed
  from:  { turn: 4, lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  binds: ["it", "this", "that"]            // BINDABLE_FORMS this referent answers to, by kind
}
```

And the record itself:

```js
{
  turn:      4,
  referents: [ /* newest first, at most MAX_REFERENTS */ ]
}
```

### The four closed vocabularies

Everything the record does runs off declared tables, in the tmct style: closed sets over general
rules, the same discipline `CONTEXT_PRONOUNS`, `ANAPHORA_TRIGGERS`, `QUALIFIERS` and
`ENTITY_TO_TYPE` already follow.

**`REFERENT_KINDS`** — four:

| kind | what it is | example source |
|---|---|---|
| `entity` | one graph individual | a resolved subject or object, a superlative winner |
| `set` | a result set, with every member id | a listing, a filter, a commit-filter result |
| `event` | a dated point in history | a commit, a last-touch read, a `@turnN` snapshot |
| `measure` | a number an answer produced | a count, a degree, a superlative metric value |

**`REFERENT_ATTRS`** — the closed attribute keys a lane may record: `date`, `count`, `op`,
`pivot`, `metric`, `kind` (the edge kind traversed), `provenance`. A lane with a fact that fits no
key records no attribute. Widening the record means adding a key here, deliberately, with its own
corpus row.

**`BINDABLE_FORMS`** — the pronoun and demonstrative surfaces, each declaring which referent kinds
it admits:

| form | admits |
|---|---|
| `it`, `this`, `that`, `this one`, `that one` | `entity`, `event`, `measure` |
| `those`, `them`, `these` | `set` |
| `here` | `entity` (a location-classed one) |

These are the sets already in the tree (`CONTEXT_PRONOUNS`, `ANAPHORA_TRIGGERS`), given a type
declaration each. The record does not invent a new pronoun inventory.

**`MAX_REFERENTS`** — the cap. Six, and a `tmct.toml` `[discourse] max_referents` knob, like every
other rate in this repo. Six is a working number to start from, not a finding: it holds the
referents a three-turn drill-down establishes without letting an hour-long session accumulate a
haystack. A cycle that measures binding failures against the cap is how it moves.

### How referents are introduced

Every answer that names entities registers what it established, at the point it already knows it.
The registration call sits beside the render, so the typed facts are recorded before they are
flattened to a sentence.

`evalCommitFilter`, worked through for the frozen row's turn 0, registers two:

```js
{ ref: "r1", kind: "set",   class: "Commit", label: "7 commits before 1b2c3d4e5f60",
  ids: ["commit:0a1b…", /* … 7 ids … */],
  attrs: { count: 7, op: "before", pivot: "commit:1b2c3d4e5f60" },
  from: { turn: 0, lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  binds: ["those", "them", "these"] }

{ ref: "r2", kind: "event", class: "Commit", label: "1b2c3d4e5f60",
  ids: ["commit:1b2c3d4e5f60"],
  attrs: { date: "2026-05-24" },
  from: { turn: 0, lane: "commitFilter", query: "what changed before 1b2c3d4e5f60" },
  binds: ["it", "this", "that"] }
```

The pivot becomes a referent even though it is not a result. It is what the question was *about*,
and the current focus rules deliberately refuse to hold it.

The registering lanes, in the order Part A5 stages them: the commit-filter and temporal lanes, the
listing and filter lanes (`reverseSet`/`forwardSet`/`anaphora`), the superlative winner, the
qualifier listings, the fact lanes, and the adventure's world commands.

### How referents are retired

Four rules, all deterministic, none of them a heuristic about topic salience:

1. **Cap eviction.** Registering into a full record drops the oldest referent. Newest first,
   straight FIFO on age.
2. **Same-slot replacement.** A new referent whose `kind` and `ids` match a live one replaces it in
   place and moves to the front, rather than adding a duplicate. Asking the same question twice does
   not fill the record.
3. **Topic shift.** A turn that registers a referent whose `class` differs from every live referent
   of the same `kind`, and that binds no form against the record, retires the same-kind referents.
   This is the record's one non-obvious rule, and it is stated as a closed condition rather than a
   judgement: a new set of `Module`s after a set of `Commit`s means the commit set is no longer what
   `those` refers to. Corpus rows pin it in both directions.
4. **Session boundary.** The record dies with the session, exactly as the focus does. Nothing is
   persisted, so nothing has to be invalidated when the graph is re-indexed.

### How a query binds against it

`bind(record, form)` returns one of three things, and never anything else:

- **A referent**, when exactly one live referent admits the form. Where several admit it, the most
  recent wins. That ordering is recency, the first criterion in ACE 6.7's own interpretation rule
  15 (`docs/references/schemas/ace-6.7.md`) and the criterion tmct's focus already follows.
- **A tie**, when two or more admit the form and share a registration turn. The caller refuses and
  lists them: *"'that' could mean the commit set or 1b2c3d4e5f60 — which do you mean?"* Same shape
  as the resolver's refuse-and-list on a genuine entity tie.
- **Nothing**, when no live referent admits the form. The caller falls through to the existing
  honest miss, which already names what it could not resolve.

Ambiguity is a refusal, never a pick. That is the rule the whole record exists to make possible: a
system with one focus slot cannot be ambiguous, because it has nothing to be ambiguous between, and
so it silently answers the wrong question instead.

### The frozen row, with the record in place

Turn 1 (`was that before logger.mjs was touched`) becomes a three-step composition:

1. **Bind.** `that` is singular, so it admits `entity`, `event`, `measure`. The record's live
   referents are `r1` (a `set`, plural forms only) and `r2` (an `event`). Exactly one admits the
   form. `that` binds to `r2`, the commit `1b2c3d4e5f60`, dated 2026-05-24. No tie, no guess.
2. **Read fresh.** The embedded clause `logger.mjs was touched` is a complete question the engine
   answers today: `src/lib/logger.mjs` was last touched by `e5f6a1b2c3d4` on 2026-05-15. Nothing
   new is needed; the clause runs through the same when-question path a standalone turn takes.
3. **Compare.** Two ISO dates, one comparison word (`before`), and a rendered answer that cites both
   sides:

```
No — 1b2c3d4e5f60 (2026-05-24) came after logger.mjs was last touched
(e5f6a1b2c3d4, 2026-05-15).
```

If step 1 finds nothing, or step 2 misses, the turn keeps today's honest miss unchanged. The
multi-token patient guard in `keywords.mjs` stays exactly as it is; this lane is checked before the
sentence ever reaches it, the same way `RENAME_HISTORY_RE` is checked before the ask engine because
a misread would otherwise answer first.

## A4. What the record unlocks beyond the frozen row

Each of these is reachable once the record exists, and each is a separate corpus row. None needs a
new referent kind.

**Comparison across turns.**
`which module has the most imports` → `is that bigger than store.mjs` — binds a `measure`
referent, reads the second degree fresh, compares two integers.

**Which of those, past a count.**
`which modules import http.mjs` → `how many of those are tested` → `which of those are functions` —
works today only for the first hop, because the count answer returns `matches: []`. The `set`
referent survives the count, so the third turn binds the set the second turn counted.

**Counts over a prior answer.**
`what changed before 1b2c3d4e5f60` → `how many of those touched store.mjs` — the set referent
carries all seven ids and the `op`/`pivot` attributes, so the filter runs over the real set rather
than over whatever the render happened to print.

**Temporal ordering across turns.**
`when was store.mjs touched` → `and logger.mjs` → `which came first` — two `event` referents, both
dated, both live, and the answer orders them. The plural form is unbound here, so the lane reads the
two most recent same-kind referents and states which two it compared.

**Provenance follow-ups.**
`what is a cache` → `where did that come from` — the `provenance` attribute records which pack or
teaching produced the answer, so the follow-up cites it instead of re-resolving the term.

**Pivot re-use.**
`what changed before 1b2c3d4e5f60` → `what changed after it` — `it` binds the `event` referent
(the pivot), and the `op` flips. Today the pivot is unavailable to the next turn at all.

## A5. Staging

Five slices. Each is independently testable, each is corpus-pinned, and only slice 2 changes an
existing frozen expectation.

**Slice 1 — the record, written but never read. BUILT.**
`src/domain/discourse.mjs` holds the four closed tables, `emptyRecord()`, `register()`, `bind()`
and `retire()`; the record threads through `runTurn` beside `focus` and `last`, the session shell
holds it across turns, and the commit-filter lane registers (its typed referents ride the ask
envelope's additive `discourse` field, so both ask paths register at one point in `runAsk`).
`[discourse] max_referents` resolves per session. Tests: `test/domain/discourse.test.mjs` (the
pure module) and `test/domain/discourse-commit-filter-registration.test.mjs` (the record fills
after a commit-filter turn).

**Slice 2 — the temporal comparison, which flips the frozen row. BUILT.**
One lane (`TEMPORAL_COMPARISON_RE` in `runAsk`, checked before the ask engine so the sentence
never reaches the keyword-spot strategy): a singular bindable form, a comparison word
(`before`/`after`), and an embedded passive clause. Bind, read the clause fresh through the same
when-question path a standalone turn takes, compare two ISO dates, render with both cited — the
same-day case says so rather than forcing before/after. An unbound form or a missed clause keeps
today's miss, and the multi-token patient guard stays exactly as it was. Flipped
`games/cross-turn-temporal-composition-unbuilt` → `games/cross-turn-temporal-composition-composes`
(that one row only), with the `answerMatchesNone` guards kept. Tests:
`test/domain/discourse-temporal-comparison.test.mjs` plus the corpus row.

**Slice 3 — plural binding, and surviving a count. BUILT.**
The listing/filter lanes (the simple relation-listing path in `ask()`, `evalComposite`'s generic
set fallback, `evalMembershipComposite`, and `evalAnaphora`'s own narrowed result) register a
`set` referent; `runAsk`'s `prev` derivation falls back to a record-bound `those` set only when
`last.detail.allIds`/`matches` is empty, so every working anaphora lane keeps its current path.
Closes the count-erases-the-chain behaviour recorded in A1: a set survives a count and a further
narrowing still binds it. Tests: `test/domain/discourse-plural-binding-registration.test.mjs`
plus the three new `games.compositional.anaphora` corpus rows.

**Follow-on to slice 3 (2026-07-25) — temporal comparison over a plural antecedent. BUILT.**
Slice 2's `TEMPORAL_COMPARISON_RE` binds only the singular forms and compares two single ISO dates,
so a date-filter result set (`what changed before <sha>`) that registers and survives a count had
no way to be compared as a set. `PLURAL_TEMPORAL_COMPARISON_RE` in `runAsk` is its plural sibling:
a plural bindable form (`those`/`them`/`these`), a comparison word, and the same embedded passive
clause. `those` binds the `set` referent slice 3 registers, every member is dated from the graph
(the set referent carries member ids, not per-member dates, so the dates are read here the same way
the clause is read fresh — `discourse.mjs`'s closed `REFERENT_ATTRS` needed no new key), the clause
re-runs as its own when-question, and the answer quantifies the set against that date — `Yes — all
N …`, `No — none of the N …`, or `Partly — M of the N … ; the other K did not` — with the clause
commit and its date cited. A set whose members are not all datable refuses honestly (a `Module`
listing has no dates to compare), and an unbound form, an undatable clause, or a missing graph keep
the same specific misses the singular lane makes. Checked before the ask engine for the same reason
slice 2 is, so `those before logger.mjs was` never reaches the keyword-spot multi-token patient
guard. Tests: `test/domain/discourse-plural-temporal-comparison.test.mjs` plus two new
`games.compositional.temporal` corpus rows (the composed M-of-N answer, and the undatable-set
refusal). Built against a base before slice 4 landed, so it binds by recency rather than calling
`bind()` with `{ tieRefuses: true }` — a same-turn plural tie is unreachable today anyway (no lane
registers two `set` referents in one turn), but wiring the flag in alongside the singular lane
(below) is a real, still-open remainder now that slice 4's `joinOr` helper exists to render it.

**Slice 4 — the ambiguity refusal. BUILT.**
The temporal-comparison lane calls `bind()` with `{ tieRefuses: true }` and, before its
unbound-referent miss, renders a refuse-and-list line — *"'that' could mean A or B — which do you
mean?"*, Oxford-comma "or"-joined over the tied labels — routed through the same `refMiss` helper
the lane's other declines use, so it reads as an ordinary honest miss. The clear (non-tie) path is
untouched: one admitting referent binds, several from different turns resolve by recency. Tests:
`test/domain/discourse-tie-refusal.test.mjs` — the pure `bind()` tie branch on a synthetic
same-turn record, plus a `runTurn` turn against the mini-webapp graph that refuses and lists.
The real chat-corpus tie row (a genuine same-turn tie reached through actual conversation, not a
hand-built record) is closed by slice 5a's superlative-winner registration — the first lane that
registers two singular-admitting referents in one turn, so it is what first makes a live tie
reachable — see `games/superlative-winner-and-score-tie-a-singular-pronoun` under slice 5 below.
The plural temporal lane above still binds by recency; that lane's own `tieRefuses` wiring is the
one open remainder from this slice.

**Slice 5 — the remaining lanes register. BUILT.**
The superlative lane registers its winner as an `entity` (or a metric tie as a `set`) plus the
score as a `measure`; the qualifier check registers its resolved subject either way, and the
qualifier listing its result `set`; the `when`/`who-last` fact lanes register the dated commit as
an `event`, so a standalone "when was X last touched" now feeds the temporal comparison a later
turn. The adventure's world commands drop `adventure.focus` for a real `AdventureObject` referent
in the shared record, and `bindPronouns` binds through `bind()` — all four surface pronouns
normalizing to one lane-scoped `it` probe — while keeping the reference nudge verbatim when nothing
stands. Tests: `test/domain/discourse-superlative-and-qualifier-registration.test.mjs`,
`discourse-fact-lane-registration.test.mjs` and `discourse-adventure-binding.test.mjs`, plus new
`games/compositional` and `games/adventure` corpus rows. Slice 5a registers a superlative winner
and its score in one turn — both admitting `it`/`this`/`that` — which is what first makes a
same-turn singular tie reachable; its tie corpus row is authored and rides red until slice 4.

## A6. Risks and non-goals

**This is not full DRT.** Kamp and Reyle's discourse representation structures nest: a box inside a
conditional or a negation restricts which referents are accessible from where, and the accessibility
relation falls out of that nesting. This record is flat. It has one accessibility rule, the cap, and
one ordering rule, recency. Conditional and negated contexts are a horizon, not a wall: the
literature is settled and the machinery is well understood, so the path is to add nesting to the
record when a benchmark shows a query needing it. Until then, such queries land on the honest miss
wall.

**This is not coreference by world knowledge.** *"The trophy doesn't fit in the suitcase because
it's too big"* needs a fact about trophies and suitcases, not a discourse record. Winograd-class
coreference stays a separate research horizon, and this design does not move it. Where such a query
reaches the record, the kind test either finds one admissible referent (and binds it, possibly
wrongly for a reason no discourse machinery could catch) or refuses.

**No lane that works today may regress.** The record is additive and consulted second:
`last.detail.allIds`/`matches` keeps priority in `runAsk`'s `prev` derivation; `discourseRewrite`,
`WHAT_ABOUT_RE`, `STACCATO_SWAP_RE`, `superlativeRepeatRewrite` and `evalAnaphora`'s in-sentence
candidate resolution keep their existing fast paths and are not rerouted through `bind()`. The whole
compositional lane plus `test/chatflow-*.test.mjs` is the regression bar, and it runs on every
slice.

**No persistence, no cross-session record.** The record lives in memory for one session, like the
focus. It never reaches `.tmct/`, so it can never disagree with the store and never needs
invalidating.

**Cap eviction can drop a referent the user still means.** The honest handling is the refusal
naming what the record does hold, plus the `[discourse] max_referents` knob. A silent wrong bind is
the failure this design exists to prevent; an explicit "I no longer have that" is the acceptable
cost.

## A7. Measurement

**The rung.** FLOW-7: a query whose meaning composes across several prior answers through a typed
record that tracks entities and relations turn to turn, past the prev-set anaphora the lanes
already carry. It sits above the ratcheting FLOW-0→FLOW-6 ladder
and carries no frozen regressions yet, by the defer-until-buildable rule the four benches share.

**The standing acceptance test.** `games/cross-turn-temporal-composition-composes` (formerly
`…-unbuilt`). Flipped by slice 2: the row asserts the composed comparison naming both dates, with
the `answerMatchesNone` guards kept so the old wrong reading cannot come back.

**A passing cycle looks like this:**

1. The flipped row asserts the composed answer, naming both dates, and is green. **Done (slice 2).**
2. Every other row in `test/corpus/games/compositional.jsonl` is unchanged and green, and so is
   every `test/chatflow-*.test.mjs` tier.
3. FLOW-7 gains authored cases in `test/chatflow-*.test.mjs`: at least one per A4 shape, each
   replayed as a fresh conversation with zero dead-ends and frozen as a tagged regression.
4. The ambiguity refusal has its own passing row: a genuine tie refuses and lists, and never picks.
5. `scripts/agi-scales-aggregate.mjs`'s temporal-causal depth scale moves. Its described next rung is
   *one cross-turn temporal composition (frozen row 19) and one re-solved counterfactual*; this half
   delivers the first of the two.

---

# Part B — Bounded (N+1) goal recognition

## B1. What tmct does about goals today

Three mechanisms, none of which reads a trace.

**1. `goal-reasoner.mjs` deduces a maintenance goal from a declared model.** `GOAL_RULES` holds two
frozen rules today: `coverage-invariant` (an impactful module must be tested) and
`cochange-risk-invariant` (a module change-coupled with the focus must be tested). Each declares a
`focusClass`, its modes, its sub-goals, and how to compose the gathered sides. `goalReason` binds a
focus entity out of the request, finds the applicable rules, and refuses in every open-world
direction: no applicable rule, more than one applicable rule, a focus class no rule covers, an
ambiguous focus, a sub-goal outside the declared toolset, or a tick budget exhausted. This is
tmct's closest shipped relative to goal recognition, and the difference is exact: **it reads a
request string, not an observed trace.**

**2. Autoplay infers a goal from one declared marker fact.** `src/services/adventure-autoplay.mjs`
finds the single row with predicate `mgx:is-objective` and object `"true"` under an exposure filter,
and plans toward it with `findActionPath`. Its own header says the marker is deliberately generic
rather than hard-coded to any one world, and that a world shipping no such fact has nothing for it
to infer toward. It reports a stall the moment no further move is justified. The shape is right and
the honesty is right. The scope is one world, one goal, and the goal is **declared in the world
shard**, not recovered from behaviour.

**3. Every chat turn prints a per-turn goal gloss.** `deduceGoalFromParsed` maps the parse shape to
a sentence (*"Understand a graph relationship"*). It describes one utterance and holds no state
across turns. It is not a recognizer.

So the gap: tmct **plans toward** goals well, **deduces** maintenance goals from a declared model
well, and has one world-scoped instance of goal *inference* from a declared marker. It has no
general scheme for reading an observed trace and saying what the actor is doing.

## B2. The gap, concretely

Take the plan lane. It writes `@stepN` board snapshots as a plan executes. Take the adventure. It
writes `@turnN` snapshots for every player and NPC move. Take the tool loop. `runCapabilityPlan`
returns the `calls` it executed, and the HTTP shim's transcript carries every `tool_use` block.

All three already write an ordered, on-disk record of what happened. Nothing reads any of them and
asks *what was that doing?*

A concrete case. An adventure trace reads:

```
@turn1  player  go north
@turn2  player  take key
@turn3  player  go south
@turn4  player  unlock chest with key
```

Turn 4 makes the goal obvious to a reader. To tmct it is four unrelated fold entries. Ask autoplay
and it will tell you about `mgx:is-objective`, which is a different question: that is what the
*world author declared*, not what this actor has been doing. If the actor is a human player heading
somewhere the world never marked, autoplay has nothing to say at all.

The failure mode to avoid is the obvious one. A recognizer with no legal "none of these" must return
its nearest fit for every trace, so a two-step trace that fits nothing gets reported as a goal with
the same confidence a complete trace does. That is a guess wearing an answer's clothes, and it is
exactly what the miss wall exists to prevent everywhere else in this codebase.

## B3. The design — N declared goals plus an explicit reject class

Three pure pieces, in `src/domain/router/`, none of which writes anything.

### Where the N come from

The declared goals are gathered, never invented. Four sources, all already in the tree:

| source | what it contributes | count today |
|---|---|---|
| `GOAL_RULES` (`goal-reasoner.mjs`) | maintenance goals, with their invariant and composition | 2 |
| the capability registry (`registry.mjs`) | each declared capability's add-effects name a reachable state | 16 capabilities |
| world-pack marker facts | a declared goal fact on the world shard (`mgx:is-objective` generalises to a family) | 1 per shipped world |
| taught action rules (`taught.mjs`) | a taught domain declares its own goal states in controlled English | per taught domain |

N is whatever the loaded declarations amount to. It is bounded by construction, it is enumerable,
and it must be **printable**: a bounded set nobody can list is not bounded in any useful sense. So
the design includes a surface for it — `/goals` in chat, `--goals` on `tmct plan` — that prints the
N and where each came from. That surface is also the first thing to build, because it is how every
later refusal gets read: *"the trace fits none of these six"* is only honest if you can see the six.

### What an observed trace is

A trace is derived, never recorded fresh. `traceOf(rows)` reads what the act stage already wrote:

```js
[
  { k: 1, actor: "player", action: "go",     args: { direction: "north" },        effects: [ /* … */ ] },
  { k: 2, actor: "player", action: "take",   args: { object: "key" },             effects: [ /* … */ ] },
  { k: 4, actor: "player", action: "unlock", args: { object: "chest", instrument: "key" }, effects: [ /* … */ ] }
]
```

Its three sources are the three record kinds already on disk or in hand:

- `@turnN` rows in the memory store, folded exactly as `foldWorldState` folds them (the adventure
  and every NPC pass);
- `@stepN` rows (the plan lane's board snapshots);
- the `calls` array a `runCapabilityPlan` returns, and the `tool_use` blocks in a served transcript.

The trace is bounded the same way everything else here is: a `[recognition] max_trace` cap, oldest
steps dropped first, so recognition over a long session stays a fixed-cost read.

### How a trace is scored — containment, not confidence

There is no score. For each declared goal `g`:

1. **Build `g`'s admissible plans.** `findActionPath` over the declared operators already does this,
   with `effectsOf` supplying each operator's add and delete lists. Bounded by the same `maxDepth`
   the taught lane uses.
2. **Test containment.** The trace **fits** `g` when every trace step appears in some admissible
   plan for `g`, in an order that plan admits. The test is subsequence containment over declared
   operators, so it is exact and deterministic.
3. **Exclude otherwise.** The trace **excludes** `g` when it contains a step no admissible plan for
   `g` contains, or an ordering none of them admits.

Then exactly three outcomes, and there is no fourth:

- **Exactly one `g` survives** — recognized. The fitting plan is the proof, returned in the same
  causal-link chain shape `drive.mjs` already produces, so the recognition is checkable rather than
  asserted.
- **Two or more survive** — the trace is genuinely ambiguous, which is usually true early. Refuse
  and list the survivors, the same refuse-and-list the resolver does on a tied entity. A longer
  trace narrows it; a short trace should not pretend otherwise.
- **None survives** — the **reject class**, the +1.

This is the deterministic reading of plan recognition as planning. Ramírez and Geffner compare plan
costs to get a probability over goals; taking the containment test and stopping drops the
probability and keeps the exactness, which is the trade tmct makes everywhere.

### Why the reject class is what makes it honest

Two reasons, and the second is the structural one.

**It gives the recognizer a legal way to say nothing fits.** Without it every trace maps to some
declared goal, so a partial, interrupted, or off-model trace is forced onto its nearest neighbour
and reported with the same confidence a complete trace gets. TOOL-9 grades the reject as a pass
(`{"reject": true}`), not as a failure, which is what makes rejecting a real option rather than a
penalty a recognizer will learn to avoid.

**It is what keeps N small.** A recognizer obliged to cover every trace has to grow its goal set
until it does, and the set stops being declared. A recognizer allowed to reject can hold exactly the
goals a repo, world, or toolset actually declares, and say so when a trace leaves them.

It is the honest miss, carried into recognition. A timeout is a miss, never a guess. A trace off the
declared model is a reject, never a nearest fit.

## B4. What it unlocks

**"What am I doing?" in the adventure.** A player mid-game asks and gets the goal their own trace
fits, with the fitting plan cited, or an honest *"nothing declared fits what you've done so far."*

**Autoplay reports recognition, not just a marker.** The stall line stops being *"no goal was ever
found"* and becomes *"your moves fit none of the three declared goals for this world"*, which is a
different and more useful statement.

**NPC intent.** The NPC scheduler writes the same `@turnN` facts a player move writes, so an NPC's
own trace runs through the identical recognizer. *"What is the housekeeper doing?"* becomes
answerable, from the same machinery, with the same reject class.

**Watching an external agent.** A served transcript's `tool_use` blocks are a trace. The recognizer
can say which declared capability goal a caller's call sequence fits, and reject when it fits none.
That is the natural companion to the call validation that already runs on the same transcripts.

**Resuming a plan.** A `@stepN` history plus a recognized goal is enough to say *"you were three
steps into `hanoi-3`"*, from the store, with no session state at all.

## B5. Staging

Five slices, each independently testable, each pinned.

**Slice 1 — the trace reader.** `traceOf(rows)`, pure, no recognition. Turns `@turnN`/`@stepN` rows
and a `calls` array into the ordered step list. Testable on its own against the adventure and plan
fixtures.

**Slice 2 — the declared-goal enumerator and its surface.** `declaredGoals(ctx)` gathers the N from
the four sources, and `/goals` (chat) and `tmct plan --goals` print them with provenance. Testable:
the count, the ids, and the source of each. Nothing recognizes anything yet.

**Slice 3 — containment and the reject class.** `recognizeGoal(trace, goals, ctx)` returning
`{ goal, reject, proof, why }` with the three outcomes and no fourth. The first TOOL-9 cases land in
`test-benchmarks/agentbench/cases.jsonl` here, including at least one that must reject.

**Slice 4 — autoplay re-based on the general recognizer.** Autoplay's single marker read becomes one
declared goal among N. Its behaviour on the shipped worlds must not change, pinned by the existing
adventure corpus rows.

**Slice 5 — the recognition surfaces.** "What am I doing", NPC intent, and a recognition field on
`runCapabilityPlan`'s result. The reject class renders as its own honest line everywhere, never as
a hedged nearest fit.

## B6. Risks and non-goals

**Not probabilistic plan recognition.** No priors over goals, no cost ratios, no likelihoods. The
probabilistic formulation is well-founded and the literature is settled; this design takes its
containment core and stops, because a probability tmct cannot ground is a confidence score, and the
whole product abstains on grounding rather than on a threshold.

**Not intention recognition from natural language.** The request-side reading stays
`goal-reasoner.mjs`'s job, and this half never touches it. Recognition reads traces.

**Not open-world goal generation.** `goalReason` already refuses at that seam and keeps refusing.
Recognition does not widen N by inventing a goal to fit a trace; that is the exact move the reject
class exists to forbid.

**The goal-reasoner's shipped numbers are the regression bar.** 68/68 across TOOL-0 to TOOL-8,
`rungReached: TOOL-8`, `gatedAt: null`, 0% hallucination. Recognition is additive: it must reach
none of the refusal paths `goalReason` already holds, and the agentbench run must be byte-comparable
on the existing rungs.

**The trace reader stays read-only.** It folds rows the act stage wrote. It writes nothing, so
recognition can never change what it is recognizing.

**A trace says what an actor did, not what they wanted.** An actor whose moves fit a declared goal
is reported as fitting it, and a deliberately misleading trace will be read at face value.
Recognition under deception is a research horizon: the literature on adversarial and obfuscated plan
recognition is active, and until a tier is designed for it the recognizer reports containment and
says so in its `why` line, which is a true statement about the trace either way.

## B7. Measurement

**The rung.** TOOL-9: infer the goal from an observed action sequence, then confirm it against a
bounded scheme — N declared goals plus an explicit reject class — rather than force-fit a partial
trace to the nearest goal. Its expect shape: `expect.inferredGoal` names the recognized goal or
the reject class,
`{"inferredGoal":"restock","reject":false}` for a fitting trace and `{"reject":true}` for one that
fits none.

**A passing cycle looks like this:**

1. TOOL-9 cases exist in `test-benchmarks/agentbench/cases.jsonl`, appended (never edited into existing rows), with
   the addition recorded in the write-up. At least one case must reject, and at least one must be
   ambiguous and refuse.
2. The goal driver reads `rungReached: TOOL-9` in `test-benchmarks/agentbench/envelope.json`, regenerated
   deterministically.
3. Hallucination stays 0%. A goal recognized outside the declared N+1 set fails outright, by the
   measurement contract that already governs every rung.
4. A forced nearest fit fails. A case whose trace fits nothing and gets a named goal back is a
   failure even when the named goal is the plausible one.
5. `scripts/agi-scales-aggregate.mjs`'s goal-origination distance moves from notch 2 to notch 3, whose
   described criterion is *a goal inferred from an observed trace (TOOL-9)*.

---

# Shared: the literature this leans on

`docs/references/` holds nothing on discourse representation or plan recognition today. It does hold
`schemas/ace-6.7.md`, whose interpretation rule 15 (*anaphora resolve by accessibility, recency,
specificity, reflexivity*) is the closest existing note to Part A's binding rule, and
`planning/BDI_GOAL_DRIVEN_AUTONOMY.md`, whose BDI and goal-driven-autonomy sources already back
`goal-reasoner.mjs`.

The candidate sources below are named so a future session does not rediscover the field from
scratch. Each needs a verified reference note in `docs/references/` before it is cited on any
reader-facing surface, under the repo's existing rule that an unverified citation is a good-faith
stub rather than a citation.

**For the discourse record:**

- Kamp, H. & Reyle, U. (1993), *From Discourse to Logic*, Kluwer — DRT itself, and the source of the
  box nesting and accessibility relation Part A deliberately flattens.
- Grosz, B.J. & Sidner, C.L. (1986), *Attention, Intentions, and the Structure of Discourse*,
  Computational Linguistics 12(3) — the focus stack, which is the closest published relative of
  tmct's single `focusLabel`.
- Grosz, B.J., Joshi, A.K. & Weinstein, S. (1995), *Centering: A Framework for Modeling the Local
  Coherence of Discourse*, Computational Linguistics 21(2) — the salience ordering behind binding
  by recency.

**For goal recognition:**

- Kautz, H. & Allen, J.F. (1986), *Generalized Plan Recognition*, AAAI-86 — the deductive,
  set-containment formulation, which is the closest published shape to Part B's design.
- Ramírez, M. & Geffner, H. (2010), *Probabilistic Plan Recognition Using Off-the-Shelf Classical
  Planners*, AAAI-10 — already named as TOOL-9's grounding, and the source of the
  plan-recognition-as-planning framing Part B takes deterministically.

# Cross-references

- `scripts/agi-scales-aggregate.mjs` — temporal-causal depth (Part A) and goal-origination distance
  (Part B); both scales' next rungs are what these two halves deliver.
- `test/corpus/games/compositional.jsonl` — the flipped acceptance row
  (`games/cross-turn-temporal-composition-composes`) and its three earlier-flipped siblings.
- `test/chatflow-*.test.mjs` — where FLOW-7's authored cases (A7) land as frozen regressions.
- `docs/references/schemas/ace-6.7.md` — interpretation rule 15, the binding rule's grounding.
- `docs/references/planning/BDI_GOAL_DRIVEN_AUTONOMY.md` — the meta-loop `goal-reasoner.mjs`
  implements, which recognition sits beside rather than replaces.
- `PLAN_FILLER_AND_COUNTERFACTUALS.md` — the same closed-set-templates-first discipline, applied to
  a different chat-layer gap.
