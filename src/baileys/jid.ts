import {
  isJidBroadcast,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
} from "baileys";

/** Normalize a JID to its canonical user form (drops device/agent suffixes). */
export function normalizeJid(jid: string): string {
  return jidNormalizedUser(jid);
}

/** True for group chats (`...@g.us`). */
export function isGroupJid(jid: string): boolean {
  return isJidGroup(jid) ?? false;
}

/** True for the status/stories broadcast JID. */
export function isStatusJid(jid: string): boolean {
  return isJidStatusBroadcast(jid);
}

/** True for any broadcast JID (status or broadcast lists). */
export function isBroadcastJid(jid: string): boolean {
  return isJidBroadcast(jid) || isJidStatusBroadcast(jid);
}

/**
 * Best-effort phone number from a user JID: the user part before `@`, with any
 * `:device` / `_agent` suffix removed. Returns undefined for non-phone JIDs
 * (groups, `@lid`, broadcast) where a number is not meaningful.
 */
export function phoneFromJid(jid: string): string | undefined {
  if (isGroupJid(jid) || isBroadcastJid(jid)) return undefined;
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) {
    return undefined;
  }
  const user = jid.split("@")[0] ?? "";
  const digits = user.split(":")[0]?.split("_")[0] ?? "";
  return /^\d+$/.test(digits) ? digits : undefined;
}
