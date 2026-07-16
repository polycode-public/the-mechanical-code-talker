# PLAN_PARAPHRASE_VERIFICATION.md — verifying a paraphrase against the graph before showing it

Status: RESEARCH / DESIGN — the general verifier this document designs is not yet implemented.
One narrow slice of the same ROADMAP goal already shipped separately and predates this doc:
`src/domain/paraphrase.mjs` (`verifySubClassParaphrase`, isa-family only, closure-backed, with
`test/paraphrase.test.mjs`). The multi-technique `verifyParaphrase(originalFactRow,
candidateText, technique)` below remains unbuilt and does not reuse that slice yet.

## Origin

`ROADMAP.md`'s "Ambition" section states three declared, not-yet-achieved goals. The third, quoted
verbatim (`ROADMAP.md:26-30`):

> **Paraphrase alongside the original, verified, never instead of it.** A surface-realization variant
> sits next to the literal grounded answer, never replacing it, and its accuracy is checked, not
> assumed — by running tmct's own deterministic inference/consistency machinery (`src/domain/syllogise.mjs`)
> against both the original and the paraphrase: they must entail the same conclusions, and neither may
> contradict the other sentence-by-sentence.

`archive/PLAN_BREADTH_FIRST_NLU.md`'s own "Status" section, after listing everything shipped, names two items
as genuinely open (`archive/PLAN_BREADTH_FIRST_NLU.md:20-21`):

> Two items are genuinely open, not yet started: (c) the paraphrase-verified-via-`syllogise.mjs` piece
> of "Ambition"; (d) a real "list/count all X of class Y" query shape for memory-graph classes via
> `ask.mjs` alone (§5b's documented gap).

This document is the design for item (c). That one paragraph in `ROADMAP.md` is the entire existing
design — nothing deeper exists anywhere in the repo. The rest of this document works out how it
actually has to run.

## Summary of the finding

The `ROADMAP.md` framing — "verified... by running... `src/domain/syllogise.mjs`... they must entail the
same conclusions" — describes `syllogise.mjs` as a general consistency checker over two arbitrary
sentences. It is not. `syllogise.mjs`'s entailment machinery forward-chains over the stored fact
graph's `rdfs:subClassOf`/`rdf:type` edges; it has no notion of "sentence" at all. For the paraphrase
shapes tmct can actually generate today (a single content word swapped for a verified WordNet-synset
sibling, or a possessive-pattern reordering), the right check is **triple equality**, not entailment
closure — computed directly, without calling `syllogise.mjs`. `syllogise.mjs`'s real closure kernels
(`findIsaChain`, `deriveSubClassClosure`) do fit one specific, narrower sub-case: a paraphrase that
swaps a class for a taught superclass/subclass along the `⊑` hierarchy rather than a same-sense
synonym. That sub-case isn't something tmct's shipped generator produces yet. Part 3 below works out
why, and Part 4 gives the concrete contract for both cases.

## Part 1 — what `src/domain/syllogise.mjs` actually does

`syllogise.mjs`'s own header states its scope precisely (`src/domain/syllogise.mjs:1-12`):

> tmct's speculative-inference engine... forward-chain entailments over the OWL-labelled memory graph
> so a future query-time MISS becomes a lookup. The MATERIALIZING pass (`syllogise()`, below) is NEVER
> on the chat hot path... The PURE kernels it's built from (`deriveSubClassClosure`/
> `deriveTypePropagation`) are plain, I/O-free functions, so a caller may also reuse them for a small,
> bounded, READ-ONLY live check... without that being "the batch pass on the hot path".

Five rules ship today (`src/domain/syllogise.mjs:14-53`): `scm-sco` (subClassOf transitivity),
`cax-sco` (type propagation across a subclass chain), `cax-dw` (disjointness violation),
`cls-svf1` (someValuesFrom application), `scm-svf1` (someValuesFrom subsumption). Every exported
function (`src/domain/syllogise.mjs:191-1360`, confirmed by grep for `^export function`) takes plain
**edge arrays** — `[[a, b], …]` pairs of already-normalized term strings — never a memory directory,
never raw sentence text, never a graph object:

- `deriveSubClassClosure(edges, { depth, budget, focus })` (`src/domain/syllogise.mjs:221`) — fixpoints
  `rdfs:subClassOf` edges into their transitive closure.
