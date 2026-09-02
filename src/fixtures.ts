import { requiredProofObligations } from "./truth/contracts.js";
import type { FixtureDataset } from "./truth/fixture-dataset.js";
import type {
  ProofCheckStatus,
  TruthClaimProfile,
  TruthEvidenceProfile,
} from "./truth/types.js";

export type { FixtureDataset, FixtureSourceEdge } from "./truth/fixture-dataset.js";

function passedChecks(claimType: TruthClaimProfile["claimType"]): Readonly<Record<string, ProofCheckStatus>> {
  return Object.fromEntries(
    requiredProofObligations(claimType).map((kind) => [kind, "PASSED"] as const),
  );
}

function quantitativeClaim(
  candidateId: string,
  criterion: string,
  evidenceId: string,
): TruthClaimProfile {
  return {
    id: `claim-${candidateId}-${criterion}`,
    text: `${candidateId}.${criterion} is the recorded fixture value`,
    claimType: "QUANTITATIVE",
    candidateId,
    criterion,
    evidenceIds: [evidenceId],
    scope: candidateId,
    unit: criterion,
    denominator: "candidate",
    baseline: "fixture-v36",
    period: "prototype-static",
    evidenceRisk: "ORDINARY",
    checks: passedChecks("QUANTITATIVE"),
    materiallyMisleading: false,
  };
}

function primaryEvidence(
  evidenceId: string,
  claimId: string,
  provenanceComponentKey: string,
): TruthEvidenceProfile {
  return {
    evidenceId,
    claimId,
    provenanceComponentKey,
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  };
}

export const defaultDecisionFixture: FixtureDataset = {
  candidates: [
    { id: "atlas-pro", label: "Atlas Pro" },
    { id: "nova-air", label: "Nova Air" },
    { id: "forge-15", label: "Forge 15" },
  ],
  evidence: [
    { id: "e-atlas-price", candidateId: "atlas-pro", criterion: "price", value: 1450, sourceId: "fixture-catalog", sourceLabel: "Deterministic catalog fixture", admitted: true },
    { id: "e-atlas-battery", candidateId: "atlas-pro", criterion: "batteryHours", value: 14, sourceId: "fixture-bench", sourceLabel: "Deterministic benchmark fixture", admitted: true },
    { id: "e-atlas-performance", candidateId: "atlas-pro", criterion: "performance", value: 98, sourceId: "fixture-bench", sourceLabel: "Deterministic benchmark fixture", admitted: true },
    { id: "e-nova-price", candidateId: "nova-air", criterion: "price", value: 1150, sourceId: "fixture-catalog", sourceLabel: "Deterministic catalog fixture", admitted: true },
    { id: "e-nova-battery", candidateId: "nova-air", criterion: "batteryHours", value: 18, sourceId: "fixture-bench", sourceLabel: "Deterministic benchmark fixture", admitted: true },
    { id: "e-nova-performance", candidateId: "nova-air", criterion: "performance", value: 84, sourceId: "fixture-bench", sourceLabel: "Deterministic benchmark fixture", admitted: true },
    { id: "e-forge-price", candidateId: "forge-15", criterion: "price", value: 1250, sourceId: "fixture-catalog", sourceLabel: "Deterministic catalog fixture", admitted: true },
    { id: "e-forge-battery", candidateId: "forge-15", criterion: "batteryHours", value: 10, sourceId: "fixture-bench", sourceLabel: "Deterministic benchmark fixture", admitted: true },
    { id: "e-forge-performance", candidateId: "forge-15", criterion: "performance", value: 92, sourceId: "fixture-bench", sourceLabel: "Deterministic benchmark fixture", admitted: true },
  ],
  truthClaims: [
    quantitativeClaim("atlas-pro", "price", "e-atlas-price"),
    quantitativeClaim("atlas-pro", "batteryHours", "e-atlas-battery"),
    quantitativeClaim("atlas-pro", "performance", "e-atlas-performance"),
    quantitativeClaim("nova-air", "price", "e-nova-price"),
    quantitativeClaim("nova-air", "batteryHours", "e-nova-battery"),
    quantitativeClaim("nova-air", "performance", "e-nova-performance"),
    quantitativeClaim("forge-15", "price", "e-forge-price"),
    quantitativeClaim("forge-15", "batteryHours", "e-forge-battery"),
    quantitativeClaim("forge-15", "performance", "e-forge-performance"),
  ],
  truthEvidence: [
    primaryEvidence("e-atlas-price", "claim-atlas-pro-price", "fixture-catalog"),
    primaryEvidence("e-atlas-battery", "claim-atlas-pro-batteryHours", "fixture-bench"),
    primaryEvidence("e-atlas-performance", "claim-atlas-pro-performance", "fixture-bench"),
    primaryEvidence("e-nova-price", "claim-nova-air-price", "fixture-catalog"),
    primaryEvidence("e-nova-battery", "claim-nova-air-batteryHours", "fixture-bench"),
    primaryEvidence("e-nova-performance", "claim-nova-air-performance", "fixture-bench"),
    primaryEvidence("e-forge-price", "claim-forge-15-price", "fixture-catalog"),
    primaryEvidence("e-forge-battery", "claim-forge-15-batteryHours", "fixture-bench"),
    primaryEvidence("e-forge-performance", "claim-forge-15-performance", "fixture-bench"),
  ],
};

/**
 * Backward-compatible fixture alias for historical tests and validation assets.
 * Canonical Product runtime composition does not import this scenario fixture.
 */
export const laptopFixture: FixtureDataset = structuredClone(defaultDecisionFixture);
