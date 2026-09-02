import { renderSolandraPrototypePage } from "./solandra-prototype-page.js";

/**
 * Prototype-capable processes share the canonical Solandra presentation
 * surface. Prototype model endpoints may exist for development probes, but
 * they do not select a parallel presentation architecture.
 */
export function renderSolandraConversationPrototypePage(): string {
  return renderSolandraPrototypePage();
}
