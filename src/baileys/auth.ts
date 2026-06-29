import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { useMultiFileAuthState } from "baileys";

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
 * owner-only (`0700`) and existing key files are tightened to `0600` — never
 * left to the process umask, which would expose them to other local users.
 */
export async function openAuthState(authDir: string): Promise<AuthState> {
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  restrictAuthPermissions(authDir);
  return useMultiFileAuthState(authDir);
}

/** True if an auth session already exists in `authDir` (creds persisted). */
export function authStateExists(authDir: string): boolean {
  return existsSync(join(authDir, "creds.json"));
}
