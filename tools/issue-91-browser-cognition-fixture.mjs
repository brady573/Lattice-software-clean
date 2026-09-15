import { createServer } from 'node:http';

const port = Number.parseInt(process.env.ISSUE91_BROWSER_COGNITION_PORT ?? '3110', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid fixture port.');

const knowledgeMessage = 'Explain the tradeoffs of keeping a local-first hobby app simple while preserving recoverability.';
const resourceMessage = 'Prepare a checklist for reviewing a risky configuration change before I apply it.';

const responses = [
  {
    mode: 'GOVERNED',
    projection: {
      objectiveRelation: 'NEW_OBJECTIVE',
      proposedObjective: knowledgeMessage,
      requestedHelp: 'KNOWLEDGE',
      relevantContext: [],
      entities: [],
      referents: [],
      constraints: [],
      preferences: [],
      knowledgeNeeds: ['Tradeoffs between local-first simplicity and recoverability.'],
      materialAmbiguity: null,
      referencedKnowledgeId: null,
      referencedRecommendationId: null,
      referencedOptionId: null,
    },
  },
  {
    mode: 'GOVERNED',
    projection: {
      objectiveRelation: 'NEW_OBJECTIVE',
      proposedObjective: resourceMessage,
      requestedHelp: 'RESOURCE',
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
    },
  },
];

let callIndex = 0;

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok', calls: callIndex });
    return;
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    json(response, 404, { error: 'NOT_FOUND' });
    return;
  }

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      json(response, 400, { error: 'INVALID_JSON' });
      return;
    }
    if (parsed?.model !== 'issue91-browser-cognition-fixture') {
      json(response, 400, { error: 'UNEXPECTED_MODEL' });
      return;
    }
    const output = responses[callIndex];
    if (!output) {
      json(response, 409, { error: 'UNEXPECTED_MODEL_CALL', calls: callIndex + 1 });
      return;
    }
    callIndex += 1;
    json(response, 200, {
      id: `issue91-browser-fixture-${callIndex}`,
      object: 'chat.completion',
      created: 0,
      model: 'issue91-browser-cognition-fixture',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(output) },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
console.log(`ISSUE91_BROWSER_COGNITION_FIXTURE_READY port=${port}`);

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
