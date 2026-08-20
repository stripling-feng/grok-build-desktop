import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function grokBin(): string | null {
  const exe = process.platform === "win32" ? "grok.exe" : "grok";
  const candidates = [
    process.env.GROK_PATH,
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, exe) : null,
    path.join(os.homedir(), ".grok", "bin", exe),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export const INSTALL_COMMAND =
  process.platform === "win32"
    ? "irm https://x.ai/cli/install.ps1 | iex"
    : "curl -fsSL https://x.ai/cli/install.sh | bash";

export const INSTALL_DOCS = "https://x.ai/cli";
