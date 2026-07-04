// Roslyn (syntax-level) C# extractor — bake-off candidate + picked C# path.
// Parses each .cs with CSharpSyntaxTree.ParseText (NO compilation / no nuget
// restore of the target repo) → deterministic, offline, zero-LLM. Emits the SAME
// {modules:[{path,dotted,imports,defines,calls,exports}]} contract the Python
// extract_ast.py prints, so seonix's extract.mjs/codegraph.mjs/digest consume it
// unchanged. Semantic-model promotion (resolved call targets/types, Group-B->A) is
// the documented ceiling, NOT done here (syntax-level keeps it project-agnostic).
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var skipDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    ".git",".seonix",".hg",".svn","node_modules","bin","obj","out","dist","build","packages","TestResults",".vs"
};

if (args.Length < 1) { Console.Error.WriteLine("usage: roslyn-extract <root>"); return 2; }
var root = Path.GetFullPath(args[0]);

var files = new List<string>();
void Walk(string dir) {
    string[] entries;
    try { entries = Directory.GetFileSystemEntries(dir); } catch { return; }
    Array.Sort(entries, StringComparer.Ordinal);
    foreach (var e in entries) {
        var name = Path.GetFileName(e);
        if (Directory.Exists(e)) {
            if (skipDirs.Contains(name) || name.StartsWith(".")) continue;
            Walk(e);
        } else if (name.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)
                   && !name.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase)
                   && !name.EndsWith(".Designer.cs", StringComparison.OrdinalIgnoreCase)
                   && !name.EndsWith(".AssemblyInfo.cs", StringComparison.OrdinalIgnoreCase)) {
            files.Add(e);
        }
    }
}
Walk(root);

string Rel(string abs) => Path.GetRelativePath(root, abs).Replace('\\', '/');
int LineOf(SyntaxNode n) => n.GetLocation().GetLineSpan().StartLinePosition.Line + 1;
int EndLineOf(SyntaxNode n) => n.GetLocation().GetLineSpan().EndLinePosition.Line + 1;
string Clip(string s, int n) => s.Length <= n ? s : s.Substring(0, n);
string OneLine(string s) => System.Text.RegularExpressions.Regex.Replace(s ?? "", "\\s+", " ").Trim();

List<string> CallsIn(SyntaxNode body) {
    var set = new SortedSet<string>(StringComparer.Ordinal);
    if (body == null) return new List<string>();
    foreach (var inv in body.DescendantNodes().OfType<InvocationExpressionSyntax>()) {
        var expr = inv.Expression;
        string name = expr switch {
            MemberAccessExpressionSyntax ma => ma.ToString(),
            IdentifierNameSyntax id => id.Identifier.Text,
            _ => expr.ToString()
        };
        name = OneLine(name);
        if (name.Length > 0) set.Add(Clip(name, 80));
    }
    // Object creations count as call edges to the created type: `new X(...)` → "X".
    // Always the BARE type identifier (generics/qualifiers stripped) so extract.mjs's
    // unique-lastIdent registry can resolve it to the internal Class. Implicit
    // `new(...)` (no type syntax) is a different node type and stays excluded.
    foreach (var oc in body.DescendantNodes().OfType<ObjectCreationExpressionSyntax>()) {
        var t = oc.Type;
        if (t is QualifiedNameSyntax q) t = q.Right; // rightmost identifier
        string tn = t switch {
            GenericNameSyntax g => g.Identifier.Text,
            IdentifierNameSyntax id => id.Identifier.Text,
            _ => null
        };
        if (!string.IsNullOrEmpty(tn)) set.Add(Clip(tn, 80));
    }
    return set.ToList();
}

string Vis(SyntaxTokenList mods) {
    if (mods.Any(m => m.Text == "private")) return "private";
    if (mods.Any(m => m.Text == "protected")) return "protected";
    return "";
}
bool IsPublic(SyntaxTokenList mods) => mods.Any(m => m.Text == "public");

