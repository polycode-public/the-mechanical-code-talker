// seonix_snippet end-to-end: index a tiny temp repo, then fetch exact source spans
// through dispatchTool against the real on-disk graph (gated on python3 + git).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexRepository } from "../src/extract.mjs";
import { dispatchTool } from "../src/server.mjs";

const have = (c) => spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0;
const toolchain = (have("python3") || have("python")) && have("git");

test("seonix_snippet returns the exact source span; modules have none", { skip: !toolchain ? "needs python3 + git" : false }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "seon-snip-"));
  try {
    await writeFile(join(dir, "a.py"),
      "import os\n\n\ndef helper(x):\n    return x + 1\n\n\nclass Thing:\n    def m(self):\n        return 2\n");
    const git = (...a) => spawnSync("git", a, { cwd: dir });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    git("add", "-A"); git("commit", "-q", "-m", "base");

    const { graphFile } = await indexRepository(dir);
    const config = { graphFile };

    const snip = await dispatchTool("seonix_snippet", { symbol: "helper" }, { config });
    assert.match(snip, /helper — Function @ a\.py:4-5/);
    assert.match(snip, /4\tdef helper\(x\):/);
    assert.match(snip, /5\t {4}return x \+ 1/);
    // #4: the in-repo call hint is appended only when callsSymbol edges exist; helper calls
    // nothing in-repo, so the snippet must stay clean (graceful — no spurious hint line).
    assert.doesNotMatch(snip, /calls in-repo:/);

    // a class returns its whole body span
    const cls = await dispatchTool("seonix_snippet", { symbol: "Thing" }, { config });
    assert.match(cls, /Thing — Class @ a\.py:8-10/);

    // a method is now a first-class individual → snippet resolves Class.method
    const method = await dispatchTool("seonix_snippet", { symbol: "Thing.m" }, { config });
    assert.match(method, /Thing\.m — Method @ a\.py:9-10/);
    assert.match(method, /9\t {4}def m\(self\):/);

    // seonix_members lists the class body in one slice
    const members = await dispatchTool("seonix_members", { class: "Thing" }, { config });
    assert.match(members, /methods \(1\): m \[a\.py:9-10\]/);

    // a module has no source span → instructive error, points at seonix_describe
    const modErr = await dispatchTool("seonix_snippet", { symbol: "a.py" }, { config }).catch((e) => e.message);
    assert.match(modErr, /no source span|module/i);
    assert.match(modErr, /seonix_describe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
