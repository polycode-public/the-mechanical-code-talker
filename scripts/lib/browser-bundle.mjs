// scripts/lib/browser-bundle.mjs — the shared esbuild machinery behind tmct's
// browser bundles (build-ask-bundle.mjs, build-chat-bundle.mjs): the
// node-builtin stub plugin, the optional-adapter stub factory, and the
// build-then-atomic-write step. Each builder keeps its own entry point, output
// path and stub selection; everything mechanical lives here once.
import { build } from "esbuild";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "src");

export const stubNodeBuiltins = {
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
      // extname, pathToFileURL, createHash, createRequireFromPath,
      // createServer (surfaces only), and DatabaseSync (node:sqlite Backend C,
      // opt-in and never selected in the browser — the store seam keeps it out).
      contents:
        "const unavailable = (name) => () => { throw new Error(name + ' unavailable in the browser ask bundle'); };\n"
        + "export const createRequire = unavailable('createRequire');\n"
        + "export const readFileSync = unavailable('readFileSync');\n"
        + "export const access = unavailable('access');\n"
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

// node:zlib carries gunzipSync for the reference pack's fs loader, whose own
// try/catch treats a throw as an absent pack — the browser path registers a
// fetch provider instead, so the thrower is the intended degradation. Both
// bundles link it now that chat.mjs's learn-on-miss hooks import the pack
// adapter directly. A separate plugin (not a stubNodeBuiltins export) so the
// zlib resolve never falls through to the generic node stub's export list.
export const stubNodeZlib = {
  name: "stub-node-zlib",
  setup(b) {
    b.onResolve({ filter: /^node:zlib$/ }, (args) => ({ path: args.path, namespace: "node-zlib-stub" }));
    b.onLoad({ filter: /.*/, namespace: "node-zlib-stub" }, () => ({
      contents: "export const gunzipSync = () => { throw new Error('gunzipSync unavailable in a browser bundle'); };\nexport default {};\n",
      loader: "js",
    }));
  },
};

/** Build a stub plugin for optional-adapter modules a bundle strips (see each
 *  real import site's "inlined viewer bundle" comment). `stubMap` keys are
 *  matched as a SUFFIX of the import specifier as each importer writes it, so
 *  a key carries just enough trailing path to be unambiguous and keeps
 *  matching wherever the module itself lives; values are either a bare string
 *  (the replacement module source, resolved with no directory context — fine
 *  for a stub with no imports of its own) or `{contents, resolveDir}` when the
 *  stub itself needs to import a real sibling module (`resolveDir` is handed
 *  straight to esbuild's onLoad result so that import resolves as if the stub
 *  file actually lived there). A binding stubbed as an explicit `undefined`
 *  export (not an empty module) keeps the calling code's own
 *  `typeof X !== "undefined"` guards working.
 *
 *  onResolve reports the module's identity as the canonical SUFFIX key, not
 *  the raw specifier string each importer wrote (`args.path`) — two importers
 *  can spell the same target differently (a dynamic `import("../adapters/...")`
 *  three levels up vs. a static `import "../../adapters/..."` four levels
 *  up), and esbuild keys its module graph by that identity. Reporting the raw
 *  path would give each spelling its own virtual module instance, with its
 *  own top-level state — fatal for a stub that carries any (a live table a
 *  setter writes and a later reader reads back), so every spelling of one
 *  stub key resolves to the SAME module instance here. */
export function makeOptionalAdapterStubs(stubMap) {
  return {
    name: "stub-optional-adapters",
    setup(b) {
      for (const suffix of Object.keys(stubMap)) {
        const filter = new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
        const entry = stubMap[suffix];
        const contents = typeof entry === "string" ? entry : entry.contents;
        const resolveDir = typeof entry === "string" ? undefined : entry.resolveDir;
        b.onResolve({ filter }, () => ({ path: suffix, namespace: "adapter-stub-" + suffix }));
        b.onLoad({ filter: /.*/, namespace: "adapter-stub-" + suffix }, () => ({
          contents, loader: "js", ...(resolveDir ? { resolveDir } : {}),
        }));
      }
    },
  };
}

/** Bundle `entryFile` (relative to src/) into `outDir`/`outFile` as a classic
 *  IIFE browser script. Write-then-rename so a concurrent reader (a page
 *  inlining the bundle, a test evaluating it in a vm) always sees a complete
 *  file, old or new, never a truncated one mid-write. Minified by default —
 *  nothing depends on the shipped bundles being readable, and the wire cost
 *  is real. */
export async function buildBundle({ entryFile, outFile, outDir, plugins, minify = true }) {
  const outPath = join(outDir, outFile);
  const result = await build({
    entryPoints: [join(srcDir, entryFile)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: outPath,
    write: false,
    minify,
    legalComments: "none",
    logLevel: "info",
    plugins,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (result.errors.length) {
    console.error(result.errors);
    process.exit(1);
  }
  const tmpPath = `${outPath}.tmp-${process.pid}`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(tmpPath, result.outputFiles[0].contents);
  await rename(tmpPath, outPath);
  console.log(`built ${outPath}`);
  return outPath;
}
