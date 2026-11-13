"""Synthetic milestone-detection data, in ProjectTracker's message schema.

Labels: order_accepted, submittals_received, ship_date_changed (old/new ISO dates), new_opportunity,
none. Two families of messages:

* ``notice:*``: automatic notices from (fictional) vendors and the ERP: PO acceptance reports,
  submittal revisions, ship-date confirmations (with the earlier confirmation of the same order in
  ``history``), new-opportunity assignments. This is what the tool's deterministic detectors are
  built for. Hard negatives: replies to notices, an unchanged ship date, our own PO to a vendor,
  portal reminders, out-of-office replies.
* ``prose:*``: people writing the same news in their own words. The detectors do not read prose;
  only the tool's status rules recognise a customer PO ("please find attached our purchase order").
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, timedelta

LABELS = ["order_accepted", "submittals_received", "ship_date_changed", "new_opportunity", "none"]
YEAR = 2027
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
OUR_DOMAIN = "finishing-systems.example"
VENDOR_A = "orders@northbeam.example"
VENDOR_B = "pm@keller-ovens.example"

CASE_WEIGHTS: dict[str, float] = {
    "notice:po_acceptance": 0.10,
    "notice:vendor_b_submittals": 0.08,
    "notice:ship_changed": 0.10,
    "notice:new_opportunity": 0.07,
    "notice:ship_unchanged": 0.05,
    "notice:reply_to_notice": 0.05,
    "notice:our_po_to_vendor": 0.04,
    "notice:portal_reminder": 0.03,
    "notice:out_of_office": 0.03,
    "prose:customer_po": 0.06,
    "prose:award": 0.04,
    "prose:submittals_approved": 0.06,
    "prose:ship_moved": 0.07,
    "prose:rfq": 0.06,
    "prose:hedged_order": 0.04,
    "prose:submittal_request": 0.03,
    "prose:meeting_notes": 0.03,
}
LABEL_OF_CASE = {
    "notice:po_acceptance": "order_accepted", "notice:vendor_b_submittals": "submittals_received",
    "notice:ship_changed": "ship_date_changed", "notice:new_opportunity": "new_opportunity",
    "prose:customer_po": "order_accepted", "prose:award": "order_accepted",
    "prose:submittals_approved": "submittals_received", "prose:ship_moved": "ship_date_changed",
    "prose:rfq": "new_opportunity",
}


@dataclass
class Message:
    id: str
    msg: dict
    label: str
    old_date: str | None = None
    new_date: str | None = None
    case: str = ""
    meta: dict = field(default_factory=dict)


def us(d: date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def fmt_prose(d: date, rng: random.Random) -> str:
    return rng.choice([d.isoformat(), f"{MONTHS[d.month - 1]} {d.day}", us(d),
                       f"{MONTHS[d.month - 1][:3]} {d.day}, {d.year}"])


def _rand_date(rng: random.Random) -> date:
    return date(YEAR, 1, 1) + timedelta(days=rng.randint(30, 300))


def make_message(i: int, case: str, rng: random.Random) -> Message:
    scope = rng.choice(["powder booth", "cure oven", "pretreatment washer", "overhead conveyor"])
    order = f"N{rng.randint(100000, 999999)}"
    korder = f"K20{rng.randint(100000, 999999)}"
    opp = f"OP{rng.randint(1000, 99999):06d}"
    client = rng.choice(["Maplewood Metalworks", "Harbor Point Fabrication", "Cedar Valley Trailers"])
    customer = {"name": "Customer PM", "email": f"pm{rng.randint(1, 40)}@client{rng.randint(1, 9)}.example"}
    received = date(2027, 1, 1) + timedelta(days=rng.randint(0, 200))
    msg = {"id": f"M{i:04d}", "subject": "", "body": "", "from": customer,
           "to": [{"name": "Project Engineer", "email": f"engineer@{OUR_DOMAIN}"}],
           "direction": "received", "receivedTime": received.isoformat() + "T09:00:00",
           "attachments": []}
    old = new = None

    if case == "notice:po_acceptance":
        msg.update(subject=f"PO Acceptance Report For Order No: {order}",
                   body=f"Your order {order} has been accepted.", **{"from": {"name": "Northbeam Orders", "email": VENDOR_A}})
    elif case == "notice:vendor_b_submittals":
        msg.update(subject=f"{korder} {scope.title()} Submittals: Rev {rng.randint(1, 3)}.{rng.randint(0, 4)}",
                   body="Please find the submittal package attached for approval.",
                   **{"from": {"name": "Keller PM", "email": VENDOR_B}})
    elif case in ("notice:ship_changed", "notice:ship_unchanged"):
        d0 = _rand_date(rng)
        d1 = d0 + timedelta(days=rng.choice([7, 14, 21, -7])) if case == "notice:ship_changed" else d0
        subj = f"Ship Date Confirmation Report For Order No: {order}"
        prev = {"subject": subj, "body": f"Ship date: {us(d0)}", "from": {"email": VENDOR_A},
                "direction": "received", "receivedTime": (received - timedelta(days=20)).isoformat()}
        word = "Revised ship date" if case == "notice:ship_changed" else "Ship date"
        msg.update(subject=subj, body=f"{word}: {us(d1)}", history=[prev],
                   **{"from": {"name": "Northbeam Orders", "email": VENDOR_A}})
        if case == "notice:ship_changed":
            old, new = d0.isoformat(), d1.isoformat()
    elif case == "notice:new_opportunity":
        msg.update(subject=f"New opportunity {opp} assigned to you - {client}",
                   body=f"Account Name: {client}\nDescription: {scope}",
                   **{"from": {"name": "ERP", "email": f"erp-notices@{OUR_DOMAIN}"}})
    elif case == "notice:reply_to_notice":
        msg.update(subject=f"RE: PO Acceptance Report For Order No: {order}",
                   body="Thanks - when can we expect the submittals?",
                   **{"from": {"name": "Colleague", "email": f"sales@{OUR_DOMAIN}"}})
    elif case == "notice:our_po_to_vendor":
        msg.update(subject=f"Purchase Order # ABCPO{rng.randint(10000, 99999):06d} - Northbeam Finishing",
                   body="Purchase order attached.", **{"from": {"name": "ERP", "email": f"erp@{OUR_DOMAIN}"}})
    elif case == "notice:portal_reminder":
        msg.update(subject=f"Daily due date reminder PRJ_{client.split()[0]}_27",
                   body=f"{client} - Plant 2 • PRJ_{client.split()[0]}_27\n1 overdue\n3 total upcoming",
                   **{"from": {"name": "BuildPortal", "email": "notices@buildportal.example"}})
    elif case == "notice:out_of_office":
        msg.update(subject="Automatic reply: drawings", body=f"I am out and will return on {us(_rand_date(rng))}.")
    elif case == "prose:customer_po":
        msg.update(subject="PO", body=f"Please find attached our purchase order for the {scope}.")
    elif case == "prose:award":
        msg.update(subject="Award", body=f"We're good to go on the {scope} - consider this our formal award. Paperwork is coming from purchasing.")
    elif case == "prose:submittals_approved":
        msg.update(subject="Approved submittals", body=rng.choice([
            f"Attached are the approved submittals for the {scope}.",
            "Returning your approval drawings, stamped 'approved as noted'.",
            "Your submittal is back from the consultant - no exceptions taken."]))
    elif case == "prose:ship_moved":
        d0 = _rand_date(rng)
        d1 = d0 + timedelta(days=rng.choice([7, 14, 21, -7]))
        o, n_ = fmt_prose(d0, rng), fmt_prose(d1, rng)
        msg.update(subject="Ship date update", body=rng.choice([
            f"Due to a motor delay the ship date moves from {o} to {n_}.",
            f"New ship date: {n_} (previously {o}).",
            f"Heads up: the truck is now leaving {n_} rather than the {o} we planned."]))
        old, new = d0.isoformat(), d1.isoformat()
    elif case == "prose:rfq":
        msg.update(subject=f"RFQ - {scope}", body=rng.choice([
            f"We are planning a second line next year and would like a quote for a {scope}.",
            f"Our sister plant is looking at adding a {scope}. Who should they talk to about pricing?"]))
    elif case == "prose:hedged_order":
        msg.update(subject="Order status", body="We expect to issue the PO next week, once the budget is approved.")
    elif case == "prose:submittal_request":
        msg.update(subject="Submittals?", body=f"Can you send the submittals for the {scope}? We have not received them yet.")
    elif case == "prose:meeting_notes":
        msg.update(subject="Meeting notes", body="Discussed airflow balancing and the punch list. Ship date stays as planned.")
    else:  # pragma: no cover
        raise ValueError(case)
    return Message(msg["id"], msg, LABEL_OF_CASE.get(case, "none"), old, new, case)


def generate(n: int, seed: int) -> list[Message]:
    rng = random.Random(seed + 101)
    cases = list(CASE_WEIGHTS)
    weights = [CASE_WEIGHTS[c] for c in cases]
    return [make_message(i, rng.choices(cases, weights)[0], rng) for i in range(n)]
