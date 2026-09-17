import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = process.env.PR122_BROWSER_BASE_URL ?? 'http://127.0.0.1:3117';
const browserExecutable = process.env.PR122_BROWSER_EXECUTABLE;
const runtimeLog = resolve(process.env.PR122_BROWSER_RUNTIME_LOG ?? 'artifacts/pr122-browser/runtime.log');
const artifactDir = resolve(process.env.PR122_BROWSER_ARTIFACT_DIR ?? 'artifacts/pr122-browser');
const subjectSha = process.env.SUBJECT_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null;

if (!browserExecutable) throw new Error('PR122_BROWSER_EXECUTABLE is required.');

const initialMessage = 'Help me plan a quiet reading corner for my apartment.';
const correctionMessage = 'Actually, make it work in the shared living room without taking over the whole space.';
const correctedObjective = 'Plan a quiet reading corner that works in a shared living room without taking over the whole space.';
const confirmationMessage = 'That matches the change I intended—go with that interpretation.';

mkdirSync(artifactDir, { recursive: true });

const evidence = {
  sourceSha: subjectSha,
  conversationId: null,
  pendingProposalId: null,
  turnRequests: [],
  cognitionConfirmationProposalId: null,
  initialRunId: null,
  confirmedRunId: null,
  initialIntentVersionId: null,
  confirmedIntentVersionId: null,
  confirmedObjective: null,
  confirmedOutcomeKind: null,
};

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(label, probe, timeoutMs = 15_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => rejectPromise(new Error('CDP connection timed out.')), 5_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timeout);
        rejectPromise(new Error('CDP connection failed.'));
      }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  send(method, params = {}) {
    assert.ok(this.socket && this.socket.readyState === WebSocket.OPEN, `CDP socket is not open for ${method}.`);
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`CDP method timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectPromise(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed.');
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

async function launchBrowser() {
  if (!existsSync(browserExecutable)) throw new Error(`Browser executable not found: ${browserExecutable}`);
  const profile = join(tmpdir(), `lattice-pr122-browser-${randomUUID()}`);
  mkdirSync(profile, { recursive: true });
  const browser = spawn(browserExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    baseUrl,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  browser.stdout?.on('data', (chunk) => process.stdout.write(`[browser] ${chunk}`));
  browser.stderr?.on('data', (chunk) => process.stdout.write(`[browser] ${chunk}`));

  const portFile = join(profile, 'DevToolsActivePort');
  const debugPort = await waitFor('DevToolsActivePort', async () => {
    if (!existsSync(portFile)) return null;
    const value = Number.parseInt(readFileSync(portFile, 'utf8').split(/\r?\n/u)[0] ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const target = await waitFor('browser target', async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === 'page' && item.url?.startsWith(baseUrl)) ?? null;
  });
  return { profile, browser, cdpUrl: target.webSocketDebuggerUrl };
}

async function submitBrowserTurn(cdp, message) {
  await cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    const send=document.getElementById('sendButton');
    if(!(input instanceof HTMLTextAreaElement)||!(send instanceof HTMLButtonElement))throw new Error('canonical input missing');
    if(input.disabled||send.disabled)throw new Error('canonical input is busy');
    input.value=${JSON.stringify(message)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    send.click();
    return true;
  })()`);
}

