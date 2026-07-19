// svg-instance-ids: namespacing a resolved sprite's own ids so two
// differently-valued instances of the same template never collide once
// both are in the same document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namespaceSvgIds } from "../../src/domain/svg-instance-ids.mjs";

const GRADIENT_SVG = '<svg><defs><linearGradient id="lamp-fill"><stop stop-color="#c9a24b"/></linearGradient></defs><path fill="url(#lamp-fill)"/></svg>';

test("a falsy instanceKey leaves the svg byte-for-byte unchanged", () => {
  assert.equal(namespaceSvgIds(GRADIENT_SVG, undefined), GRADIENT_SVG);
  assert.equal(namespaceSvgIds(GRADIENT_SVG, ""), GRADIENT_SVG);
  assert.equal(namespaceSvgIds(GRADIENT_SVG, 0), GRADIENT_SVG);
});

test("an instanceKey suffixes both the id declaration and its url(#...) reference", () => {
  const out = namespaceSvgIds(GRADIENT_SVG, "the-lamp");
  assert.ok(out.includes('id="lamp-fill-the-lamp"'));
  assert.ok(out.includes('url(#lamp-fill-the-lamp)'));
  assert.ok(!out.includes('id="lamp-fill"'), "the un-namespaced id must not remain");
});

test("two different instance keys produce two non-colliding ids for the same template", () => {
  const a = namespaceSvgIds(GRADIENT_SVG, "lamp-1");
  const b = namespaceSvgIds(GRADIENT_SVG, "lamp-2");
  assert.notEqual(a, b);
  assert.ok(a.includes('id="lamp-fill-lamp-1"'));
  assert.ok(b.includes('id="lamp-fill-lamp-2"'));
});

test("an instanceKey with characters unsafe in an id/url token is sanitized, not rejected", () => {
  const out = namespaceSvgIds(GRADIENT_SVG, "room 3 / slot #7");
  assert.match(out, /id="lamp-fill-room-3---slot--7"/);
});

test("a template with no ids at all is untouched even with a real instanceKey", () => {
  const flat = "<svg><circle fill=\"currentColor\"/></svg>";
  assert.equal(namespaceSvgIds(flat, "anything"), flat);
});

test("multiple distinct ids in one svg are each namespaced independently", () => {
  const svg = '<svg><defs><linearGradient id="a"/><radialGradient id="b"/></defs><path fill="url(#a)" stroke="url(#b)"/></svg>';
  const out = namespaceSvgIds(svg, "x1");
  assert.ok(out.includes('id="a-x1"') && out.includes('url(#a-x1)'));
  assert.ok(out.includes('id="b-x1"') && out.includes('url(#b-x1)'));
});
