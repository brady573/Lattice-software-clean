import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../dist/src/knowledge/wikimedia-acquisition.js";
import { RelevantKnowledgeAcquisitionProvider } from "../dist/src/knowledge/investigation.js";
import { AlphaDecisionKnowledgeAcquisitionProvider } from "../dist/src/knowledge/npm-decision-acquisition.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GROQ_KNOWLEDGE_SIMPLIFIER_PROVIDER,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../dist/src/model/groq-knowledge-simplifier.js";
import { ModelSolandraKnowledgeInvestigator } from "../dist/src/solandra/knowledge-investigator.js";
import { KnowledgeAcquisitionTruthPipeline } from "../dist/src/truth/knowledge-acquisition-pipeline.js";
import { AlphaDecisionKnowledgeEvidenceAdmissionPolicy } from "../dist/src/truth/npm-decision-admission.js";

const EXPECTED_SHA = process.env.EXPECTED_PRODUCT_SHA?.trim();
const EXPECTED_TREE = process.env.EXPECTED_PRODUCT_TREE?.trim();
assert.ok(EXPECTED_SHA && EXPECTED_TREE, "Exact Product SHA/tree are required.");
assert.ok(process.env.GROQ_API_KEY?.trim(), "GROQ_API_KEY is unavailable.");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), EXPECTED_SHA);
assert.equal(git("rev-parse", "HEAD^{tree}"), EXPECTED_TREE);

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue91-general-knowledge-trace",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
assert.equal(config.truthMode, "v36-live");
assert.equal(config.solandraCognitionRoute, "groq-gpt-oss-120b");
assert.ok(config.solandraCognitionApiKey?.trim(), "Configured Solandra credential is unavailable.");

const artifactDir = resolve(process.env.DIAGNOSTIC_ARTIFACT_DIR ?? "../artifacts/issue91-general-knowledge-trace");
mkdirSync(artifactDir, { recursive: true });

const questions = [
  "Why is the sky blue?",
  "What started World War I?",
  "How does nuclear fission work?",
  "What is the difference between weather and climate?",
];

const evidence = {
  product: { sha: EXPECTED_SHA, tree: EXPECTED_TREE },
  method: {
    kind: "transparent-recording-wrappers",
    productSemanticsChanged: false,
    notes: [
      "Exact Product is checked out separately from validation infrastructure.",
      "Canonical cognition, investigation prompts, Wikimedia limits, responsiveness semantics, V36 admission policy, and presentation are unchanged.",
      "Recording wrappers only copy bounded inputs/outputs before forwarding them unchanged.",
    ],
  },
  route: {
    cognition: config.solandraCognitionRoute,
    truthMode: config.truthMode,
    investigationProvider: GROQ_KNOWLEDGE_SIMPLIFIER_PROVIDER,
    investigationModel: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    acquisitionProvider: "wikimedia-search",
  },
  cases: [],
};

