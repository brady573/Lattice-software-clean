import assert from "node:assert/strict";
import test from "node:test";
import { executeEvidencePlan } from "../src/truth/orchestrator.js";

test("Issue #52: omitted maxAttempts keeps the existing single-attempt default", async () => {
  let attempts = 0;
  await assert.rejects(
    executeEvidencePlan([{
      id: "default",
      dependsOn: [],
      execute: async () => {
        attempts += 1;
        throw new Error("terminal");
      },
    }]),
    /failed after 1 attempt\(s\): terminal/,
  );
  assert.equal(attempts, 1);
});

test("Issue #52: maxAttempts 2 succeeds on the second attempt and reports two attempts", async () => {
  let attempts = 0;
  const result = await executeEvidencePlan([{
    id: "retry-success",
    dependsOn: [],
    maxAttempts: 2,
    execute: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return "ok";
    },
  }]);

  assert.equal(attempts, 2);
  assert.equal(result.results.get("retry-success")?.attempts, 2);
  assert.equal(result.results.get("retry-success")?.value, "ok");
});

test("Issue #52: maxAttempts 2 exhausts after exactly two failed attempts", async () => {
  let attempts = 0;
  await assert.rejects(
    executeEvidencePlan([{
      id: "retry-exhausted",
      dependsOn: [],
      maxAttempts: 2,
      execute: async () => {
        attempts += 1;
        throw new Error("still failing");
      },
    }]),
    /failed after 2 attempt\(s\): still failing/,
  );
  assert.equal(attempts, 2);
});

for (const [label, maxAttempts] of [
  ["zero", 0],
  ["negative", -1],
  ["fractional", 1.5],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
] as const) {
  test(`Issue #52: ${label} maxAttempts fails before any evidence task executes`, async () => {
    let invalidExecutions = 0;
    let siblingExecutions = 0;

    await assert.rejects(
      executeEvidencePlan([
        {
          id: `invalid-${label}`,
          dependsOn: [],
          maxAttempts,
          execute: async () => {
            invalidExecutions += 1;
            return "invalid";
          },
        },
        {
          id: "valid-sibling",
          dependsOn: [],
          execute: async () => {
            siblingExecutions += 1;
            return "sibling";
          },
        },
      ]),
      new RegExp(`Evidence task invalid-${label} maxAttempts .* must be a positive safe integer\\.`),
    );

    assert.equal(invalidExecutions, 0);
    assert.equal(siblingExecutions, 0);
  });
}

test("Issue #52: Number.MAX_SAFE_INTEGER remains a valid retry count without an invented upper cap", async () => {
  let attempts = 0;
  const result = await executeEvidencePlan([{
    id: "large-safe",
    dependsOn: [],
    maxAttempts: Number.MAX_SAFE_INTEGER,
    execute: async () => {
      attempts += 1;
      return "ok";
    },
  }]);

  assert.equal(attempts, 1);
  assert.equal(result.results.get("large-safe")?.attempts, 1);
  assert.equal(result.results.get("large-safe")?.value, "ok");
});
