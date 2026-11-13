"""Command-line entry point: ``bench generate | run | report | estimate``."""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

from . import PIPELINES, TASKS
from .config import (
    DEFAULT_EFFORT,
    DEFAULT_MAX_COST_USD,
    DEFAULT_MODEL,
    DEFAULT_N,
    DEFAULT_SEED,
    MAX_TOKENS,
    PRICING,
    RULES_ACCEPT,
)
from .data.common import write_jsonl
from .llm import Budget, BudgetExceeded, CacheMiss, LLMClient, MissingKey, price
from .metrics import summarize
from .pipelines import run_pipeline
from .report import write_report
from .tasks import load_task


def _expand(value: str, choices: tuple[str, ...]) -> list[str]:
    return list(choices) if value == "all" else [value]


def cmd_generate(args) -> int:
    out = Path(args.data_dir)
    for name in _expand(args.task, TASKS):
        task = load_task(name, args.n, args.seed)
        write_jsonl(out / f"{name}.jsonl", [asdict(it) for it in task.items])
        if name == "email":
            write_jsonl(out / "projects.jsonl", [asdict(p) for p in task.projects])
        print(f"wrote {len(task.items)} {name} items -> {out / (name + '.jsonl')}")
    return 0


def _needed_llm_items(task, pipeline: str) -> list:
    if pipeline == "llm":
        return list(task.items)
    return [it for it in task.items
            if any(p.confidence < RULES_ACCEPT[task.name] for p in task.rules(it).values())]


def cmd_run(args) -> int:
    results = Path(args.results_dir)
    results.mkdir(parents=True, exist_ok=True)
    budget = Budget(limit_usd=args.max_cost_usd)
    status = 0
    if not args.offline and any(p in ("llm", "hybrid") for p in _expand(args.pipeline, PIPELINES)):
        rows = plan_live_calls(args)
        upper = sum(r[3] for r in rows)
        print(f"pre-flight: {sum(r[2] for r in rows)} live calls, upper bound ${upper:.4f} "
              f"(limit ${args.max_cost_usd:.2f})")
        if upper > args.max_cost_usd:
            print("[stop] the upper-bound estimate is over the limit; lower --n or raise "
                  "--max-cost-usd. No call was made.")
            return 5
    for name in _expand(args.task, TASKS):
        task = load_task(name, args.n, args.seed)
        for pipe in _expand(args.pipeline, PIPELINES):
            client = None
            if pipe in ("llm", "hybrid"):
                cache_dir = Path(args.cache_dir) if args.cache_dir else results / "cache"
                client = LLMClient(name, model=args.model, effort=args.effort,
                                   cache_dir=cache_dir, offline=args.offline, budget=budget)
                needed = _needed_llm_items(task, pipe)
                missing = [it for it in needed
                           if not client.has(task.system, task.user_prompt(it), task.schema)]
                if args.offline and missing and args.on_cache_miss == "skip":
                    print(f"[skip] {name}/{pipe}: {len(missing)}/{len(needed)} LLM responses not "
                          f"in cache for {args.model} (run once with ANTHROPIC_API_KEY set).")
                    continue
                print(f"[{name}/{pipe}] {len(needed)} items need the LLM, "
                      f"{len(needed) - len(missing)} cached, {len(missing)} live calls")
            try:
                miss_mode = "review" if args.on_cache_miss == "review" else "error"
                out = run_pipeline(task, pipe, client, on_cache_miss=miss_mode)
            except MissingKey as e:
                print(f"[skip] {name}/{pipe}: {e}")
                status = status or 2
                continue
            except CacheMiss as e:
                print(f"[error] {name}/{pipe}: {e}")
                return 4
            except BudgetExceeded as e:
                print(f"[stop] budget reached during {name}/{pipe}: {e}. Responses so far are "
                      "cached; raise --max-cost-usd to continue.")
                return 3
            run = out.to_dict()
            run["meta"].update({"seed": args.seed, "n": args.n})
            stem = f"{name}__{pipe}"
            (results / f"{stem}.json").write_text(json.dumps(run, indent=1), encoding="utf-8")
            s = summarize(run)
            (results / f"{stem}__summary.json").write_text(json.dumps(s, indent=1),
                                                           encoding="utf-8")
            live = f", live calls {client.n_live}" if client else ""
            print(f"[done] {name}/{pipe}: acc={s['accuracy']:.3f} review={s['review_rate']:.3f} "
                  f"silent_err={s['auto_error_rate']:.3f} cost/unit={s['cost_per_unit']:.2f} "
                  f"usd={s['usd_total']:.4f}{live}")
    print(f"total billed this invocation: ${budget.spent_usd:.4f}")
    md = write_report(results)
    print(f"report -> {md}")
    return status


def cmd_report(args) -> int:
    md = write_report(Path(args.results_dir))
    print(f"report -> {md}")
    return 0


def call_upper_bound_usd(task, it, model: str, max_tokens: int = MAX_TOKENS) -> float:
    """Worst-case cost of one call: no cache hits, about 3 characters per input token (English
    text and JSON run closer to 4, so this overestimates), and every call using all of max_tokens."""
    import json as _json

    chars = len(task.system) + len(task.user_prompt(it)) + len(_json.dumps(task.schema))
    return price(model, {"input_tokens": chars / 3 + 50, "output_tokens": max_tokens})


