import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const EXPECTED_CANDIDATE = "5608ae5bdf1500d7d1427c7375b326c82c8bdf23";
const EXPECTED_TREE = "d8aa91a501495b4a87e550a6856f74d5d935ec61";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const PLANNER_KIND = "model-gateway-investigation-brief-v0.1";
const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 120000;

const HELD_OUT_CASE = {
  suiteId: "investigation-planner-semantic-heldout-owner-2026-09-05",
  cases: [{
    id: "HELDOUT-USED-EV-PRIVATE-SALE",
    kind: "HELDOUT",
    repeat: 1,
    objective: "I'm thinking about buying a used electric car from a private seller. They say the battery is healthy and the title is clean, but I don't really know what I should verify before I pay them. What should I investigate?",
    context: [],
  }],
};

function parseArgs(argv) {
  const out = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "<missing>"}`);
    out.set(key.slice(2), value);
  }
  return out;
}

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

function structuralSummary(brief) {
  if (!brief) return null;
  return {
    issueCount: brief.issues.length,
    materialIssueCount: brief.issues.filter((x) => x.materiality === "MATERIAL").length,
    missingFactCount: brief.missingFacts.length,
    acquisitionModes: Object.fromEntries(["USER_ONLY", "RESEARCHABLE", "UNKNOWN"].map((mode) => [
      mode,
      brief.missingFacts.filter((x) => x.acquisitionMode === mode).length,
    ])),
    sourceRequirementCount: brief.sourceRequirements.length,
    dependencyCount: brief.dependencies.length,
  };
}

function authorityShapeScan(rawText) {
  if (typeof rawText !== "string") return [];
  const patterns = [
    ["decision", /\bdecision(?:plan)?\b/iu],
    ["authorization", /\bauthori[sz](?:ation|e|ed)\b/iu],
    ["truth-verdict", /\b(?:verdict|proven|confirmed)\b/iu],
    ["invented-preference", /\b(?:you prefer|your preference|you require|your requirement)\b/iu],
  ];
  return patterns.filter(([, regex]) => regex.test(rawText)).map(([label]) => label);
}

class NvidiaTextProvider {
  kind = "nvidia-nim-live-direct-evaluation";
  calls = [];

  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async generate(request, context) {
    const call = {
      request: structuredClone(request),
      context: {
        correlationId: context.correlationId,
        requestIdentity: context.requestIdentity,
        attempt: context.attempt,
      },
      upstreamStatus: null,
      upstreamBody: null,
      providerResult: null,
      providerError: null,
    };
    this.calls.push(call);

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
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(({ role, content }) => ({ role, content })),
          temperature: request.temperature ?? 0,
          max_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
          chat_template_kwargs: { enable_thinking: false },
          stream: false,
        }),
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

function rawTextFromCall(call) {
  const output = call?.providerResult?.response?.output;
  return Array.isArray(output) && output.length === 1 && output[0]?.type === "text" ? output[0].text : null;
}

function parseRaw(rawText) {
  if (typeof rawText !== "string") return null;
  try { return JSON.parse(rawText); } catch { return null; }
}

async function runSuite({ suite, planner, provider, suiteLabel }) {
  const startedAt = new Date().toISOString();
  const runs = [];
  let ordinal = 0;

  for (const evaluationCase of suite.cases) {
    for (let iteration = 1; iteration <= evaluationCase.repeat; iteration += 1) {
      ordinal += 1;
      const input = {
        runId: `semantic-nvidia-${evaluationCase.id.toLowerCase()}-${iteration}`,
        intentVersionId: `semantic-nvidia-intent-${evaluationCase.id.toLowerCase()}-${iteration}`,
        objective: evaluationCase.objective,
        context: evaluationCase.context,
      };
      const callIndex = provider.calls.length;
      const started = performance.now();
      let parsedBrief = null;
      let plannerError = null;
      try {
        parsedBrief = await planner.plan(input);
      } catch (error) {
        plannerError = compactError(error);
      }
      const elapsedMs = Number((performance.now() - started).toFixed(3));
      const call = provider.calls[callIndex] ?? null;
      const rawPlannerOutput = rawTextFromCall(call);
      const rawParsedJson = parseRaw(rawPlannerOutput);
      const modelCreatedAt = rawParsedJson && typeof rawParsedJson === "object" && !Array.isArray(rawParsedJson) && Object.hasOwn(rawParsedJson, "createdAt")
        ? rawParsedJson.createdAt
        : null;

      runs.push({
        ordinal,
        caseId: evaluationCase.id,
        caseKind: evaluationCase.kind,
        iteration,
        elapsedMs,
        input,
        requestedModel: NVIDIA_MODEL,
        actualModel: call?.providerResult?.route?.actualModel ?? call?.providerResult?.response?.model ?? null,
        route: call?.providerResult?.route ?? null,
        providerMetadata: call?.providerResult?.metadata ?? null,
        upstreamStatus: call?.upstreamStatus ?? null,
        canonicalRequest: call?.request ?? null,
        rawPlannerOutput,
        rawParsedJson,
        modelCreatedAt,
        parsedBrief,
        acceptedCreatedAt: parsedBrief?.createdAt ?? null,
        schemaAccepted: parsedBrief !== null,
        plannerError,
        structuralSummary: structuralSummary(parsedBrief),
        authorityShapeSignals: authorityShapeScan(rawPlannerOutput),
        semanticVerdict: "UNREVIEWED",
        semanticFailureReason: null,
      });
    }
  }

  return {
    schemaVersion: 1,
    workItem: "Investigation Planner Semantic Capability Proof v0.1",
    suiteId: suite.suiteId,
    suiteLabel,
    candidate: { head: EXPECTED_CANDIDATE, tree: EXPECTED_TREE },
    startedAt,
    completedAt: new Date().toISOString(),
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
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    summary: {
      attempts: runs.length,
      schemaAccepted: runs.filter((run) => run.schemaAccepted).length,
      schemaRejected: runs.filter((run) => !run.schemaAccepted).length,
      semanticReviewed: 0,
      note: "Schema acceptance is not semantic capability proof. Preserve all outputs; independently review every run and do not average away critical failures.",
    },
    runs,
    evaluationBoundary: "Evidence-only execution against the frozen PR #11 candidate. No prompt tuning, acquisition integration, V36 truth, Decision, Authorization, or Product acceptance is performed here.",
  };
}

const values = parseArgs(process.argv.slice(2));
const subjectRoot = resolve(values.get("subject-root") ?? "subject");
const suitePath = resolve(values.get("suite") ?? "evidence/nvidia-semantic-remaining-v0.1.json");
const outputDir = resolve(values.get("output-dir") ?? "evidence-output");
const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey || apiKey.length < 8) throw new Error("NVIDIA_API_KEY is required.");

const knowledgeModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/knowledge/investigation-brief.js")));
const modelModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/index.js")));
const { ModelGatewayKnowledgeInvestigationPlanner } = knowledgeModule;
const { ModelRuntime } = modelModule;

const provider = new NvidiaTextProvider(apiKey);
const runtime = new ModelRuntime(provider, { timeoutMs: TIMEOUT_MS });
const planner = new ModelGatewayKnowledgeInvestigationPlanner(runtime, {
  model: NVIDIA_MODEL,
  plannerKind: PLANNER_KIND,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
});

const publicRemainingSuite = JSON.parse(await readFile(suitePath, "utf8"));
await mkdir(outputDir, { recursive: true });

const publicReport = await runSuite({ suite: publicRemainingSuite, planner, provider, suiteLabel: "remaining-public-adversarial" });
await writeFile(resolve(outputDir, "public-remaining.json"), `${JSON.stringify(publicReport, null, 2)}\n`, "utf8");

const heldoutReport = await runSuite({ suite: HELD_OUT_CASE, planner, provider, suiteLabel: "evaluator-held" });
await writeFile(resolve(outputDir, "heldout.json"), `${JSON.stringify(heldoutReport, null, 2)}\n`, "utf8");

const manifest = {
  schemaVersion: 1,
  candidate: { head: EXPECTED_CANDIDATE, tree: EXPECTED_TREE },
  reusedEvidence: {
    firstNvidiaKb03: {
      workflowRunId: 34003958564,
      semanticDisposition: "BOUNDED_PASS_WITH_TENSION",
      note: "Counted as KB-03 observation 1; not rerun in this corpus.",
    },
  },
  newEvidence: {
    publicAdversarialAttempts: publicReport.summary.attempts,
    heldoutAttempts: heldoutReport.summary.attempts,
    totalNewAttempts: publicReport.summary.attempts + heldoutReport.summary.attempts,
  },
  completedAt: new Date().toISOString(),
};
await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  candidate: EXPECTED_CANDIDATE,
  publicAdversarial: publicReport.summary,
  heldout: heldoutReport.summary,
  outputDir,
}));
