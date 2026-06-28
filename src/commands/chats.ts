import { loadConfig } from "../config.js";
import { openDb } from "../db/index.js";
import {
  getChat,
  listChats,
  setChatAllowed,
  setChatBlocked,
  type ChatRow,
} from "../db/queries.js";
import { resolveConfigPath } from "../runtime.js";

export interface ChatsListOptions {
  configPath?: string;
  json?: boolean;
  allowedOnly?: boolean;
  limit?: number;
}

interface ChatView {
  jid: string;
  name: string | null;
  pushName: string | null;
  isGroup: boolean;
  isStatus: boolean;
  isAllowed: boolean;
  isBlocked: boolean;
  lastMessageTs: number | null;
}

function toView(row: ChatRow): ChatView {
  return {
    jid: row.jid,
    name: row.name,
    pushName: row.push_name,
    isGroup: row.is_group === 1,
    isStatus: row.is_status === 1,
    isAllowed: row.is_allowed === 1,
    isBlocked: row.is_blocked === 1,
    lastMessageTs: row.last_message_ts,
  };
}

function flag(row: ChatView): string {
  if (row.isBlocked) return "blocked";
  if (row.isAllowed) return "allowed";
  return "discovered";
}

export function runChatsList(options: ChatsListOptions = {}): void {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const db = openDb(config.paths.sqlite, { migrate: false, readonly: true });
  try {
    const rows = listChats(db, {
      accountId: config.account.name,
      allowedOnly: options.allowedOnly,
      limit: options.limit,
    }).map(toView);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }
    if (rows.length === 0) {
      process.stdout.write("No chats discovered yet.\n");
      return;
    }
    for (const row of rows) {
      const label = row.name ?? row.pushName ?? "(unknown)";
      const kind = row.isGroup ? "group" : row.isStatus ? "status" : "dm";
      process.stdout.write(
        `${flag(row).padEnd(10)} ${kind.padEnd(6)} ${row.jid}  ${label}\n`,
      );
    }
  } finally {
    db.close();
  }
}

export interface ChatsShowOptions {
  configPath?: string;
  json?: boolean;
}

/** Returns the process exit code (0 found, 1 not found). */
export function runChatsShow(
  jid: string,
  options: ChatsShowOptions = {},
): number {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const db = openDb(config.paths.sqlite, { migrate: false, readonly: true });
  try {
    const row = getChat(db, config.account.name, jid);
    if (!row) {
      process.stderr.write(`Chat not found: ${jid}\n`);
      return 1;
    }
    const view = toView(row);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
      return 0;
    }
    const lines = [
      `jid:        ${view.jid}`,
      `name:       ${view.name ?? "—"}`,
      `push name:  ${view.pushName ?? "—"}`,
      `kind:       ${view.isGroup ? "group" : view.isStatus ? "status" : "dm"}`,
      `policy:     ${flag(view)}`,
      `last msg:   ${
        view.lastMessageTs
          ? new Date(view.lastMessageTs * 1000).toISOString()
          : "—"
      }`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    db.close();
  }
}

export interface ChatsPolicyOptions {
  configPath?: string;
}

/** Returns the process exit code (0 ok, 1 chat unknown). */
export function runChatsAllow(
  jid: string,
  options: ChatsPolicyOptions = {},
): number {
  return setPolicy(jid, options, true);
}

export function runChatsBlock(
  jid: string,
  options: ChatsPolicyOptions = {},
): number {
  return setPolicy(jid, options, false);
}

function setPolicy(
  jid: string,
  options: ChatsPolicyOptions,
  allow: boolean,
): number {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const db = openDb(config.paths.sqlite, { migrate: false });
  try {
    if (!getChat(db, config.account.name, jid)) {
      process.stderr.write(
        `Chat not found: ${jid} (it must be discovered before it can be ${
          allow ? "allowed" : "blocked"
        }).\n`,
      );
      return 1;
    }
    if (allow) {
      setChatAllowed(db, config.account.name, jid, true);
      process.stdout.write(`Allowed ${jid}.\n`);
    } else {
      setChatBlocked(db, config.account.name, jid, true);
      process.stdout.write(`Blocked ${jid}.\n`);
    }
    return 0;
  } finally {
    db.close();
  }
}
