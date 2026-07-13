# PLAN_TAUGHT_RELATIONS.md — teaching tmct new RELATIONS and RULES through chat, validated against a classic Prolog family-tree

Status: **DONE (2026-07-09) — all six items + the full storage/query dispatcher are live, plus a
live-testing follow-up (same day) that closed two real gaps the operator found end-to-end testing the
finished build.** All six of the plan's own §1 illustrations (relational fact teach, relation
alias/union, fixed-hop composition, property-filtered composition, adjective-mint,
recursive/reachability) are implemented, tested, and live-verified end-to-end over the classic
family-tree example this document's own "Origin" section named as the validation target. See each
"Phase N — DONE" section below for the full design-vs-implementation record, including the two real
deviations found along the way (the shared `relAsk`/`resolveRelationChase` dispatcher substrate,
Phase 2/4/5's own note; and Phase 6's `findReachableSet` kernel/wiring split). See the "Live-testing
follow-up — DONE" section (just below the Phase notes) for the two post-ship gaps (generic honest-miss
messages; the missing reverse "who is the &lt;relation&gt; of &lt;X&gt;" query shape) and their fixes.
Nothing in the original six-item scope, or the follow-up, remains outstanding.

## Live-testing follow-up — DONE (2026-07-09)

The operator live-tested the full family-tree example end-to-end (all six items, one session) and
found two real gaps, both verified live before AND after the fix — the same rigor this plan's own
"Verification method" section was built with.

**Gap 1 — honest-miss messages were generic, not specific.** `resolveRelationChase`
(`src/chat.mjs`, factReadBack's `(a0)` block) correctly RECOGNIZED the query shape (subject, relation
name, and object all parsed) but, on a failed chase, its caller `return null`ed unconditionally — an
ordinary "I don't know" that the outer `runTurn` cascade then rendered as the GENERIC structural wall
("couldn't parse this as a graph question. Try: …"), which doesn't even mention the relation the user
asked about. Live-verified before the fix: `"is ahab a grandparent of john"` (only 1 hop taught, needs
2) and `"is ahab a grandmother of ishmael"` ("grandmother" never taught at all) both showed the same
generic wall text, indistinguishable from a truly unparseable sentence.

Fixed by distinguishing two cases right in the `(a0)` block, after `resolveRelationChase` misses,
never deferred to the generic wall:
1. The relation/rule NAME itself isn't known at all — neither `relationFactsFor(relationName)` (any
   fact/alias reaching it) nor `findRuleByName` finds anything — decline: `"I don't know a relation or
   rule called '<name>' yet."`
2. The name IS known (a fact/alias reaches it, or a Rule is stored under it), but THIS specific
   (subject, object) pair's chase came up short — decline, naming the relation: `"I know the '<name>'
   relation, but I can't confirm <subject> is the <name> of <object> from what you've told me."`

Live-verified after the fix (piped CLI, fresh tmpdir): both messages render exactly as designed, and
neither matches `WALL_MISS_RE`/`WALL_REPEAT_ONELINER`'s generic wall text.

