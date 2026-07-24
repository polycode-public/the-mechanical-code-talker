// JS/TS extractor — TypeScript compiler API (direct `typescript` dep). Uses
// ts.createSourceFile per file (no Program / no type-checker): the fast,
// deterministic, offline structural pass. Covers .ts/.tsx/.js/.jsx/.mjs/.cjs.
// Emits the `{path,dotted,imports,defines,calls,exports}` contract
// graph-build.mjs's buildEntities() consumes.
//
// Both module systems are read: ESM import/export declarations AND a CommonJS
// pass (top-level CJS require calls with literal specifiers → imports;
// module.exports / exports.name assignments → exports) — CJS-only repos were
// producing edge-empty graphs before the CJS pass existed.
//
// Fidelity note: params/returns are ANNOTATION strings (Group-A mechanical), not
// resolved types — the same honesty the Python path keeps ("returns = annotation
// only"). A type-RESOLVED pass (real Program + checker) is a research horizon,
// not run here.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ts from "typescript";
import { walk, relPath } from "./walk.mjs";

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const stripExt = (p) => p.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");

function scriptKind(path) {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.ts$/i.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const endLineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

/** "(a: string, b = 3)" → "a: string, b = 3" (annotation strings; not resolved). */
function paramsText(sf, node) {
  const ps = node.parameters || [];
  return ps.map((p) => p.getText(sf).replace(/\s+/g, " ").trim()).join(", ").slice(0, 160);
}
function returnText(sf, node) {
  return node.type ? node.type.getText(sf).replace(/\s+/g, " ").trim().slice(0, 80) : "";
}
function firstDocLine(sf, node) {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) || [];
  for (const r of ranges) {
    const raw = sf.text.slice(r.pos, r.end);
    const m = raw.replace(/^\/\*\*?|\*\/$/g, "").split("\n").map((l) => l.replace(/^\s*\*?\s?/, "").trim()).find(Boolean);
    if (m) return m.slice(0, 120);
  }
  return "";
}
const hasMod = (node, kind) => (node.modifiers || []).some((m) => m.kind === kind);
function visibilityOf(node) {
  if (hasMod(node, ts.SyntaxKind.PrivateKeyword)) return "private";
  if (hasMod(node, ts.SyntaxKind.ProtectedKeyword)) return "protected";
  return "";
}
function decoratorsOf(sf, node) {
  const ds = ts.canHaveDecorators?.(node) ? ts.getDecorators?.(node) : null;
  return (ds || []).map((d) => d.expression.getText(sf).replace(/\s+/g, " ").slice(0, 80));
}

/** Collect callee names within a node body (coarse; unparsed call target). */
function callsIn(sf, node) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const t = n.expression;
      let name = "";
      if (ts.isIdentifier(t)) name = t.text;
      else if (ts.isPropertyAccessExpression(t)) name = t.getText(sf);
      if (name) out.add(name.slice(0, 80));
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return [...out].sort();
}

