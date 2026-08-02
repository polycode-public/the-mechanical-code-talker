# CLI edge hunt

A playtest of the command-line surface at v5.0.5 (commit `4e1e18aa`). No code changed. Every finding
below is a transcript from `node bin/tmct.mjs`, run against throwaway repos under a scratch
directory, with a fresh worlds pack, sprite facts and ask bundle built first.

Findings are grouped by surface, worst first. Severity ranks the way the brief asks: a claim where a
refusal was due is worst, then a phrasing a person would obviously type that dead-ends, then wording.

**One answer given where a refusal was due.** `/untested` on a repo with no code index reports full
test coverage. That is finding 1. Everything else is a dead-end, a wrong lane, or wording.

The refusal machinery itself is in good shape. Section 6 lists what held up.

---

## 1. Graph-query lanes

### 1.1 `/untested` claims full test coverage on a repo with no code index

Severity: **worst class.** This is an assertion about the user's repository, stated with no hedge,
where the only true answer is "I have no code index to look at". The banner three lines above says
`graph has no code entities`, so the session contradicts itself inside one screen. A user who runs
`tmct init` and asks about coverage is told their repo is fully tested.

```
$ node bin/tmct.mjs init --repo /tmp/scratch
$ printf '/untested\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/scratch
```

Came back:

```
tmct chat — /tmp/scratch — no code graph loaded — graph has no code entities — …
tmct> every source module has at least one covering test module.

Goal (inferred): Assess test coverage.
```

Expected: the same refusal its sibling lane already gives. In the same session, `what most needs a
test` answers `no modules to rank in this index.` plus the index-this-repo nudge. So the guard exists
one lane over.

`tmct plan` composes the same claim into a plan step:

```
$ node bin/tmct.mjs plan "what most needs a test" --repo /tmp/scratch-with-vocab-graph
tmct plan: "what most needs a test"
driver: goal-0.8.1

steps:
  1. tmct_untested {}
     every source module has at least one covering test module.

composed answer (0): (empty set)
```

Fault: `src/domain/codegraph.mjs:1381`. `renderUntested` returns the all-covered sentence whenever
`untested` is empty, with no check that any `Module` individual exists at all. Zero modules and zero
uncovered modules render identically.

Note the plan run needs a graph file that exists but holds no code entities (any repo where a chat
session has already folded vocabulary in). On a repo with no graph file at all, `tmct plan` declines
correctly.

### 1.2 A three-word question about an unknown term returns the product blurb, not a miss

Severity: high. The miss wall is the product. This shape steps around it. The reply is a confident
paragraph about what tmct is, so a stranger reads it as "answered" rather than "I don't know that".

```
$ printf 'what is grelb\nwhat is a grelb\nwho is grelb\nwhat is Paris\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/scratch
```

Came back:

```
tmct> I'm tmct — a deterministic, offline chat assistant (no LLM). Try "what is a dog" for general
vocabulary. /memory for what I remember.
For code structure (imports, calls, definitions) point me at a repo: `--repo <path>` …
/help for commands.
"grelb" isn't a term in this graph's own vocabulary (no matching class or predicate).
I don't know "grelb" yet — teach me directly, e.g. "grelb is a <thing>" …
still the same overview — /help lists every command and query shape.
I'm tmct — a deterministic, offline chat assistant (no LLM). …
```

So `what is a grelb` (four words) refuses cleanly. `what is grelb`, `who is grelb` and `what is
Paris` (three words each) get the blurb. `what is Mira`, `what is quorble` and `what is Zebulon`
behave the same way.

Expected: all four land on the same miss wall.

Fault: `src/services/chat.mjs:1413`. `isConversational` ends with a catch-all that treats any input of
three words or fewer with no code-ish token as small talk. A known term escapes it through the
bare-meta-fact lane; an unknown term has nothing to escape with, so the orientation card claims it.

### 1.3 Non-code questions get the "index this repo" nudge

Severity: medium. The refusal is correct, but the remedy attached to it points somewhere useless, and
in one case implies a capability the product does not have.

```
$ printf 'how many moons does Pluto have?\nwho won the 2031 world cup?\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/scratch
tmct> I can't count "moons" — no code graph is loaded yet, so there's nothing to count
(index this repo with "tmct index", point me at another with --repo, or run "npm run example:mini").
I couldn't read that as a question I can answer. …
(this repo has no code graph — index it with `tmct index` …)
```

