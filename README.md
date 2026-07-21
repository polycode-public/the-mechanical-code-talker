# tmct — The Mechanical Code Talker

`@polycode-projects/the-mechanical-code-talker`

A pure-JS, **no-LLM**, offline, **$0** chatbot in the ELIZA/PARRY lineage.
It is pattern-driven and focused on software, and it makes no model calls.

tmct turns natural language directly into a graph database. On first run it
seeds an everyday **human-world persona**: people, places, objects, nature,
time. It already has a vocabulary before you teach it anything. A
code-focused persona is available as an opt-in alternative: a software
**ontology** (real definitions), a **lexicon** (everyday words mapped onto
it), and a wider ConceptNet **corpus**. Point tmct at a real codebase's graph
and it reasons over that too, whichever persona is active.

Teach it a fact in plain English and it mints a node. Ask it a question and
it answers from what it was seeded with, what you taught it, and what it can
derive by rule from both. Every answer is either grounded or an honest miss.

## Teach it, then ask it to reason

This is real, runnable output. No cherry-picking, no model anywhere in the
loop. The script lives at `examples/teach-and-infer.mjs` in this repo; run it
yourself with `node examples/teach-and-infer.mjs`, or copy the source below:

```js
import { runChat } from "@polycode-projects/the-mechanical-code-talker";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEACH = [
  "ahab is the father of john",
  "john is the father of ishmael",
  "a father is a kind of parent",
  "remember that ahab is male",
  "a grandparent is a parent of a parent",
  "a grandfather is a grandparent who is male",
];
const ASK = "is ahab the grandfather of ishmael";

// memoryBackend: "memory" keeps this whole session in the live handle only —
// no repo, no graph file, no disk write.
const repoPath = await mkdtemp(join(tmpdir(), "tmct-example-"));
const output = new PassThrough();
let transcript = "";
output.on("data", (chunk) => { transcript += chunk; });
const lines = [...TEACH, ASK].map((line) => line + "\n");
await runChat({ repoPath, memoryBackend: "memory", input: Readable.from([...lines, "/exit\n"]), output });
```

(`examples/teach-and-infer.mjs` adds the parsing that turns `transcript` into
the answers below, plus cleanup — see the file for the full script.)

Output, captured from an actual run:

```output cmd="node examples/teach-and-infer.mjs" cwd=repo
tmct> ahab is the father of john
noted — remembered: ahab fathers john

Goal (inferred): Teach/remember a new fact.

tmct> john is the father of ishmael
noted — remembered: john fathers ishmael

Goal (inferred): Teach/remember a new fact.

tmct> a father is a kind of parent
noted — remembered 1 fact: father rdfs:subClassOf parent (father is a type of parent)

Goal (inferred): Teach/remember a new fact.

Canonical: does "father" inherits "parent"? — ask(inherits, subject="father", "parent")

tmct> remember that ahab is male
noted — remembered: ahab is male

Goal (inferred): Teach/remember a new fact.

tmct> a grandparent is a parent of a parent
noted — remembered: a grandparent is a parent of a parent

Goal (inferred): Teach/remember a new fact.

tmct> a grandfather is a grandparent who is male
noted — remembered: a grandfather is a grandparent who is male

Goal (inferred): Teach/remember a new fact.

tmct> is ahab the grandfather of ishmael
yes — you told me: ahab fathers john (source: teach:chat:<session-id>@<timestamp>); father is a kind of parent (source: ace:chat:<session-id>@<timestamp>); you told me: john fathers ishmael (source: teach:chat:<session-id>@<timestamp>); you told me: ahab is male (source: teach:chat:<session-id>@<timestamp>)
```

Nobody told tmct that ahab is ishmael's grandfather. It combined four facts
taught across six turns: the two father facts, the father-is-a-kind-of-parent
alias, and the ahab-is-male property, then cited all four. The `source: …`
parts are real provenance receipts. Every fact tmct stores records where it
came from and when (more on that below).

The test suite replays every runnable example in this README against the
live product, this transcript included. Every line shown must be a line the
product prints, in the order shown, so if the chat behavior drifts from the
output above, the suite fails and says so. Two blocks below are marked `skip=`
and never run: one would touch the network, the other needs an LLM judge.
`docs/public-examples.md` maps every example on every public surface to the
test that holds it.

Point it at a codebase's graph and the same engine answers structural questions.
`examples/mini-webapp` ships in this repo, so this runs as written:

```session cwd=repo
$ node bin/tmct.mjs chat --repo examples/mini-webapp --ephemeral
tmct> what does app.mjs talk to?
src/server/router.mjs and src/handlers/tasks.mjs and src/handlers/users.mjs and src/lib/logger.mjs.
tmct> what talks to store.mjs?
src/handlers/tasks.mjs and src/handlers/users.mjs.
tmct> /exit
```