**Gap 2 — the reverse query shape didn't exist: "who is the grandparent of john".** Every relational
recognizer built so far (`RELATION_FACT_YESNO_RE`, item 1's own query-side fix) is "is X the/a
RELATION of Y" — subject AND object both given, yes/no answer. Nobody had built the REVERSE shape:
given a relation name and an OBJECT, find every SUBJECT that satisfies it. Live-verified before the
fix: `"who is the grandparent of john"` fell all the way to the generic structural wall — not even
recognized as relation-shaped, confirmed by checking `authorLane`'s own `AUTHOR_WHO_IS_RE` (a
different, would-miss-gated git-authorship lane that ALSO structurally matches "who is <up to 4
words>") declines silently for a non-author name, so it wasn't the actual blocker; the query simply
had no recognizer of its own at all.

New closed-set recognizer `RELATION_WHO_ASK_RE` (`src/chat.mjs`) + a new `(a0.2)` block in
`factReadBack`, sitting between the existing `(a0)` yes/no block and `(a0.5)`'s reachability-list
block. Its `resolveRelationChaseReverse` closure re-derives `resolveRelationChase`'s SAME resolution
logic (direct fact, alias via `findIsaChain`, `compose2` via a hop-counted chase, `filter` via a
recursive base-then-property chase) — never duplicating the underlying SEARCH kernels
(`findIsaChain`, `findReachableSet`), only the small, cheap, pure list-builder around them, re-derived
for the same reason `(a0.5)`'s own list block already re-derives `relationFactsFor` rather than
sharing it with `(a0)`: the two regexes never both match the same query (one requires a leading
"who", the other a leading "is/are/was/were"), so the blocks never run in the same call.

The one genuinely new piece of machinery: the `compose2` REVERSE hop-chase. Rather than building a
new search kernel, it inverts the existing edge lookup — seeds `findReachableSet`
(`src/planning.mjs`, reused completely UNCHANGED) from the TARGET object, reverse-hopping via
`base2`'s edges first (the second forward hop, closest to the object) then `base1`'s edges (the first
forward hop), swapping which side of each fact is queried (object instead of subject) at each step,
filtered to results reached at EXACTLY 2 reverse hops (the same exact-hop-count discipline the
forward chase's own `isGoal` uses — never just "reachable within budget"). The citation order is
reversed back to a natural subject→object reading before rendering, since the reverse walk
accumulates actions object-first. The `filter`-rule reverse case recurses into
`resolveRelationChaseReverse` itself for its base (generic over whether that base is a plain relation
or another rule — the same genericity Phase 5's forward `filter` chase already established), then
filters the resulting subjects by the property.

A hit lists every matching subject, one line each (`"<subject> — <citation>"`), citing its own
derivation; no hits renders Gap 1's SAME two-case honest-miss discipline (name unknown vs. name known
but empty for this object) — `"I don't know anyone who is the <name> of <object> from what you've
told me."` for the latter.

**Getting the direction right, live-verified against the operator's own repro, not assumed**: taught
`ahab` fathers `john` fathers `ishmael`, `father ⊑ parent`, `grandparent = parent-of-parent` —
"grandparent OF john" asks for X such that X is john's grandparent, i.e. john is the grandCHILD side;
ahab is john's FATHER (one hop), not john's grandparent, and no data makes anyone john's grandparent,
so `"who is the grandparent of john"` correctly returns an HONEST EMPTY (never ahab, never a wrong
guess). `"who is the grandparent of ishmael"` correctly returns **ahab** (ahab→john→ishmael is exactly
the 2-hop chain the rule needs), citing both hops plus the alias. Both verified live via the piped
CLI before finalizing either message.

Tests: `test/chat-taught-relations.test.mjs`, extended with 8 more tests (Gap 1's two distinct
honest-miss messages; Gap 2's plain-relation/alias/compose2/filter-rule reverse positives, the
compose2 honest-empty negative matching the operator's own repro, and the unknown-name reverse case)
— 26 total in the file. `npm test`: 1400 → 1408, zero regressions in the full suite or in
`test/chat-generalverb-query.test.mjs`/`test/chat-teach-quantifier.test.mjs` (re-run in full,
unmodified). CLI smoke test (`printf 'hi\n/exit\n' | node bin/tmct.mjs`) still exits 0.

## Phase 6 — DONE (2026-07-09) — WIRING half (the kernel, `findReachableSet`, shipped earlier as its own commit)

Item 6 (recursive/reachability rule), landed in `src/chat.mjs` in a follow-up commit right after
Phase 5 above — the LAST of the plan's original six items, completing the full build.

**Teach side**: `RECURSIVE_RULE_TEACH_RE`
(`/^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*),?\s+or\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+\1[.!?]*$/i`),
tried in `teachLane` alongside Phase 4/5's other rule-teach shapes, on the same `ownSrc`. The `\1`
backreference (requiring the recursive slot's trailing name to be the LITERAL SAME word as the rule's
own new name) does double duty: it recognizes the self-referential shape AND guards against a
malformed/mismatched self-reference ever being stored — "a descendant is a parent, or a parent of a
robot" (wrong trailing name) simply never matches the regex at all, an honest structural decline with
zero extra runtime validation code needed. Stores via `appendRule` with `kind: "recursive"`, `slots:
{ baseCase, recStep }` — confirmed live that Phase 3's `RULE_SLOT_SPEC` already had these two
attributes (`mgx:ruleBaseCase`/`mgx:ruleRecStep`) wired since Phase 3, no `memory/core.mjs` change
needed this phase either.

**Query side is the one genuine KIND-CHANGE** among all six items, exactly as the plan's own §1 Item
6 and §4's build-order note anticipated: a new closed-set query recognizer, `RECURSIVE_LIST_ASK_RE`
(`/^list\s+(?:the\s+|all\s+)?([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i`), dispatches
to a NEW block in `factReadBack` (`(a0.5)`, sitting right after the yes/no `relAsk` block, before ISA
membership) — deliberately NOT folded into `resolveRelationChase` (Phase 5's own recursive yes/no
closure), because a reachability-SET enumeration has no yes/no shape to share with it: it dispatches
via the SAME `findRuleByName` "what kind of thing is this name" lookup, then seeds `findReachableSet`
(`src/planning.mjs`, Phase 6's own kernel half, landed earlier and completely UNCHANGED by this
wiring commit — confirmed by rereading it once before use, exactly as this phase's brief asked) from
`baseCase`'s taught edges, stepping via `recStep`'s edges at every hop after the first. The plural
rule name in the query ("descendants") is singularized via `singularizeSurface` (already defined,
reused verbatim from the "some Xs are Ys" teach-side surface) before the `findRuleByName` lookup.

**A genuinely load-bearing design choice, not obvious from the plan's prose alone**: the search
state carries `{ entity, hop }`, but the `stateKey` used for `findReachableSet`'s cycle/dedup
identity is `state.entity` ALONE — deliberately dropping `hop` from the identity (unlike Phase 4's
compose2 chase, whose `stateKey` DOES include `hopsTaken`, because that search needs an EXACT hop
count as its goal). A reachability LIST has no such goal — it wants each node reported once, via its
SHORTEST derivation, never once per hop-count it happens to be reachable at. Keying on `entity` alone
gives exactly that: a node discovered at hop 1 is `seen` by the time a coincidental hop-3 path to the
SAME node would otherwise be explored, so it's recorded once, via the shortest route — and this is
also precisely what makes a genuine CYCLE in the taught edges terminate safely and correctly (see
below), since the same "already `seen`" mechanism that prevents duplicate entries also prevents
revisiting the cycle's own back-edge.

**Cycle safety, live- and test-verified, not just inherited by assertion**: two individuals taught as
each other's parent (`adam` parents `eve`; `eve` parents `adam` — nonsensical family-tree data, but a
real possible user mistake) produces `list the descendants of adam` → `eve` only, in well under a
second, never a hang or a crash — `findReachableSet`'s own `seen`-set guard (already proven in
isolation by Phase 6's kernel-half tests in `test/planning.test.mjs`) carries through end-to-end via
this wiring exactly as designed.

Live-verified the full six-item family-tree chain end-to-end via the piped CLI: relational facts +
alias + compose2 grandparent rule + filter grandfather rule + the recursive descendant rule, all in
one session, plus the cycle-safety and malformed-self-reference cases in a separate session.

Tests: `test/chat-taught-relations.test.mjs`, extended with 5 more tests (recursive-rule storage,
the descendants reachability-list positive case, the cycle-safety case, the malformed-self-reference
decline, and one comprehensive ALL-SIX-items integration test covering every one of the plan's six
capabilities over a single family tree) — 18 total in the file. `npm test`: 1395 → 1400.

**Design-vs-plan deviation check (per the coordinator's own instruction to note whether the Phase
2/4/5 shared-dispatcher pattern held or needed further adjustment)**: it held cleanly, and Phase 6
needed NO further adjustment to that pattern — `resolveRelationChase` (Phase 5's yes/no closure) and
the new `(a0.5)` reachability-list block are SIBLINGS, not a further-merged single dispatcher, because
(exactly mirroring `findActionPath`/`findReachableSet`'s own kernel-level sibling relationship in
`src/planning.mjs`) a yes/no chase and a reachability-set enumeration have irreducibly different
halting/result shapes — forcing them through one shared function would recreate the same complexity
`planning.mjs`'s own header comment already argued against merging at the kernel level. The one thing
duplicated across the two (the `relationFactsFor`-shaped alias-chase closure) is a small, cheap,
pure list-builder — re-deriving it once more here reads more honestly than threading it across two
`if` blocks that never both run in the same call.

## Phase 2 — DONE (2026-07-09)

Item 1's query-side gap (closed here) + item 2 (relation alias/union chase) both landed in
`src/chat.mjs`, largely as designed.

**Item 1's fix**: a single new recognizer, `RELATION_FACT_YESNO_RE` (mirrors
`RELATION_FACT_TEACH_RE`'s "is/are/was/were X the/a/an ROLE of Y" shape, accepting "the" for a
direct query and "a"/"an" for item 2's alias-chase queries below), matched in `factReadBack`
**before** `ISA_ASK_RE` gets a chance at the shape — checked live and confirmed load-bearing:
`ISA_ASK_RE`'s own "a"/"an" alternation ALSO matches "is ahab a parent of john" (backtracking
"parent of john" into its single free-form object capture), and since `ISA_ASK_RE`'s own block
always `return`s (a hit or an explicit `null`), whichever regex's block runs first wins the shape
outright — a placement decision, not a regex-disjointness one. "is ahab the father of john" (no
"of"-chase, literal "the") never collided with `ISA_ASK_RE` at all (that regex has no "the" in its
alternation), so item 1's own fix needed no such precedence fight — only item 2's "a"/"an" forms did.

**Item 2's teach-side** landed exactly as the plan's own Verification finding 1/2 scoped it: a
one-line normalization (`stripKindOf`, `src/chat.mjs`, alongside the existing `stripYour`) folds
"is/are/was/were (a/an) kind/type of " down to "is/are/was/were a " right after the copula, applied
to both `raw` and `wrapped` before any teach regex ever sees the sentence. "a father is a kind of
parent" now normalizes to "a father is a parent", which `unknownSubjectFallback` already stores as
`father ⊑ parent` today (no new mint path, no new predicate, exactly as designed).

**Item 2's query-side** (the genuinely new work): `factReadBack`'s new `relAsk` block —
`relationFactsFor(name)`, a small local closure, enumerates every stored Fact whose predicate
resolves to the queried relation name either DIRECTLY (a mechanical inverse of
`generalVerbPredicate`, `relationRoleWord(predicate)` — "mgx:father" -> "father") or via a TAUGHT
`rdfs:subClassOf` chain over relation-NAME strings, reusing `findIsaChain`
(`src/syllogise.mjs`) **completely unmodified**, exactly as the plan's own §1 Item 2 recommended —
candidate enumeration is bounded by facts that already connect the query's exact (subject, object)
pair, never the whole vocabulary. A hit cites BOTH the direct relational fact and the alias fact
that licensed reading it under the queried name; no hit (a genuinely un-taught relationship, with or
without an alias in play) declines with `null`, the same "never a guessed no" discipline every other
yes/no reader in this file already follows. `relationFactsFor` is deliberately written as a small,
reusable list-builder rather than an inline filter, anticipating Phase 4's compose2 rule chase (next
in this plan's build order) reusing the identical candidate-fact substrate for its own per-hop edge
lookup — noted here so Phase 4's own entry doesn't have to re-derive why the shape looks that way.

Tests: `test/chat-taught-relations.test.mjs` (new file), covering direct readback, "kind of"/"type
of" teach normalization, the alias-chase positive case (citing both facts), and a negative case (an
alias relationship never taught, honest decline). `npm test`: 1382 → 1386 (+4).

## Phase 4 — DONE (2026-07-09)

Item 3 (fixed-hop `compose2` composition rule), landed in `src/chat.mjs` in a follow-up commit
right after Phase 2 above, exactly as designed — including the hop-counting nuance the plan itself
flagged as the real risk, verified live to be NECESSARY, not just theoretically prudent (see the
negative tests below).

**Teach side**: `COMPOSE2_RULE_TEACH_RE` (`/^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+([a-z][\w-]*)[.!?]*$/i`),
tried in `teachLane` right after item 1's `RELATION_FACT_TEACH_RE` block, on the same `ownSrc`.
Re-verified the plan's own disjointness claim against the REAL regexes (not just the design doc):
`RELATION_FACT_TEACH_RE` requires a literal "the" with no second "of"-clause; `COMPOSE2_RULE_TEACH_RE`
requires "a"/"an" in BOTH determiner slots plus a second relation-name word after "of" — confirmed
structurally disjoint, and confirmed live (teaching "ahab is the father of john" alongside "a
grandparent is a parent of a parent" in the same session stores exactly one Fact and one Rule, no
cross-contamination). Stores via `appendRule` (already landed, Phase 3) with `kind: "compose2"`,
`slots: { base1, base2 }` — never a Fact.

**Query side**: extends Phase 2's `relAsk` dispatcher with a third step, reusing Phase 2's own
`relationFactsFor(name)` list-builder unmodified as the per-hop edge lookup (so a compose2 rule's
base relations are ALSO alias-chased — "parent" resolves through the taught "father ⊑ parent" link
exactly the way a direct query does, needed for the family-tree illustration itself, since no fact is
ever taught directly under the literal word "parent"). Verified the naive version FIRST, live, per
the coordinator's own instruction not to assume the hop-counting nuance was necessary — confirmed it
really does over-generate: without the `hopsTaken` discipline, a plain `entity === target` goal at
any depth would (and, in an early throwaway version, did) let a 1-hop "is ahab a grandparent of john"
(john is ahab's CHILD, one hop, not two) falsely resolve yes off the same father/parent edges the
true 2-hop query uses. Fixed exactly as the plan specified: the search state is `{ entity,
hopsTaken }`; `applyActions` dispatches on `hopsTaken` to select `ruleBase1`'s edges (hop 0) vs
`ruleBase2`'s edges (hop 1); `isGoal` requires `hopsTaken === 2 && entity === target`, never just
`entity === target` at any depth. Reuses `findActionPath` (`src/planning.mjs`) unmodified — the
hop-count discipline lives entirely in the caller-supplied `applyActions`/`isGoal`, not in
`findActionPath` itself.

**Two negative tests prove the hop-count discipline is load-bearing, not decorative** (per the
coordinator's own instruction to prove it, not just assert it): a 1-hop father/parent edge
(ahab -> john) and a 3-hop father chain (ahab -> john -> ishmael -> shem) BOTH correctly decline "is
ahab a grandparent of \<X\>" in the SAME store where a genuine 2-hop pair (ahab -> ishmael) resolves
yes — live-verified via the CLI (transcript below) and pinned in `test/chat-taught-relations.test.mjs`.

Live-verified the full family-tree chain from this plan's own illustration end-to-end (teach the two
father facts, the father⊑parent alias, and the compose2 grandparent rule; ask the direct relational
question, the alias-chased question, and the full 2-hop compose2 question — all three resolve yes,
citing the complete derivation; a 1-hop and a never-taught relation both decline honestly in the same
session). See `HANDOVER.md`/the implementing session's own report for the verbatim transcript.

Tests: `test/chat-taught-relations.test.mjs`, extended with 5 more tests (compose2 storage,
hop-counted positive, both hop-count negative cases, one full-chain integration test) — 9 total in
the file. `npm test`: 1386 → 1391 (+5 this commit; +9 total across both phases).

## Phase 5 — DONE (2026-07-09)

Item 4 (property-filtered composition rule), landed in `src/chat.mjs` in a follow-up commit right
after Phase 4 above.

**Teach side**: `FILTER_RULE_TEACH_RE`
(`/^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+who\s+(?:is|are)\s+([a-z][\w-]*)[.!?]*$/i`),
tried in `teachLane` right after Phase 4's `COMPOSE2_RULE_TEACH_RE` block, on the same `ownSrc`.
Structurally disjoint from `COMPOSE2_RULE_TEACH_RE` by anchor word alone ("who", never a second
"of"), re-verified against the real regex, not just the design doc's own claim. Stores via
`appendRule` with `kind: "filter"`, `slots: { base, property }` — confirmed live that Phase 3's own
implementation note held exactly as documented: `filter`'s `base` slot writes to the SAME
`mgx:ruleBase1` attribute `compose2`'s first slot uses (`RULE_SLOT_SPEC` in `src/memory/core.mjs`
already had this wired since Phase 3 — no `memory/core.mjs` change needed at all this phase, pure
`chat.mjs` work).

**Query side — the one real design deviation this phase needed, flagged explicitly per the
coordinator's own brief**: the plan's §3 sketch described `filter` as a THIRD independent branch
alongside `compose2`'s. Implementing it that way would have meant literally copy-pasting Phase 2/4's
three-step (direct/alias/compose2) dispatch logic a second time just to add a fourth "look up the
base again" step — instead, the existing inline code inside `relAsk`'s `if (subject)` block was
PULLED OUT into one named, explicitly RECURSIVE closure, `resolveRelationChase(name, subject,
object)`: steps (i)/(ii) (direct fact + alias chase) are the base case; step (iii) (compose2 hop
search) and the new step (iv) (`filter`) are both `if` branches inside the SAME function; step (iv)
resolves its own `base` slot by **calling `resolveRelationChase` again** — generic over whether that
base turns out to be a plain relation (recursing into steps i/ii) or another Rule (recursing into
step iii's compose2 chase), exactly the genericity §3 always specified, but which the Phase 2/4 code
as literally landed hadn't yet been reshaped to actually deliver (it was three sequential ifs in one
function body, not a function that could call itself). This is a refactor of already-shipped Phase
2/4 code, not just an addition — re-ran the FULL Phase 2/4 test suite unmodified after the refactor
to confirm zero behavior change to the existing dispatch (all 9 pre-existing tests in
`test/chat-taught-relations.test.mjs` passed unchanged before a single new Phase 5 test was added).

A `filter` hit requires BOTH: (a) `resolveRelationChase(base, subject, object)` resolves (the base
relation/rule holds for this exact pair), AND (b) the SUBJECT carries the property literal
(`mgx:hasProperty(subject, property)`, a plain Fact lookup over `rows`, the same read path Phase 2/4
already established `readFactRows` backs). Either failing declines (never a guessed yes) — live- and
test-verified as two DISTINCT failure modes, not conflated: a case where the base chase itself fails
outright, and a separate case where the base chase SUCCEEDS (proven by a sanity query against the
un-filtered base rule in the same store) but the property filter correctly EXCLUDES the candidate
because no matching property fact was ever taught. Also live-verified the genericity claim
concretely, not just asserted: a `filter` rule whose `base` is a PLAIN taught relation (never a
compose2 rule at all — "an uncle is a parent who is male", filtering the alias-chased "parent"
relation directly) resolves through the exact same `resolveRelationChase` code path as the
compose2-base case, with zero special-casing.

Live-verified the full family-tree chain end-to-end via the piped CLI: father facts + the
father/mother⊑parent aliases + the compose2 grandparent rule + "ahab is male" (taught via the
pre-existing wrapped `TEACH_PROPERTY_RE` surface — confirmed live which of Phase 1's two paths
actually carries it: bare "ahab is male" is 3 words with no code-ish token, so it never reaches
`teachLane` at all, intercepted upstream by `isConversational`'s ≤3-word catch-all per the plan's own
Verification finding 4; `unknownAdjectiveFallback` also declines for it even when wrapped, since bare
lowercase "ahab" carries none of that function's own subject-groundedness signals — so the WRAPPED
"remember that ahab is male" lands via the pre-existing, deliberately-out-of-scope `TEACH_PROPERTY_RE`
gap, Verification finding 3, not the new Phase 1 fallback) + the filter grandfather rule — all
resolve correctly, including the negative filter case (a second grandparent, taught via mother/alias
with no gender fact at all, correctly declines the grandfather filter while still resolving yes to
the plain grandparent query in the same store).

Tests: `test/chat-taught-relations.test.mjs`, extended with 4 more tests (filter storage, positive
compose2-base chase, negative "base holds/filter excludes" case, positive plain-relation-base case)
— 13 total in the file. `npm test`: 1391 → 1395.

## Phase 3 — DONE (2026-07-09)

Rule storage foundation landed in `src/memory/core.mjs`, pure plumbing per §4's phase list — zero
`chat.mjs` behavior change, no new teach-shape recognizers wired anywhere. `RULE_CLASS = "Rule"`
added to `recountClasses`'s fixed class-name array; `appendRule(dir, { name, kind, slots,
provenance, createdAt })` mirrors `appendFact` exactly (same load→mutate→write discipline, same
content-addressed-id-upserts convention); `findRuleByName(memory, name)` proves the stored shape
answers the future query-dispatcher's "what kind of thing is X" lookup (§2's closing paragraph),
without building the dispatcher itself (that's Phase 4/5/6). New `test/memory-rules.test.mjs`, 9
tests. `npm test` 1361 → 1371 (concurrent `chat.mjs` work in the same window added its own tests
too, so 1371 isn't purely +9 — the Rule-storage tests themselves are the 9 in the new file).

Two small adjustments to §2's original design, found while implementing (both resolved in the
direction §2's own prose already pointed, not a redesign):

- §2's slot-attribute list names only 5 `mgx:rule<Slot>` attributes total
  (`ruleBase1`/`ruleBase2`/`ruleFilterProperty`/`ruleBaseCase`/`ruleRecStep`) even though `filter`'s
  `slots` object has TWO keys (`{ base, property }`). Resolved by having `filter`'s `base` slot
  write to `mgx:ruleBase1` — the SAME attribute compose2's first slot uses — since §3's own
  query-dispatcher design already reads a filter rule by "recursively resolv[ing] `ruleBase1`'s
  candidate set," i.e. §3 had already assumed this exact attribute-name reuse; §2's slot list was
  just one short. No separate `mgx:ruleBase` attribute exists.
- §2 doesn't show `mgx:ruleName` in `appendRule`'s attribute list explicitly (only inferred from
  §2's own closing paragraph and §3's dispatcher design). Implemented as a plain top-level attribute
  written by `appendRule` itself, alongside `mgx:ruleKind` — confirmed this is what `findRuleByName`
  needs to scan on.

Provenance/trust reuse claim **held exactly as claimed**: reread `syncFactSources`
(`src/memory/core.mjs:268-283`) and `recomputeFactTrust` (`:254-262`) in full — neither checks
`individual.class`/`fact.class` anywhere in either body (both only touch `.attributes`/`.id`/
`.label`), so a `Rule` individual carrying the same `mgx:factProvenance` compat attribute rides the
identical Source-derivation + trust-materialisation pipeline with zero code changes to either
function. Proven by a dedicated test (not just "the code looks unchanged"): the same provenance tag
taught once as a Fact and once as a Rule in the same store produces an identical `mgx:trustScore`.

"Re-teaching a different rule under the same name" (§2/requirement 3) resolved as: a distinct
content-addressed id (kind+name+slots all feed the hash), so both the original and the redefinition
coexist as separate `Rule` individuals sharing one `mgx:ruleName` — the same non-merging precedent
`appendFact` already sets for two Facts sharing a subject but differing predicate/object. Picking
"which one wins" at query time is explicitly left to the Phase 4/5/6 dispatcher, not decided here.

## Phase 1 — DONE (2026-07-09)

Item 1 (relational fact teach) and Item 5 (adjective-mint) both landed in `src/chat.mjs`, exactly
as this doc's own §1 subsections specified, with one implementation adjustment for Item 5 found
live (below) — everything else held as designed, including the load-bearing detail that Item 1's
literal `the` anchor keeps it structurally disjoint from Item 3's future indefinite-article
regex.

**Item 1** (`RELATION_FACT_TEACH_RE`, `src/chat.mjs`, defined right after `OWNS_PASSIVE_TEACH_RE`;
matched in `teachLane` right after the passive-ownership block, before `SOME_A_FEW_RE`): "ahab is
the father of john" mints an ordinary Fact (`teachFact`) with `predicate: await
generalVerbPredicate(m[2])` — reused verbatim, no sibling function, exactly as designed.
Query-side needed **no new machinery**: `"what do you know about ahab"` (factAnswer's
`KNOW_ABOUT_RE`) and `"does ahab father john"` (factReadBack's pre-existing general-verb yes/no
reader) both already confirm the taught fact correctly. One thing live-tested and NOT used: `"is
ahab the father of john"` does **not** resolve correctly today — it accidentally matches
`IS_ADJECTIVE_YESNO_RE`'s unrestricted backtracking (mis-splits "ahab the father of" as the subject
and "john" as a bogus adjective, then declines with a confusing, wrong-shaped message). A genuine
"is X the ROLE of Y" reader is real Phase 2+ work; not built here, per the plan's own scoping.

