// The segmentation IR byte-parity proof.
// render() is now flatten(renderSegments()); this file proves that refactor is
// BYTE-IDENTICAL over the entire committed template library, and that the split
// is well-formed (prose spans are literal wording, slot fills are protected).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATES_FILE, loadTemplates, render, renderSegments, flatten, slotKind,
} from "../../src/adapters/corpus/templates.mjs";
import { isProtected } from "../../src/finish.mjs";

const SLOT_G = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

// A distinctive, non-empty fill per slot so a fill is unambiguously recoverable.
function synthSlots(row) {
  const slots = {};
  for (const s of row.slots) slots[s] = `«fill:${s}»`;
  return slots;
}

test("BYTE PARITY: render(id) === flatten(renderSegments(id)) for EVERY responses.jsonl row", async () => {
  const templates = await loadTemplates(TEMPLATES_FILE);
  let verified = 0;
  for (const [id, row] of templates) {
    const slots = synthSlots(row);
    const flat = render(id, slots, templates);
    const segs = renderSegments(id, slots, templates);
    assert.equal(flatten(segs), flat, `flatten(renderSegments) !== render() for "${id}"`);
    verified += 1;
  }
  assert.ok(verified >= 40, `a real library was verified byte-identical (${verified} rows)`);
  // eslint-disable-next-line no-console
  console.log(`segments: ${verified} template rows render byte-identical through the IR`);
});

test("well-formed split: prose spans are literal template text; slot fills are PROTECTED and typed by slotKind", async () => {
  const templates = await loadTemplates(TEMPLATES_FILE);
  for (const [id, row] of templates) {
    const slots = synthSlots(row);
    const fillToName = new Map(row.slots.map((s) => [slots[s], s]));
    const segs = renderSegments(id, slots, templates);
    const slotOccurrences = [...row.template.matchAll(SLOT_G)].length;
    let protectedCount = 0;
    for (const seg of segs) {
      assert.ok(seg.text.length > 0, `no empty segment in "${id}"`);
      if (isProtected(seg.type)) {
        protectedCount += 1;
        const name = fillToName.get(seg.text);
        assert.ok(name, `protected span in "${id}" is a slot fill, got ${JSON.stringify(seg.text)}`);
        assert.equal(seg.type, slotKind(name), `protected span typed by slotKind for {${name}} in "${id}"`);
      } else {
        assert.equal(seg.type, "prose");
        assert.ok(!fillToName.has(seg.text), `prose span in "${id}" is literal wording, never a fill`);
        assert.ok(row.template.includes(seg.text), `prose span in "${id}" is a literal substring of the template`);
      }
    }
    assert.equal(protectedCount, slotOccurrences, `one protected span per slot occurrence in "${id}"`);
  }
});

test("slotKind: numbers, paths, and the conservative entity default", () => {
  assert.equal(slotKind("count"), "number");
  assert.equal(slotKind("when"), "number");
  assert.equal(slotKind("location"), "path");
  assert.equal(slotKind("commit"), "path");
  assert.equal(slotKind("subject"), "entity");
  assert.equal(slotKind("object"), "entity");
  assert.equal(slotKind("whatever-unknown"), "entity"); // protect-when-unsure
});

test("flatten is a pure total inverse: join of texts, empty list is empty string", () => {
  assert.equal(flatten([]), "");
  assert.equal(flatten([{ type: "prose", text: "a" }, { type: "entity", text: "b" }, { type: "prose", text: "c" }]), "abc");
});

test("renderSegments validation matches render(): unknown id and missing slots throw the same messages", async () => {
  const templates = await loadTemplates(TEMPLATES_FILE);
  assert.throws(() => renderSegments("no-such-template", {}, templates), /unknown template id "no-such-template"/);
  assert.throws(() => renderSegments("recall-plain", {}, templates), /missing slot: fact/);
  assert.throws(() => renderSegments("ambiguity-two", { a: "x", b: "y" }, templates), /missing slots: aAnswer, bAnswer/);
});
