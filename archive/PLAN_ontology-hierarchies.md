# PLAN_ontology-hierarchies.md — the OWL hierarchy/lexicon layer under inference and grammar

> **STATUS (2026-07-08): stages 1–3 all ✅ shipped.** Stage 3 (numeric data-property vocabulary
> — 7 nouns + 42 disjointness rows) turned out to already be done pre-session (commit
> `308fa67`); confirmed, no further work needed.

**Goal:** answer four concrete questions — how far/how useful is a synonym/hypernym hierarchy
layer, does it aid inference, can cardinality ("at least N") be wired in, can arithmetic +
forward-chaining + conditionals be added — by auditing what's *already built* against
`src/grammar/ace.mjs`, `src/syllogise.mjs`, `src/corpus/`, and the two sibling plans, then stage
the remaining work as the shared premise/vocabulary layer both siblings depend on.

*(Drafted 2026-07-07, third sibling to [[PLAN_INFERENCE_TESTING.md]] (the consumer of hierarchies
as inference premises) and [[PLAN_ADVANCED_GRAMMAR.md]] (the consumer of hierarchies as vocabulary
reach). Status: RESEARCH PLAN. This doc does not duplicate either sibling's tables — it cites and
extends them.)*

**Ground rules, restated because this topic is the one most tempted to violate them.** No-LLM,
permanently. Every mapping — synonym, hypernym, cardinality, arithmetic rule — must be
**declared, closed, deterministic, and explainable**: the same discipline that makes
`grammar/lexicon-core.json` a flat JSON whitelist (`src/grammar/lexicon.mjs:1-19`, "tmct never
guesses a word's category") and `src/interpret/normalize.mjs`'s `PHRASING_FRAMES`/`NEGATION_SET`
closed rewrite tables (first-match-wins, unmatched text passes through byte-unchanged,
`normalize.mjs:110-128,173-179`). A hierarchy layer is **more lexicon**, not a thesaurus dump: it
is reviewed, versioned, diffable data, gated by the same relation-mapping-table pattern
`src/corpus/conceptnet-map.toml` already enforces (§1). This is distinct from — and must not be
confused with — the DROPPED tone-of-voice synonym substitution (ROADMAP.md:755, "per-voice
synonym/phrase substitution over prose spans"): that was about rewriting *output* register over
protected answer spans; this plan is about mapping *input* terms onto concepts before parse/query,
which never touches a protected span.

---

## 1. Ground truth: the hierarchy/synonym layer already exists — audit before designing

The idea doc asks "how far can we go" as if starting from zero. It isn't zero. Three committed
mechanisms already do exactly this job, in varying states of wired-vs-inert:

| Mechanism | File:line | Size | Shape | Wired into answering? | Wired into `syllogise.mjs`? |
|---|---|---|---|---|---|
| ConceptNet slice `/r/IsA`, `/r/DefinedAs` → `rdfs:subClassOf` | `conceptnet-map.toml:25-34`, `conceptnet.mjs:113-132` | 4,173 + 2 rows of 44,947 | directed hypernym facts | YES — `seedMemory` → `.tmct/memory` (`chat.mjs:2251-2255`, `init.mjs:188-190`) | **YES, proven** — `test/syllogise.test.mjs:116-156` KILL CRITERION seeds the real default corpus and shows `deriveSubClassClosure` closes a real miss over it |
| ConceptNet `/r/DistinctFrom` → `owl:disjointWith` | `conceptnet-map.toml` (~L179-181) | 32 rows | directed disjointness | YES — same seed path | not yet — no rule consumes `owl:disjointWith` today (confirmed §2 below and PLAN_INFERENCE_TESTING §1 INF-B1 row) |
| ConceptNet `/r/Synonym`, `/r/SimilarTo` | `conceptnet-map.toml` (~L194-196, ~L224-226) | 1,126 + 102 rows | undirected equivalence | **NO — `ace = "none"`, deliberately unmapped**, `toFacts` skips them (`conceptnet.mjs:120`) | n/a |
| `data/phrasebook/software-phrases.txt` `~` synonym families | file lines, parsed by `corpus/templates.mjs:171-188` (`loadPhrasebook`) | 31 hand-curated families (5-8 words each) | undirected clusters | **NO — parsed and validated only by `test/corpus-templates.test.mjs`; `ask.mjs`/`chat.mjs` never call `loadPhrasebook`** | n/a |
| `CASCADE_SYNONYMS` | `ask-vocab.mjs:700-702` | 5 keys (`tally`/`sum`/`total`→`count`) | flat rewrite map | YES — `ask.mjs:2257` | n/a (query-side aggregate trigger only) |
| SEON curated concepts/definitions/relations | `corpus/seon/concepts.jsonl` (238 lines), `definitions.jsonl` (288), `relations.jsonl` (8) | small, hand-authored, software-sense-disambiguated | subClassOf/property/definition facts | YES — seeded uncapped, first, `corpus:seon` provenance (`chat.mjs:2231-2253`) | YES, same closure as ConceptNet rows (same predicate) |
| ACE-OWL teaching lexicon | `grammar/lexicon-core.json` | ~140 nouns, ~90 verbs, ~31 adjectives, 15 proper names | **flat category declarations, NO synonym/hypernym field at all** | gates what can be **taught** via `parseAce` | facts it emits feed the same closure |

**The load-bearing distinction the idea doc conflates:** there are **two separate vocabulary
gates**, not one. (a) The **ACE-teaching lexicon** (`lexicon-core.json`) gates what sentences
`parseAce` can turn into new triples — closed, ~260 words total, no synonym expansion of any
kind (`lookupNoun`/`lookupVerb`/`lookupAdjective`, `lexicon.mjs:143-167`, exact-or-morphological-fold
lookup only). (b) The **memory fact/corpus term space** (45k+ rows, `normFactTerm`-keyed,
`memory/core.mjs:427-433`) gates what `factReadBack`/the concept force can **read back** at query
time — much larger, but matched only by `factTermVariants` (`chat.mjs:1128-1136`), which is a
**naive plural fold** ("caches"→"cache"), never a semantic synonym expansion. Growing hierarchies
widens (b) for free (more facts, more closure) but does **nothing** for (a) — teaching "every cache
is a store" still requires `store` to be a declared lexicon noun regardless of how many corpus
facts exist. This resolves PLAN_INFERENCE_TESTING §5's own "store not in lexicon-core.json"
finding: I confirmed it's not just a lexicon gap — the committed corpus has no `cache`⊑`store`
fact either (`corpus/seon/concepts.jsonl` defines `cache` but never relates it to `store`); both
layers need the fact authored, independently.

---

## 2. The four questions, answered against code

### 2.1 How far can this go, and how useful is it? (measurable)

**Far, but along one axis only: query-time term reach, not teach-time grammar reach (§1).**
Concretely, three inert resources are sitting ready right now: 1,126 `/r/Synonym` + 102
`/r/SimilarTo` corpus rows currently gated `ace = "none"`, and 31 phrasebook synonym families
already parsed by `loadPhrasebook` but never consumed. Activating either requires **no new corpus
work** — only a new query-time consumer (a `synonymsOf(term)` index feeding `factTermVariants`-
style expansion, §3 track a/b) and a precision pass, since `/r/Synonym` is generic-English (word
senses noisier than the domain-filtered `IsA` rows — ROADMAP.md:629-631 already names this
"word-sense noise cut" discipline for the corpus).

**Measurable, reusing the idea doc's own suggestion and the substrate that already exists for it:**
`chat.mjs` already records a per-turn `miss` flag and `via` provenance (`recordMiss`,
`chat.mjs:1821-1957`) through `telemetry.mjs`, and `parseAce`'s `residue` field
(`ace.mjs:112-115`) separately names undeclared teach-time tokens. Two independent metrics, not
one:
- **query-miss rate** (`record.miss === true` turns / total, from telemetry) — before/after
  activating `/r/Synonym`/`SimilarTo` term expansion. This is a real A/B: replay the chatbench
  vocabulary-band cells (`chatbench/graded-pool.jsonl`) with the synonym index off vs on.
- **teach-residue rate** (fraction of a fixed ACE-fragment corpus of test sentences returning
  non-empty `residue`) — only moves if `lexicon-core.json` itself is grown (a separate,
  independently-staged lever, §3 track c/d).

**The honest ceiling** is the one both siblings already declare and this plan does not
re-litigate: word-sense disambiguation. A synonym/hypernym layer widens *reachability*, not
*sense-correctness* — `/r/Synonym` rows are English-generic, so "cache"↔"stash" is a legitimate
software synonym but ConceptNet's raw slice also carries senses irrelevant to code (the
`RelatedTo` relation, 29,016 of 44,947 rows, is correctly gated `ace = "none"` for exactly this
reason). This is the frame-problem/Winograd wall PLAN_ADVANCED_GRAMMAR §2g and ROADMAP.md:590
already name as permanent — cross-referenced, not re-argued.

### 2.2 Does it aid the inference mechanism?

**Yes, directly and already proven — not a future synergy, a shipped one.** `syllogise.mjs`'s
`deriveSubClassClosure` reads *every* stored `rdfs:subClassOf` fact regardless of source
(`syllogise.mjs:125-127`, `readFactRows(memory).filter(isSubClassOf)`), so the 4,173 corpus-seeded
`IsA` edges are premises for the ONE-rule transitivity chainer exactly like taught ACE facts.
`test/syllogise.test.mjs:116-156` (the "KILL CRITERION" test) seeds the real default bootstrap
corpus and asserts the pass derives a genuine, previously-missing closure fact from it — this is
not speculative, it is a passing test today. Trust-wise, corpus rows enter at the `corpus` prior
(0.7, `memory/trust.mjs:35-42`) — below `teach`/`operator` but above the bare `entailed` floor
(0.3) — so once PLAN_INFERENCE_TESTING's stage 2 trust hook engages (`min(premiseTrusts) ×
ruleConfidence`, `trust.mjs:100-106`), a corpus-grounded chain will score meaningfully but never
outrank a taught fact. INF-A2's subsumption premises and INF-B1's disjointness axioms
(`owl:disjointWith`, seeded today from 32 `/r/DistinctFrom` rows) are **already sitting in
memory** waiting only for PLAN_INFERENCE_TESTING stage 3's `cax-dw` rule to consume them — this
plan's job for B1 is to *grow the disjointness row count and the SEON hand-curated relations*, not
to build the rule (that's the other plan's stage 3, PLAN_INFERENCE_TESTING.md §4).

### 2.3 Cardinality ("at least N")

Cross-reference [[PLAN_INFERENCE_TESTING.md]] §1 (INF-C1 row) and §5 ("Found capability": `every
cache has at most 0 queues` already parses to `owl:maxCardinality 0` today) — not duplicated here.
**Confirmed independently**: `ace.mjs:201-226` (`parseCardinality`) implements all three
quantifier kinds (`owl:minCardinality`/`maxCardinality`/`cardinality`) and is tested
(`test/grammar-ace.test.mjs:67-84`). This plan's scope differs from the inference plan's: **the
inference engine consumes cardinality monotonicity rules (tier-5, not built); the ontology layer's
job is authoring more cardinality PREMISES** — i.e., growing `corpus/seon/relations.jsonl` (today
8 rows) and `concepts.jsonl` with real "every suite has exactly N tests"-shaped domain facts, and
noting the one already-flagged refinement: `conceptnet-map.toml`'s `/r/HasA` row ("a cache has a
queue") is currently a plain `owl:ObjectProperty` edge, not a cardinality restriction — its own
comment names this ("ACE pattern 5 cardinality is a later refinement"). Concretely NOT in scope
for this plan: query-time "at least N" *threshold filtering* over live query results — I confirmed
`ask-vocab.mjs`'s `AGGREGATE_TRIGGERS` (526-541) only recognizes unbounded "how many"/count
questions, no "modules with at least 3 tests" comparator syntax exists anywhere in `ask.mjs`'s
grammar. That is a genuinely new grammar surface, not an ontology-authoring task — flag it as an
open gap for PLAN_ADVANCED_GRAMMAR to consider (a `QUALIFIERS`-shaped numeric-comparator table),
not claimed here.

### 2.4 Arithmetic, chaining, conditionals — verified against what `syllogise.mjs` does today

The idea doc's preliminary sketch ("bounded numeric-rule extension, Datalog-with-builtins style,
single stratum, no arithmetic recursion") is **architecturally sound, but only as a *description
of tier-5*, not as work this plan can absorb.** Verified against the actual engine:
`deriveSubClassClosure` (`syllogise.mjs:57-103`) is a pure fixpoint over ONE binary predicate
(`rdfs:subClassOf`) with string-typed subject/object; there is **no numeric fact type in the
closure kernel at all**. The only numeric-carrying triple shape anywhere in the codebase is
`ace.mjs`'s cardinality restriction's `{ ..., n }` field (`ace.mjs:222,225`) — a cardinality
COUNT, not a computed value, and it never enters `syllogise.mjs`'s edge list (which only reads
`subClassOf` rows). Concretely:

- **Multiply/divide as derived attributes** (`hotspot = churn × impact ≥ k`) is real Datalog-with-
  builtins territory, requiring: a new fact shape carrying numeric attribute values, a rule body
  that reads two numeric attributes and a comparison, and a NEW forward-chaining kernel (not
  `deriveSubClassClosure`, which is single-predicate and non-numeric by construction). This is
  **squarely tier-5 "the Syllogist"** (PLAN_INFERENCE_TESTING §4 stage 4, OWL 2 RL forward-chaining
  proper) — this plan's honest scope is to *author the numeric ontology vocabulary* (declaring
  `churn`, `impact` as data-property nouns in `lexicon-core.json` with a `property: "data"`
  typing, exactly as `size`/`version` already are, `lexicon-core.json:163-169`) so the facts exist
  to chain over once tier-5 lands — **not to build the arithmetic chainer itself.**
- **Termination**: the idea doc's own restriction (single stratum, no arithmetic recursion) is the
  right guard, and it composes with the existing budget/depth/screen discipline
  (`syllogise.mjs:10-25`) — a numeric rule that only ever reads stated attributes (never a
  previously-derived numeric fact) cannot recurse, so it terminates in one pass by construction,
  same shape as `deriveSubClassClosure`'s tautology/dedup screens. This is a real, sound design
  constraint to hand to tier-5, not a claim this plan builds it.
- **Conditionals as Horn-rule bodies** ("if untested and impact≥3 then hotspot") is exactly the
  `via:"entailed"` proof-chain shape ROADMAP.md L788 already names for tier-5 — nothing here
  contradicts it, but it depends on the same not-yet-built numeric kernel. **Verdict: sound
  direction, correctly scoped to tier-5, and this plan's only actionable piece is vocabulary
  (declaring the numeric-property nouns and the comparison-operator words as lexicon/corpus
  data) — recorded so it isn't re-litigated as "can we build it here."**

---

## 3. Authoring hierarchies: how, weighed against precedent

| # | track | mechanism | feasibility (no-LLM/deterministic) | precedent in repo | effort | risk |
|---|---|---|---|---|---|---|
| a | Activate `/r/Synonym`/`/r/SimilarTo` for query-time term expansion | new `synonymsOf(term)` index built from the already-filtered slice rows, feeding a `factTermVariants`-style expansion (not `parseAce`) | HIGH | `conceptnet-map.toml`'s reviewed relation-gate; `factTermVariants` (`chat.mjs:1128-1136`) is the exact seam to extend | S | false-positive collisions on generic-English senses — needs the same precision spot-check ConceptNet's own quality filter already applies |
| b | Wire the unconsumed `loadPhrasebook().synonyms` (31 hand-curated families) into `ask.mjs`'s match layer | consume the existing loader's second return value | HIGH | already parsed + tested (`corpus/templates.mjs:171-188`), just never called outside tests | S | none beyond normal review — this is a pure "found capability" wiring gap, PLAN_INFERENCE_TESTING §5's own phrase |
| c | Hand-curate an upper-ontology spine in `corpus/seon/relations.jsonl`/`concepts.jsonl` (artifact/agent/event/quality/quantity, part-whole) | author new rows in the existing slice-shaped JSONL, same `toFacts`/`seedMemory` path, `corpus:seon` provenance | HIGH | SEON already exists for exactly this reason (ROADMAP.md:629-631, "software-sense definition... language-neutral") | M | authoring cost scales with breadth; must stay software-domain, not general-knowledge sprawl |
| d | Grow `owl:disjointWith` premises (today 32 `/r/DistinctFrom` rows) | more SEON/ConceptNet disjointness rows, feeding INF-B1's not-yet-built `cax-dw` rule | HIGH | direct precedent, same seed path | S | none — pure data growth, gated by the same drift-checked map |
| e | Import WordNet wholesale (the idea doc's implicit "how far could we go" ceiling) | full synset/hypernym graph import | **LOW for tier-1** | violates the committed corpus tiering policy (ROADMAP.md:313-319, tier-1 budget ~2 MB, "what the product needs to be useful offline") and the ConceptNet slice's own reason for being *filtered* (quality-filter.mjs, word-sense noise cut) — WordNet is broader but NOT domain-filtered | L | **negative finding, recorded so it isn't re-asked**: WordNet's general-English senses would reintroduce exactly the noise `RelatedTo`'s 29,016-row exclusion was built to avoid, and it duplicates ConceptNet's own WordNet-derived core relations. At most a **tier-2 fetched corpus** (ROADMAP's own "extended ConceptNet neighbourhoods" lever, L316) behind explicit consent — never committed |
| f | Add a numeric-comparator query grammar ("modules with at least 3 tests") | new `QUALIFIERS`-shaped table in `ask-vocab.mjs` | MED | none today (§2.3) — a genuinely new surface | M | out of THIS plan's scope; flagged for PLAN_ADVANCED_GRAMMAR, not built here |

**Why WordNet specifically is wrong tier, grounded rather than merely asserted.** Miller's founding
paper (Miller, G.A., "WordNet: A Lexical Database for English," *Communications of the ACM*
38(11):39-41, 1995 — verified) frames WordNet explicitly as a general-English psycholinguistic
resource: synsets built around cognitive-synonymy and word-association judgements over the whole
language, with no domain sense-disambiguation layer at all. This is not just this plan's own
inference — the software-engineering NLP literature has an independent, measured verdict on using
raw WordNet for code/software vocabulary specifically: Chen, Chen, Zhang & Xing, "SEthesaurus:
WordNet in Software Engineering" (*IEEE Transactions on Software Engineering*, 2019 — verified),
built a 52,645-term software-specific thesaurus (14,006 synonym groups, 38,104 morphological terms)
*because* raw WordNet under-covers and mis-senses software terminology drawn from informal SE text
(Stack Overflow, CodeProject) — abbreviations, domain synonyms, and morphological variants general
WordNet does not resolve, and general word senses that collide with the software sense (their own
worked example: a term like `cache` is dominated in general WordNet by non-computing senses). That
is the *identical* word-sense-noise argument ConceptNet's own `RelatedTo` exclusion already makes
in this repo (§2.1, 29,016 of 44,947 rows gated out) — but now corroborated by an independent
domain-focused project reaching the same conclusion from a different direction. The actionable
consequence: general lexical databases need a domain-specific re-curation pass (SEthesaurus's own
filter-against-a-domain-corpus-then-cluster pipeline) before they are safe inference premises;
building that pass is a materially bigger, separately-scoped project than this plan's track (e),
not a reason to import WordNet raw and hope the noise averages out.

**What would actually need to be true for track (e)'s tier-2 door (§4 stage 4) to be worth
opening** — named as a real, falsifiable gate, not a standing prohibition argued from taste:
(1) tracks a–d's cheaper resources (the already-filtered ConceptNet `/r/Synonym`/`/r/IsA` slice,
SEON, the phrasebook) must be wired and *measured* insufficient — the query-miss-rate plateau
(§2.1's metric) has to be shown to persist after stages 1–3 land, not assumed in advance; (2) the
specific residual misses must be lexical-*coverage* gaps (a term WordNet actually carries that the
filtered ConceptNet slice does not), not sense-*disambiguation* gaps — WordNet's raw synsets make
those WORSE, per the SEthesaurus finding above, never better; (3) a domain re-curation step
equivalent to SEthesaurus's own contrast-against-a-software-corpus-then-cluster pipeline would have
to exist or be built — importing WordNet's synset graph without that filter reintroduces exactly the
noise this finding rejects, at ~10-100x ConceptNet's already-filtered row count. Absent all three,
the door stays shut on the evidence, not on precedent alone.

**Recommendation: extend the existing gated pipeline (tracks a–d), do not import WordNet.** The
repo's own precedent is unambiguous — every existing hierarchy resource (ConceptNet slice, SEON,
phrasebook) is small, licence-clean, reviewed through a single relation-mapping table with a
drift guard (`conceptnet-map.toml` + `test/corpus-conceptnet.test.mjs`'s "unmapped relation is an
error" discipline), and quality-filtered before commit. A hierarchy layer earns its size the same
way the ACE lexicon does: one declared row at a time, never a bulk unreviewed import. Tracks a/b/d
are near-zero-cost wiring of resources that are *already sitting in the tree, unused* — start
there before authoring anything new (track c).

---

## 4. Build staging

| Stage | What | Effort | Exit |
|---|---|---|---|
| 0 | Baseline the two miss metrics (§2.1: query-miss rate from telemetry, teach-residue rate from an ACE-fragment corpus) BEFORE any change | S | recorded baseline, versioned like INFBENCH's `_00N` artifacts |
| 1 | Wire tracks (a) + (b): `synonymsOf` term-expansion consuming `/r/Synonym`/`SimilarTo` + the phrasebook's already-parsed `synonyms` — precision-reviewed subset first, not the full 1,228 rows blind | S–M | query-miss rate drops on the vocabulary-band chatbench cells, zero regression on `via` provenance correctness (a synonym hit must still cite its source) |
| 2 | Grow SEON hand-curated relations (track c) for the upper-ontology spine + more `disjointWith` rows (track d) | M | INF-B1's premise set is non-trivial once PLAN_INFERENCE_TESTING stage 3 lands (§2.2); measured by disjointness-row count and a spot-audit of precision |
| 3 | Declare numeric data-property vocabulary for the arithmetic bridge (§2.4) — lexicon + SEON nouns only, no engine work | S | vocabulary exists for tier-5 stage 4 to consume; explicitly NOT gated on this plan's own exit |
| 4 | Re-measure both miss metrics; decide whether track (e)'s tier-2 fetched-corpus door is worth opening | S | a written before/after, honest if the gain is thin (kill-criterion discipline, same as both siblings) |

---

## 5. Risks and honesty

- **The frame problem / word-sense disambiguation ceiling is permanent and already declared** —
  ROADMAP.md:590 and PLAN_ADVANCED_GRAMMAR §2g. Nothing in this plan claims to cross it; synonym
  expansion widens *reach*, never *correctness of sense*, and a mis-expansion is the same
  "confident-wrong" failure mode PLAN_ADVANCED_GRAMMAR §5 already names as the cardinal sin —
  any term-expansion hit must render its source visibly (which corpus row licensed the match),
  the same discipline `factReadBack` already applies to every fact citation.
- **Two vocabulary gates, don't conflate them (§1).** Hierarchy growth in the corpus does not
  widen what `parseAce` can teach; if the goal is "teach more sentence shapes," that's a
  `lexicon-core.json` change, a separate, smaller, more carefully reviewed edit (every noun there
  is teach-time load-bearing, `lexicon.mjs:1-19`).
- **Arithmetic/chaining is scoped honestly out of this plan's build** (§2.4) — the vocabulary is
  this plan's job, the numeric forward-chaining kernel is tier-5's, exactly as
  PLAN_INFERENCE_TESTING stages it. Claiming otherwise would be the same over-claim
  PLAN_INFERENCE_TESTING §5 catches ROADMAP's own worked examples making.
- **WordNet import is a negative finding, recorded so it stops being re-asked** (§3 track e) —
  wrong tier, wrong noise profile, duplicates ConceptNet's own WordNet-derived core.
- **Retraction gap inherited, not introduced.** `syllogise.mjs` promises retractability by
  provenance but has no incremental closure maintenance (PLAN_INFERENCE_TESTING §5) — growing the
  corpus premise set grows this exposure proportionally; no new mitigation invented here, just
  named as compounding risk to track.

---

## 6. Sequencing and dependencies

1. **This plan's stage 1 (synonym wiring) has no dependency on either sibling** — it's pure query-
   side reach and can ship independently, measured against chatbench's existing vocabulary-band
   cells.
2. **This plan's stage 2 (SEON/disjointness growth) is a hard prerequisite for
   [[PLAN_INFERENCE_TESTING.md]] stage 3** (`cax-dw`, INF-B1 gate) — that plan's rule has nothing
   to prove without premises; sequence stage 2 here to *land before or alongside* that plan's
   stage 3, not after (an empty disjointness set makes B1 authoring impossible to test honestly).
3. **This plan's stage 3 (numeric vocabulary) is a soft prerequisite for
   [[PLAN_INFERENCE_TESTING.md]] stage 4** (tier-5 proper) — vocabulary can be authored any time
   before tier-5's kernel exists; no blocking order required, but doing it here means tier-5
   starts with real domain nouns instead of designing them speculatively.
4. **Shared surface with [[PLAN_ADVANCED_GRAMMAR.md]] §4's existing precedent**: that plan already
   names "one pool-growth pass, two owners" for C1 quantifier/entailment cells shared with
   PLAN_INFERENCE_TESTING. This plan adds a THIRD owner to that same coordination point — lexicon/
   corpus vocabulary growth (tracks a-d here) must be cell-tagged consistently so a new
   noun/synonym isn't authored three times under three different plans' exit criteria. Coordinate
   naming the same way: one PR touches `lexicon-core.json`/`corpus/seon/*`, cited from whichever
   plan's stage motivated it.
5. Order inside this plan: 0 → 1 → 2 → 3 → 4, matching the "measure before building" discipline
   both siblings already use (PLAN_INFERENCE_TESTING §4 header, PLAN_ADVANCED_GRAMMAR §3 title).
6. **Cross-plan phasing (2026-07-07 sweep, see `ROADMAP.md`'s near-term section for the live
   picture):** this plan's stage 1 (tracks a+b) and stage 2's disjointWith growth (track d) are
   Phase-1 quick wins, executed alongside [[archive/PLAN_PREDICATE_QUERIES.md]]'s core feature,
   [[PLAN_INFERENCE_TESTING.md]]'s stage-0 harness, and [[PLAN_ADVANCED_GRAMMAR.md]]'s track (a)/
   (f). This plan's stage 3 (numeric vocabulary) is Phase 2. Stage 4 and track (e)'s WordNet
   door stay Phase 3 (unstarted, re-confirm value first).

---

## 7. A separate, much bigger target: a shared ~2M-word cross-domain ontology (2026-07-08, walked into rather than scoped away)

**This section is additive, not a revision.** Track (e) above (§3) is a settled, narrow finding:
importing raw WordNet into TMCT's OWN small tier-1 corpus is wrong tier — it duplicates
ConceptNet's already-filtered WordNet-derived core and reintroduces the exact word-sense noise
the `RelatedTo` exclusion was built to avoid. That finding stands, unweakened. What follows is a
different, much bigger, explicitly speculative idea the operator asked to be walked into rather
than waved off: a hypothetical **connected ontology at ~2,000,000 words** — a ~1M-word
general-English base (the "every word including technical vocabulary" scope estimated at roughly
this size by Harvard/Google's 2010 corpus-linguistics count, distinct from WordNet 3.1's own
155,327-word / 175,979-synset / 207,016-sense-pair inventory) merged with a ~1M-word
technical/scientific/engineering/programming-language/slang vocabulary drawn from CS, physics,
biology, and informal registers. A rough JSON-triple size estimate for a resource at that scale
put it at 1.6–3.2 GB — three orders of magnitude past tier-1's ~2 MB budget and past tier-2's
"extended neighbourhood" framing too. Named here as a real research target with citations, in the
same register as ROADMAP.md's "After the horizon" list (`PLAN_CAPABILITY_ROUTER.md`'s open-world
boundary, `PLAN_ADVANCED_GRAMMAR.md` tracks c/g, this doc's own INF knowledge-representation
cross-reference) — not a stop sign, not a build plan.

### 7.1 The real problem, named precisely

Merging two 1M-word vocabularies is not simply additive because a huge fraction of the technical
vocabulary is **lexically identical to, but semantically disjoint from, common general-English
words** — the operator's own worked list is exactly right: `class`, `object`, `thread`, `cache`,
`wave`, `pipe`, `stream`, `kernel`, `driver`, `packet`, `cell`, `field`, `type`, `state` each carry
structurally different senses across general English, CS, physics, biology, and slang registers
(a `thread` is a strand of fiber, a discussion sub-topic, or a unit of CPU execution; a `wave` is
water motion, a hand gesture, or a physics oscillation; a `cell` is a prison room, a biological
unit, a spreadsheet coordinate, or a battery). A flat merged sense inventory dilutes or collides
these; the two structural options the operator already named are the two live approaches in the
literature: **(a)** per-domain sense partitioning with explicit cross-domain disambiguation edges,
or **(b)** some other mechanism — context-driven disambiguation at lookup/ingest time — that keeps
senses from colliding without a full partition. This is precisely **word-sense disambiguation
(WSD)** at construction time, plus its adjacent sub-field **domain adaptation for lexical resource
construction / sense-inventory design** — both real, decades-old, extensively published areas, not
an undiscovered problem.

### 7.2 Foundations: knowledge-based (symbolic) WSD — the family compatible with no-LLM

The one WSD family that fits tmct's permanent no-LLM/deterministic/explainable ground rule is the
**knowledge-based** family, founded by Lesk, M., "Automatic sense disambiguation using machine
readable dictionaries: how to tell a pine cone from an ice cream cone" (*Proceedings of the 5th
Annual International Conference on Systems Documentation*, SIGDOC '86, pp. 24–26 — verified,
ACM DL 10.1145/318723.318728): disambiguate a word by counting dictionary-gloss word overlap
between candidate senses and the glosses of neighbouring words — purely symbolic, no training
corpus, no statistics beyond a word count. Its most-cited WordNet-native descendant, Banerjee, S.
& Pedersen, T., "An Adapted Lesk Algorithm for Word Sense Disambiguation Using WordNet" (*CICLing
2002*, Springer LNCS 2276 — verified), extends the gloss set using WordNet's own relation graph
(hypernym/hyponym/holonym/meronym/attribute) and reports a **concrete, real number worth citing
rather than estimating**: 32% accuracy on the Senseval-2 English lexical-sample task, against
16%/23% for plain-Lesk baseline variants — a real improvement, but a low absolute ceiling.

**The honest comparative picture, not inflated.** Raganato, A., Camacho-Collados, J. & Navigli, R.,
"Word Sense Disambiguation: A Unified Evaluation Framework and Empirical Comparison" (*EACL 2017*,
ACL Anthology E17-1010 — verified), the standard modern benchmark harness across five
Senseval/SemEval all-words datasets, found **supervised systems (IMS, IMS+embeddings) and neural
approaches (Context2Vec) clearly outperform knowledge-based methods** including Lesk-family and
graph-based knowledge-based systems; even the trivial Most-Frequent-Sense / WordNet-first-sense
baselines score 55.2–67.8% across the five datasets — at or above what Lesk-family methods
typically achieve. **This is the field's real, settled verdict, and it should not be softened**:
WSD in general is not an unsolved problem — supervised and neural methods work well — but every
method that beats knowledge-based WSD is statistical or neural, which tmct's ground rule rules
out. The honest framing for tmct specifically: *the general field has strong solutions; the
symbolic subset available to a no-LLM system is real but measurably, significantly weaker, and
whether it can be made good enough at 2M-word merged-ontology scale is the open question for THIS
system, not for WSD as a field.*

One knowledge-based technique is worth flagging separately because it is a pure **graph walk**,
not a corpus-trained model, and tmct already has a graph substrate to walk: Agirre, E. & Soroa, A.,
"Personalizing PageRank for Word Sense Disambiguation" (*EACL 2009*, ACL Anthology E09-1005 —
verified), which runs personalized PageRank directly over the WordNet graph (no training corpus,
no embeddings) to pick senses — the UKB system. It is still a knowledge-based method and still
loses to supervised/neural per Raganato et al. above, but it is architecturally the closest of the
symbolic family to "disambiguate using the graph tmct already maintains," rather than requiring an
external gloss corpus.

### 7.3 Does a vehicle already exist? BabelNet — a real precedent, and a cautionary tale in the same breath

The single most relevant existing project is Navigli, R. & Ponzetto, S.P., "BabelNet: The
Automatic Construction, Evaluation and Application of a Wide-Coverage Multilingual Semantic
Network" (*Artificial Intelligence* 193, Elsevier, 2012, pp. 217–250 — verified, ScienceDirect
10.1016/j.artint.2012.07.001). BabelNet automatically merges WordNet synsets with Wikipedia pages
(plus multilingual/MT-derived lexical data) into "Babel synsets" at millions-of-concepts scale,
using its own WSD-based mapping: build a context from surrounding synsets and article text for
each candidate pairing, map one-to-one where unambiguous, otherwise resolve via an argmax scoring
step, then globally refine using Wikipedia's own link structure, disambiguation pages,
inter-language links, and category assignments. It reports state-of-the-art results on multiple
SemEval WSD tasks using the merged resource itself as the disambiguation substrate — this is real,
published, working evidence that automatic large-scale cross-resource sense merging is achievable,
not merely theorized.

**Three honest caveats keep this from being a ready-made answer to the operator's problem:**

1. **BabelNet's own pipeline moved away from purely symbolic mechanisms as it scaled.** Its
   earliest releases used deterministic rules and bag-of-words gloss matching (closer to Lesk in
   spirit); from version 3 onward it adopted Babelfy, which runs personalized PageRank over the
   BabelNet graph combined with statistical/ML entity-linking features. The project that proves
   the merge is achievable also demonstrates that achieving it *well* pushed past the
   purely-symbolic toolkit tmct is restricted to — the same tension this plan's ground rules exist
   to name honestly, not paper over.
2. **BabelNet solves a different axis of the same-shaped problem.** Its merge is
   general-encyclopedic-and-lexicographic **across languages** (English WordNet senses ↔
   Wikipedia articles ↔ other-language equivalents), not **across technical domains within
   English**. The `cache`/`thread`/`wave`-style collision the operator names is a within-English,
   cross-register problem — BabelNet's cross-lingual alignment signal (translation equivalence,
   inter-language Wikipedia links) doesn't directly transfer to it; a domain collision has no
   analogous "this is obviously the French translation" anchor to exploit.
3. **Licensing and scale are real, not incidental, obstacles.** BabelNet is distributed under a
   non-commercial-research-only licence (redistribution and commercial/product use require a
   separate negotiated agreement) — incompatible with tmct's MPL-2.0, commercially-usable
   distribution model even before considering its size. So BabelNet is a genuine precedent that
   automatic large-scale sense merging *can* be done — and simultaneously a cautionary tale that
   doing it well, at this scale, has historically required leaving the symbolic-only toolkit and a
   licence tmct could not ship under regardless.

**Verdict: BabelNet answers "has anyone done something like this at scale" (yes, genuinely) but
does not hand tmct a usable vehicle** — wrong axis of ambiguity, wrong licence, and its own
evolution is evidence *against* staying purely symbolic at this scale, not evidence for it.

### 7.4 Domain partitioning without a full statistical merge — the closer precedent for option (a)

For the operator's option (a) — per-domain sense partitioning with explicit cross-domain
disambiguation edges, rather than one flat sense inventory — the closer, genuinely symbolic
precedent is **domain labeling of an existing sense inventory**, not the more famous WordNet
Domains: Magnini, B. & Cavaglià, G., "Integrating Subject Field Codes into WordNet" (*LREC 2000*,
ACL Anthology L00-1167 — verified) hand-seeds a small set of high-level WordNet synsets with
subject-field labels, then propagates those labels through WordNet's own relation edges
(hyponymy, troponymy, meronymy, pertain-to) to reach ~164 domain labels covering the whole synset
graph — a purely symbolic, rule-propagation technique, no training corpus, no neural component,
architecturally close to `syllogise.mjs`'s own subClassOf closure. It is a real, citable answer to
"is there a general (non-software-specific) symbolic technique for tagging senses by domain rather
than merging them into one flat inventory" — yes, and it predates and generalizes the
already-cited SEthesaurus finding (§3 track e; Chen et al. 2019), which is the same idea applied
narrowly to software terminology via a corpus-contrast-then-cluster pipeline instead of a relation-
propagation pipeline. Both are evidence that domain-tagging (rather than full merge) is the more
tractable, more symbolic-compatible half of the operator's two named options.

### 7.5 The genuinely speculative angle: local-context mutual disambiguation over tmct's own graph

For option (b) — using nearby already-resolved terms to disambiguate a word's domain, rather than
a pre-built domain-labeled inventory — the closest prior art is two older, well-established
empirical regularities, not a ready-made algorithm for this exact application: Gale, W.A., Church,
K.W. & Yarowsky, D., "One Sense Per Discourse" (*Proceedings of the 4th DARPA Speech and Natural
Language Workshop*, Harriman, NY, 1992, ACL Anthology H92-1045 — verified) and Yarowsky, D., "One
Sense per Collocation" (*Human Language Technology Workshop*, 1993 — verified, reporting 90–99%
accuracy for binary sense ambiguities under a fixed local-collocation definition). Both findings
are symbolic/statistical regularities about *how* natural language stays locally consistent — a
word tends to keep one sense across a discourse, and near-deterministically one sense within a
fixed local collocation — not neural, not requiring a trained classifier to state as a rule (though
Yarowsky's own follow-on algorithm, bootstrapped decision lists, is itself a corpus-statistical
method and not directly reusable inside tmct's ground rules).

**The speculative sketch, clearly labeled as speculation, not a build plan**: tmct's `src/interpret/`
already performs closed-vocabulary keyword-spotting and context resolution over a request before
it reaches the answering layer — i.e., the system already knows, per-turn, which OTHER terms in
the same utterance/session resolved to which domain. A deterministic, table-driven rule of the
shape "if an ambiguous term co-occurs, within N tokens or N graph-hops, with an already-resolved
term from domain D, prefer D's sense of the ambiguous term; fall back to a declared default sense
(or an honest 'which did you mean' nudge) if no neighbouring domain signal exists" is a
structurally-bounded, deterministic instantiation of one-sense-per-collocation/discourse — using
tmct's own closed graph as the "collocation" context instead of a training corpus. **No published
prior art was found for this exact application** (domain-tagging a merged multi-domain lexical
resource via mutual disambiguation from already-resolved neighbouring terms in a closed,
deterministic system) — flagged honestly as an original angle worth spiking, in the same spirit as
this repo's other "no vehicle yet" sketches (`PLAN_CAPABILITY_ROUTER.md`'s bounded goal
recognition, `PLAN_ADVANCED_GRAMMAR.md` track (c)'s closed disjunct dictionary), not a claimed
result.

### 7.6 Honest summary

**Solved, for the field:** WSD in general — supervised and neural methods achieve strong,
well-measured results (Raganato et al. 2017), and BabelNet proves automatic cross-resource sense
merging at millions-of-concepts scale is achievable in practice, not just in theory.

**Genuinely hard, specifically because of tmct's constraints, not because the field failed:**
every method that clears the accuracy bar (supervised WSD, neural WSD, BabelNet's own current
Babelfy-era pipeline) is statistical or neural; the purely symbolic subset available under
tmct's no-LLM/deterministic/explainable rule (Lesk-family, graph-walk methods like UKB, relation-
propagation domain tagging like WordNet Domains/SEthesaurus) is real and citable but measurably
weaker, and no one has published the combination this idea needs: a symbolic, deterministic,
explainable disambiguation mechanism sufficient for a 2M-word, cross-domain, general+technical
merged ontology at production quality. That combination is the actual open question for tmct —
not "can WSD be done" (yes), not "can large-scale sense merging be done" (yes, BabelNet), but
"can it be done symbolically, at this scale, well enough to trust" (unknown, unattempted at this
scale under this constraint).

**Not scheduled, not scoped, not contradicting track (e).** This section names a research
direction the way ROADMAP.md's "After the horizon" list names the frame problem and Winograd-hard
coreference: real, cited, honestly speculative where it is speculative, and explicitly not a
commitment to build. Track (e)'s narrower finding (don't import raw WordNet into tmct's own tier-1
corpus) stands unchanged; this is the bigger idea walked into, not the smaller idea revised.

---

### Critical Files for Implementation
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/corpus/conceptnet-map.toml
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/corpus/conceptnet.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/chat.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/grammar/lexicon-core.json
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/syllogise.mjs
