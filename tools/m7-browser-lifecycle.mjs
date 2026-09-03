import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = process.env.M7_BASE_URL ?? "http://127.0.0.1:3107";
const subjectSha = process.env.SUBJECT_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null;
const artifactDir = resolve(process.env.M7_BROWSER_ARTIFACT_DIR ?? "artifacts/m7-browser");
const knowledgeMessage = "Explain the tradeoffs of keeping a local-first hobby app simple while preserving recoverability.";
const resourceMessage = "Prepare a checklist for reviewing a risky configuration change before I apply it.";

mkdirSync(artifactDir, { recursive: true });

const evidence = {
  sourceSha: subjectSha,
  browserExecutable: null,
  conversationId: null,
  firstRunId: null,
  secondRunId: null,
  browser: {
    baseline: null,
    preAuthority: null,
    clarificationCorrection: null,
    clarificationConfirmation: null,
    ime: null,
    shiftEnter: null,
    knowledge: null,
    resourceTakeover: null,
    mobile: null,
    zoom200: null,
    reducedMotion: null,
    touchFocus: null,
  },
  requests: { turns: [] },
};

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitFor(description, probe, timeoutMs = 15_000, intervalMs = 50) {
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
  try {
    handle.child.kill();
  } catch {
    return;
  }
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
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${path}, received ${text.slice(0, 300)}`);
    }
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

async function waitForCompleted(runId) {
  return waitFor(`Run ${runId} completion`, async () => {
    const current = await jsonRequest(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (!current.response.ok || !current.payload) return null;
    if (["FAILED", "CANCELLED"].includes(current.payload.status)) {
      throw new Error(`Run ${runId} reached ${current.payload.status}.`);
    }
    return current.payload.status === "COMPLETED" ? current.payload : null;
  });
}

async function getOutcome(runId) {
  const result = await jsonRequest(`/api/v1/runs/${encodeURIComponent(runId)}/outcome`);
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  return result.payload?.outcome;
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
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => rejectPromise(new Error("CDP connection timed out.")), 5_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectPromise(new Error("CDP connection failed."));
      }, { once: true });
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
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    assert.ok(this.socket && this.socket.readyState === WebSocket.OPEN, `CDP socket is not open for ${method}.`);
    const id = this.id++;
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
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text ?? "unknown exception"}`);
    }
    return result.result?.value;
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

