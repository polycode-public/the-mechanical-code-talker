import { runChat } from "@polycode-projects/the-mechanical-code-talker";
import { Readable, PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TEACH = [
  "ahab is the father of john",
  "john is the father of ishmael",
  "a father is a kind of parent",
  "remember that ahab is male",
  "a grandparent is a parent of a parent",
  "a grandfather is a grandparent who is male",
];

export const ASK = "is ahab the grandfather of ishmael";

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
    await runChat({
      repoPath,
      memoryBackend: "memory",
      input: Readable.from([...script, "/exit\n"]),
      output,
    });
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
  // The interactive prompt ("tmct> ") is written to `output` exactly once,
  // right before the first line is read; every turn after that writes its
  // answer with no further prompt in between (readline's non-TTY behavior).
  // So every chunk after that lone prompt is one turn's full answer, in the
  // same order as the lines sent above.
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
