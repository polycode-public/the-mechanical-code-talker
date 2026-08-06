// tmct_untested — source modules with no covering test module.

import { renderUntested } from "../../domain/codegraph.mjs";

export function tmct_untested(_args, { graph, codeDomainActive = null }) {
  return renderUntested(graph, { codeDomainActive });
}
