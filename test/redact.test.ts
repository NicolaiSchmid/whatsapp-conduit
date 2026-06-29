import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRedactionSalt, redactJid } from "../src/privacy/redact.js";

const SALT = "test-salt";

describe("redactJid", () => {
  it("replaces a phone user part with a stable, salted token", () => {
    const a = redactJid("49123456789@s.whatsapp.net", SALT);
    const b = redactJid("49123456789:3@s.whatsapp.net", SALT);
    expect(a).toMatch(/^redacted-[0-9a-f]{12}@s\.whatsapp\.net$/);
    expect(a).not.toContain("49123456789");
    // Stable across device suffixes (same base number → same token).
    expect(b).toBe(a);
    // Salt-dependent: a different salt yields a different token.
    expect(redactJid("49123456789@s.whatsapp.net", "other")).not.toBe(a);
  });

  it("leaves groups, broadcast, and lid jids unchanged", () => {
    expect(redactJid("123-456@g.us", SALT)).toBe("123-456@g.us");
    expect(redactJid("status@broadcast", SALT)).toBe("status@broadcast");
    expect(redactJid("abc@lid", SALT)).toBe("abc@lid");
    expect(redactJid(null, SALT)).toBeNull();
  });
});

describe("loadRedactionSalt", () => {
  it("creates a stable 0600 salt file and reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "wac-salt-"));
    try {
      const first = loadRedactionSalt(dir);
      const second = loadRedactionSalt(dir);
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThanOrEqual(32);
      expect(statSync(join(dir, "redaction-salt")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
