// tmct_snippet end-to-end: build a tiny graph with buildEntities over a real
// on-disk source file, then fetch exact source spans through dispatchTool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEntities } from "../src/adapters/graph-build.mjs";
import { dispatchTool } from "../src/tools/server.mjs";

test("tmct_snippet returns the exact source span; modules have none", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-snip-"));
  try {
    await writeFile(join(dir, "a.py"),
      "import os\n\n\ndef helper(x):\n    return x + 1\n\n\nclass Thing:\n    def m(self):\n        return 2\n");
    const modules = [{
      path: "a.py", dotted: "a", imports: ["os"], calls: [],
      defines: [
        { name: "helper", kind: "function", lineno: 4, end_lineno: 5, decorators: [] },
        { name: "Thing", kind: "class", lineno: 8, end_lineno: 10, decorators: [] },
        // methods are flat defines entries with dotted Class.method names (see ask.test.mjs)
        { name: "Thing.m", kind: "method", lineno: 9, end_lineno: 10, decorators: [] },
      ],
    }];
    const entities = buildEntities(modules, [], { generatedAt: new Date().toISOString() });
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const graphFile = join(dir, ".tmct", "graph.json");
    await writeFile(graphFile, JSON.stringify(entities));
    const config = { graphFile };

    const snip = await dispatchTool("tmct_snippet", { symbol: "helper" }, { config });
    assert.match(snip, /helper — Function @ a\.py:4-5/);
    assert.match(snip, /4\tdef helper\(x\):/);
    assert.match(snip, /5\t {4}return x \+ 1/);
    // #4: the in-repo call hint is appended only when callsSymbol edges exist; helper calls
    // nothing in-repo, so the snippet must stay clean (graceful — no spurious hint line).
    assert.doesNotMatch(snip, /calls in-repo:/);

    // a class returns its whole body span
    const cls = await dispatchTool("tmct_snippet", { symbol: "Thing" }, { config });
    assert.match(cls, /Thing — Class @ a\.py:8-10/);

    // a method is a first-class individual → snippet resolves Class.method
    const method = await dispatchTool("tmct_snippet", { symbol: "Thing.m" }, { config });
    assert.match(method, /Thing\.m — Method @ a\.py:9-10/);
    assert.match(method, /9\t {4}def m\(self\):/);

    // tmct_members lists the class body in one slice
    const members = await dispatchTool("tmct_members", { class: "Thing" }, { config });
    assert.match(members, /methods \(1\): m \[a\.py:9-10\]/);

    // a module has no source span → instructive error, points at tmct_describe
    const modErr = await dispatchTool("tmct_snippet", { symbol: "a.py" }, { config }).catch((e) => e.message);
    assert.match(modErr, /no source span|module/i);
    assert.match(modErr, /tmct_describe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
