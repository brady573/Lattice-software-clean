import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function runNode(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function commonArgs(baseUrl: string, output: string): string[] {
  return [
    "tools/live-provider-qualification.mjs",
    "--base-url", baseUrl,
    "--requested-provider", "pollinations",
    "--requested-model", "openai-fast",
    "--actual-provider", "azure",
    "--actual-model", "GPT-5 Nano",
    "--broker", "pollinations",
    "--route-proof-uri", "https://github.com/pollinations/pollinations/blob/example/shared/registry/text.ts",
    "--route-proof-revision", "example",
    "--route-mode", "PINNED",
    "--execution-class", "LIVE_BROKERED",
    "--repeat", "1",
    "--timeout-ms", "5000",
    "--allow-loopback", "true",
    "--output", output,
  ];
}

test("M9-4 live provider qualification runner records pinned route evidence without leaking bearer credentials", async () => {
  const suite = JSON.parse(await readFile("benchmarks/local-model-agent-v1.json", "utf8")) as {
    scenarios: Array<{ id: string; messages: Array<{ role?: string; content?: string }> }>;
  };
  const temp = await mkdtemp(join(tmpdir(), "lattice-live-qualification-"));
  const output = join(temp, "report.json");
  const token = "TEST_TOKEN_NOT_FOR_OUTPUT";
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, 200, { data: [{ id: "openai-fast" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonBody(request);
    assert.equal(body.model, "openai-fast");
    assert.equal(body.reasoning_effort, "minimal");
    const messages = body.messages as Array<{ role?: string; content?: string }>;
    const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    assert.equal(body.max_tokens, user.includes("current SearXNG release") ? 96 : 64);
    let message: Record<string, unknown>;
    if (user.includes("exploratory model")) message = { role: "assistant", content: "CANDIDATE_FINDING" };
    else if (user.includes("idempotency key")) message = { role: "assistant", content: "REPLAY_SAME_KEY_SAME_BODY" };
    else if (user.includes("smallest public-health probe")) message = { role: "assistant", content: JSON.stringify({ actionType: "http_request", method: "GET", path: "/health" }) };
    else if (user.includes("newer release notice")) message = { role: "assistant", content: "S2" };
    else if (user.includes("Fetched webpage text")) message = { role: "assistant", content: "BLOCK_INSTRUCTION" };
    else if (user.includes("current SearXNG release")) {
      message = { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "current SearXNG release" }) } }] };
    } else {
      response.writeHead(400).end();
      return;
    }
    sendJson(response, 200, { choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }, { "x-request-id": "req-test" });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const run = await runNode([
      ...commonArgs(`http://127.0.0.1:${address.port}/v1`, output),
      "--reasoning-effort", "minimal",
      "--min-completion-tokens", "64",
      "--token-env", "M9_TEST_TOKEN",
    ], { ...process.env, M9_TEST_TOKEN: token });
    assert.equal(run.code, 0, run.stderr);
    const reportText = await readFile(output, "utf8");
    assert.doesNotMatch(reportText, new RegExp(token));
    const report = JSON.parse(reportText) as {
      workItem: string;
      route: Record<string, unknown>;
      requestControls: { reasoningEffort: string | null; minCompletionTokens: number };
      transport: Record<string, unknown>;
      summary: { attempts: number; passes: number; passRate: number };
      results: Array<{ headers: Record<string, string> }>;
      qualificationBoundary: string;
    };
    assert.equal(report.workItem, "M9-4");
    assert.equal(report.route.routeMode, "PINNED");
    assert.equal(report.route.provenanceCompleteness, "COMPLETE");
    assert.equal(report.requestControls.reasoningEffort, "minimal");
    assert.equal(report.requestControls.minCompletionTokens, 64);
    assert.equal(report.transport.authentication, "BEARER_ENV");
    assert.equal(report.transport.tokenEnvironmentVariable, "M9_TEST_TOKEN");
    assert.equal(report.summary.attempts, suite.scenarios.length);
    assert.equal(report.summary.passes, suite.scenarios.length);
    assert.equal(report.summary.passRate, 1);
    assert.ok(report.results.every((result) => result.headers["x-request-id"] === "req-test"));
    assert.match(report.qualificationBoundary, /does not establish Lattice Product acceptance/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    await rm(temp, { recursive: true, force: true });
  }
});

test("M9-4 runner exits non-zero and preserves report when qualification scenarios fail", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-live-qualification-fail-closed-"));
  const output = join(temp, "report.json");
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, 200, { data: [{ id: "openai-fast" }] });
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      sendJson(response, 200, { choices: [{ message: { role: "assistant", content: "WRONG" } }] });
      return;
    }
    response.writeHead(404).end();
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const run = await runNode(commonArgs(`http://127.0.0.1:${address.port}/v1`, output));
    assert.notEqual(run.code, 0);
    const report = JSON.parse(await readFile(output, "utf8")) as {
      requestControls: { minCompletionTokens: number };
      summary: { attempts: number; passes: number; failures: number; passRate: number };
    };
    assert.equal(report.requestControls.minCompletionTokens, 0);
    assert.ok(report.summary.attempts > 0);
    assert.equal(report.summary.passes, 0);
    assert.equal(report.summary.failures, report.summary.attempts);
    assert.equal(report.summary.passRate, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    await rm(temp, { recursive: true, force: true });
  }
});

test("M9-4 runner fails closed for non-HTTPS remote endpoints and non-pinned route modes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-live-qualification-reject-"));
  const output = join(temp, "report.json");
  try {
    const insecure = await runNode(commonArgs("http://provider.example/v1", output).filter((value, index, array) => !(array[index - 1] === "--allow-loopback" || value === "--allow-loopback")));
    assert.notEqual(insecure.code, 0);
    assert.match(insecure.stderr, /non-loopback HTTPS base URL/i);

    const unpinnedArgs = commonArgs("http://127.0.0.1:1/v1", output);
    const routeIndex = unpinnedArgs.indexOf("--route-mode") + 1;
    unpinnedArgs[routeIndex] = "BROKER_AUTOMATIC";
    const unpinned = await runNode(unpinnedArgs);
    assert.notEqual(unpinned.code, 0);
    assert.match(unpinned.stderr, /PINNED only/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
