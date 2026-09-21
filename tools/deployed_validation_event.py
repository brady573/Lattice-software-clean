from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from typing import Any, Callable, Mapping
import urllib.error
import urllib.request

CANONICAL_VALIDATOR_TARGET = "https://lattice-solandra-validation.onrender.com"
PREVIEW_TARGET_RE = re.compile(
    r"^https://lattice-solandra-validation-pr-([1-9][0-9]*)\.onrender\.com/?$"
)
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EVIDENCE_BINDING_NOT_REQUESTED = "NOT_REQUESTED"
EVIDENCE_BINDING_REVISION_BOUND = "REVISION_BOUND"
EVIDENCE_BINDING_UNBOUND_DIAGNOSTIC = "UNBOUND_DIAGNOSTIC"


@dataclass(frozen=True)
class ValidationRequest:
    should_run: bool
    product_target: str = ""
    target_kind: str = ""
    owner_auth_enabled: bool = False
    expected_sha: str = ""
    pr_number: str = ""
    skip_reason: str = ""
    evidence_binding: str = EVIDENCE_BINDING_NOT_REQUESTED


def _skip(reason: str, *, product_target: str = "", pr_number: str = "", expected_sha: str = "") -> ValidationRequest:
    return ValidationRequest(
        should_run=False,
        product_target=product_target,
        target_kind="validator-pr-preview" if product_target else "",
        owner_auth_enabled=False,
        expected_sha=expected_sha,
        pr_number=pr_number,
        skip_reason=reason,
        evidence_binding=EVIDENCE_BINDING_NOT_REQUESTED,
    )


def _manual_target(value: str) -> tuple[str, str, str]:
    target = value[:-1] if value.endswith("/") else value
    if target == CANONICAL_VALIDATOR_TARGET:
        return target, "canonical-validator", ""
    match = PREVIEW_TARGET_RE.fullmatch(target)
    if match is not None:
        return target, "validator-pr-preview", match.group(1)
    raise ValueError("manual Product target is not in the deployed-validation allowlist")


def resolve_manual(product_target: str, run_owner_auth: bool) -> ValidationRequest:
    target, kind, pr_number = _manual_target(product_target)
    return ValidationRequest(
        should_run=True,
        product_target=target,
        target_kind=kind,
        owner_auth_enabled=run_owner_auth,
        expected_sha="",
        pr_number=pr_number,
        evidence_binding=EVIDENCE_BINDING_UNBOUND_DIAGNOSTIC,
    )


def resolve_deployment_status(
    event: Mapping[str, Any],
    get_pull_request: Callable[[int], Mapping[str, Any] | None],
) -> ValidationRequest:
    deployment_status = event.get("deployment_status")
    deployment = event.get("deployment")
    if not isinstance(deployment_status, Mapping) or not isinstance(deployment, Mapping):
        return _skip("deployment event is missing deployment/status metadata")

    state = deployment_status.get("state")
    if state != "success":
        return _skip("deployment status is not success")

    environment_url = deployment_status.get("environment_url")
    if not isinstance(environment_url, str):
        return _skip("deployment status is missing environment_url")
    match = PREVIEW_TARGET_RE.fullmatch(environment_url)
    if match is None:
        return _skip("deployment environment_url is not an approved PR preview")

    target = environment_url[:-1] if environment_url.endswith("/") else environment_url
    pr_number_text = match.group(1)
    deployment_sha = deployment.get("sha")
    if not isinstance(deployment_sha, str) or SHA_RE.fullmatch(deployment_sha) is None:
        return _skip(
            "deployment is missing a full commit SHA",
            product_target=target,
            pr_number=pr_number_text,
        )

    pr = get_pull_request(int(pr_number_text))
    if pr is None:
        return _skip(
            "preview PR does not exist",
            product_target=target,
            pr_number=pr_number_text,
            expected_sha=deployment_sha,
        )
    if pr.get("state") != "open":
        return _skip(
            "preview PR is not open",
            product_target=target,
            pr_number=pr_number_text,
            expected_sha=deployment_sha,
        )

    head = pr.get("head")
    head_sha = head.get("sha") if isinstance(head, Mapping) else None
    if not isinstance(head_sha, str) or SHA_RE.fullmatch(head_sha) is None:
        return _skip(
            "preview PR head SHA is unavailable",
            product_target=target,
            pr_number=pr_number_text,
            expected_sha=deployment_sha,
        )
    if deployment_sha != head_sha:
        return _skip(
            "deployment SHA does not match current PR head SHA",
            product_target=target,
            pr_number=pr_number_text,
            expected_sha=deployment_sha,
        )

    return ValidationRequest(
        should_run=True,
        product_target=target,
        target_kind="validator-pr-preview",
        owner_auth_enabled=False,
        expected_sha=deployment_sha,
        pr_number=pr_number_text,
        evidence_binding=EVIDENCE_BINDING_REVISION_BOUND,
    )


