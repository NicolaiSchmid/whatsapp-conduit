import {
  getContentType,
  normalizeMessageContent,
  proto,
  type WAMessage,
} from "baileys";
import { isGroupJid, isStatusJid, normalizeJid } from "./jid.js";

/**
 * Normalized message types we persist. `unknown` is used (with raw_json kept)
 * whenever a payload cannot be safely parsed — explicit loss over invented data.
 */
export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "contact"
  | "location"
  | "poll"
  | "reaction"
  | "protocol"
  | "unknown";

export interface NormalizedMessage {
  chatJid: string;
  messageId: string;
  senderJid: string | null;
  fromMe: boolean;
  timestamp: number | null;
  messageType: MessageType;
  text: string | null;
  hasMedia: boolean;
  quotedMessageId: string | null;
  quotedSenderJid: string | null;
  isGroup: boolean;
  isStatus: boolean;
  pushName: string | null;
}

/** Result of normalizing one Baileys message. A discriminated action. */
export type NormalizeResult =
  | { action: "store"; message: NormalizedMessage }
  | {
      action: "revoke";
      chatJid: string;
      targetId: string;
      senderJid: string | null;
      isGroup: boolean;
      isStatus: boolean;
    }
  | {
      action: "edit";
      chatJid: string;
      targetId: string;
      text: string | null;
      editId: string;
      senderJid: string | null;
      isGroup: boolean;
      isStatus: boolean;
    }
  | { action: "skip"; reason: string };

const MEDIA_TYPES: ReadonlySet<MessageType> = new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
]);

type LongLike = { toNumber: () => number } | number | null | undefined;

/** Coerce a protobuf timestamp (number or Long) to epoch seconds. */
function toEpochSeconds(value: LongLike): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const CONTENT_TYPE_MAP: Partial<Record<string, MessageType>> = {
  conversation: "text",
  extendedTextMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
  contactMessage: "contact",
  contactsArrayMessage: "contact",
  locationMessage: "location",
  liveLocationMessage: "location",
  pollCreationMessage: "poll",
  pollCreationMessageV2: "poll",
  pollCreationMessageV3: "poll",
  pollCreationMessageV4: "poll",
  pollCreationMessageV5: "poll",
};

