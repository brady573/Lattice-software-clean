import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

function ownerAccessScript(): string {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /<script>\s*(\(\(\) => \{\s*const STORAGE_KEY = "lattice\.solandra\.owner-access\.v1";[\s\S]*?\}\)\(\);)\s*<\/script>/u.exec(html);
  assert.ok(match?.[1], "Owner-access browser behavior must remain present in the canonical page");
  return match[1];
}

async function runOwnerAccessInitialization(status: number): Promise<{
  gateHidden: boolean;
  inputDisabled: boolean;
  sendDisabled: boolean;
}> {
  const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  const gate = { hidden: true };
  const ownerInput = { value: "", focus() {} };
  const submit = { disabled: false };
  const errorNode = { textContent: "" };
  const conversationInput = { disabled: false };
  const sendButton = { disabled: false };
  const elements = new Map<string, unknown>([
    ["ownerAccessGate", gate],
    ["ownerAccessForm", { addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) { listeners.set(type, listener); } }],
    ["ownerAccessInput", ownerInput],
    ["ownerAccessSubmit", submit],
    ["ownerAccessError", errorNode],
    ["conversationInput", conversationInput],
    ["sendButton", sendButton],
  ]);
  const storage = new Map<string, string>();
  const fetchImpl = async () => new Response(
    status === 200 ? JSON.stringify({ capability: { status: "UNAVAILABLE" } }) : "",
    { status, headers: { "content-type": "application/json" } },
  );
  const windowObject = {
    fetch: fetchImpl,
    location: { href: "http://solandra.test/", origin: "http://solandra.test", reload() {} },
    sessionStorage: {
      getItem(key: string) { return storage.get(key) ?? null; },
      setItem(key: string, value: string) { storage.set(key, value); },
      removeItem(key: string) { storage.delete(key); },
    },
    ownerFetch: undefined as unknown,
  };
  vm.runInNewContext(ownerAccessScript(), {
    window: windowObject,
    document: { getElementById(id: string) { return elements.get(id) ?? null; } },
    URL,
    Request,
    Headers,
    Response,
    queueMicrotask,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    gateHidden: gate.hidden,
    inputDisabled: conversationInput.disabled,
    sendDisabled: sendButton.disabled,
  };
}

test("Owner access gate appears when the authoritative capability/auth probe returns 401", async () => {
  const state = await runOwnerAccessInitialization(401);
  assert.equal(state.gateHidden, false);
});

test("Owner access gate stays hidden when capability discovery returns non-auth 503", async () => {
  const state = await runOwnerAccessInitialization(503);
  assert.equal(state.gateHidden, true);
  assert.equal(state.inputDisabled, false);
  assert.equal(state.sendDisabled, false);
});

test("Owner access gate stays hidden on the normal successful validator capability path", async () => {
  const state = await runOwnerAccessInitialization(200);
  assert.equal(state.gateHidden, true);
  assert.equal(state.inputDisabled, false);
  assert.equal(state.sendDisabled, false);
});
