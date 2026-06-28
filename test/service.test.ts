import { describe, expect, it } from "vitest";
import { renderServiceUnit } from "../src/commands/service.js";

describe("renderServiceUnit", () => {
  it("renders a valid systemd unit with the given exec/working dir", () => {
    const unit = renderServiceUnit({
      execStart: "/usr/bin/node /opt/wac/dist/cli.js --config /c.yaml run",
      workingDirectory: "/var/lib/wac",
    });
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/wac/dist/cli.js --config /c.yaml run",
    );
    expect(unit).toContain("WorkingDirectory=/var/lib/wac");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("WantedBy=default.target");
  });
});
