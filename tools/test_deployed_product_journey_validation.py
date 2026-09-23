from __future__ import annotations

from typing import Any

import pytest

import tools.deployed_product_journey_validation as validator


def _stage(
    label: str,
    assistant: str,
    *,
    turn_body: dict[str, Any] | None = None,
    outcome_body: dict[str, Any] | None = None,
) -> validator.StageResult:
    return validator.StageResult(
        label=label,
        prompt=f"{label} prompt",
        turn_http_status=200,
        turn_body=turn_body or {"status": "CONVERSATION_COMPLETED"},
        solandra_text=assistant,
        outcome_http_status=200 if outcome_body is not None else None,
        outcome_body=outcome_body,
    )


def _clarification_body() -> dict[str, Any]:
    return {
        "status": "NEEDS_CLARIFICATION",
        "question": "Which tradeoff matters more here?",
        "interpretation": {
            "authority": "NON_AUTHORITATIVE_PROPOSAL",
            "entities": ["option-a", "option-b"],
            "referents": [],
            "constraints": [],
            "preferences": [],
            "knowledgeNeeds": ["USER priority between the alternatives"],
            "materialAmbiguity": {
                "question": "Which tradeoff matters more here?",
                "couldChangeObjective": True,
            },
        },
    }


def test_truthful_not_sent_statement_is_not_an_execution_claim() -> None:
    validator._assert_no_affirmative_execution(
        "I prepared editable material in the Composer. Nothing has been sent or executed.",
        {
            "preparationReference": {"executionAuthorized": False},
            "outcome": {"resource": {"executionAuthorized": False}},
        },
    )


def test_affirmative_execution_claim_is_rejected() -> None:
    with pytest.raises(AssertionError, match="falsely implied external execution"):
        validator._assert_no_affirmative_execution(
            "I sent it to your manager.",
            {"preparationReference": {"executionAuthorized": False}},
        )

    with pytest.raises(AssertionError, match="falsely implied external execution"):
        validator._assert_no_affirmative_execution(
            "The message has been sent.",
            {"preparationReference": {"executionAuthorized": False}},
        )

    with pytest.raises(AssertionError, match="executionAuthorized=true"):
        validator._assert_no_affirmative_execution(
            "The draft is ready.",
            {"preparationReference": {"executionAuthorized": True}},
        )


def test_failed_decision_outcome_cannot_become_success_from_accumulated_prompt_words() -> None:
    contaminated_text = (
        validator.DECISION_PROMPT
        + "\nI couldn't complete that request as written."
    )
    with pytest.raises(AssertionError, match=r"DECISION: run outcome returned HTTP 422.*SOLANDRA_ADVISORY_FAILED"):
        validator._require_successful_outcome(
            "DECISION",
            422,
            {
                "error": "SOLANDRA_ADVISORY_FAILED",
                "message": "Groq Knowledge simplifier route was rate limited.",
                "presentation": {"assistantMessage": contaminated_text},
            },
        )


def test_contextual_clarification_accepts_visible_paraphrase_without_surface_word_matching() -> None:
    validator._assert_contextual_clarification(
        _stage(
            "AMBIGUITY",
            "Could you tell me which tradeoff matters more here?",
            turn_body=_clarification_body(),
        )
    )


def test_contextual_clarification_accepts_null_material_ambiguity_with_structural_context() -> None:
    body = _clarification_body()
    interpretation = body["interpretation"]
    assert isinstance(interpretation, dict)
    interpretation["materialAmbiguity"] = None

    validator._assert_contextual_clarification(
        _stage(
            "AMBIGUITY",
            "Could you tell me which tradeoff matters more here?",
            turn_body=body,
        )
    )


def test_contextual_clarification_requires_visible_text() -> None:
    with pytest.raises(AssertionError, match="no visible clarification"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "   ",
                turn_body=_clarification_body(),
            )
        )


def test_contextual_clarification_rejects_machinery_exposure() -> None:
    with pytest.raises(AssertionError, match="exposed internal machinery"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "I need the runId before I can clarify this.",
                turn_body=_clarification_body(),
            )
        )


def test_contextual_clarification_requires_structural_context() -> None:
    body = _clarification_body()
    interpretation = body["interpretation"]
    assert isinstance(interpretation, dict)
    for field in ("entities", "referents", "constraints", "preferences", "knowledgeNeeds"):
        interpretation[field] = []

    with pytest.raises(AssertionError, match="exposed no structural context"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "Which tradeoff matters more here?",
                turn_body=body,
            )
        )


def test_contextual_clarification_requires_non_authoritative_interpretation() -> None:
    body = _clarification_body()
    interpretation = body["interpretation"]
    assert isinstance(interpretation, dict)
    interpretation["authority"] = "USER"

    with pytest.raises(AssertionError, match="non-authoritative proposal framing"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "Which tradeoff matters more here?",
                turn_body=body,
            )
        )


def test_contextual_clarification_requires_product_status() -> None:
    body = _clarification_body()
    body["status"] = "CONVERSATION_COMPLETED"
    with pytest.raises(AssertionError, match="expected NEEDS_CLARIFICATION"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "Which tradeoff matters more here?",
                turn_body=body,
            )
        )