The moons line reads as "index a repo and I could count moons". Expected: a plain decline with no
code-graph remedy when nothing in the question is code-shaped.

### 1.4 `define <term>` and `where do <things> live` route to the code lane

Severity: medium. `define X` is one of the first things a person types at a vocabulary chatbot, and
`what does X mean` (the shape `/help` advertises) already works. The reply talks about a module index
the user never asked about.

```
$ printf 'define dog\nplease define a dog\nwhere do dogs live\nwhere did you learn that\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/scratch
tmct> no module matching "dog" found in the index. This store holds no code index, so it records no
modules or commits to look through.
…
Goal (inferred): Locate what a module/class defines.
```

All four route to the code `where is X defined` / `defines X` lane. `where did you learn that` looks
up a module called `learn`.

### 1.5 The cold tools and `tmct serve` do not see what chat answers from

Severity: medium. Two documented surfaces miss a term the third one answers, on the same `--repo`.
The catalog invocation in `.tmct/TOOLS.md` is meant to be copy-pasted, so a user hits this on their
first try.

```
$ node bin/tmct.mjs cli tmct_ask '{"query":"what is a dog","repo_path":"/tmp/scratch"}'
"dog" isn't a term in this graph's own vocabulary (no matching class or predicate).
…"miss": true

$ node bin/tmct.mjs serve --repo /tmp/scratch --port 8791 &
$ curl -s -X POST http://127.0.0.1:8791/v1/messages -H 'content-type: application/json' \
    -d '{"model":"tmct","max_tokens":256,"messages":[{"role":"user","content":"what is a dog"}]}'
…"dog" isn't a term in this graph's own vocabulary…

$ printf 'what is a dog\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/scratch
tmct> dog is a kind of animal (source: corpus:human /r/IsA)
```

Both misses are honest, so this is not a guess. It is a knowledge gap between surfaces: `cli` and
`serve` read the code graph, chat also reads the memory store.

---

## 2. Teach, recall, retract

### 2.1 `forget X is a Y` stores a fact when the fact is not there

Severity: high, second only to finding 1. A retraction that was meant to remove data writes new data
instead, the confirmation reads like success, and the junk row carries trust 0.97. It happens on the
plainest possible path: retract twice, or mistype the name.

```
$ printf 'forget Bertha is a baker\nwhat is a Bertha\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/fresh
tmct> noted — remembered: forget bertha is a kind of baker

Goal (inferred): Teach/remember a new fact.
"Bertha" isn't a term in this graph's own vocabulary (no matching class or predicate).
```

`tmct memory` confirms the row landed:

```
  forget bertha rdfs:subClassOf baker — trust 0.97, 1 source: teach:chat:<session>@…
```

Expected: `"bertha is a kind of baker" isn't stored, so there's nothing to forget` — the wording the
lane already produces when the fact belongs to someone else.

Fault: `src/services/chat.mjs:4852`. `RETRACT_FORGET_RE` matches and `retractSubClassOf` runs, but the
`found:false` branch falls through to the rest of the cascade. The free-form teach frame then reads
`forget bertha` as a two-word subject and stores it. The subject group in
`RETRACT_FORGET_RE` (`chat.mjs:4331`) allows one or two words, which is why the two shapes diverge:
`forget bertha …` has a two-word teach subject available, `forget that bertha …` has a three-word one
and cannot match the teach frame.

### 2.2 `forget that X is a Y` twice hits the parse wall

Severity: medium. Same root cause as 2.1, different landing. Retracting something already gone is
ordinary user behaviour and the second attempt gives no clue what happened.

```
$ printf 'remember Mira is a baker\nforget that Mira is a baker\nforget that Mira is a baker\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/fresh
tmct> noted — remembered: mira is a kind of baker
noted — forgotten: "Mira is a kind of baker" is no longer stored.
I couldn't read that as a question I can answer. Try "what is a dog" for general vocabulary. …
(this repo has no code graph — index it with `tmct index` …)
```

Expected: "that isn't stored" on the second attempt.

### 2.3 A plural object outside the closed lexicon is never singularised

Severity: high. The user teaches a fact and the very next turn is told the fact is not known. Nothing
in the transcript explains why, and the stored data is wrong.

