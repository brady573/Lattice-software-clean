import { z } from "zod";
import { QualifiedCriterionCatalog, type CriterionDefinition } from "./criterion-catalog.js";
import {
  hardRequirementOperatorSchema,
  priorityTierSchema,
} from "./priority-and-requirements.js";

const criterionRefSchema = z.object({
  criterionId: z.string().trim().min(1).max(200),
}).strict();

export const decisionIntentRequirementSchema = criterionRefSchema.extend({
  operator: hardRequirementOperatorSchema,
  expected: z.union([z.number().finite(), z.string(), z.boolean()]),
}).strict();

export const decisionIntentPrioritySchema = criterionRefSchema.extend({
  tier: priorityTierSchema,
}).strict();

export const decisionIntentToleranceSchema = criterionRefSchema.extend({
  kind: z.literal("ABSOLUTE"),
  maximumDifference: z.number().finite().nonnegative(),
}).strict();

export const exactDecisionIntentSemanticsSchema = z.object({
  intentScopeId: z.string().trim().min(1).max(200),
  intentVersionId: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(2_000),
  hardRequirements: z.array(decisionIntentRequirementSchema),
  priorities: z.array(decisionIntentPrioritySchema),
  tolerances: z.array(decisionIntentToleranceSchema),
}).strict();

export const decisionInputCriterionBindingSchema = z.object({
  criterionId: z.string().trim().min(1).max(200),
  criterionVersion: z.number().int().positive(),
}).strict();

export const decisionInputSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  intentScopeId: z.string().trim().min(1).max(200),
  intentVersionId: z.string().trim().min(1).max(200),
  criterionCatalogVersion: z.number().int().positive(),
  objective: z.string().trim().min(1).max(2_000),
  hardRequirements: z.array(z.object({
    criterionId: z.string().trim().min(1).max(200),
    criterionVersion: z.number().int().positive(),
    operator: hardRequirementOperatorSchema,
    expected: z.union([z.number().finite(), z.string(), z.boolean()]),
  }).strict()),
  priorities: z.array(z.object({
    criterionId: z.string().trim().min(1).max(200),
    criterionVersion: z.number().int().positive(),
    tier: priorityTierSchema,
  }).strict()),
  tolerances: z.array(z.object({
    intentScopeId: z.string().trim().min(1).max(200),
    intentVersionId: z.string().trim().min(1).max(200),
    criterionId: z.string().trim().min(1).max(200),
    criterionVersion: z.number().int().positive(),
    kind: z.literal("ABSOLUTE"),
    maximumDifference: z.number().finite().nonnegative(),
  }).strict()),
  criterionBindings: z.array(decisionInputCriterionBindingSchema),
}).strict();

export type ExactDecisionIntentSemantics = z.infer<typeof exactDecisionIntentSemanticsSchema>;
export type DecisionInputSnapshot = Readonly<z.infer<typeof decisionInputSnapshotSchema>>;

function assertExpectedType(definition: CriterionDefinition, expected: string | number | boolean): void {
  const actual = typeof expected;
  const valid = definition.valueType === "NUMBER"
    ? actual === "number"
    : definition.valueType === "STRING"
      ? actual === "string"
      : actual === "boolean";
  if (!valid) {
    throw new Error(
      `Hard requirement value type does not match qualified CriterionDefinition ${definition.criterionId}@${definition.version}.`,
    );
  }
}

function requireLatest(catalog: QualifiedCriterionCatalog, criterionId: string): CriterionDefinition {
  const definition = catalog.getLatest(criterionId);
  if (!definition) {
    throw new Error(`No qualified CriterionDefinition exists for ${criterionId} in catalog ${catalog.catalogVersion}.`);
  }
  return definition;
}

function assertUniqueCriterionRefs(kind: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${kind} criterion reference: ${id}.`);
    seen.add(id);
  }
}

/**
 * Resolve already-authoritative structured USER meaning against one immutable,
 * qualified Criterion Catalog snapshot.
 *
 * This function does not interpret natural language, infer priority tiers, admit
 * evidence, or make a decision. Intent Authority must establish the supplied
 * semantics first; the catalog supplies criterion semantics/version authority.
 */
export function buildDecisionInputSnapshot(
  intentInput: ExactDecisionIntentSemantics,
  catalog: QualifiedCriterionCatalog,
): DecisionInputSnapshot {
  const intent = exactDecisionIntentSemanticsSchema.parse(intentInput);
  assertUniqueCriterionRefs("hard requirement", intent.hardRequirements.map((entry) => entry.criterionId));
  assertUniqueCriterionRefs("priority", intent.priorities.map((entry) => entry.criterionId));
  assertUniqueCriterionRefs("tolerance", intent.tolerances.map((entry) => entry.criterionId));

  const definitions = new Map<string, CriterionDefinition>();
  const resolve = (criterionId: string): CriterionDefinition => {
    const existing = definitions.get(criterionId);
    if (existing) return existing;
    const definition = requireLatest(catalog, criterionId);
    definitions.set(criterionId, definition);
    return definition;
  };

  const hardRequirements = intent.hardRequirements.map((entry) => {
    const definition = resolve(entry.criterionId);
    assertExpectedType(definition, entry.expected);
    return {
      criterionId: definition.criterionId,
      criterionVersion: definition.version,
      operator: entry.operator,
      expected: entry.expected,
    };
  });

  const priorities = intent.priorities.map((entry) => {
    const definition = resolve(entry.criterionId);
    return {
      criterionId: definition.criterionId,
      criterionVersion: definition.version,
      tier: entry.tier,
    };
  });

  const tolerances = intent.tolerances.map((entry) => {
    const definition = resolve(entry.criterionId);
    if (definition.valueType !== "NUMBER" || definition.preferenceDirection === "MATCH_ONLY") {
      throw new Error(`USER tolerance requires a comparable numeric CriterionDefinition: ${definition.criterionId}@${definition.version}.`);
    }
    return {
      intentScopeId: intent.intentScopeId,
      intentVersionId: intent.intentVersionId,
      criterionId: definition.criterionId,
      criterionVersion: definition.version,
      kind: entry.kind,
      maximumDifference: entry.maximumDifference,
    };
  });

  const criterionBindings = [...definitions.values()]
    .sort((left, right) => left.criterionId.localeCompare(right.criterionId))
    .map((definition) => ({ criterionId: definition.criterionId, criterionVersion: definition.version }));

  return Object.freeze(decisionInputSnapshotSchema.parse({
    schemaVersion: 1,
    intentScopeId: intent.intentScopeId,
    intentVersionId: intent.intentVersionId,
    criterionCatalogVersion: catalog.catalogVersion,
    objective: intent.objective,
    hardRequirements,
    priorities,
    tolerances,
    criterionBindings,
  }));
}
