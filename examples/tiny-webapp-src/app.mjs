// Entry point: loads task rows into the store and renders them. previewFirstRow
// parses the first line directly, kept separate from loadRows so a preview never
// depends on the whole store being built first.
import { loadRows, findById, countByStatus } from "./lib/store.mjs";
import { renderList } from "./lib/render.mjs";
import { parseRow } from "./lib/parse.mjs";

export function previewFirstRow(text) {
  const [firstLine] = text.split("\n");
  return firstLine ? parseRow(firstLine) : null;
}

export function run(text) {
  const rows = loadRows(text);
  const first = rows[0] ? findById(rows, rows[0].id) : null;
  return {
    preview: previewFirstRow(text),
    rendered: renderList(rows),
    openCount: countByStatus(rows, "open"),
    firstRow: first,
  };
}
