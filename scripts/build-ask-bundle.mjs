// build-ask-bundle.mjs — bundle tmct's own ask engines for `tmct viz`'s
// embedded "Ask the graph" panel (PLAN_BREADTH_FIRST_NLU.md §5 follow-on;
// PLAN_VIZ_MEMORY.md Bug 1 fix adds the SECOND bundle below).
//
// Builds TWO independent IIFE bundles from the SAME shared stub plugins:
//   - src/ask-browser-entry.mjs -> src/ask-browser.bundle.js — tmct's
//     CODE-GRAPH query engine (ask.mjs): "which modules import X", generic
//     "where is X mentioned" navigation. Unchanged from before this session.
//   - src/memory-ask-browser-entry.mjs -> src/memory-ask-browser.bundle.js —
//     tmct's MEMORY-graph answer engine (chat.mjs's factAnswer, the same one
//     `npm run chat` uses): "what is a dog", "what is a horse used for". Bug 1
//     fix — the code-graph engine above has no concept of Facts/corpus data at
//     all, so a memory-graph question always missed even though the page's
//     own embedded payload had the answer.
// Both are inlined verbatim into the viewer page by viz.mjs's renderVizHtml;
// the page queries whichever one actually answers (see viz.mjs's client JS).
// Regenerate after touching src/ask.mjs/src/chat.mjs/src/codegraph.mjs and
// their dependents: `npm run build:ask-bundle`.
//
// Adapted directly from seonix's own scripts/build-ask-bundle.mjs (proven in
// production for its "Ask the graph" website panel) — same Node-builtin-stub
// approach, extended with tmct-specific stubs for the optional-adapter
// imports the source itself already documents as strip-compatible (see each
// file's own "inlined viewer bundle" comments): ask-nlp.mjs (wink — a ~4MB
// model tmct's own architecture deliberately keeps out of any browser bundle),
// grammar/strategies/ace.mjs and interpret/strategies/constructions.mjs (both
// fs-dependent — read a committed lexicon/template file at import time, never
// available in a browser). Each real call site already guards with a
// `typeof X !== "undefined"` check for exactly this degradation, so a stub
// exporting the binding as `undefined` reproduces the intended graceful
// fallback, not a crash or a silent behavior change.
//
// The memory-ask bundle pulls in nearly all of chat.mjs's own transitive
// import graph (it's a monolith — factAnswer shares the module with every
// other lane) — none of that extra code ever RUNS (factAnswer's only real I/O
// is loadMemory(memoryDir), and the panel always hands it an in-memory
// Backend-B handle already carrying the page's payload — see
// src/memory-ask-browser-entry.mjs's own doc comment), it just has to
// LINK. The node-builtin stub set below is broad enough to satisfy every
// named import reachable from either entry point; page weight is not a
// constraint here (operator directive, PLAN_VIZ_MEMORY.md's page-size
// strategy — this is a local file:// artifact, not something downloaded).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const stubNodeBuiltins = {
  name: "stub-node-builtins",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: "node-stub" }));
    b.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
      // A broad, generic set — every fs/promises/path/url/crypto/os/child_process/
      // readline/sqlite binding any guarded/lazy path in tmct's import graph might
      // reference at LINK time (both entry points' full transitive import graphs,
      // not just what each one's OWN code calls). Each throws only if actually
      // CALLED, which no path either entry point's real, exercised call chain
      // ever does (persistence, source-file reads, the optional adapters, and
      // node:sqlite's opt-in Backend C are all guarded, lazy, or stubbed
      // separately — see stubOptionalAdapters below).
      contents:
        "const unavailable = (name) => () => { throw new Error(name + ' unavailable in the browser ask bundle'); };\n"
        + "export const createRequire = unavailable('createRequire');\n"
        + "export const readFileSync = unavailable('readFileSync');\n"
        + "export const writeFileSync = unavailable('writeFileSync');\n"
        + "export const readFile = unavailable('readFile');\n"
        + "export const writeFile = unavailable('writeFile');\n"
        + "export const appendFile = unavailable('appendFile');\n"
        + "export const mkdir = unavailable('mkdir');\n"
        + "export const mkdtemp = unavailable('mkdtemp');\n"
        + "export const rename = unavailable('rename');\n"
        + "export const unlink = unavailable('unlink');\n"
        + "export const rm = unavailable('rm');\n"
        + "export const stat = unavailable('stat');\n"
        + "export const access = unavailable('access');\n"
        + "export const copyFile = unavailable('copyFile');\n"
        + "export const readdir = unavailable('readdir');\n"
        + "export const createReadStream = unavailable('createReadStream');\n"
        + "export const createWriteStream = unavailable('createWriteStream');\n"
        + "export const existsSync = () => false;\n"
        + "export const join = (...a) => a.join('/');\n"
        + "export const dirname = (p) => String(p).replace(/\\/[^/]*$/, '');\n"
        + "export const resolve = (...a) => a.join('/');\n"
        + "export const isAbsolute = (p) => String(p).startsWith('/');\n"
        + "export const basename = (p) => String(p).split('/').pop();\n"
        + "export const extname = (p) => { const m = /\\.[^./]+$/.exec(String(p)); return m ? m[0] : ''; };\n"
        + "export const sep = '/';\n"
        + "export const fileURLToPath = (u) => String(u);\n"
        + "export const pathToFileURL = (p) => new URL('file://' + p);\n"
        + "export const randomBytes = unavailable('randomBytes');\n"
        + "export const createHash = unavailable('createHash');\n"
        + "export const createRequireFromPath = unavailable('createRequireFromPath');\n"
        + "export const spawnSync = unavailable('spawnSync');\n"
        + "export const createInterface = unavailable('createInterface');\n"
        + "export const tmpdir = () => '/tmp';\n"
        + "export const DatabaseSync = unavailable('DatabaseSync');\n"
        + "export default {};\n",
      loader: "js",
    }));
  },
};