- `deriveTypePropagation(typeEdges, subClassEdges, { budget, focus })` (`:318`) — propagates
  `rdf:type` up a subclass chain.
- `findIsaChain(subj, targets, typeEdges, subClassEdges, { maxHops })` (`:1322`) — a bounded,
  breadth-first, single-query proof search: "does `subj` reach one of `targets` via a taught
  type-then-subclass chain, in at most `maxHops` hops?" Its own doc comment: "Pure, no I/O,
  deterministic given the same edge lists" (`:1319-1320`).

`src/chat.mjs` already reuses these live, read-only, outside the batch pass — the exact precedent
this design leans on. At `src/chat.mjs:5785-5798`, the ISA proof-chase builds edge arrays straight
from `readFactRows`-derived rows:

```js
const chainSubClassEdges = chainSubClassRows.map((f) => [f.subject, f.object]);
const chainTypeEdges = chainTypeRows.map((f) => [f.subject, f.object]);
const chain = findIsaChain(subj, objVariants, chainTypeEdges, chainSubClassEdges, { maxHops: 2 });
```

This confirms the answer to the task's central question: `syllogise.mjs`'s functions operate on
**edge arrays supplied by the caller**, not exclusively on facts already stored in the graph. A
caller can splice a synthetic edge — one that doesn't exist in the graph, derived from a candidate
sentence — into that array before calling `findIsaChain`/`deriveSubClassClosure`. That is the
mechanism by which `syllogise.mjs` could ever touch a paraphrase at all: not by asking it "are these
two sentences consistent," a question it has no vocabulary for, but by asking it "does this specific
synthetic edge sit in the taught `⊑`-closure of that other edge" — a much narrower, well-defined
question its kernels already answer for real callers today.

What `syllogise.mjs` cannot do, and was never built to do: parse a sentence, compare two arbitrary
statements for equivalence, or check "no new claim was introduced." It has zero code that reads
English. Turning a paraphrase into something `syllogise.mjs` can even look at is a separate,
necessary step — Part 3.

## Part 2 — where paraphrase candidates come from today

`archive/PLAN_BREADTH_FIRST_NLU.md` §6a scoped exactly this generation problem (`archive/PLAN_BREADTH_FIRST_NLU.md:
327-341`): a combinatorial surface-variant expansion using the ACE grammar's 8 patterns
(`src/domain/grammar/ace.mjs`), the existing lexicon, and real WordNet synset data, self-verified before
being committed. It shipped, partially, and was archived (`archive/PLAN_TEMPLATE_COVERAGE.md:1`):
"harness + generator + first corpus batch shipped; growing coverage further and wiring the corpus
into the live answer path remain real, undone follow-ons."

What actually exists (`scripts/generate-template-variants.mjs`, 277 lines, confirmed read in full):
three mechanical techniques, every row self-verified by re-parsing through `parseAce`
(`src/domain/grammar/ace.mjs`) before being written — a row that doesn't re-parse is dropped, never
committed (`scripts/generate-template-variants.mjs:9-10`):

1. **Rescue** (`generateRescues`, `:87-131`) — a docs-corpus sentence with exactly one word
   `parseAce` doesn't recognize gets that word swapped for a WordNet-synset sibling that's *also*
   already declared in tmct's own lexicon, for the same part of speech.
2. **Variant** (`generateVariants`, `:148-188`) — the same synonym-swap technique applied to
   sentences from `corpus/tier2/human-examples*.jsonl` that already hit `parseAce` outright.
