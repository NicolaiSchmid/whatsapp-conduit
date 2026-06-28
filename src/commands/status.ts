import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { authStateExists } from "../baileys/auth.js";
import { openDb } from "../db/index.js";
import {
  countAllowedChats,
  countChats,
  countMessages,
  latestMessageTimestamp,
  listAccounts,
} from "../db/queries.js";
import { resolveConfigPath } from "../runtime.js";

export interface StatusAccount {
  id: string;
  selfJid: string | null;
  phoneNumber: string | null;
}

export interface StatusReport {
  configPath: string;
  database: string;
  databaseExists: boolean;
  authDir: string;
  authLinked: boolean;
  observeOnly: boolean;
  sendEnabled: boolean;
  accounts: StatusAccount[];
  chats: number;
  allowedChats: number;
  messages: number;
  latestMessageTs: number | null;
}

export interface StatusOptions {
  configPath?: string;
  json?: boolean;
}

export function buildStatusReport(configPath: string): StatusReport {
  const config = loadConfig(configPath);
  const databaseExists = existsSync(config.paths.sqlite);
  const authLinked = authStateExists(config.paths.authDir);

  const base: StatusReport = {
    configPath,
    database: config.paths.sqlite,
    databaseExists,
    authDir: config.paths.authDir,
    authLinked,
    observeOnly: config.privacy.observeOnly,
    sendEnabled: config.privacy.sendEnabled,
    accounts: [],
    chats: 0,
    allowedChats: 0,
    messages: 0,
    latestMessageTs: null,
  };

  if (!databaseExists) return base;

  const db = openDb(config.paths.sqlite, { migrate: false, readonly: true });
  try {
    return {
      ...base,
      accounts: listAccounts(db).map((a) => ({
        id: a.id,
        selfJid: a.self_jid,
        phoneNumber: a.phone_number,
      })),
      chats: countChats(db),
      allowedChats: countAllowedChats(db),
      messages: countMessages(db),
      latestMessageTs: latestMessageTimestamp(db),
    };
  } finally {
    db.close();
  }
}

export function runStatus(options: StatusOptions = {}): void {
  const configPath = resolveConfigPath(options.configPath);
  const report = buildStatusReport(configPath);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const latest =
    report.latestMessageTs !== null
      ? new Date(report.latestMessageTs * 1000).toISOString()
      : "—";
  const accountLine =
    report.accounts.length > 0
      ? report.accounts
          .map((a) => `${a.id}${a.selfJid ? ` (${a.selfJid})` : ""}`)
          .join(", ")
      : "none (run `whatsapp-conduit link`)";

  const lines = [
    "whatsapp-conduit status",
    `  config:        ${report.configPath}`,
    `  database:      ${report.database}${report.databaseExists ? "" : " (missing)"}`,
    `  auth:          ${report.authLinked ? "linked" : "not linked"}`,
    `  posture:       observe_only=${report.observeOnly} send_enabled=${report.sendEnabled}`,
    `  accounts:      ${accountLine}`,
    `  chats:         ${report.chats} (${report.allowedChats} allowed)`,
    `  messages:      ${report.messages}`,
    `  latest msg:    ${latest}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
