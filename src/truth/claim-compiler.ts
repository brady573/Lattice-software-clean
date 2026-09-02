import { requiredProofObligations } from "./contracts.js";
import { stableTruthUuid } from "./ids.js";
import type {
  ClaimQualifier,
  ClaimType,
  CompiledClaim,
  EvidenceRisk,
} from "./types.js";

export interface ClaimCompilationInput {
  runId: string;
  sourceClaimId: string;
  text: string;
  claimType: ClaimType;
  scope?: string | null;
  effectiveAt?: string | null;
  jurisdiction?: string | null;
  unit?: string | null;
  denominator?: string | null;
  baseline?: string | null;
  period?: string | null;
  causalRelation?: string | null;
  authenticityTarget?: string | null;
  comparisonClass?: string | null;
  quotedContext?: string | null;
  qualifiers?: readonly ClaimQualifier[];
  evidenceRisk?: EvidenceRisk;
}

export interface CompiledClaimContract {
  claim: CompiledClaim;
  requiredProofKinds: readonly string[];
}

function requireNonBlank(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`${field} must not be blank.`);
  return value;
}

function copyQualifiers(qualifiers: readonly ClaimQualifier[]): ClaimQualifier[] {
  return qualifiers.map((qualifier, index) => ({
    key: requireNonBlank(qualifier.key, `qualifiers[${index}].key`),
    value: requireNonBlank(qualifier.value, `qualifiers[${index}].value`),
  }));
}

/**
 * Compile a material assertion into explicit structured truth state and bind
 * the deterministic proof contract before any evidence can be adjudicated.
 *
 * The compiler does not infer or discard qualifiers. Callers must provide
 * every material qualifier they have resolved; unknown values remain null or
 * absent rather than being manufactured from prose.
 */
export function compileClaim(input: ClaimCompilationInput): CompiledClaimContract {
  const runId = requireNonBlank(input.runId, "runId");
  const sourceClaimId = requireNonBlank(input.sourceClaimId, "sourceClaimId");
  const text = requireNonBlank(input.text, "text");
  const qualifiers = copyQualifiers(input.qualifiers ?? []);

  const claim: CompiledClaim = {
    id: stableTruthUuid(`${runId}:claim:${sourceClaimId}`),
    runId,
    text,
    claimType: input.claimType,
    scope: input.scope ?? null,
    effectiveAt: input.effectiveAt ?? null,
    jurisdiction: input.jurisdiction ?? null,
    unit: input.unit ?? null,
    denominator: input.denominator ?? null,
    baseline: input.baseline ?? null,
    period: input.period ?? null,
    causalRelation: input.causalRelation ?? null,
    authenticityTarget: input.authenticityTarget ?? null,
    comparisonClass: input.comparisonClass ?? null,
    quotedContext: input.quotedContext ?? null,
    qualifiers,
    evidenceRisk: input.evidenceRisk ?? "ORDINARY",
  };

  return {
    claim,
    requiredProofKinds: Object.freeze([...requiredProofObligations(input.claimType)]),
  };
}
