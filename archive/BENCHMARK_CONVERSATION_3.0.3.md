# BENCHMARK_CONVERSATION_3.0.3 — persona sweep, 6 frames on the new 3.0.3 surfaces; judged 37 FLOW / 3 DEAD-END, 12 passes frozen as chatflow regressions

**Mode:** persona-sweep (§3.4, the default for one run), with a judged pass and the
mechanisation ratchet applied. Six frames, each driving the REAL product path
(`runTurn` threaded turn to turn with a per-frame ephemeral memory dir, the graph loaded
from the committed `examples/mini-webapp`), each seeded with a genuinely different frame
and each biased to exercise a new 3.0.3 surface where the flow families allow:
architecture/overview routing, the code-indexing chat surface, the digest term read-back
with its source line, and the cross-turn temporal comparison lane (FLOW-7). No
`Agent`/`Task` tool was in this run's toolset, so the coordinator drove each frame
directly rather than dispatching background sub-agents; the discipline (isolated
fixture, real product path, verbatim capture, judgment deferred to a separate pass) is
unchanged.

**Headline: the mandatory canonical example (§0.1) passed clean, and so did the four new
surfaces.** A fresh session taught "john is a man" / "every man is mortal" and inferred
"yes … so john is a mortal" without touching code vocabulary; a generic
dog→poodle→animal chain inferred correctly too. The architecture overview, the code-index
query family (members, importers, definition, caller anaphora, count, honest-empty), the
module and vocabulary digest read-back, and the two-step temporal comparison all flowed.
The pinned judge scored **37 of 40 frame turns FLOW, 3 DEAD-END**, and every judged PASS
on a new surface is now a frozen `test/chatflow-*.test.mjs` regression.

