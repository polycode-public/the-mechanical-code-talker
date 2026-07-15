
tmct playtest 012 — the paraphrase ladder's politeness rungs
============================================================

Version under test: 1.11.2 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: politeness wrappers around a passing vocabulary query — "could you
tell me what a dog is", "do you know what a dog is", "i'd like to know
what a dog is" — against the passing "what is a dog" / "what's a dog".

Axes explored so far: relation coverage of forward yes/no (001), honesty
on miss (002/003), forward yes/no class (004), inference depth (005),
negation (006), anaphora (007), two-word nouns + prepositional verbs
(008), comparatives (009), quantifiers/capability paraphrases (010),
teach-side variation (011), politeness rungs (this). Axes still
untouched: the teach/query boundary sweep.


test: could you tell me what a dog is
=====================================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> what is a dog          (control — passes)
tmct> could you tell me what a dog is
tmct> tell me what a dog is
tmct> do you know what a dog is
tmct> what a dog is
```

Expected: every wrapper unwraps to the same "what is a dog" answer.

Actual: all four failed to the parse wall. Minimizing showed the modal
and tell-me wrappers already unwrap correctly — what nothing handled was
the EMBEDDED clause they leave behind: "what a dog is" keeps declarative
word order, and no layer folds it back to the direct question. "do you
know …" and "i'd like to know …" additionally had no unwrap frame at
all.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> could you tell me what a dog is
couldn't parse this as a graph question. Try: "what is a <ClassName>" or "what does <term> mean". …

tmct> what a dog is
still couldn't parse that — /help lists every query shape. …

tmct> what is a dog
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)
```


Fix
---

`src/interpret/normalize.mjs` (applyPreambleFrames — one place serves the
structural pipeline and chat's gates alike):

1. **Two new unwrap frames** — "do you know <Q>" and "i'd like/want/need
   to know <Q>", both gated on an interrogative remainder so "do you know
   anything about movies" stays small-talk.
2. **Embedded-question de-inversion** — "what <subject> is/are" folds back
   to "what is/are <subject>", and "what <subject> means" to "what does
   <subject> mean". Closed to a ≤3-word subject so a real relative clause
   ("what the parser in the old branch is …") is never re-inverted.

`src/chat.mjs`, one adjacent gap folded in: on the FIRST turn of a
graph-less session the ask engine throws before its normalize pass runs,
so the wrapped question reached the memory-facts lane still wearing its
wrapper. That lane now retries once with the normalized form — gated to
the no-envelope bootstrap only, after an unrestricted retry was live-
caught regressing the pronoun-subject identity family ("are you secretly
ChatGPT or GPT-4") whose reader guards are written for the raw surface.

Regression tests: three normalize-level cases in `test/interpret.test.mjs`
(wrapper+de-inversion end to end; de-inversion standing alone incl. the
"means" form; the non-interrogative and long-clause guards) and one
chat-level case in `test/wiring-facts-reverse.test.mjs` (the wrapped
question answers on the very first graph-less turn).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> could you tell me what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)

tmct> do you know what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
…

tmct> i'd like to know what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
…

tmct> what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
…

tmct> do you know what dog means
dog is a kind of animal (source: corpus:human /r/IsA)
…
```

Full suite: 2281 pass, 0 fail (including the 4 new regression cases). CLI
smoke: greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass (drift: each unwrapped answer now carries the meta goal/canonical receipt — display-only; every wrapper, including "tell me what a dog is", still answers the full definition)

```txt
tmct> could you tell me what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)

tmct> do you know what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
…

tmct> i'd like to know what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
…

tmct> what a dog is
dog is a kind of animal (source: corpus:human /r/IsA)
…

tmct> do you know what dog means
dog is a kind of animal (source: corpus:human /r/IsA)
…
```