function writeEvidence() {
  writeFileSync(resolve(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
}

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function bound(value, max = 1_200) {
  if (typeof value !== "string") return value;
  return value.length <= max ? value : `${value.slice(0, max)}…[bounded]`;
}

function compactSource(source) {
  return {
    sourceId: source.sourceId,
    title: source.title,
    canonicalUri: source.canonicalUri,
    publisher: source.publisher,
    retrievedAt: source.retrievedAt,
    publishedAt: source.publishedAt,
    metadata: source.metadata ?? {},
    contentExcerpt: bound(source.content, 1_600),
  };
}

function compactClaim(claim) {
  return {
    claimId: claim.claimId,
    text: bound(claim.text, 1_200),
    claimType: claim.claimType,
    qualifiers: claim.qualifiers ?? [],
    evidence: (claim.evidence ?? []).map((item) => ({
      sourceId: item.sourceId,
      relation: item.relation,
      excerpt: bound(item.excerpt, 1_200),
    })),
  };
}

function compactBundle(bundle) {
  return {
    sourceCount: bundle.sources?.length ?? 0,
    claimCount: bundle.claims?.length ?? 0,
    evidenceCount: bundle.claimEvidence?.length ?? 0,
    sources: (bundle.sources ?? []).map((source) => ({
      id: source.id,
      canonicalUri: source.canonicalUri,
      title: source.metadata?.title ?? null,
      publisher: source.publisher,
      authoritativePrimary: source.authoritativePrimary,
      provenanceConfidence: source.provenanceConfidence,
    })),
    claims: (bundle.claims ?? []).map((claim) => ({
      id: claim.id,
      text: bound(claim.text, 1_200),
      claimType: claim.claimType,
      qualifiers: claim.qualifiers,
    })),
    claimEvidence: (bundle.claimEvidence ?? []).map((item) => ({
      id: item.id,
      claimId: item.claimId,
      artifactId: item.artifactId,
      relation: item.relation,
      excerpt: bound(item.specificEvidence, 1_200),
      verification: item.verification,
      admitted: item.admitted,
      rejectionReason: item.rejectionReason,
      provenanceConfidence: item.provenanceConfidence,
      authoritativePrimary: item.authoritativePrimary,
    })),
    checks: (bundle.checks ?? []).map((check) => ({
      id: check.id,
      obligationId: check.obligationId,
      kind: check.kind,
      status: check.status,
      evidenceIds: check.evidenceIds,
      explanation: check.explanation,
    })),
    assessments: (bundle.assessments ?? []).map((assessment) => ({
      id: assessment.id,
      claimId: assessment.claimId,
      status: assessment.status,
      confidence: assessment.confidence,
      reasons: assessment.reasons,
    })),
  };
}

function governedProjection(proposal) {
  return {
    objectiveRelation: proposal.objectiveRelation,
    proposedObjective: proposal.proposedObjective,
    requestedHelp: proposal.requestedHelp,
    relevantContext: proposal.relevantContext,
    entities: proposal.entities,
    referents: proposal.referents,
    constraints: proposal.constraints,
    preferences: proposal.preferences,
    knowledgeNeeds: proposal.knowledgeNeeds,
    materialAmbiguity: proposal.materialAmbiguity,
    referencedKnowledgeId: proposal.referencedKnowledgeId,
    referencedRecommendationId: proposal.referencedRecommendationId ?? null,
    referencedOptionId: proposal.referencedOptionId ?? null,
  };
}

let activeTrace = null;

const solandra = createConfiguredSolandraCognition(config);
assert.ok(solandra, "Configured Solandra composition is required.");
const recordingCognition = {
  async interpret(input) {
    try {
      const result = await solandra.cognition.interpret(input);
      if (activeTrace) {
        activeTrace.cognition = {
          input: {
            messageId: input.messageId,
            conversationId: input.conversationId,
            message: input.message,
            currentObjective: input.currentObjective ?? null,
          },
          mode: result.mode,
          actualProvider: result.invocationProvenance.actualProvider ?? null,
          actualModel: result.invocationProvenance.actualModel ?? null,
          routeProvenance: result.invocationProvenance.routeProvenance ?? null,
          ...(result.mode === "GOVERNED" ? { projection: governedProjection(result.proposal) } : {}),
        };
        writeEvidence();
      }
      return result;
    } catch (error) {
      if (activeTrace) activeTrace.cognition = { error: errorText(error) };
      writeEvidence();
      throw error;
    }
  },
};

const investigationProviderDiagnostics = [];
const investigationProvider = new GroqKnowledgeSimplifierModelProvider({
  apiKey: config.solandraCognitionApiKey,
  diagnosticSink(diagnostic) {
    investigationProviderDiagnostics.push({
      ...diagnostic,
      content: bound(diagnostic.content, 6_000),
      provider: GROQ_KNOWLEDGE_SIMPLIFIER_PROVIDER,
      model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    });
  },
});
const investigationRuntime = new GroqKnowledgeSimplifierModelRuntime(investigationProvider);
const canonicalInvestigator = new ModelSolandraKnowledgeInvestigator(
  investigationRuntime,
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
);

const recordingInvestigator = {
  kind: canonicalInvestigator.kind,
  async plan(input) {
    const start = investigationProviderDiagnostics.length;
    try {
      const result = await canonicalInvestigator.plan(input);
      if (activeTrace) {
        activeTrace.investigation = {
          ...(activeTrace.investigation ?? {}),
          planning: {
            input: {
              runId: input.runId,
              objective: input.objective,
              context: [...input.context],
              knowledgeNeeds: [...input.knowledgeNeeds],
            },
            retrievalQueries: [...result.retrievalQueries],
            invocation: investigationProviderDiagnostics.slice(start),
          },
        };
        activeTrace.runId = input.runId;
        writeEvidence();
      }
      return result;
    } catch (error) {
      if (activeTrace) {
        activeTrace.investigation = {
          ...(activeTrace.investigation ?? {}),
          planning: {
            input: {
              runId: input.runId,
              objective: input.objective,
              context: [...input.context],
              knowledgeNeeds: [...input.knowledgeNeeds],
            },
            error: errorText(error),
            invocation: investigationProviderDiagnostics.slice(start),
          },
        };
      }
      writeEvidence();
      throw error;
    }
  },
  async selectResponsive(input) {
    const start = investigationProviderDiagnostics.length;
    try {
      const result = await canonicalInvestigator.selectResponsive(input);
      if (activeTrace) {
        const selectedClaimIds = new Set(result.selections.map((item) => item.claimId));
        const selectedSourceIds = new Set(result.selections.flatMap((item) => item.sourceIds));
        activeTrace.relevance = {
          inputCounts: { sources: input.sources.length, claims: input.claims.length },
          retrievalQueries: [...input.retrievalQueries],
          selections: result.selections.map((item) => ({ claimId: item.claimId, sourceIds: [...item.sourceIds] })),
          acceptedClaimIds: [...selectedClaimIds],
          rejectedClaimIds: input.claims.map((item) => item.claimId).filter((id) => !selectedClaimIds.has(id)),
          acceptedSourceIds: [...selectedSourceIds],
          rejectedSourceIds: input.sources.map((item) => item.sourceId).filter((id) => !selectedSourceIds.has(id)),
          modelOutput: investigationProviderDiagnostics.slice(start),
          note: "The canonical responsiveness contract returns selected identities, not natural-language rejection reasons; non-selected candidates are rejected by this model output.",
        };
        writeEvidence();
      }
      return result;
    } catch (error) {
      if (activeTrace) {
        activeTrace.relevance = {
          inputCounts: { sources: input.sources.length, claims: input.claims.length },
          retrievalQueries: [...input.retrievalQueries],
          error: errorText(error),
          modelOutput: investigationProviderDiagnostics.slice(start),
        };
      }
      writeEvidence();
      throw error;
    }
  },
};

const wikimedia = new WikimediaKnowledgeAcquisitionProvider();
const recordingRawProvider = {
  kind: wikimedia.kind,
  async acquire(input) {
    try {
      const result = await wikimedia.acquire(input);
      if (activeTrace) {
        activeTrace.rawWikimedia = {
          runId: input.runId,
          objective: input.objective,
          queries: [...(input.investigationQueries ?? [])],
          sourceCount: result.sources.length,
          candidateClaimCount: result.claims.length,
          sources: result.sources.map(compactSource),
          claims: result.claims.map(compactClaim),
        };
        writeEvidence();
      }
      return result;
    } catch (error) {
      if (activeTrace) {
        activeTrace.rawWikimedia = {
          runId: input.runId,
          objective: input.objective,
          queries: [...(input.investigationQueries ?? [])],
          error: errorText(error),
        };
      }
      writeEvidence();
      throw error;
    }
  },
};

const canonicalRelevant = new RelevantKnowledgeAcquisitionProvider(recordingRawProvider, recordingInvestigator);
const recordingRelevant = {
  kind: canonicalRelevant.kind,
  async acquire(input) {
    try {
      const result = await canonicalRelevant.acquire(input);
      if (activeTrace) {
        activeTrace.postRelevance = {
          sourceCount: result.sources.length,
          claimCount: result.claims.length,
          sources: result.sources.map(compactSource),
          claims: result.claims.map(compactClaim),
        };
        writeEvidence();
      }
      return result;
    } catch (error) {
      if (activeTrace) activeTrace.postRelevance = { error: errorText(error) };
      writeEvidence();
      throw error;
    }
  },
};

const canonicalAdmission = new AlphaDecisionKnowledgeEvidenceAdmissionPolicy();
const recordingAdmission = {
  disposition(input) {
    const result = canonicalAdmission.disposition(input);
    if (activeTrace) {
      activeTrace.v36 ??= {};
      activeTrace.v36.admissionDecisions ??= [];
      activeTrace.v36.admissionDecisions.push({
        claim: {
          id: input.claim.id,
          text: bound(input.claim.text, 1_200),
          claimType: input.claim.claimType,
          qualifiers: input.claim.qualifiers,
        },
        source: {
          id: input.source.id,
          canonicalUri: input.source.canonicalUri,
          title: input.source.metadata?.title ?? null,
          publisher: input.source.publisher,
        },
        proposed: {
          relation: input.proposed.relation,
          excerpt: bound(input.proposed.excerpt, 1_200),
        },
        disposition: result,
      });
      writeEvidence();
    }
    return result;
  },
};

const canonicalTruth = new KnowledgeAcquisitionTruthPipeline(
  new AlphaDecisionKnowledgeAcquisitionProvider(recordingRelevant),
  recordingAdmission,
);

function recordInvestigated(result) {
  if (!activeTrace) return;
  activeTrace.v36 ??= {};
  activeTrace.v36.investigated = {
    phase: result.snapshot.phase,
    serialRounds: result.serialRounds,
    bundle: compactBundle(result.snapshot.bundle),
  };
  writeEvidence();
}

function recordValidated(execution) {
  if (!activeTrace) return;
  activeTrace.v36 ??= {};
  activeTrace.v36.validated = {
    phase: execution.snapshot.phase,
    serialRounds: execution.serialRounds,
    bundle: compactBundle(execution.bundle),
  };
  writeEvidence();
}

const recordingTruth = {
  mode: canonicalTruth.mode,
  async investigate(runId, request) {
    const result = await canonicalTruth.investigate(runId, request);
    recordInvestigated(result);
    return result;
  },
  async validate(snapshot) {
    const execution = await canonicalTruth.validate(snapshot);
    recordValidated(execution);
    return execution;
  },
  async beginDurableValidation(snapshot) {
    const step = await canonicalTruth.beginDurableValidation(snapshot);
    if (step.kind === "VALIDATED") recordValidated(step.execution);
    return step;
  },
  async resumeDurableValidation(checkpoint, results) {
    const step = await canonicalTruth.resumeDurableValidation(checkpoint, results);
    if (step.kind === "VALIDATED") recordValidated(step.execution);
    return step;
  },
  async execute(runId, request) {
    const investigation = await this.investigate(runId, request);
    return this.validate(investigation.snapshot);
  },
};

const app = await createRuntimeApp(config, {
  truthPipeline: recordingTruth,
  memoryDispatchDelayMs: 100,
  solandraCognition: recordingCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function request(options) {
  const response = await app.inject(options);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
  }
  return response.json();
}

async function createConversation() {
  return (await request({ method: "POST", url: "/api/v1/conversations" })).conversation.id;
}

async function continuity(conversationId) {
  return await request({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
}

async function waitForRun(runId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const run = await request({ method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      return { run, outcomeBody: null };
    }
    if (run.status === "COMPLETED") {
      const outcomeBody = await request({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      return { run, outcomeBody };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Run ${runId} timed out.`);
}

function knowledgeSummary(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    id: item.id ?? item.knowledgeId ?? null,
    runId: item.runId ?? null,
    objective: item.objective ?? null,
    findings: Array.isArray(item.findings) ? item.findings.length : null,
    provenance: Array.isArray(item.provenance) ? item.provenance.length : null,
    uncertainties: item.uncertainties ?? null,
  }));
}

async function runCase(question, index) {
  const conversationId = await createConversation();
  const turnId = randomUUID();
  const trace = {
    index: index + 1,
    question,
    conversationId,
    turnId,
    cognition: null,
    investigation: null,
    rawWikimedia: null,
    relevance: null,
    postRelevance: null,
    v36: { admissionDecisions: [] },
    userResult: null,
  };
  evidence.cases.push(trace);
  activeTrace = trace;
  writeEvidence();

  try {
    const submitted = await request({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId, message: question },
    });
    trace.userResult = {
      submitStatus: submitted.status ?? null,
      submitAssistantMessage: submitted.presentation?.assistantMessage ?? null,
      publicInterpretation: submitted.interpretation ?? null,
      acceptedRunId: submitted.runId ?? null,
    };
    writeEvidence();

    if (!submitted.runId) {
      trace.userResult.continuity = {
        knowledge: knowledgeSummary((await continuity(conversationId)).knowledge),
      };
      writeEvidence();
      console.log(`ISSUE91_TRACE_CASE_${index + 1}=${JSON.stringify(trace)}`);
      return;
    }

    trace.runId = submitted.runId;
    const completed = await waitForRun(submitted.runId);
    const after = await continuity(conversationId);
    const outcome = completed.outcomeBody?.outcome ?? null;
    trace.userResult = {
      ...trace.userResult,
      runStatus: completed.run.status,
      canonicalObjective: completed.run.request?.objective ?? null,
      runRequest: completed.run.request ?? null,
      assistantMessage: completed.outcomeBody?.presentation?.assistantMessage ?? null,
      outcome: outcome === null ? null : {
        objective: outcome.objective,
        findings: outcome.findings,
        provenance: outcome.provenance,
        uncertainties: outcome.uncertainties,
      },
      continuity: {
        knowledge: knowledgeSummary(after.knowledge),
        runs: Array.isArray(after.runs) ? after.runs.map((item) => ({ id: item.id, status: item.status, objective: item.request?.objective ?? null })) : [],
      },
    };
    writeEvidence();
    console.log(`ISSUE91_TRACE_CASE_${index + 1}=${JSON.stringify(trace)}`);
  } catch (error) {
    trace.harnessError = errorText(error);
    writeEvidence();
    console.log(`ISSUE91_TRACE_CASE_${index + 1}=${JSON.stringify(trace)}`);
  } finally {
    activeTrace = null;
  }
}

try {
  for (const [index, question] of questions.entries()) {
    await runCase(question, index);
  }
} finally {
  await app.close();
  writeEvidence();
}

console.log(`ISSUE91_TRACE_COMPLETE=${JSON.stringify({ product: evidence.product, caseCount: evidence.cases.length })}`);