**Item 5** (`unknownAdjectiveFallback`, `src/chat.mjs`, a standalone function tried in `teachLane`
right after `unknownObjectFallback` declines and before the wrapped-only `TEACH_PROPERTY_RE`
block): mints `mgx:hasProperty`, no quantifier, exactly as designed, gated on subject-side
groundedness (`isGroundedTerm`) or a bare Capitalized name-shaped token.

**Adjustment found live** (the one place the original design needed sharpening, not a redesign):
the plan's stated guard ("subject grounded via `isGroundedTerm`, OR bare Capitalized") turned out
to be too permissive on its own — it reopened the pre-existing, explicitly pinned "module is
banana" regression (`test/chat-teach-quantifier.test.mjs`, `test/wiring-facts.test.mjs`, both from
commit `901528f`): a bare KNOWN-lexicon-noun subject with no article/capitalization/quantifier and
an unrecognized bare object must stay a plain honest miss, and a naive `isGroundedTerm(subjectRaw)`
check (true for any known lexicon noun, including a completely bare "module") would have silently
minted it as a property instead. Fixed by requiring an explicit "deliberate entity reference"
signal alongside plain lexicon groundedness: a subject grounded ONLY by a bare static-lexicon match
(no article, no capitalization) does not qualify on its own — a stripped leading article ("the
cache" → "cache"), a capitalized name-shape ("Mary"), or a prior-TAUGHT fact anchor
(`isGroundedByFact`) each stand in for the "this is deliberate teaching, not ordinary bare prose"
signal a quantifier provides for `unknownObjectFallback`'s own class-mint (property claims have no
quantifier to lean on instead). "the cache is bespoke" (wrapped — see below) and "TaskController is
bespoke" (bare, capitalized) both mint correctly under this tightened guard; "module is banana"
still declines, confirmed unchanged by the full pre-existing test suite (1371 → 1377, zero
modifications to any existing test).

