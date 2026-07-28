// createSession/runChat's toolNamePrefix param (PLAN_REPOSITORY_INTERFACE): a host
// like seonix has no way to reach the config object these functions build
// internally, so the only injection point is an explicit parameter. This proves
// the override reaches the rendered follow-up hint text end-to-end, and that
// omitting it reproduces today's "tmct_" hints unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, runChat } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

async function repoWithFixtureGraph(tag) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-toolprefix-${tag}-`));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}

test("createSession: an explicit toolNamePrefix renders the hint text with the host's own prefix", async () => {
  const repo = await repoWithFixtureGraph("override");
  const s = await createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1" }, toolNamePrefix: "seonix_" });
  try {
    assert.equal(s.config.toolNamePrefix, "seonix_");
    const { answer } = await s.turn("/members Widget");
    assert.match(answer, /seonix_/, "the rendered members hint carries the host's prefix");
    assert.doesNotMatch(answer, /tmct_/, "no leftover tmct_ hint text once a host prefix is set");
  } finally {
    await s.close();
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});

test("createSession: omitting toolNamePrefix still renders tmct_-prefixed hints (unchanged default)", async () => {
  const repo = await repoWithFixtureGraph("default");
  const s = await createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1" } });
  try {
    assert.equal(s.config.toolNamePrefix, "tmct_");
    const { answer } = await s.turn("/members Widget");
    assert.match(answer, /tmct_/, "the default hint still carries tmct_");
  } finally {
    await s.close();
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});

test("runChat: threads toolNamePrefix through to the same rendered hint text", async () => {
  const repo = await repoWithFixtureGraph("runchat");
  const { Readable, Writable } = await import("node:stream");
  const input = Readable.from(["/members Widget\n", "/exit\n"]);
  let out = "";
  const output = new Writable({
    write(chunk, _enc, cb) { out += chunk.toString(); cb(); },
  });
  output.isTTY = false;
  try {
    await runChat({ repoPath: repo, input, output, env: { TMCT_NO_SEED: "1", NO_COLOR: "1" }, toolNamePrefix: "seonix_" });
    assert.match(out, /seonix_/, "runChat's own transcript carries the host's prefix");
    assert.doesNotMatch(out, /tmct_/, "no leftover tmct_ hint text in runChat's transcript once a host prefix is set");
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});
