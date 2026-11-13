from __future__ import annotations

import json
import random

import pytest


class FakeBackend:
    """Deterministic stand-in for the API: answers from gold labels with controllable noise.

    Used only in tests to exercise the LLM/hybrid code paths without a key or network.
    """

    def __init__(self, task, error_rate: float = 0.0, refuse_ids: set[str] | None = None,
                 seed: int = 0):
        self.task = task
        self.error_rate = error_rate
        self.refuse_ids = refuse_ids or set()
        self.rng = random.Random(seed)
        self.by_prompt = {task.user_prompt(it): it for it in task.items}
        self.calls = 0

    def __call__(self, system: str, user: str, schema: dict) -> dict:
        self.calls += 1
        it = self.by_prompt[user]
        usage = {"input_tokens": 1000, "output_tokens": 100, "cache_creation_input_tokens": 0,
                 "cache_read_input_tokens": 0}
        if it.id in self.refuse_ids:
            return {"text": "", "stop_reason": "refusal", "usage": usage, "latency_s": 0.5}
        wrong = self.rng.random() < self.error_rate
        name = self.task.name
        if name == "email":
            label = it.label
            if wrong:
                label = "none" if label != "none" else self.task.labels[0]
            data = {"evidence": "fake", "project_id": label, "confidence": 0.6 if wrong else 0.95}
        elif name == "milestone":
            data = {"label": "none" if wrong else it.label, "old_date": it.old_date,
                    "new_date": it.new_date, "confidence": 0.6 if wrong else 0.95}
        else:
            data = {f: {"label": lab, "confidence": 0.95} for f, lab in it.labels.items()}
        return {"text": json.dumps(data), "stop_reason": "end_turn", "usage": usage,
                "latency_s": 0.5}


@pytest.fixture
def fake_backend():
    return FakeBackend
