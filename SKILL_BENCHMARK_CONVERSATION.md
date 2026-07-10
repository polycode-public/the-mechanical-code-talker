# SKILL_BENCHMARK_PLAYTEST.md — the dialogue-flow playtest cycle (dead-ends, fixes, two run modes)

A fast, qualitative improvement loop for the CHAT SURFACE. Claude plays a curious user, holds
natural conversations with tmct, reviews the transcripts for **dead-ends** and broken flow, fixes
them, regression-tests, then **replays the same conversations** to confirm they now flow — and once
a tier of conversations flows to a useful outcome with zero dead-ends, **ratchets up the
complexity** and repeats.

This is the complement to `SKILL_BENCHMARK_CHAT.md`, not a replacement:

| | `SKILL_BENCHMARK_CHAT` | `SKILL_BENCHMARK_PLAYTEST` (this) |
|---|---|---|
| question | is the aggregate quality UP? | does the conversation FLOW, or hit a wall? |
| signal | LLM-judge rubric mean over a case set | dead-ends + unnatural breaks in a real dialogue |
| cost/speed | judge calls, ~an hour, $ per cycle | no judge, no $, minutes per iteration |
| unit | one lever, measured | one conversation, made to flow |
| output | `CHATBENCH_<version>.md` + a mean | `PLAYTESTBENCH_<version>.md` + a growing suite of frozen "must-flow" transcripts |

Use them together: this loop catches the dead-ends a mean can hide (a 1.4 mean can still leave a
user stuck at turn 4); the benchmark confirms the fixes moved the aggregate and didn't regress it.

This skill has **two modes**, sharing the same discipline (§1):

- **Full ladder mode** (§2) — open-ended, run by the main agent inline, ratcheting a Tier 0–6
  complexity ladder one tier at a time.
- **Capped sprint mode** (§3) — a bounded, small number of rounds (default 3), each round's chat
  delegated to a background sub-agent under the coordinator model, chained off the prior round's
  transcript.

Pick full ladder mode to push into new complexity territory; pick capped sprint mode for a
bounded, mostly-hands-off pass, or when the operator wants a clear stop and a recommendation at
the end.

> **Invoke it:** *"Follow `SKILL_BENCHMARK_PLAYTEST.md` and run the dialogue-flow loop"*
> (optionally: a starting graph, a complexity tier, or "as a capped sprint" / a round cap for
> capped sprint mode).

---

## 0. The load-bearing idea

tmct's promise (item 1) is a **tolerant** surface that **guides you toward precision**. The failure
mode is not a wrong answer — it is a **dead-end**: a turn that neither answers nor nudges, so the
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
  worse than no suggestion, because it spends the user's trust on a promise the product didn't keep).

