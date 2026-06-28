import { createHash } from "node:crypto";

/**
 * Replace the numeric user part of a phone JID with a stable, non-reversible
 * token so exports can still correlate a sender across messages without
 * revealing the number. Group/broadcast/`@lid` JIDs (no phone number) and
 * already-non-numeric users are returned unchanged.
 */
export function redactJid(jid: string | null): string | null {
  if (!jid) return jid;
  const at = jid.indexOf("@");
  if (at < 0) return jid;

  const user = jid.slice(0, at);
  const domain = jid.slice(at);
  if (domain !== "@s.whatsapp.net" && domain !== "@c.us") return jid;

  const base = user.split(":")[0] ?? "";
  if (!/^\d+$/.test(base)) return jid;

  const token = createHash("sha256").update(base).digest("hex").slice(0, 12);
  return `redacted-${token}${domain}`;
}
