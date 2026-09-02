import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`Expected --key value arguments; got ${key ?? "<missing>"}.`);
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (value === undefined || value.trim().length === 0) fail(`--${name} is required.`);
  return value.trim();
}

function optionalInteger(values, name, fallback, min, max) {
  const raw = values.get(name);
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`--${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function optionalBoolean(values, name, fallback = false) {
  const raw = values.get(name);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  fail(`--${name} must be true or false.`);
}

function optionalIdSet(values, name) {
  const raw = values.get(name)?.trim();
  if (!raw) return new Set();
  const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0 || new Set(ids).size !== ids.length) fail(`--${name} must contain unique comma-separated scenario IDs.`);
  return new Set(ids);
}

function normalizeBaseUrl(value, allowLoopback) {
  const url = new URL(value);
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const isLoopback = loopback.has(url.hostname);
  if (isLoopback && allowLoopback) {
    if (url.protocol !== "http:" && url.protocol !== "https:") fail("Loopback qualification URL must use HTTP(S).");
  } else if (url.protocol !== "https:" || isLoopback) {
    fail("Live provider qualification requires a non-loopback HTTPS base URL.");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluateExpected(responseJson, expected) {
  const message = responseJson?.choices?.[0]?.message;
  if (expected.type === "exact_content") {
    return { pass: typeof message?.content === "string" && message.content.trim() === expected.value, observed: typeof message?.content === "string" ? message.content.trim() : null };
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
    if (!matching) return { pass: false, observed: calls };
    try {
      const args = JSON.parse(matching.function?.arguments ?? "{}");
      const value = args?.[expected.requiredArgument];
      return { pass: typeof value === "string" && value.trim().length > 0, observed: { functionName: matching.function.name, arguments: args } };
    } catch {
      return { pass: false, observed: matching };
    }
  }
  fail(`Unsupported expected type: ${expected.type}`);
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const name of [
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "x-request-id",
    "request-id",
  ]) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

async function requestJson(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try {
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    return { ok: false, status: response.status, headers: sanitizeHeaders(response.headers), body: null, error: "NON_JSON_RESPONSE" };
  }
  return { ok: response.ok, status: response.status, headers: sanitizeHeaders(response.headers), body, ...(response.ok ? {} : { error: `HTTP_${response.status}` }) };
}

function authHeaders(values) {
  const tokenEnv = values.get("token-env");
  if (tokenEnv === undefined) return { "content-type": "application/json" };
  if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(tokenEnv)) fail("--token-env must name an uppercase environment variable.");
  const token = process.env[tokenEnv];
  if (token === undefined || token.length < 8) fail(`Environment variable ${tokenEnv} is missing or invalid.`);
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const allowLoopback = values.get("allow-loopback") === "true";
  const baseUrl = normalizeBaseUrl(required(values, "base-url"), allowLoopback);
  const requestedProvider = required(values, "requested-provider");
  const requestedModel = required(values, "requested-model");
  const actualProvider = required(values, "actual-provider");
  const actualModel = required(values, "actual-model");
  const routeProofUri = required(values, "route-proof-uri");
  const routeProofRevision = values.get("route-proof-revision")?.trim() || null;
  const routeMode = required(values, "route-mode");
  if (routeMode !== "PINNED") fail("M9-4 qualification accepts route-mode PINNED only.");
  const executionClass = required(values, "execution-class");
  if (executionClass !== "LIVE_BROKERED" && executionClass !== "LIVE_DIRECT") fail("M9-4 qualification requires LIVE_BROKERED or LIVE_DIRECT.");
  const brokerIdentity = values.get("broker")?.trim() || null;
  if (executionClass === "LIVE_BROKERED" && brokerIdentity === null) fail("--broker is required for LIVE_BROKERED qualification.");
  if (executionClass === "LIVE_DIRECT" && brokerIdentity !== null) fail("--broker must be omitted for LIVE_DIRECT qualification.");
  if (executionClass === "LIVE_BROKERED" && routeProofRevision === null) fail("--route-proof-revision is required for LIVE_BROKERED qualification.");

  const suitePath = values.get("suite") ?? "benchmarks/local-model-agent-v1.json";
  const output = required(values, "output");
  const repeat = optionalInteger(values, "repeat", 3, 1, 10);
  const timeoutMs = optionalInteger(values, "timeout-ms", 60000, 1000, 180000);
  const minCompletionTokens = optionalInteger(values, "min-completion-tokens", 0, 0, 4096);
  const reasoningEffort = values.get("reasoning-effort")?.trim();
  if (reasoningEffort === "") fail("--reasoning-effort must be non-empty when provided.");
  const disableThinking = optionalBoolean(values, "disable-thinking", false);
  const strictOutputContract = optionalBoolean(values, "strict-output-contract", false);
  const jsonModeScenarios = optionalIdSet(values, "json-mode-scenarios");
  const diagnosticScenarioIds = optionalIdSet(values, "scenario-ids");
  const sourceRevision = values.get("source-revision")?.trim() || process.env.RENDER_GIT_COMMIT?.trim() || null;
  const suite = JSON.parse(await readFile(suitePath, "utf8"));
  if (!Array.isArray(suite.scenarios) || suite.scenarios.length === 0) fail("Qualification suite has no scenarios.");
  const scenarioIds = new Set(suite.scenarios.map((scenario) => scenario.id));
  for (const scenarioId of jsonModeScenarios) {
    if (!scenarioIds.has(scenarioId)) fail(`--json-mode-scenarios references unknown scenario: ${scenarioId}`);
  }
  for (const scenarioId of diagnosticScenarioIds) {
    if (!scenarioIds.has(scenarioId)) fail(`--scenario-ids references unknown scenario: ${scenarioId}`);
  }
  const diagnosticOnly = diagnosticScenarioIds.size > 0;
  const selectedScenarios = diagnosticOnly
    ? suite.scenarios.filter((scenario) => diagnosticScenarioIds.has(scenario.id))
    : suite.scenarios;
  if (selectedScenarios.length === 0) fail("Diagnostic scenario selection is empty.");
  const headers = authHeaders(values);
  const startedAt = new Date().toISOString();

  let modelProbe = null;
  try {
    modelProbe = await requestJson(`${baseUrl}/models`, { method: "GET", headers }, Math.min(timeoutMs, 15000));
  } catch (error) {
    modelProbe = { ok: false, status: null, headers: {}, body: null, error: error instanceof Error ? error.name : "MODEL_PROBE_FAILED" };
  }

  const results = [];
  for (const scenario of selectedScenarios) {
    for (let iteration = 1; iteration <= repeat; iteration += 1) {
      const scenarioCompletionTokens = scenario.maxOutputTokens ?? 128;
      const exactContentContract = strictOutputContract && scenario.expected?.type === "exact_content";
      const toolCallContract = strictOutputContract && scenario.expected?.type === "tool_call";
      const soleToolName = toolCallContract && Array.isArray(scenario.tools) && scenario.tools.length === 1 && typeof scenario.tools[0]?.function?.name === "string"
        ? scenario.tools[0].function.name
        : null;
      const strictToolChoice = soleToolName === null
        ? (toolCallContract ? "required" : "auto")
        : { type: "function", function: { name: soleToolName } };
      const request = {
        model: requestedModel,
        messages: scenario.messages,
        temperature: 0,
        max_tokens: Math.max(scenarioCompletionTokens, minCompletionTokens),
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
        ...(disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        ...(jsonModeScenarios.has(scenario.id) ? { response_format: { type: "json_object" } } : {}),
        ...(exactContentContract ? { stop: [" "] } : {}),
        ...(scenario.tools === undefined ? {} : { tools: scenario.tools, tool_choice: strictToolChoice }),
      };
      const start = performance.now();
      try {
        const response = await requestJson(`${baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(request) }, timeoutMs);
        const latencyMs = Math.round((performance.now() - start) * 100) / 100;
        if (!response.ok) {
          results.push({ scenarioId: scenario.id, iteration, pass: false, latencyMs, status: response.status, headers: response.headers, observed: null, error: response.error });
          continue;
        }
        const evaluation = evaluateExpected(response.body, scenario.expected);
        results.push({ scenarioId: scenario.id, iteration, pass: evaluation.pass, latencyMs, status: response.status, headers: response.headers, usage: response.body?.usage ?? null, observed: evaluation.observed });
      } catch (error) {
        results.push({ scenarioId: scenario.id, iteration, pass: false, latencyMs: Math.round((performance.now() - start) * 100) / 100, status: null, headers: {}, observed: null, error: error instanceof Error ? error.name : String(error) });
      }
    }
  }

  const passes = results.filter((result) => result.pass).length;
  const report = {
    schemaVersion: 2,
    workItem: "M9-4",
    sourceRevision,
    suiteId: suite.suiteId,
    suitePath,
    diagnosticOnly,
    diagnosticScenarioIds: [...diagnosticScenarioIds],
    startedAt,
    completedAt: new Date().toISOString(),
    route: {
      executionClass,
      routeMode,
      requestedProvider,
      requestedModel,
      actualProvider,
      actualModel,
      brokerIdentity,
      provenanceCompleteness: "COMPLETE",
      proof: { uri: routeProofUri, revision: routeProofRevision, observedAt: startedAt },
    },
    requestControls: {
      reasoningEffort: reasoningEffort ?? null,
      minCompletionTokens,
      disableThinking,
      strictOutputContract,
      jsonModeScenarios: [...jsonModeScenarios],
    },
    transport: {
      baseUrl,
      authentication: values.has("token-env") ? "BEARER_ENV" : "NONE",
      tokenEnvironmentVariable: values.get("token-env") ?? null,
      executionEnvironment: process.env.RENDER === "true" ? "RENDER" : "OTHER",
      renderServiceId: process.env.RENDER_SERVICE_ID ?? null,
      renderBranch: process.env.RENDER_GIT_BRANCH ?? null,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
    },
    modelProbe,
    summary: {
      attempts: results.length,
      passes,
      failures: results.length - passes,
      passRate: results.length === 0 ? 0 : passes / results.length,
      rateLimited: results.filter((result) => result.status === 429).length,
      unavailable: results.filter((result) => typeof result.status === "number" && result.status >= 500).length,
      timeouts: results.filter((result) => result.error === "TimeoutError").length,
      malformedResponses: results.filter((result) => result.error === "NON_JSON_RESPONSE").length,
    },
    results,
    qualificationBoundary: diagnosticOnly
      ? "Diagnostic scenario subset only; cannot establish M9-4 provider qualification, Product acceptance, V36 truth, routing policy, or production readiness."
      : "Provider/model route qualification evidence only; does not establish Lattice Product acceptance, V36 truth, routing policy, production readiness, or provider authority.",
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ sourceRevision: report.sourceRevision, route: report.route, diagnosticOnly: report.diagnosticOnly, diagnosticScenarioIds: report.diagnosticScenarioIds, summary: report.summary }));
  if (passes !== results.length) process.exitCode = 1;
}

await main();
