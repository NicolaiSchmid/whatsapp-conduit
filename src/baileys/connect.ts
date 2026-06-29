import {
  DisconnectReason,
  jidNormalizedUser,
  type ConnectionState,
} from "baileys";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { AuthState } from "./auth.js";
import {
  buildSocketConfig,
  createSocket,
  type SocketConfig,
  type WASocket,
  type WAVersion,
} from "./socket.js";

export type ConnectionMode = "link" | "run";

export interface CloseInfo {
  statusCode?: number;
  loggedOut: boolean;
  willReconnect: boolean;
}

export interface ConnectionHandlers {
  onQr?(qr: string): void;
  onConnecting?(): void;
  onOpen?(info: { selfJid?: string }): void;
  onClose?(info: CloseInfo): void;
  /** Hook to wire ingestion event handlers onto each (re)created socket. */
  registerSocket?(sock: WASocket): void;
}

export type SocketFactory = (config: SocketConfig) => WASocket;

export interface ConnectionDeps {
  config: Config;
  authState: AuthState;
  logger: Logger;
  mode: ConnectionMode;
  handlers: ConnectionHandlers;
  socketFactory?: SocketFactory;
  fetchVersion?: () => Promise<WAVersion>;
  reconnectDelayMs?: number;
}

/** Extract a Boom-style HTTP status code from a disconnect error, if present. */
export function statusCodeOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const output = (error as { output?: { statusCode?: unknown } }).output;
    const code = output?.statusCode;
    if (typeof code === "number") return code;
  }
  return undefined;
}

export interface DisconnectClassification {
  statusCode?: number;
  loggedOut: boolean;
}

export function classifyDisconnect(
  lastDisconnect: ConnectionState["lastDisconnect"] | undefined,
): DisconnectClassification {
  const statusCode = statusCodeOf(lastDisconnect?.error);
  return {
    statusCode,
    loggedOut: statusCode === DisconnectReason.loggedOut,
  };
}

/**
 * Decide whether to reconnect after a socket close.
 *
 * - Logged out: never reconnect — the session is gone, re-link is required.
 * - Restart required (515, emitted right after pairing / key refresh): always
 *   reconnect; this is the expected handshake step.
 * - `run` mode: reconnect on any other transient close.
 * - `link` mode: do not reconnect on other closes; the caller surfaces failure.
 */
export function shouldReconnect(
  statusCode: number | undefined,
  mode: ConnectionMode,
): boolean {
  if (statusCode === DisconnectReason.loggedOut) return false;
  if (statusCode === DisconnectReason.restartRequired) return true;
  return mode === "run";
}

/**
 * Manages a single WhatsApp socket lifecycle plus reconnection. Observe-only:
 * it wires `creds.update` and `connection.update`, and exposes a hook for
 * ingestion handlers, but never sends or marks anything.
 */
export class ConduitConnection {
  private readonly config: Config;
  private readonly authState: AuthState;
  private readonly logger: Logger;
  private readonly mode: ConnectionMode;
  private readonly handlers: ConnectionHandlers;
  private readonly socketFactory: SocketFactory;
  private readonly fetchVersion?: () => Promise<WAVersion>;
  private readonly reconnectDelayMs: number;

  private sock?: WASocket;
  private version?: WAVersion;
  private started = false;
  private stopped = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(deps: ConnectionDeps) {
    this.config = deps.config;
    this.authState = deps.authState;
    this.logger = deps.logger;
    this.mode = deps.mode;
    this.handlers = deps.handlers;
    this.socketFactory = deps.socketFactory ?? createSocket;
    // No default version fetch: leaving `version` undefined makes Baileys use
    // the protocol version it was built against, which is safer than tracking
    // the latest WA Web version (it can advance ahead of the pinned protobufs).
    this.fetchVersion = deps.fetchVersion;
    this.reconnectDelayMs = deps.reconnectDelayMs ?? 3000;
  }

  /** Resolve the WA version (if a resolver was provided), then open the socket. */
  async start(): Promise<void> {
    if (this.fetchVersion) this.version = await this.fetchVersion();
    this.started = true;
    this.spawn();
  }

  private spawn(): void {
    if (this.stopped || !this.started) return;

    const socketConfig = buildSocketConfig({
      config: this.config,
      authState: this.authState,
      version: this.version,
      logger: this.logger,
    });
    const sock = this.socketFactory(socketConfig);
    this.sock = sock;

    sock.ev.on("creds.update", () => {
      void this.authState.saveCreds();
    });
    this.handlers.registerSocket?.(sock);
    sock.ev.on("connection.update", (update) => {
      this.handleUpdate(update);
    });
  }

  private handleUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) this.handlers.onQr?.(qr);
    if (connection === "connecting") this.handlers.onConnecting?.();
    if (connection === "open") {
      this.handlers.onOpen?.({ selfJid: this.selfJid() });
    }
    if (connection === "close") {
      const { statusCode, loggedOut } = classifyDisconnect(lastDisconnect);
      const willReconnect =
        !this.stopped && shouldReconnect(statusCode, this.mode);
      this.handlers.onClose?.({ statusCode, loggedOut, willReconnect });
      if (willReconnect) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) this.spawn();
    }, this.reconnectDelayMs);
    // Don't keep the event loop alive solely for a pending reconnect.
    this.reconnectTimer.unref?.();
  }

  private selfJid(): string | undefined {
    const id = this.sock?.user?.id;
    return id ? jidNormalizedUser(id) : undefined;
  }

  /** Stop reconnecting and close the current socket. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.sock?.end(undefined);
    } catch {
      // best-effort close
    }
  }
}
