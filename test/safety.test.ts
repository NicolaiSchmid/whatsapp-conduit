import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map((e) => (typeof e === "string" ? e : String(e)))
    .filter((f) => f.endsWith(".ts"));
}

/**
 * The observe-only posture is a hard invariant: ingestion/connection code must
 * never call WhatsApp mutation APIs. This guards against accidentally wiring up
 * a send/read/presence path in any future change.
 */
const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "sendMessage", re: /\.sendMessage\s*\(/ },
  { label: "readMessages", re: /\.readMessages\s*\(/ },
  { label: "sendReadReceipt", re: /\.sendReadReceipt\s*\(/ },
  { label: "sendReceipts", re: /\.sendReceipts\s*\(/ },
  { label: "chatModify", re: /\.chatModify\s*\(/ },
  { label: "sendPresenceUpdate", re: /\.sendPresenceUpdate\s*\(/ },
];

describe("observe-only safety invariants", () => {
  it("source never calls WhatsApp send/read/presence APIs", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(`${SRC_DIR}/${file}`, "utf8");
      for (const { label, re } of FORBIDDEN) {
        if (re.test(content)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
