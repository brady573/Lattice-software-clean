import {
  canonicalModelRequestIdentity,
  sanitizeProviderMetadata,
  stableModelJson,
  validateCanonicalModelRequest,
  validateCanonicalModelResponse,
} from "./canonical.js";
import {
  asModelProviderError,
  ModelProviderError,
} from "./errors.js";
import type { ModelProvider } from "./provider.js";
import type {
  CanonicalModelRequest,
  ModelCallOptions,
  ModelExecutionClass,
  ModelInvocationProvenance,
  ModelInvocationRouteRequest,
  ModelProviderRouteObservation,
  ModelRouteMode,
  ModelRouteProvenanceCompleteness,
  ModelRuntimeResult,
} from "./types.js";

interface ModelRuntimeOptions {
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxStateEntries?: number;
}

class KeyedExecutionLock {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate, () => gate);
    this.tails.set(key, tail);

    const cleanup = () => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };

    let acquired = false;
    let abortHandler: (() => void) | null = null;
    try {
      if (signal.aborted) {
        release();
        void tail.finally(cleanup);
        throw signal.reason ?? new Error("Model call cancelled while queued.");
      }

      const aborted = new Promise<never>((_, reject) => {
        abortHandler = () => reject(signal.reason ?? new Error("Model call cancelled while queued."));
        signal.addEventListener("abort", abortHandler, { once: true });
      });

      try {
        await Promise.race([previous.catch(() => undefined), aborted]);
      } catch (error) {
        release();
        void tail.finally(cleanup);
        throw error;
      }

      acquired = true;
      return await fn();
    } finally {
      if (abortHandler !== null) signal.removeEventListener("abort", abortHandler);
      if (acquired) {
        release();
        cleanup();
      }
    }
  }
}

class BoundedPromiseStore<T> {
  private readonly entries = new Map<string, Promise<T>>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): Promise<T> | null {
    const value = this.entries.get(key);
    if (value === undefined) return null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: Promise<T>): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  deleteIfSame(key: string, value: Promise<T>): void {
    if (this.entries.get(key) === value) this.entries.delete(key);
  }
}

class BoundedAttemptLedger {
  private readonly entries = new Map<string, number>();

  constructor(private readonly maxEntries: number) {}

  next(key: string): number {
    const attempt = this.entries.get(key) ?? 0;
    this.entries.delete(key);
    this.entries.set(key, attempt + 1);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return attempt;
  }
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  if (value.length > 256) throw new Error(`${label} exceeds 256 characters.`);
  return value;
}

function optionalIdentity(value: string | undefined, label: string): string | null {
  return value === undefined ? null : requireNonEmpty(value, label);
}

function isExecutionClass(value: unknown): value is ModelExecutionClass {
  return value === "LOCAL_OFFLINE" || value === "LIVE_BROKERED" || value === "LIVE_DIRECT";
}

function isRouteMode(value: unknown): value is ModelRouteMode {
  return value === "PINNED" || value === "PRODUCT_ROUTED" || value === "BROKER_AUTOMATIC";
}

function normalizeInvocationRoute(
  invocation: ModelInvocationRouteRequest | undefined,
): ModelInvocationRouteRequest | null {
  if (invocation === undefined) return null;
  if (!isExecutionClass(invocation.executionClass)) {
    throw new Error("invocation.executionClass is invalid.");
  }
  if (!isRouteMode(invocation.routeMode)) {
    throw new Error("invocation.routeMode is invalid.");
  }
  return Object.freeze({
    executionClass: invocation.executionClass,
    routeMode: invocation.routeMode,
    ...(invocation.requestedProvider === undefined
      ? {}
      : { requestedProvider: requireNonEmpty(invocation.requestedProvider, "invocation.requestedProvider") }),
  });
}

