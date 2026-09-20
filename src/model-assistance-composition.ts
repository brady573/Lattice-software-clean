import { createConfiguredKnowledgeSimplifier } from "./knowledge-simplifier-composition.js";
import { ModelAssistanceCapabilityService } from "./model-assistance-capability.js";
import {
  MemoryModelAssistanceAuthorizationStore,
  PostgresModelAssistanceAuthorizationStore,
} from "./model-assistance-store.js";
import type { GroqRateLimitCoordinator } from "./model/groq-rate-limit-coordinator.js";
import { LocalOfflineModelRuntime } from "./model/local-offline-runtime.js";
import { OpenAiCompatibleModelProvider } from "./model/openai-compatible.js";
import {
  ModelKnowledgeSimplifier,
  type KnowledgeSimplifier,
} from "./presentation/solandra/knowledge-simplification.js";
import type { RuntimeConfig } from "./runtime-config.js";

function configuredDelegate(
  config: RuntimeConfig,
  rateLimitCoordinator?: GroqRateLimitCoordinator,
): KnowledgeSimplifier | undefined {
  const live = createConfiguredKnowledgeSimplifier(config, rateLimitCoordinator);
  if (live !== undefined) return live;
  if (config.localModelProviderBaseUrl === undefined || config.localModelProviderModel === undefined) {
    return undefined;
  }
  return new ModelKnowledgeSimplifier(
    new LocalOfflineModelRuntime(
      new OpenAiCompatibleModelProvider({ baseUrl: config.localModelProviderBaseUrl }),
    ),
    config.localModelProviderModel,
  );
}

/**
 * Compose the single A2 Product capability from already-qualified model routes.
 * Startup configuration selects the route; Product authorization never selects
 * providers/models and never receives provider credentials.
 */
export async function createConfiguredModelAssistanceCapability(
  config: RuntimeConfig,
  rateLimitCoordinator?: GroqRateLimitCoordinator,
): Promise<ModelAssistanceCapabilityService> {
  const store = config.databaseUrl === undefined
    ? new MemoryModelAssistanceAuthorizationStore()
    : await (async () => {
      if (config.autoMigrate) {
        await PostgresModelAssistanceAuthorizationStore.migrate(config.databaseUrl!);
      }
      return await PostgresModelAssistanceAuthorizationStore.connect(config.databaseUrl!);
    })();
  return new ModelAssistanceCapabilityService(store, configuredDelegate(config, rateLimitCoordinator));
}
