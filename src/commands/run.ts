import { loadConfig } from "../config.js";
import { authStateExists, openAuthState } from "../baileys/auth.js";
import { ConduitConnection } from "../baileys/connect.js";
import { registerIngestion } from "../baileys/ingest.js";
import { openDb } from "../db/index.js";
import { upsertAccount } from "../db/queries.js";
import { appLogger, baileysLogger, resolveConfigPath } from "../runtime.js";

export interface RunOptions {
  configPath?: string;
}

/**
 * Run the foreground observe-only sync daemon: connect, reconnect on transient
 * drops, and stay alive until SIGINT/SIGTERM. Message ingestion handlers are
 * attached to each socket via the connection's `registerSocket` hook.
 *
 * The returned promise resolves on graceful shutdown.
 */
export async function runRun(options: RunOptions = {}): Promise<void> {
  const config = loadConfig(resolveConfigPath(options.configPath));
  const log = appLogger(config);
  const db = openDb(config.paths.sqlite, { migrate: true });

  upsertAccount(db, {
    id: config.account.name,
    label: config.account.description ?? null,
  });

  if (!authStateExists(config.paths.authDir)) {
    log.warn(
      "no auth state found — run `whatsapp-conduit link` before `run` to pair a device",
    );
  }
  const authState = await openAuthState(config.paths.authDir);

  log.info(
    {
      account: config.account.name,
      observeOnly: config.privacy.observeOnly,
      sendEnabled: config.privacy.sendEnabled,
      markRead: config.privacy.markRead,
      includeGroups: config.privacy.includeGroups,
    },
    "starting observe-only sync",
  );

  return new Promise<void>((resolve) => {
    let shuttingDown = false;

    const shutdown = (code: number): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info("shutting down");
      connection.stop();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try {
        db.close();
      } catch {
        // best-effort
      }
      if (code !== 0) process.exitCode = code;
      resolve();
    };
    const onSignal = (): void => shutdown(0);

    const connection = new ConduitConnection({
      config,
      authState,
      logger: baileysLogger(config),
      mode: "run",
      handlers: {
        onConnecting() {
          log.info("connecting to WhatsApp");
        },
        onOpen(info) {
          log.info({ selfJid: info.selfJid }, "connected");
        },
        onClose(info) {
          if (info.loggedOut) {
            log.error("logged out — re-link required; stopping");
            shutdown(1);
            return;
          }
          log.warn(
            { statusCode: info.statusCode, willReconnect: info.willReconnect },
            "connection closed",
          );
        },
        registerSocket(sock) {
          registerIngestion(sock, {
            db,
            accountId: config.account.name,
            config,
            logger: log,
          });
        },
      },
    });

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    connection.start().catch((err: unknown) => {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "failed to start connection",
      );
      shutdown(1);
    });
  });
}
