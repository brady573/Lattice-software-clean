from __future__ import annotations

import importlib
from dataclasses import dataclass

import pytest

validator = importlib.import_module("tools.deployed_product_journey_validation")


@dataclass
class _Request:
    method: str = "POST"


class _Response:
    url = "https://example.invalid/api/v1/conversations/conversation-1/turns"
    request = _Request()
    status = 200

    def json(self) -> dict[str, str]:
        return {"status": "CONVERSATION_COMPLETED"}


class _Pending:
    def __init__(self, response: _Response, exit_error: Exception | None = None) -> None:
        self.value = response
        self._exit_error = exit_error

    def __enter__(self) -> "_Pending":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if self._exit_error is not None:
            raise self._exit_error
        return False


class _Composer:
    def __init__(self) -> None:
        self.filled: list[str] = []
        self.pressed: list[str] = []

    def fill(self, value: str) -> None:
        self.filled.append(value)

    def press(self, key: str) -> None:
        self.pressed.append(key)


class _TurnLocator:
    def __init__(self, page: "_Page") -> None:
        self._page = page

    def count(self) -> int:
        return self._page.solandra_turns

    @property
    def last(self) -> "_TurnLocator":
        return self

    def inner_text(self) -> str:
        return self._page.last_solandra_text


class _Page:
    def __init__(self, *, exit_error: Exception | None = None) -> None:
        self.exit_error = exit_error
        self.expect_calls: list[int] = []
        self.wait_calls: list[tuple[str, int, int]] = []
        self.solandra_turns = 4
        self.last_solandra_text = "visible Solandra result"

    def locator(self, selector: str) -> _TurnLocator:
        assert selector == "#conversation .turn.solandra"
        return _TurnLocator(self)

    def expect_response(self, predicate, *, timeout: int) -> _Pending:
        response = _Response()
        assert predicate(response)
        self.expect_calls.append(timeout)
        return _Pending(response, self.exit_error)

    def wait_for_function(self, expression: str, *, arg: int, timeout: int) -> None:
        self.wait_calls.append((expression, arg, timeout))


def test_submit_turn_dispatches_once_and_waits_beyond_product_model_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    page = _Page()
    composer = _Composer()
    completion_calls: list[tuple[int, str]] = []

    def complete(_page: _Page, prior: int, label: str) -> None:
        completion_calls.append((prior, label))
        page.solandra_turns = prior + 1

    monkeypatch.setattr(validator, "_composer", lambda _: composer)
    monkeypatch.setattr(validator, "_wait_for_turn_completion", complete)

    result = validator._submit_turn(page, "ordinary request", "DECISION")

    assert result.solandra_text == "visible Solandra result"
    assert result.turn_http_status == 200
    assert result.turn_body == {"status": "CONVERSATION_COMPLETED"}
    assert composer.filled == ["ordinary request"]
    assert composer.pressed == ["Enter"]
    assert page.expect_calls == [validator.TURN_RESPONSE_TIMEOUT_MS]
    assert validator.TURN_RESPONSE_TIMEOUT_MS > validator.PRODUCT_MODEL_TIMEOUT_MS
    assert completion_calls == [(4, "DECISION")]
    assert page.solandra_turns == 5


def test_submit_turn_does_not_resubmit_when_response_wait_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    page = _Page(exit_error=RuntimeError("response wait expired"))
    composer = _Composer()

    monkeypatch.setattr(validator, "_composer", lambda _: composer)

    with pytest.raises(RuntimeError, match="response wait expired"):
        validator._submit_turn(page, "ordinary request", "DECISION")

    assert composer.pressed == ["Enter"]
    assert page.expect_calls == [validator.TURN_RESPONSE_TIMEOUT_MS]


def test_completion_wait_requires_new_solandra_result_and_ready_composer(monkeypatch: pytest.MonkeyPatch) -> None:
    page = _Page()
    monkeypatch.setattr(validator, "_visible_text", lambda _: "unused")

    validator._wait_for_turn_completion(page, 4, "ACTION_PREPARATION")

    assert len(page.wait_calls) == 1
    expression, prior, timeout = page.wait_calls[0]
    assert prior == 4
    assert timeout == validator.TURN_COMPLETION_TIMEOUT_MS
    assert "#conversation .turn.solandra" in expression
    assert 'getAttribute("aria-busy") === "false"' in expression
    assert "input.disabled === false" in expression
    assert "send.disabled === false" in expression
    assert "hasNewSolandraResult && ready" in expression
