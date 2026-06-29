import { proto, type WAMessage, type WASocket } from "baileys";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Database } from "../db/index.js";
import {
  getChat,
  insertEvent,
  upsertChat,
  upsertMessage,
  upsertParticipant,
} from "../db/queries.js";
import { nowSec } from "../util/time.js";
import { isGroupJid, isStatusJid } from "./jid.js";
import {
  normalizeMessage,
  normalizeReaction,
  type NormalizedMessage,
  type NormalizeResult,
} from "./normalize.js";
import { chatAllowedAtSync, senderAllowedAtSync } from "../privacy/filters.js";

export interface IngestDeps {
  db: Database;
  accountId: string;
  config: Config;
  logger: Logger;
}

/** Reasons that warrant an auditable `ignored` event row (vs. bulk categories). */
const AUDITED_IGNORE_REASONS: ReadonlySet<string> = new Set([
  "chat-blocked",
  "chat-blocked-db",
  "sender-blocked",
  "sender-unknown",
  "not-in-allowlist",
  "sender-not-in-allowlist",
]);

/** True if the chat was blocked via `chats block` (DB policy flag). */
function chatBlockedInDb(deps: IngestDeps, chatJid: string): boolean {
  return getChat(deps.db, deps.accountId, chatJid)?.is_blocked === 1;
}

/**
 * Register observe-only ingestion handlers on a socket. Strictly read-side:
 * it listens to message events and writes to SQLite. It never sends, reads, or
 * marks anything.
 */
export function registerIngestion(sock: WASocket, deps: IngestDeps): void {
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      try {
        ingestMessage(deps, msg);
      } catch (err) {
        deps.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "failed to ingest message",
        );
      }
    }
  });

  sock.ev.on("messages.update", (updates) => {
    for (const update of updates) {
      try {
        ingestUpdate(deps, update);
      } catch (err) {
        deps.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "failed to ingest message update",
        );
      }
    }
  });

  // Reactions to already-synced messages arrive via a dedicated event.
  sock.ev.on("messages.reaction", (reactions) => {
    for (const { key, reaction } of reactions) {
      try {
        ingestReaction(deps, key, reaction);
      } catch (err) {
        deps.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "failed to ingest reaction",
        );
      }
    }
  });
}

interface ChatContext {
  jid: string;
  isGroup: boolean;
  isStatus: boolean;
}

/**
 * Apply chat-level filters (config category/allow/block plus the DB `is_blocked`
 * flag set by `chats block`). Records an audited ignored event and returns false
 * when the chat is filtered out.
 */
function chatPasses(
  deps: IngestDeps,
  ctx: ChatContext,
  messageId: string | null,
): boolean {
  const decision = chatAllowedAtSync(deps.config, ctx);
  if (!decision.store) {
    recordIgnored(deps, ctx.jid, messageId, decision.reason);
    return false;
  }
  if (chatBlockedInDb(deps, ctx.jid)) {
    recordIgnored(deps, ctx.jid, messageId, "chat-blocked-db");
    return false;
  }
  return true;
}

/** Apply the sender filter; record an ignored event and return false on reject. */
function senderPasses(
  deps: IngestDeps,
  chatJid: string,
  senderJid: string | null,
  messageId: string | null,
): boolean {
  const decision = senderAllowedAtSync(deps.config, senderJid);
  if (!decision.store) {
    recordIgnored(deps, chatJid, messageId, decision.reason);
    return false;
  }
  return true;
}

/** Ingest a single message from `messages.upsert`. */
export function ingestMessage(deps: IngestDeps, msg: WAMessage): void {
  const result = normalizeMessage(msg);
  if (result.action === "skip") {
    deps.logger.debug({ reason: result.reason }, "skipped message");
    return;
  }

  const ctx: ChatContext =
    result.action === "store"
      ? {
          jid: result.message.chatJid,
          isGroup: result.message.isGroup,
          isStatus: result.message.isStatus,
        }
      : {
          jid: result.chatJid,
          isGroup: result.isGroup,
          isStatus: result.isStatus,
        };

  const messageId = messageIdOf(result);
  if (!chatPasses(deps, ctx, messageId)) return;

  // The sender filter applies to stores AND protocol edits/revokes alike — a
  // blocked sender must not be able to write edited text or tombstones either.
  const senderJid =
    result.action === "store" ? result.message.senderJid : result.senderJid;
  if (!senderPasses(deps, ctx.jid, senderJid, messageId)) return;

  if (result.action === "store") {
    persistStore(deps, result.message, rawJsonOf(deps.config, msg));
    return;
  }

  if (result.action === "revoke") {
    persistRevoke(
      deps,
      result.chatJid,
      result.targetId,
      ctx.isGroup,
      ctx.isStatus,
    );
    return;
  }

  // edit
  persistEdit(
    deps,
    result,
    ctx.isGroup,
    ctx.isStatus,
    rawJsonOf(deps.config, msg),
  );
}

/** Ingest a reaction from the dedicated `messages.reaction` event. */
export function ingestReaction(
  deps: IngestDeps,
  key: proto.IMessageKey,
  reaction: proto.IReaction,
): void {
  const result = normalizeReaction(key, reaction);
  if (result.action !== "store") return;
  const { message } = result;
  const ctx: ChatContext = {
    jid: message.chatJid,
    isGroup: message.isGroup,
    isStatus: message.isStatus,
  };
  if (!chatPasses(deps, ctx, message.messageId)) return;
  if (!senderPasses(deps, ctx.jid, message.senderJid, message.messageId))
    return;
  persistStore(deps, message, null);
}

