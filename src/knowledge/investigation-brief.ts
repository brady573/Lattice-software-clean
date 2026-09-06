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
  createdAt: z.unknown().optional(),
}).strict();

const investigationBriefStructuredOutputSchema = {
  type: "object",
  properties: {
    briefId: { type: "string" },
    runId: { type: "string" },
    intentVersionId: { type: "string" },
    objective: { type: "string" },
    issues: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          issueId: { type: "string" },
          question: { type: "string" },
          materiality: { type: "string", enum: ["MATERIAL", "CONTEXTUAL"] },
          rationale: { type: "string" },
        },
        required: ["issueId", "question", "materiality", "rationale"],
        additionalProperties: false,
      },
    },
    missingFacts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          factId: { type: "string" },
          question: { type: "string" },
          acquisitionMode: { type: "string", enum: ["USER_ONLY", "RESEARCHABLE", "UNKNOWN"] },
          materiality: { type: "string", enum: ["MATERIAL", "CONTEXTUAL"] },
          rationale: { type: "string" },
        },
        required: ["factId", "question", "acquisitionMode", "materiality", "rationale"],
        additionalProperties: false,
      },
    },
    sourceRequirements: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          requirementId: { type: "string" },
          issueIds: { type: "array", maxItems: 8, items: { type: "string" } },
          authorityNeed: {
            type: "string",
            enum: ["PRIMARY_OR_OFFICIAL", "HIGH_QUALITY_SECONDARY", "GENERAL_ORIENTATION", "UNKNOWN"],
          },
          jurisdictionNeeded: { type: "boolean" },
          currentnessNeeded: { type: "boolean" },
          description: { type: "string" },
        },
        required: [
          "requirementId",
          "issueIds",
          "authorityNeed",
          "jurisdictionNeeded",
          "currentnessNeeded",
          "description",
        ],
        additionalProperties: false,
      },
    },
    dependencies: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          dependencyId: { type: "string" },
          blockedIssueId: { type: "string" },
          dependsOnIssueIds: { type: "array", maxItems: 8, items: { type: "string" } },
          dependsOnFactIds: { type: "array", maxItems: 8, items: { type: "string" } },
          rationale: { type: "string" },
        },
        required: [
          "dependencyId",
          "blockedIssueId",
          "dependsOnIssueIds",
          "dependsOnFactIds",
          "rationale",
        ],
        additionalProperties: false,
      },
    },
    plannerKind: { type: "string" },
  },
  required: [
    "briefId",
    "runId",
    "intentVersionId",
    "objective",
    "issues",
    "missingFacts",
    "sourceRequirements",
    "dependencies",
    "plannerKind",
  ],
  additionalProperties: false,
} as const;

