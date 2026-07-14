# tmct — The Mechanical Code Talker

`@polycode-projects/the-mechanical-code-talker`

A pure-JS, **no-LLM**, offline, **$0** chatbot in the ELIZA/PARRY lineage:
pattern-driven, best-efforts, and obsessed with software the way PARRY was
obsessed with the mafia. No model calls anywhere.

tmct turns natural language directly into a graph database. On first run it
seeds an everyday **human-world persona** — people, places, objects, nature,
time — so it already has a vocabulary before you teach it anything. A
code-focused persona is available as an opt-in alternative: a software
**ontology** (real definitions), a **lexicon** (everyday words mapped onto
it), and a wider ConceptNet **corpus**. Point tmct at a real codebase's graph
and it reasons over that too, whichever persona is active. Teach it a fact in
plain English and it mints a node. Ask it a question and it answers from what
it was seeded with, what you taught it, and what it can derive by rule from
both. Every answer is either grounded or an honest miss.

## Teach it, then ask it to reason

This is real, runnable output. No cherry-picking, no model anywhere in the
loop. Copy it into a file and run it:

```js
import { runChat } from "@polycode-projects/the-mechanical-code-talker";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A graph producer feeds tmct a code graph like this one (see "The repository
// interface" below). This is a 4-node slice: two modules, a base class, and a
// class that inherits it.
const graph = {
  individuals: [
    { id: "mod:src/handlers/base.mjs", label: "src/handlers/base.mjs", class: "Module" },
    { id: "mod:src/handlers/tasks.mjs", label: "src/handlers/tasks.mjs", class: "Module" },
    { id: "fn:src/handlers/base.mjs#Controller", label: "Controller", class: "Class" },
    { id: "fn:src/handlers/tasks.mjs#TaskController", label: "TaskController", class: "Class" },
  ],
  objectProperties: [{
    predicate: "inherits", prop: "seon:hasSuperType", count: 1,
    examples: [{ subject: "fn:src/handlers/tasks.mjs#TaskController", object: "fn:src/handlers/base.mjs#Controller",
                 subjectLabel: "TaskController", objectLabel: "Controller" }],
  }],
};

const repoPath = await mkdtemp(join(tmpdir(), "tmct-demo-"));
await mkdir(join(repoPath, ".tmct"), { recursive: true });
await writeFile(join(repoPath, ".tmct", "graph.json"), JSON.stringify(graph));

// tmct has one API surface for both teaching and asking: a chat turn, in
// English. Each call below is a short session over the same repo, so what
// gets taught in the first call is still remembered in the second.
async function tell(line) {
  const out = new PassThrough();
  let transcript = "";
  out.on("data", (chunk) => { transcript += chunk; });
  await runChat({ repoPath, input: Readable.from([line + "\n", "/exit\n"]), output: out });
  return transcript.split("\n").find((l) => l.startsWith("tmct> "));
}

await tell("a controller is a kind of handler");         // Learn
console.log(await tell("is TaskController a handler"));  // Infer from learnings
```

Output, captured from an actual run:

```
tmct> yes — the code graph says TaskController inherits Controller, and you
told me: controller is a kind of handler (source: ace:chat:<session-id>@<timestamp>)
```

Nothing here was told that "handler" and "Controller" relate. tmct combined a
fact already in the graph (`TaskController inherits Controller`) with a fact
you just taught it in English (`controller is a kind of handler`) and wrote
the connecting sentence itself, citing both sources. The `source: ace:chat:…`
part is a real provenance receipt. Every fact tmct stores records where it
came from and when (more on that below).

The first `tell()` call above replies too: `noted — remembered 1 fact:
controller rdfs:subClassOf handler (controller is a type of handler)`. The
part in parentheses is a paraphrase. tmct generates it and checks it against
its own inference rules before showing it, so it never just guesses at
prose.

```
$ tmct
tmct> what talks to the payment module?
…
tmct> /callers checkout
…
tmct> /exit
```

