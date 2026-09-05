import { z } from "zod";
import { ModelRuntime } from "../model/runtime.js";
import type { CanonicalModelRequest } from "../model/types.js";

export type InvestigationMateriality = "MATERIAL" | "CONTEXTUAL";
export type MissingFactAcquisitionMode = "USER_ONLY" | "RESEARCHABLE" | "UNKNOWN";
export type SourceAuthorityNeed =
  | "PRIMARY_OR_OFFICIAL"
  | "HIGH_QUALITY_SECONDARY"
  | "GENERAL_ORIENTATION"
  | "UNKNOWN";

export interface InvestigationIssue {
  readonly issueId: string;
  readonly question: string;
  readonly materiality: InvestigationMateriality;
  readonly rationale: string;
}

export interface MissingFactNeed {
  readonly factId: string;
  readonly question: string;
  readonly acquisitionMode: MissingFactAcquisitionMode;
  readonly materiality: InvestigationMateriality;
  readonly rationale: string;
}

export interface SourceRequirement {
  readonly requirementId: string;
  readonly issueIds: readonly string[];
  readonly authorityNeed: SourceAuthorityNeed;
  readonly jurisdictionNeeded: boolean;
  readonly currentnessNeeded: boolean;
  readonly description: string;
}

export interface InvestigationDependency {
  readonly dependencyId: string;
  readonly blockedIssueId: string;
  readonly dependsOnIssueIds: readonly string[];
  readonly dependsOnFactIds: readonly string[];
  readonly rationale: string;
}

export interface InvestigationBrief {
  readonly briefId: string;
  readonly runId: string;
  readonly intentVersionId: string;
  readonly objective: string;
  readonly issues: readonly InvestigationIssue[];
  readonly missingFacts: readonly MissingFactNeed[];
  readonly sourceRequirements: readonly SourceRequirement[];
  readonly dependencies: readonly InvestigationDependency[];
  readonly plannerKind: string;
  readonly createdAt: string;
}

export interface KnowledgeInvestigationPlanningInput {
  readonly runId: string;
  readonly intentVersionId: string;
  readonly objective: string;
  readonly context: readonly string[];
}

export interface KnowledgeInvestigationPlanner {
  readonly kind: string;
  plan(input: KnowledgeInvestigationPlanningInput): Promise<InvestigationBrief>;
}

const idSchema = z.string().trim().min(1).max(200);
const boundedTextSchema = z.string().trim().min(1).max(2_000);
const objectiveSchema = z.string().trim().min(1).max(8_000);
const materialitySchema = z.enum(["MATERIAL", "CONTEXTUAL"]);
const acquisitionModeSchema = z.enum(["USER_ONLY", "RESEARCHABLE", "UNKNOWN"]);
const authorityNeedSchema = z.enum([
  "PRIMARY_OR_OFFICIAL",
  "HIGH_QUALITY_SECONDARY",
  "GENERAL_ORIENTATION",
  "UNKNOWN",
]);

const issueSchema = z.object({
  issueId: idSchema,
  question: boundedTextSchema,
  materiality: materialitySchema,
  rationale: boundedTextSchema,
}).strict();

const missingFactSchema = z.object({
  factId: idSchema,
  question: boundedTextSchema,
  acquisitionMode: acquisitionModeSchema,
  materiality: materialitySchema,
  rationale: boundedTextSchema,
}).strict();

const sourceRequirementSchema = z.object({
  requirementId: idSchema,
  issueIds: z.array(idSchema).max(8),
  authorityNeed: authorityNeedSchema,
  jurisdictionNeeded: z.boolean(),
  currentnessNeeded: z.boolean(),
  description: boundedTextSchema,
}).strict();

const dependencySchema = z.object({
  dependencyId: idSchema,
  blockedIssueId: idSchema,
  dependsOnIssueIds: z.array(idSchema).max(8),
  dependsOnFactIds: z.array(idSchema).max(8),
  rationale: boundedTextSchema,
}).strict();

