import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const SUBJECT_SHA = "5608ae5bdf1500d7d1427c7375b326c82c8bdf23";
const SUBJECT_TREE = "d8aa91a501495b4a87e550a6856f74d5d935ec61";
const MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const BASE_URL = "https://integrate.api.nvidia.com/v1";
const ROUTE_PROOF_URI = "https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b";
const OUTPUT_PATH = resolve(process.env.OUTPUT_PATH ?? "evidence/kb03-nvidia-nemotron-discriminator.json");
const subjectRoot = process.env.SUBJECT_ROOT?.trim();
if (!subjectRoot) throw new Error("SUBJECT_ROOT is required.");

const investigationModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/knowledge/investigation-brief.js")).href);
const modelModule = await import(pathToFileURL(resolve(subjectRoot, "dist/src/model/index.js")).href);
const { ModelGatewayKnowledgeInvestigationPlanner } = investigationModule;
const { ModelRuntime } = modelModule;

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

function runNode(args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
  });
}

class QualifiedNvidiaTextProvider {
  kind = "nvidia-nim-live-direct-evaluation";
  calls = [];

  async generate(request, context) {
    const call = {
      request: structuredClone(request),
      providerResult: null,
      providerError: null,
      qualificationReport: null,
      helperExitCode: null,
    };
    this.calls.push(call);

    const tempRoot = await mkdtemp(resolve(tmpdir(), "lattice-nvidia-kb03-"));
    const suitePath = resolve(tempRoot, "suite.json");
    const reportPath = resolve(tempRoot, "report.json");
    const suite = {
      suiteId: "investigation-planner-nvidia-single-capture-v0.1",
      scenarios: [{
        id: "planner-capture",
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        maxOutputTokens: request.maxOutputTokens ?? 2000,
        expected: { type: "exact_content", value: "__LATTICE_CAPTURE_SENTINEL_DO_NOT_MATCH__" },
      }],
    };
    await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, "utf8");

    try {
      const helper = await runNode([
        "tools/live-provider-qualification.mjs",
        "--base-url", BASE_URL,
        "--requested-provider", "nvidia",
        "--requested-model", request.model,
        "--actual-provider", "nvidia",
        "--actual-model", request.model,
        "--route-proof-uri", ROUTE_PROOF_URI,
        "--route-mode", "PINNED",
        "--execution-class", "LIVE_DIRECT",
        "--token-env", "NVIDIA_API_KEY",
        "--disable-thinking", "true",
        "--strict-output-contract", "false",
        "--min-completion-tokens", "0",
        "--repeat", "1",
        "--timeout-ms", "120000",
        "--source-revision", SUBJECT_SHA,
        "--suite", suitePath,
        "--output", reportPath,
      ], subjectRoot);
      call.helperExitCode = helper.code;

      const report = JSON.parse(await readFile(reportPath, "utf8"));
      call.qualificationReport = report;
      const result = report?.results?.[0];
      const content = result?.observed;
      if (typeof content !== "string") {
        throw new Error(`NVIDIA capture produced no text output; status=${result?.status ?? "unknown"} error=${result?.error ?? "none"}.`);
      }

      const providerResult = {
        response: {
          id: report?.modelProbe?.body?.id ?? `nvidia-${context.requestIdentity.slice(0, 16)}-${context.attempt}`,
          model: report?.route?.actualModel ?? request.model,
          output: [{ type: "text", text: content }],
        },
        metadata: {
          upstreamStatus: result?.status ?? null,
          usage: result?.usage ?? null,
          helperExitCode: helper.code,
        },
        route: {
          actualProvider: "nvidia",
          actualModel: report?.route?.actualModel ?? request.model,
        },
      };
      call.providerResult = structuredClone(providerResult);
      return providerResult;
    } catch (error) {
      call.providerError = compactError(error);
      throw error;
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

const input = {
  runId: "semantic-nvidia-kb-03-1",
  intentVersionId: "semantic-nvidia-intent-kb-03-1",
  objective: "I want to start selling food I make at home. Can I do that and what do I actually have to do?",
  context: [],
};

const provider = new QualifiedNvidiaTextProvider();
const runtime = new ModelRuntime(provider, { timeoutMs: 120_000 });
const planner = new ModelGatewayKnowledgeInvestigationPlanner(runtime, {
  model: MODEL,
  plannerKind: "model-gateway-investigation-brief-v0.1",
  maxOutputTokens: 2_000,
});

const startedAt = new Date().toISOString();
const start = performance.now();
let parsedBrief = null;
let plannerError = null;
try {
  parsedBrief = await planner.plan(input);
} catch (error) {
  plannerError = compactError(error);
}
const completedAt = new Date().toISOString();
const elapsedMs = Number((performance.now() - start).toFixed(3));
const call = provider.calls[0] ?? null;
const rawPlannerOutput = call?.providerResult?.response?.output?.[0]?.type === "text"
  ? call.providerResult.response.output[0].text
  : null;
let rawParsedJson = null;
if (rawPlannerOutput !== null) {
  try { rawParsedJson = JSON.parse(rawPlannerOutput); } catch {}
}
const modelCreatedAt = rawParsedJson !== null && typeof rawParsedJson === "object" && !Array.isArray(rawParsedJson) && Object.hasOwn(rawParsedJson, "createdAt")
  ? rawParsedJson.createdAt
  : null;

const report = {
  schemaVersion: 1,
  experiment: "KB-03 NVIDIA Nemotron InvestigationBrief discriminator",
  candidate: { head: SUBJECT_SHA, tree: SUBJECT_TREE },
  runtime: {
    executionClass: "LIVE_DIRECT",
    routeMode: "PINNED",
    provider: "nvidia",
    baseUrl: BASE_URL,
    requestedModel: MODEL,
    temperature: 0,
    maxOutputTokens: 2000,
    modelRuntimeTimeoutMs: 120000,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  startedAt,
  completedAt,
  elapsedMs,
  input,
  canonicalRequest: call?.request ?? null,
  providerResult: call?.providerResult ?? null,
  providerError: call?.providerError ?? null,
  helperReport: call?.qualificationReport ?? null,
  helperExitCode: call?.helperExitCode ?? null,
  rawPlannerOutput,
  rawParsedJson,
  modelCreatedAt,
  parsedBrief,
  acceptedCreatedAt: parsedBrief?.createdAt ?? null,
  schemaAccepted: parsedBrief !== null,
  plannerError,
  semanticVerdict: "UNREVIEWED",
};

await mkdir(resolve(OUTPUT_PATH, ".."), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  elapsedMs,
  schemaAccepted: report.schemaAccepted,
  rawOutputPresent: rawPlannerOutput !== null,
  modelCreatedAt,
  acceptedCreatedAt: report.acceptedCreatedAt,
  plannerError: plannerError?.message ?? null,
  output: OUTPUT_PATH,
}));
if (!report.schemaAccepted) process.exitCode = 1;
