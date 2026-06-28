import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { useMultiFileAuthState } from "baileys";

export type AuthState = Awaited<ReturnType<typeof useMultiFileAuthState>>;

/**
 * Open the multi-file Baileys auth state for an account.
 *
 * MVP uses `useMultiFileAuthState` (a directory of JSON key files). The
 * directory is the equivalent of a linked WhatsApp session and must be treated
 * as sensitive — it is git-ignored and created with restrictive permissions by
 * the OS umask.
 */
export async function openAuthState(authDir: string): Promise<AuthState> {
  mkdirSync(authDir, { recursive: true });
  return useMultiFileAuthState(authDir);
}

/** True if an auth session already exists in `authDir` (creds persisted). */
export function authStateExists(authDir: string): boolean {
  return existsSync(join(authDir, "creds.json"));
}
