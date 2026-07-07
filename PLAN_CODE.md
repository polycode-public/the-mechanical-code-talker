# PLAN_CODE.md — program synthesis over tmct's closed DSLs (and, now, JS/HTML/CSS)

*(Drafted 2026-07-07. Status: RESEARCH PLAN, not a build order — see §8, explicit operator sign-off
required before any implementation. Origin: operator's conversational prompt — "I wonder if you
could implement program synthesis, only not with a 1957 tech stack" — resolved to
example-based/syntax-guided synthesis over tmct's own **closed** DSLs, verified against the real
graph instead of an SMT solver (FlashFill-adjacent, not general code generation). Scope then grew
twice in-session: first to the operator's own idea of a Playwright sandbox for the verify/execute
step, then to a three-language target set — "we'll support 3 languages... JS, HTML and CSS" — which
is what §3/§4 below now cover as explicit later tracks. This plan does not duplicate
[[PLAN_INFERENCE_TESTING.md]]'s own program-synthesis finding — §2.3 there records that ROADMAP
Item 11 (Progol/ILP, learning new *inference rules*) is "a separate far spike… this repo has
already looked at that door and left it shut." This plan is a **different** synthesis target — not
learning logic rules, but synthesizing small **declarative router data** (Track 1) or small
**executable snippets/markup** (Tracks 2/3) from labeled examples — and should be read as a sibling
finding, not a re-opening of Item 11's door.)*

**Ground rules, restated because this topic is the one most likely to be built past them.** tmct is
no-LLM, permanently, and every mechanism must be deterministic, explainable, and closed
(`CLAUDE.md`: "LLMs are allowed ONLY in the offline eval harness… never in the product path").
Synthesis here means **search + verification against a bounded grammar**, never a language model
guessing code. A synthesized artifact must be **as auditable as a hand-written one** — a
synthesized `GOAL_RULE` must read exactly like `src/router/goal-reasoner.mjs:76-102`, a synthesized
JS/HTML/CSS fragment must be plain, inspectable source text, never an opaque blob. tmct today only
**reads** a graph — every capability in `src/router/registry.mjs` is `readOnly: true` with an empty
delete-list (`registry.mjs:93`, "the closed-world 'queries mutate nothing'"). Synthesis is the first
capability category that **writes/generates** anything, even a declarative rule object — that is a
genuine first for the product's ethos, not an incremental feature, and is called out again in §7.

---

## 1. Track 1 (primary target) — synthesizing a `GOAL_RULE` or `PHRASING_FRAMES` entry

This is the lowest-risk, most tmct-native target, and — this is the direct answer to the operator's
sandbox idea for this track specifically — **needs no sandbox at all**. A candidate `GOAL_RULE` is
plain frozen data fed through the SAME trusted, already-shipped engine code
(`applicableRules`/`goalReason`, `goal-reasoner.mjs:146-155,219-364`) that every hand-written rule
already runs through. `agentbench/driver-goal.mjs:29-38` already calls `goalReason` **in-process**,
inside the bench's own `Promise.race` timeout guard, no isolation layer of any kind — proof by
existing precedent that grading a candidate rule this way is already how this repo works.

### 1.1 The exact shape being synthesized

`goal-reasoner.mjs:61-74` (the `GOAL_RULES` docblock) plus the two live entries (`:76-127`) pin the
field set precisely:

| Field | Type | Constrains the search to |
|---|---|---|
| `id` | string | free (mechanically generated, e.g. `synth-<slug>`) |
| `invariant` | string | free-text explanation, not searched (post-hoc, from the rule's own composed fields) |
| `focusClass` | enum | the `seon`/`mgx` classes actually used as a capability parameter `kind` in `registry.mjs:50-57` — today `Module`/`Class`/`seon:CodeEntity` (Symbol) |
| `modes` | subset of `{"scoped","global"}` | closed 2-element powerset minus ∅ — 3 possibilities |
| `subGoals` | ordered list of topics | the topics reachable via `backwardChain` (`resolver.mjs:132-137`) — i.e. any `add`-effect `topic` string emitted by a registered capability: `matches, description, signature, impact, members, subclasses, exports, callers, callees, calls, tests, untested, history, cochanges, architecture` (`registry.mjs:107-203`, one per `knows(...)` call) |
| `priorityTopic`/`coverageTopic` | topic string | same closed topic set, used only when `"global"` ∈ `modes` |
| `compose` | `{op, a, b, names, empty}` | `op` ∈ the exported `set-algebra.mjs` operators — `intersect` (`:16-19`), `fallbackIfEmpty` (`:22-24`), `guardIfEmpty` (`:27-30`); `a`/`b` are `{topic, of?: "focus", withFocus?: bool}` |
| `achieves` | string | the meta-goal name a request backward-chains to (`backwardChainGoal`, `:131-133`) |

This is exactly a small, **already-closed grammar** — nothing here is unbounded natural code; every
field ranges over an enumerable set the registry/resolver already declare, which is what makes this
track tractable at all.

### 1.2 The simpler warm-up target — `PHRASING_FRAMES`

`normalize.mjs:189-290` is a strictly smaller instance of the same species: an entry is
`{re: RegExp, to: (m) => string}`, first-match-wins, unmatched text passes through byte-unchanged
(`normalize.mjs:296-302`). The synthesis target is narrower still — not an arbitrary regex, but a
**template instantiation**: given paired examples `("what functions are in Task", "what does Task
contain")`, generalize the varying span (`Task`) into a capture group and generalize the fixed
scaffold (`"what functions are in ___"`) from a small closed set of anchor-phrase templates already
present in the table's own families (members-of-class, where-defined, predicative-qualifier,
co-change, authorship, has-tests, needs-tests — the 6 families at `:190-289`). This is a good
**stage-0 warm-up**: the search space is one order of magnitude smaller (generalize-a-template vs.
select-6-closed-fields), and the verification oracle is nearly the same shape (§1.4), so building it
first exercises the CEGIS loop cheaply before Track 1's fuller grammar.

### 1.3 The search space (enumerative, bounded)

Given labeled examples `{request, tools, expect: {calls, composed}}` (reusing `agentbench/
cases.jsonl`'s exact case shape — `{id, rung, request, tools, expect}`, `agentbench/cases.jsonl:1`),
enumerate candidates bottom-up over the closed grammar in §1.1: for each `focusClass` × `modes`
combination, generate every `subGoals` ordering that is a subset of `{matches, description, …}`
whose topics all `backwardChain` (never invent a topic outside the registry — the same
default-deny discipline `registry.mjs:210-217` already documents for tool names), then every valid
`compose` spec pairing two gathered topics through one of the 3 set-algebra ops. This is a small,
fully enumerable space (roughly: 3 focusClasses × 3 mode-subsets × C(15,≤3) subGoal subsets × 3
compose ops × 2 sides-with-`withFocus` — low thousands of candidates, not combinatorial explosion),
which is exactly why this is a defensible *first* synthesis target and not a general program search.

### 1.4 Verification oracle + CEGIS refinement

For each candidate rule, insert it into a **cloned** `GOAL_RULES` array and call the real
`applicableRules`/`goalReason` (`goal-reasoner.mjs:146-155,219`) against the real fixture graph for
every labeled example — mirroring `agentbench/driver-goal.mjs`'s own in-process call, and mirroring
`agentbench/grade.mjs`'s zero-fabrication discipline (`grade.mjs:152` `gradeCase` value-compares the
driver's `composed` field to the case's **static** `expect` literal, "no composition function
imported — it only compares… so the check is not the code testing itself"; also the exact posture
`PLAN_INFERENCE_TESTING.md:111-117` names for INFBENCH's grader). A candidate **passes** an example
iff the produced `calls`/`composed`/`proof` match `expect` exactly (`proofConnected`,
`grade.mjs:251`). A failing example is a genuine **counter-example**: it prunes every candidate
whose `subGoals`/`compose` combination cannot reproduce it, shrinking the enumeration on the next
pass — textbook CEGIS, and the same "never trust the candidate, only the pinned static label" gate
`ladderGate`/`COMPLETION_FLOOR` already enforce elsewhere (`grade.mjs:32,310-324`).

---

## 2. Track 2 (new, harder) — small JS snippet synthesis from I/O examples

Classic PBE, closer to FlashFill: synthesize a short **pure function** from `(input, output)`
pairs. Unlike Track 1, the candidate here is **literal executable JS source text**, not data fed
through trusted engine code — this is the point where a sandbox stops being optional (§4).

### 2.1 Spec format (concrete, reusing the repo's case-shape convention)

```json
{
  "id": "synth-js-clamp-01",
  "kind": "js-function",
  "signature": "clamp(x, lo, hi)",
  "grammar": "arith-compare",
  "examples": [
    { "in": [5, 0, 10],   "out": 5 },
    { "in": [-5, 0, 10],  "out": 0 },
    { "in": [15, 0, 10],  "out": 10 },
    { "in": [7, 2, 9],    "out": 7 }
  ],
  "heldOut": [ { "in": [3, 5, 9], "out": 5 } ]
}
```

`heldOut` examples are withheld from the search itself and checked only after a candidate passes
every `examples` row — the direct mitigation for §6's overfitting risk (a candidate that memorizes
the 4 given rows but fails the 5th is rejected, never shipped).

### 2.2 Search space — genuinely larger, must stay bounded by a declared sub-grammar

Free-form JS is not enumerable, and leaning on an LLM to guide the search would violate the
no-LLM-in-the-product-path ground rule (§0) even if the harness itself is dev-only — so the search
must stay a fixed, bounded sub-grammar, not open text. `grammar` names one of a small, closed set of
**operator families** (mirroring how `registry.mjs`'s `KINDS`/`PRECOND` are closed vocabularies, not
open text): arithmetic (`+ - * / Math.min Math.max Math.abs`), comparison/ternary (`< > === ? :`),
string (`slice indexOf toUpperCase concat`), array (`map filter reduce length`) — each family fixes
the terminal/operator alphabet. Enumerate closed-form ASTs over parameters + small integer literals
bottom-up by increasing depth (depth 0: parameters/literals; depth *k*: one operator over depth
*<k* subterms), the standard bottom-up enumerative-synthesis algorithm. Depth must be hard-capped
(e.g. 3) — even a 6-operator family at depth 3 is combinatorially real, so this track's exit
criterion (§5) is explicitly scoped to single-expression, loop-free bodies, never general control
flow.

### 2.3 Verification loop (Playwright-sandboxed)

For each candidate source string, `page.evaluate((src, cases) => { const fn = new Function("return "+src)(); return cases.map(c => fn(...c.in)); }, candidateSrc, allInputs)` inside a headless Chromium page (a fresh page/context per candidate or per batch, closed after use) — value-compares every returned output to the pinned `out`. A candidate that throws, times out (Playwright's own per-call timeout), or mismatches even one row is pruned; the surviving, smallest-AST candidate (Occam's-razor tie-break, §6) is the synthesized function, then checked against `heldOut`.

---

## 3. Track 3 (new, hardest) — HTML/CSS fragment synthesis from a structural/visual spec

The genuinely new part: synthesizing **markup + styles**, verified not by exact value comparison
but by **rendering** — there is no way to "run" HTML/CSS without a layout/paint engine computing the
result, which is exactly why this track (not Track 2 alone) makes Playwright's headless browser the
well-motivated choice rather than a nice-to-have (§4).

### 3.1 Spec format (concrete)

```json
{
  "id": "synth-htmlcss-card-badge-01",
  "kind": "html-css-fragment",
  "given": "a card with a title and a status badge",
  "expect": {
    "structure": [
      { "selector": ".card",           "tag": "div"  },
      { "selector": ".card > h3",      "tag": "h3", "textNotEmpty": true },
      { "selector": ".card .badge",    "tag": "span" }
    ],
    "computedStyle": [
      { "selector": ".card",  "prop": "display",         "equals": "flex" },
      { "selector": ".badge", "prop": "backgroundColor", "equals": "rgb(220, 38, 38)" },
      { "selector": ".badge", "prop": "borderRadius",    "notEquals": "0px" }
    ]
  }
}
```

### 3.2 Search space — closed to the tags/properties the spec itself asserts

Free-form HTML+CSS is unbounded, and — same constraint as §2.2 — the search must not lean on an LLM
for guidance, so it has to stay a **closed** enumeration. The tractable move is to enumerate
**only** the tag/attribute/class vocabulary and CSS property/value vocabulary that appear in
`expect.structure`/`computedStyle` across the example set — a closed tag alphabet (`div span h1-h3
p img button ul li`) and a closed property alphabet keyed off the spec's own asserted properties
(`display color background-color padding margin border-radius flex-*`), never a general "any valid
CSS" search. This mirrors Track 1's discipline of enumerating over what the registry/topic set
already declares, not over the full language — and it is honestly a **less bounded** space than
Track 1's or even Track 2's, since HTML/CSS combinatorics (tag nesting × class assignment × property
value choice) grow faster than a single-expression AST does; this is exactly why Track 3 is staged
last (§5), not attempted alongside Track 1.

### 3.3 Verification loop (same Playwright page, DOM + CSS in one context)

`page.setContent(candidateHtml)` + `page.addStyleTag({content: candidateCss})`, then per structure
assertion `page.$$(selector)` (existence, tag name), per style assertion `page.$eval(selector, (el,
p) => getComputedStyle(el)[p])`. `getComputedStyle` is the load-bearing normalization step — it
resolves `red`/`#dc2626`/`rgb(220,38,38)` to one canonical form regardless of how the candidate CSS
spelled it, so exact-string comparison after that call is honest, not fragile.

### 3.4 Honesty about this track's verification surface — deliberately fuzzier than Tracks 1/2

Structure and computed-style checks are exact-match, like Tracks 1/2. **Pixel-level layout/visual
correctness is not**, and this plan explicitly does NOT stage it as an exit criterion: viewport-
dependent widths/heights, sub-pixel rounding, and font-metric variance make exact dimension
assertions flaky rather than deterministic — directly against the repo's own determinism bar
(`PLAN_INFERENCE_TESTING.md:126-128`'s "byte-identical replay… run twice and byte-compare" is the
standard every other bench in this repo holds itself to). Track 3's exit criterion is therefore
scoped to structural presence + a bounded, spec-declared set of computed-style equalities only;
screenshot/visual-regression diffing is named here as an explicit **non-goal**, not a deferred
stretch quietly assumed to arrive later.

---

## 4. The sandbox question — three options, compared per track (not force-fit to one answer)

`package.json` today has **no** sandbox/vm/browser-adjacent dependency: `dependencies` are `ink`,
`react`, `smol-toml`, `wink-eng-lite-web-model`, `wink-nlp`; `devDependencies` is just
`ink-testing-library`. `files` ships `bin/ src/ README.md ROADMAP.md LICENSE corpus/ data/`;
`exports` names only `src/*.mjs` entry points — `agentbench/`, `chatbench/` are **not** in `files`
and are never imported by `bin/tmct.mjs` or any `src/` module (confirmed by grep — no
`playwright`/`vm`/`sandbox` hit anywhere in `src/`, any `*.md`, or `package.json` today). Any
synthesis harness, for any track, must live the same way: a new dev-only sibling directory (e.g.
`synthbench/`, mirroring `agentbench/`/`chatbench/`), its dependencies added to `devDependencies`
only, never touching `dependencies`/`files`/`exports`.

| Option | Isolation | DOM/CSS capable? | Dependency cost | Fits which track |
|---|---|---|---|---|
| (a) direct in-process call (`goalReason`/`applicableRules`) | none needed — the candidate is DATA, not code, run by the SAME trusted engine already shipped | n/a | **zero** — no new dependency at all | **Track 1** (and its `PHRASING_FRAMES` warm-up) — the right answer, and the Playwright question is moot here |
| (b) Node `vm` module | process-shared, weak — known sandbox-escape / prototype-pollution / DoS surface for genuinely untrusted candidate code; a hung synchronous loop is only softly mitigated by `Script` timeouts | **no DOM at all** | zero (built-in) | would cover Track 2 *alone*, if Track 3 didn't exist |
| (c) Playwright headless browser | real OS-process isolation (separate browser process per context, hard-killable) | **yes** — `page.evaluate` is simultaneously a JS execution context, `page.content()`/`page.$eval` a DOM, `getComputedStyle` a CSS engine | heavy — multi-hundred-MB browser binaries, a new devDependency surface, version pinning to keep replay deterministic | **Tracks 2 and 3, uniformly** |

**Verdict, per track, stated plainly rather than force-fit to one answer.** For Track 1, the
operator's sandbox idea does not apply — a candidate `GOAL_RULE` is data run by trusted code, so (a)
is not merely cheaper than (b)/(c), it is the *correct* model (no untrusted code ever executes);
adding Playwright for Track 1 alone would be pure unjustified dependency weight. Once Tracks 2 and 3
are in scope, the comparison changes in Playwright's favor, and decisively so: `vm` cannot render
HTML/CSS at all, so it is no longer a candidate for a unified sandbox once JS+HTML+CSS are co-equal
targets. With three languages on the table, Playwright is the **clearly right tool** — not a
nice-to-have — specifically *because* one headless page is one execution environment for all three:
`page.evaluate()` runs the Track 2 candidate JS, `page.content()`/`page.$eval()` inspects Track 3's
DOM structure, and `page.evaluate(() => getComputedStyle(el))` inspects its CSS, all inside the same
OS-process-isolated sandbox rather than stitching together `vm` for JS and something else entirely
for markup. That also means Track 2 should use Playwright too, even though `vm` would suffice for JS
alone — the honest reason to prefer Playwright there is uniformity of one sandbox technology across
Tracks 2/3, not that `vm` is inadequate for pure arithmetic snippets. The dependency-weight tradeoff
is real and should be named to the operator explicitly (§7), not absorbed silently.

---

## 5. Staging (measure-before-building)

Track 1 breaks into four build stages (0-4, harness → search skeleton → oracle wiring → CEGIS +
exit) before Tracks 2/3 are attempted at all — each a genuinely separable unit of work, not just a
renumbering of §1's content:

| Stage | Track | What ships | Sandbox | Effort | Exit criterion |
|---|---|---|---|---|---|
| 0 | warm-up | `PHRASING_FRAMES` entry synthesis (§1.2) — template-generalization over paired utterance examples | none (in-process, `normalizeQuery`) | S | synthesizes ≥1 of the 6 existing frame families byte-identically from its own hand-written examples (a "can we reproduce a known-good frame" self-check) |
| 1 | Track 1 | labeled-example harness — a `synthbench/rules/cases.jsonl` reusing `agentbench/cases.jsonl`'s exact `{id, tools, request, expect}` shape (§1.4), no search yet | none | S | a hand-authored `GOAL_RULE` (e.g. `coverage-invariant`) round-trips through the case format losslessly |
| 2 | Track 1 | the bounded field-grammar enumerator (§1.3) — produces candidate rule objects, not yet wired to the real engine | none | S-M | enumeration count matches the "low thousands" estimate (§1.3) for the current registry topic set; dry-run sanity check only |
| 3 | Track 1 | verification oracle wiring — each candidate cloned into `GOAL_RULES`, run through the real `goalReason` in-process (§1.4), graded like `agentbench/grade.mjs` | none | M | a synthesized candidate reproduces a hand-authored rule's behavior byte-for-byte on that rule's own labeled examples |
| 4 | Track 1 | full CEGIS refinement loop + held-out check + human-readability review pass | none | M | synthesizes a **novel** rule (not one already hand-written) matching a held-out labeled example set at 0% fabrication (mirrors `ladderGate`'s "0% hallucination at ≥`COMPLETION_FLOOR`" gate, `grade.mjs:32,310-324`), AND the synthesized rule's fields read as a plausible hand-authored entry on manual review |
| 5 | Track 2 | small pure-JS-function synthesis (§2) — bottom-up enumerative search over one closed operator family at a time, verified via Playwright | Playwright, new `synthbench/` devDependency | M-L | synthesizes a function passing all given examples AND its held-out example, for ≥1 grammar family (start with arithmetic/comparison only) |
| 6 | Track 3 | HTML/CSS fragment synthesis (§3) — closed tag/property enumeration keyed to the spec's own assertions, verified by rendering in the same Playwright page | Playwright (shared with stage 5) | L | synthesizes a fragment passing all structure + computed-style assertions for a small hand-authored spec set; explicitly excludes pixel/layout exactness (§3.4) from the exit bar |

Stages 0-4 (Track 1) are deliberately built and measured **before** stages 5-6 (Tracks 2/3) are
attempted — the same measure-before-building discipline `PLAN_INFERENCE_TESTING.md`'s staging table
(§4 there) and `PLAN_ADVANCED_GRAMMAR.md`'s track table (§2 there) both apply: a stage that doesn't
clear its exit bar is parked and written up, not silently carried forward into the next stage's
scope.

**Case/example authoring convention to reuse, not invent fresh.** Track 1 reuses `agentbench/
cases.jsonl`'s exact shape (`{id, tools, request, expect: {calls, composed}}`, `agentbench/
cases.jsonl:1`) — a labeled example for rule synthesis IS an agentbench case, so the two artifacts
can share tooling (`agentbench/grade.mjs`'s `hallucinationsIn`/`proofConnected` apply unmodified).
Tracks 2/3 need a new shape (§2.1/§3.1) since there is no existing "JS I/O example" or "HTML/CSS
spec" convention in the repo to reuse — these are named as genuinely new artifacts, not squeezed
into agentbench's tool-call shape where they don't fit.

---

## 6. Risks and honesty

- **PBE overfitting — the classic "works on N examples, wrong on the N+1th."** Sharpest on Tracks
  2/3 where the search space is far larger than Track 1's closed field grammar. Mitigation: a
  mandatory `heldOut` example per spec (§2.1/§3.1, never used during search), and a minimum-AST-size
  tie-break among passing candidates (Occam's razor — the standard enumerative-PBE bias, prefers
  `Math.min(Math.max(x,lo),hi)` over an equivalent but example-specific piecewise chain).
- **Search-space explosion grows with the grammar, and grows fastest on Track 3.** Track 1's field
  grammar is genuinely small today (§1.3, low thousands of candidates) precisely because
  `registry.mjs`'s topic set is small; every future capability added to the registry linearly grows
  Track 1's space too. Tracks 2/3 are bounded only by *closing* the operator/tag/property alphabet
  per spec — an open-ended alphabet makes both intractable, and Track 3's tag-nesting × class ×
  property-value combinatorics grow faster than Track 2's single-expression AST does, which is the
  concrete reason it is staged last (§5), not merely "harder" in the abstract.
- **No LLM in the search loop, even as a dev-only convenience.** Both Tracks 2/3 are tempted to
  reach for an LLM to propose candidates instead of enumerating a closed grammar — that would
  violate the ground rule even confined to a dev harness (`CLAUDE.md`: LLMs "never in the product
  path"; a synthesis harness that ships synthesized artifacts into `src/` is, transitively, part of
  that path). The closed sub-grammar constraint in §2.2/§3.2 is load-bearing for this reason, not
  just for tractability.
- **Determinism under Playwright.** `getComputedStyle` normalizes color/layout representation
  (§3.3), but browser engine choice still matters — pin to one engine (Chromium) and one Playwright
  version so replay is byte-identical, mirroring `PLAN_INFERENCE_TESTING.md:126-128`'s "same seed →
  byte-identical" bar for INFBENCH; Playwright's multi-browser support is a distraction here, not a
  feature to exercise.
- **A synthesized artifact must stay as auditable as a hand-written one.** The synthesis PROCESS may
  be a nontrivial search; its OUTPUT — a `GOAL_RULE` entry, a JS function body, an HTML/CSS fragment
  — must read exactly like something a person would have written and committed, with the same
  review posture as any other PR. No candidate ships un-reviewed merely because it passed the
  verification oracle; the oracle proves consistency with the given examples, not that a human has
  endorsed the artifact for the codebase's actual conventions.
- **Dependency-weight honesty, restated per §4.** Playwright's browser binaries are a real,
  multi-hundred-MB addition to the *dev* tree the moment Track 2 or 3 starts — bigger than anything
  currently in `devDependencies`. This must be a visible, named tradeoff at sign-off time, not a
  quiet `npm install` line.

---

## 7. This is a new capability category — explicit sign-off required, more so with three languages

Every capability tmct ships today **reads** the graph; `registry.mjs`'s entire STRIPS model is built
on every capability's delete-list being empty (`registry.mjs:13-18,93`). Synthesis is the first
capability that **generates** an artifact — a declarative rule in Track 1, executable JS text in
Track 2, markup+styles in Track 3 — and Tracks 2/3 additionally introduce the first genuinely
untrusted-code-execution surface (however sandboxed) this repo has ever had. Track 1 alone is a
comparatively small ask (no sandbox, no new dependency, output is inert JSON-shaped data run by
existing trusted code). Tracks 2/3 are a materially bigger ask, and expanding the scope to three
language targets makes this **more** true, not less: a new heavy devDependency, a real (if
sandboxed) code-execution loop across two additional languages, a verification surface (§3.4) that
is honestly fuzzier than anything else this repo measures deterministically today, and a search
space (§6) that grows fastest exactly where the verification is fuzziest. **This plan recommends
staging (§5) and recommends the operator explicitly sign off before any implementation begins —
separately per track**, since Track 1's cost/risk profile and Tracks 2/3's are not comparable and
should not be approved as one bundle; the three-language expansion is reason to be *more* deliberate
about that sign-off gate, not less.

### Critical Files for Implementation
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/router/registry.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/router/goal-reasoner.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/router/resolver.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/router/set-algebra.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/src/interpret/normalize.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/agentbench/cases.jsonl
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/agentbench/grade.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/agentbench/driver-goal.mjs
- /Users/antony/projects/polycode-projects/the-mechanical-code-talker/package.json
