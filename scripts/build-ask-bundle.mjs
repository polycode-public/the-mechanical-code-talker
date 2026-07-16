// build-ask-bundle.mjs — bundle tmct's memory-graph answer engine for the
// ledger page's in-browser chat dock (PLAN_VIZ_LEDGER.md).
//
// Builds ONE IIFE bundle:
//   - src/memory-ask-browser-entry.mjs -> src/memory-ask-browser.bundle.js —
//     tmct's MEMORY-graph answer engine (chat.mjs's factAnswer/factReadBack,
//     the same ones `npm run chat` uses): "what is a dog", "who is the
//     grandfather of ishmael".
// It's inlined verbatim into the page by ledger-viz.mjs's renderLedgerHtml.
// Regenerate after touching src/chat.mjs and its dependents:
// `npm run build:ask-bundle`.
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
// is loadMemory(memoryDir), and the dock always hands it an in-memory
// Backend-B handle already carrying the page's payload — see
// src/memory-ask-browser-entry.mjs's own doc comment), it just has to
// LINK. The node-builtin stub below carries exactly the bindings that graph
// still references — measured by dropping each and letting esbuild name what
// breaks, so it shrinks as the monolith's link edges do.
import { build } from "esbuild";
import { writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const stubNodeBuiltins = {
  name: "stub-node-builtins",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: "node-stub" }));
    b.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
      // Exactly the node-builtin bindings that are REACHABLE at link time from
      // the entry point's full transitive import graph — no more. The set is
      // measured, not guessed: dropping an export and rebuilding makes esbuild
      // name any module that still imports it. Two kinds of survivor:
      //   - path shims that actually RUN — join/dirname/resolve/isAbsolute/
      //     basename/sep/fileURLToPath do path math on constant paths, plus
      //     existsSync (→ false) and tmpdir (→ /tmp) on guarded paths;
      //   - throwers that only LINK — the fs/promises + fs stream + crypto +
      //     child_process + readline bindings the monolith's persistence,
      //     seed, corpus-slice, and session-layer modules reference but the
      //     dock's factAnswer/factReadBack call chain never executes (it reads
      //     an in-memory Backend-B handle). They throw only if actually called.
      // Bindings no reachable module imports were removed here: writeFileSync,
      // access, extname, pathToFileURL, createHash, createRequireFromPath,
      // createServer (surfaces only), and DatabaseSync (node:sqlite Backend C,
      // opt-in and never selected in the browser — the store seam keeps it out).
      contents:
        "const unavailable = (name) => () => { throw new Error(name + ' unavailable in the browser ask bundle'); };\n"
        + "export const createRequire = unavailable('createRequire');\n"
        + "export const readFileSync = unavailable('readFileSync');\n"
        + "export const readFile = unavailable('readFile');\n"
        + "export const writeFile = unavailable('writeFile');\n"
        + "export const appendFile = unavailable('appendFile');\n"
        + "export const mkdir = unavailable('mkdir');\n"
        + "export const mkdtemp = unavailable('mkdtemp');\n"
        + "export const rename = unavailable('rename');\n"
        + "export const unlink = unavailable('unlink');\n"
        + "export const rm = unavailable('rm');\n"
        + "export const stat = unavailable('stat');\n"
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
        + "export const sep = '/';\n"
        + "export const fileURLToPath = (u) => String(u);\n"
        + "export const randomBytes = unavailable('randomBytes');\n"
        + "export const spawnSync = unavailable('spawnSync');\n"
        + "export const createInterface = unavailable('createInterface');\n"
        + "export const tmpdir = () => '/tmp';\n"
        + "export default {};\n",
      loader: "js",
    }));
  },
};

// Optional-adapter modules tmct's own source already documents as
// strip-compatible (see each real import site's "inlined viewer bundle"
// comment in src/domain/ask.mjs / src/domain/interpret/pipeline.mjs). Stubbed as an explicit
// `undefined` export, not an empty module — the calling code's own
// `typeof X !== "undefined"` guards depend on the binding existing and being
// exactly `undefined`, not on the import simply failing to resolve.
// Keys are matched as a SUFFIX of the import specifier as each importer writes
// it, so a key carries just enough trailing path to be unambiguous and keeps
// matching wherever the module itself lives.
const OPTIONAL_ADAPTER_STUBS = {
  "ask-nlp.mjs": "export const nlpAdapter = undefined;\n",
  "strategies/ace.mjs": "export const aceStrategy = undefined;\nexport const parseAceAmbiguous = undefined;\n",
  "strategies/constructions.mjs": "export const constructionsStrategy = undefined;\nexport const setConstructionBanks = () => {};\n",
  // the fs+TOML side of the construction banks — never read in the browser
  // (the strategy above is stubbed out entirely).
  "corpus/construction-banks.mjs": "export const CONSTRUCTIONS_DIR = \"\";\nexport const readConstructionFiles = () => ({ relations: [], constructions: [] });\n",
  // phrasing variety stays OFF in the dock — the browser answer is always the
  // base phrase, exactly as it was when the variants file couldn't be read.
  "answer-variants.mjs": "export const pickPhrase = (poolId, key, base) => base;\n",
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
  const outPath = join(srcDir, outFile);
  const result = await build({
    entryPoints: [join(srcDir, entryFile)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: outPath,
    write: false,
    legalComments: "none",
    logLevel: "info",
    plugins: [stubOptionalAdapters, stubNodeBuiltins],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (result.errors.length) {
    console.error(result.errors);
    process.exit(1);
  }
  // Write-then-rename so a concurrent reader (`tmct viz` inlining the bundle,
  // a test evaluating it in a vm) always sees a complete file, old or new,
  // never a truncated one mid-write.
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, result.outputFiles[0].contents);
  await rename(tmpPath, outPath);
  console.log(`built ${outPath}`);
}

await buildOne("memory-ask-browser-entry.mjs", "memory-ask-browser.bundle.js");
