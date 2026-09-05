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

const modelInvestigationBriefSchema = z.object({
  briefId: idSchema,
  runId: idSchema,
  intentVersionId: idSchema,
  objective: objectiveSchema,
  issues: z.array(issueSchema).max(8),
  missingFacts: z.array(missingFactSchema).max(8),
  sourceRequirements: z.array(sourceRequirementSchema).max(8),
  dependencies: z.array(dependencySchema).max(12),
  plannerKind: idSchema,
  // createdAt is accepted only as untrusted model residue and is never propagated.
  // The request explicitly tells the model to omit it; Lattice owns accepted creation time.
  createdAt: z.unknown().optional(),
}).strict();

type InvestigationBriefProposal = Omit<InvestigationBrief, "createdAt">;

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique IDs.`);
  }
}

function validateReferences(
  brief: Pick<InvestigationBrief, "issues" | "missingFacts" | "sourceRequirements" | "dependencies">,
): void {
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

function validateBindings(
  brief: Pick<InvestigationBrief, "runId" | "intentVersionId" | "objective">,
  expected: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
): void {
  if (brief.runId !== expected.runId) throw new Error("InvestigationBrief run binding mismatch.");
  if (brief.intentVersionId !== expected.intentVersionId) {
    throw new Error("InvestigationBrief IntentVersion binding mismatch.");
  }
  if (brief.objective !== expected.objective) throw new Error("InvestigationBrief objective binding mismatch.");
}

function validateIdentityAndReferences(
  brief: Pick<InvestigationBrief, "issues" | "missingFacts" | "sourceRequirements" | "dependencies">,
): void {
  requireUnique(brief.issues.map((issue) => issue.issueId), "InvestigationIssue IDs");
  requireUnique(brief.missingFacts.map((fact) => fact.factId), "MissingFactNeed IDs");
  requireUnique(brief.sourceRequirements.map((item) => item.requirementId), "SourceRequirement IDs");
  requireUnique(brief.dependencies.map((item) => item.dependencyId), "InvestigationDependency IDs");
  validateReferences(brief);
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
  validateBindings(parsed, expected);
  validateIdentityAndReferences(parsed);
  return Object.freeze(structuredClone(parsed));
}

function validateModelInvestigationBrief(
  raw: unknown,
  expected: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
): InvestigationBriefProposal {
  const parsed = modelInvestigationBriefSchema.parse(raw);
  validateBindings(parsed, expected);
  validateIdentityAndReferences(parsed);
  const { createdAt: _untrustedCreatedAt, ...proposal } = parsed;
  return Object.freeze(structuredClone(proposal)) as InvestigationBriefProposal;
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
  readonly now?: () => Date;
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
          "Produce exactly one JSON InvestigationBrief proposal and do not answer the user's objective.",
          "Preserve runId, intentVersionId, and objective exactly as supplied; plannerKind must be exactly " + plannerKind + ".",
          "Use this complete structure; arrays contain objects, not strings:",
          '{"briefId":"string","runId":"string","intentVersionId":"string","objective":"string","issues":[{"issueId":"string","question":"string","materiality":"MATERIAL|CONTEXTUAL","rationale":"string"}],"missingFacts":[{"factId":"string","question":"string","acquisitionMode":"USER_ONLY|RESEARCHABLE|UNKNOWN","materiality":"MATERIAL|CONTEXTUAL","rationale":"string"}],"sourceRequirements":[{"requirementId":"string","issueIds":["issueId"],"authorityNeed":"PRIMARY_OR_OFFICIAL|HIGH_QUALITY_SECONDARY|GENERAL_ORIENTATION|UNKNOWN","jurisdictionNeeded":true,"currentnessNeeded":true,"description":"string"}],"dependencies":[{"dependencyId":"string","blockedIssueId":"issueId","dependsOnIssueIds":["issueId"],"dependsOnFactIds":["factId"],"rationale":"string"}],"plannerKind":"string"}.',
          "Do not include createdAt; Lattice creates the accepted timestamp after validating model-controlled content.",
          "All issueId, factId, requirementId, and dependencyId values must be unique within their own collections.",
          "Every SourceRequirement.issueIds entry must reference an existing issueId and each SourceRequirement must reference at least one issue.",
          "Every dependency.blockedIssueId must reference an existing issue; dependsOnIssueIds and dependsOnFactIds must reference existing IDs, contain no duplicates, and must not include the blockedIssueId itself. Do not create dangling or self references.",
          "MATERIAL means the item could materially change applicability, scope, or the investigation outcome; CONTEXTUAL means useful background that should not be treated as a necessary blocker.",
          "USER_ONLY means Lattice cannot reliably obtain the fact through external research and must ultimately obtain it from the user or user-controlled context; RESEARCHABLE means Lattice should investigate it rather than burden the user; UNKNOWN means the acquisition burden cannot yet be classified responsibly.",
          "PRIMARY_OR_OFFICIAL means governing, first-party, or official authority is needed; HIGH_QUALITY_SECONDARY means reputable expert synthesis is appropriate; GENERAL_ORIENTATION means broad orientation is sufficient; UNKNOWN means the needed authority level cannot yet be determined.",
          "Set jurisdictionNeeded true only when correct evidence or applicability materially depends on jurisdiction or location. Set currentnessNeeded true only when the evidence must reflect a current or time-sensitive state.",
          "Dependencies are real investigation-order relationships: blockedIssueId identifies the issue that cannot yet be resolved, and the dependency arrays identify exactly which existing issues or facts it depends on. Do not add decorative dependencies.",
          "Identify a bounded investigation: material hidden issues, minimum missing facts, useful source characteristics, and meaningful dependencies. Do not turn every useful contextual fact into a material blocker.",
          "Do not state conclusions, truth verdicts, governing rules as established facts, invented user preferences or requirements, decisions, execution authorization, or permission to act.",
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
  private readonly now: () => Date;

  constructor(
    private readonly runtime: ModelRuntime,
    options: ModelGatewayKnowledgeInvestigationPlannerOptions,
  ) {
    this.kind = options.plannerKind ?? "model-gateway-investigation-brief-v0.1";
    this.model = options.model;
    this.maxOutputTokens = options.maxOutputTokens ?? 2_000;
    this.now = options.now ?? (() => new Date());
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
    const proposal = validateModelInvestigationBrief(raw, input);
    if (proposal.plannerKind !== this.kind) throw new Error("InvestigationBrief planner binding mismatch.");
    const brief = validateInvestigationBrief({
      ...proposal,
      createdAt: this.now().toISOString(),
    }, input);
    if (brief.plannerKind !== this.kind) throw new Error("InvestigationBrief planner binding mismatch.");
    return brief;
  }
}
