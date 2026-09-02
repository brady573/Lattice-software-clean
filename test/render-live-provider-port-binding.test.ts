import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("Render qualification binds a stable status port before a pre-qualification failure", async () => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["tools/render-live-provider-qualification.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RENDER: "true",
      RENDER_GIT_COMMIT: "port-binding-test",
      M9_PROVIDER_CANDIDATE: "unsupported-fixture",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${port}`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    assert.ok(response !== null, "status port never became reachable");
    assert.equal(response.status, 503);
    const body = await response.json() as { status?: string; workItem?: string; providerCandidate?: string };
    assert.equal(body.status, "FAIL");
    assert.equal(body.workItem, "M9-4");
    assert.equal(body.providerCandidate, "unsupported-fixture");
    assert.equal(child.exitCode, null, "wrapper exited instead of holding the failure summary");
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("close", () => resolve());
    });
  }
});
