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


def test_contextual_clarification_accepts_semantics_without_favored_phrasing() -> None:
    validator._assert_contextual_clarification(
        _stage(
            "AMBIGUITY",
            "For driving versus the train, should speed or cost determine the choice?",
            turn_body={"status": "NEEDS_CLARIFICATION"},
        )
    )


def test_contextual_clarification_rejects_generic_context_loss() -> None:
    with pytest.raises(AssertionError, match="did not visibly retain the known comparison alternatives"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "What specific items, options, or subjects are you asking to compare?",
                turn_body={"status": "NEEDS_CLARIFICATION"},
            )
        )


def test_contextual_clarification_requires_product_status() -> None:
    with pytest.raises(AssertionError, match="expected NEEDS_CLARIFICATION"):
        validator._assert_contextual_clarification(
            _stage(
                "AMBIGUITY",
                "For driving versus the train, should speed or cost determine the choice?",
                turn_body={"status": "CONVERSATION_COMPLETED"},
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
                "For driving versus the train, should speed or cost determine the choice?",
                turn_body={"status": "NEEDS_CLARIFICATION"},
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
