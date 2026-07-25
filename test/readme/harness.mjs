// Executes README blocks parsed by extract.mjs and asserts their pinned text
// against the live product. Shared by the fast tier (test/readme/) and the
// e2e tier (test-e2e/readme-examples.test.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
export const README_PATH = path.join(repoRoot, "README.md");

// Generous: the transcript replays take ~1 min idle but have been observed
// past 240s when other suites share the machine at full parallelism.
const EXEC_TIMEOUT_MS = 480_000;
const ELISION_LINES = new Set(["…", "..."]);

let shimDir = null;

/** A PATH prefix dir whose `tmct` and `npx tmct` run this repo's binary. */
function ensureShimDir() {
  if (shimDir) return shimDir;
  shimDir = mkdtempSync(path.join(tmpdir(), "tmct-readme-shim-"));
  const binary = path.join(repoRoot, "bin", "tmct.mjs");
  const write = (name, script) => {
    const file = path.join(shimDir, name);
    writeFileSync(file, script);
    chmodSync(file, 0o755);
  };
  write("tmct", `#!/bin/sh\nexec "${process.execPath}" "${binary}" "$@"\n`);
  write(
    "npx",
    `#!/bin/sh\nif [ "$1" = "tmct" ]; then shift; exec "${process.execPath}" "${binary}" "$@"; fi\n` +
      `echo "readme harness: npx only proxies tmct (no network)" >&2\nexit 1\n`,
  );
  return shimDir;
}

function shimEnv() {
  return { ...process.env, PATH: `${ensureShimDir()}${path.delimiter}${process.env.PATH}` };
}

/** A temp dir where the published package name resolves to this repo. */
function makePackageTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "tmct-readme-"));
  const scopeDir = path.join(dir, "node_modules", "@polycode-projects");
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(repoRoot, path.join(scopeDir, "the-mechanical-code-talker"));
  return dir;
}

function inTempDir(block, run) {
  if (block.attrs.cwd === "repo") return run(repoRoot);
  const dir = makePackageTempDir();
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sh(command, { cwd, input = "" }) {
  // Merge stderr into stdout: README transcripts show what a terminal shows.
  return execFileSync("bash", ["-euo", "pipefail", "-c", `exec 2>&1\n${command}`], {
    cwd,
    input,
    env: shimEnv(),
    encoding: "utf8",
    timeout: EXEC_TIMEOUT_MS,
  });
}

const stripTrailing = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");

export function runJsBlock(block) {
  return inTempDir(block, (cwd) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", block.body], {
      cwd,
      input: "",
      env: shimEnv(),
      encoding: "utf8",
      timeout: EXEC_TIMEOUT_MS,
    }),
  );
}

export function runBashBlock(block) {
  return inTempDir(block, (cwd) => sh(block.body, { cwd }));
}

/** Where a block came from, for an assertion message that names the file the
 *  reader must edit. Blocks default to the README; the site's pages set it. */
const originOf = (block) => `${block.source ?? "README"} line ${block.startLine}`;

function parseSession(block) {
  let command = block.attrs.cmd ?? null;
  const inputs = [];
  const expected = [];
  for (const line of block.body.split("\n")) {
    if (line.startsWith("$ ")) command = line.slice(2);
    else if (line.startsWith("tmct> ")) inputs.push(line.slice(6));
    else if (line.trim() !== "") expected.push(line.replace(/\s+$/, ""));
  }
  assert.ok(command, `session block at ${originOf(block)} names no command`);
  if (inputs.length > 0 && inputs.at(-1) !== "/exit") inputs.push("/exit");
  return { command, inputs, expected };
}

/** Every expected line must appear in stdout, in order. Transcripts are
 *  excerpts, so unlisted stdout lines (banners, prompts) may interleave. */
function assertLinesInOrder(expected, stdout, blockLabel) {
  const actual = stdout.split("\n").map((line) => line.replace(/^(tmct> )+/, "").replace(/\s+$/, ""));
  let from = 0;
  for (const want of expected) {
    if (ELISION_LINES.has(want.trim())) continue;
    const at = actual.indexOf(want, from);
    assert.notEqual(at, -1, `${blockLabel}: line not found in stdout (in order): ${JSON.stringify(want)}\n--- stdout ---\n${stdout}`);
    from = at + 1;
  }
}

export function runSessionBlock(block) {
  const { command, inputs, expected } = parseSession(block);
  return inTempDir(block, (cwd) => {
    if (block.attrs.setup) sh(block.attrs.setup, { cwd });
    const stdout = sh(command, { cwd, input: inputs.map((line) => line + "\n").join("") });
    assertLinesInOrder(expected, stdout, `session at ${originOf(block)}`);
    return stdout;
  });
}

/** Full-stdout comparison; "…"/"..." lines in the expected text elide any
 *  run of output between the pinned segments. */
export function assertOutputMatches(block, stdout) {
  const label = `output block at README line ${block.startLine}`;
  const normalized = stripTrailing(stdout);
  const segments = [[]];
  for (const line of stripTrailing(block.body).split("\n")) {
    if (ELISION_LINES.has(line.trim())) segments.push([]);
    else segments.at(-1).push(line);
  }
  if (segments.length === 1) {
    assert.equal(normalized, segments[0].join("\n"), label);
    return;
  }
  let from = 0;
  for (const [i, segment] of segments.entries()) {
    const want = segment.join("\n");
    if (want === "") continue;
    const at = normalized.indexOf(want, from);
    assert.notEqual(at, -1, `${label}: pinned segment missing from stdout:\n${want}\n--- stdout ---\n${stdout}`);
    if (i === 0) assert.equal(at, 0, `${label}: stdout must start with the first pinned segment`);
    from = at + want.length;
  }
  const tail = segments.at(-1).join("\n");
  assert.ok(normalized.endsWith(tail), `${label}: stdout must end with the last pinned segment`);
}

export function runOutputBlock(block, previousStdout) {
  if (block.attrs.cmd) {
    const stdout = inTempDir(block, (cwd) => sh(block.attrs.cmd, { cwd }));
    assertOutputMatches(block, stdout);
    return;
  }
  assert.ok(
    typeof previousStdout === "string",
    `output block at README line ${block.startLine} has no cmd and no preceding runnable block ran in this tier`,
  );
  assertOutputMatches(block, previousStdout);
}

let helpText = null;

export function liveHelpText() {
  helpText ??= stripTrailing(
    execFileSync(process.execPath, [path.join(repoRoot, "bin", "tmct.mjs"), "--help"], {
      encoding: "utf8",
      timeout: EXEC_TIMEOUT_MS,
    }),
  );
  return helpText;
}

export function assertHelpExcerpt(block) {
  assert.ok(
    liveHelpText().includes(stripTrailing(block.body)),
    `help excerpt at README line ${block.startLine} is not verbatim in the live tmct --help output`,
  );
}

export async function validateTomlBlock(block) {
  const { parse } = await import("smol-toml");
  const raw = parse(block.body);
  assert.ok(Object.keys(raw).length > 0, "the tmct.toml reference parses to a non-empty config");
  const { loadTomlConfig, CONFIG_FILE } = await import(path.join(repoRoot, "src", "adapters", "toml-config.mjs"));
  const dir = mkdtempSync(path.join(tmpdir(), "tmct-readme-toml-"));
  try {
    writeFileSync(path.join(dir, CONFIG_FILE), block.body);
    const config = await loadTomlConfig(dir);
    assert.ok(config && typeof config === "object", "the config loader accepts the documented tmct.toml");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
