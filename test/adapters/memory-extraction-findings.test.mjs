// Extraction findings on the assertion record: how the extractor read the
// sentence one source's assertion came from, stored beside that record's own
// provenance and read back per assertion and as the row's union. A finding is a
// named property of the parse with a detector behind it — never a score, and
// never a claim about the triple itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendFact, appendFacts, loadMemory, readFactRows,
  EXTRACTION_FINDING_PROP, EXTRACTION_FINDINGS,
} from "../../src/adapters/memory/core.mjs";
import { validateIndividual } from "../../src/adapters/memory/shacl.mjs";
import { touchedFactRows } from "../../src/domain/memory/touched-facts.mjs";
import { FINDING_CAVEATS } from "../../src/domain/fact-phrase.mjs";
import { ingestText } from "../../src/services/extract-facts.mjs";

const LATENCY_SENTENCE =
  "In engineering, latency is the name for the time period that needs to be waited to see a result.";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-mem-findings-"));

const rowsOf = async (dir) => readFactRows(await loadMemory(dir));
const rowFor = (rows, subject) => rows.find((r) => r.subject === subject);

function factIndividual(attributes) {
  return {
    id: "fact:abcd1234@src:teach-chat",
    label: "a fact",
    class: "Fact",
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: "cell" },
      { prop: "rdf:predicate", key: "predicate", value: "rdfs:subClassOf" },
      { prop: "rdf:object", key: "object", value: "unit" },
      ...attributes,
    ],
  };
}

test("the write gate takes a finding from the closed vocabulary and turns down anything else", () => {
  for (const finding of EXTRACTION_FINDINGS) {
    const { ok, violations } = validateIndividual(factIndividual([
      { prop: EXTRACTION_FINDING_PROP, key: "extraction", value: finding },
    ]));
    assert.equal(ok, true, `${finding} is storable: ${violations.join(" | ")}`);
  }
  // Several findings ride one assertion as a space-joined list.
  assert.equal(validateIndividual(factIndividual([
    { prop: EXTRACTION_FINDING_PROP, key: "extraction", value: "clause-fallback identifier-token" },
  ])).ok, true);
  // A record that carries none at all is the ordinary case.
  assert.equal(validateIndividual(factIndividual([])).ok, true);

  // A decline reason names a candidate that was never stored, so it has no
  // record to ride, and an invented name would make decline-by-name untestable.
  for (const value of ["relative-clause-verb", "fragment-term", "probably-fine", ""]) {
    const { ok, violations } = validateIndividual(factIndividual([
      { prop: EXTRACTION_FINDING_PROP, key: "extraction", value },
    ]));
    assert.equal(ok, false, `${JSON.stringify(value)} is refused`);
    assert.ok(violations.join(" ").includes("mgx:extractionFinding"), "the violation names the property");
  }
});

test("every caveat template names a finding a record can actually carry", () => {
  for (const finding of Object.keys(FINDING_CAVEATS)) {
    assert.ok(EXTRACTION_FINDINGS.includes(finding), `${finding} is a storable finding`);
  }
});

test("a finding rides the assertion that recorded it, and a clean re-assertion inherits none", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, {
      subject: "normalizefeeditems", predicate: "tmct:has", object: "guid",
      provenance: "optimistic-extract:notes.md", extraction: ["identifier-token"],
    });
    // A second source states the same triple with nothing to declare about how
    // it read it. The finding belongs to the first reading, not to the triple.
    await appendFact(dir, {
      subject: "normalizefeeditems", predicate: "tmct:has", object: "guid",
      provenance: "ace:chat:0189",
    });

    const row = rowFor(await rowsOf(dir), "normalizefeeditems");
    assert.equal(row.assertions.length, 2, "two sources, two assertion records");
    const marked = row.assertions.filter((a) => a.extraction);
    assert.equal(marked.length, 1, "only the reading that recorded a finding carries one");
    assert.deepEqual(marked[0].extraction, ["identifier-token"]);
    assert.ok(!("extraction" in row.assertions.find((a) => a !== marked[0])),
      "the clean assertion carries no extraction field at all");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a row unions every finding its live assertions carry, and omits the field when there are none", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, [
      {
        subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
        provenance: "optimistic-extract:biology.md", extraction: ["clause-fallback"],
      },
      {
        subject: "heart", predicate: "tmct:has", object: "valve",
        provenance: "optimistic-extract:biology.md",
      },
    ]);
    // A second source reads the same triple a different way.
    await appendFact(dir, {
      subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
      provenance: "extracted:biology.md", extraction: ["pronoun-carry"],
    });

    const rows = await rowsOf(dir);
    assert.deepEqual(rowFor(rows, "cell").extraction, ["clause-fallback", "pronoun-carry"]);
    assert.ok(!("extraction" in rowFor(rows, "heart")),
      "a row nothing was recorded about carries no extraction field");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the union is the finding SET, however the writes ordered it", async () => {
  const write = async (order) => {
    const dir = await tmpRepo();
    try {
      await appendFact(dir, {
        subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
        provenance: "optimistic-extract:notes.md", extraction: order,
      });
      return rowFor(await rowsOf(dir), "cell");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const forward = await write(["identifier-token", "clause-fallback"]);
  const backward = await write(["clause-fallback", "identifier-token", "clause-fallback"]);
  assert.deepEqual(forward.extraction, backward.extraction);
  assert.deepEqual(forward.extraction, ["clause-fallback", "identifier-token"]);
  assert.deepEqual(forward.assertions[0].extraction, backward.assertions[0].extraction);
});

