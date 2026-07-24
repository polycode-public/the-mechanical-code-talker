# SKILL_BENCHMARK_CONVERSATION.md — the fluid-conversation playtest cycle (dead-ends, learning-then-inference, completions retrieval, two run modes)

*(Renamed from `SKILL_BENCHMARK_PLAYTEST.md` and refocused, 2026-07-10 — the mechanism below is
unchanged, but its scope is now explicit about three things a scalar benchmark structurally can't
see, named directly by the operator: (1) whether a session **feels like a fluid conversation** —
greetings that land naturally, guided exploration that a curious user would actually follow, and a
closing that doesn't end on a wall; (2) whether tmct can **accept taught knowledge and then actually
USE it to make a further inference**, not just recall it verbatim on the next turn (teach-then-INFER,
not just teach-then-recall); and (3) whether a broad, open-ended question gets a **detailed
completions-style response** via `src/domain/completions/`'s hub-avoiding crawl (the degree-dampened
`broadSearch`/`groupHits`/`rankSentences` pipeline in `src/domain/completions/complete.mjs`) rather than
the plain grammar wall. Two of the product's biggest capabilities — taught-relation inference and
the completions pipeline — are real, shipped,
and invisible to AGENTBENCH/INFBENCH/CHATBENCH alike. This skill is where they get tested.)*

A fast, qualitative improvement loop for the CHAT SURFACE. Claude plays a curious user, holds
natural conversations with tmct, reviews the transcripts for **dead-ends** and broken flow, fixes
them, regression-tests, then **replays the same conversations** to confirm they now flow — and once
a tier of conversations flows to a useful outcome with zero dead-ends, **ratchets up the
complexity** and repeats.

This is the complement to `SKILL_BENCHMARK_CEFR_ENGLISH.md`, not a replacement:

| | `SKILL_BENCHMARK_CEFR_ENGLISH` | `SKILL_BENCHMARK_CONVERSATION` (this) |
|---|---|---|
| question | is the aggregate quality UP? | does the conversation FLOW, or hit a wall? |
| signal | LLM-judge rubric mean over a case set | dead-ends + unnatural breaks in a real dialogue |
| cost/speed | judge calls, ~an hour, $ per cycle | no judge, no $, minutes per iteration |
| unit | one lever, measured | one conversation, made to flow |
| output | `BENCHMARK_CEFR_ENGLISH_<version>.md` + a mean | `BENCHMARK_CONVERSATION_<version>.md` + a growing suite of frozen "must-flow" transcripts |
| covers | isolated, single-turn/single-case quality | session ARCS: open→explore→teach→infer→close, and broad completions-shaped questions — territory CEFR_ENGLISH structurally can't reach (single isolated cases, not session arcs) |

Use them together: this loop catches the dead-ends a mean can hide (a 1.4 mean can still leave a
user stuck at turn 4); the benchmark confirms the fixes moved the aggregate and didn't regress it.

