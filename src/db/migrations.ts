import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";
import { nowSec } from "../util/time.js";

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

const MIGRATION_RE = /^\d{4}_.+\.sql$/;

/**
 * Resolve the bundled migrations directory. The module sits at `src/db/` in dev
 * and `dist/db/` when built; `migrations/` lives at the package root in both
 * layouts, two directories up.
 */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL("../../migrations", import.meta.url));
}

export function loadMigrations(
  dir: string = defaultMigrationsDir(),
): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_RE.test(f))
    .sort();
  return files.map((name) => ({
    name,
    sql: readFileSync(`${dir}/${name}`, "utf8"),
  }));
}

function ensureMigrationsTable(db: Database): void {
  db.exec(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at integer not null
     );`,
  );
}

/** Names of migrations already recorded as applied, in lexical order. */
export function appliedMigrations(db: Database): string[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare<
      [],
      { name: string }
    >("select name from schema_migrations order by name")
    .all();
  return rows.map((r) => r.name);
}

/**
 * Apply any pending migrations in order. Each migration runs inside a
 * transaction together with its bookkeeping insert, so a failure leaves the
 * database at the last fully-applied migration.
 */
export function runMigrations(
  db: Database,
  dir: string = defaultMigrationsDir(),
): MigrationResult {
  ensureMigrationsTable(db);
  const done = new Set(appliedMigrations(db));
  const migrations = loadMigrations(dir);

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  const record = db.prepare<[string, number]>(
    "insert into schema_migrations (name, applied_at) values (?, ?)",
  );

  for (const migration of migrations) {
    if (done.has(migration.name)) {
      alreadyApplied.push(migration.name);
      continue;
    }
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.name, nowSec());
    });
    apply();
    applied.push(migration.name);
  }

  return { applied, alreadyApplied };
}

/** Migrations present on disk but not yet applied to this database. */
export function pendingMigrations(
  db: Database,
  dir: string = defaultMigrationsDir(),
): string[] {
  const done = new Set(appliedMigrations(db));
  return loadMigrations(dir)
    .map((m) => m.name)
    .filter((name) => !done.has(name));
}
