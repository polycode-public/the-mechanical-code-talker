// Java extractor — tree-sitter-java (CST-only) fallback for the bake-off. The
// no-JDK path: a uniform CST, no symbol solver (so call targets are syntax-level
// names, NOT resolved to in-repo/JDK qualified names — that promotion is the
// JavaParser backend's job). Emits the same {modules:[{path,dotted,imports,
// defines,calls,exports}]} contract so codegraph.mjs/digest consume it unchanged.
// Module identity is per-file; `dotted` is the file's package + primary type.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { walk, relPath } from "./walk.mjs";

// tree-sitter is the OPTIONAL fallback backend (used only when a JDK/`java` is
// absent). It is a native module and NOT a declared seonix dependency, so the
// require is LAZY — importing this module (e.g. via extract_lang's REGISTRY) must
// not force the native build. Resolved on first parse; a clear error if missing.
const require = createRequire(import.meta.url);
let _Parser = null;
let _Java = null;
function loadTreeSitter() {
  if (_Parser) return { Parser: _Parser, Java: _Java };
  try {
    _Parser = require("tree-sitter");
    _Java = require("tree-sitter-java");
  } catch (e) {
    throw new Error(
      `tree-sitter Java fallback unavailable (install tree-sitter + tree-sitter-java, or use the JavaParser backend): ${e?.message || e}`,
    );
  }
  return { Parser: _Parser, Java: _Java };
}

const EXTS = [".java"];
const line = (n) => n.startPosition.row + 1;
const endLine = (n) => n.endPosition.row + 1;
const oneLine = (s) => (s || "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n));
const fieldText = (n, f) => n.childForFieldName(f)?.text || "";

const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration"]);
const SUBKIND = { interface_declaration: "interface", enum_declaration: "enum", record_declaration: "record" };
const BASE_WRAPPERS = new Set(["superclass", "super_interfaces", "extends_interfaces", "interfaces"]);
const TYPE_NODES = new Set(["type_identifier", "generic_type", "scoped_type_identifier"]);

/** Callee names within a node (syntax-level; unresolved). Object creations count as
 *  call edges to the created type: `new X(...)` → bare "X" (generics/scope stripped). */
function collectCalls(node) {
  const out = new Set();
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "method_invocation") {
      const nm = fieldText(n, "name");
      if (nm) out.add(clip(nm, 80));
    } else if (n.type === "object_creation_expression") {
      const t = n.childForFieldName("type");
      const nm = t ? oneLine(t.text).replace(/<.*$/s, "").split(".").pop().trim() : "";
      if (nm) out.add(clip(nm, 80));
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i));
  }
  return [...out].sort();
}

/** Base types (extends + implements) declared on a type node. */
function basesOf(node) {
  const bases = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!BASE_WRAPPERS.has(c.type)) continue;
    const stack = [c];
    while (stack.length) {
      const w = stack.pop();
      if (TYPE_NODES.has(w.type)) { bases.push(clip(oneLine(w.text), 80)); continue; }
      for (let j = 0; j < w.namedChildCount; j++) stack.push(w.namedChild(j));
    }
  }
  return bases;
}

function modifiersNode(node) {
  for (let i = 0; i < node.namedChildCount; i++) {
    if (node.namedChild(i).type === "modifiers") return node.namedChild(i);
  }
  return null;
}
function decoratorsFrom(mods) {
  if (!mods) return [];
  const out = [];
  for (let i = 0; i < mods.namedChildCount; i++) {
    const c = mods.namedChild(i);
    if (c.type.endsWith("annotation")) out.push(clip(oneLine(c.text), 80));
  }
  return out;
}
function visFrom(mods) {
  const t = mods?.text || "";
  return /\bprivate\b/.test(t) ? "private" : /\bprotected\b/.test(t) ? "protected" : "";
}
const isPublic = (mods) => /\bpublic\b/.test(mods?.text || "");
const isStatic = (mods) => /\bstatic\b/.test(mods?.text || "");

function paramsText(node) {
  const fp = node.childForFieldName("parameters");
  if (!fp) return "";
  return clip(oneLine(fp.text.replace(/^\(|\)$/g, "")), 160);
}

function bodyContainer(typeNode) {
  return typeNode.childForFieldName("body")
    || typeNode.namedChildren?.find((c) => c.type === "class_body" || c.type === "enum_body" || c.type === "interface_body")
    || null;
}

/** Emit one type declaration (and, recursively, its nested types as Outer.Inner —
 *  matching the JavaParser backend's qualified names). kind stays "class"; the
 *  flavour (interface/enum/record) lands in `subkind`. */
