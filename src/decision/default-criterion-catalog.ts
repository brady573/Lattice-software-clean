import { QualifiedCriterionCatalog } from "./criterion-catalog.js";

/**
 * Deployment-registered qualified criteria available to the generalized
 * Decision Engine. This module is Criterion Catalog data, not USER-message
 * interpretation: Intent Authority supplies which criterion ids a USER
 * referenced, and this catalog is the sole authority for their qualified
 * value type, preference direction, and meaningful-difference semantics.
 */
export const defaultCriterionCatalog = new QualifiedCriterionCatalog(1, [
  {
    criterionId: "price",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "LOWER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
  {
    criterionId: "batteryHours",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 0.5 },
  },
  {
    criterionId: "performance",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
]);
