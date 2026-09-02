import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function runNode(args: string[]) {
  return await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function args(baseUrl: string, output: string, timeoutMs = 5000): string[] {
  return [
    "tools/live-provider-qualification.mjs",
    "--base-url", baseUrl,
    "--requested-provider", "fixture",
    "--requested-model", "fixture-model",
    "--actual-provider", "fixture",
    "--actual-model", "fixture-model",
    "--route-proof-uri", "https://example.invalid/fixture-model",
    "--route-mode", "PINNED",
    "--execution-class", "LIVE_DIRECT",
    "--scenario-ids", "blackbox-evidence-boundary",
    "--repeat", "1",
    "--timeout-ms", String(timeoutMs),
    "--allow-loopback", "true",
    "--output", output,
  ];
}

async function withFailureServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, 200, { data: [{ id: "fixture-model" }] });
      return;
    }
    await handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function readSummary(output: string): Promise<{
  attempts: number;
  failures: number;
  rateLimited: number;
  unavailable: number;
  timeouts: number;
  malformedResponses: number;
}> {
  const report = JSON.parse(await readFile(output, "utf8")) as { summary: Awaited<ReturnType<typeof readSummary>> };
  return report.summary;
}

test("M9-4 qualification records a simulated 429 without converting it to success", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-m9-429-"));
  const output = join(temp, "report.json");
  try {
    await withFailureServer((_request, response) => {
      sendJson(response, 429, { error: { message: "rate limited" } }, { "retry-after": "2" });
    }, async (baseUrl) => {
      const run = await runNode(args(baseUrl, output));
      assert.notEqual(run.code, 0);
      const summary = await readSummary(output);
      assert.equal(summary.attempts, 1);
      assert.equal(summary.failures, 1);
      assert.equal(summary.rateLimited, 1);
      assert.equal(summary.unavailable, 0);
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("M9-4 qualification records simulated provider 5xx as unavailable", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-m9-503-"));
  const output = join(temp, "report.json");
  try {
    await withFailureServer((_request, response) => {
      sendJson(response, 503, { error: { message: "temporarily unavailable" } });
    }, async (baseUrl) => {
      const run = await runNode(args(baseUrl, output));
      assert.notEqual(run.code, 0);
      const summary = await readSummary(output);
      assert.equal(summary.attempts, 1);
      assert.equal(summary.failures, 1);
      assert.equal(summary.unavailable, 1);
      assert.equal(summary.rateLimited, 0);
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("M9-4 qualification records malformed provider JSON and fails closed", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-m9-malformed-"));
  const output = join(temp, "report.json");
  try {
    await withFailureServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{not-json");
    }, async (baseUrl) => {
      const run = await runNode(args(baseUrl, output));
      assert.notEqual(run.code, 0);
      const summary = await readSummary(output);
      assert.equal(summary.attempts, 1);
      assert.equal(summary.failures, 1);
      assert.equal(summary.malformedResponses, 1);
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("M9-4 qualification records provider timeout and fails closed", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-m9-timeout-"));
  const output = join(temp, "report.json");
  try {
    await withFailureServer(async (_request, response) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (!response.headersSent) sendJson(response, 200, { choices: [{ message: { role: "assistant", content: "CANDIDATE_FINDING" } }] });
    }, async (baseUrl) => {
      const run = await runNode(args(baseUrl, output, 1000));
      assert.notEqual(run.code, 0);
      const summary = await readSummary(output);
      assert.equal(summary.attempts, 1);
      assert.equal(summary.failures, 1);
      assert.equal(summary.timeouts, 1);
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
