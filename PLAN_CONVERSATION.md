# PLAN_CONVERSATION.md — findings that graduated out of the fast loop's safe-fix scope

> **STATUS: Finding 1 and Finding 2 are RESOLVED** — see their own sections below for what shipped.
> Not a build plan with a staged implementation — this doc exists to hold findings precisely enough
> that a future session can pick them up, the same role `PLAN_SYLLOGIST.md` plays for
> reasoning-engine research pulled out of `PLAN_INFERENCE_TESTING.md`. Nothing here is scheduled,
> staffed, or blocking anything else.

## Why this doc exists

`SKILL_AGENT_FAST_LOOP.md`'s own operating principle, the operator's own framing: *"the fast loop
should be exploring within edges to catch the traps human visitors are likely to fall in, then
benchmarking is the way we explore the limit of a wider capability and decide where to push."* The
fast loop is for small, local routing/recognition gaps — fix it, verify it, ship it, in one round. It
is explicitly NOT for broader mechanism redesigns: forcing one of those through the loop's
low-attention, many-independent-rounds model is exactly how a bad fix compounds silently.

Rounds 2, 3, 5, and 6 of the loop's first run (2026-07-11, alongside a concurrent benchmark batch)
each investigated a real dead-end, and each correctly declined to patch it once the investigation
reached a genuine architectural question rather than a small safe fix. This doc is where those two
findings live now — traced precisely against the real code below (round 2's own report described its
finding by the wrong mechanism; corrected here), not just transcribed from the rounds' own prose.

---

## Finding 1 — an unknown "every X is Y" always mints Y as a class, never a property, because the mint fallback has no POS check [RESOLVED]

**RESOLVED.** Fixed via the POS-check this finding's own fix sketch called for (below): `chat.mjs`'s
new `objectReadsAsNonNoun(word)` helper (sitting right above `unknownObjectFallback`) asks wink-nlp's
POS tagger, through the SAME `nlpAdapter().posTags()` adapter `subjectIsNounOrPropn` already uses for
this kind of disambiguation, whether a word reads as anything OTHER than `NOUN`/`PROPN`.
`unknownObjectFallback` now calls it on the object before minting; a `true` (word tags `ADJ`, `VERB`,
etc.) makes it decline (`return null`) instead of minting a class, letting the cascade fall through
to `unknownAdjectiveFallback` next, which mints the SAME word correctly as a property. A `null` tag
(no wink installed, or any tagging surprise) is treated as "no signal" and never blocks the
pre-existing mint — matching every other optional-adapter path in this file.

**Round 2's own framing was imprecise** — it named a "teach-routing race" between
`BARE_DECLARATIVE_RE` and `TEACH_PROPERTY_RE` in `src/chat.mjs`. That's not quite where the decision
actually happens. Traced against the real code:

1. `src/grammar/ace.mjs`'s `parseEvery` (line 260) already does the right thing when it can: for a
   single-word complement it tries `lookupAdjective(lexicon, rest[0])` FIRST (line 272-273) and only
   falls through to resolving the complement as a noun/class if that lookup misses.
2. The bug is what happens when the complement is NOT a declared adjective at all — e.g. "every
   Record is persisted", where "persisted" is in neither the noun nor the adjective lexicon.
   `parseEvery` can't resolve it as a class term either (no matching noun), so `parseAce` returns a
   miss (residue), and `assertTurn` (`chat.mjs:7245`) returns `null` — falling through to the outer
   `teachLane` cascade.
