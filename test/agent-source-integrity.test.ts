import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const agentsDirectory = join(repoRoot, '.opencode', 'agents');

const promptNames = ['lattice-steward.md', 'coding-agent.md', 'validator-agent.md'] as const;

const stewardStateDirectory = '.opencode/steward-state';
const stewardStateFiles = [
  '00-STEWARD-STATE-README.md',
  'CURRENT-STATE.md',
  'ACTIVE-OBJECTIVE.md',
  'EVIDENCE-LOG.md',
  'DRIFT-LOG.md',
  'AUDIT-HISTORY.md',
] as const;

const nonAuthoritativeBanner =
  'NON-AUTHORITATIVE STEWARD STATE — This file records observations or working state only. It cannot define Lattice Product truth, requirements, architecture, acceptance, or philosophy. The Core Lattice Philosophy governs.';

const sourceDirectoryContracts = [
  {
    directory: '.opencode/lattice/sources',
    expectedIds: [
      'CA-00',
      'CA-01',
      'CA-02',
      'CA-03',
      'CA-04',
      'CA-05',
      'CA-06',
      'LAT-SHARED-00',
      'LAT-SHARED-01',
      'LAT-SHARED-02',
      'TRACE-00',
    ],
  },
  {
    directory: '.opencode/steward/sources',
    expectedIds: [
      'LAT-SHARED-00',
      'LAT-SHARED-01',
      'LAT-SHARED-02',
      'ST-00',
      'ST-01',
      'ST-02',
      'ST-03',
      'ST-04',
      'ST-05',
      'ST-06',
      'TRACE-00',
    ],
  },
  {
    directory: '.opencode/validator-sources',
    expectedIds: [
      'CV-00',
      'CV-01',
      'CV-02',
      'CV-03',
      'CV-04',
      'CV-AUDIT-00',
      'CV-TRACE-00',
      'LAT-SHARED-00',
      'LAT-SHARED-01',
      'LAT-SHARED-02',
    ],
  },
] as const;

// A stable source file name is a bare identifier. Descriptive titles belong in
// the file's H1, where renaming a title cannot break a reference.
const bareIdentifierFileName = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\.md$/u;

const markdownReferencePattern =
  /(?<![A-Za-z0-9._/-])((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md)(?![A-Za-z0-9])/gu;

const openCodeTokenPattern = /(?<![A-Za-z0-9._/-])(\.opencode\/[A-Za-z0-9._/-]+)/gu;

function toRepoPath(absolutePath: string): string {
  return relative(repoRoot, absolutePath).split(sep).join('/');
}

function isFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function findFileByName(directory: string, name: string, depth = 0): string | null {
  if (depth > 4 || !isDirectory(directory)) return null;

  let entries: string[] = [];
  try {
    entries = readdirSync(directory);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(directory, entry);
    if (isDirectory(full)) {
      const hit = findFileByName(full, name, depth + 1);
      if (hit !== null) return hit;
      continue;
    }
    if (entry === name) return full;
  }
  return null;
}

/**
 * Read a repository text file with line endings normalized to LF.
 *
 * Checkouts are not line-ending stable: GitHub's Windows runners materialize
 * CRLF, Linux and macOS checkouts stay LF. Asserting on raw bytes would make
 * this guard pass or fail purely on the runner's platform. Normalizing here
 * keeps every downstream pattern platform-independent.
 */
function readNormalized(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

function promptText(name: string): string {
  const path = join(agentsDirectory, name);
  assert.ok(existsSync(path), `${name} must be committed under .opencode/agents/ so its sources are reviewable`);
  return readNormalized(path);
}

/** Directories a prompt declares, discovered from its own text rather than hardcoded. */
function declaredOpenCodeDirectories(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(openCodeTokenPattern)) {
    const token = match[1];
    if (token === undefined) continue;
    const normalized = token.replace(/\/+$/u, '');
    if (isDirectory(join(repoRoot, normalized))) found.add(normalized);
  }
  return [...found].sort();
}

function referencedMarkdownPaths(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(markdownReferencePattern)) {
    const token = match[1];
    if (token !== undefined) found.add(token);
  }
  return [...found].sort();
}

/**
 * A path-qualified reference must resolve at exactly that repository path.
 * A bare filename may resolve in a directory the prompt itself declares, at the
 * repository root, or once inside docs/.
 */
