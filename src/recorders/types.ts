import type { DecisionSignal, FactSet } from '../core/types.js';
import type { EvaluationState } from '../providers/types.js';
import type { DecisionEnvelope, RuntimeMode } from '../runtime/types.js';

export interface RecordedSignal {
  readonly questionFingerprint: string;
  readonly signal: DecisionSignal;
}

export interface DecisionRecord {
  readonly format: 'jevpolicy.record/v1';
  readonly decisionId: string;
  readonly timestamp: string;
  readonly policy: {
    readonly name: string;
    readonly version: number;
    readonly fingerprint: string;
  };
  readonly state?: EvaluationState;
  readonly stateFingerprint?: string;
  readonly facts: FactSet;
  readonly signals: Readonly<Record<string, RecordedSignal>>;
  readonly originalDecision: string;
  readonly matched: DecisionEnvelope['matched'];
  readonly provider: DecisionEnvelope['provider'];
  readonly mode: RuntimeMode;
}

export interface DecisionRecorder {
  record(record: DecisionRecord): Promise<void>;
}

export type StateRedactor = (
  state: EvaluationState,
) => EvaluationState | Promise<EvaluationState>;
