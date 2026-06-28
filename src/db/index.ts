import { chmodSync, existsSync, mkdirSync } from "node:fs";
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

/** Best-effort owner-only permissions for the DB and its WAL/SHM sidecars. */
function restrictDbPermissions(path: string): void {
  if (path === ":memory:") return;
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    if (existsSync(file)) {
      try {
        chmodSync(file, 0o600);
      } catch {
        // best-effort; not all filesystems support chmod
      }
    }
  }
}

/**
 * Open (and by default migrate) the conduit SQLite database.
 *
 * For writable opens: ensures the parent dir exists, enables WAL journaling for
 * concurrent readers, and restricts the DB files to the owner (they hold private
 * message text). Read-only opens skip WAL — the pragma requires a write and
 * would fail on a read-only handle. Foreign keys are always enforced.
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
  db.pragma("foreign_keys = ON");

  if (!readonly) {
    db.pragma("journal_mode = WAL");
    restrictDbPermissions(path);
    if (migrate) {
      runMigrations(db);
      // WAL/SHM sidecars appear after the first write; tighten them too.
      restrictDbPermissions(path);
    }
  }

  return db;
}
