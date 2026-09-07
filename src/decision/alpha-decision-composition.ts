import { AlphaDecisionConsultationInterpreter, alphaDecisionCriterionCatalog } from "./alpha-decision-capability.js";
import { GovernedKnowledgeDecisionEvidenceProvider } from "../truth/governed-decision-evidence.js";

/**
 * One bounded canonical A3 capability. Keeping the composition here prevents
 * Product entrypoints from re-encoding criterion or evidence semantics.
 */
export function createAlphaDecisionRuntimeComposition() {
  return {
    consultationInterpreter: new AlphaDecisionConsultationInterpreter(),
    criterionCatalog: alphaDecisionCriterionCatalog,
    decisionEvidenceProvider: new GovernedKnowledgeDecisionEvidenceProvider(),
  } as const;
}

export function createAlphaDecisionWorkerComposition() {
  return {
    criterionCatalog: alphaDecisionCriterionCatalog,
    decisionEvidenceProvider: new GovernedKnowledgeDecisionEvidenceProvider(),
  } as const;
}
