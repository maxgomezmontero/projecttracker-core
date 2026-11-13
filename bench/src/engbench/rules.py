"""Bench-only rules baseline for the drawing-vs-quote task (unit-aware comparison).

The email and milestone tasks do NOT use this file: their rules pipeline runs the real extracted
ProjectTracker code (see ``ptcore.py``). This baseline exists because the tool's own drawing check
works on whole layout sets rather than on a field-by-field quote comparison. It was written against
the "seen" length formats only; "unseen" formats measure brittleness.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .config import MATCH_TOL, NEAR_MISS_TOL
from .data.drawings import FIELDS, IN_PER_FT, KG_PER_LB, MM_PER_IN

RE_FTIN = re.compile(r"(\d+)'-(\d+)\"")
RE_LEN = re.compile(r"(\d+(?:\.\d+)?)\s*(ft|in|mm|m)\b")
RE_LOAD = re.compile(r"(\d+(?:\.\d+)?)\s*(lbs?|kg|LB)\b", re.I)


def parse_length(s: str) -> float | None:
    """Parse the first length in ``s`` and return inches (None if unparseable)."""
    m_ftin = RE_FTIN.search(s)
    m_len = RE_LEN.search(s)
    if m_ftin and (not m_len or m_ftin.start() <= m_len.start()):
        return int(m_ftin.group(1)) * IN_PER_FT + int(m_ftin.group(2))
    if m_len:
        v, u = float(m_len.group(1)), m_len.group(2)
        return {"ft": v * IN_PER_FT, "in": v, "mm": v / MM_PER_IN, "m": v * 1000 / MM_PER_IN}[u]
    return None


def parse_lengths(s: str, n: int) -> list[float | None]:
    parts = re.split(r"\s+x\s+", s)
    vals = [parse_length(p) for p in parts[:n]]
    return vals + [None] * (n - len(vals))


def parse_load(s: str) -> float | None:
    m = RE_LOAD.search(s)
    if not m:
        return None
    v, u = float(m.group(1)), m.group(2).lower()
    return v / KG_PER_LB if u == "kg" else v


def classify_rel(a: float, b: float) -> str:
    r = abs(a - b) / max(abs(a), 1e-9)
    if r <= MATCH_TOL:
        return "match"
    if r <= NEAR_MISS_TOL:
        return "near_miss"
    return "mismatch"


def _line(text: str, key: str) -> str:
    for ln in text.splitlines():
        if key.lower() in ln.lower():
            return ln
    return ""


ELEC_RULES = [
    ("split", re.compile(r"panel (supplied |furnished )?by .*(customer|others)", re.I)),
    ("customer", re.compile(r"by others|by customer|excluded", re.I)),
    ("vendor", re.compile(r"by (vendor|example finishing systems)|turnkey", re.I)),
]


def classify_electrical(s: str) -> str | None:
    for name, rx in ELEC_RULES:
        if rx.search(s):
            return name
    return None


@dataclass
class FieldCheck:
    label: str
    confidence: float
    detail: str = ""


def check_drawing(layout: str, quote: str) -> dict[str, FieldCheck]:
    out: dict[str, FieldCheck] = {}
    order = {"match": 0, "near_miss": 1, "mismatch": 2}

    d_hook, q_hook = parse_load(_line(layout, "HOOK LOAD")), parse_load(_line(quote, "hook load"))
    if d_hook is None or q_hook is None:
        out["hook_load"] = FieldCheck("mismatch", 0.3, "unparsed")
    else:
        out["hook_load"] = FieldCheck(classify_rel(d_hook, q_hook), 0.97, f"{d_hook}->{q_hook}")

    d_ceil = parse_length(_line(layout, "CEILING").split(":", 1)[-1])
    q_ceil = parse_length(_line(quote, "ceiling height").split(" of ", 1)[-1])
    if d_ceil is None or q_ceil is None:
        out["ceiling_height"] = FieldCheck("mismatch", 0.3, "unparsed")
    else:
        out["ceiling_height"] = FieldCheck(classify_rel(d_ceil, q_ceil), 0.97,
                                           f"{d_ceil}->{q_ceil}")

    d_dims = parse_lengths(_line(layout, "BOOTH INTERIOR").split(":", 1)[-1], 3)
    q_line = _line(quote, "interior").split("interior", 1)[-1]
    q_dims = parse_lengths(q_line, 3)
    if None in d_dims or None in q_dims:
        out["booth_dimensions"] = FieldCheck("mismatch", 0.3, "unparsed")
    else:
        labels = [classify_rel(a, b) for a, b in zip(d_dims, q_dims, strict=True)]  # type: ignore
        out["booth_dimensions"] = FieldCheck(max(labels, key=order.__getitem__), 0.95, str(labels))

    d_el = classify_electrical(_line(layout, "ELECTRICAL"))
    q_el = classify_electrical(_line(quote, "Line 4"))
    if d_el is None or q_el is None:
        out["electrical_scope"] = FieldCheck("mismatch", 0.3, "unparsed")
    else:
        out["electrical_scope"] = FieldCheck("match" if d_el == q_el else "mismatch", 0.9,
                                             f"{d_el}->{q_el}")
    assert set(out) == set(FIELDS)
    return out