3. **Alt-phrasing** (`generateAltPhrasings`, `:192-223`) — the possessive pattern (#7) is the one
   place the ACE grammar itself declares two surface forms for the identical triple (`"X's Y is Z"`
   / `"the Y of X is Z"`, both routed through `buildPossessive`); this generates the sentence's
   untried form and verifies it re-parses to the same triple shape.

The committed output, `corpus/generated/ace-surface-variants.jsonl` (17 rows, confirmed by
`corpus/generated/manifest.json`), is real: e.g. `"the piece has a fast rhythm"` →
`"the piece has a fast beat"` (`rhythm`/`beat`, WordNet synset `07100710-n`). Its own README states
the honest scope (`corpus/generated/README.md`): "This corpus is not loaded by `src/chat.mjs`/
`src/domain/ask.mjs` or any other product code — it is committed raw material... Wiring it into live answer
rendering is a separate, future phase."

**The gap this design has to close, stated plainly**: that 17-row file is generic prose (docs +
WordNet examples), disconnected from any specific live chat answer. It proves the *technique* works
and is self-verifying. It is not a per-answer paraphrase generator. A live "paraphrase alongside the
original" feature needs the *same technique* — synonym-swap-with-independent-lexicon-membership,
self-verified before being shown — applied on demand to the specific sentence a chat turn is about
to render, not consumed from the static file. This document treats **adapting
`scripts/generate-template-variants.mjs`'s substitution technique into a live, per-answer call** as a
real, named prerequisite (Phase 1 below), not something already available to import.

One more existing mechanism, checked and ruled out as the vehicle here: `src/domain/answer-variants.mjs` /
`src/domain/answer-variants.json`. Its own header is explicit about scope (`src/domain/answer-variants.mjs:5-13`):
"A SMALL, curated, committed table... of safe cosmetic/locational/connector-word rephrasings for a
deliberately narrow set of answer templates... never a relation verb..., never an entity id/label/
path." It swaps words like "defined in" → "located in" — connective glue around a code-graph answer,
never the subject/predicate/object content itself. Because it never touches the triple, it needs no
verification against anything; the triple literally cannot change. It solves a different, smaller
problem (surface variety in `ask.mjs`'s code-graph templates) than the Ambition paragraph's
"paraphrase... verified... entail the same conclusions" framing, which is clearly about a variant
that *could* have drifted in meaning and therefore needs checking. This design is about that second,
harder case: the memory-graph fact answers rendered by `factPhrase`/`renderFactLine`
(`src/chat.mjs:4156-4185`), where a paraphrase touches real content words.

## Part 3 — what "entail the same conclusions" means for a sentence, concretely

**The original answer already has its triple; it does not need parsing.** `renderFactLine`
(`src/chat.mjs:4156`) renders every fact answer from a stored Fact row —
`{subject, predicate, object, provenance}` — through `factPhrase`, which looks up a fixed connector
phrase in `FACT_PREDICATE_PHRASES` (`src/chat.mjs:4022-4052`, ~30 entries, e.g.
`"rdfs:subClassOf": "is a kind of"`, `"mgx:hasA": "has"`, `"mgx:usedFor": "is used for"`). The
sentence the user sees ("dog is a kind of animal") is a template fill, not free English that has to
be parsed back into a triple to recover its meaning — the triple is sitting right there in the Fact
row that produced the sentence. This matters, because it removes an entire failure mode: there is no
need to round-trip the *original* answer through a parser to find out what it claims.

**The candidate paraphrase is the side that needs checking.** Two shapes exist, matching Part 2's two
mechanisms:

- **Content-word substitution** (Rescue/Variant technique): the paraphrase differs from the rendered
  original by exactly one whole-word swap, in the subject term or the object term (never the fixed
  `FACT_PREDICATE_PHRASES` connector — swapping that would change the predicate, which is exactly
  the "no new claim" violation this design has to catch). Because the swap position is known (it's
  the position the generator itself substituted), **no reparse is needed here either**: the
  candidate's implied triple is reconstructed directly — same `{subject, predicate, object}` as the
  original, with the one swapped slot replaced by the new term.
- **Alt-phrasing** (possessive-pattern reordering): a genuine word-order change, not a word swap.
  Here `parseAce` earns its place: parse the candidate sentence, and the resulting triple must
  deep-equal the original Fact row's triple (after `normFactTerm`, `src/adapters/memory/core.mjs:1204-1211`,
  which strips CURIE prefixes, articles, and case — the same normalization the graph itself uses for
  term identity).

**Why `parseAce` is not a safe universal round-trip for the original side.** `FACT_PREDICATE_PHRASES`
has roughly 30 connector phrases (`"is found in"`, `"can be prevented by"`, `"is a way to"`, …);
`parseAce`'s 8 patterns dispatch on a much narrower set of literal surface cues (`"every"`, a
leading possessive, `"the … of … is"`, a bare `"is"`, or a declared verb — `src/domain/grammar/ace.mjs:
444-457`). `archive/PLAN_TEMPLATE_COVERAGE.md`'s own measured baseline is blunt about the gap: 0 of
2,949 real docs sentences hit `parseAce` outright (60.4% got "shape-only" residue hits, 39.6%
missed entirely). Nothing says a `factPhrase` rendering using an arbitrary
`FACT_PREDICATE_PHRASES` connector will happen to match one of `parseAce`'s 8 literal shapes. Relying
on "reparse the rendered original sentence through `parseAce`" as the general mechanism would
silently fail open or fail closed on most predicates — a real risk this document is naming rather
than discovering during implementation. Reconstructing the original's triple from the Fact row
directly (which is already correct, by construction) sidesteps that risk entirely.

