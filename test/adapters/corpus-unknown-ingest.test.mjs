// corpus-unknown-ingest.test.mjs — context-preserving
// ingestion for unknown words: a term that ONLY ever appears in a row
// toFacts() silently drops (an ace="none" relation) must not vanish — it
// becomes a real Fact individual tagged with the passage it was found in,
// and the row's other endpoint (known or unknown) gets linked to it via a
// plain, closed-vocabulary co-occurrence predicate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knownTermsFrom, passageFor, ingestUnknownFromAssertions,
  CONTEXT_PASSAGE_PREDICATE, CO_OCCURS_PREDICATE,
} from "../../src/adapters/corpus/unknown-ingest.mjs";
import { loadMap, seedMemory } from "../../src/adapters/corpus/conceptnet.mjs";
import { loadMemory, normFactTerm } from "../../src/adapters/memory/core.mjs";

const tmp = () => mkdtemp(join(tmpdir(), "tmct-unknown-ingest-"));
const attr = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value;
const factRows = (mem) => (mem.individuals || []).filter((i) => i.class === "Fact").map((f) => ({
  subject: attr(f, "subject"), predicate: attr(f, "predicate"), object: attr(f, "object"),
  provenance: attr(f, "provenance"),
}));

test("passageFor: prefers surfaceText (bracket-stripped) over the map's surface template", async () => {
  const map = await loadMap();
  const relatedToRow = map.get("/r/RelatedTo");
  assert.equal(
    passageFor({ start: "/c/en/gizmo", rel: "/r/RelatedTo", end: "/c/en/widget", surfaceText: "[[gizmo]] is related to [[widget]]" }, relatedToRow),
    "gizmo is related to widget",
  );
  // no surfaceText -> falls back to the row's own {start}/{end} template
  assert.equal(
    passageFor({ start: "/c/en/gizmo", rel: "/r/RelatedTo", end: "/c/en/widget" }, relatedToRow),
    relatedToRow.surface.replace("{start}", "gizmo").replace("{end}", "widget"),
  );
  // neither source available -> null, never a fabricated sentence
  assert.equal(passageFor({ start: "/c/en/gizmo", rel: "/r/RelatedTo", end: "/c/en/widget" }, { surface: undefined }), null);
});

test("knownTermsFrom: unions existing memory Fact terms with a batch's own mapped-fact terms (pure, no I/O)", () => {
  const known = knownTermsFrom({ individuals: [{ class: "Fact", attributes: [{ key: "subject", value: "cache" }, { key: "object", value: "buffer" }] }] }, [{ subject: "list", object: "array" }]);
  assert.ok(known.has("cache"));
  assert.ok(known.has("buffer"));
  assert.ok(known.has("list"));
  assert.ok(known.has("array"));
  assert.ok(!known.has("gizmo"));
});