**[Try it live in your browser →](https://polycode-projects.gitlab.io/the-mechanical-code-talker/)**
runs the actual query engine client-side. No server, no install. The landing
page answers codebase questions live, and six more pages each ground their
own domain: a full chat seeded with 19,228 facts (the same nine bands as
`npm run init:xl`, capped to a 22.8 MB download), the **memory ledger**
(every fact as a readable sentence; drill by clicking the terms inside), a
Towers-of-Hanoi plan replayed move by move, the spider-and-fly and
text-adventure games, and a sprite gallery whose chat dock answers from
1,033 generated sprite facts.
The site hosts its own copy of wink-nlp, ships its assets precompressed,
and a service worker precaches the big ones, so a second visit works
offline. `tmct chat --render spider-fly|adventure|sprites [--output <path>]`
writes any of the three view pages as one self-contained file.

From a clone, two build scripts regenerate that demo so you can check it
offline before it deploys. The example graph, the chat seed, the pages, and
the engine copy land in `public/`. The in-page chat's query bundle is rebuilt
from the same `src/` the CLI runs:

```bash e2e cwd=repo
npm run demo:build        # public/: demo graph, memory, ledger page, engine copy
npm run build:ask-bundle  # the browser query bundle the in-page chat runs
```

Two more surfaces, both generated by tmct itself:

```bash e2e
npx tmct viz                          # ledger.html — your own memory as the same
                                      # readable, self-contained explorer
npx tmct init
npx tmct import --file .tmct/imports/games/hanoi-3.txt
npx tmct viz --focus disk-1 --output disks.html   # the explorer again, focused on one term
npx tmct chat --prompt 'disk-1 rests on disk-2. disk-2 rests on disk-3.
  disk-3 rests on peg-a. the goal is that every disk rests on peg-c. solve it.' \
  --render blocks --output plan.html  # an animated replay of the solved plan
```

More on the game file and the planner under "Teach it a game" below.

## How it interprets you

Every message runs through **multiple concurrent interpretation strategies**:
a grammar parse, keyword picking, noise-word removal, fuzzy matching. Their
results are grouped by class.

One of the strategies is an **ACE-inspired controlled grammar**: when your
text fits the controlled fragment, tmct emits OWL-labelled triples from it.
Those triples are statements it can store, retrieve, and answer from later.
Text that doesn't fit the grammar still gets the tolerant strategies. Nothing
is rejected for being loose, fuzzy, or misspelled.

On top of that base, tmct reads the shapes people actually use, and each one
resolves to a real graph traversal or declines cleanly:

- everyday question forms: "what is Commit", "what's model.mjs for",
  "recent commits" as real dated history;
- polite or indirect framing: "I'd like you to remember X" teaches like bare
  "remember X";
- negation as a bounded **set complement**: "which modules do *not* import
  X?", with an empty result staying a miss, never a fabricated list;
- reversible passives: "what is imported by Y" and "what does Y import" are
  opposite edges, not the same one;
- finding by description: "find me the payment class" checks the type and
  its subclasses first, and says so plainly when it widens;
- comparison: "compare TaskController and UserController" lines up both
  entities' real edges side by side, never a hand-written diff;
- list follow-ups: after "which modules import src/core/model.mjs",
  "which of those are tested" resolves against that list;
- curated synonyms plus a filtered ConceptNet slice, clause openers
  (*because/although/while*), conditionals, and false-premise flags ("why
  does X still import Y" when it no longer does).

The full catalog with measured coverage lives in `CAPABILITIES_2.7.12.md` and
the `BENCHMARK_*.md` reports.

**Response finishing.** Before an answer prints, it is segmented into typed
spans: prose versus *protected* entities, paths, numbers, code, provenance,
and receipts. A small data-driven grammar pass runs on the prose spans only,
under a guard that proves the protected spans came through byte-for-byte.

A frozen regression suite plays out full multi-turn dialogues built from these
phrasings, from a single question up to a messy, typo-ridden real user.
Tier-by-tier detail is in `HANDOVER.md`.

## How it guides you

When you touch a **concept** without asking a precise question, like "what is a
class", "what about imports", or "what calls are there", tmct answers in three
bands instead of dead-ending:

1. the **definition** (a plain-English one-liner: *"A class is a template that
   defines the structure and behaviour of objects."* / *"To import is to bring
   another module's definitions into the current one."*);
2. **real instances from your graph**: *"In this codebase, for example: Record,
   Task and User (10 classes)"*, or actual edges *"src/core/store.mjs imports
   src/core/model.mjs (18 import edges)"*;
3. **guided follow-ups**: two or three concrete next questions, each one
   *pre-checked against your graph* so every suggestion is guaranteed to resolve:
   *"Want to go deeper? Try: which classes inherit from Record / what does Task
   contain / where is User defined"*.

It fires for both **noun** concepts (class, module, function, method) and
**relation** concepts (imports, calls, contains, inherits, tests), and only
when tmct knows the concept and has instances of it. Otherwise the honest miss
stands. This lets you start from a vague opener and still reach a useful
answer. Natural phrasings are routed to the capability you meant: *"what
functions are in Task"* → its members, *"what defined saveStore"* → where
it's defined.

## Detailed, grounded answers

Ask a precise question and tmct gives you a precise answer. Ask for more and
it gives you more: "give me a detailed summary of how X works" (or "explain
in detail how X works", or "...detailed overview/explanation of X") gets a
longer, multi-sentence account instead of one line. Every sentence in it is
lifted from a real graph edge, attribute, or taught fact. tmct never generates
free text.

The wording varies a little too. A small, curated, deterministic pool swaps a
handful of connector words, like "defined in", "located in", or "found in".
The same fact doesn't read identically for every entity, but the same
question against the same entity always renders the same way.

```session cwd=repo
$ node bin/tmct.mjs chat --repo examples/mini-webapp --ephemeral
tmct> give me a detailed overview of how the Store works
Attribute: prose_tokens = memory record store [mgx:hasProseTokens]. Attribute: doc = In-memory record store. [seon:hasDoc]. Other matches: src/core/store.mjs (Module), loadStore (Function), saveStore (Function), testLoadStore (Function).
```

Programmatically, the same pipeline is `generateCompletion()`
(`src/domain/completions/complete.mjs`):

```js cwd=repo
import { fetchEntities } from "./src/adapters/source.mjs";
import { parseEntities } from "./src/domain/codegraph.mjs";
import { loadMemory } from "./src/adapters/memory/core.mjs";
import { createCompletionsGraphAdapter } from "@polycode-projects/the-mechanical-code-talker/createCompletionsGraphAdapter";
import { generateCompletion } from "@polycode-projects/the-mechanical-code-talker/generateCompletion";

const dir = "examples/mini-webapp";
const graph = parseEntities(await fetchEntities({ graphFile: `${dir}/.tmct/graph.json` }));
const memory = await loadMemory(dir);
const graphService = createCompletionsGraphAdapter(graph, memory);

const { text } = await generateCompletion(dir, "Store", { query: "Store", graph, memory, graphService });
console.log(text);   // prints the same text as the chat answer above
```

## Planning across the graph

Some questions need more than one lookup. `tmct plan` is a small STRIPS/PDDL-style
planner over the same read-only graph-query tools chat/serve use
(`src/domain/router/*`): it decomposes a compound request, resolves and executes each
step in order with a provable causal-link proof chain, and folds the results
into one answer. A request neither the planner nor a single lookup can ground
escalates to a closed-world goal-reasoner, which deduces maintenance goals
(coverage gaps, change-coupling risk) straight from the graph — never from
keywords in your question. Anything none of that grounds is an honest "no plan
found", the same "grounded or an honest miss" rule as everywhere else in tmct.

```session cwd=repo
$ node bin/tmct.mjs plan "of the modules impacted by src/lib/http.mjs, which are untested" --repo examples/mini-webapp
tmct plan: "of the modules impacted by src/lib/http.mjs, which are untested"
driver: resolver-0.8.0

steps:
  1. tmct_impact {"module":"src/lib/http.mjs"}
     Impact of changing src/lib/http.mjs (reverse closure over imports/calls edges, module- and function-level):
     total: 5 dependent(s) across 2 depth level(s) (lists capped for brevity).
     depth 1 (3 direct dependents):
       - src/handlers/base.mjs (imports it) — tests: none recorded
       - src/handlers/tasks.mjs (imports it) — tests: test/tasks.test.mjs
       - src/server/router.mjs (imports it) — tests: none recorded
     depth 2 (2):
       - src/handlers/users.mjs (reaches it through an intermediary) — tests: none recorded
       - src/server/app.mjs (reaches it through an intermediary) — tests: none recorded
  2. tmct_untested {}
     7 source module(s) with no covering test module:
       src/core/validate.mjs
       src/handlers/base.mjs
       src/handlers/users.mjs
       src/lib/http.mjs
       src/lib/logger.mjs
       src/server/app.mjs
       src/server/router.mjs

composed answer (4): src/handlers/base.mjs, src/handlers/users.mjs, src/server/app.mjs, src/server/router.mjs
```

tmct planned two calls (`tmct_impact` then `tmct_untested`), ran both against the
real graph, and intersected the results itself — you get the four modules that
are both downstream of the change AND missing coverage, not two separate lists
you'd have to cross-reference by hand.

Leave the entity out and ask a maintenance question instead, and the goal-reasoner
picks up where the planner refuses:

```session cwd=repo
$ node bin/tmct.mjs plan "what most needs a test in this codebase" --repo examples/mini-webapp
tmct plan: "what most needs a test in this codebase"
driver: goal-0.8.1
...
composed answer (1): src/lib/http.mjs
```

It deduced the goal ("an impactful module must be tested"), gathered every
untested module, ranked each by blast radius, and named the one worth testing
first — `src/lib/http.mjs`, the module with the widest reach.

`--tools tmct_impact,tmct_untested` restricts which capabilities the planner is
allowed to use; `--json` prints the full machine-readable loop result (calls,
proof chain, composed answer) for a caller that wants to consume this
programmatically rather than read the report. `tmct plan --help` has the full
flag reference.

## Teach it a game, then ask it to plan

The planner above works over a fixed toolset. This one works over rules you
teach. A game definition is a plain-text file of controlled English — the
classes, the pieces, the ordering, and the legal moves as taught action
rules — with `#` comment lines carrying example prompts. `tmct init`
scaffolds one at `.tmct/imports/games/hanoi-3.txt`, and
`tmct import --file` teaches it sentence by sentence, reporting every line
and refusing (exit 1) if any sentence declines.

Then one message states the board and the goal, and "solve it" searches the
taught rules for the shortest move sequence:

```session e2e setup="npx tmct init && npx tmct import --file .tmct/imports/games/hanoi-3.txt" cmd="npx tmct chat"
tmct> disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a. the goal is that every disk rests on peg-c. solve it.
plan found — 7 moves (shortest):
  1. move disk-1 onto peg-c
  2. move disk-2 onto peg-b
  3. move disk-1 onto disk-2
  4. move disk-3 onto peg-c
  5. move disk-1 onto peg-a
  6. move disk-2 onto disk-3
  7. move disk-1 onto disk-2

because — you taught me the "move onto" rule and 3 ordering facts. Say "next" to make move 1, or ask "what moves are legal now".

Goal (inferred): Plan a move sequence from the current state to the goal (7 moves).
```

"next" executes one move at a time, writing each board state into memory as
facts stamped with the step that produced them ("disk-1@step1 rests on peg-c",
sourced to the plan). The final step re-reads the store and confirms the goal
from those written facts, never assuming success. The stamp is what makes each
step a separate record; a question about the piece itself ("where does disk-1
rest?", "is disk-1 clear?") reads the current board — the latest step's facts,
not every step at once. The search is
domain-general: the test
suite teaches Towers of Hanoi purely as sentences for 1 to 8 disks and
asserts the plan is exactly 2^n − 1 moves every time, and a second game
(`crates.txt`, stacking crates with different rules and a two-goal
conjunction) solves with zero interpreter changes. `--render blocks` writes
the plan as a self-contained animated page (see "Two more surfaces" above).

## Play a game with it

Three games run inside an ordinary chat session, no setup.

**Guess the number.** Say `I'm thinking of a number between 1 and 100` and
tmct guesses by narrowing an interval — answer `higher`, `lower`, or
`correct`. It finds any number in at most 7 guesses, and if your answers
contradict each other it names the contradicting pair and stops rather than
guessing on. Say `think of a number` to swap seats: tmct commits to a secret
and answers your guesses honestly, reveals on request, and corrects you from
its own record if you claim it already said `correct`. The behaviour is
pinned by `test/corpus/games/guess-number.jsonl`.

**A text adventure.** Say `start the adventure` (or `play ashcombe hall`)
and tmct loads a small country-house mystery from a lazily-fetched worlds
pack (`corpus/worlds/`) into the session's ordinary memory graph — rooms,
objects and people become graph facts, and the verbs (`go`, `take`, `open`,
`unlock`, `look`…) are taught action rules, not hard-wired code. Every move
writes per-turn snapshot facts, `look` is an extractive digest of the graph,
a blocked action declines by name, and one of the household moves on its own
schedule whether you are there to see it or not. The full worked mystery is
pinned step by step in `test/corpus/games/adventure.jsonl`.

**Two agents, planning against each other.** Say `play spider and fly` (or
`watch the spider and the fly`) and tmct runs both sides itself — neither is
player-controlled. A spider hunts a fly across a 10×10 web; each side only
believes what it can currently see (`vision_radius`, tunable), a fly wanders
when nothing threatens it and evades when something does, a spider avoids
other spiders, chases what it believes it sees, and builds a web when it
holds position. Mass is real: both sides waste away each turn they don't
eat, and a spider gains exactly the mass of what it catches. You can address
either side directly (`@spider the fly is east`) to feed it a belief — true
or false — and watch a wrong assertion mislead it for as long as the real
target stays out of sight. `tmct.toml`'s `[games.spider-fly]` table tunes
every rate; the full mechanic is pinned in `test/corpus/games/spider-fly.jsonl`.

## Learning on a miss

A question tmct cannot ground is still an honest miss — but on the cleanest
kind of miss (a recognised word, a clean parse, simply no facts anywhere) it
now consults two shipped, lazily-loaded packs before giving up:

- `corpus/child/` — 93k everyday-world triples filtered from ConceptNet by a
  child-concept seed. Asked `what is a kettle` cold, tmct loads the term's
  triples into memory (provenance `child:conceptnet:kettle`, ranked below
  anything you teach) and answers from them; the next ask answers from
  memory directly.
- `corpus/reference/` — 3,887 Simple English Wikipedia summaries. When the
  triples cannot answer, a matching article answers as a cited read-out
  (`source: reference article "Otter"…, CC BY-SA 4.0`).

Facts first, prose second; if neither pack carries the term, the turn is the
same honest miss it always was, byte for byte. An unknown word, a parse
failure, or an ambiguous reading never consults a pack at all. The gate and
both fallbacks are pinned by `test/corpus/reference.jsonl` and the
chat-lane tests beside it.

Live Wikipedia is the opt-in third tier, off by default. Turn it on with
`/wiki on` in a session, `--live-wikipedia` on the command line,
`TMCT_LIVE_WIKIPEDIA=1`, or `tier = "tier3"` under `[corpus]` in `tmct.toml`.
The browser chat page has the same switch ("ask Wikipedia when I don't
know"). When it is on and both shipped packs miss, tmct makes two requests
to en.wikipedia.org (a title search, then the page summary) and answers as a
cited read-out, CC BY-SA, pinned to the revision it read (provenance
`reference:wikipedia-live:<Title>@<revid>`). A failed lookup (no matching
title, a timeout, a rate limit) leaves the honest miss byte-identical.

## How it remembers

tmct's memory has two layers, both fed by every parsed request and response and
by cleaned session logs:

- an **always-loaded OWL-labelled graph** on disk under `.tmct/`, a SQLite
  file by default (local artifact, never committed);
- **text blocks under a PageRank-style index**, pulled into context on
  relevance rather than loaded wholesale.

With no graph at all, tmct starts empty and remembers what you tell it. The
`.tmct/` graph is created from the conversation. On a first run it seeds the
committed vocabulary so it knows what it's talking about from turn one: an
everyday **human-world** persona covering people, places, objects, nature,
time and events, body and food, and mind vocabulary. It's hand-curated from
Open English WordNet and bridged to Schema.org's top-level classes, so "what
is a dog?" answers offline, from disk, on turn one. A code-domain persona (a curated **SEON**
software ontology plus the whole filtered **ConceptNet slice**, CC-BY-SA 4.0)
is available opt-in: `tmct init --with-persona code`. `--ephemeral` (used by
the shipped `npm run example:*` demos) reads a graph but writes nothing back.

The default persona also comes in three sizes: Small (~664 facts, the
default), Medium (~1,608, `tmct init --persona-size medium`) and Large
(~13,609, `--persona-size large`, deep enough to chain real multi-hop
reasoning).

### Memory backends

The default backend persists taught facts to a local SQLite file
(`.tmct/memory/graph.sqlite`). A second backend, `memory`, keeps them in the
process only and writes nothing to disk. `tmct init --memory-backend <name>`
writes the choice into `tmct.toml` and every later `tmct chat` in that repo
picks it up. Precedence is `--memory-backend` flag > `TMCT_MEMORY_BACKEND`
env > tmct.toml's `[memory] backend` > the sqlite default. A library caller
sets the same thing directly: `runChat({ memoryBackend: "memory" })`.

Three init presets in `package.json` wrap the common setups. What each one
runs (`--force` re-initializes the same directory):

```bash
npx tmct init                                # npm run init:sqlite — sqlite is already the default backend
npx tmct init --force --with-persona human   # npm run init:persona:human — the default persona, made explicit
npx tmct init --force --with-persona empty   # npm run init:persona:empty — no seeded vocabulary at all
```

Teaching isn't limited to the ACE grammar's fixed shapes. Tell tmct an
arbitrary fact, like "margo really eats ribs", and it mints a fact you can
ask about directly: "what does margo eat". New vocabulary compounds as you
teach: "redis is a cache" mints "redis" even though it was never in the
built-in lexicon, as long as one side of the sentence is already grounded —
tmct never mints a fact between two totally ungrounded terms; it declines and
nudges you to ground one side first. Quantified teaching stores the
quantifier ("some functions are risky" … "how many functions are risky" →
"A few."), and "how many facts are there" counts the store back.

Teaching doesn't have to be typed, either. `tmct extract` runs a plain text
file through the same recognizer the chat's teach lane uses. Sentences the
recognizer grounds become fact rows; everything else is skipped and counted,
never paraphrased. Add `--repo <abs>` to write them into that repo's own
memory; without it nothing on disk is mutated and the facts print as JSONL:

```bash cwd=repo
printf 'We deployed redis last week. a cache is a kind of store. Why was it slow?\n' > /tmp/notes.txt
node bin/tmct.mjs extract /tmp/notes.txt
```

```output
{"subject":"cache","predicate":"rdfs:subClassOf","object":"store","provenance":"extracted:notes.txt","quantifier":"","sentence":"a cache is a kind of store."}
3 sentences found, 1 recognized as fact (1 fact row), 2 skipped — not a recognized declarative shape (an honest, expected gap; this is an attempt, not full NLU).
```

Pass `--repo <path>` instead to write the recognized facts straight into
that repo's memory, or `--out <file.jsonl>` to save the rows. Each one
carries an `extracted:<file>` provenance tag at its own trust tier.

### Provenance and trust

Every fact and text block records **where it came from and when**. Sources are
first-class individuals: operator chat, a curated corpus, a provider graph, a
web scrape, a rule-derived entailment. A fact links back to *all* of them
(`mgx:derivedFrom` / `mgx:statedBy` / `mgx:canonicalisedFrom`), timestamped with
`mgx:createdAt`. From those links tmct computes a **deterministic, explainable
trust score**, combining a source-type prior with corroboration (how many
independent sources agree) and recency. It is never hand-set. Every value
traces back to its inputs. Retrieval then ranks by **relevance × trust**, so a corroborated,
operator-stated fact outranks a lone web scrape on the same question. When two
trusted sources *disagree*, the `/memory` inspector shows **both sides with their
provenance** rather than silently picking a winner.

### Speculative inference (a maintenance job, not a chat cost)

`tmct syllogise [--depth n] [--budget n]` is an offline, bounded, deterministic
batch: a forward-chaining materialisation over the memory's OWL 2 RL rule
kernels (the classical syllogism is one of them, and the verb keeps Aristotle's
broader sense; see the bibliography) that writes new **entailed** facts. They
are low-trust and retractable, never outranking a stated fact, and this never
runs on the chat's hot path.

## Install & use

```bash skip=network
npm install -g @polycode-projects/the-mechanical-code-talker
tmct                                  # bare = chat (the headline)
tmct chat --repo /abs/path/to/repo    # chat over a specific repo's graph
tmct init                             # scaffold .tmct/, tmct.toml, seed + provenance
tmct syllogise                        # offline: pre-derive entailed facts (maintenance)
npm run viz && open ledger.html       # self-contained HTML memory-ledger explorer
```

Inside the chat: `/help` lists commands, `/memory` inspects what tmct remembers
(grouped by OWL class, with provenance and any contradictions), `/exit` leaves.
`TMCT_GRAPH_FILE` overrides the graph location.

`tmct --help` (or `npm run help` from a clone of this repo) is the full,
up-to-date flag reference for every subcommand. A bare `npm run` only lists
script names, so `npm run help` is the documented way in from there.

`tmct init` is the onboarding surface for the repository interface below: it
creates the `.tmct/` directory, writes the externalized `tmct.toml`
configuration, seeds the default persona, and records provenance. A host
package or a bare user gets a working install in one command.

> Install-size note: tmct depends on wink-nlp's deterministic English language
> model (~3.8 MB installed). That model is a lookup table, not an LLM.

### Full command reference (`tmct --help`)

`tmct --help` always prints the real, current flags. What follows is that
same output, split into one block per command with a short note on what each
one is for, so it is easier to scan than the raw dump.

Every subcommand shares one flag/config resolver (`src/services/cli-args.mjs`), which
is why `--repo`, `--graph`, and `--config` behave the same way everywhere.

The bare command and `tmct chat` open the interactive session:

```output:help:chat
Usage:
  tmct                         interactive chat (the headline surface)
  tmct chat [--repo <abs>]     chat over a specific repo's graph
       [--graph <path>]        explicit graph file (repeatable — multiple graphs merge;
                               see src/adapters/graph-merge.mjs); wins over --repo/TMCT_GRAPH_FILE/tmct.toml
       [--config <path>]       an alternate tmct.toml location (a file or a directory)
       [--ephemeral]           read the graph but write nothing back (demo/read-only)
       [--prompt "<text>"]     one-shot: run the prompt's sentences as turns and print
                               the final answer (teach state first, trigger last)
       [--render blocks]       with --prompt: when the final turn produced a plan,
                               write it as a self-contained animated page
       [--render spider-fly|adventure|sprites]  write that demo view as one self-contained
                               page (no --prompt; the game pages inline their engine)
       [--output <path>]       the rendered page's path (default plan.html for
                               blocks, <archetype>.html for the views)
       [--narrate]             start with narrate mode on — a verbose, developer-facing
                               trace of decision points/matched pattern/results/goal per
                               turn, appended under a "--- narrate ---" marker (also
                               TMCT_NARRATE=1; toggle mid-session with /narrate on|off)
       [--live-wikipedia]      start with the live Wikipedia supplement on — a question
                               nothing local can answer also tries en.wikipedia.org,
                               cited (network; also TMCT_LIVE_WIKIPEDIA=1 or tmct.toml
                               corpus tier3; toggle mid-session with /wiki on|off)
       [--plain]               force the plain readline shell (the default when
                               stdin/stdout is not a terminal)
       [--memory-backend <default|memory|sqlite>]  storage backend for taught facts this
                               session (CLI flag > TMCT_MEMORY_BACKEND env > tmct.toml's
                               [memory] backend > sqlite, .tmct/memory/graph.sqlite)
```

`tmct memory` is the CLI-side view of the same data the `/memory` chat command shows:

```output:help:memory
  tmct memory [--repo <abs>]   what tmct remembers: facts, utterances, sessions,
       [--config <path>]       folded blocks (the /memory chat command, from the shell)
       [--verbose]
```

`tmct init` sets up a repo for the first time: `.tmct/`, `tmct.toml`, a seed, and a
provenance record. Most of its flags choose what gets seeded and where config is written:

```output:help:init
  tmct init [--repo <abs>]     initialize a repo for tmct (default: cwd): .tmct/,
       [--force]               tmct.toml, .tmct/TOOLS.md (the cold-tool catalog),
                               tier-1 corpus seed, provenance record
       [--corpus <id|path>]    also seed a corpus — a tier-2 manifest id (aws|python|java|
                               general) or a jsonl file path — opt-in, offline, $0
       [--ontology <name|path>]  activate+seed an ontology bundle (a recognized name or a path)
       [--lexicon <name|path>]  activate a lexicon bundle (recognized name or a path;
                               merged read-time, never seeded — see mergedLexiconExtra)
       [--graph <path>]        set graph_file/graph_files in tmct.toml (repeatable)
       [--config <path>]       write to an alternate tmct.toml location
       [--detect]              suggest a tier-2 corpus from the repo's manifests
                               (pyproject.toml → python, pom.xml → java); never seeds unasked
       [--with-persona <name>]  write an explicit [extensions]/[bias] preset into tmct.toml
                               ("code" — today's implicit default, made explicit)
       [--persona-size <medium|large>]  grow the default "human" persona's fact count
                               beyond Small (the default): "medium" activates
                               human-medium.jsonl (~1,608 facts total), "large" also
                               activates human-large.jsonl (~13,600 facts total,
                               with genuine multi-hop hypernym chains) — additive
                               size tiers of the SAME bundle, not separate personas
       [--memory-backend <default|memory|sqlite>]  write tmct.toml's [memory] backend
                               (same flag name as `tmct chat`) — a later `tmct chat`
                               in this repo picks it up with no flag needed
```

`tmct import` does the same activation as `tmct init`, but against a repo that is
already set up. Its `--graph` flag works differently from the others: it appends to
`tmct.toml`'s `graph_files` array instead of activating a bundle.

```output:help:import
  tmct import [--repo <abs>]   activate+seed into an ALREADY-initialized repo (any
       [--corpus <id|path>]    combination of these flags in one call). --graph is a
       [--ontology <name|path>]  DIFFERENT operation from the others: it APPENDS to
       [--lexicon <name|path>]  tmct.toml's graph_files array (multi-graph growth),
       [--graph <path>]        never an extensions-bundle activation.
       [--file <definition.txt>]  teach a plain-text definition file sentence by
                               sentence (# lines are comments); any declined
                               sentence exits non-zero with the sentence named
       [--memory-backend <default|memory|sqlite>]  same knob as `tmct init`
       [--config <path>]
```

`tmct extract` is the document route into memory described under "Teach it"
above — the same teach recognizer, reading a file instead of your typing:

```output:help:extract
  tmct extract <text-file>     read a plain text file's sentences through the chat's own
       [--file <text-file>]    teach recognizer and keep the facts it grounds; every
                               other sentence is skipped and counted, never paraphrased
       [--repo <abs>]          write the facts into that repo's own tmct memory; without
                               it nothing on disk is mutated and the facts print as JSONL
       [--out <file.jsonl>]    write that JSONL to a file instead of stdout
```

`tmct extend --validate` checks a third-party extension pack's declared resources
before you switch any repo's `tmct.toml` over to it:

```output:help:extend
  tmct extend --validate <dir>  validate a third-party extension pack's declared
       [--config <path>]       resources (corpus/lexicon/templates) before activating
                               it in any repo's tmct.toml; exits non-zero on failure
```

`tmct syllogise` is the offline maintenance job described under "Speculative
inference" above:

```output:help:syllogise
  tmct syllogise [--repo <abs>]  speculative inference (offline maintenance job): a deterministic
       [--depth <n>] [--budget <n>]  forward-chaining materialisation over OWL 2 RL rule kernels
       [--config <path>]       (the classical syllogism among them), writing bounded, low-trust,
                               retractable entailed facts (never on the chat path)
```

`tmct viz` renders the memory graph as the ledger explorer — a single,
self-contained HTML file you can open in a browser:

```output:help:viz
  tmct viz [--repo <abs>]      write one self-contained HTML page: the memory graph as a
       [--focus <term>]        readable ledger of fact-sentences around one focus term,
       [--term <word>]         with segments, a two-hop minimap, and an in-page chat dock
       [--limit <n>]           that answers from the embedded graph. Focuses on the newest
       [--output <path>]       taught fact's subject by default (--focus <term> or
       [--config <path>]       --term <word> override it); --output defaults to
                               ledger.html in the cwd; --limit caps the embedded fact
                               rows; --term resolves via the same normalization chat uses.
```

`tmct serve` runs an Anthropic Messages API-compatible HTTP endpoint over the graph,
so a tool-loop client can call tmct like a model, at $0:

```output:help:serve
  tmct serve [--repo <abs>]    run the Anthropic Messages API-compatible endpoint
       [--host <h>] [--port <n>]  (POST /v1/messages) over the graph — a deterministic,
       [--graph <path>]        no-LLM "model" a tool-loop client can call; $0 usage.
       [--config <path>]       Defaults: host 127.0.0.1, port 8787. Ctrl+C to stop.
```

A tool-loop client talks to it like any Messages endpoint. One round trip
against the example graph, end to end:

```bash e2e cwd=repo
node bin/tmct.mjs serve --repo examples/mini-webapp --port 8791 &
SERVE_PID=$!
until curl -s -o /dev/null http://127.0.0.1:8791/v1/messages; do sleep 0.2; done
curl -s http://127.0.0.1:8791/v1/messages -H 'content-type: application/json' \
  -d '{"model":"tmct","max_tokens":256,"messages":[{"role":"user","content":"which modules import src/core/model.mjs?"}]}'
kill $SERVE_PID
```

`tmct plan` is the capability router described under "Planning across the graph" above:

```output:help:plan
  tmct plan "<request>"        the capability router: compose/execute read-only graph-
       [--repo <abs>]          query tool calls for a compound or maintenance-goal
       [--graph <path>]        request ("of the modules impacted by X, which are
       [--config <path>]       untested", "what most needs a test") — a real STRIPS/
       [--tools <a,b,...>]     PDDL planner (src/domain/router/*), never a guessed call.
       [--json]                Prints the grounded step sequence + composed answer,
                               or an honest "no plan found". --tools restricts the
                               declared toolset; --json prints the full loop result.
```

`tmct cli` is a lower-level, carry-over surface for invoking a graph tool directly:

```output:help:cli
  tmct cli <tool> '{…}'        invoke a graph tool directly (carry-over, de-emphasized)
       [--repo <abs>]          the repo to answer from; the payload's "repo_path" says
       [--graph <path>]        the same thing. --graph names the graph file outright
       [--config <path>]       (repeatable), --config an alternate tmct.toml
  tmct cli digest '{…}'        architecture map + per-module context bundles
```

Two precedence chains apply across every command above, in this order:

```output:help:precedence
Shared graph-path precedence (chat/serve/cli; see src/services/cli-args.mjs): --graph flag(s) >
TMCT_GRAPH_FILE env > tmct.toml graph_file/graph_files > --repo-derived
<repo>/.tmct/graph.json > git-root/cwd default. On the `cli` route, a payload's
"repo_path" fills the --repo tier when the flag is absent.

Memory-backend precedence (chat; see src/services/chat.mjs createSession): --memory-backend
flag > TMCT_MEMORY_BACKEND env > tmct.toml [memory] backend > sqlite (the built-in
default, .tmct/memory/graph.sqlite); "memory" keeps the store in-process only. Set it
once with `tmct init --memory-backend <...>` and every later `tmct chat` in that
repo picks it up with no flag needed.
```

`npm run init:large` in `package.json` chains one `init` and five `import --corpus`
calls to combine every shipped bundle (human persona + seon + conceptnet +
aws/python/java) into ~7,380 facts on the default sqlite backend, a working
example to copy from. `init:xl` starts from the large persona tier and adds
the wordnet-xl corpus (~72,000 facts); `init:xxl` swaps wordnet-xl for the
full WordNet slice plus namenet (~239,000 facts, the biggest committed
vocabulary — expect its imports to take a minute). The xl chain, spelled out:

```bash e2e
npx tmct init --persona-size large   # npm run init:xl runs this whole chain from a clone
npx tmct import --corpus seon
npx tmct import --corpus conceptnet
npx tmct import --corpus aws
npx tmct import --corpus python
npx tmct import --corpus java
npx tmct import --corpus wordnet-xl  # init:xxl instead ends with wordnet-full and namenet
```

### tmct.toml reference

`tmct init` writes a sparse `tmct.toml` with just the keys it needs. The file
recognizes more keys than that default covers. Below is one config with every
recognized key set, so you can see the full surface in one place
(`src/adapters/toml-config.mjs` is the source of truth; `src/services/extensions.mjs` defines the
`[extensions.*]`/`[bias]` shape).

```toml
# Newline-delimited-file form is also accepted: repositories = "repos.txt"
repositories = ["../other-service", "../another-service"]

# Where generated output (e.g. tmct viz's default ledger.html) resolves to.
out_root = "./out"

# The code-graph JSON artifact. TMCT_GRAPH_FILE overrides this at runtime.
graph_file = ".tmct/graph.json"
# Extra graphs, merged alongside graph_file (ids that collide are auto-prefixed).
graph_files = [".tmct/graph.json", ".tmct/legacy-graph.json"]

[corpus]
# "tier1" (committed slice only, $0/offline, the default), "tier2" (also fetch
# growable corpora at seed time), or "tier3" (also consult live sources per query).
tier = "tier1"

[seed]
enabled = true      # seed the committed corpus into .tmct/memory during init
limit = 500         # cap the seeded fact count (definitional band first); unset = no cap

# One [extensions.<name>] table per bundle. A recognized name (human, seon,
# conceptnet, human-medium, human-large, tier2-aws, tier2-python, tier2-java,
# tier2-general, wordnet-xl, wordnet-full, namenet) overrides that bundle's
# shipped defaults. Any other name declares a new bundle and must set `kind`.
[extensions.human]
active = true

[extensions.seon]
active = true

[extensions.conceptnet]
active = true

[extensions.tier2-aws]
active = true

[extensions.my-custom-pack]
kind = "pack"                       # corpus | lexicon | templates | pack | ontology
active = true
corpus_path = "./vendor/my-pack/corpus.jsonl"
lexicon_path = "./vendor/my-pack/lexicon.json"
templates_path = "./vendor/my-pack/templates"
phrasebook_path = "./vendor/my-pack/phrasebook.json"
provenance_prefix = "corpus:my-custom-pack"

# Flat bundle-name -> weight table, consumed by src/domain/memory/bias.mjs's ranking.
[bias]
human = 1.0
seon = 0.8
conceptnet = 0.6
my-custom-pack = 1.2

[index]
languages = ["js", "py"]                     # restrict indexing to these languages
exclude = ["**/node_modules/**", "**/dist/**"]
secret_exclude = ["**/*.env", "**/secrets/**"]  # never indexed, even under a broad include
history_depth = 200                          # commits of git history to consider
# The five keys below parse and normalize but have no consumer wired up yet:
include_text = true
include_structure = true
respect_gitignore = true
markdown_sections = true
vue = true

[tune]
score_gap_k = 0.25          # retrieval score-gap threshold
literal_mention = true      # boost literal-name mentions
demote_non_prod = true      # rank test/fixture code below production code
call_adjacency = true       # boost callers/callees of a matched symbol
impl_of_interface = true    # boost an interface's implementations
beam_search = true          # use beam search over the graph walk
beam_width = 8
embed_rank = false          # rerank by embedding similarity (off by default)
prose_layers = 2            # how many prose-generation passes to run

[tune.expansion]
strategy = "beam"           # graph-walk expansion strategy
nodes = 50                  # node budget for the walk
q = 0.5                     # expansion breadth parameter
depth = 3                   # max hops

[telemetry]
enabled = false             # local-only counters; never phones home

[memory]
retention_versions = 5      # snapshot generations memory/core.mjs keeps on manifest bootstrap
backend = "sqlite"          # default | memory | sqlite (see "Memory backends" above)

# Game tuning knobs (src/domain/game-config.mjs). Every OTHER game parameter
# (disk/peg counts, the goal, ...) lives in the game's own taught-English
# world instead — these are the handful of genuine magic numbers that
# aren't expressible that way.
[games.spider-fly]
spider_initial_mass = 15
spider_mass_decrement_per_turn = 0.5   # lower = slower to starve
fly_initial_mass = 10
fly_mass_decrement_per_turn = 1
vision_radius = 4                      # Chebyshev radius an agent can see other agents within
egg_hatch_delay_turns = 3              # turns between a lay and its hatch
fly_spawn_interval_turns = 3           # a new fly arrives every Nth turn
eggs_eaten_threshold = 2               # flies eaten since the last egg before the next one lays
web_duration_turns = 10                # turns a spider-built web stays active

[games.guess-number]
default_lo = 1           # the range's default lower bound, when the opening line states none
default_hi = 100         # the range's default upper bound, when the opening line states none
max_bound = 1000000000   # sanity cap on either bound, however the opening line states it

[planning]
max_depth = 300  # the "solve it" plan lane's search-depth cap (hanoi, river-crossing, any taught-rule domain)
```

### Try it on an example graph

tmct *consumes* a code graph at `<repo>/.tmct/graph.json`. It does not build
one. Two ready-made example graphs live in `examples/` in this repo (clone the
repo to use them; they are not in the published npm package), so you can see
it answer real questions with no setup:

```bash cwd=repo
npm run example:mini       # "Questboard" — a small task-tracker web app (12 modules)
npm run example:polyglot   # one shared OWL vocabulary across Java / Python / C#
npm run chat:repo -- examples/mini-webapp   # any repo with a .tmct/graph.json works here
```

Questions the **mini-webapp** graph answers:

```text
what classes are there
describe Task
how many modules
which modules import src/core/model.mjs
what tests cover src/handlers/tasks.mjs
```

The **polyglot** graph shows the language-neutral idea: Java, Python and C#
entities all typed to the same `seon:Class` / `seon:Method` / `seon:Module`
concepts, so one query reasons across every language at once:

```text
how many classes          # 9 — Java + Python + C# counted as one concept
what classes are there     # Order (Java), Inventory (Python), PaymentService (C#), …
which modules define PaymentService
```

See `examples/mini-webapp/README.md` and `examples/polyglot/README.md` for the
full tours.

### As a library

```js
import { runChat, ask, resolveObject, fetchEntities } from "@polycode-projects/the-mechanical-code-talker";
```

`runChat` is the full teach-and-ask surface (see "Teach it, then ask it to
reason" above). It works over injectable streams, so a script can drive a
session the same way the tests do. `ask`/`resolveObject` are the lower-level,
read-only query primitives over an already-loaded graph, for a caller that
wants to query without a chat session. The `exports` map and the chat
primitives (`ask`, `resolveObject`, `relationKind`, `impactClosure`,
`dispatchTool`, `fetchEntities`) are the extension surface.

```js
import { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } from "@polycode-projects/the-mechanical-code-talker/plan";
```

The same planner `tmct plan` runs, callable directly: `buildCapabilityPlanCtx`
loads a repo's graph into a `{ dispatch, resolve, graph }` context,
`runCapabilityPlan(request, tools, ctx)` runs a request through it, and
`declaredCapabilityNames()` lists every capability a caller can declare. See
"Planning across the graph" above.

<!-- generated by scripts/generate-tool-docs.mjs from src/tools/definitions.mjs — do not edit by hand -->

## The tool surface

Everything above runs on the same 23 tools. Each one is read-only, answers one question in a single call, and returns bounded output. None of them calls a model. A tool that cannot ground an answer says so — the same honest miss you get everywhere else in tmct.

Three of them are **hot**: their schemas stay resident, so an agent driving tmct sees them every turn and reaches for one call instead of a Read/Grep loop.

- **`tmct_context`** — A sized edit bundle for one symbol — exemplar source, sibling signatures, registration anchor and the insertion region, in one call.
  Arguments: `symbol` (required), `depth`.
- **`tmct_snippet`** — The exact source of one function, class or Class.method — its line span only, plus a one-line in-repo call hint.
  Arguments: `symbol` (required).
- **`tmct_ask`** — A structural question in plain English, answered from the graph in one call — no model, and a clean miss instead of a guess.
  Arguments: `query` (required).

### Asking in plain English

`tmct_ask` is the chat-facing tool. It takes a structural question as you would type it and resolves it to a real traversal. These are the shapes it reads:

| you type | it answers with |
| --- | --- |
| which modules import src/core/model.mjs | the imports edge, read forwards |
| what is imported by src/core/store.mjs | the same edge, read backwards — a passive is the opposite direction, not a synonym |
| what uses src/lib/http.mjs | the uses union: imports plus calls |
| where is saveStore defined | the definition's file and line span |
| when did src/core/store.mjs change | the commits that touched it, newest first |

The `<where-marker>` slot takes any of *defined*, *declared*, *located*, *implemented*. The relation verb is the part that carries the meaning, and each relation has its own vocabulary rather than one blessed keyword:

- **imports** — *couples to*, *couple to*, *depends on*, *imports*, and more
- **uses** — *uses*, *use*, *makes use of*, *make use of*, and more
- **calls** — *invokes*, *invoke*, *calls*, *call*, and more
- **defines** — *defines*, *define*, *declares*, *declare*, and more
- **contains** — *contains*, *contain*, *lives in*, *live in*, and more
- **tests** — *tests*, *test*, *covers*, *cover*, and more
- **inherits** — *inherits from*, *inherit from*, *inherits*, *inherit*, and more
- **touches** — *touched*, *touches*, *changed*, *change*, and more
- **cochange** — *changed with*, *co-changes with*, *co-change with*, *changes alongside*, and more
- **reexports** — *exports*, *export*, *re-exports*, *re-export*, and more

Every question in that table runs against the example graph:

```bash cwd=repo
node bin/tmct.mjs cli tmct_ask '{"query":"which modules import src/core/model.mjs","repo_path":"examples/mini-webapp"}'
node bin/tmct.mjs cli tmct_ask '{"query":"what is imported by src/core/store.mjs","repo_path":"examples/mini-webapp"}'
node bin/tmct.mjs cli tmct_ask '{"query":"what uses src/lib/http.mjs","repo_path":"examples/mini-webapp"}'
node bin/tmct.mjs cli tmct_ask '{"query":"where is saveStore defined","repo_path":"examples/mini-webapp"}'
node bin/tmct.mjs cli tmct_ask '{"query":"when did src/core/store.mjs change","repo_path":"examples/mini-webapp"}'
```

### The rest of the tools

The remaining tools are **cold**: still served, but not billed to an agent every turn. Reach one through `tmct cli <tool>`, passing its arguments as JSON:

| tool | what it answers | arguments |
| --- | --- | --- |
| `tmct_describe` | Locate one symbol and list its typed edges (both directions) with provenance. | `symbol` (required) |
| `tmct_signature` | One symbol's API surface (params, returns, raises/catches, flags, decorators, doc) without the body. | `symbol` (required) |
| `tmct_impact` | Transitive reverse closure over imports/calls — what breaks if a module or symbol changes, by depth, with tests. | `module` (required) |
| `tmct_search` | Free-text/ranked lookup over the code-map to find the right module or symbol. | `query`, `kind`, `decorator`, `name` |
| `tmct_members` | A class's methods + attributes (file:line, decorators) in one slice. | `class` (required) |
| `tmct_subclasses` | A class's base classes plus the transitive set of classes that extend it. | `class` (required) |
| `tmct_related` | A term's synonyms (skos:altLabel) and related concepts (skos:related), from the memory graph's relation facts. | `term` (required) |
| `tmct_architecture` | Package/module map + the most-imported hub modules (optionally scoped to a package). | `package` |
| `tmct_exports` | A module's public __all__ surface, each name resolved to the module that defines it. | `module` (required) |
| `tmct_tests_for` | The test modules covering a symbol or module, from the typed test edges. | `symbol` (required) |
| `tmct_untested` | Source modules with no covering test module — a coverage-gap view (no arguments). | none |
| `tmct_history` | Recent commits that touched a symbol's module (newest first). | `symbol` (required) |
| `tmct_file_history` | Commits that touched a symbol's module, each with author / date / subject. | `symbol` (required) |
| `tmct_method_history` | Commits that touched a specific method symbol (fine-grained), with author / date / subject. | `symbol` (required) |
| `tmct_class_history` | Commits that touched a specific class symbol (fine-grained), with author / date / subject. | `symbol` (required) |
| `tmct_callers` | Modules that call into a symbol's module (one hop). | `symbol` (required) |
| `tmct_callees` | Modules a symbol's module calls into (one hop). | `symbol` (required) |
| `tmct_calls` | The in-repo symbols a function calls (fn→fn), each with file:line. | `symbol` (required) |
| `tmct_cochanges` | Modules that historically change in the same commit as a symbol's module (git co-change). | `symbol` (required) |
| `tmct_context_more` | The bundle sections a lean tmct_context omitted (siblings / tests / cochange / class members / re-exports). | `symbol` (required) |

Add `repo_path` to any of them to point at a repository other than the working directory. `tmct init` also writes this catalog, with a worked invocation per tool, to `.tmct/TOOLS.md` inside the repo it indexed.

```bash cwd=repo
node bin/tmct.mjs cli tmct_untested '{"repo_path":"examples/mini-webapp"}'
```

<!-- end generated tool section -->

## The repository interface

tmct is not an indexer, so it consumes a graph through a typed contract any
producer can implement. That contract is first-class: a **versioned (1.1.0),
OWL-grounded, machine-readable service definition** (`docs/repository-interface.md`
plus a JSON schema) of every service, its arguments, result types, and error
contract. The interface returns a miss as a normal value. It never throws to
signal "no answer." tmct ships **reference providers** (a fixture graph and the
empty/bootstrap graph) that implement every service, and a **runnable conformance
suite**. tmct's own providers pass it in `npm test`. Any external graph producer
(seonix first) runs the same suite against its native implementation to claim
conformance. Passing the suite is what conformance means here. This inverts the
original relationship: tmct was lifted out of seonix, and seonix now reorients
as a *user* that imports the tmct library and exposes its graph to tmct as a
service. The LLM agent stays outside tmct, as the no-LLM ethos requires.

## Measuring it

What the 2.7.11/2.7.12 cycle measured, on 2026-07-19. Each figure links to its
method and carries, in the same row, the caveat that changes what it means.
The full tables, judge scores, and transcripts are in the linked write-ups.

| What it does | Result (2.7.12) | Read the number with this | Method |
|---|---|---|---|
| Multi-hop entailment | 379/379 chat cases and 100/100 kernel cases, 0% fabrication, all bands pass | The case set is unchanged from 2.6.0 (same templates, same counts) — the one real move this cycle is INF-4's ceiling-graded count dropping 35→30, five cases that now pass as genuine capability instead of against the declared honest-miss floor. | `BENCHMARK_INFERENCE_2.7.12.md` |
| Tool-call planning | 68/68 cases, 100% plan-completion, 100% result-completion, 0% hallucination, every rung A0→C2 | Goal driver. 2.6.0 gated at TOOL-7 (62/66, 94%) — this cycle's router uplift (a guarded RECOVER step, a tied-candidate composer) cleared it, a real capability move, not a ruler change. | `BENCHMARK_AGENT_2.7.12.md` |
| Groundedness | Every answer carries a source, and an empty graph reports itself empty. Judge-scored mean 1.809/2 over 138 cases, 5 hard fails, 136/138 tier-1. | Judged (`claude-haiku-4-5-20251001`, `judge-prompt-v2`) at N=1. The judge prompt moved v1→v2 since 2.6.0, so this is a measurement, not a clean lever comparison against the prior cycle. The judge runs in the offline eval harness, never in the product. | `BENCHMARK_CEFR_ENGLISH_2.7.12.md` |
| Abstention (the honest miss) | 0% fabrication across 479 inference rows (379 chat + 100 kernel) and 0% hallucination across 272 agent rows | Structural, not a tuned threshold. tmct abstains because nothing matched, so the rows test a property of a no-model design rather than a score. | `BENCHMARK_INFERENCE_2.7.12.md`, `BENCHMARK_AGENT_2.7.12.md` |
| Determinism | Byte-identical on rerun — a 379-case `--replay` clean across 2 runs, no LLM, no network, $0 per turn | A property of the no-model pipeline. | `BENCHMARK_INFERENCE_2.7.12.md` |
| Dialogue robustness (persona sweep) | A 6-persona sweep (textbook logician, casual newcomer, new developer, adversarial sceptic, returning user, planning user) fixed 25 of the prior cycle's 29 routed findings (21 clean, 4 with a residual noted); 4 remain broken, 2 in a shape distinct from the original complaint | Free exploration across all six personas surfaced roughly 60 fresh findings beyond the ratchet check — the single highest-signal pattern: tmct's own suggested repair text was itself frequently broken when followed verbatim (since fixed, see `HANDOVER.md`). | `BENCHMARK_CONVERSATION_2.7.11.md` |

Three offline benchmark rigs live in a clone (they are not in the npm
package). Each replays a committed case set through the real product and
writes graded rows you can diff between runs:

- `npm run chatbench:run` measures chat quality against CEFR-graded English
  cases with deterministic tier-1 checks (the full tuning loop is in
  `SKILL_BENCHMARK_CEFR_ENGLISH.md`);
- `npm run infbench` generates inference cases, then runs each through both
  drive points, the reasoning kernel and the chat surface;
- `npm run agentbench:run` measures the tool-loop behaviour, and every
  verdict carries a hallucination axis.

The smallest real slice of each, the same invocations the test suite's
bench-smoke lane replays:

```bash cwd=repo
node chatbench/run.mjs --stamp smoke --only g-a1-naming-1 --out /tmp/chatbench-smoke
node infbench/generate-cases.mjs --out /tmp/infbench-cases.jsonl
node infbench/run.mjs --cases /tmp/infbench-cases.jsonl --only inf-1-lookup-subClassOf-001 --stamp smoke --out /tmp/infbench-smoke
node agentbench/run.mjs --stamp smoke --driver stub --only ab-a0-describe-widget --out /tmp/agentbench-smoke
```

Grading beyond tier 1 uses an LLM as judge. The offline eval harness is the
one place an LLM is allowed, never the product:

```bash skip=offline-eval-only
npm run chatbench:judge -- --product /tmp/chatbench-smoke/product.jsonl
```

## Security and supply chain

tmct is $0 to run and meant to be trusted offline, so the supply chain is
hardened:

- CI runs **SAST and secret detection**.
- A nightly **`npm audit` + OSV-Scanner** job watches dependencies.
- Releases are published with **npm provenance** (`--provenance`).
- A coordinated-disclosure `SECURITY.md` policy covers reports.

The content-address hash is single-sourced in `src/domain/hash.mjs`, so the
cross-version-stable fact-id contract has exactly one definition.

## Provenance

tmct began as a whole-package lift of the seonix chat surface (v0.1.0, then
published as `@polycode-projects/mct`), and was then reshaped. The LLM
fallback, the code-extraction stack, and the MCP server were all removed. The
naming, license, and memory model were reset to the vision above. See the
`PLAN_*.md` design docs for what's planned next.

## Standards and bibliography

tmct's vocabulary is grounded in published standards where they exist, and says where they don't.
Each alignment below is a triple in `ontology/tmct-core.ttl` and a test in
`test/adapters/grammar-ontology.test.mjs`. `docs/references/` holds an entry per source: the
edition, the retrieval date, the terms tmct uses, and what could not be verified.
`PLAN_NORMATIVE.md` holds the reconciliation, one verdict per term.

### The data model

| source | edition | what tmct uses it for |
|---|---|---|
| [W3C OWL 2 Primer](https://www.w3.org/TR/owl2-primer/) · [Profiles](https://www.w3.org/TR/owl2-profiles/) | Recommendation, 2012-12-11 | The triple model. The grammar emits `rdfs:subClassOf`, `owl:Restriction`, `owl:someValuesFrom`, `owl:disjointWith` and cardinality axioms. The inference engine implements OWL 2 RL/RDF rules and uses their names: `scm-sco`, `cax-sco`, `cax-dw`, `cls-svf1`, `scm-svf1`. |
| [RDF 1.1 Semantics](https://www.w3.org/TR/rdf11-mt/) | Recommendation, 2014-02-25 | Facts are reified statements. Appendix D.1 endorses reification for provenance, which is what tmct uses it for. [RDF 1.2](https://www.w3.org/TR/rdf12-concepts/) (Candidate Recommendation, 2026-04-07) reclassifies that vocabulary as legacy and points new systems at triple terms and `rdf:reifies`. tmct has not moved, and `docs/references/schemas/rdf-reification-and-rdf-star.md` says why. |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) | Recommendation, 2013-04-30 | Provenance. A fact's source links sit under `prov:wasInfluencedBy`; a fact cleaned from a raw utterance is a `prov:wasDerivedFrom`; a session is a `prov:Activity` and the utterances in it are `prov:Entity`s it generated. |
| [W3C SKOS](https://www.w3.org/TR/skos-reference/) | Recommendation, 2009-08-18 | Read, and mostly not used. `skos:related` needs `skos:Concept` at both ends, and tmct's corpus terms are bare strings. `docs/references/schemas/skos.md` records what a concept-identity pass would need. |
| [SEON](http://se-on.org/) `code.owl` | 2012/02 | Code-graph vocabulary: `seon:hasSuperType`, `seon:containsCodeEntity`, `seon:declaresMethod`, `seon:invokesMethod` and 15 more. Where SEON has no term, tmct coins under its own `mgx:` prefix rather than borrowing SEON's. |

### Language

| source | edition | what tmct uses it for |
|---|---|---|
| [Attempto Controlled English](http://attempto.ifi.uzh.ch/site/docs/) | ACE 6.7, 2013 | The controlled-English fragment. tmct implements 9 of ACE's declarative sentence patterns. |
| Kuhn, "A Survey and Classification of Controlled Natural Languages" | *Computational Linguistics* 40(1), 2014 | Where ACE sits among controlled languages. |
| [ConceptNet](https://github.com/commonsense/conceptnet5/wiki/Relations) | slice pins 5.7.0 | The commonsense corpus. 25 relations are mirrored into `mgx:` and each cites its `/r/` origin. |
| Damerau, *CACM* 7(3), 1964 · Levenshtein, *Soviet Physics Doklady* 10(8), 1966 | — | Fuzzy matching. `fuzzy.mjs` implements **Optimal String Alignment** — restricted Damerau-Levenshtein, which allows adjacent transposition but edits no substring twice. |

### Reasoning and planning

| source | edition | what tmct uses it for |
|---|---|---|
| Fikes & Nilsson, "STRIPS" | *Artificial Intelligence* 2(3–4), 1971 | The action model: operator, precondition, effect. |
| McDermott et al., PDDL | Yale CVC TR-98-003, 1998 | The action-rule vocabulary. |
| Doyle, "A Truth Maintenance System" | *Artificial Intelligence* 12(3), 1979 | Justification and premise. tmct records which rule entailed a fact; it does not yet record which facts fed the rule. |
| Meszaros, *xUnit Test Patterns* | Addison-Wesley, 2007 | The test-double taxonomy — stub, spy, mock, fake, dummy — and the fixture patterns. `docs/references/testing-vocabulary.md` records where tmct's own tiers depart from the standard taxonomy, and that "blast radius" is an ops metaphor for what the literature calls Regression Test Selection. |
| Aristotle, *Prior Analytics* I.1 (24b18–20) · Bobzien, "Ancient Logic", *SEP* | — | **Why the command is called `syllogise`.** The word is used in the older, broader sense of *sullogismos* — Aristotle's own definition is "discourse in which, certain things being stated, something other than what is stated follows of necessity", with no mention of three terms or two premises, and the Stoics used the same word for a system in which modus ponens is a *sullogismos*. Two of tmct's rules are the narrow thing exactly: `scm-sco` is **Barbara**, `cax-sco` is the **Socrates syllogism**. The others reach past term logic. The operation's own names are **forward chaining** and **materialisation**, and the code uses those. |

### Storage

| source | edition | what tmct uses it for |
|---|---|---|
| Jensen et al., "A Consensus Glossary of Temporal Database Concepts" | *SIGMOD Record* 23(1), 1994 | The time vocabulary. `mgx:utteranceTs` is valid time; `mgx:createdAt` is a transaction-time start. tmct is **not** bitemporal: `mgx:updatedAt` is an audit stamp, so tmct cannot answer what it believed last Tuesday. |
| RFC 9923, "The FNV Non-Cryptographic Hash Algorithm" | Informational, 2026 | FNV hashes the narrow non-fact-id pools (paraphrase keys, per-URL source ids, corpus dedupe). Fact ids are content-addressed with a **64-bit truncation of SHA-256**, so a fact id is collision-resistant at tmct's corpus sizes; tmct is still **not** a Merkle tree and offers no tamper-evidence. |
| Green, Karvounarakis, Tannen, "Provenance Semirings" | PODS 2007 | The distinction tmct's docs keep: it records source annotation and PROV-style attribution, not how-provenance. |

### Measuring it

| source | edition | what tmct uses it for |
|---|---|---|
| Council of Europe, CEFR — Companion volume | 2020, ISBN 978-92-871-8621-8 | The band labels A1–C2 the chat benchmark grades against. CEFR measures what a *person* can do communicatively; grading the difficulty of *prompts* by band is tmct's adaptation, not a CEFR-validated use. The band descriptions in `chatbench/GRADED.md` are tmct's own prose. |
| Reiter, "On Closed World Data Bases" | *Logic and Data Bases*, Plenum, 1978, pp. 55–76 | Both halves of the honest miss. The planner's operator model is **closed-world**, which is what makes a plan checkable. The chat layer is **open-world**: it will not read "no matching rule" as "the answer is no". |
| Chow, "On optimum recognition error and reject tradeoff" | *IEEE Trans. Information Theory* 16(1), 1970 | Prior art for the goal. The literature calls a refusal **abstention**, or selective prediction, and Chow's reject option is its root. Those methods threshold a confidence score; tmct has none, and abstains because nothing matched — which is why the row above names the mechanism. |
| Ji et al., "Survey of Hallucination in Natural Language Generation" | *ACM Computing Surveys* 55(12), 2023 | Groundedness, and what tmct is avoiding by having no model to hallucinate with. |

### Where no standard fits

- **Trust.** PROV records who said a thing, not whether to believe them, and no W3C Recommendation
  covers trust. `mgx:trustScore` and its inputs are tmct's own. Candidate literature: Artz & Gil,
  "A survey of trust in computer science and the Semantic Web", *Journal of Web Semantics* 5(2),
  2007.
- **Negation.** tmct negates with its own `mgxneg:` prefix, which applies to any predicate.
  `owl:disjointWith` would over-claim, since "john is not a man" denies one membership rather than
  a class axiom, and OWL 2's `negativePropertyAssertion` needs a reified shape the flat JSON store
  has no room for.
- **Dialogue acts.** tmct has no intent vocabulary. ISO 24617-2 (SemAF) is the standard for one, and
  `docs/references/schemas/iso-24617-2-dialogue-acts.md` maps tmct's behaviour onto it so that if
  one is built it uses the standard's names.

## Licensing

**MPL-2.0.** Free for commercial use. If you modify the covered files and
distribute them, you must publish those files' source under the MPL with
attribution. The copyleft applies file by file, not to the whole project. See
`LICENSE`.

Corpus data carries its own licenses, separate from the code: the shipped
ConceptNet slice is **CC-BY-SA 4.0**, with its own notice alongside it.

© Polycode Limited.
