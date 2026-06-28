import { describe, expect, it } from "vitest";
import {
  isBroadcastJid,
  isGroupJid,
  isStatusJid,
  normalizeJid,
  phoneFromJid,
} from "../src/baileys/jid.js";

describe("jid helpers", () => {
  it("normalizes device-suffixed user jids", () => {
    expect(normalizeJid("49123456:5@s.whatsapp.net")).toBe(
      "49123456@s.whatsapp.net",
    );
  });

  it("classifies group and status jids", () => {
    expect(isGroupJid("12345-678@g.us")).toBe(true);
    expect(isGroupJid("49123@s.whatsapp.net")).toBe(false);
    expect(isStatusJid("status@broadcast")).toBe(true);
    expect(isBroadcastJid("status@broadcast")).toBe(true);
  });

  it("extracts phone numbers only from real user jids", () => {
    expect(phoneFromJid("49123456789@s.whatsapp.net")).toBe("49123456789");
    expect(phoneFromJid("49123456789:7@s.whatsapp.net")).toBe("49123456789");
    expect(phoneFromJid("12345-678@g.us")).toBeUndefined();
    expect(phoneFromJid("status@broadcast")).toBeUndefined();
    expect(phoneFromJid("abc@lid")).toBeUndefined();
  });
});
