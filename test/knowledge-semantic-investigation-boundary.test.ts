import assert from "node:assert/strict";
import test from "node:test";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  RelevantKnowledgeAcquisitionProvider,
  type KnowledgeInvestigationPlanningInput,
  type KnowledgeInvestigator,
  type KnowledgeResponsivenessInput,
} from "../src/knowledge/investigation.js";

const SOURCE_ID = "candidate-source";
const CLAIM_ID = "candidate-claim";
const KNOWLEDGE_NEED = "Determine the material relationship involved.";
const RETRIEVAL_QUERY = "material relationship mechanism evidence";

class CandidateProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "candidate-provider";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: SOURCE_ID,
        canonicalUri: "https://example.test/candidate",
        title: "Candidate source",
        publisher: "Example",
        retrievedAt: "2026-09-10T00:00:00.000Z",
        publishedAt: null,
        contentType: "text/plain",
        content: "Candidate source material.",
      }],
      claims: [{
        claimId: CLAIM_ID,
        text: "Candidate source material.",
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: SOURCE_ID, relation: "SUPPORTS", excerpt: "Candidate source material." }],
      }],
    };
  }
}

class RecordingInvestigator implements KnowledgeInvestigator {
  readonly kind = "recording-investigator";
  readonly planningInputs: KnowledgeInvestigationPlanningInput[] = [];
  readonly responsivenessInputs: KnowledgeResponsivenessInput[] = [];

  constructor(private readonly selection: { claimId: string; sourceIds: string[] }) {}

  async plan(input: KnowledgeInvestigationPlanningInput) {
    this.planningInputs.push(structuredClone(input));
    return { retrievalQueries: [RETRIEVAL_QUERY] };
  }

  async selectResponsive(input: KnowledgeResponsivenessInput) {
    this.responsivenessInputs.push(structuredClone(input));
    return { selections: [this.selection] };
  }
}

test("conceptual Knowledge needs are not issued directly as provider retrieval queries", async () => {
  const provider = new CandidateProvider();
  const investigator = new RecordingInvestigator({ claimId: CLAIM_ID, sourceIds: [SOURCE_ID] });
  const acquisition = new RelevantKnowledgeAcquisitionProvider(provider, investigator);

  const result = await acquisition.acquire({
    runId: "semantic-boundary-run",
    objective: "Understand the material relationship.",
    context: [],
    investigationQueries: [KNOWLEDGE_NEED],
  });

  assert.deepEqual(investigator.planningInputs[0]?.knowledgeNeeds, [KNOWLEDGE_NEED]);
  assert.deepEqual(provider.requests[0]?.investigationQueries, [RETRIEVAL_QUERY]);
  assert.notDeepEqual(provider.requests[0]?.investigationQueries, [KNOWLEDGE_NEED]);
  assert.deepEqual(investigator.responsivenessInputs[0]?.retrievalQueries, [RETRIEVAL_QUERY]);
  assert.deepEqual(result.sources.map((source) => source.sourceId), [SOURCE_ID]);
  assert.deepEqual(result.claims.map((claim) => claim.claimId), [CLAIM_ID]);
});

test("Solandra responsiveness cannot invent claim or source provenance", async () => {
  const unknownClaimProvider = new CandidateProvider();
  const unknownClaim = new RelevantKnowledgeAcquisitionProvider(
    unknownClaimProvider,
    new RecordingInvestigator({ claimId: "invented-claim", sourceIds: [SOURCE_ID] }),
  );
  await assert.rejects(
    unknownClaim.acquire({
      runId: "unknown-claim-run",
      objective: "Understand the material relationship.",
      context: [],
      investigationQueries: [KNOWLEDGE_NEED],
    }),
    /unknown claim invented-claim/u,
  );

  const unknownSourceProvider = new CandidateProvider();
  const unknownSource = new RelevantKnowledgeAcquisitionProvider(
    unknownSourceProvider,
    new RecordingInvestigator({ claimId: CLAIM_ID, sourceIds: ["invented-source"] }),
  );
  await assert.rejects(
    unknownSource.acquire({
      runId: "unknown-source-run",
      objective: "Understand the material relationship.",
      context: [],
      investigationQueries: [KNOWLEDGE_NEED],
    }),
    /unknown source invented-source/u,
  );
});
