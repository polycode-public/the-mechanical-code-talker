// The Pages build script end-to-end: `npm run demo:build` (the exact script
// the CI pages job runs) must produce a public/ledger.html that carries the
// embedded ledger payload and the inlined memory-ask bundle — the page the
// homepage hero iframes. All of its outputs are gitignored; src/ stays the
// single source of truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/build-demo-site.mjs", import.meta.url));
const LEDGER_PAGE = fileURLToPath(new URL("../public/ledger.html", import.meta.url));

test("build-demo-site writes a public/ledger.html with the ledger payload and a live chat dock", async () => {
  const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /wrote .*ledger\.html \(chat dock enabled\)/);

  const html = await readFile(LEDGER_PAGE, "utf8");
  const m = /const LEDGER = (.*);/.exec(html);
  assert.ok(m, "the page embeds const LEDGER");
  const ledger = JSON.parse(m[1]);
  assert.ok(ledger.rows.length > 0, "the demo payload renders real fact rows");
  assert.ok(ledger.rows.some((r) => r.s === "disk-1" || r.o === "disk-1"), "the hanoi-3 demo facts are present");
  assert.match(html, /tmctMemoryAsk/);
  assert.match(html, /id="chatform"/);
  assert.ok(!html.includes("chat unavailable"), "the dock renders enabled, not the disabled note");
});
