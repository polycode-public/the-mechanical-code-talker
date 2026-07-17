# STRIPS and PDDL — the operator/effect model

**Canonical sources:**
Fikes, R. E., & Nilsson, N. J. (1971), "STRIPS: A New Approach to the Application of Theorem Proving
to Problem Solving", *Artificial Intelligence* **2**(3–4), pp. 189–208, DOI
[10.1016/0004-3702(71)90010-5](https://doi.org/10.1016/0004-3702(71)90010-5) · free PDF:
https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/strips.pdf · presented at IJCAI-2,
Imperial College London, 1–3 September 1971.
McDermott, D., Ghallab, M., Howe, A., Knoblock, C., Ram, A., Veloso, M., Weld, D., & Wilkins, D.
(1998), "PDDL — The Planning Domain Definition Language", Version 1.2, Tech Report **CVC TR-98-003 /
DCS TR-1165**, Yale Center for Computational Vision and Control, **October 1998** —
https://homepages.inf.ed.ac.uk/mfourman/tools/propplan/pddl.pdf (the `cs.yale.edu` copy 404s).
Retrospective: Fikes & Nilsson (1993), "STRIPS, a retrospective", *Artificial Intelligence* 59(1–2),
pp. 227–232.
**Licence:** link-only. · **Consumer:** `PLAN_AGENTS.md` (Stage 0, the capability
declaration format; Stage 1, the resolver; router status at §1.3). · **Status:** **VERIFIED
2026-07-17** — the STRIPS DOI resolves and the free PDF is the correct paper; PDDL's two report
numbers were read from the TR's own title page.

Two notes for anyone citing from here. The PDDL title page reads "produced by the AIPS-98 Planning
Competition Committee" and lists the eight authors **alphabetically**, with McDermott as chair —
"McDermott et al." is conventional and fine. And **planning.wiki's PDDL author list is wrong**: it
conflates PDDL's byline with the adjacent credit line for the UCPOP language manual. Don't
propagate it.

**The current version is PDDL 3.1**, and has been the IPC standard since 2011 — the IPC 2023
classical track states "IPC 2023 will use a subset of PDDL 3.1, as done since IPC 2011". The
practically implemented fragment is narrower: Fast Downward's own docs say it "aims to support PDDL
2.2 level 1 plus the `:action-costs` requirement from PDDL 3.1". PDDL 2.1 (Fox & Long, *JAIR* 20,
2003, pp. 61–124, DOI 10.1613/jair.1129 — open access) remains the most-cited layer.

## What it is

**STRIPS** (Stanford Research Institute Problem Solver) gave planning its enduring representation: an
**operator** is a triple of
- **preconditions** — facts that must hold for the operator to apply,
- an **add list** — facts it makes true,
- a **delete list** — facts it makes false.

