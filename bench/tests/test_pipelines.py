import pytest

from engbench.config import RULES_ACCEPT
from engbench.llm import Budget, BudgetExceeded, CacheMiss, LLMClient, MissingKey, price
from engbench.metrics import summarize
from engbench.pipelines import run_pipeline
from engbench.tasks import load_task


def _client(task, tmp_path, backend=None, offline=False, budget=None):
    return LLMClient(task.name, model="claude-opus-5-5", cache_dir=tmp_path, offline=offline,
                     backend=backend, budget=budget or Budget(5.0))


@pytest.mark.parametrize("name", ["email", "milestone", "drawing"])
def test_rules_pipeline_runs_and_scores(name):
    task = load_task(name, 30, 1)
    run = run_pipeline(task, "rules").to_dict()
    s = summarize(run)
    assert s["n_items"] == 30
    assert s["n_units"] == 30 * len(task.fields)
    assert s["review_rate"] == 0
    assert 0 <= s["accuracy"] <= 1
    assert s["usd_total"] == 0


@pytest.mark.parametrize("name", ["email", "milestone", "drawing"])
def test_llm_pipeline_with_fake_backend(name, tmp_path, fake_backend):
    task = load_task(name, 25, 2)
    backend = fake_backend(task)
    run = run_pipeline(task, "llm", _client(task, tmp_path, backend)).to_dict()
    s = summarize(run)
    assert backend.calls == 25
    assert s["accuracy"] == 1.0
    assert s["usd_total"] == pytest.approx(25 * price("claude-opus-5-5", {
        "input_tokens": 1000, "output_tokens": 100}))


def test_hybrid_calls_llm_only_for_low_confidence(tmp_path, fake_backend):
    task = load_task("milestone", 60, 3)
    backend = fake_backend(task)
    out = run_pipeline(task, "hybrid", _client(task, tmp_path, backend))
    low = [it for it in task.items if task.rules(it)[""].confidence < RULES_ACCEPT[task.name]]
    assert backend.calls == len(low)
    routes = {u.route for u in out.units}
    assert routes <= {"rules", "llm", "review"}
    for u, it in zip(out.units, task.items, strict=True):
        if task.rules(it)[""].confidence >= RULES_ACCEPT[task.name]:
            assert u.route == "rules"


def test_hybrid_routes_unsure_llm_answers_to_review(tmp_path, fake_backend):
    task = load_task("email", 80, 4)
    backend = fake_backend(task, error_rate=1.0)  # every LLM answer wrong at conf 0.6
    out = run_pipeline(task, "hybrid", _client(task, tmp_path, backend))
    assert all(u.route != "llm" for u in out.units)
    assert any(u.route == "review" for u in out.units)


def test_offline_replay_is_identical_and_free(tmp_path, fake_backend):
    task = load_task("email", 20, 5)
    first = summarize(run_pipeline(task, "llm", _client(task, tmp_path,
                                                        fake_backend(task))).to_dict())
    offline = _client(task, tmp_path, backend=None, offline=True)
    second = summarize(run_pipeline(task, "llm", offline).to_dict())
    assert offline.n_live == 0 and offline.n_replayed == 20
    assert offline.budget.spent_usd == 0
    for k in ("accuracy", "cost_per_unit", "usd_total"):
        assert first[k] == second[k]


def test_offline_cache_miss(tmp_path):
    task = load_task("email", 5, 6)
    with pytest.raises(CacheMiss):
        run_pipeline(task, "llm", _client(task, tmp_path, offline=True))
    out = run_pipeline(task, "llm", _client(task, tmp_path, offline=True),
                       on_cache_miss="review")
    assert all(u.route == "review" for u in out.units)


def test_budget_stops_live_calls(tmp_path, fake_backend):
    task = load_task("email", 50, 7)
    budget = Budget(limit_usd=0.02)  # each fake call costs $0.006
    with pytest.raises(BudgetExceeded):
        run_pipeline(task, "llm", _client(task, tmp_path, fake_backend(task), budget=budget))
    assert budget.spent_usd < 0.02 + 0.007


def test_refusal_goes_to_review(tmp_path, fake_backend):
    task = load_task("milestone", 10, 8)
    refuse = {task.items[0].id}
    out = run_pipeline(task, "llm", _client(task, tmp_path, fake_backend(task,
                                                                         refuse_ids=refuse)))
    assert out.units[0].route == "review"
    assert out.traces[0].error == "refusal"


def test_missing_key_message(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    task = load_task("email", 3, 9)
    with pytest.raises(MissingKey):
        run_pipeline(task, "llm", _client(task, tmp_path))


def test_rules_review_ablation_never_calls_llm():
    task = load_task("milestone", 40, 10)
    out = run_pipeline(task, "rules_review")
    rules = [task.rules(it)[""] for it in task.items]
    for u, r in zip(out.units, rules, strict=True):
        assert u.route == ("rules" if r.confidence >= RULES_ACCEPT[task.name] else "review")
        assert u.pred == r.label
    assert all(not t.llm_called for t in out.traces)
