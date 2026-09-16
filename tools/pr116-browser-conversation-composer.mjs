import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const baseUrl = "http://127.0.0.1:3112";
const modelBaseUrl = "http://127.0.0.1:3111/v1";
const subjectSha = process.env.SUBJECT_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null;
const artifactDir = resolve(process.env.PR116_BROWSER_ARTIFACT_DIR ?? "artifacts/pr116-browser-composition");

const cases = [
  {
    id: "cat6-canary",
    message: "Give me instructions on how to setup a cat6 patch panel in my house",
    conversationText: [
      "Sure — the cleanest way to approach this is to treat the patch panel as the fixed termination point for your home runs.",
      "If you want, we can also turn that into a room-by-room labeling and test checklist.",
    ].join("\n\n"),
    body: [
      "1. Choose a reachable location for the patch panel and network equipment.",
      "2. Mount the panel securely and route each cable to it with enough service slack to work comfortably.",
      "3. Label both ends of every cable before terminating anything.",
      "4. Strip only the jacket length you need, preserve the pair twists as close to the termination as practical, and follow the panel's printed wiring scheme consistently.",
      "5. Punch each conductor into the matching slot with the proper termination tool and trim the excess.",
      "6. Add strain relief and cable management so the terminations are not supporting cable weight.",
      "7. Terminate the room ends consistently, then test every run end-to-end before connecting switches or other equipment.",
    ].join("\n"),
  },
  {
    id: "moving-checklist",
    message: "Make me a detailed moving-day checklist for relocating from one apartment to another without forgetting the practical handoff tasks.",
    conversationText: [
      "A good moving-day checklist should separate what must happen before loading, during the move, and at each handoff.",
      "You can keep this as the master list and add address-specific tasks underneath each section.",
    ].join("\n\n"),
    body: [
      "Before loading",
      "- Pack a first-night bag and keep documents, keys, chargers, medicine, and valuables with you.",
      "- Photograph the old apartment's condition and record utility meter readings where applicable.",
      "- Confirm elevator, parking, access, and key arrangements at both addresses.",
      "During the move",
      "- Keep a simple room/box inventory and load essentials last so they come off first.",
      "- Do a final cabinet, closet, outlet, and storage-area sweep before leaving.",
      "Handoff",
      "- Return keys or access devices as agreed and save the handoff confirmation.",
      "- Photograph the new apartment before unpacking and note any pre-existing issues.",
    ].join("\n"),
  },
  {
    id: "piano-plan",
    message: "Create a four-week practice plan for learning a short piano piece, with a clear focus for each week and concrete practice tasks.",
    conversationText: [
      "Here’s a four-week structure that keeps the piece moving forward without making every session about full-speed play-throughs.",
      "If you tell me roughly how long you practice each day, we can scale the sessions without changing the four-week structure.",
    ].join("\n\n"),
    body: [
      "Week 1 — Map the piece",
      "- Mark sections, fingerings, difficult transitions, and a comfortable starting tempo.",
      "- Practice hands separately in short sections and stop before mistakes become repetitions.",
      "Week 2 — Connect sections",
      "- Join neighboring sections slowly and practice transitions more often than easy passages.",
      "- End sessions with one relaxed partial play-through.",
      "Week 3 — Build continuity",
      "- Increase tempo only where accuracy stays stable.",
      "- Practice starting from several internal landmarks instead of only from the beginning.",
      "Week 4 — Perform and refine",
      "- Alternate full play-throughs with focused repair of the few remaining weak spots.",
      "- Record at least one run and use it to choose the final refinements.",
    ].join("\n"),
  },
];

const shortFollowUp = {
  message: "What should I focus on first?",
  conversationText: "Start with the first concrete item that reduces uncertainty for the rest of the work, then reassess before adding more detail.",
};

mkdirSync(artifactDir, { recursive: true });
const evidence = { sourceSha: subjectSha, cases: [], continuity: null, browserExecutable: null };

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

function installedBrowser() {
  const candidates = [process.env.M7_BROWSER_EXECUTABLE];
  for (const root of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
    if (!root) continue;
    candidates.push(join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    candidates.push(join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  const executable = [...new Set(candidates.filter(Boolean))].find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("No installed Edge or Chrome executable is available for PR #116 browser validation.");
  return executable;
}

function childProcess(label, args, env) {
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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function modelOutputFor(prompt) {
  for (const entry of cases) {
    if (prompt.includes(`Current USER message: ${entry.message}`)) {
      return {
        mode: "CONVERSATION",
        presentation: { conversationText: entry.conversationText, composerBody: entry.body },
      };
    }
  }
  if (prompt.includes(`Current USER message: ${shortFollowUp.message}`)) {
    return {
      mode: "CONVERSATION",
      presentation: { conversationText: shortFollowUp.conversationText, composerBody: null },
    };
  }
  throw new Error("PR #116 browser model fixture received an unexpected prompt.");
}

async function startModelFixture() {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(await readRequestBody(request));
      const prompt = Array.isArray(body.messages)
        ? body.messages.map((message) => String(message?.content ?? "")).join("\n")
        : "";
      const output = modelOutputFor(prompt);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: `pr116-browser-model-${randomUUID()}`,
        object: "chat.completion",
        model: body.model ?? "pr116-browser-fixture",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(3111, "127.0.0.1", resolvePromise);
  });
  return server;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => rejectPromise(new Error("CDP connection timed out.")), 5_000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolvePromise(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); rejectPromise(new Error("CDP connection failed.")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (typeof message.id !== "number") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
    });
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

  close() {
    try { this.socket?.close(); } catch {}
  }
}

async function launchBrowser() {
  const executable = installedBrowser();
  const profile = join(tmpdir(), `lattice-pr116-${randomUUID()}`);
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
  const target = await waitFor("PR #116 Product browser target", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json();
    return targets.find((item) => item.type === "page" && item.url?.startsWith(baseUrl)) ?? null;
  });
  return { executable, profile, browser, cdpUrl: target.webSocketDebuggerUrl };
}

