# LLM response cache

`bench run` appends every live LLM response here, one JSONL file per task and model
(`<task>__<model>.jsonl`). Each record holds the request hash, the user prompt, the raw response
text, `stop_reason`, token usage and measured latency.

`bench run --offline` and `bench verify` replay these files, so anyone can reproduce the LLM and
hybrid numbers without an API key. Replayed items report the cost and latency measured on the
original run.

This folder is empty until a run is made with `ANTHROPIC_API_KEY` set.
