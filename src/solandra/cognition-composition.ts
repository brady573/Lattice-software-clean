import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../model/groq-knowledge-simplifier.js";
import { LocalOfflineModelRuntime } from "../model/local-offline-runtime.js";
import { OpenAiCompatibleModelProvider } from "../model/openai-compatible.js";
import type { ModelRuntime } from "../model/runtime.js";
import type { RuntimeConfig } from "../runtime-config.js";
import { ModelSolandraAdvisoryRuntime, type SolandraAdvisoryRuntime } from "./advisory.js";
import { ModelSolandraActionPreparer, type SolandraActionPreparer } from "./action-preparer.js";
import { ModelSolandraCognitiveRuntime, type SolandraCognitiveRuntime } from "./cognition.js";
import { ModelSolandraKnowledgePresenter, type SolandraKnowledgePresenter } from "./knowledge-presenter.js";

export interface SolandraCognitionComposition {
  cognition: SolandraCognitiveRuntime;
  advisory: SolandraAdvisoryRuntime;
  actionPreparer: SolandraActionPreparer;
  knowledgePresenter: SolandraKnowledgePresenter;
  model: string;
}

function composition(runtime: ModelRuntime, model: string): SolandraCognitionComposition {
  return Object.freeze({
    cognition: new ModelSolandraCognitiveRuntime(runtime, model),
    advisory: new ModelSolandraAdvisoryRuntime(runtime, model),
    actionPreparer: new ModelSolandraActionPreparer(runtime, model),
    knowledgePresenter: new ModelSolandraKnowledgePresenter(runtime, model),
    model,
  });
}

/**
 * Configure Solandra's Product cognition role independently from the A2
 * user-authorized model-assistance capability. Reusing provider machinery never
 * grants that provider intent, truth, decision, or authorization authority.
 */
export function createConfiguredSolandraCognition(
  config: RuntimeConfig,
): SolandraCognitionComposition | undefined {
  if (config.solandraCognitionRoute === "groq-gpt-oss-120b") {
    if (!config.solandraCognitionApiKey) {
      throw new Error("Configured Solandra cognition route is missing its runtime credential.");
    }
    const runtime = new GroqKnowledgeSimplifierModelRuntime(
      new GroqKnowledgeSimplifierModelProvider({ apiKey: config.solandraCognitionApiKey }),
    );
    return composition(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  }

  if (config.localModelProviderBaseUrl !== undefined && config.localModelProviderModel !== undefined) {
    const runtime = new LocalOfflineModelRuntime(
      new OpenAiCompatibleModelProvider({ baseUrl: config.localModelProviderBaseUrl }),
    );
    return composition(runtime, config.localModelProviderModel);
  }

  return undefined;
}
