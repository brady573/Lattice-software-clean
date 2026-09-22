from __future__ import annotations

import json
from typing import Any

HISTORICAL_PROFILE = "historical-canaries"
BASELINE_PROFILE = "baseline"
VALIDATION_PROFILES = (BASELINE_PROFILE, HISTORICAL_PROFILE)

_CASE_FIELDS: dict[str, tuple[str, ...]] = {
    "19": ("seed", "follow_up"),
    "20": ("seed", "follow_up"),
    "44": ("prompt",),
    "47": ("seed", "follow_up"),
}


def parse_historical_cases(raw: str) -> dict[str, dict[str, str]]:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("historical_cases_json is required for the historical-canaries profile")
    try:
        value: Any = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("historical_cases_json must be valid JSON") from error
    if not isinstance(value, dict):
        raise ValueError("historical_cases_json must be a JSON object")

    if set(value) != set(_CASE_FIELDS):
        raise ValueError("historical_cases_json must contain exactly cases 19, 20, 44, and 47")

    normalized: dict[str, dict[str, str]] = {}
    for case_id, fields in _CASE_FIELDS.items():
        case = value.get(case_id)
        if not isinstance(case, dict) or set(case) != set(fields):
            expected = ", ".join(fields)
            raise ValueError(f"case {case_id} must contain exactly: {expected}")
        normalized_case: dict[str, str] = {}
        for field in fields:
            item = case.get(field)
            if not isinstance(item, str) or not item.strip():
                raise ValueError(f"case {case_id} field {field} must be a non-empty string")
            normalized_case[field] = item
        normalized[case_id] = normalized_case
    return normalized
