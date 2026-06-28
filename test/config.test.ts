import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("applies observe-only-safe defaults for an empty config", () => {
    const cfg = resolveConfig({}, { dataDir: "/data" });

    expect(cfg.privacy.observeOnly).toBe(true);
    expect(cfg.privacy.sendEnabled).toBe(false);
    expect(cfg.privacy.markRead).toBe(false);
    expect(cfg.privacy.storeMedia).toBe(false);
    expect(cfg.privacy.includeGroups).toBe(false);
    expect(cfg.privacy.includeStatus).toBe(false);

    expect(cfg.baileys.markOnlineOnConnect).toBe(false);
    expect(cfg.baileys.syncFullHistory).toBe(false);

    expect(cfg.logging.level).toBe("info");
    expect(cfg.logging.logMessageText).toBe(false);

    expect(cfg.exports.defaultFormat).toBe("jsonl");
  });

  it("derives paths from the data directory", () => {
    const cfg = resolveConfig({}, { dataDir: "/srv/wac" });
    expect(cfg.paths.dataDir).toBe("/srv/wac");
    expect(cfg.paths.sqlite).toBe("/srv/wac/whatsapp-conduit.db");
    expect(cfg.paths.authDir).toBe("/srv/wac/auth");
    expect(cfg.paths.mediaDir).toBe("/srv/wac/media");
  });

  it("resolves relative path overrides against the data dir", () => {
    const cfg = resolveConfig(
      { paths: { data_dir: "/srv/wac", sqlite: "db/main.db" } },
      {},
    );
    expect(cfg.paths.sqlite).toBe("/srv/wac/db/main.db");
  });

  it("honors an explicit data-dir override over the file value", () => {
    const cfg = resolveConfig(
      { paths: { data_dir: "/from/file" } },
      { dataDir: "/from/flag" },
    );
    expect(cfg.paths.dataDir).toBe("/from/flag");
  });

  it("reads filters and logging overrides", () => {
    const cfg = resolveConfig({
      filters: {
        allowed_chats: ["a@s.whatsapp.net"],
        blocked_chats: ["b@g.us"],
      },
      logging: { level: "debug", log_message_text: true },
    });
    expect(cfg.filters.allowedChats).toEqual(["a@s.whatsapp.net"]);
    expect(cfg.filters.blockedChats).toEqual(["b@g.us"]);
    expect(cfg.logging.level).toBe("debug");
    expect(cfg.logging.logMessageText).toBe(true);
  });

  it("rejects an invalid log level by falling back to info", () => {
    const cfg = resolveConfig({ logging: { level: "verbose" } });
    expect(cfg.logging.level).toBe("info");
  });

  it("throws when observe_only and send_enabled conflict", () => {
    expect(() =>
      resolveConfig({ privacy: { observe_only: true, send_enabled: true } }),
    ).toThrow(/mutually|cannot both/i);
  });
});
