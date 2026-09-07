import { createAlphaDecisionRuntimeComposition } from "./decision/alpha-decision-composition.js";
import { registerModelAssistanceApi } from "./model-assistance-api.js";
import { createConfiguredModelAssistanceCapability } from "./model-assistance-composition.js";
import { createRuntimeApp } from "./runtime-app.js";
import { resolveRuntimeConfig } from "./runtime-config.js";
import { assertDurableProcessSchemaReady } from "./runtime-schema-readiness.js";
import { createConfiguredSolandraCognition } from "./solandra/cognition-composition.js";

try {
  const config = resolveRuntimeConfig();
  if (config.deploymentMode === "durable" && config.autoMigrate) {
    throw new Error(
      "Durable API startup forbids LATTICE_AUTO_MIGRATE=true; run the authorized db:migrate command before starting durable processes.",
    );
  }
  if (config.databaseUrl && !config.autoMigrate) {
    await assertDurableProcessSchemaReady(config.databaseUrl, "api");
  }

  const modelAssistance = await createConfiguredModelAssistanceCapability(config);
  const decisionCapability = createAlphaDecisionRuntimeComposition();
  const solandra = createConfiguredSolandraCognition(config);
  let app;
  try {
    app = await createRuntimeApp(config, {
      ...decisionCapability,
      modelAssistanceService: modelAssistance,
      ...(solandra === undefined ? {} : {
        solandraCognition: solandra.cognition,
        solandraAdvisory: solandra.advisory,
        solandraKnowledgePresenter: solandra.knowledgePresenter,
      }),
    });
  } catch (error) {
    await modelAssistance.close();
    throw error;
  }
  registerModelAssistanceApi(app, modelAssistance);
  app.addHook("onClose", async () => {
    await modelAssistance.close();
  });

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exitCode = 1;
  }
} catch (error) {
  console.error("LATTICE_API_START_FAILED", error);
  process.exitCode = 1;
}
