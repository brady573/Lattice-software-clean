import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = process.env.M7_BASE_URL ?? "http://127.0.0.1:3107";
const subjectSha = process.env.SUBJECT_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null;
const artifactDir = resolve(process.env.M7_BROWSER_ARTIFACT_DIR ?? "artifacts/m7-browser");
const initialContent = "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";
const continuationContent = "I need a laptop under $1,200 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

mkdirSync(artifactDir, { recursive: true });

const evidence = {
  sourceSha: subjectSha,
  browserExecutable: null,
  conversationId: null,
  firstRunId: null,
  secondRunId: null,
  presentationRevision: null,
  reconnect: null,
  browser: {
    baseline: null,
    ime: null,
    shiftEnter: null,
    scrollPreservation: null,
    resourceTakeover: null,
    mobile: null,
    zoom200: null,
    reducedMotion: null,
    touchFocus: null,
  },
  requests: { authoritativeTurns: [], streams: [] },
  streamResponses: [],
  streamFailures: [],
  eventSourceMessages: [],
};

function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

async function waitFor(description, probe, timeoutMs = 12_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

function childProcess(label, args, env = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  const append = (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(`[${label}] ${text}`);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { child, get output() { return output; } };
}

async function stopChild(handle, timeoutMs = 3_000) {
  if (!handle?.child || handle.child.exitCode !== null) return;
  try { handle.child.kill(); } catch { return; }
  const exited = await Promise.race([
    once(handle.child, "exit").then(() => true).catch(() => true),
    sleep(timeoutMs).then(() => false),
  ]);
  if (exited || handle.child.exitCode !== null) return;
  if (process.platform === "win32" && handle.child.pid) {
    spawnSync("taskkill", ["/PID", String(handle.child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { handle.child.kill("SIGKILL"); } catch {}
  }
}

async function jsonRequest(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let payload = null;
  if (text.length > 0) {
    try { payload = JSON.parse(text); }
    catch { throw new Error(`Expected JSON from ${path}, received ${text.slice(0, 300)}`); }
  }
  return { response, payload };
}

async function waitForHealth() {
  await waitFor("durable API health", async () => {
    const response = await fetch(`${baseUrl}/health`).catch(() => null);
    return response?.ok === true;
  }, 10_000, 100);
}

async function getContinuity(conversationId) {
  const result = await jsonRequest(`/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`);
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  return result.payload;
}

async function getPresentation(conversationId, knownRevision) {
  const suffix = knownRevision ? `?knownRevision=${encodeURIComponent(knownRevision)}` : "";
  const result = await jsonRequest(`/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation${suffix}`);
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  assert.ok(result.payload?.presentation);
  return result.payload.presentation;
}

async function waitForCompleted(runId) {
  return waitFor(`Run ${runId} completion`, async () => {
    const current = await jsonRequest(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (!current.response.ok || !current.payload) return null;
    if (["FAILED", "CANCELLED"].includes(current.payload.status)) throw new Error(`Run ${runId} reached ${current.payload.status}.`);
    return current.payload.status === "COMPLETED" ? current.payload : null;
  }, 15_000, 25);
}

function installedBrowser() {
  const candidates = [process.env.M7_BROWSER_EXECUTABLE];
  for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
    if (!root) continue;
    candidates.push(join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    candidates.push(join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  const executable = [...new Set(candidates.filter(Boolean))].find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("No installed Edge or Chrome executable is available for browser acceptance.");
  return executable;
}

class Cdp {
  constructor(url) { this.url = url; this.socket = null; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => rejectPromise(new Error("CDP connection timed out.")), 5_000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolvePromise(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); rejectPromise(new Error("CDP connection failed.")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id === "number") {
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
    const listeners = this.listeners.get(method) ?? new Set(); listeners.add(listener); this.listeners.set(method, listeners);
  }
  send(method, params = {}) {
    assert.ok(this.socket && this.socket.readyState === WebSocket.OPEN, `CDP socket is not open for ${method}.`);
    const id = this.id++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => { this.pending.delete(id); rejectPromise(new Error(`CDP method timed out: ${method}`)); }, 10_000);
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timeout); resolvePromise(value); },
        reject: (error) => { clearTimeout(timeout); rejectPromise(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text ?? "unknown exception"}`);
    return result.result?.value;
  }
  close() { try { this.socket?.close(); } catch {} }
}

async function launchBrowser() {
  const executable = installedBrowser();
  const profile = join(tmpdir(), `lattice-solandra-${randomUUID()}`);
  mkdirSync(profile, { recursive: true });
  const browser = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-features=msEdgeFirstRunExperience", "--remote-debugging-port=0", `--user-data-dir=${profile}`, baseUrl,
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  browser.stdout?.on("data", (chunk) => process.stdout.write(`[browser] ${chunk}`));
  browser.stderr?.on("data", (chunk) => process.stdout.write(`[browser] ${chunk}`));
  const portFile = join(profile, "DevToolsActivePort");
  const port = await waitFor("DevToolsActivePort", async () => {
    if (!existsSync(portFile)) return null;
    const parsed = Number.parseInt(readFileSync(portFile, "utf8").split(/\r?\n/)[0] ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const target = await waitFor("Product browser target", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.url?.startsWith(baseUrl)) ?? null;
  });
  return { executable, profile, browser, cdpUrl: target.webSocketDebuggerUrl };
}

function header(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) if (key.toLowerCase() === target) return String(value);
  return undefined;
}

async function screenshot(cdp, filename) {
  const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(join(artifactDir, filename), Buffer.from(image.data, "base64"));
}

async function main() {
  let api;
  let browser;
  let cdp;
  let runWorker;
  let researchWorker;
  try {
    api = childProcess("api", ["dist/src/index.js"]);
    await waitForHealth();
    browser = await launchBrowser();
    evidence.browserExecutable = browser.executable;
    cdp = new Cdp(browser.cdpUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    const extraHeaders = new Map();
    cdp.on("Network.requestWillBeSentExtraInfo", (params) => { if (params.requestId) extraHeaders.set(params.requestId, params.headers ?? {}); });
    cdp.on("Network.requestWillBeSent", (params) => {
      const url = params.request?.url ?? "";
      const request = { requestId: params.requestId, method: params.request?.method ?? "", url, headers: params.request?.headers ?? {} };
      if (url.includes("/clear-user-messages")) evidence.requests.authoritativeTurns.push(request);
      if (url.includes("/events/stream")) evidence.requests.streams.push(request);
    });
    cdp.on("Network.responseReceived", (params) => {
      const url = params.response?.url ?? "";
      if (url.includes("/events/stream")) evidence.streamResponses.push({ requestId: params.requestId, status: params.response.status, url });
    });
    cdp.on("Network.loadingFailed", (params) => {
      if (evidence.requests.streams.some((request) => request.requestId === params.requestId)) {
        evidence.streamFailures.push({ requestId: params.requestId, errorText: params.errorText, canceled: params.canceled ?? false });
      }
    });
    cdp.on("Network.eventSourceMessageReceived", (params) => {
      evidence.eventSourceMessages.push({ requestId: params.requestId, eventId: params.eventId, eventName: params.eventName, data: params.data });
    });

    const ready = await waitFor("locked baseline client", async () => cdp.eval(`(() => {
      const input=document.querySelector('[aria-label="Message Solandra"]');
      const send=document.querySelector('button[aria-label="Send message"]');
      const timeline=document.getElementById('timeline');
      const resourceFocus=document.getElementById('resourceFocus');
      if(!input||!(send instanceof HTMLButtonElement)||!timeline||!resourceFocus)return null;
      return {
        conversationId:localStorage.getItem('lattice.solandra.conversationId'),
        layoutOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        oldUi:Boolean(document.querySelector('.orbit,.planet,.moon,.sun,[id="sunTitle"],[id="sunBody"]')),
      };
    })()`));
    assert.equal(ready.layoutOverflow, false);
    assert.equal(ready.oldUi, false);
    evidence.browser.baseline = ready;

    const conversationId = await waitFor("durable conversation id", async () => {
      const id = await cdp.eval("localStorage.getItem('lattice.solandra.conversationId')");
      return typeof id === "string" && id.length > 0 ? id : null;
    });
    evidence.conversationId = conversationId;

    const ime = await cdp.eval(`(() => {
      const input=document.querySelector('[aria-label="Message Solandra"]');
      input.value='IME draft'; input.dispatchEvent(new Event('input',{bubbles:true}));
      const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});
      input.dispatchEvent(event);
      return {value:input.value,defaultPrevented:event.defaultPrevented};
    })()`);
    await sleep(150);
    assert.equal((await getContinuity(conversationId)).messages.length, 0);
    assert.equal(ime.value, "IME draft");
    evidence.browser.ime = ime;

    const shiftEnter = await cdp.eval(`(() => {
      const input=document.querySelector('[aria-label="Message Solandra"]');
      input.value='line one'; input.dispatchEvent(new Event('input',{bubbles:true}));
      const event=new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});
      input.dispatchEvent(event);
      return {value:input.value,defaultPrevented:event.defaultPrevented};
    })()`);
    await sleep(150);
    assert.equal((await getContinuity(conversationId)).messages.length, 0);
    assert.equal(shiftEnter.value, "line one");
    evidence.browser.shiftEnter = shiftEnter;

    await cdp.eval(`(() => {
      const input=document.querySelector('[aria-label="Message Solandra"]'); const send=document.querySelector('button[aria-label="Send message"]');
      input.value=${JSON.stringify(initialContent)}; input.dispatchEvent(new Event('input',{bubbles:true}));
      if(send.disabled)throw new Error('send disabled'); send.click(); return true;
    })()`);

    const firstContinuity = await waitFor("first durable Run", async () => {
      const value = await getContinuity(conversationId);
      return value.runs?.length >= 1 ? value : null;
    });
    const firstRun = firstContinuity.runs.at(-1);
    assert.ok(firstRun?.runId);
    evidence.firstRunId = firstRun.runId;
    assert.equal(evidence.requests.authoritativeTurns.length, 1);

    const firstStreamEvent = await waitFor("browser CREATED SSE event", async () => evidence.eventSourceMessages.find((message) => message.eventId === "1") ?? null);
    const firstStreamRequest = evidence.requests.streams.find((request) => request.requestId === firstStreamEvent.requestId);
    assert.ok(firstStreamRequest);

    const preAction = await getPresentation(conversationId);
    assert.notEqual(preAction.phase, "actionable");
    assert.equal(preAction.nextAction, undefined);

    const streamsBefore = evidence.requests.streams.length;
    await stopChild(api); api = undefined;
    await sleep(300);
    api = childProcess("api-restarted", ["dist/src/index.js"]);
    await waitForHealth();

    const successfulReconnectResponse = await waitFor("EventSource reconnect", async () => evidence.streamResponses.find((response) => {
      if (response.requestId === firstStreamRequest.requestId || response.status !== 200) return false;
      return evidence.requests.streams.some((request) => request.requestId === response.requestId);
    }) ?? null, 12_000, 50);
    const reconnectRequest = evidence.requests.streams.find((request) => request.requestId === successfulReconnectResponse.requestId);
    assert.ok(reconnectRequest);
    const lastEventId = await waitFor("Last-Event-ID header", async () => header(reconnectRequest.headers, "last-event-id") ?? header(extraHeaders.get(reconnectRequest.requestId), "last-event-id") ?? null, 5_000, 50);
    assert.equal(lastEventId, "1");
    assert.ok(evidence.requests.streams.length > streamsBefore);
    evidence.reconnect = { firstRequestId:firstStreamRequest.requestId, reconnectRequestId:reconnectRequest.requestId, lastEventId };

    const readingPosition = await cdp.eval(`(() => {
      const timeline=document.getElementById('timeline');
      for(let i=0;i<10;i+=1){const node=document.createElement('div');node.className='message user';node.textContent='Reading-position probe '+i+' '+'.'.repeat(140);timeline.appendChild(node)}
      timeline.scrollLeft=0; return {scrollLeft:timeline.scrollLeft,scrollWidth:timeline.scrollWidth,clientWidth:timeline.clientWidth};
    })()`);
    assert.equal(readingPosition.scrollLeft, 0);
    assert.ok(readingPosition.scrollWidth > readingPosition.clientWidth);

    researchWorker = childProcess("research-worker", ["dist/src/research-worker-main.js"], {
      LATTICE_RESEARCH_WORKER_ID: `solandra-research:${randomUUID()}`, LATTICE_RESEARCH_WORKER_POLL_MS: "5",
    });
    runWorker = childProcess("run-worker", ["dist/src/run-worker-main.js"], {
      LATTICE_RUN_WORKER_ID: `solandra-run:${randomUUID()}`, LATTICE_RUN_WORKER_POLL_MS: "5",
    });
    await waitFor("Research worker readiness", async () => researchWorker.output.includes("LATTICE_RESEARCH_WORKER_READY"), 5_000, 25);
    await waitFor("Run worker readiness", async () => runWorker.output.includes("LATTICE_RUN_WORKER_READY"), 5_000, 25);
    await waitForCompleted(firstRun.runId);

    const actionable = await waitFor("actionable semantic presentation", async () => {
      const snapshot = await getPresentation(conversationId);
      return snapshot.phase === "actionable" && snapshot.nextAction && snapshot.resources?.length > 0 ? snapshot : null;
    });
    evidence.presentationRevision = actionable.presentationRevision;

    const visibleActionable = await waitFor("actionable baseline rendering", async () => cdp.eval(`(() => {
      const title=document.getElementById('understandingTitle')?.textContent??'';
      const detail=document.getElementById('detailCopy')?.textContent??'';
      const resources=document.querySelectorAll('#resourceList .resource').length;
      const update=document.getElementById('newUpdate');
      const timeline=document.getElementById('timeline');
      return resources>0?{title,detail,resources,newUpdateHidden:update.hidden,scrollLeft:timeline.scrollLeft}:null;
    })()`));
    assert.ok(visibleActionable.resources > 0);
    assert.equal(visibleActionable.newUpdateHidden, false);
    assert.equal(visibleActionable.scrollLeft, 0);
    evidence.browser.scrollPreservation = visibleActionable;
    await screenshot(cdp, "actionable-desktop.png");

    const takeover = await cdp.eval(`(async()=>{
      const button=document.querySelector('#resourceList .resource');
      const focus=document.getElementById('resourceFocus'); const back=document.getElementById('resourceBack'); const body=document.getElementById('resourceFocusBody'); const knowledge=document.querySelector('.knowledge');
      if(!(button instanceof HTMLButtonElement)||!(back instanceof HTMLButtonElement)||!focus||!body||!knowledge)throw new Error('resource takeover surface unavailable');
      button.click();
      const deadline=Date.now()+5000; while(Date.now()<deadline&&!focus.classList.contains('show'))await new Promise(r=>setTimeout(r,25));
      const before={show:focus.classList.contains('show'),resourceOpen:knowledge.classList.contains('resource-open'),backCount:focus.querySelectorAll('#resourceBack').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,scrollOwner:getComputedStyle(body).overflowY};
      back.click(); await new Promise(r=>requestAnimationFrame(r));
      return {...before,closed:!focus.classList.contains('show')};
    })()`);
    assert.equal(takeover.show, true); assert.equal(takeover.resourceOpen, true); assert.equal(takeover.backCount, 1);
    assert.equal(takeover.overflow, false); assert.equal(takeover.scrollOwner, "auto"); assert.equal(takeover.closed, true);
    evidence.browser.resourceTakeover = takeover;

    await cdp.send("Emulation.setDeviceMetricsOverride", { width:390, height:844, deviceScaleFactor:1, mobile:true });
    await sleep(150);
    const mobile = await cdp.eval(`(() => ({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,width:document.documentElement.clientWidth,bodyOverflow:document.body.dataset.layoutOverflow}))()`);
    assert.equal(mobile.overflow, false); evidence.browser.mobile = mobile;
    await screenshot(cdp, "mobile-390.png");

    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor:2 });
    await sleep(100);
    const zoom200 = await cdp.eval(`(() => ({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,scale:window.visualViewport?.scale??null}))()`);
    assert.equal(zoom200.overflow, false); evidence.browser.zoom200 = zoom200;
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor:1 });

    await cdp.send("Emulation.setEmulatedMedia", { features:[{name:"prefers-reduced-motion",value:"reduce"}] });
    const reducedMotion = await cdp.eval("matchMedia('(prefers-reduced-motion: reduce)').matches");
    assert.equal(reducedMotion, true); evidence.browser.reducedMotion = reducedMotion;

    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled:true, maxTouchPoints:1 });
    await cdp.send("Page.reload", { ignoreCache:true });
    await waitFor("touch-emulated restored conversation", async () => cdp.eval(`(() => localStorage.getItem('lattice.solandra.conversationId')===${JSON.stringify(conversationId)}&&document.querySelectorAll('#resourceList .resource').length>0)()`));
    const touchSubmit = await cdp.eval(`(() => {
      const input=document.querySelector('[aria-label="Message Solandra"]'); const send=document.querySelector('button[aria-label="Send message"]');
      input.focus(); input.value=${JSON.stringify(continuationContent)}; input.dispatchEvent(new Event('input',{bubbles:true})); send.click();
      return {focusedAfterClick:document.activeElement===input,maxTouchPoints:navigator.maxTouchPoints};
    })()`);
    assert.equal(touchSubmit.focusedAfterClick, false);
    evidence.browser.touchFocus = touchSubmit;

    const secondContinuity = await waitFor("continuation durable Run", async () => {
      const value = await getContinuity(conversationId); return value.runs?.length >= 2 ? value : null;
    });
    const secondRun = secondContinuity.runs.at(-1); assert.ok(secondRun?.runId); evidence.secondRunId = secondRun.runId;
    await waitForCompleted(secondRun.runId);
    await waitFor("continuation presentation update", async () => {
      const snapshot = await getPresentation(conversationId, actionable.presentationRevision);
      return snapshot.presentationRevision !== actionable.presentationRevision && snapshot.transition === "updated" ? snapshot : null;
    });
    const focusAfterAsync = await cdp.eval("document.activeElement===document.querySelector('[aria-label=\"Message Solandra\"]')");
    assert.equal(focusAfterAsync, false);

    await cdp.send("Page.reload", { ignoreCache:true });
    const restored = await waitFor("reloaded accepted presentation", async () => {
      const value = await cdp.eval(`(() => ({conversationId:localStorage.getItem('lattice.solandra.conversationId'),resources:document.querySelectorAll('#resourceList .resource').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}))()`);
      return value.conversationId === conversationId && value.resources > 0 ? value : null;
    });
    assert.equal(restored.conversationId, conversationId); assert.equal(restored.overflow, false); assert.ok(restored.resources > 0);
    await screenshot(cdp, "reconnected-restored.png");

    writeFileSync(join(artifactDir, "evidence.json"), JSON.stringify(evidence, null, 2));
    console.log(`SOLANDRA_BROWSER_ACCEPTANCE=PASS sha=${subjectSha} conversation=${conversationId}`);
  } finally {
    cdp?.close();
    await stopChild(runWorker); await stopChild(researchWorker); await stopChild(api);
    if (browser?.browser && browser.browser.exitCode === null) {
      try { browser.browser.kill(); } catch {}
      await Promise.race([once(browser.browser, "exit").catch(() => undefined), sleep(2_000)]);
    }
    if (browser?.profile) rmSync(browser.profile, { recursive:true, force:true });
  }
}

main().catch((error) => {
  writeFileSync(join(artifactDir, "evidence.json"), JSON.stringify({ ...evidence, error: error instanceof Error ? error.stack ?? error.message : String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
});
