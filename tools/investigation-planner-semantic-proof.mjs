import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  ModelGatewayKnowledgeInvestigationPlanner,
} from "../dist/src/knowledge/investigation-brief.js";
import {
  ModelRuntime,
  OpenAiCompatibleModelProvider,
} from "../dist/src/model/index.js";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`Expected --key value arguments; got ${key ?? "<missing>"}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name)?.trim();
  if (!value) fail(`--${name} is required.`);
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

function normalizeCases(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("Case suite must be an object.");
  if (typeof raw.suiteId !== "string" || raw.suiteId.trim().length === 0) fail("Case suite requires suiteId.");
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) fail("Case suite requires non-empty cases.");
  const seen = new Set();
  const cases = raw.cases.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) fail(`Case ${index + 1} must be an object.`);
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) fail(`Case ${index + 1} requires a unique id.`);
    seen.add(id);
    const objective = typeof item.objective === "string" ? item.objective.trim() : "";
    if (!objective) fail(`Case ${id} requires objective.`);
    const context = item.context === undefined ? [] : item.context;
    if (!Array.isArray(context) || context.some((value) => typeof value !== "string")) {
      fail(`Case ${id} context must be an array of strings.`);
    }
    const repeat = item.repeat === undefined ? null : item.repeat;
    if (repeat !== null && (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10)) {
      fail(`Case ${id} repeat must be an integer between 1 and 10.`);
    }
    return {
      id,
      kind: typeof item.kind === "string" && item.kind.trim() ? item.kind.trim() : "UNSPECIFIED",
      objective,
      context: [...context],
      repeat,
    };
  });
  return { suiteId: raw.suiteId.trim(), cases };
}

function getApiKey(values) {
  const name = values.get("api-key-env")?.trim();
  if (!name) return undefined;
  if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(name)) fail("--api-key-env must name an uppercase environment variable.");
  const value = process.env[name];
  if (!value || value.length < 4) fail(`Environment variable ${name} is missing or invalid.`);
  return value;
}

function compactError(error) {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error) };
  const chain = [];
  let current = error;
  while (current instanceof Error && chain.length < 6) {
    chain.push({ name: current.name, message: current.message });
    current = current.cause;
  }
  return { name: error.name, message: error.message, causeChain: chain };
}

class RecordingProvider {
  constructor(inner) {
    this.inner = inner;
    this.kind = inner.kind;
    this.calls = [];
  }

  async generate(request, context) {
    const call = {
      request: structuredClone(request),
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

function structuralSummary(brief) {
  if (!brief) return null;
  return {
    issueCount: brief.issues.length,
    materialIssueCount: brief.issues.filter((issue) => issue.materiality === "MATERIAL").length,
    missingFactCount: brief.missingFacts.length,
    acquisitionModes: Object.fromEntries(
      ["USER_ONLY", "RESEARCHABLE", "UNKNOWN"].map((mode) => [
        mode,
        brief.missingFacts.filter((fact) => fact.acquisitionMode === mode).length,
      ]),
    ),
    sourceRequirementCount: brief.sourceRequirements.length,
    dependencyCount: brief.dependencies.length,
  };
}

function authorityShapeScan(rawText) {
  if (typeof rawText !== "string") return [];
  const patterns = [
    ["decision", /\bdecision(?:plan)?\b/iu],
    ["authorization", /\bauthori[sz](?:ation|e|ed)\b/iu],
    ["truth-verdict", /\b(?:true|false|verdict|proven|confirmed)\b/iu],
    ["invented-preference", /\b(?:you prefer|your preference|you require|your requirement)\b/iu],
  ];
  return patterns.filter(([, pattern]) => pattern.test(rawText)).map(([label]) => label);
}

function rawTextFromCall(call) {
  const output = call?.providerResult?.response?.output;
  if (!Array.isArray(output)) return null;
  if (output.length !== 1 || output[0]?.type !== "text") return null;
  return output[0].text;
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const baseUrl = required(values, "base-url");
  const model = required(values, "model");
  const casesPath = resolve(values.get("cases") ?? "benchmarks/investigation-planner-semantic-public-v0.1.json");
  const outputPath = resolve(required(values, "output"));
  const defaultRepeat = optionalInteger(values, "repeat", 1, 1, 10);
  const maxOutputTokens = optionalInteger(values, "max-output-tokens", 2000, 256, 8000);
  const plannerKind = values.get("planner-kind")?.trim() || "model-gateway-investigation-brief-v0.1";
  const apiKey = getApiKey(values);
  const suite = normalizeCases(JSON.parse(await readFile(casesPath, "utf8")));

  const recordingProvider = new RecordingProvider(new OpenAiCompatibleModelProvider({ baseUrl, apiKey }));
  const runtime = new ModelRuntime(recordingProvider);
  const planner = new ModelGatewayKnowledgeInvestigationPlanner(runtime, {
    model,
    plannerKind,
    maxOutputTokens,
  });

  const startedAt = new Date().toISOString();
  const runs = [];
  let ordinal = 0;

  for (const evaluationCase of suite.cases) {
    const repeat = evaluationCase.repeat ?? defaultRepeat;
    for (let iteration = 1; iteration <= repeat; iteration += 1) {
      ordinal += 1;
      const runId = `semantic-proof-${evaluationCase.id.toLowerCase()}-${iteration}`;
      const intentVersionId = `semantic-proof-intent-${evaluationCase.id.toLowerCase()}-${iteration}`;
      const input = {
        runId,
        intentVersionId,
        objective: evaluationCase.objective,
        context: evaluationCase.context,
      };
      const callIndex = recordingProvider.calls.length;
      let brief = null;
      let plannerError = null;
      try {
        brief = await planner.plan(input);
      } catch (error) {
        plannerError = compactError(error);
      }
      const call = recordingProvider.calls[callIndex] ?? null;
      const rawText = rawTextFromCall(call);
      runs.push({
        ordinal,
        caseId: evaluationCase.id,
        caseKind: evaluationCase.kind,
        iteration,
        input,
        providerKind: recordingProvider.kind,
        requestedModel: model,
        actualModel: call?.providerResult?.route?.actualModel ?? call?.providerResult?.response?.model ?? null,
        route: call?.providerResult?.route ?? null,
        providerMetadata: call?.providerResult?.metadata ?? null,
        canonicalRequest: call?.request ?? null,
        rawPlannerOutput: rawText,
        parsedBrief: brief,
        schemaAccepted: brief !== null,
        plannerError,
        structuralSummary: structuralSummary(brief),
        authorityShapeSignals: authorityShapeScan(rawText),
        semanticVerdict: "UNREVIEWED",
        semanticFailureReason: null,
      });
    }
  }

  const completedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    workItem: "Investigation Planner Semantic Capability Proof v0.1",
    suiteId: suite.suiteId,
    suitePath: basename(casesPath),
    startedAt,
    completedAt,
    runtime: {
      providerKind: recordingProvider.kind,
      baseUrl,
      authentication: apiKey === undefined ? "NONE" : "BEARER_ENV",
      requestedModel: model,
      plannerKind,
      temperature: 0,
      maxOutputTokens,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    summary: {
      attempts: runs.length,
      schemaAccepted: runs.filter((run) => run.schemaAccepted).length,
      schemaRejected: runs.filter((run) => !run.schemaAccepted).length,
      semanticReviewed: 0,
      note: "Schema acceptance is not semantic capability proof. Every run requires independent rubric review; critical failures cannot be averaged away.",
    },
    runs,
    evaluationBoundary: "This harness records the actual ModelGatewayKnowledgeInvestigationPlanner path and raw planner text. It does not self-certify semantic quality, source authority, truth, Decision, Authorization, acquisition integration, or Expert-Knowledge Bridge completion.",
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    suiteId: suite.suiteId,
    attempts: report.summary.attempts,
    schemaAccepted: report.summary.schemaAccepted,
    schemaRejected: report.summary.schemaRejected,
    output: outputPath,
  }));

  if (report.summary.schemaRejected > 0) process.exitCode = 1;
}

await main();
