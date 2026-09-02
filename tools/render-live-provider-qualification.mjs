import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";

const GROQ_OUTPUT = ".local-bench/m9-4-groq-gpt-oss-20b.json";
const NVIDIA_OUTPUT = ".local-bench/m9-4-nvidia-nemotron-3.5-lightning-30b-a3b.json";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

let statusServer = null;
let currentSummary = null;

export function buildQualificationArgs({
  sourceRevision = process.env.RENDER_GIT_COMMIT,
  output = process.env.M9_QUALIFICATION_OUTPUT ?? GROQ_OUTPUT,
} = {}) {
  if (!sourceRevision?.trim()) throw new Error("RENDER_GIT_COMMIT is required for exact M9-4 source provenance.");
  return [
    "tools/live-provider-qualification.mjs",
    "--base-url", "https://api.groq.com/openai/v1",
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
    "--repeat", "3",
    "--source-revision", sourceRevision.trim(),
    "--output", output,
  ];
}

export function buildNvidiaQualificationArgs({
  sourceRevision = process.env.RENDER_GIT_COMMIT,
  output = process.env.M9_QUALIFICATION_OUTPUT ?? NVIDIA_OUTPUT,
  diagnosticScenarioIds = process.env.M9_NVIDIA_DIAGNOSTIC_SCENARIOS?.trim() || "",
} = {}) {
  if (!sourceRevision?.trim()) throw new Error("RENDER_GIT_COMMIT is required for exact M9-4 source provenance.");
  return [
    "tools/live-provider-qualification.mjs",
    "--base-url", NVIDIA_BASE_URL,
    "--requested-provider", "nvidia",
    "--requested-model", NVIDIA_MODEL,
    "--actual-provider", "nvidia",
    "--actual-model", NVIDIA_MODEL,
    "--route-proof-uri", "https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b",
    "--route-mode", "PINNED",
    "--execution-class", "LIVE_DIRECT",
    "--token-env", "NVIDIA_API_KEY",
    "--disable-thinking", "true",
    "--strict-output-contract", "true",
    "--json-mode-scenarios", "structured-action-contract",
    ...(diagnosticScenarioIds ? ["--scenario-ids", diagnosticScenarioIds] : []),
    "--min-completion-tokens", "64",
    "--repeat", "3",
    "--source-revision", sourceRevision.trim(),
    "--output", output,
  ];
}

export function buildNvidiaSmokeRequest() {
  return {
    model: NVIDIA_MODEL,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 64,
    stream: false,
  };
}

