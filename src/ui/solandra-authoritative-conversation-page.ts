import { renderSolandraConversationPage } from "./solandra-conversation-page.js";

const ownerAccessStyles = `
    .owner-access-gate { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 18px; background: rgba(245,244,239,.96); }
    .owner-access-gate[hidden] { display: none; }
    .owner-access-card { width: min(430px, 100%); padding: 24px; border: 1px solid #c8c4b8; border-radius: 20px; background: #fffefa; box-shadow: 0 24px 70px rgba(30,29,24,.12); }
    .owner-access-card h1 { margin: 0 0 8px; font-size: 1.3rem; }
    .owner-access-card p { line-height: 1.5; }
    .owner-access-card input { width: 100%; border: 1px solid #c8c4b8; border-radius: 12px; padding: 11px 12px; background: #fff; color: inherit; }
    .owner-access-card button { margin-top: 12px; width: 100%; border: 0; border-radius: 12px; padding: 11px 14px; background: #22211c; color: #fff; cursor: pointer; }
    .owner-access-error { min-height: 1.3em; margin-top: 10px; color: #765047; font-size: .88rem; }
`;

const ownerAccessMarkup = `
    <section id="ownerAccessGate" class="owner-access-gate" aria-label="Owner access" hidden>
      <form id="ownerAccessForm" class="owner-access-card">
        <h1>Owner access</h1>
        <p>Enter your private access key to use Solandra.</p>
        <input id="ownerAccessInput" type="password" autocomplete="current-password" aria-label="Access key" />
        <button id="ownerAccessSubmit" type="submit">Continue</button>
        <div id="ownerAccessError" class="owner-access-error" aria-live="polite"></div>
      </form>
    </section>`;

const ownerAccessScript = `
  <script>
    (() => {
      const STORAGE_KEY = "lattice.solandra.owner-access.v1";
      const nativeFetch = window.fetch.bind(window);
      const gate = document.getElementById("ownerAccessGate");
      const form = document.getElementById("ownerAccessForm");
      const input = document.getElementById("ownerAccessInput");
      const submit = document.getElementById("ownerAccessSubmit");
      const errorNode = document.getElementById("ownerAccessError");

      const readToken = () => {
        try { return window.sessionStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
      };
      const storeToken = (value) => {
        try { window.sessionStorage.setItem(STORAGE_KEY, value); } catch {}
      };
      const clearToken = () => {
        try { window.sessionStorage.removeItem(STORAGE_KEY); } catch {}
      };
      const showGate = (message = "") => {
        gate.hidden = false;
        errorNode.textContent = message;
        queueMicrotask(() => input.focus());
      };
      const hideGate = () => {
        gate.hidden = true;
        errorNode.textContent = "";
        input.value = "";
      };

      window.ownerFetch = async (resource, options = {}) => {
        const target = typeof resource === "string" || resource instanceof URL
          ? new URL(resource, window.location.href)
          : new URL(resource.url, window.location.href);
        if (target.origin !== window.location.origin || !target.pathname.startsWith("/api/v1/")) {
          return nativeFetch(resource, options);
        }
        const headers = new Headers(options.headers || (resource instanceof Request ? resource.headers : undefined));
        const token = readToken();
        if (token) headers.set("authorization", "Bearer " + token);
        const response = await nativeFetch(resource, { ...options, headers });
        if (response.status === 401) {
          clearToken();
          showGate("Owner access is required.");
        }
        return response;
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const candidate = input.value;
        if (!candidate) {
          showGate("Enter your access key.");
          return;
        }
        submit.disabled = true;
        errorNode.textContent = "Checking access…";
        try {
          const response = await nativeFetch("/api/v1/auth/session", {
            headers: { authorization: "Bearer " + candidate },
          });
          if (response.status === 401) {
            clearToken();
            showGate("That access key was not accepted.");
            return;
          }
          if (!response.ok) {
            showGate("Solandra couldn't confirm access right now. Please try again.");
            return;
          }
          storeToken(candidate);
          hideGate();
          window.location.reload();
        } catch {
          showGate("Solandra couldn't confirm access right now. Please try again.");
        } finally {
          submit.disabled = false;
        }
      });

      const initializeAccess = async () => {
        if (readToken()) {
          hideGate();
          return;
        }
        try {
          const response = await nativeFetch("/api/v1/auth/session");
          if (response.status === 401) {
            showGate();
            return;
          }
          hideGate();
        } catch {
          hideGate();
        }
      };
      void initializeAccess();
    })();
  </script>`;

