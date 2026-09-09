import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const supervisor = path.resolve("tools/render-colocated-runtime.mjs");

async function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 5_000) {
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for supervised process exit.")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lattice-colocated-"));
  const dist = path.join(root, "dist", "src");
  await mkdir(dist, { recursive: true });
  return {
    root,
    async writeApi(source: string) {
      await writeFile(path.join(dist, "index.js"), source, "utf8");
    },
    async writeWorker(source: string) {
      await writeFile(path.join(dist, "run-worker-main.js"), source, "utf8");
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

const waitForSignalScript = (marker: string) => `
import { writeFileSync } from "node:fs";
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    writeFileSync(${JSON.stringify(marker)}, signal, "utf8");
    process.exit(0);
  });
}
setInterval(() => {}, 1000);
`;

test("co-located runtime fails closed when API exits and terminates worker", async () => {
  const f = await fixture();
  const marker = path.join(f.root, "worker-signal.txt");
  try {
    await f.writeApi("setTimeout(() => process.exit(0), 150);\n");
    await f.writeWorker(waitForSignalScript(marker));
    const child = spawn(process.execPath, [supervisor], { cwd: f.root, stdio: "ignore" });
    const result = await waitForExit(child);
    assert.equal(result.code, 1);
    assert.equal(await readFile(marker, "utf8"), "SIGTERM");
  } finally {
    await f.cleanup();
  }
});

test("co-located runtime propagates worker failure and terminates API", async () => {
  const f = await fixture();
  const marker = path.join(f.root, "api-signal.txt");
  try {
    await f.writeApi(waitForSignalScript(marker));
    await f.writeWorker("setTimeout(() => process.exit(2), 150);\n");
    const child = spawn(process.execPath, [supervisor], { cwd: f.root, stdio: "ignore" });
    const result = await waitForExit(child);
    assert.equal(result.code, 2);
    assert.equal(await readFile(marker, "utf8"), "SIGTERM");
  } finally {
    await f.cleanup();
  }
});

test("co-located runtime forwards Render shutdown signal to both process roles", async () => {
  const f = await fixture();
  const apiMarker = path.join(f.root, "api-signal.txt");
  const workerMarker = path.join(f.root, "worker-signal.txt");
  try {
    await f.writeApi(waitForSignalScript(apiMarker));
    await f.writeWorker(waitForSignalScript(workerMarker));
    const child = spawn(process.execPath, [supervisor], { cwd: f.root, stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    child.kill("SIGTERM");
    const result = await waitForExit(child);
    assert.equal(result.code, 0);
    assert.equal(await readFile(apiMarker, "utf8"), "SIGTERM");
    assert.equal(await readFile(workerMarker, "utf8"), "SIGTERM");
  } finally {
    await f.cleanup();
  }
});
