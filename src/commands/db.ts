import { loadConfig } from "../config.js";
import { checkDatabase, type DbCheckResult } from "../db/check.js";
import { openDb } from "../db/index.js";
import { runMigrations } from "../db/migrations.js";
import { defaultConfigPath } from "../paths.js";

export interface DbCommandOptions {
  configPath?: string;
  json?: boolean;
}

function resolveConfigPath(options: DbCommandOptions): string {
  return options.configPath ?? defaultConfigPath();
}

export interface MigrateReport {
  database: string;
  applied: string[];
  alreadyApplied: string[];
}

export function runDbMigrate(options: DbCommandOptions = {}): MigrateReport {
  const config = loadConfig(resolveConfigPath(options));
  const db = openDb(config.paths.sqlite, { migrate: false });
  try {
    const result = runMigrations(db);
    const report: MigrateReport = {
      database: config.paths.sqlite,
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else if (report.applied.length > 0) {
      process.stdout.write(
        `Applied ${report.applied.length} migration(s): ${report.applied.join(", ")}\n`,
      );
    } else {
      process.stdout.write("Database is up to date.\n");
    }
    return report;
  } finally {
    db.close();
  }
}

/** Returns the process exit code (0 = healthy, 1 = problems found). */
export function runDbCheck(options: DbCommandOptions = {}): number {
  const config = loadConfig(resolveConfigPath(options));
  const db = openDb(config.paths.sqlite, { migrate: false });
  let result: DbCheckResult;
  try {
    result = checkDatabase(db);
  } finally {
    db.close();
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ database: config.paths.sqlite, ...result }, null, 2)}\n`,
    );
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    process.stdout.write(`Database OK: ${config.paths.sqlite}\n`);
    return 0;
  }

  const lines = [`Database problems found: ${config.paths.sqlite}`];
  if (result.integrity.length > 0) {
    lines.push(`  integrity: ${result.integrity.join("; ")}`);
  }
  if (result.foreignKeyViolations.length > 0) {
    lines.push(
      `  foreign-key violations: ${result.foreignKeyViolations
        .map((v) => `${v.table}#${v.rowid ?? "?"} -> ${v.referenced}`)
        .join("; ")}`,
    );
  }
  if (result.pendingMigrations.length > 0) {
    lines.push(
      `  pending migrations: ${result.pendingMigrations.join(", ")} (run \`whatsapp-conduit db migrate\`)`,
    );
  }
  process.stderr.write(`${lines.join("\n")}\n`);
  return 1;
}
