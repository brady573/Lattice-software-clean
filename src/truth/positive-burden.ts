import { requiresIndependentPositiveChain } from "./contracts.js";
import { independentSupportComponents } from "./provenance.js";
import type { ClaimEvidence, CompiledClaim } from "./types.js";

export interface PositiveBurdenResult {
  satisfied: boolean;
  requiredIndependentChains: number;
  independentChains: number;
  authoritativePrimaryShortcut: boolean;
  reason: string;
}

export function evaluatePositiveBurden(
  claim: CompiledClaim,
  evidence: ClaimEvidence[],
): PositiveBurdenResult {
  const supports = evidence.filter(
    (item) => item.admitted && item.verification === "VERIFIED" && item.relation === "SUPPORTS",
  );
  const components = independentSupportComponents(supports);
  const mandatoryDualChain = requiresIndependentPositiveChain(claim.claimType) || claim.evidenceRisk === "HIGH";

  if (supports.length === 0) {
    return {
      satisfied: false,
      requiredIndependentChains: mandatoryDualChain ? 2 : 1,
      independentChains: components.size,
      authoritativePrimaryShortcut: false,
      reason: "No verified admitted support exists for the positive claim.",
    };
  }

  if (!mandatoryDualChain) {
    const authoritativePrimary = supports.some(
      (item) =>
        item.authoritativePrimary
        && item.provenanceConfidence === "HIGH"
        && item.provenanceComponentKey !== null,
    );
    if (authoritativePrimary) {
      return {
        satisfied: true,
        requiredIndependentChains: 1,
        independentChains: components.size,
        authoritativePrimaryShortcut: true,
        reason: "A strong authoritative primary source satisfies the ordinary positive burden.",
      };
    }
  }

  const required = 2;
  return {
    satisfied: components.size >= required,
    requiredIndependentChains: required,
    independentChains: components.size,
    authoritativePrimaryShortcut: false,
    reason: components.size >= required
      ? "Independent corroborating provenance chains satisfy the positive burden."
      : "The positive burden requires a materially independent corroborating provenance chain.",
  };
}
