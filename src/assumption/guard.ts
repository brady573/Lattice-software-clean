/**
 * Assumption Guard decision procedure (DP-002/DP-004).
 *
 * Pure, deterministic, dependency-free: classification and resolution are a
 * closed structural rule over explicitly declared candidates. There is no
 * model call, no lexical patching of user wording, no domain mapping, and no
 * persisted state. Ordinary-language understanding stays with Solandra (via
 * the one advisory prompt line); this module is the trust boundary that
 * classifies what Solandra surfaced and resolves it.
 *
 * MATERIALITY RULE (binding): a candidate is material iff it is not
 * SUPPORTED and changing it could change the conclusion, the expressed
 * confidence, or the next action. Non-material candidates must not create
 * UX friction: they are tracked internally and never surfaced.
 *
 * IMPLEMENTED RESOLUTIONS:
 * - WEAKEN: weaken the conclusion and surface each material dependency as
 *   uncertainty under the governed "What remains uncertain:" header.
 * - ASK (as WEAKEN_AND_ASK): additionally surface the top UNKNOWN dependency
 *   as one natural question. UNKNOWN means only the user may be able to
 *   confirm it in-turn; UNSUPPORTED dependencies need evidence, not a user
 *   question, so they weaken without asking.
 *
 * DOCUMENTED FOLLOW-UPS (deliberately not built):
 * - ADDITIONAL_EVIDENCE: schedule governed investigation for the dependency.
 * - OFFER_COMPETING_EXPLANATIONS: present alternatives that avoid it.
 * - CHOOSE_SAFER_ACTION: recommend a more reversible action path.
 * - RESOLVED: close the dependency when evidence arrives.
 * Building all six would add machinery without removing a user barrier today.
 */

import type {
  AssumptionCandidate,
  AssumptionGuardInput,
  AssumptionGuardOutput,
  AssumptionGuardResolutionKind,
} from "./types.js";

/** Governed section header reused so weakened conclusions match house wording. */
export const REMAINING_UNCERTAINTY_HEADER = "What remains uncertain:";

/** Cap so a guard question always fits the 2,000-character question bound. */
const MAX_QUESTION_LENGTH = 1_800;

function requireConfidence(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Assumption Guard ${label} must be a finite number in [0, 1].`);
  }
  return value;
}

/**
 * The materiality rule. SUPPORTED dependencies never block, no matter their
 * declared impact: USER authority and governed Knowledge stand on their own.
 */
export function isMaterialAssumption(candidate: AssumptionCandidate): boolean {
  if (candidate.support === "SUPPORTED") return false;
  return candidate.confidenceIfFalse < candidate.confidenceIfTrue
    || candidate.bearsOnConfidence
    || candidate.affectsConclusion
    || candidate.affectsAction;
}

function requireCandidate(candidate: AssumptionCandidate, index: number): AssumptionCandidate {
  const statement = candidate.statement.trim();
  if (statement.length === 0) {
    throw new Error(`Assumption Guard candidate ${index} statement must be non-empty.`);
  }
  requireConfidence(candidate.confidenceIfTrue, `candidate ${index} confidenceIfTrue`);
  requireConfidence(candidate.confidenceIfFalse, `candidate ${index} confidenceIfFalse`);
  if (candidate.confidenceIfFalse > candidate.confidenceIfTrue) {
    throw new Error(
      `Assumption Guard candidate ${index} confidenceIfFalse must not exceed confidenceIfTrue.`,
    );
  }
  return candidate;
}

/** Largest confidence swing first; input order breaks ties. */
function topMaterialDependency(
  material: readonly AssumptionCandidate[],
): AssumptionCandidate | undefined {
  let top: AssumptionCandidate | undefined;
  let topSwing = Number.NEGATIVE_INFINITY;
  for (const candidate of material) {
    const swing = candidate.confidenceIfTrue - candidate.confidenceIfFalse;
    if (swing > topSwing) {
      top = candidate;
      topSwing = swing;
    }
  }
  return top;
}

/**
 * One natural question for a dependency, in Solandra's plain user-facing
 * voice. No inventories, graphs, or internal terminology: just the thing that
 * needs confirming. A statement Solandra already phrased as a question is
 * reused verbatim; otherwise it becomes a confirm-one-thing question.
 * Returns undefined when no user-safe question fits the length bound.
 */
function toQuestion(statement: string): string | undefined {
  const trimmed = statement.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.endsWith("?")) {
    return trimmed.length <= MAX_QUESTION_LENGTH ? trimmed : undefined;
  }
  const declawed = trimmed.replace(/[.\s]+$/u, "");
  const lowered = declawed.charAt(0).toLowerCase() + declawed.slice(1);
  const question = `Can you confirm that ${lowered}?`;
  return question.length <= MAX_QUESTION_LENGTH ? question : undefined;
}

function dedupeStatements(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function guardAssumptions(input: AssumptionGuardInput): AssumptionGuardOutput {
  const conclusion = input.conclusion.trim();
  if (conclusion.length === 0) {
    throw new Error("Assumption Guard conclusion must be non-empty.");
  }
  requireConfidence(input.expressedConfidence, "expressedConfidence");
  if (input.proposedAction !== undefined && input.proposedAction.trim().length === 0) {
    throw new Error("Assumption Guard proposedAction must be non-empty when provided.");
  }

  const candidates = input.candidates.map((candidate, index) => requireCandidate(candidate, index));
  const material = candidates.filter(isMaterialAssumption);
  const nonMaterial = candidates.filter((candidate) => !isMaterialAssumption(candidate));

  if (material.length === 0) {
    return Object.freeze({
      cleared: true,
      resolution: "CLEAR" as AssumptionGuardResolutionKind,
      material: Object.freeze([]) as readonly AssumptionCandidate[],
      nonMaterial: Object.freeze([...nonMaterial]) as readonly AssumptionCandidate[],
      adjustedConfidence: input.expressedConfidence,
      surfacedUncertainties: Object.freeze([]) as readonly string[],
    });
  }

  const adjustedConfidence = Math.min(
    input.expressedConfidence,
    ...material.map((candidate) => candidate.confidenceIfFalse),
  );
  const surfacedUncertainties = dedupeStatements(material.map((candidate) => candidate.statement));
  const weakenedConclusion = [
    conclusion,
    `${REMAINING_UNCERTAINTY_HEADER}\n${surfacedUncertainties.map((item) => `- ${item}`).join("\n")}`,
  ].join("\n\n");

  const top = topMaterialDependency(material);
  const question = top !== undefined && top.support === "UNKNOWN"
    ? toQuestion(top.statement)
    : undefined;

  if (question === undefined) {
    return Object.freeze({
      cleared: false,
      resolution: "WEAKEN" as AssumptionGuardResolutionKind,
      material: Object.freeze([...material]) as readonly AssumptionCandidate[],
      nonMaterial: Object.freeze([...nonMaterial]) as readonly AssumptionCandidate[],
      adjustedConfidence,
      surfacedUncertainties: Object.freeze([...surfacedUncertainties]) as readonly string[],
      weakenedConclusion,
    });
  }
  return Object.freeze({
    cleared: false,
    resolution: "WEAKEN_AND_ASK" as AssumptionGuardResolutionKind,
    material: Object.freeze([...material]) as readonly AssumptionCandidate[],
    nonMaterial: Object.freeze([...nonMaterial]) as readonly AssumptionCandidate[],
    adjustedConfidence,
    surfacedUncertainties: Object.freeze([...surfacedUncertainties]) as readonly string[],
    weakenedConclusion,
    question,
  });
}
