import { createRuntimeApp } from '../dist/src/runtime-app.js';
import { resolveRuntimeConfig } from '../dist/src/runtime-config.js';

const correctedObjective = 'Plan a quiet reading corner that works in a shared living room without taking over the whole space.';

const PROVENANCE = Object.freeze({
  executionClass: 'LOCAL_OFFLINE',
  routeMode: 'PINNED',
  requestedProvider: 'pr122-browser-cognition-fixture',
  requestedModel: 'pr122-browser-cognition-fixture',
  actualProvider: 'pr122-browser-cognition-fixture',
  actualModel: 'pr122-browser-cognition-fixture',
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: 'pr122-browser-cognition-fixture-request',
  routeProvenance: 'COMPLETE',
});

function proposal(overrides = {}) {
  return {
    objectiveRelation: 'CONTINUE',
    proposedObjective: null,
    requestedHelp: 'KNOWLEDGE',
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    referencedOptionId: null,
    referencedIntentProposalId: null,
    ...overrides,
  };
}

class BrowserNaturalConfirmationCognition {
  async interpret(input) {
    if (input.pendingIntentProposal) {
      console.log(`ISSUE91_BROWSER_COGNITION_CONFIRM proposalId=${input.pendingIntentProposal.proposalId}`);
      return {
        mode: 'GOVERNED',
        proposal: proposal({
          objectiveRelation: 'CONTINUE',
          requestedHelp: 'CONFIRM_INTENT',
          referencedIntentProposalId: input.pendingIntentProposal.proposalId,
        }),
        invocationProvenance: PROVENANCE,
      };
    }

    if (!input.currentObjective) {
      return {
        mode: 'GOVERNED',
        proposal: proposal({
          objectiveRelation: 'NEW_OBJECTIVE',
          proposedObjective: input.message,
        }),
        invocationProvenance: PROVENANCE,
      };
    }

    return {
      mode: 'GOVERNED',
      proposal: proposal({
        objectiveRelation: 'CORRECTION',
        proposedObjective: correctedObjective,
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

const env = { ...process.env };
delete env.LATTICE_SOLANDRA_COGNITION_ROUTE;
delete env.GROQ_API_KEY;
delete env.LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL;
delete env.LATTICE_LOCAL_MODEL_PROVIDER_MODEL;
delete env.LATTICE_MODEL_SIMULATOR_BASE_URL;
delete env.LATTICE_MODEL_SIMULATOR_MODEL;
env.PORT = process.env.PR122_BROWSER_RUNTIME_PORT ?? '3117';
env.HOST = '127.0.0.1';

const config = resolveRuntimeConfig(env);
const app = await createRuntimeApp(config, {
  solandraCognition: new BrowserNaturalConfirmationCognition(),
  memoryDispatchDelayMs: 5,
});

await app.listen({ port: config.port, host: config.host });
console.log(`PR122_BROWSER_VALIDATION_RUNTIME_READY port=${config.port}`);

let closing = false;
async function close(signal) {
  if (closing) return;
  closing = true;
  console.log(`PR122_BROWSER_VALIDATION_RUNTIME_STOPPING signal=${signal}`);
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => void close('SIGTERM'));
process.on('SIGINT', () => void close('SIGINT'));
