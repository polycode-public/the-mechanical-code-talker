# PLAN_DIGEST.md — from a fact list to a readable digest

Status: stages 1–4 built as pure modules + committed data (`src/domain/digest/`,
`data/templates/constructions/digest-sentence-structures.toml`). Stage 5 (chat term answer,
research.html panels, ledger term view, `tmct digest`) is the remaining wiring over the
`digestTerm` seam. Written 2026-07-24 against 2.11.11.

## What this is for

tmct can already ground a term and cite every fact. What it cannot yet do is *say* what it
knows in the shape a reader wants: a short narrative first, the supporting detail after, and
the noise left out. This plan adds a DIGEST layer — select from the facts the store holds,
inject the survivors into sentence structures, and compose those sentences into paragraph and
article templates. The detail stays available; the digest leads.

The word "digest" is already used in this repo for the code-side `cli digest` (an architecture
map plus per-module context bundles). This plan is the vocabulary-side sibling and should
converge on the same idea: a bounded, structured, useful summary produced deterministically.

## The specimen — a real session, 2026-07-24

The motivating transcript, verbatim. A page session with 32,646 seeded facts. First ask falls
back to live Wikipedia; `research aardvark` then walks six linked topics; the second ask reads
back from the grown store.

```
tmct> what is an aardvark
aardvark — The aardvark is a medium-sized, burrowing, nocturnal mammal native to Africa. The
aardvark is the only living member of the genus Orycteropus, the family Orycteropodidae and the
order Tubulidentata. (source: live Wikipedia article "Aardvark", English Wikipedia, CC BY-SA 4.0)

tmct> research aardvark
aardvark — The aardvark is a mammal from Africa; its name means "earth pig" in the language
Afrikaans. It is the only living member in its order, though some fossil genera have been found
(source: research article "Aardvark", Simple English Wikipedia, CC BY-SA 4.0)
stored 1 fact from "Aardvark". queued 5 linked topics: Africa, Afrikaans, Animal, Binomial
nomenclature, Cambrian — "research next" fetches the next one.

tmct> research next        (x5 — Africa, Afrikaans, Animal, Binomial nomenclature, Cambrian)
…
stored 1 fact from "Cambrian". research on "aardvark" is complete — 6 topics grounded, 6 facts
stored.

tmct> what is an aardvark
aardvark is a kind of medium → environment → geographical area → region → body part → part
i learned: aardvark is a kind of mammal → vertebrate → chordate → animal → creature → organism
i learned: aardvark is a kind of state → government
i learned: aardvark is a kind of software → abstract computer file → information → about animals
i learned: aardvark is a kind of legal document → document → artifact → schema object
…and 42 more — say 'more' to see them.
```

Two readings of that last answer, and both matter:

1. **The research lane works.** The loop closed: a miss became a fetch, the fetch became stored
   facts, the linked topics extended the map, and the term is now grounded from memory rather
   than the network. That is the product's own learn-on-miss promise, end to end.
2. **The read-back is unreadable.** 72 lines, near-identical in shape, dominated by entailment
   chains that carry no information about aardvarks: "a kind of software", "a kind of
   government", "a kind of legal document". The one line a reader wants — mammal, Africa,
   earth pig, only living member of its order — is buried, and the wiki summary that said it
   plainly two turns earlier is gone.

The digest layer exists to make that second answer read like the first.

## Where the noise comes from (diagnosis, not blame)

- **Entailment fan-out.** `entailed:subClassOf` closure over a 32k-fact seed set produces long
  chains from any hook. A single mis-sensed hook ("medium" the adjective read as "medium" the
  noun) drags a whole irrelevant branch in. Some of this is a real bug — sense-collision on the
  hook term — and some is correct-but-useless: `entity`, `abstraction`, `thing` are true and
  say nothing.
- **No selection.** The read-back's only bound is `FACT_ANSWER_CAP` plus "say more" — a
  truncation, not a ranking. The first 30 lines are whatever order the store returns.
- **No composition.** Each line is one template applied to one triple. Nothing groups facts by
  relation, merges chains that share a head, or writes a sentence about several facts at once.

## The design

Four stages, each deterministic, each testable on its own. No LLM anywhere: this is selection
and templating over committed data, the same posture as every other tmct surface.

### 1. Select — which facts earn a place

