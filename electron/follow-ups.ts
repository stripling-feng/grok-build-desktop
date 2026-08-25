import { randomUUID } from "node:crypto";

export type FollowUpImage = {
  path: string;
  mimeType: string;
};

export type QueuedFollowUp = {
  id: string;
  sessionId: string;
  text: string;
  images: FollowUpImage[];
  createdAt: number;
};

export type FollowUpReceipt = {
  delivery: "queued" | "steered";
  entry: QueuedFollowUp;
  fallback?: boolean;
};

export function followUpDisplayText(entry: Pick<QueuedFollowUp, "text" | "images">): string {
  const text = entry.text.trim();
  if (text) return text;
  return entry.images.length ? `图片 ×${entry.images.length}` : "后续消息";
}

export class FollowUpQueue {
  private readonly bySession = new Map<string, QueuedFollowUp[]>();

  create(
    sessionId: string,
    text: string,
    images: FollowUpImage[] = [],
  ): QueuedFollowUp {
    return {
      id: randomUUID(),
      sessionId,
      text,
      images: images.map((image) => ({ ...image })),
      createdAt: Date.now(),
    };
  }

  enqueue(entry: QueuedFollowUp): QueuedFollowUp[] {
    const next = [...(this.bySession.get(entry.sessionId) ?? []), entry];
    this.bySession.set(entry.sessionId, next);
    return next.slice();
  }

  prepend(entry: QueuedFollowUp): QueuedFollowUp[] {
    const next = [entry, ...(this.bySession.get(entry.sessionId) ?? [])];
    this.bySession.set(entry.sessionId, next);
    return next.slice();
  }

  list(sessionId?: string): QueuedFollowUp[] {
    if (sessionId) return (this.bySession.get(sessionId) ?? []).slice();
    return [...this.bySession.values()].flatMap((items) => items).sort((a, b) => a.createdAt - b.createdAt);
  }

  has(sessionId: string): boolean {
    return (this.bySession.get(sessionId)?.length ?? 0) > 0;
  }

  take(sessionId: string): QueuedFollowUp | null {
    const current = this.bySession.get(sessionId);
    if (!current?.length) return null;
    const [entry, ...rest] = current;
    if (rest.length) this.bySession.set(sessionId, rest);
    else this.bySession.delete(sessionId);
    return entry;
  }

  remove(sessionId: string, entryId: string): QueuedFollowUp | null {
    const current = this.bySession.get(sessionId);
    if (!current?.length) return null;
    const index = current.findIndex((entry) => entry.id === entryId);
    if (index < 0) return null;
    const [removed] = current.splice(index, 1);
    if (current.length) this.bySession.set(sessionId, current.slice());
    else this.bySession.delete(sessionId);
    return removed;
  }

  clear(sessionId: string): QueuedFollowUp[] {
    const current = this.list(sessionId);
    this.bySession.delete(sessionId);
    return current;
  }
}
