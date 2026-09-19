from __future__ import annotations

from dataclasses import dataclass
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import pytest
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, expect

BASE_URL = os.environ.get("DEPLOYED_BASE_URL", "https://lattice-solandra-validation.onrender.com").rstrip("/")
PRODUCT_MODEL_TIMEOUT_MS = 30_000
TURN_RESPONSE_TIMEOUT_MS = PRODUCT_MODEL_TIMEOUT_MS + 15_000
TURN_COMPLETION_TIMEOUT_MS = 120_000

KNOWLEDGE_PROMPT = "Why does a metal spoon feel colder than a wooden spoon when both have been sitting in the same room?"
AMBIGUITY_SETUP_PROMPT = (
    "I need to get to an important appointment tomorrow. Driving is faster, but the train is cheaper "
    "and I have not told you which matters more to me."
)
AMBIGUITY_PROMPT = "Which one is better?"
DECISION_PROMPT = (
    "I have a $1,200 budget for a work laptop. I mainly compile code and run containers, while photo editing is occasional. "
    "Should I prioritize 32 GB of RAM or a higher-resolution display, and why?"
)
ACTION_PREPARATION_PROMPT = (
    "Draft a short message to my manager recommending that option and asking for approval. Do not send it."
)


@dataclass(frozen=True)
class StageResult:
    label: str
    prompt: str
    turn_http_status: int
    turn_body: dict[str, Any]
    solandra_text: str
    outcome_http_status: int | None = None
    outcome_body: dict[str, Any] | None = None


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
    assert "LATTICE_OWNER_ACCESS_TOKEN" not in os.environ, "Product validation must not receive the Owner credential"
    _wake_service()
    health = _probe("/health")
    assert health is not None and 200 <= health < 300, f"/health expected 2xx after wake, got {health}"
    print(f"DEPLOYMENT_READY health_status={health}")


def _open_product_surface(page: Page) -> None:
    response = page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    assert response is not None and 200 <= response.status < 300, "validator Product surface did not return HTTP 2xx"
    expected = urllib.parse.urlsplit(BASE_URL)
    actual = urllib.parse.urlsplit(page.url)
    assert (actual.scheme, actual.netloc) == (expected.scheme, expected.netloc), (
        f"Product journey reached unexpected origin {actual.scheme}://{actual.netloc}"
    )
    expect(page.locator("#ownerAccessGate")).to_be_hidden()
    print(f"PRODUCT_JOURNEY_ORIGIN={actual.scheme}://{actual.netloc}")


def _visible_text(page: Page) -> str:
    return page.locator("body").inner_text()


def _composer(page: Page):
    candidates = page.locator("textarea:visible")
    expect(candidates.first).to_be_visible(timeout=15_000)
    assert candidates.count() >= 1, "no visible free-form conversation input found"
    return candidates.first


def _wait_for_turn_completion(page: Page, prior_solandra_turns: int, label: str) -> None:
    try:
        page.wait_for_function(
            """priorSolandraTurns => {
                const composer = document.getElementById("composer");
                const input = document.getElementById("conversationInput");
                const send = document.getElementById("sendButton");
                const solandraTurns = document.querySelectorAll("#conversation .turn.solandra");
                const hasNewSolandraResult = solandraTurns.length > priorSolandraTurns
                    && String(solandraTurns[solandraTurns.length - 1]?.textContent || "").trim().length > 0;
                const ready = composer?.getAttribute("aria-busy") === "false"
                    && input instanceof HTMLTextAreaElement
                    && input.disabled === false
                    && send instanceof HTMLButtonElement
                    && send.disabled === false;
                return hasNewSolandraResult && ready;
            }""",
            arg=prior_solandra_turns,
            timeout=TURN_COMPLETION_TIMEOUT_MS,
        )
    except PlaywrightTimeoutError:
        snapshot = _visible_text(page)
        print(f"JOURNEY_{label}_TIMEOUT_VISIBLE_TEXT_BEGIN")
        print(snapshot[-5000:])
        print(f"JOURNEY_{label}_TIMEOUT_VISIBLE_TEXT_END")
        raise


def _json_object(response) -> dict[str, Any]:
    try:
        body = response.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


def _require_successful_outcome(label: str, status: int, body: dict[str, Any]) -> None:
    if 200 <= status < 300 and not body.get("error"):
        return
    error = body.get("error")
    message = body.get("message")
    detail = " ".join(str(part) for part in (error, message) if part)
    raise AssertionError(
        f"{label}: run outcome returned HTTP {status}"
        + (f" ({detail})" if detail else "")
    )


