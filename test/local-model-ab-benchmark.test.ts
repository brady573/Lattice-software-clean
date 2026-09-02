import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function runNode(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("local model benchmark records deterministic scenario results and compares reports", async () => {
  const suite = JSON.parse(await readFile("benchmarks/local-model-agent-v1.json", "utf8")) as {
    scenarios: Array<{ id: string; messages: Array<{ role?: string; content?: string }> }>;
  };
  const structuredAction = suite.scenarios.find((scenario) => scenario.id === "structured-action-contract");
  const structuredPrompt = structuredAction?.messages.find((message) => message.role === "user")?.content ?? "";
  assert.match(structuredPrompt, /actionType must be "http_request"/);
  assert.match(structuredPrompt, /method must be "GET"/);
  assert.match(structuredPrompt, /path must be "\/health"/);

  const temp = await mkdtemp(join(tmpdir(), "lattice-model-bench-"));
  const reportPath = join(temp, "left.json");
  const slowerPath = join(temp, "right.json");
  const mixedPath = join(temp, "mixed.json");
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, { data: [{ id: "mock-model" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonBody(request);
    const messages = body.messages as Array<{ role?: string; content?: string }>;
    const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    let message: Record<string, unknown>;
    if (user.includes("exploratory model")) {
      message = { role: "assistant", content: "CANDIDATE_FINDING" };
    } else if (user.includes("idempotency key")) {
      message = { role: "assistant", content: "REPLAY_SAME_KEY_SAME_BODY" };
    } else if (user.includes("smallest public-health probe")) {
      message = { role: "assistant", content: JSON.stringify({ actionType: "http_request", method: "GET", path: "/health" }) };
    } else if (user.includes("newer release notice")) {
      message = { role: "assistant", content: "S2" };
    } else if (user.includes("Fetched webpage text")) {
      message = { role: "assistant", content: "BLOCK_INSTRUCTION" };
    } else if (user.includes("current SearXNG release")) {
      message = {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "web_search", arguments: JSON.stringify({ query: "current SearXNG release" }) },
        }],
      };
    } else {
      response.writeHead(400).end();
      return;
    }
    sendJson(response, { choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const run = await runNode([
      "tools/local-model-ab-benchmark.mjs",
      "run",
      "--base-url", `http://127.0.0.1:${address.port}/v1`,
      "--model", "mock-model",
      "--label", "left",
      "--repeat", "1",
      "--output", reportPath,
    ]);
    assert.equal(run.code, 0, run.stderr);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      suiteId: string;
      summary: {
        attempts: number;
        passes: number;
        passRate: number;
        meanLatencyMs: number | null;
        p50LatencyMs: number | null;
        p95LatencyMs: number | null;
      };
      results: Array<{ pass: boolean }>;
      model: Record<string, unknown>;
    };
    assert.equal(report.suiteId, "lattice-local-model-agent-v1");
    assert.equal(report.summary.attempts, 6);
    assert.equal(report.summary.passes, 6);
    assert.equal(report.summary.passRate, 1);
    assert.ok(report.results.every((result) => result.pass));

    const slower = structuredClone(report);
    slower.model = { ...slower.model, label: "right" };
    slower.summary.meanLatencyMs = (report.summary.meanLatencyMs ?? 0) + 100;
    slower.summary.p50LatencyMs = (report.summary.p50LatencyMs ?? 0) + 100;
    slower.summary.p95LatencyMs = (report.summary.p95LatencyMs ?? 0) + 100;
    await writeFile(slowerPath, JSON.stringify(slower), "utf8");
    const compare = await runNode([
      "tools/local-model-ab-benchmark.mjs",
      "compare",
      "--left", reportPath,
      "--right", slowerPath,
    ]);
    assert.equal(compare.code, 0, compare.stderr);
    const comparison = JSON.parse(compare.stdout) as { preferred: string; reason: string; evidenceBoundary: string };
    assert.equal(comparison.preferred, "LEFT");
    assert.match(comparison.reason, /lower mean, p50, and p95 latency/i);
    assert.match(comparison.evidenceBoundary, /does not establish Lattice Product acceptance/i);

    const mixed = structuredClone(report);
    mixed.model = { ...mixed.model, label: "mixed" };
    mixed.summary.meanLatencyMs = (report.summary.meanLatencyMs ?? 0) + 100;
    mixed.summary.p50LatencyMs = 0;
    mixed.summary.p95LatencyMs = (report.summary.p95LatencyMs ?? 0) + 100;
    await writeFile(mixedPath, JSON.stringify(mixed), "utf8");
    const mixedCompare = await runNode([
      "tools/local-model-ab-benchmark.mjs",
      "compare",
      "--left", reportPath,
      "--right", mixedPath,
    ]);
    assert.equal(mixedCompare.code, 0, mixedCompare.stderr);
    const mixedComparison = JSON.parse(mixedCompare.stdout) as { preferred: string; reason: string };
    assert.equal(mixedComparison.preferred, "TIE");
    assert.match(mixedComparison.reason, /do not show consistent dominance/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    await rm(temp, { recursive: true, force: true });
  }
});
