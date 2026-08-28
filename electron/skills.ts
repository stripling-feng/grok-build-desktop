import fs from "node:fs";
import path from "node:path";
import type { SkillCreateInput } from "./shared";
import { grokHome } from "./sessions";

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function normalizeSkillName(value: string): string {
  const name = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
    throw new Error("Skill 名称只能包含小写字母、数字和连字符，长度 1–64，且不能以连字符开头或结尾");
  }
  return name;
}

export function renderSkillMarkdown(input: SkillCreateInput): string {
  const name = normalizeSkillName(input.name);
  const description = input.description.trim();
  if (!description) throw new Error("Skill 描述不能为空");
  const lines = ["---", `name: ${yamlString(name)}`, `description: ${yamlString(description)}`];
  if (input.whenToUse?.trim()) lines.push(`when-to-use: ${yamlString(input.whenToUse.trim())}`);
  if (input.argumentHint?.trim()) lines.push(`argument-hint: ${yamlString(input.argumentHint.trim())}`);
  if (input.allowedTools?.length) lines.push(`allowed-tools: [${input.allowedTools.map((item) => yamlString(item)).join(", ")}]`);
  if (input.userInvocable === false) lines.push("user-invocable: false");
  if (input.disableModelInvocation) lines.push("disable-model-invocation: true");
  if (input.model?.trim()) lines.push(`model: ${yamlString(input.model.trim())}`);
  if (input.effort?.trim()) lines.push(`effort: ${yamlString(input.effort.trim())}`);
  if (input.license?.trim()) lines.push(`license: ${yamlString(input.license.trim())}`);
  if (input.compatibility?.trim()) lines.push(`compatibility: ${yamlString(input.compatibility.trim())}`);
  if (input.author?.trim() || input.shortDescription?.trim()) {
    lines.push("metadata:");
    if (input.author?.trim()) lines.push(`  author: ${yamlString(input.author.trim())}`);
    if (input.shortDescription?.trim()) lines.push(`  short-description: ${yamlString(input.shortDescription.trim())}`);
  }
  const body = input.body.trim() || `# ${name}\n\n说明这个 Skill 应遵循的步骤、约束和验证方式。`;
  return `${lines.join("\n")}\n---\n\n${body}\n`;
}

export function createSkillFile(input: SkillCreateInput, projectRoot?: string | null): string {
  const name = normalizeSkillName(input.name);
  if (input.scope === "project" && !projectRoot?.trim()) throw new Error("创建项目 Skill 前请先选择项目");
  const root = input.scope === "user"
    ? path.join(grokHome(), "skills")
    : path.join(path.resolve(projectRoot!), ".grok", "skills");
  const dir = path.join(root, name);
  const file = path.join(dir, "SKILL.md");
  if (fs.existsSync(file)) throw new Error(`Skill 已存在：${file}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, renderSkillMarkdown({ ...input, name }), "utf8");
  return file;
}
