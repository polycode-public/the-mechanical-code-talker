# SKILL_PLAIN_PROSE.md — write plain, human prose; keep the proof out of the shop window

The stock LLM writing voice reads as generic and machine-made, and on a project whose whole pitch
is "no LLM, deterministic, grounded or an honest miss," that voice actively undercuts trust in the
claims. This skill is the standing style guide: how to write so the prose reads as if a person wrote
it, and where the supporting evidence belongs so the reader-facing surfaces stay lean.

**Scope: everything written for a human reader** — the Pages homepage, the README, the design docs,
the benchmark write-ups, the other skill docs, code comments, and the assistant's own chat
responses. Plain, direct sentences carry more authority than decorated ones, and they match the
voice tmct's docs already use: honest, terse, lowercase-y, no marketing.

> **Use it whenever you draft or edit human-facing text** in this repo: `README.md`, `ROADMAP.md`,
> `public/index.html` (the GitLab Pages homepage, which is also the npm/landing surface), the
> `PLAN_*.md` design docs, the `CHATBENCH_0NN.md` write-ups and their `_TRANSCRIPTS` files, the
> `SKILL_*.md` docs (`SKILL_TUNING_CYCLE.md`, `SKILL_STRATEGY_ADVISOR.md`, this one), any other
> `*.md`, code comments, and chat.

---

## 1. The tells to cut (the checklist)

Scan every draft for these and remove them. They are the machine-voice fingerprints.

- **Em-dash sprinkling as fake sophistication.** Do not bolt clauses together with `—`. Use a
  period, a comma, or restructure the sentence. Reserve em-dashes for rare, deliberate use. (tmct's
  docs already lean hard on em-dashes; this is the most common tell to trim here.)
- **The "not X, it's Y" / "not X but Y" / "not only X but also Y" negation-contrast.** State what
  the thing is, not what it isn't. Write "one of 15 cells cleared the bar," not "it is not a broad
  win."
- **Announced-honesty preambles.** Drop "honest current state:", "the honest result up front:", "to
  be clear," "reported honestly." Just report the thing. Self-labelling text as honest signals the
  opposite. (tmct's product ethos is honesty; let the prose *be* honest rather than *say* it is.)
- **Colon reveals.** Avoid the dramatic setup-then-colon ("the follow-up that tried to generalise
  it:"). Write a plain subject-verb sentence.
- **Anthropomorphizing tools and benchmarks.** A parser does not "want," a benchmark does not
  "struggle," a strategy is not "obsessed." Say what it did or measured. (The README's PARRY
  framing is a deliberate, earned exception; don't extend it to the metrics.)
- **Rule-of-three padding, hedging, and hype.** Cut "powerful", "transformative", "meticulous",
  "seamless", "robust", "in the ever-evolving landscape", "it's worth noting", "delve", and the
  reflexive three-item list where two items or one would do.
- **Listicle bloat and promotional filler.** Don't inflate two real points into a bulleted five.
  Don't restate the headline three ways. One concrete claim beats three decorated ones.

Default to short declarative sentences a person would write. Say the thing once, plainly.

---

## 2. Proofs and evidence: lean on the reader-facing surfaces, full detail in the CHATBENCH files

The shop-window surfaces are the **Pages homepage** (`public/index.html`) and the repo
**`README.md`**. On these, be sparing with proof. State the headline claim, keep it concrete and
honest, and link out for the apparatus. Do not reproduce the full evidence machinery inline.

**On the homepage and README:**
- Give the headline result in a sentence or two, with the one number that matters and its condition
  (which benchmark cycle, judge, task shape, N). Then stop.
- One small table at most, only if it earns its place. Do not stack multi-row cross-cycle tables,
  per-run N-counts, caveat paragraphs, and method notes on a landing page.
- Link to the evidence doc for anyone who wants the proof: "full method and scores in the cycle
  write-up (`CHATBENCH_0NN.md`)."
- State conditions plainly without turning the page into a disclaimer. "The score is judge- and
  cycle-conditional" is one clause, not three hedged paragraphs.

**Keep the full detail in the `CHATBENCH_0NN.md` write-ups and their `_TRANSCRIPTS` files.** That is
the right home for the complete tables, the judge scores and spreads, the per-cell breakdowns, the
tuning-cycle contract, the caveats, and the raw transcripts. The `PLAN_*.md` docs hold the
design-level detail behind a feature. A reader who wants to verify a claim follows the link and
finds everything; a reader who just wants to know what tmct does is not made to wade through the
proof to get there.

The rule in one line: **the claim lives in the window, the proof lives in the back room, and a link
connects them.**

---

## 3. Related principles (same spirit)

- **No delta-framing.** Describe the work on its own terms. Don't frame a design as a rebuttal to a
  single external citation or to seonix's old shape. If a benchmark refuted an idea, report the
  measurement, not a running quarrel with the source. Contrast framing reads as defensive.
- **Dependency pragmatism.** Never frame work around avoiding dependencies. State what a choice does
  positively. (`PLAN_DEPENDENCY_STRATEGY.md` already reaches the "change nothing now" verdict on its
  own terms — keep that tone.)
- **"NOT" sections stay factual.** The README's "What tmct deliberately is NOT" section is fine
  because each bullet states a positive scope decision (it's a conversation layer, not an indexer).
  Keep those grounded; don't let them drift into a list of things competitors get wrong.

All three are the same instinct as this skill: say what the thing is, positively and plainly,
without scaffolding it against something else.

---

## 4. Workflow — scan before you ship

After drafting any human-facing text:

1. Search the draft for `—`, "not just", "not only", "not X, it's Y", "honest"/"transparent"
   self-labels, "delve", "it's worth noting", and hype adjectives. Cut each one.
2. Read it aloud in your head. If a clause sounds like a press release or a model's default voice,
   rewrite it as the sentence a person would actually say.
3. If it is a reader-facing surface (homepage or README) and you are about to paste a proof, stop.
   Trim to the headline claim plus a link to the relevant `CHATBENCH_0NN.md`; move the apparatus
   there.
4. Match the surrounding voice. tmct's docs are terse and lowercase-leaning; a new paragraph that
   suddenly turns formal and three-adjectived is a tell even if every individual word is fine.

This applies to the assistant's own chat responses too, not only the artefacts it produces.

---

## 5. One-paragraph TL;DR

Write plain, direct prose a person would recognise as human: no em-dash sprinkling, no "not X it's
Y" contrast, no announced-honesty preambles, no colon reveals, no anthropomorphized parsers or
benchmarks, no hype or rule-of-three padding, no listicle bloat. On the homepage
(`public/index.html`) and README, state the headline claim concisely and link to the proof rather
than reproducing it; the full tables, judge scores, contract, caveats, and transcripts live in the
`CHATBENCH_0NN.md` write-ups (and `_TRANSCRIPTS`), and the design detail lives in the `PLAN_*.md`
docs. Same spirit as no-delta-framing and dependency-pragmatism: say what the thing is, positively,
and stop. Applies to docs, code comments, site copy, and the assistant's own chat — and it should
match the honest, terse voice the repo already uses.
