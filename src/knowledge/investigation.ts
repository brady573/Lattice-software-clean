import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
  RetrievedKnowledgeClaim,
  RetrievedKnowledgeSource,
} from "./acquisition.js";

const MAX_QUERIES = 2;
const MAX_QUERY_CHARS = 240;
const MAX_RELEVANCE_TEXT_CHARS = 16_000;

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "before", "being", "can", "could", "does",
  "from", "have", "how", "into", "its", "know", "more", "should", "that", "the", "their", "then", "there",
  "these", "they", "this", "through", "understand", "using", "want", "what", "when", "where", "which",
  "who", "why", "with", "would", "your",
]);

const GENERIC_RELATION_TERMS = new Set([
  "cause", "causes", "caused", "causing", "direction", "directions", "east", "effect", "effects", "find",
  "location", "make", "makes", "made", "mechanism", "north", "orientation", "south", "west",
]);

function normalizedTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    ?? [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function conceptExpansion(value: string): string[] {
  const concepts: string[] = [];
  if (/\b(?:direction|directions|north|south|east|west|orient|orientation|locate|location|navigate|navigation|find|sense|sensing)\b/iu.test(value)) {
    concepts.push("navigation", "orientation");
  }
  if (/\b(?:why|cause|causes|caused|causing|mechanism|effect|effects|make|makes|made|slower|faster)\b/iu.test(value)) {
    concepts.push("mechanism", "causes");
  }
  if (/\b(?:before|prepare|preparing|preparation|consider|considerations|should|understand)\b/iu.test(value)) {
    concepts.push("preparation", "considerations");
  }
  if (/\b(?:compare|comparison|difference|differences|versus)\b/iu.test(value)) {
    concepts.push("comparison");
  }
  return unique(concepts);
}

function boundedQuery(parts: readonly string[]): string {
  return parts.join(" ").replace(/\s+/gu, " ").trim().slice(0, MAX_QUERY_CHARS);
}

export interface KnowledgeInvestigationQueryInput {
  readonly objective: string;
  readonly context: readonly string[];
}

/** Non-authoritative operational query derivation. It never changes accepted USER meaning. */
export interface KnowledgeInvestigationQueryDeriver {
  readonly kind: string;
  derive(input: KnowledgeInvestigationQueryInput): readonly string[];
}

/**
 * Small deterministic baseline for turning natural objectives into bounded search concepts.
 * It deliberately uses only general language cues rather than domain-specific ontology.
 */
export class DeterministicKnowledgeInvestigationQueryDeriver implements KnowledgeInvestigationQueryDeriver {
  readonly kind = "deterministic-language-query-v1";

  derive(input: KnowledgeInvestigationQueryInput): readonly string[] {
    const objective = input.objective.trim();
    if (!objective) throw new Error("Knowledge investigation query derivation requires an objective.");

    const objectiveTerms = unique(normalizedTokens(objective)).slice(0, 8);
    const latestContext = input.context.at(-1)?.trim() ?? "";
    const contextTerms = unique(normalizedTokens(latestContext)).slice(0, 4);
    const concepts = conceptExpansion(`${objective}\n${latestContext}`);
    const specificTerms = objectiveTerms.filter((term) => !GENERIC_RELATION_TERMS.has(term));
    const anchor = specificTerms[0] ?? objectiveTerms[0];

    const candidates: string[] = [];
    if (anchor && concepts.length > 0) {
      candidates.push(boundedQuery([anchor, ...concepts]));
    }
    if (objectiveTerms.length > 0) {
      candidates.push(boundedQuery([...objectiveTerms, ...contextTerms]));
    }
    if (candidates.length === 0) candidates.push(objective.slice(0, MAX_QUERY_CHARS));

    return unique(candidates.filter(Boolean)).slice(0, MAX_QUERIES);
  }
}

export interface KnowledgeRelevanceQualificationInput {
  readonly objective: string;
  readonly context: readonly string[];
  readonly queries: readonly string[];
  readonly source: RetrievedKnowledgeSource;
  readonly claim: RetrievedKnowledgeClaim;
}

export interface KnowledgeRelevanceDisposition {
  readonly relevant: boolean;
  readonly rationale: string;
  readonly matchedTerms: readonly string[];
}

/** Operational relevance only. It must never answer whether a claim is true. */
export interface KnowledgeRelevanceQualifier {
  readonly kind: string;
  disposition(input: KnowledgeRelevanceQualificationInput): KnowledgeRelevanceDisposition;
}

function tokenMatches(term: string, candidate: string): boolean {
  if (term === candidate) return true;
  if (term.length < 5 || candidate.length < 5) return false;
  return term.startsWith(candidate) || candidate.startsWith(term);
}

function matchingTerms(terms: readonly string[], candidateTokens: readonly string[]): string[] {
  return unique(terms.filter((term) => candidateTokens.some((candidate) => tokenMatches(term, candidate))));
}

/**
 * Conservative lexical/concept gate. Passing this gate means only that a source materially
 * overlaps the current investigation objective; V36 still owns evidence admission and truth.
 */
export class ObjectiveKnowledgeRelevanceQualifier implements KnowledgeRelevanceQualifier {
  readonly kind = "objective-concept-relevance-v1";

  disposition(input: KnowledgeRelevanceQualificationInput): KnowledgeRelevanceDisposition {
    const objectiveTerms = unique(normalizedTokens(input.objective));
    const queryTerms = unique(input.queries.flatMap((query) => normalizedTokens(query)))
      .filter((term) => !objectiveTerms.includes(term));
    const anchorTerms = objectiveTerms.filter((term) => !GENERIC_RELATION_TERMS.has(term)).slice(0, 3);
    const candidateText = [
      input.source.title,
      input.claim.text,
      input.source.content.slice(0, MAX_RELEVANCE_TEXT_CHARS),
    ].join("\n");
    const candidateTokens = unique(normalizedTokens(candidateText));
    const titleTokens = unique(normalizedTokens(input.source.title));

    const objectiveMatches = matchingTerms(objectiveTerms, candidateTokens);
    const queryMatches = matchingTerms(queryTerms, candidateTokens);
    const anchorMatches = matchingTerms(anchorTerms, candidateTokens);
    const titleAnchorMatches = matchingTerms(anchorTerms, titleTokens);

    const relevant = objectiveTerms.length <= 1
      ? objectiveMatches.length >= 1
      : titleAnchorMatches.length >= 1
        || (anchorMatches.length >= 1 && (objectiveMatches.length >= 2 || queryMatches.length >= 1))
        || (objectiveMatches.length >= 1 && queryMatches.length >= 2)
        || queryMatches.length >= 3;

    return {
      relevant,
      rationale: relevant
        ? "Retrieved material overlaps the objective-specific or derived investigation concepts."
        : "Retrieved material lacks enough objective-specific overlap to enter visible Knowledge.",
      matchedTerms: unique([...objectiveMatches, ...queryMatches]),
    };
  }
}

/**
 * Provider-neutral operational wrapper: derive where to look, retrieve, then exclude material
 * that is not relevant enough to the current objective before V36 truth qualification.
 */
export class RelevantKnowledgeAcquisitionProvider implements KnowledgeAcquisitionProvider {
  readonly kind: string;

  constructor(
    private readonly provider: KnowledgeAcquisitionProvider,
    private readonly queryDeriver: KnowledgeInvestigationQueryDeriver = new DeterministicKnowledgeInvestigationQueryDeriver(),
    private readonly relevanceQualifier: KnowledgeRelevanceQualifier = new ObjectiveKnowledgeRelevanceQualifier(),
  ) {
    if (!provider.kind.trim() || !queryDeriver.kind.trim() || !relevanceQualifier.kind.trim()) {
      throw new Error("Knowledge investigation components require non-blank kinds.");
    }
    this.kind = `relevant:${provider.kind}:${queryDeriver.kind}:${relevanceQualifier.kind}`;
  }

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    const queries = this.queryDeriver.derive({ objective: request.objective, context: request.context });
    const acquired = await this.provider.acquire({ ...request, investigationQueries: queries });
    const sourceById = new Map(acquired.sources.map((source) => [source.sourceId, source]));
    const relevantSourceIds = new Set<string>();
    const claims: RetrievedKnowledgeClaim[] = [];

    for (const claim of acquired.claims) {
      const evidence = claim.evidence.filter((item) => {
        const source = sourceById.get(item.sourceId);
        if (!source) return false;
        const disposition = this.relevanceQualifier.disposition({
          objective: request.objective,
          context: request.context,
          queries,
          source,
          claim,
        });
        if (disposition.relevant) relevantSourceIds.add(item.sourceId);
        return disposition.relevant;
      });
      if (evidence.length > 0) claims.push({ ...claim, evidence });
    }

    return {
      sources: acquired.sources.filter((source) => relevantSourceIds.has(source.sourceId)),
      claims,
    };
  }
}
