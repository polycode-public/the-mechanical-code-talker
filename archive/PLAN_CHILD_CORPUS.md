# PLAN_CHILD_CORPUS.md — a wider default corpus, selected by age of acquisition

Status: DELIVERED — the lazy triples pack (`corpus/child/`) ships AND the chat miss-cascade
consumes it. The operator's framing was "all the concepts known to an 8 year old child in the
top 10% of the Dutch education system". That sentence names a real want and an unbuyable
dataset; this doc separates the two.

Delivered (2.7.0 wave): the child slice ships as a lazy learn-on-miss TRIPLES pack through the
pack mechanism — keyword-indexed shards keyed on `normFactTerm`, one shard loaded per clean
miss — NOT a bulk init import. Build `npm run gen:child-corpus`; loader + provider seam in
`src/adapters/corpus/child-pack.mjs` (`registerChildPackProvider`, env `TMCT_CHILD_PACK_DIR`);
pure contract in `src/domain/child-pack.mjs`; trust half in `src/domain/memory/trust.mjs`
(`child:conceptnet:<term>` → corpus tier, 0.7). The chat miss-cascade wiring is live:
`src/services/chat.mjs`'s clean-miss gate consults the child pack FIRST (triples before the
reference pack's prose), appends the term's triples under `child:conceptnet:<lemma>` provenance
and re-answers the question from the store; both packs missing leaves the honest miss
byte-identical (read contract: `corpus/child/README.md`; pins: `test/corpus/reference.jsonl`'s
`reference.child.*` keys + `test/adapters/chat-child-lane.test.mjs`). Acceptance numbers are
measured by `npm run measure:child-corpus` and stamped into that README.

## Why

