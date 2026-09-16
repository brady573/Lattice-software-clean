import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "tools", "deployed_heldout_validation.py"), "utf8");
const workflow = readFileSync(
  join(process.cwd(), ".github", "workflows", "deployed-functional-validation.yml"),
  "utf8",
);

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`def ${name}(`);
  const end = source.indexOf(`\ndef ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} must remain explicit`);
  return source.slice(start, end);
}

test("held-out validation establishes real Owner authorization instead of trusting the gate's initial hidden state", () => {
  const authenticate = functionBody("_authenticate", "_visible_errors");
  assert.match(authenticate, /expect\(gate\)\.to_be_visible\(timeout=15_000\)/u);
  assert.match(authenticate, /#ownerAccessInput[\s\S]*?fill\(OWNER_TOKEN\)/u);
  assert.match(authenticate, /window\.ownerFetch\('\/api\/v1\/capabilities\/model-assistance'\)/u);
  assert.match(authenticate, /assert probe == 200/u);
  assert.match(authenticate, /_assert_authorized\(page\)/u);
  assert.match(authenticate, /finally:[\s\S]*?if not authenticated:[\s\S]*?candidate\.fill\(""\)/u);
});

test("reappearing Owner gate or unauthorized visible state fails held-out execution", () => {
  const authorized = functionBody("_assert_authorized", "_authenticate");
  assert.match(authorized, /if gate\.is_visible\(\):[\s\S]*?raise AssertionError/u);
  assert.match(authorized, /OWNER_ACCESS_REQUIRED in error\.inner_text\(\)[\s\S]*?raise AssertionError/u);

  const submit = functionBody("_submit_turn", "_new_result");
  assert.ok((submit.match(/_assert_authorized\(page\)/gu) ?? []).length >= 3);
  assert.match(submit, /page\.expect_response\([\s\S]*?\/api\/v1\/conversations\/[\s\S]*?\/turns[\s\S]*?response\.request\.method == "POST"/u);
  assert.match(submit, /if not 200 <= turn_response\.status < 300:[\s\S]*?raise AssertionError/u);
  assert.match(submit, /if OWNER_ACCESS_REQUIRED in visible_response:[\s\S]*?raise AssertionError/u);
});

test("successful authenticated turns still emit normal black-box observations and failure evidence remains uploadable", () => {
  const capture = functionBody("_capture_observation", "test_validator_selected_heldout_cases");
  assert.equal((capture.match(/page\.screenshot\(/gu) ?? []).length, 1);
  assert.match(capture, /if authenticated:[\s\S]*?page\.screenshot\(/u);
  assert.match(capture, /observed_messages = _visible_assistant_messages\(page\)/u);
  assert.match(capture, /"visibleAssistantMessages": observed_messages/u);
  assert.match(capture, /"visibleSources": _visible_sources\(page\)/u);
  assert.match(capture, /"visibleErrors": _visible_errors\(page\)/u);

  assert.match(
    workflow,
    /- name: Upload held-out black-box evidence\s+if: \$\{\{ always\(\) && inputs\.heldout_cases_json != '' \}\}/u,
  );
});

test("held-out black-box evidence keeps Owner credentials out of screenshots and JSON", () => {
  assert.match(source, /def _scrub\(value: str\) -> str:/u);
  assert.match(source, /assert not OWNER_TOKEN or OWNER_TOKEN not in serialized/u);
  assert.match(source, /"userMessages": \[_scrub\(message\) for message in user_messages\]/u);

  const capture = functionBody("_capture_observation", "test_validator_selected_heldout_cases");
  assert.match(capture, /if authenticated:[\s\S]*?page\.screenshot\(/u);
  assert.doesNotMatch(capture, /page\.screenshot\([\s\S]*?if authenticated:/u);
});
