from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from playwright.sync_api import Page

from tools.deployed_product_journey_validation import (
    _composer,
    _connect_cognitive_assistance_if_available,
    _json_object,
    _open_product_surface,
    _restore_cognitive_assistance,
    _visible_text,
    _wait_for_turn_completion,
)

EVIDENCE_DIR = Path("artifacts/fresh-product-breadth")

KNOWLEDGE_PROMPT = (
    "I'm applying for a U.S. passport this week. What are the current routine and expedited "
    "processing times, and when were those estimates last updated? Please check reliable current sources."
)
FOLLOWUP_PROMPT = (
    "What sources are you relying on for those timing estimates, and what's the biggest uncertainty "
    "I should keep in mind?"
)
DECISION_PROMPT = (
    "I'm choosing between a heat-pump dryer and a standard vented electric dryer for a small condo. "
    "I care most about low energy use and avoiding new venting work; drying speed matters less. "
    "Which fits better, and what am I giving up?"
)
AMBIGUITY_PROMPT = "I also want the cheaper one. Does that change your recommendation?"
REFERENCE_SETUP_PROMPT = (
    "Why do bananas make nearby avocados ripen faster? Keep the explanation short."
)
TOPIC_SWITCH_PROMPT = (
    "Switch topics: why can a wool sweater feel warmer than a cotton one at the same room temperature?"
)
RETURN_PROMPT = (
    "Back to the fruit question: would the same thing happen if the bananas were still green?"
)

_INTERNAL_MACHINERY = re.compile(
    r"\b(?:workerId|runId|queue|provider routing|V36|Decision Engine|research worker|retry epoch)\b",
    re.I,
)


def _new_solandra_text(page: Page, prior_count: int) -> str:
    turns = page.locator("#conversation .turn.solandra")
    if turns.count() <= prior_count:
        return ""
    return turns.last.inner_text().strip()


def _links_from_latest_solandra_turn(page: Page, prior_count: int) -> list[dict[str, str]]:
    turns = page.locator("#conversation .turn.solandra")
    if turns.count() <= prior_count:
        return []
    raw = turns.last.locator("a").evaluate_all(
        """els => els.map(a => ({
            text: String(a.textContent || '').trim(),
            href: String(a.href || '')
        }))"""
    )
    return [
        {"text": str(item.get("text", "")), "href": str(item.get("href", ""))}
        for item in raw
        if isinstance(item, dict)
    ]


def _wait_for_recovered_composer(page: Page) -> None:
    page.wait_for_function(
        """() => {
            const composer = document.getElementById("composer");
            const input = document.getElementById("conversationInput");
            const send = document.getElementById("sendButton");
            return composer?.getAttribute("aria-busy") === "false"
                && input instanceof HTMLTextAreaElement
                && input.disabled === false
                && send instanceof HTMLButtonElement
                && send.disabled === false;
        }""",
        timeout=15_000,
    )


def _submit_observed_turn(page: Page, prompt: str, label: str) -> dict[str, Any]:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    composer = _composer(page)
    prior_count = page.locator("#conversation .turn.solandra").count()
    composer.fill(prompt)

    with page.expect_response(
        lambda response: "/api/v1/conversations/" in response.url
        and "/turns" in response.url
        and response.request.method == "POST",
        timeout=45_000,
    ) as pending:
        composer.press("Enter")
    response = pending.value
    body = _json_object(response)

    completion_error = ""
    if 200 <= response.status < 300:
        try:
            _wait_for_turn_completion(page, prior_count, label)
        except Exception as error:
            completion_error = f"{type(error).__name__}: {error}"
    else:
        try:
            _wait_for_recovered_composer(page)
        except Exception as error:
            completion_error = f"{type(error).__name__}: {error}"

    visible_solandra = _new_solandra_text(page, prior_count)
    visible_page = _visible_text(page)
    composer_value = _composer(page).input_value()
    links = _links_from_latest_solandra_turn(page, prior_count)
    screenshot_path = EVIDENCE_DIR / f"{label.lower()}.png"
    page.screenshot(path=str(screenshot_path), full_page=True)

    entry = {
        "label": label,
        "prompt": prompt,
        "turn_http_status": response.status,
        "turn_body": body,
        "visible_solandra_text": visible_solandra,
        "visible_page_text": visible_page,
        "composer_value_after_turn": composer_value,
        "visible_links": links,
        "completion_error": completion_error,
        "screenshot": str(screenshot_path),
    }
    (EVIDENCE_DIR / f"{label.lower()}.json").write_text(
        json.dumps(entry, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    print(f"FRESH_BREADTH_{label}_EVIDENCE_BEGIN")
    print(json.dumps(entry, indent=2, sort_keys=True))
    print(f"FRESH_BREADTH_{label}_EVIDENCE_END")
    return entry


def _assert_usable(result: dict[str, Any]) -> None:
    assert 200 <= result["turn_http_status"] < 300, (
        f"{result['label']}: turn POST returned HTTP {result['turn_http_status']} "
        f"body={result['turn_body']!r}"
    )
    assert result["visible_solandra_text"], f"{result['label']}: no visible Solandra response"
    assert not _INTERNAL_MACHINERY.search(result["visible_solandra_text"]), (
        f"{result['label']}: visible response exposed internal machinery"
    )


def _prepare(page: Page) -> bool:
    page.set_viewport_size({"width": 1440, "height": 1000})
    _open_product_surface(page)
    return _connect_cognitive_assistance_if_available(page)


def test_fresh_current_knowledge_and_followup(page: Page) -> None:
    changed = _prepare(page)
    try:
        knowledge = _submit_observed_turn(page, KNOWLEDGE_PROMPT, "CURRENT_KNOWLEDGE")
        _assert_usable(knowledge)
        followup = _submit_observed_turn(page, FOLLOWUP_PROMPT, "KNOWLEDGE_FOLLOWUP")
        _assert_usable(followup)
    finally:
        _restore_cognitive_assistance(page, changed)


def test_fresh_decision_support_and_ambiguity(page: Page) -> None:
    changed = _prepare(page)
    try:
        decision = _submit_observed_turn(page, DECISION_PROMPT, "DECISION_SUPPORT")
        _assert_usable(decision)
        ambiguity = _submit_observed_turn(page, AMBIGUITY_PROMPT, "AMBIGUITY")
        _assert_usable(ambiguity)
    finally:
        _restore_cognitive_assistance(page, changed)


def test_fresh_topic_change_and_reference(page: Page) -> None:
    changed = _prepare(page)
    try:
        setup = _submit_observed_turn(page, REFERENCE_SETUP_PROMPT, "REFERENCE_SETUP")
        _assert_usable(setup)
        switched = _submit_observed_turn(page, TOPIC_SWITCH_PROMPT, "TOPIC_SWITCH")
        _assert_usable(switched)
        returned = _submit_observed_turn(page, RETURN_PROMPT, "TOPIC_RETURN")
        _assert_usable(returned)
    finally:
        _restore_cognitive_assistance(page, changed)
