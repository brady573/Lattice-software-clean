import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchTaskExecutor } from "../src/research-worker.js";
import {
  runStandaloneResearchWorkerProcess,
  UnavailableResearchTaskExecutor,
  type StandaloneResearchWorkerOptions,
} from "../src/research-worker-process.js";

test("standalone Research process API accepts one qualified executor without changing its environment contract", () => {
  const executor: ResearchTaskExecutor = {
    async execute() {
      return { kind: "fixture" };
    },
  };
  const options: StandaloneResearchWorkerOptions = { executor };
  const runner: (
    env?: NodeJS.ProcessEnv,
    options?: StandaloneResearchWorkerOptions,
  ) => Promise<void> = runStandaloneResearchWorkerProcess;

  assert.equal(options.executor, executor);
  assert.equal(runner, runStandaloneResearchWorkerProcess);
});

test("standalone Research process retains the fail-closed unavailable executor when no qualified driver is supplied", async () => {
  const unavailable = new UnavailableResearchTaskExecutor();
  await assert.rejects(
    () => unavailable.execute(),
    /No qualified research execution driver is configured/,
  );
});
