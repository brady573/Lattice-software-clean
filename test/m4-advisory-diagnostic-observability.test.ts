import assert from "node:assert/strict";
import test from "node:test";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  type GroqCompletionDiagnostic,
} from "../src/model/groq-knowledge-simplifier.js";

const API_KEY = "gsk_test_diagnostic_key_1234567890";

function responseBody(content: string) {
  return JSON.stringify({
    id: "chatcmpl-diagnostic",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 111, completion_tokens: 37, total_tokens: 148 },
  });
}

test("M4 advisory transport diagnostic is opt-in, exact, bounded metadata and credential-free", async () => {
  const diagnostics: GroqCompletionDiagnostic[] = [];
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: API_KEY,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
    fetchImpl: async (_input, init) => {
      assert.match(String(init?.headers && JSON.stringify(init.headers)), /authorization/iu);
      return new Response(responseBody("not-json diagnostic content"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await provider.generate({
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "diagnostic request" }],
    temperature: 0,
    maxOutputTokens: 2_000,
    seed: 0,
  }, {
    correlationId: "m4-diagnostic",
    requestIdentity: "request-identity",
    attempt: 0,
    signal: new AbortController().signal,
  });

  assert.equal(result.response instanceof Object, true);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    content: "not-json diagnostic content",
    finishReason: "stop",
    promptTokens: 111,
    completionTokens: 37,
    totalTokens: 148,
    upstreamRequestId: "chatcmpl-diagnostic",
  });
  assert.equal(JSON.stringify(diagnostics[0]).includes(API_KEY), false);
  assert.equal(result.metadata?.finishReason, "stop");
  assert.equal(result.metadata?.completionTokens, 37);
});

test("M4 advisory transport diagnostic is inert when no sink is supplied", async () => {
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: API_KEY,
    fetchImpl: async () => new Response(responseBody('{"status":"INSUFFICIENT_BASIS","reason":"bounded","uncertainties":[]}'), { status: 200 }),
  });

  const result = await provider.generate({
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "ordinary request" }],
  }, {
    correlationId: "m4-diagnostic-inert",
    requestIdentity: "request-identity-inert",
    attempt: 0,
    signal: new AbortController().signal,
  });

  assert.equal((result.response as { model: string }).model, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
});
