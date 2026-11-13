# Data card: synthetic benchmark data

There is no trained model here. This card describes the generators in `src/engbench/data/`.

| | |
|---|---|
| Purpose | Compare the ProjectTracker rules core, an LLM and a hybrid with human review |
| Tasks | email → project, milestone detection, drawing-vs-quote check |
| Size and seed | 150 items per task by default (`--n`), seed 2026, held-out check with seed 7 |
| Determinism | Same seed, identical data (tested) |
| Real data | **None** |

**Entities.** There are 12 projects for 8 fictional clients. Four clients have two sibling
projects that share a contact. Project numbers follow the tool's format (`N26-6402`), and bare
numbers are at least 3 edits apart. Each project has an ERP opportunity, a fictional vendor
order number, two known threads and contacts. Every domain is under `.example`. Names are random
pairs from generic lists, so some collide across projects; that is realistic and shows up as a
failure mode.

**Email cases.** Each message carries one kind of evidence: a project number, a bare job number,
an ERP opportunity, a vendor order, a thread reply, a unique contact, a shared contact plus a
place hint, a new person at the client's domain plus a place word, a typo in the number, a
colleague's forward, two projects in one mail, or a reply on another project's thread. The `none`
cases are newsletters (one names a client), vendor marketing and internal admin. The `unseen:`
cases are contractors who name only the client and scope, and misspelt place names.

**Milestone cases.** `notice:*` messages are vendor PO acceptance reports, vendor submittal
revisions, ship-date confirmations, ERP new-opportunity notices, plus hard negatives: replies to
notices, an unchanged ship date (with the earlier notice in `history`), our own PO sent to a
vendor, portal reminders and out-of-office replies. `prose:*` messages are a customer PO, an award,
approved submittals, a ship date moved (four date formats), an RFQ, plus hard negatives: a hedged
order, a request for submittals and meeting notes.

**Drawing cases.** Layout notes are compared with quote lines on four fields. Gold labels are
computed from the numbers as rendered in the text. A quarter of the items sit close to the
2.5 % boundary, and two length formats are not covered by the baseline's parser.

**Limitations.** The data comes from templates and was written by the tool's author. The case
mix is a design choice, so read the per-case tables in `results/RESULTS.md`. Error costs are one
engineer's judgement. Everything is in English with US units and US date formats.
