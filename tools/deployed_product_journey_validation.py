from __future__ import annotations

import os
import re
import time
import urllib.error
import urllib.request

import pytest
from playwright.sync_api import Browser, Page, TimeoutError as PlaywrightTimeoutError, expect

BASE_URL = os.environ.get("DEPLOYED_BASE_URL", "https://lattice-solandra.onrender.com").rstrip("/")
OWNER_TOKEN = os.environ.get("LATTICE_OWNER_ACCESS_TOKEN", "")
STORAGE_KEY = "lattice.solandra.owner-access.v1"


def _probe(path: str) -> int | None:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        method="GET",
        headers={"User-Agent": "lattice-deployed-product-validator/1.0"},
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
    assert OWNER_TOKEN, "LATTICE_OWNER_ACCESS_TOKEN secret is not configured"
    _wake_service()
    health = _probe("/health")
    assert health is not None and 200 <= health < 300, f"/health expected 2xx after wake, got {health}"
    print(f"DEPLOYMENT_READY health_status={health}")


def _authenticate(page: Page) -> None:
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    gate = page.locator("#ownerAccessGate")
    expect(gate).to_be_visible()
    page.locator("#ownerAccessInput").fill(OWNER_TOKEN)
    with page.expect_navigation(wait_until="domcontentloaded"):
        page.locator("#ownerAccessSubmit").click()
    expect(gate).to_be_hidden()
    assert page.evaluate("key => window.sessionStorage.getItem(key)", STORAGE_KEY) == OWNER_TOKEN
    assert OWNER_TOKEN not in page.url
    assert OWNER_TOKEN not in page.content()


def _visible_text(page: Page) -> str:
    return page.locator("body").inner_text().replace(OWNER_TOKEN, "[REDACTED]")


def _composer(page: Page):
    candidates = page.locator("textarea:visible")
    expect(candidates.first).to_be_visible(timeout=15_000)
    assert candidates.count() >= 1, "no visible free-form conversation input found"
    return candidates.first


def _submit_turn(page: Page, prompt: str, label: str) -> str:
    composer = _composer(page)
    before = _visible_text(page)
    composer.fill(prompt)

    turn_response = None
    try:
        with page.expect_response(
            lambda response: "/api/v1/conversations/" in response.url
            and "/turns" in response.url
            and response.request.method == "POST",
            timeout=20_000,
        ) as pending:
            composer.press("Enter")
        turn_response = pending.value
    except Exception:
        button = composer.locator("xpath=ancestor::form[1]//button[@type='submit'] | ancestor::*[contains(@class,'composer')][1]//button").last
        expect(button).to_be_visible(timeout=5_000)
        with page.expect_response(
            lambda response: "/api/v1/conversations/" in response.url
            and "/turns" in response.url
            and response.request.method == "POST",
            timeout=20_000,
        ) as pending:
            button.click()
        turn_response = pending.value

    assert turn_response is not None
    assert 200 <= turn_response.status < 300, f"{label}: turn POST returned HTTP {turn_response.status}"

    try:
        page.wait_for_function(
            """prior => {
                const text = document.body.innerText;
                return text !== prior && Math.abs(text.length - prior.length) > 20;
            }""",
            arg=before,
            timeout=60_000,
        )
    except PlaywrightTimeoutError:
        snapshot = _visible_text(page)
        print(f"JOURNEY_{label}_TIMEOUT_VISIBLE_TEXT_BEGIN")
        print(snapshot[-5000:])
        print(f"JOURNEY_{label}_TIMEOUT_VISIBLE_TEXT_END")
        raise

    after = _visible_text(page)
    assert OWNER_TOKEN not in after
    print(f"JOURNEY_{label}_VISIBLE_TEXT_BEGIN")
    print(after[-5000:])
    print(f"JOURNEY_{label}_VISIBLE_TEXT_END")
    return after


