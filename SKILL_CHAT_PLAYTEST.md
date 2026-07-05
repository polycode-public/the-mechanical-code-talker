# SKILL_CHAT_PLAYTEST.md — the dialogue-flow loop (chat it, find the dead-ends, fix, replay, ratchet)

A fast, qualitative improvement loop for the CHAT SURFACE. Claude plays a curious user, holds
natural conversations with tmct, reviews the transcripts for **dead-ends** and broken flow, fixes
them, regression-tests, then **replays the same conversations** to confirm they now flow — and once
a tier of conversations flows to a useful outcome with zero dead-ends, **ratchets up the
complexity** and repeats.

This is the complement to `SKILL_TUNING_CYCLE.md`, not a replacement:

| | `SKILL_TUNING_CYCLE` | `SKILL_CHAT_PLAYTEST` (this) |
|---|---|---|
| question | is the aggregate quality UP? | does the conversation FLOW, or hit a wall? |
| signal | LLM-judge rubric mean over a case set | dead-ends + unnatural breaks in a real dialogue |
| cost/speed | judge calls, ~an hour, $ per cycle | no judge, no $, minutes per iteration |
| unit | one lever, measured | one conversation, made to flow |
| output | `CHATBENCH_<version>.md` + a mean | a growing suite of frozen "must-flow" transcripts |

Use them together: this loop catches the dead-ends a mean can hide (a 1.4 mean can still leave a
user stuck at turn 4); the benchmark confirms the fixes moved the aggregate and didn't regress it.

> **Invoke it:** *"Follow `SKILL_CHAT_PLAYTEST.md` and run the dialogue-flow loop"* (optionally: a
> starting graph — a shipped example, e.g. `examples/mini-webapp` — and a complexity tier).

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
  take.

The bar: **every turn either answers, or gives a guiding nudge toward a precise query** (the "if you
mean X then…" surround, a "did you mean" repair, a short tailored hint). A turn that does neither is
a dead-end, and dead-ends are the whole quarry.

---

## 1. The loop (one iteration)

**Step 1 — CHAT (play a curious user).** Against a loaded graph (start with a shipped example so the
answers are real — `node bin/tmct.mjs chat --repo examples/mini-webapp`), hold a natural
conversation at the current complexity tier (§3). Rules that make the play realistic:
- **Follow the product's own guided questions.** When the concept force says "Want to go deeper? Try:
  which classes inherit from Record", ASK one of those next — then ask YOUR natural follow-up to its
  answer, in your own words, not the grammar's.
- **Drill down.** concept → instance → its relations → their relations. Let the focus/`it` anaphora
  carry ("what calls it", "what uses that", "where is it defined").
- **Phrase naturally, not to the grammar.** "what functions are in Task", "what defined saveStore",
  "what about imports" — the way a developer actually types, including typos and politeness frames.
- Capture the transcript VERBATIM (pipe the turns: `printf 'q1\nq2\n…\n/exit\n' | node bin/tmct.mjs
  chat --repo <graph>`). Run 3–6 short conversations per tier from different entry points.

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
outcome** (the user learned something real about the codebase) with **zero dead-ends**? Freeze the
now-flowing conversations as regression transcripts (a `test/chatflow-*.test.mjs`, kin to
`showcase.test.mjs`) — a dead-end that reappears there later is a regression, caught for free.

**Step 6 — REPEAT at this tier** until several fresh conversations at the current complexity flow
clean, first try, from any entry point.

**Step 7 — RATCHET.** Raise the complexity tier (§3) and go to Step 1. Only escalate when the current
tier is reliably dead-end-free — the same ladder discipline the benchmark uses, applied to flow.

---

## 2. What "flows to a useful outcome" means

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

## 3. The complexity ladder (ratchet only when the tier is clean)

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
marked as such — the bar there is an **honest, guiding** dead-non-end, not a wall.

---

## 4. Discipline (so the loop stays honest)

- **Play, don't cheat.** Ask the way a user would, not the way the grammar wants. The value is the
  gap between them.
- **Fix routing, not rigidity.** A dead-end is usually a missing SYNONYM/route to an existing
  capability. Reach for the tolerant strategies and the concept force before adding grammar that
  makes the next phrasing fail.
- **Freeze what flows.** Every passed conversation becomes a regression transcript. The suite is the
  memory; without it, fixed dead-ends silently return.
- **Regression is sacred.** `npm test` green, showcase byte-exact, no tier-1 bench regression at
  every iteration — same contract as `SKILL_TUNING_CYCLE`.
- **Honest dead-non-ends.** When there is truly no answer, the turn still must GUIDE (a nudge, a
  "did you mean", an offer to learn) — an honest miss that keeps the conversation alive is FLOW, a
  bare wall is a dead-end.
- **Then measure.** After a tier flows clean, run the version-matched `CHATBENCH_<version>` benchmark
  to confirm the flow fixes moved the aggregate and regressed nothing. Flow and mean are two views of
  the same product; this loop shapes the flow, the benchmark scores it.

---

## 5. One-paragraph TL;DR

Play a curious user against a loaded example graph: follow the product's own guided questions, drill
down with natural phrasing, and mark every DEAD-END (wall / "isn't a term" / "unknown qualifier" /
phrasing-miss / an invited follow-up the engine can't take). Fix the dead-ends by ROUTING natural
phrasings to capabilities tmct already has (not by adding grammar rigidity), keep `npm test` +
showcase + the bench green, then REPLAY the exact same conversations until they flow to a useful
outcome with zero dead-ends — and freeze them as regression transcripts. Ratchet the complexity a
tier and repeat. It is faster than the judge cycle because the signal is "did the conversation flow"
you can read directly, not a mean you have to pay a judge to estimate.
