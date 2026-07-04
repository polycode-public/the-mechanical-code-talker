// Hand-written TS fixture for the bake-off (NOT wh code). Public-domain, synthetic.
import { readFile } from "node:fs/promises";
import { helperUtil } from "./helpers";

export const MAX_RETRIES = 3;

export interface Repo {
  id: string;
  name: string;
}

/** Fetch a repo by id, with a bounded retry. */
export async function loadRepo(id: string, retries: number = MAX_RETRIES): Promise<Repo> {
  const raw = await readFile(id, "utf8");
  const parsed = helperUtil(raw);
  if (!parsed) throw new Error("bad repo");
  return { id, name: parsed };
}

export class RepoStore {
  private items: Map<string, Repo> = new Map();

  add(repo: Repo): void {
    this.items.set(repo.id, repo);
  }

  get(id: string): Repo | undefined {
    return this.items.get(id);
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}