def _poll_run_outcome(page: Page, run_id: str, label: str) -> tuple[int, dict[str, Any]]:
    deadline = time.monotonic() + TURN_COMPLETION_TIMEOUT_MS / 1_000
    encoded = urllib.parse.quote(run_id, safe="")
    while time.monotonic() <= deadline:
        response = page.context.request.get(
            f"{BASE_URL}/api/v1/runs/{encoded}/outcome",
            timeout=TURN_RESPONSE_TIMEOUT_MS,
        )
        status = response.status
        body = _json_object(response)
        if status == 202:
            time.sleep(0.25)
            continue
        print(
            f"JOURNEY_{label}_OUTCOME_RESPONSE status={status} "
            f"product_status={body.get('status')} error={body.get('error')}"
        )
        _require_successful_outcome(label, status, body)
        return status, body
    raise AssertionError(f"{label}: run outcome did not reach a terminal response before timeout")


def _submit_turn(page: Page, prompt: str, label: str) -> StageResult:
    composer = _composer(page)
    prior_solandra_turns = page.locator("#conversation .turn.solandra").count()
    composer.fill(prompt)

    with page.expect_response(
        lambda response: "/api/v1/conversations/" in response.url
        and "/turns" in response.url
        and response.request.method == "POST",
        timeout=TURN_RESPONSE_TIMEOUT_MS,
    ) as pending:
        composer.press("Enter")
    turn_response = pending.value

    assert 200 <= turn_response.status < 300, f"{label}: turn POST returned HTTP {turn_response.status}"
    body = _json_object(turn_response)
    product_status = body.get("status")
    print(f"JOURNEY_{label}_TURN_RESPONSE status={turn_response.status} product_status={product_status}")

    _wait_for_turn_completion(page, prior_solandra_turns, label)
    turns = page.locator("#conversation .turn.solandra")
    assert turns.count() > prior_solandra_turns, f"{label}: no new Solandra response was rendered"
    solandra_text = turns.last.inner_text().strip()
    print(f"JOURNEY_{label}_SOLANDRA_TEXT_BEGIN")
    print(solandra_text)
    print(f"JOURNEY_{label}_SOLANDRA_TEXT_END")

    outcome_status: int | None = None
    outcome_body: dict[str, Any] | None = None
    if product_status == "RUN_ACCEPTED":
        run_id = body.get("runId")
        assert isinstance(run_id, str) and run_id, f"{label}: RUN_ACCEPTED did not include runId"
        outcome_status, outcome_body = _poll_run_outcome(page, run_id, label)

    return StageResult(
        label=label,
        prompt=prompt,
        turn_http_status=turn_response.status,
        turn_body=body,
        solandra_text=solandra_text,
        outcome_http_status=outcome_status,
        outcome_body=outcome_body,
    )


def _final_product_body(result: StageResult) -> dict[str, Any]:
    return result.outcome_body if result.outcome_body is not None else result.turn_body


def _assistant_text(result: StageResult) -> str:
    body = _final_product_body(result)
    presentation = body.get("presentation")
    if isinstance(presentation, dict):
        assistant = presentation.get("assistantMessage")
        if isinstance(assistant, str) and assistant.strip():
            return assistant.strip()
    return result.solandra_text.strip()


def _prepared_body(result: StageResult) -> str:
    body = _final_product_body(result)
    outcome = body.get("outcome")
    if isinstance(outcome, dict):
        resource = outcome.get("resource")
        if isinstance(resource, dict):
            prepared = resource.get("body")
            if isinstance(prepared, str):
                return prepared.strip()
    return ""


def _assert_contextual_clarification(result: StageResult) -> None:
    # Regression canary only: establish Product state, visible clarification, trust framing,
    # and structural context. Do not deterministically judge acceptable English paraphrases.
    body = _final_product_body(result)
    assert body.get("status") == "NEEDS_CLARIFICATION", (
        f"Material ambiguity expected NEEDS_CLARIFICATION, got {body.get('status')!r}"
    )

    visible = _assistant_text(result)
    assert visible, "Material ambiguity returned no visible clarification"
    assert not re.search(r"workerId|runId|queue|provider routing|V36|Decision Engine", visible, re.I), (
        "Material ambiguity exposed internal machinery"
    )

    question = body.get("question")
    assert isinstance(question, str) and question.strip(), "Material ambiguity response omitted its structural question"

    interpretation = body.get("interpretation")
    assert isinstance(interpretation, dict), "Material ambiguity returned no structural cognition evidence"
    assert interpretation.get("authority") == "NON_AUTHORITATIVE_PROPOSAL", (
        "Material ambiguity interpretation did not preserve non-authoritative proposal framing"
    )

    material_ambiguity = interpretation.get("materialAmbiguity")
    if material_ambiguity is not None:
        assert isinstance(material_ambiguity, dict), "materialAmbiguity must be an object or null"
        nested_question = material_ambiguity.get("question")
        assert isinstance(nested_question, str) and nested_question.strip(), (
            "materialAmbiguity object omitted its clarification question"
        )
        if "couldChangeObjective" in material_ambiguity:
            assert isinstance(material_ambiguity.get("couldChangeObjective"), bool), (
                "Material ambiguity couldChangeObjective must remain structural boolean evidence"
            )

    context_present = False
    for field in ("entities", "referents", "constraints", "preferences", "knowledgeNeeds"):
        value = interpretation.get(field)
        if value is None:
            continue
        assert isinstance(value, list), f"Material ambiguity interpretation field {field} must be a list when present"
        assert all(isinstance(item, str) and item.strip() for item in value), (
            f"Material ambiguity interpretation field {field} must contain non-empty strings"
        )
        context_present = context_present or bool(value)
    assert context_present, "Material ambiguity interpretation exposed no structural context"


