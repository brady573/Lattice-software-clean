import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicKnowledgeInvestigationQueryDeriver } from "../src/knowledge/investigation.js";

const CASES = [
  {
    objective: "I need to know how to prepare my soil for sod.",
    required: [/prepare/iu, /soil/iu, /sod/iu],
  },
  {
    objective: "I need to know how to season a cast iron skillet.",
    required: [/season/iu, /cast/iu, /iron/iu, /skillet/iu],
  },
] as const;

test("procedural Knowledge queries discard conversational framing while preserving task meaning", () => {
  const deriver = new DeterministicKnowledgeInvestigationQueryDeriver();

  for (const scenario of CASES) {
    const queries = deriver.derive({ objective: scenario.objective, context: [] });
    assert.ok(queries.length >= 1 && queries.length <= 2);
    assert.ok(
      queries.some((query) => scenario.required.every((pattern) => pattern.test(query))),
      `Expected a task-specific procedural query for: ${scenario.objective}`,
    );
    for (const query of queries) {
      assert.doesNotMatch(query, /\bneed\b/iu);
      assert.doesNotMatch(query, /\bfor\b/iu);
    }
  }
});
