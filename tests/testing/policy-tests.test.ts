import { describe, expect, it } from 'vitest';

import { PolicyTestValidationError } from '../../src/errors.js';
import { compilePolicy } from '../../src/policy/compiler.js';
import { loadPolicyFile } from '../../src/policy/loader.js';
import {
  loadPolicyTests,
  parsePolicyTests,
  runPolicyTests,
} from '../../src/testing/index.js';

function policy() {
  return compilePolicy({
    schema: 'jevpolicy/v1',
    name: 'fixture-contract',
    version: 1,
    decisions: ['approve', 'review'],
    facts: { authenticated: { type: 'boolean', required: true } },
    questions: { urgent: { type: 'boolean', instructions: 'Is this urgent?' } },
    preconditions: [
      {
        id: 'require-auth',
        when: { fact: 'authenticated', op: 'eq', value: false },
        decision: 'review',
      },
    ],
    rules: [
      {
        id: 'approve-urgent',
        when: { signal: 'urgent', op: 'gte', value: 0.7 },
        decision: 'approve',
      },
    ],
    fallback: {
      provider_error: 'review',
      provider_timeout: 'review',
      invalid_provider_response: 'review',
      no_match: 'review',
    },
  });
}

describe('policy test fixtures', () => {
  it('runs the shipped routing suite offline', async () => {
    const [compiled, suite] = await Promise.all([
      loadPolicyFile('examples/support-routing.policy.yaml'),
      loadPolicyTests('examples/support-routing.tests.yaml'),
    ]);
    expect(runPolicyTests(compiled, suite)).toMatchObject({
      passed: true,
      summary: { cases: 5, passed: 5, failed: 0, errors: 0 },
    });
  });

  it('checks preconditions without signals, threshold endpoints, and no-match fallback', () => {
    const suite = parsePolicyTests(`
schema: jevpolicy.tests/v1
cases:
  - name: authentication guard
    facts: {authenticated: false}
    expect:
      decision: review
      matched: {preconditionId: require-auth}
      fallback: {used: false}
  - name: threshold endpoint
    facts: {authenticated: true}
    signals: {urgent: {type: boolean, probabilityTrue: 0.7}}
    expect:
      decision: approve
      matched: {ruleId: approve-urgent}
  - name: below threshold
    facts: {authenticated: true}
    signals: {urgent: {type: boolean, probabilityTrue: 0.69}}
    expect:
      decision: review
      matched: {}
      fallback: {used: true, reason: no_match}
`);
    expect(runPolicyTests(policy(), suite)).toMatchObject({
      passed: true,
      summary: { cases: 3, passed: 3, failed: 0, errors: 0 },
    });
  });

  it('reports every assertion mismatch with the actual decision trace', () => {
    const suite = parsePolicyTests(`
schema: jevpolicy.tests/v1
cases:
  - name: mismatch
    facts: {authenticated: true}
    signals: {urgent: {type: boolean, probabilityTrue: 0.8}}
    expect:
      decision: review
      matched: {}
      fallback: {used: true, reason: no_match}
`);
    const report = runPolicyTests(policy(), suite);
    expect(report.summary).toEqual({
      cases: 1,
      passed: 0,
      failed: 1,
      errors: 0,
    });
    expect(report.passed).toBe(false);
    expect(report.results[0]).toMatchObject({
      status: 'failed',
      actual: {
        decision: 'approve',
        matched: { ruleId: 'approve-urgent' },
        trace: { source: 'policy_rule' },
      },
      failures: [
        expect.stringContaining('decision:'),
        expect.stringContaining('matched:'),
        expect.stringContaining('fallback:'),
      ],
    });
  });

  it('continues after invalid cases and rejects unknown or invalid supplied inputs', () => {
    const cases = [
      { name: 'missing fact', expect: { decision: 'review' } },
      {
        name: 'unknown fact',
        facts: { authenticated: false, typo: true },
        expect: { decision: 'review' },
      },
      {
        name: 'invalid fact',
        facts: { authenticated: 'false' },
        expect: { decision: 'review' },
      },
      {
        name: 'missing signal',
        facts: { authenticated: true },
        expect: { decision: 'review' },
      },
      {
        name: 'unknown signal',
        facts: { authenticated: false },
        signals: { typo: { type: 'boolean', probabilityTrue: 0.5 } },
        expect: { decision: 'review' },
      },
      {
        name: 'invalid ignored signal',
        facts: { authenticated: false },
        signals: { urgent: { type: 'boolean', probabilityTrue: 2 } },
        expect: { decision: 'review' },
      },
      {
        name: 'unknown expectation',
        facts: { authenticated: false },
        expect: { decision: 'typo' },
      },
      {
        name: 'unknown rule',
        facts: { authenticated: false },
        expect: { decision: 'review', matched: { ruleId: 'typo' } },
      },
      {
        name: 'valid final case',
        facts: { authenticated: false },
        expect: { decision: 'review' },
      },
    ];
    const report = runPolicyTests(
      policy(),
      parsePolicyTests(JSON.stringify({ schema: 'jevpolicy.tests/v1', cases })),
    );
    expect(report.summary).toEqual({
      cases: 9,
      passed: 1,
      failed: 0,
      errors: 8,
    });
    expect(report.results.at(-1)?.status).toBe('passed');
    const invalidSignal = report.results[5];
    expect(invalidSignal?.status).toBe('error');
    if (invalidSignal?.status === 'error') {
      expect(invalidSignal.error).toContain('between 0 and 1');
    }
  });

  it.each([
    'schema: [',
    'schema: jevpolicy.tests/v1\nschema: jevpolicy.tests/v1',
    'schema: jevpolicy.tests/v1\ncases: []',
    'schema: jevpolicy.tests/v2\ncases: []',
    'schema: jevpolicy.tests/v1\ncases: []\ntypo: true',
    'schema: !unknown jevpolicy.tests/v1\ncases: []',
    'schema: jevpolicy.tests/v1\ncases:\n- name: one\n  expect: {decision: review}\n- name: one\n  expect: {decision: review}',
    'schema: jevpolicy.tests/v1\ncases:\n- name: one\n  expect: {decision: review, matched: {ruleId: one, preconditionId: two}}',
    'schema: jevpolicy.tests/v1\ncases:\n- name: one\n  expect: {decision: review, fallback: {used: true, reason: provider_error}}',
    'schema: jevpolicy.tests/v1\ncases:\n- name: one\n  expect: {decision: review, typo: true}',
  ])('rejects invalid fixture documents: %s', (text) => {
    expect(() => parsePolicyTests(text, 'bad.tests.yaml')).toThrow(
      PolicyTestValidationError,
    );
  });

  it('rejects oversized fixtures and includes the source for file errors', async () => {
    expect(() => parsePolicyTests(' '.repeat(1_048_577))).toThrow(/1 MiB/);
    await expect(loadPolicyTests('missing.tests.yaml')).rejects.toMatchObject({
      name: 'PolicyTestValidationError',
      source: 'missing.tests.yaml',
    });
  });
});
