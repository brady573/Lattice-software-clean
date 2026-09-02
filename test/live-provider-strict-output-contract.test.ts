import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

test("strict output contract constrains shape without injecting expected answers", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-m9-strict-"));
  const suitePath = join(temp, "suite.json");
  const output = join(temp, "report.json");
  const expectedLabel = "EXPECTED_LABEL_MUST_NOT_ENTER_REQUEST";
  const requests: Record<string, unknown>[] = [];
  await writeFile(suitePath, JSON.stringify({
    suiteId: "strict-contract-fixture",
    scenarios: [
      {
        id: "label",
        messages: [{ role: "user", content: "Return the correct label only." }],
        expected: { type: "exact_content", value: expectedLabel },
      },
      {
        id: "tool",
        messages: [{ role: "user", content: "Use the supplied lookup tool." }],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }],
        expected: { type: "tool_call", functionName: "lookup", requiredArgument: "query" },
      },
    ],
  }), "utf8");

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const requestBody = await body(request);
      requests.push(requestBody);
      const isTool = Array.isArray(requestBody.tools);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: isTool
          ? { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "lookup", arguments: JSON.stringify({ query: "fixture" }) } }] }
          : { role: "assistant", content: expectedLabel } }],
      }));
      return;
    }
    response.writeHead(404).end();
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const args = [
      "tools/live-provider-qualification.mjs",
      "--base-url", `http://127.0.0.1:${address.port}/v1`,
      "--requested-provider", "fixture",
      "--requested-model", "fixture-model",
      "--actual-provider", "fixture",
      "--actual-model", "fixture-model",
      "--route-proof-uri", "https://example.invalid/model",
      "--route-mode", "PINNED",
      "--execution-class", "LIVE_DIRECT",
      "--strict-output-contract", "true",
      "--suite", suitePath,
      "--repeat", "1",
      "--allow-loopback", "true",
      "--output", output,
    ];
    const run = await new Promise<{ code: number | null }>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code }));
    });
    assert.equal(run.code, 0);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0]?.stop, [" "]);
    assert.equal(requests[0]?.tool_choice, undefined);
    assert.equal(JSON.stringify(requests[0]).includes(expectedLabel), false);
    assert.equal(requests[1]?.stop, undefined);
    assert.deepEqual(requests[1]?.tool_choice, { type: "function", function: { name: "lookup" } });
    assert.equal(JSON.stringify(requests[1]).includes(expectedLabel), false);

    const report = JSON.parse(await readFile(output, "utf8")) as { requestControls: { strictOutputContract: boolean } };
    assert.equal(report.requestControls.strictOutputContract, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});
