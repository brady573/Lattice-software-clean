import { renderSolandraConversationPage } from "./solandra-conversation-page.js";

const capabilityStyles = `
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .capability-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .capability-button { border: 1px solid #c8c4b8; border-radius: 999px; background: #fffefa; color: #282722; padding: 7px 10px; cursor: pointer; font-size: .8rem; }
    .capability-button[aria-busy="true"] { opacity: .55; cursor: default; }
    .capability-dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 999px; background: #99958a; vertical-align: 1px; }
    .capability-dot.connected { background: #39764b; }
    .capability-dot.unavailable { background: #9b5a4d; }
    .capability-dialog { width: min(460px, calc(100vw - 28px)); border: 1px solid #c8c4b8; border-radius: 20px; padding: 0; background: #fffefa; color: #171713; box-shadow: 0 24px 70px rgba(30,29,24,.2); }
    .capability-dialog::backdrop { background: rgba(30,29,24,.22); }
    .capability-panel { padding: 22px; }
    .capability-panel h2 { margin: 0 0 8px; font-size: 1.15rem; }
    .capability-panel p { margin: 8px 0; line-height: 1.5; }
    .capability-state { margin-top: 14px; padding: 10px 12px; border-radius: 12px; background: #f5f4ef; font-size: .88rem; }
    .capability-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .capability-actions button { border: 1px solid #c8c4b8; border-radius: 11px; background: #fffefa; padding: 8px 11px; cursor: pointer; }
    .capability-actions .primary { border-color: #22211c; background: #22211c; color: #fff; }
`;

const capabilityMarkup = `
    <dialog id="modelAssistanceDialog" class="capability-dialog">
      <div class="capability-panel">
        <h2>Model assistance</h2>
        <p>Connect plain-language assistance so Solandra can make already-governed Knowledge easier to read when you ask.</p>
        <p class="muted">This permission does not let the model decide what you mean, establish truth, make decisions, or authorize actions.</p>
        <div id="modelAssistanceState" class="capability-state">Checking availability…</div>
        <div class="capability-actions">
          <button id="modelAssistanceClose" type="button">Close</button>
          <button id="modelAssistanceToggle" class="primary" type="button">Connect</button>
        </div>
      </div>
    </dialog>
    <dialog id="cognitiveAssistanceDialog" class="capability-dialog">
      <div class="capability-panel">
        <h2>Cognitive assistance</h2>
        <p>Connect cognitive assistance so Solandra can use bounded reasoning, drafting, transformation, brainstorming, or analysis when you ask.</p>
        <p class="muted">Generated responses are proposals only. This permission does not establish your intent, truth, a recommendation, a choice, authorization, execution, or verification.</p>
        <div id="cognitiveAssistanceState" class="capability-state">Checking availability…</div>
        <div class="capability-actions">
          <button id="cognitiveAssistanceClose" type="button">Close</button>
          <button id="cognitiveAssistanceToggle" class="primary" type="button">Connect</button>
        </div>
      </div>
    </dialog>`;

