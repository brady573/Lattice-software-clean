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
  withModelFailureDiagnostic,
  type ModelFailureDiagnostic,
  type ModelFailurePhase,
} from "./errors.js";
import type { ModelProvider } from "./provider.js";
import type {
  CanonicalModelRequest,
  ModelCallOptions,
  ModelExecutionClass,
  ModelInvocationProvenance,
  ModelInvocationRouteRequest,
  ModelProviderDiagnosticEvent,
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

interface SharedModelOperation {
  readonly promise: Promise<ModelRuntimeResult>;
  readonly controller: AbortController;
  waiters: number;
  settled: boolean;
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

class BoundedStore<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): T | null {
    const value = this.entries.get(key);
    if (value === undefined) return null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  deleteIfSame(key: string, value: T): void {
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
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return attempt;
  }
}

function roundedElapsedMs(value: number): number {
  return Number(Math.max(0, value).toFixed(3));
}

class ModelCallDiagnosticTracker {
  private readonly logicalStartedAt = performance.now();
  private queueElapsedMs: number | null = null;
  private accumulatedRateLimitWaitMs = 0;
  private accumulatedProviderRequestMs = 0;
  private accumulatedRetryMs = 0;
  private phase: ModelFailurePhase = "QUEUE";
  private rateLimitWaitStartedAt: number | null = null;
  private providerRequestStartedAt: number | null = null;
  private retryStartedAt: number | null = null;
  private attemptsStarted = 0;
  private retryCount = 0;
  private providerStatus: number | null = null;
  private rateLimitRecoveryMs: number | null = null;
  private rateLimitLimitTokens: number | null = null;
  private rateLimitRemainingTokens: number | null = null;
  private rateLimitResetTokensMs: number | null = null;

  constructor(
    private readonly requestBytes: number,
    private readonly maxOutputTokens: number | null,
  ) {}

  readonly observeProvider = (event: ModelProviderDiagnosticEvent): void => {
    const now = performance.now();
    switch (event.kind) {
      case "rate_limit_wait_start":
        this.finishProviderRequest(now);
        this.rateLimitWaitStartedAt = now;
        this.phase = "RATE_LIMIT_WAIT";
        return;
      case "rate_limit_wait_complete":
        this.finishRateLimitWait(now);
        this.providerRequestStartedAt = now;
        this.phase = "PROVIDER_REQUEST";
        return;
      case "provider_request_start":
        if (this.providerRequestStartedAt === null) this.providerRequestStartedAt = now;
        this.phase = "PROVIDER_REQUEST";
        return;
      case "provider_response_headers":
        this.providerStatus = event.statusCode;
        this.rateLimitLimitTokens = event.rateLimitLimitTokens;
        this.rateLimitRemainingTokens = event.rateLimitRemainingTokens;
        this.rateLimitResetTokensMs = event.rateLimitResetTokensMs;
        this.phase = "PROVIDER_RESPONSE";
        return;
      case "provider_request_complete":
        this.finishProviderRequest(now);
        this.phase = "PROVIDER_RESPONSE";
        return;
      case "rate_limit_recovery":
        this.rateLimitRecoveryMs = event.delayMs;
        return;
    }
  };

  queueAcquired(): void {
    if (this.queueElapsedMs !== null) return;
    const now = performance.now();
    this.queueElapsedMs = now - this.logicalStartedAt;
    this.phase = "UNKNOWN";
  }

  attemptStarted(): void {
    const now = performance.now();
    this.finishRetry(now);
    this.attemptsStarted += 1;
    this.providerRequestStartedAt = now;
    this.phase = "PROVIDER_REQUEST";
  }

  providerOperationComplete(): void {
    this.finishProviderRequest(performance.now());
    this.phase = "PROVIDER_RESPONSE";
  }

  retryStarted(): void {
    const now = performance.now();
    this.finishRateLimitWait(now);
    this.finishProviderRequest(now);
    this.retryCount += 1;
    this.retryStartedAt = now;
    this.phase = "RETRY";
  }

  snapshot(): ModelFailureDiagnostic {
    const now = performance.now();
    const queueMs = this.queueElapsedMs
      ?? (this.phase === "QUEUE" ? now - this.logicalStartedAt : 0);
    const rateLimitWaitMs = this.accumulatedRateLimitWaitMs
      + (this.rateLimitWaitStartedAt === null ? 0 : now - this.rateLimitWaitStartedAt);
    const providerRequestMs = this.accumulatedProviderRequestMs
      + (this.providerRequestStartedAt === null ? 0 : now - this.providerRequestStartedAt);
    const retryMs = this.accumulatedRetryMs
      + (this.retryStartedAt === null ? 0 : now - this.retryStartedAt);

    return Object.freeze({
      timeoutPhase: this.phase,
      queueMs: roundedElapsedMs(queueMs),
      rateLimitWaitMs: roundedElapsedMs(rateLimitWaitMs),
      providerRequestMs: roundedElapsedMs(providerRequestMs),
      retryMs: roundedElapsedMs(retryMs),
      totalMs: roundedElapsedMs(now - this.logicalStartedAt),
      attemptsStarted: this.attemptsStarted,
      retryCount: this.retryCount,
      providerStatus: this.providerStatus,
      rateLimitRecoveryMs: this.rateLimitRecoveryMs,
      rateLimitLimitTokens: this.rateLimitLimitTokens,
      rateLimitRemainingTokens: this.rateLimitRemainingTokens,
      rateLimitResetTokensMs: this.rateLimitResetTokensMs,
      requestBytes: this.requestBytes,
      maxOutputTokens: this.maxOutputTokens,
    });
  }

  private finishRateLimitWait(now: number): void {
    if (this.rateLimitWaitStartedAt === null) return;
    this.accumulatedRateLimitWaitMs += now - this.rateLimitWaitStartedAt;
    this.rateLimitWaitStartedAt = null;
  }

  private finishProviderRequest(now: number): void {
    if (this.providerRequestStartedAt === null) return;
    this.accumulatedProviderRequestMs += now - this.providerRequestStartedAt;
    this.providerRequestStartedAt = null;
  }

  private finishRetry(now: number): void {
    if (this.retryStartedAt === null) return;
    this.accumulatedRetryMs += now - this.retryStartedAt;
    this.retryStartedAt = null;
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
  diagnostic: ModelFailureDiagnostic,
): ModelProviderError {
  if (callerSignal?.aborted === true) {
    return new ModelProviderError("cancelled", "Model call was cancelled by caller.", {
      cause,
      diagnostic,
    });
  }
  if (timeoutSignal.aborted) {
    return new ModelProviderError("timeout", "Model call exceeded its timeout.", {
      retryable: true,
      cause,
      diagnostic,
    });
  }
  return withModelFailureDiagnostic(asModelProviderError(cause), diagnostic);
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
  private readonly idempotency: BoundedStore<SharedModelOperation>;
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
    this.idempotency = new BoundedStore(maxStateEntries);
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

      const controller = new AbortController();
      const promise = this.executeSerialized(
        request,
        requestIdentity,
        logicalKey,
        correlationId,
        invocation,
        maxAttempts,
        requestBytes,
        controller.signal,
      );
      const operation: SharedModelOperation = {
        promise,
        controller,
        waiters: 0,
        settled: false,
      };
      this.idempotency.set(cacheKey, operation);
      void promise.finally(() => {
        operation.settled = true;
      }).catch(() => undefined);
      void promise.catch(() => {
        this.idempotency.deleteIfSame(cacheKey, operation);
      });
      return await this.awaitShared(operation, options.signal);
    }

    return await this.executeSerialized(
      request,
      requestIdentity,
      logicalKey,
      correlationId,
      invocation,
      maxAttempts,
      requestBytes,
      options.signal,
    );
  }

  private async awaitShared(
    operation: SharedModelOperation,
    signal: AbortSignal | undefined,
  ): Promise<ModelRuntimeResult> {
    operation.waiters += 1;
    try {
      if (signal === undefined) return await operation.promise;
      try {
        return await raceWithAbort(operation.promise, signal);
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
    } finally {
      operation.waiters -= 1;
      if (operation.waiters === 0 && !operation.settled) {
        operation.controller.abort(new Error("Shared model call has no active waiters."));
      }
    }
  }

  private async executeSerialized(
    request: CanonicalModelRequest,
    requestIdentity: string,
    logicalKey: string,
    correlationId: string,
    invocation: ModelInvocationRouteRequest | null,
    maxAttempts: number,
    requestBytes: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<ModelRuntimeResult> {
    const diagnostic = new ModelCallDiagnosticTracker(
      requestBytes,
      request.maxOutputTokens ?? null,
    );
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
        diagnostic.queueAcquired();
        for (let logicalAttempt = 0; logicalAttempt < maxAttempts; logicalAttempt += 1) {
          if (signal.aborted) {
            throw classifyAbort(
              callerSignal,
              timeoutController.signal,
              signal.reason,
              diagnostic.snapshot(),
            );
          }
          const attempt = this.attempts.next(logicalKey);
          diagnostic.attemptStarted();
          const started = performance.now();
          try {
            const operation = this.provider.generate(request, {
              correlationId,
              requestIdentity,
              attempt,
              signal,
              diagnosticSink: diagnostic.observeProvider,
            });
            const providerResult = await raceWithAbort(operation, signal);
            diagnostic.providerOperationComplete();
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
              ? classifyAbort(
                callerSignal,
                timeoutController.signal,
                error,
                diagnostic.snapshot(),
              )
              : asModelProviderError(error);
            if (signal.aborted || !classified.retryable || logicalAttempt + 1 >= maxAttempts) {
              throw withModelFailureDiagnostic(classified, diagnostic.snapshot());
            }
            diagnostic.retryStarted();
          }
        }
        throw new ModelProviderError("unavailable", "Model call exhausted its attempts.");
      });
    } catch (error) {
      const snapshot = diagnostic.snapshot();
      if (signal.aborted) {
        throw classifyAbort(callerSignal, timeoutController.signal, error, snapshot);
      }
      throw withModelFailureDiagnostic(asModelProviderError(error), snapshot);
    } finally {
      clearTimeout(timer);
    }
  }
}
