import { describe, expect, it } from 'vitest';

import { createConfidenceBandReport } from '../../src/analysis/confidence.js';
import type { DecisionSignal } from '../../src/core/types.js';
import type { DecisionOutcome } from '../../src/outcomes/types.js';
import type {
  DecisionRecord,
  RecordedSignal,
} from '../../src/recorders/types.js';

function recorded(fingerprint: string, signal: DecisionSignal): RecordedSignal {
  return { questionFingerprint: fingerprint.repeat(64), signal };
}

function record(
  decisionId: string,
  signals: Readonly<Record<string, RecordedSignal>>,
): DecisionRecord {
  return {
    format: 'jevpolicy.record/v1',
    decisionId,
    timestamp: '2026-09-24T08:00:00.000Z',
    policy: {
      name: 'confidence-contract',
      version: 1,
      fingerprint: 'f'.repeat(64),
    },
    facts: {},
    signals,
    originalDecision: 'approve',
    matched: {},
    provider: {
      adapter: 'vercel-jev',
      model: 'typesafe-ai/jev',
      invoked: true,
    },
    mode: 'live',
  };
}

function outcome(decisionId: string, label: string): DecisionOutcome {
  return {
    format: 'jevpolicy.outcome/v1',
    decisionId,
    label,
    observedAt: '2026-09-24T09:00:00.000Z',
  };
}

function signals(options: {
  boolean: number;
  choiceProbability: number;
  choiceConfidence: number;
  scorePeak: number;
  scoreConfidence: number;
}): Readonly<Record<string, RecordedSignal>> {
  return {
    urgent: recorded('a', {
      type: 'boolean',
      probabilityTrue: options.boolean,
    }),
    category: recorded('b', {
      type: 'choice',
      value: 'billing',
      probabilities: {
        billing: options.choiceProbability,
        technical: 1 - options.choiceProbability,
      },
      confidence: options.choiceConfidence,
    }),
    complexity: recorded('c', {
      type: 'score',
      value: 1,
      probabilities: {
        '0': 1 - options.scorePeak,
        '1': options.scorePeak,
      },
      confidence: options.scoreConfidence,
    }),
  };
}

describe('confidence-band analysis', () => {
  it('keeps probability and confidence measures separate', () => {
    const report = createConfidenceBandReport(
      [
        record(
          'correct',
          signals({
            boolean: 0.9,
            choiceProbability: 0.8,
            choiceConfidence: 0.7,
            scorePeak: 0.7,
            scoreConfidence: 1.2,
          }),
        ),
        record(
          'incorrect',
          signals({
            boolean: 0.6,
            choiceProbability: 0.6,
            choiceConfidence: 0.4,
            scorePeak: 0.5,
            scoreConfidence: -0.1,
          }),
        ),
        record(
          'unlabeled',
          signals({
            boolean: 0.1,
            choiceProbability: 0.9,
            choiceConfidence: 0.9,
            scorePeak: 0.9,
            scoreConfidence: 0.9,
          }),
        ),
      ],
      [outcome('correct', 'approve'), outcome('incorrect', 'review')],
      { boundaries: [0, 0.5, 1] },
    );

    expect(report.summary).toEqual({
      records: 3,
      labeled: 2,
      unlabeled: 1,
      coverage: 2 / 3,
      groups: 5,
      observations: 10,
      outOfRange: 2,
    });
    expect(
      report.groups.map(({ question, signalType, measure }) => ({
        question,
        signalType,
        measure,
      })),
    ).toEqual([
      {
        question: 'category',
        signalType: 'choice',
        measure: 'confidence',
      },
      {
        question: 'category',
        signalType: 'choice',
        measure: 'selected_probability',
      },
      {
        question: 'complexity',
        signalType: 'score',
        measure: 'confidence',
      },
      {
        question: 'complexity',
        signalType: 'score',
        measure: 'peak_probability',
      },
      {
        question: 'urgent',
        signalType: 'boolean',
        measure: 'probability_true',
      },
    ]);

    const selected = report.groups.find(
      ({ measure }) => measure === 'selected_probability',
    );
    expect(selected?.bands).toEqual([
      {
        lower: 0,
        upper: 0.5,
        upperInclusive: false,
        observations: 0,
        correct: 0,
        incorrect: 0,
        decisionAccuracy: null,
        averageValue: null,
      },
      {
        lower: 0.5,
        upper: 1,
        upperInclusive: true,
        observations: 2,
        correct: 1,
        incorrect: 1,
        decisionAccuracy: 0.5,
        averageValue: 0.7,
      },
    ]);

    const scoreConfidence = report.groups.find(
      ({ question, measure }) =>
        question === 'complexity' && measure === 'confidence',
    );
    expect(scoreConfidence).toMatchObject({
      observations: 2,
      outOfRange: 2,
    });
    expect(
      scoreConfidence?.bands.every((band) => band.observations === 0),
    ).toBe(true);
  });

  it('separates changed question definitions by fingerprint', () => {
    const report = createConfidenceBandReport(
      [
        record('first', {
          urgent: recorded('a', {
            type: 'boolean',
            probabilityTrue: 0.8,
          }),
        }),
        record('second', {
          urgent: recorded('b', {
            type: 'boolean',
            probabilityTrue: 0.8,
          }),
        }),
      ],
      [outcome('first', 'approve'), outcome('second', 'approve')],
    );

    expect(report.groups).toHaveLength(2);
    expect(
      report.groups.map(({ questionFingerprint }) => questionFingerprint),
    ).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });

  it('includes both endpoints in the configured band range', () => {
    const report = createConfidenceBandReport(
      [
        record('zero', {
          urgent: recorded('a', {
            type: 'boolean',
            probabilityTrue: 0,
          }),
        }),
        record('one', {
          urgent: recorded('a', {
            type: 'boolean',
            probabilityTrue: 1,
          }),
        }),
      ],
      [outcome('zero', 'approve'), outcome('one', 'approve')],
      { boundaries: [0, 0.5, 1] },
    );

    expect(
      report.groups[0]?.bands.map(({ observations }) => observations),
    ).toEqual([1, 1]);
  });

  it('rejects invalid boundaries', () => {
    const invalid = [
      [],
      [0.1, 1],
      [0, 0.5],
      [0, 0.5, 0.5, 1],
      [0, Number.NaN, 1],
    ];

    for (const boundaries of invalid) {
      expect(() => createConfidenceBandReport([], [], { boundaries })).toThrow(
        RangeError,
      );
    }
  });
});