const capabilityScript = `
  <script>
    (() => {
      const button = document.getElementById("modelAssistanceButton");
      const dot = document.getElementById("modelAssistanceDot");
      const dialog = document.getElementById("modelAssistanceDialog");
      const stateNode = document.getElementById("modelAssistanceState");
      const toggle = document.getElementById("modelAssistanceToggle");
      const close = document.getElementById("modelAssistanceClose");
      let state = null;

      const stateText = (value) => {
        if (value === "CONNECTED") return "Connected. Solandra may use this bounded assistance on your behalf.";
        if (value === "UNAVAILABLE") return "Unavailable in this Lattice setup. No model assistance will be used.";
        return "Not connected. Solandra will not use model assistance.";
      };

      const render = (capability) => {
        state = capability;
        const connected = capability?.status === "CONNECTED";
        const unavailable = capability?.status === "UNAVAILABLE";
        dot.classList.toggle("connected", connected);
        dot.classList.toggle("unavailable", unavailable);
        stateNode.textContent = stateText(capability?.status);
        toggle.textContent = connected ? "Disconnect" : "Connect";
        toggle.disabled = unavailable;
        button.setAttribute("aria-label", "Model assistance: " + (capability?.status ?? "unknown").toLowerCase());
      };

      const load = async () => {
        button.setAttribute("aria-busy", "true");
        try {
          const response = await fetch("/api/v1/capabilities/model-assistance");
          if (!response.ok) throw new Error("Capability status is unavailable.");
          const body = await response.json();
          render(body.capability);
        } catch {
          render({ status: "UNAVAILABLE" });
        } finally {
          button.setAttribute("aria-busy", "false");
        }
      };

      button.addEventListener("click", async () => {
        await load();
        dialog.showModal();
      });
      close.addEventListener("click", () => dialog.close());
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          const connected = state?.status === "CONNECTED";
          const response = await fetch("/api/v1/capabilities/model-assistance/connect", {
            method: connected ? "DELETE" : "POST",
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.message || "Capability change failed.");
          render(body.capability);
        } catch (error) {
          stateNode.textContent = error instanceof Error ? error.message : "Capability change failed.";
        } finally {
          toggle.disabled = state?.status === "UNAVAILABLE";
        }
      });
      void load();
    })();

    (() => {
      const button = document.getElementById("cognitiveAssistanceButton");
      const label = document.getElementById("cognitiveAssistanceLabel");
      const dot = document.getElementById("cognitiveAssistanceDot");
      const dialog = document.getElementById("cognitiveAssistanceDialog");
      const stateNode = document.getElementById("cognitiveAssistanceState");
      const toggle = document.getElementById("cognitiveAssistanceToggle");
      const close = document.getElementById("cognitiveAssistanceClose");
      let state = null;

      const stateText = (value) => {
        if (value === "CONNECTED") return "Connected. Solandra may use cognitive assistance when a conversational request needs it.";
        if (value === "UNAVAILABLE") return "Unavailable in this Lattice setup. Solandra will not simulate cognitive assistance.";
        return "Disconnected. Solandra will not use cognitive assistance until you connect it.";
      };

      const stateLabel = (value) => {
        if (value === "CONNECTED") return "connected";
        if (value === "UNAVAILABLE") return "unavailable";
        return "disconnected";
      };

      const render = (capability) => {
        state = capability;
        const connected = capability?.status === "CONNECTED";
        const unavailable = capability?.status === "UNAVAILABLE";
        const productState = stateLabel(capability?.status);
        dot.classList.toggle("connected", connected);
        dot.classList.toggle("unavailable", unavailable);
        stateNode.textContent = stateText(capability?.status);
        label.textContent = "Cognitive assistance · " + productState;
        toggle.textContent = connected ? "Disconnect" : "Connect";
        toggle.disabled = unavailable;
        button.setAttribute("aria-label", "Cognitive assistance: " + productState);
      };

      const load = async () => {
        button.setAttribute("aria-busy", "true");
        try {
          const response = await fetch("/api/v1/capabilities/user-model");
          if (!response.ok) throw new Error("Cognitive assistance status is unavailable.");
          const body = await response.json();
          render(body.capability);
        } catch {
          render({ status: "UNAVAILABLE" });
        } finally {
          button.setAttribute("aria-busy", "false");
        }
      };

      button.addEventListener("click", async () => {
        await load();
        dialog.showModal();
      });
      close.addEventListener("click", () => dialog.close());
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          const connected = state?.status === "CONNECTED";
          const response = await fetch("/api/v1/capabilities/user-model/connect", {
            method: connected ? "DELETE" : "POST",
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (response.status === 503) throw new Error("Cognitive assistance is unavailable in this Lattice setup.");
            throw new Error("I couldn't change cognitive assistance right now. Please try again.");
          }
          render(body.capability);
        } catch (error) {
          stateNode.textContent = error instanceof Error ? error.message : "I couldn't change cognitive assistance right now. Please try again.";
        } finally {
          toggle.disabled = state?.status === "UNAVAILABLE";
        }
      });
      void load();
    })();
  </script>`;

const directCognitiveAssistanceHandling = `        if (body.status === "COGNITIVE_ASSISTANCE_COMPLETED") {
          const assistantMessage = typeof body.presentation?.assistantMessage === "string"
            ? body.presentation.assistantMessage.trim()
            : "";
          if (!assistantMessage) throw new Error("Cognitive assistance returned no usable response.");
          appendSolandraTurn(assistantMessage);
          return;
        }
        if (!body.runId) throw new Error("I couldn't establish the requested work safely.");`;

const capabilityFailureHandling = `      const productFailureMessage = (status, body) => {
        if (body?.error === "COGNITIVE_ASSISTANCE_NOT_AUTHORIZED" || body?.error === "USER_MODEL_CAPABILITY_NOT_AUTHORIZED") return "Cognitive assistance is disconnected. Connect it to use this request.";
        if (body?.error === "COGNITIVE_ASSISTANCE_UNAVAILABLE" || body?.error === "USER_MODEL_CAPABILITY_UNAVAILABLE") return "Cognitive assistance is unavailable in this Lattice setup.";
        if (body?.error === "COGNITIVE_ASSISTANCE_REVOKED" || body?.error === "USER_MODEL_CAPABILITY_REVOKED") return "Cognitive assistance was disconnected before the response completed, so I discarded that result.";
        if (body?.error === "COGNITIVE_ASSISTANCE_FAILED") return "Cognitive assistance couldn't complete that request. Nothing was changed; you can revise it or try again.";
        if (body?.error === "RESOURCE_SCOPE_UNSUPPORTED" && typeof body.message === "string") return body.message;`;

/** Canonical Product surface: Conversation + free-form input + adaptive Composer. */
export function renderSolandraAuthoritativeConversationPage(): string {
  return renderSolandraConversationPage()
    .replace("</style>", `${capabilityStyles}</style>`)
    .replace(
      '<div class="brand">Solandra</div>',
      '<div class="brand">Solandra</div><div class="capability-controls"><button id="cognitiveAssistanceButton" class="capability-button" type="button" aria-label="Cognitive assistance: checking"><span id="cognitiveAssistanceDot" class="capability-dot"></span><span id="cognitiveAssistanceLabel">Cognitive assistance · checking</span></button><button id="modelAssistanceButton" class="capability-button" type="button" aria-label="Model assistance"><span id="modelAssistanceDot" class="capability-dot"></span>Model assistance</button></div>',
    )
    .replace(
      '      const productFailureMessage = (status, body) => {\n        if (body?.error === "RESOURCE_SCOPE_UNSUPPORTED" && typeof body.message === "string") return body.message;',
      capabilityFailureHandling,
    )
    .replace(
      '        if (!body.runId) throw new Error("I couldn\'t establish the requested work safely.");',
      directCognitiveAssistanceHandling,
    )
    .replace("</body>", `${capabilityMarkup}${capabilityScript}</body>`);
}
