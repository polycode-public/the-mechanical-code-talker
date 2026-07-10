class Base {
  constructor() {
    this.id = null;
  }
  // base placeholder
}

// ---- parseNode ----

function parseNode(node, depth = 0) {
  if (!node) return null;
  const out = { type: node.type, depth };
  if (node.children) {
    out.children = node.children.map((c) => parseNode(c, depth + 1));
  }
  if (node.value !== undefined) {
    out.value = node.value;
  }
  if (node.attrs) {
    out.attrs = { ...node.attrs };
  }
  out.parsed = true;
  return out;
}
