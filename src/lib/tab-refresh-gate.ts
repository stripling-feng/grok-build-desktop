export class TabRefreshGate {
  private loadedKey: string | null = null;
  private inFlight = new Map<string, Promise<void>>();

  invalidate(key?: string) {
    if (key === undefined || this.loadedKey === key) this.loadedKey = null;
  }

  run(key: string, force: boolean, work: () => Promise<boolean>): Promise<void> {
    if (!force && this.loadedKey === key) return Promise.resolve();

    const active = this.inFlight.get(key);
    if (active) return active;

    const request = Promise.resolve()
      .then(work)
      .then((loaded) => {
        if (loaded) this.loadedKey = key;
      });
    this.inFlight.set(key, request);
    const cleanup = () => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    };
    void request.then(cleanup, cleanup);
    return request;
  }
}
