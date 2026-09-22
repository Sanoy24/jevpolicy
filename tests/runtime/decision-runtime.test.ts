import { describe, expect, it, vi } from 'vitest';

import {
  ProviderError,
  ProviderResponseError,
  ProviderTimeoutError,
  RecorderError,
  StateValidationError,
} from '../../src/errors.js';
import { compilePolicy } from '../../src/policy/compiler.js';
import type {
  DecisionProvider,
  ProviderEvaluationResult,
} from '../../src/providers/types.js';
import type { DecisionRecord } from '../../src/recorders/types.js';
import { VercelJevProvider } from '../../src/providers/vercel-jev/adapter.js';
import { DecisionRuntime } from '../../src/runtime/decision-runtime.js';
import { createJevPolicyRuntime } from '../../src/runtime/factory.js';
import type { RuntimeClock } from '../../src/runtime/types.js';

function policy(recordingState: 'none' | 'redacted' | 'full' = 'none') {
  return compilePolicy({
    schema: 'jevpolicy/v1',
    name: 'runtime-contract',
    version: 2,
    decisions: [
      'deny',
      'review',
      'provider-failed',
      'timed-out',
      'bad-response',
      'no-match',
    ],
    facts: {
      authenticated: { type: 'boolean', required: true },
    },
    questions: {
      urgent: {
        type: 'boolean',
        instructions: 'Is this request urgent?',
      },
    },
    preconditions: [
      {
        id: 'require-authentication',
        when: { fact: 'authenticated', op: 'eq', value: false },
        decision: 'deny',
      },
    ],
    rules: [
      {
        id: 'review-urgent',
        when: { signal: 'urgent', op: 'gte', value: 0.7 },
        decision: 'review',
      },
    ],
    fallback: {
      provider_error: 'provider-failed',
      provider_timeout: 'timed-out',
      invalid_provider_response: 'bad-response',
      no_match: 'no-match',
    },
    recording: { state: recordingState },
  });
}

function clock(): RuntimeClock {
  let monotonic = 0;
  return {
    now: () => new Date('2026-09-22T08:00:00.000Z'),
    monotonicMs: () => monotonic++,
  };
}

function provider(evaluate: DecisionProvider['evaluate']): DecisionProvider {
  return {
    adapter: 'test-provider',
    model: 'test-model',
    evaluate,
  };
}

function successfulResult(probabilityTrue = 0.8): ProviderEvaluationResult {
  return {
    signals: {
      urgent: { type: 'boolean', probabilityTrue },
    },
    usage: { inputTokens: 12, outputTokens: 3 },
    gateway: {
      generationId: 'gen_runtime',
      cost: '0.001',
      resolvedProvider: 'typesafe-ai',
    },
  };
}

const providerErrorOptions = {
  provider: 'test-provider',
  model: 'test-model',
};

