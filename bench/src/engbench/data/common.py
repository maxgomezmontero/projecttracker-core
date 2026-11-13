"""Shared fictional entities for the synthetic generators.

The projects and messages use the same JSON schema as the ProjectTracker rules in ``lib/`` so the
benchmark's rules pipeline runs the real extracted code. Every organisation uses the reserved
``.example`` top-level domain (RFC 2606), so no address can belong to a real organisation. Person
names are random pairs from generic lists; any resemblance to a real person is coincidental.
"""

from __future__ import annotations

import json
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path

OUR_COMPANY = "Example Finishing Systems"
OUR_DOMAIN = "finishing-systems.example"

CLIENTS: list[tuple[str, str]] = [
    ("Example Industries", "example-industries.example"),
    ("Maplewood Metalworks", "maplewood-metal.example"),
    ("Harbor Point Fabrication", "harborpoint-fab.example"),
    ("Ridgeline Agri Equipment", "ridgeline-agri.example"),
    ("Bluewater Marine Components", "bluewater-marine.example"),
    ("Cedar Valley Trailers", "cedarvalley-trailers.example"),
    ("Granite Rail Products", "granite-rail.example"),
    ("Lakeshore Appliance Works", "lakeshore-appliance.example"),
]

# scope, distinctive project-name word
SCOPES: list[str] = [
    "Powder Booth", "Wet Paint Booth", "Cure Oven", "Pretreatment Washer", "Overhead Conveyor",
    "E-Coat Line", "Blast Room", "Dry-Off Oven",
]
# Distinctive place words used in project names (the tool's matcher uses these as "name words").
PLACES = ["Ashford", "Riverton", "Kestrel", "Brookfield", "Halden", "Marlow", "Westbury", "Corran",
          "Dunmore", "Elsworth", "Fernhill", "Glenrock"]

FIRST_NAMES = [
    "Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn",
    "Dana", "Robin", "Lee", "Kim", "Pat", "Chris", "Drew", "Jesse", "Reese", "Skyler",
]
LAST_NAMES = [
    "Archer", "Bennett", "Calder", "Dawson", "Ellery", "Fenwick", "Garrison", "Hollis",
    "Ingram", "Jarvis", "Kendrick", "Lowell", "Mercer", "Norwood", "Oakley", "Prescott",
]

STATUSES = ["In Progress", "In Progress", "Quoting", "Quoted – Hot"]


@dataclass
class Contact:
    name: str
    email: str


@dataclass
class Project:
    id: str
    project_number: str  # "N26-6402"
    name: str  # "Ashford Powder Booth"
    client: str
    domain: str
    scope: str
    place: str
    status: str
    erp_opp: str  # "OP004821"
    vendor_order: str  # "N123456" (fictional vendor A order format)
    contacts: list[Contact] = field(default_factory=list)
    threads: list[str] = field(default_factory=list)

    @property
    def bare(self) -> str:
        return self.project_number.split("-")[1]

    def to_tracker(self) -> dict:
        """The project as ProjectTracker stores it."""
        emails = "  ".join(c.email for c in self.contacts)
        names = "    ".join(c.name for c in self.contacts)
        return {
            "id": self.id, "projectNumber": self.project_number, "name": self.name,
            "client": self.client, "status": self.status, "lastUpdated": "2026-10-01",
            "quotes": [{"email": emails, "contact": names}],
        }


def osa_distance(a: str, b: str) -> int:
    """Optimal-string-alignment distance (Levenshtein + adjacent transposition)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def _distinct(rng: random.Random, n: int, make, min_dist: int = 3) -> list[str]:
    out: list[str] = []
    while len(out) < n:
        c = make()
        if all(osa_distance(c, o) >= min_dist for o in out):
            out.append(c)
    return out


def person(rng: random.Random) -> tuple[str, str]:
    return rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)


def make_registry(rng: random.Random, n_projects: int = 12) -> list[Project]:
    """12 projects for 8 clients: the first clients get two sibling projects sharing a contact."""
    bares = _distinct(rng, n_projects, lambda: str(rng.randint(4000, 9999)))
    years = [rng.choice(["25", "26"]) for _ in range(n_projects)]
    opps = _distinct(rng, n_projects, lambda: f"OP{rng.randint(1000, 99999):06d}")
    orders = _distinct(rng, n_projects, lambda: f"N{rng.randint(100000, 999999)}")
    places = rng.sample(PLACES, n_projects)
    client_cycle = CLIENTS + CLIENTS[: max(0, n_projects - len(CLIENTS))]
    used_emails: set[str] = set()

    def new_contact(domain: str) -> Contact:
        while True:
            f, last = person(rng)
            e = f"{f.lower()}.{last.lower()}@{domain}"
            if e not in used_emails:
                used_emails.add(e)
                return Contact(f"{f} {last}", e)

    projects: list[Project] = []
    taken: dict[str, set[str]] = {}
    for i in range(n_projects):
        client, domain = client_cycle[i]
        scope = rng.choice([s for s in SCOPES if s not in taken.setdefault(client, set())])
        taken[client].add(scope)
        projects.append(Project(
            id=f"p{i + 1:02d}", project_number=f"N{years[i]}-{bares[i]}",
            name=f"{places[i]} {scope}", client=client, domain=domain, scope=scope,
            place=places[i], status=rng.choice(STATUSES), erp_opp=opps[i],
            vendor_order=orders[i],
        ))
    by_client: dict[str, list[Project]] = {}
    for p in projects:
        by_client.setdefault(p.client, []).append(p)
    for ps in by_client.values():
        shared = new_contact(ps[0].domain)
        for p in ps:
            p.contacts.append(new_contact(p.domain))
            if len(ps) > 1:
                p.contacts.append(shared)
    threads = _distinct(rng, n_projects * 2, lambda: f"TH{rng.randint(10000, 99999)}")
    for i, p in enumerate(projects):
        p.threads = threads[2 * i: 2 * i + 2]
    return projects


def tracker_inputs(projects: list[Project]) -> dict:
    """Everything the tool's matcher is given: projects, learned threads, identity keys, ERP map."""
    return {
        "data": {"internalDomains": [OUR_DOMAIN], "projects": [p.to_tracker() for p in projects]},
        "threads": {t: {"projectId": p.id} for p in projects for t in p.threads},
        "identity": {"projects": {p.id: [{"key": p.vendor_order, "kind": "vendor-a-order"}]
                                  for p in projects}},
        "erp": {p.bare: {"opp": p.erp_opp} for p in projects},
    }


def registry_text(projects: list[Project]) -> str:
    lines = []
    for p in projects:
        lines.append(
            f"{p.id} | {p.project_number} | {p.name} | client {p.client} ({p.domain}) | "
            f"status {p.status} | ERP {p.erp_opp} | vendor order {p.vendor_order} | "
            f"contacts: {', '.join(f'{c.name} <{c.email}>' for c in p.contacts)} | "
            f"known threads: {', '.join(p.threads)}"
        )
    return "\n".join(lines)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def to_dict(obj) -> dict:
    return asdict(obj)
