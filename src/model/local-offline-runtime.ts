import type { ModelProvider } from "./provider.js";
import { ModelRuntime } from "./runtime.js";
import type { ModelCallOptions, ModelRuntimeResult } from "./types.js";

const LOCAL_OFFLINE_INVOCATION = Object.freeze({
  executionClass: "LOCAL_OFFLINE" as const,
  routeMode: "PINNED" as const,
  requestedProvider: "local-openai-compatible",
});

/**
 * Development runtime for an explicitly configured local OpenAI-compatible model.
 * The runtime owns the route declaration so callers cannot silently reclassify it.
 */
export class LocalOfflineModelRuntime extends ModelRuntime {
  constructor(provider: ModelProvider) {
    super(provider);
  }

  override async call(
    rawRequest: unknown,
    options: ModelCallOptions,
  ): Promise<ModelRuntimeResult> {
    if (options.invocation !== undefined) {
      throw new Error("LocalOfflineModelRuntime does not allow per-call invocation overrides.");
    }
    return await super.call(rawRequest, {
      ...options,
      invocation: LOCAL_OFFLINE_INVOCATION,
    });
  }
}
