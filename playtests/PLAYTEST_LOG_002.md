
tmct playtest 002 — honesty on miss for the is-a yes/no shape
=============================================================

Version under test: 1.10.4 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: the adjacent edge playtest 001 found and deferred here — what "is a X a
Y" says when the honest answer is "I don't know". The yes path works; the
no-fact path claimed a parse failure.

Axes explored this iteration: honesty on miss (absent-answer behaviour).
Axes explored so far: relation coverage of forward yes/no (001), this.
Axes still untouched: negation, quantifiers, inference depth, teach-side
variation, anaphora, multi-word terms, the teach/query boundary.


test: is a dog a cat
====================

Expectations
------------

Given the corpus facts (dog IsA animal; cat IsA animal — no fact links dog to
cat), and that the same shape parses fine when the answer is yes:

```log
tmct> is a dog an animal
yes — dog is a kind of animal (source: corpus:human /r/IsA)
```

When the following prompts were entered:
```log
tmct> is a dog a cat
tmct> is a fizzbuzz an animal
```

Expected: an honest miss — "I can't confirm that", ideally citing what IS
remembered about the subject, plus a teach hint. Never a guessed "no".

Actual: "couldn't parse this as a graph question. Try: 'is a <thing> a
<kind>' (an article before the kind, too)." — misleading twice over: the
question DID parse (the yes path proves the shape works), and the hint
suggests the exact shape the user just typed.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> is a dog a cat
couldn't parse this as a graph question. Try: "is a <thing> a <kind>" (an article before the kind, too). Type /help for all query shapes.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mini`; tmct doesn't index code itself.)

tmct> is a fizzbuzz an animal
couldn't parse this as a graph question. Try: "is a <thing> a <kind>" (an article before the kind, too). Type /help for all query shapes.
(this repo has no code graph — for structure, point me at a `.tmct/graph.json` with `--repo <path>` or run `npm run example:mini`; tmct doesn't index code itself.)
```


Fix
---

`src/chat.mjs`, the deep is-a proof ladder's closing decline (after the
direct-fact lookup, the class↔instance bridge, the taught-chain chases, and
the disjointness "no" have all missed). Instead of an unconditional `return
null` (which fell to the structural parse wall):

- Subject with remembered isa facts: an honest, specific miss — "I can't
  confirm that — nothing I remember says dog is a cat. I do know: dog is a
  kind of animal (source: …). If it's true, teach me: 'dog is a kind of
  cat'." The cited facts come from the subject's OWN term variants only, not
  the bridge-augmented candidate set (which would cite facts about the
  subject's class noun as if they were about the subject).
- Subject mentioned nowhere at all (no fact row on either side, no code
  entity by id or class noun): "I don't know 'fizzbuzz' at all yet" plus the
  same teach hint.
- Anything else (subject known via other predicates, or a code entity):
  unchanged decline, so no downstream lane is shadowed — verified against
  the taught grandparent chain ("is ahab a grandparent of ishmael" still
  answers yes with the full premise chain) and the relation-miss path ("is
  ahab a grandparent of moby" still gets the relation-specific miss).

Both new returns carry `miss: true` through to the turn record — honest
wording is still a MISS for metrics and for recall's miss-gated lanes; the
consumer keeps `via` untouched for them, and the conversational gate ignores
miss-flagged returns. The "never a guessed no" discipline is intact: the only
"no" this shape ever answers remains the disjointness-proved one.

The teach hint's suggested phrasing round-trips: teaching "dog is a kind of
cat" then re-asking answers yes with the taught source.

Regression tests: three new cases in `test/wiring-facts-reverse.test.mjs`
(known-subject honest miss with citation + miss record, unknown-subject
honest miss, teach-hint round trip). Two existing honesty pins caught real
defects in the first draft of this fix (a false "fact" turn record, and the
bridge-noun citation bug) and now pass unchanged.


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> is a dog a cat
I can't confirm that — nothing I remember says dog is a cat. I do know: dog is a kind of animal (source: corpus:human /r/IsA). If it's true, teach me: "dog is a kind of cat".

tmct> is a fizzbuzz an animal
I can't confirm that — I don't know "fizzbuzz" at all yet. If it's true, teach me: "fizzbuzz is a kind of animal".

tmct> is a dog an animal
yes — dog is a kind of animal (source: corpus:human /r/IsA)

tmct> dog is a kind of cat
noted — remembered 1 fact: dog rdfs:subClassOf cat (dog is a type of cat)

tmct> is a dog a cat
yes — you told me: dog is a kind of cat (source: ace:chat:…)
```

Full suite: 2175 pass, 0 fail. CLI smoke: greets and exits 0.
