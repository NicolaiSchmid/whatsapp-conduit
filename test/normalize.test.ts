import { describe, expect, it } from "vitest";
import { proto, type WAMessage } from "baileys";
import {
  normalizeMessage,
  normalizeReaction,
} from "../src/baileys/normalize.js";

function msg(overrides: Partial<WAMessage>): WAMessage {
  return {
    key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "M1" },
    messageTimestamp: 1700,
    ...overrides,
  } as WAMessage;
}

describe("normalizeMessage: storable content", () => {
  it("plain conversation text", () => {
    const r = normalizeMessage(msg({ message: { conversation: "hello" } }));
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.messageType).toBe("text");
    expect(r.message.text).toBe("hello");
    expect(r.message.timestamp).toBe(1700);
    expect(r.message.senderJid).toBe("c@s.whatsapp.net");
    expect(r.message.hasMedia).toBe(false);
  });

  it("extended text with a quoted message", () => {
    const r = normalizeMessage(
      msg({
        message: {
          extendedTextMessage: {
            text: "reply",
            contextInfo: {
              stanzaId: "QUOTED1",
              participant: "49999:3@s.whatsapp.net",
            },
          },
        },
      }),
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.text).toBe("reply");
    expect(r.message.quotedMessageId).toBe("QUOTED1");
    expect(r.message.quotedSenderJid).toBe("49999@s.whatsapp.net");
  });

  it("image caption sets hasMedia", () => {
    const r = normalizeMessage(
      msg({
        message: { imageMessage: { caption: "a pic", mimetype: "image/jpeg" } },
      }),
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.messageType).toBe("image");
    expect(r.message.text).toBe("a pic");
    expect(r.message.hasMedia).toBe(true);
  });

  it("document with no caption", () => {
    const r = normalizeMessage(
      msg({ message: { documentMessage: { fileName: "x.pdf" } } }),
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.messageType).toBe("document");
    expect(r.message.text).toBeNull();
    expect(r.message.hasMedia).toBe(true);
  });

  it("poll name (V3 and V5)", () => {
    for (const key of ["pollCreationMessageV3", "pollCreationMessageV5"]) {
      const r = normalizeMessage(
        msg({ message: { [key]: { name: "Lunch?" } } as never }),
      );
      expect(r.action).toBe("store");
      if (r.action !== "store") continue;
      expect(r.message.messageType).toBe("poll");
      expect(r.message.text).toBe("Lunch?");
    }
  });

  it("reaction references its target", () => {
    const r = normalizeMessage(
      msg({
        message: {
          reactionMessage: { text: "👍", key: { id: "TARGET1" } },
        },
      }),
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.messageType).toBe("reaction");
    expect(r.message.text).toBe("👍");
    expect(r.message.quotedMessageId).toBe("TARGET1");
  });

  it("group message resolves the participant as sender", () => {
    const r = normalizeMessage(
      msg({
        key: {
          remoteJid: "123-456@g.us",
          fromMe: false,
          id: "G1",
          participant: "49111:2@s.whatsapp.net",
        },
        message: { conversation: "in group" },
      }),
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.isGroup).toBe(true);
    expect(r.message.senderJid).toBe("49111@s.whatsapp.net");
  });

  it("unknown content type stores as unknown without inventing text", () => {
    const r = normalizeMessage(
      msg({ message: { someFutureMessage: { foo: 1 } } as never }),
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.messageType).toBe("unknown");
    expect(r.message.text).toBeNull();
  });
});

describe("normalizeMessage: protocol actions", () => {
  it("revoke targets the deleted message and carries the sender", () => {
    const r = normalizeMessage(
      msg({
        key: {
          remoteJid: "g@g.us",
          fromMe: false,
          id: "REV",
          participant: "49222:1@s.whatsapp.net",
        },
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.REVOKE,
            key: { id: "DELETED1" },
          },
        },
      }),
    );
    expect(r.action).toBe("revoke");
    if (r.action !== "revoke") return;
    expect(r.targetId).toBe("DELETED1");
    expect(r.senderJid).toBe("49222@s.whatsapp.net");
  });

  it("edit carries the new text and targets the original", () => {
    const r = normalizeMessage(
      msg({
        key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "EDIT_MSG" },
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: "ORIG1" },
            editedMessage: { conversation: "edited text" },
          },
        },
      }),
    );
    expect(r.action).toBe("edit");
    if (r.action !== "edit") return;
    expect(r.targetId).toBe("ORIG1");
    expect(r.editId).toBe("EDIT_MSG");
    expect(r.text).toBe("edited text");
  });

  it("other protocol messages are skipped", () => {
    const r = normalizeMessage(
      msg({
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.APP_STATE_SYNC_KEY_SHARE,
          },
        },
      }),
    );
    expect(r.action).toBe("skip");
  });
});

describe("normalizeReaction", () => {
  it("normalizes a reaction event into a reaction store", () => {
    const r = normalizeReaction(
      { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "TARGET9" },
      {
        text: "❤️",
        key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "RXN1" },
        senderTimestampMs: 1_700_000_000_000,
      },
    );
    expect(r.action).toBe("store");
    if (r.action !== "store") return;
    expect(r.message.messageType).toBe("reaction");
    expect(r.message.messageId).toBe("RXN1");
    expect(r.message.text).toBe("❤️");
    expect(r.message.quotedMessageId).toBe("TARGET9");
    expect(r.message.timestamp).toBe(1_700_000_000);
  });

  it("skips a reaction with no reaction key id", () => {
    const r = normalizeReaction(
      { remoteJid: "c@s.whatsapp.net", id: "T" },
      { text: "👍" },
    );
    expect(r.action).toBe("skip");
  });
});

describe("normalizeMessage: skips", () => {
  it("skips when the key is missing an id", () => {
    const r = normalizeMessage(
      msg({
        key: { remoteJid: "c@s.whatsapp.net" },
        message: { conversation: "x" },
      }),
    );
    expect(r.action).toBe("skip");
  });

  it("skips when there is no message content", () => {
    const r = normalizeMessage(msg({ message: null }));
    expect(r.action).toBe("skip");
  });
});
