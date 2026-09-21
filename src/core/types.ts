import type { ConditionValue, Operator } from '../policy/schema.js';

export interface BooleanSignal {
  readonly type: 'boolean';
  readonly probabilityTrue: number;
}

export interface ChoiceSignal {
  readonly type: 'choice';
  readonly value: string;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

export interface ScoreSignal {
  readonly type: 'score';
  readonly value: number;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly confidence?: number;
}

export type DecisionSignal = BooleanSignal | ChoiceSignal | ScoreSignal;
export type SignalSet = Readonly<Record<string, DecisionSignal>>;

export type FactValue = string | number | boolean;
export type FactSet = Readonly<Record<string, FactValue | undefined>>;

export interface LeafConditionTrace {
  readonly kind: 'fact' | 'signal';
  readonly name: string;
  readonly operator: Operator;
  readonly expected: ConditionValue;
  readonly observed: FactValue | null;
  readonly missing: boolean;
  readonly passed: boolean;
}

export interface AllConditionTrace {
  readonly kind: 'all';
  readonly children: readonly ConditionTrace[];
  readonly passed: boolean;
}

export interface AnyConditionTrace {
  readonly kind: 'any';
  readonly children: readonly ConditionTrace[];
  readonly passed: boolean;
}

export interface NotConditionTrace {
  readonly kind: 'not';
  readonly child: ConditionTrace;
  readonly passed: boolean;
}

export type ConditionTrace =
  | LeafConditionTrace
  | AllConditionTrace
  | AnyConditionTrace
  | NotConditionTrace;

export interface TargetEvaluationTrace {
  readonly phase: 'precondition' | 'rule';
  readonly id: string;
  readonly decision: string;
  readonly matched: boolean;
  readonly condition: ConditionTrace;
}

export type DecisionTraceSource =
  'precondition' | 'policy_rule' | 'fallback' | 'replay_policy_rule';

export interface DecisionTrace {
  readonly source: DecisionTraceSource;
  readonly evaluations: readonly TargetEvaluationTrace[];
}

export type FallbackReason =
  | 'provider_error'
  | 'provider_timeout'
  | 'invalid_provider_response'
  | 'no_match';

export interface DecisionMatch {
  readonly preconditionId?: string;
  readonly ruleId?: string;
}

export interface DeterministicDecision {
  readonly decision: string;
  readonly matched: DecisionMatch;
  readonly fallback:
    | { readonly used: false }
    | { readonly used: true; readonly reason: FallbackReason };
  readonly trace: DecisionTrace;
}
