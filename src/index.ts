import { createConfiguredKnowledgeSimplifier } from "./knowledge-simplifier-composition.js";
import { createRuntimeApp } from "./runtime-app.js";
import { resolveRuntimeConfig } from "./runtime-config.js";
import { assertDurableProcessSchemaReady } from "./runtime-schema-readiness.js";

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

  const configuredKnowledgeSimplifier = createConfiguredKnowledgeSimplifier(config);
  const app = await createRuntimeApp(
    config,
    configuredKnowledgeSimplifier === undefined
      ? {}
      : { knowledgeSimplifier: configuredKnowledgeSimplifier },
  );
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
