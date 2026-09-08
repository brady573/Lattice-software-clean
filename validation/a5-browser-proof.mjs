import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = async (path) => await import(pathToFileURL(resolve(process.cwd(), path)).href);
const [
  { createRuntimeApp },
  { resolveRuntimeConfig },
  { OfflineFixtureTruthPipeline },
  { requiredProofObligations },
] = await Promise.all([
  load("dist/src/runtime-app.js"),
  load("dist/src/runtime-config.js"),
  load("dist/src/truth/execution-pipeline.js"),
  load("dist/src/truth/contracts.js"),
]);

const SUBJECT_SHA = "b961ef8b7df1245a224ee173aecac2f60a9428b4";
const SUBJECT_TREE = "61d34a3ff612ceab26043f1f377826aeb066a635";
const PORT = 3112;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OWNER = "a5-browser-owner";
const OTHER = "a5-browser-other";
const ARTIFACT_DIR = resolve(process.env.A5_BROWSER_ARTIFACT_DIR ?? "artifacts/a5-browser");
const FINDING = "The inspection note reports visible water staining on the ceiling beside the living-room window.";
const KNOWLEDGE_MESSAGE = "What does the inspection note establish about the visible water staining?";
const RESOURCE_MESSAGE = "Draft a short message to my landlord asking them to inspect the visible water staining, using what we established.";
const ACTIVE_MESSAGE = "Continue checking the inspection note without changing my objective.";
const UNCERTAIN_MESSAGE = "Check the same inspection evidence again while preserving what we established.";
const STOP_MESSAGE = "Continue checking the inspection note before I decide what to do next.";
const FAILURE_MESSAGE = "Trigger the deterministic acquisition failure while preserving my current objective.";
const PROVENANCE = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "a5-browser-deterministic",
  requestedModel: "a5-browser-deterministic-model",
  actualProvider: "a5-browser-deterministic",
  actualModel: "a5-browser-deterministic-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "a5-browser-deterministic-request",
  routeProvenance: "COMPLETE",
});

mkdirSync(ARTIFACT_DIR, { recursive: true });

