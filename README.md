# JevPolicy

> **Code calculates. Jev judges. Policy decides.**

JevPolicy is an open-source TypeScript decision runtime that turns probabilistic judgments from **Jev, accessed through Vercel AI Gateway**, into versioned, deterministic, replayable, observable application decisions.

## Development status

The v0.1 implementation is feature-complete and remains pre-release. It includes
the strict policy compiler, Vercel JEV adapter, deterministic runtime, typed
fallbacks, JSONL recording, and offline signal replay.

## Getting started

Requires Node.js 22.18 or later.

```bash
npm install
npm run cli -- validate examples/support-routing.policy.yaml
npm run typecheck
npm test
```

Set `AI_GATEWAY_API_KEY` to run live evaluation through Vercel AI Gateway.

```bash
npm run cli -- evaluate examples/support-routing.policy.yaml \
  --state examples/support-routing.state.json \
  --record decisions.jsonl

npm run cli -- replay decisions.jsonl \
  --policy examples/support-routing.policy.yaml
```

The CLI derives declared facts from same-named top-level properties in the state
object. Use `--facts facts.json` to supply them separately. It records to
`decisions.jsonl` by default; use `--no-record` to disable recording. `--json`
is available for validate, evaluate, and replay.

Programmatic runtime evaluation:

```ts
import {
  JsonlRecorder,
  createJevPolicyRuntime,
  loadPolicyFile,
} from '@jevpolicy/core';

const policy = await loadPolicyFile('./policy.yaml');
const runtime = createJevPolicyRuntime({
  policy,
  provider: {
    type: 'vercel-jev',
    model: 'typesafe-ai/jev',
    timeoutMs: 10_000,
  },
  recorder: new JsonlRecorder('./decisions.jsonl'),
});

const result = await runtime.evaluate({
  state: {
    subject: 'Refund missing',
    body: 'I was charged twice',
  },
  facts: { authenticated: true },
});

console.log(result.decision, result.trace, result.fallback);
```

Deterministic preconditions run before any provider call. Provider timeouts,
invalid responses, and other provider failures map only to explicit policy
fallbacks; they never silently become an allow decision.

## Recording and replay

Raw state recording defaults to `none`. Policies may opt into `full` state
recording, or `redacted` recording when the programmatic runtime supplies a
redaction hook. Records always contain declared deterministic facts and
question-fingerprinted normalized signals so replay can reproduce policy logic
without calling the provider. Do not place credentials or secrets in declared
facts.

If persistence fails, evaluation throws `RecorderError`; its `envelope` property
contains the decision that was already computed.

## Core architecture

```text
Application
    |
    v
JevPolicy Runtime
    |
    +--> deterministic preconditions
    |
    +--> policy definition
    |
    +--> Vercel AI SDK `experimental_evaluate`
              |
              v
        Vercel AI Gateway
              |
              v
       `typesafe-ai/jev`
    |
    v
typed probabilistic signals
    |
    v
deterministic policy evaluator
    |
    v
ALLOW / REVIEW / DENY / ROUTE / custom action
    |
    +--> decision trace
    +--> recorder
    +--> metrics
    +--> replay
```

## Responsibility boundary

### Vercel AI Gateway owns

- inference authentication,
- access to Jev,
- model/provider routing capabilities,
- provider-level request infrastructure,
- gateway usage/spend visibility.

### JevPolicy owns

- policy-as-code,
- deterministic preconditions,
- Jev question definitions,
- signal normalization,
- ordered decision rules,
- explicit probability thresholds without implicit Boolean coercion,
- typed fallbacks,
- decision envelopes,
- audit traces,
- record/replay,
- signal replay with question compatibility fingerprints,
- policy-level metrics.

### Host application owns

- actual side effects,
- authorization,
- financial execution,
- filesystem mutation,
- tool execution,
- user notifications,
- business transactions.

**JevPolicy never executes the business action itself.**

## Technology baseline

- Node.js 22.18+
- TypeScript
- ESM
- AI SDK 7+
- Vercel AI Gateway
- model: `typesafe-ai/jev`
- `experimental_evaluate` from `ai`
- Zod
- YAML
- Vitest

## License

Apache-2.0.
