import type { RuntimeMode } from '../runtime/types.js';

export interface DecisionRecordFilter {
  /** Record mode to analyze. Defaults to `live`. */
  readonly mode?: RuntimeMode;
  /** Restrict the analysis to one policy fingerprint. */
  readonly policyFingerprint?: string;
}

export interface AnalysisSelection {
  readonly mode: RuntimeMode;
  readonly policyFingerprint?: string;
}

export interface AnalysisPolicy {
  readonly name: string;
  readonly version: number;
  readonly fingerprint: string;
  readonly records: number;
}

export interface CalibrationTransition {
  readonly predicted: string;
  readonly observed: string;
  readonly count: number;
}

export interface CalibrationLabelMetrics {
  readonly label: string;
  readonly predicted: number;
  readonly observed: number;
  readonly correct: number;
  readonly precision: number | null;
  readonly recall: number | null;
}

export interface CalibrationSummary {
  readonly records: number;
  readonly labeled: number;
  readonly unlabeled: number;
  readonly coverage: number | null;
  readonly correct: number;
  readonly incorrect: number;
  readonly accuracy: number | null;
}

export type CalibrationOptions = DecisionRecordFilter;

export interface CalibrationReport {
  readonly selection: AnalysisSelection;
  readonly policies: readonly AnalysisPolicy[];
  readonly summary: CalibrationSummary;
  readonly labels: readonly CalibrationLabelMetrics[];
  readonly transitions: readonly CalibrationTransition[];
}

export type ConfidenceBandMeasure =
  | 'probability_true'
  | 'selected_probability'
  | 'peak_probability'
  | 'confidence';

export interface ConfidenceBand {
  readonly lower: number;
  readonly upper: number;
  readonly upperInclusive: boolean;
  readonly observations: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly decisionAccuracy: number | null;
  readonly averageValue: number | null;
}

export interface ConfidenceBandGroup {
  readonly question: string;
  readonly questionFingerprint: string;
  readonly signalType: 'boolean' | 'choice' | 'score';
  readonly measure: ConfidenceBandMeasure;
  readonly observations: number;
  readonly outOfRange: number;
  readonly bands: readonly ConfidenceBand[];
}

export interface ConfidenceBandSummary {
  readonly records: number;
  readonly labeled: number;
  readonly unlabeled: number;
  readonly coverage: number | null;
  readonly groups: number;
  readonly observations: number;
  readonly outOfRange: number;
}

export interface ConfidenceBandReport {
  readonly selection: AnalysisSelection;
  readonly policies: readonly AnalysisPolicy[];
  readonly boundaries: readonly number[];
  readonly summary: ConfidenceBandSummary;
  readonly groups: readonly ConfidenceBandGroup[];
}

export interface ConfidenceBandOptions extends DecisionRecordFilter {
  readonly boundaries?: readonly number[];
}

export type RuleFrequencyMatchKind = 'precondition' | 'rule' | 'unmatched';

export interface RuleFrequencyMatch {
  readonly kind: RuleFrequencyMatchKind;
  readonly id?: string;
  readonly decision: string;
  readonly count: number;
  /** Share of this policy version's selected records. */
  readonly rate: number;
}

export interface RuleFrequencyPolicy extends AnalysisPolicy {
  readonly matches: readonly RuleFrequencyMatch[];
}

export interface RuleFrequencySummary {
  readonly records: number;
  readonly policies: number;
  readonly preconditionMatches: number;
  readonly ruleMatches: number;
  readonly unmatched: number;
}

export type RuleFrequencyOptions = DecisionRecordFilter;

export interface RuleFrequencyReport {
  readonly selection: AnalysisSelection;
  readonly summary: RuleFrequencySummary;
  readonly policies: readonly RuleFrequencyPolicy[];
}
