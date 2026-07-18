// The terminal surface over the default file backend, as a real spawned
// child: bin/tmct.mjs with piped (non-TTY) stdio is the --plain readline
// shell over a temp repo. One seeded session exercises the three capability
// flows in sequence — a seeded vocabulary answer, a scripted guess-the-number
// game (thinker mode, deterministic through the TMCT_GAME_SECRET test seam),
// and a learn-on-miss turn over the real shipped reference pack, whose stored
// isa fact then answers the follow-up ask from the file-backend memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));

test("the spawned chat shell answers the seed, plays the game, and learns from the pack into its file store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tui-file-"));
  try {
    const input = [
      "what is a dog",
      "think of a number between 1 and 100",
      "50",
      "25",
      "42",
      "what is an otter",
      "what is an otter",
      "/exit",
      "",
    ].join("\n");
    const res = spawnSync(process.execPath, [BIN], {
      encoding: "utf8", input, cwd: dir,
      env: { ...process.env, TMCT_GAME_SECRET: "42" },
    });
    assert.equal(res.status, 0, res.stderr);

    // flow 1 — the first-run seed answers the canonical vocabulary question
    assert.match(res.stdout, /seeded \d+ starter facts/, "the first-run seed ran");
    assert.match(res.stdout, /dog is a kind of animal \(source: corpus:/, "the seeded answer cites its corpus source");

    // flow 2 — the scripted thinker game: true hints, then the win
    assert.match(res.stdout, /I've thought of a number between 1 and 100/);
    assert.match(res.stdout, /lower — guess again\./, "50 is above the seeded secret");
    assert.match(res.stdout, /higher — guess again\./, "25 is below the seeded secret");
    assert.match(res.stdout, /Correct — you got it in 3 guesses! The number was 42\./);

    // flow 3 — learn-on-miss: the cited pack answer, then memory answers the repeat
    assert.match(res.stdout, /\(source: reference article "Otter", Simple English Wikipedia, CC BY-SA 4\.0/, "the pack answer carries the citation frame");
    assert.match(res.stdout, /otter is a kind of animal \(source: reference:simplewiki:Otter@\d+/, "the second ask answers from the stored reference fact");

    // the file backend really holds what the session learned
    const store = await readFile(join(dir, ".tmct", "memory", "graph.json"), "utf8");
    assert.match(store, /reference:simplewiki:Otter@\d+/, "the reference-provenance fact is on disk");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