**A second, cross-cutting finding, confirmed live, sharper than the plan's own Verification finding
4**: the plan named the risk as "`isConversational`'s ≤3-word heuristic can swallow a short
teach-miss's own honest DECLINE text." Live-testing the plan's own canonical illustration, bare
`"mary is female"`, showed the risk is stronger than that: `runTurn`'s lane order runs "(2)
conversational orientation" strictly BEFORE "(4) TEACH" — so a short (≤3-word), non-code-ish bare
sentence never reaches `teachLane` AT ALL, success or failure, not merely "reaches it and then has
its decline text overridden." The literal bare `"mary is female"` (3 words, no code-ish token)
returns the generic orientation card with `miss: true` and nothing stored; the wrapped `"remember
that mary is female"` (5 words) escapes the word-count gate and stores correctly (though via the
pre-existing, deliberately out-of-scope `TEACH_PROPERTY_RE` gap in this specific case, since bare
lowercase "mary" carries none of `unknownAdjectiveFallback`'s own groundedness signals either); a
bare, capitalized, code-ish-shaped subject ("TaskController is bespoke") escapes the word-count gate
on its own and mints via `unknownAdjectiveFallback` itself, proving the new function's own success
path displays correctly end-to-end whenever the lane is actually reached — confirming the plan's own
claim that a SUCCESS is never gated on `isConversational` (a success makes `miss` false immediately,
so `isConversationalCandidate`'s own `miss` precondition can't fire). This distinction (routing
pre-emption vs. decline-text override) is recorded here because it changes what a future "fix
isConversational" follow-up actually needs to do — widen when the teach lane is CONSULTED, not just
when its decline text is allowed to stand. 

Both items' tests live in `test/chat-teach-quantifier.test.mjs` (six new tests, all passing
alongside the full pre-existing suite, unmodified). `npm test`: 1371 → 1377.

## Origin

2026-07-09 session. The operator's own framing, verbatim (this is the design target, not a
paraphrase):

> minimum system wiring, maximum learning through chat

The engine ships the smallest possible number of GENERIC teaching-shape recognizers plus a
generic rule-store and query dispatcher; it contains ZERO domain-specific vocabulary — no
hardcoded "grandparent," "father," "descendant," "male," anywhere in the code. Every one of those
words is something a user *teaches* tmct, in an ordinary chat turn, never something tmct ships
already knowing. The classic Prolog family-tree example (father/mother/parent/grandparent/
grandfather/descendant) is the validation target, exactly the way `PLAN_HANOI.md` used Towers of
Hanoi and `PLAN_GUESS_NUMBER.md` used "I am thinking of a number" — a well-understood benchmark to
check the design against, not a feature to ship pre-baked.

Six capabilities were scoped in conversation. This document reproduces and verifies each
illustration against the REAL code (`src/chat.mjs`, `src/memory/core.mjs`, `src/syllogise.mjs`,
`src/planning.mjs`, `src/grammar/lexicon.mjs`, `src/grammar/lexicon-core.json`) — several of the
conversation's own assumptions turned out to be wrong or incomplete when checked live; those are
called out explicitly, not silently corrected.