**Was `scripts/extract-facts-from-text.mjs`'s recognizer considered?** Yes, and ruled out for this
specific job. It reuses `runTurn` (`src/chat.mjs:4604`/`8922`) against a real or ephemeral memory
directory (`scripts/extract-facts-from-text.mjs:91-99`) — broader than `parseAce` alone (it also
covers the teach lane's "natural frames," e.g. general-verb-teach shapes `parseAce` doesn't reach),
but it does real `fs` I/O and writes into a memory graph (even an ephemeral scratch one) to determine
recognition. Calling that once per candidate paraphrase, on a live chat turn, is a heavier and
side-effecting operation than this design needs: the paraphrase's implied triple is already
recoverable directly (content-word case) or via the much lighter `parseAce` (alt-phrasing case).
`runTurn`-based recognition is the right tool for extracting facts from an unstructured document; it
is not the right tool for verifying a mechanically-generated one-word variant of a sentence tmct
itself just rendered.

## Part 4 — the verification contract

Given an original answer (`{subject, predicate, object, provenance}`, already grounded and cited)
and one candidate paraphrase (rendered text), the paraphrase is shown only if **every** check below
passes. All are cheap, synchronous, and pure — no graph write, no batch pass.

**Check 1 — provenance-of-generation.** The candidate must come from a recognized generation
technique (Part 2/5): content-word substitution or alt-phrasing. A candidate with no recorded
generation technique is rejected outright — this is a closed-set generator, not open text, so
"where did this string come from" is always answerable, and an unanswerable one is refused rather
than guessed at.

**Check 2 — connector integrity (content-word case only).** The fixed `FACT_PREDICATE_PHRASES`
connector text must appear byte-identical in the candidate. If the connector changed, the predicate
changed, which is a different claim — reject.

**Check 3 — single-slot, verified-synset substitution (content-word case only).** Exactly one of
subject-term or object-term differs from the original. The replacement word must be an *independently
re-verified* member of the same WordNet synset as the original word, for the same part of speech
(recompute via `scripts/lib/wordnet-synonyms.mjs`'s `synsetsFor` at verification time — never trust
a flag the generator set, the same "verify, don't just re-render" discipline `retractSubClassOf`
already uses for retraction, `PLAN_SYLLOGIST.md`'s §3), **and** that replacement word must already be
declared in tmct's own lexicon for that part of speech (`src/domain/grammar/lexicon-core.json`, the same
"both ends of the swap are tmct's own curated vocabulary" rule `generate-template-variants.mjs`
already applies at generation time, `scripts/generate-template-variants.mjs:15-18`). This is the
"no new claim introduced" check: the replacement term must be a recognized synonym of a term tmct
already asserts the same relation about, never an unrelated or broader/narrower term smuggled in
under the paraphrase label.

**Check 4 — triple deep-equality (alt-phrasing case only).** Parse the candidate through `parseAce`.
It must hit (produce at least one triple, `src/domain/grammar/ace.mjs:444`). The resulting
`{subject, predicate, object}`, each normalized via `normFactTerm`, must deep-equal the original Fact
row's own normalized triple. A candidate that parses to a *different* triple, or that fails to parse
at all, is rejected — never shown degraded, never shown with a caveat.

