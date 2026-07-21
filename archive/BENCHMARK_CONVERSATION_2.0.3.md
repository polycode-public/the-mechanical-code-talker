# BENCHMARK_CONVERSATION_2.0.3 — persona sweep, 5 frames, ~200 probes, 25 dead-ends; a "shortest" plan whose first move is illegal

**Mode:** persona-sweep (§3.4, the default for one run). Five background sub-agents in parallel,
each seeded with a genuinely different frame: the textbook logician, the new developer, the
adversarial sceptic, the casual newcomer, the planning user.

**Headline: 25 dead-ends, of which eight state something false without hedging.** The sweep's value
is exactly what §3.4 predicts — every one of the three worst findings came from a frame a
codebase-flavoured round structurally cannot reach:

- The **planner** found that typing the README's own Hanoi example across two lines instead of one
  produces a plan labelled **"3 moves (shortest)"** whose first move is illegal and which never
  reaches the goal. A teach-only line is not sentence-split, so the whole board collapses into one
  fact, and the planner plans faultlessly over a board that does not exist.
- The **logician** found that `some men are fathers` is stored as a universal, after which
  `is john a father` returns **yes, with a proof**. A proof is tmct's strongest honesty claim, and
  here it certifies a non-sequitur.
- The **new developer** found that the most common onboarding question there is, `what would break
  if I change X`, answers with a list of **people**.

Set against that: the sceptic, whose whole brief was to force a role or polarity inversion across
every relation, **could not do it in 55 probes**. Active/passive, forward/reverse, negation and the
converse trap all compiled to the correct canonical shape. tmct's honest-miss machinery is in good
order — the refusals are genuinely excellent, and the planner's own declines name their gap every
time. What fails is upstream of it: **words dropped before the parser ever sees the sentence.** By
the time the honesty machinery engages, the evidence that this was a different question is gone.

**This run measures and documents only.** Per `SKILL_BENCHMARK_CONVERSATION.md` §5 this skill never
edits `src/` or `test/`, and this cycle's operator instruction says the same. Everything below is
routed, not fixed.

## Ladder position reached

**Tier 0 is not clean, so the ladder does not ratchet.**

Tier 0's greeting and identity surface is genuinely good, and the 0.9.12 dead-end this ladder names
(greetings leading with "no code graph loaded" instead of the seeded knowledge) is fixed — verified
in both required states:

```txt
$ tmct                               # seeded, empty dir
seeded 664 starter facts (664 human) — /memory to inspect
tmct> hi
Hi. I'm tmct. Try "what is a dog" for general vocabulary. Point me at a repo with
`--repo <path>` for code-structure questions too…

$ TMCT_NO_SEED=1 tmct
tmct> hi
Hi. I'm tmct. Run `tmct init` to seed a starter vocabulary, or teach me directly, e.g.
"every bug is an issue"…
```

Both lead with what the user can actually do in the state they are in. That is the tier working.

But the same *family* the 0.9.12 note describes is back in a different phrasing, and it is a Tier 0
dead-end because it happens before any graph exists:

```txt
tmct> tell me about a dog
the graph at <repo>/.tmct/graph.json is empty — no entities to answer from yet…
tmct> tell me about dog
"dog" is not a code-map entity — answering from memory/corpus facts.
is a: animal
```

One article's difference. The first reports the system knows nothing; the second proves it knows.
Tiers 1–6 were exercised incidentally by the personas and mostly flowed, but the ladder's own rule
is that a tier only unlocks when the tier below is dead-end-free, and Tier 0 is not.

## Per-persona breakdown

Ranked by §3.4's rule — dead-ends more than one persona hit independently rank first.

### Hit by two personas independently: silent term dropping

Both the sceptic and the casual newcomer arrived at the same underlying fault from opposite
directions: **tokens that don't resolve are discarded, and the answer is about a different question
than the one asked.** The sceptic reached it through fictional modifiers, the newcomer through an
article. Two frames, one root.

### The adversarial sceptic — 55 probes, 1 confident-wrong class, ~20 honest misses, **0 role inversions**

Brief: force a confident inverse on any relation. Failed to, and that is the finding.

Held correct across every probe: active vs passive with a trailing agent, forward vs reverse on
imports/calls/tests/defines, `does X not import Y`, the set complement (verified against ground
truth — 12 modules minus 4 importers = the 8 it named), the converse trap (`is every mortal a man`
→ honest miss, no affirmation), and a false-premise `why` (`why does model.mjs import store.mjs` →
denies the premise rather than explaining a non-existent edge).

