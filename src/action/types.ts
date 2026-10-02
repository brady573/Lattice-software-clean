/**
 * F4 Action Engine types (DP-010/DP-011/DP-012).
 *
 * The Action Engine is a pure, deterministic, orchestrator-invoked module that
 * turns calibrated understanding into a justified next move (WAIT /
 * INVESTIGATE / TEST / ACT / ESCALATE). Models PROPOSE/EXPLAIN; only this
 * module's rules select the mode.
 *
 * Design constraints (binding):
 * - Ephemeral and turn-scoped. No persistence, no migration, no store change.
 * - No model call. No F8 emission.
 * - The qualifier classifies ONLY from structured governed facts; it never
 *   parses prose. Model-authored risk labels are never qualification evidence.
 * - F4 reads only a bounded Action-facing projection (candidate +
 *   actionCalibration + qualified governed facts), never F6 internals or a
 *   context bag.
 *
 * This file carries types only. No logic.
 */

/** Categorical consequence of the proposed action. */
export type ConsequenceLevel = "LOW" | "MATERIAL" | "HIGH" | "UNKNOWN";

/** Categorical reversibility of the proposed action. */
export type ReversibilityStatus =
  | "REVERSIBLE"
  | "PARTIALLY_REVERSIBLE"
  | "IRREVERSIBLE"
  | "UNKNOWN";

/** The justified next move selected by the Action Engine. */
export type ActionMode = "WAIT" | "INVESTIGATE" | "TEST" | "ACT" | "ESCALATE";

/** Categorical evidential support for the proposed action. */
export type ActionSupport = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT" | "UNKNOWN";

/**
 * Allowlisted structured governed-fact sources. Anything outside this union
 * is dropped by the projection boundary and can never qualify, support, or
 * veto.
 */
export type GovernedFactSource =
  | "CANDIDATE_PROPOSAL"
  | "F6_CALIBRATED_SIGNAL"
  | "INTENT_AUTHORITY"
  | "KNOWLEDGE_V36"
  | "DECISION_ENGINE_RESULT"
  | "CAPABILITY_EFFECT"
  | "ACTION_SUPPORT_RULE"
  | "ACTION_EFFECT_RULE";

/**
 * Governed Action classes with an approved deterministic rule (shared F4
 * authority; DP-014 support path today, DP-015 effect path tomorrow).
 * V1 carries exactly one member. Future classes require a new approved rule
 * and registry entry; unknown strings never qualify.
 */
export type QualifiedActionClass = "DECISION_EVIDENCE_INVESTIGATION";

/** Fixed tokens for qualification gaps that block justified action. */
export type BlockingUnknown =
  | "CONSEQUENCE_UNKNOWN"
  | "REVERSIBILITY_UNKNOWN"
  | "SUPPORT_UNKNOWN"
  | "MATERIAL_BLOCKER_UNRESOLVED"
  | "SAFEGUARD_OR_AUTHORITY_MISSING";

/**
 * One structured governed fact. Dimensions and flags are established by
 * governed owners only; prose and model-authored labels never populate them.
 */
export interface StructuredActionFact {
  readonly source: GovernedFactSource;
  readonly consequence?: ConsequenceLevel;
  readonly reversibility?: ReversibilityStatus;
  readonly support?: ActionSupport;
  readonly materialBlocker?: true;
  readonly safeguardOrAuthorityEstablished?: true;
  readonly diagnosticStepAvailable?: true;
  readonly infoStepAvailable?: true;
  readonly oversightRequired?: true;
}

/**
 * A proposed action with the structured facts necessary for qualification.
 * `modelRiskLabel` rides along but is NEVER qualification evidence.
 * `actionClass` carries an already-governed class token (assigned ONLY from
 * structured governed state, never prose) so effect qualification can select
 * the approved rule; generic candidates carry none.
 */
export interface ActionCandidate {
  readonly action: string;
  readonly facts: readonly StructuredActionFact[];
  readonly factRefs: readonly string[];
  readonly modelRiskLabel?: string;
  readonly actionClass?: QualifiedActionClass;
}

/** Bounded Action-facing projection of F6 calibrated state. */
export interface ActionCalibration {
  readonly cleared: boolean;
  readonly resolution: "CLEAR" | "WEAKEN" | "WEAKEN_AND_ASK";
  readonly adjustedConfidence: number;
  readonly materialAffectsAction: boolean;
  readonly hasUnknownMaterial: boolean;
}

/**
 * Narrow structural source for the calibration projection. Mirrors the
 * screening shape (`cleared`, `resolution`, `guard.adjustedConfidence`,
 * `guard.material[]` with `support`/`affectsAction`) without importing the
 * F6 implementation type and without accepting a context bag.
 */
export interface ActionCalibrationSource {
  readonly cleared: boolean;
  readonly resolution: "CLEAR" | "WEAKEN" | "WEAKEN_AND_ASK";
  readonly guard: {
    readonly adjustedConfidence: number;
    readonly material: readonly {
      readonly support: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
      readonly affectsAction: boolean;
    }[];
  };
}

/** Input to structured-facts-only classification. */
export interface QualifyActionInput {
  readonly candidate: ActionCandidate;
  readonly qualifiedFacts: readonly StructuredActionFact[];
  /**
   * The sole classifying channel for ACTION_EFFECT_RULE facts. Populated
   * ONLY from `qualifyActionEffects()` output inside the Action boundary;
   * ACTION_EFFECT_RULE facts arriving through `candidate.facts` or
   * `qualifiedFacts` are ignored for consequence/reversibility.
   */
  readonly effectFacts?: readonly StructuredActionFact[];
}

/** Categorical qualification of a candidate from structured facts. */
export interface ActionQualification {
  readonly consequence: ConsequenceLevel;
  readonly reversibility: ReversibilityStatus;
  readonly support: ActionSupport;
  readonly materialBlockerPresent: boolean;
  readonly safeguardOrAuthorityEstablished: boolean;
  readonly blockingUnknowns: readonly BlockingUnknown[];
}

/** Input to deterministic mode selection over qualified states. */
export interface ModeSelectionInput {
  readonly qualification: ActionQualification;
  readonly calibration: ActionCalibration;
  readonly infoStepAvailable: boolean;
  readonly diagnosticStepAvailable: boolean;
  readonly oversightRequired: boolean;
}

/** Selected mode with a fixed categorical reason template. */
export interface ModeSelection {
  readonly mode: ActionMode;
  readonly reason: string;
}

/** Input to end-to-end composition (qualify → select → assemble). */
export interface ActionEngineInput {
  readonly candidate: ActionCandidate;
  readonly calibration: ActionCalibration;
  readonly qualifiedFacts: readonly StructuredActionFact[];
}

/** The justified next move with user-facing categorical strings. */
export interface ActionDecision {
  readonly mode: ActionMode;
  readonly action: string;
  readonly reason: string;
  readonly expectedOutcome: string;
  readonly risk: string;
  readonly reversibility: ReversibilityStatus;
  readonly verification: string;
  readonly blockingUnknowns: readonly BlockingUnknown[];
}
