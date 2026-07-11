# PLAN_DID_YOU_SEE_HER_DUCK.md — breadth-first ambiguity, from the lexicon to the chat response

Status: IMPLEMENTED. This is not a research note — every mechanism below is real, committed code
(`d5e962d`, `65a7752`, `c254871`, `842ffa1`), tested (`npm test`: 1866/1866 green throughout), and
proven live at the bottom of this doc with a real CLI transcript.

## Origin

`BENCHMARK_INFERENCE_1.5.7.md` found that `infbench/generate-cases.mjs` crashed on a real bug:
`src/grammar/lexicon-core.json` declares `"dice"` twice — once as `die`'s irregular plural
(`"die": { "plural": "dice" }`) and once as its own standalone noun (`"dice": {}`). `lookupNoun`
(`src/grammar/lexicon.mjs`) resolved this by checking the irregular-plural map first and returning
immediately on a hit. "e08.mjs is a dice" silently resolved to `tmct:die`, not `tmct:dice` — the
generator's own fixture lint caught the mismatch and crashed, correctly.

The operator's framing of the right fix, verbatim, is the design target for everything in this doc:

> the way I want to handle ambiguity is by considering all the possible hits as a valid path, then
> follow the paths expecting some to find dead ends... breadth first search pruning dead ends, not
> hill climbing and finding a local maxima which is a dead end.

