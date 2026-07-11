# PLAN_CONVERSATION.md — findings that graduated out of the fast loop's safe-fix scope

> **STATUS: Findings 1 and 2 are RESOLVED; Findings 3, 4, and 5 are open** — see each one's own
> section below. Not a build plan with a staged implementation — this doc exists to hold findings
> precisely enough that a future session can pick them up, the same role `PLAN_SYLLOGIST.md` plays for
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
reached a genuine architectural question rather than a small safe fix. This doc is where findings like
those live — traced precisely against the real code below (round 2's own report described its finding
by the wrong mechanism; corrected here), not just transcribed from the rounds' own prose. Findings 3-5
were added in a later session (2026-07-11, live hand-testing) using the same discipline.

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

## Finding 3 — the forward-shape query branch computes `entityType` but never filters on it, so "what modules does X have" answers with function names instead

Found live this session, against a scratch copy of `examples/mini-webapp` (never the committed
fixture): `"what modules does the questboard app have"` answers `"createApp and start."` — the two
`Function`s `defines`-edged from `mod:src/server/app.mjs` — not modules.

**The mechanism**: `traverse()` (`src/ask.mjs:2959`) destructures `entityType` from the parsed query
at line 2966. A forward-shape query's `entityType` flows in from `parseKeywordSpot`
(`src/interpret/strategies/keywords.mjs:285`, `return { shape: "forward", entityType, modifier:
"direct", kind, object: beforeText }`), with a docblock comment right above it (`keywords.mjs:280-
284`) explicitly documenting: "forward keeps the spotted entityType… `traverse()` only consults it
for the commit-as-subject grain selection… plain forwards behave exactly as before." That's kept
structurally: `entityType` is consulted ONLY inside one narrow branch, `kind === "touches" &&
objMatch.class === "Commit"` (`ask.mjs:3194-3196`), which calls `commitTouches(graph, objMatch,
entityType, …)` (`ask.mjs:2910-2931`) — and `commitTouches` DOES filter, at line 2925
(`matches.filter((m) => m.class === entityType)`). Every OTHER forward query falls through to the
general branch (`ask.mjs:3198-3214`), which never references `entityType` at all — `targets`/
`matches` (3211-3213) are built purely from `edgesOfKind(...).filter(e => e.subject ===
objMatch.id)`, no class filter. Contrast the sibling reverse-shape branch (`ask.mjs:3248-3270`),
which DOES filter (line 3253: `subjects.filter(i => i.class === entityType)`) with a documented
family-sibling fallback (`FINE_CLASS_SIBLING = { Function: "Method", Method: "Function" }`,
`ask.mjs:127`, applied at 3261-3268) for when the exact-class filter empties out.

