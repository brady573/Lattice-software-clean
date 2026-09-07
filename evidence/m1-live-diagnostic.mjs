import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const candidateRoot = process.env.CANDIDATE_ROOT;
assert.ok(candidateRoot, "CANDIDATE_ROOT is required");
assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required");
const moduleUrl = (path) => pathToFileURL(resolve(candidateRoot, "dist", "src", path)).href;
const [{ resolveRuntimeConfig }, { createConfiguredSolandraCognition }] = await Promise.all([
  import(moduleUrl("runtime-config.js")),
  import(moduleUrl("solandra/cognition-composition.js")),
]);
const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m1-live-proof-user",
});
const configured = createConfiguredSolandraCognition(config);
assert.ok(configured, "Configured Solandra cognition is required");
const runtime = configured.cognition.runtime;
assert.ok(runtime && typeof runtime.call === "function", "Diagnostic could not access the cognition runtime.");
const originalCall = runtime.call.bind(runtime);
runtime.call = async (...args) => {
  const result = await originalCall(...args);
  const output = result.response.output.map((item) => item.type === "text" ? item.text : `[${item.type}]`);
  process.stdout.write(`M1_RAW_COGNITION_OUTPUT=${JSON.stringify(output)}\n`);
  const provenance = result.audit.invocationProvenance;
  process.stdout.write(`M1_RAW_COGNITION_PROVENANCE=${JSON.stringify({
    executionClass: provenance.executionClass,
    routeMode: provenance.routeMode,
    actualProvider: provenance.actualProvider,
    actualModel: provenance.actualModel,
    upstreamRequestId: provenance.upstreamRequestId,
    routeProvenance: provenance.routeProvenance,
  })}\n`);
  return result;
};

try {
  const result = await configured.cognition.interpret({
    conversationId: "m1-live-diagnostic",
    messageId: "m1-live-diagnostic-message",
    message: "Why do banana slices turn brown after cutting?",
    recentUserMessages: ["Why do banana slices turn brown after cutting?"],
    governedKnowledge: [],
  });
  process.stdout.write(`M1_PARSED_COGNITION=${JSON.stringify(result.proposal)}\n`);
} catch (error) {
  process.stdout.write(`M1_COGNITION_REJECTION=${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
}
