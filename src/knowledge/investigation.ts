import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";

export interface KnowledgeInvestigationPlanningInput {
  readonly runId: string;
  readonly objective: string;
  readonly context: readonly string[];
  /** Non-authoritative statements of what information is still needed. */
  readonly knowledgeNeeds: readonly string[];
}

export interface KnowledgeInvestigationPlan {
  /** Provider-ready retrieval work proposed by Solandra; never USER intent or truth. */
  readonly retrievalQueries: readonly string[];
}

export interface KnowledgeResponsivenessSelection {
  readonly claimId: string;
  readonly sourceIds: readonly string[];
}

export interface KnowledgeResponsivenessInput {
  readonly runId: string;
  readonly objective: string;
  readonly context: readonly string[];
  readonly knowledgeNeeds: readonly string[];
  readonly retrievalQueries: readonly string[];
  readonly sources: readonly RetrievedKnowledgeSource[];
  readonly claims: readonly RetrievedKnowledgeClaim[];
}

export interface KnowledgeResponsivenessResult {
  /** Exact acquired claim/source identities Solandra considers responsive to the work. */
  readonly selections: readonly KnowledgeResponsivenessSelection[];
}

/**
 * Non-authoritative semantic investigation boundary. Implementations may decide
 * where to look and which acquired candidates respond to the USER's work, but
 * they cannot establish USER intent, provenance, truth, a decision, or authority.
 */
export interface KnowledgeInvestigator {
  readonly kind: string;
  plan(input: KnowledgeInvestigationPlanningInput): Promise<KnowledgeInvestigationPlan>;
  selectResponsive(input: KnowledgeResponsivenessInput): Promise<KnowledgeResponsivenessResult>;
}

function uniqueNonBlank(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Solandra-owned semantic bridge around a source acquisition adapter.
 *
 * Incoming investigationQueries are legacy transport for Solandra's conceptual
 * knowledgeNeeds. They are never issued directly to the provider. The semantic
 * investigator first formulates provider-ready retrieval work, then evaluates
 * candidate responsiveness. Lattice only validates that selected identities
 * actually came from the acquisition result before V36 sees them.
 */
export class RelevantKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind: string;

  constructor(
    private readonly provider: KnowledgeAcquisitionProvider,
    private readonly investigator: KnowledgeInvestigator,
  ) {
    if (!provider.kind.trim() || !investigator.kind.trim()) {
      throw new Error("Knowledge acquisition and semantic investigation require non-blank kinds.");
    }
    this.kind = `solandra-responsive:${provider.kind}:${investigator.kind}`;
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    const knowledgeNeeds = uniqueNonBlank(request.investigationQueries ?? []);
    const plan = await this.investigator.plan({
      runId: request.runId,
      objective: request.objective,
      context: request.context,
      knowledgeNeeds,
    });
    const retrievalQueries = uniqueNonBlank(plan.retrievalQueries);
    if (retrievalQueries.length === 0) {
      throw new Error("Solandra investigation produced no provider-ready retrieval work.");
    }

    const acquired = await this.provider.acquire({
      ...request,
      investigationQueries: retrievalQueries,
    });
    const selected = await this.investigator.selectResponsive({
      runId: request.runId,
      objective: request.objective,
      context: request.context,
      knowledgeNeeds,
      retrievalQueries,
      sources: acquired.sources,
      claims: acquired.claims,
    });

    const sourceById = new Map(acquired.sources.map((source) => [source.sourceId, source]));
    const claimById = new Map(acquired.claims.map((claim) => [claim.claimId, claim]));
    const selectedSourceIds = new Set<string>();
    const claims: RetrievedKnowledgeClaim[] = [];
    const seenClaimIds = new Set<string>();

    for (const selection of selected.selections) {
      if (seenClaimIds.has(selection.claimId)) {
        throw new Error(`Solandra responsiveness selection duplicated claim ${selection.claimId}.`);
      }
      seenClaimIds.add(selection.claimId);
      const claim = claimById.get(selection.claimId);
      if (!claim) {
        throw new Error(`Solandra responsiveness selection referenced unknown claim ${selection.claimId}.`);
      }
      const requestedSourceIds = new Set(uniqueNonBlank(selection.sourceIds));
      if (requestedSourceIds.size === 0) {
        throw new Error(`Solandra responsiveness selection for ${selection.claimId} requires acquired source identity.`);
      }

      for (const sourceId of requestedSourceIds) {
        if (!sourceById.has(sourceId)) {
          throw new Error(`Solandra responsiveness selection referenced unknown source ${sourceId}.`);
        }
      }

      const evidence = claim.evidence.filter((item) => requestedSourceIds.has(item.sourceId));
      if (evidence.length !== requestedSourceIds.size) {
        throw new Error(`Solandra responsiveness selection referenced a source not bound to claim ${selection.claimId}.`);
      }
      for (const item of evidence) selectedSourceIds.add(item.sourceId);
      claims.push({ ...claim, evidence });
    }

    return {
      sources: acquired.sources.filter((source) => selectedSourceIds.has(source.sourceId)),
      claims,
    };
  }
}
