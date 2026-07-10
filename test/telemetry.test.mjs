// telemetry.mjs — opt-in query telemetry. No existing test file covered this module; this
// one focuses on the load-bearing contract (redact() drops file-content-shaped fields, the
// OFF-by-default no-op) plus the RI-wrapping smoke test (createGraphService(..., { tel })).
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { telemetryEnabled, invocationId, redact, createTelemetry } from "../src/telemetry.mjs";
import { createGraphService } from "../src/providers/graph-service.mjs";
import { fixtureGraph } from "../src/providers/fixture.mjs";
import { createSession } from "../src/chat.mjs";
import { dispatchTool } from "../src/server.mjs";
import { fileURLToPath } from "node:url";

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

// =============================================================================
// createGraphService(graph, { tel }) — the RI wrapping smoke test (Item 3.2)
// =============================================================================
test("createGraphService({ tel: null }) — the default — never wraps; identical service either way", () => {
  const graph = fixtureGraph();
  const svc = createGraphService(graph);
  assert.equal(typeof svc.resolve, "function");
  assert.deepEqual(svc.resolve("widget.mjs").value.match.label, "pkg/ui/widget.mjs");
});

test("createGraphService({ tel }) wraps every service to time + record it once at construction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-telemetry-gs-"));
  try {
    const records = [];
    const tel = { record: (fields) => records.push(fields) };
    const graph = fixtureGraph();
    const svc = createGraphService(graph, { tel });
    const r = svc.resolve("widget.mjs");
    assert.ok(r.ok, "wrapping never changes the returned Result");
    assert.equal(r.value.match.label, "pkg/ui/widget.mjs");
    assert.equal(records.length, 1, "one record() call per invocation");
    assert.equal(records[0].tool, "ri.resolve");
    assert.equal(typeof records[0].perf.ms_total, "number");
    // response carries COUNTS only — never raw text/body (the redact() layer is a second net,
    // but the wrapper itself must not hand raw individuals/edges to tel.record either).
    assert.ok(!("value" in records[0]), "no raw Result value handed to telemetry");

    // async services (snippet/context) are timed/recorded too, after the promise settles.
    const untested = svc.untested();
    assert.ok(untested.ok);
    assert.equal(records[records.length - 1].tool, "ri.untested");
    assert.equal(typeof records[records.length - 1].response.count, "number");

    const ctx = await svc.context("Widget");
    assert.ok(ctx.ok);
    const ctxRecord = records.find((r2) => r2.tool === "ri.context");
    assert.ok(ctxRecord, "context() (async) is recorded too");
    assert.equal(typeof ctxRecord.perf.ms_total, "number");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// End-to-end (Item 3.3): chat.mjs's session-level `tel` (createTelemetry) is
// threaded through runTurn -> runCommand/runAsk/describeWrapperAnswer ->
// dispatchTool/buildContextBundle -> createGraphService's own `tel` option.
//
// HONEST SCOPE NOTE: dispatchTool's tool branches resolve via resolveSymbol(svc.graph,
// ...) + codegraph.mjs's render* functions directly — none of them call the RI's own
// wrapped svc.<service>() methods today (that's also why sourceAccess:true's svc.snippet/
// svc.context stay unused from dispatchTool — see server.mjs's inline comments). So no
// "ri.*" telemetry line is produced by the CURRENT product flow; the wiring exists so (a)
// any FUTURE caller of svc.<service>() directly (an external consumer, or dispatchTool
// itself if it's ever consolidated onto the RI) gets real ri.* timing for free, and (b) —
// the concrete, verifiable thing this test proves — chat.mjs's EXISTING session-level
// telemetry sink is genuinely reused end-to-end (one file, one id), never re-minted.
// =============================================================================
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

test("chat session with TMCT_TELEMETRY=1: exactly ONE telemetry file across several turns (never re-minted)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-telemetry-chat-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await copyFile(FIXTURE, join(dir, ".tmct", "graph.json"));
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1", TMCT_TELEMETRY: "1", TMCT_INVOCATION_ID: "chat-tel-test" } });
    try {
      // A mix of the dispatchTool-reaching lanes tel is now threaded through: a slash
      // command (runCommand), a plain question (runAsk), and a describe-wrapper phrasing.
      await s.turn("/describe a.mjs");
      await s.turn("which modules import a.mjs");
      await s.turn("tell me about a.mjs");
      const { readdir } = await import("node:fs/promises");
      const telFiles = (await readdir(join(dir, ".tmct"))).filter((f) => f.startsWith("tmct-") && f.endsWith(".log"));
      assert.deepEqual(telFiles, ["tmct-chat-tel-test.log"], "one file, stamped with the session's own invocation id — never a second sink");
      let lines = [];
      for (let i = 0; i < 50 && lines.length < 3; i++) {
        await new Promise((r) => setTimeout(r, 5));
        const text = await readFile(join(dir, ".tmct", telFiles[0]), "utf8").catch(() => "");
        lines = text.trim() ? text.trim().split("\n").map((l) => JSON.parse(l)) : [];
      }
      assert.ok(lines.length >= 3, "one turn-level record per dispatched turn");
      assert.ok(lines.every((l) => l.id === "chat-tel-test"), "every record shares the one session-level telemetry sink's id");
      assert.ok(lines.some((l) => l.surface === "chat" && l.tool === "describe"), "the /describe turn's own record is present");
    } finally {
      await s.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dispatchTool/buildContextBundle: passing { tel } never changes output (byte-identical to omitting it)", async () => {
  const fixture = JSON.parse(
    await readFile(fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url)), "utf8"),
  );
  const config = { graphFile: "/stub/.tmct/graph.json" };
  const source = { fetchEntities: async () => fixture };
  const spyTel = { record: () => {} };
  const withoutTel = await dispatchTool("tmct_describe", { symbol: "a.mjs" }, { config, source });
  const withTel = await dispatchTool("tmct_describe", { symbol: "a.mjs" }, { config, source, tel: spyTel });
  assert.equal(withTel, withoutTel, "the tel option is purely additive plumbing — never changes a tool's rendered output");
});
