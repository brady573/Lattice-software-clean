/**
 * Assumption Guard types (DP-002/DP-004).
 *
 * The Assumption Guard is a REQUIRED Confidence-stage gate that runs BEFORE any
 * Action Engine consumption. Before a material conclusion stands it asks:
 * "What must be true for this conclusion to hold?"
 *
 * Design constraints (binding):
 * - Ephemeral and turn-scoped. No persistence, no migration, no store change.
 * - Primarily invisible: no inventories, graphs, or internal terminology ever
 *   reach the user. The user experiences better behavior only (a weakened
 *   conclusion or a single natural clarifying question).
 * - Additive consumption only: the hook reads existing advisory shapes without
 *   changing governed paths, V36 admission, or cognition contracts.
 *
 * Resolution coverage: this module implements WEAKEN (weaken the conclusion and
 * surface the dependency as uncertainty) and ASK (surface it as a single
 * natural question). The remaining classical resolutions are documented in
 * guard.ts as follow-ups and deliberately NOT built here:
 * ADDITIONAL_EVIDENCE, OFFER_COMPETING_EXPLANATIONS, CHOOSE_SAFER_ACTION,
 * RESOLVED.
 */

/**
 * Support status of one candidate dependency.
 *
 * - SUPPORTED: established by USER authority (verbatim USER material) or by
 *   governed Knowledge. Supported dependencies never trigger resolution.
 * - UNSUPPORTED: known to lack support (e.g. contradicted or absent basis).
 * - UNKNOWN: surfaced by Solandra but established by neither USER authority
 *   nor governed Knowledge; only the user may be able to confirm it in-turn.
 */
export type AssumptionSupport = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";

/**
 * One "what must be true" candidate for a conclusion.
 *
 * Impact is declared, not inferred: confidenceIfTrue/confidenceIfFalse model
 * how expressed confidence moves with the dependency, and the flags record
 * whether its failure could change the conclusion or the next action.
 */
export interface AssumptionCandidate {
  readonly statement: string;
  readonly support: AssumptionSupport;
  /** Expressed confidence if the dependency holds (0-1). */
  readonly confidenceIfTrue: number;
  /** Expressed confidence if the dependency fails (0-1). */
  readonly confidenceIfFalse: number;
  /** Solandra itself flagged this item as qualifying this conclusion. */
  readonly bearsOnConfidence: boolean;
  /** Failure could change the conclusion itself. */
  readonly affectsConclusion: boolean;
  /** Failure could change the next recommended action. */
  readonly affectsAction: boolean;
}

export interface AssumptionGuardInput {
  readonly conclusion: string;
  /** Currently expressed confidence in the conclusion (0-1). Internal only. */
  readonly expressedConfidence: number;
  readonly candidates: readonly AssumptionCandidate[];
  readonly proposedAction?: string;
}

/** Implemented resolutions. Other classical resolutions are follow-ups. */
export type AssumptionGuardResolutionKind = "CLEAR" | "WEAKEN" | "WEAKEN_AND_ASK";

export interface AssumptionGuardOutput {
  /** True when no material unsupported dependency blocks the conclusion. */
  readonly cleared: boolean;
  readonly resolution: AssumptionGuardResolutionKind;
  /** Material dependencies: block clearing and receive resolution. */
  readonly material: readonly AssumptionCandidate[];
  /** Non-material dependencies: tracked internally, never user-visible. */
  readonly nonMaterial: readonly AssumptionCandidate[];
  /** Expressed confidence reduced by material dependencies. Internal only. */
  readonly adjustedConfidence: number;
  /** Material statements surfaced as uncertainty. Empty when cleared. */
  readonly surfacedUncertainties: readonly string[];
  /** Weakened conclusion. Present only when material dependencies exist. */
  readonly weakenedConclusion?: string;
  /** Single natural clarifying question. Present only for WEAKEN_AND_ASK. */
  readonly question?: string;
}
