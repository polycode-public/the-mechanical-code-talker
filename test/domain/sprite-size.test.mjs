// sprite-size: a taught size-descriptive property resolved to a plain
// numeric render scale, no template file involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeScaleFor } from "../../src/domain/sprite-size.mjs";

const hasProperty = (object) => ({ predicate: "mgx:hasProperty", object });

test("no property facts at all resolves to the natural size, scale 1", () => {
  assert.equal(sizeScaleFor([]), 1);
  assert.equal(sizeScaleFor(undefined), 1);
});

test("small/large/long/tall each resolve to their own distinct scale factor", () => {
  assert.equal(sizeScaleFor([hasProperty("small")]), 0.8);
  assert.equal(sizeScaleFor([hasProperty("large")]), 1.3);
  assert.equal(sizeScaleFor([hasProperty("long")]), 1.2);
  assert.equal(sizeScaleFor([hasProperty("tall")]), 1.25);
});

test("a property value outside the closed size vocabulary never moves the scale", () => {
  assert.equal(sizeScaleFor([hasProperty("purple")]), 1);
});

test("a fact under a different predicate is never mistaken for a size property", () => {
  assert.equal(sizeScaleFor([{ predicate: "mgx:madeOf", object: "large" }]), 1);
});

test("the first matching size fact wins when an instance somehow carries more than one", () => {
  assert.equal(sizeScaleFor([hasProperty("small"), hasProperty("large")]), 0.8);
});
