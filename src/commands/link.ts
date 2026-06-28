import qrcode from "qrcode-terminal";
import { loadConfig, type Config } from "../config.js";
import { ConduitConnection } from "../baileys/connect.js";
import { openAuthState } from "../baileys/auth.js";
import { phoneFromJid } from "../baileys/jid.js";
import { openDb } from "../db/index.js";
import { upsertAccount } from "../db/queries.js";
import { appLogger, baileysLogger, resolveConfigPath } from "../runtime.js";

export interface LinkOptions {
  configPath?: string;
  /** Seconds to wait for pairing before giving up. Default 120. */
  timeoutSec?: number;
}

export interface LinkResult {
  selfJid?: string;
  accountId: string;
}

/**
 * Link the WhatsApp account as a secondary device via QR code, persisting auth
 * state. Resolves once the connection reaches `open`; rejects on logout, an
 * unrecoverable close, or timeout. Strictly observe-only — it only reads the
 * connection lifecycle and stores the account identity.
 */
export async function runLink(options: LinkOptions = {}): Promise<LinkResult> {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const timeoutSec = options.timeoutSec ?? 120;
  const log = appLogger(config);
  const authState = await openAuthState(config.paths.authDir);

  return new Promise<LinkResult>((resolve, reject) => {
    let settled = false;

    const connection = new ConduitConnection({
      config,
      authState,
      logger: baileysLogger(config),
      mode: "link",
      handlers: {
        onQr(qr) {
          process.stdout.write(
            "\nScan this QR code in WhatsApp → Settings → Linked Devices → Link a device:\n\n",
          );
          qrcode.generate(qr, { small: true });
        },
        onConnecting() {
          log.info("connecting to WhatsApp");
        },
        onOpen(info) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);

          const accountId = persistAccount(config, info.selfJid);
          process.stdout.write(
            `\nLinked successfully${info.selfJid ? ` as ${info.selfJid}` : ""}.\n` +
              "Auth state saved. You can now run `whatsapp-conduit run`.\n",
          );
          connection.stop();
          resolve({ selfJid: info.selfJid, accountId });
        },
        onClose(info) {
          if (settled) return;
          if (info.willReconnect) {
            log.info("restarting connection to complete pairing");
            return;
          }
          settled = true;
          if (timer) clearTimeout(timer);
          connection.stop();
          reject(
            new Error(
              info.loggedOut
                ? "Linking failed: logged out. Remove the auth directory and try again."
                : `Linking failed: connection closed (status ${info.statusCode ?? "unknown"}).`,
            ),
          );
        },
      },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      connection.stop();
      reject(new Error(`Linking timed out after ${timeoutSec}s.`));
    }, timeoutSec * 1000);

    connection.start().catch((err: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      connection.stop();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

function persistAccount(config: Config, selfJid?: string): string {
  const db = openDb(config.paths.sqlite, { migrate: true });
  try {
    upsertAccount(db, {
      id: config.account.name,
      label: config.account.description ?? null,
      selfJid: selfJid ?? null,
      phoneNumber: selfJid ? (phoneFromJid(selfJid) ?? null) : null,
    });
    return config.account.name;
  } finally {
    db.close();
  }
}
