import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const workflowDirectory = join(process.cwd(), '.github', 'workflows');
const postgresImage = 'postgres:18.6@sha256:0377e72c5289ed2f98cf61b1a9c2db9eb9d300317fe14244492fbc94343b3d04';

const expectedActionPins = new Map<string, string>([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/setup-python', 'a26af69be951a213d495a4c3e4e4022e16d87065'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

const expectedRunners = new Map<string, string>([
  ['core-validation.yml', 'windows-latest'],
  ['postgres-integration-validation.yml', 'ubuntu-latest'],
  ['browser-lifecycle-validation.yml', 'ubuntu-latest'],
  ['live-solandra-cognition-validation.yml', 'ubuntu-latest'],
  ['render-blueprint-validation.yml', 'ubuntu-latest'],
  ['deployed-functional-validation.yml', 'ubuntu-latest'],
]);

const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

function workflowText(name: string): string {
  return readFileSync(join(workflowDirectory, name), 'utf8');
}

interface ExternalActionUse {
  ownerAndAction: string;
  ref: string;
}

function externalActionUses(text: string): ExternalActionUse[] {
  return [...text.matchAll(/^\s+uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#.*)?$/gmu)].map((match) => ({
    ownerAndAction: match[1] ?? '',
    ref: match[2] ?? '',
  }));
}

test('all external GitHub Actions are qualified full-SHA pins', () => {
  for (const workflowName of workflowNames) {
    const text = workflowText(workflowName);
    const actionUses = externalActionUses(text);

    for (const actionUse of actionUses) {
      const expectedPin = expectedActionPins.get(actionUse.ownerAndAction);
      assert.ok(expectedPin, `${workflowName} uses unqualified external action ${actionUse.ownerAndAction}`);
      assert.match(actionUse.ref, /^[0-9a-f]{40}$/u);
      assert.equal(actionUse.ref, expectedPin);
    }

    const checkoutCount = actionUses.filter(({ ownerAndAction }) => ownerAndAction === 'actions/checkout').length;
    const disabledCredentialPersistenceCount = text.match(/^\s+persist-credentials:\s*false$/gmu)?.length ?? 0;
    assert.equal(disabledCredentialPersistenceCount, checkoutCount, `${workflowName} must disable checkout credential persistence`);
    assert.doesNotMatch(text, /^\s+uses:\s+[^@\s]+@v\d+(?:\.\d+(?:\.\d+)?)?(?:\s+#.*)?$/gmu);
  }
});

test('all validation workflows use only standard GitHub-hosted runners', () => {
  assert.deepEqual(workflowNames, [...expectedRunners.keys()].sort());
  for (const [workflowName, runner] of expectedRunners) {
    const text = workflowText(workflowName);
    assert.match(text, new RegExp(`^\\s+runs-on:\\s*${runner}$`, 'mu'));
    assert.doesNotMatch(text, /self-hosted|lattice-windows|lattice-windows-pr-ephemeral/u);
  }
});

test('database workflows pin the same immutable PostgreSQL 18.6 linux-x64 image and retain runtime validation', () => {
  for (const workflowName of ['postgres-integration-validation.yml', 'browser-lifecycle-validation.yml']) {
    const text = workflowText(workflowName);
    assert.match(text, new RegExp(`^\\s+image:\\s*${postgresImage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'));
    assert.match(text, /^\s+POSTGRES_USER:\s*lattice$/mu);
    assert.match(text, /^\s+POSTGRES_DB:\s*lattice_test$/mu);
    assert.match(text, /^\s+- 55433:5432$/mu);
    assert.match(text, /show server_version_num/u);
    assert.match(text, /versionNumber < 180006 \|\| versionNumber >= 190000/u);
    assert.match(text, new RegExp(`POSTGRES_IMAGE_IDENTITY=${postgresImage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
    assert.doesNotMatch(text, /native-windows-postgresql/u);
  }
});

test('browser lane owns deterministic browser lifecycle evidence only', () => {
  const text = workflowText('browser-lifecycle-validation.yml');
  assert.equal(
    text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line === 'npm run check' || line === 'run: npm run check').length,
    0,
  );
  assert.match(text, /M7_BROWSER_EXECUTABLE=/u);
  assert.match(text, /node tools\/m7-browser-lifecycle\.mjs/u);
  assert.doesNotMatch(text, /artifacts\/issue91-m7-browser-lifecycle\.mjs/u);
  assert.match(text, /Start explicit noncanonical browser interpreter runtime/u);
  assert.match(text, /node tools\/issue-91-browser-runtime\.mjs/u);
  assert.match(text, /BROWSER_COGNITION_COMPOSITION=EXPLICIT_NONCANONICAL_INTERPRETER/u);
  assert.match(text, /M7_BASE_URL:\s*http:\/\/127\.0\.0\.1:3107/u);
  assert.match(text, /PORT:\s*'3108'/u);
  assert.doesNotMatch(text, /GROQ_API_KEY|issue-91-live-solandra-cognition|Live Solandra cognition qualification/u);
  assert.match(text, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\s+# v7\.0\.1/u);
  assert.match(text, /retention-days:\s*7/u);
});

test('live Solandra cognition qualification is separately serialized and narrowly triggered', () => {
  const text = workflowText('live-solandra-cognition-validation.yml');
  assert.match(text, /^name: CI — Live Solandra Cognition Qualification$/mu);
  assert.match(text, /node --import tsx tools\/issue-91-live-solandra-cognition\.mjs/u);
  assert.match(text, /^\s+group:\s*live-groq-openai-gpt-oss-120b$/mu);
  assert.match(text, /^\s+queue:\s*max$/mu);
  assert.doesNotMatch(text, /^\s+cancel-in-progress:\s*true$/mu);
  assert.match(text, /^\s+- "src\/model\/\*\*"$/mu);
  assert.match(text, /^\s+- "src\/solandra\/cognition\.ts"$/mu);
  assert.match(text, /^\s+- "src\/solandra\/cognition-composition\.ts"$/mu);
  assert.match(text, /^\s+- "src\/runtime-config\.ts"$/mu);
  assert.doesNotMatch(text, /^\s+- "src\/\*\*"$/mu);
  assert.match(text, /^\s*workflow_dispatch:\s*$/mu);
  assert.match(text, /LIVE_SOLANDRA_COGNITION_EVIDENCE=SPECIALIST_PROVIDER_QUALIFICATION/u);
  assert.match(text, /PRODUCT_ACCEPTANCE=NOT_CLAIMED_BY_LIVE_PROVIDER_LANE/u);
});

test('deployed validation separates event qualification from Product execution and classifies manual evidence', () => {
  const text = workflowText('deployed-functional-validation.yml');
  assert.match(text, /^\s+name:\s*Deployment event qualification$/mu);
  assert.match(text, /^\s+name:\s*Deployed Solandra functional validation$/mu);
  assert.match(text, /if: \$\{\{ needs\.event_qualification\.outputs\.should_run == 'true' \}\}/u);
  assert.match(text, /PRODUCT_VALIDATION=SKIPPED_NOT_REQUESTED/u);
  assert.match(text, /PRODUCT_EVIDENCE_BINDING=/u);
  assert.match(text, /PRODUCT_EXPECTED_DEPLOYED_SHA=/u);
  assert.match(text, /Deployed Product diagnostic \(unbound\)/u);
  assert.match(text, /Revalidate automatic preview revision/u);
});

test('Render lane is static, zero-cost, and credential-free', () => {
  const text = workflowText('render-blueprint-validation.yml');
  assert.match(text, /RENDER_BLUEPRINT_CONTRACT_VALIDATION=PASS/u);
  assert.ok(text.includes('/plan:\\s*(starter|standard|pro|enterprise|basic)/u'));
  assert.ok(text.includes('/preDeployCommand|LATTICE_AUTO_MIGRATE:\\s*true/u'));
  assert.doesNotMatch(text, /RENDER_API_KEY|RENDER_WORKSPACE|blueprints validate render\.yaml/u);
});
