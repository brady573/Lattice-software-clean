import { assertDurableProcessSchemaReady } from "../runtime-schema-readiness.js";
import { resolveRuntimeConfig } from "../runtime-config.js";
import { createDevelopmentRuntimeApp } from "./development-runtime-app.js";

try {
  const config = resolveRuntimeConfig();
  if (config.deploymentMode !== "development") {
    throw new Error("The prototype entrypoint requires LATTICE_DEPLOYMENT_MODE=development.");
  }
  if (config.databaseUrl && !config.autoMigrate) {
    await assertDurableProcessSchemaReady(config.databaseUrl, "api");
  }
  const app = await createDevelopmentRuntimeApp(config);
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exitCode = 1;
  }
} catch (error) {
  console.error("LATTICE_DEVELOPMENT_PROTOTYPE_START_FAILED", error);
  process.exitCode = 1;
}
