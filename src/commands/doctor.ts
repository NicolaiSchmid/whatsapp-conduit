import { existsSync } from "node:fs";
import { defaultConfigPath } from "../paths.js";
import { getVersion } from "../version.js";

export interface DoctorReport {
  name: "whatsapp-conduit";
  version: string;
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  configPath: string;
  configExists: boolean;
}

export interface DoctorOptions {
  configPath?: string;
  json?: boolean;
}

export function buildDoctorReport(configPath: string): DoctorReport {
  return {
    name: "whatsapp-conduit",
    version: getVersion(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    configPath,
    configExists: existsSync(configPath),
  };
}

export function runDoctor(options: DoctorOptions = {}): void {
  const configPath = options.configPath ?? defaultConfigPath();
  const report = buildDoctorReport(configPath);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [
    `whatsapp-conduit ${report.version}`,
    `  node:        ${report.node}`,
    `  platform:    ${report.platform} (${report.arch})`,
    `  config path: ${report.configPath}`,
    `  config:      ${report.configExists ? "found" : "not found (run `whatsapp-conduit init`)"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
