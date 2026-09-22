import { describe, expect, it } from 'vitest';

import { ReplayCompatibilityError } from '../../src/errors.js';
import { compilePolicy } from '../../src/policy/compiler.js';
import type { CompiledPolicy } from '../../src/policy/compiler.js';
import type { DecisionRecord } from '../../src/recorders/types.js';
import {
  replayDecision,
  replayRecords,
  validateReplayCompatibility,
} from '../../src/replay/compatibility.js';

function policy(options: {
  threshold: number;
  instructions?: string;
  includeSecondQuestion?: boolean;
}): CompiledPolicy {
  return compilePolicy({
    schema: 'jevpolicy/v1',
    name: 'replay-contract',
    version: options.threshold === 0.7 ? 1 : 2,
    decisions: ['approve', 'review'],
    facts: {
      authenticated: { type: 'boolean', required: true },
    },
    questions: {
      urgent: {
        type: 'boolean',
        instructions: options.instructions ?? 'Is this urgent?',
      },
      ...(options.includeSecondQuestion === true
        ? {
            complex: {
              type: 'boolean',
              instructions: 'Is this complex?',
            },
          }
        : {}),
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
        when: { signal: 'urgent', op: 'gte', value: options.threshold },
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

function record(
  originalPolicy: CompiledPolicy,
  options: { id?: string; probability?: number; authenticated?: boolean } = {},
): DecisionRecord {
  return {
    format: 'jevpolicy.record/v1',
    decisionId: options.id ?? 'decision-1',
    timestamp: '2026-09-22T08:00:00.000Z',
    policy: {
      name: originalPolicy.name,
      version: originalPolicy.version,
      fingerprint: originalPolicy.fingerprint,
    },
    facts: { authenticated: options.authenticated ?? true },
    signals: {
      urgent: {
        questionFingerprint: originalPolicy.questions['urgent']!.fingerprint,
        signal: {
          type: 'boolean',
          probabilityTrue: options.probability ?? 0.8,
        },
      },
    },
    originalDecision: 'approve',
    matched: { ruleId: 'approve-urgent' },
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: true,
    },
    mode: 'live',
  };
}

describe('signal replay', () => {
  it('re-evaluates recorded facts and signals without a provider', () => {
    const original = policy({ threshold: 0.7 });
    const candidate = policy({ threshold: 0.9 });

    expect(replayDecision(record(original), candidate)).toEqual({
      decisionId: 'decision-1',
      originalDecision: 'approve',
      candidateDecision: 'review',
      changed: true,
      originalMatchedRule: 'approve-urgent',
    });
  });

  it('can reach a deterministic precondition from recorded facts', () => {
    const original = policy({ threshold: 0.7 });
    const result = replayDecision(
      record(original, { authenticated: false }),
      policy({ threshold: 0.9 }),
    );

    expect(result).toMatchObject({
      candidateDecision: 'review',
      candidateMatchedPrecondition: 'require-authentication',
    });
  });

  it('rejects changed question instructions even when the name is unchanged', () => {
    const original = policy({ threshold: 0.7 });
    const candidate = policy({
      threshold: 0.9,
      instructions: 'Does this need immediate action?',
    });

    expect(() => replayDecision(record(original), candidate)).toThrow(
      ReplayCompatibilityError,
    );
  });

  it('rejects a candidate that requires a signal absent from the record', () => {
    const original = policy({ threshold: 0.7 });
    const candidate = policy({
      threshold: 0.9,
      includeSecondQuestion: true,
    });

    expect(() => replayDecision(record(original), candidate)).toThrow(
      /missing signal 'complex'/,
    );
  });

  it('rejects missing deterministic facts as a compatibility error', () => {
    const original = policy({ threshold: 0.7 });
    const input = record(original) as unknown as {
      facts: Record<string, string | number | boolean>;
    };
    delete input.facts['authenticated'];

    expect(() =>
      validateReplayCompatibility(
        input as unknown as DecisionRecord,
        policy({ threshold: 0.9 }),
      ),
    ).toThrow(ReplayCompatibilityError);
  });

  it('summarizes changed decisions and transition counts', () => {
    const original = policy({ threshold: 0.7 });
    const candidate = policy({ threshold: 0.9 });
    const batch = replayRecords(
      [
        record(original, { id: 'changed', probability: 0.8 }),
        record(original, { id: 'same', probability: 0.95 }),
      ],
      candidate,
    );

    expect(batch.summary).toEqual({
      records: 2,
      unchanged: 1,
      changed: 1,
      transitions: [{ from: 'approve', to: 'review', count: 1 }],
    });
    expect(batch.results.map((result) => result.changed)).toEqual([
      true,
      false,
    ]);
  });
});
