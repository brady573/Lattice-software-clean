import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

function onceExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateChild(child, signal, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const exited = onceExit(child);
  const timeout = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });
  await Promise.race([exited, timeout]);
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
  let requestedSignal;
  let resolveStop;
  const stopRequested = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const requestStop = (signal) => {
    if (stopping) return;
    stopping = true;
    requestedSignal = signal;
    resolveStop({ type: "signal", signal });
  };
  const onSigterm = () => requestStop("SIGTERM");
  const onSigint = () => requestStop("SIGINT");
  onSignal("SIGTERM", onSigterm);
  onSignal("SIGINT", onSigint);

  const apiExit = onceExit(api).then((result) => ({ type: "child", name: "api", result }));
  const workerExit = onceExit(worker).then((result) => ({ type: "child", name: "worker", result }));

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
    console.error(
      `LATTICE_COLOCATED_RUNTIME_CHILD_EXIT name=${first.name} code=${first.result.code ?? "null"} signal=${first.result.signal ?? "null"}`,
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
    if (!stopping && requestedSignal) stopping = true;
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
