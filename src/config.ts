import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { defaultDataDir } from "./paths.js";
import { LOG_LEVELS, type LogLevel } from "./util/logging.js";

export type ExportFormat = "jsonl";

export interface AccountConfig {
  name: string;
  description?: string;
}

export interface PathsConfig {
  dataDir: string;
  sqlite: string;
  authDir: string;
  mediaDir: string;
}

export interface BaileysConfig {
  printQrInTerminal: boolean;
  syncFullHistory: boolean;
  markOnlineOnConnect: boolean;
  browserName: string;
}

export interface PrivacyConfig {
  observeOnly: boolean;
  sendEnabled: boolean;
  markRead: boolean;
  storeMessageText: boolean;
  storeRawJson: boolean;
  storeMedia: boolean;
  includeGroups: boolean;
  includeStatus: boolean;
}

export interface FiltersConfig {
  allowedChats: string[];
  blockedChats: string[];
  allowedSenders: string[];
  blockedSenders: string[];
}

export interface ExportsConfig {
  defaultFormat: ExportFormat;
  redactPhoneNumbers: boolean;
  includeRawJson: boolean;
}

export interface LoggingConfig {
  level: LogLevel;
  logMessageText: boolean;
}

export interface Config {
  account: AccountConfig;
  paths: PathsConfig;
  baileys: BaileysConfig;
  privacy: PrivacyConfig;
  filters: FiltersConfig;
  exports: ExportsConfig;
  logging: LoggingConfig;
}

/** Options that influence how a raw config is resolved into a full {@link Config}. */
export interface ResolveOptions {
  /** Override the data directory (e.g. from `init --data-dir`). */
  dataDir?: string;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asLogLevel(value: unknown, fallback: LogLevel): LogLevel {
  return LOG_LEVELS.includes(value as LogLevel)
    ? (value as LogLevel)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(
  raw: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = raw[key];
  return isRecord(value) ? value : {};
}

function resolvePath(base: string, value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return isAbsolute(value) ? value : resolve(base, value);
  }
  return fallback;
}

/**
 * Resolve a parsed YAML config object into a fully-populated {@link Config}
 * with absolute paths and observe-only-safe defaults applied.
 *
 * Throws on conflicting safety settings rather than silently picking one.
 */
export function resolveConfig(
  rawInput: unknown,
  options: ResolveOptions = {},
): Config {
  const raw = isRecord(rawInput) ? rawInput : {};

  const accountRaw = section(raw, "account");
  const pathsRaw = section(raw, "paths");
  const baileysRaw = section(raw, "baileys");
  const privacyRaw = section(raw, "privacy");
  const filtersRaw = section(raw, "filters");
  const exportsRaw = section(raw, "exports");
  const loggingRaw = section(raw, "logging");

  // Resolve to an absolute path so paths derived from it are stable regardless
  // of the cwd a later command (e.g. a systemd service) runs from.
  const dataDir = resolve(
    options.dataDir ?? asString(pathsRaw.data_dir, defaultDataDir()),
  );

  const paths: PathsConfig = {
    dataDir,
    sqlite: resolvePath(
      dataDir,
      pathsRaw.sqlite,
      join(dataDir, "whatsapp-conduit.db"),
    ),
    authDir: resolvePath(dataDir, pathsRaw.auth_dir, join(dataDir, "auth")),
    mediaDir: resolvePath(dataDir, pathsRaw.media_dir, join(dataDir, "media")),
  };

  const privacy: PrivacyConfig = {
    observeOnly: asBool(privacyRaw.observe_only, true),
    sendEnabled: asBool(privacyRaw.send_enabled, false),
    markRead: asBool(privacyRaw.mark_read, false),
    storeMessageText: asBool(privacyRaw.store_message_text, true),
    storeRawJson: asBool(privacyRaw.store_raw_json, true),
    storeMedia: asBool(privacyRaw.store_media, false),
    includeGroups: asBool(privacyRaw.include_groups, false),
    includeStatus: asBool(privacyRaw.include_status, false),
  };

  // Safety invariant: observe-only and sending are mutually exclusive.
  if (privacy.observeOnly && privacy.sendEnabled) {
    throw new Error(
      "Invalid config: privacy.observe_only and privacy.send_enabled cannot both be true.",
    );
  }

  const account: AccountConfig = {
    name: asString(accountRaw.name, "personal"),
  };
  const description = accountRaw.description;
  if (typeof description === "string" && description.length > 0) {
    account.description = description;
  }

  return {
    account,
    paths,
    baileys: {
      printQrInTerminal: asBool(baileysRaw.print_qr_in_terminal, true),
      syncFullHistory: asBool(baileysRaw.sync_full_history, false),
      markOnlineOnConnect: asBool(baileysRaw.mark_online_on_connect, false),
      browserName: asString(baileysRaw.browser_name, "whatsapp-conduit"),
    },
    privacy,
    filters: {
      allowedChats: asStringArray(filtersRaw.allowed_chats),
      blockedChats: asStringArray(filtersRaw.blocked_chats),
      allowedSenders: asStringArray(filtersRaw.allowed_senders),
      blockedSenders: asStringArray(filtersRaw.blocked_senders),
    },
    exports: {
      defaultFormat: "jsonl",
      redactPhoneNumbers: asBool(exportsRaw.redact_phone_numbers, false),
      includeRawJson: asBool(exportsRaw.include_raw_json, false),
    },
    logging: {
      level: asLogLevel(loggingRaw.level, "info"),
      logMessageText: asBool(loggingRaw.log_message_text, false),
    },
  };
}

/** Load and resolve a config file from disk. */
export function loadConfig(
  configPath: string,
  options: ResolveOptions = {},
): Config {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(configPath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config at ${configPath}: ${message}`);
  }
  return resolveConfig(raw, options);
}

/**
 * Render a default config file body for `whatsapp-conduit init`. Keeps the
 * observe-only defaults explicit and commented so the file is self-documenting.
 */
export function defaultConfigYaml(dataDir: string): string {
  return `# whatsapp-conduit configuration
# Observe-only personal WhatsApp linked-device sync. Defaults are privacy-safe.

account:
  name: personal
  description: "Personal WhatsApp linked-device sync"

paths:
  data_dir: ${dataDir}
  sqlite: ${join(dataDir, "whatsapp-conduit.db")}
  auth_dir: ${join(dataDir, "auth")}
  media_dir: ${join(dataDir, "media")}

baileys:
  print_qr_in_terminal: true
  sync_full_history: false
  mark_online_on_connect: false
  browser_name: whatsapp-conduit

privacy:
  observe_only: true
  send_enabled: false
  mark_read: false
  store_message_text: true
  store_raw_json: true
  store_media: false
  include_groups: false
  include_status: false

filters:
  # Empty allowlist: discover chats, but do not expose all chats to exports.
  allowed_chats: []
  blocked_chats: []
  allowed_senders: []
  blocked_senders: []

exports:
  default_format: jsonl
  redact_phone_numbers: false
  include_raw_json: false

logging:
  level: info
  log_message_text: false
`;
}
