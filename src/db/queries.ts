import type { Database } from "better-sqlite3";
import { nowSec } from "../util/time.js";

/**
 * Persistence helpers. Every write is idempotent on its documented primary key
 * via `ON CONFLICT DO UPDATE`, so replaying the same Baileys event is safe.
 * `COALESCE(excluded.x, table.x)` is used where ingestion may carry a null we
 * must not use to clobber a previously-known value.
 */

export interface AccountInput {
  id: string;
  label?: string | null;
  selfJid?: string | null;
  phoneNumber?: string | null;
}

export interface AccountRow {
  id: string;
  label: string | null;
  self_jid: string | null;
  phone_number: string | null;
  created_at: number;
  updated_at: number;
}

export function upsertAccount(db: Database, input: AccountInput): void {
  const now = nowSec();
  db.prepare(
    `insert into accounts (id, label, self_jid, phone_number, created_at, updated_at)
     values (@id, @label, @selfJid, @phoneNumber, @now, @now)
     on conflict (id) do update set
       label = coalesce(excluded.label, accounts.label),
       self_jid = coalesce(excluded.self_jid, accounts.self_jid),
       phone_number = coalesce(excluded.phone_number, accounts.phone_number),
       updated_at = excluded.updated_at`,
  ).run({
    id: input.id,
    label: input.label ?? null,
    selfJid: input.selfJid ?? null,
    phoneNumber: input.phoneNumber ?? null,
    now,
  });
}

export function getAccount(db: Database, id: string): AccountRow | undefined {
  return db
    .prepare<[string], AccountRow>("select * from accounts where id = ?")
    .get(id);
}

export function listAccounts(db: Database): AccountRow[] {
  return db.prepare<[], AccountRow>("select * from accounts order by id").all();
}

export function countChats(db: Database, accountId?: string): number {
  if (accountId === undefined) {
    return (
      db.prepare<[], { n: number }>("select count(*) as n from chats").get()
        ?.n ?? 0
    );
  }
  return (
    db
      .prepare<
        [string],
        { n: number }
      >("select count(*) as n from chats where account_id = ?")
      .get(accountId)?.n ?? 0
  );
}

export function countAllowedChats(db: Database, accountId?: string): number {
  if (accountId === undefined) {
    return (
      db
        .prepare<
          [],
          { n: number }
        >("select count(*) as n from chats where is_allowed = 1")
        .get()?.n ?? 0
    );
  }
  return (
    db
      .prepare<
        [string],
        { n: number }
      >("select count(*) as n from chats where account_id = ? and is_allowed = 1")
      .get(accountId)?.n ?? 0
  );
}

export function latestMessageTimestamp(
  db: Database,
  accountId?: string,
): number | null {
  const row =
    accountId === undefined
      ? db
          .prepare<
            [],
            { ts: number | null }
          >("select max(timestamp) as ts from messages")
          .get()
      : db
          .prepare<
            [string],
            { ts: number | null }
          >("select max(timestamp) as ts from messages where account_id = ?")
          .get(accountId);
  return row?.ts ?? null;
}

export interface ChatInput {
  accountId: string;
  jid: string;
  name?: string | null;
  pushName?: string | null;
  isGroup?: boolean;
  isStatus?: boolean;
  lastMessageTs?: number | null;
  rawJson?: string | null;
}

export interface ChatRow {
  account_id: string;
  jid: string;
  name: string | null;
  push_name: string | null;
  is_group: number;
  is_status: number;
  is_blocked: number;
  is_allowed: number;
  discovered_at: number;
  updated_at: number;
  last_message_ts: number | null;
  raw_json: string | null;
}

/**
 * Upsert chat metadata discovered during ingestion. Deliberately does NOT touch
 * `is_allowed` / `is_blocked` — those are policy, owned by the allow/block
 * commands, not the sync path.
 */
