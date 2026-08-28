import assert from "node:assert/strict";
import test from "node:test";
import { TabRefreshGate } from "../src/lib/tab-refresh-gate";

test("tab refreshes coalesce in-flight work and reuse the loaded context", async () => {
  const gate = new TabRefreshGate();
  let calls = 0;
  let release: (() => void) | undefined;
  const work = () => {
    calls += 1;
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  };

  const first = gate.run("session-a", false, work);
  const second = gate.run("session-a", false, work);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release?.();
  await first;

  await gate.run("session-a", false, async () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 1);

  await gate.run("session-a", true, async () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 2);

  gate.invalidate("session-a");
  await gate.run("session-a", false, async () => {
    calls += 1;
    return true;
  });
  assert.equal(calls, 3);
});

test("failed and context-specific tab refreshes remain retryable", async () => {
  const gate = new TabRefreshGate();
  let calls = 0;

  await gate.run("session-a", false, async () => {
    calls += 1;
    return false;
  });
  await gate.run("session-a", false, async () => {
    calls += 1;
    return true;
  });
  await gate.run("session-b", false, async () => {
    calls += 1;
    return true;
  });

  assert.equal(calls, 3);
});
