"""Bridge to the real ProjectTracker rules (Node CLI in ``../cli/ptcore.js``).

The benchmark's ``rules`` pipeline for the email and milestone tasks does not re-implement anything:
it batches every item through the extracted JavaScript code in one subprocess call per task, and
maps the tool's output onto the benchmark's labels. The mapping (this file) is the only glue.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI = Path(os.environ.get("PTCORE_CLI") or REPO_ROOT / "cli" / "ptcore.js")


class NodeMissing(RuntimeError):
    pass


def _node() -> str:
    exe = os.environ.get("PTCORE_NODE") or shutil.which("node")
    if not exe:
        raise NodeMissing("Node.js >= 20 is needed for the rules pipeline (set PTCORE_NODE).")
    return exe


def _run(args: list[str], lines: list[dict]) -> list[dict]:
    payload = "\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n"
    out = subprocess.run([_node(), str(CLI), *args], input=payload, capture_output=True,
                         text=True, encoding="utf-8", check=False)
    if out.returncode != 0:
        raise RuntimeError(f"ptcore {args[0]} failed: {out.stderr.strip()}")
    return [json.loads(x) for x in out.stdout.splitlines() if x.strip()]


def match(inputs: dict, messages: list[dict]) -> dict[str, dict]:
    """Run the tool's matcher (+ content refinement) on every message. Returns id → result."""
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        files = {}
        for k in ("data", "threads", "identity", "erp"):
            files[k] = t / f"{k}.json"
            files[k].write_text(json.dumps(inputs[k]), encoding="utf-8")
        res = _run(["match", "--projects", str(files["data"]), "--threads", str(files["threads"]),
                    "--identity", str(files["identity"]), "--erp", str(files["erp"])], messages)
    return {r["id"]: r for r in res}


def detect(messages: list[dict]) -> dict[str, list[dict]]:
    """Run the tool's 13 detectors (active ones only, as the tool's inbox does)."""
    return {r["id"]: r["milestones"] for r in _run(["detect", "--active-only"], messages)}


def status_changes(messages: list[dict], status: str = "Quoting") -> dict[str, dict | None]:
    """The tool's status rules (e.g. 'please find attached our purchase order' → In Progress)."""
    script = (
        "const M=require(process.argv[1]);let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "for(const l of s.split(/\\r?\\n/).filter(Boolean)){const m=JSON.parse(l);"
        "process.stdout.write(JSON.stringify({id:m.id,change:M.statusChange(m,{status:process.argv[2]})})+'\\n');}});"
    )
    payload = "\n".join(json.dumps(x) for x in messages) + "\n"
    out = subprocess.run([_node(), "-e", script, str(REPO_ROOT / "lib" / "inbox" / "email-match.js"),
                          status], input=payload, capture_output=True, text=True,
                         encoding="utf-8", check=True)
    return {r["id"]: r["change"] for r in map(json.loads, out.stdout.splitlines())}
