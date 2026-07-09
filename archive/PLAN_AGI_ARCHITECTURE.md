# PLAN_AGI_ARCHITECTURE.md — the ecosystem's knowledge/inference/LLM-decision architecture

*(Drafted 2026-07-08. Status: RESEARCH PLAN, not a build order. Origin: the operator's own
architecture statement — "The human world quantized as an OWL/RDF ontology plus all domain
lexicons representing all of a typical human's knowledge, and an inference engine, and some LLM
decisions (which are remembered), and LLM classification/parsing, and managing front of house and
loops." This doc's job is narrow and honest: check how much of that is *already real*, code-grounded,
across this operator's own four repos, before proposing anything new. Sibling to
[[PLAN_TMCT_ECOSYSTEM_INTEGRATION.md]] (the tmct/bedrock-meter/marginalia integration plan this
extends) and [[PLAN_CAPABILITY_ROUTER.md]] (the open-world escalation boundary this plan's LLM
pieces sit on).)*

**Ground rules, restated.** "AGI" is the operator's own word for the target shape, kept in the
title because it names the ambition honestly — but this doc does not claim general intelligence
is close, achievable, or even well-defined as an engineering target. What it *does* claim, and
verifies: most of the named pieces are not speculative — they are real, running code, today,
distributed across `tmct`, `marginalia`, `bedrock-meter`, and the Claude Code/seonix orchestration
layer. tmct's own contribution stays no-LLM, permanently, per `CLAUDE.md` — nothing here proposes
putting a model in tmct's product path. Where marginalia or bedrock-meter use an LLM, that is their
own ground rule, not tmct's, and this doc is explicit about the seam between the two.

---

## 1. The five-part architecture, checked against real code

