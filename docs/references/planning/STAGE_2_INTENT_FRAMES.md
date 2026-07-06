# Stage 2 — imperative NL → intent frames (the router's front-end)

**Consumer:** `PLAN_CAPABILITY_ROUTER.md` (Stage 2, "Imperative intent frames + parameter
slot-filling" — the A2–B1 *binding* row). · **Prior art in tmct:** `src/grammar/ace.mjs` (the ACE-OWL
sub-fragment parser), `src/grammar/lexicon.mjs` (the declared lexicon), `src/interpret/pipeline.mjs`
(the multi-strategy interpretation pipeline). · **References:** semantic parsing to executable forms;
Attempto Controlled English (tmct's lineage); [`STRIPS_PDDL.md`](STRIPS_PDDL.md) (the operator model
the frame binds into). · **Status:** design note — no product code proposed to land yet.

## The problem, stated honestly

Stage 2 is the router's front end: turn an **imperative** ("rename the http module and fix its
importers", "delete the temp files, then run the tests") into a **structured intent frame** — a
declared action plus its bound arguments — that Stage 1's resolver can match to a capability
(STRIPS/PDDL operator) and Stage 3's planner can compose. The RFC is blunt about where this sits:
**request → intent for *arbitrary* imperative NL is Unsolved** ("the front-end problem — exactly what
LLMs are for"), while request → intent for a **controlled fragment is Partial (measured)**. This note
takes the RFC's stated lean — *controlled + guided* input — and works out the smallest useful build,
tied to tmct's existing seams.

The core move is the same one that makes the whole project honest: **do not try to parse everything.**
Declare a fragment, parse it deterministically, and *refuse-and-guide* on everything outside it. A
missed parse is a **feature**, not a failure — exactly the posture `src/grammar/ace.mjs` already
takes for declarative sentences (its header: "fitting the grammar is a strong signal, missing it is a
FEATURE").

## What tmct already has (the reusable prior art)

The declarative half of this problem is **built and measured**. The pieces Stage 2 reuses:

1. **A declared, load-bearing lexicon** (`src/grammar/lexicon.mjs`). Every noun, verb (with its
   preposition), adjective, and proper name is *declared* in `lexicon-core.json`; the grammar never
   guesses a word's category. `classify(word)` returns the part-of-speech + type or `null` for an
   undeclared word, and `predicateOf(verb)` maps a verb to its canonical predicate
   (`depend on` → `tmct:dependsOn`). This is the same discipline an imperative grammar needs: a
   declared **verb-lexicon of capabilities** is the analogue of the noun/verb lexicon.

2. **A pattern grammar that emits structured triples** (`src/grammar/ace.mjs`). `parseAce(sentence)`
   matches one of 8 controlled sentence patterns and returns `{ pattern, triples, residue }` — or
   `null` on a total miss. Two mechanisms transfer directly to Stage 2:
   - **`resolveNP()`** already does 1–2-word noun-phrase resolution (proper name | code-ref |
     NOUN | ADJ NOUN), returning `{ term, individual, extras, unknown }`. Argument slots in an intent
     frame are noun phrases; this is the slot-*value* resolver, ready-made.
   - **The miss-as-value contract** (`missOrNull` / `residue`): when a sentence *fits a pattern
     structurally* but uses **undeclared words**, the parser returns the pattern with **empty triples
     and the unknown tokens as `residue`** — the hook the pipeline turns into an "if you mean X …"
     surround. That is precisely the guidance behaviour a controlled-command front end wants: "I see
     the shape *delete <thing>*, but I don't know the word *<thing>* — did you mean one of these?"

3. **A multi-strategy pipeline with a clean registration seam** (`src/interpret/pipeline.mjs`). The
   pipeline normalises the input once, runs every registered strategy, and merges: same-class results
   agree/disagree, distinct-class results become the "if you mean X then …" surround. **A new
   strategy joins by pushing an entry into `STRATEGIES`, not by editing the pipeline.** The pipeline
   header already anticipates the ACE grammar joining this way. **Honest status:** the ACE *engine*
   (`src/grammar/ace.mjs`) exists, but an `interpret/strategies/ace.mjs` adapter is **not yet
   registered** in `STRATEGIES` (today: `grammar`, `keyword-spot`, `noise-strip`). An imperative
   strategy would register the same way — the seam is real and empty.

4. **A normalization pre-pass** (`normalizeInput` → `normalizeQuery` + negation/phrasing frames). Any
   imperative strategy inherits spelling repair, contraction expansion, and rhetorical-frame
   rewriting for free, with `normalizationChanged` on the record so a repair is never silent.

## The controlled-command grammar approach

The declarative fragment is copula/relation-shaped ("every X is a Y", "X imports Y"). Imperatives are
a **different, smaller shape**: `VERB [DET] OBJECT-NP [PREP OBJECT-NP]* [, then VERB …]`. The
recommended design mirrors `ace.mjs` exactly, one layer over:

- **A declared command-verb lexicon.** Each capability contributes an imperative verb (or a few
  synonyms) with its argument frame: `delete` → `{ capability: delete_file, args: [{ role: path,
  type: file }] }`; `rename` → `{ capability: rename_module, args: [{ role: from, type: module },
  { role: to, type: name }] }`. This is a lexicon block of the same JSON shape `lexicon.mjs` already
  ingests, so the verb-frame table *is* the capability registry's surface syntax — Stage 0's operator
  declarations, read from the imperative side.

- **Slot-filling via `resolveNP` + role labelling.** Tokenise (reuse `ace.mjs`'s `tokenize`), find
  the declared command verb, then bind each argument slot by running `resolveNP` over the span in the
  verb's declared position/preposition — precisely how `parseRelation` already peels an object NP
  after a verb's `prep`. The output is an **intent frame**: `{ action: <capability>, slots: { role →
  resolved-term } }`, plus `residue` for undeclared tokens. This is a serialisation of a bound
  operator, ready for Stage 1.

- **Bounded composition (the B1 recipe).** "delete the temp files, **then** run the tests" is a
  conjunction of two frames joined by a declared connective (`then` / `and`). Split on the connective,
  parse each clause independently, and emit an ordered list of frames — the HTN-method / macro shape
  ([`NONLIN.md`](NONLIN.md)). Keep this *shallow* on purpose: one level of `then`/`and`, no nested
  conditionals. Conditionals and retries are Stage 3/B2 (Steel & Ho), not Stage 2.

## The boundary — in-scope vs out-of-scope

The whole value is in drawing this line sharply and *refusing across it*:

| In scope (controlled fragment, deterministic)                              | Out of scope (escalate / refuse-and-guide)                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Declared command verb + declared/​code-ref argument NPs                     | Undeclared verb ("refactor", "clean up", "make it nicer")           |
| Slot values resolvable by `resolveNP` (proper name, code-ref, NOUN, ADJ N) | Rich/embedded arguments (relative clauses, quantified scopes)        |
| One-level `then`/`and` sequencing of clauses                               | Nested conditionals, loops, "keep doing X until Y"                  |
| Anaphora-free binding, or a resolved prior `tool_result` threaded in       | Unresolved pronoun / focus ("fix **it**") — see debt below           |
| A structurally-fit clause with unknown words → **`residue` guidance**       | A clause with no recognisable command shape at all → hard `null`     |

The two exit doors are already tmct's:
- **`residue` (structural fit, unknown word)** → the "if you mean X …" surround: the request is
  *nearly* in the fragment; guide the user onto it. This is the *tolerant-guided* input contract the
  RFC leans toward (open question 1).
- **`null` (no fit at all)** → the escalation seam: hand to the LLM fast-path/guardrail, or refuse.
  Never guess a capability or an argument — a hallucinated call is the one automatic-fail the router
  must never commit (RFC Phase C).

## What is genuinely unsolved (say it plainly)

- **Arbitrary imperative NL.** Free-form "sort out the flaky test situation" has no declared verb and
  no bindable slots. This is the make-or-break the RFC names; Stage 2 does **not** solve it — it
  constrains the input and guides toward the fragment. That is the whole bet.
- **Parameter-binding coverage for rich arguments** (RFC "What stays open" #3). `resolveNP` handles
  1–2-word NPs; a slot value that is itself a relative clause ("the module that nobody imports") or a
  quantified set ("every test older than a week") exceeds it. These are declaratively expressible in
  the ACE fragment but not yet as *imperative argument slots*; treat them as out-of-scope residue
  until Stage 1's resolver can be invoked to *compute* a slot value, not just parse it.
- **Cross-turn anaphora / focus binding.** Threading a prior `tool_result` into the next frame's slot
  is the A2→B1 gate, and it inherits `CHATBENCH_0.7.1`'s measured debt: **pronoun/focus mis-bind
  (`B1 pron 1.24`, the "it → Commit" error)** and **discourse-count anaphora** (the 2 tier-1 misses).
  Stage 2 must **not** ship trustworthy cross-turn slot-filling until those chat-surface levers land
  — resolving "fix **it**" to the wrong antecedent binds the *wrong argument* to a real, executable
  call. Until then, an unresolved pronoun is out-of-scope residue, not a guessed binding.

## Recommendation — the smallest useful Stage 2

Build an **imperative-command strategy** that reuses the declarative machinery wholesale:

1. **Declare a command-verb lexicon block** (same JSON shape as `lexicon-core.json`), one verb-frame
   per Stage-0 capability, with argument roles + types. This doubles as the human-facing surface of
   the capability registry.
2. **Write `parseCommand(sentence, lexicon)`** modelled line-for-line on `parseAce`: `tokenize` →
   find declared command verb → `resolveNP` each slot by declared position/prep → emit
   `{ action, slots, residue }` or `null`. Reuse `resolveNP`, `tokenize`, `missOrNull`, and the
   `residue` contract unchanged.
3. **Support one-level `then`/`and` sequencing** into an ordered frame list (the B1 recipe); stop
   there — no conditionals.
4. **Register it as `interpret/strategies/command.mjs`** in `STRATEGIES` (its own class), so a miss
   falls through to the tolerant strategies and a structural-fit-with-unknown-word produces the
   existing "if you mean X …" surround — no pipeline surgery.
5. **Gate cross-turn slot-filling** on the `CHATBENCH_0.7.1` pronoun/focus + discourse-count fixes.
   Single-turn, anaphora-free binding is shippable now; threaded binding waits for the floor-raise.

This is deliberately the *A2 slice*: single declared imperatives with bound literal/code-ref/​
declared-noun arguments, plus shallow sequencing, refusing everything else. It reuses ~all of the ACE
grammar's mechanics, adds no NLP dependency, stays deterministic and offline, and preserves the
router's non-negotiable: **never emit a call it cannot bind and prove.**
