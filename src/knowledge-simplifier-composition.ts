import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "./model/groq-knowledge-simplifier.js";
import type { GroqRateLimitCoordinator } from "./model/groq-rate-limit-coordinator.js";
import {
  ModelKnowledgeSimplifier,
  type KnowledgeSimplifier,
} from "./presentation/solandra/knowledge-simplification.js";
import type { RuntimeConfig } from "./runtime-config.js";

/**
 * Compose the one explicitly selected durable Knowledge-simplification route.
 * Provider credentials remain process configuration and never enter Product state.
 */
export function createConfiguredKnowledgeSimplifier(
  config: RuntimeConfig,
  rateLimitCoordinator?: GroqRateLimitCoordinator,
): KnowledgeSimplifier | undefined {
  if (config.knowledgeSimplifierRoute === undefined) return undefined;

  switch (config.knowledgeSimplifierRoute) {
    case "groq-gpt-oss-120b": {
      if (config.knowledgeSimplifierApiKey === undefined) {
        throw new Error("Configured Groq Knowledge simplifier requires its API key.");
      }
      const provider = new GroqKnowledgeSimplifierModelProvider({
        apiKey: config.knowledgeSimplifierApiKey,
        ...(rateLimitCoordinator ? { rateLimitCoordinator } : {}),
      });
      return new ModelKnowledgeSimplifier(
        new GroqKnowledgeSimplifierModelRuntime(provider),
        GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
      );
    }
  }
}
