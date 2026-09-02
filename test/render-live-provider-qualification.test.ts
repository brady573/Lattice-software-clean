import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildNvidiaQualificationArgs,
  buildNvidiaSmokeRequest,
  buildQualificationArgs,
  observedResponseModel,
  sanitizeProviderError,
} from "../tools/render-live-provider-qualification.mjs";

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    "content-type": "application/json",
    "x-ratelimit-limit-requests": "1000",
    "x-ratelimit-limit-tokens": "8000",
    "x-ratelimit-remaining-requests": "999",
    "x-ratelimit-remaining-tokens": "7900",
    "x-ratelimit-reset-requests": "1d",
    "x-ratelimit-reset-tokens": "1s",
  });
  response.end(JSON.stringify(body));
}

async function runNode(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("Render M9-4 wrapper pins a direct Groq GPT-OSS route without a broker", () => {
  const args = buildQualificationArgs({ sourceRevision: "abc123", output: "report.json" });
  assert.equal(args[args.indexOf("--requested-provider") + 1], "groq");
  assert.equal(args[args.indexOf("--requested-model") + 1], "openai/gpt-oss-20b");
  assert.equal(args[args.indexOf("--actual-provider") + 1], "groq");
  assert.equal(args[args.indexOf("--actual-model") + 1], "openai/gpt-oss-20b");
  assert.equal(args[args.indexOf("--execution-class") + 1], "LIVE_DIRECT");
  assert.equal(args[args.indexOf("--route-mode") + 1], "PINNED");
  assert.equal(args[args.indexOf("--source-revision") + 1], "abc123");
  assert.equal(args.includes("--broker"), false);
  assert.equal(args[args.indexOf("--token-env") + 1], "GROQ_API_KEY");
});

test("Render M9-4 wrapper pins current NVIDIA NIM with documented concise and JSON controls", () => {
  const args = buildNvidiaQualificationArgs({ sourceRevision: "nvidia123", output: "nvidia-report.json" });
  assert.equal(args[args.indexOf("--base-url") + 1], "https://integrate.api.nvidia.com/v1");
  assert.equal(args[args.indexOf("--requested-provider") + 1], "nvidia");
  assert.equal(args[args.indexOf("--requested-model") + 1], "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(args[args.indexOf("--actual-provider") + 1], "nvidia");
  assert.equal(args[args.indexOf("--actual-model") + 1], "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(args[args.indexOf("--route-proof-uri") + 1], "https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(args[args.indexOf("--execution-class") + 1], "LIVE_DIRECT");
  assert.equal(args[args.indexOf("--route-mode") + 1], "PINNED");
  assert.equal(args[args.indexOf("--source-revision") + 1], "nvidia123");
  assert.equal(args[args.indexOf("--token-env") + 1], "NVIDIA_API_KEY");
  assert.equal(args[args.indexOf("--disable-thinking") + 1], "true");
  assert.equal(args[args.indexOf("--json-mode-scenarios") + 1], "structured-action-contract");
  assert.equal(args.includes("--broker"), false);
  assert.equal(args.includes("--reasoning-effort"), false);
});

test("NVIDIA smoke diagnostic uses the documented minimal request shape", () => {
  assert.deepEqual(buildNvidiaSmokeRequest(), {
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 64,
    stream: false,
  });
});

test("NVIDIA response-model evidence requires an explicit non-empty model identity", () => {
  assert.equal(observedResponseModel({ model: " nvidia/nemotron-3.5-lightning-30b-a3b " }), "nvidia/nemotron-3.5-lightning-30b-a3b");
  assert.equal(observedResponseModel({ model: "" }), null);
  assert.equal(observedResponseModel({}), null);
  assert.equal(observedResponseModel(null), null);
});

test("NVIDIA smoke diagnostic retains only bounded provider error metadata", () => {
  assert.deepEqual(
    sanitizeProviderError({ error: { type: "server_error", code: "backend_failure", message: "request failed", secret: "DO_NOT_LOG", request: { prompt: "DO_NOT_LOG" } } }),
    { type: "server_error", code: "backend_failure", message: "request failed" },
  );
  assert.equal(sanitizeProviderError({ error: { secret: "DO_NOT_LOG" } }), null);
});

test("M9-4 direct qualification records Render revision and Groq rate-limit headers", async () => {
  const suite = JSON.parse(await readFile("benchmarks/local-model-agent-v1.json", "utf8")) as {
    scenarios: Array<{ messages: Array<{ role?: string; content?: string }> }>;
  };
  const temp = await mkdtemp(join(tmpdir(), "lattice-render-groq-"));
  const output = join(temp, "report.json");
  const token = "GROQ_TEST_TOKEN_NOT_FOR_OUTPUT";
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, { data: [{ id: "openai/gpt-oss-20b" }] });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonBody(request);
    assert.equal(body.model, "openai/gpt-oss-20b");
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.chat_template_kwargs, undefined);
    assert.equal(body.response_format, undefined);
    const messages = body.messages as Array<{ role?: string; content?: string }>;
    const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
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
    sendJson(response, { choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const run = await runNode([
      "tools/live-provider-qualification.mjs",
      "--base-url", `http://127.0.0.1:${address.port}/v1`,
      "--requested-provider", "groq",
      "--requested-model", "openai/gpt-oss-20b",
      "--actual-provider", "groq",
      "--actual-model", "openai/gpt-oss-20b",
      "--route-proof-uri", "https://console.groq.com/docs/model/openai/gpt-oss-20b",
      "--route-mode", "PINNED",
      "--execution-class", "LIVE_DIRECT",
      "--token-env", "GROQ_API_KEY",
      "--reasoning-effort", "low",
      "--min-completion-tokens", "64",
      "--repeat", "1",
      "--source-revision", "render-candidate-sha",
      "--allow-loopback", "true",
      "--output", output,
    ], { ...process.env, GROQ_API_KEY: token });
    assert.equal(run.code, 0, run.stderr);
    const reportText = await readFile(output, "utf8");
    assert.doesNotMatch(reportText, new RegExp(token));
    const report = JSON.parse(reportText) as {
      sourceRevision: string;
      route: { executionClass: string; brokerIdentity: string | null };
      summary: { attempts: number; passes: number; passRate: number };
      results: Array<{ headers: Record<string, string> }>;
    };
    assert.equal(report.sourceRevision, "render-candidate-sha");
    assert.equal(report.route.executionClass, "LIVE_DIRECT");
    assert.equal(report.route.brokerIdentity, null);
    assert.equal(report.summary.attempts, suite.scenarios.length);
    assert.equal(report.summary.passes, suite.scenarios.length);
    assert.equal(report.summary.passRate, 1);
    assert.ok(report.results.every((result) => result.headers["x-ratelimit-limit-requests"] === "1000"));
    assert.ok(report.results.every((result) => result.headers["x-ratelimit-limit-tokens"] === "8000"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    await rm(temp, { recursive: true, force: true });
  }
});