type InvestigationBriefProposal = Omit<InvestigationBrief, "createdAt">;

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique IDs.`);
  }
}

function validateAcyclicIssueDependencies(dependencies: readonly InvestigationDependency[]): void {
  const graph = new Map<string, readonly string[]>();
  for (const dependency of dependencies) {
    const existing = graph.get(dependency.blockedIssueId) ?? [];
    graph.set(dependency.blockedIssueId, [...existing, ...dependency.dependsOnIssueIds]);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (issueId: string): void => {
    if (visited.has(issueId)) return;
    if (visiting.has(issueId)) {
      throw new Error("InvestigationDependency issue graph must be acyclic.");
    }
    visiting.add(issueId);
    for (const dependencyIssueId of graph.get(issueId) ?? []) visit(dependencyIssueId);
    visiting.delete(issueId);
    visited.add(issueId);
  };

  for (const issueId of graph.keys()) visit(issueId);
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

  validateAcyclicIssueDependencies(brief.dependencies);
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

const semanticStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "before", "behind", "by", "can", "could",
  "do", "does", "for", "from", "has", "have", "how", "in", "into", "is", "it", "of",
  "on", "or", "relative", "run", "runs", "the", "this", "through", "to", "what", "where",
  "which", "with", "within", "would",
]);

const locatorTokens = new Set([
  "account", "contact", "email", "filename", "handle", "identifier", "link", "metadata",
  "path", "reference", "source", "url",
]);

const jurisdictionPattern =
  /\b(jurisdiction|state|province|city|county|country|municipality|municipal|region|district|zip(?:\s+code)?|postal\s+code)\b/iu;

const scopedLocationPattern =
  /(?:\b(?:applicable|business|governing|home|operation|project|property|site)\b.{0,48}\b(?:location|located)\b|\b(?:location|located)\b.{0,48}\b(?:business|home|operation|project|property|site)\b)/iu;

const publicRulePattern =
  /\b(building|code|compliance|law|legal|licen[cs](?:e|ing)|local|municipal|permit|regulation|regulatory|rule|tax|zoning)\b/iu;

const speculativeDependencyPattern = /\b(could|generally|likely|may|might|often|possibly|typically|usually)\b/iu;

function normalizeSemanticToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

function semanticTokens(value: string): Set<string> {
  const raw = value
    .toLowerCase()
    .replace(/[’']/gu, "")
    .match(/[a-z0-9]+/gu) ?? [];
  return new Set(
    raw
      .map(normalizeSemanticToken)
      .filter((token) => token.length > 1 && !semanticStopWords.has(token)),
  );
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function semanticJaccard(leftText: string, rightText: string): number {
  const left = semanticTokens(leftText);
  const right = semanticTokens(rightText);
  if (left.size === 0 || right.size === 0) return 0;
  const common = overlapCount(left, right);
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : common / union;
}

function candidateCoverage(text: string, candidate: string): number {
  const textTokens = semanticTokens(text);
  const candidateTokens = semanticTokens(candidate);
  if (candidateTokens.size === 0) return 0;
  return overlapCount(textTokens, candidateTokens) / candidateTokens.size;
}

function substantiallyRestates(left: string, right: string): boolean {
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  const common = overlapCount(leftTokens, rightTokens);
  return common >= 2 && semanticJaccard(left, right) >= 0.72;
}

function cleanCandidateLabel(value: string): string {
  return value
    .trim()
    .replace(/^[,;:\s]+|[,;:\s]+$/gu, "")
    .replace(/^(?:the|a|an)\s+/iu, "")
    .trim();
}

function splitUnavailableSpan(span: string): string[] {
  return span
    .split(/\s+(?:and|or)\s+/iu)
    .map(cleanCandidateLabel)
    .filter((item) => item.length > 1 && item.length <= 160);
}

function extractExplicitUserControlledUnavailableContent(input: KnowledgeInvestigationPlanningInput): string[] {
  const text = [input.objective, ...input.context].join(" ");
  const candidates: string[] = [];
  const active =
    /\b(?:i|we)\s+(?:have\s+not|haven['’]t|did\s+not|didn['’]t)\s+(?:shared?|provided?|supplied?|included?|attached?|given)\s+([^.!?]+)/giu;
  const passive =
    /\b((?:the|my|our)\s+[^.!?]{1,120}?)\s+(?:has|have|is|are|was|were)\s+not\s+(?:been\s+)?(?:shared|provided|supplied|included|attached|given)\b/giu;

  for (const pattern of [active, passive]) {
    for (const match of text.matchAll(pattern)) {
      const span = match[1];
      if (span === undefined) continue;
      candidates.push(...splitUnavailableSpan(span));
    }
  }
  return [...new Set(candidates)];
}

function nextSyntheticId(prefix: string, usedIds: Set<string>): string {
  for (let index = 1; index <= 100; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Unable to allocate synthetic InvestigationBrief ID for ${prefix}.`);
}

function isLocatorFact(fact: MissingFactNeed): boolean {
  const tokens = semanticTokens(`${fact.question} ${fact.rationale}`);
  for (const token of locatorTokens) {
    if (tokens.has(token)) return true;
  }
  return false;
}

function issueCandidateScore(issue: InvestigationIssue, candidate: string): number {
  const issueText = `${issue.question} ${issue.rationale}`;
  const issueTokens = semanticTokens(issueText);
  const candidateTokens = semanticTokens(candidate);
  const common = overlapCount(issueTokens, candidateTokens);
  if (common === 0) return 0;
  const coverage = common / Math.max(1, candidateTokens.size);
  if (common < 2 && !(candidateTokens.size === 1 && coverage === 1)) return 0;
  return common * 10 + coverage * 5 + semanticJaccard(issueText, candidate);
}

