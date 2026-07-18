# PLAN_25_BACKLOG.md — close the 2.5.0 open items

**Status: in delivery (2026-07-18 run). This is the build order for the seven items `HANDOVER.md`
carries after the 2.5.0 benchmark round.** Work it top to bottom: the order is by evidence strength and blast radius,
not by area. Every fix ships with its pin — no row, not done. Evidence lands at the tool layer
(`test/tools/`) wherever a tool serves the shape (`SKILL_CAPABILITIES_AUDIT.md` §1); a chat-only
shape gets a keyed corpus row.

Sources: `BENCHMARK_CONVERSATION_2.5.0.md` (the routed backlog, 11 confident-wrong + the honest-miss
clusters), `BENCHMARK_CEFR_ENGLISH_2.5.0.md`, `BENCHMARK_AGENT_2.5.0.md`, `CAPABILITIES_2.5.0.md`,
and `archive/PLAN_OPEN_ITEMS.md` / `archive/PLAN_NORMATIVE.md` for the tails and the two decisions.

## Every fix site below was verified, not inherited

The archived `PLAN_OPEN_ITEMS.md` records that its own citations were wrong on five of eight Phase-3
items — always the same way, "the doc named the neighbourhood, not the cause". So every reproducer
here was re-run in-process (a `createSession` over a `mktemp` copy of `examples/mini-webapp/.tmct/
graph.json`, or a bare seed-corpus session — never against `examples/` itself, which holds committed
fixtures), and every fix site was read in the source before it was named. Where the benchmark
report's own diagnosis was imprecise, the section says so.

One correction up front, because it recurs. The report frames the worst find (F1) as
"`syllogise.mjs`'s prover vs the direct disjointness path". The disjointness rule
(`deriveDisjointViolations`, cax-dw) already lives in `syllogise.mjs` and is already called on this
lane — but **after** the yes-proof has returned. The gap is call **order** in `chat.mjs`, not a
missing capability in `syllogise.mjs`. Details in §1.

---

## 1. The disjointness-vs-subclass proof — a proof certifies a stored contradiction

**Worst find of the sweep, and the only proof-shaped one.** A proof is tmct's strongest honesty
claim, and here it certifies a flat inconsistency (`dog ⊑ cat ∧ dog ⊓ cat = ⊥`).

**Reproducer** (bare seed-corpus session):

```txt
tmct> rex is a dog
tmct> every dog is a cat
tmct> no dog is a cat
noted — remembered 1 fact: dog owl:disjointWith cat
tmct> is rex a cat
yes — rex is a kind of dog (…); dog is a kind of cat (…); so rex is a cat
```

The direct disjointness ask is correct — `is a cat a dog` answers `no — you told me: dog is not a
cat`. Only the derived multi-hop conclusion ignores the stored `owl:disjointWith`.

**Verified fix site.** `chat.mjs`'s is-a-ask lane, the two `findIsaChain` yes-proof blocks at
`chat.mjs:7359-7364` (taught-only) and `chat.mjs:7382-7389` (mixed-source). Each finds a subclass
chain and `return`s `yes — ${renderIsaChain(premises)}` immediately. The cax-dw disjointness check
(`deriveDisjointViolations` + `disjointRows`, imported and computed at `chat.mjs:7400-7401`) runs
**only after** every yes-strategy has missed — the comment at `:7390` even says "every 'yes'
strategy above missed". So when a chain proves yes, control returns before disjointness is ever
consulted. The capability exists; the order is wrong.

The report's diagnosis ("the subclass prover does not query `owl:disjointWith` on the resolved
chain") is behaviourally right but attributes the fix to `syllogise.mjs`. `syllogise.mjs` needs no
change: `deriveDisjointViolations` already lifts disjointness through the full ⊑-ancestor closure
(`syllogise.mjs:256`, `deriveDisjointViolations`). The fix is to run it before the yes returns.