```
$ printf 'all foxes are mammals\nis a fox a mammal\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/fresh
tmct> noted — remembered: fox is a kind of mammals

Goal (inferred): Teach/remember a new fact.
I can't confirm that — nothing I remember says fox is a mammal. I do know: you told me: fox is a kind
of mammals … If it's true, teach me: "fox is a kind of mammal".
```

The subject folds to `fox`; the object stays `mammals`. So `mammal` and `mammals` become two classes.
With a lexicon word in the object slot it works: `all badgers are animals` stores `badger
rdfs:subClassOf animal` through the ACE lane.

`tmct extract` carries the same split:

```
$ node bin/tmct.mjs extract /tmp/every.txt
{"subject":"badger","predicate":"rdfs:subClassOf","object":"mammals", …}
```

Fault: `src/services/chat.mjs:4032-4039`. `assertCandidates` builds the singularised rewrite (`every
fox is a mammal`) and adds it to the candidate list, but that candidate still has to parse against the
closed lexicon. When it does not, the free-form teach fallback stores the raw payload with the plural
intact.

### 2.4 The "did you mean" repair offers an ungrammatical sentence

Severity: low, but it sits on the same path as 2.3 and would be fixed by the same singularising.

```
$ printf 'all lynxes are mammals\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/scratch
tmct> I couldn't store that — I don't recognize "mammal" as a word I know … Did you mean:
"every lynx is mammals"? Type /memory to see what I already remember.
```

The same sentence names the missing word as `mammal` and then suggests `mammals`.

### 2.5 `/help` never mentions how to retract

Severity: medium. Retraction is a data-destroying operation with exactly one accepted phrasing, and
`/help` lists 25 commands without it. `/retract` is not a command (`unknown command /retract`), so a
user who wants their fact gone has no route from the help text.

```
$ printf '/help\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/scratch | grep -i forget
(no output)
```

The phrasing is `forget that X is a Y`, documented only in a source comment
(`src/services/chat.mjs:4325`) and in one teach-miss reply.

### 2.6 Provenance follow-ups dead-end

Severity: medium. Grounding is the pitch, so "how do you know" is a predictable next line. Four
common phrasings get the orientation blurb or the parse wall.

```
$ printf 'what is a dog\nwhy\nprove it\nhow do you know\nwhat is your source\nare you sure\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/scratch
```

- `why` works: `(expanding: what is a dog)` plus `traversal: schema lookup for "dog"`.
- `prove it` and `are you sure` return the tmct self-description.
- `how do you know` and `show your working` return the parse wall.
- `what is your source` treats `your source` as a vocabulary term to be taught.

### 2.7 "do you ever make things up" misses the honest-miss lane

Severity: medium. The closed set at `src/services/chat.mjs:1344-1348` covers `make something up`,
`make stuff up` and `make up an answer`, and answers those well. `make things up` is not in it.

```
$ printf 'do you ever make things up\ncan you make up an answer if you dont know\njust guess anyway\n/exit\n' \
    | node bin/tmct.mjs chat --repo /tmp/scratch
tmct> I couldn't read that as a question I can answer. …
No — I never make up an answer. If a question doesn't ground to a taught fact or a real graph
entity, I say so plainly instead of guessing. /help for commands.
still the same overview — /help lists every command and query shape.
```

The middle answer is the one all three should get.

---

## 3. Phrasing near-misses

All of these are declines, so none is a guess. They are listed because each is a sentence a person
would plainly write about a term the graph already holds. Severity: medium as a group, low
individually.

Tested against `dog`, which the seeded corpus knows.

| input | result |
| --- | --- |
| `what is a dog` | answers |
| `what does dog mean` | answers |
| `whats a dog` | answers |
| `can you tell me what a dog is` | answers |
| `what really is a dog` | answers |
| `so what is a dog` | answers |
| `what kind of thing is a dog` | answers |
| `tell me about a dog` | answers |
| `tell me about dogs` | parse wall |
| `what exactly is a dog?` | parse wall |
| `what is a dog again` | miss on the term `dog again` |
| `define dog` | code-module lane (see 1.4) |
| `does a dog have wings` | parse wall |

