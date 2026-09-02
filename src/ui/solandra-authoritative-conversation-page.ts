import { renderSolandraPrototypePage } from "./solandra-prototype-page.js";

/**
 * The authoritative Product UI is the Owner-locked Solandra baseline.
 * Product state enters the page only through the application-owned semantic
 * presentation API consumed by that baseline renderer.
 */
export function renderSolandraAuthoritativeConversationPage(): string {
  return renderSolandraPrototypePage();
}
