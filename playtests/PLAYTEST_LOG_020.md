# tmct playtest 020 — the three untested paraphrase axes

Version under test: 1.12.1 (working tree).

Probe recipe: a fresh scratch repo per session for the vocabulary and taught-fact
probes — `S=$(mktemp -d); node bin/tmct.mjs init --repo "$S"; printf '…\n/exit\n' |
node bin/tmct.mjs chat --repo "$S"`. The code-graph probes run read-only against the
shipped example — `node bin/tmct.mjs chat --repo examples/mini-webapp --ephemeral`.

Area: the three paraphrase rungs logged as untested since 017 — contractions, clefts,
and passive↔active beyond UsedFor and the rule signature.

This is an edge hunt, not a retest. No fix was applied and no code was touched.

## Method

Every probe sits on a fact whose plain form was checked first in the same session or
the same store. If the plain form misses, the paraphrase missing tells you nothing, so
those pairs are reported as "both miss" and score no fault against the rung.

Where a paraphrase produced the right answer, a **false** version of the same
paraphrase followed. A form that says "yes" to a true pair and "yes" to a false pair
has not read the sentence; it has guessed and won. The false pair is what separates a
rung from a coincidence, and it is where every wrong answer below came from.

Three verdicts, kept apart:

- **Pass** — the answer is right and the parse is right.
- **Honest miss** — the product declines. Working as designed.
- **Wrong answer** — the product asserts something false, or asserts a truth that
  answers a question the user did not ask in a way that reads as an answer to the one
  they did.

## Result

**42 probes: 21 answered correctly, 16 honest misses, 5 wrong answers.**

| axis | probes | correct | honest miss | wrong | verdict |
|---|---|---|---|---|---|
| 1. contractions | 12 | 5 | 6 | 1 | Partly works; one mis-teach |
| 2. clefts | 14 | 8 | 6 | 0 | Partly works; no wrong answers |
| 3. passive↔active | 16 | 8 | 4 | 4 | The agentless half works; the agentful half is broken |

Six of the 21 correct answers are correct by luck. They are marked below. They matter
because each one is the same code path that produces a wrong answer on the false pair.

The headline finding is axis 3. **A passive question with a by-agent drops the agent
and answers the unqualified question instead.** It is the only axis that asserts
falsehoods, and it does so on four probes across three predicates.

---

## Axis 1 — contractions

### The textbook probe

`what is a dog` works, so `what's a dog` is the pair.

```txt
tmct> what's a dog
dog is a kind of animal (source: corpus:human /r/IsA)
dog has tail (source: corpus:human /r/HasA)
dog can bark (source: corpus:human /r/CapableOf)
```

Byte-identical to the uncontracted form. **Pass.**

### Where the contraction is transparent

`who is calling src/core/store.mjs` and `who's calling src/core/store.mjs` both give
`src/handlers/tasks.mjs.` under the same canonical. **Pass.**

`can't a dog fly` and `a dog can't fly` both fail to parse. So do `cannot a dog fly`
and `a dog can not fly`. The negated capability frame does not exist in any spelling,
so the contraction is not the cause. **Honest miss, rung not implicated.**

`doesn't src/core/store.mjs call src/core/model.mjs` returns a complement list:

```txt
tmct> doesn't src/core/store.mjs call src/core/model.mjs
src/core/store.mjs, src/core/validate.mjs, src/lib/logger.mjs, src/lib/http.mjs, src/handlers/base.mjs, src/server/router.mjs, src/handlers/tasks.mjs, src/handlers/users.mjs, src/server/app.mjs, test/tasks.test.mjs and test/store.test.mjs.

Goal (inferred): Understand a graph relationship.

Canonical: a compositional query (forwardComplement) — composite(forwardComplement)
```

The uncontracted `does src/core/store.mjs not call src/core/model.mjs` gives the same
list under the same canonical. The contraction is faithful. A negated polar question
with an explicit object routes to the complement lane and never answers the yes/no,
which is an adjacent finding on a different axis, recorded below.

