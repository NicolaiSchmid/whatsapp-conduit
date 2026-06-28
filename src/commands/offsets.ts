import { loadConfig } from "../config.js";
import { openDb } from "../db/index.js";
import { getConsumerOffset, setConsumerOffset } from "../db/queries.js";
import { resolveConfigPath } from "../runtime.js";

export interface OffsetsCommitOptions {
  configPath?: string;
  through: number;
  timestamp?: number;
}

/**
 * Advance a consumer's offset to a cursor obtained from a prior
 * `export --since-last`. This is the commit half of the two-phase export.
 */
export function runOffsetsCommit(
  consumer: string,
  options: OffsetsCommitOptions,
): void {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const db = openDb(config.paths.sqlite, { migrate: false });
  try {
    setConsumerOffset(db, consumer, {
      lastSeenEventId: options.through,
      lastSeenTimestamp: options.timestamp ?? null,
    });
    process.stdout.write(
      `Committed offset for "${consumer}" through cursor ${options.through}.\n`,
    );
  } finally {
    db.close();
  }
}

export interface OffsetsShowOptions {
  configPath?: string;
  json?: boolean;
}

export function runOffsetsShow(
  consumer: string,
  options: OffsetsShowOptions = {},
): number {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const db = openDb(config.paths.sqlite, { migrate: false, readonly: true });
  try {
    const row = getConsumerOffset(db, consumer);
    if (!row) {
      if (options.json) {
        process.stdout.write("null\n");
      } else {
        process.stderr.write(`No offset for consumer "${consumer}".\n`);
      }
      return 1;
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${consumer}: cursor=${row.last_seen_event_id ?? "—"} ` +
          `timestamp=${row.last_seen_timestamp ?? "—"}\n`,
      );
    }
    return 0;
  } finally {
    db.close();
  }
}
