import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalModelToolCallOutput } from "../src/model/types.js";
import {
  CapabilityExecutionError,
  executeCapabilityProposal,
  type CapabilityBindingState,
  type CapabilityExecutor,
  type CapabilityGrant,
  type CapabilityStateGuard,
} from "../src/capability-execution-policy.js";

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    runId: "run-1",
    subjectId: "subject-1",
    intentVersionId: "intent-v1",
    role: "RESEARCH",
    tool: {
      name: "lookup",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    maxCalls: 2,
    timeoutMs: 100,
    maxInputBytes: 1024,
    maxOutputBytes: 1024,
    egress: { kind: "ALLOWLIST", origins: ["https://example.test"] },
    idempotency: "IDEMPOTENT",
    ...overrides,
  };
}

function proposal(overrides: Partial<CanonicalModelToolCallOutput> = {}): CanonicalModelToolCallOutput {
  return {
    type: "tool_call",
    id: "call-1",
    name: "lookup",
    arguments: { query: "bounded query", limit: 3 },
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    proposal: proposal(),
    operationId: "operation-1",
    runId: "run-1",
    subjectId: "subject-1",
    intentVersionId: "intent-v1",
    role: "RESEARCH" as const,
    callNumber: 1,
    ...overrides,
  };
}

function guard(states: CapabilityBindingState[] = ["ACTIVE"]): CapabilityStateGuard {
  let index = 0;
  return {
    async check() {
      const state = states[Math.min(index, states.length - 1)] ?? "ACTIVE";
      index += 1;
      return state;
    },
  };
}

function executor(fn?: CapabilityExecutor["execute"]): CapabilityExecutor {
  return {
    async execute(context) {
      if (fn) return await fn(context);
      return { ok: true, query: context.arguments.query, egress: context.egress.kind };
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: CapabilityExecutionError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CapabilityExecutionError);
    assert.equal(error.code, code);
    return true;
  });
}

test("M9-2 executes only an exactly granted proposal with bounded Product-owned context", async () => {
  let seen = 0;
  const result = await executeCapabilityProposal(
    grant(),
    request(),
    guard(["ACTIVE", "ACTIVE"]),
    executor(async (context) => {
      seen += 1;
      assert.equal(context.runId, "run-1");
      assert.equal(context.subjectId, "subject-1");
      assert.equal(context.intentVersionId, "intent-v1");
      assert.equal(context.role, "RESEARCH");
      assert.deepEqual(context.egress, { kind: "ALLOWLIST", origins: ["https://example.test"] });
      assert.deepEqual(context.arguments, { query: "bounded query", limit: 3 });
      return { rows: ["a"] };
    }),
  );
  assert.equal(seen, 1);
  assert.equal(result.reused, false);
  assert.deepEqual(result.result, { rows: ["a"] });
});

test("M9-2 rejects undeclared tools and malformed or over-budget arguments before execution", async () => {
  let calls = 0;
  const fake = executor(async () => { calls += 1; return { ok: true }; });

  await expectCode(
    executeCapabilityProposal(grant(), request({ proposal: proposal({ name: "shell" }) }), guard(), fake),
    "UNDECLARED_CAPABILITY",
  );
  await expectCode(
    executeCapabilityProposal(
      grant(),
      request({ proposal: proposal({ arguments: { limit: 2 } }) }),
      guard(),
      fake,
    ),
    "INVALID_ARGUMENTS",
  );
  await expectCode(
    executeCapabilityProposal(
      grant(),
      request({ proposal: proposal({ arguments: { query: "x", extra: true } }) }),
      guard(),
      fake,
    ),
    "INVALID_ARGUMENTS",
  );
  await expectCode(
    executeCapabilityProposal(grant(), request({ callNumber: 3 }), guard(), fake),
    "BUDGET_EXCEEDED",
  );
  assert.equal(calls, 0);
});

test("M9-2 fails closed for stale Run, superseded intent, unavailable subject, and deletion state", async () => {
  for (const state of ["STALE_RUN", "SUPERSEDED_INTENT", "SUBJECT_UNAVAILABLE", "DELETED"] as const) {
    let calls = 0;
    await expectCode(
      executeCapabilityProposal(
        grant(),
        request(),
        guard([state]),
        executor(async () => { calls += 1; return { ok: true }; }),
      ),
      "BINDING_INACTIVE",
    );
    assert.equal(calls, 0, `${state} must block dispatch`);
  }
});

