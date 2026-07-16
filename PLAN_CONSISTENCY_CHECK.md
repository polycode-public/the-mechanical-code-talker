# PLAN_CONSISTENCY_CHECK.md — tmct as a consistency service

Status: DESIGN — approved in outline by the operator, not yet built.

## The idea

An LLM tool loop proposes a response written in tmct's own grammar. tmct returns a verdict
and the canonical form of what it read. The loop may take the verdict or leave it, but it
gets **one shot** — the check is a gate, not a gradient.

    consistencyCheck(text) -> { verdict, canonical, ... }

## Why the grammar is the mechanism, not the check

The check is the smaller half. The load-bearing part is that a claim must be **expressible**
before it can be asserted: if the caller may only say what tmct parses, and everything tmct
parses is checkable against the store, then an unverifiable claim is *unsayable* rather than
caught after the fact. A post-hoc validator filters bad output; a grammar prevents it being
formed. That is the whole reason this is worth building on tmct rather than bolting a fact
API onto anything else.

## The four verdicts

The operator's three, plus one the store's own discipline forces:

| verdict | meaning | shape |
|---|---|---|
| `consistent` | **I hold these facts.** Not "I found nothing against them." | `+ canonical form` |
| `consistent-with-removals` | these contradict what I hold; here is the source that says otherwise | `+ the offending claims + their contradicting facts` |
| `consistent-with-alternatives` | I hold a *different* fact for that slot | `+ the true canonical alternatives` |
| `unknown` | outside my store — I am not a witness either way | `+ the claims I have nothing on` |

