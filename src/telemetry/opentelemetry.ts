import {
  metrics,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type Tracer,
} from '@opentelemetry/api';

import type { DecisionEnvelope, DecisionObserver } from '../runtime/types.js';

export const JEVPOLICY_INSTRUMENTATION_NAME = '@sanoy24/jevpolicy';

export interface OpenTelemetryDecisionObserverOptions {
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly instrumentationName?: string;
  readonly instrumentationVersion?: string;
  readonly now?: () => number;
}

function decisionAttributes(envelope: DecisionEnvelope): Attributes {
  return {
    'jevpolicy.policy.name': envelope.policy.name,
    'jevpolicy.policy.version': envelope.policy.version,
    'jevpolicy.mode': envelope.mode,
    'jevpolicy.decision': envelope.decision,
    'jevpolicy.provider.adapter': envelope.provider.adapter,
    'jevpolicy.provider.model': envelope.provider.model,
    'jevpolicy.provider.invoked': envelope.provider.invoked,
    'jevpolicy.fallback.used': envelope.fallback.used,
    ...(envelope.fallback.used
      ? { 'jevpolicy.fallback.reason': envelope.fallback.reason }
      : {}),
  };
}

function spanAttributes(envelope: DecisionEnvelope): Attributes {
  return {
    ...decisionAttributes(envelope),
    'jevpolicy.decision.id': envelope.decisionId,
    'jevpolicy.policy.fingerprint': envelope.policy.fingerprint,
    ...(envelope.matched.preconditionId === undefined
      ? {}
      : {
          'jevpolicy.matched.precondition_id': envelope.matched.preconditionId,
        }),
    ...(envelope.matched.ruleId === undefined
      ? {}
      : { 'jevpolicy.matched.rule_id': envelope.matched.ruleId }),
  };
}

export class OpenTelemetryDecisionObserver implements DecisionObserver {
  private readonly tracer: Tracer;
  private readonly evaluations: Counter;
  private readonly fallbacks: Counter;
  private readonly decisionDuration: Histogram;
  private readonly providerDuration: Histogram;
  private readonly now: () => number;

  constructor(options: OpenTelemetryDecisionObserverOptions = {}) {
    const instrumentationName =
      options.instrumentationName ?? JEVPOLICY_INSTRUMENTATION_NAME;
    this.tracer =
      options.tracer ??
      trace.getTracer(instrumentationName, options.instrumentationVersion);
    const meter =
      options.meter ??
      metrics.getMeter(instrumentationName, options.instrumentationVersion);
    this.evaluations = meter.createCounter('jevpolicy.decision.evaluations', {
      description: 'Number of completed JevPolicy decision evaluations',
      unit: '{evaluation}',
    });
    this.fallbacks = meter.createCounter('jevpolicy.decision.fallbacks', {
      description: 'Number of JevPolicy evaluations that used a fallback',
      unit: '{fallback}',
    });
    this.decisionDuration = meter.createHistogram(
      'jevpolicy.decision.duration',
      {
        description: 'End-to-end JevPolicy decision evaluation duration',
        unit: 'ms',
      },
    );
    this.providerDuration = meter.createHistogram(
      'jevpolicy.provider.duration',
      {
        description: 'JevPolicy provider evaluation duration',
        unit: 'ms',
      },
    );
    this.now = options.now ?? Date.now;
  }

  observe(envelope: DecisionEnvelope): void {
    const attributes = decisionAttributes(envelope);
    this.evaluations.add(1, attributes);
    this.decisionDuration.record(envelope.timing.totalMs, attributes);
    if (envelope.timing.providerMs !== undefined) {
      this.providerDuration.record(envelope.timing.providerMs, attributes);
    }
    if (envelope.fallback.used) {
      this.fallbacks.add(1, attributes);
    }

    const endedAt = this.now();
    const span = this.tracer.startSpan('jevpolicy.decision.evaluate', {
      startTime: Math.max(0, endedAt - envelope.timing.totalMs),
      attributes: spanAttributes(envelope),
    });
    if (envelope.fallback.used) {
      span.addEvent('jevpolicy.fallback', {
        'jevpolicy.fallback.reason': envelope.fallback.reason,
      });
    }
    span.end(endedAt);
  }
}
