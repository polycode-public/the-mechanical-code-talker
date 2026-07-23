import { Base } from "./base.mjs";
import { parseNode } from "./graph.mjs";

// A widget that measures its own node tree using the core graph helper.
export class Widget extends Base {
  render(tree) {
    return parseNode(tree);
  }
}

export function makeWidget(name) {
  return new Widget(name);
}
