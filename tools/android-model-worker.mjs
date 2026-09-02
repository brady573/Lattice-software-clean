const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseIntegerEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function normalizeRelayBaseUrl(value) {
  const url = new URL(value);
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.has(url.hostname))) {
    throw new Error("LATTICE_ANDROID_RELAY_BASE_URL must use HTTPS unless it is loopback.");
  }
  return value.replace(/\/+$/, "");
}

function normalizeLocalModelBaseUrl(value) {
  const url = new URL(value);
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !loopback.has(url.hostname)) {
    throw new Error("LATTICE_ANDROID_LOCAL_MODEL_BASE_URL must be an HTTP(S) loopback URL.");
  }
  return value.replace(/\/+$/, "");
}

async function readBoundedText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Local model response exceeded ${maxBytes} bytes.`);
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Local model response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const relayBaseUrl = normalizeRelayBaseUrl(requireEnv("LATTICE_ANDROID_RELAY_BASE_URL"));
const relayToken = requireEnv("LATTICE_ANDROID_RELAY_TOKEN");
if (relayToken.length < 32 || relayToken.length > 512) {
  throw new Error("LATTICE_ANDROID_RELAY_TOKEN must contain between 32 and 512 characters.");
}

const localModelBaseUrl = normalizeLocalModelBaseUrl(
  process.env.LATTICE_ANDROID_LOCAL_MODEL_BASE_URL ?? "http://127.0.0.1:8080/v1",
);
const localModelApiKey = process.env.LATTICE_ANDROID_LOCAL_MODEL_API_KEY ?? "offline-local";
const pollMs = parseIntegerEnv("LATTICE_ANDROID_WORKER_POLL_MS", 1_000, 250, 10_000);
const localTimeoutMs = parseIntegerEnv(
  "LATTICE_ANDROID_LOCAL_MODEL_TIMEOUT_MS",
  40_000,
  1_000,
  110_000,
);

const relayHeaders = {
  authorization: `Bearer ${relayToken}`,
  "content-type": "application/json",
};

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function postJobResult(jobId, suffix, payload) {
  const response = await fetch(
    `${relayBaseUrl}/api/v1/prototype/android-model-relay/jobs/${encodeURIComponent(jobId)}/${suffix}`,
    {
      method: "POST",
      headers: payload === undefined
        ? { authorization: relayHeaders.authorization }
        : relayHeaders,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) {
    console.warn(`Relay no longer has job ${jobId}; the request likely timed out or was cancelled.`);
    return;
  }
  if (!response.ok) {
    throw new Error(`Relay ${suffix} returned HTTP ${response.status}.`);
  }
}

async function claimJob() {
  const response = await fetch(`${relayBaseUrl}/api/v1/prototype/android-model-relay/jobs/next`, {
    method: "GET",
    headers: { authorization: relayHeaders.authorization },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return null;
  if (response.status === 401) {
    throw new Error("Relay authentication failed. Verify the shared token without sending it through chat or logs.");
  }
  if (!response.ok) {
    throw new Error(`Relay job poll returned HTTP ${response.status}.`);
  }
  const job = await response.json();
  if (
    typeof job !== "object"
    || job === null
    || typeof job.jobId !== "string"
    || typeof job.correlationId !== "string"
    || !("request" in job)
  ) {
    throw new Error("Relay returned an invalid job envelope.");
  }
  return job;
}

async function executeJob(job) {
  try {
    const response = await fetch(`${localModelBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${localModelApiKey}`,
        "x-lattice-correlation-id": job.correlationId,
      },
      body: JSON.stringify(job.request),
      signal: AbortSignal.timeout(localTimeoutMs),
    });
    const bodyText = await readBoundedText(response, MAX_PROVIDER_RESPONSE_BYTES);
    await postJobResult(job.jobId, "complete", {
      statusCode: response.status,
      bodyText,
    });
    console.log(`Completed relay job ${job.jobId} with local HTTP ${response.status}.`);
  } catch (error) {
    try {
      await postJobResult(job.jobId, "fail");
    } catch (relayError) {
      console.error(
        `Could not report failed relay job ${job.jobId}:`,
        relayError instanceof Error ? relayError.message : String(relayError),
      );
    }
    console.error(
      `Local inference failed for relay job ${job.jobId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

console.log(`Android model worker connected to ${new URL(relayBaseUrl).host}.`);
console.log(`Local inference endpoint: ${localModelBaseUrl}/chat/completions`);
console.log("Run this worker only during active prototype testing; it is not a durable background service.");

let errorBackoffMs = pollMs;
while (!stopping) {
  try {
    const job = await claimJob();
    errorBackoffMs = pollMs;
    if (job === null) {
      await delay(pollMs);
      continue;
    }
    await executeJob(job);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await delay(errorBackoffMs);
    errorBackoffMs = Math.min(errorBackoffMs * 2, 10_000);
  }
}

console.log("Android model worker stopped.");