A planning problem is an initial state, a goal (a set of facts to make true), and a set of operators;
a plan is a sequence (or partial order) of operator instances that transforms the initial state into
one satisfying the goal. The **STRIPS assumption** — everything not on the delete list is unchanged —
is what makes the state update tractable. It is a **closed-world-style default**, and not the same
thing as the closed-world assumption: the STRIPS assumption is a default about an *operator's*
non-effects, the CWA (Reiter 1978) is a default about a *database's* unprovable facts. Cousins, over
different domains. **The 1971 paper never uses the phrase "STRIPS assumption"** — an exhaustive grep
of the full text returns nothing, and the coiner could not be identified (Lifschitz's 1986 "On the
Semantics of STRIPS" does not use it either). It is later community shorthand.

**PDDL** (Planning Domain Definition Language) is the modern, standard *syntax* for that model,
factored into a reusable **domain** (the operators/types/predicates) and a per-task **problem** (the
objects, initial state, goal). It is the lingua franca of the International Planning Competition, so a
domain written in PDDL can be handed to dozens of off-the-shelf solvers.

## Why it matters to tmct

This is the **most direct mapping** in the whole reference set: a **capability is a STRIPS/PDDL
operator**.

1. **Capabilities-as-facts = operators.** A tool declared with the type of thing it acts on, its
   **preconditions** (what must be true to call it — file exists, path in-repo) and its **effects**
   (what it changes) *is* a STRIPS operator expressed in tmct's OWL vocabulary. The router's "declare
   your capabilities" step is authoring a PDDL-style domain.
2. **The resolver is operator selection.** Backward chaining from a goal/open condition to an operator
   whose effect achieves it is exactly what Stage 1 does; the difference is only notation (OWL
   unification vs. PDDL matching).
3. **Preconditions are the safety gate.** A capability that will not fire unless its preconditions are
   provably satisfied is why the router *refuses* rather than issuing an unsafe call — the same
   discipline as tmct's honest miss, now enforced by the operator model.
4. **The closed-world assumption is where the domain ends and the open world starts.** STRIPS is
   powerful *because* it assumes a closed world. Inside a declared, closed domain a planner is
   complete and deterministic. Outside it — an effect nobody modelled, a novel error — the assumption
   does not hold and tmct escalates rather than guessing. **That boundary is a research horizon, not
   a limit of tmct's design.** Planning under an open world has active literatures: Ghallab, Nau &
   Traverso's *Automated Planning and Acting* (CUP, 2016) reframes the problem around acting, with
   interleaved planning, execution and monitoring; IPC-26 runs a first-ever **Epistemic Planning**
   track (ICAPS 2026, Dublin) with its own EPDDL language for reasoning about what agents know. Until
   a tier is designed against one of those, an unmodelled effect lands on the honest miss wall.

   The same distinction does double duty in tmct, on opposite sides. The planner's operator model is
   **closed-world** by design. The chat layer's honest miss is **open-world**: it refuses to read "no
   matching rule" as "the answer is no" (§ "The open-world half" below).

Reusing PDDL rather than inventing a format also means the router could, in principle, **delegate to a
mature external solver** (Fast Downward, an IPC planner) for the hard search, keeping tmct's job as
the NL→domain compiler and the proof-chain renderer.

## The open-world half — the same distinction, doing opposite work

Worth writing down, because it connects the planner to the chat layer and nothing else in the
reference set says it.

**Reiter, R. (1978), "On Closed World Data Bases", in Gallaire & Minker (eds.), *Logic and Data
Bases*, Plenum Press, pp. 55–76** (Springer chapter DOI 10.1007/978-1-4684-3384-5_3; volume ISBN
0-306-40060-X). *Note the page range: DBLP gives 55–76, and a widely-copied 119–140 is wrong.*
Companion in the same volume: **Clark, K. L., "Negation as Failure", pp. 293–322**
(DOI 10.1007/978-1-4684-3384-5_11).

- **CWA:** a ground fact not derivable is **false**. Absence of proof is proof of absence.
- **OWA:** a fact not derivable is **unknown** — neither true nor false.

tmct runs both, deliberately, on opposite sides of the product:

- **The planner's operator model is closed-world.** That is what makes a plan checkable.
- **The chat layer is open-world.** The honest miss is exactly the OWA move: it refuses to read "no
  matching rule" as "the answer is no". OWL is open-world too, and the *OWL 2 Primer* (W3C
  Recommendation, 11 December 2012) says so directly: "If some fact is not present in a database, it
  is usually considered false (the so-called closed-world assumption) whereas in the case of an OWL 2
  document it may simply be missing (but possibly true), following the open-world assumption."

This matters for how tmct's abstention is described. The ML abstention literature (Chow's reject
option, selective classification) is **threshold-based**: it rejects when a confidence score falls
below *t*. tmct has no confidence score to threshold — it abstains because no rule matched, which is
not low confidence but **outside the function's domain**. The open-world/unknown lineage names the
mechanism; the abstention literature names the goal. `PLAN_NORMATIVE.md` §9.8 keeps them apart.

## Links

- STRIPS (1971): https://ai.stanford.edu/~nilsson/OnlinePubs-Nils/PublishedPapers/strips.pdf
- PDDL 1.2 TR (1998): https://homepages.inf.ed.ac.uk/mfourman/tools/propplan/pddl.pdf
- PDDL 2.1 (Fox & Long, JAIR 20, 2003): https://jair.org/index.php/jair/article/view/10352
- Fast Downward (reference solver): https://www.fast-downward.org/
- Ghallab, Nau & Traverso, *Automated Planning and Acting* (CUP, 2016) — authors' PDF, posted by
  permission of Cambridge University Press, personal use only, **not redistributable**:
  https://projects.laas.fr/planning/apa/APAbook.pdf
