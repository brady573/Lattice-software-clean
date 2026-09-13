import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { renderSolandraAuthoritativeConversationPage } from "../dist/src/ui/solandra-authoritative-conversation-page.js";

const browserExecutable = process.env.M7_BROWSER_EXECUTABLE;
if (!browserExecutable) throw new Error("M7_BROWSER_EXECUTABLE is required.");

const objective = "Ask the facilities coordinator about a room reservation.";
const draft = "The room is guaranteed to be open all evening, so could you reserve it for our workshop?";
const selectedSupport = "The published schedule lists the room as occupied until 6 PM.";
const siblingKnowledge = "The lobby closes at 9 PM.";
const uncertainty = "The published schedule does not establish availability after 6 PM.";

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderSolandraAuthoritativeConversationPage());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/capabilities/model-assistance") {
    json(response, 200, { capability: { status: "UNAVAILABLE", authorized: false } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/capabilities/user-model") {
    json(response, 200, { capability: { status: "UNAVAILABLE", authorized: false } });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/conversations") {
    json(response, 201, { conversation: { id: "issue-46-browser-conversation" } });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/conversations/issue-46-browser-conversation/turns") {
    json(response, 202, {
      status: "RUN_ACCEPTED",
      runId: "issue-46-browser-run",
      intentVersionId: "issue-46-browser-intent",
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/runs/issue-46-browser-run/outcome") {
    json(response, 200, {
      outcome: {
        kind: "ACTION_PREPARATION",
        knowledge: {
          kind: "KNOWLEDGE",
          objective,
          acceptedUnderstanding: objective,
          findings: [
            { claimId: "claim-selected", text: selectedSupport, status: "SUPPORTED" },
            { claimId: "claim-sibling", text: siblingKnowledge, status: "SUPPORTED" },
          ],
          uncertainties: [],
          provenance: [],
          truthAssessmentIds: ["truth-selected", "truth-sibling"],
        },
        resource: {
          kind: "PREPARED_MESSAGE",
          title: "Prepared message",
          body: draft,
          draftAuthority: { origin: "SOLANDRA", factualAuthority: false, userAuthored: false },
          basis: [{ knowledgeId: "knowledge-room", claimIds: ["claim-selected"] }],
          preservedUncertainties: [uncertainty],
          editable: true,
          executionAuthorized: false,
        },
      },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/runs/issue-46-browser-run") {
    json(response, 200, { id: "issue-46-browser-run", status: "COMPLETED" });
    return;
  }
  json(response, 404, { error: "NOT_FOUND" });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port.");
const baseUrl = `http://127.0.0.1:${address.port}`;

const profile = join(tmpdir(), `lattice-issue46-browser-${randomUUID()}`);
mkdirSync(profile, { recursive: true });
const browser = spawn(browserExecutable, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  baseUrl,
], { stdio: ["ignore", "pipe", "pipe"] });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label, probe, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(50);
  }
  throw new Error(`${label} timed out${last instanceof Error ? `: ${last.message}` : ""}`);
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
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
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
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser evaluation failed");
    return result.result?.value;
  }
}

let cdp;
try {
  const portFile = join(profile, "DevToolsActivePort");
  const debugPort = await waitFor("DevToolsActivePort", async () => {
    if (!existsSync(portFile)) return null;
    const value = Number.parseInt(readFileSync(portFile, "utf8").split(/\r?\n/u)[0] ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const target = await waitFor("fixture browser target", async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.url?.startsWith(baseUrl)) ?? null;
  });
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");

  await waitFor("canonical prepared-message client", async () => cdp.eval(`Boolean(document.getElementById('conversationInput') && document.getElementById('sendButton'))`));
  await cdp.eval(`(() => {
    const input=document.getElementById('conversationInput');
    input.value='Draft a note asking about the room.';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('sendButton').click();
    return true;
  })()`);

  const visible = await waitFor("prepared draft trust treatment", async () => cdp.eval(`(() => {
    const composer=document.getElementById('composer');
    const prepared=document.querySelector('textarea[aria-label="Prepared resource"]');
    if(!(prepared instanceof HTMLTextAreaElement))return null;
    const text=composer.innerText;
    if(!text.includes('Solandra draft')||!text.includes('Established support'))return null;
    return { text, body:prepared.value, editable:!prepared.disabled&&!prepared.readOnly, conversation:document.getElementById('conversation').innerText };
  })()`));

  assert.equal(visible.body, draft);
  assert.equal(visible.editable, true);
  assert.match(visible.text, /This wording is a draft, not established fact\./u);
  assert.match(visible.text, new RegExp(selectedSupport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(visible.text, new RegExp(siblingKnowledge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.match(visible.text, new RegExp(uncertainty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.match(visible.conversation, /Nothing has been sent or executed\./u);
  console.log("ISSUE46_BROWSER_PREPARED_MESSAGE=PASS");
} finally {
  try { cdp?.socket?.close(); } catch {}
  try { browser.kill(); } catch {}
  await new Promise((resolve) => server.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
