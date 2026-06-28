import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfigPath } from "../runtime.js";

const SERVICE_NAME = "whatsapp-conduit";

export interface RenderUnitArgs {
  execStart: string;
  workingDirectory: string;
  description?: string;
}

/**
 * Render a systemd unit for the observe-only sync daemon. Pure and testable;
 * the install command supplies concrete paths.
 */
export function renderServiceUnit(args: RenderUnitArgs): string {
  const description =
    args.description ?? "whatsapp-conduit observe-only WhatsApp -> SQLite sync";
  return `[Unit]
Description=${description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${args.execStart}
Restart=always
RestartSec=10
WorkingDirectory=${args.workingDirectory}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

/** Absolute path to the installed CLI entry (dist/cli.js) at runtime. */
function cliEntryPath(): string {
  return resolve(fileURLToPath(new URL("../cli.js", import.meta.url)));
}

function userUnitPath(): string {
  return join(
    homedir(),
    ".config",
    "systemd",
    "user",
    `${SERVICE_NAME}.service`,
  );
}

export interface ServiceInstallOptions {
  configPath?: string;
  workingDirectory?: string;
  /** Enable + start the unit immediately after install. */
  now?: boolean;
}

/**
 * Install a user-level systemd unit that runs `whatsapp-conduit run`. Writes the
 * unit under ~/.config/systemd/user and reloads the user daemon. Use --now to
 * enable and start it.
 */
export function runServiceInstall(options: ServiceInstallOptions = {}): void {
  const configPath = resolveConfigPath(options.configPath);
  const execStart = `${process.execPath} ${cliEntryPath()} --config ${configPath} run`;
  const workingDirectory = options.workingDirectory ?? dirname(configPath);
  const unit = renderServiceUnit({ execStart, workingDirectory });

  const unitPath = userUnitPath();
  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(unitPath, unit);
  process.stdout.write(`Wrote ${unitPath}\n`);

  systemctl(["daemon-reload"]);
  if (options.now) {
    systemctl(["enable", "--now", SERVICE_NAME]);
    process.stdout.write(`Enabled and started ${SERVICE_NAME}.\n`);
  } else {
    process.stdout.write(
      `Run \`systemctl --user enable --now ${SERVICE_NAME}\` to start it,\n` +
        `or \`whatsapp-conduit service start\`.\n`,
    );
  }
}

export type ServiceAction = "start" | "stop" | "restart" | "status" | "logs";

/** Returns the process exit code. */
export function runServiceControl(action: ServiceAction): number {
  try {
    if (action === "logs") {
      runForeground("journalctl", [
        "--user",
        "-u",
        SERVICE_NAME,
        "-n",
        "100",
        "--no-pager",
      ]);
      return 0;
    }
    if (action === "status") {
      // status returns non-zero when inactive; surface output regardless.
      runForeground("systemctl", [
        "--user",
        "status",
        SERVICE_NAME,
        "--no-pager",
      ]);
      return 0;
    }
    systemctl([action, SERVICE_NAME]);
    process.stdout.write(`${action} ${SERVICE_NAME}: ok\n`);
    return 0;
  } catch (err) {
    process.stderr.write(
      `service ${action} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

function systemctl(args: string[]): void {
  execFileSync("systemctl", ["--user", ...args], { stdio: "inherit" });
}

function runForeground(cmd: string, args: string[]): void {
  try {
    execFileSync(cmd, args, { stdio: "inherit" });
  } catch {
    // systemctl/journalctl exit non-zero for inactive/empty; output already shown.
  }
}
