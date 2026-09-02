import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";
import { renderSolandraConversationPrototypePage } from "../src/ui/solandra-conversation-prototype-page.js";
import { renderSolandraLocalModelPrototypePage } from "../src/ui/solandra-local-model-prototype-page.js";
import { renderSolandraPrototypePage } from "../src/ui/solandra-prototype-page.js";

const retiredPresentationPattern = /Knowledge Orbit|\bSun\b|\bPlanet(?:s)?\b|\bMoon(?:s)?\b|class=["'][^"']*\borbit\b|class=["'][^"']*\bplanet\b|class=["'][^"']*\bmoon\b/i;

for (const [name, render] of [
  ["canonical", renderSolandraPrototypePage],
  ["authoritative", renderSolandraAuthoritativeConversationPage],
  ["conversation-prototype", renderSolandraConversationPrototypePage],
  ["local-model-prototype", renderSolandraLocalModelPrototypePage],
] as const) {
  test(`${name} Solandra renderer contains no retired planetary presentation`, () => {
    const html = render();
    assert.doesNotMatch(html, retiredPresentationPattern);
    assert.match(html, /What do you need to figure out\?/);
    assert.match(html, /id="resourceFocus"/);
    assert.match(html, /id="newUpdate"/);
    assert.match(html, /support-node/);
  });
}
