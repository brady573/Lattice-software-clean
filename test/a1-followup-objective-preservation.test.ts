import assert from "node:assert/strict";
import test from "node:test";
import { ConservativeConsultationInterpreter } from "../src/intent/consultation-interpreter.js";
import type { IntentVersion } from "../src/intent/types.js";

const currentIntentVersion = {
  intentVersionId: "22222222-2222-4222-8222-222222222222",
  intentScopeId: "consultation:a1-follow-up",
  version: 1,
  transitionId: "33333333-3333-4333-8333-333333333333",
  state: {
    objective: {
      value: { state: "VALUE", value: "Why does cast iron rust?" },
    },
  },
} as unknown as IntentVersion;

test("A1 knowledge follow-ups remain non-authoritative context instead of replacing objective", async () => {
  const interpreter = new ConservativeConsultationInterpreter();
  for (const message of ["Why?", "Explain that more simply.", "What are your sources?"]) {
    const proposal = await interpreter.interpret({
      message,
      context: [],
      currentIntentVersion,
    });
    assert.deepEqual(proposal.objectiveEffect, { kind: "PRESERVE" });
    assert.equal(proposal.decisionRequested, false);
  }
});
