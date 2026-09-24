import type { DecisionRecord } from '../recorders/types.js';

export interface DecisionOutcome {
  readonly format: 'jevpolicy.outcome/v1';
  readonly decisionId: string;
  readonly label: string;
  readonly observedAt: string;
}

export interface DecisionOutcomeRecorder {
  record(outcome: DecisionOutcome): Promise<void>;
}

export interface LabeledDecisionRecord {
  readonly record: DecisionRecord;
  readonly outcome: DecisionOutcome;
}

export interface OutcomeJoinSummary {
  readonly records: number;
  readonly outcomes: number;
  readonly labeled: number;
  readonly unlabeled: number;
}

export interface OutcomeJoinResult {
  readonly labeled: readonly LabeledDecisionRecord[];
  readonly unlabeledDecisionIds: readonly string[];
  readonly summary: OutcomeJoinSummary;
}
