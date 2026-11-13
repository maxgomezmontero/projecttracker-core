# projecttracker-core

**Rules decide, the LLM writes, a human approves.**

This is the rules core of **ProjectTracker**, a private desktop tool that a project engineer in
industrial paint finishing (booths, ovens, conveyors) uses every day. The code here was extracted
from it and cleaned. The repository also includes a benchmark that runs this real code against
an LLM-only pipeline on **synthetic** data.

> Everything in this repository is extracted or generated. The modules come from a private tool;
> every customer, vendor, person, number and domain was replaced with a fictional one
> ([SCRUBBING.md](SCRUBBING.md)). The benchmark data is synthetic. Nothing here describes any
> company's real data.

Author: Maximiliano Gomez Montero · MIT licence

---

## 1. The problem

A project engineer on capital equipment runs a dozen projects at once. Each one has a customer,
two or three vendors, an ERP opportunity, purchase orders, layout drawings, submittals and a ship
date that keeps moving. Most of that arrives by email: hundreds of messages a week, from
customers, vendors, portals and the ERP.

The work that matters hides inside that mail: a vendor accepted the PO, submittals came back, a
ship date slipped two weeks, a new RFQ arrived. Missing one is expensive, and so is filing a mail
under the wrong project.

## 2. The design

ProjectTracker splits the work three ways:

* **Rules decide.** Deterministic code files each email under a project and detects milestones.
  Every decision carries a confidence and the evidence behind it, and the same input always gives
  the same output.
* **The LLM writes.** In the private tool, a language model only writes the summaries a human
  reads. It never decides where something is filed or what status it has.
* **A human approves.** Nothing is written to the project record or the ERP without one click from
  the engineer. Low-confidence items wait in a review lane.

The author measures the tool at about **94 % agreement with his own past manual decisions**. That
figure comes from his private data and cannot be reproduced here. The benchmark below is the part
that can be reproduced.

## 3. What is in this repository

| Path | What it is |
|---|---|
| [`lib/inbox/email-match.js`](lib/inbox/email-match.js) | **Weighted-evidence matcher**: project number 0.97, vendor order / PO key 0.95, ERP opportunity 0.90, known thread 0.88, bare job number 0.82, contact email 0.78, client domain 0.62, contact name 0.60, project-name word 0.60, client in subject 0.55. Each extra kind of evidence adds +0.12, up to a maximum of 0.99. Below 0.45 the mail stays unassigned, and at 0.88 or above it is safe to attach automatically. Also includes the noise classifier and the status-change text rules |
| [`lib/inbox/content-match.js`](lib/inbox/content-match.js) | Content evidence: the client named in the body, typos ("one edit away"), state codes, vendor orders learned from approved mail, the project stage used to choose between sibling projects, customer-portal notices |
| [`lib/inbox/detectors.js`](lib/inbox/detectors.js) | **13 deterministic milestone detectors** for automatic notices: vendor PO acceptance, submittals, ship-date confirmations (with change detection against the previous notice), ready-to-ship, our POs to vendors, new ERP opportunities, portal reminders, OCIP threads, out-of-office |
| [`lib/drawings/layout-check.js`](lib/drawings/layout-check.js) + [`drawing-checklist.js`](lib/drawings/drawing-checklist.js) | The **44-criteria layout self-check**. 28 criteria are checked automatically from the text of the drawing set (utility chart, numbering, title blocks, building context, vertical references, TOR against quotes, …). The other 16 need PDF geometry, mail or human judgement, and are reported as not covered |
| [`lib/core/status-hints.js`](lib/core/status-hints.js) | One status suggestion per project (cooling quotes, dead quotes, the ERP ahead of or behind the tracker). A human applies it |
| [`cli/ptcore.js`](cli/ptcore.js) | CLI: `match`, `detect`, `layout-check`, `status-hint`. JSON Lines in and out |
| [`bench/`](bench/) | The benchmark (Python). Its `rules` pipeline **calls this JS code** through the CLI |
| [`test/`](test/) | 38 Node tests on synthetic fixtures, including a guard that fails on any non-`.example` email address |

Plain Node ≥ 20, no dependencies:

```bash
npm test
```

```bash
node cli/ptcore.js match --projects test/fixtures/projects.json < messages.jsonl
```

---

## 4. The benchmark

**Question:** on routine engineering-document work, how does *the tool's rules + an LLM + human
review* compare with a *pure LLM*, in accuracy, calibration and the cost of errors?

Three tasks, 150 synthetic items each, seed 2026 ([bench/DATA_CARD.md](bench/DATA_CARD.md)):

1. **Email → project** (12 projects or `none`): project numbers, typos, ERP and vendor numbers,
   threads, shared contacts between sibling projects, forwards, newsletters that name a client,
   contractors who name only the client.
2. **Milestones** (order accepted / submittals / ship date changed with old and new dates / new
   opportunity / none). Two families: automatic **notices** (what the detectors are built for) and
   **prose** (people writing the same news in their own words).
3. **Drawing vs quote** (hook load, ceiling height, booth size, electrical scope; match / near-miss
   ≤ 2.5 % / mismatch). This task uses a bench-only rules baseline, because the tool's own drawing
   check works on whole layout sets.

