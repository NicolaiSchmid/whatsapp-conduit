import type { Database } from "better-sqlite3";
import { pendingMigrations } from "./migrations.js";

export interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  referenced: string;
}

export interface DbCheckResult {
  ok: boolean;
  integrity: string[];
  foreignKeyViolations: ForeignKeyViolation[];
  pendingMigrations: string[];
}

interface IntegrityRow {
  integrity_check: string;
}

interface ForeignKeyRow {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

/**
 * Validate database health: PRAGMA integrity check, foreign-key check, and
 * whether any migrations are still pending. `ok` is true only when integrity is
 * clean, there are no FK violations, and no migrations are outstanding.
 */
export function checkDatabase(db: Database): DbCheckResult {
  const integrityRows = db
    .prepare<[], IntegrityRow>("PRAGMA integrity_check")
    .all();
  const integrity = integrityRows
    .map((r) => r.integrity_check)
    .filter((v) => v !== "ok");

  const fkRows = db
    .prepare<[], ForeignKeyRow>("PRAGMA foreign_key_check")
    .all();
  const foreignKeyViolations: ForeignKeyViolation[] = fkRows.map((r) => ({
    table: r.table,
    rowid: r.rowid,
    referenced: r.parent,
  }));

  const pending = pendingMigrations(db);

  return {
    ok:
      integrity.length === 0 &&
      foreignKeyViolations.length === 0 &&
      pending.length === 0,
    integrity,
    foreignKeyViolations,
    pendingMigrations: pending,
  };
}
