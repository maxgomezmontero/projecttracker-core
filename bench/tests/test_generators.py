from dataclasses import asdict
from datetime import date

from engbench.data import drawings, emails, milestones
from engbench.data.common import osa_distance
from engbench.data.drawings import band


def test_generators_are_deterministic():
    a = [asdict(e) for e in emails.generate(40, 7)[1]]
    b = [asdict(e) for e in emails.generate(40, 7)[1]]
    assert a == b
    assert [asdict(m) for m in milestones.generate(40, 7)] == [
        asdict(m) for m in milestones.generate(40, 7)]
    assert [asdict(d) for d in drawings.generate(20, 7)] == [
        asdict(d) for d in drawings.generate(20, 7)]


def test_different_seeds_differ():
    assert [e.msg["subject"] for e in emails.generate(30, 1)[1]] != [
        e.msg["subject"] for e in emails.generate(30, 2)[1]]


def test_registry_codes_are_far_apart_and_domains_fictional():
    projects, items = emails.generate(200, 3)
    bares = [p.bare for p in projects]
    assert len(set(bares)) == len(bares)
    for i, a in enumerate(bares):
        for b in bares[i + 1:]:
            assert osa_distance(a, b) >= 3  # one typo can never turn one number into another
    for p in projects:
        assert p.domain.endswith(".example")
        assert all(c.email.endswith(".example") for c in p.contacts)
    for e in items:
        assert e.msg["from"]["email"].endswith(".example")


def test_email_labels_and_cases():
    projects, items = emails.generate(300, 5)
    ids = {p.id for p in projects}
    for e in items:
        assert e.label == "none" or e.label in ids
        if e.case in emails.NONE_CASES:
            assert e.label == "none"
        else:
            assert e.label in ids
    assert {e.case for e in items} == set(emails.CASE_WEIGHTS)


def test_milestone_dates_valid():
    msgs = milestones.generate(300, 5)
    assert {m.label for m in msgs} == set(milestones.LABELS)
    for m in msgs:
        if m.label == "ship_date_changed":
            old, new = date.fromisoformat(m.old_date), date.fromisoformat(m.new_date)
            assert old != new
        else:
            assert m.old_date is None and m.new_date is None


def test_drawing_labels_match_rendered_values():
    """Gold labels must agree with the numbers as rendered in the text."""
    items = drawings.generate(200, 9)
    seen = set()
    for it in items:
        v = it.values
        assert band(v["hook_load"]["drawing_lb"], v["hook_load"]["quote_lb"]) == \
            it.labels["hook_load"]
        assert band(v["ceiling_height"]["drawing_in"], v["ceiling_height"]["quote_in"]) == \
            it.labels["ceiling_height"]
        dims = [band(a, b) for a, b in zip(v["booth_dimensions"]["drawing_in"],
                                           v["booth_dimensions"]["quote_in"], strict=True)]
        order = ["match", "near_miss", "mismatch"]
        assert max(dims, key=order.index) == it.labels["booth_dimensions"]
        assert it.labels["electrical_scope"] in ("match", "mismatch")
        seen |= set(it.labels.values())
    assert seen == {"match", "near_miss", "mismatch"}


def test_render_length_roundtrip():
    text, val = drawings.render_length(18 * 12 + 6, "ftin")
    assert text == "18'-6\"" and val == 222
    text, val = drawings.render_length(24 * 12, "mm")
    assert text == "7315 mm" and band(288, val) == "match"
    text, _ = drawings.render_length(14 * 12, "words")
    assert text == "fourteen feet"
