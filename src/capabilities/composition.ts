import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../model/groq-knowledge-simplifier.js";
import type { RuntimeConfig } from "../runtime-config.js";
import {
  MemoryCapabilityAuthorizationStore,
  PostgresCapabilityAuthorizationStore,
} from "./authorization-store.js";
import { CapabilityBroker } from "./broker.js";
import { UserAuthorizedModelCapability } from "./user-model-capability.js";

export interface CapabilityBrokerComposition {
  readonly broker: CapabilityBroker;
  readonly userModelConfigured: boolean;
}

/**
 * Compose the Product-facing broker independently from A2 authorization.
 * M3 may reuse the same underlying configured provider/model as Solandra, but
 * the user-model capability has its own context, purpose, grant, and audit path.
 */
export async function createConfiguredCapabilityBroker(
  config: RuntimeConfig,
): Promise<CapabilityBrokerComposition> {
  const store = config.databaseUrl === undefined
    ? new MemoryCapabilityAuthorizationStore()
    : await (async () => {
      if (config.autoMigrate) await PostgresCapabilityAuthorizationStore.migrate(config.databaseUrl!);
      return await PostgresCapabilityAuthorizationStore.connect(config.databaseUrl!);
    })();

  const broker = new CapabilityBroker(store);
  if (config.solandraCognitionRoute === "groq-gpt-oss-120b") {
    if (!config.solandraCognitionApiKey) throw new Error("Configured Solandra provider machinery is missing its runtime credential.");
    const runtime = new GroqKnowledgeSimplifierModelRuntime(
      new GroqKnowledgeSimplifierModelProvider({ apiKey: config.solandraCognitionApiKey }),
    );
    broker.register(new UserAuthorizedModelCapability(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL));
    return Object.freeze({ broker, userModelConfigured: true });
  }

  return Object.freeze({ broker, userModelConfigured: false });
}
