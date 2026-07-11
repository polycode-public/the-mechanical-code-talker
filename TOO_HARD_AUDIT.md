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

## Summary counts

Total flagged findings: 8.

| Category | Count | Read first? |
| --- | --: | --- |
| MISLABELED test artifact | 2 | yes |
| BACK-OFF / rationalization | 1 | yes |
| UNVERIFIED | 2 | soon |
| GENUINE constraint | 2 (families) | reference |
| LEGITIMATE scope decision | 1 (family) | reference |

The two MISLABELED findings and the one BACK-OFF finding are the ones worth acting on. Everything
below GENUINE is documented well and re-derives cleanly. It is listed so a reader knows it was
checked, not skipped.

A note on volume. "frozen" and "sacred" match about 136 lines across the repo. Nearly all are the
legitimate regression-pin convention (a pinned test guards shipped behaviour). That convention is
load-bearing and correct. Only one "frozen" hit is poison, and it belongs to the imports/mean
cluster below. The rest are not listed because listing them would pad the count with true
statements.

---

## MISLABELED — a real narrow constraint labelled as a broader "unfixable"

### M1. The imports/mean "permanent, deliberate authoring conflict" cluster (flagship)

This is the calibration case itself, and the stale framing is still written into the repo in
several places.

| File:line | Quoted text |
| --- | --- |
| `BENCHMARK_CEFR_ENGLISH_1.7.0.md:136` | "the same permanent, deliberate authoring conflict … a fix for one necessarily breaks the other (§1's regression rule forbids it)" |
| `BENCHMARK_CEFR_ENGLISH_1.7.0.md:256` | "confirmed once again this cycle to be a permanent, deliberate authoring conflict … nothing can move it without breaking its sibling case, per the regression rule" |
| `BENCHMARK_CEFR_ENGLISH_1.7.0.md:321` | "still deliberately unfixed because `am-meta-imports` wants the plain definition for the identical input string" |
| `BENCHMARK_CEFR_ENGLISH_1.6.0.md:255` | "the remainder is a permanent structural conflict, not an unfixed bug" |
| `test/chat-cefr-1.6.1-decision-log.test.mjs:13` | "the sibling case g-a1-naming-9 is a permanent, structural non-fix … a deterministic function cannot honor both on the same input" |
| `test/chat-cefr-1.6.1-decision-log.test.mjs:96` | test name: "frozen guard: … g-a1-naming-9 cannot be reconciled with that on the same input" |

Classification reasoning. The narrow claim is true. One bare string cannot satisfy two byte
different substring checks. The broad claim ("permanent", "cannot be reconciled") is false,
because a richer answer shape holds both readings at once. The docs assert the broad claim.

Researched unstuck angle (verified against HEAD). `renderCore` in `src/ask.mjs:3506` still only
*describes* each candidate parse. It maps candidates through `describeParse` and returns "this
could mean more than one thing: 1) … or 2) … — try rephrasing more specifically." It never
resolves them. So the "show both real answers" fix the calibration story describes is **not yet in
the code**. The angle is live and concrete: in that branch, run each candidate through
`traverse()`/`render()` and embed the real answers in the reply. The plain "imports is a predicate
(relation) in the graph's schema…" definition then sits inside the ambiguity frame, so
`am-meta-imports`'s definition check finds it, and `g-a1-naming-9` gets a real answer instead of a
"try rephrasing" punt. Note also that the cited "regression rule forbids it" is itself part of the
poison. The regression rule only forbids flipping a passing case to failing. The answer-shape fix
flips neither case, so the rule does not forbid it. The rule was invoked to close the question, not
because it applies.

### M2. AGENTBENCH "the one honest red — kept deliberately"

| File:line | Quoted text |
| --- | --- |
| `archive/AGENTBENCH_0.8.2.md:82-86` | "Ranking 'most needs' would require a request-keyword → priority mapping the goal model does not declare — i.e. **request-keyword memorization**, the exact overfit the discipline forbids. It stays red until a priority reading is *declared*, not pattern-matched." |

Classification reasoning. This is a false dichotomy dressed as a principle. It frames the only two
options as (a) memorize the request keyword "most needs" or (b) leave the case red. The real third
option is already built.

Researched unstuck angle. `src/router/goal-reasoner.mjs:106-110` already declares a priority
reading for exactly this shape. `priorityTopic: "impact"`, where a module's priority is its blast
radius `|impact(module)|`, and the keystone is "the widest-reach untested module". Ranking the
untested set by that declared impact metric is a principled priority reading, not keyword
memorization. The note even concedes the case "stays red until a priority reading is *declared*".
The declared reading exists in the codebase. It is just not wired into this answer's composition
step. So the honest status is "the ranking is declared but not yet composed into the answer", not
"declaring it would be forbidden overfitting". The discipline the note invokes does not actually
block the fix.

---

## BACK-OFF / rationalization — language that talks a future reader out of continuing

### B1. "out of design-ability horizon for a single pass"