**[Try it live in your browser →](https://polycode-projects.gitlab.io/the-mechanical-code-talker/)**
is a real, interactive chat demo running client-side. Your browser runs the
actual query engine against a small example codebase, no server, no install.

## Compared to other JS libraries

Nothing found in the JS ecosystem does this exact combination: teach in
English, reason over a seeded ontology, answer in English, with no model call
anywhere. Three kinds of library each cover one piece of it well.

**[compromise](https://github.com/spencermountain/compromise)** (`npm i
compromise`, 12k+ GitHub stars, describes itself as "modest natural language
processing") is the general-purpose NLP toolkit of the three. Its own README
example:

```js
import nlp from 'compromise'
let doc = nlp('she sells seashells by the seashore.')
doc.verbs().toPastTense()
doc.text()
// 'she sold seashells by the seashore.'
```

It tags part-of-speech, conjugates verbs, and parses fractions and money far
more broadly than tmct attempts to. It has no graph, no ontology, and no
memory between calls. Each call is stateless text in, text out.

**[N3.js](https://github.com/rdfjs/N3.js)** (`npm i n3`) is a mature,
spec-compliant RDF/OWL toolkit: parsing, writing, and in-memory storage of
triples. Its own README example:

```js
const parser = new N3.Parser();
parser.parse(tomAndJerry, (error, quad, prefixes) => {
  if (quad) console.log(quad);
  else console.log("That's all, folks!", prefixes);
});
```

(`tomAndJerry` is Turtle text the caller writes by hand: `c:Tom a c:Cat.
c:Jerry a c:Mouse; c:smarterThan c:Tom.`) N3.js is the right choice if you
already have RDF and need to parse or serialize it fast. It has no
natural-language front end (you write the triples yourself) and no built-in
reasoning beyond an optional, limited basic-graph-pattern reasoner.

**[elizabot](https://github.com/tkafka/node-elizabot)** (`npm i elizabot`) is
the direct ELIZA lineage in JS, the same territory tmct's chat surface sits
in. Its own README example:

```js
var eliza = new ElizaBot();
var initial = eliza.getInitial();
var reply = eliza.transform(inputstring);
```

It is deterministic and needs no model, same as tmct. But it has no graph and
no persistent memory: a fact from one line never carries into the next, and
its "reasoning" is pattern substitution, not a stored, queryable fact.

Put together: broad NLP without a graph (compromise), a graph without a
natural-language front end (N3.js), or a conversational front end without a
graph (elizabot). Combining ontology-seeded graph memory, English teaching,
and rule-based inference into one no-model pipeline is what looks distinctive
about tmct as of this writing.

## How it interprets you

Every message runs through **multiple concurrent interpretation strategies**:
a grammar parse, keyword picking, noise-word removal, fuzzy matching. Their
results are grouped by class.

One of the strategies is an **ACE-inspired controlled grammar**: when your
text fits the controlled fragment, tmct emits OWL-labelled triples from it.
Those triples are statements it can store, retrieve, and answer from later.
Text that doesn't fit the grammar still gets the tolerant strategies; nothing
is rejected for being loose, fuzzy, or misspelled.

**Everyday question shapes.** Bare "what is Commit" (no article) now resolves
like "what is a commit" for tmct's own vocabulary. "What's model.mjs for" and
"what's model.mjs about" answer like "what does model.mjs do". "Is Base a
superclass of Widget" is read as the reverse of "is Widget a subclass of
Base", the same relationship either way round. "Recent commits" and "the last
commit" resolve to real dated history, not a literal string miss. Polite or
indirect framing reaches the same capability as a direct request: "I'd like
you to remember X" teaches like bare "remember X"; "please tell me about X"
and "search for X" describe and find exactly as their direct forms do.

**Negation and passive.** "Which modules do *not* import X?" computes a bounded
**set complement** over the graph, and an honestly empty result stays a miss
rather than a fabricated list (a non-enumerable type, like arbitrary *changes*,
is refused outright). Reversible-passive questions traverse the right direction:
"what is imported by Y" and "what does Y import" are understood as opposite
edges, not the same one.

**Finding by description.** "find me the payment class" searches by type and a
fuzzy match against the entity's own properties, instead of making you name it
exactly. It checks the type itself and its subclasses first. Only if nothing
matches there does it widen to a related type, and when it does, it says so
plainly rather than presenting the looser match as exact.

**Comparing two things.** "compare TaskController and UserController" or "how
is TaskController different from UserController" lines up both entities'
shared and differing edges side by side: *"Comparing TaskController and
UserController (both Class): inherits [seon:hasSuperType]: TaskController (1)
-> Controller; UserController (1) -> Controller"*. Every row is a real edge
or attribute from the graph, never a hand-written diff.

**Up-refining to a containing module.** A class rarely has its own
symbol-precise commit or import record. "who touched TaskController" answers
from its containing module's real history instead of a confident-looking but
wrong "nothing touched it".

**Following a list.** tmct remembers the last list it gave you. After
"which modules import src/core/model.mjs", "which of those are tested" or
"how many of those" resolves "those"/"them" against that list, not a fresh,
unresolved pronoun.

**Synonyms and everyday phrasing.** tmct matches many of the words people
actually use for the same idea, from a curated synonym list plus a filtered
ConceptNet slice. A slightly different word for the same concept still
resolves. It also follows a few common sentence shapes: clauses starting with
*because/although/while*, and conditionals ("if X were removed, what
breaks"). It flags a question whose premise doesn't hold, too: "why does X
still import Y" when it no longer does.

**Response finishing.** Before an answer is printed it is segmented into typed
spans: prose versus *protected* entities, paths, numbers, code, provenance, and
receipts. A small data-driven grammar pass then runs on the prose spans only,
under a guard that proves the protected spans came through byte-for-byte. Today
that pass fixes the a/an article defect; broader voice and agreement rules are
implemented but parked until they earn their place on the benchmark.

A frozen regression suite plays out full multi-turn dialogues built from these
phrasings, at every complexity level this project defines, from a single
question up to a messy, typo-ridden real user. Tier-by-tier detail is in
`HANDOVER.md` and `ROADMAP.md`.

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
when tmct genuinely knows the concept *and* has instances of it. Otherwise the
honest miss stands. The effect is a conversation that drills down from a vague
opener to a useful answer without ever hitting a wall. Natural phrasings are
routed to the capability you meant: *"what functions are in Task"* → its
members, *"what defined saveStore"* → where it's defined.

## Detailed, grounded answers

Ask a precise question and tmct gives you a precise answer. Ask for more and
it gives you more: "give me a detailed summary of how X works" (or "explain
in detail how X works", or "...detailed overview/explanation of X") gets a
longer, multi-sentence account instead of one line. Every sentence in it is
lifted from a real graph edge, attribute, or taught fact — never generated
free text.

The wording varies a little too. A small, curated, deterministic pool swaps a
handful of connector words, like "defined in", "located in", or "found in".
The same fact doesn't read identically for every entity, but the same
question against the same entity always renders the same way.

```
$ node bin/tmct.mjs chat --repo examples/mini-webapp --ephemeral
tmct> give me a detailed overview of how the Store works
Attribute: prose_tokens = memory record store [mgx:hasProseTokens]. Attribute:
doc = In-memory record store. [seon:hasDoc]. Other matches: src/core/store.mjs
(Module), loadStore (Function), saveStore (Function), testLoadStore (Function).
```

Programmatically, the same pipeline is `generateCompletion()`
(`src/completions/complete.mjs`):

```js
import { fetchEntities } from "./src/source.mjs";
import { parseEntities } from "./src/codegraph.mjs";
import { loadMemory } from "./src/memory/core.mjs";
import { createCompletionsGraphAdapter } from "@polycode-projects/the-mechanical-code-talker/createCompletionsGraphAdapter";
import { generateCompletion } from "@polycode-projects/the-mechanical-code-talker/generateCompletion";

const dir = "examples/mini-webapp";
const graph = parseEntities(await fetchEntities({ graphFile: `${dir}/.tmct/graph.json` }));
const memory = await loadMemory(dir);
const graphService = createCompletionsGraphAdapter(graph, memory);

const { text } = await generateCompletion(dir, "Store", { query: "Store", graph, memory, graphService });
console.log(text);
```

```
Attribute: prose_tokens = memory record store [mgx:hasProseTokens]. Attribute:
doc = In-memory record store. [seon:hasDoc]. Other matches: src/core/store.mjs
(Module), loadStore (Function), saveStore (Function), testLoadStore (Function).
```

Full pipeline design in `archive/PLAN_COMPLETIONS.md`.

## Planning across the graph

Some questions need more than one lookup. `tmct plan` is a small STRIPS/PDDL-style
planner over the same read-only graph-query tools chat/serve use
(`src/router/*`): it decomposes a compound request, resolves and executes each
step in order with a provable causal-link proof chain, and folds the results
into one answer. A request neither the planner nor a single lookup can ground
escalates to a closed-world goal-reasoner, which deduces maintenance goals
(coverage gaps, change-coupling risk) straight from the graph — never from
keywords in your question. Anything none of that grounds is an honest "no plan
found", the same "grounded or an honest miss" rule as everywhere else in tmct.

```
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
       - src/handlers/users.mjs (imports it) — tests: none recorded
       - src/server/app.mjs (imports it) — tests: none recorded
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

```
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

## How it remembers

tmct's memory has two layers, both fed by every parsed request and response and
by cleaned session logs:

- an **always-loaded OWL-labelled JSON graph** on disk under `.tmct/` (local
  artifact, never committed);
- **text blocks under a PageRank-style index**, pulled into context on
  relevance rather than loaded wholesale.

With no graph at all, tmct starts empty and remembers what you tell it. The
`.tmct/` graph is created from the conversation. On a first run it seeds the
committed vocabulary so it knows what it's talking about from turn one: an
everyday **human-world** persona — people, places, objects, nature, time/
events, body/food and mind vocabulary hand-curated from Open English WordNet
and bridged to Schema.org's top-level classes — so "what is a dog?" answers
offline, from disk, on turn one. A code-domain persona (a curated **SEON**
software ontology plus the whole filtered **ConceptNet slice**, CC-BY-SA 4.0)
is available opt-in: `tmct init --with-persona code`. `--ephemeral` (used by
the shipped `npm run example:*` demos) reads a graph but writes nothing back.

The default persona also comes in three sizes: Small (~664 facts, the
default), Medium (~1,608, `tmct init --persona-size medium`) and Large
(~13,609, `--persona-size large`, deep enough to chain real multi-hop
reasoning). Design detail and the full fact-count tables are in `archive/PLAN_SEED.md`.

### Memory backends

The default memory backend writes an OWL-labelled JSON file under `.tmct/`.
Two more exist: `memory` keeps taught facts in the process only, nothing
written to disk; `sqlite` persists them to a local SQLite file instead
(`.tmct/memory/graph.sqlite`).

Pick one at init time and it sticks — `tmct init --memory-backend sqlite`
writes the choice into `tmct.toml`, and every later `tmct chat` in that repo
uses it with no flag needed:

```bash
tmct init --memory-backend sqlite     # writes [memory] backend = "sqlite" to tmct.toml
tmct chat                             # picks it up automatically
tmct chat --memory-backend memory     # override for just this session
```

Precedence is `--memory-backend` flag > `TMCT_MEMORY_BACKEND` env > tmct.toml's
`[memory] backend` > the default. A library caller sets the same thing
directly: `runChat({ memoryBackend: "sqlite" })`.

Teaching isn't limited to the ACE grammar's fixed shapes. Tell tmct an
arbitrary fact, like "margo really eats ribs", and it mints a fact you can
later ask about directly: "what does margo eat", or "does margo eat ribs".

New vocabulary compounds as you teach it. "redis is a cache" mints "redis" as
a class-level concept even though it was never in the built-in lexicon, and a
later "every cache is a store" does the same for "store," the other way
round, as long as one side of the sentence is already grounded. tmct never
mints a fact between two totally ungrounded terms; it declines and nudges you
to ground one side first. Quantified teaching works too: "some functions are
risky" stores the quantifier, and a later "how many functions are risky"
answers "A few."

Once you've taught a few facts, "how many facts are there" counts them back.
That's the same count phrasing a code graph answers "how many classes are
there" with, just now reading tmct's own memory.

### Provenance and trust

Every fact and text block records **where it came from and when**. Sources are
first-class individuals: operator chat, a curated corpus, a provider graph, a
web scrape, a rule-derived entailment. A fact links back to *all* of them
(`mgx:derivedFrom` / `mgx:statedBy` / `mgx:canonicalisedFrom`), timestamped with
`mgx:createdAt`. From those links tmct computes a **deterministic, explainable
trust score**: a source-type prior combined with corroboration (how many
independent sources agree) and recency. It is never hand-set, always traceable
to its inputs. Retrieval then ranks by **relevance × trust**, so a corroborated,
operator-stated fact outranks a lone web scrape on the same question. When two
trusted sources *disagree*, the `/memory` inspector shows **both sides with their
provenance** rather than silently picking a winner.

### Speculative inference (a maintenance job, not a chat cost)

`tmct syllogise [--depth n] [--budget n]` is an offline, bounded, deterministic
batch that forward-chains the memory's `rdfs:subClassOf` closure into new
**entailed** facts, pre-deriving what the trusted sources already imply. It runs
once automatically after seeding and on demand; the entailed facts are
**low-trust and retractable** (never outranking a stated fact) and this never runs
on the chat's hot path.

## Install & use

```bash
npm install -g @polycode-projects/the-mechanical-code-talker
tmct                                  # bare = chat (the headline)
tmct chat --repo /abs/path/to/repo    # chat over a specific repo's graph
tmct init                             # scaffold .tmct/, tmct.toml, seed + provenance
tmct syllogise                        # offline: pre-derive entailed facts (maintenance)
npm run viz -- --output graph.html && open graph.html   # self-contained HTML graph view
```

Inside the chat: `/help` lists commands, `/memory` inspects what tmct remembers
(grouped by OWL class, with provenance and any contradictions), `/exit` leaves.
`TMCT_GRAPH_FILE` overrides the graph location.

`tmct --help` (or `npm run help` from a clone of this repo) is the full,
up-to-date flag reference for every subcommand — a bare `npm run` only lists
script names, so `npm run help` is the documented way in from there.

`tmct init` is the onboarding surface for the repository interface below: it
creates the `.tmct/` directory, writes the externalized `tmct.toml`
configuration, seeds the default persona, and records provenance. A host
package or a bare user gets a working install in one command.

> Install-size note: tmct depends on wink-nlp's deterministic English language
> model (~3.8 MB installed). That model is a lookup table, not an LLM.

### Flags, config, and multiple graphs

Every subcommand shares one flag/config resolver (`src/cli-args.mjs`). The
graph-path precedence is the same everywhere: `--graph` flag(s) beat
`TMCT_GRAPH_FILE`, which beats `tmct.toml`'s `graph_file`/`graph_files`, which
beats the `--repo`-derived `<repo>/.tmct/graph.json` default.

```bash
tmct init --repo /abs/path                    # scaffold a specific repo, not just cwd
tmct init --corpus <id|path>                  # a tier-2 manifest id (aws|python|java|general)
                                               # or your own corpus jsonl file
tmct init --ontology <name|path>              # activate+seed an ontology bundle
tmct init --lexicon <name|path>               # activate a lexicon bundle (never seeded)
tmct init --graph <path> [--graph <path> …]   # set tmct.toml's graph_file/graph_files
tmct init --config <path>                     # write to an alternate tmct.toml location
tmct init --persona-size medium|large         # grow the default persona (Small is default)
tmct init --memory-backend default|memory|sqlite  # write tmct.toml's [memory] backend —
                                               # every later `tmct chat` here uses it

tmct import --corpus <id|path>                # activate+seed into an ALREADY-initialized
tmct import --ontology <name|path>            # repo — any combination of these flags in
tmct import --lexicon <name|path>             # one call. --graph is a DIFFERENT, purely
tmct import --graph <path>                    # additive op: it appends to graph_files,
                                               # never activates an extensions bundle.
tmct import --memory-backend default|memory|sqlite  # same knob as `tmct init`, for a
                                               # repo that's already initialized

tmct chat --graph <path> [--graph <path> …]   # explicit graph file(s) — multiple merge
                                               # (ids that collide across graphs are
                                               # auto-prefixed; see src/graph-merge.mjs)
tmct chat --config <path>                     # an alternate tmct.toml (a file or a dir)
tmct chat --memory-backend default|memory|sqlite  # override tmct.toml's backend for
                                               # just this session
tmct serve --graph <path> --config <path>     # same two flags, for the HTTP endpoint
```

`--corpus`/`--ontology`/`--lexicon` each take one value; chain multiple `tmct
import` calls to combine several. `npm run init:large` in `package.json`
chains one `init` and five `import --corpus` calls to combine every shipped
bundle (human persona + seon + conceptnet + aws/python/java) into ~7,380
facts on the default flat-JSON backend — a working example to copy from.

`tmct extend --validate <dir> --config <path>` validates a third-party
extension pack against an alternate tmct.toml, without mutating anything.

### Try it on an example graph

tmct *consumes* a code graph at `<repo>/.tmct/graph.json`; it does not build
one. Two ready-made example graphs live in `examples/` in this repo (not in the
published npm package — clone the repo to use them) so you can see it answer
real questions with no setup:

```bash
npm run example:mini       # "Questboard" — a small task-tracker web app (12 modules)
npm run example:polyglot   # one shared OWL vocabulary across Java / Python / C#
npm run chat:repo -- ./any/path   # chat over any repo that has a .tmct/graph.json
```

Questions the **mini-webapp** graph answers:

```
what classes are there
describe Task
how many modules
which modules import src/core/model.mjs
what tests cover src/handlers/tasks.mjs
```

The **polyglot** graph shows the language-neutral idea: Java, Python and C#
entities all typed to the same `seon:Class` / `seon:Method` / `seon:Module`
concepts, so one query reasons across every language at once:

```
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
reason" above — it works over injectable streams, so a script can drive a
session the same way the tests do). `ask`/`resolveObject` are the lower-level,
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

## The repository interface

tmct is not an indexer, so it consumes a graph through a typed contract any
producer can implement. That contract is first-class: a **versioned (1.0.0),
OWL-grounded, machine-readable service definition** (`docs/repository-interface.md`
plus a JSON schema) of every service, its arguments, result types, and error
contract. A **miss is a value, not a throw**: the interface models "no answer"
explicitly. tmct ships **reference providers** (a fixture graph and the
empty/bootstrap graph) that implement every service, and a **runnable conformance
suite**. tmct's own providers pass it in `npm test`. Any external graph producer
(seonix first) runs the same suite against its native implementation to claim
conformance. Conformance is the suite, not prose. This inverts the original
relationship: tmct was lifted out of seonix, and seonix now reorients as a *user*
that imports the tmct library and exposes its graph to tmct as a service. The LLM
agent stays outside tmct, as the no-LLM ethos requires.

## Security and supply chain

tmct is $0 to run and meant to be trusted offline, so the supply chain is
hardened:

- CI runs **SAST and secret detection**.
- A nightly **`npm audit` + OSV-Scanner** job watches dependencies.
- Releases are published with **npm provenance** (`--provenance`).
- A coordinated-disclosure `SECURITY.md` policy covers reports.

The content-address hash is single-sourced in `src/hash.mjs`, so the
cross-version-stable fact-id contract has exactly one definition.

## Provenance

tmct began as a whole-package lift of the seonix chat surface (v0.1.0, then
published as `@polycode-projects/mct`), and was then reshaped: the LLM
fallback, the code-extraction stack, and the MCP server were all removed; the
naming, license, and memory model were reset to the vision above. See
`ROADMAP.md` for the phase plan.

## Licensing

**MPL-2.0.** Free for commercial use; if you modify the covered files and
distribute them, you must publish those files' source under the MPL with
attribution. The copyleft is file-level, not project-level. See `LICENSE`.

Corpus data carries its own licenses, separate from the code: the shipped
ConceptNet slice is **CC-BY-SA 4.0**, with its own notice alongside it.

© Polycode Limited.
