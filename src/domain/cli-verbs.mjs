// The CLI's verb list — the one place a tmct subcommand is written down. Both
// surfaces that name the verbs read this: `tmct --help` renders the Usage block
// from it (renderUsage), and an unknown invocation restates it
// (unknownInvocationMessage). Two hand-kept copies of one list is how the two
// drifted before.
//
// `mode` is the argv[2] the bin/tmct.mjs dispatcher switches on, and null for
// an entry that is not a mode of its own (a bare invocation, --help).
// `errorLabel` is how the unknown-invocation line names the verb; an entry
// without one is not something to suggest.
//
// Layout: two columns. The verb or flag starts at column 2 (a continuation
// flag at column 7), and its prose at column 31, or two spaces further right
// when the left column runs past that.
const PROSE_COLUMN = 31;

export const CLI_VERBS = [
  {
    mode: null,
    usage: "tmct",
    prose: ["interactive chat (the headline surface)"],
  },
  {
    mode: "chat",
    errorLabel: "chat",
    usage: "tmct chat [--repo <abs>]",
    prose: ["chat over a specific repo's graph"],
    flags: [
      { flag: "[--graph <path>]", prose: ["explicit graph file (repeatable — multiple graphs merge;", "see src/adapters/graph-merge.mjs); wins over --repo/TMCT_GRAPH_FILE/tmct.toml"] },
      { flag: "[--config <path>]", prose: ["an alternate tmct.toml location (a file or a directory)"] },
      { flag: "[--ephemeral]", prose: ["read the graph but write nothing back (demo/read-only)"] },
      { flag: "[--prompt \"<text>\"]", prose: ["one-shot: run the prompt's sentences as turns and print", "the final answer (teach state first, trigger last)"] },
      { flag: "[--render blocks]", prose: ["with --prompt: when the final turn produced a plan,", "write it as a self-contained animated page"] },
      { flag: "[--render spider-fly|adventure|sprites]", prose: ["write that demo view as one self-contained", "page (no --prompt; the game pages inline their engine)"] },
      { flag: "[--output <path>]", prose: ["the rendered page's path (default plan.html for", "blocks, <archetype>.html for the views)"] },
      { flag: "[--narrate]", prose: ["start with narrate mode on — a verbose, developer-facing", "trace of decision points/matched pattern/results/goal per", "turn, appended under a \"--- narrate ---\" marker (also", "TMCT_NARRATE=1; toggle mid-session with /narrate on|off)"] },
      { flag: "[--live-wikipedia]", prose: ["start with the live Wikipedia supplement on — a question", "nothing local can answer also tries en.wikipedia.org,", "cited (network; also TMCT_LIVE_WIKIPEDIA=1 or tmct.toml", "corpus tier3; toggle mid-session with /wiki on|off)"] },
      { flag: "[--plain]", prose: ["force the plain readline shell (the default when", "stdin/stdout is not a terminal)"] },
      { flag: "[--memory-backend <default|memory|sqlite>]", prose: ["storage backend for taught facts this", "session (CLI flag > TMCT_MEMORY_BACKEND env > tmct.toml's", "[memory] backend > sqlite, .tmct/memory/graph.sqlite)"] },
    ],
  },
  {
    mode: "memory",
    errorLabel: "memory",
    usage: "tmct memory [--repo <abs>]",
    prose: ["what tmct remembers: facts, utterances, sessions,"],
    flags: [
      { flag: "[--config <path>]", prose: ["folded blocks (the /memory chat command, from the shell)"] },
      { flag: "[--verbose]", prose: [] },
      { flag: "[--export <file.jsonl>]", prose: ["write every stored fact as JSONL (subject/predicate/object/", "provenance) to a file and exit — the shape `tmct extract`", "emits, for audit or backup"] },
    ],
  },
  {
    mode: "init",
    errorLabel: "init",
    usage: "tmct init [--repo <abs>]",
    prose: ["initialize a repo for tmct (default: cwd): .tmct/,"],
    flags: [
      { flag: "[--force]", prose: ["tmct.toml, .tmct/TOOLS.md (the cold-tool catalog),", "tier-1 corpus seed, provenance record"] },
      { flag: "[--corpus <id|path>]", prose: ["also seed a corpus — a tier-2 manifest id (aws|python|java|", "general) or a jsonl file path — opt-in, offline, $0"] },
      { flag: "[--ontology <name|path>]", prose: ["activate+seed an ontology bundle (a recognized name or a path)"] },
      { flag: "[--lexicon <name|path>]", prose: ["activate a lexicon bundle (recognized name or a path;", "merged read-time, never seeded — see mergedLexiconExtra)"] },
      { flag: "[--graph <path>]", prose: ["set graph_file/graph_files in tmct.toml (repeatable)"] },
      { flag: "[--config <path>]", prose: ["write to an alternate tmct.toml location"] },
      { flag: "[--detect]", prose: ["suggest a tier-2 corpus from the repo's manifests", "(pyproject.toml → python, pom.xml → java); never seeds unasked"] },
      { flag: "[--with-persona <name>]", prose: ["write an explicit [extensions]/[bias] preset into tmct.toml", "(\"code\" — today's implicit default, made explicit)"] },
      { flag: "[--persona-size <medium|large>]", prose: ["grow the default \"human\" persona's fact count", "beyond Small (the default): \"medium\" activates", "human-medium.jsonl (~1,608 facts total), \"large\" also", "activates human-large.jsonl (~13,600 facts total,", "with genuine multi-hop hypernym chains) — additive", "size tiers of the SAME bundle, not separate personas"] },
      { flag: "[--memory-backend <default|memory|sqlite>]", prose: ["write tmct.toml's [memory] backend", "(same flag name as `tmct chat`) — a later `tmct chat`", "in this repo picks it up with no flag needed"] },
    ],
  },
  {
    mode: "import",
    errorLabel: "import",
    usage: "tmct import [--repo <abs>]",
    prose: ["activate+seed into an ALREADY-initialized repo (any"],
    flags: [
      { flag: "[--corpus <id|path>]", prose: ["combination of these flags in one call). --graph is a"] },
      { flag: "[--ontology <name|path>]", prose: ["DIFFERENT operation from the others: it APPENDS to"] },
      { flag: "[--lexicon <name|path>]", prose: ["tmct.toml's graph_files array (multi-graph growth),"] },
      { flag: "[--graph <path>]", prose: ["never an extensions-bundle activation."] },
      { flag: "[--file <defs.txt|facts.jsonl>]", prose: ["teach a definition file: a .txt taught sentence by", "sentence (# lines are comments; a declined sentence exits", "non-zero, named), or a .jsonl triple dump loaded fact by", "fact, keeping each line's own provenance"] },
      { flag: "[--memory-backend <default|memory|sqlite>]", prose: ["same knob as `tmct init`"] },
      { flag: "[--config <path>]", prose: [] },
    ],
  },
  {
    mode: "extract",
    errorLabel: "extract",
    usage: "tmct extract <text-file>",
    prose: ["read a plain text file's sentences through the chat's own"],
    flags: [
      { flag: "[--file <text-file>]", prose: ["teach recognizer and keep the facts it grounds; every", "other sentence is skipped and counted, never paraphrased"] },
      { flag: "[--repo <abs>]", prose: ["write the facts into that repo's own tmct memory; without", "it nothing on disk is mutated and the facts print as JSONL"] },
      { flag: "[--out <file.jsonl>]", prose: ["write that JSONL to a file instead of stdout"] },
    ],
  },
  {
    mode: "extend",
    errorLabel: "extend --validate",
    usage: "tmct extend --validate <dir>",
    prose: ["validate a third-party extension pack's declared"],
    flags: [
      { flag: "[--config <path>]", prose: ["resources (corpus/lexicon/templates) before activating", "it in any repo's tmct.toml; exits non-zero on failure"] },
    ],
  },
  {
    mode: "syllogise",
    errorLabel: "syllogise",
    usage: "tmct syllogise [--repo <abs>]",
    prose: ["speculative inference (offline maintenance job): a deterministic"],
    flags: [
      { flag: "[--depth <n>] [--budget <n>]", prose: ["forward-chaining materialisation over OWL 2 RL rule kernels"] },
      { flag: "[--config <path>]", prose: ["(the classical syllogism among them), writing bounded, low-trust,", "retractable entailed facts (never on the chat path)"] },
    ],
  },
  {
    mode: "viz",
    errorLabel: "viz",
    usage: "tmct viz [--repo <abs>]",
    prose: ["write one self-contained HTML page: the memory graph as a"],
    flags: [
      { flag: "[--focus <term>]", prose: ["readable ledger of fact-sentences around one focus term,"] },
      { flag: "[--term <word>]", prose: ["with segments, a two-hop minimap, and an in-page chat dock"] },
      { flag: "[--limit <n>]", prose: ["that answers from the embedded graph. Focuses on the newest"] },
      { flag: "[--output <path>]", prose: ["taught fact's subject by default (--focus <term> or"] },
      { flag: "[--config <path>]", prose: ["--term <word> override it); --output defaults to", "ledger.html in the cwd; --limit caps the embedded fact", "rows; --term resolves via the same normalization chat uses."] },
    ],
  },
  {
    mode: "serve",
    errorLabel: "serve",
    usage: "tmct serve [--repo <abs>]",
    prose: ["run the Anthropic Messages API-compatible endpoint"],
    flags: [
      { flag: "[--host <h>] [--port <n>]", prose: ["(POST /v1/messages) over the graph — a deterministic,"] },
      { flag: "[--graph <path>]", prose: ["no-LLM \"model\" a tool-loop client can call; $0 usage."] },
      { flag: "[--config <path>]", prose: ["Defaults: host 127.0.0.1, port 8787. Ctrl+C to stop."] },
    ],
  },
  {
    mode: "plan",
    errorLabel: "plan",
    usage: "tmct plan \"<request>\"",
    prose: ["the capability router: compose/execute read-only graph-"],
    flags: [
      { flag: "[--repo <abs>]", prose: ["query tool calls for a compound or maintenance-goal"] },
      { flag: "[--graph <path>]", prose: ["request (\"of the modules impacted by X, which are"] },
      { flag: "[--config <path>]", prose: ["untested\", \"what most needs a test\") — a real STRIPS/"] },
      { flag: "[--tools <a,b,...>]", prose: ["PDDL planner (src/domain/router/*), never a guessed call."] },
      { flag: "[--json]", prose: ["Prints the grounded step sequence + composed answer,", "or an honest \"no plan found\". --tools restricts the", "declared toolset; --json prints the full loop result."] },
    ],
  },
  {
    mode: "cli",
    errorLabel: "cli <tool> …",
    usage: "tmct cli <tool> '{…}'",
    prose: ["invoke a graph tool directly (carry-over, de-emphasized)"],
    flags: [
      { flag: "[--repo <abs>]", prose: ["the repo to answer from; the payload's \"repo_path\" says"] },
      { flag: "[--graph <path>]", prose: ["the same thing. --graph names the graph file outright"] },
      { flag: "[--config <path>]", prose: ["(repeatable), --config an alternate tmct.toml"] },
    ],
  },
  {
    mode: "cli",
    errorLabel: "cli digest …",
    usage: "tmct cli digest '{…}'",
    prose: ["architecture map + per-module context bundles"],
  },
  {
    mode: null,
    usage: "tmct --help",
    prose: ["show this help"],
  },
];

function twoColumn(indent, left, prose) {
  const head = " ".repeat(indent) + left;
  if (!prose.length) return [head];
  const column = Math.max(PROSE_COLUMN, head.length + 2);
  return [head.padEnd(column) + prose[0], ...prose.slice(1).map((p) => " ".repeat(PROSE_COLUMN) + p)];
}

/** The `Usage:` block of `tmct --help`, rendered from CLI_VERBS. */
export function renderUsage() {
  const lines = [];
  for (const { usage, prose, flags = [] } of CLI_VERBS) {
    lines.push(...twoColumn(2, usage, prose));
    for (const f of flags) lines.push(...twoColumn(7, f.flag, f.prose));
  }
  return lines.join("\n");
}

/** Every verb the dispatcher answers to, deduplicated (`cli` is two entries). */
export function dispatchableModes() {
  return [...new Set(CLI_VERBS.map((v) => v.mode).filter(Boolean))];
}

/** What an unknown invocation is told, naming every verb there is. */
export function unknownInvocationMessage(invocation) {
  const labels = CLI_VERBS.map((v) => v.errorLabel).filter(Boolean).map((l) => `\`${l}\``);
  const suggestions = `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
  return `tmct: unknown invocation "${invocation}". Use ${suggestions}.\n`;
}
