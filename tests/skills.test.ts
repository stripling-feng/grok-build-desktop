import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mapRuntimeSkill, mergeSkillCatalog } from "../electron/grok-cli";
import { createSkillFile, normalizeSkillName, renderSkillMarkdown } from "../electron/skills";
import type { SkillInfo } from "../electron/shared";

test("Skill creator renders every supported frontmatter field", () => {
  const markdown = renderSkillMarkdown({
    name: "Release Check",
    description: "Validate a release",
    scope: "project",
    body: "# Steps\n\nRun tests.",
    whenToUse: "before a release",
    argumentHint: "[version]",
    allowedTools: ["Bash", "Read"],
    userInvocable: false,
    disableModelInvocation: true,
    model: "grok-code-fast-1",
    effort: "high",
    author: "Desktop",
    shortDescription: "Release validation",
    license: "MIT",
    compatibility: "Requires git",
  });
  for (const value of [
    'name: "release-check"',
    "when-to-use:",
    "argument-hint:",
    'allowed-tools: ["Bash", "Read"]',
    "user-invocable: false",
    "disable-model-invocation: true",
    "metadata:",
    "short-description:",
    "# Steps",
  ]) assert.match(markdown, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(normalizeSkillName("  My_Skill  "), "my-skill");
  assert.throws(() => normalizeSkillName("-bad"), /不能以连字符/);
});

test("Skill creator writes only inside a project skill directory and refuses overwrite", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-skill-test-"));
  try {
    const input = { name: "verify", description: "Verify work", scope: "project" as const, body: "Check it." };
    const file = createSkillFile(input, root);
    assert.equal(file, path.join(root, ".grok", "skills", "verify", "SKILL.md"));
    assert.match(fs.readFileSync(file, "utf8"), /Check it\./);
    assert.throws(() => createSkillFile(input, root), /已存在/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime skill mapping retains metadata and merges inspected collision identity", () => {
  const runtime = mapRuntimeSkill({
    name: "deploy-dir",
    display_name: "deploy",
    description: "Deploy safely",
    path: "C:\\repo\\.grok\\skills\\deploy-dir\\SKILL.md",
    scope: "local",
    enabled: true,
    when_to_use: "ship it",
    short_description: "Deploy",
    allowed_tools: ["Bash"],
    user_invocable: true,
    disable_model_invocation: true,
    metadata: { owner: "release" },
  });
  assert.ok(runtime);
  assert.equal(runtime.displayName, "deploy");
  assert.equal(runtime.whenToUse, "ship it");
  assert.deepEqual(runtime.allowedTools, ["Bash"]);
  assert.equal(runtime.disableModelInvocation, true);

  const inspected: SkillInfo = {
    ...runtime,
    id: "inspect",
    source: "项目",
    invocableAs: "/deploy-dir",
    collidesWith: "deploy",
  };
  const [merged] = mergeSkillCatalog([runtime], [inspected]);
  assert.equal(merged.source, "项目");
  assert.equal(merged.collidesWith, "deploy");
  assert.equal(merged.invocableAs, "/deploy-dir");
});