function normalizeRouteObservation(
  route: ModelProviderRouteObservation | undefined,
): Readonly<{
  actualProvider: string | null;
  actualModel: string | null;
  brokerIdentity: string | null;
  brokerVersion: string | null;
  upstreamRequestId: string | null;
}> {
  return Object.freeze({
    actualProvider: optionalIdentity(route?.actualProvider, "route.actualProvider"),
    actualModel: optionalIdentity(route?.actualModel, "route.actualModel"),
    brokerIdentity: optionalIdentity(route?.brokerIdentity, "route.brokerIdentity"),
    brokerVersion: optionalIdentity(route?.brokerVersion, "route.brokerVersion"),
    upstreamRequestId: optionalIdentity(route?.upstreamRequestId, "route.upstreamRequestId"),
  });
}

function routeCompleteness(
  invocation: ModelInvocationRouteRequest | null,
  route: ReturnType<typeof normalizeRouteObservation>,
): ModelRouteProvenanceCompleteness {
  if (invocation === null) return "MISSING";

  const hasObservedIdentity = route.actualProvider !== null
    || route.actualModel !== null
    || route.brokerIdentity !== null
    || route.brokerVersion !== null
    || route.upstreamRequestId !== null;
  if (!hasObservedIdentity) return "MISSING";

  switch (invocation.executionClass) {
    case "LOCAL_OFFLINE":
      return route.actualModel !== null ? "COMPLETE" : "PARTIAL";
    case "LIVE_DIRECT":
      return route.actualProvider !== null && route.actualModel !== null
        ? "COMPLETE"
        : "PARTIAL";
    case "LIVE_BROKERED":
      return route.brokerIdentity !== null
        && route.actualProvider !== null
        && route.actualModel !== null
        ? "COMPLETE"
        : "PARTIAL";
  }
}

function buildInvocationProvenance(
  request: CanonicalModelRequest,
  invocation: ModelInvocationRouteRequest | null,
  observedRoute: ModelProviderRouteObservation | undefined,
): ModelInvocationProvenance {
  const route = normalizeRouteObservation(observedRoute);
  return Object.freeze({
    executionClass: invocation?.executionClass ?? null,
    routeMode: invocation?.routeMode ?? null,
    requestedProvider: invocation?.requestedProvider ?? null,
    requestedModel: request.model,
    actualProvider: route.actualProvider,
    actualModel: route.actualModel,
    brokerIdentity: route.brokerIdentity,
    brokerVersion: route.brokerVersion,
    upstreamRequestId: route.upstreamRequestId,
    routeProvenance: routeCompleteness(invocation, route),
  });
}

function classifyAbort(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  cause: unknown,
): ModelProviderError {
  if (callerSignal?.aborted === true) {
    return new ModelProviderError("cancelled", "Model call was cancelled by caller.", { cause });
  }
  if (timeoutSignal.aborted) {
    return new ModelProviderError("timeout", "Model call exceeded its timeout.", {
      retryable: true,
      cause,
    });
  }
  return asModelProviderError(cause);
}

async function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("Aborted.");
  let abortHandler: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () => reject(signal.reason ?? new Error("Aborted."));
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abortHandler !== null) signal.removeEventListener("abort", abortHandler);
    void operation.catch(() => undefined);
  }
}

export class ModelRuntime {
  private readonly timeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly lock = new KeyedExecutionLock();
  private readonly idempotency: BoundedPromiseStore<ModelRuntimeResult>;
  private readonly attempts: BoundedAttemptLedger;

