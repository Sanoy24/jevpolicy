export interface ReplayDecisionResult {
  readonly decisionId: string;
  readonly originalDecision: string;
  readonly candidateDecision: string;
  readonly changed: boolean;
  readonly originalMatchedRule?: string;
  readonly candidateMatchedRule?: string;
  readonly originalMatchedPrecondition?: string;
  readonly candidateMatchedPrecondition?: string;
}

export interface ReplayTransition {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

export interface ReplaySummary {
  readonly records: number;
  readonly unchanged: number;
  readonly changed: number;
  readonly transitions: readonly ReplayTransition[];
}

export interface ReplayBatchResult {
  readonly results: readonly ReplayDecisionResult[];
  readonly summary: ReplaySummary;
}