export function upsertChat(db: Database, input: ChatInput): void {
  const now = nowSec();
  db.prepare(
    `insert into chats (
       account_id, jid, name, push_name, is_group, is_status,
       discovered_at, updated_at, last_message_ts, raw_json
     ) values (
       @accountId, @jid, @name, @pushName, @isGroup, @isStatus,
       @now, @now, @lastMessageTs, @rawJson
     )
     on conflict (account_id, jid) do update set
       name = coalesce(excluded.name, chats.name),
       push_name = coalesce(excluded.push_name, chats.push_name),
       -- Only reclassify group/status when the caller actually provided it.
       is_group = case when @isGroupSet = 1 then @isGroup else chats.is_group end,
       is_status = case when @isStatusSet = 1 then @isStatus else chats.is_status end,
       -- Null-safe max: never invent epoch-0 when neither side has a timestamp.
       last_message_ts = max(
         coalesce(excluded.last_message_ts, chats.last_message_ts),
         coalesce(chats.last_message_ts, excluded.last_message_ts)
       ),
       raw_json = coalesce(excluded.raw_json, chats.raw_json),
       updated_at = excluded.updated_at`,
  ).run({
    accountId: input.accountId,
    jid: input.jid,
    name: input.name ?? null,
    pushName: input.pushName ?? null,
    isGroup: input.isGroup ? 1 : 0,
    isGroupSet: input.isGroup === undefined ? 0 : 1,
    isStatus: input.isStatus ? 1 : 0,
    isStatusSet: input.isStatus === undefined ? 0 : 1,
    lastMessageTs: input.lastMessageTs ?? null,
    rawJson: input.rawJson ?? null,
    now,
  });
}

/** Set a chat's allow flag (policy). Clears the block flag when allowing. */
export function setChatAllowed(
  db: Database,
  accountId: string,
  jid: string,
  allowed: boolean,
): void {
  db.prepare(
    `update chats
       set is_allowed = @allowed,
           is_blocked = case when @allowed = 1 then 0 else is_blocked end,
           updated_at = @now
     where account_id = @accountId and jid = @jid`,
  ).run({ accountId, jid, allowed: allowed ? 1 : 0, now: nowSec() });
}

/** Set a chat's block flag (policy). Clears the allow flag when blocking. */
export function setChatBlocked(
  db: Database,
  accountId: string,
  jid: string,
  blocked: boolean,
): void {
  db.prepare(
    `update chats
       set is_blocked = @blocked,
           is_allowed = case when @blocked = 1 then 0 else is_allowed end,
           updated_at = @now
     where account_id = @accountId and jid = @jid`,
  ).run({ accountId, jid, blocked: blocked ? 1 : 0, now: nowSec() });
}

export function getChat(
  db: Database,
  accountId: string,
  jid: string,
): ChatRow | undefined {
  return db
    .prepare<
      [string, string],
      ChatRow
    >("select * from chats where account_id = ? and jid = ?")
    .get(accountId, jid);
}

export interface ListChatsOptions {
  accountId?: string;
  allowedOnly?: boolean;
  limit?: number;
}

/** List chats, most-recently-active first. */
export function listChats(
  db: Database,
  opts: ListChatsOptions = {},
): ChatRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.accountId) {
    where.push("account_id = @accountId");
    params.accountId = opts.accountId;
  }
  if (opts.allowedOnly) where.push("is_allowed = 1");
  if (opts.limit != null) params.limit = opts.limit;
  const sql =
    `select * from chats ${where.length ? `where ${where.join(" and ")}` : ""} ` +
    `order by coalesce(last_message_ts, 0) desc, jid asc ` +
    `${opts.limit != null ? "limit @limit" : ""}`;
  return db.prepare(sql).all(params) as ChatRow[];
}

export interface ParticipantInput {
  accountId: string;
  jid: string;
  phone?: string | null;
  displayName?: string | null;
  pushName?: string | null;
  rawJson?: string | null;
}

export function upsertParticipant(db: Database, input: ParticipantInput): void {
  const now = nowSec();
  db.prepare(
    `insert into participants (
       account_id, jid, phone, display_name, push_name,
       first_seen_at, updated_at, raw_json
     ) values (
       @accountId, @jid, @phone, @displayName, @pushName, @now, @now, @rawJson
     )
     on conflict (account_id, jid) do update set
       phone = coalesce(excluded.phone, participants.phone),
       display_name = coalesce(excluded.display_name, participants.display_name),
       push_name = coalesce(excluded.push_name, participants.push_name),
       raw_json = coalesce(excluded.raw_json, participants.raw_json),
       updated_at = excluded.updated_at`,
  ).run({
    accountId: input.accountId,
    jid: input.jid,
    phone: input.phone ?? null,
    displayName: input.displayName ?? null,
    pushName: input.pushName ?? null,
    rawJson: input.rawJson ?? null,
    now,
  });
}

export interface MessageInput {
  accountId: string;
  chatJid: string;
  messageId: string;
  senderJid?: string | null;
  fromMe?: boolean;
  timestamp?: number | null;
  messageType?: string | null;
  text?: string | null;
  normalizedText?: string | null;
  hasMedia?: boolean;
  quotedMessageId?: string | null;
  quotedSenderJid?: string | null;
  editedMessageId?: string | null;
  deletedAt?: number | null;
  rawJson?: string | null;
}

