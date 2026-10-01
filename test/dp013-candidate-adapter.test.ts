import assert from "node:assert/strict";
import test from "node:test";
import { qualifyAction } from "../src/action/qualify.js";
import { projectCandidateToAction } from "../src/solandra/action-candidate.js";

test("dp013_projection_maps_action_only", () => {
  assert.deepEqual(projectCandidateToAction({ action: "Ring the clinic" }), {
    action: "Ring the clinic",
    facts: [],
    factRefs: [],
  });
});

test("dp013_projection_absent_stays_absent", () => {
  assert.equal(projectCandidateToAction(undefined), undefined);
});

test("dp013_projection_drops_whitespace_action", () => {
  assert.equal(projectCandidateToAction({ action: "   " }), undefined);
});

test("dp013_projection_forwards_no_evidence_fields", () => {
  const projected = projectCandidateToAction({
    action: "Ring the clinic",
    expectedOutcome: "An appointment is booked",
    verification: "Check the confirmation message",
  });
  assert.deepEqual(projected, { action: "Ring the clinic", facts: [], factRefs: [] });
  assert.equal(projected?.facts.length, 0);
});

test("dp013_projection_unknown_by_construction", () => {
  const projected = projectCandidateToAction({ action: "Ring the clinic" });
  assert.notEqual(projected, undefined);
  if (projected === undefined) return;
  const qualification = qualifyAction({ candidate: projected, qualifiedFacts: [] });
  assert.equal(qualification.consequence, "UNKNOWN");
  assert.equal(qualification.reversibility, "UNKNOWN");
  assert.equal(qualification.support, "UNKNOWN");
});

test("dp013_projection_deterministic", () => {
  const proposal = {
    action: "Ring the clinic",
    expectedOutcome: "An appointment is booked",
  } as const;
  const first = projectCandidateToAction({ ...proposal });
  const second = projectCandidateToAction({ ...proposal });
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
});
