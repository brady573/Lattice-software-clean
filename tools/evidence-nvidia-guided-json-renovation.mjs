import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const EXPECTED_CANDIDATE = "63aa1c39e9e22c66f8374cc9f7d05ca1793249fd";
const EXPECTED_TREE = "8e614a4bcc8b31f118a8e206ad6c2897d7a789aa";
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

class NvidiaGuidedJsonProvider {
  kind = "nvidia-nim-live-direct-guided-json-evidence";
  calls = [];

  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async generate(request, context) {
    const call = {
      canonicalRequest: structuredClone(request),
      upstreamRequest: null,
      upstreamStatus: null,
      upstreamBody: null,
      providerResult: null,
      providerError: null,
    };
    this.calls.push(call);

    const upstreamRequest = {
      model: request.model,
      messages: request.messages.map(({ role, content }) => ({ role, content })),
      temperature: request.temperature ?? 0,
      max_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      chat_template_kwargs: { enable_thinking: false },
      guided_json: INVESTIGATION_BRIEF_PROPOSAL_SCHEMA,
      stream: false,
    };
    call.upstreamRequest = structuredClone(upstreamRequest);

    try {
      const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
        method: "POST",
        redirect: "error",
        signal: context.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "x-lattice-correlation-id": context.correlationId,
        },
        body: JSON.stringify(upstreamRequest),
      });

      call.upstreamStatus = response.status;
      const text = await response.text();
      let body = null;
      try {
        body = text.length === 0 ? null : JSON.parse(text);
      } catch (error) {
        throw new Error("NVIDIA NIM returned non-JSON transport response.", { cause: error });
      }
      call.upstreamBody = structuredClone(body);
      if (!response.ok) throw new Error(`NVIDIA NIM returned HTTP ${response.status}.`);

      const choice = body?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== "string") throw new Error("NVIDIA NIM returned no text content.");

      const result = {
        response: {
          id: typeof body?.id === "string" ? body.id : `nvidia-${context.requestIdentity.slice(0, 16)}-${context.attempt}`,
          model: typeof body?.model === "string" ? body.model : request.model,
          output: [{ type: "text", text: content }],
        },
        metadata: {
          upstreamStatus: response.status,
          upstreamRequestId: typeof body?.id === "string" ? body.id : null,
          finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
          usage: body?.usage ?? null,
          generationConstraint: "guided_json",
        },
        route: {
          actualProvider: "nvidia",
          actualModel: typeof body?.model === "string" ? body.model : request.model,
          ...(typeof body?.id === "string" ? { upstreamRequestId: body.id } : {}),
        },
      };
      call.providerResult = structuredClone(result);
      return result;
    } catch (error) {
      call.providerError = compactError(error);
      throw error;
    }
  }
}

const values = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "<missing>"}`);
  values.set(key.slice(2), value);
}

const subjectRoot = resolve(values.get("subject-root") ?? "subject");
const outputPath = resolve(values.get("output") ?? "evidence-output/guided-json-renovation.json");
const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey || apiKey.length < 8) throw new Error("NVIDIA_API_KEY is required.");

const knowledgeModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/knowledge/investigation-brief.js")));
const modelModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/index.js")));
const { ModelGatewayKnowledgeInvestigationPlanner } = knowledgeModule;
const { ModelRuntime } = modelModule;

const provider = new NvidiaGuidedJsonProvider(apiKey);
const runtime = new ModelRuntime(provider, { timeoutMs: TIMEOUT_MS });
const planner = new ModelGatewayKnowledgeInvestigationPlanner(runtime, {
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
const call = provider.calls[0] ?? null;
const rawPlannerOutput = call?.providerResult?.response?.output?.[0]?.text ?? null;
const rawParsedJson = parseRaw(rawPlannerOutput);

const report = {
  schemaVersion: 1,
  experiment: "Investigation Planner NVIDIA guided_json renovation discriminator",
  diagnosticOnly: true,
  productCapabilityCredit: false,
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
    generationConstraint: "guided_json",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  startedAt,
  completedAt: new Date().toISOString(),
  elapsedMs,
  input: INPUT,
  canonicalRequest: call?.canonicalRequest ?? null,
  guidedJsonSchema: INVESTIGATION_BRIEF_PROPOSAL_SCHEMA,
  upstreamRequestWithoutCredential: call?.upstreamRequest ?? null,
  upstreamStatus: call?.upstreamStatus ?? null,
  providerMetadata: call?.providerResult?.metadata ?? null,
  providerRoute: call?.providerResult?.route ?? null,
  providerError: call?.providerError ?? null,
  rawPlannerOutput,
  rawParsedJson,
  parsedBrief,
  schemaAccepted: parsedBrief !== null,
  plannerError,
  interpretationBoundary: "Diagnostic only. The planner request content is generated by the exact repaired candidate. The evidence provider changes only inference-time structured generation by adding NVIDIA guided_json; this is not the current canonical Lattice request surface and does not establish Product capability.",
};

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  candidate: EXPECTED_CANDIDATE,
  tree: EXPECTED_TREE,
  schemaAccepted: report.schemaAccepted,
  upstreamStatus: report.upstreamStatus,
  finishReason: report.providerMetadata?.finishReason ?? null,
  elapsedMs,
  output: outputPath,
}));
