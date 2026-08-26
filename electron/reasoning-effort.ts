export function resolveReasoningEffortValue(effort: string, available: string[]): string | null {
  const aliases: Record<string, string[]> = {
    low: ["low", "minimal", "none"],
    medium: ["medium", "low"],
    high: ["high", "medium"],
    xhigh: ["xhigh", "max", "high"],
  };
  return (aliases[effort] ?? [effort]).find((candidate) => available.includes(candidate)) ?? null;
}
