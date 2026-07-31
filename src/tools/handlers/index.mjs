// The tool-name → handler registry dispatchTool maps over. One module per tool, so a
// tool's behaviour has exactly one home and this file only wires names to it.
//
// A handler takes (args, ctx) and returns the caller-facing string, or kit.mjs's
// toolResult({ content, data }) when it already holds the structured form of what that
// string says. ctx carries the already-loaded { graph, svc, config, repoRoot }. A handler
// marked `ownsGraphLoad` gets { config, source, tel } instead and loads what it needs.

import { tmct_context } from "./tmct-context.mjs";
import { tmct_context_more } from "./tmct-context-more.mjs";
import { tmct_describe } from "./tmct-describe.mjs";
import { tmct_snippet } from "./tmct-snippet.mjs";
import { tmct_signature } from "./tmct-signature.mjs";
import { tmct_impact } from "./tmct-impact.mjs";
import { tmct_search } from "./tmct-search.mjs";
import { tmct_members } from "./tmct-members.mjs";
import { tmct_subclasses } from "./tmct-subclasses.mjs";
import { tmct_related } from "./tmct-related.mjs";
import { tmct_sprite } from "./tmct-sprite.mjs";
import { tmct_architecture } from "./tmct-architecture.mjs";
import { tmct_exports } from "./tmct-exports.mjs";
import { tmct_untested } from "./tmct-untested.mjs";
import { tmct_ask } from "./tmct-ask.mjs";
import { tmct_tests_for } from "./tmct-tests-for.mjs";
import { tmct_history } from "./tmct-history.mjs";
import { tmct_file_history } from "./tmct-file-history.mjs";
import { tmct_method_history } from "./tmct-method-history.mjs";
import { tmct_class_history } from "./tmct-class-history.mjs";
import { tmct_callers } from "./tmct-callers.mjs";
import { tmct_callees } from "./tmct-callees.mjs";
import { tmct_calls } from "./tmct-calls.mjs";
import { tmct_cochanges } from "./tmct-cochanges.mjs";
import { tmct_export } from "./tmct-export.mjs";
import { tmct_ingest } from "./tmct-ingest.mjs";

export const HANDLERS = Object.freeze({
  tmct_context,
  tmct_context_more,
  tmct_describe,
  tmct_snippet,
  tmct_signature,
  tmct_impact,
  tmct_search,
  tmct_members,
  tmct_subclasses,
  tmct_related,
  tmct_sprite,
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
  tmct_cochanges,
  tmct_export,
  tmct_ingest,
});
