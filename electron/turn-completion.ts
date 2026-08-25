const DEFAULT_LIVE_SUPPRESSION_MS = 2_000;

/**
 * Makes the live ACP `turn_completed` update and the settled prompt fallback
 * behave like one completion signal. Some Grok versions persist the live
 * update without forwarding it to the desktop client.
 */
export class TurnCompletionTracker {
  private readonly active = new Set<string>();
  private readonly liveCompleted = new Set<string>();
  private readonly suppressLiveUntil = new Map<string, number>();

  constructor(private readonly liveSuppressionMs = DEFAULT_LIVE_SUPPRESSION_MS) {}

  start(sessionId: string): void {
    if (!sessionId) return;
    this.active.add(sessionId);
    this.liveCompleted.delete(sessionId);
  }

  acceptLive(sessionId: string, now = Date.now()): boolean {
    if (!sessionId) return false;
    const suppressUntil = this.suppressLiveUntil.get(sessionId);
    if (suppressUntil != null) {
      this.suppressLiveUntil.delete(sessionId);
      if (now <= suppressUntil) return false;
    }
    if (this.active.has(sessionId)) this.liveCompleted.add(sessionId);
    return true;
  }

  /** Returns true when the caller must publish a synthetic completion. */
  settle(sessionId: string, now = Date.now()): boolean {
    if (!sessionId || !this.active.delete(sessionId)) return false;
    if (this.liveCompleted.delete(sessionId)) return false;
    this.suppressLiveUntil.set(sessionId, now + this.liveSuppressionMs);
    return true;
  }

  abort(sessionId: string): void {
    this.active.delete(sessionId);
    this.liveCompleted.delete(sessionId);
  }

  clear(): void {
    this.active.clear();
    this.liveCompleted.clear();
    this.suppressLiveUntil.clear();
  }
}
