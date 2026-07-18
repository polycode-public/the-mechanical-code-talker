# corpus/child/

The lazy CHILD triples pack: everyday ConceptNet concepts a young child knows,
keyed on `normFactTerm` and loaded ONE shard at a time on a clean miss
(src/adapters/corpus/child-pack.mjs). Unlike the tech slice
(corpus/conceptnet/slice.jsonl, a bulk import), this pack is consulted lazily —
the chat miss-cascade calls the provider for a missed term, appends the term's
triples, and answers from the store.

Layout (mirrors corpus/reference/):

- `index.json.gz` — `{ term: { s, t, n } }`: shard name, canonical term key
  (a normFactTerm fixed point), fact count.
- `shards/child-00.jsonl.gz` … — one JSON row per term:
  `{ term, facts: [{ subject, predicate, object, weight? }, …] }`, sharded by
  the term's FNV-1a first byte mod 32
  (src/domain/child-pack.mjs). Each edge is keyed under BOTH endpoints, so a
  miss on a hyponym and a miss on its class each return what they need.
- `manifest.json` — the pinned dump (URL, mirror, sha256), the seed, counts,
  budgets, the acceptance metrics, and a sha256 for every emitted file.
- `LICENSE-NOTICE` — CC-BY-SA 4.0; read it before reusing these files.

47267 terms, 93161 keyed facts. Built 2026-07-18.

Predicates are already mapped into tmct's vocabulary
(conceptnet-map.toml): `rdfs:subClassOf`, `mgx:capableOf`,
`mgxneg:capableOf` (from /r/NotCapableOf — the defeasible-negation data), and
the other object properties. The weak relation (`mgx:relatedTo`) and the
ace="none" relations are dropped, so every fact sits at the corpus trust tier
(0.7); a fact learned from this pack carries a `child:conceptnet:<term>`
provenance tag (src/domain/child-pack.mjs), parsed back to a corpus Source by
memory/trust.mjs.

## The read contract (for the chat miss-cascade wave)

On a clean miss for term T:

1. compute the lookup key the SAME way the reference-pack lookup does — the
   lexicon lemma of T (`cleanMissReferenceTerm`), so one lemma fold serves both
   packs and a plural miss ("penguins") folds to its singular. The loader
   additionally normFactTerm-folds case and a leading article, so passing the
   raw term also works for those; it does NOT singularise (that is the caller's
   lemma fold, exactly as for the reference pack);
2. call the provider: `getChildPackProvider(env).lookup(k)` → `{ term, facts }`
   or `null` (a null is the ordinary honest miss — the pack never throws at a
   caller);
3. for each fact `{ subject, predicate, object, weight? }`, `appendFacts` it
   with provenance `childProvenanceTag(T)` = `child:conceptnet:<lemma>` —
   corpus tier, 0.7 (memory/trust.mjs parses it to { kind:"corpus",
   name:"conceptnet" }, the shared ConceptNet Source);
4. answer from the store (the appended edges make the base rate real: kinds of
   bird, and `bird can fly` from data rather than one hand-written row).

The pack does NOT produce the penguin's exception on its own; that still comes
from a taught fact or from a /r/NotCapableOf edge where ConceptNet happens to
carry one. A wider seed makes the base rate real and the positive default
findable; the specific exception remains what tmct is taught.

## Acceptance metrics

Measured by `node scripts/measure-child-corpus.mjs` (the script IS the
acceptance test — the plan's hand-counted baseline drifted once). Numbers below
are for this committed pack:

```
Measured over this pack: 69620 facts
  kinds of bird            1881  [abbott's booby, abyssinian woodpecker, acadian flycatcher, accipiter, acorn woodpecker, acridotheres, acrocephalus, actitis, adélie penguin, african black duck, african cuckoo hawk, african finfoot, african fish eagle, african marsh harrier, african penguin, african pygmy goose, african sacred ibis, african skimmer, aix, akiapola au]
  capabilities on birds    71  [bird can attempt to fly, chicken can become food, bird can build nest, bird can call with chirps, bird can chirp, bird can eat grasshopper, bird can experience flight, bird can eye fish, bird can fall from sky, bird can fly, bird can fly high, bird can head south, bird can kill fish, bird can land on beach, bird can land on branch, bird can land on tree, bird can learn to fly, bird can listen to insect, bird can person's pet, bird can pet]
  things that can fly      39  [animals, ants, bat, bats, bats and birds, bee, beetles, bird, butterfly, doves, dragon, dragonfly, flies, frisbee, geese, gnat, goose, helicoptors, hoatzins, insects]
  things that cannot fly   2  [bunnies, pigs]
  bird-kinds that fly      3  [goose, kite, tweety]
  bird-kinds that cannot fly 0  [(none)]
```

## Rebuild

`npm run gen:child-corpus` (reads the pinned dump from
~/.cache/tmct-conceptnet/ when its sha256 matches, else downloads it). Same
dump in, same bytes out.
