"""Write per-run JSON, the markdown results table and matplotlib plots."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from . import PIPELINES, TASKS

COLORS = {"rules": "#4C72B0", "rules_review": "#8172B3", "llm": "#DD8452", "hybrid": "#55A868"}
TASK_TITLES = {
    "email": "Email-to-project matching",
    "milestone": "Milestone detection",
    "drawing": "Drawing-vs-quote cross-check",
}


def load_summaries(results_dir: Path) -> dict[tuple[str, str], dict]:
    out = {}
    for p in sorted(results_dir.glob("*__summary.json")):
        s = json.loads(p.read_text(encoding="utf-8"))
        out[(s["task"], s["pipeline"])] = s
    return out


def _fmt_pct(x: float | None) -> str:
    return "-" if x is None else f"{100 * x:.1f}%"


def markdown_table(summaries: dict[tuple[str, str], dict]) -> str:
    lines = [
        "| Task | Pipeline | Accuracy (95% CI) | Macro-F1 | Review rate | Silent-error rate "
        "| Cost/unit (95% CI) | ECE | LLM calls | USD/item | Latency p50 |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for task in TASKS:
        for pipe in PIPELINES:
            s = summaries.get((task, pipe))
            if not s:
                continue
            ci = s["ci95"]
            lines.append(
                f"| {task} | {pipe} | {_fmt_pct(s['accuracy'])} "
                f"({_fmt_pct(ci['accuracy'][0])}-{_fmt_pct(ci['accuracy'][1])}) "
                f"| {s['macro_f1']:.3f} | {_fmt_pct(s['review_rate'])} "
                f"| {_fmt_pct(s['auto_error_rate'])} "
                f"| {s['cost_per_unit']:.2f} ({ci['cost_per_unit'][0]:.2f}-"
                f"{ci['cost_per_unit'][1]:.2f}) "
                f"| {s['calibration']['ece']:.3f} | {_fmt_pct(s['llm_call_rate'])} "
                f"| ${s['usd_per_item']:.4f} | {1000 * s['latency_s']['p50']:.2f} ms |"
            )
    return "\n".join(lines)


def case_table(summaries: dict[tuple[str, str], dict], task: str) -> str:
    pipes = [p for p in PIPELINES if (task, p) in summaries]
    if not pipes:
        return ""
    cases = sorted(summaries[(task, pipes[0])]["by_case"])
    head = "| Case | n | " + " | ".join(f"{p} acc" for p in pipes) + " |"
    lines = [head, "|---|---|" + "---|" * len(pipes)]
    for c in cases:
        n = summaries[(task, pipes[0])]["by_case"][c]["n"]
        cells = [_fmt_pct(summaries[(task, p)]["by_case"].get(c, {}).get("accuracy"))
                 for p in pipes]
        lines.append(f"| {c} | {n} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def plot_tradeoff(summaries, task: str, out: Path) -> Path | None:
    pipes = [p for p in PIPELINES if (task, p) in summaries]
    if not pipes:
        return None
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    for p in pipes:
        s = summaries[(task, p)]
        pts = sorted(s["tradeoff"], key=lambda d: d["review_rate"])
        rr = [100 * d["review_rate"] for d in pts]
        axes[0].plot(rr, [100 * d["auto_error_rate"] for d in pts], color=COLORS[p], label=p)
        axes[1].plot(rr, [d["cost_per_unit"] for d in pts], color=COLORS[p], label=p)
        axes[0].scatter([100 * s["review_rate"]], [100 * s["auto_error_rate"]], color=COLORS[p],
                        edgecolor="black", zorder=5)
        axes[1].scatter([100 * s["review_rate"]], [s["cost_per_unit"]], color=COLORS[p],
                        edgecolor="black", zorder=5)
    axes[0].set_xlabel("Review rate (%)")
    axes[0].set_ylabel("Silent (auto-decided) error rate (%)")
    axes[0].set_title("Review vs silent errors")
    axes[1].set_xlabel("Review rate (%)")
    axes[1].set_ylabel("Expected cost per unit")
    axes[1].set_title("Review vs expected cost")
    for ax in axes:
        ax.grid(alpha=0.3)
        ax.legend(frameon=False)
    fig.suptitle(f"{TASK_TITLES[task]} - dots = pre-registered operating point")
    fig.tight_layout()
    path = out / f"tradeoff_{task}.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


def plot_reliability(summaries, task: str, out: Path) -> Path | None:
    pipes = [p for p in PIPELINES if (task, p) in summaries]
    if not pipes:
        return None
    fig, ax = plt.subplots(figsize=(4.8, 4.4))
    ax.plot([0, 1], [0, 1], ls="--", color="grey", lw=1)
    for p in pipes:
        bins = summaries[(task, p)]["calibration"]["bins"]
        ece = summaries[(task, p)]["calibration"]["ece"]
        ax.plot([b["mean_conf"] for b in bins], [b["accuracy"] for b in bins], marker="o",
                color=COLORS[p], label=f"{p} (ECE {ece:.3f})")
    ax.set_xlabel("Mean stated confidence")
    ax.set_ylabel("Observed accuracy")
    ax.set_xlim(0, 1.02)
    ax.set_ylim(0, 1.02)
    ax.set_title(f"Reliability - {task}")
    ax.legend(frameon=False, fontsize=8)
    ax.grid(alpha=0.3)
    fig.tight_layout()
    path = out / f"reliability_{task}.png"
    fig.savefig(path, dpi=130)
    plt.close(fig)
    return path


def write_report(results_dir: Path) -> Path:
    summaries = load_summaries(results_dir)
    plots = results_dir / "plots"
    plots.mkdir(parents=True, exist_ok=True)
    parts = ["# Results\n", "Generated by `bench report`. Units: email/milestone = one per item; "
             "drawing = four per item (one per field).\n", markdown_table(summaries), ""]
    for task in TASKS:
        tp = plot_tradeoff(summaries, task, plots)
        rp = plot_reliability(summaries, task, plots)
        if tp is None:
            continue
        parts += [f"\n## {TASK_TITLES[task]}\n", f"![tradeoff](plots/{tp.name})",
                  f"![reliability](plots/{rp.name})\n" if rp else "",
                  "Accuracy by case:\n", case_table(summaries, task), ""]
    md = results_dir / "RESULTS.md"
    md.write_text("\n".join(parts) + "\n", encoding="utf-8")
    return md