const directConversationHandling = `        if (body.status === "CONVERSATION_COMPLETED") {
          const assistantMessage = typeof body.presentation?.assistantMessage === "string"
            ? body.presentation.assistantMessage.trim()
            : "";
          if (!assistantMessage) throw new Error("Solandra returned no usable response.");
          appendSolandraTurn(assistantMessage);
          return;
        }
        if (!body.runId) throw new Error("I couldn't establish the requested work safely.");`;

const legacyPreparedResourceRendering = `      const renderPreparedResource = (title, body) => {
        composerHasProductContent = true;
        composer.innerHTML = '<div class="resource"><h1>' + escapeHtml(title) + '</h1><p>Review and edit this before using it.</p><textarea aria-label="Prepared resource">' + escapeHtml(body) + '</textarea></div>';
      };`;

const preparedResourceTrustRendering = `      const renderPreparedResource = (resource, knowledge, body) => {
        composerHasProductContent = true;
        if (resource.kind !== "PREPARED_MESSAGE") {
          composer.innerHTML = '<div class="resource"><h1>' + escapeHtml(resource.title) + '</h1><p>Review and edit this before using it.</p><textarea aria-label="Prepared resource">' + escapeHtml(body) + '</textarea></div>';
          return;
        }
        const selectedClaimIds = new Set((resource.basis || []).flatMap((entry) => entry.claimIds || []));
        const selectedFindings = (knowledge?.findings || []).filter((finding) => selectedClaimIds.has(finding.claimId));
        const statusSections = [
          ["SUPPORTED", "Established support"],
          ["REFUTED", "Evidence refutes"],
          ["CONFLICTED", "Evidence remains conflicted"],
          ["UNRESOLVED", "Not established"],
        ];
        const evidenceHtml = selectedFindings.length > 0
          ? statusSections.map(([status, heading]) => {
              const findings = selectedFindings.filter((finding) => finding.status === status);
              if (findings.length === 0) return "";
              return '<section data-governed-status="' + status + '"><h2>' + escapeHtml(heading) + '</h2><ul>' + findings.map((finding) => '<li>' + escapeHtml(finding.text) + '</li>').join("") + '</ul></section>';
            }).join("")
          : '<h2>Evidence</h2><p class="muted">No external evidence was used for this draft.</p>';
        const uncertaintyHtml = (resource.preservedUncertainties || []).length > 0
          ? '<h2>What remains uncertain</h2><ul>' + resource.preservedUncertainties.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>'
          : '';
        const draftLabel = resource.draftAuthority?.origin === "SOLANDRA" ? "Solandra draft" : "Prepared draft";
        const trustNote = resource.draftAuthority?.factualAuthority === false
          ? 'This wording is a draft, not established fact. The evidence summary below preserves what is supported, refuted, conflicted, or unresolved.'
          : 'Review and edit this before using it.';
        composer.innerHTML = '<div class="resource"><div class="finding-status">' + escapeHtml(draftLabel) + '</div><h1>' + escapeHtml(resource.title) + '</h1><p>' + escapeHtml(trustNote) + '</p><textarea aria-label="Prepared resource">' + escapeHtml(body) + '</textarea>' + evidenceHtml + uncertaintyHtml + '</div>';
      };`;

/** Canonical Product surface: one Solandra conversation plus Owner authentication. */
export function renderSolandraAuthoritativeConversationPage(): string {
  return renderSolandraConversationPage()
    .replaceAll("fetch(", "window.ownerFetch(")
    .replace("</style>", `${ownerAccessStyles}</style>`)
    .replace(legacyPreparedResourceRendering, preparedResourceTrustRendering)
    .replace(
      '          renderPreparedResource(outcome.resource.title, options.preparedBody ?? outcome.resource.body);',
      '          renderPreparedResource(outcome.resource, outcome.knowledge, options.preparedBody ?? outcome.resource.body);',
    )
    .replace(
      '        if (!body.runId) throw new Error("I couldn\\'t establish the requested work safely.");',
      directConversationHandling,
    )
    .replace("  <script>\n    (() => {", `${ownerAccessMarkup}${ownerAccessScript}  <script>\n    (() => {`);
}