`what exactly is a dog?` is the sharpest of these: `really` is tolerated as filler and `exactly` is
not. `tell me about dogs` fails only on the plural; the singular works. `does a dog have wings`
deserves the `I can't confirm that` wording its siblings get (`can a dog fly` and `is a dog a fish`
both answer that way).

---

## 4. Games

### 4.1 Spider and fly gives a first-time player no way to advance

Severity: medium. This is a documented headline feature and the opening turn is a dead end.

```
$ printf 'play spider and fly\nnext\nwho is winning\n/exit\n' | node bin/tmct.mjs chat --repo /tmp/fresh
tmct> a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to
move. Watch, or address one by name in chat.
I'm tmct — a deterministic, offline chat assistant (no LLM). …
still the same overview — /help lists every command and query shape.
```

The word that advances the board is `tick`, and it appears only on re-entry:

```
tmct> back to the spider-and-fly board — the spider and fly are already in play. Say "tick" to
advance, or address one, e.g. "@spider the fly is east".
```

Expected: the opening line names `tick` too.

### 4.2 Mid-game words leak to the vocabulary lane

Severity: low, but it breaks the game frame and reads as the assistant losing track.

Guess-the-number, tmct holding the secret. `higher` gets the correct nudge; `lower` does not:

```
tmct> Done — I've thought of a number between 1 and 100. …
we're mid-game — you're guessing my number between 1 and 100. Guess a number — or "I give up" to stop.
i learned: lower means the same as cut (source: child:conceptnet:lower)
```

Spider and fly, mid-board: `watch` returns `watch is used for telling time`, and `step` returns four
ConceptNet facts about steps.

Adventure, mid-game: `help` and `xyzzy` both return the tmct self-description instead of anything
in-world.

### 4.3 The adventure describes an object that is not there

Severity: low. Reads as confirmation that a thing exists.

```
tmct> (in the library)
$ look at the door
nothing more about the door is written down yet.

Goal (inferred): Take a closer look at the door.
```

There is no door in the world model. Expected wording along the lines of "there's no door here".

---

## 5. Flags and non-chat verbs

### 5.1 `--repo <path that does not exist>` silently creates a repo

Severity: medium. A typo in a path produces a new directory, a `tmct.toml`, a `.tmct/` tree and 688
seeded facts, with no warning, and the answer comes back as if the repo were the intended one.

```
$ node bin/tmct.mjs chat --repo /tmp/scratch/typo-repo --prompt "what is a dog"
dog is a kind of animal (source: corpus:human /r/IsA)
…
$ ls -a /tmp/scratch/typo-repo
.  ..  .tmct  tmct.toml
```

If the parent is also missing, it fails with a raw Node error instead:

```
$ node bin/tmct.mjs chat --repo /nonexistent/path/xyz --prompt "what is a dog"
tmct: ENOENT: no such file or directory, mkdir '/nonexistent'
```

Expected: say the path does not exist and ask before scaffolding, or at least name what was created.

### 5.2 `--render sprites` prints eleven esbuild warnings

Severity: cosmetic. The command works and the page is written. The user sees a wall of
`"import.meta" is not available with the "iife" output format` before the one line that matters.

```
$ node bin/tmct.mjs chat --render sprites --output /tmp/sprites.html
… 11 warnings …
wrote /tmp/sprites.html (7892 KB, self-contained)
```

### 5.3 `tmct extract` gives the wrong reason for a skip

Severity: low. The summary blames the sentence shape when the real reason is that neither term is
grounded.

```
$ node bin/tmct.mjs extract /tmp/every.txt      # "A wombat is a marsupial."
3 sentences found, 1 recognized as fact (1 fact row), 2 skipped — not a recognized declarative
shape (an honest, expected gap; this is an attempt, not full NLU).
```

`A wombat is a marsupial.` is the same shape as `A kestrel is a bird.`, which is recognised. The
difference is that `bird` is in the vocabulary and `marsupial` is not. The chat lane explains this
properly; extract does not.

---

## 6. What works

Listed so the coordinator can weigh the faults above against the rest of the surface.

**The refusal wording, nearly everywhere.** Ungroundable questions came back as clean misses that
name the missing term and offer a teach phrasing:

```
$ printf 'what is the capital of Latvia?\nwhat is a florblenaut?\n/exit\n' | node bin/tmct.mjs chat …
tmct> I don't know a relation or rule called 'capital' yet.
"florblenaut" isn't a term in this graph's own vocabulary (no matching class or predicate).
I don't know "florblenaut" yet — teach me directly …
```