**Why a blind filter is actively wrong here, not just risky**: the committed
`examples/mini-webapp/.tmct/graph.json`'s `defines` predicate never produces a `Module`-classed
target — its `objectProperties` entry lists only `{Class, Attribute, Method, Function}` across 30
real examples. `"have"`/`"has"` is bucketed onto the `defines` kind (`src/ask-vocab.mjs:126-133`,
Module→{Function,Class,Method,Attribute} per its own comment), so naively adding an `entityType ===
"Module"` filter to the forward branch wouldn't surface real modules — it would just turn "createApp
and start" into an honest empty, because the user's real intent ("what modules make up this app")
isn't answerable via the `defines` edge at all. The real fix for THIS specific phrasing is
kind-selection/intent work (routing "modules...have" toward `imports` or a project-structure notion
`defines` doesn't carry), not a results filter.

**Concrete proof a naive filter breaks a currently-passing pinned test**:
`test/chatflow-tier6.test.mjs:507-513` (driven against the SAME committed `examples/mini-webapp`
graph) asserts `"which functions does saveStore call"` answers `/^Task\./` — but
`fn:src/core/model.mjs#Task` is classed `"Class"`, not `"Function"`, in that graph (`saveStore`'s
only `callsSymbol` edge targets it). `"Function"` and `"Class"` aren't `FINE_CLASS_SIBLING` partners
(only `Function`↔`Method` are paired), so mirroring the reverse branch's exact-class filter here
would flip this exact test's expected answer to empty/decline.

**Why this is out of the fast loop's scope**: two independent reasons compound. (1) Semantic
mismatch, not a filter gap — for `defines`, the asked entityType can genuinely never appear among
that kind's real target classes, so filtering alone produces a new honest-empty for a question whose
real fix is intent/kind routing in `ask-vocab.mjs`/`keywords.mjs`, outside `ask.mjs` entirely. (2) A
currently-passing pinned test encodes the filter-less answer as correct — flipping it needs a human
call on whether that pin was itself masking this bug (and should be re-scoped) or is deliberate, plus
new decline-message UX (the existing `wrongGrainMiss` render path, `ask.mjs:3481-3488`, messages a
wrong-grain *resolved subject*, not a wrong-grain *filtered target set* — a forward-side equivalent
needs its own message and its own regression coverage).

**A concrete fix sketch, for whoever picks this up**: add a `kindObjectClass(graph, kind)`-style
check (an existing helper, `ask.mjs:480-489`, already computes a kind's real observed target
class(es) from live edges) at the top of the forward branch (`ask.mjs:3198`) — if `entityType` is set
and doesn't intersect the kind's real target class set, return a NEW forward-specific honest decline
instead of filtering blindly; only apply `subjects.filter(i => i.class === entityType)` (with the
SAME `FINE_CLASS_SIBLING` widen-on-empty fallback the reverse branch already has) when `entityType`
DOES fall within that set. Needs: (a) updating or explicitly re-scoping
`chatflow-tier6.test.mjs:507-513`'s expectation, (b) new regression coverage for the "modules...have"
honest-decline case, and (c) a separate decision on whether "questboard app has modules" should
instead route to `imports` — a kind-selection change in `ask-vocab.mjs`/`keywords.mjs`.

---

## Finding 4 — an anaphoric "SUBJECT VERB which N" inheritance question misroutes into teach-a-fact, and the real gap is wider than the pronoun case alone

Found live this session, against a scratch copy of `examples/mini-webapp`: asking `"what does
createApp call"` (answers correctly) then the follow-up `"it uses which controller as its base"`
answers `"I can't store a fact about \"it\" as a class — pronouns aren't things I can classify."` —
misrouted into the teach lane instead of being recognized as a question at all.

**The mechanism**: `teachLane` (`src/chat.mjs:2367`) is only reached after the query pipeline has
already missed (`chat.mjs:6942`). Inside it, `TEACH_PRONOUN_RE` (`chat.mjs:2365`,
`/^(?:every\s+|...)?(you|i|it|they|he|she|we)\s+\S+/i`) is checked unconditionally FIRST
(`chat.mjs:2409-2419`) — with no `QUESTION_LEAD_RE` guard, unlike every sibling teach frame below it
(`2432`, `2445`, `2461`, `2481`, …) — so any pronoun-subject sentence is swallowed before the rest of
the lane runs at all. `QUESTION_LEAD_RE` (`chat.mjs:1503`,
`^(?:what|who|which|where|when|why|how|is|are|do|does|did|can|could|should|would|will|has|have)\b`)
is sentence-initial only — "it uses WHICH controller as its base" has "which" as its 3rd word, so
even wrapping `TEACH_PRONOUN_RE` in this exact guard would NOT have caught it (confirmed live: this
naive one-liner is insufficient on its own, as suspected going in).

This is NOT only a pronoun-routing problem — confirmed live with the pronoun removed entirely:
`"TaskController uses which controller as its base"` ALSO lands in the teach lane and stores garbage
(`noted — remembered: taskcontroller uses which controller as its base`), via a DIFFERENT frame,
`generalVerbTeach`'s bare path (`chat.mjs:2637-2663`, driven by `GENERAL_VERB_TEACH_RE`,
`chat.mjs:2172`). That path IS gated by `!QUESTION_LEAD_RE.test(...)` (`chat.mjs:2637`), but the same
anchored-only limitation means the guard never fires there either. So `QUESTION_LEAD_RE`'s
anchored-only defect is the true common root, manifesting through two independent, under-guarded
call sites — not a single missing guard on `TEACH_PRONOUN_RE` alone.

Separately, `RELATIONS.inherits` (`src/ask-vocab.mjs:153-186`) has no "uses X as its base" phrasing —
and, more fundamentally, CAN'T be closed by adding one: `VERB_TO_KIND` (`ask-vocab.mjs:346-350`) is a
flat `{phrase: kind}` map, and `findPhrase` (`src/interpret/strategies/keywords.mjs:33-43`) matches
only a CONTIGUOUS run of words. "SUBJECT uses OBJECT as its base" splits the verb ("uses") from the
qualifier ("as its base") AROUND the object — there is no contiguous string to register. Closing this
needs a genuinely new discontiguous-frame recognizer, not a vocabulary-table edit.

