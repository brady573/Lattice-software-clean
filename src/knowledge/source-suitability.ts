import type { RetrievedKnowledgeSource } from "./acquisition.js";

/** Product-facing source suitability. This is distinct from V36 truth authority. */
export type EvidentiarySuitability = "AUTHORITATIVE_DOMAIN" | "GENERAL_REFERENCE" | "UNKNOWN";

/**
 * Product-owned authority for source suitability. Acquisition output is never
 * allowed to confer this classification on itself.
 */
export interface KnowledgeSourceSuitabilityAuthority {
  readonly kind: string;
  suitabilityFor(source: RetrievedKnowledgeSource): EvidentiarySuitability;
}

/** Default for injected/arbitrary acquisition providers: no suitability grant. */
export class UnknownKnowledgeSourceSuitabilityAuthority implements KnowledgeSourceSuitabilityAuthority {
  readonly kind = "unknown-source-suitability-v1";

  suitabilityFor(_source: RetrievedKnowledgeSource): EvidentiarySuitability {
    return "UNKNOWN";
  }
}
