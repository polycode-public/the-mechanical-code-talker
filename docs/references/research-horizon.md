# The research horizon — frame problem, WSD-at-scale, and Winograd-hard coreference

Three PLAN documents — [`archive/PLAN_CAPABILITY_ROUTER.md`](../../archive/PLAN_CAPABILITY_ROUTER.md),
[`archive/PLAN_ontology-hierarchies.md`](../../archive/PLAN_ontology-hierarchies.md), and
[`archive/PLAN_ADVANCED_GRAMMAR.md`](../../archive/PLAN_ADVANCED_GRAMMAR.md) — independently grew
long, cited literature reviews of genuinely open research territory while scoping their own,
narrower, actually-scheduled work. Each review reached the same honest conclusion from a
different direction: this particular boundary is not an engineering gap tmct failed to close, it
is where the wider field itself stops having a settled answer. That made three separate,
overlapping essays sitting inside three otherwise-unrelated plans, each liable to be
re-researched from scratch the next time someone opens the adjacent plan.

This document is the consolidation. It carries the full content of all three reviews, citations
intact, in one place, so a future PLAN that wants to open one of these fronts cites this doc
instead of re-deriving the literature. Nothing here is scheduled work — see each section's own
"not yet" language, which is preserved verbatim from its source.

## 1. The frame problem / open-world boundary

Source: `PLAN_CAPABILITY_ROUTER.md`, "The open-world boundary — naming the real problem."

"Unsolved. Escalate." is honest but underspecifies *what* is unsolved. Three things hide behind
that one phrase, and they are not equally hard — the point of this section is to separate them.

**Not actually open — known-hard, not unknown-how.** Planning under incomplete knowledge of the
*initial* state has real, published algorithms: belief-space heuristic search (Bonet & Geffner,
"Planning with Incomplete Information as Heuristic Search in Belief Space", AIPS 2000) generalizes
classical forward search from states to sets of possible worlds; Conformant-FF (Hoffmann &
Brafman, "Conformant Planning via Heuristic Forward Search: A New Approach", *Artificial
Intelligence* 170(6–7), 2006) makes conformant planning practical without any sensing; Petrick &
Bacchus's PKS ("A Knowledge-Based Approach to Planning with Incomplete Information and Sensing",
AIPS/ICAPS 2002) tracks the planner's *knowledge* rather than enumerating possible worlds, and
handles sensing actions directly. These are harder than STRIPS — belief space is exponentially
larger than state space — but they are **solved** in the research sense: a *declared-but-uncertain*
world, not an undeclared one. tmct doesn't have this yet; that is engineering debt to pull off the
shelf (deferring search to Fast Downward applies equally to a belief-space/conformant solver), not
a research frontier.

**The genuinely open core: the frame problem, in its relevance-bounding form.** McCarthy & Hayes
coined "the frame problem" in 1969 ("Some Philosophical Problems from the Standpoint of Artificial
Intelligence", *Machine Intelligence* 4, Edinburgh University Press, 463–502) as the difficulty of
stating what *doesn't* change after an action without enumerating it. That narrow reading is
solved: situation calculus's successor-state axioms (Reiter, "The Frame Problem in the Situation
Calculus: A Simple Solution (Sometimes) and a Completeness Result for Goal Regression", 1991)
collapse the frame-axiom count from actions×fluents to actions+fluents; the event calculus
(Kowalski & Sergot, "A Logic-based Calculus of Events", *New Generation Computing* 4(1), 1986)
does the analogous thing for narrative/database updates; STRIPS's own add/delete lists (Fikes &
Nilsson, "STRIPS: A New Approach to the Application of Theorem Proving to Problem Solving",
*Artificial Intelligence* 2, 1971) are the original special case. None of these generalize past a
**declared** effect model — which is exactly a closed-world assumption already, restated. What
none of them touch is the deeper reading McCarthy himself flagged as open: given an *undeclared*
world, how does a reasoner decide *which* of the unbounded facts that could be true are relevant to
consider at all, without an oracle telling it what to ignore? That is not a frame-*axiom* problem —
it's a **relevance-bounding** problem, and it has no algorithmic solution in the general case. This
is the frame problem's living core, and it is the actual content of "open-world planning" once the
closed-world engineering above is stripped away.

