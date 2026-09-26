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

/**
 * Node's setTimeout() silently rewrites any delay above 2^31-1 ms to 1 ms, so
 * a computed window must be rejected rather than scheduled as a false bound.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function requireTimerDelay(delayMs: number, label: string): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0 || delayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${label} must be a positive timer delay no greater than ${MAX_TIMER_DELAY_MS} ms.`);
  }
  return delayMs;
}

/**
 * A provider that has already reported a known rate-limit/recovery boundary
 * knows more about the failure than a window expiry does, and that knowledge
 * must survive the abort. This is what keeps a request that never reached
 * provider HTTP because the route was inside a known recovery block from being
 * reported as an undifferentiated model timeout.
 *
 * Deliberately narrow: only an explicit rate_limit/recovery boundary is
 * preserved, and it is returned unchanged so its own retryable semantics are
 * the caller's. A post-fetch stall, an ordinary attempt timeout, and caller
 * cancellation all still classify exactly as before.
 */
function knownProviderRecoveryBoundary(error: unknown): ModelProviderError | null {
  return error instanceof ModelProviderError && error.code === "rate_limit" ? error : null;
}

function classifyAbort(
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  cause: unknown,
): ModelProviderError {
  if (callerSignal?.aborted === true) {
    return new ModelProviderError("cancelled", "Model call was cancelled by caller.", { cause });
  }
  // Preserved after caller cancellation so cancellation still wins, and before
  // the timeout so a known recovery boundary is never flattened into one.
  const recoveryBoundary = knownProviderRecoveryBoundary(cause);
  if (recoveryBoundary !== null) {
    return recoveryBoundary;
  }
  if (timeoutSignal.aborted) {
    return new ModelProviderError("timeout", "Model call exceeded its timeout.", {
      retryable: true,
      cause,
    });
  }
  return asModelProviderError(cause);
}

type ProviderOutcome<T> =
  | { readonly kind: "fulfilled"; readonly value: T }
  | { readonly kind: "rejected"; readonly error: unknown };

/**
 * Resolves one provider attempt against the attempt window.
 *
 * The attempt window is a runtime fact, so it is always able to explain an
 * abort. The provider, however, may know strictly more about *why* it stopped:
 * for example that provider HTTP was never reached because the route was inside
 * a known rate-limit recovery block. Discarding the provider's account in favour
 * of the runtime's is what turns a known recovery boundary into an
 * undifferentiated model timeout, so once the signal has fired the provider is
 * given one bounded grace turn to report a more-specific rejection.
 *
 * The grace is deliberately asymmetric, and that is the whole point of it:
 *
 * - An abort is never overwritten by a provider *success*. A provider that
 *   resolves from its own abort listener has not produced a trustworthy answer
 *   to a call the caller has already abandoned or the window has already closed,
 *   so the abort stands and its reason is thrown.
 * - Only a more specific rejected provider boundary is preserved, so caller
 *   cancellation still wins over any post-abort success and the attempt timeout
 *   still wins over any post-timeout success.
 * - Ordinary timeout and stall semantics are otherwise untouched: a provider
 *   that reports nothing more specific within the grace yields the ordinary
 *   model timeout.
 *
 * The grace is a single event-loop turn. It is finite, never repeated, never
 * extends the call's bound beyond the attempt window plus that one turn, and it
 * is cleared as soon as the attempt settles.
 */