const investigationBriefSchema = z.object({
  briefId: idSchema,
  runId: idSchema,
  intentVersionId: idSchema,
  objective: objectiveSchema,
  issues: z.array(issueSchema).max(8),
  missingFacts: z.array(missingFactSchema).max(8),
  sourceRequirements: z.array(sourceRequirementSchema).max(8),
  dependencies: z.array(dependencySchema).max(12),
  plannerKind: idSchema,
  createdAt: z.string().datetime({ offset: true }),
}).strict();

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique IDs.`);
  }
}

function validateReferences(brief: InvestigationBrief): void {
  const issueIds = new Set(brief.issues.map((issue) => issue.issueId));
  const factIds = new Set(brief.missingFacts.map((fact) => fact.factId));

  for (const requirement of brief.sourceRequirements) {
    if (requirement.issueIds.length === 0) {
      throw new Error("SourceRequirement must reference at least one issue.");
    }
    requireUnique(requirement.issueIds, `SourceRequirement ${requirement.requirementId} issueIds`);
    for (const issueId of requirement.issueIds) {
      if (!issueIds.has(issueId)) throw new Error(`Unknown issue reference: ${issueId}`);
    }
  }

  for (const dependency of brief.dependencies) {
    if (!issueIds.has(dependency.blockedIssueId)) {
      throw new Error(`Unknown blocked issue reference: ${dependency.blockedIssueId}`);
    }
    requireUnique(dependency.dependsOnIssueIds, `InvestigationDependency ${dependency.dependencyId} issue IDs`);
    requireUnique(dependency.dependsOnFactIds, `InvestigationDependency ${dependency.dependencyId} fact IDs`);
    for (const issueId of dependency.dependsOnIssueIds) {
      if (!issueIds.has(issueId)) throw new Error(`Unknown dependency issue reference: ${issueId}`);
      if (issueId === dependency.blockedIssueId) {
        throw new Error("InvestigationDependency cannot depend on its own blocked issue.");
      }
    }
    for (const factId of dependency.dependsOnFactIds) {
      if (!factIds.has(factId)) throw new Error(`Unknown dependency fact reference: ${factId}`);
    }
  }
}

/**
 * Validate a planner proposal as a non-authoritative, exactly bound InvestigationBrief.
 * Passing this validator grants no Intent, truth, Decision, or execution authority.
 */
export function validateInvestigationBrief(
  raw: unknown,
  expected: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
): InvestigationBrief {
  const parsed = investigationBriefSchema.parse(raw) as InvestigationBrief;
  if (parsed.runId !== expected.runId) throw new Error("InvestigationBrief run binding mismatch.");
  if (parsed.intentVersionId !== expected.intentVersionId) {
    throw new Error("InvestigationBrief IntentVersion binding mismatch.");
  }
  if (parsed.objective !== expected.objective) throw new Error("InvestigationBrief objective binding mismatch.");

  requireUnique(parsed.issues.map((issue) => issue.issueId), "InvestigationIssue IDs");
  requireUnique(parsed.missingFacts.map((fact) => fact.factId), "MissingFactNeed IDs");
  requireUnique(parsed.sourceRequirements.map((item) => item.requirementId), "SourceRequirement IDs");
  requireUnique(parsed.dependencies.map((item) => item.dependencyId), "InvestigationDependency IDs");
  validateReferences(parsed);
  return Object.freeze(structuredClone(parsed));
}

/** A brief is current only for the exact Run, IntentVersion, and objective it was planned against. */
export function investigationBriefIsCurrent(
  brief: InvestigationBrief,
  current: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
): boolean {
  return brief.runId === current.runId
    && brief.intentVersionId === current.intentVersionId
    && brief.objective === current.objective;
}

/**
 * Select at most one minimum material USER-only blocker. Researchable or merely
 * contextual facts remain Lattice investigation work rather than USER burden.
 */
export function selectMaterialInvestigationClarification(
  brief: InvestigationBrief,
): MissingFactNeed | null {
  const materialIssueIds = new Set(
    brief.issues.filter((issue) => issue.materiality === "MATERIAL").map((issue) => issue.issueId),
  );
  const blockingFactIds = new Set(
    brief.dependencies
      .filter((dependency) => materialIssueIds.has(dependency.blockedIssueId))
      .flatMap((dependency) => dependency.dependsOnFactIds),
  );
  return brief.missingFacts.find((fact) =>
    fact.acquisitionMode === "USER_ONLY"
      && fact.materiality === "MATERIAL"
      && blockingFactIds.has(fact.factId)
  ) ?? null;
}

export interface ModelGatewayKnowledgeInvestigationPlannerOptions {
  readonly model: string;
  readonly plannerKind?: string;
  readonly maxOutputTokens?: number;
}

function plannerRequest(
  input: KnowledgeInvestigationPlanningInput,
  model: string,
  plannerKind: string,
  maxOutputTokens: number,
): CanonicalModelRequest {
  return {
    model,
    temperature: 0,
    maxOutputTokens,
    messages: [
      {
        role: "system",
        content: [
          "Produce one JSON InvestigationBrief only; do not answer the user's objective.",
          "Preserve runId, intentVersionId, and objective exactly as supplied.",
          "Identify bounded issues to investigate, minimum missing facts, generic source characteristics, and dependencies.",
          "Missing fact acquisitionMode must be USER_ONLY, RESEARCHABLE, or UNKNOWN.",
          "Source authorityNeed must be PRIMARY_OR_OFFICIAL, HIGH_QUALITY_SECONDARY, GENERAL_ORIENTATION, or UNKNOWN.",
          "Do not state conclusions, truth verdicts, preferences, requirements, decisions, or execution authorization.",
          "Return strict JSON with: briefId, runId, intentVersionId, objective, issues, missingFacts, sourceRequirements, dependencies, plannerKind, createdAt.",
          `plannerKind must be exactly ${plannerKind}.`,
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          runId: input.runId,
          intentVersionId: input.intentVersionId,
          objective: input.objective,
          context: input.context,
        }),
      },
    ],
  };
}

/** Model-assisted planner behind the existing non-authoritative Model Gateway. */
export class ModelGatewayKnowledgeInvestigationPlanner implements KnowledgeInvestigationPlanner {
  readonly kind: string;
  private readonly model: string;
  private readonly maxOutputTokens: number;

  constructor(
    private readonly runtime: ModelRuntime,
    options: ModelGatewayKnowledgeInvestigationPlannerOptions,
  ) {
    this.kind = options.plannerKind ?? "model-gateway-investigation-brief-v0.1";
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens ?? 2_000;
  }

  async plan(input: KnowledgeInvestigationPlanningInput): Promise<InvestigationBrief> {
    const request = plannerRequest(input, this.model, this.kind, this.maxOutputTokens);
    const result = await this.runtime.call(request, {
      correlationId: `investigation-brief:${input.runId}`,
      idempotencyKey: input.intentVersionId,
      maxAttempts: 1,
    });
    if (result.response.output.length !== 1 || result.response.output[0]?.type !== "text") {
      throw new Error("Investigation planner must return exactly one text JSON output.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(result.response.output[0].text);
    } catch (cause) {
      throw new Error("Investigation planner returned invalid JSON.", { cause });
    }
    const brief = validateInvestigationBrief(raw, input);
    if (brief.plannerKind !== this.kind) throw new Error("InvestigationBrief planner binding mismatch.");
    return brief;
  }
}
