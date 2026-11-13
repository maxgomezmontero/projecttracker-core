#!/usr/bin/env node
// One Claude Messages API call over HTTPS (native fetch, no SDK).
// stdin:  { model, max_tokens, effort, thinking_off, system, user, schema }
// stdout: { text, stop_reason, usage: {input_tokens, output_tokens, cache_creation_input_tokens,
//           cache_read_input_tokens}, latency_s }
// The API key is read from the ANTHROPIC_API_KEY environment variable only and is never printed.
'use strict';

const URL_ = 'https://api.anthropic.com/v1/messages';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { process.stderr.write('ANTHROPIC_API_KEY is not set\n'); process.exit(3); }
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const req = JSON.parse(raw);
  const body = {
    model: req.model,
    max_tokens: req.max_tokens,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.user }],
    output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
  };
  if (req.thinking_off) body.thinking = { type: 'disabled' };

  const t0 = performance.now();
  let res, data;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    // Retry rate limits, overload and server errors with exponential backoff.
    if (res.status === 429 || res.status === 529 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    break;
  }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || res.statusText;
    process.stderr.write(`HTTP ${res.status}: ${msg}\n`);
    process.exit(4);
  }
  const u = data.usage || {};
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  process.stdout.write(JSON.stringify({
    text, stop_reason: data.stop_reason,
    usage: {
      input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens || 0,
    },
    latency_s: (performance.now() - t0) / 1000,
  }) + '\n');
}

main().catch(e => { process.stderr.write(`messages.js: ${e.message}\n`); process.exit(1); });