async function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error("Aborted.");

  // The provider's terminal outcome is recorded separately so that a
  // fulfillment can be told apart from a rejection after the abort fires.
  let record: ((outcome: ProviderOutcome<T>) => void) | null = null;
  const providerOutcome = new Promise<ProviderOutcome<T>>((resolve) => {
    record = resolve;
  });
  void operation.then(
    (value) => record?.({ kind: "fulfilled", value }),
    (error: unknown) => record?.({ kind: "rejected", error }),
  );

  let abortHandler: (() => void) | null = null;
  const aborted = new Promise<"aborted">((resolve) => {
    abortHandler = () => resolve("aborted");
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const first = await Promise.race([
      providerOutcome.then((outcome) => ({ source: "provider" as const, outcome })),
      aborted.then(() => ({ source: "signal" as const })),
    ]);
    if (first.source === "provider") {
      if (first.outcome.kind === "fulfilled") return first.outcome.value;
      throw first.outcome.error;
    }

    // The signal has fired, so the attempt is over. Only a more specific
    // provider rejection may still change the reported boundary, and only
    // within one bounded turn. A provider success is ignored here on purpose.
    const preserved = await Promise.race([
      providerOutcome,
      new Promise<"expired">((resolve) => {
        graceTimer = setTimeout(() => resolve("expired"), 0);
      }),
    ]);
    if (preserved !== "expired" && preserved.kind === "rejected") {
      const recoveryBoundary = knownProviderRecoveryBoundary(preserved.error);
      if (recoveryBoundary !== null) throw recoveryBoundary;
    }
    throw signal.reason ?? new Error("Aborted.");
  } finally {
    if (abortHandler !== null) signal.removeEventListener("abort", abortHandler);
    if (graceTimer !== null) clearTimeout(graceTimer);
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
    this.timeoutMs = requireTimerDelay(options.timeoutMs ?? 30_000, "ModelRuntime timeoutMs");
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
    const attemptWindowPolicy = options.attemptWindowPolicy ?? "shared";

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
        controller.signal,
        attemptWindowPolicy,
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
      options.signal,
      attemptWindowPolicy,
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
    callerSignal: AbortSignal | undefined,
    attemptWindowPolicy: "shared" | "per-attempt",
  ): Promise<ModelRuntimeResult> {
    if (attemptWindowPolicy === "per-attempt") {
      return await this.executeWithPerAttemptWindows(
        request,
        requestIdentity,
        logicalKey,
        correlationId,
        invocation,
        maxAttempts,
        callerSignal,
      );
    }

    // Shared-window policy (default): the historical behavior, where one
    // timeoutMs budget covers queue waiting, provider readiness, and every
    // permitted attempt together.
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
          if (signal.aborted) {
            throw classifyAbort(callerSignal, timeoutController.signal, signal.reason);
          }
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
            if (signal.aborted || !classified.retryable || logicalAttempt + 1 >= maxAttempts) {
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

  /**
   * Per-attempt window policy, used only by callers that explicitly opt in.
   *
   * Queue waiting for the logical key is bounded separately and does not
   * consume any attempt's execution window, so a permitted retry is never
   * starved by an earlier attempt or by lock contention. The whole call stays
   * explicitly finite: queue wait <= this.timeoutMs, and every permitted
   * attempt <= this.timeoutMs, for a worst case of
   * this.timeoutMs * (1 + maxAttempts).
   */
  private async executeWithPerAttemptWindows(
    request: CanonicalModelRequest,
    requestIdentity: string,
    logicalKey: string,
    correlationId: string,
    invocation: ModelInvocationRouteRequest | null,
    maxAttempts: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<ModelRuntimeResult> {
    // Validate all timer delays BEFORE scheduling any timer, so an
    // unrepresentable budget fails fast without leaving orphaned timers.
    const attemptBoundMs = requireTimerDelay(
      this.timeoutMs * maxAttempts,
      "Model attempt budget",
    );
    const queueController = new AbortController();
    const queueTimer = setTimeout(
      () => queueController.abort(new Error("Model call queue wait exceeded its bound.")),
      this.timeoutMs,
    );
    const queueSignal = callerSignal === undefined
      ? queueController.signal
      : AbortSignal.any([callerSignal, queueController.signal]);
    try {
      return await this.lock.run(logicalKey, queueSignal, async () => {
        // Lock acquired: retire the queue timer immediately so it can never
        // fire after lock acquisition or participate in final error classification.
        clearTimeout(queueTimer);
        const lockAcquired = true;

        const attemptBoundMs = requireTimerDelay(
          this.timeoutMs * maxAttempts,
          "Model attempt budget",
        );
        const budgetController = new AbortController();
        const budgetTimer = setTimeout(
          () => budgetController.abort(new Error("Model attempt budget exceeded.")),
          attemptBoundMs,
        );
        const budgetSignal = callerSignal === undefined
          ? budgetController.signal
          : AbortSignal.any([callerSignal, budgetController.signal]);
        try {
          for (let logicalAttempt = 0; logicalAttempt < maxAttempts; logicalAttempt += 1) {
            if (budgetSignal.aborted) {
              throw classifyAbort(callerSignal, budgetController.signal, budgetSignal.reason);
            }
            const attemptController = new AbortController();
            const attemptTimer = setTimeout(
              () => attemptController.abort(new Error("Model attempt timeout.")),
              this.timeoutMs,
            );
            const signal = AbortSignal.any([budgetSignal, attemptController.signal]);
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
              if (callerSignal?.aborted === true) {
                throw new ModelProviderError("cancelled", "Model call was cancelled by caller.", { cause: error });
              }
              if (budgetSignal.aborted) {
                throw classifyAbort(callerSignal, budgetController.signal, error);
              }
              const knownBoundary = knownProviderRecoveryBoundary(error);
              const classified = attemptController.signal.aborted && knownBoundary === null
                ? new ModelProviderError(
                  "timeout",
                  logicalAttempt + 1 >= maxAttempts
                    ? "Model call exceeded its timeout."
                    : "Model call attempt exceeded its timeout.",
                  { retryable: true, cause: error },
                )
                : knownBoundary ?? asModelProviderError(error);
              if (!classified.retryable || logicalAttempt + 1 >= maxAttempts) {
                throw classified;
              }
            } finally {
              clearTimeout(attemptTimer);
            }
          }
          throw new ModelProviderError("unavailable", "Model call exhausted its attempts.");
        } finally {
          clearTimeout(budgetTimer);
        }
      });
    } catch (error) {
      if (callerSignal?.aborted === true) {
        throw new ModelProviderError("cancelled", "Model call was cancelled by caller.", { cause: error });
      }
      // Classify queue timeout as timeout only if we never acquired the lock
      if (queueController.signal.aborted) {
        throw classifyAbort(callerSignal, queueController.signal, error);
      }
      throw asModelProviderError(error);
    } finally {
      clearTimeout(queueTimer);
    }
  }
}