### The mis-teach

`disk-2 is bigger than disk-1` teaches correctly and reads back. The contraction does
not.

```txt
tmct> disk-2's bigger than disk-1
noted — remembered: disk-2's bigs than disk-1
```

```txt
$ node bin/tmct.mjs memory --repo "$S"
top facts by trust:
  disk-2's mgx:big than disk-1 — trust 0.97, 1 source: teach:chat:019f6aca-a47c-79b4-a83e-52816c65e70a@2026-07-16T11:58:13.347Z
```

**Wrong answer.** The `'s` is read as a genitive, so `disk-2's` becomes the subject,
`bigger` is taken for the main verb and lemmatised to `big`, and `mgx:big` lands in the
store at trust 0.97 with `than` stranded. The echo line claims to have remembered a
sentence the user never said. A correct answer is `noted — remembered: disk-2 is bigger
than disk-1`, the same as the uncontracted form. An acceptable answer is a decline.

This clears 017's bar for the goal sentence — "may honestly decline but must not
mis-teach" — in the wrong direction. It is the only probe in this log that writes
garbage to disk.

### Where the rung is absent

`a poodle is a dog` teaches and supports a 2-hop chase to `animal`. The contraction
teaches nothing:

```txt
tmct> a poodle's a dog
the graph at …/.tmct/graph.json is empty — no entities to answer from yet (this repo starts with no graph; the chat session folds the conversation into one).

tmct> is a poodle a dog
I can't confirm that — I don't know "poodle" at all yet. If it's true, teach me: "poodle is a kind of dog".
```

Nothing stored, nothing claimed. **Honest miss.** The copula contraction on the teach
lane does not exist. Note the contrast with `disk-2's bigger than disk-1` — the same
`'s`, one silently doing nothing, one silently storing garbage.

`disk-1's on peg-a`, `that's on peg-a` and `what's on peg-a` all land on the generic
introduction:

```txt
tmct> what's on peg-a
I'm tmct — a deterministic, offline chat assistant (no LLM). Try "what is a dog" for general vocabulary. /memory for what I remember.
For code structure (imports, calls, definitions) point me at a repo: `--repo <path>`, or try the shipped example `npm run example:mini`. tmct reads graphs; it doesn't index code itself.
/help for commands.
```

The plain `what is on peg-a` also misses, but it names its miss:

```txt
tmct> what is on peg-a
"on peg-a" isn't a term in this graph's own vocabulary (no matching class or predicate).
I don't know "on peg-a" yet — teach me directly, e.g. "remember on peg-a is an <thing>".
```

Both are honest. The contracted one is worse: it answers a question about the tool
instead of naming what it failed to find. **Honest miss, degraded.**

### Axis 1 probes

| # | input | answer | verdict |
|---|---|---|---|
| 1 | `what's a dog` | the three dog facts | Pass |
| 2 | `who's calling src/core/store.mjs` | `src/handlers/tasks.mjs.` | Pass |
| 3 | `doesn't src/core/store.mjs call src/core/model.mjs` | complement list | Pass (contraction faithful; see the negation finding) |
| 4 | `it's bigger than disk-1` | `couldn't resolve one of the terms in this question.` | Honest miss |
| 5 | `disk-2's bigger than disk-1` | `noted — remembered: disk-2's bigs than disk-1` | **Wrong answer** |
| 6 | `a poodle's a dog` | graph-is-empty message, nothing stored | Honest miss |
| 7 | `disk-1's on peg-a` | the tmct introduction | Honest miss |
| 8 | `that's on peg-a` | the tmct introduction | Honest miss |
| 9 | `what's on peg-a` | the tmct introduction | Honest miss |
| 10 | `can't a dog fly` | `couldn't parse this as a graph question.` | Pass (matches `cannot`) |
| 11 | `a dog can't fly` | `still couldn't parse that` | Pass (matches `can not`) |
| 12 | `what's a dog got` | `"dog got" isn't a term in this graph's own vocabulary` | Honest miss |

