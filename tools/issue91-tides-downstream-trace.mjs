import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AlphaDecisionKnowledgeAcquisitionProvider } from "../dist/src/knowledge/npm-decision-acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { createConfiguredSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../dist/src/truth/npm-decision-admission.js";

const expectedSha = process.env.EXPECTED_PRODUCT_SHA?.trim();
const expectedTree = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(expectedSha && expectedTree, "Exact Product SHA/tree are required.");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), expectedSha);
assert.equal(git("rev-parse", "HEAD^{tree}"), expectedTree);
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-tides-downstream-trace",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra cognition is required.");
const liveInvestigator = createConfiguredSolandraKnowledgeInvestigator(config);
assert.ok(liveInvestigator, "Configured Solandra Knowledge investigator is required.");

const bounded = (value, max = 500) => {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}…[bounded]`;
};
const errorText = (error) => bounded(error instanceof Error ? `${error.name}: ${error.message}` : String(error), 600);
const claimSummary = (claim) => ({
  claimId: claim.claimId,
  text: bounded(claim.text, 420),
  sourceIds: [...new Set((claim.evidence ?? []).map((item) => item.sourceId))],
});
const sourceSummary = (source) => ({
  sourceId: source.sourceId,
  title: source.title,
  canonicalUri: source.canonicalUri,
  excerpt: bounded(source.content, 600),
});
const bundleSummary = (bundle) => ({
  sourceCount: bundle.sources.length,
  claimCount: bundle.claims.length,
  evidenceCount: bundle.claimEvidence.length,
  sources: bundle.sources.map((source) => ({
    id: source.id,
    canonicalUri: source.canonicalUri,
    title: typeof source.metadata?.title === "string" ? source.metadata.title : null,
  })),
  claims: bundle.claims.map((claim) => ({
    id: claim.id,
    text: bounded(claim.text, 420),
    qualifiers: claim.qualifiers,
  })),
  evidence: bundle.claimEvidence.map((item) => ({
    claimId: item.claimId,
    artifactId: item.artifactId,
    externalEvidenceId: item.externalEvidenceId,
    verification: item.verification,
    admitted: item.admitted,
    rejectionReason: item.rejectionReason,
  })),
  assessments: bundle.assessments.map((assessment) => ({
    claimId: assessment.claimId,
    atomicDisposition: assessment.atomicDisposition,
    verdict: assessment.verdict,
    confidence: assessment.confidence,
    admittedEvidenceIds: assessment.admittedEvidenceIds,
    unresolvedObligationIds: assessment.unresolvedObligationIds,
  })),
});

const trace = {
  product: { sha: expectedSha, tree: expectedTree },
  question: "Please use trustworthy external sources to explain how ocean tides occur and summarize what the sources support.",
  cognition: [],
  http: [],
  investigationPlan: null,
  responsiveness: null,
  rawAcquisition: null,
  semanticAcquisition: null,
  truthPipelineInput: null,
  truth: { investigated: null, validated: null },
  v36Admission: [],
  userResult: null,
};

const nativeFetch = fetch;
const rawProvider = new WikimediaKnowledgeAcquisitionProvider({
  fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const response = await nativeFetch(input, init);
    trace.http.push({
      sequence: trace.http.length + 1,
      kind: url.searchParams.get("generator") === "search" ? "SEARCH" : "DETAIL",
      query: url.searchParams.get("gsrsearch"),
      pageIds: url.searchParams.get("pageids"),
      status: response.status,
      ok: response.ok,
    });
    return response;
  },
});

const recordingRawProvider = {
  kind: rawProvider.kind,
  async acquire(input) {
    try {
      const result = await rawProvider.acquire(input);
      trace.rawAcquisition = {
        retrievalQueries: [...(input.investigationQueries ?? [])],
        completion: result.completion ?? { status: "COMPLETE" },
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        sources: result.sources.map(sourceSummary),
        claims: result.claims.map(claimSummary),
      };
      return result;
    } catch (error) {
      trace.rawAcquisition = {
        retrievalQueries: [...(input.investigationQueries ?? [])],
        error: errorText(error),
      };
      throw error;
    }
  },
};

const recordingInvestigator = {
  kind: liveInvestigator.kind,
  async plan(input) {
    try {
      const result = await liveInvestigator.plan(input);
      trace.investigationPlan = {
        knowledgeNeeds: [...input.knowledgeNeeds],
        retrievalQueries: [...result.retrievalQueries],
      };
      return result;
    } catch (error) {
      trace.investigationPlan = {
        knowledgeNeeds: [...input.knowledgeNeeds],
        error: errorText(error),
      };
      throw error;
    }
  },
  async selectResponsive(input) {
    const base = {
      sourceCount: input.sources.length,
      claimCount: input.claims.length,
      candidateSources: input.sources.map(sourceSummary),
      candidateClaims: input.claims.map(claimSummary),
    };
    try {
      const result = await liveInvestigator.selectResponsive(input);
      trace.responsiveness = {
        ...base,
        selectionCount: result.selections.length,
        selections: result.selections.map((selection) => ({
          claimId: selection.claimId,
          sourceIds: [...selection.sourceIds],
        })),
      };
      return result;
    } catch (error) {
      trace.responsiveness = { ...base, error: errorText(error) };
      throw error;
    }
  },
};

const semanticProvider = new RelevantKnowledgeAcquisitionProvider(recordingRawProvider, recordingInvestigator);
const recordingSemanticProvider = {
  kind: semanticProvider.kind,
  async acquire(input) {
    try {
      const result = await semanticProvider.acquire(input);
      trace.semanticAcquisition = {
        completion: result.completion ?? { status: "COMPLETE" },
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        sources: result.sources.map(sourceSummary),
        claims: result.claims.map(claimSummary),
      };
      return result;
    } catch (error) {
      trace.semanticAcquisition = { error: errorText(error) };
      throw error;
    }
  },
};

const alphaProvider = new AlphaDecisionKnowledgeAcquisitionProvider(recordingSemanticProvider);
const recordingTruthInputProvider = {
  kind: alphaProvider.kind,
  async acquire(input) {
    try {
      const result = await alphaProvider.acquire(input);
      trace.truthPipelineInput = {
        completion: result.completion ?? { status: "COMPLETE" },
        sourceCount: result.sources.length,
        claimCount: result.claims.length,
        sourceIds: result.sources.map((source) => source.sourceId),
        claims: result.claims.map(claimSummary),
      };
      return result;
    } catch (error) {
      trace.truthPipelineInput = { error: errorText(error) };
      throw error;
    }
  },
};

const baseAdmission = new AlphaDecisionKnowledgeEvidenceAdmissionPolicy();
const recordingAdmission = {
  disposition(input) {
    const result = baseAdmission.disposition(input);
    trace.v36Admission.push({
      claimId: input.claim.id,
      claimText: bounded(input.claim.text, 420),
      sourceId: input.source.id,
      sourceTitle: typeof input.source.metadata?.title === "string" ? input.source.metadata.title : null,
      canonicalUri: input.source.canonicalUri,
      proposedRelation: input.proposed.relation,
      proposedExcerpt: bounded(input.proposed.excerpt, 420),
      verification: result.verification,
      admitted: result.admitted,
      rejectionReason: result.rejectionReason,
      establishedProofKinds: result.establishedProofKinds ?? [],
    });
    return result;
  },
};

const liveTruthPipeline = new KnowledgeAcquisitionTruthPipeline(recordingTruthInputProvider, recordingAdmission);
const recordingTruthPipeline = {
  mode: liveTruthPipeline.mode,
  async investigate(runId, request) {
    const result = await liveTruthPipeline.investigate(runId, request);
    trace.truth.investigated = bundleSummary(result.snapshot.bundle);
    return result;
  },
  async validate(snapshot) {
    const result = await liveTruthPipeline.validate(snapshot);
    trace.truth.validated = bundleSummary(result.bundle);
    return result;
  },
  async beginDurableValidation(snapshot) {
    const result = await liveTruthPipeline.beginDurableValidation(snapshot);
    if (result.kind === "VALIDATED") trace.truth.validated = bundleSummary(result.execution.bundle);
    return result;
  },
  async resumeDurableValidation(checkpoint, results) {
    const result = await liveTruthPipeline.resumeDurableValidation(checkpoint, results);
    if (result.kind === "VALIDATED") trace.truth.validated = bundleSummary(result.execution.bundle);
    return result;
  },
  async execute(runId, request) {
    const result = await liveTruthPipeline.execute(runId, request);
    trace.truth.validated = bundleSummary(result.bundle);
    return result;
  },
};

const observedCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    trace.cognition.push({
      mode: result.mode,
      actualProvider: result.invocationProvenance.actualProvider ?? null,
      actualModel: result.invocationProvenance.actualModel ?? null,
      routeProvenance: result.invocationProvenance.routeProvenance ?? null,
      ...(result.mode === "GOVERNED" ? {
        objectiveRelation: result.proposal.objectiveRelation,
        requestedHelp: result.proposal.requestedHelp,
        knowledgeNeeds: [...result.proposal.knowledgeNeeds],
        materialAmbiguity: result.proposal.materialAmbiguity,
      } : {}),
    });
    return result;
  },
};

const app = await createRuntimeApp(config, {
  truthPipeline: recordingTruthPipeline,
  memoryDispatchDelayMs: 1,
  solandraCognition: observedCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function request(options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}
async function waitForRun(runId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}`);
    if (run.status === "COMPLETED") {
      const final = await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      return { run, final };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out`);
}

const artifactDir = resolve(process.env.VALIDATION_ARTIFACT_DIR ?? "../artifacts/issue91-tides-downstream-trace");
mkdirSync(artifactDir, { recursive: true });

try {
  const created = await request({ method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.conversation.id;
  const submitted = await request({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: trace.question },
  });
  assert.equal(submitted.status, "RUN_ACCEPTED");
  assert.ok(submitted.runId);
  const completed = await waitForRun(submitted.runId);
  trace.userResult = {
    conversationId,
    submitStatus: submitted.status,
    runId: submitted.runId,
    runStatus: completed.run.status,
    publicInterpretation: submitted.interpretation ?? null,
    assistantMessage: completed.final.assistantMessage ?? null,
    outcome: completed.final.outcome ?? null,
  };

  const summary = {
    product: trace.product,
    question: trace.question,
    cognition: trace.cognition[0] ?? null,
    retrievalQueries: trace.investigationPlan?.retrievalQueries ?? [],
    raw: trace.rawAcquisition ? {
      completion: trace.rawAcquisition.completion ?? null,
      sourceCount: trace.rawAcquisition.sourceCount ?? null,
      claimCount: trace.rawAcquisition.claimCount ?? null,
      error: trace.rawAcquisition.error ?? null,
    } : null,
    responsiveness: trace.responsiveness ? {
      inputSourceCount: trace.responsiveness.sourceCount ?? null,
      inputClaimCount: trace.responsiveness.claimCount ?? null,
      selectionCount: trace.responsiveness.selectionCount ?? null,
      selectedClaimIds: trace.responsiveness.selections?.map((item) => item.claimId) ?? [],
      error: trace.responsiveness.error ?? null,
    } : null,
    truthPipelineInput: trace.truthPipelineInput ? {
      completion: trace.truthPipelineInput.completion ?? null,
      sourceCount: trace.truthPipelineInput.sourceCount ?? null,
      claimCount: trace.truthPipelineInput.claimCount ?? null,
      claimIds: trace.truthPipelineInput.claims?.map((item) => item.claimId) ?? [],
      error: trace.truthPipelineInput.error ?? null,
    } : null,
    investigated: trace.truth.investigated ? {
      sourceCount: trace.truth.investigated.sourceCount,
      claimCount: trace.truth.investigated.claimCount,
      evidenceCount: trace.truth.investigated.evidenceCount,
      claims: trace.truth.investigated.claims,
    } : null,
    v36AdmissionCallCount: trace.v36Admission.length,
    v36AdmittedCount: trace.v36Admission.filter((item) => item.admitted && item.verification === "VERIFIED").length,
    validated: trace.truth.validated ? {
      sourceCount: trace.truth.validated.sourceCount,
      claimCount: trace.truth.validated.claimCount,
      evidenceCount: trace.truth.validated.evidenceCount,
      assessments: trace.truth.validated.assessments,
    } : null,
    userResult: trace.userResult,
  };

  writeFileSync(resolve(artifactDir, "trace.json"), JSON.stringify(trace, null, 2));
  writeFileSync(resolve(artifactDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`ISSUE91_TIDES_DOWNSTREAM_SUMMARY=${JSON.stringify(summary)}`);
} finally {
  writeFileSync(resolve(artifactDir, "trace.json"), JSON.stringify(trace, null, 2));
  await app.close();
}
