import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  createFallbackDecision,
  evaluatePreconditions,
  evaluateRules,
} from '../core/evaluator.js';
import type {
  DeterministicDecision,
  FallbackReason,
  SignalSet,
} from '../core/types.js';
import { SignalValidationError, validateSignals } from '../core/validation.js';
import {
  ProviderError,
  ProviderResponseError,
  ProviderTimeoutError,
  RecorderError,
} from '../errors.js';
import type { CompiledPolicy } from '../policy/compiler.js';
import { createDecisionRecord } from '../recorders/record.js';
import type {
  DecisionRecorder,
  StateRedactor,
} from '../recorders/types.js';
import { validateEvaluationState } from '../providers/state.js';
import type {
  DecisionProvider,
  GatewayMetadata,
  ProviderEvaluationOptions,
  ProviderUsage,
} from '../providers/types.js';
import type {
  DecisionEnvelope,
  RuntimeClock,
  RuntimeEvaluationInput,
} from './types.js';

const defaultClock: RuntimeClock = {
  now: () => new Date(),
  monotonicMs: () => performance.now(),
};

export interface DecisionRuntimeOptions {
  readonly policy: CompiledPolicy;
  readonly provider: DecisionProvider;
  readonly providerOptions?: Omit<ProviderEvaluationOptions, 'abortSignal'>;
  readonly clock?: RuntimeClock;
  readonly idGenerator?: () => string;
  readonly recorder?: DecisionRecorder;
  readonly redactState?: StateRedactor;
}

interface EnvelopeContext {
  readonly deterministic: DeterministicDecision;
  readonly signals: SignalSet;
  readonly invoked: boolean;
  readonly policyMs: number;
  readonly totalStartedAt: number;
  readonly providerMs?: number;
  readonly usage?: ProviderUsage;
  readonly gateway?: GatewayMetadata;
}

function fallbackReason(error: unknown): FallbackReason {
  if (error instanceof ProviderTimeoutError) return 'provider_timeout';
  if (
    error instanceof ProviderResponseError ||
    error instanceof SignalValidationError
  ) {
    return 'invalid_provider_response';
  }
  if (error instanceof ProviderError) return 'provider_error';
  return 'provider_error';
}

export class DecisionRuntime {
  readonly policy: CompiledPolicy;
  readonly provider: DecisionProvider;
  private readonly providerOptions: Omit<
    ProviderEvaluationOptions,
    'abortSignal'
  >;
  private readonly clock: RuntimeClock;
  private readonly idGenerator: () => string;
  private readonly recorder: DecisionRecorder | undefined;
  private readonly redactState: StateRedactor | undefined;

  constructor(options: DecisionRuntimeOptions) {
    this.policy = options.policy;
    this.provider = options.provider;
    this.providerOptions = options.providerOptions ?? {};
    this.clock = options.clock ?? defaultClock;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.recorder = options.recorder;
    this.redactState = options.redactState;
  }

