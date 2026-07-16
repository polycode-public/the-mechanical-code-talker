// The runChat stream drive: README's headline "teach it, then ask it to
// reason" example, executed verbatim through the same input/output-stream
// entry point the shell uses (Readable in, PassThrough out, one line per
// process). Corpus rows drive createSession directly, so this stream seam is
// pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { runChat } from "../../src/services/chat.mjs";

test("README's headline 'teach it, then ask it to reason' example works verbatim through runChat streams", async () => {
  const graph = {
    individuals: [
      { id: "mod:src/handlers/base.mjs", label: "src/handlers/base.mjs", class: "Module" },
      { id: "mod:src/handlers/tasks.mjs", label: "src/handlers/tasks.mjs", class: "Module" },
      { id: "fn:src/handlers/base.mjs#Controller", label: "Controller", class: "Class" },
      { id: "fn:src/handlers/tasks.mjs#TaskController", label: "TaskController", class: "Class" },
    ],
    objectProperties: [{
      predicate: "inherits", prop: "seon:hasSuperType", count: 1,
      examples: [{
        subject: "fn:src/handlers/tasks.mjs#TaskController", object: "fn:src/handlers/base.mjs#Controller",
        subjectLabel: "TaskController", objectLabel: "Controller",
      }],
    }],
  };
  const repoPath = await mkdtemp(join(tmpdir(), "tmct-runchat-readme-"));
  try {
    await mkdir(join(repoPath, ".tmct"), { recursive: true });
    await writeFile(join(repoPath, ".tmct", "graph.json"), JSON.stringify(graph));
    async function tell(line) {
      const out = new PassThrough();
      let transcript = "";
      out.on("data", (chunk) => { transcript += chunk; });
      await runChat({ repoPath, input: Readable.from([`${line}\n`, "/exit\n"]), output: out });
      return transcript.split("\n").find((l) => l.startsWith("tmct> "));
    }
    await tell("a controller is a kind of handler");
    const answer = await tell("is TaskController a handler");
    assert.match(answer, /^tmct> yes/, "the taught rule plus the graph premise produce a confident yes");
    assert.match(answer, /TaskController inherits Controller/, "cites the graph-sourced premise");
    assert.match(answer, /controller is a kind of handler/, "cites the taught premise");
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
});