function ensureFactDependency(
  dependencies: InvestigationDependency[],
  blockedIssueId: string,
  factId: string,
  usedDependencyIds: Set<string>,
  rationale: string,
): void {
  const existingIndex = dependencies.findIndex((dependency) => dependency.blockedIssueId === blockedIssueId);
  if (existingIndex >= 0) {
    const dependency = dependencies[existingIndex]!;
    if (!dependency.dependsOnFactIds.includes(factId)) {
      dependencies[existingIndex] = {
        ...dependency,
        dependsOnFactIds: [...dependency.dependsOnFactIds, factId],
      };
    }
    return;
  }
  if (dependencies.length >= 12) {
    throw new Error("Semantic normalization requires a blocking dependency but the dependency budget is exhausted.");
  }
  dependencies.push({
    dependencyId: nextSyntheticId("dependency-semantic-prerequisite", usedDependencyIds),
    blockedIssueId,
    dependsOnIssueIds: [],
    dependsOnFactIds: [factId],
    rationale,
  });
}

function normalizeExplicitPrivatePrerequisites(
  issues: InvestigationIssue[],
  missingFacts: MissingFactNeed[],
  dependencies: InvestigationDependency[],
  input: KnowledgeInvestigationPlanningInput,
  usedFactIds: Set<string>,
  usedDependencyIds: Set<string>,
): void {
  const candidates = extractExplicitUserControlledUnavailableContent(input);
  if (candidates.length === 0) return;

  for (let issueIndex = 0; issueIndex < issues.length; issueIndex += 1) {
    const issue = issues[issueIndex]!;
    if (issue.materiality !== "MATERIAL") continue;

    let selected: string | null = null;
    let selectedScore = 0;
    for (const candidate of candidates) {
      const score = issueCandidateScore(issue, candidate);
      if (score > selectedScore) {
        selected = candidate;
        selectedScore = score;
      }
    }
    if (selected === null || selectedScore === 0) continue;

    const directExistingIndex = missingFacts.findIndex((fact) =>
      !isLocatorFact(fact) && candidateCoverage(`${fact.question} ${fact.rationale}`, selected!) >= 0.75
    );
    let directFactId: string;
    if (directExistingIndex >= 0) {
      const direct = missingFacts[directExistingIndex]!;
      directFactId = direct.factId;
      missingFacts[directExistingIndex] = {
        ...direct,
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale:
          "The supplied context establishes that this private content has not been provided, and the material issue cannot be interpreted without the content itself.",
      };
    } else {
      if (missingFacts.length >= 8) {
        throw new Error("Semantic normalization requires a private prerequisite but the missing-fact budget is exhausted.");
      }
      directFactId = nextSyntheticId("fact-explicit-private-content", usedFactIds);
      missingFacts.push({
        factId: directFactId,
        question: `What is the unavailable ${cleanCandidateLabel(selected)}?`,
        acquisitionMode: "USER_ONLY",
        materiality: "MATERIAL",
        rationale:
          "The supplied context establishes that this private content has not been provided, and the material issue cannot be interpreted without the content itself.",
      });
    }

    const issueCoverage = candidateCoverage(issue.question, selected);
    const issueTokenCount = semanticTokens(issue.question).size;
    const candidateTokenCount = semanticTokens(selected).size;
    if (issueCoverage >= 0.8 && issueTokenCount <= candidateTokenCount + 5) {
      issues[issueIndex] = {
        ...issue,
        question: `What requirements or constraints in the unavailable ${cleanCandidateLabel(selected)} materially govern the objective?`,
        rationale:
          "The unavailable private content must be obtained before its material requirements or constraints can be interpreted.",
      };
    }

    const locatorIds = new Set<string>();
    for (let factIndex = 0; factIndex < missingFacts.length; factIndex += 1) {
      const fact = missingFacts[factIndex]!;
      if (
        fact.factId !== directFactId
        && fact.acquisitionMode === "USER_ONLY"
        && fact.materiality === "MATERIAL"
        && isLocatorFact(fact)
        && candidateCoverage(fact.question, selected) < 0.5
      ) {
        locatorIds.add(fact.factId);
        missingFacts[factIndex] = {
          ...fact,
          materiality: "CONTEXTUAL",
          rationale:
            "This private locator may be useful for retrieval, but the supplied context does not establish it as the minimum blocker when the needed private content itself is unavailable.",
        };
      }
    }

    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
      const dependency = dependencies[dependencyIndex]!;
      if (dependency.blockedIssueId !== issue.issueId) continue;
      dependencies[dependencyIndex] = {
        ...dependency,
        dependsOnFactIds: [
          ...dependency.dependsOnFactIds.filter((factId) => !locatorIds.has(factId) && factId !== directFactId),
          directFactId,
        ],
      };
    }

    ensureFactDependency(
      dependencies,
      issue.issueId,
      directFactId,
      usedDependencyIds,
      "The material issue cannot be interpreted until the explicitly unavailable private content is supplied.",
    );
  }
}