async function waitForBrowserReady(cdp, label) {
  return waitFor(label, async () => cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    const send=document.getElementById('sendButton');
    if(!(input instanceof HTMLTextAreaElement)||!(send instanceof HTMLButtonElement))return null;
    return !input.disabled&&!send.disabled ? true : null;
  })()`));
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json();
  assert.equal(response.ok, true, `${path}: ${JSON.stringify(body)}`);
  return body;
}

let browser;
let cdp;
try {
  browser = await launchBrowser();
  cdp = new Cdp(browser.cdpUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  cdp.on('Network.requestWillBeSent', (params) => {
    const request = params.request ?? {};
    const url = request.url ?? '';
    if (request.method !== 'POST' || !url.includes('/api/v1/conversations/') || !url.includes('/turns')) return;
    evidence.turnRequests.push({
      url,
      method: request.method,
      postData: request.postData ?? null,
    });
  });

  await waitForBrowserReady(cdp, 'canonical Solandra browser readiness');

  await submitBrowserTurn(cdp, initialMessage);
  await waitFor('first browser turn request', async () => evidence.turnRequests.length >= 1 ? true : null);
  await waitForBrowserReady(cdp, 'initial governed run completion');

  const conversationId = await cdp.eval(`window.localStorage.getItem('lattice.solandra.conversation.v1')`);
  assert.equal(typeof conversationId, 'string');
  assert.ok(conversationId.length > 0);
  evidence.conversationId = conversationId;

  const initialContinuity = await getJson(`/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`);
  assert.equal(initialContinuity.messages.length, 1);
  assert.equal(initialContinuity.messages[0].content, initialMessage);
  assert.equal(initialContinuity.runs.length, 1);
  evidence.initialRunId = initialContinuity.runs[0].runId;
  const initialRun = await getJson(`/api/v1/runs/${encodeURIComponent(evidence.initialRunId)}`);
  evidence.initialIntentVersionId = initialRun.request.intentVersionId;
  assert.equal(initialRun.request.objective, initialMessage);

  await submitBrowserTurn(cdp, correctionMessage);
  await waitFor('pending Intent clarification in browser storage', async () => cdp.eval(`(() => {
    const raw=window.localStorage.getItem('lattice.solandra.clarification.v1');
    if(!raw)return null;
    const value=JSON.parse(raw);
    return value&&typeof value.proposalId==='string'&&value.proposalId.length>0?value:null;
  })()`));
  await waitForBrowserReady(cdp, 'clarification response completion');

  const pending = await cdp.eval(`JSON.parse(window.localStorage.getItem('lattice.solandra.clarification.v1'))`);
  assert.equal(pending.conversationId, conversationId);
  assert.equal(typeof pending.proposalId, 'string');
  assert.ok(pending.proposalId.length > 0);
  evidence.pendingProposalId = pending.proposalId;

  assert.equal(evidence.turnRequests.length, 2);
  const correctionRequest = JSON.parse(evidence.turnRequests[1].postData);
  assert.equal(correctionRequest.message, correctionMessage);
  assert.equal('clarificationProposalId' in correctionRequest, false);

  await submitBrowserTurn(cdp, confirmationMessage);
  await waitFor('confirmation turn request', async () => evidence.turnRequests.length >= 3 ? true : null);
  await waitForBrowserReady(cdp, 'confirmed governed run completion');

  const confirmationRequest = JSON.parse(evidence.turnRequests[2].postData);
  assert.equal(confirmationRequest.message, confirmationMessage);
  assert.equal(confirmationRequest.clarificationProposalId, pending.proposalId);
  assert.ok(evidence.turnRequests[2].url.endsWith('/turns'));
  assert.equal(evidence.turnRequests.some((request) => request.url.includes('/clarifications/') || request.url.includes('/confirm')), false);

  const cognitionConfirmationProposalId = await waitFor('runtime cognition confirmation evidence', async () => {
    if (!existsSync(runtimeLog)) return null;
    const log = readFileSync(runtimeLog, 'utf8');
    const matches = [...log.matchAll(/ISSUE91_BROWSER_COGNITION_CONFIRM proposalId=([^\s]+)/gu)];
    return matches.at(-1)?.[1] ?? null;
  });
  assert.equal(cognitionConfirmationProposalId, pending.proposalId);
  evidence.cognitionConfirmationProposalId = cognitionConfirmationProposalId;

  const continuity = await getJson(`/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`);
  assert.deepEqual(continuity.messages.map((message) => message.content), [
    initialMessage,
    correctionMessage,
    confirmationMessage,
  ]);
  assert.equal(continuity.runs.length, 2);
  evidence.confirmedRunId = continuity.runs.at(-1).runId;
  const confirmedRun = await getJson(`/api/v1/runs/${encodeURIComponent(evidence.confirmedRunId)}`);
  assert.equal(confirmedRun.status, 'COMPLETED');
  assert.equal(confirmedRun.request.objective, correctedObjective);
  evidence.confirmedIntentVersionId = confirmedRun.request.intentVersionId;
  evidence.confirmedObjective = confirmedRun.request.objective;
  assert.notEqual(evidence.confirmedIntentVersionId, evidence.initialIntentVersionId);
  if (confirmedRun.exactBinding) {
    assert.equal(confirmedRun.exactBinding.intentVersionId, evidence.confirmedIntentVersionId);
  }

  const outcomeResponse = await fetch(`${baseUrl}/api/v1/runs/${encodeURIComponent(evidence.confirmedRunId)}/outcome`);
  const outcomeBody = await outcomeResponse.json();
  assert.equal(outcomeResponse.status, 200, JSON.stringify(outcomeBody));
  assert.equal(outcomeBody.outcome.acceptedUnderstanding, correctedObjective);
  evidence.confirmedOutcomeKind = outcomeBody.outcome.kind;

  writeFileSync(join(artifactDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
  console.log('PR122_BROWSER_NATURAL_INTENT_CONFIRMATION=PASS');
} catch (error) {
  writeFileSync(join(artifactDir, 'evidence.json'), `${JSON.stringify({
    ...evidence,
    failure: error instanceof Error ? error.stack : String(error),
  }, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  cdp?.close();
  if (browser?.browser && browser.browser.exitCode === null) {
    try { browser.browser.kill(); } catch {}
  }
  if (browser?.profile) rmSync(browser.profile, { recursive: true, force: true });
}