// Nested types qualify as Outer.Inner (members then inherit it via cname+"."+member).
string QualName(BaseTypeDeclarationSyntax t) {
    var name = t.Identifier.Text;
    for (var p = t.Parent; p is BaseTypeDeclarationSyntax outer; p = p.Parent)
        name = outer.Identifier.Text + "." + name;
    return name;
}

// kind stays "class" for every type declaration; subkind distinguishes the flavour
// (record covers `record struct` too — same syntax node). Plain class → null (omitted).
string SubkindOf(BaseTypeDeclarationSyntax t) => t switch {
    InterfaceDeclarationSyntax => "interface",
    EnumDeclarationSyntax => "enum",
    RecordDeclarationSyntax => "record",
    StructDeclarationSyntax => "struct",
    _ => null
};

// First non-empty line of the XML doc comment (///), tags stripped, clipped to 120
// chars — mirrors the Java extractor's javadoc emission (extract.mjs consumes d.doc).
string DocOf(SyntaxNode n) {
    foreach (var trivia in n.GetLeadingTrivia()) {
        if (trivia.GetStructure() is not DocumentationCommentTriviaSyntax dc) continue;
        var text = System.Text.RegularExpressions.Regex.Replace(dc.ToFullString(), "<[^>]*>", " ");
        foreach (var rawLine in text.Split('\n')) {
            var s = rawLine.Trim().TrimStart('/').Trim();
            if (s.Length > 0) return Clip(s, 120);
        }
    }
    return "";
}

var modules = new List<object>();
var failures = new List<string>();

