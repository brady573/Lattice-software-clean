import { PostgresCapabilityAuthorizationStore } from "./capabilities/authorization-store.js";
import { migrateRuntimeDatabase } from "./runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for db:migrate.");
}

await migrateRuntimeDatabase(databaseUrl);
await PostgresCapabilityAuthorizationStore.migrate(databaseUrl);
console.log("LATTICE_SCHEMA_MIGRATION=PASS");