**Delta vs 2.11.0 (2026-07-23):** the last sweep, on the same six-persona shape but 68
turns of open codebase exploration, marked **29 dead-ends and one severe write-boundary
bug**, and the ladder **held at FLOW-0 with no frozen regressions in the tree at all**.
Since then a first chatflow regression file landed
(`chatflow-flow0-identity-smalltalk-closing.test.mjs`, freezing 2.11.0's routed backlog),
and this run confirms those fixes live: the are-you-an-LLM family now answers, "gtg thx"
now closes the session, and the identity/greeting/closing turns all flowed. Dead-end
density fell from ~43% of turns to ~8%, and the three that remain sit at FLOW-1→FLOW-6,
not FLOW-0.

## Timing

Date **2026-07-24**. `package.json` version measured: **3.0.3**.

- **Play-throughs (persona probing):** 03:40:07 → 03:44:11 UTC, about 4 minutes
  wall-clock. Covers the canonical example (§0.1, run first), the four new-surface probes,
  the six persona frames, and the extra dead-end confirmations.
- **Judged passes (pinned model, timed separately):** 03:44:11 → 03:48:06 UTC, about 4
  minutes. Six `claude` calls, one per frame, each grading the whole transcript.
- **Analysis and write-up:** immediately following, same session.

## Judge pins

- **Model:** `claude-haiku-4-5-20251001` (the full pinned id, never an alias), via the
  authenticated `claude` CLI.
- **Invocation:** `claude -p <prompt> --model <id> --output-format json --json-schema <schema>`.
- **Prompt version:** `conversation-flow-v1` — a per-turn FLOW/DEAD-END rubric grounded in
  §0's definition (FLOW = answers or gives a guiding nudge / honest miss that keeps the
  conversation alive; DEAD-END = a bare wall, a confusing misparse, a fabricated answer, or
  an invited follow-up the engine can't take). One structured verdict per turn, judging
  intent over wording.

## Coverage

Six frames, 40 turns. Every frame opened with a natural greeting and closed with a natural
farewell (§1 Step 1). Two frames carried a teach-then-INFER pair (the stranger frame with
both the canonical syllogism and a generic dog/poodle/animal chain). One frame carried the
cross-turn temporal comparison (a commit-filter pivot, then two dated follow-ups). The
digest read-back was exercised on both a code entity (`model.mjs`, `validate.mjs`) and a
seeded vocabulary term (`cache`, `queue`).

## Per-frame breakdown (ranked by dead-ends found)

### architecture-newcomer — 7 turns, 2 DEAD-END (the frame that found the most)

Architecture routing works for the direct ask ("what is the architecture of this
codebase" → the 12-module / 5-package overview with hub modules ranked by importer count),
but two natural siblings miss:

- **"give me an overview of this project" → the identity card**, not the architecture
  overview. The overview intent recognizer catches "architecture" but not the
  "overview of this project/codebase/repo" phrasing.
- **"what are the packages here" → the conceptnet digest** ("i learned: package means the
  same as box"). A plain enumeration request is swallowed by the vocabulary/digest lane.
  The sibling "list the packages" instead gives an honest compositional miss ("packages
  isn't a listable kind — try functions, classes, methods, modules …"), so packages are
  computed for the architecture answer but are not an enumerable kind for a list query.

The other five turns (greeting, `which modules are in src/core`, `what functions are in
tasks.mjs`, the close) flowed.

### vocabulary-learner — 6 turns, 1 DEAD-END (disputed; see below)

The digest term read-back is the star here. `what is a cache` returns the seeded reference
digest with its full source line ("source: reference article 'Cache (computing)', Simple
English Wikipedia, CC BY-SA 4.0 — https://…"); `what is model.mjs` and `what does
validate.mjs do` read the module digest back with a one-line structure summary and a
`/describe` offer; `what is a queue` reads the term back with its `child:conceptnet:queue`
source. The judge scored the cache turn **DEAD-END**, on the ground that a codebase
assistant silently answering with a Wikipedia definition should signal that it is general
vocabulary, not a fact from this repo's graph. This is a **disagreement with the intended
surface, not a wall**: FLOW-0 names `what is a cache` as a known-good seeded-vocabulary
answer, and the reply carries its source explicitly. Recorded as the judge's verdict and
routed as a low-priority clarity nit, not counted as a product regression.

### code-explorer — 7 turns, 0 DEAD-END

The code-index drill-down family, clean end to end: `what modules import model.mjs` (all
four importers), `where is loadStore defined` (file + line range), `what calls it`
(anaphor resolved to the just-located `loadStore`, caller named), `how many modules are
there` (12), and an honest-empty on `what does TaskController contain` ("no contains edges
in the index") that states its reason instead of walling. Anaphora carried across turns.

### git-historian — 6 turns, 0 DEAD-END (FLOW-7)

The temporal comparison lane, threaded live through a session: `what changed before
1b2c3d4e5f60` establishes the dated commit-filter pivot, then `was that before logger.mjs
was touched` binds "that" to the pivot, reads the passive clause as its own when-question,
and compares the two ISO dates with both sides cited; `was it after store.mjs was touched`
correctly reports the same-day landing rather than forcing a before/after. `what changed
in http.mjs` gives a terse-but-correct commit id and author.

### stranger-teach — 8 turns, 0 DEAD-END

The mandatory canonical example and a generic teach-then-INFER chain, both clean. Two-hop
inference with a cited evidence trail on each hop ("john is a kind of man … man is a kind
of mortal … so john is a mortal").

### rushed-developer — 6 turns, 0 DEAD-END

Terse, typo-heavy input all landed: `wat about validate` resolved to the module report,
`whats in users.mjs` listed its members, `who uses Task` named the reverse-dependency
functions, `are you an LLM` gave the no-LLM answer, and `gtg thx` closed the session —
the exact 2.11.0 #6 farewell that a frozen regression now protects.

## A dead-end outside the frames (found in probing, routed)

**"thanks bye" (no comma, a thanks-word directly adjacent to a bye-word) misparses as a
capability-teach** ("I don't know 'thank' yet, so I can't store 'thanks bye' as a
capability fact … I'll remember that a thank can bye"), `miss:true`. This is the same
farewell/closing class 2.11.0 #6 named — now fixed for "gtg thx" and "alright, thats
enough for now, thanks", but not for this adjacency, where the "X can Y" capability-teach
lane swallows the two words. It should close like any other farewell.

## Ladder position reached

**The ladder advances from FLOW-0 to gate at FLOW-3.** FLOW-0 **ratchets clean** this
cycle: both criteria hold — six fresh frames opened with clean greeting/identity/closing
turns (well over the three-fresh-conversations bar), and the FLOW-0 routed edges from
2.11.0 are frozen and green in `chatflow-flow0-identity-smalltalk-closing.test.mjs`
(confirmed in the blast-radius run). That is a real move from 2.11.0, which held at FLOW-0
with no frozen content to satisfy criterion 2 at all.

The ladder now gates at **FLOW-3** (cross-concept and relation touches), where the two
fresh routable edges sit: the "overview of this project" routing gap and the package
enumeration gap. FLOW-1/FLOW-2 (single touch and drill-down chains with anaphora) flowed
clean and gained frozen content this cycle (the code-index family). FLOW-5 (teach + recall
+ reasoning) flowed clean. FLOW-7 (the typed cross-turn discourse record) flowed live and
carries a frozen regression, but sits above the ratcheting FLOW-0→FLOW-6 band by design.

## Ratchet additions (frozen this cycle)

Per the mechanisation ratchet, every judged PASS on a new surface became a frozen
`test/chatflow-*.test.mjs` regression within this cycle. Added:
**`test/chatflow-codeindex-architecture-digest.test.mjs`** — 12 tests, all green, driving
`runTurn` against the committed mini-webapp graph:

- architecture routing: `what is the architecture of this codebase` → the module/package
  overview, not the identity card;
- code-index family: `which modules are in src/core`, `what functions are in tasks.mjs`,
  `what modules import model.mjs`, `where is loadStore defined`, `what calls it` (anaphor
  threaded from the prior turn), `how many modules are there`, and the honest-empty
  `what does TaskController contain`;
- digest read-back: `what is model.mjs` and `what does validate.mjs do` (module digests),
  and the vocabulary term read-back citing its source (frozen in the in-session state it
  was judged in — a prior vocabulary turn opens the child pack);
- temporal comparison (FLOW-7): the commit-filter pivot then two dated follow-ups, cited
  both sides, threaded through the session via `runTurn`'s returned focus/last/discourse.

The cache digest turn was **not** frozen: the judge scored it DEAD-END, and the ratchet
freezes judged passes only. Its existing FLOW-0 coverage stands; the routed clarity nit is
below.

## Routed backlog

Every row is mirrored into `NEXT.md` as part of landing this report.

| # | Finding | Class | Route |
|---|---|---|---|
| 1 | "give me an overview of this project" gets the identity card instead of the architecture overview; the recognizer catches "architecture" but not the "overview of {this project/codebase/repo}" sibling | routing gap (FLOW-3) | NEXT — extend the architecture/overview intent set |
| 2 | "what are the packages here" is swallowed by the vocabulary/digest lane ("package means box"); "list the packages" reports packages isn't a listable kind, though the architecture answer already computes them | routing + enumeration gap (FLOW-3) | NEXT — add packages as a listable kind and guard the digest lane from a plain package-enumeration ask |
| 3 | "thanks bye" (thanks-word adjacent to a bye-word, no delimiter) misparses as a capability-teach ("a thank can bye") instead of closing | confusing misparse / farewell (FLOW-6; class of 2.11.0 #6) | NEXT — exclude a leading thanks+bye adjacency from the capability-teach lane |
| 4 | "what is a cache" reads the seeded Wikipedia digest with its source line but does not signal it is general vocabulary rather than a fact from this repo's graph (judge-flagged; intended surface, cited source, not a wall) | clarity nit on an intended surface | NEXT — low priority; consider a "general vocabulary, not from this codebase" cue |

## Next

The two FLOW-3 gates (#1, #2) are the cheapest wins and both look like routing/recognition
fixes on surfaces that already exist: the architecture answer already computes packages,
and the architecture recognizer already fires on "architecture" — both just need their
natural sibling phrasings routed in. Closing them, plus the farewell misparse (#3), would
let FLOW-3 ratchet next cycle. The digest clarity nit (#4) is a UX polish on a working
surface and can wait. A future sweep should push a frame into FLOW-4 (compositional and
comparative — "which functions call X and are untested", "which module has the most
imports") where this run did not probe, and keep pressing FLOW-7's temporal lane against
the not-yet-bound antecedents `NEXT.md` already tracks (a date-filter result set, "when
was X last touched").
