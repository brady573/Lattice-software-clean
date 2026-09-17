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
        headers={"User-Agent": "lattice-issue91-governed-knowledge-validator/1.0"},
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
    raise RuntimeError("validation deployment did not become healthy within bounded wake window")


def _api(page, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
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
            return {
                status: response.status,
                ok: response.ok,
                body,
                text: body === null ? text.slice(0, 6000) : null,
            };
        }""",
        [method, path, payload],
    )
    encoded = json.dumps(result, ensure_ascii=False)
    if OWNER_TOKEN and OWNER_TOKEN in encoded:
        raise RuntimeError("owner token unexpectedly appeared in Product API response")
    return result


def _authenticate(page) -> dict[str, Any]:
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=60_000)
    gate = page.locator("#ownerAccessGate")
    gate.wait_for(state="visible", timeout=20_000)
    page.locator("#ownerAccessInput").fill(OWNER_TOKEN)
    with page.expect_navigation(wait_until="domcontentloaded", timeout=30_000):
        page.locator("#ownerAccessSubmit").click()
    gate.wait_for(state="hidden", timeout=20_000)
    stored = page.evaluate("key => window.sessionStorage.getItem(key)", STORAGE_KEY)
    if stored != OWNER_TOKEN:
        raise RuntimeError("existing owner secret did not establish the normal session authentication state")
    if OWNER_TOKEN in page.url or OWNER_TOKEN in page.content():
        raise RuntimeError("owner token leaked into rendered Product state")
    probe = _api(page, "GET", "/api/v1/capabilities/model-assistance")
    if probe["status"] != 200:
        raise RuntimeError(f"existing owner secret was not authorized by validation deployment: HTTP {probe['status']}")
    return {"ownerGate": "AUTHORIZED", "authenticatedProbeStatus": probe["status"]}


def _wait_run(page, run_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 240
    observations: list[dict[str, Any]] = []
    last_status = None
    while time.monotonic() <= deadline:
        response = _api(page, "GET", f"/api/v1/runs/{run_id}")
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        status = body.get("status")
        if status != last_status:
            observations.append({"httpStatus": response["status"], "runStatus": status})
            last_status = status
        if response["status"] == 200 and status in {"COMPLETED", "FAILED", "CANCELLED"}:
            outcome = _api(page, "GET", f"/api/v1/runs/{run_id}/outcome") if status == "COMPLETED" else None
            return {
                "runId": run_id,
                "terminalStatus": status,
                "observations": observations,
                "outcomeResponse": outcome,
            }
        time.sleep(2)
    return {"runId": run_id, "terminalStatus": "TIMEOUT", "observations": observations, "outcomeResponse": None}


def _continuity(page, conversation_id: str) -> dict[str, Any]:
    response = _api(page, "GET", f"/api/v1/conversations/{conversation_id}/continuity")
    if response["status"] != 200 or not isinstance(response.get("body"), dict):
        raise RuntimeError(f"continuity endpoint unavailable: HTTP {response['status']}")
    return response["body"]


def _ids(continuity: dict[str, Any], key: str, id_key: str) -> set[str]:
    values = continuity.get(key)
    if not isinstance(values, list):
        return set()
    return {
        str(item[id_key])
        for item in values
        if isinstance(item, dict) and item.get(id_key) is not None
    }


def _reference_for_message(
    continuity: dict[str, Any],
    message: str,
    knowledge_id: str | None,
) -> dict[str, Any] | None:
    if not knowledge_id:
        return None
    user_message_id = None
    for item in continuity.get("messages", []):
        if isinstance(item, dict) and item.get("role") == "USER" and item.get("content") == message:
            user_message_id = item.get("id")
    if not user_message_id:
        return None
    for reference in continuity.get("conversationReferences", []):
        if not isinstance(reference, dict) or reference.get("userMessageId") != user_message_id:
            continue
        for target in reference.get("targets", []):
            if (
                isinstance(target, dict)
                and target.get("kind") == "KNOWLEDGE"
                and target.get("targetId") == knowledge_id
                and target.get("relation") == "CONSUMED"
            ):
                return reference
    return None


def _acquisition_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_runs = _ids(before, "runs", "runId")
    after_runs = _ids(after, "runs", "runId")
    before_knowledge = _ids(before, "knowledge", "knowledgeId")
    after_knowledge = _ids(after, "knowledge", "knowledgeId")
    new_runs = sorted(after_runs - before_runs)
    new_knowledge = sorted(after_knowledge - before_knowledge)
    if new_knowledge:
        classification = "NEW_GOVERNED_KNOWLEDGE_VISIBLE"
    elif new_runs:
        classification = "NEW_RUN_WITHOUT_NEW_KNOWLEDGE_VISIBLE"
    else:
        classification = "NO_NEW_ACQUISITION_VISIBLE"
    return {"newRunIds": new_runs, "newKnowledgeIds": new_knowledge, "classification": classification}


def _response_knowledge_id(response: dict[str, Any]) -> str | None:
    body = response.get("body")
    if not isinstance(body, dict):
        return None
    reference = body.get("knowledgeReference")
    if isinstance(reference, dict) and isinstance(reference.get("knowledgeId"), str):
        return reference["knowledgeId"]
    return None


def _run_outcome(run: dict[str, Any] | None) -> dict[str, Any] | None:
    if not run:
        return None
    response = run.get("outcomeResponse")
    if not isinstance(response, dict):
        return None
    body = response.get("body")
    if not isinstance(body, dict):
        return None
    outcome = body.get("outcome")
    return outcome if isinstance(outcome, dict) else None


def _outcome_knowledge_id(run: dict[str, Any] | None) -> str | None:
    if not run:
        return None
    response = run.get("outcomeResponse")
    if not isinstance(response, dict):
        return None
    return _response_knowledge_id(response)


def _source_keys(knowledge: dict[str, Any] | None) -> set[str]:
    if not isinstance(knowledge, dict):
        return set()
    keys: set[str] = set()
    for source in knowledge.get("provenance", []):
        if not isinstance(source, dict):
            continue
        value = source.get("canonicalUri") or source.get("sourceId")
        if isinstance(value, str) and value:
            keys.add(value)
    return keys


def _knowledge_shape(knowledge: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(knowledge, dict):
        return {}
    return {
        "findingClaimIds": [
            finding.get("claimId")
            for finding in knowledge.get("findings", [])
            if isinstance(finding, dict)
        ],
        "sourceKeys": sorted(_source_keys(knowledge)),
        "uncertainties": knowledge.get("uncertainties") if isinstance(knowledge.get("uncertainties"), list) else None,
        "truthAssessmentIds": knowledge.get("truthAssessmentIds") if isinstance(knowledge.get("truthAssessmentIds"), list) else None,
    }


def _submit_turn(page, conversation_id: str, message: str) -> dict[str, Any]:
    if FORBIDDEN_USER_WORDS.search(message):
        raise RuntimeError(f"validation prompt contains internal machinery vocabulary: {message}")
    response = _api(
        page,
        "POST",
        f"/api/v1/conversations/{conversation_id}/turns",
        {"turnId": str(uuid.uuid4()), "message": message},
    )
    body = response.get("body") if isinstance(response.get("body"), dict) else {}
    run_id = body.get("runId") if isinstance(body.get("runId"), str) else None
    run = _wait_run(page, run_id) if run_id else None
    return {"message": message, "response": response, "run": run}


def _artifact_safe(value: Any) -> Any:
    encoded = json.dumps(value, ensure_ascii=False)
    if OWNER_TOKEN and OWNER_TOKEN in encoded:
        raise RuntimeError("owner token unexpectedly entered validation artifact")
    return value


def main() -> None:
    if BASE_URL != TARGET_URL:
        raise RuntimeError(f"validation target must be {TARGET_URL}, got {BASE_URL}")
    if not OWNER_TOKEN:
        raise RuntimeError("LATTICE_OWNER_ACCESS_TOKEN existing repository secret is not configured")
    if not PRODUCT_PARENT_SHA or not EXPECTED_DEPLOYED_SHA:
        raise RuntimeError("Product parent/deployed SHA evidence identity is missing")

    evidence: dict[str, Any] = {
        "targetDeployment": BASE_URL,
        "productParentSha": PRODUCT_PARENT_SHA,
        "expectedDeployedSha": EXPECTED_DEPLOYED_SHA,
        "questions": [TURN_1, TURN_2, TURN_3, TURN_4],
        "infrastructure": {},
        "turns": [],
        "claims": {},
    }

    health = _wake_service()
    evidence["infrastructure"]["healthStatus"] = health

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        try:
            evidence["infrastructure"]["authentication"] = _authenticate(page)
            created = _api(page, "POST", "/api/v1/conversations", {})
            if created["status"] != 201 or not isinstance(created.get("body"), dict):
                raise RuntimeError(f"conversation creation failed: HTTP {created['status']}")
            conversation = created["body"].get("conversation")
            if not isinstance(conversation, dict) or not isinstance(conversation.get("id"), str):
                raise RuntimeError("conversation creation did not return a public conversation id")
            conversation_id = conversation["id"]
            evidence["conversationId"] = conversation_id

            before_turn1 = _continuity(page, conversation_id)
            turn1 = _submit_turn(page, conversation_id, TURN_1)
            after_turn1 = _continuity(page, conversation_id)
            turn1["continuityAfter"] = after_turn1
            turn1["acquisitionDelta"] = _acquisition_delta(before_turn1, after_turn1)
            initial_knowledge_id = _outcome_knowledge_id(turn1.get("run"))
            if initial_knowledge_id is None:
                candidates = turn1["acquisitionDelta"]["newKnowledgeIds"]
                initial_knowledge_id = candidates[0] if len(candidates) == 1 else None
            turn1["resolvedKnowledgeId"] = initial_knowledge_id
            evidence["turns"].append(turn1)

            before_turn2 = after_turn1
            turn2 = _submit_turn(page, conversation_id, TURN_2)
            after_turn2 = _continuity(page, conversation_id)
            turn2["continuityAfter"] = after_turn2
            turn2["acquisitionDelta"] = _acquisition_delta(before_turn2, after_turn2)
            turn2["resolvedKnowledgeId"] = _response_knowledge_id(turn2["response"])
            turn2["consumedReference"] = _reference_for_message(after_turn2, TURN_2, initial_knowledge_id)
            evidence["turns"].append(turn2)

            before_turn3 = after_turn2
            turn3 = _submit_turn(page, conversation_id, TURN_3)
            after_turn3 = _continuity(page, conversation_id)
            turn3["continuityAfter"] = after_turn3
            turn3["acquisitionDelta"] = _acquisition_delta(before_turn3, after_turn3)
            turn3["resolvedKnowledgeId"] = _response_knowledge_id(turn3["response"])
            turn3["consumedReference"] = _reference_for_message(after_turn3, TURN_3, initial_knowledge_id)
            evidence["turns"].append(turn3)

            before_turn4 = after_turn3
            turn4 = _submit_turn(page, conversation_id, TURN_4)
            after_turn4 = _continuity(page, conversation_id)
            turn4["continuityAfter"] = after_turn4
            turn4["acquisitionDelta"] = _acquisition_delta(before_turn4, after_turn4)
            turn4["resolvedKnowledgeId"] = _response_knowledge_id(turn4["response"])
            turn4["consumedReference"] = _reference_for_message(after_turn4, TURN_4, initial_knowledge_id)
            evidence["turns"].append(turn4)

            turn1_outcome = _run_outcome(turn1.get("run"))
            turn1_shape = _knowledge_shape(turn1_outcome)
            turn2_body = turn2["response"].get("body") if isinstance(turn2["response"].get("body"), dict) else {}
            turn3_body = turn3["response"].get("body") if isinstance(turn3["response"].get("body"), dict) else {}
            turn2_knowledge = turn2_body.get("knowledge") if isinstance(turn2_body.get("knowledge"), dict) else None
            turn3_knowledge = turn3_body.get("knowledge") if isinstance(turn3_body.get("knowledge"), dict) else None

            turn1_governed = (
                isinstance(turn1_outcome, dict)
                and turn1_outcome.get("kind") == "KNOWLEDGE"
                and isinstance(initial_knowledge_id, str)
                and bool(initial_knowledge_id)
            )
            provenance_present = bool(_source_keys(turn1_outcome))
            findings = turn1_outcome.get("findings", []) if isinstance(turn1_outcome, dict) else []
            evidence_links_present = any(
                isinstance(finding, dict) and bool(finding.get("evidenceIds"))
                for finding in findings
            )
            uncertainty_observable = isinstance(turn1_outcome, dict) and isinstance(turn1_outcome.get("uncertainties"), list)

            turn2_same = bool(initial_knowledge_id) and turn2.get("resolvedKnowledgeId") == initial_knowledge_id
            turn2_ref = turn2.get("consumedReference") is not None
            turn2_no_reacq = turn2["acquisitionDelta"]["classification"] == "NO_NEW_ACQUISITION_VISIBLE"
            turn2_sources_match = bool(_source_keys(turn1_outcome)) and _source_keys(turn2_knowledge) == _source_keys(turn1_outcome)

            turn3_same = bool(initial_knowledge_id) and turn3.get("resolvedKnowledgeId") == initial_knowledge_id
            turn3_ref = turn3.get("consumedReference") is not None
            turn3_no_reacq = turn3["acquisitionDelta"]["classification"] == "NO_NEW_ACQUISITION_VISIBLE"
            turn3_shape = _knowledge_shape(turn3_knowledge)
            turn3_fidelity = bool(turn1_shape) and turn3_shape == turn1_shape

            turn4_same_response = bool(initial_knowledge_id) and turn4.get("resolvedKnowledgeId") == initial_knowledge_id
            turn4_ref = turn4.get("consumedReference") is not None
            turn4_no_reacq = turn4["acquisitionDelta"]["classification"] == "NO_NEW_ACQUISITION_VISIBLE"
            turn4_structural_reuse = turn4_no_reacq and (turn4_same_response or turn4_ref)

            evidence["claims"] = {
                "harnessExecuted": "PASS",
                "deploymentHealth": "PASS" if health == 200 else "FAIL",
                "authentication": "PASS",
                "turn1GovernedKnowledge": "PASS" if turn1_governed else "FAIL",
                "turn1Provenance": "PASS" if provenance_present and evidence_links_present else "FAIL",
                "turn1UncertaintyState": "PASS" if uncertainty_observable else "FAIL",
                "turn2ExactHistoricalReuse": "PASS" if turn2_same and turn2_ref and turn2_no_reacq else "FAIL",
                "turn2HistoricalSourcesMatch": "PASS" if turn2_sources_match else "FAIL",
                "turn3ExactHistoricalReuse": "PASS" if turn3_same and turn3_ref and turn3_no_reacq else "FAIL",
                "turn3GovernedStateFidelity": "PASS" if turn3_fidelity else "FAIL",
                "turn4NoNewAcquisitionVisible": "PASS" if turn4_no_reacq else "FAIL",
                "turn4ExactStructuralReuse": "PASS" if turn4_structural_reuse else "UNKNOWN",
            }
            evidence["selectiveKnowledgeResult"] = {
                "initialKnowledgeId": initial_knowledge_id,
                "turn1KnowledgeShape": turn1_shape,
                "turn2Acquisition": turn2["acquisitionDelta"],
                "turn3Acquisition": turn3["acquisitionDelta"],
                "turn4Acquisition": turn4["acquisitionDelta"],
            }
        finally:
            context.close()
            browser.close()

    _artifact_safe(evidence)
    EVIDENCE_PATH.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"VALIDATION_TARGET={BASE_URL}")
    print(f"PRODUCT_PARENT_SHA={PRODUCT_PARENT_SHA}")
    print(f"EXPECTED_DEPLOYED_SHA={EXPECTED_DEPLOYED_SHA}")
    print("OWNER_AUTHENTICATION=PASS")
    for index, turn in enumerate(evidence["turns"], start=1):
        response = turn.get("response", {})
        body = response.get("body") if isinstance(response.get("body"), dict) else {}
        print(
            f"TURN_{index}_RESULT http={response.get('status')} status={body.get('status')} "
            f"knowledge={turn.get('resolvedKnowledgeId')} acquisition={turn.get('acquisitionDelta', {}).get('classification')}"
        )
    for name, value in evidence["claims"].items():
        print(f"CLAIM_{name.upper()}={value}")
    print(f"EVIDENCE_PATH={EVIDENCE_PATH}")
    print("ISSUE91_DEPLOYED_GOVERNED_KNOWLEDGE_CAMPAIGN=COMPLETED")


if __name__ == "__main__":
    main()
