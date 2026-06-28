import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runDbCheck, runDbMigrate } from "../src/commands/db.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wac-init-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  it("creates config, directories, and a migrated database", () => {
    const configPath = join(dir, "config.yaml");
    const dataDir = join(dir, "data");

    const report = runInit({ configPath, dataDir });

    expect(report.configCreated).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(dataDir, "auth"))).toBe(true);
    expect(existsSync(join(dataDir, "media"))).toBe(true);
    expect(existsSync(report.sqlite)).toBe(true);
    expect(report.migrationsApplied).toContain("0001_initial.sql");

    // Default config keeps observe-only posture.
    const body = readFileSync(configPath, "utf8");
    expect(body).toContain("observe_only: true");
    expect(body).toContain("send_enabled: false");
  });

  it("is idempotent and leaves an existing config in place", () => {
    const configPath = join(dir, "config.yaml");
    const dataDir = join(dir, "data");

    runInit({ configPath, dataDir });
    const second = runInit({ configPath, dataDir });

    expect(second.configCreated).toBe(false);
    expect(second.migrationsApplied).toHaveLength(0);
  });
});

describe("db migrate / check", () => {
  it("migrate is a no-op after init and check reports OK", () => {
    const configPath = join(dir, "config.yaml");
    const dataDir = join(dir, "data");
    runInit({ configPath, dataDir });

    const migrate = runDbMigrate({ configPath });
    expect(migrate.applied).toHaveLength(0);
    expect(migrate.alreadyApplied).toContain("0001_initial.sql");

    expect(runDbCheck({ configPath })).toBe(0);
  });
});
