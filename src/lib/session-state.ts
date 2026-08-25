export type SessionRunState = { sessionId: string; running: boolean };
export type SessionUnreadState = { sessionId: string; unread: boolean };

export function updateRunningSessionIds(
  current: ReadonlySet<string>,
  state: SessionRunState,
): Set<string> {
  const next = new Set(current);
  if (!state.sessionId) return next;
  if (state.running) next.add(state.sessionId);
  else next.delete(state.sessionId);
  return next;
}

export function updateUnreadSessionIds(
  current: ReadonlySet<string>,
  state: SessionUnreadState,
): Set<string> {
  const next = new Set(current);
  if (!state.sessionId) return next;
  if (state.unread) next.add(state.sessionId);
  else next.delete(state.sessionId);
  return next;
}

export function isSessionViewCurrent(
  activeSessionId: string | null | undefined,
  incomingSessionId: string,
): boolean {
  return Boolean(activeSessionId) && activeSessionId === incomingSessionId;
}

export function agentModeForComposer(planMode: boolean): "plan" | "act" {
  return planMode ? "plan" : "act";
}