`is a dog a fish`, `can a dog fly` and `is a dog bigger than a cat` all decline with `I can't confirm
that`, name what they do hold, and offer the sentence that would settle it.

**Contradiction handling is the best thing on the surface.** Teach a fact, negate it, then ask:

```
tmct> noted — remembered: nils is a kind of baker
noted — remembered: nils is not a kind of baker — you told me earlier that nils is a kind of baker,
so both are now stored and I'll report the disagreement rather than pick one. To drop the earlier
fact instead, say "forget that nils is a baker".
…
$ is Nils a baker
you've told me both, and I won't pick between them — you told me: nils is a kind of baker (source:
teach:chat:…); you told me: nils is not a kind of baker (source: teach:chat:…). To settle it, say
"forget that nils is a baker".
```

Two compatible facts (`Mira is a baker`, then `Mira is a pilot`) accumulate and both are cited with
their timestamps, which is the right open-world behaviour.

**Retracting what you did not teach.** `forget that dog is a animal` against a corpus fact:

```
"dog is a kind of animal" isn't something you taught me — it's on record from elsewhere, so there's
nothing of yours to forget.
```

**Two-hop entailment, and the honest stop at three hops with a working remedy.**

```
$ is socrates a mortal
yes — socrates is a kind of man (source: teach:…); man is a kind of mortal (source: teach:…);
so socrates is a mortal
$ is socrates a thing
I can't confirm that … The facts to settle it are here, but the chain is longer than I follow while
answering. Run "/syllogise socrates", then ask me again.
$ /syllogise socrates
derived 5 entailed fact(s) … socrates subClassOf thing (via mortal) …
$ is socrates a thing
yes — i learned: socrates is a kind of thing (source: entailed:subClassOf)
```

**The README's headline walkthrough.** `tmct init`, `tmct import --file
.tmct/imports/games/hanoi-3.txt` (19 taught, 0 declined), then the `--prompt … solve it --render
blocks` line all ran as printed and produced the optimal 7-move plan plus the page.

**The README's plan example.** `tmct plan "of the modules impacted by src/lib/http.mjs, which are
untested" --repo examples/mini-webapp` matched the documented output, both steps and the composed
answer.

**The code lane over a real graph.** Against `examples/mini-webapp` and a freshly indexed tree,
`/untested`, `/stats`, `list modules`, `which functions call X` and `what does X import` all answered
or refused precisely, including a good near-miss repair:

```
$ what does src/app.js import
no module matching "src/app.js" found in the index. "src" and "js" name nothing here, and reading
past them would answer a different question. Did you mean app.mjs and test/app.test.mjs?
```

**Guess the number, tmct guessing.** Found 65 in five guesses, with the live interval reported each
turn.

**The adventure.** `play ashcombe hall`, `look`, `where am I`, `go north`, `inventory`, `take the
lamp` and `stop playing` all behaved, including declining to take an item from another room.

**Research.** `research aardvark limit 2` fetched, cited the article with its oldid and licence,
stored one fact, queued two topics, and `research stop` reported what it dropped.

**`tmct index`, `tmct digest`, `tmct viz`, `tmct syllogise`, `tmct memory --export`, `/ingest`,
`/export`.** All ran clean and reported what they did.

**Input robustness.** Blank lines, whitespace-only lines, a bare `/`, `/bogus`, `?` and `!!!` all
handled without a crash. Unknown verbs exit 2, `tmct extract` with no argument exits 1, an invalid
`--memory-backend` exits 2 and names the choices. `tmct serve` returns a 400 with a typed error for a
malformed payload.

---

## Reproduction notes

Worktree setup before any of the above:

```
node scripts/ensure-worlds-pack.mjs
node scripts/ensure-sprite-facts.mjs
npm run build:ask-bundle
```

Every `/tmp/scratch` path above is a throwaway directory. Some findings depend on whether the target
repo has a graph file:

- "no graph file yet" is a first-ever chat in an empty directory.
- "a graph with no code entities" is any directory a chat session has already written to, or one
  `tmct init` has scaffolded. Finding 1.1 needs this state.
- "a code graph" is `examples/mini-webapp`, or any tree `tmct index` has run over.