function resolveReference(reference: string, declaredDirectories: readonly string[]): string | null {
  if (reference.includes('/')) {
    const exact = join(repoRoot, reference);
    return isFile(exact) ? toRepoPath(exact) : null;
  }

  for (const directory of declaredDirectories) {
    const candidate = join(repoRoot, directory, reference);
    if (isFile(candidate)) return toRepoPath(candidate);
  }

  const atRoot = join(repoRoot, reference);
  if (isFile(atRoot)) return toRepoPath(atRoot);

  const inDocs = findFileByName(join(repoRoot, 'docs'), reference);
  return inDocs === null ? null : toRepoPath(inDocs);
}

const promptEntries = promptNames.map((name) => {
  const text = promptText(name);
  return {
    name,
    text,
    declaredDirectories: declaredOpenCodeDirectories(text),
    references: referencedMarkdownPaths(text),
  };
});

test('every agent prompt declares at least one real source directory', () => {
  for (const { name, declaredDirectories } of promptEntries) {
    assert.ok(
      declaredDirectories.length > 0,
      `${name} must name a real .opencode/ directory so its sources can be resolved`,
    );
  }
});

test('every markdown path named by a committed agent prompt resolves', () => {
  const unresolved: string[] = [];

  for (const { name, declaredDirectories, references } of promptEntries) {
    assert.ok(references.length > 0, `${name} must reference at least one markdown source`);
    for (const reference of references) {
      if (resolveReference(reference, declaredDirectories) === null) {
        unresolved.push(`${name} -> ${reference}`);
      }
    }
  }

  assert.deepEqual(unresolved, [], 'agent prompts must not name unresolvable markdown paths');
});

test('agent source directories keep the expected stable identifier file set', () => {
  for (const { directory, expectedIds } of sourceDirectoryContracts) {
    const absolute = join(repoRoot, directory);
    assert.ok(isDirectory(absolute), `${directory} must exist`);

    const present = readdirSync(absolute)
      .filter((entry) => entry.endsWith('.md'))
      .sort();

    for (const id of expectedIds) {
      assert.ok(
        present.includes(`${id}.md`),
        `${directory}/${id}.md must exist; present: ${present.join(', ')}`,
      );
    }

    for (const name of present) {
      assert.match(
        name,
        bareIdentifierFileName,
        `${directory}/${name} must use a bare stable identifier, not a descriptive title`,
      );
    }
  }
});

test('every agent source file is reachable from a committed prompt', () => {
  const reachable = new Set<string>();

  for (const { declaredDirectories, references } of promptEntries) {
    for (const reference of references) {
      const resolved = resolveReference(reference, declaredDirectories);
      if (resolved !== null) reachable.add(resolved);
    }
  }

  const orphaned: string[] = [];
  for (const { directory } of sourceDirectoryContracts) {
    for (const name of readdirSync(join(repoRoot, directory))) {
      if (!name.endsWith('.md')) continue;
      const repoPath = `${directory}/${name}`;
      if (!reachable.has(repoPath)) orphaned.push(repoPath);
    }
  }

  assert.deepEqual(orphaned, [], 'no committed source file may be unreachable from every prompt');
});

test('the steward state surface exists with all six non-authoritative files', () => {
  const absolute = join(repoRoot, stewardStateDirectory);
  assert.ok(isDirectory(absolute), `${stewardStateDirectory} must exist as a real local state surface`);

  for (const name of stewardStateFiles) {
    const path = join(absolute, name);
    assert.ok(existsSync(path), `${stewardStateDirectory}/${name} must exist`);
    const firstLine = readNormalized(path).split('\n')[0] ?? '';
    assert.equal(
      firstLine.trim(),
      `> ${nonAuthoritativeBanner}`,
      `${stewardStateDirectory}/${name} must open with the mandated non-authoritative banner`,
    );
  }
});

test('committed agent prompts preserve harness frontmatter contracts', () => {
  for (const { name, text } of promptEntries) {
    assert.ok(text.startsWith('---\n'), `${name} must open with a YAML frontmatter block`);
    const frontmatter = text.split(/^---$/mu)[1] ?? '';
    assert.match(frontmatter, /^description:\s*\S/mu, `${name} must keep a frontmatter description`);
    assert.match(frontmatter, /^mode:\s*\S/mu, `${name} must keep a frontmatter mode`);
    assert.match(frontmatter, /^permissions:/mu, `${name} must keep its frontmatter permissions block`);
  }

  const validator = promptEntries.find((entry) => entry.name === 'validator-agent.md');
  assert.ok(validator !== undefined, 'validator-agent.md must be committed');
  assert.match(
    validator.text.split(/^---$/mu)[1] ?? '',
    /^steps:\s*30$/mu,
    'validator-agent.md must keep steps: 30, the harness limit the chunking rule reasons about',
  );
});