Its one find is the crown jewel of the sweep:

```txt
Q: what imports the deprecated legacy model.mjs
A: src/core/store.mjs and src/core/validate.mjs and src/handlers/tasks.mjs and src/handlers/users.mjs.
   Canonical: imports "deprecated legacy model.mjs" — reverse(imports, "deprecated legacy model.mjs")

Q: what imports model.mjs
A: src/core/store.mjs and src/core/validate.mjs and src/handlers/tasks.mjs and src/handlers/users.mjs.
```

Identical answers. "deprecated legacy" is fiction; it is dropped without a word. The `Canonical:`
line is the proof — it prints the garbage term back, having already resolved past it. The guard
exists but only fires on multi-candidate collisions (`what imports mjs` correctly lists five and
asks); unknown-token *residue* isn't covered. `what imports zebra.mjs` misses honestly, so the bug
needs a real name to latch onto. The realistic trigger is not "purple/doom" — it is a user saying
"the old model.mjs" while believing two exist.

### The textbook logician — 18 sessions, ~30 utterances, 6 dead-ends

§0.1 canonical: **all pass.** `john is a man` / `every man is mortal` / `is john mortal` → `yes`
with per-hop provenance. `socrates is a man` stores. The README's headline grandfather chain answers
`yes` with its four-premise proof, exactly as documented.

**Worst finding of the whole sweep — an existential is stored as a universal, then proved:**

```txt
tmct> some men are fathers
noted — remembered: men is a kind of father
tmct> john is a men
noted — remembered: john is a kind of men
tmct> is john a father
yes — john is a kind of men (source: teach:chat:…); men is a kind of father (source: teach:chat:…);
so john is a father
```

The quantifier is stripped without distinguishing universal from existential, so an I-proposition
lands as `rdfs:subClassOf`. The reasoner then does its job perfectly on a false premise and emits a
*proof*. A proof is tmct's strongest honesty claim, and here it certifies a non-sequitur. The
property form (`some men are wise`) and the singular (`some man is a father`) are both refused
correctly — only the plural class form leaks.

**A negative assertion is executed as a retraction:**

```txt
tmct> john is a man
noted — remembered: john is a kind of man
tmct> john is not a man
noted — forgotten: "john is a kind of man" is no longer stored.
tmct> is john a man
I can't confirm that — I don't know "john" at all yet.
```

"John is not a man" is a claim, not "forget what I said". Information is destroyed, and the answer
then denies ever knowing john. This sits oddly beside `0f8fb61 feat(memory): a negative is a source
disagreeing, not a contradiction` — capability negatives do store (`penguin cannot fly` →
`penguin mgxneg:capableOf fly`), but subclass negatives retract. Same word "not", two behaviours.
On an unknown subject (`zeus is not mortal`) the frame becomes a silent no-op reported as a question
about an empty graph.

**Quantifiers parse on the teach side but not the ask side** — `every man is mortal` stores, then
`is every man mortal` → "I don't know anything about 'every man' yet", while `is a man mortal` → yes.
Same for `are all men mortal`, `is any man mortal`. The teach frames strip the quantifier; the ask
frames glue it onto the subject as a bogus entity. `are men mortal` fails the same way on the plural
(and its suggestion text is itself ungrammatical: "remember that men is mortal").

Honest misses worth naming, not bugs: `no man is a stone` stores cleanly as `man owl:disjointWith
stone`, but `is john a stone` answers "I can't confirm that" rather than "no" — disjointness is
stored and not consulted. A logician expects a firm no; the miss is honest, so it routes as a
capability gap rather than a defect.

### The new developer — 48 probes, 5 dead-ends

§0.1 canonical: 3 of 4 pass. The Store overview reproduces the README byte-for-byte; `/callers
checkout` misses honestly; **both `plan` invocations reproduce the README exactly**, including
`composed answer (1): src/lib/http.mjs`. One fails, and it is a README headline:

```txt
tmct> what talks to the payment module?          # README's own transcript, line ~108
couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls <name>".
```

It fails at every arity — with a real module path too, not just the fictional payment module. `what
uses store.mjs` works and returns the right answer, so the capability exists and only the phrasing
is unrouted. §0.1 exists precisely because a documented example that fails is the highest-impact
dead-end there is: it is what every stranger tries first. One lexicon entry (`talks to` → `uses`)
is the whole fix.

**The most common onboarding question answers with people:**