**Check 5 (the one case that touches `syllogise.mjs`) — hierarchy-shift paraphrases, if/when they
exist.** Not produced by any generator that ships today (Part 2/5 confirm the current techniques are
same-synset swaps only, never a hypernym/hyponym crossing). If a future generation technique produces
a paraphrase that swaps a class for a taught superclass/subclass (e.g. an original `dog rdfs:subClassOf
animal` paraphrased toward `dog rdfs:subClassOf creature`), same-synset equality (Check 3) is the
wrong tool — `creature` is not `animal`'s synonym, it's its taught superclass. This is where
`findIsaChain` earns its place, reusing `src/chat.mjs:5785-5798`'s exact live-chase pattern: build
`subClassEdges`/`typeEdges` from `readFactRows`, splice in the *candidate's* synthetic edge
(`[candidateObject, originalObject]` or the reverse), and call
`findIsaChain(candidateObject, [originalObject], typeEdges, subClassEdges, { maxHops: N })`. A chain
found means the candidate's claim is a taught generalization/specialization of the original — an
entailment relationship, checked with the actual entailment engine, exactly matching `ROADMAP.md`'s
"entail the same conclusions" language for this one sub-case. No chain means reject: an unrelated or
untaught class swap is not a safe paraphrase. This check is scoped as **not required for Phase 1**
(no generator produces this shape yet) but designed now so a future hierarchy-aware generator has a
concrete, already-specified verification path rather than needing this document rewritten.

