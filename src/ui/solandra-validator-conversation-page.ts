import { renderSolandraAuthoritativeConversationPage } from "./solandra-authoritative-conversation-page.js";

const validatorFreshSessionScript = `
  <script>
    (() => {
      const keys = [
        "lattice.solandra.conversation.v1",
        "lattice.solandra.pending-turn.v1",
        "lattice.solandra.active-work.v1",
        "lattice.solandra.clarification.v1",
        "lattice.solandra.draft.v1",
      ];
      for (const key of keys) {
        try { window.localStorage.removeItem(key); } catch {}
      }
    })();
  </script>`;

/**
 * Validator deployment wrapper around the canonical authoritative Solandra UI.
 * It changes only browser conversation restoration: each page load starts fresh.
 */
export function renderSolandraValidatorConversationPage(): string {
  return renderSolandraAuthoritativeConversationPage().replace(
    "<body>",
    `<body>${validatorFreshSessionScript}`,
  );
}
