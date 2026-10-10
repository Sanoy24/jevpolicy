import { describe, expect, it } from 'vitest';

import { createRuleFrequencyReport } from '../../src/analysis/frequency.js';
import type { DecisionRecord } from '../../src/recorders/types.js';

function record(
  decisionId: string,
  decision: string,
  matched: DecisionRecord['matched'],
  overrides: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    format: 'jevpolicy.record/v1',
    decisionId,
    timestamp: '2026-10-10T08:00:00.000Z',
    policy: {
      name: 'frequency-contract',
      version: 1,
      fingerprint: 'a'.repeat(64),
    },
    facts: {},
    signals: {},
    originalDecision: decision,
    matched,
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: false,
    },
    mode: 'live',
    ...overrides,
  };
}

describe('rule-frequency analysis', () => {
  it('counts preconditions, rules, and unmatched decisions per policy', () => {
    const report = createRuleFrequencyReport([
      record('rule-1', 'approve', { ruleId: 'approve-ready' }),
      record('rule-2', 'approve', { ruleId: 'approve-ready' }),
      record('precondition', 'review', { preconditionId: 'require-auth' }),
      record('unmatched', 'review', {}),
    ]);

    expect(report.selection).toEqual({ mode: 'live' });
    expect(report.summary).toEqual({
      records: 4,
      policies: 1,
      preconditionMatches: 1,
      ruleMatches: 2,
      unmatched: 1,
    });
    expect(report.policies).toEqual([
      {
        name: 'frequency-contract',
        version: 1,
        fingerprint: 'a'.repeat(64),
        records: 4,
        matches: [
          {
            kind: 'rule',
            id: 'approve-ready',
            decision: 'approve',
            count: 2,
            rate: 0.5,
          },
          {
            kind: 'precondition',
            id: 'require-auth',
            decision: 'review',
            count: 1,
            rate: 0.25,
          },
          {
            kind: 'unmatched',
            decision: 'review',
            count: 1,
            rate: 0.25,
          },
        ],
      },
    ]);
  });

  it('keeps policy versions separate and supports mode and fingerprint filters', () => {
    const fingerprint = 'b'.repeat(64);
    const records = [
      record('live-v1', 'approve', { ruleId: 'route' }),
      record(
        'live-v2',
        'review',
        { ruleId: 'route' },
        {
          policy: { name: 'frequency-contract', version: 2, fingerprint },
        },
      ),
      record(
        'shadow-v2',
        'approve',
        { ruleId: 'route' },
        {
          policy: { name: 'frequency-contract', version: 2, fingerprint },
          mode: 'shadow',
          activeDecisionId: 'live-v1',
        },
      ),
    ];

    const live = createRuleFrequencyReport(records);
    expect(live.summary).toMatchObject({ records: 2, policies: 2 });
    expect(live.policies.map(({ version }) => version)).toEqual([1, 2]);

    const shadow = createRuleFrequencyReport(records, {
      mode: 'shadow',
      policyFingerprint: fingerprint,
    });
    expect(shadow.selection).toEqual({
      mode: 'shadow',
      policyFingerprint: fingerprint,
    });
    expect(shadow.summary).toEqual({
      records: 1,
      policies: 1,
      preconditionMatches: 0,
      ruleMatches: 1,
      unmatched: 0,
    });
    expect(shadow.policies[0]?.matches[0]).toMatchObject({
      kind: 'rule',
      id: 'route',
      decision: 'approve',
      rate: 1,
    });
  });

  it('returns an empty report when no records match', () => {
    expect(createRuleFrequencyReport([])).toEqual({
      selection: { mode: 'live' },
      summary: {
        records: 0,
        policies: 0,
        preconditionMatches: 0,
        ruleMatches: 0,
        unmatched: 0,
      },
      policies: [],
    });
  });
});