A broader sibling gap surfaced while isolating this: "SUBJECT verb which N" reverse questions only
reliably work for SINGLE-predicate relation kinds. `"TaskController inherits which class"` and
`"TaskController is a subclass of which class"` both answer correctly — but `"TaskController uses
which module"` and `"TaskController calls which function"` (well-formed, registered verbs, registered
nouns) BOTH misfire into `generalVerbTeach` and store garbage too, exactly like the repro. `uses`/
`calls` are query-time unions over multiple relation predicates (`ask-vocab.mjs`'s own comment on
`uses`: "query-side union: imports + calls + callsSymbol"); `inherits` is a single stored predicate.
The repro's exact phrasing sits on top of this wider, pre-existing gap.

**Regression coverage already pinning current behavior** (confirmed via grep):
`test/chat-ux.test.mjs:203-287`, `test/chat-teach-quantifier.test.mjs:391`,
`test/chat-indirect-request.test.mjs:83` pin `TEACH_PRONOUN_RE`'s exact decline text and
no-false-positive behavior. `test/ask-vocab.test.mjs:59-60` pins `"which classes is a subclass of
Base"`/`"which classes is a kind of Base"` → `inherits`, but both are the SENTENCE-INITIAL "which N
..." shape, not the repro's mid-sentence "SUBJECT verb which N" shape. `test/ask-vocab.test.mjs:14-
19` asserts every `RELATIONS` verb is claimed by exactly one kind — a collision guard any new
phrase/frame must respect. No test anywhere pins a mid-sentence "which" inside a legitimate
declarative teach sentence, so there's no concrete existing regression to point to for a broadened
detector — but the risk is real in kind: "which" is also a relative-clause word ("the handler which
processes requests"), and nothing today distinguishes interrogative "which" from relative "which"
outside sentence-initial position.

**Why this is out of the fast loop's scope**: three independent, separately-substantial pieces of
work, not a small combination fix. (1) A genuinely new discontiguous verb-frame parser for "uses X as
its base"-shaped constructions — `RELATIONS`' flat contiguous-phrase table architecturally cannot
express this. (2) A POS-aware (not blind-regex) mid-sentence interrogative detector to replace or
extend the anchored-only `QUESTION_LEAD_RE`, applied consistently at both call sites
(`TEACH_PRONOUN_RE` and `generalVerbTeach`'s bare path) — a blind "contains 'which'" broadening risks
misrouting genuine relative-clause declaratives, needing the same wink-adapter POS-disambiguation
caution Findings 1 and 2's own fix sketches already flag. (3) The wider, separate bug that "SUBJECT
verb which N" reverse questions only work for single-predicate relation kinds, not union kinds like
`uses`/`calls` — a gap this repro sits on top of but isn't scoped to. None of these is a one- or
two-line change; each touches shared mechanism with its own pinned-regression surface.

---

## Finding 5 — no query-side shape for CapableOf, reverse-HasA, or reverse-inherits against the general-knowledge persona vocabulary

Found live this session, default persona, no `--repo`: after `"what is a dog"` answers `dog is a
kind of animal` / `dog has tail` / `dog can bark` (three real corpus:human facts), the natural
follow-ups `"can a dog bark"`, `"what can a dog do"`, and `"what has a tail"` ALL fail to parse as any
query shape, falling to the generic "couldn't parse this as a graph question" wall — with
code-graph-flavored rephrase hints that make no sense with no repo loaded and the fact just stated.

**A first-pass guess going into this investigation was "architectural" — traced precisely, that guess
does not hold.** `"what is a dog"` is answered by a subject-indexed, PREDICATE-AGNOSTIC fact dump:
`chat.mjs`'s `factAnswer` (`chat.mjs:3933`), lane (a) (`chat.mjs:3938-3992`), sets `metaTerm` from the
parse, then `factTermVariants`+`factRows` (`chat.mjs:3676-3693`) load every reified `Fact` and
`subjectHits` (`chat.mjs:3968`) keeps every predicate together — no per-predicate branching, which is
exactly why IsA/HasA/CapableOf all render in one answer via `rankByBiasThenTrust` +
`renderFactLine`/`factPhrase` (`chat.mjs:3626-3635`), reading `FACT_PREDICATE_PHRASES`
(`chat.mjs:3504-3529`) — which ALREADY has curated entries for both `"mgx:hasA": "has"` and
`"mgx:capableOf": "can"`.

**Why the three follow-ups fail, traced separately**: (1) `"can a dog bark"`/`"what can a dog do"` —
total parse miss. Neither `grammar.mjs`'s `TEMPLATES` nor `ask-vocab.mjs`'s `VERB_TO_KIND` (built
purely from the 10 code-graph `RELATIONS`) recognizes "can"/"bark"/"do" at all — `envelope.parsed`
stays null, and `factAnswer`'s own regex cascade (`BARE_WHATIS_RE`, `ISA_ASK_RE`, `KNOW_ABOUT_RE`,
`RELATION_FACT_YESNO_RE`, `RELATION_WHO_ASK_RE`) has no shape for "can"/"what can X do" either, so the
pre-existing generic miss text stands untouched. (2) `"what has a tail"` — a different, more
interesting failure: `"has"` IS in `VERB_TO_KIND` via the `defines` relation (`ask-vocab.mjs:126-
134`), so `keywords.mjs` DOES produce a real, non-null parse (`{shape: "reverse", kind: "defines",
object: "tail", entityType: null}`) — aimed entirely at the (absent) code graph, which naturally
misses and renders the code-graph-flavored `"no module matching \"tail\" found in the index."`
Because `envelope.parsed` is non-null here, `factAnswer`/`factReadBack` (lane 3, gated only on
`!handled && memoryDir`) still runs afterward — it just has no regex matching "what has a tail" yet,
so the code-graph miss text stands unreplaced.

**Verdict: SMALL AND SAFE, not architectural** — the corrected read on the operator's own first-pass
guess, confirmed with direct evidence. Every reader in `factAnswer`'s cascade already runs on ANY
existing miss (guarded by `if (!miss) return null;`, `chat.mjs:3993`) and overwrites it on a hit (the
same `replace: miss` contract `ISA_ASK_RE`'s own block already uses, `chat.mjs:4003`) — so a new
reader added to this SAME cascade needs no changes anywhere else (`ask-vocab.mjs`, `ask.mjs`,
`grammar.mjs`, `keywords.mjs` all stay untouched). All the machinery a fix needs already exists and is
predicate-agnostic: `factTermVariants`, `factRows`, `rankByBiasThenTrust`, `renderFactLine`/
`factPhrase`, and `FACT_PREDICATE_PHRASES` already has correct entries for both predicates involved.
No test in `test/` currently exercises a CapableOf query shape at all (only `extensions.test.mjs:39`
touches `mgx:capableOf`, and only as a seed-preference array), so there's no hidden regression risk
from a shape nothing currently pins.

**Why not fixed directly in this dispatch anyway**: even though the mechanism is small and additive,
closing it for real means designing and landing THREE new regex frames with their own edge cases —
`CAN_ASK_RE` (forward yes/no), `WHAT_CAN_DO_RE` (open list), and `WHAT_HAS_RE` (a genuinely new
reverse-by-OBJECT reader, the mirror of every other subject-side reader in this cascade) — plus new
regression coverage (multi-subject dedup, e.g. more than one corpus animal having a tail; a check that
`WHAT_HAS_RE` doesn't accidentally shadow "what has changed"-shaped inputs). That is real, if compact,
feature work landing in `chat.mjs`'s already-large `factAnswer` cascade — this dispatch's own stated
discipline sets the bar for an in-flight fix HIGHER than the fast loop's usual bar, and three new
recognizer frames with real design choices clears "small bugfix" but not that higher bar. Left as a
concrete, ready-to-implement Finding instead.

**A concrete fix sketch, for whoever picks this up** (all inside `src/chat.mjs`'s `factAnswer`
cascade, alongside the existing `ISA_ASK_RE` block, lines 3995-4005, and `KNOW_ABOUT_RE` block,
4009-onward — same `if (!miss) return null;` gating, same "never overrides a real answer" discipline):
1. **`CAN_ASK_RE`** — `/^(?:can|could)\s+(?:an?\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z]+)[?.!\s]*$/i`
   for `"can a dog bark"`: resolve both sides via `factTermVariants`, find a `factRows` hit with
   `predicate === "mgx:capableOf"` matching both — mirrors `ISA_ASK_RE`'s own block almost verbatim.
2. **`WHAT_CAN_DO_RE`** — `/^what\s+can\s+(?:an?\s+)?(.+?)\s+do[?.!\s]*$/i` for `"what can a dog
   do"`: reuse the existing subject-hits/rank/render/paginate block (`chat.mjs:3963-3991`) verbatim,
   with `predicate` hardcoded to `"mgx:capableOf"` instead of derived via `splitMetaPredicate`.
