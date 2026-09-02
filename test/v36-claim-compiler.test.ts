import assert from "node:assert/strict";
import test from "node:test";
import { compileClaim } from "../src/truth/claim-compiler.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import type { ClaimQualifier, ClaimType } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000936";

const claimTypes: ClaimType[] = [
  "FACTUAL",
  "CAUSAL",
  "QUANTITATIVE",
  "CURRENT_STATE",
  "INTERPRETIVE",
  "AUTHENTICITY",
  "OPINION",
];

test("claim compiler deterministically preserves every represented material qualifier", () => {
  const qualifiers: ClaimQualifier[] = [
    { key: "currency", value: "USD" },
    { key: "quoted-speaker", value: "Example Speaker" },
  ];
  const input = {
    runId,
    sourceClaimId: "source-claim-1",
    text: "Qualified material assertion",
    claimType: "QUANTITATIVE" as const,
    scope: "Colorado residents",
    effectiveAt: "2026-08-25T12:00:00.000Z",
    jurisdiction: "US-CO",
    unit: "%",
    denominator: "eligible residents",
    baseline: "2025 annual baseline",
    period: "2026-Q3",
    causalRelation: "increases",
    authenticityTarget: "signed source document",
    comparisonClass: "peer jurisdictions",
    quotedContext: "The surrounding quoted passage remains part of the truth condition.",
    qualifiers,
    evidenceRisk: "HIGH" as const,
  };

  const first = compileClaim(input);
  const second = compileClaim(input);

  assert.deepEqual(second, first);
  assert.deepEqual(first.claim, {
    id: first.claim.id,
    runId,
    text: input.text,
    claimType: "QUANTITATIVE",
    scope: input.scope,
    effectiveAt: input.effectiveAt,
    jurisdiction: input.jurisdiction,
    unit: input.unit,
    denominator: input.denominator,
    baseline: input.baseline,
    period: input.period,
    causalRelation: input.causalRelation,
    authenticityTarget: input.authenticityTarget,
    comparisonClass: input.comparisonClass,
    quotedContext: input.quotedContext,
    qualifiers,
    evidenceRisk: "HIGH",
  });
  assert.deepEqual(first.requiredProofKinds, requiredProofObligations("QUANTITATIVE"));
});

test("claim type binds the exact deterministic V36 proof contract during compilation", () => {
  for (const claimType of claimTypes) {
    const result = compileClaim({
      runId,
      sourceClaimId: `claim-${claimType}`,
      text: `Material ${claimType} assertion`,
      claimType,
    });
    assert.deepEqual(result.requiredProofKinds, requiredProofObligations(claimType));
  }
});

test("compiled qualifiers are copied so caller mutation cannot rewrite compiled truth state", () => {
  const qualifiers: ClaimQualifier[] = [{ key: "scope-detail", value: "original" }];
  const result = compileClaim({
    runId,
    sourceClaimId: "copy-test",
    text: "Material assertion",
    claimType: "FACTUAL",
    qualifiers,
  });

  qualifiers[0]!.value = "mutated";
  qualifiers.push({ key: "later", value: "added" });

  assert.deepEqual(result.claim.qualifiers, [{ key: "scope-detail", value: "original" }]);
});

test("claim compiler rejects blank identifiers, assertion text, and typed qualifier entries", () => {
  assert.throws(
    () => compileClaim({ runId: " ", sourceClaimId: "claim", text: "fact", claimType: "FACTUAL" }),
    /runId must not be blank/,
  );
  assert.throws(
    () => compileClaim({ runId, sourceClaimId: " ", text: "fact", claimType: "FACTUAL" }),
    /sourceClaimId must not be blank/,
  );
  assert.throws(
    () => compileClaim({ runId, sourceClaimId: "claim", text: " ", claimType: "FACTUAL" }),
    /text must not be blank/,
  );
  assert.throws(
    () => compileClaim({
      runId,
      sourceClaimId: "claim",
      text: "fact",
      claimType: "FACTUAL",
      qualifiers: [{ key: " ", value: "value" }],
    }),
    /qualifiers\[0\]\.key must not be blank/,
  );
  assert.throws(
    () => compileClaim({
      runId,
      sourceClaimId: "claim",
      text: "fact",
      claimType: "FACTUAL",
      qualifiers: [{ key: "context", value: " " }],
    }),
    /qualifiers\[0\]\.value must not be blank/,
  );
});
