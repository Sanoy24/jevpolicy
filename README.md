# JevPolicy — Pre-Build Engineering Kit

> **Code calculates. Jev judges. Policy decides.**

JevPolicy is an open-source TypeScript decision runtime that turns probabilistic judgments from **Jev, accessed through Vercel AI Gateway**, into versioned, deterministic, replayable, observable application decisions.

The repository is implemented milestone by milestone from an accepted, testable design.

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

## Read before coding

1. `01-PRODUCT-REQUIREMENTS.md`
2. `02-ARCHITECTURE.md`
3. `03-POLICY-DSL.md`
4. `04-DOMAIN-MODEL.md`
5. `05-RUNTIME-API.md`
6. `06-REPLAY-AND-SHADOW.md`
7. `07-OBSERVABILITY.md`
8. `08-SECURITY.md`
9. `09-TESTING.md`
10. `10-ROADMAP.md`
11. `11-ADRS.md`
12. `12-OPEN-SOURCE.md`
13. `CODEX-START-HERE.md`
