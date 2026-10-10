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

Compare the released policy with a candidate entirely offline:

```bash
npm run cli -- diff \
  examples/support-routing.policy.yaml \
  examples/support-routing.candidate.policy.yaml \
  --json
```

The diff reports stable paths for added, removed, changed, and reordered policy
elements. Rules and preconditions are matched by ID because their order affects
which decision wins.

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
  --shadow-policy examples/support-routing.candidate.policy.yaml \
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
is available for validate, diff, evaluate, and replay.

## Library usage

### Test policies offline

Keep regression cases alongside a policy to check routing, rule order, and
threshold boundaries before deploying changes. Fixtures supply deterministic
facts and normalized signals directly:

```yaml
schema: jevpolicy.tests/v1
cases:
  - name: billing tickets reach the billing queue
    facts: { authenticated: true }
    signals:
      category: { type: choice, value: billing }
      urgent: { type: boolean, probabilityTrue: 0.2 }
      complexity: { type: score, value: 1 }
    expect:
      decision: billing
      matched: { ruleId: billing-route }
      fallback: { used: false }
```

Run the included fixture suite from source:

```bash
npm run cli -- test examples/support-routing.tests.yaml \
  --policy examples/support-routing.policy.yaml
```

Use `--json` for a structured report containing each result and its decision
trace. The command exits with `0` when all cases pass, `1` for failed assertions,
invalid inputs, or file errors, and `2` for invalid command arguments.

`expect.decision` is required. Optional `expect.matched` checks the exact winning
branch; `{}` asserts that no branch matched. Optional `expect.fallback` checks
fallback use and, when used, the `no_match` reason. A terminating precondition
can omit signals; other cases must supply every declared question. Supplied
signals and facts are validated, including rejecting unknown names. Invalid
case inputs are reported as errors while the remaining cases still run.

```ts
import {
  loadPolicyFile,
  loadPolicyTests,
  runPolicyTests,
} from '@sanoy24/jevpolicy';

const policy = await loadPolicyFile('./policy.yaml');
const suite = await loadPolicyTests('./policy.tests.yaml');
const report = runPolicyTests(policy, suite);
console.log(report.passed, report.summary, report.results);
```

Fixtures run entirely offline and create no decision logs. They test policy
logic over supplied judgments; live provider behavior and provider-error
fallbacks require separate integration tests.

### Embed the runtime

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
fallbacks; they never silently become an allow decision. Cancelling through
`abortSignal` is different: an aborted evaluation rejects with the signal's
reason and records nothing, because no decision was made.

Custom providers can receive `providerOptions` (such as `timeoutMs` and
`maxRetries`) through `createJevPolicyRuntime`.

#### Condition semantics

- A condition on an optional fact that is absent evaluates to `false`, so
  wrapping it in `not` evaluates to `true`. For example, negating
  `{ fact: verified, op: eq, value: false }` matches when `verified` is
  missing. Mark the fact `required` when absence must not pass.
- Boolean signals compare `probabilityTrue`. Prefer `gte`/`lt` thresholds;
  `eq`/`neq` on a probability is accepted but rarely matches as intended.

### Policy comparison

`diffPolicies` exposes the same semantic comparison used by the CLI:

```ts
import { diffPolicies, loadPolicyFile } from '@sanoy24/jevpolicy';

const base = await loadPolicyFile('./policy.yaml');
const candidate = await loadPolicyFile('./policy.candidate.yaml');
const diff = diffPolicies(base, candidate);

console.log(diff.changed, diff.summary, diff.changes);
```

The comparison is deterministic and does not call a provider. Decision names
are treated as a set; named facts and questions are compared by key; and
preconditions and rules are matched by ID with order changes reported
separately.

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
The shadow envelope (and its record) carries `activeDecisionId`, the ID of the
live decision it was evaluated beside. Both are recorded when a recorder is
attached, but only `active` should drive host side effects. A compatible pair must have the same policy name, fact
contract, question names, and question fingerprints. JevPolicy rejects an
incompatible pair before invoking the provider. Compatible policies share one
provider request, so shadow evaluation is intended for comparing policy logic
over the same signal contract.

### OpenTelemetry

Applications with an OpenTelemetry SDK can attach the optional observer:

```ts
import { createJevPolicyRuntime } from '@sanoy24/jevpolicy';
import { OpenTelemetryDecisionObserver } from '@sanoy24/jevpolicy/opentelemetry';

const runtime = createJevPolicyRuntime({
  policy,
  provider: {
    type: 'vercel-jev',
    model: 'typesafe-ai/jev',
  },
  observer: new OpenTelemetryDecisionObserver(),
});
```

Install `@opentelemetry/api` alongside JevPolicy when using this entry point.
The application remains responsible for configuring its OpenTelemetry SDK and
exporters; without a registered SDK, the API uses its standard no-op providers.

