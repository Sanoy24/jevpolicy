import type {
  DecisionMatch,
  DecisionTrace,
  DeterministicDecision,
  SignalSet,
} from '../core/types.js';
import type { CompiledPolicy } from '../policy/compiler.js';
import type {
  EvaluationState,
  GatewayMetadata,
  ProviderUsage,
} from '../providers/types.js';

export type RuntimeMode = 'live' | 'shadow' | 'replay';

export interface RuntimeClock {
  now(): Date;
  monotonicMs(): number;
}

export interface RuntimeEvaluationInput {
  readonly state: EvaluationState;
  readonly facts?: unknown;
  readonly abortSignal?: AbortSignal;
  readonly record?: boolean;
}

export interface ShadowEvaluationInput extends RuntimeEvaluationInput {
  readonly shadowPolicy: CompiledPolicy;
}

export interface DecisionEnvelope {
  readonly decisionId: string;
  readonly timestamp: string;
  readonly policy: {
    readonly name: string;
    readonly version: number;
    readonly schema: 'jevpolicy/v1';
    readonly fingerprint: string;
  };
  readonly mode: RuntimeMode;
  readonly decision: string;
  readonly matched: DecisionMatch;
  readonly signals: SignalSet;
  readonly provider: {
    readonly adapter: string;
    readonly model: string;
    readonly invoked: boolean;
    readonly usage?: ProviderUsage;
    readonly gateway?: GatewayMetadata;
  };
  readonly timing: {
    readonly totalMs: number;
    readonly providerMs?: number;
    readonly policyMs: number;
  };
  readonly fallback: DeterministicDecision['fallback'];
  readonly trace: DecisionTrace;
}

export interface DecisionObserver {
  observe(envelope: DecisionEnvelope): void;
}

export interface RuntimePolicyIdentity {
  readonly name: CompiledPolicy['name'];
  readonly version: CompiledPolicy['version'];
  readonly schema: CompiledPolicy['schema'];
  readonly fingerprint: CompiledPolicy['fingerprint'];
}

export interface ShadowDecisionComparison {
  readonly decisionChanged: boolean;
  readonly matchChanged: boolean;
}

export interface ShadowEvaluationResult {
  readonly active: DecisionEnvelope;
  readonly shadow: DecisionEnvelope;
  readonly comparison: ShadowDecisionComparison;
}
