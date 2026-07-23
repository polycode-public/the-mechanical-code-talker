# SKILL_BENCHMARK_AGI_SCALES.md — the AGI-scales measure-then-assess cycle (eight scalar capabilities, held from cycle one)

The repeatable loop that grades tmct against the capabilities a general system would need, on eight
scalar scales instead of one pass/fail line. Each scale runs from an **entry rung tmct passes
today** to a **level above it we are probably short of**, so the metric is held from the first
cycle rather than waiting for the ceiling to arrive. AGIBENCH is not a harness with a `run.mjs`
behind it. A cycle produces `BENCHMARK_AGI_<version>.md`: a reviewed reading of the codebase and
demos against these scales, plus any scalar readings a scale already has a probe for.

**The eight scales are finite but non-limiting.** The AGI won't sit in this sandbox, so none of
these tops out at a wall. Each is a ruler with headroom above the current reading: an entry rung
that is on record, and a described rung above it that names what growth looks like without designing
the mechanism for it. Where an existing bench already measures the relevant axis, this doc points
there rather than re-deriving the number. `SKILL_BENCHMARK_CONVERSATION.md`,
`SKILL_BENCHMARK_INFERENCE.md`, and `SKILL_BENCHMARK_AGENT.md` each own one.

**This is its own scale set, not a re-labelling of the others.** CHATBENCH's CEFR grades linguistic
complexity, INFBENCH's `INF-1…INF-10` grades logic-fragment expressivity, AGENTBENCH's
`TOOL-0…TOOL-10` grades tool-use, SYNTHBENCH's `SYN-0…SYN-8` grades code synthesis. These eight
scales grade the general-intelligence axes those benches touch only at their top rungs. A scale
reading is never compared against a CEFR grade or an `INF-*` band.

## The eight scales

| scale | what it runs from → to | entry rung (tmct passes today) | the rung above (described only) |
|---|---|---|---|
| **Abstention calibration** | how much it answers at what fabrication rate: the risk-coverage trade, with every bench's zero-fabrication gate as the fixed-risk point | fabrication 0% at ≥50% coverage on the graded pools (on record across INFBENCH, AGENTBENCH, CHATBENCH) | a measured risk-coverage curve, coverage growing version-on-version at fixed zero risk |
| **Transfer breadth** | how many domains it acquires with no engine change | three plan-lane domains acquired with zero engine changes (hanoi, river crossing, crates, on record) | a domain outside the shipped vocabularies acquired teach-only in one session |
| **Other-minds depth** | how deep the belief nesting goes (`SKILL_BENCHMARK_CONVERSATION.md` FLOW-8, plus the spider-fly worlds) | depth 1: spider-fly beliefs including taught false beliefs, on record in its corpus lane | depth 2 in conversation, a believer of beliefs (FLOW-8) |
| **Temporal-causal depth** | ordering, last-touch, cross-turn composition, counterfactual re-solve (`SKILL_BENCHMARK_INFERENCE.md` INF-10, plus frozen compositional row 19) | ordered snapshots plus last-touch temporal reads, on record | one cross-turn temporal composition (frozen row 19) and one re-solved counterfactual (INF-10) |
| **Goal-origination distance** | how far a goal travels from declared to self-originated, on four notches (`SKILL_BENCHMARK_AGENT.md` TOOL-6 deduced-and-reached, TOOL-9 inferred-and-horizon) | notch 2 of 4: declared goals plus deduced maintenance goals, the goal-reasoner on record | notch 3, a goal inferred from an observed trace (TOOL-9) |
| **Knowledge-scale tolerance** | how many facts it answers over while holding zero fabrication | the shipped seed bands (~93k triples) answer with 0% fabrication, on record | the same at 10× facts with tie-rates held |
| **Stability × plasticity** | growth per session against interference with what it already knew | append-only teach with prior answers byte-stable within a session, regression-pinned across the corpus lanes | a measured growth-per-session rate with a zero-interference guarantee across sessions |
| **Loop closure** | how far round perceive → decide → act → verify → learn it closes on its own | autoplay completes perceive → decide → act → verify to a stall or a win honestly, on record | a full perceive → … → LEARN cycle closed autonomously, the learned fact provably used by a later cycle |

Each entry rung is a criterion CURRENT tmct meets, sourced above so the reading is auditable, not
asserted. Each rung above is described, not built: this doc names what the next level looks like and
stops there, deliberately without a mechanism design for it. When a scale's next rung is designed
and measured, its build path is the plan doc that owns that axis, and the reading moves in the
write-up, never here.

> **Invoke it by telling a session:** *"Follow `SKILL_BENCHMARK_AGI_SCALES.md` and run an AGI-scales
> cycle"* (optionally: a scale to focus, a version stamp).

---

## 1. The measurement contract (never weakened by this skill)

Every cycle MUST satisfy:

- **Artifact naming — match the `package.json` version.** A cycle's write-up is named after the
  tmct version it grades: `BENCHMARK_AGI_<version>.md`. A RE-RUN of the same version (a re-read after
  a fix, a second reviewer) appends `_00N`: `BENCHMARK_AGI_2.11.9_001.md`, `_002`, … — the same
  convention `SKILL_BENCHMARK_CEFR_ENGLISH.md` §1, `SKILL_BENCHMARK_INFERENCE.md` §1, and
  `SKILL_BENCHMARK_AGENT.md` §1 all use.
