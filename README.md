# tmct — The Mechanical Code Talker

`@polycode-projects/the-mechanical-code-talker`

A pure-JS, **no-LLM**, offline, **$0** chatbot in the ELIZA/PARRY lineage:
pattern-driven, best-efforts, and focused on software as its subject matter.
It makes no model calls.

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

## How it interprets you

Every message runs through **multiple concurrent interpretation strategies**:
a grammar parse, keyword picking, noise-word removal, fuzzy matching. Their
results are grouped by class.

One of the strategies is an **ACE-inspired controlled grammar**: when your
text fits the controlled fragment, tmct emits OWL-labelled triples from it.
Those triples are statements it can store, retrieve, and answer from later.
Text that doesn't fit the grammar still gets the tolerant strategies. Nothing
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
**set complement** over the graph. An empty result stays a miss rather than a
fabricated list (a non-enumerable type, like arbitrary *changes*, is refused
outright). Reversible-passive questions traverse the right direction:
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
that pass fixes the a/an article defect. Broader voice and agreement rules are
implemented but parked until they earn their place on the benchmark.

A frozen regression suite plays out full multi-turn dialogues built from these
phrasings, at every complexity level this project defines. That ranges from a
single question up to a messy, typo-ridden real user. Tier-by-tier detail is
in `HANDOVER.md` and `ROADMAP.md`.

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
reasoning). Design detail and the full fact-count tables are in `archive/PLAN_SEED.md`.

### Memory backends

The default memory backend writes an OWL-labelled JSON file under `.tmct/`.
Two more exist: `memory` keeps taught facts in the process only, nothing
written to disk; `sqlite` persists them to a local SQLite file instead
(`.tmct/memory/graph.sqlite`).

Pick one at init time and it sticks. `tmct init --memory-backend sqlite`
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
mints a fact between two totally ungrounded terms. It declines instead, and
nudges you to ground one side first. Quantified teaching works too: "some
functions are risky" stores the quantifier, and a later "how many functions
are risky" answers "A few."

Once you've taught a few facts, "how many facts are there" counts them back.
That's the same count phrasing a code graph answers "how many classes are
there" with, just now reading tmct's own memory.

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

Every subcommand shares one flag/config resolver (`src/cli-args.mjs`), which
is why `--repo`, `--graph`, and `--config` behave the same way everywhere.

The bare command and `tmct chat` open the interactive session:

```
Usage:
  tmct                         interactive chat (the headline surface)
  tmct chat [--repo <abs>]     chat over a specific repo's graph
       [--graph <path>]        explicit graph file (repeatable — multiple graphs merge;
                               see src/graph-merge.mjs); wins over --repo/TMCT_GRAPH_FILE/tmct.toml
       [--config <path>]       an alternate tmct.toml location (a file or a directory)
       [--ephemeral]           read the graph but write nothing back (demo/read-only)
       [--narrate]             start with narrate mode on — a verbose, developer-facing
                               trace of decision points/matched pattern/results/goal per
                               turn, appended under a "--- narrate ---" marker (also
                               TMCT_NARRATE=1; toggle mid-session with /narrate on|off)
       [--plain]               force the plain readline shell (the default when
                               stdin/stdout is not a terminal)
       [--memory-backend <default|memory|sqlite>]  storage backend for taught facts this
                               session (CLI flag > TMCT_MEMORY_BACKEND env > tmct.toml's
                               [memory] backend > "default", the flat .tmct/ JSON file)
```

`tmct memory` is the CLI-side view of the same data the `/memory` chat command shows:

```
  tmct memory [--repo <abs>]   what tmct remembers: facts, utterances, sessions,
       [--config <path>]       folded blocks (the /memory chat command, from the shell)
       [--verbose]
```

`tmct init` sets up a repo for the first time: `.tmct/`, `tmct.toml`, a seed, and a
provenance record. Most of its flags choose what gets seeded and where config is written:

```
  tmct init [--repo <abs>]     initialize a repo for tmct (default: cwd): .tmct/,
       [--force]               tmct.toml, tier-1 corpus seed, provenance record
       [--corpus <id|path>]    also seed a corpus — a tier-2 manifest id (aws|python|java|
                               general) or a jsonl file path — opt-in, offline, $0
       [--ontology <name|path>]  activate+seed an ontology bundle (a recognized name or a path)
       [--lexicon <name|path>]   activate a lexicon bundle (recognized name or a path;
                               merged read-time, never seeded — see mergedLexiconExtra)
       [--graph <path>]        set graph_file/graph_files in tmct.toml (repeatable)
       [--config <path>]       write to an alternate tmct.toml location
       [--detect]              suggest a tier-2 corpus from the repo's manifests
                               (pyproject.toml → python, pom.xml → java); never seeds unasked
       [--with-persona <name>] write an explicit [extensions]/[bias] preset into tmct.toml
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

```
  tmct import [--repo <abs>]   activate+seed into an ALREADY-initialized repo (any
       [--corpus <id|path>]    combination of these flags in one call). --graph is a
       [--ontology <name|path>]  DIFFERENT operation from the others: it APPENDS to
       [--lexicon <name|path>]   tmct.toml's graph_files array (multi-graph growth),
       [--graph <path>]        never an extensions-bundle activation.
       [--memory-backend <default|memory|sqlite>]  same knob as `tmct init`
       [--config <path>]
