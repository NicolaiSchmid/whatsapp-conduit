/**
 * Time helpers. All conduit timestamps are stored as epoch **seconds** to match
 * WhatsApp's `messageTimestamp` and to keep `--since` comparisons simple.
 */

/** Current time as epoch seconds. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 60 * 60 * 24,
  w: 60 * 60 * 24 * 7,
} as const;

type DurationUnit = keyof typeof DURATION_UNITS;

const DURATION_RE = /^(\d+)\s*([smhdw])$/;

/**
 * Parse a duration like `24h`, `30m`, `7d` into seconds.
 * Throws on malformed input rather than guessing.
 */
export function parseDurationSec(value: string): number {
  const match = DURATION_RE.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Expected a number followed by s, m, h, d, or w (e.g. "24h").`,
    );
  }
  const amount = Number(match[1]);
  const unit = match[2] as DurationUnit;
  return amount * DURATION_UNITS[unit];
}

/**
 * Resolve a `--since` value to an inclusive lower-bound epoch-seconds threshold.
 *
 * Supported forms:
 * - relative duration: `24h`, `7d`, `30m`
 * - absolute epoch seconds: a bare integer
 * - ISO-8601 datetime with an explicit timezone: `2026-06-28T00:00:00Z`
 *
 * A datetime that carries a clock time but no timezone (e.g.
 * `2026-06-28T00:00:00`) is rejected: `Date.parse` would interpret it in the
 * host's local timezone, making exports non-deterministic across machines. A
 * bare ISO date (`2026-06-28`) is allowed — ISO 8601 fixes it to UTC midnight.
 */
const HAS_CLOCK_TIME_RE = /[T ]\d{2}:\d{2}/;
const HAS_TIMEZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/;

export function parseSinceSec(value: string, now: number = nowSec()): number {
  const trimmed = value.trim();

  if (DURATION_RE.test(trimmed)) {
    return now - parseDurationSec(trimmed);
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (HAS_CLOCK_TIME_RE.test(trimmed) && !HAS_TIMEZONE_RE.test(trimmed)) {
    throw new Error(
      `Ambiguous --since datetime "${value}": include a timezone (e.g. "${trimmed}Z" or an explicit offset). ` +
        "Timezone-less datetimes are interpreted in the host timezone and make exports non-deterministic.",
    );
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }

  throw new Error(
    `Invalid --since value "${value}". Expected a duration (e.g. "24h"), epoch seconds, or a timezone-aware ISO-8601 datetime.`,
  );
}