Probe 4 is worth one note. `it is bigger than disk-1` gets the pronoun decline, which
names the problem. `it's bigger than disk-1` gets `couldn't resolve one of the terms`
with the canonical `ask(calls, subject="it's", "disk-1")` — the contraction is not even
recognised as a pronoun. Both honest, one less useful.

---

## Axis 2 — clefts

### The textbook probe

`what calls src/core/store.mjs` works, so the it-cleft of that question is the pair.

```txt
tmct> what is it that calls src/core/store.mjs
couldn't resolve one of the terms in this question.

Goal (inferred): Understand a call relationship.

Canonical: does "it that" calls "src/core/store.mjs"? — ask(calls, subject="it that", "src/core/store.mjs")
```

**Honest miss.** The canonical shows why: the cleft's leftover words `it that` become
the subject term and resolve to nothing.

The forward direction works, for the same reason inverted:

```txt
tmct> what is it that src/core/store.mjs calls
src/core/model.mjs.

Canonical: what "it that src/core/store.mjs" itself calls — forward(calls, "it that src/core/store.mjs")
```

**Pass.** The leftovers attach to a real term and fuzzy resolution strips them. The
rule across this whole axis: when `it`/`that` land next to a module name, the answer is
right; when they stand alone as the subject, the probe misses.

### The it-cleft question genuinely discriminates

This is the one cleft rung that reads the sentence. True pair:

```txt
tmct> is it src/handlers/tasks.mjs that calls src/core/store.mjs
Yes — calls edge from src/handlers/tasks.mjs to src/core/store.mjs.
```

False pair:

```txt
tmct> is it src/lib/logger.mjs that calls src/core/store.mjs
No — no calls edge found from src/lib/logger.mjs to src/core/store.mjs.
```

**Pass, both.** It says No to the false one. The canonical still shows the glued
subject `"it src/lib/logger.mjs that"`, so this rides on fuzzy resolution rather than a
cleft frame, but the behaviour is correct in both directions.

### The declarative it-cleft is inconsistent

```txt
tmct> it is src/handlers/tasks.mjs that calls src/core/store.mjs
Yes — calls edge from src/handlers/tasks.mjs to src/core/store.mjs.

tmct> it is src/lib/logger.mjs that calls src/core/store.mjs
I can't store a fact about "it" as a class — pronouns aren't things I can classify. I remember facts in the shape "every X is a Y", where X is a specific noun, not a pronoun. Type /memory to see what I already remember.
```

The true one confirms. The false one falls through to the teach lane and declines about
pronouns. **Pass then honest miss.** Nothing false is asserted and nothing is stored,
so this is not a bug, but a user who states a wrong it-cleft never hears "No" — they
hear a lecture about pronouns. The routing appears to depend on whether the ask lane
found an edge.

### The wh-cleft is not read at all

```txt
tmct> what calls src/core/store.mjs is src/lib/logger.mjs
src/handlers/tasks.mjs.

Canonical: calls "src/core/store.mjs src/lib/logger.mjs" — reverse(calls, "src/core/store.mjs src/lib/logger.mjs")
```

The canonical glues both module names into one term, fuzzy-resolves it to the first,
and runs the reverse lookup. The user's assertion is never checked. The printed answer
is true, and it happens to be the correction the user needed, so this is **correct by
luck** rather than a wrong answer. The true version of the same probe gets the same
answer by the same accident.

The forward wh-cleft, by contrast, parses properly:

```txt
tmct> what src/core/store.mjs calls is src/core/model.mjs
Yes — calls edge from src/core/store.mjs to src/core/model.mjs.

Canonical: does "src/core/store.mjs" calls "src/core/model.mjs"? — ask(calls, subject="src/core/store.mjs", "src/core/model.mjs")
```

