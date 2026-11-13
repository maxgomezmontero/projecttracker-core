"""Tests for the rules side: the bridge to the real JS code, and the bench-only drawing baseline."""

import pytest

from engbench import ptcore
from engbench.data.common import make_registry, tracker_inputs
from engbench.rules import (
    check_drawing,
    classify_electrical,
    classify_rel,
    parse_length,
    parse_load,
)
from engbench.tasks import load_task

# ── bridge to lib/ (real ProjectTracker code) ────────────────────────────────


def _msg(i, **kw):
    m = {"id": f"m{i}", "subject": "", "body": "", "from": {"name": "X", "email": "x@unknown.example"},
         "to": [], "direction": "received", "receivedTime": "2027-03-01T09:00:00"}
    m.update(kw)
    return m


def test_bridge_match_uses_real_scores():
    import random
    projects = make_registry(random.Random(1))
    p = projects[0]
    res = ptcore.match(tracker_inputs(projects), [
        _msg(1, subject=f"{p.project_number} punch list"),
        _msg(2, body=f"Regarding {p.erp_opp}: pricing"),
        _msg(3, subject=f"Order {p.vendor_order} status"),
        _msg(4, subject="Lunch?"),
    ])
    assert (res["m1"]["projectId"], res["m1"]["confidence"]) == (p.id, 0.97)
    assert (res["m2"]["projectId"], res["m2"]["confidence"]) == (p.id, 0.9)
    assert (res["m3"]["projectId"], res["m3"]["confidence"]) == (p.id, 0.95)
    assert res["m4"]["projectId"] is None


def test_bridge_detect_and_status_rules():
    vendor = {"email": "orders@northbeam.example"}
    subj = "Ship Date Confirmation Report For Order No: N123456"
    prev = {"subject": subj, "body": "Ship date: 3/17/2027", "from": vendor, "receivedTime": "2027-02-01"}
    msgs = [
        _msg(1, subject="PO Acceptance Report For Order No: N654321", **{"from": vendor}),
        _msg(2, subject=subj, body="Revised ship date: 3/31/2027", history=[prev], **{"from": vendor}),
        _msg(3, subject="PO", body="Please find attached our purchase order."),
    ]
    det = ptcore.detect(msgs)
    assert [m["kind"] for m in det["m1"]] == ["order-accepted"]
    changed = next(m for m in det["m2"] if m["kind"] == "ship-date-changed")
    assert (changed["value"]["from"], changed["value"]["to"]) == ("2027-03-17", "2027-03-31")
    assert det["m3"] == []
    assert ptcore.status_changes(msgs)["m3"]["to"] == "In Progress"


def test_milestone_task_maps_tool_output_to_labels():
    task = load_task("milestone", 80, 3)
    for it in task.items:
        pred = task.rules(it)[""]
        if it.case.startswith("notice:") and it.label != "none":
            assert pred.label == it.label, it.case
            if it.label == "ship_date_changed":
                assert (pred.extra["old_date"], pred.extra["new_date"]) == (it.old_date, it.new_date)


def test_email_task_identifier_cases_are_exact():
    task = load_task("email", 80, 4)
    for it in task.items:
        if it.case in ("project_number", "erp_opp", "vendor_order", "thread_reply"):
            pred = task.rules(it)[""]
            assert pred.label == it.label and pred.confidence >= 0.88, it.case


# ── bench-only drawing baseline ──────────────────────────────────────────────


@pytest.mark.parametrize("s,inches", [
    ("18'-6\"", 222), ("18.5 ft", 222), ("222 in", 222), ("5639 mm", 5639 / 25.4),
    ("5.639 m", 5639 / 25.4),
])
def test_parse_length(s, inches):
    assert parse_length(s) == pytest.approx(inches)


def test_parse_length_known_gaps():
    assert parse_length("eighteen feet") is None
    assert parse_length("18 ft 6 in") == 216  # documented partial parse


def test_parse_load_units():
    assert parse_load("250 lb") == 250
    assert parse_load("113.4 kg") == pytest.approx(250, rel=1e-3)


def test_classify_rel_bands():
    assert classify_rel(100, 100.05) == "match"
    assert classify_rel(100, 102.5) == "near_miss"
    assert classify_rel(100, 102.6) == "mismatch"


def test_electrical_scope():
    assert classify_electrical("ELECTRICAL: PANEL BY VENDOR / INSTALL BY CUSTOMER") == "split"
    assert classify_electrical("Electrical: by others.") == "customer"
    assert classify_electrical("ELECTRICAL: TURNKEY BY VENDOR") == "vendor"


def test_check_drawing_end_to_end():
    layout = ("BOOTH INTERIOR: 24'-0\" L x 14'-0\" W x 10'-0\" H\nCEILING CLEAR HT: 18'-6\"\n"
              "CONVEYOR HOOK LOAD: 250 LB MAX\nELECTRICAL: BY CUSTOMER")
    quote = ("Line 1 - Spray booth, interior 24 ft long x 14 ft wide x 10.2 ft high\n"
             "Line 2 - Overhead conveyor, rated hook load 113.4 kg\n"
             "Line 3 - Installation; assumes clear ceiling height of 20'-0\"\n"
             "Line 4 - Electrical - complete, turnkey by Example Finishing Systems.")
    r = check_drawing(layout, quote)
    assert r["booth_dimensions"].label == "near_miss"
    assert r["hook_load"].label == "match"
    assert r["ceiling_height"].label == "mismatch"
    assert r["electrical_scope"].label == "mismatch"
