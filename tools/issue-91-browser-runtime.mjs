import { ConservativeConsultationInterpreter } from '../dist/src/intent/consultation-interpreter.js';
import { createRuntimeApp } from '../dist/src/runtime-app.js';
import { resolveRuntimeConfig } from '../dist/src/runtime-config.js';

const env = { ...process.env };
delete env.LATTICE_SOLANDRA_COGNITION_ROUTE;
delete env.GROQ_API_KEY;
delete env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL;
delete env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL;
delete env.LATTICE_MODEL_SIMULATOR_BASE_URL;
delete env.LATTICE_MODEL_SIMULATOR_MODEL;
env.PORT = process.env.ISSUE91_BROWSER_RUNTIME_PORT ?? '3107';
env.HOST = '127.0.0.1';

const config = resolveRuntimeConfig(env);
const app = await createRuntimeApp(config, {
  consultationInterpreter: new ConservativeConsultationInterpreter(),
});

await app.listen({ port: config.port, host: config.host });
console.log(`ISSUE91_NONCANONICAL_BROWSER_RUNTIME_READY port=${config.port}`);

let closing = false;
async function close(signal) {
  if (closing) return;
  closing = true;
  console.log(`ISSUE91_NONCANONICAL_BROWSER_RUNTIME_STOPPING signal=${signal}`);
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => void close('SIGTERM'));
process.on('SIGINT', () => void close('SIGINT'));
