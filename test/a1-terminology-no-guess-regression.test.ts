import assert from "node:assert/strict";
import test from "node:test";
import { ConservativeConsultationInterpreter } from "../src/intent/consultation-interpreter.js";

test("A1 terminology clarification does not hard-code or guess an acronym expansion", async () => {
  const interpreter = new ConservativeConsultationInterpreter();

  const tic = await interpreter.interpret({
    message: "How can TIC affect my taxes?",
    context: [],
  });
  assert.equal(tic.objectiveEffect.kind, "ESTABLISH");
  assert.equal(tic.objectiveEffect.kind === "ESTABLISH" ? tic.objectiveEffect.value : "", "How can TIC affect my taxes?");
  assert.equal(tic.clarificationQuestion, "What does “TIC” mean in this question?");
  assert.doesNotMatch(tic.clarificationQuestion ?? "", /tenancy|common/iu);

  const dso = await interpreter.interpret({
    message: "How does DSO affect cash flow?",
    context: [],
  });
  assert.equal(dso.clarificationQuestion, "What does “DSO” mean in this question?");
  assert.doesNotMatch(dso.clarificationQuestion ?? "", /days|sales|outstanding/iu);

  const explicit = await interpreter.interpret({
    message: "How does DSO (days sales outstanding) affect cash flow?",
    context: [],
  });
  assert.equal(explicit.clarificationQuestion, undefined);
  assert.equal(
    explicit.objectiveEffect.kind === "ESTABLISH" ? explicit.objectiveEffect.value : "",
    "How does DSO (days sales outstanding) affect cash flow?",
  );
});
