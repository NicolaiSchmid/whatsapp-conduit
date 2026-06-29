import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Replace the numeric user part of a phone JID with a stable, non-reversible
 * token so exports can still correlate a sender across messages without
 * revealing the number.
 *
 * The token is `HMAC-SHA256(salt, number)` truncated — keyed on a per-install
 * secret salt, not a bare hash: bare SHA-256 of an E.164 number is trivially
 * reversible by enumeration. Group/broadcast/`@lid` JIDs (no phone number) and
 * already-non-numeric users are returned unchanged.
 */
export function redactJid(jid: string | null, salt: string): string | null {
  if (!jid) return jid;
  const at = jid.indexOf("@");
  if (at < 0) return jid;

  const user = jid.slice(0, at);
  const domain = jid.slice(at);
  if (domain !== "@s.whatsapp.net" && domain !== "@c.us") return jid;

  const base = user.split(":")[0] ?? "";
  if (!/^\d+$/.test(base)) return jid;

  const token = createHmac("sha256", salt)
    .update(base)
    .digest("hex")
    .slice(0, 12);
  return `redacted-${token}${domain}`;
}

const SALT_FILE = "redaction-salt";

/**
 * Load (or create) the per-install redaction salt stored owner-only under the
 * data directory. Generated once and reused so redacted tokens stay stable
 * across exports while remaining non-reversible without the salt.
 */
export function loadRedactionSalt(dataDir: string): string {
  const file = join(dataDir, SALT_FILE);
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length > 0) return existing;
  }
  const salt = randomBytes(32).toString("hex");
  writeFileSync(file, salt, { mode: 0o600 });
  return salt;
}
