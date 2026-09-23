import { describe, expect, it } from 'vitest';

import { compilePolicy } from '../../src/policy/compiler.js';
import { diffPolicies } from '../../src/policy/diff.js';

function baseDefinition(): Record<string, unknown> {
  return {
    schema: 'jevpolicy/v1',
    name: 'policy-diff-contract',
    version: 1,
    description: 'Original policy',
    decisions: ['approve', 'review', 'deny'],
    facts: {
      authenticated: { type: 'boolean', required: true },
      tier: { type: 'string', required: false },
    },
    questions: {
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
      },
      category: {
        type: 'choice',
        instructions: 'Classify the request',
        criteria: {
          billing: 'Billing request',
          technical: 'Technical request',
        },
      },
    },
    preconditions: [
      {
        id: 'require-authentication',
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
      {
        id: 'review-billing',
        when: { signal: 'category', op: 'eq', value: 'billing' },
        decision: 'review',
      },
    ],
    fallback: {
      provider_error: 'review',
      provider_timeout: 'review',
      invalid_provider_response: 'review',
      no_match: 'review',
    },
    recording: { state: 'none' },
  };
}

function candidateDefinition(): Record<string, unknown> {
  return {
    schema: 'jevpolicy/v1',
    name: 'policy-diff-contract',
    version: 2,
    description: 'Candidate policy',
    decisions: ['approve', 'review', 'escalate'],
    facts: {
      authenticated: { type: 'boolean', required: true },
      tier: { type: 'string', required: true },
      region: { type: 'string', required: false },
    },
    questions: {
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
      },
      category: {
        type: 'choice',
        instructions: 'Classify the request',
        criteria: {
          billing: 'Payments, invoices, or refunds',
          technical: 'Technical request',
        },
      },
      complex: {
        type: 'boolean',
        instructions: 'Is this complex?',
      },
    },
    preconditions: [
      {
        id: 'require-authentication',
        when: { fact: 'authenticated', op: 'eq', value: false },
        decision: 'review',
      },
    ],
    rules: [
      {
        id: 'review-billing',
        when: { signal: 'category', op: 'eq', value: 'billing' },
        decision: 'review',
      },
      {
        id: 'approve-urgent',
        when: { signal: 'urgent', op: 'gte', value: 0.8 },
        decision: 'approve',
      },
      {
        id: 'review-complex',
        when: { signal: 'complex', op: 'gte', value: 0.7 },
        decision: 'review',
      },
    ],
    fallback: {
      provider_error: 'approve',
      provider_timeout: 'review',
      invalid_provider_response: 'review',
      no_match: 'review',
    },
    recording: { state: 'redacted' },
  };
}

describe('diffPolicies', () => {
  it('returns an empty deterministic diff for equivalent policies', () => {
    const base = compilePolicy(baseDefinition());
    const candidate = compilePolicy(baseDefinition());

    expect(diffPolicies(base, candidate)).toEqual({
      base: {
        name: base.name,
        version: base.version,
        fingerprint: base.fingerprint,
      },
      candidate: {
        name: candidate.name,
        version: candidate.version,
        fingerprint: candidate.fingerprint,
      },
      changed: false,
      summary: { total: 0, added: 0, removed: 0, changed: 0, moved: 0 },
      changes: [],
    });
  });

  it('reports semantic changes with stable paths and rule movement', () => {
    const result = diffPolicies(
      compilePolicy(baseDefinition()),
      compilePolicy(candidateDefinition()),
    );

    expect(result.changed).toBe(true);
    expect(result.summary).toEqual({
      total: 13,
      added: 4,
      removed: 1,
      changed: 7,
      moved: 1,
    });
    expect(result.changes.map((change) => change.path)).toEqual([
      'version',
      'description',
      'decisions.deny',
      'decisions.escalate',
      'facts.region',
      'facts.tier',
      'questions.category',
      'questions.complex',
      'rules.approve-urgent',
      'rules.review-billing',
      'rules.review-complex',
      'fallback.provider_error',
      'recording.state',
    ]);
    expect(
      result.changes.find((change) => change.path === 'rules.review-billing'),
    ).toEqual({
      kind: 'moved',
      category: 'rule',
      path: 'rules.review-billing',
      beforeIndex: 1,
      afterIndex: 0,
    });
    expect(
      result.changes.find((change) => change.path === 'rules.approve-urgent'),
    ).toMatchObject({
      kind: 'changed',
      category: 'rule',
      beforeIndex: 0,
      afterIndex: 1,
    });
  });

  it('freezes the returned report and individual changes', () => {
    const result = diffPolicies(
      compilePolicy(baseDefinition()),
      compilePolicy(candidateDefinition()),
    );

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.changes)).toBe(true);
    expect(result.changes.every((change) => Object.isFrozen(change))).toBe(
      true,
    );
  });
});
