# JevPolicy

> **Code calculates. Jev judges. Policy decides.**

JevPolicy is an open-source TypeScript decision runtime that turns probabilistic judgments from **Jev, accessed through Vercel AI Gateway**, into versioned, deterministic, replayable, observable application decisions.

## What it does

JevPolicy separates probabilistic judgment from deterministic application
policy. An application supplies state and facts, Jev answers typed questions
with probabilities, and ordered YAML rules turn those signals into a decision.

This is useful for workflows such as support routing, moderation, approval
gates, risk review, and escalation. JevPolicy returns the decision and its audit
trace; the host application remains responsible for carrying out any action.

```text
state + facts
     |
     v
deterministic preconditions
     |
     v
Jev typed questions -> normalized probabilistic signals
     |
     v
ordered policy rules -> decision + trace + optional record
```

## Installation

Requires Node.js 22.18 or later.

```bash
npm install @sanoy24/jevpolicy
```

The package includes the `jevpolicy` CLI:

```bash
npx jevpolicy validate ./policy.yaml
```

Live evaluation requires a Vercel AI Gateway key:

```bash
export AI_GATEWAY_API_KEY="your-api-key"
```

In PowerShell:

```powershell
$env:AI_GATEWAY_API_KEY = "your-api-key"
```

## Run the example from source

Clone the repository, install its dependencies, and validate the included
policy:

```bash
git clone https://github.com/Sanoy24/jevpolicy.git
cd jevpolicy
npm install
npm run cli -- validate examples/support-routing.policy.yaml
```

The included example asks Jev to classify a support request, then applies
deterministic routing rules. Its essential policy is:

```yaml
schema: jevpolicy/v1
name: support-routing
version: 1

decisions: [billing, technical, account, human_review]

questions:
  category:
    type: choice
    instructions: Which support category best matches this ticket?
    criteria:
      billing: Payment, refund, or charge problems
      technical: Product or application problems
      account: Login or account-management problems

rules:
  - id: billing-route
    when:
      signal: category
      op: eq
      value: billing
    decision: billing

fallback:
  provider_error: human_review
  provider_timeout: human_review
  invalid_provider_response: human_review
  no_match: human_review
```

See the complete
[`support-routing.policy.yaml`](examples/support-routing.policy.yaml) for its
fact declaration, precondition, additional questions, and remaining routes.

The example state is ordinary JSON:

```json
{
  "subject": "Refund missing",
  "body": "I was charged twice and need help resolving it.",
  "authenticated": true
}
```

Evaluate it and record the decision:

```bash
npm run cli -- evaluate examples/support-routing.policy.yaml \
  --state examples/support-routing.state.json \
  --record decisions.jsonl \
  --json
```

Evaluate a compatible candidate policy in shadow mode with the same provider
request:

```bash
npm run cli -- evaluate examples/support-routing.policy.yaml \
  --state examples/support-routing.state.json \
  --shadow-policy ./support-routing.candidate.yaml \
  --record decisions.jsonl \
  --json
```

Abridged result:

```json
{
  "mode": "live",
  "decision": "billing",
  "matched": { "ruleId": "billing-route" },
  "signals": {
    "category": { "type": "choice", "value": "billing" }
  },
  "provider": {
    "adapter": "vercel-jev",
    "model": "typesafe-ai/jev",
    "invoked": true
  },
  "fallback": { "used": false }
}
```

Jev supplied the probabilistic `category` signal; the `billing-route` policy
rule made the final decision. Replay reuses the recorded signals without another
provider call:

```bash
npm run cli -- replay decisions.jsonl \
  --policy examples/support-routing.policy.yaml \
  --json
```

The CLI derives declared facts from same-named top-level properties in the state
object. Use `--facts facts.json` to supply them separately. It records to
`decisions.jsonl` by default; use `--no-record` to disable recording. `--json`
is available for validate, evaluate, and replay.

## Library usage

The same runtime can be embedded directly in a TypeScript application:

```ts
import {
  JsonlRecorder,
  createJevPolicyRuntime,
  loadPolicyFile,
} from '@sanoy24/jevpolicy';

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

### Shadow evaluation

Use a shadow policy to test rule and threshold changes against live traffic
without letting the candidate decision control application behavior:

```ts
const shadowPolicy = await loadPolicyFile('./policy.candidate.yaml');
const result = await runtime.evaluateWithShadow({
  shadowPolicy,
  state: {
    subject: 'Refund missing',
    body: 'I was charged twice',
  },
  facts: { authenticated: true },
});

applyDecision(result.active.decision);
console.log(result.shadow.decision, result.comparison);
```

The active and shadow envelopes have `live` and `shadow` modes respectively.
Both are recorded when a recorder is attached, but only `active` should drive
host side effects. A compatible pair must have the same policy name, fact
contract, question names, and question fingerprints. JevPolicy rejects an
incompatible pair before invoking the provider. Compatible policies share one
provider request, so shadow evaluation is intended for comparing policy logic
over the same signal contract.

## Recording and replay

Raw state recording defaults to `none`. Policies may opt into `full` state
recording, or `redacted` recording when the programmatic runtime supplies a
redaction hook. Records contain declared deterministic facts. Successful
provider evaluations also contain question-fingerprinted normalized signals so
replay can reproduce policy logic without calling the provider. Records created
by a terminating precondition or provider fallback may not contain the complete
signal set and cannot be replayed against policies that require those signals.

Do not place credentials or secrets in declared facts. Decision logs may contain
sensitive facts, signals, or state, so keep them out of version control.

If persistence fails, evaluation throws `RecorderError`; its `envelope` property
contains the decision that was already computed.

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
- signal replay with question compatibility fingerprints.

### Host application owns

- actual side effects,
- authorization,
- financial execution,
- filesystem mutation,
- tool execution,
- user notifications,
- business transactions.

**JevPolicy never executes the business action itself.**

## License

Apache-2.0.
