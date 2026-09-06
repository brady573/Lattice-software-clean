import { renderSolandraConversationPage } from "./solandra-conversation-page.js";

const capabilityStyles = `
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .capability-button { border: 1px solid #c8c4b8; border-radius: 999px; background: #fffefa; color: #282722; padding: 7px 10px; cursor: pointer; font-size: .8rem; }
    .capability-button[aria-busy="true"] { opacity: .55; cursor: default; }
    .capability-dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 999px; background: #99958a; vertical-align: 1px; }
    .capability-dot.connected { background: #39764b; }
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
  </script>`;

/** Canonical Product surface: Conversation + free-form input + adaptive Composer. */
export function renderSolandraAuthoritativeConversationPage(): string {
  return renderSolandraConversationPage()
    .replace("</style>", `${capabilityStyles}</style>`)
    .replace(
      '<div class="brand">Solandra</div>',
      '<div class="brand">Solandra</div><button id="modelAssistanceButton" class="capability-button" type="button" aria-label="Model assistance"><span id="modelAssistanceDot" class="capability-dot"></span>Model assistance</button>',
    )
    .replace("</body>", `${capabilityMarkup}${capabilityScript}</body>`);
}