async function submitBrowserTurn(cdp, message) {
  await cdp.eval(`(() => {
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

async function observeCase(cdp, entry) {
  const before = await cdp.eval(`document.querySelectorAll('#conversation .turn.solandra').length`);
  await submitBrowserTurn(cdp, entry.message);
  const observed = await waitFor(entry.id, async () => cdp.eval(`(() => {
    const turns=[...document.querySelectorAll('#conversation .turn')].map((node)=>({text:node.textContent||'',user:node.classList.contains('user'),solandra:node.classList.contains('solandra')}));
    const composer=document.querySelector('#composer [data-presentation-role="ordinary-generated-work"]');
    const cue=document.getElementById('conversationAuthorityContext');
    const solandra=turns.filter((turn)=>turn.solandra);
    const user=turns.filter((turn)=>turn.user);
    if(solandra.length<${before + 1}||!composer||!cue)return null;
    return {turns,composerText:composer.textContent||'',cueHidden:cue.hidden,cueText:cue.textContent||'',bodyText:document.body.innerText};
  })()`));

  const lastSolandra = observed.turns.filter((turn) => turn.solandra).at(-1)?.text;
  const lastUser = observed.turns.filter((turn) => turn.user).at(-1)?.text;
  assert.equal(lastUser, entry.message);
  assert.equal(lastSolandra, entry.conversationText);
  assert.equal(observed.composerText, entry.body);
  assert.equal(observed.cueHidden, false);
  assert.equal(observed.cueText.trim(), "General conversation");
  assert.ok(!lastSolandra.includes(entry.body), `${entry.id} body must not be duplicated into Conversation.`);
  assert.doesNotMatch(observed.bodyText, /CONVERSATION_COMPLETED|composerBody|factualAuthority|NON_AUTHORITATIVE_CONVERSATION|runId/u);
  return {
    id: entry.id,
    userTurn: lastUser,
    conversationText: lastSolandra,
    composerBody: observed.composerText,
    generalConversationVisible: !observed.cueHidden,
  };
}

async function main() {
  let modelServer;
  let app;
  let browser;
  let cdp;
  try {
    modelServer = await startModelFixture();
    app = childProcess("pr116-app", ["dist/src/index.js"], {
      PORT: "3112",
      HOST: "127.0.0.1",
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_TRUTH_MODE: "v36-offline",
      LATTICE_AUTHENTICATION_MODE: "development-fixture",
      LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "pr116-browser-user",
      LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: modelBaseUrl,
      LATTICE_LOCAL_MODEL_PROVIDER_MODEL: "pr116-browser-fixture",
      LATTICE_AUTO_MIGRATE: "false",
      LATTICE_SOLANDRA_COGNITION_ROUTE: undefined,
      LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE: undefined,
    });
    await waitFor("PR #116 canonical app health", async () => {
      const response = await fetch(`${baseUrl}/health`).catch(() => null);
      return response?.ok === true;
    }, 12_000, 100);

    browser = await launchBrowser();
    evidence.browserExecutable = browser.executable;
    cdp = new Cdp(browser.cdpUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    await waitFor("canonical Solandra composition surface", async () => cdp.eval(`(() => {
      const input=document.getElementById('conversationInput');
      const composer=document.getElementById('composer');
      return input instanceof HTMLTextAreaElement && composer ? true : null;
    })()`));

    for (const entry of cases) evidence.cases.push(await observeCase(cdp, entry));

    const composerBeforeFollowUp = await cdp.eval(`document.querySelector('#composer [data-presentation-role="ordinary-generated-work"]')?.textContent||''`);
    const solandraCount = await cdp.eval(`document.querySelectorAll('#conversation .turn.solandra').length`);
    await submitBrowserTurn(cdp, shortFollowUp.message);
    const continuity = await waitFor("ordinary conversation continuity after Composer work", async () => cdp.eval(`(() => {
      const solandra=[...document.querySelectorAll('#conversation .turn.solandra')].map((node)=>node.textContent||'');
      if(solandra.length<${solandraCount + 1})return null;
      return {
        lastSolandra:solandra.at(-1),
        composerText:document.querySelector('#composer [data-presentation-role="ordinary-generated-work"]')?.textContent||'',
        cueHidden:document.getElementById('conversationAuthorityContext')?.hidden ?? true,
      };
    })()`));
    assert.equal(continuity.lastSolandra, shortFollowUp.conversationText);
    assert.equal(continuity.composerText, composerBeforeFollowUp);
    assert.equal(continuity.cueHidden, false);
    evidence.continuity = continuity;

    const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(join(artifactDir, "conversation-composer.png"), Buffer.from(image.data, "base64"));
    writeFileSync(join(artifactDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
    console.log("PR116_BROWSER_CONVERSATION_COMPOSER=PASS");
  } finally {
    cdp?.close();
    if (browser?.browser && browser.browser.exitCode === null) {
      try { browser.browser.kill(); } catch {}
      await Promise.race([once(browser.browser, "exit").catch(() => {}), sleep(2_000)]);
    }
    if (browser?.profile) rmSync(browser.profile, { recursive: true, force: true });
    await stopChild(app);
    if (modelServer) await new Promise((resolvePromise) => modelServer.close(resolvePromise));
  }
}

await main();
