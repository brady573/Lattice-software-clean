import type {
  CapabilityStateGuard,
} from "./capability-execution-policy.js";
import {
  AllowlistedHttpResearchExecutor,
  type AllowlistedHttpResearchExecutorConfig,
} from "./allowlisted-http-research-executor.js";
import type { LiveResearchBindingStores } from "./live-research-binding.js";
import {
  PinnedLiveResearchModelOperation,
  type LiveResearchCapabilityGrantSource,
  type LiveResearchContextProjectionSource,
  type LiveResearchPriorOperationSource,
  type PinnedLiveResearchModelConfig,
} from "./live-research-model-operation.js";
import { BoundLiveResearchTaskExecutor } from "./live-research-task-executor.js";
import {
  PinnedExternalResearchModelProvider,
  type PinnedExternalResearchProviderOptions,
} from "./model/pinned-external-research-provider.js";
import { ModelRuntime } from "./model/runtime.js";

export interface LiveResearchWorkerCompositionOptions {
  readonly stores: LiveResearchBindingStores;
  readonly model: PinnedLiveResearchModelConfig;
  readonly modelProvider: PinnedExternalResearchProviderOptions;
  readonly contextSource: LiveResearchContextProjectionSource;
  readonly grantSource: LiveResearchCapabilityGrantSource;
  readonly guard: CapabilityStateGuard;
  readonly capability: AllowlistedHttpResearchExecutorConfig;
  readonly priorOperationSource?: LiveResearchPriorOperationSource;
}

function assertComposition(options: LiveResearchWorkerCompositionOptions): void {
  if (options.model.executionClass !== "LIVE_DIRECT") {
    throw new Error("Pinned external Research Worker composition requires LIVE_DIRECT execution.");
  }
  if (options.model.requestedProvider !== options.modelProvider.providerId) {
    throw new Error("Pinned Research Worker requestedProvider must match the external provider identity.");
  }
}

/**
 * Canonical M9-5 Research Worker executor composition.
 *
 * This constructor performs no external call. It only composes already-bounded
 * Product-owned sources and the validated M9-5 operational seams into the
 * existing durable ResearchTaskExecutor contract. Provider secrets remain
 * constructor inputs and never become Run, V36, or Solandra state.
 */
export function createLiveResearchWorkerExecutor(
  options: LiveResearchWorkerCompositionOptions,
): BoundLiveResearchTaskExecutor {
  assertComposition(options);

  const provider = new PinnedExternalResearchModelProvider(options.modelProvider);
  const runtime = new ModelRuntime(provider);
  const capabilityExecutor = new AllowlistedHttpResearchExecutor(options.capability);
  const operation = new PinnedLiveResearchModelOperation(
    options.model,
    runtime,
    options.contextSource,
    options.grantSource,
    options.guard,
    capabilityExecutor,
    options.priorOperationSource,
  );
  return new BoundLiveResearchTaskExecutor(options.stores, operation);
}
