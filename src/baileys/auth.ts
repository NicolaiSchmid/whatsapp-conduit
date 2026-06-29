import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { useMultiFileAuthState, type SignalKeyStore } from "baileys";

export type AuthState = Awaited<ReturnType<typeof useMultiFileAuthState>>;

/** Best-effort owner-only permissions for the auth dir and its key files. */
function restrictAuthPermissions(authDir: string): void {
  try {
    chmodSync(authDir, 0o700);
    for (const entry of readdirSync(authDir)) {
      const file = join(authDir, entry);
      if (statSync(file).isFile()) chmodSync(file, 0o600);
    }
  } catch {
    // best-effort; not all filesystems support chmod
  }
}

/**
 * Open the multi-file Baileys auth state for an account.
 *
 * MVP uses `useMultiFileAuthState` (a directory of JSON key files). The
 * directory is the equivalent of a linked WhatsApp session, so it is created
 * owner-only (`0700`). Because Baileys writes new key files (and creds.json)
 * lazily via `saveCreds` / `keys.set` with the process umask, those callbacks
 * are wrapped to re-tighten file permissions to `0600` after each write — not
 * just the files that happen to exist when the state is first opened.
 */
export async function openAuthState(authDir: string): Promise<AuthState> {
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  restrictAuthPermissions(authDir);

  const authState = await useMultiFileAuthState(authDir);

  const saveCreds = authState.saveCreds;
  authState.saveCreds = async () => {
    await saveCreds();
    restrictAuthPermissions(authDir);
  };

  const keys: SignalKeyStore = authState.state.keys;
  const set = keys.set.bind(keys);
  keys.set = async (data) => {
    await set(data);
    restrictAuthPermissions(authDir);
  };

  return authState;
}

interface PersistedCreds {
  registered?: unknown;
  me?: { id?: unknown } | null;
}

/**
 * True only if `authDir` holds a *completed* linked session — `creds.json`
 * exists, parses, is `registered`, and has an authenticated `me`. A bare or
 * aborted/stale creds file (e.g. `registered: false`) is not treated as linked,
 * so `run` won't proceed into a QR-less reconnect loop.
 */
export function authStateExists(authDir: string): boolean {
  const credsPath = join(authDir, "creds.json");
  if (!existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(readFileSync(credsPath, "utf8")) as PersistedCreds;
    return creds.registered === true && typeof creds.me?.id === "string";
  } catch {
    return false;
  }
}