foreach (var file in files) {
    string text;
    try { text = File.ReadAllText(file); } catch { failures.Add(Rel(file)); continue; }
    SyntaxTree tree;
    try { tree = CSharpSyntaxTree.ParseText(text); }
    catch { failures.Add(Rel(file)); continue; }
    var rootNode = tree.GetRoot();
    if (rootNode.ContainsDiagnostics) { /* Roslyn recovers; extract best-effort */ }

    var imports = new SortedSet<string>(StringComparer.Ordinal);
    foreach (var u in rootNode.DescendantNodes().OfType<UsingDirectiveSyntax>()) {
        if (u.StaticKeyword.Text == "static") continue;
        var nm = u.Name?.ToString();
        if (!string.IsNullOrEmpty(nm)) imports.Add(nm);
    }

    string primaryNs = rootNode.DescendantNodes().OfType<BaseNamespaceDeclarationSyntax>()
        .Select(n => n.Name.ToString()).FirstOrDefault() ?? "";

    var defines = new List<object>();
    var exports = new SortedSet<string>(StringComparer.Ordinal);

    // BaseTypeDeclarationSyntax covers classes/interfaces/structs/records AND enums
    // (TypeDeclarationSyntax alone missed EnumDeclarationSyntax entirely). Document
    // order, so nested types follow their parent — names qualify via QualName.
    foreach (var btd in rootNode.DescendantNodes().OfType<BaseTypeDeclarationSyntax>()) {
        var cname = QualName(btd);
        var bases = btd.BaseList?.Types.Select(t => Clip(OneLine(t.ToString()), 80)).ToList() ?? new List<string>();
        var cdef = new Dictionary<string, object> {
            ["name"] = cname, ["kind"] = "class", ["lineno"] = LineOf(btd), ["end_lineno"] = EndLineOf(btd),
            ["bases"] = bases, ["decorators"] = btd.AttributeLists.SelectMany(a => a.Attributes).Select(a => OneLine(a.ToString())).ToList()
        };
        var subkind = SubkindOf(btd); if (subkind != null) cdef["subkind"] = subkind;
        var cdoc = DocOf(btd); if (cdoc != "") cdef["doc"] = cdoc;
        if (IsPublic(btd.Modifiers)) exports.Add(cname);
        var v = Vis(btd.Modifiers); if (v != "") cdef["visibility"] = v;
        defines.Add(cdef);

        if (btd is EnumDeclarationSyntax en) {
            foreach (var em in en.Members) {
                defines.Add(new Dictionary<string, object> {
                    ["name"] = $"{cname}.{em.Identifier.Text}", ["kind"] = "attribute",
                    ["lineno"] = LineOf(em), ["end_lineno"] = EndLineOf(em), ["decorators"] = new List<string>(),
                    ["is_constant"] = true
                });
            }
            continue;
        }
        if (btd is not TypeDeclarationSyntax type) continue;

        foreach (var mem in type.Members) {
            if (mem is MethodDeclarationSyntax m) {
                var md = new Dictionary<string, object> {
                    ["name"] = $"{cname}.{m.Identifier.Text}", ["kind"] = "method",
                    ["lineno"] = LineOf(m), ["end_lineno"] = EndLineOf(m), ["decorators"] = m.AttributeLists.SelectMany(a => a.Attributes).Select(a => OneLine(a.ToString())).ToList(),
                    ["params"] = Clip(OneLine(string.Join(", ", m.ParameterList.Parameters.Select(p => p.ToString()))), 160),
                    ["returns"] = Clip(OneLine(m.ReturnType.ToString()), 80),
                    ["calls"] = CallsIn(m.Body as SyntaxNode ?? m.ExpressionBody)
                };
                if (m.Modifiers.Any(x => x.Text == "static")) md["is_static"] = true;
                var mv = Vis(m.Modifiers); if (mv != "") md["visibility"] = mv;
                var mdoc = DocOf(m); if (mdoc != "") md["doc"] = mdoc;
                defines.Add(md);
            } else if (mem is ConstructorDeclarationSyntax ctor) {
                var ctd = new Dictionary<string, object> {
                    ["name"] = $"{cname}.{ctor.Identifier.Text}", ["kind"] = "method",
                    ["lineno"] = LineOf(ctor), ["end_lineno"] = EndLineOf(ctor), ["decorators"] = new List<string>(),
                    ["params"] = Clip(OneLine(string.Join(", ", ctor.ParameterList.Parameters.Select(p => p.ToString()))), 160),
                    ["calls"] = CallsIn(ctor.Body as SyntaxNode ?? ctor.ExpressionBody)
                };
                var cdoc2 = DocOf(ctor); if (cdoc2 != "") ctd["doc"] = cdoc2;
                defines.Add(ctd);
            } else if (mem is PropertyDeclarationSyntax prop) {
                var pd = new Dictionary<string, object> {
                    ["name"] = $"{cname}.{prop.Identifier.Text}", ["kind"] = "attribute",
                    ["lineno"] = LineOf(prop), ["end_lineno"] = EndLineOf(prop), ["decorators"] = new List<string>()
                };
                var pdoc = DocOf(prop); if (pdoc != "") pd["doc"] = pdoc;
                defines.Add(pd);
            } else if (mem is FieldDeclarationSyntax fld) {
                foreach (var vd in fld.Declaration.Variables) {
                    defines.Add(new Dictionary<string, object> {
                        ["name"] = $"{cname}.{vd.Identifier.Text}", ["kind"] = "attribute",
                        ["lineno"] = LineOf(fld), ["end_lineno"] = EndLineOf(fld), ["decorators"] = new List<string>()
                    });
                }
            }
        }
    }

    string dotted = primaryNs.Length > 0 ? primaryNs : Rel(file).Replace(".cs", "").Replace('/', '.');
    modules.Add(new Dictionary<string, object> {
        ["path"] = Rel(file), ["dotted"] = dotted, ["imports"] = imports.ToList(),
        ["defines"] = defines, ["calls"] = CallsIn(rootNode), ["exports"] = exports.ToList()
    });
}

var payload = new Dictionary<string, object> { ["modules"] = modules, ["failures"] = failures, ["fileCount"] = files.Count };
var opts = new JsonSerializerOptions { WriteIndented = false };
Console.Out.Write(JsonSerializer.Serialize(payload, opts));
return 0;
