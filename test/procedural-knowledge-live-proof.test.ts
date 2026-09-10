import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import {
  DeterministicKnowledgeInvestigationQueryDeriver,
  ObjectiveKnowledgeRelevanceQualifier,
  RelevantKnowledgeAcquisitionProvider,
} from "../src/knowledge/investigation.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { buildKnowledgeOutcome } from "../src/outcome.js";
import type { LatticeRun, LatticeRunRequest } from "../src/domain.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const OBJECTIVE = "I need to know how to prepare my soil for sod.";
const CANDIDATE = "72d75b821c907e7bb408e93344fd455a9e7ed5f4";

class ReplayProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "procedural-diagnostic-replay";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  constructor(private readonly result: KnowledgeAcquisitionResult) {}

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.result);
  }
}

function bounded(value: string, max = 1_200): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

test("trace where responsive sod information disappears before governed Knowledge", { timeout: 120_000 }, async () => {
  const runId = randomUUID();
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();
  const qualifier = new ObjectiveKnowledgeRelevanceQualifier();
  const queries = [...deriver.derive({ objective: OBJECTIVE, context: [] })];

  const rawProvider = new WikimediaKnowledgeAcquisitionProvider();
  const raw = await rawProvider.acquire({
    runId,
    objective: OBJECTIVE,
    context: [],
    investigationQueries: queries,
  });

  const sourceById = new Map(raw.sources.map((source) => [source.sourceId, source]));
  const relevance = raw.claims.map((claim) => {
    const evidence = claim.evidence.map((item) => {
      const source = sourceById.get(item.sourceId);
      if (!source) {
        return {
          sourceId: item.sourceId,
          sourceTitle: null,
          admitted: false,
          rationale: "Claim evidence referenced a missing acquired source.",
          matchedTerms: [] as string[],
        };
      }
      const disposition = qualifier.disposition({
        objective: OBJECTIVE,
        context: [],
        queries,
        source,
        claim,
      });
      return {
        sourceId: item.sourceId,
        sourceTitle: source.title,
        admitted: disposition.relevant,
        rationale: disposition.rationale,
        matchedTerms: [...disposition.matchedTerms],
      };
    });
    return {
      claimId: claim.claimId,
      claimText: bounded(claim.text),
      evidence,
    };
  });

  const rawReplay = new ReplayProvider(raw);
  const relevanceProvider = new RelevantKnowledgeAcquisitionProvider(rawReplay, deriver, qualifier);
  const relevant = await relevanceProvider.acquire({
    runId,
    objective: OBJECTIVE,
    context: [],
    investigationQueries: queries,
  });

  const v36Replay = new ReplayProvider(relevant);
  const pipeline = new KnowledgeAcquisitionTruthPipeline(v36Replay);
  const request: LatticeRunRequest = {
    kind: "consultation",
    objective: OBJECTIVE,
    context: [],
    decisionNeed: "NONE",
    resourceNeed: "NONE",
    sourceMessageId: "procedural-diagnostic-message",
    sourceMessageDigest: "d".repeat(64),
    intentVersion: 1,
    intentScopeId: "procedural-diagnostic-scope",
    intentVersionId: "procedural-diagnostic-intent",
  };

  const investigated = await pipeline.investigate(runId, request);
  const validated = await pipeline.validate(investigated.snapshot);
  const run: LatticeRun = {
    id: runId,
    conversationId: "procedural-diagnostic-conversation",
    status: "COMPLETED",
    version: 1,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: validated.bundle.assessments.map((assessment) => assessment.id),
    events: [
      { sequence: 1, type: "CREATED" },
      { sequence: 2, type: "INVESTIGATING" },
      { sequence: 3, type: "VALIDATING" },
      { sequence: 4, type: "COMPLETED" },
    ],
  };
  const knowledge = buildKnowledgeOutcome(run, validated.bundle);
  const validatedClaimById = new Map(validated.bundle.claims.map((claim) => [claim.id, claim]));

  const report = {
    candidate: CANDIDATE,
    userRequest: OBJECTIVE,
    investigationQueries: queries,
    acquisition: {
      sourceCount: raw.sources.length,
      claimCount: raw.claims.length,
      sources: raw.sources.map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        canonicalUri: source.canonicalUri,
        boundedSourceExcerpt: bounded(source.content),
      })),
      claimProposals: raw.claims.map((claim) => ({
        claimId: claim.claimId,
        claimType: claim.claimType,
        text: bounded(claim.text),
        evidence: claim.evidence.map((item) => ({
          sourceId: item.sourceId,
          relation: item.relation,
          excerpt: bounded(item.excerpt),
        })),
      })),
    },
    relevance,
    materialReachingV36: {
      sourceCount: relevant.sources.length,
      claimCount: relevant.claims.length,
      sources: relevant.sources.map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        canonicalUri: source.canonicalUri,
        boundedSourceExcerpt: bounded(source.content),
      })),
      claims: relevant.claims.map((claim) => ({
        claimId: claim.claimId,
        claimType: claim.claimType,
        text: bounded(claim.text),
        evidence: claim.evidence.map((item) => ({
          sourceId: item.sourceId,
          relation: item.relation,
          excerpt: bounded(item.excerpt),
        })),
      })),
    },
    v36: {
      investigated: {
        sources: investigated.snapshot.bundle.sources.map((source) => ({
          id: source.id,
          title: source.metadata.title,
          canonicalUri: source.canonicalUri,
        })),
        claims: investigated.snapshot.bundle.claims.map((claim) => ({
          id: claim.id,
          text: bounded(claim.text),
        })),
        evidence: investigated.snapshot.bundle.claimEvidence.map((item) => ({
          claimId: item.claimId,
          verification: item.verification,
          admitted: item.admitted,
          rejectionReason: item.rejectionReason,
          excerpt: bounded(item.specificEvidence),
        })),
        assessments: investigated.snapshot.bundle.assessments.map((assessment) => ({
          claimId: assessment.claimId,
          text: bounded(validatedClaimById.get(assessment.claimId)?.text ?? ""),
          atomicDisposition: assessment.atomicDisposition,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          contradictoryEvidenceIds: assessment.contradictoryEvidenceIds,
          unresolvedObligationIds: assessment.unresolvedObligationIds,
          rationale: assessment.rationale,
        })),
      },
      validated: {
        evidence: validated.bundle.claimEvidence.map((item) => ({
          claimId: item.claimId,
          verification: item.verification,
          admitted: item.admitted,
          rejectionReason: item.rejectionReason,
          excerpt: bounded(item.specificEvidence),
        })),
        assessments: validated.bundle.assessments.map((assessment) => ({
          claimId: assessment.claimId,
          text: bounded(validatedClaimById.get(assessment.claimId)?.text ?? ""),
          atomicDisposition: assessment.atomicDisposition,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          contradictoryEvidenceIds: assessment.contradictoryEvidenceIds,
          unresolvedObligationIds: assessment.unresolvedObligationIds,
          rationale: assessment.rationale,
        })),
      },
    },
    governedKnowledge: {
      findings: knowledge.findings,
      uncertainties: knowledge.uncertainties,
      provenance: knowledge.provenance,
      evidence: knowledge.evidence,
    },
  };

  console.log(`PROCEDURAL_KNOWLEDGE_STAGE_TRACE=${JSON.stringify(report)}`);

  assert.ok(queries.some((query) => /prepare/iu.test(query) && /soil/iu.test(query) && /sod/iu.test(query)));
  assert.ok(queries.every((query) => !/\bneed\b/iu.test(query)));
});
