import { renderSolandraPrototypePage } from "./solandra-prototype-page.js";

/**
 * Local-model development probes no longer own a separate Solandra UI.
 * The model boundary remains testable through its API while presentation is
 * always rendered through the canonical locked baseline.
 */
export function renderSolandraLocalModelPrototypePage(): string {
  return renderSolandraPrototypePage();
}
