import { describe, expect, it } from "vitest";
import { proto, type WAMessage } from "baileys";
import { resolveConfig, type Config } from "../src/config.js";
import {
  ingestMessage,
  ingestReaction,
  type IngestDeps,
} from "../src/baileys/ingest.js";
import { openDb } from "../src/db/index.js";
import {
  countMessages,
  getChat,
  getMessage,
  setChatBlocked,
  upsertAccount,
} from "../src/db/queries.js";
import { createLogger } from "../src/util/logging.js";

function deps(config: Config): IngestDeps {
  const db = openDb(":memory:", { migrate: true });
  upsertAccount(db, { id: "personal" });
  return {
    db,
    accountId: "personal",
    config,
    logger: createLogger({ level: "error" }),
  };
}

function msg(overrides: Partial<WAMessage>): WAMessage {
  return {
    key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "M1" },
    messageTimestamp: 1700,
    pushName: "Alice",
    ...overrides,
  } as WAMessage;
}

const baseConfig = resolveConfig({}, { dataDir: "/data" });

describe("ingestMessage persistence", () => {
  it("stores a text message with chat, sender, and metadata", () => {
    const d = deps(baseConfig);
    ingestMessage(d, msg({ message: { conversation: "hi there" } }));

    expect(countMessages(d.db)).toBe(1);
    const row = getMessage(d.db, "personal", "c@s.whatsapp.net", "M1");
    expect(row?.text).toBe("hi there");
    expect(row?.message_type).toBe("text");
    const chat = getChat(d.db, "personal", "c@s.whatsapp.net");
    expect(chat?.last_message_ts).toBe(1700);
    expect(chat?.push_name).toBe("Alice");
    d.db.close();
  });

  it("is idempotent on repeated delivery", () => {
    const d = deps(baseConfig);
    const m = msg({ message: { conversation: "dup" } });
    ingestMessage(d, m);
    ingestMessage(d, m);
    expect(countMessages(d.db)).toBe(1);
    d.db.close();
  });

  it("does not store text when store_message_text is false", () => {
    const d = deps(
      resolveConfig(
        { privacy: { store_message_text: false } },
        { dataDir: "/data" },
      ),
    );
    ingestMessage(d, msg({ message: { conversation: "secret" } }));
    const row = getMessage(d.db, "personal", "c@s.whatsapp.net", "M1");
    expect(row).toBeDefined();
    expect(row?.text).toBeNull();
    expect(row?.normalized_text).toBeNull();
    expect(row?.message_type).toBe("text");
    // store_message_text=false is authoritative: raw_json (which contains text)
    // is suppressed too, even though store_raw_json defaults true.
    expect(row?.raw_json).toBeNull();
    d.db.close();
  });

  it("excludes group messages by default and stores them when enabled", () => {
    const group = msg({
      key: {
        remoteJid: "g@g.us",
        fromMe: false,
        id: "G1",
        participant: "49a@s.whatsapp.net",
      },
      message: { conversation: "group msg" },
    });

    const off = deps(baseConfig);
    ingestMessage(off, group);
    expect(countMessages(off.db)).toBe(0);
    off.db.close();

    const on = deps(
      resolveConfig(
        { privacy: { include_groups: true } },
        { dataDir: "/data" },
      ),
    );
    ingestMessage(on, group);
    expect(countMessages(on.db)).toBe(1);
    on.db.close();
  });

  it("skips a blocked chat and records an audited ignored event", () => {
    const d = deps(
      resolveConfig(
        { filters: { blocked_chats: ["c@s.whatsapp.net"] } },
        { dataDir: "/data" },
      ),
    );
    ingestMessage(d, msg({ message: { conversation: "topsecretbody" } }));
    expect(countMessages(d.db)).toBe(0);
    const events = d.db
      .prepare("select event_type, raw_json from events")
      .all() as Array<{ event_type: string; raw_json: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("ignored");
    // The ignored-event marker never contains message text.
    expect(events[0]?.raw_json).not.toContain("topsecretbody");
    d.db.close();
  });

  it("applies a revoke as a tombstone on the target message", () => {
    const d = deps(baseConfig);
    ingestMessage(d, msg({ message: { conversation: "will be deleted" } }));
    ingestMessage(
      d,
      msg({
        key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "REVOKE_EVT" },
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.REVOKE,
            key: { id: "M1" },
          },
        },
      }),
    );
    const row = getMessage(d.db, "personal", "c@s.whatsapp.net", "M1");
    expect(row?.deleted_at).not.toBeNull();
    // Original text is preserved as a tombstone record.
    expect(row?.text).toBe("will be deleted");
    d.db.close();
  });

  it("honors a chat blocked via `chats block` (DB flag) at sync", () => {
    const d = deps(baseConfig);
    // Discover the chat, then block it via the DB policy flag.
    ingestMessage(d, msg({ message: { conversation: "first" } }));
    expect(countMessages(d.db)).toBe(1);
    setChatBlocked(d.db, "personal", "c@s.whatsapp.net", true);

    ingestMessage(
      d,
      msg({
        key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "M2" },
        message: { conversation: "after block" },
      }),
    );
    expect(
      getMessage(d.db, "personal", "c@s.whatsapp.net", "M2"),
    ).toBeUndefined();
    d.db.close();
  });

  it("ingests a reaction from the messages.reaction event", () => {
    const d = deps(baseConfig);
    ingestMessage(d, msg({ message: { conversation: "react to me" } }));
    ingestReaction(
      d,
      { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "M1" },
      {
        text: "🔥",
        key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "RXN" },
      },
    );
    const r = getMessage(d.db, "personal", "c@s.whatsapp.net", "RXN");
    expect(r?.message_type).toBe("reaction");
    expect(r?.text).toBe("🔥");
    expect(r?.quoted_message_id).toBe("M1");
    d.db.close();
  });

  it("applies the sender filter to edits (blocked sender can't edit)", () => {
    const d = deps(
      resolveConfig(
        {
          privacy: { include_groups: true },
          filters: { blocked_senders: ["49bad@s.whatsapp.net"] },
        },
        { dataDir: "/data" },
      ),
    );
    // Edit from a blocked group participant must not write text.
    ingestMessage(
      d,
      msg({
        key: {
          remoteJid: "g@g.us",
          fromMe: false,
          id: "EVT",
          participant: "49bad@s.whatsapp.net",
        },
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: "ORIG" },
            editedMessage: { conversation: "sneaky edit" },
          },
        },
      }),
    );
    expect(getMessage(d.db, "personal", "g@g.us", "ORIG")).toBeUndefined();
    d.db.close();
  });

  it("applies an edit to the original message", () => {
    const d = deps(baseConfig);
    ingestMessage(d, msg({ message: { conversation: "original" } }));
    ingestMessage(
      d,
      msg({
        key: { remoteJid: "c@s.whatsapp.net", fromMe: false, id: "EDIT_EVT" },
        message: {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: "M1" },
            editedMessage: { conversation: "edited" },
          },
        },
      }),
    );
    const row = getMessage(d.db, "personal", "c@s.whatsapp.net", "M1");
    expect(row?.text).toBe("edited");
    expect(row?.edited_message_id).toBe("EDIT_EVT");
    d.db.close();
  });
});
