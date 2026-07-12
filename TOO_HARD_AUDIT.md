# TOO_HARD_AUDIT.md — a hunt for stale "can't be fixed" claims

## Why this doc exists

An AI assistant working in this repo across many sessions sometimes writes "this can't be
fixed", "permanent", "frozen", or "out of scope" into a comment or a doc. Some of those claims
are true. Some are the assistant giving up under context pressure and dressing it as a fact. The
danger is the second kind. A fresh session reads the claim later, treats it as settled, and never
re-checks it. That is context poison: a lazy or mislabelled "impossible" that compounds because
nobody re-derives it.

### The calibration example (imports/mean)

`g-a1-naming-9` and `am-meta-imports` are two graded cases that both grade the literal input
"what does imports mean". Several write-ups called this "a permanent, deliberate authoring
conflict" and said "a deterministic function cannot honor both on the same input". That was true
in a narrow sense. You cannot make one bare hedge string satisfy two different substring checks.
It was false in the broad sense. A better answer shape sidesteps the conflict. If the ambiguous
reply resolves each candidate reading and shows its real answer, the plain "imports is a
predicate…" definition appears inside the ambiguity frame, so `am-meta-imports`'s check passes and
`g-a1-naming-9` also gets a real answer. Both pass with no compromise. Multiple past sessions
repeated the "permanent, unfixable" line without re-deriving it. That is the exact failure mode
this audit hunts.

The project already catches this failure mode when it looks. `PLAN_CONVERSATION.md` Finding 5
says outright: "A first-pass guess going into this investigation was 'architectural' — traced
precisely, that guess does not hold." So the goal here is to do that tracing everywhere the strong
"can't" language still sits unexamined.

---

## Status

Every flagged finding from this audit's original pass is now resolved — re-derived directly
against current code, not assumed. None turned out to be a real, unfixable ceiling.

- **M1** (imports/mean "permanent conflict") — fixed, commit `d955b25`; a second confirmation
  landed in `BENCHMARK_CEFR_ENGLISH_1.8.0.md` (the `ambiguity` cell +0.437). Stale wording in
  `BENCHMARK_CEFR_ENGLISH_1.7.0.md` swept with correction notes.
- **U1** (`broadSearch` "architectural limit") — turned out to have already shipped a full day
  *before* the finding was written (`798a77f`) — the finding was stale at the moment of its own
  authoring.
