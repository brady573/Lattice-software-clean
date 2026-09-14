import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { consultationRunRequestSchema } from "../dist/src/domain.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../dist/src/model/groq-knowledge-simplifier.js";
import { stableModelJson } from "../dist/src/model/canonical.js";
import { asModelProviderError } from "../dist/src/model/errors.js";
import { ModelSolandraCognitiveRuntime, isConversationalCognition } from "../dist/src/solandra/cognition.js";
import { ModelSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { createConfiguredTruthPipeline } from "../dist/src/truth/configured-pipeline.js";
import { buildKnowledgeOutcome } from "../dist/src/outcome.js";
import { buildKnowledgeRecord } from "../dist/src/knowledge/knowledge-record-store.js";
import { renderKnowledgeResponseForRun } from "../dist/src/presentation/solandra/knowledge-response.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const EVIDENCE_MARKER = "VALIDATION ARTIFACT — NON-AUTHORITATIVE PRODUCT EVIDENCE ONLY";
const QUESTION = "What caused the Permian–Triassic mass extinction?";
const IDS = Object.freeze({
  conversationId: "validation-issue91-staged-knowledge-conversation",
  messageId: "validation-issue91-staged-knowledge-message",
  runId: "validation-issue91-staged-knowledge-run",
  intentScopeId: "validation-issue91-staged-knowledge-scope",
  intentVersionId: "validation-issue91-staged-knowledge-intent-v1",
});
const MAX_SANITIZER_SOURCES = 12;
const MAX_SANITIZER_CLAIMS = 24;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function expectedBase() {
  const sha = process.env.EXPECTED_PRODUCT_SHA?.trim();
  const tree = process.env.EXPECTED_PRODUCT_TREE?.trim();
  assert.ok(sha, "EXPECTED_PRODUCT_SHA is required");
  assert.ok(tree, "EXPECTED_PRODUCT_TREE is required");
  assert.equal(git("rev-parse", "HEAD"), sha, "Product checkout SHA changed");
  assert.equal(git("rev-parse", "HEAD^{tree}"), tree, "Product checkout tree changed");
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Tracked Product checkout is not clean");
  return { sha, tree };
}

async function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`, "utf8");
}

function payloadDigest(payload) {
  return `sha256:${sha256(JSON.stringify(payload))}`;
}

async function fileDigest(path) {
  return `sha256:${sha256(await readFile(path))}`;
}

async function writeArtifact(stage, payload, options = {}) {
  const artifact = {
    marker: EVIDENCE_MARKER,
    canonicalBase: expectedBase(),
    stage,
    sourceStageArtifactDigest: options.sourceStageArtifactDigest ?? null,
    ...(options.sourceStageArtifactDigests === undefined
      ? {}
      : { sourceStageArtifactDigests: options.sourceStageArtifactDigests }),
    exactCanonicalIds: { ...IDS },
    serializedPayloadDigest: payloadDigest(payload),
    createdAt: new Date().toISOString(),
    payload,
  };
  const path = resolve(process.env.STAGE_ARTIFACT_PATH ?? `../artifacts/${stage.toLowerCase()}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { artifact, path, fileDigest: await fileDigest(path) };
}

async function readArtifact(pathValue, expectedStage) {
  const path = resolve(pathValue);
  const raw = await readFile(path, "utf8");
  const artifact = JSON.parse(raw);
  assert.equal(artifact.marker, EVIDENCE_MARKER, `${expectedStage} evidence marker changed`);
  assert.equal(artifact.stage, expectedStage, `Expected ${expectedStage} artifact`);
  const base = expectedBase();
  assert.deepEqual(artifact.canonicalBase, base, `${expectedStage} canonical base changed`);
  assert.equal(artifact.serializedPayloadDigest, payloadDigest(artifact.payload), `${expectedStage} payload digest mismatch`);
  return { artifact, path, fileDigest: `sha256:${sha256(raw)}` };
}

