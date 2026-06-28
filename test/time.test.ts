import { describe, expect, it } from "vitest";
import { nowSec, parseDurationSec, parseSinceSec } from "../src/util/time.js";

describe("parseDurationSec", () => {
  it("parses each unit", () => {
    expect(parseDurationSec("30s")).toBe(30);
    expect(parseDurationSec("5m")).toBe(300);
    expect(parseDurationSec("24h")).toBe(86_400);
    expect(parseDurationSec("7d")).toBe(604_800);
    expect(parseDurationSec("2w")).toBe(1_209_600);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDurationSec("  12h ")).toBe(43_200);
  });

  it("throws on malformed input", () => {
    expect(() => parseDurationSec("soon")).toThrow();
    expect(() => parseDurationSec("10")).toThrow();
    expect(() => parseDurationSec("10y")).toThrow();
  });
});

describe("parseSinceSec", () => {
  const now = 1_700_000_000;

  it("resolves a relative duration against now", () => {
    expect(parseSinceSec("24h", now)).toBe(now - 86_400);
  });

  it("accepts bare epoch seconds", () => {
    expect(parseSinceSec("1699990000", now)).toBe(1_699_990_000);
  });

  it("accepts ISO-8601 datetimes", () => {
    expect(parseSinceSec("2023-11-14T22:13:20Z", now)).toBe(1_700_000_000);
  });

  it("throws on garbage", () => {
    expect(() => parseSinceSec("yesterday", now)).toThrow();
  });
});

describe("nowSec", () => {
  it("returns a plausible epoch-seconds value", () => {
    const t = nowSec();
    expect(t).toBeGreaterThan(1_600_000_000);
    expect(Number.isInteger(t)).toBe(true);
  });
});
