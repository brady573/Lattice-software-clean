/**
 * Canonical comparison key for advisory/recommendation uncertainty fidelity.
 *
 * This is a comparison-only normalization. It does not mutate any stored or
 * output string; it is used only to produce equivalence keys for the
 * preservedUncertainties fidelity checks in two canonical boundaries:
 *
 * - src/solandra/advisory.ts :: validateAndProjectRecommendationBasis()
 * - src/recommendation/recommendation-continuity.ts :: assertPreservedGovernedUncertainty()
 *
 * For comparison keys only, it:
 * - trims outer whitespace;
 * - collapses internal Unicode whitespace runs to a single ordinary space;
 * - folds the dash family to ASCII U+002D HYPHEN-MINUS:
 *   U+2010 HYPHEN
 *   U+2011 NON-BREAKING HYPHEN
 *   U+2012 FIGURE DASH
 *   U+2013 EN DASH
 *   U+2014 EM DASH
 *   U+2212 MINUS SIGN
 *   U+FF0D FULLWIDTH HYPHEN-MINUS
 *
 * The original strings are never rewritten; only the comparison keys use this
 * normalization.
 *
 * This is NOT a general semantic normalization. It is a bounded false-negative
 * repair for exact-match guards that must still reject paraphrase, fabrication,
 * and material alteration.
 */

const DASH_FOLD: Record<string, string> = {
  "\u2010": "-",  // HYPHEN
  "\u2011": "-",  // NON-BREAKING HYPHEN
  "\u2012": "-",  // FIGURE DASH
  "\u2013": "-",  // EN DASH
  "\u2014": "-",  // EM DASH
  "\u2212": "-",  // MINUS SIGN
  "\uff0d": "-",  // FULLWIDTH HYPHEN-MINUS
};

/**
 * Produces a canonical comparison key for uncertainty fidelity.
 * The original string is not modified.
 */
export function canonicalUncertaintyKey(value: string): string {
  let result = value.trim();

  // Collapse internal Unicode whitespace runs to a single ordinary space.
  // This covers ordinary space, no-break space, and other general category Zs.
  result = result.replace(/\s+/g, " ");

  // Fold dash family to ASCII HYPHEN-MINUS.
  // Using a manual loop is faster and avoids regex backtracking on long strings.
  const chars = [...result];
  for (let i = 0; i < chars.length; i += 1) {
    const folded = DASH_FOLD[chars[i] as keyof typeof DASH_FOLD];
    if (folded !== undefined) chars[i] = folded;
  }
  return chars.join("");
}

/**
 * Compares two uncertainty strings for fidelity equivalence.
 * Returns true if they are equivalent under the canonical comparison key.
 */
export function uncertaintiesEquivalent(a: string, b: string): boolean {
  return canonicalUncertaintyKey(a) === canonicalUncertaintyKey(b);
}

/**
 * Canonicalizes an array of uncertainties for Set membership comparison.
 * Produces a Set of canonical comparison keys from the original strings.
 * The original strings are not modified.
 */
export function canonicalUncertaintySet(values: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    set.add(canonicalUncertaintyKey(value));
  }
  return set;
}

/**
 * Equality check for two uncertainty arrays under canonical comparison.
 * Returns true if both arrays have the same elements up to the canonical key.
 * Deduplicates based on canonical keys before comparison, matching the
 * original exact-set semantics.
 */
export function canonicalUncertaintyArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = canonicalUncertaintySet(left);
  const rightSet = canonicalUncertaintySet(right);
  if (leftSet.size !== rightSet.size) return false;
  for (const key of leftSet) {
    if (!rightSet.has(key)) return false;
  }
  return true;
}