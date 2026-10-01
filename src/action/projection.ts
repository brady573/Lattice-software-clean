/**
 * F4 projection boundary (DP-011/DP-012).
 *
 * The ONLY F6-touching surface. Reads a narrow structural projection of the
 * calibrated state — never the F6 implementation type, never a context bag —
 * and filters governed facts through the fixed 6-member source allowlist.
 * Pure, deterministic, dependency-free. No model call, no persistence.
 */

import { evaluate } from "./evaluate.js";
import type {
  ActionCalibration,
  ActionCalibrationSource,
  ActionCandidate,
  ActionDecision,
  GovernedFactSource,
  StructuredActionFact,
} from "./types.js";

/** The fixed 7-member source allowlist. Anything else is dropped. */
const PERMITTED_SOURCES: ReadonlySet<string> = new Set<string>([
  "CANDIDATE_PROPOSAL",
  "F6_CALIBRATED_SIGNAL",
  "INTENT_AUTHORITY",
  "KNOWLEDGE_V36",
  "DECISION_ENGINE_RESULT",
  "CAPABILITY_EFFECT",
  "ACTION_SUPPORT_RULE",
]);

function requireAdjustedConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Action calibration adjustedConfidence must be a finite number in [0, 1].");
  }
  return value;
}

/**
 * Structural projection of F6 calibrated state. `materialAffectsAction` is
 * true when any material item affects action; `hasUnknownMaterial` is true
 * when any material item has support UNKNOWN/UNSUPPORTED.
 */
export function projectActionCalibration(source: ActionCalibrationSource): ActionCalibration {
  const adjustedConfidence = requireAdjustedConfidence(source.guard.adjustedConfidence);
  let materialAffectsAction = false;
  let hasUnknownMaterial = false;
  for (const item of source.guard.material) {
    if (item.affectsAction) materialAffectsAction = true;
    if (item.support === "UNKNOWN" || item.support === "UNSUPPORTED") {
      hasUnknownMaterial = true;
    }
    if (materialAffectsAction && hasUnknownMaterial) break;
  }
  return Object.freeze({
    cleared: source.cleared,
    resolution: source.resolution,
    adjustedConfidence,
    materialAffectsAction,
    hasUnknownMaterial,
  });
}

/** True when the fact carries at least one dimension or flag. */
function hasSignal(fact: StructuredActionFact): boolean {
  return fact.consequence !== undefined
    || fact.reversibility !== undefined
    || fact.support !== undefined
    || fact.materialBlocker === true
    || fact.safeguardOrAuthorityEstablished === true
    || fact.diagnosticStepAvailable === true
    || fact.infoStepAvailable === true
    || fact.oversightRequired === true;
}

function factKey(fact: StructuredActionFact): string {
  return [
    fact.source,
    fact.consequence ?? "",
    fact.reversibility ?? "",
    fact.support ?? "",
    fact.materialBlocker === true ? "materialBlocker" : "",
    fact.safeguardOrAuthorityEstablished === true ? "safeguard" : "",
    fact.diagnosticStepAvailable === true ? "diagnostic" : "",
    fact.infoStepAvailable === true ? "info" : "",
    fact.oversightRequired === true ? "oversight" : "",
  ].join("|");
}

/**
 * Allowlist filter + dedupe + the single F6 signal fact. Drops any fact
 * whose source is outside the `GovernedFactSource` union, drops facts with
 * no dimension/flag set, dedupes identical facts, and emits one
 * `{ source: "F6_CALIBRATED_SIGNAL", materialBlocker: true }` fact IFF the
 * calibration resolution is WEAKEN_AND_ASK and material affects action.
 */
export function collectPermittedActionFacts(input: {
  readonly calibration: ActionCalibration;
  readonly governedFacts: readonly StructuredActionFact[];
}): readonly StructuredActionFact[] {
  const seen = new Set<string>();
  const result: StructuredActionFact[] = [];
  for (const fact of input.governedFacts) {
    if (fact === null || typeof fact !== "object") continue;
    const source: unknown = (fact as { source?: unknown }).source;
    if (typeof source !== "string" || !PERMITTED_SOURCES.has(source)) continue;
    const typed: StructuredActionFact = {
      source: source as GovernedFactSource,
      ...(fact.consequence !== undefined ? { consequence: fact.consequence } : {}),
      ...(fact.reversibility !== undefined ? { reversibility: fact.reversibility } : {}),
      ...(fact.support !== undefined ? { support: fact.support } : {}),
      ...(fact.materialBlocker === true ? { materialBlocker: true as const } : {}),
      ...(fact.safeguardOrAuthorityEstablished === true
        ? { safeguardOrAuthorityEstablished: true as const }
        : {}),
      ...(fact.diagnosticStepAvailable === true ? { diagnosticStepAvailable: true as const } : {}),
      ...(fact.infoStepAvailable === true ? { infoStepAvailable: true as const } : {}),
      ...(fact.oversightRequired === true ? { oversightRequired: true as const } : {}),
    };
    if (!hasSignal(typed)) continue;
    const key = factKey(typed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze(typed));
  }
  if (
    input.calibration.resolution === "WEAKEN_AND_ASK"
    && input.calibration.materialAffectsAction
  ) {
    const signal: StructuredActionFact = Object.freeze({
      source: "F6_CALIBRATED_SIGNAL" as const,
      materialBlocker: true as const,
    });
    const key = factKey(signal);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(signal);
    }
  }
  return Object.freeze([...result]) as readonly StructuredActionFact[];
}

/**
 * The single shared finalization pipeline both orchestration sites call, so
 * semantics cannot drift by path (DP-012 §2/§5).
 *
 * `projectActionCalibration(screening)` → `collectPermittedActionFacts(...)`
 * → candidate-gated `evaluate(...)`. `candidate === undefined` (no structured
 * candidate; pure Knowledge turns ordinarily bypass) yields
 * `decision: undefined` — never WAIT. Runs after F6 even on WEAKEN_AND_ASK
 * paths that reach finalization; the F6 signal fact preserves the
 * clarification without suppressing or reinterpreting it. Pure,
 * deterministic, dependency-free beyond the sibling `evaluate` composition.
 */
export function decideActionForFinalization(input: {
  readonly screening: ActionCalibrationSource;
  readonly candidate: ActionCandidate | undefined;
  readonly governedFacts: readonly StructuredActionFact[];
}): {
  readonly calibration: ActionCalibration;
  readonly qualifiedFacts: readonly StructuredActionFact[];
  readonly decision: ActionDecision | undefined;
} {
  const calibration = projectActionCalibration(input.screening);
  const qualifiedFacts = collectPermittedActionFacts({
    calibration,
    governedFacts: input.governedFacts,
  });
  if (input.candidate === undefined) {
    return Object.freeze({ calibration, qualifiedFacts, decision: undefined });
  }
  const decision = evaluate({
    candidate: input.candidate,
    calibration,
    qualifiedFacts,
  });
  return Object.freeze({ calibration, qualifiedFacts, decision });
}
