import { createHash } from "node:crypto";
import {
  type LatticeRun,
  type RunRequest,
} from "../domain.js";
import type {
  DecisionPlanningMaterial,
  DurableDecisionPlan,
} from "../intent/decision-plan-store.js";
import type { DecisionInputSnapshot } from "../decision/decision-input-snapshot.js";
import type { IntentVersion } from "../intent/types.js";

export type SolandraSemanticPhase = "listening" | "understanding" | "knowledge_gap" | "actionable";
export type SolandraPresentationTransition = "initial" | "updated" | "reconnected";
export type ResourceKind = "text" | "link" | "contact" | "image" | "video" | "audio" | "document" | "map" | "generated_artifact";
export type ResourcePurpose = "resolve_knowledge_gap" | "support_understanding" | "enable_next_action";
export type ResourceStatus = "available" | "loading" | "stale" | "unavailable";
export type ResourceCapability = "copy" | "download" | "play" | "open_external" | "show_location";

export interface ProvenanceRef {
  authority: "intent_authority" | "decision_plan" | "structured_decision" | "execution_runtime" | "v36" | "product_capability";
  ref: string;
}

export interface PresentationBasis {
  conversationId: string;
  runId?: string;
  runVersion?: number;
  decisionPlanId?: string;
  intentVersionId?: string;
}

export interface DurableUnderstanding {
  goal: string;
  requirements: Array<{ criterion: string; operator: "lte" | "gte" | "eq" | "LTE" | "GTE" | "EQ"; value: string | number | boolean }>;
  preferences: Array<{ criterion: string; weight?: number; tier?: string }>;
}

export interface MaterialUncertainty {
  id: string;
  description: string;
  provenance: ProvenanceRef[];
}

export interface SupportingKnowledge {
  id: string;
  label: string;
  value: string;
  kind: "requirement" | "preference" | "decision_basis";
  provenance: ProvenanceRef[];
}

export interface ActionRecommendation {
  outcome: NonNullable<import("../domain.js").StructuredDecision["outcome"]>;
  winnerCandidateId?: string;
  frontierCandidateIds: string[];
  tiedCandidateIds: string[];
  materialUnknowns: string[];
  rationale: string[];
  provenance: ProvenanceRef[];
}

export interface ResourceDescriptor {
  id: string;
  kind: ResourceKind;
  title: string;
  purpose: ResourcePurpose;
  provenance: ProvenanceRef[];
  status: ResourceStatus;
  capabilities: ResourceCapability[];
}

export interface SolandraPresentationSnapshot {
  conversationId: string;
  presentationRevision: string;
  basis: PresentationBasis;
  phase: SolandraSemanticPhase;
  transition: SolandraPresentationTransition;
  durableUnderstanding?: DurableUnderstanding;
  materialUncertainty: MaterialUncertainty[];
  supportingKnowledge: SupportingKnowledge[];
  nextAction?: ActionRecommendation;
  resources: ResourceDescriptor[];
}

export interface HydratedResource {
  descriptor: ResourceDescriptor;
  presentationRevision: string;
  payload:
    | { kind: "text"; text: string }
    | { kind: "generated_artifact"; filename: string; mediaType: "text/plain"; text: string };
}

function formatConstraintValue(operator: "lte" | "gte" | "eq", value: string | number | boolean): string {
  const prefix = operator === "lte" ? "at most" : operator === "gte" ? "at least" : "exactly";
  return `${prefix} ${String(value)}`;
}

type AnyDecisionPlan = DurableDecisionPlan<DecisionPlanningMaterial>;

function isDecisionInput(material: DecisionPlanningMaterial): material is DecisionInputSnapshot {
  return "schemaVersion" in material;
}

function understandingFromIntent(version: IntentVersion | undefined): DurableUnderstanding | undefined {
  const objective = version?.state.objective?.value;
  if (!version || objective?.state !== "VALUE" || typeof objective.value !== "string") return undefined;
  return { goal: objective.value, requirements: [], preferences: [] };
}

