import { isDeepStrictEqual } from "node:util";
import type { ClaimEvidence } from "./types.js";

function evidenceKey(item: Pick<ClaimEvidence, "claimId" | "externalEvidenceId">): string {
  return `${item.claimId}\u0000${item.externalEvidenceId}`;
}

function sameObservation(left: ClaimEvidence, right: ClaimEvidence): boolean {
  return left.runId === right.runId
    && left.claimId === right.claimId
    && left.artifactId === right.artifactId
    && left.externalEvidenceId === right.externalEvidenceId
    && left.relation === right.relation
    && left.specificEvidence === right.specificEvidence;
}

export interface ClaimEvidenceMergeOptions {
  /**
   * Later truth-layer verification rounds may update disposition/provenance for
   * the same underlying observation. Observation identity itself remains immutable.
   */
  allowDispositionUpdates?: boolean;
  /** External material evidence identities that research must not newly claim. */
  reservedExternalEvidenceIds?: ReadonlySet<string>;
}

/**
 * Canonical V36 ClaimEvidence merge policy.
 *
 * Exact duplicates are idempotent. A reused claim/evidence identity with changed
 * observation content fails closed. Truth-layer verification rounds may opt in
 * to disposition-only replacement; outer enrichment boundaries do not.
 */
export function mergeClaimEvidenceStrict(
  groups: readonly (readonly ClaimEvidence[])[],
  options: ClaimEvidenceMergeOptions = {},
): ClaimEvidence[] {
  const result = new Map<string, ClaimEvidence>();

  groups.forEach((group, groupIndex) => {
    for (const item of group) {
      const key = evidenceKey(item);
      const existing = result.get(key);
      if (!existing) {
        if (groupIndex > 0 && options.reservedExternalEvidenceIds?.has(item.externalEvidenceId)) {
          throw new Error(
            `Research evidence ${item.externalEvidenceId} collides with existing material decision evidence.`,
          );
        }
        result.set(key, structuredClone(item));
        continue;
      }

      if (isDeepStrictEqual(existing, item)) continue;
      if (options.allowDispositionUpdates && sameObservation(existing, item)) {
        result.set(key, structuredClone(item));
        continue;
      }
      throw new Error(
        `Research attempted to replace existing claim evidence ${item.externalEvidenceId}. `
        + `Conflicting V36 claim evidence identity ${item.externalEvidenceId} for claim ${item.claimId}.`,
      );
    }
  });

  return [...result.values()];
}
