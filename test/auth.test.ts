import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authStateExists, openAuthState } from "../src/baileys/auth.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wac-auth-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openAuthState permissions", () => {
  it("creates the auth directory owner-only and tightens key files", async () => {
    const authDir = join(dir, "auth");
    await openAuthState(authDir);
    expect(statSync(authDir).mode & 0o777).toBe(0o700);

    // A pre-existing creds file is tightened on next open.
    writeFileSync(join(authDir, "creds.json"), "{}", { mode: 0o644 });
    await openAuthState(authDir);
    expect(statSync(join(authDir, "creds.json")).mode & 0o777).toBe(0o600);
  });

  it("treats an authenticated (me.id) creds.json as a linked session", async () => {
    const authDir = join(dir, "auth");
    await openAuthState(authDir);
    const creds = join(authDir, "creds.json");

    expect(authStateExists(authDir)).toBe(false);
    // Aborted/stale auth: file present but no authenticated identity yet.
    writeFileSync(creds, JSON.stringify({ registered: false }));
    expect(authStateExists(authDir)).toBe(false);
    // Malformed creds are not a session either.
    writeFileSync(creds, "not json");
    expect(authStateExists(authDir)).toBe(false);
    // QR-linked session: me.id present even though registered stays false
    // (Baileys v7 sets me from pair-success but leaves registered false).
    writeFileSync(
      creds,
      JSON.stringify({
        registered: false,
        me: { id: "49123:1@s.whatsapp.net" },
      }),
    );
    expect(authStateExists(authDir)).toBe(true);
  });
});
