# bench: real rules core vs pure LLM, on synthetic engineering documents

Python 3.11+, with Node ≥ 20 on the PATH. For the email and milestone tasks, the `rules` pipeline
runs the real extracted JavaScript (`../lib`) through `../cli/ptcore.js`, in one subprocess call
per task ([`src/engbench/ptcore.py`](src/engbench/ptcore.py)). The drawing task uses a bench-only
Python baseline ([`src/engbench/rules.py`](src/engbench/rules.py)).

## Pipelines

| Pipeline | Logic |
|---|---|
| `rules` | The tool decides every item |
| `rules_review` | Ablation without an LLM: rules decide when confidence ≥ the task threshold (email 0.88, the tool's own auto-attach level; milestone and drawing 0.85); everything else goes to human review |
| `llm` | One call per item: `anthropic` SDK, structured outputs (`output_config.format`), `claude-opus-5-5` at `effort=low`, self-reported confidence. Refusals and malformed output go to review |
| `hybrid` | Rules when confident; otherwise the LLM decides if its confidence is ≥ 0.70; otherwise human review |

Thresholds, costs and glue constants were fixed before the first run
([`config.py`](src/engbench/config.py), [`tasks.py`](src/engbench/tasks.py)).

### Mapping the tool's output to labels (bench-side glue)

* **Email.** A project whose match confidence is ≥ 0.45 is the prediction, at the tool's own
  confidence. Otherwise the prediction is `none`: at 0.90 when the tool classifies the mail as noise
  (it asks only for unmatched mail, as its inbox does), at 0.80 when there is no evidence at all,
  and at 1 − confidence when there is weak evidence.
* **Milestones.** The active detectors run. A `ship-date-changed` / `order-accepted` / `submittals` /
  `new-opportunity` result maps to the label at 0.95. If no detector fired, the tool's status rules
  can still read a customer PO in prose (→ `order_accepted` at 0.80). Otherwise the prediction is
  `none`: at 0.60 if the text uses milestone vocabulary, 0.90 if not.

## Metrics

Accuracy and macro-F1 (a ship-date change counts only if both dates are right); silent-error rate
(automatic and wrong); asymmetric expected cost per item (wrong project 10, project dropped to
`none` 3, junk filed 4; false milestone or wrong dates 6, missed milestone 3; drawing: missed
mismatch 12 … false alarm 1.5; review 1); ECE and reliability plots; review-rate vs error-rate
curves; USD and latency per item; 95 % bootstrap CIs over items.

## Pre-registered hypotheses for the LLM run

* **H1.** `llm` beats `rules` on `prose:*` milestones and `unseen:*` emails, and is not better on
  notices or identifier cases.
* **H2.** On the drawing task, `llm` is less reliable than the rules on the 2.5 % near-miss
  boundary, which is an arithmetic job.
* **H3.** `hybrid` has a lower expected cost than both `rules_review` and `llm` on at least two
  tasks, at under half of `llm`'s USD per item.
* **H4.** The LLM's stated confidence is worse calibrated (higher ECE) than the tool's.

## Reproduce

```bash
pip install -e ".[dev]" && pytest && ruff check .
```

```bash
bench run --pipeline rules --task all
```

```bash
bench verify
```

```bash
bench estimate --pipeline all --task all
```

LLM runs read the key **only** from `ANTHROPIC_API_KEY` (no `.env` file is ever read), cache every
response in `results/cache/`, and stop before spending more than `--max-cost-usd` (default 5):

```bash
bench run --pipeline all --task all
```

Anyone can then replay the run without a key:

```bash
bench run --pipeline all --task all --offline
```

On Windows machines where Smart App Control blocks `bench.exe` or the SDK's compiled `jiter`
module, use `python -m engbench …` for everything except the live LLM run. For that run, use
Docker, WSL or CI.
