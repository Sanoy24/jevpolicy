import type {
  Attributes,
  Meter,
  Span,
  SpanOptions,
  Tracer,
} from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';

import type { DecisionEnvelope } from '../../src/runtime/types.js';
import { OpenTelemetryDecisionObserver } from '../../src/telemetry/opentelemetry.js';

function fallbackEnvelope(): DecisionEnvelope {
  return {
    decisionId: 'decision-otel',
    timestamp: '2026-09-23T12:00:00.000Z',
    policy: {
      name: 'otel-contract',
      version: 2,
      schema: 'jevpolicy/v1',
      fingerprint: 'a'.repeat(64),
    },
    mode: 'live',
    decision: 'review',
    matched: {},
    signals: {},
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: true,
    },
    timing: { totalMs: 12.5, providerMs: 8, policyMs: 1.5 },
    fallback: { used: true, reason: 'provider_timeout' },
    trace: { source: 'fallback', evaluations: [] },
  };
}

describe('OpenTelemetryDecisionObserver', () => {
  it('emits bounded decision metrics and a completed evaluation span', () => {
    const evaluationsAdd = vi.fn();
    const fallbacksAdd = vi.fn();
    const decisionDurationRecord = vi.fn();
    const providerDurationRecord = vi.fn();
    const meter = {
      createCounter: vi.fn((name: string) => ({
        add:
          name === 'jevpolicy.decision.evaluations'
            ? evaluationsAdd
            : fallbacksAdd,
      })),
      createHistogram: vi.fn((name: string) => ({
        record:
          name === 'jevpolicy.decision.duration'
            ? decisionDurationRecord
            : providerDurationRecord,
      })),
    } as unknown as Meter;
    const addEvent = vi.fn();
    const end = vi.fn();
    const span = { addEvent, end } as unknown as Span;
    const startSpan = vi.fn((name: string, options?: SpanOptions): Span => {
      void name;
      void options;
      return span;
    });
    const tracer = { startSpan } as unknown as Tracer;
    const observer = new OpenTelemetryDecisionObserver({
      meter,
      tracer,
      now: () => 1_000,
    });

    observer.observe(fallbackEnvelope());

    const expectedAttributes: Attributes = {
      'jevpolicy.policy.name': 'otel-contract',
      'jevpolicy.policy.version': 2,
      'jevpolicy.mode': 'live',
      'jevpolicy.decision': 'review',
      'jevpolicy.provider.adapter': 'vercel-jev',
      'jevpolicy.provider.model': 'typesafe-ai/jev',
      'jevpolicy.provider.invoked': true,
      'jevpolicy.fallback.used': true,
      'jevpolicy.fallback.reason': 'provider_timeout',
    };
    expect(evaluationsAdd).toHaveBeenCalledWith(1, expectedAttributes);
    expect(fallbacksAdd).toHaveBeenCalledWith(1, expectedAttributes);
    expect(decisionDurationRecord).toHaveBeenCalledWith(
      12.5,
      expectedAttributes,
    );
    expect(providerDurationRecord).toHaveBeenCalledWith(8, expectedAttributes);
    expect(startSpan).toHaveBeenCalledWith('jevpolicy.decision.evaluate', {
      startTime: 987.5,
      attributes: {
        ...expectedAttributes,
        'jevpolicy.decision.id': 'decision-otel',
        'jevpolicy.policy.fingerprint': 'a'.repeat(64),
      },
    });
    expect(addEvent).toHaveBeenCalledWith('jevpolicy.fallback', {
      'jevpolicy.fallback.reason': 'provider_timeout',
    });
    expect(end).toHaveBeenCalledWith(1_000);

    const spanOptions = startSpan.mock.calls[0]?.[1];
    expect(spanOptions?.attributes).not.toHaveProperty('state');
    expect(spanOptions?.attributes).not.toHaveProperty('facts');
    expect(spanOptions?.attributes).not.toHaveProperty('signals');
  });
});
