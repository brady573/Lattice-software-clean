import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.OWNER_AUTH_BASE_URL;
const browserExecutable = process.env.OWNER_AUTH_BROWSER_EXECUTABLE;
const correctToken = process.env.LATTICE_OWNER_ACCESS_TOKEN;
assert.ok(baseUrl);
assert.ok(browserExecutable);
assert.ok(correctToken);

const wrongToken = "wrong-owner-access-token-0000000000000000000000000000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(description, probe, timeoutMs = 30000, intervalMs = 100) {
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
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit").catch(() => {}), sleep(2000)]);
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
      const timeout = setTimeout(() => reject(new Error("CDP connect timeout")), 5000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP connect failed")); }, { once: true });
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
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    return result.result?.value;
  }
  close() { try { this.socket?.close(); } catch {} }
}

const profile = join(tmpdir(), `lattice-owner-auth-${randomUUID()}`);
mkdirSync(profile, { recursive: true });
const browser = spawn(browserExecutable, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, baseUrl,
], { stdio: ["ignore", "pipe", "pipe"] });
let cdp;
try {
  const portFile = join(profile, "DevToolsActivePort");
  const port = await waitFor("browser debug port", async () => {
    if (!existsSync(portFile)) return null;
    const value = Number.parseInt(readFileSync(portFile, "utf8").split(/\r?\n/)[0] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const target = await waitFor("canonical Solandra page", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.url.startsWith(baseUrl)) ?? null;
  });
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  await waitFor("Owner access gate", async () => await cdp.eval(`document.getElementById('ownerAccessGate')?.hidden === false`));
  console.log("OWNER_BROWSER_GATE=PASS");

  await cdp.eval(`(() => { document.getElementById('ownerAccessInput').value = ${JSON.stringify(wrongToken)}; document.getElementById('ownerAccessForm').requestSubmit(); return true; })()`);
  await waitFor("invalid access message", async () => await cdp.eval(`document.getElementById('ownerAccessError')?.textContent?.includes('not accepted') === true`));
  assert.equal(await cdp.eval(`sessionStorage.getItem('lattice.solandra.owner-access.v1')`), null);
  assert.equal(await cdp.eval(`localStorage.getItem('lattice.solandra.conversation.v1')`), null);
  console.log("OWNER_BROWSER_WRONG_KEY_BLOCKED=PASS");

  await cdp.eval(`(() => { document.getElementById('ownerAccessInput').value = ${JSON.stringify(correctToken)}; document.getElementById('ownerAccessForm').requestSubmit(); return true; })()`);
  await waitFor("authenticated reload", async () => await cdp.eval(`document.getElementById('ownerAccessGate')?.hidden === true && sessionStorage.getItem('lattice.solandra.owner-access.v1') !== null`));
  console.log("OWNER_BROWSER_CORRECT_KEY=PASS");

  await cdp.eval(`(() => { const input = document.getElementById('conversationInput'); input.value = 'Help me organize a short note.'; document.getElementById('conversationForm').requestSubmit(); return true; })()`);
  const conversationId = await waitFor("authenticated conversation creation", async () => await cdp.eval(`localStorage.getItem('lattice.solandra.conversation.v1')`));
  assert.ok(conversationId);
  const continuityStatus = await cdp.eval(`window.ownerFetch('/api/v1/conversations/' + encodeURIComponent(${JSON.stringify(conversationId)}) + '/continuity').then((r) => r.status)`);
  assert.equal(continuityStatus, 200);
  console.log("OWNER_BROWSER_AUTHENTICATED_API=PASS");
  console.log("LATTICE_SINGLE_OWNER_BROWSER_PROOF=PASS");
} finally {
  cdp?.close();
  await stop(browser);
  rmSync(profile, { recursive: true, force: true });
}