export interface MessageRow {
  account_id: string;
  chat_jid: string;
  message_id: string;
  sender_jid: string | null;
  from_me: number;
  timestamp: number | null;
  received_at: number;
  message_type: string | null;
  text: string | null;
  normalized_text: string | null;
  has_media: number;
  quoted_message_id: string | null;
  quoted_sender_jid: string | null;
  edited_message_id: string | null;
  deleted_at: number | null;
  raw_json: string | null;
}

/**
 * Idempotent message persistence keyed on
 * `(account_id, chat_jid, message_id)`. On replay we refresh mutable fields
 * (edits, deletes, late normalization, raw payload) but never overwrite the
 * original `received_at`, `from_me`, or first-seen `timestamp`.
 */
export function upsertMessage(db: Database, input: MessageInput): void {
  db.prepare(
    `insert into messages (
       account_id, chat_jid, message_id, sender_jid, from_me, timestamp,
       received_at, message_type, text, normalized_text, has_media,
       quoted_message_id, quoted_sender_jid, edited_message_id, deleted_at, raw_json
     ) values (
       @accountId, @chatJid, @messageId, @senderJid, @fromMe, @timestamp,
       @receivedAt, @messageType, @text, @normalizedText, @hasMedia,
       @quotedMessageId, @quotedSenderJid, @editedMessageId, @deletedAt, @rawJson
     )
     on conflict (account_id, chat_jid, message_id) do update set
       sender_jid = coalesce(excluded.sender_jid, messages.sender_jid),
       message_type = coalesce(excluded.message_type, messages.message_type),
       text = coalesce(excluded.text, messages.text),
       normalized_text = coalesce(excluded.normalized_text, messages.normalized_text),
       -- Preserve a prior has_media=1 on partial replays (revoke/edit) that omit it.
       has_media = case when @hasMediaSet = 1 then @hasMedia else messages.has_media end,
       quoted_message_id = coalesce(excluded.quoted_message_id, messages.quoted_message_id),
       quoted_sender_jid = coalesce(excluded.quoted_sender_jid, messages.quoted_sender_jid),
       edited_message_id = coalesce(excluded.edited_message_id, messages.edited_message_id),
       deleted_at = coalesce(excluded.deleted_at, messages.deleted_at),
       raw_json = coalesce(excluded.raw_json, messages.raw_json)`,
  ).run({
    accountId: input.accountId,
    chatJid: input.chatJid,
    messageId: input.messageId,
    senderJid: input.senderJid ?? null,
    fromMe: input.fromMe ? 1 : 0,
    timestamp: input.timestamp ?? null,
    receivedAt: nowSec(),
    messageType: input.messageType ?? null,
    text: input.text ?? null,
    normalizedText: input.normalizedText ?? null,
    hasMedia: input.hasMedia ? 1 : 0,
    hasMediaSet: input.hasMedia === undefined ? 0 : 1,
    quotedMessageId: input.quotedMessageId ?? null,
    quotedSenderJid: input.quotedSenderJid ?? null,
    editedMessageId: input.editedMessageId ?? null,
    deletedAt: input.deletedAt ?? null,
    rawJson: input.rawJson ?? null,
  });
}

export function getMessage(
  db: Database,
  accountId: string,
  chatJid: string,
  messageId: string,
): MessageRow | undefined {
  return db
    .prepare<
      [string, string, string],
      MessageRow
    >("select * from messages where account_id = ? and chat_jid = ? and message_id = ?")
    .get(accountId, chatJid, messageId);
}

export interface ListMessagesOptions {
  accountId?: string;
  chatJid?: string;
  sinceTs?: number | null;
  limit?: number;
}

/** List messages, most-recent first (for human/JSON inspection). */
export function listMessages(
  db: Database,
  opts: ListMessagesOptions = {},
): MessageRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.accountId) {
    where.push("account_id = @accountId");
    params.accountId = opts.accountId;
  }
  if (opts.chatJid) {
    where.push("chat_jid = @chatJid");
    params.chatJid = opts.chatJid;
  }
  if (opts.sinceTs != null) {
    where.push("timestamp >= @sinceTs");
    params.sinceTs = opts.sinceTs;
  }
  if (opts.limit != null) params.limit = opts.limit;
  const sql =
    `select * from messages ${where.length ? `where ${where.join(" and ")}` : ""} ` +
    `order by coalesce(timestamp, 0) desc, rowid desc ` +
    `${opts.limit != null ? "limit @limit" : ""}`;
  return db.prepare(sql).all(params) as MessageRow[];
}

export interface ExportRow extends MessageRow {
  /** Stable per-row cursor for resumable export (the message's SQLite rowid). */
  export_rowid: number;
  chat_name: string | null;
  chat_is_group: number;
  chat_is_status: number;
  chat_is_allowed: number;
}

