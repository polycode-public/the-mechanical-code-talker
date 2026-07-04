// JavaParser + JavaSymbolSolver (syntax + resolved calls) Java extractor — the
// PICKED Java path for seonix. Parses each .java under <root> with JavaParser and
// a CombinedTypeSolver (ReflectionTypeSolver + JavaParserTypeSolver over the repo)
// so in-repo call targets resolve to fully-qualified names; unresolvable
// (3rd-party) calls degrade gracefully to the syntax-level callee name — never a
// thrown exception. Emits the SAME {modules:[{path,dotted,imports,defines,calls,
// exports}]} contract extract_ast.py prints, so seonix's extract.mjs/codegraph.mjs
// consume it unchanged. Deterministic, offline, zero-LLM (static parsing only).
package co.uk.polycode.seonix;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParseResult;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.ImportDeclaration;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.CallableDeclaration;
import com.github.javaparser.ast.body.ConstructorDeclaration;
import com.github.javaparser.ast.body.EnumConstantDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.FieldDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.Parameter;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.expr.ObjectCreationExpr;
import com.github.javaparser.ast.nodeTypes.NodeWithModifiers;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
import com.github.javaparser.resolution.declarations.ResolvedMethodDeclaration;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.JavaParserTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver;

import java.io.IOException;
import java.io.PrintStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public final class Main {

    private static final Set<String> SKIP_DIRS = Set.of(
        ".git", ".seonix", ".hg", ".svn", "node_modules", ".venv", "venv",
        "__pycache__", ".tox", ".mypy_cache", ".pytest_cache", "build", "dist",
        "bin", "obj", "out", "coverage", "target", ".gradle", ".idea");

    private static final Pattern WS = Pattern.compile("\\s+");

    private Path root;
    private JavaParser parser;

    public static void main(String[] args) throws Exception {
        // Force UTF-8 stdout regardless of the platform default codepage.
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        if (args.length < 1) {
            System.err.println("usage: seonix-java-extract <root>");
            System.exit(2);
            return;
        }
        new Main().run(Paths.get(args[0]).toAbsolutePath().normalize(), out);
    }

    private void run(Path root, PrintStream out) throws IOException {
        this.root = root;

        CombinedTypeSolver typeSolver = new CombinedTypeSolver();
        typeSolver.add(new ReflectionTypeSolver());
        if (Files.isDirectory(root)) {
            typeSolver.add(new JavaParserTypeSolver(root));
        }
        ParserConfiguration config = new ParserConfiguration()
            .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21)
            .setSymbolResolver(new JavaSymbolSolver(typeSolver));
        this.parser = new JavaParser(config);

        List<Path> files = collectFiles(root);

        List<String> moduleJson = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        for (Path file : files) {
            try {
                String json = extractFile(file);
                if (json == null) failures.add(rel(file));
                else moduleJson.add(json);
            } catch (Exception e) {
                // Never let a single file abort the whole ingest.
                failures.add(rel(file));
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("{\"modules\":[").append(String.join(",", moduleJson)).append("],");
        sb.append("\"failures\":[").append(failures.stream().map(Main::jstr).collect(Collectors.joining(","))).append("],");
        sb.append("\"fileCount\":").append(files.size()).append("}");
        out.print(sb);
        out.flush();
    }

    private List<Path> collectFiles(Path dir) {
        List<Path> out = new ArrayList<>();
        walk(dir, out);
        out.sort(Comparator.comparing(Path::toString));
        return out;
    }

    private void walk(Path dir, List<Path> out) {
        java.io.File[] entries = dir.toFile().listFiles();
        if (entries == null) return;
        for (java.io.File e : entries) {
            String name = e.getName();
            if (e.isDirectory()) {
                if (SKIP_DIRS.contains(name) || name.startsWith(".")) continue;
                walk(e.toPath(), out);
            } else if (name.endsWith(".java") && !name.equals("module-info.java") && !name.equals("package-info.java")) {
                out.add(e.toPath());
            }
        }
    }

    private String rel(Path abs) {
        return root.relativize(abs).toString().replace('\\', '/');
    }

    // ---- per-file extraction -------------------------------------------------

    private String extractFile(Path file) {
        String text;
        try { text = Files.readString(file); }
        catch (IOException e) { return null; }

        ParseResult<CompilationUnit> res;
        try { res = parser.parse(text); }
        catch (Exception e) { return null; }
        if (!res.getResult().isPresent()) return null;
        CompilationUnit cu = res.getResult().get();

        String path = rel(file);

        // imports: `import a.b.C;` -> "a.b.C"; `import a.b.*;` -> "a.b"; skip static.
        TreeSet<String> imports = new TreeSet<>();
        for (ImportDeclaration imp : cu.getImports()) {
            if (imp.isStatic()) continue;
            String nm = imp.getNameAsString();
            if (!nm.isEmpty()) imports.add(nm);
        }

        String pkg = cu.getPackageDeclaration().map(p -> p.getNameAsString()).orElse("");

        List<String> defines = new ArrayList<>();
        TreeSet<String> exports = new TreeSet<>();

        for (TypeDeclaration<?> type : cu.findAll(TypeDeclaration.class)) {
            emitType(type, defines, exports);
        }

        String dotted = !pkg.isEmpty()
            ? pkg + "." + path.replaceAll("\\.java$", "").replaceAll(".*/", "")
            : path.replaceAll("\\.java$", "").replace('/', '.');

        List<String> fileCalls = callsIn(cu);

        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"path\":").append(jstr(path)).append(",");
        sb.append("\"dotted\":").append(jstr(dotted)).append(",");
        sb.append("\"imports\":").append(jarr(new ArrayList<>(imports))).append(",");
        sb.append("\"defines\":[").append(String.join(",", defines)).append("],");
        sb.append("\"calls\":").append(jarr(fileCalls)).append(",");
        sb.append("\"exports\":").append(jarr(new ArrayList<>(exports)));
        sb.append("}");
        return sb.toString();
    }

    /** Nested types qualify as Outer.Inner — walk the enclosing TypeDeclarations. */
    private static String qualifiedName(TypeDeclaration<?> type) {
        StringBuilder name = new StringBuilder(type.getNameAsString());
        Node p = type.getParentNode().orElse(null);
        while (p != null) {
            if (p instanceof TypeDeclaration<?> outer) {
                name.insert(0, outer.getNameAsString() + ".");
            }
            p = p.getParentNode().orElse(null);
        }
        return name.toString();
    }

    /** kind stays "class" for every type declaration; subkind marks the flavour
     *  (interface/enum/record); a plain class gets none (field omitted). */
    private static String subkindOf(TypeDeclaration<?> type) {
        if (type instanceof ClassOrInterfaceDeclaration c && c.isInterface()) return "interface";
        if (type instanceof EnumDeclaration) return "enum";
        if (type instanceof RecordDeclaration) return "record";
        return null;
    }

    private void emitType(TypeDeclaration<?> type, List<String> defines, TreeSet<String> exports) {
        String cname = qualifiedName(type);

        List<String> bases = new ArrayList<>();
        if (type instanceof ClassOrInterfaceDeclaration c) {
            for (ClassOrInterfaceType t : c.getExtendedTypes()) bases.add(oneLine(t.toString()));
            for (ClassOrInterfaceType t : c.getImplementedTypes()) bases.add(oneLine(t.toString()));
        } else if (type instanceof EnumDeclaration en) {
            for (ClassOrInterfaceType t : en.getImplementedTypes()) bases.add(oneLine(t.toString()));
        } else if (type instanceof RecordDeclaration rec) {
            for (ClassOrInterfaceType t : rec.getImplementedTypes()) bases.add(oneLine(t.toString()));
        }

        List<String> decorators = annotations(type);
        String vis = visibility(type);

        StringBuilder cd = new StringBuilder();
        cd.append("{");
        cd.append("\"name\":").append(jstr(cname)).append(",");
        cd.append("\"kind\":\"class\",");
        String subkind = subkindOf(type);
        if (subkind != null) cd.append("\"subkind\":").append(jstr(subkind)).append(",");
        cd.append("\"lineno\":").append(lineOf(type)).append(",");
        cd.append("\"end_lineno\":").append(endLineOf(type)).append(",");
        cd.append("\"bases\":").append(jarr(bases)).append(",");
        cd.append("\"decorators\":").append(jarr(decorators));
        String doc = javadoc(type);
        if (!doc.isEmpty()) cd.append(",\"doc\":").append(jstr(doc));
        if (!vis.isEmpty()) cd.append(",\"visibility\":").append(jstr(vis));
        cd.append("}");
        defines.add(cd.toString());
        if (isPublic(type)) exports.add(cname);

        // methods
        for (MethodDeclaration m : type.getMethods()) {
            emitCallable(cname, m.getNameAsString(), m, defines,
                clip(oneLine(m.getType().toString()), 80));
        }
        // constructors
        for (ConstructorDeclaration ctor : type.getConstructors()) {
            emitCallable(cname, ctor.getNameAsString(), ctor, defines, "");
        }
        // record compact-canonical params behave like fields — surface them too
        if (type instanceof RecordDeclaration rec) {
            for (Parameter p : rec.getParameters()) {
                StringBuilder fd = new StringBuilder();
                fd.append("{\"name\":").append(jstr(cname + "." + p.getNameAsString())).append(",");
                fd.append("\"kind\":\"attribute\",");
                fd.append("\"lineno\":").append(lineOf(p)).append(",");
                fd.append("\"end_lineno\":").append(endLineOf(p)).append(",");
                fd.append("\"decorators\":[]}");
                defines.add(fd.toString());
            }
        }
        // enum constants -> attribute with is_constant (getFields() misses them)
        if (type instanceof EnumDeclaration en) {
            for (EnumConstantDeclaration ec : en.getEntries()) {
                StringBuilder fd = new StringBuilder();
                fd.append("{\"name\":").append(jstr(cname + "." + ec.getNameAsString())).append(",");
                fd.append("\"kind\":\"attribute\",");
                fd.append("\"lineno\":").append(lineOf(ec)).append(",");
                fd.append("\"end_lineno\":").append(endLineOf(ec)).append(",");
                fd.append("\"decorators\":").append(jarr(annotations(ec))).append(",");
                fd.append("\"is_constant\":true}");
                defines.add(fd.toString());
            }
        }
        // fields -> attribute (static final ALL-CAPS -> constant)
        for (FieldDeclaration fld : type.getFields()) {
            boolean constant = fld.isStatic() && fld.isFinal();
            for (VariableDeclarator vd : fld.getVariables()) {
                StringBuilder fd = new StringBuilder();
                fd.append("{\"name\":").append(jstr(cname + "." + vd.getNameAsString())).append(",");
                fd.append("\"kind\":\"attribute\",");
                fd.append("\"lineno\":").append(lineOf(fld)).append(",");
                fd.append("\"end_lineno\":").append(endLineOf(fld)).append(",");
                fd.append("\"decorators\":").append(jarr(annotations(fld)));
                String v = visibility(fld);
                if (!v.isEmpty()) fd.append(",\"visibility\":").append(jstr(v));
                if (constant) {
                    fd.append(",\"is_constant\":true");
                    fd.append(",\"value\":").append(jstr(clip(vd.getInitializer().map(Object::toString).map(Main::oneLine).orElse(""), 80)));
                }
                fd.append("}");
                defines.add(fd.toString());
            }
        }
    }

    private void emitCallable(String cname, String simple, CallableDeclaration<?> node,
                              List<String> defines, String returns) {
        String params = node.getParameters().stream()
            .map(p -> oneLine(p.getType().toString() + " " + p.getNameAsString()))
            .collect(Collectors.joining(", "));
        String vis = visibility(node);
        StringBuilder md = new StringBuilder();
        md.append("{\"name\":").append(jstr(cname + "." + simple)).append(",");
        md.append("\"kind\":\"method\",");
        md.append("\"lineno\":").append(lineOf(node)).append(",");
        md.append("\"end_lineno\":").append(endLineOf(node)).append(",");
        md.append("\"decorators\":").append(jarr(annotations(node))).append(",");
        md.append("\"params\":").append(jstr(clip(params, 160))).append(",");
        if (!returns.isEmpty()) md.append("\"returns\":").append(jstr(returns)).append(",");
        md.append("\"calls\":").append(jarr(callsIn(node)));
        if (node.isStatic()) md.append(",\"is_static\":true");
        if (!vis.isEmpty()) md.append(",\"visibility\":").append(jstr(vis));
        String doc = javadoc(node);
        if (!doc.isEmpty()) md.append(",\"doc\":").append(jstr(doc));
        md.append("}");
        defines.add(md.toString());
    }

    // ---- resolution ----------------------------------------------------------

    /** Callee names within a node. Resolved in-repo/JDK targets become fully
     *  qualified (declaringType.method); unresolvable ones degrade to the plain
     *  syntax-level name. Sorted + de-duplicated for determinism. */
    private List<String> callsIn(Node node) {
        TreeSet<String> set = new TreeSet<>();
        for (MethodCallExpr call : node.findAll(MethodCallExpr.class)) {
            String name = null;
            try {
                ResolvedMethodDeclaration rmd = call.resolve();
                name = rmd.declaringType().getQualifiedName() + "." + rmd.getName();
            } catch (Throwable t) {
                // UnsolvedSymbolException & friends -> syntax-level fallback.
                name = call.getNameAsString();
            }
            if (name != null && !name.isEmpty()) set.add(clip(oneLine(name), 80));
        }
        // Object creations count as call edges to the created type: `new X(...)` → the
        // resolved declaring type's qualified name, else the plain syntax-level type
        // name (bare identifier — generics live outside getNameAsString). Never throws.
        for (ObjectCreationExpr oc : node.findAll(ObjectCreationExpr.class)) {
            String name = null;
            try {
                name = oc.resolve().declaringType().getQualifiedName();
            } catch (Throwable t) {
                try { name = oc.getType().getNameAsString(); } catch (Throwable t2) { name = null; }
            }
            if (name != null && !name.isEmpty()) set.add(clip(oneLine(name), 80));
        }
        return new ArrayList<>(set);
    }

    // ---- helpers -------------------------------------------------------------

    private static List<String> annotations(Node node) {
        List<String> out = new ArrayList<>();
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithAnnotations<?> na) {
            for (AnnotationExpr a : na.getAnnotations()) out.add(clip(oneLine(a.toString()), 80));
        }
        return out;
    }

    private static String visibility(Node node) {
        if (node instanceof NodeWithModifiers<?> nm) {
            String mods = nm.getModifiers().stream()
                .map(m -> m.getKeyword().asString()).collect(Collectors.joining(" "));
            if (mods.contains("private")) return "private";
            if (mods.contains("protected")) return "protected";
        }
        return "";
    }

    private static boolean isPublic(Node node) {
        if (node instanceof NodeWithModifiers<?> nm) {
            return nm.getModifiers().stream().anyMatch(m -> m.getKeyword().asString().equals("public"));
        }
        return false;
    }

    private static String javadoc(Node node) {
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithJavadoc<?> nj) {
            Optional<com.github.javaparser.javadoc.Javadoc> jd = nj.getJavadoc();
            if (jd.isPresent()) {
                String desc = jd.get().getDescription().toText().trim();
                for (String linePart : desc.split("\n")) {
                    String s = linePart.trim();
                    if (!s.isEmpty()) return clip(s, 120);
                }
            }
        }
        return "";
    }

    private static int lineOf(Node n) { return n.getBegin().map(p -> p.line).orElse(0); }
    private static int endLineOf(Node n) { return n.getEnd().map(p -> p.line).orElse(0); }

    private static String oneLine(String s) { return s == null ? "" : WS.matcher(s).replaceAll(" ").trim(); }
    private static String clip(String s, int n) { return s.length() <= n ? s : s.substring(0, n); }

    // ---- minimal JSON writer -------------------------------------------------

    private static String jarr(List<String> items) {
        return "[" + items.stream().map(Main::jstr).collect(Collectors.joining(",")) + "]";
    }

    private static String jstr(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder(s.length() + 2);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        b.append('"');
        return b.toString();
    }
}
