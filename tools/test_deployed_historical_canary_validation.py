from __future__ import annotations

from pathlib import Path
import json

import pytest

from tools.deployed_validation_event import (
    CANONICAL_VALIDATOR_TARGET,
    resolve_deployment_status,
    resolve_manual,
)
from tools.historical_canary_schema import parse_historical_cases
import tools.deployed_historical_canary_validation as historical


PREVIEW = "https://lattice-solandra-validation-pr-129.onrender.com"
DEPLOYED_SHA = "1" * 40


def _cases() -> dict[str, dict[str, str]]:
    return {
        "19": {"seed": "alpha seed", "follow_up": "alpha follow-up"},
        "20": {"seed": "beta seed", "follow_up": "beta follow-up"},
        "44": {"prompt": "gamma prompt"},
        "47": {"seed": "delta seed", "follow_up": "delta follow-up"},
    }


def _cases_json() -> str:
    return json.dumps(_cases(), separators=(",", ":"))


def test_historical_case_schema_preserves_dispatch_wording_exactly() -> None:
    cases = _cases()
    parsed = parse_historical_cases(json.dumps(cases))
    assert parsed == cases


@pytest.mark.parametrize(
    "value",
    [
        "",
        "{}",
        json.dumps({"19": {"seed": "only", "follow_up": "two"}}),
        json.dumps({
            "19": {"seed": "a", "follow_up": "b", "extra": "c"},
            "20": {"seed": "d", "follow_up": "e"},
            "44": {"prompt": "f"},
            "47": {"seed": "g", "follow_up": "h"},
        }),
    ],
)
def test_historical_case_schema_rejects_missing_or_extra_structure(value: str) -> None:
    with pytest.raises(ValueError):
        parse_historical_cases(value)


def test_manual_historical_profile_requires_canonical_validator_and_owner_auth_off() -> None:
    request = resolve_manual(
        CANONICAL_VALIDATOR_TARGET,
        False,
        "historical-canaries",
        _cases_json(),
    )
    assert request.should_run
    assert request.validation_profile == "historical-canaries"
    assert request.target_kind == "canonical-validator"
    assert request.owner_auth_enabled is False

    with pytest.raises(ValueError, match="run_owner_auth=false"):
        resolve_manual(
            CANONICAL_VALIDATOR_TARGET,
            True,
            "historical-canaries",
            _cases_json(),
        )

    with pytest.raises(ValueError, match="canonical validator"):
        resolve_manual(
            PREVIEW,
            False,
            "historical-canaries",
            _cases_json(),
        )


def test_baseline_profile_remains_default_and_rejects_unused_historical_cases() -> None:
    request = resolve_manual(CANONICAL_VALIDATOR_TARGET, True)
    assert request.validation_profile == "baseline"
    assert request.owner_auth_enabled is True

    with pytest.raises(ValueError, match="only valid"):
        resolve_manual(CANONICAL_VALIDATOR_TARGET, False, "baseline", _cases_json())


def test_automatic_preview_remains_baseline_and_owner_auth_off() -> None:
    event = {
        "deployment": {"sha": DEPLOYED_SHA, "ref": "example"},
        "deployment_status": {
            "state": "success",
            "environment_url": PREVIEW,
        },
    }
    request = resolve_deployment_status(
        event,
        lambda _pr: {"state": "open", "head": {"sha": DEPLOYED_SHA}},
    )
    assert request.should_run
    assert request.validation_profile == "baseline"
    assert request.owner_auth_enabled is False


def test_reference_capture_selects_exact_target_and_user_turn() -> None:
    continuity = {
        "body": {
            "conversationReferences": [
                {
                    "referenceId": "produced",
                    "userMessageId": "seed",
                    "targets": [
                        {"kind": "KNOWLEDGE", "targetId": "k1", "relation": "PRODUCED"},
                    ],
                },
                {
                    "referenceId": "consumed",
                    "userMessageId": "follow",
                    "parentReferenceId": "produced",
                    "targets": [
                        {"kind": "KNOWLEDGE", "targetId": "k1", "relation": "CONSUMED"},
                    ],
                },
            ]
        }
    }
    matched = historical._references(
        continuity,
        kind="KNOWLEDGE",
        target_id="k1",
        relation="CONSUMED",
        user_message_id="follow",
    )
    assert [item["referenceId"] for item in matched] == ["consumed"]


def test_workflow_keeps_baseline_automatic_behavior_and_isolates_historical_owner_credentials() -> None:
    workflow = Path(".github/workflows/deployed-functional-validation.yml").read_text(encoding="utf-8")
    assert "validation_profile:" in workflow
    assert "historical_cases_json:" in workflow
    assert "validator_deploy_id_before:" in workflow
    assert "steps.resolve.outputs.validation_profile == 'baseline'" in workflow
    assert "steps.freshness.outputs.should_run == 'true'" in workflow
    assert "cancel-in-progress: ${{ github.event_name == 'deployment_status' }}" in workflow

    historical_step = workflow.split("- name: Run historical user-facing canaries", 1)[1].split(
        "- name: Upload historical canary evidence",
        1,
    )[0]
    assert "github.event_name == 'workflow_dispatch'" in historical_step
    assert "steps.resolve.outputs.validation_profile == 'historical-canaries'" in historical_step
    assert "test -z \"${LATTICE_OWNER_ACCESS_TOKEN+x}\"" in historical_step
    assert "secrets.LATTICE_OWNER_ACCESS_TOKEN" not in historical_step
    assert "tools/deployed_historical_canary_validation.py" in historical_step
    assert "VALIDATOR_DEPLOY_ID_BEFORE: ${{ inputs.validator_deploy_id_before }}" in historical_step

    upload_step = workflow.split("- name: Upload historical canary evidence", 1)[1]
    assert "always()" in upload_step
    assert "test-results/historical-canaries/" in upload_step


def test_fresh_canary_wording_is_not_embedded_in_validator_source() -> None:
    source = Path("tools/deployed_historical_canary_validation.py").read_text(encoding="utf-8")
    schema = Path("tools/historical_canary_schema.py").read_text(encoding="utf-8")
    combined = source + "\n" + schema
    for phrase in (
        "bathroom mirrors",
        "sliced apple",
        "quarter of an hour",
        "thermos",
    ):
        assert phrase not in combined.casefold()
