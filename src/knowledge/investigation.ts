import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";
import { ModelProviderError } from "../model/errors.js";

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

export class KnowledgeInvestigationOperationalError extends Error {
  readonly phase?: KnowledgeInvestigationPhase;
  readonly failure?: KnowledgeInvestigationFailureCause;

  constructor(
    message: string,
    options?: ErrorOptions & {
      phase?: KnowledgeInvestigationPhase;
      failure?: KnowledgeInvestigationFailureCause;
    },
  ) {
    super(message, options);
    this.name = "KnowledgeInvestigationOperationalError";
    if (options?.phase !== undefined) this.phase = options.phase;
    if (options?.failure !== undefined) this.failure = options.failure;
  }
}

/**
 * Structural investigation stage that produced an operational failure.
 * General across topics, wording, domains, and providers.
 */
export type KnowledgeInvestigationPhase =
  | "PLANNING"
  | "PLANNING_EMPTY"
  | "RESPONSIVENESS"
  | "SELECTION_VALIDATION";

/**
 * Bounded structural metadata for an underlying model-call failure.
 * Never carries prompts, output, queries, sources, claims, or credentials.
 */
export interface KnowledgeInvestigationFailureCause {
  readonly code: string;
  readonly statusCode: number | null;
  readonly retryable: boolean;
}

export function investigationFailureCause(error: unknown): KnowledgeInvestigationFailureCause | undefined {
  if (error instanceof ModelProviderError) {
    return {
      code: error.code,
      statusCode: error.statusCode,
      retryable: error.retryable,
    };
  }
  return undefined;
}

function uniqueNonBlank(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function assertUniqueAcquiredIdentities(acquired: KnowledgeAcquisitionResult): void {
  const sourceIds = acquired.sources.map((source) => source.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("Retrieved source IDs must be unique before Solandra responsiveness selection.");
  }
  const claimIds = acquired.claims.map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) {
    throw new Error("Retrieved claim IDs must be unique before Solandra responsiveness selection.");
  }
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
    let plan: KnowledgeInvestigationPlan;
    try {
      plan = await this.investigator.plan({
        runId: request.runId,
        objective: request.objective,
        context: request.context,
        knowledgeNeeds,
      });
    } catch (error) {
      const failure = investigationFailureCause(error);
      throw new KnowledgeInvestigationOperationalError(
        "Knowledge investigation cognition could not complete planning.",
        failure === undefined ? { cause: error, phase: "PLANNING" } : { cause: error, phase: "PLANNING", failure },
      );
    }
    const retrievalQueries = uniqueNonBlank(plan.retrievalQueries);
    if (retrievalQueries.length === 0) {
      throw new KnowledgeInvestigationOperationalError(
        "Knowledge investigation cognition produced no provider-ready retrieval work.",
        { phase: "PLANNING_EMPTY" },
      );
    }

    const acquired = await this.provider.acquire({
      ...request,
      investigationQueries: retrievalQueries,
    });
    assertUniqueAcquiredIdentities(acquired);
    if (acquired.completion?.status === "FAILED") {
      return {
        sources: acquired.sources,
        claims: acquired.claims,
        completion: acquired.completion,
      };
    }
    if (acquired.sources.length === 0 || acquired.claims.length === 0) {
      return {
        sources: acquired.sources,
        claims: acquired.claims,
        ...(acquired.completion === undefined ? {} : { completion: acquired.completion }),
        disposition: "NO_CANDIDATES",
      };
    }

    let selected: KnowledgeResponsivenessResult;
    try {
      selected = await this.investigator.selectResponsive({
        runId: request.runId,
        objective: request.objective,
        context: request.context,
        knowledgeNeeds,
        retrievalQueries,
        sources: acquired.sources,
        claims: acquired.claims,
      });
    } catch (error) {
      const failure = investigationFailureCause(error);
      throw new KnowledgeInvestigationOperationalError(
        "Knowledge investigation cognition could not complete semantic responsiveness selection.",
        failure === undefined
          ? { cause: error, phase: "RESPONSIVENESS" }
          : { cause: error, phase: "RESPONSIVENESS", failure },
      );
    }

    const sourceById = new Map(acquired.sources.map((source) => [source.sourceId, source]));
    const claimById = new Map(acquired.claims.map((claim) => [claim.claimId, claim]));
    const selectedSourceIds = new Set<string>();
    const claims: RetrievedKnowledgeClaim[] = [];
    const seenClaimIds = new Set<string>();

    for (const selection of selected.selections) {
      if (seenClaimIds.has(selection.claimId)) {
        throw new KnowledgeInvestigationOperationalError(
          `Solandra responsiveness selection duplicated claim ${selection.claimId}.`,
          { phase: "SELECTION_VALIDATION" },
        );
      }
      seenClaimIds.add(selection.claimId);
      const claim = claimById.get(selection.claimId);
      if (!claim) {
        throw new KnowledgeInvestigationOperationalError(
          `Solandra responsiveness selection referenced unknown claim ${selection.claimId}.`,
          { phase: "SELECTION_VALIDATION" },
        );
      }
      const requestedSourceIds = new Set(uniqueNonBlank(selection.sourceIds));
      if (requestedSourceIds.size === 0) {
        throw new KnowledgeInvestigationOperationalError(
          `Solandra responsiveness selection for ${selection.claimId} requires acquired source identity.`,
          { phase: "SELECTION_VALIDATION" },
        );
      }

      for (const sourceId of requestedSourceIds) {
        if (!sourceById.has(sourceId)) {
          throw new KnowledgeInvestigationOperationalError(
            `Solandra responsiveness selection referenced unknown source ${sourceId}.`,
            { phase: "SELECTION_VALIDATION" },
          );
        }
      }

      const evidence = claim.evidence.filter((item) => requestedSourceIds.has(item.sourceId));
      const evidencedSourceIds = new Set(evidence.map((item) => item.sourceId));
      for (const sourceId of requestedSourceIds) {
        if (!evidencedSourceIds.has(sourceId)) {
          throw new KnowledgeInvestigationOperationalError(
            `Solandra responsiveness selection referenced a source not bound to claim ${selection.claimId}.`,
            { phase: "SELECTION_VALIDATION" },
          );
        }
      }
      for (const item of evidence) selectedSourceIds.add(item.sourceId);
      claims.push({ ...claim, evidence });
    }

    return {
      sources: acquired.sources.filter((source) => selectedSourceIds.has(source.sourceId)),
      claims,
      ...(acquired.completion === undefined ? {} : { completion: acquired.completion }),
      disposition: claims.length === 0 ? "NO_RESPONSIVE" : "RESPONSIVE",
    };
  }
}
