from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import urllib.error
import urllib.request
from typing import Any, Mapping

import pytest
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, expect

from tools.historical_canary_schema import parse_historical_cases

BASE_URL = os.environ.get(
    "DEPLOYED_BASE_URL",
    "https://lattice-solandra-validation.onrender.com",
).rstrip("/")
EXPECTED_PRODUCT_SHA = os.environ.get("EXPECTED_PRODUCT_SHA", "")
CASES_JSON = os.environ.get("HISTORICAL_CASES_JSON", "")
RESULT_DIR = Path("test-results/historical-canaries")
TURN_RESPONSE_TIMEOUT_MS = 45_000
TURN_COMPLETION_TIMEOUT_MS = 120_000
TURN_PATH_RE = re.compile(r"/api/v1/conversations/([^/]+)/turns$")


@dataclass
class TurnCapture:
    label: str
    prompt: str
    conversation_id: str
    turn_http_status: int
    turn_body: dict[str, Any]
    run_id: str | None
    outcome_http_status: int | None
    outcome_body: dict[str, Any] | None
    rendered_text: str
    screenshot: str
    wait_error: str | None = None


class EvidenceBlocked(RuntimeError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _git_value(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def _workflow_url() -> str | None:
    server = os.environ.get("GITHUB_SERVER_URL", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    if server and repository and run_id:
        return f"{server}/{repository}/actions/runs/{run_id}"
    return None


def _sanitize(value: Any) -> Any:
    sensitive = ("token", "authorization", "cookie", "secret", "password")
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, child in value.items():
            if any(part in str(key).casefold() for part in sensitive):
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = _sanitize(child)
        return result
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    return value


def _write_json(name: str, value: Any) -> str:
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULT_DIR / name
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path)


def _initial_evidence(cases: dict[str, dict[str, str]]) -> dict[str, Any]:
    branch = os.environ.get("GITHUB_REF_NAME", "") or _git_value("branch", "--show-current")
    sha = _git_value("rev-parse", "HEAD") or os.environ.get("GITHUB_SHA", "")
    tree = _git_value("rev-parse", "HEAD^{tree}")
    deploy_before = os.environ.get("VALIDATOR_DEPLOY_ID_BEFORE", "").strip() or None
    deploy_after = os.environ.get("VALIDATOR_DEPLOY_ID_AFTER", "").strip() or None
    return {
        "schemaVersion": 1,
        "evidenceKind": "historical-user-facing-canaries",
        "startedAt": _utc_now(),
        "completedAt": None,
        "observationStatus": "RUNNING",
        "validatorHarness": {
            "branch": branch or None,
            "sha": sha or None,
            "tree": tree or None,
            "workflowRunId": os.environ.get("GITHUB_RUN_ID") or None,
            "workflowUrl": _workflow_url(),
        },
        "canonicalProductTarget": BASE_URL,
        "expectedProductSha": EXPECTED_PRODUCT_SHA or None,
        "deployment": {
            "idBefore": deploy_before,
            "idAfter": deploy_after,
            "observationState": "KNOWN" if deploy_before or deploy_after else "UNKNOWN",
        },
        "ownerCredentialPresent": "LATTICE_OWNER_ACCESS_TOKEN" in os.environ,
        "casesAsExecuted": cases,
        "cases": {},
        "providerModelObservation": {"state": "UNKNOWN", "values": []},
        "limitations": [
            "Model/provider invocation telemetry is UNKNOWN unless directly exposed in captured Product evidence.",
            "Deployment identity is external evidence and remains UNKNOWN in this artifact unless supplied by the execution environment.",
        ],
    }


def _probe(path: str) -> int | None:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        method="GET",
        headers={"User-Agent": "lattice-historical-canary-validator/1.0"},
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
    while time.monotonic() <= deadline:
        status = _probe("/health")
        if status is not None and status < 500:
            return
        time.sleep(5)
    raise EvidenceBlocked("canonical validator Product did not become reachable within the cold-start window")


def _open_fresh_conversation_surface(page: Page) -> None:
    response = page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    if response is None or not 200 <= response.status < 300:
        raise EvidenceBlocked("validator Product surface did not return HTTP 2xx")
    page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    response = page.reload(wait_until="domcontentloaded")
    if response is None or not 200 <= response.status < 300:
        raise EvidenceBlocked("validator Product surface did not reload after local state reset")
    actual = urllib.parse.urlsplit(page.url)
    expected = urllib.parse.urlsplit(BASE_URL)
    if (actual.scheme, actual.netloc) != (expected.scheme, expected.netloc):
        raise EvidenceBlocked(f"Product journey reached unexpected origin {actual.scheme}://{actual.netloc}")
    expect(page.locator("#ownerAccessGate")).to_be_hidden(timeout=15_000)


def _composer(page: Page):
    candidates = page.locator("textarea:visible")
    expect(candidates.first).to_be_visible(timeout=15_000)
    if candidates.count() < 1:
        raise EvidenceBlocked("no visible free-form conversation input found")
    return candidates.first


def _json_object(response) -> dict[str, Any]:
    try:
        body = response.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


def _conversation_id(url: str) -> str:
    match = TURN_PATH_RE.search(urllib.parse.urlsplit(url).path)
    if match is None:
        raise EvidenceBlocked("turn response URL did not expose a Conversation identity")
    return urllib.parse.unquote(match.group(1))


def _poll_run_outcome(page: Page, run_id: str) -> tuple[int, dict[str, Any]]:
    deadline = time.monotonic() + TURN_COMPLETION_TIMEOUT_MS / 1_000
    encoded = urllib.parse.quote(run_id, safe="")
    while time.monotonic() <= deadline:
        response = page.context.request.get(
            f"{BASE_URL}/api/v1/runs/{encoded}/outcome",
            timeout=TURN_RESPONSE_TIMEOUT_MS,
        )
        body = _json_object(response)
        if response.status == 202:
            time.sleep(0.25)
            continue
        return response.status, body
    return 598, {"error": "OUTCOME_POLL_TIMEOUT"}


def _wait_for_rendered_turn(page: Page, prior_solandra_turns: int) -> str | None:
    try:
        page.wait_for_function(
            """prior => {
                const composer = document.getElementById("composer");
                const input = document.getElementById("conversationInput");
                const send = document.getElementById("sendButton");
                const solandraTurns = document.querySelectorAll("#conversation .turn.solandra");
                const hasNew = solandraTurns.length > prior
                    && String(solandraTurns[solandraTurns.length - 1]?.textContent || "").trim().length > 0;
                const ready = composer?.getAttribute("aria-busy") === "false"
                    && input instanceof HTMLTextAreaElement
                    && input.disabled === false
                    && send instanceof HTMLButtonElement
                    && send.disabled === false;
                return hasNew && ready;
            }""",
            arg=prior_solandra_turns,
            timeout=TURN_COMPLETION_TIMEOUT_MS,
        )
        return None
    except PlaywrightTimeoutError as error:
        return str(error)


def _submit_ui_turn(page: Page, prompt: str, label: str) -> TurnCapture:
    composer = _composer(page)
    prior = page.locator("#conversation .turn.solandra").count()
    composer.fill(prompt)
    with page.expect_response(
        lambda response: "/api/v1/conversations/" in response.url
        and response.url.endswith("/turns")
        and response.request.method == "POST",
        timeout=TURN_RESPONSE_TIMEOUT_MS,
    ) as pending:
        composer.press("Enter")
    response = pending.value
    body = _json_object(response)
    conversation_id = _conversation_id(response.url)
    run_id = body.get("runId") if isinstance(body.get("runId"), str) else None
    outcome_status: int | None = None
    outcome_body: dict[str, Any] | None = None
    if body.get("status") == "RUN_ACCEPTED" and run_id:
        outcome_status, outcome_body = _poll_run_outcome(page, run_id)

    wait_error = _wait_for_rendered_turn(page, prior)
    rendered = ""
    turns = page.locator("#conversation .turn.solandra")
    if turns.count() > prior:
        rendered = turns.last.inner_text().strip()

    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    screenshot = RESULT_DIR / f"{label}.png"
    page.screenshot(path=str(screenshot), full_page=True)

    capture = TurnCapture(
        label=label,
        prompt=prompt,
        conversation_id=conversation_id,
        turn_http_status=response.status,
        turn_body=body,
        run_id=run_id,
        outcome_http_status=outcome_status,
        outcome_body=outcome_body,
        rendered_text=rendered,
        screenshot=str(screenshot),
        wait_error=wait_error,
    )
    _write_json(f"{label}-turn.json", {"raw": asdict(capture), "sanitized": _sanitize(asdict(capture))})
    return capture


def _api_get(page: Page, path: str, label: str) -> dict[str, Any]:
    response = page.context.request.get(f"{BASE_URL}{path}", timeout=TURN_RESPONSE_TIMEOUT_MS)
    capture = {"httpStatus": response.status, "body": _json_object(response)}
    _write_json(f"{label}.json", {"raw": capture, "sanitized": _sanitize(capture)})
    return capture


def _continuity(page: Page, conversation_id: str, label: str) -> dict[str, Any]:
    encoded = urllib.parse.quote(conversation_id, safe="")
    return _api_get(page, f"/api/v1/conversations/{encoded}/continuity", label)


def _final_body(turn: TurnCapture) -> dict[str, Any]:
    return turn.outcome_body if turn.outcome_body is not None else turn.turn_body


def _turn_failed(turn: TurnCapture) -> bool:
    if not 200 <= turn.turn_http_status < 300:
        return True
    if turn.outcome_http_status is not None and not 200 <= turn.outcome_http_status < 300:
        return True
    if turn.wait_error is not None or not turn.rendered_text:
        return True
    return False


def _knowledge_id(turn: TurnCapture, continuity: dict[str, Any]) -> str | None:
    final = _final_body(turn)
    reference = final.get("knowledgeReference")
    if isinstance(reference, dict) and isinstance(reference.get("knowledgeId"), str):
        return reference["knowledgeId"]
    body = continuity.get("body")
    if not isinstance(body, dict):
        return None
    knowledge = body.get("knowledge")
    if isinstance(knowledge, list) and len(knowledge) == 1 and isinstance(knowledge[0], dict):
        item = knowledge[0].get("knowledgeId")
        return item if isinstance(item, str) else None
    return None


def _knowledge_snapshot(page: Page, knowledge_id: str, label: str) -> dict[str, Any]:
    encoded = urllib.parse.quote(knowledge_id, safe="")
    return _api_get(page, f"/api/v1/knowledge/{encoded}", label)


def _continuity_body(capture: dict[str, Any]) -> dict[str, Any]:
    body = capture.get("body")
    return body if isinstance(body, dict) else {}


def _run_count(continuity: dict[str, Any]) -> int:
    runs = _continuity_body(continuity).get("runs")
    return len(runs) if isinstance(runs, list) else 0


def _user_message_id(continuity: dict[str, Any], prompt: str) -> str | None:
    messages = _continuity_body(continuity).get("messages")
    if not isinstance(messages, list):
        return None
    for message in reversed(messages):
        if (
            isinstance(message, dict)
            and message.get("role") == "USER"
            and message.get("content") == prompt
            and isinstance(message.get("id"), str)
        ):
            return message["id"]
    return None


def _solandra_authority(continuity: dict[str, Any], source_message_id: str | None) -> dict[str, Any] | None:
    if not source_message_id:
        return None
    messages = _continuity_body(continuity).get("messages")
    if not isinstance(messages, list):
        return None
    for message in reversed(messages):
        if (
            isinstance(message, dict)
            and message.get("role") == "SOLANDRA"
            and message.get("sourceMessageId") == source_message_id
        ):
            return {
                "responseId": message.get("id"),
                "authority": message.get("authority"),
                "factualAuthority": message.get("factualAuthority"),
            }
    return None


def _references(
    continuity: dict[str, Any],
    *,
    kind: str,
    target_id: str | None = None,
    relation: str | None = None,
    user_message_id: str | None = None,
) -> list[dict[str, Any]]:
    refs = _continuity_body(continuity).get("conversationReferences")
    if not isinstance(refs, list):
        return []
    matched: list[dict[str, Any]] = []
    for reference in refs:
        if not isinstance(reference, dict):
            continue
        if user_message_id is not None and reference.get("userMessageId") != user_message_id:
            continue
        targets = reference.get("targets")
        if not isinstance(targets, list):
            continue
        if any(
            isinstance(target, dict)
            and target.get("kind") == kind
            and (target_id is None or target.get("targetId") == target_id)
            and (relation is None or target.get("relation") == relation)
            for target in targets
        ):
            matched.append(reference)
    return matched


def _source_provenance(knowledge_snapshot: dict[str, Any]) -> dict[str, Any]:
    body = knowledge_snapshot.get("body")
    if not isinstance(body, dict):
        return {"sourceIds": [], "provenance": [], "evidence": []}
    outcome = body.get("outcome")
    if not isinstance(outcome, dict):
        outcome = {}
    return {
        "sourceIds": body.get("sourceIds") if isinstance(body.get("sourceIds"), list) else [],
        "provenance": outcome.get("provenance") if isinstance(outcome.get("provenance"), list) else [],
        "evidence": outcome.get("evidence") if isinstance(outcome.get("evidence"), list) else [],
    }


def _knowledge_follow_up_case(
    page: Page,
    case_id: str,
    seed_prompt: str,
    follow_up_prompt: str,
) -> dict[str, Any]:
    _open_fresh_conversation_surface(page)
    seed = _submit_ui_turn(page, seed_prompt, f"{case_id}-seed")
    seed_continuity = _continuity(page, seed.conversation_id, f"{case_id}-continuity-seed")
    result: dict[str, Any] = {
        "status": "REACHED",
        "seed": asdict(seed),
        "seedContinuity": seed_continuity,
        "followUp": None,
        "limitations": [],
    }
    if _turn_failed(seed):
        result["status"] = "BLOCKED"
        result["blocker"] = "seed turn did not complete through the user-facing Product path"
        return result

    knowledge_id = _knowledge_id(seed, seed_continuity)
    if not knowledge_id:
        result["status"] = "BLOCKED"
        result["blocker"] = "seed turn did not establish observable governed Knowledge"
        return result
    produced = _references(
        seed_continuity,
        kind="KNOWLEDGE",
        target_id=knowledge_id,
        relation="PRODUCED",
    )
    if not produced:
        result["status"] = "BLOCKED"
        result["blocker"] = "seed Knowledge had no observable PRODUCED ConversationReference"
        return result

    knowledge_before = _knowledge_snapshot(page, knowledge_id, f"{case_id}-knowledge-before")
    before_runs = _run_count(seed_continuity)
    follow = _submit_ui_turn(page, follow_up_prompt, f"{case_id}-follow-up")
    after_continuity = _continuity(page, follow.conversation_id, f"{case_id}-continuity-follow-up")
    follow_message_id = _user_message_id(after_continuity, follow_up_prompt)
    consumed = _references(
        after_continuity,
        kind="KNOWLEDGE",
        target_id=knowledge_id,
        relation="CONSUMED",
        user_message_id=follow_message_id,
    )
    knowledge_after = _knowledge_snapshot(page, knowledge_id, f"{case_id}-knowledge-after")
    final_reference = _final_body(follow).get("knowledgeReference")
    result.update({
        "knowledgeId": knowledge_id,
        "producedReference": produced[-1],
        "sourceProvenance": _source_provenance(knowledge_before),
        "runCountBeforeFollowUp": before_runs,
        "knowledgeBefore": knowledge_before,
        "followUp": asdict(follow),
        "followUpKnowledgeReference": final_reference if isinstance(final_reference, dict) else None,
        "followUpContinuity": after_continuity,
        "followUpUserMessageId": follow_message_id,
        "consumedReference": consumed[-1] if consumed else None,
        "parentProducedRelationship": {
            "producedReferenceId": produced[-1].get("referenceId"),
            "consumedParentReferenceId": consumed[-1].get("parentReferenceId") if consumed else None,
            "consumedParentIsProducedReference": bool(
                consumed
                and consumed[-1].get("parentReferenceId") == produced[-1].get("referenceId")
            ),
        },
        "runCountAfterFollowUp": _run_count(after_continuity),
        "knowledgeAfter": knowledge_after,
        "knowledgeJsonExactlyUnchanged": knowledge_before.get("body") == knowledge_after.get("body"),
        "solandraResponseAuthority": _solandra_authority(after_continuity, follow_message_id),
        "structuralObservations": {
            "newRunObservedDuringFollowUp": _run_count(after_continuity) > before_runs,
            "exactPriorKnowledgeConsumedReferenceObserved": bool(consumed),
        },
    })
    if _turn_failed(follow):
        result["status"] = "BLOCKED"
        result["blocker"] = "follow-up turn did not complete through the user-facing Product path"
    return result


def _case_44(page: Page, prompt: str) -> dict[str, Any]:
    _open_fresh_conversation_surface(page)
    turn = _submit_ui_turn(page, prompt, "44-turn")
    continuity = _continuity(page, turn.conversation_id, "44-continuity")
    user_message_id = _user_message_id(continuity, prompt)
    body = _continuity_body(continuity)
    knowledge = body.get("knowledge") if isinstance(body.get("knowledge"), list) else []
    references = body.get("conversationReferences") if isinstance(body.get("conversationReferences"), list) else []
    produced_knowledge = [
        reference for reference in references
        if isinstance(reference, dict)
        and any(
            isinstance(target, dict)
            and target.get("kind") == "KNOWLEDGE"
            and target.get("relation") == "PRODUCED"
            for target in reference.get("targets", [])
            if isinstance(reference.get("targets"), list)
        )
    ]
    status = "BLOCKED" if _turn_failed(turn) else ("INVALID" if knowledge or produced_knowledge else "REACHED")
    return {
        "status": status,
        "turn": asdict(turn),
        "continuity": continuity,
        "userMessageId": user_message_id,
        "solandraResponseAuthority": _solandra_authority(continuity, user_message_id),
        "createdRuns": body.get("runs") if isinstance(body.get("runs"), list) else [],
        "createdKnowledge": knowledge,
        "createdConversationReferences": references,
        "structuralObservation": (
            "Governed Knowledge was established; this canary did not remain on the intended non-governed conversational path."
            if status == "INVALID"
            else None
        ),
    }


def _mark_not_reached(evidence: dict[str, Any], case_ids: tuple[str, ...], reason: str) -> None:
    for case_id in case_ids:
        evidence["cases"][case_id] = {"status": "NOT_REACHED", "reason": reason}


def _find_provider_model(value: Any, path: str = "$") -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    if isinstance(value, Mapping):
        actual_provider = value.get("actualProvider")
        actual_model = value.get("actualModel")
        if isinstance(actual_provider, str) or isinstance(actual_model, str):
            found.append({
                "path": path,
                "actualProvider": actual_provider if isinstance(actual_provider, str) else "",
                "actualModel": actual_model if isinstance(actual_model, str) else "",
            })
        for key, child in value.items():
            found.extend(_find_provider_model(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(_find_provider_model(child, f"{path}[{index}]"))
    return found


@pytest.fixture(scope="session", autouse=True)
def deployment_ready() -> None:
    if "LATTICE_OWNER_ACCESS_TOKEN" in os.environ:
        pytest.fail("historical Product validation must not receive the Owner credential")
    _wake_service()
    health = _probe("/health")
    if health is None or not 200 <= health < 300:
        pytest.fail(f"/health expected 2xx after wake, got {health}")


def test_historical_user_facing_canaries(page: Page) -> None:
    cases = parse_historical_cases(CASES_JSON)
    evidence = _initial_evidence(cases)
    _write_json("evidence.json", evidence)
    blocked_reason: str | None = None
    unexpected_error: Exception | None = None

    try:
        page.set_viewport_size({"width": 1440, "height": 1000})

        case19 = _knowledge_follow_up_case(
            page,
            "19",
            cases["19"]["seed"],
            cases["19"]["follow_up"],
        )
        evidence["cases"]["19"] = case19
        if case19["status"] == "BLOCKED":
            blocked_reason = "#19 blocked before the historical Knowledge-reference canary completed"
            _mark_not_reached(evidence, ("20", "44", "47"), blocked_reason)
            raise EvidenceBlocked(blocked_reason)

        case20 = _knowledge_follow_up_case(
            page,
            "20",
            cases["20"]["seed"],
            cases["20"]["follow_up"],
        )
        evidence["cases"]["20"] = case20
        if case20["status"] == "BLOCKED":
            blocked_reason = "#20 blocked before the historical Knowledge-transformation canary completed"
            _mark_not_reached(evidence, ("44", "47"), blocked_reason)
            raise EvidenceBlocked(blocked_reason)

        evidence["cases"]["44"] = _case_44(page, cases["44"]["prompt"])

        case47 = _knowledge_follow_up_case(
            page,
            "47",
            cases["47"]["seed"],
            cases["47"]["follow_up"],
        )
        case47["noLexicalSemanticScoringAdded"] = True
        evidence["cases"]["47"] = case47
        if case47["status"] == "BLOCKED":
            blocked_reason = "#47 blocked before the natural-language governed-reference canary completed"
    except EvidenceBlocked as error:
        blocked_reason = str(error)
        evidence["harnessBlocker"] = blocked_reason
        for case_id in ("19", "20", "44", "47"):
            evidence["cases"].setdefault(case_id, {"status": "NOT_REACHED", "reason": blocked_reason})
    except Exception as error:
        unexpected_error = error
        evidence["harnessFailure"] = {
            "type": type(error).__name__,
            "message": str(error),
        }
        for case_id in ("19", "20", "44", "47"):
            evidence["cases"].setdefault(
                case_id,
                {"status": "NOT_REACHED", "reason": "validator harness failed before this canary completed"},
            )
    finally:
        provider_model = _find_provider_model(evidence["cases"])
        if provider_model:
            evidence["providerModelObservation"] = {"state": "KNOWN", "values": provider_model}
        evidence["completedAt"] = _utc_now()
        evidence["observationStatus"] = (
            "FAILED" if unexpected_error is not None
            else "BLOCKED" if blocked_reason
            else "COMPLETE"
        )
        _write_json("evidence.json", evidence)

    if unexpected_error is not None:
        raise unexpected_error
    if blocked_reason:
        pytest.fail(f"{blocked_reason}; see test-results/historical-canaries/evidence.json")