async function launchBrowser() {
  const executable = installedBrowser();
  const profile = join(tmpdir(), `lattice-solandra-${randomUUID()}`);
  mkdirSync(profile, { recursive: true });
  const browser = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=msEdgeFirstRunExperience",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    baseUrl,
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

async function screenshot(cdp, filename) {
  const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(join(artifactDir, filename), Buffer.from(image.data, "base64"));
}

function conversationIdFromTurnUrl(url) {
  const match = /\/api\/v1\/conversations\/([^/]+)\/turns(?:\?|$)/u.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

async function submitBrowserTurn(cdp, message) {
  return cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    const send=document.getElementById('sendButton');
    if(!(input instanceof HTMLTextAreaElement)||!(send instanceof HTMLButtonElement))throw new Error('canonical input missing');
    input.value=${JSON.stringify(message)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    if(send.disabled)throw new Error('send disabled');
    send.click();
    return true;
  })()`);
}

async function main() {
  let api;
  let runWorker;
  let researchWorker;
  let browser;
  let cdp;
  try {
    api = childProcess("api", ["dist/src/index.js"]);
    await waitForHealth();
    runWorker = childProcess("run-worker", ["dist/src/run-worker-main.js"]);
    researchWorker = childProcess("research-worker", ["dist/src/research-worker-main.js"]);

    browser = await launchBrowser();
    evidence.browserExecutable = browser.executable;
    cdp = new Cdp(browser.cdpUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    cdp.on("Network.requestWillBeSent", (params) => {
      const url = params.request?.url ?? "";
      if (url.includes("/api/v1/conversations/") && url.includes("/turns")) {
        evidence.requests.turns.push({
          requestId: params.requestId,
          method: params.request?.method ?? "",
          url,
        });
      }
    });

    const baseline = await waitFor("canonical Solandra client", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const send=document.getElementById('sendButton');
      const conversation=document.getElementById('conversation');
      const composer=document.getElementById('composer');
      if(!(input instanceof HTMLTextAreaElement)||!(send instanceof HTMLButtonElement)||!conversation||!composer)return null;
      return {
        title:document.title,
        placeholder:input.placeholder,
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        prototypeSurface:Boolean(document.querySelector('#resourceFocus,#newUpdate,.orbit,.planet,.moon,[id="sunTitle"]')),
        bodyText:document.body.innerText,
      };
    })()`));
    assert.equal(baseline.pageOverflow, false);
    assert.equal(baseline.prototypeSurface, false);
    assert.equal(baseline.placeholder, "What do you need to figure out?");
    assert.doesNotMatch(baseline.bodyText, /Atlas Pro|Nova Air|Forge 15/i);
    assert.doesNotMatch(baseline.bodyText, /Conversation \+ adaptive Composer|Accepted understanding|semantic status/i);
    evidence.browser.baseline = baseline;

    const installClarificationFixture = async () => cdp.eval(`(() => {
      const requests=[];
      let turnCount=0;
      window.__clarificationFixtureRequests=requests;
      window.fetch=async (url,init={})=>{
        const path=String(url);
        requests.push({path,method:init.method||'GET',body:init.body||null});
        if(path==='/api/v1/conversations')return new Response(JSON.stringify({conversation:{id:'browser-clarification'}}),{status:201,headers:{'content-type':'application/json'}});
        if(path.endsWith('/turns')){
          turnCount+=1;
          if(turnCount===1)return new Response(JSON.stringify({
            status:'NEEDS_CLARIFICATION',decisionNeed:'UNRESOLVED',acceptedUnderstanding:'Compare the available approaches.',
            proposalId:'proposal-browser',question:'Do you mean the inferred comparison?',confirmationExample:"Yes, that's correct."
          }),{status:202,headers:{'content-type':'application/json'}});
          return new Response(JSON.stringify({
            status:'RUN_ACCEPTED',runId:'run-corrected',acceptedUnderstanding:'Explain the evidence instead.',decisionNeed:'NONE',intentVersionId:'intent-v2'
          }),{status:202,headers:{'content-type':'application/json'}});
        }
        if(path.includes('/clarifications/')&&path.endsWith('/confirm'))return new Response(JSON.stringify({
          status:'RUN_ACCEPTED',runId:'run-confirmed',acceptedUnderstanding:'Compare the available approaches.',decisionNeed:'QUALIFIED',intentVersionId:'intent-v2'
        }),{status:202,headers:{'content-type':'application/json'}});
        if(path.includes('/outcome'))return new Response(JSON.stringify({outcome:{
          kind:'KNOWLEDGE',acceptedUnderstanding:path.includes('run-corrected')?'Explain the evidence instead.':'Compare the available approaches.',
          findings:[],uncertainties:['Fixture limitation.'],provenance:[]
        }}),{status:200,headers:{'content-type':'application/json'}});
        throw new Error('unexpected fixture request '+path);
      };
      return true;
    })()`);

    await installClarificationFixture();
    await submitBrowserTurn(cdp, "Help me compare these approaches.");
    await waitFor("browser pending clarification", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const conversation=document.getElementById('conversation').innerText;
      const composer=document.getElementById('composer').innerText;
      return !input.disabled&&conversation.includes('Do you mean the inferred comparison?')&&!composer.includes('Do you mean the inferred comparison?') ? true : null;
    })()`));
    await submitBrowserTurn(cdp, "No, actually explain the evidence instead.");
    const correctionRouting = await waitFor("browser clarification correction", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const composerText=document.getElementById('composer').innerText;
      const conversationText=document.getElementById('conversation').innerText;
      const requests=window.__clarificationFixtureRequests;
      if(input.disabled||!conversationText.includes('Explain the evidence instead.')||!requests.some((item)=>item.path.includes('/runs/run-corrected/outcome')))return null;
      return {composerText,conversationText,requests:window.__clarificationFixtureRequests,turns:document.querySelectorAll('#conversation .turn.user').length};
    })()`));
    assert.equal(correctionRouting.turns, 2);
    assert.equal(correctionRouting.requests.filter((item) => item.path.endsWith('/turns')).length, 2);
    assert.equal(correctionRouting.requests.filter((item) => item.path.includes('/runs/run-corrected/outcome')).length, 1);
    assert.equal(correctionRouting.requests.some((item) => item.path.includes('/confirm')), false);
    assert.doesNotMatch(correctionRouting.composerText, /Do you mean the inferred comparison\?|Explain the evidence instead\.|Accepted understanding|semantic status/i);
    evidence.browser.clarificationCorrection = correctionRouting;

    await cdp.eval(`window.__latticeReloadMarker='clarification-correction'`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor("reloaded canonical Solandra client", async () => cdp.eval(`
      window.__latticeReloadMarker!=='clarification-correction'
      && document.readyState==='complete'
      && document.getElementById('conversationInput') instanceof HTMLTextAreaElement
    `));
    await installClarificationFixture();
    await submitBrowserTurn(cdp, "Help me compare these approaches.");
    await waitFor("browser pending clarification before confirmation", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const conversation=document.getElementById('conversation').innerText;
      const composer=document.getElementById('composer').innerText;
      return !input.disabled&&conversation.includes('Do you mean the inferred comparison?')&&!composer.includes('Do you mean the inferred comparison?') ? true : null;
    })()`));
    await submitBrowserTurn(cdp, "Yes, that's correct.");
    const confirmationRouting = await waitFor("browser clarification confirmation", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      if(input.disabled)return null;
      const requests=window.__clarificationFixtureRequests;
      return requests.some((item)=>item.path.includes('/confirm')) ? {requests} : null;
    })()`));
    assert.equal(confirmationRouting.requests.filter((item) => item.path.endsWith('/turns')).length, 1);
    assert.equal(confirmationRouting.requests.filter((item) => item.path.includes('/confirm')).length, 1);
    evidence.browser.clarificationConfirmation = confirmationRouting;

    await cdp.eval(`window.__latticeReloadMarker='clarification-confirmation'`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor("canonical client after clarification browser checks", async () => cdp.eval(`
      window.__latticeReloadMarker!=='clarification-confirmation'
      && document.readyState==='complete'
      && document.getElementById('conversationInput') instanceof HTMLTextAreaElement
    `));

    const ime = await cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      input.value='IME draft';
      const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});
      input.dispatchEvent(event);
      return {value:input.value,defaultPrevented:event.defaultPrevented};
    })()`);
    await sleep(150);
    assert.equal(evidence.requests.turns.length, 0);
    assert.equal(ime.value, "IME draft");
    evidence.browser.ime = ime;

    const shiftEnter = await cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      input.value='line one';
      const event=new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});
      input.dispatchEvent(event);
      return {value:input.value,defaultPrevented:event.defaultPrevented};
    })()`);
    await sleep(150);
    assert.equal(evidence.requests.turns.length, 0);
    assert.equal(shiftEnter.value, "line one");
    assert.equal(shiftEnter.defaultPrevented, false);
    evidence.browser.shiftEnter = shiftEnter;

    let pausedTurnRequestId = null;
    cdp.on("Fetch.requestPaused", (params) => {
      if (params.request?.url?.includes("/api/v1/conversations/") && params.request.url.includes("/turns")) {
        pausedTurnRequestId = params.requestId;
      } else {
        void cdp.send("Fetch.continueRequest", { requestId: params.requestId });
      }
    });
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*/api/v1/conversations/*/turns", requestStage: "Request" }],
    });
    await submitBrowserTurn(cdp, knowledgeMessage);
    const pausedRequestId = await waitFor("paused first consultation turn", async () => pausedTurnRequestId);
    const preAuthority = await cdp.eval(`(() => ({
      composerText:document.getElementById('composer').innerText,
      userTurn:document.querySelector('#conversation .turn.user')?.textContent ?? '',
    }))()`);
    assert.equal(preAuthority.userTurn, knowledgeMessage);
    assert.equal(preAuthority.composerText.trim(), "");
    assert.equal(preAuthority.composerText.includes(knowledgeMessage), false);
    assert.doesNotMatch(preAuthority.composerText, /Accepted understanding|What you said|Interpreting/);
    evidence.browser.preAuthority = preAuthority;
    await cdp.send("Fetch.continueRequest", { requestId: pausedRequestId });
    await cdp.send("Fetch.disable");
    const firstRequest = await waitFor("first consultation turn request", async () => evidence.requests.turns[0] ?? null);
    assert.equal(firstRequest.method, "POST");
    const conversationId = conversationIdFromTurnUrl(firstRequest.url);
    assert.ok(conversationId);
    evidence.conversationId = conversationId;

    const firstContinuity = await waitFor("first durable consultation Run", async () => {
      const continuity = await getContinuity(conversationId);
      return continuity.runs?.length >= 1 ? continuity : null;
    });
    const firstRun = firstContinuity.runs.at(-1);
    assert.ok(firstRun?.runId);
    evidence.firstRunId = firstRun.runId;
    const completedKnowledge = await waitForCompleted(firstRun.runId);
    assert.equal(completedKnowledge.decision, null);
    assert.equal(completedKnowledge.events.some((event) => event.type === "DECIDING"), false);
    const knowledgeOutcome = await getOutcome(firstRun.runId);
    assert.equal(knowledgeOutcome.kind, "KNOWLEDGE");
    assert.equal(knowledgeOutcome.acceptedUnderstanding, knowledgeMessage);

    const renderedKnowledge = await waitFor("knowledge outcome in Composer", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const composer=document.getElementById('composer');
      if(input.disabled)return null;
      const text=composer.innerText;
      const conversationText=document.getElementById('conversation').innerText;
      return text.includes('No validated external findings')&&conversationText.includes('I don’t have validated external findings') ? {
        text,
        conversationText,
        conversationTurns:document.querySelectorAll('#conversation .turn.user').length,
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      } : null;
    })()`));
    assert.equal(renderedKnowledge.conversationTurns, 1);
    assert.equal(renderedKnowledge.pageOverflow, false);
    assert.equal(renderedKnowledge.text.includes(knowledgeMessage), false);
    assert.doesNotMatch(renderedKnowledge.text, /Accepted understanding|What you said|Interpreting|Confidence:|Provenance/i);
    assert.doesNotMatch(renderedKnowledge.text, /winner|Atlas Pro|Nova Air|Forge 15/i);
    evidence.browser.knowledge = renderedKnowledge;
    await screenshot(cdp, "knowledge-desktop.png");

    await submitBrowserTurn(cdp, resourceMessage);
    await waitFor("second consultation turn request", async () => evidence.requests.turns.length >= 2 ? evidence.requests.turns[1] : null);
    const secondContinuity = await waitFor("second durable consultation Run", async () => {
      const continuity = await getContinuity(conversationId);
      return continuity.runs?.length >= 2 ? continuity : null;
    });
    const secondRun = secondContinuity.runs.at(-1);
    assert.ok(secondRun?.runId);
    evidence.secondRunId = secondRun.runId;
    await waitForCompleted(secondRun.runId);
    const resourceOutcome = await getOutcome(secondRun.runId);
    assert.equal(resourceOutcome.kind, "ACTION_PREPARATION");
    assert.equal(resourceOutcome.resource.kind, "CHECKLIST");
    assert.equal(resourceOutcome.resource.editable, true);
    assert.equal(resourceOutcome.resource.executionAuthorized, false);

    const resourceTakeover = await waitFor("prepared checklist takeover", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const prepared=document.querySelector('textarea[aria-label="Prepared resource"]');
      const composer=document.getElementById('composer');
      if(input.disabled||!(prepared instanceof HTMLTextAreaElement))return null;
      return {
        editable:!prepared.disabled&&!prepared.readOnly,
        title:composer.innerText.includes('Prepared checklist'),
        stackedKnowledge:composer.innerText.includes('What remains uncertain')||composer.innerText.includes('No validated external findings'),
        solandraAcknowledgement:document.getElementById('conversation').innerText.includes('Nothing has been sent or executed.'),
        conversationTurns:document.querySelectorAll('#conversation .turn.user').length,
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      };
    })()`));
    assert.equal(resourceTakeover.editable, true);
    assert.equal(resourceTakeover.title, true);
    assert.equal(resourceTakeover.stackedKnowledge, false);
    assert.equal(resourceTakeover.solandraAcknowledgement, true);
    assert.equal(resourceTakeover.conversationTurns, 2);
    assert.equal(resourceTakeover.pageOverflow, false);
    evidence.browser.resourceTakeover = resourceTakeover;
    await screenshot(cdp, "resource-desktop.png");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const mobile = await cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const composer=document.getElementById('composer');
      const inputRect=input.getBoundingClientRect();
      const composerRect=composer.getBoundingClientRect();
      return {
        pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
        inputVisible:inputRect.width>0&&inputRect.top<innerHeight&&inputRect.bottom>0,
        composerWidth:composerRect.width,
        viewportWidth:innerWidth,
      };
    })()`);
    assert.equal(mobile.pageOverflow, false);
    assert.equal(mobile.inputVisible, true);
    assert.ok(mobile.composerWidth <= mobile.viewportWidth);
    evidence.browser.mobile = mobile;
    await screenshot(cdp, "resource-mobile.png");

    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const zoom200 = await cdp.eval(`(() => ({
      pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      inputPresent:Boolean(document.getElementById('conversationInput')),
      composerPresent:Boolean(document.getElementById('composer')),
    }))()`);
    assert.equal(zoom200.pageOverflow, false);
    assert.equal(zoom200.inputPresent, true);
    assert.equal(zoom200.composerPresent, true);
    evidence.browser.zoom200 = zoom200;
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const reducedMotion = await cdp.eval(`(() => ({
      matches:matchMedia('(prefers-reduced-motion: reduce)').matches,
      pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    }))()`);
    assert.equal(reducedMotion.matches, true);
    assert.equal(reducedMotion.pageOverflow, false);
    evidence.browser.reducedMotion = reducedMotion;

    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const touchFocus = await cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      input.focus();
      return {
        focused:document.activeElement===input,
        touchPoints:navigator.maxTouchPoints,
      };
    })()`);
    assert.equal(touchFocus.focused, true);
    assert.ok(touchFocus.touchPoints >= 1);
    evidence.browser.touchFocus = touchFocus;

    const continuity = await getContinuity(conversationId);
    assert.equal(continuity.messages.length, 2);
    assert.equal(continuity.messages[0].content, knowledgeMessage);
    assert.equal(continuity.messages[1].content, resourceMessage);

    writeFileSync(join(artifactDir, "browser-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`M7_BROWSER_LIFECYCLE_PASS source=${subjectSha ?? "unknown"} conversation=${conversationId}`);
  } catch (error) {
    writeFileSync(join(artifactDir, "browser-evidence.json"), `${JSON.stringify({ ...evidence, failure: error instanceof Error ? error.stack : String(error) }, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    cdp?.close();
    if (browser?.browser && browser.browser.exitCode === null) {
      try { browser.browser.kill(); } catch {}
    }
    await stopChild(researchWorker);
    await stopChild(runWorker);
    await stopChild(api);
    if (browser?.profile) rmSync(browser.profile, { recursive: true, force: true });
  }
}

await main();