function understandingFromPlan(plan: AnyDecisionPlan | undefined): DurableUnderstanding | undefined {
  if (!plan) return undefined;
  if (isDecisionInput(plan.planningMaterial)) {
    return {
      goal: plan.planningMaterial.objective,
      requirements: plan.planningMaterial.hardRequirements.map((item) => ({
        criterion: item.criterionId,
        operator: item.operator,
        value: item.expected,
      })),
      preferences: plan.planningMaterial.priorities.map((item) => ({
        criterion: item.criterionId,
        tier: item.tier,
      })),
    };
  }
  return {
    goal: plan.planningMaterial.goal,
    requirements: plan.planningMaterial.hardConstraints.map((item) => ({ ...item })),
    preferences: plan.planningMaterial.priorities.map((item) => ({ ...item })),
  };
}

function supportingFromPlan(plan: AnyDecisionPlan | undefined): SupportingKnowledge[] {
  if (!plan) return [];
  const provenance: ProvenanceRef[] = [
    { authority: "intent_authority", ref: plan.intentVersionId },
    { authority: "decision_plan", ref: plan.decisionPlanId },
  ];
  if (isDecisionInput(plan.planningMaterial)) {
    return [
      ...plan.planningMaterial.hardRequirements.map((item, index) => ({
        id: `requirement:${index}:${item.criterionId}`,
        label: item.criterionId,
        value: `${item.operator} ${String(item.expected)}`,
        kind: "requirement" as const,
        provenance,
      })),
      ...plan.planningMaterial.priorities.map((item, index) => ({
        id: `preference:${index}:${item.criterionId}`,
        label: item.criterionId,
        value: item.tier,
        kind: "preference" as const,
        provenance,
      })),
    ];
  }
  return [
    ...plan.planningMaterial.hardConstraints.map((item, index) => ({
      id: `requirement:${index}:${item.criterion}`,
      label: item.criterion,
      value: formatConstraintValue(item.operator, item.value),
      kind: "requirement" as const,
      provenance,
    })),
    ...plan.planningMaterial.priorities.map((item, index) => ({
      id: `preference:${index}:${item.criterion}`,
      label: item.criterion,
      value: `priority weight ${item.weight}`,
      kind: "preference" as const,
      provenance,
    })),
  ];
}

function phaseFromRun(
  run: LatticeRun | undefined,
  plan: AnyDecisionPlan | undefined,
  intentVersion: IntentVersion | undefined,
): SolandraSemanticPhase {
  if (!run) return plan || intentVersion ? "understanding" : "listening";
  if (run.status === "AWAITING_CLARIFICATION") return "knowledge_gap";
  if (run.status === "COMPLETED" && run.decision !== null) return "actionable";
  return plan || intentVersion ? "understanding" : "listening";
}

function resourcesFor(run: LatticeRun | undefined, plan: AnyDecisionPlan | undefined): ResourceDescriptor[] {
  if (!run || run.status !== "COMPLETED" || run.decision === null || !plan) return [];
  return [
    {
      id: `decision-criteria:${run.id}`,
      kind: "text",
      title: "Decision criteria",
      purpose: "support_understanding",
      provenance: [
        { authority: "intent_authority", ref: plan.intentVersionId },
        { authority: "decision_plan", ref: plan.decisionPlanId },
      ],
      status: "available",
      capabilities: ["copy"],
    },
    {
      id: `decision-rationale:${run.id}`,
      kind: "generated_artifact",
      title: "Decision rationale",
      purpose: "enable_next_action",
      provenance: [
        { authority: "structured_decision", ref: run.id },
        ...run.truthAssessmentIds.map((id) => ({ authority: "v36" as const, ref: id })),
      ],
      status: "available",
      capabilities: ["copy", "download"],
    },
  ];
}

function revisionFor(snapshot: Omit<SolandraPresentationSnapshot, "presentationRevision" | "transition">): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 24);
}