test("M9-2 rechecks Product binding after execution before releasing a result", async () => {
  let calls = 0;
  await expectCode(
    executeCapabilityProposal(
      grant(),
      request(),
      guard(["ACTIVE", "DELETED"]),
      executor(async () => { calls += 1; return { observed: true }; }),
    ),
    "BINDING_CHANGED_AFTER_EXECUTION",
  );
  assert.equal(calls, 1);
});

test("M9-2 preserves exact Run, subject, IntentVersion, and role binding", async () => {
  for (const override of [
    { runId: "run-2" },
    { subjectId: "subject-2" },
    { intentVersionId: "intent-v2" },
    { role: "MODEL_ASSISTANCE" as const },
  ]) {
    await expectCode(
      executeCapabilityProposal(grant(), request(override), guard(), executor()),
      "BINDING_MISMATCH",
    );
  }
});

test("M9-2 reuses a durable successful operation instead of duplicating semantic work", async () => {
  let calls = 0;
  const result = await executeCapabilityProposal(
    grant(),
    request({
      priorOperation: {
        operationId: "operation-1",
        state: "SUCCEEDED",
        result: { cached: true },
      },
    }),
    guard(["ACTIVE"]),
    executor(async () => { calls += 1; return { duplicated: true }; }),
  );
  assert.equal(calls, 0);
  assert.equal(result.reused, true);
  assert.deepEqual(result.result, { cached: true });
});

test("M9-2 refuses blind redispatch after ambiguous non-idempotent completion", async () => {
  let calls = 0;
  await expectCode(
    executeCapabilityProposal(
      grant({ idempotency: "NON_IDEMPOTENT" }),
      request({ priorOperation: { operationId: "operation-1", state: "AMBIGUOUS" } }),
      guard(),
      executor(async () => { calls += 1; return { duplicated: true }; }),
    ),
    "AMBIGUOUS_REDISPATCH",
  );
  assert.equal(calls, 0);
});

test("M9-2 allows an explicitly idempotent ambiguous operation to be redispatched under the same identity", async () => {
  let calls = 0;
  const result = await executeCapabilityProposal(
    grant({ idempotency: "IDEMPOTENT" }),
    request({ priorOperation: { operationId: "operation-1", state: "AMBIGUOUS" } }),
    guard(["ACTIVE", "ACTIVE"]),
    executor(async (context) => {
      calls += 1;
      assert.equal(context.operationId, "operation-1");
      return { recovered: true };
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.reused, false);
});

test("M9-2 cancellation and timeout remain operational failures, not execution authority", async () => {
  const cancelled = new AbortController();
  cancelled.abort(new Error("user cancelled"));
  await expectCode(
    executeCapabilityProposal(grant(), request({ signal: cancelled.signal }), guard(), executor()),
    "CANCELLED",
  );

  await expectCode(
    executeCapabilityProposal(
      grant({ timeoutMs: 5 }),
      request(),
      guard(["ACTIVE"]),
      executor(async () => await new Promise(() => undefined)),
    ),
    "TIMEOUT",
  );
});

test("M9-2 rejects generalized or ambiguous network grants and bounds output bytes", async () => {
  await expectCode(
    executeCapabilityProposal(
      grant({ egress: { kind: "ALLOWLIST", origins: ["https://*.example.test"] } }),
      request(),
      guard(),
      executor(),
    ),
    "INVALID_GRANT",
  );
  await expectCode(
    executeCapabilityProposal(
      grant({ egress: { kind: "ALLOWLIST", origins: ["http://example.test"] } }),
      request(),
      guard(),
      executor(),
    ),
    "INVALID_GRANT",
  );
  await expectCode(
    executeCapabilityProposal(
      grant({ maxOutputBytes: 4 }),
      request(),
      guard(["ACTIVE"]),
      executor(async () => ({ too: "large" })),
    ),
    "OUTPUT_TOO_LARGE",
  );
});
