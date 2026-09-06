import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const EXPECTED_CANDIDATE = "2c843cb1dc4ae6a4ca31bb54f7fb7de83d3a8fe5";
const EXPECTED_TREE = "93a60e93ddc10f02136ad4ef029c136fb789eb8c";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const PLANNER_KIND = "model-gateway-investigation-brief-v0.1";
const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 120000;

const INPUT = {
  runId: "semantic-regression-renovation-public-1",
  intentVersionId: "semantic-regression-intent-renovation-public-1",
  objective: "I want to remove a wall and redo my kitchen, but I don't know what I need to check before I start. What should I investigate?",
  context: [],
};

const id = { type: "string", minLength: 1, maxLength: 200 };
const boundedText = { type: "string", minLength: 1, maxLength: 2000 };
const INVESTIGATION_BRIEF_PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "briefId",
    "runId",
    "intentVersionId",
    "objective",
    "issues",
    "missingFacts",
    "sourceRequirements",
    "dependencies",
    "plannerKind",
  ],
  properties: {
    briefId: id,
    runId: id,
    intentVersionId: id,
    objective: { type: "string", minLength: 1, maxLength: 8000 },
    issues: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issueId", "question", "materiality", "rationale"],
        properties: {
          issueId: id,
          question: boundedText,
          materiality: { enum: ["MATERIAL", "CONTEXTUAL"] },
          rationale: boundedText,
        },
      },
    },
    missingFacts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["factId", "question", "acquisitionMode", "materiality", "rationale"],
        properties: {
          factId: id,
          question: boundedText,
          acquisitionMode: { enum: ["USER_ONLY", "RESEARCHABLE", "UNKNOWN"] },
          materiality: { enum: ["MATERIAL", "CONTEXTUAL"] },
          rationale: boundedText,
        },
      },
    },
    sourceRequirements: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "requirementId",
          "issueIds",
          "authorityNeed",
          "jurisdictionNeeded",
          "currentnessNeeded",
          "description",
        ],
        properties: {
          requirementId: id,
          issueIds: { type: "array", maxItems: 8, items: id },
          authorityNeed: {
            enum: [
              "PRIMARY_OR_OFFICIAL",
              "HIGH_QUALITY_SECONDARY",
              "GENERAL_ORIENTATION",
              "UNKNOWN",
            ],
          },
          jurisdictionNeeded: { type: "boolean" },
          currentnessNeeded: { type: "boolean" },
          description: boundedText,
        },
      },
    },
    dependencies: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "dependencyId",
          "blockedIssueId",
          "dependsOnIssueIds",
          "dependsOnFactIds",
          "rationale",
        ],
        properties: {
          dependencyId: id,
          blockedIssueId: id,
          dependsOnIssueIds: { type: "array", maxItems: 8, items: id },
          dependsOnFactIds: { type: "array", maxItems: 8, items: id },
          rationale: boundedText,
        },
      },
    },
    plannerKind: id,
  },
};

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

function parseRaw(rawText) {
  if (typeof rawText !== "string") return null;
  try { return JSON.parse(rawText); } catch { return null; }
}

