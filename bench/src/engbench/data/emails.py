"""Synthetic email-to-project matching data, in ProjectTracker's message schema.

Each item is a message dict (``subject``, ``body``, ``from``, ``to``, ``conversationId``, …) plus a
gold label (a project id or ``"none"``) and a ``case`` tag naming the evidence it carries. Cases
tagged ``unseen:`` use phrasings the tool's rules were never tuned for.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .common import OUR_DOMAIN, Project, make_registry, person

CASE_WEIGHTS: dict[str, float] = {
    "project_number": 0.12,
    "bare_number": 0.07,
    "erp_opp": 0.06,
    "vendor_order": 0.06,
    "thread_reply": 0.09,
    "contact_unique": 0.07,
    "contact_shared_hint": 0.07,
    "domain_place": 0.06,
    "typo_number": 0.06,
    "forwarded": 0.06,
    "two_projects": 0.05,
    "redirected_thread": 0.03,
    "newsletter": 0.06,
    "newsletter_client_case_study": 0.03,
    "unrelated_vendor": 0.05,
    "internal_noise": 0.04,
    "unseen:third_party": 0.06,
    "unseen:misspelt_place": 0.04,
}
NONE_CASES = {"newsletter", "newsletter_client_case_study", "unrelated_vendor", "internal_noise"}

TOPICS = [
    ("Updated anchor layout", "Attached is the revised anchor bolt layout. Please confirm the embed depths."),
    ("Question on airflow", "Can you confirm the design airflow? Our EHS team is asking."),
    ("Site access next week", "Your crew will need badges. Please send names by Thursday."),
    ("Invoice query", "We received invoice 2231 but the milestone split looks different from the contract."),
    ("Filter change schedule", "What is the recommended filter change interval?"),
    ("Punch list", "Remaining punch items: guard rail at stair 2, missing labels on the panel."),
    ("Paint sample results", "The adhesion test on the sample panels came back fine. See attached report."),
]
ENGINEER = {"name": "Project Engineer", "email": f"engineer@{OUR_DOMAIN}"}


@dataclass
class Email:
    id: str
    msg: dict
    label: str
    case: str
    meta: dict = field(default_factory=dict)


def _typo(bare: str, rng: random.Random) -> str:
    d = list(bare)
    i = rng.randrange(len(d) - 1)
    while d[i] == d[i + 1]:
        i = (i + 1) % (len(d) - 1)
    d[i], d[i + 1] = d[i + 1], d[i]
    return "".join(d)


def _misspell(word: str, rng: random.Random) -> str:
    i = rng.randrange(1, len(word) - 2)
    return word[:i] + word[i + 1] + word[i] + word[i + 2:]


def _sig(name: str) -> str:
    return f"\n\nRegards,\n{name}"


def make_email(i: int, case: str, projects: list[Project], rng: random.Random) -> Email:
    p = rng.choice(projects)
    subj, body = rng.choice(TOPICS)
    contact = rng.choice(p.contacts)
    sender = {"name": contact.name, "email": contact.email}
    conv = f"C{i:05d}"
    label = p.id

    if case == "project_number":
        subj = f"{p.project_number} - {subj}"
    elif case == "bare_number":
        body = f"Re job {p.bare}: {body}"
    elif case == "erp_opp":
        body = f"Regarding {p.erp_opp}: {body}"
    elif case == "vendor_order":
        subj = f"Order {p.vendor_order} - {subj}"
    elif case == "thread_reply":
        conv = rng.choice(p.threads)
        subj = f"RE: {subj}"
        body = f"Thanks, see my answers inline. {body}"
    elif case == "contact_unique":
        sender = {"name": p.contacts[0].name, "email": p.contacts[0].email}
    elif case == "contact_shared_hint":
        p = rng.choice([q for q in projects if len(q.contacts) > 1])
        label = p.id
        sender = {"name": p.contacts[1].name, "email": p.contacts[1].email}
        body = f"This is about the {p.place} job, not the other one. {body}"
    elif case == "domain_place":
        f, last = person(rng)
        sender = {"name": f"{f} {last}", "email": f"{f.lower()}.{last.lower()}.temp@{p.domain}"}
        subj = f"{p.place} - {subj}"
        body = f"I am covering for my colleague this week. {body}"
    elif case == "typo_number":
        subj = f"N{p.project_number[1:3]}-{_typo(p.bare, rng)} {subj}"
    elif case == "forwarded":
        colleague = person(rng)
        ref = rng.choice([p.project_number, p.erp_opp, ""])
        body = ("FYI, see below - can you handle?\n\n---------- Forwarded message ---------\n"
                f"From: {contact.name} <{contact.email}>\nSubject: {f'{subj} {ref}'.strip()}\n\n{body}")
        subj = f"FW: {subj}"
        sender = {"name": f"{colleague[0]} {colleague[1]}",
                  "email": f"{colleague[0].lower()}@{OUR_DOMAIN}"}
    elif case == "two_projects":
        q = rng.choice([x for x in projects if x is not p])
        subj = f"{p.project_number} - {subj}"
        body = f"{body}\n\nNote: this may also affect {q.project_number}; separate email to follow."
    elif case == "redirected_thread":
        q = rng.choice([x for x in projects if x is not p])
        conv = rng.choice(q.threads)
        subj = f"RE: {subj}"
        body = (f"Replying on this old chain for convenience, but this is about {p.project_number} "
                f"({p.name}), not the original topic. {body}")
    elif case == "newsletter":
        topic = rng.choice(["powder booth airflow", "cure oven energy savings", "conveyor upkeep"])
        sender = {"name": "Coatings Weekly", "email": "news@coatings-weekly.example"}
        subj, body, label = f"This week: {topic}", f"Five tips on {topic}. Unsubscribe here.", "none"
    elif case == "newsletter_client_case_study":
        sender = {"name": "Finishing Digest", "email": "editor@finishing-digest.example"}
        subj = f"Case study: {p.client}"
        body = f"How {p.client} upgraded its {p.scope.lower()}. Read the full story. Unsubscribe here."
        label = "none"
    elif case == "unrelated_vendor":
        f, _ = person(rng)
        sender = {"name": f, "email": f"{f.lower()}@industrial-supply.example"}
        subj = "Spray guns on sale"
        body = "Spray guns and booth filters on sale this month. Reply for pricing."
        label = "none"
    elif case == "internal_noise":
        f, _ = person(rng)
        sender = {"name": f, "email": f"{f.lower()}@{OUR_DOMAIN}"}
        subj, body, label = "Team lunch Friday", "Reply with your order by noon.", "none"
    elif case == "unseen:third_party":
        f, last = person(rng)
        org = rng.choice(["gc-builders.example", "plant-consult.example", "millwright-co.example"])
        sender = {"name": f"{f} {last}", "email": f"{f.lower()}.{last.lower()}@{org}"}
        subj = "Coordination"
        body = (f"We are the contractor on the {p.client} {p.scope.lower()} installation. "
                f"{body}")
    elif case == "unseen:misspelt_place":
        f, last = person(rng)
        sender = {"name": f"{f} {last}", "email": f"{f.lower()}@gc-builders.example"}
        subj = f"{_misspell(p.place, rng)} {p.scope.lower()} - {subj}"
    else:  # pragma: no cover
        raise ValueError(case)

    if label != "none" and "Regards" not in body:
        body += _sig(sender["name"])
    msg = {
        "id": f"E{i:04d}", "subject": subj, "body": body, "from": sender, "to": [ENGINEER],
        "cc": [], "conversationId": conv, "attachments": [], "direction": "received",
        "receivedTime": f"2027-0{1 + i % 9}-{1 + i % 27:02d}T09:00:00",
    }
    return Email(msg["id"], msg, label, case)


def generate(n: int, seed: int) -> tuple[list[Project], list[Email]]:
    rng = random.Random(seed)
    projects = make_registry(rng)
    cases = list(CASE_WEIGHTS)
    weights = [CASE_WEIGHTS[c] for c in cases]
    return projects, [make_email(i, rng.choices(cases, weights)[0], projects, rng)
                      for i in range(n)]
