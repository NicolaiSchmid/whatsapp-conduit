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
  getMessage,
  setChatAllowed,
  setChatBlocked,
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
