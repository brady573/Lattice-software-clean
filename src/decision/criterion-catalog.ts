import { z } from "zod";

export const criterionValueTypeSchema = z.enum(["NUMBER", "STRING", "BOOLEAN"]);
export const preferenceDirectionSchema = z.enum(["HIGHER_IS_BETTER", "LOWER_IS_BETTER", "MATCH_ONLY"]);

export const meaningfulDifferenceSchema = z.object({
  kind: z.literal("ABSOLUTE"),
  minimum: z.number().finite().nonnegative(),
}).strict();

export const criterionDefinitionSchema = z.object({
  criterionId: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  valueType: criterionValueTypeSchema,
  preferenceDirection: preferenceDirectionSchema,
  meaningfulDifference: meaningfulDifferenceSchema,
}).strict().superRefine((definition, context) => {
  if (definition.valueType !== "NUMBER" && definition.preferenceDirection !== "MATCH_ONLY") {
    context.addIssue({
      code: "custom",
      path: ["preferenceDirection"],
      message: "Non-numeric criteria must use MATCH_ONLY preference semantics.",
    });
  }
});

export type CriterionValueType = z.infer<typeof criterionValueTypeSchema>;
export type PreferenceDirection = z.infer<typeof preferenceDirectionSchema>;
export type MeaningfulDifference = z.infer<typeof meaningfulDifferenceSchema>;
export type CriterionDefinition = Readonly<z.infer<typeof criterionDefinitionSchema>>;

function definitionKey(criterionId: string, version: number): string {
  return `${criterionId}@${version}`;
}

function freezeDefinition(definition: z.infer<typeof criterionDefinitionSchema>): CriterionDefinition {
  return Object.freeze({
    ...definition,
    meaningfulDifference: Object.freeze({ ...definition.meaningfulDifference }),
  });
}

/**
 * Immutable, exact-version lookup surface for qualified Decision Engine criteria.
 *
 * The catalog deliberately performs no evidence admission, user-intent interpretation,
 * or scoring. Those semantics remain with V36, Intent Authority, and later bounded
 * Decision Engine slices respectively.
 */
export class QualifiedCriterionCatalog {
  readonly catalogVersion: number;
  readonly #byExactVersion: ReadonlyMap<string, CriterionDefinition>;
  readonly #latestByCriterion: ReadonlyMap<string, CriterionDefinition>;

  constructor(catalogVersion: number, definitions: readonly unknown[]) {
    if (!Number.isInteger(catalogVersion) || catalogVersion <= 0) {
      throw new Error("Criterion Catalog version must be a positive integer.");
    }
    if (definitions.length === 0) {
      throw new Error("Criterion Catalog must contain at least one qualified definition.");
    }

    const exact = new Map<string, CriterionDefinition>();
    const latest = new Map<string, CriterionDefinition>();
    for (const candidate of definitions) {
      const definition = freezeDefinition(criterionDefinitionSchema.parse(candidate));
      const key = definitionKey(definition.criterionId, definition.version);
      if (exact.has(key)) {
        throw new Error(`Duplicate CriterionDefinition version: ${key}.`);
      }
      exact.set(key, definition);
      const current = latest.get(definition.criterionId);
      if (!current || definition.version > current.version) {
        latest.set(definition.criterionId, definition);
      }
    }

    this.catalogVersion = catalogVersion;
    this.#byExactVersion = exact;
    this.#latestByCriterion = latest;
    Object.freeze(this);
  }

  getExact(criterionId: string, version: number): CriterionDefinition | undefined {
    return this.#byExactVersion.get(definitionKey(criterionId, version));
  }

  requireExact(criterionId: string, version: number): CriterionDefinition {
    const definition = this.getExact(criterionId, version);
    if (!definition) {
      throw new Error(`Unknown qualified CriterionDefinition: ${definitionKey(criterionId, version)}.`);
    }
    return definition;
  }

  getLatest(criterionId: string): CriterionDefinition | undefined {
    return this.#latestByCriterion.get(criterionId);
  }

  list(): readonly CriterionDefinition[] {
    return Object.freeze([...this.#byExactVersion.values()]);
  }
}
