
tmct playtest 006 — multi-word terms
====================================

Version under test: 1.10.10 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: two-word noun phrases ("guinea pig", "sports car", "ice cream") on the
teach side. The QUERY side already handles them — "what is a schema person"
answers from the corpus's own multi-word concepts — but nothing could TEACH
one.

Axes explored so far: relation coverage of forward yes/no (001), honesty on
miss (002), negation (003), the derived-reader generalization (004),
anaphora (005), multi-word terms (this).
Axes still untouched: quantifiers, inference depth, teach-side variation,
the teach/query boundary.


test: a guinea pig is a kind of rodent
======================================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> a guinea pig is a kind of rodent
tmct> every guinea pig is a thing        (the decline message's own advice)
tmct> a guinea pig can squeak
```

Expected: the teach to land (or an honest decline whose recovery advice
works), and the capability teach to land.

Actual: every phrasing failed. The ACE resolver treats a 2-token NP as
ADJ+NOUN only, so an unknown noun-noun pair ("guinea pig") resolved to
nothing under EVERY teach phrasing — including "every guinea pig is a
thing", the decline message's own suggested recovery, which failed silently
to the empty-graph wall. The bare-declarative gate compounding the problem:
its subject slot only admitted ONE token, so the sentence never even reached
the teach lane.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> a guinea pig is a kind of rodent
the graph at …/.tmct/graph.json is empty — no entities to answer from yet …

tmct> every guinea pig is a thing
the graph at …/.tmct/graph.json is empty — no entities to answer from yet …

tmct> a guinea pig can squeak
couldn't parse this as a graph question. …
```


Fix
---

Two seams:

1. `src/grammar/ace.mjs` — `resolveNP` gains a NOUN+NOUN compound reading:
   two plain nouns in a row resolve as ONE space-joined term ("guinea pig"),
   matching the corpus's own multi-word concepts ("schema person") so taught
   facts and the query side unify. STRICTLY OPT-IN per call site
   (`allowCompound`): capability, quantified membership (every/no), and the
   articled-complement copula request it; the generic relation walk and the
   bare-adjective copula never do. The first, always-on draft of this change
   turned question leads ("does dog have a tail" → subject "does dog") and
   property sentences ("checkout flow is deprecated") into silent ACE
   teaches — three suite pins caught it, hence the opt-in design. A declared
   proper name in either slot ("GitLab pipeline") still keeps the structural
   miss: that's a name in the wrong slot, not a compound.
2. `src/chat.mjs` — `BARE_DECLARATIVE_RE`'s subject slot widened to the same
   optional second word the mint fallbacks already accept, so a bare
   "every guinea pig is a thing" reaches the teach lane at all.

Result: the grounding decline's advice now round-trips exactly as written —
ground the compound ("every guinea pig is a thing"), teach the membership
("every guinea pig is a rodent", minted via the unknown-object fallback),
ask it back ("is a guinea pig a rodent" → yes). Capability teaches directly
("a guinea pig can squeak" → "can a guinea pig squeak" → yes).

Known remainders (stated): "guinea pig is a rodent" WITHOUT the universal
quantifier still lands as a property-flavoured fact via the adjective-mint
fallback (the class mint deliberately requires "every/each/all") — the
supported phrasing is the quantified one, which is what the product's own
messages suggest. Terms of 3+ words ("guinea pig cage") remain out of the
fragment. The both-sides-unknown decline itself is DESIGN ("closed is
deliberate" — never mint two brand-new terms in one sentence), not an edge.

Regression tests: two ACE unit cases in `test/grammar-ace.test.mjs`
(compound resolution for capability + quantified membership; question leads
never parse as teaches), one chat-level round-trip chain in
`test/wiring-facts-reverse.test.mjs`.


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> every guinea pig is a thing
noted — remembered 1 fact: guinea pig rdfs:subClassOf thing (guinea pig is a kind of thing)

tmct> every guinea pig is a rodent
noted — remembered: guinea pig is a kind of rodent

tmct> is a guinea pig a rodent
yes — you told me: guinea pig is a kind of rodent (source: teach:chat:…)

tmct> a guinea pig can squeak
noted — remembered 1 fact: guinea pig mgx:capableOf squeak

tmct> can a guinea pig squeak
yes — you told me: guinea pig can squeak (source: ace:chat:…)
```

Full suite: 2189 pass, 0 fail (plus 3 new regression cases). CLI smoke:
greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass (drift: teach turns now print Canonical fact receipts under their confirmations)

```txt
tmct> every guinea pig is a thing
noted — remembered 1 fact: guinea pig rdfs:subClassOf thing (guinea pig is a kind of thing)

tmct> every guinea pig is a rodent
noted — remembered: guinea pig is a kind of rodent

tmct> is a guinea pig a rodent
yes — you told me: guinea pig is a kind of rodent (source: teach:chat:…)

tmct> a guinea pig can squeak
noted — remembered 1 fact: guinea pig mgx:capableOf squeak

tmct> can a guinea pig squeak
yes — you told me: guinea pig can squeak (source: ace:chat:…)
```
