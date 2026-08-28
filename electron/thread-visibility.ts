/**
 * Grok persists a summary as soon as `session/new` succeeds. Runtime probes
 * (MCP validation, auth checks, etc.) therefore look like conversations even
 * though their chat history contains only synthetic initialization records.
 */
export function hasPersistedConversation(raw: Record<string, unknown>): boolean {
  if (typeof raw.num_messages === "number" && Number.isFinite(raw.num_messages)) {
    return raw.num_messages > 0;
  }

  // Compatibility for older Grok summaries that predate num_messages.
  return [raw.generated_title, raw.session_summary, raw.last_turn_summary]
    .some((value) => typeof value === "string" && value.trim().length > 0);
}
