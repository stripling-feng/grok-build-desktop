const MAX_THREAD_TITLE_LENGTH = 28;

export function isPlaceholderThreadTitle(title: string): boolean {
  return /^(?:新(?:会话|对话)|未命名(?:会话|对话)|(?:untitled|new)(?: session| conversation| chat)?)$/i.test(
    title.trim(),
  );
}

export function threadTitleForDisplay(summaryTitle: string, initialTitle: string): string {
  return isPlaceholderThreadTitle(summaryTitle) && initialTitle.trim()
    ? initialTitle.trim()
    : summaryTitle;
}

function truncateTitle(value: string, maxLength = MAX_THREAD_TITLE_LENGTH): string {
  const chars = Array.from(value);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : value;
}

export function threadTitleFromPrompt(prompt: string): string {
  const compact = prompt
    .replace(/<user_info>[\s\S]*?<\/user_info>/gi, " ")
    .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, " ")
    .replace(/(?:api[_ -]?key|密码|口令|token|secret)\s*[:=]?\s*\S+/gi, " ")
    .replace(/(?:账号|用户名|username)\s*[:=]?\s*\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return prompt.trim() ? "新任务" : "";

  const firstClause = compact
    .split(/[。！？!?；;]/)
    .map((part) => part.trim())
    .find((part) => Array.from(part).length >= 2);
  const title = (firstClause || compact)
    .replace(/^(?:请|麻烦)(?:帮我|协助我|你)?\s*/u, "")
    .trim();
  return truncateTitle(title || compact);
}
