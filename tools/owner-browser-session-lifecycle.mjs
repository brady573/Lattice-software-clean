import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.OWNER_SESSION_BASE_URL ?? "http://127.0.0.1:3108";
const ownerToken = process.env.OWNER_SESSION_TEST_TOKEN ?? "";
const browserExecutable = process.env.M7_BROWSER_EXECUTABLE ?? "";
const journeyMessage = "Prepare a checklist for reviewing a risky configuration change before I apply it.";
assert.ok(ownerToken.length >= 32, "Owner session browser proof requires a disposable test Owner token.");
assert.ok(browserExecutable && existsSync(browserExecutable), "Owner session browser proof requires Chrome/Chromium.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(description, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(75);
  }
  throw new Error(`Timed out waiting for ${description}.${lastError instanceof Error ? ` ${lastError.message}` : ""}`);
}

function spawnRuntime(args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[owner-session-runtime] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stdout.write(`[owner-session-runtime] ${chunk}`));
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timed out.")), 5_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed.")); }, { once: true });
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
    assert.ok(this.socket?.readyState === WebSocket.OPEN);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out.`)); }, 10_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
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

async function launchBrowser(url) {
  const profile = join(tmpdir(), `lattice-owner-session-${randomUUID()}`);
  mkdirSync(profile, { recursive: true });
  const browser = spawn(browserExecutable, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, url,
  ], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  const port = await waitFor("browser DevTools port", () => {
    if (!existsSync(portFile)) return null;
    const value = Number.parseInt(readFileSync(portFile, "utf8").split(/\r?\n/u)[0] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const target = await waitFor("browser page target", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    return targets.find((item) => item.type === "page") ?? null;
  });
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { browser, profile, cdp };
}

async function closeBrowser(handle) {
  handle?.cdp.close();
  await stop(handle?.browser);
  if (handle?.profile) rmSync(handle.profile, { recursive: true, force: true });
}

async function main() {
  const runtimeEnv = {
    LATTICE_DEPLOYMENT_MODE: "durable",
    LATTICE_AUTHENTICATION_MODE: "required",
    LATTICE_OWNER_ACCESS_TOKEN: ownerToken,
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: "false",
    LATTICE_RUN_WORKER_LEASE_MS: "5000",
    LATTICE_RUN_WORKER_RETRY_DELAY_MS: "5",
    LATTICE_RUN_WORKER_BATCH_SIZE: "4",
    PORT: "3108",
    HOST: "127.0.0.1",
  };
  let api;
  let worker;
  let authorizedBrowser;
  let unauthorizedBrowser;
  try {
    api = spawnRuntime(["dist/src/index.js"], runtimeEnv);
    await waitFor("required-auth API", async () => (await fetch(`${baseUrl}/health`).catch(() => null))?.ok === true);
    worker = spawnRuntime(["dist/src/run-worker-main.js"], runtimeEnv);

    const denied = await fetch(`${baseUrl}/api/v1/conversations`);
    assert.equal(denied.status, 401);

    const issue = await fetch(`${baseUrl}/api/v1/auth/browser-session-grants`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(issue.status, 200);
    const grant = await issue.json();
    assert.match(grant.grant, /^[A-Za-z0-9_-]{43}$/u);

    authorizedBrowser = await launchBrowser(`${baseUrl}/auth/session/bootstrap#grant=${encodeURIComponent(grant.grant)}`);
    await waitFor("authorized canonical Solandra", async () => authorizedBrowser.cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const gate=document.getElementById('ownerAccessGate');
      const stored=sessionStorage.getItem('lattice.solandra.owner-access.v1');
      return location.pathname==='/' && input instanceof HTMLTextAreaElement && gate?.hidden===true && !stored ? true : null;
    })()`));

    await authorizedBrowser.cdp.send("Page.reload", { ignoreCache: true });
    await waitFor("authorized Solandra after refresh", async () => authorizedBrowser.cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const gate=document.getElementById('ownerAccessGate');
      return document.readyState==='complete' && input instanceof HTMLTextAreaElement && gate?.hidden===true ? true : null;
    })()`));

    await authorizedBrowser.cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const send=document.getElementById('sendButton');
      if(!(input instanceof HTMLTextAreaElement)||!(send instanceof HTMLButtonElement))throw new Error('canonical Solandra controls missing');
      input.value=${JSON.stringify(journeyMessage)};
      input.dispatchEvent(new Event('input',{bubbles:true}));
      if(send.disabled)throw new Error('canonical send control disabled');
      send.click();
      return true;
    })()`);
    const journey = await waitFor("ordinary Solandra journey completion", async () => authorizedBrowser.cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const gate=document.getElementById('ownerAccessGate');
      const conversation=document.getElementById('conversation')?.innerText ?? '';
      return !input.disabled && gate?.hidden===true && conversation.includes(${JSON.stringify(journeyMessage)})
        ? { conversation, composer:document.getElementById('composer')?.innerText ?? '' }
        : null;
    })()`), 30_000);
    assert.match(journey.conversation, /Prepare a checklist/u);

    unauthorizedBrowser = await launchBrowser(baseUrl);
    await waitFor("unauthorized Owner access gate", async () => unauthorizedBrowser.cdp.eval(`(() => {
      const gate=document.getElementById('ownerAccessGate');
      const input=document.getElementById('conversationInput');
      return gate?.hidden===false && input instanceof HTMLTextAreaElement ? true : null;
    })()`));

    console.log("OWNER_BROWSER_SESSION_LIFECYCLE=PASS");
  } finally {
    await closeBrowser(unauthorizedBrowser);
    await closeBrowser(authorizedBrowser);
    await stop(worker);
    await stop(api);
  }
}

await main();