function hasSuppliedJurisdictionHint(input: KnowledgeInvestigationPlanningInput): boolean {
  const text = [input.objective, ...input.context].join(" ");
  return (
    /\b(?:jurisdiction|state|province|city|county|country|municipality|region)\s*(?::|is)\s*[A-Z0-9]/u.test(text)
    || /\b(?:home|property|business|site|operation|project)\s+(?:is\s+)?(?:located|based)?\s*in\s+[A-Z][A-Za-z0-9 .,'-]{2,80}/u.test(text)
    || /\b(?:located|based|operating)\s+in\s+[A-Z][A-Za-z0-9 .,'-]{2,80}/u.test(text)
  );
}

function isJurisdictionFact(fact: MissingFactNeed): boolean {
  const text = `${fact.question} ${fact.rationale}`;
  return jurisdictionPattern.test(text) || scopedLocationPattern.test(text);
}

function inputEstablishesUserControlledJurisdiction(input: KnowledgeInvestigationPlanningInput): boolean {
  return extractExplicitUserControlledUnavailableContent(input).some((candidate) =>
    jurisdictionPattern.test(candidate) || scopedLocationPattern.test(candidate)
  );
}

function normalizeJurisdictionResearchKeys(
  issues: InvestigationIssue[],
  missingFacts: MissingFactNeed[],
  sourceRequirements: SourceRequirement[],
  dependencies: InvestigationDependency[],
  input: KnowledgeInvestigationPlanningInput,
  usedFactIds: Set<string>,
  usedDependencyIds: Set<string>,
): void {
  if (hasSuppliedJurisdictionHint(input)) return;
  const issueById = new Map(issues.map((issue) => [issue.issueId, issue]));
  const jurisdictionBoundIssueIds = new Set<string>();

  for (const requirement of sourceRequirements) {
    if (!requirement.jurisdictionNeeded) continue;
    for (const issueId of requirement.issueIds) {
      const issue = issueById.get(issueId);
      if (issue === undefined) continue;
      const semanticText = `${issue.question} ${issue.rationale} ${requirement.description}`;
      if (publicRulePattern.test(semanticText)) jurisdictionBoundIssueIds.add(issueId);
    }
  }
  if (jurisdictionBoundIssueIds.size === 0) return;

  let jurisdictionFact = missingFacts.find(isJurisdictionFact);
  const userControlledJurisdiction = inputEstablishesUserControlledJurisdiction(input);
  if (jurisdictionFact === undefined) {
    if (missingFacts.length >= 8) {
      throw new Error("Semantic normalization requires a jurisdiction key but the missing-fact budget is exhausted.");
    }
    jurisdictionFact = {
      factId: nextSyntheticId("fact-jurisdiction-scope", usedFactIds),
      question: "What jurisdiction or location governs the applicable public rules?",
      acquisitionMode: userControlledJurisdiction ? "USER_ONLY" : "UNKNOWN",
      materiality: "MATERIAL",
      rationale: userControlledJurisdiction
        ? "The supplied context explicitly establishes the governing location as unavailable user-controlled information required before jurisdiction-dependent public research can proceed."
        : "The plan calls for jurisdiction-dependent public research, but the supplied context does not identify the governing jurisdiction or establish who can provide or discover it.",
    };
    missingFacts.push(jurisdictionFact);
  } else {
    const jurisdictionIndex = missingFacts.findIndex((fact) => fact.factId === jurisdictionFact!.factId);
    const normalizedJurisdiction: MissingFactNeed = {
      ...jurisdictionFact,
      acquisitionMode: userControlledJurisdiction ? "USER_ONLY" : "UNKNOWN",
      materiality: "MATERIAL",
      rationale: userControlledJurisdiction
        ? "The supplied context explicitly establishes the governing location as unavailable user-controlled information required before jurisdiction-dependent public research can proceed."
        : "Jurisdiction-dependent public research requires this scoping key, but the supplied context does not establish who can provide or discover it.",
    };
    missingFacts[jurisdictionIndex] = normalizedJurisdiction;
    jurisdictionFact = normalizedJurisdiction;
  }

  for (const issueId of jurisdictionBoundIssueIds) {
    ensureFactDependency(
      dependencies,
      issueId,
      jurisdictionFact.factId,
      usedDependencyIds,
      "Jurisdiction-dependent public research is not actionable until the governing jurisdiction is known.",
    );
  }
}

function pruneUnsupportedDependencies(
  issues: InvestigationIssue[],
  missingFacts: MissingFactNeed[],
  dependencies: InvestigationDependency[],
): InvestigationDependency[] {
  const issueById = new Map(issues.map((issue) => [issue.issueId, issue]));
  const factById = new Map(missingFacts.map((fact) => [fact.factId, fact]));
  const pruned: InvestigationDependency[] = [];

  for (const dependency of dependencies) {
    const blockedIssue = issueById.get(dependency.blockedIssueId);
    if (blockedIssue === undefined) continue;

    const restatementFactIds = dependency.dependsOnFactIds.filter((factId) => {
      const fact = factById.get(factId);
      return fact !== undefined && substantiallyRestates(blockedIssue.question, fact.question);
    });

    const retainedFactIds = dependency.dependsOnFactIds.filter((factId) => !restatementFactIds.includes(factId));
    let retainedIssueIds = dependency.dependsOnIssueIds.filter((issueId) => {
      const prerequisiteIssue = issueById.get(issueId);
      return prerequisiteIssue !== undefined && !substantiallyRestates(blockedIssue.question, prerequisiteIssue.question);
    });

    if (restatementFactIds.length > 0) {
      retainedIssueIds = [];
    } else if (
      retainedFactIds.length === 0
      && retainedIssueIds.length > 0
      && speculativeDependencyPattern.test(dependency.rationale)
    ) {
      retainedIssueIds = [];
    }

    if (retainedFactIds.length === 0 && retainedIssueIds.length === 0) continue;
    pruned.push({
      ...dependency,
      dependsOnIssueIds: retainedIssueIds,
      dependsOnFactIds: retainedFactIds,
    });
  }

  return pruned;
}

function normalizeInvestigationBriefProposal(
  proposal: InvestigationBriefProposal,
  input: KnowledgeInvestigationPlanningInput,
): InvestigationBriefProposal {
  const issues = proposal.issues.map((issue) => ({ ...issue }));
  const missingFacts = proposal.missingFacts.map((fact) => ({ ...fact }));
  const sourceRequirements = proposal.sourceRequirements.map((requirement) => ({
    ...requirement,
    issueIds: [...requirement.issueIds],
  }));
  let dependencies: InvestigationDependency[] = proposal.dependencies.map((dependency) => ({
    ...dependency,
    dependsOnIssueIds: [...dependency.dependsOnIssueIds],
    dependsOnFactIds: [...dependency.dependsOnFactIds],
  }));
  const usedFactIds = new Set(missingFacts.map((fact) => fact.factId));
  const usedDependencyIds = new Set(dependencies.map((dependency) => dependency.dependencyId));

  normalizeExplicitPrivatePrerequisites(
    issues,
    missingFacts,
    dependencies,
    input,
    usedFactIds,
    usedDependencyIds,
  );
  normalizeJurisdictionResearchKeys(
    issues,
    missingFacts,
    sourceRequirements,
    dependencies,
    input,
    usedFactIds,
    usedDependencyIds,
  );
  dependencies = pruneUnsupportedDependencies(issues, missingFacts, dependencies);

  return Object.freeze(structuredClone({
    ...proposal,
    issues,
    missingFacts,
    sourceRequirements,
    dependencies,
  })) as InvestigationBriefProposal;
}

export function investigationBriefIsCurrent(
  brief: InvestigationBrief,
  current: Pick<KnowledgeInvestigationPlanningInput, "runId" | "intentVersionId" | "objective">,
): boolean {
  return brief.runId === current.runId
    && brief.intentVersionId === current.intentVersionId
    && brief.objective === current.objective;
}

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
    structuredOutput: {
      type: "json_schema",
      schema: investigationBriefStructuredOutputSchema,
    },
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
          "Every dependency.blockedIssueId must reference an existing issue; dependsOnIssueIds and dependsOnFactIds must reference existing IDs, contain no duplicates, and must not include the blockedIssueId itself. Do not create dangling or self references. Do not create cyclic issue dependencies.",
          "MATERIAL means the item could materially change applicability, scope, or the investigation outcome; CONTEXTUAL means useful background that should not be treated as a necessary blocker.",
          "USER_ONLY means Lattice cannot reliably obtain the fact through external research and must ultimately obtain it from the user or user-controlled context; RESEARCHABLE means Lattice should investigate it rather than burden the user; UNKNOWN means the acquisition burden cannot yet be classified responsibly.",
          "Classify acquisition burden independently from materiality. If a missing user-controlled or private prerequisite is the minimum fact required before a MATERIAL public issue can be identified, located, scoped, or interpreted, mark that prerequisite USER_ONLY and MATERIAL when that blocking burden is established. If responsibility, availability, or user control cannot be established, use UNKNOWN rather than guessing.",
          "Do not mark a fact USER_ONLY merely because asking the user would be convenient. A fact that is publicly discoverable from the supplied context is RESEARCHABLE and remains Lattice's research burden.",
          "Before marking a fact RESEARCHABLE, verify that Lattice can actually pursue that research from the supplied context. If public research first requires a missing user-controlled or private prerequisite needed to identify, locate, scope, or interpret the target, represent only that minimum prerequisite separately as USER_ONLY and MATERIAL when established, or UNKNOWN when acquisition responsibility cannot yet be classified; do not substitute downstream research questions, incidental source metadata, or contact details for the prerequisite itself.",
          "PRIMARY_OR_OFFICIAL means governing, first-party, or official authority is needed; HIGH_QUALITY_SECONDARY means reputable expert synthesis is appropriate; GENERAL_ORIENTATION means broad orientation is sufficient; UNKNOWN means the needed authority level cannot yet be determined.",
          "Set jurisdictionNeeded true only when correct evidence or applicability materially depends on jurisdiction or location. Set currentnessNeeded true only when the evidence must reflect a current or time-sensitive state.",
          "Dependencies express one-way blocking, not relevance, topical association, or merely useful investigation order. Emit an issue dependency only when the blocked issue cannot be scoped or resolved until the prerequisite issue is resolved; emit a fact dependency only when the blocked issue cannot be scoped or resolved until that fact is known.",
          "Never encode mutual informational relevance as reciprocal dependencies. For any pair of issues, choose a single defensible blocking direction only when one genuinely blocks the other; if neither blocks the other, omit the edge. Keep dependencies minimal and omit decorative, speculative, or redundant edges.",
          "Identify a bounded investigation: include only the smallest materially decision-relevant set of hidden issues and prerequisite facts needed to remove the user's knowledge barrier. When the objective is overbroad, narrow the investigation instead of enumerating everything conceivable or filling the output budget. Do not turn every useful contextual fact into a material blocker.",
          "Before returning, verify that every emitted reference resolves to an emitted ID and that issue dependencies are acyclic and minimal. Remove reciprocal, decorative, and unsupported edges; if a blocking direction cannot be defended, omit the dependency rather than guess or invent a reference.",
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
    const normalizedProposal = normalizeInvestigationBriefProposal(proposal, input);
    const brief = validateInvestigationBrief({
      ...normalizedProposal,
      createdAt: this.now().toISOString(),
    }, input);
    if (brief.plannerKind !== this.kind) throw new Error("InvestigationBrief planner binding mismatch.");
    return brief;
  }
}
