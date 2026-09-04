import { createHash } from "node:crypto";
import {
  type LatticeRun,
  type RunRequest,
  runObjective,
} from "../domain.js";
import type {
  DecisionPlanningMaterial,
  DurableDecisionPlan,
} from "../intent/decision-plan-store.js";
import type { DecisionInputSnapshot } from "../decision/decision-input-snapshot.js";
import type { IntentProvenance, IntentValue, IntentVersion } from "../intent/types.js";
import type { KnowledgeOutcome, RunOutcome } from "../outcome.js";

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
  requirements: AuthoritativeIntentEntry[];
  preferences: AuthoritativeIntentEntry[];
}

export interface AuthoritativeIntentEntry {
  semanticKey: string;
  value: IntentValue;
  provenance: IntentProvenance;
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
  editable?: true;
  executionAuthorized?: false;
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
  return {
    goal: objective.value,
    requirements: Object.entries(version.state.requirements)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([semanticKey, field]) => ({
        semanticKey,
        value: structuredClone(field.value),
        provenance: structuredClone(field.provenance),
      })),
    preferences: Object.entries(version.state.preferences)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([semanticKey, field]) => ({
        semanticKey,
        value: structuredClone(field.value),
        provenance: structuredClone(field.provenance),
      })),
  };
}

function knowledgeFromOutcome(outcome: RunOutcome | undefined): KnowledgeOutcome | undefined {
  if (!outcome) return undefined;
  return outcome.kind === "KNOWLEDGE" ? outcome : outcome.knowledge;
}

function faithfulKnowledgeFromOutcome(
  run: LatticeRun | undefined,
  outcome: RunOutcome | undefined,
): KnowledgeOutcome | undefined {
  if (!run || run.status !== "COMPLETED") return undefined;
  const knowledge = knowledgeFromOutcome(outcome);
  if (!knowledge || knowledge.objective !== runObjective(run.request)) return undefined;
  const admittedAssessmentIds = new Set(run.truthAssessmentIds);
  const projectedAssessmentIds = new Set(knowledge.truthAssessmentIds);
  if (projectedAssessmentIds.size !== admittedAssessmentIds.size) return undefined;
  if ([...projectedAssessmentIds].some((id) => !admittedAssessmentIds.has(id))) return undefined;
  return knowledge;
}

function supportingFromOutcome(run: LatticeRun | undefined, outcome: RunOutcome | undefined): SupportingKnowledge[] {
  const knowledge = faithfulKnowledgeFromOutcome(run, outcome);
  if (!knowledge) return [];
  const provenance = knowledge.truthAssessmentIds.map((ref) => ({ authority: "v36" as const, ref }));
  if (knowledge.findings.length > 0 && provenance.length === 0) return [];
  return knowledge.findings.map((finding) => ({
    id: `knowledge:${finding.claimId}`,
    label: finding.status,
    value: finding.text,
    provenance,
  }));
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

function actionPreparationResource(
  run: LatticeRun | undefined,
  outcome: RunOutcome | undefined,
): ResourceDescriptor | undefined {
  if (!run || run.status !== "COMPLETED" || run.decision !== null || outcome?.kind !== "ACTION_PREPARATION") {
    return undefined;
  }
  if (!faithfulKnowledgeFromOutcome(run, outcome)) return undefined;
  return {
    id: `action-preparation:${run.id}`,
    kind: "generated_artifact",
    title: outcome.resource.title,
    purpose: "enable_next_action",
    provenance: [
      { authority: "execution_runtime", ref: `${run.id}@${run.version}` },
      ...outcome.knowledge.truthAssessmentIds.map((ref) => ({ authority: "v36" as const, ref })),
    ],
    status: "available",
    capabilities: ["copy", "download"],
    editable: outcome.resource.editable,
    executionAuthorized: outcome.resource.executionAuthorized,
  };
}

function resourcesFor(
  run: LatticeRun | undefined,
  plan: AnyDecisionPlan | undefined,
  outcome: RunOutcome | undefined,
): ResourceDescriptor[] {
  if (!run || run.status !== "COMPLETED") return [];
  const preparedResource = actionPreparationResource(run, outcome);
  if (preparedResource) return [preparedResource];
  if (run.decision === null) return [];
  const resources: ResourceDescriptor[] = [];
  if (plan) {
    resources.push({
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
    });
  }
  resources.push({
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
    });
  return resources;
}

function revisionFor(snapshot: Omit<SolandraPresentationSnapshot, "presentationRevision" | "transition">): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex").slice(0, 24);
}