function emitType(n, prefix, defines, exports) {
  const simple = fieldText(n, "name");
  if (!simple) return;
  const cname = prefix ? `${prefix}.${simple}` : simple;
  const mods = modifiersNode(n);
  defines.push({
    name: cname, kind: "class", lineno: line(n), end_lineno: endLine(n),
    bases: basesOf(n), decorators: decoratorsFrom(mods),
    ...(SUBKIND[n.type] ? { subkind: SUBKIND[n.type] } : {}),
    ...(visFrom(mods) ? { visibility: visFrom(mods) } : {}),
  });
  if (isPublic(mods)) exports.add(cname);

  // record components (formal params) surface as attributes (match JavaParser)
  if (n.type === "record_declaration") {
    const fp = n.childForFieldName("parameters");
    if (fp) for (let i = 0; i < fp.namedChildCount; i++) {
      const fpc = fp.namedChild(i);
      if (fpc.type !== "formal_parameter") continue;
      const pn = fieldText(fpc, "name");
      if (pn) defines.push({ name: `${cname}.${pn}`, kind: "attribute", lineno: line(fpc), end_lineno: endLine(fpc), decorators: [] });
    }
  }

  const body = bodyContainer(n);
  if (!body) return;
  // enum bodies keep constants at the top and wrap the rest in enum_body_declarations
  const members = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const mem = body.namedChild(i);
    if (mem.type === "enum_body_declarations") {
      for (let j = 0; j < mem.namedChildCount; j++) members.push(mem.namedChild(j));
    } else {
      members.push(mem);
    }
  }
  for (const mem of members) {
    if (TYPE_DECLS.has(mem.type)) {
      emitType(mem, cname, defines, exports); // nested type → Outer.Inner
    } else if (mem.type === "enum_constant") {
      const en = fieldText(mem, "name");
      if (en) defines.push({ name: `${cname}.${en}`, kind: "attribute", lineno: line(mem), end_lineno: endLine(mem), decorators: [], is_constant: true });
    } else if (mem.type === "method_declaration" || mem.type === "constructor_declaration") {
      const mn = fieldText(mem, "name") || cname;
      const mmods = modifiersNode(mem);
      const returns = mem.type === "method_declaration"
        ? clip(oneLine(mem.childForFieldName("type")?.text || ""), 80) : "";
      defines.push({
        name: `${cname}.${mn}`, kind: "method", lineno: line(mem), end_lineno: endLine(mem),
        decorators: decoratorsFrom(mmods), params: paramsText(mem),
        ...(returns ? { returns } : {}), calls: collectCalls(mem),
        ...(isStatic(mmods) ? { is_static: true } : {}),
        ...(visFrom(mmods) ? { visibility: visFrom(mmods) } : {}),
      });
    } else if (mem.type === "field_declaration") {
      const fmods = modifiersNode(mem);
      for (let j = 0; j < mem.namedChildCount; j++) {
        const vd = mem.namedChild(j);
        if (vd.type !== "variable_declarator") continue;
        const fn = fieldText(vd, "name");
        if (fn) defines.push({
          name: `${cname}.${fn}`, kind: "attribute", lineno: line(mem), end_lineno: endLine(mem),
          decorators: decoratorsFrom(fmods),
          ...(visFrom(fmods) ? { visibility: visFrom(fmods) } : {}),
        });
      }
    }
  }
}

export async function extractFile(absPath, root) {
  const text = await readFile(absPath, "utf8").catch(() => null);
  const path = relPath(root, absPath);
  if (text == null) return { failed: true, path };
  let tree;
  try {
    const { Parser, Java } = loadTreeSitter();
    const p = new Parser(); p.setLanguage(Java);
    tree = p.parse(text);
  } catch { return { failed: true, path }; }

  const imports = new Set();
  const defines = [];
  const exports = new Set();
  let pkg = "";

  const stack = [tree.rootNode];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "package_declaration" && !pkg) {
      pkg = oneLine(n.namedChildren.map((c) => c.text).join(""));
    } else if (n.type === "import_declaration") {
      if (/\bstatic\b/.test(n.text)) { /* skip static imports (mirror JavaParser) */ }
      else {
        const nm = n.namedChildren.find((c) => /identifier/.test(c.type))?.text;
        if (nm) imports.add(oneLine(nm));
      }
    } else if (TYPE_DECLS.has(n.type)) {
      emitType(n, "", defines, exports);
    }
    // descend, but not back into a type body (emitType recurses for nested types)
    if (!TYPE_DECLS.has(n.type)) for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i));
  }

  const base = path.replace(/\.java$/i, "").split("/").pop();
  const dotted = pkg ? `${pkg}.${base}` : path.replace(/\.java$/i, "").split("/").join(".");
  return {
    path, dotted, imports: [...imports].sort(), defines,
    calls: collectCalls(tree.rootNode), exports: [...exports].sort(),
  };
}

export async function ingest(root, { ignore = null } = {}) {
  const files = await walk(root, EXTS, ignore);
  const modules = [];
  const failures = [];
  for (const f of files) {
    const mod = await extractFile(f, root);
    if (mod.failed) failures.push(mod.path); else modules.push(mod);
  }
  return { modules, failures, fileCount: files.length };
}

export function toolAvailable() {
  try { loadTreeSitter(); return true; } catch { return false; }
}

export const meta = { id: "treesitter-java", language: "java", lib: "tree-sitter-java (CST, syntax-level)", exts: EXTS };
