# BENCHMARK_CONVERSATION_3.0.10 — persona sweep, 6 frames re-run on the fixed 3.0.3 surfaces; 45/50 turns FLOW, 4 confirmed fixes, 2 new routed dead-ends (2 more noted and explicitly dropped, not chased)

**Mode:** persona-sweep (§3.4, the default for one run). Six frames, each a genuinely
independent background sub-agent driving the real product path (`node bin/tmct.mjs chat`
against an isolated tmpdir copy of the committed `examples/mini-webapp` fixture — never the
committed fixture directly), dispatched in parallel. Same six frames as the 3.0.3 sweep
(architecture-newcomer, vocabulary-learner, code-explorer, git-historian, stranger-teach,
rushed-developer), each seeded to specifically retest the four dead-ends 3.0.3 found and
routed, plus one frame (code-explorer) deliberately pushed into FLOW-4 compositional/
comparative territory — 3.0.3's own "Next" section named this as unprobed. Judging (FLOW vs
DEAD-END per §0's rubric) was done by the coordinator directly, reading every transcript —
no separate pinned-model judge pass ran this cycle (3.0.3's was an added rigor step, not the
skill's baseline mechanism, which is coordinator appraisal).

**Headline: all four of 3.0.3's routed dead-ends are now confirmed fixed in live conversation,
and the plural temporal-comparison lane fixed this same session got naturally exercised for
the first time.** "give me an overview of this project" now routes to the architecture
overview; "what are the packages here" and "list the packages" both correctly enumerate
packages; "thanks bye" now closes the session cleanly; "what is a cache" now carries the
"General vocabulary, not from this codebase" cue. The sweep also surfaced two new routable
dead-end classes (none from the four confirmed-fixed surfaces), plus an irregular-sign-off
finding this skill's own discipline says to note and drop rather than chase — detailed below.

## Timing

Date **2026-07-27**. `package.json` version measured: **3.0.10**.

- **Play-throughs:** six persona sub-agents dispatched in parallel this session; the longest
  ran approximately 2.8 minutes wall-clock (stranger-teach), the shortest approximately 45
  seconds (code-explorer). Exact UTC dispatch/return timestamps were not captured this cycle —
  reporting sub-agent-measured durations instead of fabricating precision the run doesn't have.
- **Analysis and write-up:** immediately following, same session, reading all six transcripts
  directly (no separate judge pass).

## Coverage

Six frames, 50 turns. Every frame opened with a greeting; five of six closed with an explicit
farewell turn (code-explorer's frame ended on an acknowledgment rather than a full close —
not itself a gap, just a frame-authoring choice). Two frames carried teach-then-INFER pairs
(stranger-teach: the canonical syllogism and a generic poodle/dog/animal chain). One frame
(git-historian) carried the temporal-comparison lane, including a **plural** cross-turn
comparison over a three-commit set — the first time this benchmark has seen that shape
actually asked in a live conversation, not just exercised as a unit test.

## Per-frame breakdown (ranked by dead-ends found)

### stranger-teach — 9 turns, 2 DEAD-END

The mandatory canonical example (§0.1) and a second teach-then-INFER chain were both flawless:
"john is a man" / "every man is mortal" / "is john mortal" → correctly infers and cites both
hops; "a poodle is a dog" / "a dog is an animal" / "is a poodle an animal" → same. Two identity/
meta questions, phrased colloquially rather than in a canonical form, both fell through to the
graph-query wall:

- **"hello there, what am I talking to?"** — parsed as a graph query about the token "I"
  ("no module matching 'I' found in the index"), not recognized as an identity question at all.
- **"what even is this thing, like what does it do?"** — hit the plain grammar wall
  ("couldn't parse this as a graph question").

### code-explorer — 11 turns, 0 clear DEAD-END, 2 named-ceiling turns with a weak nudge

The straight code-index drill-down family was clean end to end, including anaphora ("what
calls it" correctly resolved to the just-located `loadStore`) and an honest, reasoned empty
("TaskController has no contains edges in the index"). Pushed deliberately into FLOW-4
compositional/comparative territory (unprobed by 3.0.3):

- "which module has the most imports" → correct superlative answer (`src/handlers/tasks.mjs`,
  5 imports). **FLOW — this is new, clean FLOW-4 coverage.**
- "what are the public methods of TaskController" → "Controller.handle()." Verified against
  the fixture graph directly: `TaskController` has no own `contains` edges, but it `inherits`
  `Controller`, which itself `contains` `Controller.handle` — the answer correctly walked the
  inheritance chain. **Not a dead-end; a genuine positive finding** (inherited-method
  resolution working correctly under a compositional list query).
- "which functions call loadStore and are untested" and its anaphoric follow-up "which of
  those are tested" both returned a generic "nothing in the index matches that... Try 'who
  touched \<a module\>'" — checked against the fixture: this graph's `tests` edges are
  **module-level only** (`test/tasks.test.mjs` tests `src/handlers/tasks.mjs` as a whole), with
  no function/method-level test-coverage edge at all. The absence is real, not a phrasing
  miss — but the offered nudge ("who touched a module") doesn't address what was actually
  asked (test coverage, not commit history), so it's a weak, mismatched nudge rather than a
  genuinely bare wall. Named as a low-priority clarity item, not a routing dead-end.

### git-historian — 7 turns, 1 DEAD-END

The temporal-comparison lane, threaded live end to end against real commit hashes pulled from
the fixture: a dated commit-filter pivot, two anaphoric before/after comparisons ("was that
before logger.mjs was touched", "was it after store.mjs was touched"), a plain history query,
and then — the first live test of the **plural** lane — "were those before test/store.test.mjs
was touched", correctly comparing all three commits from the prior turn's set against a freshly
read date. All FLOW. One dead-end at the close:

- **"thanks, that's all i needed"** — hit the plain grammar wall instead of closing.

### vocabulary-learner — 8 turns, 1 DEAD-END

The digest read-back family confirmed clean: `what is a cache` now carries the "General
vocabulary, not from this codebase" cue after its Wikipedia extract and source line — the
3.0.3 judge-flagged clarity nit is resolved. `what is model.mjs` and `what does validate.mjs
do` both read module digests back correctly; `what is a queue` reads its ConceptNet-sourced
term back correctly. One dead-end:

- **"thanks, that's all for now"** — same class as git-historian's finding above: hit the
  plain grammar wall instead of closing. **Found independently by two personas** — per §3.4's
  own ranking rule, this is the highest-signal finding this cycle.

### rushed-developer — 6 turns, 0 DEAD-END

Terse, typo-heavy input all landed cleanly: "wat about validate" resolved to the module report,
"whats in users.mjs" and "who uses Task" both answered correctly, "are you an LLM" gave the
no-LLM identity answer, and **"thanks bye" closed the session cleanly** — confirming this
session's fix for the exact dead-end 3.0.3 found outside its own frames.

### architecture-newcomer — 9 turns, 1 DEAD-END, 1 disputed

**All three of 3.0.3's FLOW-3 findings confirmed fixed:** "give me an overview of this
project" now routes to the real architecture overview (12 modules, 5 packages, hub modules by
importer count); "what are the packages here" and "list the packages" both now correctly
enumerate the five real packages. The drill-down family (`which modules are in src/core`,
`what functions are in tasks.mjs`) and a mid-conversation acknowledgment ("thanks, that's
helpful") all flowed. Two probes at the end, testing phrasing robustness on working query
shapes:

- **"what does tasks.mjs actually do internally"** — a natural variant of the already-working
  "what does X do" shape (confirmed working verbatim in vocabulary-learner's frame, "what does
  validate.mjs do"), but with "actually"/"internally" inserted. Got the bare, generic wall
  message, byte-identical to a fully-unrecognized query. **Dead-end: a phrasing-robustness gap
  on an otherwise-working capability**, not a missing one.
- **"is there a main entry point I should look at first"** — also failed to parse, but with a
  slightly different, if still generic, response ("still couldn't parse that — /help lists
  every query shape"). Disputed call: "entry point" isn't a concept this graph's schema
  models at all (no `bin`/entry-point extraction), so an honest miss is arguably correct here
  — named as a horizon rather than counted as a routing dead-end, the same "genuine ceiling,
  not a wall" treatment 3.0.3 gave the cache-digest nit.

## Ladder position reached

**FLOW-3 ratchets clean this cycle.** Both of 3.0.3's FLOW-3 routing gates (overview-of-project,
packages-as-listable-kind) are fixed and confirmed live; the fresh architecture-newcomer frame
replays the exact previously-broken phrasings with zero dead-ends. Criterion 2 (frozen
regressions green) holds: the 33 existing `test/chatflow-*.test.mjs` cases — including
`test/chatflow-codeindex-architecture-digest.test.mjs` and
`test/chatflow-flow0-identity-smalltalk-closing.test.mjs`, both landed earlier this session —
all still pass on this tree.

**The ladder now gates at FLOW-6** (the messy real user / surface-variation territory), where
this cycle's two routed dead-end classes sit: the identity-question phrasing gap ("what am I
talking to", "what even is this thing") and the "what does X do" adverb-insertion gap (the
irregular-sign-off finding is noted above but explicitly not routed, per this skill's hardened
discipline). FLOW-4 (compositional & comparative) got its first live
probe this cycle and flowed clean on every clear-cut case (superlative ranking, inherited-method
resolution) — not yet ratcheted (needs at least three fresh conversations at this tier per the
ratchet criterion, this cycle only ran one), but a strong first result with no frozen-regression
debt yet to satisfy criterion 2. FLOW-7 (typed cross-turn discourse) continues to hold, now with
the plural-set comparison naturally exercised in a live conversation rather than only present as
a unit test.

## Routed backlog

Every row is mirrored into `NEXT.md` as part of landing this report.

| # | Finding | Class | Route |
|---|---|---|---|
| 1 | "what am I talking to?" / "what even is this thing, like what does it do?" — colloquial identity/meta questions parse as graph queries or hit the plain wall instead of an identity answer | routing gap (FLOW-0, identity family) | NEXT — extend the identity/meta intent recognizer to colloquial phrasings |
| 2 | "what does tasks.mjs actually do internally" — an adverb-inserted variant of the working "what does X do" shape gets the bare generic wall | routing/fuzzy-match robustness gap | NEXT — extend the bounded-fuzzy tolerance for the "what does X do" shape |
| 3 | (low priority) the compositional AND / anaphoric-continuation nudge for an unmet function/method-level test-coverage query ("which functions call X and are untested", "which of those are tested") suggests "who touched \<module\>", which doesn't address what was actually asked | clarity nit on a genuine data-granularity ceiling (this graph's `tests` edges are module-level only) | NEXT — low priority; reword the miss to name the actual gap (no function/method-level test data) instead of an unrelated suggestion |
| 4 | (named ceiling, no route) "is there a main entry point I should look at first" — "entry point" isn't a concept this graph's schema extracts at all | genuine schema/capability horizon, not a routing bug | no route — named here as a horizon, same treatment as any other undesigned tier |

**Noted, explicitly not routed:** "thanks, that's all for now" / "thanks, that's all i needed"
(a fuller farewell sentence, not a glued two-word phrase) hit the grammar wall instead of
closing, found independently by two personas. Per this skill's own hardened discipline (§5,
2026-07-27): irregular sign-offs get noted and stopped there, whether invented or organically
found — no `NEXT.md` item, no further sweep effort on this class. Recorded here for the
record, not carried forward.

## What's confirmed fixed (3.0.3's full routed backlog)

| 3.0.3 finding | This cycle |
|---|---|
| "give me an overview of this project" → identity card, not architecture | **Fixed** — architecture-newcomer frame, verbatim retest, correct architecture overview |
| "what are the packages here" / "list the packages" → vocabulary lane / "not a listable kind" | **Fixed** — architecture-newcomer frame, both verbatim retests, correct package enumeration |
| "thanks bye" → misparsed as capability-teach | **Fixed** — rushed-developer frame, verbatim retest, clean close |
| "what is a cache" → no general-vocabulary cue | **Fixed** — vocabulary-learner frame, verbatim retest, cue present |

## Next

FLOW-6's two routed gates are both cheap, closed-set additions on working machinery (extend an
intent recognizer's phrase set, widen a bounded-fuzzy tolerance) — the same shape as the four
gates this cycle just confirmed fixed. Closing them would let a future sweep push for a clean
FLOW-6 ratchet. FLOW-4 deserves at least two more fresh conversations from different entry
points before it can ratchet on its own criteria — this cycle's single frame was a strong
first data point (superlative ranking and inherited-method resolution both correct), not full
coverage. A future sweep should also try FLOW-5 more directly (teach + recall mixed with graph
truth in the same conversation, not just teach + recall in isolation) and keep an eye on
whether the module-level-only test-coverage ceiling (#4/#5) is worth a schema extension, once a
real consumer asks for function-level coverage rather than a benchmark persona.