def plan_live_calls(args) -> list[tuple[str, str, int, float]]:
    """(task, pipeline, new calls, upper-bound USD) for the calls a run would make right now.
    Items already in the cache cost nothing; hybrid reuses responses cached by llm and vice versa."""
    rows = []
    for name in _expand(args.task, TASKS):
        task = load_task(name, args.n, args.seed)
        cache_dir = getattr(args, "cache_dir", None) or Path(args.results_dir) / "cache"
        client = LLMClient(name, model=args.model, effort=args.effort, cache_dir=Path(cache_dir))
        seen: set[str] = set()
        for pipe in [p for p in _expand(args.pipeline, PIPELINES) if p in ("llm", "hybrid")]:
            items = [it for it in _needed_llm_items(task, pipe)
                     if it.id not in seen and not client.has(task.system, task.user_prompt(it), task.schema)]
            seen |= {it.id for it in items}
            rows.append((name, pipe, len(items),
                         sum(call_upper_bound_usd(task, it, args.model) for it in items)))
    return rows


def cmd_estimate(args) -> int:
    """Dry pre-flight estimate: no API call is made."""
    if args.model not in PRICING:
        print(f"no price for {args.model}")
        return 1
    p = PRICING[args.model]
    print(f"model {args.model}: ${p['input']}/MTok in, ${p['output']}/MTok out; max_tokens {MAX_TOKENS}; "
          f"n={args.n} per task, seed {args.seed}")
    rows = plan_live_calls(args)
    for name, pipe, n, usd in rows:
        print(f"{name}/{pipe}: {n} new calls, upper bound ${usd:.4f}")
    total = sum(r[3] for r in rows)
    print(f"total upper bound ${total:.4f} for {sum(r[2] for r in rows)} calls "
          "(no caching, every call at max_tokens)")
    return 0


VERIFY_KEYS = ("accuracy", "macro_f1", "review_rate", "auto_error_rate", "cost_per_unit",
               "usd_total", "routes", "n_units")


def _same(a, b) -> bool:
    """Equal, treating floats as equal up to platform rounding (last-ulp differences)."""
    if isinstance(a, float) or isinstance(b, float):
        try:
            return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-12)
        except (TypeError, ValueError):
            return False
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return a == b


def cmd_verify(args) -> int:
    """Re-run every committed result offline (rules live, LLM from cache) and compare."""
    ref = Path(args.results_dir)
    refs = {p.name: json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(ref.glob("*__summary.json"))}
    if not refs:
        print(f"no summaries in {ref}")
        return 1
    first = json.loads((ref / next(iter(refs)).replace("__summary", "")).read_text())["meta"]
    tmp = Path(tempfile.mkdtemp(prefix="bench-verify-"))
    ns = build_parser().parse_args([
        "run", "--offline", "--on-cache-miss", "skip", "--results-dir", str(tmp),
        "--cache-dir", str(ref / "cache"), "--n", str(first["n"]), "--seed", str(first["seed"]),
    ])
    cmd_run(ns)
    bad = []
    for name, want in refs.items():
        got_path = tmp / name
        if not got_path.exists():
            bad.append(f"{name}: not reproduced (missing cached LLM responses?)")
            continue
        got = json.loads(got_path.read_text(encoding="utf-8"))
        for k in VERIFY_KEYS:
            if not _same(got.get(k), want.get(k)):
                bad.append(f"{name}: {k} {want.get(k)} != {got.get(k)}")
    for b in bad:
        print(f"[mismatch] {b}")
    print(f"verify: {len(refs) - len({b.split(':')[0] for b in bad})}/{len(refs)} runs reproduce")
    return 1 if bad else 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="bench", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, pipeline=True):
        p.add_argument("--task", default="all", choices=[*TASKS, "all"])
        if pipeline:
            p.add_argument("--pipeline", default="all", choices=[*PIPELINES, "all"])
        p.add_argument("--n", type=int, default=DEFAULT_N, help="items per task")
        p.add_argument("--seed", type=int, default=DEFAULT_SEED)

    g = sub.add_parser("generate", help="write the synthetic datasets to data/")
    common(g, pipeline=False)
    g.add_argument("--data-dir", default="data")
    g.set_defaults(func=cmd_generate)

    r = sub.add_parser("run", help="run pipelines and write results/*.json + report")
    common(r)
    r.add_argument("--model", default=DEFAULT_MODEL)
    r.add_argument("--effort", default=DEFAULT_EFFORT,
                   choices=["low", "medium", "high", "xhigh", "max"])
    r.add_argument("--offline", action="store_true",
                   help="replay cached LLM responses from results/cache/ (no API calls)")
    r.add_argument("--on-cache-miss", default="error", choices=["error", "skip", "review"],
                   help="offline only: fail, skip the pipeline, or route missing items to review")
    r.add_argument("--max-cost-usd", type=float, default=DEFAULT_MAX_COST_USD,
                   help="stop before spending more than this in one invocation")
    r.add_argument("--results-dir", default="results")
    r.add_argument("--cache-dir", default=None, help="default: <results-dir>/cache")
    r.set_defaults(func=cmd_run)

    rep = sub.add_parser("report", help="rebuild RESULTS.md and plots from results/")
    rep.add_argument("--results-dir", default="results")
    rep.set_defaults(func=cmd_report)

    e = sub.add_parser("estimate", help="rough LLM cost estimate before a live run")
    common(e)
    e.add_argument("--model", default=DEFAULT_MODEL)
    e.add_argument("--effort", default=DEFAULT_EFFORT)
    e.add_argument("--results-dir", default="results")
    e.set_defaults(func=cmd_estimate)

    v = sub.add_parser("verify", help="re-run offline and check committed results reproduce")
    v.add_argument("--results-dir", default="results")
    v.set_defaults(func=cmd_verify)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
