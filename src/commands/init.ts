import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  defaultConfigYaml,
  loadConfig,
  resolveConfig,
  type Config,
  type ResolveOptions,
} from "../config.js";
import { openDb } from "../db/index.js";
import { runMigrations } from "../db/migrations.js";
import { defaultConfigPath } from "../paths.js";

export interface InitOptions {
  configPath?: string;
  dataDir?: string;
  force?: boolean;
  json?: boolean;
}

export interface InitReport {
  configPath: string;
  configCreated: boolean;
  dataDir: string;
  createdDirs: string[];
  sqlite: string;
  migrationsApplied: string[];
}

function ensureDir(path: string, created: string[]): void {
  if (!existsSync(path)) {
    // Owner-only: these hold private auth state, media, and the database.
    mkdirSync(path, { recursive: true, mode: 0o700 });
    created.push(path);
  }
}

/**
 * Initialize config + data layout: write a default config (unless present),
 * create the data/auth/media directories, and create + migrate the database.
 * Idempotent: re-running only fills in whatever is missing.
 */
export function runInit(options: InitOptions = {}): InitReport {
  const configPath = options.configPath ?? defaultConfigPath();
  const resolveOptions: ResolveOptions = options.dataDir
    ? { dataDir: options.dataDir }
    : {};
  const createdDirs: string[] = [];
  const willWriteConfig = !existsSync(configPath) || Boolean(options.force);

  // A --data-dir override must not silently shadow an existing config: it would
  // migrate a different tree than the config (and later commands) point at.
  if (!willWriteConfig && options.dataDir) {
    const existing = loadConfig(configPath);
    const requested = resolveConfig({}, resolveOptions).paths.dataDir;
    if (existing.paths.dataDir !== requested) {
      throw new Error(
        `--data-dir (${requested}) conflicts with the existing config at ${configPath} ` +
          `(data_dir = ${existing.paths.dataDir}). Edit the config or pass --force to rewrite it.`,
      );
    }
  }

  let configCreated = false;
  if (willWriteConfig) {
    mkdirSync(dirname(configPath), { recursive: true });
    // Resolve defaults the same way the loader will, so the written file and
    // the in-memory config agree on paths.
    const dataDir = resolveConfig({}, resolveOptions).paths.dataDir;
    writeFileSync(configPath, defaultConfigYaml(dataDir), { mode: 0o600 });
    configCreated = true;
  }

  // Once a config exists, it is the single source of truth for paths; only a
  // freshly written config honors the --data-dir override.
  const config: Config = configCreated
    ? loadConfig(configPath, resolveOptions)
    : loadConfig(configPath);

  ensureDir(config.paths.dataDir, createdDirs);
  ensureDir(config.paths.authDir, createdDirs);
  ensureDir(config.paths.mediaDir, createdDirs);

  const db = openDb(config.paths.sqlite, { migrate: false });
  try {
    const result = runMigrations(db);
    const report: InitReport = {
      configPath,
      configCreated,
      dataDir: config.paths.dataDir,
      createdDirs,
      sqlite: config.paths.sqlite,
      migrationsApplied: result.applied,
    };
    emit(report, options.json ?? false);
    return report;
  } finally {
    db.close();
  }
}

function emit(report: InitReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const lines = [
    "Initialized whatsapp-conduit.",
    `  config:     ${report.configPath}${
      report.configCreated ? " (created)" : " (existing)"
    }`,
    `  data dir:   ${report.dataDir}`,
    `  database:   ${report.sqlite}`,
    `  migrations: ${
      report.migrationsApplied.length > 0
        ? report.migrationsApplied.join(", ")
        : "up to date"
    }`,
  ];
  if (report.createdDirs.length > 0) {
    lines.push(`  created:    ${report.createdDirs.join(", ")}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
