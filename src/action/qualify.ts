/**
 * F4 structured-facts-only qualification (DP-010/DP-011).
 *
 * Classifies a candidate into categorical consequence / reversibility /
 * support states from governed structured facts ONLY. Never parses prose:
 * the action string is validated (non-empty) and otherwise ignored, and
 * `modelRiskLabel` is never qualification evidence. Per dimension, two or
 * more distinct governed values conflict to UNKNOWN — never a silent
 * max/min pick. Pure, deterministic, dependency-free.
 */

import type {
  ActionQualification,
  ActionSupport,
  BlockingUnknown,
  ConsequenceLevel,
  QualifyActionInput,
  ReversibilityStatus,
  StructuredActionFact,
} from "./types.js";

/** The fixed 7-member source allowlist. Anything else cannot qualify. */
const PERMITTED_SOURCES: ReadonlySet<string> = new Set<string>([
  "CANDIDATE_PROPOSAL",
  "F6_CALIBRATED_SIGNAL",
  "INTENT_AUTHORITY",
  "KNOWLEDGE_V36",
  "DECISION_ENGINE_RESULT",
  "CAPABILITY_EFFECT",
  "ACTION_SUPPORT_RULE",
]);

/** The fixed contract members per dimension. Anything else is corrupt input. */
const CONSEQUENCE_VALUES: ReadonlySet<string> = new Set<string>([
  "LOW",
  "MATERIAL",
  "HIGH",
  "UNKNOWN",
]);

const REVERSIBILITY_VALUES: ReadonlySet<string> = new Set<string>([
  "REVERSIBLE",
  "PARTIALLY_REVERSIBLE",
  "IRREVERSIBLE",
  "UNKNOWN",
]);

const SUPPORT_VALUES: ReadonlySet<string> = new Set<string>([
  "SUFFICIENT",
  "PARTIAL",
  "INSUFFICIENT",
  "UNKNOWN",
]);

function requireAction(action: string): void {
  if (action.trim().length === 0) {
    throw new Error("Action candidate action must be a non-empty string.");
  }
}

/**
 * RF-5: corrupt dimension values throw loudly. TypeScript types alone cannot
 * stop a runtime-smuggled string via unchecked cast from winning its
 * dimension, so every allowlisted fact's defined dimension value must be a
 * member of its contract union before classification.
 */
function requireGovernedDimensionValues(facts: readonly StructuredActionFact[]): void {
  for (const fact of facts) {
    if (fact.consequence !== undefined && !CONSEQUENCE_VALUES.has(fact.consequence)) {
      throw new Error("Action fact consequence must be a member of ConsequenceLevel.");
    }
    if (fact.reversibility !== undefined && !REVERSIBILITY_VALUES.has(fact.reversibility)) {
      throw new Error("Action fact reversibility must be a member of ReversibilityStatus.");
    }
    if (fact.support !== undefined && !SUPPORT_VALUES.has(fact.support)) {
      throw new Error("Action fact support must be a member of ActionSupport.");
    }
  }
}

function isPermittedFact(fact: StructuredActionFact): boolean {
  if (fact === null || typeof fact !== "object") return false;
  const source: unknown = (fact as { source?: unknown }).source;
  return typeof source === "string" && PERMITTED_SOURCES.has(source);
}

/**
 * Single governed value wins; absent or conflicting values yield UNKNOWN.
 * Conflict (≥2 distinct values) never resolves to a silent pick.
 */
function classifyDimension<T extends string>(values: readonly (T | undefined)[]): T | "UNKNOWN" {
  const distinct = new Set<T>();
  for (const value of values) {
    if (value !== undefined) distinct.add(value);
  }
  if (distinct.size !== 1) return "UNKNOWN";
  for (const value of distinct) return value;
  return "UNKNOWN";
}

/**
 * Structured-facts-only classification. Considers ONLY `candidate.facts +
 * qualifiedFacts` with allowlisted sources; ignores `modelRiskLabel` and
 * the action string entirely (beyond non-empty validation).
 */
export function qualifyAction(input: QualifyActionInput): ActionQualification {
  requireAction(input.candidate.action);
  const facts = [...input.candidate.facts, ...input.qualifiedFacts].filter(isPermittedFact);
  requireGovernedDimensionValues(facts);

  const consequence: ConsequenceLevel = classifyDimension(
    facts.map((fact) => fact.consequence),
  );
  const reversibility: ReversibilityStatus = classifyDimension(
    facts.map((fact) => fact.reversibility),
  );
  const support: ActionSupport = classifyDimension(
    facts.map((fact) => fact.support),
  );
  const materialBlockerPresent = facts.some((fact) => fact.materialBlocker === true);
  const safeguardOrAuthorityEstablished = facts.some(
    (fact) => fact.safeguardOrAuthorityEstablished === true,
  );

  const blockingUnknowns: BlockingUnknown[] = [];
  if (consequence === "UNKNOWN") blockingUnknowns.push("CONSEQUENCE_UNKNOWN");
  if (reversibility === "UNKNOWN") blockingUnknowns.push("REVERSIBILITY_UNKNOWN");
  if (support === "UNKNOWN") blockingUnknowns.push("SUPPORT_UNKNOWN");
  if (materialBlockerPresent) blockingUnknowns.push("MATERIAL_BLOCKER_UNRESOLVED");
  if (
    (consequence === "HIGH" || reversibility === "IRREVERSIBLE")
    && !safeguardOrAuthorityEstablished
  ) {
    blockingUnknowns.push("SAFEGUARD_OR_AUTHORITY_MISSING");
  }

  return Object.freeze({
    consequence,
    reversibility,
    support,
    materialBlockerPresent,
    safeguardOrAuthorityEstablished,
    blockingUnknowns: Object.freeze([...blockingUnknowns]) as readonly BlockingUnknown[],
  });
}