**Pass**, and a real one. The canonical is exactly the plain form's canonical.

### No cleft reaches the taught-fact lane

Against a store where `disk-1 rests on peg-a` is taught and reads back:

```txt
tmct> it is peg-a that disk-1 rests on
I can't store a fact about "it" as a class — pronouns aren't things I can classify. …

tmct> what disk-1 rests on is peg-a
couldn't resolve one of the terms in this question.

tmct> is it peg-a that disk-1 rests on
no module matching "it peg-a that disk-1" found in the index. Try "who touched <a module that actually has commits>" …

tmct> is it peg-b that disk-1 rests on
no module matching "it peg-b that disk-1" found in the index. …
```

**Four honest misses.** No mis-teach. The locative lane has no cleft rung, and the
misses route into the code-index wall on a store with no code in it.

One oddity in `what disk-1 rests on is peg-a`: it declines with `couldn't resolve one
of the terms` while its own canonical reads `ask(tests, subject="disk-1", "peg-a")`,
which is the canonical the answerable plain form uses. The terms resolved; something
after that declined.

### Axis 2 probes

| # | input | answer | verdict |
|---|---|---|---|
| 1 | `what is it that calls src/core/store.mjs` | `couldn't resolve one of the terms` | Honest miss |
| 2 | `what is it that src/core/store.mjs calls` | `src/core/model.mjs.` | Pass |
| 3 | `it is src/handlers/tasks.mjs that calls src/core/store.mjs` | `Yes — calls edge …` | Pass |
| 4 | `it is src/lib/logger.mjs that calls src/core/store.mjs` | pronoun decline | Honest miss |
| 5 | `is it src/handlers/tasks.mjs that calls src/core/store.mjs` | `Yes — calls edge …` | Pass |
| 6 | `is it src/lib/logger.mjs that calls src/core/store.mjs` | `No — no calls edge found …` | Pass |
| 7 | `what calls src/core/store.mjs is src/handlers/tasks.mjs` | `src/handlers/tasks.mjs.` | Correct by luck (glued term) |
| 8 | `what calls src/core/store.mjs is src/lib/logger.mjs` | `src/handlers/tasks.mjs.` | Correct by luck (glued term) |
| 9 | `what src/core/store.mjs calls is src/core/model.mjs` | `Yes — calls edge …` | Pass |
| 10 | `what tests src/core/store.mjs is test/store.test.mjs` | `test/tasks.test.mjs and test/store.test.mjs.` | Correct by luck (glued term) |
| 11 | `it is peg-a that disk-1 rests on` | pronoun decline | Honest miss |
| 12 | `what disk-1 rests on is peg-a` | `couldn't resolve one of the terms` | Honest miss |
| 13 | `is it peg-a that disk-1 rests on` | `no module matching "it peg-a that disk-1"` | Honest miss |
| 14 | `is it peg-b that disk-1 rests on` | `no module matching "it peg-b that disk-1"` | Honest miss |

---

## Axis 3 — passive↔active beyond UsedFor and the rule signature

### The textbook probe

`does src/core/store.mjs call src/core/model.mjs` answers `Yes — calls edge from
src/core/store.mjs to src/core/model.mjs.` The passive of that same fact:

```txt
tmct> is src/core/model.mjs called by src/core/store.mjs
src/core/model.mjs has no calls edges in the index.

Goal (inferred): Understand a call relationship.

Canonical: what "src/core/model.mjs src/core/store.mjs" itself calls — forward(calls, "src/core/model.mjs src/core/store.mjs")
```

**Wrong answer** on the plainest probe in this log. The correct answer is `Yes — calls
edge from src/core/store.mjs to src/core/model.mjs`, which the active form gives. The
canonical shows the failure: both module names glue into one term, fuzzy resolution
picks `src/core/model.mjs`, and the question flips to a **forward** lookup of what
model.mjs calls. Model.mjs calls nothing, so the sentence printed is true in isolation
and reads as "no" to the question asked.

