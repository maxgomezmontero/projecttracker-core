"""The three pipelines under comparison.

* ``rules``  - deterministic baseline; every unit is auto-decided.
* ``llm``    - one structured-output call per item; every unit is auto-decided unless the call
               fails or is refused (then it goes to human review, since nothing else could
               decide it).
* ``rules_review`` - ablation: the hybrid router with the LLM removed (rules or human review).
* ``hybrid`` - rules decide when their confidence >= RULES_ACCEPT; otherwise the LLM is asked
               and decides when its confidence >= LLM_ACCEPT; everything else goes to review.

Confidence is kept on every unit so the review-rate / error-rate curve can be swept afterwards
for all three pipelines.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field

from .config import LLM_ACCEPT, RULES_ACCEPT
from .llm import CacheMiss, LLMClient
from .tasks import Pred


@dataclass
class Unit:
    item_id: str
    field: str
    case: str
    truth: str
    pred: str
    confidence: float
    route: str  # "rules" | "llm" | "review"
    truth_extra: dict = field(default_factory=dict)
    pred_extra: dict = field(default_factory=dict)


@dataclass
class ItemTrace:
    item_id: str
    llm_called: bool
    cost_usd: float
    latency_s: float
    replayed: bool = False
    error: str | None = None


@dataclass
class RunOutput:
    task: str
    pipeline: str
    model: str | None
    units: list[Unit]
    traces: list[ItemTrace]
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "task": self.task, "pipeline": self.pipeline, "model": self.model,
            "meta": self.meta,
            "units": [asdict(u) for u in self.units],
            "traces": [asdict(t) for t in self.traces],
        }


def _llm_preds(task, it, client: LLMClient, on_cache_miss: str):
    """Returns (preds | None, ItemTrace-ish fields)."""
    try:
        res = client.call(task.system, task.user_prompt(it), task.schema, task.item_id(it))
    except CacheMiss:
        if on_cache_miss == "error":
            raise
        return None, 0.0, 0.0, False, "cache_miss"
    if res.data is None:
        return None, res.cost_usd, res.latency_s, res.cached, res.error
    return task.parse(res.data), res.cost_usd, res.latency_s, res.cached, None


def run_pipeline(task, pipeline: str, client: LLMClient | None = None,
                 on_cache_miss: str = "error", rules_accept: float | None = None,
                 llm_accept: float = LLM_ACCEPT) -> RunOutput:
    if rules_accept is None:
        rules_accept = RULES_ACCEPT[task.name]
    units: list[Unit] = []
    traces: list[ItemTrace] = []
    for it in task.items:
        iid = task.item_id(it)
        truth = task.truth(it)
        t0 = time.perf_counter()
        cost = latency = 0.0
        replayed = called = False
        err = None
        chosen: dict[str, tuple[Pred, str]] = {}

        if pipeline == "rules":
            r = task.rules(it)
            chosen = {f: (p, "rules") for f, p in r.items()}
            latency = time.perf_counter() - t0
        elif pipeline == "rules_review":
            # Ablation: hybrid routing with the LLM removed (low-confidence -> human review).
            r = task.rules(it)
            chosen = {f: (p, "rules" if p.confidence >= rules_accept else "review")
                      for f, p in r.items()}
            latency = time.perf_counter() - t0
        elif pipeline == "llm":
            assert client is not None
            called = True
            preds, cost, latency, replayed, err = _llm_preds(task, it, client, on_cache_miss)
            if preds is None:
                fallback = Pred("none" if task.name != "drawing" else "mismatch", 0.0)
                chosen = {f: (fallback, "review") for f in task.fields}
            else:
                chosen = {f: (p, "llm") for f, p in preds.items()}
        elif pipeline == "hybrid":
            assert client is not None
            r = task.rules(it)
            rules_latency = time.perf_counter() - t0
            low = [f for f, p in r.items() if p.confidence < rules_accept]
            chosen = {f: (p, "rules") for f, p in r.items() if f not in low}
            latency = rules_latency
            if low:
                called = True
                preds, cost, llm_latency, replayed, err = _llm_preds(task, it, client,
                                                                     on_cache_miss)
                latency += llm_latency
                for f in low:
                    if preds is not None and preds[f].confidence >= llm_accept:
                        chosen[f] = (preds[f], "llm")
                    else:
                        best = preds[f] if preds is not None else r[f]
                        chosen[f] = (best, "review")
        else:
            raise ValueError(pipeline)

        for f in task.fields:
            p, route = chosen[f]
            units.append(Unit(iid, f, task.case(it), truth[f].label, p.label, p.confidence,
                              route, truth[f].extra, p.extra))
        traces.append(ItemTrace(iid, called, cost, latency, replayed, err))

    meta = {
        "rules_accept": rules_accept if pipeline in ("hybrid", "rules_review") else None,
        "llm_accept": llm_accept if pipeline == "hybrid" else None,
        "effort": client.effort if client else None,
        "n_items": len(task.items),
    }
    return RunOutput(task.name, pipeline, client.model if client else None, units, traces, meta)
