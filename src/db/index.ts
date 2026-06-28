import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type { Database } from "better-sqlite3";

export interface OpenDbOptions {
  /** Run pending migrations on open. Defaults to true. */
  migrate?: boolean;
  /** Open read-only (used by inspection commands). Defaults to false. */
  readonly?: boolean;
}

/**
 * Open (and by default migrate) the conduit SQLite database.
 *
 * Enables WAL journaling for concurrent readers and enforces foreign keys so
 * the documented relational invariants are checked at write time.
 */
export function openDb(
  path: string,
  options: OpenDbOptions = {},
): Database.Database {
  const { migrate = true, readonly = false } = options;

  if (!readonly && path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, { readonly });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  if (migrate && !readonly) {
    runMigrations(db);
  }

  return db;
}
