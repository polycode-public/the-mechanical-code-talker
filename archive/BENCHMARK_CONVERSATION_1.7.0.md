# BENCHMARK_CONVERSATION_1.7.0 — persona-sweep, 4 personas, 4 dead-ends fixed and shipped, 1 in progress

**CORRECTION (capability audit, 2026-07-11, pinned `981c9b2`/v1.7.3):** two claims below were already
stale at the moment this report was committed (`d362a4c`), not just stale now — a later commit in the
same session superseded them before this file landed. (1) "In progress, not shipped" item 3
(bare-known-entity-name → describe/focus) shipped in commit `76b0a0d`, ~23 seconds before this report
was committed — confirmed live in `src/chat.mjs`'s `runAsk`. (2) The "2 test failures, not yet fixed"
claim was already resolved by commit `d955b25` (which updated `test/showcase.test.mjs`'s assertion
for the same ambiguity-render change this report itself describes), landing before this report was
committed. Current `npm test`: 1919/1919 green, 0 failures. Leaving the narrative below unedited —
it's what this session's own persona-sweep actually found — this note is the correction of record,
per this project's own convention (see `BENCHMARK_CEFR_ENGLISH_1.7.0.md`'s own correction note for
the same pattern).

**Headline:** persona-sweep mode (§3.4), 6 personas dispatched in parallel, 2 dropped mid-run by
operator instruction (deliberate breaker, skeptical boundary-tester — removed from both the results
and `SKILL_BENCHMARK_CONVERSATION.md`'s persona list). 4 personas completed: total stranger, pure
small talk (Tier 0, both seed states), non-native English speaker, rushed fragment-typer. 23 dead-ends
found across the four transcripts. Two real fixes shipped as separate commits; a third fix in progress
was uncommitted when this report was cut. This run predates `SKILL_BENCHMARK_CONVERSATION.md`'s
2026-07-11 re-scope to measure-and-document-only — it still fixed inline, which is exactly what made
its own runtime unpredictable and triggered the re-scope. Every future run of this skill will not fix
inline; findings will route to `SKILL_AGENT_FAST_LOOP.md` or a `PLAN_*.md` instead.

## Per-persona breakdown

**Total stranger** (generic real-world facts, no code vocabulary) — tmpdir
`tmp.B1bQ3eqRcF/mw`. Canonical "john is a man" → "what is john" flowed correctly (confirms commit
`803c4ba`'s fix holds live). 

**Pure small talk, no code intent** (Tier 0, both seeded and `TMCT_NO_SEED=1`) — no `--repo`. Found
the most severe bug of the sweep: `"good day to you"` (a plain formal greeting) got misread as a
farewell and killed the session — all further piped input silently vanished with no log entry.
Also found greetings-with-a-tail (`"can you review my code for me"`, `"g day mate, you alright?"`)
silently absorbed into garbled "remembered" facts instead of being declined or answered. The
not-an-llm identity question was phrasing-fragile: `"are you chatgpt"` worked, `"are you an AI? like
chatgpt?"` didn't. 4 of 14 turns were dead-ends.

**Non-native English speaker** (natural ESL grammar, exploring `examples/mini-webapp`) — tmpdir
`tmp.GR4yQ8qeQW/mw`. A plain opening greeting hit the grammar wall. ESL trailers broke two
otherwise-working shapes: `"what is a class, please explain"` (the trailer got folded into the term
itself) and `"please learn this: John is a man"` / `"please learn also: a man is having two legs"`
(the prefix broke teach recognition entirely — this persona never got to test teach-then-INFER because
both teach attempts died upstream). A file-vs-symbol anaphora scoping miss: after "where is it
defined" resolved to a file, "what this file is importing" stayed pinned to the method, not the file.
6 of 13 turns were dead-ends;

**Rushed fragment-typer** (terse, typo-heavy) — tmpdir `tmp.iJuOC1XOtn/mw`. Confirmed the SAME
garbled-teach-absorb bug the small-talk persona found, independently, twice: `"impact if i change
it??"` → `"noted — remembered: impact ifs i change it"`, and `"defs in model.mjs"` → `"noted —
remembered: defs ins model.mjs"` — cross-persona confirmation made this the sweep's highest-signal
finding. A bare class/entity name with no verb at all (`"task"`, `"usercontroller"` — both real
classes) got no describe/focus treatment, just the generic blurb. Several typo-tolerance near-misses
(`"who touchd dat"`, `"wat about store.mjs"`, `"cochange w/ wat"`, `"inherits wat"`, `"tests 4 it"`).
10 of 13 turns were dead-ends.

## Fixed and shipped this run

1. **The garbled-teach-absorb bug (highest signal — 4 independent hits across 2 personas).** A
   teach/remember fallback was silently absorbing ordinary non-assertion sentences (questions,
   requests, greetings-with-a-tail) as if they were taught facts, storing garbled text with no
   error or nudge — confident-wrong, not just a miss. Fixed in `src/chat.mjs`'s `generalVerbTeach`,
   narrowed to only fire on sentences matching a real assertion shape. Commit `f9607d9`.
2. **`"good day to you"` session-killing farewell misfire, and the possessive-named-instance teach
   wall.** Fixed together: the farewell matcher no longer treats a plain formal greeting as an exit
   trigger, and `"my <class> <name> is a <class>"` now teaches correctly (the same "X is a Y"
   assertion, just wrapped in a possessive intro clause). Commit `1ccd298`.

## In progress, not shipped

3. **Bare known-entity-name → describe/focus** (`"task"`, `"usercontroller"`). An 18-line addition
   to `src/chat.mjs`'s `runAsk` was mid-flight when this report was cut — routes a bare, unadorned,
   case-insensitive match against a real Class/Function/Method/GlobalVariable/Attribute name to the
   same `metaFallbackEntityAnswer` describe-style answer. **Not committed. Two tests currently fail
   against the working tree as a result of an unrelated concurrent fix (see below) — this item needs
   a fresh, isolated pass**, not a resumption of the killed agent.

## Test status at time of writing — 2 failures, both pre-existing test assertions pinned to the OLD ambiguity-render format

`npm test`: 1915/1917 passing. Both failures are `test/showcase.test.mjs:115` and
`test/chatbench-levers.test.mjs:133`, and both fail for the same reason: a separate fix landed in this
same session (`src/ask.mjs`'s ambiguousParse renderer now resolves and shows every candidate reading's
real answer, not just a bare "could mean X or Y — try rephrasing" hedge — see the
`BENCHMARK_CEFR_ENGLISH_1.7.0.md` correction note for the full story) changed the ambiguity-surround
answer shape. These two tests still assert the OLD bare-hedge text (`/try rephrasing more
specifically/`, `doesNotMatch(/read as/)`). **Not yet fixed** — needs the same treatment as the three
tests already updated for this (`test/chat-cefr-1.6.1-decision-log.test.mjs`): update the assertions
to match the new, better behavior, don't revert the fix.

## Routed backlog — findings not fixed this run

- **ESL phrasing breaks recognition**: `"what is X, please explain"` (trailer folded into the term),
  `"please learn (this/also):"` prefix breaking teach recognition. → route to
  `SKILL_AGENT_FAST_LOOP.md` (small, local routing gap).
- **File-vs-symbol anaphora scoping miss**: focus stays pinned to a method after a "where is it
  defined" answer names the containing file. → route to `SKILL_AGENT_FAST_LOOP.md`.
- **Fragment-typer typo-tolerance misses**: `"who touchd dat"`, `"wat about store.mjs"`, `"cochange
  w/ wat"`, `"inherits wat"`, `"tests 4 it"`. → route to `SKILL_AGENT_FAST_LOOP.md`.
- **Identity-question phrasing fragility**: `"are you an AI? like chatgpt?"` fails where `"are you
  chatgpt"` works. → route to `SKILL_AGENT_FAST_LOOP.md`.


## Ladder position

Not run as a ladder pass — persona-sweep mode only, per the default single-run invocation.

## Next

Re-run item 3 (bare-entity-name describe) as a fresh, isolated `SKILL_AGENT_FAST_LOOP.md` round, not
a resumed agent. Fix the 2 stale test assertions from the ambiguity-render change. Then route the five
the findings above through `SKILL_AGENT_FAST_LOOP.md` rounds before the next persona sweep.