### The agentless passive works everywhere

Drop the by-agent and every predicate answers correctly.

```txt
tmct> what is src/core/store.mjs called by
src/handlers/tasks.mjs.
Canonical: calls "src/core/store.mjs" — reverse(calls, "src/core/store.mjs")

tmct> src/core/store.mjs is called by what
src/handlers/tasks.mjs.

tmct> what is src/core/store.mjs tested by
test/tasks.test.mjs and test/store.test.mjs.

tmct> what is src/lib/http.mjs imported by
src/handlers/base.mjs and src/server/router.mjs and src/handlers/tasks.mjs.

tmct> what is defined by src/core/validate.mjs
validateTask and validateUser.
```

**Five passes**, each mapping to the same `reverse(…)`/`forward(…)` canonical the
active form produces. The passive voice itself is understood. Fronting the subject
(`src/core/store.mjs is called by what`) works too.

### The sharpest reproducer

Add a by-agent and the agent is dropped. This is the probe that matters most, because
the answer is false and confident.

```txt
tmct> is src/core/store.mjs tested by src/lib/logger.mjs
Yes — src/core/store.mjs is tested.

Goal (inferred): Understand a graph relationship.

Canonical: a compositional query (qualCheck) — composite(qualCheck)
```

**Wrong answer.** `src/lib/logger.mjs` does not test anything. The correct answer is
the one the active voice gives on the identical fact, in the same session:

```txt
tmct> does src/lib/logger.mjs test src/core/store.mjs
No — no tests edge found from src/lib/logger.mjs to src/core/store.mjs.

Canonical: does "src/lib/logger.mjs" tests "src/core/store.mjs"? — ask(tests, subject="src/lib/logger.mjs", "src/core/store.mjs")
```

Active says No. Passive says Yes. Same fact, same store, same turn sequence.

The `qualCheck` canonical names the mechanism. The by-agent is thrown away and the
question becomes the unqualified "is store.mjs tested at all", which is yes. Any agent
produces `Yes`:

```txt
tmct> is src/core/store.mjs tested by test/store.test.mjs
Yes — src/core/store.mjs is tested.

tmct> is src/core/store.mjs tested by test/tasks.test.mjs
Yes — src/core/store.mjs is tested.

tmct> is src/core/store.mjs tested by src/lib/logger.mjs
Yes — src/core/store.mjs is tested.
```

The first two are true. They are true because store.mjs is tested, not because the
named agent tests it. The third proves the first two are luck.

### The same bug on imports and defines

```txt
tmct> is src/lib/http.mjs imported by src/server/router.mjs
src/lib/http.mjs has no imports edges in the index.

Canonical: what "src/lib/http.mjs src/server/router.mjs" itself imports — forward(imports, "src/lib/http.mjs src/server/router.mjs")
```

**Wrong answer.** Router.mjs does import http.mjs — the agentless probe above lists it.
The correct answer is `Yes`. The glue-and-flip failure is identical to the `calls` one:
http.mjs imports nothing, so the true-in-isolation sentence reads as "no".

```txt
tmct> is validateTask defined by src/lib/logger.mjs
Logger and Logger.info and createLogger.

Canonical: what "validateTask src/lib/logger.mjs" itself defines — forward(defines, "validateTask src/lib/logger.mjs")
```

**Wrong answer.** `validateTask` is defined by `src/core/validate.mjs`. The correct
answer is `No`. Instead the subject is dropped and logger.mjs's own definitions are
listed, which reads as the answer to "what is defined by logger.mjs" — a question
nobody asked. A user skimming this comes away believing validateTask lives in
logger.mjs.

The true version has the same shape and the same luck:

```txt
tmct> is validateTask defined by src/core/validate.mjs
validateTask and validateUser.
```

Right list, no yes/no, subject never checked.

