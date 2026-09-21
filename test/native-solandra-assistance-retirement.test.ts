import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createOwnerAccessSubjectResolver, OWNER_SUBJECT_ID } from "../src/auth/owner-access.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type { SolandraCognitionInput, SolandraCognitionResult, SolandraCognitiveRuntime } from "../src/solandra/cognition.js";

const TOKEN = "native-solandra-owner-" + "x".repeat(40);
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "native-solandra-test",
  requestedModel: "native-solandra-test",
  actualProvider: "native-solandra-test",
  actualModel: "native-solandra-test",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "native-solandra-test-request",
  routeProvenance: "COMPLETE",
});

class GenericConversationCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    return {
      mode: "CONVERSATION",
      response: `Handled naturally: ${input.message}`,
      invocationProvenance: PROVENANCE,
    };
  }
}

test("canonical Product contains no predecessor assistance routing, controls, or registration", async () => {
  const [cognition, intake, index, ui, http] = await Promise.all([
    readFile("src/solandra/cognition.ts", "utf8"),
    readFile("src/consultation-intake.ts", "utf8"),
    readFile("src/index.ts", "utf8"),
    readFile("src/ui/solandra-authoritative-conversation-page.ts", "utf8"),
    readFile("src/http-app.ts", "utf8"),
  ]);
  for (const source of [cognition, intake, index, ui, http]) {
    assert.doesNotMatch(source, /COGNITIVE_ASSISTANCE|user-model|model-assistance/iu);
  }
  assert.doesNotMatch(index, /CapabilityBroker|ModelAssistanceCapabilityService/u);
  assert.doesNotMatch(http, /preSerialization|knowledgeSimplifier/u);
});

test("neutral authenticated session probe is fail-closed and independent of capability authorization", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_AUTHENTICATION_MODE: "required",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    authenticatedSubjectResolver: createOwnerAccessSubjectResolver(TOKEN),
  });
  try {
    for (const headers of [
      undefined,
      { authorization: "Bearer invalid-native-solandra-owner-token-000000000000" },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/session",
        ...(headers ? { headers } : {}),
      });
      assert.equal(response.statusCode, 401, response.body);
      assert.deepEqual(response.json(), { error: "AUTHENTICATION_REQUIRED" });
    }

    const headers = { authorization: `Bearer ${TOKEN}` };
    const authenticated = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers });
    assert.equal(authenticated.statusCode, 200, authenticated.body);
    assert.deepEqual(authenticated.json(), { authenticated: true, subjectId: OWNER_SUBJECT_ID });

    for (const url of ["/api/v1/capabilities/user-model", "/api/v1/capabilities/model-assistance"]) {
      const absent = await app.inject({ method: "GET", url, headers });
      assert.equal(absent.statusCode, 404, absent.body);
    }
  } finally {
    await app.close();
  }
});

test("ordinary Solandra conversation needs no assistance connection across held-out task shapes", async () => {
  const cognition = new GenericConversationCognition();
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { solandraCognition: cognition });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const messages = [
      "Give me a few ways to organize a weekend maker project.",
      "Draft a short note using only what I just told you.",
      "Rewrite my sentence so it is clearer but keeps my meaning.",
      "Explain the distinction in plain language without looking anything up.",
      "Suppose the deadline moved forward by a week; how would the plan change?",
      "Turn my notes into a compact checklist.",
      "Back to the maker project: summarize the options we discussed.",
    ];
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]!;
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: `ordinary-held-out-${index}`, message },
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json<{ status: string; presentation: { assistantMessage: string }; runId?: string }>();
      assert.equal(body.status, "CONVERSATION_COMPLETED");
      assert.equal(body.presentation.assistantMessage, `Handled naturally: ${message}`);
      assert.equal(body.runId, undefined);
    }
    assert.equal(cognition.inputs.length, messages.length);
    assert.ok(cognition.inputs.at(-1)?.recentConversation?.some((turn) =>
      turn.role === "USER" && turn.content.includes("maker project")
    ));
  } finally {
    await app.close();
  }
});