- **Record the timing.** The write-up carries the wall-clock start and end of the **assessment**
  (reading the tree and demos against the eight scales) and, when a scale is measured, the start and
  end of that **measurement run**, with the date. A reader comparing two versions needs the
  assessment time and any run time as separate figures.
- **Two measures a cycle can carry, and it says which it ran.**
  - **The code assessment** — a reviewed reading of the current codebase and demos, mapping what
    the site shows onto the classic-AI capability areas, what is absent at that same level, and what
    is different in kind. This is always present. It is the qualitative floor of every cycle.
  - **The scalar readings** — a number or rung on each of the eight scales, present for a scale only
    once it has a runnable probe. A cycle states plainly, per scale, whether it read a scalar or
    graded by assessment alone.
- **No fabricated rung.** An entry rung is claimed only with its source: a bench result on record, a
  frozen corpus row, a shipped seed band. A scale with no probe yet is graded by assessment and
  labelled as such, never given an invented number.
- **The no-LLM line holds.** The product path stays deterministic. The code assessment is a
  reviewer's reading; any scalar probe a scale grows is deterministic once built, the same as every
  other bench in this repo. An LLM enters only where the existing eval harness already allows it, and
  never the product.

## 2. The loop (one cycle: assess → read the scales → write up)

**Step 1 — READ.** Read the latest `BENCHMARK_AGI_<version>.md` on record (its code assessment and
any scalar readings), the entry-rung sources this doc cites, and the AGI-axis open items in
`NEXT.md`. Decide whether this cycle is assessment-only or reads a scalar on a scale that has since
grown a probe.

**Step 2 — ASSESS.** Re-read the codebase and demos against the eight scales. For each scale,
confirm the entry rung still holds (its source still passes) and note anything that moved toward the
rung above. Where a sibling bench owns the axis, read its latest write-up rather than re-deriving:
FLOW-8 for other-minds depth, INF-10 and frozen row 19 for temporal-causal depth, TOOL-6/TOOL-9 for
goal-origination distance.

**Step 3 — READ THE SCALES.** For each scale, record the current rung: the entry rung passed, plus
any measured progress toward the next. A scale with no probe yet reads as "entry rung held,
assessment only" — a legitimate reading, not a gap.

**Step 4 — WRITE the cycle up.** Write `BENCHMARK_AGI_<version>.md`:
- a headline naming what moved since the last cycle, or that the reading is unchanged;
- the timing (assessment interval, plus any measurement interval), with the date;
- the **code assessment** section — the reviewed reading of the tree and demos;
- a per-scale line: entry rung held (with its source), and the reading toward the rung above, marked
  as a scalar or as assessment-only;
- a decision line: which scale, if any, is the one to grow a probe or a capability for next.

**Mirror every open item** (a scale worth building a probe for, an entry rung whose source needs
re-pinning) **into `NEXT.md`** as a one-line pickup pointing at this write-up.

---

## 3. Discipline

- **The entry rung is held from cycle one.** Every scale already has a criterion tmct passes, so no
  scale sits unmeasured waiting for its ceiling. A cycle that only confirms the eight entry rungs
  still hold is a legitimate, reportable outcome.
- **The rung above is described, never designed here.** This doc names what the next level looks
  like and stops. The mechanism for it lives in the plan doc that owns the axis, and gets designed
  when that plan reaches it, not in this skill.
- **Headroom, never a wall.** These scales are finite but non-limiting. A scale's top is the current
  reading, not a claim about what the axis can reach. Write every next rung as a rung, not a ceiling.
- **Point, don't duplicate.** Where CONVERSATION, INFERENCE, or AGENT already measures an axis, cite
  its write-up and its rung. This doc holds the map; those benches hold the numbers for the axes they
  own.
- **No invented number.** An entry rung carries its source; a scale without a probe grades by
  assessment and says so. There is no honest way to post a scalar a probe did not produce.

---

## 4. One-paragraph TL;DR

Grade tmct against eight general-intelligence scales — abstention calibration, transfer breadth,
other-minds depth, temporal-causal depth, goal-origination distance, knowledge-scale tolerance,
stability × plasticity, loop closure — each running from an entry rung tmct passes today to a
described rung above it, so the metric is held from the first cycle. Where a sibling bench owns the
axis (FLOW-8 for other-minds, INF-10 and frozen row 19 for temporal-causal, TOOL-6/TOOL-9 for
goal-origination, every bench's zero-fabrication gate for abstention), point there rather than
re-deriving the number. A cycle reads the tree and demos against the scales, records the entry rung
and any measured progress toward the next, and writes `BENCHMARK_AGI_<version>.md` (headline,
timing, code assessment, per-scale reading, decision), mirroring anything open into `NEXT.md`. The
scales are finite but non-limiting: the AGI won't sit in this sandbox, so every next rung is written
as headroom, never a wall.
