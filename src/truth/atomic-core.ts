import type { AtomicDisposition, ClaimEvidence } from "./types.js";

/**
 * Frozen-style atomic adjudication invariant: only admitted structured evidence owns the
 * support/refute/insufficient/conflict disposition. Generated prose and model confidence are absent.
 */
export function adjudicateAtomicEvidence(evidence: ClaimEvidence[]): AtomicDisposition {
  const admitted = evidence.filter(
    (item) => item.admitted && item.verification === "VERIFIED",
  );
  const supported = admitted.some((item) => item.relation === "SUPPORTS");
  const refuted = admitted.some((item) => item.relation === "CONTRADICTS");

  if (supported && refuted) return "CONFLICT";
  if (supported) return "SUPPORTED";
  if (refuted) return "REFUTED";
  return "INSUFFICIENT";
}
