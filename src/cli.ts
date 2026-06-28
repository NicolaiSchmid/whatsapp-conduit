#!/usr/bin/env node
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
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

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  });
}
