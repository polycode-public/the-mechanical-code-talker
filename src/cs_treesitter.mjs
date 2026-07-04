// C# extractor — tree-sitter-c-sharp (CST-only) candidate for the bake-off. The
// no-.NET fallback: a uniform CST, no semantic model (no resolved call targets /
// types). Emits the same contract shape so codegraph.mjs/digest consume it. Module
// identity is per-file; `dotted` is the file's primary namespace.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { walk, relPath } from "./walk.mjs";

// tree-sitter is the OPTIONAL fallback backend (used only when Roslyn/dotnet is
// absent). It is a native module and NOT a declared seonix dependency, so the
// require is LAZY — importing this module (e.g. via extract_lang's REGISTRY) must
// not force the native build. Resolved on first parse; a clear error if missing.
const require = createRequire(import.meta.url);
let _Parser = null;
let _CSharp = null;
function loadTreeSitter() {
  if (_Parser) return { Parser: _Parser, CSharp: _CSharp };
  try {
    _Parser = require("tree-sitter");
    _CSharp = require("tree-sitter-c-sharp");
  } catch (e) {
    throw new Error(
      `tree-sitter C# fallback unavailable (install tree-sitter + tree-sitter-c-sharp, or use the Roslyn backend): ${e?.message || e}`,
    );
  }
  return { Parser: _Parser, CSharp: _CSharp };
}

const EXTS = [".cs"];
const line = (n) => n.startPosition.row + 1;
const endLine = (n) => n.endPosition.row + 1;
const fieldText = (n, f) => n.childForFieldName(f)?.text || "";

const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "struct_declaration", "record_declaration", "enum_declaration"]);
const SUBKIND = { interface_declaration: "interface", struct_declaration: "struct", record_declaration: "record", enum_declaration: "enum" };

function collectCalls(node) {
  const out = new Set();
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "invocation_expression") {
      const fn = n.childForFieldName("function");
      if (fn) out.add(fn.text.replace(/\s+/g, "").slice(0, 80));
    } else if (n.type === "object_creation_expression") {
      // `new X(...)` → bare "X" (generics/qualifiers stripped); implicit `new(...)`
      // is a different node type and stays excluded (matches the Roslyn backend).
      const t = n.childForFieldName("type");
      const nm = t ? t.text.replace(/\s+/g, "").replace(/<.*$/s, "").split(".").pop() : "";
      if (nm) out.add(nm.slice(0, 80));
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i));
  }
  return [...out].sort();
}

function modifiersText(node) {
  // tree-sitter-c-sharp surfaces modifiers as anonymous children before the name
  const mods = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.type === "modifier") mods.push(c.text);
  }
  return mods;
}
const visFrom = (mods) => mods.includes("private") ? "private" : mods.includes("protected") ? "protected" : "";

/** Emit one type declaration (and, recursively, its nested types as Outer.Inner —
 *  matching the Roslyn backend's qualified names). kind stays "class"; the flavour
 *  (interface/struct/record/enum) lands in `subkind`. */
function emitType(n, prefix, defines, exports) {
  const simple = fieldText(n, "name");
  if (!simple) return;
  const cname = prefix ? `${prefix}.${simple}` : simple;
  const mods = modifiersText(n);
  const bases = [];
  const baseList = n.childForFieldName("bases") || n.namedChildren.find((c) => c.type === "base_list");
  if (baseList) for (let i = 0; i < baseList.namedChildCount; i++) bases.push(baseList.namedChild(i).text.slice(0, 80));
  defines.push({ name: cname, kind: "class", lineno: line(n), end_lineno: endLine(n), bases, decorators: [],
    ...(SUBKIND[n.type] ? { subkind: SUBKIND[n.type] } : {}),
    ...(visFrom(mods) ? { visibility: visFrom(mods) } : {}) });
  if (mods.includes("public")) exports.add(cname);
  const body = n.childForFieldName("body");
  if (!body) return;
  for (let i = 0; i < body.namedChildCount; i++) {
    const mem = body.namedChild(i);
    if (TYPE_DECLS.has(mem.type)) {
      emitType(mem, cname, defines, exports); // nested type → Outer.Inner
    } else if (mem.type === "enum_member_declaration") {
      const mn = fieldText(mem, "name") || mem.text;
      if (mn) defines.push({ name: `${cname}.${mn}`, kind: "attribute", lineno: line(mem), end_lineno: endLine(mem), decorators: [], is_constant: true });
    } else if (mem.type === "method_declaration" || mem.type === "constructor_declaration" || mem.type === "local_function_statement") {
      const mn = fieldText(mem, "name") || cname;
      const mmods = modifiersText(mem);
      const params = (mem.childForFieldName("parameters")?.text || "").replace(/\s+/g, " ").replace(/^\(|\)$/g, "").slice(0, 160);
      const returns = (mem.childForFieldName("returns") || mem.childForFieldName("type"))?.text?.slice(0, 80) || "";
      defines.push({ name: `${cname}.${mn}`, kind: "method", lineno: line(mem), end_lineno: endLine(mem),
        decorators: [], params, returns, calls: collectCalls(mem),
        ...(mmods.includes("static") ? { is_static: true } : {}),
        ...(visFrom(mmods) ? { visibility: visFrom(mmods) } : {}) });
    } else if (mem.type === "property_declaration") {
      const mn = fieldText(mem, "name");
      if (mn) defines.push({ name: `${cname}.${mn}`, kind: "attribute", lineno: line(mem), end_lineno: endLine(mem), decorators: [] });
    } else if (mem.type === "field_declaration") {
      const v = mem.descendantsOfType?.("variable_declarator")?.[0];
      const mn = v ? fieldText(v, "name") || v.text : "";
      if (mn) defines.push({ name: `${cname}.${mn}`, kind: "attribute", lineno: line(mem), end_lineno: endLine(mem), decorators: [] });
    }
  }
}

export async function extractFile(absPath, root) {
  const text = await readFile(absPath, "utf8").catch(() => null);
  const path = relPath(root, absPath);
  if (text == null) return { failed: true, path };
  let tree;
  try {
    const { Parser, CSharp } = loadTreeSitter();
    const p = new Parser(); p.setLanguage(CSharp);
    tree = p.parse(text);
  } catch { return { failed: true, path }; }

  const imports = new Set();
  const defines = [];
  const exports = new Set();
  let primaryNs = "";

  const stack = [tree.rootNode];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === "using_directive") {
      const nm = (n.childForFieldName("name") || n.namedChildren.find((c) => /name/.test(c.type)));
      const t = (nm?.text || n.text.replace(/^using\s+|;$/g, "")).trim();
      if (t && !/^static\s/.test(t)) imports.add(t.replace(/\s+/g, ""));
    } else if ((n.type === "namespace_declaration" || n.type === "file_scoped_namespace_declaration") && !primaryNs) {
      primaryNs = fieldText(n, "name");
    } else if (TYPE_DECLS.has(n.type)) {
      emitType(n, "", defines, exports);
    }
    // descend, but not back into a type body (emitType recurses for nested types)
    if (!TYPE_DECLS.has(n.type)) for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i));
  }

  return { path, dotted: primaryNs || path.replace(/\.cs$/i, "").split("/").join("."),
    imports: [...imports].sort(), defines, calls: collectCalls(tree.rootNode), exports: [...exports].sort() };
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

export const meta = { id: "treesitter-cs", language: "c#", lib: "tree-sitter-c-sharp", exts: EXTS };
