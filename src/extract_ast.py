#!/usr/bin/env python3
"""Deterministic, offline static extraction for seonix (Python).

Stdlib `ast` only — no third-party parser, no model calls. Walks every *.py file
under repo_path and emits ONE JSON document on stdout:

    {"modules": [
        {"path": "<repo-relative>", "dotted": "django.utils.text",
         "imports": ["django.utils.functional", ...],   # candidate dotted targets
         "defines": [{"name": "slugify", "kind": "function", "lineno": 12,
                      "decorators": ["register.filter(is_safe=True)"]},
                     {"name": "Truncator", "kind": "class", "bases": ["object"], ...},
                     {"name": "Truncator.chars", "kind": "method", ...},
                     {"name": "Truncator.text", "kind": "attribute", ...}, ...],
         "calls": ["str.strip", "re.sub", ...]},          # coarse callee names
        ...
    ]}

Resolution of import candidates and call targets to internal modules happens in
extract.mjs against the registry of discovered modules — this script stays a pure
per-file parser. Run: python3 extract_ast.py <repo_path>.
"""

import ast
import json
import os
import sys

SKIP_DIRS = {".git", ".seonix", ".hg", ".svn", "node_modules", ".venv", "venv",
             "__pycache__", ".tox", ".mypy_cache", ".pytest_cache", "build", "dist"}


def dotted_for(rel_path):
    """Repo-relative .py path -> dotted module + its package."""
    parts = rel_path[:-3].split(os.sep)  # drop ".py"
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
        pkg = ".".join(parts)
        return pkg, pkg  # a package: dotted == its own package
    dotted = ".".join(parts)
    pkg = ".".join(parts[:-1])
    return dotted, pkg


def import_targets(node, pkg):
    """Candidate dotted module targets for one Import/ImportFrom node."""
    out = []
    if isinstance(node, ast.Import):
        for alias in node.names:
            out.append(alias.name)  # import a.b.c -> "a.b.c"
    elif isinstance(node, ast.ImportFrom):
        if node.level:  # relative: from . / from .mod import x
            base_parts = pkg.split(".") if pkg else []
            base_parts = base_parts[: len(base_parts) - (node.level - 1)] if node.level > 1 else base_parts
            base = ".".join(base_parts)
            mod = f"{base}.{node.module}" if node.module else base
        else:
            mod = node.module or ""
        if mod:
            out.append(mod)
            # `from a.b import c` may import submodule a.b.c — record as a candidate too.
            for alias in node.names:
                if alias.name and alias.name != "*":
                    out.append(f"{mod}.{alias.name}")
    return out


def decorator_str(dec):
    try:
        return ast.unparse(dec)
    except Exception:
        return ""


def names_in_target(tgt):
    """Plain-name assignment targets (Name, or Name elements of a Tuple/List)."""
    if isinstance(tgt, ast.Name):
        return [tgt.id]
    if isinstance(tgt, (ast.Tuple, ast.List)):
        out = []
        for el in tgt.elts:
            out.extend(names_in_target(el))
        return out
    return []


# --- mechanical enrichments (deterministic ast facts; no type inference) ----------
# Per PLAN_SEONIX_TUNING.md §5: params, return annotation, raises/catches, self-field
# access, static/abstract/visibility flags, and the first docstring line. All are
# free from `ast` alone; everything here stays honest (e.g. raises are the literal
# `raise` targets, not a resolved type).

def _unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def _exc_name(node):
    """The named type of a raised/caught exception expression (drop the call args)."""
    if isinstance(node, ast.Call):
        node = node.func
    return _unparse(node)


def raised_excs(fn):
    out = []
    for n in ast.walk(fn):
        if isinstance(n, ast.Raise) and n.exc is not None:
            nm = _exc_name(n.exc)
            if nm:
                out.append(nm)
    return sorted(set(out))


