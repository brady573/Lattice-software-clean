import assert from "node:assert/strict";
import test from "node:test";
import {
  QualifiedCriterionCatalog,
  criterionDefinitionSchema,
} from "../src/decision/criterion-catalog.js";

const priceV1 = {
  criterionId: "price.usd",
  version: 1,
  valueType: "NUMBER",
  preferenceDirection: "LOWER_IS_BETTER",
  meaningfulDifference: { kind: "ABSOLUTE", minimum: 25 },
} as const;

test("Criterion Catalog resolves exact immutable versions and an explicit latest view", () => {
  const priceV2 = {
    ...priceV1,
    version: 2,
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 10 },
  } as const;
  const catalog = new QualifiedCriterionCatalog(1, [priceV2, priceV1]);

  assert.equal(catalog.catalogVersion, 1);
  assert.deepEqual(catalog.requireExact("price.usd", 1), priceV1);
  assert.deepEqual(catalog.requireExact("price.usd", 2), priceV2);
  assert.equal(catalog.getLatest("price.usd")?.version, 2);
  assert.equal(Object.isFrozen(catalog.requireExact("price.usd", 1)), true);
  assert.equal(Object.isFrozen(catalog.requireExact("price.usd", 1).meaningfulDifference), true);
});

test("Criterion Catalog fails closed for unknown and duplicate versions", () => {
  const catalog = new QualifiedCriterionCatalog(3, [priceV1]);
  assert.equal(catalog.getExact("battery.hours", 1), undefined);
  assert.throws(
    () => catalog.requireExact("battery.hours", 1),
    /Unknown qualified CriterionDefinition: battery\.hours@1/,
  );
  assert.throws(
    () => new QualifiedCriterionCatalog(3, [priceV1, { ...priceV1 }]),
    /Duplicate CriterionDefinition version: price\.usd@1/,
  );
});

test("CriterionDefinition validation keeps non-numeric semantics bounded", () => {
  assert.throws(
    () => criterionDefinitionSchema.parse({
      criterionId: "color",
      version: 1,
      valueType: "STRING",
      preferenceDirection: "HIGHER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 0 },
    }),
    /Non-numeric criteria must use MATCH_ONLY/,
  );

  const parsed = criterionDefinitionSchema.parse({
    criterionId: "color",
    version: 1,
    valueType: "STRING",
    preferenceDirection: "MATCH_ONLY",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 0 },
  });
  assert.equal(parsed.preferenceDirection, "MATCH_ONLY");
});

test("Criterion Catalog rejects invalid catalog and definition versions", () => {
  assert.throws(
    () => new QualifiedCriterionCatalog(0, [priceV1]),
    /Catalog version must be a positive integer/,
  );
  assert.throws(
    () => new QualifiedCriterionCatalog(1, []),
    /must contain at least one qualified definition/,
  );
  assert.throws(
    () => new QualifiedCriterionCatalog(1, [{ ...priceV1, version: 0 }]),
  );
});
