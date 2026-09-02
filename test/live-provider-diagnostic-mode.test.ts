import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  boundedDiagnosticObserved,
  buildNvidiaQualificationArgs,
} from "../tools/render-live-provider-qualification.mjs";

test("NVIDIA diagnostic mode forwards only explicit failed scenario IDs", () => {
  const args = buildNvidiaQualificationArgs({
    sourceRevision: "diag123",
    output: "report.json",
    diagnosticScenarioIds: "web-source-provenance,web-search-tool-call",
  });
  assert.equal(args[args.indexOf("--scenario-ids") + 1], "web-source-provenance,web-search-tool-call");
  assert.equal(args[args.indexOf("--repeat") + 1], "3");
});

test("bounded diagnostic observations never exceed the fixed log boundary", () => {
  assert.equal(boundedDiagnosticObserved("S2 with explanation"), "S2 with explanation");
  const bounded = boundedDiagnosticObserved("x".repeat(500));
  assert.ok(bounded !== null);
  assert.equal(bounded.length, 321);
  assert.ok(bounded.endsWith("…"));
});

test("qualification runner marks a scenario subset diagnostic-only and does not execute unselected scenarios", async () => {
  const temp = await mkdtemp(join(tmpdir(), "lattice-m9-diag-"));
  const suitePath = join(temp, "suite.json");
  const output = join(temp, "report.json");
  const token = "DIAGNOSTIC_TEST_TOKEN";
  await writeFile(suitePath, JSON.stringify({
    suiteId: "diagnostic-fixture",
    scenarios: [
      {
        id: "selected",
        messages: [{ role: "user", content: "selected" }],
        expected: { type: "exact_content", value: "OK" },
      },
      {
        id: "must-not-run",
        messages: [{ role: "user", content: "must-not-run" }],
        expected: { type: "exact_content", value: "NO" },
      },
    ],
  }), "utf8");

  let chatCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      chatCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }));
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
      "--token-env", "DIAGNOSTIC_TOKEN",
      "--suite", suitePath,
      "--scenario-ids", "selected",
      "--repeat", "1",
      "--source-revision", "diag-revision",
      "--allow-loopback", "true",
      "--output", output,
    ];
    const result = await new Promise<{ code: number | null }>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: { ...process.env, DIAGNOSTIC_TOKEN: token },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code }));
    });
    assert.equal(result.code, 0);
    assert.equal(chatCalls, 1);
    const report = JSON.parse(await readFile(output, "utf8")) as {
      diagnosticOnly: boolean;
      diagnosticScenarioIds: string[];
      summary: { attempts: number; passes: number };
      qualificationBoundary: string;
    };
    assert.equal(report.diagnosticOnly, true);
    assert.deepEqual(report.diagnosticScenarioIds, ["selected"]);
    assert.deepEqual(report.summary, { attempts: 1, passes: 1, failures: 0, passRate: 1, rateLimited: 0, unavailable: 0, timeouts: 0, malformedResponses: 0 });
    assert.match(report.qualificationBoundary, /cannot establish M9-4 provider qualification/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
});
