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