  constructor(
    private readonly provider: ModelProvider,
    options: ModelRuntimeOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRequestBytes = options.maxRequestBytes ?? 256 * 1024;
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
    const maxStateEntries = options.maxStateEntries ?? 10_000;
    for (const [label, value] of [
      ["timeoutMs", this.timeoutMs],
      ["maxRequestBytes", this.maxRequestBytes],
      ["maxResponseBytes", this.maxResponseBytes],
      ["maxStateEntries", maxStateEntries],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive safe integer.`);
      }
    }
    this.idempotency = new BoundedPromiseStore(maxStateEntries);
    this.attempts = new BoundedAttemptLedger(maxStateEntries);
  }

  async call(
    rawRequest: unknown,
    options: ModelCallOptions,
  ): Promise<ModelRuntimeResult> {
    const correlationId = requireNonEmpty(options.correlationId, "correlationId");
    const invocation = normalizeInvocationRoute(options.invocation);
    const request = validateCanonicalModelRequest(rawRequest);
    const requestBytes = Buffer.byteLength(stableModelJson(request), "utf8");
    if (requestBytes > this.maxRequestBytes) {
      throw new ModelProviderError(
        "invalid_output",
        `Canonical model request exceeded ${this.maxRequestBytes} bytes.`,
      );
    }
    const requestIdentity = canonicalModelRequestIdentity(request);
    const logicalKey = `${correlationId}\u0000${requestIdentity}`;
    const maxAttempts = options.maxAttempts ?? 1;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
      throw new Error("maxAttempts must be an integer between 1 and 3.");
    }

    if (options.idempotencyKey !== undefined) {
      const idempotencyKey = requireNonEmpty(options.idempotencyKey, "idempotencyKey");
      const cacheKey = `${logicalKey}\u0000${idempotencyKey}`;
      const existing = this.idempotency.get(cacheKey);
      if (existing !== null) {
        return await this.awaitShared(existing, options.signal);
      }
      const promise = this.executeSerialized(
        request,
        requestIdentity,
        logicalKey,
        correlationId,
        invocation,
        maxAttempts,
        options.signal,
      );
      this.idempotency.set(cacheKey, promise);
      void promise.catch(() => {
        this.idempotency.deleteIfSame(cacheKey, promise);
      });
      return await promise;
    }

    return await this.executeSerialized(
      request,
      requestIdentity,
      logicalKey,
      correlationId,
      invocation,
      maxAttempts,
      options.signal,
    );
  }

  private async awaitShared(
    promise: Promise<ModelRuntimeResult>,
    signal: AbortSignal | undefined,
  ): Promise<ModelRuntimeResult> {
    if (signal === undefined) return await promise;
    try {
      return await raceWithAbort(promise, signal);
    } catch (error) {
      if (signal.aborted) {
        throw new ModelProviderError(
          "cancelled",
          "Model duplicate-delivery wait was cancelled by caller.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async executeSerialized(
    request: CanonicalModelRequest,
    requestIdentity: string,
    logicalKey: string,
    correlationId: string,
    invocation: ModelInvocationRouteRequest | null,
    maxAttempts: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<ModelRuntimeResult> {
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(new Error("Model call timeout.")),
      this.timeoutMs,
    );
    const signal = callerSignal === undefined
      ? timeoutController.signal
      : AbortSignal.any([callerSignal, timeoutController.signal]);

    try {
      return await this.lock.run(logicalKey, signal, async () => {
        for (let logicalAttempt = 0; logicalAttempt < maxAttempts; logicalAttempt += 1) {
          const attempt = this.attempts.next(logicalKey);
          const started = performance.now();
          try {
            const operation = this.provider.generate(request, {
              correlationId,
              requestIdentity,
              attempt,
              signal,
            });
            const providerResult = await raceWithAbort(operation, signal);
            const response = validateCanonicalModelResponse(providerResult.response, request);
            const responseBytes = Buffer.byteLength(stableModelJson(response), "utf8");
            if (responseBytes > this.maxResponseBytes) {
              throw new ModelProviderError(
                "response_too_large",
                `Canonical model response exceeded ${this.maxResponseBytes} bytes.`,
                { statusCode: 502 },
              );
            }
            return Object.freeze({
              response,
              audit: Object.freeze({
                correlationId,
                requestIdentity,
                providerKind: this.provider.kind,
                attempt,
                elapsedMs: Number((performance.now() - started).toFixed(3)),
                providerMetadata: sanitizeProviderMetadata(providerResult.metadata),
                invocationProvenance: buildInvocationProvenance(
                  request,
                  invocation,
                  providerResult.route,
                ),
              }),
            });
          } catch (error) {
            const classified = signal.aborted
              ? classifyAbort(callerSignal, timeoutController.signal, error)
              : asModelProviderError(error);
            if (!classified.retryable || logicalAttempt + 1 >= maxAttempts) {
              throw classified;
            }
          }
        }
        throw new ModelProviderError("unavailable", "Model call exhausted its attempts.");
      });
    } catch (error) {
      if (signal.aborted) throw classifyAbort(callerSignal, timeoutController.signal, error);
      throw asModelProviderError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}
