# PLAN_COMPLETIONS.md — mechanical text generation via retrieve, group, infer, summarize, prune, voice

*(Drafted 2026-07-10. Status: RESEARCH PLAN, not a build order — explicit operator sign-off required
before any implementation, same discipline as `PLAN_CODE.md` §8. Origin: operator's request to add
a text-generation feature to `PLAN_AGENTS.md`'s architecture — not LLM-style generation, but a
mechanical pipeline: broad search over a prompt, group the results, infer relationships between the
groups, mechanically summarize, drop elements that don't contribute to an inference or the summary,
then apply a grammar/voice-consistency pass. A different, competing mechanism from `PLAN_CODE.md`,
but the same species of thing — tmct producing an artifact rather than only answering a query.)*

**Ground rules, restated because this is the second capability category (after `PLAN_CODE.md`) that
produces something rather than only reading the graph.** tmct is no-LLM, permanently, in the product
path. Every stage of this pipeline must be deterministic, explainable, and closed. The output is
never a language model's free-form completion — it is a **composition of retrieved, grouped, and
ranked source material**, with every sentence traceable back to a source span and every
cross-group relationship traceable to a named, closed inference kind. If a stage cannot justify a
piece of output against real source material, that piece is dropped, not smoothed over.

## 0. Relationship to `PLAN_CODE.md` — a sibling, competing generation category

`PLAN_CODE.md` §0 currently states synthesis is "the first capability category that writes/generates
anything." That claim needs updating: it is the first of **two**. The two are different species of
generation, not variations on one idea:

| | `PLAN_CODE.md` | `PLAN_COMPLETIONS.md` (this doc) |
|---|---|---|
| Target artifact | Executable/structured data — a `GOAL_RULE`, a repaired function, a JS snippet, an HTML/CSS fragment | Natural-language prose — a multi-sentence completion answering a broad prompt |
| Search strategy | Enumerative search over a closed grammar (operators, tags, mutation templates) | Retrieval + clustering + closed-vocabulary inference between clusters |
| Verification | Execution — run the candidate against real engine code or a sandboxed interpreter, value-compare to pinned expectations | Extractive fidelity — every output sentence traces to a source span; every cross-group claim traces to a named inference kind |
| Sandbox needed? | Yes, for Tracks 2-4 (untrusted code execution) | **No** — nothing is ever executed, only selected, ranked, and recomposed |
| Overfitting failure mode | A candidate that passes given examples but fails held-out ones | A completion that reads fluently but asserts something no source span actually supports |
| Literature grounding | Program synthesis, automated program repair (PBE, CEGIS, GenProg, PAR/TBar) | Query-focused multi-document summarization, extractive graph-ranking (LexRank/TextRank family), clustering-cum-ranking (CoRank) |

Both are genuinely new for tmct's ethos — every capability shipped before either of these plans only
**reads**. Both stay inside the no-LLM ground rule by construction: `PLAN_CODE.md` by searching a
closed grammar and verifying by execution; this plan by never inventing text, only selecting,
grouping, and recombining text that already exists somewhere in the corpus/graph/scraped material.

## 1. The pipeline

Six stages. Each is grounded in either machinery tmct already ships or established, non-neural
literature — nothing here requires a novel unpublished technique, unlike some of
`PLAN_AGENTS.md`'s research-horizon items.

### 1.1 Stage 1 — broad search

A prompt drives retrieval across whatever sources are in scope: the local graph (via the Repository
Interface's search services), the committed/seeded/on-demand corpus tiers (the already-shipped
4-tier corpus policy from `ROADMAP.md`'s wiring wave), and — once `PLAN_AGENTS.md` Phase 3 lands —
marginalia's web-scrape ingestion tool as an external source. This stage reuses `retrieveBlocks` and
the existing provider/corpus seams; it does not need new retrieval machinery, only a broader query
(the "broad search" the operator names) rather than the narrow, single-answer lookups tmct's chat
surface does today.

### 1.2 Stage 2 — grouping

Cluster the retrieved spans into topical groups. tmct already has a crude version of this: the
insights-panel tag clustering (marginalia's own capability audit graded the equivalent capability
"Split, leans beyond" — a keyword-frequency version is deterministic and cheap; the quality bar
wanted is closer to a real clustering exercise). This stage formalizes that into a real, still
no-LLM clustering step: graph-ranking-based clustering, the family CoRank (2021) demonstrates —
"clustering cum graph ranking" — rather than raw keyword frequency. Groups are the unit the next
stage reasons over.

### 1.3 Stage 3 — inference between groups (the genuinely new piece)

Apply tmct's existing entailment machinery — `src/syllogise.mjs`'s bounded OWL 2 RL subset, and the
taught-relations Rule storage/backward-chaining `resolveRelationChase` mechanism `PLAN_TAUGHT_RELATIONS.md`
shipped (see `PLAN_AGENTS.md` §1.2) — not just to graph facts, but to **relationships between
retrieved text groups**: does group A support, contradict, elaborate, or exemplify group B. This is
a closed, small inference-relation vocabulary, deliberately mirroring marginalia's own `TYPED_EDGES`
closed set (`mg:causes`, `mg:contradicts`, `mg:precedes`, `mg:exemplifies` — `PLAN_AGENTS.md` §3),
not an open-ended reasoning step. A relationship between two groups is only asserted when a concrete,
named test licenses it (shared entities plus a polarity/temporal marker for contradiction, a
subset/superset relation for elaboration, and so on) — never inferred by prose similarity alone.

### 1.4 Stage 4 — mechanical summarization

Extractive sentence selection over the grouped-and-inferred material, not abstractive rewriting.
This is a real, established, non-neural field: query-focused multi-document summarization
(feature-fusion sentence selection, graph-ranking approaches in the LexRank/TextRank family,
clustering-cum-ranking as in CoRank). A PageRank+IDF-style block ranker is exactly the tool this
stage needs — worth noting this was named as a lower-priority "sibling publish candidate" in the now
-archived `PLAN_OSS_ACE_PARSER.md` and pruned from `PLAN_AGENTS.md` §8 as not independently
justified; in this pipeline it has a real, load-bearing job, so it is un-pruned here, scoped to this
plan specifically rather than as a standalone package.

### 1.5 Stage 5 — drop non-contributing elements

Any retrieved span that ends up in no surviving group, feeds no asserted inference, and is not
selected by Stage 4's ranking gets cut, explicitly, with the drop recorded (not silently discarded)
so the pipeline's own working set is auditable end to end. This is the complement of Stage 4's
selection, kept as its own explicit stage rather than folded in, specifically so what got dropped —
and why — is inspectable.

### 1.6 Stage 6 — grammar/voice consistency pass

Reuse `src/finish.mjs`, tmct's already-shipped response-finishing/grammar pass (`ROADMAP.md` Phase
7), extending its input surface from single chat answers to the longer, multi-sentence completions
this pipeline produces. No new mechanism needed here — this is the one stage that is pure reuse,
not new build.