The human persona runs on **664 hand-written facts** (`corpus/tier2/human.jsonl`). The
ConceptNet slice next to it is 44,947 lines and answers almost nothing about the everyday
world, because it was never meant to: `filter-dump.mjs` keeps a row only if an endpoint
matches a **~90-term tech seed** (`fetch-slice.mjs`'s `SEED_TERMS`).

Measured, and it is the whole argument:

- `CapableOf` edges in the slice: **231**. To `fly`: **zero**.
- What they are instead: `browser -> search_internet`, `bike -> crash`, `annoying_person -> bug`.
- Things that can fly in the ENTIRE shipped corpus: **one** — `bird`, from `tier2/human.jsonl`.
- Kinds of bird seeded: **2**. `owl` (`tier2/human.jsonl:430`) and `swift`
  (`conceptnet/slice.jsonl:13328`). Neither is recorded as flying.
- `swift` is only there because "Swift" is a programming language and matched the tech seed. The
  slice carries `swift RelatedTo programming_language`, `compiled`, `multi_paradigm` alongside
  `swift IsA bird`. The one extra bird in the corpus arrived by accident.
- Capabilities on those birds: **one** — `owl CapableOf hunt_at_night` (`human.jsonl:431`). `swift`
  has none.
- `ostrich`: absent.

So the defeasible-negation work (`archive/PLAN_DEFEASIBLE_NEGATION.md`) lands on a store that cannot
demonstrate it. Its base-rate answer — *"of the 5 kinds of bird I know, 3 fly, 1 doesn't, and
1 I have nothing on"* — is correct, obeys every rule, and reads *"of the 2 kinds of bird I
know, 0 fly, 0 don't, and 2 I have nothing on"* on a fresh install. The engine is not thin.
The seed is.

## What cannot be bought, stated first

**"Top 10% of the Dutch education system" is not a published cut.** Vocabulary norms are
distributed by age or grade, never by percentile. The real Dutch reference is Schrooten &
Vermeer, *Woorden in het basisonderwijs* (~15k words, frequency-ranked for primary school);
there is no top-decile slice of it. A bright 8-year-old's vocabulary is approximately a
typical 10-11-year-old's — which makes "top 10%" a **threshold knob**, not a dataset.

**It is Dutch; tmct is English.** Translating a word list loses the thing we want: concepts,
not tokens.

**A word list gives words. tmct needs triples.** This is the one that decides the design.
Filtering to child-known concepts populates `penguin`, `ostrich` and `fly` as *terms*. It does
not produce `penguin CapableOf fly = false`. The list is a **filter over a knowledge base**,
never a source.

## What can be built

Swap the tech seed for an age-of-acquisition seed and regenerate. The pipeline already exists
and this is the shape of work it already does:

- `corpus/conceptnet/fetch-slice.mjs` — `SEED_TERMS`, `CANONICAL_RELS`, `FILTERED_RELS`.
- `corpus/conceptnet/filter-dump.mjs` — stream-filter: seed match + canonical relations +
  budget. Its own header: *"at least ONE endpoint's bare term is in the ~90-term tech seed
  list"*. That line is the change.
- `corpus/conceptnet/quality-filter.mjs` — the second pass that strips ConceptNet's
  crowd-sourced sentence-fragment "concepts" and opinion rows. Already written, already needed
  more at child scope than at tech scope.

**The seed list.** Kuperman et al. (2012) age-of-acquisition norms: 30,121 English words with
rated AoA. `AoA <= 8` is a defensible "what an 8-year-old knows"; raising the threshold is the
top-decile knob, made explicit as a number rather than hidden in a claim about Dutch
schooling. Dale-Chall (3,000 words known by 80% of US 4th-graders) is the cruder free
fallback. Both are word lists, so both are seeds, not sources — see above.

## The two blockers, before any of it

**1. Licensing.** `corpus/conceptnet/LICENSE-NOTICE` already states the position: the slice is
CC-BY-SA 4.0, **not** this repo's MPL-2.0. CC-BY-SA is viral, so widening what ships under it
is a decision about the package, not just about data volume. `corpus/LICENSES.json` +
`scripts/check-licences.mjs` gate the dependency tree today; the corpus notices are separate
and hand-maintained. Whatever AoA list is chosen needs its own licence cleared and its own
notice. **Settle this before fetching anything.**

**2. It needs the full dump.** The committed slice is already filtered, so a wider seed cannot
be applied to it — re-filtering a tech slice by a child seed yields the intersection, which is
nearly empty. This requires the real ConceptNet dump, offline, and `init:xxxl` is already
documented as unreachable "from data in hand" for exactly this reason.

## What a wider seed does not fix on its own

Even with a perfect child-concept seed, ConceptNet's `CapableOf` coverage is sparse
everywhere — 231 edges across a 45k-row slice is not a tech-filter artifact alone. And
ConceptNet asserts `/r/NotCapableOf` upstream, but `conceptnet-map.toml` declares "the
canonical closed set of 34" with **no `/r/Not*` rows**, and the loader treats an unmapped
relation as a hard error (a deliberate drift guard). So negatives do not arrive by widening
the seed either — they need a mapping decision first.

Which means: a wider corpus makes the base rate *real* (5 kinds of bird instead of 1), and
makes the positive default *findable* (`bird can fly` from data rather than one hand-written
row). It does not, on its own, produce the penguin. That still comes from a taught fact, which
is what tmct is for.

## Sequence (delivered)

1. DONE — licence settled. The published age-of-acquisition lists were both ruled out for a
   public MPL-2.0 package: Kuperman 2012's original terms could not be verified and the same
   Ghent lab's sibling AoA norms are stated non-commercial/research-only; the Dale-Chall 3,000
   is a 1995 copyrighted compilation with no verifiable distribution grant. So the seed is a
   maintainer-owned, hand-authored child-concept list (MPL-2.0, copies no external list) — the
   evidence and decision are in `corpus/conceptnet/child-seed.mjs`. The shipped triples are
   ConceptNet-derived and carry CC-BY-SA-4.0 (`corpus/child/LICENSE-NOTICE`, `corpus/LICENSES.json`).
2. DONE — `corpus/conceptnet/child-seed.mjs`: `CHILD_SEED_TERMS` beside `SEED_TERMS`, with
   `CHILD_AOA_TARGET_YEARS` as the named "top-decile knob".
3. DONE — `scripts/fetch-child-corpus.mjs` streams the cached full dump through
   `filter-dump.mjs`'s reusable `scanAssertions` + `quality-filter.mjs`'s `cutReason`. The
   quality pass did matter more (it cut 6,587 rows at child scope).
4. DONE — `/r/NotCapableOf` joined `conceptnet-map.toml` as one deliberate mapping onto tmct's
   own polarity (`mgxneg:capableOf`); every other `/r/Not*` still hits the loader's hard error.
   It yielded 42 corpus negatives — the first data the defeasible-negation reader can stand on.
5. DONE — measured by `scripts/measure-child-corpus.mjs` (the script IS the acceptance test).
   On the built pack: 1,881 kinds of bird (baseline 2), 71 capabilities on birds, 39 things that
   can fly. Numbers stamped into `corpus/child/README.md` and the manifest's `acceptance` block.

## Related

- `archive/PLAN_DEFEASIBLE_NEGATION.md` — the reader work this corpus would feed. Its case 4 is
  correct and inert today; a wider seed is what makes it say something.
- `PLAN_CONSISTENCY_CHECK.md` — a consistency service is only as useful as what it holds. This
  is the same gap seen from the other end.
