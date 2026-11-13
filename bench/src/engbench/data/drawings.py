"""Synthetic drawing-vs-quote cross-check data.

Each item is a pair of texts: structured "layout notes" from a GA drawing and the matching
"quote lines". Four fields are compared: hook load, ceiling (clear) height, booth interior
dimensions and electrical scope. Each field gets a gold label:

* ``match``     - same value (relative difference <= 0.1 %, i.e. unit-conversion rounding only)
* ``near_miss`` - numeric difference above 0.1 % and at most 2.5 %
* ``mismatch``  - numeric difference above 2.5 %, or a different electrical scope

Gold labels are computed from the numbers *as rendered* in the text, never from the intended
perturbation, so rounding can never make the label disagree with what a reader sees.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from ..config import MATCH_TOL, NEAR_MISS_TOL

FIELDS = ["hook_load", "ceiling_height", "booth_dimensions", "electrical_scope"]
FIELD_LABELS = ["match", "near_miss", "mismatch"]

IN_PER_FT = 12.0
MM_PER_IN = 25.4
KG_PER_LB = 0.45359237

ELECTRICAL = {
    "vendor": [
        "Electrical: supply and install of control panel, disconnects and field wiring by {us}.",
        "Electrical - complete, turnkey by {us} (panel, conduit, wiring, terminations).",
    ],
    "customer": [
        "Electrical: by others. Customer to provide power drops and all field wiring.",
        "Electrical work excluded; by customer's electrical contractor.",
    ],
    "split": [
        "Electrical: control panel supplied by {us}; installation and field wiring by customer.",
        "Panel furnished by {us}, installed by others.",
    ],
}
ELECTRICAL_DRAWING = {
    "vendor": "ELECTRICAL: TURNKEY BY VENDOR",
    "customer": "ELECTRICAL: BY CUSTOMER",
    "split": "ELECTRICAL: PANEL BY VENDOR / INSTALL BY CUSTOMER",
}

NUM_WORDS = {
    8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen",
    14: "fourteen", 15: "fifteen", 16: "sixteen", 18: "eighteen", 20: "twenty",
    22: "twenty-two", 24: "twenty-four",
}


@dataclass
class DrawingItem:
    id: str
    layout_notes: str
    quote_lines: str
    labels: dict[str, str]
    values: dict[str, dict] = field(default_factory=dict)  # for audit / failure analysis
    case: str = ""


def rel_diff(a: float, b: float) -> float:
    return abs(a - b) / max(abs(a), 1e-9)


def band(a: float, b: float) -> str:
    r = rel_diff(a, b)
    if r <= MATCH_TOL:
        return "match"
    if r <= NEAR_MISS_TOL:
        return "near_miss"
    return "mismatch"


def ft_in(inches: float) -> str:
    total = round(inches)
    ft, inch = divmod(total, 12)
    return f"{ft}'-{inch}\""


def render_length(inches: float, style: str) -> tuple[str, float]:
    """Render a length in inches. Returns (text, value_in_inches_as_rendered)."""
    if style == "ftin":
        total = round(inches)
        return ft_in(total), float(total)
    if style == "ft_dec":
        v = round(inches / IN_PER_FT, 2)
        return f"{v:g} ft", v * IN_PER_FT
    if style == "in":
        v = round(inches)
        return f"{v} in", float(v)
    if style == "mm":
        v = round(inches * MM_PER_IN)
        return f"{v} mm", v / MM_PER_IN
    if style == "m":
        v = round(inches * MM_PER_IN / 1000, 3)
        return f"{v:.3f} m", v * 1000 / MM_PER_IN
    if style == "ft_in_sp":  # e.g. "18 ft 6 in" (unseen by the rules)
        total = round(inches)
        ft, inch = divmod(total, 12)
        return f"{ft} ft {inch} in", float(total)
    if style == "words":
        ft = inches / IN_PER_FT
        if abs(ft - round(ft)) < 1e-9 and round(ft) in NUM_WORDS:
            return f"{NUM_WORDS[round(ft)]} feet", float(round(ft) * IN_PER_FT)
        return render_length(inches, "ftin")
    raise ValueError(style)


def render_load(lb: float, style: str) -> tuple[str, float]:
    if style == "lb":
        v = round(lb)
        return f"{v} lb", float(v)
    if style == "kg":
        v = round(lb * KG_PER_LB, 1)
        return f"{v:.1f} kg", v / KG_PER_LB
    if style == "lbs_per_hook":
        v = round(lb)
        return f"{v} lbs/hook", float(v)
    raise ValueError(style)


LENGTH_STYLES = ["ftin", "ft_dec", "in", "mm", "m", "words", "ft_in_sp"]
LENGTH_WEIGHTS = [0.28, 0.18, 0.13, 0.13, 0.10, 0.09, 0.09]
LOAD_STYLES = ["lb", "kg", "lbs_per_hook"]


def _target_value(base: float, target: str, rng: random.Random, boundary: bool) -> float:
    if target == "match":
        return base
    sign = rng.choice([-1, 1])
    if target == "near_miss":
        r = rng.uniform(0.022, 0.025) if boundary else rng.uniform(0.004, 0.024)
    else:
        r = rng.uniform(0.026, 0.032) if boundary else rng.uniform(0.04, 0.30)
    return base * (1 + sign * r)


def _numeric_field(rng, base, target, boundary, render, styles, weights=None, tries=60):
    """Perturb + render until the rendered value lands in the target band."""
    for _ in range(tries):
        val = _target_value(base, target, rng, boundary)
        style = rng.choices(styles, weights)[0] if weights else rng.choice(styles)
        text, rendered = render(val, style)
        if band(base, rendered) == target:
            return text, rendered, style
    text, rendered = render(base, styles[0])
    return text, rendered, styles[0]


def make_item(i: int, rng: random.Random) -> DrawingItem:
    targets = {f: rng.choices(FIELD_LABELS, [0.55, 0.20, 0.25])[0] for f in FIELDS}
    targets["electrical_scope"] = rng.choices(["match", "mismatch"], [0.75, 0.25])[0]
    boundary = rng.random() < 0.25
    us = "Example Finishing Systems"

    hook_lb = float(rng.choice(range(50, 401, 25)))
    ceil_in = float(rng.choice(range(14 * 12, 30 * 12 + 1, 6)))
    dims_in = [float(rng.choice(range(16, 61, 2)) * 12), float(rng.choice(range(10, 25, 2)) * 12),
               float(rng.choice(range(8, 15)) * 12)]
    elec = rng.choice(list(ELECTRICAL))

    labels: dict[str, str] = {}
    values: dict[str, dict] = {}

    hook_txt, hook_q, _hs = _numeric_field(rng, hook_lb, targets["hook_load"], boundary, render_load,
                                         LOAD_STYLES)
    labels["hook_load"] = band(hook_lb, hook_q)
    values["hook_load"] = {"drawing_lb": hook_lb, "quote_lb": hook_q}

    ceil_txt, ceil_q, ceil_style = _numeric_field(rng, ceil_in, targets["ceiling_height"], boundary,
                                         render_length, LENGTH_STYLES, LENGTH_WEIGHTS)
    labels["ceiling_height"] = band(ceil_in, ceil_q)
    values["ceiling_height"] = {"drawing_in": ceil_in, "quote_in": ceil_q}

    # booth dims: perturb exactly one dimension (if not match); label = worst of the three
    which = rng.randrange(3)
    style = rng.choices(LENGTH_STYLES, LENGTH_WEIGHTS)[0]
    dim_txt, dim_q = [], []
    for k, d in enumerate(dims_in):
        tgt = targets["booth_dimensions"] if k == which else "match"
        if tgt == "match":
            t, r = render_length(d, style)
        else:
            t, r, _ = _numeric_field(rng, d, tgt, boundary, render_length, [style])
        dim_txt.append(t)
        dim_q.append(r)
    order = {"match": 0, "near_miss": 1, "mismatch": 2}
    labels["booth_dimensions"] = max((band(a, b) for a, b in zip(dims_in, dim_q, strict=True)),
                                     key=order.__getitem__)
    values["booth_dimensions"] = {"drawing_in": dims_in, "quote_in": dim_q}

    q_elec = elec if targets["electrical_scope"] == "match" else rng.choice(
        [e for e in ELECTRICAL if e != elec])
    labels["electrical_scope"] = "match" if q_elec == elec else "mismatch"
    values["electrical_scope"] = {"drawing": elec, "quote": q_elec}

    layout = "\n".join([
        f"DWG GA-{rng.randint(100, 999)} REV {rng.choice('ABCD')}",
        f"BOOTH INTERIOR: {ft_in(dims_in[0])} L x {ft_in(dims_in[1])} W x {ft_in(dims_in[2])} H",
        f"CEILING CLEAR HT: {ft_in(ceil_in)}",
        f"CONVEYOR HOOK LOAD: {int(hook_lb)} LB MAX",
        ELECTRICAL_DRAWING[elec],
    ])
    quote = "\n".join([
        f"Line 1 - Spray booth, interior {dim_txt[0]} long x {dim_txt[1]} wide x {dim_txt[2]} high",
        f"Line 2 - Overhead conveyor, rated hook load {hook_txt}",
        f"Line 3 - Installation; assumes clear ceiling height of {ceil_txt}",
        "Line 4 - " + rng.choice(ELECTRICAL[q_elec]).format(us=us),
    ])
    case = "boundary" if boundary else "standard"
    if {ceil_style, style} & {"words", "ft_in_sp"}:
        case += "+unseen_format"
    return DrawingItem(f"D{i:04d}", layout, quote, labels, values, case)


def generate(n: int, seed: int) -> list[DrawingItem]:
    rng = random.Random(seed + 202)
    return [make_item(i, rng) for i in range(n)]
