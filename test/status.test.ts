import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";
import { buildStatusReport } from "../src/commands/status.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import {
  setChatAllowed,
  upsertAccount,
  upsertChat,
  upsertMessage,
} from "../src/db/queries.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wac-status-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("buildStatusReport", () => {
  it("reports counts and observe-only posture from the database", () => {
    const configPath = join(dir, "config.yaml");
    runInit({ configPath, dataDir: join(dir, "data") });

    const config = loadConfig(configPath);
    const db = openDb(config.paths.sqlite);
    upsertAccount(db, { id: "personal", selfJid: "49123@s.whatsapp.net" });
    upsertChat(db, { accountId: "personal", jid: "c@s.whatsapp.net" });
    setChatAllowed(db, "personal", "c@s.whatsapp.net", true);
    upsertMessage(db, {
      accountId: "personal",
      chatJid: "c@s.whatsapp.net",
      messageId: "M1",
      timestamp: 1700,
      text: "hi",
    });
    db.close();

    const report = buildStatusReport(configPath);
    expect(report.databaseExists).toBe(true);
    expect(report.authLinked).toBe(false);
    expect(report.observeOnly).toBe(true);
    expect(report.sendEnabled).toBe(false);
    expect(report.accounts).toEqual([
      { id: "personal", selfJid: "49123@s.whatsapp.net", phoneNumber: null },
    ]);
    expect(report.chats).toBe(1);
    expect(report.allowedChats).toBe(1);
    expect(report.messages).toBe(1);
    expect(report.latestMessageTs).toBe(1700);
  });
});
