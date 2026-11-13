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
own auto-attach level; everything else goes to a human), `llm` (Claude Haiku 5.5 over HTTPS, structured
outputs, every item), and `hybrid` (rules when confident, the LLM in the uncertain band, a human below 0.70).
Errors are priced asymmetrically: filing into the wrong project costs 10, a review costs 1. The
thresholds and costs were fixed before the first run. The full method is in
[bench/README.md](bench/README.md).

### Results (seed 2026, n = 150 per task; LLM = Claude Haiku 5.5, total real cost US$0.03)

| Task | Pipeline | Accuracy (95 % CI) | Review rate | Silent errors | Severe errors¹ | Cost / item² | ECE |
|---|---|---|---|---|---|---|---|
| email | rules (real tool) | 94.0 % (90.0-97.3) | 0 % | 6.0 % | 1 | 0.24 | 0.134 |
| email | rules + review at 0.88 | 94.0 % | 38.0 % | 0.0 % | 0 | 0.38 | 0.134 |
| email | LLM only | 97.3 % (94.0-99.3) | 0 % | 2.7 % | 0 | **0.08** | 0.111 |
| email | **hybrid** | 97.3 % (94.0-99.3) | 14.7 % | **0.0 %** | 0 | 0.15 | 0.097 |
| milestones | rules (real tool) | 77.3 % (70.7-84.0) | 0 % | 22.7 % | 0 | 0.68 | 0.130 |
| milestones | rules + review at 0.85 | 77.3 % | 42.7 % | 0.0 % | 0 | 0.43 | 0.130 |
| milestones | LLM only | 98.0 % (95.3-100) | 0 % | 2.0 % | 0 | 0.06 | 0.082 |
| milestones | **hybrid** | 98.0 % (95.3-100) | 2.0 % | **0.0 %** | 0 | **0.02** | 0.085 |
| drawing | rules (bench baseline) | 96.2 % (94.7-97.7) | 0 % | 3.8 % | 0 | 0.06 | 0.040 |
| drawing | rules + review | 96.2 % | 3.7 % | 1.2 % | 0 | 0.06 | 0.040 |
| drawing | LLM only | **75.2 %** (72.3-78.3) | 0 % | 24.8 % | **15** | 0.74 | 0.192 |
| drawing | **hybrid** | **98.7 %** (97.7-99.5) | 0 % | 1.3 % | 0 | **0.03** | 0.039 |

¹ Severe = the most expensive kind of error, made automatically: email filed to the **wrong
project**; a false milestone or wrong ship dates pushed toward the ERP; a drawing **mismatch passed
as a match**. ² Expected cost per item with review = 1 and the asymmetric error costs in
[`config.py`](bench/src/engbench/config.py). Full table, plots and per-case results:
[bench/results/RESULTS.md](bench/results/RESULTS.md). Raw responses: `bench/results/cache/`.

