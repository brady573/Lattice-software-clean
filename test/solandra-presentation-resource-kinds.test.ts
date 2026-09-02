import assert from "node:assert/strict";
import test from "node:test";
import type { ResourceCapability, ResourceKind } from "../src/presentation/solandra-presentation.js";
import { renderSolandraPrototypePage } from "../src/ui/solandra-prototype-page.js";

const allowedKinds: readonly ResourceKind[] = [
  "text",
  "link",
  "contact",
  "image",
  "video",
  "audio",
  "document",
  "map",
  "generated_artifact",
];

const allowedCapabilities: readonly ResourceCapability[] = [
  "copy",
  "download",
  "play",
  "open_external",
  "show_location",
];

test("resource envelope is mixed-media and capabilities remain non-authorizing", () => {
  assert.deepEqual(allowedKinds, [
    "text",
    "link",
    "contact",
    "image",
    "video",
    "audio",
    "document",
    "map",
    "generated_artifact",
  ]);
  assert.deepEqual(allowedCapabilities, [
    "copy",
    "download",
    "play",
    "open_external",
    "show_location",
  ]);
  assert.ok(!allowedCapabilities.includes("send" as ResourceCapability));
  assert.ok(!allowedCapabilities.includes("submit" as ResourceCapability));
  assert.ok(!allowedCapabilities.includes("schedule" as ResourceCapability));
  assert.ok(!allowedCapabilities.includes("purchase" as ResourceCapability));
  assert.ok(!allowedCapabilities.includes("authorize" as ResourceCapability));
  assert.ok(!allowedCapabilities.includes("execute" as ResourceCapability));
});

test("locked baseline owns presentation rendering without free-form HTML execution", () => {
  const html = renderSolandraPrototypePage();

  assert.match(html, /What do you need to figure out\?/);
  assert.match(html, /id="resourceFocus"/);
  assert.match(html, /id="newUpdate"/);
  assert.match(html, /support-node/);
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  assert.doesNotMatch(html, /document\.write\(/);
  assert.doesNotMatch(html, /\beval\(/);
});