export function observedResponseModel(body) {
  const value = body?.model;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function sanitizeProviderError(body) {
  const source = body?.error && typeof body.error === "object" ? body.error : body;
  if (!source || typeof source !== "object") return null;
  const out = {};
  for (const key of ["type", "code", "message"]) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function boundedDiagnosticObserved(observed) {
  if (observed === null || observed === undefined) return null;
  const serialized = typeof observed === "string" ? observed : JSON.stringify(observed);
  if (typeof serialized !== "string") return null;
  return serialized.length <= 320 ? serialized : `${serialized.slice(0, 320)}…`;
}

export function summaryHttpStatus(summary) {
  if (summary?.status === "PASS" || summary?.status === "DIAGNOSTIC_PASS" || summary?.status === "RUNNING") return 200;
  return 503;
}

function serveSummary(summary, label) {
  currentSummary = summary;
  if (statusServer === null) {
    const port = Number(process.env.PORT ?? "10000");
    statusServer = http.createServer((_request, response) => {
      const active = currentSummary ?? { status: "FAIL", workItem: "M9-4" };
      response.writeHead(summaryHttpStatus(active), { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(active));
    });
    statusServer.listen(port, "0.0.0.0", () => {
      console.log(`${label} ${JSON.stringify(summary)}`);
    });
    return;
  }
  console.log(`${label} ${JSON.stringify(summary)}`);
}

async function probeNvidiaModelIdentity() {
  const token = process.env.NVIDIA_API_KEY;
  if (!token || token.length < 8) throw new Error("NVIDIA_API_KEY is required.");
  const observedAt = new Date().toISOString();
  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(buildNvidiaSmokeRequest()),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    throw new Error("M9 NVIDIA model-identity probe returned non-JSON response.");
  }
  if (!response.ok) {
    const error = sanitizeProviderError(body);
    throw new Error(`M9 NVIDIA model-identity probe failed: status=${response.status} code=${error?.code ?? "none"}`);
  }
  const observedModel = observedResponseModel(body);
  if (observedModel === null) throw new Error("M9 NVIDIA model-identity probe did not return a model field.");
  if (observedModel !== NVIDIA_MODEL) {
    throw new Error(`M9 NVIDIA model-identity mismatch: expected=${NVIDIA_MODEL} observed=${observedModel}`);
  }
  return {
    source: "CHAT_COMPLETION_RESPONSE",
    observedModel,
    observedAt,
    status: response.status,
  };
}

async function runNvidiaSmokeDiagnostic() {
  const startedAt = new Date().toISOString();
  let status = null;
  let error = null;
  let observedModel = null;
  try {
    const identity = await probeNvidiaModelIdentity();
    status = identity.status;
    observedModel = identity.observedModel;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const result = {
    diagnostic: "NVIDIA_MINIMAL_CHAT_SMOKE",
    sourceRevision: process.env.RENDER_GIT_COMMIT?.trim() || null,
    provider: "nvidia",
    model: NVIDIA_MODEL,
    observedModel,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    ok: status !== null && status >= 200 && status < 300 && observedModel === NVIDIA_MODEL && error === null,
    error,
    boundary: "Transport/request-contract and response-model identity diagnostic only; no benchmark or Product acceptance claim.",
  };
  console.log(`M9_NVIDIA_SMOKE_DIAGNOSTIC ${JSON.stringify(result)}`);
  serveSummary({ status: result.ok ? "DIAGNOSTIC_PASS" : "DIAGNOSTIC_FAIL", ...result }, result.ok ? "M9_NVIDIA_SMOKE_PASS" : "M9_NVIDIA_SMOKE_FAIL");
}

async function runQualification(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export function publicSummary(report) {
  const fullPass = report?.summary?.failures === 0 && report?.summary?.passRate === 1;
  const status = report?.diagnosticOnly === true
    ? (fullPass ? "DIAGNOSTIC_PASS" : "DIAGNOSTIC_FAIL")
    : (fullPass ? "PASS" : "FAIL");
  return {
    status,
    workItem: report?.workItem ?? "M9-4",
    sourceRevision: report?.sourceRevision ?? null,
    suiteId: report?.suiteId ?? null,
    diagnosticOnly: report?.diagnosticOnly ?? false,
    diagnosticScenarioIds: report?.diagnosticScenarioIds ?? [],
    completedAt: report?.completedAt ?? null,
    route: report?.route ?? null,
    requestControls: report?.requestControls ?? null,
    summary: report?.summary ?? null,
    qualificationBoundary: report?.qualificationBoundary ?? null,
  };
}

function failureDiagnostics(report, includeObserved = false) {
  return {
    diagnosticOnly: report?.diagnosticOnly ?? false,
    diagnosticScenarioIds: report?.diagnosticScenarioIds ?? [],
    modelProbe: {
      ok: report?.modelProbe?.ok ?? null,
      status: report?.modelProbe?.status ?? null,
      error: report?.modelProbe?.error ?? null,
    },
    failures: Array.isArray(report?.results)
      ? report.results.filter((result) => result?.pass !== true).map((result) => ({
          scenarioId: result?.scenarioId ?? null,
          iteration: result?.iteration ?? null,
          status: result?.status ?? null,
          error: result?.error ?? null,
          ...(includeObserved ? { observed: boundedDiagnosticObserved(result?.observed) } : {}),
        }))
      : [],
  };
}

export async function main() {
  if (process.env.RENDER !== "true") throw new Error("Render M9-4 qualification surface requires RENDER=true.");

  const providerCandidate = process.env.M9_PROVIDER_CANDIDATE?.trim().toLowerCase() || "groq";
  serveSummary({
    status: "RUNNING",
    workItem: "M9-4",
    sourceRevision: process.env.RENDER_GIT_COMMIT?.trim() || null,
    providerCandidate,
    qualificationBoundary: "Execution in progress; RUNNING is not provider qualification, Product acceptance, routing policy, or production readiness.",
  }, "M9_RENDER_QUALIFICATION_RUNNING");

  try {
    if (providerCandidate === "nvidia" && process.env.M9_NVIDIA_SMOKE_ONLY === "true") {
      await runNvidiaSmokeDiagnostic();
      return;
    }

    let output;
    let args;
    let routeObservation = null;
    if (providerCandidate === "groq") {
      if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.length < 8) throw new Error("GROQ_API_KEY is required.");
      output = process.env.M9_QUALIFICATION_OUTPUT ?? GROQ_OUTPUT;
      args = buildQualificationArgs({ output });
    } else if (providerCandidate === "nvidia") {
      if (!process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY.length < 8) throw new Error("NVIDIA_API_KEY is required.");
      output = process.env.M9_QUALIFICATION_OUTPUT ?? NVIDIA_OUTPUT;
      args = buildNvidiaQualificationArgs({ output });
      routeObservation = await probeNvidiaModelIdentity();
    } else {
      throw new Error(`Unsupported M9_PROVIDER_CANDIDATE: ${providerCandidate}`);
    }

    await mkdir(".local-bench", { recursive: true });
    const code = await runQualification(args);
    const report = JSON.parse(await readFile(output, "utf8"));
    if (routeObservation !== null) {
      report.route = {
        ...report.route,
        actualModel: routeObservation.observedModel,
        provenanceCompleteness: "COMPLETE",
        responseModelEvidence: routeObservation,
      };
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    const summary = publicSummary(report);
    const includeObserved = providerCandidate === "nvidia"
      && report?.diagnosticOnly === true
      && process.env.M9_NVIDIA_DIAGNOSTIC_OBSERVED === "true";
    if (code !== 0 || report?.summary?.failures !== 0 || report?.summary?.passRate !== 1 || report?.diagnosticOnly === true) {
      console.log(`M9_RENDER_QUALIFICATION_DIAGNOSTICS ${JSON.stringify(failureDiagnostics(report, includeObserved))}`);
      serveSummary(summary, `M9_RENDER_QUALIFICATION_${summary.status} provider=${providerCandidate}`);
      return;
    }

    serveSummary(summary, "M9_RENDER_QUALIFICATION_PASS");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    serveSummary({
      status: "FAIL",
      workItem: "M9-4",
      sourceRevision: process.env.RENDER_GIT_COMMIT?.trim() || null,
      providerCandidate,
      error: message,
      qualificationBoundary: "Execution failed before provider qualification; no Product acceptance, routing policy, or production-readiness claim.",
    }, "M9_RENDER_QUALIFICATION_FAIL");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
