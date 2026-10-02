/**
 * DP-015 Action effect-rule boundary types.
 *
 * The single lawful architecture for future consequence/reversibility
 * qualification: an approved deterministic ActionEffectRule maps one exact
 * governed action class plus structured governed facts to established
 * effect dimensions. Types only; no logic, no inference, no persistence,
 * no model call, no F8 emission.
 *
 * Binding constraints:
 * - Rules receive structured governed facts ONLY. Candidate/recommendation
 *   prose, materialUnknowns semantics, modelRiskLabel, confidence, and
 *   safe-labels are never inputs (the input type exposes neither prose nor
 *   Decision/Intent objects).
 * - Consequence and reversibility are independent; rules emit no explicit
 *   UNKNOWN (absence downstream yields UNKNOWN).
 * - Rules never inspect prose, model output, keywords, or similarity; the
 *   registry matches exact class tokens only.
 */

import type { QualifiedActionClass, StructuredActionFact } from "../types.js";

/** Established consequence values a rule may emit. UNKNOWN is never emitted. */
export type KnownConsequence = "LOW" | "MATERIAL" | "HIGH";

/** Established reversibility values a rule may emit. UNKNOWN is never emitted. */
export type KnownReversibility = "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";

/**
 * Structured-only effect-qualification input. The governed class token plus
 * structured governed facts (premises only); deliberately no prose, no
 * model labels, no Decision/Intent objects.
 */
export interface ActionEffectQualificationInput {
  readonly actionClass: QualifiedActionClass;
  readonly facts: readonly StructuredActionFact[];
}

/**
 * An approved rule's effect verdict. Each dimension is independent and
 * optional; an omitted dimension stays UNKNOWN downstream by absence.
 * Explicit UNKNOWN is not a member and must never be emitted.
 */
export interface ActionEffectQualification {
  readonly consequence?: KnownConsequence;
  readonly reversibility?: KnownReversibility;
}

/**
 * One approved deterministic ActionEffectRule. Reads an exact governed
 * class plus structured governed facts and returns zero or more
 * established effect dimensions. Never selects a mode.
 */
export interface ActionEffectRule {
  /** Stable versioned rule identity (e.g. "<CLASS>_V1"). */
  readonly ruleId: string;
  /** The single exact governed class this rule owns. */
  readonly actionClass: QualifiedActionClass;
  evaluate(input: ActionEffectQualificationInput): ActionEffectQualification;
}
