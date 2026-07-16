# Partial-order planning (least-commitment planning)

**Canonical sources:** McAllester & Rosenblitt (1991), *Systematic Nonlinear Planning* (SNLP),
AAAI-91, https://cdn.aaai.org/AAAI/1991/AAAI91-099.pdf · Penberthy & Weld (1992), *UCPOP: A Sound,
Complete, Partial Order Planner for ADL*, KR'92,
https://homes.cs.washington.edu/~weld/papers/ucpop-kr92.pdf · overview:
https://en.wikipedia.org/wiki/Partial-order_planning
**Licence:** link-only (publisher/author copyright). · **Consumer:** `PLAN_AGENTS.md`
(Stages 1 & 5; router status at §1.3). · **Status:** UNVERIFIED-pending-web-check (authored from established knowledge).

## What it is

Partial-order planning (POP) builds a plan as a **set of actions with only the orderings that are
causally necessary** — never a fully sequenced list. Two actions that don't interact stay unordered.
This is the **least-commitment** principle: don't decide anything (an ordering, a variable binding)
until a causal requirement or a conflict forces you to. Less commitment means a smaller search space
and a plan that stays flexible as circumstances change.

## The four moving parts

- **Actions** — instances of operators (preconditions → effects), not yet totally ordered.
- **Causal links** — `A —p→ B` records "action A produces precondition *p* that action B needs". A
  causal link is the plan's *rationale*: it says exactly why A is present.
- **Ordering constraints** — `A < B`, added only when forced.
- **Open conditions** — preconditions no action yet achieves. Planning = closing open conditions.

The algorithm loops: pick an open condition → find (or add) an action that achieves it → add a causal
link → detect **threats** (an action whose effect ¬*p* could fall between A and B and clobber the
link) → resolve each threat by **promotion** (order the threat before A) or **demotion** (order it
after B) → backtrack if unresolvable. Terminate when no open conditions and no unresolved threats
remain.

## Why it matters to tmct

POP is the deterministic core the capability router's planning stage would sit on, and its vocabulary
is already tmct's:

1. **Open conditions = the resolver's job.** Closing an open condition by finding an achieving
   capability is exactly unification + backward chaining over capabilities-as-facts (Stage 1).
2. **Causal links = the proof chain.** tmct's whole pitch is the glass box — *why this tool call?*. A
   causal link answers it natively: "delete_file is here because verify needs the file gone." The
   plan is self-documenting, which is what an auditable, no-LLM router must be.
3. **Threats = conflict detection between tool calls.** Two proposed calls that clobber each other's
   preconditions are a threat; promotion/demotion is the deterministic resolution — and where no
   resolution exists, that is an honest "these can't both be done as asked", a cousin of tmct's
   "if you mean X then …" surround.
4. **Least commitment = don't over-order the loop.** Independent tool calls shouldn't be forced into a
   false sequence; POP keeps them parallel until a real dependency appears.

**UCPOP** (Penberthy & Weld) is the reference implementation to study: *sound and complete* for ADL
(conditional and universally-quantified effects), which is roughly the expressiveness a real toolset
needs. **SNLP** (McAllester & Rosenblitt) is the systematic, non-redundant search that made POP
respectable.

## Links

- SNLP (AAAI-91): https://cdn.aaai.org/AAAI/1991/AAAI91-099.pdf
- UCPOP (KR'92): https://homes.cs.washington.edu/~weld/papers/ucpop-kr92.pdf
- Overview: https://en.wikipedia.org/wiki/Partial-order_planning