**The recent, rigorous treatment says this may not be a matter of degree.** Relevance realization
has its own citable literature, and it is not just popular-science framing: Vervaeke, Lillicrap &
Richards ("Relevance Realization and the Emerging Framework in Cognitive Science", *Journal of
Logic and Computation* 22(1):79–99, 2012) argue relevance realization is the problem cognitive
science has converged on as central — a peer-reviewed synthesis across the contributing
disciplines, not the popular *Awakening from the Meaning Crisis* material built on top of it.
Jaeger, Riedl, Djedovic, Vervaeke & Walsh ("Naturalizing relevance realization: why agency and
cognition are fundamentally not computational", *Frontiers in Psychology*, 2024) go further and
make the frame problem the paper's own frame: "the frame problem, defined in its most general form
as the problem of relevance" cannot, they argue, be solved algorithmically at all — turning an
ill-defined (semantic) problem into a well-defined (syntactic) one is itself the un-formalizable
step, by an argument they liken to Gödelian incompleteness. Treat that as a serious, contestable
philosophical argument, not a proof. But it is exactly the honest register the rest of this
material uses: not "we haven't built it", but "there is a live, peer-reviewed argument that it
cannot be built as an algorithm at all". Read this way, a deterministic system's "Unsolved.
Escalate." is not a cop-out — it may be the only defensible position for a system that refuses to
guess.

**The sibling problem on the goal side: open-world goal *recognition*.** tmct's goal-reasoner
(`src/router/goal-reasoner.mjs`) already does closed-world goal *selection* — deduce which of a
small **declared** set of goal-rules applies via `applicableRules`, refuse on 0 or >1 matches. The
harder, less-solved sibling is open-world goal *recognition*: given an arbitrary request, infer
intent from a world of **undeclared** possible goals. The closed-world version is well studied:
Ramírez & Geffner ("Plan Recognition as Planning", IJCAI 2009) compile goal recognition into a
planning problem — given a *declared* set of candidate goals and a domain theory, find which
goal's optimal plan best explains the observed actions; Keren, Gal & Karpas ("Goal Recognition
Design", ICAPS 2014, using their "worst-case distinctiveness" measure) study the dual problem —
designing the domain itself so recognition is fast. **Both assume the true goal is a member of the
declared candidate set.** A bug in `src/router/goal-reasoner.mjs`'s domain gate (fixed in a prior
session) was exactly a symptom of this boundary: `applicableRules` deduced a goal-rule from the
declared toolset alone, without checking the request itself was actually *about* that goal's
domain — an open-world-goal-generation failure surfacing as a confident false positive rather than
a missing capability.

