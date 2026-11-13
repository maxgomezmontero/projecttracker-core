"""projecttracker-core bench: the real rules core (+ LLM + human review) vs a pure-LLM pipeline."""

__version__ = "0.1.0"

TASKS = ("email", "milestone", "drawing")
PIPELINES = ("rules", "rules_review", "llm", "hybrid")
