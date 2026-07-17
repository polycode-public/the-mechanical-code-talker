// The home page and README both show `runChat` as the library entry: teach it a
// fact, ask it back, read the answer off the output stream. A `dom` test proves
// the page prints the block; this proves the block runs and answers.
//
// The page block (public/index.html) teaches "ahab is the father of john", asks
// "who is the father of john", and the reader is meant to see the taught fact
// come back. This drives the same runChat call in-process and asserts it does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChat } from "../../src/services/index.mjs";

test("the home-page runChat library block teaches a fact and answers it back", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "tmct-library-block-"));
  const output = new PassThrough();
  let transcript = "";
  output.on("data", (chunk) => { transcript += chunk; });

  await runChat({
    repoPath,
    memoryBackend: "memory",
    input: Readable.from([
      "ahab is the father of john\n",
      "who is the father of john\n",
      "/exit\n",
    ]),
    output,
  });

  assert.match(transcript, /noted — remembered: ahab fathers john/, "the taught fact is accepted");
  assert.match(transcript, /ahab — you told me: ahab fathers john/, "the question is answered from the taught fact, naming ahab");
});
