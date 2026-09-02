import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraPrototypePage } from "../src/ui/solandra-prototype-page.js";

test("locked Solandra baseline replaces the planetary presentation system", () => {
  const html = renderSolandraPrototypePage();

  assert.match(html, />Solandra</);
  assert.match(html, /What do you need to figure out\?/);
  assert.match(html, /id="resourceFocus"/);
  assert.match(html, /id="resourceBack"/);
  assert.match(html, /id="newUpdate"/);
  assert.match(html, /resource-focus-body/);
  assert.match(html, /support-node/);

  assert.doesNotMatch(html, /Knowledge Orbit/i);
  assert.doesNotMatch(html, /\borbit\b/i);
  assert.doesNotMatch(html, /\bplanet\b/i);
  assert.doesNotMatch(html, /\bmoon\b/i);
  assert.doesNotMatch(html, /\bsun\b/i);
  assert.doesNotMatch(html, /scrollIntoView/);
});

test("baseline client consumes semantic presentation state without accepting arbitrary presentation authority", () => {
  const html = renderSolandraPrototypePage();

  assert.match(html, /\/presentation/);
  assert.match(html, /knownRevision/);
  assert.match(html, /presentationRevision/);
  assert.match(html, /\/presentation\/resources\//);
  assert.match(html, /result\.response\.status===409/);
  assert.match(html, /snapshot\.nextAction\.winnerCandidateId/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML/);
  assert.doesNotMatch(html, /document\.write/);
  assert.doesNotMatch(html, /eval\s*\(/);
});

test("baseline preserves deliberate scrolling, IME submission, resource takeover, and accessibility guards", () => {
  const html = renderSolandraPrototypePage();

  assert.match(html, /isNearNewest/);
  assert.match(html, /newUpdate\.hidden=false/);
  assert.match(html, /event\.shiftKey\|\|event\.isComposing/);
  assert.match(html, /resourceFocus\.classList\.add\('show'\)/);
  assert.match(html, /resourceFocusBody\.scrollTop=0/);
  assert.match(html, /resourceBack\.focus\(\{preventScroll:true\}\)/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /overflow-x:hidden/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /min-height:44px|width:44px|height:44px/);
});