**On "neither may contradict the other sentence-by-sentence"** (`ROADMAP.md`'s other clause): for a
single-fact answer (the only shape in scope here — see Non-goals), a paraphrase is one sentence
against one sentence, so this reduces to Checks 2-4 directly. Multi-sentence answers (a listed set of
facts, `whatElseAnswer` and similar) would need each paraphrased sentence checked against its own
source sentence independently, in order — flagged as a real, un-designed extension in Open
risks below, not attempted here.

## Part 5 — failure and reject handling

A candidate that fails any check in Part 4 is **never shown**, not shown with a hedge, not shown
degraded. This matches tmct's existing "grounded or an honest miss" ethos (`CLAUDE.md`) — a paraphrase
is optional decoration next to an already-correct answer; showing a wrong one is strictly worse than
showing none, since the literal grounded answer is already on screen and carries the real claim.

**Logging, not silent drop.** Every rejected candidate is worth keeping as a data point — a
generation technique that fails verification often is a signal the technique itself needs tightening
(the same spirit as `archive/PLAN_TEMPLATE_COVERAGE.md`'s own "the harness ran, found real rescue
candidates, and correctly reported that none of them cleared the bar — that's a genuine zero-yield
result, not a harness shortfall"). Append rejected `{original, candidate, technique, failedCheck}`
rows to a maintainer-only log file under `corpus/generated/` (mirroring the existing
`ace-surface-variants.jsonl` convention), never surfaced to a chat user, reviewed the same way a
maintainer already reviews `template-coverage.mjs`'s miss/residue buckets. This is diagnostic
tooling, not a product-path file — same "never imported by `src/`/`bin/`, never run by `npm test`"
discipline every `scripts/generate-*`/`scripts/*-coverage.mjs` file already follows.

**A passed candidate is shown, always alongside the original, never replacing it** — the Ambition
paragraph's own explicit constraint, and the reason this whole mechanism exists: showing paraphrase
variety is worthless if it ever risks being the ONLY thing shown and it turns out wrong.

## Phased implementation plan

**Phase 1 — Live single-slot generator.** Extract `substituteWord` and the synset-lookup +
lexicon-membership logic already proven in `scripts/generate-template-variants.mjs:63-186` into a
small, importable, pure function: given a Fact row and its rendered `factPhrase` text, return zero or
one candidate paraphrase (content-word substitution only — Check 3's shape). Unit-tested against
real Fact rows, no chat wiring yet. Exit criterion: for a representative sample of stored facts
across several `FACT_PREDICATE_PHRASES` predicates, the generator produces at least one verified
candidate for a plausible fraction (report the real number, don't presuppose one), and zero
unverified candidates ever escape the function (every returned candidate has already passed Checks
1-3 internally, by construction — see Phase 2 for why an independent re-check still runs at the call
site).

**Phase 2 — The verification function, independent of generation.** A separate, standalone
`verifyParaphrase(originalFactRow, candidateText, technique)` function implementing Checks 1-4 from
Part 4, called on ANY candidate regardless of which generator produced it (never trusting Phase 1's
own internal check as the only gate — matching `retractSubClassOf`'s "verify, don't just walk"
discipline cited in Part 4, Check 3). Unit-tested with hand-built pass and fail cases for each check,
including adversarial ones (a candidate that swaps the connector, a candidate that swaps an unrelated
word not from the same synset, a candidate with two swaps instead of one).

**Phase 3 — Chat wiring, single-fact answers only.** Wire Phases 1-2 into the single-fact answer
path (`renderFactLine`'s callers), gated behind a check that the fact's predicate has a
`FACT_PREDICATE_PHRASES` entry (Check 2 needs one to exist). A verified paraphrase renders on its own
line under the original, clearly labeled (e.g. "also: …") — exact wording is a Phase 3 UX decision,
not fixed here. Exit criterion: a live chat turn that gets a single-fact answer sometimes shows a
verified paraphrase beneath it; a turn whose only candidate fails verification shows the original
alone, with the rejection logged per Part 5.

**Phase 4 — Alt-phrasing technique + `parseAce` reparse path.** Add the possessive-pattern
alt-phrasing generator (reusing `generateAltPhrasings`'s existing logic,
`scripts/generate-template-variants.mjs:192-223`) as a second live candidate source, verified via
Check 4 (`parseAce` reparse + triple deep-equality). Exit criterion: a possessive-pattern fact answer
(`"X's Y is Z"` rendering) can show its `"the Y of X is Z"` alternate, verified, alongside the
original.

**Phase 5 — Hierarchy-shift generation + `syllogise.mjs` Check 5 (only once a real generator for this
shape exists).** Explicitly deferred until a generation technique that produces class-hierarchy-shift
paraphrases is designed and scoped — not attempted in Phases 1-4. When it lands, wire Check 5's
`findIsaChain` splice exactly as specified in Part 4.

Each phase keeps `npm test` green; nothing here touches the chat hot path until Phase 3, and even
then only as an additive, independently-failable branch (a verification failure or exception degrades
to "no paraphrase shown," never to a broken answer).

## Non-goals

- **No LLM anywhere in this generation or verification path.** Every technique here is closed-set
  mechanical substitution (WordNet synset membership, tmct's own lexicon, `parseAce`'s fixed grammar)
  or a bounded graph-edge chase (`syllogise.mjs`'s pure kernels). This is a permanent charter
  constraint (`ROADMAP.md`, `CLAUDE.md`'s "LLMs are allowed ONLY in the offline eval harness"), not a
  scoping choice specific to this document.
- **Not a general paraphrase generator.** This produces exactly the shapes Part 2/4 describe
  (single-slot synonym swap, possessive reordering, and — Phase 5 only — a taught hierarchy shift).
  Passive voice, nominalization (`destroy`↔`destruction`), and multi-word restructuring are explicit
  non-goals of the underlying generator (`archive/PLAN_TEMPLATE_COVERAGE.md`'s own stated scope) and
  inherited here unchanged.
- **Not multi-sentence answer paraphrasing.** Scoped to single-fact answers only (Part 4's closing
  note). A listed multi-fact answer (`whatElseAnswer` and similar) is a real, separate extension,
  named in Open risks, not designed here.
- **Not a `syllogise.mjs` consistency-checker for arbitrary sentence pairs.** Part 1's finding stands:
  `syllogise.mjs` has no sentence-level API and this document does not propose building one. Its
  edge-array kernels are reused for exactly one narrow, already-scoped sub-case (Check 5).
- **Not wiring `corpus/generated/ace-surface-variants.jsonl` directly into the answer path.** That
  file is generic proof-of-technique raw material (Part 2); this design calls the *same substitution
  logic* live, per answer, not that static file.

## Open risks / questions

- **Coverage.** No measurement yet of what fraction of real stored facts have a content word whose
  WordNet synset also contains an independently-tmct-declared sibling (the same "coincidence" gap
  `archive/PLAN_TEMPLATE_COVERAGE.md` found for the Rescue technique: 0/8 residue words rescued,
  because tmct's lexicon rarely happens to declare two words from the same synset). Phase 1's exit
  criterion asks for the real number rather than assuming one; this may turn out to be a low-yield
  feature for the same structural reason the coverage harness already found.
- **UX for a rejected/no-candidate turn.** Silently showing nothing extra (Part 5) is the safe
  default; whether a maintainer-facing signal ("no safe paraphrase found") belongs anywhere user-
  visible is a Phase 3 decision, not resolved here.
- **Multi-sentence answers**, named above, are real and common in practice (`whatElseAnswer`) but
  out of scope for this document's phases.
- **Where the rejection log lives and how it's reviewed** is sketched (Part 5) but not fully
  specified — exact file location and format are a Phase 1/2 implementation decision.
