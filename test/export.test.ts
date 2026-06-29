import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runExport, type ExportRecord } from "../src/commands/export.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/index.js";
import {
  getConsumerOffset,
  setChatAllowed,
  setChatBlocked,
  upsertAccount,
  upsertChat,
  upsertMessage,
} from "../src/db/queries.js";

let dir: string;
let configPath: string;
let stdout: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wac-export-"));
  configPath = join(dir, "config.yaml");
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  runInit({ configPath, dataDir: join(dir, "data") });
  stdout = []; // discard init output
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const config = loadConfig(configPath);
  const db = openDb(config.paths.sqlite);
  upsertAccount(db, { id: config.account.name });
  upsertChat(db, { accountId: config.account.name, jid: "a@s.whatsapp.net" });
  upsertChat(db, { accountId: config.account.name, jid: "b@s.whatsapp.net" });
  setChatAllowed(db, config.account.name, "a@s.whatsapp.net", true);
  for (let i = 1; i <= 3; i++) {
    upsertMessage(db, {
      accountId: config.account.name,
      chatJid: "a@s.whatsapp.net",
      messageId: `A${i}`,
      senderJid: "49123@s.whatsapp.net",
      timestamp: 1000 + i,
      text: `allowed ${i}`,
    });
  }
  upsertMessage(db, {
    accountId: config.account.name,
    chatJid: "b@s.whatsapp.net",
    messageId: "B1",
    timestamp: 2000,
    text: "not allowed",
  });
  db.close();
}

function records(): ExportRecord[] {
  return stdout
    .join("")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ExportRecord);
}

describe("runExport", () => {
  it("defaults to allowed-only (does not leak non-allowed chats)", () => {
    seed();
    const result = runExport({ configPath });
    expect(result.count).toBe(3);
    const recs = records();
    expect(recs.every((r) => r.chat_jid === "a@s.whatsapp.net")).toBe(true);
  });

  it("--all includes non-allowed chats, in ascending cursor order", () => {
    seed();
    const result = runExport({ configPath, all: true });
    expect(result.count).toBe(4);
    const recs = records();
    expect(recs.map((r) => r.message_id)).toEqual(["A1", "A2", "A3", "B1"]);
    expect(recs.map((r) => r.cursor)).toEqual(
      [...recs.map((r) => r.cursor)].sort((x, y) => x - y),
    );
  });

  it("never exports a chat blocked via the DB flag, even with --all", () => {
    seed();
    const config = loadConfig(configPath);
    const db = openDb(config.paths.sqlite);
    setChatBlocked(db, config.account.name, "b@s.whatsapp.net", true);
    db.close();

    runExport({ configPath, all: true });
    const recs = records();
    expect(recs.every((r) => r.chat_jid !== "b@s.whatsapp.net")).toBe(true);
  });

  it("--redact-phone-numbers redacts sender JIDs", () => {
    seed();
    runExport({ configPath, redactPhoneNumbers: true });
    const recs = records();
    const dm = recs.find((r) => r.message_id === "A1");
    expect(dm?.sender_jid).toMatch(/^redacted-/);
    expect(JSON.stringify(recs)).not.toContain("49123@s.whatsapp.net");
  });

  it("rejects --redact-phone-numbers combined with --include-raw-json", () => {
    seed();
    expect(() =>
      runExport({ configPath, redactPhoneNumbers: true, includeRawJson: true }),
    ).toThrow(/raw/i);
  });

  it("two-phase: --since-last does not advance offset without --commit", () => {
    seed();
    const first = runExport({ configPath, sinceLast: "hermes", all: true });
    expect(first.count).toBe(4);
    expect(first.committed).toBe(false);

    const config = loadConfig(configPath);
    const ro = openDb(config.paths.sqlite, { migrate: false, readonly: true });
    expect(getConsumerOffset(ro, "hermes")).toBeUndefined();
    ro.close();
  });

  it("--since-last --commit advances the offset and resumes after it", () => {
    seed();
    const first = runExport({
      configPath,
      sinceLast: "hermes",
      all: true,
      commit: true,
    });
    expect(first.count).toBe(4);
    expect(first.committed).toBe(true);

    stdout = [];
    const second = runExport({
      configPath,
      sinceLast: "hermes",
      all: true,
      commit: true,
    });
    expect(second.count).toBe(0);
  });
});
