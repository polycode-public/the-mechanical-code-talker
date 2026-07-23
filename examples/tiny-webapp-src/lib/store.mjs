// In-memory task store: loads rows via parseRow and holds the parsed list.
import { parseRow, isBlank } from "./parse.mjs";

export function loadRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (isBlank(line)) continue;
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  return rows;
}

export function findById(rows, id) {
  return rows.find((row) => row.id === id) || null;
}

export function countByStatus(rows, status) {
  return rows.filter((row) => row.status === status).length;
}
