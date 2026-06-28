import type { Config } from "../config.js";

export interface ChatContext {
  jid: string;
  isGroup: boolean;
  isStatus: boolean;
}

export interface FilterDecision {
  store: boolean;
  reason?: string;
}

/**
 * Decide whether a chat's messages may be ingested, at the sync boundary.
 *
 * Posture:
 *  - status/stories and groups are excluded unless explicitly enabled;
 *  - blocked chats are always excluded;
 *  - if a non-empty `allowed_chats` allowlist is configured, only those chats
 *    are ingested. An empty allowlist means "discover everything not blocked" —
 *    discovery still happens; gating exposure to exports is a separate concern
 *    (the `is_allowed` flag + `--allowed-only`).
 */
export function chatAllowedAtSync(
  config: Config,
  ctx: ChatContext,
): FilterDecision {
  if (ctx.isStatus && !config.privacy.includeStatus) {
    return { store: false, reason: "status-excluded" };
  }
  if (ctx.isGroup && !config.privacy.includeGroups) {
    return { store: false, reason: "groups-excluded" };
  }
  if (config.filters.blockedChats.includes(ctx.jid)) {
    return { store: false, reason: "chat-blocked" };
  }
  const allow = config.filters.allowedChats;
  if (allow.length > 0 && !allow.includes(ctx.jid)) {
    return { store: false, reason: "not-in-allowlist" };
  }
  return { store: true };
}

/**
 * Decide whether a sender is permitted. Blocked senders are always excluded;
 * if a non-empty `allowed_senders` allowlist is configured, only those senders
 * pass. A null sender (unknown) is permitted — the chat filter already applied.
 */
export function senderAllowedAtSync(
  config: Config,
  senderJid: string | null,
): FilterDecision {
  if (!senderJid) return { store: true };
  if (config.filters.blockedSenders.includes(senderJid)) {
    return { store: false, reason: "sender-blocked" };
  }
  const allow = config.filters.allowedSenders;
  if (allow.length > 0 && !allow.includes(senderJid)) {
    return { store: false, reason: "sender-not-in-allowlist" };
  }
  return { store: true };
}