// Optional-adapter modules tmct's own source already documents as
// strip-compatible (see each real import site's "inlined viewer bundle"
// comment in src/ask.mjs / src/interpret/pipeline.mjs). Stubbed as an explicit
// `undefined` export, not an empty module — the calling code's own
// `typeof X !== "undefined"` guards depend on the binding existing and being
// exactly `undefined`, not on the import simply failing to resolve.
const OPTIONAL_ADAPTER_STUBS = {
  "ask-nlp.mjs": "export const nlpAdapter = undefined;\n",
  "strategies/ace.mjs": "export const aceStrategy = undefined;\nexport const parseAceAmbiguous = undefined;\n",
  "strategies/constructions.mjs": "export const constructionsStrategy = undefined;\n",
};
const stubOptionalAdapters = {
  name: "stub-optional-adapters",
  setup(b) {
    for (const suffix of Object.keys(OPTIONAL_ADAPTER_STUBS)) {
      const filter = new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
      b.onResolve({ filter }, (args) => ({ path: args.path, namespace: "adapter-stub-" + suffix }));
      b.onLoad({ filter: /.*/, namespace: "adapter-stub-" + suffix }, () => ({
        contents: OPTIONAL_ADAPTER_STUBS[suffix], loader: "js",
      }));
    }
  },
};

async function buildOne(entryFile, outFile) {
  const result = await build({
    entryPoints: [join(srcDir, entryFile)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: join(srcDir, outFile),
    legalComments: "none",
    logLevel: "info",
    plugins: [stubOptionalAdapters, stubNodeBuiltins],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (result.errors.length) {
    console.error(result.errors);
    process.exit(1);
  }
  console.log(`built ${join(srcDir, outFile)}`);
}

await buildOne("ask-browser-entry.mjs", "ask-browser.bundle.js");
await buildOne("memory-ask-browser-entry.mjs", "memory-ask-browser.bundle.js");