A scoring pass over the candidate rows for a term, then a cut. Signals, all already present in
the store or cheaply derivable:

- **Provenance tier.** A researched or taught fact outranks an entailed one; the trust priors
  in `src/domain/memory/trust.mjs` already rank the sources.
- **Chain depth.** A direct fact outranks a fact reached through five subClassOf hops. Depth
  is on the row's own chain rendering today.
- **Informativeness.** A class shared by nearly everything in the store (entity, abstraction,
  thing, concept) carries almost no information about this term; a class shared by few does.
  This is a closed, computable notion — a per-class frequency count over the store, cut at a
  threshold — and it is what removes "a kind of entity" without a hand-maintained stoplist.
- **Relation coverage.** Prefer breadth: one good isa, one good partOf, one capableOf beats
  four isa chains.
- **Sense agreement.** Facts whose hook term disagrees on sense with the term's dominant sense
  are demoted (the "medium"/"software" branch). The sense-split machinery already exists.

The cut is a budget (N facts), not a threshold, so the digest length is predictable.

### 2. Structure — facts into sentences

A closed table of sentence structures keyed by relation family, in the construction-bank idiom
`data/templates/constructions/` already uses (pattern → skeleton, loaded as data, validated at
load against the closed relation vocabulary). Each structure takes 1..k facts of one shape and
renders one sentence:

- isa, single: `An aardvark is a mammal.`
- isa, chained: `An aardvark is a mammal, and so an animal.`
- isa, several siblings: `Aardvarks are mammals, burrowing animals, and nocturnal animals.`
- partOf/locatedIn: `It lives in Africa.`
- capableOf/usedFor: `It can dig.`
- named-relation: `Its name means "earth pig" in Afrikaans.`

Sentence structures are DATA, hand-authored and reviewed — a new bank is a new `.toml`, no code
change, exactly as the construction banks work today.

### 3. Compose — sentences into paragraphs

Paragraph templates order and join the sentences: a definition paragraph (what it is, then its
class), a description paragraph (where, what it does, what it has), a provenance paragraph
(where this came from). Joining is where the prose quality lives: pronoun substitution after
first mention ("An aardvark is a mammal. **It** lives in Africa."), clause merging, and
sentence-count caps so a paragraph never runs long.

### 4. Article — paragraphs into a whole

Article templates for the surfaces that want more than a paragraph: a term article (definition
→ description → related terms → sources), a research-run article (what the run set out to
learn, what it grounded, what it skipped and why), a session digest (what this conversation
taught the store). The article layer is also where the DETAIL goes — after the narrative, the
full fact list stays available behind an explicit ask ("show the facts"), so nothing is lost,
only ordered.

## The output shape, on the specimen

What the second `what is an aardvark` should read like, with the same store behind it:

```
An aardvark is a mammal that lives in Africa. Its name means "earth pig" in Afrikaans, and it
is the only living member of its order.

Aardvarks are burrowing and nocturnal. As a mammal, an aardvark is also a vertebrate and an
animal.

I know this from a Simple English Wikipedia article on Aardvark, plus five linked topics I
researched from it (Africa, Afrikaans, Animal, Binomial nomenclature, Cambrian). Say "show the
facts" for all 72 stored facts, or "show the chains" for the reasoning.
```

Everything in that digest is already in the store today. The difference is selection, sentence
structure, and composition — not new knowledge.

## Staging

1. **The selector** — `src/domain/digest/select.mjs`. Scores each candidate row by provenance
   tier, chain depth (a stated fact beats a closure-derived one), store-relative informativeness,
   relation coverage and sense agreement, then cuts to a budget breadth-first across families.
   Every cut row is returned in `cut` with its reason, so nothing is discarded silently. DONE.
2. **Sentence structures** — `data/templates/constructions/digest-sentence-structures.toml`,
   validated and rendered by `src/domain/digest/structures.mjs`. Closed table keyed by relation
   family and form (isa/location/partOf/capableOf/usedFor); a new family is a new TOML block, no
   code change. DONE.
3. **Paragraph composition** — `src/domain/digest/compose.mjs`. Lead sentence names the term,
   later sentences refer back with a pronoun, definition and description land in separate
   paragraphs, sentence-count caps hold. DONE.
