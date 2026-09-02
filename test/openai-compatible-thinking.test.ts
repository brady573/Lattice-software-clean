import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  ModelRuntime,
  OpenAiCompatibleModelProvider,
  type CanonicalModelRequest,
} from "../src/model/index.js";

const request: CanonicalModelRequest = {
  model: "android-local-prototype",
  messages: [{ role: "user", content: "Reply with exactly: THINKING_DISABLED_OK" }],
  temperature: 0,
  maxOutputTokens: 128,
};

test("OpenAI-compatible local adapter disables thinking without treating loopback as offline proof", async () => {
  let observedTemplateKwargs: unknown;
  const server = http.createServer(async (incoming, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    observedTemplateKwargs = body.chat_template_kwargs;
    const templateKwargs = body.chat_template_kwargs as
      | { enable_thinking?: unknown }
      | undefined;
    const thinkingDisabled = templateKwargs?.enable_thinking === false;

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "local-thinking-probe",
      model: "android-local-prototype",
      choices: [{
        message: thinkingDisabled
          ? { role: "assistant", content: "THINKING_DISABLED_OK" }
          : {
              role: "assistant",
              content: "",
              reasoning_content: "thinking without licensed assistant content",
            },
      }],
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP test server address.");
  }

  try {
    const runtime = new ModelRuntime(new OpenAiCompatibleModelProvider({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    }));
    const result = await runtime.call(request, { correlationId: "thinking-disabled-regression" });

    assert.deepEqual(observedTemplateKwargs, { enable_thinking: false });
    assert.deepEqual(result.response.output, [{
      type: "text",
      text: "THINKING_DISABLED_OK",
    }]);
    assert.equal(result.audit.invocationProvenance.executionClass, null);
    assert.equal(result.audit.invocationProvenance.routeMode, null);
    assert.equal(result.audit.invocationProvenance.actualModel, "android-local-prototype");
    assert.equal(result.audit.invocationProvenance.routeProvenance, "MISSING");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
});
