import { describe, expect, it } from 'vitest';

import { compilePolicy } from '../../src/policy/compiler.js';
import { VercelJevProvider } from '../../src/providers/vercel-jev/adapter.js';

const runLive = process.env['RUN_GATEWAY_TESTS'] === 'true';

describe.runIf(runLive)('VercelJevProvider live Gateway contract', () => {
  it('evaluates one Boolean question through typesafe-ai/jev', async () => {
    const policy = compilePolicy({
      schema: 'jevpolicy/v1',
      name: 'live-adapter-contract',
      version: 1,
      decisions: ['positive', 'negative'],
      questions: {
        positive: {
          type: 'boolean',
          instructions: 'Is the state clearly positive in sentiment?',
        },
      },
      rules: [
        {
          id: 'positive',
          when: { signal: 'positive', op: 'gte', value: 0.5 },
          decision: 'positive',
        },
      ],
      fallback: {
        provider_error: 'negative',
        provider_timeout: 'negative',
        invalid_provider_response: 'negative',
        no_match: 'negative',
      },
    });

    const result = await new VercelJevProvider().evaluate(
      {
        state: 'I am delighted with the result.',
        questions: policy.questions,
      },
      { timeoutMs: 30_000 },
    );

    expect(result.signals['positive']).toMatchObject({ type: 'boolean' });
  });
});
