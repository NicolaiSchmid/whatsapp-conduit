import { describe, expect, it } from "vitest";
import { redactJid } from "../src/privacy/redact.js";

describe("redactJid", () => {
  it("replaces a phone user part with a stable token", () => {
    const a = redactJid("49123456789@s.whatsapp.net");
    const b = redactJid("49123456789:3@s.whatsapp.net");
    expect(a).toMatch(/^redacted-[0-9a-f]{12}@s\.whatsapp\.net$/);
    expect(a).not.toContain("49123456789");
    // Stable across device suffixes (same base number → same token).
    expect(b).toBe(a);
  });

  it("leaves groups, broadcast, and lid jids unchanged", () => {
    expect(redactJid("123-456@g.us")).toBe("123-456@g.us");
    expect(redactJid("status@broadcast")).toBe("status@broadcast");
    expect(redactJid("abc@lid")).toBe("abc@lid");
    expect(redactJid(null)).toBeNull();
  });
});
