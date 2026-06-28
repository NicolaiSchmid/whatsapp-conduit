import {
  pino,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const satisfies readonly LogLevel[];

export interface LoggerConfig {
  level?: LogLevel;
  /**
   * When false (the default), message-text-like fields are redacted from log
   * records as a defense-in-depth guard. Ingestion code must still avoid
   * passing message text to the logger in the first place.
   */
  logMessageText?: boolean;
}

/**
 * Field paths that may carry WhatsApp message content, redacted unless the
 * operator explicitly sets `logging.log_message_text: true`.
 *
 * Two layers of defense-in-depth (the primary guard is simply never passing
 * raw payloads to the logger):
 *  - scalar leaf keys (`text`, `caption`, ...) at the root and one wrapper deep
 *  - whole content containers censored wholesale at the root and one wrapper
 *    deep — censoring the container removes every nested Baileys field beneath
 *    it (e.g. `message.extendedTextMessage.text`) regardless of its depth,
 *    which point wildcards cannot reach. Both the camelCase (`rawJson`) and the
 *    persisted snake_case (`raw_json`) forms of the raw payload are covered,
 *    since DB rows carry the latter.
 *  - per-element coverage for Baileys batch arrays (`messages.upsert` emits
 *    `{ messages: [{ message: {...} }] }`): each array element's content
 *    container is censored, at the root and one wrapper deep.
 *
 * `msg` is intentionally NOT redacted: pino stores the log message string there.
 */
const CONTENT_LEAF_KEYS = ["text", "caption", "body", "conversation"] as const;
const CONTENT_CONTAINER_KEYS = [
  "message",
  "raw",
  "rawJson",
  "raw_json",
] as const;
/** Array-valued wrappers whose elements each carry a content container. */
const ARRAY_WRAPPER_KEYS = ["messages"] as const;

const REDACT_PATHS = [
  ...CONTENT_LEAF_KEYS,
  ...CONTENT_LEAF_KEYS.map((k) => `*.${k}`),
  ...CONTENT_CONTAINER_KEYS,
  ...CONTENT_CONTAINER_KEYS.map((k) => `*.${k}`),
  ...ARRAY_WRAPPER_KEYS.flatMap((arr) =>
    CONTENT_CONTAINER_KEYS.flatMap((k) => [
      `${arr}[*].${k}`,
      `*.${arr}[*].${k}`,
    ]),
  ),
] as const;

export function createLogger(
  config: LoggerConfig = {},
  destination?: DestinationStream,
): Logger {
  const { level = "info", logMessageText = false } = config;

  const options: LoggerOptions = {
    level,
    base: { name: "whatsapp-conduit" },
  };

  if (!logMessageText) {
    options.redact = {
      paths: [...REDACT_PATHS],
      censor: "[redacted]",
    };
  }

  return destination ? pino(options, destination) : pino(options);
}

export const redactPathsForTest = REDACT_PATHS;
