from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from tools.deployed_validation_event import (
    CANONICAL_VALIDATOR_TARGET,
    resolve_deployment_status,
    resolve_manual,
)

DEPLOYED_SHA = "1" * 40
OTHER_SHA = "2" * 40
PREVIEW = "https://lattice-solandra-validation-pr-129.onrender.com"


def _event(
    *,
    state: str = "success",
    environment_url: str = PREVIEW,
    sha: str = DEPLOYED_SHA,
) -> dict[str, Any]:
    return {
        "deployment": {"sha": sha, "ref": "issue-91/example"},
        "deployment_status": {
            "state": state,
            "environment_url": environment_url,
        },
    }


def _open_pr(sha: str = DEPLOYED_SHA) -> dict[str, Any]:
    return {"state": "open", "head": {"sha": sha}}


def _unexpected_lookup(_pr_number: int):
    raise AssertionError("PR lookup must not occur for an ineligible deployment event")


def test_manual_canonical_validator_target_remains_accepted() -> None:
    request = resolve_manual(CANONICAL_VALIDATOR_TARGET, True)
    assert request.should_run
    assert request.product_target == CANONICAL_VALIDATOR_TARGET
    assert request.target_kind == "canonical-validator"
    assert request.owner_auth_enabled is True


def test_manual_pr_preview_target_remains_accepted() -> None:
    request = resolve_manual(f"{PREVIEW}/", False)
    assert request.should_run
    assert request.product_target == PREVIEW
    assert request.target_kind == "validator-pr-preview"
    assert request.pr_number == "129"
    assert request.owner_auth_enabled is False


def test_successful_deployment_status_resolves_preview_pr_number() -> None:
    request = resolve_deployment_status(_event(), lambda pr: _open_pr() if pr == 129 else None)
    assert request.should_run
    assert request.pr_number == "129"
    assert request.product_target == PREVIEW
    assert request.target_kind == "validator-pr-preview"


def test_automatic_preview_forces_owner_auth_off() -> None:
    request = resolve_deployment_status(_event(), lambda _pr: _open_pr())
    assert request.should_run
    assert request.owner_auth_enabled is False


def test_matching_deployment_sha_and_open_pr_head_is_eligible() -> None:
    request = resolve_deployment_status(_event(), lambda _pr: _open_pr())
    assert request.should_run
    assert request.expected_sha == DEPLOYED_SHA


def test_stale_deployment_sha_is_a_clean_skip() -> None:
    request = resolve_deployment_status(_event(), lambda _pr: _open_pr(OTHER_SHA))
    assert request.should_run is False
    assert "does not match current PR head SHA" in request.skip_reason


def test_closed_pr_is_a_clean_skip() -> None:
    request = resolve_deployment_status(
        _event(),
        lambda _pr: {"state": "closed", "head": {"sha": DEPLOYED_SHA}},
    )
    assert request.should_run is False
    assert request.skip_reason == "preview PR is not open"


@pytest.mark.parametrize(
    "url",
    [
        "https://lattice-solandra-validation-pr-0.onrender.com",
        "https://lattice-solandra-validation-pr-129.onrender.com/extra",
        "https://lattice-solandra-validation-pr-129.onrender.com?x=1",
        "http://lattice-solandra-validation-pr-129.onrender.com",
        "https://lattice-solandra-validation-pr-129.onrender.com.evil.example",
    ],
)
def test_malformed_preview_url_is_a_clean_skip(url: str) -> None:
    request = resolve_deployment_status(_event(environment_url=url), _unexpected_lookup)
    assert request.should_run is False
    assert request.skip_reason == "deployment environment_url is not an approved PR preview"


def test_canonical_owner_deployment_is_not_automatic() -> None:
    request = resolve_deployment_status(
        _event(environment_url="https://lattice-solandra.onrender.com"),
        _unexpected_lookup,
    )
    assert request.should_run is False


def test_canonical_validator_deployment_is_not_automatic() -> None:
    request = resolve_deployment_status(
        _event(environment_url=CANONICAL_VALIDATOR_TARGET),
        _unexpected_lookup,
    )
    assert request.should_run is False


@pytest.mark.parametrize(
    "url",
    [
        "https://another-service.onrender.com",
        "https://lattice-solandra-validation-pr-129.example.com",
        "https://example.com",
    ],
)
def test_unrelated_render_or_other_domain_is_not_automatic(url: str) -> None:
    request = resolve_deployment_status(_event(environment_url=url), _unexpected_lookup)
    assert request.should_run is False


@pytest.mark.parametrize("state", ["queued", "in_progress", "pending", "failure", "error", "inactive"])
def test_non_success_deployment_status_never_runs_product_journey(state: str) -> None:
    request = resolve_deployment_status(_event(state=state), _unexpected_lookup)
    assert request.should_run is False
    assert request.skip_reason == "deployment status is not success"


@pytest.mark.parametrize(
    "event",
    [
        {},
        {"deployment": {"sha": DEPLOYED_SHA}},
        {"deployment_status": {"state": "success", "environment_url": PREVIEW}},
        {"deployment": {"sha": DEPLOYED_SHA}, "deployment_status": {"state": "success"}},
        {"deployment": {}, "deployment_status": {"state": "success", "environment_url": PREVIEW}},
    ],
)
def test_missing_deployment_or_environment_fields_never_guess(event: dict[str, Any]) -> None:
    request = resolve_deployment_status(event, _unexpected_lookup)
    assert request.should_run is False


def test_missing_pr_is_a_clean_skip() -> None:
    request = resolve_deployment_status(_event(), lambda _pr: None)
    assert request.should_run is False
    assert request.skip_reason == "preview PR does not exist"


def test_missing_pr_head_sha_is_a_clean_skip() -> None:
    request = resolve_deployment_status(_event(), lambda _pr: {"state": "open", "head": {}})
    assert request.should_run is False
    assert request.skip_reason == "preview PR head SHA is unavailable"


def test_automatic_workflow_cannot_receive_owner_token() -> None:
    request = resolve_deployment_status(_event(), lambda _pr: _open_pr())
    assert request.owner_auth_enabled is False

    workflow = Path(".github/workflows/deployed-functional-validation.yml").read_text(encoding="utf-8")
    owner_secret_lines = [
        line for line in workflow.splitlines() if "LATTICE_OWNER_ACCESS_TOKEN: ${{ secrets.LATTICE_OWNER_ACCESS_TOKEN }}" in line
    ]
    assert len(owner_secret_lines) == 2
    assert all(line.startswith("          LATTICE_OWNER_ACCESS_TOKEN:") for line in owner_secret_lines)
    assert workflow.count("github.event_name == 'workflow_dispatch' && steps.resolve.outputs.owner_auth_enabled == 'true'") == 2
    assert "test -z \"${LATTICE_OWNER_ACCESS_TOKEN+x}\"" in workflow


def test_workflow_rechecks_sha_immediately_before_automatic_product_journey() -> None:
    workflow = Path(".github/workflows/deployed-functional-validation.yml").read_text(encoding="utf-8")
    assert "name: Revalidate automatic preview revision" in workflow
    assert "steps.freshness.outputs.should_run == 'true'" in workflow
    assert "ref: ${{ github.workflow_sha }}" in workflow


def test_concurrency_is_scoped_by_preview_url_and_cancels_only_automatic_runs() -> None:
    workflow = Path(".github/workflows/deployed-functional-validation.yml").read_text(encoding="utf-8")
    assert "github.event.deployment_status.environment_url" in workflow
    assert "cancel-in-progress: ${{ github.event_name == 'deployment_status' }}" in workflow
