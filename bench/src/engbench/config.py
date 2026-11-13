"""Pre-registered settings.

Every threshold and cost below was fixed *before* the first benchmark run and is not tuned on
the evaluation data. Changing them after looking at results would turn the benchmark into a
fitting exercise, so any change should be recorded in the README changelog.
"""

from __future__ import annotations

DEFAULT_SEED = 2026
DEFAULT_N = 150

# Default model for the LLM pipelines. Any current Claude model id can be passed with --model.
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "low"  # classification-style work; thinking cannot be disabled on Opus 5.5
MAX_TOKENS = 4000

# USD per million tokens (first-party API list prices, checked 2026-11).
# cache_write = 1.25x input, cache_read = 0.1x input for 5-minute ephemeral caching.
PRICING: dict[str, dict[str, float]] = {
    "claude-opus-5-5": {"input": 4.00, "output": 20.00},
    "claude-sonnet-5-5": {"input": 2.00, "output": 10.00},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50},
    "claude-fable-5-2": {"input": 8.00, "output": 40.00},
}

# Hybrid routing (pre-registered).
#   rules confidence >= RULES_ACCEPT          -> rules decide (no LLM call)
#   otherwise the LLM is asked; LLM confidence >= LLM_ACCEPT -> LLM decides
#   otherwise                                  -> human review bucket
# Email uses the tool's own auto-attach level (0.88, from lib/inbox/detectors.js attach()).
RULES_ACCEPT = {"email": 0.88, "milestone": 0.85, "drawing": 0.85}
LLM_ACCEPT = 0.70

# Relative-difference bands for the drawing-vs-quote check.
MATCH_TOL = 0.001  # <= 0.1 %  : same value, unit-conversion rounding only
NEAR_MISS_TOL = 0.025  # <= 2.5 % : near miss (its own class)

# Asymmetric error costs, in "minutes of engineer time" equivalents. Sending an item to human
# review costs REVIEW_COST; a correct automatic decision costs 0.
REVIEW_COST = 1.0

# EMAIL: cost[(truth_is_none, pred_is_none, correct)]
EMAIL_COSTS = {
    "wrong_project": 10.0,  # auto-filed into the WRONG project: silent, hard to notice
    "project_as_none": 3.0,  # real project mail dropped as "none": someone chases it later
    "none_as_project": 4.0,  # newsletter/spam filed into a project: noise in the record
}

# MILESTONE: wrong milestone pushed toward the ERP is worse than a missed one.
MILESTONE_COSTS = {
    "false_milestone": 6.0,  # truth none (or other milestone), predicted a milestone
    "missed_milestone": 3.0,  # truth milestone, predicted none
    "wrong_dates": 6.0,  # ship_date_changed detected but dates wrong
}

# DRAWING: a mismatch that slips into a quote is the expensive failure.
DRAWING_COSTS = {
    "missed_mismatch": 12.0,  # truth mismatch, predicted match
    "mismatch_as_near": 4.0,  # truth mismatch, predicted near_miss (still flagged, wrong severity)
    "missed_near_miss": 3.0,  # truth near_miss, predicted match
    "false_alarm": 1.5,  # truth match, predicted near_miss/mismatch (wasted check)
    "near_as_mismatch": 1.0,  # truth near_miss, predicted mismatch (over-flagged)
}
