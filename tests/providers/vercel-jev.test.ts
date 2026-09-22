import { InvalidResponseDataError } from '@ai-sdk/provider';
import type {
  Experimental_EvaluationQuestion,
  Experimental_EvaluationResult,
} from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderResponseError,
  ProviderTimeoutError,
  StateValidationError,
} from '../../src/errors.js';
import type { ProviderError } from '../../src/errors.js';
import { compilePolicy } from '../../src/policy/compiler.js';
import {
  VERCEL_JEV_MODEL,
  VercelJevProvider,
} from '../../src/providers/vercel-jev/adapter.js';

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal();
  if (actual === null || typeof actual !== 'object') {
    throw new TypeError('Expected the ai module to be an object');
  }
  return { ...actual, experimental_evaluate: mocks.evaluate };
});

const sdkQuestions = {
  urgent: {
    type: 'boolean',
    instructions: 'Is this urgent?',
    criteria: { true: 'Urgent', false: 'Not urgent' },
  },
  category: {
    type: 'choice',
    instructions: 'Choose a category.',
    criteria: { billing: 'Billing', technical: 'Technical' },
  },
  complexity: {
    type: 'score',
    instructions: 'Rate complexity.',
    criteria: ['low', 'medium', 'high'],
  },
} as const satisfies Record<string, Experimental_EvaluationQuestion>;

type SdkResult = Experimental_EvaluationResult<typeof sdkQuestions>;

function policy() {
  return compilePolicy({
    schema: 'jevpolicy/v1',
    name: 'adapter-contract',
    version: 1,
    decisions: ['accept', 'review'],
    questions: sdkQuestions,
    rules: [
      {
        id: 'accept-low-risk',
        when: { signal: 'urgent', op: 'lt', value: 0.5 },
        decision: 'accept',
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

function sdkResult(): SdkResult {
  return {
    answers: {
      urgent: { type: 'boolean', probability: 0.2 },
      category: {
        type: 'choice',
        choice: 'technical',
        probabilities: { billing: 0.1, technical: 0.9 },
      },
      complexity: {
        type: 'score',
        score: 1.6,
        probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
      },
    },
    usage: { inputTokens: 20, outputTokens: 7, totalTokens: 27 },
    warnings: [],
    rounding: undefined,
    providerMetadata: {
      gateway: {
        generationId: 'gen_123',
        cost: '0.0004',
        routing: { resolvedProvider: 'typesafe-ai' },
      },
    },
    response: {
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      modelId: VERCEL_JEV_MODEL,
    },
  };
}

describe('VercelJevProvider', () => {
  beforeEach(() => {
    mocks.evaluate.mockReset();
  });

  it('maps compiled questions to the AI SDK contract and normalizes answers', async () => {
    mocks.evaluate.mockResolvedValueOnce(sdkResult());
    const compiled = policy();
    const result = await new VercelJevProvider().evaluate({
      state: { subject: 'A test request' },
      questions: compiled.questions,
    });

    const call = mocks.evaluate.mock.calls[0]?.[0] as {
      model: { modelId: string; provider: string };
      questions: Record<string, Record<string, unknown>>;
      state: unknown;
    };
    expect(call.model).toMatchObject({
      modelId: VERCEL_JEV_MODEL,
      provider: 'gateway',
    });
    expect(call.questions).toEqual(sdkQuestions);
    expect(call.questions['urgent']).not.toHaveProperty('fingerprint');
    expect(call.state).toEqual({ subject: 'A test request' });
    expect(result).toEqual({
      signals: {
        urgent: { type: 'boolean', probabilityTrue: 0.2 },
        category: {
          type: 'choice',
          value: 'technical',
          probabilities: { billing: 0.1, technical: 0.9 },
        },
        complexity: {
          type: 'score',
          value: 1.6,
          probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
        },
      },
      usage: { inputTokens: 20, outputTokens: 7 },
      gateway: {
        generationId: 'gen_123',
        cost: '0.0004',
        resolvedProvider: 'typesafe-ai',
      },
    });
    expect(result.signals['category']).not.toHaveProperty('confidence');
  });

  it('wraps malformed successful results as provider response errors', async () => {
    const malformed = sdkResult() as unknown as {
      answers: Record<string, unknown>;
    };
    malformed.answers['urgent'] = { type: 'boolean', probability: 2 };
    mocks.evaluate.mockResolvedValueOnce(malformed);

    await expect(
      new VercelJevProvider().evaluate({
        state: 'test',
        questions: policy().questions,
      }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('wraps AI SDK invalid-response errors without string matching', async () => {
    mocks.evaluate.mockRejectedValueOnce(
      new InvalidResponseDataError({ data: { invalid: true } }),
    );

    await expect(
      new VercelJevProvider().evaluate({
        state: 'test',
        questions: policy().questions,
      }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('aborts at the configured deadline and returns a typed timeout', async () => {
    mocks.evaluate.mockImplementationOnce(async (input) => {
      const { abortSignal } = input as { abortSignal: AbortSignal };
      await new Promise<never>((_resolve, reject) => {
        abortSignal.addEventListener(
          'abort',
          () =>
            reject(
              abortSignal.reason instanceof Error
                ? abortSignal.reason
                : new Error('aborted'),
            ),
          { once: true },
        );
      });
    });

    await expect(
      new VercelJevProvider().evaluate(
        { state: 'test', questions: policy().questions },
        { timeoutMs: 10, maxRetries: 0 },
      ),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('wraps ordinary provider failures separately from bad responses', async () => {
    mocks.evaluate.mockRejectedValueOnce(new Error('service unavailable'));

    await expect(
      new VercelJevProvider().evaluate({
        state: 'test',
        questions: policy().questions,
      }),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      provider: 'vercel-jev',
      model: VERCEL_JEV_MODEL,
    } satisfies Partial<ProviderError>);
  });

  it('rejects non-JSON state before invoking the SDK', async () => {
    await expect(
      new VercelJevProvider().evaluate({
        state: { value: 1n } as never,
        questions: policy().questions,
      }),
    ).rejects.toBeInstanceOf(StateValidationError);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
});
