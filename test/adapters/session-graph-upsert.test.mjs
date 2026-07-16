// upsertSession's ref re-resolution tiers: a recorded entity ref resolves by
// id, else by UNIQUE label derived from the id shape, else it is counted as an
// honest drop — and every resolved target becomes an asks-about example edge.
// Corpus rows drive ephemeral sessions (which never write the graph back), so
// the resolution tiers are pinned here on the pure, exported seam.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { upsertSession } from "../../src/sessions.mjs";

const FIXTURE = new URL("../fixtures/entities.fixture.json", import.meta.url);

test("session refs resolve by id, then by unique label, and vanished refs drop honestly into edges + counts", async () => {
  const entities = JSON.parse(await readFile(FIXTURE, "utf8"));
  const widget = entities.individuals.find((i) => i.label === "Widget");
  const button = entities.individuals.find((i) => i.label === "Button");
  assert.ok(widget && button, "fixture carries the two classes this test resolves");

  const record = {
    id: "0198a2b4-0000-7000-8000-000000000001",
    started: "2026-07-15T10:00:00.000Z",
    ended: "2026-07-15T10:01:00.000Z",
    turns: [
      // (a) an exact-id hit, (b) a re-indexed id that only resolves via its
      // derived label, (c) a ref whose label matches nothing — dropped.
      { ts: "2026-07-15T10:00:30.000Z", query: "describe Widget", resolvedIds: [widget.id], answeredIds: [`fn:app/lib/c.mjs#${button.label}`, "mod:no/such.mjs"], miss: false },
    ],
  };
  const { kept, dropped } = upsertSession(entities, record);
  assert.equal(kept, 2, "the id hit and the label-resolved ref both keep");
  assert.equal(dropped, 1, "the vanished ref is dropped, never guessed");

  const session = entities.individuals.find((i) => i.id === "session:0198a2b4-0000-7000-8000-000000000001");
  assert.ok(session, "the session individual is appended");
  assert.equal(session.attributes.find((a) => a.key === "dropped")?.value, "1", "the drop is counted on the session node");

  const group = entities.objectProperties.find((g) => g.prop === "mgx:asksAbout");
  const objects = group.examples.map((e) => e.object).sort();
  assert.deepEqual(objects, [button.id, widget.id].sort(), "both resolved targets become asks-about edges");
  assert.equal(group.count, group.examples.length, "the group count tracks its examples");
});
