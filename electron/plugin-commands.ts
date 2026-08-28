import type { PluginTagInput } from "./shared";

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

export function pluginInstallArgs(source: string, trust: boolean): string[] {
  const args = ["plugin", "install"];
  if (trust) args.push("--trust");
  args.push(required(source, "插件来源"));
  return args;
}

export function pluginUninstallArgs(name: string, keepData: boolean): string[] {
  const args = ["plugin", "uninstall", "--confirm"];
  if (keepData) args.push("--keep-data");
  args.push(required(name, "插件名称"));
  return args;
}

export function pluginUpdateArgs(name?: string): string[] {
  const args = ["plugin", "update"];
  if (name?.trim()) args.push(name.trim());
  return args;
}

export function pluginDetailsArgs(name: string): string[] {
  return ["plugin", "details", required(name, "插件名称")];
}

export function pluginValidateArgs(targetPath?: string): string[] {
  return ["plugin", "validate", targetPath?.trim() || "."];
}

export function pluginTagArgs(input: PluginTagInput): string[] {
  const args = ["plugin", "tag"];
  if (input.push) args.push("--push");
  if (input.force) args.push("--force");
  if (input.dryRun) args.push("--dry-run");
  args.push(input.path?.trim() || ".");
  return args;
}

export function marketplaceAddArgs(source: string, force: boolean): string[] {
  const args = ["plugin", "marketplace", "add"];
  if (force) args.push("--force");
  args.push(required(source, "市场源"));
  return args;
}

export function marketplaceUpdateArgs(source?: string): string[] {
  const args = ["plugin", "marketplace", "update"];
  if (source?.trim()) args.push(source.trim());
  return args;
}
