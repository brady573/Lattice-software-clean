from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("DEPLOYED_BASE_URL", "https://lattice-solandra-validation.onrender.com").rstrip("/")
OWNER_TOKEN = os.environ.get("LATTICE_OWNER_ACCESS_TOKEN", "")
PRODUCT_PARENT_SHA = os.environ.get("PRODUCT_PARENT_SHA", "")
EXPECTED_DEPLOYED_SHA = os.environ.get("EXPECTED_DEPLOYED_SHA", PRODUCT_PARENT_SHA)
EVIDENCE_DIR = Path(os.environ.get("EVIDENCE_DIR", "artifacts/issue-91-governed-knowledge"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
EVIDENCE_PATH = EVIDENCE_DIR / "evidence.json"
STORAGE_KEY = "lattice.solandra.owner-access.v1"
TARGET_URL = "https://lattice-solandra-validation.onrender.com"

TURN_1 = "What is the current stable release of CPython, and when was it released?"
TURN_2 = "What sources are you basing that on, and what are you still uncertain about?"
TURN_3 = "Explain the release-version point more simply."
TURN_4 = "For that same release, focus just on the version number and release date."
FORBIDDEN_USER_WORDS = re.compile(
    r"Knowledge ID|ConversationReference|Run\b|IntentVersion|worker|provider route|V36",
    re.IGNORECASE,
)


def _probe(path: str) -> int | None:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        method="GET",
        headers={"User-Agent": "lattice-issue91-governed-knowledge-validator/1.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, TimeoutError):
        return None


def _wake_service() -> int:
    deadline = time.monotonic() + 120
    first = True
    while time.monotonic() <= deadline:
        status = _probe("/health")
        if status is not None and 200 <= status < 300:
            return status
        if first:
            print(f"VALIDATION_DEPLOYMENT_WAKE_CANDIDATE health_status={status}")
            first = False
        time.sleep(5)
    raise RuntimeError("DEPLOYMENT_UNREACHABLE: validation deployment did not become healthy within bounded wake window")


def _native_api_status(page, path: str) -> int:
    return int(page.evaluate(
        """async path => {
            try {
                const response = await window.fetch(path, {headers: {Accept: 'application/json'}});
                return response.status;
            } catch {
                return 0;
            }
        }""",
        path,
    ))


def _owner_api(page, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    result = page.evaluate(
        """async ([method, path, payload]) => {
            if (typeof window.ownerFetch !== 'function') {
                return {status: 0, body: null, text: 'OWNER_FETCH_UNAVAILABLE'};
            }
            const headers = {Accept: 'application/json'};
            const init = {method, headers};
            if (payload !== null) {
                headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(payload);
            }
            const response = await window.ownerFetch(path, init);
            const text = await response.text();
            let body = null;
            if (text.length > 0) {
                try { body = JSON.parse(text); } catch {}
            }
            return {status: response.status, ok: response.ok, body, text: body === null ? text.slice(0, 6000) : null};
        }""",
        [method, path, payload],
    )
    if OWNER_TOKEN and OWNER_TOKEN in json.dumps(result, ensure_ascii=False):
        raise RuntimeError("SECRET_LEAK: owner token appeared in Product API response")
    return result


def _authenticate(page) -> dict[str, Any]:
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=60_000)
    gate = page.locator("#ownerAccessGate")
    gate.wait_for(state="attached", timeout=20_000)

    stored_before = page.evaluate("key => window.sessionStorage.getItem(key)", STORAGE_KEY)
    if stored_before:
        raise RuntimeError("AUTH_HARNESS_STATE_INVALID: fresh browser context unexpectedly contained an Owner token")

    unauthenticated_status = _native_api_status(page, "/api/v1/capabilities/model-assistance")
    state: dict[str, Any] = {
        "unauthenticatedCapabilityStatus": unauthenticated_status,
        "gateInitiallyVisible": gate.is_visible(),
    }
    if unauthenticated_status != 401:
        raise RuntimeError(
            f"AUTH_CONFIGURATION_MISMATCH: expected unauthenticated capability probe HTTP 401, got {unauthenticated_status}"
        )

    gate.wait_for(state="visible", timeout=10_000)
    page.locator("#ownerAccessInput").fill(OWNER_TOKEN)
    with page.expect_navigation(wait_until="domcontentloaded", timeout=30_000):
        page.locator("#ownerAccessSubmit").click()
    gate.wait_for(state="hidden", timeout=20_000)

    stored_after = page.evaluate("key => window.sessionStorage.getItem(key)", STORAGE_KEY)
    if stored_after != OWNER_TOKEN:
        raise RuntimeError("AUTH_CONFIGURATION_MISMATCH: existing Owner secret did not establish session authentication")
    if OWNER_TOKEN in page.url or OWNER_TOKEN in page.content():
        raise RuntimeError("SECRET_LEAK: owner token leaked into rendered Product state")

    authenticated = _owner_api(page, "GET", "/api/v1/capabilities/model-assistance")
    state["authenticatedCapabilityStatus"] = authenticated["status"]
    if authenticated["status"] != 200:
        raise RuntimeError(
            f"AUTH_CONFIGURATION_MISMATCH: existing Owner secret did not authorize validation deployment; HTTP {authenticated['status']}"
        )
    state["ownerGate"] = "AUTHORIZED"
    return state


def _continuity(page, conversation_id: str) -> dict[str, Any]:
    response = _owner_api(page, "GET", f"/api/v1/conversations/{conversation_id}/continuity")
    if response["status"] != 200 or not isinstance(response.get("body"), dict):
        raise RuntimeError(f"CONTINUITY_UNAVAILABLE: HTTP {response['status']}")
    return response["body"]


def _id_set(continuity: dict[str, Any], collection: str, key: str) -> set[str]:
    values = continuity.get(collection)
    if not isinstance(values, list):
        return set()
    return {
        str(item[key])
        for item in values
        if isinstance(item, dict) and item.get(key) is not None
    }


def _delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    new_runs = sorted(_id_set(after, "runs", "runId") - _id_set(before, "runs", "runId"))
    new_knowledge = sorted(_id_set(after, "knowledge", "knowledgeId") - _id_set(before, "knowledge", "knowledgeId"))
    if new_knowledge:
        classification = "NEW_GOVERNED_KNOWLEDGE_VISIBLE"
    elif new_runs:
        classification = "NEW_RUN_WITHOUT_NEW_KNOWLEDGE_VISIBLE"
    else:
        classification = "NO_NEW_ACQUISITION_VISIBLE"
    return {"newRunIds": new_runs, "newKnowledgeIds": new_knowledge, "classification": classification}


def _wait_run(page, run_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 240
    observations: list[dict[str, Any]] = []
    last = None
    while time.monotonic() <= deadline:
        response = _owner_api(page, "GET", f"/api/v1/runs/{run_id}")
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        status = body.get("status")
        if status != last:
            observations.append({"httpStatus": response["status"], "runStatus": status})
            last = status
        if response["status"] == 200 and status in {"COMPLETED", "FAILED", "CANCELLED"}:
            outcome = _owner_api(page, "GET", f"/api/v1/runs/{run_id}/outcome") if status == "COMPLETED" else None
            return {"runId": run_id, "terminalStatus": status, "observations": observations, "outcomeResponse": outcome}
        time.sleep(2)
    return {"runId": run_id, "terminalStatus": "TIMEOUT", "observations": observations, "outcomeResponse": None}


def _submit(page, conversation_id: str, message: str) -> dict[str, Any]:
    if FORBIDDEN_USER_WORDS.search(message):
        raise RuntimeError(f"PROMPT_SCOPE_ERROR: user wording contains internal machinery: {message}")
    response = _owner_api(
        page,
        "POST",
        f"/api/v1/conversations/{conversation_id}/turns",
        {"turnId": str(uuid.uuid4()), "message": message},
    )
    body = response.get("body") if isinstance(response.get("body"), dict) else {}
    run_id = body.get("runId") if isinstance(body.get("runId"), str) else None
    run = _wait_run(page, run_id) if run_id else None
    return {"message": message, "response": response, "run": run}


def _knowledge_reference(response: dict[str, Any] | None) -> str | None:
    if not isinstance(response, dict):
        return None
    body = response.get("body")
    if not isinstance(body, dict):
        return None
    reference = body.get("knowledgeReference")
    if isinstance(reference, dict) and isinstance(reference.get("knowledgeId"), str):
        return reference["knowledgeId"]
    return None


def _run_outcome(turn: dict[str, Any]) -> dict[str, Any] | None:
    run = turn.get("run")
    if not isinstance(run, dict):
        return None
    response = run.get("outcomeResponse")
    if not isinstance(response, dict):
        return None
    body = response.get("body")
    if not isinstance(body, dict):
        return None
    outcome = body.get("outcome")
    return outcome if isinstance(outcome, dict) else None


def _run_knowledge_id(turn: dict[str, Any]) -> str | None:
    run = turn.get("run")
    if not isinstance(run, dict):
        return None
    return _knowledge_reference(run.get("outcomeResponse"))


def _source_keys(knowledge: dict[str, Any] | None) -> set[str]:
    if not isinstance(knowledge, dict):
        return set()
    result: set[str] = set()
    for source in knowledge.get("provenance", []):
        if isinstance(source, dict):
            value = source.get("canonicalUri") or source.get("sourceId")
            if isinstance(value, str) and value:
                result.add(value)
    return result


def _shape(knowledge: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(knowledge, dict):
        return {}
    return {
        "claims": [f.get("claimId") for f in knowledge.get("findings", []) if isinstance(f, dict)],
        "sources": sorted(_source_keys(knowledge)),
        "uncertainties": knowledge.get("uncertainties") if isinstance(knowledge.get("uncertainties"), list) else None,
        "truthAssessments": knowledge.get("truthAssessmentIds") if isinstance(knowledge.get("truthAssessmentIds"), list) else None,
    }


def _consumed_reference(continuity: dict[str, Any], message: str, knowledge_id: str | None) -> dict[str, Any] | None:
    if not knowledge_id:
        return None
    message_id = next((
        item.get("id")
        for item in continuity.get("messages", [])
        if isinstance(item, dict) and item.get("role") == "USER" and item.get("content") == message
    ), None)
    if not message_id:
        return None
    for reference in continuity.get("conversationReferences", []):
        if not isinstance(reference, dict) or reference.get("userMessageId") != message_id:
            continue
        if any(
            isinstance(target, dict)
            and target.get("kind") == "KNOWLEDGE"
            and target.get("targetId") == knowledge_id
            and target.get("relation") == "CONSUMED"
            for target in reference.get("targets", [])
        ):
            return reference
    return None


def _save(evidence: dict[str, Any]) -> None:
    encoded = json.dumps(evidence, ensure_ascii=False, indent=2)
    if OWNER_TOKEN and OWNER_TOKEN in encoded:
        raise RuntimeError("SECRET_LEAK: owner token entered validation evidence")
    EVIDENCE_PATH.write_text(encoded + "\n", encoding="utf-8")


def main() -> None:
    evidence: dict[str, Any] = {
        "targetDeployment": BASE_URL,
        "productParentSha": PRODUCT_PARENT_SHA,
        "expectedDeployedSha": EXPECTED_DEPLOYED_SHA,
        "questions": [TURN_1, TURN_2, TURN_3, TURN_4],
        "infrastructure": {},
        "turns": [],
        "claims": {},
    }
    error: Exception | None = None
    try:
        if BASE_URL != TARGET_URL:
            raise RuntimeError(f"TARGET_MISMATCH: expected {TARGET_URL}, got {BASE_URL}")
        if not OWNER_TOKEN:
            raise RuntimeError("AUTH_CONFIGURATION_MISMATCH: LATTICE_OWNER_ACCESS_TOKEN secret is not configured")
        if not PRODUCT_PARENT_SHA or not EXPECTED_DEPLOYED_SHA:
            raise RuntimeError("EVIDENCE_IDENTITY_MISSING: Product parent/deployed SHA is missing")

        evidence["infrastructure"]["healthStatus"] = _wake_service()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            page = context.new_page()
            try:
                evidence["infrastructure"]["authentication"] = _authenticate(page)
                created = _owner_api(page, "POST", "/api/v1/conversations", {})
                if created["status"] != 201 or not isinstance(created.get("body"), dict):
                    raise RuntimeError(f"CONVERSATION_CREATE_FAILED: HTTP {created['status']}")
                conversation = created["body"].get("conversation")
                if not isinstance(conversation, dict) or not isinstance(conversation.get("id"), str):
                    raise RuntimeError("CONVERSATION_CREATE_FAILED: no public conversation id")
                conversation_id = conversation["id"]
                evidence["conversationId"] = conversation_id

                previous = _continuity(page, conversation_id)
                initial_knowledge_id: str | None = None
                for index, message in enumerate((TURN_1, TURN_2, TURN_3, TURN_4), start=1):
                    turn = _submit(page, conversation_id, message)
                    current = _continuity(page, conversation_id)
                    turn["acquisitionDelta"] = _delta(previous, current)
                    turn["continuityAfter"] = current
                    if index == 1:
                        initial_knowledge_id = _run_knowledge_id(turn)
                        if initial_knowledge_id is None:
                            candidates = turn["acquisitionDelta"]["newKnowledgeIds"]
                            initial_knowledge_id = candidates[0] if len(candidates) == 1 else None
                    else:
                        turn["resolvedKnowledgeId"] = _knowledge_reference(turn["response"])
                        turn["consumedReference"] = _consumed_reference(current, message, initial_knowledge_id)
                    turn["initialKnowledgeId"] = initial_knowledge_id
                    evidence["turns"].append(turn)
                    previous = current

                turn1, turn2, turn3, turn4 = evidence["turns"]
                outcome1 = _run_outcome(turn1)
                turn2_body = turn2["response"].get("body") if isinstance(turn2["response"].get("body"), dict) else {}
                turn3_body = turn3["response"].get("body") if isinstance(turn3["response"].get("body"), dict) else {}
                knowledge2 = turn2_body.get("knowledge") if isinstance(turn2_body.get("knowledge"), dict) else None
                knowledge3 = turn3_body.get("knowledge") if isinstance(turn3_body.get("knowledge"), dict) else None

                findings = outcome1.get("findings", []) if isinstance(outcome1, dict) else []
                turn1_governed = isinstance(outcome1, dict) and outcome1.get("kind") == "KNOWLEDGE" and bool(initial_knowledge_id)
                turn1_provenance = bool(_source_keys(outcome1)) and any(
                    isinstance(finding, dict) and bool(finding.get("evidenceIds")) for finding in findings
                )
                uncertainty_observable = isinstance(outcome1, dict) and isinstance(outcome1.get("uncertainties"), list)

                def exact_reuse(turn: dict[str, Any]) -> bool:
                    return (
                        bool(initial_knowledge_id)
                        and turn.get("resolvedKnowledgeId") == initial_knowledge_id
                        and turn.get("consumedReference") is not None
                        and turn["acquisitionDelta"]["classification"] == "NO_NEW_ACQUISITION_VISIBLE"
                    )

                sources_match = bool(_source_keys(outcome1)) and _source_keys(knowledge2) == _source_keys(outcome1)
                simplification_fidelity = bool(_shape(outcome1)) and _shape(knowledge3) == _shape(outcome1)
                turn4_no_new = turn4["acquisitionDelta"]["classification"] == "NO_NEW_ACQUISITION_VISIBLE"
                turn4_structural = turn4_no_new and (
                    turn4.get("resolvedKnowledgeId") == initial_knowledge_id or turn4.get("consumedReference") is not None
                )

                evidence["claims"] = {
                    "harnessExecuted": "PASS",
                    "deploymentHealth": "PASS",
                    "authentication": "PASS",
                    "turn1GovernedKnowledge": "PASS" if turn1_governed else "FAIL",
                    "turn1Provenance": "PASS" if turn1_provenance else "FAIL",
                    "turn1UncertaintyState": "PASS" if uncertainty_observable else "FAIL",
                    "turn2ExactHistoricalReuse": "PASS" if exact_reuse(turn2) else "FAIL",
                    "turn2HistoricalSourcesMatch": "PASS" if sources_match else "FAIL",
                    "turn3ExactHistoricalReuse": "PASS" if exact_reuse(turn3) else "FAIL",
                    "turn3GovernedStateFidelity": "PASS" if simplification_fidelity else "FAIL",
                    "turn4NoNewAcquisitionVisible": "PASS" if turn4_no_new else "FAIL",
                    "turn4ExactStructuralReuse": "PASS" if turn4_structural else "UNKNOWN",
                }
                evidence["selectiveKnowledgeResult"] = {
                    "initialKnowledgeId": initial_knowledge_id,
                    "turn1KnowledgeShape": _shape(outcome1),
                    "turn2Acquisition": turn2["acquisitionDelta"],
                    "turn3Acquisition": turn3["acquisitionDelta"],
                    "turn4Acquisition": turn4["acquisitionDelta"],
                }
            finally:
                context.close()
                browser.close()
    except Exception as caught:
        error = caught
        evidence["error"] = {"type": caught.__class__.__name__, "message": str(caught)}
        if str(caught).startswith("AUTH_CONFIGURATION_MISMATCH"):
            evidence["claims"]["authentication"] = "FAIL"
        evidence["claims"].setdefault("harnessExecuted", "PARTIAL")
    finally:
        _save(evidence)

    print(f"VALIDATION_TARGET={BASE_URL}")
    print(f"PRODUCT_PARENT_SHA={PRODUCT_PARENT_SHA}")
    print(f"EXPECTED_DEPLOYED_SHA={EXPECTED_DEPLOYED_SHA}")
    if evidence.get("error"):
        print(f"VALIDATION_ERROR={evidence['error']['message']}")
    for name, value in evidence["claims"].items():
        print(f"CLAIM_{name.upper()}={value}")
    for index, turn in enumerate(evidence.get("turns", []), start=1):
        response = turn.get("response", {})
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        print(
            f"TURN_{index}_RESULT http={response.get('status')} status={body.get('status')} "
            f"knowledge={turn.get('resolvedKnowledgeId') or turn.get('initialKnowledgeId')} "
            f"acquisition={turn.get('acquisitionDelta', {}).get('classification')}"
        )
    print(f"EVIDENCE_PATH={EVIDENCE_PATH}")
    if error:
        raise error
    print("ISSUE91_DEPLOYED_GOVERNED_KNOWLEDGE_CAMPAIGN=COMPLETED")


if __name__ == "__main__":
    main()