**The fourth is not optional.** Without it, `consistent` silently means "not contradicted",
and an empty store rubber-stamps everything — the checker at its most confident exactly when
it knows least. That is the closed-world trap tmct refuses everywhere else ("I can't confirm
that — nothing I remember says…"). With it, the caller learns which parts of its answer are
grounded and which are its own invention, which is more useful than a pass/fail.

## One shot, and why

Allow retries and the loop optimises against the checker: it rewrites until something passes,
which selects for claims that dodge the store rather than claims that are true. Goodhart,
immediately. A gate can be trusted; a gradient gets gamed. The API returns a verdict, not a
score, and does not tell the caller how to make the next attempt pass.

## What already exists (this is mostly assembly)

Verified at `02d7601`:

- **Multi-sentence from file** — `tmct import --file <definition.txt>`, "teach a plain-text
  definition file sentence by sentence" (`bin/tmct.mjs`). Live: `import --file
  data/games/hanoi-3.txt` -> `19 taught, 0 declined, 17 comment line(s) skipped`.
- **Multi-sentence in chat** — `splitSentences` (`src/services/sentences.mjs`), applied per
  turn in `runTurn`; the plan lane pre-splits a multi-sentence turn and emits a per-sentence
  receipt.
- **The whole loop, minus the verdict** — `scripts/extract-facts-from-text.mjs`. Its own
  header describes the design: *"turn a plain text file into facts by reusing the SAME
  deterministic recognizer the interactive chat's teach lane already has (runTurn) — no new
  NLU, no LLM, no guessing"*. It splits with wink's sentence-boundary detection (never a
  naive regex), feeds each sentence through the real `runTurn`, and keeps the ones that
  became facts (`record.via === "assert" && record.miss === false`).
- **The canonical form** — already on every turn record (`canonical`), already rendered to
  the user as the `Canonical:` receipt.
- **Source-indexed facts** — `mgx:statedBy`, one edge per independent source
  (`src/adapters/memory/core.mjs`), and `SOURCE_PRIOR` (`src/domain/memory/trust.mjs`).

So `consistencyCheck` is `extract-facts-from-text.mjs`'s loop with the write removed and the
verdict returned. The recognizer, the splitter and the canonical renderer are all in place.

## The build

1. **`consistencyCheck(text, {repoDir})`** in the domain/service layer: split -> per sentence,
   drive the existing recognizer read-only -> classify each claim into the four verdicts ->
   return `{verdict, canonical, claims: [{text, canonical, verdict, holds?, contradicts?, sources?}]}`.
   The per-claim detail is the useful part; the top-level verdict is the worst of them.
2. **A tool** on the `dispatchTool` switch (`src/tools/`), one module per tool like the rest,
   with its schema in `definitions.mjs`.
3. **A CLI route** — `tmct check <text|--file>`, mirroring `import --file`'s shape.
4. **MCP** — note the MCP server surface was deliberately REMOVED once (`f7c0ab0`,
   "drop the MCP server surface — dispatchTool is the plain internal tool switch"), and
   `tmct serve` already runs an Anthropic Messages API-compatible endpoint. Putting a surface
   back is a decision about surface, not capability; decide which, and say why.

## Feeding it

A checker with an empty store returns `unknown` to everything, so the surface has to let the
caller load the context it wants checked against. That half already exists and is the same
recognizer, so no second NLU appears:

- `tmct import --file <definition.txt>` — plain text, sentence by sentence.
- `scripts/extract-facts-from-text.mjs` — the same loop, keeping only what became a fact.
- the teach lane itself, one sentence at a time.

So the surface is a pair, and the asymmetry between them is the design:

    teach(text)              -> what was stored, and what was declined and why
    consistencyCheck(text)   -> the four verdicts

**Feeding and checking must stay separate calls.** A check that quietly stores what it read
would make every claim self-consistent by the act of checking it — the caller asserts, the
store swallows, the checker agrees. That is a machine for laundering invention into fact.
`consistencyCheck` is strictly read-only; `teach` is the only writer; and the caller has to
choose which it is doing.

The declines matter as much as the stores. `teach` returning "17 of 20 sentences stored, 3
declined: <why>" tells the caller which of its claims tmct cannot even represent — the ones
that will always come back `unknown`, because they are outside the grammar rather than
outside the store. That is a different fact about the world than "I have nothing on this",
and the caller needs both.

Sources travel with the feed. `mgx:statedBy` is one edge per independent source, so the
caller says who is asserting — corpus-A, visitor-B, or the model itself. A claim the model
fed itself and then checks against is not corroboration, and only the source edge can tell
those apart.

## The coverage problem, stated plainly

tmct's grammar models a narrow slice. Most of an LLM response is not expressible as triples.
Two ways out, and they are **not** equal:

- **Prose + a claims manifest** — the LLM writes freely and declares its checkable claims
  alongside. Rejected: nothing binds the prose to the manifest, so it can assert in prose what
  it never declared. The check would pass while the answer lies.
- **tmct renders, the LLM selects** — the assertions and the checked thing are the same
  object. The LLM's job becomes selection and ordering; the claims belong to the thing that
  can count them. This is the one that holds.

Anything sitting between those two needs to explain what stops an unchecked claim reaching
the reader.

## What this can and cannot do

It checks **consistency with what tmct holds**. It is not a truth oracle. A claim outside the
store returns `unknown`, and that is the correct answer — tmct cannot distinguish "false" from
"not mine to say". So it catches the contradiction class (the model asserts a thing the store
holds a sourced negative for) and is silent on novel invention.

That is still most of the damage: the confident wrong answer about something retrievable.

## The property that makes it viable

A checker that guesses is worse than no checker. tmct's refusal is structural, not a policy
bolted on — the repair tier declines 4,793 real English words rather than rewrite them onto a
graph verb; a qualifier check names the scope it cannot find; `can an ostrich fly` reports a
count instead of concluding. You cannot prompt a model into that. It has to be unable to do
otherwise.

Related: `PLAN_DEFEASIBLE_NEGATION.md` — the sourced-negative work the `consistent-with-removals`
verdict depends on. Without a stored negative there is nothing for a claim to contradict except
a directly conflicting positive.
