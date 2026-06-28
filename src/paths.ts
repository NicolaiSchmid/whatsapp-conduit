import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "whatsapp-conduit";

/** Base config directory, honoring `XDG_CONFIG_HOME`. */
export function configHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim().length > 0) {
    return join(xdg, APP_DIR_NAME);
  }
  return join(homedir(), ".config", APP_DIR_NAME);
}

/** Default path to the YAML config file. */
export function defaultConfigPath(): string {
  return join(configHome(), "config.yaml");
}

/** Default data directory, honoring `XDG_DATA_HOME`. */
export function defaultDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim().length > 0) {
    return join(xdg, APP_DIR_NAME);
  }
  return join(homedir(), ".local", "share", APP_DIR_NAME);
}
