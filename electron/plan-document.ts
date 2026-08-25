export function planEntriesFromMarkdown(
  markdown: string,
): { content: string; status: "pending" }[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const phases: { at: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]?.match(
      /^#{2,4}\s+((?:P\d+\b|第[一二三四五六七八九十\d]+(?:阶段|步))[^#]*)$/i,
    );
    if (match?.[1]) phases.push({ at: i, title: match[1].trim() });
  }
  if (phases.length > 0) {
    return phases.slice(0, 12).map((phase, index) => {
      const end = phases[index + 1]?.at ?? lines.length;
      const details: string[] = [];
      for (let i = phase.at + 1; i < end && details.length < 8; i += 1) {
        const raw = lines[i]?.trim() ?? "";
        if (!raw || /^```/.test(raw)) continue;
        if (/^#{1,4}\s+/.test(raw)) break;
        const clean = raw.replace(/^[-*+]\s+/, "• ").replace(/^\d+[.)、]\s+/, "• ");
        if (clean) details.push(clean);
      }
      return {
        content: [phase.title, ...details].join("\n").slice(0, 1600),
        status: "pending" as const,
      };
    });
  }

  const numbered = lines
    .map((line) => line.trim().match(/^\d+[.)、]\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 12);
  if (numbered.length > 0) {
    return numbered.map((content) => ({ content, status: "pending" as const }));
  }

  const headings = lines
    .map((line) => line.trim().match(/^#{2,4}\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter(
      (heading) =>
        Boolean(heading) &&
        !/^(问题|背景|上下文|现状|目标|风险|边界|不做|关键文件|验证|验收|context|background|goal|risks?)\b/i.test(
          heading,
        ),
    )
    .slice(0, 12);
  if (headings.length > 0) {
    return headings.map((content) => ({ content, status: "pending" as const }));
  }

  return lines
    .map((line) => line.trim().match(/^[-*+]\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 12)
    .map((content) => ({ content, status: "pending" as const }));
}
