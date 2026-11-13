"""Scoring: accuracy/F1, asymmetric error cost, calibration, review/error trade-off, bootstrap CIs.

Definitions (per *unit*):

* forced accuracy  - the pipeline's best label vs gold, ignoring routing (what you get if
                     nobody reviews anything).
* review rate      - share of units routed to the human-review bucket.
* auto error rate  - share of *all* units that were auto-decided AND wrong. This is the number of
                     silent errors per unit processed, the quantity a reviewer cannot catch.
* expected cost    - mean cost per unit, with review = REVIEW_COST and auto errors priced by the
                     asymmetric cost tables in ``config``. Reviewed units are assumed resolved
                     correctly by the human.
* ECE              - expected calibration error of confidence vs correctness, 10 equal bins.
"""

from __future__ import annotations

import random
import statistics
from collections import defaultdict

from .config import DRAWING_COSTS, EMAIL_COSTS, MILESTONE_COSTS, REVIEW_COST


def _dates_ok(truth_extra: dict, pred_extra: dict) -> bool:
    return (truth_extra.get("old_date") == pred_extra.get("old_date")
            and truth_extra.get("new_date") == pred_extra.get("new_date"))


def is_correct(task: str, u: dict) -> bool:
    if u["truth"] != u["pred"]:
        return False
    if task == "milestone" and u["truth"] == "ship_date_changed":
        return _dates_ok(u["truth_extra"], u["pred_extra"])
    return True


def error_cost(task: str, u: dict) -> float:
    """Cost of auto-deciding unit ``u`` (0 when correct)."""
    t, p = u["truth"], u["pred"]
    if task == "email":
        if t == p:
            return 0.0
        if p == "none":
            return EMAIL_COSTS["project_as_none"]
        if t == "none":
            return EMAIL_COSTS["none_as_project"]
        return EMAIL_COSTS["wrong_project"]
    if task == "milestone":
        if t == p:
            if t == "ship_date_changed" and not _dates_ok(u["truth_extra"], u["pred_extra"]):
                return MILESTONE_COSTS["wrong_dates"]
            return 0.0
        if p == "none":
            return MILESTONE_COSTS["missed_milestone"]
        return MILESTONE_COSTS["false_milestone"]
    if task == "drawing":
        if t == p:
            return 0.0
        key = {
            ("mismatch", "match"): "missed_mismatch",
            ("mismatch", "near_miss"): "mismatch_as_near",
            ("near_miss", "match"): "missed_near_miss",
            ("match", "near_miss"): "false_alarm",
            ("match", "mismatch"): "false_alarm",
            ("near_miss", "mismatch"): "near_as_mismatch",
        }[(t, p)]
        return DRAWING_COSTS[key]
    raise ValueError(task)


def unit_cost(task: str, u: dict, review: bool | None = None) -> float:
    review = (u["route"] == "review") if review is None else review
    return REVIEW_COST if review else error_cost(task, u)


def per_class_f1(units: list[dict]) -> dict[str, dict]:
    labels = sorted({u["truth"] for u in units} | {u["pred"] for u in units})
    out = {}
    for lab in labels:
        tp = sum(u["truth"] == lab and u["pred"] == lab for u in units)
        fp = sum(u["truth"] != lab and u["pred"] == lab for u in units)
        fn = sum(u["truth"] == lab and u["pred"] != lab for u in units)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        out[lab] = {"precision": prec, "recall": rec, "f1": f1, "support": tp + fn}
    return out


def macro_f1(units: list[dict]) -> float:
    pc = per_class_f1(units)
    present = [v["f1"] for v in pc.values() if v["support"] > 0]
    return sum(present) / len(present) if present else 0.0


def calibration(task: str, units: list[dict], bins: int = 10) -> dict:
    buckets: list[list[tuple[float, bool]]] = [[] for _ in range(bins)]
    for u in units:
        c = u["confidence"]
        buckets[min(int(c * bins), bins - 1)].append((c, is_correct(task, u)))
    n = len(units)
    ece = 0.0
    rows = []
    for i, b in enumerate(buckets):
        if not b:
            continue
        conf = sum(c for c, _ in b) / len(b)
        acc = sum(ok for _, ok in b) / len(b)
        ece += len(b) / n * abs(conf - acc)
        rows.append({"bin": i, "n": len(b), "mean_conf": conf, "accuracy": acc})
    brier = sum((u["confidence"] - is_correct(task, u)) ** 2 for u in units) / n
    return {"ece": ece, "brier": brier, "bins": rows}


