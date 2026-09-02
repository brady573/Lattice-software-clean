export { createSolandraConsultationProjection } from "./consultation.js";
export { assertSolandraExplanationFidelity, assertSolandraPlanFidelity } from "./fidelity.js";
export { createSolandraExplanationPlan } from "./plan.js";
export { renderCanonicalExplanation } from "./renderer.js";
export type {
  ConsultationAlternative,
  ConsultationEvidenceSource,
  ConsultationEvidenceTrace,
  ConsultationPriority,
  ConsultationProjection,
  ConsultationRequirement,
  ConsultationRequirementStatus,
} from "./consultation.js";
export type {
  SolandraCandidateView,
  SolandraConstraintView,
  SolandraExplanationPlan,
  SolandraTruthReference,
} from "./types.js";
