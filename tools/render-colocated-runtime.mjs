import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

function onceTermination(child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(result);
    };
    const onExit = (code, signal) => finish({ code, signal, error: undefined });
    const onError = (error) => finish({ code: null, signal: null, error });
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function terminateChild(child, signal, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const terminated = onceTermination(child);
  child.kill(signal);
  let timeoutHandle;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
    timeoutHandle.unref?.();
  });

  const result = await Promise.race([terminated, timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (result !== "timeout") return;

  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await onceTermination(child);
}

export async function superviseColocatedRuntime({
  spawnImpl = spawn,
  env = process.env,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  onSignal = (name, handler) => process.once(name, handler),
  offSignal = (name, handler) => process.off(name, handler),
} = {}) {
  const api = spawnImpl(process.execPath, ["dist/src/index.js"], {
    env,
    stdio: "inherit",
  });
  const worker = spawnImpl(process.execPath, ["dist/src/run-worker-main.js"], {
    env,
    stdio: "inherit",
  });

  let stopping = false;
  let resolveStop;
  const stopRequested = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const requestStop = (signal) => {
    if (stopping) return;
    stopping = true;
    resolveStop({ type: "signal", signal });
  };
  const onSigterm = () => requestStop("SIGTERM");
  const onSigint = () => requestStop("SIGINT");
  onSignal("SIGTERM", onSigterm);
  onSignal("SIGINT", onSigint);

  const apiExit = onceTermination(api).then((result) => ({ type: "child", name: "api", result }));
  const workerExit = onceTermination(worker).then((result) => ({ type: "child", name: "worker", result }));

  try {
    const first = await Promise.race([apiExit, workerExit, stopRequested]);
    if (first.type === "signal") {
      await Promise.all([
        terminateChild(api, first.signal, shutdownTimeoutMs),
        terminateChild(worker, first.signal, shutdownTimeoutMs),
      ]);
      return { reason: "signal", signal: first.signal, exitCode: 0 };
    }

    stopping = true;
    const sibling = first.name === "api" ? worker : api;
    await terminateChild(sibling, "SIGTERM", shutdownTimeoutMs);
    const code = first.result.code === 0 ? 1 : (first.result.code ?? 1);
    const detail = first.result.error instanceof Error
      ? ` error=${JSON.stringify(first.result.error.message)}`
      : "";
    console.error(
      `LATTICE_COLOCATED_RUNTIME_CHILD_EXIT name=${first.name} code=${first.result.code ?? "null"} signal=${first.result.signal ?? "null"}${detail}`,
    );
    return {
      reason: "child-exit",
      child: first.name,
      childResult: first.result,
      exitCode: code,
    };
  } finally {
    offSignal("SIGTERM", onSigterm);
    offSignal("SIGINT", onSigint);
  }
}

async function main() {
  const result = await superviseColocatedRuntime();
  if (result.reason === "signal") {
    console.log(`LATTICE_COLOCATED_RUNTIME_STOPPED signal=${result.signal}`);
  }
  process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("LATTICE_COLOCATED_RUNTIME_START_FAILED", error);
    process.exitCode = 1;
  });
}
