// Turns task rows into plain-text lines for terminal display.
import { formatStatus, pad } from "../util/format.mjs";

export function renderRow(row) {
  return `${pad(row.id, 4)} ${row.title} [${formatStatus(row.status)}]`;
}

export function renderList(rows) {
  return rows.map(renderRow).join("\n");
}