def _connect_cognitive_assistance_if_available(page: Page) -> bool:
    button = page.get_by_role("button", name=re.compile(r"Cognitive assistance", re.I))
    if button.count() == 0:
        print("COGNITIVE_ASSISTANCE_CONTROL=NOT_PRESENT")
        return False
    button.first.click()
    dialog = page.locator("dialog:visible").last
    expect(dialog).to_be_visible(timeout=10_000)
    text = dialog.inner_text()
    if re.search(r"Unavailable", text, re.I):
        print("COGNITIVE_ASSISTANCE=UNAVAILABLE")
        dialog.get_by_role("button", name="Close").click()
        return False
    toggle = dialog.get_by_role("button", name=re.compile(r"Connect|Disconnect", re.I))
    label = toggle.inner_text().strip().lower()
    changed = label == "connect"
    if changed:
        toggle.click()
        expect(dialog).to_contain_text(re.compile(r"Connected", re.I), timeout=20_000)
        print("COGNITIVE_ASSISTANCE=CONNECTED_FOR_VALIDATION")
    else:
        print("COGNITIVE_ASSISTANCE=ALREADY_CONNECTED")
    dialog.get_by_role("button", name="Close").click()
    return changed


def _restore_cognitive_assistance(page: Page, changed: bool) -> None:
    if not changed:
        return
    button = page.get_by_role("button", name=re.compile(r"Cognitive assistance", re.I))
    if button.count() == 0:
        return
    button.first.click()
    dialog = page.locator("dialog:visible").last
    expect(dialog).to_be_visible(timeout=10_000)
    toggle = dialog.get_by_role("button", name=re.compile(r"Disconnect", re.I))
    if toggle.count():
        toggle.click()
        expect(dialog).to_contain_text(re.compile(r"Disconnected|Not connected", re.I), timeout=20_000)
        print("COGNITIVE_ASSISTANCE=RESTORED_DISCONNECTED")
    dialog.get_by_role("button", name="Close").click()


def test_deployed_solandra_product_journeys(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    _authenticate(page)

    changed_capability = _connect_cognitive_assistance_if_available(page)
    try:
        knowledge = _submit_turn(
            page,
            "Why does a metal spoon feel colder than a wooden spoon when both have been sitting in the same room?",
            "KNOWLEDGE",
        )
        assert not re.search(r"workerId|runId|queue|provider routing|V36|Decision Engine", knowledge, re.I), (
            "Knowledge journey exposed internal machinery"
        )

        setup = _submit_turn(
            page,
            "I need to get to an important appointment tomorrow. Driving is faster, but the train is cheaper and I have not told you which matters more to me.",
            "AMBIGUITY_SETUP",
        )
        assert "appointment" in setup.lower()
        ambiguity = _submit_turn(page, "Which one is better?", "AMBIGUITY")
        assert re.search(r"which matters|priority|more important|prefer|trade.?off|clarif", ambiguity, re.I), (
            "Material ambiguity was not visibly clarified or qualified"
        )

        decision = _submit_turn(
            page,
            "I have a $1,200 budget for a work laptop. I mainly compile code and run containers, while photo editing is occasional. Should I prioritize 32 GB of RAM or a higher-resolution display, and why?",
            "DECISION",
        )
        assert re.search(r"RAM|memory", decision, re.I), "Decision response did not visibly address RAM/memory"
        assert re.search(r"display|resolution|screen", decision, re.I), "Decision response did not visibly address display tradeoff"
        assert not re.search(r"workerId|runId|queue|provider routing|V36", decision, re.I), (
            "Decision journey exposed internal machinery"
        )

        action = _submit_turn(
            page,
            "Draft a short message to my manager recommending the RAM-first option and asking for approval. Do not send it.",
            "ACTION_PREPARATION",
        )
        assert re.search(r"RAM|memory", action, re.I), "Prepared message did not preserve the selected recommendation"
        assert re.search(r"approval|approve", action, re.I), "Prepared message did not ask for approval"
        assert not re.search(r"sent|I sent|message has been sent", action, re.I), (
            "Action preparation falsely implied external execution"
        )

        page.reload(wait_until="domcontentloaded")
        expect(page.locator("#ownerAccessGate")).to_be_hidden()
        continuity = _visible_text(page)
        assert re.search(r"RAM|memory", continuity, re.I), "Reload did not visibly preserve conversation context"
        print("JOURNEY_RELOAD_CONTINUITY=PASS")
    finally:
        _restore_cognitive_assistance(page, changed_capability)
        context.close()

    print("DEPLOYED_PRODUCT_JOURNEYS=PASS")
