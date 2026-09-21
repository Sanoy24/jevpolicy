import { describe, expect, it } from 'vitest';

import { PolicyValidationError } from '../../src/errors.js';
import {
  compilePolicy,
  fingerprintQuestion,
} from '../../src/policy/compiler.js';

function validPolicy(): Record<string, unknown> {
  return {
    schema: 'jevpolicy/v1',
    name: 'support-routing',
    version: 1,
    decisions: ['billing', 'human_review'],
    facts: {
      authenticated: { type: 'boolean', required: true },
    },
    questions: {
      category: {
        type: 'choice',
        instructions: 'Choose a route.',
        criteria: {
          billing: 'Payment problems',
          account: 'Account problems',
        },
      },
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
      },
      complexity: {
        type: 'score',
        instructions: 'Rate complexity.',
        criteria: ['simple', 'complex'],
      },
    },
    preconditions: [
      {
        id: 'require-authentication',
        when: { fact: 'authenticated', op: 'eq', value: false },
        decision: 'human_review',
      },
    ],
    rules: [
      {
        id: 'urgent-billing',
        when: {
          all: [
            { signal: 'urgent', op: 'gte', value: 0.7 },
            {
              not: { signal: 'category', op: 'neq', value: 'billing' },
            },
          ],
        },
        decision: 'billing',
      },
    ],
    fallback: {
      provider_error: 'human_review',
      provider_timeout: 'human_review',
      invalid_provider_response: 'human_review',
      no_match: 'human_review',
    },
  };
}

function expectIssue(policy: Record<string, unknown>, code: string): void {
  try {
    compilePolicy(policy);
    throw new Error('expected policy compilation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PolicyValidationError);
    expect((error as PolicyValidationError).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  }
}

describe('compilePolicy', () => {
  it('compiles and deeply freezes a valid recursive policy', () => {
    const compiled = compilePolicy(validPolicy());

    expect(compiled.name).toBe('support-routing');
    expect(compiled.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(compiled.questions['category']?.fingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.rules)).toBe(true);
  });

  it('produces a stable policy fingerprint', () => {
    expect(compilePolicy(validPolicy()).fingerprint).toBe(
      compilePolicy(validPolicy()).fingerprint,
    );
  });

  it('rejects unknown properties instead of stripping them', () => {
    const policy = validPolicy();
    policy['typo'] = true;
    expectIssue(policy, 'unrecognized_keys');
  });

  it('rejects an undeclared fact', () => {
    const policy = validPolicy();
    policy['preconditions'] = [
      {
        id: 'missing-fact',
        when: { fact: 'missing', op: 'eq', value: true },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'unknown_fact');
  });

  it('rejects an undeclared signal', () => {
    const policy = validPolicy();
    policy['rules'] = [
      {
        id: 'missing-signal',
        when: { signal: 'missing', op: 'eq', value: 'anything' },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'unknown_signal');
  });

  it('rejects signals in deterministic preconditions', () => {
    const policy = validPolicy();
    policy['preconditions'] = [
      {
        id: 'probabilistic-precondition',
        when: { signal: 'urgent', op: 'gte', value: 0.8 },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'signal_in_precondition');
  });

  it('rejects an invalid fact operator and value pair', () => {
    const policy = validPolicy();
    policy['preconditions'] = [
      {
        id: 'bad-fact-operation',
        when: { fact: 'authenticated', op: 'gte', value: 1 },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'invalid_fact_operator');
  });

  it('rejects an implicit boolean threshold outside the probability range', () => {
    const policy = validPolicy();
    policy['rules'] = [
      {
        id: 'invalid-threshold',
        when: { signal: 'urgent', op: 'gte', value: 1.1 },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'invalid_probability_threshold');
  });

  it('rejects impossible choice values', () => {
    const policy = validPolicy();
    policy['rules'] = [
      {
        id: 'unknown-choice',
        when: { signal: 'category', op: 'eq', value: 'technical' },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'unknown_choice_value');
  });

  it('rejects score thresholds outside the declared rubric', () => {
    const policy = validPolicy();
    policy['rules'] = [
      {
        id: 'invalid-score-threshold',
        when: { signal: 'complexity', op: 'gte', value: 2.1 },
        decision: 'human_review',
      },
    ];
    expectIssue(policy, 'invalid_score_threshold');
  });

  it('rejects duplicate IDs across preconditions and rules', () => {
    const policy = validPolicy();
    const rules = policy['rules'] as Array<Record<string, unknown>>;
    const firstRule = rules[0];
    if (firstRule === undefined) throw new Error('missing test rule');
    firstRule['id'] = 'require-authentication';
    expectIssue(policy, 'duplicate_id');
  });

  it('rejects duplicate decisions', () => {
    const policy = validPolicy();
    policy['decisions'] = ['billing', 'billing', 'human_review'];
    expectIssue(policy, 'duplicate_decision');
  });

  it('rejects undeclared rule decisions', () => {
    const policy = validPolicy();
    const rules = policy['rules'] as Array<Record<string, unknown>>;
    const firstRule = rules[0];
    if (firstRule === undefined) throw new Error('missing test rule');
    firstRule['decision'] = 'technical';
    expectIssue(policy, 'unknown_decision');
  });

  it('rejects undeclared fallback decisions', () => {
    const policy = validPolicy();
    const fallback = policy['fallback'] as Record<string, unknown>;
    fallback['no_match'] = 'technical';
    expectIssue(policy, 'unknown_decision');
  });

  it('rejects ambiguous condition objects', () => {
    const policy = validPolicy();
    policy['rules'] = [
      {
        id: 'ambiguous',
        when: {
          signal: 'urgent',
          op: 'gte',
          value: 0.7,
          all: [{ signal: 'urgent', op: 'gte', value: 0.7 }],
        },
        decision: 'human_review',
      },
    ];
    expect(() => compilePolicy(policy)).toThrow(PolicyValidationError);
  });

  it('changes the policy fingerprint when policy contents change', () => {
    const first = validPolicy();
    const second = validPolicy();
    second['description'] = 'Changed without incrementing the version';
    expect(compilePolicy(first).fingerprint).not.toBe(
      compilePolicy(second).fingerprint,
    );
  });
});

describe('fingerprintQuestion', () => {
  it('changes when instructions change', () => {
    const base = {
      type: 'boolean' as const,
      instructions: 'Is this urgent?',
    };
    expect(fingerprintQuestion(base)).not.toBe(
      fingerprintQuestion({
        ...base,
        instructions: 'Does this need immediate action?',
      }),
    );
  });

  it('preserves choice declaration order', () => {
    const first = {
      type: 'choice' as const,
      instructions: 'Choose.',
      criteria: { billing: 'Billing', account: 'Account' },
    };
    const reordered = {
      ...first,
      criteria: { account: 'Account', billing: 'Billing' },
    };
    expect(fingerprintQuestion(first)).not.toBe(fingerprintQuestion(reordered));
  });

  it('preserves score rung order', () => {
    const first = {
      type: 'score' as const,
      instructions: 'Rate.',
      criteria: ['low', 'high'],
    };
    expect(fingerprintQuestion(first)).not.toBe(
      fingerprintQuestion({ ...first, criteria: ['high', 'low'] }),
    );
  });

  it('changes when choice criteria descriptions change', () => {
    const first = {
      type: 'choice' as const,
      instructions: 'Choose.',
      criteria: { billing: 'Billing', account: 'Account' },
    };
    expect(fingerprintQuestion(first)).not.toBe(
      fingerprintQuestion({
        ...first,
        criteria: { billing: 'Payment issues', account: 'Account' },
      }),
    );
  });
});
