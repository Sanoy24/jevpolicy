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
  ShadowCompatibilityError,
} from '../errors.js';
import type { CompiledPolicy } from '../policy/compiler.js';
import { createDecisionRecord } from '../recorders/record.js';
import type { DecisionRecorder, StateRedactor } from '../recorders/types.js';
import { validateEvaluationState } from '../providers/state.js';
import type {
  DecisionProvider,
  GatewayMetadata,
  ProviderEvaluationOptions,
  ProviderEvaluationResult,
  ProviderUsage,
} from '../providers/types.js';
import type {
  DecisionEnvelope,
  DecisionObserver,
  RuntimeClock,
  RuntimeEvaluationInput,
  ShadowEvaluationInput,
  ShadowEvaluationResult,
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
  readonly observer?: DecisionObserver;
}

interface EnvelopeContext {
  readonly policy: CompiledPolicy;
  readonly mode: 'live' | 'shadow';
  readonly deterministic: DeterministicDecision;
  readonly signals: SignalSet;
  readonly invoked: boolean;
  readonly policyMs: number;
  readonly totalStartedAt: number;
  readonly providerMs?: number;
  readonly usage?: ProviderUsage;
  readonly gateway?: GatewayMetadata;
}

interface PolicyEvaluationContext {
  readonly policy: CompiledPolicy;
  readonly mode: 'live' | 'shadow';
  readonly totalStartedAt: number;
  policyMs: number;
  readonly preconditions: ReturnType<typeof evaluatePreconditions>;
}

