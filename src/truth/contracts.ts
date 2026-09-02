import proofContractArtifact from "../../docs/specifications/V36-Truth-Layer/claim-proof-contracts.json" with { type: "json" };
import type { ClaimType } from "./types.js";

const claimTypes: readonly ClaimType[] = [
  "FACTUAL",
  "CAUSAL",
  "QUANTITATIVE",
  "CURRENT_STATE",
  "INTERPRETIVE",
  "AUTHENTICITY",
  "OPINION",
];

function loadProofContracts(): Readonly<Record<ClaimType, readonly string[]>> {
  const source = proofContractArtifact as Partial<Record<ClaimType, unknown>> & Record<string, unknown>;
  const keys = Object.keys(source).sort();
  const expectedKeys = [...claimTypes].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("Canonical V36 proof-contract artifact has unexpected claim-type keys.");
  }

  const entries = claimTypes.map((claimType) => {
    const value = source[claimType];
    if (!Array.isArray(value) || value.some((kind) => typeof kind !== "string" || kind.trim().length === 0)) {
      throw new Error(`Canonical V36 proof contract for ${claimType} is invalid.`);
    }
    return [claimType, Object.freeze([...value])] as const;
  });
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<ClaimType, readonly string[]>>;
}

/** Exact V36 proof obligations loaded from the controlling machine-readable contract artifact. */
export const proofContracts = loadProofContracts();

export function requiredProofObligations(claimType: ClaimType): readonly string[] {
  return proofContracts[claimType];
}

export function requiresIndependentPositiveChain(claimType: ClaimType): boolean {
  return claimType === "CAUSAL" || claimType === "AUTHENTICITY";
}
