import pytest

from engbench.config import EMAIL_COSTS, REVIEW_COST
from engbench.metrics import (
    bootstrap_ci,
    calibration,
    error_cost,
    is_correct,
    macro_f1,
    tradeoff_curve,
    unit_cost,
)


def U(truth, pred, conf=0.9, route="rules", item="i", te=None, pe=None):
    return {"item_id": item, "field": "", "case": "c", "truth": truth, "pred": pred,
            "confidence": conf, "route": route, "truth_extra": te or {}, "pred_extra": pe or {}}


def test_email_costs_are_asymmetric():
    wrong = error_cost("email", U("P-1", "P-2"))
    dropped = error_cost("email", U("P-1", "none"))
    assert wrong == EMAIL_COSTS["wrong_project"]
    assert wrong > dropped > REVIEW_COST
    assert unit_cost("email", U("P-1", "P-2", route="review")) == REVIEW_COST
    assert error_cost("email", U("P-1", "P-1")) == 0


def test_drawing_missed_mismatch_is_worst():
    costs = {(t, p): error_cost("drawing", U(t, p))
             for t in ("match", "near_miss", "mismatch")
             for p in ("match", "near_miss", "mismatch") if t != p}
    assert max(costs, key=costs.get) == ("mismatch", "match")


def test_milestone_wrong_dates_not_correct():
    te = {"old_date": "2027-03-03", "new_date": "2027-03-17"}
    good = U("ship_date_changed", "ship_date_changed", te=te, pe=dict(te))
    bad = U("ship_date_changed", "ship_date_changed", te=te,
            pe={"old_date": "2027-03-17", "new_date": "2027-03-03"})
    assert is_correct("milestone", good) and not is_correct("milestone", bad)
    assert error_cost("milestone", bad) > 0


def test_ece_zero_for_perfect_calibration():
    units = [U("a", "a", conf=1.0)] * 10 + [U("a", "b", conf=0.0)] * 10
    assert calibration("email", units)["ece"] == pytest.approx(0.0)


def test_ece_large_for_overconfidence():
    units = [U("a", "b", conf=0.99)] * 10
    assert calibration("email", units)["ece"] > 0.9


def test_tradeoff_endpoints():
    units = [U("a", "a", 0.9, item=str(i)) for i in range(5)] + \
            [U("a", "b", 0.4, item=str(i + 5)) for i in range(5)]
    pts = tradeoff_curve("email", units)
    first, last = pts[0], pts[-1]
    assert first["review_rate"] == 0 and first["auto_error_rate"] == 0.5
    assert last["review_rate"] == 1 and last["auto_error_rate"] == 0
    mid = next(p for p in pts if p["threshold"] == 0.9)
    assert mid["review_rate"] == 0.5 and mid["auto_error_rate"] == 0.0


def test_macro_f1_simple():
    units = [U("a", "a"), U("b", "b"), U("a", "b"), U("b", "a")]
    assert macro_f1(units) == pytest.approx(0.5)


def test_bootstrap_ci_contains_point_estimate():
    units = [U("a", "a" if i % 4 else "b", item=str(i)) for i in range(80)]
    ci = bootstrap_ci("email", units, n_boot=300)
    acc = sum(is_correct("email", u) for u in units) / len(units)
    assert ci["accuracy"][0] <= acc <= ci["accuracy"][1]
