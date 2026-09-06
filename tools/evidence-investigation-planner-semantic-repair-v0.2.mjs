import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const EXPECTED_CANDIDATE = "82db9e437fd5080bf3eb2e6536240043a96636d3";
const EXPECTED_TREE = "1cbc4d815506f9d89f7a7544aee9bf6ffeb28ad3";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const PLANNER_KIND = "model-gateway-investigation-brief-v0.1";
const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 120000;

const CASES = [
  {
    caseId: "missing-user-controlled-prerequisite",
    input: {
      runId: "semantic-repair-private-contract-1",
      intentVersionId: "semantic-repair-private-contract-intent-1",
      objective: "I need to understand whether I can satisfy a customer's private contract requirement. I haven't shared the contract language or the customer's email. What should I investigate?",
      context: [],
    },
  },
  {
    caseId: "dependency-order-cycle-avoidance",
    input: {
      runId: "semantic-repair-renovation-1",
      intentVersionId: "semantic-repair-renovation-intent-1",
      objective: "I want to remove a wall and redo my kitchen, but I don't know what I need to check before I start. What should I investigate?",
      context: [],
    },
  },
];

function compactError(error) {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error) };
  const causeChain = [];
  let current = error;
  while (current instanceof Error && causeChain.length < 8) {
    causeChain.push({ name: current.name, message: current.message });
    current = current.cause;
  }
  return { name: error.name, message: error.message, causeChain };
}

class RecordingProvider {
  constructor(inner) {
    this.inner = inner;
    this.kind = inner.kind;
    this.structuredOutputCapability = inner.structuredOutputCapability;
    this.calls = [];
  }

  async generate(request, context) {
    const call = {
      canonicalRequest: structuredClone(request),
      context: {
        correlationId: context.correlationId,
        requestIdentity: context.requestIdentity,
        attempt: context.attempt,
      },
      providerResult: null,
      providerError: null,
    };
    this.calls.push(call);
    try {
      const result = await this.inner.generate(request, context);
      call.providerResult = structuredClone(result);
      return result;
    } catch (error) {
      call.providerError = compactError(error);
      throw error;
    }
  }
}

function rawTextFromCall(call) {
  const output = call?.providerResult?.response?.output;
  if (!Array.isArray(output) || output.length !== 1 || output[0]?.type !== "text") return null;
  return output[0].text;
}

function parseRawJson(rawText) {
  if (typeof rawText !== "string") return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error(`Expected --key value arguments; got ${key ?? "<missing>"}.`);
  }
  values.set(key.slice(2), value);
}

const subjectRoot = resolve(values.get("subject-root") ?? "subject");
const outputPath = resolve(values.get("output") ?? "evidence-output/semantic-repair-small-gate.json");
const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey || apiKey.length < 8) throw new Error("NVIDIA_API_KEY is required.");

const knowledgeModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/knowledge/investigation-brief.js")));
const modelModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/index.js")));
const pinnedProviderModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/pinned-external-research-provider.js")));
const { ModelGatewayKnowledgeInvestigationPlanner } = knowledgeModule;
const { ModelRuntime } = modelModule;
const { PinnedExternalResearchModelProvider } = pinnedProviderModule;

const innerProvider = new PinnedExternalResearchModelProvider({
  baseUrl: NVIDIA_BASE_URL,
  providerId: "nvidia",
  apiKey,
  structuredOutputMode: "nvidia-guided-json",
});
const recordingProvider = new RecordingProvider(innerProvider);
const runtime = new ModelRuntime(recordingProvider, { timeoutMs: TIMEOUT_MS });
const planner = new ModelGatewayKnowledgeInvestigationPlanner(runtime, {
  model: NVIDIA_MODEL,
  plannerKind: PLANNER_KIND,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
});

const startedAt = new Date().toISOString();
const runs = [];
for (const evaluationCase of CASES) {
  const callIndex = recordingProvider.calls.length;
  const started = performance.now();
  let parsedBrief = null;
  let plannerError = null;
  try {
    parsedBrief = await planner.plan(evaluationCase.input);
  } catch (error) {
    plannerError = compactError(error);
  }
  const elapsedMs = Number((performance.now() - started).toFixed(3));
  const call = recordingProvider.calls[callIndex] ?? null;
  const rawPlannerOutput = rawTextFromCall(call);
  runs.push({
    caseId: evaluationCase.caseId,
    input: evaluationCase.input,
    elapsedMs,
    canonicalRequest: call?.canonicalRequest ?? null,
    requestIdentity: call?.context?.requestIdentity ?? null,
    providerKind: recordingProvider.kind,
    providerResult: call?.providerResult ?? null,
    providerError: call?.providerError ?? null,
    rawPlannerOutput,
    rawParsedJson: parseRawJson(rawPlannerOutput),
    parsedBrief,
    canonicalAccepted: parsedBrief !== null,
    plannerError,
    semanticVerdict: "UNREVIEWED",
  });
}

const report = {
  schemaVersion: 1,
  experiment: "Investigation Planner semantic repair v0.2 bounded NVIDIA discriminator",
  candidate: { head: EXPECTED_CANDIDATE, tree: EXPECTED_TREE },
  runtime: {
    executionClass: "LIVE_DIRECT",
    routeMode: "PINNED",
    provider: "nvidia",
    baseUrl: NVIDIA_BASE_URL,
    requestedModel: NVIDIA_MODEL,
    plannerKind: PLANNER_KIND,
    temperature: 0,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    modelRuntimeTimeoutMs: TIMEOUT_MS,
    canonicalStructuredOutputType: "json_schema",
    nativeAdapterMode: "nvidia-guided-json",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  startedAt,
  completedAt: new Date().toISOString(),
  summary: {
    attempts: runs.length,
    canonicalAccepted: runs.filter((run) => run.canonicalAccepted).length,
    canonicalRejected: runs.filter((run) => !run.canonicalAccepted).length,
    semanticReviewed: 0,
  },
  runs,
  interpretationBoundary: "This is a two-case changed-candidate discriminator for the established prerequisite/dependency defects. Canonical acceptance is not semantic capability proof; raw output must be independently reviewed, and no full corpus is authorized by this run.",
};

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  candidate: report.candidate,
  attempts: report.summary.attempts,
  canonicalAccepted: report.summary.canonicalAccepted,
  canonicalRejected: report.summary.canonicalRejected,
  output: outputPath,
}));
if (report.summary.canonicalRejected > 0) process.exitCode = 1;