function clone(value) {
  return structuredClone(value);
}

function modelErrorSummary(error) {
  const modelError = asModelProviderError(error);
  return {
    name: modelError.name,
    code: modelError.code,
    statusCode: modelError.statusCode,
    retryable: modelError.retryable,
    message: modelError.message,
  };
}

class RecordingModelProvider {
  constructor(delegate) {
    this.delegate = delegate;
    this.kind = delegate.kind;
    this.calls = [];
  }

  async generate(request, context) {
    const record = {
      sequence: this.calls.length + 1,
      correlationId: context.correlationId,
      attempt: context.attempt,
      requestIdentity: context.requestIdentity,
      requestBytes: Buffer.byteLength(stableModelJson(request), "utf8"),
      request: clone(request),
      route: null,
      metadata: null,
      error: null,
    };
    this.calls.push(record);
    try {
      const result = await this.delegate.generate(request, context);
      record.route = result.route === undefined ? null : clone(result.route);
      record.metadata = result.metadata === undefined ? null : clone(result.metadata);
      return result;
    } catch (error) {
      record.error = modelErrorSummary(error);
      throw error;
    }
  }
}

function configuredGroqRecorder() {
  const config = resolveRuntimeConfig({
    ...process.env,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
  });
  assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");
  assert.ok(config.solandraCognitionApiKey, "Configured Groq cognition credential is unavailable");
  const delegate = new GroqKnowledgeSimplifierModelProvider({ apiKey: config.solandraCognitionApiKey });
  const recorder = new RecordingModelProvider(delegate);
  const runtime = new GroqKnowledgeSimplifierModelRuntime(recorder);
  return { config, recorder, runtime };
}

function requestIdentitySummary(request) {
  const user = request.messages.find((message) => message.role === "user")?.content ?? "";
  return {
    sourceIds: [...user.matchAll(/^Source ID: ([^\n]+)$/gmu)].map((match) => match[1]),
    claimIds: [...user.matchAll(/^Claim ID: ([^\n]+)$/gmu)].map((match) => match[1]),
  };
}

function acquisitionSummary(result) {
  return {
    completion: result.completion ?? { status: "COMPLETE" },
    sourceCount: result.sources.length,
    claimCount: result.claims.length,
    sourceIds: result.sources.map((source) => source.sourceId),
    claimIds: result.claims.map((claim) => claim.claimId),
    claimToSourceBindings: result.claims.map((claim) => ({
      claimId: claim.claimId,
      sourceIds: claim.evidence.map((evidence) => evidence.sourceId),
    })),
    representativeSourceTitles: result.sources.slice(0, 8).map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      canonicalUri: source.canonicalUri,
    })),
    representativeClaims: result.claims.slice(0, 8).map((claim) => ({
      claimId: claim.claimId,
      text: claim.text,
      sourceIds: claim.evidence.map((evidence) => evidence.sourceId),
    })),
  };
}

function consultationRequest(stageA) {
  const question = stageA.payload.journey.userInput;
  return consultationRunRequestSchema.parse({
    kind: "consultation",
    objective: question,
    context: [],
    investigationQueries: [...stageA.payload.investigation.knowledgeNeeds],
    advisoryRequested: false,
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: IDS.messageId,
    sourceMessageDigest: sha256(question),
    intentVersion: 1,
    intentScopeId: IDS.intentScopeId,
    intentVersionId: IDS.intentVersionId,
  });
}

function completedRun(stageA, truthAssessmentIds = []) {
  return {
    id: IDS.runId,
    conversationId: IDS.conversationId,
    status: "COMPLETED",
    version: 1,
    request: consultationRequest(stageA),
    decision: null,
    explanation: null,
    truthAssessmentIds: [...truthAssessmentIds],
    events: [
      { sequence: 1, type: "CREATED" },
      { sequence: 2, type: "UNDERSTANDING" },
      { sequence: 3, type: "INVESTIGATING" },
      { sequence: 4, type: "VALIDATING" },
      { sequence: 5, type: "COMPLETED" },
    ],
  };
}

