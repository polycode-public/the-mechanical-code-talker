// turtle.mjs — a very small Turtle reader for schema.ttl's OWN regular shape:
// each class is one `:Name a rdfs:Class ;` block terminated by a line ending
// in ` .`, with `rdfs:label`/`rdfs:comment`/`rdfs:subClassOf` as `;`-separated
// predicate lines. Not a general Turtle parser — schema.ttl's own generator
// emits a single, very regular style (confirmed by direct inspection).
//
// Pure: text in, Map out, no imports.

/** Every rdfs:Class in `text`, as name -> { name, label, comment, subClassOf }.
 *  A class with no rdfs:label falls back to its own name; no rdfs:comment
 *  yields "". Blocks that are not classes (properties, say) are skipped. */
export function parseSchemaClasses(text) {
  const classes = new Map();
  const blocks = text.split(/\n(?=:[A-Za-z])/); // each class/property starts a new top-level block
  for (const block of blocks) {
    const head = /^:([A-Za-z0-9_]+)\s+a\s+rdfs:Class\s*;/.exec(block);
    if (!head) continue;
    const name = head[1];
    const label = /rdfs:label\s+"([^"]*)"/.exec(block)?.[1] || name;
    const comment = /rdfs:comment\s+"([^"]*)"/.exec(block)?.[1] || "";
    const subClassOf = [...block.matchAll(/rdfs:subClassOf\s+:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    classes.set(name, { name, label, comment, subClassOf });
  }
  return classes;
}
