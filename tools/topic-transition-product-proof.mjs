import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { createConfiguredSolandraCognition } from "../dist/src/solandra/cognition-composition.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const PRODUCT_SHA = "455008b91ae898192c82ba69215990d52158eba5";
const baseUrl = "http://127.0.0.1:3117";
const browserExecutable = process.env.M7_BROWSER_EXECUTABLE;
assert.ok(browserExecutable && existsSync(browserExecutable), "Chrome is required");
assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(name, fn, timeout = 60_000, interval = 150) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${name}${last instanceof Error ? `: ${last.message}` : ""}`);
}

const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "topic-transition-product-proof",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
});
const cognition = createConfiguredSolandraCognition(config)?.cognition;
assert.ok(cognition, "configured canonical cognition is required");
const directCases = [
  ["Why do magnets attract some metals?", "Help me plan a low-maintenance herb garden for a shaded balcony.", "NEW_OBJECTIVE"],
  ["Draft a friendly note declining a dinner invitation.", "What should I compare when choosing a cordless vacuum for a small apartment?", "NEW_OBJECTIVE"],
  ["Why do maple leaves change color?", "Why?", "CONTINUE"],
  ["Help me compare cameras for hiking.", "Actually, I mean cameras for indoor low-light photos.", "CORRECTION"],
];
const directEvidence = [];
for (let index = 0; index < directCases.length; index += 1) {
  const [priorObjective, userMessage, expectedRelation] = directCases[index];
  const result = await cognition.interpret({
    conversationId: `direct-${index}`,
    messageId: `direct-message-${index}`,
    message: userMessage,
    currentObjective: priorObjective,
    recentUserMessages: [priorObjective, userMessage],
    governedKnowledge: [],
  });
  const evidence = {
    priorObjective,
    userMessage,
    objectiveRelation: result.proposal.objectiveRelation,
    proposedObjective: result.proposal.proposedObjective,
    materialAmbiguity: result.proposal.materialAmbiguity,
  };
  directEvidence.push(evidence);
  assert.equal(evidence.objectiveRelation, expectedRelation, JSON.stringify(evidence));
  if (expectedRelation === "NEW_OBJECTIVE" || expectedRelation === "CORRECTION") {
    assert.equal(evidence.proposedObjective, userMessage, JSON.stringify(evidence));
  }
}
console.log(`TOPIC_TRANSITION_REAL_COGNITION=${JSON.stringify(directEvidence)}`);

const service = spawn(process.execPath, ["tools/render-colocated-runtime.mjs"], {
  env: {
    ...process.env,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "topic-transition-product-proof",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    LATTICE_AUTO_MIGRATE: "false",
    LATTICE_RUN_WORKER_RETRY_DELAY_MS: "5",
    PORT: "3117",
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serviceOutput = "";
for (const stream of [service.stdout, service.stderr]) {
  stream?.on("data", (chunk) => { const text = chunk.toString(); serviceOutput += text; process.stdout.write(text); });
}
const chrome = spawn(browserExecutable, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=9341", `--user-data-dir=${resolve("artifacts/topic-transition-profile")}`, baseUrl,
], { stdio: "ignore" });

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP open timeout")), 10_000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP open error")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result ?? {});
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolveSend, reject) => { this.pending.set(id, { resolve: resolveSend, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser evaluation failed");
    return result.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function pageTarget() {
  const response = await fetch("http://127.0.0.1:9341/json").catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
}
async function submitBrowserMessage(cdp, message) {
  await waitFor("enabled Conversation composer", () => cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    const send=document.getElementById('sendButton');
    return input instanceof HTMLTextAreaElement && send instanceof HTMLButtonElement && !input.disabled && !send.disabled;
  })()`));
  const before = await cdp.eval("document.querySelectorAll('#conversation .turn.solandra').length");
  await cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    const send=document.getElementById('sendButton');
    input.value=${JSON.stringify(message)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    send.click();
    return true;
  })()`);
  await waitFor(`persisted USER message ${message}`, async () => {
    const result = await pool.query("select message_id from intent_user_messages where content=$1 order by created_at desc limit 1", [message]);
    return result.rows[0]?.message_id ?? null;
  });
  const row = await waitFor(`durable Run for ${message}`, async () => {
    const result = await pool.query(`
      select r.id, r.status, r.request_json, b.intent_version_id as binding_intent_version_id
      from runs r
      join intent_user_messages m on m.message_id=r.request_json->>'sourceMessageId'
      join run_intent_bindings b on b.run_id=r.id
      where m.content=$1
      order by r.created_at desc limit 1`, [message]);
    return result.rows[0] ?? null;
  });
  const terminal = await waitFor(`terminal Run for ${message}`, async () => {
    const result = await pool.query("select status from runs where id=$1", [row.id]);
    return ["COMPLETED", "FAILED", "CANCELLED"].includes(result.rows[0]?.status) ? result.rows[0].status : null;
  });
  assert.equal(terminal, "COMPLETED", `Run for ${message} did not complete`);
  await waitFor(`visible Solandra response for ${message}`, () => cdp.eval(`document.querySelectorAll('#conversation .turn.solandra').length > ${before}`));
  return {
    runId: row.id,
    objective: row.request_json.objective,
    sourceMessageId: row.request_json.sourceMessageId,
    requestIntentVersionId: row.request_json.intentVersionId,
    bindingIntentVersionId: row.binding_intent_version_id,
  };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let cdp;
try {
  await waitFor("canonical API", async () => Boolean((await fetch(`${baseUrl}/health`).catch(() => null))?.ok), 30_000, 200);
  const target = await waitFor("Chrome page", pageTarget, 20_000, 100);
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor("canonical Solandra page", () => cdp.eval("document.getElementById('conversationInput') instanceof HTMLTextAreaElement"));

  const aMessage = "What makes ocean tides rise and fall?";
  const a = await submitBrowserMessage(cdp, aMessage);
  assert.equal(a.objective, aMessage);
  assert.equal(a.requestIntentVersionId, a.bindingIntentVersionId);

  const bMessage = "What causes bread dough to rise?";
  const b = await submitBrowserMessage(cdp, bMessage);
  assert.equal(b.objective, bMessage);
  assert.equal(b.requestIntentVersionId, b.bindingIntentVersionId);
  assert.notEqual(b.requestIntentVersionId, a.requestIntentVersionId);

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor("reloaded Conversation continuity", () => cdp.eval(`document.body.innerText.includes(${JSON.stringify(bMessage)})`), 20_000);

  const cMessage = "Why do some tree leaves turn red in autumn?";
  const c = await submitBrowserMessage(cdp, cMessage);
  assert.equal(c.objective, cMessage);
  assert.equal(c.requestIntentVersionId, c.bindingIntentVersionId);
  assert.notEqual(c.requestIntentVersionId, b.requestIntentVersionId);
  const visible = await cdp.eval("document.body.innerText");
  assert.match(visible, /tree leaves turn red in autumn/iu);

  console.log(`TOPIC_TRANSITION_BROWSER_PRODUCT=${JSON.stringify({
    first: { userMessage: aMessage, runObjective: a.objective, intentVersionId: a.requestIntentVersionId, sourceMessageId: a.sourceMessageId },
    second: { userMessage: bMessage, runObjective: b.objective, intentVersionId: b.requestIntentVersionId, sourceMessageId: b.sourceMessageId },
    afterReload: { userMessage: cMessage, runObjective: c.objective, intentVersionId: c.requestIntentVersionId, sourceMessageId: c.sourceMessageId },
    visibleCurrentTopic: true,
  })}`);
} finally {
  await pool.end();
  cdp?.close();
  try { chrome.kill("SIGTERM"); } catch {}
  try { service.kill("SIGTERM"); } catch {}
  await Promise.race([once(service, "exit").catch(() => {}), sleep(5_000)]);
}
assert.doesNotMatch(serviceOutput, /GROQ_API_KEY|Bearer\s+[A-Za-z0-9._-]+/u);
console.log(`TOPIC_TRANSITION_EXACT_PRODUCT_SHA=${PRODUCT_SHA}`);