async function stageA() {
  const { recorder, runtime } = configuredGroqRecorder();
  const cognition = new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const cognitionInput = {
    conversationId: IDS.conversationId,
    messageId: IDS.messageId,
    message: QUESTION,
    recentUserMessages: [QUESTION],
    recentConversation: [{ role: "USER", content: QUESTION }],
    governedKnowledge: [],
    governedRecommendations: [],
  };

  let cognitionResult;
  try {
    cognitionResult = await cognition.interpret(cognitionInput);
  } catch (error) {
    const payload = {
      result: "BLOCKED_PROVIDER",
      journey: { userInput: QUESTION, ids: { ...IDS }, currentCanonicalObjective: null },
      cognition: { input: cognitionInput, error: modelErrorSummary(error) },
      providerCalls: recorder.calls.map((call) => ({ ...call, request: undefined })),
    };
    const written = await writeArtifact("STAGE_A_COGNITION_INVESTIGATION", payload);
    await setOutput("continue_stage_b", "false");
    console.log(`STAGE_A_RESULT=BLOCKED_PROVIDER artifact=${written.fileDigest}`);
    return;
  }

  if (isConversationalCognition(cognitionResult)) {
    const payload = {
      result: "STOP_COGNITION_CONVERSATION",
      journey: { userInput: QUESTION, ids: { ...IDS }, currentCanonicalObjective: null },
      cognition: { input: cognitionInput, output: cognitionResult },
      providerCalls: recorder.calls.map((call) => ({ ...call, request: undefined })),
    };
    const written = await writeArtifact("STAGE_A_COGNITION_INVESTIGATION", payload);
    await setOutput("continue_stage_b", "false");
    console.log(`STAGE_A_RESULT=STOP_COGNITION_CONVERSATION artifact=${written.fileDigest}`);
    return;
  }

  const proposal = cognitionResult.proposal;
  const knowledgeNeeds = [...proposal.knowledgeNeeds];
  if (proposal.requestedHelp !== "KNOWLEDGE" && proposal.requestedHelp !== "FRESH_RESEARCH") {
    const payload = {
      result: "STOP_COGNITION_NON_KNOWLEDGE",
      journey: { userInput: QUESTION, ids: { ...IDS }, currentCanonicalObjective: null },
      cognition: { input: cognitionInput, output: cognitionResult },
      investigation: { knowledgeNeeds, output: null },
      providerCalls: recorder.calls.map((call) => ({ ...call, request: undefined })),
    };
    const written = await writeArtifact("STAGE_A_COGNITION_INVESTIGATION", payload);
    await setOutput("continue_stage_b", "false");
    console.log(`STAGE_A_RESULT=STOP_COGNITION_NON_KNOWLEDGE artifact=${written.fileDigest}`);
    return;
  }

  const investigator = new ModelSolandraKnowledgeInvestigator(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  let plan;
  try {
    plan = await investigator.plan({
      runId: IDS.runId,
      objective: QUESTION,
      context: [],
      knowledgeNeeds,
    });
  } catch (error) {
    const payload = {
      result: "BLOCKED_PROVIDER",
      journey: { userInput: QUESTION, ids: { ...IDS }, currentCanonicalObjective: QUESTION },
      cognition: { input: cognitionInput, output: cognitionResult },
      investigation: { knowledgeNeeds, error: modelErrorSummary(error) },
      providerCalls: recorder.calls.map((call) => ({ ...call, request: undefined })),
    };
    const written = await writeArtifact("STAGE_A_COGNITION_INVESTIGATION", payload);
    await setOutput("continue_stage_b", "false");
    console.log(`STAGE_A_RESULT=BLOCKED_PROVIDER artifact=${written.fileDigest}`);
    return;
  }

  const payload = {
    result: "PASS",
    journey: { userInput: QUESTION, ids: { ...IDS }, currentCanonicalObjective: QUESTION },
    cognition: {
      input: cognitionInput,
      output: cognitionResult,
      providerModel: {
        provider: cognitionResult.invocationProvenance.actualProvider,
        model: cognitionResult.invocationProvenance.actualModel,
        routeProvenance: cognitionResult.invocationProvenance,
      },
    },
    investigation: {
      knowledgeNeeds,
      output: plan,
      retrievalQueries: [...plan.retrievalQueries],
      providerModel: recorder.calls.at(-1)?.route ?? null,
    },
    providerCalls: recorder.calls.map((call) => ({
      sequence: call.sequence,
      correlationId: call.correlationId,
      attempt: call.attempt,
      requestIdentity: call.requestIdentity,
      requestBytes: call.requestBytes,
      route: call.route,
      metadata: call.metadata,
      error: call.error,
    })),
  };
  const written = await writeArtifact("STAGE_A_COGNITION_INVESTIGATION", payload);
  await setOutput("continue_stage_b", "true");
  console.log(JSON.stringify({
    stage: "A",
    result: payload.result,
    userInput: QUESTION,
    cognitionMode: cognitionResult.mode,
    requestedHelp: proposal.requestedHelp,
    objectiveRelation: proposal.objectiveRelation,
    materialAmbiguity: proposal.materialAmbiguity,
    knowledgeNeeds,
    retrievalQueries: plan.retrievalQueries,
    provider: cognitionResult.invocationProvenance.actualProvider,
    model: cognitionResult.invocationProvenance.actualModel,
    artifactDigest: written.fileDigest,
  }));
}

async function stageB() {
  const source = await readArtifact(process.env.STAGE_A_ARTIFACT, "STAGE_A_COGNITION_INVESTIGATION");
  assert.equal(source.artifact.payload.result, "PASS", "Stage A did not pass");
  const stageA = source.artifact;
  const provider = new WikimediaKnowledgeAcquisitionProvider();
  let acquired;
  try {
    acquired = await provider.acquire({
      runId: IDS.runId,
      objective: stageA.payload.journey.currentCanonicalObjective,
      context: [],
      investigationQueries: [...stageA.payload.investigation.retrievalQueries],
    });
  } catch (error) {
    const payload = {
      result: "FAIL_ACQUISITION",
      journey: stageA.payload.journey,
      cognition: stageA.payload.cognition,
      investigation: stageA.payload.investigation,
      acquisition: { provider: provider.kind, error: error instanceof Error ? error.message : String(error) },
    };
    const written = await writeArtifact("STAGE_B_ACQUISITION", payload, { sourceStageArtifactDigest: source.fileDigest });
    await setOutput("continue_stage_c", "false");
    console.log(`STAGE_B_RESULT=FAIL_ACQUISITION artifact=${written.fileDigest}`);
    return;
  }

  const summary = acquisitionSummary(acquired);
  const payload = {
    result: acquired.sources.length > 0 && acquired.claims.length > 0 ? "PASS" : "STOP_NO_CANDIDATES",
    journey: stageA.payload.journey,
    cognition: stageA.payload.cognition,
    investigation: stageA.payload.investigation,
    acquisition: {
      provider: provider.kind,
      summary,
      exactResult: acquired,
    },
  };
  const written = await writeArtifact("STAGE_B_ACQUISITION", payload, { sourceStageArtifactDigest: source.fileDigest });
  const shouldContinue = payload.result === "PASS";
  await setOutput("continue_stage_c", shouldContinue ? "true" : "false");
  console.log(JSON.stringify({
    stage: "B",
    result: payload.result,
    provider: provider.kind,
    completion: summary.completion,
    sourceCount: summary.sourceCount,
    claimCount: summary.claimCount,
    sourceIds: summary.sourceIds,
    claimIds: summary.claimIds,
    representativeSourceTitles: summary.representativeSourceTitles,
    representativeClaims: summary.representativeClaims,
    artifactDigest: written.fileDigest,
  }));
}

async function stageC() {
  const stageARead = await readArtifact(process.env.STAGE_A_ARTIFACT, "STAGE_A_COGNITION_INVESTIGATION");
  const stageBRead = await readArtifact(process.env.STAGE_B_ARTIFACT, "STAGE_B_ACQUISITION");
  assert.equal(stageBRead.artifact.sourceStageArtifactDigest, stageARead.fileDigest, "Stage B does not bind exact Stage A artifact");
  assert.equal(stageBRead.artifact.payload.result, "PASS", "Stage B did not provide candidates");
  const stageA = stageARead.artifact;
  const stageB = stageBRead.artifact;
  const exactAcquisition = stageB.payload.acquisition.exactResult;
  const exactPlan = stageA.payload.investigation.output;
  const exactKnowledgeNeeds = stageA.payload.investigation.knowledgeNeeds;

  const { recorder, runtime } = configuredGroqRecorder();
  const realInvestigator = new ModelSolandraKnowledgeInvestigator(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  let exactSelections = null;
  let canonicalIdentityValidation = "NOT_REACHED";
  const replayInvestigator = {
    kind: realInvestigator.kind,
    async plan(input) {
      assert.equal(input.runId, IDS.runId);
      assert.equal(input.objective, stageA.payload.journey.currentCanonicalObjective);
      assert.deepEqual(input.context, []);
      assert.deepEqual(input.knowledgeNeeds, exactKnowledgeNeeds);
      return clone(exactPlan);
    },
    async selectResponsive(input) {
      assert.equal(input.runId, IDS.runId);
      assert.equal(input.objective, stageA.payload.journey.currentCanonicalObjective);
      assert.deepEqual(input.context, []);
      assert.deepEqual(input.knowledgeNeeds, exactKnowledgeNeeds);
      assert.deepEqual(input.retrievalQueries, exactPlan.retrievalQueries);
      assert.deepEqual(input.sources, exactAcquisition.sources);
      assert.deepEqual(input.claims, exactAcquisition.claims);
      const result = await realInvestigator.selectResponsive(input);
      exactSelections = clone(result);
      return result;
    },
  };
  const staticProvider = {
    kind: stageB.payload.acquisition.provider,
    async acquire(request) {
      assert.equal(request.runId, IDS.runId);
      assert.equal(request.objective, stageA.payload.journey.currentCanonicalObjective);
      assert.deepEqual(request.context, []);
      assert.deepEqual(request.investigationQueries, exactPlan.retrievalQueries);
      return clone(exactAcquisition);
    },
  };
  const relevant = new RelevantKnowledgeAcquisitionProvider(staticProvider, replayInvestigator);

  let selectedResult = null;
  let stageError = null;
  try {
    selectedResult = await relevant.acquire({
      runId: IDS.runId,
      objective: stageA.payload.journey.currentCanonicalObjective,
      context: [],
      investigationQueries: [...exactKnowledgeNeeds],
    });
    canonicalIdentityValidation = "PASS";
  } catch (error) {
    stageError = modelErrorSummary(error);
  }

  const calls = recorder.calls.map((call) => ({
    sequence: call.sequence,
    correlationId: call.correlationId,
    requestBytes: call.requestBytes,
    presentedIdentities: requestIdentitySummary(call.request),
    route: call.route,
    metadata: call.metadata,
    error: call.error,
  }));
  const payload = {
    result: stageError === null ? "PASS" : "BLOCKED_PROVIDER_OR_RESPONSIVENESS",
    journey: stageA.payload.journey,
    cognition: stageA.payload.cognition,
    investigation: stageA.payload.investigation,
    acquisition: stageB.payload.acquisition,
    responsiveness: {
      providerModel: calls.map((call) => call.route).filter(Boolean),
      callCount: calls.length,
      calls,
      exactSelections,
      canonicalIdentityValidation,
      selectedResult,
      error: stageError,
    },
  };
  const written = await writeArtifact("STAGE_C_SEMANTIC_RESPONSIVENESS", payload, {
    sourceStageArtifactDigest: stageBRead.fileDigest,
    sourceStageArtifactDigests: {
      stageA: stageARead.fileDigest,
      stageB: stageBRead.fileDigest,
    },
  });
  const shouldContinue = stageError === null && selectedResult !== null;
  await setOutput("continue_stage_d", shouldContinue ? "true" : "false");
  console.log(JSON.stringify({
    stage: "C",
    result: payload.result,
    callCount: calls.length,
    calls: calls.map((call) => ({
      sequence: call.sequence,
      requestBytes: call.requestBytes,
      presentedIdentities: call.presentedIdentities,
      route: call.route,
      error: call.error,
    })),
    selections: exactSelections,
    identityValidation: canonicalIdentityValidation,
    selectedSummary: selectedResult === null ? null : acquisitionSummary(selectedResult),
    error: stageError,
    artifactDigest: written.fileDigest,
  }));
}

function acquisitionLimitationClaim(claim) {
  return claim.qualifiers?.some((item) => item.key === "acquisition-state") === true;
}

async function stageD() {
  const stageCRead = await readArtifact(process.env.STAGE_C_ARTIFACT, "STAGE_C_SEMANTIC_RESPONSIVENESS");
  assert.equal(stageCRead.artifact.payload.result, "PASS", "Stage C did not pass");
  const stageC = stageCRead.artifact;
  const selected = stageC.payload.responsiveness.selectedResult;
  assert.ok(selected, "Stage C selected acquisition is missing");

  const stageA = {
    payload: {
      journey: stageC.payload.journey,
      investigation: stageC.payload.investigation,
    },
  };
  const request = consultationRequest(stageA);
  const staticProvider = {
    kind: "validation-exact-stage-c-selected-acquisition",
    async acquire(input) {
      assert.equal(input.runId, IDS.runId);
      assert.equal(input.objective, stageC.payload.journey.currentCanonicalObjective);
      assert.deepEqual(input.context, []);
      return clone(selected);
    },
  };

  const capacity = {
    maxSources: MAX_SANITIZER_SOURCES,
    maxClaims: MAX_SANITIZER_CLAIMS,
    sourceCount: selected.sources.length,
    claimCount: selected.claims.length,
    exceedsSourceLimit: selected.sources.length > MAX_SANITIZER_SOURCES,
    exceedsClaimLimit: selected.claims.length > MAX_SANITIZER_CLAIMS,
  };

  const pipeline = createConfiguredTruthPipeline("v36-live", staticProvider);
  let execution = null;
  let pipelineError = null;
  try {
    execution = await pipeline.execute(IDS.runId, request);
  } catch (error) {
    pipelineError = error instanceof Error ? error.message : String(error);
  }

  if (execution === null) {
    const payload = {
      result: "FAIL_SANITIZER_OR_V36",
      journey: stageC.payload.journey,
      sanitizer: {
        enteringSourceIds: selected.sources.map((source) => source.sourceId),
        enteringClaimIds: selected.claims.map((claim) => claim.claimId),
        capacity,
        error: pipelineError,
      },
      v36: { invoked: true, result: null },
      knowledge: null,
    };
    const written = await writeArtifact("STAGE_D_SANITIZER_V36_KNOWLEDGE", payload, { sourceStageArtifactDigest: stageCRead.fileDigest });
    await setOutput("continue_stage_e", "false");
    console.log(`STAGE_D_RESULT=FAIL_SANITIZER_OR_V36 artifact=${written.fileDigest}`);
    return;
  }

  const truth = execution.bundle;
  const run = completedRun(stageA, truth.assessments.map((assessment) => assessment.id));
  const knowledge = buildKnowledgeOutcome(run, truth);
  const record = buildKnowledgeRecord(run, truth, knowledge, new Date().toISOString());
  const nonLimitationClaims = truth.claims.filter((claim) => !acquisitionLimitationClaim(claim));
  const admittedEvidence = truth.claimEvidence.filter((item) => item.admitted && item.verification === "VERIFIED");
  const rejectedEvidence = truth.claimEvidence.filter((item) => !item.admitted || item.verification !== "VERIFIED");
  const usefulFindings = knowledge.findings.filter((finding) =>
    finding.status === "SUPPORTED"
    || (finding.basis === "SOURCE_REPORT" && finding.evidenceIds.length > 0)
  );
  const structuralCountsMatch = truth.sources.length === selected.sources.length
    && nonLimitationClaims.length === selected.claims.length;
  const sanitizerFailure = capacity.exceedsSourceLimit || capacity.exceedsClaimLimit || !structuralCountsMatch;
  const useful = !sanitizerFailure && usefulFindings.length > 0 && record.sourceIds.length > 0;

  const payload = {
    result: sanitizerFailure ? "FAIL_SANITIZER" : (useful ? "PASS" : "STOP_NO_USEFUL_GOVERNED_KNOWLEDGE"),
    journey: stageC.payload.journey,
    run,
    sanitizer: {
      enteringSources: selected.sources.length,
      enteringClaims: selected.claims.length,
      enteringSourceIds: selected.sources.map((source) => source.sourceId),
      enteringClaimIds: selected.claims.map((claim) => claim.claimId),
      capacity,
      truthSourcesAfterSanitization: truth.sources.length,
      truthClaimsAfterSanitizationExcludingAcquisitionLimitation: nonLimitationClaims.length,
      structuralCountsMatch,
      materialDroppedOrRejected: sanitizerFailure,
      reason: capacity.exceedsSourceLimit || capacity.exceedsClaimLimit
        ? "Knowledge acquisition result exceeds its bounded source or claim count."
        : (!structuralCountsMatch ? "Canonical downstream structural counts differ from Stage C selected acquisition." : null),
    },
    v36: {
      invoked: true,
      evidenceEvaluated: truth.claimEvidence.length,
      claimsEvaluated: truth.assessments.length,
      admittedEvidence: admittedEvidence.map((item) => ({
        evidenceId: item.externalEvidenceId,
        claimId: item.claimId,
        sourceId: item.artifactId,
        relation: item.relation,
        verification: item.verification,
      })),
      rejectedEvidence: rejectedEvidence.map((item) => ({
        evidenceId: item.externalEvidenceId,
        claimId: item.claimId,
        sourceId: item.artifactId,
        relation: item.relation,
        verification: item.verification,
        rejectionReason: item.rejectionReason,
      })),
      assessments: truth.assessments.map((assessment) => ({
        claimId: assessment.claimId,
        atomicDisposition: assessment.atomicDisposition,
        verdict: assessment.verdict,
        confidence: assessment.confidence,
        admittedEvidenceIds: assessment.admittedEvidenceIds,
        unresolvedObligationIds: assessment.unresolvedObligationIds,
      })),
      provenance: truth.sources.map((source) => ({
        sourceId: source.id,
        canonicalUri: source.canonicalUri,
        publisher: source.publisher,
        provenanceConfidence: source.provenanceConfidence,
        authoritativePrimary: source.authoritativePrimary,
      })),
      exactTruthBundle: truth,
    },
    knowledge: {
      useful,
      knowledgeId: record.knowledgeId,
      record,
      outcome: knowledge,
      findings: knowledge.findings,
      provenance: knowledge.provenance,
      uncertainty: knowledge.uncertainties,
    },
  };
  const written = await writeArtifact("STAGE_D_SANITIZER_V36_KNOWLEDGE", payload, { sourceStageArtifactDigest: stageCRead.fileDigest });
  await setOutput("continue_stage_e", useful ? "true" : "false");
  console.log(JSON.stringify({
    stage: "D",
    result: payload.result,
    sanitizer: payload.sanitizer,
    v36: {
      evidenceEvaluated: payload.v36.evidenceEvaluated,
      claimsEvaluated: payload.v36.claimsEvaluated,
      admittedEvidence: payload.v36.admittedEvidence,
      rejectedEvidence: payload.v36.rejectedEvidence,
      assessments: payload.v36.assessments,
      provenance: payload.v36.provenance,
    },
    knowledge: payload.knowledge,
    artifactDigest: written.fileDigest,
  }));
}

async function stageE() {
  const stageDRead = await readArtifact(process.env.STAGE_D_ARTIFACT, "STAGE_D_SANITIZER_V36_KNOWLEDGE");
  assert.equal(stageDRead.artifact.payload.result, "PASS", "Stage D did not produce useful governed Knowledge");
  const stageD = stageDRead.artifact;
  const knowledge = clone(stageD.payload.knowledge.outcome);
  const run = clone(stageD.payload.run);
  const beforeKnowledgeDigest = payloadDigest(knowledge);
  const finalResponse = await renderKnowledgeResponseForRun(knowledge, run);
  const afterKnowledgeDigest = payloadDigest(knowledge);
  assert.equal(afterKnowledgeDigest, beforeKnowledgeDigest, "Presentation mutated governed Knowledge");

  const sourceTitles = knowledge.provenance.map((source) => source.title);
  const visibleSourceTitles = sourceTitles.filter((title) => finalResponse.includes(title));
  const externallyMeaningfulUncertainties = knowledge.uncertainties.filter((item) =>
    !item.startsWith("UNRESOLVED:")
    && !item.startsWith("CONFLICTED:")
    && !item.startsWith("Source-report evidence establishes only what the retrieved sources report;")
    && !item.startsWith("This v0.1 ")
  );
  const visibleUncertainties = externallyMeaningfulUncertainties.filter((item) => finalResponse.includes(item));
  const payload = {
    result: "PASS",
    journey: stageD.payload.journey,
    knowledgeBasisConsumed: {
      knowledgeId: stageD.payload.knowledge.knowledgeId,
      claimIds: stageD.payload.knowledge.record.claimIds,
      sourceIds: stageD.payload.knowledge.record.sourceIds,
      evidenceIds: stageD.payload.knowledge.record.evidenceIds,
      uncertainties: stageD.payload.knowledge.record.uncertainties,
      stageDKnowledgePayloadDigest: payloadDigest(stageD.payload.knowledge),
    },
    presentation: {
      modelProviderCallOccurred: false,
      finalUserFacingResponse: finalResponse,
      governedKnowledgeUnchanged: beforeKnowledgeDigest === afterKnowledgeDigest,
      sourceTitles,
      visibleSourceTitles,
      externallyMeaningfulUncertainties,
      visibleUncertainties,
    },
  };
  const written = await writeArtifact("STAGE_E_PRESENTATION", payload, { sourceStageArtifactDigest: stageDRead.fileDigest });
  console.log(JSON.stringify({
    stage: "E",
    result: payload.result,
    knowledgeBasisConsumed: payload.knowledgeBasisConsumed,
    presentation: payload.presentation,
    artifactDigest: written.fileDigest,
  }));
}

const stage = process.argv[2]?.trim().toUpperCase();
switch (stage) {
  case "A": await stageA(); break;
  case "B": await stageB(); break;
  case "C": await stageC(); break;
  case "D": await stageD(); break;
  case "E": await stageE(); break;
  default: throw new Error(`Unknown staged validation phase: ${stage ?? "<missing>"}`);
}