**Symbolic + open-world + no-LLM is a narrower, mostly-abandoned research niche — say so plainly.**
The field's trajectory over the last two years has been to reintroduce an LLM specifically to plug
the open-world gap in an otherwise-symbolic planner, not to solve the open-world case symbolically.
Chen, Yang, Jia, Hu, Chen, Zhang, Wang & Pan ("Language-Augmented Symbolic Planner for Open-World
Task Planning", RSS 2024) is a clean example: a classical symbolic planner handles everything it
can, and an LLM is invoked precisely where action preconditions, objects, or properties are
incomplete — i.e., precisely at tmct's own escalation seam. This is independent confirmation from a
different research community that "closed-world symbolic, escalate at the open-world edge" is the
state-of-the-art *shape*, not a compromise unique to tmct. What's genuinely absent from the
literature is a competitive **purely symbolic, no-LLM** answer to the open-world case: searching
turns up open-set recognition / novelty detection as a live subfield, but it is a *statistical/ML*
one (Bendale & Boult, "Towards Open World Recognition", CVPR 2015 — reject-then-incrementally-learn
unknown classes), with essentially no cross-pollination into the classical goal-recognition-as-
planning literature above, which still assumes a closed candidate-goal set. That gap — not "nobody
has thought about it" but "the specific combination of open-set rejection + symbolic
goal-recognition-as-planning has no dedicated line of published work this research could find" — is
real, and it shapes the speculative angle below.

### 1.1 Speculative and unbuilt: bounded (N+1) goal recognition

**A speculative angle that hasn't had a vehicle.** Full open-world goal recognition is out of reach
for a deterministic system — that's the honest boundary above. But tmct's own architecture already
narrows the problem in a way the literature doesn't: it never needs to recognize an *arbitrary*
goal, only to decide, for a small **declared** set of N goal-rules, whether a request matches goal
1..N or belongs to an explicit **(N+1)th "none of the above, escalate"** class — precisely the
shape the goal-reasoner's domain gate ad-hoc-solved once, generalized. Ramírez & Geffner's
plan-recognition-as-planning gives a real mechanism for scoring "does this request's parse best
explain goal *i*'s declared plan" for *i* in 1..N; the missing piece — and the part with no
citable prior technique this research could find — is a *principled* reject rule for the (N+1)th
class, derived the same way the rest of tmct proves things (structurally, from the grammar, never
a learned score). One tractable, deterministic, no-LLM candidate: borrow the *structure* of
open-set recognition (reject when no known class's decision region contains the input) but
implement the "decision region" symbolically — a goal-rule's region is the **set of parse shapes**
that name its declared `focusClass`/toolset (exactly what the domain gate already computes,
reusing `ask.mjs`'s `parseQuery`), and reject-to-escalate is what happens when the request's parse
shape falls in *none* of the N regions — deterministically, not probabilistically. This has not
been published or built anywhere this research could find; it would be a genuine new combination:
symbolic, N+1-bounded, explainable goal recognition, built from grammar-shape membership instead of
either a candidate list assumed exhaustive (Ramírez & Geffner) or a learned open-set classifier
(Bendale & Boult). It stays inside tmct's ground rules — deterministic, no LLM, every accept/reject
decision traces to a parse-shape match — and it is a *narrower* claim than "solve open-world goal
recognition": it only ever answers "is this one of my N declared goals, yes/no", never "what new
goal is this". That bound is the whole point, and it is the next spike to scope, not a result to
claim yet.

## 2. Word-sense disambiguation / ontology scale

Source: `PLAN_ontology-hierarchies.md` §7, "A separate, much bigger target: a shared ~2M-word
cross-domain ontology."

This is additive to, not a revision of, `PLAN_ontology-hierarchies.md` §3 track (e), whose finding
stands unweakened: importing raw WordNet into tmct's own small tier-1 corpus is wrong tier — it
duplicates ConceptNet's already-filtered WordNet-derived core and reintroduces the exact word-sense
noise the `RelatedTo` exclusion was built to avoid. That rejection rationale lives in the archived
§3 text and is not repeated here; what follows is a different, much bigger, explicitly speculative
idea: a hypothetical **connected ontology at ~2,000,000 words** — a ~1M-word general-English base
(the "every word including technical vocabulary" scope estimated at roughly this size by
Harvard/Google's 2010 corpus-linguistics count, distinct from WordNet 3.1's own 155,327-word /
175,979-synset / 207,016-sense-pair inventory) merged with a ~1M-word technical/scientific/
engineering/programming-language/slang vocabulary drawn from CS, physics, biology, and informal
registers. A rough JSON-triple size estimate for a resource at that scale put it at 1.6–3.2 GB —
three orders of magnitude past tier-1's ~2 MB budget and past tier-2's "extended neighbourhood"
framing too. This is a real research target with citations, in the same register as this document's
other sections — not a stop sign, not a build plan.

### 2.1 The real problem, named precisely

Merging two 1M-word vocabularies is not simply additive because a huge fraction of the technical
vocabulary is **lexically identical to, but semantically disjoint from, common general-English
words**: `class`, `object`, `thread`, `cache`, `wave`, `pipe`, `stream`, `kernel`, `driver`,
`packet`, `cell`, `field`, `type`, `state` each carry structurally different senses across general
English, CS, physics, biology, and slang registers (a `thread` is a strand of fiber, a discussion
sub-topic, or a unit of CPU execution; a `wave` is water motion, a hand gesture, or a physics
oscillation; a `cell` is a prison room, a biological unit, a spreadsheet coordinate, or a battery).
A flat merged sense inventory dilutes or collides these; the two structural options are the two
live approaches in the literature: **(a)** per-domain sense partitioning with explicit
cross-domain disambiguation edges, or **(b)** some other mechanism — context-driven disambiguation
at lookup/ingest time — that keeps senses from colliding without a full partition. This is
precisely **word-sense disambiguation (WSD)** at construction time, plus its adjacent sub-field
**domain adaptation for lexical resource construction / sense-inventory design** — both real,
decades-old, extensively published areas, not an undiscovered problem.

### 2.2 Foundations: knowledge-based (symbolic) WSD — the family compatible with no-LLM

The one WSD family that fits a permanent no-LLM/deterministic/explainable ground rule is the
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
method that beats knowledge-based WSD is statistical or neural, which the no-LLM ground rule rules
out. The honest framing: *the general field has strong solutions; the symbolic subset available to
a no-LLM system is real but measurably, significantly weaker, and whether it can be made good
enough at 2M-word merged-ontology scale is the open question for this kind of system, not for WSD
as a field.*

One knowledge-based technique is worth flagging separately because it is a pure **graph walk**,
not a corpus-trained model, and tmct already has a graph substrate to walk: Agirre, E. & Soroa, A.,
"Personalizing PageRank for Word Sense Disambiguation" (*EACL 2009*, ACL Anthology E09-1005 —
verified), which runs personalized PageRank directly over the WordNet graph (no training corpus,
no embeddings) to pick senses — the UKB system. It is still a knowledge-based method and still
loses to supervised/neural per Raganato et al. above, but it is architecturally the closest of the
symbolic family to "disambiguate using the graph tmct already maintains," rather than requiring an
external gloss corpus.

### 2.3 Does a vehicle already exist? BabelNet — a real precedent, and a cautionary tale in the same breath

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

**Three honest caveats keep this from being a ready-made answer:**

1. **BabelNet's own pipeline moved away from purely symbolic mechanisms as it scaled.** Its
   earliest releases used deterministic rules and bag-of-words gloss matching (closer to Lesk in
   spirit); from version 3 onward it adopted Babelfy, which runs personalized PageRank over the
   BabelNet graph combined with statistical/ML entity-linking features. The project that proves
   the merge is achievable also demonstrates that achieving it *well* pushed past the
   purely-symbolic toolkit — the same tension named honestly here, not papered over.
2. **BabelNet solves a different axis of the same-shaped problem.** Its merge is
   general-encyclopedic-and-lexicographic **across languages** (English WordNet senses ↔
   Wikipedia articles ↔ other-language equivalents), not **across technical domains within
   English**. The `cache`/`thread`/`wave`-style collision named above is a within-English,
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

### 2.4 Domain partitioning without a full statistical merge — the closer precedent for option (a)

For option (a) — per-domain sense partitioning with explicit cross-domain disambiguation edges,
rather than one flat sense inventory — the closer, genuinely symbolic precedent is **domain
labeling of an existing sense inventory**, not the more famous WordNet Domains: Magnini, B. &
Cavaglià, G., "Integrating Subject Field Codes into WordNet" (*LREC 2000*, ACL Anthology
L00-1167 — verified) hand-seeds a small set of high-level WordNet synsets with subject-field
labels, then propagates those labels through WordNet's own relation edges (hyponymy, troponymy,
meronymy, pertain-to) to reach ~164 domain labels covering the whole synset graph — a purely
symbolic, rule-propagation technique, no training corpus, no neural component, architecturally
close to `syllogise.mjs`'s own subClassOf closure. It is a real, citable answer to "is there a
general (non-software-specific) symbolic technique for tagging senses by domain rather than
merging them into one flat inventory" — yes, and it predates and generalizes the already-cited
SEthesaurus finding (`PLAN_ontology-hierarchies.md` §3 track (e); Chen et al. 2019), which is the
same idea applied narrowly to software terminology via a corpus-contrast-then-cluster pipeline
instead of a relation-propagation pipeline. Both are evidence that domain-tagging (rather than
full merge) is the more tractable, more symbolic-compatible half of the two named options.

### 2.5 The genuinely speculative angle: local-context mutual disambiguation over tmct's own graph

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
method and not directly reusable inside a no-LLM system's ground rules).

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
this document's other "no vehicle yet" sketches (§1.1's bounded goal recognition, §3's closed
disjunct dictionary), not a claimed result.

### 2.6 Honest summary

**Solved, for the field:** WSD in general — supervised and neural methods achieve strong,
well-measured results (Raganato et al. 2017), and BabelNet proves automatic cross-resource sense
merging at millions-of-concepts scale is achievable in practice, not just in theory.

**Genuinely hard, specifically because of the no-LLM constraint, not because the field failed:**
every method that clears the accuracy bar (supervised WSD, neural WSD, BabelNet's own current
Babelfy-era pipeline) is statistical or neural; the purely symbolic subset available under a
no-LLM/deterministic/explainable rule (Lesk-family, graph-walk methods like UKB, relation-
propagation domain tagging like WordNet Domains/SEthesaurus) is real and citable but measurably
weaker, and no one has published the combination this idea needs: a symbolic, deterministic,
explainable disambiguation mechanism sufficient for a 2M-word, cross-domain, general+technical
merged ontology at production quality. That combination is the actual open question here — not
"can WSD be done" (yes), not "can large-scale sense merging be done" (yes, BabelNet), but "can it
be done symbolically, at this scale, well enough to trust" (unknown, unattempted at this scale
under this constraint).