```txt
tmct> what would break if I change src/core/store.mjs
read as "what would change src/core/store.mjs" — a1b2c3d4e5f6 (Grace Hopper) and
c3d4e5f6a1b2 (Alan Kay) and 1b2c3d4e5f60 (Barbara Liskov).
Canonical: touches "src/core/store.mjs" — reverse(touches, "src/core/store.mjs")
```

"break if I" is stripped, the residue matches the `touches` history pattern, and blast-radius
becomes git blame. It *announces* the misreading and answers confidently anyway. The impact closure
it should return is already computed by `/impact` and `tmct_impact`. The malformed rewrite in the
sibling case (`what breaks if I change X` → `"what change src/lib/http.mjs"`) shows this is naive
token deletion, not a re-parse.

**Two surfaces disagree about the same question:**

```txt
tmct> /untested
7 source module(s) with no covering test module:
  src/core/validate.mjs, src/handlers/base.mjs, src/handlers/users.mjs, src/lib/http.mjs,
  src/lib/logger.mjs, src/server/app.mjs, src/server/router.mjs
tmct> show me the untested modules
…the same 7, plus test/tasks.test.mjs and test/store.test.mjs      # 9
```

The dedicated tool applies a source-module filter; the natural-language compositional route does
not, so the test files count themselves as untested. The README's own plan example uses the surface
that is right.