export interface ExportSelect {
  accountId?: string;
  /** Inclusive lower bound on message timestamp (epoch seconds). */
  sinceTs?: number | null;
  /** Exclusive lower bound on the rowid cursor (for --since-last). */
  afterRowid?: number | null;
  /** Restrict to allowed chats (is_allowed = 1 or in `allowedChats`). */
  allowedOnly?: boolean;
  allowedChats?: string[];
  limit?: number;
}

/**
 * Select messages for export in deterministic ingestion order (ascending
 * rowid), joined with their chat. `export_rowid` is the resumable cursor used
 * by consumer offsets.
 */
export function selectExportMessages(
  db: Database,
  sel: ExportSelect = {},
): ExportRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (sel.accountId) {
    where.push("m.account_id = @accountId");
    params.accountId = sel.accountId;
  }
  if (sel.sinceTs != null) {
    where.push("m.timestamp >= @sinceTs");
    params.sinceTs = sel.sinceTs;
  }
  if (sel.afterRowid != null) {
    where.push("m.rowid > @afterRowid");
    params.afterRowid = sel.afterRowid;
  }
  if (sel.allowedOnly) {
    const allow = sel.allowedChats ?? [];
    const placeholders = allow.map((_, i) => `@ac${i}`);
    allow.forEach((jid, i) => {
      params[`ac${i}`] = jid;
    });
    const inClause =
      placeholders.length > 0
        ? ` or m.chat_jid in (${placeholders.join(", ")})`
        : "";
    where.push(`(c.is_allowed = 1${inClause})`);
  }
  if (sel.limit != null) params.limit = sel.limit;

  const sql =
    `select m.rowid as export_rowid, m.*, ` +
    `c.name as chat_name, c.is_group as chat_is_group, ` +
    `c.is_status as chat_is_status, c.is_allowed as chat_is_allowed ` +
    `from messages m ` +
    `join chats c on c.account_id = m.account_id and c.jid = m.chat_jid ` +
    `${where.length ? `where ${where.join(" and ")}` : ""} ` +
    `order by m.rowid asc ` +
    `${sel.limit != null ? "limit @limit" : ""}`;
  return db.prepare(sql).all(params) as ExportRow[];
}

export function countMessages(db: Database, accountId?: string): number {
  if (accountId === undefined) {
    return (
      db.prepare<[], { n: number }>("select count(*) as n from messages").get()
        ?.n ?? 0
    );
  }
  return (
    db
      .prepare<
        [string],
        { n: number }
      >("select count(*) as n from messages where account_id = ?")
      .get(accountId)?.n ?? 0
  );
}

export interface EventInput {
  accountId: string;
  eventType: string;
  eventTs?: number | null;
  rawJson: string;
}

export function insertEvent(db: Database, input: EventInput): number {
  const info = db
    .prepare(
      `insert into events (account_id, event_type, event_ts, ingested_at, raw_json)
       values (@accountId, @eventType, @eventTs, @ingestedAt, @rawJson)`,
    )
    .run({
      accountId: input.accountId,
      eventType: input.eventType,
      eventTs: input.eventTs ?? null,
      ingestedAt: nowSec(),
      rawJson: input.rawJson,
    });
  return Number(info.lastInsertRowid);
}

export interface ConsumerOffsetRow {
  consumer_name: string;
  last_seen_timestamp: number | null;
  last_seen_event_id: number | null;
  updated_at: number;
}

export function getConsumerOffset(
  db: Database,
  consumerName: string,
): ConsumerOffsetRow | undefined {
  return db
    .prepare<
      [string],
      ConsumerOffsetRow
    >("select * from consumer_offsets where consumer_name = ?")
    .get(consumerName);
}

export function setConsumerOffset(
  db: Database,
  consumerName: string,
  offset: {
    lastSeenTimestamp?: number | null;
    lastSeenEventId?: number | null;
  },
): void {
  db.prepare(
    `insert into consumer_offsets (
       consumer_name, last_seen_timestamp, last_seen_event_id, updated_at
     ) values (@name, @ts, @eventId, @now)
     on conflict (consumer_name) do update set
       -- Advance only the cursors provided; never erase the other component
       -- (both are needed for --since-last resume).
       last_seen_timestamp = coalesce(excluded.last_seen_timestamp, consumer_offsets.last_seen_timestamp),
       last_seen_event_id = coalesce(excluded.last_seen_event_id, consumer_offsets.last_seen_event_id),
       updated_at = excluded.updated_at`,
  ).run({
    name: consumerName,
    ts: offset.lastSeenTimestamp ?? null,
    eventId: offset.lastSeenEventId ?? null,
    now: nowSec(),
  });
}