export function composeSolandraPresentation(input: {
  conversationId: string;
  run?: LatticeRun;
  decisionPlan?: AnyDecisionPlan;
  intentVersion?: IntentVersion;
  outcome?: RunOutcome;
  knownRevision?: string;
}): SolandraPresentationSnapshot {
  const { conversationId, run, decisionPlan, intentVersion, outcome, knownRevision } = input;
  const basis: PresentationBasis = {
    conversationId,
    ...(run ? { runId: run.id, runVersion: run.version } : {}),
    ...(decisionPlan ? { decisionPlanId: decisionPlan.decisionPlanId } : {}),
    ...(intentVersion ? { intentVersionId: intentVersion.intentVersionId } : {}),
  };
  const phase = phaseFromRun(run, decisionPlan, intentVersion);
  const durableUnderstanding = understandingFromIntent(intentVersion);
  const supportingKnowledge = supportingFromOutcome(run, outcome);
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
  const resources = resourcesFor(run, decisionPlan, outcome);
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
  outcome?: RunOutcome;
}): HydratedResource | undefined {
  const descriptor = input.snapshot.resources.find((item) => item.id === input.resourceId);
  if (!descriptor) return undefined;
  const preparedResource = actionPreparationResource(input.run, input.outcome);
  if (
    preparedResource
    && descriptor.id === preparedResource.id
    && input.outcome?.kind === "ACTION_PREPARATION"
    && input.run
  ) {
    const filenameKind = input.outcome.resource.kind === "CHECKLIST" ? "checklist" : "prepared-message";
    return {
      descriptor,
      presentationRevision: input.snapshot.presentationRevision,
      payload: {
        kind: "generated_artifact",
        filename: `solandra-${filenameKind}-${input.run.id}.txt`,
        mediaType: "text/plain",
        text: input.outcome.resource.body,
      },
    };
  }
  if (descriptor.id === `decision-criteria:${input.run?.id ?? ""}` && input.decisionPlan) {
    return {
      descriptor,
      presentationRevision: input.snapshot.presentationRevision,
      payload: { kind: "text", text: criteriaText(input.decisionPlan) },
    };
  }
  if (descriptor.id === `decision-rationale:${input.run?.id ?? ""}` && input.run?.decision) {
    const decision = input.run.decision;
    const outcome = decision.outcome
      ?? (decision.winnerCandidateId ? "RECOMMENDATION" : "UNRESOLVED");
    const text = [
      `Outcome: ${outcome}`,
      ...(decision.winnerCandidateId ? [`Winner: ${decision.winnerCandidateId}`] : []),
      ...((decision.frontierCandidateIds?.length ?? 0) > 0
        ? [`Frontier: ${decision.frontierCandidateIds?.join(", ")}`]
        : []),
      ...((decision.tiedCandidateIds?.length ?? 0) > 0
        ? [`Tied options: ${decision.tiedCandidateIds?.join(", ")}`]
        : []),
      ...((decision.materialUnknowns?.length ?? 0) > 0
        ? [`Material unknowns: ${decision.materialUnknowns?.join(", ")}`]
        : []),
      ...decision.rationale.map((line) => `- ${line}`),
      `Evidence: ${decision.evidenceIds.join(", ") || "none recorded"}`,
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
