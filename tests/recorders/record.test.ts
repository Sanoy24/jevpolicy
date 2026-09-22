import { describe, expect, it } from 'vitest';

import { compilePolicy } from '../../src/policy/compiler.js';
import {
  createDecisionRecord,
  fingerprintState,
} from '../../src/recorders/record.js';
import type { DecisionEnvelope } from '../../src/runtime/types.js';

function policy(recordingState: 'none' | 'redacted' | 'full') {
  return compilePolicy({
    schema: 'jevpolicy/v1',
    name: 'recording-contract',
    version: 1,
    decisions: ['review'],
    questions: {
      urgent: {
        type: 'boolean',
        instructions: 'Is this urgent?',
      },
    },
    rules: [
      {
        id: 'review',
        when: { signal: 'urgent', op: 'gte', value: 0.5 },
        decision: 'review',
      },
    ],
    fallback: {
      provider_error: 'review',
      provider_timeout: 'review',
      invalid_provider_response: 'review',
      no_match: 'review',
    },
    recording: { state: recordingState },
  });
}

function envelope(compiled: ReturnType<typeof policy>): DecisionEnvelope {
  return {
    decisionId: 'decision-1',
    timestamp: '2026-09-22T08:00:00.000Z',
    policy: {
      name: compiled.name,
      version: compiled.version,
      schema: compiled.schema,
      fingerprint: compiled.fingerprint,
    },
    mode: 'live',
    decision: 'review',
    matched: { ruleId: 'review' },
    signals: {
      urgent: { type: 'boolean', probabilityTrue: 0.8 },
    },
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: true,
    },
    timing: { totalMs: 2, providerMs: 1, policyMs: 1 },
    fallback: { used: false },
    trace: { source: 'policy_rule', evaluations: [] },
  };
}

describe('decision records', () => {
  it('fingerprints object state independently of key order', () => {
    expect(fingerprintState({ a: 1, b: ['x', true] })).toBe(
      fingerprintState({ b: ['x', true], a: 1 }),
    );
  });

  it('stores full state only when explicitly configured', async () => {
    const compiled = policy('full');
    const state = { account: 'acct_1', content: 'hello' };
    const record = await createDecisionRecord({
      policy: compiled,
      envelope: envelope(compiled),
      state,
    });

    expect(record.state).toEqual(state);
    expect(record.stateFingerprint).toBe(fingerprintState(state));
    expect(record.signals['urgent']).toEqual({
      questionFingerprint: compiled.questions['urgent']?.fingerprint,
      signal: { type: 'boolean', probabilityTrue: 0.8 },
    });
  });

  it('stores redacted state while fingerprinting the original', async () => {
    const compiled = policy('redacted');
    const state = { account: 'acct_1', content: 'secret' };
    const record = await createDecisionRecord({
      policy: compiled,
      envelope: envelope(compiled),
      state,
      redactState: (input) => ({
        account: (input as { account: string }).account,
        content: '[redacted]',
      }),
    });

    expect(record.state).toEqual({
      account: 'acct_1',
      content: '[redacted]',
    });
    expect(record.stateFingerprint).toBe(fingerprintState(state));
  });

  it('requires a redactor for redacted recording mode', async () => {
    const compiled = policy('redacted');
    await expect(
      createDecisionRecord({
        policy: compiled,
        envelope: envelope(compiled),
        state: 'sensitive',
      }),
    ).rejects.toThrow("requires a state redactor");
  });
});
