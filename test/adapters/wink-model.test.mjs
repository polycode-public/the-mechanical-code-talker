// wink-model.test.mjs — the shared wink-nlp loader (winkInstance/registerWinkModel)
// and the bundler-collision invariant it exists to protect: no top-level
// `createRequire` declaration in this module's own source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { winkInstance } from "../../src/adapters/wink-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = join(here, "..", "..", "src", "adapters", "wink-model.mjs");

test("winkInstance() returns a working wink-nlp instance that tokenizes correctly", () => {
  const nlp = winkInstance();
  assert.ok(nlp, "winkInstance() returned null — are wink-nlp/wink-eng-lite-web-model installed?");
  const tokens = nlp.readDoc("The cats are running.").tokens().out();
  assert.deepEqual(tokens, ["The", "cats", "are", "running", "."]);
});

test("winkInstance() is memoized across calls", () => {
  assert.equal(winkInstance(), winkInstance());
});

test("the module source declares no top-level createRequire import", async () => {
  const source = await readFile(modulePath, "utf8");
  const codeLines = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  // A top-level `import { createRequire } from "..."` declares a binding a
  // bundler's own auto-injected CJS-interop shim can collide with — see this
  // file's own docblock. `createRequire` must only ever appear as a property
  // access (`process.getBuiltinModule("node:module").createRequire(...)`), never
  // as a named import.
  assert.doesNotMatch(
    codeLines,
    /import\s*\{\s*createRequire\s*\}\s*from/,
    "a top-level `createRequire` import re-appeared — this collides with a bundler's own auto-injected interop shim, see the module's docblock",
  );
});
