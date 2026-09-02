import assert from "node:assert/strict";
import test from "node:test";
import { laptopFixture } from "../src/fixtures.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import {
  createV36NeedsResearch,
  type V36ResearchRequest,
} from "../src/truth/continuation.js";
import { defineV36ContinuationTasks } from "../src/v36-research-bridge.js";

test("V36 continuation maps deterministically to a dependency-preserving durable research DAG", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate("run-v36-bridge-map");
  const claimId = investigation.snapshot.bundle.claims[0]?.id;
  assert.ok(claimId);
  const requests: V36ResearchRequest[] = [
    {
      id: "request-primary",
      runId: investigation.snapshot.runId,
      claimId,
      parentRequestId: null,
      purpose: "PRIMARY_SOURCE",
      query: "Locate the primary source.",
      serialRound: 1,
    },
    {
      id: "request-disconfirm",
      runId: investigation.snapshot.runId,
      claimId,
      parentRequestId: "request-primary",
      purpose: "DISCONFIRM",
      query: "Seek disconfirming evidence after the primary source.",
      serialRound: 2,
    },
  ];
  const yielded = createV36NeedsResearch(investigation.snapshot, requests, 1);

  const first = defineV36ContinuationTasks(yielded.checkpoint);
  const second = defineV36ContinuationTasks(structuredClone(yielded.checkpoint));

  assert.deepEqual(second, first);
  assert.equal(first.tasks.length, 2);
  assert.equal(first.bindings.length, 2);
  assert.equal(first.tasks[0]?.dependsOn.length, 0);
  assert.deepEqual(first.tasks[1]?.dependsOn, [first.tasks[0]?.taskFingerprint]);
  assert.equal(first.tasks[0]?.planVersion, yielded.checkpoint.round);
  assert.equal(first.tasks[1]?.planVersion, yielded.checkpoint.round);
  assert.deepEqual(first.tasks[0]?.contextVersionIds, [`v36-checkpoint:${yielded.checkpoint.checkpointHash}`]);
  assert.equal(first.bindings[0]?.requestId, "request-primary");
  assert.equal(first.bindings[1]?.requestId, "request-disconfirm");
});
