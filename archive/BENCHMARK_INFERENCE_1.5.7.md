# BENCHMARK_INFERENCE_1.5.7 — no ladder measurement this cycle: the generator crashes before writing a cases file

**Headline:** this cycle could not produce a rung table at all. `node infbench/generate-cases.mjs`
(and `npm run infbench`, which chains it) crashes deterministically before writing `infbench/cases.jsonl`,
so Step 2 (`infbench/run.mjs`) never runs and there is no `product.jsonl` to read. This is a real,
reproducible bug in the generator's own fixture data, not a flaky run — reported here as this cycle's
honest result, per `SKILL_BENCHMARK_INFERENCE.md`'s own discipline that "every band lands where
predicted, ship as-is" and "the harness itself is broken" are both legitimate, reportable outcomes.

## Reproduction (checked directly, both entry points)

```
$ node infbench/generate-cases.mjs
infbench/generate-cases.mjs: FIXTURE LINT FAILED — infbench fixture lint failed (b2-svf1apply-4):
entailed literal term "dice" (normalized "dice") does not occur in the premises' triples
$ echo $?
1

$ npm run infbench
> @polycode-projects/the-mechanical-code-talker@1.5.7 infbench
> node infbench/generate-cases.mjs && node infbench/run.mjs

infbench/generate-cases.mjs: FIXTURE LINT FAILED — infbench fixture lint failed (b2-svf1apply-4):
entailed literal term "dice" (normalized "dice") does not occur in the premises' triples
```

Both commands fail identically, at the same case (`b2-svf1apply-4`), with exit code 1, before any
`infbench/cases.jsonl` is written. `npm run infbench` was confirmed present in `package.json` (line
98) — the harness itself exists, it just cannot run to completion on the current lexicon.

## Root cause

`infbench/generate-cases.mjs`'s own fixture lint (`checkEntailed`, lines 178-188) parses each case's
premises with `parseAce()` and checks that every literal term named in the case's `expect.entailed`
list actually appears (after `normFactTerm` normalization) among the resulting triples' terms. This
is working as designed — it is catching a real mismatch, not misfiring.

`b2Svf1Apply` (the `INF-B2` template that builds a positive `cls-svf1` instance case) draws its class
nouns from `CLASS_NOUNS`, which is every plain noun in `src/grammar/lexicon-core.json` (line 96). On
this run's fixed seed (`20260707`), the 4th generated case in that template picks the noun **"dice"**
for one of its premises (`"${ind2} is a ${n2}"` → `"e08.mjs is a dice"`) and expects the entailed
triple `{ subject: "e08.mjs", predicate: "rdf:type", object: "dice" }`.

But `src/grammar/lexicon-core.json` registers **"dice" twice**:

```
895:    "die": {
896:      "plural": "dice"
897:    },
...
4362:    "dice": {},
```

`"die"` declares `"dice"` as its irregular plural, **and** `"dice"` is separately registered as its
own standalone noun lemma. When `parseAce("e08.mjs is a dice.", lexicon)` runs, the noun lookup folds
the surface form `"dice"` back onto its irregular-plural parent and lemmatizes the resulting triple to
`tmct:die`, not `tmct:dice`. The generator's fixture lint then compares the case's expected literal
term `"dice"` against the actual triples' terms — `{tmct:die, ...}` — finds no match, and throws. The
lint is correct: the case as generated genuinely would assert the wrong entailed term if it shipped
unchecked; the bug is that the lexicon lets `"dice"` be picked as a class noun candidate in the first
place when it can never survive its own parse round-trip.

