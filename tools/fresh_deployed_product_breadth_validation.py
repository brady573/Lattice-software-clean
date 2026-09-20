from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from playwright.sync_api import Page

from tools.deployed_product_journey_validation import (
    _assistant_text,
    _connect_cognitive_assistance_if_available,
    _final_product_body,
    _open_product_surface,
    _restore_cognitive_assistance,
    _submit_turn,
)

KNOWLEDGE_PROMPT = (
    "I'm applying for a U.S. passport this week. What are the current routine and expedited "
    "processing times, and when were those estimates last updated? Please check reliable current sources."
)
FOLLOWUP_PROMPT = (
    "What sources are you relying on for those timing estimates, and what's the biggest uncertainty "
    "I should keep in mind?"
)
DECISION_PROMPT = (
    "Switching topics: I'm choosing between a heat-pump dryer and a standard vented electric dryer "
    "for a small condo. I care most about low energy use and avoiding new venting work; drying speed "
    "matters less. Which fits better, and what am I giving up?"
)
AMBIGUITY_PROMPT = "I also want the cheaper one. Does that change your recommendation?"
RETURN_PROMPT = (
    "Back to the passport timing: if I were traveling in seven weeks, how would you frame the risk now?"
)

_INTERNAL_MACHINERY = re.compile(
    r"\b(?:workerId|runId|queue|provider routing|V36|Decision Engine|research worker|retry epoch)\b",
    re.I,
)


def _links_from_latest_solandra_turn(page: Page) -> list[dict[str, str]]:
    links = page.locator("#conversation .turn.solandra").last.locator("a")
    raw = links.evaluate_all(
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


def _record_stage(page: Page, label: str, prompt: str, evidence: list[dict[str, Any]]) -> None:
    result = _submit_turn(page, prompt, label)
    visible = _assistant_text(result)
    final_body = _final_product_body(result)
    links = _links_from_latest_solandra_turn(page)

    assert visible, f"{label}: Solandra rendered no usable response"
    assert not _INTERNAL_MACHINERY.search(visible), f"{label}: visible response exposed internal machinery"

    entry = {
        "label": label,
        "prompt": prompt,
        "turn_http_status": result.turn_http_status,
        "turn_body": result.turn_body,
        "outcome_http_status": result.outcome_http_status,
        "outcome_body": result.outcome_body,
        "final_product_body": final_body,
        "visible_solandra_text": visible,
        "visible_links": links,
    }
    evidence.append(entry)

    print(f"FRESH_BREADTH_{label}_EVIDENCE_BEGIN")
    print(json.dumps(entry, indent=2, sort_keys=True))
    print(f"FRESH_BREADTH_{label}_EVIDENCE_END")


def test_fresh_canonical_solandra_e2e_breadth(page: Page) -> None:
    page.set_viewport_size({"width": 1440, "height": 1000})
    _open_product_surface(page)

    evidence_dir = Path("artifacts/fresh-product-breadth")
    evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence: list[dict[str, Any]] = []
    meta: dict[str, Any] = {
        "product_origin": page.url,
        "journey": "fresh-canonical-solandra-e2e-breadth",
        "cases": [
            "current external Knowledge",
            "natural source/uncertainty follow-up",
            "comparison/decision support",
            "material ambiguity",
            "topic return/conversational reference",
        ],
    }

    changed_capability = False
    try:
        changed_capability = _connect_cognitive_assistance_if_available(page)
        meta["cognitive_assistance_changed_for_validation"] = changed_capability

        _record_stage(page, "CURRENT_KNOWLEDGE", KNOWLEDGE_PROMPT, evidence)
        _record_stage(page, "KNOWLEDGE_FOLLOWUP", FOLLOWUP_PROMPT, evidence)
        _record_stage(page, "DECISION_SUPPORT", DECISION_PROMPT, evidence)
        _record_stage(page, "AMBIGUITY", AMBIGUITY_PROMPT, evidence)
        _record_stage(page, "TOPIC_RETURN", RETURN_PROMPT, evidence)
    finally:
        try:
            _restore_cognitive_assistance(page, changed_capability)
        finally:
            payload = {"meta": meta, "turns": evidence}
            (evidence_dir / "evidence.json").write_text(
                json.dumps(payload, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            print("FRESH_PRODUCT_BREADTH_EVIDENCE=WRITTEN")
