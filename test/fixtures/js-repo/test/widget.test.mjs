import { makeWidget } from "../src/widget.mjs";

// A test module so the producer emits a tests-coverage edge into src/widget.mjs.
export function checkWidget() {
  const w = makeWidget("demo");
  return w.render({ children: [] });
}
