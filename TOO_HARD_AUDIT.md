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

Total flagged findings: 8. **Update (2026-07-11 capability audit, pinned `981c9b2`/v1.7.3): M1 and
U1 are now RESOLVED — re-checked directly against current code, not assumed.** M2's diagnosis is
refined (the mechanism it named turned out to already be wired; the real remaining gap is narrower
than the finding stated). B1's suggested wording fix is applied in this same pass, in `HANDOVER.md`
and `ROADMAP.md`. See each entry below for the evidence.

| Category | Count | Read first? |
| --- | --: | --- |
| RESOLVED since this audit | 2 (M1, U1) | yes — confirms the hunt works |
| MISLABELED test artifact, still open | 1 (M2, refined) | yes |
| BACK-OFF / rationalization | 1 (B1, wording applied) | yes |
| UNVERIFIED | 1 (U2) | soon |
| GENUINE constraint | 2 (families) | reference |
| LEGITIMATE scope decision | 1 (family) | reference |

M2 (refined) and B1 (wording now applied) are the two live action items. M1 and U1 confirm the
audit's own premise: unstuck angles found here really do get unstuck. Everything below GENUINE is
documented well and re-derives cleanly, listed so a reader knows it was checked, not skipped.

A note on volume. "frozen" and "sacred" match about 136 lines across the repo. Nearly all are the
legitimate regression-pin convention (a pinned test guards shipped behaviour). That convention is
load-bearing and correct. Only one "frozen" hit is poison, and it belongs to the imports/mean
cluster below. The rest are not listed because listing them would pad the count with true
statements.

---

## RESOLVED — findings confirmed unstuck since this audit was written

### M1. The imports/mean "permanent, deliberate authoring conflict" cluster (flagship) — RESOLVED, commit `d955b25`

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