export async function extractFile(absPath, root) {
  const text = await readFile(absPath, "utf8").catch(() => null);
  if (text == null) return { failed: true, path: relPath(root, absPath) };
  const path = relPath(root, absPath);
  let sf;
  try {
    sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  } catch {
    return { failed: true, path };
  }
  const dir = dirname(path);
  const imports = new Set();
  const calls = new Set();
  const defines = [];
  const exports = new Set();

  const resolveSpecifier = (spec) => {
    if (!spec || !spec.startsWith(".")) { if (spec) imports.add(spec); return; } // bare/external
    const joined = join(dir, spec).split(/[\\/]/).join("/");
    const base = stripExt(joined);
    imports.add(base);
    imports.add(`${base}/index`); // dir-import fallback (./foo → ./foo/index)
  };

  // CommonJS pass: CJS require / module.exports repos were leaving graphs
  // edge-empty. Top-level statements only, STRICTLY literal arguments — a
  // computed specifier is skipped, never guessed (the house "no wrong edge" rule).
  /** A CJS require call with a single literal arg → its specifier, else null. */
  const requireSpecifier = (node) =>
    node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" &&
    node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
      ? node.arguments[0].text
      : null;
  /** Peel a `.member` access / parens down to the require call (never enters functions). */
  const requireIn = (expr) => {
    let e = expr;
    while (e && (ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression?.(e))) e = e.expression;
    return requireSpecifier(e);
  };
  const isModuleExports = (e) =>
    ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "module" && e.name.text === "exports";
  const isExportsRef = (e) => isModuleExports(e) || (ts.isIdentifier(e) && e.text === "exports");

  const addFn = (name, node, kind, extra = {}) => {
    defines.push({
      name, kind, lineno: lineOf(sf, node), end_lineno: endLineOf(sf, node),
      decorators: decoratorsOf(sf, node),
      params: paramsText(sf, node), returns: returnText(sf, node),
      calls: callsIn(sf, node), doc: firstDocLine(sf, node),
      ...(visibilityOf(node) ? { visibility: visibilityOf(node) } : {}),
      ...extra,
    });
  };

  for (const stmt of sf.statements) {
    // imports / re-exports
    if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      resolveSpecifier(stmt.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      resolveSpecifier(stmt.moduleSpecifier.text);
    }
    const exported = hasMod(stmt, ts.SyntaxKind.ExportKeyword);

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      addFn(stmt.name.text, stmt, "function");
      if (exported) exports.add(stmt.name.text);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      const cname = stmt.name.text;
      const bases = [];
      for (const h of stmt.heritageClauses || []) for (const t of h.types) bases.push(t.getText(sf).slice(0, 80));
      defines.push({
        name: cname, kind: "class", lineno: lineOf(sf, stmt), end_lineno: endLineOf(sf, stmt),
        bases, decorators: decoratorsOf(sf, stmt), doc: firstDocLine(sf, stmt),
      });
      if (exported) exports.add(cname);
      for (const mem of stmt.members) {
        if (ts.isMethodDeclaration(mem) || ts.isConstructorDeclaration(mem) ||
            ts.isGetAccessor(mem) || ts.isSetAccessor(mem)) {
          const mn = mem.name ? mem.name.getText(sf) : "constructor";
          addFn(`${cname}.${mn}`, mem, "method");
        } else if (ts.isPropertyDeclaration(mem) && mem.name) {
          defines.push({
            name: `${cname}.${mem.name.getText(sf)}`, kind: "attribute",
            lineno: lineOf(sf, mem), end_lineno: endLineOf(sf, mem), decorators: decoratorsOf(sf, mem),
          });
        }
      }
    } else if (ts.isInterfaceDeclaration(stmt) && stmt.name) {
      // interfaces map to Class nodes (type surface) — useful for TS-heavy repos
      defines.push({
        name: stmt.name.text, kind: "class", subkind: "interface",
        lineno: lineOf(sf, stmt), end_lineno: endLineOf(sf, stmt),
        bases: (stmt.heritageClauses || []).flatMap((h) => h.types.map((t) => t.getText(sf).slice(0, 80))),
        decorators: [], doc: firstDocLine(sf, stmt),
      });
      if (exported) exports.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of stmt.declarationList.declarations) {
        // CJS import: const X = <require 'spec'> / const {a} = <require 'spec'> /
        // const Y = <require 'spec'>.member — BEFORE the identifier-only gate so a
        // destructuring binding still records the import edge.
        const reqSpec = requireIn(d.initializer);
        if (reqSpec != null) resolveSpecifier(reqSpec);
        if (!ts.isIdentifier(d.name)) continue;
        const vn = d.name.text;
        const init = d.initializer;
        // arrow/function assigned to a const → treat as a function define
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          addFn(vn, init, "function");
        } else if (isConst && /^[A-Z0-9_]+$/.test(vn)) {
          defines.push({ name: vn, kind: "global", lineno: lineOf(sf, stmt), end_lineno: endLineOf(sf, stmt),
            decorators: [], value: (init ? init.getText(sf) : "").replace(/\s+/g, " ").slice(0, 80), is_constant: true });
        } else if (init && ts.isCallExpression(init)) {
          // live-object global (e.g. const router = Router()) — a registration anchor
          defines.push({ name: vn, kind: "global", lineno: lineOf(sf, stmt), end_lineno: endLineOf(sf, stmt),
            decorators: [], value: init.getText(sf).replace(/\s+/g, " ").slice(0, 80) });
        }
        if (exported) exports.add(vn);
      }
    } else if (ts.isExportAssignment?.(stmt)) {
      exports.add("default");
    } else if (ts.isExpressionStatement(stmt)) {
      // CJS exports + side-effect/re-export requires. Walk `=` chains so
      // `exports = module.exports = X` records one default export, and
      // `module.exports = <require './lib'>` records both the export and the import.
      let expr = stmt.expression;
      while (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const lhs = expr.left;
        if (isExportsRef(lhs)) exports.add("default");
        else if (ts.isPropertyAccessExpression(lhs) && isExportsRef(lhs.expression)) {
          exports.add(lhs.name.text);
        }
        expr = expr.right;
      }
      const reqSpec = requireIn(expr); // covers a bare side-effect require too
      if (reqSpec != null) resolveSpecifier(reqSpec);
    }
  }

  // module-level coarse calls (whole file)
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const t = n.expression;
      let name = "";
      if (ts.isIdentifier(t)) name = t.text;
      else if (ts.isPropertyAccessExpression(t)) name = t.getText(sf);
      if (name) calls.add(name.slice(0, 80));
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);

  return {
    path, dotted: stripExt(path),
    imports: [...imports].sort(), defines, calls: [...calls].sort(), exports: [...exports].sort(),
  };
}

/** Ingest a whole tree → {modules, failures, fileCount} contract. */
export async function ingest(root, { ignore = null } = {}) {
  const files = await walk(root, EXTS, ignore);
  const modules = [];
  const failures = [];
  for (const f of files) {
    const mod = await extractFile(f, root);
    if (mod.failed) failures.push(mod.path);
    else modules.push(mod);
  }
  return { modules, failures, fileCount: files.length };
}

export const meta = { id: "tsc", language: "js/ts", lib: "typescript compiler API", exts: EXTS };