Pipelines: `rules` (the real code), `rules_review` (rules decide at confidence ≥ 0.88, the tool's
own auto-attach level; everything else goes to a human), `llm` (Claude, structured outputs, every
item), and `hybrid` (rules when confident, the LLM in the uncertain band, a human below 0.70).
Errors are priced asymmetrically: filing into the wrong project costs 10, a review costs 1. The
thresholds and costs were fixed before the first run. The full method is in
[bench/README.md](bench/README.md).

### Results so far (rules measured; LLM rows pending an API key)

| Task | Pipeline | Accuracy (95 % CI) | Review rate | Silent errors | Cost / item |
|---|---|---|---|---|---|
| email | rules (real tool) | 94.0 % (90.0-97.3) | 0 % | 6.0 % | 0.24 |
| email | rules + review at 0.88 | 94.0 % | 38.0 % | **0.0 %** | 0.38 |
| milestones | rules (real tool) | 77.3 % (70.7-84.0) | 0 % | 22.7 % | 0.68 |
| milestones | rules + review at 0.85 | 77.3 % | 42.7 % | **0.0 %** | 0.43 |
| drawing | rules (bench baseline) | 96.2 % (94.7-97.7) | 0 % | 3.8 % | 0.06 |
| drawing | rules + review | 96.2 % | 3.7 % | 1.2 % | 0.06 |
| all | llm / hybrid | *pending*; dry upper bound on Claude Haiku 5.5: US$0.034 for the hybrid band (143 calls), US$0.11 for pure LLM (450 calls) | | | |

A held-out seed (7) gives the same picture (email 89.3 %, milestones 82.0 %, both with 0 silent
errors under review): [bench/results/heldout_seed7](bench/results/heldout_seed7/RESULTS.md).

**What this says.**

* **The tool's confidence is well ranked.** Every one of its email and milestone errors scores
  below its own auto-attach threshold. Everything it decided on its own (93 emails and 86
  milestone messages) was right. "Rules decide when sure, a human sees the rest" therefore gives
  zero silent errors. The price is reviewing about 40 % of the items.
* **That review band is what an LLM could shrink.** On milestones, the detectors get every
  automatic notice right (100 % on all `notice:*` cases) and every prose message wrong, except a
  customer PO caught by the status rules. Prose is a reading task, which is where a language model
  should earn its keep. Whether it does, and at what calibration and cost, is the open question
  for the LLM run. The pre-registered hypotheses are in [bench/README.md](bench/README.md).
* **Review is not free.** On email, rules + review costs more than rules alone (0.38 against 0.24
  per item), because most of the reviewed items were already right. The deciding metric is the
  cost of the errors, not accuracy.

### Failure modes found (concrete, from the runs)

1. **A newsletter names a client** (`E0001`, *"Case study: Granite Rail Products"*). The client's
   name in the subject and the body adds up to 0.67, and the mail is filed to that client's
   project. It stays below 0.88, so review catches it.
2. **A contractor names only the client** (`E0000`, *"We are the contractor on the Maplewood
   Metalworks overhead conveyor installation"*). This one has no number, contact or domain. The
   client-in-body rule fires only when the client has exactly one active project, and Maplewood
   has two, so the mail stays unassigned.
3. **A common name collides** (`E0098`). A contractor's display name matches a contact of a
   different project, and contact-name evidence (0.60) files it there. The intended project was
   misspelt in the subject ("Gelnrock") and lost to the collision.
4. **The detectors read notices, not people** (milestones, `prose:ship_moved`, 10 of 10 missed).
   *"Due to a motor delay the ship date moves from 6/30/2027 to 7/7/2027"* never reaches a
   detector, because they only parse vendor ship-date reports. The bench routes these to review
   because the text contains milestone vocabulary.
5. **An unchanged date is not a change** (`notice:ship_unchanged`, 8 of 8 correct). A second
   confirmation with the same ship date is recognised and correctly reported as no change. The
   comparison works line by line, so a split shipment added later is not reported as a change
   either (unit-tested).

## 5. Limitations

* **Synthetic data, written by the tool's author.** The generators use the tool's own message
  schema and evidence types, so the notice cases are close to what the detectors were written for.
  Prose and `unseen:*` cases measure what happens outside that. Real mail is longer and messier.
* **The 94 % real-world agreement figure is not reproducible here.** Only the synthetic benchmark
  is.
* **The glue is mine, not the tool's.** How the tool's output is mapped to benchmark labels and
  confidences (for example the confidence given to "no detector fired") is a set of documented
  constants in [`bench/src/engbench/tasks.py`](bench/src/engbench/tasks.py).
* **The layout check is partial.** 28 of 44 criteria run from text. Geometry, mail and judgement
  criteria are left out, and the drawing task in the benchmark does not use the tool's check.
* **The LLM results are pending.** Until the run with a key, this repository shows that the
  rules-plus-review design works and where an LLM would have to help. It does not yet show that
  the LLM helps.

## 6. Reproduce

```bash
npm test
```

```bash
cd bench && pip install -e ".[dev]" && pytest
```

```bash
cd bench && bench verify        # re-runs everything offline and checks the committed numbers
```

LLM runs (the key is read only from the environment; a dry upper-bound estimate runs first and the run stops before any call if it exceeds the limit, US$1 by default):

```bash
cd bench && bench estimate --pipeline hybrid && bench run --pipeline hybrid --task all
```

Docker runs the JS tests and `bench verify`:

```bash
docker build -t projecttracker-core . && docker run --rm projecttracker-core
```
