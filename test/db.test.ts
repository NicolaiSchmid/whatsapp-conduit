import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDatabase } from "../src/db/check.js";
import { openDb } from "../src/db/index.js";
import {
  appliedMigrations,
  pendingMigrations,
  runMigrations,
} from "../src/db/migrations.js";
import {
  countMessages,
  getChat,
  getConsumerOffset,
  getMessage,
  setChatAllowed,
  setChatBlocked,
  setConsumerOffset,
  upsertAccount,
  upsertChat,
  upsertMessage,
} from "../src/db/queries.js";

function freshDb() {
  const db = openDb(":memory:", { migrate: true });
  upsertAccount(db, { id: "acct" });
  return db;
}

describe("migrations", () => {
  it("applies the initial migration once and is idempotent", () => {
    const db = openDb(":memory:", { migrate: false });
    const first = runMigrations(db);
    expect(first.applied).toContain("0001_initial.sql");
    expect(appliedMigrations(db)).toContain("0001_initial.sql");

    const second = runMigrations(db);
    expect(second.applied).toHaveLength(0);
    expect(pendingMigrations(db)).toHaveLength(0);
    db.close();
  });
});

describe("checkDatabase", () => {
  it("reports a freshly migrated database as healthy", () => {
    const db = freshDb();
    const result = checkDatabase(db);
    expect(result.ok).toBe(true);
    expect(result.integrity).toHaveLength(0);
    expect(result.foreignKeyViolations).toHaveLength(0);
    expect(result.pendingMigrations).toHaveLength(0);
    db.close();
  });
});

describe("idempotent message persistence", () => {
  it("does not duplicate on replay of the same message", () => {
    const db = freshDb();
    upsertChat(db, { accountId: "acct", jid: "c@s.whatsapp.net" });

    const msg = {
      accountId: "acct",
      chatJid: "c@s.whatsapp.net",
      messageId: "M1",
      senderJid: "c@s.whatsapp.net",
      timestamp: 1000,
      messageType: "text" as const,
      text: "hi",
    };
    upsertMessage(db, msg);
    upsertMessage(db, msg);

    expect(countMessages(db)).toBe(1);
    db.close();
  });

  it("refreshes mutable fields but preserves received_at on replay", () => {
    const db = freshDb();
    upsertChat(db, { accountId: "acct", jid: "c@s.whatsapp.net" });
    upsertMessage(db, {
      accountId: "acct",
      chatJid: "c@s.whatsapp.net",
      messageId: "M1",
      text: "hi",
    });
    const first = getMessage(db, "acct", "c@s.whatsapp.net", "M1");

    upsertMessage(db, {
      accountId: "acct",
      chatJid: "c@s.whatsapp.net",
      messageId: "M1",
      deletedAt: 2000,
    });
    const second = getMessage(db, "acct", "c@s.whatsapp.net", "M1");

    expect(second?.received_at).toBe(first?.received_at);
    expect(second?.text).toBe("hi"); // not clobbered by null
    expect(second?.deleted_at).toBe(2000);
    db.close();
  });

  it("rejects a message whose chat does not exist (foreign key)", () => {
    const db = freshDb();
    expect(() =>
      upsertMessage(db, {
        accountId: "acct",
        chatJid: "missing@s.whatsapp.net",
        messageId: "M1",
        text: "hi",
      }),
    ).toThrow();
    db.close();
  });
});

