import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../dist/src/model/groq-knowledge-simplifier.js";
import { ModelSolandraCognitiveRuntime } from "../dist/src/solandra/cognition.js";
import { ModelSolandraAdvisoryRuntime } from "../dist/src/solandra/advisory.js";
import { ModelSolandraActionPreparer } from "../dist/src/solandra/action-preparer.js";
import { ModelSolandraKnowledgePresenter } from "../dist/src/solandra/knowledge-presenter.js";
import { ModelSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { AlphaDecisionKnowledgeAcquisitionProvider } from "../dist/src/knowledge/npm-decision-acquisition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../dist/src/truth/npm-decision-admission.js";
import { createAlphaDecisionRuntimeComposition } from "../dist/src/decision/alpha-decision-composition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const QUESTION = "How did the 1815 eruption of Mount Tambora contribute to the Year Without a Summer?";
const FOLLOW_UP = "Using only the Knowledge you just established, answer my original question in plain language and tell me what remains uncertain.";
const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/issue91-post96-groq-e2e");
mkdirSync(artifactDir, { recursive: true });
const trace = {
  product: { sha: expectedSha, tree: expectedTree },
  question: QUESTION,
  validationComposition: {
    provider: "groq",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    canonicalGroqRuntime: true,
    braveUsed: false,
    retriesAdded: false,
    fallbackAdded: false,
  },
  cognitionCalls: [],
  investigation: null,
  acquisition: null,
  responsiveness: null,
  truthHandoff: null,
  sanitizer: null,
  v36: null,
  knowledge: null,
  presentation: null,
  firstMaterialFailure: null,
  notes: [],
};
const writeTrace = () => writeFileSync(resolve(artifactDir, "trace.json"), JSON.stringify(trace, null, 2));
const safeError = (error) => ({
  name: error?.name ?? typeof error,
  message: error instanceof Error ? error.message : String(error),
  code: typeof error?.code === "string" ? error.code : null,
  statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
  retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
});
const providerCodes = new Set(["rate_limit", "cancelled", "unavailable", "timeout"]);
const isProviderError = (error) => error && providerCodes.has(error.code);
const anyProviderError = () => [
  ...trace.cognitionCalls.map((item) => item.error),
  trace.investigation?.error,
  trace.responsiveness?.error,
  trace.presentation?.error,
].some(isProviderError);
const bounded = (text, max = 500) => typeof text === "string" ? text.slice(0, max) : text;

const runtime = new GroqKnowledgeSimplifierModelRuntime(
  new GroqKnowledgeSimplifierModelProvider({ apiKey: process.env.GROQ_API_KEY.trim() }),
  60_000,
);
const cognitionInner = new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
const investigatorInner = new ModelSolandraKnowledgeInvestigator(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
const presenterInner = new ModelSolandraKnowledgePresenter(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
const advisory = new ModelSolandraAdvisoryRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
const actionPreparer = new ModelSolandraActionPreparer(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);

const cognition = {
  async interpret(input) {
    const record = { input: input.message, result: null, error: null };
    trace.cognitionCalls.push(record);
    try {
      const result = await cognitionInner.interpret(input);
      record.result = result.mode === "GOVERNED" ? {
        mode: result.mode,
        requestedHelp: result.proposal.requestedHelp,
        objectiveRelation: result.proposal.objectiveRelation,
        proposedObjective: result.proposal.proposedObjective,
        knowledgeNeeds: result.proposal.knowledgeNeeds,
        materialAmbiguity: result.proposal.materialAmbiguity,
        provider: result.invocationProvenance.actualProvider,
        model: result.invocationProvenance.actualModel,
        routeProvenance: result.invocationProvenance.routeProvenance,
      } : {
        mode: result.mode,
        assistantResponse: result.response,
        provider: result.invocationProvenance.actualProvider,
        model: result.invocationProvenance.actualModel,
        routeProvenance: result.invocationProvenance.routeProvenance,
      };
      return result;
    } catch (error) {
      record.error = safeError(error);
      throw error;
    } finally { writeTrace(); }
  },
};

const investigator = {
  kind: investigatorInner.kind,
  async plan(input) {
    try {
      const result = await investigatorInner.plan(input);
      trace.investigation = { knowledgeNeeds: [...input.knowledgeNeeds], retrievalQueries: [...result.retrievalQueries] };
      return result;
    } catch (error) {
      trace.investigation = { knowledgeNeeds: [...input.knowledgeNeeds], error: safeError(error) };
      throw error;
    } finally { writeTrace(); }
  },
  async selectResponsive(input) {
    const record = {
      input: { sourceCount: input.sources.length, claimCount: input.claims.length },
      output: null,
      error: null,
    };
    trace.responsiveness = record;
    try {
      const result = await investigatorInner.selectResponsive(input);
      record.output = {
        selectionCount: result.selections.length,
        selections: result.selections.map((item) => ({ claimId: item.claimId, sourceIds: [...item.sourceIds] })),
      };
      return result;
    } catch (error) {
      record.error = safeError(error);
      throw error;
    } finally { writeTrace(); }
  },
};

const rawInner = new WikimediaKnowledgeAcquisitionProvider();
const rawProvider = {
  kind: rawInner.kind,
  async acquire(input) {
    try {
      const result = await rawInner.acquire(input);
      trace.acquisition = {
        completion: result.completion ?? { status: "COMPLETE" },
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        sources: result.sources.map((source) => ({
          sourceId: source.sourceId,
          title: source.title,
          canonicalUri: source.canonicalUri,
          excerpt: bounded(source.content),
        })),
      };
      return result;
    } catch (error) {
      trace.acquisition = { error: safeError(error), sourceCount: 0, claimCount: 0 };
      throw error;
    } finally { writeTrace(); }
  },
};

const responsive = new RelevantKnowledgeAcquisitionProvider(rawProvider, investigator);
const routed = new AlphaDecisionKnowledgeAcquisitionProvider(responsive);
const selectedProvider = {
  kind: routed.kind,
  async acquire(input) {
    try {
      const result = await routed.acquire(input);
      trace.truthHandoff = {
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        completion: result.completion ?? { status: "COMPLETE" },
      };
      return result;
    } catch (error) {
      trace.truthHandoff = { error: safeError(error) };
      throw error;
    } finally { writeTrace(); }
  },
};

const truthInner = new KnowledgeAcquisitionTruthPipeline(selectedProvider, new AlphaDecisionKnowledgeEvidenceAdmissionPolicy());
const recordValidated = (execution) => {
  const evidence = execution.bundle.claimEvidence;
  trace.v36 = {
    evidenceEvaluated: evidence.length,
    admittedCount: evidence.filter((item) => item.admitted).length,
    rejectedCount: evidence.filter((item) => !item.admitted).length,
    rejected: evidence.filter((item) => !item.admitted).map((item) => ({
      claimId: item.claimId,
      rejectionReason: item.rejectionReason,
    })),
    assessments: execution.bundle.assessments.map((item) => ({
      claimId: item.claimId,
      atomicDisposition: item.atomicDisposition,
      verdict: item.verdict,
    })),
  };
  writeTrace();
};
const truthPipeline = {
  mode: truthInner.mode,
  async investigate(runId, request) {
    const result = await truthInner.investigate(runId, request);
    trace.sanitizer = {
      sourceCount: result.snapshot.bundle.sources.length,
      claimCount: result.snapshot.bundle.claims.length,
      evidenceCount: result.snapshot.bundle.claimEvidence.length,
      acquisitionLimitationClaim: result.snapshot.bundle.claims.some((claim) =>
        claim.qualifiers?.some((item) => item.key === "acquisition-state")),
    };
    writeTrace();
    return result;
  },
  async validate(snapshot) {
    const result = await truthInner.validate(snapshot);
    recordValidated(result);
    return result;
  },
  async beginDurableValidation(snapshot) {
    const step = await truthInner.beginDurableValidation(snapshot);
    if (step.kind === "VALIDATED") recordValidated(step.execution);
    return step;
  },
  async resumeDurableValidation(checkpoint, results) {
    const step = await truthInner.resumeDurableValidation(checkpoint, results);
    if (step.kind === "VALIDATED") recordValidated(step.execution);
    return step;
  },
  async execute(runId, request) {
    const investigated = await this.investigate(runId, request);
    return await this.validate(investigated.snapshot);
  },
};

const presenter = {
  async present(input) {
    try {
      const result = await presenterInner.present(input);
      trace.presentation = {
        status: result.status,
        knowledgeId: input.knowledge.knowledgeId,
        assistantMessage: result.status === "PRESENTED" ? result.text : null,
        provider: result.invocationProvenance.actualProvider,
        model: result.invocationProvenance.actualModel,
      };
      return result;
    } catch (error) {
      trace.presentation = { error: safeError(error) };
      throw error;
    } finally { writeTrace(); }
  },
};

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-post96-groq-validator",
});
const app = await createRuntimeApp(config, {
  ...createAlphaDecisionRuntimeComposition(),
  truthPipeline,
  memoryDispatchDelayMs: 1,
  solandraCognition: cognition,
  solandraAdvisory: advisory,
  solandraActionPreparer: actionPreparer,
  solandraKnowledgePresenter: presenter,
});

async function api(options, allowed = [200, 201, 202]) {
  const response = await app.inject(options);
  if (!allowed.includes(response.statusCode)) throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
  return response.json();
}
async function waitForRun(runId) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const run = await api({ method: "GET", url: `/api/v1/runs/${runId}` }, [200]);
    if (run.status === "FAILED" || run.status === "CANCELLED") return { run, failed: true };
    if (run.status === "COMPLETED") {
      const body = await api({ method: "GET", url: `/api/v1/runs/${runId}/outcome` }, [200]);
      return { run, failed: false, body };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out.`);
}

try {
  const conversation = await api({ method: "POST", url: "/api/v1/conversations" }, [201]);
  const conversationId = conversation.conversation.id;
  const submitted = await api({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: QUESTION },
  });

  if (submitted.status === "CONVERSATION_COMPLETED") {
    trace.firstMaterialFailure = "COGNITION";
  } else if (submitted.status !== "RUN_ACCEPTED" || !submitted.runId) {
    trace.firstMaterialFailure = anyProviderError() ? "PROVIDER" : "COGNITION";
  } else {
    const completed = await waitForRun(submitted.runId);
    if (completed.failed) {
      if (anyProviderError()) trace.firstMaterialFailure = "PROVIDER";
      else if (trace.investigation?.error) trace.firstMaterialFailure = "INVESTIGATION";
      else if (trace.acquisition?.error) trace.firstMaterialFailure = "ACQUISITION";
      else if (trace.responsiveness?.error) trace.firstMaterialFailure = "RESPONSIVENESS";
      else trace.firstMaterialFailure = "UNKNOWN";
      trace.notes.push(`Run ended ${completed.run.status}.`);
    } else {
      const outcome = completed.body.outcome;
      const knowledgeId = completed.body.knowledgeReference?.knowledgeId ?? null;
      trace.knowledge = {
        runId: submitted.runId,
        runStatus: completed.run.status,
        knowledgeId,
        findings: outcome?.findings ?? [],
        provenance: outcome?.provenance ?? [],
        uncertainty: outcome?.uncertainties ?? [],
        evidence: outcome?.evidence ?? [],
      };
      const admitted = (outcome?.evidence ?? []).filter((item) => item.admitted === true);
      if (anyProviderError()) trace.firstMaterialFailure = "PROVIDER";
      else if ((trace.truthHandoff?.claimCount ?? 0) > 0 && (trace.sanitizer?.evidenceCount ?? 0) === 0) trace.firstMaterialFailure = "SANITIZER";
      else if ((trace.v36?.evidenceEvaluated ?? 0) > 0 && (trace.v36?.admittedCount ?? 0) === 0) trace.firstMaterialFailure = "V36";
      else if (admitted.length > 0 && (outcome?.findings?.length ?? 0) === 0) trace.firstMaterialFailure = "KNOWLEDGE";
      else if (admitted.length > 0 && (outcome?.findings?.length ?? 0) > 0 && knowledgeId) {
        const follow = await api({
          method: "POST",
          url: `/api/v1/conversations/${conversationId}/turns`,
          payload: { turnId: randomUUID(), message: FOLLOW_UP },
        });
        if (anyProviderError()) trace.firstMaterialFailure = "PROVIDER";
        else if (follow.status !== "REFERENCE_RESOLVED" || typeof follow.presentation?.assistantMessage !== "string" || !follow.presentation.assistantMessage.trim()) {
          trace.firstMaterialFailure = "PRESENTATION";
        } else {
          trace.presentation = {
            ...(trace.presentation ?? {}),
            apiStatus: follow.status,
            apiAssistantMessage: follow.presentation.assistantMessage,
            referencedKnowledgeId: follow.knowledgeReference?.knowledgeId ?? null,
          };
          trace.firstMaterialFailure = "NONE OBSERVED";
        }
      } else trace.firstMaterialFailure = "UNKNOWN";
    }
  }

  assert.equal(git("rev-parse", "HEAD"), expectedSha);
  assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
  writeTrace();
  console.log(`ISSUE91_POST96_GROQ_E2E_SUMMARY=${JSON.stringify(trace, null, 2)}`);
} catch (error) {
  trace.firstMaterialFailure ??= anyProviderError() ? "PROVIDER" : "UNKNOWN";
  trace.notes.push(`Harness-level error: ${JSON.stringify(safeError(error))}`);
  writeTrace();
  console.error("ISSUE91_POST96_GROQ_E2E_HARNESS_ERROR", safeError(error));
  process.exitCode = 1;
} finally {
  await app.close();
}
