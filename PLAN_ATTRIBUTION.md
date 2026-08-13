# PLAN_ATTRIBUTION.md — recording a report's speaker as a reified attribution

Status: LIVE — spec settled 2026-08-13, unimplemented. Shape chosen by the operator:
a reified finding, over reusing `mgx:statedBy` and over leaving the speaker in
provenance only. Ground truth checked against `main` at `b5cb85e7`;
`src/services/extract-facts.mjs` and `src/adapters/memory/core.mjs` were being
edited while it was written, so re-grep the anchors rather than trusting line
numbers.

## 0. The shape

Two things get written, not one.

The claim row is what already exists, plus a new closed-vocabulary finding on its
assertion record:

```
fact:<claimHash>   russia | tmct:releases | robert gilman
                   mgx:extractionFinding = "reported-speech"
```

The attribution row is the reified finding — a Fact whose subject is the claim's
group id:

```
fact:<attrHash>    fact:<claimHash> | mgx:attributedTo | president trump
```

The finding is the durable half. The attribution fact can be lost (evicted,
filtered off the wire, skipped by a batch), and if it is, the claim still says out
loud that it came from reported speech. That asymmetry is deliberate and it is
what makes the design fail safe.

## 1. The vocabulary

Findings are kebab-case and name how the sentence was read (`identifier-token`,
`clause-fallback`, `pronoun-carry`, `definitional-frame`). The new one is
**`reported-speech`**. The predicate is **`mgx:attributedTo`**, matching the
`mgx:`-namespaced camelCase of the extraction-tier relations.

`ontology/tmct-core.ttl` section 1e already carves out the home: predicates the
prose extractor mints from a sentence's own structure, declared rather than minted
because the surface frame that produces them is closed and named. `mgx:nameFor` is
the precedent for the whole pattern — closed named frame, declared predicate,
curated phrase-table entry, finding name.

PROV alignment is cleaner here than elsewhere: `mgx:statedBy` carries only
`rdfs:seeAlso prov:wasAttributedTo`, for reasons its comment sets out at length,
but `mgx:attributedTo`'s object is a named person, a `prov:Agent`, so it can carry
`rdfs:subPropertyOf prov:wasAttributedTo` outright.

### The ten sites

| # | file | anchor | what to add |
|---|---|---|---|
| 1 | `src/adapters/memory/shacl.mjs` | `export const EXTRACTION_FINDINGS = Object.freeze([` | a fifth entry `"reported-speech",` |
| 2 | `src/adapters/memory/core.mjs` | the `mgx:extractionFinding` note (byte-pinned) | the name in the inline closed list |
| 3 | `ontology/memory-shapes.ttl` | `sh:path mgx:extractionFinding ;` | the name in the `sh:message` closed list |
| 4 | `ontology/tmct-core.ttl` | `mgx:extractionFinding a owl:DatatypeProperty ;` | the name in the `rdfs:comment` closed list |
| 5 | `ontology/tmct-core.ttl` section 1e, beside `mgx:nameFor` | `# 1e. Extraction-tier relations` | a new `mgx:attributedTo a owl:ObjectProperty` block |
| 6 | `docs/adapter-contract.md` | `**The findings vocabulary**` | a fifth table row |
| 7 | `docs/adapter-contract.md` | `**The caveat templates**` | a fourth table row |
| 8 | `src/domain/fact-phrase.mjs` | `export const FINDING_CAVEATS = Object.freeze({` | `"reported-speech": "(read from reported speech)"` |
| 9 | `src/domain/fact-phrase.mjs` | `export const FACT_PREDICATE_PHRASES = Object.freeze({` | `"mgx:attributedTo": "is attributed to"` |
| 10 | `src/domain/memory/resolution.mjs` | `const MERGE_PREDICATE_STEMS = [` | `"mgx:attributedTo"` — see risk 4 |

Site 9 is not optional: `predicatePhrase("mgx:attributedTo")` returns
**`"attributedToes"`** today, because the minted-verb branch matches any
`mgx:<letters>` and runs it through the 3sg fold.

`mgx:attributedTo` gets no `MEMORY_VOCABULARY` row. That table documents attribute
props; a predicate value has never appeared there.

### What byte-pinned means, and keeping the pin honest

`emptyMemory()` puts `MEMORY_VOCABULARY` into every payload's `vocabulary` field,
the SQLite backend serialises it into the `meta` table, and the whole store is
dumped byte-for-byte into `test/adapters/memory-sqlite-storage-dump.txt`, compared
with a bare `assert.equal(dump, expected)`. Regeneration is mechanical, so the
honesty lives entirely in the review:

1. Never hand-edit the dump.
2. Delete it, run the conformance test, accept the one deliberate failure.
3. `git diff` it and confirm the only changed bytes sit inside the `meta` row
   keyed `vocabulary`, and the change is the added finding name.
4. If any `individuals`, `facts`, `edges` or `relations` row moved, the change did
   something other than add a name. Stop and understand it before accepting.

Step 3 is the whole point. A regenerated dump that silently absorbed an unrelated
storage change is a pin that no longer pins anything.

