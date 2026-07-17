# SKILL_PLAYTEST_EDGE_HUNT.md — the main-thread playtest loop: find an edge, fix it, ship it

This skill turns `EXAMPLE_PLAYTEST_LOG.md` (written for a human playtester) into a loop Claude
Code runs itself, against the LOCAL working copy — always `node bin/tmct.mjs` from this repo,
never an npm-installed tmct. Each iteration explores one area of conversation until it finds an
edge (a request tmct can't parse, or one that parses but returns the wrong or no answer),
documents it in a numbered log under `./playtests/`, fixes it, retests, then commits, rolls the
version, and pushes. Then the next iteration starts.

> **Invoke it by telling a session:** *"Follow `SKILL_PLAYTEST_EDGE_HUNT.md`"*, optionally naming
> an iteration budget ("run 5 playtests") or a starting area ("start with negation").

## 0. Ground rules

- **Main thread only.** This is a deliberate exception to CLAUDE.md's coordinator/background-agent
  model. The loop is serial by nature (probe → diagnose → fix → retest → ship) and each step
  feeds the next; splitting it across agents adds hand-off cost and nothing else. Long commands
  (the full `npm test`) still tee to a file: `npm test 2>&1 | tee /tmp/pt-test.log | tail -20`.
- **Ship every iteration.** The operator's standing instruction for this activity: at the end of
  each iteration, commit, roll the version (patch bump of `package.json` + `package-lock.json`),
  and push — one push per iteration, the bump commit part of that push. This is an explicit
  versioning instruction; per CLAUDE.md it is not up for debate and you never pause to ask about
  cadence. CI publishes on the version bump on `main`.
- **`npm test` green at every commit**, plus the CLI smoke:
  `printf 'hi\n/exit\n' | node bin/tmct.mjs` must greet and exit 0.
- **Local build, isolated memory.** Never let a playtest session write to this repo's `.tmct/`.
  Every probe session runs against a fresh scratch repo (§3).

## 1. The loop

Repeat until a stop condition (§7) fires:

1. **Check prior coverage first.** Before anything else, survey the existing
   `playtests/PLAYTEST_LOG_*.md` files — each log's header records its Area and which axes are
   exhausted vs untouched (`grep -h -i -E 'area|axes' playtests/PLAYTEST_LOG_*.md` is enough).
   Pick this run's areas from the untouched list; don't re-plough ground a prior log already
   proved passing.
2. **Start the log.** Copy `EXAMPLE_PLAYTEST_LOG.md` to `playtests/PLAYTEST_LOG_<NNN>.md`
   (`NNN` = highest existing number + 1, zero-padded; `mkdir -p playtests` on first run). Adapt
   the copy (§2).
3. **Pick one area** of conversation to explore (§4) — one area per iteration, recorded at the
   top of the log with the tmct version under test.
4. **Probe** with short piped sessions (§3) until you hit an edge. Max 3 examples per sentence
   structure: the grammar rules are separate from the lexicon, so a third lexical variant of a
   failing shape proves nothing new.
5. **Minimize the edge.** Strip the failing request word by word until it parses; keep the
   closest passing form and the minimal failing form as a pair. That pair defines the edge
   precisely and becomes the regression test.
6. **Capture** in the log: the Given/When/Expected/Actual block, the verdict, and the verbatim
   session log (§6). Succinct — a couple of discriminating examples, not every probe you ran.
7. **Diagnose and fix** (§5), rerun the exact failing probes plus `npm test` until passing. If a
   fix can't be made to pass without collateral damage, mark the log's result
   `Fail (unable to pass)` with one paragraph on why, revert the attempt, and still ship the log.
8. **Ship.** Commit the fix + its regression test + the playtest log (repo-local identity),
   bump the patch version, push. Then go to 1.

## 2. Adapting the copied log

The copy starts as `EXAMPLE_PLAYTEST_LOG.md` verbatim; make it a record, not a manual:

- Retitle to `tmct playtest <NNN> — <area>` and delete the Installation section and the
  npx/npmjs/gitlab orientation text. Replace with two lines: the tmct version under test
  (`package.json` at iteration start) and the probe recipe actually used (§3).
- Keep the structure from the `test: …` heading down: **Expectations** (Given / When / Expected /
  Actual), **Result**, **Play test session log**, **Retest** / **Retest result** / **Retest
  session log**. One `test: <name>` section per edge found (usually one per iteration; if
  probing turns up a second adjacent edge, fold it in — don't skip it silently).
- Add a short **Fix** section between Result and Retest: which layer changed (§5's map), what
  the change was, and which test file carries the regression. No commit hashes, no "Gap N"
  labels — plain description.
- Delete the example placeholder content as you replace it. `(example)` markers must not
  survive into a shipped log.

## 3. Probe recipe

Sessions are deterministic and $0, so replay is exact. Per probe session:

```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'what is a horse\nwhat is for riding\n/exit\n' | node bin/tmct.mjs chat --repo "$SCRATCH"
```

- A fresh `--repo` scratch dir per session keeps taught facts from leaking between probes. When
  a probe NEEDS taught state (inference chains), the teach lines are part of the same piped
  script — that keeps the whole scenario in one reproducible command, which is what goes in the
  log.
- Record the exact `printf` script in the log next to its session output. Retest = rerun the
  same command.
- **`--narrate` is the diagnostic tool**: add it (or `TMCT_NARRATE=1`) to see, per turn, which
  strategy matched, which pattern fired, and what the goal inference was. Probe without it
  (clean logs for the doc), diagnose with it.
- `node bin/tmct.mjs memory --repo "$SCRATCH" --verbose` shows what a teach turn actually
  stored — the fastest way to tell a parse failure from a storage/retrieval failure.
- `/help` inside chat lists every query shape tmct claims to support; claims it can't honour
  are edges too.

## 4. Edge-hunting strategies

The productive move is to hold MEANING constant and vary FORM, one axis at a time, until the
answer changes. When a form fails, you have a minimal pair for free. Axes worth walking, roughly
in order of yield:

- **The paraphrase ladder.** Take a canonical passing query ("what is a dog") and climb:
  drop determiners ("what is dog"), contract ("what's a dog"), wrap in politeness ("could you
  tell me what a dog is"), invert to yes/no ("is a dog an animal"), passive ("what is a horse
  used for" ↔ "what is used for riding"), cleft ("it's a dog that barks — true?"). tmct's
  history says the ladder's upper rungs are where edges live.
- **Relation coverage.** Repeat a passing shape across relations: IsA, HasA, CapableOf, UsedFor,
  PartOf. A shape often works for the relation it was built for and no other.
- **Inference depth.** The grandfather scenario in the example log is the template: teach a
  chain, then query at 1 hop, 2 hops, 3 hops. Find the hop count where inference stops.
- **Negation and quantifiers.** "what can't fly", "is a dog not a cat", "do all dogs bark",
  "which animals can fly". These stress normalize.mjs's frames before any grammar runs.
- **Teach-side variation.** The same fact phrased differently: "ahab is john's father",
  "john's father is ahab", "ahab fathered john", plurals ("dogs are animals"), conjunctions
  ("ahab is male and is the father of john"). Then verify each with the SAME query, so the
  variable is the teach parse alone.
- **Multi-word and awkward terms.** "guinea pig", "ice cream", terms colliding with query
  keywords ("what is a what-if analysis").
- **Anaphora.** "what is a dog" then "can it bark", "what about cats". Context carry-over is a
  known thin spot; establish where it starts failing rather than that it fails.
- **The teach/query boundary.** Bare declaratives ("dogs bark") — teach, query, or refusal?
  Whatever it does, is it the same every time?

Pick ONE axis per iteration and log which axes are exhausted (a line in the log's header), so
later iterations don't re-plough passing ground — that's also what makes the no-change stop
condition (§7) meaningful.

## 5. Diagnosing and fixing — the layer map

Run the failing probe with `--narrate` first. Which strategy matched (or that none did) tells
you which layer owns the fix. The interpretation pipeline
(`src/domain/interpret/pipeline.mjs`) runs, in precedence order: normalize → grammar → keyword-spot →
noise-strip → ACE → constructions.

| Symptom | Layer to look at |
|---|---|
| A surface wrapper/rhetorical frame around a shape that already works | `src/domain/interpret/normalize.mjs` (PHRASING_FRAMES, negation frames) |
| A genuinely general question shape nothing handles | `src/domain/interpret/strategies/grammar.mjs` (anchored templates T1–T10) |
| A specific surface construction mis-read by keyword-spot (wrong subject/object direction, agent nouns, genitives, compounds) | `data/templates/constructions/*.toml` — the free-form templating layer |
| Teach sentence not parsed / stored wrongly | `src/domain/grammar/` (ACE grammar, lexicon) — verify with `tmct memory` |
| Parsed fine, answer phrased badly | `src/answer-variants.*`, `data/templates/responses.jsonl`, `src/services/finish.mjs` + `data/templates/grammar-rules.toml` (byte-stable contract — read that file's header first) |

**The templating mindset (this is the important one).** When a fix means adding a special case
to a general rule — an extra `|alternative` in a grammar.mjs regex, a carve-out for one phrasing —
stop and ask whether you're overfitting. The project's preferred move for irregular language is
the construction bank: `data/templates/constructions/` holds closed template families as DATA
(pattern → AST skeleton), loaded by `src/domain/interpret/strategies/constructions.mjs` and validated at
load time against the closed relation/entity vocabularies. This is the same layer that fixed
"store.mjs's importers" / "store.mjs importers" without touching the general grammar. The rules:

- A new bank is a NEW `.toml` file in that directory — the loader picks it up in filename order;
  no code change. Construction ids continue the sequence (T11–T13 exist; take the next numbers).
- Closed is deliberate. Hand-curate the vocabulary; a false-positive match on an unrelated
  phrasing is worse than an honest miss. If you catch yourself wanting a wildcard where the
  closed alternation goes, that's the overfitting alarm ringing on the other side — the shape
  may really belong in grammar.mjs as a general template instead. General shape → grammar.mjs;
  irregular surface realization of an existing shape → construction bank; one weird phrasing
  that generalizes to nothing → consider whether it's an edge worth shipping at all, and if so
  say so in the log rather than distorting a rule for it.
- Invalid entries are dropped at load, never coerced — so a bank fix that silently does nothing
  usually means a `kind`/`entityType` outside the closed vocabulary. Check with `--narrate`.

Every fix ships with a regression test named for the behavior it checks ("resolves 'X's
importers' as a reverse imports query"), never for the playtest that found it. The minimal pair
from §1 step 5 is the test's input.

## 6. What "captured succinctly" means

The log is evidence, not a transcript dump. Per edge:

- **Expectations block** — Given (any prior teach/answers, as a fenced log), When (the probe
  lines), Expected (one line), Actual (verbatim). Two or three probe lines maximum — the
  discriminating ones.
- **Result** — `Fail`, then after the fix, **Retest result** — `Pass` (or
  `Fail (unable to pass)` + one paragraph).
- **Session logs** — the real terminal output, fenced as `txt`, trimmed to the relevant turns.
  Keep the startup banner once (it names the version), not per snippet.

## 7. Stop conditions

The loop ends when the FIRST of these fires:

- **Budget.** The iteration count named at invocation is reached (default 10 if none given).
- **Two no-change iterations in a row.** A no-change iteration is one that ships no code/data
  change: the chosen area was probed and everything passed, and a second area (pick one, don't
  grind) also turned up nothing. The log still gets written (it documents passing coverage) and
  shipped — the instruction to push and roll every iteration stands even for a log-only
  iteration.
- **Plateau.** Three consecutive iterations end `Fail (unable to pass)`. Fixes have stopped
  yielding; further probing is measurement, not improvement. Write a closing note in the last
  log listing the unfixable edges as candidates for a PLAN doc, and stop.

On stop, report to the operator: iterations run, edges found/fixed/unfixable, versions shipped,
and which exploration axes (§4) are exhausted vs untouched.