## 2. Verification and auditability

Every output sentence must be traceable to a source span (which retrieved block, from which
source/tier). Every cross-group claim (Stage 3) must cite the two-or-more groups and the inference
kind that licensed it. This mirrors `PLAN_CODE.md`'s "as auditable as hand-written" bar and tmct's
existing provenance/trust system (`SOURCE_PRIOR`, `PLAN_AGENTS.md` §7) — an extension of the same
discipline to a longer-form artifact rather than a single answer.

## 3. Honest ceiling — reconciling with the marginalia capability audit

Marginalia's own capability-gap audit graded "Summarization (daily/session summaries)" as **Beyond
horizon**: "real paraphrase-and-compress generation — tmct composes from templates, never generates
novel prose." This plan does not contradict that finding. It stays strictly extractive and
compositional — selecting, grouping, ranking, and recombining existing text, never paraphrasing or
inventing new phrasing beyond Stage 6's mechanical grammar normalization. That is a different,
achievable target from abstractive summarization, not a re-attempt at the same beyond-horizon
capability under a new name. Where this pipeline cannot produce a fluent-reading completion without
paraphrasing beyond what Stage 6's grammar pass can mechanically do, it should decline or
visibly flag the seam, the same honesty discipline as every other tmct capability.

## 4. Staging (measure-before-building)

| Stage | What ships | New machinery? | Exit criterion |
|---|---|---|---|
| 0 | Stage 1+2 only — broad search + grouping over a fixed corpus, no inference or summarization yet | Grouping formalized from the existing tag-clustering | Groups are stable and inspectable for a hand-picked prompt set |
| 1 | Stage 3 — cross-group inference wired to the existing entailment/rule-chase machinery, closed inference-relation vocabulary | Reuses `syllogise.mjs`/`resolveRelationChase`, no new engine | Every asserted inference cites a concrete licensing test, zero fabricated relationships on a hand-labeled set |
| 2 | Stage 4 — extractive ranking (graph-ranking/PageRank+IDF-style) | New — the un-pruned block ranker, scoped to this plan | Selected sentences cover the labeled key points of a hand-picked source set at a target recall |
| 3 | Stage 5+6 — pruning + grammar/voice pass wired end to end | Stage 6 reuses `finish.mjs` directly | A full end-to-end completion reads as one consistent voice and every sentence traces to a source span |

Each stage is measured before the next is attempted, the same discipline `PLAN_CODE.md` §6 and
`PLAN_ADVANCED_GRAMMAR.md` §2 both apply.

## 5. Risks and honesty

- **Extractive fidelity is a real limit, not a temporary one.** This pipeline recombines and
  compresses existing text; it does not generate genuinely novel phrasing beyond Stage 6's mechanical
  grammar pass. Any apparent fluency beyond that is source material, not synthesis — this must stay
  legible to whoever reads the output.
- **Stage 3's inference vocabulary must stay closed.** The temptation is to let "does A relate to B"
  become an open-ended judgment call; the closed, named-test discipline (§1.3) is load-bearing for
  keeping this a deterministic, auditable step rather than a disguised LLM-shaped guess.
- **Grouping quality bounds everything downstream.** A bad Stage-2 clustering produces incoherent
  groups that Stage 3 can't meaningfully relate and Stage 4 can't meaningfully rank — this is the
  stage most likely to need real iteration, and should be measured on its own (§4, Stage 0) before
  the rest of the pipeline is built on top of it.
- **This is a new capability category, like `PLAN_CODE.md`.** Same sign-off posture: explicit
  operator sign-off before implementation begins, not bundled silently into `PLAN_AGENTS.md`'s
  phases as though it were already approved build work.

## 6. Where this fits in `PLAN_AGENTS.md`

Not a phase of its own in `PLAN_AGENTS.md` — a sibling capability plan, cross-referenced from:
Phase 3 (marginalia's web-scrape pipeline is a natural Stage-1 input source once it ships), and the
research horizon (Stage 3's cross-group inference is close kin to the DRT-lite typed discourse
record idea in R1 — both track relationships between spans of text, one across chat turns, one
across retrieved groups; worth designing together if both are ever scoped).

### Critical files for implementation

- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/syllogise.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/memory/core.mjs` (Rule storage, `resolveRelationChase`)
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/finish.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/repository-interface.mjs` (search services)
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/corpus/templates.mjs`
- `/Users/antony/projects/polycode-projects/the-mechanical-code-talker/archive/PLAN_OSS_ACE_PARSER.md` (the un-pruned PageRank+IDF block-ranker note)
