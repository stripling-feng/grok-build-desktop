export class SessionReplayGate {
  private readonly depths = new Map<string, number>();
  private readonly suppressed = new Map<string, number>();

  begin(sessionId: string): void {
    if (!sessionId) return;
    this.depths.set(sessionId, (this.depths.get(sessionId) ?? 0) + 1);
  }

  shouldSuppress(sessionId: string): boolean {
    if (!sessionId || !this.depths.has(sessionId)) return false;
    this.suppressed.set(sessionId, (this.suppressed.get(sessionId) ?? 0) + 1);
    return true;
  }

  end(sessionId: string): number {
    const depth = this.depths.get(sessionId) ?? 0;
    if (depth > 1) {
      this.depths.set(sessionId, depth - 1);
      return 0;
    }
    this.depths.delete(sessionId);
    const count = this.suppressed.get(sessionId) ?? 0;
    this.suppressed.delete(sessionId);
    return count;
  }

  clear(): void {
    this.depths.clear();
    this.suppressed.clear();
  }
}