### Taught predicates decline honestly

`causes` is not in the shipped corpus, so it was taught first. The plain active form
works after tmct itself names the shape:

```txt
tmct> fire causes smoke
I don't store a bare "fire causes smoke" on its own — to store that, say: "remember that fire causes smoke".

tmct> remember that fire causes smoke
noted — remembered: fire causes smoke

tmct> does fire cause smoke
yes — you told me: fire causes smoke (source: teach:chat:…)
```

Every passive of that fact misses, and misses honestly:

```txt
tmct> is smoke caused by fire
no module matching "smoke caused" found in the index. …

tmct> smoke is caused by fire
no module matching "smoke caused" found in the index. …

tmct> what is smoke caused by
I don't know "smoke caused by" yet — teach me directly (e.g. "remember <name> is a <thing>").

tmct> is smoke caused by rain
couldn't resolve one of the terms in this question.
```

**Four honest misses.** Nothing false, nothing stored. The passive rung does not reach
taught predicates at all, and the code-index wall is the wrong wall for a store with no
code in it, but the honesty holds.

Also worth recording: `what does fire cause` — an **active** forward wh-question on the
same taught fact — misses too. So the taught `causes` predicate answers only the active
yes/no. That is a gap on the plain form, not on the paraphrase.

### Axis 3 probes

| # | input | answer | verdict |
|---|---|---|---|
| 1 | `is src/core/model.mjs called by src/core/store.mjs` | `src/core/model.mjs has no calls edges in the index.` | **Wrong answer** |
| 2 | `what is src/core/store.mjs called by` | `src/handlers/tasks.mjs.` | Pass |
| 3 | `src/core/store.mjs is called by what` | `src/handlers/tasks.mjs.` | Pass |
| 4 | `what is src/core/store.mjs tested by` | `test/tasks.test.mjs and test/store.test.mjs.` | Pass |
| 5 | `what is src/lib/http.mjs imported by` | three importers | Pass |
| 6 | `is src/core/store.mjs tested by test/store.test.mjs` | `Yes — src/core/store.mjs is tested.` | Correct by luck (agent dropped) |
| 7 | `is src/core/store.mjs tested by src/lib/logger.mjs` | `Yes — src/core/store.mjs is tested.` | **Wrong answer** |
| 8 | `is src/core/store.mjs tested by test/tasks.test.mjs` | `Yes — src/core/store.mjs is tested.` | Correct by luck (agent dropped) |
| 9 | `is src/lib/http.mjs imported by src/server/router.mjs` | `src/lib/http.mjs has no imports edges in the index.` | **Wrong answer** |
| 10 | `what is defined by src/core/validate.mjs` | `validateTask and validateUser.` | Pass |
| 11 | `is validateTask defined by src/core/validate.mjs` | `validateTask and validateUser.` | Correct by luck (subject dropped) |
| 12 | `is validateTask defined by src/lib/logger.mjs` | `Logger and Logger.info and createLogger.` | **Wrong answer** |
| 13 | `is smoke caused by fire` | `no module matching "smoke caused"` | Honest miss |
| 14 | `smoke is caused by fire` | `no module matching "smoke caused"` | Honest miss |
| 15 | `what is smoke caused by` | `I don't know "smoke caused by" yet` | Honest miss |
| 16 | `is smoke caused by rain` | `couldn't resolve one of the terms` | Honest miss |

---

## Findings

### 1. The agentful passive drops an argument and answers a different question

The one finding that costs honesty. Four wrong answers across `calls`, `tests`,
`imports` and `defines`, and three more answers that are right only because the dropped
argument happened not to matter.

Two shapes, one cause:

- **Glue and flip** (`calls`, `imports`). `is A called by B` glues `A B` into one term,
  fuzzy-resolves to `A`, and runs `forward(calls, A)` — the wrong direction on the
  wrong question. When `A` has no forward edges, the reply is "A has no calls edges in
  the index", which reads as "no" to a question whose answer is yes.
