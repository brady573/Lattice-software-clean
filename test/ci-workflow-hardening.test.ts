import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const WORKFLOW_DIR = '.github/workflows';
const HOSTED_RUNNER_PATTERN = /^\s*runs-on:\s*(?:ubuntu|windows|macos)-[^\s#]+\s*$/gmu;
const EXTERNAL_ACTION_PATTERN = /^\s*uses:\s*([^\s@]+)@([^\s#]+)(?:\s+#\s*(.*))?$/gmu;
const QUALIFIED_EXTERNAL_ACTIONS = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/setup-python', 'a26af69be951a213d495a4c3e4e4022e16d87065'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

function workflowText(name: string): string {
  return readFileSync(`${WORKFLOW_DIR}/${name}`, 'utf8');
}

const workflowNames = [
  'browser-lifecycle-validation.yml',
  'core-validation.yml',
  'deployed-functional-validation.yml',
  'postgres-integration-validation.yml',
  'render-blueprint-validation.yml',
];

test('all external GitHub Actions are qualified full-SHA pins', () => {
  for (const workflowName of workflowNames) {
    const text = workflowText(workflowName);
    for (const match of text.matchAll(EXTERNAL_ACTION_PATTERN)) {
      const action = match[1];
      const ref = match[2];
      assert.ok(action && ref, `${workflowName}: malformed action use`);
      assert.match(ref, /^[0-9a-f]{40}$/u, `${workflowName}: ${action} is not pinned to a full SHA`);
      const qualified = QUALIFIED_EXTERNAL_ACTIONS.get(action);
      assert.ok(qualified, `${workflowName}: ${action} is not in the qualified action set`);
      assert.equal(ref, qualified, `${workflowName}: ${action} pin drifted from the qualified SHA`);
    }
  }
});

test('all validation workflows use only standard GitHub-hosted runners', () => {
  for (const workflowName of workflowNames) {
    const text = workflowText(workflowName);
    const runners = [...text.matchAll(HOSTED_RUNNER_PATTERN)].map((match) => match[0]?.trim());
    assert.ok(runners.length > 0, `${workflowName}: no hosted runner declaration found`);
    for (const runner of runners) assert.match(runner ?? '', /^runs-on:\s*(?:ubuntu|windows|macos)-/u);
    assert.doesNotMatch(text, /self-hosted/u);
  }
});

test('database workflows use an isolated PostgreSQL 18.6 service', () => {
  for (const workflowName of ['postgres-integration-validation.yml', 'browser-lifecycle-validation.yml']) {
    const text = workflowText(workflowName);
    assert.match(text, /^\s+image:\s*postgres:18\.6$/mu);
    assert.match(text, /^\s+POSTGRES_USER:\s*lattice$/mu);
    assert.match(text, /^\s+POSTGRES_DB:\s*lattice_test$/mu);
    assert.match(text, /^\s+- 55433:5432$/mu);
    assert.match(text, /versionNumber < 180006 \|\| versionNumber >= 190000/u);
    assert.doesNotMatch(text, /native-windows-postgresql/u);
  }
});

test('browser lane is bounded to browser behavior and short-lived evidence', () => {
  const text = workflowText('browser-lifecycle-validation.yml');
  assert.equal(
    text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line === 'npm run check' || line === 'run: npm run check').length,
    0,
  );
  assert.match(text, /M7_BROWSER_EXECUTABLE=/u);
  assert.match(text, /readFileSync\('tools\/m7-browser-lifecycle\.mjs'/u);
  assert.match(text, /node artifacts\/issue91-m7-browser-lifecycle\.mjs/u);
  assert.match(text, /node tools\/issue-46-browser-prepared-message\.mjs/u);
  assert.match(text, /git diff --exit-code/u);
  assert.match(text, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\s+# v7\.0\.1/u);
  assert.match(text, /retention-days:\s*7/u);
});

test('Render lane is static, zero-cost, and credential-free', () => {
  const text = workflowText('render-blueprint-validation.yml');
  assert.match(text, /RENDER_BLUEPRINT_CONTRACT_VALIDATION=PASS/u);
  assert.ok(text.includes('/plan:\\s*(starter|standard|pro|enterprise|basic)/u'));
  assert.ok(text.includes('/preDeployCommand|LATTICE_AUTO_MIGRATE:\\s*true/u'));
  assert.doesNotMatch(text, /RENDER_API_KEY|RENDER_WORKSPACE|blueprints validate render\.yaml/u);
});

test('CI retains four durable hosted lanes plus one separate manual deployed-validation lane', () => {
  assert.deepEqual(workflowNames.sort(), [
    'browser-lifecycle-validation.yml',
    'core-validation.yml',
    'deployed-functional-validation.yml',
    'postgres-integration-validation.yml',
    'render-blueprint-validation.yml',
  ]);
});

test('deployed functional validation is manual-only', () => {
  const text = workflowText('deployed-functional-validation.yml');
  assert.match(text, /^\s*workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(text, /^\s*pull_request:\s*$/mu);
  assert.doesNotMatch(text, /^\s*push:\s*$/mu);
});

test('Core PR validation is the single ordinary full repository gate', () => {
  const core = workflowText('core-validation.yml');
  assert.match(core, /npm run check/u);
  for (const workflowName of workflowNames.filter((name) => name !== 'core-validation.yml')) {
    const text = workflowText(workflowName);
    assert.equal(
      text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line === 'npm run check' || line === 'run: npm run check').length,
      0,
      `${workflowName}: full repository validation belongs only in Core`,
    );
  }
});

test('specialist workflows report bounded evidence only', () => {
  const browser = workflowText('browser-lifecycle-validation.yml');
  assert.match(browser, /BROWSER_LIFECYCLE=PASS/u);
  assert.match(browser, /PRODUCTION_DEPLOYMENT=NOT_PERFORMED/u);
  assert.match(browser, /PRODUCTION_DATABASE=NOT_TOUCHED/u);

  const postgres = workflowText('postgres-integration-validation.yml');
  assert.match(postgres, /POSTGRES_INTEGRATION=PASS/u);
  assert.match(postgres, /BROWSER_E2E=NOT_CLAIMED_BY_POSTGRES_LANE/u);

  const render = workflowText('render-blueprint-validation.yml');
  assert.match(render, /RENDER_BLUEPRINT_CONTRACT_VALIDATION=PASS/u);
});

test('workflow identities are responsibility-based rather than milestone-based', () => {
  for (const workflowName of workflowNames) {
    const text = workflowText(workflowName);
    assert.doesNotMatch(text, /M\d+-|milestone|acceptance gate/iu);
  }
});

test('old team-era workflow identities remain retired', () => {
  for (const workflowName of workflowNames) {
    const text = workflowText(workflowName);
    assert.doesNotMatch(text, /team-a|team-b|copilot/iu);
  }
});
