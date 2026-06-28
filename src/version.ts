import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface PackageJson {
  version?: string;
  name?: string;
}

/**
 * Resolve the package version from the nearest package.json.
 *
 * Works both from `src/` (dev via tsx) and `dist/` (built), since the module
 * lives exactly one directory below the package root in both layouts.
 */
export function getVersion(): string {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const raw = readFileSync(fileURLToPath(pkgUrl), "utf8");
    const pkg = JSON.parse(raw) as PackageJson;
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
