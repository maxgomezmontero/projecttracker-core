FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg PATH=/venv/bin:$PATH
WORKDIR /app
COPY package.json index.js ./
COPY lib ./lib
COPY cli ./cli
COPY test ./test
COPY bench ./bench
RUN python3 -m venv /venv && pip install --no-cache-dir -e "./bench[dev]"

# Default: JS tests, then reproduce the committed benchmark results offline (no API key needed).
# Live LLM runs: docker run -e ANTHROPIC_API_KEY -w /app/bench projecttracker-core bench run --pipeline llm
CMD ["sh", "-c", "npm test && cd bench && bench verify"]