describe('DecisionRuntime', () => {
  it('returns a terminating precondition without validating state or invoking the provider', async () => {
    const evaluate = vi.fn(() => Promise.resolve(successfulResult()));
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(evaluate),
      clock: clock(),
      idGenerator: () => 'decision-precondition',
    });

    const result = await runtime.evaluate({
      state: { invalid: 1n } as never,
      facts: { authenticated: false },
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      decisionId: 'decision-precondition',
      timestamp: '2026-09-22T08:00:00.000Z',
      mode: 'live',
      decision: 'deny',
      matched: { preconditionId: 'require-authentication' },
      signals: {},
      provider: {
        adapter: 'test-provider',
        model: 'test-model',
        invoked: false,
      },
      timing: { totalMs: 3, policyMs: 1 },
      fallback: { used: false },
      trace: { source: 'precondition' },
    });
    expect(result.timing).not.toHaveProperty('providerMs');
  });

  it('invokes the provider and returns a complete rule decision envelope', async () => {
    const evaluate = vi.fn(() => Promise.resolve(successfulResult()));
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(evaluate),
      providerOptions: { timeoutMs: 5000, maxRetries: 1 },
      clock: clock(),
      idGenerator: () => 'decision-live',
    });
    const abortController = new AbortController();

    const result = await runtime.evaluate({
      state: { body: 'Help now' },
      facts: { authenticated: true },
      abortSignal: abortController.signal,
    });

    expect(evaluate).toHaveBeenCalledWith(
      {
        state: { body: 'Help now' },
        questions: runtime.policy.questions,
      },
      {
        timeoutMs: 5000,
        maxRetries: 1,
        abortSignal: abortController.signal,
      },
    );
    expect(result).toMatchObject({
      decisionId: 'decision-live',
      policy: {
        name: 'runtime-contract',
        version: 2,
        schema: 'jevpolicy/v1',
      },
      decision: 'review',
      matched: { ruleId: 'review-urgent' },
      signals: { urgent: { type: 'boolean', probabilityTrue: 0.8 } },
      provider: {
        adapter: 'test-provider',
        model: 'test-model',
        invoked: true,
        usage: { inputTokens: 12, outputTokens: 3 },
        gateway: { generationId: 'gen_runtime' },
      },
      timing: { totalMs: 9, providerMs: 1, policyMs: 3 },
      fallback: { used: false },
      trace: { source: 'policy_rule' },
    });
    expect(result.policy.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the no-match fallback after a valid provider response', async () => {
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(() => Promise.resolve(successfulResult(0.2))),
    });

    const result = await runtime.evaluate({
      state: 'ordinary request',
      facts: { authenticated: true },
    });

    expect(result).toMatchObject({
      decision: 'no-match',
      fallback: { used: true, reason: 'no_match' },
      trace: { source: 'fallback' },
      provider: { invoked: true },
    });
    expect(result.signals['urgent']).toEqual({
      type: 'boolean',
      probabilityTrue: 0.2,
    });
  });

  it.each([
    [
      new ProviderTimeoutError('timeout', providerErrorOptions),
      'provider_timeout',
      'timed-out',
    ],
    [
      new ProviderResponseError('bad response', providerErrorOptions),
      'invalid_provider_response',
      'bad-response',
    ],
    [
      new ProviderError('failed', providerErrorOptions),
      'provider_error',
      'provider-failed',
    ],
    [
      new Error('unexpected provider failure'),
      'provider_error',
      'provider-failed',
    ],
  ] as const)(
    'maps %s to the configured %s fallback',
    async (error, reason, decision) => {
      const runtime = new DecisionRuntime({
        policy: policy(),
        provider: provider(() => Promise.reject(error)),
      });

      const result = await runtime.evaluate({
        state: 'test',
        facts: { authenticated: true },
      });

      expect(result).toMatchObject({
        decision,
        signals: {},
        provider: { invoked: true },
        fallback: { used: true, reason },
        trace: { source: 'fallback' },
      });
    },
  );

  it('treats malformed output from any provider as an invalid response', async () => {
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(() =>
        Promise.resolve({
          signals: { urgent: { type: 'boolean', probabilityTrue: 4 } },
        }),
      ),
    });

    const result = await runtime.evaluate({
      state: 'test',
      facts: { authenticated: true },
    });

    expect(result).toMatchObject({
      decision: 'bad-response',
      fallback: { used: true, reason: 'invalid_provider_response' },
    });
  });

  it('throws state errors before invoking a provider', async () => {
    const evaluate = vi.fn(() => Promise.resolve(successfulResult()));
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(evaluate),
    });

    await expect(
      runtime.evaluate({
        state: { invalid: Number.NaN },
        facts: { authenticated: true },
      }),
    ).rejects.toBeInstanceOf(StateValidationError);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('records after computing the decision without persisting state by default', async () => {
    const record = vi.fn<
      (decisionRecord: DecisionRecord) => Promise<void>
    >(() => Promise.resolve());
    const compiled = policy();
    const runtime = new DecisionRuntime({
      policy: compiled,
      provider: provider(() => Promise.resolve(successfulResult())),
      recorder: { record },
      idGenerator: () => 'recorded-decision',
    });

    const envelope = await runtime.evaluate({
      state: { secret: 'do not persist' },
      facts: { authenticated: true },
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      format: 'jevpolicy.record/v1',
      decisionId: 'recorded-decision',
      originalDecision: envelope.decision,
      signals: {
        urgent: {
          questionFingerprint: compiled.questions['urgent']?.fingerprint,
          signal: { type: 'boolean', probabilityTrue: 0.8 },
        },
      },
    });
    expect(record.mock.calls[0]?.[0]).not.toHaveProperty('state');
    expect(record.mock.calls[0]?.[0]).not.toHaveProperty('stateFingerprint');
  });

  it('supports disabling an attached recorder per evaluation', async () => {
    const record = vi.fn<
      (decisionRecord: DecisionRecord) => Promise<void>
    >(() => Promise.resolve());
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(() => Promise.resolve(successfulResult())),
      recorder: { record },
    });

    await runtime.evaluate({
      state: 'test',
      facts: { authenticated: true },
      record: false,
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('throws RecorderError with the completed envelope when persistence fails', async () => {
    const runtime = new DecisionRuntime({
      policy: policy(),
      provider: provider(() => Promise.resolve(successfulResult())),
      recorder: {
        record: () => Promise.reject(new Error('disk full')),
      },
      idGenerator: () => 'computed-before-failure',
    });

    try {
      await runtime.evaluate({
        state: 'test',
        facts: { authenticated: true },
      });
      throw new Error('expected recording to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RecorderError);
      expect((error as RecorderError).envelope).toMatchObject({
        decisionId: 'computed-before-failure',
        decision: 'review',
      });
      expect(error).toHaveProperty('cause', expect.any(Error));
    }
  });
});

describe('createJevPolicyRuntime', () => {
  it('accepts an injected provider port', () => {
    const customProvider = provider(() => Promise.resolve(successfulResult()));
    const runtime = createJevPolicyRuntime({
      policy: policy(),
      provider: customProvider,
    });
    expect(runtime.provider).toBe(customProvider);
  });

  it('constructs the supported Vercel JEV adapter from public config', () => {
    const runtime = createJevPolicyRuntime({
      policy: policy(),
      provider: {
        type: 'vercel-jev',
        model: 'typesafe-ai/jev',
        timeoutMs: 10_000,
      },
    });
    expect(runtime.provider).toBeInstanceOf(VercelJevProvider);
  });

  it('rejects unsupported provider configuration at runtime', () => {
    expect(() =>
      createJevPolicyRuntime({
        policy: policy(),
        provider: {
          type: 'vercel-jev',
          model: 'another/model',
        } as never,
      }),
    ).toThrow(RangeError);
  });
});