**Build.** In the is-a-ask lane, hoist the disjoint-violation computation ahead of the two
`findIsaChain` yes blocks. For each candidate subject that yields a chain, before returning the
proof, check whether the chain's conclusion class (the resolved object) is `owl:disjointWith` any
type the subject holds along the resolved chain — reuse `deriveDisjointViolations` over the same
taught type/subclass/disjoint edge sets the lane already builds. On a hit, replace the proof with a
contradiction report that names both stored facts and refuses to pick, in the shape `isaPolarityReply`
already uses for the both-sides case (`chat.mjs:5032`), e.g. "you've told me both `every dog is a
cat` and `no dog is a cat` — I won't derive a conclusion from an inconsistency". No yes-proof may
outrun a stored disjointness on the resolved chain.

**Tests / pins.** `inference.jsonl` keyed `inference.disjoint.subclass-chain`:
- the three-teach reproducer above → the contradiction report, never a proof (the load-bearing
  negative row: the answer must not contain "so rex is a cat");
- the inheritance form (`no animal is a plant` / `every dog is an animal` / `every dog is a plant` /
  `is a dog a plant`) → same refusal;
- a control with no disjointness (`rex is a dog` / `every dog is a cat` / `is rex a cat`) still
  proves yes, so the gate narrows nothing it shouldn't.

Add a `test/tools/` row only if the is-a proof is reachable through `tmct_ask` (it is — the ask tool
routes taught facts); assert the same negative there so the tool layer carries it too.

**Docs.** None beyond the pins; this is a behavioural correction, not a surface.

---

## 2. The impact surface — one phrasing works, its natural neighbours mutate memory, collapse to `import`, or contradict the call graph

The impact closure is correct; it is reachable by essentially one template (`what would break if I
change X`, matched by `IMPACT_PARAPHRASE_RE`, `chat.mjs:10919-10926`, dispatched at `:11225`).
Everything adjacent to it fails, four different ways. Group these four findings — they share the
impact-intent recogniser as their fix site.

### 2.1 `blast radius of X` is stored as a fact (F2) — a read-only question mutates state

**Reproducer** (code session):

```txt
tmct> blast radius of src/core/store.mjs
noted — remembered: blast radiuses of src/core/store.mjs
```

**Verified fix site.** The turn's structural parse misses, so it falls to the teach lane (narrate
trace: `lane: (4) TEACH — TEACH_RE/OWNS_TEACH_RE/BARE_DECLARATIVE_RE matched`). The bare-declarative
teach frame in `chat.mjs` swallows `blast radius of <path>` and pluralises the head to "blast
radiuses". The fix is not in the teach frame — it is to recognise the impact intent **ahead** of the
teach lane, the way `IMPACT_PARAPHRASE_RE` already routes `what would break if I change X` before any
teach frame runs.

**Build.** Extend the impact-intent recogniser beside `IMPACT_PARAPHRASE_RE` (`chat.mjs:10919`) to
match `blast radius of X` / `blast radius for X` and route to the same `/impact` closure. Order it
ahead of the teach classifier so an interrogative is never reified. An interrogative shape must never
reach the write boundary.

### 2.2 `impact of X` fuzzy-collapses to `import of X` (F3)

**Reproducer:**

```txt
tmct> impact of src/core/store.mjs
read as "import of src/core/store.mjs" — src/handlers/tasks.mjs and src/handlers/users.mjs.
```

**Verified fix site.** The relaxation cascade fuzzy-corrects the unknown token "impact" to "import"
(narrate: `relaxation steps — fuzzy-correct ["impact→import"]`). The corrector is `fuzzyCascadeWord`
(`ask.mjs:3645`), whose target set `CASCADE_FUZZY_TARGETS` (`ask.mjs:3633`) is built from
`VERB_TO_KIND`'s keys — which include "import". `editDistance("impact","import")` is 2, inside the
6-char fuzzy bound, so it silently rewrites. It then announces the misread and answers confidently as
the blast radius.

**Build.** Two moves, both needed. First, route `impact of X` to the impact closure by the same
recogniser as 2.1 (add `impact of X` / `impact for X`), placed ahead of the relaxation cascade so the
fuzzy corrector never sees "impact". Second, as a guard, keep "impact" from ever fuzzy-collapsing to
"import" — exclude the confusable pair, so an unrecognised phrasing declines rather than answering the
inverse. The report's diagnosis (fuzzy collapse) is exactly right.

### 2.3 The impact closure and the call graph disagree about `saveStore` (F4)

**Reproducer:**

```txt
tmct> what would break if I change saveStore
Impact of changing saveStore … no dependents found — nothing imports or calls it.
tmct> what calls saveStore
in src/handlers/tasks.mjs there is function createTask().
```

Two surfaces contradict each other about the same function.

**Verified fix site — and the report's diagnosis is imprecise.** The handler
`src/tools/handlers/tmct-impact.mjs` is a three-line wrapper; the closure lives in `impactClosure`
(`src/domain/codegraph.mjs:344`) and the render in `renderImpact` (`:389`). `impactClosure` already
folds in the `callsSymbol` reverse (`codegraph.mjs:358`) — so the edge is not missing. The real gap
is a **grain mismatch**: the `callsSymbol` branch coarsens *both* ends to module level and keys each
dependent under the caller's/callee's **module id** (`moduleIdOfId`), but an impact query resolves
`saveStore` to a **symbol id** (`fn:src/core/store.mjs#saveStore`) and the BFS seeds from that symbol
id, so `dependents.get(symbolId)` is empty. Reproduced in-process over `examples/mini-webapp`: the
edge `createTask → saveStore` (callsSymbol) exists, yet `renderImpact` returns "no dependents found".

**Build.** In `impactClosure`, close the grain mismatch: when the seed `ind` is a symbol, either seed
the BFS from its module id, or additionally key the `callsSymbol` dependent under the callee's symbol
id so a symbol-resolved subject matches. Because the branch coarsens to module level, the recovered
dependent is the caller's **module** (`src/handlers/tasks.mjs`), not the function `createTask`;
reporting the function too would need the closure to keep symbol grain, a larger change — do it only
if it stays small, else name it. Verify against the reproducer: after the fix, `what would break if I
change saveStore` must name `src/handlers/tasks.mjs`, never "no dependents found".

### 2.4 Impact paraphrases fall to the touches misparser or the grammar wall (F12)

**Reproducer** (each an honest miss today):

```txt
tmct> if I change store.mjs what breaks
tmct> what happens if I change store.mjs
tmct> what breaks if I remove store.mjs
tmct> can I safely delete store.mjs
tmct> what is affected by changing store.mjs
```

**Verified fix site.** `IMPACT_PARAPHRASE_RE` (`chat.mjs:10919-10926`) is anchored to the exact
`what would break if I change X` shape with one clause order. The near-synonyms and the reversed
clause order miss it and fall through to the touches history matcher or the bare grammar wall.

**Build.** Widen the recogniser to the intent, not the template: `change|edit|modify|delete|remove`
crossed with `break|affect|happen`, in either clause order (`if I change X what breaks` as well as
`what breaks if I change X`), plus `what is affected by changing X`, all ahead of the touches
fallback. This is one recogniser shared with 2.1 and 2.2 — build it once as the impact-intent gate.

**Tests / pins for §2.** These are all tool-reachable (`tmct_impact` serves the closure), so pin at
the tool layer where possible:
- `test/tools/` driving `tmct_impact` for `saveStore`: it names the caller's module
  `src/handlers/tasks.mjs` (2.3; `createTask` too only if the closure is taught symbol grain), with a
  negative asserting the answer is not "no dependents found".
- `grammar.jsonl` keyed `grammar.routing.impact-intent`: `blast radius of X`, `impact of X`, and each
  2.4 paraphrase route to the impact closure; a negative row that `blast radius of X` is **not**
  remembered (memory unchanged after the turn) and that `impact of X` never answers as `import of X`.
- `grammar.jsonl` keyed `grammar.fuzzy.no-impact-import-collapse`: `impact of X` never rewrites to
  `import`.

