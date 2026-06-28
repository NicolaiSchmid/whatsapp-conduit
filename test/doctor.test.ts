import { describe, expect, it } from "vitest";
import { buildDoctorReport } from "../src/commands/doctor.js";

describe("buildDoctorReport", () => {
  it("reports a missing config as not found", () => {
    const report = buildDoctorReport("/nonexistent/path/config.yaml");
    expect(report.name).toBe("whatsapp-conduit");
    expect(report.configExists).toBe(false);
    expect(report.node).toBe(process.version);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("detects an existing config file", () => {
    const report = buildDoctorReport(
      new URL("../package.json", import.meta.url).pathname,
    );
    expect(report.configExists).toBe(true);
  });
});