The observer emits `jevpolicy.decision.evaluate` spans, evaluation and fallback
counters, and decision/provider duration histograms. Attributes cover policy
identity, mode, decision, provider, match, and fallback metadata. State, facts,
signals, prompts, and provider responses are deliberately excluded. Observer
failures are isolated and never change or reject a completed policy decision.

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
contains the live decision that was already computed, even when the failed
write was the shadow record. During shadow evaluation `shadow` holds the shadow
envelope, and `failedMode` names the record that could not be written.

### Ground-truth outcomes

Real-world outcomes often arrive after a decision has been recorded. Keep them
in a separate append-only JSONL file so the original decision log remains
immutable:

```json
{
  "format": "jevpolicy.outcome/v1",
  "decisionId": "47bb6a4b-ab09-49a1-bf01-75ced4c0e27a",
  "label": "billing",
  "observedAt": "2026-09-24T09:00:00.000Z"
}
```

Load and join outcomes with their decision records:

```ts
import {
  JsonlOutcomeRecorder,
  joinDecisionOutcomes,
  loadDecisionOutcomes,
  loadDecisionRecords,
} from '@sanoy24/jevpolicy';

const outcomeRecorder = new JsonlOutcomeRecorder('./outcomes.jsonl');
await outcomeRecorder.record({
  format: 'jevpolicy.outcome/v1',
  decisionId: '47bb6a4b-ab09-49a1-bf01-75ced4c0e27a',
  label: 'billing',
  observedAt: new Date().toISOString(),
});

const records = await loadDecisionRecords('./decisions.jsonl');
const outcomes = await loadDecisionOutcomes('./outcomes.jsonl');
const joined = joinDecisionOutcomes(records, outcomes);

console.log(joined.labeled, joined.unlabeledDecisionIds, joined.summary);
```

Outcome labels are application-defined ground truth. Duplicate outcome or
decision IDs and outcomes that reference an unknown decision are rejected so
later analysis cannot silently join ambiguous data.

### Calibration reports

Compare recorded decisions with their observed labels entirely offline:

```bash
npx jevpolicy calibrate ./decisions.jsonl \
  --outcomes ./outcomes.jsonl \
  --json
```

The same report is available programmatically:

```ts
import { createCalibrationReport } from '@sanoy24/jevpolicy';

const report = createCalibrationReport(records, outcomes);
console.log(report.summary, report.labels, report.transitions);
```

The report contains label coverage, overall decision accuracy, per-label
precision and recall, and predicted-to-observed transition counts.

Reports analyze `live` records by default and list the policy versions they
cover under `policies`. Pass `--mode shadow` (or `{ mode: 'shadow' }`) to score
a shadow policy: each shadow record is judged against the outcome recorded for
its `activeDecisionId`, so outcomes only ever need to reference live decisions.
Use `--policy-fingerprint` (or `{ policyFingerprint }`) to analyze a single
policy version. Undefined
ratios are returned as `null`, never `NaN`. These metrics measure agreement
between policy decisions and application-supplied labels; they do not claim to
measure provider probability calibration.

### Confidence-band analysis

Inspect how downstream decision accuracy changes across recorded probability
and confidence bands:

```bash
npx jevpolicy confidence ./decisions.jsonl \
  --outcomes ./outcomes.jsonl \
  --boundaries 0,0.5,0.8,1 \
  --json
```

Or create the report programmatically:

```ts
import { createConfidenceBandReport } from '@sanoy24/jevpolicy';

const report = createConfidenceBandReport(records, outcomes, {
  boundaries: [0, 0.5, 0.8, 1],
});
```

The default boundaries are `0,0.2,0.4,0.6,0.8,1`. Reports remain separated by
question fingerprint, signal type, and measure: Boolean probability true,
Choice selected probability, Score peak probability, and optional Choice or
Score confidence. Values outside the normalized range are counted explicitly. The built-in
Vercel Jev adapter does not receive a provider confidence value, so
`confidence` groups appear only for custom providers that supply one.
Bands measure the accuracy of the resulting policy decision against its outcome
label; they do not treat a decision label as ground truth for an individual Jev
question.

### Rule-frequency analysis

Inspect which policy branches are producing decisions from a JSONL decision
log. This report does not require outcome labels:

```bash
npm run cli -- frequency ./decisions.jsonl --json
```

The same report is available through the library:

```ts
import { createRuleFrequencyReport } from '@sanoy24/jevpolicy';

const report = createRuleFrequencyReport(records);
console.log(report.summary, report.policies);
```

Counts and rates are grouped by policy fingerprint, so rules with the same ID
in different policy versions are never combined. The report separates matched
preconditions, matched rules, and records with no matched branch. Use `--mode`
and `--policy-fingerprint` to apply the same selection rules as the calibration
and confidence commands.

Each rate is the count divided by the selected records for that policy version.
Counts describe the branch that produced the final decision; they do not count
every condition evaluated along the way. Only observed branches appear, so the
report cannot identify unused rules without the original policy definition.
Unmatched records may represent a no-match fallback or a provider failure;
the record format does not preserve the reason needed to distinguish them.

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