**Resolution, confirmed 2026-07-11 (capability audit, pinned `981c9b2`).** The exact fix this entry
called for landed in commit `d955b25`, the same day this finding was written — `src/ask.mjs`'s
`renderCore()` (line ~3523) now traverses and renders every `ambiguousParse` branch for real instead
of only describing it; both `am-meta-imports` and `g-a1-naming-9` pass on the identical input, no
compromise, no test weakened (`test/showcase.test.mjs`, updated in the same commit; `1917/1917` then,
`1919/1919` now). `BENCHMARK_CEFR_ENGLISH_1.7.0.md`'s own top-of-file correction note independently
confirms this. **Leftover stale citations, not yet swept**: `BENCHMARK_CEFR_ENGLISH_1.7.0.md:147,267`
still repeat the retired "permanent, deliberate authoring conflict" framing in their per-case
transcript prose (below that file's own correction note, in text written before the fix landed) —
harmless (the correction note at the top of that file already supersedes them) but worth a wording
pass next time that report is touched. `test/chat-cefr-1.6.1-decision-log.test.mjs`'s test NAME at
line 96 ("frozen guard: … cannot be reconciled") is similarly stale text on a test that now asserts
the resolved-not-described behavior — cosmetic, not a functional risk.

### U1. broadSearch "deeper architectural limit" — RESOLVED, shipped before this finding was written

**Resolution, confirmed 2026-07-11 (capability audit, pinned `981c9b2`).** This finding's own
"researched unstuck angle" — "`broadSearch` could read the same sources `factAnswer` already reads:
the live graph and the reified `Fact` individuals" — was already built by the time this finding was
written, just not connected to it. `src/completions/graph-adapter.mjs`'s `createCompletionsGraphAdapter(graph,
memory)` (commit `798a77f`, 2026-07-10, well before this finding) wires exactly that: `.search()`
delegates to the real graph service, and `.ask()` builds real sentences and consults both the code
graph and, when a `memory` store is passed, the Fact-half of `ask()` — confirmed directly in
`src/completions/graph-adapter.mjs:16-38,73`. `broadSearch()` (`src/completions/search.mjs:51-83`)
calls both `graphService.search()` and `graphService.ask()` when a service is supplied — not
block-only, contrary to the finding's premise. This was already tracked as shipped, `CAPABILITIES_1.5.7.md`
item #88 ("`graphService` adapter wired into the completions pipeline") — the gap this finding named
closed a version before `CAPABILITIES_1.5.0.md`'s "architectural limit" framing was written, and the
framing was simply never revisited until now. No code change needed; this entry documents the
re-derivation this doc's own discipline calls for.

---

## MISLABELED — a real narrow constraint labelled as a broader "unfixable"

### M2. AGENTBENCH "the one honest red — kept deliberately" — still open, diagnosis refined

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

**Refined, confirmed 2026-07-11 (capability audit, pinned `981c9b2`) — the original diagnosis was
half right.** Live-verified against real code, not just re-read: `src/router/goal-reasoner.mjs:421-431`
already DOES compose an answer from the declared `priorityTopic`/`coverageTopic` pair — a keystone
argmax over `|impact(m)|` for each violating `untested` module, exactly the mechanism this finding
asked for. So "not wired into the composition step" is no longer accurate; that step exists and
works (confirmed by direct code read of the `mode === "global"` branch). What's still broken, traced
live by re-running the exact case (`node agentbench/run.mjs --driver goal --ladder`,
`agentbench/cases.jsonl`'s `ab-c2-what-to-test`, request "what most needs a test in this codebase"):
the request never reaches that composition branch at all. Its recorded trace shows only two proof
steps ("imperative frame => goal (knows untested)", "backward-chain => tmct_untested") and calls only
`tmct_untested`, never `tmct_impact` — the STEP-2 GDA expansion that would push per-module `impact`
sub-goals onto the pending queue (`goal-reasoner.mjs:388-393`) never fires for this request, so the
already-working keystone argmax at the bottom never gets data to rank. This is a **request-to-rule
dispatch gap**, not a missing composition mechanism — a narrower, more precise diagnosis than either
the original finding (which said "not composed") or the "genuinely a keyword-memorization problem"
framing it was refuting. `BENCHMARK_AGENT_1.7.0.md` still reports this exact case
plan-correct/result-incomplete, consistent with this trace. Still the top open item on this list.

---

## BACK-OFF / rationalization — language that talks a future reader out of continuing

### B1. "out of design-ability horizon for a single pass" — wording applied, commit pending in this pass

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

**Applied, 2026-07-11 (capability audit, pinned `981c9b2`).** `HANDOVER.md` and `ROADMAP.md` both
reworded in this same pass. `PLAN_CONVERSATION.md` itself (Findings 1, 2, 3, 5 resolved; Finding 4
this one open item) is archived to `archive/PLAN_CONVERSATION.md` in this pass too — Finding 4 is
real, bounded, scoped work, not an unfinished plan with open design questions, so it belongs as a
`HANDOVER.md` open item pointing at the archived doc, not a live root-level `PLAN_*.md`.

---

## UNVERIFIED — impossibility asserted without a fresh re-derivation

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

**Update (2026-07-11 capability audit, pinned `981c9b2`/v1.7.3).** M1 and U1, this doc's own top
two "worth acting on" items at the time of writing, are now RESOLVED — re-derived directly against
current code, not assumed from this doc's own prior wording. M1 shipped the same day this doc was
written (commit `d955b25`); U1 turned out to have shipped a full day *before* this doc was written
(commit `798a77f`), meaning the finding was stale at the moment of its own authoring — the sharpest
possible confirmation that this doc's own hunt is worth repeating every cycle, not just written once.
B1's wording fix is applied in this same pass. M2 is the one item still genuinely open, and its
diagnosis is now sharper: the composition mechanism it asked for already exists
(`goal-reasoner.mjs:421-431`); the real gap is that the one benchmarked request never dispatches into
the rule that owns it. That's the next concrete, scoped pickup — not "wire the ranking," but "get
`ab-c2-what-to-test`'s request routed to the rule that already ranks."
