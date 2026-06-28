#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runDbCheck, runDbMigrate } from "./commands/db.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { getVersion } from "./version.js";

export interface GlobalOptions {
  config?: string;
  logLevel?: string;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("whatsapp-conduit")
    .description(
      "Passive, observe-only WhatsApp linked-device bridge: Baileys in, SQLite out.",
    )
    .version(getVersion(), "-v, --version", "print the version and exit")
    .option("-c, --config <path>", "path to the YAML config file")
    .option(
      "--log-level <level>",
      "log level (fatal, error, warn, info, debug, trace)",
    );

  program
    .command("doctor")
    .description("print version, runtime, and config environment")
    .option("--json", "emit machine-readable JSON")
    .action((opts: { json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      runDoctor({ configPath: globals.config, json: opts.json });
    });

  program
    .command("init")
    .description("create config, data directories, and the SQLite database")
    .option("--data-dir <path>", "override the data directory")
    .option("--force", "overwrite an existing config file with defaults")
    .option("--json", "emit machine-readable JSON")
    .action((opts: { dataDir?: string; force?: boolean; json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      runInit({
        configPath: globals.config,
        dataDir: opts.dataDir,
        force: opts.force,
        json: opts.json,
      });
    });

  const db = program.command("db").description("database maintenance commands");

  db.command("migrate")
    .description("apply pending schema migrations")
    .option("--json", "emit machine-readable JSON")
    .action((opts: { json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      runDbMigrate({ configPath: globals.config, json: opts.json });
    });

  db.command("check")
    .description("validate schema integrity and migration state")
    .option("--json", "emit machine-readable JSON")
    .action((opts: { json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      const code = runDbCheck({ configPath: globals.config, json: opts.json });
      process.exitCode = code;
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

/**
 * True when this module is the program entrypoint (not merely imported).
 *
 * Compares fully-resolved real paths so invocation through an npm bin symlink
 * (e.g. `node_modules/.bin/whatsapp-conduit`) still runs `main()`: Node resolves
 * `import.meta.url` to the real `dist/cli.js`, while `process.argv[1]` stays the
 * symlink path, so a raw string compare would wrongly skip execution.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  });
}
