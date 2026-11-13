import json

from engbench.cli import main


def test_cli_rules_run_writes_results_and_report(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    rc = main(["run", "--pipeline", "rules", "--task", "all", "--n", "20",
               "--results-dir", str(tmp_path)])
    assert rc == 0
    for t in ("email", "milestone", "drawing"):
        s = json.loads((tmp_path / f"{t}__rules__summary.json").read_text())
        assert s["n_items"] == 20
        assert (tmp_path / "plots" / f"tradeoff_{t}.png").stat().st_size > 1000
    md = (tmp_path / "RESULTS.md").read_text()
    assert "| email | rules |" in md


def test_cli_offline_skip_without_cache(tmp_path, capsys):
    rc = main(["run", "--pipeline", "llm", "--task", "email", "--n", "5", "--offline",
               "--on-cache-miss", "skip", "--results-dir", str(tmp_path)])
    assert rc == 0
    assert "[skip] email/llm" in capsys.readouterr().out


def test_cli_without_key_skips_llm(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    rc = main(["run", "--pipeline", "all", "--task", "milestone", "--n", "5",
               "--results-dir", str(tmp_path)])
    out = capsys.readouterr().out
    assert rc == 2
    assert "ANTHROPIC_API_KEY is not set" in out
    assert (tmp_path / "milestone__rules__summary.json").exists()


def test_verify_reproduces_rules_results(tmp_path):
    assert main(["run", "--pipeline", "rules", "--task", "email", "--n", "15",
                 "--results-dir", str(tmp_path)]) == 0
    assert main(["verify", "--results-dir", str(tmp_path)]) == 0
    s = tmp_path / "email__rules__summary.json"
    data = json.loads(s.read_text())
    data["accuracy"] = 0.0
    s.write_text(json.dumps(data))
    assert main(["verify", "--results-dir", str(tmp_path)]) == 1


def test_preflight_gate_stops_before_any_call(tmp_path, capsys):
    rc = main(["run", "--pipeline", "hybrid", "--task", "email", "--n", "20",
               "--max-cost-usd", "0.000001", "--results-dir", str(tmp_path)])
    assert rc == 5
    out = capsys.readouterr().out
    assert "No call was made" in out
    assert not list((tmp_path / "cache").glob("*.jsonl")) if (tmp_path / "cache").exists() else True