3. That cascade tries, in order: `unknownSubjectFallback` → **`unknownObjectFallback`**
   (`chat.mjs:1959`) → `unknownAdjectiveFallback` (`chat.mjs:2036`) → `TEACH_PROPERTY_RE`
   (`chat.mjs:1660`, wrapped-only). `unknownObjectFallback` mints the object as a NEW CLASS
   (`rdfs:subClassOf`) whenever: the sentence carries a genuine "every/each/all" quantifier, the
   subject is grounded, and the object is NOT already a grounded term — with **no check at all for
   whether the object reads more like an adjective than a noun**. "Every Record is persisted"
   satisfies all three conditions, so it mints `persisted` as a class and stores `Record ⊑
   persisted`, before `unknownAdjectiveFallback` (which WOULD have minted the same word as a
   property — see its own decline guard, `chat.mjs:2116`, "Y already a known NOUN... never misread
   as a property") ever gets a turn. `unknownAdjectiveFallback` itself has no quantifier gate, so it
   would have handled "every Record is persisted" correctly on its own if it ran first — the
   ordering, not either function's individual logic, is the bug.

**A correction to the fix sketch's own worked example**: the sketch's canonical "already works"
regression pin, "every cache is bespoke", turned out NOT to be an example of `parseEvery`'s
adjective-first check succeeding — `"bespoke"` is not actually declared in `lexicon-core.json`'s
adjectives list at all (checked directly: `lexicon.adjectives.bespoke === undefined`). The REAL
pre-existing pinned test (`test/chat-teach-quantifier.test.mjs:645-656`) uses the WRAPPED phrasing
"remember that the cache is bespoke", which reaches `unknownAdjectiveFallback` through a different
gate (the leading "the" as its groundedness signal), never `parseEvery` at all. The literal BARE
phrasing "every cache is bespoke" was, in fact, live proof of this exact bug before the fix (it
minted `cache rdfs:subClassOf bespoke`) — after the fix it correctly declines end-to-end (neither
`unknownObjectFallback`'s class-mint, now blocked by the POS check, nor `unknownAdjectiveFallback`'s
property-mint, which requires an article/capitalization/prior-fact signal a bare "every cache" never
carries), matching the SAME honest-miss discipline as the pre-existing "module is banana" pinned
regression. This is a strictly safer outcome than the pre-fix behavior (an honest decline instead of
a wrong class fact), not a new gap.

**Live verification** (`node bin/tmct.mjs chat`, default persona, no `--repo`, and the automated
suite, `test/chat-teach-quantifier.test.mjs`): "every controller is a handler" still mints a class,
unaffected (both words are already lexicon nouns, so this is resolved directly by the ACE grammar's
own pattern-8 copula match — it never reaches `unknownObjectFallback` at all, confirmed via its
`source: ace:chat:...` provenance on read-back, vs. the fallback cascade's own `source:
teach:chat:...`). "Every cache is a florble" (a genuinely novel out-of-vocabulary noun) still mints a
class — wink's own OOV default tags an unknown word `NOUN`, so the vocabulary-growth mint chain
(`PLAN_TAUGHT_RELATIONS.md` Item 5's sibling) is unaffected. "Every Record is persisted" now mints
`record mgx:hasProperty persisted` (confirmed directly against the stored fact row), not
`rdfs:subClassOf`. `npm test`: 1882/1882 (3 new tests added for this fix; 0 failures, same 1879
pre-existing tests all still pass).

**"cheese is blue" — a separate, DIFFERENT root cause, confirmed NOT fixed by this change.** This
fresh repro was flagged for verification against the fix. Traced precisely: "cheese is blue" never
reaches `unknownObjectFallback`/`unknownAdjectiveFallback` at all. `"blue"` IS already declared in
`lexicon-core.json`'s `nouns` object (`"blue": {}`) — but has **no entry at all** in the `adjectives`
object (confirmed: `lexicon.adjectives.blue === undefined`), unlike its color-sibling `"green"`,
which has both `nouns.green` absent and `adjectives.green: { type: "data" }` declared. Because
`"cheese"` and `"blue"` are BOTH known static-lexicon nouns, `parseAce` (`ace.mjs:454-455`) routes
straight to `parseCopula` (`ace.mjs:417-438`), which — for a single-word complement — tries
`lookupAdjective(lexicon, "blue")` FIRST (`ace.mjs:422-423`, the exact same adjective-first order the
original fix sketch described for `parseEvery`) but MISSES (no adjective entry exists at all), falls
through to `resolveNP` on `"blue"` as a noun (`ace.mjs:425`), and mints `cheese rdfs:subClassOf blue`
directly — a full, non-residue ACE grammar success, so `assertTurn` never falls through to the
`teachLane` fallback cascade this fix touches. This is a **lexicon curation gap** (a missing
adjective sense for one specific word), not the fallback-ordering bug Finding 1 fixes — the two look
similar on the surface (both mis-mint an adjectival word as a class) but are structurally unrelated
bugs in different files. Not fixed here: correcting it would mean editing `lexicon-core.json` (data
only, a well-precedented single-line addition mirroring `"green"`'s existing entry) plus verifying
the resulting `owl:DatatypeProperty` triple shape and its query-side behavior end-to-end — genuinely
small in isolation, but bundled with the "what is blue" gap below, which needs its own investigation
first; left for a future session with both threads in hand rather than a partial fix here.

**The "what is blue" follow-up returned no content — a separate, DIFFERENT bug, now RESOLVED too
(same session).** After "cheese is blue" mints (wrongly, per above) `cheese rdfs:subClassOf blue`,
asking bare "what is blue" (no article) returned tmct's generic orientation card with zero mention of
the fact that literally exists in the graph — even though "what is A blue" (WITH the article) found
it correctly. First hypothesis (a known-lexicon-word vs. taught-term routing asymmetry) turned out to
be a misread of truncated live output under fresh re-verification: BOTH "what is florble" (a purely
taught term) and "what is blue" (a static lexicon word) failed identically for the bare, no-article
phrasing, and both succeeded identically once the article was added — there was never a
lexicon-vs-taught asymmetry at all, just a uniform bare-form bug. Traced to the real root cause:
`factReadBack`'s part (c) (`chat.mjs:5451-5454`) exists SPECIFICALLY to catch the bare "what is X"
shape that the grammar's own T5 template (`grammar.mjs:103-111`) declines to parse for any object
that isn't a closed-set `ENTITY_TO_TYPE` code-graph kind word (`ask-vocab.mjs:352` — neither
"blue" nor "florble" nor "component" qualify), leaving `envelope.parsed` null, this branch's own
trigger condition (`!envelope?.parsed`). But its regex required a MANDATORY article
(`/^what\s+(?:is|are)\s+an?\s+(.+?)[?.!\s]*$/i`) — the opposite of `BARE_WHATIS_RE`'s own
already-established "article optional" convention (`chat.mjs:5777`, `(?:an?\s+)?`, used one function
up in the SAME cascade for the subject-side lookup) — so this branch could never actually fire for
the bare form it exists to catch, for ANY term. **Fixed**: added the same optional-article group
(`(?:an?\s+)?`) to this regex, matching `BARE_WHATIS_RE` exactly. One character (`?`) was the entire
defect. Live-verified: "what is florble" and "what is blue" (both bare, no article) now both answer
"you told me: cache is a kind of florble" / "you told me: cheese is a kind of blue", identical in
shape to their already-working "what is a X" counterparts. Regression coverage:
`test/chat-readback.test.mjs`'s new "the BARE (no-article) 'what is Y' form..." test. `npm test`:
1883/1883 (1 more test than the count above, 0 failures).

---

## Finding 2 — noise-stripping's dependence on wink's generic stopword list is arbitrary, and can corrupt resolution rather than just fail to help [RESOLVED, commit 85d46f0]

**RESOLVED.** Fixed via the "generate a candidate, prune it against the graph" architecture this
finding's own fix sketch called for (below), not the curated verb list round 6 already ruled out.
Re-traced against the real code first — this write-up's diagnosis held with one correction: "hold"
turned out to already be registered `defines`-family vocabulary in `ask-vocab.mjs` (a container-verb
synonym, unrelated to this gap), so it never reaches the bare-"where" branch at all; "save" (no
curated entry anywhere) stood in as the fresh light-verb test case instead.

`noise-strip.mjs`'s `stripNoise()` now also flags KEPT words wink's POS tagger tags `VERB`, reading
the WHOLE original sentence for real grammatical context — an isolated "store router" fragment tags
both words `NOUN` (confirmed live), so this signal only works read off the full sentence, before the
object phrase is extracted. The same "store" in "where would i store a router" tags `VERB`; in "where
does the store live" it tags `NOUN` — both confirmed live, so the general POS signal correctly
resolves the exact case the fix sketch below worried a curated list couldn't. Scoped to exactly the
bare "where"/"mentions" shape (confirmed, by tracing every `keywords.mjs` decomposition branch, as
the one construction with no explicit relation verb gating its object) and attached to the parse as
`altObject` rather than stripped outright — `noise-strip.mjs` still has no graph to check a
resolution against (`interpret/pipeline.mjs`'s own documented boundary), so it proposes a second
reading, it never decides between them.

`ask.mjs`'s `traverse()` — where the graph actually lives — tries both readings at the shared
object-resolution call site and prunes: the reading that misses or ties loses to the one that
resolves cleanly (mirroring `resolveObject`'s own grain-word retry a few lines above it, and
`grammar/ace.mjs`'s `parseAceAmbiguous` — "keep only complete, valid parses, dead ends pruned"); a
genuine case where both readings resolve cleanly to DIFFERENT real entities surfaces as honest
ambiguity through the SAME tier-tie UX `resolveObject` already renders — no third
ambiguity-presentation surface was invented.

Live verification (scratch copy of `examples/mini-webapp`, never the committed fixture): "where
would i store a router" went from a 4/5-way ambiguous dump to a clean single answer identical to
"where is router defined"'s; "where would i save a router" (the fresh, uncurated light verb) went
from 2-way ambiguous to clean, confirming the fix generalizes rather than special-casing "store";
"where is router defined", "where would i keep a router" (the already-fixed case this finding cites),
and "i was wondering what calls addRoute" (a non-"where" noise-strip construction, keyword-spot's
verb-decomposition path) all render byte-unchanged. `npm test`: 1872/1872, same count as before the
fix, 0 failures.

Rounds 3, 5, and 6 converged on the same root cause from different angles; round 6's investigation
(which also disproved a plausible-but-wrong hypothesis — see below) is the most precise and is the
primary source here.

**The mechanism**: `src/interpret/strategies/noise-strip.mjs`'s `stripNoise()` (lines 74-86) treats
a lowercase alphabetic token as strippable "noise" if it's in a curated list (`FILLER_WORDS` +
`CASCADE_NOISE`) OR if `nlp.isStopWord(lc)` returns true. `isStopWord` (`src/ask-nlp.mjs:49`) is a
thin wrapper over wink-nlp's own built-in English stopword dictionary — a generic list, not
purpose-built for this codebase. That dictionary happens to flag some ordinary main verbs ("keep",
"put", "get") as stop words but not their close synonyms ("store", "place", "hold", "save") —
confirmed live, `isStopWord("keep") === true`, `isStopWord("store") === false`. So "where would I
keep a hammer" strips cleanly to "hammer" and resolves correctly, while "where would I store a
router" doesn't strip the verb at all, leaving "store router" as the object phrase handed to
`resolveObject` (`src/ask.mjs`).

**Round 6 disproved the more obvious-looking hypothesis**: this is NOT a `resolveObject` scoring
bug. Traced directly: when `store.mjs`, `router.mjs`, `Store`, and `Router` (all real individuals in
the fixture graph) each have a stem that exactly equals one of the two leftover query words, they
tie honestly under `resolveObject`'s own tiered scoring (`overlap/termComps.length`, normalized) —
a real 4/5-way tie over real graph individuals, the mathematically correct output given that input,
not a defect in the scoring tiers themselves. Round 6 also confirmed a narrow verb-list patch
inside `noise-strip.mjs` (mirroring `WHERE_MARKERS`'s own curated-list pattern) doesn't clear the
bar: the synonyms a real visitor would actually type ("store", "hold", "save", "place") are exactly
the ones most likely to collide with real identifiers in a real repo (`Store`, `Storage`, `save()`),
so curating them in reopens the same false-strip risk on legitimate lookups ("where does the store
live") that the fix is meant to avoid — and a collision-free subset only covers part of the family.

**Why this is out of the fast loop's scope**: `noise-strip.mjs`'s `stripNoise` is a SHARED path —
every query shape that reaches this strategy (not just "where" questions; see
`src/interpret/strategies/keywords.mjs`'s own bare-"where" branch, lines 87-97, which is one of
several consumers) is affected by whatever criteria decide what counts as noise. Changing that
criterion is a broad-surface change with wide regression exposure, not a local patch to one
phrasing.

**A concrete fix sketch, for whoever picks this up**: the same `nlpAdapter()` that backs
`isStopWord` already exposes `posTags()` (`src/ask-nlp.mjs:60`) — the exact mechanism Finding 1's
fix sketch also reuses. A POS-aware criterion ("strip any token wink tags as a main VERB in this
specific no-relation-verb construction, not just the ones on its incidental stopword list") would
close the arbitrary keep/put-vs-store/hold gap at its root, rather than growing a curated list one
synonym at a time. The real cost: `stripNoise` has no notion of *which construction* it's being
asked to strip within today (it's a flat token filter, not construction-aware) — teaching it "a verb
is only strippable when noise-strip is being asked to recover a no-relation-verb 'where' shape"
would need real design work (a construction-scoped variant of `stripNoise`, or a POS check gated
specifically inside `keywords.mjs`'s bare-"where" branch rather than the shared filter), plus a
regression sweep across every OTHER strategy that already depends on `stripNoise`'s current,
narrower criteria not changing underneath it.

---

## Cross-reference check

Neither `archive/PLAN_ADVANCED_GRAMMAR.md` nor `PLAN_AGENTS.md` mentions noise-stripping,
stopword handling, POS-aware disambiguation, or an adjective/noun teach-routing gap anywhere
(grepped directly, zero hits in both) — both findings above are genuinely new gaps, not already
tracked work being duplicated here.

---

## What this doc is not

Not a scoped build plan, not staffed, not blocking any other work. Both findings are now resolved
(see their own sections above for what shipped).