Also: a bare module path dead-ends where a bare symbol orients (`Store` → "Store is a class in this
codebase, found in src/core/store.mjs — try …"; `src/core/store.mjs` → "couldn't parse this as a
graph question"). Pasting a file path is the most natural thing a new developer does.

Direction held up well here too: `what imports store.mjs`, `what does store.mjs import`, and the
trailing-agent passive `what is imported by src/core/store.mjs` all resolve correctly.

### The casual newcomer — 48 probes across 9 sessions, 7 dead-ends

§0.1 canonical: **pass** — the syllogism and `what is a dog` both answer correctly.

The `tell me about a dog` dead-end is quoted under Ladder position above; it is this persona's worst
find and a Tier 0 failure.

**Anaphora is better than its reputation, and fails on a trigger rather than a depth.** Pronoun
binding survives a topic switch and correctly *rebinds*:

```txt
tmct> what is a dog … tmct> what is a cat … tmct> can it meow
yes — cat can meow (source: corpus:human /r/CapableOf)        # rebound dog→cat, correct
```

What kills it is any unparsed turn in between — a miss appears to clear the referent rather than
leave it alone:

```txt
tmct> what is a dog
dog is a kind of animal …
tmct> go back to dogs
couldn't parse this as a graph question…
tmct> can it bark
not sure what "it" refers to yet — name the subject directly, e.g. "what is a <name>".
```

A casual user's misses come in clusters, so one stray turn strands every pronoun after it. This is
the report's cheapest high-value fix: preserving the prior binding across a miss would make the
anaphora that already works survive contact with a real conversation.

Also found: miss hints in a vocabulary session are hard-wired to the code-graph frame (`what about
cats` → "Try: which modules import <name>"), and `what are dogs` returns roughly six lines of
compositional-query syntax to someone who typed three words. `tell me more` expands correctly but
its synonyms (`what else`, `why`) fall through to the identity blurb, which reads as the bot
forgetting the conversation it is in the middle of.

Working well: typo tolerance (`wat is a dog` → correct), unknown terms (`whats a dogg` → honest miss
with a teach suggestion), small talk, `thanks`, `bye`, and `are you an ai` — all clean.

### The planning user — 32 probes, 6 dead-ends

§0.1 canonical: **all pass.** README's Hanoi block reproduces byte-for-byte — 7 moves, and all seven
hand-verified legal, goal reached, 2³−1 optimal. Both `plan` invocations match the README exactly.
The shipped import loads (`19 taught, 0 declined`).

**The worst finding in this report: a plan that claims "shortest", opens with an illegal move, and
never reaches the goal.** The trigger is the README's own example typed across two lines instead of
one:

```txt
tmct> disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a. the goal is that
      every disk rests on peg-c. solve it.
• noted — remembered: disk-1 rests on disk-2
• noted — remembered: disk-2 rests on disk-3
• noted — remembered: disk-3 rests on peg-a
plan found — 7 moves (shortest):        # correct

tmct> disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a.
noted — remembered: disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a
tmct> the goal is that every disk rests on peg-c.
tmct> solve it
plan found — 3 moves (shortest):
  1. move disk-3 onto peg-c        # ILLEGAL — disk-2 rests on disk-3
  2. move disk-2 onto disk-3
  3. move disk-1 onto disk-2       # goal never reached
```

Same sentences, same meaning, one newline apart. `/memory` shows why: the teach-only line was never
sentence-split, so all three sentences became **one fact whose object is the rest of the line** —
`disk-1 mgx:rest-on "disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a"`. The canonical form
only splits because it also contains a goal sentence. The planner then sees disk-2 and disk-3 as
clear and unplaced, and plans a flawless route across a board that does not exist.

**The bullets are the tell**: the working form prints three `•` bullets, the broken one prints a
single un-bulleted blob. The evidence is on screen and means nothing to a reader who doesn't already
know to look.

This is the most serious class a planner can produce — not a refusal, not a miss, but a confident
"shortest" plan that is illegal on move one. Everything the planner does right is downstream of a
board it was handed correctly.

**Stale read-back after `next`** — the same turn contradicts itself:

```txt
tmct> next
moved — move disk-1 onto peg-c (step 1 of 7). board@step1: disk-1 rests on peg-c; …
tmct> what rests on disk-2
you told me: disk-1 rests on disk-2 (source: teach:chat:…)
```

README line 352 claims `next` "writes each board state into memory as facts". `what moves are legal
now` *does* see the new board, so the planner state advanced — only the fact read-back path serves
the stale original.

**The shipped 4-disk recipe doesn't work.** `hanoi-3.txt` instructs: *"first teach: 'disk-4 is a
disk. disk-3 is smaller than disk-4.' … 15 moves (2^4 - 1)."* Followed exactly: `no plan found within
300 moves`, because `smaller than` isn't transitive and disk-1/disk-2 vs disk-4 are never
established. Teaching all three pairs explicitly gives the correct 15. An honest decline, but the
shipped file promises 15.

Parse failures: `get all the disks onto peg-c` and `solve the towers of hanoi` are swallowed as
facts, then `no goal set yet` (`i want every disk on peg-c` works, so the goal frame is narrower
than natural phrasing); `what is the next move` / `how many moves` / `why that move` fall through to
code-graph replies despite the plan output inviting follow-ups; and `is disk-1 clear?` — a phrasing
`hanoi-3.txt` advertises — answers "I don't have a fact saying disk-1 is clear" even at step 0 when
it is clear.

**Honest declines — correct, and worth naming.** Every gap was named, none guessed: no state, no
goal, no rules, an impossible goal, an unknown peg, and already-solved (`the goal already holds —
nothing to do`) all decline with a reason. The `plan` verb refuses `what is the weather in paris`
and `fix the bug`, and its best refusal is genuinely good: `ambiguous meta-goal: 2 declared
goal-rules apply … meta-goal arbitration is undeclared, refuse rather than guess`.

Also correct: river crossing solves in exactly 7, `what moves are legal now` prunes the opening to 1
legal move, goal on peg-b gives the correct 7-move mirror, and the partial goal `disk-3 rests on
peg-c` gives a hand-verified optimal 4.

## Routed backlog

Every dead-end, one line each. All routed to `NEXT.md` unless marked otherwise.

| # | Verbatim input | Diagnosis | Route |
|---|---|---|---|
| 0 | `disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a.` on its own line, then the goal, then `solve it` → **"3 moves (shortest)"**, move 1 illegal, goal never reached | a teach-only line is not sentence-split; all three sentences become one fact whose object is the rest of the line, and the planner plans over a phantom board. The same line WITH a goal sentence splits correctly (3 `•` bullets vs 1 blob) | NEXT |
| 0b | `next` then `what rests on disk-2` → "disk-1 rests on disk-2", contradicting the same turn's `board@step1` | `next` advances planner state (legal-moves sees it) but the fact read-back path serves the pre-plan board; README:352 claims `next` writes board states to memory | NEXT |
| 1 | `some men are fathers` → `is john a father` → **yes, with proof** | teach frame strips the quantifier without distinguishing ∃ from ∀; the I-proposition lands as `rdfs:subClassOf` and the reasoner proves a falsehood | NEXT |
| 2 | `what would break if I change src/core/store.mjs` → **three people** | "break if I" stripped; residue matches the `touches` pattern; blast-radius becomes git blame | NEXT |
| 3 | `what imports the deprecated legacy model.mjs` → answers about `model.mjs` | unresolved token residue dropped silently; the ambiguity guard fires only on multi-candidate collisions | NEXT |
| 4 | `tell me about a dog` → "the graph is empty" | the article routes to code-graph lookup; corpus never consulted. Tier 0 | NEXT |
| 5 | `show me the untested modules` → 9, `/untested` → 7 | the NL compositional route lacks the source-module filter the tool applies | NEXT |
| 6 | `john is not a man` → `noted — forgotten` | the negative frame maps to retract; subclass negatives destroy information where capability negatives store | NEXT |
| 7 | `what talks to the payment module?` (README headline) | `talks to` absent from the verb lexicon; `uses` does the job | NEXT |
| 8 | `is every man mortal` → "I don't know anything about 'every man'" | ask frames don't strip the quantifier the teach frames strip | NEXT |
| 9 | `are men mortal` → "I don't know anything about 'men'" | ask path skips the lemmatizer the teach path uses; suggestion text is ungrammatical | NEXT |
| 10 | `what is a dog` → `go back to dogs` → `can it bark` → "not sure what 'it' refers to" | an unparsed turn clears the anaphora referent instead of leaving it | NEXT |
| 11 | `src/core/store.mjs` (bare path) → couldn't parse | bare-entity orientation is wired for Class/Function, not Module | NEXT |
| 12 | `zeus is not mortal` (unknown subject) → reports on an empty graph | negative frame no-ops with nothing to retract | NEXT |
| 13 | `what about cats` → "Try: which modules import <name>" | miss hint hard-wired to the code-graph frame in a vocabulary session | NEXT |
| 14 | `what are dogs` → ~6 lines of compositional syntax | miss hint doesn't scale to the question's register | NEXT |
| 15 | `what else` / `why` → the identity blurb | `tell me more` has an expansion rule; its synonyms don't | NEXT |
| 16 | `do all men die` → code-graph parse error | no `do/does <subject> <verb>` frame; falls to a hint about modules | NEXT |
| 17 | `do all modules import model.mjs` → duplicated ambiguous parse, both readings fail | the universal quantifier over a module set isn't wired to the complement machinery `which modules do not import X` already has | NEXT |
| 18 | `i was wondering what a dog is` → couldn't parse | politeness stripper handles the modal form, not the `i was wondering` frame | NEXT |
| 19 | `no man is a stone` → `is john a stone` → "I can't confirm that" | disjointness stores as `owl:disjointWith` and is never consulted when answering. **Named capability gap, honest miss** — routed as a gap, not a defect | NEXT (capability) |
| 20 | `hanoi-3.txt`'s own 4-disk recipe → `no plan found within 300 moves` | `smaller than` isn't transitive, so the shipped instruction's two `smaller` facts never establish disk-1/disk-2 vs disk-4. Honest decline; the shipped file promises 15 moves | NEXT (doc/product mismatch) |
| 21 | `get all the disks onto peg-c` / `solve the towers of hanoi` → swallowed as facts, then `no goal set yet` | the goal frame is narrower than natural phrasing (`i want every disk on peg-c` works) | NEXT |
| 22 | `what is the next move` / `how many moves` / `why that move` → code-graph replies | plan follow-ups aren't routed, though the plan output itself invites them | NEXT |
| 23 | `is disk-1 clear?` at step 0 → "I don't have a fact saying disk-1 is clear" | clearness is derivable from the board and isn't derived; `hanoi-3.txt` advertises this exact phrasing | NEXT |

## Next

**The dead-end class that most needs attention: input discarded before the parser runs.** Items 0,
1, 2, 3 and 4 are one family wearing five costumes — a sentence boundary, a quantifier, a clause, a
modifier, an article. Each is silently dropped; each produces a fluent, confident answer to a
question nobody asked. This family is more dangerous than anything the sceptic hunted for, because
tmct's honesty machinery never gets the chance to engage: by the time the parser sees the sentence,
the evidence that it was a different sentence is gone. The `Canonical:` line already exposes several
of them, and the `•` bullets expose item 0 — the tells exist and mean nothing to a reader who
doesn't know to look for them.

**Item 0 should go first**, ahead of everything: it is the only finding where tmct produces a
*proof-shaped artifact* — a numbered, "shortest"-labelled plan — that is illegal on its first move.
Item 1 is the same shape one level down: a real proof certifying a false premise. Those two together
say the honesty guarantees hold only as far as the input pipeline is faithful, which is the one
place nothing checks.

**Recommended next run:** re-sweep with the same five frames once items 0–4 land, and add a sixth —
the returning user with a stale mental model ("the old X", "didn't you say Y") — which is where item
3's realistic trigger lives and which no frame here covered.

The ladder stays at **Tier 0 until item 4 is fixed**. Tier 0's greeting surface is clean and Tiers
1–6 mostly flowed under the sweep, so the ratchet should move quickly once the vocabulary-vs-graph
routing is settled.
