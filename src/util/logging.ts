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
 * Field paths that may carry WhatsApp message content. Redacted unless the
 * operator explicitly sets `logging.log_message_text: true`.
 */
const REDACT_PATHS = [
  "text",
  "caption",
  "body",
  "conversation",
  "message",
  "*.text",
  "*.caption",
  "*.body",
  "*.conversation",
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