3. **`WHAT_HAS_RE`** — `/^what\s+has\s+(?:an?\s+)?(.+?)[?.!\s]*$/i` for `"what has a tail"`: filter
   `factRows` where `predicate === "mgx:hasA"` and the OBJECT (not subject) matches — the reverse of
   every other reader here; `RELATION_WHO_ASK_RE`/`factReadBack`'s own reverse chase
   (`chat.mjs:3859-3897`) is direct precedent for a reverse-by-object reader in this same file.

**Fresh confirmation (2026-07-11, live-verified): the same gap also covers `inherits`/`subClassOf`
reverse-queries — a taught "X is a kind of Y" fact, not just corpus-seeded HasA/CapableOf.** Exact
transcript, default persona, no `--repo`:

```
tmct> shirehorse is a kind of horse
noted — remembered: shirehorse is a kind of horse

tmct> what inherits from horse
no module matching "horse" found in the index.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>`
or run `npm run example:mini`; tmct doesn't index code itself.)

Goal (inferred): Understand a class hierarchy/inheritance relationship.
```

`"is a kind of"` is a registered `inherits` verb phrase (`ask-vocab.mjs:169`), so `keywords.mjs`
parses `"what inherits from horse"` cleanly and unambiguously (`{shape: "reverse", kind: "inherits",
object: "horse"}` — confirmed by the correctly-inferred Goal line, no ambiguity punt). But the answer
is the exact same code-graph-flavored miss as an unfixed `"what has a tail"` — the `inherits`
reverse-query traversal only ever searches the code graph (verified separately: the identical phrasing
against `examples/polyglot`'s real code graph, `"which classes inherit from IPaymentGateway"`, answers
correctly — this is a real, working code path, just one that never reaches `.tmct/memory/graph.json`).
The taught fact `shirehorse rdfs:subClassOf horse` is sitting right there in the memory graph and is
never consulted. This is the same missing-fact-cascade-reader pattern as `WHAT_HAS_RE`/`CAN_ASK_RE`
above, for a fourth predicate (`rdfs:subClassOf`, i.e. tmct's own `inherits`/"kind of" relation) —
whoever picks up this Finding should treat it as a `WHAT_INHERITS_RE` sibling of the three sketched
above, not a separate investigation.

Note this also closes the loop on `"what is a kind of horse"`'s own genuine parse-level ambiguity (the
`ambiguousParse` surface between a `"meta"` reading and this `"inherits"` reading, `ask.mjs:3455-3461`)
— rephrasing to `"what inherits from horse"` (or bare `"what inherits horse"`) correctly resolves that
ambiguity today; it just then hits this separate, still-open dead end.

---

## Cross-reference check

Neither `archive/PLAN_ADVANCED_GRAMMAR.md` nor `PLAN_AGENTS.md` mentions noise-stripping,
stopword handling, POS-aware disambiguation, or an adjective/noun teach-routing gap anywhere
(grepped directly, zero hits in both) — the findings above are genuinely new gaps, not already
tracked work being duplicated here. A separate "tail" word-sense collision (Unix process vs. animal
body part) investigated the SAME live session is the ONE exception — confirmed as an ALREADY-tracked
gap, `ROADMAP.md`'s "Research horizon" cross-domain-ontology bullet, so it's deliberately NOT written
up as a numbered finding here; see the one-line cross-reference added there instead.

---

## What this doc is not

Not a scoped build plan, not staffed, not blocking any other work. Findings 1 and 2 are resolved (see
their own sections above for what shipped). Findings 3 and 5 come with concrete, evidence-backed fix
sketches ready for a future session (Finding 5's own investigation overturned the operator's initial
"architectural" guess — it is small and safe, just not landed in this dispatch). Finding 4 needs real
design work across three separate sub-problems before any fix, per its own section above.