test("ingestUnknownFromAssertions: an unknown term from a dropped (ace=none) row is captured, tagged with its context passage, and linked to its co-occurring term", async () => {
  const dir = await tmp();
  try {
    const map = await loadMap();
    const assertions = [
      // ace != "none" — a real mapped fact, makes "gadget" a KNOWN term.
      { start: "/c/en/gadget", rel: "/r/IsA", end: "/c/en/device", weight: 1 },
      // ace = "none" (DerivedFrom) — silently dropped by toFacts(); "widget" and
      // "sprocket" never get a reified Fact any other way in this batch.
      { start: "/c/en/widget", rel: "/r/DerivedFrom", end: "/c/en/sprocket", weight: 1, surfaceText: "[[widget]] is derived from [[sprocket]]" },
    ];
    const mappedFacts = [{ subject: "gadget", predicate: "rdfs:subClassOf", object: "device" }];

    const result = await ingestUnknownFromAssertions(dir, { assertions, map, mappedFacts, provenancePrefix: "corpus:test-unknown" });
    assert.equal(result.captured, 2, "both widget and sprocket are unknown -> both captured");
    assert.ok(result.linked >= 2, "at least the direct widget<->sprocket pair is linked");
    assert.ok(result.appended > 0);

    const mem = await loadMemory(dir);
    const rows = factRows(mem);

    const widgetContext = rows.find((r) => r.subject === "widget" && r.predicate === CONTEXT_PASSAGE_PREDICATE);
    assert.ok(widgetContext, "widget got a context-passage fact");
    assert.equal(widgetContext.object, "widget is derived from sprocket", "the passage is stored verbatim (normalized)");
    assert.match(widgetContext.provenance, /corpus:test-unknown \/r\/DerivedFrom/);

    const sprocketContext = rows.find((r) => r.subject === "sprocket" && r.predicate === CONTEXT_PASSAGE_PREDICATE);
    assert.ok(sprocketContext, "sprocket got a context-passage fact too (both endpoints were unknown)");

    const widgetLink = rows.find((r) => r.subject === "widget" && r.predicate === CO_OCCURS_PREDICATE && r.object === "sprocket");
    assert.ok(widgetLink, "widget is linked to its co-occurring term sprocket");
    const sprocketLink = rows.find((r) => r.subject === "sprocket" && r.predicate === CO_OCCURS_PREDICATE && r.object === "widget");
    assert.ok(sprocketLink, "sprocket is linked back to widget");

    // "gadget" never appears in either captured term's context — it wasn't in
    // this passage — so it must not show up as a bogus co-occurrence link.
    assert.ok(!rows.some((r) => r.predicate === CO_OCCURS_PREDICATE && (r.subject === "gadget" || r.object === "gadget")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestUnknownFromAssertions: a KNOWN term co-occurring in the passage also gets linked (not just the row's direct pair)", async () => {
  const dir = await tmp();
  try {
    const map = await loadMap();
    // "gremlin" is genuinely unknown; the passage happens to mention "device",
    // which IS already known (via the mapped gadget IsA device fact) — this
    // proves "known or unknown ... co-occurring ... get linked", not just the
    // triple's own two endpoints.
    const assertions = [
      { start: "/c/en/gadget", rel: "/r/IsA", end: "/c/en/device", weight: 1 },
      { start: "/c/en/gremlin", rel: "/r/DerivedFrom", end: "/c/en/mischief", weight: 1, surfaceText: "[[gremlin]] is a small device that causes mischief" },
    ];
    const mappedFacts = [{ subject: "gadget", predicate: "rdfs:subClassOf", object: "device" }];

    await ingestUnknownFromAssertions(dir, { assertions, map, mappedFacts, provenancePrefix: "corpus:test-unknown" });
    const mem = await loadMemory(dir);
    const rows = factRows(mem);
    const extraLink = rows.find((r) => r.subject === "gremlin" && r.predicate === CO_OCCURS_PREDICATE && r.object === "device");
    assert.ok(extraLink, "gremlin is linked to 'device', a known term merely mentioned in its passage");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestUnknownFromAssertions: both endpoints already known -> nothing captured (mapped facts already cover them)", async () => {
  const dir = await tmp();
  try {
    const map = await loadMap();
    const assertions = [
      { start: "/c/en/cache", rel: "/r/RelatedTo", end: "/c/en/buffer", weight: 1, surfaceText: "[[cache]] is related to [[buffer]]" },
    ];
    const mappedFacts = [
      { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer" },
      { subject: "buffer", predicate: "rdfs:subClassOf", object: "storage" },
    ];
    const result = await ingestUnknownFromAssertions(dir, { assertions, map, mappedFacts, provenancePrefix: "corpus:test-unknown" });
    assert.deepEqual(result, { captured: 0, linked: 0, appended: 0, skipped: 0 });
    const mem = await loadMemory(dir);
    assert.equal((mem.individuals || []).length, 0, "nothing was written at all");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestUnknownFromAssertions: a mapped (ace != none) row is never re-captured — toFacts already reified it", async () => {
  const dir = await tmp();
  try {
    const map = await loadMap();
    const assertions = [{ start: "/c/en/quibble", rel: "/r/IsA", end: "/c/en/argument", weight: 1 }];
    const mappedFacts = [{ subject: "quibble", predicate: "rdfs:subClassOf", object: "argument" }];
    // "quibble" would be unknown by knownTermsFrom's own criteria EXCEPT it's
    // already in mappedFacts (this batch's own reified fact) — never touched
    // here since the row's relation (/r/IsA) isn't ace="none" in the first place.
    const result = await ingestUnknownFromAssertions(dir, { assertions, map, mappedFacts, provenancePrefix: "corpus:test-unknown" });
    assert.deepEqual(result, { captured: 0, linked: 0, appended: 0, skipped: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seedMemory: captureUnknownContext defaults false -> byte-identical to today (no `unknown` key, no extra facts)", async () => {
  const dir = await tmp();
  try {
    const res = await seedMemory(dir, { limit: 25 });
    assert.equal(res.unknown, undefined);
    const mem = await loadMemory(dir);
    assert.equal((mem.individuals || []).filter((i) => i.class === "Fact").length, res.appended);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("seedMemory: captureUnknownContext=true end-to-end, over a small fixture slice with a genuinely dropped DerivedFrom row", async () => {
  const dir = await tmp();
  const slicePath = join(dir, "fixture-slice.jsonl");
  try {
    const rows = [
      { start: "/c/en/software_bug", rel: "/r/IsA", end: "/c/en/error", weight: 2 },
      { start: "/c/en/frobnicator", rel: "/r/DerivedFrom", end: "/c/en/widgetiser", weight: 1, surfaceText: "[[frobnicator]] is derived from [[widgetiser]]" },
    ];
    await writeFile(slicePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

    const res = await seedMemory(dir, { slicePath, provenancePrefix: "corpus:fixture", captureUnknownContext: true });
    assert.equal(res.appended, 1, "the one mapped IsA fact");
    assert.ok(res.unknown, "the unknown-ingest result is present when the flag is set");
    assert.equal(res.unknown.captured, 2, "both frobnicator and widgetiser are novel, unrecognized terms");
    assert.ok(res.unknown.appended > 0);

    const mem = await loadMemory(dir);
    const rows2 = factRows(mem);
    const ctx = rows2.find((r) => r.subject === "frobnicator" && r.predicate === CONTEXT_PASSAGE_PREDICATE);
    assert.ok(ctx, "frobnicator captured via the seedMemory hook, not just the standalone module call");
    assert.match(ctx.provenance, /corpus:fixture-unknown/, "provenancePrefix threads through with a distinguishing -unknown suffix");
    const link = rows2.find((r) => r.subject === "frobnicator" && r.predicate === CO_OCCURS_PREDICATE && r.object === "widgetiser");
    assert.ok(link);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normFactTerm agreement: a captured unknown term's stored subject matches normFactTerm exactly (queryable like any other fact)", async () => {
  const dir = await tmp();
  try {
    const map = await loadMap();
    const assertions = [{ start: "/c/en/the_gronk", rel: "/r/DerivedFrom", end: "/c/en/a_snerf", weight: 1, surfaceText: "[[the gronk]] is derived from [[a snerf]]" }];
    await ingestUnknownFromAssertions(dir, { assertions, map, mappedFacts: [], provenancePrefix: "corpus:test-unknown" });
    const mem = await loadMemory(dir);
    const rows = factRows(mem);
    assert.ok(rows.some((r) => r.subject === normFactTerm("the_gronk") && r.predicate === CONTEXT_PASSAGE_PREDICATE));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
