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
 * pass.
 *
 * A null (unknown) sender — e.g. our own outgoing messages, whose sender JID is
 * not recorded — fails **closed** when an allowlist is configured: it cannot be
 * confirmed to be in the allowlist, and a sender allowlist is a privacy control.
 * With no allowlist, a null sender is permitted (the chat filter already ran).
 */
export function senderAllowedAtSync(
  config: Config,
  senderJid: string | null,
): FilterDecision {
  const allow = config.filters.allowedSenders;
  if (!senderJid) {
    return allow.length > 0
      ? { store: false, reason: "sender-unknown" }
      : { store: true };
  }
  if (config.filters.blockedSenders.includes(senderJid)) {
    return { store: false, reason: "sender-blocked" };
  }
  if (allow.length > 0 && !allow.includes(senderJid)) {
    return { store: false, reason: "sender-not-in-allowlist" };
  }
  return { store: true };
}