```

`tmct extend --validate` checks a third-party extension pack's declared resources
before you switch any repo's `tmct.toml` over to it:

```
  tmct extend --validate <dir>  validate a third-party extension pack's declared
       [--config <path>]      resources (corpus/lexicon/templates) before activating
                               it in any repo's tmct.toml; exits non-zero on failure
```

`tmct syllogise` is the offline maintenance job described under "Speculative
inference" above:

```
  tmct syllogise [--repo <abs>] speculative inference (offline maintenance job): forward-
       [--depth <n>] [--budget <n>]  chain the memory's rdfs:subClassOf closure, materialising
       [--config <path>]      bounded, low-trust, retractable entailed facts (never on the chat path)
```

`tmct viz` renders the memory graph to a single HTML file you can open in a browser:

```
  tmct viz [--repo <abs>]      write one self-contained, navigable HTML file rendering the
       [--focus <id>]         memory graph: pan/zoom, click a node for its label/class/
       [--term <word>]        timestamps. Seeds from the most recently created individual
       [--depth <n>]          by default (--focus <id> or --term <word> override it);
       [--limit <n>]          --output defaults to graph.html in the cwd.
       [--hub-degree <n>]     --depth = max arcs (hops) from the focus node (default 3);
       [--edge-kind <mode>]   --limit = spiral length, total nodes walked (default 300);
       [--output <path>]      --hub-degree = stop expanding THROUGH a node above N
       [--config <path>]      connections, still shows it (default 40); --edge-kind =
                               meta|relation|both (default both) — which edge kinds the
                               walk follows (provenance-only, concept-relations-only, or
                               both — see the page's own edge-kind toggle to change this
                               live); --term <word> resolves to the Fact(s) whose subject/
                               object normalizes to that word and seeds from there.
```

`tmct serve` runs an Anthropic Messages API-compatible HTTP endpoint over the graph,
so a tool-loop client can call tmct like a model, at $0:

```
  tmct serve [--repo <abs>]    run the Anthropic Messages API-compatible endpoint
       [--host <h>] [--port <n>]  (POST /v1/messages) over the graph — a deterministic,
       [--graph <path>]        no-LLM "model" a tool-loop client can call; $0 usage.
       [--config <path>]       Defaults: host 127.0.0.1, port 8787. Ctrl+C to stop.
```

`tmct cli` is a lower-level, carry-over surface for invoking a graph tool directly:

```
  tmct cli <tool> '{…}'        invoke a graph tool directly (carry-over, de-emphasized)
  tmct cli digest '{…}'        architecture map + per-module context bundles
```

Two precedence chains apply across every command above, in this order:

```
Shared graph-path precedence (chat/serve; see src/cli-args.mjs): --graph flag(s) >
TMCT_GRAPH_FILE env > tmct.toml graph_file/graph_files > --repo-derived
<repo>/.tmct/graph.json > git-root/cwd default.

Memory-backend precedence (chat; see src/chat.mjs createSession): --memory-backend
flag > TMCT_MEMORY_BACKEND env > tmct.toml [memory] backend > "default" (the flat
.tmct/ JSON file). Set it once with `tmct init --memory-backend <...>` and every
later `tmct chat` in that repo picks it up with no flag needed.
```

`npm run init:large` in `package.json` chains one `init` and five `import --corpus`
calls to combine every shipped bundle (human persona + seon + conceptnet +
aws/python/java) into ~7,380 facts on the default flat-JSON backend, a working
example to copy from.

### tmct.toml reference

`tmct init` writes a sparse `tmct.toml` with just the keys it needs. The file
recognizes more keys than that default covers. Below is one config with every
recognized key set, so you can see the full surface in one place
(`src/toml-config.mjs` is the source of truth; `src/extensions.mjs` defines the
`[extensions.*]`/`[bias]` shape).

```toml
# Newline-delimited-file form is also accepted: repositories = "repos.txt"
repositories = ["../other-service", "../another-service"]

# Where generated output (e.g. tmct viz's default graph.html) resolves to.
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

# Flat bundle-name -> weight table, consumed by src/memory/bias.mjs's ranking.
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
```

### Try it on an example graph

tmct *consumes* a code graph at `<repo>/.tmct/graph.json`. It does not build
one. Two ready-made example graphs live in `examples/` in this repo (clone the
repo to use them; they are not in the published npm package), so you can see
it answer real questions with no setup:

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
reason" above). It works over injectable streams, so a script can drive a
session the same way the tests do. `ask`/`resolveObject` are the lower-level,
read-only query primitives over an already-loaded graph, for a caller that
wants to query without a chat session. The `exports` map and the chat
primitives (`ask`, `resolveObject`, `relationKind`, `impactClosure`,
`dispatchTool`, `fetchEntities`) are the extension surface.

## The repository interface

tmct is not an indexer, so it consumes a graph through a typed contract any
producer can implement. That contract is first-class: a **versioned (1.0.0),
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
published as `@polycode-projects/mct`), and was then reshaped. The LLM
fallback, the code-extraction stack, and the MCP server were all removed. The
naming, license, and memory model were reset to the vision above. See
`ROADMAP.md` for the phase plan.

## Licensing

**MPL-2.0.** Free for commercial use. If you modify the covered files and
distribute them, you must publish those files' source under the MPL with
attribution. The copyleft applies file by file, not to the whole project. See
`LICENSE`.

Corpus data carries its own licenses, separate from the code: the shipped
ConceptNet slice is **CC-BY-SA 4.0**, with its own notice alongside it.

© Polycode Limited.