/** Handle `messages.update` — used here only to capture delete-for-everyone. */
export function ingestUpdate(
  deps: IngestDeps,
  update: { key: proto.IMessageKey; update: Partial<proto.IWebMessageInfo> },
): void {
  const chatJid = update.key?.remoteJid ?? null;
  const targetId = update.key?.id ?? null;
  if (!chatJid || !targetId) return;

  const revokeStub = proto.WebMessageInfo.StubType.REVOKE;
  const isRevoke =
    update.update?.messageStubType === revokeStub ||
    update.update?.message === null;
  if (!isRevoke) return;

  const ctx: ChatContext = {
    jid: chatJid,
    isGroup: isGroupJid(chatJid),
    isStatus: isStatusJid(chatJid),
  };
  if (!chatPasses(deps, ctx, targetId)) return;

  persistRevoke(deps, chatJid, targetId, ctx.isGroup, ctx.isStatus);
}

function persistStore(
  deps: IngestDeps,
  n: NormalizedMessage,
  rawJson: string | null,
): void {
  const storeText = deps.config.privacy.storeMessageText;
  const text = storeText ? n.text : null;
  const tx = deps.db.transaction(() => {
    upsertChat(deps.db, {
      accountId: deps.accountId,
      jid: n.chatJid,
      isGroup: n.isGroup,
      isStatus: n.isStatus,
      lastMessageTs: n.timestamp,
      // pushName from a 1:1 inbound message is the other party's display name.
      pushName: !n.isGroup && !n.fromMe ? n.pushName : null,
    });
    if (n.senderJid) {
      upsertParticipant(deps.db, {
        accountId: deps.accountId,
        jid: n.senderJid,
        pushName: n.fromMe ? null : n.pushName,
      });
    }
    upsertMessage(deps.db, {
      accountId: deps.accountId,
      chatJid: n.chatJid,
      messageId: n.messageId,
      senderJid: n.senderJid,
      fromMe: n.fromMe,
      timestamp: n.timestamp,
      messageType: n.messageType,
      text,
      normalizedText: text,
      hasMedia: n.hasMedia,
      quotedMessageId: n.quotedMessageId,
      quotedSenderJid: n.quotedSenderJid,
      rawJson,
    });
  });
  tx();
}

function persistRevoke(
  deps: IngestDeps,
  chatJid: string,
  targetId: string,
  isGroup: boolean,
  isStatus: boolean,
): void {
  const tx = deps.db.transaction(() => {
    upsertChat(deps.db, {
      accountId: deps.accountId,
      jid: chatJid,
      isGroup,
      isStatus,
    });
    upsertMessage(deps.db, {
      accountId: deps.accountId,
      chatJid,
      messageId: targetId,
      deletedAt: nowSec(),
    });
  });
  tx();
}

function persistEdit(
  deps: IngestDeps,
  result: Extract<NormalizeResult, { action: "edit" }>,
  isGroup: boolean,
  isStatus: boolean,
  rawJson: string | null,
): void {
  const storeText = deps.config.privacy.storeMessageText;
  const text = storeText ? result.text : null;
  // Explicit loss over invented data: if the edited content could not be
  // parsed, keep the raw edit payload (when enabled) as an event so it stays
  // recoverable rather than discarding the only copy of the new content.
  const preserveRaw = result.text === null && rawJson !== null;
  const tx = deps.db.transaction(() => {
    upsertChat(deps.db, {
      accountId: deps.accountId,
      jid: result.chatJid,
      isGroup,
      isStatus,
    });
    upsertMessage(deps.db, {
      accountId: deps.accountId,
      chatJid: result.chatJid,
      messageId: result.targetId,
      text,
      normalizedText: text,
      editedMessageId: result.editId,
    });
    if (preserveRaw) {
      insertEvent(deps.db, {
        accountId: deps.accountId,
        eventType: "edit_unparsed",
        eventTs: nowSec(),
        rawJson,
      });
    }
  });
  tx();
}

function recordIgnored(
  deps: IngestDeps,
  chatJid: string,
  messageId: string | null,
  reason: string | undefined,
): void {
  deps.logger.debug({ reason, chatJid }, "ignored message at sync filter");
  if (!reason || !AUDITED_IGNORE_REASONS.has(reason)) return;
  // Metadata only — never the message body, even for a blocked chat.
  insertEvent(deps.db, {
    accountId: deps.accountId,
    eventType: "ignored",
    eventTs: nowSec(),
    rawJson: JSON.stringify({ chatJid, messageId, reason }),
  });
}

function messageIdOf(result: NormalizeResult): string | null {
  if (result.action === "store") return result.message.messageId;
  if (result.action === "revoke" || result.action === "edit") {
    return result.targetId;
  }
  return null;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function isLongLike(
  value: unknown,
): value is { low: number; high: number; toNumber: () => number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "low" in value &&
    "high" in value &&
    typeof (value as { toNumber?: unknown }).toNumber === "function"
  );
}

/**
 * Serialize the raw Baileys payload for `raw_json` when enabled. Converts binary
 * fields to base64 and Long timestamps to numbers so the JSON stays compact and
 * lossless-enough to recover from parser gaps later.
 *
 * The raw payload contains message text, so `store_message_text: false` is
 * authoritative: it suppresses raw_json too. Disabling text storage must not be
 * silently undone by the (default-on) raw payload.
 */
export function rawJsonOf(config: Config, msg: WAMessage): string | null {
  if (!config.privacy.storeRawJson || !config.privacy.storeMessageText) {
    return null;
  }
  return JSON.stringify(msg, (_key, value: unknown) => {
    if (isUint8Array(value)) return Buffer.from(value).toString("base64");
    if (isLongLike(value)) return value.toNumber();
    return value;
  });
}
