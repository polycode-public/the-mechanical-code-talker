# PLAN_DEFEASIBLE_NEGATION.md — negative facts, source-indexed, and the base rate

Status: DELIVERED. Built and driving; this file is the record of the design and what the
probe found, kept for the reasoning rather than as work to do.

## Why this exists

tmct refuses to store a negative today. `src/services/chat.mjs`'s general-verb teach
declines `"a penguin cannot fly"` outright, and its own comment gives the reason:

> "cannot" would mint a nonsense mgx:cannot fact whose read-back silently INVERTS the
> taught meaning — the vocabulary has no negative-capability predicate, so an honest
> decline is the only correct move.

That reasoning assumed a read-back has to **invert or pick**. It doesn't. It can **quote**.

The operator's framing, which is the whole design:

> From source corpus-A I read that Y is Z. From the visitor-B I read Y is not Z.
> It is not a contradiction when we include the source in context.

Two claims are contradictory only if they cannot both be true. Once each is indexed to its
source, *"corpus-A asserts P"* and *"visitor-B asserts ¬P"* are both true at once — they are
**consistent**. The disagreement is between the sources, not inside the knowledge. That is
what RDF named graphs / quads buy, and tmct already has it: `mgx:statedBy`
(`src/adapters/memory/core.mjs`) is documented as *"one edge per independent source —
replaces the factProvenance union"*.

## The starting state, verified live at `c409688`

| Input | Today |
|---|---|
| `remember that a bird can fly` | stores `mgx:capableOf(bird, fly)` — and MERGES with the corpus's own `/r/CapableOf` fact: one id, unioned sources |
| `remember that a penguin is a bird` | stores `rdfs:subClassOf` |
| `can a bird fly` | `yes — you told me: bird can fly (source: corpus:human /r/CapableOf \| ace:chat:…)` |
| **`can a penguin fly`** | **misses entirely — capability does NOT inherit across subClassOf** |
| `a penguin cannot fly` | declines (the guard above) |
| `what is a kind of bird` | `owl is a kind of bird (source: corpus:human /r/IsA)` — the seeded corpus already carries bird subclasses |

**The Tweety problem does not arise yet.** The default does not inherit, so there is nothing
for a negative to override. Inheritance comes first, or the override has no target.

## The four cases — one mechanism, resolved most-specific-first

| # | Question | Store holds | Required answer |
|---|---|---|---|
| 1 | `can a bird fly` | direct positive | `yes — you told me: bird can fly` (unchanged) |
| 2 | `can a penguin fly` | direct negative + inherited positive | **no** — the fact ABOUT PENGUIN wins, and the answer NAMES the default it overrides |
| 3 | `can a penguin fly` | corpus says can, visitor says cannot, SAME specificity | report BOTH with their sources; do not pick |
| 4 | `can an ostrich fly` | nothing about ostrich; ostrich isa bird | `an ostrich is a bird, and of the 5 kinds of bird I know, 3 fly, 1 doesn't, and 1 I have nothing on` |

Case 4 answers **neither yes nor no**. It reports the class, the count and the split, and
lets the reader conclude. That is the only reading of "birds fly" that survives a penguin.

## The rules that make it honest

These are constraints, not preferences. Each one is a place the design could quietly start
guessing.

1. **Specificity is its own axis, ABOVE source trust.** A fact directly about penguin beats
   a fact inherited from bird **regardless of source**. Source trust only breaks ties at
   equal specificity.
   *The trap:* `SOURCE_PRIOR` (`src/domain/memory/trust.mjs`) is
   `operator 1, teach 0.95, provider 0.9, corpus 0.7, corpusWeak 0.55, web 0.4, extracted 0.45, entailed 0.3`.
   Because `entailed` (0.3) sits below `teach` (0.95), a taught negative already outranks a
   derived positive — so it LOOKS like trust solves specificity for free. It does not. Flip
   the sources (corpus says penguins can't fly; a visitor taught that birds can) and trust
   alone answers that penguins fly. That is luck, not design.
2. **The subject is excluded from its own base rate.** Asked about ostrich, count the OTHER
   kinds of bird. You do not cite ostrich as evidence about ostrich.
3. **The denominator is the subclass count** — the number of `X subClassOf bird` facts known.
   The split is over those.
4. **The split must account for every kind it counted.** Three-way: positive, negative,
   unknown. *"of the 5 kinds of bird I know, 3 fly, 1 doesn't, and 1 I have nothing on."* Say
   5 and split only 4 and the arithmetic lies about what you know.
5. **Never generalise the sample to the population.** *"of the 4 kinds of bird I know"* is a
   count it can prove. *"most birds fly"* is a claim about birds it has never seen — the same
   guess the constitution forbids everywhere else, wearing arithmetic.

## What has to be built, in order

1. **Inheritance.** Capability across `rdfs:subClassOf`, so `can a penguin fly` inherits
   bird's default. Nothing else matters until this exists. Open question for the design pass:
   query-time chase vs materialisation. The isa ladder already chases (`ISA_ASK_RE`, the
   `maxHops:2` ceiling and its "proof-chain-materialization territory" note); `syllogise.mjs`
   already has cls-svf1/scm-svf1.
2. **Storage.** A negation on the minted-predicate fold (`mgx:not-<lemma>`), each with its own
   `mgx:statedBy` edge. Must render (`FACT_PREDICATE_PHRASES` / `predicatePhrase`),
   content-address distinctly (`factIdForTriple`), and pass SHACL (`mgx:FactShape`).
   Note `owl:disjointWith` (`ontology/tmct-core.ttl`) is the ONLY negation the ontology has,
   and it is CLASS-level (`no dog is a cat`) — it does not transfer to a property.
3. **The teach frames.** `cannot` / `can't` / `can not` take different paths today (the
   general-verb teach regex has a single `[a-z]+` verb slot, so only the glued `cannot`
   reaches the guard). Plus `does not <verb>` / `doesn't <verb>`.
4. **One resolution function** every reader calls: direct-positive / direct-negative /
   inherited-positive / inherited-negative / nothing → the four answers above.
5. **The blast radius.** Every reader filtering a positive predicate must account for the
   negative, or it answers from one side while a negative from another source is held. Known
   sites: the capability readers, the derived `FORWARD_YESNO_MARKERS` /
   `REVERSE_PREDICATE_MARKERS` families (which derive only from the curated
   `FACT_PREDICATE_PHRASES`, so they are structurally blind to minted predicates), the four
   hand-written prepositional readers, and the isa ladder's own `owl:disjointWith` path.

## Pins that must be rewritten

`test/corpus/inference.jsonl` → `inference-negative-capability-never-inverts-on-readback`
(key `inference.capability.negative-teach`) asserts today's refusal: turn 0 lacks
`remembered`, turn 1 lacks `^yes`. Building this **changes a passing pin**. There is no xfail
in the corpus — a row is asserted or skipped, and nothing is skipped. Find every other pin
asserting the current decline before starting.

## The name for it

Defeasible inheritance with specificity override — the Tweety problem. The base-rate answer
(case 4) is the honest form of a generic: a syllogism whose major premise is a default, so
the conclusion is evidence rather than entailment.