  async evaluate(input: RuntimeEvaluationInput): Promise<DecisionEnvelope> {
    const totalStartedAt = this.clock.monotonicMs();
    let policyMs = 0;
    const measurePolicy = <T>(operation: () => T): T => {
      const startedAt = this.clock.monotonicMs();
      try {
        return operation();
      } finally {
        policyMs += Math.max(0, this.clock.monotonicMs() - startedAt);
      }
    };

    const facts = input.facts ?? {};
    const preconditions = measurePolicy(() =>
      evaluatePreconditions(this.policy, facts),
    );
    if (preconditions.match !== null) {
      return this.complete(
        {
          deterministic: {
            decision: preconditions.match.decision,
            matched: { preconditionId: preconditions.match.id },
            fallback: { used: false },
            trace: {
              source: 'precondition',
              evaluations: preconditions.evaluations,
            },
          },
          signals: Object.freeze({}),
          invoked: false,
          policyMs,
          totalStartedAt,
        },
        input,
      );
    }

    const state = validateEvaluationState(input.state);
    const providerStartedAt = this.clock.monotonicMs();
    let providerResult: Awaited<ReturnType<DecisionProvider['evaluate']>>;
    try {
      providerResult = await this.provider.evaluate(
        { state, questions: this.policy.questions },
        {
          ...this.providerOptions,
          ...(input.abortSignal === undefined
            ? {}
            : { abortSignal: input.abortSignal }),
        },
      );
    } catch (error) {
      const providerMs = Math.max(
        0,
        this.clock.monotonicMs() - providerStartedAt,
      );
      const deterministic = measurePolicy(() =>
        createFallbackDecision(
          this.policy,
          fallbackReason(error),
          preconditions.evaluations,
        ),
      );
      return this.complete(
        {
          deterministic,
          signals: Object.freeze({}),
          invoked: true,
          policyMs,
          providerMs,
          totalStartedAt,
        },
        input,
      );
    }
    const providerMs = Math.max(
      0,
      this.clock.monotonicMs() - providerStartedAt,
    );

    let signals: SignalSet;
    try {
      signals = measurePolicy(() =>
        validateSignals(this.policy, providerResult.signals),
      );
    } catch (error) {
      const deterministic = measurePolicy(() =>
        createFallbackDecision(
          this.policy,
          fallbackReason(error),
          preconditions.evaluations,
        ),
      );
      return this.complete(
        {
          deterministic,
          signals: Object.freeze({}),
          invoked: true,
          policyMs,
          providerMs,
          totalStartedAt,
          ...(providerResult.usage === undefined
            ? {}
            : { usage: providerResult.usage }),
          ...(providerResult.gateway === undefined
            ? {}
            : { gateway: providerResult.gateway }),
        },
        input,
      );
    }

    const rules = measurePolicy(() =>
      evaluateRules(this.policy, facts, signals),
    );
    const evaluations = [...preconditions.evaluations, ...rules.evaluations];
    const deterministic: DeterministicDecision =
      rules.match === null
        ? createFallbackDecision(this.policy, 'no_match', evaluations)
        : {
            decision: rules.match.decision,
            matched: { ruleId: rules.match.id },
            fallback: { used: false },
            trace: { source: 'policy_rule', evaluations },
          };

    return this.complete(
      {
        deterministic,
        signals,
        invoked: true,
        policyMs,
        providerMs,
        totalStartedAt,
        ...(providerResult.usage === undefined
          ? {}
          : { usage: providerResult.usage }),
        ...(providerResult.gateway === undefined
          ? {}
          : { gateway: providerResult.gateway }),
      },
      input,
    );
  }

  private async complete(
    context: EnvelopeContext,
    input: RuntimeEvaluationInput,
  ): Promise<DecisionEnvelope> {
    const envelope = this.createEnvelope(context);
    if (this.recorder === undefined || input.record === false) return envelope;

    try {
      const record = await createDecisionRecord({
        policy: this.policy,
        envelope,
        state: input.state,
        facts: input.facts ?? {},
        ...(this.redactState === undefined
          ? {}
          : { redactState: this.redactState }),
      });
      await this.recorder.record(record);
    } catch (error) {
      throw new RecorderError('Failed to record decision', envelope, {
        cause: error,
      });
    }
    return envelope;
  }

  private createEnvelope(context: EnvelopeContext): DecisionEnvelope {
    const totalMs = Math.max(
      0,
      this.clock.monotonicMs() - context.totalStartedAt,
    );
    return {
      decisionId: this.idGenerator(),
      timestamp: this.clock.now().toISOString(),
      policy: {
        name: this.policy.name,
        version: this.policy.version,
        schema: this.policy.schema,
        fingerprint: this.policy.fingerprint,
      },
      mode: 'live',
      decision: context.deterministic.decision,
      matched: context.deterministic.matched,
      signals: context.signals,
      provider: {
        adapter: this.provider.adapter,
        model: this.provider.model,
        invoked: context.invoked,
        ...(context.usage === undefined ? {} : { usage: context.usage }),
        ...(context.gateway === undefined ? {} : { gateway: context.gateway }),
      },
      timing: {
        totalMs,
        ...(context.providerMs === undefined
          ? {}
          : { providerMs: context.providerMs }),
        policyMs: context.policyMs,
      },
      fallback: context.deterministic.fallback,
      trace: context.deterministic.trace,
    };
  }
}
