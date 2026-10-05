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

export interface CalibrationReport {
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
  readonly boundaries: readonly number[];
  readonly summary: ConfidenceBandSummary;
  readonly groups: readonly ConfidenceBandGroup[];
}

export interface ConfidenceBandOptions {
  readonly boundaries?: readonly number[];
}
