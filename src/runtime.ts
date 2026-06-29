import type { Logger } from "pino";
import type { Config } from "./config.js";
import { defaultConfigPath } from "./paths.js";
import { contentSafeLevel, createLogger } from "./util/logging.js";

/** Resolve the effective config path from a CLI `--config` override. */
export function resolveConfigPath(configPath?: string): string {
  return configPath ?? defaultConfigPath();
}

/** Application logger honoring the configured level and redaction policy. */
export function appLogger(config: Config): Logger {
  return createLogger({
    level: config.logging.level,
    logMessageText: config.logging.logMessageText,
  });
}

/**
 * Logger handed to Baileys. Always clamped to `warn`+ and always redacted,
 * independent of `logging.log_message_text`: Baileys emits decrypted message
 * content at debug/trace AND handshake/device-pairing **key material** at info,
 * so enabling app-level message-text logging must never unmask Baileys' auth
 * secrets. Message text we want is captured via storage, not Baileys logs.
 */
export function baileysLogger(config: Config): Logger {
  return createLogger({
    level: contentSafeLevel(config.logging.level, false),
    logMessageText: false,
  });
}
