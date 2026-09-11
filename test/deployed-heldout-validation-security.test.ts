import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "tools", "deployed_heldout_validation.py"), "utf8");

test("held-out validation never captures screenshot evidence before authentication completes", () => {
  assert.match(source, /def _authenticate\(page: Page\) -> bool:/u);
  assert.match(source, /authenticated = False[\s\S]*?finally:\s*\n\s+if not authenticated:[\s\S]*?candidate\.fill\(""\)/u);

  const captureMatch = source.match(
    /def _capture_observation\([\s\S]*?authenticated: bool,[\s\S]*?\) -> dict\[str, Any\]:([\s\S]*?)\n\ndef test_validator_selected_heldout_cases/u,
  );
  assert.ok(captureMatch, "held-out observation capture function must remain explicit");
  const captureBody = captureMatch[1] ?? "";

  assert.equal((captureBody.match(/page\.screenshot\(/gu) ?? []).length, 1);
  assert.match(captureBody, /if authenticated:[\s\S]*?page\.screenshot\(/u);
  assert.doesNotMatch(captureBody, /page\.screenshot\([\s\S]*?if authenticated:/u);

  assert.match(source, /authenticated = False[\s\S]*?authenticated = _authenticate\(page\)/u);
  assert.match(source, /_capture_observation\([\s\S]*?case_started,[\s\S]*?authenticated,[\s\S]*?\)/u);
});

test("held-out black-box JSON remains secret-scrubbed independently of screenshot gating", () => {
  assert.match(source, /def _scrub\(value: str\) -> str:/u);
  assert.match(source, /assert not OWNER_TOKEN or OWNER_TOKEN not in serialized/u);
  assert.match(source, /"userMessages": \[_scrub\(message\) for message in user_messages\]/u);
});