- **Drop the agent** (`tests`, `defines`). `is A tested by B` becomes the unqualified
  `qualCheck` "is A tested", which returns `Yes — src/core/store.mjs is tested.` for
  every B, including modules that test nothing.

Sharpest reproducer, both directions in one session against `examples/mini-webapp`:

```txt
tmct> is src/core/store.mjs tested by src/lib/logger.mjs
Yes — src/core/store.mjs is tested.

tmct> does src/lib/logger.mjs test src/core/store.mjs
No — no tests edge found from src/lib/logger.mjs to src/core/store.mjs.
```

Correct answer for the passive: `No — no tests edge found from src/lib/logger.mjs to
src/core/store.mjs`, identical to the active form.

The agentless passive is fine on all five predicates probed, so the passive voice is
understood. The by-agent phrase is what nothing consumes.

### 2. `disk-2's bigger than disk-1` stores a fact the user never said

The only mis-teach in this log.

```txt
tmct> disk-2's bigger than disk-1
noted — remembered: disk-2's bigs than disk-1
```

Stored as `disk-2's mgx:big than disk-1` at trust 0.97. The `'s` is read as a genitive,
so the subject keeps the apostrophe-s and `bigger` is lemmatised into a predicate
`mgx:big`. Correct answer: `noted — remembered: disk-2 is bigger than disk-1`.
Acceptable answer: a decline.

Adjacent and worth naming together — the same `'s` on the teach lane behaves three ways
depending on the frame. `a poodle's a dog` stores nothing and says the graph is empty.
`disk-1's on peg-a` prints the tmct introduction. `disk-2's bigger than disk-1` stores
garbage. One contraction, three lanes, three outcomes.

### 3. Cleft rungs exist in the forward direction and are absent in the reverse

Consistent and explainable. Fuzzy term resolution strips a cleft's `it`/`that` when they
sit next to a real term, and fails when they stand alone as the subject.

Works: `is it X that calls Y` (discriminates true from false), `what is it that X
calls`, `what X calls is Y`.

Absent: `what is it that calls Y` (leftover subject `it that`), every cleft on the
taught-fact lane.

Unparsed but harmless: `what calls Y is X` glues `Y X`, resolves to `Y`, and answers the
reverse lookup. The printed answer is true and is the correction a user asserting a
false cleft needs, so it costs nothing today. It is luck, not a rung.

Inconsistent: the declarative it-cleft confirms a true statement (`Yes — calls edge …`)
but sends a false one to the teach lane's pronoun decline. Nothing false is asserted.

### 4. Adjacent finding — a negated polar question with an explicit object never answers

Not a contraction problem. `doesn't X call Y` and `does X not call Y` behave
identically, which is what clears the contraction rung. Both route to
`forwardComplement` and return the list of everything X does not call, discarding Y and
never answering the yes/no. Folded in here rather than deferred, per CLAUDE.md.

### 5. Adjacent finding — the code-index wall answers on stores with no code

On a taught-fact store with no code graph, several misses reply `no module matching
"smoke caused" found in the index. Try "who touched <a module that actually has
commits>"…`. The advice cannot apply — there is no index. Honest, and pointed at the
wrong wall.

### 6. Adjacent finding — the contracted miss is less useful than the plain miss

`it is bigger than disk-1` names the pronoun problem. `it's bigger than disk-1` says
`couldn't resolve one of the terms` with canonical `ask(calls, subject="it's",
"disk-1")` — the contraction never reaches the pronoun check. `what's on peg-a` prints
the tool introduction where `what is on peg-a` names the term it could not find. Both
honest in each pair, one less useful.

## Result

Fail on axis 3 (four wrong answers). Fail on axis 1 (one mis-teach). Axis 2 carries no
wrong answers and partly works.

No code changed, no test suite touched, nothing written into the project working tree.