**Origin commit — verified directly, corrected from a prior secondhand claim.** A prior investigation
attributed this to commit `638cde3` ("feat(persona): hand-curate corpus/tier2/human.jsonl + grow
lexicon-core.json for the default human-world persona"). That attribution is wrong: `git show
638cde3:src/grammar/lexicon-core.json` contains no `"die"` or `"dice"` entry at all (checked directly
— the file's word list at that commit doesn't reach the `d`-initial entries where these two live
today). `git blame` on both the `"die": { "plural": "dice" }` entry (line 895-897) and the standalone
`"dice": {}` entry (line 4362) both point to commit **`89e071f27edc9a0e90db22b8ef1ff2eebf62d513`**
("feat(persona): build Medium + Large tier fact content (PLAN_SEED.md §3)", 2026-07-11 01:14:36
+0100) — confirmed by diffing that commit's parent against itself: neither entry exists in the parent
revision, both exist in `89e071f2`'s own tree. That commit added 8,890 new lexicon lines
(Medium+Large persona tiers) by walking WordNet hypernym/sense data; "dice"/"die" is one of the new
entries that slipped past its own collision guard (the commit message documents catching one such
collision live — "male" existing as both noun and adjective — but not this noun/irregular-plural
shape).

## The actual collision set — checked programmatically, not by eyeballing

The prior investigation additionally flagged 8 other nouns as "the same collision risk": people,
teeth, series, scissors, salmon, offspring, trout, deer. Checked directly against the current lexicon
(`src/grammar/lexicon-core.json`, 9,307 noun entries) by scanning every noun with a `"plural"` field
for cases where that plural string is *also* its own distinct standalone noun key:

```python
nouns = lex["nouns"]
for word, data in nouns.items():
    if "plural" in data:
        pl = data["plural"]
        if pl in nouns and pl != word:
            collisions.append((word, pl))
# -> [("die", "dice"), ("person", "people"), ("tooth", "teeth")]
```

**Only 3 collisions exist, not 9: `die`/`dice`, `person`/`people`, `tooth`/`teeth`.** The other 6
words the prior investigation named — series, scissors, salmon, offspring, trout, deer — are
*invariant* nouns whose `"plural"` field is set to the **same string as the noun itself**
(e.g. `"deer": { "plural": "deer" }`). That is not a collision: the surface form and the lemma are
identical, so there is nothing for `parseAce` to fold onto a different lemma, and no fixture-lint
mismatch is possible from that shape. They were false positives in the prior pass, most likely from
pattern-matching "irregular plural" without checking whether the plural string actually diverges from
the singular. The real remaining risk set, confirmed and narrower than reported, is:

- `person` → `people` (both registered; `people` is a standalone noun entry)
- `tooth` → `teeth` (both registered; `teeth` is a standalone noun entry)

These have not yet crashed a generation run only because the seeded shuffle hit `"dice"` first, inside
this cycle's `b2Svf1Apply` template, before ever reaching `"people"` or `"teeth"` in the pool — the
generator aborts on the first fixture-lint failure, so it cannot currently even show whether those two
would also trip the lint on a case that happened to pick them.

## What this blocks

Step 1 of `SKILL_BENCHMARK_INFERENCE.md`'s cycle (REGENERATE) cannot complete, so:

- No `infbench/cases.jsonl` is produced this cycle.
- Step 2 (`node infbench/run.mjs`) has nothing to replay — it was not run, because there is nothing
  for it to read.
- **No rung table, no per-band completion/fabrication numbers, no ladder-gate verdict can be reported
  for `1.5.7`.** This is not a band failing the gate (§2's PASS/skip machinery never engaged) — it is
  the harness itself failing to produce a cases file, a distinct and prior failure mode.
- The last real ladder measurement on record remains `BENCHMARK_INFERENCE_1.4.1.md` (full ladder
  gate PASS, no band skipped). Nothing in this cycle's investigation suggests the engine itself
  regressed — the crash is a fixture-data bug in `generate-cases.mjs`'s noun pool, not a change to
  `src/syllogise.mjs` or `src/chat.mjs`. That inference is circumstantial, though: without a
  successful run, `1.5.7`'s actual ladder state genuinely cannot be confirmed either way this cycle.

## Scope — fixing the lexicon collision is a follow-up, not done here

This was a measurement-only run (`SKILL_BENCHMARK_INFERENCE.md` Step 1-4). Fixing the underlying
`die`/`dice` (and `person`/`people`, `tooth`/`teeth`) lexicon collision — and deciding the right fix
shape (drop the standalone entries, exclude irregular-plural targets from `CLASS_NOUNS`

- **Immediate unblock (minimal fix):** remove the standalone `"dice": {}`, `"people": {}`, and
  `"teeth": {}` entries from `src/grammar/lexicon-core.json`'s noun list — they are redundant with
  `die`/`person`/`tooth`'s own `"plural"` declarations and only exist because the Medium/Large tier
  build (`89e071f2`) added them as independent WordNet headwords without checking for an existing
  irregular-plural claim on the same surface string.
- **Structural fix (more durable):** teach `scripts/apply-persona-tiers.mjs` (or a shared lexicon
  invariant check run at test time) to reject any new noun headword that collides with an existing
  noun's `"plural"` field before it ever lands in `lexicon-core.json`, catching this class of bug at
  build time instead of at the next INFBENCH cycle that happens to draw the colliding word.
- Neither fix was applied in this dispatch. Re-run `SKILL_BENCHMARK_INFERENCE.md`'s cycle from Step 1
  once one lands.

## `npm test` — checked in the foreground, not inferred

```
ℹ tests 1866
ℹ suites 0
ℹ pass 1866
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 171891.308939
```

1866/1866 green. The INFBENCH generator crash does not regress the product test suite — it is a
harness/fixture-data bug in `infbench/`, not in `src/` or `bin/`.

## Reproduce

```
node infbench/generate-cases.mjs      # crashes: FIXTURE LINT FAILED (b2-svf1apply-4)
npm run infbench                      # same crash, same case, via the chained script
npm test                              # 1866/1866, unaffected
```
