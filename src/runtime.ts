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
 * Logger handed to Baileys. Level is clamped to `info`+ unless message text is
 * explicitly enabled, so Baileys' own debug logging cannot leak content.
 */
export function baileysLogger(config: Config): Logger {
  return createLogger({
    level: contentSafeLevel(
      config.logging.level,
      config.logging.logMessageText,
    ),
    logMessageText: config.logging.logMessageText,
  });
}
