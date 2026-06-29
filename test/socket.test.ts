import { describe, expect, it } from "vitest";
import { resolveConfig, type Config } from "../src/config.js";
import type { AuthState } from "../src/baileys/auth.js";
import { buildSocketConfig } from "../src/baileys/socket.js";
import { createLogger } from "../src/util/logging.js";

function fakeAuthState(): AuthState {
  return {
    state: {
      creds: {},
      keys: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    saveCreds: async () => {},
  } as unknown as AuthState;
}

function build(config: Config) {
  return buildSocketConfig({
    config,
    authState: fakeAuthState(),
    version: [2, 3000, 0],
    logger: createLogger({ level: "error" }),
  });
}

describe("buildSocketConfig observe-only invariants", () => {
  it("never marks online or requests full history by default", () => {
    const cfg = build(resolveConfig({}, { dataDir: "/data" }));
    expect(cfg.markOnlineOnConnect).toBe(false);
    expect(cfg.syncFullHistory).toBe(false);
  });

  it("does not override shouldSyncHistoryMessage (avoids LID-mapping issues)", () => {
    const cfg = build(resolveConfig({}, { dataDir: "/data" }));
    expect(cfg.shouldSyncHistoryMessage).toBeUndefined();
  });

  it("omits version when not provided (uses Baileys' bundled version)", () => {
    const cfg = buildSocketConfig({
      config: resolveConfig({}, { dataDir: "/data" }),
      authState: fakeAuthState(),
      logger: createLogger({ level: "error" }),
    });
    expect(cfg.version).toBeUndefined();
  });

  it("getMessage is a no-op (no resend support)", async () => {
    const cfg = build(resolveConfig({}, { dataDir: "/data" }));
    const result = await cfg.getMessage?.({} as never);
    expect(result).toBeUndefined();
  });

  it("requests full history only when explicitly enabled", () => {
    const cfg = build(
      resolveConfig(
        { baileys: { sync_full_history: true } },
        { dataDir: "/data" },
      ),
    );
    expect(cfg.syncFullHistory).toBe(true);
  });
});