**Re-scoped 2026-07-11 (operator instruction, after watching a capped-sprint "one run" pass take
over an hour on a single round under concurrent load): this skill's job is the WIDER assessment —
finding where a whole capability's limit sits, across genuinely different frames, so the operator
can decide where an architectural uplift is worth paying for.** The narrower job — catching and
fixing LOCAL traps a real visitor would actually hit, quickly, looping until some other work
finishes — belongs to whichever session picks them up from `NEXT.md`'s open items, not this
doc. This skill periodically
asks the bigger question ("where does this capability actually stop working, and across how many
different kinds of user"); its small findings become `NEXT.md` open items and its architectural
findings graduate into a `PLAN_*.md` doc rather than a quick patch.

This skill has **three modes**, sharing the same discipline (§1):

- **Persona-sweep mode (§3.4) — the DEFAULT for a single "one run" pass.** Several background
  sub-agents dispatched IN PARALLEL, each seeded with a genuinely different persona/frame (not a
  different topic within the same frame). Genuinely parallel, not chained, so wall-clock stays close
  to one round's cost regardless of how many frames run — and it's the mode that actually finds a
  dead-end like "john is a man," which single-frame exploration structurally can't reach no matter
  how much question-variety runs inside it. Use this whenever the operator asks for "one run" of
  this benchmark, unless they explicitly ask for one of the other two.
- **Capped sprint mode** (§3) — a bounded, small number of CHAINED rounds (default 3), each round's
  chat delegated to a background sub-agent, each round building on the prior round's transcript for
  depth/realism. Genuinely serial by construction (round 2 needs round 1's transcript), so its
  wall-clock is strictly additive across rounds — reserve it for when the operator specifically wants
  to WATCH a sprint happen turn by turn and values follow-up depth over speed, not as the default
  measurement pass.
- **Full ladder mode** (§2) — open-ended, run by the main agent inline, ratcheting a FLOW-0…FLOW-6
  complexity ladder one tier at a time. Pick this to deliberately push into new complexity territory.

> **Invoke it:** *"Follow `SKILL_BENCHMARK_CONVERSATION.md` and run the dialogue-flow loop"* runs
> persona-sweep mode by default. Ask explicitly for *"as a capped sprint"* (optionally a round cap)
> or a complexity tier for full ladder mode to get the other two.

---

## 0. The core idea

tmct's promise (item 1) is a **tolerant** surface that **guides you toward precision**. The failure
mode is not a wrong answer. It is a **dead-end**: a turn that neither answers nor nudges, so the
conversation stops. A dead-end is any turn whose reply is one of:

- the grammar wall ("couldn't parse this as a graph question. Try: …"),
- "`X` isn't a term in this graph's own vocabulary",
- "couldn't compile this compositional question (unknown qualifier …)",
- a "no X found" / honest-empty where the user plainly meant something the graph CAN answer
  (a phrasing miss, not a real absence),
- silence where a guided question the product ITSELF offered invited a follow-up the engine can't
  take,
- an offered example ("try `X`") that ITSELF fails when actually asked, in the exact session state
  it was offered in (0.9.12: five surfaces once suggested `what is a cache` unconditionally, even
  under `TMCT_NO_SEED`/`seed.enabled=false` where it always missed — an unverified suggestion is
  worse than no suggestion, because it spends the user's trust on a promise the product didn't keep),
- **(2026-07-10) a taught fact that never gets USED.** Teaching "every Widget is a Component" and
  getting it back verbatim on "what is a Widget" is necessary but not sufficient — if a LATER turn
  needs to combine that taught fact with something else to answer (a real inference, not a lookup)
  and instead hits a wall or an honest-but-avoidable miss, that's a dead-end too. Teach-then-RECALL
  passing while teach-then-INFER fails is exactly the gap this addition targets.
- **(2026-07-10) a broad, open-ended question that should route to `src/domain/completions/`'s pipeline**
  ("give me a detailed summary of how X works", "walk me through what happens when Y") hitting the
  plain grammar wall with no inferred goal at all. The pipeline is now wired into live chat
  dispatch (the completions rescue in `src/services/chat.mjs`), so a broad question that still hits the
  plain wall is an ordinary dead-end to diagnose and route, not a named ceiling.

The bar: **every turn either answers, or gives a guiding nudge toward a precise query** (the "if you
mean X then…" surround, a "did you mean" repair, a short tailored hint). A turn that does neither is
a dead-end, and dead-ends are the whole quarry.

### 0.1 MANDATORY first move, every round: the canonical textbook example, not domain exploration

**(2026-07-10, operator-mandated after a real miss.)** A full 3-round playtest sprint this session
carefully explored `examples/mini-webapp` and found real dead-ends — but every round was framed
around "explore this codebase," so every teach-test used codebase vocabulary ("every Widget is a
Component"). The operator's own very first try after the session, unprompted, was the classic
textbook syllogism — **"john is a man"** — and it hit a confusing, semantically-backwards decline
message (fixed, commit-pending as of this edit). Thorough exploration inside a narrow frame still
missed the single most obvious test case, because the frame itself (codebase exploration) excluded
it by construction.

**The rule, not optional, checked before anything else in Step 1 below:** for EVERY core capability
this product claims (check `README.md`'s own headline examples — that IS the canonical set), test
its single most canonical, "anyone would try this first" textbook example, VERBATIM, by name,
BEFORE any codebase-flavored exploration in that round. For "teach me a fact in natural language,"
that's a plain-English syllogism with a person's name and a common noun (`"Socrates is a man"` /
`"john is a man"`), never a code-vocabulary substitute. Domain-flavored exploration is still
required and valuable (§1 Step 1 below) — this is an ADDITION before it, not a replacement for it.
If a canonical example is broken, fix it before anything else the round finds — it's definitionally
the highest-impact dead-end, since it's the one every future stranger session will hit first.

---

## 1. The shared discipline: chat, find dead-ends, document, hand off

**(Re-scoped 2026-07-11, operator instruction: this skill MEASURES and DOCUMENTS only. The other
three benchmark skills (`SKILL_BENCHMARK_AGENT.md`/`SKILL_BENCHMARK_CEFR_ENGLISH.md`/
`SKILL_BENCHMARK_INFERENCE.md`) do build within their cycles — a lever, an engine capability, a
router capability — but each keeps the measurement pass itself untouched and re-measures after;
this skill goes further and has no build leg at all. It
used to fix, freeze, and ship inline too, which made its own runtime unpredictable (an open-ended
implementation-and-test cycle bolted onto what should be a bounded measurement pass). Fixing
dead-ends now happens OUTSIDE this skill's run — picked up from `NEXT.md`'s open items (small,
local fixes) or worked against a `PLAN_*.md` (anything architectural) — never here.**

Both modes run the same four-step loop. Full ladder mode runs it inline, one tier at a time (§2).
Capped sprint mode runs it in bounded rounds, with Step 1 delegated to a background sub-agent and
Steps 2–4 handled by the coordinator in the primary chat (§3).

**Step 1 — CHAT (play a curious user).** Against a loaded graph (start with a shipped example so the
answers are real), hold a natural conversation. **Never run `chat --repo` directly against the
committed `examples/mini-webapp/.tmct/graph.json`** — a live session writes session/provenance state
back into that fixture, dirtying a checked-in file (this bit several concurrent playtest cycles in
the same session before the pattern was caught). Copy it into a tmpdir first and point `--repo`
there: `cp -r examples/mini-webapp $(mktemp -d) && node bin/tmct.mjs chat --repo <that exact
path>`. **Use `mktemp -d` (or equivalent) to get a unique path, capture it in a variable, and clean
up ONLY that exact path when done — never a wildcard glob like `rm -rf /tmp/pt-*`.** Multiple
playtest cycles and other agents run concurrently in the same shared `/tmp`; a wildcard cleanup can
delete another agent's still-in-use scratch directory out from under it (caught by the harness's own
safety policy once — no actual damage that time, but it's exactly the kind of cross-agent collision
this rule exists to prevent). Rules that make the play realistic:
- **Follow the product's own guided questions.** When the concept force says "Want to go deeper? Try:
  which classes inherit from Record", ASK one of those next — then ask YOUR natural follow-up to its
  answer, in your own words, not the grammar's.
- **Drill down.** concept → instance → its relations → their relations. Let the focus/`it` anaphora
  carry ("what calls it", "what uses that", "where is it defined").
- **Phrase naturally, not to the grammar.** "what functions are in Task", "what defined saveStore",
  "what about imports" — the way a developer actually types, including typos and politeness frames.
- **Open AND close like a real session, not just a query stream.** Include a genuine greeting turn
  and a genuine closing/thanks turn — not just structural questions in the middle. A conversation
  that flows perfectly in the middle but hits a wall on "cheers, that's everything, thanks" still
  fails the fluid-conversation bar (found live in a 2026-07-10 playtest round).
- **Test teach-then-INFER, not just teach-then-recall.** After teaching a fact, don't just ask for it
  back verbatim — ask a FOLLOW-UP question that requires COMBINING the taught fact with something
  else the graph or a prior taught fact already holds. A round-trip recall passing tells you almost
  nothing about whether the fact is actually usable in reasoning.
- **Try at least one broad, open-ended "detail" question per session** ("give me a detailed summary
  of how X works", "explain what happens when Y") — this is the completions pipeline's own territory
  (the hub-avoiding crawl: `broadSearch` → `groupHits` → `rankSentences`/`inferRelations` →
  `prune`/voice pass, `src/domain/completions/complete.mjs`, wired into live chat dispatch via the
  completions rescue in `src/services/chat.mjs`). A broad question that hits the plain wall is an ordinary
  dead-end to diagnose and route (§0).
- Capture the transcript VERBATIM (pipe the turns: `printf 'q1\nq2\n…\n/exit\n' | node bin/tmct.mjs
  chat --repo <graph>`). In full ladder mode, run 3–6 short conversations per tier from different
  entry points (§2); in capped sprint mode, one conversation per round, chained off the prior round
  (§3).

**Step 2 — REVIEW (mark every dead-end).** Read each transcript top to bottom. For every turn, label
it FLOW (answered or nudged) or DEAD-END (§0). For each dead-end, write one line: the verbatim input,
what the user meant, and the capability that SHOULD have served it (usually one that already exists —
`/members`, "where is X defined", the concept force, a relation the graph has). The output is a
ranked dead-end list, most-flow-breaking first.

**Step 3 — DIAGNOSE (name the capability that should have served it, don't build it).** For each
dead-end, write down what the fix would almost certainly be — **routing/recognition**, not new
capability, in the large majority of cases ("what functions are in X" ≡ members-of-class, "what
defined X" ≡ where-is-X-defined, "what about imports" ≡ the relation concept force) — and which
existing module it would likely touch (`src/domain/interpret/`, `src/domain/concept.mjs`, `src/domain/ask.mjs`'s miss
renderer). This is a diagnosis for whoever picks it up next, not an implementation: **do not edit any
source file in this step.**

**Step 4 — RANK AND ROUTE.** Order every dead-end found, most-flow-breaking first (§3.4 already ranks
persona-sweep findings by how many independent personas hit the same one — reuse that signal here
too). For each: route it to exactly one of —
- **A `NEXT.md` open item** — a small, local, obviously-scoped routing fix (the common case).
  Record the verbatim input, the current wrong/missing output, and Step 3's diagnosis as a one-line
  open item pointing at this run's write-up; whichever session lands the fix verifies it live and
  freezes a `test/chatflow-*.test.mjs` regression — outside this skill's own runtime.
- **A `PLAN_*.md` doc** — anything that needs a real design decision, touches shared/high-blast-radius
  machinery, or risks a pinned-case regression. Find an existing open plan doc this fits under, or
  name a new one specifically
  for the issue — never leave it as a bare line item with no owner.
- **A named, honest ceiling** — a capability tmct deliberately doesn't have yet (§0's completions-
  pipeline example). Say so plainly in the report; don't manufacture a fix target for it.

This skill's own job stops here. It never edits `src/`, never runs `npm test` as a verification step
for a fix (there is no fix to verify), and never bumps or pushes a version.

### 1b. What "flows to a useful outcome" means

A conversation passes when, replayed, it:
- has **zero dead-ends** — every turn answered or nudged;
- **carries context** — `it`/`that`/`those`/"what about X" resolve against the running focus;
- **reaches somewhere** — by the end the user has learned something actionable about the codebase
  (a definition, a caller, an impact, a coverage gap), not just bounced around;
- **stays honest** — a genuine absence is an honest empty WITH a receipt or a nudge, never a
  fabricated answer and never a bare wall.

If a conversation ends with the user stuck (a wall, a re-typed question, an "unknown qualifier"),
it fails regardless of how many earlier turns answered.

---

## 2. Full ladder mode

The open-ended variant: the main agent chats inline at the current complexity tier, documents what
breaks (§1 Steps 3–4 — never fixes it here), and only ratchets the tier up once the current one is
reliably dead-end-free per the LAST measured pass at it (a tier stays "clean" once its dead-ends have
been routed out and fixed elsewhere, confirmed by a fresh conversation, not by this skill re-fixing
anything itself).

**Step 6 — REPEAT at this tier** until several fresh conversations at the current complexity flow
clean, first try, from any entry point.

**Step 7 — RATCHET.** Raise the complexity tier (§2.1) and go back to §1 Step 1. Only escalate when
the current tier is reliably dead-end-free — the same ladder discipline the benchmark uses, applied
to flow.

### 2.1 The FLOW ladder — a bounded, named flow-complexity ladder

The **FLOW ladder** (`FLOW-0…FLOW-6`, plus two horizon rungs) is CONVERSATION's own scale, drawn
from conversational complexity — distinct from CHATBENCH's CEFR, INFBENCH's `INF-1…INF-8`, and
AGENTBENCH's `TOOL-0…TOOL-8`. Its **surface-messiness axis tops at FLOW-6** (the messy real user):
new messiness that doesn't fit an existing tier grows that tier's content, it does not add a rung.
Above FLOW-6 sit two **capability-depth horizon rungs** (FLOW-7, FLOW-8), defined ahead of design so
the scale extends just past what the plan docs anticipate. The ladder is the ruler; a defined top is
what lets it produce a position and a gate.

- **FLOW-0 — Bootstrap: before any graph, the identity surface.** No `--repo`, a bare `tmct chat` in
  an empty dir. Greetings, identity ("who are you", "what are you", "are you an AI/ChatGPT"), help/
  orientation, and vocabulary questions from the seeded ontology (`what is a cache`) — all BEFORE the
  user has pointed tmct at any code. This tier is a prerequisite to FLOW-1, not a relaxation of it: a
  dead-end here (0.9.12: greetings/identity leading with "no code graph loaded" instead of the seeded
  knowledge) is a worse first impression than any structural dead-end, because it's the very first
  thing a new user sees. Play it with BOTH a normally-seeded session and `TMCT_NO_SEED=1` — an example
  that only works in one of those states and is offered in both is a dead-end (see §0's new bullet).
- **FLOW-1 — Single touch + one drill-down.** "what is a class" → follow one guided question →
  one natural follow-up. (Concept force + one relation.)
- **FLOW-2 — Drill-down chains with anaphora.** concept → instance → "what calls it" → "what uses
  that" → "where is it defined" — 4–8 turns, focus carried throughout.
- **FLOW-3 — Cross-concept & relation touches.** "what about imports", "what calls are there",
  mixing nouns and relations; the relation concept force.
- **FLOW-4 — Compositional & comparative.** "which functions call X and are untested", "which module
  has the most imports", "public methods of X", "which of those are tested".
- **FLOW-5 — Teach + recall + reasoning in dialogue.** assert a fact mid-conversation, recall it
  later, mix with graph truth; the honest "I don't know that yet" that offers to learn.
- **FLOW-6 — The messy real user.** typos, politeness frames, topic switches, "no wait", vague
  openers, "what can you tell me about this repo" — the conversation a stranger actually has.
- **FLOW-7 — Typed cross-turn discourse record (DRT-lite).** a query whose meaning composes across
  several prior ANSWERS through a typed record that tracks entities and relations turn to turn, past
  the prev-set anaphora the lanes already carry (`PLAN_DISCOURSE_AND_RECOGNITION.md` Part A). Row 19 of the compositional
  corpus lane (cross-turn temporal composition) is its standing acceptance test.
- **FLOW-8 — Nested other-minds dialogue.** talking about what ANOTHER agent believes — a believer
  of beliefs, not only a first-order belief about the world. The spider-fly false-belief world is the
  world-side floor; this rung grades holding that nesting in conversation (`SKILL_BENCHMARK_AGI_SCALES.md`'s
  other-minds depth scale).

FLOW-7 and FLOW-8 sit above the ratcheting FLOW-0→FLOW-6 ladder, not inside it: the ratchet gate
(below) still runs FLOW-0→FLOW-6, and these two carry no frozen `test/chatflow-*.test.mjs`
regressions yet — a horizon rung's cases get authored when its capability lands (DRT-lite / R1 for
FLOW-7, other-minds nesting for FLOW-8), the same defer-until-buildable discipline the other three
benches hold for their top rungs. The AGI won't sit in this sandbox; these two rungs are where its
discourse-side depth would register.

#### The ratchet criterion (mechanical, per tier)

A FLOW tier **ratchets clean** — unlocking the tier above — when BOTH hold:

1. **Fresh conversations flow.** At least three fresh conversations at this tier, from distinct
   entry points, replay with zero dead-ends (§0/§1b's definition: every turn answers or gives a
   guiding nudge).
2. **Every routed dead-end at this tier is frozen and green.** Each dead-end the edge-search (the
   persona sweep, §3.4) found at this tier and a later session fixed has a `test/chatflow-*.test.mjs`
   regression **tagged to the tier**, and it passes on the current tree.

Criterion 2 is what makes the ratchet mechanical rather than a vibe: a tier is clean because its
accumulated regressions are green and a fresh pass finds nothing new, not because it "felt clean this
run". This mirrors the other three ladders' gates — INFBENCH's grader receipt, AGENTBENCH's
0%-hallucination-at-≥50% metric pair, CEFR's tier-1 deterministic row. FLOW's gate is
"fresh-flow-clean AND frozen-regressions-green".

FLOW tiers ratchet strictly **FLOW-0 → FLOW-6**. A tier that is not clean gates every tier above it,
and the report says where the ladder sits and why — the same skipped-with-a-receipt discipline the
other three use. A tier can name a capability tmct doesn't have yet: there the bar is not "answer"
but "guide" — an honest miss that offers a nudge, a repair, or an offer to learn keeps the
conversation alive and counts as flow; a bare wall does not. A capability genuinely missing is routed
to a `PLAN_*.md` as a horizon, never marked a permanent ceiling.

#### The persona sweep feeds the ladder

The persona sweep (§3.4) is **not a second ladder — it is the unbounded edge-search that feeds this
bounded one.** The loop: the sweep runs several genuinely different frames in parallel and finds new
dead-ends → each is routed (§1 Step 4) to a `NEXT.md` open item or a `PLAN_*.md` → a later session
fixes it and freezes a `test/chatflow-*.test.mjs` regression tagged to the FLOW tier the dead-end
belongs to → that frozen regression becomes ladder content, exactly what criterion 2 counts when the
tier next tries to ratchet. So the sweep is unbounded (it keeps finding new edges across new frames)
and the FLOW ladder is bounded (it accumulates the fixed edges as gated content) — the same
"bounded ladder plus an unbounded edge-search" shape all four benchmarks now share.

### 2.2 The surface-variation axis (orthogonal to the ladder)

The ladder (§2.1) ratchets what CONCEPTS a conversation touches. This axis instead re-plays the SAME
intent — a greeting, an identity question, a help/orientation ask — through different SURFACES of
English, at whatever tier you're currently playtesting. It's a multiplier, not another rung: run it
across FLOW-0 and FLOW-6 especially (both are "the messy real user" territory), and spot-check it
elsewhere.

Vary each recognized closed-set intent across:
- **dialect/region** — UK ("cheers", "ta", "you alright"), US ("howdy", "hey y'all"), AU/NZ
  ("g'day", "yeah nah")
- **register** — formal ("good day", "salutations") down to slang/texting ("wassup", "ayy", "hru")
- **typo/elongation** — "helo", "thnx", "wat r u", "heyyyy" — a near-miss of a phrase tmct DOES know,
  not a genuinely new phrasing
- **non-native/ESL phrasing** — word-order or article slips that a fluent-but-non-native speaker
  plausibly types ("you are what", "explain please what is this")
- **the honest "are you an LLM" family** — a very likely genuine first question given tmct's no-LLM
  positioning; it deserves a real, on-brand answer (0.9.12 added `identity-not-an-llm`), not silence
  or a generic capability blurb

The pass bar is the same as any turn (§0): FLOW, not necessarily verbatim-identical wording to the
canonical phrasing's answer. A variant that falls through to the grammar wall or the code-graph
apology is a dead-end exactly like a missed structural phrasing — diagnose and route it the same way
(§1 Steps 3–4): the likely fix is extending the closed set / the bounded-fuzzy fallback
(`fuzzyMatchInSet`, `interpret/fuzzy.mjs`), never loosening into a guess, but that fix is made by
whoever picks up the open item, not here.

---

## 3. Capped sprint mode — the coordinator model in action

A short, bounded variant of §1's loop: instead of the open-ended tier ladder run by the main agent
inline, this runs a **fixed, small number of rounds** (default 3), each round's chat **delegated to
a background sub-agent**, each round's questions **chaining off the previous round's transcript** (a
real user's next question usually follows from what they just learned, not a fresh unrelated
topic), with the **main agent appraising each transcript in the primary chat** (never hidden in a
sub-agent's own output) and **routing every real finding to a `NEXT.md` open item or a
`PLAN_*.md` doc** (§1 Step 4) rather than fixing it here. Stops at the round cap or the first pair of
rounds that finds nothing worth routing, whichever comes first, then reports a recommendation on
whether to keep going.

This mode is `CLAUDE.md`'s standing coordinator model applied directly to playtesting: the CHAT step
is genuinely long-running and independently drivable, so it goes to a background sub-agent while the
coordinator stays free to appraise, decide, and report to the operator in real time — exactly the
"the chat stays for chat" discipline the project's working model calls for, not a special case
invented for playtesting.

This is the SAME dead-end discipline §0/§1 already define (a dead-end is a wall, an "isn't a term",
an "unknown qualifier", a phrasing-miss, or an invited follow-up the engine can't take) — this mode
does not redefine it, only wraps it in a capped, delegated, per-round-shippable cadence. Use full
ladder mode (§2) for the open-ended tier-ladder pass; use this mode when the operator wants a
bounded sprint with a clear stop and a recommendation at the end, run mostly hands-off.

> **Invoke it specifically:** *"Follow `SKILL_BENCHMARK_CONVERSATION.md` and run a playtest sprint"*
> (optionally: a round cap other than 3, a starting graph/repo, a focus area).

### 3.1 The loop (one round)

**Round-Step 1 — DISPATCH.** Launch a background sub-agent (not a fork — it needs to run genuinely
independently while the main agent stays free to report progress) with a self-contained prompt
containing:
- The target graph/repo to chat against (a shipped example by default — `examples/mini-webapp` —
  or whatever the operator named).
- **The full transcript of every prior round** (verbatim questions + answers), with the
  instruction: *"Read this prior conversation first. Your job is to CONTINUE it naturally — ask
  the next 4-8 questions a real user would ask next, given what they just learned, not a fresh
  unrelated topic."* Round 1 has no prior transcript — it opens cold, playing a curious first-time
  user (mirrors §1 Step 1's "play a curious user" discipline).
- The instruction to drive the conversation via the real CLI (piped turns into
  `node bin/tmct.mjs chat --repo <graph>`, capturing the transcript verbatim — same mechanism §1
  Step 1 uses) or `runTurn`/`createSession` directly for speed, either is fine as long as it exercises
  the REAL product path (never a mock).
- The instruction to return the raw transcript (every question + every answer, unedited) as its
  final message — the sub-agent does NOT appraise or fix anything itself; that stays with the main
  agent, in the primary chat, where the operator can see it.

**Round-Step 2 — SHOW.** When the sub-agent returns, post the full transcript to the operator verbatim,
in the primary chat — never summarized-away, even if it's long. This is the point of delegating
the CHAT step but keeping the LOOP in the primary conversation.

**Round-Step 3 — APPRAISE.** Read the transcript the same way §0/§1b already score it: every turn is
FLOW (answered or honestly nudged) or DEAD-END (a wall, an unrecognized qualifier, a phrasing-miss, a
confident-wrong answer, an invited follow-up the engine can't take). State the appraisal plainly in
the primary chat: what worked, what didn't, and — this is the gate for Round-Step 4 — whether
anything found is a REAL, ROUTABLE issue (a routing/recognition gap to an existing capability, per §1
Step 3's diagnosis discipline) or a genuine ceiling (name it as one, don't force a fix target).

**Round-Step 4 — ROUTE, if warranted.** If Round-Step 3 found something real:
1. Write Step 3's diagnosis (what the fix would likely be, which module it'd touch) — do not
   implement it here.
2. Route it per §1 Step 4: a small local gap becomes a `NEXT.md` open item, anything
   architectural a `PLAN_*.md`. If the routing/answer logic is actually correct and the dead-end
   is really awkward or repetitive phrasing, route it toward extending
   `src/domain/answer-variants.mjs`/`answer-variants.json` (the deterministic hit-template phrasing-variety
   system) instead of a routing fix. Note in the round's own log which one it went to.
3. If Round-Step 3 found nothing worth routing (a clean round, or only genuine ceilings), say so
   plainly and move to the next round anyway (a clean round is a good outcome, not a failure, and
   still gets chained into the next round's opener).

**Round-Step 5 — CONTINUE OR STOP.** Increment the round counter. Stop when EITHER:
- the round cap is reached (default 3), or
- a round finds nothing to route AND the previous round also found nothing to route (two clean
  rounds in a row — "getting nowhere," the operator's own phrase, read as a stopping signal, not
  just a round-count limit).

Whichever triggers first, go to §3.2.

### 3.2 The end-of-sprint report

After the loop stops, report to the operator in the primary chat:
- **Per round**: one line — what was tested, what was found, where it was routed (or "clean round,
  nothing to route").
- **Overall**: how many of the N rounds found something routable vs. came back clean.
- **A recommendation**, not just a status: if real findings kept landing and the well doesn't look
  dry, say so and suggest another sprint (or escalating to full ladder mode, §2, for a deeper pass).
  If the last one or two rounds came back clean, say the sprint found what it was going to find at
  this complexity tier and recommend either stopping here or ratcheting the tier (§2.1) rather than
  repeating the same tier.

This report also feeds the `BENCHMARK_CONVERSATION_<version>.md` write-up (§4) when the sprint's findings are
worth recording as a versioned artifact.

### 3.3 Discipline specific to capped sprint mode

- **Delegate the CHAT, not the JUDGMENT.** The sub-agent's only job is to hold a real, natural
  conversation and hand back the raw transcript. Appraisal and the route-or-not decision stay with
  the main agent, visible to the operator — a sub-agent silently deciding "this is fine" would defeat
  the point of asking to see every round.
- **Chain for realism, not padding.** The point of leading each round with the prior transcript is
  that real users ask follow-ups shaped by what they just learned — a fresh unrelated topic every
  round tests breadth, not depth, and this mode is explicitly the depth-and-follow-through variant
  (breadth is full ladder mode's multiple-entry-points-per-tier job, §1 Step 1).
- **Route per-round, not in a batch.** A confirmed finding gets handed off (to a `NEXT.md` open
  item or a `PLAN_*.md`) immediately rather than accumulating — this skill's job ends at diagnosis and
  routing, so there's nothing to batch.
- **A clean round is a real result, not a null one.** Report it as such. Two clean rounds in a row
  is the stop signal, not a failure to find something to route.
- **Cap is a ceiling, not a target.** If two rounds in a row come back clean before the cap is
  reached, stop early (§3.1 Round-Step 5) — don't force a 3rd round's worth of manufactured findings
  just to hit the number.

### 3.4 Persona-sweep mode — parallel, genuinely different frames, not chained rounds — the default single-run mode

**(2026-07-10, born directly from the "john is a man" miss; promoted to this skill's default
single-run mode 2026-07-11 — see the top of this doc.)** Capped sprint mode (§3) chains
rounds for realism — each round follows naturally from the last, which is exactly right for
depth, but it means every round in a sprint shares ONE frame (whatever the first round opened
with). Full ladder mode's surface-variation axis (§2.2) varies wording, not the user's underlying
GOAL. Neither mode, run as designed, will reliably produce the single most obvious test case for a
capability if that case falls outside the frame the round happened to start in — this is exactly
what happened this session: a full 3-round sprint thoroughly explored `examples/mini-webapp` and
found real dead-ends, but every teach-test used codebase vocabulary, because every round was framed
around "explore this codebase." The operator's own first try, unprompted, was a plain-English
syllogism, and it broke.

**The strategy: use Claude's own generative capability to produce genuinely diverse personas and
frames, not just diverse questions within one frame — because that's the actual root cause. Every
playtest round that used the same lens ("explore this codebase") could never produce "john is a
man," no matter how much question-variety ran inside it.** Concretely:

1. **Run multiple agents in parallel, each seeded with a deliberately different persona/goal, not a
   different topic.** For example: a total stranger who's never heard of code-graphs and tests the
   plain-English teaching claim with generic real-world facts; someone deliberately trying to break
   it (nonsense, contradictions, edge-case phrasing); a non-native English speaker; someone testing
   if it's secretly an LLM / trying to jailbreak it; someone doing pure small talk with no code
   intent at all; a rushed user typing fragments and typos. Different lens each time, not different
   targets within the same lens.
2. **Let each agent generate its own questions freely from that persona**, using Claude's own
   language-generation range — not a script, not a fixed list — the way an actual diverse
   population of real users would type, which is exactly what a language model is good at
   generating and what a hand-picked example list structurally can't cover.
3. **Every dead-end any of them finds gets recorded in the sweep's report and routed** (§1 Step 4) —
   to a `NEXT.md` open item for a local fix (whoever lands it freezes a
   `test/chatflow-*.test.mjs` regression) or to a `PLAN_*.md` for anything
   architectural — this is how the generative exploration compounds into a permanent, growing gate
   instead of being a one-off exercise, without this skill fixing anything itself.
4. **Run this as a standing practice, not a one-time sweep** — every substantial session that
   touches the chat surface, before calling the chat-surface work done, the same way §0.1 already
   mandates the single canonical example first.

**Mechanically**, this is capped sprint mode's dispatch shape (§3.1 Round-Step 1) with two changes:
dispatch happens as one `parallel`/single-message fan-out (not one-round-at-a-time chaining), and
each agent's prompt seeds a PERSONA + GOAL, not a prior transcript to continue. Each agent still:
drives the REAL CLI (never a mock, never the committed `examples/mini-webapp` fixture directly —
copy to a tmpdir first, exactly as §1 Step 1 requires), returns its raw verbatim transcript plus a
one-line dead-end/flow note, and does NOT appraise, fix, or judge anything itself — that stays with
the coordinator, same as §3.3's "delegate the CHAT, not the JUDGMENT" rule. The coordinator then
reads every transcript, ranks the dead-ends found across ALL personas together (a dead-end several
personas hit independently is higher-signal than one only a single persona's phrasing produced),
diagnoses and routes each per §1 Steps 3–4, and reports the sweep as a whole — not per-agent — to the
operator.

Persona ideas to rotate (not exhaustive — generate fresh ones each sweep; a fixed persona list
would itself become the thing exploration drifts toward):
- total stranger, generic real-world facts only (the one that would have caught "john is a man")
- deliberate breaker (contradictions, nonsense, "are you an LLM", jailbreak attempts)
- non-native English speaker (natural imperfect grammar, not a caricature)
- pure small talk, no code/teach intent at all (tests personality + graceful redirect, not just
  parsing)
- rushed/fragment-typing developer (terse, typo-heavy, impatient)
- a skeptical tester deliberately probing the product's own stated boundaries (asks it to do things
  the README explicitly says it can't)

---

## 4. The `BENCHMARK_CONVERSATION_<version>.md` report

Every playtest run — a persona sweep (§3.4, the default), a full-ladder tier completion (§2), or a
capped sprint (§3) — writes ONE versioned report doc, matching the naming convention
`SKILL_BENCHMARK_CEFR_ENGLISH.md` §1 and `SKILL_BENCHMARK_INFERENCE.md` already use:
`BENCHMARK_CONVERSATION_<version>.md`, named after the `package.json` version the run measured. A
re-run of the same version (no version bump between runs) appends `_00N`:
`BENCHMARK_CONVERSATION_0.9.0_001.md`, `_002`, … Same shape as `BENCHMARK_AGENT_<version>.md`'s own
"decision log"/"ranked menu for the next cycle": this report is the measurement and the routed
backlog, not a changelog of fixes made in the same cycle. It sits alongside, and does not replace,
`test/chatflow-*.test.mjs` — those regression files get frozen when a later session working a
`NEXT.md` open item (or a `PLAN_*.md` item) actually lands a fix for something this report
found, not by this skill directly.

Report structure:
- **Headline** — which mode ran (persona sweep, full ladder, or capped sprint), the persona count or
  tier reached or the round count, and the number of dead-ends found.
- **Timing** — the start and end of the benchmarking session (the persona probing or ladder run) and
  the start and end of the analysis (writing this report), as separate wall-clock intervals with the
  date. In persona-sweep mode the session start is the first persona dispatched and its end is the
  last persona to report.
- **Per-persona, per-round, or per-tier breakdown** — persona-sweep mode: one entry per persona
  (its frame, what it found, ranked by how many other personas independently hit the same dead-end
  per §3.4's own ranking rule); full ladder mode: one entry per tier played this run, entry
  points tried, dead-ends found; capped sprint mode: one entry per round (the same shape
  as §3.2's end-of-sprint report), what was tested, found, and where it was routed.
- **Ladder position reached** — the FLOW-0…FLOW-6 position this run reaches or confirms clean, with
  the ratchet receipt (§2.1): which tier is clean by "fresh-flow-clean AND frozen-regressions-green",
  and where the ladder currently gates. The FLOW ladder is CONVERSATION's own scale, not CEFR,
  `INF-1…INF-8`, or `TOOL-0…TOOL-8` — same bounded-ladder shape, unrelated axes.
- **Routed backlog** — every dead-end found this run, one line each: verbatim input, Step 3's
  diagnosis, and where it was routed (a `NEXT.md` open item / a named `PLAN_*.md` / "named
  ceiling, no route"). This is the report's actionable output — the list a future session works from.
  **Mirror every open item into `NEXT.md`** (one line each, pointing back at this report) as
  part of writing the report, so the next session's pickup list is ready even if this session ends
  before anything else happens.
- **Next** — the recommended next tier, sprint, or focus area, mirroring the recommendation §3.2
  already produces for capped sprints, generalized to full ladder mode too (which tier to ratchet to
  next, or which dead-end class most needs attention).

---

## 5. Discipline (so the loop stays honest, in either mode)

- **Play, don't cheat.** Ask the way a user would, not the way the grammar wants. The value is the
  gap between them.
- **This skill never edits `src/` or `test/`.** Diagnose the likely fix (§1 Step 3 — usually a missing
  SYNONYM/route to an existing capability, not new capability) and route it (§1 Step 4). Implementation
  happens in a later session picking up the `NEXT.md` open item or working a `PLAN_*.md`, never
  in this skill's own run.
- **Honest dead-non-ends.** When there is truly no answer, the turn still must GUIDE (a nudge, a
  "did you mean", an offer to learn) — an honest miss that keeps the conversation alive is FLOW, a
  bare wall is a dead-end.
- **Verify every offered example, in-state.** If a turn's reply says `try "X"`, actually ask `X` in
  that same session/seed state before calling the turn FLOW. A suggestion that wasn't checked is a
  guess wearing a helpful voice — score it a dead-end if it would fail (§0).
- **Don't invent new farewell test cases.** Don't add cases that test elaborate goodbye or thanks phrasing.
  A short, clear close beats a clever one, and stretching the closing-phrase matcher to cover more
  wording adds ambiguity about when the conversation actually ends. If a round turns up a genuine
  farewell dead-end, note it and move on rather than generalizing the matcher further (operator
  decision, 2026-07-10). This is about not INVENTING new farewell cases to chase, not a bar on fixing
  a real bug where a non-farewell gets MISREAD as one — that's an ordinary dead-end, route it normally.
- **Delegate long-running work under the coordinator model.** Persona-sweep mode (§3.4) is the
  clearest example of this — every persona's CHAT step is an independent, parallel background
  sub-agent , which is also why it's the default single-run mode (§3's capped sprint is
  serial by construction; parallel wins on wall-clock whenever chained realism isn't the point). The
  point in either mode is to keep the main chat free for judgment calls and the operator, not to
  hand-run every long step inline by default.

---

## 6. One-paragraph TL;DR

This skill is the WIDE assessment: where does a capability actually stop working, across genuinely
different kinds of user, so the operator can decide whether an architectural uplift is worth it.
Unlike `SKILL_BENCHMARK_AGENT.md`/`SKILL_BENCHMARK_CEFR_ENGLISH.md`/`SKILL_BENCHMARK_INFERENCE.md`,
which build within their own cycles, this skill has no build leg: it
MEASURES AND DOCUMENTS ONLY — it never edits `src/` or `test/` itself. Play a curious user against a
loaded example graph: follow the product's own guided questions, drill down with natural phrasing,
and mark every DEAD-END (wall / "isn't a term" / "unknown qualifier" / phrasing-miss / an invited
follow-up the engine can't take). For each one, diagnose the likely fix (almost always ROUTING a
natural phrasing to a capability tmct already has, not new capability) and ROUTE it: a small local
gap becomes a `NEXT.md` open item (whoever lands the fix verifies it live and freezes a
`test/chatflow-*.test.mjs` regression); anything architectural goes to a `PLAN_*.md`. Run this as **persona-sweep
mode** by default (§3.4: several genuinely different persona/frame sub-agents dispatched IN
PARALLEL — fast, because it's parallel, and the only mode that reliably finds a dead-end outside
whatever single frame a chained or ladder run happens to start in), or ask explicitly for **full
ladder mode** (§2: ratchet the FLOW-0…FLOW-6 complexity ladder one tier at a time, open-ended, run inline)
or **capped sprint mode** (§3: a bounded, default-3-round CHAINED cadence, serial by construction —
reserve it for when the operator wants to watch a sprint's follow-up depth in real time, not as the
default single-run pass). Whichever mode, write up the run as `BENCHMARK_CONVERSATION_<version>.md`
(§4) — headline, per-persona/per-round/per-tier breakdown, ladder position reached, and a routed
backlog (every dead-end found, its diagnosis, and where it was sent), with every open item mirrored
into `NEXT.md` as a one-line pickup item — the same "decision log" shape
the other three benchmarks already use.
