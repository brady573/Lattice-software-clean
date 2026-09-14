import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun, LatticeRunRequest } from "../src/domain.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigator,
} from "../src/knowledge/investigation.js";
import { buildKnowledgeOutcome } from "../src/outcome.js";
import { renderKnowledgeResponseForRun } from "../src/presentation/solandra/knowledge-response.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const request: LatticeRunRequest = {
  kind: "consultation",
  objective: "Explain an unfamiliar physical process.",
  context: [],
  investigationQueries: ["external information needed"],
  advisoryRequested: false,
  decisionNeed: "NONE",
  resourceNeed: "NONE",
  sourceMessageId: "issue-91-partial-message",
  sourceMessageDigest: "9".repeat(64),
  intentVersion: 1,
  intentScopeId: "issue-91-partial-scope",
  intentVersionId: "issue-91-partial-intent",
};

function run(id: string): LatticeRun {
  return {
    id,
    conversationId: "issue-91-partial-conversation",
    status: "COMPLETED",
    version: 1,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [],
  };
}

function partialSourceResult(): KnowledgeAcquisitionResult {
  const text = "A retrieved source reports a material explanation of the process.";
  return {
    sources: [{
      sourceId: "partial-source",
      canonicalUri: "https://example.test/partial-source",
      title: "Partial source",
      publisher: "Example",
      retrievedAt: "2026-09-13T12:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: text,
      metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
    }],
    claims: [{
      claimId: "partial-claim",
      text,
      claimType: "INTERPRETIVE",
      evidence: [{ sourceId: "partial-source", relation: "SUPPORTS", excerpt: text }],
    }],
    completion: { status: "PARTIAL", reason: "RATE_LIMITED" },
  };
}

class FixedProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "issue-91-fixed-provider";
  constructor(private readonly result: KnowledgeAcquisitionResult) {}
  async acquire(_request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    return structuredClone(this.result);
  }
}

const investigator: KnowledgeInvestigator = {
  kind: "issue-91-fixed-investigator",
  async plan() {
    return { retrievalQueries: ["provider-ready query"] };
  },
  async selectResponsive(input) {
    return {
      selections: input.claims.map((claim) => ({
        claimId: claim.claimId,
        sourceIds: claim.evidence.map((item) => item.sourceId),
      })),
    };
  },
};

test("Issue #91: semantic responsiveness preserves typed partial acquisition state", async () => {
  const acquisition = new RelevantKnowledgeAcquisitionProvider(
    new FixedProvider(partialSourceResult()),
    investigator,
  );
  const result = await acquisition.acquire({
    runId: "issue-91-responsive-partial",
    objective: request.objective,
    context: [],
    investigationQueries: request.investigationQueries,
  });

  assert.deepEqual(result.completion, { status: "PARTIAL", reason: "RATE_LIMITED" });
  assert.equal(result.sources.length, 1);
  assert.equal(result.claims.length, 1);
});

test("Issue #91: partial source material still reaches V36 while incompleteness remains explicit", async () => {
  const pipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider(partialSourceResult()));
  const execution = await pipeline.execute("issue-91-partial-v36", request);
  const acquisitionState = execution.bundle.claims.find((claim) =>
    claim.qualifiers.some((item) => item.key === "acquisition-state" && item.value === "PARTIAL"));
  assert.ok(acquisitionState);
  assert.equal(
    acquisitionState.qualifiers.find((item) => item.key === "acquisition-reason")?.value,
    "RATE_LIMITED",
  );
  assert.equal(execution.bundle.sources.length, 1);
  assert.equal(execution.bundle.claimEvidence[0]?.admitted, true);

  const knowledge = buildKnowledgeOutcome(run("issue-91-partial-v36"), execution.bundle);
  assert.equal(knowledge.findings.length, 1);
  assert.equal(knowledge.provenance.length, 1);
  assert.ok(knowledge.uncertainties.some((item) => item.includes("source provider limited further requests")));
  const message = await renderKnowledgeResponseForRun(knowledge, run("issue-91-partial-v36"));
  assert.match(message, /retrieved source material reports/iu);
  assert.match(message, /source provider limited further requests/iu);
});

test("Issue #91: zero-source partial acquisition is distinct from complete no-relevant-evidence state", async () => {
  const partialPipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider({
    sources: [],
    claims: [],
    completion: { status: "PARTIAL", reason: "TIMED_OUT" },
  }));
  const partialExecution = await partialPipeline.execute("issue-91-empty-partial", request);
  const partialKnowledge = buildKnowledgeOutcome(run("issue-91-empty-partial"), partialExecution.bundle);
  assert.deepEqual(partialKnowledge.findings, []);
  assert.equal(partialKnowledge.uncertainties.length, 1);
  assert.match(partialKnowledge.uncertainties[0] ?? "", /source request timed out/iu);
  const partialMessage = await renderKnowledgeResponseForRun(
    partialKnowledge,
    run("issue-91-empty-partial"),
  );
  assert.match(partialMessage, /source request timed out/iu);
  assert.doesNotMatch(partialMessage, /couldn't establish enough relevant evidence/iu);

  const completePipeline = new KnowledgeAcquisitionTruthPipeline(new FixedProvider({
    sources: [],
    claims: [],
    completion: { status: "COMPLETE" },
  }));
  const completeExecution = await completePipeline.execute("issue-91-empty-complete", request);
  const completeKnowledge = buildKnowledgeOutcome(run("issue-91-empty-complete"), completeExecution.bundle);
  assert.deepEqual(completeKnowledge.findings, []);
  assert.deepEqual(completeKnowledge.uncertainties, [
    "No validated external findings are sufficiently relevant to this objective.",
  ]);
  const completeMessage = await renderKnowledgeResponseForRun(
    completeKnowledge,
    run("issue-91-empty-complete"),
  );
  assert.equal(completeMessage, "I couldn't establish enough relevant evidence to answer that reliably.");
});