**Cost and speed.** 443 API calls (the hybrid reuses the LLM pipeline's cached answers) cost
**US$0.0303** in total, about US$0.00007 per call. About 600 k input tokens (the shared system
prompts) were read from the prompt cache instead of being billed at full price. The hybrid sends only 38 % of emails, 43 % of milestone messages
and 15 % of drawings to the model. An LLM call takes about 1.2 s (p50); the rules take under 1 ms.
`bench verify` replays all 12 runs from the cache for free and gets identical numbers.

**What this says.**

* **Hybrid is the only setup with zero silent errors on email and milestones, and it is the most
  accurate on drawings.** The tool decides what it is sure about (all 93 + 86 such decisions were
  right). The LLM resolves most of the uncertain band, and a human sees 22 emails and 3 milestone
  messages instead of 57 and 64.
* **The LLM reads prose; the rules do arithmetic.** On milestones the LLM is near perfect on the
  prose the detectors cannot read (98 % against 77 %). On the drawing check, pure LLM drops to 75 %
  and passes **15 real mismatches as matches**, 14 of them with confidence ≥ 0.9. In the hybrid it only sees
  the 22 fields the parser could not read, and gets 21 of them right.
* **The surprise: on email, pure LLM has the lowest expected cost** (0.08 against the hybrid's
  0.15). Its 4 errors are all "not a project" answers at confidence ≤ 0.45, which cost 3 each. The
  hybrid sends those same 4 to review, but also 18 items the LLM had right at low confidence, and
  each review costs 1. With these cost weights, the cautious design pays for its caution on email.
  It never files to the wrong project in either setup.
* **Calibration depends on the task.** The LLM's stated confidence is better calibrated than the
  bench's rule confidences on email and milestones (ECE 0.11 / 0.08 against 0.13 / 0.13), but
  much worse on the drawing check (0.19 against 0.04). There it is most confident when it is
  wrong.

**Pre-registered hypotheses** ([bench/README.md](bench/README.md)):

| | Hypothesis | Verdict |
|---|---|---|
| H1 | LLM beats rules on prose / unseen phrasing, and is not better on notices or identifiers | **Supported.** Prose milestones are almost all right (only the 3 "sister plant" RFQs missed). Notices are 100 % for both. On identifier and contact emails the LLM is worse (4 misses, against 1 for the rules) |
| H2 | LLM is less reliable on the 2.5 % near-miss boundary | **Supported, strongly.** 75 % against 96 %, with 15 missed mismatches |
| H3 | Hybrid has a lower expected cost than both rules + review and LLM on ≥ 2 tasks, at < ½ the LLM's USD | **Supported** on milestones and drawings, at 15-39 % of the LLM's spend; **not** on email (see above) |
| H4 | The LLM's confidence is worse calibrated than the tool's | **Mixed.** True only on the drawing task |

A held-out seed (7) was run for the rules pipelines only (email 89.3 %, milestones 82.0 %, both
with 0 silent errors under review): [bench/results/heldout_seed7](bench/results/heldout_seed7/RESULTS.md).

### Failure modes (concrete, from the runs)

1. **The LLM passes a 12 % mismatch as a match** (drawing `D0042`, confidence 0.95). The layout
   says the booth is 22'-0" wide and the quote says *"297 in wide"*. That is 24'-9", but the model
   answered `match`. The unit-aware parser computes 12.5 % and flags it. The arithmetic belongs in
   code.
2. **The LLM flags identical electrical scopes** (`D0005`, confidence 0.93). Drawing: *"TURNKEY BY
   VENDOR"*; quote: *"supply and install of control panel … by Example Finishing Systems"*. It
   answered `mismatch`, one of 24 such false alarms. The rules map both phrasings to the same
   category.
3. **The detectors read notices, not people** (`prose:ship_moved`, 10 of 10 missed by the rules).
   *"Due to a motor delay the ship date moves from 6/30/2027 to 7/7/2027"* never reaches a
   detector. The LLM gets both dates right on all 10, and in the hybrid it decides them without a
   human.
4. **A newsletter names a client** (`E0001`, *"Case study: Granite Rail Products"*). The tool's
   client-name evidence adds up to 0.67 and points at that client's project. That is below the
   0.88 auto-attach line, so the hybrid asks the LLM, which says `none`.
5. **The LLM misses plain contact evidence** (`E0012`, `E0115`). The sender is a known contact of
   exactly one project, which the tool scores at 0.78. The LLM answered `none` at confidence
   0.35-0.45. In the hybrid these go to a human; with LLM only they are silent errors.
6. **"Sister plant" RFQs** (`M0092`, `M0145`, `M0149`). *"Our sister plant is looking at adding an
   overhead conveyor. Who should they talk to about pricing?"* was read as `none` by the LLM at low
   confidence and goes to review in the hybrid. It is the only prose family the LLM missed.

## 5. Limitations

* **Synthetic data, written by the tool's author.** The generators use the tool's own message
  schema and evidence types, so the notice cases are close to what the detectors were written for.
  Prose and `unseen:*` cases measure what happens outside that. Real mail is longer and messier.
* **The 94 % real-world agreement figure is not reproducible here.** Only the synthetic benchmark
  is.
* **One small model, one run.** Haiku 5.5 at `effort=low` with thinking off was chosen for a
  US$1 budget. A larger model or more effort would likely do better on the drawing arithmetic.
  n = 150 per task, so differences of a few points are within the CIs.
* **The glue is mine, not the tool's.** How the tool's output is mapped to benchmark labels and
  confidences (for example the confidence given to "no detector fired") is a set of documented
  constants in [`bench/src/engbench/tasks.py`](bench/src/engbench/tasks.py).
* **The layout check is partial.** 28 of 44 criteria run from text. Geometry, mail and judgement
  criteria are left out, and the drawing task in the benchmark does not use the tool's check.
* **The costs are assumptions.** On email, the ranking of pure LLM against the hybrid flips with
  the price of a review compared with the price of a dropped email.

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

LLM runs (the key is read only from the environment; a dry upper-bound estimate runs first and the run stops before any call if it exceeds the limit, US$1 by default). Calls go over HTTPS from a small Node helper (`bench/node/messages.js`, native `fetch`):

```bash
cd bench && bench estimate --pipeline hybrid && bench run --pipeline hybrid --task all
```

Docker runs the JS tests and `bench verify`:

```bash
docker build -t projecttracker-core . && docker run --rm projecttracker-core
```