The bar: **every turn either answers, or gives a guiding nudge toward a precise query** (the "if you
mean X then…" surround, a "did you mean" repair, a short tailored hint). A turn that does neither is
a dead-end, and dead-ends are the whole quarry.

---

## 1. The shared discipline: chat, find dead-ends, fix, freeze, replay

Both modes run the same five-step loop. Full ladder mode runs it inline, one tier at a time (§2).
Capped sprint mode runs it in bounded rounds, with Step 1 delegated to a background sub-agent and
Steps 2–5 handled by the coordinator in the primary chat (§3).

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
- Capture the transcript VERBATIM (pipe the turns: `printf 'q1\nq2\n…\n/exit\n' | node bin/tmct.mjs
  chat --repo <graph>`). In full ladder mode, run 3–6 short conversations per tier from different
  entry points (§2); in capped sprint mode, one conversation per round, chained off the prior round
  (§3).

**Step 2 — REVIEW (mark every dead-end).** Read each transcript top to bottom. For every turn, label
it FLOW (answered or nudged) or DEAD-END (§0). For each dead-end, write one line: the verbatim input,
what the user meant, and the capability that SHOULD have served it (usually one that already exists —
`/members`, "where is X defined", the concept force, a relation the graph has). The output is a
ranked dead-end list, most-flow-breaking first.

**Step 3 — IMPROVE (map the natural phrasing to the capability).** Fix the dead-ends as one coherent
change. The fix is almost always **routing/recognition**, not new capability: teach the parser that
"what functions are in X" ≡ members-of-class, "what defined X" ≡ where-is-X-defined, "what about
imports" ≡ the relation concept force. Never fabricate an answer; if a phrasing genuinely has no
answerable meaning, make its reply a **guiding nudge**, never a wall. Prefer extending the tolerant
strategies (`src/interpret/`), the concept force (`src/concept.mjs`), and the miss renderer
(`src/ask.mjs`) over adding grammar rigidity.

**Step 4 — REGRESSION-TEST.** `npm test` green; the byte-exact `test/showcase.test.mjs` intact; the
graded bench `--compare` shows no tier-1 regressions (`node chatbench/run.mjs --stamp playtest --dual
--out /tmp/pt --compare chatbench/results/raw/run-<lastversion>/product-a.jsonl`). A fix that flows
one conversation but regresses a frozen case is not done.

**Step 5 — REPLAY (the same conversations, verbatim).** Re-run the EXACT transcripts from Step 1. Each
dead-end must now be FLOW. Read the whole conversation again end-to-end: does it reach a **useful
outcome** (the user learned something real about the codebase) with **zero dead-ends** (§1b)? Freeze
the now-flowing conversations as regression transcripts (a `test/chatflow-*.test.mjs`, kin to
`showcase.test.mjs`) — a dead-end that reappears there later is a regression, caught for free.

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

The open-ended variant: the main agent chats inline at the current complexity tier, fixes what
breaks, replays, and only ratchets the tier up once the current one is reliably dead-end-free.

**Step 6 — REPEAT at this tier** until several fresh conversations at the current complexity flow
clean, first try, from any entry point.

**Step 7 — RATCHET.** Raise the complexity tier (§2.1) and go back to §1 Step 1. Only escalate when
the current tier is reliably dead-end-free — the same ladder discipline the benchmark uses, applied
to flow.

### 2.1 The complexity ladder (ratchet only when the tier is clean)

- **Tier 0 — before any graph: the bootstrap/identity surface.** No `--repo`, a bare `tmct chat` in
  an empty dir. Greetings, identity ("who are you", "what are you", "are you an AI/ChatGPT"), help/
  orientation, and vocabulary questions from the seeded ontology (`what is a cache`) — all BEFORE the
  user has pointed tmct at any code. This tier is a prerequisite to Tier 1, not a relaxation of it: a
  dead-end here (0.9.12: greetings/identity leading with "no code graph loaded" instead of the seeded
  knowledge) is a worse first impression than any structural dead-end, because it's the very first
  thing a new user sees. Play it with BOTH a normally-seeded session and `TMCT_NO_SEED=1` — an example
  that only works in one of those states and is offered in both is a dead-end (see §0's new bullet).
- **Tier 1 — single touch + one drill-down.** "what is a class" → follow one guided question →
  one natural follow-up. (Concept force + one relation.)
- **Tier 2 — drill-down chains with anaphora.** concept → instance → "what calls it" → "what uses
  that" → "where is it defined" — 4–8 turns, focus carried throughout.
- **Tier 3 — cross-concept & relation touches.** "what about imports", "what calls are there",
  mixing nouns and relations; the relation concept force.
- **Tier 4 — compositional & comparative.** "which functions call X and are untested", "which module
  has the most imports", "public methods of X", "which of those are tested".
- **Tier 5 — teach + recall + reasoning in dialogue.** assert a fact mid-conversation, recall it
  later, mix with graph truth; the honest "I don't know that yet" that offers to learn.
- **Tier 6 — the messy real user.** typos, politeness frames, topic switches, "no wait", vague
  openers, "what can you tell me about this repo" — the conversation a stranger actually has.

Each tier is only unlocked when the tier below flows dead-end-free across several fresh
conversations. A tier that is a genuine ceiling (a capability tmct deliberately does not have) is
marked as such — the bar there is an **honest, guiding** dead-non-end, not a wall. This ladder is a
qualitative flow ladder, purpose-built for this loop — it is not the CEFR bands `SKILL_BENCHMARK_
CHAT.md` uses or the `INF-A1…C2` bands `SKILL_BENCHMARK_INFERENCE.md` uses. Don't relabel it.

### 2.2 The surface-variation axis (orthogonal to the ladder)

The ladder (§2.1) ratchets what CONCEPTS a conversation touches. This axis instead re-plays the SAME
intent — a greeting, an identity question, a help/orientation ask — through different SURFACES of
English, at whatever tier you're currently playtesting. It's a multiplier, not another rung: run it
across Tier 0 and Tier 6 especially (both are "the messy real user" territory), and spot-check it
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
apology is a dead-end exactly like a missed structural phrasing — fix it the same way (§1 Step 3):
extend the closed set / the bounded-fuzzy fallback (`fuzzyMatchInSet`, `interpret/fuzzy.mjs`), never
loosen into a guess.

---

## 3. Capped sprint mode — the coordinator model in action

A short, bounded variant of §1's loop: instead of the open-ended tier ladder run by the main agent
inline, this runs a **fixed, small number of rounds** (default 3), each round's chat **delegated to
a background sub-agent**, each round's questions **chaining off the previous round's transcript** (a
real user's next question usually follows from what they just learned, not a fresh unrelated
topic), with the **main agent appraising each transcript in the primary chat** (never hidden in a
sub-agent's own output) and **shipping a confirmed fix immediately** (version bump + push) rather
than batching fixes to the end. Stops at the round cap or the first pair of rounds that finds
nothing worth fixing, whichever comes first, then reports a recommendation on whether to keep going.

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

> **Invoke it specifically:** *"Follow `SKILL_BENCHMARK_PLAYTEST.md` and run a playtest sprint"*
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
anything found is a REAL, FIXABLE issue (a routing/recognition gap to an existing capability, per §1
Step 3's "fix routing, not rigidity" discipline) or a genuine ceiling (name it as one, don't force a
fix).

**Round-Step 4 — FIX + SHIP, if warranted.** If Round-Step 3 found something real and fixable:
1. Make the fix (directly, or via a further-delegated sub-agent if the fix itself is substantial —
   the main agent's judgment call, same as any other fix in this repo).
2. `npm test` green, same regression discipline §1 Step 4 requires.
3. **Verify live** against the exact failing turn from the transcript — confirm it's now FLOW, not
   just that tests pass (tests can be wrong too; this whole mode exists because a real
   conversation is a better oracle than a fixture).
4. Bump `package.json` (patch, for a fix — same convention this repo's release commits already
   use), commit, **push immediately** — don't batch fixes across rounds. A round that ships is a
   round the operator can see land in real time, and a later round's chaining should build on the
   ACTUALLY-shipped state, not a pending one.
5. If Round-Step 3 found nothing worth fixing (a clean round, or only genuine ceilings), do not force
   a change — say so plainly and move to the next round anyway (a clean round is a good outcome, not
   a failure, and still gets chained into the next round's opener).

**Round-Step 5 — CONTINUE OR STOP.** Increment the round counter. Stop when EITHER:
- the round cap is reached (default 3), or
- a round finds nothing fixable AND the previous round also found nothing fixable (two clean
  rounds in a row — "getting nowhere," the operator's own phrase, read as a stopping signal, not
  just a round-count limit).

Whichever triggers first, go to §3.2.

### 3.2 The end-of-sprint report

After the loop stops, report to the operator in the primary chat:
- **Per round**: one line — what was tested, what was found, what shipped (or "clean round,
  nothing to fix").
- **Overall**: how many of the N rounds shipped a real fix vs. came back clean.
- **A recommendation**, not just a status: if fixes kept landing and the well doesn't look dry,
  say so and suggest another sprint (or escalating to full ladder mode, §2, for a deeper pass). If
  the last one or two rounds came back clean, say the sprint found what it was going to find at
  this complexity tier and recommend either stopping here or ratcheting the tier (§2.1) rather than
  repeating the same tier.

This report also feeds the `PLAYTESTBENCH_<version>.md` write-up (§4) when the sprint's findings are
worth recording as a versioned artifact.

### 3.3 Discipline specific to capped sprint mode

- **Delegate the CHAT, not the JUDGMENT.** The sub-agent's only job is to hold a real, natural
  conversation and hand back the raw transcript. Appraisal, the fix-or-not decision, and the
  ship-or-not decision all stay with the main agent, visible to the operator — a sub-agent silently
  deciding "this is fine" would defeat the point of asking to see every round.
- **Chain for realism, not padding.** The point of leading each round with the prior transcript is
  that real users ask follow-ups shaped by what they just learned — a fresh unrelated topic every
  round tests breadth, not depth, and this mode is explicitly the depth-and-follow-through variant
  (breadth is full ladder mode's multiple-entry-points-per-tier job, §1 Step 1).
- **Ship per-round, not in a batch.** A confirmed fix goes out immediately (version bump + push)
  rather than accumulating — this is a genuine choice (batching would be marginally more efficient
  release-wise) made because the operator asked for exactly this cadence, and because it means a
  crash mid-sprint still leaves every already-shipped fix live.
- **A clean round is a real result, not a null one.** Report it as such. Two clean rounds in a row
  is the stop signal, not a failure to find something to fix.
- **Cap is a ceiling, not a target.** If two rounds in a row come back clean before the cap is
  reached, stop early (§3.1 Round-Step 5) — don't force a 3rd round's worth of manufactured fixes
  just to hit the number.

---

## 4. The `PLAYTESTBENCH_<version>.md` report

Every playtest run — a full-ladder tier completion (§2) or a capped sprint (§3) — writes ONE
versioned report doc, matching the naming convention `SKILL_BENCHMARK_CHAT.md` §1 and
`SKILL_BENCHMARK_INFERENCE.md` already use: `PLAYTESTBENCH_<version>.md`, named after the
`package.json` version the run measured. A re-run of the same version (no version bump between
runs) appends `_00N`: `PLAYTESTBENCH_0.9.0_001.md`, `_002`, … This sits alongside, and does not
replace, the existing frozen `test/chatflow-*.test.mjs` regression files — the write-up is the
narrative record, the frozen tests are the enforcement.

Report structure:
- **Headline** — which mode ran (full ladder or capped sprint), the tier reached or the round count,
  the number of dead-ends found and fixed, and how many regression tests were frozen this run.
- **Per-round or per-tier breakdown** — full ladder mode: one entry per tier played this run, entry
  points tried, dead-ends found, fixes made; capped sprint mode: one entry per round (the same shape
  as §3.2's end-of-sprint report), what was tested, found, and shipped.
- **Ladder position reached** — the Tier 0–6 position this run reaches or confirms clean (§2.1). This
  stays the existing qualitative flow ladder — it is not CEFR and is never relabeled as such.
- **Next** — the recommended next tier, sprint, or focus area, mirroring the recommendation §3.2
  already produces for capped sprints, generalized to full ladder mode too (which tier to ratchet to
  next, or which dead-end class most needs attention).

---

## 5. Discipline (so the loop stays honest, in either mode)

- **Play, don't cheat.** Ask the way a user would, not the way the grammar wants. The value is the
  gap between them.
- **Fix routing, not rigidity.** A dead-end is usually a missing SYNONYM/route to an existing
  capability. Reach for the tolerant strategies and the concept force before adding grammar that
  makes the next phrasing fail.
- **Freeze what flows.** Every passed conversation becomes a regression transcript. The suite is the
  memory; without it, fixed dead-ends silently return.
- **Regression is sacred.** `npm test` green, showcase byte-exact, no tier-1 bench regression at
  every iteration — same contract as `SKILL_BENCHMARK_CHAT.md`.
- **Honest dead-non-ends.** When there is truly no answer, the turn still must GUIDE (a nudge, a
  "did you mean", an offer to learn) — an honest miss that keeps the conversation alive is FLOW, a
  bare wall is a dead-end.
- **Verify every offered example, in-state.** If a turn's reply says `try "X"`, actually ask `X` in
  that same session/seed state before calling the turn FLOW. A suggestion that wasn't checked is a
  guess wearing a helpful voice — score it a dead-end if it would fail (§0).
- **Then measure.** After a tier or sprint flows clean, run the version-matched `CHATBENCH_<version>`
  benchmark to confirm the flow fixes moved the aggregate and regressed nothing. Flow and mean are
  two views of the same product; this loop shapes the flow, the benchmark scores it.
- **Delegate long-running work under the coordinator model.** Capped sprint mode (§3) is the default
  example of this — the CHAT step is a background sub-agent by design. In full ladder mode, a
  substantial fix (§1 Step 3) that needs real implementation effort can equally be handed to a
  background sub-agent while the coordinator holds the appraisal/replay loop, per `CLAUDE.md`'s
  standing working model — the point in either mode is to keep the main chat free for judgment calls
  and the operator, not to hand-run every long step inline by default.

---

## 6. One-paragraph TL;DR

Play a curious user against a loaded example graph: follow the product's own guided questions, drill
down with natural phrasing, and mark every DEAD-END (wall / "isn't a term" / "unknown qualifier" /
phrasing-miss / an invited follow-up the engine can't take). Fix the dead-ends by ROUTING natural
phrasings to capabilities tmct already has (not by adding grammar rigidity), keep `npm test` +
showcase + the bench green, then REPLAY the exact same conversations until they flow to a useful
outcome with zero dead-ends — and freeze them as regression transcripts. Run this as **full ladder
mode** (§2: ratchet the Tier 0–6 complexity ladder one tier at a time, open-ended, run inline) or
**capped sprint mode** (§3: a bounded, default-3-round cadence with each round's chat delegated to a
background sub-agent under the coordinator model, chained off the prior round, shipping confirmed
fixes immediately). Either way, write up the run as `PLAYTESTBENCH_<version>.md` (§4) — headline,
per-round/per-tier breakdown, ladder position reached, and a next-steps recommendation — alongside
the frozen `test/chatflow-*.test.mjs` regression tests.
