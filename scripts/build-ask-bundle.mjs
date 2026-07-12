// build-ask-bundle.mjs — bundle tmct's own ask engine for `tmct viz`'s embedded
// "Ask the graph" panel (PLAN_BREADTH_FIRST_NLU.md §5 follow-on).
//
// esbuild bundles src/ask-browser-entry.mjs into a single IIFE at
// src/ask-browser.bundle.js, which viz.mjs inlines verbatim into the viewer
// page. Regenerate after touching src/ask.mjs/src/codegraph.mjs and their
// dependents: `npm run build:ask-bundle`.
//
// Adapted directly from seonix's own scripts/build-ask-bundle.mjs (proven in
// production for its "Ask the graph" website panel) — same Node-builtin-stub
// approach, extended with tmct-specific stubs for the THREE optional-adapter
// imports the source itself already documents as strip-compatible (see each
// file's own "inlined viewer bundle" comments): ask-nlp.mjs (wink — a ~4MB
// model tmct's own architecture deliberately keeps out of any browser bundle),
// grammar/strategies/ace.mjs and interpret/strategies/constructions.mjs (both
// fs-dependent — read a committed lexicon/template file at import time, never
// available in a browser). Each real call site already guards with a
// `typeof X !== "undefined"` check for exactly this degradation, so a stub
// exporting the binding as `undefined` reproduces the intended graceful
// fallback, not a crash or a silent behavior change.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, "..", "src", "ask-browser-entry.mjs");
const OUT = join(here, "..", "src", "ask-browser.bundle.js");

const stubNodeBuiltins = {
  name: "stub-node-builtins",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: "node-stub" }));
    b.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
      // A broad, generic set — every fs/promises/path/url/crypto binding any
      // guarded/lazy path in tmct's import graph might reference at LINK time.
      // Each throws only if actually CALLED, which no path this bundle's real
      // entry point (ask-browser-entry.mjs) exercises ever does (persistence,
      // source-file reads, and the optional adapters are all guarded or
      // stubbed separately — see stubOptionalAdapters below).
      contents:
        "const unavailable = (name) => () => { throw new Error(name + ' unavailable in the browser ask bundle'); };\n"
        + "export const createRequire = unavailable('createRequire');\n"
        + "export const readFileSync = unavailable('readFileSync');\n"
        + "export const writeFileSync = unavailable('writeFileSync');\n"
        + "export const readFile = unavailable('readFile');\n"
        + "export const writeFile = unavailable('writeFile');\n"
        + "export const appendFile = unavailable('appendFile');\n"
        + "export const mkdir = unavailable('mkdir');\n"
        + "export const rename = unavailable('rename');\n"
        + "export const unlink = unavailable('unlink');\n"
        + "export const rm = unavailable('rm');\n"
        + "export const stat = unavailable('stat');\n"
        + "export const access = unavailable('access');\n"
        + "export const copyFile = unavailable('copyFile');\n"
        + "export const readdir = unavailable('readdir');\n"
        + "export const existsSync = () => false;\n"
        + "export const join = (...a) => a.join('/');\n"
        + "export const dirname = (p) => String(p).replace(/\\/[^/]*$/, '');\n"
        + "export const resolve = (...a) => a.join('/');\n"
        + "export const basename = (p) => String(p).split('/').pop();\n"
        + "export const extname = (p) => { const m = /\\.[^./]+$/.exec(String(p)); return m ? m[0] : ''; };\n"
        + "export const fileURLToPath = (u) => String(u);\n"
        + "export const pathToFileURL = (p) => new URL('file://' + p);\n"
        + "export const randomBytes = unavailable('randomBytes');\n"
        + "export const createHash = unavailable('createHash');\n"
        + "export const createRequireFromPath = unavailable('createRequireFromPath');\n"
        + "export default {};\n",
      loader: "js",
    }));
  },
};

// The three optional-adapter modules tmct's own source already documents as
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

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: OUT,
  legalComments: "none",
  logLevel: "info",
  plugins: [stubOptionalAdapters, stubNodeBuiltins],
  define: { "process.env.NODE_ENV": '"production"' },
});

if (result.errors.length) {
  console.error(result.errors);
  process.exit(1);
}
console.log(`built ${OUT}`);
