from __future__ import annotations

import os
import time
import urllib.error
import urllib.request

import pytest
from playwright.sync_api import Browser, expect

BASE_URL = os.environ.get("DEPLOYED_BASE_URL", "https://lattice-solandra.onrender.com").rstrip("/")
OWNER_TOKEN = os.environ.get("LATTICE_OWNER_ACCESS_TOKEN", "")
STORAGE_KEY = "lattice.solandra.owner-access.v1"
INVALID_TOKEN = "INVALID_VALIDATOR_KEY_12345678901234567890"


def _probe(path: str) -> int | None:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        method="GET",
        headers={"User-Agent": "lattice-deployed-functional-validator/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, TimeoutError):
        return None


def _wake_service() -> None:
    deadline = time.monotonic() + 90
    first = True
    while time.monotonic() <= deadline:
        health = _probe("/health")
        root = _probe("/") if health is None or health >= 500 else None
        if (health is not None and health < 500) or (root is not None and root < 500):
            return
        if first:
            print(f"COLD_START_CANDIDATE health_status={health} root_status={root}")
            first = False
        time.sleep(5)
    pytest.fail("deployment did not become reachable within 90-second cold-start window")


@pytest.fixture(scope="session", autouse=True)
def deployment_ready() -> None:
    assert OWNER_TOKEN, "LATTICE_OWNER_ACCESS_TOKEN secret is not configured for this workflow"
    _wake_service()
    health = _probe("/health")
    assert health is not None and 200 <= health < 300, f"/health expected 2xx after wake, got {health}"
    print(f"DEPLOYMENT_READY health_status={health}")


def _storage_contains_token(page, storage_name: str, token: str) -> bool:
    return bool(
        page.evaluate(
            """([storageName, candidate]) => {
                const storage = storageName === 'sessionStorage' ? window.sessionStorage : window.localStorage;
                for (let i = 0; i < storage.length; i += 1) {
                    const key = storage.key(i);
                    if (key !== null && storage.getItem(key) === candidate) return true;
                }
                return false;
            }""",
            [storage_name, token],
        )
    )


def test_deployed_owner_authentication(browser: Browser) -> None:
    context = browser.new_context()
    page = context.new_page()
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")

    gate = page.locator("#ownerAccessGate")
    key_input = page.locator("#ownerAccessInput")
    submit = page.locator("#ownerAccessSubmit")
    error = page.locator("#ownerAccessError")

    expect(gate).to_be_visible()

    unauthenticated = page.evaluate(
        """async () => {
            const response = await window.fetch('/api/v1/capabilities/model-assistance');
            return { status: response.status, body: await response.text() };
        }"""
    )
    assert unauthenticated["status"] == 401
    assert "AUTHENTICATION_REQUIRED" in unauthenticated["body"]

    key_input.fill("")
    submit.click()
    expect(error).to_have_text("Enter your access key.")

    key_input.fill(INVALID_TOKEN)
    submit.click()
    expect(error).to_have_text("That access key was not accepted.")
    assert INVALID_TOKEN not in page.url
    assert not _storage_contains_token(page, "sessionStorage", INVALID_TOKEN)
    assert not _storage_contains_token(page, "localStorage", INVALID_TOKEN)

    key_input.fill(OWNER_TOKEN)
    with page.expect_navigation(wait_until="domcontentloaded"):
        submit.click()

    expect(gate).to_be_hidden()
    assert OWNER_TOKEN not in page.url
    assert _storage_contains_token(page, "sessionStorage", OWNER_TOKEN)
    assert not _storage_contains_token(page, "localStorage", OWNER_TOKEN)
    assert OWNER_TOKEN not in page.content()

    seen_authorized_request = {"matched": False}

    def inspect_request(request) -> None:
        if "/api/v1/" not in request.url:
            return
        authorization = request.headers.get("authorization", "")
        if authorization == f"Bearer {OWNER_TOKEN}":
            seen_authorized_request["matched"] = True

    page.on("request", inspect_request)
    authenticated_probe = page.evaluate(
        """async () => {
            const response = await window.ownerFetch('/api/v1/capabilities/model-assistance');
            const text = await response.text();
            return { status: response.status, bodyContainsBearerPrefix: text.includes('Bearer ') };
        }"""
    )
    assert authenticated_probe["status"] == 200
    assert authenticated_probe["bodyContainsBearerPrefix"] is False
    assert seen_authorized_request["matched"] is True

    page.reload(wait_until="domcontentloaded")
    expect(gate).to_be_hidden()
    assert _storage_contains_token(page, "sessionStorage", OWNER_TOKEN)

    page.evaluate(
        "([key, replacement]) => window.sessionStorage.setItem(key, replacement)",
        [STORAGE_KEY, INVALID_TOKEN],
    )
    forced_401 = page.evaluate(
        """async () => {
            const response = await window.ownerFetch('/api/v1/capabilities/model-assistance');
            return response.status;
        }"""
    )
    assert forced_401 == 401
    expect(gate).to_be_visible()
    assert page.evaluate("key => window.sessionStorage.getItem(key)", STORAGE_KEY) is None

    context.close()

    fresh_context = browser.new_context()
    fresh_page = fresh_context.new_page()
    fresh_page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    expect(fresh_page.locator("#ownerAccessGate")).to_be_visible()
    assert not _storage_contains_token(fresh_page, "sessionStorage", OWNER_TOKEN)
    assert not _storage_contains_token(fresh_page, "localStorage", OWNER_TOKEN)
    fresh_context.close()

    print("DEPLOYED_OWNER_AUTH_VALIDATION=PASS")
