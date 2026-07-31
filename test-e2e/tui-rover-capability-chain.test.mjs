// Regression coverage, through a real spawned terminal shell, for the bug
// report that opened this: teaching "Rover is a dog." then asking "Does
// Rover bark?" must chain the taught fact (rover rdfs:subClassOf dog)
// through the corpus fact (dog mgx:capableOf bark) and answer with both
// citations. examples/rover-infer.mjs carries the same scenario driven
// in-process; test-e2e/pages-chat-taught-capability-chain.test.mjs drives it
// through chat.html; this file proves the identical answer renders through
// bin/tmct.mjs's piped (non-TTY) shell, the same spawn convention
// tui-chat-file.test.mjs already uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

test("the spawned chat shell chains a taught ISA fact through the corpus capability fact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tui-rover-"));
  try {
    const input = ["Rover is a dog.", "Does Rover bark?", "/exit", ""].join("\n");
    const res = spawnSync(process.execPath, [BIN], { encoding: "utf8", input, cwd: dir });
    assert.equal(res.status, 0, res.stderr);

    assert.match(res.stdout, /noted — remembered 1 fact: rover rdfs:subClassOf dog \(rover is a type of dog\)/, "the teach turn records the ISA fact");
    // the session id and timestamp in the taught-fact citation vary per run —
    // match on the stable parts, same discipline examples/rover-infer.mjs's
    // own normalization uses.
    assert.match(
      res.stdout,
      /yes — dog can bark \(source: corpus:human \/r\/CapableOf\) — via: rover is a kind of dog \(source: ace:chat:[0-9a-f-]{36}@\d{4}-\d{2}-\d{2}T[\d:.]+Z\)/,
      "the ask chains through the taught fact and cites both the corpus capability and the taught ISA link",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
