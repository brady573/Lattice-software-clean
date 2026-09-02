import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();
const workflowDirectory = join(repositoryRoot, '.github', 'workflows');
const coreWorkflowName = 'windows-validation.yml';
const m7ExceptionName = 'm7-browser-lifecycle-validation.yml';
const frozenM7BlobSha = '6afd1cfed12fdae76e69952c4b65ab390b2ae162';

function workflowPath(name: string): string {
  return join(workflowDirectory, name);
}

function workflowText(name: string): string {
  return readFileSync(workflowPath(name), 'utf8');
}

function executableCommandCount(text: string, command: string): number {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line === command || line === `run: ${command}`).length;
}

function committedWorkflowBlobSha(name: string): string {
  const relativePath = `.github/workflows/${name}`;
  const sha = execFileSync('git', ['rev-parse', `HEAD:${relativePath}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/u, `unable to resolve committed blob identity for ${relativePath}`);
  return sha;
}

function topLevelWorkflowName(text: string): string {
  const match = text.match(/^name:\s*(.+)$/mu);
  assert.ok(match, 'workflow must declare a top-level name');
  const workflowName = match[1];
  assert.ok(workflowName, 'workflow top-level name must not be empty');
  return workflowName.trim();
}

const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflowEntries = workflowNames.map((name) => ({ name, text: workflowText(name) }));

test('Core PR validation is the single ordinary full repository gate', () => {
  const core = workflowText(coreWorkflowName);

  assert.match(core, /^name: CI — Core Validation$/mu);
  assert.match(core, /^\s+name: Core PR validation$/mu);
  assert.equal(
    executableCommandCount(core, 'npm run check'),
    1,
    'Core PR validation must execute npm run check exactly once',
  );

  for (const { name, text } of workflowEntries) {
    if (name === coreWorkflowName || name === m7ExceptionName) {
      continue;
    }
    assert.equal(
      executableCommandCount(text, 'npm run check'),
      0,
      `${name} must not acquire the ordinary full repository gate`,
    );
  }
});

test('specialist workflows cannot promote their bounded evidence to Product acceptance', () => {
  const prohibitedPassClaim = /\b(?:MILESTONE_ACCEPTANCE|PRODUCT_ACCEPTANCE|PRODUCTION_READINESS)=PASS\b/u;

  for (const { name, text } of workflowEntries) {
    if (name === coreWorkflowName || name === m7ExceptionName) {
      continue;
    }
    assert.doesNotMatch(
      text,
      prohibitedPassClaim,
      `${name} must not emit milestone, Product, or production-readiness PASS claims`,
    );
  }
});

test('new workflow identities are responsibility-based rather than milestone-based', () => {
  for (const { name, text } of workflowEntries) {
    if (name === m7ExceptionName) {
      continue;
    }
    assert.doesNotMatch(
      topLevelWorkflowName(text),
      /\bM\d+\b/u,
      `${name} must not use a milestone as its durable workflow identity`,
    );
  }
});

test('retired required-context compatibility shims do not re-enter the workflow architecture', () => {
  const core = workflowText(coreWorkflowName);
  assert.doesNotMatch(core, /Windows platform-neutral validation|legacy-platform-required-context/u);
  assert.equal(
    workflowNames.includes('android-prototype-validation.yml'),
    false,
    'retired Android/prototype compatibility workflow must stay deleted',
  );

  for (const { name, text } of workflowEntries) {
    assert.doesNotMatch(
      text,
      /CI — Required Check Compatibility|Windows bounded prototype validation/u,
      `${name} must not restore retired required-context compatibility identities`,
    );
  }
});

test('research benchmark is manual and validates its own harness instead of owning Core validation', () => {
  const benchmark = workflowText('local-model-ab-benchmark.yml');

  assert.doesNotMatch(benchmark, /^\s{2}pull_request:/mu);
  assert.match(benchmark, /^\s{2}workflow_dispatch:$/mu);
  assert.equal(executableCommandCount(benchmark, 'npm run check'), 0);
  assert.match(benchmark, /^\s+node --check tools\/local-model-ab-benchmark\.mjs$/mu);
  assert.match(
    benchmark,
    /^\s+node --import tsx --test test\/local-model-ab-benchmark\.test\.ts$/mu,
  );
});

test('current M7 catch-all is a frozen explicit exception, not expandable architecture', () => {
  const currentBlobSha = committedWorkflowBlobSha(m7ExceptionName);
  assert.equal(
    currentBlobSha,
    frozenM7BlobSha,
    'M7 workflow changed: reconcile the dedicated browser responsibility and this explicit exception instead of silently expanding it',
  );
});