def tradeoff_curve(task: str, units: list[dict]) -> list[dict]:
    """Sweep a review threshold t: a unit is reviewed if already routed to review or conf < t."""
    thresholds = sorted({0.0, 1.01} | {round(u["confidence"], 4) for u in units})
    n = len(units)
    pts = []
    for t in thresholds:
        review = [u["route"] == "review" or u["confidence"] < t for u in units]
        rr = sum(review) / n
        auto_err = sum((not r) and not is_correct(task, u)
                       for u, r in zip(units, review, strict=True)) / n
        cost = sum(unit_cost(task, u, r) for u, r in zip(units, review, strict=True)) / n
        pts.append({"threshold": t, "review_rate": rr, "auto_error_rate": auto_err,
                    "cost_per_unit": cost})
    return pts


def _by_item(units: list[dict]) -> dict[str, list[dict]]:
    g: dict[str, list[dict]] = defaultdict(list)
    for u in units:
        g[u["item_id"]].append(u)
    return g


def bootstrap_ci(task: str, units: list[dict], n_boot: int = 1000, seed: int = 0) -> dict:
    """Percentile CIs, resampling *items* (drawing units from one item stay together)."""
    groups = list(_by_item(units).values())
    rng = random.Random(seed)
    accs, costs = [], []
    for _ in range(n_boot):
        sample = [u for _ in groups for u in rng.choice(groups)]
        accs.append(sum(is_correct(task, u) for u in sample) / len(sample))
        costs.append(sum(unit_cost(task, u) for u in sample) / len(sample))
    accs.sort()
    costs.sort()
    lo, hi = int(0.025 * n_boot), int(0.975 * n_boot) - 1
    return {"accuracy": [accs[lo], accs[hi]], "cost_per_unit": [costs[lo], costs[hi]]}


def _pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(q * (len(xs) - 1)))]


def summarize(run: dict) -> dict:
    task = run["task"]
    units = run["units"]
    traces = run["traces"]
    n = len(units)
    correct = [is_correct(task, u) for u in units]
    review = [u["route"] == "review" for u in units]
    auto_wrong = [(not r) and (not c) for r, c in zip(review, correct, strict=True)]
    n_auto = n - sum(review)

    by_case: dict[str, dict] = {}
    for case in sorted({u["case"] for u in units}):
        cu = [u for u in units if u["case"] == case]
        by_case[case] = {
            "n": len(cu),
            "accuracy": sum(is_correct(task, u) for u in cu) / len(cu),
            "review_rate": sum(u["route"] == "review" for u in cu) / len(cu),
        }
    routes = defaultdict(int)
    for u in units:
        routes[u["route"]] += 1

    out = {
        "task": task,
        "pipeline": run["pipeline"],
        "model": run.get("model"),
        "n_items": len(traces),
        "n_units": n,
        "accuracy": sum(correct) / n,
        "macro_f1": macro_f1(units),
        "per_class": per_class_f1(units),
        "review_rate": sum(review) / n,
        "auto_error_rate": sum(auto_wrong) / n,
        "auto_precision": (n_auto - sum(auto_wrong)) / n_auto if n_auto else None,
        "cost_per_unit": sum(unit_cost(task, u) for u in units) / n,
        "routes": dict(routes),
        "calibration": calibration(task, units),
        "ci95": bootstrap_ci(task, units),
        "usd_total": sum(t["cost_usd"] for t in traces),
        "usd_per_item": sum(t["cost_usd"] for t in traces) / len(traces),
        "llm_call_rate": sum(t["llm_called"] for t in traces) / len(traces),
        "latency_s": {
            "mean": statistics.fmean(t["latency_s"] for t in traces),
            "p50": _pct([t["latency_s"] for t in traces], 0.5),
            "p95": _pct([t["latency_s"] for t in traces], 0.95),
        },
        "errors": sum(t["error"] is not None for t in traces),
        "by_case": by_case,
        "tradeoff": tradeoff_curve(task, units),
    }
    if task == "milestone":
        ship = [u for u in units if u["truth"] == "ship_date_changed"]
        if ship:
            out["ship_date_exact"] = sum(is_correct(task, u) for u in ship) / len(ship)
    return out
