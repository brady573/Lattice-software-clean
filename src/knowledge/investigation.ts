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
  "location", "make", "makes", "made", "mechanism", "navigate", "navigation", "north", "orient", "orientation",
  "sense", "sensing", "south", "west",
]);

const CAUSE_SEEKING_OBJECTIVE_PATTERN = /\b(?:why|cause|causes|caused|causing|mechanism)\b/iu;
const LOCAL_CAUSAL_RELATION_PATTERN = /\b(?:because|cause|causes|caused|causing|due|affect|affects|affected|affecting|lead|leads|led|leading|result|results|resulted|resulting|require|requires|required|requiring|react|reacts|reacted|reacting|trigger|triggers|triggered|triggering|produce|produces|produced|producing|create|creates|created|creating|make|makes|made|making|drive|drives|drove|driven|driving)\b/iu;
const EXPLANATION_FOLLOWS_PATTERN = /\b(?:because|due\s+to)\b/iu;
const SUPPORTED_MECHANISM_PATTERN = /\b(?:require|requires|required|requiring|react|reacts|reacted|reacting)\b/iu;
const EFFECT_FOLLOWS_PATTERN = /\b(?:cause|causes|caused|causing|affect|affects|affected|affecting|lead|leads|led|leading|result|results|resulted|resulting|trigger|triggers|triggered|triggering|produce|produces|produced|producing|create|creates|created|creating|make|makes|made|making|drive|drives|drove|driven|driving)\b/iu;

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
    const relationTerms = objectiveTerms.filter((term) => GENERIC_RELATION_TERMS.has(term));
    const anchor = specificTerms[0] ?? objectiveTerms[0];

    const candidates: string[] = [];
    if (anchor && concepts.length > 0) {
      candidates.push(boundedQuery([anchor, ...concepts]));
    }
    if (objectiveTerms.length > 0) {
      if (concepts.length > 0 && specificTerms.length <= 1 && relationTerms.length > 0) {
        candidates.push(boundedQuery([...concepts, ...relationTerms]));
      } else {
        candidates.push(boundedQuery([...objectiveTerms, ...contextTerms]));
      }
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

function relevanceSegments(input: KnowledgeRelevanceQualificationInput): string[] {
  const values = [
    input.source.title,
    input.claim.text,
    input.source.content.slice(0, MAX_RELEVANCE_TEXT_CHARS),
  ];
  return unique(values.flatMap((value) =>
    value.match(/[^.!?\n]+(?:[.!?]+|$)/gu)?.map((segment) => segment.trim()).filter(Boolean) ?? []
  ));
}

function locallyAnswersCauseSeekingObjective(
  input: KnowledgeRelevanceQualificationInput,
  specificObjectiveTerms: readonly string[],
): boolean {
  if (!CAUSE_SEEKING_OBJECTIVE_PATTERN.test(input.objective)) return true;
  const minimumSpecificMatches = Math.min(2, specificObjectiveTerms.length);
  if (minimumSpecificMatches === 0) return false;

  return relevanceSegments(input).some((segment) => {
    if (!LOCAL_CAUSAL_RELATION_PATTERN.test(segment)) return false;
    const segmentTokens = unique(normalizedTokens(segment));
    if (matchingTerms(specificObjectiveTerms, segmentTokens).length < minimumSpecificMatches) return false;

    const explanationFollows = EXPLANATION_FOLLOWS_PATTERN.exec(segment);
    if (explanationFollows?.index !== undefined) {
      const explainedSide = segment.slice(0, explanationFollows.index);
      const explainedTokens = unique(normalizedTokens(explainedSide));
      return matchingTerms(specificObjectiveTerms, explainedTokens).length >= 1;
    }

    if (SUPPORTED_MECHANISM_PATTERN.test(segment)) return true;

    const effectFollows = EFFECT_FOLLOWS_PATTERN.exec(segment);
    if (effectFollows?.index === undefined) return false;
    const effectSide = segment.slice(effectFollows.index + effectFollows[0].length);
    const effectTokens = unique(normalizedTokens(effectSide));
    return matchingTerms(specificObjectiveTerms, effectTokens).length >= 1;
  });
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
    const specificObjectiveTerms = objectiveTerms.filter((term) => !GENERIC_RELATION_TERMS.has(term));
    const anchorTerms = specificObjectiveTerms.slice(0, 3);
    const candidateText = [
      input.source.title,
      input.claim.text,
      input.source.content.slice(0, MAX_RELEVANCE_TEXT_CHARS),
    ].join("\n");
    const candidateTokens = unique(normalizedTokens(candidateText));

    const objectiveMatches = matchingTerms(objectiveTerms, candidateTokens);
    const queryMatches = matchingTerms(queryTerms, candidateTokens);
    const specificObjectiveMatches = matchingTerms(specificObjectiveTerms, candidateTokens);
    const anchorMatches = matchingTerms(anchorTerms, candidateTokens);
    const singleSpecificObjective = specificObjectiveTerms.length <= 1;

    const existingRelevance = objectiveTerms.length <= 1
      ? objectiveMatches.length >= 1
      : singleSpecificObjective
        ? anchorMatches.length >= 1 && queryMatches.length >= 1
        : specificObjectiveMatches.length >= 2;
    const answerRelevant = existingRelevance
      && locallyAnswersCauseSeekingObjective(input, specificObjectiveTerms);

    return {
      relevant: answerRelevant,
      rationale: !existingRelevance
        ? "Retrieved material lacks enough objective-specific overlap to enter visible Knowledge."
        : answerRelevant
          ? CAUSE_SEEKING_OBJECTIVE_PATTERN.test(input.objective)
            ? "Retrieved material locally links causal/mechanistic relation evidence with enough objective-specific terms and addresses the requested explanatory relationship."
            : "Retrieved material overlaps the objective-specific or derived investigation concepts."
          : "Topic/concept overlap is insufficient because the causal relation is not locally addressed in the required direction for the requested explanatory relationship.",
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
