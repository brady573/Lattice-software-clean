import { createHash } from "node:crypto";
import type { RunStatus } from "../domain.js";
import { assertTruthBundleIntegrity } from "./invariants.js";
import type { TruthBundle } from "./types.js";

export type TruthSnapshotPhase = "INVESTIGATED" | "VALIDATED";

export interface TruthSnapshot {
  runId: string;
  phase: TruthSnapshotPhase;
  executionContractId: string;
  bundleHash: string;
  bundle: TruthBundle;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function stableStructuredJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function byId<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Hash the semantic structured truth state independently of persistence row order.
 * Ordering inside material nested values (for example claim qualifiers) remains
 * preserved; only top-level entity collections are canonicalized by identity.
 */
export function truthBundleHash(bundle: TruthBundle): string {
  assertTruthBundleIntegrity(bundle);
  const canonical = {
    runId: bundle.runId,
    provenanceComponents: [...bundle.provenanceComponents].sort((left, right) => left.key.localeCompare(right.key)),
    researchQuestions: byId(bundle.researchQuestions),
    sources: byId(bundle.sources),
    sourceEdges: byId(bundle.sourceEdges),
    claims: byId(bundle.claims),
    claimEvidence: byId(bundle.claimEvidence),
    obligations: byId(bundle.obligations),
    checks: byId(bundle.checks),
    assessments: byId(bundle.assessments),
  };
  return createHash("sha256").update(stableStructuredJson(canonical)).digest("hex");
}

export function createTruthSnapshot(
  phase: TruthSnapshotPhase,
  executionContractId: string,
  bundle: TruthBundle,
): TruthSnapshot {
  if (executionContractId.trim().length === 0) {
    throw new Error("Truth snapshot execution contract must not be blank.");
  }
  const copy = structuredClone(bundle);
  assertTruthBundleIntegrity(copy);
  return {
    runId: copy.runId,
    phase,
    executionContractId,
    bundleHash: truthBundleHash(copy),
    bundle: copy,
  };
}

export function assertTruthSnapshotIntegrity(snapshot: TruthSnapshot): void {
  if (snapshot.runId !== snapshot.bundle.runId) {
    throw new Error("Truth snapshot Run scope does not match its V36 bundle.");
  }
  if (snapshot.executionContractId.trim().length === 0) {
    throw new Error("Truth snapshot execution contract must not be blank.");
  }
  if (!/^[a-f0-9]{64}$/u.test(snapshot.bundleHash)) {
    throw new Error("Truth snapshot bundle hash is malformed.");
  }
  assertTruthBundleIntegrity(snapshot.bundle);
  const actual = truthBundleHash(snapshot.bundle);
  if (actual !== snapshot.bundleHash) {
    throw new Error("Truth snapshot bundle hash does not match its structured V36 state.");
  }
}

/**
 * V36 owns the semantic checkpoint contract. Stores only execute this contract
 * transactionally; they do not infer which truth state is epistemically valid.
 */
export function assertTruthSnapshotTransition(
  expectedStatus: RunStatus,
  nextStatus: RunStatus,
  snapshot: TruthSnapshot,
): void {
  assertTruthSnapshotIntegrity(snapshot);
  const permitted = snapshot.phase === "INVESTIGATED"
    ? expectedStatus === "INVESTIGATING" && nextStatus === "VALIDATING"
    : expectedStatus === "VALIDATING" && (nextStatus === "DECIDING" || nextStatus === "COMPLETED");
  if (!permitted) {
    throw new Error(
      `V36 ${snapshot.phase} truth snapshot cannot be committed on ${expectedStatus} -> ${nextStatus}.`,
    );
  }
}