That is a general architectural complaint, not a one-word bug report. `lookupNoun` committing to the
first lexicon match it found — without checking whether a grammatically better match existed — is
hill-climbing. This doc fixes that shape twice: once at the lexicon layer (Step 1/2, the dice fix
generalized), and once at the parse layer (Step 3, a second, independent instance of the same bug
found while building the first fix's payoff).

### The classroom example, and a citation correction made mid-session

The operator's own touchstone for genuine structural ambiguity — not just a lexicon collision — is
a classic classroom example from a university lecture: "Did you see her duck?" It is ambiguous
between "did you see [the duck that belongs to her]" (her = possessive determiner, duck = noun) and
"did you see her [perform the action of] duck[ing]" (her = object pronoun, duck = verb, a bare
infinitive after a perception verb).

The professor who taught that lecture is **Anne De Roeck**, Professor Emerita at The Open
University's Department of Computing and Communications — a genuine computational-linguistics
researcher with a real ACL Anthology publication record, not the formal-verification researcher an
earlier pass through this write-up mistakenly named. Her real, citable 1980s/90s work is directly on
topic:

- "Generating English Paraphrases From Formal Relational Calculus Expressions" (COLING 1986).
- "Helpful Answers to Modal and Hypothetical Questions" (EACL 1991).
- "Natural Language Front-Ends to Databases: Design and the Customisation Bottleneck" (EACL 1993).
- "Resolving Anaphora in a Portable Natural Language Front End to Databases" (ANLP 1994) — worth
  naming specifically: a natural-language front end to a database, with its own anaphora
  resolution, is close kin to what tmct itself is (a natural-language query surface over a graph,
  with its own focus/"it" tracking), so the connection here is real, not decorative.

Her later work (2000s onward) moves into ambiguity detection directly — "Identifying Nocuous
Ambiguities in Natural Language Requirements" (Chantree, Nuseibeh, De Roeck, Willis, RE 2006) and
"Analysing Anaphoric Ambiguity in Natural Language Requirements" (Yang, De Roeck, Gervasi et al.,
Requirements Engineering 2011). Both are about telling a *nocuous* ambiguity — one where different
readers would genuinely disagree, and it matters — from a harmless one. That distinction is exactly
the judgment call Step 3 below makes: `parseAceAmbiguous` only ever surfaces an ambiguity when two
or more readings are each a complete, independently valid parse (nocuous — worth surfacing), and
stays silent whenever a reading is a structural dead end (harmless — safely pruned, never shown).
"Did you see her duck" itself is never cited as a specific De Roeck paper here — it is named
honestly, as it was taught: a real classroom example from her teaching.

## The architecture: three real functions, one new code path

**1. `lookupNoun`, generalized to `lookupNounCandidates` (`src/grammar/lexicon.mjs`, commit
`d5e962d`).** The die/dice collision is grammatical-agreement pruning, not a word-specific fix.
`resolveNP` (`src/grammar/ace.mjs`) now captures whether the ORIGINAL noun phrase opened with "a" or
"an" — ACE's only two determiners that are grammatically singular-only — before stripping the
determiner off, and threads that as `opts.singularOnly` into `lookupNoun`. When a word is BOTH an
irregular-plural fold target and its own standalone noun, `opts.singularOnly` prefers the standalone
(singular) reading; without it, the irregular-plural fold still wins, unchanged. This is general: it
also resolves `person`/`people` and `tooth`/`teeth` the same way, with no per-word code. `lookupNoun`
itself is now a one-line wrapper around `lookupNounCandidates(...)[0]`, which returns every candidate
lexicon entry a word could resolve to, not just the first — additive, every existing call site is
unaffected.

**2. `lookupVerb`, generalized to `lookupVerbCandidates` (same file, commit `65a7752`).** The exact
same wrapper shape, for symmetry: `lookupVerb` is now `lookupVerbCandidates(...)[0]`. No verb-fold
collision exists in the current lexicon to demonstrate against (checked programmatically, not
assumed) — noted honestly rather than manufactured.

**3. `parseAceAmbiguous`, a new function in `src/grammar/ace.mjs` (commit `c254871`).** This is
where the real payoff lives, and it is a SECOND, independent instance of the operator's hill-climbing
complaint — found not in the lexicon this time, but in the parser. Pattern 3 ("N1 VERB N2") is a
loop over every token position, and the existing `parseRelation` returns the moment it finds the
FIRST position `lookupVerb` recognizes — even when that position's subject/object don't resolve and
a LATER position would have. `parseRelation` itself is untouched (still the fast, greedy path every
existing caller keeps using — no existing sentence's output changes). `parseAceAmbiguous` is an
additive sibling: it scans every verb-position split, keeps only the ones that are a COMPLETE, valid
parse (a dead end is pruned silently, never surfaced), and returns the survivors, labeled by which
token each reading reads as the verb. It returns `null` — meaning "nothing to see here, use the
ordinary path" — for the overwhelming majority of sentences: anything not relation-shaped at all
(mirrors `parseAce`'s own dispatch gate exactly), and any relation-shaped sentence with 0 or 1
surviving readings.

**4. `assertTurn`, wired to check `parseAceAmbiguous` first (`src/chat.mjs`, commit `842ffa1`).**
This is the existing "declarative sentence → assert into memory + confirm" function. It now calls
`parseAceAmbiguous` before the ordinary `parseAce` path. On the common case (`null`), nothing
changes — the existing `parseAce` call runs exactly as it always has. On a genuine 2+-reading
survival, a new branch renders every surviving reading's would-be triples, restates the operator's
own line as canonical prose first, and commits NOTHING to memory — an ambiguous sentence has no
single fact tmct can honestly assert without guessing. The wording reuses `ask.mjs`'s own existing
"this could mean more than one thing" disambiguation tone (`renderCore`'s `ambiguousParse` branch,
used for query-side ambiguity), so the two surfaces read as one consistent product convention rather
than two different ones invented separately.

## The worked example: adapting "her duck" into tmct's real grammar

tmct's ACE fragment has 8 patterns (`src/grammar/ace.mjs`), all TEACH/ASK-shaped declaratives — there
is no "did you see X" question form, no pronoun objects, and no bare-infinitive verb complement
("see her duck" with no direct object of "duck" itself). Pattern 3 ("N1 VERB N2") is the closest
home for a noun/verb ambiguity, but it requires a genuine object after the verb — so the adaptation
gives "duck" its ordinary transitive sense (to dodge or avoid something: "duck a question," "duck a
task," both completely standard English), not the classroom example's intransitive one.

`"duck"` was declared as a noun only (`lexicon-core.json`); it now also carries a verb sense. Making
the ambiguity reachable at all — two different token positions in the SAME sentence both resolving
to a complete, valid parse — needed two more ordinary word senses, each added to an ALREADY-declared
word (never a fabricated one):

- `"mock"` gained an adjective sense (`type: "subclass"`) — it was noun + verb only. "Mock module"
  (a simulated/fake module) is standard software terminology.
- `"senior"` gained an adjective sense — it was noun only. "Senior module" parallels tmct's existing
  "legacy module"/"internal module" adjectives.

(An earlier draft of this same construction tried adding a noun sense to `"legacy"` instead of
`"senior"` for the same role — real English too, "a legacy" is an ordinary noun — but it broke a
pinned test: `classify()`'s priority is noun > verb > adjective, so a newly-added noun sense flipped
`classify("legacy")`'s answer away from its existing pinned adjective reading. Swapping to `"senior"`
(already a noun, so its new adjective sense doesn't change `classify`'s priority outcome) fixed it
with no loss of naturalness. `npm test` caught this immediately; noted here because it's a real,
useful case study in how narrow "additive" needs to be checked, not just claimed.)

The sentence: **"senior duck mock module."**

- Reading 1 — **"duck" read as the verb**: subject = `senior` (a lone word, valid as a standalone
  noun), object = `mock module` (adjective + noun, "mock" modifying "module"). Triple: `senior
  tmct:ducks mock-module` — "the senior [engineer] ducks [avoids] the mock module."
- Reading 2 — **"mock" read as the verb**: subject = `senior duck` (adjective + noun, "senior"
  modifying "duck"), object = `module` (a lone word). Triple: `senior-duck tmct:mocks module` —
  "the senior duck mocks [simulates a test double for] the module."

Both are complete, independently valid parses of the identical four tokens — the same shape as "her
duck," adapted honestly into a pattern tmct's real grammar can parse, with every word sense used
being ordinary, real English or standard software terminology.

### Live proof — real CLI transcript, both readings, correctly labeled

```
$ printf 'senior duck mock module.\n/exit\n' | node bin/tmct.mjs
tmct> You asked: "senior duck mock module." — this could mean more than one thing:
1) reading "duck" as the verb: mock-module rdfs:subClassOf module; mock-module rdfs:subClassOf mock; senior tmct:ducks mock-module
2) reading "mock" as the verb: senior-duck rdfs:subClassOf duck; senior-duck rdfs:subClassOf senior; senior-duck tmct:mocks module
Nothing was remembered yet — reply with the reading you meant (or rephrase) and I'll note it.
```

Nothing was written to memory (checked directly — no `assertSentence` call happens on this branch).

### Proof the ordinary path is unaffected

`npm test` stayed at 1866/1866 green through every commit in this doc, including
`chatflow-canonical.test.mjs`'s pinned "john is a man" and "every module is a artifact" cases. Live,
outside the test suite too:

```
$ printf 'every module is a artifact.\n/exit\n' | node bin/tmct.mjs
tmct> noted — remembered 1 fact: module rdfs:subClassOf artifact
```

Single-reading declarative sentences — the overwhelming majority of everything tmct is taught — take
the exact same code path as before this doc's changes, because `parseAceAmbiguous` returns `null`
for them and `assertTurn` falls straight through to the untouched `parseAce` call.

## Connection to `PLAN_CONVERSATION.md`'s noise-strip.mjs finding

`PLAN_CONVERSATION.md`'s Finding 2 is a different-looking bug with the same root shape.
`src/interpret/strategies/noise-strip.mjs`'s `stripNoise()` decides whether a token is strippable
"noise" off a single, arbitrary criterion (a curated word list, or wink-nlp's generic stopword
dictionary) and commits to that one stripped-or-not reading immediately — there is no attempt to
try the token BOTH ways and see which one leads to a resolvable object. That finding's own example:
"where would I keep a hammer" strips "keep" (on wink's stopword list) and resolves cleanly, while
"where would I store a router" doesn't strip "store" (not on the list) and resolves ambiguously
against real graph individuals (`Store`, `Storage`, `store.mjs`) — a real 4/5-way tie, not a scoring
bug. That is greedy, single-path commitment with no backtracking: the same shape this doc's
`lookupNoun`/`parseRelation` bugs had, just wearing a stopword list instead of a lexicon map.

The technique this doc landed — generate every candidate reading, prune the ones that don't lead
to a complete, valid resolution, and only commit silently when exactly one survives (surfacing
ambiguity honestly otherwise) — is not implemented for `noise-strip.mjs` here; that is real,
separate design work with its own wide regression surface (`stripNoise` is a shared path several
other strategies depend on, per `PLAN_CONVERSATION.md`'s own scoping note). But the shape transfers
directly: instead of one criterion deciding strip-or-keep per token, `stripNoise` could produce both
candidate readings (verb stripped / verb kept) and let `resolveObject`'s own tiered scoring decide
which one (if either) resolves to a confident, unambiguous individual — the same "try all the paths,
keep the survivors" principle, applied one layer up the pipeline from where this doc applied it.

## Staged build (what was actually built, in order)

**Step 1 — `d5e962d`.** Grammatical-agreement pruning in `lookupNoun`: the "a"/"an" determiner signal
threaded from `resolveNP` into `lookupNoun` as `opts.singularOnly`. Fixes the die/dice collision (and
generalizes to person/people, tooth/teeth) with no per-word carve-out. Spot-checked: "e08.mjs is a
dice" now resolves via the standalone `dice` entry; "the dice is a thing" still folds to `die`
(existing behavior preserved, since "the" is number-neutral); `infbench/generate-cases.mjs` runs
clean (exit 0, 219 cases) instead of crashing on the b2-svf1apply-4 fixture-lint mismatch. `npm test`:
1866/1866.

**Step 2 — `65a7752`.** `lookupVerb` generalized to `lookupVerbCandidates`, matching Step 1's shape.
Spot-checked: `lookupNounCandidates` returns both entries for die/dice (order flips on
`singularOnly`) and for a real regular `-s`-fold collision found in the lexicon (`works`/`work`, both
independently declared nouns — not invented). `npm test`: 1866/1866.

**Step 3 — `c254871` + `842ffa1`.** `parseAceAmbiguous` (the breadth-first, dead-end-pruning scan
over pattern 3's verb-position splits) plus the three ordinary-English lexicon additions needed to
make a genuine noun/verb ambiguity reachable (`duck` verb sense, `mock` and `senior` adjective
senses), then `assertTurn` wired to check it first and render the "this could mean more than one
thing" response instead of silently picking a reading. `npm test`: 1866/1866 at each of the two
commits. Live-proven above with the "senior duck mock module" transcript.

## What this doc is not

Not a redesign of `noise-strip.mjs` — that connection is noted, not built, per the previous section.
Not a generalization to the other 7 ACE patterns — only pattern 3 (relation) had the structural shape
(a loop over candidate positions) needed for this kind of ambiguity; the others are single-keyword-
anchored (`indexOf("is")`, `indexOf("that")`, `indexOf("has")`) and were out of this doc's concrete
scope. Not a UI/UX overhaul of the disambiguation reply — it deliberately reuses the wording and
structure `ask.mjs` already established for query-side ambiguity, rather than inventing a new
convention.
