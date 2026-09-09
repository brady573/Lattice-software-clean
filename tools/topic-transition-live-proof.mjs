import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { Pool } from "pg";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const baseUrl = "http://127.0.0.1:3111";
const browserExecutable = process.env.M7_BROWSER_EXECUTABLE;
assert.ok(browserExecutable && existsSync(browserExecutable), "Chrome/Chromium is required.");
assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required for live cognition proof.");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for durable binding proof.");

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(description, probe, timeoutMs = 60_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${description}${last instanceof Error ? `: ${last.message}` : ""}`);
}

const liveConfig = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "topic-live-proof",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const composition = createConfiguredSolandraCognition(liveConfig);
assert.ok(composition, "Configured canonical Solandra cognition is required.");

const directCases = [
  {
    prior: "Why are some metals magnetic?",
    message: "Help me plan a low-maintenance balcony herb garden.",
    expected: "NEW_OBJECTIVE",
  },
  {
    prior: "How can I reduce glare on my monitor?",
    message: "Actually, I mean glare on a television across the room.",
    expected: "CORRECTION",
  },
  {
    prior: "Draft a polite note declining a neighborhood event.",
    message: "What should I compare when buying a compact vacuum?",
    expected: "NEW_OBJECTIVE",
  },
];

const directEvidence = [];
for (let index = 0; index < directCases.length; index += 1) {
  const item = directCases[index];
  const result = await composition.cognition.interpret({
    conversationId: `live-topic-${index}`,
    messageId: `live-topic-message-${index}`,
    message: item.message,
    currentObjective: item.prior,
    recentUserMessages: [item.prior, item.message],
    governedKnowledge: [],
  });
  const evidence = {
    priorObjective: item.prior,
    userMessage: item.message,
    objectiveRelation: result.proposal.objectiveRelation,
    proposedObjective: result.proposal.proposedObjective,
    materialAmbiguity: result.proposal.materialAmbiguity,
  };
  directEvidence.push(evidence);
  assert.equal(result.proposal.objectiveRelation, item.expected, JSON.stringify(evidence));
}
console.log(`TOPIC_TRANSITION_LIVE_COGNITION=${JSON.stringify(directEvidence)}`);

const service = spawn(process.execPath, ["tools/render-colocated-runtime.mjs"], {
  env: {
    ...process.env,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "topic-live-proof",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    LATTICE_AUTO_MIGRATE: "false",
    PORT: "3111",
    HOST: "127.0.0.1",
    LATTICE_RUN_WORKER_RETRY_DELAY_MS: "5",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serviceOutput = "";
for (const stream of [service.stdout, service.stderr]) {
  stream?.on("data", (chunk) => {
    const text = chunk.toString();
    serviceOutput += text;
    process.stdout.write(text);
  });
}

const chrome = spawn(browserExecutable, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=9333",
  `--user-data-dir=${resolve("artifacts/topic-transition-browser-profile")}`,
  baseUrl,
], { stdio: "ignore" });

class Cdp {
  constructor(url) { this.url = url; this.socket = null; this.id = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("CDP connect timeout")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); rejectPromise(new Error("CDP connection failed")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser evaluation failed");
    return result.result?.value;
  }
  close() { try { this.socket?.close(); } catch {} }
}

async function browserTarget() {
  const response = await fetch("http://127.0.0.1:9333/json").catch(() => null);
  if (!response?.ok) return null;
  const targets = await response.json();
  return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
}

async function wrapOwnerFetch(cdp) {
  await waitFor("ownerFetch", () => cdp.eval("typeof window.ownerFetch === 'function'"));
  await cdp.eval(`(() => {
    const original = window.ownerFetch;
    window.__topicTransitionProof = [];
    window.ownerFetch = async (...args) => {
      const response = await original(...args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (/\\/turns(?:\\?|$)/.test(url)) {
          window.__topicTransitionProof.push(await response.clone().json());
        }
      } catch {}
      return response;
    };
    return true;
  })()`);
}

async function submitThroughBrowser(cdp, message) {
  const before = await cdp.eval("window.__topicTransitionProof.length");
  await cdp.eval(`(() => {
    const input = document.querySelector('textarea');
    if (!input) throw new Error('Conversation textarea not found');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(message)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Send');
    if (!button || button.disabled) throw new Error('Send button unavailable');
    button.click();
    return true;
  })()`);
  return waitFor(`turn response for ${message}`, async () => {
    const items = await cdp.eval("window.__topicTransitionProof");
    return Array.isArray(items) && items.length > before ? items.at(-1) : null;
  });
}

const runState = (cdp, runId) => cdp.eval(`window.ownerFetch('/api/v1/runs/${encodeURIComponent(runId)}').then(r => r.json())`);
async function waitRun(cdp, runId) {
  return waitFor(`Run ${runId} terminal state`, async () => {
    const run = await runState(cdp, runId);
    return ["COMPLETED", "FAILED", "CANCELLED"].includes(run?.status) ? run : null;
  }, 60_000, 250);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function durableBinding(runId) {
  const result = await pool.query(
    `SELECT r.request_json, b.intent_version_id
       FROM runs r
       JOIN run_intent_bindings b ON b.run_id = r.id
      WHERE r.id = $1`,
    [runId],
  );
  assert.equal(result.rowCount, 1, `Expected exactly one durable binding for Run ${runId}`);
  const row = result.rows[0];
  return {
    objective: row.request_json?.objective,
    requestIntentVersionId: row.request_json?.intentVersionId,
    bindingIntentVersionId: row.intent_version_id,
    sourceMessageId: row.request_json?.sourceMessageId,
  };
}

let cdp;
try {
  await waitFor("canonical API", async () => (await fetch(`${baseUrl}/health`).catch(() => null))?.ok === true, 30_000, 200);
  const target = await waitFor("Chrome page target", browserTarget, 20_000, 100);
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await waitFor("Solandra page", () => cdp.eval("document.body?.innerText.includes('Solandra')"), 20_000, 100);
  await wrapOwnerFetch(cdp);

  const aMessage = "What makes ocean tides rise and fall?";
  const a = await submitThroughBrowser(cdp, aMessage);
  assert.equal(a.interpretation?.objectiveRelation, "NEW_OBJECTIVE", JSON.stringify(a));
  assert.equal(a.acceptedUnderstanding, aMessage);
  assert.ok(a.runId);
  await waitRun(cdp, a.runId);

  const bMessage = "How should I organize a small entryway closet?";
  const b = await submitThroughBrowser(cdp, bMessage);
  assert.equal(b.interpretation?.objectiveRelation, "NEW_OBJECTIVE", JSON.stringify(b));
  assert.equal(b.acceptedUnderstanding, bMessage);
  assert.ok(b.runId);
  await waitRun(cdp, b.runId);
  const bBinding = await durableBinding(b.runId);
  assert.equal(bBinding.objective, bMessage);
  assert.equal(bBinding.requestIntentVersionId, b.intentVersionId);
  assert.equal(bBinding.bindingIntentVersionId, b.intentVersionId);

  await cdp.send("Page.enable");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor("reloaded Solandra", () => cdp.eval("document.body?.innerText.includes('Solandra')"), 20_000, 100);
  await waitFor("reloaded prior conversation", () => cdp.eval(`document.body?.innerText.includes(${JSON.stringify(bMessage)})`), 20_000, 100);
  await wrapOwnerFetch(cdp);

  const cMessage = "Why do some tree leaves turn red in autumn?";
  const c = await submitThroughBrowser(cdp, cMessage);
  assert.equal(c.interpretation?.objectiveRelation, "NEW_OBJECTIVE", JSON.stringify(c));
  assert.equal(c.acceptedUnderstanding, cMessage);
  assert.ok(c.runId);
  await waitRun(cdp, c.runId);
  const cBinding = await durableBinding(c.runId);
  assert.equal(cBinding.objective, cMessage);
  assert.equal(cBinding.requestIntentVersionId, c.intentVersionId);
  assert.equal(cBinding.bindingIntentVersionId, c.intentVersionId);

  const visible = await cdp.eval("document.body.innerText");
  assert.match(visible, /tree leaves turn red/iu);
  console.log(`TOPIC_TRANSITION_BROWSER_PASS=${JSON.stringify({
    first: { message: aMessage, relation: a.interpretation.objectiveRelation, objective: a.acceptedUnderstanding },
    second: { message: bMessage, relation: b.interpretation.objectiveRelation, objective: b.acceptedUnderstanding, runObjective: bBinding.objective, intentVersionId: b.intentVersionId },
    afterReload: { message: cMessage, relation: c.interpretation.objectiveRelation, objective: c.acceptedUnderstanding, runObjective: cBinding.objective, intentVersionId: c.intentVersionId },
    visibleCurrentTurn: true,
  })}`);
} finally {
  await pool.end();
  cdp?.close();
  try { chrome.kill("SIGTERM"); } catch {}
  try { service.kill("SIGTERM"); } catch {}
  await Promise.race([once(service, "exit").catch(() => {}), sleep(5_000)]);
}

assert.doesNotMatch(serviceOutput, /GROQ_API_KEY|Bearer\s+[A-Za-z0-9._-]+/u);
