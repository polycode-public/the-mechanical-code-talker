import { runChat } from "@polycode-projects/the-mechanical-code-talker";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEACH = ["Rover is a dog."];

export const ASK = "Does Rover bark?";

const PROVENANCE_RE = /(teach|ace):chat:[0-9a-f-]{36}@\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;

function normalize(text) {
  return text.replace(PROVENANCE_RE, "$1:chat:<session-id>@<timestamp>");
}

export async function runExample() {
  const repoPath = await mkdtemp(join(tmpdir(), "tmct-example-"));
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk.toString()));
  try {
    const script = [...TEACH, ASK].map((line) => line + "\n");
    // No memoryBackend override — the default (sqlite) path is what triggers
    // the first-run corpus bootstrap (chat-session.mjs's seedBootstrapMemory),
    // so "dog can bark" is already there for the taught "Rover is a dog" to
    // chain through.
    await runChat({
      repoPath,
      input: Readable.from([...script, "/exit\n"]),
      output,
    });
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
  const promptIndex = chunks.indexOf("tmct> ");
  return chunks.slice(promptIndex + 1).map((chunk) => normalize(chunk.replace(/\n$/, "")));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const answers = await runExample();
  const lines = [...TEACH, ASK];
  for (let i = 0; i < lines.length; i++) {
    console.log(`tmct> ${lines[i]}`);
    console.log(answers[i]);
    console.log();
  }
}