## Verification method

Every illustrative sentence below was run against the actual CLI (`node bin/tmct.mjs`, fresh
`.tmct/` per test, never committed) before being designed against, not just read out of a
docblock. Three findings that came directly out of that live-testing are load-bearing for this
design and are surfaced up front because they change what "zero new work" actually means for two
of the six items:

1. **Item 2's "kind of" phrasing does not work today, at all.** `"a father is a kind of parent"`
   reaches neither `unknownSubjectFallback` nor `unknownObjectFallback` nor `TEACH_PROPERTY_RE` —
   every one of those regexes requires a **single-token** object at the end of the string, and
   `"kind of parent"` is three tokens. Live-tested: it falls all the way through `teachLane`
   (returns `null` — not even the lane's own honest-miss text) to the structural code-graph ask
   lane, which reports "couldn't resolve one of the terms in this question." "Kind of" is
   understood only as an OUTPUT phrasing (`predicatePhrase`, `src/chat.mjs:2842`,
   `"rdfs:subClassOf": "is a kind of"`) and as a QUERY-side recognizer (`KIND_OF_RE`,
   `src/chat.mjs:3412`, for "what kind of thing is an X") — never as TEACH input. See item 2 below.
2. **The plain (no "kind of") phrasing `"a father is a parent"` DOES already store today** — but
   for a reason that doesn't generalize: `"parent"` is already a lexicon **noun** in
   `src/grammar/lexicon-core.json` (`{"parent": {"property": "object"}}` — the OO "parent
   class"/"parent module" sense), confirmed absent for `"father"`/`"grandfather"`. Live-tested:
   `"a father is a grandfather"` (a true kinship pair, neither side in any lexicon) correctly
   declines with the grounding-hint text (`ungroundedPairHint`, `src/chat.mjs:1570`). The
   conversation's own example accidentally exercised a pre-existing code-vocabulary collision, not
   a working general aliasing path — see item 2.
3. **A pre-existing, unguarded gap on the WRAPPED property-teach surface.** Live-tested:
   `"remember that zorp is florpy"` — two completely fictional words with no relation to anything
   tmct knows — is minted immediately, no decline, no hint:
   `noted — remembered: zorp is florpy`. `TEACH_PROPERTY_RE` (`src/chat.mjs:1396`, matched at
   `src/chat.mjs:2116-2124`) has **no vocabulary or groundedness check on either side at all** —
   unlike `unknownSubjectFallback`/`unknownObjectFallback`'s explicit "never mint between two fully
   ungrounded terms" discipline (`ungroundedPairHint`'s whole reason to exist). This is a real,
   already-shipped asymmetry the new adjective-mint work (item 5) must not make worse, and
   arguably should tighten while it's in the neighborhood — see item 5 and the open risks.
4. **`isConversational`'s ≤3-word heuristic can swallow a short teach-miss's own honest text.**
   Live-tested: bare `"mary is female"` (3 words, no code-ish token) does **not** show `teachLane`'s
   specific decline at all — it shows the generic orientation card ("I'm tmct — a deterministic,
   offline chat assistant…"). `src/chat.mjs:800-808` (`isConversational`) returns true for any
   ≤3-word, code-token-free line; `isConversationalCandidate` (`src/chat.mjs:4988`) is gated on
   `miss` already being true, so this **overrides** `teachLane`'s own honest-miss text with the
   generic wall for any short declarative that the teach lane declined. `"a father is a
   grandfather"` (5 words) escapes this and shows its real decline; `"mary is female"` (3 words)
   does not. This is a cross-cutting risk for item 5 specifically (its own canonical illustration
   is exactly 3 words) — see open risks.

## 1. The six capabilities — recognizer shapes and exact `teachLane` dispatch slotting

`teachLane` (`src/chat.mjs:1926`) dispatches, IN ORDER, on a single `payload` string derived from
the raw query:

```
1954  TEACH_PRONOUN_RE guard (early decline)
1970  OWNS_TEACH_RE          — "<Name> owns/maintains <X>"
1982  OWNS_PASSIVE_TEACH_RE  — "<X> is owned by <Name>"
2001  SOME_A_FEW_RE          — "some/a few Xs are Ys"
2053  generalVerbTeach       — wrapped-only; stands down on ANY is/are/am/owns/maintains
                                anywhere (GENERAL_VERB_ANYWHERE_EXCLUDE_RE, :1777)
2061  payload assembly       — wrapped-with-is/are, or bare BARE_DECLARATIVE_RE (:1335)
2089  assertTurn loop        — the real ACE grammar (grammar/ace.mjs)
2102  unknownSubjectFallback — unknown X, known-or-mintable Y (noun→subClassOf, adj→hasProperty)
2110  unknownObjectFallback  — known X, "every/each/all"-gated mint of unknown Y (subClassOf only)
2117  TEACH_PROPERTY_RE      — wrapped-only, "<X> is <bare-word>" → hasProperty, NO vocab check
2174  honest miss + hints    — teachSuggestion / ungroundedPairHint
```

### Item 1 — relational fact teaching: `"ahab is the father of john"`

Live-tested: today this reaches NO recognizer (`"the father of john"` is a multi-token object, so
neither `UNKNOWN_SUBJECT_RE` (:1475) nor `BARE_DECLARATIVE_RE` (:1335) nor `TEACH_PROPERTY_RE`
(:1396, and unwrapped anyway) matches) and falls through `teachLane` returning `null`, landing on
the structural ask-lane wall ("couldn't resolve one of the terms in this question").

**New closed-set regex**, tried on the SAME `ownSrc` (`wrapped ?? raw` minus trailing punctuation,
:1969) the ownership block already uses, right after `OWNS_PASSIVE_TEACH_RE` (:1982-1988) and
before `SOME_A_FEW_RE` (:2001) — i.e. grouped with the other relational/possessive shapes, and
unconditionally ahead of `generalVerbTeach`'s call site (:2053), so `GENERAL_VERB_ANYWHERE_EXCLUDE_RE`
never gets a say (no change to that regex needed — only dispatch ORDER, a new call site earlier in
the same linear cascade):

```js
const RELATION_FACT_TEACH_RE =
  /^([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+(?:is|are|was|were)\s+the\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[.!?]*$/i;
```

`m[1]` = subject ("ahab"), `m[2]` = role noun ("father"), `m[3]` = object ("john") — same 1-2 token
name-capture convention `OWNS_TEACH_RE`'s subject/owner already use (:1369).

**Predicate minting**: reuse `generalVerbPredicate` (`src/chat.mjs:1799-1811`) **verbatim, no
sibling needed** — it is implementation-agnostic to part of speech (lowercase → `has`/`have` →
`HAS_A_PREDICATE`, else `proseLemma()`-lemmatized → `mgx:<lemma>`). A role noun like "father"
lemmatizes to itself; the `has`/`have` branch is simply never hit for a role word. Checked against
`prose-nlp.mjs:27-50` (`proseLemma`, wink-nlp lemmatiser, degrades to identity when the optional
wink model isn't installed) — no new normalization module needed.

Write: `teachFact(memoryDir, sessionId, { subject: m[1], predicate: await generalVerbPredicate(m[2]),
object: m[3] })` — an ordinary Fact, exactly `appendFact`'s existing shape
(`src/memory/core.mjs:462-502`). No new storage.

### Item 2 — relation alias/union: `"a father is a kind of parent"`

**Teach side — the conversation was partly wrong** (see Verification finding 1/2 above): zero new
storage is correct in spirit (the plain "X is a Y" shape, once both sides are grounded, already
lands as `rdfs:subClassOf` via the existing `unknownSubjectFallback`/`unknownObjectFallback`
cascade — this part of the operator's insight holds), but the literal `"is a kind of"` surface is
NOT accepted input today. Minimal fix, in keeping with "no new storage": a one-line normalization
inserted immediately before the `UNKNOWN_SUBJECT_RE`/`BARE_DECLARATIVE_RE` match sites, stripping a
`"\s+(?:a\s+)?kind\s+of\s+"` / `"\s+(?:a\s+)?type\s+of\s+"` run down to a bare `" a "`/`" an "` right
after `is/are/was/were`, so `"is a kind of parent"` normalizes to `"is a parent"` before any teach
regex sees it — recognition stays exactly as closed (still only `X is a Y`, just one more
determiner-phrase spelling of "a"), no new mint path, no new predicate.

**Query side — genuinely new work, and the part the conversation actually scoped correctly.**
Resolving `"is X the grandfather of Y"` or `"is X a parent of Y"` when only `"father"`/`"mother"`
facts exist (plus a taught `father ⊑ parent` / `mother ⊑ parent` alias) needs to walk the
`rdfs:subClassOf` graph over PREDICATE-NAME strings, not class individuals.

`findIsaChain` (`src/syllogise.mjs:289-327`) IS generic enough to reuse **as-is** for the forward
direction (`subj` is a leaf relation name like "father", `targets` is `{"parent"}` — its `subj`/
`typeEdges`/`subClassEdges` are plain, unlabelled term strings, no notion of "these are classes"
baked in anywhere in the function body). It is **not** directly reusable for the reverse direction a
query needs ("which leaf relation names specialize the queried name `parent`?") — `findIsaChain`
only walks outward from a known start node toward a target set, never "give me everyone who reaches
this target." Recommended approach (no new pure-kernel code): enumerate the SMALL set of
already-taught fact-predicates that touch the query's subject/object pair (bounded by the fact
store, never the whole vocabulary), then call `findIsaChain(candidatePredicate, {queriedName}, ...)`
once per candidate — reusing the function completely unmodified, just choosing the search order
differently from a whole-graph reverse-index build. A reversed-edge-list wrapper
(`deriveSubClassClosure`'s (`src/syllogise.mjs:78-124`) internal `succ` map trivially inverts by
swapping which side of each `[a,b]` pair is the key) is the fallback if candidate-enumeration proves
too narrow in practice, but is not needed for the six items scoped here.

### Item 3 — fixed-hop composition: `"a grandparent is a parent of a parent"`

**New closed-set teach shape**, storing a RULE (see Section 2), tried in the SAME dispatch
neighborhood as item 1 (relational facts) but distinguishable by its own anchor phrase — "a NAME is
a REL of a REL" never collides with `"X is the ROLE of Y"` (item 1) because item 1 requires a literal
`the` + two ENTITY terms; item 3's shape is `"a <NAME> is a <REL> of a <REL>"`, both slots
INDEFINITE-article + a bare relation-name word, no entity terms at all:

```js
const COMPOSE2_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+([a-z][\w-]*)[.!?]*$/i;
```

`m[1]` = new rule name ("grandparent"), `m[2]`/`m[3]` = the two base relation names ("parent",
"parent" — may differ, e.g. a not-in-scope "an aunt is a sibling of a parent"). Stores a `Rule`
individual (Section 2, kind `compose2`), never a Fact — this is the collision risk Section 6 names
explicitly against `unknownSubjectFallback`/`unknownObjectFallback`'s OWN regexes (both require a
SINGLE-token object; `"a parent of a parent"` is four tokens, so neither ever mis-claims this
sentence — verified structurally, matching the same reasoning already used for item 1).

**Query side**: `findActionPath` (`src/planning.mjs:77-109`) reused, but the naive call
(`applyActions` = the rule's base relation's edges, `isGoal` = `entity === target`) OVER-generates:
a coincidental 1-hop or 3-hop path through the SAME edge relation would falsely satisfy a rule that
must be EXACTLY 2 hops. Fix: the search `state` must carry `{ entity, hopsTaken }`, `applyActions`
dispatches on `hopsTaken` to pick `ruleBase1`'s edges (hop 0) vs `ruleBase2`'s edges (hop 1), and
`isGoal` requires `hopsTaken === 2 && entity === target` — never just `entity === target` at any
depth. This is a genuinely necessary nuance the origin conversation's "just call findActionPath"
framing did not surface.

### Item 4 — property-filtered composition: `"a grandfather is a grandparent who is male"`

**New closed-set teach shape**, referencing an ALREADY-taught rule name plus a property literal:

```js
const FILTER_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*)\s+who\s+(?:is|are)\s+([a-z][\w-]*)[.!?]*$/i;
```

`m[1]` = new rule name ("grandfather"), `m[2]` = base rule/relation name ("grandparent"), `m[3]` =
property literal ("male"). Stores a `Rule` individual (Section 2, kind `filter`).

**Query side**: chase `m[2]` (recursively dispatching to whatever kind of thing IT is — a plain
relation, or itself another rule) to get the candidate set, then filter each candidate by whether
`mgx:hasProperty(candidate, m[3])` exists — a plain Fact lookup, `readFactRows`
(`src/memory/core.mjs:596-623`) already exposes exactly this shape.

**Is `differentVerbLed`/`sameVerbLed`'s compositional-AND (`src/ask.mjs:1108-1156`) portable?
Checked against the real code — no, not as claimed.** That machinery is built entirely on
`entityNoun`, `VERB_TO_KIND`, `QUALIFIERS` (`src/ask-vocab.mjs`) — a CLOSED, hardcoded vocabulary of
code-graph nouns/verbs ("module", "calls", "public", …). Porting it to the memory/teach layer would
mean hardcoding relation vocabulary into the dispatch code, exactly what "zero system vocabulary" is
designed to prevent. What IS portable is the SHAPE of the idea (intersect two independently-computed
candidate sets — `evalBoolean`'s AND-intersection, the same primitive item 4's own
base-rule-then-filter design uses) — not any of the actual code. This is the origin conversation's
own claim that turned out to need correcting on inspection, not confirming.

### Item 5 — property-minting: `"mary is female"`

Live-verified gap (Verification finding 3/4 above; `male`/`female` absent from
`src/grammar/lexicon-core.json`'s 33-entry adjectives list): `unknownSubjectFallback`'s own adjective
branch (`lookupAdjective(lex, objectRaw)`, :1633-1639) has NO mint fallback — a genuinely new
adjective always declines there — but that decline is downstream of an EARLIER, subject-must-be-
unknown guard (`classify(subjectRaw, lex)` returning truthy → immediate `return null`, :1621), so a
mint fallback built as an EXTENSION of `unknownSubjectFallback` itself would never fire for a KNOWN
subject with a brand-new adjective (`"the cache is bespoke"` — "cache" is a known noun, ACE's own
pattern 8 already owns "X is ADJ" for known adjectives, but a genuinely new one has no path either).
It must be its own standalone function, tried alongside (not nested inside) `unknownSubjectFallback`.

**Grounding requirement — genuinely different from class-minting, as the brief anticipated.** A
property has no "object" needing independent groundedness (unlike `unknownObjectFallback`'s class
mint, which the "every"-gate protects because minting a CLASS is inherently a claim about ALL
members). A property claim is about ONE entity (`unknownSubjectFallback`'s own point 3 precedent,
:1610-1611: property assertions never carry a quantifier even under "every"). So the correct guard
is **subject-side only**: mint the adjective when the SUBJECT is grounded in the SAME sense
`isGroundedTerm` already tests (known lexicon word of any part of speech, a `GENERIC_ANCHOR_NOUNS`
root, or previously fact-grounded, :1541-1548) **OR** is a bare Capitalized name-shaped token — the
exact convention `OWNS_TEACH_RE`'s bare-form gate already uses (`/^[A-Z]/.test(own[1])`, :1971) to
accept a never-before-seen proper name without requiring lexicon/fact grounding. Never require the
OBJECT (the adjective) to be independently grounded — minting it is the entire point — but DO check
it isn't already a known NOUN or fact-grounded class term first (branch order mirrors
`unknownSubjectFallback`'s own noun-then-adjective order, :1627-1639), so a genuine class-membership
sentence is never mis-read as a property.

New standalone function, tried right after `unknownObjectFallback` declines (:2111) and before the
wrapped-only `TEACH_PROPERTY_RE` block (:2116): `unknownAdjectiveFallback(payload, {memoryDir,
sessionId, lexicon})`, matching `UNKNOWN_SUBJECT_RE` (:1475, reused verbatim — same discipline
`unknownObjectFallback` already follows) and writing `HAS_PROPERTY_PREDICATE`, no quantifier, ever.

**A pre-existing gap this item should not widen further** (Verification finding 3): the WRAPPED
surface's `TEACH_PROPERTY_RE` (:2117-2124, reached AFTER this new fallback in the cascade) already
mints ANY bare complement word with zero grounding check at all — `"remember that zorp is florpy"`
already succeeds today. The new bare-surface fallback this item adds is strictly MORE disciplined
than the pre-existing wrapped path it sits upstream of; implementing it does not close that gap
(`TEACH_PROPERTY_RE` still runs for anything the new fallback declines on a wrapped sentence), only
adds a properly-grounded alternative for the bare surface. Tightening `TEACH_PROPERTY_RE` itself to
share the new subject-groundedness guard would close it, 

### Item 6 — recursive/reachability: `"a descendant is a parent, or a parent of a descendant"`

**New closed-set teach shape**, self-referential (the rule name reappears inside its own
definition):

```js
const RECURSIVE_RULE_TEACH_RE =
  /^an?\s+([a-z][\w-]*)\s+(?:is|are)\s+an?\s+([a-z][\w-]*),?\s+or\s+an?\s+([a-z][\w-]*)\s+of\s+an?\s+\1[.!?]*$/i;
```

`m[1]` = new rule name ("descendant"), `m[2]` = base-case relation ("parent"), `m[3]` = the
recursive step's first-hop relation ("parent" again — the backreference `\1` requires the SAME name
in the recursive slot, matching the "the rule name appears in its own definition" shape exactly, and
declining honestly on a malformed/mismatched self-reference rather than guessing one). Stores a
`Rule` individual (Section 2, kind `recursive`).

**Query side is a genuine kind-change from items 3/4**, exactly as the origin conversation flagged:
`"list the descendants of ahab"` needs REACHABILITY-SET ENUMERATION (every node ever reached), not
single-path-to-one-goal search. Checked against `findActionPath`'s own body (`src/planning.mjs:77-109`):
it returns the INSTANT the first goal-satisfying state is found (`for (const entry of frontier) if
(isGoal(entry.state)) return …`) — there is no way to keep it running to collect everything without
changing its halting condition and return shape, i.e. **a genuinely new function is needed**, not a
small parameter tweak. Designed as `findReachableSet(startState, applyActions, { maxDepth, stateKey })`
in `src/planning.mjs`, sharing `findActionPath`'s frontier/`seen`-set/depth-bound scaffolding
verbatim but with no `isGoal` at all (every reachable node past the start IS a result) and returning
the full `{ node, path }` set discovered within `maxDepth`, budget-capped. Per `planning.mjs`'s own
header discipline (lines 1-32: `findActionPath` deliberately lands as an independent SIBLING of
`findIsaChain`, not a shared-code extraction, because their optimizations don't transfer) —
`findReachableSet` should land the same way, a new sibling in the same file, `findActionPath` itself
untouched.

## 2. Rule storage design (grounded against `src/memory/core.mjs`'s real schema)

The STORED memory payload (`emptyMemory()`, `src/memory/core.mjs:94-110`) is
`{ generated_at, memory, prefixes, vocabulary, classes, objectProperties, individuals, proseIndex
}` — `byId`/`relations` (the shape the origin brief named) are NOT stored fields at all; they are
derived, at LOAD time, by `codegraph.mjs:parseEntities()` (`byId` = a `Map` over `individuals`;
`relations` = a filtered copy of `objectProperties`, `src/codegraph.mjs:27-50`). A rule design only
needs to fit `individuals` + `objectProperties`; `byId`/`relations` fall out for free, unchanged.

A `Fact` individual's subject/predicate/object are plain STRING **attributes**
(`rdf:subject`/`rdf:predicate`/`rdf:object`, `src/memory/core.mjs:485-489`) — never edges to a
per-term individual ("cache" has no node of its own). A `Rule` individual should follow the
identical convention: its slots are plain string attributes, not new `objectProperties` edge groups.

**New class**: `RULE_CLASS = "Rule"` — a one-line addition to the fixed class-name array
`recountClasses` already iterates (`src/memory/core.mjs:331`, currently `[Session, Utterance, Fact,
Source]`). "Rule" is a structural label about the STORE (a sibling of "Fact"), never a taught
concept — no domain vocabulary added.

**New sibling of `appendFact`**: `appendRule(dir, { name, kind, slots, provenance, createdAt })` in
`memory/core.mjs`, mirroring `appendFact`'s exact structure (`:462-502`):
- `name` = `normFactTerm(name)`-normalized rule name ("grandparent").
- `kind` ∈ the ONE closed vocabulary this design needs the engine to know: `"compose2"` | `"filter"`
  | `"recursive"` — three STRUCTURAL/grammar tags describing the SHAPE of what was taught, never a
  domain word (they describe "two relations chained," "a relation plus a property filter," "a base
  case or'd with a self-referential step" — the same way "Fact"/"Rule" describe the store's own
  shape, not what's stored in it).
- `slots` — a small closed per-kind object, e.g. `{ base1, base2 }` for `compose2`, `{ base,
  property }` for `filter`, `{ baseCase, recStep }` for `recursive` — each value itself a plain
  `normFactTerm`-normalized relation-name/property string, stored as its own `mgx:rule<Slot>`
  attribute (`mgx:ruleBase1`, `mgx:ruleBase2`, `mgx:ruleFilterProperty`, `mgx:ruleBaseCase`,
  `mgx:ruleRecStep`) — new `MEMORY_VOCABULARY` (`:65-89`) entries, documented in-payload exactly like
  every existing prop.
- Content-addressed id, mirroring `factIdFor`'s NUL-delimited hash discipline
  (`src/memory/core.mjs:456`): `rule:<fnv1aHex(kind + "\0" + name + "\0" + slot1 + "\0" + slot2)>` —
  re-teaching the identical rule upserts, never duplicates.

**Provenance/trust — reused completely unmodified, not reimplemented.** `syncFactSources`
(`src/memory/core.mjs:268-283`) and `recomputeFactTrust` (`:254-262`) only ever touch
`fact.attributes`/`fact.id`/`fact.label` — neither checks `fact.class` anywhere in its body. A
`Rule` individual carrying the SAME `mgx:factProvenance` compat-string attribute + `CREATED_AT_PROP`
rides the identical Source-derivation/trust pipeline `appendFact` already uses, with zero new code
in that path — confirmed by rereading both functions in full, not assumed.

**Genericity for the dispatcher**: "what kind of thing is 'grandparent'" resolves by one lookup —
scan `individuals` for `class === "Rule" && attributes.find(a => a.prop==="mgx:ruleName").value ===
queriedName` — no per-rule-name branch anywhere; the SAME lookup serves every taught rule uniformly.

## 3. Query-dispatcher design

Given a relation-shaped query (`"is X the grandfather of Y"`, `"list the descendants of X"`), the
dispatcher's OWN code contains exactly the three `ruleKind` tags above as its only closed
vocabulary — never a relation NAME:

1. Extract `{ mode: yesno|list, relationName, subject?, object? }` via two new closed-set query
   regexes (siblings of the existing `KIND_OF_RE`/`WHO_OWNS_RE` query recognizers, not detailed
   further here — pure recognition, no new semantics).
2. Look up `relationName` against, IN ORDER:
   - a) an ordinary Fact predicate (`mgx:<relationName>` appears as SOME Fact's `predicate`) → direct
     lookup/existence check, alias-resolved per item 2's `findIsaChain`-reuse design if not found
     directly under that exact name.
   - b) a `Rule` individual (`mgx:ruleName === relationName`) → branch on `mgx:ruleKind`:
     - `compose2` → the hop-counted `findActionPath` call (item 3).
     - `filter` → recursively resolve `ruleBase1`'s candidate set (step (a) or (b) again, whichever
       it is), then filter by `mgx:hasProperty` (item 4).
     - `recursive` → `findReachableSet` (item 6) seeded from `baseCase`'s edges, stepping via
       `recStep`'s edges at every further hop.
   - c) neither → honest miss: "I don't know a relation or rule called '<relationName>' yet."
3. Recursion is naturally bounded: a `filter` rule's base is always EITHER a plain relation (case a,
   terminal) or another rule (case b, one level of dispatch deeper) — never itself, so no cycle
   guard is needed at the DISPATCH level (the search kernels underneath — `findActionPath`/
   `findReachableSet` — carry their own `seen`-set cycle safety regardless, see open risks).

## 4. Phased build order

- **Phase 1 (independent, cheapest, ship first, parallelizable in principle)**: Item 5
  (adjective-mint) + Item 1 (relational fact teach). Neither needs rule storage. Both touch
  `chat.mjs`'s `teachLane` — serialize on that one file per this repo's own coordinator-model
  convention (CLAUDE.md), even though the capabilities themselves are conceptually independent.
- **Phase 2**: Item 2's query-side alias-chase dispatcher. Depends on Phase 1's item 1 (there must
  be taught relation-predicates to alias against) — no rule-storage dependency at all (item 2 is
  pure Fact/subClassOf machinery).
- **Phase 3**: Rule storage foundation (`memory/core.mjs`: `RULE_CLASS`, `appendRule`, reusing
  `syncFactSources` unmodified) — pure plumbing, zero chat.mjs behavior change yet.
- **Phase 4**: Item 3 (compose2) — needs Phase 3 + Phase 1's item 1 (base relations to chase).
- **Phase 5**: Item 4 (filter) — needs Phase 4 (references an already-taught compose2-kind rule) +
  Phase 1's item 5 (property literals to filter on).
- **Phase 6**: Item 6 (recursive) — needs Phase 3 (rule storage) + the new `findReachableSet` kernel
  + Phase 1's item 1 (base-case facts). Could run in parallel with Phase 4/5 (no direct dependency
  on either), but is the highest-novelty kernel work (a genuinely new search function, not reuse) —
  sequencing it last is the prudent default regardless of the dependency graph technically allowing
  earlier placement.