4. **Article templates** — `src/domain/digest/article.mjs`. Term-article, research-run and
   session-digest shapes, each returning the full fact list (spoken and cut) behind the
   `show the facts` / `show the chains` escape as data the wiring renders. DONE.
5. **The surfaces**: chat's term answer, research.html's per-source panels, the ledger's term
   view, and `tmct digest <term>` on the CLI beside the code-side `cli digest`. Thin wiring over
   `digestTerm(term, rows, store, table, opts)` (`src/domain/digest/index.mjs`): the surface
   builds the fact rows and the store statistics from the graph it already holds, hands them in,
   and renders the returned article.
   - The wiring seam is shared: `src/domain/digest/store-stats.mjs` (pure — one row scan yields
     the selector's store-relative signals and the ancestry chains) and
     `src/adapters/corpus/digest-bank.mjs` (`digestTermFromRows`, which reads the committed bank
     once and returns null when it is unavailable so a browser-stubbed surface falls back). DONE.
   - `tmct digest <term>` (`src/domain/cli-verbs.mjs` + the bin dispatcher arm): the narrative
     leads, its sources follow, the stored-fact count points at the ledger. DONE.
   - Chat's term read-back: lead with the digest when a term answer would run past the digest
     threshold, the full fact list behind "show the facts"/"more". NOT STARTED.
   - The research and ledger term panels: render the digest shape client-side from a
     build-time-embedded structure table. NOT STARTED.

## Decisions recorded

- **Per-surface digest budgets** (`src/domain/digest/config.json`, `budget`): chat reply 5,
  research panel 10, `tmct digest` 12, ledger term view 8. The wiring passes `opts.budget`; these
  are the defaults.
- **The uninformative-class cut is store-relative**, thresholds committed as data
  (`config.json`): a class more than `uninformativeClassMaxShare` (0.35) of the store's isa
  subjects share is cut, but only once the store holds at least `uninformativeClassMinSubjects`
  (12) subjects, below which the share is too noisy to trust. The cut runs before sense
  clustering — a bare, high-share class with no ancestry would otherwise bridge distinct senses
  into one cluster.
- **Store statistics are the wiring's input, not the selector's job.** The selector is pure over
  `{ classSubjectCounts, totalSubjects, subClassEdges, disjointEdges }`; one graph scan in stage 5
  produces them.

## Invariants

- Deterministic, no model in the path: selection is scoring over stored facts, rendering is
  templates as data.
- Nothing invented. Every sentence traces to facts the store holds; a digest with no facts is
  an honest miss, not a fluent guess.
- The detail is never destroyed, only ranked — "show the facts" reaches the full list.
- Provenance survives composition: a digest names its sources, as the specimen's own research
  replies already do.

## The sense-collision at source

The specimen's `aardvark is a kind of medium → environment → …` branch traces to a bad ROOT edge,
`aardvark rdfs:subClassOf medium`, not to the closure that fans it out (the closure is correct
given a wrong input). That edge is minted in `src/services/extract-facts.mjs`: `copulaObjectAt`
scans rightward from the copula for the first noun-ish token to use as the isa object, and in
"The aardvark is a medium-sized, burrowing, nocturnal mammal" the adjective "medium" (from
"medium-sized") is read as that noun instead of the real head "mammal". The `software`,
`government` and `legal document` branches are the same shape from other seed sentences.

That fix lands in the extraction pass, which is a services module outside the digest layer's
domain surface. Per the operator decision, this pass filters the noise in the selector rather
than reaching across the ownership boundary: an isa object whose sense cluster disagrees with the
term's dominant sense is demoted below the score floor and cut (traceable in `cut` with reason
`below-floor`), and the store-relative frequency cut removes the correct-but-useless top classes.
The specimen acceptance test (`test/domain/digest-specimen.test.mjs`) asserts the fan-out reduces
to a bounded paragraph with the noise gone.

The source fix — a hyphenated-adjective / attributive-adjective guard in `copulaObjectAt` so
"medium-sized" never heads an isa, tracked against a wink POS read of the token — belongs to the
extraction workstream; until it lands, the selector filter carries it, and no bad edge reaches the
narrative.

## Open questions for the operator

- Whether the chained isa form ("a mammal, and so an animal") or the several form ("a mammal, a
  vertebrate, and an animal") reads better as the default when a lone isa fact has an ancestry
  chain. Both are wired; compose picks chained only for a single isa fact with a supplied chain.
