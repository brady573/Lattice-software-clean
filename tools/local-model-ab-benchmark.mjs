import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const [command = "run", ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`Expected --key value arguments; got ${key ?? "<missing>"}.`);
    }
    values.set(key.slice(2), value);
  }
  return { command, values };
}

function required(values, name) {
  const value = values.get(name);
  if (value === undefined || value.length === 0) fail(`--${name} is required.`);
  return value;
}

function optionalInteger(values, name, fallback, min, max) {
  const raw = values.get(name);
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !loopback.has(url.hostname)) {
    fail("Benchmark base URL must be an HTTP(S) loopback URL.");
  }
  return value.replace(/\/+$/, "");
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluateExpected(responseJson, expected) {
  const choice = responseJson?.choices?.[0];
  const message = choice?.message;
  if (expected.type === "exact_content") {
    return {
      pass: typeof message?.content === "string" && message.content.trim() === expected.value,
      observed: typeof message?.content === "string" ? message.content.trim() : null,
    };
  }
  if (expected.type === "json_equal") {
    if (typeof message?.content !== "string") return { pass: false, observed: null };
    try {
      const parsed = JSON.parse(message.content);
      return { pass: deepEqualJson(parsed, expected.value), observed: parsed };
    } catch {
      return { pass: false, observed: message.content };
    }
  }
  if (expected.type === "tool_call") {
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const matching = calls.find((call) => call?.function?.name === expected.functionName);
    if (matching === undefined) return { pass: false, observed: calls };
    try {
      const args = JSON.parse(matching.function?.arguments ?? "{}");
      const requiredArgument = expected.requiredArgument;
      const pass = typeof args?.[requiredArgument] === "string" && args[requiredArgument].trim().length > 0;
      return { pass, observed: { functionName: matching.function.name, arguments: args } };
    } catch {
      return { pass: false, observed: matching };
    }
  }
  fail(`Unsupported expected type: ${expected.type}`);
}

async function fetchJson(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body;
  try {
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    fail(`Non-JSON response from ${url}: HTTP ${response.status}`);
  }
  if (!response.ok) fail(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  return body;
}

async function runBenchmark(values) {
  const baseUrl = normalizeBaseUrl(values.get("base-url") ?? "http://127.0.0.1:8080/v1");
  const model = required(values, "model");
  const label = values.get("label") ?? model;
  const suitePath = values.get("suite") ?? "benchmarks/local-model-agent-v1.json";
  const output = required(values, "output");
  const repeat = optionalInteger(values, "repeat", 3, 1, 20);
  const timeoutMs = optionalInteger(values, "timeout-ms", 120000, 1000, 600000);
  const suite = JSON.parse(await readFile(suitePath, "utf8"));
  if (!Array.isArray(suite.scenarios) || suite.scenarios.length === 0) fail("Benchmark suite has no scenarios.");

  const startedAt = new Date().toISOString();
  let exposedModels = null;
  try {
    exposedModels = await fetchJson(`${baseUrl}/models`, { method: "GET" }, Math.min(timeoutMs, 15000));
  } catch (error) {
    exposedModels = { probeError: error instanceof Error ? error.message : String(error) };
  }

  const results = [];
  for (const scenario of suite.scenarios) {
    for (let iteration = 1; iteration <= repeat; iteration += 1) {
      const request = {
        model,
        messages: scenario.messages,
        temperature: 0,
        max_tokens: scenario.maxOutputTokens ?? 128,
        chat_template_kwargs: { enable_thinking: false },
        ...(scenario.tools === undefined ? {} : { tools: scenario.tools }),
      };
      const start = performance.now();
      try {
        const responseJson = await fetchJson(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer offline-local" },
            body: JSON.stringify(request),
          },
          timeoutMs,
        );
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        const evaluation = evaluateExpected(responseJson, scenario.expected);
        results.push({
          scenarioId: scenario.id,
          iteration,
          pass: evaluation.pass,
          latencyMs,
          usage: responseJson?.usage ?? null,
          observed: evaluation.observed,
        });
      } catch (error) {
        results.push({
          scenarioId: scenario.id,
          iteration,
          pass: false,
          latencyMs: Math.round((performance.now() - start) * 100) / 100,
          usage: null,
          observed: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const latencies = results.map((result) => result.latencyMs);
  const passes = results.filter((result) => result.pass).length;
  const report = {
    schemaVersion: 1,
    suiteId: suite.suiteId,
    suitePath,
    startedAt,
    completedAt: new Date().toISOString(),
    model: {
      label,
      requestedModel: model,
      baseUrl,
      temperature: 0,
      enableThinking: false,
      repeat,
      timeoutMs,
    },
    exposedModels,
    summary: {
      attempts: results.length,
      passes,
      failures: results.length - passes,
      passRate: results.length === 0 ? 0 : passes / results.length,
      meanLatencyMs: latencies.length === 0 ? null : Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
    },
    results,
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report.summary));
}

async function compareReports(values) {
  const leftPath = required(values, "left");
  const rightPath = required(values, "right");
  const left = JSON.parse(await readFile(leftPath, "utf8"));
  const right = JSON.parse(await readFile(rightPath, "utf8"));
  if (left.suiteId !== right.suiteId) fail(`Suite mismatch: ${left.suiteId} vs ${right.suiteId}.`);
  if (left.summary?.attempts !== right.summary?.attempts) fail("Attempt-count mismatch; rerun with equivalent repeat counts.");
  const leftRate = left.summary?.passRate ?? 0;
  const rightRate = right.summary?.passRate ?? 0;
  let preferred = "TIE";
  let reason = "Equivalent correctness; latency metrics do not show consistent dominance.";
  if (leftRate !== rightRate) {
    preferred = leftRate > rightRate ? "LEFT" : "RIGHT";
    reason = "Higher deterministic benchmark pass rate.";
  } else {
    const latencyKeys = ["meanLatencyMs", "p50LatencyMs", "p95LatencyMs"];
    const leftLatency = latencyKeys.map((key) => left.summary?.[key]);
    const rightLatency = latencyKeys.map((key) => right.summary?.[key]);
    const complete = [...leftLatency, ...rightLatency].every((value) => typeof value === "number" && Number.isFinite(value));
    if (complete) {
      const leftDominates = leftLatency.every((value, index) => value < rightLatency[index]);
      const rightDominates = rightLatency.every((value, index) => value < leftLatency[index]);
      if (leftDominates || rightDominates) {
        preferred = leftDominates ? "LEFT" : "RIGHT";
        reason = "Correctness tied; lower mean, p50, and p95 latency.";
      }
    }
  }
  const comparison = {
    schemaVersion: 1,
    suiteId: left.suiteId,
    left: { label: left.model?.label, summary: left.summary },
    right: { label: right.model?.label, summary: right.summary },
    preferred,
    reason,
    evidenceBoundary: "Benchmark preference only; does not establish Lattice Product acceptance or general model superiority.",
  };
  console.log(JSON.stringify(comparison, null, 2));
}

const { command, values } = parseArgs(process.argv.slice(2));
if (command === "run") {
  await runBenchmark(values);
} else if (command === "compare") {
  await compareReports(values);
} else {
  fail(`Unknown command: ${command}. Use run or compare.`);
}
