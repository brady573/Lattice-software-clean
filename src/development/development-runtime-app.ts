import type { FastifyInstance } from "fastify";
import {
  LocalOfflineModelRuntime,
  OpenAiCompatibleModelProvider,
  AndroidRelayModelProvider,
  ModelRuntime,
} from "../model/index.js";
import { registerAndroidModelPrototype } from "../prototype/android-model-prototype.js";
import { createRuntimeApp, type RuntimeAppOptions } from "../runtime-app.js";
import type { RuntimeConfig } from "../runtime-config.js";
import { registerDevelopmentModelConversationPrototype } from "./development-prototype-app.js";

/**
 * Explicit opt-in composition for development simulators. The production
 * entrypoint and canonical RuntimeApp never import this module.
 */
export async function createDevelopmentRuntimeApp(
  config: RuntimeConfig,
  options: RuntimeAppOptions = {},
): Promise<FastifyInstance> {
  if (config.deploymentMode !== "development") {
    throw new Error("Development prototype routes require development deployment mode.");
  }
  const app = await createRuntimeApp(config, options);
  const modelProviderBaseUrl = config.localModelProviderBaseUrl ?? config.modelSimulatorBaseUrl;
  if (modelProviderBaseUrl !== undefined) {
    registerDevelopmentModelConversationPrototype(app, {
      modelRuntime: new LocalOfflineModelRuntime(new OpenAiCompatibleModelProvider({ baseUrl: modelProviderBaseUrl })),
      modelName: config.localModelProviderModel ?? config.modelSimulatorModel,
    });
  }
  if (config.androidModelRelayToken !== undefined) {
    const provider = new AndroidRelayModelProvider({ timeoutMs: config.androidModelRelayTimeoutMs });
    registerAndroidModelPrototype(app, {
      provider,
      runtime: new ModelRuntime(provider, { timeoutMs: config.androidModelRelayTimeoutMs + 5_000 }),
      modelName: config.androidModelRelayModel,
      relayToken: config.androidModelRelayToken,
    });
  }
  return app;
}