| File:line | Quoted text |
| --- | --- |
| `ROADMAP.md:52-53` | "No fix sketch yet, out of design-ability horizon for a single pass." |
| `HANDOVER.md:22` | "no fix sketch, out of design-ability horizon for a single pass." |

Classification reasoning. This is a mild case, and the source doc is honest, which is why it lands
here rather than in MISLABELED. The phrase "out of design-ability horizon" reads as "we cannot even
design this". The source, `PLAN_CONVERSATION.md` Finding 4, contradicts that. Finding 4 gives a
precise root-cause diagnosis (the interrogative detector `QUESTION_LEAD_RE` at `chat.mjs:1503` is
anchored to sentence start with `^`, so it never fires on a mid-sentence "which"), names two
under-guarded call sites, and lists all three sub-problems with a direction for each. The PLAN's own
words are accurate and milder: "out of the fast loop's scope" and "needs real design work across
three separate sub-problems". The ROADMAP/HANDOVER compression to "out of design-ability horizon"
is the drift. It upgrades "large, multi-part, not yet attempted" into "beyond what we can design".

Researched unstuck angle. The work is bounded, not undesignable. Sub-problem (2) alone, a POS-aware
mid-sentence interrogative detector to replace the anchored-only regex, fixes the pronoun-removed
repro ("TaskController uses which controller as its base") on its own. The project already uses the
wink POS adapter elsewhere to tell interrogative "which" from relative "which", which is the one
real risk Finding 4 flags. A scoped detector reused at the two named call sites is a concrete first
increment. Suggested edit: soften the ROADMAP/HANDOVER wording to match the PLAN ("large, three
sub-problems, not attempted in a single pass"), so a future session does not read "undesignable" and
skip it.

---

## UNVERIFIED — impossibility asserted without a fresh re-derivation

### U1. broadSearch "deeper architectural limit"

| File:line | Quoted text |
| --- | --- |
| `CAPABILITIES_1.5.0.md:19` | "the sprint found a deeper architectural limit … `broadSearch` only ever searches memory **blocks** written via an explicit `saveBlock()` call, never the live graph or taught Facts directly … the practically-common case — a first-ever question about a subject — still declines." |

Classification reasoning. The label "architectural limit" is stronger than the finding supports.
The note itself describes a plain data-source gap: `broadSearch` reads only saved blocks, not the
graph or reified Facts. That is a wiring gap, not an architectural wall. The same note names the
fix direction in passing.

Researched unstuck angle. `broadSearch` could read the same sources `factAnswer` already reads: the
live graph and the reified `Fact` individuals. Seeding or falling back to those would answer a
first-ever question about a subject. This is a superseded audit doc (current is `CAPABILITIES_1.6.0.md`),
and 1.6.0 does not mention `broadSearch`, so the gap was likely never revisited. Worth a fresh look
before anyone quotes "architectural limit" again.

### U2. deep relative-clause composition "plausibly a genuine ceiling"

| File:line | Quoted text |
| --- | --- |
| `BENCHMARK_CONVERSATION_1.4.1.md:105` | "both returned honest 'nothing matches' misses … plausibly a genuine ceiling (deep relative-clause composition is known-hard territory per this project's own INFBENCH/CHATBENCH history), not independently confirmed as fixable this cycle." |

Classification reasoning. The hedging here is good practice ("plausibly", "not independently
confirmed"). The weak spot is the ground for the guess: "known-hard territory per this project's own
history". That is reasoning carried forward, not re-derived against current code.

Researched unstuck angle. The two failing queries ("which modules import something that Task depends
on", "what tests cover the functions that saveStore calls") are two-hop joins. tmct already answers
each single hop, and it already has a transitive closure for imports and calls. It also has a
composite evaluation path (`evalComposite`/`evalMembershipComposite` in `src/ask.mjs`). So a
two-hop join is a composition of parts that exist, not a new capability class. This deserves a fresh
attempt rather than an inherited "known-hard" label. Marking it UNVERIFIED, not GENUINE, because
nobody re-checked it against the composite path this cycle.

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

---

## LEGITIMATE scope decisions — checked against the evidence

- Farewells and elaborate goodbye/thanks phrasing "stay out of scope". Cited as a "standing operator
  decision" at `BENCHMARK_CONVERSATION_1.5.7.md:89` and enforced in code at `src/chat.mjs:960`. The
  decision is real and written down: `SKILL_BENCHMARK_CONVERSATION.md:502` ("Farewells stay out of
  scope"). The citation checks out, so this is a genuine scope decision, not an inferred one.
- "Has-a-method teach shape … built as a new ACE pattern, per operator decision"
  (`CAPABILITIES_1.5.0.md:27`). Backed by a documented ranked decision in the same audit. Legitimate.

---

## Closing note

The single highest-value action is M1. The "show every candidate's real answer" fix is described in
this session's own framing but is not in `renderCore` at HEAD, and the stale "permanent" language
still sits in two benchmark docs and a test. M2 is the next best, because the fix ingredient (the
declared impact priority) already exists in `goal-reasoner.mjs` and only needs wiring. B1 is a
cheap wording fix that stops a future session reading "undesignable" and skipping a bounded task.