**Docs.** A one-line README example that `blast radius of X` / `impact of X` answer the impact
closure. Move `CAPABILITIES_2.5.0.md`'s impact row to reflect the widened surface when it re-measures
(not this plan's file to edit).

---

## 3. Members-of and result-type parse gaps (F5, F6, F7) — a code question answers a misleading "none"

Three confident-wrong findings that share the query-compilation path as their fix site: a real code
question compiles to the wrong AST and answers "none", which reads as "it has none". `parseQuery`
(`ask.mjs:160`) is a two-line wrapper over `parseQueryFull` (`ask.mjs:167`), which runs the strategy
pipeline (`runStrategiesSync`, `src/domain/interpret/pipeline.mjs:48`; `mergeStrategyResults`,
`src/domain/interpret/merge.mjs:53`) over the keyword/grammar strategies
(`src/domain/interpret/strategies/`). The shape each finding names is compiled there against the
closed vocabulary in `src/domain/ask-vocab.mjs`, then executed and rendered in `ask.mjs`. Cite the
strategy or the answer branch, not the wrapper.

### 3.1 `what functions are in X` reads `contains`, not `defines` (F5)

**Reproducer:**

```txt
tmct> what functions are in store.mjs
src/core/store.mjs has no contains edges in the index.
tmct> what functions does store.mjs define
loadStore and saveStore.
```

**Verified fix site.** The keyword strategy compiles `functions are in X` / `X contain` / `methods
of X` to `forward(contains, X)` off the `contains` verb set and the `methods`/`members` entries in
`src/domain/ask-vocab.mjs` (`ask-vocab.mjs:86-90`, `:547-548`) — reproduced in-process:
`parseQuery("what functions are in store.mjs")` → `{shape:forward, kind:contains, object:"store.mjs"}`.
The index carries the members on `defines` scoped to Function/Method, not on `contains`.
`SKILL_CAPABILITIES_AUDIT.md` §1 names this equivalence, and `ask-vocab.mjs` already declares
`MEMBERSHIP_KINDS = ["contains", "defines"]` (`ask-vocab.mjs:582`) for exactly this both-tried case.

**Build.** The cleanest form is a fall-through at the answer branch, not a parse rewrite: the forward
no-match branch (`ask.mjs:3540-3546`, `${objMatch.label} has no ${verbFor(parsed.kind)} edges in the
index.`) is where the misleading "none" is rendered. Before reporting it, when a `contains` traversal
finds no edges, consult `defines` scoped to the named grain (reuse `MEMBERSHIP_KINDS`), so the two
never disagree.

### 3.2 `what uses the Store class` narrows the result type by "class" (F6)

**Reproducer:**

```txt
tmct> what uses the Store class
No classes found whose module directly uses Store.
```

**Verified fix site.** The strategy that assigns `entityType` reads "class" as the **result-type**
filter — reproduced: `parseQuery("what uses the Store class")` → `{shape:reverse, entityType:"Class",
kind:"uses", object:"Store"}`. So it looks for classes that use Store, when "class" describes the
**subject** Store, not the answer type. The `entityType` assignment lives in the keyword/grammar
strategy (`src/domain/interpret/strategies/`), not in the `parseQuery` wrapper.

**Build.** In the strategy that sets `entityType`, when a type word (`the Store class`, `the X
function`) trails or leads a named entity, treat it as describing the subject's grain, not the result
filter. The result type stays open (modules/functions that use Store), and the type word only
disambiguates which "Store" is meant.

### 3.3 `which modules have no tests` parses "no tests" as a literal object (F7)

**Reproducer:**

```txt
tmct> which modules have no tests
No modules found whose module directly defines no tests.
```

**Verified fix site.** The strategy compiles this to `reverse(defines, entityType=Module, "no
tests")` — reproduced: `parseQuery("which modules have no tests")` → `{shape:reverse,
entityType:"Module", kind:"defines", object:"no tests"}` — and resolution then fuzzy-resolves "no
tests" to a commit via the prose tier. The negation is read as a literal object.

**Build.** Recognise `which modules have no tests` / `modules with no tests` / `untested modules` as
the coverage query the `tmct_untested` tool serves (handler `src/tools/handlers/tmct-untested.mjs`),
routing to it ahead of the generic `defines`-object strategy. This is a routing fix to an existing
capability.

**Tests / pins for §3.** These reach the ask tool, so pin at the tool layer:
- `test/tools/` (or `test/adapters/ask*.test.mjs`) over the `mini-webapp` fixture: `what functions
  are in store.mjs` returns `loadStore`/`saveStore` (3.1); `what uses the Store class` returns the
  users of Store, not "no classes" (3.2); `which modules have no tests` returns the same set as
  `/untested` (3.3). Each with the load-bearing negative: the answer is not a misleading "none".
- `grammar.jsonl` keyed `grammar.members.defines-not-contains`, `grammar.resolve.type-word-describes-subject`,
  and `grammar.routing.untested-nl` respectively.

**Docs.** README's structural-query examples gain the three phrasings; the capability audit rows for
members-of and usage move when it re-measures.

---

## 4. The Tier-0 vocabulary lane — a casual opener misroutes to teach, and holds the ladder at Tier 0

`i wanna know about X` is the most natural way a newcomer opens a vocabulary question, and it asserts
a false intent. It is what pins the conversation ladder at Tier 0 (`BENCHMARK_CONVERSATION_2.5.0.md`
§"Ladder position"). Its phrasing siblings (F13-F18) share the same lane.

### 4.1 The first-person desire frame is not stripped before teach (F8)

**Reproducer:**

```txt
tmct> i wanna know about a horse
I can't store a fact about "i" as a class — pronouns aren't things I can classify …
   Goal (inferred): Teach/remember a new fact.
tmct> tell me about a horse
"horse" is not a code-map entity — answering from memory/corpus facts. is a: animal
```

The whole family misroutes: `i want to know about a horse`, `i would like to know about a horse`,
`you tell me about dog`, `let me know about a dog`.

**Verified fix site.** `WANT_KNOW_WRAPPER_RE` (`normalize.mjs:156`) already peels `i want to know
<Q>` → `<Q>`, but two things stop it here: it requires `want to` (not the contraction `wanna`), and
its remainder is gated to an interrogative — `about a horse` is not interrogative, so nothing strips
it and the line falls to the teach detector, which reads the leading "i" as a subject.

**Build.** Extend the wrapper family in `normalize.mjs` (beside `WANT_KNOW_WRAPPER_RE`) to peel the
first-person desire openers down to the vocabulary question they carry: `i wanna/want to/would like
to know about X` → `tell me about X`; `you tell me about X` and `let me know about X` likewise. Keep
the existing interrogative-remainder members working. The strip must run before the teach classifier,
so a desire opener never reifies "i".

### 4.2 `what have you got` parses as `defines "got"` (F9)

**Reproducer:**

```txt
tmct> what have you got
no module matching "got" found in the index.
   Goal (inferred): Locate what a module defines.
```

**Verified fix site.** The residue after stripping falls into the `reverse(defines, "got")` frame
(narrate: `shape=reverse kind=defines object="got"`). `whats in here` / `what is this` give the right
overview; `what have you got` does not reach them.

**Build.** Recognise `what have you got` / `what do you have` / `what have you got for me` as the
overview-intent `whats in here` serves, ahead of the `defines`-object parse. The token "got" must
never become a `defines` object.

### 4.3 The phrasing siblings (F13-F18) — six honest misses on the same lane

Each walls today while a near-neighbour works. Group them into one lane-routing commit:

| # | Misses | Works | Route to |
|---|---|---|---|
| F13 | `tell me something about a cat` | `tell me about a cat` | tolerate the `something` filler in the `tell me about` route |
| F14 | `what can you do for me` / `so uh what can you do then` | `what can you do` | survive leading/trailing filler on the capability-intent matcher |
| F15 | `what else can dogs do` / `anything else about dogs` / `and a cat` | `tell me more` / `what about X` | route into the expansion/anaphora path |
| F16 | `tell me about this repo` | `whats in here` / `what is this` | map `tell me about (this) repo` onto the overview handler |
| F17 | `what animals do you know` / `list the animals you know` | `whats an animal` | route `what/which X do you know` and `list the X you know` onto the subclass enumeration |
| F18 | `i wonder what a dog is` | `do you know what a dog is` | strip the `i wonder / i was wondering` frame the same way |

**Verified fix site.** All are recogniser gaps in `chat.mjs`'s vocabulary/overview lanes and
`normalize.mjs`'s wrapper set — the same territory as 4.1/4.2. Each is a phrasing the lane already
answers under a canonical form; the miss is the recogniser, not the capability. F18's frame belongs
with the wrapper family in `normalize.mjs`; F14's is the capability-intent matcher; F16/F17's is the
overview / subclass-enumeration recogniser in `chat.mjs`.

**Tests / pins for §4.** Vocabulary-lane shapes are chat-only, so pin with corpus rows in a seeded,
graph-less session (the seed corpus supplies the animal facts):
- `templates.jsonl` keyed `template.vocab.desire-opener`: the F8 family answers the same as `tell me
  about X`, with the load-bearing negative that `i wanna know about X` is not reified (memory
  unchanged, no pronoun-rejection lecture, no "Teach a fact" goal).
- `templates.jsonl` keyed `template.vocab.overview-openers` (F9, F16), `template.vocab.filler-tolerance`
  (F13, F14), `template.vocab.expansion` (F15), `template.vocab.enumerate-known` (F17), and the
  wrapper key for F18 alongside the existing `i was wondering` pin.

**Docs.** None; these are recogniser additions. Re-run the six-frame sweep once §4 lands — this is
what lets the ladder move past Tier 0.

---

## 5. The stale-modifier multi-candidate half (F11) — the soft confident-wrong

**Reproducer** (code session):

```txt
tmct> what imports the deprecated legacy cache.mjs
"deprecated legacy cache.mjs" matches more than one module ambiguously — did you mean src/core/model.mjs,
src/core/store.mjs, src/core/validate.mjs, src/lib/logger.mjs and src/lib/http.mjs? …
  1) src/core/model.mjs: … 2) src/core/store.mjs: … [enumerates all five in full]
```

`cache.mjs` does not exist and "cache" appears in none of the five. `what imports the old store.mjs`
behaves the same. It is soft because the ambiguity line discloses it, but it is the multi-candidate
half of the item-1.4 family and never names the stale modifier the single-candidate path now does.

**Verified fix site.** The single-candidate residue guard is `unplacedTermWords` /
`unplacedWords` (`ask.mjs:2514`, applied at `:2542`) — it fires only when there is exactly one match
(`result.match.label`). The ambiguous branch reports through the "matches more than one … ambiguously"
message at `ask.mjs:3421` and never runs the residue check, so the stale modifiers ("deprecated",
"legacy", "old") are silently dropped and every fuzzy candidate is answered.

**Build.** Before the ambiguous branch enumerates, run the same `unplacedTermWords` residue check
against the candidate set: if the query carries unplaced modifier words that none of the candidates
account for, decline and name them ("I don't recognise 'deprecated', 'legacy' — did you mean …?"), the
way the single-candidate path already declines. Fold this into the existing residue fix rather than
hiving it off — it is the other half of the same family (`CLAUDE.md`, "don't narrow scope").

**Tests / pins.** These reach the ask tool. `test/tools/` (or `test/adapters/ask*`) keyed
`grammar.resolve.unknown-residue-ambiguous`, with the load-bearing negative: `what imports the
deprecated legacy cache.mjs` must **not** enumerate five modules; it names the stale words and
declines. A control that a genuine ambiguity with no stale modifier still enumerates its real
candidates, so the guard narrows nothing legitimate.

**Docs.** None beyond the pin.

---

## 6. The board-read misroute and the goal-frame gaps (F10, F27-F29)

### 6.1 `where does disk-1 rest?` routes to the code locator (F10)

**Reproducer** (a planning board is loaded):

```txt
tmct> disk-1 rests on disk-2
tmct> disk-2 rests on peg-a
tmct> the goal is that every disk rests on peg-c
tmct> where does disk-1 rest?
no module matching "disk-1 rest" found in the index …
   Canonical: where is "disk-1 rest" defined?
```

README (lines 362-363) advertises this as a board read-back. `where is every disk` misroutes the same
way.

**Verified fix site.** A board-read recogniser exists — `BOARD_WHERE_RE` (`chat.mjs:2160`) matches
`where is X` / `where's X` — but it does not cover `where does <disk> rest`, so that phrasing falls
through to the code definition-locator (`where(where, "disk-1 rest")`).

**Build.** Extend `BOARD_WHERE_RE` (or add a sibling beside it) to match `where does <disk> rest` and
`where is every disk`, and gate the board-read branch to run when a planning board is loaded, ahead of
the code-locator fallback. A board question must read the board before the code index.

### 6.2 The goal-frame is narrower than natural phrasing (F27-F29)

**Reproducers** (each an honest miss / weak decline today):

```txt
tmct> stack all disks on peg-c                          # walls, then "no goal set yet"
tmct> the goal is all disks on peg-c                    # walls
tmct> the goal is that disk-1 rests on peg-b and disk-3 rests on peg-c   # conjunction walls
tmct> [teach only disk-1's position] … solve it         # F28: confident "3 moves (shortest)" over assumed positions, no flag
tmct> the goal is that every disk rests on peg-z        # F29: burns the 300-move search on an unknown peg
```

**Verified fix site.** The goal-frame recogniser (`GOAL_TEACH_RE`, `chat.mjs:2116`, and the goal lane
around it) matches `the goal is that every disk rests on peg-c` but not the `the goal is <NP>` /
`<all/every> disks … on <peg>` / `A and B` conjunction forms. F28 and F29 are planner-side: an
under-specified board plans silently over assumed positions (no assumption flag), and an unknown goal
token burns the search instead of declining by name.

**Build.**
- F27: widen the goal recogniser to `the goal is <NP>`, `stack/put all disks on <peg>`, and the `A
  and B` conjunction (compile each conjunct to a goal atom).
- F28: when a disk referenced by a rule or goal has no position fact, note the assumption in the plan
  rather than planning silently.
- F29: validate goal tokens against the taught pegs/disks and decline by name before searching, so an
  unknown peg is a named miss, not a 300-move burn.

**Tests / pins for §6.** Board and goal shapes are chat-only:
- `planning.jsonl` keyed `planning.board.where-rest`: `where does disk-1 rest?` reads the board (not
  the code locator), with the negative that no `Canonical: where is … defined?` line appears.
- `planning.jsonl` keyed `planning.goal.natural-frames` (F27), `planning.goal.assumed-position-flagged`
  (F28), `planning.goal.unknown-token-declines` (F29).

**Docs.** None beyond the README board-read example already present.

---

## 7. The logician and casual honest-miss clusters (F19-F26)

None of these lies — they miss, or answer confusingly. Lower priority than the confident-wrong above
by that fact. Group by the reasoning or lane they touch; each ships with a keyed corpus row (a miss
is pinned as a miss, so a later "fix" that turns it into a guess goes red).

| # | Reproducer | Diagnosis | Fix area |
|---|---|---|---|
| F19 | `is a dog a dog` | reflexive subsumption not derived | the is-a-ask lane in `chat.mjs` — a term subsumes itself trivially |
| F20 | `felix is a cat` / `no cat is a dog` / `is felix a dog` | disjointness not propagated to the instance form on the negative side | the cax-dw instance path in the is-a-ask lane (same lane as §1) |
| F21 | `if something is a dog then it is a pet` / `is rex a pet` | universal conditional rule is not a supported teach shape | a new teach frame in `chat.mjs`; scope carefully — a general rule engine is larger work, flag it if it grows |
| F22 | `is a mammal a dog` / `is Record a Task` / `is every mortal a man` | non-holding, non-disjoint converse falls to the bare parse wall | the is-a-ask lane's miss closer — a guiding nudge beats the wall |
| F23 | `does rex have fur` (after `every dog has fur` / `rex is a dog`) | property-inheritance ask unrouted (misparsed as `does rex define fur`) | the `does X have Y` reader in `chat.mjs` |
| F24 | `do penguins fly` (penguin ungrounded) | ungrounded capability ask misroutes to the identity blurb | the capability-ask lane's ungrounded fallback |
| F25 | `what does the old router.mjs do` / `whats the old router.mjs for` | the module-orient lane doesn't strip/name the stale modifier the imports/calls lane now does | `moduleOrientLane` (`chat.mjs`) — carry the §5 residue guard here too |
| F26 | `what is the old store.mjs` / `what is the new model.mjs` | `what is the old <module>` misses the overview lane bare `what is <module>` reaches | the `what is <module>` recogniser — apply the same modifier strip |

**Note the shared work.** F20 rides the same cax-dw instance path as §1 — do them together. F25/F26
are the module-orient echo of the §5 stale-modifier residue guard — the same guard, one lane over
(again, one family, per `CLAUDE.md`). F21 is the one that could grow: a universal conditional rule is
adjacent to the rule-teach frames but larger; if it exceeds a single teach frame, say so explicitly
rather than deciding scope silently.

**Tests / pins.** One keyed corpus row per finding under `inference.*` (F19-F23) and `templates.*` /
`grammar.*` (F24-F26), each pinning the improved behaviour with a negative where it asserts an
absence. F20's pin belongs with §1's `inference.disjoint.*` key.

**Docs.** None beyond the pins.

---

## 8. The two CEFR follow-ups

### 8.1 `be-honest-empty` — a frozen expectation drifted out of sync (PICK)

The bootstrap-empty product reply was reworded this cycle to lead with the general-vocabulary /
taught-facts path. The case `be-honest-empty` still expects the old strings
(`answerMatch: ["is empty — no entities to answer from yet", "folds the conversation"]`), so its
tier-1 check fails even though the answer is an honest miss the judge scores 2/2. Verified: the live
reply is now "I can't answer that as a code question — no code graph is loaded in this session…"
(reproduced in-process; it is the same string `zeus is not mortal` lands on).

**The append-only rule.** The CHATBENCH case set is append-only mid-arc — the case cannot be edited
here. Two ways to reconcile, and this is a real choice for the operator:

- **Restore the wording in the product path** so the frozen `answerMatch` matches again. Cheapest,
  and it keeps the case honest without touching the case set. The reword was a product decision,
  though, so reverting it trades the newer, more helpful bootstrap-empty message for a green tier-1.
- **Record a deliberate expectation revision next cycle** — supersede the case with a new id whose
  `answerMatch` tracks the reworded string, at the next arc boundary where the append-only set may
  grow.

**Recommendation.** Keep the reworded product string (it is the better message — it points the user
at the taught-facts path that actually works) and record the expectation revision at the next arc
boundary. The tier-1 miss is a measurement artifact, not a behaviour regression; do not degrade a
good product string to satisfy a frozen check. Until the revision lands, the report already documents
why tier-1 sits at 108/109 rather than 109/109.

**Build (once decided).** If the operator picks restore: change the bootstrap-empty reply in the
chat path back to include "is empty — no entities to answer from yet"; pin the wording with a
`test/tools/` assertion so it cannot drift again unnoticed. If the operator picks revise: add the
superseding case to `chatbench/` at the arc boundary. No `src/` change in the revise path.

### 8.2 `gq-impact-a` — `(imports it)` on a depth-2 transitive dependent

**Reproducer:**

```txt
tmct> /impact app/lib/a.mjs
… depth 1 (4 direct dependents): app/lib/b.mjs (imports it) …
   depth 2 (2): app/functions/d/handler.mjs (imports it) …
```

The depth-2 dependent reaches `a.mjs` through an intermediary, but is labelled `(imports it)` as
though it imports `a.mjs` directly. The output is byte-identical to 2.0.3; a single harsher judge
draw flipped it across the hard-fail line, so this is stable behaviour surfaced by N=1 noise, not a
cycle regression. It is still a real overstatement in the label.

**Verified fix site.** Not the handler (a three-line wrapper) — the per-dependent label is built in
`renderImpact` (`src/domain/codegraph.mjs:411`, the `- ${dep.label} (${dep.via} it)` line, where
`dep.via` is the edge predicate from the dependent to its own parent in the closure). At depth ≥ 2
`dep.via` describes the hop to the intermediary, so "imports it" reads as importing the changed
module directly, which it does not.

**Build.** Past depth 1, phrase the reach as "reaches it via …" (naming the intermediary, or at least
not claiming direct import). Keep the depth-1 label as is. Low urgency.

**Tests / pins.** A `test/tools/` row over the impact fixture asserting the depth-2 label does not say
"imports it" directly (the negative), and the depth-1 label still does.

**Docs.** None.

---

## 9. Two parser tails

Both from `archive/PLAN_OPEN_ITEMS.md` §3.1/§3.2, both re-verified in-process.

### 9.1 `zeus is not mortal` — an unknown-subject negative is a silent no-op

**Reproducer** (bare seed session):

```txt
tmct> zeus is not mortal
I can't answer that as a code question — no code graph is loaded in this session …
tmct> /memory        # no zeus fact stored; only an Utterance recorded
```

Nothing is stored, and the turn lands on the bootstrap-empty code message rather than a clean decline
or a stored negative.

**Verified fix site.** The negation gate around `RETRACT_NOT_A_RE` (`chat.mjs:3224`) and the
negated-property handling in the same block (`chat.mjs:3215-3410`). A negative only stores where a
stored positive `subject⊑object` (or `subject hasProperty object`) exists to disagree with; with no
prior `zeus` fact, `zeus is not mortal` matches the negated-property shape but has nothing to anchor
on, so it falls through — past the teach lanes, onto the code-question bootstrap message.

**Build.** Give the unknown-subject negative a clean landing: rather than falling through to the
code-empty message, decline honestly and name what it would take to make the claim usable ("I don't
have anything about 'zeus' to attach 'not mortal' to — teach me 'zeus is mortal' first, or 'no zeus
is a mortal'"). Do not silently store a bare negative with no positive to disagree with — the
existing gate's caution is correct; only its landing spot is wrong.

**Tests / pins.** `inference.jsonl` keyed `inference.negative.unknown-subject`: `zeus is not mortal`
declines by name (not the code-empty message, not a silent no-op), with the negative that no zeus
fact is stored afterwards.

### 9.2 `are all dogs mortal` echoes the ungrammatical `all dogs is mortal`

**Reproducer:**

```txt
tmct> are all dogs mortal
I don't have a fact saying all dogs is mortal.
```

**Verified fix site.** The miss template at `chat.mjs:7948` — `I don't have a fact saying
${teachableSubjectOf(subject)} is ${adjective}.` — with `teachableSubjectOf` (`chat.mjs:5135`). For
`are all dogs mortal` the subject is the multi-word "all dogs", which `teachableSubjectOf` leaves
untouched, and the template hard-codes "is", yielding "all dogs is mortal".

**Build.** This wants a real agreement rule, not another strip — re-attaching the quantifier to a
folded lemma ("all dog is mortal") reads worse than what it replaces. Either fold the quantified
plural to its bare singular for the suggestion ("I don't have a fact saying a dog is mortal") or make
the copula agree with a quantified-plural subject ("all dogs are mortal"). The singular fold is the
smaller, and keeps the suggestion teachable. Whichever is chosen, `teachableSubjectOf` is where the
quantified-plural case is decided, and the template's copula must track it.

**Tests / pins.** `grammar.jsonl` keyed `grammar.quantifier.plural-agreement`: `are all dogs mortal`
misses with a grammatical suggestion (never "all dogs is mortal"), asserted by the negative that the
answer does not contain "dogs is".

**Docs.** None.

---

## 10. Decision — the resolver-floor `ab-c2-what-to-test` (AGENTBENCH)

**Status: investigated — restoration attempted per the operator's direction, and the archaeology
shows there is no resolver plan to restore. The 36% never measured a composed plan. Evidence below.
The expectation change is recommended, not applied — the operator decides.**

**What moved, in which commit, and why.** One commit moved this case: `e68994f` (1.8.1, the
TOO_HARD_AUDIT M2 fix). Before it, the case's expectation was relaxed to one call (`expect.calls =
[tmct_untested]`), and its own note said so: "RELAXED for PLAN grading to untested (the determinable
step) … PASSES plan, FAILS result — the goal-reasoner ranking is Stage 5, unbuilt." The resolver's
flat `untested` frame matched "needs a test" and emitted that single unranked call. That is the
whole 36%: a one-call bar, passed by a one-call answer, result-incomplete in every cycle (1.4.1,
1.5.7, 1.7.0). `e68994f` then changed both sides at once. It raised the expectation to the six-call
GDA trace (untested, then impact per violating module, keystone argmax), and it gated the frame on a
superlative cue (`skipIfSuperlative`, `resolver.mjs`) so the phrasing escalates to the C2 goal
reasoner instead of getting a half-answer. It pinned both outcomes: the floor refusal in
`test/bench/agentbench.test.mjs`, the goal-side composition in `test/adapters/goal-reasoner.test.mjs`.
Every later commit on `resolver.mjs` is refactors and comment purges. Nothing regressed. The
36% → 27% drop is the bar moving up past a half-answer, first seen at 2.0.3 and stable since.

**Re-verified at 2.5.2.** Resolver arm, C2: 3/11 (27%/27%, 0% hallucination). The three passes are
exactly the three `expect.refuse` cases; all eight misses are goal-rule composed proofs. This case
refuses with "no command, NL parse, or imperative frame selects a capability", the same as its
held-out twin `ab-c2-goal-keystone`, which expects the identical six-call trace. Goal arm, C2:
11/11 (100%/100%).

**Why the resolver cannot compose this plan from its own materials today.** The expected plan ranks
the untested set by impact. The request supplies, through every declared vocabulary the router and
`ask.mjs` share: the superlative cue ("most"), the metric noun ("test", the tests edge), and the
entity class (Module, via `METRIC_IMPLIES_ENTITY`). It nowhere supplies impact. The link from "needs
a test" to "rank by blast radius" exists in one place: the declared goal model's coverage-invariant
rule (`goal-reasoner.mjs`, priorityTopic `impact`). The member-filter drive is not a precedent —
there, both segments and the fold are read off the request's own syntax. Wiring untested → impact →
argmax into the resolver would copy that goal rule into the floor arm, the machinery the arm's
definition excludes, and keyed to this phrasing it would flip this case while the twin still
refused: phrasing overfit on a case tagged `overfitProne`, and the floor's C2 discrimination gone. A
resolver-side tier for norm-driven ranking would redefine the arm, so it is the operator's to
order, not a repair.

**The cheap counterfactual, run and measured.** Un-gating the frame (drop `skipIfSuperlative`) was
tried in the worktree and reverted. The floor still fails the case (one call against six,
`completed: false` either way), and the goal arm regresses 11/11 → 10/11 (91%/91%), because the
goal driver runs C1 first and the un-gated frame claims the phrasing with the half-answer. Those are
the exact pre-M2 numbers. Restoring the old one-call expectation fails in reverse: `expect` lives in
`cases.jsonl` and is shared by every arm, so the goal driver's six-call trace would then fail it.

**Recommended (not applied).** Record the case on the floor arm as a declared refusal, the same
expected-outcome class as `ab-c2-goal-escalate-method` (`expect.refuse`). Because `expect` is shared
across arms, this needs a small per-arm seam — say a case-level `floorExpect: { refuse: true }` that
`grade.mjs` applies to floor-driver rows only — leaving the goal arm's six-call expectation intact.
Both present behaviours are already pinned, so the arms cannot drift silently while the decision
waits.

**Adjacent finding (chat lane, not this bench — needs an owner).** The chat surface answers this
exact phrasing inverted: "what most needs a test in this codebase" parses to superlative(metric
tests, extreme most) and, on the bench fixture, answers "app/lib/b.mjs and app/functions/d/handler.mjs
— the most test (1) (2-way tie)" — the MOST-tested modules. A need/lack verb does not flip the
extreme. Fix site: `ask.mjs` `parseSuperlative`; a chat-lane grammar change with its own corpus pins.

---

## 11. Decision — `syllogise`, a published CLI verb

`syllogise` is a forward-chaining fixpoint (its own header says so, `syllogise.mjs:1-4`), and only
some of its rules are genuine syllogisms (`scm-sco` is Barbara; `cls-svf1` and the cardinality rules
are not). It is also a published CLI surface (`npx tmct syllogise`, wired at `cli-verbs.mjs:104`), so
renaming touches users, which makes it the operator's call.

**The two options:**

- **Keep `syllogise`, name the mechanism accurately in the code and its gloss.** No CLI break. The
  code header already says forward-chaining fixpoint; the gap is a user-facing gloss (CLI help,
  README) that `syllogise` is the product verb for a materialisation pass over OWL 2 RL rules, of
  which the syllogism is one family. `archive/PLAN_NORMATIVE.md` §9 reaches this same conclusion
  ("keep `syllogise`, and gloss it — the fix is three sentences, not a rename") after checking that
  every reachable dictionary defines "syllogise" narrowly and the field's own usage is loose.
- **Rename the verb.** Accurate, but it breaks `npx tmct syllogise` for every existing user and
  script, needs a deprecation alias, and touches docs, completions, and the CLI route tests.

**Recommendation: keep the verb, gloss the mechanism.** The rename's cost (a published CLI break)
buys precision a one-line gloss already delivers. Keeping it is consistent with the archived
normative review and with the project's own preference for not churning published surfaces.

**What to build (the recommended path).**
- Update the `syllogise` CLI help text (`cli-verbs.mjs:106` usage / description) and the command's
  gloss to say plainly what it does: a deterministic forward-chaining materialisation over the OWL 2
  RL rule kernels, the classical syllogism among them. Name the mechanism, not just the verb.
- One README line to the same effect beside the `syllogise` example.
- A pin: a `test/tools/cli-route.test.mjs` (or `schema-docs`) assertion that the help text names the
  forward-chaining mechanism, so the gloss cannot silently rot back to just the verb.

**If the operator instead picks rename:** add the new verb, keep `syllogise` as a deprecated alias
that prints a one-line notice and still runs, update `cli-verbs.mjs`, the completions, the README, and
the CLI route tests, and pin both the new verb and the alias.

---

## 12. Strengthen the ontology-vocabulary test (§7.13)

`mgx:factJustification` is emitted by production code (`core.mjs:1141`) and was declared in no
ontology file, yet the §6 vocabulary test passed — because it checks what the ontology **documents**
(`emptyMemory().vocabulary`, i.e. `MEMORY_VOCABULARY`, `core.mjs:69`), and `factJustification` is
absent from that list, so it fell through both gates at once.

**Verified current state.** `test/adapters/grammar-ontology.test.mjs` already has a test "a fact
attribute the writer emits is grounded, even when the payload vocabulary never documents it"
(`:182`), but it checks a **hard-coded** list `["mgx:factJustification", "mgx:factQuantifier",
"mgx:factProvenance"]`. A future undocumented emitted prop that is not in that list would still slip
through. The strengthening HANDOVER asks for is a **store-derived diff**, not a longer hand-list.

**Build.** In `test/adapters/grammar-ontology.test.mjs`, add a test that seeds a real store
(`createInMemoryStore` + `appendFacts`, plus an entailed-fact write so the justification/quantifier
props are actually emitted), reads back every distinct `prop` the store's Fact individuals carry, and
asserts each one is either documented in `MEMORY_VOCABULARY` or defined in `ontology/tmct-core.ttl`.
The set comes from the store, not a literal, so a new emitted prop that is declared nowhere fails the
test by construction. This needs a seeded store in the test — the `test:fast` budget's business, and
the reason it was out of the normative plan's scope.

**Tests / pins.** The test is the pin. It must fail if a prop the store writes is grounded nowhere,
and pass on the current tree (where the three emitted props are now declared in the ontology).

**Docs.** None beyond the test comment (no plan/date reference in it, per `CLAUDE.md`).

---

## 13. Build the SKOS consumer surface (§7.6)

`buildSkosConceptView` mints one `skos:Concept` per normalised corpus term, folds `mgx:synonym` to
`skos:altLabel`, and reads `mgx:relatedTo`/`mgx:similarTo` as `skos:related`. It is proven and pinned
(9 assertions) but lives **inside** `test/adapters/skos-concept-identity.test.mjs:32` and nothing in
`src/` reads it, so `CAPABILITIES_2.5.0.md` row 155 sits at `partial` (tested, unreachable). The
tool-layer entry is what moves it to `implemented` (`SKILL_CAPABILITIES_AUDIT.md` §1).

**Verified current state.** The function is defined in the test file, over `readFactRows` output from
`src/adapters/memory/core.mjs`. The tool architecture it must join: `src/tools/definitions.mjs`
(`TOOL_DEFINITIONS`, tier/inputSchema), `src/tools/handlers/*.mjs` (one module per tool),
`src/tools/handlers/index.mjs` (the registry), `src/tools/server.mjs` (`dispatchTool`). `tmct_impact`
(`src/tools/handlers/tmct-impact.mjs`) is the shape to mirror.

**Build.**
- Promote `buildSkosConceptView` verbatim into an exported `src/domain/skos-view.mjs` (its logic is
  pure and self-contained — union-find over synonym edges, `normFactTerm` for concept identity, no
  storage writes). Re-point the 9 assertions in
  `test/adapters/skos-concept-identity.test.mjs` at the import so the proof follows the code and does
  not fork.
- Wire one consumer, cheapest first: a chat lane for `what is related to X` / `another word for X` /
  `synonyms of X` that reads the term's `mgx:relatedTo`/`mgx:synonym` facts through the view and
  answers, missing honestly when the term has none (or is unknown). This lane reads the store's fact
  rows, builds the view, and looks up `conceptIdForTerm(X)` → its `skos:related` neighbours /
  `altLabels`.
- Add a tool-layer entry `tmct_related` (definition in `definitions.mjs`, handler
  `src/tools/handlers/tmct-related.mjs`, registration in `handlers/index.mjs`) that serves the same
  view over `dispatchTool`. This tier is what actually moves row 155 to `implemented`.

**Tests / pins.**
- A `test/tools/` test driving `tmct_related` (or the ask tool that reaches the lane) on a seeded
  store that holds `mgx:relatedTo`/`mgx:synonym` facts: `another word for X` returns the altLabels,
  `what is related to X` returns the related concepts.
- The load-bearing **negative**: an unknown term, and a term with no synonym/related facts, both miss
  honestly (never a guessed neighbour).
- `grammar.jsonl` / `templates.jsonl` rows pinning the three phrasings with that negative row.
- Keep the promoted 9 assertions green against the new module.

**Caveat (carry into the docs, not as a wall).** The lane only answers on a store that holds
synonym/related facts. The ConceptNet import mirrors `/r/RelatedTo` and `/r/Synonym` into `mgx:`, so
`init:large`+ carries them; a bare `init` has few. This is a property of the seeded data, not a limit
of the surface — state it as "answers where the store holds relation facts", not as a ceiling.

**Docs.** A one-line README example (`another word for X`), mark §7.6 LANDED in its record, and move
`CAPABILITIES_2.5.0.md` row 155 to `implemented` when it re-measures (not this plan's file to edit).
Optionally add and pin the `mgx:relatedTo rdfs:seeAlso skos:related` ontology annotation.

---

## Ordering and grouping, restated

1. **§1** — the disjointness proof. Worst, proof-shaped, and a `chat.mjs` ordering fix over a
   capability that already exists. Do §7's F20 with it (same cax-dw path).
2. **§2, §3, §5** — the code-query surface: impact routing, `parseQuery` result-type gaps, and the
   stale-modifier residue guard. Highest blast radius after §1; six confident-wrong findings, most
   tool-reachable so pinnable at the tool layer. §7's F25/F26 ride §5's residue guard.
3. **§4** — the Tier-0 vocabulary lane. What unpins the conversation ladder; chat-only, corpus-pinned.
4. **§6** — the board-read and goal-frame gaps. Chat-only, planner-adjacent.
5. **§7** — the honest-miss clusters. Lowest of the CONVERSATION backlog by class (misses, not lies).
6. **§8, §9** — the CEFR follow-ups and the two parser tails. Small, well-scoped.
7. **§10, §11** — the two decisions. §10 is investigated: no resolver plan to restore, evidence in
   the section, expectation change back with the operator. §11 waits on the operator's pick.
8. **§12, §13** — the ontology-vocabulary test and the SKOS consumer surface. Self-contained; §13
   closes audit row 155.

Version rolls per the operator's cadence, commit each, do not push — CI publishes on a version bump
on `main`. Update this file and delete the matching `HANDOVER.md` line in the same commit as each fix.
