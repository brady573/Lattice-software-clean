import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

// The deployment supervisor is intentionally plain ESM JavaScript so Render can execute it directly.
// @ts-expect-error No declaration file is required for this deployment-only module.
const { superviseColocatedRuntime } = await import("../tools/render-colocated-runtime.mjs") as {
  superviseColocatedRuntime: (options: Record<string, unknown>) => Promise<{
    reason: string;
    signal?: NodeJS.Signals;
    child?: string;
    exitCode: number;
  }>;
};

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.kills.push(signal);
    setImmediate(() => this.finish(null, signal));
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }
}

function harness() {
  const api = new FakeChild();
  const worker = new FakeChild();
  const spawned: FakeChild[] = [];
  const handlers = new Map<NodeJS.Signals, () => void>();
  return {
    api,
    worker,
    handlers,
    options: {
      spawnImpl: () => {
        const next = spawned.length === 0 ? api : worker;
        spawned.push(next);
        return next;
      },
      env: {},
      shutdownTimeoutMs: 50,
      onSignal: (name: NodeJS.Signals, handler: () => void) => {
        handlers.set(name, handler);
      },
      offSignal: (name: NodeJS.Signals, handler: () => void) => {
        if (handlers.get(name) === handler) handlers.delete(name);
      },
    },
  };
}

test("co-located runtime fails closed when API exits and terminates worker", async () => {
  const h = harness();
  const supervised = superviseColocatedRuntime(h.options);
  h.api.finish(0);
  const result = await supervised;

  assert.equal(result.reason, "child-exit");
  assert.equal(result.child, "api");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(h.worker.kills, ["SIGTERM"]);
});

test("co-located runtime propagates worker failure and terminates API", async () => {
  const h = harness();
  const supervised = superviseColocatedRuntime(h.options);
  h.worker.finish(2);
  const result = await supervised;

  assert.equal(result.reason, "child-exit");
  assert.equal(result.child, "worker");
  assert.equal(result.exitCode, 2);
  assert.deepEqual(h.api.kills, ["SIGTERM"]);
});

test("co-located runtime forwards Render shutdown signal to both process roles", async () => {
  const h = harness();
  const supervised = superviseColocatedRuntime(h.options);
  const sigterm = h.handlers.get("SIGTERM");
  assert.ok(sigterm);
  sigterm();
  const result = await supervised;

  assert.equal(result.reason, "signal");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(h.api.kills, ["SIGTERM"]);
  assert.deepEqual(h.worker.kills, ["SIGTERM"]);
});

test("co-located runtime treats child spawn failure as service failure", async () => {
  const h = harness();
  const supervised = superviseColocatedRuntime(h.options);
  h.worker.fail(new Error("worker spawn failed"));
  const result = await supervised;

  assert.equal(result.reason, "child-exit");
  assert.equal(result.child, "worker");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(h.api.kills, ["SIGTERM"]);
});
