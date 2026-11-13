"""Task adapters: data loading, gold labels, rules calls, LLM prompts/schemas and parsing.

A *unit* is one scored decision. Email and milestone tasks have one unit per item; the drawing
task has four units per item (one per checked field). Each adapter maps an item to
``{unit_field: Pred}``; ``unit_field`` is ``""`` for single-unit tasks.

Rules per task:
* email, milestone: the REAL extracted ProjectTracker code (``lib/`` via ``ptcore.py``). The only
  bench-side glue is how the tool's output is mapped to labels and confidences (documented below).
* drawing: a bench-only rules baseline (``rules.py``). The tool's own drawing check works on whole
  layout sets, not on this field-by-field quote comparison, so it is not used here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import ptcore
from .data import drawings as dgen
from .data import emails as egen
from .data import milestones as mgen
from .data.common import OUR_COMPANY, registry_text, tracker_inputs
from .rules import check_drawing


@dataclass
class Pred:
    label: str
    confidence: float
    extra: dict = field(default_factory=dict)


def _clamp(x) -> float:
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return 0.0


CONFIDENCE_NOTE = (
    "Report `confidence` as your probability (0 to 1) that your answer is correct. It is used "
    "to decide whether a human must review the item, so be calibrated: do not round up."
)

# Glue constants (bench-side, pre-registered). The tool itself treats < 0.45 as unassigned.
UNASSIGNED_BELOW = 0.45
NONE_CONF_NOISE = 0.90  # the tool classified the mail as noise
NONE_CONF_NO_EVIDENCE = 0.80  # no evidence for any project
NONE_CONF_MILESTONE_WORDS = 0.60  # no detector fired but the text talks about orders/ship/etc.
NONE_CONF_QUIET = 0.90  # no detector fired and no milestone vocabulary
DETECTOR_CONF = 0.95  # a detector fired on its notice format
STATUS_RULE_CONF = 0.80  # the tool's status rule saw a customer PO in prose
MILESTONE_WORDS = re.compile(
    r"\b(ship\w*|po|purchase order|order|submittals?|approv\w*|quote|rfq|pricing|award)\b", re.I)


def _show_msg(m: dict) -> str:
    to = ", ".join(p.get("email", "") for p in m.get("to", []))
    hdr = f"From: {m['from'].get('name', '')} <{m['from'].get('email', '')}>\nTo: {to}\n"
    if m.get("conversationId"):
        hdr += f"Thread id: {m['conversationId']}\n"
    return f"{hdr}Subject: {m['subject']}\n\n{m['body']}"


class EmailTask:
    name = "email"
    fields = ("",)

    def __init__(self, n: int, seed: int):
        self.projects, self.items = egen.generate(n, seed)
        self.inputs = tracker_inputs(self.projects)
        self.labels = [p.id for p in self.projects] + ["none"]
        self._rules: dict[str, dict] | None = None
        self.system = (
            f"You file incoming emails for {OUR_COMPANY}, a supplier of industrial paint-finishing "
            "systems, into project folders.\n\nProject register (id | project number | name | "
            "client (domain) | status | ERP opportunity | vendor order | contacts | known thread "
            f"ids):\n{registry_text(self.projects)}\n\n"
            "Assign the email to exactly one project id from the register, or `none` if it does "
            "not belong to any project (newsletters, vendor marketing, internal admin). Evidence "
            "can include project numbers (possibly with typos), bare job numbers, ERP opportunity "
            "numbers, vendor order numbers, thread ids, sender addresses and domains, forwarded "
            "headers, client names and place names in the project name (possibly misspelt). If "
            "several projects are mentioned, choose the one the email is actually about. "
            f"{CONFIDENCE_NOTE}"
        )
        self.schema = {
            "type": "object",
            "properties": {
                "evidence": {"type": "string", "description": "one short sentence"},
                "project_id": {"type": "string", "enum": self.labels},
                "confidence": {"type": "number"},
            },
            "required": ["evidence", "project_id", "confidence"],
            "additionalProperties": False,
        }

    def item_id(self, it) -> str:
        return it.id

    def case(self, it) -> str:
        return it.case

    def truth(self, it) -> dict[str, Pred]:
        return {"": Pred(it.label, 1.0)}

    def _all_rules(self) -> dict[str, dict]:
        if self._rules is None:
            self._rules = ptcore.match(self.inputs, [it.msg for it in self.items])
        return self._rules

    def rules(self, it) -> dict[str, Pred]:
        r = self._all_rules()[it.id]
        pid, conf = r.get("projectId"), float(r.get("confidence") or 0)
        extra = {"reasons": (r.get("reasons") or [])[:4], "tool_confidence": conf,
                 "noise": r.get("noise")}
        if r.get("noise"):
            return {"": Pred("none", NONE_CONF_NOISE, extra)}
        if pid and conf >= UNASSIGNED_BELOW:
            return {"": Pred(pid, conf, extra)}
        none_conf = NONE_CONF_NO_EVIDENCE if conf == 0 else max(0.5, 1 - conf)
        return {"": Pred("none", none_conf, extra)}

    def user_prompt(self, it) -> str:
        return _show_msg(it.msg)

    def parse(self, data: dict) -> dict[str, Pred]:
        label = data.get("project_id", "none")
        if label not in self.labels:
            label = "none"
        return {"": Pred(label, _clamp(data.get("confidence")), {"evidence": data.get("evidence")})}


DETECTOR_LABEL = {  # tool milestone kind → benchmark label, in priority order
    "ship-date-changed": "ship_date_changed",
    "order-accepted": "order_accepted",
    "submittals": "submittals_received",
    "new-opportunity": "new_opportunity",
}


class MilestoneTask:
    name = "milestone"
    fields = ("",)

    def __init__(self, n: int, seed: int):
        self.items = mgen.generate(n, seed)
        self._det: dict[str, list[dict]] | None = None
        self._status: dict[str, dict | None] | None = None
        self.system = (
            f"You read project emails sent to {OUR_COMPANY} (industrial paint-finishing systems) "
            "and detect project milestones. Labels:\n"
            "- order_accepted: the customer has placed/awarded the order, or a vendor has accepted "
            "our purchase order (PO acceptance report). Plans or expectations do not count, nor "
            "our own PO sent to a vendor.\n"
            "- submittals_received: submittal / approval drawings have been sent for approval or "
            "returned approved (including 'approved as noted'). Requests for submittals do not count.\n"
            "- ship_date_changed: the ship date has changed. Give old_date and new_date as ISO dates "
            f"(YYYY-MM-DD); dates without a year are in {mgen.YEAR}. If an earlier notice is shown, "
            "compare with it. A confirmed unchanged date does not count.\n"
            "- new_opportunity: a new potential project, request for pricing or bid, or a new "
            "opportunity assigned in the ERP.\n"
            "- none: anything else (replies, reminders, out-of-office, meeting notes).\n"
            f"Use null dates unless the label is ship_date_changed. {CONFIDENCE_NOTE}"
        )
        self.schema = {
            "type": "object",
            "properties": {
                "label": {"type": "string", "enum": mgen.LABELS},
                "old_date": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "new_date": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "confidence": {"type": "number"},
            },
            "required": ["label", "old_date", "new_date", "confidence"],
            "additionalProperties": False,
        }

    def item_id(self, it) -> str:
        return it.id

    def case(self, it) -> str:
        return it.case

    def truth(self, it) -> dict[str, Pred]:
        return {"": Pred(it.label, 1.0, {"old_date": it.old_date, "new_date": it.new_date})}

    def _load(self) -> None:
        if self._det is None:
            msgs = [it.msg for it in self.items]
            self._det = ptcore.detect(msgs)
            self._status = ptcore.status_changes(msgs)

    def rules(self, it) -> dict[str, Pred]:
        self._load()
        found = self._det[it.id]
        kinds = [m["kind"] for m in found]
        for kind, label in DETECTOR_LABEL.items():
            if kind in kinds:
                m = found[kinds.index(kind)]
                extra = {"detector": m.get("detector"), "old_date": None, "new_date": None}
                if label == "ship_date_changed":
                    extra.update(old_date=m["value"]["from"], new_date=m["value"]["to"])
                return {"": Pred(label, DETECTOR_CONF, extra)}
        # The status rule reads people's prose; notices already recognised by a detector are left out.
        ch = None if found else self._status[it.id]
        if ch and ch.get("to") == "In Progress":
            return {"": Pred("order_accepted", STATUS_RULE_CONF,
                             {"status_rule": ch.get("evidence"), "old_date": None, "new_date": None})}
        text = f"{it.msg['subject']} {it.msg['body']}"
        conf = NONE_CONF_QUIET if found or not MILESTONE_WORDS.search(text) else NONE_CONF_MILESTONE_WORDS
        return {"": Pred("none", conf, {"detectors": kinds, "old_date": None, "new_date": None})}

    def user_prompt(self, it) -> str:
        text = _show_msg(it.msg)
        for h in it.msg.get("history", []):
            day = h.get("receivedTime", "")[:10]
            text += f"\n\n--- Earlier notice ({day}) ---\nSubject: {h['subject']}\n{h['body']}"
        return text

    def parse(self, data: dict) -> dict[str, Pred]:
        label = data.get("label", "none")
        if label not in mgen.LABELS:
            label = "none"
        return {"": Pred(label, _clamp(data.get("confidence")),
                         {"old_date": data.get("old_date"), "new_date": data.get("new_date")})}


class DrawingTask:
    name = "drawing"
    fields = dgen.FIELDS

    def __init__(self, n: int, seed: int):
        self.items = dgen.generate(n, seed)
        field_schema = {
            "type": "object",
            "properties": {
                "label": {"type": "string", "enum": dgen.FIELD_LABELS},
                "confidence": {"type": "number"},
            },
            "required": ["label", "confidence"],
            "additionalProperties": False,
        }
        self.system = (
            "You cross-check a GA drawing's layout notes against the matching quote lines for an "
            "industrial paint-finishing system. Compare four fields: hook_load, ceiling_height "
            "(clear height), booth_dimensions (interior L x W x H; use the worst of the three) "
            "and electrical_scope (who supplies/installs the panel and wiring).\n"
            "For numeric fields compute the relative difference |quote - drawing| / drawing after "
            "converting units (1 ft = 12 in, 1 in = 25.4 mm, 1 lb = 0.45359237 kg):\n"
            "- match: <= 0.1 % (unit rounding only)\n"
            "- near_miss: > 0.1 % and <= 2.5 %\n"
            "- mismatch: > 2.5 %\n"
            "electrical_scope is match or mismatch only (vendor turnkey / customer / split: "
            f"panel by vendor, install by customer). {CONFIDENCE_NOTE} Give one confidence per "
            "field."
        )
        self.schema = {
            "type": "object",
            "properties": {f: field_schema for f in dgen.FIELDS},
            "required": list(dgen.FIELDS),
            "additionalProperties": False,
        }

    def item_id(self, it) -> str:
        return it.id

    def case(self, it) -> str:
        return it.case

    def truth(self, it) -> dict[str, Pred]:
        return {f: Pred(it.labels[f], 1.0) for f in dgen.FIELDS}

    def rules(self, it) -> dict[str, Pred]:
        r = check_drawing(it.layout_notes, it.quote_lines)
        return {f: Pred(c.label, c.confidence, {"detail": c.detail}) for f, c in r.items()}

    def user_prompt(self, it) -> str:
        return f"LAYOUT NOTES:\n{it.layout_notes}\n\nQUOTE LINES:\n{it.quote_lines}"

    def parse(self, data: dict) -> dict[str, Pred]:
        out = {}
        for f in dgen.FIELDS:
            d = data.get(f) or {}
            label = d.get("label", "mismatch")
            if label not in dgen.FIELD_LABELS:
                label = "mismatch"
            if f == "electrical_scope" and label == "near_miss":
                label = "mismatch"
            out[f] = Pred(label, _clamp(d.get("confidence")))
        return out


TASK_CLASSES = {"email": EmailTask, "milestone": MilestoneTask, "drawing": DrawingTask}


def load_task(name: str, n: int, seed: int):
    return TASK_CLASSES[name](n, seed)
