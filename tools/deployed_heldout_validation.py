from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from playwright.sync_api import Browser, Page, TimeoutError as PlaywrightTimeoutError, expect

BASE_URL = os.environ.get("DEPLOYED_BASE_URL", "https://lattice-solandra.onrender.com").rstrip("/")
OWNER_TOKEN = os.environ.get("LATTICE_OWNER_ACCESS_TOKEN", "")
CASES_JSON = os.environ.get("HELDOUT_CASES_JSON", "")
ARTIFACT_DIR = Path(os.environ.get("HELDOUT_ARTIFACT_DIR", "artifacts/deployed-heldout"))
SCREENSHOT_DIR = ARTIFACT_DIR / "screenshots"
RESULT_PATH = ARTIFACT_DIR / "black-box-evidence.json"

MAX_PAYLOAD_BYTES = 30_000
MAX_CASES = 6
MAX_MESSAGE_CHARS = 2_000
MAX_FOLLOW_UPS = 3
CASE_TIMEOUT_MS = 90_000
MAX_CAPTURE_CHARS = 16_000
CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
OWNER_ACCESS_REQUIRED = "Owner access is required."


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _scrub(value: str) -> str:
    return value.replace(OWNER_TOKEN, "[REDACTED]") if OWNER_TOKEN else value


def _bounded_text(value: str) -> str:
    clean = _scrub(value).strip()
    return clean if len(clean) <= MAX_CAPTURE_CHARS else clean[:MAX_CAPTURE_CHARS] + "\n[TRUNCATED]"


def _require_message(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a string")
    text = value.strip()
    if not text:
        raise ValueError(f"{label} must not be blank")
    if len(text) > MAX_MESSAGE_CHARS:
        raise ValueError(f"{label} exceeds {MAX_MESSAGE_CHARS} characters")
    return text


def _load_cases() -> list[dict[str, Any]]:
    raw = CASES_JSON.strip()
    if not raw:
        pytest.skip("No held-out case bundle was supplied for this workflow run.")
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ValueError(f"held-out case bundle exceeds {MAX_PAYLOAD_BYTES} UTF-8 bytes")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("held-out case bundle is not valid JSON") from error
    if not isinstance(payload, dict) or set(payload) != {"version", "cases"}:
        raise ValueError("held-out bundle must contain exactly version and cases")
    if payload["version"] != 1:
        raise ValueError("held-out bundle version must be 1")
    cases = payload["cases"]
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise ValueError(f"held-out bundle must contain between 1 and {MAX_CASES} cases")

    validated: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, raw_case in enumerate(cases):
        if not isinstance(raw_case, dict) or set(raw_case) != {"id", "session", "message", "followUps"}:
            raise ValueError(f"case {index + 1} must contain exactly id, session, message, followUps")
        case_id = raw_case["id"]
        if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id):
            raise ValueError(f"case {index + 1} id must match {CASE_ID_PATTERN.pattern}")
        if case_id in seen_ids:
            raise ValueError(f"duplicate held-out case id: {case_id}")
        seen_ids.add(case_id)
        if raw_case["session"] != "fresh":
            raise ValueError(f"case {case_id} session must be fresh")
        follow_ups = raw_case["followUps"]
        if not isinstance(follow_ups, list) or len(follow_ups) > MAX_FOLLOW_UPS:
            raise ValueError(f"case {case_id} may contain at most {MAX_FOLLOW_UPS} follow-ups")
        validated.append({
            "id": case_id,
            "session": "fresh",
            "message": _require_message(raw_case["message"], f"case {case_id} message"),
            "followUps": [
                _require_message(value, f"case {case_id} follow-up {follow_index + 1}")
                for follow_index, value in enumerate(follow_ups)
            ],
        })
    return validated


def _assert_authorized(page: Page) -> None:
    gate = page.locator("#ownerAccessGate")
    if gate.is_visible():
        raise AssertionError("held-out Product execution lost Owner authorization")
    error = page.locator("#ownerAccessError")
    if error.is_visible() and OWNER_ACCESS_REQUIRED in error.inner_text():
        raise AssertionError("held-out Product execution reported Owner access is required")


def _authenticate(page: Page) -> bool:
    authenticated = False
    try:
        page.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=30_000)
        gate = page.locator("#ownerAccessGate")
        expect(gate).to_be_visible(timeout=15_000)
        page.locator("#ownerAccessInput").fill(OWNER_TOKEN)
        with page.expect_navigation(wait_until="domcontentloaded", timeout=30_000):
            page.locator("#ownerAccessSubmit").click()
        expect(gate).to_be_hidden(timeout=15_000)
        probe = page.evaluate(
            """async () => {
                const response = await window.ownerFetch('/api/v1/capabilities/model-assistance');
                return response.status;
            }"""
        )
        assert probe == 200, f"Owner authorization probe returned HTTP {probe}"
        _assert_authorized(page)
        assert OWNER_TOKEN not in page.url
        assert OWNER_TOKEN not in page.content()
        authenticated = True
        return authenticated
    finally:
        if not authenticated:
            try:
                candidate = page.locator("#ownerAccessInput")
                if candidate.count():
                    candidate.fill("")
            except Exception:
                pass


def _visible_errors(page: Page) -> list[str]:
    values: list[str] = []
    for selector in ("#ownerAccessError:visible", "[role='alert']:visible", ".error:visible"):
        for node in page.locator(selector).all():
            text = _bounded_text(node.inner_text())
            if text and text not in values:
                values.append(text)
    return values


