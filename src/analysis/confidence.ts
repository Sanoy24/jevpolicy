import type { DecisionSignal } from '../core/types.js';
import { joinDecisionOutcomes } from '../outcomes/join.js';
import type { DecisionOutcome } from '../outcomes/types.js';
import type { DecisionRecord, RecordedSignal } from '../recorders/types.js';
import type {
  ConfidenceBand,
  ConfidenceBandGroup,
  ConfidenceBandMeasure,
  ConfidenceBandOptions,
  ConfidenceBandReport,
} from './types.js';

export const DEFAULT_CONFIDENCE_BAND_BOUNDARIES = Object.freeze([
  0, 0.2, 0.4, 0.6, 0.8, 1,
]);

interface SignalMeasure {
  readonly measure: ConfidenceBandMeasure;
  readonly value: number;
}

interface MutableBand {
  observations: number;
  correct: number;
  valueTotal: number;
}

interface MutableGroup {
  readonly question: string;
  readonly questionFingerprint: string;
  readonly signalType: DecisionSignal['type'];
  readonly measure: ConfidenceBandMeasure;
  observations: number;
  outOfRange: number;
  readonly bands: MutableBand[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function validateBoundaries(input: readonly number[]): readonly number[] {
  if (input.length < 2 || input[0] !== 0 || input[input.length - 1] !== 1) {
    throw new RangeError('Confidence boundaries must start at 0 and end at 1');
  }
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index]!;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        'Confidence boundaries must contain only finite values between 0 and 1',
      );
    }
    if (index > 0 && value <= input[index - 1]!) {
      throw new RangeError('Confidence boundaries must be strictly increasing');
    }
  }
  return Object.freeze([...input]);
}

function measures(signal: DecisionSignal): readonly SignalMeasure[] {
  switch (signal.type) {
    case 'boolean':
      return [{ measure: 'probability_true', value: signal.probabilityTrue }];
    case 'choice': {
      const selectedProbability = signal.probabilities?.[signal.value];
      return [
        ...(selectedProbability === undefined
          ? []
          : [
              {
                measure: 'selected_probability' as const,
                value: selectedProbability,
              },
            ]),
        ...(signal.confidence === undefined
          ? []
          : [
              {
                measure: 'confidence' as const,
                value: signal.confidence,
              },
            ]),
      ];
    }
    case 'score': {
      const values = Object.values(signal.probabilities ?? {});
      const peakProbability =
        values.length === 0
          ? undefined
          : values.reduce((highest, value) => Math.max(highest, value));
      return [
        ...(peakProbability === undefined
          ? []
          : [
              {
                measure: 'peak_probability' as const,
                value: peakProbability,
              },
            ]),
        ...(signal.confidence === undefined
          ? []
          : [
              {
                measure: 'confidence' as const,
                value: signal.confidence,
              },
            ]),
      ];
    }
  }
}

function groupKey(
  question: string,
  recorded: RecordedSignal,
  measure: ConfidenceBandMeasure,
): string {
  return JSON.stringify([
    question,
    recorded.questionFingerprint,
    recorded.signal.type,
    measure,
  ]);
}

function findBand(value: number, boundaries: readonly number[]): number {
  if (value < 0 || value > 1) return -1;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const upper = boundaries[index + 1]!;
    if (value < upper || (upper === 1 && value === 1)) return index;
  }
  return -1;
}

function finalizeBands(
  group: MutableGroup,
  boundaries: readonly number[],
): readonly ConfidenceBand[] {
  return Object.freeze(
    group.bands.map((band, index) => {
      const observations = band.observations;
      return Object.freeze({
        lower: boundaries[index]!,
        upper: boundaries[index + 1]!,
        upperInclusive: index === group.bands.length - 1,
        observations,
        correct: band.correct,
        incorrect: observations - band.correct,
        decisionAccuracy: ratio(band.correct, observations),
        averageValue: ratio(band.valueTotal, observations),
      });
    }),
  );
}

function finalizeGroups(
  groups: ReadonlyMap<string, MutableGroup>,
  boundaries: readonly number[],
): readonly ConfidenceBandGroup[] {
  return Object.freeze(
    [...groups.values()]
      .sort(
        (left, right) =>
          left.question.localeCompare(right.question) ||
          left.questionFingerprint.localeCompare(right.questionFingerprint) ||
          left.signalType.localeCompare(right.signalType) ||
          left.measure.localeCompare(right.measure),
      )
      .map((group) =>
        Object.freeze({
          question: group.question,
          questionFingerprint: group.questionFingerprint,
          signalType: group.signalType,
          measure: group.measure,
          observations: group.observations,
          outOfRange: group.outOfRange,
          bands: finalizeBands(group, boundaries),
        }),
      ),
  );
}

export function createConfidenceBandReport(
  records: readonly DecisionRecord[],
  outcomes: readonly DecisionOutcome[],
  options: ConfidenceBandOptions = {},
): ConfidenceBandReport {
  const boundaries = validateBoundaries(
    options.boundaries ?? DEFAULT_CONFIDENCE_BAND_BOUNDARIES,
  );
  const joined = joinDecisionOutcomes(records, outcomes);
  const groups = new Map<string, MutableGroup>();
  let observations = 0;
  let outOfRange = 0;

  for (const { record, outcome } of joined.labeled) {
    const correct = record.originalDecision === outcome.label;
    for (const [question, recorded] of Object.entries(record.signals)) {
      for (const measurement of measures(recorded.signal)) {
        const key = groupKey(question, recorded, measurement.measure);
        let group = groups.get(key);
        if (group === undefined) {
          group = {
            question,
            questionFingerprint: recorded.questionFingerprint,
            signalType: recorded.signal.type,
            measure: measurement.measure,
            observations: 0,
            outOfRange: 0,
            bands: Array.from(
              { length: boundaries.length - 1 },
              (): MutableBand => ({
                observations: 0,
                correct: 0,
                valueTotal: 0,
              }),
            ),
          };
          groups.set(key, group);
        }

        group.observations += 1;
        observations += 1;
        const bandIndex = findBand(measurement.value, boundaries);
        if (bandIndex === -1) {
          group.outOfRange += 1;
          outOfRange += 1;
          continue;
        }
        const band = group.bands[bandIndex]!;
        band.observations += 1;
        band.valueTotal += measurement.value;
        if (correct) band.correct += 1;
      }
    }
  }

  const finalizedGroups = finalizeGroups(groups, boundaries);
  return Object.freeze({
    boundaries,
    summary: Object.freeze({
      records: joined.summary.records,
      labeled: joined.summary.labeled,
      unlabeled: joined.summary.unlabeled,
      coverage: ratio(joined.summary.labeled, joined.summary.records),
      groups: finalizedGroups.length,
      observations,
      outOfRange,
    }),
    groups: finalizedGroups,
  });
}
