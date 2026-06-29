import { loadConfig } from "../config.js";
import { openDb } from "../db/index.js";
import {
  getConsumerOffset,
  selectExportMessages,
  setConsumerOffset,
  type ExportRow,
} from "../db/queries.js";
import { loadRedactionSalt, redactJid } from "../privacy/redact.js";
import { resolveConfigPath } from "../runtime.js";
import { parseSinceSec } from "../util/time.js";

export interface ExportOptions {
  configPath?: string;
  since?: string;
  sinceLast?: string;
  /**
   * Export every chat, including ones not marked allowed. Defaults false:
   * exports are allowed-only by default so newly discovered chats are not
   * leaked to downstream consumers.
   */
  all?: boolean;
  redactPhoneNumbers?: boolean;
  includeRawJson?: boolean;
  limit?: number;
  /** Advance the consumer offset after a successful --since-last export. */
  commit?: boolean;
}

export interface ExportRecord {
  account_id: string;
  chat_jid: string;
  message_id: string;
  sender_jid: string | null;
  from_me: boolean;
  timestamp: number | null;
  received_at: number;
  message_type: string | null;
  text: string | null;
  has_media: boolean;
  quoted_message_id: string | null;
  quoted_sender_jid: string | null;
  edited_message_id: string | null;
  deleted_at: number | null;
  chat_name: string | null;
  is_group: boolean;
  is_status: boolean;
  cursor: number;
  raw_json?: string;
}

export interface ExportConfig {
  redactPhoneNumbers: boolean;
  includeRawJson: boolean;
  /** Per-install secret salt for redaction tokens (HMAC key). */
  salt: string;
}

export function toExportRecord(
  row: ExportRow,
  cfg: ExportConfig,
): ExportRecord {
  const jid = (j: string | null) =>
    cfg.redactPhoneNumbers ? redactJid(j, cfg.salt) : j;
  const record: ExportRecord = {
    account_id: row.account_id,
    chat_jid: jid(row.chat_jid) ?? row.chat_jid,
    message_id: row.message_id,
    sender_jid: jid(row.sender_jid),
    from_me: row.from_me === 1,
    timestamp: row.timestamp,
    received_at: row.received_at,
    message_type: row.message_type,
    text: row.text,
    has_media: row.has_media === 1,
    quoted_message_id: row.quoted_message_id,
    quoted_sender_jid: jid(row.quoted_sender_jid),
    edited_message_id: row.edited_message_id,
    deleted_at: row.deleted_at,
    chat_name: row.chat_name,
    is_group: row.chat_is_group === 1,
    is_status: row.chat_is_status === 1,
    cursor: row.export_rowid,
  };
  if (cfg.includeRawJson && row.raw_json !== null) {
    record.raw_json = row.raw_json;
  }
  return record;
}

export interface ExportResult {
  count: number;
  lastCursor: number | null;
  committed: boolean;
  consumer?: string;
}

/**
 * Emit allowed/selected messages as deterministic JSONL on stdout.
 *
 * - Allowed-only by default (pass `all` to include non-allowed chats); blocked
 *   chats are never exported.
 * - For `--since-last`, resumes after the consumer's stored cursor; the offset
 *   is advanced only with `--commit` (two-phase by default), and only after
 *   stdout accepted every line, so a consumer that exits early (EPIPE) can't
 *   skip messages on the next run.
 */
export function runExport(options: ExportOptions = {}): ExportResult {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const sinceTs =
    options.since !== undefined ? parseSinceSec(options.since) : null;

  const redactPhoneNumbers =
    options.redactPhoneNumbers ?? config.exports.redactPhoneNumbers;
  const includeRawJson =
    options.includeRawJson ?? config.exports.includeRawJson;
  // The raw payload carries un-redacted JIDs (key.remoteJid, participant), so
  // redaction + raw together would silently leak the numbers. Refuse the combo.
  if (redactPhoneNumbers && includeRawJson) {
    throw new Error(
      "--redact-phone-numbers cannot be combined with --include-raw-json: " +
        "the raw payload contains un-redacted phone JIDs.",
    );
  }

  // Allowed-only is the default privacy posture; --all opts out.
  const allowedOnly = !options.all;

  const db = openDb(config.paths.sqlite, {
    migrate: false,
    readonly: !options.commit,
  });

  let stdoutFailed = false;
  const onStdoutError = (): void => {
    stdoutFailed = true;
  };
  process.stdout.on("error", onStdoutError);

  try {
    let afterRowid: number | null = null;
    if (options.sinceLast) {
      afterRowid =
        getConsumerOffset(db, options.sinceLast)?.last_seen_event_id ?? null;
    }

    const rows = selectExportMessages(db, {
      accountId: config.account.name,
      sinceTs,
      afterRowid,
      allowedOnly,
      allowedChats: config.filters.allowedChats,
      limit: options.limit,
    });

    const recordCfg: ExportConfig = {
      redactPhoneNumbers,
      includeRawJson,
      salt: redactPhoneNumbers ? loadRedactionSalt(config.paths.dataDir) : "",
    };

    let lastCursor: number | null = null;
    let lastTs: number | null = null;
    for (const row of rows) {
      const ok = process.stdout.write(
        `${JSON.stringify(toExportRecord(row, recordCfg))}\n`,
      );
      if (!ok || stdoutFailed) {
        // Backpressure/EPIPE: stop and do not advance the offset.
        stdoutFailed = stdoutFailed || !ok;
      }
      lastCursor = row.export_rowid;
      lastTs = row.timestamp;
    }

    let committed = false;
    if (
      options.commit &&
      options.sinceLast &&
      lastCursor !== null &&
      !stdoutFailed
    ) {
      setConsumerOffset(db, options.sinceLast, {
        lastSeenEventId: lastCursor,
        lastSeenTimestamp: lastTs,
      });
      committed = true;
    }

    if (options.sinceLast && !committed && lastCursor !== null) {
      const configFlag = options.configPath
        ? `--config ${options.configPath} `
        : "";
      process.stderr.write(
        `Exported ${rows.length} message(s). To advance the offset, run:\n` +
          `  whatsapp-conduit ${configFlag}offsets commit ${options.sinceLast} --through ${lastCursor}\n`,
      );
    }

    const result: ExportResult = {
      count: rows.length,
      lastCursor,
      committed,
    };
    if (options.sinceLast) result.consumer = options.sinceLast;
    return result;
  } finally {
    process.stdout.off("error", onStdoutError);
    db.close();
  }
}