Not scheduled, not scoped, not contradicting `PLAN_ontology-hierarchies.md` §3 track (e). This
section names a research direction the way this document's other sections do: real, cited,
honestly speculative where it is speculative, and explicitly not a commitment to build. Track
(e)'s narrower finding (don't import raw WordNet into tmct's own tier-1 corpus) stands unchanged;
this is the bigger idea, not the smaller idea revised.

## 3. Symbolic dependency parsing

Source: `PLAN_ADVANCED_GRAMMAR.md`, track (c), "wink dependency-lite."

**A negative finding for the home-built chunker, but not because symbolic parsing is dead; it's
because the field walked away from it.** What wink actually provides (`ask-nlp.mjs` adapter +
`wink-model.mjs` loader): tokenization, sentence boundaries, POS tags, lemmas, NER, custom-entity
patterns. **No dependency or constituency parse.** A "dep-lite" built as a home-grown POS-chunker
(NP/VP shells → head-attachment heuristics) is L effort with a known-hard accuracy cliff on
exactly the constructions such a mechanism would need it for (PP-attachment and
attachment-under-embedding are the textbook hard cases — no amount of hand-tuned heuristic closes
that gap at general-English coverage). Verdict, unchanged: do not build a general chunker. Narrow
admissible slice, unchanged: a POS-gated *clause splitter* (finite-verb counting to segment
subordinate clauses before frame tables run).

