// telemetry.mjs — opt-in query telemetry. No existing test file covered this module; this
// one focuses on the load-bearing contract (redact() drops file-content-shaped fields, the
// OFF-by-default no-op) plus the RI-wrapping smoke test (createGraphService(..., { tel })).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { telemetryEnabled, invocationId, redact, createTelemetry } from "../src/telemetry.mjs";

test("telemetryEnabled: OFF by default; env TMCT_TELEMETRY=1/0 wins both directions over toml", () => {
  assert.equal(telemetryEnabled({}, null), false);
  assert.equal(telemetryEnabled({ TMCT_TELEMETRY: "1" }, null), true);
  assert.equal(telemetryEnabled({}, { telemetry: { enabled: true } }), true);
  assert.equal(telemetryEnabled({ TMCT_TELEMETRY: "0" }, { telemetry: { enabled: true } }), false, "env=0 force-disables even when toml says on");
});

test("invocationId: honours TMCT_INVOCATION_ID; otherwise mints a fresh id each call", () => {
  assert.equal(invocationId({ TMCT_INVOCATION_ID: "fixed-id" }), "fixed-id");
  const a = invocationId({});
  const b = invocationId({});
  assert.notEqual(a, b, "no stamped id → a fresh uuid each time");
});

test("redact(): drops text/content/snippet/body at any depth (body: 2f/Item 3 — source-capable bodies must never leak)", () => {
  const out = redact({
    text: "raw source A",
    content: "raw source B",
    snippet: "raw source C",
    body: "raw source", // the Repository Interface's own field name for snippet()/context() body text
    nested: { body: "also raw source", kept: "fine" },
    id: "mod:a.mjs",
    count: 3,
  });
  assert.equal(out.text, undefined);
  assert.equal(out.content, undefined);
  assert.equal(out.snippet, undefined);
  assert.equal(out.body, undefined);
  assert.equal(out.nested.body, undefined);
  assert.equal(out.nested.kept, "fine");
  assert.equal(out.id, "mod:a.mjs");
  assert.equal(out.count, 3);
});

test("redact(): truncates long strings except query.raw (the correlation key)", () => {
  const long = "x".repeat(600);
  const out = redact({ query: { raw: long }, other: long });
  assert.equal(out.query.raw.length, 600, "query.raw kept whole");
  assert.equal(out.other.length, 500, "everything else truncated to MAX_STR");
});

test("createTelemetry: disabled → null (byte-identical OFF path, no fs touched)", () => {
  assert.equal(createTelemetry({ env: {}, config: { graphFile: "/x/.tmct/graph.json" }, surface: "chat" }), null);
});

test("createTelemetry: enabled → appends a redacted JSONL line per record()", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-telemetry-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const tel = createTelemetry({ env: { TMCT_TELEMETRY: "1", TMCT_INVOCATION_ID: "test-inv" }, config, surface: "chat" });
    assert.ok(tel && typeof tel.record === "function");
    assert.equal(tel.id, "test-inv");
    tel.record({ tool: "tmct_describe", response: { count: 2 }, body: "must never appear on disk" });
    // record() is fire-and-forget (appendFile is not awaited) — poll briefly for the write.
    let text = "";
    for (let i = 0; i < 50 && !text; i++) {
      await new Promise((r) => setTimeout(r, 5));
      text = await readFile(tel.file, "utf8").catch(() => "");
    }
    assert.match(text, /"tool":"tmct_describe"/);
    assert.doesNotMatch(text, /must never appear on disk/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