test("a row written before findings existed reads back with no extraction field", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, {
      subject: "kestrel", predicate: "rdfs:subClassOf", object: "bird",
      provenance: "ace:chat:0189",
    });
    const row = rowFor(await rowsOf(dir), "kestrel");
    assert.ok(!("extraction" in row), "absence is the shape, not an empty array");
    for (const assertion of row.assertions) {
      assert.ok(!("extraction" in assertion), "and the same on every assertion");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("factsTouched carries a written row's findings through the same diff", async () => {
  const dir = await tmpRepo();
  try {
    const before = await rowsOf(dir);
    await appendFact(dir, {
      subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
      provenance: "extracted:biology.md", extraction: ["pronoun-carry"],
    });
    await appendFact(dir, {
      subject: "heart", predicate: "tmct:has", object: "valve",
      provenance: "extracted:biology.md",
    });

    const touched = touchedFactRows(before, await rowsOf(dir));
    assert.equal(touched.length, 2);
    assert.deepEqual(touched.find((r) => r.subject === "cell").extraction, ["pronoun-carry"]);
    assert.ok(!("extraction" in touched.find((r) => r.subject === "heart")),
      "the field is additive: absent unless something was recorded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the same source re-delivering its assertion keeps the finding its first reading recorded", async () => {
  const dir = await tmpRepo();
  try {
    const write = () => appendFact(dir, {
      subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
      provenance: "optimistic-extract:biology.md", extraction: ["clause-fallback"],
    });
    await write();
    await write();
    const row = rowFor(await rowsOf(dir), "cell");
    assert.equal(row.assertions.length, 1, "a re-delivery is idempotent");
    assert.deepEqual(row.assertions[0].extraction, ["clause-fallback"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the definitional sentence stores its one edge, marked, and nothing else", async () => {
  const dir = await tmpRepo();
  try {
    const result = await ingestText(LATENCY_SENTENCE, {
      memoryDir: dir, sourceTag: "engineering.md", optimistic: true, findings: true,
    });
    assert.deepEqual(
      result.optimistic.map(({ subject, predicate, object, extraction }) => ({ subject, predicate, object, extraction })),
      [{ subject: "latency", predicate: "mgx:nameFor", object: "time period", extraction: ["definitional-frame"] }],
    );
    assert.deepEqual(result.extracted, []);

    const rows = await rowsOf(dir);
    assert.deepEqual(
      rows.map((r) => `${r.subject} ${r.predicate} ${r.object}`),
      ["latency mgx:nameFor time period"],
    );
    assert.deepEqual(rows[0].extraction, ["definitional-frame"]);
    assert.deepEqual(rows[0].assertions[0].extraction, ["definitional-frame"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an identifier-shaped endpoint marks the row it grounded, and a plain one does not", async () => {
  const dir = await tmpRepo();
  try {
    await ingestText(
      "A volcano is a mountain.\n\nnormalizeFeedItems is a function.",
      { memoryDir: dir, sourceTag: "notes.md", optimistic: true, findings: true },
    );
    const rows = await rowsOf(dir);
    assert.deepEqual(rowFor(rows, "normalizefeeditems").extraction, ["identifier-token"]);
    assert.ok(!("extraction" in rowFor(rows, "volcano")),
      "an ordinary word grounds with nothing to declare");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingest records nothing on the assertion unless the run asks for findings", async () => {
  const dir = await tmpRepo();
  try {
    await ingestText("normalizeFeedItems is a function.", {
      memoryDir: dir, sourceTag: "notes.md", optimistic: true,
    });
    const row = rowFor(await rowsOf(dir), "normalizefeeditems");
    assert.ok(row, "the fact still grounds");
    assert.ok(!("extraction" in row), "absence means nothing was recorded, not that it read cleanly");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
