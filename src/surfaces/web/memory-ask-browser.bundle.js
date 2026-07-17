(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node-stub:node:path
  var unavailable, createRequire, readFileSync, readFile, writeFile, appendFile, mkdir, mkdtemp, rename, unlink, rm, stat, copyFile, readdir, createReadStream, createWriteStream, join, dirname, resolve, sep, randomBytes, spawnSync, createInterface;
  var init_node_path = __esm({
    "node-stub:node:path"() {
      unavailable = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire = unavailable("createRequire");
      readFileSync = unavailable("readFileSync");
      readFile = unavailable("readFile");
      writeFile = unavailable("writeFile");
      appendFile = unavailable("appendFile");
      mkdir = unavailable("mkdir");
      mkdtemp = unavailable("mkdtemp");
      rename = unavailable("rename");
      unlink = unavailable("unlink");
      rm = unavailable("rm");
      stat = unavailable("stat");
      copyFile = unavailable("copyFile");
      readdir = unavailable("readdir");
      createReadStream = unavailable("createReadStream");
      createWriteStream = unavailable("createWriteStream");
      join = (...a) => a.join("/");
      dirname = (p) => String(p).replace(/\/[^/]*$/, "");
      resolve = (...a) => a.join("/");
      sep = "/";
      randomBytes = unavailable("randomBytes");
      spawnSync = unavailable("spawnSync");
      createInterface = unavailable("createInterface");
    }
  });

  // node-stub:node:fs/promises
  var unavailable2, createRequire2, readFileSync2, readFile2, writeFile2, appendFile2, mkdir2, mkdtemp2, rename2, unlink2, rm2, stat2, copyFile2, readdir2, createReadStream2, createWriteStream2, randomBytes2, spawnSync2, createInterface2;
  var init_promises = __esm({
    "node-stub:node:fs/promises"() {
      unavailable2 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire2 = unavailable2("createRequire");
      readFileSync2 = unavailable2("readFileSync");
      readFile2 = unavailable2("readFile");
      writeFile2 = unavailable2("writeFile");
      appendFile2 = unavailable2("appendFile");
      mkdir2 = unavailable2("mkdir");
      mkdtemp2 = unavailable2("mkdtemp");
      rename2 = unavailable2("rename");
      unlink2 = unavailable2("unlink");
      rm2 = unavailable2("rm");
      stat2 = unavailable2("stat");
      copyFile2 = unavailable2("copyFile");
      readdir2 = unavailable2("readdir");
      createReadStream2 = unavailable2("createReadStream");
      createWriteStream2 = unavailable2("createWriteStream");
      randomBytes2 = unavailable2("randomBytes");
      spawnSync2 = unavailable2("spawnSync");
      createInterface2 = unavailable2("createInterface");
    }
  });

  // src/domain/ask-vocab.mjs
  function stripTrailingScopeFiller(text) {
    return text.replace(TRAILING_SCOPE_FILLER_RE, "").trim();
  }
  function stripTrailingDiscourseTag(text) {
    let out = text;
    for (let pass = 0; pass < 2; pass += 1) {
      let next = out.replace(TRAILING_DISCOURSE_TAG_RE, "").trim();
      next = next.replace(TRAILING_DISCOURSE_CLAUSE_RE, "").trim();
      if (next === out) break;
      out = next;
    }
    return out;
  }
  var INHERITS_REVERSE_VERB_LIST, RELATIONS, INHERITS_REVERSE_VERBS, WHERE_MARKERS, TRAILING_TEMPORAL_ADVERBS, MENTION_MARKERS, TRAILING_SCOPE_FILLER, TRAILING_SCOPE_FILLER_RE, TRAILING_DISCOURSE_TAG, TRAILING_DISCOURSE_TAG_RE, TRAILING_DISCOURSE_CLAUSE, TRAILING_DISCOURSE_CLAUSE_RE, VERB_TO_KIND, NON_REVERSE_VERB, ARTICLE_RELATION_CONTINUATIONS, ENTITY_TO_TYPE, MODIFIER_TO_KIND, PASSIVE_PARTICIPLE_TO_KIND, CONTRACTIONS, MISSPELLINGS, WRONG_WORDS, G_DROP, FILLER_WORDS, CONTEXT_PRONOUNS, NEGATION_FRAMES, COMMIT_CONTENT_FRAMES, META_MEANING_VERBS, RELATIVE_PRONOUNS, PLACEHOLDER_NOUNS, BOOLEAN_CONNECTIVES, QUALIFIERS, GENERIC_AGENT_WORDS, AGGREGATE_TRIGGERS, LIST_TRIGGERS, SUPERLATIVE_EXTREMES, EDGE_NOUN_TO_METRIC, METRIC_IMPLIES_ENTITY, ANAPHORA_TRIGGERS, MEMBERSHIP_KINDS, CASCADE_NOISE, CASCADE_SYNONYMS, HELP_TRIGGERS;
  var init_ask_vocab = __esm({
    "src/domain/ask-vocab.mjs"() {
      INHERITS_REVERSE_VERB_LIST = [
        "is a superclass of",
        "are a superclass of",
        "is a parent class of",
        "are a parent class of",
        "superclass",
        "superclasses"
      ];
      RELATIONS = {
        imports: {
          bare: "import",
          comment: "Module -> Module: subject's import graph references object (usesComplexType).",
          verbs: [
            // formal/neutral ("uses code from" stays here: its phrasing is
            // specifically import-flavored)
            "couples to",
            "couple to",
            "depends on",
            "imports",
            "import",
            "relies on",
            "rely on",
            "requires",
            "require",
            "references",
            "reference",
            "pulls in",
            "pull in",
            "built on",
            "builds on",
            "build on",
            "uses code from",
            // casual/colloquial
            "grabs",
            "grab",
            "pulls from",
            "pull from",
            "leans on",
            "lean on",
            "is wired to",
            "are wired to",
            "is hooked up to",
            "are hooked up to",
            // gerund (g-drop normalization turns dialectal "importin'" into this)
            "importing"
          ]
        },
        // query-side union, not a stored predicate: ask.mjs traverses "uses" as
        // imports + calls + callsSymbol together (KIND_UNIONS).
        uses: {
          bare: "use",
          comment: "query-side union: imports (Module->Module) + calls (Module->Module) + callsSymbol (fn->fn).",
          verbs: [
            "uses",
            "use",
            "makes use of",
            "make use of",
            // casual: "what does app.mjs talk to" is the union question a newcomer
            // actually asks — imports and calls together, which is what "uses" is.
            "talks to",
            "talk to",
            // gerund (g-drop normalization)
            "using"
          ]
        },
        calls: {
          bare: "call",
          comment: "Function/Method -> Function/Class (symbol-grain) or Module -> Module (coarse): subject invokes object.",
          verbs: [
            // formal
            "invokes",
            "invoke",
            // neutral
            "calls",
            "call",
            "runs",
            "run",
            "executes",
            "execute",
            // casual/colloquial
            "hits",
            "hit",
            "triggers",
            "trigger",
            "fires",
            "fire",
            "kicks off",
            "kick off",
            // gerund (g-drop normalization turns dialectal "callin'" into this)
            "calling"
          ]
        },
        defines: {
          bare: "define",
          comment: "Module -> top-level Function/Class/Method/Attribute: subject declares object.",
          verbs: [
            "defines",
            "define",
            "declares",
            "declare",
            "has",
            "have",
            "holds",
            "hold",
            // gerund (g-drop normalization)
            "defining"
          ]
        },
        contains: {
          bare: "contain",
          comment: "Class -> Method/Attribute: subject's membership includes object.",
          verbs: [
            "contains",
            "contain",
            "lives in",
            "live in",
            "is defined in",
            "are defined in",
            "is part of",
            "are part of",
            "sits in",
            "sit in",
            "sits inside",
            "sit inside",
            // gerund (g-drop normalization)
            "containing"
          ]
        },
        tests: {
          bare: "test",
          comment: "Module -> Module: subject is a test module importing/covering object.",
          verbs: [
            "tests",
            "test",
            "covers",
            "cover",
            "verifies",
            "verify",
            "exercises",
            "exercise",
            "checks",
            "check",
            "makes sure of",
            "make sure of",
            // gerund (g-drop normalization)
            "testing"
          ]
        },
        inherits: {
          bare: "inherit from",
          comment: "Class -> Class: subject's declared base resolves to object (subclassOf).",
          verbs: [
            "inherits from",
            "inherit from",
            "inherits",
            "inherit",
            "extends",
            "extend",
            "subclasses",
            "subclass",
            "derives from",
            "derive from",
            "is a subclass of",
            "are a subclass of",
            "is a kind of",
            "are a kind of",
            "is built off",
            "are built off",
            "is built on top of",
            "are built on top of",
            // gerund, incl. compositional grammar's gerund-led boolean gate
            // ("classes inheriting from Base but not tested")
            "extending",
            "inheriting from",
            "inheriting",
            "subclassing",
            "extends from",
            ...INHERITS_REVERSE_VERB_LIST
          ]
        },
        touches: {
          bare: "touch",
          comment: "Commit -> Module (coarse) or Commit -> symbol (fine, touchesSymbol): a commit's changed-line-range intersects object.",
          verbs: [
            "touched",
            "touches",
            "changed",
            "change",
            "modified",
            "modifies",
            "was changed in",
            "were changed in",
            "was edited in",
            "were edited in",
            "was modified by",
            "were modified by",
            "was tweaked in",
            "were tweaked in",
            "got changed in",
            "got edited in",
            // the same touch relation asked from the commit's side ("what did
            // commit <sha> touch"). "touched by"/"modified by"/"changed by" are absent
            // on purpose: they mark a passive AGENT, so swallowing the "by" here would
            // hide the passive from the strategy that reads it and invert the operands.
            "touch",
            "changed in",
            "landed in",
            "land in",
            // "was in"/"went into" only read as touch questions against a
            // sha-shaped object
            "was in",
            "were in",
            "went into",
            "included in",
            "updated",
            "edited",
            // gerund (g-drop normalization)
            "touching"
          ]
        },
        cochange: {
          bare: "co-change with",
          comment: "Module -> Module: subject and object are frequently committed together (changeCoupledWith).",
          verbs: [
            "changed with",
            "co-changes with",
            "co-change with",
            "changes alongside",
            "change alongside",
            "shares commits with",
            "share commits with",
            "tends to change together with",
            "tend to change together with",
            "moves together with",
            "move together with",
            "changed together with",
            "change together with",
            "changes together with",
            "changes with",
            "change with",
            "tends to change with",
            "tend to change with",
            "usually changes with"
          ]
        },
        reexports: {
          bare: "re-export",
          comment: "Module -> exported symbol: subject's public API surface (__all__/export list).",
          verbs: [
            "exports",
            "export",
            "re-exports",
            "re-export",
            "passes through",
            "pass through",
            "exposes",
            "expose",
            // gerund (g-drop normalization)
            "exporting"
          ]
        }
      };
      INHERITS_REVERSE_VERBS = Object.freeze([
        ...INHERITS_REVERSE_VERB_LIST,
        "is the superclass of",
        "are the superclass of",
        "is the parent class of"
      ]);
      WHERE_MARKERS = Object.freeze(["defined", "declared", "located", "implemented"]);
      TRAILING_TEMPORAL_ADVERBS = Object.freeze(["now", "currently", "right now", "at the moment", "these days", "today"]);
      MENTION_MARKERS = Object.freeze(["mentioned", "referenced"]);
      TRAILING_SCOPE_FILLER = Object.freeze([
        "in this graph",
        "in the graph",
        "in this codebase",
        "in the codebase",
        "in this repo",
        "in the repo",
        "here"
      ]);
      TRAILING_SCOPE_FILLER_RE = new RegExp(
        `\\s+(?:${TRAILING_SCOPE_FILLER.join("|")})\\s*[?.!]*$`,
        "i"
      );
      TRAILING_DISCOURSE_TAG = Object.freeze(["then", "though", "too"]);
      TRAILING_DISCOURSE_TAG_RE = new RegExp(
        `\\s+(?:${TRAILING_DISCOURSE_TAG.join("|")})\\s*[?.!]*$`,
        "i"
      );
      TRAILING_DISCOURSE_CLAUSE = Object.freeze(["please explain", "explain"]);
      TRAILING_DISCOURSE_CLAUSE_RE = new RegExp(
        `,\\s*(?:${TRAILING_DISCOURSE_CLAUSE.join("|")})\\s*[?.!]*$`,
        "i"
      );
      VERB_TO_KIND = Object.freeze(
        Object.fromEntries(
          Object.entries(RELATIONS).flatMap(([kind, { verbs }]) => verbs.map((v) => [v, kind]))
        )
      );
      NON_REVERSE_VERB = (v) => !INHERITS_REVERSE_VERBS.includes(v);
      ARTICLE_RELATION_CONTINUATIONS = Object.freeze([
        ...new Set(
          Object.keys(VERB_TO_KIND).filter(NON_REVERSE_VERB).map((v) => v.match(/^(?:is|are)\s+an?\s+(.+)$/i)).filter(Boolean).map((m) => m[1].toLowerCase())
        )
      ]);
      ENTITY_TO_TYPE = Object.freeze({
        function: "Function",
        functions: "Function",
        method: "Method",
        methods: "Method",
        class: "Class",
        classes: "Class",
        module: "Module",
        modules: "Module",
        mod: "Module",
        mods: "Module",
        file: "Module",
        files: "Module",
        attribute: "Attribute",
        attributes: "Attribute",
        field: "Attribute",
        fields: "Attribute",
        variable: "GlobalVariable",
        variables: "GlobalVariable",
        global: "GlobalVariable",
        globals: "GlobalVariable",
        // "Change" is a pseudo-type, not a node class: ask.mjs's traverse() reads it
        // as a wildcard over touch-traversal results (module or symbol grain).
        // Listed before commit/commits since findPhrase takes the first
        // same-length match in table order.
        change: "Change",
        changes: "Change",
        commit: "Commit",
        commits: "Commit"
      });
      MODIFIER_TO_KIND = Object.freeze({
        explicitly: "direct",
        directly: "direct",
        transitively: "transitive",
        indirectly: "transitive"
      });
      PASSIVE_PARTICIPLE_TO_KIND = Object.freeze({
        imported: "imports",
        called: "calls",
        used: "uses",
        tested: "tests",
        covered: "tests",
        verified: "tests",
        exercised: "tests",
        checked: "tests",
        defined: "defines",
        declared: "defines",
        inherited: "inherits",
        extended: "inherits",
        subclassed: "inherits",
        contained: "contains",
        exported: "reexports",
        "re-exported": "reexports",
        exposed: "reexports",
        touched: "touches",
        changed: "touches",
        modified: "touches",
        edited: "touches",
        updated: "touches"
      });
      CONTRACTIONS = Object.freeze({
        "ain't": "is not",
        "aint": "is not",
        "isn't": "is not",
        "isnt": "is not",
        "aren't": "are not",
        "arent": "are not",
        "doesn't": "does not",
        "doesnt": "does not",
        "don't": "do not",
        "dont": "do not",
        "didn't": "did not",
        "didnt": "did not",
        "there's": "there is",
        "theres": "there is",
        "what's": "what is",
        "whats": "what is",
        "who's": "who is",
        "whos": "who is",
        "gonna": "going to",
        "wanna": "want to",
        "gotta": "got to",
        "yer": "your",
        "ur": "your",
        "gimme": "give me"
      });
      MISSPELLINGS = Object.freeze({
        // entity nouns
        "funtion": "function",
        "funtions": "functions",
        "fucntion": "function",
        "fucntions": "functions",
        "functoin": "function",
        "functoins": "functions",
        "calss": "class",
        "calsses": "classes",
        "classs": "class",
        "clases": "classes",
        "modul": "module",
        "moduls": "modules",
        "moduel": "module",
        "moduels": "modules",
        "moudle": "module",
        "moudles": "modules",
        "methdo": "method",
        "methdos": "methods",
        "mehtod": "method",
        "mehtods": "methods",
        "comit": "commit",
        "comits": "commits",
        "commmit": "commit",
        "commmits": "commits",
        "varaible": "variable",
        "varaibles": "variables",
        "varibale": "variable",
        "varibales": "variables",
        "atribute": "attribute",
        "atributes": "attributes",
        // relation verbs
        "improt": "import",
        "improts": "imports",
        "imoprt": "import",
        "imoprts": "imports",
        "inherts": "inherits",
        "inheirts": "inherits",
        "extands": "extends",
        "extneds": "extends",
        "depnds": "depends",
        "touchs": "touches",
        "tuoches": "touches",
        "touhced": "touched",
        "touchd": "touched",
        "defned": "defined",
        "chagned": "changed",
        "chnaged": "changed",
        "chagnes": "changes",
        "chnages": "changes",
        "calles": "calls",
        "exprot": "export",
        "exprots": "exports",
        "tets": "tests",
        // grammar anchor words
        "whcih": "which",
        "wich": "which",
        "whihc": "which",
        // "were" (the missing-h homophone slip of "where") is NOT curated here —
        // it's a load-bearing TEMPORAL_AUX word ("when were the modules touched").
        "wehre": "where",
        "whre": "where",
        "waht": "what",
        "wat": "what",
        "dat": "that",
        "dose": "does",
        "doess": "does",
        "teh": "the",
        "manyn": "many",
        "mnay": "many",
        "amny": "many",
        "mnany": "many",
        "hwo": "how",
        "coutn": "count",
        "conut": "count",
        "cuont": "count",
        "ocunt": "count",
        "numer": "number",
        "nubmer": "number",
        "numbr": "number",
        "nmuber": "number",
        "lst": "list",
        "lsit": "list",
        "ilst": "list",
        "shwo": "show",
        "hsow": "show",
        "dispaly": "display",
        "dsiplay": "display",
        "funtcions": "functions",
        "funciton": "function",
        "funcitons": "functions"
      });
      WRONG_WORDS = Object.freeze({
        // neither a folder nor a directory grain exists in this graph — in "which
        // folders import X" the only honest referent is the module/file grain.
        "folder": "module",
        "folders": "modules",
        "directory": "module",
        "directories": "modules",
        // unambiguous abbreviation of an entity noun this grammar owns
        "func": "function",
        "funcs": "functions",
        // VCS terms whose canonical schema class here is Commit
        "changeset": "commit",
        "changesets": "commits",
        "revision": "commit",
        "revisions": "commits",
        // code-graph "property" is the Attribute grain in this schema
        "property": "attribute",
        "properties": "attributes"
      });
      G_DROP = /\b([a-z]{3,})in'/gi;
      FILLER_WORDS = Object.freeze([
        "um",
        "uh",
        "erm",
        "so",
        "like",
        "yo",
        "hey",
        "bru",
        "bro",
        "fam",
        "mate",
        "please",
        "could you",
        "can you",
        "would you",
        "tell me",
        "i wonder",
        "just wondering",
        "quickly",
        "real quick",
        "kinda",
        "sorta",
        "btw",
        "by the way",
        "you",
        "quick q"
      ]);
      CONTEXT_PRONOUNS = Object.freeze(["this", "it", "that", "here", "this one", "that one"]);
      NEGATION_FRAMES = Object.freeze([
        // "there ain't nothin' calling it" / "there isn't nothing that calls it"
        //   -> "what calls it"
        { re: /\bthere\s+is\s+not\s+(?:anything|nothing)\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
        // "there's no module that imports auth" -> "what imports auth"
        { re: /\bthere\s+is\s+no\s+\S+\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
        // "isn't there anything calling it" -> "what calls it" (question-inverted form)
        { re: /\bis\s+not\s+there\s+(?:anything|nothing)\s+(?:that\s+)?(\S.*)$/i, to: (m) => `what ${m[1]}` },
        // "nobody/nothing calls it, does it" (tag-question double-negative) -> "what calls it"
        { re: /\b(?:nobody|nothing|no one)\s+(\S.*?)(?:,?\s+does\s+it\??|,?\s+do\s+they\??)?$/i, to: (m) => `what ${m[1]}` }
      ]);
      COMMIT_CONTENT_FRAMES = Object.freeze([
        // "what was in commit ef74e44e25c8" / "what is in ef74e44e" / "what's in commit <sha>"
        { re: /^what\s+(?:is|was|were|are)\s+in\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
        // "what went into commit ef74e44e25c8" / casual "what got into <sha>"
        { re: /^what\s+(?:went|got)\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` },
        // "what made it into commit ef74e44e25c8"
        { re: /^what\s+made\s+it\s+into\s+((?:commit\s+)?[0-9a-f]{7,40})\??$/i, to: (m) => `what did ${m[1]} touch` }
      ]);
      META_MEANING_VERBS = Object.freeze([
        "mean",
        "means",
        "stand for",
        "stands for",
        "signify",
        "signifies",
        "represent",
        "represents",
        "refer to",
        "refers to"
      ]);
      RELATIVE_PRONOUNS = Object.freeze(["that", "which", "who"]);
      PLACEHOLDER_NOUNS = Object.freeze([
        "something",
        "anything",
        "everything",
        "somethings",
        "things",
        "thing",
        "entities",
        "entity",
        "nodes",
        "node",
        "stuff",
        "code",
        "symbol",
        "symbols"
      ]);
      BOOLEAN_CONNECTIVES = Object.freeze({
        "but not": "difference",
        "and not": "difference",
        "except": "difference",
        "without": "difference",
        "and": "intersection",
        "plus": "intersection",
        "or": "union"
      });
      QUALIFIERS = Object.freeze({
        public: { via: "visibility", value: "public" },
        private: { via: "visibility", value: "private" },
        protected: { via: "visibility", value: "protected" },
        static: { via: "attr", attr: "isStatic" },
        abstract: { via: "attr", attr: "isAbstract" },
        constant: { via: "attr", attr: "isConstant" },
        exported: { via: "exported" },
        "re-exported": { via: "exported" },
        tested: { via: "tested", value: true },
        covered: { via: "tested", value: true },
        untested: { via: "tested", value: false },
        uncovered: { via: "tested", value: false }
      });
      GENERIC_AGENT_WORDS = Object.freeze(/* @__PURE__ */ new Set([
        "tests",
        "test",
        "anything",
        "something",
        "anyone",
        "someone",
        "any"
      ]));
      AGGREGATE_TRIGGERS = Object.freeze([
        "how many",
        "how much",
        "how many of",
        "number of",
        "total number of",
        "quantity of",
        "tally of",
        "sum of",
        "total of",
        "amount of",
        "count",
        "count up",
        "count of",
        "tot up"
      ]);
      LIST_TRIGGERS = Object.freeze([
        "list",
        "show",
        "show me",
        "show us",
        "display",
        "print",
        "print out",
        "dump",
        "enumerate",
        "name",
        "give me",
        "get me",
        "spit out",
        "rattle off",
        "run down",
        "run through",
        "ls",
        "what are",
        "which are"
      ]);
      SUPERLATIVE_EXTREMES = Object.freeze({
        most: "most",
        greatest: "most",
        highest: "most",
        biggest: "most",
        largest: "most",
        "most-connected": "most",
        "most connected": "most",
        fewest: "fewest",
        least: "fewest",
        smallest: "fewest",
        lowest: "fewest"
      });
      EDGE_NOUN_TO_METRIC = Object.freeze({
        imports: { kind: "imports", dir: "out" },
        dependencies: { kind: "imports", dir: "out" },
        importers: { kind: "imports", dir: "in" },
        dependents: { kind: "imports", dir: "in" },
        callers: { kind: "calls", dir: "in", sibling: "callsSymbol" },
        callees: { kind: "calls", dir: "out", sibling: "callsSymbol" },
        calls: { kind: "calls", dir: "out", sibling: "callsSymbol" },
        methods: { kind: "contains", dir: "out", filter: "Method" },
        members: { kind: "contains", dir: "out" },
        tests: { kind: "tests", dir: "in" },
        test: { kind: "tests", dir: "in" },
        // singular ("needs a test") — same edge as plural "tests"
        subclasses: { kind: "inherits", dir: "in" },
        connections: { kind: "*", dir: "both" },
        edges: { kind: "*", dir: "both" },
        connected: { kind: "*", dir: "both" },
        // participle degree-nouns rank by in-degree, same intent as "importers" etc
        imported: { kind: "imports", dir: "in" },
        "depended-on": { kind: "imports", dir: "in" },
        depended: { kind: "imports", dir: "in" },
        used: { kind: "imports", dir: "in", sibling: "callsSymbol" },
        called: { kind: "calls", dir: "in", sibling: "callsSymbol" }
      });
      METRIC_IMPLIES_ENTITY = Object.freeze({
        tests: "Module",
        test: "Module"
      });
      ANAPHORA_TRIGGERS = Object.freeze(["those", "them", "these"]);
      MEMBERSHIP_KINDS = Object.freeze(["contains", "defines"]);
      CASCADE_NOISE = Object.freeze([
        "the",
        "a",
        "an",
        "some",
        "other",
        "about",
        "please",
        "pls",
        "plz",
        "kindly",
        "just",
        "simply",
        "maybe",
        "perhaps",
        "thanks",
        "thank",
        "ta",
        "cheers",
        "hi",
        "hello",
        "hey",
        "yo",
        "hiya",
        "howdy",
        "ok",
        "okay",
        "matey",
        "mate",
        "buddy",
        "pal",
        "dude",
        "man",
        "bro",
        "bru",
        "fam",
        "friend",
        "sir",
        "maam",
        "folks",
        "guys",
        "everyone",
        "dear",
        "tmct",
        "show",
        "tell",
        "give",
        "list",
        "find",
        "me",
        "us",
        "lemme"
      ]);
      CASCADE_SYNONYMS = Object.freeze({
        tally: "count",
        tallies: "count",
        sum: "count",
        total: "count",
        totals: "count"
      });
      HELP_TRIGGERS = Object.freeze([
        "help",
        "help me",
        "how do i ask",
        "how do i use this",
        "what can i ask",
        "what can you ask",
        "usage",
        "commands",
        "examples",
        "syntax",
        "options"
      ]);
    }
  });

  // src/adapters/config.mjs
  var DEFAULT_GRAPH_REL, ToolError;
  var init_config = __esm({
    "src/adapters/config.mjs"() {
      init_node_path();
      DEFAULT_GRAPH_REL = join(".tmct", "graph.json");
      ToolError = class extends Error {
        constructor(message) {
          super(message);
          this.name = "ToolError";
        }
      };
    }
  });

  // src/domain/prose.mjs
  function splitIdentifierWords(raw) {
    if (!raw) return [];
    let s = String(raw).replace(/\.[A-Za-z0-9]+$/, "");
    s = s.replace(/[/\\]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").replace(/[_\-.]+/g, " ");
    return s.split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length > 1 && w.length <= MAX_TOKEN_LEN);
  }
  function tokenizeProse(text) {
    if (!text) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 2 || raw.length > MAX_TOKEN_LEN || STOPWORDS.has(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
      if (out.length >= MAX_TOKENS_PER_DOC) break;
    }
    return out;
  }
  function proseTokensFor({ name, doc } = {}) {
    const set = /* @__PURE__ */ new Set([...splitIdentifierWords(name), ...tokenizeProse(doc)]);
    return [...set].sort();
  }
  function buildProseIndex(individuals) {
    const index = /* @__PURE__ */ Object.create(null);
    for (const ind of individuals) {
      const tokAttr = (ind.attributes || []).find((a) => a.key === "prose_tokens");
      if (!tokAttr?.value) continue;
      for (const word of tokAttr.value.split(" ")) {
        if (!index[word]) index[word] = [];
        index[word].push(ind.id);
      }
    }
    for (const word of Object.keys(index)) index[word].sort();
    return index;
  }
  function lookupByProseTokens(proseIndex, query, { limit = 10 } = {}) {
    const queryTokens = [.../* @__PURE__ */ new Set([...splitIdentifierWords(query), ...tokenizeProse(query)])];
    if (!queryTokens.length) return [];
    const scoreById = /* @__PURE__ */ new Map();
    for (const word of queryTokens) {
      for (const id of proseIndex?.[word] || []) {
        scoreById.set(id, (scoreById.get(id) || 0) + 1);
      }
    }
    return [...scoreById.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0])).slice(0, limit).map(([id, score]) => ({ id, score }));
  }
  function proseLayerHits(proseIndex, token) {
    const src = proseIndex && (proseIndex["tmct:layers"] ? proseIndex : proseIndex.proseIndex);
    const layers = src && src["tmct:layers"];
    const t = String(token || "").toLowerCase();
    const empty = { ids: [], via: null };
    if (!t || !layers || typeof layers !== "object") return empty;
    const ids = /* @__PURE__ */ new Set();
    const via = /* @__PURE__ */ new Set();
    for (const name of Object.keys(layers)) {
      const layer = layers[name];
      if (!layer || typeof layer !== "object") continue;
      const posting = layer[t];
      const list = Array.isArray(posting) ? posting : Array.isArray(posting?.ids) ? posting.ids : null;
      if (!list?.length) continue;
      for (const id of list) ids.add(id);
      via.add(name);
    }
    return ids.size ? { ids: [...ids].sort(), via: [...via].sort().join("+") } : empty;
  }
  var STOPWORDS, MAX_TOKEN_LEN, MAX_TOKENS_PER_DOC;
  var init_prose = __esm({
    "src/domain/prose.mjs"() {
      STOPWORDS = new Set(
        "a an and or but the of to in on at for with from by as is are was were be been being it its this that these those i you he she they we me my your our do does did not no yes if then else than so such can will would should could may might about into over under out up down off again more most some any all what which who whom whose when where why how".split(/\s+/)
      );
      MAX_TOKEN_LEN = 40;
      MAX_TOKENS_PER_DOC = 120;
    }
  });

  // src/domain/memory/trust.mjs
  function parseChatTagRest(rest) {
    const at = rest.indexOf("@");
    const beforeAt = at >= 0 ? rest.slice(0, at) : rest;
    const createdAt = at >= 0 ? rest.slice(at + 1) : "";
    const colon = beforeAt.indexOf(":");
    const sessionId = colon >= 0 ? beforeAt.slice(colon + 1) : "";
    return { createdAt, ...sessionId ? { sessionId } : {} };
  }
  function provenanceTagToSource(tag) {
    const t = String(tag || "").trim();
    if (!t) return null;
    const head = t.split(/\s+/)[0];
    if (head.startsWith("corpus-weak:")) return { kind: "corpusWeak", name: head.slice("corpus-weak:".length) || "unknown" };
    if (head.startsWith("corpus:")) return { kind: "corpus", name: head.slice("corpus:".length) || "unknown" };
    if (head.startsWith("ace:")) return { kind: "operator", ...parseChatTagRest(head.slice("ace:".length)) };
    if (head.startsWith("teach:")) {
      return { kind: "teach", ...parseChatTagRest(head.slice("teach:".length)) };
    }
    if (head.startsWith("web:")) return { kind: "web", url: head.slice("web:".length) };
    if (head.startsWith("url:")) return { kind: "web", url: head.slice("url:".length) };
    if (head.startsWith("extracted:")) return { kind: "extracted", name: head.slice("extracted:".length) || "unknown" };
    if (head.startsWith("entailed:")) return { kind: "entailed", rule: head.slice("entailed:".length) };
    if (head.startsWith("chat:") || head.startsWith("session:") || head.startsWith("operator")) return { kind: "operator" };
    return null;
  }
  function sourceReliabilityOf(s) {
    const raw = (s?.attributes || []).find((a) => a.prop === "mgx:sourceReliability")?.value;
    if (raw === void 0) return SOURCE_RELIABILITY_NEUTRAL;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SOURCE_RELIABILITY_NEUTRAL;
    return Math.max(SOURCE_RELIABILITY_MIN, Math.min(SOURCE_RELIABILITY_MAX, n));
  }
  function recencyNudge(createdAt, now = Date.now(), halfLifeMs = RECENCY_HALF_LIFE_MS) {
    const t = Date.parse(createdAt);
    if (!Number.isFinite(t)) return 1;
    const ageMs = Math.max(0, now - t);
    return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageMs / halfLifeMs);
  }
  function computeTrust(fact, sourcesById = {}, opts = {}) {
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    const ids = Array.isArray(fact?.sourceIds) ? fact.sourceIds : [];
    const seen = /* @__PURE__ */ new Set();
    const types = [];
    const priors = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const source = sourcesById[id];
      const t = sourceTypeOf(source);
      if (!t) continue;
      types.push(t);
      const p = (SOURCE_PRIOR[t] ?? 0) * sourceReliabilityOf(source);
      priors.push(Math.max(0, Math.min(1, p)));
    }
    let base = 0;
    let complement = 1;
    for (const p of priors) complement *= 1 - p;
    if (priors.length) base = Math.min(1, 1 - complement);
    if (types.includes("entailed") && Array.isArray(opts.premiseTrusts) && opts.premiseTrusts.length) {
      const rc = typeof opts.ruleConfidence === "number" ? opts.ruleConfidence : 1;
      base = Math.max(0, Math.min(1, Math.min(...opts.premiseTrusts) * rc));
    }
    const recency = recencyNudge(fact?.createdAt, now, opts.halfLifeMs);
    const score = round(Math.min(1, base * recency));
    const inputs = {
      sourceTypes: types.slice().sort(),
      corroboration: types.length,
      createdAt: fact?.createdAt || "",
      recency: round(recency)
    };
    return { score, inputs };
  }
  function sessionReliabilityFrom({ factsAsserted = 0, factsContradicted = 0 } = {}) {
    const asserted = Math.max(0, Number(factsAsserted) || 0);
    const contradicted = Math.max(0, Number(factsContradicted) || 0);
    const net = Math.max(-1, Math.min(1, (asserted - 2 * contradicted) / Math.max(1, asserted)));
    const confidence = asserted / (asserted + RELIABILITY_CONFIDENCE_PSEUDOCOUNT);
    const ratio = (net * confidence + 1) / 2;
    return round(SOURCE_RELIABILITY_MIN + (SOURCE_RELIABILITY_MAX - SOURCE_RELIABILITY_MIN) * ratio);
  }
  var TRUST_SCORE_PROP, TRUST_INPUTS_PROP, CREATED_AT_PROP, UPDATED_AT_PROP, SOURCE_PRIOR, RECENCY_HALF_LIFE_MS, RECENCY_FLOOR, SOURCE_RELIABILITY_MIN, SOURCE_RELIABILITY_MAX, SOURCE_RELIABILITY_NEUTRAL, round, sourceTypeOf, RELIABILITY_CONFIDENCE_PSEUDOCOUNT;
  var init_trust = __esm({
    "src/domain/memory/trust.mjs"() {
      TRUST_SCORE_PROP = "mgx:trustScore";
      TRUST_INPUTS_PROP = "mgx:trustInputs";
      CREATED_AT_PROP = "mgx:createdAt";
      UPDATED_AT_PROP = "mgx:updatedAt";
      SOURCE_PRIOR = Object.freeze({
        operator: 1,
        teach: 0.95,
        provider: 0.9,
        corpus: 0.7,
        corpusWeak: 0.55,
        web: 0.4,
        extracted: 0.45,
        entailed: 0.3
      });
      RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1e3;
      RECENCY_FLOOR = 0.9;
      SOURCE_RELIABILITY_MIN = 0.5;
      SOURCE_RELIABILITY_MAX = 1.5;
      SOURCE_RELIABILITY_NEUTRAL = 1;
      round = (n, p = 6) => Number(n.toFixed(p));
      sourceTypeOf = (s) => (s?.attributes || []).find((a) => a.prop === "mgx:sourceType")?.value || "";
      RELIABILITY_CONFIDENCE_PSEUDOCOUNT = 19;
    }
  });

  // src/domain/codegraph.mjs
  function parseEntities(payload) {
    const individuals = Array.isArray(payload?.individuals) ? payload.individuals : [];
    const byId = /* @__PURE__ */ new Map();
    for (const ind of individuals) {
      if (ind && ind.id) byId.set(ind.id, ind);
    }
    const relations = (Array.isArray(payload?.objectProperties) ? payload.objectProperties : []).filter((g) => g && (g.predicate || g.prop)).map((g) => {
      const edges = (Array.isArray(g.examples) ? g.examples : []).filter((e) => e && e.subject && e.object);
      return {
        predicate: String(g.predicate || ""),
        prop: g.prop || null,
        count: Number(g.count) || edges.length,
        edges
      };
    });
    const truncated = relations.filter((g) => g.count > g.edges.length).map((g) => ({ predicate: g.predicate, count: g.count, shown: g.edges.length }));
    return {
      individuals,
      byId,
      relations,
      truncated,
      generatedAt: payload?.generated_at || null,
      // word -> [individual ids]; {} when prose was disabled at build time
      proseIndex: payload?.proseIndex || {}
    };
  }
  function moduleCountOf(graph) {
    if (!graph || !Array.isArray(graph.individuals)) return 0;
    return graph.individuals.filter((i) => (i.class || "") === "Module").length;
  }
  function relationKind(group) {
    const prop = String(group?.prop || "").toLowerCase();
    if (PROP_KIND[prop]) return PROP_KIND[prop];
    const pred = String(group?.predicate || "").toLowerCase();
    if (/symbol/.test(pred)) {
      if (/\b(call|invoke)/.test(pred)) return "callsSymbol";
      if (/(touch|chang|modif)/.test(pred)) return "touchesSymbol";
    }
    if (/\bimport/.test(pred)) return "imports";
    if (/\b(call|invoke)/.test(pred)) return "calls";
    if (/\b(define|export|declare)/.test(pred)) return "defines";
    if (/\b(test|cover)/.test(pred)) return "tests";
    if (/\b(touch|chang|modif)/.test(pred)) return "touches";
    if (/\bcontain/.test(pred)) return "contains";
    if (/\b(inherit|subclass|extend|specializ)/.test(pred)) return "inherits";
    return null;
  }
  function normPath(s) {
    return String(s || "").trim().toLowerCase().replace(/^\.\//, "").replace(/^\//, "");
  }
  function basename(p) {
    const parts = normPath(p).split("/");
    return parts[parts.length - 1];
  }
  function turnRefCount(ind) {
    return (ind?.derived_from || []).filter(isProvRef).length;
  }
  function mentionTotal(ind) {
    const fromMentions = (ind?.mentions || []).reduce((n, m) => n + (Number(m?.count) || 0), 0);
    return fromMentions + turnRefCount(ind);
  }
  function resolveSymbol(graph, symbol) {
    const s = normPath(symbol);
    if (!s) return { match: null, candidates: [] };
    const sBase = basename(s);
    const scored = [];
    for (const ind of graph.individuals) {
      const label = normPath(ind.label);
      const id = String(ind.id || "").toLowerCase();
      let score = 0;
      if (label === s || id === s) score = 100;
      else if (label.endsWith(`/${s}`) || basename(label) === sBase || basename(label).replace(/\.[a-z]+$/, "") === sBase)
        score = 80;
      else if (label.includes(s)) score = Math.max(10, 50 - (label.length - s.length));
      if (score > 0) scored.push({ ind, score });
    }
    scored.sort(
      (a, b) => b.score - a.score || mentionTotal(b.ind) - mentionTotal(a.ind) || String(a.ind.label).length - String(b.ind.label).length
    );
    return {
      match: scored[0]?.ind || null,
      candidates: scored.slice(1, 5).map((x) => x.ind)
    };
  }
  function siteOf(ind) {
    const a = (ind?.attributes || []).find((x) => x.key === "site");
    if (!a) return null;
    const m = String(a.value).match(/^(.*):(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    return { path: m[1], start: Number(m[2]), end: m[3] ? Number(m[3]) : Number(m[2]) };
  }
  function edgesFor(graph, id) {
    const out = [];
    const incoming = [];
    for (const g of graph.relations) {
      const outgoing = g.edges.filter((e) => e.subject === id);
      const inbound = g.edges.filter((e) => e.object === id);
      if (outgoing.length) out.push({ group: g, edges: outgoing });
      if (inbound.length) incoming.push({ group: g, edges: inbound });
    }
    return { out, incoming };
  }
  function relLabel(g) {
    return g.prop ? `${g.predicate} [${g.prop}]` : g.predicate;
  }
  function classHeading(cls) {
    const c = cls || "Entity";
    const words = splitIdentifierWords(c);
    if (words.length < 2) return c;
    return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  function capJoin(items, n, sep3 = ", ") {
    if (items.length <= n) return items.join(sep3);
    return items.slice(0, n).join(sep3) + `, +${items.length - n} more`;
  }
  function renderDescribe(graph, ind, { candidates = [] } = {}) {
    const lines = [];
    lines.push(`${ind.label} \u2014 ${classHeading(ind.class)} (id: ${ind.id})`);
    const refs = (ind.derived_from || []).filter(isProvRef);
    if (refs.length) lines.push(`attestation: touched by ${refs.length} commit(s)`);
    for (const a of ind.attributes || []) {
      lines.push(`attribute: ${a.key} = ${a.value}${a.prop ? ` [${a.prop}]` : ""}`);
    }
    const { out, incoming } = edgesFor(graph, ind.id);
    if (!out.length && !incoming.length) {
      lines.push("edges: none in the current artifact");
    } else {
      lines.push("edges:");
      for (const { group, edges } of out) {
        lines.push(`  ${relLabel(group)} (${edges.length}) \u2192 ${capJoin(edges.map((e) => e.objectLabel || e.object), DESCRIBE_EDGE_CAP)}`);
      }
      for (const { group, edges } of incoming) {
        lines.push(`  \u2190 ${relLabel(group)} (${edges.length}) by ${capJoin(edges.map((e) => e.subjectLabel || e.subject), DESCRIBE_EDGE_CAP)}`);
      }
    }
    const prov = ind.derived_from || [];
    if (prov.length) {
      lines.push(`provenance: ${capJoin(prov, PROV_CAP)}`);
    }
    if (candidates.length) {
      lines.push(`other matches: ${candidates.map((c) => `${c.label} (${classHeading(c.class)})`).join(", ")}`);
    }
    if (graph.truncated.length) {
      lines.push(truncationNote(graph));
    }
    return lines.join("\n");
  }
  function truncationNote(graph) {
    const list = graph.truncated.map((t) => `${t.predicate} (${t.shown}/${t.count})`).join(", ");
    return `note: partial edge lists for: ${list}. Counts are complete; the lists are not.`;
  }
  function impactClosure(graph, ind, { maxDepth = 8 } = {}) {
    const dependents = /* @__PURE__ */ new Map();
    const coveredBy = /* @__PURE__ */ new Map();
    const addDependent = (objectId, subjectId, subjectLabel, via) => {
      if (!objectId || !subjectId || objectId === subjectId) return;
      if (!dependents.has(objectId)) dependents.set(objectId, []);
      dependents.get(objectId).push({ id: subjectId, label: subjectLabel, via });
    };
    for (const g of graph.relations) {
      const kind = relationKind(g);
      if (kind === "imports" || kind === "calls") {
        for (const e of g.edges) addDependent(e.object, e.subject, e.subjectLabel || e.subject, g.predicate);
      } else if (kind === "callsSymbol") {
        for (const e of g.edges) {
          const subjModId = moduleIdOfId(graph, e.subject);
          const objModId = moduleIdOfId(graph, e.object);
          if (!subjModId || !objModId) continue;
          const subjLabel = graph.byId.get(subjModId)?.label || subjModId;
          addDependent(objModId, subjModId, subjLabel, g.predicate);
        }
      } else if (kind === "tests") {
        for (const e of g.edges) {
          if (!coveredBy.has(e.object)) coveredBy.set(e.object, []);
          coveredBy.get(e.object).push(e.subjectLabel || e.subject);
        }
      }
    }
    const levels = [];
    const visited = /* @__PURE__ */ new Set([ind.id]);
    let frontier = [ind.id];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      const next = [];
      const level = [];
      for (const id of frontier) {
        for (const dep of dependents.get(id) || []) {
          if (visited.has(dep.id)) continue;
          visited.add(dep.id);
          level.push({ ...dep, tests: coveredBy.get(dep.id) || [] });
          next.push(dep.id);
        }
      }
      if (level.length) {
        level.sort((a, b) => String(a.label).localeCompare(String(b.label)));
        levels.push(level);
      }
      frontier = next;
    }
    return levels;
  }
  function renderImpact(graph, ind, { maxDepth = 8 } = {}) {
    const levels = impactClosure(graph, ind, { maxDepth });
    const lines = [`Impact of changing ${ind.label} (reverse closure over imports/calls edges, module- and function-level):`];
    if (!levels.length) {
      lines.push("no dependents found in the current artifact \u2014 nothing imports or calls it (or its edges are not in the extracted graph yet).");
    }
    const totalCount = levels.reduce((n, l) => n + l.length, 0);
    if (levels.length) {
      lines.push(`total: ${totalCount} dependent(s) across ${levels.length} depth level(s) (lists capped for brevity).`);
    }
    levels.forEach((level, i) => {
      if (i >= IMPACT_DEPTHS_LISTED) {
        lines.push(`depth ${i + 1}: ${level.length} more dependent(s) (not listed)`);
        return;
      }
      lines.push(i === 0 ? `depth 1 (${level.length} direct dependents):` : `depth ${i + 1} (${level.length}):`);
      for (const dep of level.slice(0, IMPACT_PER_DEPTH)) {
        const tests = dep.tests.length ? `tests: ${capJoin(dep.tests, IMPACT_TESTS_PER_DEP)}` : "tests: none recorded";
        lines.push(`  - ${dep.label} (${dep.via} it) \u2014 ${tests}`);
      }
      if (level.length > IMPACT_PER_DEPTH) lines.push(`  \u2026+${level.length - IMPACT_PER_DEPTH} more at depth ${i + 1}`);
    });
    const truncatedStructural = graph.truncated.filter((t) => {
      const kind = relationKind({ predicate: t.predicate });
      return kind === "imports" || kind === "calls" || kind === "callsSymbol" || kind === "tests";
    });
    if (truncatedStructural.length) {
      lines.push(
        "warning: partial edge lists (" + truncatedStructural.map((t) => `${t.predicate}: ${t.shown}/${t.count}`).join(", ") + ") \u2014 this closure may be missing edges. Cross-check critical results with tmct_search."
      );
    }
    return lines.join("\n");
  }
  function definesIndex(graph) {
    const idx = /* @__PURE__ */ new Map();
    for (const g of graph.relations) {
      if (relationKind(g) !== "defines") continue;
      for (const e of g.edges) {
        if (!idx.has(e.subject)) idx.set(e.subject, []);
        idx.get(e.subject).push(e.objectLabel || e.object);
      }
    }
    return idx;
  }
  function identComponents(name) {
    return new Set(String(name).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  }
  function adjacencyForKinds(graph, kinds, idNormalizer = null) {
    const norm = idNormalizer || ((id) => moduleIdOfId(graph, id));
    const adj = /* @__PURE__ */ new Map();
    const link = (a, b) => {
      if (!a || !b || a === b) return;
      if (!adj.has(a)) adj.set(a, /* @__PURE__ */ new Set());
      if (!adj.has(b)) adj.set(b, /* @__PURE__ */ new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };
    for (const kind of kinds) {
      for (const e of edgesOfKind(graph, kind)) {
        link(norm(e.subject), norm(e.object));
      }
    }
    return adj;
  }
  function beamExpand(graph, scored, beamWidth) {
    if (scored.length < 2) return;
    const byId = new Map(scored.map((s) => [s.ind.id, s]));
    const baseScore = new Map(scored.map((s) => [s.ind.id, s.score]));
    const pruneToBeam = (candidates) => {
      if (!candidates.size) return [[], []];
      let best = 0;
      for (const v of candidates.values()) best = Math.max(best, v);
      const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
      const survivors = [];
      const overflow2 = [];
      for (const [id, score] of ranked) {
        if (score >= best * BEAM_MARGIN_FRAC && survivors.length < beamWidth) survivors.push([id, score]);
        else if (overflow2.length < BEAM_OVERFLOW_CAP) overflow2.push([id, score]);
      }
      return [survivors, overflow2];
    };
    let [beam, overflow] = pruneToBeam(new Map(scored.map((s) => [s.ind.id, s.score])));
    const boosted = new Set(beam.map(([id]) => id));
    for (let ply = 0; ply < BEAM_PLIES && beam.length; ply++) {
      const merged = /* @__PURE__ */ new Map();
      const plyOverflow = [];
      for (const kinds of BEAM_EDGE_GROUPS) {
        const adj = adjacencyForKinds(graph, kinds);
        const candidates = /* @__PURE__ */ new Map();
        for (const [parentId, parentScore] of beam) {
          for (const neighbourId of adj.get(parentId) || []) {
            if (!baseScore.has(neighbourId)) continue;
            candidates.set(neighbourId, Math.max(candidates.get(neighbourId) || 0, parentScore));
          }
        }
        const [survivors, kindOverflow] = pruneToBeam(candidates);
        for (const [id, score] of survivors) merged.set(id, Math.max(merged.get(id) || 0, score));
        plyOverflow.push(...kindOverflow);
      }
      overflow.push(...plyOverflow);
      for (const [id, propagated] of merged) {
        if (boosted.has(id)) continue;
        const s = byId.get(id);
        if (!s) continue;
        s.score += Math.min(propagated * BEAM_PROX_FRAC, s.score * BEAM_PROX_CAP_FRAC);
        boosted.add(id);
      }
      beam = [...merged.entries()];
      if (!beam.length && overflow.length) {
        beam = overflow.splice(0, BEAM_OVERFLOW_CAP).filter(([id]) => !boosted.has(id));
      }
    }
  }
  function spiralExpand(graph, scored = [], {
    depth = SPIRAL_DEPTH_DEFAULT,
    q = SPIRAL_Q_DEFAULT,
    nodeLimit = SPIRAL_NODE_LIMIT_DEFAULT,
    kinds = SPIRAL_EXPAND_KINDS,
    classPredicate = (ind) => (ind.class || "") === "Module",
    idNormalizer = null,
    seeds: seedsOpt = null,
    hubDegree = Infinity
  } = {}) {
    const byId = new Map(scored.map((s) => [s.ind.id, s]));
    let maxSeed = 0;
    for (const s of scored) maxSeed = Math.max(maxSeed, s.score);
    const nudgeActive = scored.length > 0 && maxSeed > 0;
    const seeds = new Set(seedsOpt != null ? seedsOpt : byId.keys());
    if (!seeds.size) return [];
    const adj = adjacencyForKinds(graph, kinds, idNormalizer);
    const degree = (id) => adj.get(id)?.size || 0;
    const heap = [];
    const less = (a, b) => a.hop !== b.hop ? a.hop < b.hop : a.deg !== b.deg ? a.deg < b.deg : a.id < b.id;
    const swap = (i, j) => {
      const t = heap[i];
      heap[i] = heap[j];
      heap[j] = t;
    };
    const push = (node) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = i - 1 >> 1;
        if (less(heap[i], heap[p])) {
          swap(i, p);
          i = p;
        } else break;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (; ; ) {
          const l = 2 * i + 1, r = 2 * i + 2;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    };
    const visited = new Set(seeds);
    for (const id of seeds) push({ id, hop: 0, deg: degree(id) });
    let defIdx = null;
    let emitted = 0;
    const results = [];
    while (heap.length && emitted < nodeLimit) {
      const node = pop();
      results.push({ id: node.id, hop: node.hop });
      if (!seeds.has(node.id)) {
        if (nudgeActive) {
          const emitScore = maxSeed * SPIRAL_EMIT_FRAC * Math.pow(SPIRAL_HOP_DECAY, node.hop - 1);
          const existing = byId.get(node.id);
          if (existing) {
            existing.score += Math.min(emitScore * SPIRAL_PROX_FRAC, existing.score * SPIRAL_PROX_CAP_FRAC);
          } else {
            const ind = graph.byId?.get?.(node.id);
            if (ind && classPredicate(ind)) {
              if (!defIdx) defIdx = definesIndex(graph);
              const defines = defIdx.get(ind.id) || [];
              const entry = { ind, score: emitScore, defineCount: defines.length, matching: [], density: 0 };
              scored.push(entry);
              byId.set(node.id, entry);
            }
          }
        }
        emitted++;
      }
      if (node.hop >= depth) continue;
      if (node.hop > 0 && degree(node.id) > hubDegree) continue;
      const cands = [];
      for (const nid of adj.get(node.id) || []) {
        if (visited.has(nid)) continue;
        const ind = graph.byId?.get?.(nid);
        if (!ind || !classPredicate(ind)) continue;
        cands.push({ id: nid, deg: degree(nid) });
      }
      if (!cands.length) continue;
      cands.sort((a, b) => a.deg - b.deg || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const keep = Math.max(1, Math.floor(q * cands.length));
      for (let i = 0; i < keep; i++) {
        const c = cands[i];
        visited.add(c.id);
        push({ id: c.id, hop: node.hop + 1, deg: c.deg });
      }
    }
    return results;
  }
  function scoreModules(graph, tokens, opts = {}) {
    const { demoteNonProd = false, callAdjacency = false, implOfInterface = false, beamSearch = false, spiral = false, proseBoost = false, proseLayers = false, literalMention = false, rawQuery = "" } = opts;
    const beamWidth = Number.isFinite(opts.beamWidth) && opts.beamWidth > 0 ? opts.beamWidth : 8;
    const defIdx = definesIndex(graph);
    const modules = [];
    for (const ind of graph.individuals) {
      if ((ind.class || "") !== "Module") continue;
      const label = String(ind.label);
      const labelLc = label.toLowerCase();
      const defines = defIdx.get(ind.id) || [];
      const symSet = new Set(defines.map((d) => d.toLowerCase()));
      const symComps = /* @__PURE__ */ new Set();
      for (const d of defines) for (const c of identComponents(d)) symComps.add(c);
      const dotted = literalMention ? String((ind.attributes || []).find((a) => a.key === "dotted")?.value || "").toLowerCase() : "";
      modules.push({ ind, label, labelLc, defines, symSet, symComps, dotted });
    }
    const N = modules.length || 1;
    const idf = /* @__PURE__ */ new Map();
    for (const t of tokens) {
      if (idf.has(t)) continue;
      let df = 0;
      for (const m of modules) if (m.labelLc.includes(t) || m.symComps.has(t) || m.symSet.has(t)) df++;
      idf.set(t, Math.log(1 + N / (1 + df)));
    }
    const scored = [];
    for (const m of modules) {
      let exactScore = 0, pathScore = 0, matchCount = 0;
      const compWeights = [];
      for (const t of tokens) {
        const w = idf.get(t) || 0;
        if (!w) continue;
        if (m.symSet.has(t)) {
          exactScore += w * EXACT_W;
          matchCount++;
        } else if (m.symComps.has(t)) {
          compWeights.push(w);
          matchCount++;
        }
        if (m.labelLc.includes(t)) pathScore += w * PATH_W;
      }
      compWeights.sort((a, b) => b - a);
      let symScore = 0;
      for (let i = 0; i < Math.min(compWeights.length, SYM_MATCH_CAP); i++) symScore += compWeights[i] * SYM_W;
      let score = exactScore + pathScore + symScore;
      if (!score) continue;
      if (demoteNonProd && (isTestLabel(m.labelLc) || isNonProdLabel(m.labelLc))) score *= NONPROD_DEMOTE;
      else if (isTestLabel(m.labelLc)) score *= 0.4;
      const matching = m.defines.filter((d) => {
        const dl = d.toLowerCase();
        const cs = identComponents(d);
        return tokens.some((t) => dl === t || cs.has(t));
      });
      const density = m.defines.length ? matchCount / m.defines.length : 0;
      scored.push({ ind: m.ind, score, defineCount: m.defines.length, matching, density });
    }
    if (literalMention && rawQuery && scored.length) {
      const rawLc = String(rawQuery).toLowerCase();
      const continues = (ch) => ch != null && /[a-z0-9_./]/.test(ch);
      const mentioned = (cand) => {
        for (let i = rawLc.indexOf(cand); i !== -1; i = rawLc.indexOf(cand, i + 1)) {
          if (!continues(rawLc[i - 1]) && !continues(rawLc[i + cand.length])) return true;
        }
        return false;
      };
      const idfOf = (t) => {
        if (!idf.has(t)) {
          let df = 0;
          for (const m of modules) if (m.labelLc.includes(t) || m.symComps.has(t) || m.symSet.has(t)) df++;
          idf.set(t, Math.log(1 + N / (1 + df)));
        }
        return idf.get(t);
      };
      const byModId = new Map(modules.map((m) => [m.ind.id, m]));
      let maxBase = 0;
      for (const s of scored) maxBase = Math.max(maxBase, s.score);
      for (const s of scored) {
        const m = byModId.get(s.ind.id);
        if (!m) continue;
        let litWeight = 0;
        for (const cand of /* @__PURE__ */ new Set([m.dotted, m.labelLc])) {
          if (!cand) continue;
          if (cand.split(/[./]+/).filter(Boolean).length < LIT_MIN_COMPONENTS) continue;
          if (!mentioned(cand)) continue;
          const weights = [...new Set(cand.split(/[^a-z0-9_]+/).filter(Boolean))].map(idfOf).sort((a, b) => b - a);
          let w = 0;
          for (let i = 0; i < Math.min(weights.length, LIT_COMP_CAP); i++) w += weights[i] * LIT_W;
          litWeight = Math.max(litWeight, w);
        }
        if (litWeight) s.score += Math.min(litWeight * LIT_FRAC, maxBase * LIT_CAP_FRAC);
      }
    }
    if (scored.length > 1) {
      const baseById = new Map(scored.map((s) => [s.ind.id, s.score]));
      const adj = /* @__PURE__ */ new Map();
      for (const e of edgesOfKind(graph, "imports")) {
        if (!baseById.has(e.subject) && !baseById.has(e.object)) continue;
        if (!adj.has(e.subject)) adj.set(e.subject, /* @__PURE__ */ new Set());
        if (!adj.has(e.object)) adj.set(e.object, /* @__PURE__ */ new Set());
        adj.get(e.subject).add(e.object);
        adj.get(e.object).add(e.subject);
      }
      for (const s of scored) {
        let bestNeighbor = 0;
        for (const nid of adj.get(s.ind.id) || []) bestNeighbor = Math.max(bestNeighbor, baseById.get(nid) || 0);
        s.score += Math.min(bestNeighbor * PROX_FRAC, s.score * PROX_CAP_FRAC);
      }
    }
    if (callAdjacency && scored.length > 1) {
      const baseById = new Map(scored.map((s) => [s.ind.id, s.score]));
      const adj = /* @__PURE__ */ new Map();
      for (const kind of ["calls", "callsSymbol"]) {
        for (const e of edgesOfKind(graph, kind)) {
          const sm = moduleIdOfId(graph, e.subject);
          const om = moduleIdOfId(graph, e.object);
          if (!sm || !om || sm === om) continue;
          if (!baseById.has(sm) && !baseById.has(om)) continue;
          if (!adj.has(sm)) adj.set(sm, /* @__PURE__ */ new Set());
          if (!adj.has(om)) adj.set(om, /* @__PURE__ */ new Set());
          adj.get(sm).add(om);
          adj.get(om).add(sm);
        }
      }
      for (const s of scored) {
        let bestNeighbor = 0;
        for (const nid of adj.get(s.ind.id) || []) bestNeighbor = Math.max(bestNeighbor, baseById.get(nid) || 0);
        s.score += Math.min(bestNeighbor * CALL_PROX_FRAC, s.score * CALL_PROX_CAP_FRAC);
      }
    }
    if (implOfInterface && scored.length > 1) {
      const baseById = new Map(scored.map((s) => [s.ind.id, s.score]));
      const classByLabel = /* @__PURE__ */ new Map();
      for (const ind of graph.individuals) {
        if ((ind.class || "") === "Class" && ind.label) classByLabel.set(String(ind.label), ind);
      }
      for (const s of scored) {
        if (!isCsModuleLabel(s.ind.label)) continue;
        let bestNeighbor = 0;
        for (const e of edgesOfKind(graph, "inherits")) {
          const subjModId = moduleIdOfId(graph, e.subject);
          if (subjModId !== s.ind.id) continue;
          if (!looksLikeCsInterface(e.objectLabel)) continue;
          let ifaceModId = moduleIdOfId(graph, e.object);
          if (!ifaceModId) {
            const ifaceInd = classByLabel.get(String(e.objectLabel || ""));
            if (ifaceInd) ifaceModId = moduleIdOf(graph, ifaceInd);
          }
          if (ifaceModId) bestNeighbor = Math.max(bestNeighbor, baseById.get(ifaceModId) || 0);
        }
        s.score += Math.min(bestNeighbor * IMPL_PROX_FRAC, s.score * IMPL_PROX_CAP_FRAC);
      }
    }
    if (proseBoost && scored.length && graph.proseIndex) {
      const proseHits = lookupByProseTokens(graph.proseIndex, tokens.join(" "), { limit: PROSE_LOOKUP_LIMIT });
      if (proseHits.length) {
        const proseByModule = /* @__PURE__ */ new Map();
        for (const { id, score } of proseHits) {
          const modId = moduleIdOfId(graph, id);
          if (!modId) continue;
          proseByModule.set(modId, (proseByModule.get(modId) || 0) + score);
        }
        for (const s of scored) {
          const signal = proseByModule.get(s.ind.id) || 0;
          if (!signal) continue;
          s.score += Math.min(signal * PROSE_PROX_FRAC, s.score * PROSE_PROX_CAP_FRAC);
        }
      }
    }
    if (proseLayers && scored.length && graph.proseIndex) {
      const scoredById = new Map(scored.map((s) => [s.ind.id, s]));
      const modById = new Map(modules.map((m) => [m.ind.id, m]));
      const layerSignal = /* @__PURE__ */ new Map();
      for (const t of new Set(tokens)) {
        const w = idf.get(t) || 0;
        if (!w) continue;
        const { ids } = proseLayerHits(graph.proseIndex, t);
        if (!ids.length) continue;
        const hitMods = /* @__PURE__ */ new Set();
        for (const id of ids) {
          const modId = moduleIdOfId(graph, id);
          if (!modId || hitMods.has(modId)) continue;
          hitMods.add(modId);
          if (!scoredById.has(modId)) continue;
          const m = modById.get(modId);
          if (m && (m.symSet.has(t) || m.symComps.has(t) || m.labelLc.includes(t))) continue;
          layerSignal.set(modId, (layerSignal.get(modId) || 0) + w * PROSE_LAYER_DISCOUNT);
        }
      }
      for (const s of scored) {
        const signal = layerSignal.get(s.ind.id) || 0;
        if (!signal) continue;
        s.score += Math.min(signal * PROSE_LAYER_FRAC, s.score * PROSE_LAYER_CAP_FRAC);
      }
    }
    if (beamSearch && scored.length > 1) beamExpand(graph, scored, beamWidth);
    if (spiral && scored.length) spiralExpand(graph, scored, {
      depth: Number.isFinite(opts.spiralDepth) && opts.spiralDepth > 0 ? opts.spiralDepth : SPIRAL_DEPTH_DEFAULT,
      q: Number.isFinite(opts.mostDistinctiveBeams) && opts.mostDistinctiveBeams > 0 ? opts.mostDistinctiveBeams : SPIRAL_Q_DEFAULT,
      nodeLimit: Number.isFinite(opts.spiralNodeLimit) && opts.spiralNodeLimit > 0 ? opts.spiralNodeLimit : SPIRAL_NODE_LIMIT_DEFAULT
    });
    scored.sort((a, b) => b.score - a.score || b.density - a.density || a.defineCount - b.defineCount || String(a.ind.label).length - String(b.ind.label).length);
    return scored;
  }
  function searchModulesRanked(graph, query, opts = {}) {
    const raw = String(query || "");
    const tokens = raw.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    if (!tokens.length) return [];
    const effOpts = opts.literalMention ? { ...opts, rawQuery: raw } : opts;
    return scoreModules(graph, tokens, effOpts).map((s) => ({ path: String(s.ind.label), score: s.score }));
  }
  function renderSearch(graph, query, { limit = SEARCH_LIMIT, kind = "", decorator = "", name = "" } = {}) {
    const tokens = String(query || "").toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    const wantKind = String(kind || "").trim().toLowerCase();
    const decFilter = String(decorator || "").trim().toLowerCase();
    let nameRe = null;
    if (name) {
      try {
        nameRe = new RegExp(name, "i");
      } catch {
        return `invalid name pattern: ${name}`;
      }
    }
    if (wantKind && wantKind !== "module") {
      return searchSymbols(graph, tokens, { limit, kind: wantKind, decFilter, nameRe });
    }
    if (!tokens.length && !nameRe && !decFilter) return "empty query";
    const scored = scoreModules(graph, tokens);
    if (!scored.length) {
      return `no module matches "${query}". Try broader keywords, or tmct_describe <path> if you know where it lives.`;
    }
    const hits = scored.slice(0, limit);
    const lines = [`${scored.length} module(s) match "${query}" (top ${hits.length}):`];
    for (const { ind, defineCount, matching } of hits) {
      const m = matching.length ? ` \u2014 matching: ${capJoin([...new Set(matching)], SEARCH_SYMBOLS_SHOWN)}` : "";
      lines.push(`- ${ind.label} (defines ${defineCount} symbol(s))${m}`);
    }
    lines.push("Then tmct_describe <path> for the full sibling list + typed edges, or tmct_impact <path> for dependents.");
    return lines.join("\n");
  }
  function edgesOfKind(graph, kind) {
    let byKind = edgesOfKindCache.get(graph);
    if (!byKind) {
      byKind = /* @__PURE__ */ new Map();
      edgesOfKindCache.set(graph, byKind);
    }
    const cached3 = byKind.get(kind);
    if (cached3) return cached3;
    const out = [];
    for (const g of graph.relations) {
      if (relationKind(g) !== kind) continue;
      for (const e of g.edges) out.push(e);
    }
    byKind.set(kind, out);
    return out;
  }
  function moduleIdOfId(graph, id) {
    const ind = graph.byId?.get?.(id);
    if (ind) return moduleIdOf(graph, ind);
    const m = String(id || "").match(/^fn:(.+)#/);
    return m ? `mod:${m[1]}` : null;
  }
  function moduleIdOf(graph, ind) {
    if ((ind?.class || "") === "Module") return ind.id;
    const site = siteOf(ind);
    if (site) return `mod:${site.path}`;
    const m = String(ind?.id || "").match(/^fn:(.+)#/);
    return m ? `mod:${m[1]}` : null;
  }
  function spanTag(site) {
    if (!site) return "";
    const s = site.end > site.start ? `${site.start}-${site.end}` : `${site.start}`;
    return ` [${site.path}:${s}]`;
  }
  function decoratorOf(ind) {
    return (ind?.attributes || []).find((a) => a.key === "decorators")?.value || "";
  }
  function renderMembers(graph, ind) {
    const lines = [`${ind.label} \u2014 ${classHeading(ind.class)} (id: ${ind.id})`];
    const contains = edgesOfKind(graph, "contains").filter((e) => e.subject === ind.id);
    if (!contains.length) {
      lines.push("members: none recorded (empty class, or members not in the extracted graph). Use tmct_describe for its edges.");
      return lines.join("\n");
    }
    const methods = [];
    const attrs = [];
    for (const e of contains) {
      const member = graph.byId.get(e.object);
      const where = spanTag(member ? siteOf(member) : null);
      const dec = member ? decoratorOf(member) : "";
      const entry = `${e.objectLabel || e.object}${where}${dec ? ` @${dec}` : ""}`;
      ((member?.class || "") === "Attribute" ? attrs : methods).push(entry);
    }
    if (methods.length) lines.push(`methods (${methods.length}): ${capJoin(methods, MEMBERS_CAP)}`);
    if (attrs.length) lines.push(`attributes (${attrs.length}): ${capJoin(attrs, MEMBERS_CAP)}`);
    lines.push("Use tmct_snippet <Class.member> for an exact body.");
    return lines.join("\n");
  }
  function renderSignature(graph, ind) {
    const site = siteOf(ind);
    const lines = [`${ind.label} \u2014 ${classHeading(ind.class)}${spanTag(site)}`];
    const params = attrVal(ind, "params");
    const returns = attrVal(ind, "returns");
    if (params || returns || (ind.class || "") === "Method" || (ind.class || "") === "Function") {
      lines.push(`signature: ${ind.label}(${params})${returns ? ` -> ${returns}` : ""}`);
    }
    const flags = [];
    if (attrVal(ind, "isStatic")) flags.push("static");
    if (attrVal(ind, "isAbstract")) flags.push("abstract");
    if (attrVal(ind, "isConstant")) flags.push("constant");
    const vis = attrVal(ind, "visibility");
    if (vis) flags.push(vis);
    if (flags.length) lines.push(`flags: ${flags.join(", ")}`);
    const dec = decoratorOf(ind);
    if (dec) lines.push(`decorators: @${dec.split(", ").join(", @")}`);
    const raises = attrVal(ind, "raises");
    if (raises) lines.push(`raises: ${raises}`);
    const catches = attrVal(ind, "catches");
    if (catches) lines.push(`catches: ${catches}`);
    const fields = attrVal(ind, "self_fields");
    if (fields) lines.push(`self fields: ${fields}`);
    const value = attrVal(ind, "value");
    if (value) lines.push(`value: ${value}`);
    const doc = attrVal(ind, "doc");
    if (doc) lines.push(`doc: ${doc}`);
    if (lines.length === 1) lines.push("(no signature detail recorded for this symbol \u2014 likely a module or attribute; use tmct_snippet for its source.)");
    lines.push("Use tmct_snippet for the exact body.");
    return lines.join("\n");
  }
  function renderSubclasses(graph, ind) {
    const inherits = edgesOfKind(graph, "inherits");
    const bases = inherits.filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object);
    const childrenOf = /* @__PURE__ */ new Map();
    for (const e of inherits) {
      if (!childrenOf.has(e.object)) childrenOf.set(e.object, []);
      childrenOf.get(e.object).push({ id: e.subject, label: e.subjectLabel || e.subject });
    }
    const lines = [`${ind.label} \u2014 ${classHeading(ind.class)} (id: ${ind.id})`];
    lines.push(bases.length ? `extends: ${capJoin(bases, SUBCLASS_CAP)}` : "extends: (no internal/recorded base classes)");
    const visited = /* @__PURE__ */ new Set([ind.id]);
    const levels = [];
    let frontier = [ind.id];
    for (let depth = 1; depth <= 8 && frontier.length; depth += 1) {
      const next = [];
      const level = [];
      for (const id of frontier) {
        for (const c of childrenOf.get(id) || []) {
          if (visited.has(c.id)) continue;
          visited.add(c.id);
          level.push(c.label);
          next.push(c.id);
        }
      }
      if (level.length) {
        level.sort((a, b) => String(a).localeCompare(String(b)));
        levels.push(level);
      }
      frontier = next;
    }
    const total = levels.reduce((n, l) => n + l.length, 0);
    if (!total) {
      lines.push("subclasses: none recorded \u2014 nothing extends it in the extracted graph.");
    } else {
      lines.push(`subclasses: ${total} total across ${levels.length} level(s).`);
      levels.forEach((l, i) => lines.push(`  depth ${i + 1} (${l.length}): ${capJoin(l, SUBCLASS_CAP)}`));
    }
    return lines.join("\n");
  }
  function renderArchitecture(graph, { pkg = "" } = {}) {
    const norm = normPath(pkg);
    const modules = graph.individuals.filter(
      (i) => (i.class || "") === "Module" && (!norm || normPath(i.label).startsWith(norm))
    );
    if (!modules.length) return norm ? `no modules under "${pkg}".` : "no modules in the graph.";
    const pkgCount = /* @__PURE__ */ new Map();
    for (const m of modules) {
      const dir = m.label.includes("/") ? m.label.slice(0, m.label.lastIndexOf("/")) : "(root)";
      pkgCount.set(dir, (pkgCount.get(dir) || 0) + 1);
    }
    const inDeg = /* @__PURE__ */ new Map();
    for (const e of edgesOfKind(graph, "imports")) inDeg.set(e.object, (inDeg.get(e.object) || 0) + 1);
    const modSet = new Set(modules.map((m) => m.id));
    const hubs = [...inDeg.entries()].filter(([id]) => modSet.has(id)).sort((a, b) => b[1] - a[1]).slice(0, ARCH_HUB_CAP).map(([id, n]) => `${graph.byId.get(id)?.label || id} (${n} importers)`);
    const pkgs = [...pkgCount.entries()].sort((a, b) => b[1] - a[1]);
    const lines = [`Architecture${norm ? ` of ${pkg}` : ""}: ${modules.length} module(s) in ${pkgs.length} package(s).`];
    lines.push(`packages (by module count): ${capJoin(pkgs.map(([d, n]) => `${d} (${n})`), ARCH_PKG_CAP)}`);
    lines.push(hubs.length ? `hub modules (most imported): ${hubs.join(", ")}` : "hub modules: none (no internal imports recorded).");
    return lines.join("\n");
  }
  function renderTestsFor(graph, ind) {
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || siteOf(ind)?.path || modId;
    const tests = [...new Set(edgesOfKind(graph, "tests").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))];
    const covered = tests.length > 0;
    const verdict = covered ? `covered by ${tests.length} test module(s):
  ${capJoin(tests, COVERAGE_CAP, "\n  ")}` : "no covering tests recorded (no test module imports it).";
    if (modId === ind.id) return `${modLabel}: ${verdict}`;
    return `${ind.label} is defined in ${modLabel}, which ${covered ? "is" : "has"} ${verdict}
${TESTS_GRAIN_NOTE}`;
  }
  function renderUntested(graph) {
    const covered = /* @__PURE__ */ new Set();
    const testModules = /* @__PURE__ */ new Set();
    for (const e of edgesOfKind(graph, "tests")) {
      covered.add(e.object);
      testModules.add(e.subject);
    }
    const untested = graph.individuals.filter(
      (i) => (i.class || "") === "Module" && !testModules.has(i.id) && !isTestLabel(String(i.label).toLowerCase()) && !covered.has(i.id)
    ).map((i) => i.label).sort();
    if (!untested.length) return "every source module has at least one covering test module.";
    return `${untested.length} source module(s) with no covering test module:
  ${capJoin(untested, COVERAGE_CAP, "\n  ")}`;
  }
  function renderHistory(graph, ind) {
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || modId;
    const commits = edgesOfKind(graph, "touches").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject);
    if (!commits.length) return `${modLabel}: no commit history recorded (outside the git-log window or unmodified).`;
    return `${modLabel}: touched by ${commits.length} recent commit(s): ${capJoin(commits, HISTORY_CAP)}`;
  }
  function renderCallers(graph, ind) {
    if (CALL_SYMBOL_CLASSES.has(ind.class)) {
      const callers2 = [...new Set(edgesOfKind(graph, "callsSymbol").filter((e) => e.object === ind.id).map((e) => e.subjectLabel || e.subject))];
      if (!callers2.length) return `${ind.label}: no recorded callers (fine-grained call edges are conservative \u2014 absence is not proof). Try tmct_impact for the full reverse closure.`;
      return `${ind.label} \u2014 called by ${callers2.length} symbol(s):
  ${capJoin(callers2, CALL_CAP, "\n  ")}`;
    }
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || modId;
    const callers = [...new Set(edgesOfKind(graph, "calls").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))];
    if (!callers.length) return `${modLabel}: no recorded callers (calls are coarse/import-backed \u2014 absence is not proof). Try tmct_impact for the full reverse closure.`;
    return `${modLabel} \u2014 called by ${callers.length} module(s):
  ${capJoin(callers, CALL_CAP, "\n  ")}`;
  }
  function renderCallees(graph, ind) {
    if (CALL_SYMBOL_CLASSES.has(ind.class)) {
      const callees2 = [...new Set(edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object))];
      if (!callees2.length) return `${ind.label}: no recorded callees (calls only stdlib/external, or fine-grained call edges are not in the extracted graph).`;
      return `${ind.label} \u2014 calls into ${callees2.length} symbol(s):
  ${capJoin(callees2, CALL_CAP, "\n  ")}`;
    }
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || modId;
    const callees = [...new Set(edgesOfKind(graph, "calls").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object))];
    if (!callees.length) return `${modLabel}: no recorded callees.`;
    return `${modLabel} \u2014 calls into ${callees.length} module(s):
  ${capJoin(callees, CALL_CAP, "\n  ")}`;
  }
  function calleeRef(graph, e) {
    const callee = graph.byId.get(e.object);
    const cs = callee ? siteOf(callee) : null;
    return `${e.objectLabel || callee?.label || e.object}${cs ? ` [${cs.path}:${cs.start}]` : ""}`;
  }
  function callHint(graph, ind) {
    if (!ind?.id) return "";
    const calls = edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id);
    if (!calls.length) return "";
    return `calls in-repo: ${capJoin(calls.map((e) => calleeRef(graph, e)), CALL_HINT_CAP)}`;
  }
  function renderCalls(graph, ind) {
    const calls = edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id);
    if (!calls.length) {
      return `${ind.label} \u2014 ${classHeading(ind.class)}: no in-repo calls recorded (calls only stdlib/external, or fine-grained call edges are not in the extracted graph).`;
    }
    const items = calls.map((e) => calleeRef(graph, e));
    return `${ind.label} \u2014 ${classHeading(ind.class)} calls ${calls.length} in-repo symbol(s):
  ${capJoin(items, CALL_CAP, "\n  ")}`;
  }
  function commitLine(graph, commitId, fallbackLabel) {
    const c = graph.byId.get(commitId);
    const sha = c?.label || fallbackLabel || commitId;
    const date = attrVal(c, "commitDate") || attrVal(c, "date");
    const author = attrVal(c, "commitAuthor") || attrVal(c, "author");
    const msg = attrVal(c, "commitMessage") || attrVal(c, "message");
    const head = [sha, date, author].filter(Boolean).join(" ");
    return msg ? `${head} \u2014 ${msg}` : head;
  }
  function renderFileHistory(graph, ind) {
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || modId;
    const commits = edgesOfKind(graph, "touches").filter((e) => e.object === modId);
    if (!commits.length) return `${modLabel}: no commit history recorded (outside the git-log window or unmodified).`;
    const shown = commits.slice(0, HISTORY_CAP).map((e) => `  ${commitLine(graph, e.subject, e.subjectLabel)}`);
    const tail = commits.length > HISTORY_CAP ? `
  \u2026+${commits.length - HISTORY_CAP} more` : "";
    return `${modLabel}: touched by ${commits.length} recent commit(s):
${shown.join("\n")}${tail}`;
  }
  function renderSymbolHistory(graph, ind) {
    const commits = edgesOfKind(graph, "touchesSymbol").filter((e) => e.object === ind.id);
    if (!commits.length) {
      return `${ind.label} \u2014 ${classHeading(ind.class)}: no symbol-level commit history recorded (outside the git-log window, or fine-grained history is not in the extracted graph).`;
    }
    const shown = commits.slice(0, HISTORY_CAP).map((e) => `  ${commitLine(graph, e.subject, e.subjectLabel)}`);
    const tail = commits.length > HISTORY_CAP ? `
  \u2026+${commits.length - HISTORY_CAP} more` : "";
    return `${ind.label} \u2014 ${classHeading(ind.class)}: touched by ${commits.length} commit(s):
${shown.join("\n")}${tail}`;
  }
  function renderMethodHistory(graph, ind) {
    return renderSymbolHistory(graph, ind);
  }
  function renderClassHistory(graph, ind) {
    return renderSymbolHistory(graph, ind);
  }
  function scoreSymbolsRanked(graph, tokens, { kind, decFilter = "", nameRe = null } = {}) {
    const targetClass = SYMBOL_CLASSES[kind];
    if (!targetClass) return [];
    const hits = [];
    for (const ind of graph.individuals) {
      if ((ind.class || "") !== targetClass) continue;
      if (nameRe && !nameRe.test(ind.label)) continue;
      if (decFilter && !decoratorOf(ind).toLowerCase().includes(decFilter)) continue;
      const label = String(ind.label).toLowerCase();
      let score = tokens.length ? 0 : 1;
      for (const t of tokens) if (label.includes(t)) score += 5;
      if (tokens.length && !score) continue;
      hits.push({ ind, score });
    }
    hits.sort((a, b) => b.score - a.score || String(a.ind.label).length - String(b.ind.label).length);
    return hits;
  }
  function searchSymbols(graph, tokens, { limit = SEARCH_LIMIT, kind, decFilter, nameRe }) {
    const targetClass = SYMBOL_CLASSES[kind];
    if (!targetClass) return `unknown kind "${kind}" (use function, class, method, attribute, or module).`;
    const hits = scoreSymbolsRanked(graph, tokens, { kind, decFilter, nameRe });
    if (!hits.length) return `no ${kind} matches the given filters.`;
    const top = hits.slice(0, limit);
    const lines = [`${hits.length} ${kind}(s) match (top ${top.length}):`];
    for (const { ind } of top) lines.push(`- ${ind.label}${spanTag(siteOf(ind))}`);
    lines.push("Then tmct_snippet <name> for the exact body, or tmct_describe for its edges.");
    return lines.join("\n");
  }
  function profileOf(x) {
    return {
      paramCount: countParams(x?.params),
      hasReturns: Boolean(x?.returns),
      hasRaises: Boolean(x?.raises),
      callees: x?.callees instanceof Set ? x.callees : /* @__PURE__ */ new Set()
    };
  }
  function dominantProfile(siblings) {
    if (!siblings.length) return { paramCount: 0, hasReturns: false, hasRaises: false, callees: /* @__PURE__ */ new Set() };
    const counts = siblings.map((s) => countParams(s.params));
    const retYes = siblings.filter((s) => Boolean(s.returns)).length;
    const raiseYes = siblings.filter((s) => Boolean(s.raises)).length;
    const calleeFreq = /* @__PURE__ */ new Map();
    for (const s of siblings) for (const c of s.callees || []) calleeFreq.set(c, (calleeFreq.get(c) || 0) + 1);
    const common = new Set([...calleeFreq.entries()].filter(([, n]) => n >= 2).map(([c]) => c));
    return {
      paramCount: modeOf(counts),
      hasReturns: retYes * 2 >= siblings.length,
      hasRaises: raiseYes * 2 >= siblings.length,
      callees: common
    };
  }
  function structuralScore(s, target) {
    if (!target) return 0;
    let score = Math.max(0, 4 - Math.abs(countParams(s.params) - target.paramCount));
    if (Boolean(s.returns) === target.hasReturns) score += 2;
    if (Boolean(s.raises) === target.hasRaises) score += 2;
    const shared = [...s.callees || []].filter((c) => target.callees.has(c)).length;
    return score + Math.min(shared, 4) * 2;
  }
  function rankSiblings(siblings, { decorators: anchorDecorators = "", label: anchorLabel = "", site: anchorSite = null } = {}, structuralTarget = null) {
    const decCount = /* @__PURE__ */ new Map();
    for (const s of siblings) for (const d of splitDecs(s.decorators)) decCount.set(d, (decCount.get(d) || 0) + 1);
    let dominant = "";
    let bestCount = 1;
    for (const [d, c] of decCount) if (c > bestCount) {
      bestCount = c;
      dominant = d;
    }
    const anchorDecs = new Set(splitDecs(anchorDecorators));
    const targetDecs = anchorDecs.size ? anchorDecs : new Set(dominant ? [dominant] : []);
    const anchorTokens = new Set(tokenize(anchorLabel));
    const anchorStart = anchorSite?.start ?? null;
    for (const s of siblings) {
      const decMatch = splitDecs(s.decorators).some((d) => targetDecs.has(d)) ? 1 : 0;
      const nameAff = tokenize(s.label).filter((t) => anchorTokens.has(t)).length;
      const struct = structuralScore(s, structuralTarget);
      const pos = anchorStart != null && s.site ? 1 / (1 + Math.abs(s.site.start - anchorStart)) : 0;
      s._score = decMatch * 1e3 + nameAff * 50 + struct + pos;
    }
    return [...siblings].sort((a, b) => b._score - a._score || (a.site?.start || 0) - (b.site?.start || 0));
  }
  function contextPlan(graph, ind) {
    const modId = moduleIdOf(graph, ind);
    const moduleLabel = graph.byId.get(modId)?.label || String(modId || "").replace(/^mod:/, "");
    const defEdges = edgesOfKind(graph, "defines").filter((e) => e.subject === modId);
    const calleeMap = /* @__PURE__ */ new Map();
    for (const e of edgesOfKind(graph, "callsSymbol")) {
      if (!calleeMap.has(e.subject)) calleeMap.set(e.subject, /* @__PURE__ */ new Set());
      calleeMap.get(e.subject).add(e.object);
    }
    let siblings = [];
    const globals = [];
    let insertion = 0;
    for (const e of defEdges) {
      const mem = graph.byId.get(e.object);
      if (!mem) continue;
      const cls = mem.class || "";
      const site = siteOf(mem);
      if (cls === "GlobalVariable") {
        globals.push({ label: mem.label, value: (mem.attributes || []).find((a) => a.key === "value")?.value || "", site });
        if (site) insertion = Math.max(insertion, site.end);
      } else if (cls === "Function" || cls === "Class") {
        siblings.push({
          id: mem.id,
          label: mem.label,
          class: cls,
          site,
          decorators: decoratorOf(mem),
          raises: attrVal(mem, "raises"),
          doc: attrVal(mem, "doc"),
          params: attrVal(mem, "params"),
          returns: attrVal(mem, "returns"),
          callees: calleeMap.get(mem.id) || /* @__PURE__ */ new Set()
        });
        if (site) insertion = Math.max(insertion, site.end);
      }
    }
    const anchorSite = siteOf(ind);
    const anchor = anchorSite && (ind.class || "") !== "Module" ? {
      id: ind.id,
      label: ind.label,
      class: ind.class || "",
      site: anchorSite,
      decorators: decoratorOf(ind),
      raises: attrVal(ind, "raises"),
      params: attrVal(ind, "params"),
      returns: attrVal(ind, "returns"),
      callees: calleeMap.get(ind.id) || /* @__PURE__ */ new Set()
    } : null;
    const totalSiblings = siblings.length;
    const structuralTarget = anchor ? profileOf(anchor) : dominantProfile(siblings);
    siblings = rankSiblings(siblings, anchor || { label: ind.label }, structuralTarget);
    const exemplar = !anchor ? siblings.find((s) => s.site && s.label !== ind.label) || null : null;
    const tests = [...new Set(edgesOfKind(graph, "tests").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject))].slice(0, CONTEXT_TESTS_CAP);
    const cochange = cochangeNeighbours(graph, modId).slice(0, COCHANGE_MID_CAP);
    const exports = edgesOfKind(graph, "reexports").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object).slice(0, 20);
    const allExports = attrVal(graph.byId.get(modId), "all");
    const contains = edgesOfKind(graph, "contains");
    let classOwnerId = null;
    if ((ind.class || "") === "Class") classOwnerId = ind.id;
    else if ((ind.class || "") === "Method") classOwnerId = contains.find((e) => e.object === ind.id)?.subject || null;
    let classMembers = null;
    if (classOwnerId) {
      const owner = graph.byId.get(classOwnerId);
      const members = contains.filter((e) => e.subject === classOwnerId).map((e) => {
        const m = graph.byId.get(e.object);
        return {
          label: e.objectLabel || m?.label || e.object,
          class: m?.class || "",
          site: m ? siteOf(m) : null,
          decorators: m ? decoratorOf(m) : "",
          params: m ? attrVal(m, "params") : "",
          returns: m ? attrVal(m, "returns") : "",
          raises: m ? attrVal(m, "raises") : ""
        };
      }).slice(0, CLASS_MEMBER_CAP);
      classMembers = { className: owner?.label || String(classOwnerId).replace(/^fn:.*#/, ""), members, total: contains.filter((e) => e.subject === classOwnerId).length };
    }
    let lastTop = null;
    for (const s of [...siblings, ...globals]) {
      if (s.site && (!lastTop || s.site.start > lastTop.start)) lastTop = s.site;
    }
    const insertionRegion = lastTop ? { start: lastTop.start, end: lastTop.end } : null;
    const focal = anchor || exemplar;
    const focalInd = focal?.id ? graph.byId.get(focal.id) : null;
    const callHintStr = focalInd ? callHint(graph, focalInd) : "";
    let calleeBodies = [];
    if (focal?.callees) {
      for (const cid of focal.callees) {
        const c = graph.byId.get(cid);
        const cs = c ? siteOf(c) : null;
        if (cs) calleeBodies.push({ label: c.label, site: cs });
        if (calleeBodies.length >= INLINE_CALLEE_CAP) break;
      }
    }
    return {
      modId,
      moduleLabel,
      anchor,
      siblings,
      totalSiblings,
      exemplar,
      globals,
      tests,
      cochange,
      exports,
      allExports,
      classMembers,
      insertion,
      insertionRegion,
      calleeBodies,
      callHint: callHintStr,
      siblingCap: CONTEXT_SIBLING_CAP
    };
  }
  function bundleMask(tier) {
    const all = {
      anchor: true,
      exemplar: true,
      registration: true,
      insertionRegion: true,
      allExports: true,
      classMembers: true,
      siblings: true,
      reexports: true,
      tests: true,
      cochange: true,
      inlinedCallees: false
    };
    if (tier === "TINY") return { ...all, classMembers: false, siblings: false, reexports: false, tests: false, cochange: false };
    if (tier === "LARGE" || tier === "FULL") return { ...all, inlinedCallees: true };
    return all;
  }
  function trimBundleMask(mask) {
    return {
      ...mask,
      anchor: false,
      exemplar: false,
      inlinedCallees: false,
      classMembers: false,
      reexports: false,
      tests: false,
      cochange: false,
      registration: true,
      siblings: true,
      insertionRegion: true,
      allExports: true
    };
  }
  function sizeBundle(plan, graph, { untuned = false } = {}) {
    const focal = plan.anchor || plan.exemplar;
    let tier = "TINY";
    const hasExemplarBody = Boolean(plan.anchor && plan.anchor.site || plan.exemplar && plan.exemplar.site);
    if (!hasExemplarBody) tier = "MID";
    if (plan.classMembers && plan.classMembers.members && plan.classMembers.members.length) tier = "MID";
    if (focal) {
      const loc = focal.site ? focal.site.end - focal.site.start + 1 : Infinity;
      const arity = countParams(focal.params);
      if (loc > TINY_MAX_LOC || arity > TINY_MAX_ARITY || Boolean(focal.raises)) tier = "MID";
      let crossModule = false;
      if (plan.anchor) {
        for (const cid of focal.callees || []) {
          const c = graph.byId.get(cid);
          const cs = c ? siteOf(c) : null;
          if (cs && cs.path !== plan.moduleLabel) {
            crossModule = true;
            break;
          }
        }
      }
      const bigClassMethod = (plan.anchor?.class || "") === "Method" && Number(plan.classMembers?.total || plan.classMembers?.members?.length || 0) >= LARGE_CLASS_MEMBERS;
      if (crossModule || bigClassMethod) tier = "LARGE";
    } else {
      tier = "MID";
    }
    return { tier, mask: bundleMask(tier), topup: tier !== "TINY" };
  }
  function renderContextMore(plan) {
    const out = [`Additional context for ${plan.moduleLabel} (sections omitted from the lean bundle):`];
    if (plan.classMembers && plan.classMembers.members.length) {
      out.push(`
## members of ${plan.classMembers.className}:`);
      for (const m of plan.classMembers.members) {
        const short = String(m.label).split(".").pop();
        const sig = m.params != null && m.params !== "" ? `(${m.params})${m.returns ? ` -> ${m.returns}` : ""}` : "";
        const dec = m.decorators ? `@${m.decorators} ` : "";
        const r = m.raises ? `  raises=${m.raises}` : "";
        out.push(`  ${m.class} ${short}${m.site ? ` :${m.site.start}` : ""}  ${dec}${short}${sig}${r}`);
      }
    }
    if (plan.siblings.length) {
      out.push(`
## sibling symbols (most relevant first; ${plan.siblings.length} total):`);
      for (const s of plan.siblings.slice(0, plan.siblingCap)) {
        const dec = s.decorators ? `@${s.decorators} ` : "";
        const r = s.raises ? `  raises=${s.raises}` : "";
        out.push(`  ${s.class} ${s.label}${s.site ? ` :${s.site.start}` : ""}  ${dec}${r}`);
      }
      if (plan.siblings.length > plan.siblingCap) out.push(`  \u2026+${plan.siblings.length - plan.siblingCap} more`);
    }
    if (plan.allExports) out.push(`
## module __all__: ${plan.allExports}`);
    if (plan.exports && plan.exports.length) out.push(`
## re-exported symbols: ${plan.exports.join(", ")}`);
    if (plan.tests.length) out.push(`
## covering tests: ${plan.tests.join(", ")}`);
    if (plan.cochange && plan.cochange.length) {
      out.push(`
## usually changed together: ${plan.cochange.map((c) => `${c.label} (\xD7${c.weight})`).join(", ")}`);
    }
    if (out.length === 1) out.push("(no omitted sections \u2014 the lean bundle already contained everything for this symbol.)");
    return out.join("\n");
  }
  function renderGraphOnlyBundle(plan, mask) {
    const out = [
      `Edit context for ${plan.moduleLabel} (graph-only bundle \u2014 siblings/registration/tests are real graph truth; no source body without a source-capable provider).`
    ];
    if (mask.registration && plan.globals.length) {
      out.push(`
## registration / module globals (replicate this pattern):`);
      for (const g of plan.globals) out.push(`  ${g.label} = ${g.value}${g.site ? `  [:${g.site.start}]` : ""}`);
    }
    if (mask.classMembers && plan.classMembers && plan.classMembers.members.length) {
      out.push(`
## members of ${plan.classMembers.className}:`);
      for (const m of plan.classMembers.members) {
        const short = String(m.label).split(".").pop();
        const sig = m.params != null && m.params !== "" ? `(${m.params})${m.returns ? ` -> ${m.returns}` : ""}` : "";
        const dec = m.decorators ? `@${m.decorators} ` : "";
        const r = m.raises ? `  raises=${m.raises}` : "";
        out.push(`  ${m.class} ${short}${m.site ? ` :${m.site.start}` : ""}  ${dec}${short}${sig}${r}`);
      }
    }
    if (mask.siblings && plan.siblings.length) {
      out.push(`
## sibling symbols to copy the style of (most relevant first; ${plan.siblings.length} total):`);
      for (const s of plan.siblings.slice(0, plan.siblingCap)) {
        const dec = s.decorators ? `@${s.decorators} ` : "";
        const r = s.raises ? `  raises=${s.raises}` : "";
        out.push(`  ${s.class} ${s.label}${s.site ? ` :${s.site.start}` : ""}  ${dec}${r}`);
      }
      if (plan.siblings.length > plan.siblingCap) out.push(`  \u2026+${plan.siblings.length - plan.siblingCap} more`);
    }
    if (mask.allExports && plan.allExports) out.push(`
## module __all__: ${plan.allExports}`);
    if (mask.reexports && plan.exports && plan.exports.length) out.push(`
## re-exported symbols: ${plan.exports.join(", ")}`);
    if (mask.insertionRegion) {
      if (plan.insertionRegion) {
        out.push(`
## insertion region starts at ${plan.moduleLabel}:${plan.insertionRegion.start} (write your new sibling here \u2014 no source body in this graph-only bundle).`);
      } else if (plan.insertion) {
        out.push(`
## insert the new sibling after line ~${plan.insertion} (end of the last top-level definition).`);
      }
    }
    if (mask.tests && plan.tests.length) out.push(`
## covering tests: ${plan.tests.join(", ")}`);
    if (mask.cochange && plan.cochange && plan.cochange.length) {
      out.push(`
## usually changed together (consider editing these too): ${plan.cochange.map((c) => `${c.label} (\xD7${c.weight})`).join(", ")}`);
    }
    return out.join("\n");
  }
  function cochangeNeighbours(graph, modId) {
    const hits = [];
    for (const e of edgesOfKind(graph, "cochange")) {
      if (e.subject === modId) hits.push({ label: e.objectLabel || e.object, weight: e.weight || 0 });
      else if (e.object === modId) hits.push({ label: e.subjectLabel || e.subject, weight: e.weight || 0 });
    }
    return hits.sort((a, b) => b.weight - a.weight);
  }
  function renderCochanges(graph, ind) {
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || modId;
    const hits = cochangeNeighbours(graph, modId);
    if (!hits.length) return `${modLabel}: no change-coupling recorded (rarely co-committed, or outside the git-log window).`;
    const list = hits.slice(0, COCHANGE_CAP).map((h) => `${h.label} (\xD7${h.weight})`);
    return `${modLabel} \u2014 usually changes together with ${hits.length} module(s) (edit these too):
  ${list.join("\n  ")}` + (hits.length > COCHANGE_CAP ? `
  \u2026+${hits.length - COCHANGE_CAP} more` : "");
  }
  function renderExports(graph, ind) {
    const modId = moduleIdOf(graph, ind);
    if (!modId) return `cannot map ${ind.label} to a module.`;
    const modLabel = graph.byId.get(modId)?.label || modId;
    const edges = edgesOfKind(graph, "reexports").filter((e) => e.subject === modId);
    if (!edges.length) return `${modLabel}: no public exports recorded (no export list / __all__ found, or none resolved).`;
    const list = edges.slice(0, EXPORTS_CAP).map((e) => {
      const origin = graph.byId.get(e.object);
      const where = origin ? siteOf(origin) : null;
      const from = where ? ` \u2190 ${where.path}` : "";
      return `${e.objectLabel || e.object}${from}`;
    });
    return `${modLabel} \u2014 public API (${edges.length} export(s)):
  ${list.join("\n  ")}` + (edges.length > EXPORTS_CAP ? `
  \u2026+${edges.length - EXPORTS_CAP} more` : "");
  }
  var PROP_KIND, isProvRef, DESCRIBE_EDGE_CAP, PROV_CAP, IMPACT_DEPTHS_LISTED, IMPACT_PER_DEPTH, IMPACT_TESTS_PER_DEP, SEARCH_LIMIT, SEARCH_SYMBOLS_SHOWN, PATH_W, SYM_W, EXACT_W, SYM_MATCH_CAP, PROX_FRAC, PROX_CAP_FRAC, isTestLabel, NONPROD_DEMOTE, isNonProdLabel, CALL_PROX_FRAC, CALL_PROX_CAP_FRAC, IMPL_PROX_FRAC, IMPL_PROX_CAP_FRAC, isCsModuleLabel, looksLikeCsInterface, PROSE_PROX_FRAC, PROSE_PROX_CAP_FRAC, PROSE_LOOKUP_LIMIT, PROSE_LAYER_FRAC, PROSE_LAYER_CAP_FRAC, PROSE_LAYER_DISCOUNT, LIT_W, LIT_MIN_COMPONENTS, LIT_COMP_CAP, LIT_FRAC, LIT_CAP_FRAC, BEAM_MARGIN_FRAC, BEAM_PROX_FRAC, BEAM_PROX_CAP_FRAC, BEAM_OVERFLOW_CAP, BEAM_PLIES, BEAM_EDGE_GROUPS, SPIRAL_DEPTH_DEFAULT, SPIRAL_NODE_LIMIT_DEFAULT, SPIRAL_Q_DEFAULT, SPIRAL_EXPAND_KINDS, SPIRAL_EMIT_FRAC, SPIRAL_HOP_DECAY, SPIRAL_PROX_FRAC, SPIRAL_PROX_CAP_FRAC, edgesOfKindCache, MEMBERS_CAP, SUBCLASS_CAP, CALL_CAP, attrVal, ARCH_PKG_CAP, ARCH_HUB_CAP, COVERAGE_CAP, TESTS_GRAIN_NOTE, HISTORY_CAP, CALL_SYMBOL_CLASSES, CALL_HINT_CAP, SYMBOL_CLASSES, CONTEXT_SIBLING_CAP, CLASS_MEMBER_CAP, COCHANGE_MID_CAP, CONTEXT_TESTS_CAP, TINY_MAX_LOC, TINY_MAX_ARITY, LARGE_CLASS_MEMBERS, INLINE_CALLEE_CAP, splitDecs, tokenize, countParams, modeOf, COCHANGE_CAP, EXPORTS_CAP;
  var init_codegraph = __esm({
    "src/domain/codegraph.mjs"() {
      init_prose();
      init_trust();
      PROP_KIND = {
        // v2.0 faithful tokens (SEON-faithful realign)
        "mgx:importsnamespace": "imports",
        "mgx:callscoarse": "calls",
        "seon:declaresmethod": "defines",
        "mgx:testscoverage": "tests",
        "mgx:touchedbycommit": "touches",
        "seon:containscodeentity": "contains",
        "seon:hassupertype": "inherits",
        "mgx:changecoupledwith": "cochange",
        "mgx:reexports": "reexports",
        // symbol-level edges stay separate kinds so the module-coarse impact closure is unchanged
        "mgx:touchessymbol": "touchesSymbol",
        "mgx:callssymbol": "callsSymbol",
        // legacy tokens (pre-realign graphs) — kept so a stale artifact still classifies
        "seon:usescomplextype": "imports",
        "seon:invokesmethod": "calls",
        "seon:history": "touches",
        "mgx:subclassof": "inherits",
        "mg:imports": "imports",
        "mg:calls": "calls",
        "mg:defines": "defines",
        "mg:tests": "tests",
        "mg:touches": "touches",
        // memory-graph predicates map to themselves so adjacencyForKinds/edgesOfKind can walk them too
        "mgx:saidinsession": "saidInSession",
        "mgx:inreplyto": "inReplyTo",
        "mgx:statedby": "statedBy",
        "mgx:canonicalisedfrom": "canonicalisedFrom"
      };
      isProvRef = (r) => /^(git|turn):/.test(String(r || ""));
      DESCRIBE_EDGE_CAP = 30;
      PROV_CAP = 8;
      IMPACT_DEPTHS_LISTED = 2;
      IMPACT_PER_DEPTH = 25;
      IMPACT_TESTS_PER_DEP = 3;
      SEARCH_LIMIT = 10;
      SEARCH_SYMBOLS_SHOWN = 8;
      PATH_W = 3;
      SYM_W = 2;
      EXACT_W = 5;
      SYM_MATCH_CAP = 4;
      PROX_FRAC = 0.2;
      PROX_CAP_FRAC = 0.35;
      isTestLabel = (s) => /(^|\/)tests?\//.test(s) || /(^|\/)test_[^/]*\.py$/.test(s) || /\.tests(\.|$)/.test(s);
      NONPROD_DEMOTE = 0.15;
      isNonProdLabel = (s) => /(^|\/)(examples?|fixtures?|samples?|demos?|benchmarks?|test-[^/]+)(\/|$)/.test(s);
      CALL_PROX_FRAC = 0.2;
      CALL_PROX_CAP_FRAC = 0.35;
      IMPL_PROX_FRAC = 0.2;
      IMPL_PROX_CAP_FRAC = 0.35;
      isCsModuleLabel = (s) => /\.cs$/i.test(s);
      looksLikeCsInterface = (label) => /^I[A-Z]/.test(String(label || ""));
      PROSE_PROX_FRAC = 0.2;
      PROSE_PROX_CAP_FRAC = 0.35;
      PROSE_LOOKUP_LIMIT = 50;
      PROSE_LAYER_FRAC = 0.2;
      PROSE_LAYER_CAP_FRAC = 0.35;
      PROSE_LAYER_DISCOUNT = 0.5;
      LIT_W = EXACT_W;
      LIT_MIN_COMPONENTS = 3;
      LIT_COMP_CAP = 4;
      LIT_FRAC = 1;
      LIT_CAP_FRAC = 0.9;
      BEAM_MARGIN_FRAC = 0.5;
      BEAM_PROX_FRAC = 0.2;
      BEAM_PROX_CAP_FRAC = 0.35;
      BEAM_OVERFLOW_CAP = 4;
      BEAM_PLIES = 2;
      BEAM_EDGE_GROUPS = [["imports"], ["calls", "callsSymbol"], ["inherits"], ["cochange"]];
      SPIRAL_DEPTH_DEFAULT = 3;
      SPIRAL_NODE_LIMIT_DEFAULT = 12;
      SPIRAL_Q_DEFAULT = 0.9;
      SPIRAL_EXPAND_KINDS = ["imports", "calls", "callsSymbol", "inherits"];
      SPIRAL_EMIT_FRAC = 0.5;
      SPIRAL_HOP_DECAY = 0.6;
      SPIRAL_PROX_FRAC = 0.2;
      SPIRAL_PROX_CAP_FRAC = 0.35;
      edgesOfKindCache = /* @__PURE__ */ new WeakMap();
      MEMBERS_CAP = 40;
      SUBCLASS_CAP = 40;
      CALL_CAP = 30;
      attrVal = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value || "";
      ARCH_PKG_CAP = 25;
      ARCH_HUB_CAP = 15;
      COVERAGE_CAP = 40;
      TESTS_GRAIN_NOTE = "tests edges are recorded module to module, so this is module-grain coverage.";
      HISTORY_CAP = 15;
      CALL_SYMBOL_CLASSES = /* @__PURE__ */ new Set(["Function", "Method"]);
      CALL_HINT_CAP = 8;
      SYMBOL_CLASSES = { function: "Function", class: "Class", method: "Method", attribute: "Attribute" };
      CONTEXT_SIBLING_CAP = 8;
      CLASS_MEMBER_CAP = 16;
      COCHANGE_MID_CAP = 4;
      CONTEXT_TESTS_CAP = 6;
      TINY_MAX_LOC = 12;
      TINY_MAX_ARITY = 2;
      LARGE_CLASS_MEMBERS = 8;
      INLINE_CALLEE_CAP = 3;
      splitDecs = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
      tokenize = (s) => String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      countParams = (p) => {
        const s = String(p || "").trim();
        return s ? s.split(",").map((x) => x.trim()).filter(Boolean).length : 0;
      };
      modeOf = (nums) => {
        const freq = /* @__PURE__ */ new Map();
        let best = nums[0] ?? 0;
        let bestN = 0;
        for (const n of nums) {
          const c = (freq.get(n) || 0) + 1;
          freq.set(n, c);
          if (c > bestN) {
            bestN = c;
            best = n;
          }
        }
        return best;
      };
      COCHANGE_CAP = 20;
      EXPORTS_CAP = 40;
    }
  });

  // src/domain/interpret/normalize.mjs
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function stripFillerWords(text) {
    let q = String(text || "");
    if (FILLER_RE) q = q.replace(FILLER_RE, " ");
    return q.replace(/\s+/g, " ").trim();
  }
  function applyPreambleFrames(text) {
    let q = String(text || "");
    q = q.replace(TROUBLE_ASIDE_RE, " ").replace(/\s+/g, " ").trim();
    for (let pass = 0; pass < 3; pass++) {
      const before = q;
      let m = q.match(GREETING_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(THANKS_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(ACK_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(BROWSING_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(HEDGE_ADVERB_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(TOPIC_SWITCH_PREAMBLE_RE);
      if (m) q = m[1].trim();
      m = q.match(MODAL_WRAPPER_RE);
      if (m) q = m[1].trim();
      m = q.match(EXPLAIN_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(TELL_ME_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(KNOW_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(WANT_KNOW_WRAPPER_RE);
      if (m && INTERROGATIVE_LEAD_RE.test(m[1].trim())) q = m[1].trim();
      m = q.match(EMBEDDED_WHATIS_RE);
      if (m) q = `what ${m[2].toLowerCase()} ${m[1].trim()}`;
      m = q.match(EMBEDDED_MEANS_RE);
      if (m) q = `what does ${m[1].trim()} mean`;
      m = q.match(SHOW_GIVE_ME_RE);
      if (m) {
        const rest = m[1].trim();
        if (!isListingRemainder(rest)) {
          q = RELATION_VERB_RE.test(rest) || INTERROGATIVE_LEAD_RE.test(rest) ? rest : `describe ${rest}`;
        }
      }
      m = q.match(LEADING_CONNECTIVE_RE);
      if (m) {
        const rest = m[1].trim();
        if (INTERROGATIVE_LEAD_RE.test(rest) || QUESTION_AUX_LEAD_RE.test(rest) || TOPIC_SWITCH_PREAMBLE_RE.test(rest) || ACK_PREAMBLE_RE.test(rest) || HEDGE_ADVERB_PREAMBLE_RE.test(rest) || BROWSING_PREAMBLE_RE.test(rest)) q = rest;
      }
      if (q === before) break;
    }
    return q;
  }
  function applySubordinationFrames(text) {
    let q = String(text || "");
    for (let pass = 0; pass < 3; pass++) {
      const m = q.match(SUBORDINATION_FRAMES_RE);
      if (!m) break;
      q = m[1].trim();
    }
    return q;
  }
  function applySelfCorrectionFrames(text) {
    let q = String(text || "");
    for (let pass = 0; pass < 3; pass++) {
      const m = q.match(SELF_CORRECTION_RE);
      if (!m) break;
      const next = m[1].trim();
      if (!next || next === q) break;
      q = next;
    }
    return q;
  }
  function applyConditionalFrames(text) {
    const q = String(text || "");
    const qual = q.match(CONDITIONAL_QUALIFIER_RE);
    if (qual) {
      const kind = CONDITIONAL_KIND_PLURAL[qual[1].toLowerCase()];
      const gerund = CONDITIONAL_VERB_GERUND[qual[2].toLowerCase()];
      return `${kind} ${gerund} ${qual[3].trim()} and ${qual[4].toLowerCase()}`;
    }
    const cf = q.match(COUNTERFACTUAL_RE);
    if (cf) return `which modules transitively import ${cf[1].trim()}`;
    return q;
  }
  function expandContractions(text) {
    return String(text || "").replace(CONTRACTION_RE, (m) => CONTRACTIONS[m.toLowerCase()]);
  }
  function normalizeQuery(text) {
    let q = expandContractions(text);
    q = q.replace(MISSPELLING_RE, (m) => MISSPELLINGS[m.toLowerCase()]);
    q = q.replace(WRONG_WORD_RE, (m) => WRONG_WORDS[m.toLowerCase()]);
    q = q.replace(W_SLASH_RE, "with");
    q = q.replace(FOR_DIGIT_THANKS_RE, (_, w) => `${w} for`);
    q = q.replace(FOR_DIGIT_EXAMPLE_RE, (_, w) => `for ${w}`);
    q = q.replace(KIND_NOUN_ANAPHORA_RE, (_, pron) => pron);
    q = q.replace(WHERE_TRAILING_TEMPORAL_RE, "$1$2");
    q = q.replace(G_DROP, "$1ing");
    q = applyPreambleFrames(q);
    q = applySelfCorrectionFrames(q);
    q = applySubordinationFrames(q);
    q = applyConditionalFrames(q);
    q = stripFillerWords(q);
    q = q.replace(/\?{2,}\s*$/, "?");
    return q.replace(/\s+/g, " ").trim();
  }
  function applyNegationFrames(text) {
    for (const frame of [...COMMIT_CONTENT_FRAMES, ...NEGATION_FRAMES]) {
      const m = text.match(frame.re);
      if (m) return frame.to(m).replace(/\s+/g, " ").trim();
    }
    return text;
  }
  function applyPhrasingFrames(text) {
    for (const frame of PHRASING_FRAMES) {
      const m = text.match(frame.re);
      if (m) return frame.to(m).replace(/\s+/g, " ").trim();
    }
    return text;
  }
  function matchNegationSet(text) {
    const m = String(text || "").match(NEGATION_SET_RE);
    if (!m) return null;
    const entWord = m[1].toLowerCase();
    const predicate = m[2].trim();
    if (!predicate) return null;
    return { entWord, predicate };
  }
  var tableRe, CONTRACTION_RE, correctionRe, MISSPELLING_RE, WRONG_WORD_RE, W_SLASH_RE, FOR_DIGIT_THANKS_RE, FOR_DIGIT_EXAMPLE_RE, KIND_NOUN_ANAPHORA_RE, VERB_ALTERNATION, FILLER_RE, RELATION_VERB_RE, INTERROGATIVE_LEAD_RE, LISTING_TAIL_KINDS, BARE_KIND_RE, isListingRemainder, GREETING_PREAMBLE_RE, THANKS_PREAMBLE_RE, ACK_PREAMBLE_RE, BROWSING_PREAMBLE_RE, HEDGE_ADVERB_PREAMBLE_RE, TROUBLE_ASIDE_RE, MODAL_WRAPPER_RE, EXPLAIN_WRAPPER_RE, TELL_ME_WRAPPER_RE, KNOW_WRAPPER_RE, WANT_KNOW_WRAPPER_RE, EMBEDDED_WHATIS_RE, EMBEDDED_MEANS_RE, SHOW_GIVE_ME_RE, LEADING_CONNECTIVE_RE, QUESTION_AUX_LEAD_RE, TOPIC_SWITCH_PREAMBLE_RE, SUBORDINATION_FRAMES_RE, SELF_CORRECTION_RE, CONDITIONAL_VERB_GERUND, CONDITIONAL_KIND_PLURAL, CONDITIONAL_QUALIFIER_SRC, CONDITIONAL_QUALIFIER_RE, COUNTERFACTUAL_RE, WHERE_TRAILING_TEMPORAL_RE, PHRASING_FRAMES, NEGATION_SET_RE, STOPWORDS2, splitWords, wordsOf;
  var init_normalize = __esm({
    "src/domain/interpret/normalize.mjs"() {
      init_ask_vocab();
      tableRe = (table) => new RegExp(
        "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
        "gi"
      );
      CONTRACTION_RE = tableRe(CONTRACTIONS);
      correctionRe = (table) => new RegExp(
        "\\b(" + Object.keys(table).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b(?!\\.[a-z0-9])",
        "gi"
      );
      MISSPELLING_RE = correctionRe(MISSPELLINGS);
      WRONG_WORD_RE = correctionRe(WRONG_WORDS);
      W_SLASH_RE = /(?<=^|\s)w\/(?=\s|$)/gi;
      FOR_DIGIT_THANKS_RE = /\b(thx|thanks|thank\s+you|many\s+thanks|ty|cheers)\s+4\b/gi;
      FOR_DIGIT_EXAMPLE_RE = /\b4\s+(example|instance)\b(?!\s*[a-z])/gi;
      KIND_NOUN_ANAPHORA_RE = /\b(this|that)\s+(class|module|function|method|attribute|variable|file|commit)\b/gi;
      VERB_ALTERNATION = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      FILLER_RE = FILLER_WORDS.length ? new RegExp(
        "\\b(" + [...FILLER_WORDS].sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b\\s*,?",
        "gi"
      ) : null;
      RELATION_VERB_RE = new RegExp(
        "\\b(?:" + Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|") + ")\\b",
        "i"
      );
      INTERROGATIVE_LEAD_RE = /^(?:which|what|who|whose|where|when|why|how)\b/i;
      LISTING_TAIL_KINDS = /* @__PURE__ */ new Set([
        "modules",
        "files",
        "functions",
        "methods",
        "classes",
        "attributes",
        "fields",
        "properties",
        "variables",
        "globals",
        "commits",
        "changes",
        "tests",
        "members"
      ]);
      BARE_KIND_RE = /^(?:all\s+|the\s+)?(?:module|file|function|method|class|attribute|field|property|variable|global|commit|change|test|member)\??$/i;
      isListingRemainder = (rest) => {
        if (BARE_KIND_RE.test(rest)) return true;
        const words = rest.replace(/\?+\s*$/, "").trim().split(/\s+/);
        return LISTING_TAIL_KINDS.has((words[words.length - 1] || "").toLowerCase());
      };
      GREETING_PREAMBLE_RE = /^(?:hi|hiya|hello|hey|yo|howdy|g'?day|yeah\s+nah|good\s+(?:morning|afternoon|evening|day)|greetings|salutations)(?:\s+(?:there|pardner|folks|friend|mate))?\s*[,.—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
      THANKS_PREAMBLE_RE = /^(?:thanks|thank\s+you|many\s+thanks|thx|ty|cheers)(?:\s+(?:so\s+much|a\s+lot|very\s+much|a\s+bunch))?\s*[,—–-]\s*(?:(?:just\s+a\s+)?quick\s+question\s*[,:—–-]?\s*)?(.+)$/i;
      ACK_PREAMBLE_RE = /^(?:(?:ok(?:ay)?|aight|cool|alright|sure|right|fine|great|nice|got it|gotcha|sounds good|no worries|no problem)[\s,]+)+(.+)$/i;
      BROWSING_PREAMBLE_RE = /^(?:just\s+(?:poking\s+around|looking\s+around|browsing|exploring|checking\s+(?:this|it)\s+out)|first\s+time\s+(?:trying\s+this\s+out|using\s+this|here))\s*[,.—–-]\s*(.+)$/i;
      HEDGE_ADVERB_PREAMBLE_RE = /^(?:(?:maybe|possibly|perhaps)\s+)+(.+)$/i;
      TROUBLE_ASIDE_RE = /,?\s*if\s+(?:it'?s|it\s+is|that'?s|that\s+is)\s+not\s+too\s+much\s+(?:trouble|bother|hassle)\s*,?\s*/i;
      MODAL_WRAPPER_RE = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+?)(?:[,\s]+please)?\??$/i;
      EXPLAIN_WRAPPER_RE = /^explain\s+(?:to\s+me\s+|please\s+)*(.+?)\??$/i;
      TELL_ME_WRAPPER_RE = /^tell\s+me\s+(.+?)\??$/i;
      KNOW_WRAPPER_RE = /^do\s+you\s+know\s+(.+?)\??$/i;
      WANT_KNOW_WRAPPER_RE = /^i(?:'d|\s+would)?\s+(?:like|want|need)\s+to\s+know\s+(.+?)\??$/i;
      EMBEDDED_WHATIS_RE = /^what\s+((?:an?\s+|the\s+)?[\w'-]+(?:\s+[\w'-]+){0,2})\s+(is|are)\??$/i;
      EMBEDDED_MEANS_RE = /^what\s+((?:an?\s+|the\s+)?[\w'-]+(?:\s+[\w'-]+){0,2})\s+means\??$/i;
      SHOW_GIVE_ME_RE = /^(?:show|give)\s+me\s+(?:the\s+)?(.+?)\??$/i;
      LEADING_CONNECTIVE_RE = /^(?:and|also|so|then|now|but)\s+(.+)$/i;
      QUESTION_AUX_LEAD_RE = /^(?:does|do|did|is|are|was|were|has|have|had|can|could|will|would|should)\b/i;
      TOPIC_SWITCH_PREAMBLE_RE = /^(?:(?:actually|no\s+wait|wait|hold\s+on|never\s+mind|scratch\s+that|on\s+second\s+thought|i\s+mean(?:t)?)[\s,.]+)+(.+)$/i;
      SUBORDINATION_FRAMES_RE = /^(?:since|although|though|while|because|whereas|given\s+that|now\s+that)\s+.+?,\s*(.+)$/i;
      SELF_CORRECTION_RE = /^.+?(?:\s*(?:--|—|-)\s*)?\b(?:sorry|i\s+mean)\b\s*(?:--|—|-|,|:)\s*(.+)$/i;
      CONDITIONAL_VERB_GERUND = Object.freeze({
        imports: "importing",
        calls: "calling",
        touches: "touching",
        tests: "testing",
        exports: "exporting",
        contains: "containing",
        defines: "defining",
        uses: "using",
        "inherits from": "inheriting from"
      });
      CONDITIONAL_KIND_PLURAL = Object.freeze({
        module: "modules",
        class: "classes",
        function: "functions",
        method: "methods",
        attribute: "attributes",
        variable: "variables",
        commit: "commits",
        file: "files"
      });
      CONDITIONAL_QUALIFIER_SRC = "public|private|protected|static|abstract|constant|re-?exported|exported|tested|covered|untested|uncovered";
      CONDITIONAL_QUALIFIER_RE = new RegExp(
        "^if\\s+(?:a|an|the)?\\s*(" + Object.keys(CONDITIONAL_KIND_PLURAL).join("|") + ")\\s+(" + Object.keys(CONDITIONAL_VERB_GERUND).join("|") + ")\\s+(.+?),\\s*(?:is|are)\\s+(?:it|that|they|this)\\s+(" + CONDITIONAL_QUALIFIER_SRC + ")\\??$",
        "i"
      );
      COUNTERFACTUAL_RE = /^if\s+(.+?)\s+(?:were|was)\s+(?:deleted|removed),?\s*what\s+(?:would|might|could)\s+(?:break|fail|be\s+affected)\??$/i;
      WHERE_TRAILING_TEMPORAL_RE = new RegExp(
        `^(where\\s+(?:is|are|was|were)\\s+.+?)\\s+(?:${TRAILING_TEMPORAL_ADVERBS.map(escapeRegex).join("|")})(\\s*[?.!]*)$`,
        "i"
      );
      PHRASING_FRAMES = Object.freeze([
        // MEMBERS-of-class → "what does X contain".
        { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:are|is)\s+(?:in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        { re: /^what\s+(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:does|do)\s+(.+?)\s+have\??$/i, to: (m) => `what does ${m[1]} contain` },
        { re: /^what\s+are\s+(?:the\s+)?(?:functions?|methods?|members?|attributes?|fields?|properties)\s+(?:of|in|inside|within)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        { re: /^(?:the\s+)?(?:members?|methods?|attributes?|contents)\s+of\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        { re: /^what\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        // "what else is in X" drill-down after a members-of-class answer.
        { re: /^what\s+else\s+is\s+(?:in|inside)\s+(?:the\s+)?(.+?)\??$/i, to: (m) => `what does ${m[1]} contain` },
        // WHERE-DEFINED → "where is X defined". PAST TENSE ONLY ("what defined X", "what
        // declared X"): the PRESENT "what defines X" already parses as a reverse-defines
        // query (the module defining symbol X), so rewriting it would change that
        // receipt. The past-tense form is the one that hit the wall.
        { re: /^what\s+(?:defined|declared)\s+(?:the\s+)?(?:function\s+|method\s+|class\s+|module\s+|variable\s+|constant\s+)?(.+?)\??$/i, to: (m) => `where is ${m[1]} defined` },
        //   "where's X defined" (the "where's" contraction is not in the contraction table)
        { re: /^where'?s\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
        //   "were is X defined" (the missing-h typo of "where").
        //   NOT curated as a blanket MISSPELLINGS entry — "were" is a real word already
        //   load-bearing as the TEMPORAL_AUX auxiliary ("when were the modules last
        //   touched"), so a global word-boundary rewrite would clobber that reading.
        //   This frame is anchored to the WHERE-DEFINED shape specifically ("were is
        //   … defined/declared/located/implemented"), a construction no legitimate
        //   temporal query produces ("were" as an auxiliary never leads directly into
        //   a bare "is").
        { re: /^were\s+is\s+(?:the\s+)?(.+?)\s+(defined|declared|located|implemented)\??$/i, to: (m) => `where is ${m[1]} ${m[2]}` },
        // DESCRIBE PARAPHRASES ("what is the purpose of X", "what does X do in
        // this codebase") → the meta/whatis shape ("what is a <term>"), which
        // already answers a unique code entity via metaFallbackEntityAnswer. The
        // term slot refuses an a/an article or a pronoun lead so the vocabulary
        // phrasings ("what is the purpose of a horse", "what does it do here")
        // pass through untouched to their own memory-facts and context readers,
        // which read the raw text and must keep their turn. A leading "the" is
        // entity-term noise (mirrors resolveObject's own article strip). The
        // sibling "what is X for" paraphrase is deliberately NOT a frame: chat's
        // module-overview lane owns that phrasing and gates on an ask() miss, so
        // it lives as ask()'s own miss-gated fallback (WHATIS_FOR_FALLBACK_RE)
        // instead, adopted only when the meta reading actually answers.
        { re: /^what\s+is\s+the\s+purpose\s+of\s+(?:the\s+)?(?!(?:an?|it|this|that|these|those)\s)(.+?)\??$/i, to: (m) => `what is a ${m[1]}` },
        // Scoped form only: bare "what does X do" stays unrewritten — the chat
        // surface's module-grain overview lane owns it and only gets its turn when
        // ask() misses, so claiming it here would swap that richer answer for the
        // one-line meta fallback.
        {
          re: new RegExp(`^what\\s+does\\s+(?:the\\s+)?(?!(?:an?|it|this|that|these|those)\\s)(.+?)\\s+do\\s+(?:${TRAILING_SCOPE_FILLER.map(escapeRegex).join("|")})\\??$`, "i"),
          to: (m) => `what is a ${m[1]}`
        },
        // PREDICATIVE QUALIFIER ("which modules are untested") → the ATTRIBUTIVE form
        // ("untested modules") the grammar already answers. The QUALIFIER must sit
        // immediately after are/is, so "…are NOT tested" keeps its own set-complement handler.
        {
          re: /^(?:which|what)\s+(?:the\s+|all\s+)?([a-z][a-z-]*?)\s+(?:are|is)\s+(public|private|protected|static|abstract|constant|exported|re-?exported|tested|covered|untested|uncovered)\??$/i,
          to: (m) => `${m[2].toLowerCase()} ${m[1].toLowerCase()}`
        },
        // BARE COVERAGE SURVEY, no entity kind ("what is untested") → defaults the
        // surveyed kind to modules and folds the negation into the qualifier.
        {
          re: /^what\s+(?:is|are)\s+(not\s+)?(tested|untested|covered|uncovered)\??$/i,
          to: (m) => {
            const q = m[2].toLowerCase();
            const flipped = m[1] ? q === "tested" ? "untested" : q === "covered" ? "uncovered" : q : q;
            return `${flipped} modules`;
          }
        },
        // CO-CHANGE → "what co-changes with X" (the plainest phrasing a developer types).
        { re: /^what\s+does\s+(.+?)\s+changes?\s+together\s+with\??$/i, to: (m) => `what co-changes with ${m[1]}` },
        { re: /^what\s+changes?\s+together\s+with\s+(.+?)\??$/i, to: (m) => `what co-changes with ${m[1]}` },
        // AUTHORSHIP → "who touched X" (tmct's touch edge IS the authorship signal).
        // A commit sha object is excluded — that dumps the commit's touch-set, not its author.
        { re: /^who\s+(?:wrote|authored)\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
        { re: /^who\s+is\s+the\s+authors?\s+of\s+(?:the\s+)?(?!(?:commit\s+)?[0-9a-f]{7,40}\??$)(.+?)\??$/i, to: (m) => `who touched ${m[1]}` },
        // HAS-TESTS → "what tests X" (the coverage question). Refuses "not" in the
        // subject so set-complement negations keep their own downstream handler.
        { re: /^(?:does|do)\s+(?!.*\bnot\b)(.+?)\s+have\s+(?:any\s+)?(?:tests?|test\s+coverage|coverage)\??$/i, to: (m) => `what tests ${m[1]}` },
        { re: /^(?:is|are)\s+(?!.*\bnot\b)(.+?)\s+tested\??$/i, to: (m) => `what tests ${m[1]}` },
        // NEEDS-TESTS → the untested-module survey.
        { re: /^what\s+needs\s+(?:to\s+be\s+)?(?:a\s+)?(?:tested|tests?|testing|coverage|covering)\??$/i, to: () => "untested modules" },
        // DOES-X-VERB-ANYTHING-ELSE → "what does X <verb>" (drops the placeholder
        // "anything/something else" object, which otherwise made the two parse
        // strategies disagree on the span). Anchored to VERB_TO_KIND so it can't
        // swallow a real object that happens to start with "any"/"some".
        {
          re: new RegExp(`^(?:do|does)\\s+(.+?)\\s+(${VERB_ALTERNATION})\\s+(?:anything|something)(?:\\s+else)?\\??$`, "i"),
          to: (m) => `what does ${m[1]} ${m[2]}`
        }
      ]);
      NEGATION_SET_RE = new RegExp(
        "^(?:which|what|who|list|show(?:\\s+me)?|find|give\\s+me)?\\s*(?:the\\s+|all\\s+)?([a-z][a-z-]*)\\s+(?:(?:that|which|who)\\s+)?(?:(?:do|does|did|are|is|was|were|have|has|can|could|will|would|should)\\s+not|cannot|can't|won't|couldn't|shouldn't|wouldn't|not)\\s+(.+)$",
        "i"
      );
      STOPWORDS2 = /* @__PURE__ */ new Set([
        "what",
        "who",
        "which",
        "where",
        "when",
        "why",
        "how",
        "does",
        "do",
        "did",
        "is",
        "are",
        "was",
        "were",
        "the",
        "a",
        "an",
        "of",
        "to",
        "from",
        "at",
        "in",
        "on",
        "there",
        "something",
        "anything",
        "nothing",
        "one",
        "any",
        "last",
        // temporal filler ("when was X last touched")
        "usually",
        "typically",
        "generally",
        "normally",
        "often",
        "commonly",
        "mostly",
        // frequency-adverb filler
        "should",
        "would",
        "could",
        "can",
        "will",
        "shall",
        "might",
        "must"
        // modal auxiliaries
      ]);
      splitWords = (text) => String(text).replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
      wordsOf = (arr) => arr.flatMap((p) => String(p).toLowerCase().split(" "));
    }
  });

  // src/domain/real-word-collisions.json
  var real_word_collisions_default;
  var init_real_word_collisions = __esm({
    "src/domain/real-word-collisions.json"() {
      real_word_collisions_default = { source: "corpus/wordnet/*.jsonl lemmas, expanded through the regular -s/-ed/-ing inflections", generator: "scripts/generate-real-word-collisions.mjs", targets: ["alongside", "build", "builds", "built", "call", "calling", "calls", "change", "changed", "changes", "check", "checks", "class", "co-change", "co-changes", "code", "commits", "contain", "containing", "contains", "couple", "couples", "cover", "covers", "declare", "declares", "define", "defined", "defines", "defining", "depends", "derive", "derives", "directly", "edited", "execute", "executes", "exercise", "exercises", "explicitly", "export", "exporting", "exports", "expose", "exposes", "extend", "extending", "extends", "fire", "fires", "from", "grab", "grabs", "have", "hits", "hold", "holds", "hooked", "import", "importing", "imports", "included", "indirectly", "inherit", "inheriting", "inherits", "inside", "into", "invoke", "invokes", "kick", "kicks", "kind", "land", "landed", "lean", "leans", "live", "lives", "make", "makes", "modified", "modifies", "move", "moves", "parent", "part", "pass", "passes", "pull", "pulls", "re-export", "re-exports", "reference", "references", "relies", "rely", "require", "requires", "runs", "share", "shares", "sits", "subclass", "subclasses", "subclassing", "superclass", "superclasses", "sure", "talk", "talks", "tend", "tends", "test", "testing", "tests", "through", "together", "touch", "touched", "touches", "touching", "transitively", "trigger", "triggers", "tweaked", "updated", "uses", "using", "usually", "verifies", "verify", "went", "were", "wired", "with"], words: ["aalging", "aasing", "aave", "ablies", "abling", "aboves", "absing", "abuses", "abusing", "acauling", "achinged", "acolds", "acquire", "acquires", "acyling", "adelies", "adenine", "adenined", "adenines", "adenining", "aditted", "aerides", "aerified", "aerifies", "aerify", "affine", "affined", "affines", "affining", "afire", "afires", "afling", "agalling", "ailing", "aired", "airied", "airies", "airport", "airporting", "airports", "airsed", "airses", "airted", "alaing", "alases", "albing", "alecks", "aleves", "aliaes", "alikes", "alines", "alive", "alives", "allaing", "allies", "alling", "alls", "allying", "alongsided", "alongsides", "alping", "alting", "altogether", "amasses", "amazes", "amends", "amorting", "amorts", "amuses", "amusing", "analling", "anded", "anoded", "ansing", "anuses", "apart", "aparts", "apises", "apparent", "appends", "appose", "apposes", "apsing", "apsises", "arab", "arabis", "arabs", "ardent", "argent", "arpent", "arrive", "arrives", "arsing", "asaing", "asding", "aseans", "ases", "ashing", "ashore", "ashores", "asing", "asking", "asping", "asring", "asses", "assess", "assets", "assing", "assure", "attending", "attest", "attesting", "attests", "audited", "aufing", "auging", "auking", "aurifies", "aurify", "avouch", "avouched", "avouches", "avouching", "awaked", "awakes", "awared", "awares", "awling", "awried", "axling", "baases", "badded", "bailed", "bailing", "baited", "bake", "bakeds", "bakers", "bakes", "balded", "balding", "baling", "balk", "balking", "balks", "ball", "balling", "balls", "ballsing", "ballying", "balming", "band", "banded", "bandeds", "bandied", "bandsed", "banked", "banned", "barded", "barelies", "barely", "barses", "bart", "baseses", "bashes", "basing", "basises", "bass", "bassed", "basses", "basset", "bassets", "bassos", "bastes", "basting", "batses", "bauded", "baulks", "bawded", "bawling", "bbsing", "beaked", "bean", "beanos", "beans", "beasting", "beasts", "beating", "beeting", "begild", "begilds", "behave", "behold", "beholds", "belied", "belief", "beliefs", "belies", "belikes", "belizes", "belles", "bellies", "belling", "belting", "bend", "bended", "bends", "bent", "benting", "besets", "besots", "besses", "bessing", "best", "besting", "bests", "beting", "betting", "bevies", "bhanged", "biered", "bigger", "biggers", "billing", "bind", "binded", "birded", "birled", "birles", "biroed", "birred", "bising", "bjsing", "bladed", "blanced", "bland", "blanda", "blandaed", "blanded", "blands", "blanked", "blares", "blases", "blasts", "bleaked", "bleaks", "blears", "bleats", "blended", "blends", "blesting", "blests", "blinded", "blinds", "blited", "blites", "bloked", "blonded", "bmuses", "bnsing", "boched", "boches", "boching", "bocked", "bode", "bodilied", "bodilies", "boiled", "boileds", "bokked", "bold", "bolds", "bolling", "bonded", "boners", "bonked", "boobed", "booked", "bookeds", "bookend", "booker", "bookied", "booksed", "boomed", "booned", "boored", "booted", "boozed", "borers", "borough", "bosked", "bosses", "botched", "botches", "botching", "boucheed", "bouchees", "boucle", "boucled", "boucling", "boughed", "boughing", "boules", "boulle", "boulles", "bouses", "bousing", "bowers", "boxers", "bpsing", "bragger", "braggers", "brakes", "branded", "brasses", "breaked", "bricks", "brigged", "brills", "broked", "brooked", "bruins", "brunts", "brunus", "bses", "bsing", "bugled", "bugles", "buhled", "builders", "buildups", "bull", "bulled", "bullet", "bulling", "bulls", "buns", "bunses", "bunsing", "buried", "burieds", "burled", "burleds", "buses", "bushes", "bushing", "busied", "busies", "busking", "bussing", "busying", "buyied", "buying", "bypass", "bypasses", "caballing", "cabals", "cabbing", "cabers", "cabged", "cabging", "cables", "cablin", "cabling", "cablins", "caching", "cackling", "cadded", "cadding", "cadent", "cadged", "cadges", "cadging", "cadring", "cafers", "caffing", "cafing", "cagers", "caging", "cagying", "caining", "cajoling", "cake", "cakes", "cakiling", "caking", "calcine", "calean", "caleans", "caleying", "caleys", "calf", "calfing", "calfs", "califs", "calkin", "calking", "calkins", "callaing", "callas", "callers", "callinged", "callings", "callous", "callowing", "callows", "calluna", "callus", "calm", "calming", "calmings", "calmlying", "calms", "calquing", "calvaing", "calvas", "calves", "calving", "calvings", "calx", "calxes", "calxing", "calycling", "calyxing", "camass", "camelling", "camels", "camming", "camoing", "camping", "canaing", "canalling", "canals", "candid", "candied", "candled", "candling", "cangue", "cangued", "cangues", "caning", "canning", "canoes", "canting", "cantling", "capers", "caping", "caplin", "caplins", "capoing", "capping", "captain", "captaining", "captains", "carded", "carding", "caring", "carking", "carlina", "carline", "carling", "carlings", "carlos", "carning", "caroling", "carolling", "carols", "carping", "carring", "cart", "carting", "carver", "carvers", "carving", "casaing", "cashes", "cashing", "casking", "cassies", "castes", "castling", "casually", "casuses", "caters", "catling", "catlings", "catses", "catsing", "catting", "cattling", "caul", "cauline", "cauling", "caulking", "cauls", "cavaing", "cave", "caverns", "cavilling", "cavils", "caving", "cavying", "cawing", "caying", "ceases", "cecalling", "cede", "cedied", "ceiling", "cell", "celling", "celloing", "cellos", "cells", "cellsing", "cent", "centing", "cercises", "cere", "cerise", "cerises", "certain", "certaining", "certains", "certifies", "certify", "certing", "cfling", "cgsing", "chadded", "chafed", "chaffed", "chafinged", "chagaed", "chagas", "chagga", "chaggaed", "chaggas", "chained", "chainsed", "chainses", "chaired", "chaise", "chaised", "chaises", "chaited", "chaits", "chajaed", "chalked", "chalking", "challis", "champed", "chanal", "chanals", "chanar", "chanars", "chance", "chanced", "chancels", "chances", "chancied", "chancies", "chancre", "chancred", "chancres", "chancy", "changers", "channels", "chanted", "chanters", "chanteys", "chantied", "chanties", "chanty", "chaosed", "chaoses", "chapped", "charded", "chards", "charge", "charged", "chargers", "charges", "charied", "charmed", "charms", "charred", "charrs", "charted", "charts", "chased", "chasmed", "chasms", "chassed", "chaste", "chasted", "chastes", "chatted", "chaunaed", "chaused", "chauses", "chawed", "cheaps", "cheats", "checkeds", "checkers", "checksum", "checkups", "cheek", "cheeks", "cheeps", "chelas", "chenned", "cheops", "cherts", "chesting", "chewas", "chianed", "chick", "chicks", "chigger", "chiggers", "chiling", "chilling", "chills", "chinaed", "chined", "chines", "chinked", "chinks", "chinned", "chinoed", "chirks", "chits", "chives", "choanaed", "chock", "chocked", "chocks", "choked", "choker", "chokers", "choler", "cholers", "chonned", "choosed", "chords", "chores", "chough", "chuaned", "chuck", "chucks", "chugged", "chunga", "chungaed", "chungas", "chunked", "chunks", "chyling", "cialis", "cicers", "ciders", "circed", "circes", "cive", "cives", "civies", "cladded", "claded", "clades", "clading", "clads", "claims", "clamps", "clams", "clamses", "clanged", "clangers", "clanks", "clans", "claps", "clarks", "claros", "clash", "clashes", "clasp", "clasps", "classed", "classic", "classy", "clast", "clasts", "clausa", "clausas", "clause", "clauses", "claver", "clavers", "clavus", "clawing", "claws", "claying", "clays", "clean", "cleans", "cleanse", "clerks", "clever", "clevers", "cliing", "climes", "clinged", "cloaks", "clocks", "closer", "closers", "closes", "cloved", "cloven", "clovens", "clover", "clovers", "clucks", "cluing", "clving", "clxing", "cnsing", "coached", "coaches", "coaching", "coaling", "coasts", "coaxer", "coaxers", "cobber", "cobbers", "cobble", "cobbles", "cocain", "cocaining", "cocains", "cocked", "cocker", "cockers", "cockle", "cockles", "coda", "codaed", "codded", "coddles", "coded", "coders", "codes", "codex", "codgers", "codified", "codifies", "codling", "cods", "coed", "coeurs", "coffer", "coffers", "coggle", "coggles", "coheres", "coiling", "coiner", "coiners", "coired", "coke", "colaing", "cold", "colded", "colding", "colds", "cole", "coleus", "coliing", "coling", "colling", "collins", "collying", "colors", "coltan", "coltanning", "coltans", "colter", "colters", "colting", "comalling", "combats", "comber", "combers", "come", "comer", "comers", "comfies", "comfit", "comfits", "comics", "comints", "comity", "commas", "comments", "commes", "commie", "commied", "commies", "comming", "commit", "commix", "commixes", "commons", "commute", "commutes", "compel", "compels", "compile", "compiles", "complies", "comply", "comport", "comporting", "comports", "conched", "conches", "conching", "concluded", "cone", "coneys", "confer", "confers", "confining", "confits", "conged", "conger", "congers", "conges", "conjoin", "conjoining", "conjoins", "conked", "conker", "conkers", "constrain", "constraining", "constrains", "contact", "contacting", "contacts", "contadinoing", "contadinos", "contagion", "contagioning", "contagions", "containeds", "containers", "contemn", "contemning", "contemns", "continuing", "contrail", "contrailing", "contrails", "contriting", "contriving", "converse", "converso", "converts", "convex", "convey", "conveys", "convoke", "convokes", "cooked", "cookeds", "cookers", "cookied", "cooled", "cooler", "coolers", "cooling", "cooned", "cooped", "cooper", "coopers", "cooted", "cooter", "cooters", "copalling", "cope", "copeck", "copecks", "copier", "copiers", "copies", "copper", "coppers", "copses", "copula", "copulas", "coralling", "corded", "core", "coreference", "coreferences", "corer", "corers", "corked", "corker", "corkers", "corner", "corners", "corpse", "corpses", "corvee", "corvees", "cosecs", "cosher", "coshers", "cosmics", "cosmids", "cosses", "costing", "cotanning", "cotans", "cote", "cotter", "cotters", "couch", "couched", "couches", "couching", "coude", "couded", "coue", "coughed", "coughing", "coupe", "coupes", "coupleds", "couplers", "couplets", "coupon", "coupons", "course", "courses", "couthed", "couthing", "coved", "coven", "covens", "covereds", "coverts", "covet", "covets", "covey", "coveys", "cower", "cowers", "cowling", "cowpie", "cowpies", "cozens", "cpsing", "crab", "crabs", "cracks", "cradling", "cragged", "crakes", "craned", "cranes", "cranked", "cranned", "crass", "crasses", "crawling", "crawls", "creaked", "creaks", "credited", "creeks", "cresting", "crests", "criers", "cringe", "cringed", "cringes", "crocks", "crooked", "crouch", "crouched", "crouches", "crouching", "croupe", "croupes", "crumple", "crumples", "cruses", "crusing", "cses", "csing", "ctened", "ctenes", "cubing", "cuking", "culling", "culming", "culting", "cupalling", "cupels", "cupsing", "cupule", "cupules", "cure", "curing", "curling", "curses", "cursing", "curtain", "curtaining", "curtains", "cusking", "cusping", "cussing", "cuting", "cutlass", "cutses", "cutsing", "cxling", "cxlving", "cyanned", "cyanoed", "cycling", "cyders", "cymling", "cysting", "dadded", "dahling", "dailing", "daises", "daling", "dall", "dalliing", "dalling", "dallis", "dalls", "dallying", "daloing", "danced", "dander", "dandied", "dandled", "danked", "dansed", "danses", "darded", "darling", "dart", "dashes", "dassed", "dassies", "dative", "datives", "dayses", "ddsing", "deafened", "deafening", "deafing", "deaing", "dean", "deaned", "deaning", "deans", "dearie", "dearies", "debiled", "debiling", "debone", "deboned", "debones", "deboning", "debrises", "debted", "debting", "decade", "decades", "decalling", "decease", "deceases", "deceive", "deceives", "decents", "decided", "deciding", "deciled", "deciling", "declaim", "declaims", "declareds", "declarers", "declaw", "declined", "declining", "decode", "decouple", "decouples", "decries", "deepens", "deface", "defaced", "defaces", "defacing", "defame", "defamed", "defames", "defaming", "defang", "defanged", "defanging", "defangs", "defence", "defenced", "defences", "defencing", "defended", "defending", "defends", "defensed", "defenses", "defensing", "deference", "deferences", "deferenses", "defiance", "defianced", "defiances", "defiancing", "defiant", "defianted", "defianting", "defiants", "defied", "defies", "defile", "defiled", "defilers", "defiles", "defiling", "defininged", "definings", "definited", "definites", "definiting", "deflate", "deflates", "deftness", "defuse", "defused", "defuses", "defusing", "deglaze", "deglazes", "deicing", "deified", "deifying", "deigned", "deigning", "deisted", "deisting", "deists", "deitied", "delfing", "deliing", "delivers", "delling", "demands", "demised", "demising", "denied", "denned", "denning", "dent", "dented", "dentine", "dentined", "dentines", "denting", "dentining", "depart", "depend", "depended", "deplane", "deplanes", "deplore", "deplores", "depone", "deponed", "deponing", "depose", "deposes", "deprave", "depraves", "deprive", "depriveds", "deprives", "derate", "derates", "derbies", "deride", "derides", "deriding", "derisive", "derisives", "deriveds", "deriving", "dermises", "derpies", "derrises", "descends", "designed", "designing", "desired", "desiring", "desking", "desponds", "dessing", "destined", "destines", "destining", "destiny", "detained", "detaining", "detents", "detest", "detesting", "detests", "detinue", "detinued", "detinues", "detinuing", "deuses", "deusing", "deveined", "deveining", "deviced", "devicing", "deviled", "devised", "devising", "dewied", "dewiness", "dewing", "dexone", "dexoned", "dexones", "dexoning", "dhalling", "dholed", "dholes", "dick", "dicks", "dieted", "digger", "diggers", "dilling", "dining", "dinted", "dire", "direct", "directed", "director", "directory", "directs", "dired", "dires", "dirged", "dirges", "dirked", "disport", "disporting", "disports", "disses", "ditaed", "ditted", "dive", "dives", "divest", "divine", "divined", "divines", "divining", "dmuses", "docked", "doleds", "dolling", "domine", "domined", "domines", "domining", "doobed", "doomed", "doored", "dopeds", "dories", "dorked", "dosing", "dosses", "double", "doubles", "douched", "douches", "douching", "doughed", "doughing", "douses", "dousing", "dove", "doves", "dowers", "dozers", "drab", "drabas", "drabs", "dragger", "draggers", "drained", "draining", "drakes", "dranged", "drecks", "drilies", "drive", "drivels", "drivens", "drivers", "drives", "drover", "drovers", "drunks", "druses", "drusing", "drylies", "dses", "dsing", "dsling", "dtsing", "ducing", "duding", "dudses", "dudsing", "duking", "dulies", "dull", "dulling", "dulls", "dulses", "dulsing", "duning", "duns", "duoing", "duping", "duples", "during", "dusking", "eagling", "earling", "earses", "easies", "easing", "easted", "easting", "eating", "eatses", "ebitted", "ebooked", "ebsing", "echted", "eclats", "ecting", "eddaed", "eddied", "eddoed", "edgied", "edibled", "edicted", "editeds", "editor", "editted", "edsing", "edtaed", "educed", "eduled", "eelses", "eerilies", "eerily", "effort", "efforting", "efforts", "efting", "egesting", "egests", "eidoses", "eiraed", "elan", "eland", "elanded", "elanned", "elans", "elanus", "elated", "elegans", "elided", "elinted", "elited", "elling", "elocute", "elocutes", "elopses", "elsing", "eluted", "elvers", "emending", "emiled", "emitted", "emoted", "emotes", "emsing", "enated", "encode", "endived", "ends", "energise", "energises", "enquire", "enquires", "ensile", "ensure", "entendring", "ententing", "enting", "epopses", "eposes", "equally", "equine", "equines", "erectly", "eroses", "ersing", "ersted", "ersting", "erting", "erudited", "escort", "escorting", "escorts", "eses", "esing", "esports", "esportsing", "espouse", "espouses", "esquire", "esquires", "esting", "ests", "eternise", "eternises", "ethoses", "evicted", "evoked", "evokes", "exceed", "exceeding", "exceeds", "exchange", "exchanged", "exchanges", "excite", "excited", "excites", "excluded", "execrate", "execrates", "executeds", "executive", "executives", "executors", "exegete", "exegetes", "exercisers", "exerciseses", "exerting", "exerts", "exhort", "exhorting", "exhorts", "exiled", "existed", "exitted", "exodes", "exorcise", "exorcisers", "exorcises", "exorcism", "exorcisms", "exorcist", "exorcists", "exorcize", "exorcizes", "expand", "expanding", "expands", "expanse", "expanses", "expats", "expatting", "expect", "expecting", "expects", "expend", "expending", "expendings", "expends", "expense", "expenses", "expensing", "expert", "experting", "expertise", "expertises", "experts", "expiating", "expiring", "expiry", "expirying", "explicit", "explicits", "explode", "explodes", "exploit", "exploiting", "exploits", "exploring", "expoing", "exporters", "exportinged", "exportings", "expos", "exposeds", "exposing", "exposure", "exposures", "express", "exsert", "exserting", "exserts", "extant", "extanting", "extants", "extendeds", "extent", "extented", "extenting", "extents", "extern", "externa", "externaing", "externas", "externed", "externing", "externus", "extort", "extorting", "extorts", "extruding", "fabling", "fadded", "failing", "failling", "faire", "faires", "fairies", "faited", "fake", "fakers", "fakes", "fall", "falling", "fallings", "falls", "fallsing", "falses", "falsing", "fanned", "farces", "fare", "fares", "fart", "fasces", "fassed", "fasting", "fawkes", "fcsing", "feasting", "feasts", "feating", "fecalling", "feeting", "feined", "feining", "feisting", "feists", "felids", "feline", "felined", "felining", "felises", "fellies", "felling", "felting", "fend", "fended", "fends", "feres", "ferined", "ferining", "fesses", "fessing", "feting", "fetting", "fevers", "fibers", "fibre", "fibres", "fice", "fices", "fide", "fides", "fiends", "fierce", "fierces", "fieries", "fieris", "fife", "fifes", "figure", "figures", "file", "filers", "files", "filets", "filles", "filling", "filses", "find", "finded", "fine", "finers", "fines", "fining", "fiords", "fireds", "firm", "firmas", "firmers", "firms", "firmus", "firsts", "firths", "fishes", "fisting", "fitses", "fixe", "fixeds", "fixers", "fixes", "fizzes", "flakes", "flange", "flanges", "flanked", "flanned", "flasks", "flecks", "flicks", "fliers", "flirts", "focalling", "fold", "folds", "folies", "folked", "fonded", "fooded", "fooled", "footed", "forces", "fore", "fores", "forest", "forges", "forked", "form", "fortes", "fosses", "fountain", "fountaining", "fountains", "foyers", "fpsing", "freaked", "frieds", "friers", "fries", "frigged", "frog", "froms", "frores", "fros", "frsing", "fsbing", "fshing", "full", "fulling", "fulls", "fuming", "funded", "funs", "furies", "furzes", "fuseds", "fusees", "fusels", "fuses", "fusing", "fussing", "fuzing", "fwsing", "gabling", "gabs", "gadded", "gaeling", "gaited", "galaing", "galing", "gall", "galliing", "gallina", "galling", "gallings", "gallis", "galls", "gallus", "gand", "ganded", "gander", "gandied", "ganked", "gaoling", "garb", "garbs", "garded", "garment", "garnet", "gaseses", "gashes", "gassed", "gassies", "gatling", "gauched", "gauches", "gauching", "gauded", "gauling", "gausses", "gcsing", "gean", "geans", "gelids", "gellies", "gelling", "gelting", "genies", "gent", "genting", "gestaing", "gestes", "gesting", "getting", "gilling", "girded", "girled", "giroed", "gisting", "give", "givens", "gives", "gladded", "gladed", "glanced", "gland", "glanded", "glands", "glandsed", "glansed", "glares", "glass", "glasses", "glassy", "gleams", "glean", "gleans", "glides", "glises", "gofers", "gold", "golds", "gonded", "goners", "gooded", "goofed", "gooked", "gooned", "gooped", "goosed", "gorals", "gouached", "gouaches", "gouaching", "governs", "gpsing", "graces", "grad", "grades", "grads", "graf", "grafs", "grafts", "grails", "grains", "gram", "gramas", "gramps", "grams", "gran", "granded", "grands", "grange", "granged", "granges", "grans", "grants", "grapes", "graphs", "grases", "grasps", "grass", "grasses", "grassy", "gratas", "grates", "gratis", "graves", "gravis", "gray", "grays", "grazes", "greats", "grebes", "greylies", "greyly", "groaks", "groans", "groats", "grouch", "grouched", "grouches", "grouching", "groves", "grub", "grubs", "grunts", "gruses", "gsaing", "gsring", "guesting", "guests", "guiing", "guild", "guilds", "guiled", "guiles", "guilt", "guilty", "guises", "guising", "gull", "gulling", "gulls", "guns", "guses", "gushes", "gushing", "gussing", "gutses", "gutsing", "guying", "gyrans", "habits", "hacked", "hadded", "hagged", "haicks", "haiked", "hailing", "haired", "haje", "hakeas", "hakes", "halals", "hale", "halfing", "haling", "hall", "halling", "halls", "halming", "haloing", "halting", "halve", "halved", "halves", "halving", "hame", "hand", "handed", "handeds", "handel", "hander", "handied", "handled", "handsed", "hanged", "hangers", "harded", "harems", "hares", "harked", "harold", "harolds", "hart", "harvey", "hashes", "hassles", "hastes", "hasting", "hate", "hats", "hauling", "haved", "haven", "havens", "haves", "hawked", "hawses", "haze", "heating", "heave", "heaved", "heaven", "heaver", "heaves", "hectare", "hectares", "hefting", "heired", "heisting", "held", "helds", "helixes", "helling", "helves", "here", "hets", "hetting", "hexine", "hexined", "hexines", "hexining", "hexose", "hexoses", "hhsing", "hiatus", "hick", "hicked", "hicks", "hies", "hilling", "hilts", "hind", "hinded", "hinged", "hinges", "hins", "hints", "hips", "hire", "hired", "hirers", "hires", "hirtas", "hiss", "hisses", "hives", "hivs", "hoards", "hoared", "hoaxed", "hobbed", "hoboed", "hocced", "hocked", "hockey", "hodded", "hods", "hoed", "hogged", "hoists", "hokaed", "holcus", "holders", "holdups", "hole", "holed", "holes", "holeys", "holism", "hollas", "hollos", "holm", "holms", "holy", "homers", "homied", "homoed", "honied", "honked", "honker", "honkey", "honkied", "honored", "hooches", "hooching", "hood", "hooded", "hoodeds", "hoods", "hooeyed", "hoofed", "hoofeds", "hoofer", "hookah", "hookeds", "hooker", "hookeri", "hookers", "hookied", "hookies", "hooksed", "hookses", "hookup", "hooped", "hoopoed", "hoopsed", "hooted", "hooter", "hooved", "hooveds", "hoovers", "hopers", "hopied", "hopped", "hopple", "hopples", "hopsed", "horded", "hordes", "horned", "horsed", "hosing", "hosted", "hosting", "hotbed", "hots", "hotsed", "hotted", "hounds", "houred", "housed", "houses", "housing", "hover", "hovers", "hoyaed", "hrts", "hses", "hsing", "hucked", "huging", "hulked", "hull", "hulling", "hullos", "hulls", "hunged", "hunked", "huns", "huoned", "hushes", "hushing", "husked", "husking", "husoing", "huts", "hyoids", "ictalling", "idioted", "idlies", "iising", "ileals", "illing", "images", "impact", "impacting", "impacts", "impart", "imparting", "impartings", "imparts", "impasses", "impends", "implore", "implores", "imploring", "impoliting", "important", "importeds", "importeeing", "importees", "importers", "importinged", "importings", "importune", "importuning", "imposing", "impost", "imposting", "imposts", "improving", "impure", "impures", "impuring", "imputing", "inbuilt", "incise", "incite", "inclined", "inclosed", "include", "includeds", "includes", "income", "incomes", "indied", "indirect", "indirected", "indirects", "indite", "indited", "indole", "indoles", "inerting", "inerts", "inference", "inferences", "infidel", "influxed", "info", "inhabit", "inhabits", "inhere", "inhered", "inherent", "inherenting", "inherents", "inheriteds", "inheritinged", "inheritings", "inheritors", "inheritting", "inhibit", "inhibits", "initio", "inkied", "inland", "inlanded", "inline", "inosine", "inquire", "inquires", "insane", "insert", "inserting", "inserts", "insided", "insider", "insiders", "insides", "insist", "insoles", "inspire", "insted", "insting", "intake", "intakes", "intending", "interim", "interims", "intermit", "intermits", "inti", "intied", "intoed", "intones", "intos", "intro", "intron", "intros", "intruded", "invades", "invert", "inverting", "inverts", "invites", "invoice", "invoices", "involve", "involves", "iodide", "ipsing", "ired", "ires", "ironside", "irsing", "iruses", "ises", "isiing", "ising", "island", "islanded", "isling", "isming", "isning", "isring", "itsing", "iuding", "jailing", "jakes", "janned", "jawses", "jean", "jeans", "jellies", "jelling", "jest", "jesting", "jestings", "jests", "jetting", "jigger", "jiggers", "jirded", "jive", "jives", "jocked", "jokers", "jooked", "josing", "josses", "joules", "jove", "joves", "juking", "julies", "juning", "jure", "juring", "juses", "jussing", "justes", "juting", "kailing", "kakkes", "kalaing", "kaliing", "kaling", "kalkas", "karens", "karling", "kelpies", "kelting", "kepting", "kerite", "kerited", "kerites", "khanned", "kianged", "kickers", "kied", "killing", "kilned", "kina", "kinaed", "kinda", "kindas", "kindle", "kindly", "kinds", "kine", "kined", "king", "kinged", "kinked", "kinks", "kinned", "kino", "kinoed", "kins", "kiosks", "kirk", "kirked", "kirks", "kisses", "kith", "kleins", "klick", "klicks", "knacks", "knocks", "knucks", "koined", "kooked", "kookied", "kuiing", "kvasses", "kweeked", "kylies", "labbed", "lacced", "lacied", "lacked", "ladded", "ladder", "laddied", "laded", "ladied", "ladled", "ladling", "laed", "lagans", "lagend", "lagended", "lagged", "lahhed", "lahued", "laiced", "laid", "laided", "lairded", "lake", "lakes", "lakhed", "lallying", "lamaed", "lambed", "lament", "lammed", "lamnaed", "lamped", "lanaied", "lanated", "lanced", "lancer", "lances", "lancet", "landaued", "landeds", "lander", "landers", "landler", "lands", "lane", "lang", "langed", "langued", "lank", "lankaed", "lanked", "lankied", "lanned", "lansaed", "lanseh", "lanset", "lapped", "lapsed", "lapses", "lard", "larded", "larder", "larged", "laried", "larked", "larred", "lashed", "lashes", "lassas", "lasses", "lassies", "lassos", "lasted", "lasting", "latent", "latest", "latesting", "latests", "lathed", "latked", "latkes", "latsed", "latses", "latted", "lauans", "laud", "lauded", "lauder", "laudes", "launced", "launder", "lavaed", "laves", "lavved", "lawsed", "lawses", "laxaed", "lazied", "lead", "leaded", "leaden", "leadens", "leads", "leaf", "leafs", "leak", "leaked", "leaks", "leal", "leals", "leaners", "leap", "leaps", "learn", "learns", "leases", "leasting", "leaven", "leavens", "ledded", "lefting", "legals", "legends", "lemnas", "lemons", "lended", "lender", "lends", "lenifies", "lenify", "lens", "lensed", "lent", "lented", "lenting", "leon", "leones", "leons", "lesses", "lessing", "letting", "levants", "levees", "levels", "levited", "lewded", "lianaed", "lianas", "liared", "libels", "libred", "lice", "lices", "lick", "licks", "lidded", "lieded", "lieges", "lies", "life", "lifers", "lifes", "ligand", "liganded", "ligans", "ligers", "lignes", "like", "likeds", "likens", "likes", "limans", "lime", "limens", "limes", "limeys", "linden", "lindied", "line", "lineds", "linens", "liners", "lines", "linged", "linied", "linked", "linoed", "linted", "liraed", "lirred", "lises", "lisles", "listes", "listing", "lite", "liters", "lites", "lithes", "litred", "livedos", "livens", "livers", "livias", "livids", "llanoed", "llanos", "loached", "loaches", "loaching", "loaded", "loan", "loans", "localling", "loched", "loches", "loching", "locked", "lode", "lohans", "loired", "lolling", "loners", "longed", "looked", "looker", "looksed", "loomed", "looned", "looped", "loosed", "looted", "lorded", "losers", "losing", "losses", "losting", "louched", "louches", "louching", "louded", "loughed", "loughing", "loupes", "louses", "lousing", "louver", "louvers", "lover", "lovers", "lowans", "lowers", "lsding", "lubing", "lueses", "luesing", "luging", "lull", "lulling", "lulls", "lunaed", "lundaed", "lunged", "lunned", "luoing", "lure", "luring", "lushes", "lushing", "luting", "luxing", "lynxed", "mace", "macers", "maces", "maches", "mackems", "mackle", "mackles", "madake", "madakes", "madded", "made", "mades", "maes", "magens", "mahoes", "maided", "mailing", "maines", "maired", "maizes", "makers", "makeups", "mako", "makos", "male", "maleos", "males", "maliing", "maliks", "maling", "mall", "malling", "malls", "malsing", "malting", "mameys", "mandaed", "manded", "mane", "maneds", "manes", "manied", "manies", "mankies", "manned", "mansed", "manxed", "manxes", "maples", "mapling", "mare", "mares", "marges", "maries", "markeds", "markers", "markets", "marling", "mart", "martes", "masers", "mases", "maskeds", "maskers", "mass", "massed", "masseds", "masses", "masting", "mate", "mateds", "maters", "mates", "mateys", "mattes", "mauling", "maunded", "maxes", "maybes", "maze", "mazeds", "mazers", "mazes", "mazies", "mealies", "mean", "means", "meating", "mediaed", "mediated", "medicied", "meeting", "meined", "meining", "melees", "melias", "melics", "melting", "mend", "mended", "mends", "mere", "merelies", "merely", "merited", "mesaing", "meshing", "mesning", "messes", "messing", "meting", "metrifies", "metrify", "mick", "micks", "mike", "mikes", "milling", "mind", "minded", "minified", "minifies", "minkes", "mire", "mired", "mires", "miried", "miries", "miroed", "mising", "misses", "misting", "mitred", "mitres", "mlsing", "mocked", "models", "modems", "modes", "modest", "modifieded", "modifiered", "modifiers", "modished", "modishes", "modisted", "modistes", "modses", "mogens", "mohaves", "mohses", "moired", "mojave", "mojaves", "mold", "molds", "mole", "moles", "molest", "molles", "mollified", "mollifies", "molling", "molvas", "mommies", "monded", "mondes", "monels", "moneys", "monked", "monses", "montan", "montanning", "montans", "montes", "mooched", "mooches", "mooching", "mooded", "mooned", "moored", "moosed", "mooses", "mooted", "mope", "mopeds", "mopes", "more", "morels", "mores", "morses", "mortified", "mortifies", "moses", "moseys", "moshes", "mosting", "mote", "motels", "motes", "motets", "motiffed", "motive", "motives", "moue", "moues", "moulds", "mountain", "mountaining", "mountains", "mousing", "mouthed", "mouthing", "moveds", "movie", "movies", "moxies", "mpsing", "mrsing", "msbing", "mscing", "mses", "msging", "mshing", "msing", "muanged", "muched", "muches", "muching", "muling", "mull", "mullas", "mulling", "mulls", "mullus", "muming", "musaing", "musding", "musers", "muses", "mushes", "mushing", "musing", "musings", "musking", "mussing", "muting", "mutually", "myalling", "myalls", "myopes", "nadded", "nailing", "naives", "nakeds", "nalline", "nanaed", "nanced", "nand", "nanded", "nandued", "nanned", "narded", "nashes", "nasuses", "nauched", "nauches", "nauching", "nave", "neating", "nemine", "nemined", "nemines", "nemining", "nerves", "nervies", "nesses", "nessing", "nest", "nesting", "nestings", "nestling", "nests", "netting", "nevers", "newlies", "newting", "nexted", "nexting", "nick", "nicks", "nigger", "niggers", "nilling", "nisied", "nisting", "nitred", "nitres", "niveas", "nivose", "nivoses", "nocked", "node", "noired", "noires", "nolling", "nonuple", "nonuples", "nooked", "nookied", "nooksed", "nooned", "noosed", "nosing", "notched", "notches", "notching", "notified", "notifies", "nouses", "nousing", "nsaing", "nscing", "nsfing", "nsuing", "nswing", "nuding", "nuited", "nuking", "null", "nulling", "nulls", "nuns", "nurses", "nursing", "nutses", "nutsing", "nuxing", "oakens", "oasing", "oasises", "oasting", "oatses", "obtain", "obtaining", "obtains", "occluded", "oceans", "ochers", "octalling", "octuple", "octuples", "odisted", "ogives", "oilies", "oising", "olds", "olefine", "olefined", "olefines", "olefining", "oleins", "olive", "olives", "onlies", "onto", "onuses", "opalling", "opiated", "oppose", "opposes", "opulus", "opuses", "oralling", "orange", "oranged", "oranges", "oses", "osing", "otuses", "ouring", "ousels", "outclass", "outclasses", "outclassing", "outdated", "outing", "outrigger", "outriggers", "ovalling", "over", "overs", "overts", "pacoses", "pacs", "pact", "padded", "padres", "pads", "paduses", "paeans", "pageant", "pageses", "paided", "pailing", "painses", "paired", "paks", "palases", "paliing", "paling", "palling", "pallying", "palming", "palmses", "paloing", "pals", "palsies", "pandaed", "pander", "pangses", "panned", "pans", "pansies", "pant", "panted", "pantses", "paps", "para", "parang", "pare", "parental", "parented", "parents", "parers", "pareve", "pari", "paries", "paring", "parises", "parity", "park", "parr", "parsec", "parsecs", "parsed", "parsee", "parsees", "parser", "parsers", "parses", "parted", "parti", "partis", "partly", "parts", "partses", "party", "paruses", "parvenu", "parves", "pasches", "paso", "pasoed", "pasos", "pasques", "passages", "passed", "passeds", "passee", "passeed", "passees", "passel", "passels", "passer", "passers", "passims", "passives", "passkey", "passkeys", "passu", "passued", "passus", "pasted", "pasteds", "pastel", "pastels", "paster", "pasters", "pastes", "pasties", "pasting", "pastises", "pasts", "patases", "patens", "patent", "patents", "patient", "pats", "patsies", "pauling", "paulis", "paused", "pauses", "pausing", "pave", "pavises", "pawling", "paws", "payees", "payment", "pays", "pbsing", "peaked", "pean", "peans", "peated", "peating", "pecans", "pecses", "pekans", "pelling", "pelting", "pent", "penting", "percent", "pere", "pert", "perting", "perves", "pesoing", "pessed", "pessing", "pest", "pesting", "pestis", "pestling", "pestoing", "pestos", "pests", "petited", "petrifies", "petrify", "petting", "phaged", "pharos", "pholis", "phsing", "pick", "picks", "piered", "pigses", "pill", "pilling", "pills", "pinses", "pinto", "pintos", "pisces", "piss", "pissed", "pisseds", "pisser", "pissers", "pisses", "pistes", "pisting", "pith", "pitses", "plaided", "planaed", "planked", "planned", "planted", "plashes", "plated", "pleads", "pleats", "plover", "plovers", "pmsing", "poached", "poaches", "poaching", "pocked", "poises", "pokers", "polers", "polies", "poll", "polling", "pollos", "polls", "pommies", "ponded", "ponses", "pooched", "pooches", "pooching", "pooded", "poofed", "pooled", "pooned", "pooped", "poored", "pooved", "pooves", "porched", "porches", "porching", "porked", "port", "portent", "posers", "poshes", "posies", "posing", "posits", "possed", "posses", "possess", "posset", "possets", "postes", "posting", "potent", "pouch", "pouched", "pouches", "pouching", "powers", "praises", "pranged", "prat", "prated", "preference", "preferences", "prelims", "premies", "preses", "presses", "prexies", "pricks", "prigged", "prises", "prom", "proses", "proves", "prunes", "prunos", "prunus", "psaing", "psas", "pses", "psiing", "psing", "pucing", "puking", "pula", "pulas", "pule", "pules", "puling", "pullers", "pullets", "pulleys", "pulling", "pulp", "pulps", "pulsing", "puns", "pupals", "pupated", "pupils", "pure", "purelies", "purely", "purifies", "purify", "puring", "purl", "purls", "pursing", "puses", "pushing", "puss", "pussed", "pusses", "pussies", "pussing", "pyrene", "qianged", "quaing", "quakes", "quares", "quells", "questing", "quests", "quicks", "quiing", "quilt", "quired", "quited", "quoing", "quolls", "rabies", "racies", "radded", "raided", "railing", "raises", "rake", "rakes", "raling", "rallies", "rallying", "ramies", "ranaed", "rand", "randed", "randied", "raneed", "ranges", "ranied", "ranked", "ranted", "rarelies", "rarely", "rarifies", "rarify", "rashes", "rasing", "rassed", "rave", "ravers", "readies", "realines", "realise", "realises", "realizes", "reallies", "really", "realties", "realty", "reaves", "rebuild", "rebuilds", "reburies", "recall", "recalling", "recalls", "recces", "reccies", "recipes", "recited", "recites", "reclines", "recode", "recommits", "recover", "recovers", "redefine", "redefined", "redefines", "redefining", "redlines", "reedies", "reefies", "reeves", "referee", "referees", "referenceds", "referent", "refine", "refined", "refiners", "refines", "refining", "refinings", "refits", "regias", "regimes", "regius", "reined", "reining", "reited", "reiting", "rejigs", "relaces", "relates", "relaxes", "relay", "relics", "relict", "relicts", "relied", "relief", "reliefs", "relieve", "relieves", "relievo", "relievos", "relines", "relining", "relish", "relishes", "relived", "relives", "remake", "remakes", "remise", "remises", "remiss", "remits", "remove", "removes", "rend", "rended", "rends", "renins", "renises", "rent", "rentes", "renting", "repands", "repens", "repents", "repine", "repined", "repining", "replay", "replied", "replies", "reply", "repose", "reposes", "requiems", "requireds", "requite", "requites", "requote", "requotes", "reruns", "resets", "reshes", "reshing", "reside", "resides", "resids", "resiles", "resins", "resizes", "respire", "respires", "ressing", "rest", "resting", "restings", "rests", "retied", "reties", "reting", "retire", "retouch", "retouched", "retouches", "retouching", "retries", "retting", "reusing", "reverence", "reverences", "revers", "review", "reviews", "reviles", "revise", "revises", "revive", "revoke", "revokes", "revues", "rewire", "rewired", "rhuses", "rick", "ricks", "rigged", "riggeds", "rigger", "riggers", "rilling", "rimies", "rind", "rinded", "ringer", "ringers", "ringside", "rising", "risses", "rive", "rives", "rivets", "roached", "roaches", "roaching", "rocked", "rogers", "roilies", "rolling", "rons", "rooded", "roofed", "rooked", "rookied", "roomed", "rooted", "ropers", "ropies", "rosies", "rosing", "rouble", "roubles", "roughed", "roughing", "rounds", "rouses", "rousing", "rove", "rover", "rovers", "roves", "rowers", "rubens", "rubies", "rubing", "rubins", "rubs", "rudelies", "rudely", "ruding", "rues", "rugger", "ruggers", "rugs", "ruins", "rulied", "rulies", "ruling", "ruly", "rumens", "rums", "rune", "runes", "rung", "rungs", "runics", "runing", "runt", "runts", "runups", "ruses", "rushes", "rushing", "rusing", "rusking", "russing", "ruts", "saales", "saaling", "saames", "sabling", "sabres", "sadded", "saided", "sailing", "saints", "saises", "sake", "sakes", "salals", "saling", "salk", "salking", "salks", "salling", "sallying", "salols", "salping", "salting", "salving", "sand", "sanded", "sander", "sandied", "sandsed", "sanned", "sansed", "sanses", "sapling", "sarded", "sarees", "sashes", "sass", "sassed", "sasses", "sassies", "sats", "saurel", "save", "savers", "scalding", "scalds", "scaling", "scalping", "scalps", "scalying", "scapes", "scarce", "scarces", "scare", "scareds", "scarers", "scares", "scarfs", "scaries", "scarps", "scends", "schick", "schicks", "scired", "scoked", "scolds", "scorer", "scorers", "scores", "scoter", "scoters", "scruple", "scruples", "sculling", "seaport", "seaporting", "seaports", "seareds", "seases", "seating", "seaxes", "secluded", "secting", "secure", "sedans", "seined", "seines", "seining", "selling", "semited", "send", "sended", "sends", "sent", "senting", "septing", "sequine", "sequines", "serifs", "serined", "serining", "serves", "sesses", "sessing", "sets", "setting", "severs", "sexies", "sexpot", "sexpots", "sexpotting", "sexted", "sexting", "shabus", "shade", "shadeds", "shades", "shadies", "shafts", "shagged", "shake", "shakens", "shakers", "shakes", "shakies", "shakos", "shale", "shales", "shame", "shameds", "shames", "shamus", "shanged", "shanked", "shanks", "shanned", "shape", "shapeds", "shapers", "shapes", "shard", "shards", "shareds", "sharers", "shareses", "sharias", "shark", "sharks", "sharons", "sharp", "sharpens", "sharpers", "sharpie", "sharpies", "sharps", "shart", "sharts", "shaveds", "shavens", "shavers", "shaves", "shawls", "shawms", "sheareds", "shearers", "shearses", "sheers", "sheiks", "sherds", "shines", "shinto", "shire", "shires", "shirks", "shirrs", "shited", "shnooked", "shocked", "shocks", "shoeds", "shooed", "shooked", "shooted", "shore", "shoreas", "shores", "shorns", "shorts", "shotes", "shover", "shovers", "shreds", "shrews", "shrive", "shrives", "shucks", "sibs", "sick", "sicks", "sics", "sids", "sieves", "sifts", "sights", "silling", "silts", "sind", "sinded", "sing", "sins", "sips", "sirced", "sired", "sirens", "sires", "sirred", "sirs", "sising", "siss", "sisses", "sitars", "site", "sites", "sitkas", "sittas", "situ", "situs", "sitz", "sitzes", "sixths", "skates", "skinks", "skints", "skirts", "skits", "skives", "skulls", "slander", "slanted", "slates", "slices", "slicks", "slides", "slimes", "slits", "slivers", "slouch", "slouched", "slouches", "slouching", "slsing", "smalling", "smalls", "smarms", "smarts", "smited", "smites", "smiths", "smoked", "snare", "snarers", "snares", "snarfs", "snarls", "sneaked", "snicks", "snigger", "sniggers", "snits", "snooked", "snores", "soaked", "sobers", "socked", "solare", "solares", "sold", "solds", "solids", "solling", "solver", "solvers", "solves", "sooned", "sooted", "sore", "sorelies", "sorely", "sots", "souchong", "soughed", "soughing", "souked", "soupies", "source", "soured", "souses", "sousing", "southed", "southing", "sowers", "spaces", "spades", "spalling", "spanged", "spare", "sparers", "spares", "sparge", "sparges", "sparks", "spasms", "spated", "spates", "spazes", "speaked", "specks", "spells", "sphere", "spheres", "spicks", "spills", "spinto", "spired", "spirts", "spited", "spites", "spits", "splits", "spoked", "spooked", "spores", "sprigger", "spriggers", "sprits", "spurge", "squally", "squares", "squires", "ssaing", "sses", "ssing", "ssping", "sssing", "sswing", "stacks", "stages", "stalk", "stalks", "stalling", "standed", "stands", "stanks", "stapes", "stare", "starers", "stares", "starets", "starses", "starts", "starve", "starves", "states", "staves", "steads", "steaked", "steeds", "stenting", "stetting", "sticks", "stilts", "stints", "stoked", "stores", "stover", "stovers", "stoves", "streaked", "stringer", "stringers", "strive", "strives", "suaves", "subclassed", "suched", "suches", "suching", "sucre", "sucred", "sudated", "sudses", "sudsing", "suer", "suered", "sues", "suiing", "suing", "suited", "suites", "suits", "sullas", "summits", "sundated", "sunglass", "sunglasses", "sunglassing", "suns", "superclassed", "supergrass", "supergrasses", "sura", "suraed", "surd", "surded", "sured", "surelies", "sures", "surety", "surf", "surfed", "surfer", "surge", "surged", "surges", "suring", "surrey", "survey", "suses", "sussing", "suture", "swages", "swales", "swards", "swarms", "swarts", "sweared", "sweated", "swerve", "swifts", "swined", "swiped", "swirled", "switch", "taaling", "tables", "tabling", "tabses", "tached", "taches", "taching", "tack", "tacks", "tacting", "tadded", "taeling", "tagger", "taggers", "tailing", "tajiks", "take", "takens", "takers", "takes", "tala", "talaing", "talas", "talc", "talcing", "talcs", "tale", "talent", "tales", "taling", "talkers", "talkies", "talking", "talksed", "talkses", "talling", "tallying", "talons", "talus", "tandem", "tank", "tankas", "tanked", "tanks", "tanned", "taoses", "tapses", "tart", "tarting", "task", "tasking", "tasks", "tassed", "tassel", "tassels", "tasses", "tasset", "tassets", "tassing", "tasting", "tastings", "tastying", "tatting", "tauting", "tawses", "tdting", "teached", "teaches", "teaching", "teaing", "teaked", "teaking", "tealed", "tealing", "teamed", "teaming", "teared", "tearing", "teased", "teases", "teasing", "teasling", "teat", "teated", "teating", "teats", "tebets", "teccing", "teched", "teches", "tectaing", "tectas", "tedding", "teds", "teed", "teeing", "teeming", "teened", "teening", "teething", "teeths", "teffing", "tegging", "teiids", "tejuing", "tellies", "temming", "temping", "tempting", "tempts", "tenched", "tenches", "tenching", "tendeds", "tenders", "tendons", "tenens", "tenged", "tenges", "tenging", "tenias", "tenned", "tenning", "tennis", "tennos", "tenons", "tenors", "tensed", "tenseds", "tensing", "tented", "tenthing", "tenting", "tentings", "tenuis", "tepids", "teraing", "tercing", "tereting", "terming", "terned", "terning", "terrifies", "terrify", "terses", "tersing", "teslaing", "teslas", "testaing", "testas", "testating", "testeds", "testeeing", "testees", "testers", "testes", "testied", "testify", "testily", "testinged", "testings", "testis", "testying", "tether", "tething", "tetting", "tevets", "texans", "text", "texted", "textes", "texting", "textings", "texts", "thaned", "thanked", "thanks", "thanned", "thecas", "thefting", "thefts", "theist", "theisting", "theists", "theres", "thesis", "thinged", "tholed", "tholes", "thonged", "thorough", "thoroughs", "thought", "thrive", "thrives", "throng", "throngs", "throughed", "throughs", "thrush", "thuses", "ticalling", "tick", "ticks", "tiered", "tigers", "tilling", "tilting", "tineds", "tinting", "tire", "tired", "tires", "tiroed", "titred", "titres", "titting", "tnting", "toasting", "toasts", "toeaed", "toeses", "toesing", "togethers", "told", "tolds", "tolling", "tommies", "tomtits", "toneds", "toners", "tontining", "tooled", "tooned", "tooted", "toothed", "toothing", "tooting", "topers", "toposes", "topple", "topples", "torch", "torched", "torches", "torching", "torting", "toshed", "toshes", "tosked", "tosking", "tosses", "tossing", "toters", "toting", "totting", "toucan", "toucans", "touchers", "touchied", "touchies", "touchinged", "touchingly", "touchings", "touchline", "touchy", "touchying", "tough", "toughed", "toughens", "toughied", "toughies", "toughing", "toughying", "touped", "toupee", "toupeed", "touping", "toured", "touring", "tousle", "tousled", "tousling", "touted", "towers", "tracks", "transitive", "transitived", "transitives", "transitivity", "treaded", "treads", "treated", "treating", "treats", "treeds", "trekked", "trend", "trends", "trenting", "tressing", "trestling", "triage", "triaged", "tricker", "trickers", "tricks", "triers", "trifler", "triflers", "trigged", "trimer", "trimers", "trimmer", "trimmers", "tripper", "trippers", "trited", "triting", "troched", "troches", "troching", "trough", "troughed", "troughing", "troughs", "troves", "truced", "truces", "trucing", "trucked", "trucking", "trudger", "trudgers", "trulies", "trunks", "trusting", "trusts", "truthed", "truthing", "trysting", "trysts", "tsetse", "tsetsing", "tubing", "tucked", "tucking", "tufting", "tugger", "tuggers", "tuling", "tulles", "tulling", "tumses", "tumsing", "tuning", "tuns", "turing", "tushed", "tutting", "tuxing", "twanged", "tweaks", "tweeded", "tweeds", "tweeped", "tweeted", "tweeting", "tweets", "tweezed", "twelved", "twenty", "twerked", "twerped", "twiced", "twigged", "twined", "twirled", "twirped", "twisting", "twists", "twitch", "ufoing", "uglies", "uhfing", "uing", "ukases", "ukasing", "ukes", "uking", "ulls", "ulting", "umaing", "umping", "unchanged", "unclouded", "uncouple", "uncouples", "uncover", "uncovers", "undated", "undateds", "undefined", "unding", "unedited", "unhooked", "uniated", "uning", "united", "unkind", "unlive", "unlives", "unmake", "unmakes", "unmated", "unmodified", "unqing", "unsated", "unsees", "unsung", "unsure", "untouched", "unusually", "unwired", "unyoke", "unyokes", "upbeated", "upcasted", "update", "updates", "updrafted", "uphold", "upholds", "uping", "upland", "uplanded", "upsets", "upside", "uptaked", "upvoted", "urated", "urging", "urling", "urning", "urns", "ursine", "uruses", "usages", "usaging", "usaing", "usas", "usbegs", "usbeks", "uscbing", "usdaed", "usdaing", "used", "useds", "user", "users", "ushers", "usinged", "usings", "usmcing", "usneas", "usning", "usns", "usps", "uspses", "uspsing", "usss", "usssing", "usualed", "usuals", "usurer", "utaing", "utcing", "utes", "uting", "utning", "uubing", "uuhing", "uuping", "uuqing", "uuting", "uving", "uziing", "valiing", "valing", "valling", "valses", "valsing", "valuing", "valving", "vandaed", "vanned", "varment", "vasing", "vassed", "vasting", "vedisted", "vegans", "veined", "veines", "veining", "vend", "vended", "vends", "vent", "venting", "verbified", "verbifies", "verbify", "veridis", "veridises", "veried", "verified", "verifieds", "verifier", "verifiers", "verited", "veritied", "verities", "verity", "versified", "versifier", "versifiers", "versifies", "versify", "versting", "versts", "verting", "verves", "vest", "vesting", "vests", "vetting", "vianded", "vilifies", "vilify", "vinifies", "vinify", "virens", "vireos", "vising", "visits", "visually", "vitrifies", "vitrify", "vive", "vives", "vivifies", "vivify", "vivred", "vocalling", "vomers", "vomits", "voters", "vouch", "vouched", "voucheed", "vouchees", "vouchers", "vouches", "vouching", "vowers", "wadded", "wadses", "waifed", "wailed", "wailing", "wained", "waived", "waives", "wake", "wakens", "wakers", "wakes", "waling", "walk", "walking", "walks", "wall", "walling", "wallings", "walls", "wallying", "wand", "wanded", "wander", "wanked", "wanned", "want", "wanted", "ware", "wared", "waried", "warmed", "warned", "warped", "warred", "warsed", "warses", "wart", "warted", "washes", "wassed", "wastes", "wasting", "watses", "wauling", "wave", "wavers", "wawling", "wayses", "wbsing", "weaked", "weaken", "wealed", "wean", "weaned", "weans", "wearer", "weaved", "weeked", "weft", "wefting", "weirded", "weired", "wekaed", "welling", "welt", "welting", "wended", "wends", "wens", "weres", "westing", "wests", "wetting", "whacks", "whales", "whanged", "wharfs", "whelks", "whiled", "whined", "whirled", "whirred", "whists", "whites", "whits", "wholed", "wholes", "whooped", "whored", "whores", "wick", "wicked", "wicks", "wided", "width", "widths", "wifed", "wified", "wigged", "wilded", "wiled", "wilied", "wilies", "willed", "willing", "wilted", "wimped", "winced", "wind", "wined", "winged", "winied", "winked", "winned", "winoed", "wiped", "wipeds", "wireds", "wirer", "wiried", "wised", "wisent", "wish", "wished", "wising", "wisped", "witch", "withal", "withe", "wither", "withes", "within", "withs", "withy", "witsed", "witted", "wive", "wived", "wives", "wizzed", "wlanned", "wokked", "wold", "wolds", "wonked", "wont", "wooded", "wooers", "woofed", "wooled", "worded", "worlds", "wormed", "worned", "worsed", "worted", "woulds", "wove", "woves", "wraith", "wrasses", "wreaked", "wrecks", "wresting", "wrests", "wricks", "wried", "wriggler", "wrigglers", "wringer", "wringers", "writhe", "wswing", "wussing", "wyrded", "xmases", "yanaed", "yanked", "yarded", "yawling", "yawses", "yearns", "yeasting", "yeasts", "yelling", "yessing", "yetting", "yolked", "yorked", "youthed", "youthing", "yuling", "yuses", "yussing", "zaired", "zaires", "zanied", "zend", "zended", "zends", "zest", "zesting", "zests", "zestying", "zeuses", "zeusing", "zhuanged", "zilling", "zonked", "zoomed", "zooted"] };
    }
  });

  // src/domain/interpret/fuzzy.mjs
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + cost);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }
  function eligibleForCanon(w) {
    return /^[a-z]+$/.test(w) && !STOPWORDS2.has(w) && !VOCAB_WORDS.has(w);
  }
  function fuzzyVocabWord(w) {
    if (isRealEnglishWord(w)) return null;
    return fuzzyMatchInSet(w, FUZZY_TARGET_WORDS, fuzzyBound(w));
  }
  function fuzzyMatchInSet(w, candidates, bound = fuzzyBound(w)) {
    let best = bound + 1;
    let hit2 = null;
    let tied = false;
    for (const target of candidates) {
      const d = editDistance(w, target, Math.min(best, bound));
      if (d < best) {
        best = d;
        hit2 = target;
        tied = false;
      } else if (d === best && d <= bound && target !== hit2) tied = true;
    }
    return best <= bound && !tied ? hit2 : null;
  }
  var NEVER_CANONICALIZE, fuzzyBound, VOCAB_WORDS, FUZZY_REPAIR_MIN_LENGTH, FUZZY_TARGET_WORDS, REAL_WORD_COLLISIONS, isRealEnglishWord;
  var init_fuzzy = __esm({
    "src/domain/interpret/fuzzy.mjs"() {
      init_ask_vocab();
      init_real_word_collisions();
      init_normalize();
      NEVER_CANONICALIZE = ["used"];
      fuzzyBound = (s) => s.length <= 5 ? 1 : 2;
      VOCAB_WORDS = new Set(
        [
          ...Object.keys(VERB_TO_KIND),
          ...Object.keys(ENTITY_TO_TYPE),
          ...Object.keys(MODIFIER_TO_KIND),
          ...NEVER_CANONICALIZE
        ].flatMap((p) => p.split(" "))
      );
      FUZZY_REPAIR_MIN_LENGTH = 4;
      FUZZY_TARGET_WORDS = [...new Set(
        [...Object.keys(VERB_TO_KIND), ...Object.keys(MODIFIER_TO_KIND)].flatMap((p) => p.split(" ")).filter((w) => w.length >= FUZZY_REPAIR_MIN_LENGTH)
      )];
      REAL_WORD_COLLISIONS = new Set(real_word_collisions_default.words);
      isRealEnglishWord = (w) => REAL_WORD_COLLISIONS.has(w);
    }
  });

  // src/domain/interpret/strategies/grammar.mjs
  function parseAnchored(text) {
    for (const t of TEMPLATES) {
      const m = text.match(t.re);
      if (m) {
        const parsed = t.build(m);
        if (parsed) return parsed;
      }
    }
    return null;
  }
  var VERB_ALT, ENTITY_ALT, MODIFIER_ALT, META_ALT, TEMPLATES, grammarStrategy;
  var init_grammar = __esm({
    "src/domain/interpret/strategies/grammar.mjs"() {
      init_ask_vocab();
      init_normalize();
      VERB_ALT = Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      ENTITY_ALT = Object.keys(ENTITY_TO_TYPE).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      MODIFIER_ALT = Object.keys(MODIFIER_TO_KIND).sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      META_ALT = META_MEANING_VERBS.slice().sort((a, b) => b.length - a.length).map(escapeRegex).join("|");
      TEMPLATES = [
        // T1 ASK: "does X import Y" -> Yes/No. REVERSE VERB SWAP: a semantically-reverse
        // verb ("superclass of") means the opposite of its forward counterpart, so
        // INHERITS_REVERSE_VERBS (ask-vocab.mjs) swaps subject/object here at parse time.
        {
          name: "ask",
          re: new RegExp(`^(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
          build: (m) => {
            const verb = m[2].toLowerCase();
            const kind = VERB_TO_KIND[verb];
            let subject = m[1].trim();
            let object = m[3].trim();
            if (INHERITS_REVERSE_VERBS.includes(verb)) [subject, object] = [object, subject];
            return { shape: "ask", entityType: null, modifier: "direct", kind, subject, object };
          }
        },
        // T2 reverse: "which <entity> [<modifier>] <verb> <object>".
        {
          name: "reverse",
          re: new RegExp(`^which\\s+(${ENTITY_ALT})\\s+(?:(${MODIFIER_ALT})\\s+)?(${VERB_ALT})\\s+(.+?)\\??$`, "i"),
          build: (m) => ({
            shape: "reverse",
            entityType: ENTITY_TO_TYPE[m[1].toLowerCase()],
            modifier: m[2] ? MODIFIER_TO_KIND[m[2].toLowerCase()] : "direct",
            kind: VERB_TO_KIND[m[3].toLowerCase()],
            object: m[4].trim()
          })
        },
        // T3 forward: "what does <object> <verb>" — X is given, list its R-related things.
        // "did" joins does/do for the past-tense commit forms ("what did commit <sha> touch").
        {
          name: "forward",
          re: new RegExp(`^what\\s+(?:does|do|did)\\s+(.+?)\\s+(${VERB_ALT})\\??$`, "i"),
          build: (m) => ({
            shape: "forward",
            entityType: null,
            modifier: "direct",
            kind: VERB_TO_KIND[m[2].toLowerCase()],
            object: m[1].trim()
          })
        },
        // T4 meta: "what does <term> mean" — a question about the graph's own vocabulary,
        // not a graph traversal. VERB_ALT and META_ALT are disjoint tables, so this never
        // competes with T3 for the same input.
        {
          name: "meta-mean",
          re: new RegExp(`^what\\s+(?:does|do|is|are)\\s+(.+?)\\s+(?:${META_ALT})\\??$`, "i"),
          build: (m) => ({ shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: m[1].trim() })
        },
        // T5 meta: "what is a/an <term>" — the bare (no-article) form is restricted to
        // the closed ENTITY_TO_TYPE vocabulary (build() -> null otherwise, falling
        // through); the WITH-article form is unrestricted.
        {
          name: "meta-whatis",
          re: new RegExp(`^what\\s+(?:is|are)\\s+(?:(an?)\\s+)?(.+?)\\??$`, "i"),
          build: (m) => {
            const object = stripTrailingDiscourseTag(m[2].trim());
            if (!m[1] && !ENTITY_TO_TYPE[object.toLowerCase()]) return null;
            const objLower = object.toLowerCase();
            if (m[1] && ARTICLE_RELATION_CONTINUATIONS.some(
              (c) => objLower === c || objLower.startsWith(`${c} `)
            )) return null;
            return { shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: stripTrailingScopeFiller(object) };
          }
        },
        // T6 mention: "where is <term> mentioned/referenced" — the prose/mentions surface.
        // Tried BEFORE T7: T7's trailing marker is optional,
        // so without this ordering it would swallow the mention question and lose the
        // marker that distinguishes "locate the definition" from "list the prose mentions".
        {
          name: "mention",
          re: new RegExp(`^where\\s+(?:is|are|was|were)\\s+(.+?)\\s+(?:${MENTION_MARKERS.map(escapeRegex).join("|")})\\??$`, "i"),
          build: (m) => ({ shape: "mentions", entityType: null, modifier: "direct", kind: "mentions", object: m[1].trim() })
        },
        // T7 where: "where is <term> [defined|declared|located|implemented]" — definition
        // location off the site attribute / defining module. "where" starts no other
        // template, so precedence against T1-T5 is structural.
        {
          name: "where",
          re: new RegExp(`^where\\s+(?:is|are|was|were)\\s+(.+?)(?:\\s+(?:${WHERE_MARKERS.map(escapeRegex).join("|")}))?\\??$`, "i"),
          build: (m) => ({ shape: "where", entityType: null, modifier: "direct", kind: "where", object: m[1].trim() })
        },
        // T8 when: "when did <term> [last] change/touched/updated…" — temporal shape over
        // the touches edges + commit date attributes. The verb slot reuses VERB_ALT, but
        // only the touches family carries dates to answer with, so build() rejects any
        // other kind (returning null falls through — parseAnchored tolerates it) rather
        // than pretending "when did X import Y" has a temporal answer.
        {
          name: "when",
          re: new RegExp(`^when\\s+(?:did|does|do|was|were|is)\\s+(.+?)\\s+(?:last\\s+)?(${VERB_ALT})\\??$`, "i"),
          build: (m) => VERB_TO_KIND[m[2].toLowerCase()] === "touches" ? { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() } : null
        },
        // T9 commit-history NP: "the commit history of X" / "commit history for X" —
        // an NP form of T8's SAME "when did X change" intent; reuses shape="when"
        // verbatim so evaluation/rendering are byte-identical, only the recognizer
        // surface differs.
        {
          name: "commit-history",
          re: /^(?:the\s+)?commit\s+history\s+(?:of|for)\s+(.+?)\??$/i,
          build: (m) => ({ shape: "when", entityType: null, modifier: "direct", kind: "touches", object: m[1].trim() })
        },
        // T10 cochange-partners NP: "cochange partners of X" — an NP form of the
        // existing "which modules cochange with X" verb-phrase shape (ask-vocab.mjs's
        // cochange verb table); reuses shape="reverse"/kind="cochange" so evaluation
        // is byte-identical.
        {
          name: "cochange-partners",
          re: /^co-?change\s+partners\s+(?:of|for|with)\s+(.+?)\??$/i,
          build: (m) => ({ shape: "reverse", entityType: "Module", modifier: "direct", kind: "cochange", object: m[1].trim() })
        }
      ];
      grammarStrategy = {
        id: "grammar",
        class: "graph-query",
        run(text) {
          const parsed = parseAnchored(text);
          return parsed ? { strategyId: "grammar", class: "graph-query", candidates: [{ parsed, confidence: 0.9 }] } : null;
        }
      };
    }
  });

  // src/domain/interpret/strategies/keywords.mjs
  function findPhrase(lcWords, table, consumed = null) {
    const phrases = Object.keys(table).sort((a, b) => b.split(" ").length - a.split(" ").length);
    for (const p of phrases) {
      const pWords = p.split(" ");
      for (let i = 0; i <= lcWords.length - pWords.length; i += 1) {
        if (consumed && pWords.some((_, j) => consumed.has(i + j))) continue;
        if (pWords.every((w, j) => lcWords[i + j] === w)) return { kind: table[p], start: i, end: i + pWords.length };
      }
    }
    return null;
  }
  function parseKeywordSpot(text, nlp = null) {
    const words = text.replace(/\?+\s*$/, "").replace(/,/g, " ").split(/\s+/).filter(Boolean);
    const lcWords = words.map((w) => w.toLowerCase());
    if (lcWords.includes("where") && !findPhrase(lcWords, VERB_TO_KIND)) {
      const mention = lcWords.some((w) => MENTION_MARKERS.includes(w));
      const markers = /* @__PURE__ */ new Set([...WHERE_MARKERS, ...MENTION_MARKERS]);
      const objText = words.filter((w, i) => !STOPWORDS2.has(lcWords[i]) && !markers.has(lcWords[i])).join(" ").trim();
      if (objText) {
        const kind2 = mention ? "mentions" : "where";
        return { shape: kind2, entityType: null, modifier: "direct", kind: kind2, object: objText };
      }
    }
    const PERFECT_AUX = /* @__PURE__ */ new Set(["has", "have", "had"]);
    if (PERFECT_AUX.has(lcWords[0])) {
      let end = lcWords.length;
      while (end > 1 && (lcWords[end - 1] === "ever" || lcWords[end - 1] === "been")) end -= 1;
      const tailVerb = end > 1 ? VERB_TO_KIND[lcWords[end - 1]] : null;
      if (tailVerb === "touches") {
        const objText = words.slice(1, end - 1).filter((_, j) => !STOPWORDS2.has(lcWords[1 + j])).join(" ").trim();
        if (objText) return { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText };
      }
    }
    let canonWords = lcWords;
    let verbHit = findPhrase(lcWords, VERB_TO_KIND);
    if (!verbHit && nlp) {
      const lemmaWords = lcWords.map((w) => {
        if (!eligibleForCanon(w)) return w;
        const l = nlp.lemma(w);
        return VOCAB_WORDS.has(l) ? l : w;
      });
      verbHit = findPhrase(lemmaWords, VERB_TO_KIND);
      if (verbHit) canonWords = lemmaWords;
    }
    let fuzzyVerb = null;
    if (!verbHit) {
      const fuzzyWords = lcWords.map((w) => w.length >= 4 && eligibleForCanon(w) ? fuzzyVocabWord(w) || w : w);
      verbHit = findPhrase(fuzzyWords, VERB_TO_KIND);
      if (verbHit) {
        canonWords = fuzzyWords;
        const offset = lcWords.slice(verbHit.start, verbHit.end).findIndex((w, i) => w !== fuzzyWords[verbHit.start + i]);
        const at = verbHit.start + Math.max(offset, 0);
        fuzzyVerb = { from: lcWords[at], to: fuzzyWords[at] };
      }
    }
    if (!verbHit && lcWords.includes("by")) {
      for (let i = 0; i < lcWords.length; i += 1) {
        const k = PASSIVE_PARTICIPLE_TO_KIND[lcWords[i]];
        if (k && lcWords.slice(0, i).some((w) => PASSIVE_AUX.has(w))) {
          verbHit = { kind: k, start: i, end: i + 1 };
          break;
        }
      }
    }
    if (!verbHit) return null;
    const stamp = (ast) => fuzzyVerb ? { ...ast, fuzzyVerb } : ast;
    if (nlp && verbHit.end - verbHit.start === 1) {
      const i = verbHit.start;
      const det = lcWords[i - 1];
      if ((det === "the" || det === "these" || det === "those") && lcWords[i + 1] === "of") {
        const tags = nlp.posTags(words);
        if (tags[i] === "NOUN") {
          const objText = words.slice(i + 2).filter((w, j) => !STOPWORDS2.has(lcWords[i + 2 + j])).join(" ").trim();
          if (objText) return stamp({ shape: "forward", entityType: null, modifier: "direct", kind: verbHit.kind, object: objText });
        }
      }
    }
    const consumed = /* @__PURE__ */ new Set();
    const mark = (hit2) => {
      if (hit2) for (let i = hit2.start; i < hit2.end; i += 1) consumed.add(i);
    };
    mark(verbHit);
    for (const [phrase, kind2] of Object.entries(VERB_TO_KIND)) {
      if (kind2 !== verbHit.kind) continue;
      const pWords = phrase.split(" ");
      const start = verbHit.end;
      if (pWords.every((w, j) => canonWords[start + j] === w)) {
        mark({ start, end: start + pWords.length });
        break;
      }
    }
    const entityHit = findPhrase(canonWords, ENTITY_TO_TYPE, consumed);
    mark(entityHit);
    const modifierHit = findPhrase(canonWords, MODIFIER_TO_KIND, consumed);
    mark(modifierHit);
    const sideText = (from, to) => words.slice(from, to).filter((_, j) => !consumed.has(from + j) && !STOPWORDS2.has(lcWords[from + j])).join(" ").trim();
    const beforeText = sideText(0, verbHit.start);
    const afterText = sideText(verbHit.end, words.length);
    const kind = verbHit.kind;
    const entityType = entityHit ? ENTITY_TO_TYPE[canonWords.slice(entityHit.start, entityHit.end).join(" ")] : null;
    const modifier = modifierHit ? MODIFIER_TO_KIND[canonWords.slice(modifierHit.start, modifierHit.end).join(" ")] : "direct";
    if (kind === "touches" && lcWords.includes("when")) {
      const objText = beforeText || afterText;
      if (objText) return stamp({ shape: "when", entityType: null, modifier: "direct", kind: "touches", object: objText });
    }
    if (kind === "touches" && lcWords.includes("who") && lcWords.includes("last")) {
      const objText = beforeText || afterText;
      if (objText) return stamp({ shape: "whoLast", entityType: null, modifier: "direct", kind: "touches", object: objText });
    }
    const byIdx = lcWords.indexOf("by");
    const passiveAuxIdx = lcWords.slice(0, verbHit.start).findIndex((w) => PASSIVE_AUX.has(w));
    const hasPassiveAux = passiveAuxIdx >= 0;
    const agentIsFronted = hasPassiveAux && passiveAuxIdx > byIdx;
    if (byIdx >= 0 && !consumed.has(byIdx) && hasPassiveAux) {
      const roleText = (from, to) => words.slice(from, to).filter((_, j) => {
        const i = from + j;
        const w = lcWords[i];
        return !consumed.has(i) && !STOPWORDS2.has(w) && w !== "by" && !PASSIVE_AUX.has(w) && !WH_WORDS.has(w) && !PLACEHOLDER_SET.has(w);
      }).join(" ").trim();
      const [patient, agent] = agentIsFronted ? [roleText(passiveAuxIdx + 1, words.length), roleText(byIdx + 1, passiveAuxIdx)] : [roleText(0, byIdx), roleText(byIdx + 1, words.length)];
      if (patient && agent) return stamp({ shape: "ask", entityType: null, modifier: "direct", kind, subject: agent, object: patient });
      if (agent) return stamp({ shape: "forward", entityType, modifier, kind, object: agent });
      if (patient) return stamp({ shape: "reverse", entityType, modifier, kind, object: patient });
    }
    if (beforeText && afterText) {
      const verbPhrase = canonWords.slice(verbHit.start, verbHit.end).join(" ");
      let subject = beforeText;
      let object = afterText;
      if (INHERITS_REVERSE_VERBS.includes(verbPhrase)) [subject, object] = [object, subject];
      return stamp({ shape: "ask", entityType: null, modifier: "direct", kind, subject, object });
    }
    if (afterText) return stamp({ shape: "reverse", entityType, modifier, kind, object: afterText });
    if (kind === "inherits" && !beforeText && entityHit && entityHit.start === verbHit.end) {
      const entityText = canonWords.slice(entityHit.start, entityHit.end).join(" ");
      if (entityText) return stamp({ shape: "reverse", entityType: null, modifier, kind, object: entityText });
    }
    if (beforeText && !afterText && hasPassiveAux && verbHit.end - verbHit.start === 1 && PASSIVE_PARTICIPLE_TO_KIND[lcWords[verbHit.start]]) {
      if (beforeText.split(/\s+/).length > 1) return null;
      if (kind === "touches") return stamp({ shape: "when", entityType: null, modifier: "direct", kind, object: beforeText });
      return stamp({ shape: "reverse", entityType, modifier, kind, object: beforeText });
    }
    if (beforeText) return stamp({ shape: "forward", entityType, modifier: "direct", kind, object: beforeText });
    return null;
  }
  var PASSIVE_AUX, WH_WORDS, PLACEHOLDER_SET, keywordSpotStrategy;
  var init_keywords = __esm({
    "src/domain/interpret/strategies/keywords.mjs"() {
      init_ask_vocab();
      init_normalize();
      init_fuzzy();
      PASSIVE_AUX = /* @__PURE__ */ new Set(["is", "are", "was", "were", "be", "been", "being", "get", "gets", "got"]);
      WH_WORDS = /* @__PURE__ */ new Set(["which", "what", "who", "whom", "whose"]);
      PLACEHOLDER_SET = new Set(PLACEHOLDER_NOUNS.map((w) => w.toLowerCase()));
      keywordSpotStrategy = {
        id: "keyword-spot",
        class: "graph-query",
        run(text, ctx = {}) {
          const parsed = parseKeywordSpot(text, ctx.nlp || null);
          return parsed ? { strategyId: "keyword-spot", class: "graph-query", candidates: [{ parsed, confidence: 0.7 }] } : null;
        }
      };
    }
  });

  // src/domain/interpret/strategies/noise-strip.mjs
  function maybeVerbNoiseWords(words, kept, nlp) {
    if (!nlp || typeof nlp.posTags !== "function" || !kept.length) return [];
    const keptSet = new Set(kept.map((w) => w.toLowerCase()));
    let tags;
    try {
      tags = nlp.posTags(words);
    } catch {
      return [];
    }
    const out = [];
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      const lc = w.toLowerCase();
      if (!/^[a-z]+$/.test(w) || KEEP.has(lc) || !keptSet.has(lc)) continue;
      if (tags[i] === "VERB") out.push(lc);
    }
    return out;
  }
  function stripNoise(text, nlp = null) {
    const words = splitWords(text);
    const kept = [];
    const dropped = [];
    for (const w of words) {
      const lc = w.toLowerCase();
      const strippable = /^[a-z]+$/.test(w) && !KEEP.has(lc) && (CURATED_NOISE.has(lc) || nlp && typeof nlp.isStopWord === "function" && nlp.isStopWord(lc));
      if (strippable) dropped.push(w);
      else kept.push(w);
    }
    const maybeNoise = maybeVerbNoiseWords(words, kept, nlp);
    return { text: kept.join(" "), dropped, maybeNoise };
  }
  var KEEP, CURATED_NOISE, noiseStripStrategy;
  var init_noise_strip = __esm({
    "src/domain/interpret/strategies/noise-strip.mjs"() {
      init_ask_vocab();
      init_normalize();
      init_grammar();
      init_keywords();
      KEEP = /* @__PURE__ */ new Set([
        ...STOPWORDS2,
        ...wordsOf(CONTEXT_PRONOUNS),
        ...wordsOf(Object.keys(VERB_TO_KIND)),
        ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
        ...wordsOf(Object.keys(MODIFIER_TO_KIND)),
        ...wordsOf(Object.keys(QUALIFIERS)),
        ...wordsOf(AGGREGATE_TRIGGERS),
        ...wordsOf(LIST_TRIGGERS),
        ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)),
        ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)),
        ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)),
        ...wordsOf(PLACEHOLDER_NOUNS),
        ...wordsOf(ANAPHORA_TRIGGERS),
        ...wordsOf(META_MEANING_VERBS),
        ...wordsOf(WHERE_MARKERS),
        ...wordsOf(MENTION_MARKERS),
        ...wordsOf(RELATIVE_PRONOUNS),
        ...wordsOf(Object.keys(CASCADE_SYNONYMS))
      ]);
      CURATED_NOISE = /* @__PURE__ */ new Set([...wordsOf(FILLER_WORDS), ...wordsOf(CASCADE_NOISE)]);
      noiseStripStrategy = {
        id: "noise-strip",
        class: "noise-stripped",
        run(text, ctx = {}) {
          if (parseAnchored(text)) return null;
          const { text: stripped, dropped, maybeNoise } = stripNoise(text, ctx.nlp || null);
          if (!dropped.length || !stripped) return null;
          const parsed = parseAnchored(stripped) || parseKeywordSpot(stripped, ctx.nlp || null);
          if (!parsed) return null;
          if (maybeNoise.length && (parsed.shape === "where" || parsed.shape === "mentions") && parsed.object) {
            const altObject = parsed.object.split(/\s+/).filter((w) => !maybeNoise.includes(w.toLowerCase())).join(" ").trim();
            if (altObject && altObject !== parsed.object) parsed.altObject = altObject;
          }
          return {
            strategyId: "noise-strip",
            class: "noise-stripped",
            candidates: [{ parsed, confidence: 0.75, note: `noise-stripped to "${stripped}"` }]
          };
        }
      };
    }
  });

  // adapter-stub-strategies/ace.mjs:./strategies/ace.mjs
  var aceStrategy;
  var init_ace = __esm({
    "adapter-stub-strategies/ace.mjs:./strategies/ace.mjs"() {
      aceStrategy = void 0;
    }
  });

  // adapter-stub-strategies/constructions.mjs:./strategies/constructions.mjs
  var constructionsStrategy;
  var init_constructions = __esm({
    "adapter-stub-strategies/constructions.mjs:./strategies/constructions.mjs"() {
      constructionsStrategy = void 0;
    }
  });

  // src/domain/interpret/merge.mjs
  function sameParse(p, q) {
    if (p.shape !== q.shape || p.kind !== q.kind) return false;
    if (p.shape === "ask") return cmpTerm(p.subject) === cmpTerm(q.subject) && cmpTerm(p.object) === cmpTerm(q.object);
    return cmpTerm(p.object) === cmpTerm(q.object);
  }
  function mergeStrategyResults(results) {
    const valid = (results || []).filter((r) => r && Array.isArray(r.candidates) && r.candidates.length);
    if (!valid.length) return null;
    let flat = [];
    for (const r of valid) {
      for (const c of r.candidates) {
        if (!c || !c.parsed) continue;
        flat.push({
          parsed: c.parsed,
          confidence: typeof c.confidence === "number" ? c.confidence : DEFAULT_CONFIDENCE,
          note: c.note || null,
          via: c.via || null,
          strategyId: r.strategyId,
          class: r.class
        });
      }
    }
    if (flat.some((c) => !isApproximate(c))) flat = flat.filter((c) => !isApproximate(c));
    if (!flat.length) return null;
    const groups = /* @__PURE__ */ new Map();
    for (const c of flat) {
      if (!groups.has(c.class)) groups.set(c.class, []);
      groups.get(c.class).push(c);
    }
    const merged = [];
    for (const [cls, cands] of groups) {
      const distinct = [];
      for (const c of cands) {
        const dup = distinct.find((d) => sameParse(d.parsed, c.parsed) && d.via === c.via);
        if (dup) {
          dup.agreed += 1;
          dup.confidence = Math.max(dup.confidence, c.confidence);
          if (detCount(c.parsed) < detCount(dup.parsed)) dup.parsed = c.parsed;
          continue;
        }
        distinct.push({ ...c, agreed: 1 });
      }
      if (distinct.length) merged.push({ class: cls, candidates: distinct });
    }
    if (!merged.length) return null;
    const top = (g) => Math.max(...g.candidates.map((c) => c.confidence));
    let winner = merged[0];
    for (const g of merged) if (top(g) > top(winner)) winner = g;
    const parsed = winner.candidates.length === 1 ? winner.candidates[0].parsed : { ambiguousParse: true, candidates: winner.candidates.map((c) => c.parsed) };
    const alternates = merged.filter((g) => g !== winner).map((g) => g.candidates[0]).filter((a) => !winner.candidates.some((w) => sameParse(w.parsed, a.parsed)));
    return { class: winner.class, parsed, winner: winner.candidates[0], alternates };
  }
  function describeAlternate(p) {
    if (!p) return "something else";
    if (p.ambiguousParse) return "one of several readings";
    const obj = p.object ?? p.subject ?? "?";
    return `${p.kind} "${obj}"`;
  }
  function alternateLines(alternates, { describe = describeAlternate, answerFor = null } = {}) {
    return (alternates || []).map((a) => {
      const meaning = a.note || describe(a.parsed);
      const tail = answerFor && answerFor(a) || "ask it that way";
      return `if you mean ${meaning} then ${tail}`;
    });
  }
  var DEFAULT_CONFIDENCE, cmpTerm, LEADING_DET_RE, detCount, APPROXIMATE_VIAS, isApproximate;
  var init_merge = __esm({
    "src/domain/interpret/merge.mjs"() {
      DEFAULT_CONFIDENCE = 0.5;
      cmpTerm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^(?:the|a|an)\s+/, "").replace(/^commit\s+(?=[0-9a-f]{7,40}$)/, "");
      LEADING_DET_RE = /^\s*(?:the|a|an)\s+/i;
      detCount = (p) => [p?.subject, p?.object].filter((t) => LEADING_DET_RE.test(String(t || ""))).length;
      APPROXIMATE_VIAS = /* @__PURE__ */ new Set(["fuzzy", "lemma", "spell"]);
      isApproximate = (c) => APPROXIMATE_VIAS.has(c.via);
    }
  });

  // src/domain/interpret/nlp-registry.mjs
  function setDefaultNlpAdapter(factory) {
    defaultAdapterFactory = factory;
  }
  function defaultNlp() {
    return typeof defaultAdapterFactory === "function" ? defaultAdapterFactory() : null;
  }
  var defaultAdapterFactory;
  var init_nlp_registry = __esm({
    "src/domain/interpret/nlp-registry.mjs"() {
      defaultAdapterFactory = null;
    }
  });

  // src/domain/interpret/pipeline.mjs
  function runStrategiesSync(text, ctx = {}, strategies = STRATEGIES) {
    const results = [];
    for (const s of strategies) {
      try {
        const r = s.run(text, ctx);
        if (r && typeof r.then !== "function") results.push(r);
      } catch {
      }
    }
    return results;
  }
  var OPTIONAL_STRATEGIES, STRATEGIES;
  var init_pipeline = __esm({
    "src/domain/interpret/pipeline.mjs"() {
      init_normalize();
      init_grammar();
      init_keywords();
      init_noise_strip();
      init_ace();
      init_constructions();
      init_merge();
      init_nlp_registry();
      OPTIONAL_STRATEGIES = [
        ...typeof aceStrategy !== "undefined" ? [aceStrategy] : [],
        // eslint-disable-next-line no-undef
        ...typeof constructionsStrategy !== "undefined" ? [constructionsStrategy] : []
      ];
      STRATEGIES = [grammarStrategy, keywordSpotStrategy, noiseStripStrategy, ...OPTIONAL_STRATEGIES];
    }
  });

  // adapter-stub-answer-variants.mjs:./answer-variants.mjs
  var pickPhrase;
  var init_answer_variants = __esm({
    "adapter-stub-answer-variants.mjs:./answer-variants.mjs"() {
      pickPhrase = (poolId, key, base) => base;
    }
  });

  // src/domain/ask.mjs
  var ask_exports = {};
  __export(ask_exports, {
    applyNegationFrames: () => applyNegationFrames,
    ask: () => ask,
    classDisplayName: () => classDisplayName,
    degreeMetric: () => degreeMetric,
    metaFallbackEntityAnswer: () => metaFallbackEntityAnswer,
    normalizeQuery: () => normalizeQuery,
    parseQuery: () => parseQuery,
    parseQueryFull: () => parseQueryFull,
    render: () => render,
    rephraseHint: () => rephraseHint,
    resolveObject: () => resolveObject,
    traverse: () => traverse
  });
  function edgesOfKind2(graph, kind) {
    let byKind = askEdgesOfKindCache.get(graph);
    if (!byKind) {
      byKind = /* @__PURE__ */ new Map();
      askEdgesOfKindCache.set(graph, byKind);
    }
    const cached3 = byKind.get(kind);
    if (cached3) return cached3;
    const out = [];
    for (const g of graph.relations) {
      if (relationKind(g) !== kind) continue;
      for (const e of g.edges) out.push(e);
    }
    byKind.set(kind, out);
    return out;
  }
  function nounFor(entityType, n) {
    const [s, p] = PLURAL_FORMS[entityType] || ["result", "results"];
    return n === 1 ? s : p;
  }
  function classDisplayName(cls) {
    const s = String(cls || "");
    if (typeof splitIdentifierWords === "function") {
      const words = splitIdentifierWords(s).join(" ");
      if (words) return words;
    }
    return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  }
  function verbFor(kind) {
    return REVERSE_MISS_VERB[kind] || kind;
  }
  function pruneSpuriousMeaningAmbiguity(parsed) {
    if (!parsed?.ambiguousParse || !Array.isArray(parsed.candidates) || parsed.candidates.length !== 2) return parsed;
    const metaC = parsed.candidates.find((c) => c?.shape === "meta");
    const other = parsed.candidates.find((c) => c !== metaC);
    if (!metaC || !other) return parsed;
    const term = String(metaC.object || "").trim().toLowerCase();
    if (!term || FROZEN_META_AMBIGUOUS_TERMS.has(term)) return parsed;
    const otherObject = String(other.object || "").trim().toLowerCase();
    if (!wordsOf(META_MEANING_VERBS).includes(otherObject)) return parsed;
    return metaC;
  }
  function parseQuery(query, { nlp = void 0 } = {}) {
    return parseQueryFull(query, { nlp }).parsed;
  }
  function parseQueryFull(query, { nlp = void 0 } = {}) {
    const adapter = nlp === void 0 ? defaultNlp() : nlp;
    const raw = String(query || "").trim().replace(/\s+/g, " ");
    if (!raw) return { parsed: null, alternates: [], class: null };
    const text = applyPhrasingFrames(applyNegationFrames(normalizeQuery(raw)));
    if (!text) return { parsed: null, alternates: [], class: null };
    const composite = parseComposite(text, adapter);
    if (composite) return { parsed: composite, alternates: [], class: null };
    const merged = mergeStrategyResults(runStrategiesSync(text, { nlp: adapter, raw }));
    if (!merged) return { parsed: null, alternates: [], class: null };
    return {
      parsed: pruneSpuriousMeaningAmbiguity(merged.parsed),
      alternates: merged.alternates || [],
      class: merged.class || null
    };
  }
  function dropLeadCopula(bw, blc) {
    return blc.length && COPULA_WORDS.has(blc[0]) ? { bw: bw.slice(1), blc: blc.slice(1) } : { bw, blc };
  }
  function parseSimpleClause(text, nlp) {
    return parseAnchored(text) || parseKeywordSpot(text, nlp);
  }
  function parseComposite(text, nlp) {
    const w = splitWords(text);
    const lc = w.map((x) => x.toLowerCase());
    return parseExistence(w, lc) || parseQualifierCheck(w, lc) || parseNegation(text, nlp, 0) || parseNegatedAsk(w, lc) || parseForwardNegation(w, lc, nlp) || parseTemporal(w, lc, nlp, 0) || parseCommitFilter(w, lc) || parseAnaphora(w, lc, nlp) || parseAggregate(w, lc, nlp) || parseSuperlative(w, lc, nlp) || parseFind(w, lc, nlp, 0) || parseList(w, lc, nlp, 0) || parseNested(w, lc, nlp, 0) || parsePluralAnaphoraObject(w, lc, nlp) || parseRelationalOrQualified(w, lc, nlp, 0);
  }
  function complementAst(entityType, diffAtom) {
    return {
      node: "boolean",
      entityType,
      atoms: [
        { op: "seed", kind: "set", ast: { node: "allOfClass", entityType } },
        diffAtom
      ]
    };
  }
  function parseNegation(text, nlp, depth = 0) {
    const neg = matchNegationSet(text);
    if (!neg) return null;
    const noun = entityNoun(neg.entWord);
    if (!noun || noun.placeholder || !noun.entityType) return null;
    const entityType = noun.entityType;
    if (entityType === "Change") {
      return { node: "miss", reason: `"${neg.entWord}" isn't an enumerable kind \u2014 a set complement needs a concrete kind (functions, classes, modules, \u2026)` };
    }
    const predWords = splitWords(neg.predicate);
    const predLc = predWords.map((x) => x.toLowerCase());
    if (predLc.length && predLc.every((x) => QUALIFIERS[x])) {
      return complementAst(entityType, { op: "difference", kind: "qual", filters: predLc });
    }
    const vh = findPhrase(predLc, VERB_TO_KIND);
    if (!vh) return { node: "miss", reason: "a negated set query needs a known relation verb (import, call, inherit from, test, \u2026)" };
    const objWords = predWords.filter((_, i) => (i < vh.start || i >= vh.end) && !STOPWORDS2.has(predLc[i]) && predLc[i] !== "from");
    if (!objWords.length) {
      return complementAst(entityType, { op: "difference", kind: "set", ast: { node: "existsEdge", entityType, kind: vh.kind } });
    }
    const positive = parseSetPhrase(`which ${neg.entWord} ${neg.predicate}`, nlp, depth + 1);
    if (!positive || positive.node === "miss") {
      return { node: "miss", reason: positive && positive.reason || "the negated clause didn't parse" };
    }
    return complementAst(entityType, { op: "difference", kind: "set", ast: positive });
  }
  function parseForwardNegation(w, lc, nlp) {
    let i = 0;
    while (i < lc.length && FWD_NEG_FRAME.has(lc[i])) i += 1;
    if (!["do", "does", "did"].includes(lc[i])) return null;
    i += 1;
    const rest = w.slice(i);
    const restLc = lc.slice(i);
    const notIdx = restLc.indexOf("not");
    if (notIdx < 0) return null;
    const vh = findPhrase(restLc, VERB_TO_KIND);
    if (!vh) return null;
    const subjTokens = rest.filter((_, j) => j !== notIdx && (j < vh.start || j >= vh.end) && restLc[j] !== "from" && !STOPWORDS2.has(restLc[j]));
    const subjectTerm = subjTokens.join(" ").trim();
    if (!subjectTerm) return null;
    return { node: "forwardComplement", kind: vh.kind, subjectTerm };
  }
  function classesForKinds(graph, kinds) {
    const classes = /* @__PURE__ */ new Set();
    for (const k of kinds) {
      for (const e of edgesOfKind2(graph, k)) {
        const o = graph.byId.get(e.object);
        if (o && o.class) classes.add(o.class);
      }
    }
    return classes;
  }
  function kindObjectClass(graph, kind) {
    const classes = classesForKinds(graph, kindsFor(kind));
    return classes.size === 1 ? [...classes][0] : null;
  }
  function parseSetPhrase(text, nlp, depth) {
    if (depth > MAX_COMPOSE_DEPTH) return { node: "miss", reason: "too deep to resolve" };
    const negated = parseNegation(text, nlp, depth);
    if (negated) return negated;
    const w = splitWords(text);
    const lc = w.map((x) => x.toLowerCase());
    const nested = parseNested(w, lc, nlp, depth);
    if (nested) return nested;
    const rel = parseRelationalOrQualified(w, lc, nlp, depth);
    if (rel) return rel;
    const clause = parseSimpleClause(text, nlp);
    if (clause) return { node: "clause", clause };
    return null;
  }
  function parseNested(w, lc, nlp, depth) {
    for (let r = 1; r < lc.length; r += 1) {
      const isPronoun2 = RELATIVE_PRONOUNS.includes(lc[r]);
      const isGerundMarker = !isPronoun2 && isGerundVerb(lc[r]);
      if (!isPronoun2 && !isGerundMarker) continue;
      if (isPronoun2 && r + 1 >= lc.length) continue;
      const noun = entityNoun(lc[r - 1]);
      if (!noun) continue;
      const head = w.slice(0, r - 1);
      if (!head.length) continue;
      const outer = parseSimpleClause([...head, NEST_SENTINEL].join(" "), nlp);
      if (!outer || outer.shape !== "reverse" && outer.shape !== "forward") continue;
      if (outer.modifier && outer.modifier !== "direct") continue;
      const innerText = `which ${lc[r - 1]} ${w.slice(isPronoun2 ? r + 1 : r).join(" ")}`;
      const inner = parseSetPhrase(innerText, nlp, depth + 1);
      if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "inner clause didn't parse" } : { node: "miss", reason: "inner clause didn't parse" };
      return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner };
    }
    return null;
  }
  function parsePluralAnaphoraObject(w, lc, nlp) {
    for (let i = 0; i < lc.length; i += 1) {
      if (!PLURAL_ANAPHORA_OBJECT.has(lc[i])) continue;
      if (lc[i - 1] === "of") continue;
      const isTerminal = i === lc.length - 1;
      const leadsAVerb = i + 1 < lc.length && !!VERB_TO_KIND[lc[i + 1]];
      if (!isTerminal && !leadsAVerb) continue;
      const head = [...w.slice(0, i), NEST_SENTINEL, ...w.slice(i + 1)];
      const outer = parseSimpleClause(head.join(" "), nlp);
      if (!outer || outer.shape !== "reverse" && outer.shape !== "forward") continue;
      if (outer.object !== NEST_SENTINEL) continue;
      if (outer.modifier && outer.modifier !== "direct") continue;
      return { node: outer.shape === "reverse" ? "reverseSet" : "forwardSet", kind: outer.kind, entityType: outer.entityType, inner: { node: "prevSet" } };
    }
    return null;
  }
  function parseTemporal(w, lc, nlp, depth = 0) {
    if (lc[0] !== "when") return null;
    let i = 1;
    if (!TEMPORAL_AUX.has(lc[i])) return null;
    i += 1;
    let t = -1;
    for (let k = lc.length - 1; k >= i; k -= 1) {
      if (TEMPORAL_TAIL.has(lc[k])) {
        t = k;
        break;
      }
    }
    if (t < 0) return null;
    let subjWords = w.slice(i, t);
    let subjLc = lc.slice(i, t);
    while (subjLc.length && TEMPORAL_TRAIL_FILLER.has(subjLc[subjLc.length - 1])) {
      subjWords = subjWords.slice(0, -1);
      subjLc = subjLc.slice(0, -1);
    }
    while (subjLc.length && TEMPORAL_DET.has(subjLc[0])) {
      subjWords = subjWords.slice(1);
      subjLc = subjLc.slice(1);
    }
    if (!subjWords.length) return null;
    if (!subjLc.some((x) => RELATIVE_PRONOUNS.includes(x))) return null;
    const framed = FRAME_WORDS.has(subjLc[0]) ? subjWords.join(" ") : `which ${subjWords.join(" ")}`;
    const inner = parseSetPhrase(framed, nlp, depth + 1);
    if (!inner || inner.node === "miss") return inner ? { node: "miss", reason: inner.reason || "the inner set of the temporal query didn't parse" } : { node: "miss", reason: "the inner set of the temporal query didn't parse" };
    const noun = entityNoun(subjLc[0]);
    return { node: "temporal", inner, entityType: noun && noun.entityType || null };
  }
  function parseCommitFilter(w, lc) {
    if (lc[0] !== "what" || lc[1] !== "changed") return null;
    let i = 2;
    if (lc[i] === "ever") i += 1;
    if (!COMMIT_FILTER_OPS.has(lc[i])) return null;
    const op = lc[i];
    const pivotRaw = w.slice(i + 1).join(" ").trim();
    if (!pivotRaw) return { node: "miss", reason: `"what changed ${op}" needs a date or commit afterward` };
    return { node: "commitFilter", op, pivotRaw };
  }
  function inSentenceNameTokens(words) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const raw of words) {
      if (!raw || !ANAPHORA_NAME_TOKEN_RE.test(raw)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
    }
    return out;
  }
  function parseAnaphora(w, lc, nlp) {
    if (lc.length === 2 && lc[0] === "which" && (lc[1] === "ones" || lc[1] === "one")) {
      return { node: "anaphora", mode: "list", filter: { type: "all" } };
    }
    let p = -1;
    let viaOf = false;
    for (let i = 1; i < lc.length; i += 1) {
      if (!ANAPHORA_TRIGGERS.includes(lc[i])) continue;
      if (lc[i - 1] === "of") {
        p = i;
        viaOf = true;
        break;
      }
      const headSoFar = lc.slice(0, i).join(" ");
      if (i === lc.length - 1 && (AGGREGATE_TRIGGERS.includes(headSoFar) || LIST_TRIGGERS.includes(headSoFar))) {
        p = i;
        break;
      }
    }
    if (p < 0) return null;
    const head = (viaOf ? lc.slice(0, p - 1) : lc.slice(0, p)).join(" ");
    const mode = AGGREGATE_TRIGGERS.includes(head) || /^(how many|how much|count|number|quantity|total)\b/.test(head) ? "count" : "list";
    const filter = parsePredicateFilter(w.slice(p + 1), nlp);
    if (filter === void 0) return { node: "miss", reason: "the follow-up filter didn't parse" };
    const cutIdx = viaOf ? p - 1 : p;
    const candidateTerms = inSentenceNameTokens(w.slice(0, cutIdx));
    const ast = { node: "anaphora", mode, filter };
    if (candidateTerms.length >= 2) ast.candidateTerms = candidateTerms;
    return ast;
  }
  function parsePredicateFilter(words, nlp) {
    let i = 0;
    const lc = words.map((x) => x.toLowerCase());
    while (i < lc.length && PRED_LEAD_SKIP.has(lc[i])) i += 1;
    const rest = words.slice(i);
    const restLc = lc.slice(i);
    if (!rest.length) return { type: "all" };
    if (restLc.every((x) => QUALIFIERS[x])) return { type: "qual", filters: restLc };
    const clause = parseSimpleClause(`what ${rest.join(" ")}`, nlp);
    if (clause && (clause.shape === "reverse" || clause.shape === "forward") && clause.object) {
      return { type: "clause", clause };
    }
    return void 0;
  }
  function parseExistence(w, lc) {
    let i;
    if (lc[0] === "is" && lc[1] === "there") i = 2;
    else if (lc[0] === "are" && lc[1] === "there") i = 2;
    else return null;
    const article = lc[i];
    if (article === "a" || article === "an" || article === "any") i += 1;
    else return null;
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun || noun.placeholder || !noun.entityType) return null;
    const entityType = noun.entityType;
    i += 1;
    let rest = lc.slice(i);
    let restW = w.slice(i);
    if (rest.length && rest[rest.length - 1] === "anywhere") {
      rest = rest.slice(0, -1);
      restW = restW.slice(0, -1);
    } else if (rest.length >= 2 && rest[rest.length - 2] === "at" && rest[rest.length - 1] === "all") {
      rest = rest.slice(0, -2);
      restW = restW.slice(0, -2);
    }
    if (!rest.length) return { node: "exists", entityType, term: null, scopeModule: null };
    if (rest[0] === "called" || rest[0] === "named") {
      if (rest.length < 2) return { node: "miss", reason: `"${rest[0]}" needs a name afterward` };
      const inIdx = rest.indexOf("in", 1);
      if (inIdx > 0) {
        const term2 = restW.slice(1, inIdx).join(" ").trim();
        const scopeModule = restW.slice(inIdx + 1).join(" ").trim();
        if (!term2 || !scopeModule) return { node: "miss", reason: `a named existence check needs both a name and a module after "in"` };
        return { node: "exists", entityType, term: term2, scopeModule };
      }
      const term = restW.slice(1).join(" ").trim();
      return term ? { node: "exists", entityType, term, scopeModule: null } : { node: "miss", reason: `"${rest[0]}" needs a name afterward` };
    }
    if (rest[0] === "in") {
      const scopeModule = restW.slice(1).join(" ").trim();
      return scopeModule ? { node: "exists", entityType, term: null, scopeModule } : { node: "miss", reason: `"in" needs a module afterward` };
    }
    return null;
  }
  function parseQualifierScope(qualifier, tailWords) {
    if (!tailWords.length) return null;
    const withQualifier = `${qualifier} ${tailWords.join(" ")}`;
    const tail = stripTrailingScopeFiller(withQualifier).slice(qualifier.length).trim();
    const rest = splitWords(tail);
    const inIdx = rest.findIndex((x) => x.toLowerCase() === "in");
    if (inIdx < 0) return null;
    const scope = rest.slice(inIdx + 1).join(" ").trim();
    return scope ? { scope } : { node: "miss", reason: `"in" needs a scope afterward` };
  }
  function parseQualifierCheck(w, lc) {
    if (lc[0] !== "is" && lc[0] !== "are") return null;
    if (lc[1] === "there") return null;
    let qualIdx = -1;
    let negated = false;
    for (let i = 1; i < lc.length; i += 1) {
      if (QUALIFIERS[lc[i]]) {
        qualIdx = i;
        negated = lc[i - 1] === "not";
        break;
      }
    }
    if (qualIdx < 0) return null;
    const byIdx = lc.indexOf("by", qualIdx + 1);
    if (byIdx > 0 && PASSIVE_PARTICIPLE_TO_KIND[lc[qualIdx]]) {
      let agentIdx = byIdx + 1;
      while (agentIdx < lc.length && (lc[agentIdx] === "the" || lc[agentIdx] === "a" || lc[agentIdx] === "an")) agentIdx += 1;
      const agent = lc[agentIdx];
      if (agent && !GENERIC_AGENT_WORDS.has(agent)) return null;
    }
    const tail = parseQualifierScope(lc[qualIdx], w.slice(qualIdx + 1));
    if (tail?.node === "miss") return tail;
    let termStart = 1;
    if (lc[termStart] === "the") termStart += 1;
    let termEnd = negated ? qualIdx - 1 : qualIdx;
    if (termEnd > termStart && (lc[termEnd - 1] === "a" || lc[termEnd - 1] === "an")) termEnd -= 1;
    const term = termEnd > termStart ? w.slice(termStart, termEnd).join(" ").trim() : "";
    if (!term) return { node: "miss", reason: `"is/are <qualifier>" needs a named thing to check first` };
    return { node: "qualCheck", term, qualifier: lc[qualIdx], negated, scope: tail?.scope || null };
  }
  function parseNegatedAsk(w, lc) {
    if (lc[0] !== "do" && lc[0] !== "does" && lc[0] !== "did") return null;
    const notIdx = lc.indexOf("not", 1);
    if (notIdx < 0) return null;
    const positive = parseAnchored(w.filter((_, i) => i !== notIdx).join(" "));
    if (!positive || positive.shape !== "ask") return null;
    return { ...positive, negated: true };
  }
  function parseAggregate(w, lc, nlp) {
    const trig = AGGREGATE_TRIGGERS.find((t) => lc.slice(0, t.split(" ").length).join(" ") === t);
    if (!trig) return null;
    let i = trig.split(" ").length;
    while (i < lc.length && (lc[i] === "the" || lc[i] === "a" || lc[i] === "all")) i += 1;
    const quals = [];
    while (i < lc.length && QUALIFIERS[lc[i]]) {
      quals.push(lc[i]);
      i += 1;
    }
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun) return { node: "miss", reason: "count needs a known entity kind (functions, classes, modules, \u2026)" };
    const entWord = lc[i];
    i += 1;
    const tail = w.slice(i);
    const tailMeaningful = lc.slice(i).some((t) => !STOPWORDS2.has(t) && !AGG_TAIL_FILLER.has(t));
    let base;
    if (tailMeaningful) {
      const setAst = parseSetPhrase(`which ${entWord} ${tail.join(" ")}`, nlp, 1);
      if (!setAst || setAst.node === "miss") return { node: "miss", reason: "the count restrictor didn't parse" };
      base = setAst;
    } else {
      base = { node: "allOfClass", entityType: noun.entityType };
    }
    if (quals.length) base = { node: "qualifier", filters: quals, inner: base };
    return { node: "count", entityType: noun.entityType, base };
  }
  function parseList(w, lc, nlp, depth) {
    let i = 0;
    let interrogative = false;
    let matched = null;
    for (const t of LIST_TRIGGERS_SORTED) {
      const tw = t.split(" ");
      if (lc.slice(0, tw.length).join(" ") === t) {
        matched = t;
        i = tw.length;
        break;
      }
    }
    if (!matched) {
      if (lc[0] === "what" || lc[0] === "which") {
        interrogative = true;
        i = 1;
      } else return null;
    }
    while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
    const quals = [];
    while (i < lc.length && QUALIFIERS[lc[i]]) {
      quals.push(lc[i]);
      i += 1;
    }
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun || noun.placeholder || noun.entityType === "Change") {
      if (!interrogative && i < lc.length && i === lc.length - 1 && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
        return { node: "miss", reason: `"${lc[i]}" isn't a listable kind \u2014 try ${LISTABLE_KINDS}` };
      }
      return null;
    }
    const entityType = noun.entityType;
    const entWord = lc[i];
    i += 1;
    const tail = w.slice(i);
    const tailMeaningful = lc.slice(i).some((t) => !STOPWORDS2.has(t) && !AGG_TAIL_FILLER.has(t));
    let scopeTailLc = lc.slice(i);
    let scopeTailWords = tail;
    if (scopeTailLc[0] === "is" || scopeTailLc[0] === "are") {
      scopeTailLc = scopeTailLc.slice(1);
      scopeTailWords = scopeTailWords.slice(1);
    }
    const scopedException = interrogative && SCOPE_PREPOSITIONS.has(scopeTailLc[0]);
    if (interrogative && (tailMeaningful && !scopedException || tail.length === 0)) return null;
    let base;
    let scoped = false;
    if (tailMeaningful) {
      const useTail = scopedException ? scopeTailWords : tail;
      const setAst = parseSetPhrase(`which ${[...quals, entWord, ...useTail].join(" ")}`, nlp, (depth || 0) + 1);
      if (!setAst || setAst.node === "miss") return { node: "miss", reason: setAst && setAst.reason || "the list filter didn't parse" };
      base = setAst;
      scoped = true;
    } else {
      base = { node: "allOfClass", entityType };
      if (quals.length) base = { node: "qualifier", filters: quals, inner: base };
    }
    return { node: "list", entityType, base, scoped };
  }
  function parseSuperlative(w, lc, nlp) {
    let ext = null;
    let extIdx = -1;
    for (let i = 0; i < lc.length; i += 1) {
      const two = lc.slice(i, i + 2).join(" ");
      if (SUPERLATIVE_EXTREMES[two]) {
        ext = SUPERLATIVE_EXTREMES[two];
        extIdx = i;
        break;
      }
      if (SUPERLATIVE_EXTREMES[lc[i]]) {
        ext = SUPERLATIVE_EXTREMES[lc[i]];
        extIdx = i;
        break;
      }
    }
    if (!ext) return null;
    let metric = null;
    let metricNoun = null;
    for (let i = extIdx; i < lc.length; i += 1) {
      if (EDGE_NOUN_TO_METRIC[lc[i]]) {
        metric = EDGE_NOUN_TO_METRIC[lc[i]];
        metricNoun = lc[i];
        break;
      }
    }
    if (!metric) {
      for (let i = extIdx - 1; i >= 0; i -= 1) {
        if (EDGE_NOUN_TO_METRIC[lc[i]]) {
          metric = EDGE_NOUN_TO_METRIC[lc[i]];
          metricNoun = lc[i];
          break;
        }
      }
    }
    const connectivity = lc.includes("connected") || lc.slice(extIdx, extIdx + 2).join(" ") === "most connected" || ["largest", "biggest", "smallest"].includes(lc[extIdx]);
    if (!metric && connectivity) {
      metric = EDGE_NOUN_TO_METRIC.connections;
      metricNoun = "connections";
    }
    let entityType;
    let entWord = null;
    for (const x of lc) {
      const n = entityNoun(x);
      if (n && !n.placeholder) {
        entityType = n.entityType;
        entWord = x;
        break;
      }
    }
    if (!entWord) {
      entityType = metricNoun ? METRIC_IMPLIES_ENTITY[metricNoun] : void 0;
      if (!entityType) return { node: "miss", reason: "a superlative needs an entity kind (module, class, function, \u2026)" };
    }
    if (!metric) return { node: "miss", reason: "name what to rank by (imports, callers, methods, tests, or connections)" };
    return { node: "superlative", entityType, metric, metricNoun, extreme: ext };
  }
  function parseFind(w, lc, nlp, depth) {
    if (lc[0] !== "find") return null;
    let i = 1;
    while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
    if (i >= lc.length) return null;
    const leadNoun = entityNoun(lc[i]);
    if (leadNoun && !leadNoun.placeholder && leadNoun.entityType !== "Change" && i + 1 < lc.length && FIND_LINKERS.has(lc[i + 1])) {
      const term = w.slice(i + 2).join(" ").trim();
      if (term) return { node: "find", entityType: leadNoun.entityType, term };
    }
    const lastNoun = entityNoun(lc[lc.length - 1]);
    if (lastNoun && !lastNoun.placeholder && lastNoun.entityType !== "Change") {
      const term = w.slice(i, lc.length - 1).join(" ").trim();
      if (term) return { node: "find", entityType: lastNoun.entityType, term };
    }
    if (lc.some((t) => RELATIVE_PRONOUNS.includes(t))) return null;
    if (i === lc.length - 1 && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !PLACEHOLDER_NOUNS.includes(lc[i])) {
      return { node: "miss", reason: `"${lc[i]}" isn't a listable kind \u2014 try ${LISTABLE_KINDS}` };
    }
    return null;
  }
  function parseFindPredicateHead(w, lc) {
    if (lc[0] !== "find") return null;
    let i = 1;
    while (i < lc.length && LIST_SKIP.has(lc[i])) i += 1;
    let r = -1;
    for (let k = i + 1; k < lc.length; k += 1) {
      if (RELATIVE_PRONOUNS.includes(lc[k])) {
        r = k;
        break;
      }
    }
    if (r < 0) return null;
    const noun = entityNoun(lc[r - 1]);
    if (!noun || noun.placeholder || noun.entityType === "Change") return null;
    const term = w.slice(i, r - 1).join(" ").trim();
    if (!term) return null;
    return { entityType: noun.entityType, term, relIdx: r };
  }
  function buildPredicateAtoms(entityType, subjPrefix, predLc, predWords, nlp, depth) {
    const { branches, ops } = splitBoolean(predLc, predWords);
    let prevVerb = null;
    const atoms = [];
    for (let b = 0; b < branches.length; b += 1) {
      const bw = branches[b];
      const blc = bw.map((x) => x.toLowerCase());
      const op = b === 0 ? "intersection" : ops[b - 1];
      const qc = dropLeadCopula(bw, blc);
      if (qc.blc.length && qc.blc.every((x) => QUALIFIERS[x])) {
        atoms.push({ op, kind: "qual", filters: qc.blc });
        continue;
      }
      if (blc[0] === "of" || blc[0] === "in") {
        atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
        continue;
      }
      let phrase = bw;
      const vh = findPhrase(blc, VERB_TO_KIND);
      if (vh) prevVerb = bw.slice(vh.start, vh.end);
      else if (prevVerb) phrase = [...prevVerb, ...bw];
      const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth);
      if (!ast || ast.node === "miss") return { miss: ast && ast.reason || "a clause in the combination didn't parse" };
      atoms.push({ op, kind: "set", ast });
    }
    return { atoms };
  }
  function parseRelationalOrQualified(w, lc, nlp, depth) {
    const findHead = parseFindPredicateHead(w, lc);
    if (findHead) {
      const { entityType: entityType2, term, relIdx } = findHead;
      const predLc2 = lc.slice(relIdx + 1);
      const predWords2 = w.slice(relIdx + 1);
      if (!predLc2.length) return { node: "miss", reason: `a relative clause needs a predicate after "${lc[relIdx]}"` };
      const built = buildPredicateAtoms(entityType2, `which ${lc[relIdx - 1]}`, predLc2, predWords2, nlp, depth + 1);
      if (built.miss) return { node: "miss", reason: built.miss };
      const atoms2 = [{ op: "seed", kind: "set", ast: { node: "find", entityType: entityType2, term } }, ...built.atoms];
      return atoms2.length === 1 ? atoms2[0].ast : { node: "boolean", entityType: entityType2, atoms: atoms2 };
    }
    let i = 0;
    while (i < lc.length && FRAME_WORDS.has(lc[i])) i += 1;
    const framed = i > 0;
    const quals = [];
    while (i < lc.length && QUALIFIERS[lc[i]]) {
      quals.push(lc[i]);
      i += 1;
    }
    const noun = i < lc.length ? entityNoun(lc[i]) : null;
    if (!noun) {
      const nextNoun = i + 1 < lc.length ? entityNoun(lc[i + 1]) : null;
      if (RECENT_COMMIT_LEAD.has(lc[i]) && nextNoun && nextNoun.entityType === "Commit" && i + 2 === lc.length) {
        return { node: "recentCommits" };
      }
      if (COPULA_WORDS.has(lc[i])) {
        let j = i + 1;
        if (j < lc.length && (lc[j] === "the" || lc[j] === "a" || lc[j] === "an")) j += 1;
        const leadNoun = j + 1 < lc.length ? entityNoun(lc[j + 1]) : null;
        if (RECENT_COMMIT_LEAD.has(lc[j]) && leadNoun && leadNoun.entityType === "Commit" && j + 2 === lc.length) {
          return { node: "recentCommits" };
        }
      }
      if ((framed || quals.length) && nextNoun && /^[a-z]+$/.test(lc[i]) && !VERB_TO_KIND[lc[i]] && !STOPWORDS2.has(lc[i]) && !CASCADE_NOISE_SET.has(lc[i])) {
        return { node: "find", entityType: nextNoun.entityType, term: w[i] };
      }
      return null;
    }
    const entityType = noun.entityType;
    const entWord = lc[i];
    i += 1;
    let predLc = lc.slice(i);
    let predWords = w.slice(i);
    let relFlag = false;
    if (predLc.length && RELATIVE_PRONOUNS.includes(predLc[0])) {
      relFlag = true;
      predLc = predLc.slice(1);
      predWords = predWords.slice(1);
    }
    const membershipLed = predLc[0] === "of" || predLc[0] === "in";
    const gerundLed = predLc.length > 0 && isGerundVerb(predLc[0]);
    const boolQualLed = predWords.length > 0 && splitBoolean(predLc, predWords).branches.some((bw) => {
      const { blc } = dropLeadCopula(bw, bw.map((x) => x.toLowerCase()));
      return blc.length && blc.every((x) => QUALIFIERS[x]);
    });
    const sameVerbBranches = predWords.length > 0 ? splitBoolean(predLc, predWords).branches : [];
    let sameVerbLed = false;
    if (sameVerbBranches.length > 1) {
      const firstBlc = sameVerbBranches[0].map((x) => x.toLowerCase());
      const firstVh = findPhrase(firstBlc, VERB_TO_KIND);
      if (firstVh && firstVh.start === 0) {
        sameVerbLed = sameVerbBranches.slice(1).every((bw) => {
          const blc = bw.map((x) => x.toLowerCase());
          const vh = findPhrase(blc, VERB_TO_KIND);
          return vh && vh.start === 0 ? vh.kind === firstVh.kind : !vh;
        });
      }
    }
    let differentVerbLed = false;
    if (sameVerbBranches.length > 1) {
      const firstBlc = sameVerbBranches[0].map((x) => x.toLowerCase());
      const firstVh = findPhrase(firstBlc, VERB_TO_KIND);
      if (firstVh && firstVh.start === 0) {
        differentVerbLed = sameVerbBranches.slice(1).every((bw) => {
          const blc = bw.map((x) => x.toLowerCase());
          const vh = findPhrase(blc, VERB_TO_KIND);
          return !!vh && vh.start === 0 && vh.end - vh.start === 1;
        });
      }
    }
    if (!(quals.length || relFlag || membershipLed || gerundLed || boolQualLed || sameVerbLed || differentVerbLed)) return null;
    if (!predWords.length) {
      let base = { node: "allOfClass", entityType };
      if (!quals.length) return { node: "miss", reason: "nothing to filter or traverse" };
      return { node: "qualifier", filters: quals, inner: base, entityType };
    }
    const subjPrefix = noun.placeholder ? "what" : `which ${entWord}`;
    const { branches, ops } = splitBoolean(predLc, predWords);
    let prevVerb = null;
    const atoms = [];
    for (let b = 0; b < branches.length; b += 1) {
      const bw = branches[b];
      const blc = bw.map((x) => x.toLowerCase());
      const op = b === 0 ? "seed" : ops[b - 1];
      const qc = dropLeadCopula(bw, blc);
      if (qc.blc.length && qc.blc.every((x) => QUALIFIERS[x])) {
        atoms.push({ op, kind: "qual", filters: qc.blc });
        continue;
      }
      if (blc[0] === "of" || blc[0] === "in") {
        atoms.push({ op, kind: "set", ast: { node: "membership", entityType, term: bw.slice(1).join(" ") } });
        continue;
      }
      let phrase = bw;
      const vh = findPhrase(blc, VERB_TO_KIND);
      if (vh) prevVerb = bw.slice(vh.start, vh.end);
      else if (prevVerb) phrase = [...prevVerb, ...bw];
      const ast = parseBranchAst(`${subjPrefix} ${phrase.join(" ")}`, nlp, depth + 1);
      if (!ast || ast.node === "miss") return { node: "miss", reason: ast && ast.reason || "a clause in the combination didn't parse" };
      atoms.push({ op, kind: "set", ast });
    }
    if (atoms[0].kind !== "set") return { node: "miss", reason: "start with a clause, then combine with and/or/but-not" };
    let result;
    if (atoms.length === 1) {
      result = atoms[0].ast;
    } else {
      result = { node: "boolean", entityType, atoms };
    }
    if (quals.length) result = { node: "qualifier", filters: quals, inner: result, entityType };
    return result;
  }
  function parseBranchAst(text, nlp, depth) {
    if (depth > MAX_COMPOSE_DEPTH) return { node: "miss", reason: "too deep to resolve" };
    const w = splitWords(text);
    const lc = w.map((x) => x.toLowerCase());
    const nested = parseNested(w, lc, nlp, depth);
    if (nested) return nested;
    const clause = parseSimpleClause(text, nlp);
    return clause ? { node: "clause", clause } : null;
  }
  function splitBoolean(predLc, predWords) {
    const conns = Object.keys(BOOLEAN_CONNECTIVES).sort((a, z) => z.split(" ").length - a.split(" ").length);
    const branches = [];
    const ops = [];
    let start = 0;
    let i = 0;
    while (i < predLc.length) {
      let hit2 = null;
      for (const c of conns) {
        const cw = c.split(" ");
        if (predLc.slice(i, i + cw.length).join(" ") === c) {
          hit2 = { c, len: cw.length };
          break;
        }
      }
      if (hit2 && i > start) {
        branches.push(predWords.slice(start, i));
        ops.push(BOOLEAN_CONNECTIVES[hit2.c]);
        i += hit2.len;
        start = i;
      } else if (hit2) {
        i += hit2.len;
        start = i;
      } else i += 1;
    }
    branches.push(predWords.slice(start));
    return { branches, ops };
  }
  function reverseOverSet(graph, kind, entityType, objectIds) {
    const symbolKind = SYMBOL_GRAIN_SIBLING[kind];
    if (symbolKind && FINE_ENTITY_TYPES.has(entityType)) {
      const edges2 = edgesOfKind2(graph, symbolKind).filter((e) => objectIds.has(e.object));
      return uniqueById(edges2.map((e) => graph.byId.get(e.subject)).filter((s) => s && s.class === entityType));
    }
    const objHasFine = !!symbolKind && [...objectIds].some((id) => FINE_ENTITY_TYPES.has(graph.byId.get(id)?.class));
    const scanKinds = objHasFine ? [...kindsFor(kind), symbolKind] : kindsFor(kind);
    const edges = scanKinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => objectIds.has(e.object));
    const subjects = uniqueById(edges.map((e) => graph.byId.get(e.subject)).filter(Boolean));
    if (!entityType || entityType === "Change") return subjects;
    const direct = subjects.filter((s) => s.class === entityType);
    if (direct.length) return direct;
    if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
      return refineToEntities(graph, new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id)), entityType);
    }
    return [];
  }
  function forwardOverSet(graph, kind, subjectIds) {
    const edges = kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => subjectIds.has(e.subject));
    return uniqueById(edges.map((e) => graph.byId.get(e.object)).filter(Boolean));
  }
  function uniqueById(inds) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const x of inds) if (x && !seen.has(x.id)) {
      seen.add(x.id);
      out.push(x);
    }
    return out;
  }
  function directoryScopeModules(graph, term) {
    const norm = normPath(term);
    if (!norm) return [];
    const prefix = `${norm}/`;
    return graph.individuals.filter((i) => i.class === "Module" && normPath(i.label).startsWith(prefix));
  }
  function qualSets(graph) {
    let c = qualCache.get(graph);
    if (c) return c;
    const exported = /* @__PURE__ */ new Set();
    for (const e of edgesOfKind2(graph, "reexports")) {
      exported.add(String(e.object).toLowerCase());
      const ind = graph.byId.get(e.object);
      if (ind) exported.add(String(ind.label).toLowerCase());
    }
    const testedModules = new Set(edgesOfKind2(graph, "tests").map((e) => e.object));
    const moduleOfSymbol = /* @__PURE__ */ new Map();
    for (const e of edgesOfKind2(graph, "defines")) moduleOfSymbol.set(e.object, e.subject);
    c = { exported, testedModules, moduleOfSymbol };
    qualCache.set(graph, c);
    return c;
  }
  function moduleIdOf2(graph, ind) {
    if (!ind) return null;
    if (ind.class === "Module") return ind.id;
    return qualSets(graph).moduleOfSymbol.get(ind.id) || null;
  }
  function metaFallbackEntityAnswer(graph, term) {
    const termLc = String(term || "").trim().toLowerCase();
    if (!termLc) return null;
    const hits = (graph?.individuals || []).filter((i) => META_FALLBACK_CLASSES.has(i.class) && String(i.label).toLowerCase() === termLc);
    if (hits.length !== 1) return null;
    const hit2 = hits[0];
    const mid = hit2.class === "Module" ? null : moduleIdOf2(graph, hit2);
    const modLabel = hit2.class === "Module" ? null : mid && graph.byId.get(mid)?.label || String((hit2.attributes || []).find((a) => a.key === "site")?.value || "").split(":")[0] || null;
    const noun = nounFor(hit2.class, 1);
    const article = noun === "attribute" ? "an" : "a";
    const definedIn = modLabel ? `, ${pickPhrase("defined-in", hit2.id, "defined in")} ${modLabel}` : "";
    const followUp = hit2.class === "Class" ? ` or "which classes inherit from ${hit2.label}"` : hit2.class === "Module" ? ` or "what imports ${hit2.label}"` : "";
    return {
      text: `${hit2.label} is ${article} ${noun} in this codebase${definedIn} \u2014 try "describe ${hit2.label}"${followUp}.`,
      hit: hit2,
      modLabel
    };
  }
  function membershipOwnSet(graph, id, entityType) {
    const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, /* @__PURE__ */ new Set([id]))));
    return entityType ? objs.filter((o) => o.class === entityType) : objs;
  }
  function resolveMembershipOwner(graph, term, contextId = null) {
    const r = resolveTermOrContext(graph, term, contextId);
    if (!(r.match && r.tier === 1)) {
      const dirMods = directoryScopeModules(graph, term);
      if (dirMods.length) return { kind: "dir", mods: dirMods };
    }
    if (!r.match) return { kind: "miss" };
    return { kind: "single", id: r.match.id, entityClass: r.match.class, label: r.match.label };
  }
  function computeMembership(graph, ownerId, ownerClass, entityType, filterFn) {
    const pass = filterFn || (() => true);
    const own = membershipOwnSet(graph, ownerId, entityType).filter(pass);
    if (own.length || !inheritsApplicable(graph, ownerClass)) {
      return { own, inherited: [], viaId: null, viaLabel: null };
    }
    for (const ancId of ancestorsOf(graph, ownerId)) {
      const anc = graph.byId.get(ancId);
      if (!anc) continue;
      const ancOwn = membershipOwnSet(graph, ancId, entityType).filter(pass);
      if (ancOwn.length) return { own, inherited: ancOwn, viaId: ancId, viaLabel: anc.label };
    }
    return { own, inherited: [], viaId: null, viaLabel: null };
  }
  function qualHolds(graph, ind, spec) {
    if (!spec) return false;
    switch (spec.via) {
      case "visibility": {
        const v = String((ind.attributes || []).find((a) => a.key === "visibility")?.value || "public").toLowerCase();
        return v === spec.value;
      }
      case "attr":
        return !!(ind.attributes || []).find((a) => a.key === spec.attr)?.value;
      case "exported": {
        const ex = qualSets(graph).exported;
        return ex.has(String(ind.label).toLowerCase()) || ex.has(String(ind.id).toLowerCase());
      }
      case "tested": {
        const mid = moduleIdOf2(graph, ind);
        return (!!mid && qualSets(graph).testedModules.has(mid)) === spec.value;
      }
      default:
        return false;
    }
  }
  function inheritsEdges(graph) {
    return edgesOfKind2(graph, "inherits");
  }
  function directChildrenOf(graph, id) {
    return inheritsEdges(graph).filter((e) => e.object === id).map((e) => e.subject);
  }
  function directParentsOf(graph, id) {
    return inheritsEdges(graph).filter((e) => e.subject === id).map((e) => e.object);
  }
  function descendantsOf(graph, id) {
    const out = /* @__PURE__ */ new Set();
    const queue = [...directChildrenOf(graph, id)];
    while (queue.length) {
      const next = queue.shift();
      if (out.has(next)) continue;
      out.add(next);
      for (const c of directChildrenOf(graph, next)) if (!out.has(c)) queue.push(c);
    }
    return out;
  }
  function ancestorsOf(graph, id) {
    const out = /* @__PURE__ */ new Set();
    const queue = [...directParentsOf(graph, id)];
    while (queue.length) {
      const next = queue.shift();
      if (out.has(next)) continue;
      out.add(next);
      for (const p of directParentsOf(graph, next)) if (!out.has(p)) queue.push(p);
    }
    return out;
  }
  function inheritsApplicable(graph, entityType) {
    let byType = inheritsApplicableCache.get(graph);
    if (!byType) {
      byType = /* @__PURE__ */ new Map();
      inheritsApplicableCache.set(graph, byType);
    }
    if (byType.has(entityType)) return byType.get(entityType);
    const ok = inheritsEdges(graph).some((e) => {
      const s = graph.byId.get(e.subject);
      const o = graph.byId.get(e.object);
      return !!s && !!o && s.class === entityType && o.class === entityType;
    });
    byType.set(entityType, ok);
    return ok;
  }
  function ownSurfaceHit(ind, termTokens) {
    const labelLc = String(ind.label || "").toLowerCase();
    if (termTokens.every((tok) => labelLc.includes(tok))) return "label";
    const attrs = (ind.attributes || []).map((a) => String(a.value ?? "").toLowerCase());
    if (termTokens.every((tok) => attrs.some((v) => v.includes(tok)))) return "attr";
    return null;
  }
  function sortFindHits(hits) {
    return hits.slice().sort((a, b) => FIND_TIER[b.via] - FIND_TIER[a.via] || String(a.ind.label).length - String(b.ind.label).length).map((h) => h.ind);
  }
  function fuzzyFindHit(ind, term) {
    const tLc = String(term || "").trim().toLowerCase();
    if (tLc.length < 4) return false;
    const bound = fuzzyBound(tLc);
    if (editDistance(String(ind.label || "").toLowerCase(), tLc, bound) <= bound) return true;
    for (const comp of componentSet(ind.label)) {
      if (editDistance(comp, tLc, bound) <= bound) return true;
    }
    return false;
  }
  function computeFind(graph, entityType, term) {
    const pool = graph.individuals.filter((i) => i.class === entityType);
    const termTokens = [...componentSet(term)];
    if (!termTokens.length || !pool.length) return { narrow: [], broad: [] };
    const cascade = inheritsApplicable(graph, entityType);
    const narrowHits = [];
    for (const ind of pool) {
      const own = ownSurfaceHit(ind, termTokens);
      if (own) {
        narrowHits.push({ ind, via: own });
        continue;
      }
      if (!cascade) continue;
      const viaChain = [...descendantsOf(graph, ind.id)].some((did) => {
        const d = graph.byId.get(did);
        return !!d && !!ownSurfaceHit(d, termTokens);
      });
      if (viaChain) narrowHits.push({ ind, via: "chain" });
    }
    if (narrowHits.length || !cascade) return { narrow: sortFindHits(narrowHits), broad: [] };
    const broadHits = /* @__PURE__ */ new Map();
    for (const ind of pool) {
      for (const ancId of ancestorsOf(graph, ind.id)) {
        if (!broadHits.has(ancId)) {
          const anc = graph.byId.get(ancId);
          if (anc && anc.class === entityType && fuzzyFindHit(anc, term)) {
            broadHits.set(ancId, { ind: anc, via: "chain" });
          }
        }
        for (const sibId of directChildrenOf(graph, ancId)) {
          if (sibId === ind.id || broadHits.has(sibId)) continue;
          const sib = graph.byId.get(sibId);
          if (sib && sib.class === entityType && fuzzyFindHit(sib, term)) broadHits.set(sibId, { ind: sib, via: "chain" });
        }
      }
    }
    return { narrow: [], broad: sortFindHits([...broadHits.values()]) };
  }
  function evalSet(graph, ast, opts) {
    switch (ast.node) {
      case "clause":
        return traverse(graph, ast.clause, opts).matches || [];
      case "allOfClass":
        return graph.individuals.filter((i) => i.class === ast.entityType);
      // Predicate-find as a set atom: the narrow-then-broaden cascade's result,
      // transparently flattened ("related, not exact" is a render concern).
      case "find": {
        const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
        return narrow.length ? narrow : broad;
      }
      // Subjects with any edge of a kind; an existential negation differences
      // this off allOfClass to yield "modules that import nothing".
      case "existsEdge": {
        const subs = new Set(kindsFor(ast.kind).flatMap((k) => edgesOfKind2(graph, k)).map((e) => e.subject));
        return graph.individuals.filter((i) => subs.has(i.id) && (!ast.entityType || i.class === ast.entityType));
      }
      // Forward complement: the verb's object-grain universe minus what the
      // subject reaches via that verb ("what doesn't it import").
      case "forwardComplement": {
        const r = resolveTermOrContext(graph, ast.subjectTerm, opts && opts.contextId);
        if (!r.match) return [];
        const universeType = kindObjectClass(graph, ast.kind);
        if (!universeType) return [];
        const positive = new Set(forwardOverSet(graph, ast.kind, /* @__PURE__ */ new Set([r.match.id])).map((x) => x.id));
        return graph.individuals.filter((i) => i.class === universeType && !positive.has(i.id));
      }
      case "reverseSet": {
        const ids = new Set(evalSet(graph, ast.inner, opts).map((i) => i.id));
        return reverseOverSet(graph, ast.kind, ast.entityType, ids);
      }
      case "forwardSet": {
        const ids = new Set(evalSet(graph, ast.inner, opts).map((i) => i.id));
        return forwardOverSet(graph, ast.kind, ids);
      }
      // The previous list-shaped answer's own id set. Only reached with a real,
      // non-empty `prev` — the no-`prev` case is intercepted earlier as an
      // honest "needs a previous answer" miss.
      case "prevSet": {
        const prev = opts && opts.prev;
        return Array.isArray(prev) ? prev.map((id) => graph.byId.get(id)).filter(Boolean) : [];
      }
      case "membership": {
        const owner = resolveMembershipOwner(graph, ast.term, opts && opts.contextId);
        if (owner.kind === "dir") {
          if (!ast.entityType || ast.entityType === "Module") return owner.mods;
          const ids = new Set(owner.mods.map((m) => m.id));
          const objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids)));
          return objs.filter((o) => o.class === ast.entityType);
        }
        if (owner.kind === "miss") return [];
        const { own, inherited } = computeMembership(graph, owner.id, owner.entityClass, ast.entityType);
        return own.length ? own : inherited;
      }
      case "qualifier": {
        if (ast.inner.node === "membership") return evalMembershipComposite(graph, ast, opts).matches;
        const base = evalSet(graph, ast.inner, opts);
        return base.filter((ind) => ast.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f])));
      }
      case "boolean":
        return evalBoolean(graph, ast, opts);
      case "anaphora":
        return evalAnaphora(graph, ast, opts).matches;
      default:
        return [];
    }
  }
  function evalBoolean(graph, ast, opts) {
    let acc = [];
    for (const atom of ast.atoms) {
      if (atom.op === "seed") {
        acc = evalSet(graph, atom.ast, opts);
        continue;
      }
      if (atom.kind === "qual") {
        const holds = (ind) => atom.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f]));
        acc = atom.op === "difference" ? acc.filter((i) => !holds(i)) : acc.filter((i) => holds(i));
        continue;
      }
      const oids = new Set(evalSet(graph, atom.ast, opts).map((i) => i.id));
      if (atom.op === "intersection") acc = acc.filter((i) => oids.has(i.id));
      else if (atom.op === "difference") acc = acc.filter((i) => !oids.has(i.id));
      else if (atom.op === "union") {
        const seen = new Set(acc.map((i) => i.id));
        for (const other of evalSet(graph, atom.ast, opts)) if (!seen.has(other.id)) {
          seen.add(other.id);
          acc.push(other);
        }
      }
    }
    return acc;
  }
  function resolveInSentenceCandidates(graph, terms) {
    if (!Array.isArray(terms) || terms.length < 2) return null;
    const seen = /* @__PURE__ */ new Set();
    const resolved = [];
    for (const term of terms) {
      const r = resolveObject(graph, term);
      if (r && r.match && !seen.has(r.match.id)) {
        seen.add(r.match.id);
        resolved.push(r.match);
      }
    }
    return resolved.length >= 2 ? resolved : null;
  }
  function evalAnaphora(graph, ast, opts) {
    const inSentence = resolveInSentenceCandidates(graph, ast.candidateTerms);
    let baseItems = inSentence;
    if (!baseItems) {
      const prev = opts && opts.prev;
      if (!Array.isArray(prev) || !prev.length) return { compositeMiss: true, reason: "no-prev", matches: [] };
      baseItems = prev.map((id) => graph.byId.get(id)).filter(Boolean);
    }
    let items = baseItems;
    const f = ast.filter;
    if (f && f.type === "qual") {
      items = items.filter((ind) => f.filters.every((q) => qualHolds(graph, ind, QUALIFIERS[q])));
    } else if (f && f.type === "clause") {
      const r = resolveObject(graph, f.clause.object);
      if (!r.match) items = [];
      else {
        const sib = SYMBOL_GRAIN_SIBLING[f.clause.kind];
        const kinds = [...kindsFor(f.clause.kind), ...sib ? [sib] : []];
        const ok = new Set(kinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === r.match.id).map((e) => e.subject));
        items = items.filter((ind) => ok.has(ind.id));
      }
    }
    const sameClass = (list) => list.length && list.every((x) => x.class === list[0].class) ? list[0].class : null;
    const common = items.length ? sameClass(items) : sameClass(baseItems);
    if (ast.mode === "count") return { compositeKind: "count", count: items.length, entityType: common, matches: [] };
    return { compositeKind: "set", matches: items, entityType: common };
  }
  function degreeMetric(graph, ind, metric) {
    const kinds = metric.kind === "*" ? DEGREE_KINDS : [metric.kind, ...metric.sibling ? [metric.sibling] : []];
    let n = 0;
    for (const k of kinds) for (const e of edgesOfKind2(graph, k)) {
      const out = e.subject === ind.id;
      const inc = e.object === ind.id;
      if (metric.dir === "out" && out) {
        if (metric.filter) {
          const o = graph.byId.get(e.object);
          if (!o || o.class !== metric.filter) continue;
        }
        n += 1;
      } else if (metric.dir === "in" && inc) n += 1;
      else if (metric.dir === "both" && (out || inc)) n += 1;
    }
    return n;
  }
  function evalRecentCommits(graph) {
    const commits = graph.individuals.filter((i) => i.class === "Commit");
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return { compositeKind: "recentCommits", matches: commits };
  }
  function evalCommitFilter(graph, ast) {
    const { op, pivotRaw } = ast;
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "").slice(0, 10);
    let pivotDate = null;
    let pivotId = null;
    if (COMMIT_FILTER_DATE_RE.test(pivotRaw)) {
      pivotDate = pivotRaw;
    } else {
      const { match, ambiguous } = resolveObject(graph, pivotRaw, { expectedClass: "Commit" });
      if (match && !ambiguous && match.class === "Commit" && dateOf(match)) {
        pivotId = match.id;
        pivotDate = dateOf(match);
      }
    }
    if (!pivotDate) return { compositeKind: "commitFilter", op, pivotRaw, pivotResolved: false, matches: [] };
    const matches = graph.individuals.filter((i) => i.class === "Commit" && i.id !== pivotId && dateOf(i)).filter((c) => {
      const d = dateOf(c);
      if (op === "since") return d >= pivotDate;
      if (op === "before") return d < pivotDate;
      if (op === "after") return d > pivotDate;
      return d === pivotDate;
    }).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return { compositeKind: "commitFilter", op, pivotRaw, pivotDate, pivotResolved: true, matches };
  }
  function evalTemporal(graph, ast, opts) {
    const inner = evalSet(graph, ast.inner, opts);
    const ids = new Set(inner.map((i) => i.id));
    if (!ids.size) return { compositeKind: "temporal", matches: [], entityType: ast.entityType, innerCount: 0 };
    const commits = reverseOverSet(graph, "touches", "Commit", ids);
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    return { compositeKind: "temporal", matches: commits, entityType: ast.entityType, innerCount: inner.length };
  }
  function evalSuperlative(graph, ast) {
    const pool = graph.individuals.filter((i) => i.class === ast.entityType);
    const scored = pool.map((ind) => ({ ind, score: degreeMetric(graph, ind, ast.metric) })).sort((a, z) => ast.extreme === "most" ? z.score - a.score : a.score - z.score);
    if (!scored.length) return { compositeKind: "superlative", entityType: ast.entityType, matches: [] };
    const best = scored[0].score;
    const winners = scored.filter((s) => s.score === best).map((s) => s.ind);
    return { compositeKind: "superlative", entityType: ast.entityType, metricNoun: ast.metricNoun, extreme: ast.extreme, score: best, matches: winners };
  }
  function evalMembershipComposite(graph, ast, opts) {
    const qualNode = ast.node === "qualifier" && ast.inner.node === "membership" ? ast : null;
    const memNode = qualNode ? qualNode.inner : ast;
    const entityType = memNode.entityType;
    const filterFn = qualNode ? (ind) => qualNode.filters.every((f) => qualHolds(graph, ind, QUALIFIERS[f])) : null;
    const owner = resolveMembershipOwner(graph, memNode.term, opts && opts.contextId);
    if (owner.kind === "dir") {
      let objs;
      if (!entityType || entityType === "Module") objs = owner.mods;
      else {
        const ids = new Set(owner.mods.map((m) => m.id));
        objs = uniqueById(MEMBERSHIP_KINDS.flatMap((k) => forwardOverSet(graph, k, ids))).filter((o) => o.class === entityType);
      }
      if (filterFn) objs = objs.filter(filterFn);
      return { compositeKind: "set", matches: objs, entityType };
    }
    if (owner.kind === "miss") return { compositeKind: "set", matches: [], entityType };
    const { own, inherited, viaLabel } = computeMembership(graph, owner.id, owner.entityClass, entityType, filterFn);
    const inheritedNotOwn = !own.length && inherited.length > 0;
    return {
      compositeKind: "membership",
      entityType,
      matches: inheritedNotOwn ? inherited : own,
      inheritedNotOwn,
      viaLabel,
      ownerLabel: owner.label
    };
  }
  function evalExists(graph, ast) {
    const { entityType, term, scopeModule } = ast;
    let scopeMatch = null;
    if (scopeModule) {
      const r = resolveObject(graph, scopeModule, { expectedClass: "Module" });
      if (!r.match) return { compositeKind: "exists", entityType, term, scopeModule, scopeMiss: true, matches: [] };
      scopeMatch = r.match;
    }
    if (term) {
      const r = resolveObject(graph, term, { expectedClass: entityType });
      const inScope = !scopeMatch || r.match && moduleIdOf2(graph, r.match) === scopeMatch.id;
      const hit2 = r.match && inScope;
      return {
        compositeKind: "exists",
        entityType,
        term,
        scopeModule,
        scopeMatch,
        matches: hit2 ? [r.match] : []
      };
    }
    const pool = scopeMatch ? refineToEntities(graph, /* @__PURE__ */ new Set([scopeMatch.id]), entityType) : graph.individuals.filter((i) => i.class === entityType);
    return { compositeKind: "exists", entityType, term: null, scopeModule, scopeMatch, matches: pool };
  }
  function withinScope(graph, ind, owner) {
    const moduleId = moduleIdOf2(graph, ind);
    if (owner.kind === "dir") return owner.mods.some((m) => m.id === ind.id || m.id === moduleId);
    return moduleId === owner.id || membershipOwnSet(graph, owner.id).some((o) => o.id === ind.id);
  }
  function evalQualCheck(graph, ast, opts) {
    const { term, qualifier, negated, scope } = ast;
    const r = resolveTermOrContext(graph, term, opts.contextId);
    if (r.unresolvedPronoun) return { compositeKind: "qualCheck", qualCheckMiss: "pronoun", term, matches: [] };
    if (!r.match) return { compositeKind: "qualCheck", qualCheckMiss: "unresolved", term, matches: [] };
    if (scope) {
      const owner = resolveMembershipOwner(graph, scope, opts.contextId);
      if (owner.kind === "miss") return { compositeKind: "qualCheck", qualCheckMiss: "scope", term, scope, matches: [] };
      if (!withinScope(graph, r.match, owner)) {
        return {
          compositeKind: "qualCheck",
          qualCheckMiss: "outsideScope",
          term,
          scope,
          subjectLabel: r.match.label,
          scopeLabel: owner.kind === "dir" ? scope : owner.label,
          matches: []
        };
      }
    }
    const rawHolds = qualHolds(graph, r.match, QUALIFIERS[qualifier]);
    const holds = negated ? !rawHolds : rawHolds;
    return { compositeKind: "qualCheck", subject: r.match, qualifier, negated, holds, matches: [r.match] };
  }
  function evalComposite(graph, ast, opts = {}) {
    if (ast.node === "miss") return { compositeMiss: true, reason: ast.reason || null, matches: [] };
    if (ast.node === "exists") return evalExists(graph, ast);
    if (ast.node === "qualCheck") return evalQualCheck(graph, ast, opts);
    if (ast.node === "count") return { compositeKind: "count", count: evalSet(graph, ast.base, opts).length, entityType: ast.entityType, matches: [] };
    if (ast.node === "list") return { compositeKind: "list", matches: evalSet(graph, ast.base, opts), entityType: ast.entityType, scoped: ast.scoped };
    if (ast.node === "superlative") return evalSuperlative(graph, ast);
    if (ast.node === "temporal") return evalTemporal(graph, ast, opts);
    if (ast.node === "recentCommits") return evalRecentCommits(graph);
    if (ast.node === "commitFilter") return evalCommitFilter(graph, ast);
    if (ast.node === "anaphora") return evalAnaphora(graph, ast, opts);
    if (ast.node === "membership" || ast.node === "qualifier" && ast.inner.node === "membership") {
      return evalMembershipComposite(graph, ast, opts);
    }
    if (ast.node === "find") {
      const { narrow, broad } = computeFind(graph, ast.entityType, ast.term);
      return {
        compositeKind: "find",
        entityType: ast.entityType,
        term: ast.term,
        matches: narrow.length ? narrow : broad,
        broad: !narrow.length && broad.length > 0
      };
    }
    if ((ast.node === "reverseSet" || ast.node === "forwardSet") && ast.inner.node === "prevSet" && !(Array.isArray(opts.prev) && opts.prev.length)) {
      return { compositeMiss: true, reason: "no-prev", matches: [] };
    }
    return { compositeKind: "set", matches: evalSet(graph, ast, opts), entityType: ast.entityType || null };
  }
  function compositionalHint() {
    return 'compositional queries also work: "which functions call X and call Y", "what calls something that imports X", "public methods of X", "list functions" / "show me the classes", "how many classes", "which module has the most imports", "find me the payment class", or (after a listing) "which of those are tested"';
  }
  function describeFindHit(ind) {
    const label = ["Function", "Method"].includes(ind.class) ? `${ind.label}()` : ind.label;
    if (ind.class === "Module") return label;
    const mod = moduleLabelOf(ind);
    return mod && mod !== "(unknown module)" ? `${label} in ${mod}` : label;
  }
  function renderComposite(parsed, result, graph) {
    if (result.compositeMiss) {
      if (result.reason === "no-prev") {
        return { content: `"those"/"them" needs a previous answer to refer to \u2014 ask a listing question first, then follow up.`, miss: true, ambiguous: false };
      }
      return { content: `couldn't compile this compositional question${result.reason ? ` (${result.reason})` : ""}. ${compositionalHint()}.`, miss: true, ambiguous: false };
    }
    if (result.compositeKind === "exists") {
      if (result.scopeMiss) {
        return { content: `no module matching "${result.scopeModule}" found in the index.`, miss: true, ambiguous: false };
      }
      const kindSingular = nounFor(result.entityType, 1);
      const kindPlural = nounFor(result.entityType, 2);
      const scopeSuffix = result.scopeMatch ? ` in ${result.scopeMatch.label}` : "";
      if (result.term) {
        if (!result.matches.length) {
          return { content: `No \u2014 no ${kindSingular} named "${result.term}" found${scopeSuffix}.`, miss: true, ambiguous: false };
        }
        const hit2 = result.matches[0];
        const modLabel = moduleLabelOf(hit2);
        const definedIn = hit2.class === "Module" ? "" : modLabel && modLabel !== "(unknown module)" ? `, ${pickPhrase("defined-in", hit2.id, "defined in")} ${modLabel}` : "";
        return { content: `Yes \u2014 ${hit2.label} is a ${kindSingular}${definedIn}.`, miss: false, ambiguous: false, matches: result.matches };
      }
      if (!result.matches.length) {
        return { content: `No \u2014 no ${kindPlural} found${scopeSuffix}.`, miss: true, ambiguous: false };
      }
      return { content: `Yes \u2014 ${compositeList(result.matches)}${scopeSuffix}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "qualCheck") {
      if (result.qualCheckMiss === "pronoun") {
        return { content: `"${result.term}" needs a selected node to refer to \u2014 click a node first, or name it directly.`, miss: true, ambiguous: false };
      }
      if (result.qualCheckMiss === "unresolved") {
        return { content: `couldn't find "${result.term}" in the index to check.`, miss: true, ambiguous: false };
      }
      if (result.qualCheckMiss === "scope") {
        return { content: `couldn't find "${result.scope}" in the index to check inside.`, miss: true, ambiguous: false };
      }
      if (result.qualCheckMiss === "outsideScope") {
        return { content: `No \u2014 ${result.subjectLabel} isn't in ${result.scopeLabel}.`, miss: true, ambiguous: false };
      }
      const label = result.subject.label;
      const truePhrase = result.negated ? `not ${result.qualifier}` : result.qualifier;
      const falsePhrase = result.negated ? result.qualifier : `not ${result.qualifier}`;
      return {
        content: `${result.holds ? "Yes" : "No"} \u2014 ${label} is ${result.holds ? truePhrase : falsePhrase}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "count") {
      const noun = result.entityType ? nounFor(result.entityType, result.count) : result.count === 1 ? "result" : "results";
      return { content: `${result.count} ${noun}.`, miss: false, ambiguous: false, matches: [] };
    }
    if (result.compositeKind === "list") {
      if (!result.matches.length) {
        return { content: `no ${nounFor(result.entityType, 2)} in this index.`, miss: true, ambiguous: false, matches: [] };
      }
      const scopeable = !["Module", "Commit", "Fact", "Utterance", "Session", "Source", "Rule"].includes(result.entityType);
      const hint = !result.scoped && scopeable && result.matches.length > OVERFLOW_CAP ? ` \u2014 narrow with "${nounFor(result.entityType, 2)} in <module>"` : "";
      return { content: `${compositeList(result.matches)}${hint}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "membership") {
      if (!result.matches.length) {
        return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
      }
      if (result.inheritedNotOwn) {
        const kindPlural = nounFor(result.entityType, 2);
        const ownerPhrase = result.ownerLabel ? `${result.ownerLabel} has no own ${kindPlural}` : `no own ${kindPlural}`;
        return {
          content: `${ownerPhrase} \u2014 inherited from ${result.viaLabel}: ${compositeList(result.matches)}.`,
          miss: false,
          ambiguous: false,
          matches: result.matches,
          inheritedNotOwn: true
        };
      }
      return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "find") {
      const typeNoun = nounFor(result.entityType, 1);
      if (!result.matches.length) {
        return { content: `no ${nounFor(result.entityType, 2)} found matching "${result.term}".`, miss: true, ambiguous: false, matches: [] };
      }
      const cited = result.matches.length === 1 ? describeFindHit(result.matches[0]) : compositeList(result.matches);
      if (result.broad) {
        return {
          content: `no exact ${typeNoun} named "${result.term}", but found a related ${result.matches.length === 1 ? typeNoun : nounFor(result.entityType, 2)}: ${cited}.`,
          miss: false,
          ambiguous: false,
          matches: result.matches,
          relatedNotExact: true
        };
      }
      return { content: `${cited}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.compositeKind === "recentCommits") {
      if (!result.matches.length) return { content: `no commits recorded in this index.`, miss: true, ambiguous: false, matches: [] };
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      const shown = result.matches.slice(0, HISTORY_CAP).map((c) => {
        const day = dateOf(c).slice(0, 10);
        const msg = (c.attributes || []).find((a) => a.key === "message")?.value || "";
        return `${c.label}${day ? ` (${day})` : ""}${msg ? ` \u2014 ${msg}` : ""}`;
      });
      const tail = result.matches.length > HISTORY_CAP ? ` \u2026+${result.matches.length - HISTORY_CAP} more` : "";
      return {
        content: `${result.matches.length} recent commit(s): ${shown.join(", ")}${tail}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "commitFilter") {
      if (!result.pivotResolved) {
        return {
          content: `"${result.pivotRaw}" isn't a recognized date (yyyy-mm-dd) or a known commit \u2014 try "what changed since 2026-06-01" or "what changed before <commit>".`,
          miss: true,
          ambiguous: false,
          matches: []
        };
      }
      if (!result.matches.length) {
        return { content: `no commits recorded ${result.op} ${result.pivotRaw}.`, miss: true, ambiguous: false, matches: [] };
      }
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      const shown = result.matches.slice(0, HISTORY_CAP).map((c) => {
        const day = dateOf(c).slice(0, 10);
        const msg = (c.attributes || []).find((a) => a.key === "message")?.value || "";
        return `${c.label}${day ? ` (${day})` : ""}${msg ? ` \u2014 ${msg}` : ""}`;
      });
      const tail = result.matches.length > HISTORY_CAP ? ` \u2026+${result.matches.length - HISTORY_CAP} more` : "";
      return {
        content: `${result.matches.length} commit(s) changed ${result.op} ${result.pivotRaw}: ${shown.join(", ")}${tail}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "superlative") {
      if (!result.matches.length) return { content: `no ${nounFor(result.entityType, 2)} to rank in this index.`, miss: true, ambiguous: false };
      const lead = result.extreme === "most" ? "the most" : "the fewest";
      const tie = result.matches.length > 1 ? ` (${result.matches.length}-way tie)` : "";
      return {
        content: `${compositeList(result.matches)} \u2014 ${lead} ${result.metricNoun} (${result.score})${tie}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.compositeKind === "temporal") {
      const n = result.innerCount || 0;
      const setNoun = result.entityType ? nounFor(result.entityType, n || 2) : n === 1 ? "entity" : "entities";
      const wasWere = n === 1 ? "was" : "were";
      if (!n) {
        return { content: `nothing in the index matches the inner set, so there is no change history to date. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
      }
      if (!result.matches.length) {
        return { content: `no recorded commit touched the ${n} ${setNoun} in that set in this index. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
      }
      const newest = result.matches[0];
      const date = (newest.attributes || []).find((a) => a.key === "date")?.value || "";
      if (!date) {
        return { content: `the ${setNoun} in that set ${wasWere} last touched by commit ${newest.label}, but this index records no commit dates \u2014 regenerate the graph to attach mgx:commitDate.`, miss: true, ambiguous: false, matches: result.matches };
      }
      const msg = (newest.attributes || []).find((a) => a.key === "message")?.value || "";
      const day = String(date).slice(0, 10);
      const more = result.matches.length - 1;
      return {
        content: `the ${setNoun} in that set ${wasWere} last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (!result.matches.length) {
      return { content: `nothing in the index matches that${result.entityType ? ` (${nounFor(result.entityType, 2)})` : ""}. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false, matches: [] };
    }
    return { content: `${compositeList(result.matches)}.`, miss: false, ambiguous: false, matches: result.matches };
  }
  function rephraseHint() {
    return `"which <functions|classes|modules> <imports|calls|uses|inherits from|tests> <name>" or "what does <name> <import|call|export>" or "what uses <name>" or "where is <name> defined" / "where is <name> mentioned" or "when did <name> change" or "which commits touched <name>" or "which changes touch commit <sha>"/"what did commit <sha> touch" (a commit's own changes) or plainly "what calls this" (about a selected node) or "what does <term> mean"/"what is a <ClassName>" (about the graph's own vocabulary). ` + compositionalHint();
  }
  function touchesRephraseHint(graph = null) {
    if (graph && moduleCountOf(graph) === 0) {
      return "This store holds no code index, so it records no modules or commits to look through.";
    }
    return `Try "who touched <a module that actually has commits>" or "/describe <module>" to see what's in the index.`;
  }
  function componentSet(s) {
    return new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  }
  function derivationalStem(w) {
    if (w.length < 5) return w;
    const stripped = w.replace(/(ing|ers|ors|er|or)$/, "");
    if (stripped === w) return w;
    return stripped.length >= 3 && stripped[stripped.length - 1] === stripped[stripped.length - 2] ? stripped.slice(0, -1) : stripped;
  }
  function joinedForm(label) {
    return String(label || "").replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[/\-_.]+/g, "");
  }
  function joinedQueryForm(term) {
    return String(term || "").trim().replace(/^(?:the|a|an)\s+/i, "").toLowerCase().replace(/[\s\-_]+/g, "");
  }
  function resolveObjectCore(graph, term, { expectedClass = null } = {}) {
    const t = String(term || "").trim();
    if (!t) return { match: null, candidates: [], tier: null, ambiguous: false };
    const tLc = t.toLowerCase();
    const pool = expectedClass ? graph.individuals.filter((i) => i.class === expectedClass) : graph.individuals;
    const shaTerm = tLc.match(/^(commit[:\s])?([0-9a-f]{7,40})$/);
    if (shaTerm) {
      const sha = shaTerm[2];
      const hits = pool.filter((i) => i.class === "Commit" && (String(i.id).toLowerCase().startsWith(`commit:${sha}`) || String(i.label).toLowerCase().startsWith(sha)));
      if (hits.length === 1) return { match: hits[0], candidates: [], tier: 1, ambiguous: false };
      if (hits.length > 1) return { match: hits[0], candidates: hits.slice(1, 5), tier: 1, ambiguous: true };
      if (shaTerm[1]) return { match: null, candidates: [], tier: null, ambiguous: false };
    }
    const exact = pool.find((i) => String(i.label).toLowerCase() === tLc || String(i.id).toLowerCase() === tLc);
    if (exact) return { match: exact, candidates: [], tier: 1, ambiguous: false };
    const extLc = `ext:${tLc}`;
    let extId = null;
    outer: for (const g of graph.relations) {
      for (const e of g.edges) {
        if (String(e.object).toLowerCase() === extLc) {
          extId = e.object;
          break outer;
        }
      }
    }
    if (extId && !expectedClass) return { match: { id: extId, label: t, class: null }, candidates: [], tier: 2, ambiguous: false };
    const andParts = t.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
    if (andParts.length > 1) {
      const operandIds = /* @__PURE__ */ new Set();
      for (const part of andParts) {
        const r = resolveObjectCore(graph, part, { expectedClass });
        if (r.match && !r.ambiguous) operandIds.add(r.match.id);
      }
      if (operandIds.size > 1) return { match: null, candidates: [], tier: null, ambiguous: false };
    }
    const scored = [];
    const dotted = !tLc.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(tLc);
    if (dotted) {
      const lastSeg = tLc.split(".").pop();
      for (const m of pool) {
        const label = String(m.label || "").toLowerCase();
        if (m.class === "Module") {
          if (label.split("/").pop() === tLc) scored.push({ ind: m, score: 1e3 - Math.abs(label.length - tLc.length) });
        } else if (label.includes(tLc)) {
          scored.push({ ind: m, score: 2e3 - Math.abs(label.length - tLc.length) });
        } else if (label.endsWith(`.${lastSeg}`)) {
          scored.push({ ind: m, score: 1500 - Math.abs(label.length - tLc.length) });
        }
      }
    } else {
      const termComps = [...componentSet(t)];
      const pathToken = tLc.split(/\s+/).find((tok) => tok.includes("/"));
      const slashStem = pathToken ? pathToken.split("/").pop().replace(/\.[a-z0-9]+$/, "") : null;
      const qWords = t.trim().replace(/^(?:the|a|an)\s+/i, "").trim().split(/\s+/).filter(Boolean);
      const isMultiWord = qWords.length >= 2;
      const qJoined = isMultiWord ? joinedQueryForm(t) : null;
      for (const m of pool) {
        const label = String(m.label || "").toLowerCase();
        const stem = label.split("/").pop().replace(/\.[a-z0-9]+$/, "");
        if (stem === tLc) {
          scored.push({ ind: m, score: 5e3 });
          continue;
        }
        if (tLc.length >= 4 && (stem.startsWith(tLc) || stem.endsWith(tLc))) {
          scored.push({ ind: m, score: 4e3 - Math.abs(stem.length - tLc.length) });
          continue;
        }
        if (isMultiWord) {
          const candJoined = joinedForm(m.label);
          if (candJoined && candJoined === qJoined) {
            scored.push({ ind: m, score: 5e3 });
            continue;
          }
          const hasExplicitSeparator = /[/_-]/.test(m.label) || /\.[a-z0-9]+$/i.test(String(m.label || ""));
          if (candJoined && hasExplicitSeparator && qJoined.length >= 4 && candJoined.includes(qJoined)) {
            scored.push({ ind: m, score: 2e3 - Math.abs(candJoined.length - qJoined.length) });
            continue;
          }
        }
        if (m.class === "Module") {
          const termRoot = derivationalStem(tLc);
          if (termRoot !== tLc && termRoot === derivationalStem(stem)) {
            const bound = fuzzyBound(tLc);
            if (editDistance(stem, tLc, bound) > bound) {
              scored.push({ ind: m, score: 3e3 - Math.abs(stem.length - tLc.length) });
              continue;
            }
          }
        }
        if (tLc.length >= 4 && label.includes(tLc)) {
          scored.push({ ind: m, score: 1e3 - Math.abs(label.length - tLc.length) });
          continue;
        }
        const labelComps = componentSet(m.label);
        const overlap = termComps.filter((c) => labelComps.has(c)).length;
        if (overlap > 0 && (!slashStem || labelComps.has(slashStem))) {
          scored.push({ ind: m, score: overlap / termComps.length * 10 });
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length) {
      const [best, ...rest] = scored;
      const tied = rest.filter((x) => x.score === best.score);
      return {
        match: best.ind,
        candidates: rest.slice(0, 4).map((x) => x.ind),
        tier: 3,
        ambiguous: tied.length > 0
      };
    }
    const pathShaped = dotted || tLc.includes("/");
    let proseResult = null;
    const proseHits = !pathShaped && typeof lookupByProseTokens === "function" ? lookupByProseTokens(graph.proseIndex, t).filter((h) => !expectedClass || graph.byId.get(h.id)?.class === expectedClass) : [];
    if (proseHits.length) {
      const [best, ...rest] = proseHits;
      const bestInd = graph.byId.get(best.id);
      if (bestInd) {
        const tied = rest.filter((h) => h.score === best.score);
        proseResult = {
          match: bestInd,
          candidates: rest.slice(0, 4).map((h) => graph.byId.get(h.id)).filter(Boolean),
          tier: 4,
          ambiguous: tied.length > 0,
          matchedVia: "prose"
        };
        if (!proseResult.ambiguous && best.via !== "spell") return proseResult;
      }
    }
    if (!shaTerm && tLc.length >= 4) {
      const bound = fuzzyBound(tLc);
      let best = bound + 1;
      let hits = [];
      for (const m of pool) {
        let d = editDistance(String(m.label || "").toLowerCase(), tLc, bound);
        if (d > 0) {
          for (const comp of componentSet(m.label)) {
            if (d <= 0) break;
            d = Math.min(d, editDistance(comp, tLc, bound));
          }
        }
        if (d < best) {
          best = d;
          hits = [m];
        } else if (d === best && d <= bound) hits.push(m);
      }
      if (best <= bound && hits.length === 1) {
        return { match: hits[0], candidates: [], tier: 5, ambiguous: false, matchedVia: "fuzzy" };
      }
      if (best <= bound && hits.length > 1 && !proseResult) {
        const [bestInd, ...rest] = hits;
        return { match: bestInd, candidates: rest.slice(0, 4), tier: 5, ambiguous: true, matchedVia: "fuzzy" };
      }
    }
    return proseResult || { match: null, candidates: [], tier: null, ambiguous: false };
  }
  function unplacedTermWords(term, label) {
    const labelJoined = joinedForm(label);
    const labelComps = [...componentSet(label)];
    const out = [];
    for (const w of componentSet(term)) {
      if (labelJoined.includes(w)) continue;
      if (labelComps.some((c) => derivationalStem(c) === derivationalStem(w))) continue;
      if (CONTENT_VOCAB.has(w) || NOISE_OR_SCAFFOLD.has(w)) continue;
      out.push(w);
    }
    return out;
  }
  function declineOnUnplacedWords(result, term) {
    if (!result?.match || result.ambiguous || result.tier !== 3 || result.matchedVia) return result;
    const unplaced = unplacedTermWords(term, result.match.label);
    if (!unplaced.length) return result;
    return {
      match: null,
      candidates: [],
      tier: null,
      ambiguous: false,
      unplacedWords: unplaced,
      nearestLabel: result.match.label
    };
  }
  function resolveObject(graph, term, opts = {}) {
    const { expectedClass = null } = opts;
    if (!expectedClass) {
      const raw = String(term || "").trim();
      const stripped = raw.replace(LEADING_ARTICLE_RE, "").trim();
      const grainMatch = stripped.match(TRAILING_GRAIN_WORD_RE);
      if (grainMatch) {
        const head = stripped.slice(0, grainMatch.index).trim();
        const grainClass = ENTITY_TO_TYPE[grainMatch[1].toLowerCase()];
        if (head && grainClass) {
          const rGrain = declineOnUnplacedWords(resolveObjectCore(graph, head, { expectedClass: grainClass }), head);
          if (rGrain?.match?.id && !rGrain.ambiguous) return rGrain;
        }
      }
      if (stripped && stripped !== raw) {
        const rStripped = declineOnUnplacedWords(resolveObjectCore(graph, stripped, opts), stripped);
        if (rStripped?.match?.id && !rStripped.ambiguous) return rStripped;
      }
      return declineOnUnplacedWords(resolveObjectCore(graph, term, opts), term);
    }
    return resolveObjectCore(graph, term, opts);
  }
  function resolveTermOrContext(graph, term, contextId) {
    if (CONTEXT_PRONOUNS.includes(String(term || "").trim().toLowerCase())) {
      if (!contextId) return { match: null, candidates: [], tier: null, ambiguous: false, unresolvedPronoun: true };
      const ind = graph.byId.get(contextId);
      return ind ? { match: ind, candidates: [], tier: 1, ambiguous: false } : { match: null, candidates: [], tier: null, ambiguous: false, unresolvedPronoun: true };
    }
    return resolveObject(graph, term);
  }
  function refineToEntities(graph, moduleIds, entityType) {
    const out = [];
    for (const e of edgesOfKind2(graph, "defines")) {
      if (!moduleIds.has(e.subject)) continue;
      const ind = graph.byId.get(e.object);
      if (ind && ind.class === entityType) out.push(ind);
    }
    return out;
  }
  function commitTouches(graph, commit, entityType, extra = {}) {
    const wildcard = !entityType || entityType === "Change" || entityType === "Commit";
    const wantCoarse = wildcard || entityType === "Module";
    const wantFine = wildcard || FINE_ENTITY_TYPES.has(entityType);
    const kinds = [...wantCoarse ? ["touches"] : [], ...wantFine ? ["touchesSymbol"] : []];
    let matches = kinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === commit.id).map((e) => graph.byId.get(e.object)).filter(Boolean);
    if (entityType && FINE_ENTITY_TYPES.has(entityType)) matches = matches.filter((m) => m.class === entityType);
    return {
      matches,
      objMatch: commit,
      commitSubject: true,
      ambiguous: false,
      candidates: [],
      traversal: `${kinds.join("+")} edges where subject = commit ${commit.label}`,
      ...extra
    };
  }
  function rankEntryPointModules(graph, term) {
    const queryWords = new Set(String(term || "").toLowerCase().split(/[\s-]+/).filter(Boolean));
    return (graph.individuals || []).filter((i) => i.class === "Module" && ENTRY_POINT_BASENAMES.has(moduleStemOf(i.label))).map((ind) => ({
      ind,
      named: queryWords.has(moduleStemOf(ind.label)) ? 1 : 0,
      depth: String(ind.label).split("/").length,
      fixture: isTestFixturePath(ind.label) ? 1 : 0
    })).sort((a, b) => b.named - a.named || a.depth - b.depth || a.fixture - b.fixture || String(a.ind.label).localeCompare(String(b.ind.label))).map((x) => x.ind);
  }
  function modifierIsWired(shape, kind, entityType) {
    return shape === "reverse" && (kind === "imports" || kind === "calls") && (!entityType || entityType === "Module");
  }
  function traverse(graph, parsed, { contextId = null, prev = null, pinnedObjMatch = null } = {}) {
    if (!parsed) return { matches: [], objMatch: null, candidates: [], traversal: null, ambiguous: false };
    if (parsed.node) return evalComposite(graph, parsed, { contextId, prev });
    if (parsed.ambiguousParse) {
      const branches = parsed.candidates.map((c) => {
        const branchResult = traverse(graph, c, { contextId, prev });
        return { parsed: c, result: branchResult, rendered: render(c, branchResult, graph) };
      });
      return { matches: [], objMatch: null, candidates: parsed.candidates, traversal: null, ambiguous: true, branches };
    }
    const { shape, kind, entityType } = parsed;
    if (shape === "meta") {
      const term = String(parsed.object || "").trim();
      const termLc = term.toLowerCase();
      const match = (graph.individuals || []).find((i) => {
        if (i.class !== "SchemaClass" && i.class !== "SchemaPredicate") return false;
        if (String(i.label).toLowerCase() === termLc) return true;
        const token = (i.attributes || []).find((a) => a.key === "token")?.value;
        return token && String(token).toLowerCase() === termLc;
      });
      if (!match) {
        const fallback = metaFallbackEntityAnswer(graph, term);
        if (fallback) {
          return {
            matches: [fallback.hit],
            objMatch: fallback.hit,
            candidates: [],
            ambiguous: false,
            metaCodeClass: true,
            metaFallbackText: fallback.text,
            traversal: `schema lookup for "${term}" (miss), then unique code-entity individual by label`
          };
        }
        return { matches: [], objMatch: null, candidates: [], traversal: `schema lookup for "${term}"`, ambiguous: false };
      }
      return {
        matches: [match],
        objMatch: match,
        candidates: [],
        traversal: `schema lookup for "${term}"`,
        ambiguous: false
      };
    }
    if (shape === "mentions") {
      const term = String(parsed.object || "").trim();
      const hits = typeof lookupByProseTokens === "function" ? lookupByProseTokens(graph.proseIndex, term) : [];
      const matches2 = hits.map((h) => graph.byId.get(h.id)).filter(Boolean);
      return {
        matches: matches2,
        objMatch: null,
        candidates: [],
        ambiguous: false,
        mentionsShape: true,
        traversal: `proseIndex word lookup for "${term}"`
      };
    }
    if (shape === "where" && ENTRY_POINT_QUERY_RE.test(String(parsed.object || "").trim())) {
      const ranked = rankEntryPointModules(graph, parsed.object);
      return {
        matches: ranked,
        objMatch: ranked[0] || null,
        candidates: ranked.slice(1, 5),
        ambiguous: false,
        entryPointShape: true,
        traversal: `Module individuals with an entry-point basename (${[...ENTRY_POINT_BASENAMES].join("/")}), ranked query-named basename first, then shallower path, then non-test path`
      };
    }
    if (parsed.modifier && parsed.modifier !== "direct" && !modifierIsWired(shape, kind, entityType)) {
      return {
        matches: [],
        objMatch: null,
        candidates: [],
        ambiguous: false,
        unsupportedModifier: true,
        traversal: `modifier "${parsed.modifier}" requested for a "${kind}" query \u2014 no closure traversal exists for this combination yet`
      };
    }
    if (shape === "ask") {
      const subj = resolveTermOrContext(graph, parsed.subject, contextId);
      const obj = resolveTermOrContext(graph, parsed.object, contextId);
      if (!subj.match || !obj.match || subj.ambiguous || obj.ambiguous) {
        return {
          matches: [],
          objMatch: obj.match,
          candidates: obj.candidates,
          traversal: null,
          ambiguous: false,
          answer: null,
          unresolvedPronoun: !!(subj.unresolvedPronoun || obj.unresolvedPronoun)
        };
      }
      let [from, to] = [subj.match, obj.match];
      if (kind === "touches" && to.class === "Commit" && from.class !== "Commit") [from, to] = [to, from];
      const sibling = SYMBOL_GRAIN_SIBLING[kind];
      const kinds = [...new Set(sibling ? [...kindsFor(kind), sibling] : kindsFor(kind))];
      const edges2 = kinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === from.id && e.object === to.id);
      return {
        matches: edges2,
        answer: parsed.negated ? edges2.length === 0 : edges2.length > 0,
        objMatch: obj.match,
        subjMatch: subj.match,
        candidates: [],
        traversal: `${kinds.join("+")} edge from ${from.label} to ${to.label}`,
        ambiguous: false
      };
    }
    let objRes;
    if (pinnedObjMatch) {
      objRes = { match: pinnedObjMatch, candidates: [], ambiguous: false, matchedVia: null };
    } else {
      objRes = resolveTermOrContext(graph, parsed.object, contextId);
      if (parsed.altObject && parsed.altObject !== parsed.object) {
        const altRes = resolveTermOrContext(graph, parsed.altObject, contextId);
        const primaryClean = !!objRes.match && !objRes.ambiguous;
        const altClean = !!altRes.match && !altRes.ambiguous;
        if (!primaryClean && altClean) {
          objRes = altRes;
        } else if (primaryClean && altClean && objRes.match.id !== altRes.match.id) {
          objRes = { ...objRes, ambiguous: true, candidates: [altRes.match, ...objRes.candidates || []] };
        }
      }
      if (parsed.kind === "tests" && objRes.match && !objRes.ambiguous && !String(parsed.object || "").includes("/")) {
        const stripTestInfix = (base) => base.replace(/\.(?:test|spec|tests)(?=\.[^.]+$)/, "");
        const termBase = stripTestInfix(String(parsed.object || "").trim().toLowerCase());
        const collision = (graph.individuals || []).find((i) => {
          if (i.class !== "Module" || i.id === objRes.match.id) return false;
          const base = String(i.label || "").toLowerCase().split("/").pop();
          return base !== stripTestInfix(base) && stripTestInfix(base) === termBase;
        });
        if (collision) objRes = { ...objRes, ambiguous: true, candidates: [collision, ...objRes.candidates || []] };
      }
    }
    const { match: objMatch, candidates, ambiguous, unresolvedPronoun, matchedVia, unplacedWords, nearestLabel } = objRes;
    if (!objMatch) {
      return {
        matches: [],
        objMatch: null,
        candidates,
        traversal: null,
        ambiguous: false,
        unresolvedPronoun,
        unplacedWords,
        nearestLabel
      };
    }
    if (ambiguous) {
      const pool = uniqueById([objMatch, ...candidates || []]).slice(0, OVERFLOW_CAP);
      const branches = pool.map((c) => {
        const branchResult = traverse(graph, parsed, { contextId, prev, pinnedObjMatch: c });
        return { candidate: c, result: branchResult, rendered: render(parsed, branchResult, graph) };
      });
      return { matches: [], objMatch, candidates, traversal: null, ambiguous: true, branches };
    }
    if (shape === "where") {
      const site = (objMatch.attributes || []).find((a) => a.key === "site")?.value || null;
      return {
        matches: [objMatch],
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        whereShape: true,
        site,
        traversal: site ? `site attribute of ${objMatch.label}` : `class + defining module of ${objMatch.label}`
      };
    }
    if (shape === "when") {
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      let commits;
      if (objMatch.class === "Commit") {
        commits = [objMatch];
      } else {
        const edges2 = ["touches", "touchesSymbol"].flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === objMatch.id);
        const seen = /* @__PURE__ */ new Set();
        commits = [];
        for (const e of edges2) {
          if (seen.has(e.subject)) continue;
          seen.add(e.subject);
          const c = graph.byId.get(e.subject);
          if (c && c.class === "Commit") commits.push(c);
        }
        commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      }
      return {
        matches: commits,
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        whenShape: true,
        traversal: `touches+touchesSymbol edges where object = ${objMatch.label}, newest commit date first`
      };
    }
    if (shape === "whoLast") {
      const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
      const edges2 = ["touches", "touchesSymbol"].flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === objMatch.id);
      const seen = /* @__PURE__ */ new Set();
      const commits = [];
      for (const e of edges2) {
        if (seen.has(e.subject)) continue;
        seen.add(e.subject);
        const c = graph.byId.get(e.subject);
        if (c && c.class === "Commit") commits.push(c);
      }
      commits.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      return {
        matches: commits,
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        whoLastShape: true,
        traversal: `touches+touchesSymbol edges where object = ${objMatch.label}, newest commit's author`
      };
    }
    if (kind === "touches" && objMatch.class === "Commit") {
      return commitTouches(graph, objMatch, entityType, { candidates, ambiguous, matchedVia });
    }
    if (shape === "forward") {
      const fwdSibling = SYMBOL_GRAIN_SIBLING[kind];
      const subjIsFineSymbol = !!(fwdSibling && objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
      const fwdKinds = subjIsFineSymbol ? [.../* @__PURE__ */ new Set([...kindsFor(kind), fwdSibling])] : kindsFor(kind);
      if (entityType && entityType !== "Change") {
        const wantClasses = classesForKinds(graph, fwdKinds);
        const siblingClass = FINE_CLASS_SIBLING[entityType];
        if (!wantClasses.has(entityType) && !(siblingClass && wantClasses.has(siblingClass))) {
          return {
            matches: [],
            objMatch,
            candidates,
            ambiguous,
            matchedVia,
            forwardGrainMiss: true,
            wantClasses: [...wantClasses],
            traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label} (grain mismatch: this "${kind}" relation never targets a ${classDisplayName(entityType)})`
          };
        }
      }
      const edges2 = fwdKinds.flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === objMatch.id);
      const targets = edges2.map((e) => graph.byId.get(e.object)).filter(Boolean);
      const deduped = uniqueById(targets);
      let matches2 = deduped;
      let filterNote = "";
      if (entityType && entityType !== "Change") {
        matches2 = deduped.filter((m) => m.class === entityType);
        const siblingClass = FINE_CLASS_SIBLING[entityType];
        if (!matches2.length && siblingClass) {
          const widened = deduped.filter((m) => m.class === siblingClass);
          if (widened.length) {
            matches2 = widened;
            filterNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
          }
        }
      }
      return { matches: matches2, objMatch, candidates, traversal: `${fwdKinds.join("+")} edges where subject = ${objMatch.label}${filterNote}`, ambiguous, matchedVia };
    }
    if (parsed.modifier === "transitive") {
      const levels = impactClosure(graph, objMatch, { maxDepth: TRANSITIVE_MAX_DEPTH });
      const matches2 = levels.flat().map((d) => graph.byId.get(d.id)).filter(Boolean);
      return {
        matches: matches2,
        objMatch,
        candidates,
        ambiguous,
        matchedVia,
        traversal: `reverse dependency closure over imports+calls edges from ${objMatch.label} (impactClosure, maxDepth=${TRANSITIVE_MAX_DEPTH})`
      };
    }
    const symbolKind = SYMBOL_GRAIN_SIBLING[kind];
    const objIsFineSymbol = !!(objMatch.class && FINE_ENTITY_TYPES.has(objMatch.class));
    if (symbolKind && (FINE_ENTITY_TYPES.has(entityType) || objIsFineSymbol)) {
      const edges2 = edgesOfKind2(graph, symbolKind).filter((e) => e.object === objMatch.id);
      const subjects2 = uniqueById(edges2.map((e) => graph.byId.get(e.subject)).filter(Boolean));
      let matches2 = !entityType || entityType === "Change" ? subjects2 : subjects2.filter((i) => i.class === entityType);
      let widenNote = "";
      const siblingClass = FINE_CLASS_SIBLING[entityType];
      if (!matches2.length && siblingClass) {
        const widened = subjects2.filter((i) => i.class === siblingClass);
        if (widened.length) {
          matches2 = widened;
          widenNote = `, widened to ${siblingClass} subjects (no ${entityType} recorded)`;
        }
      }
      const upRefineEligible = (kind === "touches" || kind === "calls") && objMatch.class === "Class" && !edgesOfKind2(graph, "contains").some((e) => e.subject === objMatch.id);
      const upRefineModule = upRefineEligible ? graph.byId.get(moduleIdOf2(graph, objMatch) || "") : null;
      if (matches2.length || !(upRefineEligible && upRefineModule)) {
        return { matches: matches2, objMatch, candidates, traversal: `${symbolKind} edges where object = ${objMatch.label}${widenNote}`, ambiguous, matchedVia };
      }
    }
    let gObjMatch = objMatch;
    let gCandidates = candidates;
    let gAmbiguous = ambiguous;
    let gMatchedVia = matchedVia;
    let grainRefinedNote = "";
    const wantClass = kindObjectClass(graph, kind);
    if (wantClass && gObjMatch.class && gObjMatch.class !== wantClass) {
      const retry = resolveObject(graph, parsed.object, { expectedClass: wantClass });
      if (retry.match && !retry.ambiguous) {
        gObjMatch = retry.match;
        gCandidates = retry.candidates;
        gAmbiguous = retry.ambiguous;
        gMatchedVia = retry.matchedVia;
      } else if (wantClass === "Module") {
        const mid = moduleIdOf2(graph, gObjMatch);
        const mod = mid && graph.byId.get(mid);
        if (mod) {
          grainRefinedNote = `, refined from ${gObjMatch.label} to its containing module`;
          gObjMatch = mod;
        } else {
          return {
            matches: [],
            objMatch: gObjMatch,
            candidates: gCandidates,
            ambiguous: gAmbiguous,
            matchedVia: gMatchedVia,
            wrongGrainMiss: true,
            wantClass,
            traversal: `"${parsed.object}" resolved to ${classDisplayName(gObjMatch.class)} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${classDisplayName(wantClass)}, and no containing module could be found to refine to)`
          };
        }
      } else {
        return {
          matches: [],
          objMatch: gObjMatch,
          candidates: gCandidates,
          ambiguous: gAmbiguous,
          matchedVia: gMatchedVia,
          wrongGrainMiss: true,
          wantClass,
          traversal: `"${parsed.object}" resolved to ${classDisplayName(gObjMatch.class)} ${gObjMatch.label} (grain mismatch: this "${kind}" question needs a ${classDisplayName(wantClass)})`
        };
      }
    }
    let edges = kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.object === gObjMatch.id);
    if (kind === "cochange") {
      edges = edges.concat(
        kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => e.subject === gObjMatch.id).map((e) => ({ ...e, subject: e.object, object: e.subject }))
      );
    }
    let extNote = "";
    if (!edges.length && gObjMatch.class) {
      const extId = `ext:${String(gObjMatch.label).toLowerCase()}`;
      edges = kindsFor(kind).flatMap((k) => edgesOfKind2(graph, k)).filter((e) => String(e.object).toLowerCase() === extId);
      if (edges.length) extNote = ` (by name, via unresolved ${extId} references)`;
    }
    const subjects = [];
    const seenSubjects = /* @__PURE__ */ new Set();
    for (const e of edges) {
      const s = graph.byId.get(e.subject);
      if (s && !seenSubjects.has(s.id)) {
        seenSubjects.add(s.id);
        subjects.push(s);
      }
    }
    let matches, grainNote = "";
    if (!entityType || entityType === "Change") {
      matches = subjects;
    } else {
      const direct = subjects.filter((s) => s.class === entityType);
      if (direct.length) {
        matches = direct;
      } else if (entityType !== "Module" && subjects.some((s) => s.class === "Module")) {
        const moduleIds = new Set(subjects.filter((s) => s.class === "Module").map((s) => s.id));
        matches = refineToEntities(graph, moduleIds, entityType);
        grainNote = `, then ${classDisplayName(entityType)} defined in the matched module(s)`;
      } else {
        matches = [];
      }
    }
    return {
      matches,
      objMatch: gObjMatch,
      candidates: gCandidates,
      traversal: `${kindsFor(kind).join("+")} edges where object = ${gObjMatch.label}${extNote}${grainNote}${grainRefinedNote}`,
      ambiguous: gAmbiguous,
      matchedVia: gMatchedVia
    };
  }
  function moduleLabelOf(ind) {
    if (ind.class === "Module") return ind.label;
    const site = (ind.attributes || []).find((a) => a.key === "site")?.value;
    if (site) return String(site).split(":")[0];
    const m = String(ind.id || "").match(/^fn:(.+)#/);
    return m ? m[1] : "(unknown module)";
  }
  function symbolLabelOf(ind) {
    const label = String(ind.label || ind.id || "");
    return ["Function", "Method"].includes(ind.class) ? `function ${label}()` : label;
  }
  function commitRefOf(ind) {
    const sha = String(ind.label || ind.id || "");
    const author = (ind.attributes || []).find((a) => a.key === "author")?.value;
    return author ? `${sha} (${author})` : sha;
  }
  function listJoin(syms) {
    return syms.length > 1 ? `${syms.slice(0, -1).join(", ")} and ${syms[syms.length - 1]}` : syms[0];
  }
  function describeParse(p) {
    const obj = p.object ?? p.subject ?? "?";
    const ent = p.entityType ? nounFor(p.entityType, 2) + " that " : "";
    return `${ent}${p.kind} "${obj}"`;
  }
  function bareVerbFor(kind) {
    return RELATIONS[kind]?.bare || kind;
  }
  function complementGloss(parsed) {
    if (!Array.isArray(parsed.atoms) || parsed.atoms.length !== 2) return null;
    const [seed, diff] = parsed.atoms;
    if (seed.op !== "seed" || seed.ast?.node !== "allOfClass" || diff.op !== "difference") return null;
    const noun = nounFor(parsed.entityType, 2);
    if (diff.kind === "qual") return `${noun} that are not ${diff.filters.join(" and not ")}`;
    if (diff.kind !== "set" || !diff.ast) return null;
    if (diff.ast.node === "existsEdge") return `${noun} that do not ${bareVerbFor(diff.ast.kind)} anything`;
    const leaf = diff.ast.node === "clause" ? diff.ast.clause : diff.ast;
    if (!leaf || leaf.node || !leaf.kind) return null;
    const obj = leaf.object ?? leaf.subject;
    if (obj == null) return null;
    return `${noun} that do not ${bareVerbFor(leaf.kind)} ${JSON.stringify(String(obj))}`;
  }
  function canonicalOf(parsed) {
    if (!parsed) return null;
    if (parsed.ambiguousParse) {
      return {
        english: `ambiguous: ${parsed.candidates.map(describeParse).join(" \u2014 or \u2014 ")}`,
        machine: `ambiguousParse(${parsed.candidates.map((c) => canonicalOf(c)?.machine).join(", ")})`
      };
    }
    if (parsed.node) {
      const gloss = parsed.node === "boolean" ? complementGloss(parsed) : null;
      return {
        english: gloss || `a compositional query (${parsed.node})`,
        machine: `composite(${parsed.node})`
      };
    }
    const q = (s) => JSON.stringify(String(s ?? ""));
    const args = [];
    if (parsed.kind) args.push(parsed.kind);
    if (parsed.negated) args.push("negated");
    if (parsed.entityType) args.push(`entityType=${parsed.entityType}`);
    if (parsed.modifier && parsed.modifier !== "direct") args.push(`modifier=${parsed.modifier}`);
    if (parsed.subject != null) args.push(`subject=${q(parsed.subject)}`);
    if (parsed.object != null) args.push(q(parsed.object));
    const machine = `${parsed.shape}(${args.join(", ")})`;
    let english;
    if (parsed.shape === "ask") {
      english = `does "${parsed.subject}" ${parsed.negated ? "not " : ""}${verbFor(parsed.kind)} "${parsed.object}"?`;
    } else if (parsed.shape === "meta") {
      english = `what does "${parsed.object}" mean, in this graph's own vocabulary?`;
    } else if (parsed.shape === "mentions") {
      english = `where is "${parsed.object}" mentioned?`;
    } else if (parsed.shape === "where") {
      english = `where is "${parsed.object}" defined?`;
    } else {
      const ent = parsed.entityType ? nounFor(parsed.entityType, 2) + " that " : "";
      english = parsed.shape === "forward" ? `what "${parsed.object}" itself ${verbFor(parsed.kind)}` : `${ent}${verbFor(parsed.kind)} "${parsed.object}"`;
    }
    return { english, machine };
  }
  function render(parsed, result, graph = null) {
    const r = renderCore(parsed, result, graph);
    if (result && result.matchedVia === "fuzzy" && result.objMatch && !r.ambiguous) {
      r.content = `assuming you meant ${result.objMatch.label}: ${r.content}`;
    }
    return r;
  }
  function renderCore(parsed, result, graph) {
    if (!parsed) {
      return { content: `couldn't parse this as a graph question. Try: ${rephraseHint()}`, miss: true, ambiguous: false };
    }
    if (parsed.node) return renderComposite(parsed, result, graph);
    if (parsed.ambiguousParse) {
      if (result.branches && result.branches.length) {
        const options2 = result.branches.map((b, i) => `${i + 1}) as ${describeParse(b.parsed)}: ${b.rendered.content}`).join("\n");
        return {
          content: `this could mean more than one thing:
${options2}
(ask one of these directly, or try rephrasing more specifically, to get just that reading)`,
          miss: false,
          ambiguous: true,
          candidates: parsed.candidates.map(describeParse),
          candidateParses: parsed.candidates
        };
      }
      const options = parsed.candidates.map((p, i) => `${i + 1}) ${describeParse(p)}`).join(" or ");
      return {
        content: `this could mean more than one thing: ${options} \u2014 try rephrasing more specifically.`,
        miss: false,
        ambiguous: true,
        candidates: parsed.candidates.map(describeParse),
        candidateParses: parsed.candidates
      };
    }
    if (result.unresolvedPronoun) {
      return {
        content: `"${parsed.object ?? parsed.subject}" needs a selected node to refer to \u2014 click a node first, or name it directly.`,
        miss: true,
        ambiguous: false
      };
    }
    if (result.unsupportedModifier) {
      return {
        content: `the "${parsed.modifier}" modifier isn't supported for "${parsed.kind}" queries yet \u2014 only imports/calls (module-level) have a transitive closure today.`,
        miss: true,
        ambiguous: false
      };
    }
    if (result.wrongGrainMiss) {
      const gotNoun = result.objMatch.class ? nounFor(result.objMatch.class, 1) : "term";
      const wantNoun = nounFor(result.wantClass, 1);
      return {
        content: `"${parsed.object}" resolved to the ${gotNoun} ${result.objMatch.label}, but this question needs a ${wantNoun} \u2014 no ${wantNoun} named "${parsed.object}" was found in the index.`,
        miss: true,
        ambiguous: false
      };
    }
    if (result.forwardGrainMiss) {
      const wantNouns = result.wantClasses.map((c) => nounFor(c, 2));
      return {
        content: `${result.objMatch.label}'s "${verbFor(parsed.kind)}" relation in this index never produces ${nounFor(parsed.entityType, 2)} \u2014 only ${listJoin(wantNouns)}.`,
        miss: true,
        ambiguous: false
      };
    }
    if (parsed.shape === "meta") {
      if (!result.objMatch) {
        return {
          content: `"${parsed.object}" isn't a term in this graph's own vocabulary (no matching class or predicate).`,
          miss: true,
          ambiguous: false
        };
      }
      if (result.metaCodeClass) {
        return { content: result.metaFallbackText, miss: false, ambiguous: false, matches: result.matches };
      }
      const doc = (result.objMatch.attributes || []).find((a) => a.key === "doc")?.value || "";
      const kindWord = result.objMatch.class === "SchemaClass" ? "a class in the graph's schema" : "a predicate (relation) in the graph's schema";
      return { content: `${result.objMatch.label} is ${kindWord}: ${doc}`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (result.mentionsShape) {
      if (!result.matches.length) {
        return {
          content: `"${parsed.object}" is not mentioned in any indexed identifier or doc-comment prose.`,
          miss: true,
          ambiguous: false
        };
      }
      const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => `${m.label} (${nounFor(m.class, 1)})`);
      const extra2 = result.matches.length > OVERFLOW_CAP ? `, \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
      return {
        content: `"${parsed.object}" is mentioned in the prose tokens of ${listJoin(shown)}${extra2}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.entryPointShape) {
      if (!result.matches.length) {
        return {
          content: `no entry-point module found in the index \u2014 no module basename matches ${listJoin([...ENTRY_POINT_BASENAMES])}.`,
          miss: true,
          ambiguous: false,
          candidates: []
        };
      }
      const [top, ...rest] = result.matches;
      const shownRest = rest.slice(0, OVERFLOW_CAP).map((i) => i.label);
      const extra2 = rest.length > OVERFLOW_CAP ? `, \u2026and ${rest.length - OVERFLOW_CAP} more` : "";
      const also = rest.length ? ` \u2014 also matched: ${listJoin(shownRest)}${extra2}` : "";
      return {
        content: `ranked ${result.matches.length} entry-point match${result.matches.length === 1 ? "" : "es"}; top: ${top.label}${also}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (!result.objMatch && (!result.candidates || result.candidates.length === 0) && parsed.shape !== "ask") {
      const objText = String(parsed.object || "").trim();
      const fallback = parsed.entityType && PLURAL_FORMS[parsed.entityType] ? nounFor(parsed.entityType, 1) : "module";
      const what = /^(?:commit[:\s])?[0-9a-f]{7,40}$/i.test(objText) ? "commit" : !objText.includes("/") && /^[\w$]+(\.[\w$]+)+$/.test(objText) ? "symbol" : fallback;
      if (result.unplacedWords?.length) {
        const quoted = listJoin(result.unplacedWords.map((w) => `"${w}"`));
        const was = result.unplacedWords.length === 1 ? "names" : "name";
        const near = result.nearestLabel ? ` Did you mean ${result.nearestLabel}?` : "";
        return {
          content: `no ${what} matching "${parsed.object}" found in the index. ${quoted} ${was} nothing here, and reading past ${result.unplacedWords.length === 1 ? "it" : "them"} would answer a different question.${near}`,
          miss: true,
          ambiguous: false,
          candidates: []
        };
      }
      return {
        content: `no ${what} matching "${parsed.object}" found in the index. ${touchesRephraseHint(graph)}`,
        miss: true,
        ambiguous: false,
        candidates: []
      };
    }
    if (result.ambiguous) {
      const pool = [result.objMatch, ...result.candidates || []].filter(Boolean);
      const noun = pool.length && pool.every((i) => i.class === "Commit") ? "commit" : "module";
      const shown = pool.slice(0, OVERFLOW_CAP).map((i) => i.label);
      const extra2 = pool.length > OVERFLOW_CAP ? `, \u2026and ${pool.length - OVERFLOW_CAP} more` : "";
      const lead = `"${parsed.object}" matches more than one ${noun} ambiguously \u2014 did you mean ${listJoin(shown)}${extra2}? Try one of those. If you're not sure, narrow it to one name.`;
      const content = result.branches && result.branches.length ? `${lead}
${result.branches.map((b, i) => `${i + 1}) ${b.candidate.label}: ${b.rendered.content}`).join("\n")}` : lead;
      return {
        content,
        miss: false,
        ambiguous: true,
        candidates: pool.map((i) => i.label)
      };
    }
    if (result.whereShape) {
      const ind = result.objMatch;
      if (ind.class === "Module") {
        return { content: `${ind.label} is a module \u2014 the label is its repo path.`, miss: false, ambiguous: false, matches: result.matches };
      }
      if (ind.class === "Commit") {
        return { content: `${ind.label} is a commit, not a code location \u2014 try "what did commit ${ind.label} touch".`, miss: true, ambiguous: false };
      }
      const m = String(result.site || "").match(/^(.*):(\d+)(?:-(\d+))?$/);
      if (m) {
        const lines = m[3] && m[3] !== m[2] ? `lines ${m[2]}-${m[3]}` : `line ${m[2]}`;
        return { content: `${symbolLabelOf(ind)} is defined in ${m[1]} at ${lines}.`, miss: false, ambiguous: false, matches: result.matches };
      }
      return {
        content: `${symbolLabelOf(ind)} is defined in ${moduleLabelOf(ind)} (no line span recorded in this index).`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.whenShape) {
      const subject = result.objMatch.label;
      if (!result.matches.length) {
        return { content: `no recorded commit touches ${subject} in this index. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false };
      }
      const newest = result.matches[0];
      const date = (newest.attributes || []).find((a) => a.key === "date")?.value || "";
      if (!date) {
        return {
          content: `commit ${newest.label} touched ${subject}, but this index records no commit dates \u2014 regenerate the graph to attach mgx:commitDate.`,
          miss: true,
          ambiguous: false
        };
      }
      const msg = (newest.attributes || []).find((a) => a.key === "message")?.value || "";
      const day = String(date).slice(0, 10);
      if (newest.id === result.objMatch.id) {
        return { content: `commit ${newest.label} ${pickPhrase("is-dated", newest.id, "is dated")} ${day}${msg ? ` ("${msg}")` : ""}.`, miss: false, ambiguous: false, matches: result.matches };
      }
      const more = result.matches.length - 1;
      return {
        content: `${subject} was last touched by commit ${newest.label} on ${day}${msg ? ` ("${msg}")` : ""}${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.whoLastShape) {
      const subject = result.objMatch.label;
      if (!result.matches.length) {
        return { content: `no recorded commit touches ${subject} in this index. ${touchesRephraseHint(graph)}`, miss: true, ambiguous: false };
      }
      const newest = result.matches[0];
      const author = (newest.attributes || []).find((a) => a.key === "author")?.value;
      if (!author) {
        return {
          content: `commit ${newest.label} last touched ${subject}, but this index records no commit author \u2014 regenerate the graph to attach mgx:commitAuthor.`,
          miss: true,
          ambiguous: false
        };
      }
      const more = result.matches.length - 1;
      return {
        content: `${subject} was last touched by ${author} (commit ${newest.label})${more ? `; ${more} earlier commit${more === 1 ? "" : "s"} recorded` : ""}.`,
        miss: false,
        ambiguous: false,
        matches: result.matches
      };
    }
    if (result.commitSubject) {
      const cite = `commit ${result.objMatch.label}`;
      if (!result.matches.length) {
        return {
          content: `${cite} touched nothing recorded in the index.`,
          miss: true,
          ambiguous: false
        };
      }
      const byClass = /* @__PURE__ */ new Map();
      for (const m of result.matches.slice(0, OVERFLOW_CAP)) {
        const cls = m.class || "Module";
        if (!byClass.has(cls)) byClass.set(cls, []);
        byClass.get(cls).push(["Function", "Method"].includes(cls) ? `${m.label}()` : m.label);
      }
      const clauses2 = [...byClass.entries()].map(([cls, labels]) => `${nounFor(cls, labels.length)} ${listJoin(labels)}`);
      const extra2 = result.matches.length > OVERFLOW_CAP ? `; \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
      return { content: `${cite} touched ${clauses2.join("; ")}${extra2}.`, miss: false, ambiguous: false, matches: result.matches };
    }
    if (parsed.shape === "ask") {
      if (!result.objMatch || !result.subjMatch) {
        return { content: `couldn't resolve one of the terms in this question.`, miss: true, ambiguous: false };
      }
      const edgeFound = `${result.traversal}.`;
      const noEdge = `no ${parsed.kind} edge found from ${result.subjMatch.label} to ${result.objMatch.label}.`;
      const holds = parsed.negated ? noEdge : edgeFound;
      const fails = parsed.negated ? edgeFound : noEdge;
      return {
        content: `${result.answer ? "Yes" : "No"} \u2014 ${result.answer ? holds : fails}`,
        // A miss is the absence of a citation, which the polarity never changes:
        // "no edge found" cites nothing whether it arrives as a Yes or a No.
        miss: !result.matches.length,
        ambiguous: false
      };
    }
    if (!result.matches.length) {
      if (parsed.shape === "forward") {
        return {
          content: `${result.objMatch.label} has no ${verbFor(parsed.kind)} edges in the index.`,
          miss: true,
          ambiguous: false
        };
      }
      if (parsed.kind === "tests" && !parsed.entityType) {
        const stripped = String(parsed.object || "").replace(LEADING_RELATION_VERB_RE, "").trim();
        const obj = stripped || String(parsed.object || "").trim();
        return {
          content: `No tests cover ${obj}.`,
          miss: true,
          ambiguous: false
        };
      }
      const entityWord = nounFor(parsed.entityType || "Module", 2);
      return {
        content: `No ${entityWord} found whose module directly ${verbFor(parsed.kind)} ${parsed.object}. ${touchesRephraseHint(graph)}`,
        miss: true,
        ambiguous: false
      };
    }
    if (parsed.shape === "forward" || parsed.entityType === "Module" || result.matches.every((m) => !FINE_ENTITY_TYPES.has(m.class))) {
      const shown = result.matches.slice(0, OVERFLOW_CAP).map((m) => m.class === "Commit" ? commitRefOf(m) : m.label);
      const extra2 = result.matches.length > OVERFLOW_CAP ? `, \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
      return { content: shown.join(" and ") + extra2 + ".", miss: false, ambiguous: false, matches: result.matches };
    }
    const byModule = /* @__PURE__ */ new Map();
    for (const m of result.matches.slice(0, OVERFLOW_CAP)) {
      const mod = moduleLabelOf(m);
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod).push(symbolLabelOf(m));
    }
    const clauses = [...byModule.entries()].map(([mod, syms], i) => {
      const list = listJoin(syms);
      return i === 0 ? `in ${mod} there is ${list}` : `there is ${list} in ${mod}`;
    });
    const extra = result.matches.length > OVERFLOW_CAP ? ` \u2026and ${result.matches.length - OVERFLOW_CAP} more` : "";
    return { content: clauses.join(" and ") + extra + ".", miss: false, ambiguous: false, matches: result.matches };
  }
  function fuzzyCascadeWord(w) {
    if (w.length < 4) return null;
    const bound = fuzzyBound(w);
    let best = bound + 1;
    let hit2 = null;
    let tied = false;
    for (const target of CASCADE_FUZZY_TARGETS) {
      const d = editDistance(w, target, Math.min(best, bound));
      if (d < best) {
        best = d;
        hit2 = target;
        tied = false;
      } else if (d === best && d <= bound && target !== hit2) tied = true;
    }
    return best <= bound && !tied ? hit2 : null;
  }
  function schemaTypoTrap(resolution, term) {
    if (!resolution?.match || resolution.matchedVia !== "fuzzy" || resolution.ambiguous) return false;
    const cls = resolution.match.class;
    if (cls !== "SchemaClass" && cls !== "SchemaPredicate") return false;
    const lc = String(term || "").trim().toLowerCase();
    const kindNoun = fuzzyCascadeWord(lc);
    return !!kindNoun && kindNoun !== lc && !!ENTITY_TO_TYPE[kindNoun];
  }
  function answerable(graph, parsed, contextId) {
    if (!parsed) return false;
    if (parsed.ambiguousParse) return "ambiguous";
    if (parsed.node) return parsed.node !== "miss";
    if (parsed.shape === "meta" || parsed.shape === "mentions") return true;
    const o = resolveTermOrContext(graph, parsed.object, contextId);
    if (o.unresolvedPronoun) return "pronoun";
    if (!o.match || schemaTypoTrap(o, parsed.object)) return false;
    if (parsed.shape === "ask") {
      const s = resolveTermOrContext(graph, parsed.subject, contextId);
      if (s.unresolvedPronoun) return "pronoun";
      return s.match && !schemaTypoTrap(s, parsed.subject) ? true : false;
    }
    return true;
  }
  function isHelpRequest(query) {
    const q = String(query || "").trim().toLowerCase().replace(/[?.!\s]+$/, "");
    return HELP_TRIGGERS.includes(q);
  }
  function relaxParse(graph, query, { nlp = void 0, contextId = null, prev = null } = {}) {
    const from = applyNegationFrames(normalizeQuery(String(query || "")));
    let tokens = splitWords(from);
    if (!tokens.length) return null;
    const dropped = [];
    const steps = [];
    const resolvesExact = (t) => {
      const r = resolveObject(graph, t);
      return !!r.match && r.tier != null && r.tier <= 2;
    };
    const resolvesLiteral = (t) => {
      const r = resolveObject(graph, t);
      return !!r.match && r.tier != null && r.tier <= 3;
    };
    const hasRealTerm = (s) => {
      const whole = String(s || "").trim().toLowerCase();
      if (CONTEXT_PRONOUNS.includes(whole)) return true;
      return splitWords(whole).some((w) => {
        const lc = w.toLowerCase();
        return !CONTENT_VOCAB.has(lc) && !STRUCTURAL_WORDS.has(lc);
      });
    };
    const TERM_SHAPES = /* @__PURE__ */ new Set(["reverse", "forward", "where", "when", "ask"]);
    const attempt = (toks) => {
      const text = toks.join(" ");
      const p = parseQuery(text, { nlp });
      if (answerable(graph, p, contextId) !== true) return null;
      if (p && !p.node && TERM_SHAPES.has(p.shape)) {
        if (p.object != null && !hasRealTerm(p.object)) return null;
        if (p.shape === "ask" && p.subject != null && !hasRealTerm(p.subject)) return null;
      }
      const rendered = render(p, traverse(graph, p, { contextId, prev }), graph);
      return rendered.miss ? null : { parsed: p, text };
    };
    const done = (hit2) => ({ parsed: hit2.parsed, from, to: hit2.text, dropped: [...dropped], steps });
    let guard = 0;
    const hardCap = Math.max(tokens.length, 1) + 12;
    for (; guard < hardCap; guard += 1) {
      let idx = -1;
      for (let i = 0; i < tokens.length; i += 1) {
        const lc = tokens[i].toLowerCase();
        if (CASCADE_NOISE_SET.has(lc) && !CONTENT_VOCAB.has(lc) && !resolvesExact(tokens[i])) {
          idx = i;
          break;
        }
      }
      if (idx < 0) break;
      const removed = tokens[idx];
      tokens = tokens.filter((_, i) => i !== idx);
      dropped.push(removed);
      steps.push(`strip noise "${removed}" \u2192 "${tokens.join(" ")}"`);
      const hit2 = attempt(tokens);
      if (hit2) return done(hit2);
    }
    const termParse = parseQuery(tokens.join(" "), { nlp });
    const termWords = /* @__PURE__ */ new Set();
    if (termParse && !termParse.node && TERM_SHAPES.has(termParse.shape)) {
      for (const part of [termParse.object, termParse.subject]) {
        for (const w of splitWords(String(part || "").toLowerCase())) termWords.add(w);
      }
    }
    const survivors = [];
    const nowDropped = [];
    const corrected = [];
    for (const t of tokens) {
      const lc = t.toLowerCase();
      const plain = /^[a-z]+$/.test(lc);
      if (!plain || termWords.has(lc) || CONTENT_VOCAB.has(lc) || STRUCTURAL_WORDS.has(lc) || resolvesLiteral(t)) {
        survivors.push(t);
        continue;
      }
      const fix = fuzzyCascadeWord(lc);
      if (fix && fix !== lc) {
        survivors.push(fix);
        corrected.push(`${t}\u2192${fix}`);
        continue;
      }
      nowDropped.push(t);
    }
    if ((corrected.length || nowDropped.length) && survivors.length) {
      tokens = survivors;
      dropped.push(...nowDropped);
      if (corrected.length) steps.push(`fuzzy-correct ${JSON.stringify(corrected)} \u2192 "${tokens.join(" ")}"`);
      if (nowDropped.length) steps.push(`drop unmatched ${JSON.stringify(nowDropped)} \u2192 "${tokens.join(" ")}"`);
      const hit2 = attempt(tokens);
      if (hit2) return done(hit2);
    }
    let changed = false;
    const normed = tokens.map((t) => {
      const lc = t.toLowerCase();
      if (CASCADE_SYNONYMS[lc] && !resolvesLiteral(t)) {
        changed = true;
        return CASCADE_SYNONYMS[lc];
      }
      return t;
    });
    if (changed) {
      steps.push(`normalise synonyms \u2192 "${normed.join(" ")}"`);
      const hit2 = attempt(normed);
      if (hit2) return done(hit2);
    }
    const bareLc = splitWords(from).map((t) => t.toLowerCase());
    const kindWords = [];
    const others = [];
    for (const t of bareLc) {
      if (NOISE_OR_SCAFFOLD.has(t)) continue;
      const et = ENTITY_TO_TYPE[t];
      if (et && et !== "Change") kindWords.push(t);
      else others.push(t);
    }
    if (kindWords.length === 1 && others.length === 0) {
      const hit2 = attempt(["count", kindWords[0]]);
      if (hit2) {
        steps.push(`bare kind "${kindWords[0]}" \u2192 count`);
        return done(hit2);
      }
    }
    return null;
  }
  function substituteLastCommitPhrase(graph, query) {
    const q = String(query || "");
    if (!graph || !LAST_COMMIT_PHRASE_RE.test(q)) return q;
    const commits = graph.individuals.filter((i) => i.class === "Commit");
    if (!commits.length) return q;
    const dateOf = (c) => String((c.attributes || []).find((a) => a.key === "date")?.value || "");
    const newest = [...commits].sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0];
    if (!newest) return q;
    const out = q.replace(LAST_COMMIT_PHRASE_RE, `commit ${newest.label}`);
    const bareTrimmed = out.trim().replace(/[?.!]+$/, "");
    return BARE_WHEN_COMMIT_RE.test(bareTrimmed) ? `${bareTrimmed} touched` : out;
  }
  function singularCandidates(word) {
    const w = String(word || "").toLowerCase();
    const c = /* @__PURE__ */ new Set([w]);
    if (w.endsWith("ies")) c.add(`${w.slice(0, -3)}y`);
    if (w.endsWith("ses")) c.add(w.slice(0, -2));
    else if (w.endsWith("es")) c.add(w.slice(0, -2));
    if (w.endsWith("s") && w.length > 1) c.add(w.slice(0, -1));
    return [...c];
  }
  function resolveDynamicClass(graph, word) {
    const cands = singularCandidates(word);
    for (const ind of graph?.individuals || []) {
      if (ind?.class && cands.includes(String(ind.class).toLowerCase())) return ind.class;
    }
    return null;
  }
  function dynamicClassQuery(graph, query) {
    const q = String(query || "").trim();
    const listM = q.match(DYNAMIC_LIST_TRIGGER_RE);
    const countM = !listM ? q.match(DYNAMIC_COUNT_TRIGGER_RE) : null;
    const m = listM || countM;
    if (!m || !DYNAMIC_TAIL_OK_RE.test(m[2] || "")) return null;
    if (ENTITY_TO_TYPE[m[1].toLowerCase()]) return null;
    const entityType = resolveDynamicClass(graph, m[1]);
    if (!entityType) return null;
    const base = { node: "allOfClass", entityType };
    return listM ? { node: "list", entityType, base, scoped: false } : { node: "count", entityType, base };
  }
  function ask(graph, query, { contextId = null, nlp = void 0, prev = null } = {}) {
    if (isHelpRequest(query)) {
      return {
        content: rephraseHint(),
        tmct_ask: {
          mechanical: true,
          parsed: null,
          canonical: null,
          matches: [],
          traversal: null,
          miss: true,
          ambiguous: false,
          matchedVia: null,
          help: true,
          relaxed: null
        }
      };
    }
    query = substituteLastCommitPhrase(graph, query);
    const directFull = parseQueryFull(query, { nlp });
    const direct = directFull.parsed;
    let parsed = direct;
    let relaxed = null;
    if (answerable(graph, direct, contextId) === false) {
      const r = relaxParse(graph, query, { nlp, contextId, prev });
      if (r) {
        parsed = r.parsed;
        relaxed = { from: r.from, to: r.to, dropped: r.dropped, steps: r.steps };
      }
    }
    let result = traverse(graph, parsed, { contextId, prev });
    let rendered = render(parsed, result, graph);
    if (rendered.miss && !rendered.ambiguous) {
      const dyn = dynamicClassQuery(graph, query);
      if (dyn) {
        const dynResult = traverse(graph, dyn, { contextId, prev });
        const dynRendered = render(dyn, dynResult, graph);
        if (!dynRendered.miss) {
          parsed = dyn;
          result = dynResult;
          rendered = dynRendered;
          relaxed = null;
        }
      }
    }
    if (parsed === null && rendered.miss && !rendered.ambiguous) {
      const bareM = expandContractions(String(query || "")).trim().match(BARE_META_WHATIS_RE);
      const bareTerm = bareM?.[1]?.trim();
      if (bareTerm && !/\s+(?:for|about)$/i.test(bareTerm)) {
        const bareParsed = parseQuery(`what is a ${bareTerm}`, { nlp });
        if (bareParsed?.shape === "meta") {
          result = traverse(graph, bareParsed, { contextId, prev });
          rendered = render(bareParsed, result, graph);
        }
      }
    }
    if (parsed === null && rendered.miss && !rendered.ambiguous) {
      const forM = normalizeQuery(String(query || "")).match(WHATIS_FOR_FALLBACK_RE);
      const forTerm = forM?.[1]?.trim();
      if (forTerm) {
        const forParsed = parseQuery(`what is a ${forTerm}`, { nlp });
        if (forParsed?.shape === "meta") {
          const forResult = traverse(graph, forParsed, { contextId, prev });
          const forRendered = render(forParsed, forResult, graph);
          if (!forRendered.miss && !forRendered.ambiguous) {
            result = forResult;
            rendered = forRendered;
          }
        }
      }
    }
    let content = relaxed && !rendered.miss && relaxed.to !== relaxed.from ? `read as "${relaxed.to}" \u2014 ${rendered.content}` : rendered.content;
    if (!relaxed && !rendered.miss && !rendered.ambiguous && directFull.alternates.length) {
      const answered = directFull.alternates.map((a) => {
        const altResult = traverse(graph, a.parsed, { contextId, prev });
        const altRendered = render(a.parsed, altResult, graph);
        return altRendered.miss ? null : { a, text: altRendered.content };
      }).filter(Boolean);
      if (answered.length) {
        const lines = alternateLines(answered.map((x) => x.a), {
          answerFor: (a) => answered.find((x) => x.a === a)?.text || null
        });
        content = `${content}
${lines.join("\n")}`;
      }
    }
    return {
      content,
      tmct_ask: {
        mechanical: true,
        parsed: parsed && !parsed.ambiguousParse ? parsed : null,
        canonical: canonicalOf(parsed),
        matches: (result.matches || []).map((m) => ({
          id: m.id,
          label: m.label,
          type: m.class,
          module: m.class ? moduleLabelOf(m) : void 0
        })),
        traversal: result.traversal || null,
        miss: !!rendered.miss,
        ambiguous: !!rendered.ambiguous,
        // null when the direct parse was used as-is; a caller can assert
        // relaxed===null to prove the cascade never touched a direct hit.
        relaxed,
        // "prose" (tier-4 prose-index fallback) or "fuzzy" (tier-5 bounded
        // edit-distance, announced in the content as "assuming you meant …");
        // null for every literal-identifier tier.
        matchedVia: result.matchedVia || null,
        ...rendered.ambiguous ? { candidates: rendered.candidates, candidateParses: rendered.candidateParses } : {}
      }
    };
  }
  var askEdgesOfKindCache, SYMBOL_GRAIN_SIBLING, FINE_ENTITY_TYPES, FINE_CLASS_SIBLING, KIND_UNIONS, kindsFor, OVERFLOW_CAP, PLURAL_FORMS, REVERSE_MISS_VERB, LEADING_RELATION_VERB_RE, FROZEN_META_AMBIGUOUS_TERMS, MAX_COMPOSE_DEPTH, NEST_SENTINEL, PRED_LEAD_SKIP, FRAME_WORDS, COPULA_WORDS, entityNoun, isGerundVerb, FWD_NEG_FRAME, PLURAL_ANAPHORA_OBJECT, TEMPORAL_AUX, TEMPORAL_TAIL, TEMPORAL_TRAIL_FILLER, TEMPORAL_DET, COMMIT_FILTER_OPS, ANAPHORA_NAME_TOKEN_RE, AGG_TAIL_FILLER, LIST_SKIP, LIST_TRIGGERS_SORTED, LISTABLE_KINDS, SCOPE_PREPOSITIONS, FIND_LINKERS, RECENT_COMMIT_LEAD, qualCache, META_FALLBACK_CLASSES, inheritsApplicableCache, FIND_TIER, DEGREE_KINDS, COMMIT_FILTER_DATE_RE, compositeList, LEADING_ARTICLE_RE, TRAILING_GRAIN_WORD_RE, ENTRY_POINT_QUERY_RE, ENTRY_POINT_BASENAMES, TEST_FIXTURE_PATH_SEGMENTS, moduleStemOf, isTestFixturePath, TRANSITIVE_MAX_DEPTH, CONTENT_VOCAB, STRUCTURAL_WORDS, CASCADE_NOISE_SET, NOISE_OR_SCAFFOLD, TRIGGER_FUZZY_WORDS, CASCADE_FUZZY_TARGETS, LAST_COMMIT_PHRASE_RE, BARE_WHEN_COMMIT_RE, DYNAMIC_LIST_TRIGGER_RE, DYNAMIC_COUNT_TRIGGER_RE, DYNAMIC_TAIL_OK_RE, BARE_META_WHATIS_RE, WHATIS_FOR_FALLBACK_RE;
  var init_ask = __esm({
    "src/domain/ask.mjs"() {
      init_codegraph();
      init_ask_vocab();
      init_normalize();
      init_fuzzy();
      init_grammar();
      init_keywords();
      init_pipeline();
      init_merge();
      init_prose();
      init_answer_variants();
      init_nlp_registry();
      askEdgesOfKindCache = /* @__PURE__ */ new WeakMap();
      SYMBOL_GRAIN_SIBLING = { calls: "callsSymbol", touches: "touchesSymbol" };
      FINE_ENTITY_TYPES = /* @__PURE__ */ new Set(["Function", "Method", "Class", "Attribute", "GlobalVariable"]);
      FINE_CLASS_SIBLING = { Function: "Method", Method: "Function" };
      KIND_UNIONS = { uses: ["imports", "calls", "callsSymbol"] };
      kindsFor = (kind) => KIND_UNIONS[kind] || [kind];
      OVERFLOW_CAP = 12;
      PLURAL_FORMS = {
        Function: ["function", "functions"],
        Method: ["method", "methods"],
        Class: ["class", "classes"],
        Module: ["module", "modules"],
        Attribute: ["attribute", "attributes"],
        GlobalVariable: ["variable", "variables"],
        Commit: ["commit", "commits"],
        Change: ["change", "changes"],
        Fact: ["fact", "facts"],
        Utterance: ["utterance", "utterances"],
        Session: ["session", "sessions"],
        Source: ["source", "sources"],
        Rule: ["rule", "rules"]
      };
      REVERSE_MISS_VERB = { cochange: "cochanges", reexports: "export" };
      LEADING_RELATION_VERB_RE = new RegExp(
        `^(?:${Object.keys(VERB_TO_KIND).sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:s|ing|ed)?\\s+`,
        "i"
      );
      FROZEN_META_AMBIGUOUS_TERMS = /* @__PURE__ */ new Set(["imports"]);
      MAX_COMPOSE_DEPTH = 4;
      NEST_SENTINEL = "zzinnerset";
      PRED_LEAD_SKIP = /* @__PURE__ */ new Set(["that", "which", "who", "are", "is", "was", "were", "do", "does", "also", "still", "both", "and", "then", "though"]);
      FRAME_WORDS = /* @__PURE__ */ new Set(["which", "what", "who", "list", "show", "find", "give", "me", "us", "all"]);
      COPULA_WORDS = /* @__PURE__ */ new Set(["are", "is", "was", "were"]);
      entityNoun = (w) => ENTITY_TO_TYPE[w] ? { entityType: ENTITY_TO_TYPE[w], placeholder: false } : PLACEHOLDER_NOUNS.includes(w) ? { entityType: null, placeholder: true } : null;
      isGerundVerb = (w) => !!VERB_TO_KIND[w] && w.endsWith("ing");
      FWD_NEG_FRAME = /* @__PURE__ */ new Set(["what", "which", "thing", "things", "one", "ones", "stuff"]);
      PLURAL_ANAPHORA_OBJECT = /* @__PURE__ */ new Set(["those", "them"]);
      TEMPORAL_AUX = /* @__PURE__ */ new Set(["did", "was", "were", "do", "does", "has", "have", "had"]);
      TEMPORAL_TAIL = /* @__PURE__ */ new Set([
        "change",
        "changed",
        "changes",
        "update",
        "updated",
        "updates",
        "modify",
        "modified",
        "modifies",
        "touch",
        "touched",
        "touches",
        "edit",
        "edited",
        "revise",
        "revised"
      ]);
      TEMPORAL_TRAIL_FILLER = /* @__PURE__ */ new Set(["last", "recently", "ever", "get", "got", "been", "then", "now", "already"]);
      TEMPORAL_DET = /* @__PURE__ */ new Set(["the", "a", "an", "all", "those", "these", "any"]);
      COMMIT_FILTER_OPS = /* @__PURE__ */ new Set(["since", "before", "after", "on"]);
      ANAPHORA_NAME_TOKEN_RE = /\b[\w-]+(?:[/.][\w-]+)+\b|\b[A-Z][A-Za-z0-9_]*\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/;
      AGG_TAIL_FILLER = /* @__PURE__ */ new Set([
        "total",
        "altogether",
        "overall",
        "exist",
        "exists",
        "existing",
        "present",
        "here",
        "now",
        "currently",
        "graph",
        "index",
        "codebase",
        "repo",
        "repository",
        "this",
        "that"
      ]);
      LIST_SKIP = /* @__PURE__ */ new Set(["the", "a", "an", "all", "me", "us"]);
      LIST_TRIGGERS_SORTED = [...LIST_TRIGGERS].sort((a, b) => b.split(" ").length - a.split(" ").length);
      LISTABLE_KINDS = "functions, classes, methods, modules, attributes, variables, or commits";
      SCOPE_PREPOSITIONS = /* @__PURE__ */ new Set(["in", "inside", "under"]);
      FIND_LINKERS = /* @__PURE__ */ new Set(["called", "named", "about", "like", "containing", "matching", "with"]);
      RECENT_COMMIT_LEAD = /* @__PURE__ */ new Set(["recent", "latest", "newest"]);
      qualCache = /* @__PURE__ */ new WeakMap();
      META_FALLBACK_CLASSES = /* @__PURE__ */ new Set(["Class", "Function", "Method", "GlobalVariable", "Attribute", "Module"]);
      inheritsApplicableCache = /* @__PURE__ */ new WeakMap();
      FIND_TIER = { label: 3, chain: 2, attr: 1 };
      DEGREE_KINDS = ["imports", "calls", "callsSymbol", "inherits", "contains", "tests"];
      COMMIT_FILTER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      compositeList = (matches) => listJoin(matches.slice(0, OVERFLOW_CAP).map((m) => ["Function", "Method"].includes(m.class) ? `${m.label}()` : m.label)) + (matches.length > OVERFLOW_CAP ? `, \u2026and ${matches.length - OVERFLOW_CAP} more` : "");
      LEADING_ARTICLE_RE = /^(?:the|a|an)\s+/i;
      TRAILING_GRAIN_WORD_RE = new RegExp(`\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`, "i");
      ENTRY_POINT_QUERY_RE = /^(?:the\s+)?(?:main\s+|primary\s+)?entry[\s-]?points?(?:\s+(?:of|to|for)\s+(?:this|the)\s+(?:codebase|code|repo|repository|project|app))?$/i;
      ENTRY_POINT_BASENAMES = /* @__PURE__ */ new Set(["index", "main", "app", "server", "cli", "__main__"]);
      TEST_FIXTURE_PATH_SEGMENTS = /* @__PURE__ */ new Set(["test", "tests", "__tests__", "fixture", "fixtures", "spec", "specs", "testdata"]);
      moduleStemOf = (label) => String(label).toLowerCase().split("/").pop().replace(/\.[a-z0-9]+$/, "");
      isTestFixturePath = (label) => String(label).toLowerCase().split("/").slice(0, -1).some((seg) => TEST_FIXTURE_PATH_SEGMENTS.has(seg));
      TRANSITIVE_MAX_DEPTH = 8;
      CONTENT_VOCAB = /* @__PURE__ */ new Set([
        ...wordsOf(Object.keys(VERB_TO_KIND)),
        ...wordsOf(Object.keys(ENTITY_TO_TYPE)),
        ...wordsOf(Object.keys(MODIFIER_TO_KIND)),
        ...wordsOf(Object.keys(QUALIFIERS)),
        ...wordsOf(AGGREGATE_TRIGGERS),
        ...wordsOf(Object.keys(SUPERLATIVE_EXTREMES)),
        ...wordsOf(Object.keys(EDGE_NOUN_TO_METRIC)),
        ...wordsOf(Object.keys(BOOLEAN_CONNECTIVES)),
        ...wordsOf(PLACEHOLDER_NOUNS),
        ...wordsOf(ANAPHORA_TRIGGERS),
        ...wordsOf(META_MEANING_VERBS),
        ...wordsOf(WHERE_MARKERS),
        ...wordsOf(MENTION_MARKERS),
        ...wordsOf(RELATIVE_PRONOUNS),
        ...wordsOf(Object.keys(CASCADE_SYNONYMS))
      ]);
      STRUCTURAL_WORDS = /* @__PURE__ */ new Set([...STOPWORDS2, ...FRAME_WORDS, ...CONTEXT_PRONOUNS]);
      CASCADE_NOISE_SET = new Set(wordsOf(CASCADE_NOISE));
      NOISE_OR_SCAFFOLD = /* @__PURE__ */ new Set([...CASCADE_NOISE_SET, ...STRUCTURAL_WORDS]);
      TRIGGER_FUZZY_WORDS = [
        "many",
        "count",
        "number",
        "quantity",
        "total",
        "tally",
        "list",
        "show",
        "display",
        "print",
        "dump",
        "enumerate",
        "name"
      ];
      CASCADE_FUZZY_TARGETS = [.../* @__PURE__ */ new Set([
        ...wordsOf(Object.keys(VERB_TO_KIND)),
        ...Object.keys(ENTITY_TO_TYPE),
        ...TRIGGER_FUZZY_WORDS
      ])].filter((wd) => /^[a-z]+$/.test(wd) && wd.length >= 4 && !STOPWORDS2.has(wd));
      LAST_COMMIT_PHRASE_RE = /\b(?:the\s+)?(?:last|latest|most\s+recent)\s+commit\b/i;
      BARE_WHEN_COMMIT_RE = /^when\s+(?:was|were|is|did|does|do)\s+commit\s+[0-9a-fA-F:]+$/i;
      DYNAMIC_LIST_TRIGGER_RE = /^(?:list|show(?:\s+me)?)\s+(?:all\s+|the\s+)?([a-z][a-z'-]*)\s*(.*)$/i;
      DYNAMIC_COUNT_TRIGGER_RE = /^(?:how\s+many|number\s+of|count(?:\s+the)?)\s+([a-z][a-z'-]*)\s*(.*)$/i;
      DYNAMIC_TAIL_OK_RE = /^(?:are there(?:\s+in\s+total)?|is there|do you know(?:\s+about)?|do you have|exist(?:s)?|are known|in (?:the |a )?(?:graph|memory)|you know(?:\s+about)?)?[?.!\s]*$/i;
      BARE_META_WHATIS_RE = /^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
      WHATIS_FOR_FALLBACK_RE = /^what\s+is\s+(?:the\s+)?(?!(?:an?|it|this|that|these|those)\s)(.+?)\s+(?:used\s+)?for[?.!\s]*$/i;
    }
  });

  // src/adapters/source-slice.mjs
  function sliceSpan(lines, start, end, maxLines) {
    const s = Math.max(1, start);
    let e = Math.min(lines.length, end);
    let truncated = false;
    if (maxLines != null && e - s + 1 > maxLines) {
      e = s + maxLines - 1;
      truncated = true;
    }
    const text = lines.slice(s - 1, e).map((l, i) => `${s + i}	${l}`).join("\n");
    return { start: s, end: e, text, truncated };
  }
  async function readSpanSafe({ readFile: readFile12, repoRoot, path, start, end, maxLines }) {
    const root = resolve(repoRoot);
    const resolved = resolve(root, path);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new ToolError(`refusing to read outside the repository root: ${path}`);
    }
    const text = await readFile12(resolved, "utf8");
    const lines = text.split("\n");
    if (start == null || end == null) return { lines };
    return { lines, ...sliceSpan(lines, start, end, maxLines) };
  }
  var init_source_slice = __esm({
    "src/adapters/source-slice.mjs"() {
      init_node_path();
      init_config();
    }
  });

  // src/adapters/repository-interface.mjs
  function hit(value) {
    return { ok: true, value };
  }
  function miss(reason, { detail = "", term = null } = {}) {
    if (!MISS_REASONS[reason]) {
      throw new TypeError(`miss(): unknown reason "${reason}" (not in MISS_REASONS)`);
    }
    return { ok: false, miss: { reason, detail, term } };
  }
  function toIndividual(ind) {
    if (!ind || !ind.id) return null;
    return {
      id: String(ind.id),
      label: ind.label != null ? String(ind.label) : String(ind.id),
      class: ind.class || "Entity",
      attributes: (Array.isArray(ind.attributes) ? ind.attributes : []).map((a) => ({
        key: a.key,
        value: a.value,
        prop: a.prop || null
      }))
    };
  }
  function toEdge(rawEdge, { predicate = "", prop = null } = {}) {
    const e = {
      subject: rawEdge.subject,
      object: rawEdge.object,
      predicate,
      prop: prop || null
    };
    if (rawEdge.subjectLabel != null) e.subjectLabel = rawEdge.subjectLabel;
    if (rawEdge.objectLabel != null) e.objectLabel = rawEdge.objectLabel;
    if (rawEdge.weight != null) e.weight = rawEdge.weight;
    return e;
  }
  var INTERFACE_VERSION, ONTOLOGY_IRI, MISS_REASONS, EDGE_KINDS, EDGE_KIND_TO_TMCT, SERVICE_GROUPS, SERVICES, SOURCE_SERVICES, IND, EDGE, CONCURRENT_SAFE, REPOSITORY_INTERFACE;
  var init_repository_interface = __esm({
    "src/adapters/repository-interface.mjs"() {
      INTERFACE_VERSION = "1.1.0";
      ONTOLOGY_IRI = "urn:tmct:core";
      MISS_REASONS = Object.freeze({
        UNRESOLVED_TERM: "UNRESOLVED_TERM",
        CAPABILITY_ABSENT: "CAPABILITY_ABSENT",
        TRUNCATED_GRAPH: "TRUNCATED_GRAPH",
        NO_SOURCE: "NO_SOURCE"
      });
      EDGE_KINDS = Object.freeze([
        "imports",
        "calls",
        "callsSymbol",
        "defines",
        "tests",
        "touches",
        "touchesSymbol",
        "contains",
        "inherits",
        "cochange",
        "reexports"
      ]);
      EDGE_KIND_TO_TMCT = Object.freeze({
        imports: "tmct:imports",
        calls: "tmct:calls",
        callsSymbol: "tmct:calls",
        defines: "tmct:defines",
        tests: "tmct:covers",
        touches: "tmct:touches",
        touchesSymbol: "tmct:touches",
        contains: "tmct:contains",
        inherits: "tmct:extends",
        cochange: "tmct:dependsOn",
        reexports: "tmct:exports"
      });
      SERVICE_GROUPS = Object.freeze({
        resolution: ["resolve", "describe", "members", "subclasses", "exports", "signature"],
        traversal: ["edges", "impact"],
        source: ["snippet", "context"],
        aggregate: ["architecture", "untested", "stats"],
        temporal: ["history"],
        search: ["search", "ask"]
      });
      SERVICES = Object.freeze(
        Object.values(SERVICE_GROUPS).flat()
      );
      SOURCE_SERVICES = Object.freeze(new Set(SERVICE_GROUPS.source));
      IND = "Individual";
      EDGE = "Edge";
      CONCURRENT_SAFE = "concurrent-safe: reads immutable graph truth; no shared mutable state";
      REPOSITORY_INTERFACE = Object.freeze({
        version: INTERFACE_VERSION,
        ontology: ONTOLOGY_IRI,
        missReasons: Object.values(MISS_REASONS),
        edgeKinds: [...EDGE_KINDS],
        types: {
          Individual: {
            fields: {
              id: "string (opaque provider id)",
              label: "string (human/display name)",
              class: "string \u2014 a tmct: class token (module|class|function|method|attribute|variable|commit|test|\u2026)",
              attributes: "Array<{ key: string, value: string, prop: string|null }> \u2014 prop is the SEON/mgx token grounding the value"
            }
          },
          Edge: {
            fields: {
              subject: "string (individual id)",
              object: "string (individual id)",
              predicate: "string \u2014 the relation predicate",
              prop: "string|null \u2014 the SEON/mgx property token; see edgeKinds \u2192 tmct: mapping",
              subjectLabel: "string? (additive)",
              objectLabel: "string? (additive)",
              weight: "number? (additive; e.g. cochange coupling)"
            }
          },
          Result: { shape: "{ ok: true, value: T } | { ok: false, miss: Miss }" },
          Miss: { shape: "{ reason: MISS_REASONS, detail: string, term: string|null }" }
        },
        capabilitiesModel: "A provider advertises `capabilities: string[]` (service names it implements). A service outside the set is negotiated away to miss(CAPABILITY_ABSENT) \u2014 never an error. snippet may be advertised yet answer miss(NO_SOURCE) when no working tree exists (it has nothing useful without fs); context is graph-only-capable since INTERFACE_VERSION 1.1.0 \u2014 it returns a real hit (graph-only bundle) for any resolvable symbol even with no working tree, only escalating NO_SOURCE-style behavior to richer body text when source-capable.",
        services: {
          resolve: {
            group: "resolution",
            args: { term: "string" },
            result: `{ match: ${IND}, candidates: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The resolveSymbol seam: map a free term to an individual + runner-up candidates. Every id-taking service consumes a resolved id."
          },
          describe: {
            group: "resolution",
            args: { id: "string" },
            result: `{ individual: ${IND}, out: ${EDGE}[], incoming: ${EDGE}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "Full typed portrait of one individual: its attributes and its outgoing/incoming edges."
          },
          members: {
            group: "resolution",
            args: { classId: "string" },
            result: `{ methods: ${IND}[], attributes: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "A class's methods + attributes (via the contains relation) \u2014 replaces reading the class body."
          },
          subclasses: {
            group: "resolution",
            args: { classId: "string" },
            result: `{ bases: ${IND}[], subclasses: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "Forward bases + the transitive reverse inheritance closure (who extends this)."
          },
          exports: {
            group: "resolution",
            args: { moduleId: "string" },
            result: `{ exports: ${IND}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "A module's curated public API (resolved __all__ / re-exports)."
          },
          signature: {
            group: "resolution",
            args: { id: "string" },
            result: "{ id, label, class, params, returns, raises, decorators, doc, selfFields, flags }",
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The compact API surface of a symbol without its body."
          },
          edges: {
            group: "traversal",
            args: { id: "string", kind: "EDGE_KINDS member" },
            result: `{ kind: string, edges: ${EDGE}[] }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "Outgoing edges of one closed kind from an individual (an honest empty array is not a miss).",
            note: "An unknown kind (outside EDGE_KINDS) is a programming error and throws TypeError, not a miss."
          },
          impact: {
            group: "traversal",
            args: { moduleId: "string" },
            result: `{ total: number, levels: Array<Array<{ id, label, via, tests }>> }`,
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The transitive dependent closure the interpreter cannot compute without provider truth."
          },
          snippet: {
            group: "source",
            args: { id: "string" },
            result: "{ path: string, span: { start, end }, body: string|null } \u2014 Promise<Result>",
            misses: ["UNRESOLVED_TERM", "NO_SOURCE"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The exact source span of a symbol. A provider with no working tree returns miss(NO_SOURCE) honestly \u2014 snippet has nothing useful without fs.",
            note: "ASYNC (returns Promise<Result>) \u2014 a real body read is inherently fs I/O; callers should always await it. A graph-only provider still resolves synchronously-in-spirit (the promise settles on the same tick) but the return type is uniformly a Promise regardless of sourceAccess."
          },
          context: {
            group: "source",
            args: { symbol: "string", depth: "min|auto|full?" },
            result: "{ text: string, tier: string } (a sized edit bundle) \u2014 Promise<Result>",
            // contextPlan/sizeBundle/renderGraphOnlyBundle are pure graph queries, so a graph-only
            // provider (sourceAccess:false) returns a REAL HIT for any resolvable symbol —
            // siblings, registration, class members, __all__/re-exports, insertion region, covering
            // tests, co-change — everything except anchor/exemplar/inlined-callee BODY TEXT, which
            // still needs a source-capable provider. NO_SOURCE is therefore not a miss reason
            // context() can return (not in the list below) — the only remaining miss is an
            // unresolvable symbol.
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The composed edit bundle (exemplar, siblings, registration, insertion region). A graph-only provider returns the graph-only sections as a real hit; a source-capable provider (sourceAccess:true, repoRoot, readFile) additionally includes the anchor/exemplar/inlined-callee body text.",
            note: "ASYNC (returns Promise<Result>) \u2014 see snippet's note; source-capable rendering is fs I/O."
          },
          architecture: {
            group: "aggregate",
            args: { package: "string?" },
            result: "{ modules: number, packages: Array<[dir, count]>, hubs: Array<{ id, label, importers }> }",
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Package/module shape + the most-imported hub modules. Optional package prefix scopes it."
          },
          untested: {
            group: "aggregate",
            args: {},
            result: `{ modules: ${IND}[] }`,
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Modules with no covering test module (via the tests relation)."
          },
          stats: {
            group: "aggregate",
            args: {},
            result: "{ total: number, classes: Array<{ class: string, count: number }>, truncated: boolean }",
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Per-tmct:class individual counts, read straight from the payload."
          },
          history: {
            group: "temporal",
            args: { id: "string" },
            result: "{ commits: Array<{ id, label, author, date, message }> }",
            misses: ["UNRESOLVED_TERM"],
            concurrency: CONCURRENT_SAFE,
            purpose: "The commits that touched an individual (tmct:commit individuals via tmct:touches)."
          },
          search: {
            group: "search",
            args: { query: "string", kind: "string?", name: "string?", decorator: "string?" },
            result: `{ results: ${IND}[] }`,
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "Lexical, provider-local locate. An empty result set is honest, not a miss."
          },
          ask: {
            group: "search",
            args: { query: "string" },
            result: "{ content: string, tmct_ask: object } (the composed NL round-trip envelope)",
            misses: [],
            concurrency: CONCURRENT_SAFE,
            purpose: "The mechanical, zero-model NL query over the graph \u2014 tmct's whole reason to exist."
          }
        }
      });
    }
  });

  // src/adapters/providers/graph-service.mjs
  function edgesAround(graph, id) {
    const out = [];
    const incoming = [];
    for (const g of graph.relations) {
      for (const e of g.edges) {
        if (e.subject === id) out.push(toEdge(e, { predicate: g.predicate, prop: g.prop }));
        if (e.object === id) incoming.push(toEdge(e, { predicate: g.predicate, prop: g.prop }));
      }
    }
    return { out, incoming };
  }
  function groupMetaForKind(graph, kind) {
    for (const g of graph.relations) if (relationKind(g) === kind) return { predicate: g.predicate, prop: g.prop };
    return { predicate: kind, prop: null };
  }
  async function renderSourceBodies(plan, mask, { readFile: readFile12, repoRoot }) {
    if (!plan.moduleLabel) return "";
    let lines = null;
    try {
      ({ lines } = await readSpanSafe({ readFile: readFile12, repoRoot, path: plan.moduleLabel }));
    } catch {
      lines = null;
    }
    if (!lines) return "";
    const out = [];
    if (mask.anchor && plan.anchor?.site) {
      const { start, end } = plan.anchor.site;
      out.push(`
## anchor: ${plan.anchor.label} (${plan.anchor.class}) @ ${plan.moduleLabel}:${start}-${end}`);
      out.push(sliceSpan(lines, start, end, CONTEXT_BODY_MAX_LINES).text);
      if (plan.callHint) out.push(plan.callHint);
    }
    if (mask.exemplar && plan.exemplar?.site) {
      const { start, end } = plan.exemplar.site;
      const dec = plan.exemplar.decorators ? ` @${plan.exemplar.decorators}` : "";
      out.push(`
## closest example (full body) \u2014 copy this style: ${plan.exemplar.label} (${plan.exemplar.class})${dec} @ ${plan.moduleLabel}:${start}-${end}`);
      out.push(sliceSpan(lines, start, end, CONTEXT_BODY_MAX_LINES).text);
      if (plan.callHint) out.push(plan.callHint);
    }
    if (mask.inlinedCallees && plan.calleeBodies.length) {
      let budget = CONTEXT_INLINE_CALLEE_LOC;
      for (const cb of plan.calleeBodies) {
        if (budget <= 0) break;
        const start = cb.site.start;
        const fromThisFile = cb.site.path === plan.moduleLabel;
        let bodyLines = fromThisFile ? lines : null;
        if (!bodyLines) {
          try {
            ({ lines: bodyLines } = await readSpanSafe({ readFile: readFile12, repoRoot, path: cb.site.path }));
          } catch {
            bodyLines = null;
          }
        }
        if (!bodyLines) continue;
        const sliced = sliceSpan(bodyLines, start, cb.site.end, budget);
        out.push(`
## inlined callee body (depth-1 in-repo call): ${cb.label} @ ${cb.site.path}:${start}-${cb.site.end}`);
        out.push(sliced.text);
        budget -= sliced.end - start + 1;
      }
    }
    return out.join("\n");
  }
  function createGraphService(graph, { sourceAccess = false, repoRoot = null, readFile: readFile12 = null, tel = null, ask: ask2 = null } = {}) {
    const byId = graph.byId;
    if (sourceAccess && (!repoRoot || typeof readFile12 !== "function")) {
      throw new TypeError(
        "createGraphService({ sourceAccess: true }) requires both repoRoot and readFile \u2014 fs access is an injected capability, not an ambient import."
      );
    }
    const resolveId = (id) => byId.get(id) || null;
    const svc = {
      version: INTERFACE_VERSION,
      /** Advertised services. Source services are listed but honestly answer NO_SOURCE
       *  unless a source-capable provider overrides them. */
      capabilities: [...SERVICES],
      sourceAccess: Boolean(sourceAccess),
      /** The underlying graph — tmct-internal presentation (render*) reads it; not
       *  part of the wire contract. */
      graph,
      resolve(term) {
        const { match, candidates } = resolveSymbol(graph, String(term ?? ""));
        if (!match) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: String(term ?? "") });
        return hit({ match: toIndividual(match), candidates: candidates.map(toIndividual) });
      },
      describe(id) {
        const ind = resolveId(id);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
        const { out, incoming } = edgesAround(graph, id);
        return hit({ individual: toIndividual(ind), out, incoming });
      },
      members(classId) {
        const ind = resolveId(classId);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: classId });
        const contains = edgesOfKind(graph, "contains").filter((e) => e.subject === classId);
        const methods = [];
        const attributes = [];
        for (const e of contains) {
          const m = byId.get(e.object);
          const proj = m ? toIndividual(m) : { id: e.object, label: e.objectLabel || e.object, class: "Entity", attributes: [] };
          if ((m?.class || "") === "Attribute") attributes.push(proj);
          else methods.push(proj);
        }
        return hit({ methods, attributes });
      },
      subclasses(classId) {
        const ind = resolveId(classId);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: classId });
        const inherits = edgesOfKind(graph, "inherits");
        const bases = inherits.filter((e) => e.subject === classId).map((e) => byId.get(e.object) ? toIndividual(byId.get(e.object)) : { id: e.object, label: e.objectLabel || e.object, class: "Class", attributes: [] });
        const childrenOf = /* @__PURE__ */ new Map();
        for (const e of inherits) {
          if (!childrenOf.has(e.object)) childrenOf.set(e.object, []);
          childrenOf.get(e.object).push(e.subject);
        }
        const seen = /* @__PURE__ */ new Set([classId]);
        const subs = [];
        let frontier = [classId];
        for (let d = 0; d < 8 && frontier.length; d += 1) {
          const next = [];
          for (const cur of frontier) {
            for (const childId of childrenOf.get(cur) || []) {
              if (seen.has(childId)) continue;
              seen.add(childId);
              const c = byId.get(childId);
              subs.push(c ? toIndividual(c) : { id: childId, label: childId, class: "Class", attributes: [] });
              next.push(childId);
            }
          }
          frontier = next;
        }
        return hit({ bases, subclasses: subs });
      },
      exports(moduleId) {
        const ind = resolveId(moduleId);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: moduleId });
        const edges = edgesOfKind(graph, "reexports").filter((e) => e.subject === moduleId);
        const exports = edges.map((e) => byId.get(e.object) ? toIndividual(byId.get(e.object)) : { id: e.object, label: e.objectLabel || e.object, class: "Entity", attributes: [] });
        return hit({ exports });
      },
      signature(id) {
        const ind = resolveId(id);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
        const flags = [];
        for (const [attr, name] of [["isStatic", "static"], ["isAbstract", "abstract"], ["isConstant", "constant"]]) {
          if (attrOf(ind, attr)) flags.push(name);
        }
        const vis = attrOf(ind, "visibility");
        if (vis) flags.push(vis);
        return hit({
          id: ind.id,
          label: ind.label,
          class: ind.class || "Entity",
          params: attrOf(ind, "params"),
          returns: attrOf(ind, "returns"),
          raises: attrOf(ind, "raises"),
          decorators: attrOf(ind, "decorators"),
          doc: attrOf(ind, "doc"),
          selfFields: attrOf(ind, "self_fields"),
          flags
        });
      },
      edges(id, kind, { limit, offset = 0 } = {}) {
        if (!EDGE_KINDS.includes(kind)) {
          throw new TypeError(`edges(): unknown kind "${kind}" (not in EDGE_KINDS)`);
        }
        const ind = resolveId(id);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
        const meta = groupMetaForKind(graph, kind);
        let edges = edgesOfKind(graph, kind).filter((e) => e.subject === id).map((e) => toEdge(e, meta));
        edges = limit == null ? edges.slice(offset) : edges.slice(offset, offset + limit);
        return hit({ kind, edges });
      },
      impact(moduleId, { maxDepth } = {}) {
        const ind = resolveId(moduleId);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: moduleId });
        const levels = maxDepth == null ? impactClosure(graph, ind) : impactClosure(graph, ind, { maxDepth });
        const total = levels.reduce((n, l) => n + l.length, 0);
        return hit({ total, levels });
      },
      // Async (returns Promise<Result>): callers should always await a source-reaching
      // service regardless of whether this provider happens to be source-capable.
      async snippet(id) {
        const ind = resolveId(id);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
        const site = siteOf(ind);
        if (!svc.sourceAccess) {
          return miss(MISS_REASONS.NO_SOURCE, {
            term: id,
            detail: site ? `span is ${site.path}:${site.start}-${site.end}; this provider exposes no working tree` : "no source span in the graph"
          });
        }
        if (!site) return miss(MISS_REASONS.NO_SOURCE, { term: id, detail: "no source span in the graph (likely a module)" });
        try {
          const sliced = await readSpanSafe({
            readFile: readFile12,
            repoRoot,
            path: site.path,
            start: site.start,
            end: site.end,
            maxLines: CONTEXT_BODY_MAX_LINES
          });
          return hit({ path: site.path, span: { start: site.start, end: site.end }, body: sliced.text });
        } catch (e) {
          return miss(MISS_REASONS.NO_SOURCE, { term: id, detail: `could not read ${site.path}: ${e?.message || e}` });
        }
      },
      // A graph-only HIT for any resolvable symbol (siblings/registration/globals/tests/
      // exports/insertion-region), everything except anchor/exemplar/inlined-callee body TEXT.
      // A source-capable provider layers the body sections on top via renderSourceBodies.
      async context(symbol, { depth = "auto" } = {}) {
        const { match } = resolveSymbol(graph, String(symbol ?? ""));
        if (!match) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: String(symbol ?? "") });
        const plan = contextPlan(graph, match);
        const d = String(depth || "auto").trim().toLowerCase();
        let tier, mask;
        if (d === "min") {
          tier = "TINY";
          mask = bundleMask("TINY");
        } else if (d === "full") {
          tier = "FULL";
          mask = bundleMask("FULL");
        } else ({ tier, mask } = sizeBundle(plan, graph, {}));
        const graphText = renderGraphOnlyBundle(plan, mask);
        if (!svc.sourceAccess) return hit({ text: graphText, tier });
        const bodyText = await renderSourceBodies(plan, mask, { readFile: readFile12, repoRoot });
        return hit({ text: bodyText ? `${graphText}
${bodyText}` : graphText, tier });
      },
      architecture({ package: pkg = "" } = {}) {
        const norm = String(pkg || "").trim().toLowerCase().replace(/^\.?\//, "");
        const modules = graph.individuals.filter(
          (i) => (i.class || "") === "Module" && (!norm || String(i.label || "").toLowerCase().startsWith(norm))
        );
        const pkgCount = /* @__PURE__ */ new Map();
        for (const m of modules) {
          const dir = m.label.includes("/") ? m.label.slice(0, m.label.lastIndexOf("/")) : "(root)";
          pkgCount.set(dir, (pkgCount.get(dir) || 0) + 1);
        }
        const modSet = new Set(modules.map((m) => m.id));
        const inDeg = /* @__PURE__ */ new Map();
        for (const e of edgesOfKind(graph, "imports")) {
          if (modSet.has(e.object)) inDeg.set(e.object, (inDeg.get(e.object) || 0) + 1);
        }
        const hubs = [...inDeg.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: byId.get(id)?.label || id, importers: n }));
        const packages = [...pkgCount.entries()].sort((a, b) => b[1] - a[1]);
        return hit({ modules: modules.length, packages, hubs });
      },
      untested() {
        const covered = new Set(edgesOfKind(graph, "tests").map((e) => e.object));
        const modules = graph.individuals.filter((i) => (i.class || "") === "Module" && !covered.has(i.id) && !/\.test\./.test(i.label || "")).map(toIndividual);
        return hit({ modules });
      },
      stats() {
        const counts = /* @__PURE__ */ new Map();
        for (const i of graph.individuals) {
          const c = i.class || "Entity";
          counts.set(c, (counts.get(c) || 0) + 1);
        }
        const classes = [...counts.entries()].map(([cls, count]) => ({ class: cls, count })).sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));
        return hit({ total: graph.individuals.length, classes, truncated: (graph.truncated || []).length > 0 });
      },
      history(id) {
        const ind = resolveId(id);
        if (!ind) return miss(MISS_REASONS.UNRESOLVED_TERM, { term: id });
        const touchEdges = [
          ...edgesOfKind(graph, "touches"),
          ...edgesOfKind(graph, "touchesSymbol")
        ].filter((e) => e.object === id);
        const seen = /* @__PURE__ */ new Set();
        const commits = [];
        for (const e of touchEdges) {
          if (seen.has(e.subject)) continue;
          seen.add(e.subject);
          const c = byId.get(e.subject);
          commits.push({
            id: e.subject,
            label: e.subjectLabel || c?.label || e.subject,
            author: c ? attrOf(c, "author") ?? attrOf(c, "commitAuthor") : null,
            date: c ? attrOf(c, "date") ?? attrOf(c, "commitDate") : null,
            message: c ? attrOf(c, "message") ?? attrOf(c, "commitMessage") : null
          });
        }
        return hit({ commits });
      },
      // Ranked lexical search: module-mode (no kind, or kind="module") ranks via
      // searchModulesRanked; symbol-mode (kind names a symbol kind) ranks via
      // scoreSymbolsRanked, with name/decorator filters. Results capped at `limit`.
      search(query, { kind = "", name = "", decorator = "", limit = SEARCH_LIMIT, offset = 0 } = {}) {
        const rawQuery = String(query || "");
        const k = String(kind || "").trim().toLowerCase();
        const nm = String(name || "").trim();
        const dec = String(decorator || "").trim().toLowerCase();
        let nameRe = null;
        if (nm) {
          try {
            nameRe = new RegExp(nm, "i");
          } catch {
            nameRe = null;
          }
        }
        let rankedInds;
        if (k && k !== "module") {
          const tokens = rawQuery.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
          rankedInds = scoreSymbolsRanked(graph, tokens, { kind: k, decFilter: dec, nameRe }).map((s) => s.ind);
        } else {
          const byLabel = /* @__PURE__ */ new Map();
          for (const i of graph.individuals) if ((i.class || "") === "Module") byLabel.set(i.label, i);
          rankedInds = searchModulesRanked(graph, rawQuery).map(({ path }) => byLabel.get(path)).filter(Boolean);
        }
        const results = rankedInds.slice(offset, offset + limit).map(toIndividual);
        return hit({ results });
      },
      ask(query) {
        if (typeof ask2 !== "function") return miss(MISS_REASONS.CAPABILITY_ABSENT, "this provider was constructed without an ask answerer");
        const { content, tmct_ask: tmct_ask2 } = ask2(graph, String(query || ""));
        return hit({ content, tmct_ask: tmct_ask2 });
      }
    };
    if (tel) {
      for (const name of SERVICES) {
        const orig = svc[name];
        if (typeof orig !== "function") continue;
        svc[name] = (...args) => {
          const t0 = performance.now();
          const result = orig.apply(svc, args);
          if (result && typeof result.then === "function") {
            return result.then((r) => {
              recordTelemetry(tel, name, performance.now() - t0, r);
              return r;
            });
          }
          recordTelemetry(tel, name, performance.now() - t0, result);
          return result;
        };
      }
    }
    return svc;
  }
  function recordTelemetry(tel, name, ms, result) {
    try {
      tel.record({ tool: `ri.${name}`, perf: { ms_total: ms }, response: responseCounts(result) });
    } catch {
    }
  }
  function responseCounts(result) {
    if (!result || typeof result !== "object" || result.ok !== true) {
      return { ok: false, reason: result?.miss?.reason || null };
    }
    let count = 0;
    const value = result.value;
    if (Array.isArray(value)) count = value.length;
    else if (value && typeof value === "object") {
      for (const v of Object.values(value)) if (Array.isArray(v)) count += v.length;
    }
    return { ok: true, count };
  }
  var attrOf, CONTEXT_BODY_MAX_LINES, CONTEXT_INLINE_CALLEE_LOC;
  var init_graph_service = __esm({
    "src/adapters/providers/graph-service.mjs"() {
      init_codegraph();
      init_source_slice();
      init_repository_interface();
      attrOf = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value ?? null;
      CONTEXT_BODY_MAX_LINES = 200;
      CONTEXT_INLINE_CALLEE_LOC = 120;
    }
  });

  // src/domain/hash.mjs
  function fnv1a32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function fnv1aHex(str) {
    return fnv1a32(str).toString(16).padStart(8, "0");
  }
  function normFactTerm(t) {
    let s = normText(t);
    s = s.replace(/^\/c\/[a-z]{2,3}\//i, "");
    s = s.replace(/^[a-z][\w.-]*:/i, "");
    s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/^(?:the|an?)\s+/i, "");
    return s.toLowerCase();
  }
  function normFactPredicate(p) {
    const t = normText(p);
    return CANONICAL_FACT_PREDICATE.get(t) ?? t;
  }
  function factIdForTriple(subject, predicate, object) {
    return factIdFor(normFactTerm(subject), normFactPredicate(predicate), normFactTerm(object));
  }
  var SHA256_K, TEXT_CAP, normText, CANONICAL_FACT_PREDICATE, factIdFor;
  var init_hash = __esm({
    "src/domain/hash.mjs"() {
      SHA256_K = new Uint32Array([
        1116352408,
        1899447441,
        3049323471,
        3921009573,
        961987163,
        1508970993,
        2453635748,
        2870763221,
        3624381080,
        310598401,
        607225278,
        1426881987,
        1925078388,
        2162078206,
        2614888103,
        3248222580,
        3835390401,
        4022224774,
        264347078,
        604807628,
        770255983,
        1249150122,
        1555081692,
        1996064986,
        2554220882,
        2821834349,
        2952996808,
        3210313671,
        3336571891,
        3584528711,
        113926993,
        338241895,
        666307205,
        773529912,
        1294757372,
        1396182291,
        1695183700,
        1986661051,
        2177026350,
        2456956037,
        2730485921,
        2820302411,
        3259730800,
        3345764771,
        3516065817,
        3600352804,
        4094571909,
        275423344,
        430227734,
        506948616,
        659060556,
        883997877,
        958139571,
        1322822218,
        1537002063,
        1747873779,
        1955562222,
        2024104815,
        2227730452,
        2361852424,
        2428436474,
        2756734187,
        3204031479,
        3329325298
      ]);
      TEXT_CAP = 2e3;
      normText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);
      CANONICAL_FACT_PREDICATE = /* @__PURE__ */ new Map([
        ["mgx:cause", "mgx:causes"],
        ["mgx:desire", "mgx:desires"],
        ["mgx:want", "mgx:desires"],
        ["mgx:require", "mgx:hasPrerequisite"],
        ["mgx:involve", "mgx:hasSubevent"]
      ]);
      factIdFor = (s, p, o) => `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;
    }
  });

  // src/domain/syllogise.mjs
  var syllogise_exports = {};
  __export(syllogise_exports, {
    CARDINALITY_RULE_CONFIDENCE: () => CARDINALITY_RULE_CONFIDENCE,
    CAX_DW_RULE: () => CAX_DW_RULE,
    CAX_DW_RULE_CONFIDENCE: () => CAX_DW_RULE_CONFIDENCE,
    CAX_MAXC0_RULE_CONFIDENCE: () => CAX_MAXC0_RULE_CONFIDENCE,
    CLS_SVF1_RULE: () => CLS_SVF1_RULE,
    CLS_SVF1_RULE_CONFIDENCE: () => CLS_SVF1_RULE_CONFIDENCE,
    DISJOINT_PREDICATE: () => DISJOINT_PREDICATE,
    ENTAILED_DISJOINT_PROVENANCE: () => ENTAILED_DISJOINT_PROVENANCE,
    ENTAILED_PROVENANCE: () => ENTAILED_PROVENANCE,
    ENTAILED_SCM_SVF_PROVENANCE: () => ENTAILED_SCM_SVF_PROVENANCE,
    ENTAILED_SVF1_PROVENANCE: () => ENTAILED_SVF1_PROVENANCE,
    ENTAILED_TYPE_PROVENANCE: () => ENTAILED_TYPE_PROVENANCE,
    ON_PROPERTY_PREDICATE: () => ON_PROPERTY_PREDICATE,
    SCM_SVF_RULE: () => SCM_SVF_RULE,
    SCM_SVF_RULE_CONFIDENCE: () => SCM_SVF_RULE_CONFIDENCE,
    SOME_VALUES_FROM_PREDICATE: () => SOME_VALUES_FROM_PREDICATE,
    SUBCLASS_PREDICATE: () => SUBCLASS_PREDICATE,
    TYPE_PREDICATE: () => TYPE_PREDICATE,
    buildCardinalityRestrictions: () => buildCardinalityRestrictions,
    deriveDisjointViolations: () => deriveDisjointViolations,
    deriveSomeValuesFromApplication: () => deriveSomeValuesFromApplication,
    deriveSomeValuesFromSubsumption: () => deriveSomeValuesFromSubsumption,
    deriveSubClassClosure: () => deriveSubClassClosure,
    deriveTypePropagation: () => deriveTypePropagation,
    entailedTrustFrom: () => entailedTrustFrom,
    findConsistencyViolations: () => findConsistencyViolations,
    findIsaChain: () => findIsaChain,
    proveCardinalityAtLeast: () => proveCardinalityAtLeast,
    proveMaxCardinalityZeroDenial: () => proveMaxCardinalityZeroDenial,
    retractSubClassOf: () => retractSubClassOf,
    syllogise: () => syllogise
  });
  function requireStore(store, needed, caller) {
    for (const name of needed) {
      if (typeof store?.[name] !== "function") {
        throw new TypeError(`${caller} needs a store option carrying { ${needed.join(", ")} } (memory/core.mjs's read/write functions) \u2014 missing ${name}`);
      }
    }
    return store;
  }
  function entailedTrustFrom(premiseTrusts, ruleConfidence = 1) {
    const nums = (Array.isArray(premiseTrusts) ? premiseTrusts : []).filter((t) => typeof t === "number");
    if (!nums.length) return null;
    const clamped = Math.max(0, Math.min(1, Math.min(...nums) * ruleConfidence));
    return Number(clamped.toFixed(6));
  }
  function normalizeFocus(focus) {
    if (!focus) return null;
    const arr = focus instanceof Set ? [...focus] : Array.isArray(focus) ? focus : [];
    const out = /* @__PURE__ */ new Set();
    for (const t of arr) {
      const n = normFactTerm(t);
      if (n) out.add(n);
    }
    return out.size ? out : null;
  }
  function deriveSubClassClosure(edges, { depth = 32, budget = 50, focus = null } = {}) {
    const present = /* @__PURE__ */ new Set();
    const succ = /* @__PURE__ */ new Map();
    for (const [a, b] of edges || []) {
      if (!a || !b || a === b) continue;
      present.add(`${a}${SEP}${b}`);
      if (!succ.has(a)) succ.set(a, /* @__PURE__ */ new Set());
      succ.get(a).add(b);
    }
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (a, b, c) => !focusSet || focusSet.has(a) || focusSet.has(b) || focusSet.has(c);
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (let round2 = 0; round2 < depth; round2 += 1) {
      const additions = [];
      for (const [a, bs] of succ) {
        for (const b of bs) {
          const cs = succ.get(b);
          if (!cs) continue;
          for (const c of cs) {
            if (a === c) continue;
            const key = `${a}${SEP}${c}`;
            if (present.has(key) || derivedKeys.has(key)) continue;
            if (!inFocus(a, b, c)) continue;
            additions.push([a, b, c, key]);
          }
        }
      }
      if (!additions.length) break;
      additions.sort((x, y) => x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]) || x[1].localeCompare(y[1]));
      let progressed = false;
      for (const [a, b, c, key] of additions) {
        if (derivedKeys.has(key)) continue;
        if (derived.length >= budget) break;
        derivedKeys.add(key);
        derived.push({ subject: a, object: c, via: b });
        if (!succ.has(a)) succ.set(a, /* @__PURE__ */ new Set());
        succ.get(a).add(c);
        progressed = true;
      }
      if (derived.length >= budget || !progressed) break;
    }
    return derived;
  }
  function buildAncestorCloser(subClassEdges) {
    const succ = /* @__PURE__ */ new Map();
    for (const [a, b] of subClassEdges || []) {
      if (!a || !b || a === b) continue;
      if (!succ.has(a)) succ.set(a, /* @__PURE__ */ new Set());
      succ.get(a).add(b);
    }
    const ancestorsCache = /* @__PURE__ */ new Map();
    return (c) => {
      if (ancestorsCache.has(c)) return ancestorsCache.get(c);
      const seen = /* @__PURE__ */ new Set();
      const stack = [...succ.get(c) || []];
      while (stack.length) {
        const n = stack.pop();
        if (seen.has(n)) continue;
        seen.add(n);
        for (const next of succ.get(n) || []) if (!seen.has(next)) stack.push(next);
      }
      ancestorsCache.set(c, seen);
      return seen;
    };
  }
  function deriveTypePropagation(typeEdges, subClassEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const present = /* @__PURE__ */ new Set();
    const seenTypeEdge = /* @__PURE__ */ new Set();
    for (const [x, c] of typeEdges || []) if (x && c) present.add(`${x}${SEP}${c}`);
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x, c, d) => !focusSet || focusSet.has(x) || focusSet.has(c) || focusSet.has(d);
    const candidates = [];
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      const tk = `${x}${SEP}${c}`;
      if (seenTypeEdge.has(tk)) continue;
      seenTypeEdge.add(tk);
      for (const d of ancestorsOf2(c)) {
        if (d === c || d === x) continue;
        const key = `${x}${SEP}${d}`;
        if (present.has(key)) continue;
        if (!inFocus(x, c, d)) continue;
        candidates.push([x, c, d, key]);
      }
    }
    candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[2].localeCompare(q[2]) || p[1].localeCompare(q[1]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [x, c, d, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: x, object: d, via: c });
    }
    return derived;
  }
  function deriveDisjointViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const disjointOf = /* @__PURE__ */ new Map();
    const presentPairs = /* @__PURE__ */ new Set();
    for (const [a, b] of disjointEdges || []) {
      if (!a || !b || a === b) continue;
      presentPairs.add(`${a}${SEP}${b}`);
      presentPairs.add(`${b}${SEP}${a}`);
      if (!disjointOf.has(a)) disjointOf.set(a, /* @__PURE__ */ new Set());
      disjointOf.get(a).add(b);
      if (!disjointOf.has(b)) disjointOf.set(b, /* @__PURE__ */ new Set());
      disjointOf.get(b).add(a);
    }
    if (!disjointOf.size) return [];
    const seenTypeEdge = /* @__PURE__ */ new Set();
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x, c, e) => !focusSet || focusSet.has(x) || focusSet.has(c) || focusSet.has(e);
    const candidates = [];
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      const tk = `${x}${SEP}${c}`;
      if (seenTypeEdge.has(tk)) continue;
      seenTypeEdge.add(tk);
      for (const d of [c, ...ancestorsOf2(c)]) {
        const partners = disjointOf.get(d);
        if (!partners) continue;
        for (const e of partners) {
          if (e === x) continue;
          const key = `${x}${SEP}${e}`;
          if (presentPairs.has(key)) continue;
          if (!inFocus(x, c, e)) continue;
          candidates.push([x, c, d, e, key]);
        }
      }
    }
    candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[3].localeCompare(q[3]) || p[2].localeCompare(q[2]) || p[1].localeCompare(q[1]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [x, c, d, e, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: x, object: e, viaType: c, viaClass: d });
    }
    return derived;
  }
  function deriveSomeValuesFromApplication(propertyEdges, typeEdges, subClassEdges, restrictionEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const byPropTarget = /* @__PURE__ */ new Map();
    for (const r of restrictionEdges || []) {
      if (!r || !r.restriction || !r.property || !r.target) continue;
      const key = `${r.property}${SEP}${r.target}`;
      if (!byPropTarget.has(key)) byPropTarget.set(key, /* @__PURE__ */ new Set());
      byPropTarget.get(key).add(r.restriction);
    }
    if (!byPropTarget.size) return [];
    const present = /* @__PURE__ */ new Set();
    const typesOf = /* @__PURE__ */ new Map();
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      present.add(`${x}${SEP}${c}`);
      if (!typesOf.has(x)) typesOf.set(x, /* @__PURE__ */ new Set());
      typesOf.get(x).add(c);
    }
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x, y, r) => !focusSet || focusSet.has(x) || focusSet.has(y) || focusSet.has(r);
    const seenEdge = /* @__PURE__ */ new Set();
    const candidates = [];
    for (const [x, p, y] of propertyEdges || []) {
      if (!x || !p || !y) continue;
      const pKey = normFactTerm(p);
      const ek = `${x}${SEP}${pKey}${SEP}${y}`;
      if (seenEdge.has(ek)) continue;
      seenEdge.add(ek);
      const yTypes = typesOf.get(y);
      if (!yTypes) continue;
      for (const c of yTypes) {
        for (const target of [c, ...ancestorsOf2(c)]) {
          const restrictions = byPropTarget.get(`${pKey}${SEP}${target}`);
          if (!restrictions) continue;
          for (const r of restrictions) {
            if (x === r) continue;
            const key = `${x}${SEP}${r}`;
            if (present.has(key)) continue;
            if (!inFocus(x, y, r)) continue;
            candidates.push([x, p, pKey, y, c, target, r, key]);
          }
        }
      }
    }
    candidates.sort((a, b) => a[0].localeCompare(b[0]) || a[6].localeCompare(b[6]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [x, p, pKey, y, c, target, r, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: x, object: r, viaProperty: p, viaPropertyKey: pKey, viaValue: y, viaType: c, viaTarget: target });
    }
    return derived;
  }
  function buildCardinalityRestrictions(rows) {
    const onPropertyOf = /* @__PURE__ */ new Map();
    const kindOf = /* @__PURE__ */ new Map();
    const onClassOf = /* @__PURE__ */ new Map();
    for (const r of rows || []) {
      if (!r || !r.subject || !r.predicate) continue;
      if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
      else if (isOnClass(r.predicate)) onClassOf.set(r.subject, r.object);
      else {
        const kind = CARDINALITY_KIND_OF[String(r.predicate).trim().toLowerCase()];
        if (!kind) continue;
        const n = Number(r.object);
        if (Number.isFinite(n)) kindOf.set(r.subject, { kind, n });
      }
    }
    const restrictions = [];
    for (const [restriction, { kind, n }] of kindOf) {
      if (onPropertyOf.get(restriction) !== HAS_PROPERTY_KEY) continue;
      const onClass = onClassOf.get(restriction);
      if (!onClass) continue;
      restrictions.push({ restriction, kind, n, onClass });
    }
    restrictions.sort((a, b) => a.restriction.localeCompare(b.restriction));
    return restrictions;
  }
  function deriveSomeValuesFromSubsumption(restrictionEdges, subClassEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const byProperty = /* @__PURE__ */ new Map();
    for (const r of restrictionEdges || []) {
      if (!r || !r.restriction || !r.property || !r.target) continue;
      const pKey = normFactTerm(r.property);
      if (!byProperty.has(pKey)) byProperty.set(pKey, []);
      byProperty.get(pKey).push({ restriction: r.restriction, target: r.target });
    }
    const present = /* @__PURE__ */ new Set();
    for (const [a, b] of subClassEdges || []) if (a && b) present.add(`${a}${SEP}${b}`);
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (c1, c2) => !focusSet || focusSet.has(c1) || focusSet.has(c2);
    const candidates = [];
    for (const [, group] of byProperty) {
      if (group.length < 2) continue;
      for (const r1 of group) {
        for (const r2 of group) {
          if (r1.restriction === r2.restriction) continue;
          if (r1.target === r2.target) continue;
          if (!ancestorsOf2(r1.target).has(r2.target)) continue;
          const key = `${r1.restriction}${SEP}${r2.restriction}`;
          if (present.has(key)) continue;
          if (!inFocus(r1.restriction, r2.restriction)) continue;
          candidates.push([r1.restriction, r2.restriction, r1.target, r2.target, key]);
        }
      }
    }
    candidates.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const derived = [];
    const derivedKeys = /* @__PURE__ */ new Set();
    for (const [c1, c2, y1, y2, key] of candidates) {
      if (derivedKeys.has(key)) continue;
      if (derived.length >= budget) break;
      derivedKeys.add(key);
      derived.push({ subject: c1, object: c2, viaY1: y1, viaY2: y2 });
    }
    return derived;
  }
  function findOwnCardinalityRestriction(subClassEdges, cardinalityRestrictionEdges, subject, matches, { budget = 20, focus = null } = {}) {
    if (!subject) return null;
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (c) => !focusSet || focusSet.has(subject) || focusSet.has(c);
    const classToRestrictions = /* @__PURE__ */ new Map();
    for (const [a, b] of subClassEdges || []) {
      if (!a || !b) continue;
      if (!classToRestrictions.has(a)) classToRestrictions.set(a, /* @__PURE__ */ new Set());
      classToRestrictions.get(a).add(b);
    }
    const restrictionsByRid = new Map((cardinalityRestrictionEdges || []).map((r) => [r.restriction, r]));
    let checked = 0;
    for (const c of [subject, ...ancestorsOf2(subject)]) {
      if (checked >= budget) break;
      checked += 1;
      if (!inFocus(c)) continue;
      for (const rid of classToRestrictions.get(c) || []) {
        const rec = restrictionsByRid.get(rid);
        if (rec && matches(rec)) return { viaClass: c, viaRestriction: rid, record: rec };
      }
    }
    return null;
  }
  function proveCardinalityAtLeast(subClassEdges, cardinalityRestrictionEdges, subject, onClass, m, opts = {}) {
    if (!onClass || !Number.isFinite(m)) return null;
    const found = findOwnCardinalityRestriction(
      subClassEdges,
      cardinalityRestrictionEdges,
      subject,
      (rec) => rec.onClass === onClass && (rec.kind === "exactly" || rec.kind === "min") && rec.n >= m,
      opts
    );
    return found ? { subject, object: onClass, m, n: found.record.n, kind: found.record.kind, viaClass: found.viaClass, viaRestriction: found.viaRestriction } : null;
  }
  function proveMaxCardinalityZeroDenial(subClassEdges, cardinalityRestrictionEdges, subject, onClass, opts = {}) {
    if (!onClass) return null;
    const found = findOwnCardinalityRestriction(
      subClassEdges,
      cardinalityRestrictionEdges,
      subject,
      (rec) => rec.onClass === onClass && rec.kind === "max" && rec.n === 0,
      opts
    );
    return found ? { subject, object: onClass, viaClass: found.viaClass, viaRestriction: found.viaRestriction } : null;
  }
  function findConsistencyViolations(typeEdges, subClassEdges, disjointEdges, { budget = 50, focus = null } = {}) {
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const disjointOf = /* @__PURE__ */ new Map();
    for (const [a, b] of disjointEdges || []) {
      if (!a || !b || a === b) continue;
      if (!disjointOf.has(a)) disjointOf.set(a, /* @__PURE__ */ new Set());
      disjointOf.get(a).add(b);
      if (!disjointOf.has(b)) disjointOf.set(b, /* @__PURE__ */ new Set());
      disjointOf.get(b).add(a);
    }
    if (!disjointOf.size) return [];
    const typesBySubject = /* @__PURE__ */ new Map();
    for (const [x, c] of typeEdges || []) {
      if (!x || !c) continue;
      if (!typesBySubject.has(x)) typesBySubject.set(x, /* @__PURE__ */ new Set());
      typesBySubject.get(x).add(c);
    }
    const focusSet = focus instanceof Set ? focus.size ? focus : null : normalizeFocus(focus);
    const inFocus = (x) => !focusSet || focusSet.has(x);
    const candidates = [];
    const seenPair = /* @__PURE__ */ new Set();
    for (const [x, types] of typesBySubject) {
      if (!inFocus(x)) continue;
      const typeList = [...types].sort();
      for (let i = 0; i < typeList.length; i += 1) {
        for (let j = i + 1; j < typeList.length; j += 1) {
          const [ta, tb] = [typeList[i], typeList[j]];
          const closureA = [ta, ...ancestorsOf2(ta)];
          const closureB = [tb, ...ancestorsOf2(tb)];
          let hit2 = null;
          for (const da of closureA) {
            const partners = disjointOf.get(da);
            if (!partners) continue;
            for (const db of closureB) {
              if (partners.has(db)) {
                hit2 = [da, db];
                break;
              }
            }
            if (hit2) break;
          }
          if (!hit2) continue;
          const pairKey = `${x}${SEP}${ta}${SEP}${tb}`;
          if (seenPair.has(pairKey)) continue;
          seenPair.add(pairKey);
          candidates.push([x, ta, tb, hit2[0], hit2[1]]);
        }
      }
    }
    candidates.sort((p, q) => p[0].localeCompare(q[0]) || p[1].localeCompare(q[1]) || p[2].localeCompare(q[2]));
    const derived = [];
    for (const [x, ta, tb, viaA, viaB] of candidates) {
      if (derived.length >= budget) break;
      derived.push({ subject: x, classA: ta, classB: tb, viaA, viaB });
    }
    return derived;
  }
  async function syllogise(repoDir, { depth = 32, budget = 50, focus = null, store } = {}) {
    const { loadMemory: loadMemory2, readFactRows: readFactRows2, appendFacts: appendFacts2 } = requireStore(store, ["loadMemory", "readFactRows", "appendFacts"], "syllogise");
    const memory = await loadMemory2(repoDir);
    const rows = readFactRows2(memory);
    const subClassEdges = rows.filter((r) => isSubClassOf(r.predicate)).map((r) => [r.subject, r.object]);
    const typeEdges = rows.filter((r) => isType(r.predicate)).map((r) => [r.subject, r.object]);
    const disjointEdges = rows.filter((r) => isDisjoint(r.predicate)).map((r) => [r.subject, r.object]);
    const onPropertyOf = /* @__PURE__ */ new Map();
    const someValuesFromOf = /* @__PURE__ */ new Map();
    const propertyEdges = [];
    for (const r of rows) {
      const pLower = String(r.predicate || "").trim().toLowerCase();
      if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
      else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
      else if (!RESERVED_PREDICATES.has(pLower)) propertyEdges.push([r.subject, r.predicate, r.object]);
    }
    const restrictionEdges = [];
    for (const [restriction, property] of onPropertyOf) {
      const target = someValuesFromOf.get(restriction);
      if (target) restrictionEdges.push({ restriction, property, target });
    }
    const normalizedFocus = normalizeFocus(focus);
    const trustByTriple = /* @__PURE__ */ new Map();
    for (const r of rows) trustByTriple.set(`${r.subject}${SEP}${r.predicate}${SEP}${r.object}`, r.trust);
    const premiseTrust = (s, p, o) => trustByTriple.get(`${s}${SEP}${p}${SEP}${o}`);
    const hasTriple = (s, p, o) => trustByTriple.has(`${s}${SEP}${p}${SEP}${o}`);
    const numericOnly = (arr) => arr.filter((t) => typeof t === "number");
    const scmDerived = deriveSubClassClosure(subClassEdges, { depth, budget, focus: normalizedFocus });
    const enlargedSubClassEdges = subClassEdges.concat(scmDerived.map((d) => [d.subject, d.object]));
    const remainingBudget = Math.max(0, budget - scmDerived.length);
    const caxDerived = remainingBudget > 0 ? deriveTypePropagation(typeEdges, enlargedSubClassEdges, { budget: remainingBudget, focus: normalizedFocus }) : [];
    const remainingBudgetDw = Math.max(0, budget - scmDerived.length - caxDerived.length);
    const dwDerived = remainingBudgetDw > 0 ? deriveDisjointViolations(typeEdges, enlargedSubClassEdges, disjointEdges, { budget: remainingBudgetDw, focus: normalizedFocus }) : [];
    const remainingBudgetSvf1 = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length);
    const svf1Derived = remainingBudgetSvf1 > 0 && restrictionEdges.length ? deriveSomeValuesFromApplication(propertyEdges, typeEdges, enlargedSubClassEdges, restrictionEdges, { budget: remainingBudgetSvf1, focus: normalizedFocus }) : [];
    const remainingBudgetScmSvf = Math.max(0, budget - scmDerived.length - caxDerived.length - dwDerived.length - svf1Derived.length);
    const scmSvfDerived = remainingBudgetScmSvf > 0 && restrictionEdges.length > 1 ? deriveSomeValuesFromSubsumption(restrictionEdges, enlargedSubClassEdges, { budget: remainingBudgetScmSvf, focus: normalizedFocus }) : [];
    const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));
    const toWrite = [
      ...scmDerived.map((d) => ({
        subject: d.subject,
        predicate: SUBCLASS_PREDICATE,
        object: d.object,
        provenance: ENTAILED_PROVENANCE,
        // Persisted justification: the premise fact ids this conclusion rode
        // (a⊑b, b⊑c) — content-addressed ids work even when a premise is
        // itself an entailment this same pass just derived. Read back by
        // retractSubClassOf (below) to find every entailment a retracted
        // premise could have supported. All five rules persist one, each
        // citing its own premise shape.
        justification: [
          factIdForTriple(d.subject, SUBCLASS_PREDICATE, d.via),
          factIdForTriple(d.via, SUBCLASS_PREDICATE, d.object)
        ]
      })),
      ...caxDerived.map((d) => ({
        subject: d.subject,
        predicate: TYPE_PREDICATE,
        object: d.object,
        provenance: ENTAILED_TYPE_PROVENANCE,
        // The ⊑ premise is cited as the DIRECT via⊑object edge even when the
        // taught chain is multi-hop: scm-sco materializes that edge (this same
        // pass or an earlier one), and retraction re-VERIFIES every candidate
        // anyway, so a citation left dangling by budget truncation is inert.
        justification: [
          factIdForTriple(d.subject, TYPE_PREDICATE, d.via),
          factIdForTriple(d.via, SUBCLASS_PREDICATE, d.object)
        ]
      })),
      ...dwDerived.map((d) => {
        const dwStoredForward = hasTriple(d.viaClass, DISJOINT_PREDICATE, d.object);
        const [dwS, dwO] = dwStoredForward ? [d.viaClass, d.object] : [d.object, d.viaClass];
        const premiseTrusts = numericOnly([
          premiseTrust(d.subject, TYPE_PREDICATE, d.viaType),
          premiseTrust(dwS, DISJOINT_PREDICATE, dwO),
          // the ⊑-lift premise only exists when this IS a lift (viaClass !==
          // viaType) — a direct hit has no extra subClassOf premise to price in.
          ...d.viaClass !== d.viaType ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaClass)] : []
        ]);
        return {
          subject: d.subject,
          predicate: DISJOINT_PREDICATE,
          object: d.object,
          provenance: ENTAILED_DISJOINT_PROVENANCE,
          justification: [
            factIdForTriple(d.subject, TYPE_PREDICATE, d.viaType),
            factIdForTriple(dwS, DISJOINT_PREDICATE, dwO),
            ...d.viaClass !== d.viaType ? [factIdForTriple(d.viaType, SUBCLASS_PREDICATE, d.viaClass)] : []
          ],
          ...premiseTrusts.length ? { premiseTrusts, ruleConfidence: CAX_DW_RULE_CONFIDENCE } : {}
        };
      }),
      ...svf1Derived.map((d) => {
        const premiseTrusts = numericOnly([
          premiseTrust(d.subject, d.viaProperty, d.viaValue),
          premiseTrust(d.viaValue, TYPE_PREDICATE, d.viaType),
          premiseTrust(d.object, ON_PROPERTY_PREDICATE, d.viaPropertyKey),
          premiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaTarget),
          // the ⊑-lift premise only exists when this IS a lift (viaType !==
          // viaTarget) — a direct hit has no extra subClassOf premise to price in.
          ...d.viaType !== d.viaTarget ? [premiseTrust(d.viaType, SUBCLASS_PREDICATE, d.viaTarget)] : []
        ]);
        return {
          subject: d.subject,
          predicate: TYPE_PREDICATE,
          object: d.object,
          provenance: ENTAILED_SVF1_PROVENANCE,
          justification: [
            factIdForTriple(d.subject, d.viaProperty, d.viaValue),
            factIdForTriple(d.viaValue, TYPE_PREDICATE, d.viaType),
            factIdForTriple(d.object, ON_PROPERTY_PREDICATE, d.viaPropertyKey),
            factIdForTriple(d.object, SOME_VALUES_FROM_PREDICATE, d.viaTarget),
            ...d.viaType !== d.viaTarget ? [factIdForTriple(d.viaType, SUBCLASS_PREDICATE, d.viaTarget)] : []
          ],
          // same sub-1 discount as cax-dw, same reason (see CAX_DW_RULE_CONFIDENCE).
          ...premiseTrusts.length ? { premiseTrusts, ruleConfidence: CLS_SVF1_RULE_CONFIDENCE } : {}
        };
      }),
      ...scmSvfDerived.map((d) => {
        const r1 = restrictionByRid.get(d.subject);
        const r2 = restrictionByRid.get(d.object);
        const premiseTrusts = numericOnly([
          r1 && premiseTrust(d.subject, ON_PROPERTY_PREDICATE, r1.property),
          premiseTrust(d.subject, SOME_VALUES_FROM_PREDICATE, d.viaY1),
          r2 && premiseTrust(d.object, ON_PROPERTY_PREDICATE, r2.property),
          premiseTrust(d.object, SOME_VALUES_FROM_PREDICATE, d.viaY2),
          premiseTrust(d.viaY1, SUBCLASS_PREDICATE, d.viaY2)
        ]);
        return {
          subject: d.subject,
          predicate: SUBCLASS_PREDICATE,
          object: d.object,
          provenance: ENTAILED_SCM_SVF_PROVENANCE,
          justification: [
            ...r1 ? [factIdForTriple(d.subject, ON_PROPERTY_PREDICATE, r1.property)] : [],
            factIdForTriple(d.subject, SOME_VALUES_FROM_PREDICATE, d.viaY1),
            ...r2 ? [factIdForTriple(d.object, ON_PROPERTY_PREDICATE, r2.property)] : [],
            factIdForTriple(d.object, SOME_VALUES_FROM_PREDICATE, d.viaY2),
            factIdForTriple(d.viaY1, SUBCLASS_PREDICATE, d.viaY2)
          ],
          // same sub-1 discount as cax-dw/cls-svf1, same reason (see CAX_DW_RULE_CONFIDENCE).
          ...premiseTrusts.length ? { premiseTrusts, ruleConfidence: SCM_SVF_RULE_CONFIDENCE } : {}
        };
      })
    ];
    const { ids } = await appendFacts2(repoDir, toWrite);
    const written = [];
    let i = 0;
    for (const d of scmDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.via, rule: SYLLOGISE_RULE });
      i += 1;
    }
    for (const d of caxDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.via, rule: CAX_SCO_RULE });
      i += 1;
    }
    for (const d of dwDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaClass, rule: CAX_DW_RULE });
      i += 1;
    }
    for (const d of svf1Derived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaValue, rule: CLS_SVF1_RULE });
      i += 1;
    }
    for (const d of scmSvfDerived) {
      written.push({ id: ids[i], subject: d.subject, object: d.object, via: d.viaY1, rule: SCM_SVF_RULE });
      i += 1;
    }
    return { derived: written, count: written.length, budget, depth, truncated: written.length >= budget };
  }
  function isPurelyEntailed(provenance) {
    const tags = String(provenance || "").split(" | ").filter(Boolean);
    return tags.length > 0 && tags.every((t) => t.startsWith("entailed:"));
  }
  function buildSurvivorDerivabilityCheck(rows) {
    const subClassEdges = [];
    const typesOf = /* @__PURE__ */ new Map();
    const disjointOf = /* @__PURE__ */ new Map();
    const onPropertyOf = /* @__PURE__ */ new Map();
    const someValuesFromOf = /* @__PURE__ */ new Map();
    const propertyEdgesOf = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const pLower = String(r.predicate || "").trim().toLowerCase();
      if (isSubClassOf(r.predicate)) subClassEdges.push([r.subject, r.object]);
      else if (isType(r.predicate)) {
        if (!typesOf.has(r.subject)) typesOf.set(r.subject, /* @__PURE__ */ new Set());
        typesOf.get(r.subject).add(r.object);
      } else if (isDisjoint(r.predicate)) {
        if (!disjointOf.has(r.subject)) disjointOf.set(r.subject, /* @__PURE__ */ new Set());
        disjointOf.get(r.subject).add(r.object);
        if (!disjointOf.has(r.object)) disjointOf.set(r.object, /* @__PURE__ */ new Set());
        disjointOf.get(r.object).add(r.subject);
      } else if (isOnProperty(r.predicate)) onPropertyOf.set(r.subject, r.object);
      else if (isSomeValuesFrom(r.predicate)) someValuesFromOf.set(r.subject, r.object);
      else if (!RESERVED_PREDICATES.has(pLower)) {
        if (!propertyEdgesOf.has(r.subject)) propertyEdgesOf.set(r.subject, []);
        propertyEdgesOf.get(r.subject).push([normFactTerm(r.predicate), r.object]);
      }
    }
    const ancestorsOf2 = buildAncestorCloser(subClassEdges);
    const reaches = (a, b) => a !== b && ancestorsOf2(a).has(b);
    const restrictionOf = (node) => {
      const property = onPropertyOf.get(node);
      const target = someValuesFromOf.get(node);
      return property && target ? { property: normFactTerm(property), target } : null;
    };
    return (row) => {
      if (isSubClassOf(row.predicate)) {
        if (reaches(row.subject, row.object)) return true;
        const r1 = restrictionOf(row.subject);
        const r2 = restrictionOf(row.object);
        return Boolean(r1 && r2 && r1.property === r2.property && reaches(r1.target, r2.target));
      }
      if (isType(row.predicate)) {
        for (const c of typesOf.get(row.subject) || []) {
          if (reaches(c, row.object)) return true;
        }
        const rec = restrictionOf(row.object);
        if (rec) {
          for (const [pKey, y] of propertyEdgesOf.get(row.subject) || []) {
            if (pKey !== rec.property) continue;
            for (const c of typesOf.get(y) || []) {
              if (c === rec.target || reaches(c, rec.target)) return true;
            }
          }
        }
        return false;
      }
      if (isDisjoint(row.predicate)) {
        for (const c of typesOf.get(row.subject) || []) {
          for (const d of [c, ...ancestorsOf2(c)]) {
            if (disjointOf.get(d)?.has(row.object)) return true;
          }
        }
        return false;
      }
      return true;
    };
  }
  async function retractSubClassOf(repoDir, subject, object, { budget = 50, depth = 32, store } = {}) {
    const { loadMemory: loadMemory2, readFactRows: readFactRows2, removeFacts: removeFacts2 } = requireStore(store, ["loadMemory", "readFactRows", "removeFacts"], "retractSubClassOf");
    const s = normFactTerm(subject);
    const o = normFactTerm(object);
    const targetId = factIdForTriple(s, SUBCLASS_PREDICATE, o);
    const memory = await loadMemory2(repoDir);
    const rows = readFactRows2(memory);
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (!byId.has(targetId)) return { retracted: [], count: 0, budget, depth, truncated: false, found: false };
    const entailedRows = rows.filter((r) => r.justification.length && isPurelyEntailed(r.provenance));
    const removed = /* @__PURE__ */ new Set([targetId]);
    const order = [targetId];
    let truncated = false;
    let round2 = 0;
    for (; round2 < depth; round2 += 1) {
      const candidates = entailedRows.filter((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j))).sort((a, b) => a.subject.localeCompare(b.subject) || a.predicate.localeCompare(b.predicate) || a.object.localeCompare(b.object));
      if (!candidates.length) break;
      const candidateIds = new Set(candidates.map((c) => c.id));
      const stillDerivable = buildSurvivorDerivabilityCheck(
        rows.filter((r) => !removed.has(r.id) && !candidateIds.has(r.id))
      );
      let progressed = false;
      let hitBudget = false;
      for (const c of candidates) {
        if (removed.size >= budget) {
          hitBudget = true;
          break;
        }
        if (stillDerivable(c)) continue;
        removed.add(c.id);
        order.push(c.id);
        progressed = true;
      }
      if (hitBudget) {
        truncated = true;
        break;
      }
      if (!progressed) break;
    }
    if (!truncated && round2 >= depth) {
      truncated = entailedRows.some((r) => !removed.has(r.id) && r.justification.some((j) => removed.has(j)));
    }
    const { removed: actuallyRemoved } = await removeFacts2(repoDir, order);
    return { retracted: actuallyRemoved, count: actuallyRemoved.length, budget, depth, truncated, found: true };
  }
  function findIsaChain(subj, targets, typeEdges, subClassEdges, { maxHops = 6 } = {}) {
    const targetSet = targets instanceof Set ? targets : new Set(targets || []);
    const subSucc = /* @__PURE__ */ new Map();
    for (const [a, b] of subClassEdges || []) {
      if (!a || !b || a === b) continue;
      if (!subSucc.has(a)) subSucc.set(a, /* @__PURE__ */ new Set());
      subSucc.get(a).add(b);
    }
    let frontier = [];
    for (const [x, c] of typeEdges || []) {
      if (x === subj && c) frontier.push({ node: c, path: [{ subject: x, predicate: TYPE_PREDICATE, object: c }] });
    }
    for (const c of subSucc.get(subj) || []) {
      frontier.push({ node: c, path: [{ subject: subj, predicate: SUBCLASS_PREDICATE, object: c }] });
    }
    const seen = /* @__PURE__ */ new Set([subj]);
    for (let hop = 1; hop <= maxHops && frontier.length; hop += 1) {
      for (const { node, path } of frontier) if (targetSet.has(node)) return path;
      if (hop === maxHops) break;
      const next = [];
      for (const { node, path } of frontier) {
        if (seen.has(node)) continue;
        seen.add(node);
        for (const c of subSucc.get(node) || []) {
          if (seen.has(c)) continue;
          next.push({ node: c, path: [...path, { subject: node, predicate: SUBCLASS_PREDICATE, object: c }] });
        }
      }
      frontier = next;
    }
    return null;
  }
  var SUBCLASS_PREDICATE, SYLLOGISE_RULE, ENTAILED_PROVENANCE, TYPE_PREDICATE, CAX_SCO_RULE, ENTAILED_TYPE_PROVENANCE, DISJOINT_PREDICATE, CAX_DW_RULE, ENTAILED_DISJOINT_PROVENANCE, CAX_DW_RULE_CONFIDENCE, ON_PROPERTY_PREDICATE, SOME_VALUES_FROM_PREDICATE, CLS_SVF1_RULE, ENTAILED_SVF1_PROVENANCE, CLS_SVF1_RULE_CONFIDENCE, SEP, isSubClassOf, isType, isDisjoint, isOnProperty, isSomeValuesFrom, isOnClass, RESERVED_PREDICATES, HAS_PROPERTY_KEY, CARDINALITY_KIND_OF, SCM_SVF_RULE, ENTAILED_SCM_SVF_PROVENANCE, SCM_SVF_RULE_CONFIDENCE, CARDINALITY_RULE_CONFIDENCE, CAX_MAXC0_RULE_CONFIDENCE;
  var init_syllogise = __esm({
    "src/domain/syllogise.mjs"() {
      init_hash();
      SUBCLASS_PREDICATE = "rdfs:subClassOf";
      SYLLOGISE_RULE = "subClassOf";
      ENTAILED_PROVENANCE = `entailed:${SYLLOGISE_RULE}`;
      TYPE_PREDICATE = "rdf:type";
      CAX_SCO_RULE = "type";
      ENTAILED_TYPE_PROVENANCE = `entailed:${CAX_SCO_RULE}`;
      DISJOINT_PREDICATE = "owl:disjointWith";
      CAX_DW_RULE = "disjointWith";
      ENTAILED_DISJOINT_PROVENANCE = `entailed:${CAX_DW_RULE}`;
      CAX_DW_RULE_CONFIDENCE = 0.95;
      ON_PROPERTY_PREDICATE = "owl:onProperty";
      SOME_VALUES_FROM_PREDICATE = "owl:someValuesFrom";
      CLS_SVF1_RULE = "someValuesFrom";
      ENTAILED_SVF1_PROVENANCE = `entailed:${CLS_SVF1_RULE}`;
      CLS_SVF1_RULE_CONFIDENCE = 0.95;
      SEP = "\u241F";
      isSubClassOf = (p) => String(p || "").trim().toLowerCase() === "rdfs:subclassof";
      isType = (p) => String(p || "").trim().toLowerCase() === "rdf:type";
      isDisjoint = (p) => String(p || "").trim().toLowerCase() === "owl:disjointwith";
      isOnProperty = (p) => String(p || "").trim().toLowerCase() === "owl:onproperty";
      isSomeValuesFrom = (p) => String(p || "").trim().toLowerCase() === "owl:somevaluesfrom";
      isOnClass = (p) => String(p || "").trim().toLowerCase() === "owl:onclass";
      RESERVED_PREDICATES = /* @__PURE__ */ new Set([
        "rdfs:subclassof",
        "rdf:type",
        "owl:disjointwith",
        "owl:onproperty",
        "owl:somevaluesfrom",
        "owl:intersectionof"
      ]);
      HAS_PROPERTY_KEY = "has";
      CARDINALITY_KIND_OF = { "owl:cardinality": "exactly", "owl:mincardinality": "min", "owl:maxcardinality": "max" };
      SCM_SVF_RULE = "someValuesFromSubsumption";
      ENTAILED_SCM_SVF_PROVENANCE = `entailed:${SCM_SVF_RULE}`;
      SCM_SVF_RULE_CONFIDENCE = 0.95;
      CARDINALITY_RULE_CONFIDENCE = 0.95;
      CAX_MAXC0_RULE_CONFIDENCE = 0.95;
    }
  });

  // src/domain/memory/capability.mjs
  function negatedPredicate(predicate) {
    const p = String(predicate || "");
    if (!p.startsWith(POSITIVE_PREDICATE_PREFIX)) return p;
    return NEG_PREDICATE_PREFIX + p.slice(POSITIVE_PREDICATE_PREFIX.length);
  }
  function positivePredicate(predicate) {
    const p = String(predicate || "");
    if (!p.startsWith(NEG_PREDICATE_PREFIX)) return null;
    return POSITIVE_PREDICATE_PREFIX + p.slice(NEG_PREDICATE_PREFIX.length);
  }
  function shortestChainTo(subjects, target, typeEdges, subClassEdges, maxHops) {
    let best = null;
    for (const s of subjects) {
      if (s === target) return [];
      const chain = findIsaChain(s, /* @__PURE__ */ new Set([target]), typeEdges, subClassEdges, { maxHops });
      if (chain && (!best || chain.length < best.length)) best = chain;
    }
    return best;
  }
  function resolveCapabilityPolarity(subject, object, facts, { maxHops = 3 } = {}) {
    const subjects = asSet(subject);
    const objects = asSet(object);
    const rows = Array.isArray(facts) ? facts : [];
    const { typeEdges, subClassEdges } = isaEdgesOf(rows);
    const carriers = rows.filter(
      (f) => (f.predicate === CAPABLE_OF_PREDICATE || f.predicate === NEG_CAPABLE_OF_PREDICATE) && objects.has(f.object)
    );
    const candidates = [];
    for (const fact of carriers) {
      const polarity = fact.predicate === NEG_CAPABLE_OF_PREDICATE ? "negative" : "positive";
      if (subjects.has(fact.subject)) {
        candidates.push({ fact, polarity, hops: 0, chain: null });
        continue;
      }
      const chain = shortestChainTo(subjects, fact.subject, typeEdges, subClassEdges, maxHops);
      if (chain && chain.length) candidates.push({ fact, polarity, hops: chain.length, chain });
    }
    if (!candidates.length) {
      return {
        verdict: "none",
        hops: 0,
        positive: [],
        negative: [],
        chain: null,
        overrides: null,
        baseRate: capabilityBaseRate(subjects, objects, rows, { maxHops })
      };
    }
    candidates.sort((a, b) => a.hops - b.hops || (b.fact.trust || 0) - (a.fact.trust || 0));
    const hops = candidates[0].hops;
    const winning = candidates.filter((c) => c.hops === hops);
    const positive = winning.filter((c) => c.polarity === "positive").map((c) => c.fact);
    const negative = winning.filter((c) => c.polarity === "negative").map((c) => c.fact);
    const answered = negative.length && !positive.length ? "negative" : "positive";
    const beaten = candidates.find((c) => c.hops > hops && c.polarity !== answered) || null;
    return {
      verdict: positive.length && negative.length ? "both" : negative.length ? "no" : "yes",
      hops,
      positive,
      negative,
      chain: candidates[0].chain,
      overrides: beaten ? { fact: beaten.fact, chain: beaten.chain } : null,
      baseRate: null
    };
  }
  function capabilityBaseRate(subject, object, facts, { maxHops = 3 } = {}) {
    const subjects = asSet(subject);
    const objects = asSet(object);
    const rows = Array.isArray(facts) ? facts : [];
    const isaRows = rows.filter((f) => f.predicate === SUBCLASS_PREDICATE || f.predicate === TYPE_PREDICATE);
    const parents = isaRows.filter((f) => subjects.has(f.subject)).map((f) => f.object);
    if (!parents.length) return null;
    const klass = parents[0];
    const siblings = [...new Set(
      isaRows.filter((f) => f.object === klass && !subjects.has(f.subject)).map((f) => f.subject)
    )];
    const capabilityOf = (name) => {
      const hit2 = rows.find(
        (f) => f.subject === name && objects.has(f.object) && (f.predicate === CAPABLE_OF_PREDICATE || f.predicate === NEG_CAPABLE_OF_PREDICATE)
      );
      if (!hit2) return { name, polarity: "unknown", fact: null };
      return { name, polarity: hit2.predicate === NEG_CAPABLE_OF_PREDICATE ? "negative" : "positive", fact: hit2 };
    };
    const split = siblings.map(capabilityOf);
    const { typeEdges, subClassEdges } = isaEdgesOf(rows);
    return {
      klass,
      kinds: siblings.length,
      positive: split.filter((s) => s.polarity === "positive"),
      negative: split.filter((s) => s.polarity === "negative"),
      unknown: split.filter((s) => s.polarity === "unknown"),
      chain: shortestChainTo(subjects, klass, typeEdges, subClassEdges, maxHops)
    };
  }
  function capabilityExtension(object, facts, { exclude = [], maxHops = 3 } = {}) {
    const objects = asSet(object);
    const skip = asSet(exclude);
    const rows = Array.isArray(facts) ? facts : [];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const f of rows) {
      if (f.predicate !== CAPABLE_OF_PREDICATE || !objects.has(f.object)) continue;
      if (skip.has(f.subject) || seen.has(f.subject)) continue;
      seen.add(f.subject);
      if (resolveCapabilityPolarity(/* @__PURE__ */ new Set([f.subject]), objects, rows, { maxHops }).verdict !== "yes") continue;
      out.push(f);
    }
    return out.sort(byTrustThenName);
  }
  var NEG_PREDICATE_PREFIX, POSITIVE_PREDICATE_PREFIX, isNegatedPredicate, CAPABLE_OF_PREDICATE, NEG_CAPABLE_OF_PREDICATE, CAPABILITY_REPORT_CAP, byTrustThenName, asSet, isaEdgesOf;
  var init_capability = __esm({
    "src/domain/memory/capability.mjs"() {
      init_syllogise();
      NEG_PREDICATE_PREFIX = "mgxneg:";
      POSITIVE_PREDICATE_PREFIX = "mgx:";
      isNegatedPredicate = (predicate) => String(predicate || "").startsWith(NEG_PREDICATE_PREFIX);
      CAPABLE_OF_PREDICATE = "mgx:capableOf";
      NEG_CAPABLE_OF_PREDICATE = negatedPredicate(CAPABLE_OF_PREDICATE);
      CAPABILITY_REPORT_CAP = 6;
      byTrustThenName = (a, b) => (b.trust || 0) - (a.trust || 0) || String(a.subject).localeCompare(String(b.subject));
      asSet = (v) => v instanceof Set ? v : new Set(Array.isArray(v) ? v : [v]);
      isaEdgesOf = (facts) => ({
        typeEdges: facts.filter((f) => f.predicate === TYPE_PREDICATE).map((f) => [f.subject, f.object]),
        subClassEdges: facts.filter((f) => f.predicate === SUBCLASS_PREDICATE).map((f) => [f.subject, f.object])
      });
    }
  });

  // src/adapters/memory/shacl.mjs
  function attrValue(ind, prop) {
    const a = (ind?.attributes || []).find((x) => x?.prop === prop);
    return a ? String(a.value ?? "") : void 0;
  }
  function checkIndividual(ind, violations) {
    if (!ind?.class || !MEMORY_CLASSES.has(ind.class)) {
      violations.push(`must have a class from the closed vocabulary Utterance | Fact | Session | Source | Rule (got ${JSON.stringify(ind?.class)})`);
    }
  }
  function checkFact(ind, violations) {
    for (const prop of ["rdf:subject", "rdf:predicate", "rdf:object"]) {
      if (!nonEmpty(attrValue(ind, prop))) violations.push(`a Fact needs a non-empty ${prop}`);
    }
    for (const prop of ["rdf:subject", "rdf:object"]) {
      const term = attrValue(ind, prop);
      if (term !== void 0 && SPANS_A_SENTENCE_BOUNDARY_RE.test(term)) {
        violations.push(`a Fact's ${prop} must be a single term, not text spanning a sentence boundary (got ${JSON.stringify(term)})`);
      }
    }
    const prov = attrValue(ind, "mgx:factProvenance");
    if (prov !== void 0 && !nonEmpty(prov)) violations.push("mgx:factProvenance, when present, must be non-empty");
  }
  function checkRule(ind, violations) {
    if (!nonEmpty(attrValue(ind, "mgx:ruleName"))) violations.push("a Rule needs a non-empty mgx:ruleName");
    const kind = attrValue(ind, "mgx:ruleKind");
    if (!kind || !RULE_KINDS.has(kind)) {
      violations.push(`a Rule's mgx:ruleKind must be one of ${[...RULE_KINDS].join(" | ")} (got ${JSON.stringify(kind)})`);
      return;
    }
    for (const prop of RULE_SLOT_PROPS[kind]) {
      if (!nonEmpty(attrValue(ind, prop))) violations.push(`a ${kind} Rule needs a non-empty ${prop}`);
    }
  }
  function validateIndividual(ind) {
    const violations = [];
    checkIndividual(ind, violations);
    if (ind?.class === "Fact") checkFact(ind, violations);
    if (ind?.class === "Rule") checkRule(ind, violations);
    return { ok: violations.length === 0, violations };
  }
  function assertIndividualValid(ind) {
    const r = validateIndividual(ind);
    if (!r.ok) {
      const e = new Error(`SHACL validation failed for ${ind?.class} "${ind?.id}": ${r.violations.join(" | ")}`);
      e.violations = r.violations;
      throw e;
    }
  }
  var MEMORY_CLASSES, RULE_KINDS, RULE_SLOT_PROPS, SPANS_A_SENTENCE_BOUNDARY_RE, nonEmpty;
  var init_shacl = __esm({
    "src/adapters/memory/shacl.mjs"() {
      MEMORY_CLASSES = /* @__PURE__ */ new Set(["Utterance", "Fact", "Session", "Source", "Rule"]);
      RULE_KINDS = /* @__PURE__ */ new Set([
        "compose2",
        "filter",
        "recursive",
        "action-signature",
        "action-precond",
        "action-effect",
        "action-constraint"
      ]);
      RULE_SLOT_PROPS = {
        compose2: ["mgx:ruleBase1", "mgx:ruleBase2"],
        filter: ["mgx:ruleBase1", "mgx:ruleFilterProperty"],
        recursive: ["mgx:ruleBaseCase", "mgx:ruleRecStep"],
        "action-signature": ["mgx:ruleActionSubjectClass", "mgx:ruleActionTargetClass"],
        "action-precond": [
          "mgx:ruleActionPrecondShape",
          "mgx:ruleActionPrecondPredicate",
          "mgx:ruleActionPrecondRole",
          "mgx:ruleActionPrecondScope"
        ],
        "action-effect": [
          "mgx:ruleActionEffectPredicate",
          "mgx:ruleActionEffectSubject",
          "mgx:ruleActionEffectObject"
        ],
        "action-constraint": [
          "mgx:ruleActionConstraintLeft",
          "mgx:ruleActionConstraintRight",
          "mgx:ruleActionConstraintGuard"
        ]
      };
      SPANS_A_SENTENCE_BOUNDARY_RE = /[.!?]\s+\w/;
      nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
    }
  });

  // node-stub:node:sqlite
  var node_sqlite_exports = {};
  __export(node_sqlite_exports, {
    appendFile: () => appendFile3,
    basename: () => basename2,
    copyFile: () => copyFile3,
    createInterface: () => createInterface3,
    createReadStream: () => createReadStream3,
    createRequire: () => createRequire3,
    createWriteStream: () => createWriteStream3,
    default: () => node_sqlite_default,
    dirname: () => dirname2,
    existsSync: () => existsSync,
    fileURLToPath: () => fileURLToPath,
    isAbsolute: () => isAbsolute,
    join: () => join2,
    mkdir: () => mkdir3,
    mkdtemp: () => mkdtemp3,
    randomBytes: () => randomBytes3,
    readFile: () => readFile3,
    readFileSync: () => readFileSync3,
    readdir: () => readdir3,
    rename: () => rename3,
    resolve: () => resolve2,
    rm: () => rm3,
    sep: () => sep2,
    spawnSync: () => spawnSync3,
    stat: () => stat3,
    tmpdir: () => tmpdir,
    unlink: () => unlink3,
    writeFile: () => writeFile3
  });
  var unavailable3, createRequire3, readFileSync3, readFile3, writeFile3, appendFile3, mkdir3, mkdtemp3, rename3, unlink3, rm3, stat3, copyFile3, readdir3, createReadStream3, createWriteStream3, existsSync, join2, dirname2, resolve2, isAbsolute, basename2, sep2, fileURLToPath, randomBytes3, spawnSync3, createInterface3, tmpdir, node_sqlite_default;
  var init_node_sqlite = __esm({
    "node-stub:node:sqlite"() {
      unavailable3 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire3 = unavailable3("createRequire");
      readFileSync3 = unavailable3("readFileSync");
      readFile3 = unavailable3("readFile");
      writeFile3 = unavailable3("writeFile");
      appendFile3 = unavailable3("appendFile");
      mkdir3 = unavailable3("mkdir");
      mkdtemp3 = unavailable3("mkdtemp");
      rename3 = unavailable3("rename");
      unlink3 = unavailable3("unlink");
      rm3 = unavailable3("rm");
      stat3 = unavailable3("stat");
      copyFile3 = unavailable3("copyFile");
      readdir3 = unavailable3("readdir");
      createReadStream3 = unavailable3("createReadStream");
      createWriteStream3 = unavailable3("createWriteStream");
      existsSync = () => false;
      join2 = (...a) => a.join("/");
      dirname2 = (p) => String(p).replace(/\/[^/]*$/, "");
      resolve2 = (...a) => a.join("/");
      isAbsolute = (p) => String(p).startsWith("/");
      basename2 = (p) => String(p).split("/").pop();
      sep2 = "/";
      fileURLToPath = (u) => String(u);
      randomBytes3 = unavailable3("randomBytes");
      spawnSync3 = unavailable3("spawnSync");
      createInterface3 = unavailable3("createInterface");
      tmpdir = () => "/tmp";
      node_sqlite_default = {};
    }
  });

  // src/adapters/memory/core.mjs
  var core_exports = {};
  __export(core_exports, {
    CANONICALISED_FROM_PROP: () => CANONICALISED_FROM_PROP,
    CAPABLE_OF_PREDICATE: () => CAPABLE_OF_PREDICATE2,
    CREATED_AT_PROP: () => CREATED_AT_PROP,
    DEFAULT_RETENTION: () => DEFAULT_RETENTION,
    FACT_CLASS: () => FACT_CLASS,
    HAS_A_PREDICATE: () => HAS_A_PREDICATE,
    IN_REPLY_TO_PROP: () => IN_REPLY_TO_PROP,
    MEMORY_DIR_REL: () => MEMORY_DIR_REL,
    MEMORY_GRAPH_REL: () => MEMORY_GRAPH_REL,
    MEMORY_MANIFEST_REL: () => MEMORY_MANIFEST_REL,
    MEMORY_SESSION_CLASS: () => MEMORY_SESSION_CLASS,
    MULTI_VALUED_PREDICATES: () => MULTI_VALUED_PREDICATES,
    OPERATOR_SOURCE_ID: () => OPERATOR_SOURCE_ID,
    RULE_CLASS: () => RULE_CLASS,
    RULE_KIND_ACTION_CONSTRAINT: () => RULE_KIND_ACTION_CONSTRAINT,
    RULE_KIND_ACTION_EFFECT: () => RULE_KIND_ACTION_EFFECT,
    RULE_KIND_ACTION_PRECOND: () => RULE_KIND_ACTION_PRECOND,
    RULE_KIND_ACTION_SIGNATURE: () => RULE_KIND_ACTION_SIGNATURE,
    RULE_KIND_COMPOSE2: () => RULE_KIND_COMPOSE2,
    RULE_KIND_FILTER: () => RULE_KIND_FILTER,
    RULE_KIND_PROP: () => RULE_KIND_PROP,
    RULE_KIND_RECURSIVE: () => RULE_KIND_RECURSIVE,
    SAID_IN_SESSION_PROP: () => SAID_IN_SESSION_PROP,
    SOURCE_CLASS: () => SOURCE_CLASS,
    SOURCE_RELIABILITY_PROP: () => SOURCE_RELIABILITY_PROP,
    STATED_BY_PROP: () => STATED_BY_PROP,
    UPDATED_AT_PROP: () => UPDATED_AT_PROP,
    UTTERANCE_CLASS: () => UTTERANCE_CLASS,
    appendFact: () => appendFact,
    appendFacts: () => appendFacts,
    appendRule: () => appendRule,
    appendUtterance: () => appendUtterance,
    appendUtterances: () => appendUtterances,
    closeSqliteMemoryStore: () => closeSqliteMemoryStore,
    createInMemoryStore: () => createInMemoryStore,
    createSqliteMemoryStore: () => createSqliteMemoryStore,
    emptyMemory: () => emptyMemory,
    factIdForTriple: () => factIdForTriple,
    findContradictions: () => findContradictions,
    findRuleByName: () => findRuleByName,
    findRulesByName: () => findRulesByName,
    loadMemory: () => loadMemory,
    normFactPredicate: () => normFactPredicate,
    normFactTerm: () => normFactTerm,
    openMemoryBackend: () => openMemoryBackend,
    provenanceTagToSource: () => provenanceTagToSource,
    readFactRows: () => readFactRows,
    readRuleRows: () => readRuleRows,
    removeFacts: () => removeFacts,
    resolveMemoryGraphFile: () => resolveMemoryGraphFile,
    resolveRelationChase: () => resolveRelationChase,
    resolveRelationChaseReverse: () => resolveRelationChaseReverse,
    snapshotMemory: () => snapshotMemory
  });
  function emptyMemory() {
    return {
      generated_at: "",
      memory: true,
      prefixes: {
        owl: "http://www.w3.org/2002/07/owl#",
        rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        rdfs: "http://www.w3.org/2000/01/rdf-schema#",
        mgx: "urn:tmct:mgx#",
        mgxneg: "urn:tmct:mgxneg#"
      },
      vocabulary: MEMORY_VOCABULARY.map((v) => ({ ...v })),
      classes: [],
      objectProperties: [],
      individuals: [],
      proseIndex: {}
    };
  }
  function resolveMemoryGraphFile(dir, version = null) {
    if (isMemoryHandle(dir) || isSqliteHandle(dir)) {
      throw new Error("resolveMemoryGraphFile: dir is a memory/sqlite handle, not a file path (Backend A only)");
    }
    if (version === null) return join(dir, MEMORY_GRAPH_REL);
    return join(dir, MEMORY_DIR_REL, `graph.v${version}.json`);
  }
  function isMemoryHandle(dir) {
    return !!dir && typeof dir === "object" && dir.backend === BACKEND_MEMORY;
  }
  function isSqliteHandle(dir) {
    return !!dir && typeof dir === "object" && dir.backend === BACKEND_SQLITE;
  }
  function isMemoryOrSqliteHandle(dir) {
    return isMemoryHandle(dir) || isSqliteHandle(dir);
  }
  function createInMemoryStore() {
    return { backend: BACKEND_MEMORY, payload: emptyMemory() };
  }
  async function createSqliteMemoryStore(dbPath) {
    const { DatabaseSync } = await Promise.resolve().then(() => (init_node_sqlite(), node_sqlite_exports));
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(SQLITE_DDL);
    return { backend: BACKEND_SQLITE, db, dbPath };
  }
  function closeSqliteMemoryStore(handle) {
    if (isSqliteHandle(handle)) handle.db.close();
  }
  async function openMemoryBackend(repoRoot, backendChoice) {
    if (backendChoice === BACKEND_MEMORY) {
      return { dir: createInMemoryStore(), close: async () => {
      } };
    }
    if (backendChoice === BACKEND_SQLITE) {
      const dbPath = join(repoRoot, ".tmct", "memory", "graph.sqlite");
      await mkdir2(dirname(dbPath), { recursive: true });
      const handle = await createSqliteMemoryStore(dbPath);
      return { dir: handle, close: async () => closeSqliteMemoryStore(handle) };
    }
    return { dir: repoRoot, close: async () => {
    } };
  }
  function readSqlitePayload(handle) {
    if (!handle.cachedPayload) handle.cachedPayload = buildSqlitePayloadFromRows(handle);
    return cloneJson(handle.cachedPayload);
  }
  function buildSqlitePayloadFromRows(handle) {
    const db = handle.db;
    const empty = emptyMemory();
    const getMeta = (k, fallback) => {
      const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
      return row ? JSON.parse(row.v) : fallback;
    };
    const individuals = db.prepare("SELECT json FROM individuals ORDER BY ord").all().map((r) => JSON.parse(r.json));
    const edgesForProp = db.prepare(
      "SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ? ORDER BY rowid"
    );
    const objectProperties = db.prepare("SELECT prop, predicate, count FROM relations ORDER BY ord").all().map((r) => ({
      predicate: r.predicate,
      prop: r.prop,
      count: r.count,
      examples: edgesForProp.all(r.prop).map((e) => {
        const edge = { subject: e.subject, object: e.object, subjectLabel: e.subject_label, objectLabel: e.object_label };
        if (e.extra) Object.assign(edge, JSON.parse(e.extra));
        return edge;
      })
    }));
    return {
      generated_at: getMeta("generated_at", empty.generated_at),
      memory: getMeta("memory", empty.memory),
      prefixes: getMeta("prefixes", empty.prefixes),
      vocabulary: getMeta("vocabulary", empty.vocabulary),
      classes: getMeta("classes", empty.classes),
      objectProperties,
      individuals,
      proseIndex: getMeta("proseIndex", empty.proseIndex)
    };
  }
  function cacheUpsertIndividual(cache2, ind) {
    const clone = cloneJson(ind);
    const i = cache2.individuals.findIndex((x) => x?.id === ind.id);
    if (i >= 0) cache2.individuals[i] = clone;
    else cache2.individuals.push(clone);
  }
  function cacheDropIndividualsExcept(cache2, seenIds) {
    cache2.individuals = cache2.individuals.filter((i) => seenIds.has(i?.id));
  }
  function cacheGroupFor(cache2, prop) {
    let g = cache2.objectProperties.find((x) => x?.prop === prop);
    if (!g) {
      g = { predicate: null, prop, count: 0, examples: [] };
      cache2.objectProperties.push(g);
    }
    return g;
  }
  function cacheUpsertEdge(group, edge, extraKeys) {
    const key = `${edge.subject}\0${edge.object}`;
    group.examples = group.examples.filter((e) => `${e.subject}\0${e.object}` !== key);
    const cached3 = {
      subject: edge.subject,
      object: edge.object,
      subjectLabel: edge.subjectLabel ?? null,
      objectLabel: edge.objectLabel ?? null
    };
    if (extraKeys.length) Object.assign(cached3, cloneJson(Object.fromEntries(extraKeys.map((k) => [k, edge[k]]))));
    group.examples.push(cached3);
  }
  function cacheDropEdgesExcept(group, newKeys) {
    group.examples = group.examples.filter((e) => newKeys.has(`${e.subject}\0${e.object}`));
  }
  function cacheDropGroupsExcept(cache2, seenProps) {
    cache2.objectProperties = cache2.objectProperties.filter((g) => seenProps.has(g?.prop));
  }
  function persistSqlitePayload(handle, payload) {
    const db = handle.db;
    const empty = emptyMemory();
    const cache2 = handle.cachedPayload || null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const setMeta = db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)");
      setMeta.run("generated_at", JSON.stringify(payload.generated_at ?? empty.generated_at));
      setMeta.run("memory", JSON.stringify(payload.memory ?? empty.memory));
      setMeta.run("prefixes", JSON.stringify(payload.prefixes ?? empty.prefixes));
      setMeta.run("vocabulary", JSON.stringify(payload.vocabulary ?? empty.vocabulary));
      setMeta.run("classes", JSON.stringify(payload.classes ?? empty.classes));
      setMeta.run("proseIndex", JSON.stringify(payload.proseIndex ?? empty.proseIndex));
      if (cache2) {
        cache2.generated_at = cloneJson(payload.generated_at ?? empty.generated_at);
        cache2.memory = cloneJson(payload.memory ?? empty.memory);
        cache2.prefixes = cloneJson(payload.prefixes ?? empty.prefixes);
        cache2.vocabulary = cloneJson(payload.vocabulary ?? empty.vocabulary);
        cache2.classes = cloneJson(payload.classes ?? empty.classes);
        cache2.proseIndex = cloneJson(payload.proseIndex ?? empty.proseIndex);
      }
      const getInd = db.prepare("SELECT ord, json FROM individuals WHERE id = ?");
      const maxOrd = db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM individuals").get().m;
      let nextOrd = maxOrd + 1;
      const upsertInd = db.prepare("INSERT OR REPLACE INTO individuals(id, ord, class, label, json) VALUES (?, ?, ?, ?, ?)");
      const seenIds = /* @__PURE__ */ new Set();
      for (const ind of payload.individuals || []) {
        seenIds.add(ind.id);
        const json = JSON.stringify(ind);
        const existing = getInd.get(ind.id);
        if (existing && existing.json === json) continue;
        const ord = existing ? existing.ord : nextOrd++;
        upsertInd.run(ind.id, ord, ind.class ?? null, ind.label ?? null, json);
        if (cache2) cacheUpsertIndividual(cache2, ind);
      }
      const deleteInd = db.prepare("DELETE FROM individuals WHERE id = ?");
      for (const row of db.prepare("SELECT id FROM individuals").all()) {
        if (!seenIds.has(row.id)) deleteInd.run(row.id);
      }
      if (cache2) cacheDropIndividualsExcept(cache2, seenIds);
      const getRelOrd = db.prepare("SELECT ord FROM relations WHERE prop = ?");
      const maxRelOrd = db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM relations").get().m;
      let nextRelOrd = maxRelOrd + 1;
      const upsertRel = db.prepare("INSERT OR REPLACE INTO relations(prop, ord, predicate, count) VALUES (?, ?, ?, ?)");
      const edgesForProp = db.prepare("SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ?");
      const upsertEdge2 = db.prepare("INSERT OR REPLACE INTO edges(prop, subject, object, subject_label, object_label, extra) VALUES (?, ?, ?, ?, ?, ?)");
      const deleteEdge = db.prepare("DELETE FROM edges WHERE prop = ? AND subject = ? AND object = ?");
      const seenProps = /* @__PURE__ */ new Set();
      for (const group of payload.objectProperties || []) {
        seenProps.add(group.prop);
        const existingRows = edgesForProp.all(group.prop);
        const existingByKey = new Map(existingRows.map((r) => [`${r.subject}\0${r.object}`, r]));
        const newKeys = /* @__PURE__ */ new Set();
        const cacheGroup = cache2 ? cacheGroupFor(cache2, group.prop) : null;
        for (const e of group.examples || []) {
          const key = `${e.subject}\0${e.object}`;
          newKeys.add(key);
          const extraKeys = Object.keys(e).filter((k) => !STD_EDGE_KEYS.has(k));
          const extra = extraKeys.length ? JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, e[k]]))) : null;
          const existing = existingByKey.get(key);
          const unchanged = existing && (existing.subject_label ?? null) === (e.subjectLabel ?? null) && (existing.object_label ?? null) === (e.objectLabel ?? null) && (existing.extra ?? null) === (extra ?? null);
          if (unchanged) continue;
          upsertEdge2.run(group.prop, e.subject, e.object, e.subjectLabel ?? null, e.objectLabel ?? null, extra);
          if (cacheGroup) cacheUpsertEdge(cacheGroup, e, extraKeys);
        }
        for (const key of existingByKey.keys()) {
          if (newKeys.has(key)) continue;
          const [s, o] = key.split("\0");
          deleteEdge.run(group.prop, s, o);
        }
        if (cacheGroup) cacheDropEdgesExcept(cacheGroup, newKeys);
        const relCount = Number.isFinite(group.count) ? group.count : (group.examples || []).length;
        const relOrd = getRelOrd.get(group.prop)?.ord ?? nextRelOrd++;
        upsertRel.run(group.prop, relOrd, group.predicate ?? null, relCount);
        if (cacheGroup) {
          cacheGroup.predicate = group.predicate ?? null;
          cacheGroup.count = relCount;
        }
      }
      for (const row of db.prepare("SELECT prop FROM relations").all()) {
        if (seenProps.has(row.prop)) continue;
        db.prepare("DELETE FROM edges WHERE prop = ?").run(row.prop);
        db.prepare("DELETE FROM relations WHERE prop = ?").run(row.prop);
      }
      if (cache2) cacheDropGroupsExcept(cache2, seenProps);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      handle.cachedPayload = void 0;
      throw e;
    }
  }
  async function atomicWriteText(file, text) {
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    await writeFile2(tmp, text);
    await rename2(tmp, file);
  }
  async function atomicWriteJson(file, obj) {
    await atomicWriteText(file, JSON.stringify(obj));
  }
  async function snapshotMemory(dir, { retentionVersions } = {}) {
    if (isMemoryOrSqliteHandle(dir)) {
      throw new Error("snapshotMemory only supports the flat-JSON backend (Backend A) \u2014 a memory/sqlite handle has no on-disk graph.json to snapshot");
    }
    const graphFile = resolveMemoryGraphFile(dir);
    let graphText;
    try {
      graphText = await readFile2(graphFile, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return { skipped: true, version: null, prunedVersion: null };
      throw e;
    }
    const manifestFile = resolveManifestFile(dir);
    let manifest;
    try {
      manifest = JSON.parse(await readFile2(manifestFile, "utf8"));
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
      manifest = { version: 0, retentionVersions: retentionVersions ?? DEFAULT_RETENTION };
    }
    if (!Number.isInteger(manifest.version)) manifest.version = 0;
    if (!Number.isInteger(manifest.retentionVersions)) manifest.retentionVersions = retentionVersions ?? DEFAULT_RETENTION;
    const v = manifest.version;
    const versionedFile = resolveMemoryGraphFile(dir, v);
    await mkdir2(dirname(versionedFile), { recursive: true });
    await atomicWriteText(versionedFile, graphText);
    manifest.version = v + 1;
    let prunedVersion = null;
    const pruneTarget = v - manifest.retentionVersions;
    if (pruneTarget >= 0) {
      try {
        await unlink2(resolveMemoryGraphFile(dir, pruneTarget));
        prunedVersion = pruneTarget;
      } catch (e) {
        if (e?.code !== "ENOENT") throw e;
      }
    }
    await atomicWriteJson(manifestFile, manifest);
    return { skipped: false, version: v, prunedVersion };
  }
  async function loadMemory(dir) {
    if (isMemoryHandle(dir)) return dir.payload;
    if (isSqliteHandle(dir)) return readSqlitePayload(dir);
    let text;
    try {
      text = await readFile2(memoryGraphFile(dir), "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return emptyMemory();
      throw e;
    }
    return JSON.parse(text);
  }
  async function persistMemory(dir, payload) {
    if (isMemoryHandle(dir)) {
      dir.payload = payload;
      return;
    }
    if (isSqliteHandle(dir)) {
      persistSqlitePayload(dir, payload);
      return;
    }
    await mkdir2(dirname(memoryGraphFile(dir)), { recursive: true });
    await atomicWriteJson(memoryGraphFile(dir), payload);
  }
  function buildMemoryIndex(payload) {
    const individualsById = /* @__PURE__ */ new Map();
    const sourcesById = /* @__PURE__ */ new Map();
    const statedByBySubject = /* @__PURE__ */ new Map();
    for (const ind of payload.individuals || []) {
      if (!ind?.id) continue;
      individualsById.set(ind.id, ind);
      if (ind.class === SOURCE_CLASS) sourcesById.set(ind.id, ind);
    }
    const statedGroup = (payload.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
    for (const e of statedGroup?.examples || []) {
      if (!e?.subject) continue;
      const list = statedByBySubject.get(e.subject);
      if (list) list.push(e.object);
      else statedByBySubject.set(e.subject, [e.object]);
    }
    payload[MEMORY_INDEX] = { individualsById, sourcesById, statedByBySubject };
    return payload[MEMORY_INDEX];
  }
  async function mutateMemory(dir, fn) {
    const payload = await loadMemory(dir);
    buildMemoryIndex(payload);
    const out = await fn(payload) ?? payload;
    migrateLegacyProvenance(out);
    recomputeSourceReliability(out);
    out.proseIndex = buildProseIndex(out.individuals);
    await persistMemory(dir, out);
    return out;
  }
  function firstWriteCreatedAt(prior, candidate) {
    return prior?.attributes?.find((a) => a?.prop === CREATED_AT_PROP)?.value || candidate || nowIso();
  }
  function setAttr(ind, prop, key, value) {
    ind.attributes = (ind.attributes || []).filter((a) => a?.prop !== prop);
    ind.attributes.push({ prop, key, value });
  }
  function sourceIdFor(desc) {
    switch (desc?.kind) {
      case "operator":
        return { id: desc.sessionId ? `${OPERATOR_SOURCE_ID}:${desc.sessionId}` : OPERATOR_SOURCE_ID, type: "operator" };
      case "teach":
        return { id: desc.sessionId ? `${TEACH_SOURCE_ID}:${desc.sessionId}` : TEACH_SOURCE_ID, type: "teach" };
      case "provider":
        return { id: `src:provider:${desc.name}`, type: "provider" };
      case "corpus":
        return { id: `src:corpus:${desc.name}`, type: "corpus" };
      // One Source per source-file basename, not per extraction run.
      case "extracted":
        return { id: `src:extracted:${desc.name}`, type: "extracted" };
      case "web":
        return { id: `src:learned:web:${fnv1aHex(String(desc.url || ""))}`, type: "web", url: String(desc.url || "") };
      case "entailed":
        return { id: `src:entailed:${desc.rule}`, type: "entailed", rule: String(desc.rule || "") };
      default:
        return null;
    }
  }
  function upsertSource(payload, desc, createdAtCandidate) {
    const info = sourceIdFor(desc);
    if (!info) return null;
    const idx = memoryIndexOf(payload);
    const prior = idx ? idx.individualsById.get(info.id) : payload.individuals.find((i) => i?.id === info.id);
    const created = firstWriteCreatedAt(prior, desc?.createdAt || createdAtCandidate);
    const ind = {
      id: info.id,
      label: sourceLabel(info.id),
      class: SOURCE_CLASS,
      derived_from: [],
      mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: "mgx:sourceType", key: "sourceType", value: info.type },
        { prop: CREATED_AT_PROP, key: "createdAt", value: created },
        ...info.url ? [{ prop: "mgx:sourceUrl", key: "sourceUrl", value: info.url }] : [],
        ...info.rule ? [{ prop: "mgx:sourceRule", key: "sourceRule", value: info.rule }] : []
      ]
    };
    const stored = upsertIndividual(payload, ind);
    if (idx) idx.sourcesById.set(info.id, stored);
    return info.id;
  }
  function sourcesByIdMap(payload) {
    const idx = memoryIndexOf(payload);
    const m = {};
    if (idx) {
      for (const [id, ind] of idx.sourcesById) m[id] = ind;
      return m;
    }
    for (const i of payload.individuals) if (i?.class === SOURCE_CLASS) m[i.id] = i;
    return m;
  }
  function statedByObjectsFor(payload, factId) {
    const idx = memoryIndexOf(payload);
    if (idx) return (idx.statedByBySubject.get(factId) || []).slice();
    const g = payload.objectProperties.find((x) => x?.prop === STATED_BY_PROP);
    return (g?.examples || []).filter((e) => e?.subject === factId).map((e) => e.object);
  }
  function recomputeFactTrust(payload, fact, nowMs = Date.now(), trustOpts = {}) {
    const sourceIds = statedByObjectsFor(payload, fact.id);
    const createdAt = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || "";
    const { score, inputs } = computeTrust({ sourceIds, createdAt }, sourcesByIdMap(payload), {
      now: nowMs,
      ...Array.isArray(trustOpts?.premiseTrusts) ? { premiseTrusts: trustOpts.premiseTrusts } : {},
      ...typeof trustOpts?.ruleConfidence === "number" ? { ruleConfidence: trustOpts.ruleConfidence } : {}
    });
    setAttr(fact, TRUST_SCORE_PROP, "trustScore", String(score));
    setAttr(fact, TRUST_INPUTS_PROP, "trustInputs", JSON.stringify(inputs));
    setAttr(fact, UPDATED_AT_PROP, "updatedAt", new Date(nowMs).toISOString());
  }
  function syncFactSources(payload, fact, nowMs = Date.now(), trustOpts = {}) {
    const prov = (fact.attributes || []).find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    const factCreated = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || new Date(nowMs).toISOString();
    for (const tag of prov.split(" | ").filter(Boolean)) {
      const desc = provenanceTagToSource(tag);
      if (!desc) continue;
      const sid = upsertSource(payload, desc, factCreated);
      if (!sid) continue;
      upsertEdge(payload, { predicate: "statedBy", prop: STATED_BY_PROP }, {
        subject: fact.id,
        object: sid,
        subjectLabel: fact.label,
        objectLabel: sourceLabel(sid)
      });
    }
    recomputeFactTrust(payload, fact, nowMs, trustOpts);
  }
  function migrateLegacyProvenance(payload) {
    if (!Array.isArray(payload?.individuals) || !Array.isArray(payload?.objectProperties)) return;
    const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
    const haveEdge = new Set((statedGroup?.examples || []).map((e) => e.subject));
    let changed = false;
    const now = Date.now();
    for (const ind of payload.individuals) {
      if (ind?.class !== FACT_CLASS) continue;
      if (haveEdge.has(ind.id)) continue;
      const prov = (ind.attributes || []).find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      if (!prov) continue;
      syncFactSources(payload, ind, now);
      changed = true;
    }
    if (changed) recountClasses(payload);
  }
  function recomputeSourceReliability(payload) {
    if (!Array.isArray(payload?.individuals) || !Array.isArray(payload?.objectProperties)) return;
    const rows = readFactRows(payload);
    const contradictedFactIds = /* @__PURE__ */ new Set();
    for (const group of findContradictions(payload)) for (const r of group) contradictedFactIds.add(r.id);
    const bySource = /* @__PURE__ */ new Map();
    for (const row of rows) {
      for (const sid of row.sourceIds) {
        if (!isSessionScopedSourceId(sid)) continue;
        const bucket = bySource.get(sid) || { factsAsserted: 0, factsContradicted: 0 };
        bucket.factsAsserted += 1;
        if (contradictedFactIds.has(row.id)) bucket.factsContradicted += 1;
        bySource.set(sid, bucket);
      }
    }
    if (!bySource.size) return;
    const idx = memoryIndexOf(payload);
    for (const [sid, counts] of bySource) {
      const source = idx ? idx.individualsById.get(sid) : payload.individuals.find((i) => i?.id === sid);
      if (!source) continue;
      setAttr(source, SOURCE_RELIABILITY_PROP, "sourceReliability", String(sessionReliabilityFrom(counts)));
      setAttr(source, UPDATED_AT_PROP, "updatedAt", (/* @__PURE__ */ new Date()).toISOString());
    }
    const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
    const affected = /* @__PURE__ */ new Set();
    for (const e of statedGroup?.examples || []) if (bySource.has(e?.object)) affected.add(e.subject);
    for (const id of affected) {
      const ind = idx ? idx.individualsById.get(id) : payload.individuals.find((i) => i?.id === id);
      if (ind) recomputeFactTrust(payload, ind);
    }
  }
  function upsertIndividual(payload, ind) {
    const idx = memoryIndexOf(payload);
    if (idx) {
      const prior = idx.individualsById.get(ind.id);
      if (prior) {
        Object.assign(prior, ind);
        return prior;
      }
      payload.individuals.push(ind);
      idx.individualsById.set(ind.id, ind);
      return ind;
    }
    const i = payload.individuals.findIndex((x) => x?.id === ind.id);
    if (i >= 0) {
      payload.individuals[i] = ind;
      return ind;
    }
    payload.individuals.push(ind);
    return ind;
  }
  function upsertEdge(payload, { predicate, prop }, edge) {
    let group = payload.objectProperties.find((g) => g?.prop === prop);
    if (!group) {
      group = { predicate, prop, count: 0, examples: [] };
      payload.objectProperties.push(group);
    }
    const idx = prop === STATED_BY_PROP ? memoryIndexOf(payload) : null;
    if (idx) {
      const existing = idx.statedByBySubject.get(edge.subject);
      if (!existing || !existing.includes(edge.object)) {
        group.examples.push({ ...edge, createdAt: edge.createdAt || nowIso() });
        group.count = group.examples.length;
        if (existing) existing.push(edge.object);
        else idx.statedByBySubject.set(edge.subject, [edge.object]);
        return;
      }
    }
    const prior = (group.examples || []).find((e) => e?.subject === edge.subject && e?.object === edge.object);
    const createdAt = prior?.createdAt || edge.createdAt || nowIso();
    group.examples = (group.examples || []).filter(
      (e) => !(e?.subject === edge.subject && e?.object === edge.object)
    );
    group.examples.push({ ...edge, createdAt });
    group.count = group.examples.length;
    if (idx) {
      const list = idx.statedByBySubject.get(edge.subject) || [];
      if (!list.includes(edge.object)) list.push(edge.object);
      idx.statedByBySubject.set(edge.subject, list);
    }
  }
  function recountClasses(payload) {
    const names = [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, RULE_CLASS];
    payload.classes = payload.classes.filter((c) => !names.includes(c?.name));
    for (const name of names) {
      const of = payload.individuals.filter((i) => i?.class === name);
      if (of.length) payload.classes.push({ name, count: of.length, sample: of.slice(0, 3).map((i) => i.label) });
    }
  }
  function ensureSession(payload, sessionId, started = "") {
    const sid = `session:${sessionId}`;
    if (payload.individuals.some((i) => i?.id === sid)) return sid;
    payload.individuals.push({
      id: sid,
      label: String(sessionId).slice(0, 8),
      class: MEMORY_SESSION_CLASS,
      derived_from: [],
      mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: CREATED_AT_PROP, key: "createdAt", value: started || nowIso() },
        ...started ? [{ prop: "mgx:sessionStarted", key: "started", value: started }] : []
      ]
    });
    return sid;
  }
  function putUtterance(payload, { role, text, ts, sessionId, sessionStarted = "", parsed = null, replyTo = null, createdAt = "" }) {
    if (!ROLES.has(role)) throw new Error(`utterance role must be "visitor" or "tmct", got ${JSON.stringify(role)}`);
    if (!sessionId) throw new Error("utterance needs a sessionId");
    const cleanTs = String(ts || "");
    const cleanText = normText(text);
    const id = `utt:${sessionId}#${cleanTs}#${role}`;
    const label = labelOf(cleanText) || (role === "visitor" ? "a-visitor-said" : "a-tmct-said");
    const tokens = proseTokensFor({ doc: cleanText });
    const prior = payload.individuals.find((x) => x?.id === id);
    const createdAtVal = firstWriteCreatedAt(prior, createdAt || cleanTs);
    const ind = {
      id,
      label,
      class: UTTERANCE_CLASS,
      derived_from: [],
      mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: "mgx:utteranceRole", key: "role", value: role },
        { prop: "mgx:utteranceText", key: "text", value: cleanText },
        { prop: "mgx:utteranceTs", key: "ts", value: cleanTs },
        { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
        ...parsed != null ? [{ prop: "mgx:utteranceParsed", key: "parsed", value: JSON.stringify(parsed) }] : [],
        ...tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : []
      ]
    };
    upsertIndividual(payload, ind);
    const sid = ensureSession(payload, sessionId, sessionStarted);
    upsertEdge(payload, { predicate: "saidInSession", prop: SAID_IN_SESSION_PROP }, {
      subject: id,
      object: sid,
      subjectLabel: label,
      objectLabel: String(sessionId).slice(0, 8)
    });
    if (replyTo) {
      const target = payload.individuals.find((i) => i?.id === replyTo);
      if (target) {
        upsertEdge(payload, { predicate: "inReplyTo", prop: IN_REPLY_TO_PROP }, {
          subject: id,
          object: replyTo,
          subjectLabel: label,
          objectLabel: target.label
        });
      }
    }
    if (cleanTs && cleanTs > String(payload.generated_at || "")) payload.generated_at = cleanTs;
    return id;
  }
  async function appendUtterance(dir, utterance) {
    let id;
    await mutateMemory(dir, (payload) => {
      id = putUtterance(payload, utterance);
      recountClasses(payload);
    });
    return { id };
  }
  async function appendUtterances(dir, utterances) {
    const ids = [];
    if (!utterances?.length) return { ids };
    await mutateMemory(dir, (payload) => {
      for (const u of utterances) ids.push(putUtterance(payload, u));
      recountClasses(payload);
    });
    return { ids };
  }
  async function appendFact(dir, { subject, predicate, object, provenance = "", createdAt = "", quantifier = "", premiseTrusts, ruleConfidence } = {}) {
    const s = normFactTerm(subject);
    const p = normFactPredicate(predicate);
    const o = normFactTerm(object);
    if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
    const id = factIdFor(s, p, o);
    const text = `${s} ${p} ${o}`;
    const tokens = proseTokensFor({ doc: text });
    const q = normText(quantifier);
    await mutateMemory(dir, async (payload) => {
      const prior = payload.individuals.find((x) => x?.id === id);
      const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
      const createdAtVal = firstWriteCreatedAt(prior, createdAt);
      const priorQ = prior?.attributes?.find((a) => a?.prop === "mgx:factQuantifier")?.value || "";
      const qVal = q || priorQ;
      const candidate = {
        id,
        label: labelOf(text),
        class: FACT_CLASS,
        derived_from: [],
        mentions: [],
        attributes: [
          { prop: "rdf:type", key: "type", value: "rdf:Statement" },
          { prop: "rdf:subject", key: "subject", value: s },
          { prop: "rdf:predicate", key: "predicate", value: p },
          { prop: "rdf:object", key: "object", value: o },
          { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
          ...provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : [],
          ...tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : [],
          ...qVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: qVal }] : []
        ]
      };
      await assertIndividualValid(candidate);
      upsertIndividual(payload, candidate);
      syncFactSources(payload, payload.individuals.find((x) => x?.id === id), void 0, { premiseTrusts, ruleConfidence });
      recountClasses(payload);
    });
    return { id };
  }
  async function appendFacts(dir, facts) {
    const prepared = [];
    let skipped = 0;
    for (const f of facts || []) {
      const s = normFactTerm(f?.subject);
      const p = normFactPredicate(f?.predicate);
      const o = normFactTerm(f?.object);
      if (!s || !p || !o) {
        skipped += 1;
        continue;
      }
      const text = `${s} ${p} ${o}`;
      prepared.push({
        id: factIdFor(s, p, o),
        // NUL-delimited — byte-identical to appendFact's id
        s,
        p,
        o,
        text,
        tokens: proseTokensFor({ doc: text }),
        provenance: normText(f?.provenance),
        createdAt: f?.createdAt || "",
        quantifier: normText(f?.quantifier),
        premiseTrusts: Array.isArray(f?.premiseTrusts) ? f.premiseTrusts : void 0,
        ruleConfidence: typeof f?.ruleConfidence === "number" ? f.ruleConfidence : void 0,
        justification: Array.isArray(f?.justification) ? f.justification.filter(Boolean) : void 0
      });
    }
    const ids = [];
    if (!prepared.length) return { ids, appended: 0, skipped };
    await mutateMemory(dir, (payload) => {
      const idx = memoryIndexOf(payload);
      const byId = idx ? idx.individualsById : new Map(payload.individuals.map((i) => [i?.id, i]));
      const touched = [];
      const seen = /* @__PURE__ */ new Set();
      const trustOptsById = /* @__PURE__ */ new Map();
      for (const f of prepared) {
        const prior = byId.get(f.id);
        const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
        const provs = [...new Set([...priorProv.split(" | "), f.provenance].filter(Boolean))];
        const createdAtVal = firstWriteCreatedAt(prior, f.createdAt);
        const priorQ = prior?.attributes?.find((a) => a?.prop === "mgx:factQuantifier")?.value || "";
        const qVal = f.quantifier || priorQ;
        const ind = {
          id: f.id,
          label: labelOf(f.text),
          class: FACT_CLASS,
          derived_from: [],
          mentions: [],
          attributes: [
            { prop: "rdf:type", key: "type", value: "rdf:Statement" },
            { prop: "rdf:subject", key: "subject", value: f.s },
            { prop: "rdf:predicate", key: "predicate", value: f.p },
            { prop: "rdf:object", key: "object", value: f.o },
            { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
            ...provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : [],
            ...f.tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: f.tokens.join(" ") }] : [],
            ...qVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: qVal }] : [],
            ...f.justification && f.justification.length ? [{ prop: "mgx:factJustification", key: "justification", value: f.justification.join(" ") }] : []
          ]
        };
        const stored = upsertIndividual(payload, ind);
        byId.set(f.id, stored);
        ids.push(f.id);
        if (!seen.has(f.id)) {
          seen.add(f.id);
          touched.push(f.id);
        }
        if (f.premiseTrusts !== void 0 || f.ruleConfidence !== void 0) {
          trustOptsById.set(f.id, { premiseTrusts: f.premiseTrusts, ruleConfidence: f.ruleConfidence });
        }
      }
      for (const id of touched) syncFactSources(payload, byId.get(id), void 0, trustOptsById.get(id));
      recountClasses(payload);
    });
    return { ids, appended: ids.length, skipped };
  }
  async function appendRule(dir, { name, kind, slots, provenance = "", createdAt = "" } = {}) {
    const spec = RULE_SLOT_SPEC[kind];
    if (!spec) throw new Error(`a rule kind must be one of ${RULE_KINDS2.join(", ")}, got ${JSON.stringify(kind)}`);
    const n = normFactTerm(name);
    if (!n) throw new Error("a rule needs a name");
    const slotValues = spec.map(([slotKey]) => normFactTerm(slots?.[slotKey]));
    if (slotValues.some((v) => !v)) {
      throw new Error(`a ${kind} rule needs ${spec.map(([slotKey]) => slotKey).join(" + ")}`);
    }
    const id = ruleIdFor(kind, n, slotValues);
    const label = labelOf(`${n} = ${kind}(${slotValues.join(", ")})`);
    await mutateMemory(dir, async (payload) => {
      const prior = payload.individuals.find((x) => x?.id === id);
      const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
      const createdAtVal = firstWriteCreatedAt(prior, createdAt);
      const candidate = {
        id,
        label,
        class: RULE_CLASS,
        derived_from: [],
        mentions: [],
        attributes: [
          { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
          { prop: RULE_NAME_PROP, key: "ruleName", value: n },
          { prop: RULE_KIND_PROP, key: "ruleKind", value: kind },
          ...spec.map(([slotKey, prop], i) => ({ prop, key: slotKey, value: slotValues[i] })),
          { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
          ...provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : []
        ]
      };
      await assertIndividualValid(candidate);
      upsertIndividual(payload, candidate);
      syncFactSources(payload, payload.individuals.find((x) => x?.id === id));
      recountClasses(payload);
    });
    return { id };
  }
  function findRuleByName(memory, name) {
    const n = normFactTerm(name);
    return (memory?.individuals || []).find(
      (i) => i?.class === RULE_CLASS && (i.attributes || []).find((a) => a?.prop === RULE_NAME_PROP)?.value === n
    );
  }
  function findRulesByName(memory, name) {
    const n = normFactTerm(name);
    const kindOf = (i) => (i.attributes || []).find((a) => a?.prop === RULE_KIND_PROP)?.value || "";
    return (memory?.individuals || []).filter((i) => i?.class === RULE_CLASS && (i.attributes || []).find((a) => a?.prop === RULE_NAME_PROP)?.value === n).sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || String(a.id).localeCompare(String(b.id)));
  }
  function readRuleRows(memory) {
    const rows = [];
    for (const ind of memory?.individuals || []) {
      if (ind?.class !== RULE_CLASS) continue;
      const attr = (prop) => (ind.attributes || []).find((a) => a?.prop === prop)?.value;
      const kind = attr(RULE_KIND_PROP);
      const spec = RULE_SLOT_SPEC[kind];
      if (!spec) continue;
      const slots = {};
      for (const [slotKey, prop] of spec) slots[slotKey] = attr(prop) ?? "";
      rows.push({
        id: ind.id,
        name: attr(RULE_NAME_PROP) || "",
        kind,
        slots,
        provenance: attr("mgx:factProvenance") || ""
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind) || String(a.id).localeCompare(String(b.id)));
    return rows;
  }
  async function resolveRelationChase(memory, name, subjectTerm, objectTerm, helpers) {
    const { relationFactsFor, renderFactLine: renderFactLine2, factPhrase: factPhrase2, factTermVariants: factTermVariants2, byTrust, rows, HAS_PROPERTY_PREDICATE: HAS_PROPERTY_PREDICATE2, findActionPath: findActionPath2 } = helpers;
    const target = String(name || "").trim().toLowerCase();
    const sv = factTermVariants2(normFactTerm, subjectTerm);
    const ov = factTermVariants2(normFactTerm, objectTerm);
    const pairHits = relationFactsFor(target).filter((e) => sv.has(e.fact.subject) && ov.has(e.fact.object));
    if (pairHits.length) {
      const hit2 = pairHits.slice().sort((a, b) => byTrust(a.fact, b.fact))[0];
      return { citation: [renderFactLine2(hit2.fact), ...hit2.aliasFacts.map(
        (af) => `${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`
      )] };
    }
    const rule = findRuleByName(memory, target);
    const ruleKind = rule?.attributes?.find((a) => a.prop === RULE_KIND_PROP)?.value;
    if (rule && ruleKind === RULE_KIND_COMPOSE2) {
      const base1 = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const base2 = rule.attributes.find((a) => a.prop === "mgx:ruleBase2")?.value;
      const startEntity = normFactTerm(subjectTerm);
      const targetEntity = normFactTerm(objectTerm);
      if (!base1 || !base2 || !startEntity || !targetEntity) return null;
      const applyActions = (state) => {
        if (state.hopsTaken >= 2) return [];
        const relName = state.hopsTaken === 0 ? base1 : base2;
        return relationFactsFor(relName).filter((e) => e.fact.subject === state.entity).map((e) => ({ action: e, nextState: { entity: e.fact.object, hopsTaken: state.hopsTaken + 1 } }));
      };
      const isGoal = (state) => state.hopsTaken === 2 && state.entity === targetEntity;
      const stateKey = (state) => `${state.entity}#${state.hopsTaken}`;
      const found = findActionPath2({ entity: startEntity, hopsTaken: 0 }, isGoal, applyActions, { maxDepth: 2, stateKey });
      if (!found) return null;
      const seenAlias = /* @__PURE__ */ new Set();
      const parts = [];
      for (const e of found.actions) {
        parts.push(renderFactLine2(e.fact));
        for (const af of e.aliasFacts) {
          const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
          if (seenAlias.has(key)) continue;
          seenAlias.add(key);
          parts.push(`${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
        }
      }
      return { citation: parts };
    }
    if (rule && ruleKind === RULE_KIND_FILTER) {
      const base = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const property = rule.attributes.find((a) => a.prop === "mgx:ruleFilterProperty")?.value;
      if (!base || !property) return null;
      const baseHit = await resolveRelationChase(memory, base, subjectTerm, objectTerm, helpers);
      if (!baseHit) return null;
      const subjectEntity = normFactTerm(subjectTerm);
      const propertyNorm = normFactTerm(property);
      const propHit = rows.find(
        (f) => f.predicate === HAS_PROPERTY_PREDICATE2 && f.subject === subjectEntity && normFactTerm(f.object) === propertyNorm
      );
      if (!propHit) return null;
      return { citation: [...baseHit.citation, renderFactLine2(propHit)] };
    }
    return null;
  }
  async function resolveRelationChaseReverse(memory, name, objectTerm, helpers) {
    const { relationFactsFor, renderFactLine: renderFactLine2, factPhrase: factPhrase2, factTermVariants: factTermVariants2, byTrust, rows, HAS_PROPERTY_PREDICATE: HAS_PROPERTY_PREDICATE2, findReachableSet: findReachableSet2 } = helpers;
    const target = String(name || "").trim().toLowerCase();
    const ov = factTermVariants2(normFactTerm, objectTerm);
    const directHits = relationFactsFor(target).filter((e) => ov.has(e.fact.object));
    if (directHits.length) {
      const bySubject = /* @__PURE__ */ new Map();
      for (const e of directHits) {
        if (!bySubject.has(e.fact.subject)) bySubject.set(e.fact.subject, []);
        bySubject.get(e.fact.subject).push(e);
      }
      return [...bySubject.entries()].map(([subj, hits]) => {
        const hit2 = hits.slice().sort((a, b) => byTrust(a.fact, b.fact))[0];
        return {
          subject: subj,
          citation: [renderFactLine2(hit2.fact), ...hit2.aliasFacts.map(
            (af) => `${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`
          )]
        };
      });
    }
    const rule = findRuleByName(memory, target);
    const ruleKind = rule?.attributes?.find((a) => a.prop === RULE_KIND_PROP)?.value;
    if (rule && ruleKind === RULE_KIND_COMPOSE2) {
      const base1 = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const base2 = rule.attributes.find((a) => a.prop === "mgx:ruleBase2")?.value;
      const targetEntity = normFactTerm(objectTerm);
      if (!base1 || !base2 || !targetEntity) return [];
      const applyActionsRev = (state) => {
        if (state.hopsTaken >= 2) return [];
        const relName = state.hopsTaken === 0 ? base2 : base1;
        return relationFactsFor(relName).filter((e) => e.fact.object === state.entity).map((e) => ({ action: e, nextState: { entity: e.fact.subject, hopsTaken: state.hopsTaken + 1 } }));
      };
      const stateKeyRev = (state) => `${state.entity}#${state.hopsTaken}`;
      const reached = findReachableSet2(
        { entity: targetEntity, hopsTaken: 0 },
        applyActionsRev,
        { maxDepth: 2, stateKey: stateKeyRev }
      );
      return reached.filter((r) => r.node.hopsTaken === 2).map(({ node, path }) => {
        const seenAlias = /* @__PURE__ */ new Set();
        const parts = [];
        for (const e of path.actions.slice().reverse()) {
          parts.push(renderFactLine2(e.fact));
          for (const af of e.aliasFacts) {
            const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
            if (seenAlias.has(key)) continue;
            seenAlias.add(key);
            parts.push(`${factPhrase2(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
          }
        }
        return { subject: node.entity, citation: parts };
      });
    }
    if (rule && ruleKind === RULE_KIND_FILTER) {
      const base = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
      const property = rule.attributes.find((a) => a.prop === "mgx:ruleFilterProperty")?.value;
      if (!base || !property) return [];
      const baseHits = await resolveRelationChaseReverse(memory, base, objectTerm, helpers);
      const propertyNorm = normFactTerm(property);
      const out = [];
      for (const bh of baseHits) {
        const subjectEntity = normFactTerm(bh.subject);
        const propHit = rows.find(
          (f) => f.predicate === HAS_PROPERTY_PREDICATE2 && f.subject === subjectEntity && normFactTerm(f.object) === propertyNorm
        );
        if (propHit) out.push({ subject: bh.subject, citation: [...bh.citation, renderFactLine2(propHit)] });
      }
      return out;
    }
    return [];
  }
  function readFactRows(memory) {
    const individuals = memory?.individuals || [];
    const sourcesById = new Map(individuals.filter((i) => i?.class === SOURCE_CLASS).map((i) => [i.id, i]));
    const statedGroup = (memory?.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
    const byFact = /* @__PURE__ */ new Map();
    for (const e of statedGroup?.examples || []) {
      if (!byFact.has(e.subject)) byFact.set(e.subject, []);
      byFact.get(e.subject).push(e.object);
    }
    const rows = [];
    for (const ind of individuals) {
      if (ind?.class !== FACT_CLASS) continue;
      const get = (k) => (ind.attributes || []).find((a) => a?.key === k)?.value || "";
      const sourceIds = byFact.get(ind.id) || [];
      const sourceTypes = sourceIds.map((id) => (sourcesById.get(id)?.attributes || []).find((a) => a?.prop === "mgx:sourceType")?.value).filter(Boolean);
      const justificationRaw = get("justification");
      rows.push({
        id: ind.id,
        subject: get("subject"),
        predicate: get("predicate"),
        object: get("object"),
        provenance: get("provenance"),
        // legacy compat string, verbatim
        quantifier: get("quantifier"),
        // "" unless a plural class-membership teach set one
        sourceIds,
        sourceTypes,
        trust: Number((ind.attributes || []).find((a) => a?.prop === TRUST_SCORE_PROP)?.value) || 0,
        // [] unless a rule persisted its premise fact ids (justification-tracking,
        // scm-sco only today; see syllogise.mjs).
        justification: justificationRaw ? justificationRaw.split(" ").filter(Boolean) : []
      });
    }
    return rows;
  }
  async function removeFacts(dir, ids) {
    const idSet = new Set((ids || []).filter(Boolean));
    const removed = [];
    if (!idSet.size) return { removed };
    await mutateMemory(dir, (payload) => {
      payload.individuals = (payload.individuals || []).filter((ind) => {
        if (ind?.class === FACT_CLASS && idSet.has(ind.id)) {
          removed.push(ind.id);
          return false;
        }
        return true;
      });
      if (!removed.length) return;
      const removedSet = new Set(removed);
      for (const group of payload.objectProperties || []) {
        const before = group.examples || [];
        group.examples = before.filter((e) => !removedSet.has(e?.subject) && !removedSet.has(e?.object));
        group.count = group.examples.length;
      }
      recountClasses(payload);
    });
    return { removed };
  }
  function findContradictions(memory, { floor = CONTRADICTION_TRUST_FLOOR } = {}) {
    const rows = readFactRows(memory).filter((r) => r.trust >= floor);
    const byKey = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (MULTI_VALUED_PREDICATES.has(r.predicate)) continue;
      const key = `${r.subject} ${r.predicate}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    const out = [];
    for (const group of byKey.values()) {
      if (new Set(group.map((r) => r.object)).size > 1) {
        out.push(group.slice().sort((a, b) => b.trust - a.trust || a.object.localeCompare(b.object)));
      }
    }
    return out.sort((a, b) => `${a[0].subject} ${a[0].predicate}`.localeCompare(`${b[0].subject} ${b[0].predicate}`));
  }
  var MEMORY_DIR_REL, MEMORY_GRAPH_REL, UTTERANCE_CLASS, FACT_CLASS, MEMORY_SESSION_CLASS, SOURCE_CLASS, RULE_CLASS, SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP, DERIVED_FROM_PROP, STATED_BY_PROP, CANONICALISED_FROM_PROP, SOURCE_RELIABILITY_PROP, OPERATOR_SOURCE_ID, TEACH_SOURCE_ID, ROLES, LABEL_CAP, MEMORY_VOCABULARY, memoryGraphFile, BACKEND_MEMORY, BACKEND_SQLITE, SQLITE_DDL, STD_EDGE_KEYS, cloneJson, MEMORY_MANIFEST_REL, DEFAULT_RETENTION, resolveManifestFile, MEMORY_INDEX, memoryIndexOf, labelOf, nowIso, sourceLabel, isSessionScopedSourceId, RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE, RULE_KIND_ACTION_SIGNATURE, RULE_KIND_ACTION_PRECOND, RULE_KIND_ACTION_EFFECT, RULE_KIND_ACTION_CONSTRAINT, RULE_KINDS2, RULE_NAME_PROP, RULE_KIND_PROP, RULE_SLOT_SPEC, ruleIdFor, CONTRADICTION_TRUST_FLOOR, HAS_A_PREDICATE, CAPABLE_OF_PREDICATE2, MULTI_VALUED_PREDICATES;
  var init_core = __esm({
    "src/adapters/memory/core.mjs"() {
      init_promises();
      init_node_path();
      init_prose();
      init_hash();
      init_hash();
      init_trust();
      init_trust();
      init_capability();
      init_shacl();
      MEMORY_DIR_REL = join(".tmct", "memory");
      MEMORY_GRAPH_REL = join(MEMORY_DIR_REL, "graph.json");
      UTTERANCE_CLASS = "Utterance";
      FACT_CLASS = "Fact";
      MEMORY_SESSION_CLASS = "Session";
      SOURCE_CLASS = "Source";
      RULE_CLASS = "Rule";
      SAID_IN_SESSION_PROP = "mgx:saidInSession";
      IN_REPLY_TO_PROP = "mgx:inReplyTo";
      DERIVED_FROM_PROP = "mgx:derivedFrom";
      STATED_BY_PROP = "mgx:statedBy";
      CANONICALISED_FROM_PROP = "mgx:canonicalisedFrom";
      SOURCE_RELIABILITY_PROP = "mgx:sourceReliability";
      OPERATOR_SOURCE_ID = "src:operator-chat";
      TEACH_SOURCE_ID = "src:teach-chat";
      ROLES = /* @__PURE__ */ new Set(["visitor", "tmct"]);
      LABEL_CAP = 48;
      MEMORY_VOCABULARY = [
        { prop: "rdf:type", note: "rdf-ish typing attribute: owl:NamedIndividual (utterances/sessions) or rdf:Statement (reified facts)" },
        { prop: "mgx:utteranceRole", note: "who said it: visitor (an a-visitor-said item) or tmct (the response alongside it)" },
        { prop: "mgx:utteranceText", note: "the utterance's normalized text (capped)" },
        { prop: "mgx:utteranceTs", note: "when it was said, ISO-8601 (the chat turn timestamp)" },
        { prop: "mgx:utteranceParsed", note: "optional JSON of the parse the interpretation pipeline produced for this request" },
        { prop: SAID_IN_SESSION_PROP, predicate: "saidInSession", note: "Utterance \u2192 Session it was said in; runtime observation, owned (no SEON term)" },
        { prop: IN_REPLY_TO_PROP, predicate: "inReplyTo", note: "tmct Utterance \u2192 the visitor Utterance it answers (the Q/A pairing)" },
        { prop: "rdf:subject", note: "reified fact: the triple's subject term" },
        { prop: "rdf:predicate", note: "reified fact: the triple's predicate term" },
        { prop: "rdf:object", note: "reified fact: the triple's object term" },
        { prop: "mgx:factProvenance", note: "LEGACY COMPAT SHIM: the ' | '-joined provenance tag string a fact came from; the source-of-truth is now the mgx:statedBy edges derived from it" },
        { prop: "mgx:factQuantifier", note: "OPTIONAL: the quantifier word a plural class-membership teach used ('every'/'some'/'a few'), for literal recall by 'how many Xs are Ys' \u2014 never real cardinality counting" },
        { prop: "mgx:ruleName", note: "a taught Rule's own name (e.g. 'grandparent') \u2014 the query-dispatcher's lookup key, PLAN_TAUGHT_RELATIONS.md \xA72/\xA73" },
        { prop: "mgx:ruleKind", note: "a taught Rule's SHAPE tag \u2014 the closed vocabulary compose2 | filter | recursive (structural, like 'Fact'/'Rule' themselves, never a domain word)" },
        { prop: "mgx:ruleBase1", note: "compose2: the first hop's base relation name; filter: the base rule/relation being filtered (same 'base relation' role in both kinds, so the name is shared)" },
        { prop: "mgx:ruleBase2", note: "compose2 only: the second hop's base relation name" },
        { prop: "mgx:ruleFilterProperty", note: "filter only: the property literal candidates are filtered by (an mgx:hasProperty-shaped Fact lookup)" },
        { prop: "mgx:ruleBaseCase", note: "recursive only: the base-case relation name (hop zero)" },
        { prop: "mgx:ruleRecStep", note: "recursive only: the self-referential recursive-step relation name" },
        { prop: CREATED_AT_PROP, note: "when an individual was FIRST written, ISO-8601 (first-write-wins on upsert); the audit 'when', the recency input to trust, the novelty signal" },
        { prop: UPDATED_AT_PROP, note: "when an individual's OWN attributes were last mutated in place (upsertSession, recomputeFactTrust, recomputeSourceReliability) \u2014 most individuals never carry this and instead derive 'updated' from codegraph.mjs's derivedUpdatedAt (max createdAt over their edges)" },
        { prop: DERIVED_FROM_PROP, predicate: "derivedFrom", note: "umbrella: a Fact derived from a Source (or another Fact). ext ref prov:wasDerivedFrom (UNVERIFIED-pending-web-check)" },
        { prop: STATED_BY_PROP, predicate: "statedBy", note: "subPropertyOf derivedFrom: a Source directly asserts this Fact (one edge per independent source \u2014 replaces the factProvenance union)" },
        { prop: CANONICALISED_FROM_PROP, predicate: "canonicalisedFrom", note: "subPropertyOf derivedFrom: a canonical Fact cleaned from a raw Block/Source, never replacing it" },
        { prop: "mgx:sourceType", note: "a Source's kind: operator | teach | provider | corpus | corpusWeak | extracted | web | entailed (the trust-prior key)" },
        { prop: "mgx:sourceUrl", note: "a web Source's URL" },
        { prop: "mgx:sourceRule", note: "an entailed Source's rule id" },
        { prop: "mgx:sourceReliability", note: "actor-level (session-scoped) trust nudge in [0.5,1.5], neutral 1.0 when absent \u2014 materialised by recomputeSourceReliability from a session's asserted-vs-contradicted track record (memory/trust.mjs's sessionReliabilityFrom); folds into computeTrust's per-source prior" },
        { prop: TRUST_SCORE_PROP, note: "materialised trust cache in [0,1] \u2014 pure function of a fact's Sources + createdAt (memory/trust.mjs); invalidated when a statedBy edge is added" },
        { prop: TRUST_INPUTS_PROP, note: "JSON of the inputs the trust score was computed from (source-type multiset, corroboration count, createdAt, recency) \u2014 makes the score auditable" },
        { prop: "mgx:hasProseTokens", note: "prose tokens (prose.mjs tokenizer) backing the payload's proseIndex" },
        { prop: "mgx:sessionStarted", note: "session anchor: when the session started, ISO-8601" },
        { prop: "rdf:predicate", prefix: NEG_PREDICATE_PREFIX, note: "a reified fact's predicate carries its POLARITY: mgxneg:capableOf is the negative twin of mgx:capableOf ('a penguin cannot fly'). Polarity cannot be a separate property \u2014 the fact id hashes (subject, predicate, object), so both polarities would share one id and union their statedBy edges (memory/capability.mjs)" }
      ];
      memoryGraphFile = (dir) => resolveMemoryGraphFile(dir);
      BACKEND_MEMORY = "memory";
      BACKEND_SQLITE = "sqlite";
      SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS individuals (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, class TEXT, label TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (prop TEXT PRIMARY KEY, ord INTEGER NOT NULL, predicate TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS edges (prop TEXT NOT NULL, subject TEXT NOT NULL, object TEXT NOT NULL, subject_label TEXT, object_label TEXT, extra TEXT, PRIMARY KEY (prop, subject, object));
CREATE INDEX IF NOT EXISTS edges_by_prop ON edges(prop);
`;
      STD_EDGE_KEYS = /* @__PURE__ */ new Set(["subject", "object", "subjectLabel", "objectLabel"]);
      cloneJson = (v) => v === void 0 ? v : structuredClone(v);
      MEMORY_MANIFEST_REL = join(MEMORY_DIR_REL, "manifest.json");
      DEFAULT_RETENTION = 5;
      resolveManifestFile = (dir) => join(dir, MEMORY_MANIFEST_REL);
      MEMORY_INDEX = /* @__PURE__ */ Symbol("mutateMemory lookup index");
      memoryIndexOf = (payload) => payload?.[MEMORY_INDEX] || null;
      labelOf = (text) => text.length > LABEL_CAP ? text.slice(0, LABEL_CAP - 1) + "\u2026" : text;
      nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
      sourceLabel = (id) => String(id).replace(/^src:/, "");
      isSessionScopedSourceId = (id) => typeof id === "string" && (id.startsWith(`${OPERATOR_SOURCE_ID}:`) || id.startsWith(`${TEACH_SOURCE_ID}:`));
      RULE_KIND_COMPOSE2 = "compose2";
      RULE_KIND_FILTER = "filter";
      RULE_KIND_RECURSIVE = "recursive";
      RULE_KIND_ACTION_SIGNATURE = "action-signature";
      RULE_KIND_ACTION_PRECOND = "action-precond";
      RULE_KIND_ACTION_EFFECT = "action-effect";
      RULE_KIND_ACTION_CONSTRAINT = "action-constraint";
      RULE_KINDS2 = Object.freeze([
        RULE_KIND_COMPOSE2,
        RULE_KIND_FILTER,
        RULE_KIND_RECURSIVE,
        RULE_KIND_ACTION_SIGNATURE,
        RULE_KIND_ACTION_PRECOND,
        RULE_KIND_ACTION_EFFECT,
        RULE_KIND_ACTION_CONSTRAINT
      ]);
      RULE_NAME_PROP = "mgx:ruleName";
      RULE_KIND_PROP = "mgx:ruleKind";
      RULE_SLOT_SPEC = {
        [RULE_KIND_COMPOSE2]: [["base1", "mgx:ruleBase1"], ["base2", "mgx:ruleBase2"]],
        [RULE_KIND_FILTER]: [["base", "mgx:ruleBase1"], ["property", "mgx:ruleFilterProperty"]],
        [RULE_KIND_RECURSIVE]: [["baseCase", "mgx:ruleBaseCase"], ["recStep", "mgx:ruleRecStep"]],
        [RULE_KIND_ACTION_SIGNATURE]: [
          ["subjectClass", "mgx:ruleActionSubjectClass"],
          ["targetClass", "mgx:ruleActionTargetClass"]
        ],
        [RULE_KIND_ACTION_PRECOND]: [
          ["shape", "mgx:ruleActionPrecondShape"],
          ["predicate", "mgx:ruleActionPrecondPredicate"],
          ["role", "mgx:ruleActionPrecondRole"],
          ["scope", "mgx:ruleActionPrecondScope"]
        ],
        [RULE_KIND_ACTION_EFFECT]: [
          ["predicate", "mgx:ruleActionEffectPredicate"],
          ["subjectRole", "mgx:ruleActionEffectSubject"],
          ["objectRole", "mgx:ruleActionEffectObject"]
        ],
        // "the <left> may not be with the <right> without the <guard>" — each slot
        // names a class whose sole member src/domain/domain.mjs resolves at compile time.
        [RULE_KIND_ACTION_CONSTRAINT]: [
          ["left", "mgx:ruleActionConstraintLeft"],
          ["right", "mgx:ruleActionConstraintRight"],
          ["guard", "mgx:ruleActionConstraintGuard"]
        ]
      };
      ruleIdFor = (kind, name, slotValues) => `rule:${fnv1aHex([kind, name, ...slotValues].join("\0"))}`;
      CONTRADICTION_TRUST_FLOOR = 0.5;
      HAS_A_PREDICATE = "mgx:hasA";
      CAPABLE_OF_PREDICATE2 = "mgx:capableOf";
      MULTI_VALUED_PREDICATES = new Set(
        [HAS_A_PREDICATE, CAPABLE_OF_PREDICATE2].flatMap((p) => [p, negatedPredicate(p)])
      );
    }
  });

  // adapter-stub-ask-nlp.mjs:../adapters/ask-nlp.mjs
  var nlpAdapter;
  var init_ask_nlp = __esm({
    "adapter-stub-ask-nlp.mjs:../adapters/ask-nlp.mjs"() {
      nlpAdapter = void 0;
    }
  });

  // node-stub:node:url
  var unavailable5, createRequire5, readFileSync5, readFile5, writeFile5, appendFile5, mkdir5, mkdtemp5, rename5, unlink5, rm5, stat5, copyFile5, readdir5, createReadStream5, createWriteStream5, fileURLToPath2, randomBytes5, spawnSync5, createInterface5;
  var init_node_url = __esm({
    "node-stub:node:url"() {
      unavailable5 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire5 = unavailable5("createRequire");
      readFileSync5 = unavailable5("readFileSync");
      readFile5 = unavailable5("readFile");
      writeFile5 = unavailable5("writeFile");
      appendFile5 = unavailable5("appendFile");
      mkdir5 = unavailable5("mkdir");
      mkdtemp5 = unavailable5("mkdtemp");
      rename5 = unavailable5("rename");
      unlink5 = unavailable5("unlink");
      rm5 = unavailable5("rm");
      stat5 = unavailable5("stat");
      copyFile5 = unavailable5("copyFile");
      readdir5 = unavailable5("readdir");
      createReadStream5 = unavailable5("createReadStream");
      createWriteStream5 = unavailable5("createWriteStream");
      fileURLToPath2 = (u) => String(u);
      randomBytes5 = unavailable5("randomBytes");
      spawnSync5 = unavailable5("spawnSync");
      createInterface5 = unavailable5("createInterface");
    }
  });

  // src/adapters/corpus/templates.mjs
  var import_meta, PKG_ROOT, TEMPLATES_FILE, PHRASEBOOK_FILE, TECHNICAL_SLOTS;
  var init_templates = __esm({
    "src/adapters/corpus/templates.mjs"() {
      init_promises();
      init_node_url();
      init_node_path();
      import_meta = {};
      PKG_ROOT = join(dirname(fileURLToPath2(import_meta.url)), "..", "..", "..");
      TEMPLATES_FILE = join(PKG_ROOT, "data", "templates", "responses.jsonl");
      PHRASEBOOK_FILE = join(PKG_ROOT, "data", "phrasebook", "software-phrases.txt");
      TECHNICAL_SLOTS = Object.freeze(/* @__PURE__ */ new Set([
        "subject",
        "count",
        "noun",
        "scope",
        "comparison",
        "metric",
        "unit",
        "superlative",
        "provenance"
      ]));
    }
  });

  // node-stub:node:fs
  var unavailable6, createRequire6, readFileSync6, readFile6, writeFile6, appendFile6, mkdir6, mkdtemp6, rename6, unlink6, rm6, stat6, copyFile6, readdir6, createReadStream6, createWriteStream6, randomBytes6, spawnSync6, createInterface6;
  var init_node_fs = __esm({
    "node-stub:node:fs"() {
      unavailable6 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire6 = unavailable6("createRequire");
      readFileSync6 = unavailable6("readFileSync");
      readFile6 = unavailable6("readFile");
      writeFile6 = unavailable6("writeFile");
      appendFile6 = unavailable6("appendFile");
      mkdir6 = unavailable6("mkdir");
      mkdtemp6 = unavailable6("mkdtemp");
      rename6 = unavailable6("rename");
      unlink6 = unavailable6("unlink");
      rm6 = unavailable6("rm");
      stat6 = unavailable6("stat");
      copyFile6 = unavailable6("copyFile");
      readdir6 = unavailable6("readdir");
      createReadStream6 = unavailable6("createReadStream");
      createWriteStream6 = unavailable6("createWriteStream");
      randomBytes6 = unavailable6("randomBytes");
      spawnSync6 = unavailable6("spawnSync");
      createInterface6 = unavailable6("createInterface");
    }
  });

  // node_modules/smol-toml/dist/date.js
  var init_date = __esm({
    "node_modules/smol-toml/dist/date.js"() {
    }
  });

  // node_modules/smol-toml/dist/error.js
  var init_error = __esm({
    "node_modules/smol-toml/dist/error.js"() {
    }
  });

  // node_modules/smol-toml/dist/primitive.js
  var init_primitive = __esm({
    "node_modules/smol-toml/dist/primitive.js"() {
      init_date();
      init_error();
    }
  });

  // node_modules/smol-toml/dist/util.js
  var init_util = __esm({
    "node_modules/smol-toml/dist/util.js"() {
      init_error();
    }
  });

  // node_modules/smol-toml/dist/extract.js
  var init_extract = __esm({
    "node_modules/smol-toml/dist/extract.js"() {
      init_primitive();
      init_struct();
      init_util();
      init_error();
    }
  });

  // node_modules/smol-toml/dist/struct.js
  var init_struct = __esm({
    "node_modules/smol-toml/dist/struct.js"() {
      init_primitive();
      init_extract();
      init_util();
      init_error();
    }
  });

  // node_modules/smol-toml/dist/parse.js
  var init_parse = __esm({
    "node_modules/smol-toml/dist/parse.js"() {
      init_struct();
      init_extract();
      init_util();
      init_error();
    }
  });

  // node_modules/smol-toml/dist/stringify.js
  var init_stringify = __esm({
    "node_modules/smol-toml/dist/stringify.js"() {
    }
  });

  // node_modules/smol-toml/dist/index.js
  var init_dist = __esm({
    "node_modules/smol-toml/dist/index.js"() {
      init_parse();
      init_stringify();
      init_date();
      init_error();
    }
  });

  // src/services/finish.mjs
  var import_meta2, GRAMMAR_DIR, GRAMMAR_RULES_FILE, SEGMENT_TYPES, PROTECTED_TYPES;
  var init_finish = __esm({
    "src/services/finish.mjs"() {
      init_node_fs();
      init_node_url();
      init_node_path();
      init_dist();
      init_templates();
      import_meta2 = {};
      GRAMMAR_DIR = dirname(fileURLToPath2(import_meta2.url));
      GRAMMAR_RULES_FILE = join(GRAMMAR_DIR, "..", "..", "data", "templates", "grammar-rules.toml");
      SEGMENT_TYPES = Object.freeze([
        "prose",
        "entity",
        "path",
        "number",
        "code",
        "provenance",
        "receipt"
      ]);
      PROTECTED_TYPES = Object.freeze(
        new Set(SEGMENT_TYPES.filter((t) => t !== "prose"))
      );
    }
  });

  // node-stub:node:module
  var unavailable7, createRequire7, readFileSync7, readFile7, writeFile7, appendFile7, mkdir7, mkdtemp7, rename7, unlink7, rm7, stat7, copyFile7, readdir7, createReadStream7, createWriteStream7, randomBytes7, spawnSync7, createInterface7;
  var init_node_module = __esm({
    "node-stub:node:module"() {
      unavailable7 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire7 = unavailable7("createRequire");
      readFileSync7 = unavailable7("readFileSync");
      readFile7 = unavailable7("readFile");
      writeFile7 = unavailable7("writeFile");
      appendFile7 = unavailable7("appendFile");
      mkdir7 = unavailable7("mkdir");
      mkdtemp7 = unavailable7("mkdtemp");
      rename7 = unavailable7("rename");
      unlink7 = unavailable7("unlink");
      rm7 = unavailable7("rm");
      stat7 = unavailable7("stat");
      copyFile7 = unavailable7("copyFile");
      readdir7 = unavailable7("readdir");
      createReadStream7 = unavailable7("createReadStream");
      createWriteStream7 = unavailable7("createWriteStream");
      randomBytes7 = unavailable7("randomBytes");
      spawnSync7 = unavailable7("spawnSync");
      createInterface7 = unavailable7("createInterface");
    }
  });

  // src/adapters/wink-model.mjs
  function loadWinkModel() {
    if (cached !== void 0) return cached;
    try {
      const pair = injected ? injected() : nodeRequireWink();
      cached = pair && pair.winkNLP && pair.model ? pair : null;
    } catch {
      cached = null;
    }
    return cached;
  }
  function nodeRequireWink() {
    const require2 = createRequire7(import_meta3.url);
    return {
      winkNLP: require2("wink-nlp"),
      model: require2("wink-eng-lite-web-model")
    };
  }
  function winkInstance() {
    if (instance !== void 0) return instance;
    const loaded = loadWinkModel();
    if (!loaded) {
      instance = null;
      return null;
    }
    try {
      instance = loaded.winkNLP(loaded.model);
    } catch {
      instance = null;
    }
    return instance;
  }
  var import_meta3, injected, cached, instance;
  var init_wink_model = __esm({
    "src/adapters/wink-model.mjs"() {
      init_node_module();
      import_meta3 = {};
    }
  });

  // src/adapters/toml-config.mjs
  var init_toml_config = __esm({
    "src/adapters/toml-config.mjs"() {
      init_promises();
      init_node_path();
      init_dist();
    }
  });

  // src/domain/memory/session-turns.mjs
  var init_session_turns = __esm({
    "src/domain/memory/session-turns.mjs"() {
    }
  });

  // src/services/sessions.mjs
  var SESSIONS_DIR_REL;
  var init_sessions = __esm({
    "src/services/sessions.mjs"() {
      init_promises();
      init_node_path();
      init_core();
      init_session_turns();
      SESSIONS_DIR_REL = join(".tmct", "sessions");
    }
  });

  // node-stub:node:readline
  var unavailable11, createRequire11, readFileSync11, readFile11, writeFile11, appendFile11, mkdir11, mkdtemp11, rename11, unlink11, rm11, stat11, copyFile11, readdir11, createReadStream11, createWriteStream11, randomBytes11, spawnSync11, createInterface11;
  var init_node_readline = __esm({
    "node-stub:node:readline"() {
      unavailable11 = (name) => () => {
        throw new Error(name + " unavailable in the browser ask bundle");
      };
      createRequire11 = unavailable11("createRequire");
      readFileSync11 = unavailable11("readFileSync");
      readFile11 = unavailable11("readFile");
      writeFile11 = unavailable11("writeFile");
      appendFile11 = unavailable11("appendFile");
      mkdir11 = unavailable11("mkdir");
      mkdtemp11 = unavailable11("mkdtemp");
      rename11 = unavailable11("rename");
      unlink11 = unavailable11("unlink");
      rm11 = unavailable11("rm");
      stat11 = unavailable11("stat");
      copyFile11 = unavailable11("copyFile");
      readdir11 = unavailable11("readdir");
      createReadStream11 = unavailable11("createReadStream");
      createWriteStream11 = unavailable11("createWriteStream");
      randomBytes11 = unavailable11("randomBytes");
      spawnSync11 = unavailable11("spawnSync");
      createInterface11 = unavailable11("createInterface");
    }
  });

  // src/adapters/corpus/conceptnet.mjs
  var import_meta4, PKG_ROOT2, SLICE_FILE, MAP_FILE, SEON_CONCEPTS_FILE, SEON_DEFINITIONS_FILE, TIER2_DIR, TIER2_MANIFEST_FILE, WORDNET_DIR, WORDNET_MANIFEST_FILE;
  var init_conceptnet = __esm({
    "src/adapters/corpus/conceptnet.mjs"() {
      init_node_fs();
      init_promises();
      init_node_readline();
      init_node_url();
      init_node_path();
      init_dist();
      init_core();
      import_meta4 = {};
      PKG_ROOT2 = join(dirname(fileURLToPath2(import_meta4.url)), "..", "..", "..");
      SLICE_FILE = join(PKG_ROOT2, "corpus", "conceptnet", "slice.jsonl");
      MAP_FILE = join(PKG_ROOT2, "src", "adapters", "corpus", "conceptnet-map.toml");
      SEON_CONCEPTS_FILE = join(PKG_ROOT2, "corpus", "seon", "concepts.jsonl");
      SEON_DEFINITIONS_FILE = join(PKG_ROOT2, "corpus", "seon", "definitions.jsonl");
      TIER2_DIR = join(PKG_ROOT2, "corpus", "tier2");
      TIER2_MANIFEST_FILE = join(TIER2_DIR, "manifest.json");
      WORDNET_DIR = join(PKG_ROOT2, "corpus", "wordnet");
      WORDNET_MANIFEST_FILE = join(WORDNET_DIR, "manifest.json");
    }
  });

  // src/services/extensions.mjs
  function builtinExtensions() {
    return {
      // Opt-in code-domain bundle.
      seon: {
        kind: "corpus",
        active: false,
        corpusPath: SEON_CONCEPTS_FILE,
        provenancePrefix: "corpus:seon"
      },
      // Opt-in too: the committed slice is tech-domain-filtered, equally biased.
      conceptnet: {
        kind: "corpus",
        active: false,
        corpusPath: SLICE_FILE,
        provenancePrefix: "corpus:conceptnet",
        limit: void 0,
        prefer: CONCEPTNET_PREFER
      },
      // The default active bundle: everyday-world vocabulary plus the scaffolding
      // connecting WordNet's and Schema.org's independently-built taxonomies.
      human: {
        kind: "corpus",
        active: true,
        corpusPath: join(TIER2_DIR, "human.jsonl"),
        provenancePrefix: "corpus:human"
      },
      // Medium/Large SIZE tiers of `human` (additive, not separate personas): each file
      // holds only the facts that size adds beyond the previous one.
      "human-medium": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "human-medium.jsonl"),
        provenancePrefix: "corpus:human-medium"
      },
      "human-large": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "human-large.jsonl"),
        provenancePrefix: "corpus:human-large"
      },
      "tier2-aws": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "aws.jsonl"),
        provenancePrefix: "corpus:tier2-aws"
      },
      "tier2-python": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "python.jsonl"),
        provenancePrefix: "corpus:tier2-python"
      },
      "tier2-java": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "java.jsonl"),
        provenancePrefix: "corpus:tier2-java"
      },
      "tier2-general": {
        kind: "corpus",
        active: false,
        corpusPath: join(TIER2_DIR, "general.jsonl"),
        provenancePrefix: "corpus:tier2-general"
      },
      // corpus/wordnet/generate.mjs's output: a mechanical ConceptNet-shape conversion of
      // Open English WordNet, too large to hand-curate like the tier-2 bundles above.
      "wordnet-xl": {
        kind: "corpus",
        active: false,
        corpusPath: join(WORDNET_DIR, "wordnet-xl.jsonl"),
        provenancePrefix: "corpus:wordnet-xl"
      },
      "wordnet-full": {
        kind: "corpus",
        active: false,
        corpusPath: join(WORDNET_DIR, "wordnet-full.jsonl"),
        provenancePrefix: "corpus:wordnet-full"
      },
      // corpus/namenet/generate.mjs's output: species/common-name and Wikidata/WordNet
      // synonym pairs. A small, optional top-up bundle, not a primary corpus.
      namenet: {
        kind: "corpus",
        active: false,
        corpusPath: join(NAMENET_DIR, "namenet.jsonl"),
        provenancePrefix: "corpus:namenet"
      }
    };
  }
  var import_meta5, NAMENET_DIR, EXTENSION_KINDS, CONCEPTNET_PREFER, BUILTIN_EXTENSIONS;
  var init_extensions = __esm({
    "src/services/extensions.mjs"() {
      init_node_path();
      init_promises();
      init_node_url();
      init_toml_config();
      init_conceptnet();
      import_meta5 = {};
      NAMENET_DIR = join(dirname(fileURLToPath2(import_meta5.url)), "..", "..", "corpus", "namenet");
      EXTENSION_KINDS = Object.freeze(["corpus", "lexicon", "templates", "pack", "ontology"]);
      CONCEPTNET_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];
      BUILTIN_EXTENSIONS = Object.freeze(builtinExtensions());
    }
  });

  // src/adapters/prose-nlp.mjs
  var prose_nlp_exports = {};
  __export(prose_nlp_exports, {
    proseLemma: () => proseLemma
  });
  function proseLemma() {
    if (cached2 !== void 0) return cached2;
    try {
      const nlp = winkInstance();
      if (!nlp) {
        cached2 = null;
        return cached2;
      }
      const its = nlp.its;
      const memo = /* @__PURE__ */ new Map();
      cached2 = (word) => {
        const w = String(word || "");
        if (memo.has(w)) return memo.get(w);
        let out;
        try {
          out = String(nlp.readDoc(w).tokens().out(its.lemma)[0] || w).toLowerCase();
        } catch {
          out = w.toLowerCase();
        }
        memo.set(w, out);
        return out;
      };
    } catch {
      cached2 = null;
    }
    return cached2;
  }
  var cached2;
  var init_prose_nlp = __esm({
    "src/adapters/prose-nlp.mjs"() {
      init_wink_model();
    }
  });

  // src/domain/planning.mjs
  var planning_exports = {};
  __export(planning_exports, {
    findActionPath: () => findActionPath,
    findReachableSet: () => findReachableSet
  });
  function defaultStateKey(state) {
    if (state && typeof state === "object") return JSON.stringify(state);
    return String(state);
  }
  function seedFrontier(startState, applyActions) {
    const frontier = [];
    for (const { action, nextState } of applyActions(startState) || []) {
      frontier.push({ state: nextState, actions: [action], states: [startState, nextState] });
    }
    return frontier;
  }
  function findActionPath(startState, isGoal, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
    if (isGoal(startState)) return { actions: [], states: [startState] };
    let frontier = seedFrontier(startState, applyActions);
    const seen = /* @__PURE__ */ new Set([stateKey(startState)]);
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      for (const entry of frontier) if (isGoal(entry.state)) return { actions: entry.actions, states: entry.states };
      if (depth === maxDepth) break;
      const next = [];
      for (const entry of frontier) {
        const key = stateKey(entry.state);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const { action, nextState } of applyActions(entry.state) || []) {
          const nk = stateKey(nextState);
          if (seen.has(nk)) continue;
          next.push({ state: nextState, actions: [...entry.actions, action], states: [...entry.states, nextState] });
        }
      }
      frontier = next;
    }
    return null;
  }
  function findReachableSet(startState, applyActions, { maxDepth = 50, stateKey = defaultStateKey } = {}) {
    let frontier = seedFrontier(startState, applyActions);
    const seen = /* @__PURE__ */ new Set([stateKey(startState)]);
    const results = [];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      const next = [];
      for (const entry of frontier) {
        const key = stateKey(entry.state);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ node: entry.state, path: { actions: entry.actions, states: entry.states } });
        if (depth === maxDepth) continue;
        for (const { action, nextState } of applyActions(entry.state) || []) {
          const nk = stateKey(nextState);
          if (seen.has(nk)) continue;
          next.push({ state: nextState, actions: [...entry.actions, action], states: [...entry.states, nextState] });
        }
      }
      frontier = next;
    }
    return results;
  }
  var init_planning = __esm({
    "src/domain/planning.mjs"() {
    }
  });

  // src/services/chat.mjs
  init_node_path();

  // src/tools/server.mjs
  init_promises();
  init_node_path();

  // src/tools/definitions.mjs
  init_ask_vocab();
  var symbolArg = (description) => ({
    type: "object",
    required: ["symbol"],
    properties: { symbol: { type: "string", description } }
  });
  var moduleArg = (description) => ({
    type: "object",
    required: ["module"],
    properties: { module: { type: "string", description } }
  });
  var classArg = (description) => ({
    type: "object",
    required: ["class"],
    properties: { class: { type: "string", description } }
  });
  var TOOL_DEFINITIONS = Object.freeze([
    {
      name: "tmct_context",
      tier: "hot",
      summary: "A sized edit bundle for one symbol \u2014 exemplar source, sibling signatures, registration anchor and the insertion region, in one call.",
      // Lean resident schema (re-billed every turn): the minimum that still steers the agent to
      // ONE call → write, not Read.
      agentDescription: "START HERE to add/modify code: ONE call returns a sized edit bundle (exemplar source, sibling signatures, registration, insertion region) \u2014 then write directly, don't Read.",
      inputSchema: {
        type: "object",
        required: ["symbol"],
        properties: {
          symbol: { type: "string", description: "Module path (e.g. path/to/module) or a sibling function/class name defined in it." },
          depth: { type: "string", enum: ["min", "auto", "full"], default: "auto", description: "auto (sized to the task) | min (leanest) | full (every section)." }
        }
      },
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_snippet",
      tier: "hot",
      summary: "The exact source of one function, class or Class.method \u2014 its line span only, plus a one-line in-repo call hint.",
      agentDescription: "EXACT source of one function/class/Class.method by name (its line span only) + a one-line in-repo call hint. Prefer over Read for a single symbol.",
      inputSchema: {
        type: "object",
        required: ["symbol"],
        properties: {
          symbol: { type: "string", description: "function/class name, Class.method, or fn:<path>#name." }
        }
      },
      example: { symbol: "Truncator.chars" }
    },
    {
      name: "tmct_ask",
      tier: "hot",
      summary: "A structural question in plain English, answered from the graph in one call \u2014 no model, and a clean miss instead of a guess.",
      agentDescription: 'Ask a structural question in plain English: "which functions call X", "what uses X", "where is X defined", "when did X change". One call, no model. A clean miss beats a guess.',
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: 'A free-text question, e.g. "which functions explicitly couple to logging".' }
        }
      },
      example: { query: "which modules import src/core/model.mjs" },
      chat: {
        // The canonical question shapes ask.mjs resolves to a traversal. Every example runs
        // against examples/mini-webapp, which is what the README's worked block invokes.
        exampleRepo: "examples/mini-webapp",
        grammar: [
          {
            form: "which <things> <relation-verb> <entity>",
            example: "which modules import src/core/model.mjs",
            answers: "the imports edge, read forwards"
          },
          {
            form: "what is <relation-verb-passive> <entity>",
            example: "what is imported by src/core/store.mjs",
            answers: "the same edge, read backwards \u2014 a passive is the opposite direction, not a synonym"
          },
          {
            form: "what <relation-verb> <entity>",
            example: "what uses src/lib/http.mjs",
            answers: "the uses union: imports plus calls"
          },
          {
            form: "where is <entity> <where-marker>",
            example: "where is saveStore defined",
            answers: "the definition's file and line span"
          },
          {
            form: "when did <entity> change",
            example: "when did src/core/store.mjs change",
            answers: "the commits that touched it, newest first"
          }
        ],
        whereMarkers: WHERE_MARKERS
      }
    },
    {
      name: "tmct_describe",
      tier: "cold",
      summary: "Locate one symbol and list its typed edges (both directions) with provenance.",
      inputSchema: symbolArg("A module path, symbol name, or Class.method."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_signature",
      tier: "cold",
      summary: "One symbol's API surface (params, returns, raises/catches, flags, decorators, doc) without the body.",
      inputSchema: symbolArg("A function, method, or Class.method name."),
      example: { symbol: "Truncator.chars" }
    },
    {
      name: "tmct_impact",
      tier: "cold",
      summary: "Transitive reverse closure over imports/calls \u2014 what breaks if a module changes, by depth, with tests.",
      inputSchema: moduleArg("The module whose dependents you want."),
      example: { module: "django/utils/text.py" }
    },
    {
      name: "tmct_search",
      tier: "cold",
      summary: "Free-text/ranked lookup over the code-map to find the right module or symbol.",
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          query: { type: "string", description: "Free text to rank against the code-map. Required unless kind narrows the search on its own." },
          kind: { type: "string", description: "Restrict to an entity class, e.g. function, class, module." },
          decorator: { type: "string", description: "Restrict to definitions carrying this decorator." },
          name: { type: "string", description: "Restrict to definitions whose name matches." }
        }
      },
      example: { query: "template filters", kind: "function" }
    },
    {
      name: "tmct_members",
      tier: "cold",
      summary: "A class's methods + attributes (file:line, decorators) in one slice.",
      inputSchema: classArg("The class whose members you want."),
      example: { class: "Truncator" }
    },
    {
      name: "tmct_subclasses",
      tier: "cold",
      summary: "A class's base classes plus the transitive set of classes that extend it.",
      inputSchema: classArg("The class to walk the inheritance edges of."),
      example: { class: "Field" }
    },
    {
      name: "tmct_architecture",
      tier: "cold",
      summary: "Package/module map + the most-imported hub modules (optionally scoped to a package).",
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          package: { type: "string", description: "Scope the map to one package. Omit for the whole repository." }
        }
      },
      example: { package: "django/template" }
    },
    {
      name: "tmct_exports",
      tier: "cold",
      summary: "A module's public __all__ surface, each name resolved to the module that defines it.",
      inputSchema: moduleArg("The module whose public API surface you want."),
      example: { module: "django/db/models/__init__.py" }
    },
    {
      name: "tmct_tests_for",
      tier: "cold",
      summary: "The test modules covering a symbol or module, from the typed test edges.",
      inputSchema: symbolArg("The symbol or module to find covering tests for."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_untested",
      tier: "cold",
      summary: "Source modules with no covering test module \u2014 a coverage-gap view (no arguments).",
      inputSchema: { type: "object", required: [], properties: {} },
      example: {}
    },
    {
      name: "tmct_history",
      tier: "cold",
      summary: "Recent commits that touched a symbol's module (newest first).",
      inputSchema: symbolArg("The symbol whose module's history you want."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_file_history",
      tier: "cold",
      summary: "Commits that touched a symbol's module, each with author / date / subject.",
      inputSchema: symbolArg("The symbol whose module's history you want."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_method_history",
      tier: "cold",
      summary: "Commits that touched a specific method symbol (fine-grained), with author / date / subject.",
      inputSchema: symbolArg("A Class.method name."),
      example: { symbol: "Truncator.chars" }
    },
    {
      name: "tmct_class_history",
      tier: "cold",
      summary: "Commits that touched a specific class symbol (fine-grained), with author / date / subject.",
      inputSchema: symbolArg("A class name."),
      example: { symbol: "Truncator" }
    },
    {
      name: "tmct_callers",
      tier: "cold",
      summary: "Modules that call into a symbol's module (one hop).",
      inputSchema: symbolArg("The symbol whose callers you want."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_callees",
      tier: "cold",
      summary: "Modules a symbol's module calls into (one hop).",
      inputSchema: symbolArg("The symbol whose callees you want."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_calls",
      tier: "cold",
      summary: "The in-repo symbols a function calls (fn\u2192fn), each with file:line.",
      inputSchema: symbolArg("The function whose in-repo call sites you want."),
      example: { symbol: "slugify" }
    },
    {
      name: "tmct_cochanges",
      tier: "cold",
      summary: "Modules that historically change in the same commit as a symbol's module (git co-change).",
      inputSchema: symbolArg("The symbol whose module's change-coupling you want."),
      example: { symbol: "django/utils/text.py" }
    },
    {
      name: "tmct_context_more",
      tier: "cold",
      summary: "The bundle sections a lean tmct_context omitted (siblings / tests / cochange / class members / re-exports).",
      inputSchema: symbolArg("The symbol a lean tmct_context bundle was built for."),
      example: { symbol: "django/utils/text.py" }
    }
  ]);
  var HOT_TOOLS = TOOL_DEFINITIONS.filter((t) => t.tier === "hot");
  var COLD_TOOLS = TOOL_DEFINITIONS.filter((t) => t.tier === "cold");
  var TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((t) => t.name));

  // src/tools/server.mjs
  init_config();

  // src/adapters/source.mjs
  var source_exports = {};
  __export(source_exports, {
    clearCache: () => clearCache,
    emptyEntities: () => emptyEntities,
    fetchEntities: () => fetchEntities,
    registerProvider: () => registerProvider
  });
  init_promises();
  init_config();

  // src/adapters/graph-merge.mjs
  function idsOf(payload) {
    const s = /* @__PURE__ */ new Set();
    for (const ind of Array.isArray(payload?.individuals) ? payload.individuals : []) {
      if (ind && ind.id) s.add(ind.id);
    }
    return s;
  }
  function mergeEntityPayloads(entries) {
    const list = (Array.isArray(entries) ? entries : []).map((e, i) => ({
      file: e?.file,
      payload: e?.payload || {},
      name: e?.name != null && String(e.name).length ? String(e.name) : String(i)
    }));
    const idSets = list.map(({ payload }) => idsOf(payload));
    const seenInCount = /* @__PURE__ */ new Map();
    for (const s of idSets) for (const id of s) seenInCount.set(id, (seenInCount.get(id) || 0) + 1);
    const colliding = new Set([...seenInCount.entries()].filter(([, n]) => n > 1).map(([id]) => id));
    const merged = {
      generated_at: "",
      classes: [],
      vocabulary: [],
      objectProperties: [],
      individuals: [],
      proseIndex: {}
    };
    let latestGeneratedAt = "";
    let everyPayloadIsBootstrap = list.length > 0;
    for (const { payload, name } of list) {
      everyPayloadIsBootstrap = everyPayloadIsBootstrap && Boolean(payload.bootstrap);
      if (typeof payload.generated_at === "string" && payload.generated_at > latestGeneratedAt) {
        latestGeneratedAt = payload.generated_at;
      }
      const rewriteId = (id) => colliding.has(id) ? `${name}/${id}` : id;
      if (Array.isArray(payload.classes)) merged.classes.push(...payload.classes);
      if (Array.isArray(payload.vocabulary)) merged.vocabulary.push(...payload.vocabulary);
      for (const ind of Array.isArray(payload.individuals) ? payload.individuals : []) {
        if (!ind) continue;
        const out = { ...ind };
        if (out.id) out.id = rewriteId(out.id);
        if (Array.isArray(out.derived_from)) {
          out.derived_from = out.derived_from.map((r) => rewriteId(r));
        }
        if (Array.isArray(out.mentions)) {
          out.mentions = out.mentions.map((m) => m && m.id ? { ...m, id: rewriteId(m.id) } : m);
        }
        merged.individuals.push(out);
      }
      for (const grp of Array.isArray(payload.objectProperties) ? payload.objectProperties : []) {
        if (!grp) continue;
        const out = { ...grp };
        if (Array.isArray(out.examples)) {
          out.examples = out.examples.map((e) => {
            if (!e) return e;
            const ne = { ...e };
            if (ne.subject) ne.subject = rewriteId(ne.subject);
            if (ne.object) ne.object = rewriteId(ne.object);
            return ne;
          });
        }
        merged.objectProperties.push(out);
      }
      const proseIndex = payload.proseIndex && typeof payload.proseIndex === "object" ? payload.proseIndex : {};
      for (const [word, ids] of Object.entries(proseIndex)) {
        const bucket = merged.proseIndex[word] || (merged.proseIndex[word] = []);
        for (const id of Array.isArray(ids) ? ids : []) {
          const rewritten = rewriteId(id);
          if (!bucket.includes(rewritten)) bucket.push(rewritten);
        }
      }
    }
    merged.generated_at = latestGeneratedAt;
    if (everyPayloadIsBootstrap) merged.bootstrap = true;
    return merged;
  }

  // src/adapters/source.mjs
  var cache = null;
  var mergedCache = null;
  var provider = null;
  function clearCache() {
    cache = null;
    mergedCache = null;
  }
  function registerProvider(fn) {
    if (fn != null && typeof fn !== "function") {
      throw new TypeError("registerProvider expects a function (config) => entities payload, or null");
    }
    const prev = provider;
    provider = fn ?? null;
    cache = null;
    return prev;
  }
  function emptyEntities() {
    return {
      generated_at: "",
      bootstrap: true,
      classes: [],
      vocabulary: [],
      objectProperties: [],
      individuals: [],
      proseIndex: {}
    };
  }
  async function readOneGraphFile(file) {
    let text;
    try {
      text = await readFile2(file, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return emptyEntities();
      throw new ToolError(`cannot read graph artifact at ${file} (${e?.code || e?.message || e})`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ToolError(`graph artifact ${file} is not valid JSON`);
    }
  }
  async function fetchMergedEntities(config) {
    const files = config.graphFiles;
    const key = [...files].map(String).sort().join("|");
    if (mergedCache && mergedCache.key === key) return mergedCache.payload;
    const entries = [];
    for (let i = 0; i < files.length; i++) {
      const payload = await readOneGraphFile(files[i]);
      entries.push({ file: files[i], payload, name: config.graphNames?.[i] });
    }
    const merged = mergeEntityPayloads(entries);
    mergedCache = { key, payload: merged };
    return merged;
  }
  async function fetchEntities(config) {
    if (provider) {
      let payload2;
      try {
        payload2 = await provider(config);
      } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError(`graph provider failed (${e?.message || e})`);
      }
      if (!payload2 || typeof payload2 !== "object") {
        throw new ToolError("graph provider returned no entities payload");
      }
      return payload2;
    }
    if (Array.isArray(config.graphFiles) && config.graphFiles.length > 1) {
      return fetchMergedEntities(config);
    }
    if (cache && cache.file === config.graphFile) return cache.payload;
    let text;
    try {
      text = await readFile2(config.graphFile, "utf8");
    } catch (e) {
      if (e?.code === "ENOENT") return emptyEntities();
      throw new ToolError(
        `cannot read graph artifact at ${config.graphFile} (${e?.code || e?.message || e})`
      );
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ToolError(`graph artifact ${config.graphFile} is not valid JSON`);
    }
    cache = { file: config.graphFile, payload };
    return payload;
  }

  // src/tools/server.mjs
  init_ask();
  init_graph_service();

  // src/tools/graph-load.mjs
  init_config();
  init_codegraph();
  async function loadGraph(config, source) {
    const payload = await source.fetchEntities(config);
    const graph = parseEntities(payload);
    if (!graph.individuals.length) {
      throw new ToolError(
        `the graph at ${config.graphFile} is empty \u2014 no entities to answer from yet (this repo starts with no graph; the chat session folds the conversation into one).`
      );
    }
    return graph;
  }

  // src/tools/handlers/tmct-context.mjs
  init_promises();
  init_node_path();
  init_config();
  init_source_slice();
  init_codegraph();
  init_ask();
  init_graph_service();

  // src/tools/handlers/kit.mjs
  init_config();
  init_codegraph();
  var SNIPPET_MAX_LINES = 200;
  function requiredArg(args, key) {
    const value = String(args?.[key] || "").trim();
    if (!value) throw new ToolError(`${key} is required`);
    return value;
  }
  function resolveOrThrow(svc, symbol, what) {
    const { match, candidates } = resolveSymbol(svc.graph, symbol);
    if (!match) {
      throw new ToolError(
        `no entity matching ${what} "${symbol}" in the code-map graph. Try a repo-relative path (e.g. path/to/module), a basename, or tmct_search for a fuzzy lookup.`
      );
    }
    return { match, candidates };
  }
  var symbolHandler = (render3) => (args, { graph, svc }) => {
    const { match } = resolveOrThrow(svc, requiredArg(args, "symbol"), "symbol");
    return render3(graph, match);
  };

  // src/tools/handlers/tmct-context.mjs
  async function buildContextBundle(args, { config, source = source_exports, trim = false, tel = null } = {}) {
    const symbol = String(args?.symbol || "").trim();
    if (!symbol) throw new ToolError("symbol is required");
    const depth = String(args?.depth || "auto").trim().toLowerCase();
    const min = Boolean(args?.min);
    const untuned = Boolean(args?.untuned);
    const max = Boolean(args?.max);
    const graph = await loadGraph(config, source);
    const repoRoot = dirname(dirname(config.graphFile));
    const svc = createGraphService(graph, { sourceAccess: true, repoRoot, readFile: readFile2, tel, ask });
    const { match } = resolveOrThrow(svc, symbol, "symbol");
    const plan = contextPlan(graph, match);
    let tier;
    let mask;
    let topup = false;
    if (min || depth === "min") {
      tier = "TINY";
      mask = bundleMask("TINY");
    } else if (max || depth === "full") {
      tier = "FULL";
      mask = bundleMask("FULL");
      topup = true;
    } else ({ tier, mask, topup } = sizeBundle(plan, graph, { untuned }));
    if (trim && !max) mask = trimBundleMask(mask);
    let lines = null;
    if (plan.moduleLabel) {
      try {
        ({ lines } = await readSpanSafe({ readFile: readFile2, repoRoot, path: plan.moduleLabel }));
      } catch {
        lines = null;
      }
    }
    const lineAt = (n) => lines && lines[n - 1] != null ? lines[n - 1].trim() : "";
    const sliceBody = (start, end) => sliceSpan(lines, start, end, SNIPPET_MAX_LINES).text;
    const out = [
      `Edit context for ${plan.moduleLabel} [${tier}${trim ? " secondary" : ""}] \u2014 assembled from the typed graph + that file. You do NOT need to Read it; write the new code directly after reviewing this.`
    ];
    if (mask.anchor && plan.anchor?.site && lines) {
      const { start, end } = plan.anchor.site;
      out.push(`
## anchor: ${plan.anchor.label} (${plan.anchor.class}) @ ${plan.moduleLabel}:${start}-${end}`);
      out.push(sliceBody(start, end));
      if (plan.callHint) out.push(plan.callHint);
    }
    if (mask.registration && plan.globals.length) {
      out.push(`
## registration / module globals (replicate this pattern):`);
      for (const g of plan.globals) out.push(`  ${g.label} = ${g.value}${g.site ? `  [:${g.site.start}]` : ""}`);
    }
    if (mask.exemplar && plan.exemplar?.site && lines) {
      const { start, end } = plan.exemplar.site;
      const dec = plan.exemplar.decorators ? ` @${plan.exemplar.decorators}` : "";
      out.push(`
## closest example (full body) \u2014 copy this style: ${plan.exemplar.label} (${plan.exemplar.class})${dec} @ ${plan.moduleLabel}:${start}-${end}`);
      out.push(sliceBody(start, end));
      if (plan.callHint) out.push(plan.callHint);
    }
    if (mask.inlinedCallees && plan.calleeBodies.length && lines) {
      let budget = 120;
      for (const cb of plan.calleeBodies) {
        if (budget <= 0) break;
        const start = cb.site.start;
        const fromThisFile = cb.site.path === plan.moduleLabel;
        const bodyLines = fromThisFile && lines ? lines : await readSpanSafe({ readFile: readFile2, repoRoot, path: cb.site.path }).then((r) => r.lines).catch(() => null);
        if (!bodyLines) continue;
        const sliced = sliceSpan(bodyLines, start, cb.site.end, budget);
        out.push(`
## inlined callee body (depth-1 in-repo call): ${cb.label} @ ${cb.site.path}:${start}-${cb.site.end}`);
        out.push(sliced.text);
        budget -= sliced.end - start + 1;
      }
    }
    if (mask.classMembers && plan.classMembers && plan.classMembers.members.length) {
      out.push(`
## members of ${plan.classMembers.className} (the edit likely lives INSIDE this class \u2014 copy a member's shape, do not read the class body):`);
      for (const m of plan.classMembers.members) {
        const short = String(m.label).split(".").pop();
        const sig = m.params != null && m.params !== "" ? `(${m.params})${m.returns ? ` -> ${m.returns}` : ""}` : "";
        const dec = m.decorators ? `@${m.decorators} ` : "";
        const r = m.raises ? `  raises=${m.raises}` : "";
        out.push(`  ${m.class} ${short}${m.site ? ` :${m.site.start}` : ""}  ${dec}${short}${sig}${r}`);
      }
    }
    if (mask.siblings && plan.siblings.length) {
      out.push(`
## sibling symbols to copy the style of (most relevant first; ${plan.siblings.length} total):`);
      for (const s of plan.siblings.slice(0, plan.siblingCap)) {
        const sig = s.site ? lineAt(s.site.start) : "";
        const dec = s.decorators ? `@${s.decorators} ` : "";
        const r = s.raises ? `  raises=${s.raises}` : "";
        out.push(`  ${s.class} ${s.label}${s.site ? ` :${s.site.start}` : ""}  ${dec}${sig}${r}`);
      }
      if (plan.siblings.length > plan.siblingCap) {
        out.push(`  \u2026+${plan.siblings.length - plan.siblingCap} more (use tmct_search kind=function or tmct_snippet <name> for any of them)`);
      }
    }
    if (mask.allExports && plan.allExports) {
      out.push(`
## module __all__ \u2014 this module curates its public API; ADD your new public symbol to this list so it is importable:
  ${plan.allExports}`);
    }
    if (mask.reexports && plan.exports && plan.exports.length) out.push(`
## re-exported symbols (resolved __all__ \u2192 defining module): ${plan.exports.join(", ")}`);
    if (mask.insertionRegion && plan.insertionRegion && lines) {
      const start = plan.insertionRegion.start;
      const end = Math.min(lines.length, start + 40 - 1);
      out.push(`
## insertion region (write your new sibling here) \u2014 ${plan.moduleLabel}:${start}-${end}`);
      out.push(lines.slice(start - 1, end).map((l, i) => `${start + i}	${l}`).join("\n"));
    } else if (plan.insertion) {
      out.push(`
## insert the new sibling after line ~${plan.insertion} (end of the last top-level definition).`);
    }
    if (mask.tests && plan.tests.length) out.push(`
## covering tests: ${plan.tests.join(", ")}`);
    if (mask.cochange && plan.cochange && plan.cochange.length) {
      out.push(`
## usually changed together (consider editing these too): ${plan.cochange.map((c) => `${c.label} (\xD7${c.weight})`).join(", ")}`);
    }
    out.push(`
You now have the snippet, the sibling style, the registration anchor and the tests. Write the new code with Edit/Write \u2014 do NOT Read ${plan.moduleLabel}.`);
    if (tier !== "FULL") {
      out.push(`(bundle tier ${tier}; for any omitted sections run tmct_context_more {"symbol":"${symbol}"}, or tmct_context with depth="full".)`);
    }
    return { text: out.join("\n"), tier, topup };
  }
  async function tmct_context(args, { config, source, tel }) {
    return (await buildContextBundle(args, { config, source, tel })).text;
  }
  tmct_context.ownsGraphLoad = true;

  // src/tools/handlers/tmct-context-more.mjs
  init_codegraph();
  function tmct_context_more(args, { graph, svc }) {
    const { match } = resolveOrThrow(svc, requiredArg(args, "symbol"), "symbol");
    return renderContextMore(contextPlan(graph, match));
  }

  // src/tools/handlers/tmct-describe.mjs
  init_codegraph();

  // src/tools/memory-fallthrough.mjs
  init_node_path();
  init_core();
  var ISA_PREDICATES = /* @__PURE__ */ new Set(["rdfs:subClassOf", "rdf:type"]);
  var MEMORY_LIST_CAP = 40;
  async function memoryFactRows(config) {
    try {
      return readFactRows(await loadMemory(dirname(dirname(config.graphFile))));
    } catch {
      return [];
    }
  }
  function memoryProvenance(rows) {
    const provs = [...new Set(rows.map((r) => r.provenance).filter(Boolean))];
    if (!provs.length) return "provenance: memory/corpus facts";
    const shown = provs.slice(0, 2).join("; ");
    return `provenance: ${shown}${provs.length > 2 ? `, +${provs.length - 2} more source(s)` : ""}`;
  }
  function renderMemorySubclasses(rows, term) {
    const t = normFactTerm(term);
    const hits = rows.filter((r) => ISA_PREDICATES.has(r.predicate) && r.object === t);
    if (!hits.length) return null;
    const labels = [...new Set(hits.map((r) => r.subject))].sort();
    const shown = labels.slice(0, MEMORY_LIST_CAP);
    const tail = labels.length > MEMORY_LIST_CAP ? `
  \u2026+${labels.length - MEMORY_LIST_CAP} more` : "";
    return `"${term}" is not a code-map entity \u2014 answering from memory/corpus facts. ${labels.length} known subclass(es):
  ${shown.join("\n  ")}${tail}
(${memoryProvenance(hits)})`;
  }
  function renderMemoryDefinition(rows, term) {
    const t = normFactTerm(term);
    const isa = rows.filter((r) => ISA_PREDICATES.has(r.predicate) && (r.subject === t || r.object === t));
    if (!isa.length) return null;
    const supers = [...new Set(isa.filter((r) => r.subject === t).map((r) => r.object))];
    const subs = [...new Set(isa.filter((r) => r.object === t).map((r) => r.subject))].sort();
    const lines = [`"${term}" is not a code-map entity \u2014 answering from memory/corpus facts.`];
    if (supers.length) lines.push(`is a: ${supers.slice(0, MEMORY_LIST_CAP).join(", ")}`);
    if (subs.length) {
      const tail = subs.length > MEMORY_LIST_CAP ? `, +${subs.length - MEMORY_LIST_CAP} more` : "";
      lines.push(`known subclasses (${subs.length}): ${subs.slice(0, MEMORY_LIST_CAP).join(", ")}${tail}`);
    }
    lines.push(`(${memoryProvenance(isa)})`);
    return lines.join("\n");
  }

  // src/tools/handlers/tmct-describe.mjs
  async function tmct_describe(args, { graph, svc, config }) {
    const symbol = requiredArg(args, "symbol");
    const { match, candidates } = resolveSymbol(svc.graph, symbol);
    if (match) return renderDescribe(graph, match, { candidates });
    const fallback = renderMemoryDefinition(await memoryFactRows(config), symbol);
    if (fallback) return fallback;
    resolveOrThrow(svc, symbol, "symbol");
  }

  // src/tools/handlers/tmct-snippet.mjs
  init_promises();
  init_config();
  init_source_slice();
  init_codegraph();
  async function tmct_snippet(args, { graph, svc, repoRoot }) {
    const symbol = requiredArg(args, "symbol");
    const { match, candidates } = resolveOrThrow(svc, symbol, "symbol");
    const site = siteOf(match);
    if (!site) {
      throw new ToolError(
        `"${match.label}" (${match.class || "Entity"}) has no source span in the graph \u2014 it is likely a module. Use tmct_describe for its contents, then tmct_snippet one of the functions/classes it defines.`
      );
    }
    let sliced;
    try {
      sliced = await readSpanSafe({
        readFile: readFile2,
        repoRoot,
        path: site.path,
        start: site.start,
        end: site.end,
        maxLines: SNIPPET_MAX_LINES
      });
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(`could not read ${site.path} (${e?.code || e?.message || e})`);
    }
    const { text: body, truncated } = sliced;
    const span = site.end > site.start ? `${site.start}-${site.end}` : `${site.start}`;
    const header = `${match.label} \u2014 ${match.class || "Entity"} @ ${site.path}:${span}`;
    const note = truncated ? `
\u2026 (truncated to ${SNIPPET_MAX_LINES} lines; full span ${span})` : "";
    const cand = candidates.length ? `
(other matches: ${candidates.map((c) => c.label).join(", ")})` : "";
    const hint = callHint(graph, match);
    return `${header}
${body}${note}${hint ? `
${hint}` : ""}${cand}`;
  }

  // src/tools/handlers/tmct-signature.mjs
  init_codegraph();
  var tmct_signature = symbolHandler(renderSignature);

  // src/tools/handlers/tmct-impact.mjs
  init_codegraph();
  function tmct_impact(args, { graph, svc }) {
    const { match } = resolveOrThrow(svc, requiredArg(args, "module"), "module");
    return renderImpact(graph, match);
  }

  // src/tools/handlers/tmct-search.mjs
  init_config();
  init_codegraph();
  async function tmct_search(args, { graph, config }) {
    const query = String(args?.query || "").trim();
    const kind = String(args?.kind || "").trim();
    if (!query && !kind) throw new ToolError("query is required");
    const out = renderSearch(graph, query, {
      kind,
      decorator: String(args?.decorator || "").trim(),
      name: String(args?.name || "").trim()
    });
    if (!kind && /^no module matches/.test(out)) {
      const fallback = renderMemoryDefinition(await memoryFactRows(config), query);
      if (fallback) return fallback;
    }
    return out;
  }

  // src/tools/handlers/tmct-members.mjs
  init_codegraph();
  async function tmct_members(args, { graph, svc, config }) {
    const symbol = requiredArg(args, "class");
    const { match } = resolveSymbol(svc.graph, symbol);
    if (match) return renderMembers(graph, match);
    const fallback = renderMemorySubclasses(await memoryFactRows(config), symbol);
    if (fallback) return fallback;
    resolveOrThrow(svc, symbol, "class");
  }

  // src/tools/handlers/tmct-subclasses.mjs
  init_codegraph();
  async function tmct_subclasses(args, { graph, svc, config }) {
    const symbol = requiredArg(args, "class");
    const { match } = resolveSymbol(svc.graph, symbol);
    if (match) return renderSubclasses(graph, match);
    const fallback = renderMemorySubclasses(await memoryFactRows(config), symbol);
    if (fallback) return fallback;
    resolveOrThrow(svc, symbol, "class");
  }

  // src/tools/handlers/tmct-architecture.mjs
  init_codegraph();
  function tmct_architecture(args, { graph }) {
    return renderArchitecture(graph, { pkg: String(args?.package || "").trim() });
  }

  // src/tools/handlers/tmct-exports.mjs
  init_codegraph();
  function tmct_exports(args, { graph, svc }) {
    const { match } = resolveOrThrow(svc, requiredArg(args, "module"), "module");
    return renderExports(graph, match);
  }

  // src/tools/handlers/tmct-untested.mjs
  init_codegraph();
  function tmct_untested(_args, { graph }) {
    return renderUntested(graph);
  }

  // src/tools/handlers/tmct-ask.mjs
  init_config();
  init_ask();
  function tmct_ask(args, { graph }) {
    const { content, tmct_ask: envelope } = ask(graph, requiredArg(args, "query"));
    return `${content}

---tmct_ask---
${JSON.stringify(envelope, null, 2)}`;
  }

  // src/tools/handlers/tmct-tests-for.mjs
  init_codegraph();
  var tmct_tests_for = symbolHandler(renderTestsFor);

  // src/tools/handlers/tmct-history.mjs
  init_codegraph();
  var tmct_history = symbolHandler(renderHistory);

  // src/tools/handlers/tmct-file-history.mjs
  init_codegraph();
  var tmct_file_history = symbolHandler(renderFileHistory);

  // src/tools/handlers/tmct-method-history.mjs
  init_codegraph();
  var tmct_method_history = symbolHandler(renderMethodHistory);

  // src/tools/handlers/tmct-class-history.mjs
  init_codegraph();
  var tmct_class_history = symbolHandler(renderClassHistory);

  // src/tools/handlers/tmct-callers.mjs
  init_codegraph();
  var tmct_callers = symbolHandler(renderCallers);

  // src/tools/handlers/tmct-callees.mjs
  init_codegraph();
  var tmct_callees = symbolHandler(renderCallees);

  // src/tools/handlers/tmct-calls.mjs
  init_codegraph();
  var tmct_calls = symbolHandler(renderCalls);

  // src/tools/handlers/tmct-cochanges.mjs
  init_codegraph();
  var tmct_cochanges = symbolHandler(renderCochanges);

  // src/tools/handlers/index.mjs
  var HANDLERS = Object.freeze({
    tmct_context,
    tmct_context_more,
    tmct_describe,
    tmct_snippet,
    tmct_signature,
    tmct_impact,
    tmct_search,
    tmct_members,
    tmct_subclasses,
    tmct_architecture,
    tmct_exports,
    tmct_untested,
    tmct_ask,
    tmct_tests_for,
    tmct_history,
    tmct_file_history,
    tmct_method_history,
    tmct_class_history,
    tmct_callers,
    tmct_callees,
    tmct_calls,
    tmct_cochanges
  });

  // src/tools/server.mjs
  init_nlp_registry();

  // adapter-stub-strategies/constructions.mjs:../domain/interpret/strategies/constructions.mjs
  var setConstructionBanks = () => {
  };

  // src/tools/server.mjs
  init_ask_nlp();

  // adapter-stub-corpus/construction-banks.mjs:../adapters/corpus/construction-banks.mjs
  var readConstructionFiles = () => ({ relations: [], constructions: [] });

  // src/tools/server.mjs
  setDefaultNlpAdapter(nlpAdapter);
  setConstructionBanks(readConstructionFiles);
  var TOOLS = HOT_TOOLS.map(({ name, agentDescription, inputSchema }) => ({
    name,
    description: agentDescription,
    inputSchema
  }));

  // src/services/chat.mjs
  init_config();
  init_codegraph();
  init_ask();

  // node-stub:node:crypto
  var unavailable4 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire4 = unavailable4("createRequire");
  var readFileSync4 = unavailable4("readFileSync");
  var readFile4 = unavailable4("readFile");
  var writeFile4 = unavailable4("writeFile");
  var appendFile4 = unavailable4("appendFile");
  var mkdir4 = unavailable4("mkdir");
  var mkdtemp4 = unavailable4("mkdtemp");
  var rename4 = unavailable4("rename");
  var unlink4 = unavailable4("unlink");
  var rm4 = unavailable4("rm");
  var stat4 = unavailable4("stat");
  var copyFile4 = unavailable4("copyFile");
  var readdir4 = unavailable4("readdir");
  var createReadStream4 = unavailable4("createReadStream");
  var createWriteStream4 = unavailable4("createWriteStream");
  var randomBytes4 = unavailable4("randomBytes");
  var spawnSync4 = unavailable4("spawnSync");
  var createInterface4 = unavailable4("createInterface");

  // src/services/chat.mjs
  init_templates();

  // src/domain/memory/bias.mjs
  var CORPUS_SOURCE_RE = /^src:corpus:(.+)$/;
  function biasForSourceId(sourceId, biasByBundle = {}) {
    const m = CORPUS_SOURCE_RE.exec(String(sourceId || ""));
    if (!m) return 1;
    const v = biasByBundle?.[m[1]];
    return typeof v === "number" && Number.isFinite(v) ? v : 1;
  }
  function biasForRow(row, biasByBundle = {}) {
    const ids = Array.isArray(row?.sourceIds) ? row.sourceIds : [];
    if (!ids.length) return 1;
    return Math.max(...ids.map((id) => biasForSourceId(id, biasByBundle)));
  }
  function rankByBiasThenTrust(rows, biasByBundle = {}) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row, index) => ({ row, index, bias: biasForRow(row, biasByBundle) })).sort((a, b) => b.bias - a.bias || (b.row?.trust ?? 0) - (a.row?.trust ?? 0) || a.index - b.index).map((x) => x.row);
  }

  // src/services/chat.mjs
  init_core();
  init_capability();
  init_finish();

  // src/services/sentences.mjs
  init_wink_model();

  // src/services/chat.mjs
  init_ask_vocab();
  init_normalize();
  init_nlp_registry();
  init_ask_nlp();
  init_fuzzy();

  // src/services/chat-session.mjs
  init_node_path();
  init_node_fs();
  init_promises();

  // node-stub:node:os
  var unavailable8 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire8 = unavailable8("createRequire");
  var readFileSync8 = unavailable8("readFileSync");
  var readFile8 = unavailable8("readFile");
  var writeFile8 = unavailable8("writeFile");
  var appendFile8 = unavailable8("appendFile");
  var mkdir8 = unavailable8("mkdir");
  var mkdtemp8 = unavailable8("mkdtemp");
  var rename8 = unavailable8("rename");
  var unlink8 = unavailable8("unlink");
  var rm8 = unavailable8("rm");
  var stat8 = unavailable8("stat");
  var copyFile8 = unavailable8("copyFile");
  var readdir8 = unavailable8("readdir");
  var createReadStream8 = unavailable8("createReadStream");
  var createWriteStream8 = unavailable8("createWriteStream");
  var randomBytes8 = unavailable8("randomBytes");
  var spawnSync8 = unavailable8("spawnSync");
  var createInterface8 = unavailable8("createInterface");

  // node-stub:node:readline/promises
  var unavailable9 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire9 = unavailable9("createRequire");
  var readFileSync9 = unavailable9("readFileSync");
  var readFile9 = unavailable9("readFile");
  var writeFile9 = unavailable9("writeFile");
  var appendFile9 = unavailable9("appendFile");
  var mkdir9 = unavailable9("mkdir");
  var mkdtemp9 = unavailable9("mkdtemp");
  var rename9 = unavailable9("rename");
  var unlink9 = unavailable9("unlink");
  var rm9 = unavailable9("rm");
  var stat9 = unavailable9("stat");
  var copyFile9 = unavailable9("copyFile");
  var readdir9 = unavailable9("readdir");
  var createReadStream9 = unavailable9("createReadStream");
  var createWriteStream9 = unavailable9("createWriteStream");
  var randomBytes9 = unavailable9("randomBytes");
  var spawnSync9 = unavailable9("spawnSync");
  var createInterface9 = unavailable9("createInterface");

  // node-stub:node:child_process
  var unavailable10 = (name) => () => {
    throw new Error(name + " unavailable in the browser ask bundle");
  };
  var createRequire10 = unavailable10("createRequire");
  var readFileSync10 = unavailable10("readFileSync");
  var readFile10 = unavailable10("readFile");
  var writeFile10 = unavailable10("writeFile");
  var appendFile10 = unavailable10("appendFile");
  var mkdir10 = unavailable10("mkdir");
  var mkdtemp10 = unavailable10("mkdtemp");
  var rename10 = unavailable10("rename");
  var unlink10 = unavailable10("unlink");
  var rm10 = unavailable10("rm");
  var stat10 = unavailable10("stat");
  var copyFile10 = unavailable10("copyFile");
  var readdir10 = unavailable10("readdir");
  var createReadStream10 = unavailable10("createReadStream");
  var createWriteStream10 = unavailable10("createWriteStream");
  var randomBytes10 = unavailable10("randomBytes");
  var spawnSync10 = unavailable10("spawnSync");
  var createInterface10 = unavailable10("createInterface");

  // src/services/chat-session.mjs
  init_config();

  // src/services/cli-args.mjs
  init_node_path();
  init_promises();
  init_node_path();
  init_toml_config();
  init_config();

  // src/services/chat-session.mjs
  init_codegraph();
  init_sessions();

  // src/services/telemetry.mjs
  init_promises();
  init_node_path();

  // src/services/chat-session.mjs
  init_extensions();

  // src/services/chat.mjs
  setDefaultNlpAdapter(nlpAdapter);
  setConstructionBanks(readConstructionFiles);
  var CONTEXT_WORDS = /* @__PURE__ */ new Set(["it", "this", "that", "here"]);
  var isPronoun = (s) => CONTEXT_WORDS.has(String(s || "").trim().toLowerCase());
  var GOAL_BY_KIND = {
    imports: "understand a dependency/import relationship",
    uses: "understand a dependency/usage relationship (imports and/or calls)",
    calls: "understand a call relationship",
    callsSymbol: "understand a call relationship",
    defines: "locate what a module/class defines",
    contains: "understand class membership (methods/attributes)",
    tests: "assess test coverage",
    inherits: "understand a class hierarchy/inheritance relationship",
    touches: "understand commit/change history",
    touchesSymbol: "understand commit/change history",
    cochange: "understand change-coupling between modules",
    reexports: "understand a module's public exports/API surface"
  };
  var goalNoun = (entityType) => entityType ? `${String(entityType).toLowerCase()}(s)` : "entities";
  var TAUGHT_FACT_LOOKUP_GOAL = "look up a taught fact about a subject/verb/object";
  function deduceGoalFromParsed(parsed) {
    if (!parsed) return null;
    const { node, shape, kind } = parsed;
    if (node === "find") return `locate a specific named entity ("${parsed.term}")`;
    if (node === "count") return `get a count of ${goalNoun(parsed.entityType)}`;
    if (node === "list") return `list/enumerate ${goalNoun(parsed.entityType)} matching a condition`;
    if (node === "superlative") return `rank/compare ${goalNoun(parsed.entityType)} by ${parsed.metricNoun || parsed.metric || "a metric"}`;
    if (node === "anaphora") return "follow up on the previous answer's result set (discourse anaphora)";
    if (node === "membership") return `understand "${parsed.term || "an entity"}"'s membership/relationship`;
    if (node === "clause") return deduceGoalFromParsed(parsed.clause);
    if (node === "miss") return null;
    if (node === "boolean" || node === "qualifier" || node === "reverseSet" || node === "forwardSet" || node === "allOfClass" || node === "temporal") {
      const k = kind || parsed.inner?.kind;
      return k && GOAL_BY_KIND[k] ? GOAL_BY_KIND[k] : `filter/traverse ${goalNoun(parsed.entityType)} by a relationship`;
    }
    if (shape === "meta") return `understand a vocabulary/definition term ("${parsed.object}")`;
    if (shape === "where") return `locate where something is defined ("${parsed.object}")`;
    if (shape === "when") return "understand when something last changed (history)";
    if (shape === "whoLast") return "find who most recently touched something (history)";
    if (shape === "mentions") return `find where something is mentioned in prose ("${parsed.object}")`;
    if (shape === "ask") return kind && GOAL_BY_KIND[kind] || "check a specific subject/object relationship";
    if ((shape === "reverse" || shape === "forward") && kind) return GOAL_BY_KIND[kind] || `understand a "${kind}" relationship`;
    return "understand a graph relationship";
  }
  var COMMANDS = {
    find: { tool: "tmct_search", arg: "query", help: "lexical search across the graph" },
    search: { tool: "tmct_search", arg: "query", help: "alias of /find" },
    context: { tool: "tmct_context", arg: "symbol", help: "the sized edit bundle for a symbol (start here to change code)" },
    snippet: { tool: "tmct_snippet", arg: "symbol", help: "exact source of one function/class/method" },
    describe: { tool: "tmct_describe", arg: "symbol", help: "a symbol's definition, kind and relations" },
    signature: { tool: "tmct_signature", arg: "symbol", help: "a symbol's signature only" },
    members: { tool: "tmct_members", arg: "class", help: "the methods/attributes of a class" },
    subclasses: { tool: "tmct_subclasses", arg: "class", help: "the subclasses of a class" },
    impact: { tool: "tmct_impact", arg: "module", help: "what a change to this module reaches (impact closure)" },
    callers: { tool: "tmct_callers", arg: "symbol", help: "functions that call this symbol" },
    callees: { tool: "tmct_callees", arg: "symbol", help: "functions this symbol calls" },
    tests: { tool: "tmct_tests_for", arg: "symbol", help: "the tests covering this symbol" },
    untested: { tool: "tmct_untested", arg: null, help: "symbols with no covering test" },
    history: { tool: "tmct_history", arg: "symbol", help: "the commit history of this symbol" },
    exports: { tool: "tmct_exports", arg: "module", help: "a module's public exports" },
    arch: { tool: "tmct_architecture", arg: "package", help: "the architecture overview (optional package filter)", optional: true }
  };
  var COMMAND_WORDS = /* @__PURE__ */ new Set(["stats", "memory", "focus", ...Object.keys(COMMANDS)]);
  var CLASS_LABELS = {
    Class: ["class", "classes"],
    Function: ["function", "functions"],
    Module: ["module", "modules"],
    Method: ["method", "methods"],
    Attribute: ["attribute", "attributes"],
    GlobalVariable: ["variable", "variables"],
    Commit: ["commit", "commits"],
    Session: ["session", "sessions"]
  };
  var AMBIGUOUS_HAVE_VERBS = /* @__PURE__ */ new Set(["have", "has", "holds", "hold"]);
  var RESTRICTOR_VERB_RE = new RegExp(
    `\\b(?:${[...Object.keys(VERB_TO_KIND), ...Object.keys(PASSIVE_PARTICIPLE_TO_KIND)].filter((v) => !AMBIGUOUS_HAVE_VERBS.has(v)).sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "i"
  );
  var BACKED_TOOLS = /* @__PURE__ */ new Set([
    ...TOOLS.map((t) => t.name),
    ...Object.values(COMMANDS).map((s) => s.tool)
  ]);
  var GREET = /* @__PURE__ */ new Set([
    "hi",
    "hello",
    "hey",
    "yo",
    "hiya",
    "howdy",
    "sup",
    "greetings",
    "g'day",
    "gday",
    "hey there",
    "hi there",
    "hello there",
    "good morning",
    "good afternoon",
    "good evening",
    "morning",
    // UK/AU/NZ
    "alright",
    "you alright",
    "alright mate",
    "morning all",
    "yeah nah",
    // US
    "hey y'all",
    "howdy there",
    "hiya there",
    // formal
    "good day",
    "good day to you",
    "salutations",
    "good to meet you",
    "pleased to meet you",
    // slang
    "yo yo",
    "ayy",
    "wassup",
    "sup fam",
    "heya",
    "hiya!",
    // texting abbreviation
    "gm",
    "ge"
  ]);
  var THANKS = /* @__PURE__ */ new Set([
    "thanks",
    "thank you",
    "thankyou",
    "thx",
    "ty",
    "ta",
    "cheers",
    "nice one",
    "much appreciated",
    "cool thanks",
    "many thanks",
    "much obliged",
    "ta very much",
    "cheers mate",
    "cheers for that",
    "tks",
    "sweet thanks",
    "nice",
    // "brilliant" — a UK-English enthusiasm interjection functioning as a bare
    // acknowledgement, the same shape as "nice"/"cheers" just above.
    "brilliant",
    // "ta for that" — "cheers for that" was already here, but its "ta" sibling
    // (both dropped-word forms of the SAME "thanks for that" shape) was missing.
    "ta for that",
    // A natural session-closing remark — the LAST turn of a session is a bad
    // place to end on the raw grammar wall instead of a warm sign-off.
    "cheers, that's everything for now, thanks",
    "that's everything for now, thanks",
    "that's all for now, thanks"
  ]);
  var BYE = /* @__PURE__ */ new Set([
    "bye",
    "goodbye",
    "quit",
    "exit",
    "see ya",
    "see you",
    "cya",
    "later",
    "farewell",
    "peace",
    "peace out",
    "im off",
    "i'm off",
    "gtg",
    "gotta go",
    "catch you later",
    "farewell then"
    // "good day to you" deliberately does NOT live here: it's a formal-register
    // GREETING, not a farewell. foldedBye is checked before GREET in
    // conversationalTurn, so having it here would silently end the session on
    // a plain formal greeting — every turn piped after it dropped with no log
    // entry, a worse outcome than any wall.
  ]);
  var OK_ACK = /* @__PURE__ */ new Set([
    "ok",
    "okay",
    "cool",
    "aight",
    "fair enough",
    "got it",
    "gotcha",
    "noted",
    "sounds good",
    "sure",
    "cool cool",
    "right"
  ]);
  var collapseRuns = (s) => s.replace(/(.)\1+/g, "$1");
  function collapsedIndex(set) {
    const idx = /* @__PURE__ */ new Map();
    for (const phrase of set) if (!idx.has(collapseRuns(phrase))) idx.set(collapseRuns(phrase), phrase);
    return idx;
  }
  var GREET_COLLAPSED = collapsedIndex(GREET);
  var THANKS_COLLAPSED = collapsedIndex(THANKS);
  var BYE_COLLAPSED = collapsedIndex(BYE);
  var ACK_LEAD_RE = new RegExp(`^(?:${[...OK_ACK].map(escapeRegex).join("|")})\\s+(.+)$`, "i");
  var CONVERSATIONAL_PHRASES = [
    ...GREET,
    ...THANKS,
    ...BYE,
    "what can you do",
    "what do you do",
    "help",
    "how do you work",
    "who are you",
    "what are you",
    "what is your name"
  ];
  var COMPARATIVE_SRC = "(?:[a-z]+er|better|worse|(?:more|less)\\s+[a-z]+)";
  var COMPARATIVE_TEACH_RE = new RegExp(`^(?:the\\s+|an?\\s+)?([\\w'-]+(?:\\s+[\\w'-]+)?)\\s+(?:is|are)\\s+(${COMPARATIVE_SRC})\\s+than\\s+(.+)$`, "i");
  var COMPARATIVE_ASK_RE = new RegExp(`^(?:is|are)\\s+(.+?)\\s+(${COMPARATIVE_SRC})\\s+than\\s+(.+?)[?.!\\s]*$`, "i");
  var PREP_SRC = "on|in|at|onto|upon|under|over|beside|near|behind|above|below|inside|outside";
  var OWNED_BY_PREDICATE = "mgx:ownedBy";
  var HAS_PROPERTY_PREDICATE = "mgx:hasProperty";
  var SUBCLASS_PREDICATE2 = "rdfs:subClassOf";
  var TAUGHT_SOURCE_TYPES = /* @__PURE__ */ new Set(["operator", "teach", "entailed"]);
  var isOperatorTaught = (f) => !!f.sourceTypes?.some((t) => TAUGHT_SOURCE_TYPES.has(t));
  function buildAliasSubClassTrees(rows, predicate = SUBCLASS_PREDICATE2) {
    const strictEdges = [];
    const broadEdges = [];
    for (const f of rows) {
      if (f.predicate !== predicate) continue;
      broadEdges.push([f.subject, f.object]);
      if (isOperatorTaught(f)) strictEdges.push([f.subject, f.object]);
    }
    return { strictEdges, broadEdges };
  }
  function chaseAliasEitherTree(chaseFn, role, targetSet, trees, opts) {
    return chaseFn(role, targetSet, [], trees.strictEdges, opts) || chaseFn(role, targetSet, [], trees.broadEdges, opts);
  }
  var ACTION_SIGNATURE_TEACH_RE = new RegExp(
    `^you\\s+(?:can|may)\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)[.!?]*$`,
    "i"
  );
  var ACTION_SIGNATURE_PASSIVE_RE = new RegExp(
    `^an?\\s+([a-z][\\w-]*)\\s+(?:can|may)\\s+be\\s+([a-z]+)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)[.!?]*$`,
    "i"
  );
  var ACTION_PRECOND_NOTHING_RE = new RegExp(
    `^to\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s*,?\\s*nothing\\s+may\\s+([a-z]+)\\s+(${PREP_SRC})\\s+the\\s+([a-z][\\w-]*)[.!?]*$`,
    "i"
  );
  var ACTION_PRECOND_COMPARATIVE_RE = new RegExp(
    `^to\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s*,?\\s*the\\s+([a-z][\\w-]*)\\s+must\\s+be\\s+(${COMPARATIVE_SRC})\\s+than\\s+the\\s+([a-z][\\w-]*)[.!?]*$`,
    "i"
  );
  var ACTION_EFFECT_TEACH_RE = new RegExp(
    `^([a-z]+ing)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s+makes\\s+(?:it|the\\s+([a-z][\\w-]*))\\s+([a-z]+)\\s+(${PREP_SRC})\\s+the\\s+([a-z][\\w-]*)[.!?]*$`,
    "i"
  );
  var ACTION_CONSTRAINT_TEACH_RE = new RegExp(
    `^to\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)\\s*,?\\s*the\\s+([a-z][\\w-]*)\\s+may\\s+not\\s+be\\s+with\\s+the\\s+([a-z][\\w-]*)\\s+without\\s+the\\s+([a-z][\\w-]*)[.!?]*$`,
    "i"
  );
  var GOAL_TEACH_RE = new RegExp(
    `^the\\s+goal\\s+is\\s+that\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+([a-z]+s)\\s+(${PREP_SRC})\\s+([\\w-]+)[.!?]*$`,
    "i"
  );
  var GOAL_TEACH_INFINITIVE_RE = new RegExp(
    `^(?:the\\s+goal\\s+is\\s+for|i\\s+want)\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+to\\s+([a-z]+)\\s+(${PREP_SRC})\\s+([\\w-]+)[.!?]*$`,
    "i"
  );
  var GOAL_TEACH_VERBLESS_RE = new RegExp(
    `^(?:the\\s+goal\\s+is\\s+for|i\\s+want)\\s+(?:(every|each|all)\\s+)?([\\w-]+)\\s+(${PREP_SRC})\\s+([\\w-]+)[.!?]*$`,
    "i"
  );
  var ACTION_SIGNATURE_ASK_RE = new RegExp(
    `^(?:can|could)\\s+you\\s+([a-z]+)\\s+an?\\s+([a-z][\\w-]*)\\s+(${PREP_SRC})\\s+an?\\s+([a-z][\\w-]*)[?.!]*$`,
    "i"
  );
  function singularizeSurface(word) {
    const w = String(word || "").trim();
    if (/[a-z]ies$/i.test(w)) return `${w.slice(0, -3)}y`;
    if (/(ses|xes|zes|ches|shes)$/i.test(w)) return w.slice(0, -2);
    if (/[a-z]s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
    return w;
  }
  var TEACH_ADVERB_SKIP_SRC = "(?:(?:usually|often|sometimes|rarely|always|typically|generally|occasionally|frequently|normally|regularly|commonly|mostly|currently|still|also|really|actually)\\s+)?";
  var NEG_MARKER_SRC = "(?:cannot|can't|can not|does not|doesn't|do not|don't|never)";
  var GENERAL_VERB_NEGATION_RE = new RegExp(`^(.+?)\\s+(${NEG_MARKER_SRC})\\s+(.+)$`, "i");
  var GENERAL_VERB_TEACH_RE = new RegExp(`^([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[.!?]*$`, "i");
  var GENERAL_VERB_DETERMINER_TEACH_RE = new RegExp(
    `^(?:the\\s+|an?\\s+)([\\w'-]+(?:\\s+[\\w'-]+)?)\\s+([a-z]+)\\s+(${PREP_SRC})\\s+(.+?)[.!?]*$`,
    "i"
  );
  var GENERAL_VERB_EXCLUDE_RE = /^(?:is|are|am|owns|maintains)$/i;
  var GENERAL_VERB_ANYWHERE_EXCLUDE_RE = /\b(?:is|are|am|owns|maintains)\b/i;
  var GENERAL_VERB_NOT_A_VERB_RE = new RegExp(
    "^(?:i|me|you|he|him|she|her|it|we|us|they|them|my|your|his|its|our|their|mine|yours|hers|ours|theirs|this|that|these|those|a|an|the|every|each|all|some|any|no|both|either|neither|in|on|at|to|from|by|with|for|of|about|into|onto|over|under|near|before|after|during|through|up|down|off|out|above|below|between|among|against|without|within|along|across|behind|beyond|upon|toward|towards|per|and|but|or|if|because|although|though|while|when|since|unless|until|whether|so|nor|than|as)$",
    "i"
  );
  var GENERAL_VERB_IMPERATIVE_SUBJECT_RE = new RegExp(
    `^(?:${LIST_TRIGGERS.filter((t) => !/\s/.test(t)).join("|")})$`,
    "i"
  );
  async function generalVerbPredicate(verb) {
    const v = String(verb || "").toLowerCase();
    if (v === "has" || v === "have") return HAS_A_PREDICATE;
    if (v === "can") return "mgx:capableOf";
    try {
      const { proseLemma: proseLemma2 } = await Promise.resolve().then(() => (init_prose_nlp(), prose_nlp_exports));
      const lemma = proseLemma2();
      const l = lemma ? lemma(v) : v;
      if (l === "have") return HAS_A_PREDICATE;
      return normFactPredicate(`mgx:${l}`);
    } catch {
      return normFactPredicate(`mgx:${v}`);
    }
  }
  var GENERAL_VERB_YESNO_RE = new RegExp(`^(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+)\\s+(.+?)[?.!\\s]*$`, "i");
  var GENERAL_VERB_OPEN_RE = new RegExp(`^what\\s+(?:does|did)\\s+([\\w'-]+)\\s+${TEACH_ADVERB_SKIP_SRC}([a-z]+(?:\\s+(?:${PREP_SRC}))?)[?.!\\s]*$`, "i");
  var GENERAL_VERB_QUERY_EXCLUDE_RE = /^(?:be|own|maintain)$/i;
  var GENERAL_VERB_PREP_RE = new RegExp(`^(${PREP_SRC})\\s+(.+)$`, "i");
  function foldPrepositionIntoPredicate(predicate, objectRaw) {
    const prepM = String(objectRaw || "").match(GENERAL_VERB_PREP_RE);
    if (prepM && /^mgx:[a-z]+$/.test(predicate)) {
      return { predicate: `${predicate}-${prepM[1].toLowerCase()}`, object: prepM[2].trim() };
    }
    return { predicate, object: String(objectRaw || "").trim() };
  }
  var TEACH_PRONOUNS = Object.freeze(["you", "i", "it", "they", "he", "she", "we"]);
  var TEACH_PRONOUN_RE = new RegExp(`^(?:every\\s+|each\\s+|all\\s+|some\\s+|a few\\s+|a\\s+|an\\s+)?(${TEACH_PRONOUNS.join("|")})\\s+\\S+`, "i");
  var TRAILING_ADVERB_RE = "(?:\\s+(?:exactly|really|actually|anyway))?";
  var MODULE_ORIENT_RE = new RegExp(`^what\\s+does\\s+(.+?)\\s+do${TRAILING_ADVERB_RE}\\??$`, "i");
  var MODULE_ORIENT_SVO_RE = new RegExp(`^what\\s+(.+?)\\s+does${TRAILING_ADVERB_RE}\\??$`, "i");
  var AUTHOR_NAME_SRC = "([A-Za-z][\\w'.-]*(?:\\s+[A-Za-z][\\w'.-]*){0,3})";
  var AUTHOR_WHO_IS_RE = new RegExp(`^who\\s+(?:is|was)\\s+${AUTHOR_NAME_SRC}$`, "i");
  var AUTHOR_TOUCHED_RE = new RegExp(
    `^what\\s+(?:did|has)\\s+${AUTHOR_NAME_SRC}\\s+(?:touch(?:ed)?|chang(?:e|ed)|work(?:ed)?\\s+on|commit(?:ted)?)$`,
    "i"
  );
  var OPINION_ADJ_SRC = "(?:good|bad|clean|messy|ugly|nice|great|terrible|awful|solid|elegant|readable|maintainable|well[- ]written|well[- ]structured|spaghetti|ok|okay|decent|healthy)";
  var OPINION_NUDGE_RE = new RegExp(`^is\\s+(?:this|the)\\s+code(?:base)?\\s+(?:any\\s+)?${OPINION_ADJ_SRC}\\b`, "i");
  var PERSONAL_ASSISTANT_NUDGE_RE = new RegExp(
    "^(?:what\\s+time\\s+is\\s+it(?:\\s+(?:now|right\\s+now))?|what(?:'s|s|\\s+is)\\s+the\\s+time(?:\\s+(?:now|right\\s+now))?|what\\s+day\\s+is\\s+it(?:\\s+today)?|what(?:'s|s|\\s+is)\\s+(?:the\\s+)?(?:day|date)(?:\\s+today)?|what(?:'s|s|\\s+is)\\s+today'?s\\s+date|what(?:'s|s|\\s+is)\\s+the\\s+weather(?:\\s+like)?(?:\\s+(?:today|outside))?|how'?s\\s+the\\s+weather(?:\\s+like)?(?:\\s+(?:today|outside))?)\\??$",
    "i"
  );
  async function resolveEntity(graph, term) {
    if (!graph || !term) return null;
    try {
      const { resolveObject: resolveObject2 } = await Promise.resolve().then(() => (init_ask(), ask_exports));
      const r = resolveObject2(graph, term);
      if (r?.match?.id && !r.ambiguous) return { id: r.match.id, label: r.match.label };
    } catch {
    }
    return null;
  }
  var PREDICATE_WORDS = new Set(
    [
      ...Object.keys(VERB_TO_KIND).flatMap((phrase) => phrase.split(/[\s-]+/)),
      ...WHERE_MARKERS,
      ...MENTION_MARKERS,
      "owns",
      "maintains"
    ].filter((w) => w.length >= 3)
  );
  var FACT_PREDICATE_PHRASES = {
    "rdfs:subClassOf": "is a kind of",
    "rdf:type": "is a",
    "owl:disjointWith": "is not a",
    "mgx:partOf": "is part of",
    "mgx:hasA": "has",
    "mgx:usedFor": "is used for",
    "mgx:capableOf": "can",
    "mgx:atLocation": "is found in",
    "mgx:causes": "causes",
    "mgx:hasProperty": "is",
    "mgx:madeOf": "is made of",
    "mgx:receivesAction": "can be",
    "mgx:createdBy": "is created by",
    "mgx:mannerOf": "is a way to",
    "mgx:desires": "wants",
    "mgx:locatedNear": "is typically near",
    "mgx:motivatedByGoal": "is motivated by",
    "mgx:obstructedBy": "can be prevented by",
    "mgx:causesDesire": "makes you want to",
    "mgx:hasSubevent": "involves",
    "mgx:hasFirstSubevent": "begins with",
    "mgx:hasLastSubevent": "ends with",
    "mgx:hasPrerequisite": "requires",
    "mgx:ownedBy": "is owned by",
    // the teach lane's ownership frame ("Priya owns tasks.mjs")
    "mgx:rendersAs": "renders as",
    // the render-template binding ("a disk renders as a block")
    "mgx:synonym": "means the same as",
    "mgx:antonym": "is the opposite of",
    "mgx:similarTo": "is similar to",
    "mgx:relatedTo": "is related to",
    "mgx:symbolOf": "is a symbol of"
  };
  function thirdPersonSingularSurface(lemma) {
    const w = String(lemma || "");
    if (/^have$/i.test(w)) return "has";
    if (/[a-z]y$/i.test(w) && !/[aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
    if (/(?:s|x|z|ch|sh|o)$/i.test(w)) return `${w}es`;
    return `${w}s`;
  }
  function baseVerbSurface(verb) {
    const w = String(verb || "");
    if (/^has$/i.test(w)) return "have";
    if (/[a-z]ies$/i.test(w) && !/[aeiou]ies$/i.test(w)) return `${w.slice(0, -3)}y`;
    if (/(?:s|x|z|ch|sh|o)es$/i.test(w)) return w.slice(0, -2);
    return w.replace(/s$/i, "");
  }
  function predicatePhrase(predicate) {
    if (FACT_PREDICATE_PHRASES[predicate]) return FACT_PREDICATE_PHRASES[predicate];
    const p = String(predicate || "");
    const positive = positivePredicate(p);
    if (positive) {
      const phrase = predicatePhrase(positive);
      if (phrase === "can") return "cannot";
      if (phrase === "can be") return "cannot be";
      if (phrase === "is" || phrase.startsWith("is ")) return `is not${phrase.slice(2)}`;
      const [head, ...tail] = phrase.split(" ");
      return ["does not", baseVerbSurface(head), ...tail].join(" ");
    }
    const comp = /^mgx:([a-z]+(?:-[a-z]+)*)-than$/i.exec(p);
    if (comp) return `is ${comp[1].replace(/-/g, " ")} than`;
    const m = /^mgx:([a-z]+)(?:-([a-z]+))?$/i.exec(p);
    if (!m) return predicate;
    return `${thirdPersonSingularSurface(m[1])}${m[2] ? ` ${m[2]}` : ""}`;
  }
  var factPhrase = (f) => `${f.subject} ${predicatePhrase(f.predicate)} ${f.object}`;
  function relationRoleWord(predicate) {
    const m = /^mgx:([a-z][\w-]*)$/i.exec(String(predicate || ""));
    return m ? m[1].toLowerCase() : null;
  }
  var TRAILING_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES).map(([predicate, phrase]) => {
    const m = /^(?:is|are)\s+(.+)$/i.exec(phrase);
    return m ? { predicate, marker: m[1].trim().toLowerCase() } : null;
  }).filter((e) => e && e.marker.length > 1).sort((a, b) => b.marker.length - a.marker.length);
  function splitMetaPredicate(term) {
    const t = String(term || "").trim();
    const lower = t.toLowerCase();
    for (const { marker, predicate } of TRAILING_PREDICATE_MARKERS) {
      if (lower === marker) continue;
      if (lower.endsWith(` ${marker}`)) {
        const subject = t.slice(0, t.length - marker.length).trim();
        if (subject) return { subject, predicate };
      }
    }
    return { subject: t, predicate: null };
  }
  function renderFactLine(f) {
    const cite = f.provenance ? ` (source: ${f.provenance})` : "";
    if (f.provenance.includes("ace:chat") || f.provenance.includes("teach:chat")) return `you told me: ${factPhrase(f)}${cite}`;
    if (f.provenance.includes("corpus-weak:")) return `possibly: ${factPhrase(f)}${cite}`;
    if (f.provenance.includes("corpus:")) return `${factPhrase(f)}${cite}`;
    return `i learned: ${factPhrase(f)}${cite}`;
  }
  function renderIsaChain(premises) {
    const step = (f) => `${factPhrase(f)}${f.provenance ? ` (source: ${f.provenance})` : ""}`;
    const first = premises[0];
    const last = premises[premises.length - 1];
    return `${premises.map(step).join("; ")}; so ${first.subject} is a ${last.object}`;
  }
  async function memoryFacts(memoryDir) {
    try {
      const { loadMemory: loadMemory2 } = await Promise.resolve().then(() => (init_core(), core_exports));
      const m = await loadMemory2(memoryDir);
      const out = [];
      for (const ind of m.individuals || []) {
        if (ind?.class !== "Fact") continue;
        const get = (k) => (ind.attributes || []).find((a) => a.key === k)?.value || "";
        out.push({ subject: get("subject"), predicate: get("predicate"), object: get("object"), provenance: get("provenance") });
      }
      return out;
    } catch {
      return [];
    }
  }
  async function factRows(memoryDir, cache2 = null) {
    if (cache2?.rows) return cache2.rows;
    try {
      const { loadMemory: loadMemory2, readFactRows: readFactRows2 } = await Promise.resolve().then(() => (init_core(), core_exports));
      const rows = readFactRows2(await loadMemory2(memoryDir));
      if (cache2) {
        cache2.rows = rows;
        cache2.reloads = (cache2.reloads || 0) + 1;
      }
      return rows;
    } catch {
      return [];
    }
  }
  function factTermVariants(normFactTerm2, term) {
    const t = normFactTerm2(term);
    const v = /* @__PURE__ */ new Set([t]);
    if (t.endsWith("es")) v.add(t.slice(0, -2));
    if (t.endsWith("s")) v.add(t.slice(0, -1));
    return v;
  }
  function findAcrossVariants(subjVariants, objVariants, prove) {
    for (const subj of subjVariants) {
      for (const obj of objVariants) {
        const w = prove(subj, obj);
        if (w) return w;
      }
    }
    return null;
  }
  var GENERIC_ENTITY_WORDS = /* @__PURE__ */ new Set([
    "module",
    "modules",
    "class",
    "classes",
    "function",
    "functions",
    "method",
    "methods",
    "handler",
    "handlers",
    "controller",
    "controllers",
    "service",
    "services",
    "component",
    "components",
    "flow",
    "flows",
    "thing",
    "things",
    "item",
    "items",
    "object",
    "objects",
    "commit",
    "commits"
  ]);
  var SYNONYM_DENYLIST = new Set([
    ["interpreter", "compiler"],
    // different execution strategies, not synonyms
    ["string", "thread"],
    // unrelated CS concepts (text data vs. execution thread)
    ["heart", "kernel"],
    // generic-English collision on "kernel"
    ["battalion", "heap"],
    // generic-English collision on "heap" (data structure)
    ["bash", "sock"],
    // generic-English collision ("bash"/"sock" = to hit)
    ["command", "skill"],
    // too loose to be a safe query-time substitution
    ["docker", "longshoreman"],
    // proper-noun/tool name vs. unrelated profession
    ["name", "list"],
    // generic-English collision, not a domain synonym
    ["list", "number"]
    // generic-English collision, not a domain synonym
  ].map(([a, b]) => [a, b].sort().join("|")));
  var RELATION_FACT_YESNO_RE = /^(?:is|are|was|were)\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)\s+(?:the|an?)\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;
  var RELATION_WHO_ASK_RE = /^(?:who|what)\s+(?:is|are)\s+(?:the|an?)\s+([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;
  var GENITIVE_WHO_ASK_RE = /^(?:who|what)\s+(?:is|are|was|were)\s+([\w-]+(?:\s+[A-Z][\w-]*)?)'s\s+([a-z][\w-]*)[?.!\s]*$/i;
  function matchGenitiveWhoAsk(q) {
    const g = String(q).match(GENITIVE_WHO_ASK_RE);
    return g ? [g[0], g[2], g[1]] : null;
  }
  var RECURSIVE_LIST_ASK_RE = /^list\s+(?:the\s+|all\s+)?([a-z][\w-]*)\s+of\s+([\w'-]+(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;
  var ISA_ASK_RE = /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+(?:a\s+kind\s+of|a\s+type\s+of|an?)\s+(.+?)[?.!\s]*$/i;
  var ISA_PREDICATES2 = /* @__PURE__ */ new Set(["rdfs:subClassOf", "rdf:type"]);
  var DEEP_CHAIN_PROBE_HOPS = 6;
  var WHY_ISA_LEAD_RE = /^why\s+(?=(?:is|are)\b)/i;
  var EXPLAIN_HOW_YOU_KNOW_RE = /^explain\s+how\s+you\s+know\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  function matchWhyIsa(q) {
    const stripped = String(q || "").replace(WHY_ISA_LEAD_RE, "");
    if (stripped !== q) {
      const m = stripped.match(ISA_ASK_RE);
      if (m) return m;
    }
    const ehyk = String(q || "").match(EXPLAIN_HOW_YOU_KNOW_RE);
    if (ehyk) return `is ${ehyk[1].trim()} a ${ehyk[2].trim()}`.match(ISA_ASK_RE);
    return null;
  }
  var ISA_IDIOM_ROLE_WORDS = /* @__PURE__ */ new Set(["kind", "sort", "type", "subclass", "superclass"]);
  var CONFIRM_TAG_RE = /^(?:so\s+)?(.+?)\s+(?:is|are)\s+(?:an?\s+)?(.+?)\s*,?\s*(?:now\s+)?(?:right|correct|yeah)\??$/i;
  var KNOW_ABOUT_RE = /^(?:what\s+do\s+you\s+know\s+about|what(?:'s|s|\s+is)\s+in\s+your\s+memory\s+about|what\s+do\s+you\s+remember\s+about)\s+(.+?)[?.!\s]*$/i;
  var FACT_ANSWER_CAP = 32;
  var CAN_ASK_RE = /^(?:can|could)\s+(?:an?\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z]+)[?.!\s]*$/i;
  var DOES_HAVE_ASK_RE = /^(?:does|do)\s+(?:an?\s+|the\s+)?(.+?)\s+have\s+(?:an?\s+|the\s+)?(.+?)[?.!\s]*$/i;
  var WHAT_CAN_DO_RE = /^what\s+can\s+(?:an?\s+)?(.+?)\s+do[?.!\s]*$/i;
  var WHAT_HAS_RE = /^what\s+has\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  var WHAT_USED_FOR_RE = /^what\s+(?:(?:can\s+be|is)\s+used\s+for|is\s+for)\s+(.+?)[?.!\s]*$/i;
  var WHERE_IS_FACT_RE = /^where(?:'s|\s+is|\s+are)\s+(.+?)(?:\s+now)?\s*[?.!]*$/i;
  var LOCATIVE_FACT_PREDICATE_RE = /^mgx:[a-z]+-(?:on|in|at|inside|under|below|above|near|beside|behind|by)$/;
  var WHAT_IS_PREP_FACT_RE = new RegExp(`^what(?:'s|\\s+is|\\s+are)\\s+(${PREP_SRC})\\s+(.+?)\\s*[?.!]*$`, "i");
  var DO_VERB_ASK_RE = /^(?:do|does)\s+(all\s+|every\s+)?(?:an?\s+|the\s+)?([\w'-]+(?:\s+[\w'-]+)*?)\s+([a-z-]+)[?.!\s]*$/i;
  var WHAT_CAN_VERB_RE = /^what\s+can\s+(?!be\s)(.+?)[?.!\s]*$/i;
  var WHICH_KIND_CAN_RE = /^(?:which|what)\s+([\w'-]+(?:\s+[\w'-]+)*?)\s+can\s+(.+?)[?.!\s]*$/i;
  function positiveQuestionSurface(q) {
    const s = String(q || "").replace(/^(?:can't|cannot|can not)\s+/i, "can ").replace(/^(?:doesn't|does not)\s+/i, "does ").replace(/^(?:don't|do not)\s+/i, "do ").replace(/^(?:didn't|did not)\s+/i, "did ").replace(/\s+(?:not|never)\s+/i, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  function renderIsaCite(chain, facts) {
    const steps = (chain || []).map((step) => facts.find(
      (f) => f.predicate === step.predicate && f.subject === step.subject && f.object === step.object
    ));
    if (!steps.length || !steps.every(Boolean)) return null;
    return steps.map((g) => `${factPhrase(g)}${g.provenance ? ` (source: ${g.provenance})` : ""}`).join("; ");
  }
  function capabilityReply(subjectText, objectText, facts, { maxHops = 3 } = {}) {
    const subj = factTermVariants(normFactTerm, subjectText);
    const obj = factTermVariants(normFactTerm, objectText);
    const r = resolveCapabilityPolarity(subj, obj, facts, { maxHops });
    const viaChain = (chain) => {
      const cite = chain && chain.length ? renderIsaCite(chain, facts) : null;
      return cite ? ` \u2014 via: ${cite}` : "";
    };
    if (r.verdict === "both") {
      const lines = [...r.negative, ...r.positive].map(renderFactLine).join("\n");
      return {
        text: `I have both, at the same level of detail \u2014 my sources disagree, so I won't pick:
${lines}`,
        replace: true,
        miss: true
      };
    }
    if (r.verdict === "yes" || r.verdict === "no") {
      const winner = r.verdict === "no" ? r.negative[0] : r.positive[0];
      let text = `${r.verdict} \u2014 ${renderFactLine(winner)}${viaChain(r.chain)}`;
      if (r.overrides) {
        text += `. That overrides what I know about ${r.overrides.fact.subject} generally: ${renderFactLine(r.overrides.fact)}`;
      }
      return { text, replace: true };
    }
    return null;
  }
  function capabilityBaseRateReply(subjectText, objectText, facts, { maxHops = 3 } = {}) {
    const subj = factTermVariants(normFactTerm, subjectText);
    const obj = factTermVariants(normFactTerm, objectText);
    const baseRate = capabilityBaseRate(subj, obj, facts, { maxHops });
    if (!baseRate) return null;
    const lead = `${subjectText} is a kind of ${baseRate.klass}`;
    const opener = `I don't know if ${subjectText} can ${objectText}.`;
    if (baseRate.positive.length || baseRate.negative.length) {
      const split = [
        `${baseRate.positive.length} can ${objectText}`,
        `${baseRate.negative.length} cannot`,
        `${baseRate.unknown.length} I have nothing on`
      ].join(", ");
      const named = [...baseRate.positive, ...baseRate.negative].slice(0, CAPABILITY_REPORT_CAP).map((s) => renderFactLine(s.fact));
      return {
        text: `${opener} ${lead}, and of the ${baseRate.kinds} kind${baseRate.kinds === 1 ? "" : "s"} of ${baseRate.klass} I know, ${split}.
${named.join("\n")}`,
        replace: true,
        miss: true
      };
    }
    const extension = capabilityExtension(obj, facts, { exclude: /* @__PURE__ */ new Set([...subj, baseRate.klass]) });
    if (extension.length) {
      const shown = extension.slice(0, CAPABILITY_REPORT_CAP);
      const rest = extension.slice(shown.length);
      return {
        text: `${opener} ${lead}, and nothing I know about ${baseRate.klass} says whether one can ${objectText}. I do know ${extension.length} thing${extension.length === 1 ? "" : "s"} that can ${objectText}${rest.length ? ` (first ${shown.length} shown)` : ""}:
${shown.map(renderFactLine).join("\n")}`,
        replace: true,
        miss: true,
        ...rest.length ? { pending: { items: rest.map(renderFactLine), noun: "facts" } } : {}
      };
    }
    return {
      text: `${opener} ${lead}, but nothing I remember says whether any kind of ${baseRate.klass} can ${objectText}.`,
      replace: true,
      miss: true
    };
  }
  var SUPERLATIVE_WORD_SRC = "(?:most|least)\\s+[a-z][\\w-]*|[a-z][\\w-]*est|best|worst";
  var WHICH_KIND_SUPERLATIVE_RE = new RegExp(`^which\\s+([\\w'-]+)\\s+(?:is|are)\\s+(?:the\\s+)?(${SUPERLATIVE_WORD_SRC})[?.!\\s]*$`, "i");
  var WHAT_IS_SUPERLATIVE_KIND_RE = new RegExp(`^what(?:'s|s|\\s+is)\\s+the\\s+(${SUPERLATIVE_WORD_SRC})\\s+([\\w'-]+)[?.!\\s]*$`, "i");
  function comparativeOfSuperlative(superlative) {
    const s = String(superlative || "").toLowerCase().trim().replace(/\s+/g, " ");
    if (s === "best") return "better";
    if (s === "worst") return "worse";
    const graded = s.match(/^(most|least)\s+([a-z][\w-]*)$/);
    if (graded) return `${graded[1] === "most" ? "more" : "less"} ${graded[2]}`;
    return /[a-z]est$/.test(s) && s.length > 4 ? `${s.slice(0, -3)}er` : null;
  }
  var REVERSE_PREDICATE_EXCLUDE = /* @__PURE__ */ new Set([
    "rdfs:subClassOf",
    "rdf:type",
    "mgx:hasA",
    "mgx:capableOf",
    "mgx:usedFor",
    "mgx:ownedBy",
    "owl:disjointWith",
    "mgx:hasProperty",
    "mgx:receivesAction"
  ]);
  var REVERSE_PREDICATE_MARKERS = Object.entries(FACT_PREDICATE_PHRASES).filter(([predicate]) => !REVERSE_PREDICATE_EXCLUDE.has(predicate)).map(([predicate, phrase]) => ({
    predicate,
    re: new RegExp(`^what\\s+${escapeRegex(phrase)}\\s+(.+?)[?.!\\s]*$`, "i")
  })).sort((a, b) => b.re.source.length - a.re.source.length);
  var FORWARD_YESNO_EXCLUDE = /* @__PURE__ */ new Set([
    "rdfs:subClassOf",
    "rdf:type",
    "owl:disjointWith",
    "mgx:hasProperty",
    "mgx:hasA",
    "mgx:capableOf",
    // ownership's dedicated reader (OWNS_YESNO_RE) answers a confident
    // closed-world "no" — a stronger contract than the derived "can't
    // confirm", so the derived reader must never intercept it.
    "mgx:ownedBy"
  ]);
  var FORWARD_YESNO_MARKERS = Object.entries(FACT_PREDICATE_PHRASES).filter(([predicate]) => !FORWARD_YESNO_EXCLUDE.has(predicate)).map(([predicate, phrase]) => {
    let re;
    if (phrase === "can be") {
      re = new RegExp("^can\\s+(?:an?\\s+|the\\s+)?(.+?)\\s+be\\s+(.+?)[?.!\\s]*$", "i");
    } else if (phrase.startsWith("is ")) {
      const rest = escapeRegex(phrase.slice(3));
      re = new RegExp(`^(?:is|are)\\s+(?:an?\\s+|the\\s+)?(.+?)\\s+${rest}\\s+(?:an?\\s+|the\\s+)?(.+?)[?.!\\s]*$`, "i");
    } else {
      const [head, ...tail] = phrase.split(" ");
      const base = [baseVerbSurface(head), ...tail].map(escapeRegex).join("\\s+");
      re = new RegExp(`^(?:does|do)\\s+(?:an?\\s+|the\\s+)?(.+?)\\s+${base}\\s+(?:an?\\s+|the\\s+)?(.+?)[?.!\\s]*$`, "i");
    }
    return { predicate, phrase, re };
  }).sort((a, b) => b.re.source.length - a.re.source.length);
  var WHAT_INHERITS_RE = /^what\s+(?:inherits?\s+(?:from\s+)?(?:an?\s+)?|is\s+(?:an?\s+)?(?:kind|sort|type)\s+of\s+|is\s+(?:an?\s+)?subclass\s+of\s+)(.+?)[?.!\s]*$/i;
  var HAS_TEMPORAL_TAIL = /* @__PURE__ */ new Set(["changed", "change", "changes", "updated", "modified", "happened", "occurred"]);
  function uniqueFacts(rows) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const f of rows) {
      const key = `${f.subject}|${f.predicate}|${f.object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }
  async function factAnswer(memoryDir, query, envelope, miss2, biasByBundle = {}, cache2 = null, focusLabel = null) {
    return withDeducedGoal(await factAnswerReaders(memoryDir, query, envelope, miss2, biasByBundle, cache2, focusLabel), envelope, query);
  }
  function withDeducedGoal(res, envelope, query) {
    if (!res || res.goal !== void 0) return res;
    const q = String(query || "").trim();
    let goal = deduceGoalFromParsed(envelope?.parsed);
    if (!goal && res.generalVerbQuery) goal = TAUGHT_FACT_LOOKUP_GOAL;
    if (!goal) {
      const yesNo = q.match(RELATION_FACT_YESNO_RE);
      const whoAsk = yesNo ? null : q.match(RELATION_WHO_ASK_RE) || matchGenitiveWhoAsk(q);
      const role = yesNo ? yesNo[2] : whoAsk ? whoAsk[1] : null;
      if (role && !ISA_IDIOM_ROLE_WORDS.has(role.toLowerCase())) goal = TAUGHT_FACT_LOOKUP_GOAL;
    }
    if (!goal) {
      const whatIs = q.match(BARE_WHATIS_RE);
      if (whatIs) goal = deduceGoalFromParsed({ shape: "meta", object: whatIs[1] });
    }
    return goal ? { ...res, goal } : res;
  }
  async function factAnswerReaders(memoryDir, query, envelope, miss2, biasByBundle = {}, cache2 = null, focusLabel = null) {
    let normFactTerm2;
    try {
      ({ normFactTerm: normFactTerm2 } = await Promise.resolve().then(() => (init_core(), core_exports)));
    } catch {
      return null;
    }
    const q = String(query).trim();
    const usedForQ = q.match(WHAT_USED_FOR_RE);
    if (usedForQ) {
      const variants = factTermVariants(normFactTerm2, usedForQ[1]);
      const hits = (await factRows(memoryDir, cache2)).filter((f) => f.predicate === "mgx:usedFor" && variants.has(f.object));
      if (hits.length) {
        const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
        const lines = ranked.map(renderFactLine);
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
        return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
      }
    }
    for (const { predicate, re } of REVERSE_PREDICATE_MARKERS) {
      const m = q.match(re);
      if (!m) continue;
      const variants = factTermVariants(normFactTerm2, m[1]);
      const hits = (await factRows(memoryDir, cache2)).filter((f) => f.predicate === predicate && variants.has(f.object));
      if (!hits.length) continue;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const whichSup = q.match(WHICH_KIND_SUPERLATIVE_RE);
    const whatSup = whichSup ? null : q.match(WHAT_IS_SUPERLATIVE_KIND_RE);
    const supKindRaw = whichSup ? whichSup[1] : whatSup?.[2];
    const supWord = whichSup ? whichSup[2] : whatSup?.[1];
    const supCompBase = supKindRaw && supWord ? comparativeOfSuperlative(supWord) : null;
    if (supCompBase) {
      const supPredicate = `mgx:${supCompBase.replace(/\s+/g, "-")}-than`;
      const rows = await factRows(memoryDir, cache2);
      const kindVariants = factTermVariants(normFactTerm2, supKindRaw);
      const kindSingular = [...kindVariants].sort((a, b) => a.length - b.length)[0];
      const memberOfKind = (node) => kindVariants.has(node) || node.startsWith(`${kindSingular}-`) || node.startsWith(`${kindSingular} `) || rows.some((g) => ISA_PREDICATES2.has(g.predicate) && g.subject === node && kindVariants.has(g.object));
      const pairs = uniqueFacts(rows.filter((f) => f.predicate === supPredicate && isOperatorTaught(f))).filter((f) => f.subject !== f.object && memberOfKind(f.subject) && memberOfKind(f.object));
      if (pairs.length) {
        const nodes = /* @__PURE__ */ new Set();
        const inDeg = /* @__PURE__ */ new Map();
        for (const f of pairs) {
          nodes.add(f.subject);
          nodes.add(f.object);
          inDeg.set(f.object, (inDeg.get(f.object) || 0) + 1);
          if (!inDeg.has(f.subject)) inDeg.set(f.subject, inDeg.get(f.subject) || 0);
        }
        const remaining = new Map(inDeg);
        const order = [];
        let declined = null;
        while (remaining.size) {
          const sources = [...remaining.keys()].filter((n) => remaining.get(n) === 0);
          if (sources.length !== 1) {
            declined = sources.length === 0 ? {
              text: `I can't order the ${kindSingular}s \u2014 the "${supCompBase} than" facts I have loop back on themselves, so no ${supWord} exists. /memory to inspect them.`,
              replace: true,
              miss: true
            } : {
              text: `I can't pick the ${supWord} ${kindSingular} from what I know \u2014 nothing compares ${sources[0]} and ${sources[1]}. Teach me, e.g. "${sources[0]} is ${supCompBase} than ${sources[1]}".`,
              replace: true,
              miss: true
            };
            break;
          }
          const head = sources[0];
          order.push(head);
          remaining.delete(head);
          for (const f of pairs) {
            if (f.subject === head && remaining.has(f.object)) remaining.set(f.object, remaining.get(f.object) - 1);
          }
        }
        if (declined) return declined;
        const steps = order.slice(0, -1).map((n, i) => pairs.find((f) => f.subject === n && f.object === order[i + 1]));
        if (steps.every(Boolean)) {
          const cite = steps.map((g) => `${factPhrase(g)}${g.provenance ? ` (source: ${g.provenance})` : ""}`).join("; ");
          return { text: `${order[0]} \u2014 ${cite}; so ${order[0]} is the ${supWord} ${kindSingular}`, replace: true };
        }
      }
    }
    const whereQ = miss2 ? q.match(WHERE_IS_FACT_RE) : null;
    if (whereQ) {
      const variants = factTermVariants(normFactTerm2, whereQ[1]);
      const hits = (await factRows(memoryDir, cache2)).filter((f) => LOCATIVE_FACT_PREDICATE_RE.test(f.predicate) && variants.has(f.subject));
      if (hits.length) {
        const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
        const lines = ranked.map(renderFactLine);
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
        return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
      }
    }
    const whatIsPrepQ = q.match(WHAT_IS_PREP_FACT_RE);
    if (whatIsPrepQ) {
      const prep = whatIsPrepQ[1].toLowerCase();
      const variants = factTermVariants(normFactTerm2, whatIsPrepQ[2].replace(/^(?:an?|the)\s+/i, "").trim());
      const hits = (await factRows(memoryDir, cache2)).filter(
        (f) => LOCATIVE_FACT_PREDICATE_RE.test(f.predicate) && f.predicate.endsWith(`-${prep}`) && variants.has(f.object)
      );
      if (hits.length) {
        const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
        const lines = ranked.map(renderFactLine);
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
        return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
      }
    }
    let metaTerm = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
    if (!metaTerm && miss2 && !envelope?.parsed && !WHAT_INHERITS_RE.test(q)) {
      const m = q.match(BARE_WHATIS_RE) || q.match(/^what\s+(?:does|do)\s+(.+?)\s+means?[?.!\s]*$/i);
      if (m) metaTerm = stripTrailingScopeFiller(m[1]);
    }
    if (!metaTerm && envelope?.ambiguous && Array.isArray(envelope.candidateParses)) {
      const metaCand = envelope.candidateParses.find((c) => c?.shape === "meta" && c.object);
      if (metaCand) metaTerm = stripTrailingScopeFiller(String(metaCand.object));
    }
    if (metaTerm) {
      const { subject, predicate } = splitMetaPredicate(metaTerm);
      const variants = factTermVariants(normFactTerm2, subject);
      const subjectHits = (await factRows(memoryDir, cache2)).filter((f) => variants.has(f.subject));
      let hits = predicate ? subjectHits.filter((f) => f.predicate === predicate) : subjectHits;
      if (!hits.length) {
        if (predicate && subjectHits.length) {
          return {
            text: `I don't have any "${FACT_PREDICATE_PHRASES[predicate]}" facts about ${subject}.`,
            replace: miss2
          };
        }
        return null;
      }
      hits = rankByBiasThenTrust(hits, biasByBundle);
      const lines = hits.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: miss2, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    if (!miss2) return null;
    const compAsk = q.match(COMPARATIVE_ASK_RE);
    if (compAsk) {
      const compWord = compAsk[2].toLowerCase().replace(/\s+/g, "-");
      const compPredicate = `mgx:${compWord}-than`;
      const facts = await memoryFacts(memoryDir);
      const compTerm = (raw) => {
        const t = raw.replace(/^(?:an?|the)\s+/i, "").trim();
        return focusLabel && IS_ADJECTIVE_PRONOUN_RE.test(t) ? focusLabel : t;
      };
      const subjTerm = compTerm(compAsk[1]);
      const objTerm = compTerm(compAsk[3]);
      const subj = factTermVariants(normFactTerm2, subjTerm);
      const obj = factTermVariants(normFactTerm2, objTerm);
      const hit2 = facts.find((f) => f.predicate === compPredicate && subj.has(f.subject) && obj.has(f.object));
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      const known = facts.filter((f) => f.predicate === compPredicate && (subj.has(f.subject) || subj.has(f.object)));
      const shown = known.length ? ` I do know: ${known.slice(0, 3).map(renderFactLine).join("; ")}.` : "";
      return {
        text: `I can't confirm that \u2014 nothing I remember compares them that way.${shown} If it's true, teach me: "${subjTerm} is ${compAsk[2].toLowerCase()} than ${objTerm}".`,
        replace: true,
        miss: true
      };
    }
    for (const { predicate, phrase, re } of FORWARD_YESNO_MARKERS) {
      const m = q.match(re);
      if (!m) continue;
      const facts = await memoryFacts(memoryDir);
      const subj = factTermVariants(normFactTerm2, m[1]);
      const obj = factTermVariants(normFactTerm2, m[2]);
      const hit2 = facts.find((f) => f.predicate === predicate && subj.has(f.subject) && obj.has(f.object));
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      const sameRelation = facts.filter((f) => f.predicate === predicate && subj.has(f.subject));
      if (sameRelation.length) {
        const shown = sameRelation.slice(0, 3).map(renderFactLine).join("; ");
        return {
          text: `I can't confirm that \u2014 nothing I remember says ${m[1]} ${phrase} ${m[2]}. I do know: ${shown}.`,
          replace: true,
          miss: true
        };
      }
      if (!envelope?.parsed && facts.some((f) => subj.has(f.subject))) {
        return {
          text: `I can't confirm that \u2014 nothing I remember says ${m[1]} ${phrase} ${m[2]}.`,
          replace: true,
          miss: true
        };
      }
      break;
    }
    const isa = q.match(ISA_ASK_RE) || matchWhyIsa(q);
    if (isa) {
      const subj = factTermVariants(normFactTerm2, isa[1]);
      const obj = factTermVariants(normFactTerm2, isa[2]);
      const hit2 = (await memoryFacts(memoryDir)).find(
        (f) => ISA_PREDICATES2.has(f.predicate) && subj.has(f.subject) && obj.has(f.object)
      );
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return null;
    }
    const can = positiveQuestionSurface(q).match(CAN_ASK_RE);
    if (can) {
      const facts = await factRows(memoryDir, cache2);
      const reply = capabilityReply(can[1], can[2], facts);
      if (reply) return reply;
      const subj = factTermVariants(normFactTerm2, can[1]);
      const knownCan = facts.filter((f) => f.predicate === "mgx:capableOf" && subj.has(f.subject));
      if (knownCan.length) {
        const shown = knownCan.slice(0, 3).map(renderFactLine).join("; ");
        return {
          text: `I can't confirm that \u2014 nothing I remember says ${can[1]} can ${can[2]}. I do know: ${shown}. If it's true, teach me: "a ${knownCan[0].subject} can ${can[2]}".`,
          replace: true,
          miss: true
        };
      }
      return capabilityBaseRateReply(can[1], can[2], facts);
    }
    const doesHave = q.match(DOES_HAVE_ASK_RE);
    if (doesHave) {
      const subj = factTermVariants(normFactTerm2, doesHave[1]);
      const obj = factTermVariants(normFactTerm2, doesHave[2]);
      const hit2 = (await memoryFacts(memoryDir)).find(
        (f) => f.predicate === "mgx:hasA" && subj.has(f.subject) && obj.has(f.object)
      );
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return null;
    }
    const doAsk = positiveQuestionSurface(q).match(DO_VERB_ASK_RE);
    if (doAsk) {
      const facts = await factRows(memoryDir, cache2);
      const universal = !!doAsk[1];
      const subj = factTermVariants(normFactTerm2, doAsk[2]);
      const obj = factTermVariants(normFactTerm2, doAsk[3]);
      const reply = capabilityReply(doAsk[2], doAsk[3], facts);
      if (reply && universal) {
        return {
          text: `I can't speak for all ${doAsk[2]} \u2014 what I remember is generic, not universal. ${reply.text}.`,
          replace: true
        };
      }
      if (reply) return reply;
      if (miss2) {
        const knownCan = facts.filter((f) => f.predicate === "mgx:capableOf" && subj.has(f.subject));
        if (knownCan.length) {
          const shown = knownCan.slice(0, 3).map(renderFactLine).join("; ");
          return {
            text: `I can't confirm that \u2014 nothing I remember says ${doAsk[2]} can ${doAsk[3]}. I do know: ${shown}. If it's true, teach me: "a ${knownCan[0].subject} can ${doAsk[3]}".`,
            replace: true,
            miss: true
          };
        }
        const base = capabilityBaseRateReply(doAsk[2], doAsk[3], facts);
        if (base) return base;
      }
    }
    const canDo = q.match(WHAT_CAN_DO_RE);
    if (canDo) {
      const variants = factTermVariants(normFactTerm2, canDo[1]);
      const hits = (await factRows(memoryDir, cache2)).filter((f) => (f.predicate === "mgx:capableOf" || f.predicate === NEG_CAPABLE_OF_PREDICATE) && variants.has(f.subject));
      if (!hits.length) return null;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const whichCan = q.match(WHICH_KIND_CAN_RE);
    if (whichCan) {
      const kindVariants = factTermVariants(normFactTerm2, whichCan[1]);
      const verbVariants = factTermVariants(normFactTerm2, whichCan[2]);
      const facts = await factRows(memoryDir, cache2);
      const capable = uniqueFacts(facts.filter((f) => f.predicate === "mgx:capableOf" && verbVariants.has(f.object))).filter((f) => resolveCapabilityPolarity(/* @__PURE__ */ new Set([f.subject]), verbVariants, facts).verdict === "yes");
      if (capable.length) {
        const { findIsaChain: findIsaChain2, SUBCLASS_PREDICATE: SC_PRED, TYPE_PREDICATE: TYPE_PRED } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
        const subClassRows = facts.filter((f) => f.predicate === SC_PRED);
        const typeRows = facts.filter((f) => f.predicate === TYPE_PRED);
        const subClassEdges = subClassRows.map((f) => [f.subject, f.object]);
        const typeEdges = typeRows.map((f) => [f.subject, f.object]);
        const rowForStep = (step) => (step.predicate === SC_PRED ? subClassRows : typeRows).find((g) => g.subject === step.subject && g.object === step.object);
        const chainBySubject = /* @__PURE__ */ new Map();
        const inKind = capable.filter((f) => {
          if (kindVariants.has(f.subject)) return true;
          if (!chainBySubject.has(f.subject)) {
            chainBySubject.set(f.subject, findIsaChain2(f.subject, kindVariants, typeEdges, subClassEdges, { maxHops: 3 }));
          }
          return !!chainBySubject.get(f.subject);
        });
        const ranked = rankByBiasThenTrust(inKind.length ? inKind : capable, biasByBundle);
        const lines = ranked.map((f) => {
          const chain = inKind.length ? chainBySubject.get(f.subject) : null;
          if (!chain || chain.length < 2) return renderFactLine(f);
          const steps = chain.map(rowForStep);
          if (!steps.every(Boolean)) return renderFactLine(f);
          const cite = steps.map((g) => `${factPhrase(g)}${g.provenance ? ` (source: ${g.provenance})` : ""}`).join("; ");
          return `${renderFactLine(f)} \u2014 via: ${cite}`;
        });
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
        const preamble = inKind.length ? "" : `nothing I remember ties these to "${whichCan[1]}", but:
`;
        return { text: preamble + shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
      }
    }
    const canVerb = q.match(WHAT_CAN_VERB_RE);
    if (canVerb && canVerb[1].trim().split(/\s+/).at(-1)?.toLowerCase() !== "do") {
      const verbVariants = factTermVariants(normFactTerm2, canVerb[1]);
      const hits = capabilityExtension(verbVariants, await factRows(memoryDir, cache2));
      if (hits.length) {
        const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
        const lines = ranked.map(renderFactLine);
        const shown = lines.slice(0, FACT_ANSWER_CAP);
        const rest = lines.slice(FACT_ANSWER_CAP);
        const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
        return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
      }
    }
    const hasQ = q.match(WHAT_HAS_RE);
    if (hasQ && !HAS_TEMPORAL_TAIL.has(hasQ[1].trim().split(/\s+/)[0]?.toLowerCase())) {
      const variants = factTermVariants(normFactTerm2, hasQ[1]);
      const hits = (await factRows(memoryDir, cache2)).filter((f) => f.predicate === "mgx:hasA" && variants.has(f.object));
      if (!hits.length) return null;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const inheritsQ = q.match(WHAT_INHERITS_RE);
    const inheritsObj = envelope?.parsed?.shape === "reverse" && envelope.parsed.kind === "inherits" ? envelope.parsed.object : inheritsQ?.[1];
    if (inheritsObj) {
      const variants = factTermVariants(normFactTerm2, inheritsObj);
      const hits = (await factRows(memoryDir, cache2)).filter((f) => ISA_PREDICATES2.has(f.predicate) && variants.has(f.object));
      if (!hits.length) return null;
      const ranked = rankByBiasThenTrust(uniqueFacts(hits), biasByBundle);
      const lines = ranked.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    }
    const know = q.match(KNOW_ABOUT_RE);
    if (know) {
      const variants = factTermVariants(normFactTerm2, know[1]);
      const rows = await factRows(memoryDir, cache2);
      const isTaughtFact = (f) => !String(f.provenance || "").includes("corpus:") && !String(f.provenance || "").includes("web:");
      const isaRows = rows.filter((f) => ISA_PREDICATES2.has(f.predicate) && isTaughtFact(f));
      const subtypeSubjects = /* @__PURE__ */ new Set();
      let frontier = variants;
      for (let hop = 0; hop < 8 && frontier.size; hop += 1) {
        const nextSubjects = /* @__PURE__ */ new Set();
        for (const f of isaRows) {
          if (frontier.has(f.object) && !subtypeSubjects.has(f.subject)) nextSubjects.add(f.subject);
        }
        if (!nextSubjects.size) break;
        for (const s of nextSubjects) subtypeSubjects.add(s);
        const nextFrontier = /* @__PURE__ */ new Set();
        for (const s of nextSubjects) for (const v of factTermVariants(normFactTerm2, s)) nextFrontier.add(v);
        frontier = nextFrontier;
      }
      let hits = rows.filter((f) => variants.has(f.subject) || variants.has(f.object) || subtypeSubjects.has(f.subject));
      if (!hits.length) {
        const queryWords = normFactTerm2(know[1]).split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_ENTITY_WORDS.has(w));
        if (queryWords.length) {
          const wordsOf2 = (s) => new Set(String(s || "").split(/\s+/));
          const overlaps = (term2) => {
            const w = wordsOf2(term2);
            return queryWords.some((qw) => w.has(qw));
          };
          hits = rows.filter((f) => overlaps(f.subject) || overlaps(f.object));
        }
      }
      if (!hits.length) return null;
      const { findConsistencyViolations: findConsistencyViolations2, TYPE_PREDICATE: CONS_TYPE_PREDICATE, SUBCLASS_PREDICATE: CONS_SC_PREDICATE, DISJOINT_PREDICATE: CONS_DISJOINT_PREDICATE } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const consIsTaught = (f) => !f.provenance?.includes("corpus:") && !f.provenance?.includes("web:");
      const consTypeEdges = rows.filter((f) => f.predicate === CONS_TYPE_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
      const consSubClassEdges = rows.filter((f) => f.predicate === CONS_SC_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
      const consDisjointEdges = rows.filter((f) => f.predicate === CONS_DISJOINT_PREDICATE && consIsTaught(f)).map((f) => [f.subject, f.object]);
      if (consDisjointEdges.length) {
        const clashes = findConsistencyViolations2(consTypeEdges, consSubClassEdges, consDisjointEdges, { focus: variants, budget: 5 });
        const clash = clashes.find((c) => variants.has(c.subject));
        if (clash) {
          return {
            text: `I can't answer that \u2014 what I've been told about ${clash.subject} is inconsistent: it's taught to be both ${clash.classA} and ${clash.classB}, but ${clash.viaA} and ${clash.viaB} are disjoint (${clash.viaA} owl:disjointWith ${clash.viaB}). I'd need one of those retracted before I can answer honestly.`,
            replace: true
          };
        }
      }
      const literalHit = hits.find((f) => variants.has(f.subject) || variants.has(f.object));
      const term = literalHit ? variants.has(literalHit.subject) ? literalHit.subject : literalHit.object : know[1].trim();
      const viaSubtype = hits.some((f) => subtypeSubjects.has(f.subject) && !variants.has(f.subject) && !variants.has(f.object));
      hits = rankByBiasThenTrust(hits, biasByBundle);
      const lines = hits.map((f) => `  ${renderFactLine(f)}`);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
  \u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      const header = `${hits.length} remembered fact${hits.length === 1 ? "" : "s"} about ${term}${viaSubtype ? " (including its known subtypes)" : ""}:`;
      return { text: `${header}
${shown.join("\n")}${extra}`, replace: true, ...rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {} };
    }
    return null;
  }
  var TOLD_ABOUT_RE = /^what\s+(?:did|have)\s+(?:i|we|you)\s+(?:told|tell|said|say)\s+(?:you|me|us)?\s*about\s+(.+?)[?.!\s]*$/i;
  var KIND_OF_RE = /^what\s+kind\s+of\s+(?:thing|class|type|category|entity)?\s*(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  var CARD_AT_LEAST_ASK_RE = /^does\s+every\s+(.+?)\s+have\s+at\s+least\s+(\d+)\s+(.+?)[?.!\s]*$/i;
  var CARD_EXISTENCE_ASK_RE = /^does\s+an?\s+(.+?)\s+have\s+an?\s+(.+?)[?.!\s]*$/i;
  var CARDINALITY_ROW_PREDICATES = /* @__PURE__ */ new Set(["owl:cardinality", "owl:minCardinality", "owl:maxCardinality", "owl:onClass"]);
  var WHO_OWNS_RE = /^who\s+(?:owns|maintains)\s+(.+?)[?.!\s]*$/i;
  var OWNS_YESNO_RE = /^(?:does|did)\s+([\w'-]+)\s+(?:owns?|maintains?)\s+(.+?)[?.!\s]*$/i;
  var OWNS_PASSIVE_YESNO_RE = /^(?:is|are|was|were)\s+(.+?)\s+owned\s+by\s+([A-Za-z][\w'-]*(?:\s+[A-Z][\w'-]*)?)[?.!\s]*$/i;
  var HAS_METHOD_YESNO_RE = /^(?:does|did)\s+([\w'-]+)\s+(?:has|have)\s+an?\s+([a-z][\w-]*)\s+method[?.!\s]*$/i;
  var HAS_METHOD_OPEN_RE = /^what\s+methods\s+does\s+([\w'-]+)\s+have[?.!\s]*$/i;
  var IS_ADJECTIVE_YESNO_RE = /^(?:is|are|was|were)\s+(.+?)\s+([A-Za-z][\w-]*)[?.!\s]*$/i;
  var IS_ADJECTIVE_PRONOUN_RE = /^(?:it|this|that)$/i;
  var IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE = /^(?:you|i|they|he|she|we)\b/i;
  var unknownAdjectiveOffer = (subject, adjective) => ({
    text: `I don't know anything about "${subject}" yet \u2014 teach me directly, e.g. "remember that ${subject.toLowerCase()} is ${adjective}".`,
    replace: true
  });
  var WHOLE_RECALL_RE = /^(?:what\s+(?:did|have)\s+(?:i|we)\s+(?:told?|tell|said?|say)\s+(?:you|me|us)?(?:\s+(?:last\s+time|before|earlier|previously|already))?|what\s+facts?\s+do\s+you\s+(?:know|have|remember)|what\s+do\s+you\s+(?:know|remember)|what\s+have\s+you\s+(?:learned|learnt|remembered))[?.!\s]*$/i;
  async function entityClassNoun(graph, term) {
    const ent = await resolveEntity(graph, term);
    if (!ent) return null;
    const cls = (graph?.byId?.get?.(ent.id) || (graph?.individuals || []).find((i) => i?.id === ent.id))?.class;
    return cls && CLASS_LABELS[cls] ? CLASS_LABELS[cls][0] : null;
  }
  var INHERITS_GROUP_RE = /inherit|supertype|subclass|extend|specializ/i;
  var INHERITS_MAX_HOPS = 8;
  function inheritsChain(graph, startId) {
    const out = [];
    if (!graph || !startId) return out;
    const seen = /* @__PURE__ */ new Set([startId]);
    let cur = startId;
    for (let hop = 0; hop < INHERITS_MAX_HOPS; hop += 1) {
      let edge = null;
      for (const g of graph.relations || []) {
        if (!INHERITS_GROUP_RE.test(`${g?.prop || ""} ${g?.predicate || ""}`)) continue;
        edge = (g.edges || []).find((e) => e?.subject === cur) || null;
        if (edge) break;
      }
      if (!edge || seen.has(edge.object)) break;
      seen.add(edge.object);
      out.push({ id: edge.object, label: edge.objectLabel || edge.object });
      cur = edge.object;
    }
    return out;
  }
  async function factReadBack(memoryDir, query, envelope, miss2, graph = null, focusLabel = null, biasByBundle = {}, cache2 = null) {
    return withDeducedGoal(await factReadBackReaders(memoryDir, query, envelope, miss2, graph, focusLabel, biasByBundle, cache2), envelope, query);
  }
  async function factReadBackReaders(memoryDir, query, envelope, miss2, graph = null, focusLabel = null, biasByBundle = {}, cache2 = null) {
    if (!miss2) return null;
    let normFactTerm2;
    try {
      ({ normFactTerm: normFactTerm2 } = await Promise.resolve().then(() => (init_core(), core_exports)));
    } catch {
      return null;
    }
    const q = String(query).trim();
    if (graph) {
      const directIsaAsk = q.match(ISA_ASK_RE);
      if (directIsaAsk) {
        const ent = await resolveEntity(graph, directIsaAsk[1]);
        if (ent) {
          const directObjVariants = factTermVariants(normFactTerm2, stripTrailingDiscourseTag(directIsaAsk[2]));
          const directSup = inheritsChain(graph, ent.id).find((sup) => [...factTermVariants(normFactTerm2, sup.label)].some((v) => directObjVariants.has(v)));
          if (directSup) return { text: `yes \u2014 the code graph says ${ent.label} inherits ${directSup.label}.`, replace: true };
        }
      }
    }
    const qHedge = q.replace(/^(?:actually|really|honestly|yeah\s+nah)\s*,?\s+/i, "");
    const rows = await factRows(memoryDir, cache2);
    if (!rows.length) {
      if (!ISA_ASK_RE.test(qHedge) && !RELATION_FACT_YESNO_RE.test(qHedge)) {
        const emptyIsAdj = qHedge.match(IS_ADJECTIVE_YESNO_RE);
        if (emptyIsAdj) {
          const rawSubject = emptyIsAdj[1].trim();
          const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? focusLabel || null : rawSubject;
          if (subject && !/^there\b/i.test(subject) && !envelope?.parsed && !IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE.test(rawSubject)) {
            return unknownAdjectiveOffer(subject, emptyIsAdj[2].trim().toLowerCase());
          }
        }
      }
      return null;
    }
    const isa = rows.filter((f) => ISA_PREDICATES2.has(f.predicate));
    const byTrust = (a, b) => b.trust - a.trust;
    const renderMany = (hits2) => {
      const lines = hits2.map(renderFactLine);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
\u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: shown.join("\n") + extra, replace: true, ...rest.length ? { pending: { items: rest, noun: "facts" } } : {} };
    };
    if (WHOLE_RECALL_RE.test(q)) {
      const hits2 = rankByBiasThenTrust(isa.length ? isa : rows, biasByBundle);
      if (!hits2.length) return null;
      return renderMany(hits2);
    }
    const relAsk = qHedge.match(RELATION_FACT_YESNO_RE);
    if (relAsk) {
      const rawSubject = relAsk[1].trim();
      const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? focusLabel || null : rawSubject;
      const relationName = relAsk[2].trim().toLowerCase();
      const object = relAsk[3].trim();
      if (subject && !ISA_IDIOM_ROLE_WORDS.has(relationName)) {
        const aliasTrees = buildAliasSubClassTrees(rows);
        const { findIsaChain: chaseAlias } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
        const relationFactsFor = (name) => {
          const target = String(name || "").trim().toLowerCase();
          const out = [];
          for (const f of rows) {
            const role = relationRoleWord(f.predicate);
            if (!role) continue;
            if (role === target) {
              out.push({ fact: f, aliasFacts: [] });
              continue;
            }
            const chain = chaseAliasEitherTree(chaseAlias, role, /* @__PURE__ */ new Set([target]), aliasTrees, { maxHops: 2 });
            if (!chain) continue;
            const aliasFacts = chain.map((step) => rows.find(
              (r) => r.predicate === SUBCLASS_PREDICATE2 && r.subject === step.subject && r.object === step.object
            ));
            if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
          }
          return out;
        };
        const { loadMemory: loadMemory2, findRuleByName: findRuleByName2, resolveRelationChase: resolveRelationChase2 } = await Promise.resolve().then(() => (init_core(), core_exports));
        const { findActionPath: findActionPath2 } = await Promise.resolve().then(() => (init_planning(), planning_exports));
        const memory = await loadMemory2(memoryDir);
        const relationChaseHelpers = { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE, findActionPath: findActionPath2 };
        const hit2 = await resolveRelationChase2(memory, relationName, subject, object, relationChaseHelpers);
        if (hit2) return { text: `yes \u2014 ${hit2.citation.join("; ")}`, replace: true };
        const nameKnown = relationFactsFor(relationName).length > 0 || !!findRuleByName2(memory, relationName);
        if (!nameKnown) {
          return { text: `I don't know a relation or rule called '${relationName}' yet.`, replace: true };
        }
        return {
          text: `I know the '${relationName}' relation, but I can't confirm ${subject} is the ${relationName} of ${object} from what you've told me.`,
          replace: true
        };
      }
    }
    const whoAsk = qHedge.match(RELATION_WHO_ASK_RE) || matchGenitiveWhoAsk(qHedge);
    if (whoAsk) {
      const relationName = whoAsk[1].trim().toLowerCase();
      const rawObject = whoAsk[2].trim();
      const object = IS_ADJECTIVE_PRONOUN_RE.test(rawObject) ? focusLabel || null : rawObject;
      if (object && !ISA_IDIOM_ROLE_WORDS.has(relationName)) {
        const aliasTreesWho = buildAliasSubClassTrees(rows);
        const { findIsaChain: chaseAliasWho } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
        const relationFactsForWho = (name) => {
          const target = String(name || "").trim().toLowerCase();
          const out = [];
          for (const f of rows) {
            const role = relationRoleWord(f.predicate);
            if (!role) continue;
            if (role === target) {
              out.push({ fact: f, aliasFacts: [] });
              continue;
            }
            const chain = chaseAliasEitherTree(chaseAliasWho, role, /* @__PURE__ */ new Set([target]), aliasTreesWho, { maxHops: 2 });
            if (!chain) continue;
            const aliasFacts = chain.map((step) => rows.find(
              (r) => r.predicate === SUBCLASS_PREDICATE2 && r.subject === step.subject && r.object === step.object
            ));
            if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
          }
          return out;
        };
        const { loadMemory: loadMemWho, findRuleByName: findRuleByNameWho, resolveRelationChaseReverse: resolveRelationChaseReverse2 } = await Promise.resolve().then(() => (init_core(), core_exports));
        const memoryWho = await loadMemWho(memoryDir);
        const { findReachableSet: findReachableSet2 } = await Promise.resolve().then(() => (init_planning(), planning_exports));
        const relationChaseHelpersWho = { relationFactsFor: relationFactsForWho, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE, findReachableSet: findReachableSet2 };
        const hits2 = await resolveRelationChaseReverse2(memoryWho, relationName, object, relationChaseHelpersWho);
        if (hits2.length) {
          const lines = hits2.map((h) => `${h.subject} \u2014 ${h.citation.join("; ")}`);
          return { text: lines.join("\n"), replace: true };
        }
        const nameKnownWho = relationFactsForWho(relationName).length > 0 || !!findRuleByNameWho(memoryWho, relationName);
        if (!nameKnownWho) {
          return { text: `I don't know a relation or rule called '${relationName}' yet.`, replace: true };
        }
        const isWhatAsk = /^what\b/i.test(qHedge);
        return {
          text: isWhatAsk ? `I don't know what the ${relationName} of ${object} is from what you've told me.` : `I don't know anyone who is the ${relationName} of ${object} from what you've told me.`,
          replace: true
        };
      }
    }
    const listAsk = qHedge.match(RECURSIVE_LIST_ASK_RE);
    if (listAsk) {
      const ruleName = singularizeSurface(listAsk[1].trim().toLowerCase());
      const rawSubject = listAsk[2].trim();
      const subject = IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? focusLabel || null : rawSubject;
      if (subject) {
        const {
          loadMemory: loadMemory2,
          findRuleByName: findRuleByName2,
          RULE_KIND_PROP: ruleKindProp,
          RULE_KIND_RECURSIVE: recKind
        } = await Promise.resolve().then(() => (init_core(), core_exports));
        const memory = await loadMemory2(memoryDir);
        const rule = findRuleByName2(memory, ruleName);
        const ruleKind = rule?.attributes?.find((a) => a.prop === ruleKindProp)?.value;
        if (rule && ruleKind === recKind) {
          const baseCase = rule.attributes.find((a) => a.prop === "mgx:ruleBaseCase")?.value;
          const recStep = rule.attributes.find((a) => a.prop === "mgx:ruleRecStep")?.value;
          const startEntity = normFactTerm2(subject);
          if (baseCase && recStep && startEntity) {
            const aliasTreesList = buildAliasSubClassTrees(rows);
            const { findIsaChain: chaseAlias } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
            const relationFactsForList = (name) => {
              const target = String(name || "").trim().toLowerCase();
              const out = [];
              for (const f of rows) {
                const role = relationRoleWord(f.predicate);
                if (!role) continue;
                if (role === target) {
                  out.push({ fact: f, aliasFacts: [] });
                  continue;
                }
                const chain = chaseAliasEitherTree(chaseAlias, role, /* @__PURE__ */ new Set([target]), aliasTreesList, { maxHops: 2 });
                if (!chain) continue;
                const aliasFacts = chain.map((step) => rows.find(
                  (r) => r.predicate === SUBCLASS_PREDICATE2 && r.subject === step.subject && r.object === step.object
                ));
                if (aliasFacts.every(Boolean)) out.push({ fact: f, aliasFacts });
              }
              return out;
            };
            const { findReachableSet: findReachableSet2 } = await Promise.resolve().then(() => (init_planning(), planning_exports));
            const applyActions = (state) => {
              const relName = state.hop === 0 ? baseCase : recStep;
              return relationFactsForList(relName).filter((e) => e.fact.subject === state.entity).map((e) => ({ action: e, nextState: { entity: e.fact.object, hop: state.hop + 1 } }));
            };
            const stateKey = (state) => state.entity;
            const results = findReachableSet2({ entity: startEntity, hop: 0 }, applyActions, { maxDepth: 20, stateKey });
            if (results.length) {
              const lines = results.map(({ node, path }) => {
                const seenAlias = /* @__PURE__ */ new Set();
                const parts = [];
                for (const e of path.actions) {
                  parts.push(renderFactLine(e.fact));
                  for (const af of e.aliasFacts) {
                    const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
                    if (seenAlias.has(key)) continue;
                    seenAlias.add(key);
                    parts.push(`${factPhrase(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
                  }
                }
                return `${node.entity} \u2014 ${parts.join("; ")}`;
              });
              return { text: lines.join("\n"), replace: true };
            }
          }
        }
        return null;
      }
    }
    const confirmTag = q.match(CONFIRM_TAG_RE);
    const isaAsk = q.match(ISA_ASK_RE) || matchWhyIsa(q) || confirmTag && `is ${confirmTag[1].trim()} a ${confirmTag[2].trim()}`.match(ISA_ASK_RE);
    if (isaAsk) {
      const objVariants = factTermVariants(normFactTerm2, stripTrailingDiscourseTag(isaAsk[2]));
      const isaSubject = focusLabel && IS_ADJECTIVE_PRONOUN_RE.test(isaAsk[1].trim()) ? focusLabel : isaAsk[1];
      const subjCandidates = new Set(factTermVariants(normFactTerm2, isaSubject));
      const noun = await entityClassNoun(graph, isaSubject);
      if (noun) for (const v of factTermVariants(normFactTerm2, noun)) subjCandidates.add(v);
      const hit2 = isa.filter((f) => subjCandidates.has(f.subject) && objVariants.has(f.object)).sort(byTrust)[0];
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      const ent = await resolveEntity(graph, isaSubject);
      if (ent) {
        const bridgeSubjects = /* @__PURE__ */ new Map();
        for (const sup of inheritsChain(graph, ent.id)) {
          for (const v of factTermVariants(normFactTerm2, sup.label)) {
            if (!subjCandidates.has(v) && !bridgeSubjects.has(v)) bridgeSubjects.set(v, sup.label);
          }
        }
        const bridged = isa.filter((f) => bridgeSubjects.has(f.subject) && objVariants.has(f.object)).sort(byTrust)[0];
        if (bridged) {
          return {
            text: `yes \u2014 the code graph says ${ent.label} inherits ${bridgeSubjects.get(bridged.subject)}, and ${renderFactLine(bridged)}`,
            replace: true
          };
        }
      }
      const { findIsaChain: findIsaChain2, SUBCLASS_PREDICATE: SC_PREDICATE, TYPE_PREDICATE: RDF_TYPE_PREDICATE } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const isTaught = isOperatorTaught;
      const chainSubClassRows = isa.filter((f) => f.predicate === SC_PREDICATE && isTaught(f));
      const chainTypeRows = isa.filter((f) => f.predicate === RDF_TYPE_PREDICATE && isTaught(f));
      const chainSubClassEdges = chainSubClassRows.map((f) => [f.subject, f.object]);
      const chainTypeEdges = chainTypeRows.map((f) => [f.subject, f.object]);
      const factForStep = (step) => (step.predicate === SC_PREDICATE ? chainSubClassRows : chainTypeRows).find((f) => f.subject === step.subject && f.object === step.object);
      for (const subj of subjCandidates) {
        const chain = findIsaChain2(subj, objVariants, chainTypeEdges, chainSubClassEdges, { maxHops: 2 });
        if (!chain) continue;
        const premises = chain.map(factForStep);
        if (premises.every(Boolean)) return { text: `yes \u2014 ${renderIsaChain(premises)}`, replace: true };
      }
      const mixedSubClassRows = isa.filter((f) => f.predicate === SC_PREDICATE);
      const mixedTypeRows = isa.filter((f) => f.predicate === RDF_TYPE_PREDICATE);
      const mixedFactForStep = (step) => (step.predicate === SC_PREDICATE ? mixedSubClassRows : mixedTypeRows).find((f) => f.subject === step.subject && f.object === step.object);
      const mixedTypeEdges = mixedTypeRows.map((f) => [f.subject, f.object]);
      const mixedSubClassEdges = mixedSubClassRows.map((f) => [f.subject, f.object]);
      for (const subj of subjCandidates) {
        const chain = findIsaChain2(subj, objVariants, mixedTypeEdges, mixedSubClassEdges, { maxHops: 2 });
        if (!chain) continue;
        const premises = chain.map(mixedFactForStep);
        if (premises.every(Boolean) && premises.some(isTaught)) {
          return { text: `yes \u2014 ${renderIsaChain(premises)}`, replace: true };
        }
      }
      const { deriveDisjointViolations: deriveDisjointViolations2, DISJOINT_PREDICATE: DISJOINT_PREDICATE2 } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const disjointRows = rows.filter((f) => f.predicate === DISJOINT_PREDICATE2 && isTaught(f));
      const negSubjectMatch = isaSubject.match(/^(.*\S)\s+not$/i);
      const negSubject = negSubjectMatch && [
        negSubjectMatch[0],
        focusLabel && IS_ADJECTIVE_PRONOUN_RE.test(negSubjectMatch[1].trim()) ? focusLabel : negSubjectMatch[1]
      ];
      if (negSubject) {
        const negSubjVariants = factTermVariants(normFactTerm2, negSubject[1]);
        const negObjVariants = objVariants;
        const posHit = isa.filter((f) => negSubjVariants.has(f.subject) && negObjVariants.has(f.object)).sort(byTrust)[0];
        if (posHit) return { text: `no \u2014 ${renderFactLine(posHit)}`, replace: true };
        const negDisjoint = disjointRows.find((f) => negSubjVariants.has(f.subject) && negObjVariants.has(f.object) || negSubjVariants.has(f.object) && negObjVariants.has(f.subject));
        if (negDisjoint) return { text: `yes \u2014 ${renderFactLine(negDisjoint)}`, replace: true };
        const negSubjectWord = negSubject[1].trim();
        const negKindWord = stripTrailingDiscourseTag(isaAsk[2]).trim();
        return {
          text: `I can't confirm that either way \u2014 nothing I remember links ${negSubjectWord} and ${negKindWord}. If no ${negSubjectWord} is a ${negKindWord}, teach me: "no ${negSubjectWord} is a ${negKindWord}".`,
          replace: true,
          miss: true
        };
      }
      if (disjointRows.length) {
        const directDisjoint = disjointRows.find((f) => subjCandidates.has(f.subject) && objVariants.has(f.object) || subjCandidates.has(f.object) && objVariants.has(f.subject));
        if (directDisjoint) return { text: `no \u2014 ${renderFactLine(directDisjoint)}`, replace: true };
        const disjointEdges = disjointRows.map((f) => [f.subject, f.object]);
        const violations = deriveDisjointViolations2(chainTypeEdges, chainSubClassEdges, disjointEdges, { budget: 10 });
        for (const subj of subjCandidates) {
          const v = violations.find((vv) => vv.subject === subj && objVariants.has(vv.object));
          if (!v) continue;
          const typeFact = chainTypeRows.find((f) => f.subject === v.subject && f.object === v.viaType);
          const disjointFact = disjointRows.find((f) => f.subject === v.viaClass && f.object === v.object || f.subject === v.object && f.object === v.viaClass);
          const parts = [typeFact, disjointFact].filter(Boolean).map(renderFactLine);
          return { text: `no \u2014 ${parts.length ? parts.join("; ") : `${v.viaClass} and ${v.object} are disjoint.`}`, replace: true };
        }
      }
      const {
        deriveSomeValuesFromApplication: deriveSomeValuesFromApplication2,
        ON_PROPERTY_PREDICATE: ON_PROPERTY_PREDICATE2,
        SOME_VALUES_FROM_PREDICATE: SOME_VALUES_FROM_PREDICATE2,
        deriveSomeValuesFromSubsumption: deriveSomeValuesFromSubsumption2,
        ENTAILED_SCM_SVF_PROVENANCE: ENTAILED_SCM_SVF_PROVENANCE2,
        SCM_SVF_RULE_CONFIDENCE: SCM_SVF_RULE_CONFIDENCE2,
        entailedTrustFrom: entailedTrustFrom2
      } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const onPropertyRows = rows.filter((f) => f.predicate === ON_PROPERTY_PREDICATE2 && isTaught(f));
      const someValuesFromRows = rows.filter((f) => f.predicate === SOME_VALUES_FROM_PREDICATE2 && isTaught(f));
      if (onPropertyRows.length && someValuesFromRows.length) {
        const someValuesFromOf = new Map(someValuesFromRows.map((f) => [f.subject, f.object]));
        const restrictionEdges = onPropertyRows.map((f) => ({ restriction: f.subject, property: f.object, target: someValuesFromOf.get(f.subject) })).filter((r) => r.target);
        const svf1Reserved = /* @__PURE__ */ new Set([SC_PREDICATE, RDF_TYPE_PREDICATE, DISJOINT_PREDICATE2, ON_PROPERTY_PREDICATE2, SOME_VALUES_FROM_PREDICATE2, "owl:intersectionOf"]);
        const propertyRows = rows.filter((f) => isTaught(f) && !svf1Reserved.has(f.predicate));
        const propertyEdges = propertyRows.map((f) => [f.subject, f.predicate, f.object]);
        const svf1Derived = deriveSomeValuesFromApplication2(propertyEdges, chainTypeEdges, chainSubClassEdges, restrictionEdges, { budget: 10 });
        for (const subj of subjCandidates) {
          const hit3 = svf1Derived.find((d) => d.subject === subj && objVariants.has(d.object));
          if (!hit3) continue;
          const propFact = propertyRows.find((f) => f.subject === hit3.subject && f.predicate === hit3.viaProperty && f.object === hit3.viaValue);
          const typeFact = chainTypeRows.find((f) => f.subject === hit3.viaValue && f.object === hit3.viaType);
          const parts = [propFact, typeFact].filter(Boolean).map(renderFactLine);
          return {
            text: `yes \u2014 ${parts.length ? parts.join("; ") : `${hit3.subject} ${hit3.viaProperty} ${hit3.viaValue}, and ${hit3.viaValue} is a ${hit3.viaType}.`}`,
            replace: true
          };
        }
        const svfSubsumption = restrictionEdges.length > 1 ? deriveSomeValuesFromSubsumption2(restrictionEdges, chainSubClassEdges, { budget: 10 }) : [];
        if (svfSubsumption.length) {
          const enlargedSubClassEdges = chainSubClassEdges.concat(svfSubsumption.map((d) => [d.subject, d.object]));
          const restrictionByRid = new Map(restrictionEdges.map((r) => [r.restriction, r]));
          const svfTrustByTriple = /* @__PURE__ */ new Map();
          for (const f of rows) svfTrustByTriple.set(`${f.subject}\0${f.predicate}\0${f.object}`, f.trust);
          const svfPremiseTrust = (s, p, o) => svfTrustByTriple.get(`${s}\0${p}\0${o}`);
          const svfTrustOf = /* @__PURE__ */ new Map();
          for (const d of svfSubsumption) {
            const r1 = restrictionByRid.get(d.subject);
            const r2 = restrictionByRid.get(d.object);
            const premiseTrusts = [
              r1 && svfPremiseTrust(d.subject, ON_PROPERTY_PREDICATE2, r1.property),
              svfPremiseTrust(d.subject, SOME_VALUES_FROM_PREDICATE2, d.viaY1),
              r2 && svfPremiseTrust(d.object, ON_PROPERTY_PREDICATE2, r2.property),
              svfPremiseTrust(d.object, SOME_VALUES_FROM_PREDICATE2, d.viaY2),
              svfPremiseTrust(d.viaY1, SC_PREDICATE, d.viaY2)
            ].filter((t2) => typeof t2 === "number");
            const t = entailedTrustFrom2(premiseTrusts, SCM_SVF_RULE_CONFIDENCE2);
            if (t !== null) svfTrustOf.set(`${d.subject}\0${d.object}`, t);
          }
          const factForStepOrSvf = (step) => {
            if (step.predicate !== SC_PREDICATE) return chainTypeRows.find((f) => f.subject === step.subject && f.object === step.object);
            const stated = chainSubClassRows.find((f) => f.subject === step.subject && f.object === step.object);
            if (stated) return stated;
            const derived = svfSubsumption.find((d) => d.subject === step.subject && d.object === step.object);
            return derived ? {
              subject: derived.subject,
              predicate: SC_PREDICATE,
              object: derived.object,
              provenance: ENTAILED_SCM_SVF_PROVENANCE2,
              trust: svfTrustOf.get(`${derived.subject}\0${derived.object}`)
            } : void 0;
          };
          for (const subj of subjCandidates) {
            const chain = findIsaChain2(subj, objVariants, chainTypeEdges, enlargedSubClassEdges, { maxHops: 3 });
            if (!chain) continue;
            const premises = chain.map(factForStepOrSvf);
            if (premises.every(Boolean)) {
              const chainTrust = entailedTrustFrom2(premises.map((p) => p.trust), 1);
              return { text: `yes \u2014 ${renderIsaChain(premises)}`, replace: true, ...chainTrust !== null ? { trust: chainTrust } : {} };
            }
          }
        }
      }
      const directSubjVariants = factTermVariants(normFactTerm2, isaSubject);
      const knownSubjectIsa = isa.filter((f) => directSubjVariants.has(f.subject)).sort(byTrust);
      const subjectWord = isaSubject.trim();
      const kindWord = stripTrailingDiscourseTag(isaAsk[2]).trim();
      const deeperChainExists = [...subjCandidates].some(
        (subj) => findIsaChain2(subj, objVariants, chainTypeEdges, chainSubClassEdges, { maxHops: DEEP_CHAIN_PROBE_HOPS })
      );
      if (knownSubjectIsa.length) {
        const shown = knownSubjectIsa.slice(0, 3).map(renderFactLine).join("; ");
        const recovery = deeperChainExists ? `The facts to settle it are here, but the chain is longer than I follow while answering. Run "/syllogise ${subjectWord}", then ask me again.` : `If it's true, teach me: "${subjectWord} is a kind of ${kindWord}".`;
        return {
          text: `I can't confirm that \u2014 nothing I remember says ${subjectWord} is a ${kindWord}. I do know: ${shown}. ${recovery}`,
          replace: true,
          miss: true
          // still a MISS in the turn record — honest wording, not an answer
        };
      }
      if (!ent && !noun && !isPronoun(subjectWord) && !rows.some((f) => subjCandidates.has(f.subject) || subjCandidates.has(f.object))) {
        return {
          text: `I can't confirm that \u2014 I don't know "${subjectWord}" at all yet. If it's true, teach me: "${subjectWord} is a kind of ${kindWord}".`,
          replace: true,
          miss: true
        };
      }
      return null;
    }
    const cardAtLeast = q.match(CARD_AT_LEAST_ASK_RE);
    if (cardAtLeast) {
      const [, subjRaw, mRaw, objRaw] = cardAtLeast;
      const {
        SUBCLASS_PREDICATE: CARD_SC_PREDICATE,
        ON_PROPERTY_PREDICATE: CARD_ON_PROPERTY_PREDICATE,
        buildCardinalityRestrictions: buildCardinalityRestrictions2,
        proveCardinalityAtLeast: proveCardinalityAtLeast2,
        CARDINALITY_RULE_CONFIDENCE: CARDINALITY_RULE_CONFIDENCE2,
        entailedTrustFrom: entailedTrustFrom2
      } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const isTaughtCard = isOperatorTaught;
      const cardSubClassEdges = isa.filter((f) => f.predicate === CARD_SC_PREDICATE && isTaughtCard(f)).map((f) => [f.subject, f.object]);
      const cardRows = rows.filter((f) => (f.predicate === CARD_ON_PROPERTY_PREDICATE || CARDINALITY_ROW_PREDICATES.has(f.predicate)) && isTaughtCard(f));
      const cardinalityRestrictionEdges = buildCardinalityRestrictions2(cardRows);
      if (cardinalityRestrictionEdges.length) {
        const subjVariants = factTermVariants(normFactTerm2, subjRaw.trim());
        const objVariants = factTermVariants(normFactTerm2, objRaw.trim());
        const m = Number(mRaw);
        const witness = findAcrossVariants(subjVariants, objVariants, (s, o) => proveCardinalityAtLeast2(cardSubClassEdges, cardinalityRestrictionEdges, s, o, m, {}));
        if (witness) {
          const restrictionFact = rows.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.viaClass && f.object === witness.viaRestriction);
          const cite = restrictionFact?.provenance ? ` (source: ${restrictionFact.provenance})` : "";
          const kindWord = witness.kind === "exactly" ? "exactly" : "at least";
          const plural = (w, n) => `${w}${n === 1 ? "" : "s"}`;
          const cardPremiseTrusts = [
            restrictionFact?.trust,
            ...cardRows.filter((f) => f.subject === witness.viaRestriction).map((f) => f.trust),
            ...witness.viaClass !== witness.subject ? [isa.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.subject && f.object === witness.viaClass)?.trust] : []
          ].filter((t) => typeof t === "number");
          const trust = entailedTrustFrom2(cardPremiseTrusts, CARDINALITY_RULE_CONFIDENCE2);
          return {
            text: `yes \u2014 every ${witness.viaClass} has ${kindWord} ${witness.n} ${plural(witness.object, witness.n)}${cite}, so at least ${m} follows.`,
            replace: true,
            ...trust !== null ? { trust } : {}
          };
        }
      }
    }
    const cardExistence = q.match(CARD_EXISTENCE_ASK_RE);
    if (cardExistence) {
      const [, subjRaw, objRaw] = cardExistence;
      const {
        SUBCLASS_PREDICATE: CARD_SC_PREDICATE,
        ON_PROPERTY_PREDICATE: CARD_ON_PROPERTY_PREDICATE,
        buildCardinalityRestrictions: buildCardinalityRestrictions2,
        proveMaxCardinalityZeroDenial: proveMaxCardinalityZeroDenial2,
        CAX_MAXC0_RULE_CONFIDENCE: CAX_MAXC0_RULE_CONFIDENCE2,
        entailedTrustFrom: entailedTrustFrom2
      } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
      const isTaughtCard = isOperatorTaught;
      const cardSubClassEdges = isa.filter((f) => f.predicate === CARD_SC_PREDICATE && isTaughtCard(f)).map((f) => [f.subject, f.object]);
      const cardRows = rows.filter((f) => (f.predicate === CARD_ON_PROPERTY_PREDICATE || CARDINALITY_ROW_PREDICATES.has(f.predicate)) && isTaughtCard(f));
      const cardinalityRestrictionEdges = buildCardinalityRestrictions2(cardRows);
      if (cardinalityRestrictionEdges.length) {
        const subjVariants = factTermVariants(normFactTerm2, subjRaw.trim());
        const objVariants = factTermVariants(normFactTerm2, objRaw.trim());
        const witness = findAcrossVariants(subjVariants, objVariants, (s, o) => proveMaxCardinalityZeroDenial2(cardSubClassEdges, cardinalityRestrictionEdges, s, o, {}));
        if (witness) {
          const restrictionFact = rows.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.viaClass && f.object === witness.viaRestriction);
          const cite = restrictionFact?.provenance ? ` (source: ${restrictionFact.provenance})` : "";
          const cardPremiseTrusts = [
            restrictionFact?.trust,
            ...cardRows.filter((f) => f.subject === witness.viaRestriction).map((f) => f.trust),
            ...witness.viaClass !== witness.subject ? [isa.find((f) => f.predicate === CARD_SC_PREDICATE && f.subject === witness.subject && f.object === witness.viaClass)?.trust] : []
          ].filter((t) => typeof t === "number");
          const trust = entailedTrustFrom2(cardPremiseTrusts, CAX_MAXC0_RULE_CONFIDENCE2);
          return { text: `no \u2014 every ${witness.viaClass} has at most 0 ${witness.object}${cite}.`, replace: true, ...trust !== null ? { trust } : {} };
        }
      }
    }
    const owns = q.match(WHO_OWNS_RE);
    if (owns) {
      const variants2 = factTermVariants(normFactTerm2, owns[1]);
      const hits2 = rows.filter((f) => f.predicate === OWNED_BY_PREDICATE && variants2.has(f.subject)).sort(byTrust);
      if (!hits2.length) return null;
      return renderMany(hits2);
    }
    const ownsYN = qHedge.match(OWNS_YESNO_RE);
    if (ownsYN) {
      const [, ownerRaw, thingRaw] = ownsYN;
      const ownerVariants = factTermVariants(normFactTerm2, ownerRaw.trim());
      const thingVariants = factTermVariants(normFactTerm2, thingRaw.replace(/^an?\s+/i, "").trim());
      const hit2 = rows.filter((f) => f.predicate === OWNED_BY_PREDICATE && thingVariants.has(f.subject) && ownerVariants.has(f.object)).sort(byTrust)[0];
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return {
        text: `no \u2014 no remembered fact says ${ownerRaw.trim().toLowerCase()} owns/maintains ${thingRaw.trim()}.`,
        replace: true
      };
    }
    const ownsPassiveYN = qHedge.match(OWNS_PASSIVE_YESNO_RE);
    if (ownsPassiveYN) {
      const [, thingRaw, ownerRaw] = ownsPassiveYN;
      const thingVariants = factTermVariants(normFactTerm2, thingRaw.replace(/^an?\s+/i, "").trim());
      const ownerVariants = factTermVariants(normFactTerm2, ownerRaw.trim());
      const hit2 = rows.filter((f) => f.predicate === OWNED_BY_PREDICATE && thingVariants.has(f.subject) && ownerVariants.has(f.object)).sort(byTrust)[0];
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return {
        text: `no \u2014 no remembered fact says ${thingRaw.trim().toLowerCase()} is owned by ${ownerRaw.trim()}.`,
        replace: true
      };
    }
    const hasMethodYN = qHedge.match(HAS_METHOD_YESNO_RE);
    if (hasMethodYN) {
      const [, subjRaw, capRaw] = hasMethodYN;
      const subjVariants = factTermVariants(normFactTerm2, subjRaw.trim());
      const objVariants = factTermVariants(normFactTerm2, `${capRaw.trim()} method`);
      const hit2 = rows.filter((f) => f.predicate === HAS_A_PREDICATE && subjVariants.has(f.subject) && objVariants.has(f.object)).sort(byTrust)[0];
      if (hit2) return { text: `yes \u2014 ${renderFactLine(hit2)}`, replace: true };
      return null;
    }
    const hasMethodOpen = qHedge.match(HAS_METHOD_OPEN_RE);
    if (hasMethodOpen) {
      const subjVariants = factTermVariants(normFactTerm2, hasMethodOpen[1].trim());
      const hits2 = rows.filter((f) => f.predicate === HAS_A_PREDICATE && subjVariants.has(f.subject) && / method$/.test(f.object)).sort(byTrust);
      if (!hits2.length) return null;
      return renderMany(hits2);
    }
    const isAdj = qHedge.match(IS_ADJECTIVE_YESNO_RE);
    if (isAdj) {
      const rawSubject = isAdj[1].trim();
      const subject = IS_ADJECTIVE_YESNO_PRONOUN_SUBJECT_RE.test(rawSubject) ? null : IS_ADJECTIVE_PRONOUN_RE.test(rawSubject) ? focusLabel || null : rawSubject;
      const adjective = isAdj[2].trim().toLowerCase();
      if (subject) {
        const subjVariants = factTermVariants(normFactTerm2, subject);
        const bridgeSubjects = /* @__PURE__ */ new Map();
        let bridgeEnt = null;
        if (graph) {
          const ent = await resolveEntity(graph, subject);
          bridgeEnt = ent;
          if (ent) {
            for (const sup of inheritsChain(graph, ent.id)) {
              for (const v of factTermVariants(normFactTerm2, sup.label)) {
                if (!subjVariants.has(v) && !bridgeSubjects.has(v)) bridgeSubjects.set(v, sup.label);
                subjVariants.add(v);
              }
            }
          }
        }
        const propertyMatch = (f) => f.predicate === HAS_PROPERTY_PREDICATE && normFactTerm2(f.object) === adjective || f.predicate === `tmct:${adjective}` && f.object === "true";
        const subjWords = normFactTerm2(subject).split(/\s+/).filter((w) => w.length >= 4 && !GENERIC_ENTITY_WORDS.has(w));
        const wordOverlap = (f) => subjWords.some((w) => new Set(String(f.subject || "").split(/\s+/)).has(w));
        const subjectMatch = (f) => subjVariants.has(f.subject) || subjWords.length && wordOverlap(f);
        const hit2 = rows.filter((f) => subjectMatch(f) && propertyMatch(f)).sort(byTrust)[0];
        if (hit2) {
          const viaSuper = bridgeSubjects.get(hit2.subject);
          return {
            text: viaSuper ? `yes \u2014 the code graph says ${bridgeEnt.label} inherits ${viaSuper}, and ${renderFactLine(hit2)}` : `yes \u2014 ${renderFactLine(hit2)}`,
            replace: true
          };
        }
        {
          const { findIsaChain: chaseAdj, SUBCLASS_PREDICATE: SC_PREDICATE_ADJ, TYPE_PREDICATE: TYPE_PREDICATE_ADJ } = await Promise.resolve().then(() => (init_syllogise(), syllogise_exports));
          const isTaughtAdj = isOperatorTaught;
          const chainSubClassRowsAdj = rows.filter((f) => f.predicate === SC_PREDICATE_ADJ && isTaughtAdj(f));
          const chainTypeRowsAdj = rows.filter((f) => f.predicate === TYPE_PREDICATE_ADJ && isTaughtAdj(f));
          const chainSubClassEdgesAdj = chainSubClassRowsAdj.map((f) => [f.subject, f.object]);
          const chainTypeEdgesAdj = chainTypeRowsAdj.map((f) => [f.subject, f.object]);
          const factForStepAdj = (step) => (step.predicate === SC_PREDICATE_ADJ ? chainSubClassRowsAdj : chainTypeRowsAdj).find((f) => f.subject === step.subject && f.object === step.object);
          const adjObjVariants = factTermVariants(normFactTerm2, adjective);
          for (const subj of subjVariants) {
            const chain = chaseAdj(subj, adjObjVariants, chainTypeEdgesAdj, chainSubClassEdgesAdj, { maxHops: 2 });
            if (!chain) continue;
            const premises = chain.map(factForStepAdj);
            if (premises.every(Boolean)) return { text: `yes \u2014 ${renderIsaChain(premises)}`, replace: true };
          }
        }
        if (rows.some(subjectMatch) && !envelope?.parsed) {
          return { text: `I don't have a fact saying ${subject.toLowerCase()} is ${adjective}.`, replace: true };
        }
        if (!envelope?.parsed) return unknownAdjectiveOffer(subject, adjective);
      }
    }
    const genYN = positiveQuestionSurface(q).match(GENERAL_VERB_YESNO_RE);
    if (genYN && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
      const [, subjectRaw, verbRaw, objectRaw] = genYN;
      const verb = verbRaw.toLowerCase();
      if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb)) {
        const subject = subjectRaw.trim();
        const folded = foldPrepositionIntoPredicate(await generalVerbPredicate(verb), objectRaw);
        const object = folded.object.replace(/^an?\s+/i, "").trim();
        if (subject && object) {
          const predicate = folded.predicate;
          const subjVariants = factTermVariants(normFactTerm2, subject);
          const objVariants = factTermVariants(normFactTerm2, object);
          const polar = [predicate, negatedPredicate(predicate)];
          const hit2 = rows.filter((f) => polar.includes(f.predicate) && subjVariants.has(f.subject) && objVariants.has(f.object)).sort(byTrust)[0];
          if (hit2) {
            const verdict = isNegatedPredicate(hit2.predicate) ? "no" : "yes";
            return { text: `${verdict} \u2014 ${renderFactLine(hit2)}`, replace: true, generalVerbQuery: true };
          }
          const sameRelation = rows.filter((f) => polar.includes(f.predicate) && subjVariants.has(f.subject));
          if (sameRelation.length) {
            const shown = sameRelation.slice(0, 3).map(renderFactLine).join("; ");
            return {
              text: `I can't confirm that \u2014 nothing I remember says ${factPhrase({ subject, predicate, object })}. I do know: ${shown}.`,
              replace: true,
              miss: true
            };
          }
          return null;
        }
      }
    }
    const genOpen = q.match(GENERAL_VERB_OPEN_RE);
    if (genOpen && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
      const [, subjectRaw, verbRaw] = genOpen;
      const [verb, verbPrep] = verbRaw.toLowerCase().split(/\s+/);
      if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb)) {
        const subject = subjectRaw.trim();
        if (subject) {
          let predicate = await generalVerbPredicate(verb);
          if (verbPrep && /^mgx:[a-z]+$/.test(predicate)) predicate = `${predicate}-${verbPrep}`;
          const subjVariants = factTermVariants(normFactTerm2, subject);
          const polar = [predicate, negatedPredicate(predicate)];
          const hits2 = rankByBiasThenTrust(rows.filter((f) => polar.includes(f.predicate) && subjVariants.has(f.subject)), biasByBundle);
          if (hits2.length) return { ...renderMany(hits2), generalVerbQuery: true };
        }
      }
    }
    const genReverse = q.match(/^(?:what|who)\s+([a-z]+)\s+(on|in|at|onto|upon|under|over|beside|near|behind|above|below|inside|outside)\s+(.+?)[?.!\s]*$/i);
    if (genReverse && !GENERAL_VERB_ANYWHERE_EXCLUDE_RE.test(q)) {
      const [, verbSurface, prep, objectRaw] = genReverse;
      const verb = verbSurface.toLowerCase();
      if (!GENERAL_VERB_EXCLUDE_RE.test(verb) && !GENERAL_VERB_QUERY_EXCLUDE_RE.test(verb) && !GENERAL_VERB_NOT_A_VERB_RE.test(verb)) {
        let predicate = await generalVerbPredicate(verb);
        if (/^mgx:[a-z]+$/.test(predicate)) predicate = `${predicate}-${prep.toLowerCase()}`;
        const objVariants = factTermVariants(normFactTerm2, objectRaw.replace(/^(?:an?|the)\s+/i, "").trim());
        const hits2 = rankByBiasThenTrust(rows.filter((f) => f.predicate === predicate && objVariants.has(f.object)), biasByBundle);
        if (hits2.length) return { ...renderMany(hits2), generalVerbQuery: true };
      }
    }
    const told = q.match(TOLD_ABOUT_RE);
    if (told) {
      const variants2 = factTermVariants(normFactTerm2, told[1]);
      const hits2 = rankByBiasThenTrust(rows.filter((f) => variants2.has(f.subject) || variants2.has(f.object)), biasByBundle);
      if (!hits2.length) return null;
      const term2 = variants2.has(hits2[0].subject) ? hits2[0].subject : hits2[0].object;
      const lines = hits2.map((f) => `  ${renderFactLine(f)}`);
      const shown = lines.slice(0, FACT_ANSWER_CAP);
      const rest = lines.slice(FACT_ANSWER_CAP);
      const extra = rest.length ? `
  \u2026and ${rest.length} more \u2014 say 'more' to see them.` : "";
      return { text: `${hits2.length} remembered fact${hits2.length === 1 ? "" : "s"} about ${term2}:
${shown.join("\n")}${extra}`, replace: true, ...rest.length ? { pending: { items: rest.map((l) => l.trim()), noun: "facts" } } : {} };
    }
    let term = envelope?.parsed?.shape === "meta" ? envelope.parsed.object : null;
    let kindOf = false;
    const mk = q.match(KIND_OF_RE);
    if (mk) {
      term = mk[1];
      kindOf = true;
    } else if (!term && !envelope?.parsed) {
      const m = q.match(/^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i);
      if (m) term = m[1];
    }
    if (!term) return null;
    const variants = factTermVariants(normFactTerm2, term);
    const subjectHits = rankByBiasThenTrust(isa.filter((f) => variants.has(f.subject)), biasByBundle);
    const objectHits = rankByBiasThenTrust(isa.filter((f) => variants.has(f.object)), biasByBundle);
    const hits = kindOf ? subjectHits.length ? subjectHits : objectHits : objectHits.length ? objectHits : subjectHits;
    if (!hits.length) return null;
    return renderMany(hits);
  }
  var PRONOUN_IN_QUERY_RE = new RegExp(`\\b(?:${[...CONTEXT_WORDS].join("|")})\\b`, "i");
  var BARE_WHATIS_RE = /^what\s+(?:is|are)\s+(?:an?\s+)?(.+?)[?.!\s]*$/i;
  var DESCRIBE_GRAIN_WORD_RE = new RegExp(
    `^(?:(?:the|a|an)\\s+)?(.+?)\\s+(${Object.keys(ENTITY_TO_TYPE).join("|")})$`,
    "i"
  );
  var GOAL_BY_COMMAND = {
    find: "locate a specific named entity",
    search: "locate a specific named entity",
    context: "gather the sized edit bundle for a symbol before changing code",
    snippet: "view a symbol's exact source",
    describe: "look up a symbol's definition and relations",
    signature: "view a symbol's signature",
    members: GOAL_BY_KIND.contains,
    subclasses: GOAL_BY_KIND.inherits,
    impact: "understand what a change to this module would reach (impact closure)",
    callers: GOAL_BY_KIND.calls,
    callees: GOAL_BY_KIND.calls,
    tests: GOAL_BY_KIND.tests,
    untested: GOAL_BY_KIND.tests,
    history: GOAL_BY_KIND.touches,
    exports: GOAL_BY_KIND.reexports,
    arch: "understand the overall architecture (package/module boundaries)",
    capabilities: "see what /plan can plan over \u2014 built-in query tools and taught actions",
    syllogise: "materialize the entailed facts that follow from what's remembered about one term"
  };
  var BASE_QUALIFIER_SRC = "as\\s+(?:its|the|an?)?\\s*(?:base\\s+class|parent\\s+class|base|parent)";
  var USES_AS_BASE_WH_ASK_RE = new RegExp(
    `^(.+?)\\s+uses?\\s+(?:which\\s+[\\w'-]+|what)\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`,
    "i"
  );
  var USES_AS_BASE_WHAT_FRONT_RE = new RegExp(
    `^what\\s+(?:does|do|did)\\s+(.+?)\\s+uses?\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`,
    "i"
  );
  var USES_AS_BASE_YESNO_RE = new RegExp(
    `^(?:does|do|did)\\s+(.+?)\\s+uses?\\s+(.+?)\\s+${BASE_QUALIFIER_SRC}\\s*\\??$`,
    "i"
  );
  var USES_AS_BASE_TEACH_RE = new RegExp(
    `^(.+?)\\s+uses?\\s+(.+?)\\s+${BASE_QUALIFIER_SRC}\\s*[.!]*$`,
    "i"
  );
  var VOCAB_PRONOUN_LEAD_SUBJECTS = Object.freeze([...CONTEXT_WORDS].filter((w) => w !== "here").concat("they"));
  var VOCAB_PRONOUN_LEAD_RE = new RegExp(
    `^((?:is|are|can|could|does|do)\\s+|what\\s+(?:is|are)\\s+)(${VOCAB_PRONOUN_LEAD_SUBJECTS.join("|")})\\b(\\s+\\S.*)?$`,
    "i"
  );
  var SEED_MARKER_REL = join(".tmct", "memory", "corpus-seed.json");

  // src/surfaces/web/memory-ask-browser-entry.mjs
  init_core();
  globalThis.tmctMemoryAsk = { factAnswer, factReadBack, createInMemoryStore, normFactTerm };
})();
