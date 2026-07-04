// nlp-bundle.mjs — package wink-nlp + wink-eng-lite-web-model into ONE browser
// IIFE that self-registers `window.__seonixNlp = {lemma, posTags}`, the same
// adapter shape ask-nlp.mjs builds for Node. It is the browser path for the
// viewer's lemma/POS tier (operator override of the earlier "CLI-only" call).
//
// WHY a hand-rolled packager and not a bundler: both packages are pure CJS with
// ONLY static `require('./relative')` calls and NO Node built-ins (verified), so
// a ~40-line CommonJS-in-the-browser shim that walks the require graph, wraps each
// file in a module factory, and emits a tiny `require` closure is enough — no
// esbuild/rollup dependency, in keeping with the repo's lean-deps rule. The model
// data files are JSON `require`s, inlined as `module.exports=<json>`.
//
// BOUNDARY (mirrors ask-nlp.mjs's): this bundle is used ONLY by the SITE build
// (viz --data-out --nlp writes it as a same-origin sibling the page lazy-loads)
// or by an explicit `viz --nlp` on a portable file (inlined). The default local
// single-file viewer never includes it and keeps its no-external-fetch guarantee.
// The wink model self-loads via the browser `atob` global (it is a WEB model);
// nothing here touches the DOM, fs, or the network.
//
// The lemma/posTags bodies below MIRROR ask-nlp.mjs's Node adapter deliberately;
// nlp-bundle.test.mjs pins output parity between the two so they can't drift.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Every internal require in these two packages is a static string literal (checked
// against the shipped versions); a lexical scan is therefore exact enough to build
// the graph, and any request that fails to resolve throws loudly rather than
// silently dropping a module.
const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Walk the CJS require graph from `entries` (bare package specifiers), reading
 *  every reachable .js/.json file, and return {order, deps, idOf, entryPaths}. */
async function packGraph(entries, fromUrl) {
  const rootReq = createRequire(fromUrl);
  const idOf = new Map(); // absPath -> integer id (stable, discovery order)
  const order = []; // absPath[]
  const deps = new Map(); // absPath -> { request -> absPath }
  const isJson = (p) => p.endsWith(".json");
  const assign = (p) => { if (!idOf.has(p)) { idOf.set(p, idOf.size); order.push(p); } };

  async function walk(absPath) {
    if (deps.has(absPath)) return; // visited (also breaks require cycles)
    deps.set(absPath, {});
    assign(absPath);
    if (isJson(absPath)) return; // data leaf, no requires
    const src = await readFile(absPath, "utf8");
    const localReq = createRequire(absPath);
    const map = {};
    REQUIRE_RE.lastIndex = 0;
    for (let m; (m = REQUIRE_RE.exec(src)); ) {
      const request = m[2];
      map[request] = localReq.resolve(request); // throws if unresolvable — loud by design
    }
    deps.set(absPath, map);
    for (const target of Object.values(map)) await walk(target);
  }

  const entryPaths = entries.map((e) => rootReq.resolve(e));
  for (const e of entryPaths) await walk(e);
  return { order, deps, idOf, entryPaths };
}

/** The adapter body — JS source, MIRRORS ask-nlp.mjs's lemma/posTags. `nlp`/`its`
 *  are in scope from the IIFE. Self-registers on window|self|globalThis. */
const ADAPTER_JS = `
var G=(typeof window!=='undefined')?window:(typeof self!=='undefined')?self:globalThis;
G.__seonixNlp={
  lemma:function(word){
    var w=String(word||'');
    try{var out=nlp.readDoc(w).tokens().out(its.lemma);return String(out[0]||w).toLowerCase();}
    catch(e){return w.toLowerCase();}
  },
  posTags:function(words){
    try{
      var toks=nlp.readDoc(words.join(' ')).tokens();
      var texts=toks.out(),tags=toks.out(its.pos),out=[],k=0;
      for(var i=0;i<words.length;i++){
        var w=words[i];
        if(k>=texts.length){out.push(null);continue;}
        out.push(tags[k]);
        var acc=texts[k];k++;
        while(acc.length<w.length&&k<texts.length){acc+=texts[k];k++;}
      }
      return out;
    }catch(e){return words.map(function(){return null;});}
  }
};`;

/** Build the self-contained browser IIFE (a plain JS string, no <script> wrapper).
 *  Loading it in a browser sets window.__seonixNlp. Pure w.r.t. installed deps. */
export async function winkBrowserBundle() {
  const { order, deps, idOf, entryPaths } = await packGraph(
    ["wink-nlp", "wink-eng-lite-web-model"],
    import.meta.url,
  );
  const D = {}; // id -> {request -> id}
  for (const [p, map] of deps) {
    const from = idOf.get(p);
    D[from] = {};
    for (const [req, target] of Object.entries(map)) D[from][req] = idOf.get(target);
  }
  const parts = [];
  parts.push("(function(){\nvar M={},C={};");
  parts.push("function R(id){if(C[id])return C[id].exports;var m=C[id]={exports:{}};M[id](m,m.exports,function(r){return R(D[id][r]);});return m.exports;}");
  parts.push("var D=" + JSON.stringify(D) + ";");
  for (const p of order) {
    const id = idOf.get(p);
    const src = await readFile(p, "utf8");
    parts.push(p.endsWith(".json")
      ? "M[" + id + "]=function(module,exports,require){module.exports=" + src + "\n};"
      : "M[" + id + "]=function(module,exports,require){\n" + src + "\n};");
  }
  parts.push("var winkNLP=R(" + idOf.get(entryPaths[0]) + ");");
  parts.push("var model=R(" + idOf.get(entryPaths[1]) + ");");
  parts.push("var nlp=winkNLP(model),its=nlp.its;");
  parts.push(ADAPTER_JS);
  parts.push("})();");
  return parts.join("\n");
}