export function composeSolandraPresentation(input: {
  conversationId: string;
  run?: LatticeRun;
  decisionPlan?: AnyDecisionPlan;
  intentVersion?: IntentVersion;
  knownRevision?: string;
}): SolandraPresentationSnapshot {
  const { conversationId, run, decisionPlan, intentVersion, knownRevision } = input;
  const basis: PresentationBasis = {
    conversationId,
    ...(run ? { runId: run.id, runVersion: run.version } : {}),
    ...(decisionPlan ? {
      decisionPlanId: decisionPlan.decisionPlanId,
      intentVersionId: decisionPlan.intentVersionId,
    } : intentVersion ? { intentVersionId: intentVersion.intentVersionId } : {}),
  };
  const phase = phaseFromRun(run, decisionPlan, intentVersion);
  const durableUnderstanding = understandingFromIntent(intentVersion) ?? understandingFromPlan(decisionPlan);
  const supportingKnowledge = supportingFromPlan(decisionPlan);
  const materialUncertainty: MaterialUncertainty[] = run?.status === "AWAITING_CLARIFICATION"
    ? [{
        id: `clarification:${run.id}:${run.version}`,
        description: "More accepted information is required before the current decision can progress responsibly.",
        provenance: [{ authority: "execution_runtime", ref: `${run.id}@${run.version}` }],
      }]
    : [];
  const nextAction = run?.status === "COMPLETED" && run.decision !== null
    ? {
        outcome: run.decision.outcome
          ?? (run.decision.winnerCandidateId ? "RECOMMENDATION" : "UNRESOLVED"),
        ...(run.decision.winnerCandidateId
          ? { winnerCandidateId: run.decision.winnerCandidateId }
          : {}),
        frontierCandidateIds: [...(run.decision.frontierCandidateIds ?? [])],
        tiedCandidateIds: [...(run.decision.tiedCandidateIds ?? [])],
        materialUnknowns: [...(run.decision.materialUnknowns ?? [])],
        rationale: [...run.decision.rationale],
        provenance: [
          { authority: "structured_decision" as const, ref: run.id },
          ...run.truthAssessmentIds.map((id) => ({ authority: "v36" as const, ref: id })),
        ],
      }
    : undefined;
  const resources = resourcesFor(run, decisionPlan);
  const revisionInput = {
    conversationId,
    basis,
    phase,
    ...(durableUnderstanding ? { durableUnderstanding } : {}),
    materialUncertainty,
    supportingKnowledge,
    ...(nextAction ? { nextAction } : {}),
    resources,
  };
  const presentationRevision = revisionFor(revisionInput);
  const transition: SolandraPresentationTransition = knownRevision === undefined
    ? "initial"
    : knownRevision === presentationRevision
      ? "reconnected"
      : "updated";
  return { ...revisionInput, presentationRevision, transition };
}

function criteriaText(plan: AnyDecisionPlan): string {
  if (isDecisionInput(plan.planningMaterial)) {
    return [
      plan.planningMaterial.objective,
      ...plan.planningMaterial.hardRequirements.map((item) =>
        `Requirement — ${item.criterionId}: ${item.operator} ${String(item.expected)}`),
      ...plan.planningMaterial.priorities.map((item) =>
        `Preference — ${item.criterionId}: ${item.tier}`),
    ].join("\n");
  }
  const requirements = plan.planningMaterial.hardConstraints
    .map((item) => `Requirement — ${item.criterion}: ${formatConstraintValue(item.operator, item.value)}`);
  const preferences = plan.planningMaterial.priorities
    .map((item) => `Preference — ${item.criterion}: weight ${item.weight}`);
  return [plan.planningMaterial.goal, ...requirements, ...preferences].join("\n");
}

export function hydrateSolandraResource(input: {
  snapshot: SolandraPresentationSnapshot;
  resourceId: string;
  run?: LatticeRun;
  decisionPlan?: AnyDecisionPlan;
}): HydratedResource | undefined {
  const descriptor = input.snapshot.resources.find((item) => item.id === input.resourceId);
  if (!descriptor) return undefined;
  if (descriptor.id.startsWith("decision-criteria:") && input.decisionPlan) {
    return {
      descriptor,
      presentationRevision: input.snapshot.presentationRevision,
      payload: { kind: "text", text: criteriaText(input.decisionPlan) },
    };
  }
  if (descriptor.id.startsWith("decision-rationale:") && input.run?.decision?.winnerCandidateId) {
    const text = [
      `Winner: ${input.run.decision.winnerCandidateId}`,
      ...input.run.decision.rationale.map((line) => `- ${line}`),
      `Evidence: ${input.run.decision.evidenceIds.join(", ") || "none recorded"}`,
    ].join("\n");
    return {
      descriptor,
      presentationRevision: input.snapshot.presentationRevision,
      payload: {
        kind: "generated_artifact",
        filename: `solandra-decision-${input.run.id}.txt`,
        mediaType: "text/plain",
        text,
      },
    };
  }
  return undefined;
}

export function presentationRequestFromPlan(plan: DurableDecisionPlan): RunRequest {
  return structuredClone(plan.planningMaterial);
}