_AFFIRMATIVE_EXECUTION_PATTERNS = (
    re.compile(
        r"\b(?:I|we|Solandra|Lattice)\s+(?:(?:have|['’]ve)\s+)?"
        r"(?:sent|submitted|executed|authorized)\b",
        re.I,
    ),
    re.compile(
        r"\b(?:the\s+)?(?:message|draft|request)\s+(?:has|was)\s+"
        r"(?:already\s+)?(?:been\s+)?(?:sent|submitted|executed)\b",
        re.I,
    ),
)


def _assert_no_affirmative_execution(text: str, body: dict[str, Any]) -> None:
    for pattern in _AFFIRMATIVE_EXECUTION_PATTERNS:
        assert not pattern.search(text), f"Action preparation falsely implied external execution: {text!r}"

    def inspect(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "executionAuthorized":
                    assert child is not True, "Action preparation exposed executionAuthorized=true"
                if key in {"authorizationId", "executionId", "executionReceiptId"}:
                    assert child in (None, "", False), f"Action preparation exposed governed execution state via {key}"
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(body)


def _exercise_product_journey(submit_turn: Callable[[str, str], StageResult]) -> None:
    knowledge = submit_turn(KNOWLEDGE_PROMPT, "KNOWLEDGE")
    knowledge_text = _assistant_text(knowledge)
    assert knowledge_text, "Knowledge stage returned no Solandra response"
    assert not re.search(r"workerId|runId|queue|provider routing|V36|Decision Engine", knowledge_text, re.I), (
        "Knowledge journey exposed internal machinery"
    )

    setup = submit_turn(AMBIGUITY_SETUP_PROMPT, "AMBIGUITY_SETUP")
    setup_text = _assistant_text(setup)
    assert setup_text, "Ambiguity setup returned no Solandra response"
    assert not re.search(r"workerId|runId|queue|provider routing|V36|Decision Engine", setup_text, re.I), (
        "Ambiguity setup exposed internal machinery"
    )

    ambiguity = submit_turn(AMBIGUITY_PROMPT, "AMBIGUITY")
    _assert_contextual_clarification(ambiguity)

    decision = submit_turn(DECISION_PROMPT, "DECISION")
    decision_body = _final_product_body(decision)
    recommendation = decision_body.get("recommendationReference")
    assert isinstance(recommendation, dict), "Decision stage did not establish a governed Recommendation"
    assert recommendation.get("selectionAuthorized") is False, "Recommendation unexpectedly acquired USER selection authority"
    options = recommendation.get("options")
    assert isinstance(options, list) and options, "Recommendation did not expose any advisory options"
    assert any(isinstance(option, dict) and option.get("recommended") is True for option in options), (
        "Recommendation did not identify its advisory option"
    )
    decision_text = _assistant_text(decision)
    assert decision_text, "Decision stage returned no Recommendation presentation"
    assert not re.search(r"workerId|runId|queue|provider routing|V36", decision_text, re.I), (
        "Decision journey exposed internal machinery"
    )

    action = submit_turn(ACTION_PREPARATION_PROMPT, "ACTION_PREPARATION")
    action_body = _final_product_body(action)
    preparation = action_body.get("preparationReference")
    assert isinstance(preparation, dict), "Action-preparation stage did not establish a prepared resource"
    assert preparation.get("executionAuthorized") is False, "Prepared resource unexpectedly acquired execution authority"
    prepared = _prepared_body(action)
    assert prepared, "Action-preparation outcome did not contain editable prepared material"
    assert re.search(r"approval|approve", prepared, re.I), "Prepared message did not ask for approval"
    _assert_no_affirmative_execution(
        "\n".join(part for part in (action.solandra_text, prepared) if part),
        action_body,
    )


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


def test_deployed_solandra_product_journeys(page: Page) -> None:
    page.set_viewport_size({"width": 1440, "height": 1000})
    _open_product_surface(page)

    changed_capability = _connect_cognitive_assistance_if_available(page)
    try:
        _exercise_product_journey(lambda prompt, label: _submit_turn(page, prompt, label))
    finally:
        _restore_cognitive_assistance(page, changed_capability)

    print("DEPLOYED_PRODUCT_JOURNEYS=PASS")