def _visible_sources(page: Page) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for link in page.locator(".source-list a:visible").all():
        title = _bounded_text(link.inner_text())
        href = _scrub(link.get_attribute("href") or "")
        identity = (title, href)
        if identity not in seen:
            seen.add(identity)
            sources.append({"title": title, "url": href})
    return sources


def _visible_assistant_messages(page: Page) -> list[str]:
    values: list[str] = []
    for node in page.locator("#conversation .turn.solandra:visible").all():
        text = _bounded_text(node.inner_text())
        if text:
            values.append(text)
    return values


def _submit_turn(page: Page, message: str, deadline: float) -> str:
    _assert_authorized(page)
    assistant_turns = page.locator("#conversation .turn.solandra")
    before_count = assistant_turns.count()
    composer = page.locator("#conversationInput")
    expect(composer).to_be_visible(timeout=10_000)
    composer.fill(message)

    remaining_ms = max(1_000, int((deadline - time.monotonic()) * 1_000))
    try:
        with page.expect_response(
            lambda response: "/api/v1/conversations/" in response.url
            and "/turns" in response.url
            and response.request.method == "POST",
            timeout=remaining_ms,
        ) as pending:
            page.locator("#conversationForm").evaluate("form => form.requestSubmit()")
        turn_response = pending.value
    except PlaywrightTimeoutError:
        raise AssertionError("held-out Product turn did not produce an observable turn response before its case timeout") from None

    if not 200 <= turn_response.status < 300:
        raise AssertionError(f"held-out Product turn was not accepted: HTTP {turn_response.status}")
    _assert_authorized(page)

    remaining_ms = max(1_000, int((deadline - time.monotonic()) * 1_000))
    try:
        page.wait_for_function(
            "expected => document.querySelectorAll('#conversation .turn.solandra').length > expected",
            arg=before_count,
            timeout=remaining_ms,
        )
    except PlaywrightTimeoutError:
        raise AssertionError("held-out case did not reach a visible Solandra response before its case timeout") from None

    _assert_authorized(page)
    visible_response = _bounded_text(assistant_turns.last.inner_text())
    if OWNER_ACCESS_REQUIRED in visible_response:
        raise AssertionError("unauthorized fallback cannot count as a successful held-out Product response")
    return visible_response


def _new_result(started_at: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "run": {
            "repository": os.environ.get("GITHUB_REPOSITORY", "brady573/Lattice-software-clean"),
            "workflowRunId": os.environ.get("GITHUB_RUN_ID", ""),
            "headSha": os.environ.get("GITHUB_SHA", ""),
            "targetUrl": BASE_URL,
            "startedAt": started_at,
            "completedAt": None,
        },
        "cases": [],
    }


def _write_result(result: dict[str, Any]) -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    assert not OWNER_TOKEN or OWNER_TOKEN not in serialized, "Owner token must never enter black-box evidence JSON"
    RESULT_PATH.write_text(serialized, encoding="utf-8")


def _capture_observation(
    page: Page,
    case: dict[str, Any],
    user_messages: list[str],
    visible_assistant_messages: list[str],
    case_started: float,
    authenticated: bool,
) -> dict[str, Any]:
    screenshots: list[str] = []
    if authenticated:
        screenshot_name = f"screenshots/{case['id']}.png"
        try:
            screenshot_path = ARTIFACT_DIR / screenshot_name
            page.screenshot(path=str(screenshot_path), full_page=True)
            screenshots.append(screenshot_name)
        except Exception:
            pass

    composer = page.locator("#composer")
    visible_status = _bounded_text(composer.inner_text()) if composer.count() else ""
    observed_messages = _visible_assistant_messages(page)
    if not observed_messages:
        observed_messages = visible_assistant_messages
    return {
        "id": case["id"],
        "session": case["session"],
        "userMessages": [_scrub(message) for message in user_messages],
        "visibleAssistantMessages": observed_messages,
        "visibleSources": _visible_sources(page),
        "visibleStatus": visible_status,
        "visibleErrors": _visible_errors(page),
        "timingMs": round((time.monotonic() - case_started) * 1_000),
        "screenshots": screenshots,
    }


def test_validator_selected_heldout_cases(browser: Browser) -> None:
    assert OWNER_TOKEN, "LATTICE_OWNER_ACCESS_TOKEN secret is not configured"
    cases = _load_cases()
    started_at = _utc_now()
    result = _new_result(started_at)
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    _write_result(result)

    try:
        for case in cases:
            case_started = time.monotonic()
            deadline = case_started + CASE_TIMEOUT_MS / 1_000
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            user_messages = [case["message"], *case["followUps"]]
            visible_assistant_messages: list[str] = []
            authenticated = False
            try:
                authenticated = _authenticate(page)
                for message in user_messages:
                    if time.monotonic() >= deadline:
                        raise AssertionError("held-out case exceeded its case timeout")
                    visible_assistant_messages.append(_submit_turn(page, message, deadline))
            finally:
                observation = _capture_observation(
                    page,
                    case,
                    user_messages,
                    visible_assistant_messages,
                    case_started,
                    authenticated,
                )
                result["cases"].append(observation)
                _write_result(result)
                context.close()
                print(f"HELDOUT_CASE_OBSERVED id={case['id']} timing_ms={observation['timingMs']}")
    finally:
        result["run"]["completedAt"] = _utc_now()
        _write_result(result)

    print(f"HELDOUT_BLACK_BOX_EVIDENCE={RESULT_PATH}")