| Part (operator's framing) | Verified status | Where |
|---|---|---|
| Human world quantized as OWL/RDF + domain lexicons | **Real, split by domain** | tmct's OWL-labelled graph + SEON/ConceptNet corpus (software domain); marginalia's `app/ontology/ontology.ttl` (Person/Organisation/Place/Event/Concept — general-knowledge domain) |
| An inference engine | **Real, narrow, in two places independently** | tmct's `src/syllogise.mjs` (2 rules: scm-sco, cax-sco — OWL 2 RL subset, bounded/trust-tiered/retractable); marginalia's `app/lib/inference.mjs` (isA-transitive, tagged `derived_by_inference`/`mg:derivedByInference`) |
| LLM decisions, remembered | **Real in marginalia, absent in tmct (by design)** | marginalia's typed-edge extraction pipeline (§2 below) — confirmed via direct code read, not assumed |
| LLM classification/parsing | **Real, at the escalation boundary** | marginalia's own LLM-driven chat; the shared "NL front end is what LLMs are for" boundary already named in `PLAN_CAPABILITY_ROUTER.md` |
| Managing front of house and loops | **Real, split across orchestration layers** | bedrock-meter's cost-ordered router (`packages/runtime/src/optimiser/router.mjs`, already ships a tmct rank-0 rung); Claude Code's own coordinator model driving this session |

**The honest upshot:** four of five parts are already built, just not unified — each repo built its
own slice of this architecture independently, for its own reasons, before anyone framed it as one
system. The interesting engineering question is not "can we build this" — it's "should these four
independently-evolved slices be made to interoperate, and if so, on whose terms."

---

## 2. LLM decisions, remembered — the actual marginalia mechanism (verified 2026-07-08)

An earlier draft of this conversation assumed this piece didn't exist anywhere in the ecosystem.
It does — code-grounded correction, not speculation:

**The write path.** `app/lib/typed-edges.mjs`'s `extractTypedEdges()` calls Bedrock
(`amazon.nova-lite-v1:0` by default) at temperature 0, with a closed-vocabulary prompt
(`prompts/typed-edges.md`) restricting the model to 9 fixed predicates (`mg:isA`, `mg:causes`,
`mg:contradicts`, `mg:precedes`, …) classifying the relationship between a new memory and its
neighbours. `validateEdges()`/`parseEdges()` strip anything outside the closed predicate set or
pointing at a non-candidate node — the same "never emit an unprovable/unvalidated claim" discipline
tmct's `hallucinationsIn` gate uses, independently arrived at. `app/functions/ingest/memtree-insert.mjs`
writes the survivors onto the new leaf as `leaf.typed_edges`, persisted in a real, versioned,
S3-backed tree — not chat history. `app/lib/rdf.mjs` projects `typed_edges` into RDF against
`ontology.ttl`'s predicates so `app/lib/sparql.mjs` can query them structurally. **This is a real,
working "LLM decision, remembered" pipeline**, running in production today.

**What it's missing, precisely — and this is the actual gap, not a research question.**
`typed-edges.mjs` computes a `confidence` at extraction time (used for a `min_confidence`
threshold) and then **explicitly discards it before persistence** ("persist a schema-light edge (drop
confidence once thresholded)"). No trust score survives on the stored fact. There is no tag
distinguishing "an LLM inferred this relationship" from any other edge on the leaf — the leaf's
own `origin`/`actor_id`/`trust_band` fields (`source-class.mjs`/`trust.mjs`) classify *who spoke*
in the conversation, not *who inferred the relationship between two memories*. Retraction is
blunt and human-only: `postFlagResolve` sets `hidden: true` via an admin API call — there is no
principled, trust-weighted, LLM-decision-specific revision path.

Ironically, the ONE place in marginalia with real "this fact was derived, and by what rule"
tagging (`inferred: true, rule: "isA-transitive"`, `mg:derivedByInference`) is the **non-LLM**
mechanical inference path — the exact rigor tmct's memory/trust system has (§3) exists in
marginalia only for the deterministic side, not the LLM-decision side. tmct has the inverse gap:
robust trust/provenance/retraction machinery with no LLM-decision write path feeding it at all.
**The two systems have complementary holes.**

---

## 3. tmct's trust/provenance machinery, as the candidate template

`src/memory/trust.mjs`'s `SOURCE_PRIOR` (already shipped, cross-cutting this whole session):

```js
{ operator: 1.0, teach: 0.95, provider: 0.9, corpus: 0.7, web: 0.4, entailed: 0.3 }
```

Every fact is written via `appendFact` with a `Source` individual and a `mgx:derivedFrom` /
`mgx:statedBy` link (never a bare string), timestamped, and trust is *computed* — a source-type
prior × corroboration × recency — never hand-set. Retrieval weights by relevance × trust, so a
corroborated high-trust fact outranks a lone low-trust one, and contradiction is surfaced, never
silently resolved. This is the piece marginalia's typed-edges pipeline doesn't have: a fact isn't
just present or absent, it carries a *reason to believe it*, and that reason is queryable and
retractable.

**What a unified "LLM decision, remembered" would need, concretely** (not speculative — this is an
integration spec, every piece named above already exists somewhere in the ecosystem):

1. A new `SOURCE_PRIOR` tier — `llm-decided`, sitting below `provider`/`teach` and above `corpus`
   (an LLM's classification of a relationship is less trustworthy than a human-taught fact or a
   provider-supplied graph edge, but more deliberate than raw corpus data). Where exactly it sits
   is a real design decision, not a formality — it determines whether an LLM-decided fact can ever
   outrank a corpus fact it happens to contradict.
2. **marginalia keeps its confidence, doesn't drop it** — feed `typed-edges.mjs`'s already-computed
   `edge.confidence` into the trust computation instead of discarding it after thresholding. This
   is a smaller change than it sounds: the number already exists in memory at persistence time,
   it's deleted one line later.
3. A provenance tag on the edge itself (`derived_by: "llm"`, model + prompt version, mirroring
   `mg:derivedByInference`'s pattern for the mechanical path) — so an LLM-decided edge is
   distinguishable from a taught one at query time, the same distinction tmct's `via` field already
   makes for every answer.
4. Retraction as a first-class operation, not an admin hide-flag: a low-trust LLM-decided edge
   should be revisable the way tmct's entailed facts already are — retractable by provenance,
   never silently overwritten.

None of this requires new research. It requires marginalia and tmct to agree on a shared
vocabulary for "how much should I believe a fact, and why" — which is exactly what
`PLAN_TMCT_ECOSYSTEM_INTEGRATION.md` Part 3's corpus/lexicon/template extension question already
opens the door to, just not phrased this way yet.

---

## 4. LLM classification/parsing + front-of-house — already the escalation boundary

Nothing new to design here; it's a naming exercise, not a gap. "LLM classification/parsing" is
`PLAN_CAPABILITY_ROUTER.md`'s NL front end — the one piece that doc already calls "the make-or-break"
and explicitly out of tmct's own scope. "Managing front of house and loops" is bedrock-meter's
router (which piece runs: tmct's $0 floor, a cheap model, or a real one) plus whatever orchestrates
the actual conversation turn-taking above that (marginalia's own chat surface today; Claude Code
itself in this session). The architectural claim worth stating plainly: **the operator's five-part
architecture is not one system to build — it's four existing systems that already divide this
labor correctly, and the only real engineering gap is #2's LLM-decision provenance, not a missing
component.**

---

## 5. The genuinely open piece — "all of a typical human's knowledge"

This is where the honest ceiling from tonight's design-horizon research applies directly, not
speculatively. A single, comprehensive "human world" ontology is the Cyc project's exact ambition
(Lenat, 1984 onward) — forty years, ~100M hand-encoded assertions, remembered in the field largely
as a cautionary tale of effort-vs-payoff at that scale (already cited, `PLAN_ADVANCED_GRAMMAR.md`
track (g)). WordNet's own scope problem (`PLAN_ontology-hierarchies.md` track (e)) is the same
lesson at smaller scale: general lexical breadth reintroduces exactly the sense-disambiguation noise
domain-scoped ontologies are built to avoid. **The pragmatic reading of the operator's own
architecture is already compositional, not monolithic**: tmct's software-domain ontology +
marginalia's general-knowledge ontology, each independently scoped and quality-filtered, is a more
defensible shape than one universal graph — and it's the shape that already exists. "All of a
typical human's knowledge" is better read as "every domain that gets its own scoped, filtered
ontology, composed," not "one graph that knows everything" — the latter is the Cyc-shaped failure
mode this ecosystem's own existing architecture already avoids by construction.

---

## 6. Sequencing

| Phase | What ships | Depends on | Repo(s) |
|---|---|---|---|
| 0 | **Name the seam** (this doc) — no code change, just the shared vocabulary for "why should I believe this fact" across repos. | Nothing | tmct (doc only) |
| 1 | **marginalia keeps `edge.confidence`** through persistence instead of discarding it, and tags `typed_edges` with `derived_by: "llm"` + model/prompt version. Smallest possible step, no architecture change, immediately makes LLM-decided facts distinguishable from taught ones. | Nothing new | marginalia |
| 2 | **A principled retraction path** for LLM-decided edges (trust-weighted revision, not an admin hide-flag) — the ATMS-lite direction `PLAN_INFERENCE_TESTING.md`'s design-horizon section already sketches for tmct's own entailed facts is the same shape marginalia would need here. | Phase 1 | marginalia (design informed by tmct's existing pattern) |
| 3 | **Cross-repo trust vocabulary** — if marginalia and tmct are ever queried through the same front door (the Repository Interface, already shipped), a shared `SOURCE_PRIOR`-style scale so "how much to believe this" means the same thing regardless of which ontology answered. | Phases 1-2, `PLAN_TMCT_ECOSYSTEM_INTEGRATION.md`'s Part 3 | tmct, marginalia |
| Later | Broader ontology composition (multiple domain-scoped ontologies queried together) — real, but only worth doing once #3 proves the trust-vocabulary sharing actually works for two ontologies, not assumed for N. | Phase 3 | all |

Nothing here is scheduled; this is the plan-of-record for the question, not a build order.