/** Content types whose `.name` field holds the poll question. */
const POLL_CONTENT_TYPES = new Set(
  Object.keys(CONTENT_TYPE_MAP).filter((k) =>
    k.startsWith("pollCreationMessage"),
  ),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Best-effort context info (quoted message) for a content node. */
function extractContext(node: unknown): {
  quotedMessageId: string | null;
  quotedSenderJid: string | null;
} {
  if (isRecord(node) && isRecord(node.contextInfo)) {
    const ctx = node.contextInfo;
    const stanzaId = typeof ctx.stanzaId === "string" ? ctx.stanzaId : null;
    const participant =
      typeof ctx.participant === "string"
        ? normalizeJid(ctx.participant)
        : null;
    return { quotedMessageId: stanzaId, quotedSenderJid: participant };
  }
  return { quotedMessageId: null, quotedSenderJid: null };
}

/**
 * Best-effort text for a content node, keyed on the raw Baileys content type.
 * `conversation` is a bare string; the others nest text under a field.
 */
function extractText(contentType: string, node: unknown): string | null {
  if (contentType === "conversation") {
    return typeof node === "string" ? node : null;
  }
  if (!isRecord(node)) return null;
  switch (contentType) {
    case "extendedTextMessage":
      return typeof node.text === "string" ? node.text : null;
    case "imageMessage":
    case "videoMessage":
    case "documentMessage":
      return typeof node.caption === "string" ? node.caption : null;
    default:
      if (POLL_CONTENT_TYPES.has(contentType)) {
        return typeof node.name === "string" ? node.name : null;
      }
      return null;
  }
}

export function resolveSender(
  key: proto.IMessageKey,
  isGroup: boolean,
  fromMe: boolean,
): string | null {
  if (typeof key.participant === "string" && key.participant.length > 0) {
    return normalizeJid(key.participant);
  }
  if (isGroup) return null; // group sender unknown without participant
  if (fromMe) return null; // our own jid is recorded on the account, not here
  return key.remoteJid ? normalizeJid(key.remoteJid) : null;
}

/**
 * Normalize a Baileys message into a persistence action. Pure and defensive:
 * anything it cannot parse becomes either a `skip` or an `unknown`-typed store
 * with no invented fields.
 */
export function normalizeMessage(msg: WAMessage): NormalizeResult {
  const key = msg.key;
  const chatJid = key?.remoteJid ?? null;
  const messageId = key?.id ?? null;
  if (!chatJid || !messageId) {
    return { action: "skip", reason: "missing-key" };
  }

  const isGroup = isGroupJid(chatJid);
  const isStatus = isStatusJid(chatJid);
  const fromMe = Boolean(key?.fromMe);

  const content = normalizeMessageContent(msg.message);
  if (!content) {
    return { action: "skip", reason: "no-content" };
  }

  const contentType = getContentType(content);
  if (!contentType) {
    return buildStore(msg, chatJid, messageId, isGroup, isStatus, fromMe, {
      messageType: "unknown",
      text: null,
      hasMedia: false,
      quoted: { quotedMessageId: null, quotedSenderJid: null },
    });
  }

  const node = (content as Record<string, unknown>)[contentType];

  // Protocol messages: revocations and edits target another message.
  if (contentType === "protocolMessage" && isRecord(node)) {
    const senderJid = resolveSender(key, isGroup, fromMe);
    return normalizeProtocol(
      node,
      chatJid,
      messageId,
      senderJid,
      isGroup,
      isStatus,
    );
  }

  // Reactions reference a target message. Keyed identically to the dedicated
  // messages.reaction path so a live reaction delivered via both events dedupes
  // to one row (Baileys v7 emits both).
  if (contentType === "reactionMessage" && isRecord(node)) {
    const targetKey = isRecord(node.key) ? node.key : undefined;
    const targetId =
      targetKey && typeof targetKey.id === "string" ? targetKey.id : null;
    if (!targetId) return { action: "skip", reason: "reaction-missing-target" };
    return buildReaction({
      chatJid,
      targetId,
      targetParticipant:
        targetKey && typeof targetKey.participant === "string"
          ? targetKey.participant
          : null,
      reactorKey: key, // msg.key identifies the reactor
      text: typeof node.text === "string" ? node.text : null,
      timestampSec: toEpochSeconds(msg.messageTimestamp as LongLike),
    });
  }

  const messageType = CONTENT_TYPE_MAP[contentType] ?? "unknown";
  return buildStore(msg, chatJid, messageId, isGroup, isStatus, fromMe, {
    messageType,
    text: extractText(contentType, node),
    hasMedia: MEDIA_TYPES.has(messageType),
    quoted: extractContext(node),
  });
}

interface ReactionParts {
  chatJid: string;
  targetId: string;
  /** Author of the reacted-to message (group participant), if known. */
  targetParticipant: string | null;
  /** The reactor's key. Ownership (`fromMe`) is taken only from here. */
  reactorKey: proto.IMessageKey | undefined;
  text: string | null | undefined;
  timestampSec: number | null;
}

/**
 * Build a reaction store row from either reaction event source
 * (`messages.reaction` or a `reactionMessage` in `messages.upsert`), keyed
 * deterministically on `(target, reactor)` so both sources dedupe to one row.
 *
 * Ownership comes only from `reactorKey.fromMe` — never the target key, which
 * describes the reacted-to message's author, not the reactor. A missing text is
 * a *removal*, stored as `""` (a non-null tombstone) so it overwrites a stored
 * emoji.
 */
function buildReaction(parts: ReactionParts): NormalizeResult {
  const isGroup = isGroupJid(parts.chatJid);
  const isStatus = isStatusJid(parts.chatJid);
  const fromMe = Boolean(parts.reactorKey?.fromMe);
  const reactor = parts.reactorKey
    ? resolveSender(parts.reactorKey, isGroup, fromMe)
    : null;
  const reactorToken = reactor ?? (fromMe ? "self" : "unknown");

  return {
    action: "store",
    message: {
      chatJid: parts.chatJid,
      messageId: `reaction:${parts.targetId}:${reactorToken}`,
      senderJid: reactor,
      fromMe,
      timestamp: parts.timestampSec,
      messageType: "reaction",
      text: typeof parts.text === "string" ? parts.text : "",
      hasMedia: false,
      quotedMessageId: parts.targetId,
      quotedSenderJid: parts.targetParticipant
        ? normalizeJid(parts.targetParticipant)
        : null,
      isGroup,
      isStatus,
      pushName: null,
    },
  };
}

/**
 * Normalize a Baileys `messages.reaction` entry (a reaction to an
 * already-synced message) into a reaction store. See {@link buildReaction}.
 */
export function normalizeReaction(
  targetKey: proto.IMessageKey,
  reaction: proto.IReaction,
): NormalizeResult {
  const chatJid = targetKey?.remoteJid ?? null;
  const targetId = targetKey?.id ?? null;
  if (!chatJid || !targetId) {
    return { action: "skip", reason: "reaction-missing-target" };
  }
  const tsMs = toEpochSeconds(reaction.senderTimestampMs as LongLike);
  return buildReaction({
    chatJid,
    targetId,
    targetParticipant:
      typeof targetKey.participant === "string" ? targetKey.participant : null,
    reactorKey: reaction.key ?? undefined,
    text: reaction.text,
    timestampSec: tsMs != null ? Math.floor(tsMs / 1000) : null,
  });
}

function normalizeProtocol(
  node: Record<string, unknown>,
  chatJid: string,
  messageId: string,
  senderJid: string | null,
  isGroup: boolean,
  isStatus: boolean,
): NormalizeResult {
  const type = node.type;
  const targetKey = isRecord(node.key) ? node.key : undefined;
  const targetId =
    targetKey && typeof targetKey.id === "string" ? targetKey.id : null;

  if (type === proto.Message.ProtocolMessage.Type.REVOKE && targetId) {
    return {
      action: "revoke",
      chatJid,
      targetId,
      senderJid,
      isGroup,
      isStatus,
    };
  }

  if (type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && targetId) {
    const edited = isRecord(node.editedMessage)
      ? node.editedMessage
      : undefined;
    let text: string | null = null;
    if (edited) {
      const editedType = getContentType(edited as proto.IMessage);
      if (editedType) {
        const editedNode = (edited as Record<string, unknown>)[editedType];
        text = extractText(editedType, editedNode);
      }
    }
    return {
      action: "edit",
      chatJid,
      targetId,
      text,
      editId: messageId,
      senderJid,
      isGroup,
      isStatus,
    };
  }

  // Other protocol messages (app state, history sync notifications, etc.) are
  // not message content; skip rather than invent a row.
  return { action: "skip", reason: "protocol-noop" };
}

interface StoreParts {
  messageType: MessageType;
  text: string | null;
  hasMedia: boolean;
  quoted: { quotedMessageId: string | null; quotedSenderJid: string | null };
}

function buildStore(
  msg: WAMessage,
  chatJid: string,
  messageId: string,
  isGroup: boolean,
  isStatus: boolean,
  fromMe: boolean,
  parts: StoreParts,
): NormalizeResult {
  return {
    action: "store",
    message: {
      chatJid,
      messageId,
      senderJid: resolveSender(msg.key, isGroup, fromMe),
      fromMe,
      timestamp: toEpochSeconds(msg.messageTimestamp as LongLike),
      messageType: parts.messageType,
      text: parts.text,
      hasMedia: parts.hasMedia,
      quotedMessageId: parts.quoted.quotedMessageId,
      quotedSenderJid: parts.quoted.quotedSenderJid,
      isGroup,
      isStatus,
      pushName: typeof msg.pushName === "string" ? msg.pushName : null,
    },
  };
}
