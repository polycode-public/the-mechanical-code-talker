# PLAN_DIALOGUE_ACTS.md — name tmct's turn types to ISO 24617-2, deterministically

Status: BUILT (2026-07-18 run) — steps 1–2: the closed vocabulary and lane lookup live in
`src/domain/dialogue-acts.mjs` (`DIALOGUE_ACTS`, `LANE_DIALOGUE_ACTS`, `dialogueActForLane`),
declared as `dact:` terms in `ontology/tmct-core.ttl` §1d, unit-tested
(`test/adapters/dialogue-acts.test.mjs`) and two-way-pinned against the ontology
(`test/adapters/grammar-ontology.test.mjs`). Steps 3–4: `src/services/chat.mjs` stamps
`record.dialogueAct` per turn from the routed lane (teach/ask/plan/game/conversational lanes,
the honest miss as autoNegative) and prints the label in the `/narrate` trace, pinned by
`test/adapters/chat-dialogue-act-labels.test.mjs`. Step 5: the reference doc's consumer note
names the chat attachment; audit row 139 moves at the next audit re-measure, not from this
plan. This plan carries the ISO 24617-2
dialogue-act work out of the archived normative review (`archive/PLAN_NORMATIVE.md` §4.6). The
reference mapping and the implemented subset live at
[`iso-24617-2-dialogue-acts.md`](docs/references/schemas/iso-24617-2-dialogue-acts.md).

## What this is

ISO 24617-2 (part of SemAF, the Semantic Annotation Framework) is the published standard for
**dialogue acts** — the communicative function of an utterance: a question, an answer, an instruct,
an inform, feedback, and so on, across nine dimensions. tmct's router already sorts every turn into
a lane (teach / ask / plan / …), so it already makes the classification a dialogue-act scheme would
name. It just names it in its own words and never records the label.

The deliverable is a dialogue-act label on every turn, named to ISO 24617-2's functions, so a
reader (and a future NLU benchmark) can see what communicative act tmct thinks each turn is.

## The load-bearing design decision

**The label is a deterministic function of the router's existing decision, not a learned intent
classifier.** The router already picks the lane; this attaches an ISO-named tag to that decision
through a fixed lookup. There is no model in the loop — that keeps it inside the no-LLM constitution
and consistent with `CLAUDE.md`'s preference for a curated table over an inferred rule.

The invariant that makes the standard worth adopting rather than coining an ad-hoc set: **tmct's
honest miss is itself a dialogue act — an `autoFeedback` function (feedback about tmct's own
processing), not a `task` answer.** A naive intent taxonomy flattens the two; ISO 24617-2 keeps them
apart, and so must this. A timeout is a miss, never a guess, and a miss is feedback, never a failed
answer.

## Step 1 — fix the subset (design, before code) — BUILT

Built as `DIALOGUE_ACTS` + `LANE_DIALOGUE_ACTS` in `src/domain/dialogue-acts.mjs`. One refinement
on the draft table below: the miss maps to the FUNCTION `autoNegative` (the draft named only the
dimension), keeping function and dimension distinct the way the standard does.

The full standard is nine dimensions and dozens of functions; tmct will implement the subset its
lanes already cover and name the rest a horizon. The first deliverable is the mapping table:
tmct lane / parse result → ISO 24617-2 function (+ its dimension). The starting shape, to be
confirmed against the reference doc:

| tmct turn | ISO 24617-2 function | dimension |
|---|---|---|
| an `ask` (what/which/who/is/does …) | a Question function (`setQuestion` / `propositionalQuestion` / `checkQuestion`) | Task |
| a `teach` declarative | `inform` (or `instruct` for an action rule) | Task |
| a goal / imperative (`solve it`, `get all disks onto peg-c`) | `request` / `instruct` | Task |
| an honest miss | `autoFeedback` | Auto-Feedback |
| a help/orientation turn | `inform` about the system's own function | Auto-Feedback / Task |

Getting this table right — especially the question sub-types and the miss-as-feedback line — is the
real work. The rest is wiring.

## Step 2 — build the closed vocabulary — BUILT

Built: `ontology/tmct-core.ttl` §1d declares the `dact:` set, and
`test/adapters/grammar-ontology.test.mjs` pins table and declaration to each other, both ways.

Declare a closed dialogue-act vocabulary named to ISO 24617-2's function names — a `dact:`-style
CURIE set (or a `DIALOGUE_ACTS` table) — in `ontology/tmct-core.ttl`, alongside the other
vocabularies, so the alignment is machine-checkable the way the PROV and SEON alignments are.

## Step 3 — attach the label — BUILT

Set a `dialogueAct` field on each turn's chat envelope from a deterministic map over the router's
lane / parse result. No new classifier: a lookup over a decision already made. Surface it in the
envelope and, optionally, a `/dialogue-act` (or `/why`) command and a tool-layer field.

## Step 4 — pin it (evidence, per `SKILL_CAPABILITIES_AUDIT.md` §1) — BUILT

- corpus / unit tests asserting each turn type carries the right ISO-named act — a teach → `inform`,
  an ask → `setQuestion`, and the honest miss → `autoFeedback` (the honesty-preserving distinction);
- a `grammar-ontology`-style test that the vocabulary is declared and aligns to the standard — an
  alignment claim in the ontology needs a test.

## Step 5 — document — BUILT (reference doc; audit row 139 moves at the next audit)

Mark the implemented functions in [`iso-24617-2-dialogue-acts.md`](docs/references/schemas/iso-24617-2-dialogue-acts.md);
move capability-audit row 139 from `absent` to `partial` (or `implemented`) for the covered subset,
citing the tests; add a README standards line ("dialogue acts named per ISO 24617-2"); and name the
uncovered functions as the remaining horizon — no wall, just the functions no lane yet produces.

## Where it connects

[`PLAN_NLU_BENCHMARKS.md`](PLAN_NLU_BENCHMARKS.md) scores tmct on the CLINC150 / HWU64 intent sets.
The dialogue-act vocabulary this plan builds is the label those benchmarks would score against, so
the two are worth designing together: the vocabulary decides what "intent" means for tmct, and the
benchmark measures how well the deterministic labeller assigns it.