Guards that fire on their own: `memory-extraction-findings` (every listed name
must validate, unlisted names refused; every `FINDING_CAVEATS` key must be
storable), and `fact-phrase.test.mjs`'s `assert.equal(Object.keys(FINDING_CAVEATS).length, 3,
"the caveat table is closed")` — change the literal to 4, never delete the
assertion. `docs/adapter-contract.md` is pinned by no test at all, so sites 6 and
7 drift silently if forgotten.

## 2. The subject problem

**Reification over a Fact is unprecedented in this store.** No row anywhere puts a
fact id in `rdf:subject` or `rdf:object`. The convention is stated in a migration
comment in `core.mjs`: an edge endpoint has to be a node a graph walker can
dereference, so unlike a justification premise list it cannot be left pointing at
a group. Fact-to-Source and Fact-to-Utterance go through `objectProperties` edges;
Fact-to-premises and Fact-to-prior-records go through attribute values; a
Retraction copies the claim's own natural-language subject and predicate.

There is one place a fact id sits in subject position, and it is instructive:
`retractionWireFact` puts `fact:<hash>@<sourceId>` in `subject`, but that object
exists only on the wire — `retractionFromWire` turns it back into a Retraction
individual whose stored subject is natural language. The repo met this problem
once and chose "wire-only, never stored".

### `normFactTerm` destroys the reference

SHACL permits a hex subject (it asserts only `sh:minLength 1` and no sentence
boundary). `factGroupId` and `factIdFor` both behave. The blocker is
`src/domain/hash.mjs`:

```js
s = s.replace(/^[a-z][\w.-]*:/i, "");   // strips ANY leading CURIE prefix
```

Measured: `"fact:1a2b3c4d5e6f7788"` normalises to `"1a2b3c4d5e6f7788"`, and
`factIdForTriple` gives the prefixed and bare forms the same id. Both write entry
points normalise unconditionally. So the stored subject would be a bare 16-hex
string no reader can tell from a taught word — the reference is not recoverable at
read time at all.

**The fix** is a guard before the prefix strip exempting a string that is exactly a
fact group id (`/^fact:[0-9a-f]{16}$/`), returned unchanged. No existing term
matches that pattern, so nothing already stored changes, and no real word is
sixteen hex characters after a `fact:` prefix. The test to write is not "the guard
works" but "the guard changed nothing else": assert unchanged output for the CURIE
forms the strip exists to handle (`/c/en/foo_bar`, `tmct:Foo_bar`, `mgx:causes`,
`fact` alone, `fact:` plus a non-hex tail, a 15- and a 17-char hex).

Once the prefix survives, every reader can filter on `startsWith("fact:")`, which
is what makes the read side implementable.

## 3. The read side

**The card.** Suppress attribution rows from every card lane at the top of
`buildNewsItems` — partition rows into claims and attributions, build a
`Map<claimGroupId, speaker[]>`, pass it down. Filtering lane by lane will miss one,
and suppression is not optional politeness: `looksLikeEntityTerm` returns true for
a single alphanumeric-led word of any content, so a hex subject can be scored as a
hub and a card can be headed by a fact id.

Then fold the speaker into the claim's own sentence, where `groupRows` is already
in hand:

> **russia releases robert gilman, president trump said.**

That is the article's own construction, needs no new punctuation convention, and
reads as prose rather than apparatus. Several speakers join with " and ". Where
some rows in a group are attributed and some are not, render only the attributed
rows' speakers, or drop the clause if that would misattribute — err toward
dropping.

**Chat.** `factLineTail` is the single tail every rendered fact line ends with, and
its own comment already sets the order: a reader sees how the sentence was read,
then who said it. The speaker slots in ahead of both. Two routes: the cheap one is
the finding alone, so chat says the claim is reported speech without naming who,
which costs nothing beyond the vocabulary; the full one attaches an `attributedTo`
field during `foldFactRows` so every reader inherits it. Take the cheap route
first so nothing renders bare, then the full route as its own commit.

`phraseRendererSource()` stringifies the phrase layer for a page's inline script
and does not carry `findingCaveat`. It has no production caller today, so this is
a latent gap, not a live one.

## 4. Does an attributed claim stay grounded?

**Yes, and every rendering names the speaker.** Chosen over three alternatives:

- Answering flatly is today's bug.
- Refusing the claim would be a new kind of refusal — a judgement that a grounded
  claim might be false, which is a guess in the opposite direction from the one
  tmct avoids. Chow's reject option and Reiter's open-world assumption abstain
  because nothing matched, not because what matched might be wrong.
- A trust penalty is banned outright by the findings vocabulary's own
  constitution: a finding is a mechanical property of the parse with its own
  detector and tests, never a confidence score.

The repo already decided the general case in writing, in `chat.mjs`: a row whose
extractor recorded a finding stays answerable, and the caveat is how the answer
says which reading it leans on. Reported speech is a finding.

Refusing only detected attributions would also be dishonest in practice: an
article's unattributed sentence is also somebody's claim, so declining the ones the
detector caught makes the refusal a function of the regex list's coverage rather
than of the evidence.

**The invariant that makes this honest rather than cosmetic: a surface that cannot
render the attribution must not render the claim.** That is what drives the commit
order — the read side lands before the write side, so there is never a window in
which an attributed claim renders bare.

## 5. Order of work

1. **The id carve-out** — `src/domain/hash.mjs` plus a new test. There is no
   existing `normFactTerm` coverage.
2. **The phrase layer** — `fact-phrase.mjs` sites 8 and 9, and the `3` → `4`
   literal in its test.
3. **Sibling resolution** — `resolution.mjs` site 10. Must precede any write.
4. **The card read side** — `news-feed.mjs`. A no-op while no attribution facts
   exist, which is the point.
5. **The chat read side, cheap route** — nothing beyond commit 2.
6. **The vocabulary** — sites 1–7 and the regenerated storage dump. Blocked on
   `core.mjs`.
7. **The write** — `extract-facts.mjs`. `reportedClauseOf` currently discards the
   speaker and its own comment says so; neither regex captures it, so both need a
   capture group and the return type becomes `{ claim, speaker }`. It is exported
   and pinned, so the signature change is a real edit. Thread the speaker to the
   write, add `"reported-speech"` to the findings, emit the attribution in the same
   batch, and keep attribution facts out of the returned arrays or count them
   separately — they feed `snapshot.factIds` and the bench's own score.
8. **The full chat route** — `foldFactRows`, then `chat.mjs`. Blocked on `core.mjs`.
9. **Measure** — `run-live-cycle.mjs`. The Gilman story is in the committed
   2026-08-12 nyt-world fixture.

## 6. Risks

1. **`normFactTerm` eats the prefix.** Everything else compounds from it.
2. **The news fact cap evicts the two halves independently, and it is worse than
   this section first said.** An attribution carries the same `news:` tag, so
   each attributed claim costs two of the 4000 slots. But `evictNewsFacts` reads
   `r.observedAt` straight off the row, and `readFactRows` keeps `observedAt` on
   the assertion records — `rowObservedMs`, sitting 1500 lines above it, exists
   for exactly that reason and eviction does not call it. So every news row
   scores 0 and the whole sort collapses to id order. The claim and its
   attribution do not merely share a timestamp and differ by id; they tie at zero
   and are ordered by two unrelated content hashes, so at the cap they split
   routinely. `test/domain/news-feed.test.mjs`'s eviction test passes only
   because it builds rows with an explicit top-level `observedAt`, which no real
   row has. Fixing the ordering is its own item; `evictNewsFacts` must ALSO treat
   a claim and its attributions as one unit. Stripping the tag instead is worse:
   the attribution escapes the cap entirely and grows unbounded.
3. **Retraction does not cascade.** `removeFacts` scrubs edges referencing a
   removed id, over `objectProperties` only. An attribution holds the claim id in
   an attribute value, so it is invisible to the scrub and survives its claim.
4. **Two speakers read as a contradiction.** `resolutionStrategyFor` defaults to
   contradiction for any predicate absent from its tables, so two outlets
   attributing one claim to two people would be reported as disagreement rather
   than corroboration. Site 10 fixes it, and it is easy to miss because it is
   nowhere near the other nine.
5. **p2p sorts fine; arrival order does not.** The attribution gets an ordinary
   content-addressed id, so merge stays order-independent. But `mergeIncomingFacts`
   orders only retractions ahead of assertions, `flushLocalChange` diffs per row,
   and `sync-filter.mjs` admits only teach/operator/teachNode rows — so an
   attribution can arrive before, after, or without its claim. Write the rule down:
   **an attribution whose claim is absent renders as nothing, never an error and
   never a hex id.**
6. **Every reader that walks subjects can print the hex.** `memoryFactGraphPayload`
   turns every subject and object into a class-`term` individual, and
   `inspect.mjs`'s `clean()` regex passes a 16-char hex beginning `a`–`f`, printing
   it under the banner "real terms from the store above". The `fact:` prefix from
   risk 1's fix is what lets each of these filter.
7. **The prose index is latent, not live.** `appendFact` indexes `s p o` and the
   tokenizer would make a hex a real token, but every memory-backed `parseEntities`
   call site feeds it a payload carrying no `proseIndex`. Unverified rather than
   safe.
8. **The finding and the fact can disagree.** `appendFacts` skips malformed facts
   rather than throwing, so a claim can end up marked `reported-speech` with no
   attribution beside it. That degrades to "reported speech, speaker unrecorded" —
   a caveat, not a lie, which is why the finding is the durable half.

## Open, unchecked

Which chat lane parses a past-tense polar question ("did Russia release Gilman");
only that every fact-grounded answer line ends through `factLineTail` was verified.
An attribution fact's trust behaviour is untraced — `trust.mjs` was not read.
Whether an attributed claim should still count as grounded in the bench numbers,
and whether attribution rows would inflate them, needs `scripts/news-bench/metrics.mjs`.
