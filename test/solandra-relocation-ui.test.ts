import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraRelocationPrototypePage } from "../src/ui/solandra-relocation-prototype-page.js";

test("relocation prototype preserves the staged conversation and screenshot-derived visual hierarchy", () => {
  const html = renderSolandraRelocationPrototypePage();

  assert.match(html, /We’re relocating to Denver in November/);
  assert.match(html, /what matters most/);
  assert.match(html, /data-stage="1"/);
  assert.match(html, /choices\(2/);
  assert.match(html, /choices\(3/);
  assert.match(html, /A few visual reference points/);
  assert.match(html, /Illustrative only · not neighborhood evidence/);
  assert.match(html, /Illustrative tree-lined suburban homes/);
  assert.match(html, /Illustrative walkable mixed-use street/);
  assert.match(html, /Illustrative detached home with larger yard/);

  assert.match(html, /class="app"/);
  assert.match(html, /class="lotus"/);
  assert.match(html, /class="recommendation"/);
  assert.match(html, /class="hero"/);
  assert.match(html, /Top search profile/);
  assert.match(html, /Why this/);
  assert.match(html, /Compare options/);
  assert.match(html, /View sources/);
  assert.match(html, /placeholder="Ask Solandra…"/);
  assert.match(html, /grid-template-columns:46% 54%/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /prefers-reduced-motion/);
});

test("relocation prototype keeps the evidence boundary explicit and avoids invented authority", () => {
  const html = renderSolandraRelocationPrototypePage();

  assert.match(html, /Not yet verified/);
  assert.match(html, /no Denver neighborhood, school, commute, home-price, inventory, or market evidence has been gathered/);
  assert.match(html, /conversation-derived search strategy, not a ranked Denver neighborhood recommendation/);
  assert.doesNotMatch(html, /fetch\(/);
  assert.doesNotMatch(html, /\/api\/v1\/prototype\/consultations\/relocation/);
  assert.doesNotMatch(html, /https?:\/\/.*\.(?:jpg|jpeg|png|webp)/i);
  assert.doesNotMatch(html, /VERIFIED neighborhood/);
  assert.doesNotMatch(html, /authoritative relocation decision/i);
});
