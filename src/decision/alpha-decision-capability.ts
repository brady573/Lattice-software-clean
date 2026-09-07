import { QualifiedCriterionCatalog } from "./criterion-catalog.js";
import {
  ConservativeConsultationInterpreter,
  type ConsultationInterpretationInput,
  type ConsultationInterpretationProposal,
  type ConsultationInterpreter,
} from "../intent/consultation-interpreter.js";
import type { IntentOperation } from "../intent/types.js";

export const ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID = "npm.runtimeDependencies.count";
export const ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_VERSION = 1;

export const alphaDecisionCriterionCatalog = new QualifiedCriterionCatalog(1, [
  {
    criterionId: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID,
    version: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_VERSION,
    valueType: "NUMBER",
    preferenceDirection: "LOWER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
]);

// This deliberately uses a conservative package-name subset whose final
// character must be alphanumeric. That prevents ordinary sentence punctuation
// from silently becoming part of a USER-named candidate.
const npmPackageSegment = "[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?";
const npmPackageToken = `(?:@${npmPackageSegment}\\/${npmPackageSegment}|${npmPackageSegment})`;
const candidatePairPattern = new RegExp(
  `\\bbetween\\s+(?:the\\s+)?(?:npm\\s+)?packages?\\s+(${npmPackageToken})\\s+(?:and|or)\\s+(${npmPackageToken})(?=\\s|[.,;!?]|$)`,
  "iu",
);
const exactNpmPackageNamePattern = new RegExp(`^(?:@${npmPackageSegment}\\/${npmPackageSegment}|${npmPackageSegment})$`, "u");
const decisionVerbPattern = /\b(?:choose|decide|pick|select|recommend)\b/iu;
const npmPackageContextPattern = /\bnpm\b[^.!?\n]{0,80}\bpackages?\b|\bpackages?\b[^.!?\n]{0,80}\bnpm\b/iu;

function normalized(value: string): string {
  return value.trim().replaceAll("’", "'").replace(/\s+/gu, " ");
}

function validNpmPackageName(value: string): boolean {
  return exactNpmPackageNamePattern.test(value);
}

function packagePair(value: string): readonly [string, string] | null {
  const match = candidatePairPattern.exec(normalized(value).toLocaleLowerCase("en-US"));
  const left = match?.[1]?.trim();
  const right = match?.[2]?.trim();
  if (!left || !right || left === right || !validNpmPackageName(left) || !validNpmPackageName(right)) return null;
  return [left, right] as const;
}

function decisionCue(value: string): boolean {
  const text = normalized(value);
  return decisionVerbPattern.test(text) && npmPackageContextPattern.test(text);
}

function runtimeDependencyMaximum(value: string): number | null {
  const text = normalized(value);
  if (/\bno\s+(?:declared\s+)?(?:runtime\s+)?dependenc(?:y|ies)\b/iu.test(text)) return 0;
  const match = /\b(?:at\s+most|no\s+more\s+than|max(?:imum)?(?:\s+of)?)\s+(\d+)\s+(?:declared\s+)?(?:runtime\s+)?dependenc(?:y|ies)\b/iu.exec(text);
  if (!match?.[1]) return null;
  const valueNumber = Number(match[1]);
  return Number.isSafeInteger(valueNumber) && valueNumber >= 0 ? valueNumber : null;
}

function prefersFewerRuntimeDependencies(value: string): boolean {
  const text = normalized(value);
  return (
    /\b(?:fewer|fewest|lower)\s+(?:declared\s+)?(?:runtime\s+)?dependenc(?:y|ies)\b[^.!?\n]{0,96}\b(?:matter(?:s)?\s+most|most\s+important|top\s+priority|priority)\b/iu.test(text)
    || /\b(?:prefer|prioriti[sz]e|minimi[sz]e)\b[^.!?\n]{0,64}\b(?:declared\s+)?(?:runtime\s+)?dependenc(?:y|ies)\b/iu.test(text)
  );
}

export interface AlphaNpmDecisionSemantics {
  readonly candidates: readonly [string, string];
  readonly maximumRuntimeDependencies: number | null;
  readonly fewerRuntimeDependenciesMatterMost: boolean;
}

/**
 * Parse only the bounded Alpha decision slice. Candidate names must be explicit
 * in the USER-authored objective; this helper never invents alternatives.
 */
export function parseAlphaNpmDecisionSemantics(value: string): AlphaNpmDecisionSemantics | null {
  if (!decisionCue(value)) return null;
  const candidates = packagePair(value);
  if (!candidates) return null;
  return Object.freeze({
    candidates,
    maximumRuntimeDependencies: runtimeDependencyMaximum(value),
    fewerRuntimeDependenciesMatterMost: prefersFewerRuntimeDependencies(value),
  });
}

function authoritativeObjective(input: ConsultationInterpretationInput): string | undefined {
  const objective = input.currentIntentVersion?.state.objective;
  return objective?.value.state === "VALUE" && typeof objective.value.value === "string"
    ? objective.value.value
    : undefined;
}

/**
 * Canonical Alpha interpreter for one genuinely qualified decision capability:
 * choosing between two explicitly named npm packages by their published runtime
 * dependency count. Everything else falls back to the conservative interpreter.
 *
 * Parsed requirement/priority meaning remains only a proposal. Intent Authority
 * receives it only after explicit USER confirmation through the existing pending
 * material-clarification contract.
 */
export class AlphaDecisionConsultationInterpreter implements ConsultationInterpreter {
  private readonly fallback = new ConservativeConsultationInterpreter();

  async interpret(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal> {
    const base = await this.fallback.interpret(input);
    if (input.explicitResourceNeed || base.clarificationQuestion) return base;

    const currentObjective = authoritativeObjective(input);
    const proposedObjective = base.objectiveEffect.kind === "PRESERVE"
      ? currentObjective ?? input.message
      : base.objectiveEffect.value;
    const decisionRequested = decisionCue(proposedObjective) || (currentObjective ? decisionCue(currentObjective) : false);
    if (!decisionRequested) return base;

    const candidates = packagePair(proposedObjective) ?? packagePair(input.message);
    if (!candidates) {
      return {
        ...base,
        decisionRequested: true,
        meaningKind: "MATERIAL_INFERENCE",
        clarificationQuestion: "Which two npm packages are you choosing between? Please name both packages in the decision request.",
      };
    }

    const semanticText = `${proposedObjective}\n${input.message}`;
    const maximumRuntimeDependencies = runtimeDependencyMaximum(semanticText);
    const fewerMatterMost = prefersFewerRuntimeDependencies(semanticText);
    if (maximumRuntimeDependencies === null && !fewerMatterMost) {
      return {
        ...base,
        decisionRequested: true,
        meaningKind: "MATERIAL_INFERENCE",
        clarificationQuestion: "For this Alpha decision path, I can currently compare npm packages by their published runtime dependency count. Tell me whether you have a maximum dependency count or whether fewer runtime dependencies should matter most.",
      };
    }

    const operations: IntentOperation[] = [];
    if (maximumRuntimeDependencies !== null) {
      operations.push({
        op: "SET",
        path: { kind: "REQUIREMENT", key: `${ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID}::max` },
        value: { state: "VALUE", value: maximumRuntimeDependencies },
      });
    }
    if (fewerMatterMost) {
      operations.push({
        op: "SET",
        path: { kind: "PREFERENCE", key: ALPHA_NPM_RUNTIME_DEPENDENCY_CRITERION_ID },
        value: { state: "VALUE", value: "MATTERS_MOST" },
      });
    }

    const semantics = [
      maximumRuntimeDependencies === null
        ? null
        : `a hard maximum of ${maximumRuntimeDependencies} published runtime ${maximumRuntimeDependencies === 1 ? "dependency" : "dependencies"}`,
      fewerMatterMost ? "fewer published runtime dependencies as your top priority" : null,
    ].filter((item): item is string => item !== null).join(" and ");

    return {
      ...base,
      decisionRequested: true,
      meaningKind: "MATERIAL_INFERENCE",
      materialClarification: {
        operations,
        question: `I can compare ${candidates[0]} and ${candidates[1]} using ${semantics}. Is that the decision meaning you want me to use?`,
        confirmationExample: "Yes, that's correct.",
      },
    };
  }
}