def caught_excs(fn):
    out = []
    for n in ast.walk(fn):
        if isinstance(n, ast.ExceptHandler) and n.type is not None:
            t = n.type
            elts = t.elts if isinstance(t, (ast.Tuple, ast.List)) else [t]
            for el in elts:
                nm = _exc_name(el)
                if nm:
                    out.append(nm)
    return sorted(set(out))


def self_field_names(fn):
    """`self.x` attribute names touched in a method body (read or write)."""
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "self":
            out.add(n.attr)
    return sorted(out)


def calls_in(fn):
    """Coarse callee names invoked WITHIN one function/method body (for the
    symbol-granular call graph). Names are the unparsed call target (e.g.
    'helper', 'self.foo', 're.sub'); resolution to a single in-repo symbol id —
    and the unique-name discipline — happens in extract.mjs. Reuses the existing
    per-function ast walk (no extra parse pass)."""
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            try:
                nm = ast.unparse(n.func)
            except Exception:
                nm = ""
            if nm:
                out.add(nm)
    return sorted(out)


def first_doc_line(node):
    try:
        d = ast.get_docstring(node, clean=True)
    except Exception:
        d = None
    if not d:
        return ""
    return d.strip().split("\n", 1)[0].strip()[:120]


def visibility_of(name):
    short = name.rsplit(".", 1)[-1]
    if short.startswith("__") and not short.endswith("__"):
        return "private"
    if short.startswith("_") and not short.startswith("__"):
        return "protected"
    return ""  # public is the default — omitted to keep the graph lean


def func_extras(node, name, decorators, is_method):
    """Compact, only-when-present enrichment dict for a function/method define."""
    extras = {}
    sig = _unparse(node.args)
    if sig:
        extras["params"] = sig[:160]
    if getattr(node, "returns", None) is not None:
        r = _unparse(node.returns)
        if r:
            extras["returns"] = r[:80]
    raises = raised_excs(node)
    if raises:
        extras["raises"] = raises[:12]
    catches = caught_excs(node)
    if catches:
        extras["catches"] = catches[:12]
    if is_method:
        fields = self_field_names(node)
        if fields:
            extras["self_fields"] = fields[:24]
    # per-function callee names — the raw material for the symbol-granular
    # mgx:callsSymbol edge (caller fn → callee fn). Collected here so the subject
    # (the enclosing def) is known; extract.mjs resolves names to symbol ids.
    callees = calls_in(node)
    if callees:
        extras["calls"] = callees[:50]
    decset = " ".join(decorators)
    if "staticmethod" in decset or "classmethod" in decset:
        extras["is_static"] = True
    if "abstractmethod" in decset or "abstractproperty" in decset:
        extras["is_abstract"] = True
    vis = visibility_of(name)
    if vis:
        extras["visibility"] = vis
    doc = first_doc_line(node)
    if doc:
        extras["doc"] = doc
    return extras


