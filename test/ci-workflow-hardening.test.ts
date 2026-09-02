import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const workflowDirectory = join(process.cwd(), '.github', 'workflows');

const expectedActionPins = new Map<string, string>([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

const prSelfHostedWorkflows = [
  'windows-validation.yml',
  'postgres-persistence-validation.yml',
  'render-blueprint-validation.yml',
  'm7-browser-lifecycle-validation.yml',
] as const;

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
      assert.ok(
        expectedPin,
        `${workflowName} uses unqualified external action ${actionUse.ownerAndAction}`,
      );
      assert.match(
        actionUse.ref,
        /^[0-9a-f]{40}$/u,
        `${workflowName} must pin ${actionUse.ownerAndAction} by full commit SHA`,
      );
      assert.equal(
        actionUse.ref,
        expectedPin,
        `${workflowName} must use the currently qualified pin for ${actionUse.ownerAndAction}`,
      );
    }

    const checkoutCount = actionUses.filter(({ ownerAndAction }) => ownerAndAction === 'actions/checkout').length;
    const disabledCredentialPersistenceCount =
      text.match(/^\s+persist-credentials:\s*false$/gmu)?.length ?? 0;
    assert.equal(
      disabledCredentialPersistenceCount,
      checkoutCount,
      `${workflowName} must keep persist-credentials: false for every checkout`,
    );
    assert.doesNotMatch(
      text,
      /^\s+uses:\s+[^@\s]+@v\d+(?:\.\d+(?:\.\d+)?)?(?:\s+#.*)?$/gmu,
      `${workflowName} must not use movable major/version tags for external actions`,
    );
  }
});

test('fork pull requests cannot target the persistent Windows runner in PR-triggered lanes', () => {
  const forkRunnerExpression =
    "${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository && 'lattice-windows-pr-ephemeral' || 'lattice-windows' }}";

  for (const workflowName of prSelfHostedWorkflows) {
    const text = workflowText(workflowName);
    assert.match(text, /^\s{2}pull_request:/mu, `${workflowName} must retain pull-request validation`);
    assert.ok(
      text.includes(forkRunnerExpression),
      `${workflowName} must route fork pull requests to lattice-windows-pr-ephemeral`,
    );
  }
});

test('PostgreSQL execution surfaces enforce the patched PostgreSQL 18.6 security floor', () => {
  for (const workflowName of [
    'postgres-persistence-validation.yml',
    'm7-browser-lifecycle-validation.yml',
  ]) {
    const text = workflowText(workflowName);
    assert.match(text, /\$minimumPostgresVersionNum\s*=\s*180006/u);
    assert.match(text, /\$serverVersionNumber\s+-lt\s+\$minimumPostgresVersionNum/u);
    assert.match(text, /\$serverVersionNumber\s+-ge\s+190000/u);
    assert.doesNotMatch(text, /\.StartsWith\('18'\)/u);
  }
});

test("Render lane validates render.yaml against Render's official schema without account credentials", () => {
  const text = workflowText('render-blueprint-validation.yml');

  assert.match(text, /Install locked repository dependencies/u);
  assert.match(text, /npm ci --no-audit --no-fund/u);
  assert.match(text, /\$ajvVersion\s*=\s*\(node -p "require\('ajv\/package\.json'\)\.version"\)\.Trim\(\)/u);
  assert.match(text, /\$ajvFormatsVersion\s*=\s*\(node -p "require\('ajv-formats\/package\.json'\)\.version"\)\.Trim\(\)/u);
  assert.match(text, /\$ajvVersion -ne '8\.20\.0' -or \$ajvFormatsVersion -ne '3\.0\.1'/u);
  assert.match(text, /https:\/\/render\.com\/schema\/render\.yaml\.json/u);
  assert.match(text, /npx --yes yaml@2\.9\.0 --single --json/u);
  assert.match(text, /Join-Path \(Get-Location\) '\.render-schema-validator\.cjs'/u);
  assert.match(text, /require\('ajv\/dist\/2020'\)\.default/u);
  assert.match(text, /require\('ajv-formats'\)/u);
  assert.match(text, /schema\.\$id !== 'https:\/\/render\.com\/schema\/render\.yaml\.json'/u);
  assert.match(text, /schema\.\$schema !== 'https:\/\/json-schema\.org\/draft\/2020-12\/schema'/u);
  assert.match(text, /RENDER_CLI_SEMANTIC_VALIDATION=NOT_CLAIMED_BY_THIS_LANE/u);
  assert.doesNotMatch(text, /actions\/setup-python@/u);
  assert.doesNotMatch(text, /RENDER_API_KEY|RENDER_WORKSPACE|blueprints validate render\.yaml/u);
});

test('benchmark artifact upload is on the qualified Node 24 generation', () => {
  const text = workflowText('local-model-ab-benchmark.yml');

  assert.match(
    text,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\s+# v7\.0\.1/u,
  );
  assert.doesNotMatch(text, /actions\/upload-artifact@v4/u);
});
