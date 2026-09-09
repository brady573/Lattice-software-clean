import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.COGNITIVE_BASE_URL ?? "http://127.0.0.1:3113";
const browserExecutable = process.env.COGNITIVE_BROWSER_EXECUTABLE;
assert.ok(browserExecutable, "Hosted Chrome/Chromium is required for canonical browser proof.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(description, probe, timeoutMs = 30_000, intervalMs = 100) {
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
  throw new Error(`Timed out waiting for ${description}${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch { return; }
  await Promise.race([once(child, "exit").catch(() => {}), sleep(2_000)]);
  if (child.exitCode === null) {
    try { child.kill("SIGKILL"); } catch {}
  }
}

class Cdp {
  constructor(url) {
    this.socket = null;
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP connection timed out.")), 5_000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP connection failed.")); }, { once: true });
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
    assert.ok(this.socket && this.socket.readyState === WebSocket.OPEN, `CDP socket is not open for ${method}.`);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP method timed out: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed.");
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

const api = spawn(process.execPath, ["dist/src/index.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "ignore", "ignore"],
});

let browser;
let cdp;
let profile;
try {
  await waitFor("canonical API health", async () => (await fetch(`${baseUrl}/health`).catch(() => null))?.ok === true, 15_000);

  profile = join(tmpdir(), `lattice-cognitive-proof-${randomUUID()}`);
  mkdirSync(profile, { recursive: true });
  browser = spawn(browserExecutable, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    baseUrl,
  ], { stdio: ["ignore", "ignore", "ignore"] });

  const portFile = join(profile, "DevToolsActivePort");
  const port = await waitFor("browser debugging port", async () => {
    if (!existsSync(portFile)) return null;
    const value = Number.parseInt(readFileSync(portFile, "utf8").split(/\r?\n/u)[0] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  });

  const target = await waitFor("canonical Product browser target", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.url.startsWith(baseUrl)) ?? null;
  });
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  const stateLabel = async () => await cdp.eval("document.getElementById('cognitiveAssistanceLabel')?.textContent || ''");
  const solandraTurns = async () => await cdp.eval("[...document.querySelectorAll('.turn.solandra')].map((node) => node.textContent || '')");

  await waitFor("truthful disconnected state", async () => (await stateLabel()).includes("disconnected"));
  console.log("PRODUCT_PROOF_DISCONNECTED=PASS");

  await cdp.eval("document.getElementById('cognitiveAssistanceButton').click()");
  await waitFor("cognitive assistance dialog", async () => await cdp.eval("document.getElementById('cognitiveAssistanceDialog')?.open === true"));
  await cdp.eval("document.getElementById('cognitiveAssistanceToggle').click()");
  await waitFor("connected state", async () => (await stateLabel()).includes("connected"));
  console.log("PRODUCT_PROOF_CONNECT_UI=PASS");

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor("connected state after reload", async () => (await stateLabel()).includes("connected"));
  console.log("PRODUCT_PROOF_CONNECTED_RELOAD=PASS");

  const beforeSuccessTurns = (await solandraTurns()).length;
  const request = "Can you brainstorm three clearer names for a folder where I keep rough ideas I might revisit later?";
  await cdp.eval(`(() => { const input = document.getElementById('conversationInput'); input.value = ${JSON.stringify(request)}; document.getElementById('conversationForm').requestSubmit(); return true; })()`);
  const assistantText = await waitFor("visible cognitive assistant response", async () => {
    const turns = await solandraTurns();
    if (turns.length <= beforeSuccessTurns) return null;
    return turns.at(-1) || null;
  }, 90_000, 200);
  assert.ok(assistantText.trim().length > 0);
  assert.doesNotMatch(assistantText, /couldn't establish the requested work safely/iu);
  assert.doesNotMatch(assistantText, /Cognitive assistance is disconnected/iu);

  const successfulState = await cdp.eval("fetch('/api/v1/capabilities/user-model').then((r) => r.json())");
  assert.equal(successfulState.capability.status, "CONNECTED");
  assert.equal(successfulState.capability.lastInvocation?.outcome, "SUCCEEDED");
  const successfulRequestId = successfulState.capability.lastInvocation.requestId;
  assert.equal(successfulState.capability.lastInvocation.provenance?.kind, "MODEL");
  console.log(`PRODUCT_PROOF_ROUTE=${successfulState.capability.lastInvocation.provenance.actualProvider}/${successfulState.capability.lastInvocation.provenance.actualModel}`);

  const structural = await cdp.eval("(() => { const id = localStorage.getItem('lattice.solandra.conversation.v1'); return fetch('/api/v1/conversations/' + encodeURIComponent(id) + '/continuity').then((r) => r.json()); })()");
  assert.ok(structural.messages.length >= 1);
  assert.equal(structural.runs.length, 0);
  assert.equal(structural.knowledge.length, 0);
  assert.equal(structural.recommendations.length, 0);
  assert.equal(structural.acceptedChoices.length, 0);
  console.log("PRODUCT_PROOF_DIRECT_RESPONSE=PASS");
  console.log("PRODUCT_PROOF_NON_AUTHORITATIVE_STATE=PASS");

  await cdp.eval("document.getElementById('cognitiveAssistanceButton').click()");
  await waitFor("capability dialog after success", async () => await cdp.eval("document.getElementById('cognitiveAssistanceDialog')?.open === true"));
  await cdp.eval("document.getElementById('cognitiveAssistanceToggle').click()");
  await waitFor("disconnected state after revoke", async () => (await stateLabel()).includes("disconnected"));
  console.log("PRODUCT_PROOF_REVOKE_UI=PASS");

  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor("disconnected state after reload", async () => (await stateLabel()).includes("disconnected"));
  const restoredUserTurns = await cdp.eval("document.querySelectorAll('.turn.user').length");
  assert.ok(restoredUserTurns >= 1, "Conversation USER continuity must survive reload.");
  console.log("PRODUCT_PROOF_DISCONNECTED_RELOAD=PASS");

  const beforeDeniedTurns = (await solandraTurns()).length;
  const deniedRequest = "Can you brainstorm three alternate labels for another rough-notes folder?";
  await cdp.eval(`(() => { const input = document.getElementById('conversationInput'); input.value = ${JSON.stringify(deniedRequest)}; document.getElementById('conversationForm').requestSubmit(); return true; })()`);
  const deniedText = await waitFor("visible revoked-capability boundary", async () => {
    const turns = await solandraTurns();
    if (turns.length <= beforeDeniedTurns) return null;
    return turns.at(-1) || null;
  }, 60_000, 200);
  assert.equal(deniedText, "Cognitive assistance is disconnected. Connect it to use this request.");

  const revokedState = await cdp.eval("fetch('/api/v1/capabilities/user-model').then((r) => r.json())");
  assert.equal(revokedState.capability.status, "DISCONNECTED");
  assert.equal(revokedState.capability.lastInvocation?.requestId, successfulRequestId);
  const afterRevoke = await cdp.eval("(() => { const id = localStorage.getItem('lattice.solandra.conversation.v1'); return fetch('/api/v1/conversations/' + encodeURIComponent(id) + '/continuity').then((r) => r.json()); })()");
  assert.equal(afterRevoke.runs.length, 0);
  assert.equal(afterRevoke.knowledge.length, 0);
  assert.equal(afterRevoke.recommendations.length, 0);
  assert.equal(afterRevoke.acceptedChoices.length, 0);
  console.log("PRODUCT_PROOF_REVOKED_REQUEST_BLOCKED=PASS");
  console.log("LATTICE_CANONICAL_COGNITIVE_ASSISTANCE_PRODUCT_PROOF=PASS");
} finally {
  cdp?.close();
  await stop(browser);
  await stop(api);
  if (profile) rmSync(profile, { recursive: true, force: true });
}
