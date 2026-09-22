import { describe, expect, it } from 'vitest';

import { evaluatePolicy } from '../../src/core/evaluator.js';
import {
  SignalValidationError,
  validateFacts,
  validateSignals,
} from '../../src/core/validation.js';
import { StateValidationError } from '../../src/errors.js';
import { compilePolicy } from '../../src/policy/compiler.js';

function policyDefinition(): Record<string, unknown> {
  return {
    schema: 'jevpolicy/v1',
    name: 'support-routing',
    version: 1,
    decisions: ['billing', 'technical', 'human_review'],
    facts: {
      authenticated: { type: 'boolean', required: true },
      region: { type: 'string', required: false },
    },
    questions: {
      category: {
        type: 'choice',
        instructions: 'Choose a route.',
        criteria: {
          billing: 'Payment problems',
          technical: 'Product problems',
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
        criteria: ['trivial', 'simple', 'moderate', 'complex', 'specialist'],
      },
    },
    preconditions: [
      {
        id: 'unauthenticated',
        when: { fact: 'authenticated', op: 'eq', value: false },
        decision: 'human_review',
      },
    ],
    rules: [
      {
        id: 'complex-and-urgent',
        when: {
          all: [
            { signal: 'complexity', op: 'gte', value: 4 },
            { signal: 'urgent', op: 'gte', value: 0.7 },
          ],
        },
        decision: 'human_review',
      },
      {
        id: 'technical-not-blocked',
        when: {
          all: [
            { signal: 'category', op: 'eq', value: 'technical' },
            {
              not: { fact: 'region', op: 'eq', value: 'blocked' },
            },
          ],
        },
        decision: 'technical',
      },
      {
        id: 'billing-route',
        when: {
          any: [
            { signal: 'category', op: 'eq', value: 'billing' },
            { fact: 'region', op: 'in', value: ['billing-only'] },
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

function signals(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    category: {
      type: 'choice',
      value: 'technical',
      probabilities: { billing: 0.1, technical: 0.8, account: 0.1 },
      confidence: 0.7,
    },
    urgent: { type: 'boolean', probabilityTrue: 0.69 },
    complexity: {
      type: 'score',
      value: 3.9,
      probabilities: { '3': 0.2, '4': 0.8 },
      confidence: 0.6,
    },
    ...overrides,
  };
}

describe('evaluatePolicy', () => {
  it('terminates on a matching deterministic precondition without signals', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: false },
    });

    expect(result).toMatchObject({
      decision: 'human_review',
      matched: { preconditionId: 'unauthenticated' },
      fallback: { used: false },
      trace: { source: 'precondition' },
    });
  });

  it('uses Boolean probability without an implicit 0.5 threshold', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true },
      signals: signals({
        category: { type: 'choice', value: 'account' },
        complexity: { type: 'score', value: 4 },
      }),
    });

    expect(result.fallback).toEqual({ used: true, reason: 'no_match' });
    expect(result.trace.evaluations[1]?.condition).toMatchObject({
      kind: 'all',
      passed: false,
      children: [
        { name: 'complexity', observed: 4, passed: true },
        { name: 'urgent', observed: 0.69, passed: false },
      ],
    });
  });

  it('honors first-match rule ordering', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true },
      signals: signals({
        category: { type: 'choice', value: 'billing' },
        urgent: { type: 'boolean', probabilityTrue: 0.9 },
        complexity: { type: 'score', value: 4 },
      }),
    });

    expect(result.decision).toBe('human_review');
    expect(result.matched).toEqual({ ruleId: 'complex-and-urgent' });
    expect(result.trace.evaluations.map((entry) => entry.id)).toEqual([
      'unauthenticated',
      'complex-and-urgent',
    ]);
  });

  it('evaluates recursive all/any/not and optional missing facts', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true },
      signals: signals(),
    });

    expect(result.decision).toBe('technical');
    expect(result.matched).toEqual({ ruleId: 'technical-not-blocked' });
    expect(result.trace.evaluations[2]?.condition).toMatchObject({
      kind: 'all',
      passed: true,
      children: [
        { kind: 'signal', name: 'category', passed: true },
        {
          kind: 'not',
          passed: true,
          child: {
            kind: 'fact',
            name: 'region',
            missing: true,
            observed: null,
            passed: false,
          },
        },
      ],
    });
  });

  it('short-circuits failed all conditions in the trace', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true, region: 'billing-only' },
      signals: signals({
        category: { type: 'choice', value: 'account' },
        complexity: { type: 'score', value: 2 },
      }),
    });

    expect(result.decision).toBe('billing');
    const firstRule = result.trace.evaluations[1];
    expect(firstRule?.condition).toMatchObject({ kind: 'all', passed: false });
    if (firstRule?.condition.kind !== 'all')
      throw new Error('expected all trace');
    expect(firstRule.condition.children).toHaveLength(1);
  });

  it('uses the configured no-match fallback', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true, region: 'blocked' },
      signals: signals({ category: { type: 'choice', value: 'account' } }),
    });

    expect(result).toMatchObject({
      decision: 'human_review',
      matched: {},
      fallback: { used: true, reason: 'no_match' },
      trace: { source: 'fallback' },
    });
  });

  it('marks replayed rule decisions in the trace', () => {
    const result = evaluatePolicy({
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true },
      signals: signals(),
      mode: 'replay',
    });
    expect(result.trace.source).toBe('replay_policy_rule');
  });

  it('is deterministic for identical policy, facts, and signals', () => {
    const input = {
      policy: compilePolicy(policyDefinition()),
      facts: { authenticated: true },
      signals: signals(),
    };
    expect(evaluatePolicy(input)).toEqual(evaluatePolicy(input));
  });
});

describe('input validation', () => {
  it('throws for a missing required fact', () => {
    expect(() => validateFacts(compilePolicy(policyDefinition()), {})).toThrow(
      StateValidationError,
    );
  });

  it('throws for a wrong fact type', () => {
    expect(() =>
      validateFacts(compilePolicy(policyDefinition()), {
        authenticated: 'yes',
      }),
    ).toThrow(StateValidationError);
  });

  it('preserves distributions and confidence separately', () => {
    const result = validateSignals(
      compilePolicy(policyDefinition()),
      signals(),
    );
    expect(result['category']).toEqual({
      type: 'choice',
      value: 'technical',
      probabilities: { billing: 0.1, technical: 0.8, account: 0.1 },
      confidence: 0.7,
    });
    expect(result['complexity']).toEqual({
      type: 'score',
      value: 3.9,
      probabilities: { '3': 0.2, '4': 0.8 },
      confidence: 0.6,
    });
  });

  it('throws when a required signal is missing', () => {
    const input = signals();
    delete input['urgent'];
    expect(() =>
      validateSignals(compilePolicy(policyDefinition()), input),
    ).toThrow(SignalValidationError);
  });

  it('rejects undeclared signal names', () => {
    expect(() =>
      validateSignals(
        compilePolicy(policyDefinition()),
        signals({ extra: { type: 'boolean', probabilityTrue: 0.5 } }),
      ),
    ).toThrow(SignalValidationError);
  });

  it('rejects provider-native or unknown signal fields', () => {
    expect(() =>
      validateSignals(
        compilePolicy(policyDefinition()),
        signals({
          urgent: {
            type: 'boolean',
            probabilityTrue: 0.8,
            providerMetadata: {},
          },
        }),
      ),
    ).toThrow(SignalValidationError);
  });
});
