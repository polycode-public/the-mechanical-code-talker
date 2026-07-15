
tmct playtest 014 — terms colliding with query keywords
=======================================================

Version under test: 1.11.4 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: multi-word terms whose words collide with query keywords —
"what-if analysis" (collides with "what"), "can opener" ("can"),
"test drive" ("test"/"tests") — taught, then asked back.

Axes explored so far: relation coverage of forward yes/no (001), honesty
on miss (002/003), forward yes/no class (004), inference depth (005),
negation (006), anaphora (007), two-word nouns + prepositional verbs
(008), comparatives (009), quantifiers/capability paraphrases (010),
teach-side variation (011), politeness rungs (012), teach/query boundary
(013), keyword-colliding terms (this).

What already passed (worth recording): "can opener" teaches and reads
back cleanly despite the "can" collision; "what-if analysis" grounds,
teaches and reads back through the full advice chain the decline message
suggests; the "test drive" question is recognized as genuinely ambiguous
and says so, listing both readings — the disambiguation discipline is
real.


test: what is a test drive (after teaching it)
==============================================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> every test drive is a thing
tmct> every activity is a thing
tmct> a test drive is an activity
tmct> what is a test drive
```

Expected: the taught facts answer the question — or at minimum appear
alongside the (legitimate) tests-"drive" disambiguation.

Actual: all three teaches stored, but the question's answer was ONLY the
ambiguity dead-end, whose meta reading claims "test drive" isn't a term
in this graph's own vocabulary — the graph-only claim is scoped and
technically true, but it is the last word on a term the user has just
explicitly taught, with the two taught facts sitting unread in memory.
The non-colliding control ("what is a what-if analysis", same taught
state) answers from its facts.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> a test drive is an activity
noted — remembered: test drive is a kind of activity

tmct> what is a test drive
this could mean more than one thing:
1) as meta "test drive": "test drive" isn't a term in this graph's own vocabulary (no matching class or predicate).
2) as tests "drive": no module matching "drive" found in the index. …
(ask one of these directly, or try rephrasing more specifically, to get just that reading)
```


Fix
---

Root cause: an `{ambiguousParse}` envelope carries `parsed:null` and
`miss:false`, so factAnswer's meta reader never arms — neither the
parsed-shape branch (no parse) nor the bare-fallback branch (not a miss).

1. `src/ask.mjs` — the ambiguous render now also carries the candidate
   ASTs (`candidateParses`) alongside the existing display strings, and
   the envelope passes them through. Purely additive.
2. `src/chat.mjs` — factAnswer's meta reader gains a third arm: an
   ambiguous tie whose readings include a META shape takes that reading's
   term, so memory facts for it render under the disambiguation (extend,
   never replace — the tests-"drive" reading stays visible for a repo
   where it might be live).

Regression test: one case in `test/wiring-facts-reverse.test.mjs` (teach
"every test drive is a thing", ask "what is a test drive": the answer
keeps the disambiguation AND surfaces the taught fact).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> what is a test drive
this could mean more than one thing:
1) as meta "test drive": "test drive" isn't a term in this graph's own vocabulary (no matching class or predicate).
2) as tests "drive": no module matching "drive" found in the index. …
(ask one of these directly, or try rephrasing more specifically, to get just that reading)
you told me: test drive is a kind of thing (source: teach:chat:…)
you told me: test drive is a kind of activity (source: teach:chat:…)
```

Full suite: 2286 pass, 0 fail (including the new regression case). CLI
smoke: greets and exits 0.


Closing note (5-round dispatch complete)
========================================

Rounds 010-014 shipped v1.11.1–v1.11.5 (committed locally, push withheld
per the operator's instruction for this dispatch). Axes now covered on
top of 001-009: quantifiers/capability paraphrases, teach-side variation
(genitives, bare plurals), politeness rungs + embedded questions, the
teach/query boundary (bare habituals), keyword-colliding terms.
Candidates for a future dispatch, all deferred openly in their logs:
verb-inflected teaches ("ahab fathered john"), conjunction teaches,
multi-hop kind filtering in "which animals can fly", bare proper-name
general-verb teaches ("john likes mary" stays wrapper-required by
design), and the Phase-1R seeds still unprobed (rule-teach frames, goal
sentences, the instance-name ask sweep).