**Phase 6, KERNEL half — DONE (2026-07-09)**: `findReachableSet(startState, applyActions,
{ maxDepth, stateKey })` landed in `src/planning.mjs`, a sibling of `findActionPath` sharing only
the literal-identical frontier-seeding step (`seedFrontier`, extracted since it has no
goal/accumulation semantics to differ on) — the main expand loops stayed independent, since their
halting/result-accumulation semantics (return-the-instant-vs-accumulate-every-reachable-state)
differ enough that a shared core would need a mode parameter recreating the complexity a merge is
supposed to remove; see the file's own new comments above `findReachableSet` for the full
reasoning. Proven against a toy graph with a genuine cycle AND a same-length two-path convergence
(one node reachable via two different routes) — dedup, cycle-safety, and budget-exhaustion
exclusion all confirmed by new tests in `test/planning.test.mjs`; `findActionPath`'s own existing 6
tests re-verified unaffected. `npm test`: +5 new tests, full suite green. The WIRING half —
`RECURSIVE_RULE_TEACH_RE` (the teach-shape recognizer above) plus the query-dispatcher branch
(§3.2.b's `recursive` case) — is deliberately NOT done here; both touch `chat.mjs`, which a
concurrent dispatch held exclusively at the time this kernel work was done, per this repo's
coordinator-model file-ownership discipline (`CLAUDE.md`). Picking up the wiring half is next once
`chat.mjs` is free.

## 5. Relationship to `PLAN_HANOI.md` / `PLAN_GUESS_NUMBER.md`

**Genuinely shared**: all three plans now converge on `findActionPath` (`src/planning.mjs:77-109`,
landed `be9b377`, still UNUSED by any live chat.mjs wiring — `PLAN_HANOI.md`'s own Phase 3 is not
started either, confirmed by rereading that file's "later same day" appendix) as the shared bounded,
cycle-safe, frontier-expansion search primitive. Items 3/4 here are the SECOND (Hanoi is the first)
and THIRD (guess-number is the second) domains to need "state, goal, action, repeat" — this plan's
state for items 3/4 is `{ entity, hopsTaken }` over a taught relation's on-demand edge set; item 6's
reachability enumeration is the first domain among all three plans to need `findActionPath`'s
frontier/`seen`/depth-bound discipline WITHOUT a single fixed goal at all, forcing a genuine new
sibling function (`findReachableSet`) rather than reuse of `findActionPath` itself — the point where
the shared primitive family needs to grow, mirroring exactly how `planning.mjs` itself already
landed as a deliberate SIBLING of `syllogise.mjs`'s `findIsaChain` rather than a shared-code
extraction (`planning.mjs:1-32`'s own stated reasoning: pre-built static edge maps vs. on-demand
successor generation don't share an implementation, only a discipline).

**Genuinely divergent**: Hanoi's and guess-number's states are either fully known up front
(deterministic Hanoi moves) or a belief interval narrowed by an OBSERVATION (guess-number) — neither
involves a taught, named, composable RELATION at all. This plan is the first of the three where the
"successor function" (`applyActions`) is itself SYNTHESIZED, at query time, from data the user
taught in an entirely separate prior conversation turn (a `Rule`/`Fact` read out of `.tmct/memory`),
rather than hand-written once per domain (Hanoi's `legalMoves`, guess-number's interval-update rule).
That is the one genuinely new structural idea this plan adds to the family: a DATA-DRIVEN
`applyActions`, not a hard-coded one.

## Open risks

- **Ambiguity-collision, checked concretely, mostly clean but not perfectly**: items 1 (`"X is the
  ROLE of Y"`), 3 (`"a NAME is a REL of a REL"`), and 6 (`"a NAME is a REL, or a REL of a NAME"`) were
  each checked against `UNKNOWN_SUBJECT_RE`/`BARE_DECLARATIVE_RE`/`TEACH_PROPERTY_RE`'s own
  single-token-object anchors and confirmed structurally unable to match any of the three new
  multi-token shapes (verified by rereading each regex's literal anchors, not assumed) — so no
  existing recognizer can mis-claim a new one. The one place this needs live discipline, not just
  regex-shape argument: item 3's `"a grandparent is a parent of a parent"` and item 1's `"ahab is
  the father of john"` differ only by whether the middle token is `"a"` (relation-name teach) or
  `"the"` (entity-fact teach) plus a following `"of"` — the two new regexes MUST be tried in a fixed
  order relative to each other (item 3's determiner is always indefinite on both sides; item 1's is
  `the` + a lone role word) or a sentence with an ambiguous role word that also happens to be a
  taught relation NAME could theoretically satisfy both patterns' token shapes. Given the two
  regexes above, this doesn't actually arise (item 1 requires literal `the`, item 3 requires `a`/`an`
  in that slot) — but any future refinement to either regex must re-check this pairing specifically,
  since it's the one place in the six items where lexical overlap (not structural difference) is the
  only thing keeping them apart.
- **"Never fabricate" for recursive rules**: a malformed/cyclic recursive definition must never
  infinite-loop or produce a confident wrong answer. Tied directly to `findActionPath`'s (and the new
  `findReachableSet`'s) existing bounded/cycle-safe discipline (`seen`-set + `maxDepth`,
  `src/planning.mjs:91-107`) — a cycle in the taught relation's own edges (e.g. a bad "every parent
  is a parent" self-loop, or two individuals mutually taught as each other's parent) is handled the
  same way `findActionPath`'s own toy-domain test suite already proves handles cycles correctly
  (`test/planning.test.mjs`, cited in `PLAN_HANOI.md`'s "later same day" appendix): terminates, still
  returns the correct (possibly empty) result, never loops. The genuinely NEW risk item 6 adds beyond
  that existing guarantee: the RECURSIVE_RULE_TEACH_RE's own backreference (`\1`) requiring the
  recursive slot to literally repeat the rule's own name protects the TEACH side from storing a
  non-self-referential rule under the `recursive` kind by mistake, but does nothing to stop the
  taught EDGES themselves (ordinary `mgx:parent` facts) from containing a cycle at query time — that
  risk is real and is exactly what `findReachableSet`'s inherited `seen`-set guard exists to close,
  not a new problem this design introduces unguarded.
- **The `isConversational` ≤3-word override (Verification finding 4)**: any of the six new
  recognizers whose CANONICAL illustrative phrasing is 3 words or fewer with no code-ish token (only
  item 5's `"mary is female"` among the six, but a real risk for whatever OTHER short phrasings users
  actually try) will have its own honest, specific miss text silently discarded in favor of the
  generic orientation card if the new fallback declines. This means each new fallback's SUCCESS path
  matters more than usual for short inputs — a fallback that declines "honestly" on a 3-word sentence
  produces a WORSE user experience (a contextless wall) than declining on a longer one. 
- **The pre-existing `TEACH_PROPERTY_RE` groundedness gap (Verification finding 3)** sits directly
  upstream-adjacent to item 5's new work and is not closed by it — see item 5's own subsection.
  Worth a deliberate operator decision (tighten `TEACH_PROPERTY_RE` to share the new guard, accepting
  a behavior change to shipped code) rather than an accidental one.

## Non-goals for this document

- No fixed kinship vocabulary anywhere in code — every word in every example above (father, mother,
  parent, grandparent, grandfather, descendant, male, female) is illustrative teach-input only.
- No enumeration/"list the grandparents of X" generalization of items 3/4's single-target
  `findActionPath` chase to a reachability-set query — item 6 is the only capability that needs
  enumeration, per the operator's own six-item scope; extending items 3/4 the same way is a natural
  follow-on but was not asked for here.
- No implementation. This is 100% design, and no file other than this one was written or modified to
  produce it (the CLI runs used for live verification wrote only to disposable `.tmct/` dirs under
  `/tmp`, never inside this repository).
