import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import type { AuthState } from "../src/baileys/auth.js";
import {
  ConduitConnection,
  classifyDisconnect,
  shouldReconnect,
  statusCodeOf,
  type CloseInfo,
} from "../src/baileys/connect.js";
import type { WASocket } from "../src/baileys/socket.js";
import { createLogger } from "../src/util/logging.js";

/** Minimal stand-in for a Baileys socket that we can drive from tests. */
class FakeSocket {
  readonly listeners = new Map<string, Array<(arg: unknown) => void>>();
  user: { id?: string } | undefined;
  ended = false;

  readonly ev = {
    on: (event: string, listener: (arg: unknown) => void): void => {
      const arr = this.listeners.get(event) ?? [];
      arr.push(listener);
      this.listeners.set(event, arr);
    },
  };

  end(): void {
    this.ended = true;
  }

  emit(event: string, arg?: unknown): void {
    for (const l of this.listeners.get(event) ?? []) l(arg);
  }
}

function boom(statusCode: number): Error {
  return { output: { statusCode } } as unknown as Error;
}

function tick(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const config = resolveConfig({}, { dataDir: "/data" });
const authState = {
  state: { creds: {}, keys: { get: async () => ({}), set: async () => {} } },
  saveCreds: async () => {},
} as unknown as AuthState;
const logger = createLogger({ level: "error" });

describe("statusCodeOf / classifyDisconnect", () => {
  it("reads a Boom status code", () => {
    expect(statusCodeOf(boom(401))).toBe(401);
    expect(statusCodeOf(new Error("x"))).toBeUndefined();
    expect(statusCodeOf(undefined)).toBeUndefined();
  });

  it("flags logged-out disconnects", () => {
    expect(classifyDisconnect({ error: boom(401), date: new Date(0) })).toEqual(
      {
        statusCode: 401,
        loggedOut: true,
      },
    );
    expect(classifyDisconnect({ error: boom(428), date: new Date(0) })).toEqual(
      {
        statusCode: 428,
        loggedOut: false,
      },
    );
  });
});

describe("shouldReconnect", () => {
  it("never reconnects after logout", () => {
    expect(shouldReconnect(401, "run")).toBe(false);
    expect(shouldReconnect(401, "link")).toBe(false);
  });

  it("always reconnects on restartRequired (515)", () => {
    expect(shouldReconnect(515, "run")).toBe(true);
    expect(shouldReconnect(515, "link")).toBe(true);
  });

  it("reconnects transient closes only in run mode", () => {
    expect(shouldReconnect(428, "run")).toBe(true);
    expect(shouldReconnect(428, "link")).toBe(false);
    expect(shouldReconnect(undefined, "run")).toBe(true);
  });
});

describe("ConduitConnection", () => {
  function makeConn(mode: "run" | "link") {
    const sockets: FakeSocket[] = [];
    const closes: CloseInfo[] = [];
    let openSelfJid: string | undefined;
    const conn = new ConduitConnection({
      config,
      authState,
      logger,
      mode,
      reconnectDelayMs: 0,
      fetchVersion: async () => [2, 3000, 0],
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WASocket;
      },
      handlers: {
        onOpen(info) {
          openSelfJid = info.selfJid;
        },
        onClose(info) {
          closes.push(info);
        },
      },
    });
    return { conn, sockets, closes, getOpenJid: () => openSelfJid };
  }

  it("normalizes the self jid on open", async () => {
    const { conn, sockets, getOpenJid } = makeConn("run");
    await conn.start();
    sockets[0]!.user = { id: "49123456:9@s.whatsapp.net" };
    sockets[0]!.emit("connection.update", { connection: "open" });
    expect(getOpenJid()).toBe("49123456@s.whatsapp.net");
    conn.stop();
  });

  it("reconnects on a transient close in run mode", async () => {
    const { conn, sockets, closes } = makeConn("run");
    await conn.start();
    expect(sockets).toHaveLength(1);

    sockets[0]!.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: boom(428), date: new Date(0) },
    });
    expect(closes[0]?.willReconnect).toBe(true);

    await tick();
    expect(sockets).toHaveLength(2);
    conn.stop();
  });

  it("does not reconnect after logout", async () => {
    const { conn, sockets, closes } = makeConn("run");
    await conn.start();

    sockets[0]!.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: boom(401), date: new Date(0) },
    });
    expect(closes[0]?.loggedOut).toBe(true);
    expect(closes[0]?.willReconnect).toBe(false);

    await tick();
    expect(sockets).toHaveLength(1);
    conn.stop();
  });

  it("stops reconnecting after stop()", async () => {
    const { conn, sockets } = makeConn("run");
    await conn.start();
    conn.stop();

    sockets[0]!.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: boom(428), date: new Date(0) },
    });
    await tick();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.ended).toBe(true);
  });
});