- **M2** (AGENTBENCH `ab-c2-what-to-test`) — fixed. The keystone-argmax ranking
  (`goal-reasoner.mjs:421-431`) already existed; the request just never dispatched into it. A C1
  imperative frame (`resolver.mjs`'s flat `untested` frame) short-circuited to a single unranked
  `tmct_untested` call before C2 ever ran, and `ask.mjs`'s superlative grammar separately required
  an explicit entity noun ("module") the phrasing never supplies. Fixed with declared tables, not a
  new request keyword: the frame now skips on a superlative cue (`resolver.mjs`'s `SUPERLATIVE_RE`,
  built from `ask.mjs`'s own `SUPERLATIVE_EXTREMES`), and `parseSuperlative` defaults `entityType`
  from a metric that implies exactly one class (`ask-vocab.mjs`'s `METRIC_IMPLIES_ENTITY`:
  `tests -> Module`). AGENTBENCH C2 moved 91%→100% plan-completion, 10/11→11/11 result-complete.
- **U2** (deep relative-clause two-hop composition) — never broken. Live-tested against a real
  graph (`examples/mini-webapp`): `"which modules import something that src/server/app.mjs
  imports"` correctly composes a real two-hop join (`parseNested` → `reverseSet`/`forwardSet`,
  already a working, tested mechanism — see `test/ask-compositional.test.mjs`'s own pinned 2-hop
  and depth-≥2 cases). The two original repro queries ("Task depends on", "functions that saveStore
  calls") failed for a mundane reason unrelated to the grammar: those specific named entities don't
  have the asked-about edge type in that graph (a Class has no `imports` edges; a called individual
  was a Class, not a Function) — an honest, correct miss on absent data, not a composition ceiling.
- **B1** (ROADMAP/HANDOVER "out of design-ability horizon" wording) — reworded to match
  `PLAN_CONVERSATION.md`'s own accurate framing ("large, three sub-problems, not attempted in a
  single pass").

A note on volume, for future hunts. "frozen" and "sacred" match about 136 lines across the repo.
Nearly all are the legitimate regression-pin convention (a pinned test guards shipped behaviour).
That convention is load-bearing and correct, not poison — the rest are not listed here because
listing them would pad the count with true statements.

---

## GENUINE — real, re-derivable constraints (listed for reference, checked)

These read as poison-shaped on a grep but hold up on inspection. They name a real mechanism, and in
several cases they name the fix direction too, which is the opposite of giving up.

- `test/chatflow-tier5.test.mjs` and `test/chatflow-tier6.test.mjs` "genuine ceiling, NOT fixed"
  notes (tier5:138, 179, 452, 535; tier6:216). Each names the exact mechanism, distinguishes a
  grammar feature from a routing fix, and often names the feature that would close it. One even
  records that a widening attempt was tried and reverted, which is real evidence. Healthy sign: a
  later commit (`803c4ba`) reopened and partly fixed the tier6 "entityType-noun object" ceiling, so
  these markers are being revisited normally, not treated as sacred.
- `PLAN_CONVERSATION.md:355` "RELATIONS' flat contiguous-phrase table architecturally cannot express
  'uses X as its base'". True. `findPhrase` matches a contiguous run of words, and the verb and
  qualifier sit on opposite sides of the object. Closing it needs a new discontiguous-frame
  recognizer, which the doc states plainly. Genuine, with the fix named.
- `archive/INFBENCH_1.3.0.md:59` "C1's raw numbers are back to being a genuine ceiling marker, not a
  fabrication". This is the project re-deriving a ceiling on purpose and saying so. Good practice,
  the model to copy.
- `ROADMAP.md:117` "No MCP server, no LLM in the product path — permanent, not 'for now.'" A project
  charter constraint, not an engineering give-up. Genuine by definition.
- **`init:xxxl` (a literal 1000x scale-up of `init:large`'s seed corpus) is not reachable from data
  in this project's own repo or the 4 adjacent `globalwordnet` repos alone.** Checked with real
  numbers, re-derived twice in the same sitting after the first pass under-counted (see below —
  exactly the self-correction this doc exists to force). `init:large` measures 7,386 facts today.
  The full local ceiling — every structural relation in
  `~/projects/globalwordnet/english-wordnet`'s 107,526 synsets (202,292 facts), namenet, both unused
  `human-medium`/`human-large` tiers, and a widened `conceptnet-map.toml` (see the next bullet) —
  tops out around 264,000 facts (~36x). Reaching further needs a one-time bulk download of
  ConceptNet's full English assertion set (~5.9M rows, CC-BY-SA, not present in any of the 4 local
  `globalwordnet` repos). Filtered through this project's fact-quality gate at its corrected ~81.5%
  survival rate (see next bullet — the first-pass estimate used the OLD, wrongly-narrow map and got
  ~17%), that yields roughly **4.8M facts — ~651x, still short of literal 1000x but far closer than
  the first estimate claimed**. `init:xl` (10x) and `init:xxl` (~36x) are built from data in hand;
  `init:xxxl` stays a documented, costed option (bulk download + re-measurement, ~651x is the honest
  projected multiplier, confirm the real number once actually downloaded) rather than an implemented
  script — the operator's call, not a technical ceiling this time either.
- **`conceptnet-map.toml`'s `ace="none"` exclusions were mostly sound but one was not, caught by
  asking "where exactly does the source say that" instead of accepting the summary.** `RelatedTo`
  (29,016 of the 44,947 rows in the committed `corpus/conceptnet/slice.jsonl` — the single largest
  relation in the file) carried the note "too vague for an axiom... never a fact"
  (`src/corpus/conceptnet-map.toml:187-192`) despite already having a fully-authored `surface`
  template sitting right next to the exclusion. That is a design call dressed as a technical one.
  Un-excluded it (at a lower `trustScore` via the trust-tier mechanism already present on every
  stored fact, rather than either full-strength or excluded) alongside `Synonym`/`Antonym`/
  `SimilarTo`, which had no real justification for exclusion at all. `HasContext`/`DerivedFrom`/
  `FormOf`/`EtymologicallyRelatedTo`/`EtymologicallyDerivedFrom`/`ExternalURL` stay excluded — those
  really are a different kind of thing (domain tags, word morphology, link-outs), not the same
  pattern as `RelatedTo`. Net effect: the committed slice's own emitted-fact yield goes from 6,247 to
  36,654 (81.5% of the file, up from 13.9%) with zero new fetching — and the bulk-download multiplier
  above got recalculated from ~167x to ~651x as a direct consequence of catching this.

---

## LEGITIMATE scope decisions — checked against the evidence

- Farewells and elaborate goodbye/thanks phrasing "stay out of scope". Cited as a "standing operator
  decision" at `BENCHMARK_CONVERSATION_1.5.7.md:89` and enforced in code at `src/chat.mjs:960`. The
  decision is real and written down: `SKILL_BENCHMARK_CONVERSATION.md:502` ("Farewells stay out of
  scope"). The citation checks out, so this is a genuine scope decision, not an inferred one.
- "Has-a-method teach shape … built as a new ACE pattern, per operator decision"
  (`CAPABILITIES_1.5.0.md:27`). Backed by a documented ranked decision in the same audit. Legitimate.
