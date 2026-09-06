import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const EXPECTED_CANDIDATE = "78aa33e2b4ab25af14a88b285fceea3eecd67fbd";
const EXPECTED_TREE = "cdff0ec0e635c47d7a03b6244da514abf0e4c349";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const PLANNER_KIND = "model-gateway-investigation-brief-v0.1";
const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 120000;

function parseArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "<missing>"}`);
    values.set(key.slice(2), value);
  }
  return values;
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

class NvidiaTextProvider {
  kind = "nvidia-nim-live-direct-evaluation";
  calls = [];

  constructor(apiKey) { this.apiKey = apiKey; }

  async generate(request, context) {
    const call = { request: structuredClone(request), upstreamStatus: null, upstreamBody: null, providerResult: null, providerError: null };
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
      try { body = text.length === 0 ? null : JSON.parse(text); }
      catch (error) { throw new Error("NVIDIA NIM returned non-JSON transport response.", { cause: error }); }
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

function parseRaw(text) {
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return null; }
}

const values = parseArgs(process.argv.slice(2));
const subjectRoot = resolve(values.get("subject-root") ?? "subject");
const suitePath = resolve(values.get("suite") ?? "evidence/nvidia-semantic-regression-v0.2.json");
const outputPath = resolve(values.get("output") ?? "evidence-output/regression.json");
const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey || apiKey.length < 8) throw new Error("NVIDIA_API_KEY is required.");

const suite = JSON.parse(await readFile(suitePath, "utf8"));
if (!Array.isArray(suite.cases) || suite.cases.length !== 4) throw new Error("Regression suite must contain exactly four cases.");

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

const startedAt = new Date().toISOString();
const runs = [];
for (let index = 0; index < suite.cases.length; index += 1) {
  const evaluationCase = suite.cases[index];
  const input = {
    runId: `semantic-regression-${evaluationCase.id.toLowerCase()}-1`,
    intentVersionId: `semantic-regression-intent-${evaluationCase.id.toLowerCase()}-1`,
    objective: evaluationCase.objective,
    context: evaluationCase.context ?? [],
  };
  const callIndex = provider.calls.length;
  const start = performance.now();
  let parsedBrief = null;
  let plannerError = null;
  try { parsedBrief = await planner.plan(input); }
  catch (error) { plannerError = compactError(error); }
  const call = provider.calls[callIndex] ?? null;
  const rawPlannerOutput = rawTextFromCall(call);
  const rawParsedJson = parseRaw(rawPlannerOutput);
  runs.push({
    ordinal: index + 1,
    caseId: evaluationCase.id,
    caseKind: evaluationCase.kind,
    elapsedMs: Number((performance.now() - start).toFixed(3)),
    input,
    requestedModel: NVIDIA_MODEL,
    actualModel: call?.providerResult?.route?.actualModel ?? call?.providerResult?.response?.model ?? null,
    route: call?.providerResult?.route ?? null,
    providerMetadata: call?.providerResult?.metadata ?? null,
    upstreamStatus: call?.upstreamStatus ?? null,
    canonicalRequest: call?.request ?? null,
    rawPlannerOutput,
    rawParsedJson,
    modelCreatedAt: rawParsedJson && typeof rawParsedJson === "object" && !Array.isArray(rawParsedJson) && Object.hasOwn(rawParsedJson, "createdAt") ? rawParsedJson.createdAt : null,
    parsedBrief,
    acceptedCreatedAt: parsedBrief?.createdAt ?? null,
    schemaAccepted: parsedBrief !== null,
    plannerError,
    semanticVerdict: "UNREVIEWED",
  });
}

const report = {
  schemaVersion: 1,
  workItem: "Investigation Planner changed-candidate semantic discriminator",
  suiteId: suite.suiteId,
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
  },
  runs,
  evaluationBoundary: "Four-case changed-candidate discriminator only. No full corpus, held-out acceptance, prompt tuning, acquisition integration, V36 truth, Decision, or Authorization.",
};

await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ candidate: EXPECTED_CANDIDATE, summary: report.summary, output: outputPath }));
if (report.summary.schemaRejected > 0) process.exitCode = 1;