def _parse_bool(value: str) -> bool:
    lowered = value.casefold()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    raise ValueError("run_owner_auth must be true or false")


def _fetch_pull_request(
    repository: str,
    pr_number: int,
    token: str,
    api_url: str,
) -> Mapping[str, Any] | None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise RuntimeError("GITHUB_REPOSITORY is invalid")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required for deployment-status PR verification")
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/repos/{repository}/pulls/{pr_number}",
        method="GET",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "lattice-deployed-validation-resolver/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise RuntimeError(f"GitHub PR lookup failed with HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("GitHub PR lookup failed") from error
    if not isinstance(body, Mapping):
        raise RuntimeError("GitHub PR lookup returned a non-object response")
    return body


def _write_outputs(request: ValidationRequest, output_path: str) -> None:
    values = {
        "should_run": "true" if request.should_run else "false",
        "product_target": request.product_target,
        "target_kind": request.target_kind,
        "owner_auth_enabled": "true" if request.owner_auth_enabled else "false",
        "expected_sha": request.expected_sha,
        "pr_number": request.pr_number,
        "skip_reason": request.skip_reason,
        "evidence_binding": request.evidence_binding,
    }
    with Path(output_path).open("a", encoding="utf-8") as handle:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise RuntimeError(f"workflow output {key} contains a newline")
            handle.write(f"{key}={value}\n")


def main() -> int:
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    if event_name == "workflow_dispatch":
        request = resolve_manual(
            os.environ.get("MANUAL_PRODUCT_TARGET", ""),
            _parse_bool(os.environ.get("MANUAL_RUN_OWNER_AUTH", "")),
        )
        print(
            "MANUAL_PRODUCT_VALIDATION=ELIGIBLE "
            f"kind={request.target_kind} target={request.product_target} "
            f"owner_auth={str(request.owner_auth_enabled).lower()} "
            f"evidence_binding={request.evidence_binding}"
        )
    elif event_name == "deployment_status":
        event_path = os.environ.get("GITHUB_EVENT_PATH", "")
        if not event_path:
            raise RuntimeError("GITHUB_EVENT_PATH is required for deployment_status")
        with Path(event_path).open("r", encoding="utf-8") as handle:
            event = json.load(handle)
        if not isinstance(event, Mapping):
            raise RuntimeError("deployment_status event payload must be a JSON object")
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        token = os.environ.get("GITHUB_TOKEN", "")
        api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com")
        request = resolve_deployment_status(
            event,
            lambda pr_number: _fetch_pull_request(repository, pr_number, token, api_url),
        )
        if request.should_run:
            print(
                "AUTOMATIC_PRODUCT_VALIDATION=ELIGIBLE "
                f"pr={request.pr_number} sha={request.expected_sha} target={request.product_target} "
                f"evidence_binding={request.evidence_binding}"
            )
        else:
            print(
                "AUTOMATIC_PRODUCT_VALIDATION=SKIP_NOT_REQUESTED "
                f"reason={request.skip_reason}"
            )
    else:
        raise RuntimeError(f"unsupported workflow event {event_name!r}")

    output_path = os.environ.get("GITHUB_OUTPUT", "")
    if not output_path:
        raise RuntimeError("GITHUB_OUTPUT is required")
    _write_outputs(request, output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
