"""LLM access with a replay cache, cost accounting and a hard spend limit.

* The API key is read **only** from the ``ANTHROPIC_API_KEY`` environment variable. No ``.env``
  files are read, ever.
* Every live response is appended to ``results/cache/<task>__<model>.jsonl`` keyed by a hash of
  (model, effort, system prompt, user prompt, schema). ``--offline`` replays from that cache so
  CI and readers can reproduce the numbers without a key.
* Replayed items report the cost and latency measured when they were first recorded, so offline
  reports are identical to the original run.
* A run stops with ``BudgetExceeded`` before any call that would start after the limit is hit.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .config import DEFAULT_EFFORT, DEFAULT_MODEL, MAX_TOKENS, PRICING, THINKING_OFF_MODELS


class CacheMiss(RuntimeError):
    pass


class BudgetExceeded(RuntimeError):
    pass


class MissingKey(RuntimeError):
    pass


@dataclass
class Budget:
    """Spend limit shared by every client in one CLI invocation (all tasks together)."""

    limit_usd: float = 1.0
    spent_usd: float = 0.0
    # Stop while there is still this much headroom, so the last call cannot push past the limit.
    reserve_usd: float = 0.002


@dataclass
class LLMResult:
    data: dict | None
    stop_reason: str
    usage: dict
    cost_usd: float
    latency_s: float
    cached: bool
    error: str | None = None


# backend(system, user, schema) -> {"text", "stop_reason", "usage", "latency_s"}
Backend = Callable[[str, str, dict], dict]


def price(model: str, usage: dict) -> float:
    p = PRICING.get(model)
    if p is None:
        return float("nan")
    inp = p["input"]
    return (
        usage.get("input_tokens", 0) * inp
        + usage.get("cache_creation_input_tokens", 0) * inp * 1.25
        + usage.get("cache_read_input_tokens", 0) * inp * 0.10
        + usage.get("output_tokens", 0) * p["output"]
    ) / 1e6


def anthropic_backend(model: str, effort: str, max_tokens: int = MAX_TOKENS) -> Backend:
    """Build a backend using the official SDK. Imported lazily so rules-only runs need no SDK."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise MissingKey(
            "ANTHROPIC_API_KEY is not set. Set it for live LLM runs, or use --offline to replay "
            "cached responses from results/cache/."
        )
    import anthropic

    client = anthropic.Anthropic(api_key=key, max_retries=4)

    extra = {"thinking": {"type": "disabled"}} if model in THINKING_OFF_MODELS else {}

    def call(system: str, user: str, schema: dict) -> dict:
        t0 = time.perf_counter()
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            **extra,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": schema},
            },
        )
        latency = time.perf_counter() - t0
        text = next((b.text for b in resp.content if b.type == "text"), "")
        u = resp.usage
        usage = {
            "input_tokens": u.input_tokens,
            "output_tokens": u.output_tokens,
            "cache_creation_input_tokens": u.cache_creation_input_tokens or 0,
            "cache_read_input_tokens": u.cache_read_input_tokens or 0,
        }
        return {"text": text, "stop_reason": resp.stop_reason, "usage": usage,
                "latency_s": latency}

    return call


NODE_HELPER = Path(__file__).resolve().parents[2] / "node" / "messages.js"


def node_backend(model: str, effort: str, max_tokens: int = MAX_TOKENS) -> Backend:
    """Direct HTTPS call through bench/node/messages.js (native fetch, no SDK).

    Used by default: on some Windows machines the Python SDK's compiled dependency is blocked.
    The key travels only through the environment, never on a command line.
    """
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise MissingKey(
            "ANTHROPIC_API_KEY is not set. Set it for live LLM runs, or use --offline to replay "
            "cached responses from results/cache/."
        )
    node = os.environ.get("PTCORE_NODE") or shutil.which("node")
    if not node:
        raise MissingKey("Node.js >= 20 is needed for live LLM calls (set PTCORE_NODE).")

    def call(system: str, user: str, schema: dict) -> dict:
        req = {"model": model, "max_tokens": max_tokens, "effort": effort,
               "thinking_off": model in THINKING_OFF_MODELS, "system": system, "user": user,
               "schema": schema}
        out = subprocess.run([node, str(NODE_HELPER)], input=json.dumps(req), capture_output=True,
                             text=True, encoding="utf-8", check=False)
        if out.returncode != 0:
            raise RuntimeError(f"Messages API call failed: {out.stderr.strip()[:300]}")
        return json.loads(out.stdout)

    return call


def default_backend(model: str, effort: str) -> Backend:
    if os.environ.get("ENGBENCH_BACKEND", "node") == "sdk":
        return anthropic_backend(model, effort)
    return node_backend(model, effort)


@dataclass
class LLMClient:
    task: str
    model: str = DEFAULT_MODEL
    effort: str = DEFAULT_EFFORT
    cache_dir: Path = Path("results/cache")
    offline: bool = False
    budget: Budget = field(default_factory=Budget)
    backend: Backend | None = None
    n_live: int = 0
    n_replayed: int = 0
    _cache: dict[str, dict] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.cache_dir = Path(self.cache_dir)
        if self.cache_path.exists():
            for line in self.cache_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    rec = json.loads(line)
                    self._cache[rec["key"]] = rec

    @property
    def cache_path(self) -> Path:
        return self.cache_dir / f"{self.task}__{self.model}.jsonl"

    def key(self, system: str, user: str, schema: dict) -> str:
        blob = json.dumps(
            {"model": self.model, "effort": self.effort, "system": system, "user": user,
             "schema": schema},
            sort_keys=True,
        )
        return hashlib.sha256(blob.encode()).hexdigest()[:24]

    def has(self, system: str, user: str, schema: dict) -> bool:
        return self.key(system, user, schema) in self._cache

    def call(self, system: str, user: str, schema: dict, item_id: str = "") -> LLMResult:
        k = self.key(system, user, schema)
        rec = self._cache.get(k)
        cached = rec is not None
        if rec is None:
            if self.offline:
                raise CacheMiss(f"no cached response for {self.task}/{item_id} ({k})")
            if self.budget.spent_usd + self.budget.reserve_usd > self.budget.limit_usd:
                raise BudgetExceeded(
                    f"spent ${self.budget.spent_usd:.2f} >= limit ${self.budget.limit_usd:.2f}")
            if self.backend is None:
                self.backend = default_backend(self.model, self.effort)
            raw = self.backend(system, user, schema)
            rec = {
                "key": k, "task": self.task, "item_id": item_id, "model": self.model,
                "effort": self.effort, "user": user, **raw,
                "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            self._cache[k] = rec
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with self.cache_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            self.n_live += 1
        else:
            self.n_replayed += 1
        cost = price(self.model, rec["usage"])
        if not cached:
            self.budget.spent_usd += cost
        data, err = None, None
        if rec["stop_reason"] == "refusal":
            err = "refusal"
        else:
            try:
                data = json.loads(rec["text"])
            except (json.JSONDecodeError, TypeError) as e:
                err = f"bad_json: {e}"
        return LLMResult(data, rec["stop_reason"], rec["usage"], cost, rec["latency_s"], cached,
                         err)
