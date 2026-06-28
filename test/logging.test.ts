import { describe, expect, it } from "vitest";
import type { DestinationStream } from "pino";
import { createLogger } from "../src/util/logging.js";

function captureLogger(logMessageText: boolean) {
  const records: Array<Record<string, unknown>> = [];
  const stream: DestinationStream = {
    write(chunk: string) {
      records.push(JSON.parse(chunk) as Record<string, unknown>);
    },
  };
  const logger = createLogger({ level: "info", logMessageText }, stream);
  return { logger, records };
}

describe("createLogger redaction", () => {
  it("redacts message-text fields by default", () => {
    const { logger, records } = captureLogger(false);
    logger.info({ chatJid: "123@s.whatsapp.net", text: "secret plans" }, "msg");

    expect(records).toHaveLength(1);
    expect(records[0]?.text).toBe("[redacted]");
    expect(records[0]?.chatJid).toBe("123@s.whatsapp.net");
  });

  it("redacts nested caption/body/conversation fields", () => {
    const { logger, records } = captureLogger(false);
    logger.info({ payload: { caption: "hi", body: "yo" } }, "nested");

    const payload = records[0]?.payload as Record<string, unknown>;
    expect(payload.caption).toBe("[redacted]");
    expect(payload.body).toBe("[redacted]");
  });

  it("censors a whole Baileys message container, including deep text", () => {
    const records: Array<Record<string, unknown>> = [];
    const stream = {
      write(chunk: string) {
        records.push(JSON.parse(chunk) as Record<string, unknown>);
      },
    };
    const logger = createLogger({ logMessageText: false }, stream);

    // Realistic deep Baileys shape wrapped under an arbitrary key.
    logger.info(
      {
        event: {
          message: { extendedTextMessage: { text: "secret deep text" } },
        },
      },
      "wrapped",
    );

    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("secret deep text");
    const event = records[0]?.event as Record<string, unknown>;
    expect(event.message).toBe("[redacted]");
  });

  it("censors persisted snake_case raw_json payloads", () => {
    const { logger, records } = captureLogger(false);
    logger.info(
      { row: { message_id: "M1", raw_json: '{"conversation":"secret"}' } },
      "row",
    );
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("secret");
    const row = records[0]?.row as Record<string, unknown>;
    expect(row.raw_json).toBe("[redacted]");
    expect(row.message_id).toBe("M1");
  });

  it("censors content in Baileys messages.upsert arrays", () => {
    const { logger, records } = captureLogger(false);
    logger.info(
      {
        type: "notify",
        messages: [
          { key: { id: "M1" }, message: { conversation: "secret one" } },
          {
            key: { id: "M2" },
            message: { extendedTextMessage: { text: "secret two" } },
          },
        ],
      },
      "upsert",
    );
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("secret one");
    expect(serialized).not.toContain("secret two");
    // Non-content metadata is preserved.
    expect(serialized).toContain("M1");
    expect(records[0]?.type).toBe("notify");
  });

  it("retains message text only when explicitly enabled", () => {
    const { logger, records } = captureLogger(true);
    logger.info({ text: "secret plans" }, "msg");
    expect(records[0]?.text).toBe("secret plans");
  });
});