const checks = Object.fromEntries(requiredProofObligations("INTERPRETIVE").map((kind) => [
  kind,
  kind === "LITERAL_FACT" || kind === "INTERPRETATION_SEPARATION" ? "PASSED" : "UNRESOLVED",
]));
const baseTruth = new OfflineFixtureTruthPipeline({
  evidence: [{ id: "a5-browser-evidence", value: FINDING, sourceId: "a5-browser-source", sourceLabel: "A5 browser inspection note", admitted: true }],
  truthClaims: [{
    id: "a5-browser-claim",
    text: FINDING,
    claimType: "INTERPRETIVE",
    evidenceIds: ["a5-browser-evidence"],
    scope: "consultation",
    checks,
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "a5-browser-evidence",
    claimId: "a5-browser-claim",
    provenanceComponentKey: "a5-browser-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});
const truthPipeline = {
  mode: baseTruth.mode,
  async investigate(runId, request) {
    if ((request?.context ?? []).some((item) => String(item).includes("deterministic acquisition failure"))) {
      throw new Error("A5 deterministic acquisition failure fixture.");
    }
    return await baseTruth.investigate(runId, request);
  },
  async validate(snapshot) {
    return await baseTruth.validate(snapshot);
  },
};

class BrowserCognition {
  async interpret(input) {
    const resource = /\bdraft\b/iu.test(input.message);
    return {
      proposal: {
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.currentObjective ? null : input.message,
        requestedHelp: resource ? "RESOURCE" : "KNOWLEDGE",
        relevantContext: [], entities: ["visible water staining"], referents: [], constraints: [], preferences: [],
        knowledgeNeeds: resource ? [] : ["inspection note evidence"],
        materialAmbiguity: null,
        referencedKnowledgeId: null,
        referencedRecommendationId: null,
      },
      invocationProvenance: PROVENANCE,
    };
  }
}
class BrowserPreparer {
  calls = 0;
  async prepare(input) {
    this.calls += 1;
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const finding = knowledge.findings[0];
    assert.ok(finding);
    return {
      result: {
        status: "PREPARED",
        body: "Dear Landlord,\n\nThe inspection note reports visible water staining on the ceiling beside the living-room window. Could you please inspect this issue?\n\nThank you.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [finding.claimId] }],
        preservedUncertainties: [...knowledge.uncertainties],
      },
      generationProvenance: PROVENANCE,
      groundingProvenance: PROVENANCE,
    };
  }
}
const preparer = new BrowserPreparer();
const subjectResolver = (request) => {
  const raw = request.headers["x-a5-subject"];
  return typeof raw === "string" && raw.trim() ? { subjectId: raw.trim() } : undefined;
};
const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "required",
});

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(label, probe, timeoutMs = 12_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}

async function api(path, init = {}, subject = OWNER) {
  const headers = { ...(init.headers ?? {}), "x-a5-subject": subject };
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  if (text) body = JSON.parse(text);
  return { response, body };
}
async function continuity(id, subject = OWNER) {
  const result = await api(`/api/v1/conversations/${encodeURIComponent(id)}/continuity`, {}, subject);
  assert.equal(result.response.status, subject === OWNER ? 200 : 404, JSON.stringify(result.body));
  return result.body;
}
async function waitRun(runId, expected = "COMPLETED") {
  return await waitFor(`Run ${runId} ${expected}`, async () => {
    const result = await api(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (!result.response.ok) return null;
    return result.body.status === expected ? result.body : null;
  }, 15_000);
}

class Cdp {
  constructor(url) { this.url = url; this.socket = null; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("CDP connect timeout")), 5000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); rejectPromise(new Error("CDP connect failed")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(`${pending.method}: ${message.error.message}`)) : pending.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }
  on(method, listener) { const set = this.listeners.get(method) ?? new Set(); set.add(listener); this.listeners.set(method, set); }
  send(method, params = {}) {
    assert.ok(this.socket && this.socket.readyState === WebSocket.OPEN);
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { this.pending.delete(id); rejectPromise(new Error(`CDP timeout ${method}`)); }, 10_000);
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
        reject: (error) => { clearTimeout(timer); rejectPromise(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`browser evaluation failed: ${result.exceptionDetails.text ?? "unknown"}`);
    return result.result?.value;
  }
  close() { try { this.socket?.close(); } catch {} }
}

function browserExecutable() {
  const candidates = [process.env.A5_BROWSER_EXECUTABLE, process.env.M7_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.filter(Boolean).find((item) => existsSync(item));
  if (!found) throw new Error("Chrome/Chromium is unavailable.");
  return found;
}
async function launchBrowser() {
  const executable = browserExecutable();
  const profile = join(tmpdir(), `lattice-a5-${randomUUID()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, BASE_URL,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let browserOutput = "";
  child.stdout?.on("data", (chunk) => { browserOutput += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { browserOutput += chunk.toString(); });
  const portFile = join(profile, "DevToolsActivePort");
  const port = await waitFor("DevToolsActivePort", async () => {
    if (!existsSync(portFile)) return null;
    const value = Number.parseInt(readFileSync(portFile, "utf8").split(/\r?\n/)[0] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const target = await waitFor("browser page target", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const list = await response.json();
    return list.find((item) => item.type === "page" && item.url.startsWith(BASE_URL)) ?? null;
  });
  return { executable, profile, child, cdpUrl: target.webSocketDebuggerUrl, get output() { return browserOutput; } };
}
async function stopBrowser(browser) {
  if (!browser) return;
  if (browser.child.exitCode === null) {
    try { browser.child.kill(); } catch {}
    await Promise.race([once(browser.child, "exit").catch(() => {}), sleep(2000)]);
  }
  rmSync(browser.profile, { recursive: true, force: true });
}
async function screenshot(cdp, name) {
  const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(join(ARTIFACT_DIR, name), Buffer.from(image.data, "base64"));
}
async function reload(cdp) {
  const marker = randomUUID();
  await cdp.eval(`window.__a5ReloadMarker=${JSON.stringify(marker)}`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor("page reload", async () => cdp.eval(`document.readyState==='complete' && window.__a5ReloadMarker!==${JSON.stringify(marker)} && document.getElementById('conversationInput') instanceof HTMLTextAreaElement ? true : null`));
}
async function submit(cdp, message) {
  await cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    const form=document.getElementById('conversationForm');
    if(!(input instanceof HTMLTextAreaElement)||!(form instanceof HTMLFormElement))throw new Error('canonical input missing');
    input.value=${JSON.stringify(message)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    form.requestSubmit();
    return true;
  })()`);
}
async function uiSettled(cdp) {
  return await waitFor("Solandra input ready", async () => cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    return input instanceof HTMLTextAreaElement && !input.disabled ? {
      inputValue:input.value,
      composerText:document.getElementById('composer')?.innerText ?? '',
      conversationText:document.getElementById('conversation')?.innerText ?? '',
      activeElement:document.activeElement?.id ?? '',
    } : null;
  })()`), 15_000);
}

let app;
let browser;
let cdp;
const turnRequests = [];
try {
  app = await createRuntimeApp(config, {
    truthPipeline,
    solandraCognition: new BrowserCognition(),
    solandraActionPreparer: preparer,
    authenticatedSubjectResolver: subjectResolver,
    memoryDispatchDelayMs: 1200,
  });
  await app.listen({ host: "127.0.0.1", port: PORT });

  browser = await launchBrowser();
  cdp = new Cdp(browser.cdpUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setExtraHTTPHeaders", { headers: { "x-a5-subject": OWNER } });
  cdp.on("Network.requestWillBeSent", (params) => {
    const url = params.request?.url ?? "";
    if (params.request?.method === "POST" && /\/api\/v1\/conversations\/[^/]+\/turns(?:\?|$)/u.test(url)) {
      let body = null;
      try { body = JSON.parse(params.request.postData ?? "null"); } catch {}
      turnRequests.push({ url, body });
    }
  });
  await uiSettled(cdp);

  // Completed Knowledge -> reload -> same durable conversation and unresolved truth state.
  await submit(cdp, KNOWLEDGE_MESSAGE);
  const conversationId = await waitFor("conversation identity", async () => cdp.eval(`localStorage.getItem('lattice.solandra.conversation.v1')`));
  const knowledgeRun = await waitFor("knowledge Run", async () => {
    const state = await continuity(conversationId);
    return state.runs.length === 1 ? state.runs[0] : null;
  });
  await waitRun(knowledgeRun.runId);
  const knowledgeUi = await uiSettled(cdp);
  assert.match(knowledgeUi.composerText, /UNRESOLVED/u);
  assert.match(knowledgeUi.composerText, /uncertain/iu);
  const knowledgeState = await continuity(conversationId);
  assert.equal(knowledgeState.messages.length, 1);
  assert.equal(knowledgeState.runs.length, 1);
  assert.equal(knowledgeState.knowledge.length, 1);
  const knowledgeId = knowledgeState.knowledge[0].knowledgeId;
  await reload(cdp);
  const knowledgeRecovered = await uiSettled(cdp);
  assert.match(knowledgeRecovered.conversationText, new RegExp(KNOWLEDGE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.match(knowledgeRecovered.composerText, /UNRESOLVED/u);
  assert.equal((await continuity(conversationId)).runs.length, 1, "reload must not create a Run");

  // PreparedResource -> reload -> exact identity/body/basis/uncertainty/editability/authorization.
  await submit(cdp, RESOURCE_MESSAGE);
  const preparedRun = await waitFor("prepared Run", async () => {
    const state = await continuity(conversationId);
    return state.runs.length === 2 ? state.runs.at(-1) : null;
  });
  await waitRun(preparedRun.runId);
  await waitFor("prepared resource in Composer", async () => cdp.eval(`document.querySelector('#composer .resource textarea')?.value.includes('Dear Landlord') ? true : null`), 15_000);
  const preparedOutcomeResponse = await api(`/api/v1/runs/${encodeURIComponent(preparedRun.runId)}/outcome`);
  assert.equal(preparedOutcomeResponse.response.status, 200, JSON.stringify(preparedOutcomeResponse.body));
  const preparedOutcome = preparedOutcomeResponse.body;
  assert.equal(preparedOutcome.outcome.resource.editable, true);
  assert.equal(preparedOutcome.outcome.resource.executionAuthorized, false);
  assert.ok(preparedOutcome.preparationReference.knowledgeIds.includes(knowledgeId));
  assert.ok(preparedOutcome.outcome.resource.preservedUncertainties.length > 0);
  const preparedBody = preparedOutcome.outcome.resource.body;
  const preparedResourceId = preparedOutcome.preparationReference.resourceId;
  const presentation = await api(`/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation`);
  const descriptor = presentation.body.presentation.resources.find((item) => item.id === preparedResourceId);
  assert.ok(descriptor);
  assert.equal(descriptor.editable, true);
  assert.equal(descriptor.executionAuthorized, false);
  await screenshot(cdp, "prepared-before-reload.png");
  await reload(cdp);
  const preparedRecovered = await waitFor("prepared resource after reload", async () => cdp.eval(`(() => {
    const area=document.querySelector('#composer .resource textarea');
    return area instanceof HTMLTextAreaElement ? {value:area.value,editable:!area.disabled} : null;
  })()`), 15_000);
  assert.equal(preparedRecovered.value, preparedBody);
  assert.equal(preparedRecovered.editable, true);
  assert.equal((await continuity(conversationId)).runs.length, 2);
  const replayPrepared = await api(`/api/v1/runs/${encodeURIComponent(preparedRun.runId)}/outcome`);
  assert.equal(replayPrepared.body.preparationReference.resourceId, preparedResourceId);
  assert.equal(replayPrepared.body.outcome.resource.executionAuthorized, false);

  // Reload during active work resumes the same Run rather than creating another.
  await submit(cdp, ACTIVE_MESSAGE);
  const activeRecord = await waitFor("active-work browser pointer", async () => cdp.eval(`JSON.parse(localStorage.getItem('lattice.solandra.active-work.v1')||'null')`));
  const activeRunId = activeRecord.runId;
  assert.ok(activeRunId);
  assert.equal((await continuity(conversationId)).runs.length, 3);
  await reload(cdp);
  await waitRun(activeRunId);
  await uiSettled(cdp);
  const afterActiveReload = await continuity(conversationId);
  assert.equal(afterActiveReload.runs.length, 3);
  assert.equal(afterActiveReload.runs.at(-1).runId, activeRunId);

  // Response-stage loss: server accepted, browser did not trust response, reload replays exact turnId.
  let pausedResponse = null;
  cdp.on("Fetch.requestPaused", (params) => {
    if (!pausedResponse && typeof params.responseStatusCode === "number" && /\/turns(?:\?|$)/u.test(params.request?.url ?? "")) pausedResponse = params;
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/conversations/*/turns", requestStage: "Response" }] });
  const requestStart = turnRequests.length;
  const runCountBeforeUncertain = (await continuity(conversationId)).runs.length;
  await submit(cdp, UNCERTAIN_MESSAGE);
  const paused = await waitFor("accepted turn response pause", async () => pausedResponse);
  assert.equal(paused.responseStatusCode, 202);
  const pendingAtLoss = await cdp.eval(`JSON.parse(localStorage.getItem('lattice.solandra.pending-turn.v1')||'null')`);
  assert.ok(pendingAtLoss?.turnId);
  const acceptedState = await waitFor("durably accepted uncertain Run", async () => {
    const state = await continuity(conversationId);
    return state.runs.length === runCountBeforeUncertain + 1 ? state : null;
  });
  const uncertainRunId = acceptedState.runs.at(-1).runId;
  await cdp.send("Fetch.failRequest", { requestId: paused.requestId, errorReason: "Aborted" });
  await cdp.send("Fetch.disable");
  await reload(cdp);
  await waitRun(uncertainRunId);
  await uiSettled(cdp);
  await waitFor("exact pending replay request", async () => turnRequests.length >= requestStart + 2 ? true : null);
  const firstUncertainRequest = turnRequests[requestStart];
  const replayUncertainRequest = turnRequests.slice(requestStart + 1).find((item) => item.body?.turnId === pendingAtLoss.turnId);
  assert.equal(firstUncertainRequest.body.turnId, pendingAtLoss.turnId);
  assert.ok(replayUncertainRequest);
  assert.equal(replayUncertainRequest.body.turnId, firstUncertainRequest.body.turnId);
  const afterUncertain = await continuity(conversationId);
  assert.equal(afterUncertain.runs.length, runCountBeforeUncertain + 1);
  assert.equal(afterUncertain.runs.at(-1).runId, uncertainRunId);

  // Stop uses the existing cancellation boundary and preserves last trustworthy Composer state.
  const composerBeforeStop = await cdp.eval(`document.getElementById('composer')?.innerText ?? ''`);
  await submit(cdp, STOP_MESSAGE);
  const stopWork = await waitFor("Stop control", async () => cdp.eval(`(() => {
    const button=document.getElementById('stopButton');
    const record=JSON.parse(localStorage.getItem('lattice.solandra.active-work.v1')||'null');
    return button instanceof HTMLButtonElement && !button.hidden && record ? record : null;
  })()`));
  await cdp.eval(`document.getElementById('stopButton').click()`);
  await waitRun(stopWork.runId, "CANCELLED");
  await sleep(1400);
  const cancelledStill = await api(`/api/v1/runs/${encodeURIComponent(stopWork.runId)}`);
  assert.equal(cancelledStill.body.status, "CANCELLED");
  const afterStop = await uiSettled(cdp);
  assert.equal(afterStop.composerText, composerBeforeStop);
  assert.equal(afterStop.activeElement, "conversationInput");
  assert.match(afterStop.conversationText, /I stopped that work\. Your last trustworthy result is still here\./u);

  // Deterministic acquisition failure keeps prior Composer state and restores exact USER input as a conversation-bound draft.
  const composerBeforeFailure = afterStop.composerText;
  await submit(cdp, FAILURE_MESSAGE);
  const failedRun = await waitFor("failed Run identity", async () => {
    const state = await continuity(conversationId);
    const last = state.runs.at(-1);
    return last && last.runId !== stopWork.runId ? last : null;
  });
  await waitRun(failedRun.runId, "FAILED");
  const afterFailure = await uiSettled(cdp);
  assert.equal(afterFailure.composerText, composerBeforeFailure);
  assert.equal(afterFailure.inputValue, FAILURE_MESSAGE);
  assert.doesNotMatch(afterFailure.conversationText, /RUN_NOT_SUCCESSFUL|worker|queue|provider|retry epoch/iu);
  assert.match(afterFailure.conversationText, /couldn't complete that work reliably/iu);
  const storedDraft = await cdp.eval(`JSON.parse(localStorage.getItem('lattice.solandra.draft.v1')||'null')`);
  assert.deepEqual(storedDraft, { conversationId, value: FAILURE_MESSAGE });

  // Narrow viewport keeps Conversation + free-form input + adaptive Composer hierarchy usable.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await cdp.eval(`(() => ({
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    input:Boolean(document.getElementById('conversationInput')),
    composer:Boolean(document.getElementById('composer')),
    stopLabel:document.getElementById('stopButton')?.textContent ?? ''
  }))()`);
  assert.equal(mobile.overflow, false);
  assert.equal(mobile.input, true);
  assert.equal(mobile.composer, true);
  assert.equal(mobile.stopLabel, "Stop");
  await screenshot(cdp, "mobile-failure-recovery.png");
  await cdp.send("Emulation.clearDeviceMetricsOverride");

  // A second authenticated subject must not see the first subject's persisted browser draft.
  await cdp.send("Network.setExtraHTTPHeaders", { headers: { "x-a5-subject": OTHER } });
  await reload(cdp);
  const foreign = await uiSettled(cdp);
  assert.equal(foreign.inputValue, "");
  assert.doesNotMatch(foreign.conversationText, new RegExp(FAILURE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.equal(await cdp.eval(`localStorage.getItem('lattice.solandra.draft.v1')`), null);
  assert.equal(await cdp.eval(`localStorage.getItem('lattice.solandra.conversation.v1')`), null);
  assert.equal((await continuity(conversationId, OTHER)).error, "CONVERSATION_NOT_FOUND");
  const visible = await cdp.eval(`document.body.innerText`);
  assert.doesNotMatch(visible, /RUN_NOT_SUCCESSFUL|worker status|queue status|provider status|retry epoch/iu);
  assert.match(visible, /Solandra/u);

  assert.equal(preparer.calls, 1, "PreparedResource recovery must not regenerate preparation.");
  console.log(`A5_BROWSER_EXECUTABLE=${browser.executable}`);
  console.log(`A5_BROWSER_SUBJECT_SHA=${SUBJECT_SHA}`);
  console.log(`A5_BROWSER_SUBJECT_TREE=${SUBJECT_TREE}`);
  console.log(`A5_BROWSER_CONVERSATION_ID=${conversationId}`);
  console.log(`A5_BROWSER_KNOWLEDGE_RUN_ID=${knowledgeRun.runId}`);
  console.log(`A5_BROWSER_KNOWLEDGE_ID=${knowledgeId}`);
  console.log(`A5_BROWSER_PREPARED_RUN_ID=${preparedRun.runId}`);
  console.log(`A5_BROWSER_PREPARED_RESOURCE_ID=${preparedResourceId}`);
  console.log(`A5_BROWSER_ACTIVE_RELOAD_RUN_ID=${activeRunId}`);
  console.log(`A5_BROWSER_UNCERTAIN_RUN_ID=${uncertainRunId}`);
  console.log(`A5_BROWSER_UNCERTAIN_TURN_ID=${pendingAtLoss.turnId}`);
  console.log(`A5_BROWSER_CANCELLED_RUN_ID=${stopWork.runId}`);
  console.log(`A5_BROWSER_FAILED_RUN_ID=${failedRun.runId}`);
  console.log("A5_BROWSER_PREPARED_EDITABLE=true");
  console.log("A5_BROWSER_EXECUTION_AUTHORIZED=false");
  console.log("A5_BROWSER_SUBJECT_DRAFT_ISOLATION=PASS");
  console.log("A5_ACTUAL_BROWSER_PRODUCT_PROOF=PASS");
} catch (error) {
  if (browser?.output) console.error(browser.output.slice(-4000));
  throw error;
} finally {
  cdp?.close();
  await stopBrowser(browser);
  await app?.close();
}
