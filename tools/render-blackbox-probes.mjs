import http from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_TARGET = "https://lattice-main-blackbox.onrender.com";
const DEFAULT_HEALTH_ATTEMPTS = 12;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 5_000;

function expect(condition, message, detail) {
  if (!condition) {
    throw new Error(`${message}: ${JSON.stringify(detail)}`);
  }
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createBlackboxClient({
  base = process.env.BLACKBOX_TARGET ?? DEFAULT_TARGET,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  return async function call(method, path, body) {
    const response = await fetchImpl(base + path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    log(`BLACKBOX_HTTP method=${method} path=${path} status=${response.status} body=${JSON.stringify(data)}`);
    return { status: response.status, data };
  };
}

export async function waitForTargetHealth({
  call,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = DEFAULT_HEALTH_ATTEMPTS,
  initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  log = console.log,
}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = await call("GET", "/health");
    } catch (error) {
      last = { error: error instanceof Error ? error.message : String(error) };
    }

    if (last?.status === 200) return last;

    const transient = last?.error !== undefined || [502, 503, 504].includes(last?.status);
    if (!transient || attempt === attempts) {
      throw new Error(`target health unavailable: ${JSON.stringify(last)}`);
    }

    const delayMs = Math.min(initialBackoffMs * 2 ** (attempt - 1), maxBackoffMs);
    log(`BLACKBOX_HEALTH_RETRY attempt=${attempt}/${attempts} delayMs=${delayMs} last=${JSON.stringify(last)}`);
    await sleep(delayMs);
  }

  throw new Error(`target health unavailable: ${JSON.stringify(last)}`);
}

export function assertHealthContract(health) {
  expect(health.status === 200, "health status", health);
  expect(
    health.data?.status === "ok" &&
      health.data?.mode === "fixture" &&
      health.data?.truth === "v36-offline" &&
      health.data?.lifecycle === "async-dispatch",
    "health contract",
    health.data,
  );
}

export async function createConversation(call, label) {
  const created = await call("POST", "/api/v1/conversations");
  expect(
    created.status === 201 && typeof created.data?.conversation?.id === "string",
    `${label} conversation creation`,
    created,
  );
  return created.data.conversation.id;
}

export async function runBlackboxProbes({
  base = process.env.BLACKBOX_TARGET ?? DEFAULT_TARGET,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  const call = createBlackboxClient({ base, fetchImpl, log });
  const health = await waitForTargetHealth({
    call,
    sleep,
    attempts: parsePositiveInteger(process.env.BLACKBOX_HEALTH_ATTEMPTS, DEFAULT_HEALTH_ATTEMPTS),
    initialBackoffMs: parsePositiveInteger(
      process.env.BLACKBOX_HEALTH_INITIAL_BACKOFF_MS,
      DEFAULT_INITIAL_BACKOFF_MS,
    ),
    maxBackoffMs: parsePositiveInteger(process.env.BLACKBOX_HEALTH_MAX_BACKOFF_MS, DEFAULT_MAX_BACKOFF_MS),
    log,
  });
  assertHealthContract(health);

  async function waitForRun(runId) {
    let last;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      last = await call("GET", `/api/v1/runs/${encodeURIComponent(runId)}`);
      if (last.status === 200 && ["COMPLETED", "FAILED", "CANCELLED"].includes(last.data?.status)) {
        return last;
      }
      await sleep(100);
    }
    throw new Error(`Run did not reach a terminal state: ${runId}; last=${JSON.stringify(last)}`);
  }

  const nonce = `bb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clearConversation = await createConversation(call, "clear");
  const clearScope = `${nonce}-clear-scope`;
  const clearBody = {
    turnId: `${nonce}-clear-turn`,
    messageId: `${nonce}-clear-message`,
    content: "I need a laptop under $1300 with at least 12 hours of battery life as a hard requirement. Performance matters more.",
  };
  const clearPath = `/api/v1/conversations/${encodeURIComponent(clearConversation)}/intent-scopes/${encodeURIComponent(clearScope)}/clear-user-messages`;
  const clear = await call("POST", clearPath, clearBody);
  expect(
    clear.status === 202 &&
      clear.data?.status === "RUN_ACCEPTED" &&
      clear.data?.clarificationRequired === false &&
      typeof clear.data?.runId === "string" &&
      typeof clear.data?.intentVersionId === "string",
    "clear intent acceptance",
    clear,
  );

  const clearReplay = await call("POST", clearPath, clearBody);
  expect(
    clearReplay.status === 202 &&
      clearReplay.data?.runId === clear.data.runId &&
      clearReplay.data?.intentVersionId === clear.data.intentVersionId,
    "clear USER-turn replay idempotency",
    { first: clear.data, replay: clearReplay.data },
  );

  const clearRun = await waitForRun(clear.data.runId);
  expect(clearRun.status === 200 && clearRun.data?.status === "COMPLETED", "clear run completion", clearRun);
  const clearResult = await call("GET", `/api/v1/runs/${encodeURIComponent(clear.data.runId)}/result`);
  expect(
    clearResult.status === 200 &&
      clearResult.data?.status === "COMPLETED" &&
      clearResult.data?.decision &&
      clearResult.data?.explanation,
    "clear result projection",
    clearResult,
  );

  const ambiguousConversation = await createConversation(call, "ambiguous");
  const ambiguousScope = `${nonce}-ambiguous-scope`;
  const ambiguousPath = `/api/v1/conversations/${encodeURIComponent(ambiguousConversation)}/intent-scopes/${encodeURIComponent(ambiguousScope)}/user-messages`;
  const ambiguous = await call("POST", ambiguousPath, {
    turnId: `${nonce}-ambiguous-turn`,
    messageId: `${nonce}-ambiguous-message`,
    content: "I need a laptop under $1300. I would like at least 12 hours of battery life, but performance matters more.",
  });
  expect(
    ambiguous.status === 202 &&
      ambiguous.data?.status === "NEEDS_CLARIFICATION" &&
      typeof ambiguous.data?.proposalId === "string" &&
      typeof ambiguous.data?.intentVersionId === "string",
    "material clarification",
    ambiguous,
  );

  const unsupportedConversation = await createConversation(call, "unsupported");
  const unsupported = await call(
    "POST",
    `/api/v1/conversations/${encodeURIComponent(unsupportedConversation)}/intent-scopes/${encodeURIComponent(`${nonce}-unsupported-scope`)}/user-messages`,
    {
      turnId: `${nonce}-unsupported-turn`,
      messageId: `${nonce}-unsupported-message`,
      content: "Choose whatever laptop you want and buy it for me.",
    },
  );
  expect(
    unsupported.status === 422 && unsupported.data?.error === "BOUNDED_INTENT_NOT_REPRESENTABLE",
    "unsupported meaning fails closed",
    unsupported,
  );

  const confirmPath = `/api/v1/conversations/${encodeURIComponent(ambiguousConversation)}/intent-scopes/${encodeURIComponent(ambiguousScope)}/clarifications/${encodeURIComponent(ambiguous.data.proposalId)}/confirm`;
  const confirmed = await call("POST", confirmPath, {
    turnId: `${nonce}-confirm-turn`,
    messageId: `${nonce}-confirm-message`,
    content: "Hard requirement.",
  });
  expect(
    confirmed.status === 202 &&
      confirmed.data?.status === "RUN_ACCEPTED" &&
      confirmed.data?.proposalId === ambiguous.data.proposalId &&
      typeof confirmed.data?.runId === "string" &&
      confirmed.data?.intentVersionId !== ambiguous.data.intentVersionId,
    "exact clarification confirmation",
    confirmed,
  );

  const confirmedRun = await waitForRun(confirmed.data.runId);
  expect(
    confirmedRun.status === 200 && confirmedRun.data?.status === "COMPLETED",
    "clarified run completion",
    confirmedRun,
  );
  const confirmedResult = await call("GET", `/api/v1/runs/${encodeURIComponent(confirmed.data.runId)}/result`);
  expect(
    confirmedResult.status === 200 &&
      confirmedResult.data?.status === "COMPLETED" &&
      confirmedResult.data?.decision &&
      confirmedResult.data?.explanation,
    "clarified result projection",
    confirmedResult,
  );

  const summary = {
    status: "PASS",
    target: base,
    probes: [
      "health",
      "clear-intent",
      "user-turn-replay",
      "clear-run-result",
      "material-clarification",
      "unsupported-fail-closed",
      "exact-confirmation",
      "clarified-run-result",
    ],
    nonce,
  };
  log(`BLACKBOX_PASS ${JSON.stringify(summary)}`);
  return summary;
}

async function main() {
  const summary = await runBlackboxProbes();
  http
    .createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(summary));
    })
    .listen(Number(process.env.PORT ?? "3000"), "0.0.0.0");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
