import { joinDecisionOutcomes } from '../outcomes/join.js';
import type { DecisionOutcome } from '../outcomes/types.js';
import type { DecisionRecord } from '../recorders/types.js';
import type {
  CalibrationLabelMetrics,
  CalibrationReport,
  CalibrationTransition,
} from './types.js';

interface MutableLabelMetrics {
  predicted: number;
  observed: number;
  correct: number;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function labelMetrics(
  metrics: ReadonlyMap<string, MutableLabelMetrics>,
): readonly CalibrationLabelMetrics[] {
  return Object.freeze(
    [...metrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, value]) =>
        Object.freeze({
          label,
          predicted: value.predicted,
          observed: value.observed,
          correct: value.correct,
          precision: ratio(value.correct, value.predicted),
          recall: ratio(value.correct, value.observed),
        }),
      ),
  );
}

function transitionMetrics(
  transitions: ReadonlyMap<string, ReadonlyMap<string, number>>,
): readonly CalibrationTransition[] {
  const result: CalibrationTransition[] = [];
  for (const [predicted, observedCounts] of transitions) {
    for (const [observed, count] of observedCounts) {
      result.push(Object.freeze({ predicted, observed, count }));
    }
  }
  return Object.freeze(
    result.sort(
      (left, right) =>
        right.count - left.count ||
        left.predicted.localeCompare(right.predicted) ||
        left.observed.localeCompare(right.observed),
    ),
  );
}

export function createCalibrationReport(
  records: readonly DecisionRecord[],
  outcomes: readonly DecisionOutcome[],
): CalibrationReport {
  const joined = joinDecisionOutcomes(records, outcomes);
  const labels = new Map<string, MutableLabelMetrics>();
  const transitions = new Map<string, Map<string, number>>();
  let correct = 0;

  const getLabel = (label: string): MutableLabelMetrics => {
    const current = labels.get(label);
    if (current !== undefined) return current;
    const created: MutableLabelMetrics = {
      predicted: 0,
      observed: 0,
      correct: 0,
    };
    labels.set(label, created);
    return created;
  };

  for (const { record, outcome } of joined.labeled) {
    const predicted = record.originalDecision;
    const observed = outcome.label;
    getLabel(predicted).predicted += 1;
    getLabel(observed).observed += 1;
    if (predicted === observed) {
      correct += 1;
      getLabel(predicted).correct += 1;
    }

    let observedCounts = transitions.get(predicted);
    if (observedCounts === undefined) {
      observedCounts = new Map<string, number>();
      transitions.set(predicted, observedCounts);
    }
    observedCounts.set(observed, (observedCounts.get(observed) ?? 0) + 1);
  }

  return Object.freeze({
    summary: Object.freeze({
      records: joined.summary.records,
      labeled: joined.summary.labeled,
      unlabeled: joined.summary.unlabeled,
      coverage: ratio(joined.summary.labeled, joined.summary.records),
      correct,
      incorrect: joined.summary.labeled - correct,
      accuracy: ratio(correct, joined.summary.labeled),
    }),
    labels: labelMetrics(labels),
    transitions: transitionMetrics(transitions),
  });
}