def parse_module(src, rel_path):
    dotted, pkg = dotted_for(rel_path)
    try:
        tree = ast.parse(src, filename=rel_path)
    except (SyntaxError, ValueError):
        return None  # skip unparseable files (py2 fixtures, templates, etc.)

    imports = []
    defines = []
    calls = set()
    globals_seen = set()
    exports = []  # names in a literal __all__ (the module's declared public surface)

    def string_list(v):
        # names from a literal list/tuple of string constants (else [])
        if not isinstance(v, (ast.List, ast.Tuple)):
            return []
        out = []
        for el in v.elts:
            if isinstance(el, ast.Constant) and isinstance(el.value, str):
                out.append(el.value)
            elif isinstance(el, ast.Str):  # py<3.8 fallback
                out.append(el.s)
        return out

    def end_of(n):
        return getattr(n, "end_lineno", None) or n.lineno

    def short_value(v):
        try:
            s = ast.unparse(v)
        except Exception:
            return ""
        return s.replace("\n", " ")[:80]

    def add_global(name, target_node, value_node):
        # Module-level "live object" globals (RHS is a call, e.g. register =
        # template.Library()) and ALL-CAPS constants — the registration anchors and
        # config values a sibling-adding task must replicate. Skip noisy locals.
        if name in globals_seen or value_node is None:
            return
        is_call = isinstance(value_node, ast.Call)
        if not (is_call or name.isupper()):
            return
        globals_seen.add(name)
        rec = {"name": name, "kind": "global", "lineno": target_node.lineno,
               "end_lineno": end_of(target_node), "decorators": [],
               "value": short_value(value_node)}
        if name.isupper():
            rec["is_constant"] = True
        vis = visibility_of(name)
        if vis:
            rec["visibility"] = vis
        defines.append(rec)

    # Top-level defs/classes, plus one level of class methods (e.g. Truncator.chars).
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            decs = [decorator_str(d) for d in node.decorator_list]
            defines.append({"name": node.name, "kind": "function", "lineno": node.lineno,
                            "end_lineno": end_of(node), "decorators": decs,
                            **func_extras(node, node.name, decs, is_method=False)})
        elif isinstance(node, ast.ClassDef):
            cdoc = first_doc_line(node)
            cvis = visibility_of(node.name)
            cls_extra = {}
            if cdoc:
                cls_extra["doc"] = cdoc
            if cvis:
                cls_extra["visibility"] = cvis
            defines.append({"name": node.name, "kind": "class", "lineno": node.lineno,
                            "end_lineno": end_of(node),
                            "bases": [decorator_str(b) for b in node.bases],
                            "decorators": [decorator_str(d) for d in node.decorator_list],
                            **cls_extra})
            seen_attrs = set()
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    mdecs = [decorator_str(d) for d in sub.decorator_list]
                    defines.append({"name": f"{node.name}.{sub.name}", "kind": "method",
                                    "lineno": sub.lineno, "end_lineno": end_of(sub),
                                    "decorators": mdecs,
                                    **func_extras(sub, f"{node.name}.{sub.name}", mdecs, is_method=True)})
                elif isinstance(sub, ast.AnnAssign) and isinstance(sub.target, ast.Name):
                    if sub.target.id not in seen_attrs:
                        seen_attrs.add(sub.target.id)
                        defines.append({"name": f"{node.name}.{sub.target.id}", "kind": "attribute",
                                        "lineno": sub.lineno, "end_lineno": end_of(sub), "decorators": []})
                elif isinstance(sub, ast.Assign):
                    for tgt in sub.targets:
                        for nm in names_in_target(tgt):
                            if nm in seen_attrs:
                                continue
                            seen_attrs.add(nm)
                            defines.append({"name": f"{node.name}.{nm}", "kind": "attribute",
                                            "lineno": sub.lineno, "end_lineno": end_of(sub), "decorators": []})
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "__all__" and node.value is not None:
                exports = string_list(node.value)
            else:
                add_global(node.target.id, node, node.value)
        elif isinstance(node, ast.Assign):
            if any(isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
                exports = string_list(node.value)
            else:
                for tgt in node.targets:
                    for nm in names_in_target(tgt):
                        add_global(nm, node, node.value)

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imports.extend(import_targets(node, pkg))
        elif isinstance(node, ast.Call):
            try:
                name = ast.unparse(node.func)
            except Exception:
                name = ""
            if name:
                calls.add(name)

    return {"path": rel_path.replace(os.sep, "/"), "dotted": dotted,
            "imports": sorted(set(imports)), "defines": defines, "calls": sorted(calls),
            "exports": exports}


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: extract_ast.py <repo_path>\n")
        sys.exit(2)
    root = os.path.abspath(sys.argv[1])
    modules = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            abs_path = os.path.join(dirpath, fn)
            rel_path = os.path.relpath(abs_path, root)
            try:
                with open(abs_path, "r", encoding="utf-8") as fh:
                    src = fh.read()
            except (OSError, UnicodeDecodeError):
                continue
            mod = parse_module(src, rel_path)
            if mod:
                modules.append(mod)
    json.dump({"modules": modules}, sys.stdout)


if __name__ == "__main__":
    main()
