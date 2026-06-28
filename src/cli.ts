#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  runChatsAllow,
  runChatsBlock,
  runChatsList,
  runChatsShow,
} from "./commands/chats.js";
import { runDbCheck, runDbMigrate } from "./commands/db.js";
import { runDoctor } from "./commands/doctor.js";
import { runExport } from "./commands/export.js";
import { runInit } from "./commands/init.js";
import { runLink } from "./commands/link.js";
import { runMessagesList } from "./commands/messages.js";
import { runOffsetsCommit, runOffsetsShow } from "./commands/offsets.js";
import { runRun } from "./commands/run.js";
import {
  runServiceControl,
  runServiceInstall,
  type ServiceAction,
} from "./commands/service.js";
import { runStatus } from "./commands/status.js";
import { getVersion } from "./version.js";

function parsePositiveInt(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer (got "${value}").`);
  }
  return n;
}

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

  program
    .command("link")
    .description("link a WhatsApp account as a secondary device via QR code")
    .option(
      "--timeout <seconds>",
      "seconds to wait for pairing before giving up",
      "120",
    )
    .action(async (opts: { timeout?: string }) => {
      const globals = program.opts<GlobalOptions>();
      await runLink({
        configPath: globals.config,
        timeoutSec: opts.timeout ? Number(opts.timeout) : undefined,
      });
    });

  program
    .command("run")
    .description("run the foreground observe-only sync daemon")
    .action(async () => {
      const globals = program.opts<GlobalOptions>();
      await runRun({ configPath: globals.config });
    });

  program
    .command("status")
    .description("show auth, account, and sync state")
    .option("--json", "emit machine-readable JSON")
    .action((opts: { json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      runStatus({ configPath: globals.config, json: opts.json });
    });

  const chats = program
    .command("chats")
    .description("inspect and manage discovered chats");

  chats
    .command("list")
    .description("list discovered chats")
    .option("--json", "emit machine-readable JSON")
    .option("--allowed-only", "only chats marked allowed")
    .option("--limit <n>", "maximum chats to show")
    .action(
      (opts: { json?: boolean; allowedOnly?: boolean; limit?: string }) => {
        const globals = program.opts<GlobalOptions>();
        runChatsList({
          configPath: globals.config,
          json: opts.json,
          allowedOnly: opts.allowedOnly,
          limit: opts.limit
            ? parsePositiveInt("--limit", opts.limit)
            : undefined,
        });
      },
    );

  chats
    .command("show <jid>")
    .description("show one chat's metadata")
    .option("--json", "emit machine-readable JSON")
    .action((jid: string, opts: { json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      process.exitCode = runChatsShow(jid, {
        configPath: globals.config,
        json: opts.json,
      });
    });

  chats
    .command("allow <jid>")
    .description("mark a chat as allowed for exports")
    .action((jid: string) => {
      const globals = program.opts<GlobalOptions>();
      process.exitCode = runChatsAllow(jid, { configPath: globals.config });
    });

  chats
    .command("block <jid>")
    .description("mark a chat as blocked (excluded from sync and exports)")
    .action((jid: string) => {
      const globals = program.opts<GlobalOptions>();
      process.exitCode = runChatsBlock(jid, { configPath: globals.config });
    });

  const messages = program
    .command("messages")
    .description("inspect stored messages");

  messages
    .command("list")
    .description("list recent stored messages")
    .option("--chat <jid>", "restrict to one chat")
    .option("--since <when>", "only messages at/after a duration or ISO time")
    .option("--limit <n>", "maximum messages to show", "50")
    .option("--json", "emit machine-readable JSON")
    .action(
      (opts: {
        chat?: string;
        since?: string;
        limit?: string;
        json?: boolean;
      }) => {
        const globals = program.opts<GlobalOptions>();
        runMessagesList({
          configPath: globals.config,
          chat: opts.chat,
          since: opts.since,
          limit: opts.limit
            ? parsePositiveInt("--limit", opts.limit)
            : undefined,
          json: opts.json,
        });
      },
    );

  program
    .command("export")
    .description("emit messages as JSONL for downstream consumers")
    .option("--since <when>", "only messages at/after a duration or ISO time")
    .option(
      "--since-last <consumer>",
      "resume after a consumer's stored offset",
    )
    .option("--allowed-only", "only messages from allowed chats")
    .option("--redact-phone-numbers", "redact phone numbers in JIDs")
    .option("--include-raw-json", "include the raw Baileys payload")
    .option("--limit <n>", "maximum messages to export")
    .option("--commit", "advance the --since-last offset after exporting")
    .action(
      (opts: {
        since?: string;
        sinceLast?: string;
        allowedOnly?: boolean;
        redactPhoneNumbers?: boolean;
        includeRawJson?: boolean;
        limit?: string;
        commit?: boolean;
      }) => {
        const globals = program.opts<GlobalOptions>();
        runExport({
          configPath: globals.config,
          since: opts.since,
          sinceLast: opts.sinceLast,
          allowedOnly: opts.allowedOnly,
          redactPhoneNumbers: opts.redactPhoneNumbers,
          includeRawJson: opts.includeRawJson,
          limit: opts.limit
            ? parsePositiveInt("--limit", opts.limit)
            : undefined,
          commit: opts.commit,
        });
      },
    );

  const offsets = program
    .command("offsets")
    .description("manage downstream consumer offsets");

  offsets
    .command("commit <consumer>")
    .description("advance a consumer offset to a cursor from a prior export")
    .requiredOption(
      "--through <cursor>",
      "cursor (from export output) to commit",
    )
    .option("--timestamp <ts>", "optional epoch-seconds timestamp to record")
    .action(
      (consumer: string, opts: { through: string; timestamp?: string }) => {
        const globals = program.opts<GlobalOptions>();
        runOffsetsCommit(consumer, {
          configPath: globals.config,
          through: parsePositiveInt("--through", opts.through),
          timestamp: opts.timestamp
            ? parsePositiveInt("--timestamp", opts.timestamp)
            : undefined,
        });
      },
    );

  offsets
    .command("show <consumer>")
    .description("show a consumer's stored offset")
    .option("--json", "emit machine-readable JSON")
    .action((consumer: string, opts: { json?: boolean }) => {
      const globals = program.opts<GlobalOptions>();
      process.exitCode = runOffsetsShow(consumer, {
        configPath: globals.config,
        json: opts.json,
      });
    });

  const service = program
    .command("service")
    .description("manage the systemd user service");

  service
    .command("install")
    .description("write and load a systemd user unit for `run`")
    .option("--now", "enable and start the service immediately")
    .option("--working-dir <path>", "WorkingDirectory for the unit")
    .action((opts: { now?: boolean; workingDir?: string }) => {
      const globals = program.opts<GlobalOptions>();
      runServiceInstall({
        configPath: globals.config,
        now: opts.now,
        workingDirectory: opts.workingDir,
      });
    });

  for (const action of [
    "start",
    "stop",
    "restart",
    "status",
    "logs",
  ] as const) {
    service
      .command(action)
      .description(`${action} the systemd user service`)
      .action(() => {
        process.exitCode = runServiceControl(action as ServiceAction);
      });
  }

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