const values = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "<missing>"}`);
  values.set(key.slice(2), value);
}

const subjectRoot = resolve(values.get("subject-root") ?? "subject");
const outputPath = resolve(values.get("output") ?? "evidence-output/product-structured-renovation.json");
const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey || apiKey.length < 8) throw new Error("NVIDIA_API_KEY is required.");

const knowledgeModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/knowledge/investigation-brief.js")));
const modelModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/index.js")));
const pinnedProviderModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/pinned-external-research-provider.js")));
const { ModelGatewayKnowledgeInvestigationPlanner } = knowledgeModule;
const { ModelRuntime } = modelModule;
const { PinnedExternalResearchModelProvider } = pinnedProviderModule;

const transport = {
  url: null,
  requestWithoutCredential: null,
  status: null,
  responseBody: null,
};

const productProvider = new PinnedExternalResearchModelProvider({
  baseUrl: NVIDIA_BASE_URL,
  providerId: "nvidia",
  apiKey,
  structuredOutputMode: "nvidia-guided-json",
  fetchImpl: async (input, init) => {
    transport.url = String(input);
    transport.requestWithoutCredential = typeof init?.body === "string"
      ? JSON.parse(init.body)
      : null;
    const response = await fetch(input, init);
    transport.status = response.status;
    const clonedText = await response.clone().text();
    try { transport.responseBody = clonedText.length === 0 ? null : JSON.parse(clonedText); }
    catch { transport.responseBody = { nonJsonTransportResponse: true }; }
    return response;
  },
});
const productRuntime = new ModelRuntime(productProvider, { timeoutMs: TIMEOUT_MS });

const bridge = {
  kind: "evidence-planner-to-product-structured-output-bridge",
  calls: [],
  async generate(request, context) {
    const call = {
      plannerCanonicalRequest: structuredClone(request),
      productCanonicalRequest: null,
      productRuntimeResult: null,
      error: null,
    };
    this.calls.push(call);
    const productCanonicalRequest = {
      ...request,
      structuredOutput: {
        type: "json_schema",
        schema: INVESTIGATION_BRIEF_PROPOSAL_SCHEMA,
      },
    };
    call.productCanonicalRequest = structuredClone(productCanonicalRequest);
    try {
      const result = await productRuntime.call(productCanonicalRequest, {
        correlationId: `${context.correlationId}-structured-output`,
        maxAttempts: 1,
        signal: context.signal,
        invocation: {
          executionClass: "LIVE_DIRECT",
          routeMode: "PINNED",
          requestedProvider: "nvidia",
        },
      });
      call.productRuntimeResult = structuredClone(result);
      const provenance = result.audit.invocationProvenance;
      return {
        response: result.response,
        metadata: {
          upstreamStatus: result.audit.providerMetadata.upstreamStatus ?? null,
          productStructuredOutputPath: true,
        },
        route: {
          ...(provenance.actualProvider === null ? {} : { actualProvider: provenance.actualProvider }),
          ...(provenance.actualModel === null ? {} : { actualModel: provenance.actualModel }),
          ...(provenance.upstreamRequestId === null ? {} : { upstreamRequestId: provenance.upstreamRequestId }),
        },
      };
    } catch (error) {
      call.error = compactError(error);
      throw error;
    }
  },
};

const plannerRuntime = new ModelRuntime(bridge, { timeoutMs: TIMEOUT_MS });
const planner = new ModelGatewayKnowledgeInvestigationPlanner(plannerRuntime, {
  model: NVIDIA_MODEL,
  plannerKind: PLANNER_KIND,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
});

const startedAt = new Date().toISOString();
const started = performance.now();
let parsedBrief = null;
let plannerError = null;
try {
  parsedBrief = await planner.plan(INPUT);
} catch (error) {
  plannerError = compactError(error);
}
const elapsedMs = Number((performance.now() - started).toFixed(3));
const call = bridge.calls[0] ?? null;
const outputItem = call?.productRuntimeResult?.response?.output?.[0] ?? null;
const rawPlannerOutput = outputItem?.type === "text" ? outputItem.text : null;
const rawParsedJson = parseRaw(rawPlannerOutput);
const modelCreatedAt = rawParsedJson && typeof rawParsedJson === "object" && !Array.isArray(rawParsedJson)
  && Object.hasOwn(rawParsedJson, "createdAt")
  ? rawParsedJson.createdAt
  : null;

const report = {
  schemaVersion: 1,
  experiment: "Investigation Planner NVIDIA provider-neutral structured-output product-path discriminator",
  diagnosticOnly: true,
  productCapabilityCredit: "structured-output-mechanical-boundary-only",
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
  elapsedMs,
  input: INPUT,
  plannerCanonicalRequest: call?.plannerCanonicalRequest ?? null,
  productCanonicalRequest: call?.productCanonicalRequest ?? null,
  productRequestIdentity: call?.productRuntimeResult?.audit?.requestIdentity ?? null,
  providerKind: call?.productRuntimeResult?.audit?.providerKind ?? null,
  invocationProvenance: call?.productRuntimeResult?.audit?.invocationProvenance ?? null,
  transport,
  rawPlannerOutput,
  rawParsedJson,
  modelCreatedAt,
  parsedBrief,
  acceptedCreatedAt: parsedBrief?.createdAt ?? null,
  schemaAccepted: parsedBrief !== null,
  plannerError,
  interpretationBoundary: "This run proves only that the provider-neutral CanonicalModelRequest structuredOutput contract reaches the configured NVIDIA adapter, is translated to native guided_json, returns canonical text output, and still passes through the unchanged InvestigationBrief validator. It does not establish Investigation Planner semantic capability.",
};

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  candidate: EXPECTED_CANDIDATE,
  tree: EXPECTED_TREE,
  schemaAccepted: report.schemaAccepted,
  upstreamStatus: report.transport.status,
  finishReason: report.transport.responseBody?.choices?.[0]?.finish_reason ?? null,
  elapsedMs,
  output: outputPath,
}));
if (!report.schemaAccepted) process.exitCode = 1;