def test_action_preparation_is_not_submitted_after_decision_failure() -> None:
    labels: list[str] = []

    def submit(_prompt: str, label: str) -> validator.StageResult:
        labels.append(label)
        if label == "KNOWLEDGE":
            return _stage(label, "Metal transfers heat quickly; wood transfers it more slowly.")
        if label == "AMBIGUITY_SETUP":
            return _stage(label, "Which factor—speed or cost—is more important to you for this trip?")
        if label == "AMBIGUITY":
            return _stage(
                label,
                "Which tradeoff matters more here?",
                turn_body=_clarification_body(),
            )
        if label == "DECISION":
            validator._require_successful_outcome(
                label,
                422,
                {
                    "error": "SOLANDRA_ADVISORY_FAILED",
                    "message": "Transient provider limit exhausted bounded recovery.",
                },
            )
        raise AssertionError(f"Unexpected stage {label}")

    with pytest.raises(AssertionError, match="DECISION: run outcome returned HTTP 422"):
        validator._exercise_product_journey(submit)

    assert labels == ["KNOWLEDGE", "AMBIGUITY_SETUP", "AMBIGUITY", "DECISION"]
    assert "ACTION_PREPARATION" not in labels


def _issue47_interpretation(
    requested_help: str,
    knowledge_presentation: str,
    referenced: str | None = None,
) -> dict[str, Any]:
    return {
        "requestedHelp": requested_help,
        "knowledgePresentation": knowledge_presentation,
        "referencedKnowledgeId": referenced,
    }


def _issue47_bodies() -> tuple[dict[str, Any], dict[str, Any], str]:
    provenance = [{
        "sourceId": "source-47",
        "canonicalUri": "https://example.com/road-salt",
        "title": "Road salt source",
        "publisher": "Example",
    }]
    assistant = "Sources I used:\n- Road salt source — Example\n  https://example.com/road-salt"
    outcome_body: dict[str, Any] = {
        "status": "COMPLETED",
        "knowledgeReference": {"knowledgeId": "knowledge-47"},
        "outcome": {
            "kind": "KNOWLEDGE",
            "findings": [{"claimId": "claim-47"}],
            "provenance": provenance,
        },
        "presentation": {"assistantMessage": assistant},
    }
    knowledge_body: dict[str, Any] = {
        "knowledgeId": "knowledge-47",
        "outcome": {"provenance": [dict(item) for item in provenance]},
    }
    return outcome_body, knowledge_body, assistant


def test_issue47_interpretation_accepts_fresh_knowledge_sources() -> None:
    validator._assert_issue47_interpretation(_issue47_interpretation("KNOWLEDGE", "SOURCES", None))
    validator._assert_issue47_interpretation(_issue47_interpretation("FRESH_RESEARCH", "SOURCES", None))


def test_issue47_interpretation_rejects_non_source_or_historical() -> None:
    with pytest.raises(AssertionError, match="KNOWLEDGE or FRESH_RESEARCH"):
        validator._assert_issue47_interpretation(_issue47_interpretation("SOURCES_REFERENCE", "SOURCES", "knowledge-1"))
    with pytest.raises(AssertionError, match="knowledgePresentation=SOURCES"):
        validator._assert_issue47_interpretation(_issue47_interpretation("KNOWLEDGE", "ANSWER", None))
    with pytest.raises(AssertionError, match="new/fresh Run"):
        validator._assert_issue47_interpretation(_issue47_interpretation("KNOWLEDGE", "SOURCES", "knowledge-1"))


def test_issue47_persisted_run_requires_sources() -> None:
    validator._assert_issue47_persisted_run_request({"request": {"knowledgePresentation": "SOURCES"}})
    with pytest.raises(AssertionError, match="knowledgePresentation=SOURCES"):
        validator._assert_issue47_persisted_run_request({"request": {"knowledgePresentation": "ANSWER"}})


def test_issue47_source_list_outcome_accepts_governed_provenance() -> None:
    outcome_body, knowledge_body, visible = _issue47_bodies()
    assert validator._assert_issue47_source_list_outcome(outcome_body, knowledge_body, visible) == "knowledge-47"


def test_issue47_source_list_outcome_rejects_answer_or_mismatched_provenance() -> None:
    outcome_body, knowledge_body, visible = _issue47_bodies()

    answer_body = dict(outcome_body)
    assert isinstance(answer_body["presentation"], dict)
    answer_body["presentation"] = {"assistantMessage": "Road salt lowers the freezing point."}
    with pytest.raises(AssertionError, match="source-list presentation"):
        validator._assert_issue47_source_list_outcome(answer_body, knowledge_body, visible)

    missing_uri = dict(outcome_body)
    assert isinstance(missing_uri["presentation"], dict)
    missing_uri["presentation"] = {"assistantMessage": "Sources I used:\n- Other\n  https://example.com/other"}
    with pytest.raises(AssertionError, match="omitted governed source"):
        validator._assert_issue47_source_list_outcome(missing_uri, knowledge_body, visible)

    empty_findings = dict(outcome_body)
    empty_findings["outcome"] = {"kind": "KNOWLEDGE", "findings": [], "provenance": outcome_body["outcome"]["provenance"]}
    with pytest.raises(AssertionError, match="findings"):
        validator._assert_issue47_source_list_outcome(empty_findings, knowledge_body, visible)
