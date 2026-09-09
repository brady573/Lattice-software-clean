import assert from "node:assert/strict";
import test from "node:test";
import type { IntentVersion } from "../src/intent/types.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import {
  ModelSolandraAdvisoryRuntime,
  type SolandraAdvisoryInput,
} from "../src/solandra/advisory.js";

const MODEL = "m4-framing-regression-model";
const OBJECTIVE = "Choose the quieter label based only on the USER's stated preference.";
const FIXED_TIME = "2026-09-09T03:00:00.000Z";

const INTENT: IntentVersion = {
  intentScopeId: "consultation:m4-framing-regression",
  intentVersionId: "intent-m4-framing-v1",
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: "transition-m4-framing-v1",
  lineageKind: "INITIAL",
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: "VALUE", value: OBJECTIVE },
      provenance: {
        kind: "EXPLICIT_USER",
        logicalUserTurnId: "turn-m4-framing",
        sourceMessageId: "message-m4-framing",
        sourceDigest: "b".repeat(64),
      },
    },
    requirements: {},
    preferences: {},
  },
  createdAt: FIXED_TIME,
};

function advisoryObject(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    status: "RECOMMENDATION",
    recommendation: "Prefer Later.",
    basis: [],
    rationale: ["It best fits the USER's stated preference."],
    tradeoffs: [],
    assumptions: ["The stated preference remains controlling."],
    uncertainties: [],
    preservedUncertainties: [],
    alternatives: ["Workbench"],
    ...overrides,
  };
}

function advisoryInput(): SolandraAdvisoryInput {
  return {
    conversationId: "m4-framing-regression",
    userMessageId: "message-m4-framing",
    authoritativeIntent: INTENT,
    authoritativeObjective: OBJECTIVE,
    userContext: [OBJECTIVE],
    knowledge: [],
  };
}

class RawAdvisoryProvider implements ModelProvider {
  readonly kind = "m4-raw-advisory-provider";
  calls = 0;

  constructor(private readonly advisoryText: string) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const grounding = (request.messages[0]?.content ?? "").includes("bounded grounding verifier");
    const text = grounding
      ? JSON.stringify({ status: "GROUNDED", unsupportedExternalPremises: [], knowledgeNeeds: [] })
      : this.advisoryText;
    return {
      response: {
        id: `m4-framing-${this.calls}`,
        model: request.model,
        output: [{ type: "text", text }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `m4-framing-${this.calls}`,
      },
    };
  }
}

async function expectAccepted(advisoryText: string): Promise<void> {
  const provider = new RawAdvisoryProvider(advisoryText);
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), MODEL);
  const result = await runtime.advise(advisoryInput());
  assert.equal(result.result.status, "RECOMMENDATION");
  assert.equal(provider.calls, 2);
}

async function expectRejected(advisoryText: string): Promise<void> {
  const provider = new RawAdvisoryProvider(advisoryText);
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), MODEL);
  await assert.rejects(runtime.advise(advisoryInput()));
  assert.equal(provider.calls, 1);
}

const VALID_OBJECT = JSON.stringify(advisoryObject());
const VALID_ARRAY = `[${VALID_OBJECT}]`;

test("M4 advisory framing accepts an existing valid single-element array", async () => {
  await expectAccepted(VALID_ARRAY);
});

test("M4 advisory framing accepts an existing valid direct object", async () => {
  await expectAccepted(VALID_OBJECT);
});

test("M4 advisory framing normalizes exactly one extra trailing array bracket", async () => {
  await expectAccepted(`${VALID_ARRAY}]`);
});

test("M4 advisory framing rejects two extra trailing array brackets", async () => {
  await expectRejected(`${VALID_ARRAY}]]`);
});

test("M4 advisory framing rejects a direct object followed by an unmatched bracket", async () => {
  await expectRejected(`${VALID_OBJECT}]`);
});

test("M4 advisory framing rejects multiple advisory objects despite one extra trailing bracket", async () => {
  await expectRejected(`[${VALID_OBJECT},${VALID_OBJECT}]]`);
});

test("M4 advisory framing recovery does not bypass strict advisory schema validation", async () => {
  const invalidSchemaObject = JSON.stringify(advisoryObject({ unexpectedField: true }));
  await expectRejected(`[${invalidSchemaObject}]]`);
});

test("M4 advisory framing rejects prose before an otherwise valid array", async () => {
  await expectRejected(`explanation ${VALID_ARRAY}]`);
});

test("M4 advisory framing rejects trailing prose after the observed bracket defect", async () => {
  await expectRejected(`${VALID_ARRAY}] explanation`);
});

test("M4 advisory framing keeps otherwise malformed JSON fail-closed", async () => {
  await expectRejected('[{"status":]');
});
