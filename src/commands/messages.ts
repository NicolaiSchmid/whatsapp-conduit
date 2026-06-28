import { loadConfig } from "../config.js";
import { openDb } from "../db/index.js";
import { listMessages, type MessageRow } from "../db/queries.js";
import { resolveConfigPath } from "../runtime.js";
import { parseSinceSec } from "../util/time.js";

export interface MessagesListOptions {
  configPath?: string;
  chat?: string;
  since?: string;
  limit?: number;
  json?: boolean;
}

interface MessageView {
  chatJid: string;
  messageId: string;
  senderJid: string | null;
  fromMe: boolean;
  timestamp: number | null;
  messageType: string | null;
  text: string | null;
  hasMedia: boolean;
  deleted: boolean;
}

function toView(row: MessageRow): MessageView {
  return {
    chatJid: row.chat_jid,
    messageId: row.message_id,
    senderJid: row.sender_jid,
    fromMe: row.from_me === 1,
    timestamp: row.timestamp,
    messageType: row.message_type,
    text: row.text,
    hasMedia: row.has_media === 1,
    deleted: row.deleted_at !== null,
  };
}

export function runMessagesList(options: MessagesListOptions = {}): void {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const sinceTs =
    options.since !== undefined ? parseSinceSec(options.since) : null;

  const db = openDb(config.paths.sqlite, { migrate: false, readonly: true });
  try {
    const rows = listMessages(db, {
      accountId: config.account.name,
      chatJid: options.chat,
      sinceTs,
      limit: options.limit ?? 50,
    }).map(toView);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }
    if (rows.length === 0) {
      process.stdout.write("No messages.\n");
      return;
    }
    for (const row of rows) {
      const when = row.timestamp
        ? new Date(row.timestamp * 1000).toISOString()
        : "—";
      const dir = row.fromMe ? "→" : "←";
      const body = row.deleted
        ? "(deleted)"
        : (row.text ??
          `(${row.messageType ?? "no text"}${row.hasMedia ? ", media" : ""})`);
      process.stdout.write(`${when}  ${dir} ${row.chatJid}  ${body}\n`);
    }
  } finally {
    db.close();
  }
}
