// A spot-check of 6 of the 333 non-ceiling chat rows infbench's committed
// case set can produce, not arm coverage: it pins the exact verdict each of
// six hand-picked cases must observe when driven through a real runChat()
// session, one case per verdict shape plus a matched control pair. It shares
// one case id with the bench-smoke corpus lane (test/corpus/bench-smoke.jsonl)
// on purpose — that lane pins "the CLI produces a gradeable row"; this one
// pins "that row's verdict is the correct one".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { runInfbench } from "../../test-benchmarks/infbench/run.mjs";
import { parseCases } from "../../test-benchmarks/infbench/grade.mjs";

const CASES_FILE = fileURLToPath(new URL("../../test-benchmarks/infbench/cases.jsonl", import.meta.url));

const PINNED = [
  { id: "inf-1-lookup-subClassOf-001", checkType: "isa", verdict: "yes" },
  { id: "inf-1-lookup-possessive-001", checkType: "recall" },
  { id: "inf-2-converse-converse-001", checkType: "isa", verdict: "unproven" },
  { id: "inf-3-disjoint-direct-member-001", checkType: "isa", verdict: "no" },
  { id: "inf-3-disjoint-control-001", checkType: "isa", verdict: "unproven" },
  { id: "inf-6-inconsistent-inconsistent-001", checkType: "inconsistent", verdict: "inconsistent" },
];

test("infbench chat arm: six pinned verdicts across every check-type shape plus a matched control pair", async () => {
  const { cases, errors } = parseCases(await readFile(CASES_FILE, "utf8"));
  assert.deepEqual(errors, []);

  const byId = new Map(cases.map((c) => [c.id, c]));
  const selected = PINNED.map(({ id }) => {
    const found = byId.get(id);
    assert.ok(found, `pinned case id not found in the committed case set: ${id}`);
    return found;
  });

  for (const c of selected) assert.equal(c.ceiling, undefined, `${c.id}: this spot-check pins live capability, not a declared ceiling`);

  const { chat } = await runInfbench(selected, { concurrency: 3 });
  const rowsById = new Map(chat.rows.map((r) => [r.caseId, r]));

  for (const pinned of PINNED) {
    const row = rowsById.get(pinned.id);
    assert.ok(row, `${pinned.id}: no chat row produced`);
    if (pinned.checkType === "recall") {
      assert.equal(row.pass, true, `${pinned.id}: expected the recall to pass`);
      assert.match(row.answer, /e12\.mjs/i, `${pinned.id}: expected the recalled owner to appear in the answer`);
    } else {
      assert.equal(row.observed, pinned.verdict, `${pinned.id}: expected observed verdict ${pinned.verdict}, got ${row.observed}`);
    }
  }

  for (const row of chat.rows) {
    assert.equal(row.fabricated, false, `${row.caseId}: expected no fabrication`);
    assert.equal(row.error, undefined, `${row.caseId}: expected no drive error`);
    assert.notEqual(row.observed, "unclear", `${row.caseId}: expected a clear verdict`);
  }
});
