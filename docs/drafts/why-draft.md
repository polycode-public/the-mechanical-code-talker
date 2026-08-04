# Why a graph instead of a model

Draft for operator review. Not published anywhere. Every claim below names a live demo page or a
committed report you can check it against.

tmct answers a question by walking a stored graph of facts, not by generating text. Each fact
carries a source and a trust score. An answer is either built from facts it can point to, or it
says so and stops. See [`README.md`](../../README.md) for the full picture; this page argues the
trade-off in one place.

## Where a graph wins

**It gives the same answer twice.** Run the same question against the same graph and you get the
same words back, byte for byte. [`reports/BENCHMARK_INFERENCE_5.0.5.md`](../../reports/BENCHMARK_INFERENCE_5.0.5.md)
replayed 399 cases twice and diffed the two runs: identical. A model sampling tokens cannot make
that promise; a lookup over a fixed graph can, because there is nothing to sample.

**It shows where each fact came from.** Every stored fact links back to who said it and when: you
taught it, a corpus shipped it, a rule derived it. [`public/ledger-about.html`](../../public/ledger-about.html)
walks this: click any term in an answer and you see the sentence, its source, and how much tmct
trusts it. A model's output has no such trail. You can ask it to cite a source, but nothing forces
the citation to match what it actually used.

**It runs for nothing.** tmct makes no model call, so there is no per-token bill. `tmct serve`
opens an HTTP endpoint a tool-loop client can call the same way it would call a model, at zero
marginal cost per turn ([`README.md`](../../README.md)). The live chat at
[`public/chat-about.html`](../../public/chat-about.html) runs the same query engine in your
browser, no server round trip at all.

**It works with no network.** The demo site ships its own copy of the language model it depends
on and precaches its pages, so a second visit answers offline
([`reports/PAGE_WEIGHTS.md`](../../reports/PAGE_WEIGHTS.md) documents what gets cached and at what
size). A hosted language model needs a live connection to answer anything.

**It refuses instead of inventing.** When nothing in the graph grounds an answer, tmct says so
instead of guessing. Across every benchmark axis run this cycle, no harness or playtest found a
single invented fact ([`STATUS.md`](../../STATUS.md), "zero fabrication on every axis").
[`public/ingest-about.html`](../../public/ingest-about.html) shows the same behaviour on text you
paste in: a sentence the recognizer cannot ground gets skipped and counted, never rewritten into
something that sounds plausible.

## Where a graph does not win

**It only knows what's in the graph.** Ask about a domain tmct was never seeded or taught, and it
has nothing to walk. `PLAN_NLU_BENCHMARKS.md`'s own finding, carried in
[`STATUS.md`](../../STATUS.md)'s design-docs table, is that tmct's current capability does not yet
cover the domains two third-party intent benchmarks test (banking, travel, weather). A language
model trained on a broad web corpus answers a much wider first-pass slice of questions than a
graph seeded with a fixed vocabulary.

**Its phrasing is a curated set, not open generation.** tmct's sentence pool is deterministic and
hand-built, so the same fact reads a little differently across a handful of connector words but
never in the open-ended way a model paraphrases. The CEFR sweep found 60 hard fails against a
graded pool of 1,075 cases, and higher-difficulty C1/C2 prompts carry 36 of those 60
([`STATUS.md`](../../STATUS.md), sourced from `reports/BENCHMARK_CEFR_ENGLISH_3.0.3.md`). Fluent,
varied paraphrase is a strength of a language model that a template pool does not match.

**Ranking many links by relevance is still weak.** The research lane can follow a link and ground
what it reads, but it does not yet order candidate links by how relevant they are: measured
ordering quality is 67%, against an 80% floor
([`reports/BENCHMARK_RESEARCH_3.0.3.md`](../../reports/BENCHMARK_RESEARCH_3.0.3.md)). Try it at
[`public/research-about.html`](../../public/research-about.html). A model reading a page can weigh
which links matter more freely than a graph walk that has not learned to rank them yet.

**Multi-step narrative order does not thread cleanly yet.** Feeding tmct's ingest a passage built
from ordinal or temporal structure ("First… then…") recovers 38% of the sequence, against a 50%
floor ([`reports/BENCHMARK_INGEST_3.0.3.md`](../../reports/BENCHMARK_INGEST_3.0.3.md)). Paste your
own text at [`public/ingest-about.html`](../../public/ingest-about.html) and watch which sentences
it grounds. A model reading the same passage tracks that order as a matter of course.

**Anything outside the graph's own model of time is out of reach today.** tmct records when a fact
was created and last touched, but it is not bitemporal: it cannot answer what it believed at some
past moment, only what it believes now (`README.md`'s storage bibliography section, on
`mgx:updatedAt`). A model has no such record either, but it will still answer the question, right
or wrong. tmct declines it instead.

## The shape of the trade-off

A graph is worth trusting when you need the same answer twice, need to know where an answer came
from, need it to run offline or for nothing, and would rather hear "I don't have that" than a
guess dressed as an answer. A language model is worth reaching for when the question ranges wide
of any fixed graph, needs varied natural phrasing, or needs judgment over material the graph
hasn't organized yet. tmct's bet is that a large share of software and everyday questions sit
squarely in the first set, and that the second set is worth naming plainly rather than papering
over.
