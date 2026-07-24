// Routing around the code-orientation phrasings, over a graph whose symbol
// names collide with the words those phrasings use (renderArchitecture,
// moduleOverviewText-style identifiers): the architecture map wins the
// closed architecture phrases, the orientation card wins the overview
// phrases, a bare module basename resolves "what is X" the way describe
// does, and the answering-for disclosure note lists only candidates that
// matched the query's own tokens.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const MODULES = [
  { path: "src/domain/codegraph.mjs", dotted: "codegraph", imports: [], calls: [],
    defines: [
      { name: "renderArchitecture", kind: "function", lineno: 1, decorators: [] },
      { name: "resolveSymbol", kind: "function", lineno: 9, decorators: [] },
    ] },
  { path: "src/adapters/graph-build.mjs", dotted: "graphbuild", imports: [], calls: [],
    defines: [{ name: "buildGraph", kind: "function", lineno: 1, decorators: [] }] },
  { path: "src/adapters/graph-merge.mjs", dotted: "graphmerge", imports: [], calls: [],
    defines: [{ name: "mergeGraphs", kind: "function", lineno: 1, decorators: [] }] },
  { path: "src/providers/graph-service.mjs", dotted: "graphservice", imports: [], calls: [],
    defines: [{ name: "serveGraph", kind: "function", lineno: 1, decorators: [] }] },
  { path: "src/index/index-repo.mjs", dotted: "indexrepo", imports: ["graphbuild"], calls: [], defines: [] },
  { path: "src/services/chat.mjs", dotted: "chat", imports: [], calls: [],
    defines: [{ name: "runChat", kind: "function", lineno: 1, decorators: [] }] },
  { path: "src/services/chat-page-viz.mjs", dotted: "chatpageviz", imports: [], calls: [], defines: [] },
  { path: "src/tools/use-chat.mjs", dotted: "usechat", imports: ["chat"], calls: [], defines: [] },
  // Two modules sharing one basename stem — the tie that must keep the bare
  // "what is util" identity phrasing from claiming either.
  { path: "src/a/util.mjs", dotted: "autil", imports: [], calls: [], defines: [] },
  { path: "src/b/util.mjs", dotted: "butil", imports: [], calls: [], defines: [] },
];

const payload = buildEntities(MODULES, []);
const GRAPH = parseEntities(payload);
let dir;
let CONFIG;

before(async () => {
  clearCache();
  dir = await mkdtemp(join(tmpdir(), "tmct-orientation-routing-"));
  const file = join(dir, "graph.json");
  await writeFile(file, JSON.stringify(payload));
  CONFIG = { graphFile: file };
});

after(async () => {
  clearCache();
  await rm(dir, { recursive: true, force: true });
});

const turn = async (q) => (await runTurn(q, { config: CONFIG, graph: GRAPH })).answer;

test("'show me the architecture' reaches the whole-repo architecture map, never the symbol literally named renderArchitecture", async () => {
  const answer = await turn("show me the architecture");
  assert.match(answer, /^Architecture: \d+ module\(s\)/);
  assert.doesNotMatch(answer, /renderArchitecture — Function/);
});

test("'what is the architecture of this repo' reaches the same map instead of a vocabulary miss", async () => {
  const answer = await turn("what is the architecture of this repo");
  assert.match(answer, /^Architecture: \d+ module\(s\)/);
});

test("a bare 'the architecture' reaches the map too", async () => {
  const answer = await turn("the architecture");
  assert.match(answer, /^Architecture: \d+ module\(s\)/);
});

test("'describe renderArchitecture' still resolves the symbol itself — naming a symbol beats the architecture set", async () => {
  const answer = await turn("describe renderArchitecture");
  assert.match(answer, /renderArchitecture — Function/);
  assert.doesNotMatch(answer, /^Architecture: \d+ module/);
});

test("'give me an overview' gets the orientation card, never a fuzzy symbol card", async () => {
  const answer = await turn("give me an overview");
  assert.match(answer, /I'm tmct/);
  assert.doesNotMatch(answer, /— Function \(id:/);
});

test("a bare 'an overview' gets the orientation card too", async () => {
  const answer = await turn("an overview");
  assert.match(answer, /I'm tmct/);
});

test("'what is codegraph' (bare extensionless basename) resolves the module the way describe does", async () => {
  const answer = await turn("what is codegraph");
  assert.match(answer, /^src\/domain\/codegraph\.mjs is a module/);
});

test("a basename stem shared by two modules keeps the bare identity phrasing from claiming either", async () => {
  const answer = await turn("what is util");
  assert.doesNotMatch(answer, /^src\/[ab]\/util\.mjs is a module/);
});

test("an articled 'what is a codegraph' keeps its vocabulary reading — the basename widening only reads a bare term", async () => {
  const answer = await turn("what is a codegraph");
  assert.doesNotMatch(answer, /^src\/domain\/codegraph\.mjs is a module/);
});

test("the answering-for note drops candidates sharing only generic path components with the term", async () => {
  const answer = await turn("which modules import graph-build.mjs");
  assert.match(answer, /src\/index\/index-repo\.mjs/);
  assert.doesNotMatch(answer, /answering for/, "graph-merge/graph-service share only 'graph'/'mjs' with the term — no disclosure note");
});

test("the answering-for note keeps candidates that matched the query token itself", async () => {
  const answer = await turn("which modules import chat");
  assert.match(answer, /src\/tools\/use-chat\.mjs/);
  assert.match(answer, /\(answering for src\/services\/chat\.mjs — \d+ other match/);
  assert.match(answer, /runChat/);
});