describe("partial-replay field preservation", () => {
  it("preserves has_media on a replay that omits it", () => {
    const db = freshDb();
    upsertChat(db, { accountId: "acct", jid: "c@s.whatsapp.net" });
    upsertMessage(db, {
      accountId: "acct",
      chatJid: "c@s.whatsapp.net",
      messageId: "M1",
      hasMedia: true,
    });
    // A revoke-style partial replay omits hasMedia.
    upsertMessage(db, {
      accountId: "acct",
      chatJid: "c@s.whatsapp.net",
      messageId: "M1",
      deletedAt: 2000,
    });
    expect(getMessage(db, "acct", "c@s.whatsapp.net", "M1")?.has_media).toBe(1);
    db.close();
  });

  it("preserves is_group/is_status and does not invent epoch-0 recency", () => {
    const db = freshDb();
    upsertChat(db, {
      accountId: "acct",
      jid: "g@g.us",
      isGroup: true,
      isStatus: false,
      lastMessageTs: 1500,
    });
    // Metadata-only refresh that omits classification and timestamp.
    upsertChat(db, { accountId: "acct", jid: "g@g.us", name: "Group" });
    const chat = getChat(db, "acct", "g@g.us");
    expect(chat?.is_group).toBe(1);
    expect(chat?.name).toBe("Group");
    expect(chat?.last_message_ts).toBe(1500);
    db.close();
  });

  it("advances a chat's last_message_ts monotonically", () => {
    const db = freshDb();
    upsertChat(db, {
      accountId: "acct",
      jid: "c@s.whatsapp.net",
      lastMessageTs: 100,
    });
    upsertChat(db, {
      accountId: "acct",
      jid: "c@s.whatsapp.net",
      lastMessageTs: 50,
    });
    expect(getChat(db, "acct", "c@s.whatsapp.net")?.last_message_ts).toBe(100);
    upsertChat(db, {
      accountId: "acct",
      jid: "c@s.whatsapp.net",
      lastMessageTs: 200,
    });
    expect(getChat(db, "acct", "c@s.whatsapp.net")?.last_message_ts).toBe(200);
    db.close();
  });
});

describe("consumer offsets", () => {
  it("preserves the other cursor on a partial advance", () => {
    const db = freshDb();
    setConsumerOffset(db, "hermes", {
      lastSeenTimestamp: 1000,
      lastSeenEventId: 5,
    });
    setConsumerOffset(db, "hermes", { lastSeenEventId: 9 });
    const row = getConsumerOffset(db, "hermes");
    expect(row?.last_seen_event_id).toBe(9);
    expect(row?.last_seen_timestamp).toBe(1000);
    db.close();
  });
});

describe("file database: read-only open and permissions", () => {
  it("opens read-only (no WAL write) and creates a 0600 db file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wac-db-"));
    const path = join(dir, "conduit.db");
    try {
      const db = openDb(path, { migrate: true });
      upsertAccount(db, { id: "acct" });
      upsertChat(db, { accountId: "acct", jid: "c@s.whatsapp.net" });
      db.close();

      // Owner-only permissions on the database file.
      expect(statSync(path).mode & 0o777).toBe(0o600);

      // Read-only open must not attempt the WAL pragma (which needs a write).
      const ro = openDb(path, { migrate: false, readonly: true });
      expect(getChat(ro, "acct", "c@s.whatsapp.net")).toBeDefined();
      ro.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chat policy flags", () => {
  it("allowing a chat clears the block flag and vice versa", () => {
    const db = freshDb();
    upsertChat(db, { accountId: "acct", jid: "c@s.whatsapp.net" });

    setChatBlocked(db, "acct", "c@s.whatsapp.net", true);
    expect(getChat(db, "acct", "c@s.whatsapp.net")?.is_blocked).toBe(1);

    setChatAllowed(db, "acct", "c@s.whatsapp.net", true);
    const chat = getChat(db, "acct", "c@s.whatsapp.net");
    expect(chat?.is_allowed).toBe(1);
    expect(chat?.is_blocked).toBe(0);
    db.close();
  });

  it("ingestion upserts never change policy flags", () => {
    const db = freshDb();
    upsertChat(db, { accountId: "acct", jid: "c@s.whatsapp.net" });
    setChatAllowed(db, "acct", "c@s.whatsapp.net", true);

    upsertChat(db, {
      accountId: "acct",
      jid: "c@s.whatsapp.net",
      name: "Renamed",
    });
    const chat = getChat(db, "acct", "c@s.whatsapp.net");
    expect(chat?.is_allowed).toBe(1);
    expect(chat?.name).toBe("Renamed");
    db.close();
  });
});
