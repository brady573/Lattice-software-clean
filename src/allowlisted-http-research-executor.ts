import type {
  CapabilityExecutor,
  CapabilityExecutorContext,
} from "./capability-execution-policy.js";

export type AllowlistedHttpResearchExecutionErrorCode =
  | "INVALID_CONFIG"
  | "CAPABILITY_MISMATCH"
  | "EGRESS_DENIED"
  | "INVALID_QUERY"
  | "UNAVAILABLE"
  | "RESPONSE_TOO_LARGE"
  | "MALFORMED_RESPONSE";

export class AllowlistedHttpResearchExecutionError extends Error {
  constructor(
    readonly code: AllowlistedHttpResearchExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AllowlistedHttpResearchExecutionError";
  }
}

export interface AllowlistedHttpResearchExecutorConfig {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly endpoint: string;
  readonly queryParameter?: string;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

function nonEmpty(value: string, label: string, max = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new AllowlistedHttpResearchExecutionError("INVALID_CONFIG", `${label} is invalid.`);
  }
  return normalized;
}

function normalizeEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AllowlistedHttpResearchExecutionError("INVALID_CONFIG", "Research endpoint is not a valid URL.");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.hash
    || url.search
    || url.pathname === "/"
  ) {
    throw new AllowlistedHttpResearchExecutionError(
      "INVALID_CONFIG",
      "Research endpoint must be a credential-free HTTPS URL with one fixed non-root path and no query or fragment.",
    );
  }
  return url;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AllowlistedHttpResearchExecutionError(
      "RESPONSE_TOO_LARGE",
      `Research response exceeded ${maxBytes} bytes.`,
    );
  }
  if (response.body === null) {
    throw new AllowlistedHttpResearchExecutionError("MALFORMED_RESPONSE", "Research response body is empty.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AllowlistedHttpResearchExecutionError(
          "RESPONSE_TOO_LARGE",
          `Research response exceeded ${maxBytes} bytes.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    throw new AllowlistedHttpResearchExecutionError(
      "MALFORMED_RESPONSE",
      `Research endpoint returned malformed JSON: ${error instanceof Error ? error.message : "unknown parse failure"}.`,
    );
  }
}

/**
 * Narrow M9-5 research capability. Product-owned CapabilityExecutionPolicy
 * remains responsible for Run/subject/IntentVersion binding, call budgets,
 * timeout/cancellation, output-byte limits, and last-safe-boundary checks.
 * This executor only performs one exact allowlisted HTTPS JSON lookup and
 * returns operational observation/provenance data for downstream V36 handling.
 */
export class AllowlistedHttpResearchExecutor implements CapabilityExecutor {
  private readonly capabilityId: string;
  private readonly capabilityVersion: string;
  private readonly endpoint: URL;
  private readonly queryParameter: string;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AllowlistedHttpResearchExecutorConfig) {
    this.capabilityId = nonEmpty(config.capabilityId, "capabilityId");
    this.capabilityVersion = nonEmpty(config.capabilityVersion, "capabilityVersion");
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.queryParameter = nonEmpty(config.queryParameter ?? "q", "queryParameter", 64);
    const maxResponseBytes = config.maxResponseBytes ?? 256 * 1024;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2 * 1024 * 1024) {
      throw new AllowlistedHttpResearchExecutionError(
        "INVALID_CONFIG",
        "maxResponseBytes must be an integer between 1 and 2097152.",
      );
    }
    this.maxResponseBytes = maxResponseBytes;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async execute(context: CapabilityExecutorContext): Promise<unknown> {
    if (
      context.capabilityId !== this.capabilityId
      || context.capabilityVersion !== this.capabilityVersion
      || context.role !== "RESEARCH"
    ) {
      throw new AllowlistedHttpResearchExecutionError(
        "CAPABILITY_MISMATCH",
        "Research executor received a capability outside its exact configured identity and role.",
      );
    }
    if (
      context.egress.kind !== "ALLOWLIST"
      || !context.egress.origins.includes(this.endpoint.origin)
    ) {
      throw new AllowlistedHttpResearchExecutionError(
        "EGRESS_DENIED",
        "Research endpoint origin is not present in the exact Product-owned egress grant.",
      );
    }
    const query = context.arguments.query;
    if (typeof query !== "string" || query.trim().length === 0 || query.length > 8192) {
      throw new AllowlistedHttpResearchExecutionError(
        "INVALID_QUERY",
        "Research capability requires one non-empty bounded string query.",
      );
    }

    const requestUrl = new URL(this.endpoint.href);
    requestUrl.searchParams.set(this.queryParameter, query);
    let response: Response;
    try {
      response = await this.fetchImpl(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      throw new AllowlistedHttpResearchExecutionError(
        "UNAVAILABLE",
        `Research endpoint was unavailable: ${error instanceof Error ? error.message : "request failed"}.`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AllowlistedHttpResearchExecutionError(
        "UNAVAILABLE",
        `Research endpoint returned HTTP ${response.status}.`,
      );
    }

    const value = await readBoundedJson(response, this.maxResponseBytes);
    return Object.freeze({
      kind: "HTTP_JSON_OBSERVATION",
      source: Object.freeze({
        origin: this.endpoint.origin,
        path: this.endpoint.pathname,
        status: response.status,
      }),
      value,
    });
  }
}
