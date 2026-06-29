import { describe, expect, it } from "vitest";
import { resolveConfig, type Config } from "../src/config.js";
import {
  chatAllowedAtSync,
  senderAllowedAtSync,
} from "../src/privacy/filters.js";

function cfg(overrides: Record<string, unknown> = {}): Config {
  return resolveConfig(overrides, { dataDir: "/data" });
}

describe("chatAllowedAtSync", () => {
  it("excludes status and groups by default", () => {
    const c = cfg();
    expect(
      chatAllowedAtSync(c, {
        jid: "status@broadcast",
        isGroup: false,
        isStatus: true,
      }).store,
    ).toBe(false);
    expect(
      chatAllowedAtSync(c, { jid: "g@g.us", isGroup: true, isStatus: false })
        .store,
    ).toBe(false);
  });

  it("includes groups/status when enabled", () => {
    const c = cfg({ privacy: { include_groups: true, include_status: true } });
    expect(
      chatAllowedAtSync(c, { jid: "g@g.us", isGroup: true, isStatus: false })
        .store,
    ).toBe(true);
    expect(
      chatAllowedAtSync(c, {
        jid: "status@broadcast",
        isGroup: false,
        isStatus: true,
      }).store,
    ).toBe(true);
  });

  it("blocks listed chats", () => {
    const c = cfg({ filters: { blocked_chats: ["x@s.whatsapp.net"] } });
    const d = chatAllowedAtSync(c, {
      jid: "x@s.whatsapp.net",
      isGroup: false,
      isStatus: false,
    });
    expect(d.store).toBe(false);
    expect(d.reason).toBe("chat-blocked");
  });

  it("with a non-empty allowlist, only allowed chats pass", () => {
    const c = cfg({ filters: { allowed_chats: ["ok@s.whatsapp.net"] } });
    expect(
      chatAllowedAtSync(c, {
        jid: "ok@s.whatsapp.net",
        isGroup: false,
        isStatus: false,
      }).store,
    ).toBe(true);
    expect(
      chatAllowedAtSync(c, {
        jid: "no@s.whatsapp.net",
        isGroup: false,
        isStatus: false,
      }).store,
    ).toBe(false);
  });

  it("with an empty allowlist, discovers all non-blocked chats", () => {
    const c = cfg();
    expect(
      chatAllowedAtSync(c, {
        jid: "any@s.whatsapp.net",
        isGroup: false,
        isStatus: false,
      }).store,
    ).toBe(true);
  });
});

describe("senderAllowedAtSync", () => {
  it("permits a null (unknown) sender when no allowlist is set", () => {
    expect(senderAllowedAtSync(cfg(), null).store).toBe(true);
  });

  it("fails closed for a null sender when an allowlist is configured", () => {
    const c = cfg({ filters: { allowed_senders: ["a@s.whatsapp.net"] } });
    const d = senderAllowedAtSync(c, null);
    expect(d.store).toBe(false);
    expect(d.reason).toBe("sender-unknown");
  });

  it("blocks listed senders and honors an allowlist", () => {
    const blocked = cfg({ filters: { blocked_senders: ["b@s.whatsapp.net"] } });
    expect(senderAllowedAtSync(blocked, "b@s.whatsapp.net").store).toBe(false);

    const allow = cfg({ filters: { allowed_senders: ["a@s.whatsapp.net"] } });
    expect(senderAllowedAtSync(allow, "a@s.whatsapp.net").store).toBe(true);
    expect(senderAllowedAtSync(allow, "z@s.whatsapp.net").store).toBe(false);
  });
});
