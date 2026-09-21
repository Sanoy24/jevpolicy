# JevPolicy

> **Code calculates. Jev judges. Policy decides.**

JevPolicy is an open-source TypeScript decision runtime that turns probabilistic judgments from **Jev, accessed through Vercel AI Gateway**, into versioned, deterministic, replayable, observable application decisions.

## Development status

The strict policy compiler, pure deterministic evaluator, and offline validation
CLI are available. Provider-backed runtime evaluation, recording, and replay are
under active development.

## Getting started

Requires Node.js 22.18 or later.

```bash
npm install
npm run cli -- validate examples/support-routing.policy.yaml
npm run typecheck
npm test
```

Pure evaluation is available without network access:

```ts
import { evaluatePolicy, loadPolicyFile } from '@jevpolicy/core';

const policy = await loadPolicyFile('./policy.yaml');
const result = evaluatePolicy({
  policy,
  facts: { authenticated: true },
  signals: {
    category: { type: 'choice', value: 'billing' },
    urgent: { type: 'boolean', probabilityTrue: 0.82 },
    complexity: { type: 'score', value: 2.4 },
  },
});

console.log(result.decision, result.trace);
```

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
- optional OpenTelemetry API

## License

Apache-2.0.