function sortedNames(value: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

function factContract(policy: CompiledPolicy): string {
  return JSON.stringify(
    Object.entries(policy.facts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function validateShadowCompatibility(
  activePolicy: CompiledPolicy,
  shadowPolicy: CompiledPolicy,
): void {
  if (activePolicy.name !== shadowPolicy.name) {
    throw new ShadowCompatibilityError(
      `Active policy '${activePolicy.name}' cannot be shadowed by '${shadowPolicy.name}'`,
    );
  }

  if (factContract(activePolicy) !== factContract(shadowPolicy)) {
    throw new ShadowCompatibilityError(
      'Active and shadow policies must declare the same fact contract',
    );
  }

  const activeQuestionNames = sortedNames(activePolicy.questions);
  const shadowQuestionNames = sortedNames(shadowPolicy.questions);
  if (!sameNames(activeQuestionNames, shadowQuestionNames)) {
    throw new ShadowCompatibilityError(
      'Active and shadow policies must declare the same question names',
    );
  }

  for (const name of activeQuestionNames) {
    if (
      activePolicy.questions[name]?.fingerprint !==
      shadowPolicy.questions[name]?.fingerprint
    ) {
      throw new ShadowCompatibilityError(
        `Question '${name}' differs between the active and shadow policies`,
      );
    }
  }
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
  private readonly observer: DecisionObserver | undefined;

  constructor(options: DecisionRuntimeOptions) {
    this.policy = options.policy;
    this.provider = options.provider;
    this.providerOptions = options.providerOptions ?? {};
    this.clock = options.clock ?? defaultClock;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.recorder = options.recorder;
    this.redactState = options.redactState;
    this.observer = options.observer;
  }

  async evaluate(input: RuntimeEvaluationInput): Promise<DecisionEnvelope> {
    const [envelope] = await this.evaluatePolicies(
      [{ policy: this.policy, mode: 'live' }],
      input,
    );
    return envelope!;
  }

  async evaluateWithShadow(
    input: ShadowEvaluationInput,
  ): Promise<ShadowEvaluationResult> {
    validateShadowCompatibility(this.policy, input.shadowPolicy);
    const [active, shadow] = await this.evaluatePolicies(
      [
        { policy: this.policy, mode: 'live' },
        { policy: input.shadowPolicy, mode: 'shadow' },
      ],
      input,
    );

    return {
      active: active!,
      shadow: shadow!,
      comparison: {
        decisionChanged: active!.decision !== shadow!.decision,
        matchChanged:
          active!.matched.preconditionId !== shadow!.matched.preconditionId ||
          active!.matched.ruleId !== shadow!.matched.ruleId,
      },
    };
  }

  private preparePolicy(
    policy: CompiledPolicy,
    mode: 'live' | 'shadow',
    facts: unknown,
  ): PolicyEvaluationContext {
    const timing = {
      policy,
      mode,
      totalStartedAt: this.clock.monotonicMs(),
      policyMs: 0,
    };
    const preconditions = this.measurePolicy(timing, () =>
      evaluatePreconditions(policy, facts),
    );
    return { ...timing, preconditions };
  }

  private measurePolicy<T>(
    context: { policyMs: number },
    operation: () => T,
  ): T {
    const startedAt = this.clock.monotonicMs();
    try {
      return operation();
    } finally {
      context.policyMs += Math.max(0, this.clock.monotonicMs() - startedAt);
    }
  }

  private async evaluatePolicies(
    policies: readonly {
      readonly policy: CompiledPolicy;
      readonly mode: 'live' | 'shadow';
    }[],
    input: RuntimeEvaluationInput,
  ): Promise<readonly DecisionEnvelope[]> {
    const facts = input.facts ?? {};
    const contexts = policies.map(({ policy, mode }) =>
      this.preparePolicy(policy, mode, facts),
    );
    const pending = contexts.filter(
      (context) => context.preconditions.match === null,
    );

    let providerResult: ProviderEvaluationResult | undefined;
    let providerFailure: unknown;
    let providerFailed = false;
    let providerMs: number | undefined;
    if (pending.length > 0) {
      const state = validateEvaluationState(input.state);
      const providerStartedAt = this.clock.monotonicMs();
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
        providerFailed = true;
        providerFailure = error;
      }
      providerMs = Math.max(0, this.clock.monotonicMs() - providerStartedAt);
    }

    const completed = contexts.map((context): EnvelopeContext => {
      const match = context.preconditions.match;
      if (match !== null) {
        return {
          policy: context.policy,
          mode: context.mode,
          deterministic: {
            decision: match.decision,
            matched: { preconditionId: match.id },
            fallback: { used: false },
            trace: {
              source: 'precondition',
              evaluations: context.preconditions.evaluations,
            },
          },
          signals: Object.freeze({}),
          invoked: false,
          policyMs: context.policyMs,
          totalStartedAt: context.totalStartedAt,
        };
      }

      if (providerFailed) {
        return {
          policy: context.policy,
          mode: context.mode,
          deterministic: this.measurePolicy(context, () =>
            createFallbackDecision(
              context.policy,
              fallbackReason(providerFailure),
              context.preconditions.evaluations,
            ),
          ),
          signals: Object.freeze({}),
          invoked: true,
          policyMs: context.policyMs,
          totalStartedAt: context.totalStartedAt,
          providerMs: providerMs!,
        };
      }

      let signals: SignalSet;
      try {
        signals = this.measurePolicy(context, () =>
          validateSignals(context.policy, providerResult!.signals),
        );
      } catch (error) {
        return {
          policy: context.policy,
          mode: context.mode,
          deterministic: this.measurePolicy(context, () =>
            createFallbackDecision(
              context.policy,
              fallbackReason(error),
              context.preconditions.evaluations,
            ),
          ),
          signals: Object.freeze({}),
          invoked: true,
          policyMs: context.policyMs,
          totalStartedAt: context.totalStartedAt,
          providerMs: providerMs!,
          ...(providerResult!.usage === undefined
            ? {}
            : { usage: providerResult!.usage }),
          ...(providerResult!.gateway === undefined
            ? {}
            : { gateway: providerResult!.gateway }),
        };
      }

      const rules = this.measurePolicy(context, () =>
        evaluateRules(context.policy, facts, signals),
      );
      const evaluations = [
        ...context.preconditions.evaluations,
        ...rules.evaluations,
      ];
      const deterministic: DeterministicDecision =
        rules.match === null
          ? createFallbackDecision(context.policy, 'no_match', evaluations)
          : {
              decision: rules.match.decision,
              matched: { ruleId: rules.match.id },
              fallback: { used: false },
              trace: { source: 'policy_rule', evaluations },
            };
      return {
        policy: context.policy,
        mode: context.mode,
        deterministic,
        signals,
        invoked: true,
        policyMs: context.policyMs,
        totalStartedAt: context.totalStartedAt,
        providerMs: providerMs!,
        ...(providerResult!.usage === undefined
          ? {}
          : { usage: providerResult!.usage }),
        ...(providerResult!.gateway === undefined
          ? {}
          : { gateway: providerResult!.gateway }),
      };
    });

    return this.complete(completed, input);
  }

  private async complete(
    contexts: readonly EnvelopeContext[],
    input: RuntimeEvaluationInput,
  ): Promise<readonly DecisionEnvelope[]> {
    const envelopes = contexts.map((context) => this.createEnvelope(context));
    for (const envelope of envelopes) {
      this.notifyObserver(envelope);
    }
    if (this.recorder === undefined || input.record === false) return envelopes;

    for (const [index, envelope] of envelopes.entries()) {
      try {
        const record = await createDecisionRecord({
          policy: contexts[index]!.policy,
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
    }
    return envelopes;
  }

  private notifyObserver(envelope: DecisionEnvelope): void {
    if (this.observer === undefined) return;
    try {
      this.observer.observe(envelope);
    } catch {
      // Telemetry is best-effort and must never alter a policy decision.
      return;
    }
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
        name: context.policy.name,
        version: context.policy.version,
        schema: context.policy.schema,
        fingerprint: context.policy.fingerprint,
      },
      mode: context.mode,
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
