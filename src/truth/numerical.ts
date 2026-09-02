export interface QuantitativeValue {
  value: number;
  unit: string;
  denominator: string | null;
  baseline: string | null;
  period: string | null;
}

export function recomputeRatio(numerator: number, denominator: number, scale = 1): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error("A finite non-zero denominator is required for recomputation.");
  }
  return (numerator / denominator) * scale;
}

export function percentagePointChange(beforePercent: number, afterPercent: number): number {
  return afterPercent - beforePercent;
}

export function relativePercentChange(before: number, after: number): number {
  if (before === 0) throw new Error("Relative percent change is undefined from a zero baseline.");
  return ((after - before) / Math.abs(before)) * 100;
}

export function quantitativeCompatibility(
  claim: QuantitativeValue,
  evidence: QuantitativeValue,
): { compatible: boolean; failures: string[] } {
  const failures: string[] = [];
  if (claim.unit !== evidence.unit) failures.push("UNIT");
  if (claim.denominator !== evidence.denominator) failures.push("DENOMINATOR");
  if (claim.baseline !== evidence.baseline) failures.push("BASELINE");
  if (claim.period !== evidence.period) failures.push("TIME_PERIOD");
  return { compatible: failures.length === 0, failures };
}
