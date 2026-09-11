import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const workflowDirectory = join(process.cwd(), '.github', 'workflows');
const coreWorkflowName = 'core-validation.yml';
const manualDeployedWorkflowName = 'deployed-functional-validation.yml';
const expectedDurableWorkflowNames = [
  'browser-lifecycle-validation.yml',
  'core-validation.yml',
  'postgres-integration-validation.yml',
  'render-blueprint-validation.yml',
];
const expectedWorkflowNames = [...expectedDurableWorkflowNames, manualDeployedWorkflowName].sort();

function workflowText(name: string): string {
  return readFileSync(join(workflowDirectory, name), 'utf8');
}

function executableCommandCount(text: string, command: string): number {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line === command || line === `run: ${command}`).length;
}

function topLevelWorkflowName(text: string): string {
  const match = text.match(/^name:\s*(.+)$/mu);
  assert.ok(match, 'workflow must declare a top-level name');
  return match[1]?.trim() ?? '';
}

const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const workflowEntries = workflowNames.map((name) => ({ name, text: workflowText(name) }));

test('CI retains four durable hosted lanes plus one separate manual deployed-validation lane', () => {
  assert.deepEqual(workflowNames, expectedWorkflowNames);
  assert.deepEqual(
    workflowNames.filter((name) => name !== manualDeployedWorkflowName),
    [...expectedDurableWorkflowNames].sort(),
  );
});

test('deployed functional validation is manual-only', () => {
  const text = workflowText(manualDeployedWorkflowName);
  assert.match(text, /^\s*workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(text, /^\s*push:\s*$/mu);
  assert.doesNotMatch(text, /^\s*pull_request:\s*$/mu);
});

test('manual deployed validation accepts only optional held-out case input and keeps it outside Product code', () => {
  const text = workflowText(manualDeployedWorkflowName);
  assert.match(text, /^\s+heldout_cases_json:\s*$/mu);
  assert.match(text, /tools\/deployed_heldout_validation\.py/u);
  assert.match(text, /deployed-heldout-black-box-/u);
  assert.doesNotMatch(text, /repository_dispatch|issue_comment|workflow_run|schedule:/u);
});

test('Core PR validation is the single ordinary full repository gate', () => {
  const core = workflowText(coreWorkflowName);
  assert.match(core, /^name: CI — Core Validation$/mu);
  assert.match(core, /^\s+name: Core PR validation$/mu);
  assert.equal(executableCommandCount(core, 'npm run check'), 1);

  for (const { name, text } of workflowEntries) {
    if (name === coreWorkflowName) continue;
    assert.equal(executableCommandCount(text, 'npm run check'), 0, `${name} must stay specialist`);
  }
});

test('specialist workflows report bounded evidence only', () => {
  const prohibitedPassClaim = /\b(?:MILESTONE_ACCEPTANCE|PRODUCT_ACCEPTANCE|PRODUCTION_READINESS)=PASS\b/u;
  for (const { name, text } of workflowEntries) {
    if (name === coreWorkflowName) continue;
    assert.doesNotMatch(text, prohibitedPassClaim, `${name} must not claim Product or production acceptance`);
  }
});

test('workflow identities are responsibility-based rather than milestone-based', () => {
  for (const { name, text } of workflowEntries) {
    assert.doesNotMatch(topLevelWorkflowName(text), /\bM\d+\b/u, `${name} must not use a milestone identity`);
  }
});

test('old team-era workflow identities remain retired', () => {
  const retiredFiles = [
    'windows-validation.yml',
    'postgres-persistence-validation.yml',
    'm7-browser-lifecycle-validation.yml',
    'local-model-ab-benchmark.yml',
    'android-prototype-validation.yml',
  ];
  for (const retiredFile of retiredFiles) {
    assert.equal(workflowNames.includes(retiredFile), false, `${retiredFile} must stay retired`);
  }

  for (const { name, text } of workflowEntries) {
    assert.doesNotMatch(
      text,
      /CI — Required Check Compatibility|Windows platform-neutral validation|Windows bounded prototype validation|legacy-platform-required-context/u,
      `${name} must not restore retired compatibility identities`,
    );
  }
});