*Research frontier, named honestly.* "wink has no dependency parse" reads as a library gap; the
real fact underneath is that **rule-based, non-statistical dependency parsing is a largely
abandoned line of research**, and it was abandoned for funding/publication reasons, not because
it was proven inferior at any fixed data budget:

- Dependency grammar itself is old and symbolic in origin — Tesnière's *Éléments de syntaxe
  structurale* (posthumous, 1959) is the founding text: valency-based government from a verb to
  its actants/circumstants, diagrammed as stemmas, with no statistics anywhere in the formalism.
- **Covington's incremental algorithm** ("A Fundamental Algorithm for Dependency Parsing," *Proc.
  39th ACM Southeast Conference*, 2001; corrected reprint arXiv:2510.19996) is a genuine
  from-scratch symbolic method: process words left-to-right, test each new word against every
  previously-processed word for an attachable dependency, O(n³) worst case but near-linear on
  real sentences. No training data, no statistical model — it's a real, citable, purely
  rule-driven parsing algorithm.
- **Link Grammar** (Sleator & Temperley, "Parsing English with a Link Grammar," CMU tech report
  1991/1993, arXiv:cmp-lg/9508004) is the strongest existing proof this isn't vaporware: a
  dictionary of per-word "connector" disjuncts (jigsaw-piece link requirements) that a search
  procedure satisfies into a planar linkage — fully rule-based, no treebank training, LGPL C
  library still actively maintained today (v5.12.x, 2024; bindings for Python/Java/Node; used by
  AbiWord's grammar checker and the OpenCog project). It is real, embeddable, and *not neural* —
  worth naming specifically because it's the counter-example to "no symbolic parser survived."
  Its ceiling is coverage and ambiguity ranking on genuinely open English, not architecture.
- **Combinatory Categorial Grammar** (Steedman, *The Syntactic Process*, MIT Press, 2001) is the
  other live symbolic framework — categories carry their own combination rules (application,
  composition, type-raising), so syntax and semantics build in lockstep. CCG's own most-cited
  *application*, though, is Zettlemoyer & Collins's statistically-trained semantic parser
  ("Learning to Map Sentences to Logical Form: Structured Classification with Probabilistic
  Categorial Grammars," UAI 2005) mapping ATIS-style database queries to logical form — telling,
  because it shows CCG's natural home is a **closed query domain**, not open text, and that even
  there the field reached for statistics rather than a hand-built lexicon.
- The honest field-level fact, checked rather than assumed: the CoNLL 2017/2018 Universal
  Dependencies shared tasks were won outright by neural graph-based (biaffine) parsers, and every
  competitive dependency parser since is neural. Nobody is publishing hand-built symbolic
  dependency parsers anymore — not because Covington's algorithm stopped working, but because
  research incentives (leaderboards, treebank-scale eval, funding) all reward statistical
  approaches. **That abandonment is itself the finding worth recording**: this is a "known how,
  nobody kept building it" gap, not a "provably impossible" one — closer to an open frontier than
  a solved-and-discarded idea.
- The closed-domain angle this licenses, not built anywhere findable: a code-relationship query
  system's queries are not open English — they're a bounded vocabulary over a fixed relation set
  (imports/calls/tests/inherits/…, `ENTITY_TO_TYPE`/`VERB_TO_KIND`). **Grammar induction restricted
  to a closed domain lexicon is a much smaller problem than general parsing** — a Link-Grammar-style
  disjunct dictionary or a CCG-lite lexicon written BY HAND (not induced statistically) over such a
  closed relation vocabulary is tractable at S–M effort precisely because the vocabulary is closed
  and the grammar doesn't need to cover the long tail of general English. Attempto Controlled
  English (Fuchs & Schwitter, "Attempto Controlled English — Not Just Another Logic Specification
  Language," 1996 onward, arXiv:cmp-lg/9603003) is the concrete existence proof for this pattern at
  large: a restricted, unambiguous English subset with a hand-built grammar that compiles
  deterministically to first-order logic, deployed for requirements specs and the semantic web for
  decades. tmct's ACE-OWL strategy (`src/grammar/ace.mjs`, wired in as its own additive class via
  `src/interpret/strategies/ace.mjs` and `src/interpret/pipeline.mjs`'s precedence-ordered
  `STRATEGIES` array) is already the same species of thing — a hand-written controlled fragment,
  own-class, clean-parse-or-null, never displacing the tolerant strategies. A "dep-lite" strategy
  scoped the same way — bounded disjunct/category dictionary over the closed relation vocabulary
  only, registered as another additive class beside `ace-fact`, refusing (returning null) rather
  than guessing outside its lexicon — would be a genuine step toward real dependency structure
  without inheriting general-parsing's accuracy cliff, because the cliff is a function of open
  vocabulary and unbounded ambiguity, neither of which this domain has. Nobody appears to have
  published this specific combination (symbolic dependency/categorial grammar, hand-built not
  induced, scoped to a closed code-relationship query domain as an additive strategy in a
  multi-strategy interpreter) — a real "no vehicle yet" idea, not a rediscovery of prior art. This
  is not scheduled work — this paragraph records the idea so it isn't re-discovered from scratch,
  not a green light to build it.

## 4. Winograd-hard coreference

Source: `PLAN_ADVANCED_GRAMMAR.md`, track (g), "The permanent ceiling, kept honest."

**Named as a real research frontier, not just a wall.** Winograd-class items need world
knowledge — `graded-language-measures.md:18` ("pronoun resolution requiring world knowledge — the
permanent TOO-HARD ceiling markers") and `ROADMAP.md:590`'s frame-problem language ("unsolved in
the general case and not pretended otherwise"). The g-c2-pron measure stays 25 marker items, judged
rarely, expected red; a mechanism that "fixes" them via fixture-specific heuristics is overfit by
definition and gets reverted. Same bucket: irony, register, genuine idiomatic creativity.

*What the literature actually says, checked rather than recalled.* The Winograd Schema Challenge
was proposed as a *deliberately* statistics-resistant test: Levesque, Davis & Morgenstern, "The
Winograd Schema Challenge," KR-2012 (expanded from a Commonsense-2011 talk) — designed so
schema pairs are "Google-proof," i.e. "no obvious statistical test over text corpora … will
reliably disambiguate these correctly," specifically to rule out the co-occurrence shortcut a
frequency-count or embedding-similarity trick would take. That design goal is exactly why it's
the right ceiling marker for a no-LLM, no-statistics product: a deterministic system of this kind
is structurally the kind of system the WSC was built to defeat, by intent, not by accident.

Is it "solved" now? Only partially, and the literature is explicit about the caveat. By ~2019,
transformer language models fine-tuned on WSC-style data crossed 90% — but Sakaguchi, Le Bras,
Bhagavatula & Choi built **WinoGrande** ("WinoGrande: An Adversarial Winograd Schema Challenge at
Scale," AAAI 2020, arXiv:1907.10641) specifically because the original 273-item WSC set turned
out to be small enough and stylized enough that models could be exploiting annotation artifacts
rather than reasoning; WinoGrande's AFLITE adversarial-filtering algorithm at 44k items closes
much of that gap and is measurably harder. Even more directly on point: Kocijan, Davis,
Lukasiewicz, Marcus & Morgenstern, "The Defeat of the Winograd Schema Challenge," *Artificial
Intelligence* 325 (2023) 103971 (arXiv:2201.02387) — a retrospective by two of the challenge's own
co-authors — concludes that LLM success on WSC-derived benchmarks is confounded by dataset bias
and "knowledge leakage" from web-scale pretraining that has since absorbed huge numbers of
Winograd-style sentences and their answers, not demonstrated proof of general commonsense
reasoning. **Read plainly: nobody has shown a system solves Winograd-class ambiguity by reasoning
from a closed, inspectable knowledge source; the systems that score well do so by having ingested
statistical traces of approximately this exact problem at planetary scale.** That is precisely the
resource a no-LLM, no-training-data ground rule forbids, so the ceiling is not a tooling gap that
was failed to be built past — it's the one form of "success" on this benchmark that is
fundamentally unavailable to a deterministic, explainable system, and the field's own most careful
authors say the observed "success" elsewhere may not be real understanding either.

The other symbolic path — build a genuine commonsense knowledge base and reason over it instead of
using statistics — has a real, decades-long, largely-cautionary data point: **Cyc** (Lenat, from
1984; spun off as Cycorp in 1995), an explicit attempt to hand-encode on the order of 100 million
commonsense assertions in symbolic form, auditable and rule-based rather than statistical — the
closest thing that exists to "the WSC problem, taken seriously, at Cyc's scale of ambition." Forty
years on, Cyc is remembered in the field largely as a cautionary tale: enormous engineering effort,
modest and narrow deployed payoff, no publicly demonstrated general-commonsense breakthrough at
the scale originally promised. This is the honest ceiling on the *other* side of the tradeoff:
avoiding statistics by hand-building a knowledge base doesn't reliably work either, at least not at
anything like a small project's effort budget. So the frame-problem framing running through this
document is correct on both branches, not just the statistical one — there is, as of this research
pass, no demonstrated third way that is both symbolic/deterministic and general-purpose.

### 4.1 Speculative and unbuilt: grounding disambiguation in a closed graph

*The genuinely speculative angle worth recording, scoped to what tmct actually has.* Every WSC
treatment in the literature above assumes an OPEN general-knowledge domain — that's the whole
point of the challenge, and why Cyc-scale effort was seen as the only symbolic answer. tmct's
situation is different in one structural way worth naming: its "world" is not open text, it's a
**complete, closed, already-loaded graph** (`.tmct/` OWL-labelled JSON — every entity, class, and
relation the reasoner will ever be asked about is already a node it can traverse, not a fact it
must retrieve or infer from unbounded background knowledge). A code-domain analogue of a Winograd
pair — "the function calls the module before it initializes; what does 'it' refer to?" — is not
actually open-domain commonsense in this world: the antecedent candidates are a finite, enumerable
set of graph individuals with known classes and known relations to each other, and the
disambiguating "commonsense" fact (does a function initialize a module, or can a module initialize
itself; which relations are typically valid arguments for "initializes") is exactly the kind of
fact tmct's own schema (`ENTITY_TO_TYPE`/`VERB_TO_KIND`, class-gated focus per `nextFocus`,
`src/chat.mjs:268`) already encodes as data, not as reasoning. This reframes a subset of
Winograd-shaped ambiguity — NOT the general case, NOT irony/idiom/register, only the sliver where
disambiguation turns on a fact already present as a graph edge or a class constraint — as a
graph-query filtering problem rather than a commonsense-reasoning problem. This angle could not be
found built anywhere: the WSC and its successors are evaluated exclusively over open
natural-language sentences with no accompanying structured world model the reasoner is presumed to
already possess completely; grounding pronoun disambiguation in a closed, complete,
already-available relational graph — rather than either statistical priors or a hand-authored
general commonsense KB — is a real "no vehicle yet" idea specific to structured-domain chatbots.
It would not touch the g-c2-pron ceiling markers (those are deliberately open-world-flavored
fixture items, by design unsolvable this way) but could, as a DISTINCT and separately-named
mechanism, extend a DRT-lite discourse record (typed entities/sets/times/propositions) with a
class-constraint disambiguation pass for the narrower "which graph-typed antecedent is
relation-plausible" cases — worth a future PLAN, not scheduled here, and must never be presented
as "solving Winograd" since it explicitly isn't the same problem.

### 4.2 A closer, real theoretical grounding for what tmct already ships

Ordinary anaphora resolution over a small closed set of recent discourse referents — which is what
`nextFocus` (`src/chat.mjs:268`) and the router's `bindAnaphor` (`planner.mjs:116`) already do
reasonably well — is NOT the frontier described above; it's tractable and largely solved territory,
and conflating it with Winograd-hard cases would be dishonest. It does, however, have a real
symbolic theory it currently only informally resembles: **centering theory** (Grosz, Joshi &
Weinstein, "Centering: A Framework for Modeling the Local Coherence of Discourse," *Computational
Linguistics* 21(2), 1995) formalizes exactly `nextFocus`'s intuition — each utterance has a ranked
list of "forward-looking centers" (candidate referents) and a single "backward-looking center" (Cb,
the standing topic); pronouns preferentially realize the Cb, and a discourse is "coherent"
(CONTINUE) when the Cb persists across turns, versus SHIFT when it changes. `nextFocus`'s rule — a
newly-resolved entity becomes focus unless it's not focus-worthy AND a standing focus-worthy entity
already exists — is a two-rule, hand-specialized approximation of centering's
ranking-plus-Cb-continuity preference, with `FOCUS_WORTHY_CLASSES` doing the work centering theory
would do with a general salience/grammatical-role ranking. This is a genuine, cheap, low-risk
opportunity distinct from the Winograd frontier above: a typed discourse record could adopt
centering's Cb/Cf vocabulary directly (rank forward-looking centers by graph-relation salience, not
just recency; track Cb continuity as a coherence signal for scoring which discourse-deixis reading
is more likely) — giving existing ad-hoc code real theoretical grounding, not new capability.
Small, citable, and worth doing as an extension of the existing discourse-record track rather than
as new scope.

The C2 number will never be pretty; its job is to stay on the record as the boundary of the
machine.

## 5. Using this document

Everything above is a citation trail and an honest "not yet," not a commitment. A future PLAN that
wants to open the frame-problem/open-world front, the 2M-word ontology front, the symbolic
dependency-parsing front, or the Winograd-coreference front should cite the relevant section here
rather than re-deriving the literature review from scratch. If a section's state changes — a
speculative angle gets spiked, a citation gets superseded — update it here, in the one place these
four fronts live, rather than forking the discussion back out into a new plan-local essay.
