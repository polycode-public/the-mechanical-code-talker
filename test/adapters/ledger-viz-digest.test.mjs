// The ledger focus card's digest paragraph: renderLedgerHtml embeds a
// server-computed digest for the page's focus term (the generator reads the
// sentence-structure bank node-side), and the client focus card renders it.
// Built end to end from a memory payload the way scripts/build-demo-site.mjs
// does, so the embed and the render path are the real ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, openMemoryBackend, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { computeLedgerDataFromPayload, renderLedgerHtml } from "../../src/services/ledger-viz.mjs";
import { digestTermFromRows } from "../../src/adapters/corpus/digest-bank.mjs";

async function ledgerPageForDoctor() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ledger-digest-"));
  const backend = await openMemoryBackend(dir, "");
  try {
    const TS = "2026-07-15T09:00:00.000Z";
    await appendFact(backend.dir, { subject: "doctor", predicate: "rdfs:subClassOf", object: "person", provenance: "corpus:human /r/IsA", createdAt: TS });
    await appendFact(backend.dir, { subject: "doctor", predicate: "mgx:atLocation", object: "hospital", provenance: "corpus:human /r/AtLocation", createdAt: TS });
    await appendFact(backend.dir, { subject: "doctor", predicate: "mgx:capableOf", object: "treat patients", provenance: "corpus:human /r/CapableOf", createdAt: TS });
    const payload = await loadMemory(backend.dir);
    const ledgerData = computeLedgerDataFromPayload(payload, { focus: "doctor" });
    const allRows = readFactRows(payload);
    const focusRows = allRows.filter((r) => r.subject === ledgerData.focus);
    const article = digestTermFromRows(ledgerData.focus, focusRows, allRows, { budget: 8 });
    const focusDigest = {
      term: ledgerData.focus,
      paragraphs: article.paragraphs,
      sources: [...new Set(article.sources.map((s) => s.provenance).filter(Boolean))],
      factCount: article.detail.factCount,
    };
    return { html: renderLedgerHtml({ ...ledgerData, focusDigest }), focusDigest };
  } finally {
    await backend.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("the ledger page embeds the focus term's digest paragraph", async () => {
  const { html, focusDigest } = await ledgerPageForDoctor();
  assert.ok(focusDigest.paragraphs.length, "a digest was computed for the focus");
  assert.match(focusDigest.paragraphs[0], /doctor is a person/i);
  // The digest rides in the embedded LEDGER JSON, keyed focusDigest.
  const m = /(?:const|let) LEDGER = (.*?);\n/.exec(html);
  assert.ok(m, "LEDGER embed found");
  const embedded = JSON.parse(m[1]);
  assert.deepEqual(embedded.focusDigest.paragraphs, focusDigest.paragraphs);
});

test("the focus card recomputes the digest client-side on refocus, with the server digest as the initial-focus fallback", async () => {
  const { html } = await ledgerPageForDoctor();
  // Every focus runs the client digest first (over the embedded structure
  // table), falling back to the server-computed focusDigest for the initial
  // focus alone — both branches, and the .focusdigest styling, in the page.
  assert.match(html, /clientDigest\(focus\)/);
  assert.match(html, /focus === LEDGER\.focus && LEDGER\.focusDigest/);
  assert.match(html, /\.focusdigest \{/);
});
